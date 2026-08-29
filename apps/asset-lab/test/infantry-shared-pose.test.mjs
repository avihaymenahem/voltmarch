import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  bakeCpuAnimationFrames,
  cpuSkinFrame,
  INFANTRY_RUNTIME_LIMITS,
  validateInfantryRuntimeSource,
} from '../src/infantry-shared-pose.mjs';

function skinFixture({
  position = [1, 2, 3],
  normal = [0, 1, 0],
  indices = [0, 0, 0, 0],
  weights = [1, 0, 0, 0],
  bones = [new THREE.Matrix4()],
  meshMatrix = new THREE.Matrix4(),
} = {}) {
  return cpuSkinFrame({
    sourcePosition: new THREE.Float32BufferAttribute(position, 3),
    sourceNormal: new THREE.Float32BufferAttribute(normal, 3),
    skinIndex: new THREE.Uint8BufferAttribute(indices, 4),
    skinWeight: new THREE.Float32BufferAttribute(weights, 4),
    boneMatrices: new Float32Array(bones.flatMap((matrix) => matrix.toArray())),
    bindMatrix: new THREE.Matrix4(),
    bindMatrixInverse: new THREE.Matrix4(),
    meshMatrix,
    meshNormalMatrix: new THREE.Matrix3().getNormalMatrix(meshMatrix),
  });
}

test('CPU shared-pose skinning preserves identity and applies the model transform', () => {
  const result = skinFixture({ meshMatrix: new THREE.Matrix4().makeTranslation(10, 0, 0) });
  assert.deepEqual(Array.from(result.positions), [11, 2, 3]);
  assert.deepEqual(Array.from(result.normals), [0, 1, 0]);
});

test('CPU shared-pose skinning blends bone transforms', () => {
  const result = skinFixture({
    position: [1, 0, 0],
    indices: [0, 1, 0, 0],
    weights: [0.5, 0.5, 0, 0],
    bones: [new THREE.Matrix4(), new THREE.Matrix4().makeTranslation(2, 0, 0)],
  });
  assert.ok(Math.abs(result.positions[0] - 2) < 1e-6);
  assert.ok(Math.abs(result.positions[1]) < 1e-6);
  assert.ok(Math.abs(result.positions[2]) < 1e-6);
});

test('CPU shared-pose skinning rotates normals with the pose', () => {
  const result = skinFixture({
    position: [0, 0, 0],
    normal: [1, 0, 0],
    bones: [new THREE.Matrix4().makeRotationZ(Math.PI / 2)],
  });
  assert.ok(Math.abs(result.normals[0]) < 1e-6);
  assert.ok(Math.abs(result.normals[1] - 1) < 1e-6);
  assert.ok(Math.abs(result.normals[2]) < 1e-6);
});

function validatedRigFixture({ indices = [0, 0, 0, 0], weights = [1, 0, 0, 0] } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex([0, 0, 0]);
  const bone = new THREE.Bone();
  bone.name = 'Root';
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  const soldier = new THREE.Group();
  soldier.add(mesh);
  const clips = {
    idle: new THREE.AnimationClip('idle', 0, [
      new THREE.VectorKeyframeTrack('Root.position', [0], [0, 0, 0]),
    ]),
  };
  return { soldier, sourceMesh: mesh, clips, fps: 30, formationCount: 1, bucketCount: 1 };
}

test('runtime audit accepts a finite, normalised, bounded infantry rig', () => {
  const result = validateInfantryRuntimeSource(validatedRigFixture());
  assert.equal(result.vertexCount, 1);
  assert.equal(result.boneCount, 1);
  assert.equal(result.totalFrames, 1);
  assert.equal(result.maxWeightError, 0);
});

test('runtime audit rejects a joint index outside the skeleton before GPU upload', () => {
  assert.throws(
    () => validateInfantryRuntimeSource(validatedRigFixture({ indices: [1, 0, 0, 0] })),
    /invalid joint 1 of 1/,
  );
});

test('runtime audit rejects malformed skin weights before GPU upload', () => {
  assert.throws(
    () => validateInfantryRuntimeSource(validatedRigFixture({ weights: [0.25, 0, 0, 0] })),
    /skin weights sum to 0\.250000/,
  );
});

test('runtime audit enforces the army-size circuit breaker', () => {
  assert.throws(
    () => validateInfantryRuntimeSource({
      ...validatedRigFixture(),
      formationCount: INFANTRY_RUNTIME_LIMITS.maxFormationCount + 1,
    }),
    /exceeds the safe/,
  );
});

test('runtime audit retains an explicit vertex ceiling', () => {
  const fixture = validatedRigFixture();
  const count = INFANTRY_RUNTIME_LIMITS.maxVertices + 1;
  fixture.sourceMesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  fixture.sourceMesh.geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  fixture.sourceMesh.geometry.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(new Uint8Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) weights[index * 4] = 1;
  fixture.sourceMesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  fixture.sourceMesh.geometry.setIndex([0, 0, 0]);
  assert.throws(() => validateInfantryRuntimeSource(fixture), /safe limit is 18,000/);
});

test('CPU bake records an animated upper-spine delta for rigid attachments', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint8BufferAttribute([0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0], 4));
  geometry.setIndex([0, 0, 0]);

  const root = new THREE.Bone();
  root.name = 'Root';
  const spine = new THREE.Bone();
  spine.name = 'Spine02';
  spine.position.y = 1;
  const rightHand = new THREE.Bone();
  rightHand.name = 'RightHand';
  const leftHand = new THREE.Bone();
  leftHand.name = 'LeftHand';
  root.add(spine);
  spine.add(rightHand, leftHand);

  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.add(root);
  mesh.bind(new THREE.Skeleton([root, spine, rightHand, leftHand]));
  const soldier = new THREE.Group();
  soldier.add(mesh);
  soldier.updateMatrixWorld(true);

  const quarterTurn = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 2,
  );
  const clips = {
    tpose: new THREE.AnimationClip('tpose', 0, []),
    walk: new THREE.AnimationClip('walk', 1, [
      new THREE.QuaternionKeyframeTrack(
        'Spine02.quaternion',
        [0, 0.5, 1],
        [0, 0, 0, 1, ...quarterTurn.toArray(), 0, 0, 0, 1],
      ),
    ]),
  };

  const animation = bakeCpuAnimationFrames({
    soldier,
    sourceMesh: mesh,
    clips,
    fps: 4,
  });
  assert.equal(animation.records.walk.upperBackDeltas.length, 4);
  const identity = new THREE.Matrix4();
  const animated = new THREE.Matrix4().fromArray(animation.records.walk.upperBackDeltas[2]);
  assert.ok(!animated.equals(identity), 'the attachment socket must move with the animated spine');
  assert.ok(Math.abs(animated.determinant() - 1) < 1e-5);
});

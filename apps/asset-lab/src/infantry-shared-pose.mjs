import * as THREE from 'three';

export const INFANTRY_RUNTIME_LIMITS = Object.freeze({
  // Meshy UV seams make the asymmetric Scrap Picker 16.3k runtime vertices
  // despite an 8.5k-triangle mesh. Keep modest headroom for that accepted
  // silhouette; the independent triangle and 128 MiB bake ceilings still fail
  // closed before any unbounded work reaches WebGPU.
  maxVertices: 18_000,
  maxTriangles: 30_000,
  maxBones: 64,
  maxClips: 8,
  maxTracksPerClip: 256,
  maxClipSeconds: 12,
  maxFramesPerClip: 360,
  maxBakedBytes: 128 * 1024 * 1024,
  // Stress-lab ceiling, not a promised in-game army budget. The HTML tool
  // reloads between count changes so each run starts with fresh GPU resources.
  maxFormationCount: 512,
  maxPoseBuckets: 4,
});

export function validateInfantryRuntimeSource({
  soldier,
  sourceMesh,
  clips,
  fps,
  formationCount = 1,
  bucketCount = 1,
  limits = INFANTRY_RUNTIME_LIMITS,
}) {
  if (!soldier?.isObject3D) throw new Error('Infantry source root is not a Three.js Object3D.');
  if (!sourceMesh?.isSkinnedMesh) throw new Error('Infantry source must contain exactly one SkinnedMesh.');
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) {
    throw new Error(`Infantry bake rate ${String(fps)} is outside the safe 1-60 fps range.`);
  }
  if (!Number.isInteger(formationCount) || formationCount < 1 || formationCount > limits.maxFormationCount) {
    throw new Error(`Infantry formation count ${String(formationCount)} exceeds the safe 1-${limits.maxFormationCount} range.`);
  }
  if (!Number.isInteger(bucketCount) || bucketCount < 1 || bucketCount > limits.maxPoseBuckets) {
    throw new Error(`Infantry pose bucket count ${String(bucketCount)} exceeds the safe 1-${limits.maxPoseBuckets} range.`);
  }

  const geometry = sourceMesh.geometry;
  const position = requiredAttribute(geometry, 'position', 3);
  const normal = requiredAttribute(geometry, 'normal', 3);
  const skinIndex = requiredAttribute(geometry, 'skinIndex', 4);
  const skinWeight = requiredAttribute(geometry, 'skinWeight', 4);
  const vertexCount = position.count;
  if (normal.count !== vertexCount || skinIndex.count !== vertexCount || skinWeight.count !== vertexCount) {
    throw new Error('Infantry position, normal, joint, and weight attribute counts do not match.');
  }
  if (vertexCount > limits.maxVertices) {
    throw new Error(`Infantry source has ${vertexCount.toLocaleString()} vertices; safe limit is ${limits.maxVertices.toLocaleString()}.`);
  }
  const triangles = geometry.index ? geometry.index.count / 3 : vertexCount / 3;
  if (!Number.isInteger(triangles) || triangles < 1 || triangles > limits.maxTriangles) {
    throw new Error(`Infantry source has an unsafe triangle count (${String(triangles)}).`);
  }

  const skeleton = sourceMesh.skeleton;
  const boneCount = skeleton?.bones?.length ?? 0;
  if (boneCount < 1 || boneCount > limits.maxBones) {
    throw new Error(`Infantry rig has ${boneCount} bones; safe limit is 1-${limits.maxBones}.`);
  }
  if (skeleton.boneInverses.length !== boneCount) {
    throw new Error('Infantry rig bone and inverse-bind counts do not match.');
  }
  assertFiniteArray('position', position.array);
  assertFiniteArray('normal', normal.array);
  assertFiniteMatrix('bind matrix', sourceMesh.bindMatrix);
  assertFiniteMatrix('inverse bind matrix', sourceMesh.bindMatrixInverse);
  skeleton.boneInverses.forEach((matrix, index) => assertFiniteMatrix(`inverse bind matrix ${index}`, matrix));

  let maxWeightError = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    let sum = 0;
    for (let influence = 0; influence < 4; influence++) {
      const joint = skinIndex.getComponent(vertex, influence);
      const weight = skinWeight.getComponent(vertex, influence);
      if (!Number.isInteger(joint) || joint < 0 || joint >= boneCount) {
        throw new Error(`Infantry vertex ${vertex} references invalid joint ${String(joint)} of ${boneCount}.`);
      }
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new Error(`Infantry vertex ${vertex} has invalid skin weight ${String(weight)}.`);
      }
      sum += weight;
    }
    const error = Math.abs(1 - sum);
    maxWeightError = Math.max(maxWeightError, error);
    if (error > 0.005) {
      throw new Error(`Infantry vertex ${vertex} skin weights sum to ${sum.toFixed(6)}, not 1.`);
    }
  }

  const clipEntries = Object.entries(clips ?? {});
  if (clipEntries.length < 1 || clipEntries.length > limits.maxClips) {
    throw new Error(`Infantry source has ${clipEntries.length} clips; safe limit is 1-${limits.maxClips}.`);
  }
  let totalFrames = 0;
  for (const [name, clip] of clipEntries) {
    if (!(clip instanceof THREE.AnimationClip)) {
      throw new Error(`Infantry clip "${name}" is not a Three.js AnimationClip.`);
    }
    if (!Number.isFinite(clip.duration) || clip.duration < 0 || clip.duration > limits.maxClipSeconds) {
      throw new Error(`Infantry clip "${name}" duration ${String(clip.duration)} is outside the safe range.`);
    }
    if (clip.tracks.length > limits.maxTracksPerClip) {
      throw new Error(`Infantry clip "${name}" has ${clip.tracks.length} tracks; safe limit is ${limits.maxTracksPerClip}.`);
    }
    for (const track of clip.tracks) {
      assertFiniteArray(`clip "${name}" times`, track.times);
      assertFiniteArray(`clip "${name}" values`, track.values);
      for (let index = 1; index < track.times.length; index++) {
        if (track.times[index] < track.times[index - 1]) {
          throw new Error(`Infantry clip "${name}" contains non-monotonic keyframe times.`);
        }
      }
    }
    const frameCount = Math.max(1, Math.ceil(Math.max(clip.duration, 1 / fps) * fps));
    if (frameCount > limits.maxFramesPerClip) {
      throw new Error(`Infantry clip "${name}" needs ${frameCount} frames; safe limit is ${limits.maxFramesPerClip}.`);
    }
    totalFrames += frameCount;
  }

  // Positions + normals are six f32 values per vertex. Hand sockets add six
  // values and the upper-back socket delta adds one 4x4 matrix per frame.
  const bakedBytes = totalFrames * ((vertexCount * 6 + 6 + 16) * Float32Array.BYTES_PER_ELEMENT);
  if (bakedBytes > limits.maxBakedBytes) {
    throw new Error(
      `Infantry animation bake needs ${(bakedBytes / 1024 / 1024).toFixed(1)} MiB; ` +
      `safe limit is ${(limits.maxBakedBytes / 1024 / 1024).toFixed(0)} MiB.`,
    );
  }

  return { vertexCount, triangles, boneCount, totalFrames, bakedBytes, maxWeightError };
}

export function bakeCpuAnimationFrames({
  soldier,
  sourceMesh,
  clips,
  fps,
  formationCount = 1,
  bucketCount = 1,
  requireAttachmentSockets = true,
}) {
  const audit = validateInfantryRuntimeSource({
    soldier,
    sourceMesh,
    clips,
    fps,
    formationCount,
    bucketCount,
  });
  const skeleton = sourceMesh.skeleton;
  const socketFallback = soldier.getObjectByName('Body') ?? sourceMesh;
  const rightHand = soldier.getObjectByName('RightHand') ?? (!requireAttachmentSockets ? socketFallback : null);
  const leftHand = soldier.getObjectByName('LeftHand') ?? (!requireAttachmentSockets ? socketFallback : null);
  if (!rightHand || !leftHand) throw new Error('A rig with modular props must expose RightHand and LeftHand sockets.');
  const upperBack = findUpperBackSocket(soldier) ?? (!requireAttachmentSockets ? socketFallback : null);
  if (!upperBack) {
    throw new Error('The rig must expose an upper-spine socket (Spine02, UpperChest, Chest, or Spine).');
  }

  // Props are authored in the normalised model's local coordinates. Applying
  // currentSocket * inverse(bindSocket) makes those vertices follow the torso
  // without adding another live skeleton or AnimationMixer per soldier.
  const referenceClip = clips.tpose ?? Object.values(clips)[0];
  const referenceMixer = new THREE.AnimationMixer(soldier);
  const referenceAction = referenceMixer.clipAction(referenceClip).reset().play();
  referenceMixer.setTime(0);
  soldier.updateMatrixWorld(true);
  const inverseUpperBackBind = upperBack.matrixWorld.clone().invert();
  assertFiniteMatrix('upper-back inverse bind matrix', inverseUpperBackBind);
  referenceAction.stop();
  referenceMixer.uncacheRoot(soldier);

  const records = {};
  const sourcePosition = sourceMesh.geometry.getAttribute('position');
  const sourceNormal = sourceMesh.geometry.getAttribute('normal');
  const skinIndex = sourceMesh.geometry.getAttribute('skinIndex');
  const skinWeight = sourceMesh.geometry.getAttribute('skinWeight');
  const meshMatrix = sourceMesh.matrixWorld.clone();
  const meshNormalMatrix = new THREE.Matrix3().getNormalMatrix(meshMatrix);
  for (const [name, clip] of Object.entries(clips)) {
    const count = Math.max(1, Math.ceil(Math.max(clip.duration, 1 / fps) * fps));
    const record = {
      count,
      positionFrames: [],
      normalFrames: [],
      rightHands: [],
      leftHands: [],
      upperBackDeltas: [],
    };
    records[name] = record;
    const mixer = new THREE.AnimationMixer(soldier);
    const action = mixer.clipAction(clip).reset().play();
    action.setLoop(THREE.LoopRepeat, Infinity);
    for (let frame = 0; frame < count; frame++) {
      const sampleTime = clip.duration > 0 ? (frame / count) * clip.duration : 0;
      mixer.setTime(sampleTime);
      soldier.updateMatrixWorld(true);
      skeleton.update();
      const baked = cpuSkinFrame({
        sourcePosition,
        sourceNormal,
        skinIndex,
        skinWeight,
        boneMatrices: skeleton.boneMatrices,
        bindMatrix: sourceMesh.bindMatrix,
        bindMatrixInverse: sourceMesh.bindMatrixInverse,
        meshMatrix,
        meshNormalMatrix,
      });
      record.positionFrames.push(baked.positions);
      record.normalFrames.push(baked.normals);
      record.rightHands.push(rightHand.getWorldPosition(new THREE.Vector3()));
      record.leftHands.push(leftHand.getWorldPosition(new THREE.Vector3()));
      const upperBackDelta = new THREE.Matrix4().multiplyMatrices(
        upperBack.matrixWorld,
        inverseUpperBackBind,
      );
      assertFiniteMatrix(`clip "${name}" upper-back delta ${frame}`, upperBackDelta);
      record.upperBackDeltas.push(Float32Array.from(upperBackDelta.elements));
    }
    action.stop();
    mixer.uncacheRoot(soldier);
  }
  return { records, fps, audit };
}

function findUpperBackSocket(root) {
  const preferredNames = ['Spine02', 'UpperChest', 'Chest', 'Spine01', 'Spine'];
  for (const name of preferredNames) {
    const exact = root.getObjectByName(name);
    if (exact?.isBone) return exact;
  }
  const preferred = new Set(preferredNames.map((name) => name.toLowerCase()));
  let fallback = null;
  root.traverse((node) => {
    if (!fallback && node.isBone && preferred.has(node.name.toLowerCase())) fallback = node;
  });
  return fallback;
}

export function cpuSkinFrame({
  sourcePosition,
  sourceNormal,
  skinIndex,
  skinWeight,
  boneMatrices,
  bindMatrix,
  bindMatrixInverse,
  meshMatrix,
  meshNormalMatrix,
}) {
  const positions = new Float32Array(sourcePosition.count * 3);
  const normals = new Float32Array(sourceNormal.count * 3);
  const vertex = new THREE.Vector4();
  const skinned = new THREE.Vector4();
  const weighted = new THREE.Vector4();
  const boneMatrix = new THREE.Matrix4();
  const blendedMatrix = new THREE.Matrix4();
  const normal = new THREE.Vector3();
  const indexVector = new THREE.Vector4();
  const weightVector = new THREE.Vector4();

  for (let index = 0; index < sourcePosition.count; index++) {
    vertex.set(sourcePosition.getX(index), sourcePosition.getY(index), sourcePosition.getZ(index), 1)
      .applyMatrix4(bindMatrix);
    indexVector.fromBufferAttribute(skinIndex, index);
    weightVector.fromBufferAttribute(skinWeight, index);
    skinned.set(0, 0, 0, 0);
    blendedMatrix.elements.fill(0);

    for (let influence = 0; influence < 4; influence++) {
      const weight = weightVector.getComponent(influence);
      if (weight <= 0) continue;
      const bone = Math.min(
        Math.max(Math.round(indexVector.getComponent(influence)), 0),
        boneMatrices.length / 16 - 1,
      );
      boneMatrix.fromArray(boneMatrices, bone * 16);
      weighted.copy(vertex).applyMatrix4(boneMatrix).multiplyScalar(weight);
      skinned.add(weighted);
      for (let element = 0; element < 16; element++) {
        blendedMatrix.elements[element] += boneMatrix.elements[element] * weight;
      }
    }

    skinned.applyMatrix4(bindMatrixInverse).applyMatrix4(meshMatrix);
    positions[index * 3] = skinned.x;
    positions[index * 3 + 1] = skinned.y;
    positions[index * 3 + 2] = skinned.z;

    normal.fromBufferAttribute(sourceNormal, index);
    blendedMatrix.premultiply(bindMatrixInverse).multiply(bindMatrix);
    normal.transformDirection(blendedMatrix).applyMatrix3(meshNormalMatrix).normalize();
    normals[index * 3] = normal.x;
    normals[index * 3 + 1] = normal.y;
    normals[index * 3 + 2] = normal.z;
  }

  return { positions, normals };
}

function requiredAttribute(geometry, name, itemSize) {
  const attribute = geometry?.getAttribute?.(name);
  if (!attribute || attribute.itemSize !== itemSize || attribute.count < 1) {
    throw new Error(`Infantry geometry requires a non-empty ${name}[${itemSize}] attribute.`);
  }
  return attribute;
}

function assertFiniteArray(label, values) {
  if (!values || typeof values.length !== 'number') throw new Error(`${label} is missing.`);
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) throw new Error(`${label} contains a non-finite value at ${index}.`);
  }
}

function assertFiniteMatrix(label, matrix) {
  if (!matrix?.elements || matrix.elements.length !== 16) throw new Error(`${label} is missing.`);
  assertFiniteArray(label, matrix.elements);
  const determinant = matrix.determinant();
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12 || Math.abs(determinant) > 1e12) {
    throw new Error(`${label} has an unsafe determinant (${String(determinant)}).`);
  }
}

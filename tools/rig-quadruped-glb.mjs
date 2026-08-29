/**
 * Add a compact, deterministic quadruped skin and clip set to a single-mesh GLB.
 * Meshy's public rigging endpoint supports humanoid bipeds only, so creatures
 * use this bounded local path instead of spending credits on an invalid rig.
 */
import { Accessor, NodeIO } from '@gltf-transform/core';
import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import path from 'node:path';

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  throw new Error('Usage: node tools/rig-quadruped-glb.mjs <input.glb> <output.glb>');
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
const io = new NodeIO();
const document = await io.read(input);
const root = document.getRoot();
const meshes = root.listMeshes();
if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) {
  throw new Error(`Expected one mesh/primitive, found ${meshes.length}/${meshes[0]?.listPrimitives().length ?? 0}`);
}
const meshNode = root.listNodes().find((node) => node.getMesh() === meshes[0]);
if (!meshNode) throw new Error('Could not find the mesh node.');
if (meshNode.getSkin()) throw new Error('Input is already skinned.');
const primitive = meshes[0].listPrimitives()[0];
const position = primitive.getAttribute('POSITION');
if (!position) throw new Error('Mesh has no POSITION attribute.');
const positions = position.getArray();
const vertexCount = position.getCount();

const min = new Vector3(Infinity, Infinity, Infinity);
const max = new Vector3(-Infinity, -Infinity, -Infinity);
const point = new Vector3();
for (let i = 0; i < positions.length; i += 3) {
  point.set(positions[i], positions[i + 1], positions[i + 2]);
  min.min(point);
  max.max(point);
}
const size = max.clone().sub(min);
const center = min.clone().addScaledVector(size, 0.5);
const at = (x, y, z) => [
  min.x + size.x * x,
  min.y + size.y * y,
  min.z + size.z * z,
];

const skeletonRoot = document.createNode('DogRig');
const body = document.createNode('Body').setTranslation(at(0.5, 0.56, 0.5));
const head = document.createNode('Head').setTranslation([0, size.y * 0.10, size.z * 0.25]);
const jaw = document.createNode('Jaw').setTranslation([0, -size.y * 0.10, size.z * 0.14]);
const tail = document.createNode('Tail').setTranslation([0, size.y * 0.03, -size.z * 0.30]);
// The fore shoulders sit higher than the rear hip on this mesh. Keeping the
// former rear-derived Y pivot folded the front paws around their wrists at the
// run extrema, producing the triangular "broken paw" silhouette.
const foreL = document.createNode('ForeLeg.L').setTranslation([-size.x * 0.25, 0, size.z * 0.18]);
const foreR = document.createNode('ForeLeg.R').setTranslation([size.x * 0.25, 0, size.z * 0.18]);
const hindL = document.createNode('HindLeg.L').setTranslation([-size.x * 0.25, -size.y * 0.12, -size.z * 0.24]);
const hindR = document.createNode('HindLeg.R').setTranslation([size.x * 0.25, -size.y * 0.12, -size.z * 0.24]);

skeletonRoot.addChild(body);
body.addChild(head).addChild(tail).addChild(foreL).addChild(foreR).addChild(hindL).addChild(hindR);
head.addChild(jaw);
root.listScenes()[0].addChild(skeletonRoot);

const joints = [body, head, jaw, tail, foreL, foreR, hindL, hindR];
const jointIndex = Object.fromEntries(joints.map((joint, index) => [joint.getName(), index]));
const skin = document.createSkin('AttackDogRig').setSkeleton(skeletonRoot);
for (const joint of joints) skin.addJoint(joint);
const buffer = root.listBuffers()[0];
const inverseBindArray = new Float32Array(joints.length * 16);
for (let i = 0; i < joints.length; i++) {
  new Matrix4().fromArray(joints[i].getWorldMatrix()).invert().toArray(inverseBindArray, i * 16);
}
skin.setInverseBindMatrices(document.createAccessor('InverseBindMatrices', buffer)
  .setType(Accessor.Type.MAT4)
  .setArray(inverseBindArray));
meshNode.setSkin(skin).setName('mesh_node');

const jointArray = new Uint8Array(vertexCount * 4);
const weightArray = new Float32Array(vertexCount * 4);
const setWeights = (vertex, primary, primaryWeight = 1, secondary = primary) => {
  const offset = vertex * 4;
  jointArray[offset] = primary;
  weightArray[offset] = primaryWeight;
  jointArray[offset + 1] = secondary;
  weightArray[offset + 1] = 1 - primaryWeight;
};

const BODY = jointIndex.Body;
for (let i = 0; i < vertexCount; i++) {
  const x = positions[i * 3];
  const y = positions[i * 3 + 1];
  const z = positions[i * 3 + 2];
  const nx = (x - center.x) / (size.x * 0.5);
  const ny = (y - min.y) / size.y;
  const nz = (z - min.z) / size.z;
  // Resolve forward head/jaw masses before limbs. The muzzle overlaps the
  // fore-leg X/Y envelope and was the source of the rejected first rig.
  const isJaw = nz >= 0.78 && ny >= 0.34 && ny <= 0.54 && Math.abs(nx) <= 0.62;
  if (isJaw) {
    setWeights(i, jointIndex.Jaw, 0.88, jointIndex.Head);
    continue;
  }
  if (nz >= 0.67 && ny >= 0.43) {
    const headWeight = MathUtils.clamp((nz - 0.62) / 0.16, 0.35, 1);
    setWeights(i, jointIndex.Head, headWeight, BODY);
    continue;
  }
  if (nz <= 0.14 && ny >= 0.43 && ny <= 0.72 && Math.abs(nx) <= 0.52) {
    const tailWeight = MathUtils.clamp((0.20 - nz) / 0.14, 0.35, 1);
    setWeights(i, jointIndex.Tail, tailWeight, BODY);
    continue;
  }
  // Use a continuous anatomical field for each foreleg. Hard X/Z cutoffs left
  // adjacent vertices of the same paw triangle on different joints, which is
  // what produced the long spikes in the rejected rig. The lower paw core is
  // rigid (affinity 1); only the shoulder perimeter fades into Body.
  const foreSide = MathUtils.smoothstep(Math.abs(nx), 0.10, 0.25);
  const foreLength = 1 - MathUtils.smoothstep(Math.abs(nz - 0.60), 0.14, 0.24);
  const foreHeight = 1 - MathUtils.smoothstep(ny, 0.48, 0.62);
  const foreAffinity = foreSide * foreLength * foreHeight;
  const isHindLeg = ny <= 0.58 && Math.abs(nx) >= 0.24 && nz <= 0.41;
  if (foreAffinity > 0.001) {
    const name = nx < 0 ? 'ForeLeg.L' : 'ForeLeg.R';
    setWeights(i, jointIndex[name], foreAffinity, BODY);
    continue;
  }
  if (isHindLeg) {
    const left = nx < 0;
    const name = left ? 'HindLeg.L' : 'HindLeg.R';
    const legWeight = MathUtils.clamp((0.64 - ny) / 0.18, 0.22, 1);
    setWeights(i, jointIndex[name], legWeight, BODY);
    continue;
  }
  setWeights(i, BODY);
}

primitive.setAttribute('JOINTS_0', document.createAccessor('DogJoints', buffer)
  .setType(Accessor.Type.VEC4)
  .setArray(jointArray));
primitive.setAttribute('WEIGHTS_0', document.createAccessor('DogWeights', buffer)
  .setType(Accessor.Type.VEC4)
  .setArray(weightArray));

const axisX = new Vector3(1, 0, 0);
const axisY = new Vector3(0, 1, 0);
const quaternionValues = (angles, axis) => {
  const values = new Float32Array(angles.length * 4);
  for (let i = 0; i < angles.length; i++) {
    new Quaternion().setFromAxisAngle(axis, angles[i]).normalize().toArray(values, i * 4);
  }
  return values;
};
const translationValues = (base, offsets) => {
  const values = new Float32Array(offsets.length * 3);
  for (let i = 0; i < offsets.length; i++) {
    values[i * 3] = base[0] + offsets[i][0];
    values[i * 3 + 1] = base[1] + offsets[i][1];
    values[i * 3 + 2] = base[2] + offsets[i][2];
  }
  return values;
};
const addClip = (name, times, tracks) => {
  const animation = document.createAnimation(name);
  const inputAccessor = document.createAccessor(`${name}.times`, buffer)
    .setType(Accessor.Type.SCALAR)
    .setArray(new Float32Array(times));
  for (const track of tracks) {
    const outputAccessor = document.createAccessor(`${name}.${track.node.getName()}.${track.path}`, buffer)
      .setType(track.path === 'rotation' ? Accessor.Type.VEC4 : Accessor.Type.VEC3)
      .setArray(track.values);
    const sampler = document.createAnimationSampler(`${name}.${track.node.getName()}`)
      .setInput(inputAccessor)
      .setOutput(outputAccessor)
      .setInterpolation('LINEAR');
    const channel = document.createAnimationChannel(`${name}.${track.node.getName()}`)
      .setTargetNode(track.node)
      .setTargetPath(track.path)
      .setSampler(sampler);
    animation.addSampler(sampler).addChannel(channel);
  }
};
const rot = (node, angles, axis = axisX) => ({ node, path: 'rotation', values: quaternionValues(angles, axis) });
const move = (node, offsets) => ({ node, path: 'translation', values: translationValues(node.getTranslation(), offsets) });

addClip('Idle', [0, 0.5, 1, 1.5, 2], [
  move(body, [[0, 0, 0], [0, 0.012, 0], [0, 0, 0], [0, -0.006, 0], [0, 0, 0]]),
  rot(head, [0, -0.035, 0.015, 0.045, 0]),
  rot(tail, [0, 0.16, 0, -0.16, 0], axisY),
]);
const walk = [0.38, 0, -0.38, 0, 0.38];
const walkOpposite = walk.map((value) => -value);
const walkFore = [0.30, 0, -0.30, 0, 0.30];
const walkForeOpposite = walkFore.map((value) => -value);
addClip('Walk', [0, 0.25, 0.5, 0.75, 1], [
  move(body, [[0, 0, 0], [0, 0.022, 0], [0, 0, 0], [0, 0.022, 0], [0, 0, 0]]),
  rot(foreL, walkFore), rot(hindR, walk), rot(foreR, walkForeOpposite), rot(hindL, walkOpposite),
  rot(head, [-0.035, 0.045, -0.035, 0.045, -0.035]),
  rot(tail, [0, 0.24, 0, -0.24, 0], axisY),
]);
const run = [0.68, 0, -0.68, 0, 0.68];
const runOpposite = run.map((value) => -value);
const runFore = [0.50, 0, -0.50, 0, 0.50];
const runForeOpposite = runFore.map((value) => -value);
addClip('Run', [0, 0.16, 0.32, 0.48, 0.64], [
  move(body, [[0, 0, 0], [0, 0.045, 0.02], [0, 0, 0], [0, 0.045, 0.02], [0, 0, 0]]),
  rot(foreL, runFore), rot(hindR, run), rot(foreR, runForeOpposite), rot(hindL, runOpposite),
  rot(head, [-0.09, 0.07, -0.09, 0.07, -0.09]),
  rot(tail, [0, 0.30, 0, -0.30, 0], axisY),
]);
addClip('Bite', [0, 0.12, 0.28, 0.46, 0.62, 0.8], [
  move(body, [[0, 0, 0], [0, 0, 0.025], [0, -0.018, 0.09], [0, 0.006, 0.12], [0, 0, 0.035], [0, 0, 0]]),
  rot(head, [0, -0.10, 0.08, 0.18, -0.04, 0]),
  rot(jaw, [0, 0.08, 0.42, 0.52, 0.10, 0]),
  rot(foreL, [0, -0.08, -0.15, -0.07, 0, 0]),
  rot(foreR, [0, -0.08, -0.15, -0.07, 0, 0]),
]);

await io.write(output, document);
console.log(JSON.stringify({
  input,
  output,
  vertices: vertexCount,
  joints: joints.map((joint) => joint.getName()),
  animations: root.listAnimations().map((animation) => animation.getName()),
  bounds: { min: min.toArray(), max: max.toArray() },
}, null, 2));

#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const inputArg = args[0];
const outputArg = args[1];
const rankIndex = args.indexOf('--component-rank');
const componentRank = rankIndex >= 0 ? Number(args[rankIndex + 1]) : NaN;
const rotationIndex = args.indexOf('--rotation-y-deg');
const rotationYDeg = rotationIndex >= 0 ? Number(args[rotationIndex + 1]) : 180;
const translationIndex = args.indexOf('--translate');
const translation = translationIndex >= 0
  ? args[translationIndex + 1]?.split(',').map(Number)
  : [0, 0, 0];

if (
  !inputArg || !outputArg || !Number.isInteger(componentRank) || componentRank < 1
  || !Number.isFinite(rotationYDeg)
  || translation?.length !== 3 || translation.some((value) => !Number.isFinite(value))
) {
  throw new Error(
    'usage: node tools/rotate-glb-component.mjs <input.glb> <output.glb> '
    + '--component-rank <1-based rank by triangle count> '
    + '[--rotation-y-deg <degrees>] [--translate <x,y,z>]',
  );
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
if (input === output) throw new Error('input and output must differ');

const bytes = await fs.readFile(input);
if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
  throw new Error('component rotation requires a glTF 2.0 binary');
}

const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
if (json.meshes?.length !== 1 || json.meshes[0].primitives?.length !== 1) {
  throw new Error('component rotation requires one mesh and one primitive');
}
const nodes = (json.nodes ?? []).filter((node) => node.mesh === 0);
if (nodes.length !== 1) throw new Error('component rotation requires one mesh node');
const node = nodes[0];
const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const matrixIsIdentity = node.matrix === undefined
  || node.matrix.every((value, index) => Math.abs(value - identityMatrix[index]) < 1e-8);
const translationIsIdentity = node.translation === undefined || node.translation.every((value) => Math.abs(value) < 1e-8);
const rotationIsIdentity = node.rotation === undefined
  || node.rotation.every((value, index) => Math.abs(value - (index === 3 ? 1 : 0)) < 1e-8);
const scaleIsIdentity = node.scale === undefined || node.scale.every((value) => Math.abs(value - 1) < 1e-8);
if (!matrixIsIdentity || !translationIsIdentity || !rotationIsIdentity || !scaleIsIdentity) {
  throw new Error('apply the mesh node transform before rotating a connected component');
}

const binaryHeader = 20 + jsonLength;
if (bytes.readUInt32LE(binaryHeader + 4) !== 0x004e4942) throw new Error('GLB has no binary chunk');
const binaryOffset = binaryHeader + 8;
const binaryLength = bytes.readUInt32LE(binaryHeader);
const binary = bytes.subarray(binaryOffset, binaryOffset + binaryLength);
const primitive = json.meshes[0].primitives[0];

function accessorReader(accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const bytesPerComponent = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  if (!components || !bytesPerComponent) throw new Error(`unsupported accessor ${accessorIndex}`);
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? components * bytesPerComponent;
  const address = (entry, component = 0) => offset + entry * stride + component * bytesPerComponent;
  const read = (entry, component = 0) => {
    const at = address(entry, component);
    if (accessor.componentType === 5126) return binary.readFloatLE(at);
    if (accessor.componentType === 5125) return binary.readUInt32LE(at);
    if (accessor.componentType === 5123) return binary.readUInt16LE(at);
    return binary.readUInt8(at);
  };
  const writeFloat = (entry, component, value) => {
    if (accessor.componentType !== 5126) throw new Error(`accessor ${accessorIndex} is not float data`);
    binary.writeFloatLE(value, address(entry, component));
  };
  return { accessor, read, writeFloat };
}

const position = accessorReader(primitive.attributes.POSITION);
const indices = accessorReader(primitive.indices);
if (position.accessor.componentType !== 5126 || position.accessor.type !== 'VEC3') {
  throw new Error('component rotation requires float VEC3 positions');
}

const parent = new Int32Array(position.accessor.count);
const rank = new Uint8Array(position.accessor.count);
for (let index = 0; index < parent.length; index++) parent[index] = index;
const find = (value) => {
  let root = value;
  while (parent[root] !== root) root = parent[root];
  while (parent[value] !== value) {
    const next = parent[value];
    parent[value] = root;
    value = next;
  }
  return root;
};
const union = (a, b) => {
  let rootA = find(a);
  let rootB = find(b);
  if (rootA === rootB) return;
  if (rank[rootA] < rank[rootB]) [rootA, rootB] = [rootB, rootA];
  parent[rootB] = rootA;
  if (rank[rootA] === rank[rootB]) rank[rootA]++;
};

// UV and normal seams duplicate vertices at identical positions. Weld those
// duplicates for component discovery without altering the authored mesh.
const coincident = new Map();
const quantize = (value) => Math.round(value * 100_000);
for (let vertex = 0; vertex < position.accessor.count; vertex++) {
  const key = `${quantize(position.read(vertex, 0))},${quantize(position.read(vertex, 1))},${quantize(position.read(vertex, 2))}`;
  const prior = coincident.get(key);
  if (prior === undefined) coincident.set(key, vertex);
  else union(prior, vertex);
}
for (let offset = 0; offset < indices.accessor.count; offset += 3) {
  const a = indices.read(offset);
  const b = indices.read(offset + 1);
  const c = indices.read(offset + 2);
  union(a, b);
  union(b, c);
}

const components = new Map();
for (let offset = 0; offset < indices.accessor.count; offset += 3) {
  const vertices = [indices.read(offset), indices.read(offset + 1), indices.read(offset + 2)];
  const root = find(vertices[0]);
  let component = components.get(root);
  if (!component) {
    component = { root, triangles: 0, vertices: new Set(), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    components.set(root, component);
  }
  component.triangles++;
  for (const vertex of vertices) {
    component.vertices.add(vertex);
    for (let axis = 0; axis < 3; axis++) {
      const value = position.read(vertex, axis);
      component.min[axis] = Math.min(component.min[axis], value);
      component.max[axis] = Math.max(component.max[axis], value);
    }
  }
}
const ordered = [...components.values()].sort((a, b) => b.triangles - a.triangles);
const selected = ordered[componentRank - 1];
if (!selected) throw new Error(`component rank ${componentRank} exceeds component count ${ordered.length}`);
const centre = selected.min.map((value, axis) => (value + selected.max[axis]) / 2);
const rotationY = rotationYDeg * Math.PI / 180;
const cosY = Math.cos(rotationY);
const sinY = Math.sin(rotationY);

for (const vertex of selected.vertices) {
  const localX = position.read(vertex, 0) - centre[0];
  const localZ = position.read(vertex, 2) - centre[2];
  position.writeFloat(vertex, 0, centre[0] + localX * cosY + localZ * sinY + translation[0]);
  position.writeFloat(vertex, 1, position.read(vertex, 1) + translation[1]);
  position.writeFloat(vertex, 2, centre[2] - localX * sinY + localZ * cosY + translation[2]);
}
for (const semantic of ['NORMAL', 'TANGENT']) {
  const accessorIndex = primitive.attributes[semantic];
  if (accessorIndex === undefined) continue;
  const attribute = accessorReader(accessorIndex);
  for (const vertex of selected.vertices) {
    const x = attribute.read(vertex, 0);
    const z = attribute.read(vertex, 2);
    attribute.writeFloat(vertex, 0, x * cosY + z * sinY);
    attribute.writeFloat(vertex, 2, -x * sinY + z * cosY);
  }
}

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let vertex = 0; vertex < position.accessor.count; vertex++) {
  for (let axis = 0; axis < 3; axis++) {
    const value = position.read(vertex, axis);
    min[axis] = Math.min(min[axis], value);
    max[axis] = Math.max(max[axis], value);
  }
}
position.accessor.min = min;
position.accessor.max = max;

let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
const jsonPadding = (4 - jsonBytes.length % 4) % 4;
if (jsonPadding > 0) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
const binaryPadding = (4 - binary.length % 4) % 4;
const paddedBinary = binaryPadding === 0 ? binary : Buffer.concat([binary, Buffer.alloc(binaryPadding)]);
const outputBytes = Buffer.allocUnsafe(12 + 8 + jsonBytes.length + 8 + paddedBinary.length);
outputBytes.writeUInt32LE(0x46546c67, 0);
outputBytes.writeUInt32LE(2, 4);
outputBytes.writeUInt32LE(outputBytes.length, 8);
outputBytes.writeUInt32LE(jsonBytes.length, 12);
outputBytes.writeUInt32LE(0x4e4f534a, 16);
jsonBytes.copy(outputBytes, 20);
const outputBinaryHeader = 20 + jsonBytes.length;
outputBytes.writeUInt32LE(paddedBinary.length, outputBinaryHeader);
outputBytes.writeUInt32LE(0x004e4942, outputBinaryHeader + 4);
paddedBinary.copy(outputBytes, outputBinaryHeader + 8);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, outputBytes);

console.log(JSON.stringify({
  input,
  output,
  componentRank,
  componentCount: ordered.length,
  triangles: selected.triangles,
  triangleShare: Number((selected.triangles / (indices.accessor.count / 3) * 100).toFixed(2)),
  centre,
  boundsBefore: { min: selected.min, max: selected.max },
  rotationYDeg,
  translation,
}, null, 2));

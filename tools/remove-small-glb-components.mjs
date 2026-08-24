#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const [inputArg, outputArg, thresholdArg = '12'] = process.argv.slice(2);
const threshold = Number(thresholdArg);
if (!inputArg || !outputArg || !Number.isInteger(threshold) || threshold < 0) {
  throw new Error('usage: node tools/remove-small-glb-components.mjs <input.glb> <output.glb> [max-triangles]');
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
if (input === output) throw new Error('input and output must differ so the source remains recoverable');

const source = await fs.readFile(input);
if (source.readUInt32LE(0) !== 0x46546c67 || source.readUInt32LE(4) !== 2) {
  throw new Error('input is not a glTF 2.0 binary');
}

const jsonLength = source.readUInt32LE(12);
const document = JSON.parse(source.subarray(20, 20 + jsonLength).toString('utf8').trim());
if (document.meshes?.length !== 1 || document.meshes[0].primitives?.length !== 1) {
  throw new Error('component cleanup requires exactly one mesh and one primitive');
}

const binaryHeader = 20 + jsonLength;
if (source.readUInt32LE(binaryHeader + 4) !== 0x004e4942) throw new Error('GLB has no binary chunk');
const binaryLength = source.readUInt32LE(binaryHeader);
const binary = Buffer.from(source.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength));
const primitive = document.meshes[0].primitives[0];

function accessorReader(accessorIndex) {
  const accessor = document.accessors[accessorIndex];
  const view = document.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const bytesPerComponent = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  if (components === undefined || bytesPerComponent === undefined) throw new Error('unsupported accessor');
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? components * bytesPerComponent;
  const read = (entry, component = 0) => {
    const at = offset + entry * stride + component * bytesPerComponent;
    if (accessor.componentType === 5126) return binary.readFloatLE(at);
    if (accessor.componentType === 5125) return binary.readUInt32LE(at);
    if (accessor.componentType === 5123) return binary.readUInt16LE(at);
    return binary.readUInt8(at);
  };
  const writeScalar = (entry, value) => {
    const at = offset + entry * stride;
    if (accessor.componentType === 5125) binary.writeUInt32LE(value, at);
    else if (accessor.componentType === 5123) binary.writeUInt16LE(value, at);
    else if (accessor.componentType === 5121) binary.writeUInt8(value, at);
    else throw new Error('indices must use an unsigned integer component type');
  };
  return { accessor, read, writeScalar };
}

const positionReader = accessorReader(primitive.attributes.POSITION);
const indexReader = accessorReader(primitive.indices);
const vertexCount = positionReader.accessor.count;
const parent = new Int32Array(vertexCount);
const rank = new Uint8Array(vertexCount);
for (let i = 0; i < vertexCount; i++) parent[i] = i;

function find(value) {
  let root = value;
  while (parent[root] !== root) root = parent[root];
  while (parent[value] !== value) {
    const next = parent[value];
    parent[value] = root;
    value = next;
  }
  return root;
}

function union(a, b) {
  let rootA = find(a);
  let rootB = find(b);
  if (rootA === rootB) return;
  if (rank[rootA] < rank[rootB]) [rootA, rootB] = [rootB, rootA];
  parent[rootB] = rootA;
  if (rank[rootA] === rank[rootB]) rank[rootA]++;
}

// Mesh exports duplicate coincident vertices across UV and normal seams. Weld
// only for component discovery; the delivery vertex attributes remain intact.
const coincident = new Map();
const quantize = (value) => Math.round(value * 100_000);
for (let i = 0; i < vertexCount; i++) {
  const key = `${quantize(positionReader.read(i, 0))},${quantize(positionReader.read(i, 1))},${quantize(positionReader.read(i, 2))}`;
  const prior = coincident.get(key);
  if (prior === undefined) coincident.set(key, i);
  else union(prior, i);
}

for (let i = 0; i < indexReader.accessor.count; i += 3) {
  const a = indexReader.read(i);
  const b = indexReader.read(i + 1);
  const c = indexReader.read(i + 2);
  union(a, b);
  union(b, c);
}

const componentTriangles = new Map();
for (let i = 0; i < indexReader.accessor.count; i += 3) {
  const root = find(indexReader.read(i));
  componentTriangles.set(root, (componentTriangles.get(root) ?? 0) + 1);
}

const removed = [...componentTriangles.entries()]
  .filter(([, triangles]) => triangles <= threshold)
  .map(([root, triangles]) => ({ root, triangles }));
if (removed.length === 0) throw new Error(`no connected component has ${threshold} triangles or fewer`);
const removedRoots = new Set(removed.map(({ root }) => root));

const keptIndices = [];
for (let i = 0; i < indexReader.accessor.count; i += 3) {
  if (removedRoots.has(find(indexReader.read(i)))) continue;
  keptIndices.push(indexReader.read(i), indexReader.read(i + 1), indexReader.read(i + 2));
}
for (let i = 0; i < keptIndices.length; i++) indexReader.writeScalar(i, keptIndices[i]);
indexReader.accessor.count = keptIndices.length;
if (indexReader.accessor.min !== undefined || indexReader.accessor.max !== undefined) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const index of keptIndices) {
    minimum = Math.min(minimum, index);
    maximum = Math.max(maximum, index);
  }
  if (indexReader.accessor.min !== undefined) indexReader.accessor.min = [minimum];
  if (indexReader.accessor.max !== undefined) indexReader.accessor.max = [maximum];
}

const jsonBytes = Buffer.from(JSON.stringify(document), 'utf8');
const paddedJsonLength = Math.ceil(jsonBytes.length / 4) * 4;
const paddedJson = Buffer.alloc(paddedJsonLength, 0x20);
jsonBytes.copy(paddedJson);
const paddedBinaryLength = Math.ceil(binary.length / 4) * 4;
const paddedBinary = Buffer.alloc(paddedBinaryLength);
binary.copy(paddedBinary);
const totalLength = 12 + 8 + paddedJson.length + 8 + paddedBinary.length;
const result = Buffer.alloc(totalLength);
result.writeUInt32LE(0x46546c67, 0);
result.writeUInt32LE(2, 4);
result.writeUInt32LE(totalLength, 8);
result.writeUInt32LE(paddedJson.length, 12);
result.writeUInt32LE(0x4e4f534a, 16);
paddedJson.copy(result, 20);
const resultBinaryHeader = 20 + paddedJson.length;
result.writeUInt32LE(paddedBinary.length, resultBinaryHeader);
result.writeUInt32LE(0x004e4942, resultBinaryHeader + 4);
paddedBinary.copy(result, resultBinaryHeader + 8);

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, result);
console.log(JSON.stringify({
  input,
  output,
  threshold,
  componentsBefore: componentTriangles.size,
  removed,
  trianglesBefore: indexReader.accessor.count / 3 + removed.reduce((sum, entry) => sum + entry.triangles, 0),
  trianglesAfter: indexReader.accessor.count / 3,
}, null, 2));

#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import * as THREE from 'three';

const inputArg = process.argv[2];
if (!inputArg) throw new Error('usage: node tools/analyze-glb-components.mjs <input.glb>');

const input = path.resolve(inputArg);
const bytes = await fs.readFile(input);
if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
  throw new Error('component analysis requires a glTF 2.0 binary');
}
const jsonLength = bytes.readUInt32LE(12);
const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
if (document.meshes?.length !== 1 || document.meshes[0].primitives?.length !== 1) {
  throw new Error('component analysis requires one mesh and one primitive');
}
const node = (document.nodes ?? []).find((entry) => entry.mesh === 0);
const binaryHeader = 20 + jsonLength;
if (bytes.readUInt32LE(binaryHeader + 4) !== 0x004e4942) throw new Error('GLB has no binary chunk');
const binary = bytes.subarray(binaryHeader + 8, binaryHeader + 8 + bytes.readUInt32LE(binaryHeader));
const primitive = document.meshes[0].primitives[0];

function accessorReader(accessorIndex) {
  const accessor = document.accessors[accessorIndex];
  const view = document.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const bytesPerComponent = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? components * bytesPerComponent;
  const read = (entry, component = 0) => {
    const at = offset + entry * stride + component * bytesPerComponent;
    if (accessor.componentType === 5126) return binary.readFloatLE(at);
    if (accessor.componentType === 5125) return binary.readUInt32LE(at);
    if (accessor.componentType === 5123) return binary.readUInt16LE(at);
    return binary.readUInt8(at);
  };
  return { accessor, read };
}

const positionReader = accessorReader(primitive.attributes.POSITION);
const indexReader = accessorReader(primitive.indices);
const nodeMatrix = new THREE.Matrix4();
if (node?.matrix !== undefined) {
  nodeMatrix.fromArray(node.matrix);
} else {
  nodeMatrix.compose(
    new THREE.Vector3(...(node?.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(node?.rotation ?? [0, 0, 0, 1])),
    new THREE.Vector3(...(node?.scale ?? [1, 1, 1])),
  );
}
const transformedPositions = new Float32Array(positionReader.accessor.count * 3);
const transformedPoint = new THREE.Vector3();
for (let entry = 0; entry < positionReader.accessor.count; entry++) {
  transformedPoint.set(
    positionReader.read(entry, 0),
    positionReader.read(entry, 1),
    positionReader.read(entry, 2),
  ).applyMatrix4(nodeMatrix);
  transformedPositions[entry * 3] = transformedPoint.x;
  transformedPositions[entry * 3 + 1] = transformedPoint.y;
  transformedPositions[entry * 3 + 2] = transformedPoint.z;
}
const position = {
  count: positionReader.accessor.count,
  getX: (entry) => transformedPositions[entry * 3],
  getY: (entry) => transformedPositions[entry * 3 + 1],
  getZ: (entry) => transformedPositions[entry * 3 + 2],
};
const index = {
  count: indexReader.accessor.count,
  getX: (entry) => indexReader.read(entry),
};

const parent = new Int32Array(position.count);
const rank = new Uint8Array(position.count);
for (let i = 0; i < parent.length; i++) parent[i] = i;

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

// Meshy often duplicates vertices across UV or normal seams. Exact position
// welding keeps those seams from masquerading as separate physical shells.
const coincident = new Map();
const quantize = (value) => Math.round(value * 100_000);
for (let i = 0; i < position.count; i++) {
  const key = `${quantize(position.getX(i))},${quantize(position.getY(i))},${quantize(position.getZ(i))}`;
  const prior = coincident.get(key);
  if (prior === undefined) coincident.set(key, i);
  else union(prior, i);
}

for (let i = 0; i < index.count; i += 3) {
  const a = index.getX(i);
  const b = index.getX(i + 1);
  const c = index.getX(i + 2);
  union(a, b);
  union(b, c);
}

const components = new Map();
for (let i = 0; i < index.count; i += 3) {
  const a = index.getX(i);
  const root = find(a);
  let component = components.get(root);
  if (component === undefined) {
    component = {
      root,
      triangles: 0,
      min: new THREE.Vector3(Infinity, Infinity, Infinity),
      max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
    };
    components.set(root, component);
  }
  component.triangles++;
  for (let corner = 0; corner < 3; corner++) {
    const vertex = index.getX(i + corner);
    component.min.min(new THREE.Vector3(position.getX(vertex), position.getY(vertex), position.getZ(vertex)));
    component.max.max(new THREE.Vector3(position.getX(vertex), position.getY(vertex), position.getZ(vertex)));
  }
}

const bounds = new THREE.Box3();
for (let entry = 0; entry < position.count; entry++) {
  bounds.expandByPoint(new THREE.Vector3(position.getX(entry), position.getY(entry), position.getZ(entry)));
}
const rows = [...components.values()]
  .map((component) => {
    const size = component.max.clone().sub(component.min);
    const centre = component.min.clone().add(component.max).multiplyScalar(0.5);
    return {
      root: component.root,
      triangles: component.triangles,
      share: Number((component.triangles / (index.count / 3) * 100).toFixed(2)),
      min: component.min.toArray().map((value) => Number(value.toFixed(4))),
      max: component.max.toArray().map((value) => Number(value.toFixed(4))),
      size: size.toArray().map((value) => Number(value.toFixed(4))),
      centre: centre.toArray().map((value) => Number(value.toFixed(4))),
    };
  })
  .sort((a, b) => b.triangles - a.triangles);

const histogramBins = 24;
const histogram = Array.from({ length: histogramBins }, (_, bin) => ({
  bin,
  triangles: 0,
  minY: bounds.min.y + (bounds.max.y - bounds.min.y) * bin / histogramBins,
  maxY: bounds.min.y + (bounds.max.y - bounds.min.y) * (bin + 1) / histogramBins,
}));
for (let i = 0; i < index.count; i += 3) {
  const centreY = (
    position.getY(index.getX(i))
    + position.getY(index.getX(i + 1))
    + position.getY(index.getX(i + 2))
  ) / 3;
  const normalized = (centreY - bounds.min.y) / (bounds.max.y - bounds.min.y);
  const bin = Math.min(histogramBins - 1, Math.max(0, Math.floor(normalized * histogramBins)));
  histogram[bin].triangles++;
}

const sliceRanges = [
  [-0.05, 0.20],
  [0.20, 0.45],
  [0.45, 0.70],
  [0.70, 0.96],
];
const sliceMaps = sliceRanges.map(([minY, maxY]) => {
  const columns = 40;
  const rowsCount = 28;
  const cells = new Uint32Array(columns * rowsCount);
  for (let i = 0; i < index.count; i += 3) {
    const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const x = vertices.reduce((sum, vertex) => sum + position.getX(vertex), 0) / 3;
    const y = vertices.reduce((sum, vertex) => sum + position.getY(vertex), 0) / 3;
    const z = vertices.reduce((sum, vertex) => sum + position.getZ(vertex), 0) / 3;
    if (y < minY || y >= maxY) continue;
    const column = Math.min(columns - 1, Math.max(0, Math.floor((x - bounds.min.x) / (bounds.max.x - bounds.min.x) * columns)));
    const row = Math.min(rowsCount - 1, Math.max(0, Math.floor((bounds.max.z - z) / (bounds.max.z - bounds.min.z) * rowsCount)));
    cells[row * columns + column]++;
  }
  const ramp = ' .:-=+*#%@';
  const maxCount = Math.max(...cells);
  const lines = [];
  for (let row = 0; row < rowsCount; row++) {
    let line = '';
    for (let column = 0; column < columns; column++) {
      const count = cells[row * columns + column];
      const normalized = maxCount === 0 ? 0 : Math.log1p(count) / Math.log1p(maxCount);
      line += ramp[Math.round(normalized * (ramp.length - 1))];
    }
    lines.push(line);
  }
  return { minY, maxY, triangles: cells.reduce((sum, count) => sum + count, 0), map: lines };
});

console.log(JSON.stringify({
  file: input,
  vertices: position.count,
  triangles: index.count / 3,
  bounds: bounds === null ? null : {
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: bounds.getSize(new THREE.Vector3()).toArray(),
  },
  componentCount: rows.length,
  verticalTriangleHistogram: histogram.map((entry) => ({
    ...entry,
    minY: Number(entry.minY.toFixed(4)),
    maxY: Number(entry.maxY.toFixed(4)),
  })),
  horizontalSliceMaps: sliceMaps,
  components: rows,
}, null, 2));

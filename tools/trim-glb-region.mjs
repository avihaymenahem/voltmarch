#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const inputArg = args[0];
const outputArg = args[1];
const aboveY = value('--remove-above-y');
const boxes = args.flatMap((arg, index) => {
  if (arg !== '--remove-box') return [];
  const values = args[index + 1]?.split(',').map(Number);
  if (values?.length !== 6 || values.some((entry) => !Number.isFinite(entry))) {
    throw new Error('--remove-box requires minX,minY,minZ,maxX,maxY,maxZ');
  }
  return [values];
});

if (!inputArg || !outputArg || (aboveY === undefined && boxes.length === 0)) {
  throw new Error(
    'usage: node tools/trim-glb-region.mjs <input.glb> <output.glb> '
    + '[--remove-above-y <y>] [--remove-box minX,minY,minZ,maxX,maxY,maxZ]',
  );
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
if (input === output) throw new Error('input and output must differ');
const removeAboveY = aboveY === undefined ? Infinity : Number(aboveY);
if (aboveY !== undefined && !Number.isFinite(removeAboveY)) {
  throw new Error('--remove-above-y must be finite');
}

const bytes = await fs.readFile(input);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

/**
 * Preserve an embedded PBR payload without asking Three's browser-oriented
 * image loader to decode it under Node. This rewrites only the active index
 * accessor; the subsequent asset:prepare pass compacts the now-unreferenced
 * vertices and prunes the old accessor while leaving UVs/images/materials
 * untouched.
 */
async function trimTexturedGlbByIndex() {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
    throw new Error('input is not a glTF 2.0 binary');
  }
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
  if ((json.images?.length ?? 0) === 0) return false;
  if (json.meshes?.length !== 1 || json.meshes[0].primitives?.length !== 1) {
    throw new Error('textured regional trim requires one mesh and one primitive');
  }
  const nodes = (json.nodes ?? []).filter((node) => node.mesh === 0);
  if (nodes.length !== 1) throw new Error('textured regional trim requires one mesh node');
  const node = nodes[0];
  const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const matrixIsIdentity = node.matrix === undefined
    || node.matrix.every((value, index) => Math.abs(value - identityMatrix[index]) < 1e-8);
  const translationIsIdentity = node.translation === undefined || node.translation.every((value) => Math.abs(value) < 1e-8);
  const rotationIsIdentity = node.rotation === undefined
    || node.rotation.every((value, index) => Math.abs(value - (index === 3 ? 1 : 0)) < 1e-8);
  const scaleIsIdentity = node.scale === undefined || node.scale.every((value) => Math.abs(value - 1) < 1e-8);
  if (!matrixIsIdentity || !translationIsIdentity || !rotationIsIdentity || !scaleIsIdentity) {
    throw new Error('apply the mesh node transform before textured regional trimming');
  }

  const binaryHeaderOffset = 20 + jsonLength;
  const binaryLength = bytes.readUInt32LE(binaryHeaderOffset);
  const binaryType = bytes.readUInt32LE(binaryHeaderOffset + 4);
  if (binaryType !== 0x004e4942) throw new Error('GLB has no binary chunk');
  const binaryOffset = binaryHeaderOffset + 8;
  const binary = bytes.subarray(binaryOffset, binaryOffset + binaryLength);
  const primitive = json.meshes[0].primitives[0];
  const positionAccessor = json.accessors[primitive.attributes.POSITION];
  const positionView = json.bufferViews[positionAccessor.bufferView];
  if (positionAccessor.componentType !== 5126 || positionAccessor.type !== 'VEC3') {
    throw new Error('textured regional trim requires float VEC3 positions');
  }
  const positionStride = positionView.byteStride ?? 12;
  const positionOffset = (positionView.byteOffset ?? 0) + (positionAccessor.byteOffset ?? 0);
  const positionAt = (vertex, component) => binary.readFloatLE(positionOffset + vertex * positionStride + component * 4);

  const indexAccessor = json.accessors[primitive.indices];
  const indexView = json.bufferViews[indexAccessor.bufferView];
  const indexOffset = (indexView.byteOffset ?? 0) + (indexAccessor.byteOffset ?? 0);
  const indexBytes = indexAccessor.componentType === 5125 ? 4 : indexAccessor.componentType === 5123 ? 2 : 1;
  const indexAt = (offset) => {
    const byteOffset = indexOffset + offset * indexBytes;
    if (indexBytes === 4) return binary.readUInt32LE(byteOffset);
    if (indexBytes === 2) return binary.readUInt16LE(byteOffset);
    return binary.readUInt8(byteOffset);
  };

  const kept = [];
  let removedTriangles = 0;
  for (let i = 0; i < indexAccessor.count; i += 3) {
    const oldIndices = [indexAt(i), indexAt(i + 1), indexAt(i + 2)];
    const centre = [0, 0, 0];
    for (const oldIndex of oldIndices) {
      centre[0] += positionAt(oldIndex, 0);
      centre[1] += positionAt(oldIndex, 1);
      centre[2] += positionAt(oldIndex, 2);
    }
    centre[0] /= 3;
    centre[1] /= 3;
    centre[2] /= 3;
    const inBox = boxes.some(([minX, minY, minZ, maxX, maxY, maxZ]) => (
      centre[0] >= minX && centre[0] <= maxX
      && centre[1] >= minY && centre[1] <= maxY
      && centre[2] >= minZ && centre[2] <= maxZ
    ));
    if (centre[1] >= removeAboveY || inBox) {
      removedTriangles++;
      continue;
    }
    kept.push(...oldIndices);
  }

  const newIndices = Buffer.allocUnsafe(kept.length * 4);
  for (let i = 0; i < kept.length; i++) newIndices.writeUInt32LE(kept[i], i * 4);
  if (kept.length === 0) throw new Error('regional trim removed every triangle');
  let retainedMin = Infinity;
  let retainedMax = -Infinity;
  for (const value of kept) {
    retainedMin = Math.min(retainedMin, value);
    retainedMax = Math.max(retainedMax, value);
  }
  const indexViewIndex = json.bufferViews.length;
  const indexAccessorIndex = json.accessors.length;
  json.bufferViews.push({
    buffer: 0,
    byteOffset: binary.length,
    byteLength: newIndices.length,
    target: 34963,
  });
  json.accessors.push({
    bufferView: indexViewIndex,
    byteOffset: 0,
    componentType: 5125,
    count: kept.length,
    type: 'SCALAR',
    min: [retainedMin],
    max: [retainedMax],
  });
  primitive.indices = indexAccessorIndex;
  const outputBinary = Buffer.concat([binary, newIndices]);
  json.buffers[0].byteLength = outputBinary.length;

  let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadding = (4 - jsonBytes.length % 4) % 4;
  if (jsonPadding > 0) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = (4 - outputBinary.length % 4) % 4;
  const paddedBinary = binaryPadding === 0
    ? outputBinary
    : Buffer.concat([outputBinary, Buffer.alloc(binaryPadding)]);
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
    inputTriangles: indexAccessor.count / 3,
    outputTriangles: kept.length / 3,
    removedTriangles,
    removedPercent: Number((removedTriangles / (indexAccessor.count / 3) * 100).toFixed(2)),
    preservedImages: json.images.length,
    rules: { removeAboveY, boxes },
  }, null, 2));
  return true;
}

if (await trimTexturedGlbByIndex()) process.exit(0);

const gltf = await new GLTFLoader().parseAsync(arrayBuffer, `${path.dirname(input)}${path.sep}`);
gltf.scene.updateMatrixWorld(true);

const meshes = [];
gltf.scene.traverse((object) => {
  if (object instanceof THREE.Mesh) meshes.push(object);
});
if (meshes.length !== 1) throw new Error(`expected one mesh, received ${meshes.length}`);

const source = meshes[0];
const geometry = source.geometry.clone();
geometry.applyMatrix4(source.matrixWorld);
const position = geometry.getAttribute('position');
const index = geometry.getIndex();
if (index === null) throw new Error('regional trim currently requires indexed geometry');

const keptOldIndices = [];
let removedTriangles = 0;
for (let i = 0; i < index.count; i += 3) {
  const oldIndices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
  const centre = new THREE.Vector3();
  for (const oldIndex of oldIndices) {
    centre.x += position.getX(oldIndex);
    centre.y += position.getY(oldIndex);
    centre.z += position.getZ(oldIndex);
  }
  centre.multiplyScalar(1 / 3);
  const inBox = boxes.some(([minX, minY, minZ, maxX, maxY, maxZ]) => (
    centre.x >= minX && centre.x <= maxX
    && centre.y >= minY && centre.y <= maxY
    && centre.z >= minZ && centre.z <= maxZ
  ));
  if (centre.y >= removeAboveY || inBox) {
    removedTriangles++;
    continue;
  }
  keptOldIndices.push(...oldIndices);
}

const remap = new Int32Array(position.count);
remap.fill(-1);
const oldVertices = [];
const outputIndices = new Uint32Array(keptOldIndices.length);
for (let i = 0; i < keptOldIndices.length; i++) {
  const oldIndex = keptOldIndices[i];
  let newIndex = remap[oldIndex];
  if (newIndex === -1) {
    newIndex = oldVertices.length;
    remap[oldIndex] = newIndex;
    oldVertices.push(oldIndex);
  }
  outputIndices[i] = newIndex;
}

const trimmed = new THREE.BufferGeometry();
for (const name of Object.keys(geometry.attributes)) {
  const attribute = geometry.getAttribute(name);
  if (attribute.isInterleavedBufferAttribute) {
    throw new Error(`interleaved attribute ${name} is not supported`);
  }
  const ArrayType = attribute.array.constructor;
  const values = new ArrayType(oldVertices.length * attribute.itemSize);
  for (let newIndex = 0; newIndex < oldVertices.length; newIndex++) {
    const oldIndex = oldVertices[newIndex];
    for (let component = 0; component < attribute.itemSize; component++) {
      values[newIndex * attribute.itemSize + component] = attribute.array[oldIndex * attribute.itemSize + component];
    }
  }
  trimmed.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
}
trimmed.setIndex(new THREE.BufferAttribute(outputIndices, 1));
trimmed.computeBoundingBox();
trimmed.computeBoundingSphere();
trimmed.name = `${geometry.name || 'mesh'}.trimmed`;

// GLTFExporter uses FileReader in browsers. This minimal standards-compatible
// shim keeps this geometry-only production tool deterministic under Node.
if (globalThis.FileReader === undefined) {
  globalThis.FileReader = class {
    result = null;
    error = null;
    onloadend = null;
    onerror = null;

    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((result) => {
        this.result = result;
        this.onloadend?.({ target: this });
      }).catch((error) => {
        this.error = error;
        this.onerror?.(error);
      });
    }
  };
}

const scene = new THREE.Scene();
const material = Array.isArray(source.material) ? source.material[0] : source.material;
const outputMesh = new THREE.Mesh(trimmed, material);
outputMesh.name = source.name || 'trimmed-mesh';
scene.add(outputMesh);
const exported = await new GLTFExporter().parseAsync(scene, {
  binary: true,
  onlyVisible: false,
  trs: false,
});
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, new Uint8Array(exported));

console.log(JSON.stringify({
  input,
  output,
  inputTriangles: index.count / 3,
  outputTriangles: outputIndices.length / 3,
  removedTriangles,
  removedPercent: Number((removedTriangles / (index.count / 3) * 100).toFixed(2)),
  inputVertices: position.count,
  outputVertices: oldVertices.length,
  rules: { removeAboveY, boxes },
}, null, 2));

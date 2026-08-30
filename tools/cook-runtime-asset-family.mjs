#!/usr/bin/env node

/**
 * Deterministically bake invariant imported-unit geometry conditioning.
 *
 * This POC intentionally accepts only a complete, static, one-primitive family.
 * It preserves the source/control files, KTX2 material payload, authored LODs
 * and shadow proxy. Runtime-only material/shroud setup and procedural sockets
 * remain runtime-owned. The first Chrono Miner proof failed its size/request
 * gate, so outputs live under ignored `.turbo/`; run with --write to reproduce
 * them and without --write to byte-check an existing local proof.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const write = args.includes('--write');
const quarantineRoot = path.resolve(root, '.turbo/runtime-cooks');
const manifestPath = path.resolve(
  root,
  value('--manifest') ?? 'tools/asset-cooks/chrono-miner.runtime.json',
);

const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
validateManifest(manifest);

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });

const inputPaths = Object.fromEntries(
  Object.entries(manifest.inputs).map(([role, file]) => [role, resolveRepoPath(file, `input ${role}`)]),
);
const outputPaths = Object.fromEntries(
  Object.entries(manifest.outputs).map(([role, file]) => [role, resolveQuarantinePath(file, role)]),
);
const authorityPaths = {
  authoring: resolveRepoPath(manifest.sourceAuthority.authoring, 'authoring source'),
  runtimeControl: resolveRepoPath(manifest.sourceAuthority.runtimeControl, 'runtime control'),
};
const protectedPaths = new Set(
  [...Object.values(authorityPaths), ...Object.values(inputPaths)].map(pathKey),
);
const outputKeys = Object.values(outputPaths).map(pathKey);
if (new Set(outputKeys).size !== outputKeys.length) {
  throw new Error('runtime cook outputs must resolve to distinct quarantine files');
}
for (const [role, absolute] of Object.entries(outputPaths)) {
  if (protectedPaths.has(pathKey(absolute))) {
    throw new Error(`runtime cook output ${role} overlaps a protected source/input`);
  }
}
for (const [label, absolute] of Object.entries({ ...authorityPaths, ...inputPaths })) {
  if (!fs.existsSync(absolute)) throw new Error(`cook input does not exist: ${repoPath(absolute)}`);
  const expected = manifest.inputSha256[label];
  const actual = sha256(fs.readFileSync(absolute));
  if (actual !== expected) {
    throw new Error(`${label} hash mismatch: expected ${expected}, received ${actual}`);
  }
}

const started = performance.now();
const lod0 = await readVisible(inputPaths.lod0, manifest.contract.hullName, 'lod0');
const fit = fitFromBounds(lod0.rawBounds, manifest.contract);
const cooked = {
  lod0: await finishVisible(lod0, fit, 'lod0'),
  lod1: await finishVisible(
    await readVisible(inputPaths.lod1, manifest.contract.hullName, 'lod1'), fit, 'lod1',
  ),
  lod2: await finishVisible(
    await readVisible(inputPaths.lod2, manifest.contract.hullName, 'lod2'), fit, 'lod2',
  ),
  shadow: await cookShadow(inputPaths.shadow, fit),
};

const rows = {};
let familyBytes = 0;
for (const role of ['lod0', 'lod1', 'lod2', 'shadow']) {
  const result = cooked[role];
  const output = outputPaths[role];
  familyBytes += result.bytes.byteLength;
  const maxTriangles = manifest.budgets.maxTriangles[role];
  if (result.triangles > maxTriangles) {
    throw new Error(`${role} has ${result.triangles} triangles; budget is ${maxTriangles}`);
  }
  rows[role] = {
    input: repoPath(inputPaths[role]),
    output: repoPath(output),
    inputBytes: fs.statSync(inputPaths[role]).size,
    outputBytes: result.bytes.byteLength,
    inputSha256: sha256(fs.readFileSync(inputPaths[role])),
    outputSha256: sha256(result.bytes),
    triangles: result.triangles,
    vertices: result.vertices,
    bounds: roundBounds(result.bounds),
    materialNames: result.materialNames,
    expandedGeometrySha256: result.expandedGeometrySha256,
    attributes: result.attributes,
    extensionsRequired: result.extensionsRequired,
  };
}
if (rows.lod0.outputBytes > manifest.budgets.maxLod0Bytes) {
  throw new Error(`cooked LOD0 is ${rows.lod0.outputBytes} bytes; budget is ${manifest.budgets.maxLod0Bytes}`);
}
if (familyBytes > manifest.budgets.maxFamilyBytes) {
  throw new Error(`cooked family is ${familyBytes} bytes; budget is ${manifest.budgets.maxFamilyBytes}`);
}

const report = {
  version: 1,
  manifest: repoPath(manifestPath),
  family: manifest.family,
  runtimeKey: manifest.runtimeKey,
  sourceAuthority: manifest.sourceAuthority,
  cook: {
    geometryContract: 'voltmarch.imported-static.v1',
    meshopt: 'lossless float-accessor EXT_meshopt_compression',
    invariantStagesRemoved: [
      'mesh world-transform application',
      `crease-normal rebuild at ${manifest.contract.creaseAngleDeg} degrees`,
      'normalized POSITION/TEXCOORD promotion to Float32',
      'stale TANGENT removal',
      'source-bounds scan and gameplay-envelope fit',
      'exact post-crease vertex reindexing',
    ],
    runtimeOwned: [
      'renderer-neutral PBR/shroud material construction',
      'procedural gameplay sockets and fallback',
      'LOD distance selection and shadow-pass ownership',
    ],
  },
  contract: manifest.contract,
  fit: {
    sourcePivot: roundArray(fit.sourcePivot.toArray()),
    scale: roundArray(fit.scale.toArray()),
    yawRadians: round(fit.yaw),
  },
  rows,
  familyBytes,
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (write) {
  for (const role of ['lod0', 'lod1', 'lod2', 'shadow']) {
    await fsp.mkdir(path.dirname(outputPaths[role]), { recursive: true });
    await fsp.writeFile(outputPaths[role], cooked[role].bytes);
  }
  await fsp.writeFile(outputPaths.report, reportText);
} else {
  for (const role of ['lod0', 'lod1', 'lod2', 'shadow']) {
    assertTrackedBytes(outputPaths[role], cooked[role].bytes);
  }
  if (!fs.existsSync(outputPaths.report)) throw new Error(`missing cook report: ${repoPath(outputPaths.report)}`);
  const trackedReport = await fsp.readFile(outputPaths.report, 'utf8');
  if (trackedReport !== reportText) throw new Error('runtime cook report is stale; rerun with --write');
}

console.log(JSON.stringify({
  family: manifest.family,
  mode: write ? 'write' : 'check',
  familyBytes,
  elapsedMs: +(performance.now() - started).toFixed(3),
}));

async function readVisible(file, nodeName, role) {
  const document = await io.read(file);
  const node = uniqueMeshNode(document, nodeName, role);
  const mesh = node.getMesh();
  const primitives = mesh.listPrimitives();
  if (primitives.length !== 1) throw new Error(`${role} must contain one primitive`);
  const primitive = primitives[0];
  const geometry = geometryFromPrimitive(primitive);
  geometry.applyMatrix4(new THREE.Matrix4().fromArray(node.getWorldMatrix()));
  const creased = toCreasedNormals(geometry, THREE.MathUtils.degToRad(manifest.contract.creaseAngleDeg));
  if (creased !== geometry) geometry.dispose();
  promoteAttribute(creased, 'position');
  promoteAttribute(creased, 'uv');
  creased.deleteAttribute('tangent');
  creased.computeBoundingBox();
  if (creased.boundingBox === null) throw new Error(`${role} has no bounds`);
  return {
    document,
    node,
    primitive,
    geometry: creased,
    rawBounds: creased.boundingBox.clone(),
    materialNames: primitive.getMaterial() === null ? [] : [primitive.getMaterial().getName()],
  };
}

async function finishVisible(source, fit, role) {
  applyFit(source.geometry, fit, false);
  const expandedGeometrySha256 = expandedGeometryHash(source.geometry);
  indexExactVertices(source.geometry);
  replacePrimitiveGeometry(source.document, source.primitive, source.geometry, role);
  source.node.setMatrix(new THREE.Matrix4().identity().toArray());
  stampCookMetadata(source.node, role, source.geometry.boundingBox);
  await source.document.transform(prune({ keepAttributes: true }));
  return finishDocument(
    source.document, source.geometry, source.materialNames, expandedGeometrySha256,
  );
}

async function cookShadow(file, fit) {
  const document = await io.read(file);
  const nodes = document.getRoot().listNodes().filter((node) => node.getMesh() !== null);
  if (nodes.length !== 1) throw new Error('shadow must contain exactly one mesh node');
  const node = nodes[0];
  const primitives = node.getMesh().listPrimitives();
  if (primitives.length !== 1) throw new Error('shadow must contain exactly one primitive');
  const primitive = primitives[0];
  const geometry = geometryFromPrimitive(primitive, ['position']);
  promoteAttribute(geometry, 'position');
  geometry.applyMatrix4(new THREE.Matrix4().fromArray(node.getWorldMatrix()));
  applyFit(geometry, fit, false);
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('tangent');
  replacePrimitiveGeometry(document, primitive, geometry, 'shadow');
  primitive.setMaterial(null);
  node.setMatrix(new THREE.Matrix4().identity().toArray());
  stampCookMetadata(node, 'shadow', geometry.boundingBox);
  await document.transform(prune({ keepAttributes: true }));
  return finishDocument(document, geometry, [], expandedGeometryHash(geometry));
}

async function finishDocument(document, geometry, materialNames, expandedGeometrySha256) {
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (
      extension.extensionName === EXTMeshoptCompression.EXTENSION_NAME
      || extension.extensionName === 'KHR_mesh_quantization'
    ) extension.dispose();
  }
  document.createExtension(EXTMeshoptCompression)
    .setRequired(true)
    // QUANTIZE means "no Meshopt filter" here. Accessors are already Float32;
    // unlike the high-level meshopt() transform this does not quantize them.
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const bytes = await io.writeBinary(document);
  const json = glbJson(bytes);
  geometry.computeBoundingBox();
  return {
    bytes,
    triangles: geometry.index === null
      ? Math.round(geometry.getAttribute('position').count / 3)
      : Math.round(geometry.index.count / 3),
    vertices: geometry.getAttribute('position').count,
    bounds: geometry.boundingBox,
    materialNames,
    expandedGeometrySha256,
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [
      name,
      `${attribute.array.constructor.name}:${attribute.itemSize}`,
    ])),
    extensionsRequired: [...(json.extensionsRequired ?? [])].sort(),
  };
}

function geometryFromPrimitive(primitive, only = null) {
  const geometry = new THREE.BufferGeometry();
  const semantics = {
    POSITION: 'position',
    NORMAL: 'normal',
    TANGENT: 'tangent',
    TEXCOORD_0: 'uv',
  };
  for (const [semantic, name] of Object.entries(semantics)) {
    if (only !== null && !only.includes(name)) continue;
    const accessor = primitive.getAttribute(semantic);
    if (accessor === null || accessor.getArray() === null) continue;
    const array = accessor.getArray();
    geometry.setAttribute(name, new THREE.BufferAttribute(
      array.slice(), accessor.getElementSize(), accessor.getNormalized(),
    ));
  }
  const indices = primitive.getIndices();
  if (indices !== null && indices.getArray() !== null) {
    geometry.setIndex(new THREE.BufferAttribute(indices.getArray().slice(), 1));
  }
  if (geometry.getAttribute('position') === undefined) throw new Error('primitive has no POSITION');
  promoteAttribute(geometry, 'position');
  return geometry;
}

function promoteAttribute(geometry, name) {
  const attribute = geometry.getAttribute(name);
  if (attribute === undefined) return;
  if (attribute.array instanceof Float32Array && attribute.normalized === false) return;
  const values = new Float32Array(attribute.count * attribute.itemSize);
  const element = [];
  for (let index = 0; index < attribute.count; index++) {
    element.length = 0;
    for (let component = 0; component < attribute.itemSize; component++) {
      const getter = ['getX', 'getY', 'getZ', 'getW'][component];
      values[index * attribute.itemSize + component] = attribute[getter](index);
    }
  }
  geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
}

/**
 * Re-index only bit-identical cooked vertices. This changes no position, UV or
 * normal and is therefore safe after the runtime-equivalent crease pass. The
 * current live path expands every triangle; cooking can recover those exact
 * duplicates once rather than uploading them for every boot.
 */
function indexExactVertices(geometry) {
  if (geometry.index !== null) return;
  const names = Object.keys(geometry.attributes).sort();
  const count = geometry.getAttribute('position').count;
  const attributes = names.map((name) => geometry.getAttribute(name));
  if (attributes.some((attribute) => attribute.count !== count)) {
    throw new Error('cooked vertex attributes do not share one count');
  }
  const bits = attributes.map((attribute) => new Uint32Array(
    attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength / 4,
  ));
  const unique = new Map();
  const remap = new Uint32Array(count);
  const sourceIndices = [];
  for (let vertex = 0; vertex < count; vertex++) {
    const key = bits.map((view, index) => {
      const itemSize = attributes[index].itemSize;
      return Array.from(view.subarray(vertex * itemSize, vertex * itemSize + itemSize)).join(',');
    }).join('|');
    let target = unique.get(key);
    if (target === undefined) {
      target = unique.size;
      unique.set(key, target);
      sourceIndices.push(vertex);
    }
    remap[vertex] = target;
  }
  for (let index = 0; index < attributes.length; index++) {
    const source = attributes[index];
    const values = new Float32Array(sourceIndices.length * source.itemSize);
    for (let target = 0; target < sourceIndices.length; target++) {
      const sourceOffset = sourceIndices[target] * source.itemSize;
      values.set(source.array.subarray(sourceOffset, sourceOffset + source.itemSize), target * source.itemSize);
    }
    geometry.setAttribute(names[index], new THREE.BufferAttribute(values, source.itemSize));
  }
  geometry.setIndex(new THREE.BufferAttribute(
    sourceIndices.length <= 65535 ? new Uint16Array(remap) : remap,
    1,
  ));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function expandedGeometryHash(geometry) {
  const hash = crypto.createHash('sha256');
  const names = Object.keys(geometry.attributes).sort();
  const indices = geometry.index;
  const count = indices?.count ?? geometry.getAttribute('position').count;
  const scalar = new Float32Array(1);
  for (let vertex = 0; vertex < count; vertex++) {
    const source = indices === null ? vertex : indices.getX(vertex);
    for (const name of names) {
      const attribute = geometry.getAttribute(name);
      for (let component = 0; component < attribute.itemSize; component++) {
        scalar[0] = attribute.array[source * attribute.itemSize + component];
        hash.update(new Uint8Array(scalar.buffer));
      }
    }
  }
  return hash.digest('hex');
}

function replacePrimitiveGeometry(document, primitive, geometry, role) {
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer('runtime-cook');
  for (const semantic of primitive.listSemantics()) primitive.setAttribute(semantic, null);
  const map = { position: 'POSITION', normal: 'NORMAL', tangent: 'TANGENT', uv: 'TEXCOORD_0' };
  for (const [name, semantic] of Object.entries(map)) {
    const attribute = geometry.getAttribute(name);
    if (attribute === undefined) continue;
    const type = ['SCALAR', 'VEC2', 'VEC3', 'VEC4'][attribute.itemSize - 1];
    const accessor = document.createAccessor(`${role}.${semantic}`)
      .setType(type)
      .setArray(attribute.array.slice())
      .setNormalized(false)
      .setBuffer(buffer);
    primitive.setAttribute(semantic, accessor);
  }
  if (geometry.index === null) {
    primitive.setIndices(null);
  } else {
    primitive.setIndices(document.createAccessor(`${role}.indices`)
      .setType('SCALAR')
      .setArray(geometry.index.array.slice())
      .setBuffer(buffer));
  }
}

function uniqueMeshNode(document, name, role) {
  const nodes = document.getRoot().listNodes().filter(
    (node) => node.getName().toLowerCase() === name.toLowerCase() && node.getMesh() !== null,
  );
  if (nodes.length !== 1) throw new Error(`${role} expected one ${name} mesh node; found ${nodes.length}`);
  return nodes[0];
}

function fitFromBounds(bounds, contract) {
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) throw new Error('LOD0 source bounds are invalid');
  const [width, height, length] = contract.target;
  return {
    sourcePivot: new THREE.Vector3(centre.x, bounds.min.y, centre.z),
    targetPivot: new THREE.Vector3(...contract.targetPivot),
    scale: contract.sourceLongAxis === 'z'
      ? new THREE.Vector3(width / size.x, height / size.y, length / size.z)
      : new THREE.Vector3(length / size.x, height / size.y, width / size.z),
    yaw: THREE.MathUtils.degToRad(contract.yawDeg),
  };
}

function applyFit(geometry, fit, turret) {
  geometry.translate(-fit.sourcePivot.x, -fit.sourcePivot.y, -fit.sourcePivot.z);
  geometry.scale(fit.scale.x, fit.scale.y, fit.scale.z);
  geometry.rotateY(fit.yaw);
  if (!turret) geometry.translate(fit.targetPivot.x, fit.targetPivot.y, fit.targetPivot.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function stampCookMetadata(node, role, bounds) {
  node.setExtras({
    ...node.getExtras(),
    voltmarchCooked: {
      version: 1,
      family: manifest.family,
      runtimeKey: manifest.runtimeKey,
      geometryContract: 'voltmarch.imported-static.v1',
      role,
      bounds: roundBounds(bounds),
    },
  });
}

function validateManifest(candidate) {
  if (candidate.version !== 1) throw new Error(`unsupported runtime cook version: ${candidate.version}`);
  for (const key of [
    'family', 'runtimeKey', 'sourceAuthority', 'inputs', 'outputs', 'inputSha256', 'contract', 'budgets',
  ]) {
    if (candidate[key] === undefined) throw new Error(`runtime cook manifest is missing ${key}`);
  }
  const requiredPaths = {
    ...candidate.sourceAuthority,
    ...candidate.inputs,
    ...candidate.outputs,
  };
  for (const [label, file] of Object.entries(requiredPaths)) validateRepoPath(file, label);
  for (const label of ['authoring', 'runtimeControl', 'lod0', 'lod1', 'lod2', 'shadow']) {
    if (!/^[0-9a-f]{64}$/.test(candidate.inputSha256[label] ?? '')) {
      throw new Error(`runtime cook manifest has no valid SHA-256 for ${label}`);
    }
  }
  if (!Array.isArray(candidate.contract.movingParts) || candidate.contract.movingParts.length !== 0) {
    throw new Error('v1 runtime cook accepts only a static family; articulated parts remain on control path');
  }
  if (candidate.contract.sockets !== 'procedural-authority') {
    throw new Error('runtime cook may not replace procedural gameplay socket authority');
  }
}

function validateRepoPath(file, label) {
  if (typeof file !== 'string' || file.length === 0 || path.isAbsolute(file)) {
    throw new Error(`${label} must be a repository-relative path`);
  }
  const segments = file.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment === '' || segment === '..')) {
    throw new Error(`${label} must not escape or contain empty path segments`);
  }
}

function resolveRepoPath(file, label) {
  validateRepoPath(file, label);
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside the repository`);
  }
  return absolute;
}

function resolveQuarantinePath(file, label) {
  const absolute = resolveRepoPath(file, `output ${label}`);
  const relative = path.relative(quarantineRoot, absolute);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`output ${label} must stay under .turbo/runtime-cooks`);
  }
  return absolute;
}

function pathKey(file) {
  return process.platform === 'win32' ? path.normalize(file).toLowerCase() : path.normalize(file);
}

function assertTrackedBytes(file, expected) {
  if (!fs.existsSync(file)) throw new Error(`missing cooked output: ${repoPath(file)}`);
  const actual = fs.readFileSync(file);
  if (actual.byteLength !== expected.byteLength || !actual.equals(Buffer.from(expected))) {
    throw new Error(`cooked output is stale or nondeterministic: ${repoPath(file)}`);
  }
}

function glbJson(bytes) {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.readUInt32LE(0) !== 0x46546c67 || view.readUInt32LE(4) !== 2) {
    throw new Error('cook output is not glTF 2.0 GLB');
  }
  const length = view.readUInt32LE(12);
  return JSON.parse(view.subarray(20, 20 + length).toString('utf8').trim());
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function round(value) {
  return +value.toFixed(6);
}

function roundArray(values) {
  return values.map(round);
}

function roundBounds(bounds) {
  if (bounds === null) throw new Error('cooked geometry has no bounds');
  return { min: roundArray(bounds.min.toArray()), max: roundArray(bounds.max.toArray()) };
}

function repoPath(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

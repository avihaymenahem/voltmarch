#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const inputArg = value('--input');
const outputArg = value('--output');
const bounds = {
  minX: Number(value('--min-x')),
  maxX: Number(value('--max-x')),
  minY: Number(value('--min-y')),
  minZ: Number(value('--min-z')),
  maxZ: Number(value('--max-z')),
};
const pivot = [
  Number(value('--pivot-x')),
  Number(value('--pivot-y')),
  Number(value('--pivot-z')),
];
const radius = [Number(value('--radius-x')), Number(value('--radius-z'))];
const hullName = value('--hull-name') ?? 'Hull';
const turretName = value('--turret-name') ?? 'Turret';
const generatedUv = (value('--generated-uv') ?? '0.5,0.5')
  .split(',')
  .map((entry) => Number(entry));

if (!inputArg || !outputArg
  || Object.values(bounds).some((entry) => !Number.isFinite(entry))
  || pivot.some((entry) => !Number.isFinite(entry))
  || radius.some((entry) => !(entry > 0))
  || generatedUv.length !== 2
  || generatedUv.some((entry) => !Number.isFinite(entry) || entry < 0 || entry > 1)) {
  throw new Error(
    'usage: node tools/split-glb-bounded-turret.mjs --input source.glb --output split.glb '
    + '--min-x N --max-x N --min-y N --min-z N --max-z N '
    + '--pivot-x N --pivot-y N --pivot-z N --radius-x N --radius-z N '
    + '[--generated-uv U,V]',
  );
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
if (!fs.existsSync(input)) throw new Error(`input does not exist: ${input}`);
if (input === output) throw new Error('input and output must differ');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);
const root = document.getRoot();
const sourceNodes = root.listNodes().filter((node) => node.getMesh());
if (sourceNodes.length !== 1) throw new Error(`expected one source mesh node, found ${sourceNodes.length}`);
const sourceNode = sourceNodes[0];
const sourceMesh = sourceNode.getMesh();
const primitives = sourceMesh.listPrimitives();
if (primitives.length !== 1) throw new Error(`expected one source primitive, found ${primitives.length}`);
const source = primitives[0];
const positions = source.getAttribute('POSITION');
const indices = source.getIndices();
if (!positions || !indices) throw new Error('source primitive must contain POSITION and indices');
const indexArray = indices.getArray();
if (!indexArray || indexArray.length % 3 !== 0) throw new Error('source indices must be triangles');

const semantics = source.listSemantics();
const attributes = new Map(semantics.map((semantic) => {
  const accessor = source.getAttribute(semantic);
  return [semantic, {
    accessor,
    array: accessor.getArray(),
    size: accessor.getElementSize(),
  }];
}));

function valuesAt(semantic, index) {
  const attribute = attributes.get(semantic);
  const start = index * attribute.size;
  return Array.from(attribute.array.subarray(start, start + attribute.size));
}

function builder(name) {
  return {
    name,
    arrays: new Map(semantics.map((semantic) => [semantic, []])),
    indices: [],
  };
}
const hull = builder(hullName);
const turret = builder(turretName);

function appendSourceVertex(target, sourceIndex) {
  const result = target.arrays.get('POSITION').length / attributes.get('POSITION').size;
  for (const semantic of semantics) target.arrays.get(semantic).push(...valuesAt(semantic, sourceIndex));
  return result;
}

function appendTriangle(target, triangle) {
  target.indices.push(...triangle.map((sourceIndex) => appendSourceVertex(target, sourceIndex)));
}

function centreOf(triangle) {
  const points = triangle.map((index) => valuesAt('POSITION', index));
  return [0, 1, 2].map((axis) => points.reduce((sum, point) => sum + point[axis], 0) / 3);
}

for (let offset = 0; offset < indexArray.length; offset += 3) {
  const triangle = [indexArray[offset], indexArray[offset + 1], indexArray[offset + 2]];
  const [x, y, z] = centreOf(triangle);
  const inside = x >= bounds.minX && x <= bounds.maxX
    && y >= bounds.minY && z >= bounds.minZ && z <= bounds.maxZ;
  appendTriangle(inside ? turret : hull, triangle);
}

if (turret.indices.length === 0 || hull.indices.length === 0) {
  throw new Error('bounded extraction produced an empty hull or turret');
}

function generatedValues(semantic, position, normal, uv) {
  const size = attributes.get(semantic).size;
  const values = new Array(size).fill(0);
  if (semantic === 'POSITION') values.splice(0, 3, ...position);
  else if (semantic === 'NORMAL') values.splice(0, 3, ...normal);
  else if (semantic === 'TANGENT') values.splice(0, 4, 1, 0, 0, 1);
  else if (semantic.startsWith('TEXCOORD_')) values.splice(0, 2, ...uv);
  else if (semantic.startsWith('COLOR_')) values.fill(1);
  return values;
}

function appendGeneratedVertex(target, position, normal, uv) {
  const result = target.arrays.get('POSITION').length / attributes.get('POSITION').size;
  for (const semantic of semantics) {
    target.arrays.get(semantic).push(...generatedValues(semantic, position, normal, uv));
  }
  return result;
}

function addDisc(target, y, normalY) {
  const segments = 24;
  const centre = appendGeneratedVertex(target, [pivot[0], y, pivot[2]], [0, normalY, 0], generatedUv);
  const ring = [];
  for (let index = 0; index < segments; index++) {
    const angle = index / segments * Math.PI * 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    ring.push(appendGeneratedVertex(target, [
      pivot[0] + cosine * radius[0], y, pivot[2] + sine * radius[1],
    ], [0, normalY, 0], generatedUv));
  }
  for (let index = 0; index < segments; index++) {
    const next = ring[(index + 1) % segments];
    if (normalY > 0) target.indices.push(centre, next, ring[index]);
    else target.indices.push(centre, ring[index], next);
  }
}

// The fitted runtime adds a defensive cap to the moving part as well. These
// source-space discs close both sides before fitting so off-axis rotation can
// never expose the generated model's open attachment throat.
addDisc(hull, pivot[1] + 0.001, 1);
addDisc(turret, pivot[1] + 0.003, -1);

function buildMesh(target) {
  const primitive = document.createPrimitive().setMode(source.getMode());
  const material = source.getMaterial();
  if (material) {
    material.setDoubleSided(false);
    primitive.setMaterial(material);
  }
  for (const semantic of semantics) {
    const sourceAccessor = attributes.get(semantic).accessor;
    primitive.setAttribute(semantic, document.createAccessor(`${target.name}_${semantic.toLowerCase()}`)
      .setType(sourceAccessor.getType())
      .setNormalized(sourceAccessor.getNormalized())
      .setArray(new Float32Array(target.arrays.get(semantic)))
      .setBuffer(root.listBuffers()[0]));
  }
  const vertexCount = target.arrays.get('POSITION').length / attributes.get('POSITION').size;
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  primitive.setIndices(document.createAccessor(`${target.name}_indices`)
    .setType(Accessor.Type.SCALAR)
    .setArray(new IndexArray(target.indices))
    .setBuffer(root.listBuffers()[0]));
  return document.createMesh(target.name).addPrimitive(primitive);
}

const hullNode = document.createNode(hullName).setMesh(buildMesh(hull)).setMatrix(sourceNode.getMatrix());
const turretNode = document.createNode(turretName).setMesh(buildMesh(turret)).setMatrix(sourceNode.getMatrix());
for (const scene of root.listScenes()) {
  if (scene.listChildren().includes(sourceNode)) scene.removeChild(sourceNode).addChild(hullNode).addChild(turretNode);
}

await document.transform(prune());
await fsp.mkdir(path.dirname(output), { recursive: true });
await io.write(output, document);
console.log(JSON.stringify({
  input,
  output,
  bounds,
  pivot,
  radius,
  generatedUv,
  hullTriangles: hull.indices.length / 3,
  turretTriangles: turret.indices.length / 3,
  totalTriangles: (hull.indices.length + turret.indices.length) / 3,
}, null, 2));

#!/usr/bin/env node

/**
 * Reduce one accepted Meshy commander reconstruction to the hero LOD0 budget.
 *
 * Geometry only is intentional: Meshy retexture runs after this gate and owns
 * the shipping UV/PBR atlas. The command fails closed if simplification cannot
 * reach the requested triangle ceiling or moves the model bounds materially.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const input = value('--input');
const output = value('--output');
const target = Number(value('--target') ?? 50000);
const simplificationError = Number(value('--error') ?? 0.001);
if (input === undefined || output === undefined || !Number.isInteger(target) || target < 1000
  || !Number.isFinite(simplificationError) || simplificationError <= 0) {
  throw new Error('usage: node tools/condition-commander-model.mjs --input raw.glb --output hero-lod0.glb [--target 50000]');
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function triangles(document) {
  let total = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      total += (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0) / 3;
    }
  }
  return Math.round(total);
}

function documentBounds(document) {
  const scene = document.getRoot().listScenes()[0];
  if (scene === undefined) throw new Error('commander source has no scene');
  return getBounds(scene);
}

function relativeBoundsDrift(before, after) {
  let drift = 0;
  for (let axis = 0; axis < 3; axis++) {
    const span = Math.max(1e-6, before.max[axis] - before.min[axis]);
    drift = Math.max(
      drift,
      Math.abs(before.min[axis] - after.min[axis]) / span,
      Math.abs(before.max[axis] - after.max[axis]) / span,
    );
  }
  return drift;
}

const document = await io.read(path.resolve(input));
const beforeTriangles = triangles(document);
const beforeBounds = documentBounds(document);
if (beforeTriangles <= target) throw new Error(`source already satisfies target (${beforeTriangles} <= ${target})`);

// The reconstruction is an untextured geometry gate. Discard attributes that
// would lock artificial generation seams before welding and simplification;
// Meshy retexture recreates UVs, materials, normals and tangents downstream.
for (const mesh of document.getRoot().listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    for (const semantic of [...primitive.listSemantics()]) {
      if (semantic !== 'POSITION') primitive.setAttribute(semantic, null);
    }
  }
}

// Meshopt works on discrete collapse groups and may stop slightly above the
// requested ratio on irregular open-frame silhouettes. Keep a 4% safety band
// so the hard gameplay ceiling remains authoritative.
const requestedRatio = Math.min(0.99, target / beforeTriangles * 0.96);
await document.transform(
  weld({ overwrite: false }),
  simplify({
    simplifier: MeshoptSimplifier,
    ratio: requestedRatio,
    error: simplificationError,
    lockBorder: false,
  }),
  dedup(),
  prune({ keepAttributes: true }),
  quantize({ quantizePosition: 14 }),
);

const afterTriangles = triangles(document);
const afterBounds = documentBounds(document);
const boundsDrift = relativeBoundsDrift(beforeBounds, afterBounds);
if (afterTriangles > target) {
  throw new Error(`conditioned mesh has ${afterTriangles} triangles; target is ${target}`);
}
if (boundsDrift > 0.015) {
  throw new Error(`conditioned bounds drift ${(boundsDrift * 100).toFixed(3)}%; ceiling is 1.5%`);
}

await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await io.write(path.resolve(output), document);
const bytes = (await fs.stat(path.resolve(output))).size;
console.log(JSON.stringify({
  input: path.resolve(input),
  output: path.resolve(output),
  beforeTriangles,
  afterTriangles,
  triangleRatio: afterTriangles / beforeTriangles,
  boundsDrift,
  bytes,
}, null, 2));

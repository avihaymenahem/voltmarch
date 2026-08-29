#!/usr/bin/env node

/** Build the compact crate-stack and flower-box environment family. */

import fs from 'node:fs/promises';
import path from 'node:path';

import { Document, NodeIO } from '@gltf-transform/core';

const args = process.argv.slice(2);
const outputFlag = args.indexOf('--output-root');
const outputRoot = path.resolve(outputFlag >= 0
  ? args[outputFlag + 1]
  : 'packages/assets/game/environment/box-prop');
if (outputFlag >= 0 && !args[outputFlag + 1]) {
  throw new Error('usage: node tools/build-box-prop-family.mjs [--output-root <directory>]');
}

function geometry() {
  return { positions: [], normals: [], colours: [], uvs: [], indices: [], triangles: 0 };
}

function atlasUv(cell, inset = 0.006) {
  const column = cell % 2;
  const row = Math.floor(cell / 2);
  const uv = {
    u0: column * 0.5 + inset,
    u1: (column + 1) * 0.5 - inset,
    v0: (1 - row) * 0.5 + inset,
    v1: (2 - row) * 0.5 - inset,
  };
  // Cell 3 contains a wide overhead flower canopy inside a square atlas cell.
  // Crop its measured alpha bounds so the canopy fills the planter instead of
  // preserving ImageGen's transparent letterbox around it.
  if (cell === 3) {
    uv.u0 = 0.518;
    uv.u1 = 0.982;
    uv.v0 = 0.145;
    uv.v1 = 0.355;
  }
  return uv;
}

function appendQuad(target, vertices, normal, cell, value = 1) {
  const base = target.positions.length / 3;
  const uv = atlasUv(cell);
  const texcoords = [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]];
  for (let i = 0; i < 4; i++) {
    target.positions.push(...vertices[i]);
    target.normals.push(...normal);
    target.colours.push(value, value, value);
    target.uvs.push(...texcoords[i]);
  }
  target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  target.triangles += 2;
}

function transform(vertex, x, y, z, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + vertex[0] * c - vertex[2] * s, y + vertex[1], z + vertex[0] * s + vertex[2] * c];
}

function rotateNormal(normal, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [normal[0] * c - normal[2] * s, normal[1], normal[0] * s + normal[2] * c];
}

function appendBox(target, options) {
  const { x, y, z, width, height, depth, yaw = 0, cell, value = 1 } = options;
  const hx = width * 0.5;
  const hz = depth * 0.5;
  const faces = [
    [[-hx, 0, hz], [hx, 0, hz], [hx, height, hz], [-hx, height, hz], [0, 0, 1]],
    [[hx, 0, -hz], [-hx, 0, -hz], [-hx, height, -hz], [hx, height, -hz], [0, 0, -1]],
    [[hx, 0, hz], [hx, 0, -hz], [hx, height, -hz], [hx, height, hz], [1, 0, 0]],
    [[-hx, 0, -hz], [-hx, 0, hz], [-hx, height, hz], [-hx, height, -hz], [-1, 0, 0]],
    [[-hx, height, hz], [hx, height, hz], [hx, height, -hz], [-hx, height, -hz], [0, 1, 0]],
    [[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz], [0, -1, 0]],
  ];
  for (const [a, b, c, d, normal] of faces) {
    appendQuad(
      target,
      [a, b, c, d].map((vertex) => transform(vertex, x, y, z, yaw)),
      rotateNormal(normal, yaw),
      cell,
      value,
    );
  }
}

function appendTop(target, options) {
  const { x, y, z, width, depth, cell, value = 1 } = options;
  const hx = width * 0.5;
  const hz = depth * 0.5;
  appendQuad(target, [
    [x - hx, y, z + hz],
    [x + hx, y, z + hz],
    [x + hx, y, z - hz],
    [x - hx, y, z - hz],
  ], [0, 1, 0], cell, value);
}

const CRATES = [
  [0, 0, 0, 1.25, 0.04, 0.98],
  [1.25, 0, -0.10, 1.10, 0.13, 0.91],
  [-1.15, 0, 0.15, 1.15, -0.16, 0.94],
  [0.15, 1.20, 0.05, 1.00, 0.08, 1.00],
  [1.00, 1.20, 0.20, 0.85, -0.12, 0.88],
];

function buildCrates() {
  const target = geometry();
  for (const [x, y, z, size, yaw, value] of CRATES) {
    appendBox(target, { x, y, z, width: size, height: size, depth: size, yaw, cell: 0, value });
  }
  return target;
}

function buildCrateShadow() {
  const target = geometry();
  appendBox(target, { x: 0, y: 0, z: 0.04, width: 3.55, height: 1.20, depth: 1.65, cell: 0, value: 0.9 });
  appendBox(target, { x: 0.55, y: 1.20, z: 0.10, width: 1.95, height: 1.00, depth: 1.05, cell: 0, value: 0.9 });
  return target;
}

function buildFlowerBed(includeSoil = true) {
  const target = geometry();
  appendBox(target, {
    x: 0, y: 0, z: 0, width: 4.2, height: 0.54, depth: 2.4, cell: 1, value: 0.88,
  });
  if (includeSoil) {
    appendTop(target, { x: 0, y: 0.548, z: 0, width: 3.82, depth: 2.02, cell: 2, value: 0.92 });
  }
  appendTop(target, { x: 0, y: 0.568, z: 0, width: 3.62, depth: 1.84, cell: 3, value: 1.03 });
  return target;
}

function buildFlowerShadow() {
  const target = geometry();
  appendBox(target, {
    x: 0, y: 0, z: 0, width: 4.2, height: 0.54, depth: 2.4, cell: 1, value: 0.9,
  });
  return target;
}

async function writeGlb(file, name, data, textured) {
  const document = new Document();
  const buffer = document.createBuffer(`${name}.buffer`);
  const positions = document.createAccessor('POSITION').setType('VEC3')
    .setArray(new Float32Array(data.positions)).setBuffer(buffer);
  const normals = document.createAccessor('NORMAL').setType('VEC3')
    .setArray(new Float32Array(data.normals)).setBuffer(buffer);
  const colours = document.createAccessor('COLOR_0').setType('VEC3')
    .setArray(new Float32Array(data.colours)).setBuffer(buffer);
  const indices = document.createAccessor('indices').setType('SCALAR')
    .setArray(new Uint16Array(data.indices)).setBuffer(buffer);
  const material = document.createMaterial(textured ? 'box-prop.shared-atlas' : 'box-prop.shadow')
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.9)
    .setDoubleSided(false);
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', positions)
    .setAttribute('NORMAL', normals)
    .setAttribute('COLOR_0', colours)
    .setIndices(indices)
    .setMaterial(material);
  if (textured) {
    primitive.setAttribute('TEXCOORD_0', document.createAccessor('TEXCOORD_0').setType('VEC2')
      .setArray(new Float32Array(data.uvs)).setBuffer(buffer));
  }
  document.createScene('Scene').addChild(
    document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)),
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await new NodeIO().write(file, document);
  return { file, triangles: data.triangles, vertices: data.positions.length / 3 };
}

const deliveries = [
  ['crate-stack-v1.glb', 'crate-stack-v1', buildCrates(), true],
  ['derived/crate-stack-v1.lod1.glb', 'crate-stack-v1.lod1', buildCrates(), true],
  ['derived/crate-stack-v1.lod2.glb', 'crate-stack-v1.lod2', buildCrates(), true],
  ['derived/crate-stack-v1.shadow.glb', 'crate-stack-v1.shadow', buildCrateShadow(), false],
  ['flower-bed-v1.glb', 'flower-bed-v1', buildFlowerBed(true), true],
  ['derived/flower-bed-v1.lod1.glb', 'flower-bed-v1.lod1', buildFlowerBed(true), true],
  ['derived/flower-bed-v1.lod2.glb', 'flower-bed-v1.lod2', buildFlowerBed(false), true],
  ['derived/flower-bed-v1.shadow.glb', 'flower-bed-v1.shadow', buildFlowerShadow(), false],
];
const report = [];
for (const [relative, name, data, textured] of deliveries) {
  report.push(await writeGlb(path.join(outputRoot, relative), name, data, textured));
}
console.log(JSON.stringify({ outputRoot, deliveries: report }, null, 2));

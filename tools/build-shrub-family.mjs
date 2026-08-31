#!/usr/bin/env node

/** Build compact card-based bush and hedge LOD families. */

import fs from 'node:fs/promises';
import path from 'node:path';

import { Document, NodeIO } from '@gltf-transform/core';

const args = process.argv.slice(2);
const outputFlag = args.indexOf('--output-root');
const outputRoot = path.resolve(outputFlag >= 0
  ? args[outputFlag + 1]
  : 'packages/assets/game/environment/shrub');
if (outputFlag >= 0 && !args[outputFlag + 1]) {
  throw new Error('usage: node tools/build-shrub-family.mjs [--output-root <directory>]');
}
const TAU = Math.PI * 2;

function hash(seed) {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function geometry() {
  return { positions: [], normals: [], colours: [], uvs: [], indices: [], triangles: 0 };
}

function atlasUv(cell) {
  const column = cell % 2;
  const row = Math.floor(cell / 2);
  const inset = 0.004;
  const uv = {
    u0: column * 0.5 + inset,
    u1: (column + 1) * 0.5 - inset,
    v0: (1 - row) * 0.5 + inset,
    v1: (2 - row) * 0.5 - inset,
  };
  // Cell 2 preserves the wide source hedge panel inside a square atlas cell.
  // Crop its transparent vertical padding in UV space so the card keeps the
  // photographic leaf aspect instead of stretching the panel to a square.
  if (cell === 2) {
    uv.v0 = 0.153;
    uv.v1 = 0.347;
  } else if (cell === 3) {
    uv.v0 = 0.024;
    uv.v1 = 0.478;
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

function appendCard(target, options) {
  const { x, z, bottom, width, height, yaw, lean, cell, value } = options;
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const normal = [Math.sin(yaw), 0, Math.cos(yaw)];
  const topOffset = [normal[0] * lean, height, normal[2] * lean];
  const half = width * 0.5;
  appendQuad(target, [
    [x - right[0] * half, bottom, z - right[2] * half],
    [x + right[0] * half, bottom, z + right[2] * half],
    [x + right[0] * half + topOffset[0], bottom + topOffset[1], z + right[2] * half + topOffset[2]],
    [x - right[0] * half + topOffset[0], bottom + topOffset[1], z - right[2] * half + topOffset[2]],
  ], normal, cell, value);
}

function appendTopCard(target, options) {
  const { x, y, z, width, depth, yaw, cell, value } = options;
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const forward = [Math.sin(yaw), 0, Math.cos(yaw)];
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  appendQuad(target, [
    [x - right[0] * halfWidth - forward[0] * halfDepth, y, z - right[2] * halfWidth - forward[2] * halfDepth],
    [x - right[0] * halfWidth + forward[0] * halfDepth, y, z - right[2] * halfWidth + forward[2] * halfDepth],
    [x + right[0] * halfWidth + forward[0] * halfDepth, y, z + right[2] * halfWidth + forward[2] * halfDepth],
    [x + right[0] * halfWidth - forward[0] * halfDepth, y, z + right[2] * halfWidth - forward[2] * halfDepth],
  ], [0, 1, 0], cell, value);
}

function buildBush(cardCount, topCards) {
  const target = geometry();
  const seed = 7301;
  for (let i = 0; i < cardCount; i++) {
    const angle = i / cardCount * TAU + (hash(seed + i * 31) - 0.5) * 0.48;
    const ring = i % 3;
    const radius = ring === 0 ? 0.08 : ring === 1 ? 0.27 : 0.43;
    const width = 0.82 + hash(seed + i * 43) * 0.44;
    const height = 1.28 + hash(seed + i * 59) * 0.47;
    appendCard(target, {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      bottom: 0.02 + ring * 0.015,
      width,
      height,
      yaw: angle + Math.PI * 0.5,
      lean: (hash(seed + i * 71) - 0.42) * 0.18,
      cell: i % 2,
      value: 0.91 + hash(seed + i * 83) * 0.14,
    });
  }
  for (let i = 0; i < topCards; i++) {
    appendTopCard(target, {
      x: (hash(seed + i * 101) - 0.5) * 0.28,
      y: 1.0 + i * 0.18,
      z: (hash(seed + i * 113) - 0.5) * 0.28,
      width: 1.42 - i * 0.18,
      depth: 1.30 - i * 0.14,
      yaw: hash(seed + i * 127) * TAU,
      cell: 2 + (i % 2),
      value: 1.03,
    });
  }
  return target;
}

function buildHedge(detail) {
  const target = geometry();
  const length = 3.0;
  const width = 0.92;
  const height = 1.3;
  for (const side of [-1, 1]) {
    appendCard(target, {
      x: 0,
      z: side * width * 0.43,
      bottom: 0.01,
      width: length * 1.015,
      height,
      yaw: side > 0 ? 0 : Math.PI,
      lean: side * 0.02,
      cell: 2,
      value: side > 0 ? 1.0 : 0.94,
    });
  }
  appendTopCard(target, {
    x: 0,
    y: height * 0.91,
    z: 0,
    width: length * 0.98,
    depth: width * 0.94,
    yaw: 0,
    cell: 2,
    value: 1.06,
  });
  for (const side of [-1, 1]) {
    appendCard(target, {
      x: side * length * 0.49,
      z: 0,
      bottom: 0.01,
      width: width,
      height,
      yaw: side > 0 ? -Math.PI * 0.5 : Math.PI * 0.5,
      lean: 0,
      cell: 3,
      value: 0.98,
    });
  }
  if (detail > 1) {
    appendCard(target, {
      x: 0,
      z: 0,
      bottom: 0.02,
      width: length * 0.96,
      height: height * 0.94,
      yaw: 0,
      lean: 0,
      cell: 2,
      value: 0.97,
    });
  }
  return target;
}

function appendEllipsoid(target, {
  x = 0, z = 0, radiusX, radiusZ, height, rings, segments,
}) {
  const ringVertices = [];
  for (let ring = 1; ring < rings; ring++) {
    const phi = -Math.PI * 0.5 + Math.PI * ring / rings;
    const row = [];
    for (let segment = 0; segment < segments; segment++) {
      const theta = segment / segments * TAU;
      const position = [
        x + Math.cos(phi) * Math.cos(theta) * radiusX,
        (Math.sin(phi) * 0.5 + 0.5) * height,
        z + Math.cos(phi) * Math.sin(theta) * radiusZ,
      ];
      const normal = [
        (position[0] - x) / radiusX,
        (position[1] - height * 0.5) / (height * 0.5),
        (position[2] - z) / radiusZ,
      ];
      const normalLength = Math.hypot(...normal);
      const index = target.positions.length / 3;
      target.positions.push(...position);
      target.normals.push(...normal.map((component) => component / normalLength));
      target.colours.push(0.9, 0.9, 0.9);
      row.push(index);
    }
    ringVertices.push(row);
  }
  const bottom = target.positions.length / 3;
  target.positions.push(x, 0, z);
  target.normals.push(0, -1, 0);
  target.colours.push(0.9, 0.9, 0.9);
  const top = target.positions.length / 3;
  target.positions.push(x, height, z);
  target.normals.push(0, 1, 0);
  target.colours.push(1, 1, 1);
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    target.indices.push(bottom, ringVertices[0][next], ringVertices[0][segment]);
    target.indices.push(top, ringVertices.at(-1)[segment], ringVertices.at(-1)[next]);
    target.triangles += 2;
    for (let ring = 0; ring < ringVertices.length - 1; ring++) {
      const a = ringVertices[ring][segment];
      const b = ringVertices[ring][next];
      const c = ringVertices[ring + 1][next];
      const d = ringVertices[ring + 1][segment];
      target.indices.push(a, b, c, a, c, d);
      target.triangles += 2;
    }
  }
}

function appendBox(target, width, height, depth) {
  const x = width * 0.5;
  const z = depth * 0.5;
  const faces = [
    [[-x, 0, z], [x, 0, z], [x, height, z], [-x, height, z], [0, 0, 1]],
    [[x, 0, -z], [-x, 0, -z], [-x, height, -z], [x, height, -z], [0, 0, -1]],
    [[x, 0, z], [x, 0, -z], [x, height, -z], [x, height, z], [1, 0, 0]],
    [[-x, 0, -z], [-x, 0, z], [-x, height, z], [-x, height, -z], [-1, 0, 0]],
    [[-x, height, z], [x, height, z], [x, height, -z], [-x, height, -z], [0, 1, 0]],
    [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [0, -1, 0]],
  ];
  for (const [a, b, c, d, normal] of faces) appendQuad(target, [a, b, c, d], normal, 0, 0.9);
}

function buildBushShadow() {
  const target = geometry();
  // Three compact, lightly overlapping lobes follow the upright card clusters
  // without merging into the old detached octagonal puddle. Instance yaw
  // rotates this deliberately asymmetric silhouette with each placement.
  appendEllipsoid(target, {
    x: -0.32, z: 0.12, radiusX: 0.27, radiusZ: 0.23,
    height: 1.45, rings: 2, segments: 8,
  });
  appendEllipsoid(target, {
    x: 0, z: -0.12, radiusX: 0.29, radiusZ: 0.24,
    height: 1.48, rings: 2, segments: 8,
  });
  appendEllipsoid(target, {
    x: 0.34, z: 0.09, radiusX: 0.25, radiusZ: 0.21,
    height: 1.32, rings: 2, segments: 8,
  });
  return target;
}

function buildHedgeShadow() {
  const target = geometry();
  appendBox(target, 2.9, 1.2, 0.82);
  return target;
}

async function writeGlb(file, name, data, cards) {
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
  const material = document.createMaterial(cards ? 'shrub.shared-card' : 'shrub.shadow')
    .setBaseColorFactor([0.21, 0.29, 0.08, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.9)
    .setDoubleSided(cards);
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', positions)
    .setAttribute('NORMAL', normals)
    .setAttribute('COLOR_0', colours)
    .setIndices(indices)
    .setMaterial(material);
  if (cards) {
    const uvs = document.createAccessor('TEXCOORD_0').setType('VEC2')
      .setArray(new Float32Array(data.uvs)).setBuffer(buffer);
    primitive.setAttribute('TEXCOORD_0', uvs);
  }
  document.createScene('Scene').addChild(
    document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)),
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await new NodeIO().write(file, document);
  return { file, triangles: data.triangles, vertices: data.positions.length / 3 };
}

const deliveries = [
  ['bush-v1.glb', 'bush-v1', buildBush(14, 0), true],
  ['derived/bush-v1.lod1.glb', 'bush-v1.lod1', buildBush(8, 0), true],
  ['derived/bush-v1.lod2.glb', 'bush-v1.lod2', buildBush(3, 0), true],
  ['derived/bush-v1.shadow.glb', 'bush-v1.shadow', buildBushShadow(), false],
  ['hedge-v1.glb', 'hedge-v1', buildHedge(2), true],
  ['derived/hedge-v1.lod1.glb', 'hedge-v1.lod1', buildHedge(1), true],
  ['derived/hedge-v1.lod2.glb', 'hedge-v1.lod2', buildHedge(1), true],
  ['derived/hedge-v1.shadow.glb', 'hedge-v1.shadow', buildHedgeShadow(), false],
];
const report = [];
for (const [relative, name, data, cards] of deliveries) {
  report.push(await writeGlb(path.join(outputRoot, relative), name, data, cards));
}
console.log(JSON.stringify({ outputRoot, deliveries: report }, null, 2));

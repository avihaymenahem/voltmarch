#!/usr/bin/env node

/** Build compact card-and-trunk LOD families for the remaining vegetation keys. */

import fs from 'node:fs/promises';
import path from 'node:path';

import { Document, NodeIO } from '@gltf-transform/core';

const root = path.resolve('packages/assets/game/environment/extended-foliage');
const TAU = Math.PI * 2;

// Each point sits well inside a large opaque part of its atlas cell. The old
// 8 px bark swatch at the atlas corner was opaque at LOD0 but disappeared into
// transparent neighbours in lower texture mips, so distant alpha-tested trunks
// vanished. These samples retain at least 33 texels of opaque coverage around
// them in the source atlas and therefore survive the full gameplay mip range.
const OPAQUE_CELL_UV = Object.freeze([
  [0.184751, 0.760508],
  [620 / 1024, 1 - 308 / 1024],
  [0.267840, 0.266862],
  [0.771261, 0.117302],
]);
// Inset six texels from the dedicated opaque bark plate written by
// build-extended-foliage-pbr.mjs. UV V is inverted from image-space Y.
const CONIFER_BARK_UV = Object.freeze({
  u0: 526 / 1024,
  u1: 602 / 1024,
  v0: 1 - 130 / 1024,
  v1: 1 - 14 / 1024,
});
const CONIFER_CROWN_UV = Object.freeze({
  u0: 720 / 1024,
  u1: 1006 / 1024,
  v0: 1 - 494 / 1024,
  v1: 1 - 18 / 1024,
});
const CONIFER_BRANCH_UV = Object.freeze({
  u0: 528 / 1024,
  u1: 696 / 1024,
  v0: 1 - 486 / 1024,
  v1: 1 - 152 / 1024,
});

function geometry() {
  return { positions: [], normals: [], colours: [], uvs: [], indices: [], triangles: 0 };
}

function cellUv(cell, point = false) {
  const x = cell % 2;
  const y = Math.floor(cell / 2);
  if (point) {
    const [u, v] = OPAQUE_CELL_UV[cell];
    return { u0: u, u1: u, v0: v, v1: v };
  }
  if (cell === 1) return CONIFER_CROWN_UV;
  const inset = 0.008;
  return {
    u0: x * 0.5 + inset,
    u1: (x + 1) * 0.5 - inset,
    v0: (1 - y) * 0.5 + inset,
    v1: (2 - y) * 0.5 - inset,
  };
}

function appendQuad(target, vertices, normal, cell, colour = [1, 1, 1], pointUv = false, uvOverride) {
  const base = target.positions.length / 3;
  const uv = uvOverride ?? cellUv(cell, pointUv);
  const texcoords = [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]];
  for (let i = 0; i < 4; i++) {
    target.positions.push(...vertices[i]);
    target.normals.push(...normal);
    target.colours.push(...colour);
    target.uvs.push(...texcoords[i]);
  }
  target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  target.triangles += 2;
}

function appendVerticalCard(target, { x = 0, y = 0, z = 0, width, height, yaw, cell, colour = [1, 1, 1], lean = 0 }) {
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const normal = [Math.sin(yaw), 0, Math.cos(yaw)];
  const half = width * 0.5;
  appendQuad(target, [
    [x - right[0] * half, y, z - right[2] * half],
    [x + right[0] * half, y, z + right[2] * half],
    [x + right[0] * half + normal[0] * lean, y + height, z + right[2] * half + normal[2] * lean],
    [x - right[0] * half + normal[0] * lean, y + height, z - right[2] * half + normal[2] * lean],
  ], normal, cell, colour);
}

function appendHorizontalCard(target, {
  x = 0, y, z = 0, width, depth, yaw = 0, cell, colour = [1, 1, 1], uv,
}) {
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const forward = [Math.sin(yaw), 0, Math.cos(yaw)];
  const hw = width * 0.5;
  const hd = depth * 0.5;
  appendQuad(target, [
    [x - right[0] * hw - forward[0] * hd, y, z - right[2] * hw - forward[2] * hd],
    [x - right[0] * hw + forward[0] * hd, y, z - right[2] * hw + forward[2] * hd],
    [x + right[0] * hw + forward[0] * hd, y, z + right[2] * hw + forward[2] * hd],
    [x + right[0] * hw - forward[0] * hd, y, z + right[2] * hw - forward[2] * hd],
  ], [0, 1, 0], cell, colour, false, uv);
}

function appendTiltedCard(target, {
  x = 0, y = 0, z = 0, width, height, yaw, pitch = 0, cell, colour = [1, 1, 1], uv,
}) {
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const facing = [Math.sin(yaw), 0, Math.cos(yaw)];
  const up = [facing[0] * Math.sin(pitch), Math.cos(pitch), facing[2] * Math.sin(pitch)];
  const normal = [-facing[0] * Math.cos(pitch), Math.sin(pitch), -facing[2] * Math.cos(pitch)];
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  appendQuad(target, [
    [x - right[0] * halfWidth - up[0] * halfHeight, y - up[1] * halfHeight, z - right[2] * halfWidth - up[2] * halfHeight],
    [x + right[0] * halfWidth - up[0] * halfHeight, y - up[1] * halfHeight, z + right[2] * halfWidth - up[2] * halfHeight],
    [x + right[0] * halfWidth + up[0] * halfHeight, y + up[1] * halfHeight, z + right[2] * halfWidth + up[2] * halfHeight],
    [x - right[0] * halfWidth + up[0] * halfHeight, y + up[1] * halfHeight, z - right[2] * halfWidth + up[2] * halfHeight],
  ], normal, cell, colour, false, uv);
}

function appendFrustum(target, { x = 0, y = 0, z = 0, height, bottom, top, sides = 8, cell = 0, colour = [1.0, 0.92, 0.82] }) {
  const uv = cellUv(cell, true);
  const bottomRing = [];
  const topRing = [];
  for (let i = 0; i < sides; i++) {
    const angle = i / sides * TAU;
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    for (const [radius, yy, ring] of [[bottom, y, bottomRing], [top, y + height, topRing]]) {
      const index = target.positions.length / 3;
      target.positions.push(x + nx * radius, yy, z + nz * radius);
      target.normals.push(nx, (bottom - top) / Math.max(height, 0.001), nz);
      target.colours.push(...colour);
      target.uvs.push(uv.u0, uv.v0);
      ring.push(index);
    }
  }
  const bottomCenter = target.positions.length / 3;
  target.positions.push(x, y, z); target.normals.push(0, -1, 0); target.colours.push(...colour); target.uvs.push(uv.u0, uv.v0);
  const topCenter = target.positions.length / 3;
  target.positions.push(x, y + height, z); target.normals.push(0, 1, 0); target.colours.push(...colour); target.uvs.push(uv.u0, uv.v0);
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    target.indices.push(bottomRing[i], bottomRing[next], topRing[next], bottomRing[i], topRing[next], topRing[i]);
    target.indices.push(bottomCenter, bottomRing[next], bottomRing[i], topCenter, topRing[i], topRing[next]);
    target.triangles += 4;
  }
}

function appendConiferBarkTrunk(target, {
  height, bottom, top, sides = 9,
}) {
  const uv = CONIFER_BARK_UV;
  const capUv = [(uv.u0 + uv.u1) * 0.5, (uv.v0 + uv.v1) * 0.5];
  for (let side = 0; side < sides; side++) {
    const a0 = side / sides * TAU;
    const a1 = (side + 1) / sides * TAU;
    const mid = (a0 + a1) * 0.5;
    const normal = [Math.cos(mid), (bottom - top) / Math.max(height, 0.001), Math.sin(mid)];
    const brightness = 0.94 + 0.08 * Math.cos(mid * 2.0);
    const colour = [brightness, brightness, brightness];
    const base = target.positions.length / 3;
    const vertices = [
      [Math.cos(a0) * bottom, 0, Math.sin(a0) * bottom],
      [Math.cos(a1) * bottom, 0, Math.sin(a1) * bottom],
      [Math.cos(a1) * top, height, Math.sin(a1) * top],
      [Math.cos(a0) * top, height, Math.sin(a0) * top],
    ];
    const texcoords = [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]];
    for (let i = 0; i < 4; i++) {
      target.positions.push(...vertices[i]);
      target.normals.push(...normal);
      target.colours.push(...colour);
      target.uvs.push(...texcoords[i]);
    }
    target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    target.triangles += 2;

    for (const [yy, radius, ny, reverse] of [[0, bottom, -1, true], [height, top, 1, false]]) {
      const cap = target.positions.length / 3;
      const capVertices = [
        [0, yy, 0],
        [Math.cos(a0) * radius, yy, Math.sin(a0) * radius],
        [Math.cos(a1) * radius, yy, Math.sin(a1) * radius],
      ];
      for (const vertex of capVertices) {
        target.positions.push(...vertex);
        target.normals.push(0, ny, 0);
        target.colours.push(...colour);
        target.uvs.push(...capUv);
      }
      target.indices.push(...(reverse ? [cap, cap + 2, cap + 1] : [cap, cap + 1, cap + 2]));
      target.triangles += 1;
    }
  }
}

function autumn(cards) {
  const g = geometry();
  appendFrustum(g, { height: 5.6, bottom: 0.48, top: 0.25, sides: 9, cell: 0 });
  const lodLobes = [
    [-1.15, 6.40, 0.10, 3.70, 3.30, 0.18, 0.25],
    [1.10, 6.35, -0.10, 3.70, 3.30, 1.70, -0.25],
    [0.00, 6.55, 1.20, 3.60, 3.20, 2.90, 0.32],
    [-0.15, 6.50, -1.20, 3.60, 3.20, 4.18, -0.32],
    [0.05, 7.60, 0.00, 3.50, 3.00, 0.70, 0.62],
    [-1.00, 7.15, -0.70, 3.30, 2.90, 1.00, 0.45],
    [1.00, 7.15, 0.70, 3.30, 2.90, 2.50, -0.45],
    [-0.70, 7.50, 0.80, 3.10, 2.70, 3.70, 0.52],
    [0.75, 7.55, -0.75, 3.10, 2.70, 5.00, -0.52],
    [-1.55, 6.85, 0.65, 3.10, 2.80, 0.40, 0.20],
    [1.45, 6.90, -0.50, 3.10, 2.80, 2.00, -0.20],
    [0.00, 8.15, 0.20, 2.90, 2.50, 1.30, 0.68],
  ].slice(0, cards);
  // Smaller offset lobes build an irregular rounded canopy. The previous
  // centre-crossed cards plus one full-width horizontal card projected as a
  // radial sunflower from the RTS camera, regardless of the leaf texture.
  for (const [x, y, z, width, height, yaw, pitch] of lodLobes) appendTiltedCard(g, {
    x, y, z, width, height, yaw, pitch, cell: 0,
  });
  const topClusters = [
    [-1.00, 7.05, 0.30, 3.20, 3.00, 0.20, [0.88, 0.78, 0.66]],
    [1.00, 7.12, -0.30, 3.25, 3.00, 1.22, [0.78, 0.68, 0.58]],
    [0.10, 7.20, 1.00, 3.05, 2.80, 2.34, [0.94, 0.80, 0.62]],
    [-0.20, 7.28, -1.00, 3.00, 2.75, 3.48, [0.82, 0.70, 0.60]],
  ];
  const topClusterCount = cards >= 12 ? 4 : cards >= 8 ? 3 : 2;
  for (const [x, y, z, width, depth, yaw, colour] of topClusters.slice(0, topClusterCount)) {
    appendHorizontalCard(g, { x, y, z, width, depth, yaw, cell: 0, colour });
  }
  return g;
}

function conifer(verticalCards) {
  const g = geometry();
  appendConiferBarkTrunk(g, { height: 10.45, bottom: 0.48, top: 0.13 });
  // Structured asymmetry: every crossing card remains a connected whole-crown
  // silhouette, while width, height, centre, lean, yaw and colour differ just
  // enough that the needle masses do not collapse into one repeated stamp.
  const crownProfiles = [
    { x: -0.12, y: 0.64, z: 0.08, width: 6.48, height: 9.96, yaw: 0.03,
      lean: 0.13, colour: [1.03, 1.09, 0.97] },
    { x: 0.10, y: 0.82, z: -0.10, width: 6.02, height: 9.68, yaw: -0.07,
      lean: -0.16, colour: [0.91, 1.02, 0.89] },
    { x: 0.06, y: 0.70, z: 0.14, width: 6.30, height: 9.82, yaw: 0.10,
      lean: 0.07, colour: [1.00, 1.04, 0.91] },
    { x: -0.08, y: 0.88, z: -0.05, width: 5.86, height: 9.60, yaw: -0.02,
      lean: -0.11, colour: [0.94, 1.08, 0.96] },
  ];
  for (let card = 0; card < verticalCards; card++) appendVerticalCard(g, {
    ...crownProfiles[card],
    yaw: card / verticalCards * Math.PI + crownProfiles[card].yaw,
    cell: 1,
  });
  appendHorizontalCard(g, {
    x: 0.22,
    y: 4.30,
    z: -0.14,
    width: 5.48,
    depth: 4.62,
    yaw: 0.41,
    cell: 1,
    uv: CONIFER_BRANCH_UV,
    colour: [0.76, 0.91, 0.72],
  });
  return g;
}

function palm(cards) {
  const g = geometry();
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    appendFrustum(g, {
      x: Math.sin(t * 1.8) * 0.13,
      y: i * 1.25,
      z: Math.sin(t * 1.2) * 0.10,
      height: 1.27,
      bottom: 0.43 - i * 0.045,
      top: 0.39 - i * 0.045,
      sides: 8,
      cell: 2,
      colour: [1.02, 0.92, 0.80],
    });
  }
  for (let i = 0; i < cards; i++) {
    appendHorizontalCard(g, {
      y: 6.25 + i * 0.07, width: 7.4 - i * 0.22, depth: 7.2 - i * 0.18,
      yaw: i * 1.21, cell: 2, colour: [0.68, 0.78, 0.48],
    });
  }
  appendVerticalCard(g, { y: 5.6, width: 6.6, height: 2.5, yaw: 0.3, cell: 2, lean: 0.4, colour: [0.76, 0.86, 0.58] });
  appendVerticalCard(g, { y: 5.6, width: 6.6, height: 2.5, yaw: 1.87, cell: 2, lean: -0.3, colour: [0.76, 0.86, 0.58] });
  return g;
}

function grass(cards, golden) {
  const g = geometry();
  const colour = golden ? [1.10, 0.88, 0.45] : [0.82, 1.08, 0.72];
  for (let i = 0; i < cards; i++) {
    appendVerticalCard(g, { y: 0, width: 2.7, height: 2.15, yaw: i / cards * Math.PI, cell: 3, colour, lean: (i % 2 ? 0.18 : -0.14) });
  }
  return g;
}

function shadow(height, radius, sides = 8) {
  const g = geometry();
  appendFrustum(g, { height, bottom: radius * 0.62, top: radius * 0.18, sides, cell: 0, colour: [0.3, 0.3, 0.3] });
  return g;
}

function autumnShadow() {
  const g = geometry();
  appendFrustum(g, { height: 5.2, bottom: 0.48, top: 0.25, sides: 4, cell: 0 });
  appendFrustum(g, { y: 3.5, height: 6.5, bottom: 3.7, top: 1.2, sides: 8, cell: 0 });
  return g;
}

function coniferShadow() {
  const g = geometry();
  appendFrustum(g, { height: 10.8, bottom: 0.45, top: 0.16, sides: 4, cell: 1 });
  appendFrustum(g, { y: 1.45, height: 8.75, bottom: 3.0, top: 0.35, sides: 8, cell: 1 });
  return g;
}

function palmShadow() {
  const g = geometry();
  appendFrustum(g, { height: 6.25, bottom: 0.43, top: 0.20, sides: 4, cell: 2 });
  appendFrustum(g, { y: 5.6, height: 2.7, bottom: 3.4, top: 1.1, sides: 7, cell: 2 });
  return g;
}

async function writeGlb(relative, name, data, textured) {
  const document = new Document();
  const buffer = document.createBuffer(`${name}.buffer`);
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', document.createAccessor('POSITION').setType('VEC3').setArray(new Float32Array(data.positions)).setBuffer(buffer))
    .setAttribute('NORMAL', document.createAccessor('NORMAL').setType('VEC3').setArray(new Float32Array(data.normals)).setBuffer(buffer))
    .setAttribute('COLOR_0', document.createAccessor('COLOR_0').setType('VEC3').setArray(new Float32Array(data.colours)).setBuffer(buffer))
    .setIndices(document.createAccessor('indices').setType('SCALAR').setArray(new Uint16Array(data.indices)).setBuffer(buffer))
    .setMaterial(document.createMaterial(textured ? 'extended-foliage.shared-atlas' : 'extended-foliage.shadow')
      .setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.92).setDoubleSided(textured));
  if (textured) primitive.setAttribute('TEXCOORD_0', document.createAccessor('TEXCOORD_0').setType('VEC2').setArray(new Float32Array(data.uvs)).setBuffer(buffer));
  document.createScene('Scene').addChild(document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)));
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await new NodeIO().write(file, document);
  return { file: relative, triangles: data.triangles, vertices: data.positions.length / 3 };
}

const definitions = [
  ['tree-autumn-v1', [autumn(12), autumn(8), autumn(5), autumnShadow()]],
  ['conifer-v1', [conifer(4), conifer(3), conifer(2), coniferShadow()]],
  ['palm-v1', [palm(3), palm(2), palm(1), palmShadow()]],
  // Grass still needs a readable contact shadow, but the caster must follow
  // the blade fan rather than project a broad opaque stump.
  ['grass-tuft-v1', [grass(4, true), grass(3, true), grass(2, true), shadow(1.55, 0.38, 6)]],
  ['grass-tuft-green-v1', [grass(4, false), grass(3, false), grass(2, false), shadow(1.55, 0.38, 6)]],
];
const roles = ['lod0', 'lod1', 'lod2', 'shadow'];
const report = [];
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
for (const [name, builds] of definitions) {
  if (only !== undefined && name !== only) continue;
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const relative = role === 'lod0' ? `${name}.glb` : `derived/${name}.${role}.glb`;
    report.push(await writeGlb(relative, `${name}.${role}`, builds[i], role !== 'shadow'));
  }
}
console.log(JSON.stringify({ root, deliveries: report }, null, 2));

#!/usr/bin/env node

/** Build compact card-and-trunk LOD families for the remaining vegetation keys. */

import fs from 'node:fs/promises';
import path from 'node:path';

import { Document, NodeIO } from '@gltf-transform/core';

const root = path.resolve('packages/assets/game/environment/extended-foliage');
const TAU = Math.PI * 2;

function geometry() {
  return { positions: [], normals: [], colours: [], uvs: [], indices: [], triangles: 0 };
}

function cellUv(cell, point = false) {
  const x = cell % 2;
  const y = Math.floor(cell / 2);
  if (point) return { u0: 0.003, u1: 0.004, v0: 0.996, v1: 0.997 };
  const inset = 0.008;
  return {
    u0: x * 0.5 + inset,
    u1: (x + 1) * 0.5 - inset,
    v0: (1 - y) * 0.5 + inset,
    v1: (2 - y) * 0.5 - inset,
  };
}

function appendQuad(target, vertices, normal, cell, colour = [1, 1, 1], pointUv = false) {
  const base = target.positions.length / 3;
  const uv = cellUv(cell, pointUv);
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

function appendHorizontalCard(target, { x = 0, y, z = 0, width, depth, yaw = 0, cell, colour = [1, 1, 1] }) {
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const forward = [Math.sin(yaw), 0, Math.cos(yaw)];
  const hw = width * 0.5;
  const hd = depth * 0.5;
  appendQuad(target, [
    [x - right[0] * hw - forward[0] * hd, y, z - right[2] * hw - forward[2] * hd],
    [x - right[0] * hw + forward[0] * hd, y, z - right[2] * hw + forward[2] * hd],
    [x + right[0] * hw + forward[0] * hd, y, z + right[2] * hw + forward[2] * hd],
    [x + right[0] * hw - forward[0] * hd, y, z + right[2] * hw - forward[2] * hd],
  ], [0, 1, 0], cell, colour);
}

function appendFrustum(target, { x = 0, y = 0, z = 0, height, bottom, top, sides = 8, cell = 0, colour = [1.0, 0.92, 0.82] }) {
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
      const uv = cellUv(cell, true);
      target.uvs.push(uv.u0, uv.v0);
      ring.push(index);
    }
  }
  const bottomCenter = target.positions.length / 3;
  target.positions.push(x, y, z); target.normals.push(0, -1, 0); target.colours.push(...colour); target.uvs.push(0, 0);
  const topCenter = target.positions.length / 3;
  target.positions.push(x, y + height, z); target.normals.push(0, 1, 0); target.colours.push(...colour); target.uvs.push(0, 0);
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    target.indices.push(bottomRing[i], bottomRing[next], topRing[next], bottomRing[i], topRing[next], topRing[i]);
    target.indices.push(bottomCenter, bottomRing[next], bottomRing[i], topCenter, topRing[i], topRing[next]);
    target.triangles += 4;
  }
}

function autumn(cards) {
  const g = geometry();
  appendFrustum(g, { height: 5.6, bottom: 0.48, top: 0.25, sides: 9, cell: 0 });
  const layers = [
    [3.6, 6.8, 4.4], [4.5, 7.5, 4.8], [5.4, 6.8, 4.4], [6.2, 5.5, 3.8],
  ];
  for (let i = 0; i < cards; i++) {
    const layer = layers[i % layers.length];
    appendVerticalCard(g, { y: layer[0], width: layer[1], height: layer[2], yaw: i * 2.39996, cell: 0, lean: (i % 2 ? -0.25 : 0.28) });
  }
  appendHorizontalCard(g, {
    y: 7.4, width: 6.5, depth: 6.2, yaw: 0.35, cell: 0,
    colour: [0.72, 0.54, 0.34],
  });
  return g;
}

function conifer(cards) {
  const g = geometry();
  appendFrustum(g, { height: 10.8, bottom: 0.45, top: 0.16, sides: 9, cell: 1, colour: [0.90, 0.82, 0.72] });
  for (let i = 0; i < cards; i++) {
    const t = i / Math.max(1, cards - 1);
    const y = 1.5 + t * 8.2;
    const width = 6.0 - t * 3.5;
    appendVerticalCard(g, { y, width, height: 2.8 - t * 0.9, yaw: i * 2.17, cell: 1, lean: 0.18 });
    if (i % 2 === 0) appendHorizontalCard(g, {
      y: y + 0.8, width, depth: width * 0.88, yaw: i * 0.47, cell: 1,
      colour: [0.52, 0.68, 0.46],
    });
  }
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
  ['tree-autumn-v1', [autumn(8), autumn(5), autumn(3), shadow(9.0, 3.8, 10)]],
  ['conifer-v1', [conifer(15), conifer(9), conifer(5), shadow(11.0, 3.0, 10)]],
  ['palm-v1', [palm(3), palm(2), palm(1), shadow(8.3, 3.4, 9)]],
  ['grass-tuft-v1', [grass(4, true), grass(3, true), grass(2, true), shadow(1.9, 0.8, 6)]],
  ['grass-tuft-green-v1', [grass(4, false), grass(3, false), grass(2, false), shadow(1.9, 0.8, 6)]],
];
const roles = ['lod0', 'lod1', 'lod2', 'shadow'];
const report = [];
for (const [name, builds] of definitions) {
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const relative = role === 'lod0' ? `${name}.glb` : `derived/${name}.${role}.glb`;
    report.push(await writeGlb(relative, `${name}.${role}`, builds[i], role !== 'shadow'));
  }
}
console.log(JSON.stringify({ root, deliveries: report }, null, 2));

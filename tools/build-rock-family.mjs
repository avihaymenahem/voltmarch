#!/usr/bin/env node

/**
 * Build the shared-material mineral family used by FoliageEngine. Rock shape
 * is carried by closed geometry; cylindrical UVs feed one cached PBR material
 * while broad value variation remains in COLOR_0 for biome tinting.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { Document, NodeIO } from '@gltf-transform/core';

const args = process.argv.slice(2);
const outputFlag = args.indexOf('--output-root');
const outputRoot = path.resolve(outputFlag >= 0
  ? args[outputFlag + 1]
  : 'packages/assets/game/environment/mineral');
if (outputFlag >= 0 && !args[outputFlag + 1]) {
  throw new Error('usage: node tools/build-rock-family.mjs [--output-root <directory>]');
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function hash(seed) {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function rotateY(vertex, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [vertex[0] * c - vertex[2] * s, vertex[1], vertex[0] * s + vertex[2] * c];
}

function appendTriangle(target, a0, b0, c0, centre, seed) {
  let a = a0;
  let b = b0;
  let c = c0;
  const normal = () => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const length = Math.hypot(...n) || 1;
    return n.map((component) => component / length);
  };
  let n = normal();
  const centroid = [
    (a[0] + b[0] + c[0]) / 3,
    (a[1] + b[1] + c[1]) / 3,
    (a[2] + b[2] + c[2]) / 3,
  ];
  const outward = [
    centroid[0] - centre[0],
    centroid[1] - centre[1],
    centroid[2] - centre[2],
  ];
  if (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) {
    [b, c] = [c, b];
    n = normal();
  }

  const topLight = Math.max(0, n[1]);
  const underside = Math.max(0, -n[1]);
  const stratum = Math.sin(centroid[1] * 7.1 + seed * 0.37) * 0.008;
  const facet = (hash(seed * 131 + target.triangles * 17) - 0.5) * 0.012;
  const value = clamp(0.87 + topLight * 0.13 - underside * 0.08 + stratum + facet, 0.72, 1.05);
  const base = target.positions.length / 3;
  const vertices = [a, b, c];
  const rockHeight = centre[1] / 0.45;
  const uvs = vertices.map((vertex) => [
    Math.atan2(vertex[2] - centre[2], vertex[0] - centre[0]) / (Math.PI * 2) + 0.5,
    clamp(vertex[1] / rockHeight, 0, 1),
  ]);
  const uValues = uvs.map((uv) => uv[0]);
  if (Math.max(...uValues) - Math.min(...uValues) > 0.5) {
    for (const uv of uvs) if (uv[0] < 0.5) uv[0] += 1;
  }
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];
    const radialDistance = Math.hypot(vertex[0] - centre[0], vertex[2] - centre[2]);
    if (radialDistance < 1e-5) {
      const others = uvs.filter((_, index) => index !== i);
      uvs[i][0] = (others[0][0] + others[1][0]) * 0.5;
    }
    const radial = [
      vertex[0] - centre[0],
      (vertex[1] - centre[1]) * 0.82,
      vertex[2] - centre[2],
    ];
    const radialLength = Math.hypot(...radial) || 1;
    const shaded = [
      n[0] * 0.16 + radial[0] / radialLength * 0.84,
      n[1] * 0.16 + radial[1] / radialLength * 0.84,
      n[2] * 0.16 + radial[2] / radialLength * 0.84,
    ];
    const shadedLength = Math.hypot(...shaded) || 1;
    target.positions.push(...vertex);
    target.normals.push(...shaded.map((component) => component / shadedLength));
    target.colours.push(value, value, value);
    target.uvs.push(...uvs[i]);
  }
  target.indices.push(base, base + 1, base + 2);
  target.triangles += 1;
}

function appendRock(target, options) {
  const {
    centreX, centreZ, width, depth, height, levels, segments, yaw, seed,
  } = options;
  const centre = [centreX, height * 0.45, centreZ];
  const rings = [];

  for (let level = 0; level < levels; level++) {
    const t = level / (levels - 1);
    // Side rings stop below the summit so the final cap is sloped rather than
    // a flat circular lid. A wide foot avoids the dark undercut/mushroom read.
    const baseY = height * 0.88 * Math.pow(t, 0.94);
    const profile = 0.85 + Math.sin(Math.PI * t) * 0.22 - t * 0.32;
    const ring = [];
    for (let segment = 0; segment < segments; segment++) {
      const phase = (level % 2) * 0.39 + level * 0.073;
      const angle = (segment + phase) / segments * Math.PI * 2;
      const broad = Math.sin(angle * 3 + seed * 0.41) * 0.11
        + Math.sin(angle * 5 - t * 2.1 + seed) * 0.055;
      const ledge = (Math.floor(t * 4) - t * 4) * 0.012;
      const asymmetry = 1 + broad + ledge + (t - 0.45) * Math.cos(angle - 0.7) * 0.12;
      const shearX = (t - 0.32) * width * 0.13;
      const shearZ = Math.sin(t * 2.7 + seed) * depth * 0.08;
      const ringBreak = level === 0 ? 0 : (
        Math.sin(angle * 2 + seed * 0.7) * height * 0.022
        + (hash(seed + level * 97 + segment * 13) - 0.5) * height * 0.025
      );
      const local = [
        Math.cos(angle) * width * profile * asymmetry + shearX,
        baseY + ringBreak,
        Math.sin(angle) * depth * profile * (1 + broad * 0.72) + shearZ,
      ];
      const rotated = rotateY(local, yaw);
      ring.push([rotated[0] + centreX, rotated[1], rotated[2] + centreZ]);
    }
    rings.push(ring);
  }

  for (let level = 0; level < levels - 1; level++) {
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      const a = rings[level][segment];
      const b = rings[level][next];
      const c = rings[level + 1][next];
      const d = rings[level + 1][segment];
      appendTriangle(target, a, b, c, centre, seed + level * 97 + segment);
      appendTriangle(target, a, c, d, centre, seed + level * 97 + segment + 41);
    }
  }

  const baseCentre = [centreX, 0, centreZ];
  const topCentreLocal = rotateY([
    width * (0.10 + (hash(seed + 71) - 0.5) * 0.12),
    height,
    -depth * (0.07 + (hash(seed + 79) - 0.5) * 0.10),
  ], yaw);
  const topCentre = [
    centreX + topCentreLocal[0],
    topCentreLocal[1],
    centreZ + topCentreLocal[2],
  ];
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    appendTriangle(target, baseCentre, rings[0][segment], rings[0][next], centre, seed + segment);
    appendTriangle(
      target,
      topCentre,
      rings[levels - 1][next],
      rings[levels - 1][segment],
      centre,
      seed + 500 + segment,
    );
  }
}

function geometry() {
  return { positions: [], normals: [], colours: [], uvs: [], indices: [], triangles: 0 };
}

function buildBoulder(levels, segments) {
  const target = geometry();
  appendRock(target, {
    centreX: 0,
    centreZ: 0,
    width: 1.72,
    depth: 1.42,
    height: 2.8,
    levels,
    segments,
    yaw: 0.28,
    seed: 1701,
  });
  return target;
}

const CLUSTER = [
  [-0.68, 0.12, 0.78, 0.62, 1.14, 0.18, 211],
  [0.28, -0.12, 0.96, 0.72, 1.22, -0.34, 307],
  [0.86, 0.42, 0.61, 0.52, 0.78, 0.72, 401],
  [-0.04, 0.68, 0.56, 0.48, 0.68, -0.86, 503],
  [-1.08, -0.36, 0.48, 0.42, 0.61, 1.04, 601],
];

function buildCluster(levels, segments) {
  const target = geometry();
  for (const [x, z, width, depth, height, yaw, seed] of CLUSTER) {
    appendRock(target, {
      centreX: x,
      centreZ: z,
      width,
      depth,
      height,
      levels,
      segments,
      yaw,
      seed,
    });
  }
  return target;
}

async function writeGlb(file, name, data) {
  const document = new Document();
  const buffer = document.createBuffer(`${name}.buffer`);
  const positions = document.createAccessor('POSITION').setType('VEC3')
    .setArray(new Float32Array(data.positions)).setBuffer(buffer);
  const normals = document.createAccessor('NORMAL').setType('VEC3')
    .setArray(new Float32Array(data.normals)).setBuffer(buffer);
  const colours = document.createAccessor('COLOR_0').setType('VEC3')
    .setArray(new Float32Array(data.colours)).setBuffer(buffer);
  const uvs = document.createAccessor('TEXCOORD_0').setType('VEC2')
    .setArray(new Float32Array(data.uvs)).setBuffer(buffer);
  const indexArray = data.positions.length / 3 > 65535
    ? new Uint32Array(data.indices)
    : new Uint16Array(data.indices);
  const indices = document.createAccessor('indices').setType('SCALAR')
    .setArray(indexArray).setBuffer(buffer);
  // Linearized #8A8270. Vertex colour stores a scalar; runtime replaces this
  // factor with the selected biome's rock palette while preserving the scalar.
  const material = document.createMaterial('mineral.shared-vertex')
    .setBaseColorFactor([0.2542, 0.2232, 0.1620, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.92)
    .setDoubleSided(false);
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', positions)
    .setAttribute('NORMAL', normals)
    .setAttribute('COLOR_0', colours)
    .setAttribute('TEXCOORD_0', uvs)
    .setIndices(indices)
    .setMaterial(material);
  const mesh = document.createMesh(name).addPrimitive(primitive);
  document.createScene('Scene').addChild(document.createNode(name).setMesh(mesh));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await new NodeIO().write(file, document);
  return { file, triangles: data.triangles, vertices: data.positions.length / 3 };
}

const deliveries = [
  ['boulder-v1.glb', 'boulder-v1', buildBoulder(12, 24)],
  ['derived/boulder-v1.lod1.glb', 'boulder-v1.lod1', buildBoulder(8, 14)],
  ['derived/boulder-v1.lod2.glb', 'boulder-v1.lod2', buildBoulder(5, 10)],
  ['derived/boulder-v1.shadow.glb', 'boulder-v1.shadow', buildBoulder(6, 12)],
  ['rock-cluster-v1.glb', 'rock-cluster-v1', buildCluster(5, 9)],
  ['derived/rock-cluster-v1.lod1.glb', 'rock-cluster-v1.lod1', buildCluster(4, 6)],
  ['derived/rock-cluster-v1.lod2.glb', 'rock-cluster-v1.lod2', buildCluster(3, 4)],
  ['derived/rock-cluster-v1.shadow.glb', 'rock-cluster-v1.shadow', buildCluster(3, 5)],
];

const report = [];
for (const [relative, name, data] of deliveries) {
  report.push(await writeGlb(path.join(outputRoot, relative), name, data));
}
console.log(JSON.stringify({ outputRoot, deliveries: report }, null, 2));

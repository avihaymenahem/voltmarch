#!/usr/bin/env node

/**
 * Bake the remaining manufactured PropLibrary silhouettes into static GLBs.
 * Runtime no longer constructs these models; the shared asset engine owns them.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Document, NodeIO } from '@gltf-transform/core';
import { build } from 'esbuild';
import { MeshoptSimplifier } from 'meshoptimizer';

const repo = process.cwd();
const outputRoot = path.resolve('packages/assets/game/environment/prop-surface');
const allKeys = [
  'haystack', 'containerStack', 'barrel',
  'streetLamp', 'streetLampTwin', 'bench', 'carSedan', 'carVan', 'carPickup',
  'trafficLight', 'fence', 'railing', 'telegraphPole', 'roadSign', 'roadSignDisc',
  'cafeUmbrella', 'statue', 'statueRider', 'waterTower',
];
const requestedKey = process.argv.includes('--key')
  ? process.argv[process.argv.indexOf('--key') + 1]
  : undefined;
if (requestedKey !== undefined && !allKeys.includes(requestedKey)) {
  throw new Error(`Unknown static prop key: ${requestedKey}`);
}
const keys = requestedKey === undefined ? allKeys : [requestedKey];

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'voltmarch-static-props-'));
const bundle = path.join(scratch, 'PropLibrary.mjs');
await build({
  entryPoints: [path.join(repo, 'apps/game/src/world/PropLibrary.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  loader: { '.png': 'empty' },
  plugins: [{
    name: 'static-prop-url-stubs',
    setup(context) {
      context.onResolve({ filter: /^@terrain-detail-mask\?url$/ }, () => ({
        path: 'terrain-detail-mask-url', namespace: 'static-prop-stub',
      }));
      context.onLoad({ filter: /.*/, namespace: 'static-prop-stub' }, () => ({
        contents: "export default '';",
        loader: 'js',
      }));
    },
  }],
  logLevel: 'warning',
});
const module = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`);
const library = new module.PropLibrary({ biome: 'temperate', seed: 7, keys });
await MeshoptSimplifier.ready;

function kebab(key) {
  return key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function materialCell(key, r, g, b) {
  if (key === 'haystack') {
    // The approved Meshy canvas occupies the third atlas cell. Keep the pole
    // and three attached supply boxes on the shared timber cell so the camp
    // reads as assembled materials instead of one yellow straw blob.
    const timber = r > g * 1.12 && g > b * 1.08;
    return timber ? 1 : 2;
  }
  if (key === 'cafeUmbrella') return 2;
  if (key === 'telegraphPole') return 1;
  if (key === 'bench') {
    const brown = r > g * 1.18 && g > b * 1.12;
    return brown ? 1 : 0;
  }
  const maximum = Math.max(r, g, b);
  if (maximum < 0.055) return 3;
  return 0;
}

function projectedUv(position, normal, cell) {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  let u;
  let v;
  if (ay >= ax && ay >= az) [u, v] = [position[0], position[2]];
  else if (ax >= az) [u, v] = [position[2], position[1]];
  else [u, v] = [position[0], position[1]];
  const repeat = 0.42;
  u = ((u * repeat % 1) + 1) % 1;
  v = ((v * repeat % 1) + 1) % 1;
  const inset = 0.012;
  return [
    (cell % 2) * 0.5 + inset + u * (0.5 - inset * 2),
    (1 - Math.floor(cell / 2)) * 0.5 + inset + v * (0.5 - inset * 2),
  ];
}

function geometryData(key, source) {
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  const colour = source.getAttribute('color');
  if (position === undefined || normal === undefined || colour === undefined) {
    throw new Error(`${key} is missing position, normal or colour`);
  }
  const positions = new Float32Array(position.count * 3);
  const normals = new Float32Array(position.count * 3);
  const colours = new Float32Array(position.count * 3);
  const uvs = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const p = [position.getX(i), position.getY(i), position.getZ(i)];
    const n = [normal.getX(i), normal.getY(i), normal.getZ(i)];
    const c = [colour.getX(i), colour.getY(i), colour.getZ(i)];
    positions.set(p, i * 3);
    normals.set(n, i * 3);
    colours.set(c, i * 3);
    uvs.set(projectedUv(p, n, materialCell(key, ...c)), i * 2);
  }
  const sourceIndex = source.getIndex();
  const indexCount = sourceIndex?.count ?? position.count;
  const indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i++) indices[i] = sourceIndex?.getX(i) ?? i;
  return { positions, normals, colours, uvs, indices };
}

function boxData(source) {
  source.computeBoundingBox();
  const box = source.boundingBox;
  if (box === null) throw new Error('geometry has no bounds');
  const [x0, y0, z0] = box.min.toArray();
  const [x1, y1, z1] = box.max.toArray();
  const positions = new Float32Array([
    x0,y0,z1, x1,y0,z1, x1,y1,z1, x0,y1,z1,
    x1,y0,z0, x0,y0,z0, x0,y1,z0, x1,y1,z0,
    x1,y0,z1, x1,y0,z0, x1,y1,z0, x1,y1,z1,
    x0,y0,z0, x0,y0,z1, x0,y1,z1, x0,y1,z0,
    x0,y1,z1, x1,y1,z1, x1,y1,z0, x0,y1,z0,
    x0,y0,z0, x1,y0,z0, x1,y0,z1, x0,y0,z1,
  ]);
  const faceNormals = [[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]];
  const normals = new Float32Array(positions.length);
  const colours = new Float32Array(positions.length).fill(0.5);
  const uvs = new Float32Array(positions.length / 3 * 2);
  for (let face = 0; face < 6; face++) for (let vertex = 0; vertex < 4; vertex++) normals.set(faceNormals[face], (face * 4 + vertex) * 3);
  const indices = new Uint32Array(36);
  for (let face = 0; face < 6; face++) indices.set([0,1,2,0,2,3].map((value) => value + face * 4), face * 6);
  return { positions, normals, colours, uvs, indices };
}

function shadowGeometry() {
  return { positions: [], normals: [], colours: [], uvs: [], indices: [] };
}

function appendShadowVertex(target, position, normal) {
  const index = target.positions.length / 3;
  target.positions.push(...position);
  target.normals.push(...normal);
  target.colours.push(0.5, 0.5, 0.5);
  target.uvs.push(0, 0);
  return index;
}

function appendShadowTriangle(target, a, b, c, normal) {
  const base = target.positions.length / 3;
  appendShadowVertex(target, a, normal);
  appendShadowVertex(target, b, normal);
  appendShadowVertex(target, c, normal);
  target.indices.push(base, base + 1, base + 2);
}

function appendShadowQuad(target, a, b, c, d, normal) {
  const base = target.positions.length / 3;
  appendShadowVertex(target, a, normal);
  appendShadowVertex(target, b, normal);
  appendShadowVertex(target, c, normal);
  appendShadowVertex(target, d, normal);
  target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function appendShadowBox(target, { x, y, z, width, height, depth, yaw = 0 }) {
  const hx = width * 0.5;
  const hy = height * 0.5;
  const hz = depth * 0.5;
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const point = (px, py, pz) => [
    x + px * cs + pz * sn,
    y + py,
    z - px * sn + pz * cs,
  ];
  const direction = (nx, ny, nz) => [nx * cs + nz * sn, ny, -nx * sn + nz * cs];
  const faces = [
    [[-hx,-hy,hz],[hx,-hy,hz],[hx,hy,hz],[-hx,hy,hz],[0,0,1]],
    [[hx,-hy,-hz],[-hx,-hy,-hz],[-hx,hy,-hz],[hx,hy,-hz],[0,0,-1]],
    [[hx,-hy,hz],[hx,-hy,-hz],[hx,hy,-hz],[hx,hy,hz],[1,0,0]],
    [[-hx,-hy,-hz],[-hx,-hy,hz],[-hx,hy,hz],[-hx,hy,-hz],[-1,0,0]],
    [[-hx,hy,hz],[hx,hy,hz],[hx,hy,-hz],[-hx,hy,-hz],[0,1,0]],
    [[-hx,-hy,-hz],[hx,-hy,-hz],[hx,-hy,hz],[-hx,-hy,hz],[0,-1,0]],
  ];
  for (const [a, b, c, d, normal] of faces) {
    appendShadowQuad(target, point(...a), point(...b), point(...c), point(...d), direction(...normal));
  }
}

function appendShadowCylinder(target, { x, z, radius, height, sides }) {
  for (let side = 0; side < sides; side++) {
    const a0 = side / sides * Math.PI * 2;
    const a1 = (side + 1) / sides * Math.PI * 2;
    const b0 = [x + Math.cos(a0) * radius, 0, z + Math.sin(a0) * radius];
    const b1 = [x + Math.cos(a1) * radius, 0, z + Math.sin(a1) * radius];
    const t0 = [b0[0], height, b0[2]];
    const t1 = [b1[0], height, b1[2]];
    const mid = (a0 + a1) * 0.5;
    appendShadowQuad(target, b0, t0, t1, b1, [Math.cos(mid), 0, Math.sin(mid)]);
    appendShadowTriangle(target, t0, [x, height, z], t1, [0, 1, 0]);
    appendShadowTriangle(target, b0, b1, [x, 0, z], [0, -1, 0]);
  }
}

function typedShadowData(target) {
  return {
    positions: new Float32Array(target.positions),
    normals: new Float32Array(target.normals),
    colours: new Float32Array(target.colours),
    uvs: new Float32Array(target.uvs),
    indices: new Uint32Array(target.indices),
  };
}

function tentShadowData() {
  const target = shadowGeometry();
  const sides = 12;
  const baseRadius = 2.0;
  const shoulderRadius = 1.84;
  const shoulderY = 1.53;
  const apex = [0, 3.638, 0];
  for (let side = 0; side < sides; side++) {
    const a0 = side / sides * Math.PI * 2;
    const a1 = (side + 1) / sides * Math.PI * 2;
    const b0 = [Math.cos(a0) * baseRadius, 0, Math.sin(a0) * baseRadius];
    const b1 = [Math.cos(a1) * baseRadius, 0, Math.sin(a1) * baseRadius];
    const s0 = [Math.cos(a0) * shoulderRadius, shoulderY, Math.sin(a0) * shoulderRadius];
    const s1 = [Math.cos(a1) * shoulderRadius, shoulderY, Math.sin(a1) * shoulderRadius];
    const mid = (a0 + a1) * 0.5;
    appendShadowQuad(target, b0, s0, s1, b1, [Math.cos(mid), 0.1, Math.sin(mid)]);
    appendShadowTriangle(target, s0, apex, s1, [Math.cos(mid), 0.7, Math.sin(mid)]);
    appendShadowTriangle(target, b0, b1, [0, 0, 0], [0, -1, 0]);
  }
  // The three supply boxes are separate silhouettes. Keeping them separate is
  // what prevents their combined AABB from becoming one six-metre square.
  for (let index = 0; index < 3; index++) {
    const yaw = index / 3 * Math.PI * 2 + 0.4;
    appendShadowBox(target, {
      x: Math.cos(yaw) * 2.55, y: 0.42, z: Math.sin(yaw) * 2.55,
      width: 1.4, height: 0.8, depth: 0.8, yaw,
    });
  }
  return typedShadowData(target);
}

function barrelShadowData() {
  const target = shadowGeometry();
  // PropLibrary seed 7 authors four upright drums at these stable centres.
  // Keeping four separate radial casters preserves the visible gaps between
  // them instead of filling the complete group AABB with one opaque wedge.
  const bodies = [
    [0, 0],
    [-0.0872, 0.9187],
    [-0.6599, 0.1115],
    [-0.2564, -0.8304],
  ];
  for (const [x, z] of bodies) {
    appendShadowCylinder(target, {
      x, z, radius: 0.42, height: 1.05,
      sides: 8,
    });
  }
  return typedShadowData(target);
}

function shadowData(key, source) {
  if (key === 'haystack') return tentShadowData();
  if (key === 'barrel') return barrelShadowData();
  return boxData(source);
}

function documentFor(name, data, textured = true) {
  const document = new Document();
  const buffer = document.createBuffer(`${name}.buffer`);
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', document.createAccessor('POSITION').setType('VEC3').setArray(data.positions).setBuffer(buffer))
    .setAttribute('NORMAL', document.createAccessor('NORMAL').setType('VEC3').setArray(data.normals).setBuffer(buffer))
    .setAttribute('COLOR_0', document.createAccessor('COLOR_0').setType('VEC3').setArray(data.colours).setBuffer(buffer))
    .setIndices(document.createAccessor('indices').setType('SCALAR').setArray(data.indices).setBuffer(buffer))
    .setMaterial(document.createMaterial(textured ? 'prop-surface.shared-atlas' : 'prop-surface.shadow')
      .setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.88).setDoubleSided(false));
  if (textured) primitive.setAttribute('TEXCOORD_0', document.createAccessor('TEXCOORD_0').setType('VEC2').setArray(data.uvs).setBuffer(buffer));
  document.createScene('Scene').addChild(document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)));
  return document;
}

function triangles(document) {
  return document.getRoot().listMeshes().reduce((total, mesh) => total + mesh.listPrimitives().reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0) / 3, 0), 0);
}

async function writeDocument(relative, document) {
  const file = path.join(outputRoot, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await new NodeIO().write(file, document);
  return { file: relative, triangles: Math.round(triangles(document)), bytes: (await fs.stat(file)).size };
}

async function simplifiedDocument(name, data, ratio, error) {
  // Work directly on the position topology so UV/normal seams do not become
  // simplification locks. `Permissive` allows seam-adjacent collapses while
  // retaining the original indexed surface; unlike `simplifySloppy`, it cannot
  // bridge disconnected parts or fold a barrel/car body into invalid fans.
  const target = Math.max(36, Math.floor(data.indices.length * ratio / 3) * 3);
  const [indices] = MeshoptSimplifier.simplify(
    data.indices, data.positions, 3, target, error, ['Permissive'],
  );
  return documentFor(name, { ...data, indices }, true);
}

const report = [];
for (const key of keys) {
  const entry = library.get(key);
  if (entry === undefined) throw new Error(`PropLibrary did not build ${key}`);
  const name = `${kebab(key)}-v1`;
  const data = geometryData(key, entry.geometry);
  report.push(await writeDocument(`${name}.glb`, documentFor(`${name}.lod0`, data, true)));
  // The hay shelter is already only 264 triangles. Meshopt reaches the numeric
  // target by replacing several round-wall sectors with one long chord, which
  // puts a visible wedge back into the silhouette at normal camera distance.
  // Preserve the approved source topology for its two named deliveries; the
  // static family still swaps material/shadow policy by camera band, and the
  // eight-triangle increase over the old LOD0 is below measurement noise.
  if (key === 'haystack') {
    report.push(await writeDocument(`derived/${name}.lod1.glb`, documentFor(`${name}.lod1`, data, true)));
    report.push(await writeDocument(`derived/${name}.lod2.glb`, documentFor(`${name}.lod2`, data, true)));
  } else {
    report.push(await writeDocument(`derived/${name}.lod1.glb`, await simplifiedDocument(`${name}.lod1`, data, 0.58, 0.03)));
    report.push(await writeDocument(`derived/${name}.lod2.glb`, await simplifiedDocument(`${name}.lod2`, data, 0.30, 0.08)));
  }
  report.push(await writeDocument(`derived/${name}.shadow.glb`, documentFor(`${name}.shadow`, shadowData(key, entry.geometry), false)));
}

library.dispose();
await fs.rm(scratch, { recursive: true, force: true });
console.log(JSON.stringify({ outputRoot, deliveries: report }, null, 2));

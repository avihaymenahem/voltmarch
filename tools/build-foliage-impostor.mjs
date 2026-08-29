#!/usr/bin/env node

/**
 * Build a compact crossed-plane foliage impostor from an approved 2x2
 * cardinal render. The output uses vertex colour rather than a unique texture,
 * so the runtime foliage material can instance it without another sampler or
 * decoded atlas allocation.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { Document, getBounds, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const sourceArg = value('--source');
const cardinalsArg = value('--cardinals');
const outputArg = value('--output');
const rows = Number(value('--rows') ?? 24);
const columns = Number(value('--columns') ?? 16);
if (!sourceArg || !cardinalsArg || !outputArg
  || !Number.isInteger(rows) || rows < 8 || rows > 64
  || !Number.isInteger(columns) || columns < 8 || columns > 64) {
  throw new Error(
    'usage: node tools/build-foliage-impostor.mjs --source <lod0.glb> '
    + '--cardinals <2x2.png> --output <lod2.glb> [--rows 24] [--columns 16]',
  );
}

const source = path.resolve(sourceArg);
const cardinals = path.resolve(cardinalsArg);
const output = path.resolve(outputArg);
if (source === output) throw new Error('source and output must differ');

const io = new NodeIO();
const sourceDocument = await io.read(source);
const scenes = sourceDocument.getRoot().listScenes();
if (scenes.length !== 1) throw new Error('foliage impostor source must contain one scene');
const sourceBounds = getBounds(scenes[0]);
const centre = sourceBounds.min.map((entry, axis) => (entry + sourceBounds.max[axis]) * 0.5);

const { data, info } = await sharp(cardinals).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (info.width !== info.height || info.width % 2 !== 0) {
  throw new Error('cardinal render must be a square 2x2 sheet');
}
const viewSize = info.width / 2;
const background = [data[0], data[1], data[2]];
const pixel = (x, y) => {
  const offset = (y * info.width + x) * 4;
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
};
const isSubject = ([r, g, b, a]) => a > 16
  && Math.hypot(r - background[0], g - background[1], b - background[2]) > 28;
const isLeaf = ([r, g, b]) => g > r * 0.78 && g > b * 1.12;

const positions = [];
const normals = [];
const colours = [];
const indices = [];
const palette = {
  // Deliberately darker than the lit review render. The shared foliage
  // material and world lighting lift these values in game; sampling the
  // screenshot colours directly made the far tree read as chalky mint.
  leaf: [0.27, 0.31, 0.16],
  bark: [0.22, 0.10, 0.055],
};
let runCount = 0;

function appendFace(vertices, normal, colour) {
  const base = positions.length / 3;
  for (const vertex of vertices) {
    positions.push(...vertex);
    normals.push(...normal);
    colours.push(...colour);
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function appendDoubleSidedRect(vertices, normal, colour) {
  appendFace(vertices, normal, colour);
  appendFace([...vertices].reverse(), normal.map((component) => -component), colour);
}

function viewMask(offsetX, offsetY) {
  let minX = viewSize, minY = viewSize, maxX = -1, maxY = -1;
  for (let y = 0; y < viewSize; y++) {
    for (let x = 0; x < viewSize; x++) {
      if (!isSubject(pixel(offsetX + x, offsetY + y))) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('cardinal view contains no subject pixels');
  return { offsetX, offsetY, minX, minY, maxX, maxY };
}

function classifyCell(view, column, row) {
  const x0 = Math.floor(view.minX + column * (view.maxX + 1 - view.minX) / columns);
  const x1 = Math.ceil(view.minX + (column + 1) * (view.maxX + 1 - view.minX) / columns);
  const y0 = Math.floor(view.minY + row * (view.maxY + 1 - view.minY) / rows);
  const y1 = Math.ceil(view.minY + (row + 1) * (view.maxY + 1 - view.minY) / rows);
  let subject = 0;
  let leaf = 0;
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const sample = pixel(view.offsetX + x, view.offsetY + y);
      if (!isSubject(sample)) continue;
      subject++;
      if (isLeaf(sample)) leaf++;
    }
  }
  if (subject / area < 0.16) return null;
  return leaf >= subject * 0.52 ? 'leaf' : 'bark';
}

function appendView(view, axis) {
  const extentMin = axis === 'front' ? sourceBounds.min[0] : sourceBounds.min[2];
  const extentMax = axis === 'front' ? sourceBounds.max[0] : sourceBounds.max[2];
  const grid = Array.from({ length: rows }, (_, row) => (
    Array.from({ length: columns }, (_, column) => classifyCell(view, column, row))
  ));
  const visited = Array.from({ length: rows }, () => new Uint8Array(columns));
  for (let row = 0; row < rows; row++) {
    for (let start = 0; start < columns; start++) {
      const role = grid[row][start];
      if (role === null || visited[row][start] !== 0) continue;
      let width = 1;
      while (start + width < columns
        && grid[row][start + width] === role && visited[row][start + width] === 0) width++;
      let height = 1;
      heightLoop: while (row + height < rows) {
        for (let column = start; column < start + width; column++) {
          if (grid[row + height][column] !== role || visited[row + height][column] !== 0) {
            break heightLoop;
          }
        }
        height++;
      }
      for (let y = row; y < row + height; y++) {
        for (let x = start; x < start + width; x++) visited[y][x] = 1;
      }
      const horizontal0 = extentMin + (extentMax - extentMin) * start / columns;
      const horizontal1 = extentMin + (extentMax - extentMin) * (start + width) / columns;
      const top = sourceBounds.max[1]
        - (sourceBounds.max[1] - sourceBounds.min[1]) * row / rows;
      const bottom = sourceBounds.max[1]
        - (sourceBounds.max[1] - sourceBounds.min[1]) * (row + height) / rows;
      const variation = 0.94 + ((row * 17 + start * 13 + (axis === 'front' ? 0 : 7)) % 9) * 0.012;
      const colour = palette[role].map((component) => Math.min(1, component * variation));
      if (axis === 'front') {
        appendDoubleSidedRect([
          [horizontal0, bottom, centre[2]], [horizontal1, bottom, centre[2]],
          [horizontal1, top, centre[2]], [horizontal0, top, centre[2]],
        ], [0, 0, 1], colour);
      } else {
        // From +X, screen-right points toward -Z.
        appendDoubleSidedRect([
          [centre[0], bottom, horizontal1], [centre[0], bottom, horizontal0],
          [centre[0], top, horizontal0], [centre[0], top, horizontal1],
        ], [1, 0, 0], colour);
      }
      runCount++;
    }
  }
}

appendView(viewMask(0, 0), 'front');
appendView(viewMask(viewSize, 0), 'right');
if (runCount === 0) throw new Error('foliage impostor produced no silhouette runs');

const document = new Document();
const buffer = document.createBuffer('foliage-impostor');
const positionAccessor = document.createAccessor('POSITION').setType('VEC3')
  .setArray(new Float32Array(positions)).setBuffer(buffer);
const normalAccessor = document.createAccessor('NORMAL').setType('VEC3')
  .setArray(new Float32Array(normals)).setBuffer(buffer);
const colourAccessor = document.createAccessor('COLOR_0').setType('VEC3')
  .setArray(new Float32Array(colours)).setBuffer(buffer);
const indexArray = positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
const indexAccessor = document.createAccessor('indices').setType('SCALAR')
  .setArray(indexArray).setBuffer(buffer);
const material = document.createMaterial('foliage-impostor')
  .setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.9).setDoubleSided(false);
const primitive = document.createPrimitive().setAttribute('POSITION', positionAccessor)
  .setAttribute('NORMAL', normalAccessor).setAttribute('COLOR_0', colourAccessor)
  .setIndices(indexAccessor).setMaterial(material);
const mesh = document.createMesh('temperate-broadleaf-impostor').addPrimitive(primitive);
document.createScene('Scene').addChild(document.createNode('temperate-broadleaf-impostor').setMesh(mesh));

await fs.mkdir(path.dirname(output), { recursive: true });
await io.write(output, document);
// When this follows optimize-asset-family, make the report describe the file
// actually left on disk. Numeric simplification can pass while visibly
// collapsing foliage; the cardinal review is the promotion authority.
const reportPath = path.join(path.dirname(output), 'optimization-report.json');
try {
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const row = report.rows?.find((entry) => entry.key === 'tree');
  const direct = row?.outputs?.find((entry) => entry.profile === 'lod2');
  if (direct !== undefined) {
    direct.status = 'rejected-visual';
    direct.blockers = [
      'cardinal review: direct simplification collapsed the crown/trunk into slab geometry',
    ];
    direct.file = null;
    direct.fileBytes = 0;
  }
  if (row !== undefined) {
    row.selectedFarDelivery = {
      method: 'crossed vertex-colour silhouette',
      file: path.relative(path.resolve(path.dirname(reportPath), '../../../../../../'), output)
        .replaceAll('\\', '/'),
      triangles: indices.length / 3,
      fileBytes: (await fs.stat(output)).size,
    };
  }
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
console.log(JSON.stringify({
  source,
  cardinals,
  output,
  grid: [columns, rows],
  runs: runCount,
  triangles: indices.length / 3,
  vertices: positions.length / 3,
}));

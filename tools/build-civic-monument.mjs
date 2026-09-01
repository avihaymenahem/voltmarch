#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import sharp from 'sharp';

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  throw new Error('usage: node tools/build-civic-monument.mjs <meshy-figure.glb> <output.glb>');
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);
const root = document.getRoot();
const meshNodes = root.listNodes().filter((node) => node.getMesh() !== null);
if (meshNodes.length !== 1) throw new Error(`expected one mesh node, got ${meshNodes.length}`);
const node = meshNodes[0];
const mesh = node.getMesh();
if (mesh === null || mesh.listPrimitives().length !== 1) throw new Error('expected one mesh primitive');
const primitive = mesh.listPrimitives()[0];
const material = primitive.getMaterial();
const position = primitive.getAttribute('POSITION');
const normal = primitive.getAttribute('NORMAL');
const uv = primitive.getAttribute('TEXCOORD_0');
const sourceIndices = primitive.getIndices();
if (material === null || position === null || normal === null || uv === null || sourceIndices === null) {
  throw new Error('source requires one PBR material with indexed positions, normals, and UVs');
}

const baseTexture = material.getBaseColorTexture();
const normalTexture = material.getNormalTexture();
const mrTexture = material.getMetallicRoughnessTexture();
if (baseTexture === null || normalTexture === null || mrTexture === null) {
  throw new Error('source requires base-colour, normal, and metallic-roughness textures');
}

const positions = [];
const normals = [];
const uvs = [];
const indices = [];
const point = [0, 0, 0];
const figureScale = 1.6;
const pedestalHeight = 1.4;
for (let i = 0; i < position.getCount(); i++) {
  position.getElement(i, point);
  positions.push(point[0] * figureScale, (point[1] + 1) * figureScale + pedestalHeight, point[2] * figureScale);
  normal.getElement(i, point);
  normals.push(point[0], point[1], point[2]);
  uv.getElement(i, point);
  uvs.push(point[0] * 0.75, point[1]);
}
for (let i = 0; i < sourceIndices.getCount(); i++) indices.push(sourceIndices.getScalar(i));

function faceNormal(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...cross) || 1;
  return cross.map((value) => value / length);
}

function addFace(vertices, expected, uvRect) {
  let ordered = vertices;
  let calculated = faceNormal(vertices[0], vertices[1], vertices[2]);
  if (calculated[0] * expected[0] + calculated[1] * expected[1] + calculated[2] * expected[2] < 0) {
    ordered = [vertices[0], ...vertices.slice(1).reverse()];
    calculated = faceNormal(ordered[0], ordered[1], ordered[2]);
  }
  const start = positions.length / 3;
  const [u0, v0, u1, v1] = uvRect;
  const faceUvs = ordered.length === 4
    ? [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
    : [[u0, v0], [u1, v0], [(u0 + u1) * 0.5, v1]];
  for (let i = 0; i < ordered.length; i++) {
    positions.push(...ordered[i]);
    normals.push(...calculated);
    uvs.push(...faceUvs[i]);
  }
  if (ordered.length === 4) indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  else indices.push(start, start + 1, start + 2);
}

function footprint(hx, hz, cut, y) {
  return [
    [-hx + cut, y, -hz], [hx - cut, y, -hz],
    [hx, y, -hz + cut], [hx, y, hz - cut],
    [hx - cut, y, hz], [-hx + cut, y, hz],
    [-hx, y, hz - cut], [-hx, y, -hz + cut],
  ];
}

function addTier({ width, depth, y0, y1, bevel, cut, v0, v1 }) {
  const hx = width * 0.5, hz = depth * 0.5;
  const lower = footprint(hx, hz, cut, y0);
  const shoulder = footprint(hx, hz, cut, y1 - bevel);
  const top = footprint(hx - bevel, hz - bevel, Math.max(0.04, cut - bevel * 0.35), y1);
  const uvRect = [0.77, v0, 0.98, v1];
  for (let i = 0; i < 8; i++) {
    const next = (i + 1) % 8;
    const outward = [
      lower[i][0] + lower[next][0],
      0,
      lower[i][2] + lower[next][2],
    ];
    const length = Math.hypot(outward[0], outward[2]) || 1;
    outward[0] /= length;
    outward[2] /= length;
    addFace([lower[i], lower[next], shoulder[next], shoulder[i]], outward, uvRect);
    addFace([shoulder[i], shoulder[next], top[next], top[i]], [outward[0], 0.75, outward[2]], uvRect);
  }
  const centreTop = [0, y1, 0];
  const centreBottom = [0, y0, 0];
  for (let i = 0; i < 8; i++) {
    const next = (i + 1) % 8;
    addFace([centreTop, top[i], top[next]], [0, 1, 0], uvRect);
    addFace([centreBottom, lower[next], lower[i]], [0, -1, 0], uvRect);
  }
}

addTier({ width: 3.8, depth: 2.9, y0: 0, y1: 0.45, bevel: 0.10, cut: 0.20, v0: 0.03, v1: 0.30 });
addTier({ width: 3.2, depth: 2.4, y0: 0.45, y1: 1.00, bevel: 0.09, cut: 0.17, v0: 0.36, v1: 0.63 });
addTier({ width: 2.4, depth: 1.8, y0: 1.00, y1: 1.40, bevel: 0.08, cut: 0.14, v0: 0.70, v1: 0.97 });

const buffer = root.listBuffers()[0] ?? document.createBuffer('civic-monument');
primitive
  .setAttribute('POSITION', document.createAccessor('POSITION').setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
  .setAttribute('NORMAL', document.createAccessor('NORMAL').setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
  .setAttribute('TEXCOORD_0', document.createAccessor('TEXCOORD_0').setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer))
  .setAttribute('TANGENT', null)
  .setIndices(document.createAccessor('indices').setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer));

function noise(x, y, seed) {
  let value = Math.imul(x + seed * 1013, 374761393) ^ Math.imul(y + seed * 7919, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) & 255) / 255;
}

async function stoneStrip(role) {
  const width = 512, height = 2048, pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const tier = y < height / 3 ? 0 : y < height * 2 / 3 ? 1 : 2;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      if (role === 'normal') {
        pixels[offset] = 128; pixels[offset + 1] = 128; pixels[offset + 2] = 255;
      } else if (role === 'mr') {
        pixels[offset] = 255;
        pixels[offset + 1] = tier === 1 ? 226 : 214;
        pixels[offset + 2] = 0;
      } else {
        const colours = [[48, 49, 47], [132, 128, 117], [67, 69, 68]];
        const grain = Math.round((noise(x >> 1, y >> 1, tier + 3) - 0.5) * (tier === 1 ? 12 : 8));
        const vein = ((x * 3 + y * 2 + tier * 47) % 211) < 2 ? (tier === 1 ? -13 : 8) : 0;
        pixels[offset] = Math.max(0, Math.min(255, colours[tier][0] + grain + vein));
        pixels[offset + 1] = Math.max(0, Math.min(255, colours[tier][1] + grain + vein));
        pixels[offset + 2] = Math.max(0, Math.min(255, colours[tier][2] + grain + vein));
      }
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function extendAtlas(texture, role) {
  const image = texture.getImage();
  if (image === null) throw new Error(`${role} texture has no image`);
  const figure = await sharp(Buffer.from(image)).resize(1536, 2048, { fit: 'fill' }).png().toBuffer();
  const stone = await stoneStrip(role);
  const atlas = await sharp({
    create: { width: 2048, height: 2048, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).composite([{ input: figure, left: 0, top: 0 }, { input: stone, left: 1536, top: 0 }]).png().toBuffer();
  texture.setImage(atlas).setMimeType('image/png').setName(`civic-monument-${role}`);
}

await extendAtlas(baseTexture, 'base');
await extendAtlas(normalTexture, 'normal');
await extendAtlas(mrTexture, 'mr');
material.setName('civic-monument-bronze-stone').setDoubleSided(false);
mesh.setName('civic-engineer-monument');
node.setName('civic-engineer-monument').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
await document.transform(prune());
await fs.mkdir(path.dirname(output), { recursive: true });
await io.write(output, document);
console.log(`${input} -> ${output}`);
console.log(`triangles: ${indices.length / 3}, vertices: ${positions.length / 3}, height: 4.6m`);


#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const file = process.argv[2];
if (!file) throw new Error('usage: npm run asset:audit -- <asset.glb>');
const absolute = path.resolve(file);
const bytes = fs.readFileSync(absolute);
if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
  throw new Error(`${absolute} is not a glTF 2.0 binary`);
}

const jsonLength = bytes.readUInt32LE(12);
const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
const binOffset = 28 + jsonLength;
const uses = new Map();
const mark = (info, role) => {
  const source = document.textures?.[info?.index]?.source;
  if (source === undefined) return;
  const found = uses.get(source) ?? new Set();
  found.add(role);
  uses.set(source, found);
};
for (const material of document.materials ?? []) {
  mark(material.pbrMetallicRoughness?.baseColorTexture, 'base');
  mark(material.normalTexture, 'normal');
  mark(material.pbrMetallicRoughness?.metallicRoughnessTexture, 'metalRough');
  mark(material.occlusionTexture, 'occlusion');
  mark(material.emissiveTexture, 'emissive');
}

function imageDimensions(data) {
  if (data[0] === 0xff && data[1] === 0xd8) {
    let cursor = 2;
    while (cursor < data.length) {
      if (data[cursor++] !== 0xff) continue;
      let marker = data[cursor++];
      while (marker === 0xff) marker = data[cursor++];
      if (marker === 0xd8 || marker === 0xd9) continue;
      const length = data.readUInt16BE(cursor);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return [data.readUInt16BE(cursor + 5), data.readUInt16BE(cursor + 3)];
      }
      cursor += length;
    }
  }
  if (data.subarray(1, 4).toString('ascii') === 'PNG') {
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
  }
  return [0, 0];
}

let triangles = 0;
let vertices = 0;
let primitives = 0;
for (const mesh of document.meshes ?? []) {
  for (const primitive of mesh.primitives ?? []) {
    primitives++;
    const position = primitive.attributes?.POSITION;
    triangles += primitive.indices === undefined
      ? (position === undefined ? 0 : document.accessors?.[position]?.count ?? 0) / 3
      : (document.accessors?.[primitive.indices]?.count ?? 0) / 3;
    vertices += position === undefined ? 0 : document.accessors?.[position]?.count ?? 0;
  }
}

const images = await Promise.all((document.images ?? []).map(async (image, index) => {
  const view = document.bufferViews?.[image.bufferView];
  if (!view) return { index, roles: [...(uses.get(index) ?? [])], external: image.uri };
  const start = binOffset + (view.byteOffset ?? 0);
  const data = bytes.subarray(start, start + view.byteLength);
  const [width, height] = imageDimensions(data);
  const stats = await sharp(data).stats();
  return {
    index,
    roles: [...(uses.get(index) ?? [])],
    width,
    height,
    encodedBytes: data.length,
    entropy: +stats.entropy.toFixed(4),
    sharpness: +stats.sharpness.toFixed(4),
    channels: stats.channels.slice(0, 3).map((channel) => ({
      mean: +channel.mean.toFixed(2),
      stdev: +channel.stdev.toFixed(2),
    })),
  };
}));

const materials = (document.materials ?? []).map((material, index) => ({
  index,
  baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
  metallicFactor: material.pbrMetallicRoughness?.metallicFactor ?? 1,
  roughnessFactor: material.pbrMetallicRoughness?.roughnessFactor ?? 1,
  normalScale: material.normalTexture?.scale ?? 1,
  doubleSided: material.doubleSided === true,
}));

console.log(JSON.stringify({
  file: absolute,
  fileBytes: bytes.length,
  fileMiB: +(bytes.length / 1024 / 1024).toFixed(2),
  scenes: document.scenes?.length ?? 0,
  nodes: document.nodes?.length ?? 0,
  meshes: document.meshes?.length ?? 0,
  primitives,
  materials,
  triangles: Math.round(triangles),
  vertices,
  images,
  extensionsUsed: document.extensionsUsed ?? [],
  extensionsRequired: document.extensionsRequired ?? [],
}, null, 2));

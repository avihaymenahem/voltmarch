#!/usr/bin/env node

/** Build a neutral-detail PBR atlas multiplied by authored prop vertex colours. */

import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const root = path.resolve('packages/assets/game/environment/prop-surface');
const sourceRoot = path.join(root, 'source');
const materialRoot = path.join(root, 'material');
const size = 1024;
const cell = 512;
const sources = [
  ['metal-v1-imagegen.png', 0.82, 0.18],
  ['wood-v1-imagegen.png', 0.86, 0.22],
  ['canvas-v1-meshy.png', 0.91, 0.28],
  ['stone-v1-imagegen.png', 0.84, 0.20],
];

await fs.mkdir(materialRoot, { recursive: true });
const composites = [];
for (let i = 0; i < sources.length; i++) {
  const [file, midpoint, contrast] = sources[i];
  const { data, info } = await sharp(path.join(sourceRoot, file))
    .resize(cell, cell, { fit: 'cover' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(cell * cell * 3);
  for (let pixel = 0; pixel < cell * cell; pixel++) {
    const normalized = (data[pixel] - 128) / 127;
    const value = Math.round(Math.max(0, Math.min(255, (midpoint + normalized * contrast) * 255)));
    output[pixel * 3] = value;
    output[pixel * 3 + 1] = value;
    output[pixel * 3 + 2] = value;
  }
  composites.push({
    input: await sharp(output, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer(),
    left: (i % 2) * cell,
    top: Math.floor(i / 2) * cell,
  });
}

const basePng = await sharp({
  create: { width: size, height: size, channels: 3, background: { r: 215, g: 215, b: 215 } },
}).composite(composites).png().toBuffer();
const base = await sharp(basePng).raw().toBuffer();
const normal = Buffer.alloc(size * size * 3);
const mr = Buffer.alloc(size * size * 3);
const luma = (x, y) => base[(Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))) * 3];
const roughness = [170, 205, 232, 220];
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 3;
    const dx = (luma(x + 1, y) - luma(x - 1, y)) * 0.56;
    const dy = (luma(x, y + 1) - luma(x, y - 1)) * 0.56;
    const length = Math.hypot(dx, dy, 255) || 1;
    normal[offset] = Math.round(128 - dx / length * 127);
    normal[offset + 1] = Math.round(128 + dy / length * 127);
    normal[offset + 2] = Math.round(128 + 255 / length * 127);
    const atlasCell = (x >= cell ? 1 : 0) + (y >= cell ? 2 : 0);
    mr[offset] = 255;
    mr[offset + 1] = roughness[atlasCell];
    mr[offset + 2] = atlasCell === 0 ? 230 : 0;
  }
}

await sharp(basePng).webp({ quality: 90, effort: 6 })
  .toFile(path.join(materialRoot, 'prop-surface-v1.base.webp'));
await sharp(normal, { raw: { width: size, height: size, channels: 3 } })
  .resize(512, 512).jpeg({ quality: 91, chromaSubsampling: '4:4:4' })
  .toFile(path.join(materialRoot, 'prop-surface-v1.normal.jpg'));
await sharp(mr, { raw: { width: size, height: size, channels: 3 } })
  .resize(512, 512, { kernel: 'nearest' }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
  .toFile(path.join(materialRoot, 'prop-surface-v1.mr.jpg'));

console.log(JSON.stringify({ root, cells: ['metal', 'wood', 'hay', 'stone'] }, null, 2));

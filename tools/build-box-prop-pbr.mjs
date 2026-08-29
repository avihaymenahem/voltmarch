#!/usr/bin/env node

/** Build the shared crate/flower-box atlas and compact PBR data maps. */

import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  if (!args[index + 1]) throw new Error(`missing value after ${flag}`);
  return args[index + 1];
};
const crateInput = path.resolve(valueAfter(
  '--crate-input',
  'packages/assets/game/environment/box-prop/source/yard-crate-v2-imagegen-iron.png',
));
const flowerInput = path.resolve(valueAfter(
  '--flower-input',
  'packages/assets/game/environment/box-prop/source/flower-bed-v1-imagegen.png',
));
const outputRoot = path.resolve(valueAfter(
  '--output-root',
  'packages/assets/game/environment/box-prop/material',
));

const atlasSize = 1024;
const cellSize = atlasSize / 2;
const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

function noise(x, y, seed) {
  let value = Math.imul(x + seed * 17, 0x45d9f3b) ^ Math.imul(y + seed * 31, 0x119de1f3);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function soilCell() {
  const pixels = Buffer.alloc(cellSize * cellSize * 4);
  for (let y = 0; y < cellSize; y++) {
    for (let x = 0; x < cellSize; x++) {
      const broad = noise(Math.floor(x / 12), Math.floor(y / 12), 71);
      const grain = noise(x, y, 113);
      const root = noise(Math.floor(x / 4), Math.floor(y / 4), 191);
      const value = (broad - 0.5) * 20 + (grain - 0.5) * 15 + (root - 0.5) * 8;
      const offset = (y * cellSize + x) * 4;
      pixels[offset] = clampByte(72 + value);
      pixels[offset + 1] = clampByte(50 + value * 0.72);
      pixels[offset + 2] = clampByte(28 + value * 0.42);
      pixels[offset + 3] = 255;
    }
  }
  return sharp(pixels, { raw: { width: cellSize, height: cellSize, channels: 4 } })
    .blur(0.32).png().toBuffer();
}

await fs.mkdir(outputRoot, { recursive: true });
const crateCell = await sharp(crateInput)
  .removeAlpha()
  .resize(cellSize, cellSize, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .modulate({ brightness: 0.83, saturation: 0.82 })
  .sharpen({ sigma: 0.48, m1: 0.45, m2: 1.0 })
  .ensureAlpha(1)
  .png()
  .toBuffer();
const planterCell = await sharp(crateInput)
  .removeAlpha()
  .resize(cellSize, cellSize, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .modulate({ brightness: 0.55, saturation: 0.38, hue: -5 })
  .flop()
  .ensureAlpha(1)
  .png()
  .toBuffer();
const trimmedFlowers = await sharp(flowerInput)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
const flowerPadding = 18;
const { data: flowerPixels, info: flowerInfo } = await sharp(trimmedFlowers)
  .resize(cellSize - flowerPadding * 2, cellSize - flowerPadding * 2, {
    fit: 'contain',
    position: 'centre',
    background: { r: 34, g: 52, b: 17, alpha: 0 },
    kernel: sharp.kernel.lanczos3,
  })
  .extend({
    top: flowerPadding,
    bottom: flowerPadding,
    left: flowerPadding,
    right: flowerPadding,
    background: { r: 34, g: 52, b: 17, alpha: 0 },
  })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const hiddenFlower = [42, 61, 21];
for (let i = 0; i < flowerInfo.width * flowerInfo.height; i++) {
  const offset = i * 4;
  const alpha = flowerPixels[offset + 3];
  const red = flowerPixels[offset];
  const green = flowerPixels[offset + 1];
  const blue = flowerPixels[offset + 2];
  const nearWhiteMatte = Math.min(red, green, blue) > 202
    && Math.max(red, green, blue) - Math.min(red, green, blue) < 34;
  const syntheticRedFringe = red > 188 && green < 52 && blue < 52;
  if (alpha <= 24 || nearWhiteMatte || syntheticRedFringe) {
    flowerPixels[offset] = hiddenFlower[0];
    flowerPixels[offset + 1] = hiddenFlower[1];
    flowerPixels[offset + 2] = hiddenFlower[2];
    flowerPixels[offset + 3] = 0;
  } else if (alpha < 188) {
    const visible = (alpha - 24) / 164;
    flowerPixels[offset] = clampByte(flowerPixels[offset] * visible + hiddenFlower[0] * (1 - visible));
    flowerPixels[offset + 1] = clampByte(flowerPixels[offset + 1] * visible + hiddenFlower[1] * (1 - visible));
    flowerPixels[offset + 2] = clampByte(flowerPixels[offset + 2] * visible + hiddenFlower[2] * (1 - visible));
  }
}
const flowerCell = await sharp(flowerPixels, { raw: flowerInfo }).png().toBuffer();
const cells = [crateCell, planterCell, await soilCell(), flowerCell];
const basePng = await sharp({
  create: {
    width: atlasSize,
    height: atlasSize,
    channels: 4,
    background: { r: hiddenFlower[0], g: hiddenFlower[1], b: hiddenFlower[2], alpha: 0 },
  },
}).composite(cells.map((input, index) => ({
  input,
  left: (index % 2) * cellSize,
  top: Math.floor(index / 2) * cellSize,
}))).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();

const basePath = path.join(outputRoot, 'box-prop-v1.base.webp');
await sharp(basePng)
  .webp({ quality: 88, alphaQuality: 100, smartSubsample: true, effort: 6 })
  .toFile(basePath);

const dataSize = 512;
const { data: atlas, info } = await sharp(basePng)
  .resize(dataSize, dataSize, { kernel: sharp.kernel.mitchell })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const luminance = new Float32Array(dataSize * dataSize);
const alpha = new Float32Array(dataSize * dataSize);
for (let i = 0; i < luminance.length; i++) {
  const offset = i * info.channels;
  luminance[i] = (atlas[offset] * 0.2126 + atlas[offset + 1] * 0.7152
    + atlas[offset + 2] * 0.0722) / 255;
  alpha[i] = atlas[offset + 3] / 255;
}
const sample = (values, x, y) => values[
  Math.max(0, Math.min(dataSize - 1, y)) * dataSize
  + Math.max(0, Math.min(dataSize - 1, x))
];
const normal = Buffer.alloc(dataSize * dataSize * 3);
const mr = Buffer.alloc(dataSize * dataSize * 3);
for (let y = 0; y < dataSize; y++) {
  for (let x = 0; x < dataSize; x++) {
    const index = y * dataSize + x;
    const dx = (sample(luminance, x + 1, y) - sample(luminance, x - 1, y)) * 1.65;
    const dy = (sample(luminance, x, y + 1) - sample(luminance, x, y - 1)) * 1.65;
    const edgeX = (sample(alpha, x + 1, y) - sample(alpha, x - 1, y)) * 0.55;
    const edgeY = (sample(alpha, x, y + 1) - sample(alpha, x, y - 1)) * 0.55;
    const nx = -(dx + edgeX);
    const ny = dy + edgeY;
    const length = Math.hypot(nx, ny, 1);
    const offset = index * 3;
    normal[offset] = clampByte((nx / length * 0.5 + 0.5) * 255);
    normal[offset + 1] = clampByte((ny / length * 0.5 + 0.5) * 255);
    normal[offset + 2] = clampByte((1 / length * 0.5 + 0.5) * 255);
    const cellX = x >= dataSize * 0.5 ? 1 : 0;
    const cellY = y >= dataSize * 0.5 ? 1 : 0;
    const cell = cellY * 2 + cellX;
    const localX = x % (dataSize * 0.5);
    const localY = y % (dataSize * 0.5);
    const ironRegion = cell === 0 && (
      localX < 22 || localX > dataSize * 0.5 - 22
      || (localY > 115 && localY < 143)
    ) && luminance[index] < 0.38;
    const baseRoughness = ironRegion ? 174
      : cell === 0 ? 211 : cell === 1 ? 222 : cell === 2 ? 238 : 220;
    mr[offset] = 255;
    mr[offset + 1] = clampByte(baseRoughness + (0.5 - luminance[index]) * 18);
    mr[offset + 2] = ironRegion ? 224 : 0;
  }
}
const normalPath = path.join(outputRoot, 'box-prop-v1.normal.jpg');
const mrPath = path.join(outputRoot, 'box-prop-v1.mr.jpg');
await sharp(normal, { raw: { width: dataSize, height: dataSize, channels: 3 } })
  .jpeg({ quality: 91, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toFile(normalPath);
await sharp(mr, { raw: { width: dataSize, height: dataSize, channels: 3 } })
  .jpeg({ quality: 86, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toFile(mrPath);

const outputs = await Promise.all([basePath, normalPath, mrPath].map(async (file) => ({
  file,
  bytes: (await fs.stat(file)).size,
})));
console.log(JSON.stringify({ crateInput, flowerInput, atlasSize, dataSize, outputs }, null, 2));

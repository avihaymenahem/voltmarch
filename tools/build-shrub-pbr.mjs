#!/usr/bin/env node

/** Build the shared shrub/hedge atlas and compact PBR data maps. */

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
const input = path.resolve(valueAfter(
  '--input',
  'packages/assets/game/environment/shrub/source/temperate-shrub-v1-imagegen.png',
));
const hedgeInput = path.resolve(valueAfter(
  '--hedge-input',
  'packages/assets/game/environment/shrub/source/temperate-hedge-v1-imagegen.png',
));
const outputRoot = path.resolve(valueAfter(
  '--output-root',
  'packages/assets/game/environment/shrub/material',
));

const atlasSize = 1024;
const cellSize = atlasSize / 2;
const leafPadding = 22;
const hiddenLeaf = [74, 86, 37];
const variants = [
  { source: 'bush', brightness: 0.88, saturation: 0.86, hue: 0, flop: false },
  { source: 'bush', brightness: 0.79, saturation: 0.78, hue: 4, flop: true },
  { source: 'hedge', brightness: 0.82, saturation: 0.76, hue: -4, flop: false, fit: 'contain' },
  { source: 'hedge', brightness: 0.73, saturation: 0.80, hue: 5, flop: true, fit: 'cover' },
];

await fs.mkdir(outputRoot, { recursive: true });
const trimmedBush = await sharp(input)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
const trimmedHedge = await sharp(hedgeInput)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

const cells = [];
for (const variant of variants) {
  const source = variant.source === 'hedge' ? trimmedHedge : trimmedBush;
  let pipeline = sharp(source)
    .resize(cellSize - leafPadding * 2, cellSize - leafPadding * 2, {
      fit: variant.fit ?? 'contain',
      position: variant.position ?? 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .modulate({
      brightness: variant.brightness,
      saturation: variant.saturation,
      hue: variant.hue,
    });
  if (variant.flop) pipeline = pipeline.flop();
  const { data, info } = await pipeline
    .extend({
      top: leafPadding,
      bottom: leafPadding,
      left: leafPadding,
      right: leafPadding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < info.width * info.height; i++) {
    const offset = i * 4;
    const alphaValue = data[offset + 3];
    if (alphaValue <= 22) {
      data[offset + 3] = 0;
      data[offset] = hiddenLeaf[0];
      data[offset + 1] = hiddenLeaf[1];
      data[offset + 2] = hiddenLeaf[2];
    } else if (alphaValue < 188) {
      const visible = Math.max(0, Math.min(1, (alphaValue - 22) / 166));
      data[offset] = Math.round(data[offset] * visible + hiddenLeaf[0] * (1 - visible));
      data[offset + 1] = Math.round(
        data[offset + 1] * visible + hiddenLeaf[1] * (1 - visible),
      );
      data[offset + 2] = Math.round(
        data[offset + 2] * visible + hiddenLeaf[2] * (1 - visible),
      );
    }
  }
  cells.push(await sharp(data, { raw: info }).png().toBuffer());
}

const basePng = await sharp({
  create: {
    width: atlasSize,
    height: atlasSize,
    channels: 4,
    background: { r: hiddenLeaf[0], g: hiddenLeaf[1], b: hiddenLeaf[2], alpha: 0 },
  },
}).composite(cells.map((cell, index) => ({
  input: cell,
  left: (index % 2) * cellSize,
  top: Math.floor(index / 2) * cellSize,
}))).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
const basePath = path.join(outputRoot, 'temperate-shrub-v1.base.webp');
await sharp(basePng)
  .webp({ quality: 90, alphaQuality: 100, smartSubsample: true, effort: 6 })
  .toFile(basePath);

const dataSize = 512;
const { data: atlas, info: atlasInfo } = await sharp(basePng)
  .resize(dataSize, dataSize, { kernel: sharp.kernel.mitchell })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const luminance = new Float32Array(dataSize * dataSize);
const alpha = new Float32Array(dataSize * dataSize);
for (let i = 0; i < luminance.length; i++) {
  const offset = i * atlasInfo.channels;
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
    const dx = (sample(luminance, x + 1, y) - sample(luminance, x - 1, y)) * 2.2;
    const dy = (sample(luminance, x, y + 1) - sample(luminance, x, y - 1)) * 2.2;
    const edgeX = (sample(alpha, x + 1, y) - sample(alpha, x - 1, y)) * 0.8;
    const edgeY = (sample(alpha, x, y + 1) - sample(alpha, x, y - 1)) * 0.8;
    const nx = -(dx + edgeX);
    const ny = dy + edgeY;
    const length = Math.hypot(nx, ny, 1);
    const offset = index * 3;
    normal[offset] = Math.round((nx / length * 0.5 + 0.5) * 255);
    normal[offset + 1] = Math.round((ny / length * 0.5 + 0.5) * 255);
    normal[offset + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
    mr[offset] = 255;
    mr[offset + 1] = Math.round(218 + (1 - luminance[index]) * 20);
    mr[offset + 2] = 0;
  }
}
const normalPath = path.join(outputRoot, 'temperate-shrub-v1.normal.jpg');
const mrPath = path.join(outputRoot, 'temperate-shrub-v1.mr.jpg');
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
console.log(JSON.stringify({ input, hedgeInput, atlasSize, dataSize, outputs }, null, 2));

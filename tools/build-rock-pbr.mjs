#!/usr/bin/env node

/** Build a compact, shared mineral PBR set from an ImageGen albedo source. */

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
  'packages/assets/game/environment/mineral/source/mineral-rock-v1-imagegen.png',
));
const outputRoot = path.resolve(valueAfter(
  '--output-root',
  'packages/assets/game/environment/mineral/material',
));
const size = Number(valueAfter('--size', '1024'));
if (!Number.isInteger(size) || size < 256 || size > 2048) {
  throw new Error('--size must be an integer from 256 through 2048');
}

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

function featherWrappedEdges(pixels, width, height, channels, feather) {
  const output = Buffer.from(pixels);
  const blendPair = (a, b, t) => {
    for (let channel = 0; channel < channels; channel++) {
      const average = (pixels[a + channel] + pixels[b + channel]) * 0.5;
      output[a + channel] = clampByte(average * (1 - t) + pixels[a + channel] * t);
      output[b + channel] = clampByte(average * (1 - t) + pixels[b + channel] * t);
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < feather; x++) {
      const opposite = width - 1 - x;
      blendPair((y * width + x) * channels, (y * width + opposite) * channels, x / feather);
    }
  }
  const horizontal = Buffer.from(output);
  for (let y = 0; y < feather; y++) {
    const opposite = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const a = (y * width + x) * channels;
      const b = (opposite * width + x) * channels;
      for (let channel = 0; channel < channels; channel++) {
        const average = (horizontal[a + channel] + horizontal[b + channel]) * 0.5;
        const t = y / feather;
        output[a + channel] = clampByte(average * (1 - t) + horizontal[a + channel] * t);
        output[b + channel] = clampByte(average * (1 - t) + horizontal[b + channel] * t);
      }
    }
  }
  return output;
}

function sampleWrapped(values, width, height, x, y) {
  const wrappedX = (x + width) % width;
  const wrappedY = (y + height) % height;
  return values[wrappedY * width + wrappedX];
}

await fs.mkdir(outputRoot, { recursive: true });
const { data: resized, info } = await sharp(input)
  .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const basePixels = featherWrappedEdges(
  resized,
  info.width,
  info.height,
  info.channels,
  Math.max(24, Math.round(size * 0.045)),
);

const basePath = path.join(outputRoot, 'mineral-rock-v1.base.jpg');
await sharp(basePixels, { raw: info })
  .modulate({ brightness: 0.88, saturation: 0.78 })
  .sharpen({ sigma: 0.55, m1: 0.45, m2: 1.1 })
  .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toFile(basePath);

const luminance = new Float32Array(size * size);
for (let i = 0; i < luminance.length; i++) {
  const offset = i * info.channels;
  luminance[i] = (
    basePixels[offset] * 0.2126
    + basePixels[offset + 1] * 0.7152
    + basePixels[offset + 2] * 0.0722
  ) / 255;
}

const normalPixels = Buffer.alloc(size * size * 3);
const detail = new Float32Array(size * size);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const dx = (
      sampleWrapped(luminance, size, size, x + 1, y - 1)
      + 2 * sampleWrapped(luminance, size, size, x + 1, y)
      + sampleWrapped(luminance, size, size, x + 1, y + 1)
      - sampleWrapped(luminance, size, size, x - 1, y - 1)
      - 2 * sampleWrapped(luminance, size, size, x - 1, y)
      - sampleWrapped(luminance, size, size, x - 1, y + 1)
    ) * 1.7;
    const dy = (
      sampleWrapped(luminance, size, size, x - 1, y + 1)
      + 2 * sampleWrapped(luminance, size, size, x, y + 1)
      + sampleWrapped(luminance, size, size, x + 1, y + 1)
      - sampleWrapped(luminance, size, size, x - 1, y - 1)
      - 2 * sampleWrapped(luminance, size, size, x, y - 1)
      - sampleWrapped(luminance, size, size, x + 1, y - 1)
    ) * 1.7;
    const length = Math.hypot(dx, dy, 1);
    const offset = (y * size + x) * 3;
    normalPixels[offset] = clampByte((-dx / length * 0.5 + 0.5) * 255);
    normalPixels[offset + 1] = clampByte((dy / length * 0.5 + 0.5) * 255);
    normalPixels[offset + 2] = clampByte((1 / length * 0.5 + 0.5) * 255);
    detail[y * size + x] = Math.min(1, Math.hypot(dx, dy) * 1.7);
  }
}
const normalPath = path.join(outputRoot, 'mineral-rock-v1.normal.jpg');
await sharp(normalPixels, { raw: { width: size, height: size, channels: 3 } })
  .resize(Math.min(512, size), Math.min(512, size), { kernel: sharp.kernel.mitchell })
  .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toFile(normalPath);

const mrSize = Math.min(512, size);
const mrPixels = Buffer.alloc(mrSize * mrSize * 3);
for (let y = 0; y < mrSize; y++) {
  for (let x = 0; x < mrSize; x++) {
    const sourceX = Math.floor(x / mrSize * size);
    const sourceY = Math.floor(y / mrSize * size);
    const sourceIndex = sourceY * size + sourceX;
    const roughness = 218 + detail[sourceIndex] * 26 + (0.52 - luminance[sourceIndex]) * 18;
    const offset = (y * mrSize + x) * 3;
    mrPixels[offset] = 255; // AO: deliberately unbaked; geometry/lighting own occlusion.
    mrPixels[offset + 1] = clampByte(roughness);
    mrPixels[offset + 2] = 0; // Natural stone is dielectric.
  }
}
const mrPath = path.join(outputRoot, 'mineral-rock-v1.mr.jpg');
await sharp(mrPixels, { raw: { width: mrSize, height: mrSize, channels: 3 } })
  .jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toFile(mrPath);

const outputs = await Promise.all([basePath, normalPath, mrPath].map(async (file) => ({
  file,
  bytes: (await fs.stat(file)).size,
})));
console.log(JSON.stringify({ input, size, outputs }, null, 2));

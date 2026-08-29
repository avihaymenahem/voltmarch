#!/usr/bin/env node

/** Build one alpha-tested PBR atlas for autumn, conifer, palm and grass cards. */

import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const root = path.resolve('packages/assets/game/environment/extended-foliage');
const sourceRoot = path.join(root, 'source');
const materialRoot = path.join(root, 'material');
const size = 1024;
const cellSize = size / 2;

const cells = [
  ['autumn-branch-v1-imagegen.png', [126, 66, 22]],
  ['conifer-branch-v1-imagegen.png', [39, 57, 31]],
  ['palm-fronds-v1-imagegen.png', [71, 76, 42]],
  ['grass-tuft-v1-imagegen.png', [76, 88, 34]],
];

async function conditionedCell(file, edgeColour) {
  const input = sharp(path.join(sourceRoot, file)).ensureAlpha().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } });
  const { data, info } = await input.resize(cellSize - 20, cellSize - 20, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha <= 18) {
      data[i] = edgeColour[0];
      data[i + 1] = edgeColour[1];
      data[i + 2] = edgeColour[2];
      data[i + 3] = 0;
      continue;
    }
    if (alpha < 210) {
      const blend = (210 - alpha) / 210 * 0.72;
      data[i] = Math.round(data[i] * (1 - blend) + edgeColour[0] * blend);
      data[i + 1] = Math.round(data[i + 1] * (1 - blend) + edgeColour[1] * blend);
      data[i + 2] = Math.round(data[i + 2] * (1 - blend) + edgeColour[2] * blend);
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

await fs.mkdir(materialRoot, { recursive: true });
const composites = [];
for (let i = 0; i < cells.length; i++) {
  composites.push({
    input: await conditionedCell(...cells[i]),
    left: (i % 2) * cellSize + 10,
    top: Math.floor(i / 2) * cellSize + 10,
  });
}
composites.push({
  input: await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 142, g: 101, b: 63, alpha: 1 } },
  }).png().toBuffer(),
  left: 0,
  top: 0,
});
const basePng = await sharp({
  create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
}).composite(composites).png().toBuffer();
const baseRaw = await sharp(basePng).raw().toBuffer();

const normal = Buffer.alloc(size * size * 3);
const mr = Buffer.alloc(size * size * 3);
const heightAt = (x, y) => {
  const clampedX = Math.max(0, Math.min(size - 1, x));
  const clampedY = Math.max(0, Math.min(size - 1, y));
  const offset = (clampedY * size + clampedX) * 4;
  const alpha = baseRaw[offset + 3] / 255;
  return (baseRaw[offset] * 0.24 + baseRaw[offset + 1] * 0.62 + baseRaw[offset + 2] * 0.14) * alpha;
};
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const baseOffset = (y * size + x) * 4;
    const outOffset = (y * size + x) * 3;
    const alpha = baseRaw[baseOffset + 3];
    const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * 0.34;
    const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * 0.34;
    const nx = -dx;
    const ny = dy;
    const nz = 255;
    const length = Math.hypot(nx, ny, nz) || 1;
    normal[outOffset] = Math.round(128 + nx / length * 127);
    normal[outOffset + 1] = Math.round(128 + ny / length * 127);
    normal[outOffset + 2] = Math.round(128 + nz / length * 127);
    const luma = baseRaw[baseOffset] * 0.24 + baseRaw[baseOffset + 1] * 0.62 + baseRaw[baseOffset + 2] * 0.14;
    mr[outOffset] = 255;
    mr[outOffset + 1] = alpha === 0 ? 230 : Math.round(202 + (255 - luma) * 0.10);
    mr[outOffset + 2] = 0;
  }
}

await sharp(basePng).webp({ quality: 92, alphaQuality: 100, effort: 6 })
  .toFile(path.join(materialRoot, 'extended-foliage-v1.base.webp'));
await sharp(normal, { raw: { width: size, height: size, channels: 3 } })
  .resize(512, 512).jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
  .toFile(path.join(materialRoot, 'extended-foliage-v1.normal.jpg'));
await sharp(mr, { raw: { width: size, height: size, channels: 3 } })
  .resize(512, 512).jpeg({ quality: 91, chromaSubsampling: '4:4:4' })
  .toFile(path.join(materialRoot, 'extended-foliage-v1.mr.jpg'));

console.log(JSON.stringify({ root, size, cells: cells.map(([file]) => file) }, null, 2));

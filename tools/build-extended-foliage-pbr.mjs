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
const coniferBarkRect = Object.freeze({ left: 520, top: 8, width: 88, height: 128 });
const coniferBranchRect = Object.freeze({ left: 520, top: 144, width: 184, height: 350 });
const coniferCrownRect = Object.freeze({ left: 712, top: 10, width: 302, height: 492 });

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

/**
 * Reserve one opaque, mip-safe bark tile inside an unused part of the conifer
 * cell. The previous trunk sampled a single green needle texel and could only
 * read as a flat olive pole after vertex tinting. This deterministic plate
 * provides broad vertical fissures and darker scale breaks without adding a
 * material, texture sampler, paid source, or touching another atlas cell.
 */
async function coniferBarkTile() {
  const { width, height } = coniferBarkRect;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const vertical = Math.sin(x * 0.34 + Math.sin(y * 0.075) * 1.8);
      const plates = Math.sin(y * 0.23 + Math.sin(x * 0.11) * 1.4);
      const fissure = Math.abs(Math.sin(x * 0.47 + y * 0.028)) > 0.91 ? -31 : 0;
      const knotX = x - 61;
      const knotY = y - 76;
      const knot = Math.exp(-(knotX * knotX / 190 + knotY * knotY / 58)) * 28;
      const shade = vertical * 16 + plates * 8 + fissure - knot;
      const offset = (y * width + x) * 4;
      data[offset] = Math.max(50, Math.min(154, Math.round(112 + shade)));
      data[offset + 1] = Math.max(31, Math.min(108, Math.round(72 + shade * 0.65)));
      data[offset + 2] = Math.max(20, Math.min(76, Math.round(43 + shade * 0.42)));
      data[offset + 3] = 255;
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function conditionedConiferLayer(
  width,
  height,
  { mirror = false, tone = [1, 1, 1] } = {},
) {
  const edgeColour = cells[1][1];
  let source = sharp(path.join(sourceRoot, cells[1][0]))
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width, height, fit: height === undefined ? 'contain' : 'fill' });
  if (mirror) source = source.flop();
  const { data, info } = await source
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha <= 18) {
      data[i] = edgeColour[0];
      data[i + 1] = edgeColour[1];
      data[i + 2] = edgeColour[2];
      data[i + 3] = 0;
    } else if (alpha < 210) {
      const blend = (210 - alpha) / 210 * 0.72;
      data[i] = Math.round(data[i] * (1 - blend) + edgeColour[0] * blend);
      data[i + 1] = Math.round(data[i + 1] * (1 - blend) + edgeColour[1] * blend);
      data[i + 2] = Math.round(data[i + 2] * (1 - blend) + edgeColour[2] * blend);
    }
    if (data[i + 3] > 0) {
      // Restore the richer living-green read lost in the old dark vertex tint
      // stack while retaining the source's natural needle-to-needle variation.
      data[i] = Math.min(255, Math.round((data[i] * 0.98 + 3) * tone[0]));
      data[i + 1] = Math.min(255, Math.round((data[i + 1] * 1.14 + 5) * tone[1]));
      data[i + 2] = Math.min(255, Math.round((data[i + 2] * 0.94 + 3) * tone[2]));
    }
  }
  return {
    input: await sharp(data, { raw: info }).png().toBuffer(),
    width: info.width,
    height: info.height,
  };
}

async function coniferCrownTile() {
  // A pine is ordered at the whole-tree scale but irregular at the branch
  // scale. Each tier therefore keeps the descending crown envelope while
  // changing lateral reach, handedness and local needle value. These are
  // authored deterministic profiles, not runtime noise: LODs remain stable
  // and no branch can detach into the random-spray failure mode.
  const tiers = [
    { width: 92, top: 6, offsetX: -4, mirror: false, tone: [1.04, 1.02, 0.98] },
    { width: 124, top: 43, offsetX: 9, mirror: true, tone: [0.95, 1.04, 0.97] },
    { width: 170, top: 76, offsetX: -10, mirror: false, tone: [1.02, 0.98, 0.94] },
    { width: 190, top: 118, offsetX: 12, mirror: true, tone: [0.92, 1.03, 0.96] },
    { width: 238, top: 149, offsetX: -9, mirror: true, tone: [1.03, 1.00, 0.94] },
    { width: 258, top: 198, offsetX: 8, mirror: false, tone: [0.94, 1.04, 0.98] },
    { width: 294, top: 226, offsetX: 0, mirror: true, tone: [1.00, 0.98, 0.93] },
  ];
  const composites = [];
  for (const tier of [...tiers].reverse()) {
    const layer = await conditionedConiferLayer(tier.width, undefined, tier);
    composites.push({
      input: layer.input,
      left: Math.round((coniferCrownRect.width - layer.width) * 0.5 + tier.offsetX),
      top: tier.top,
    });
  }
  return sharp({
    create: {
      width: coniferCrownRect.width,
      height: coniferCrownRect.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png().toBuffer();
}

async function coniferBranchTile() {
  const layer = await conditionedConiferLayer(
    coniferBranchRect.width - 8,
    coniferBranchRect.height - 16,
  );
  return sharp({
    create: {
      width: coniferBranchRect.width,
      height: coniferBranchRect.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{
    input: layer.input,
    left: Math.round((coniferBranchRect.width - layer.width) * 0.5),
    top: Math.round((coniferBranchRect.height - layer.height) * 0.5),
  }]).png().toBuffer();
}

await fs.mkdir(materialRoot, { recursive: true });
const composites = [];
for (let i = 0; i < cells.length; i++) {
  if (i === 1) continue;
  composites.push({
    input: await conditionedCell(...cells[i]),
    left: (i % 2) * cellSize + 10,
    top: Math.floor(i / 2) * cellSize + 10,
  });
}
composites.push({
  input: await coniferCrownTile(),
  left: coniferCrownRect.left,
  top: coniferCrownRect.top,
});
composites.push({
  input: await coniferBarkTile(),
  left: coniferBarkRect.left,
  top: coniferBarkRect.top,
});
composites.push({
  input: await coniferBranchTile(),
  left: coniferBranchRect.left,
  top: coniferBranchRect.top,
});
// The game-facing conifer shell and branch volumes point-sample this recessed
// opaque swatch. A 48 px guard survives the full gameplay mip range, while the
// surrounding authored branch tile remains available for cutout derivatives.
composites.push({
  input: await sharp({
    create: {
      width: 48,
      height: 48,
      channels: 4,
      background: { r: 72, g: 126, b: 48, alpha: 1 },
    },
  }).png().toBuffer(),
  left: 596,
  top: 284,
});
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

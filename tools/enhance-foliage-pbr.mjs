#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const [inputArg, outputArg, ...flags] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  throw new Error(
    'usage: node tools/enhance-foliage-pbr.mjs <input.glb> <output.glb> '
    + '[--base-atlas=<edited.png>]',
  );
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
const atlasFlag = flags.find((flag) => flag.startsWith('--base-atlas='));
const replacementAtlas = atlasFlag === undefined
  ? undefined
  : path.resolve(atlasFlag.slice('--base-atlas='.length));
if (!fs.existsSync(input)) throw new Error(`input does not exist: ${input}`);
if (input === output) throw new Error('input and output must differ');
if (replacementAtlas !== undefined && !fs.existsSync(replacementAtlas)) {
  throw new Error(`base atlas does not exist: ${replacementAtlas}`);
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const byte = (value) => Math.round(clamp(value, 0, 255));

function textureRoles(document) {
  const roles = new Map();
  const mark = (texture, role) => {
    if (texture === null) return;
    const entry = roles.get(texture) ?? new Set();
    entry.add(role);
    roles.set(texture, entry);
  };
  for (const material of document.getRoot().listMaterials()) {
    mark(material.getBaseColorTexture(), 'base');
    mark(material.getNormalTexture(), 'normal');
    mark(material.getMetallicRoughnessTexture(), 'metalRough');
  }
  return roles;
}

async function decode(texture, dimensions) {
  const image = texture.getImage();
  if (image === null) throw new Error(`texture ${texture.getName() || '<unnamed>'} has no image`);
  let pipeline = sharp(image);
  if (dimensions !== undefined) {
    pipeline = pipeline.resize(dimensions.width, dimensions.height, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    });
  }
  return pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function leafWeight(r, g, b) {
  // Meshy bakes the trunk and canopy into one atlas. This soft chroma mask lets
  // us give bark and foliage different microstructure without requiring a
  // second material or changing the generated UV layout.
  return clamp((g - Math.max(r * 0.96, b * 1.05) - 4) / 22, 0, 1);
}

function pattern(x, y, leaf) {
  const broad = Math.sin(x * 0.031 + y * 0.019) * 0.55
    + Math.sin(x * -0.017 + y * 0.043) * 0.45;
  const fine = Math.sin(x * 0.173 - y * 0.227) * 0.55
    + Math.sin(x * 0.311 + y * 0.139) * 0.45;
  const barkGrain = Math.sin(x * 0.075 + Math.sin(y * 0.019) * 1.8) * 0.62
    + Math.sin(x * 0.19 - y * 0.013) * 0.38;
  return leaf * (broad * 0.62 + fine * 0.38) + (1 - leaf) * barkGrain;
}

async function enhanceBase(texture, atlas) {
  const { data, info } = await decode(texture);
  const heightField = new Float32Array(info.width * info.height);
  const replacement = atlas === undefined ? undefined : await sharp(atlas)
    .resize(info.width, info.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const replacementBlur = atlas === undefined ? undefined : await sharp(atlas)
    .resize(info.width, info.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .blur(8)
    .ensureAlpha()
    .raw()
    .toBuffer();

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const pixel = y * info.width + x;
      const offset = pixel * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const leaf = leafWeight(r, g, b);
      const proceduralDetail = pattern(x, y, leaf);
      let outR;
      let outG;
      let outB;
      if (replacement !== undefined && replacementBlur !== undefined) {
        // Transfer ImageGen's high-frequency material detail while retaining a
        // substantial share of Meshy's registered low-frequency colour. This
        // prevents a generative edit from moving UV islands or opening seams.
        const highR = replacement[offset] - replacementBlur[offset];
        const highG = replacement[offset + 1] - replacementBlur[offset + 1];
        const highB = replacement[offset + 2] - replacementBlur[offset + 2];
        outR = r * 0.58 + replacementBlur[offset] * 0.42 + highR * 0.92;
        outG = g * 0.58 + replacementBlur[offset + 1] * 0.42 + highG * 0.92;
        outB = b * 0.58 + replacementBlur[offset + 2] * 0.42 + highB * 0.92;
        if (leaf >= 0.5) {
          outG = Math.max(outG, outR * 1.05, outB * 1.12);
        } else if (leaf <= 0.18) {
          outR = Math.max(outR, outG * 0.92);
          outB = Math.min(outB, outR * 0.86);
        }
      } else {
        const modulation = 1 + proceduralDetail * (0.075 + leaf * 0.035);
        const coolVariation = leaf * Math.sin(x * 0.047 - y * 0.029);
        outR = r * modulation - coolVariation * 1.8;
        outG = g * modulation + coolVariation * 2.4;
        outB = b * modulation - coolVariation * 0.7;
      }

      data[offset] = byte(outR);
      data[offset + 1] = byte(outG);
      data[offset + 2] = byte(outB);

      const luminance = (outR * 0.2126 + outG * 0.7152 + outB * 0.0722) / 255;
      heightField[pixel] = luminance * (atlas === undefined ? 0.22 : 0.72)
        + proceduralDetail * (atlas === undefined ? 0.24 + leaf * 0.16 : 0.08);
    }
  }

  texture.setImage(await sharp(data, { raw: info }).jpeg({
    quality: 95,
    chromaSubsampling: '4:4:4',
  }).toBuffer());
  texture.setMimeType('image/jpeg');
  return { width: info.width, pixelHeight: info.height, heightField };
}

async function enhanceNormal(texture, baseDetail) {
  const { data, info } = await decode(texture, {
    width: baseDetail.width,
    height: baseDetail.pixelHeight,
  });
  const { width, height } = info;
  const field = baseDetail.heightField;

  for (let y = 0; y < height; y += 1) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(width - 1, x + 1);
      const pixel = y * width + x;
      const offset = pixel * 4;
      const existingX = data[offset] / 127.5 - 1;
      const existingY = data[offset + 1] / 127.5 - 1;
      const slopeX = clamp((field[y * width + xm] - field[y * width + xp]) * 2.9, -0.72, 0.72);
      const slopeY = clamp((field[ym * width + x] - field[yp * width + x]) * 2.9, -0.72, 0.72);
      let nx = existingX * 0.3 + slopeX * 0.7;
      let ny = existingY * 0.3 + slopeY * 0.7;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz);
      nx /= length;
      ny /= length;
      nz /= length;
      data[offset] = byte((nx * 0.5 + 0.5) * 255);
      data[offset + 1] = byte((ny * 0.5 + 0.5) * 255);
      data[offset + 2] = byte((nz * 0.5 + 0.5) * 255);
    }
  }

  texture.setImage(await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer());
  texture.setMimeType('image/png');
}

async function enhanceMetalRough(texture, baseTexture) {
  const base = await decode(baseTexture);
  const { data, info } = await decode(texture, base.info);

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 4;
      const leaf = leafWeight(base.data[offset], base.data[offset + 1], base.data[offset + 2]);
      const roughnessVariation = Math.sin(x * 0.061 + y * 0.037) * 7;
      data[offset] = 255;
      data[offset + 1] = byte(222 - leaf * 30 + roughnessVariation);
      data[offset + 2] = 0;
    }
  }

  texture.setImage(await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer());
  texture.setMimeType('image/png');
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);
const roles = textureRoles(document);
const baseTexture = [...roles.entries()].find(([, entry]) => entry.has('base'))?.[0];
const normalTexture = [...roles.entries()].find(([, entry]) => entry.has('normal'))?.[0];
const metalRoughTexture = [...roles.entries()].find(([, entry]) => entry.has('metalRough'))?.[0];
if (!baseTexture || !normalTexture || !metalRoughTexture) {
  throw new Error('foliage enhancement requires base, normal and metallic-roughness textures');
}

const baseDetail = await enhanceBase(baseTexture, replacementAtlas);
await enhanceNormal(normalTexture, baseDetail);
await enhanceMetalRough(metalRoughTexture, baseTexture);
for (const material of document.getRoot().listMaterials()) {
  material.setMetallicFactor(0);
  material.setRoughnessFactor(1);
  material.setNormalScale(1.15);
}

await fsp.mkdir(path.dirname(output), { recursive: true });
await io.write(output, document);
console.log(JSON.stringify({
  input,
  output,
  baseAtlas: replacementAtlas ?? null,
  width: baseDetail.width,
  height: baseDetail.pixelHeight,
}));

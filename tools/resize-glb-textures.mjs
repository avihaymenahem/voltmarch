#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const inputArg = args[0];
const outputArg = args[1];
const profileFlag = args.indexOf('--profile');
const profileName = profileFlag >= 0 ? args[profileFlag + 1] : 'building';
const paletteFlag = args.indexOf('--palette');
const paletteName = paletteFlag >= 0 ? args[paletteFlag + 1] : 'none';
const accentFlag = args.indexOf('--accent-preset');
const accentPreset = accentFlag >= 0 ? args[accentFlag + 1] : 'none';
const surfaceFlag = args.indexOf('--surface-profile');
const surfaceProfile = surfaceFlag >= 0 ? args[surfaceFlag + 1] : 'none';
const sealSwatch = args.includes('--seal-swatch');
const PROFILES = Object.freeze({
  building: { base: 2048, normal: 2048, metalRough: 1024, other: 1024 },
  vehicle: { base: 2048, normal: 2048, metalRough: 1024, other: 1024 },
  hero: { base: 2048, normal: 2048, metalRough: 1024, other: 2048 },
  infantry: { base: 1024, normal: 1024, metalRough: 512, other: 512 },
  defence: { base: 1024, normal: 1024, metalRough: 512, other: 512 },
});
if (!inputArg || !outputArg) {
  throw new Error(
    'usage: node tools/resize-glb-textures.mjs <input.glb> <output.glb> '
    + '[--profile building|vehicle|hero|infantry|defence] '
    + '[--palette none|soviet-field] [--accent-preset none|soviet-conyard] '
    + '[--surface-profile none|soviet-family] [--seal-swatch]',
  );
}
const profile = PROFILES[profileName];
if (!profile) throw new Error(`unknown texture profile "${profileName}"`);
if (!new Set(['none', 'soviet-field']).has(paletteName)) {
  throw new Error(`unknown texture palette "${paletteName}"`);
}
if (!new Set(['none', 'soviet-conyard']).has(accentPreset)) {
  throw new Error(`unknown texture accent preset "${accentPreset}"`);
}
if (!new Set(['none', 'soviet-family']).has(surfaceProfile)) {
  throw new Error(`unknown texture surface profile "${surfaceProfile}"`);
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 1e-6) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * (((b - r) / delta) + 2);
    else hue = 60 * (((r - g) / delta) + 4);
  }
  if (hue < 0) hue += 360;
  return [hue, max <= 1e-6 ? 0 : delta / max, max];
}

function hsvToRgb(hue, saturation, value) {
  const chroma = value * saturation;
  const sector = hue / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  let rgb;
  if (sector < 1) rgb = [chroma, x, 0];
  else if (sector < 2) rgb = [x, chroma, 0];
  else if (sector < 3) rgb = [0, chroma, x];
  else if (sector < 4) rgb = [0, x, chroma];
  else if (sector < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const match = value - chroma;
  return rgb.map((channel) => channel + match);
}

/**
 * Meshy frequently turns a tightly specified olive concept into one broad
 * sandstone/orange material. This deterministic conditioning pass restores
 * the Soviet material hierarchy without repainting normals or metal/roughness:
 * deep red stays red, copper-red trim becomes a controlled Soviet red accent,
 * saturated machinery becomes safety yellow, and the remaining warm shell
 * becomes field-painted olive. Very dark machinery is left dark so the model
 * keeps readable material separation after the broad armor lift.
 */
function rasterizeUvTriangle(mask, width, height, triangle) {
  const points = triangle.map(([u, v]) => [
    clamp01(u) * (width - 1),
    (1 - clamp01(v)) * (height - 1),
  ]);
  const [a, b, c] = points;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-5) return;
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const sign = area < 0 ? -1 : 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const ab = sign * ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]));
      const bc = sign * ((c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]));
      const ca = sign * ((a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]));
      if (ab >= -0.01 && bc >= -0.01 && ca >= -0.01) mask[y * width + x] = 1;
    }
  }
}

async function applyBasePalette(bytes, palette, accentTriangles) {
  if (palette === 'none') return bytes;
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;
    let [h, s, v] = rgbToHsv(r, g, b);

    const red = (h <= 15 || h >= 345) && s >= 0.30;
    const sovietAccent = h > 15 && h <= 34 && s >= 0.20 && v >= 0.16;
    const safetyYellow = h > 32 && h <= 58 && s >= 0.62 && v >= 0.55;
    const warmShell = h > 34 && h <= 72 && s >= 0.08 && v >= 0.12;
    const neutralArmor = s < 0.18 && v >= 0.22 && v <= 0.88;
    if (red) {
      h = 355;
      s = clamp01(Math.max(0.68, s * 1.08));
      v = clamp01(0.08 + v * 0.96);
    } else if (sovietAccent) {
      // Meshy encoded the requested red faction slabs as sparse copper/brown.
      // Reclassify only sufficiently saturated, non-shadow copper pixels so
      // pipes and deliberate trim become readable red without flooding armor.
      h = 356;
      s = clamp01(0.66 + s * 0.22);
      v = clamp01(0.11 + v * 0.92);
    } else if (safetyYellow) {
      h = 47;
      s = clamp01(Math.max(0.72, s));
      v = clamp01(0.02 + v * 1.00);
    } else if (warmShell) {
      h = 78;
      s = clamp01(0.31 + Math.min(s, 0.55) * 0.25);
      // Preserve the generated texture's panel hierarchy. The first pass
      // multiplied every warm value by 0.68, crushing broad Soviet walls into
      // nearly one black mass under the game's directional light.
      v = clamp01(0.10 + v * 0.80);
    } else if (neutralArmor) {
      // Clean retextures often satisfy "no wear" by returning neutral gunmetal.
      // Mid-value neutral plates are the painted shell; keep very dark steel
      // machinery and bright windows neutral while restoring Soviet olive.
      h = 78;
      s = 0.24;
      v = clamp01(0.07 + v * 0.86);
    }

    const [outR, outG, outB] = hsvToRgb(h, s, v);
    data[offset] = Math.round(clamp01(outR) * 255);
    data[offset + 1] = Math.round(clamp01(outG) * 255);
    data[offset + 2] = Math.round(clamp01(outB) * 255);
  }
  if (accentTriangles.length > 0) {
    const mask = new Uint8Array(info.width * info.height);
    for (const triangle of accentTriangles) {
      rasterizeUvTriangle(mask, info.width, info.height, triangle);
    }
    let accentedPixels = 0;
    for (let pixel = 0; pixel < mask.length; pixel++) {
      if (mask[pixel] === 0) continue;
      accentedPixels++;
      const offset = pixel * info.channels;
      const [, sourceS, sourceV] = rgbToHsv(
        data[offset] / 255,
        data[offset + 1] / 255,
        data[offset + 2] / 255,
      );
      const [outR, outG, outB] = hsvToRgb(
        356,
        clamp01(Math.max(0.72, sourceS * 1.08)),
        clamp01(Math.max(0.22, 0.10 + sourceV * 0.94)),
      );
      data[offset] = Math.round(outR * 255);
      data[offset + 1] = Math.round(outG * 255);
      data[offset + 2] = Math.round(outB * 255);
    }
    console.log(`accent mask: ${accentTriangles.length} triangles, ${accentedPixels} texels`);
  }
  return sharp(data, { raw: info }).removeAlpha().jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
const source = await fs.readFile(input);
if (source.readUInt32LE(0) !== 0x46546c67 || source.readUInt32LE(4) !== 2) {
  throw new Error(`${input} is not a glTF 2.0 binary`);
}

const jsonLength = source.readUInt32LE(12);
const jsonType = source.readUInt32LE(16);
if (jsonType !== 0x4e4f534a) throw new Error('first GLB chunk is not JSON');
const document = JSON.parse(source.subarray(20, 20 + jsonLength).toString('utf8').trim());
const binHeader = 20 + jsonLength;
const binLength = source.readUInt32LE(binHeader);
const binType = source.readUInt32LE(binHeader + 4);
if (binType !== 0x004e4942) throw new Error('second GLB chunk is not BIN');
const binary = source.subarray(binHeader + 8, binHeader + 8 + binLength);

function accessorReader(accessorIndex) {
  const accessor = document.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView === undefined) throw new Error('accent mask requires dense accessors');
  const view = document.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const bytesPerComponent = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  if (!components || !bytesPerComponent) throw new Error(`unsupported accessor ${accessor.type}/${accessor.componentType}`);
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? components * bytesPerComponent;
  const read = (index, component = 0) => {
    const offset = start + index * stride + component * bytesPerComponent;
    if (accessor.componentType === 5126) return binary.readFloatLE(offset);
    if (accessor.componentType === 5125) return binary.readUInt32LE(offset);
    if (accessor.componentType === 5123) return binary.readUInt16LE(offset);
    return binary.readUInt8(offset);
  };
  return { accessor, read };
}

function buildAccentTriangles(preset) {
  if (preset === 'none') return [];
  if (document.meshes?.length !== 1 || document.meshes[0].primitives?.length !== 1) {
    throw new Error('texture accents require one mesh and one primitive');
  }
  const primitive = document.meshes[0].primitives[0];
  if (primitive.indices === undefined || primitive.attributes?.TEXCOORD_0 === undefined) {
    throw new Error('texture accents require indexed geometry with TEXCOORD_0');
  }
  const positions = accessorReader(primitive.attributes.POSITION);
  const normals = accessorReader(primitive.attributes.NORMAL);
  const uvs = accessorReader(primitive.attributes.TEXCOORD_0);
  const indices = accessorReader(primitive.indices);
  const triangles = [];
  for (let offset = 0; offset < indices.accessor.count; offset += 3) {
    const vertexIndices = [indices.read(offset), indices.read(offset + 1), indices.read(offset + 2)];
    const centre = [0, 0, 0];
    const normal = [0, 0, 0];
    for (const vertex of vertexIndices) {
      for (let component = 0; component < 3; component++) {
        centre[component] += positions.read(vertex, component) / 3;
        normal[component] += normals.read(vertex, component) / 3;
      }
    }
    const facadeBand = normal[2] > 0.65
      && centre[2] > 0.32
      && Math.abs(centre[0]) < 0.46
      && centre[1] > -0.39
      && centre[1] < -0.22;
    const flankBand = Math.abs(normal[0]) > 0.68
      && Math.abs(centre[0]) > 0.40
      && Math.abs(centre[2]) < 0.34
      && centre[1] > -0.40
      && centre[1] < -0.26;
    const roofCommandSlab = normal[1] > 0.76
      && centre[1] > 0.12
      && Math.abs(centre[0]) < 0.17
      && centre[2] > -0.30
      && centre[2] < 0.24;
    if (!facadeBand && !flankBand && !roofCommandSlab) continue;
    triangles.push(vertexIndices.map((vertex) => [uvs.read(vertex, 0), uvs.read(vertex, 1)]));
  }
  console.log(`accent preset: ${preset} selected ${triangles.length} surface triangles`);
  return triangles;
}

const accentTriangles = buildAccentTriangles(accentPreset);

const imageUses = new Map();
const addUse = (textureInfo, use) => {
  if (!textureInfo) return;
  const texture = document.textures?.[textureInfo.index];
  if (!texture || texture.source === undefined) return;
  const uses = imageUses.get(texture.source) ?? new Set();
  uses.add(use);
  imageUses.set(texture.source, uses);
};
for (const material of document.materials ?? []) {
  addUse(material.pbrMetallicRoughness?.baseColorTexture, 'base');
  addUse(material.pbrMetallicRoughness?.metallicRoughnessTexture, 'metalRough');
  addUse(material.normalTexture, 'normal');
  addUse(material.occlusionTexture, 'occlusion');
  addUse(material.emissiveTexture, 'emissive');
}

const replacements = new Map();
for (let imageIndex = 0; imageIndex < (document.images?.length ?? 0); imageIndex++) {
  const image = document.images[imageIndex];
  if (image.bufferView === undefined) throw new Error('external GLB images are not supported');
  const view = document.bufferViews[image.bufferView];
  const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const uses = imageUses.get(imageIndex) ?? new Set();
  const target = uses.has('base')
    ? profile.base
    : uses.has('normal')
      ? profile.normal
      : uses.has('metalRough')
        ? profile.metalRough
        : profile.other;
  const metadata = await sharp(bytes).metadata();
  let workingBytes = bytes;
  if (uses.has('base')) workingBytes = await applyBasePalette(workingBytes, paletteName, accentTriangles);
  if (uses.has('base') && sealSwatch) {
    // Generated closure geometry uses TEXCOORD_0=(0,0). Meshy commonly leaves
    // the atlas corners white, turning an otherwise hidden turret-ring cap into
    // a bright plate. Reserve a tiny dark-olive swatch in every atlas corner so
    // closure faces remain unobtrusive through renderer and mip conventions.
    const swatchSize = Math.max(16, Math.min(64, Math.floor(Math.min(metadata.width, metadata.height) / 24)));
    const swatch = {
      create: {
        width: swatchSize,
        height: swatchSize,
        channels: 3,
        background: { r: 38, g: 44, b: 27 },
      },
    };
    workingBytes = await sharp(workingBytes).composite([
      { input: swatch, left: 0, top: 0 },
      { input: swatch, left: metadata.width - swatchSize, top: 0 },
      { input: swatch, left: 0, top: metadata.height - swatchSize },
      { input: swatch, left: metadata.width - swatchSize, top: metadata.height - swatchSize },
    ]).toBuffer();
  }
  let pipeline = sharp(workingBytes).resize({
    width: target,
    height: target,
    fit: 'inside',
    withoutEnlargement: true,
    kernel: sharp.kernel.lanczos3,
  });
  if (uses.has('base')) {
    pipeline = pipeline
      .modulate({ brightness: 1.03, saturation: 1.05 });
    if (surfaceProfile === 'soviet-family') {
      // Meshy occasionally delivers the right colour zones with only half the
      // family texture's value variation. Expand the authored separation around
      // its existing mid-dark mean and sharpen plate borders gently. This does
      // not classify pixels, repaint UVs, or synthesize surface noise.
      pipeline = pipeline.linear(1.35, -25).sharpen(0.8);
    }
  }
  const quality = uses.has('normal') ? 94 : uses.has('metalRough') ? 92 : 91;
  const encoded = await pipeline.jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer();
  replacements.set(image.bufferView, encoded);
  image.mimeType = 'image/jpeg';
  console.log(
    `${[...uses].join('+') || 'image'}: ${metadata.width}x${metadata.height} `
    + `${bytes.length} B -> <=${target}px ${encoded.length} B`,
  );
}

const orderedViews = document.bufferViews
  .map((view, index) => ({ view, index, oldOffset: view.byteOffset ?? 0 }))
  .sort((a, b) => a.oldOffset - b.oldOffset);
const chunks = [];
let cursor = 0;
for (const { view, index, oldOffset } of orderedViews) {
  const data = replacements.get(index)
    ?? binary.subarray(oldOffset, oldOffset + view.byteLength);
  view.byteOffset = cursor;
  view.byteLength = data.length;
  chunks.push(data);
  cursor += data.length;
  const padding = (4 - (cursor & 3)) & 3;
  if (padding > 0) {
    chunks.push(Buffer.alloc(padding));
    cursor += padding;
  }
}

const outputBinary = Buffer.concat(chunks, cursor);
document.buffers[0].byteLength = outputBinary.length;
let outputJson = Buffer.from(JSON.stringify(document), 'utf8');
const jsonPadding = (4 - (outputJson.length & 3)) & 3;
if (jsonPadding > 0) outputJson = Buffer.concat([outputJson, Buffer.alloc(jsonPadding, 0x20)]);

const totalLength = 12 + 8 + outputJson.length + 8 + outputBinary.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(outputJson.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const outputBinHeader = Buffer.alloc(8);
outputBinHeader.writeUInt32LE(outputBinary.length, 0);
outputBinHeader.writeUInt32LE(0x004e4942, 4);

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, Buffer.concat([
  header, jsonHeader, outputJson, outputBinHeader, outputBinary,
]));
console.log(`${input} -> ${output} (${source.length} B -> ${totalLength} B)`);
console.log(`texture profile: ${profileName}`);
console.log(`texture palette: ${paletteName}`);
console.log(`texture accents: ${accentPreset}`);
console.log(`surface profile: ${surfaceProfile}`);
console.log(`seal swatch: ${sealSwatch}`);

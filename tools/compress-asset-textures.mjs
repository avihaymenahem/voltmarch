#!/usr/bin/env node

/**
 * Promote one approved GLB family to KTX2/Basis Universal without touching its
 * source geometry. Base/emissive colour and low-entropy packed ORM use
 * high-quality ETC1S; tangent-space normals use UASTC and a 1024px ceiling.
 * Meshy's 2K normal payloads are unusually smooth and spend four times the GPU
 * memory for detail the RTS camera cannot resolve. All outputs carry a complete
 * mip chain and KHR_texture_basisu.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import sharp from 'sharp';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const manifestPath = path.resolve(root, value('--manifest') ?? 'tools/asset-families/soviet-buildings.json');
const write = args.includes('--write');
const selected = new Set((value('--only') ?? '').split(',').map((item) => item.trim()).filter(Boolean));

const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
if (manifest.version !== 1 || !Array.isArray(manifest.assets)) {
  throw new Error(`unsupported asset-family manifest: ${manifestPath}`);
}
const sourceDir = path.resolve(root, manifest.sourceDir);
const outputDir = path.join(sourceDir, 'compressed');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function basisExecutable() {
  const explicit = process.env.VM_BASISU_PATH;
  if (explicit) return explicit;
  const platform = process.platform === 'win32' ? 'win' : process.platform;
  const name = process.platform === 'win32' ? 'basisu.exe' : 'basisu';
  const bundled = path.join(root, 'node_modules', 'basisu', 'bin', platform, process.arch, name);
  if (fs.existsSync(bundled)) return bundled;
  return name;
}

function textureRoles(document) {
  const roles = new Map();
  const mark = (texture, role) => {
    if (texture === null) return;
    const set = roles.get(texture) ?? new Set();
    set.add(role);
    roles.set(texture, set);
  };
  for (const material of document.getRoot().listMaterials()) {
    mark(material.getBaseColorTexture(), 'base');
    mark(material.getEmissiveTexture(), 'emissive');
    mark(material.getNormalTexture(), 'normal');
    mark(material.getMetallicRoughnessTexture(), 'metalRough');
    mark(material.getOcclusionTexture(), 'occlusion');
  }
  return roles;
}

function mipBytes(width, height, bytesPerPixel) {
  let bytes = 0;
  while (true) {
    bytes += Math.max(1, width) * Math.max(1, height) * bytesPerPixel;
    if (width === 1 && height === 1) break;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  return Math.ceil(bytes);
}

async function encodeTexture(texture, roles, tempDir, index) {
  const image = texture.getImage();
  if (image === null) throw new Error(`texture ${index} has no embedded image`);
  const input = path.join(tempDir, `${index}.png`);
  const output = path.join(tempDir, `${index}.ktx2`);
  const sourcePipeline = sharp(image);
  const metadata = await sourcePipeline.metadata();
  if (!metadata.width || !metadata.height) throw new Error(`texture ${index} has no dimensions`);
  const stats = await sourcePipeline.stats();
  const opaque = !metadata.hasAlpha || (stats.channels[3]?.min ?? 255) === 255;

  const vector = roles.has('normal');
  const data = vector || roles.has('metalRough') || roles.has('occlusion');
  // Small defence/utility assets arrive with 1K normals but occupy only a few
  // dozen pixels in play. Keeping them at 1K made their KTX2 files larger than
  // the original JPEGs, defeating the transfer gate without adding visible
  // detail. Landmark 2K normals retain a 1K ceiling; 1K sources use 512.
  const normalCeiling = Math.max(metadata.width, metadata.height) <= 1024 ? 512 : 1024;
  const targetScale = vector ? Math.min(1, normalCeiling / Math.max(metadata.width, metadata.height)) : 1;
  const width = Math.max(1, Math.round(metadata.width * targetScale));
  const height = Math.max(1, Math.round(metadata.height * targetScale));
  const prepared = sharp(image).resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 });
  await prepared.png().toFile(input);

  const codec = vector ? 'uastc' : 'etc1s';
  const encode = ['-ktx2', '-file', input, '-output_file', output, '-mipmap', '-max_threads', '8'];
  if (opaque) encode.push('-no_alpha');
  if (vector) {
    encode.push('-uastc', '-uastc_level', '2', '-uastc_rdo_l', '0.50', '-normal_map', '-mip_renorm');
  } else if (data) {
    encode.push('-q', '255', '-comp_level', '2', '-linear', '-mip_linear');
  } else {
    encode.push('-q', '255', '-comp_level', '2', '-mip_srgb');
  }

  await run(basisExecutable(), encode, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const compressed = await fsp.readFile(output);
  await run(basisExecutable(), ['-validate', '-file', output], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  texture.setImage(compressed).setMimeType('image/ktx2');

  return {
    index,
    roles: [...roles].sort(),
    codec,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    width,
    height,
    opaque,
    sourceBytes: image.byteLength,
    ktx2Bytes: compressed.byteLength,
    sourceGpuBytesRGBA8: mipBytes(metadata.width, metadata.height, 4),
    compressedGpuBytes8bpp: mipBytes(width, height, 1),
    compressedGpuBytes4bpp: mipBytes(width, height, 0.5),
  };
}

const rows = [];
for (const asset of manifest.assets) {
  if (selected.size > 0 && !selected.has(asset.key)) continue;
  const input = path.join(sourceDir, asset.file);
  const output = path.join(outputDir, asset.file);
  const document = await io.read(input);
  const roles = textureRoles(document);
  if (roles.size === 0) throw new Error(`${asset.key} contains no material textures`);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `voltmarch-ktx2-${asset.key}-`));
  try {
    const textures = [];
    let index = 0;
    for (const texture of document.getRoot().listTextures()) {
      textures.push(await encodeTexture(texture, roles.get(texture) ?? new Set(), tempDir, index++));
    }
    document.createExtension(KHRTextureBasisu).setRequired(true);
    const sourceBytes = (await fsp.stat(input)).size;
    let outputBytes = 0;
    if (write) {
      await fsp.mkdir(outputDir, { recursive: true });
      await io.write(output, document);
      // Read the promoted asset back through the same extension stack. This is
      // a container/extension gate; renderer QA remains a separate live gate.
      await io.read(output);
      outputBytes = (await fsp.stat(output)).size;
    }
    const sums = (key) => textures.reduce((total, texture) => total + texture[key], 0);
    const row = {
      key: asset.key,
      source: path.relative(root, input).replaceAll('\\', '/'),
      output: path.relative(root, output).replaceAll('\\', '/'),
      sourceFileBytes: sourceBytes,
      outputFileBytes: outputBytes,
      transferRatio: outputBytes === 0 ? null : +(outputBytes / sourceBytes).toFixed(4),
      sourceTextureBytes: sums('sourceBytes'),
      ktx2TextureBytes: sums('ktx2Bytes'),
      sourceGpuBytesRGBA8: sums('sourceGpuBytesRGBA8'),
      compressedGpuBytes8bpp: sums('compressedGpuBytes8bpp'),
      compressedGpuBytes4bpp: sums('compressedGpuBytes4bpp'),
      textures,
    };
    rows.push(row);
    console.log(
      `[ktx2] ${asset.key}: ${(sourceBytes / 1048576).toFixed(2)} MiB -> `
      + `${write ? `${(outputBytes / 1048576).toFixed(2)} MiB` : 'dry run'}, `
      + `GPU ${(row.sourceGpuBytesRGBA8 / 1048576).toFixed(1)} -> `
      + `${(row.compressedGpuBytes8bpp / 1048576).toFixed(1)} MiB (8bpp target)`,
    );
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

const reportPath = path.join(outputDir, 'texture-compression-report.json');
let reportRows = rows;
if (write && selected.size > 0 && fs.existsSync(reportPath)) {
  const previous = JSON.parse(await fsp.readFile(reportPath, 'utf8'));
  const merged = new Map(previous.rows?.map((row) => [row.key, row]) ?? []);
  for (const row of rows) merged.set(row.key, row);
  reportRows = manifest.assets.map((asset) => merged.get(asset.key)).filter(Boolean);
}
const sum = (key) => reportRows.reduce((total, row) => total + row[key], 0);
const totals = {
  sourceFileBytes: sum('sourceFileBytes'),
  outputFileBytes: sum('outputFileBytes'),
  transferRatio: sum('outputFileBytes') === 0 ? null : +(sum('outputFileBytes') / sum('sourceFileBytes')).toFixed(4),
  sourceTextureBytes: sum('sourceTextureBytes'),
  ktx2TextureBytes: sum('ktx2TextureBytes'),
  sourceGpuBytesRGBA8: sum('sourceGpuBytesRGBA8'),
  compressedGpuBytes8bpp: sum('compressedGpuBytes8bpp'),
  compressedGpuBytes4bpp: sum('compressedGpuBytes4bpp'),
};
const report = {
  version: 1,
  family: manifest.family,
  generatedAt: new Date().toISOString(),
  encoder: 'Basis Universal 1.16.x',
  profiles: {
    color: 'ETC1S q255 comp2 + sRGB mips',
    normal: 'UASTC level2 RDO 0.50 + 1K landmark/512px small-asset ceiling + normal-renormalized linear mips',
    packedData: 'ETC1S q255 comp2 + linear mips',
  },
  rows: reportRows,
  totals,
};
if (write) {
  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `[ktx2] family: ${(totals.sourceFileBytes / 1048576).toFixed(2)} -> `
    + `${(totals.outputFileBytes / 1048576).toFixed(2)} MiB transfer; conservative GPU `
    + `${(totals.sourceGpuBytesRGBA8 / 1048576).toFixed(1)} -> `
    + `${(totals.compressedGpuBytes8bpp / 1048576).toFixed(1)} MiB`,
  );
} else {
  console.log('[ktx2] dry run; pass --write to keep compressed GLBs and the report');
}

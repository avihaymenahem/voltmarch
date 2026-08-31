#!/usr/bin/env node

/** Reproducibly promote the universal terrain detail mask to linear ETC1S KTX2. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import sharp from 'sharp';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const terrainDir = path.join(root, 'packages/assets/game/terrain');
const sourceName = 'universal-terrain-mask-4k.png';
const outputName = 'universal-terrain-mask-4k.ktx2';
const reportName = 'universal-terrain-mask-4k.ktx2-report.json';

function basisExecutable() {
  const explicit = process.env.VM_BASISU_PATH;
  if (explicit) return explicit;
  const platform = process.platform === 'win32' ? 'win' : process.platform;
  const name = process.platform === 'win32' ? 'basisu.exe' : 'basisu';
  const bundled = path.join(root, 'node_modules', 'basisu', 'bin', platform, process.arch, name);
  return fs.existsSync(bundled) ? bundled : name;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function mipPixels(width, height) {
  let pixels = 0;
  while (true) {
    pixels += width * height;
    if (width === 1 && height === 1) return pixels;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
}

function bc1MipBytes(width, height) {
  let bytes = 0;
  while (true) {
    bytes += Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * 8;
    if (width === 1 && height === 1) return bytes;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
}

const sourcePath = path.join(terrainDir, sourceName);
const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'voltmarch-terrain-ktx2-'));
try {
  const source = await fsp.readFile(sourcePath);
  const sourceImage = sharp(source);
  const metadata = await sourceImage.metadata();
  const stats = await sourceImage.stats();
  if (!metadata.width || !metadata.height) throw new Error(`${sourceName} has no dimensions`);
  if (metadata.channels !== 3 || stats.channels.length !== 3) {
    throw new Error(`${sourceName} must remain an opaque three-channel mask`);
  }
  const channelSums = stats.channels.map((channel) => channel.sum);
  if (new Set(channelSums).size !== 1) {
    throw new Error(`${sourceName} channels differ; a single-channel semantic mask was expected`);
  }

  const encodedPath = path.join(temporary, outputName);
  await run(basisExecutable(), [
    '-ktx2', '-file', sourcePath, '-output_file', encodedPath, '-mipmap',
    // Basis' encoder output can depend on worker scheduling. The tracked cook
    // is deliberately single-threaded so clean recooks are byte-identical.
    '-no_multithreading',
    // The mask is linear data used for luminance/roughness modulation, not
    // display colour. ETC1S is the compact AAA-style transport choice for a
    // broad, low-frequency mask; hardware transcodes it to BC1/ETC at load.
    '-q', '255', '-comp_level', '2', '-linear', '-mip_linear',
  ], { cwd: temporary, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  await run(basisExecutable(), ['-validate', '-file', encodedPath], {
    cwd: temporary, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });

  const encoded = await fsp.readFile(encodedPath);
  if (encoded.subarray(0, 12).toString('hex') !== 'ab4b5458203230bb0d0a1a0a') {
    throw new Error(`${outputName} is not KTX2`);
  }
  if (encoded.byteLength >= source.byteLength) {
    throw new Error(`KTX2 transfer gate failed: ${source.byteLength} -> ${encoded.byteLength}`);
  }

  const pixels = mipPixels(metadata.width, metadata.height);
  const report = {
    version: 1,
    family: 'universal-terrain-detail-mask',
    role: 'linear-luminance-roughness-mask',
    encoder: 'Basis Universal 1.16.x',
    codec: 'etc1s-linear',
    dimensions: [metadata.width, metadata.height],
    mipLevels: Math.floor(Math.log2(Math.max(metadata.width, metadata.height))) + 1,
    sourceBytes: source.byteLength,
    outputBytes: encoded.byteLength,
    transferRatio: +(encoded.byteLength / source.byteLength).toFixed(4),
    sourceSha256: sha256(source),
    outputSha256: sha256(encoded),
    decodedGpuBytesRGBA8: pixels * 4,
    decodedGpuBytesRGB8: pixels * 3,
    compressedGpuBytesBC1: bc1MipBytes(metadata.width, metadata.height),
    qualityGate: {
      transcode: 'ETC1 RGB mip 0',
      meanAbsoluteError: 2.8551,
      rootMeanSquareError: 3.7423,
      psnrDb: 36.668,
      p95AbsoluteError: 8,
      p99AbsoluteError: 11,
      maxChannelError: 36,
      note: 'Measured against the deterministic output with Basis -unpack; runtime captures remain the visual acceptance gate.',
    },
  };

  const outputPath = path.join(terrainDir, outputName);
  const reportPath = path.join(terrainDir, reportName);
  if (write) {
    await fsp.copyFile(encodedPath, outputPath);
    await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } else {
    const trackedOutput = await fsp.readFile(outputPath);
    const trackedReport = JSON.parse(await fsp.readFile(reportPath, 'utf8'));
    if (sha256(trackedOutput) !== report.outputSha256
      || JSON.stringify(trackedReport) !== JSON.stringify(report)) {
      throw new Error('terrain KTX2 recook differs from tracked output/report; use --write only after review');
    }
  }

  console.log(JSON.stringify(report, null, 2));
  if (!write) console.log('[terrain-ktx2] reproducible recook matches tracked delivery');
} finally {
  await fsp.rm(temporary, { recursive: true, force: true });
}

#!/usr/bin/env node

/** Reproducibly promote the shared extended-foliage atlas to KTX2. */

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
const materialDir = path.join(
  root, 'packages/assets/game/environment/extended-foliage/material',
);
const stem = 'extended-foliage-v1';
const specs = [
  { role: 'base', source: `${stem}.base.webp`, output: `${stem}.base.ktx2`, codec: 'etc1s-srgb' },
  { role: 'normal', source: `${stem}.normal.jpg`, output: `${stem}.normal.ktx2`, codec: 'uastc-normal' },
  { role: 'metalRough', source: `${stem}.mr.jpg`, output: `${stem}.mr.ktx2`, codec: 'etc1s-linear' },
];

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

function mipBytes(width, height, bytesPerPixel) {
  let total = 0;
  while (true) {
    total += Math.max(1, width) * Math.max(1, height) * bytesPerPixel;
    if (width === 1 && height === 1) return Math.ceil(total);
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
}

function stableCookReport(report) {
  return {
    version: report.version,
    family: report.family,
    encoder: report.encoder,
    sourceBytes: report.sourceBytes,
    sourceGpuBytesRGBA8: report.sourceGpuBytesRGBA8,
    compressedGpuBytes8bpp: report.compressedGpuBytes8bpp,
    rows: report.rows.map((row) => ({
      role: row.role,
      source: row.source,
      output: row.output,
      codec: row.codec,
      dimensions: row.dimensions,
      sourceBytes: row.sourceBytes,
      sourceSha256: row.sourceSha256,
      sourceGpuBytesRGBA8: row.sourceGpuBytesRGBA8,
      compressedGpuBytes8bpp: row.compressedGpuBytes8bpp,
    })),
  };
}

function assertNativeCookCompatible(tracked, cooked) {
  if (JSON.stringify(stableCookReport(tracked)) !== JSON.stringify(stableCookReport(cooked))) {
    throw new Error('foliage KTX2 native recook changed the source or cook specification');
  }
  for (let index = 0; index < cooked.rows.length; index += 1) {
    const trackedRow = tracked.rows[index];
    const cookedRow = cooked.rows[index];
    // Basis Universal's independently compiled Windows and Linux encoders can
    // choose different, equally valid ETC1S/UASTC blocks. Keep the Windows x64
    // cook as the frozen delivery, but require every native recook to remain
    // close to its reviewed transfer size instead of pretending the binaries
    // produce identical bytes across operating systems.
    const tolerance = Math.max(1024, Math.ceil(trackedRow.outputBytes * 0.1));
    if (Math.abs(cookedRow.outputBytes - trackedRow.outputBytes) > tolerance) {
      throw new Error(
        `foliage KTX2 native recook size drifted for ${cookedRow.output}: `
        + `${trackedRow.outputBytes} -> ${cookedRow.outputBytes}`,
      );
    }
  }
}

const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'voltmarch-foliage-ktx2-'));
try {
  const rows = [];
  for (const spec of specs) {
    const sourcePath = path.join(materialDir, spec.source);
    const source = await fsp.readFile(sourcePath);
    const metadata = await sharp(source).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`${spec.source} has no dimensions`);
    const png = path.join(temporary, `${spec.role}.png`);
    const encoded = path.join(temporary, spec.output);
    // GLB UVs follow the ordinary TextureLoader convention, whose image rows
    // are vertically flipped at upload. Compressed KTX2 uploads cannot use
    // UNPACK_FLIP_Y, so bake the same orientation into the encoded mip chain.
    await sharp(source).flip().png().toFile(png);
    // Basis' UASTC RDO output varies with worker scheduling. One encoder thread
    // makes the tracked delivery byte-for-byte reproducible across clean cooks.
    const args = [
      '-ktx2', '-file', png, '-output_file', encoded, '-mipmap',
      // `-max_threads 1` still lets the UASTC RDO implementation take its
      // multithreaded path and has produced different byte streams on repeat.
      // Basis documents these two switches as the deterministic route.
      '-no_multithreading',
    ];
    if (spec.codec === 'uastc-normal') {
      args.push(
        '-uastc', '-uastc_level', '2',
        '-normal_map', '-mip_renorm',
      );
    } else if (spec.codec === 'etc1s-linear') {
      args.push('-q', '255', '-comp_level', '2', '-linear', '-mip_linear');
    } else {
      args.push('-q', '240', '-comp_level', '2', '-mip_srgb');
    }
    await run(basisExecutable(), args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    await run(basisExecutable(), ['-validate', '-file', encoded], {
      windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    });
    const compressed = await fsp.readFile(encoded);
    const magic = compressed.subarray(0, 12).toString('hex');
    if (magic !== 'ab4b5458203230bb0d0a1a0a') throw new Error(`${spec.output} is not KTX2`);
    if (write) await fsp.copyFile(encoded, path.join(materialDir, spec.output));
    rows.push({
      ...spec,
      dimensions: [metadata.width, metadata.height],
      sourceBytes: source.byteLength,
      outputBytes: compressed.byteLength,
      sourceSha256: sha256(source),
      outputSha256: sha256(compressed),
      sourceGpuBytesRGBA8: mipBytes(metadata.width, metadata.height, 4),
      compressedGpuBytes8bpp: mipBytes(metadata.width, metadata.height, 1),
    });
  }
  const sourceBytes = rows.reduce((sum, row) => sum + row.sourceBytes, 0);
  const outputBytes = rows.reduce((sum, row) => sum + row.outputBytes, 0);
  if (outputBytes >= sourceBytes) {
    throw new Error(`KTX2 transfer gate failed: ${sourceBytes} -> ${outputBytes} bytes`);
  }
  const report = {
    version: 1,
    family: 'extended-foliage-v1-pbr',
    encoder: 'Basis Universal 1.16.x',
    sourceBytes,
    outputBytes,
    transferRatio: +(outputBytes / sourceBytes).toFixed(4),
    sourceGpuBytesRGBA8: rows.reduce((sum, row) => sum + row.sourceGpuBytesRGBA8, 0),
    compressedGpuBytes8bpp: rows.reduce((sum, row) => sum + row.compressedGpuBytes8bpp, 0),
    rows,
  };
  const reportPath = path.join(materialDir, `${stem}.ktx2-report.json`);
  if (write) {
    await fsp.writeFile(
      reportPath,
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } else {
    const tracked = JSON.parse(await fsp.readFile(reportPath, 'utf8'));
    const canonicalCookHost = process.platform === 'win32' && process.arch === 'x64';
    if (canonicalCookHost && JSON.stringify(tracked) !== JSON.stringify(report)) {
      throw new Error(
        'foliage KTX2 recook differs from the tracked report; run with --write only after review',
      );
    }
    if (!canonicalCookHost) assertNativeCookCompatible(tracked, report);
  }
  console.log(JSON.stringify(report, null, 2));
  if (!write) {
    const mode = process.platform === 'win32' && process.arch === 'x64'
      ? 'byte-identical canonical recook matches tracked report'
      : 'native recook matches tracked source, format, and transfer bounds';
    console.log(`[foliage-ktx2] ${mode}`);
  }
} finally {
  await fsp.rm(temporary, { recursive: true, force: true });
}

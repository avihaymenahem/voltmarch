#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const inputArg = value('--input');
const outputArg = value('--output');
const profile = value('--profile') ?? 'building';
const palette = value('--palette') ?? 'none';
const accentPreset = value('--accent-preset') ?? 'none';
const ratio = Number(value('--ratio') ?? '0.60');
const error = Number(value('--error') ?? '0.003');
const staticMerge = args.includes('--static-merge');
const profiles = new Set(['building', 'vehicle', 'hero', 'infantry', 'troop', 'defence', 'foliage']);

if (!inputArg || !outputArg || !profiles.has(profile) || !(ratio > 0 && ratio <= 1) || !(error >= 0)) {
  throw new Error(
    'usage: npm run asset:prepare -- --input <raw.glb> --output <shipping.glb> '
    + '[--profile building|vehicle|hero|infantry|troop|defence|foliage] [--ratio 0.60] '
    + '[--error 0.003] [--palette none|soviet-field] '
    + '[--accent-preset none|soviet-conyard] [--static-merge]',
  );
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
if (!fs.existsSync(input)) throw new Error(`input does not exist: ${input}`);
if (input === output) throw new Error('input and output must be different; preserve the raw Meshy file');
if (path.extname(input).toLowerCase() !== '.glb' || path.extname(output).toLowerCase() !== '.glb') {
  throw new Error('input and output must be .glb files');
}

const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'voltmarch-meshy-'));
const geometry = path.join(temporary, 'geometry.glb');
const bundledNpxCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const npxCommand = process.platform === 'win32' && fs.existsSync(bundledNpxCli)
  ? process.execPath
  : 'npx';
const npxPrefix = npxCommand === process.execPath ? [bundledNpxCli] : [];
const optimizeArgs = [
  '--yes', '@gltf-transform/cli@4.4.2', 'optimize', input, geometry,
  '--compress', 'false',
  '--texture-compress', 'false',
  '--palette', 'false',
  '--instance', 'false',
  '--flatten', String(staticMerge),
  '--join', String(staticMerge),
  '--simplify', 'true',
  '--simplify-ratio', String(ratio),
  '--simplify-error', String(error),
  '--simplify-lock-border', 'false',
  '--weld', 'true',
  '--prune', 'true',
];

try {
  await fsp.mkdir(path.dirname(output), { recursive: true });
  console.log(`[asset] geometry optimization: ratio=${ratio} error=${error} staticMerge=${staticMerge}`);
  execFileSync(npxCommand, [...npxPrefix, ...optimizeArgs], { cwd: root, stdio: 'inherit' });
  console.log(`[asset] texture profile: ${profile}`);
  execFileSync(process.execPath, [
    path.join(root, 'tools', 'resize-glb-textures.mjs'), geometry, output, '--profile', profile,
    '--palette', palette, '--accent-preset', accentPreset,
  ], { cwd: root, stdio: 'inherit' });
  console.log('[asset] shipping audit');
  execFileSync(process.execPath, [path.join(root, 'tools', 'audit-glb.mjs'), output], {
    cwd: root,
    stdio: 'inherit',
  });
} finally {
  const resolvedTemporary = path.resolve(temporary);
  const resolvedRoot = path.resolve(os.tmpdir());
  if (!resolvedTemporary.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`refusing to remove unexpected temporary path: ${resolvedTemporary}`);
  }
  await fsp.rm(resolvedTemporary, { recursive: true, force: true });
}

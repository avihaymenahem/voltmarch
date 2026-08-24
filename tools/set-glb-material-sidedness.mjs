#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [inputArg, outputArg, mode = 'single'] = process.argv.slice(2);
if (!inputArg || !outputArg || !new Set(['single', 'double']).has(mode)) {
  throw new Error('usage: node tools/set-glb-material-sidedness.mjs <input.glb> <output.glb> [single|double]');
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
if (!fs.existsSync(input)) throw new Error(`input does not exist: ${input}`);
if (input === output) throw new Error('input and output must differ');

async function locatePackage(packageName) {
  const npxRoot = path.join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx');
  for (const entry of await fsp.readdir(npxRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = path.join(npxRoot, entry.name, 'node_modules', ...packageName.split('/'));
    if (fs.existsSync(path.join(packageRoot, 'package.json'))) return packageRoot;
  }
  throw new Error(`${packageName} was not found in the npx cache; run asset:prepare first`);
}

const coreRoot = await locatePackage('@gltf-transform/core');
const { NodeIO } = await import(pathToFileURL(path.join(coreRoot, 'dist', 'index.js')));
const io = new NodeIO();
const document = await io.read(input);
for (const material of document.getRoot().listMaterials()) material.setDoubleSided(mode === 'double');
await fsp.mkdir(path.dirname(output), { recursive: true });
await io.write(output, document);
console.log(JSON.stringify({ input, output, doubleSided: mode === 'double' }));

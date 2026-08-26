#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const [inputArg, outputArg, ...flags] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  throw new Error(
    'usage: node tools/condition-glb-materials.mjs <input.glb> <output.glb> '
    + '[--single-sided] [--drop-emissive]',
  );
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
if (!fs.existsSync(input)) throw new Error(`input does not exist: ${input}`);
if (input === output) throw new Error('input and output must differ');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);
for (const material of document.getRoot().listMaterials()) {
  if (flags.includes('--single-sided')) material.setDoubleSided(false);
  if (flags.includes('--drop-emissive')) {
    material.setEmissiveTexture(null);
    material.setEmissiveFactor([0, 0, 0]);
  }
}

// Disconnected textures and image payloads are only removed after every
// material has been updated, keeping the operation deterministic and safe for
// shared texture references.
await document.transform(prune());
await fsp.mkdir(path.dirname(output), { recursive: true });
await io.write(output, document);

console.log(JSON.stringify({
  input,
  output,
  singleSided: flags.includes('--single-sided'),
  emissiveDropped: flags.includes('--drop-emissive'),
}));

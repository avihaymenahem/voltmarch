#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [inputArg, outputArg, name = 'Hull'] = process.argv.slice(2);
if (!inputArg || !outputArg || !name.trim()) {
  throw new Error('usage: node tools/rename-glb-single-mesh.mjs <input.glb> <output.glb> [name]');
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
if (input === output) throw new Error('input and output must differ');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);
const meshes = document.getRoot().listMeshes();
if (meshes.length !== 1) {
  throw new Error(`expected exactly one mesh, received ${meshes.length}`);
}

meshes[0].setName(name);
for (const node of document.getRoot().listNodes()) {
  if (node.getMesh() === meshes[0]) node.setName(name);
}

await fs.mkdir(path.dirname(output), { recursive: true });
await io.write(output, document);
console.log(`${input} -> ${output} (${name})`);

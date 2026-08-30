#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import { NodeIO } from '@gltf-transform/core';

const [input, outputDir] = process.argv.slice(2);
if (input === undefined || outputDir === undefined) {
  throw new Error('usage: node tools/extract-glb-textures.mjs <model.glb> <output-dir>');
}

const document = await new NodeIO().read(path.resolve(input));
await fs.mkdir(path.resolve(outputDir), { recursive: true });

const roles = [
  ['base', (material) => material.getBaseColorTexture()],
  ['normal', (material) => material.getNormalTexture()],
  ['metal-rough', (material) => material.getMetallicRoughnessTexture()],
];
const written = [];
for (const material of document.getRoot().listMaterials()) {
  for (const [role, getTexture] of roles) {
    const texture = getTexture(material);
    const image = texture?.getImage();
    if (texture === null || texture === undefined || image === null) continue;
    const extension = texture.getMimeType() === 'image/jpeg' ? 'jpg' : 'png';
    const file = path.resolve(outputDir, `${role}.${extension}`);
    if (!written.includes(file)) {
      await fs.writeFile(file, image);
      written.push(file);
    }
  }
}

console.log(JSON.stringify({ input: path.resolve(input), written }, null, 2));

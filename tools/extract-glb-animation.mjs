#!/usr/bin/env node

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('usage: node tools/extract-glb-animation.mjs <animated.glb> <animation-only.glb>');
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(inputPath);
const root = document.getRoot();
if (root.listAnimations().length < 1) throw new Error(`${inputPath} contains no animation clips.`);

for (const node of root.listNodes()) {
  node.setMesh(null);
  node.setSkin(null);
}
for (const mesh of root.listMeshes()) mesh.dispose();
for (const skin of root.listSkins()) skin.dispose();

await document.transform(prune({ keepLeaves: false }));
await io.write(outputPath, document);

const validation = await io.read(outputPath);
const result = validation.getRoot();
if (result.listAnimations().length < 1 || result.listMeshes().length !== 0) {
  throw new Error(
    `Animation extraction failed: ${result.listAnimations().length} clips, `
    + `${result.listMeshes().length} meshes.`,
  );
}
console.log(JSON.stringify({
  input: inputPath,
  output: outputPath,
  animations: result.listAnimations().map((animation) => animation.getName()),
  nodes: result.listNodes().length,
  meshes: result.listMeshes().length,
}));

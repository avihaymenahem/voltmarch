#!/usr/bin/env node

import path from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const file = process.argv[2];
if (file === undefined) throw new Error('usage: node tools/audit-rigged-commander.mjs <model.glb>');

const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path.resolve(file));
const root = document.getRoot();
let triangles = 0;
let skinnedPrimitives = 0;
let weightedVertices = 0;
let invalidWeights = 0;
let maxJoint = -1;
for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    const joints = primitive.getAttribute('JOINTS_0');
    const weights = primitive.getAttribute('WEIGHTS_0');
    triangles += (primitive.getIndices()?.getCount() ?? position?.getCount() ?? 0) / 3;
    if (position === null || joints === null || weights === null) continue;
    skinnedPrimitives++;
    weightedVertices += position.getCount();
    const joint = new Array(4);
    const weight = new Array(4);
    for (let i = 0; i < position.getCount(); i++) {
      joints.getElement(i, joint);
      weights.getElement(i, weight);
      let sum = 0;
      for (let component = 0; component < 4; component++) {
        maxJoint = Math.max(maxJoint, joint[component]);
        sum += weight[component];
      }
      if (!Number.isFinite(sum) || Math.abs(sum - 1) > 0.01) invalidWeights++;
    }
  }
}

const skins = root.listSkins().map((skin) => ({
  name: skin.getName(),
  joints: skin.listJoints().length,
  skeleton: skin.getSkeleton()?.getName() ?? null,
}));
const animations = root.listAnimations().map((animation) => ({
  name: animation.getName(),
  channels: animation.listChannels().length,
  samplers: animation.listSamplers().length,
}));
const report = {
  file: path.resolve(file),
  triangles: Math.round(triangles),
  meshes: root.listMeshes().length,
  skins,
  animations,
  skinnedPrimitives,
  weightedVertices,
  invalidWeights,
  maxJoint,
};
if (triangles > 50000) throw new Error(`${file}: ${triangles} triangles exceeds 50,000`);
if (skins.length !== 1 || skinnedPrimitives !== 1 || invalidWeights !== 0) {
  throw new Error(`${file}: invalid humanoid skin ${JSON.stringify(report)}`);
}
if (maxJoint >= skins[0].joints) throw new Error(`${file}: joint index ${maxJoint} exceeds skin`);
console.log(JSON.stringify(report, null, 2));

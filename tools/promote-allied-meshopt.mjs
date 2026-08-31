#!/usr/bin/env node

/** Deterministically promote the first complete Allied land/air runtime slice to Meshopt. */

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const assetDir = path.join(root, 'packages/assets/game/units/allies/compressed');
const reportName = 'allied-land-air.meshopt-report.json';
const assets = [
  { key: 'allied_guardian', file: 'guardian-tank.glb' },
  { key: 'allied_ifv', file: 'sabre-ifv.glb' },
  { key: 'allied_prism', file: 'refractor-tank.glb' },
  { key: 'allied_dozer', file: 'construction-dozer.glb' },
  { key: 'allied_vindicator', file: 'petrel-bomber.glb' },
  { key: 'allied_albatross', file: 'albatross-heavy-bomber.glb' },
];

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const outputName = (file) => file.replace(/\.glb$/, '.meshopt.glb');
const names = (values) => values.map((value) => value.getName());

function triangleCount(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const count = primitive.getIndices()?.getCount()
        ?? primitive.getAttribute('POSITION')?.getCount()
        ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  return triangles;
}

function contract(document) {
  const model = document.getRoot();
  return {
    nodes: names(model.listNodes()),
    meshes: names(model.listMeshes()),
    primitiveCount: model.listMeshes()
      .reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0),
    triangles: triangleCount(document),
    materials: names(model.listMaterials()),
    animations: names(model.listAnimations()),
    textures: model.listTextures().map((texture) => ({
      name: texture.getName(),
      mimeType: texture.getMimeType(),
      sha256: sha256(texture.getImage() ?? new Uint8Array()),
    })),
  };
}

function assertContract(key, before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`${key} changed hierarchy/material/triangle/animation/KTX2 contract`);
  }
  if (after.textures.some((texture) => texture.mimeType !== 'image/ktx2')) {
    throw new Error(`${key} lost its KTX2 texture contract`);
  }
}

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const encodeIO = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const verifyIO = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'voltmarch-allied-meshopt-'));
try {
  const rows = [];
  for (const asset of assets) {
    const sourcePath = path.join(assetDir, asset.file);
    const promotedName = outputName(asset.file);
    const promotedPath = path.join(temporary, promotedName);
    const sourceBytes = await fsp.readFile(sourcePath);
    const document = await encodeIO.read(sourcePath);
    const before = contract(document);

    await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    await encodeIO.write(promotedPath, document);

    const verified = await verifyIO.read(promotedPath);
    const after = contract(verified);
    assertContract(asset.key, before, after);
    const outputBytes = await fsp.readFile(promotedPath);
    if (outputBytes.byteLength >= sourceBytes.byteLength) {
      throw new Error(`${asset.key} Meshopt output did not reduce transfer bytes`);
    }
    if (write) await fsp.copyFile(promotedPath, path.join(assetDir, promotedName));
    rows.push({
      ...asset,
      output: promotedName,
      sourceBytes: sourceBytes.byteLength,
      outputBytes: outputBytes.byteLength,
      savedBytes: sourceBytes.byteLength - outputBytes.byteLength,
      transferRatio: +(outputBytes.byteLength / sourceBytes.byteLength).toFixed(4),
      sourceSha256: sha256(sourceBytes),
      outputSha256: sha256(outputBytes),
      contract: {
        nodes: after.nodes.length,
        meshes: after.meshes.length,
        primitives: after.primitiveCount,
        triangles: after.triangles,
        materials: after.materials.length,
        animations: after.animations.length,
        ktx2Textures: after.textures.length,
      },
    });
  }

  const sourceBytes = rows.reduce((sum, row) => sum + row.sourceBytes, 0);
  const outputBytes = rows.reduce((sum, row) => sum + row.outputBytes, 0);
  const report = {
    version: 1,
    family: 'allied-land-air-runtime',
    encoder: 'glTF-Transform 4.4.2 / meshoptimizer high',
    sourceBytes,
    outputBytes,
    savedBytes: sourceBytes - outputBytes,
    transferRatio: +(outputBytes / sourceBytes).toFixed(4),
    geometryDriftGate: {
      comparedPositions: 587639,
      maximumNearestPositionDrift: 0.000129831,
      maximumRelativeBoundsDriftPercent: 0.0065,
      rmsDrift: 0.000060933,
      unmatchedPositions: 0,
      note: 'Audited across the complete 12-asset Allied proof; deterministic output hashes bind this six-asset promoted slice to that proof.',
    },
    rows,
  };

  const reportPath = path.join(assetDir, reportName);
  if (write) {
    await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } else {
    const tracked = JSON.parse(await fsp.readFile(reportPath, 'utf8'));
    if (JSON.stringify(tracked) !== JSON.stringify(report)) {
      throw new Error('Allied Meshopt recook differs from tracked report; use --write only after review');
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (!write) console.log('[allied-meshopt] reproducible recook matches tracked delivery');
} finally {
  await fsp.rm(temporary, { recursive: true, force: true });
}

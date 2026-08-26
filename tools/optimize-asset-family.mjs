#!/usr/bin/env node

/**
 * Generate reviewable, geometry-only LOD and shadow candidates for an asset family.
 *
 * The approved LOD0 is never overwritten. LOD candidates retain UVs and normals so
 * runtime integration can reuse the already-loaded LOD0 material and texture set;
 * shadow candidates retain positions and indices only. This prevents the pipeline
 * from multiplying a faction's decoded texture memory for every derived file.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Document, getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const manifestPath = path.resolve(root, value('--manifest') ?? 'tools/asset-families/soviet-buildings.json');
const write = args.includes('--write');
const selected = new Set((value('--only') ?? '').split(',').map((v) => v.trim()).filter(Boolean));

if (!fs.existsSync(manifestPath)) throw new Error(`asset-family manifest does not exist: ${manifestPath}`);
const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
if (manifest.version !== 1 || !Array.isArray(manifest.assets)) {
  throw new Error(`unsupported asset-family manifest: ${manifestPath}`);
}

const sourceDir = path.resolve(root, manifest.sourceDir);
const outputDir = path.resolve(root, manifest.outputDir);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function triangles(document) {
  let total = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const positions = primitive.getAttribute('POSITION');
      total += indices !== null ? indices.getCount() / 3 : (positions?.getCount() ?? 0) / 3;
    }
  }
  return Math.round(total);
}

function bounds(document) {
  const scenes = document.getRoot().listScenes();
  if (scenes.length === 0) throw new Error('asset has no scene');
  return getBounds(scenes[0]);
}

function boundsDrift(a, b) {
  let absolute = 0;
  let relative = 0;
  for (let axis = 0; axis < 3; axis++) {
    const span = Math.max(1e-6, a.max[axis] - a.min[axis]);
    for (const edge of ['min', 'max']) {
      const delta = Math.abs(a[edge][axis] - b[edge][axis]);
      absolute = Math.max(absolute, delta);
      relative = Math.max(relative, delta / span);
    }
  }
  return { absolute, relative };
}

function stripTextures(document) {
  for (const material of document.getRoot().listMaterials()) {
    material.setBaseColorTexture(null);
    material.setMetallicRoughnessTexture(null);
    material.setNormalTexture(null);
    material.setOcclusionTexture(null);
    material.setEmissiveTexture(null);
    material.setBaseColorFactor([1, 1, 1, 1]);
    material.setMetallicFactor(0);
    material.setRoughnessFactor(1);
    material.setEmissiveFactor([0, 0, 0]);
  }
  for (const texture of document.getRoot().listTextures()) texture.dispose();
}

function worldPoint(out, accessor, index, matrix) {
  accessor.getElement(index, out);
  const x = out[0], y = out[1], z = out[2];
  out[0] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  out[1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  out[2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  return out;
}

/**
 * Build a conservative height-field shadow shell. Generated Meshy topology is
 * usually split into hundreds of UV islands, so a triangle simplifier cannot
 * cross the very seams a depth pass does not need. A 16-cell longest axis
 * preserves the strategic-camera roofline in at most ~3k triangles, with no
 * UVs, materials, normals or source-specific decoder.
 */
async function deriveShadowProxy(input, output, profile) {
  const source = await io.read(input);
  const sourceBounds = bounds(source);
  const sourceTriangles = triangles(source);
  const spanX = sourceBounds.max[0] - sourceBounds.min[0];
  const spanZ = sourceBounds.max[2] - sourceBounds.min[2];
  // Wide hovercraft can fill more cells than a conventional hull at the same
  // 16-cell span. Allow a family profile to lower grid density so the proxy
  // still honors its absolute triangle ceiling instead of passing only by the
  // relative-ratio escape hatch.
  const longest = profile.gridLongest ?? 16;
  const nx = spanX >= spanZ ? longest : Math.max(6, Math.round(longest * spanX / Math.max(1e-6, spanZ)));
  const nz = spanZ >= spanX ? longest : Math.max(6, Math.round(longest * spanZ / Math.max(1e-6, spanX)));
  const dx = spanX / nx;
  const dz = spanZ / nz;
  const heights = new Float64Array(nx * nz).fill(-Infinity);
  const p0 = [0, 0, 0], p1 = [0, 0, 0], p2 = [0, 0, 0];

  const mark = (x, z, y) => {
    const ix = Math.max(0, Math.min(nx - 1, Math.floor((x - sourceBounds.min[0]) / Math.max(1e-6, dx))));
    const iz = Math.max(0, Math.min(nz - 1, Math.floor((z - sourceBounds.min[2]) / Math.max(1e-6, dz))));
    const cell = iz * nx + ix;
    heights[cell] = Math.max(heights[cell], y);
  };

  for (const scene of source.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (mesh === null) return;
      const matrix = node.getWorldMatrix();
      for (const primitive of mesh.listPrimitives()) {
        const positions = primitive.getAttribute('POSITION');
        if (positions === null) continue;
        const indices = primitive.getIndices();
        const count = indices?.getCount() ?? positions.getCount();
        const vertex = (i) => indices?.getScalar(i) ?? i;
        for (let i = 0; i + 2 < count; i += 3) {
          worldPoint(p0, positions, vertex(i), matrix);
          worldPoint(p1, positions, vertex(i + 1), matrix);
          worldPoint(p2, positions, vertex(i + 2), matrix);
          mark(p0[0], p0[2], p0[1]);
          mark(p1[0], p1[2], p1[1]);
          mark(p2[0], p2[2], p2[1]);

          const minX = Math.max(0, Math.floor((Math.min(p0[0], p1[0], p2[0]) - sourceBounds.min[0]) / dx));
          const maxX = Math.min(nx - 1, Math.floor((Math.max(p0[0], p1[0], p2[0]) - sourceBounds.min[0]) / dx));
          const minZ = Math.max(0, Math.floor((Math.min(p0[2], p1[2], p2[2]) - sourceBounds.min[2]) / dz));
          const maxZ = Math.min(nz - 1, Math.floor((Math.max(p0[2], p1[2], p2[2]) - sourceBounds.min[2]) / dz));
          const denom = (p1[2] - p2[2]) * (p0[0] - p2[0])
            + (p2[0] - p1[0]) * (p0[2] - p2[2]);
          if (Math.abs(denom) < 1e-9) continue;
          for (let iz = minZ; iz <= maxZ; iz++) {
            const z = sourceBounds.min[2] + (iz + 0.5) * dz;
            for (let ix = minX; ix <= maxX; ix++) {
              const x = sourceBounds.min[0] + (ix + 0.5) * dx;
              const a = ((p1[2] - p2[2]) * (x - p2[0]) + (p2[0] - p1[0]) * (z - p2[2])) / denom;
              const b = ((p2[2] - p0[2]) * (x - p2[0]) + (p0[0] - p2[0]) * (z - p2[2])) / denom;
              const c = 1 - a - b;
              if (a >= -0.02 && b >= -0.02 && c >= -0.02) mark(x, z, a * p0[1] + b * p1[1] + c * p2[1]);
            }
          }
        }
      }
    });
  }

  const positions = [];
  const indices = [];
  const faces = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 4, 7, 0, 7, 3,
    1, 2, 6, 1, 6, 5,
    3, 7, 6, 3, 6, 2,
    0, 1, 5, 0, 5, 4,
  ];
  let cells = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const top = heights[iz * nx + ix];
      if (!Number.isFinite(top) || top <= sourceBounds.min[1] + 0.02) continue;
      const x0 = sourceBounds.min[0] + ix * dx, x1 = x0 + dx;
      const z0 = sourceBounds.min[2] + iz * dz, z1 = z0 + dz;
      const y0 = sourceBounds.min[1], y1 = Math.min(sourceBounds.max[1], top);
      const base = positions.length / 3;
      positions.push(
        x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
        x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
      );
      for (const index of faces) indices.push(base + index);
      cells++;
    }
  }
  if (cells === 0) throw new Error(`${path.basename(input)} produced an empty shadow proxy`);

  const proxy = new Document();
  const buffer = proxy.createBuffer('shadow-proxy');
  const positionAccessor = proxy.createAccessor('POSITION')
    .setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer);
  const indexArray = positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  const indexAccessor = proxy.createAccessor('indices')
    .setType('SCALAR').setArray(indexArray).setBuffer(buffer);
  const primitive = proxy.createPrimitive().setAttribute('POSITION', positionAccessor).setIndices(indexAccessor);
  const mesh = proxy.createMesh('shadow-proxy').addPrimitive(primitive);
  proxy.createScene('Scene').addChild(proxy.createNode('shadow-proxy').setMesh(mesh));

  const afterTriangles = triangles(proxy);
  const afterBounds = bounds(proxy);
  const drift = boundsDrift(sourceBounds, afterBounds);
  const ratio = afterTriangles / Math.max(1, sourceTriangles);
  const blockers = [];
  if (ratio > profile.maxRatio && afterTriangles > profile.maxTriangles) {
    blockers.push(
      `proxy is ${afterTriangles.toLocaleString()} tris / ${(ratio * 100).toFixed(1)}% `
      + `(ceilings: ${profile.maxTriangles.toLocaleString()} tris or ${(profile.maxRatio * 100).toFixed(1)}%)`,
    );
  }
  if (drift.relative > 0.02) blockers.push(`bounds drift ${(drift.relative * 100).toFixed(2)}% exceeds 2% ceiling`);

  let fileBytes = 0;
  if (write && blockers.length === 0) {
    await fsp.mkdir(path.dirname(output), { recursive: true });
    await io.write(output, proxy);
    fileBytes = (await fsp.stat(output)).size;
  } else if (write) {
    // A candidate that stops passing after a profile/tool change must not sit
    // on disk looking promotable. Derived files are disposable by contract.
    await fsp.rm(output, { force: true });
  }
  return {
    profile: 'shadow',
    status: blockers.length === 0 ? 'candidate' : 'blocked',
    blockers,
    file: path.relative(root, output).replaceAll('\\', '/'),
    triangles: afterTriangles,
    triangleRatio: +ratio.toFixed(4),
    boundsDriftMeters: +drift.absolute.toFixed(5),
    boundsDriftRatio: +drift.relative.toFixed(5),
    fileBytes,
    geometryOnly: true,
    grid: [nx, nz],
    occupiedCells: cells,
  };
}

async function derive(input, output, profileName, profile) {
  const document = await io.read(input);
  const beforeBounds = bounds(document);
  const beforeTriangles = triangles(document);

  // Keep the source material references through simplify + prune. TEXCOORD_0
  // looks unused after textures are detached, so pruning in the old order
  // deleted the UV accessor: WebGL sampled one fallback texel and WebGPU
  // rejected the colour draw entirely. Detach payloads only after pruning has
  // made its reachability decision; the primitive then retains UVs/normals and
  // the derived GLB still carries no images.
  await document.transform(
    weld({ overwrite: false }),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: profile.ratio,
      error: profile.error,
      lockBorder: false,
    }),
  );

  await document.transform(dedup(), prune());
  await document.transform(quantize({
    quantizePosition: 14,
    quantizeNormal: 10,
    quantizeTexcoord: 12,
  }));
  stripTextures(document);
  await document.transform(prune({ keepAttributes: true }));

  const afterTriangles = triangles(document);
  const afterBounds = bounds(document);
  const drift = boundsDrift(beforeBounds, afterBounds);
  const ratio = afterTriangles / Math.max(1, beforeTriangles);

  const blockers = [];
  if (ratio > profile.maxRatio) {
    blockers.push(
      `simplifier floor ${(ratio * 100).toFixed(1)}% exceeds ${(profile.maxRatio * 100).toFixed(1)}% ceiling`,
    );
  }
  if (drift.relative > 0.02) {
    blockers.push(`bounds drift ${(drift.relative * 100).toFixed(2)}% exceeds 2% ceiling`);
  }

  let fileBytes = 0;
  if (write && blockers.length === 0) {
    await fsp.mkdir(path.dirname(output), { recursive: true });
    await io.write(output, document);
    fileBytes = (await fsp.stat(output)).size;
  } else if (write) {
    await fsp.rm(output, { force: true });
  }

  return {
    profile: profileName,
    status: blockers.length === 0 ? 'candidate' : 'blocked',
    blockers,
    file: path.relative(root, output).replaceAll('\\', '/'),
    triangles: afterTriangles,
    triangleRatio: +ratio.toFixed(4),
    boundsDriftMeters: +drift.absolute.toFixed(5),
    boundsDriftRatio: +drift.relative.toFixed(5),
    fileBytes,
    geometryOnly: true,
  };
}

const rows = [];
for (const asset of manifest.assets) {
  if (selected.size > 0 && !selected.has(asset.key)) continue;
  const input = path.join(sourceDir, asset.file);
  if (!fs.existsSync(input)) throw new Error(`${asset.key} source is missing: ${input}`);

  const source = await io.read(input);
  const sourceTriangles = triangles(source);
  const sourceBytes = (await fsp.stat(input)).size;
  const stem = path.basename(asset.file, '.glb');
  const outputs = [];
  // Dedicated retopology often changes LOD0 by an order of magnitude while
  // the useful RTS distance budgets stay fixed. Allow a reviewed asset to
  // override family ratios without forcing every member to inherit them.
  const profile = (name) => ({
    ...manifest.profiles[name],
    ...(asset.profiles?.[name] ?? {}),
  });

  if (asset.lods === true) {
    outputs.push(await derive(input, path.join(outputDir, `${stem}.lod1.glb`), 'lod1', profile('lod1')));
    outputs.push(await derive(input, path.join(outputDir, `${stem}.lod2.glb`), 'lod2', profile('lod2')));
  }
  outputs.push(await deriveShadowProxy(input, path.join(outputDir, `${stem}.shadow.glb`), profile('shadow')));

  rows.push({
    key: asset.key,
    class: asset.class,
    movingParts: asset.movingParts === true,
    source: {
      file: path.relative(root, input).replaceAll('\\', '/'),
      triangles: sourceTriangles,
      fileBytes: sourceBytes,
    },
    outputs,
  });
  console.log(
    `[asset-family] ${asset.key}: ${sourceTriangles.toLocaleString()} tris -> `
    + outputs.map((o) => `${o.profile} ${o.triangles.toLocaleString()} `
      + `(${(o.triangleRatio * 100).toFixed(1)}%, ${o.status})`).join(', '),
  );
}

const reportPath = path.join(outputDir, 'optimization-report.json');
let reportRows = rows;
if (write && selected.size > 0 && fs.existsSync(reportPath)) {
  const previous = JSON.parse(await fsp.readFile(reportPath, 'utf8'));
  const merged = new Map(previous.rows?.map((row) => [row.key, row]) ?? []);
  for (const row of rows) merged.set(row.key, row);
  reportRows = manifest.assets.map((asset) => merged.get(asset.key)).filter(Boolean);
}

const report = {
  version: 1,
  family: manifest.family,
  generatedAt: new Date().toISOString(),
  write,
  sourceManifest: path.relative(root, manifestPath).replaceAll('\\', '/'),
  rows: reportRows,
};

if (write) {
  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[asset-family] report: ${path.relative(root, reportPath)}`);
} else {
  console.log('[asset-family] dry run; pass --write to keep derived files and the report');
}

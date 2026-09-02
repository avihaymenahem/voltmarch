import { build } from 'esbuild';
import ts from 'typescript';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const here = path.join(root, 'tools/asset-prep-poc');
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Extract the actual production statements, not a second conditioning implementation. */
export function extractKernel(source, attributes) {
  const file = ts.createSourceFile('ImportedUnitAssets.ts', source, ts.ScriptTarget.Latest, true);
  const names = [
    'promotePositions', 'sceneMeshes', 'resolveImportedPartMeshes', 'sourceGeometry',
    'sourcePartGeometry', 'primitiveMaterialNames', 'fitGeometry',
    'assertImportedHorizontalEnvelope', 'sealTurretInterface', 'tagQuadrupedGait',
  ];
  const functions = names.map((name) => {
    const found = file.statements.filter((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
    if (found.length !== 1) throw new Error(`Kernel authority missing/ambiguous: ${name}`);
    return found[0].getText(file);
  });
  const load = file.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'loadImportedUnitOverride');
  const block = load?.body?.statements.find(ts.isTryStatement)?.tryBlock;
  if (!block) throw new Error('Production conditioning try block moved; review the extraction.');
  const variableName = (s) => ts.isVariableStatement(s) ? s.declarationList.declarations[0]?.name.getText(file) : '';
  const start = block.statements.findIndex((s) => variableName(s) === 'hullSources');
  const end = block.statements.findIndex((s) => variableName(s) === 'runtimeMaterialBySource');
  if (start < 0 || end <= start) throw new Error('Production conditioning boundary moved.');
  const statements = block.statements.slice(start, end).map((s) => s.getText(file)).join('\n');
  return `import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
${attributes.replace(/import \* as THREE from 'three';/, '')}
${functions.join('\n')}
export async function prepareFamily(loaded, spec, model) {
  if (spec.key !== 'allied_harvester' || spec.turretName || spec.gait || loaded.length !== 4) {
    throw new Error('POC supports only the static four-file Chrono Miner family.');
  }
  const lodSpecs = spec.lods;
  const shadowUrl = spec.shadowUrl;
  const progressive = false;
  const waitForBattlefieldIdle = () => { throw new Error('Unexpected progressive branch'); };
  ${statements}
  return [geometry, ...hullLods.map(lod => lod.geometry), shadowGeometry];
}`;
}

export async function buildPoc(outdir) {
  const authority = await readFile(path.join(root, 'apps/game/src/art/ImportedUnitAssets.ts'), 'utf8');
  const attributes = await readFile(path.join(root, 'apps/game/src/art/geometry-attributes.ts'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(root, 'tools/asset-cooks/chrono-miner.runtime.json'), 'utf8'));
  const inputs = {};
  for (const [role, relative] of Object.entries(manifest.inputs)) {
    const bytes = await readFile(path.join(root, relative));
    if (hash(bytes) !== manifest.inputSha256[role]) throw new Error(`Source hash changed: ${role}`);
    inputs[role] = { path: relative, bytes: bytes.length, sha256: hash(bytes) };
  }
  // Pin the relevant live spec to the existing manifest instead of silently using stale fit values.
  const parsed = ts.createSourceFile('source.ts', authority, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.filter(ts.isVariableStatement)
    .flatMap(s => [...s.declarationList.declarations]).find(d => d.name.getText(parsed) === 'IMPORTED_UNIT_SPECS');
  const specNode = declaration?.initializer?.elements?.[0];
  const props = new Map(specNode?.properties?.filter(ts.isPropertyAssignment).map(p => [p.name.getText(parsed), p.initializer.getText(parsed)]));
  for (const [key, expected] of Object.entries({ key: "'allied_harvester'", hullName: "'Hull'", yawDeg: '90' })) {
    if (props.get(key) !== expected) throw new Error(`Live spec ${key} changed; review manifest.`);
  }
  if (JSON.stringify(JSON.parse(props.get('target'))) !== JSON.stringify(manifest.contract.target)) {
    throw new Error('Live target no longer matches the POC contract.');
  }
  const property = (object, name) => object.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(parsed) === name)?.initializer;
  const assetPath = node => {
    if (!ts.isPropertyAccessExpression(node) || !ts.isNewExpression(node.expression) || !ts.isStringLiteral(node.expression.arguments?.[0])) throw new Error('Live asset URL shape changed');
    return path.relative(root, path.resolve(root, 'apps/game/src/art', node.expression.arguments[0].text)).replaceAll('\\', '/');
  };
  const lodNodes = property(specNode, 'lods').elements;
  const sourcePaths = { lod0: property(specNode, 'url'), lod1: property(lodNodes[0], 'url'), lod2: property(lodNodes[1], 'url'), shadow: property(specNode, 'shadowUrl') };
  for (const [role, node] of Object.entries(sourcePaths)) if (assetPath(node) !== inputs[role].path) throw new Error(`Live ${role} URL changed`);
  if (JSON.stringify(lodNodes.map(node => Number(property(node, 'minDistance').getText(parsed)))) !== JSON.stringify(manifest.contract.lodDistances)) throw new Error('Live LOD distances changed');
  if (['turretName', 'gait'].some(key => props.has(key))) throw new Error('Family is no longer static');
  const kernel = extractKernel(authority, attributes);
  const plugin = {
    name: 'poc-production-kernel',
    setup(builder) {
      builder.onResolve({ filter: /^poc:kernel$/ }, () => ({ path: 'kernel', namespace: 'poc' }));
      builder.onLoad({ filter: /.*/, namespace: 'poc' }, () => ({ contents: kernel, loader: 'ts', resolveDir: root }));
    },
  };
  await mkdir(outdir, { recursive: true });
  const common = { bundle: true, minify: true, logLevel: 'warning', plugins: [plugin] };
  await build({ ...common, entryPoints: [path.join(here, 'renderer.mjs')], outfile: path.join(outdir, 'renderer.js'), format: 'esm', platform: 'browser' });
  await build({ ...common, entryPoints: [path.join(here, 'worker.mjs')], outfile: path.join(outdir, 'worker.js'), format: 'esm', platform: 'browser' });
  await build({ ...common, entryPoints: [path.join(here, 'utility.mjs')], outfile: path.join(outdir, 'utility.cjs'), format: 'cjs', platform: 'node' });
  for (const entry of ['main', 'preload']) {
    await build({ ...common, entryPoints: [path.join(here, `${entry}.mjs`)], outfile: path.join(outdir, `${entry}.cjs`), format: 'cjs', platform: 'node', external: ['electron'] });
  }
  const builtSha256 = {};
  for (const name of ['renderer.js', 'worker.js', 'utility.cjs', 'main.cjs', 'preload.cjs']) builtSha256[name] = hash(await readFile(path.join(outdir, name)));
  const sourceSha256 = {};
  for (const name of ['build', 'geometry', 'main', 'preload', 'renderer', 'worker', 'utility', 'run']) sourceSha256[`tools/asset-prep-poc/${name}.mjs`] = hash(await readFile(path.join(here, `${name}.mjs`)));
  for (const name of ['package-lock.json', 'packages/gltf-runtime/src/gltf.ts', 'packages/gltf-runtime/src/ktx2.ts', 'node_modules/three/examples/jsm/libs/basis/basis_transcoder.js', 'node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm']) sourceSha256[name] = hash(await readFile(path.join(root, name)));
  return { inputs, authoritySha256: hash(authority), attributesSha256: hash(attributes), kernelSha256: hash(kernel), builtSha256, sourceSha256, manifest };
}

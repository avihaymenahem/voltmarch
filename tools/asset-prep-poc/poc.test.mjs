import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as THREE from 'three';
import { root, here, extractKernel, buildPoc } from './build.mjs';

const authority = await readFile(path.join(root, 'apps/game/src/art/ImportedUnitAssets.ts'), 'utf8');
const attributes = await readFile(path.join(root, 'apps/game/src/art/geometry-attributes.ts'), 'utf8');
const base = path.join(root, '.turbo/asset-prep-poc');
await mkdir(base, { recursive: true });
const out = await mkdtemp(path.join(base, 'tests-'));
const kernel = extractKernel(authority, attributes);
await build({ entryPoints: [path.join(here, 'geometry.mjs')], outfile: path.join(out, 'geometry.mjs'), bundle: true, platform: 'node', format: 'esm', external: ['three', 'three/*'], plugins: [{ name: 'test-kernel', setup(builder) {
  builder.onResolve({ filter: /^poc:kernel$/ }, () => ({ path: 'kernel', namespace: 'poc' }));
  builder.onLoad({ filter: /.*/, namespace: 'poc' }, () => ({ contents: kernel, loader: 'ts', resolveDir: root }));
} }] });
const { packGeometry, unpackGeometry, packLoaded, unpackLoaded, runJob, buffersOf, bufferBytes, spec, model } = await import(pathToFileURL(path.join(out, 'geometry.mjs')).href);

test('live contract and sources build with complete harness fingerprints', async () => {
  const provenance = await buildPoc(path.join(out, 'build'));
  assert.equal(Object.keys(provenance.builtSha256).length, 5);
  assert.ok(provenance.sourceSha256['package-lock.json']);
  assert.deepEqual(spec.target, provenance.manifest.contract.target);
  assert.equal(spec.yawDeg, provenance.manifest.contract.yawDeg);
  assert.equal(spec.hullName, provenance.manifest.contract.hullName);
  assert.deepEqual(spec.lods.map(lod => lod.minDistance), provenance.manifest.contract.lodDistances);
  assert.deepEqual(model.turretPivot, provenance.manifest.contract.targetPivot);
});

test('extraction fails closed when helper or conditioning boundary moves', () => {
  assert.throws(() => extractKernel(authority.replace('function promotePositions(', 'function renamedPositions('), attributes), /Kernel authority/);
  assert.throws(() => extractKernel(authority.replace('const hullSources =', 'const renamedSources ='), attributes), /boundary moved/);
  assert.ok(kernel.includes('toCreasedNormals'));
  assert.ok(!kernel.includes('const runtimeMaterialBySource'));
});

test('compact normalized interleaved attributes survive an owned transferable snapshot', () => {
  const geometry = new THREE.BufferGeometry();
  const data = new THREE.InterleavedBuffer(new Int16Array([1, 2, 3, 4, 5, 6, 7, 8]), 4);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0, true));
  geometry.setAttribute('weight', new THREE.InterleavedBufferAttribute(data, 1, 3, false));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 0]), 1));
  geometry.addGroup(0, 3, 0); geometry.setDrawRange(0, 3);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometry.name = 'test';
  const packed = packGeometry(geometry, true);
  assert.notEqual(packed.attributes.position.array, data.array);
  assert.equal(buffersOf(packed).length, 2);
  assert.equal(bufferBytes(packed), 22);
  const transferred = structuredClone(packed, { transfer: buffersOf(packed) });
  assert.equal(packed.attributes.position.array.byteLength, 0);
  assert.equal(data.array.byteLength, 16, 'original source remains owned by renderer');
  const restored = unpackGeometry(transferred);
  assert.equal(restored.attributes.position.normalized, true);
  assert.equal(restored.attributes.position.data, restored.attributes.weight.data);
  assert.equal(restored.attributes.weight.offset, 3);
  assert.ok(restored.attributes.position.data.array instanceof Int16Array);
  assert.ok(restored.index.array instanceof Uint16Array);
  assert.deepEqual(packGeometry(restored), packGeometry(geometry));
  geometry.dispose(); restored.dispose();
});

test('single-Hull snapshot preserves world transform without transferring live objects', () => {
  const scene = new THREE.Scene(); scene.position.set(4, 2, 1);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.name = 'Hull'; mesh.position.set(2, 3, 4); mesh.rotation.y = 0.3;
  scene.add(mesh);
  const packed = packLoaded(Array.from({ length: 4 }, () => ({ scene })));
  const loaded = unpackLoaded(structuredClone(packed));
  loaded[0].scene.updateMatrixWorld(true);
  assert.deepEqual(loaded[0].scene.children[0].matrixWorld.toArray(), mesh.matrixWorld.toArray());
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('unsupported multi-primitive families are refused instead of approximated', () => {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(), new THREE.Mesh());
  assert.throws(() => packLoaded([{ scene }]), /exactly one Hull/);
});

test('malformed and oversized helper requests fail with the precise validation error', async () => {
  await assert.rejects(runJob([]), { message: 'Invalid/oversized POC family payload.' });
  assert.throws(() => unpackLoaded([{ data: new Uint8Array(32 * 1024 * 1024 + 1) }, {}, {}, {}]), { message: 'Invalid/oversized POC family payload.' });
});

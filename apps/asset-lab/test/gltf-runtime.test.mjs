import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('Asset Lab uses the shared decoder package without pulling KTX2 into infantry', () => {
  const catalogue = fs.readFileSync(path.join(root, 'apps/asset-lab/src/asset-lab.mjs'), 'utf8');
  const infantry = fs.readFileSync(path.join(root, 'apps/asset-lab/src/infantry.mjs'), 'utf8');

  assert.match(catalogue, /from '@voltmarch\/gltf-runtime\/gltf'/);
  assert.match(catalogue, /from '@voltmarch\/gltf-runtime\/ktx2'/);
  assert.doesNotMatch(catalogue, /three\/examples\/jsm\/(?:libs\/meshopt|loaders\/(?:GLTF|KTX2)Loader)/);
  assert.match(infantry, /from '@voltmarch\/gltf-runtime\/gltf'/);
  assert.doesNotMatch(infantry, /@voltmarch\/gltf-runtime\/ktx2/);
  assert.doesNotMatch(infantry, /three\/examples\/jsm\/(?:libs\/meshopt|loaders\/(?:GLTF|KTX2)Loader)/);
});

test('production emits only Vite hashed KTX2 transcoder assets', () => {
  const vite = fs.readFileSync(path.join(root, 'apps/asset-lab/vite.config.mjs'), 'utf8');

  assert.match(vite, /command === 'serve' \? BASIS_DEV_PATH : ''/);
  assert.doesNotMatch(vite, /cpSync|basisTranscoderPlugin/);
});

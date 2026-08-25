import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the launch site keeps its analytics injection point and community link', () => {
  const html = readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.match(html, /<!-- CF_WEB_ANALYTICS -->/);
  assert.match(html, /https:\/\/discord\.gg\/pvJGJyafU3/);
});

test('the privacy page keeps its analytics injection point', () => {
  const html = readFileSync(path.join(ROOT, 'public', 'privacy.html'), 'utf8');
  assert.match(html, /<!-- CF_WEB_ANALYTICS -->/);
});

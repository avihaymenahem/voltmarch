import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the launch site keeps its analytics injection point and community links', () => {
  const html = readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.match(html, /<!-- CF_WEB_ANALYTICS -->/);
  assert.match(html, /https:\/\/discord\.gg\/pvJGJyafU3/);
  assert.match(html, /https:\/\/github\.com\/avihaymenahem\/voltmarch/);
});

test('the privacy page keeps its analytics injection point', () => {
  const html = readFileSync(path.join(ROOT, 'public', 'privacy.html'), 'utf8');
  assert.match(html, /<!-- CF_WEB_ANALYTICS -->/);
});

test('the cross-origin game bulletin is bounded and cacheable', () => {
  const feed = JSON.parse(readFileSync(path.join(ROOT, 'public', 'news.json'), 'utf8'));
  assert.equal(feed.version, 1);
  assert.ok(Array.isArray(feed.items));
  assert.ok(feed.items.length > 0 && feed.items.length <= 12);
  for (const item of feed.items) {
    assert.match(item.id, /^[a-z0-9][a-z0-9-]*$/);
    assert.ok(item.kind === 'update' || item.kind === 'event');
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(item.title.length <= 90);
    assert.ok(item.summary.length <= 320);
  }

  const headers = readFileSync(path.join(ROOT, 'public', '_headers'), 'utf8');
  assert.match(headers, /\/news\.json[\s\S]*Access-Control-Allow-Origin: \*/);
  assert.match(headers, /\/news\.json[\s\S]*max-age=300/);
});

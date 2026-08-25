/**
 * SPIKE INSTRUMENT — does the built game still boot, and does `?gpu=webgpu`
 * actually refuse?
 *
 * `src/render/backend.ts` is covered by 18 unit tests, but `createRenderer` is
 * not: it needs a real canvas and a real GL context, so no spec file reaches the
 * line that reads `location.search`. CLAUDE.md's standing rule applies exactly
 * here — "a green build proving nothing", where `npm run build` once succeeded
 * on a bundle that imported neither core nor render. Two page loads settle it.
 *
 * One browser, closed on every exit path. Serves `dist/`, so run `npm run build`
 * first.
 *
 *   node tools/webgpu-spike/boot-check.mjs [--port 5303]
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '../..', 'apps/game/dist');

const argv = process.argv.slice(2);
const i = argv.indexOf('--port');
const START = Number(i >= 0 && argv[i + 1] ? argv[i + 1] : 5303);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
};

let BROWSER = null;
let SERVER = null;
async function teardown() {
  try { if (BROWSER) await BROWSER.close(); } catch { /* gone */ }
  try { if (SERVER) SERVER.close(); } catch { /* gone */ }
  BROWSER = null;
  SERVER = null;
}
process.on('unhandledRejection', async (e) => { console.error(e); await teardown(); process.exit(1); });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(DIST, path.normalize(rel).replace(/^[\\/]+/, ''));
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(await readFile(file));
});

let port = START;
for (; port < START + 40; port++) {
  const ok = await new Promise((r) => {
    const onErr = () => { server.removeListener('error', onErr); r(false); };
    server.once('error', onErr);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', onErr); r(true); });
  });
  if (ok) break;
}
SERVER = server;
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`> serving ${DIST} at ${origin}`);

BROWSER = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio'],
});

async function boot(query, label) {
  const page = await BROWSER.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}/${query}`, { waitUntil: 'load' });
  // The shell boots asynchronously; give it a real chance to throw.
  await page.waitForTimeout(6000);
  const state = await page.evaluate(() => ({
    hasVM: typeof window.__VM === 'object' && window.__VM !== null,
    vmKeys: window.__VM ? Object.keys(window.__VM).sort() : [],
    backend: window.__VM && window.__VM.renderer
      ? (window.__VM.renderer.isWebGPURenderer === true ? 'webgpu-ish' : 'webgl')
      : null,
    canvas: !!document.querySelector('canvas'),
  }));
  await page.close();
  console.log(`\n  [${label}] ${query || '(no query)'}`);
  console.log(`    __VM present : ${state.hasVM}`);
  console.log(`    canvas       : ${state.canvas}`);
  console.log(`    renderer     : ${state.backend}`);
  console.log(`    __VM keys    : ${state.vmKeys.length} (${state.vmKeys.slice(0, 12).join(', ')}${state.vmKeys.length > 12 ? ', …' : ''})`);
  console.log(`    errors       : ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`      | ${e.split('\n')[0].slice(0, 200)}`);
  return { state, errors };
}

const plain = await boot('', 'default — must be untouched');
const flagged = await boot('?gpu=webgpu', 'flag — must REFUSE, loudly');

await teardown();

const refused = flagged.errors.some((e) => /no WebGPU path yet|gpu=webgpu/.test(e));
console.log('\n=== VERDICT ===');
console.log(`  default boots clean            : ${plain.errors.length === 0 && plain.state.hasVM}`);
console.log(`  ?gpu=webgpu refuses explicitly : ${refused}`);
process.exit(plain.errors.length === 0 && plain.state.hasVM && refused ? 0 : 1);

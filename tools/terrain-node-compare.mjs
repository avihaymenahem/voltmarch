/**
 * ============================================================================
 * VOLTMARCH — tools/terrain-node-compare.mjs
 * ============================================================================
 * THE CAPTURE HALF of the Stage C visual proof.
 *
 *   node tools/terrain-node-compare.mjs [--port 5305] [--headed] [--biome snow]
 *
 * Bundles `tools/terrain-node-compare/page.ts` with esbuild, serves it off a
 * socket THIS PROCESS OWNS, drives real Chrome through it, screenshots the four
 * canvases and diffs them.
 *
 * THE PORT IS OWNED, NOT PROBED — the same rule `tools/shoot.mjs` and the Stage
 * A spike both carry, and for the same reason: `server.listen()` either binds or
 * throws `EADDRINUSE`, so there is no window between a check and a use for a
 * neighbouring worktree's server to slip into. Every worktree here runs the same
 * tools.
 *
 * `channel: 'chrome'` IS LOAD-BEARING. Playwright's bundled Chromium cannot load
 * `dxil.dll` headless on this platform and falls back to WebGL2 while reporting
 * `navigator.gpu` and a real adapter — so the arm labelled `tsl-webgpu` would
 * quietly be a second copy of `tsl-webgl2`. The page reads
 * `renderer.backend.isWebGPUBackend` and this script prints it, because that is
 * the only thing that actually distinguishes them.
 * ============================================================================
 */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGE_DIR = path.join(HERE, 'terrain-node-compare');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const START_PORT = Number(opt('--port', '5305'));
const HEADED = flag('--headed');
const BIOME = opt('--biome', 'temperate');
const SEED = opt('--seed', '4242');
/** Separate directory so a dither-off run never overwrites the reference set. */
const NO_DITHER = flag('--no-dither');
const OUT_DIR = path.join(PAGE_DIR, NO_DITHER ? 'out-nodither' : 'out');

const ARMS = [
  'glsl-webgl', 'tsl-webgpu', 'tsl-webgl2', 'glsl-webgpu', 'stock-webgl', 'stock-webgpu',
];

/**
 * The environment sweep, driven step by step from here.
 *
 * IT IS SCREENSHOTTED, NOT READ BACK IN THE PAGE. The first version diffed the
 * WebGPU canvas through `drawImage` into a 2D context and every row came back
 * zero — including the control, which is the signature of a dead instrument,
 * and the exact trap `RENDER_FINDINGS.md` §6c records twice. These go through
 * the same screenshot path that produces the non-zero arm numbers above.
 */
const ENV_PAIRS = [
  ['sun 2.4 -> 0  (CONTROL ON THE CONTROL)', 'sunOn', 'sunOff'],
  ['material.envMapIntensity 0->8, no own envMap', 'matIntensity0', 'matIntensity8'],
  ['scene.environmentIntensity 0->6  (CONTROL)', 'sceneIntensity0', 'sceneIntensity6'],
  /*
   * CONFOUNDED, AND LABELLED SO RATHER THAN DELETED. Setting `material.envMap`
   * is the documented switch that makes `envMapIntensity` live — but it also
   * REPLACES the environment: `NodeMaterial.setupEnvironment` stops using
   * `builder.environmentNode` and wraps the material's own texture in
   * `pmremTexture()`, and a raw equirect `DataTexture` yields nothing there (the
   * row above measures exactly that). So this row scales zero by eight and
   * reports zero, which is a fact about the probe's environment and NOT about
   * the knob. Answering it properly needs a PMREM render-target texture, which
   * is what `scene.ts` holds in the real game and which `PMREMGenerator` cannot
   * produce on the node renderer (it draws with a raw `ShaderMaterial`).
   */
  ['material.envMapIntensity 0->8, own envMap (CONFOUNDED)', 'ownMap0', 'ownMap8'],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function bundle() {
  await mkdir(OUT_DIR, { recursive: true });
  await build({
    entryPoints: [path.join(PAGE_DIR, 'page.ts')],
    outfile: path.join(PAGE_DIR, 'page.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    absWorkingDir: ROOT,
    logLevel: 'warning',
  });
}

async function serve(startPort) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.join(PAGE_DIR, path.basename(rel));
      if (!existsSync(file)) { res.writeHead(404).end('not found: ' + url.pathname); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(await readFile(file));
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });

  for (let port = startPort; port < startPort + 40; port++) {
    const bound = await new Promise((resolve) => {
      const onErr = () => { server.removeListener('error', onErr); resolve(false); };
      server.once('error', onErr);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', onErr); resolve(true); });
    });
    if (bound) return { server, origin: `http://127.0.0.1:${server.address().port}` };
  }
  throw new Error('no free port');
}

/** Changed-pixel percentage and max per-channel delta between two PNG buffers. */
async function diff(aPath, bPath) {
  const [a, b] = await Promise.all([
    sharp(aPath).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
    sharp(bPath).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return { changed: 1, maxDelta: 255, note: 'size mismatch' };
  }
  let changed = 0;
  let maxDelta = 0;
  const n = a.data.length;
  for (let i = 0; i < n; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    if (d > 0) changed++;
    if (d > maxDelta) maxDelta = d;
  }
  return { changed: changed / (n / 4), maxDelta };
}

const { server, origin } = await serve(START_PORT);
console.log('serving', origin);
await bundle();

const browser = await chromium.launch({
  channel: opt('--channel', 'chrome'),
  headless: !HEADED,
  args: [
    '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
    '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU',
  ],
});

let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1320, height: 1020 } });
  const consoleErrors = [];
  // The favicon 404 is this server declining to serve one and is not a finding.
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(
    `${origin}/index.html?biome=${BIOME}&seed=${SEED}&dither=${NO_DITHER ? 'off' : 'on'}`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => window.__TNC.ready);

  const report = await page.evaluate(() => ({
    arms: window.__TNC.arms,
    error: window.__TNC.error,
    restoreIntensity: window.__TNC.restoreIntensity,
  }));

  if (report.error) {
    console.error('PAGE ERROR:\n' + report.error);
    exitCode = 1;
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const arm of ARMS) {
    const el = await page.locator(`#${arm}`);
    await el.screenshot({ path: path.join(OUT_DIR, `${arm}.png`) });
  }

  const ref = path.join(OUT_DIR, 'glsl-webgl.png');
  const diffs = {};
  for (const arm of ARMS.slice(1)) {
    diffs[arm] = await diff(ref, path.join(OUT_DIR, `${arm}.png`));
  }
  // The floor: two plain standard materials, one per renderer. Whatever this
  // differs by is three's two lighting models, not this port.
  diffs['stock-webgpu-vs-stock-webgl'] = await diff(
    path.join(OUT_DIR, 'stock-webgl.png'), path.join(OUT_DIR, 'stock-webgpu.png'),
  );

  // ------------------------------------------------------- environment ----
  const env = [];
  for (const [label, stepA, stepB] of ENV_PAIRS) {
    await page.evaluate((s) => window.__TNC.envStep(s), stepA);
    const a = path.join(OUT_DIR, `env-${stepA}.png`);
    await page.locator('#env').screenshot({ path: a });
    await page.evaluate((s) => window.__TNC.envStep(s), stepB);
    const b = path.join(OUT_DIR, `env-${stepB}.png`);
    await page.locator('#env').screenshot({ path: b });
    env.push({ label, ...(await diff(a, b)) });
  }
  await page.evaluate(() => window.__TNC.envStep('restore'));
  await page.locator('#env').screenshot({ path: path.join(OUT_DIR, 'env-restore.png') });
  // Does landing the dial at the scene's own intensity reproduce today exactly?
  const restoreDelta = await diff(
    path.join(OUT_DIR, 'env-sceneIntensity6.png'), path.join(OUT_DIR, 'env-restore.png'),
  );

  const out = {
    origin, biome: BIOME, seed: SEED, when: new Date().toISOString(),
    ...report, diffs, env, restoreDelta, consoleErrors,
  };
  await writeFile(path.join(OUT_DIR, 'results.json'), JSON.stringify(out, null, 2));

  console.log('\nbackends');
  for (const a of report.arms ?? []) console.log(`  ${a.arm.padEnd(14)} ${a.backend}`);
  console.log('\ndiff vs glsl-webgl (the shipping reference)');
  for (const [arm, d] of Object.entries(diffs)) {
    console.log(`  ${arm.padEnd(28)} ${(d.changed * 100).toFixed(3)}% of pixels, max delta ${d.maxDelta}`);
  }
  console.log('\nenvMapIntensity, on the node path (RENDER_FINDINGS.md 6c)');
  for (const e of env) {
    console.log(`  ${e.label.padEnd(48)} ${(e.changed * 100).toFixed(3)}% px, max delta ${e.maxDelta}`);
  }
  if (consoleErrors.length) console.log('\nconsole errors:\n  ' + consoleErrors.join('\n  '));
  console.log('\nwrote', OUT_DIR);
} finally {
  await browser.close();
  server.close();
}

process.exit(exitCode);

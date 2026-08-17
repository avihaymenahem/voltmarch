/**
 * ============================================================================
 * VOLTMARCH — tools/stage-d-node-compare.mjs
 * ============================================================================
 * THE CAPTURE HALF of the Stage D visual proof — structures, units and props.
 *
 *   node tools/stage-d-node-compare.mjs [--port 5345] [--headed] [--no-dither]
 *
 * Bundles `tools/stage-d-node-compare/page.ts` with esbuild, serves it off a
 * socket THIS PROCESS OWNS, drives real Chrome through it, screenshots the four
 * canvases and diffs them against the shipping WebGL arm.
 *
 * Sibling of `tools/terrain-node-compare.mjs` and it keeps that file's two
 * load-bearing rules:
 *
 *   THE PORT IS OWNED, NOT PROBED. `server.listen()` either binds or throws
 *   `EADDRINUSE`, so there is no window between a check and a use for a
 *   neighbouring worktree's server to slip into. Every worktree here runs the
 *   same tools, and `tools/shoot.mjs`'s header records what happens when one
 *   photographs another's build.
 *
 *   `channel: 'chrome'` IS LOAD-BEARING. Playwright's bundled Chromium cannot
 *   load `dxil.dll` headless on this platform and falls back to WebGL2 while
 *   still reporting `navigator.gpu` and a real adapter — so the arm labelled
 *   `tsl-webgpu` would quietly be a second copy of `tsl-webgl2`. The page reads
 *   `renderer.backend.isWebGPUBackend` and this script prints it, because that
 *   is the only thing that actually distinguishes them.
 *
 * READ `--no-dither` BEFORE BELIEVING A LARGE `changed` PERCENTAGE. The ordered
 * dither is a deliberate +/-0.5/255 of per-pixel noise, and the two paths derive
 * its grid position from `gl_FragCoord` and from `screenCoordinate` — the same
 * quantity, but the generated hashes need not land on the same value for a given
 * pixel. With dithering on, most of the frame reports as changed at max delta 1,
 * and it reports that whether or not the shaders agree.
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
const PAGE_DIR = path.join(HERE, 'stage-d-node-compare');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const START_PORT = Number(opt('--port', '5345'));
const HEADED = flag('--headed');
const NO_DITHER = flag('--no-dither');
const OUT_DIR = path.join(PAGE_DIR, NO_DITHER ? 'out-nodither' : 'out');

const ARMS = [
  'glsl-webgl', 'tsl-webgpu', 'tsl-webgl2', 'glsl-webgpu', 'stock-webgl', 'stock-webgpu',
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

/** Changed-pixel percentage, max and mean per-channel delta between two PNGs. */
async function diff(aPath, bPath) {
  const [a, b] = await Promise.all([
    sharp(aPath).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
    sharp(bPath).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return { changed: 1, maxDelta: 255, meanDelta: 255, note: 'size mismatch' };
  }
  let changed = 0;
  /*
   * "CHANGED" AND "VISIBLY CHANGED" ARE DIFFERENT QUESTIONS, and reporting only
   * the first is how a thin resampled silhouette gets read as a broken shader. A
   * delta of 1/255 is a rounding decision; 8/255 is something a person can see.
   */
  let strong = 0;
  let maxDelta = 0;
  let sum = 0;
  const n = a.data.length;
  for (let i = 0; i < n; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    if (d > 0) changed++;
    if (d > 8) strong++;
    if (d > maxDelta) maxDelta = d;
    sum += d;
  }
  const px = n / 4;
  return { changed: changed / px, strong: strong / px, maxDelta, meanDelta: sum / px };
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
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(`${origin}/index.html?dither=${NO_DITHER ? 'off' : 'on'}`, { waitUntil: 'load' });
  await page.evaluate(() => window.__SDC.ready);

  const report = await page.evaluate(() => ({
    arms: window.__SDC.arms,
    error: window.__SDC.error,
    warnings: window.__SDC.warnings,
  }));

  if (report.error) {
    console.error('PAGE ERROR:\n' + report.error);
    exitCode = 1;
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const arm of ARMS) {
    await page.locator(`#${arm}`).screenshot({ path: path.join(OUT_DIR, `${arm}.png`) });
  }

  const ref = path.join(OUT_DIR, 'glsl-webgl.png');
  const diffs = {};
  for (const arm of ARMS.slice(1)) {
    diffs[arm] = await diff(ref, path.join(OUT_DIR, `${arm}.png`));
  }

  /*
   * THE FLOOR. Two plain physical materials, one per renderer, no custom shader
   * on either side. Whatever this differs by is three's two lighting models and
   * not this port, and it is the number every TSL row above has to be read
   * against.
   */
  diffs['stock-webgpu-vs-stock-webgl'] = await diff(
    path.join(OUT_DIR, 'stock-webgl.png'), path.join(OUT_DIR, 'stock-webgpu.png'),
  );

  const out = { origin, when: new Date().toISOString(), dither: !NO_DITHER, ...report, diffs };
  await writeFile(path.join(OUT_DIR, 'results.json'), JSON.stringify(out, null, 2));

  console.log('\nbackends');
  for (const a of report.arms ?? []) console.log(`  ${a.arm.padEnd(14)} ${a.backend}`);
  console.log('\ndiff vs glsl-webgl (the shipping reference)');
  for (const [arm, d] of Object.entries(diffs)) {
    console.log(
      `  ${arm.padEnd(30)} ${(d.changed * 100).toFixed(3)}% changed, `
      + `${(d.strong * 100).toFixed(3)}% over 8/255, max ${d.maxDelta}, mean ${d.meanDelta.toFixed(3)}`,
    );
  }
  /*
   * THE CONTROL, CHECKED RATHER THAN PRINTED AND FORGOTTEN. `glsl-webgpu` is
   * the shipping GLSL materials on the node renderer, where `onBeforeCompile`
   * is silently dead. If that arm comes back close to the reference, the diff
   * is not measuring anything and no other row on this page means a thing.
   */
  const control = diffs['glsl-webgpu'];
  if (control && control.changed < 0.02) {
    console.error(
      `\nCONTROL FAILED: glsl-webgpu differs from the reference in only `
      + `${(control.changed * 100).toFixed(3)}% of pixels. onBeforeCompile is `
      + `dead on that renderer, so this arm MUST differ substantially. The `
      + `instrument is broken; ignore every number above.`,
    );
    exitCode = 1;
  }
  if (report.warnings?.length) {
    console.log('\npage warnings (a missing attribute is named here):');
    for (const w of new Set(report.warnings)) console.log('  ' + w);
  }
  if (consoleErrors.length) console.log('\nconsole errors:\n  ' + consoleErrors.join('\n  '));
  console.log('\nwrote', OUT_DIR);
} finally {
  await browser.close();
  server.close();
}

process.exit(exitCode);

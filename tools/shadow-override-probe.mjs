/**
 * ============================================================================
 * VOLTMARCH — tools/shadow-override-probe.mjs
 * ============================================================================
 * THE CAPTURE HALF of the measurement `STAGE_D_TSL_GAPS` #1 asks for:
 *
 *   node tools/shadow-override-probe.mjs [--port 5375] [--headed]
 *
 * The node path has no `customDepthMaterial`, so a model-space vertex
 * displacement cannot reach the shadow pass and a half-built structure casts its
 * finished silhouette. Stage D named two routes out and said "measure the cheap
 * one first, it is one line". This is that measurement.
 *
 * Sibling of `tools/stage-d-node-compare.mjs` and it keeps that file's two
 * load-bearing rules:
 *
 *   THE PORT IS OWNED, NOT PROBED. `server.listen()` either binds or throws
 *   `EADDRINUSE`, so there is no window between a check and a use for a
 *   neighbouring worktree's server to slip into.
 *
 *   `channel: 'chrome'` IS LOAD-BEARING. Playwright's bundled Chromium cannot
 *   load `dxil.dll` headless on this platform and falls back to WebGL2 while
 *   still reporting `navigator.gpu` and a real adapter. The page reads
 *   `renderer.backend.isWebGPUBackend` and this script REFUSES to report a
 *   result unless both node arms came back `webgpu` — a fallback would answer a
 *   question about `WebGLBackend` and print it under a WebGPU heading.
 *
 * HOW TO READ THE OUTPUT. Every arm is diffed against `glsl-webgl`, the shipping
 * renderer with its custom depth materials, which is the CORRECT picture. The
 * row that decides everything is `glsl-webgl-nodepth`: the same renderer with
 * those materials removed, i.e. the defect reproduced on a renderer we trust. If
 * that row is small, the camera is not looking at the shadow and no other number
 * here means anything — so it is checked, not just printed.
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
const PAGE_DIR = path.join(HERE, 'shadow-override-probe');
const OUT_DIR = path.join(PAGE_DIR, 'out');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const START_PORT = Number(opt('--port', '5375'));
const HEADED = flag('--headed');

const ARMS = [
  'glsl-webgl', 'glsl-webgl-nodepth', 'tsl-override', 'tsl-nooverride',
  'tsl-nooverride-noreceive',
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

/**
 * Changed-pixel percentage plus a DARKENED count.
 *
 * The plain diff cannot tell "the shadow moved" from "the lighting differs", and
 * the two node arms sit on a different lighting implementation from the
 * reference by construction. `darker` counts pixels the arm renders MORE THAN
 * 24/255 darker than the reference — which is what an extra 4.9 m of silhouette
 * looks like and what a lighting-model difference does not do at that magnitude.
 */
async function diff(aPath, bPath) {
  const [a, b] = await Promise.all([
    sharp(aPath).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
    sharp(bPath).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return { changed: 1, strong: 1, darker: 1, maxDelta: 255, meanDelta: 255, note: 'size mismatch' };
  }
  let changed = 0;
  let strong = 0;
  let darker = 0;
  let maxDelta = 0;
  let sum = 0;
  const n = a.data.length;
  for (let i = 0; i < n; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    // Luma, cheap and good enough to say "this pixel went into shadow".
    const la = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2];
    const lb = 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2];
    if (d > 0) changed++;
    if (d > 8) strong++;
    if (la - lb > 24) darker++;
    if (d > maxDelta) maxDelta = d;
    sum += d;
  }
  const px = n / 4;
  return {
    changed: changed / px, strong: strong / px, darker: darker / px,
    maxDelta, meanDelta: sum / px,
  };
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

  await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => window.__SOP.ready);

  const report = await page.evaluate(() => ({
    arms: window.__SOP.arms,
    error: window.__SOP.error,
    warnings: window.__SOP.warnings,
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
  // And the row that answers the question directly: does the flag move the node
  // path from the defect toward the reference?
  diffs['tsl-nooverride-vs-tsl-override'] = await diff(
    path.join(OUT_DIR, 'tsl-override.png'), path.join(OUT_DIR, 'tsl-nooverride.png'),
  );
  diffs['tsl-nooverride-noreceive-vs-tsl-override'] = await diff(
    path.join(OUT_DIR, 'tsl-override.png'), path.join(OUT_DIR, 'tsl-nooverride-noreceive.png'),
  );

  const out = { origin, when: new Date().toISOString(), ...report, diffs };
  await writeFile(path.join(OUT_DIR, 'results.json'), JSON.stringify(out, null, 2));

  console.log('\narm                        backend          ms   draws   tris  programs  devErrs');
  for (const a of report.arms ?? []) {
    console.log(
      `  ${a.arm.padEnd(25)} ${String(a.backend).padEnd(15)} `
      + `${a.ms.toFixed(1).padStart(5)} ${String(a.drawCalls).padStart(6)} `
      + `${String(a.triangles).padStart(6)} ${String(a.programs).padStart(9)} `
      + `${String(a.deviceErrors?.length ?? 0).padStart(8)}`,
    );
  }

  /*
   * THE COLUMN THAT DECIDES WHETHER ANY PIXEL NUMBER BELOW MEANS ANYTHING. A
   * WebGPU validation error invalidates the whole command buffer, so an arm that
   * raised one rendered NOTHING and its diff is a measurement of a blank canvas.
   */
  let invalid = 0;
  for (const a of report.arms ?? []) {
    for (const e of a.deviceErrors ?? []) {
      invalid++;
      console.log(`  ! ${a.arm}: ${String(e).split('\n')[0]}`);
    }
  }
  if (invalid > 0) {
    console.log(
      '  ^ an arm with device errors drew nothing; read its diff as "blank", not as "different".',
    );
  }

  console.log('\ndiff vs glsl-webgl (the CORRECT picture)');
  for (const [arm, d] of Object.entries(diffs)) {
    console.log(
      `  ${arm.padEnd(34)} ${(d.changed * 100).toFixed(3)}% changed, `
      + `${(d.strong * 100).toFixed(3)}% over 8/255, ${(d.darker * 100).toFixed(3)}% darker, `
      + `max ${d.maxDelta}, mean ${d.meanDelta.toFixed(3)}`,
    );
  }

  /*
   * THE CONTROL, CHECKED RATHER THAN PRINTED AND FORGOTTEN. `glsl-webgl-nodepth`
   * is the SAME renderer as the reference with the custom depth materials taken
   * away — the defect, reproduced where nothing else can be blamed for it. If it
   * comes back small the camera is not looking at the shadow, and no row above
   * means anything.
   */
  const control = diffs['glsl-webgl-nodepth'];
  if (control && control.darker < 0.01) {
    console.error(
      `\nCONTROL FAILED: dropping customDepthMaterial on the SHIPPING renderer `
      + `darkened only ${(control.darker * 100).toFixed(3)}% of pixels. The frame `
      + `is not showing the shadow this probe exists to measure; ignore every `
      + `number above.`,
    );
    exitCode = 1;
  }

  /*
   * AND THE BACKEND, because `navigator.gpu` plus a real adapter is not
   * evidence. A `webgl2-fallback` here means both node arms answered a question
   * about `WebGLBackend`, which is a different renderer with a different shadow
   * path from the one the migration is heading for.
   */
  for (const a of report.arms ?? []) {
    if (a.arm.startsWith('tsl-') && a.backend !== 'webgpu') {
      console.error(
        `\nBACKEND FAILED: ${a.arm} ran on ${a.backend}, not WebGPU. Re-run with `
        + `--channel chrome on a machine with a real device; the node rows above `
        + `describe the WebGL2 fallback.`,
      );
      exitCode = 1;
    }
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

/**
 * ============================================================================
 * VOLTMARCH — tools/cameo-readback-probe.mjs
 * ============================================================================
 * DOES THE NODE RENDERER HAND ITS PIXELS BACK THE SAME WAY UP AS WEBGL?
 *
 *   node tools/cameo-readback-probe.mjs [--port 5307] [--headed]
 *
 * `src/ui/Cameos.ts` blits a render target onto a 2D canvas, and its blit has
 * flipped the rows since it was written because *"GL reads bottom-up"*. That is
 * true of `gl.readPixels` and it is NOT true of `copyTextureToBuffer`, which is
 * what the node renderer's `readRenderTargetPixelsAsync` uses. Two other things
 * differ with it: the WebGPU copy pads every row out to 256 bytes, and the
 * element type of the array follows the target's GPU format.
 *
 * NONE OF THAT IS PROVABLE FROM A UNIT TEST. `tests/cameo-readback.spec.ts`
 * proves the blitter does what it is told; only a device can say what it is
 * being told. So this renders a picture that is a DIFFERENT COLOUR IN ALL FOUR
 * CORNERS, reads it back through both renderers, runs the shipped
 * `src/render/backend.ts` helpers over the bytes, and requires the corners to
 * come out where they went in.
 *
 * THE WEBGL ARM IS THE CONTROL AND IT IS LOAD-BEARING. `RENDER_FINDINGS.md` §6c
 * records two investigations that reported a clean zero on every row including
 * the control, which is the signature of a dead instrument rather than a
 * finding. If WebGL does not come back bottom-up, tight and sRGB-encoded — the
 * three facts the shipping path has always depended on — the WebGPU column is
 * not evidence of anything and this exits non-zero.
 *
 * THE PORT IS OWNED, NOT PROBED, for the reason `tools/shoot.mjs` records at
 * length: a fixed port guarded by a `fetch` probe let the shot harness
 * photograph a NEIGHBOURING WORKTREE'S BUILD and print `ok`. `server.listen()`
 * either binds or throws, and every worktree here runs the same tools.
 *
 * `channel: 'chrome'` IS ALSO LOAD-BEARING (`RENDER_FINDINGS.md` §7c):
 * Playwright's bundled Chromium cannot load `dxil.dll` on this platform and
 * takes three's WebGL2 fallback while still reporting `navigator.gpu` and a
 * real adapter. The page reads `renderer.backend.isWebGPUBackend` through
 * `liveBackendOf` and refuses to report numbers under the wrong one.
 * ============================================================================
 */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGE_DIR = path.join(HERE, 'cameo-readback-probe');
const OUT_DIR = path.join(PAGE_DIR, 'out');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const START_PORT = Number(opt('--port', '5307'));
const HEADED = flag('--headed');

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
    try {
      await new Promise((ok, bad) => {
        server.once('error', bad);
        server.listen(port, '127.0.0.1', () => { server.off('error', bad); ok(); });
      });
      return { server, origin: `http://127.0.0.1:${port}` };
    } catch (e) {
      if (e?.code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error('no free port');
}

/** sRGB byte triple of a 0xRRGGBB literal — what the readback should contain. */
function bytesOf(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

function near(a, b, tol) {
  return Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;
}

function show(s) {
  return s === undefined ? '—' : `${String(s.r).padStart(3)},${String(s.g).padStart(3)},${String(s.b).padStart(3)}`;
}

await bundle();
const { server, origin } = await serve(START_PORT);
console.log(`serving ${PAGE_DIR} at ${origin}`);

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
  const page = await browser.newPage({ viewport: { width: 640, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__probe !== undefined || window.__probeError !== undefined,
    null,
    { timeout: 60_000 },
  );
  const failed = await page.evaluate(() => window.__probeError ?? null);
  if (failed !== null) throw new Error(failed);
  const result = await page.evaluate(() => window.__probe);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'results.json'), JSON.stringify(result, null, 2));

  const expect = Object.fromEntries(
    Object.entries(result.expected).map(([k, v]) => [k, bytesOf(v)]),
  );
  const names = Object.keys(expect);

  console.log(`\ntarget ${result.width}x${result.height}  (a 74x58 build slot at supersample 2)`);
  console.log(`row of pixels ${result.width * 4} B, 256-aligned stride ${Math.ceil(result.width * 4 / 256) * 256} B\n`);

  for (const arm of result.arms) {
    console.log(`── ${arm.arm}  (live: ${arm.live})`);
    if (!arm.ok) {
      console.log(`   FAILED: ${arm.error}\n`);
      exitCode = 1;
      continue;
    }
    console.log(`   buffer      ${arm.raw.constructor}, ${arm.raw.byteLength} B  ` +
      `(tight ${arm.raw.tightLength}, aligned ${arm.raw.alignedLength})`);
    console.log(`   derived     stride ${arm.derived.stride} B, rows ${arm.derived.rowOrder}`);
    console.log(`   first texel ${arm.raw.firstTexel.join(',')}`);
    let armOk = true;
    for (const n of names) {
      // 8/255 covers the plane edges and any dithering; the wrong corner is
      // hundreds of levels away, so this cannot pass by accident.
      const ok = near(arm.samples[n], expect[n], 8);
      if (!ok) armOk = false;
      console.log(
        `   ${ok ? 'ok  ' : 'BAD '} ${n.padEnd(12)} got ${show(arm.samples[n])}` +
        `   want ${show(expect[n])}   (flipped: ${show(arm.wrongWay[n])})`,
      );
    }
    // The contrast that makes the corner check mean something: blitting the
    // OTHER way round must produce a DIFFERENT picture. If it does not, the
    // image is symmetric and the probe is measuring nothing.
    const distinguishes = names.some((n) => !near(arm.samples[n], arm.wrongWay[n], 8));
    console.log(`   ${distinguishes ? 'ok  ' : 'BAD '} the two row orders give different pictures`);
    if (!distinguishes || !armOk) exitCode = 1;
    console.log('');
  }

  // Two cameos share one render target every frame at perFrameBudget 2, so a
  // copy that is not ordered against its render puts the wrong unit in a slot.
  const il = result.interleave;
  console.log('── interleave  (two renders, two overlapping reads, one target)');
  if (!il.ok) {
    console.log(`   FAILED: ${il.error}\n`);
    exitCode = 1;
  } else {
    const wantA = bytesOf(il.wantFirst);
    const wantB = bytesOf(il.wantSecond);
    const okA = near(il.first, wantA, 8);
    const okB = near(il.second, wantB, 8);
    console.log(`   ${okA ? 'ok  ' : 'BAD '} first read  got ${show(il.first)}   want ${show(wantA)}`);
    console.log(`   ${okB ? 'ok  ' : 'BAD '} second read got ${show(il.second)}   want ${show(wantB)}`);
    if (!okA || !okB) exitCode = 1;
    console.log('');
  }

  const gl = result.arms.find((a) => a.arm === 'webgl');
  if (gl?.ok !== true || gl.derived.rowOrder !== 'bottom-up' || gl.derived.stride !== result.width * 4) {
    console.log('CONTROL FAILED: the WebGL arm did not come back bottom-up and tight.');
    console.log('Nothing in the WebGPU column is evidence until it does.');
    exitCode = 1;
  }
  if (errors.length > 0) {
    console.log('page errors:', errors);
    exitCode = 1;
  }
  console.log(exitCode === 0 ? 'PROBE OK' : 'PROBE FAILED');
} catch (e) {
  console.error(String(e));
  exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

process.exit(exitCode);

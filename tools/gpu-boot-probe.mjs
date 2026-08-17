/**
 * GPU BOOT PROBE — does the REAL GAME boot and draw on a given backend?
 *
 *   node tools/gpu-boot-probe.mjs --gpu=webgpu [--shot=01-establishing-base] [--headed]
 *
 * `tools/shoot.mjs` is the capture harness and reports one line when a page
 * fails to reach `window.__VM.ready`. This is the diagnostic underneath it: one
 * page, every console message and page error printed in order, the live backend
 * read off the handle, and one frame's `stats()` — so "it did not boot" becomes
 * a stack trace instead of a timeout.
 *
 * It serves the EXISTING `dist/` through `tools/lib/serve.mjs`, which reads the
 * port back from its own child and byte-compares the served `index.html` against
 * the `dist/` on this disk. A fixed port is how this repo photographed another
 * checkout's build; see the header of `tools/lib/serve.mjs`.
 *
 * ONE BROWSER, closed on every exit path. `channel: 'chrome'` for the node path,
 * because Playwright's bundled Chromium cannot create a WebGPU device here —
 * Dawn fails to load `dxil.dll` with Windows error 87 and `WebGPURenderer` takes
 * its WebGL2 fallback behind a single `console.warn`. See
 * `docs/RENDER_FINDINGS.md` §7c.
 */

import { chromium } from 'playwright';
import { serve } from './lib/serve.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
const GPU = (arg('gpu', 'webgl') || 'webgl').toLowerCase();
const SHOT = arg('shot', '01-establishing-base');
const OUTPNG = arg('png', '');
const SEED = Number(arg('seed', '7'));
/** Sim ticks to advance before the shutter — the fixtures' `settleTicks`. */
const TICKS = Number(arg('ticks', '0'));
const DIST = Number(arg('dist', '62'));
const NOPOST = argv.includes('--nopost');
const OFF = (arg('off','') || '').split(',').filter(Boolean);
const headed = argv.includes('--headed');

const server = await serve({ root: ROOT, mode: 'preview', portHint: 4361, log: console.log });
let browser = null;
let code = 0;

try {
  browser = await chromium.launch({
    headless: !headed,
    ...(GPU === 'webgpu' ? { channel: 'chrome' } : {}),
    args: [
      '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio',
      '--force-device-scale-factor=1',
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180_000);
  const log = [];
  page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.stack ?? e.message}`));

  const qs = new URLSearchParams({ shot: SHOT, tier: 'medium', seed: String(SEED) });
  if (GPU === 'webgpu') qs.set('gpu', 'webgpu');
  const url = `${server.origin}?${qs}`;
  console.log(`> ${url}`);
  await page.goto(url, { waitUntil: 'load' });

  let booted = true;
  try {
    await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 90_000 });
    await page.evaluate(() => window.__VM.ready());
    /*
     * WAIT FOR THE CURTAIN, NOT JUST FOR `ready()`.
     *
     * `__VM.ready()` resolves when `registry.init()` has; the SCENARIO — and
     * therefore every entity, every structure and the terrain mesh — is seeded
     * afterwards, by `main.ts` calling `game.start()` and running the boot
     * paint. Measuring at `ready()` measured an empty scene: 23 draw calls, 1
     * entity, 11 189 triangles against the 149 / 865 353 a real fixture has.
     * `tools/shoot.mjs` waits on `#loading` for exactly this reason and calls
     * a visible curtain at the shutter a refusal.
     */
    await page.waitForFunction(() => {
      const c = document.getElementById('loading');
      return c === null || c.hidden === true;
    }, null, { timeout: 120_000 });
  } catch (err) {
    booted = false;
    console.error(`\n!! did not reach __VM.ready: ${err.message}`);
    code = 2;
  }

  if (booted) {
    const info = await page.evaluate(async ({ ticks, dist, noPost, off }) => {
      const vm = window.__VM;
      vm.setUiVisible(false);
      vm.focusOn(256, 256, dist);
      if (noPost) vm.post.setEnabled(false);
      for (const id of off) vm.post.setPassEnabled(id, false);
      if (ticks > 0) await vm.advanceTicks(ticks);
      await vm.waitFrames(4);
      const s = vm.stats();
      const scene = vm.scene;
      const lights = [];
      scene.traverse((o) => {
        if (o.isLight) lights.push({ type: o.type, intensity: o.intensity, visible: o.visible });
      });
      return {
        backend: vm.rendererHandle.backend,
        webglHandleIsNull: vm.renderer === null,
        gpu: vm.rendererHandle.capabilities.gpu,
        env: scene.environment === null ? null : (scene.environment.name || 'pmrem'),
        envIntensity: scene.environmentIntensity,
        toneMapping: vm.rendererHandle.backend === 'webgl' ? vm.renderer.toneMapping : -1,
        lights,
        stats: s,
      };
    }, { ticks: TICKS, dist: DIST, noPost: NOPOST, off: OFF });
    console.log('\n--- live ------------------------------------------------');
    console.log(JSON.stringify(info, null, 2));
    if (GPU === 'webgpu' && info.backend !== 'webgpu') {
      console.error(`\n!! asked for webgpu, live backend is '${info.backend}'`);
      code = 3;
    }
    if (OUTPNG) {
      // THROUGH `__VM.screenshot()`, not `page.screenshot()`: the loading
      // curtain is a DOM overlay and a page screenshot photographs IT. The
      // handle renders one complete frame and reads the canvas back, which is
      // what `tools/shoot.mjs` does for the same reason.
      const dataUrl = await page.evaluate(async () => {
        window.__VM.setUiVisible(false);
        await window.__VM.waitFrames(2);
        return window.__VM.screenshot();
      });
      writeFileSync(OUTPNG, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`> wrote ${OUTPNG}`);
    }
  }

  console.log('\n--- console ---------------------------------------------');
  for (const line of log) console.log(line);
  console.log(`--- ${log.length} message(s) ---`);
} finally {
  await browser?.close();
  server.stop();
}

process.exit(code);

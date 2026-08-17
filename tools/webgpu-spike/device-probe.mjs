/**
 * SPIKE INSTRUMENT — does Chromium give us a real WebGPU DEVICE, and under
 * which launch flags?
 *
 * This exists because the first run of the spike found the trap §4.1 predicted,
 * in a nastier form than predicted: `navigator.gpu` is present, and
 * `requestAdapter()` returns a REAL, non-fallback AMD adapter with a full
 * feature list — and `requestDevice()` then fails, after which
 * `WebGPURenderer` silently continues on its WebGL2 backend behind a single
 * `warn()`. Every cheap check ("is navigator.gpu there?", "did the renderer
 * construct?", "did we get an adapter?") answers YES on a page that is not
 * running WebGPU at all.
 *
 *   node tools/webgpu-spike/device-probe.mjs [--headed]
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';

const HEADED = process.argv.includes('--headed');

/**
 * WebGPU IS GATED ON A SECURE CONTEXT, and `data:` URLs are not one — the first
 * version of this probe ran off a `data:` URL and reported `no navigator.gpu`
 * for all eight flag sets, which would have been a confident wrong answer about
 * the flags. `http://127.0.0.1` is "potentially trustworthy" and is a fair
 * stand-in for how `tools/shoot.mjs` serves the bundle.
 */
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end('<!doctype html><meta charset=utf-8><canvas id=c></canvas>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${server.address().port}/`;

const COMMON = [
  '--hide-scrollbars',
  '--mute-audio',
  '--force-device-scale-factor=1',
];

/** The launch postures worth trying, cheapest and most shoot.mjs-like first. */
const SETS = [
  { name: 'shoot.mjs args only', args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] },
  { name: 'shoot.mjs + unsafe-webgpu', args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU'] },
  { name: 'unsafe-webgpu, no angle override', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--enable-unsafe-webgpu'] },
  { name: 'unsafe-webgpu + Vulkan', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan'] },
  { name: 'unsafe-webgpu + angle=vulkan + Vulkan', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--enable-unsafe-webgpu', '--use-angle=vulkan', '--enable-features=Vulkan'] },
  { name: 'unsafe-webgpu + d3d12 adapter', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--enable-unsafe-webgpu', '--use-webgpu-adapter=d3d12'] },
  { name: 'unsafe-webgpu + swiftshader adapter', args: ['--enable-gpu', '--disable-gpu-sandbox', '--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] },
  { name: 'unsafe-webgpu + no sandbox at all', args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan'] },
];

async function probe(set) {
  let browser;
  try {
    browser = await chromium.launch({ headless: !HEADED, args: [...COMMON, ...set.args] });
  } catch (e) {
    return { ...set, launch: 'failed', error: String(e).split('\n')[0] };
  }
  const page = await browser.newPage();
  await page.goto(PAGE);
  const r = await page.evaluate(async () => {
    const out = { gpu: !!navigator.gpu };
    if (!navigator.gpu) return out;
    try {
      const ad = await navigator.gpu.requestAdapter();
      out.adapter = !!ad;
      if (!ad) return out;
      out.isFallbackAdapter = ad.isFallbackAdapter === true;
      out.adapterInfo = ad.info
        ? [ad.info.vendor, ad.info.architecture, ad.info.device, ad.info.description].filter(Boolean).join('/')
        : '(none)';
      try {
        const dev = await ad.requestDevice();
        out.device = !!dev;
        // A device is not proof of a usable canvas — check the swap chain too.
        const c = document.getElementById('c');
        const ctx = c.getContext('webgpu');
        out.canvasContext = !!ctx;
        if (ctx) {
          ctx.configure({ device: dev, format: navigator.gpu.getPreferredCanvasFormat() });
          out.configured = true;
        }
      } catch (e) {
        out.device = false;
        out.deviceError = String(e);
      }
    } catch (e) {
      out.adapter = false;
      out.adapterError = String(e);
    }
    return out;
  });
  // Chromium reports the real reason on the console, not in the rejection.
  const gpuInfo = await page.evaluate(() => null).catch(() => null);
  await browser.close();
  return { ...set, ...r, gpuInfo };
}

console.log(`WebGPU device probe — headless=${!HEADED}\n`);
for (const set of SETS) {
  const r = await probe(set);
  const verdict = r.configured
    ? 'REAL WEBGPU'
    : r.device
      ? 'device but no canvas context'
      : r.adapter
        ? 'adapter only — device FAILED'
        : r.gpu
          ? 'navigator.gpu but no adapter'
          : 'no navigator.gpu';
  console.log(`  ${set.name.padEnd(38)} ${verdict}`);
  console.log(`      ${JSON.stringify({ ...r, name: undefined, args: undefined })}`);
}

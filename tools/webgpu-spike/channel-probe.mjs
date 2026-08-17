/**
 * SPIKE INSTRUMENT — which BROWSER BINARY gives a real WebGPU device?
 *
 * `device-probe.mjs` established that flags are not the variable: on every flag
 * set except the software one, Playwright's bundled Chromium enumerates a real
 * AMD adapter and then fails `requestDevice()` with
 *
 *     DynamicLib.Open: dxil.dll Windows Error: 87
 *       at EnsureDXCLibraries (third_party/dawn/.../PlatformFunctionsD3D12.cpp:212)
 *
 * `dxil.dll` and `dxcompiler.dll` ARE present in that Chromium's own directory,
 * so this is a DLL SEARCH PATH failure inside Dawn's D3D12 backend, not a
 * missing file and not a headless limitation. Error 87 is
 * ERROR_INVALID_PARAMETER, which is what a bare-name `LoadLibrary` returns once
 * Chromium's launcher has restricted the default DLL directories.
 *
 * So the question becomes: is this specific to Playwright's build? Real Chrome
 * and real Edge are both installed on this machine and both ship the same two
 * DLLs. This probe answers it, headless and headed, per binary.
 *
 *   node tools/webgpu-spike/channel-probe.mjs
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end('<!doctype html><meta charset=utf-8><canvas id=c></canvas>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${server.address().port}/`;

const ARGS = [
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--disable-gpu-sandbox',
  '--enable-unsafe-webgpu',
  '--hide-scrollbars',
  '--mute-audio',
  '--force-device-scale-factor=1',
];

const CASES = [];
for (const channel of [undefined, 'chrome', 'msedge']) {
  for (const headless of [true, false]) {
    CASES.push({ channel: channel ?? '(playwright chromium)', launch: { channel, headless, args: ARGS } });
  }
}

async function probe(c) {
  let browser;
  try {
    browser = await chromium.launch(c.launch);
  } catch (e) {
    return { launched: false, error: String(e).split('\n')[0] };
  }
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  await page.goto(PAGE);
  const r = await page.evaluate(async () => {
    const out = { gpu: !!navigator.gpu };
    if (!navigator.gpu) return out;
    const ad = await navigator.gpu.requestAdapter().catch((e) => ({ err: String(e) }));
    if (!ad || ad.err) return { ...out, adapter: false, adapterError: ad && ad.err };
    out.adapter = ad.info
      ? [ad.info.vendor, ad.info.architecture, ad.info.device].filter(Boolean).join('/')
      : '(no info)';
    try {
      const dev = await ad.requestDevice();
      const ctx = document.getElementById('c').getContext('webgpu');
      ctx.configure({ device: dev, format: navigator.gpu.getPreferredCanvasFormat() });
      out.device = true;
      // Prove the device can actually do work, not merely exist.
      const enc = dev.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: ctx.getCurrentTexture().createView(),
            clearValue: { r: 0.2, g: 0.4, b: 0.8, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.end();
      dev.queue.submit([enc.finish()]);
      await dev.queue.onSubmittedWorkDone();
      out.submitted = true;
    } catch (e) {
      out.device = false;
      out.deviceError = String(e).split('\n')[0];
    }
    return out;
  });
  await browser.close();
  return { launched: true, ...r, logs: logs.slice(0, 3) };
}

console.log('WebGPU per-binary probe\n');
for (const c of CASES) {
  const r = await probe(c);
  const verdict = !r.launched
    ? 'LAUNCH FAILED'
    : r.submitted
      ? 'REAL WEBGPU, work submitted'
      : r.device
        ? 'device, but no submit'
        : r.adapter
          ? 'adapter only — device FAILED'
          : 'no adapter';
  console.log(`  ${String(c.channel).padEnd(24)} headless=${String(c.launch.headless).padEnd(5)}  ${verdict}`);
  console.log(`      ${JSON.stringify({ ...r, logs: undefined })}`);
}
server.close();

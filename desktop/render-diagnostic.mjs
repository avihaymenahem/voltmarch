/**
 * Real Electron presentation regression test.
 *
 * Launches the desktop shell against the live Vite server, moves the camera
 * without simulation input, and proves that the BrowserWindow's presented
 * pixels changed. It also captures the engine-owned framebuffer so a frozen
 * compositor can be distinguished from a frozen renderer. This is the final
 * gate for the "input and simulation move, but the 3D canvas is frozen" class
 * of WebGPU failures: typed-array unit tests cover known causes, while this
 * test rejects any validation error or stale presented frame end-to-end.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'meshy_output', 'desktop-render-diagnostic');
const rootRequire = createRequire(path.join(ROOT, 'package.json'));
const deskRequire = createRequire(path.join(HERE, 'package.json'));
const { _electron: electron } = rootRequire('playwright');
const electronExe = deskRequire('electron');

const backend = process.argv.includes('--webgl') ? 'webgl' : 'webgpu';
const args = [
  '.',
  '--vm-dev=http://localhost:5173',
  ...(backend === 'webgpu' ? ['--webgpu'] : []),
  '--vm-map=arid',
  '--vm-biome=desert',
  '--vm-seed=7',
  '--vm-mapseed=3910129',
  '--vm-fog=off',
  '--vm-skipmenu=1',
];

await fs.mkdir(OUT, { recursive: true });
const app = await electron.launch({ args, cwd: HERE, executablePath: electronExe });
const page = await app.firstWindow();
const messages = [];
page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => messages.push(`pageerror: ${error.stack ?? error.message}`));

try {
  // Bypass shell/startup redirects: this probe is about frame presentation,
  // so use the same deterministic close fixture as the browser art gate.
  await page.goto(
    `http://localhost:5173/?shot=sledge-audit&seed=7&fog=off&gpu=${backend}`,
    { waitUntil: 'domcontentloaded' },
  );
  console.log(`[desktop-render] window=${await page.title()} url=${page.url()}`);
  await page.waitForFunction(() => window.__VM !== undefined, null, { timeout: 60_000 });
  await page.evaluate(() => window.__VM.ready());
  await page.waitForFunction(
    () => (window.__VM?.stats().counters.entities ?? 0) > 0,
    null,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(1_000);

  const before = await page.evaluate(() => ({
    pose: { ...window.__VM.getCameraPoseDeg() },
    gpu: window.__VM.gpuInfo(),
    stats: window.__VM.stats(),
  }));
  const beforePath = path.join(OUT, `${backend}-before.png`);
  const afterPath = path.join(OUT, `${backend}-after.png`);
  const enginePath = path.join(OUT, `${backend}-engine.png`);
  const beforePng = await page.screenshot({ path: beforePath });

  const requested = { x: before.pose.x + 12, z: before.pose.z + 7 };
  await page.evaluate((pose) => window.__VM.setCameraPose({ ...pose, immediate: true }), requested);
  await page.waitForTimeout(1_000);
  const actual = await page.evaluate(() => ({ ...window.__VM.getCameraPoseDeg() }));
  const afterPng = await page.screenshot({ path: afterPath });

  const engineBytes = await page.evaluate(async () => Array.from(await window.__VM.screenshot()));
  await fs.writeFile(enginePath, Buffer.from(engineBytes));

  const changedBytes = (() => {
    const length = Math.min(beforePng.length, afterPng.length);
    let changed = Math.abs(beforePng.length - afterPng.length);
    for (let i = 0; i < length; i++) if (beforePng[i] !== afterPng[i]) changed++;
    return changed;
  })();

  const result = {
    backend,
    before,
    requested,
    actual,
    changedBytes,
    presentedFrameChanged: changedBytes > 500,
    files: { beforePath, afterPath, enginePath },
    messages: messages.filter((line) => /error|warn|fail|device|pipeline|shader/i.test(line)),
  };
  const fatalMessages = result.messages.filter((line) => (
    /GPUValidationError|validation error|Invalid (?:CommandBuffer|RenderPipeline|ShaderModule)|pipeline creation failed|pageerror/i
      .test(line)
  ));
  const cameraMoved = Math.abs(actual.x - requested.x) < 0.01
    && Math.abs(actual.z - requested.z) < 0.01;
  const liveBackend = before.gpu?.live === backend;
  const passed = result.presentedFrameChanged
    && cameraMoved
    && liveBackend
    && fatalMessages.length === 0;
  Object.assign(result, { cameraMoved, liveBackend, fatalMessages, passed });
  console.log(JSON.stringify(result, null, 2));
  if (!passed) process.exitCode = 1;
} catch (error) {
  const failurePath = path.join(OUT, `${backend}-failure.png`);
  await page.screenshot({ path: failurePath }).catch(() => undefined);
  console.error(JSON.stringify({
    backend,
    title: await page.title().catch(() => ''),
    url: page.url(),
    failurePath,
    messages,
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  await app.close();
}

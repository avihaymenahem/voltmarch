import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAssetLabDevServer } from './lib/asset-lab-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DESKTOP = path.join(ROOT, 'apps', 'desktop');
const OUT = path.join(ROOT, 'meshy_output', 'infantry-poc');
const rootRequire = createRequire(path.join(ROOT, 'package.json'));
const desktopRequire = createRequire(path.join(DESKTOP, 'package.json'));
const { _electron: electron } = rootRequire('playwright');
const electronExe = desktopRequire('electron');

const backend = process.argv.includes('--webgpu') ? 'webgpu' : 'webgl';
const countArg = process.argv.find((arg) => arg.startsWith('--count='));
const requestedCount = Number(countArg?.slice('--count='.length) ?? '48');
const count = Number.isFinite(requestedCount) ? Math.max(1, Math.min(512, Math.round(requestedCount))) : 48;
const factionArg = process.argv.find((arg) => arg.startsWith('--faction='));
const supportedFactions = new Set(['allies', 'soviets', 'meridian', 'reclamation']);
const requestedFaction = factionArg?.slice('--faction='.length);
const faction = supportedFactions.has(requestedFaction) ? requestedFaction : 'allies';
const unitArg = process.argv.find((arg) => arg.startsWith('--unit='));
const unit = unitArg?.slice('--unit='.length);
const server = await startAssetLabDevServer(ROOT, 'infantry');
const url = new URL(`infantry.html?gpu=${backend}&count=${count}&faction=${faction}${unit ? `&unit=${unit}` : ''}`, server.origin).href;
await fs.mkdir(OUT, { recursive: true });
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voltmarch-infantry-smoke-'));

const app = await electron.launch({
  // Isolate the smoke runner from a developer's open Asset Lab desktop. Electron's
  // single-instance lock is scoped to userData; sharing it makes a healthy test
  // process exit before Playwright can attach and looks like a renderer crash.
  args: [`--user-data-dir=${userDataDir}`, '.', `--vm-dev=${server.origin}`, `--vm-gpu=${backend}`],
  cwd: DESKTOP,
  executablePath: electronExe,
});
const page = await app.firstWindow();
const messages = [];
page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => messages.push(`pageerror: ${error.stack ?? error.message}`));

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const status = document.querySelector('#status')?.textContent ?? '';
    return status === 'Ready' || /error|device lost|TypeError/i.test(status);
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(2_000);
  const readMetrics = () => page.evaluate(() => ({
    status: document.querySelector('#status')?.textContent,
    backend: document.querySelector('#backend')?.textContent,
    geometry: document.querySelector('#geometry')?.textContent,
    rig: document.querySelector('#rig')?.textContent,
    mode: document.querySelector('#mode')?.textContent,
    activeClip: document.querySelector('#active-clip')?.textContent,
    drawCalls: document.querySelector('#draw-calls')?.textContent,
    frameTime: document.querySelector('#frame-time')?.textContent,
    faction: document.querySelector('#faction')?.value,
    unit: document.querySelector('#unit')?.value,
  }));
  const states = [];
  const clipScreenshots = [];
  let singleScreenshot = null;
  for (const mode of ['army', 'single']) {
    await page.click(`[data-mode="${mode}"]`);
    for (const clip of ['tpose', 'walk', 'run', 'runShoot']) {
      await page.click(`[data-clip="${clip}"]`);
      await page.waitForTimeout(350);
      states.push({ requestedMode: mode, requestedClip: clip, ...(await readMetrics()) });
      if (mode === 'single' && unit === 'attack-dog') {
        const clipScreenshot = path.join(OUT, `attack-dog-${backend}-${clip}.png`);
        await page.screenshot({ path: clipScreenshot });
        clipScreenshots.push(clipScreenshot);
      }
      if (mode === 'single' && clip === 'runShoot') {
        singleScreenshot = path.join(OUT, `shared-pose-${faction}-${backend}-single.png`);
        await page.screenshot({ path: singleScreenshot });
      }
    }
  }
  await page.click('[data-mode="army"]');
  await page.click('[data-clip="runShoot"]');
  await page.waitForTimeout(350);
  const metrics = await readMetrics();
  const screenshot = path.join(OUT, `shared-pose-${faction}-${backend}.png`);
  await page.screenshot({ path: screenshot });
  const fatalMessages = messages.filter((line) => (
    /GPUValidationError|DXGI_ERROR|device lost|pageerror|TypeError|ReferenceError/i.test(line)
  ));
  const stateFailures = states.filter((state) => (
    state.status !== 'Ready' ||
    !state.mode?.toLowerCase().startsWith(state.requestedMode === 'army' ? 'army formation' : 'single ') ||
    !state.activeClip
  ));
  const passed = metrics.status === 'Ready' && metrics.faction === faction
    && (!unit || metrics.unit === unit)
    && fatalMessages.length === 0 && stateFailures.length === 0;
  console.log(JSON.stringify({
    faction, unit: unit ?? metrics.unit, backend, url, metrics, states, screenshot, singleScreenshot, clipScreenshots,
    fatalMessages, stateFailures, passed,
  }, null, 2));
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await app.close();
  server.stop();
  await fs.rm(userDataDir, { recursive: true, force: true });
}

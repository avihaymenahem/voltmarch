import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAssetLabDevServer } from './lib/asset-lab-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = path.join(ROOT, 'apps', 'desktop');
const rootRequire = createRequire(path.join(ROOT, 'package.json'));
const desktopRequire = createRequire(path.join(DESKTOP, 'package.json'));
const { _electron: electron } = rootRequire('playwright');
const electronExe = desktopRequire('electron');
const ownedServer = process.env.VM_ASSET_LAB_ORIGIN ? null : await startAssetLabDevServer(ROOT);
const origin = process.env.VM_ASSET_LAB_ORIGIN ?? ownedServer.origin;
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voltmarch-asset-lab-smoke-'));
const app = await electron.launch({
  // The developer may already have Asset Lab open. Give the smoke process its
  // own Electron single-instance scope so a healthy desktop does not make this
  // test exit before Playwright attaches.
  args: [`--user-data-dir=${userDataDir}`, '.', `--vm-dev=${origin}`, '--vm-gpu=webgpu'],
  cwd: DESKTOP,
  executablePath: electronExe,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    errors.push(message.text());
    console.error(`[asset-lab-smoke] browser console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    errors.push(error.stack ?? error.message);
    console.error(`[asset-lab-smoke] page error: ${error.stack ?? error.message}`);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    console.error(`[asset-lab-smoke] HTTP ${response.status()}: ${response.url()}`);
  });
  await page.goto(new URL('?gpu=webgpu', origin).href, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const summary = await page.evaluate(() => ({
    backend: document.querySelector('#backend')?.textContent,
    families: Number(document.querySelector('#family-total')?.textContent),
    files: Number(document.querySelector('#file-total')?.textContent),
  }));
  if (summary.backend !== 'WEBGPU · PRIMARY') throw new Error(`Wrong backend: ${summary.backend}`);
  if (summary.families < 87 || summary.files < 352) throw new Error(`Incomplete catalog: ${JSON.stringify(summary)}`);

  const samples = [
    'Buildings/allies/war-factory',
    'Buildings/soviets/tesla-coil',
    'Buildings/meridian/conclave',
    'Buildings/reclamation/foundry',
    'Units/soviets/attack-dog',
    'Units/reclamation/swarmhornet',
    'Wrecks/neutral/vehicle-wreck',
  ];
  const audits = [];
  for (const id of samples) {
    await page.evaluate((assetId) => document.querySelector(`[data-asset-id="${CSS.escape(assetId)}"]`)?.click(), id);
    await waitReady(page);
    await page.waitForTimeout(650);
    audits.push(await page.evaluate(() => ({
      title: document.querySelector('#asset-title')?.textContent,
      status: document.querySelector('#status')?.textContent,
      triangles: document.querySelector('#metric-triangles')?.textContent,
      frame: document.querySelector('#metric-frame')?.textContent,
    })));
  }

  // Exercise the compressed KTX2 path, not only the uncompressed review source.
  await page.evaluate(() => document.querySelector('[data-asset-id="Buildings/reclamation/foundry"]')?.click());
  await waitReady(page);
  const runtimeValue = await page.evaluate(() => [...document.querySelectorAll('#variant-select option')]
    .find((option) => option.textContent?.includes('Runtime · KTX2'))?.value);
  if (!runtimeValue) throw new Error('The selected family did not expose its runtime KTX2 delivery.');
  await page.selectOption('#variant-select', runtimeValue);
  await waitReady(page);
  if (errors.length) throw new Error(`Asset Lab emitted errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ summary, audits, compressed: await page.textContent('#status') }, null, 2));
} finally {
  await app.close();
  ownedServer?.stop();
  await fs.rm(userDataDir, { recursive: true, force: true });
}

async function waitReady(page) {
  let previous = '';
  for (let elapsed = 0; elapsed < 180_000; elapsed += 1_000) {
    const status = await page.textContent('#status').catch(() => '');
    if (status !== previous) {
      console.log(`[asset-lab-smoke] ${status || 'waiting for status element'}`);
      previous = status;
    }
    if (status?.startsWith('Ready')) return;
    if (errors.length) throw new Error(`Asset Lab emitted errors:\n${errors.join('\n')}`);
    if (/could not|failed|device lost|fatal/i.test(status ?? '')) throw new Error(status);
    await page.waitForTimeout(1_000);
  }
  throw new Error(`Asset Lab did not become ready after 180 seconds; last status: ${previous || '(none)'}`);
}

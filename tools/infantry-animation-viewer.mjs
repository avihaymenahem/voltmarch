import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAssetLabDevServer } from './lib/asset-lab-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DESKTOP = path.join(ROOT, 'apps', 'desktop');
const rootRequire = createRequire(path.join(ROOT, 'package.json'));
const desktopRequire = createRequire(path.join(DESKTOP, 'package.json'));
const { _electron: electron } = rootRequire('playwright');
const electronExe = desktopRequire('electron');

const countArg = process.argv.find((arg) => arg.startsWith('--count='));
const requestedCount = Number(countArg?.slice('--count='.length) ?? '48');
const count = Number.isFinite(requestedCount) ? Math.max(1, Math.min(512, Math.round(requestedCount))) : 48;
const factionArg = process.argv.find((arg) => arg.startsWith('--faction='));
const supportedFactions = new Set(['allies', 'soviets', 'meridian', 'reclamation']);
const requestedFaction = factionArg?.slice('--faction='.length);
const faction = supportedFactions.has(requestedFaction) ? requestedFaction : 'allies';
const unitArg = process.argv.find((arg) => arg.startsWith('--unit='));
const unit = unitArg?.slice('--unit='.length);
const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = modeArg?.slice('--mode='.length) === 'single' ? 'single' : 'army';
const server = await startAssetLabDevServer(ROOT, 'infantry');
const url = new URL(`infantry.html?count=${count}&faction=${faction}&mode=${mode}${unit ? `&unit=${unit}` : ''}`, server.origin).href;

const app = await electron.launch({
  args: ['.', `--vm-dev=${server.origin}`, '--vm-gpu=webgpu', '--vm-tool-window'],
  cwd: DESKTOP,
  executablePath: electronExe,
});
const page = await app.firstWindow();
page.on('console', (message) => {
  if (message.type() === 'error') console.error(`[infantry-viewer] ${message.text()}`);
});
page.on('pageerror', (error) => console.error(`[infantry-viewer] ${error.stack ?? error.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const status = document.querySelector('#status')?.textContent ?? '';
  return status === 'Ready' || /error|failed|device lost/i.test(status);
}, null, { timeout: 90_000 });

const state = await page.evaluate(() => ({
  status: document.querySelector('#status')?.textContent,
  backend: document.querySelector('#backend')?.textContent,
  mode: document.querySelector('#mode')?.textContent,
}));
console.log('[infantry-viewer] live', state, url);

// This process is the viewer's lifetime. Closing its visible window ends it.
await new Promise((resolve) => app.on('close', resolve));
server.stop();

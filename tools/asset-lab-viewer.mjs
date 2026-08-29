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
const assetArg = process.argv.find((arg) => arg.startsWith('--asset='));
const asset = assetArg ? `&asset=${encodeURIComponent(assetArg.slice('--asset='.length))}` : '';
const server = await startAssetLabDevServer(ROOT);
const url = new URL(`?gpu=webgpu${asset}`, server.origin).href;

const app = await electron.launch({
  args: ['.', `--vm-dev=${server.origin}`, '--vm-gpu=webgpu', '--vm-tool-window'],
  cwd: DESKTOP,
  executablePath: electronExe,
});
const page = await app.firstWindow();
page.on('console', (message) => {
  if (message.type() === 'error') console.error(`[asset-lab] ${message.text()}`);
});
page.on('pageerror', (error) => console.error(`[asset-lab] ${error.stack ?? error.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const status = document.querySelector('#status')?.textContent ?? '';
  return /^Ready/.test(status) || /error|failed|device lost|could not/i.test(status);
}, null, { timeout: 180_000 });
console.log('[asset-lab] live', await page.evaluate(() => ({
  status: document.querySelector('#status')?.textContent,
  backend: document.querySelector('#backend')?.textContent,
  models: document.querySelector('#family-total')?.textContent,
  deliveries: document.querySelector('#file-total')?.textContent,
})), url);
await new Promise((resolve) => app.on('close', resolve));
server.stop();

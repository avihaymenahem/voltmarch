/** Real-Electron proof that a renderer failure survives a desktop relaunch. */

import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rootRequire = createRequire(path.join(HERE, '..', '..', 'package.json'));
const desktopRequire = createRequire(path.join(HERE, 'package.json'));
const { _electron: electron } = rootRequire('playwright');
const electronExecutable = desktopRequire('electron');
const profile = mkdtempSync(path.join(tmpdir(), 'voltmarch-diagnostics-smoke-'));
const sentinel = `diagnostics-smoke-${Date.now()}`;

async function launch() {
  const app = await electron.launch({
    args: ['.', '--vm-dev=http://localhost:5173', `--user-data-dir=${profile}`],
    cwd: HERE,
    executablePath: electronExecutable,
    env: { ...process.env, VM_DESKTOP_USER_DATA: profile },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => (
    window.voltmarch?.bridge === 10
    && typeof window.voltmarch.diagnosticRead === 'function'
    && typeof window.voltmarch.openDevTools === 'function'
  ), null, { timeout: 60_000 });
  return { app, page };
}

let first;
let second;
try {
  first = await launch();
  await first.page.evaluate((message) => console.error(message), sentinel);
  await first.page.waitForFunction(async (message) => {
    const rows = await window.voltmarch.diagnosticRead(100);
    return rows.some((row) => (
      typeof row === 'object' && row !== null
      && 'message' in row && String(row.message).includes(message)
    ));
  }, sentinel, { timeout: 10_000 });
  const devToolsOpened = await first.page.evaluate(() => window.voltmarch.openDevTools());
  if (!devToolsOpened) throw new Error('The renderer could not open its DevTools window.');
  await first.app.close();
  first = undefined;

  second = await launch();
  const persisted = await second.page.evaluate(async (message) => {
    const rows = await window.voltmarch.diagnosticRead(100);
    return rows.some((row) => (
      typeof row === 'object' && row !== null
      && 'message' in row && String(row.message).includes(message)
    ));
  }, sentinel);
  if (!persisted) throw new Error('The renderer diagnostic did not survive relaunch.');
  console.log('ok renderer diagnostic persisted and survived a real Electron relaunch');
} finally {
  await first?.app.close().catch(() => undefined);
  await second?.app.close().catch(() => undefined);
  rmSync(profile, { recursive: true, force: true });
}

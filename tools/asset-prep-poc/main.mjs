import { app, BrowserWindow, ipcMain, protocol, net, utilityProcess, MessageChannelMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// An isolated test executable, never imported or packaged by apps/desktop.
const configPath = process.argv.find(arg => arg.startsWith('--poc-config='))?.slice(13);
if (!configPath) throw new Error('Missing owned POC config.');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
process.on('uncaughtException', error => { console.error(error.stack); app.exit(1); });
process.on('unhandledRejection', error => { console.error(error); app.exit(1); });
app.setPath('userData', config.profile);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('force-high-performance-gpu');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('js-flags', '--expose-gc');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let window;
let helper;
let completed = false;
const failures = [];
const memorySamples = [];
const watchdog = setTimeout(() => finish({ error: 'POC process timed out', failures }), 120_000);

function memory() {
  const rows = app.getAppMetrics().map(p => ({ type: p.type, name: p.name ?? '', workingSetKiB: p.memory.workingSetSize, peakWorkingSetKiB: p.memory.peakWorkingSetSize }));
  return { rows, summedWorkingSetKiB: rows.reduce((sum, r) => sum + r.workingSetKiB, 0) };
}

async function finish(result) {
  if (completed) return;
  completed = true;
  clearTimeout(watchdog);
  if (helper) helper.kill();
  await writeFile(config.result, JSON.stringify({ ...result, failures, versions: process.versions }, null, 2));
  app.exit(result.error || failures.length ? 1 : 0);
}

app.on('render-process-gone', (_e, _wc, details) => { void finish({ error: `Renderer gone: ${details.reason}` }); });
app.on('child-process-gone', (_e, details) => {
  if (details.reason !== 'clean-exit' && details.reason !== 'killed') failures.push(`Child ${details.type}: ${details.reason}`);
});

async function boot() {
await app.whenReady();
const files = new Map([
  ['/renderer.js', path.join(config.build, 'renderer.js')],
  ['/worker.js', path.join(config.build, 'worker.js')],
  ...Object.entries(config.inputs).map(([role, input]) => [`/asset/${role}`, path.join(config.root, input.path)]),
  ...['basis_transcoder.js', 'basis_transcoder.wasm'].map(name => [`/basis/${name}`, path.join(config.root, 'node_modules/three/examples/jsm/libs/basis', name)]),
]);
protocol.handle('app', async request => {
  const url = new URL(request.url);
  if (url.hostname !== 'vm-poc' || request.method !== 'GET') return new Response('Denied', { status: 403 });
  // Same eval requirement as the shipping desktop CSP: Basis' Emscripten bindings.
  if (url.pathname === '/') return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob: data:; style-src 'unsafe-inline'; connect-src 'self' blob:"><style>html,body{margin:0;background:#080d13;overflow:hidden}canvas{display:block}</style></head><body><script type="module" src="/renderer.js"></script></body></html>`, { headers: { 'content-type': 'text/html' } });
  const file = files.get(url.pathname);
  if (!file) return new Response('Not found', { status: 404 });
  const response = await net.fetch(pathToFileURL(file).href);
  return new Response(response.body, { headers: { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'model/gltf-binary', 'cache-control': 'no-store' } });
});

window = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, show: false, webPreferences: { preload: path.join(config.build, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', (event, url) => { if (url !== 'app://vm-poc/') event.preventDefault(); });
window.webContents.on('console-message', (details) => {
  if (details.level === 'error') { failures.push(details.message); console.error(details.message); }
  if (details.message?.startsWith('[poc]')) console.log(details.message);
});
const valid = event => {
  if (event.sender !== window.webContents || event.senderFrame?.url !== 'app://vm-poc/') throw new Error('Invalid POC sender');
};
ipcMain.handle('poc:config', event => { valid(event); return { arm: config.arm, jobs: config.jobs }; });
ipcMain.handle('poc:utility', event => {
  valid(event);
  if (helper) throw new Error('Only one owned utility process is allowed.');
  helper = utilityProcess.fork(path.join(config.build, 'utility.cjs'), [], { serviceName: 'VOLTMARCH asset conditioning POC', stdio: 'pipe', env: { SystemRoot: process.env.SystemRoot ?? '', TEMP: config.profile, TMP: config.profile } });
  helper.stderr.on('data', bytes => failures.push(bytes.toString().slice(0, 1000)));
  const { port1, port2 } = new MessageChannelMain();
  helper.postMessage({ connect: true }, [port1]);
  event.sender.postMessage('poc:port', {}, [port2]);
});
ipcMain.handle('poc:memory', event => {
  valid(event);
  const current = memory();
  const peakSummedWorkingSetKiB = Math.max(current.summedWorkingSetKiB, ...memorySamples);
  memorySamples.length = 0;
  return { ...current, peakSummedWorkingSetKiB };
});
ipcMain.handle('poc:screenshot', async (event, name) => {
  valid(event);
  if (!['lod0', 'lod1', 'lod2', 'shadow'].includes(name)) throw new Error('Invalid capture name');
  await writeFile(path.join(config.captureDir, `${config.arm}-${name}.png`), (await window.webContents.capturePage()).toPNG());
});
ipcMain.handle('poc:complete', async (event, result) => {
  valid(event);
  if (JSON.stringify(result).length > 8_000_000) throw new Error('Oversized result');
  await finish(result);
});
setInterval(() => memorySamples.push(memory().summedWorkingSetKiB), 50).unref();
await window.loadURL('app://vm-poc/');
window.showInactive();
}
boot().catch(error => finish({ error: error.stack ?? String(error) }));

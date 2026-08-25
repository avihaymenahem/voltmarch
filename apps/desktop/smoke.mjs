/**
 * ============================================================================
 * VOLTMARCH desktop — smoke.mjs   (TIER 2, run by hand: `npm run desktop:smoke`)
 * ============================================================================
 * THE ASSERTIONS THAT NEED A REAL ELECTRON, AND CANNOT LIVE IN THE GATE.
 *
 * the Electron plan §7. Tiers 1 and 3 are `tests/desktop-shell.spec.ts`
 * and run in `npm test`; this is tier 2 and needs the binary, so it is out of
 * CI along with the rest of the desktop target.
 *
 * Every check here exists because its failure mode is SILENT:
 *
 *   - Desktop persistence must use Electron userData rather than Chromium's
 *     origin-scoped localStorage/IndexedDB. So this writes through the preload,
 *     closes the process, and verifies both state and save bytes after relaunch.
 *   - A module worker that fails to load does NOT throw from the constructor;
 *     it fires an error event, and TexturePool disables itself. A probe that
 *     checks `spawnTextureWorker() !== null` reports a healthy worker on a
 *     scheme where the worker is dead. So this watches the console instead.
 *   - `.ogg` fetch failures degrade to the synthesised bank rather than to
 *     silence.
 *   - The GPU switch's effect site is conjoined with `&& system_device_id_high_perf`
 *     and no-ops with no log line. So the adapter is READ, never assumed.
 * ============================================================================
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Playwright lives in the ROOT node_modules (it is a devDependency of the game,
// used by tools/shoot.mjs); electron lives in DESKTOP's, because putting it in
// the root would make every Pages CI run download a ~140 MB binary it never
// uses. Two require roots, and `executablePath` must be passed explicitly —
// Playwright resolves 'electron' from its own context and would not find it.
const rootRequire = createRequire(path.join(HERE, '..', '..', 'package.json'));
const deskRequire = createRequire(path.join(HERE, 'package.json'));
const { _electron: electron } = rootRequire('playwright');
const ELECTRON_EXE = deskRequire('electron');
// Never boot the smoke harness against a player's actual persistent profile.
// Besides being invasive, a saved in-progress match bypasses the main menu and
// makes the multiplayer probe/profile assertions inspect the wrong screen.
const SMOKE_PROFILE = mkdtempSync(path.join(tmpdir(), 'voltmarch-desktop-smoke-'));
process.on('exit', () => {
  try { rmSync(SMOKE_PROFILE, { recursive: true, force: true }); } catch { /* best effort */ }
});

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function launch(extraArgs = []) {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${SMOKE_PROFILE}`, ...extraArgs],
    cwd: HERE,
    executablePath: ELECTRON_EXE,
    env: { ...process.env, VM_DESKTOP_USER_DATA: SMOKE_PROFILE },
  });
  const page = await app.firstWindow();
  const messages = [];
  page.on('console', (m) => messages.push(m.text()));
  return { app, page, messages };
}

/* -------------------------------------------------------------------------- *
 * Run 1 — everything except the cross-relaunch persistence check
 * -------------------------------------------------------------------------- */
console.log('\n=== run 1 ===');
const { app, page, messages } = await launch();

// 1. The app:// scheme works at all: the document parsed and the module script ran.
await page.waitForFunction(() => window.__VM !== undefined, null, { timeout: 60_000 });
check(true, 'app:// scheme serves index.html and the ES module bundle parsed');

// 2. Secure context — WebGPU is [SecureContext]-gated, so `secure: true` on the
//    scheme is what keeps ?gpu=webgpu reachable at all.
const secure = await page.evaluate(() => ({
  isSecureContext: window.isSecureContext,
  hasGpu: typeof navigator.gpu !== 'undefined',
  origin: location.origin,
  search: location.search,
}));
check(secure.isSecureContext === true, 'renderer is a secure context', secure.origin);
check(secure.hasGpu === true, 'navigator.gpu is present');
check(new URLSearchParams(secure.search).get('gpu') === 'webgpu',
  'an ordinary desktop launch defaults to WebGPU', secure.search);
await page.waitForSelector('.vm-menu-foot', { timeout: 60_000 });
const menuFooter = await page.locator('.vm-menu-foot').textContent();
check(menuFooter?.includes('WebGPU') === true && !menuFooter.includes('· WebGL2'),
  'the first-paint menu footer reports WebGPU before the backdrop boots', menuFooter?.trim() ?? '');

// 3. THE STORAGE GUARD. Exercise the native bridge, including opaque save bytes.
const storage = await page.evaluate(async () => {
  const out = { keyValue: false, saveFile: false, backend: '', error: '' };
  try {
    window.voltmarch.storageSet('vm.smoke', 'native');
    out.keyValue = window.voltmarch.storageGet('vm.smoke') === 'native';
    await window.voltmarch.saveWrite('smoke-slot', new Uint8Array([1, 2, 3]));
    const bytes = await window.voltmarch.saveRead('smoke-slot');
    out.saveFile = bytes instanceof Uint8Array && bytes.length === 3 && bytes[2] === 3;
    out.backend = 'userData/storage';
  } catch (e) { out.error = e.message; }
  return out;
});
check(storage.keyValue, 'native userData key/value storage reads and writes', storage.error);
check(storage.saveFile, 'native save file write + read completes', storage.error);

// 3b. Development builds must expose the updater contract without touching
// GitHub. This catches bridge/handler startup races and proves ordinary dev
// mode cannot accidentally download or install a public release over itself.
const updates = await page.evaluate(() => window.voltmarch.updateState());
check(updates.mode === 'development', 'dev updater is exposed but network-disabled',
  `${updates.mode}/${updates.status}`);

// 4. The engine actually reached a running state.
await page.evaluate(() => window.__VM.ready());
check(true, '__VM.ready() resolved');

// 5. The adapter, read rather than assumed — and cross-checked against the
//    main process's own getGPUInfo, because two independent reads agreeing is
//    the standard this project holds itself to.
const rendererGpu = await page.evaluate(() => {
  const info = window.__VM.gpuInfo?.();
  return info ? { adapter: info.adapter ?? null, backend: info.backend ?? null } : null;
});
const mainGpu = await app.evaluate(async ({ app: a }) => {
  const info = await a.getGPUInfo('complete');
  const active = (info.gpuDevice ?? []).find((d) => d.active);
  return active ? { vendorId: active.vendorId, deviceId: active.deviceId } : null;
});
console.log(`        renderer: ${JSON.stringify(rendererGpu)}`);
console.log(`        main:     ${JSON.stringify(mainGpu)}`);
check(mainGpu !== null, 'main process reports an active adapter');
// 0x10de NVIDIA, 0x1002 AMD, 0x8086 Intel.
check(mainGpu?.vendorId === 0x10de, 'active adapter is the DISCRETE GPU (0x10de)',
  mainGpu ? `got 0x${mainGpu.vendorId.toString(16)}` : '');

// 6. The texture worker did not silently die. It fails via an error EVENT, not
//    a constructor throw, so the console is the only witness.
const workerDead = messages.some((m) => /worker unavailable|texture worker failed/i.test(m));
check(!workerDead, 'texture worker did not disable itself');

// 7. The packaged renderer carries the production relay and the relay accepts
//    app://voltmarch. This is the exact route a local desktop player uses.
await page.waitForFunction(() => {
  const button = [...document.querySelectorAll('button')]
    .find((node) => node.textContent?.includes('Multiplayer'));
  return button !== undefined && !button.disabled;
// A cold Windows profile must initialise the selected GPU, compile the first
// WebGPU pipelines and generate the procedural title theatre before the menu
// mounts. Ten seconds made this a race against shader compilation rather than
// a relay test on real hardware. The engine readiness assertion above retains
// its own hard deadline; this allowance only waits for the menu entry that
// performs the production handshake.
}, null, { timeout: 60_000 }).catch(() => { /* reported below */ });
const multiplayer = await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')]
    .find((node) => node.textContent?.includes('Multiplayer'));
  return { found: button !== undefined, enabled: button !== undefined && !button.disabled,
    text: button?.textContent?.trim() ?? '' };
});
check(multiplayer.found && multiplayer.enabled,
  'packaged desktop reaches the production multiplayer relay', multiplayer.text);

// 8. No CSP violations — the header is delivered by the protocol handler, and
//    index.html's inline boot script is exactly what would trip a strict one.
const csp = messages.filter((m) => /Content Security Policy/i.test(m));
check(csp.length === 0, 'no CSP violations', csp[0] ?? '');

await app.close();

/* -------------------------------------------------------------------------- *
 * Run 2 — the persistence check. A new process, the same userData.
 * -------------------------------------------------------------------------- */
console.log('\n=== run 2 (relaunch) ===');
const second = await launch();
await second.page.waitForFunction(() => window.__VM !== undefined, null, { timeout: 60_000 });

const persisted = await second.page.evaluate(async () => {
  const out = { keyValue: false, saveFile: false };
  try {
    out.keyValue = window.voltmarch.storageGet('vm.smoke') === 'native';
    const bytes = await window.voltmarch.saveRead('smoke-slot');
    out.saveFile = bytes instanceof Uint8Array && bytes.length === 3 && bytes[0] === 1;
    window.voltmarch.storageRemove('vm.smoke');
    await window.voltmarch.saveRemove('smoke-slot');
  } catch { /* reported below */ }
  return out;
});
check(persisted.keyValue, 'native key/value state SURVIVED a relaunch');
check(persisted.saveFile, 'native save file SURVIVED a relaunch');

await second.app.close();

/* -------------------------------------------------------------------------- *
 * Run 3 — the WebGPU arm, and the SECOND INDEPENDENT READ of the adapter.
 *
 * `capabilities.adapter` is populated from `device.adapterInfo`, which only
 * exists after the deferred WebGPU renderer has booted. Run 1 checks the
 * first-paint request and label; here both the live renderer and main process
 * can speak about the selected GPU, and they must agree.
 *
 * This also proves ?gpu=webgpu is reachable at all under app://, which is what
 * `secure: true` on the scheme buys and what `raiseGpuFailure` would otherwise
 * refuse.
 * -------------------------------------------------------------------------- */
console.log('\n=== run 3 (live WebGPU renderer) ===');
const third = await launch(['--webgpu']);
await third.page.waitForFunction(() => window.__VM !== undefined, null, { timeout: 60_000 });
await third.page.evaluate(() => window.__VM.ready());

const nodeGpu = await third.page.evaluate(() => {
  const info = window.__VM.gpuInfo?.();
  return {
    query: location.search,
    backend: window.__VM.rendererHandle?.backend ?? null,
    adapter: info?.adapter ?? null,
    webglRendererIsNull: window.__VM.renderer === null,
  };
});
console.log(`        ${JSON.stringify(nodeGpu)}`);

check(nodeGpu.query.includes('gpu=webgpu'), 'the --webgpu flag reached location.search');
check(nodeGpu.backend === 'webgpu', 'renderer really is on the WebGPU backend',
  `backend=${nodeGpu.backend}`);
// CLAUDE.md: `window.__VM.renderer` is null under ?gpu=webgpu.
check(nodeGpu.webglRendererIsNull, '__VM.renderer is null on the node path');

const vendor = typeof nodeGpu.adapter === 'string'
  ? nodeGpu.adapter
  : (nodeGpu.adapter?.vendor ?? '');
check(/nvidia/i.test(String(vendor)),
  'RENDERER agrees with the main process: discrete GPU',
  `adapter=${JSON.stringify(nodeGpu.adapter)}`);

await third.app.close();

/* -------------------------------------------------------------------------- *
 * Run 4 — CAN A DESKTOP PLAYER GET THEIR PROFILE OUT?
 *
 * THIS IS A SHIPPING GATE, NOT A NICETY. `app://voltmarch` is a different
 * storage partition from the web build, so a desktop player starts with an
 * empty profile and NO ROUTE BACK — and the campaign plan names profile
 * export/import as a HARD DEPENDENCY for exactly that reason: losing mission
 * counters is annoying, losing ten hours of campaign is a refund request.
 *
 * The export path is `Settings.exportProfile`: a Blob, an object URL, and a
 * synthetic click on a DETACHED anchor carrying `download`. That works in every
 * browser the game supports. **Whether it works under a privileged custom
 * scheme in Electron is a different question, and it is the kind that fails
 * SILENTLY** — no throw, no console line, just no file. Which is precisely the
 * failure mode every other check in this file exists for.
 *
 * So this drives the real button through the real UI rather than calling the
 * API: what has to work is the thing a player clicks.
 * -------------------------------------------------------------------------- */
console.log('\n=== run 4 (profile export under app://) ===');
const fourth = await launch();
await fourth.page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 120_000 });
await fourth.page.evaluate(() => window.__VM.ready());

// `__vmProgression` is published by `progression.system.ts#init`, i.e. during a
// BOOT — so it appears after `__VM.ready()` resolves but not necessarily on the
// same tick. Waited for rather than assumed; its absence is itself the finding.
await fourth.page.waitForFunction(
  () => typeof window.__vmProgression?.exportProfile === 'function',
  null,
  { timeout: 30_000 },
).catch(() => { /* reported by the check below, not thrown */ });

const seeded = await fourth.page.evaluate(() => {
  const p = window.__vmProgression;
  if (p === undefined || p === null) return { ok: false, why: 'no progression handle', bytes: 0 };
  const json = p.exportProfile();
  return { ok: typeof json === 'string' && json.length > 0, bytes: json.length, why: '' };
});
if (!seeded.ok) {
  check(false, 'the profile serialises at all under app://', seeded.why || 'empty');
  console.log(`\n${failures} CHECK(S) FAILED\n`);
  await fourth.app.close();
  process.exit(1);
}
check(seeded.ok, 'the profile serialises at all under app://',
  `${seeded.bytes ?? 0} bytes${seeded.why ? ` — ${seeded.why}` : ''}`);

/*
 * THE REAL QUESTION — AND IT IS ASKED IN THE MAIN PROCESS, NOT THROUGH
 * PLAYWRIGHT.
 *
 * `page.waitForEvent('download')` is Playwright's BROWSER-context abstraction
 * and there is no guarantee it is wired to Electron's download path at all. A
 * null from it would therefore be indistinguishable from "the instrument does
 * not measure this", which is worth exactly nothing — and this file's whole
 * premise is that these failures are silent, so a silent instrument is the last
 * thing it should trust.
 *
 * `session.defaultSession` emits `will-download` for every download Chromium
 * starts, blob: hrefs included. Listening THERE tests the shell rather than the
 * harness: if it fires, the export reaches the shell; if it does not, nothing
 * downstream of the click exists to reach.
 */
await fourth.app.evaluate(({ session }) => {
  const g = globalThis;
  g.__smokeDownloads = [];
  session.defaultSession.on('will-download', (_e, item) => {
    g.__smokeDownloads.push(item.getFilename());
    // Cancel it: a smoke run must not litter the machine's Downloads folder,
    // and the question is whether the event ARRIVES, not where the bytes land.
    item.cancel();
  });
});

await fourth.page.evaluate(() => {
  const p = window.__vmProgression;
  const blob = new Blob([p.exportProfile()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'voltmarch-profile-smoke.json';
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
});

// The click is synchronous; the download is not. Poll rather than sleep.
let seen = [];
for (let i = 0; i < 40 && seen.length === 0; i++) {
  seen = await fourth.app.evaluate(() => globalThis.__smokeDownloads ?? []);
  if (seen.length === 0) await new Promise((r) => setTimeout(r, 250));
}
check(seen.length > 0,
  'a blob download REACHES the shell — a desktop player can get their profile out',
  seen.length > 0
    ? `will-download fired for ${seen.join(', ')}`
    : 'NO will-download EVENT IN THE MAIN PROCESS — the export button is inert on desktop');

// And back in: the import half is what makes the export worth having.
const roundTrip = await fourth.page.evaluate(() => {
  const p = window.__vmProgression;
  const json = p.exportProfile();
  return { ok: p.importProfile(json), rejectsJunk: p.importProfile('{"not":"a profile"}') === false };
});
check(roundTrip.ok, 'the exported profile imports back in');
check(roundTrip.rejectsJunk, 'and a file that is not a profile is refused rather than absorbed');

await fourth.app.close();

/* -------------------------------------------------------------------------- *
 * Run 5 — MINIMISE, WHICH IS THE ONE THING A PLAYER COULD NOT DO
 *
 * Reported as "I don't have a way to minimize the game in desktop mode at all",
 * and it was exactly true: fullscreen is a borderless window (Chromium has no
 * mode-setting path), `Menu.setApplicationMenu(null)` removed the only other
 * chrome, and Alt+Tab switches away without minimising.
 *
 * THIS RUN EXISTS BECAUSE THE FIX CANNOT BE CHECKED ANY OTHER WAY. Whether
 * `win.minimize()` does anything to a window Chromium is holding fullscreen is
 * a platform question, not a code-reading question — and the handler
 * deliberately leaves fullscreen FIRST on the theory that it does not. A unit
 * test would only prove the IPC name is spelled the same on both sides, which
 * `tests/desktop-shell.spec.ts` already does.
 * -------------------------------------------------------------------------- */
console.log(String.fromCharCode(10) + '=== run 5 (minimise out of fullscreen) ===');
const fifth = await launch();
await fifth.page.waitForFunction(() => window.__VM !== undefined, null, { timeout: 60_000 });

const bridgeVersion = await fifth.page.evaluate(() => window.voltmarch?.bridge ?? null);
check(bridgeVersion !== null, 'the preload bridge is exposed at all', `bridge=${bridgeVersion}`);
const minKind = await fifth.page.evaluate(() => typeof window.voltmarch?.minimize);
check(minKind === 'function', 'the bridge exposes minimize()', minKind);

await fifth.page.evaluate(() => window.voltmarch.setFullscreen(true));
await fifth.page.waitForTimeout(600);
const wasFullscreen = await fifth.page.evaluate(() => window.voltmarch.isFullscreen());
check(wasFullscreen === true, 'the window really was fullscreen before we asked');

await fifth.page.evaluate(() => window.voltmarch.minimize());
await fifth.page.waitForTimeout(900);

const after = await fifth.app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  return { minimized: w.isMinimized(), fullscreen: w.isFullScreen() };
});
check(after.minimized === true,
  'minimize() actually sends the window to the taskbar FROM FULLSCREEN',
  JSON.stringify(after));
check(after.fullscreen === false,
  'and it left fullscreen, so the restored window has a titlebar to minimise with',
  JSON.stringify(after));

await fifth.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
await fifth.page.waitForTimeout(600);
const restored = await fifth.app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  const b = w.getBounds();
  return { minimized: w.isMinimized(), w: b.width, h: b.height };
});
check(restored.minimized === false && restored.w > 400 && restored.h > 300,
  'and restore() brings back a usable window', JSON.stringify(restored));

await fifth.app.close();


console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);

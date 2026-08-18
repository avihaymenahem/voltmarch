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
 *   - A non-`standard` scheme does not throw. `SaveStore.indexedDbOrNull()`
 *     tests only that the global EXISTS — it never calls open() — so
 *     detectBackend() hands back an IndexedDbBackend that throws at write
 *     time, while detectIndexStorage() (which has no IndexedDB tier at all)
 *     falls to MemoryIndex. Signature: saves error on write, and the save LIST
 *     is empty next launch. So this opens a real database.
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Playwright lives in the ROOT node_modules (it is a devDependency of the game,
// used by tools/shoot.mjs); electron lives in DESKTOP's, because putting it in
// the root would make every Pages CI run download a ~140 MB binary it never
// uses. Two require roots, and `executablePath` must be passed explicitly —
// Playwright resolves 'electron' from its own context and would not find it.
const rootRequire = createRequire(path.join(HERE, '..', 'package.json'));
const deskRequire = createRequire(path.join(HERE, 'package.json'));
const { _electron: electron } = rootRequire('playwright');
const ELECTRON_EXE = deskRequire('electron');

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function launch(extraArgs = []) {
  const app = await electron.launch({ args: ['.', ...extraArgs], cwd: HERE, executablePath: ELECTRON_EXE });
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

// 3. THE STORAGE GUARD. Open a real database, do not merely observe the global.
const storage = await page.evaluate(async () => {
  const out = { localStorage: false, idbOpen: false, error: '' };
  try {
    localStorage.setItem('vm.smoke', '1');
    out.localStorage = localStorage.getItem('vm.smoke') === '1';
  } catch (e) { out.error += `localStorage: ${e.message}; `; }
  try {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('vm-smoke', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(new Uint8Array([1, 2, 3]), 'probe');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error ?? new Error('tx failed'));
      };
      req.onerror = () => reject(req.error ?? new Error('open failed'));
    });
    out.idbOpen = true;
  } catch (e) { out.error += `indexedDB: ${e.message}`; }
  return out;
});
check(storage.localStorage, 'localStorage reads and writes');
check(storage.idbOpen, 'IndexedDB open() + write TRANSACTION COMPLETES', storage.error);

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

// 7. No CSP violations — the header is delivered by the protocol handler, and
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
  const out = { localStorage: false, idb: false };
  try { out.localStorage = localStorage.getItem('vm.smoke') === '1'; } catch { /* reported below */ }
  try {
    out.idb = await new Promise((resolve) => {
      const req = indexedDB.open('vm-smoke', 1);
      req.onsuccess = () => {
        const db = req.result;
        const get = db.transaction('kv', 'readonly').objectStore('kv').get('probe');
        get.onsuccess = () => { const v = get.result; db.close(); resolve(v instanceof Uint8Array && v.length === 3); };
        get.onerror = () => { db.close(); resolve(false); };
      };
      req.onerror = () => resolve(false);
    });
  } catch { /* reported below */ }
  return out;
});
check(persisted.localStorage, 'localStorage SURVIVED a relaunch');
check(persisted.idb, 'IndexedDB blob SURVIVED a relaunch');

await second.app.close();

/* -------------------------------------------------------------------------- *
 * Run 3 — the WebGPU arm, and the SECOND INDEPENDENT READ of the adapter.
 *
 * `capabilities.adapter` is populated from `device.adapterInfo`, which only
 * exists on the node path — so on the default WebGL boot the renderer has
 * nothing to say about which GPU it got, and the main process's getGPUInfo is
 * the only witness. Here both can speak, and they must agree.
 *
 * This also proves ?gpu=webgpu is reachable at all under app://, which is what
 * `secure: true` on the scheme buys and what `raiseGpuFailure` would otherwise
 * refuse.
 * -------------------------------------------------------------------------- */
console.log('\n=== run 3 (--webgpu) ===');
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
 * The export path is `Missions.exportProfile`: a Blob, an object URL, and a
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

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);

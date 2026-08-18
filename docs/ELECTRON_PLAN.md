# ELECTRON DESKTOP PLAN

**Written 2026-08-17, at v2.14.0.** Requested directly: *"we are going to wrap our app with electron,
to make it a desktop game. the gpu enforcement will be on by default, and so does every other flag we
might need. we need to research any other benefits we will get."* — and, mid-request, the constraint
that shapes every design decision below:

> *"it should not completly destroy our web version. they should be able to live side by side. github
> pages deployment continue as is, and the desktop version wont run in ci for now."*

So: **one codebase, two targets.** `dist/` stays byte-for-byte what it is today, `.github/workflows/deploy.yml`
is not edited, and the desktop build is a local-only artifact until someone decides otherwise.

---

## 0. THE HONEST VERDICT, UP FRONT

> **GATE ZERO RAN ON 2026-08-17 AND IT PASSED. The premise is confirmed: the switch moves the adapter,
> and one switch moves BOTH renderers.** §1 is now a result rather than a plan. Full data in
> [`RENDER_FINDINGS.md`](RENDER_FINDINGS.md) §7j.

```
arm            WebGPU adapter     WebGL unmasked renderer
control        amd / gcn-5        AMD Radeon(TM) Graphics      <- reproduced twice, identical
hyphen         nvidia / ampere    NVIDIA GeForce RTX 3080 Laptop GPU
underscore     nvidia / ampere    NVIDIA GeForce RTX 3080 Laptop GPU
```

**The wrapper is worth building — and after the measurement, for close to the reason it was asked for.**

Four things are now true:

1. **`--force-high-performance-gpu` works on this hardware, and both spellings work alone.** The folk
   claim that it does nothing on Windows traces to a 2021 feature request about a Chromium ~55 majors
   old, and it is simply out of date.
2. **It covers WebGL *and* WebGPU with one switch.** This was the open question — `gpu_preferences.h`
   defines a separate `WebGPUPowerPreference::kForceHighPerformance`, which suggested Dawn might not
   follow the ANGLE effect site. On this box it follows.
3. **`RENDER_FINDINGS.md` §7g is confirmed, not an artefact of the registry.** The measurement was taken
   with **Edge**, which has no `UserGpuPreferences` entry — so `amd`/`gcn-5` is the genuine unforced
   default here, reproduced twice. §7g does not need re-taking, and no registry write was needed to
   establish that.
4. **The per-EXE registry key remains a second, independent argument.** `HKCU\SOFTWARE\Microsoft\DirectX\UserGpuPreferences`
   holds `chrome.exe => GpuPreference=2;` — the user's manual Windows Settings fix, keyed by executable
   path, and therefore **unscoped**: every Chrome tab, background renderer and video call on this machine
   now runs on the RTX 3080. A separate `voltmarch.exe` gets its own key and scopes the preference to
   the game.

**What gate zero did NOT establish, and what now replaces it as the blocking unknown:** this was Edge,
i.e. plain Chromium on the command line. **Whether `app.commandLine.appendSwitch` before
`app.whenReady()` reaches the GPU process is still unmeasured.** It is a 30-minute test against a bare
`main.js` — see §1.1 — and it should be the first Electron code written.

Separately, and this is the part nobody asked about: **the wrapper fixes a live multiplayer correctness
bug that has no web-side fix at all.** See §4.1. That is arguably as good a justification as the GPU
question, and it is four lines of code.

> **RECOMMENDATION: §1.1 first (30 min), then S0–S2 (§6) as one piece of work.** Defer signing,
> auto-update and stores until there is something to distribute.

---

## 0b. STATUS — S0–S3 AND S5 ARE BUILT, 2026-08-17

**§1.1 was answered in the affirmative and the shell exists.** `desktop/`, packaged and verified.

```
                 active adapter, read from the MAIN process
default          0x10de:0x249c   NVIDIA GeForce RTX 3080 Laptop GPU
--vm-safe-mode   0x1002:0x1638   AMD Radeon (integrated)
```

So Electron's `app.commandLine.appendSwitch` before `app.whenReady()` **does** reach the GPU process,
and the A/B is clean inside Electron itself. Under `--webgpu` the renderer's own `GPUAdapter.info`
independently reports `nvidia`/`ampere` with `backend: 'webgpu'` — **two independent reads agreeing**,
which is the standard this project holds itself to.

| Stage | State |
|---|---|
| S0 window that loads the game | **done** — `app://voltmarch`, privileged scheme, CSP by header |
| S1 GPU enforcement | **done** — measured both ways, setting + `--vm-safe-mode` escape hatch |
| S2 parity | **done** — query-string flags survive `history.replaceState`; storage verified across relaunch |
| S3 test surface | **done** — 22 assertions in the gate, 15 in the Electron smoke test |
| S4 doc truth pass | **partial** — see §8; deliberately deferred until distribution |
| S5 installer | **done** — 104.3 MB NSIS + portable, 359.6 MB installed |
| S6 signing | not started — blocked on §9's eligibility question |
| S7 auto-update | not started — presumes S6 |

Both size figures land inside the estimates this document made before anything was built (95–140 MB
installer, 250–450 MB installed), which is worth recording as one of the few times an estimate here
was checkable.

**The four gates were re-run on the finished work and the web build did not move**: typecheck 0 ·
**4089 passed / 2 skipped** (4067 + the 22 new) · build 0 · server 60/60. The entry chunk is
`index-BoivCkEI.js` — **the same content hash as before the desktop work**, which is the coexistence
constraint satisfied by measurement rather than by assertion.

---

## 1. GATE ZERO — **RAN 2026-08-17. PASSED.**

Everything downstream turned on one unmeasured fact, and this repo's house move is *measured, not argued*.

**The method changed in one respect, and the change matters.** The original plan said to delete the
`chrome.exe` entry from `UserGpuPreferences` to obtain a control. That is unnecessary and was not done:
the key is scoped **by executable path**, so any other Chromium binary is already a clean control.
**Edge has no entry**, so Edge is the control — no registry write, nothing to restore, and no risk of
leaving the machine perturbed if a run crashes. **Do not delete that key to reproduce this.**

```
                WebGPU adapter     WebGL unmasked renderer
control         amd / gcn-5        ANGLE (AMD, AMD Radeon(TM) Graphics … D3D11)
control (2nd)   amd / gcn-5        ANGLE (AMD, AMD Radeon(TM) Graphics … D3D11)
hyphen only     nvidia / ampere    ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Laptop GPU … D3D11)
underscore only nvidia / ampere    ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Laptop GPU … D3D11)
both            nvidia / ampere    ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Laptop GPU … D3D11)
```

Machine: `NVIDIA GeForce RTX 3080 Laptop GPU` + `AMD Radeon(TM) Graphics`, Edge, headed, fresh profile
per arm. Harness: `scratchpad/run-probe.mjs`. **Results and the full argument live in
[`RENDER_FINDINGS.md`](RENDER_FINDINGS.md) §7j** — that is the durable record; this section is the gate.

**Verdict: premise confirmed. Electron is a delivery mechanism for a proven fix.** Both spellings work
independently, one switch moves both renderers, and the control is reproducible.

### 1.1 THE REMAINING BLOCKING TEST — 30 minutes, and it is now the first Electron code

Gate zero used Edge on the command line. **`app.commandLine.appendSwitch` before `app.whenReady()` is a
different call path and is still unmeasured.** Write the smallest possible `main.js` — append both
spellings, open a window on the probe page, log `await app.getGPUInfo('complete')` — and check two
things agree:

1. `getGPUInfo().gpuDevice[]` shows `active` on the NVIDIA device id.
2. The renderer's own `GPUAdapter.info` says `nvidia`/`ampere`.

**Two independent reads agreeing is the standard this project already holds itself to.** If they
disagree, believe neither and find out why before building anything on top.

The effect site can silently no-op — see §5 — so this must be verified by *reading the adapter*, never
by observing that the switch was appended.

---

## 2. THE COEXISTENCE DESIGN — WHY THE WEB BUILD DOES NOT MOVE

The constraint is satisfied structurally rather than by discipline, using the pattern this repo already
has for `server/`:

```
voltmarch/
  package.json           # UNCHANGED. no electron, no electron-builder
  vite.config.ts         # UNCHANGED. still plugin-free
  dist/                  # UNCHANGED. byte-for-byte the Pages artifact
  server/                # existing precedent — own package.json, own tsconfig
  desktop/               # NEW, and entirely additive
    package.json         #   electron, electron-builder, esbuild
    tsconfig.json
    electron-builder.yml
    src/main.ts
    src/preload.ts
    src/{flags,app-url,paths}.ts   # pure modules — see §7
```

**Why `desktop/` gets its own `package.json` and this is not negotiable:** the `electron` npm package's
postinstall downloads the platform binary — `electron-v43.4.0-win32-x64.zip` is **144,408,141 bytes**.
Putting it in root devDependencies makes every Pages CI run download ~140 MB it will never use, on the
workflow the user said must keep working as-is.

Walking `deploy.yml` step by step against this layout: `npm ci` unchanged (electron lives elsewhere) ·
`npm ci --prefix server` untouched · `npm run typecheck` still four invocations (desktop gets its own
script, see below) · `npm test` unchanged, vitest's `include` is `tests/**` · `npm run server:test`
untouched · `npm run build` is `vite build` against an unmodified config · `upload-pages-artifact path: dist`
unchanged. **Zero edits.**

Two traps in that arithmetic:

- **Do NOT append `&& tsc --noEmit -p desktop/tsconfig.json` to the root `typecheck` script.** It would fail
  Pages CI on `TS2307: Cannot find module 'electron'` unless `deploy.yml` also gains `npm ci --prefix desktop`
  — which is the file that must not change. This is the identical trap CLAUDE.md already documents for
  `server/node_modules`, where three parallel agents each reported it as a failing gate. Add a separate
  `"desktop:typecheck"` script (a script *definition* costs CI nothing) and fold it into the gate on the
  same commit that adds desktop to CI. **Record it in CLAUDE.md's gate list as "not yet in the gate, and why"**,
  so the next agent finds a decision rather than a hole.
- Running a desktop build locally creates `dist/`, and `tests/webgpu-bundle-isolation.spec.ts` is
  `describe.runIf(haveDist)` — so a local `npm test` afterwards reports **4027** instead of 4024. Documented
  behaviour, not a regression, but it will confuse anyone reconciling counts.

**Rejected integrations, each for a stated reason:** electron-vite *replaces* `vite build` and takes
ownership of the renderer. Electron Forge's Vite plugin is still marked experimental and mandates **three**
config files plus a `main` pointing into `.vite/build`. vite-plugin-electron is a direct violation of the
plugin-free rule in `vite.config.ts`. The main process here is small and imports only `electron`, so the
correct seam is `vite build` unchanged plus a ~15-line standalone esbuild call.

---

## 3. HOW THE BUNDLE LOADS — THE ONE DECISION THAT IS EXPENSIVE TO GET WRONG

**Serve `dist/` over a privileged custom scheme. Not `file://`.** Get this right on day one, because
every failure mode on the other path is silent.

One premise that turned out to be false and is worth recording: **the absolute `/brand/...` hrefs in
`index.html` are a non-issue.** Vite's `base: './'` rewrites them at build time — `dist/index.html` already
ships `./brand/mark-32.png`. No change is needed to `index.html` for any loading strategy, and the web
build stays byte-identical.

`file://` would *probably* still boot today: Electron's `grantFileProtocolExtraPrivileges` fuse is enabled
by default and turns on exactly the privileges that make file:// ES modules and `fetch()` work. It is
rejected anyway, on four grounds that do not depend on that:

- **Storage.** Electron's own protocol docs: *"By default web storage apis (localStorage, sessionStorage,
  webSQL, indexedDB, cookies) are disabled for non standard schemes."* Those APIs appear **66 times across
  20 files** here — `SaveStore.ts` (20), `profile-store.ts` (7), `settings-store.ts` (5), `net-link.ts` (5).
  `standard: true` is what keeps them alive.
- **Secure context.** `navigator.gpu` is `[SecureContext]`-gated. Without `secure: true` the desktop build
  ships with `?gpu=webgpu` permanently unreachable through `raiseGpuFailure` — the exact capability the
  wrapper is supposed to deliver.
- **Security.** Electron's checklist: *"Pages running on `file://` have unilateral access to every file on
  your machine."*
- **It rests on a fuse Electron built an off-switch for and is actively narrowing.** If that default ever
  flips, the failure is a silent hang on the boot curtain, because `index.html`'s error handler deliberately
  ignores resource-load errors.

### 3.1 The main process, with the traps already closed

```js
// desktop/src/main.ts
import { app, BrowserWindow, protocol, net, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const SCHEME = 'app';
const HOST   = 'voltmarch';

// Module top level — "can only be used before the ready event... and only once".
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,         // origin, relative URLs, localStorage + IndexedDB
    secure: true,           // isSecureContext -> WebGPU, crypto.subtle, AudioWorklet
    supportFetchAPI: true,  // the 184 .ogg fetches
    stream: true,
    codeCache: true,        // V8 code cache for the 2.7 MB entry chunk
    corsEnabled: false, bypassCSP: false,
    allowServiceWorkers: false, allowExtensions: false,
  },
}]);

app.whenReady().then(() => {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('not found', { status: 404 });

    // Query and hash never touch disk, so ?gpu=webgpu still lands in location.search.
    const rel = decodeURIComponent(url.pathname);
    const abs = path.resolve(ROOT, '.' + (rel === '/' ? '/index.html' : rel));
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
      return new Response('forbidden', { status: 403 });   // traversal guard
    }

    const res = await net.fetch(pathToFileURL(abs).toString());
    if (!res.ok) return new Response('not found', { status: 404 });

    const headers = new Headers(res.headers);
    const type = MIME.get(path.extname(abs).toLowerCase());
    if (type) headers.set('content-type', type);
    if (abs.endsWith('.html')) headers.set('content-security-policy', CSP);
    return new Response(res.body, { status: 200, headers });
  });
});
```

- **The MIME map is not optional.** Chromium's `net/base/mime_util.cc` has `{"text/javascript","js,mjs"}`
  and `{"audio/ogg","ogg,oga,opus"}` but **no woff2 entry**, and a wrong content-type on a module script is
  fatal rather than cosmetic.
- **CSP as a response header**, so `index.html` is never edited and the web build stays identical. It must
  allow **inline script and inline style** — `index.html` carries a pre-module inline `<script>` and
  `Help.ts` creates a `<style>` element at runtime. Without that the game is a black page.
- **`new URL('app://voltmarch/x').origin` is the string `'null'` in the main process.** Node's WHATWG parser
  knows nothing about a privileged-scheme registration. Compare `protocol` + `host`, never `.origin`.

### 3.2 The navigation trap

**Copy Electron's security checklist verbatim and you break starting a match.** Three renderer-initiated
navigations exist here and all three are load-bearing:

```ts
Shell.ts:1890     location.assign(`${location.pathname}?${query}`)   // hardLaunch — failed-rebuild escape hatch
renderer.ts:1392  location.replace(hrefWithoutGpuFlag(here))         // "Continue on WebGL" button
renderer.ts:1395  location.replace(here)                             // its "Retry"
```

`will-navigate` does not fire for `webContents.loadURL`, but it **does** fire for these, because they are
renderer-initiated. A deny-all handler kills both the WebGL escape hatch and `hardLaunch`:

```js
const isOurs = (u) => { try { const p = new URL(u); return p.protocol === 'app:' && p.host === HOST; }
                        catch { return false; } };
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => { if (!isOurs(url)) e.preventDefault(); });
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) setImmediate(() => shell.openExternal(url));
    return { action: 'deny' };
  });
});
```

### 3.3 Flags reach the renderer as a query string, exactly as they do today

`win.loadURL('app://voltmarch/index.html?gpu=webgpu&map=sunder-atoll')` gives `location.search` byte-identical
to the web one. The handler destructures `pathname` and never sees the query. All ~25 `new URLSearchParams(location.search)`
sites are untouched — `main.ts:47`, `backend.ts:50`, the terrain seed, `?relay=`, the lot.

**Keep the query string; do not invent a second mechanism.** It is what replays, `tools/shoot.mjs` and
`tools/desync-probe.mjs` already read; `Shell.bootGame` *writes it back* with `history.replaceState` on
every match boot, so a parallel mechanism would immediately disagree with the URL; and it is the only
channel that survives the `location.assign` in `hardLaunch`.

**Do not reach for `additionalArguments`.** It appends to `process.argv` in the renderer — but with
`sandbox: true` + `contextIsolation: true`, page code cannot see `process` at all.

**And do not merge the two flag systems.** `?gpu=webgpu` is a *renderer* flag read after the page loads.
Forcing the discrete GPU is a *Chromium command-line switch* that must be set before the GPU process
launches. Different layers, different timing, one name away from a confusing bug.

### 3.4 The preload bridge, and the typing pattern that leaves the web build alone

With `sandbox: true` the preload has no `node:fs`, so every capability is an IPC call — which is the right
shape anyway. **The preload must be CommonJS `require('electron')`, not ESM `import`**: Electron's own docs
say *"Sandboxed preload scripts are run as plain JavaScript without an ESM context"*, so the widely-copied
`.mjs` + `import` sample only applies to *unsandboxed* preloads. Bundle it to CJS with the same esbuild call
that builds main.

One ambient `.d.ts` under `src/` (picked up by the root tsconfig's `include: src/**/*.ts`, no config change,
no runtime code in the web bundle), plus one accessor:

```ts
// src/platform/desktop.ts — the ONE accessor. Nothing else may touch window.voltmarch.
export function desktop(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;        // vitest runs environment: 'node'
  const b = window.voltmarch;
  return b !== undefined && b.bridge === 1 ? b : null;   // version gate, not truthiness
}
export const isDesktop = (): boolean => desktop() !== null;
```

**`bridge === 1` rather than `window.voltmarch?` is the part that earns its keep.** An older packaged preload
running against a newer bundle degrades to *web behaviour* instead of calling a method that does not exist —
the same discipline as `REPLAY_FORMAT_VERSION` refusing a v1 file. Every call site is then
`desktop()?.setFullscreen(true)`, which typechecks identically with or without Electron present.

---

## 4. WHAT THE WRAPPER ACTUALLY BUYS

### 4.1 The one that is a live bug, not a nicety

**Background throttling freezes a lockstep match for BOTH players, and there is no web-side fix.**

`src/core/loop.ts:140` drives frames with `requestAnimationFrame`. Chromium does not call rAF for a hidden
document — not at 1 Hz, **zero**. CLAUDE.md's own rule is *"The step gate stalls, it never skips"*, and
`net.system.ts:158 sampleStall()` only raises a HUD indicator; there is no client-side timeout. So: player A
minimises or is fully occluded → A's loop stops → A submits no turn frames → B's `scheduler.mayStep()`
refuses forever → **the match is dead for both until A comes back.**

```js
app.commandLine.appendSwitch('disable-renderer-backgrounding');
new BrowserWindow({ webPreferences: { backgroundThrottling: false } });
```

Two documented caveats: on Windows this covers occluded and minimised windows but **not** a window you called
`hide()` on; and with it off the Page Visibility API keeps reporting `visible`, so any future `visibilitychange`
pause logic silently stops firing. (There is none in the repo today — the grep returns zero hits outside the
harness path in `main.ts`.)

### 4.2 The biggest new capability: LAN and self-hosted multiplayer

`relayUrl()` returns `''` for any `ws://` URL unless `pageIsPlaintext()`. GitHub Pages is https, so **the web
build can never point at `ws://192.168.1.x:8787`** — and that is not a project quirk, Chromium blocks it as
mixed content. Today multiplayer therefore requires a permanently-running, TLS-certificated `wss://` relay on
a paid VPS, and there is no offline or LAN mode at all.

`server/` is trivially bundleable: its only runtime dependency is `ws` plus `node:crypto`, and its tsconfig
boundary *guarantees* it imports no game code, no three, no `src/sim/**`. Fork it as a child process from main.
**LAN play with no internet, self-hosted play via one port-forward, and the VPS bill goes to zero — with zero
game-code changes.**

> **⚠ ONE UNRESOLVED TENSION, FLAGGED RATHER THAN GLOSSED.** The research lanes disagreed here and the
> adversarial pass only half-settled it. `secure: true` is required for WebGPU (§3) — but it also marks the
> origin potentially-trustworthy, which is what re-arms Chromium's mixed-content blocking against `ws://`.
> Our own `pageIsPlaintext()` would *not* catch that, because it only tests for the literal string `'https:'`,
> so the failure would surface as an unexplained socket error — precisely the confusing failure that function's
> header says it exists to prevent.
>
> My reading, stated as reasoning and **not** as a verified fact: loopback is on Chromium's
> potentially-trustworthy list, so a **bundled relay on `ws://localhost:8787` should work either way**, and it
> is **`ws://<LAN-IP>` to another machine that is at risk**. That distinction decides whether "LAN play" means
> *host-and-join-locally* or *join-a-friend's-box*, so **measure it before promising the second one.** If it is
> blocked, the answer is a loopback-only relay plus port-forwarding, not turning off `secure`.

### 4.3 The rest, ranked by value per line

| # | Win | Notes |
|---|---|---|
| 1 | GPU adapter enforcement | The stated ask. Mechanism in §5, unproven until §1 runs. |
| 2 | `displayFrequency` | `screen.getPrimaryDisplay().displayFrequency` has **no web equivalent**, and `HardwareCalibration` currently hardcodes a 16.7 ms target. A 144 Hz player is being calibrated to the wrong number today. |
| 3 | `powerSaveBlocker`, `Menu.setApplicationMenu(null)`, `requestSingleInstanceLock`, `setAppUserModelId` | One-liners each. |
| 4 | Window bounds + monitor persistence | Real, and the web cannot do it. |
| 5 | `crashReporter` + `render-process-gone` | **The sleeper win.** It is the instrument the device-loss work is explicitly missing — `RENDER_FINDINGS.md` §7g records that no part of the recovery has been observed on real hardware. |
| 6 | Replays/screenshots to a real folder | `userData/replays` + `shell.showItemInFolder`, instead of anonymous `a.click()` downloads. |
| 7 | Input | Only **two** things beat the browser: no chrome UI stealing chords, and a pre-page key hook. Right-click, gamepad, pointer lock and devicePixelRatio are identical. |

### 4.4 The honest negative list

Things commonly claimed for Electron that **do not apply here**, so nobody re-derives them:

- **"Native performance."** False. Electron 43 is Chromium M150 — the same V8, ANGLE and Dawn. The only real
  speed lever is adapter selection, which is the actual ask.
- **"Escapes the 5 MB localStorage quota."** Already escaped: `SaveStore` uses IndexedDB for blobs. The real
  storage win is a folder the player can open, not headroom.
- **"Shader cache warming."** Real but small — `Bootstrap.ts:346` already front-loads compilation with
  `renderer.compile()`. The win is a shorter load screen, not a smoother frame. **Do not put a number on this
  in any doc until someone times boot-to-curtain-drop with the cache deleted vs warm.**
- **"Restores high-resolution timers."** No. `performance.now()` is clamped to 100 µs in **both** targets.
- **"Exclusive fullscreen."** Chromium does borderless-windowed. There is no exclusive mode to get.
- **A risk running the other way:** Electron's Chromium **lags** Chrome by 2–3 majors even when fully current,
  which exposes the `?gpu=webgpu` TSL path to an **older Dawn** than the user's own browser.

---

## 5. THE FLAGS — AND WHY "EVERY FLAG ON BY DEFAULT" IS THE WRONG DEFAULT

The ask was *"every other flag we might need, on by default"*. The honest answer is that **the list of flags
that actually help is four**, and two of the tempting ones make the product measurably worse in ways this
project already has instruments to detect. That is a better argument than taste.

### ON BY DEFAULT — all appended before `app.whenReady()`

```js
app.commandLine.appendSwitch('force-high-performance-gpu');   // browser-process switch
app.commandLine.appendSwitch('force_high_performance_gpu');   // GPU-process workaround name
app.commandLine.appendSwitch('disable-renderer-backgrounding');
```
plus `webPreferences: { backgroundThrottling: false }` and `powerSaveBlocker` scoped to a live match.

**Both spellings are real and they are not typos for each other.** `--force-high-performance-gpu` (hyphens) is
the browser-process switch in `gpu/config/gpu_switches.cc`. `force_high_performance_gpu` (underscores) is a
GPU *driver-bug-workaround* name from `gpu_workaround_list.txt`, and it is the one Electron's docs list. The
browser process translates the first into the second **and** copies workaround switches through with
`CopySwitchesFrom`, so either reaches the GPU process. Appending both costs nothing and insures against either
layer changing.

**Timing is load-bearing.** Electron's docs: append *"before the ready event of the app module is emitted"*.
The GPU process launches after ready with the command line it had at launch — append late and it is a silent
no-op.

**The effect site can silently no-op.** `gpu/ipc/service/gpu_init.cc`, under `#if BUILDFLAG(IS_WIN) || BUILDFLAG(IS_MAC)`:

```cpp
if (gpu_feature_info.IsWorkaroundEnabled(FORCE_HIGH_PERFORMANCE_GPU) &&
    system_device_id_high_perf) {
  gl::SetGpuPreferenceEGL(gl::GpuPreference::kDefault, system_device_id_high_perf);
  return;
}
```

That `&& system_device_id_high_perf` conjunct means: if GPU-info collection produced no device id for a
high-performance adapter, the whole thing does nothing, **with no log line**. Hence §1 and the verification
recipe below.

**✅ It DOES cover WebGPU — measured, §1.** `gpu/config/gpu_preferences.h` defines a *separate* mechanism
(`WebGPUPowerPreference` with `kForceHighPerformance = 4`, plus `--use-webgpu-power-preference` and
`--use-webgpu-adapter`), which suggested Dawn might not follow the ANGLE/EGL effect site. **On this
hardware it follows: WebGL and WebGPU both moved to `nvidia`/`ampere` under either spelling alone.**
Keep the two WebGPU-specific switches in mind as fallbacks if a machine is ever found where it does not.

### OFFERED, NOT DEFAULT — each needs a restart, each retires `graphics.calibrated`

- `--disable-frame-rate-limit` ("Unlock frame rate"). It **implies** `--disable-gpu-vsync`, so never pass both.
- `--ignore-gpu-blocklist` ("Force GPU acceleration — troubleshooting"). Re-enables acceleration on driver
  combinations Chromium blocked *for crashing*.
- Windows per-app GPU preference (`UserGpuPreferences`). Last resort, with a visible revert.

**The measured reason vsync stays on:** `HardwareCalibration.ts:147` sets `flatSlopeMs: 1.0`, and line 571
returns `'not-fill-rate-bound'` and cuts nothing when the fitted slope is below it. CLAUDE.md calls that
*"the property that makes it safe to ship on hardware nobody here owns"*. Disabling vsync removes the
vsync-flat case **by construction**: a previously flat machine now fits a real positive slope, the guard stops
firing, and first-run calibration starts cutting resolution on hardware that was perfectly fine — permanently,
since `graphics.calibrated` is sticky.

### DO NOT SHIP

`--enable-zero-copy` (**not a Chromium switch**; zero-copy is already the default) · `--use-angle=<anything>`
(default is already d3d11; keep as a support escape hatch, and note `d3d9` no longer exists) ·
`--disable-gpu-vsync` (implied above) · `--in-process-gpu` (removes the GPU sandbox and turns this project's
carefully-handled device-loss path into a hard exit) · `--no-sandbox` · `--disable-gpu-watchdog` ·
`--enable-features=Vulkan` on Windows · `--enable-unsafe-webgpu` (WebGPU is stable; this only opens non-stable
surface) · `--disable-backgrounding-occluded-windows` (the Chromium constant is literally
`kDisableBackgroundingOccludedWindowsForTesting` — shipping a `ForTesting` switch by default is a different
risk class; `backgroundThrottling: false` is the product-facing mechanism).

**Traps worth naming**, because they show up in every "fix Electron GPU" thread: renaming `electron.exe` to
match an NVIDIA driver profile does nothing (the profile is consulted only for the *default* adapter; ANGLE
selects by explicit device id — and it is indistinguishable from malware to a security product). Repeated
`appendSwitch('enable-features', …)` calls **replace** rather than concatenate. And Electron has no
`chrome://flags` UI, so anything a user "fixed with a flag in Chrome" must be re-expressed as a switch in
your main process — there is nowhere for them to toggle it.

### Enforcement is a SETTING WITH A DEFAULT, not a hard-coded switch

Not caution — arithmetic. **Switches must be appended before `app.whenReady()`, so the enforcement decision is
taken before any window, any renderer and any settings screen exists.** If a hard-coded switch bricks the boot
on somebody's machine, there is no in-app route back, only editing a file by hand — which is exactly the
ergonomic the user is trying to escape. Ship a settings file read before ready, plus a **safe-mode shortcut**
that ignores it.

Failure inventory: **laptop on battery** — on a muxless design the dGPU is not wired to the display, so forcing
it keeps the discrete GPU powered for the app's whole lifetime *and* copies every frame into iGPU memory for
scanout. **Integrated only** — should degrade to a no-op (plausible from DXGI semantics, unverified as Chromium
behaviour). **dGPU disabled or absent** — the risk is not the wrong GPU but GPU-process init failure, and this
project already knows what that looks like: CLAUDE.md records that Chromium falls back to SwiftShader after a
GPU-process crash and *"that frame differs from the hardware one in 76.5% of its pixels"*. **A silent SwiftShader
boot is measured-correct and visibly wrong** — the exact class this repo refuses to ship.

**Apply `?gpu=webgpu`'s own principle: refuse, don't substitute.** If enforcement was requested and
`getGPUInfo` says it did not happen, say so on screen with the adapter named, exactly as `raiseGpuFailure` does.

### Verification recipe — do not ship enforcement without running this on the RTX 3080 box

1. Launch **without** the switches. `await app.getGPUInfo('complete')`; log every `gpuDevice` with
   `{vendorId, deviceId, active, gpuPreference, luid}`. Expect two adapters, `active` on the integrated one.
   **This is the control, and it is the first hard evidence this project will have for the §7g claim.**
2. Launch **with** both spellings. `active` must move to the NVIDIA device id. If it does not, go to
   `--use-adapter-luid=<low>,<high>` with the LUID from step 1.
3. Cross-check in the renderer: `__VM.gpuInfo()` should now say `nvidia`/`ampere` instead of `amd`/`gcn-5`.
   **Two independent reads agreeing is the standard this project already holds itself to.**
4. Repeat 2–3 under `?gpu=webgpu` — the verified effect site is the ANGLE/EGL path, and whether Dawn follows
   it is open.
5. Only then measure frame time, and quote `frame.drawCallsByPass.colour`, **not** `frame.drawCalls`.

`getGPUFeatureStatus()` is only valid after the `gpu-info-update` event, and `getGPUInfo` **rejects** outright
if the GPU is disabled. Handle both, rather than letting the probe throw into a blank window.

---

## 6. STAGES AND COST

Competent developer with an AI pair. **The effort is not in Electron** — it is in storage and flag parity,
in proving the switch does anything, in the doc pass, and in signing bureaucracy.

| | Stage | Hours | Notes |
|---|---|---|---|
| **§1** | **The twenty-minute experiment** | **0.5** | **Gates everything.** |
| S0 | Window that loads the game | 3–6 | 3 h if `app://` is done properly; a day-plus if you take the `file://` shortcut and then redo it. |
| S1 | GPU enforcement, done honestly | 6–12 | **Mostly measurement, not code.** Prove the switch moves the adapter; decide whether the registry key is still needed; build the setting + safe-mode. |
| S2 | Parity | 6–10 | Query plumbing, the `pageIsPlaintext` inversion, `will-navigate` vs the WebGL escape hatch, save round-trip across relaunch. |
| S3 | Test surface (§7) | 6–10 | Tiers 1 and 3 in the existing gate; one `_electron` smoke test locally. |
| S4 | **Doc truth pass** | 3–5 | **Non-optional in this repo.** See §8. |
| S5 | Installer | 4–8 | electron-builder, NSIS + portable. First time only. |
| S6 | Code signing | 2–4 h work, **days-to-weeks** calendar | Gated on an eligibility question nobody here can answer — see §8. |
| S7 | Auto-update | 6–12 | **Presumes S6.** Unsigned auto-update is a genuine security downgrade, not a shortcut. |
| S8 | Recurring | **6–20 h/yr** | Electron ships a major every 8 weeks and supports only the latest **three** — about 24 weeks per version. |

**"A window that loads the game" is 3–6 hours. "A signed, auto-updating, installable product" is 40–70 hours
plus calendar time you cannot compress.**

Decide these four **now**, because all four are expensive to change after the first public build: `appId`
(changing it orphans every install) · `productName`/`artifactName` (feeds `latest.yml`; changing it breaks
in-flight update checks) · NSIS `perMachine: false` (per-user is right for a game — no UAC) · **and the custom
scheme host `app://voltmarch`, because it is the storage origin, so changing it deletes everyone's saves.**

Realistic size: **~95–140 MB installer, ~250–450 MB installed** — estimated from a verified 150,206,516-byte
Electron runtime against our 13 MB `dist/`, and **it should be measured from one real build before that number
goes anywhere else.** Pin **Electron 43** (M150, Node 24.17.0, supported to 2027-01-05) rather than whatever
`npm i electron` resolves to; E41 goes EOL on 2026-08-25.

---

## 7. THE TESTING GAP — AND HOW TO NOT ROT

**None of the four gates can see an Electron main process.** With the desktop build deliberately out of CI,
*the only tests that will not rot are the ones that need no Electron* — so push the decisions **out** of the
main process:

- **Tier 1 (existing `npm test` gate, no Electron binary).** Factor every decision into pure modules:
  `desktop/src/flags.ts` returning the ordered switch list from a settings object; `desktop/src/app-url.ts`
  building the URL and query; `desktop/src/paths.ts` mapping a request path to a file under `dist/` — **which
  is also the traversal guard, and should be tested as one.**
- **Tier 2 (local only, `npm run desktop:test`, ~8 assertions).** Playwright's `_electron.launch` — already a
  devDependency. Assert: the window opened and the module script parsed; **an actual `idb.open()` resolves**
  (the storage guard — see below); the module worker spawned; `__VM.ready()` resolves; `__VM.gpuInfo()` reports
  the requested backend; **and a save written in run 1 is readable in run 2 after relaunch.**
- **Tier 3 (existing gate, structural).** A flag-vocabulary test, plus an assertion that `desktop/**` never
  imports from `src/` game code — the same shape as the four-file import closure `server/tsconfig.json` already
  enforces.

**Why the storage assertion is the load-bearing one.** `SaveStore.indexedDbOrNull()` tests only that the global
exists — it never calls `open()`. Chromium exposes `window.indexedDB` on an opaque origin and fails at open time,
so `detectBackend()` returns an `IndexedDbBackend` that throws on write rather than falling through to a memory
backend. Worse, `detectIndexStorage()` has **no IndexedDB tier at all** and falls straight to `MemoryIndex`. So
the real signature of a mis-registered scheme is **"saves error on write, and the save list is empty next
launch"** — not the silent in-memory loss you would guess. Get `standard: true` right and none of it happens;
assert it anyway, because nothing else will.

**Two more silent-failure paths worth an explicit probe.** The texture worker (`spawn.ts:44`, the only
`new Worker(` in the project) fails via `worker.onerror` → `TexturePool.disable()`, **not** via the constructor
try/catch — so a startup probe that checks whether `spawnTextureWorker()` returned non-null will report a
healthy worker on a scheme where the worker is dead. And a failed `.ogg` fetch degrades to the synthesised bank
rather than to silence, so a broken audio path is invisible without reading the console.

---

## 8. WHAT STOPS BEING TRUE THE DAY THIS SHIPS

This repo's named defect class is *claims that quietly stop being true*. **The desktop target manufactures
eleven of them in one commit.** Enumerated by grep over the real tree:

```
CLAUDE.md:7        "an original browser RTS"
README.md:6        "runs in the browser"
README.md:12       the PLAY IN BROWSER badge
README.md:42       "built for the browser"
README.md:99       "'Shipped' means public/ — what the browser downloads"
package.json:6     "for the browser"
index.html:8       meta description "running in the browser"
wiki/Home.md:3     "runs in a browser tab"
wiki/Campaign.md:34  "stored per browser profile. Deleting site data..."   <- flatly wrong on desktop
server/README.md:98  "a browser blocks a plaintext socket from an https page"
wiki/Multiplayer.md:58  "a browser refuses a plaintext socket from a secure page"
```

The last two are the serious ones: **they are the stated reason the relay does not need its own transport
check**, and they are claims about a browser enforcing something the desktop target does not enforce. See §4.2.

**And a fourth non-generated-asset category.** CLAUDE.md's list is Rajdhani (60 kB), the brand PNGs (2.0 MB)
and the audio (6.9 MB) — 9 MB, all in `public/`. Electron adds **~150 MB** of Chromium, Node, V8 and ffmpeg to
what reaches a player, with real attribution obligations (Electron ships `LICENSES.chromium.html`; the bundled
ffmpeg is LGPL-2.1). The trap is mechanical: **`tests/credits-truthful.spec.ts` checks the credits screen
against `public/`, and the Electron runtime is not in `public/`.** The test goes on passing at full green while
the credits screen becomes materially less true — *a green build proving nothing*, already on this repo's list
of things that have gone wrong. Extend the test to require a desktop-runtime credit whenever a desktop target
is configured.

---

## 9. DISTRIBUTION — DEFERRED, WITH ONE BLOCKING QUESTION

Not needed for S0–S4, but two facts change the usual advice:

- **EV certificates no longer bypass SmartScreen.** Microsoft removed the instant-reputation grant around 2024,
  and their docs now list self-signed as *"Same behavior as no signature"*. Unsigned gets a **"Strong SmartScreen
  block"**, and Windows 11's Smart App Control blocks unsigned execution *unless the file has positive reputation*.
  Reputation does not transfer between versions **unless both were signed under the same publisher identity**.
- **The cheap option has a geographic gate.** Azure Artifact Signing is **$9.99/month** — by far the best value —
  but is restricted to US/Canada/EU/UK entities, and individual developers to the USA and Canada. **This is the
  one question in the whole document I cannot answer and that blocks a real decision: where is the developer
  established?** If outside, the options collapse to a ~$150–500/yr OV certificate on a hardware token, a cloud-HSM
  service, or shipping unsigned.

**For a game, itch.io is probably the better first channel anyway:** free, real delta patching via butler/wharf
(NSIS blockmap deltas measurably do not deliver — budget a full ~100 MB download per update), its client sidesteps
SmartScreen, and **it hosts the web build on the same page**. Steam is $100 plus steamworks.js. Declare
`publish: { provider: github }` in `electron-builder.yml` from day one — inert without `--publish`, and it means
the CI job that arrives later is a workflow file rather than a config archaeology exercise. That workflow is a
**new** `.github/workflows/desktop.yml` on `tags: ['v*']`, never an edit to `deploy.yml`.

---

## 10. WHEN NOT TO DO THIS

Five circumstances, stated properly, because a plan that only argues its own side is worth less:

1. **If §1 shows the switch does nothing under Electron on Windows.** The wrapper's remaining GPU value is only
   the per-EXE registry key — still real, but a much smaller prize for 150 MB of Chromium and a permanent CVE
   subscription. Re-argue it on those terms.
2. **If the audience is people you send a link to.** A ~120 MB unsigned download behind a SmartScreen block
   converts far worse than a URL. The web build's whole advantage is that it costs one click, and the README
   already leads with a PLAY IN BROWSER badge.
3. **If nobody will do the §8 doc pass.** Shipping the code without it is shipping the exact bug
   `SPEC_DRIFT_AUDIT.md` exists to prevent, with `credits-truthful.spec.ts` structurally unable to notice.
4. **If auto-update is wanted but signing is not eligible or affordable.** electron-updater works unsigned today
   but master carries a deprecation warning that **v28 will fail closed**.
5. **If "not in CI for now" means forever.** Tier-2 tests then run only when someone remembers, and the first
   person to observe the rot is a player — which is the failure mode `npm run shots` photographing another
   worktree's build already taught this project to fear.

**The cheapest alternative that captures part of the benefit** is a Chrome `.bat` launcher with the flags. It
does work — and it **silently orphans the player's saves**, because a different `--user-data-dir` is a different
storage origin. An installed PWA is the best non-Electron desktop UX and captures every benefit **except the one
actually being asked for.**

---

## 11. OPEN QUESTIONS

Named rather than guessed, because a named unknown is worth more than a confident wrong answer:

1. ~~**Does the switch move the adapter on this hardware?**~~ **ANSWERED 2026-08-17: yes.** §1.
2. ~~**Does Dawn honour `FORCE_HIGH_PERFORMANCE_GPU`, or only ANGLE?**~~ **ANSWERED: it follows.** §1.
   `--use-webgpu-power-preference` / `--use-webgpu-adapter` remain fallbacks for hardware where it does not.
3. **Does `app.commandLine.appendSwitch` reach the GPU process?** §1.1. **This is now the blocking unknown**
   — gate zero measured plain Chromium on the command line, not Electron's call path.
4. **Does `secure: true` re-arm mixed-content blocking against `ws://` on a LAN IP?** §4.2. Decides whether LAN
   play means host-locally or join-a-friend's-box.
5. **Does a module worker load from `app://`?** Same-origin logic says yes; no primary source confirms Blink
   permits module-worker script URLs on a non-http standard scheme. **The failure is silent** — look for
   `[textures] worker unavailable` on the first desktop boot.
6. **Where is the developer established?** §9. Blocks the signing decision entirely.
7. ~~**Does §7g need re-taking?**~~ **ANSWERED: no.** Gate zero reproduced `amd`/`gcn-5` twice on a browser
   with no `UserGpuPreferences` entry, so the finding stands as written.
8. **Should the desktop build default to `?gpu=webgpu`?** The runtime is known and §7f measured 1.74–1.89×, so
   the argument is far stronger than on the web — but `raiseGpuFailure`'s "Continue on WebGL" reload path has
   never been tested under an `app://` origin.
9. **Should desktop share progression with web?** `app://voltmarch` is a different storage partition, so desktop
   players start empty. `profile-store` already ships export/import; whether that becomes a first-run "import
   from web" affordance is a product call nobody has made.
10. **With desktop out of CI, what MECHANISM stops the two targets diverging?** §7 is the proposal. *A reviewer
   noticing is not a mechanism* — this repo's own standing verdict.

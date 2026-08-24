# VOLTMARCH — desktop shell

The Electron wrapper. **It contains no game code and never will** — it serves the unmodified
`dist/` from the root `vite build` as opaque bytes, and `tests/desktop-shell.spec.ts` fails if a
file here ever imports from `src/` or from `three`. Same boundary, same reason, as
[`server/README.md`](../server/README.md).

The plan that produced it has been extracted and deleted; its rules are in `CLAUDE.md`, its
measurements in `docs/RENDER_FINDINGS.md`, and what it left undone is in the task list.
This file is how to run it.

```bash
npm run build          # ROOT. produces dist/ — the desktop shell serves this, unmodified
npm ci --prefix desktop
npm run desktop        # build main + preload, then launch
```

| script | what it does |
|---|---|
| `npm run desktop` | build and launch from source |
| `npm run desktop:build` | esbuild main.ts + preload.ts into `desktop/out/` |
| `npm run desktop:dist` | package NSIS installer + portable exe into `desktop/release/` |
| `npm run desktop:smoke` | tier-2 verification against a real Electron (needs the binary) |
| `npm run desktop:typecheck` | **not part of `npm run typecheck`** — see below |

## Why this directory has its own package.json

The same reason `server/` does, and it is what satisfies *"github pages deployment continue as is"*.
The `electron` npm package's postinstall downloads a **144 MB** platform binary. In the root
devDependencies that would land on every Pages CI run, for a workflow that never uses it. Here, root
`npm ci` never sees it and **`.github/workflows/deploy.yml` needs zero edits**.

The same logic is why `desktop:typecheck` is a separate script rather than a fifth invocation inside
`npm run typecheck`: appending it would fail Pages CI on `TS2307: Cannot find module 'electron'`
unless `deploy.yml` also gained `npm ci --prefix desktop`. The tag-only `desktop.yml` workflow
installs that package and invokes both gates; Pages remains unaware of Electron. This is the
identical trap CLAUDE.md documents for `server/node_modules`.

## The three things that are easy to get wrong

**1. `app://`, not `file://`.** A custom scheme registered `standard + secure + supportFetchAPI +
codeCache`. Each privilege is load-bearing and each failure is silent:

- `standard` — gives the custom scheme normal origin semantics and lets bridge v6 import old
  renderer state once. Active desktop persistence no longer uses that origin.
- `secure` — `navigator.gpu` is `[SecureContext]`-gated. Without it `?gpu=webgpu` is permanently
  unreachable through `raiseGpuFailure`, i.e. the 1.74–1.89× faster renderer is dead on desktop.
- `supportFetchAPI` — the 184 Ogg files. A failure degrades to the synthesised bank, not to silence.

**2. `will-navigate` must allow our own origin.** Copy Electron's security checklist verbatim and
you break *starting a match*. `Shell.hardLaunch` calls `location.assign`, and the GPU-failure panel's
"Continue on WebGL" and "Retry" buttons call `location.replace`. All three are renderer-initiated, so
they do fire `will-navigate`. And **never compare `.origin`** — `new URL('app://voltmarch/x').origin`
is the string `'null'` in the main process, because Node's URL parser knows nothing about a
privileged-scheme registration.

**3. Switches must be appended before `app.whenReady()`.** The GPU process launches after `ready`
with whatever command line the browser process had *at launch*. Append later and it is a silent
no-op. The effect site in `gpu_init.cc` is also conjoined with `&& system_device_id_high_perf`, so it
can no-op with no log line — which is why `main.ts` **reads the adapter back** on every boot rather
than assuming.

## Settings and the escape hatch

`userData/desktop-settings.json`, read before `app.whenReady()`:

```json
{
  "forceHighPerformanceGpu": true,
  "unlockFrameRate": false,
  "ignoreGpuBlocklist": false,
  "display": { "mode": "windowed", "width": 1600, "height": 900, "displayIndex": -1 }
}
```

**The first three are edited from Options → Graphics → Display now**, along with window mode,
window size and which monitor. That section is desktop-only: it renders from
`src/platform/desktop.ts`, which returns null in a browser, so the web build draws nothing extra
and downloads nothing extra.

Two things about that section are worth knowing before changing it.

All renderer-owned persistent state uses the native bridge. Small versioned records share
`userData/storage/state.json`; binary snapshots are individual files under
`userData/storage/saves/`. The browser build keeps localStorage/IndexedDB as its web fallback.
Electron selects `filesystem` first and only consults the old stores to import a pre-v5 value.

**There are two window modes, not three, and it is a platform fact.** Chromium has no
mode-setting path, so `setFullScreen(true)` is a borderless window sized to the monitor. Offering
both "Fullscreen" and "Borderless Windowed" would be two labels for one behaviour, so the UI ships
two options and the row says which one it is. See the header of `src/display.ts`.

**Window mode, size and monitor apply immediately; the GPU and frame-rate rows cannot.** Chromium
switches are appended before `app.whenReady()`, so those two are persisted and `relaunchPending`
goes true, which is what puts the *Restart Required* row on screen. A settings row that silently
does nothing until some unstated later moment is the failure being avoided — and the reason the
main process compares against `launchedWith` (what this process actually started with) rather than
against defaults.

`displayIndex` is an INDEX, not electron's `Display.id`: those ids are not stable across a reboot
or a cable swap on Windows, so a stored id resolves to nothing and the choice is silently lost.
`-1` means "wherever the OS puts it" and is deliberately distinct from `0` ("force the primary").

`VOLTMARCH.exe --vm-safe-mode` ignores the file entirely: no GPU switches, and **default window
placement too**. That is not belt-and-braces, and the window half is not symmetry for its own sake
— a stored monitor index that now points at a display which is off, unplugged or reporting bad
bounds opens the window somewhere the player cannot see, and in fullscreen there is not even a
title bar to drag it back by. Both settings are applied before any UI exists, so both need the
same escape hatch.

Boot flags reach the renderer as an ordinary query string — `--webgpu`, or `--vm-<flag>=<value>` for
anything on the allowlist in `src/app-url.ts`. Unknown flags are dropped.

## Release updates

Installed NSIS builds check the GitHub release channel 20 seconds after launch and every four
hours. A result never covers a match: the prompt is retained by the main process and appears on
the title screen. Downloads start only after the player chooses **Download Update**, and install
only after **Restart & Update** (or when the player later quits after a completed download).
The explicit restart applies the update in silent NSIS mode: Windows still has to close the game
before replacing its locked executable and resources, but the ordinary setup wizard never appears
and the new build launches automatically when the file swap finishes.
Settings → Updates is the manual check and recovery route, and also links to the latest and full
GitHub release archive.

Portable builds use the same release discovery but cannot safely replace their running
self-extracting executable. They show **Open Download Page** instead. Development builds never
contact GitHub automatically.

Every version tag runs `.github/workflows/desktop.yml`, which publishes all four updater-critical
assets with deterministic URL-safe names: installer, installer blockmap, portable executable and
`latest.yml`. Do not upload only the two executables: the installed updater cannot discover or
verify a release without the manifest and blockmap. The first updater-capable version still needs
one manual install; updates after that are in-app.

After the Windows job publishes the GitHub release, the separate `discord` job reads those exact
generated notes back through `gh` and posts them through the `DISCORD_RELEASE_WEBHOOK_URL`
repository secret. The Discord card contains the readable summary and release link; the complete,
unabridged Markdown log is attached. Keeping this as a dependent job is intentional: a Discord
failure can be retried without rebuilding or republishing the release.

## Verification

`npm test` covers the decision modules and the import boundary with **no Electron binary**.
The tag-only Windows workflow installs the desktop dependencies, repeats the full source gates,
then builds the real release artifacts. `npm run desktop:smoke` covers what only a local real
Electron can: that the scheme serves the module
bundle, that native state and binary save files survive a relaunch,
that the texture worker did not silently disable itself, that no CSP violation fired, and that the
main process and the renderer **agree** about which GPU is active.

Measured 2026-08-17 on an RTX 3080 laptop, packaged build:

```
installer   104.3 MB      installed  359.6 MB
default     0x10de:0x249c  NVIDIA GeForce RTX 3080 Laptop GPU
--vm-safe-mode  0x1002:0x1638  AMD Radeon (integrated)
```

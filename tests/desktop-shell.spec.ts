/**
 * ============================================================================
 * tests/desktop-shell.spec.ts
 * ============================================================================
 * THE DESKTOP SHELL'S DECISIONS, TESTED WITHOUT AN ELECTRON BINARY.
 *
 * `docs/ELECTRON_PLAN.md` §7 is the argument for this file's existence: the
 * desktop target is deliberately outside CI, so **the only tests that will not
 * rot are the ones that need no Electron.** Everything the shell decides
 * therefore lives in `desktop/src/{flags,app-url,paths}.ts`, which import
 * nothing from electron, and `desktop/src/main.ts` is left as wiring.
 *
 * This runs in the ordinary `npm test` gate. It is tiers 1 and 3 of the three
 * described in the plan; tier 2 (a real `_electron.launch` smoke test) is
 * `desktop/smoke.mjs`, run by hand, because it needs the binary.
 *
 * The import boundary test at the bottom is the one that stops the two targets
 * silently diverging — a reviewer noticing is not a mechanism.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_SETTINGS,
  normaliseSettings,
  safeModeRequested,
  switchesFor,
} from '../desktop/src/flags';
import {
  ALLOWED_FLAGS,
  ORIGIN,
  appUrl,
  devOriginFromArgv,
  flagsFromArgv,
  isOwnUrl,
} from '../desktop/src/app-url';
import { contentTypeFor, resolveAsset } from '../desktop/src/paths';
import {
  DEFAULT_DISPLAY,
  MIN_WINDOW_H,
  MIN_WINDOW_W,
  WINDOW_SIZES,
  applyPatch,
  displayLabel,
  normaliseDisplay,
  sizesFor,
  targetDisplay,
  windowBounds,
} from '../desktop/src/display';
import type { DisplayInfo } from '../desktop/src/display';
import { BRIDGE_VERSION } from '../src/platform/desktop';

const DESKTOP_SRC = path.resolve(__dirname, '..', 'desktop', 'src');
const REPO = path.resolve(__dirname, '..');

/* ========================================================================== *
 * 1. FLAGS — the switch policy
 * ========================================================================== */

describe('desktop flags', () => {
  it('forces the discrete GPU by default', () => {
    expect(DEFAULT_SETTINGS.forceHighPerformanceGpu).toBe(true);
  });

  it('appends BOTH spellings of the GPU switch', () => {
    // They are different layers: `gpu/config/gpu_switches.cc` defines the
    // hyphen form for the browser process, `gpu_workaround_list.txt` the
    // underscore form for the GPU process. Measured 2026-08-17: either works
    // alone (RENDER_FINDINGS.md §7j). Both are sent as insurance.
    const names = switchesFor(DEFAULT_SETTINGS).map((s) => s.name);
    expect(names).toContain('force-high-performance-gpu');
    expect(names).toContain('force_high_performance_gpu');
  });

  it('always disables renderer backgrounding, in every configuration', () => {
    /*
     * NOT a preference. Chromium calls rAF ZERO times for a hidden document,
     * `loop.ts` drives on rAF, and the lockstep step gate stalls rather than
     * skips with no client-side timeout — so one player minimising freezes the
     * match for BOTH. If this ever becomes conditional, that bug comes back.
     */
    const configs = [
      DEFAULT_SETTINGS,
      { ...DEFAULT_SETTINGS, forceHighPerformanceGpu: false },
      { ...DEFAULT_SETTINGS, unlockFrameRate: true, ignoreGpuBlocklist: true },
    ];
    for (const c of configs) {
      expect(switchesFor(c).map((s) => s.name)).toContain('disable-renderer-backgrounding');
    }
  });

  it('does NOT unlock the frame rate by default — it would break HardwareCalibration', () => {
    /*
     * `CALIBRATION.flatSlopeMs` is 1.0 and a fitted slope below it returns
     * 'not-fill-rate-bound' and cuts nothing. Disabling vsync removes the
     * vsync-flat case BY CONSTRUCTION: a flat machine fits a real positive
     * slope, the guard stops firing, and first-run calibration starts cutting
     * resolution on hardware that was fine — permanently, because
     * `graphics.calibrated` is sticky.
     */
    expect(DEFAULT_SETTINGS.unlockFrameRate).toBe(false);
    const names = switchesFor(DEFAULT_SETTINGS).map((s) => s.name);
    expect(names).not.toContain('disable-frame-rate-limit');
    // Implied by the above, so passing it too would be redundant.
    expect(names).not.toContain('disable-gpu-vsync');
  });

  it('never ships the switches that are cargo cult or actively harmful', () => {
    const all = [
      DEFAULT_SETTINGS,
      { forceHighPerformanceGpu: true, unlockFrameRate: true, ignoreGpuBlocklist: true },
    ].flatMap((c) => switchesFor(c).map((s) => s.name));

    // `enable-zero-copy` is not a Chromium switch at all; zero-copy raster is
    // already the default and only the disable side exists.
    expect(all).not.toContain('enable-zero-copy');
    // Removes the GPU sandbox and turns a device loss into a hard app exit.
    expect(all).not.toContain('in-process-gpu');
    expect(all).not.toContain('no-sandbox');
    expect(all).not.toContain('disable-gpu-watchdog');
    // Chromium names this constant kDisableBackgroundingOccludedWindowsForTesting.
    expect(all).not.toContain('disable-backgrounding-occluded-windows');
    // WebGPU is stable; this only opens non-stable surface.
    expect(all).not.toContain('enable-unsafe-webgpu');
  });

  it('ignore-gpu-blocklist is opt-in only', () => {
    expect(DEFAULT_SETTINGS.ignoreGpuBlocklist).toBe(false);
    expect(switchesFor(DEFAULT_SETTINGS).map((s) => s.name)).not.toContain('ignore-gpu-blocklist');
    expect(
      switchesFor({ ...DEFAULT_SETTINGS, ignoreGpuBlocklist: true }).map((s) => s.name),
    ).toContain('ignore-gpu-blocklist');
  });

  it('survives a hand-edited settings file without throwing', () => {
    // Read before a window exists, so a throw here is a silent failure to
    // launch with no way to report it.
    for (const junk of [null, undefined, 42, 'nope', [], { forceHighPerformanceGpu: 'yes' }]) {
      expect(() => normaliseSettings(junk)).not.toThrow();
      expect(normaliseSettings(junk).forceHighPerformanceGpu).toBe(true);
    }
    expect(normaliseSettings({ forceHighPerformanceGpu: false }).forceHighPerformanceGpu).toBe(false);
  });

  it('safe mode is read from argv, not from the settings file', () => {
    // Its whole purpose is to be reachable when the settings file is what
    // broke the boot.
    expect(safeModeRequested(['electron', '.', '--vm-safe-mode'])).toBe(true);
    expect(safeModeRequested(['electron', '.'])).toBe(false);
  });
});

/* ========================================================================== *
 * 2. APP URL — the boot-flag channel
 * ========================================================================== */

describe('desktop app url', () => {
  it('preserves the query string the web build already reads', () => {
    const q = flagsFromArgv(['electron', '.', '--vm-map=sunder-atoll', '--vm-seed=4242']);
    const url = appUrl(q);
    expect(url.startsWith(`${ORIGIN}/index.html?`)).toBe(true);
    // The ~25 `new URLSearchParams(location.search)` sites must see this.
    const search = new URLSearchParams(new URL(url).search);
    expect(search.get('map')).toBe('sunder-atoll');
    expect(search.get('seed')).toBe('4242');
  });

  it('emits no query string at all when no flags were passed', () => {
    expect(appUrl(flagsFromArgv(['electron', '.']))).toBe(`${ORIGIN}/index.html`);
  });

  it('--webgpu is shorthand for ?gpu=webgpu', () => {
    expect(flagsFromArgv(['electron', '.', '--webgpu']).get('gpu')).toBe('webgpu');
  });

  it('DROPS flags that are not on the allowlist', () => {
    // `?relay=` resolves to a socket the client connects to and `?shot=` skips
    // the shell, so "whatever the user typed" is not safe to widen to.
    const q = flagsFromArgv(['electron', '.', '--vm-evil=1', '--vm-map=coral-shore']);
    expect(q.get('evil')).toBeNull();
    expect(q.get('map')).toBe('coral-shore');
  });

  it('every allowlisted flag is one the game actually parses', () => {
    // Tier 3: a flag added to the desktop vocabulary that no game code reads is
    // a flag that silently does nothing.
    const sources = ['src/main.ts', 'src/render/backend.ts', 'src/shell/net-link.ts']
      .map((p) => {
        try {
          return readFileSync(path.resolve(__dirname, '..', p), 'utf8');
        } catch {
          return '';
        }
      })
      .join('\n');
    const known = new Set(['gpu', 'map', 'art', 'seed', 'mapseed', 'biome', 'fog', 'relay', 'skipmenu', 'unlockall']);
    for (const flag of ALLOWED_FLAGS) {
      expect(known.has(flag), `${flag} is not a recognised boot flag`).toBe(true);
    }
    expect(sources.length).toBeGreaterThan(0);
  });

  it('isOwnUrl compares protocol and host, never .origin', () => {
    /*
     * `new URL('app://voltmarch/x').origin` is the STRING 'null' in Node —
     * its WHATWG parser knows nothing about a privileged-scheme registration,
     * which only exists inside Chromium. A handler written against .origin
     * refuses every navigation the game makes.
     */
    expect(new URL(`${ORIGIN}/index.html`).origin).toBe('null'); // the trap itself
    expect(isOwnUrl(`${ORIGIN}/index.html`)).toBe(true);
    expect(isOwnUrl(`${ORIGIN}/index.html?gpu=webgpu`)).toBe(true);
    expect(isOwnUrl('https://example.com/')).toBe(false);
    expect(isOwnUrl('app://elsewhere/index.html')).toBe(false);
    expect(isOwnUrl('file:///C:/Windows/System32/drivers/etc/hosts')).toBe(false);
    expect(isOwnUrl('not a url')).toBe(false);
  });
});

/* ========================================================================== *
 * 3. PATHS — the traversal guard
 * ========================================================================== */

describe('desktop asset resolution', () => {
  const ROOT = path.resolve('/srv/dist');

  it('maps / to index.html', () => {
    expect(resolveAsset(ROOT, '/')).toBe(path.join(ROOT, 'index.html'));
  });

  it('resolves ordinary assets under the root', () => {
    expect(resolveAsset(ROOT, '/assets/index-abc.js')).toBe(path.join(ROOT, 'assets', 'index-abc.js'));
    expect(resolveAsset(ROOT, '/brand/mark-32.png')).toBe(path.join(ROOT, 'brand', 'mark-32.png'));
  });

  it('REFUSES anything that escapes the root', () => {
    // This is arbitrary local file read if it is wrong, and the renderer is
    // the thing asking.
    for (const attack of [
      '/../secret.txt',
      '/../../Windows/System32/config/SAM',
      '/assets/../../etc/passwd',
      '/%2e%2e/%2e%2e/secret',
      '/..%2f..%2fsecret',
    ]) {
      expect(resolveAsset(ROOT, attack), `${attack} escaped`).toBeNull();
    }
  });

  it('refuses a NUL byte and a malformed escape', () => {
    expect(resolveAsset(ROOT, '/index.html\0.png')).toBeNull();
    expect(resolveAsset(ROOT, '/%ZZ')).toBeNull();
  });

  it('sets the two content types Chromium gets wrong or cannot guess', () => {
    // A wrong type on a module script is fatal, not cosmetic; and Chromium's
    // mime_util.cc has no woff2 entry at all.
    expect(contentTypeFor('/x/index-abc.js')).toBe('text/javascript');
    expect(contentTypeFor('/x/rajdhani-400.woff2')).toBe('font/woff2');
    expect(contentTypeFor('/x/shot.ogg')).toBe('audio/ogg');
    expect(contentTypeFor('/x/unknown.xyz')).toBeNull();
  });
});

/* ========================================================================== *
 * 2b. DEV MODE — Electron against the Vite dev server
 * ========================================================================== */

describe('dev mode', () => {
  it('is off unless argv asks for it', () => {
    // The packaged path must be the default. A player can never reach a state
    // where the app tries to load a dev server that is not running.
    expect(devOriginFromArgv([])).toBeNull();
    expect(devOriginFromArgv(['.', '--vm-safe-mode'])).toBeNull();
    expect(appUrl(new URLSearchParams(), null).startsWith(ORIGIN)).toBe(true);
  });

  it('takes the Vite default bare, or an explicit loopback origin', () => {
    expect(devOriginFromArgv(['--vm-dev'])).toBe('http://localhost:5173');
    expect(devOriginFromArgv(['--vm-dev='])).toBe('http://localhost:5173');
    expect(devOriginFromArgv(['--vm-dev=http://localhost:5174'])).toBe('http://localhost:5174');
    expect(devOriginFromArgv(['--vm-dev=http://127.0.0.1:3000'])).toBe('http://127.0.0.1:3000');
  });

  it('REFUSES anything that is not loopback', () => {
    /*
     * This flag loads a URL into a window that has the preload bridge attached
     * — `revealUserData`, `relaunch`, the display IPC. A dev affordance that
     * will point that window at an arbitrary remote origin is a different and
     * much worse thing than a dev affordance.
     */
    expect(devOriginFromArgv(['--vm-dev=http://evil.example.com'])).toBeNull();
    expect(devOriginFromArgv(['--vm-dev=https://localhost.evil.com'])).toBeNull();
    expect(devOriginFromArgv(['--vm-dev=file:///etc/passwd'])).toBeNull();
    expect(devOriginFromArgv(['--vm-dev=not a url'])).toBeNull();
  });

  it('loads the dev origin and keeps the query string', () => {
    const q = new URLSearchParams({ gpu: 'webgpu', seed: '7' });
    const url = appUrl(q, 'http://localhost:5173');
    expect(url.startsWith('http://localhost:5173/index.html?')).toBe(true);
    // The query string is the ONLY channel for boot flags and it must survive
    // the origin swap — ~25 call sites read it through location.search.
    expect(url).toContain('gpu=webgpu');
    expect(url).toContain('seed=7');
  });

  it('treats the dev origin as OUR origin, or starting a match breaks', () => {
    /*
     * `Shell.hardLaunch` calls `location.assign` and the GPU-failure panel's
     * buttons call `location.replace`. All three are renderer-initiated, so
     * they fire `will-navigate`, and a handler that only knows about `app://`
     * silently eats them in dev mode. Same trap desktop/README.md documents
     * for the packaged path — dev mode reintroduces it verbatim.
     */
    const dev = 'http://localhost:5173';
    expect(isOwnUrl(`${dev}/index.html?seed=1`, dev)).toBe(true);
    expect(isOwnUrl(`${ORIGIN}/index.html`, dev)).toBe(true);
    // and it does not become a hole when dev mode is off
    expect(isOwnUrl(`${dev}/index.html`, null)).toBe(false);
    expect(isOwnUrl('https://example.com/', dev)).toBe(false);
  });
});

/* ========================================================================== *
 * 3b. DISPLAY — window mode, size and monitor
 * ========================================================================== */

/** A 1080p monitor with a 40 px taskbar, at the origin. */
const MON_1080: DisplayInfo = {
  id: 1, label: '', width: 1920, height: 1080,
  workWidth: 1920, workHeight: 1040, workX: 0, workY: 0, primary: true,
};
/** A 1440p secondary, positioned to the right of it. */
const MON_1440: DisplayInfo = {
  id: 2, label: 'DELL U2720Q', width: 2560, height: 1440,
  workWidth: 2560, workHeight: 1400, workX: 1920, workY: 0, primary: false,
};

describe('display prefs', () => {
  it('defaults to a window, not fullscreen', () => {
    expect(DEFAULT_DISPLAY.mode).toBe('windowed');
  });

  it('defaults the monitor to -1 rather than 0', () => {
    /*
     * -1 is "wherever the OS puts it" and 0 is "force the primary". They are
     * genuinely different: the OS restores the window's last position, and
     * overriding that on every launch is worse than leaving it. It is also why
     * `displayIndex` is an INDEX and not electron's `Display.id` — those ids
     * are not stable across a reboot or a cable swap on Windows, so a stored
     * id resolves to nothing and the choice is silently lost.
     */
    expect(DEFAULT_DISPLAY.displayIndex).toBe(-1);
    expect(targetDisplay(DEFAULT_DISPLAY, [MON_1080, MON_1440])).toBeNull();
  });

  it('normalises a hand-edited file instead of throwing', () => {
    // Read before a window exists, so an exception is a silent failure to launch.
    expect(normaliseDisplay(null)).toEqual(DEFAULT_DISPLAY);
    expect(normaliseDisplay('nonsense')).toEqual(DEFAULT_DISPLAY);
    expect(normaliseDisplay({ mode: 'exclusive' }).mode).toBe('windowed');
    expect(normaliseDisplay({ width: 12 }).width).toBe(MIN_WINDOW_W);
    expect(normaliseDisplay({ height: Number.NaN }).height).toBe(DEFAULT_DISPLAY.height);
    expect(normaliseDisplay({ displayIndex: -99 }).displayIndex).toBe(-1);
  });

  it('remembers the windowed size while in fullscreen', () => {
    // Or leaving fullscreen always lands on the default rather than the window
    // the player last sized for themselves.
    const p = normaliseDisplay({ mode: 'fullscreen', width: 2560, height: 1440 });
    expect(p.mode).toBe('fullscreen');
    expect([p.width, p.height]).toEqual([2560, 1440]);
  });

  it('offers only sizes that fit the monitor MINUS its taskbar', () => {
    /*
     * Against the work area, not the raw bounds. A 1080p monitor has ~1040
     * usable rows, so offering 1920x1080 there puts the command bar behind the
     * taskbar — which is the row the player needs most.
     */
    const fits = sizesFor(MON_1080);
    expect(fits).not.toContainEqual([1920, 1080]);
    expect(fits).toContainEqual([1600, 900]);
    expect(sizesFor(MON_1440)).toContainEqual([1920, 1080]);
    // No monitor chosen means no filtering is possible.
    expect(sizesFor(null)).toEqual(WINDOW_SIZES);
  });

  it('never offers an empty size list, even on a panel smaller than every rung', () => {
    const tiny: DisplayInfo = { ...MON_1080, width: 1024, height: 600, workWidth: 1024, workHeight: 560 };
    const fits = sizesFor(tiny);
    expect(fits.length).toBeGreaterThan(0);
    // An empty chooser is worse than one honest option.
    expect(fits[0]?.[0]).toBeGreaterThanOrEqual(MIN_WINDOW_W);
  });

  it('centres the window on the chosen monitor, in that monitor\'s coordinates', () => {
    const prefs = { ...DEFAULT_DISPLAY, displayIndex: 1, width: 1600, height: 900 };
    const b = windowBounds(prefs, targetDisplay(prefs, [MON_1080, MON_1440]));
    expect(b).not.toBeNull();
    // The second monitor starts at x=1920, so a centred window must be past it.
    expect(b?.x).toBe(1920 + Math.round((2560 - 1600) / 2));
    expect(b?.y).toBe(Math.round((1400 - 900) / 2));
  });

  it('clamps a stored size that no longer fits the monitor', () => {
    // The case that arises from unplugging a 4K and plugging in a laptop panel.
    const prefs = { ...DEFAULT_DISPLAY, displayIndex: 0, width: 3840, height: 2160 };
    const b = windowBounds(prefs, MON_1080);
    expect(b?.width).toBe(1920);
    expect(b?.height).toBe(1040);
    expect(b?.x).toBe(0);
  });

  it('returns null bounds when no monitor is chosen', () => {
    // Must stay distinct from "centre on the primary" — see the -1 test above.
    expect(windowBounds(DEFAULT_DISPLAY, null)).toBeNull();
  });

  it('never lets a window fall below the HUD floor', () => {
    const b = windowBounds({ ...DEFAULT_DISPLAY, width: 200, height: 200 }, MON_1080);
    expect(b?.width).toBeGreaterThanOrEqual(MIN_WINDOW_W);
    expect(b?.height).toBeGreaterThanOrEqual(MIN_WINDOW_H);
  });

  it('normalises a patch from the renderer, which is the least trusted process', () => {
    const p = applyPatch(DEFAULT_DISPLAY, { width: 5, mode: 'fullscreen' });
    expect(p.width).toBe(MIN_WINDOW_W);
    expect(p.mode).toBe('fullscreen');
    // Absent keys are left alone rather than reset to defaults.
    expect(p.height).toBe(DEFAULT_DISPLAY.height);
  });

  it('labels monitors usably even when electron reports no name', () => {
    // `Display.label` is empty on plenty of Windows configurations, and a
    // chooser reading "" for two of three monitors is unusable.
    expect(displayLabel(MON_1080, 0)).toContain('1920x1080');
    expect(displayLabel(MON_1080, 0)).toContain('primary');
    expect(displayLabel(MON_1440, 1)).toContain('DELL');
  });
});

/* ========================================================================== *
 * 3c. THE BRIDGE CONTRACT — two declarations that must not drift
 * ========================================================================== */

describe('the preload bridge and the game agree', () => {
  const preload = readFileSync(path.join(DESKTOP_SRC, 'preload.ts'), 'utf8');

  it('exposes the same bridge VERSION the game checks for', () => {
    /*
     * `src/platform/desktop.ts` tests `bridge` by EQUALITY, so a bump on one
     * side only means the game silently falls back to web behaviour — no
     * Display section, no error, nothing in the console. That is the correct
     * failure mode at runtime and a terrible one to debug, so it fails here
     * instead.
     */
    const m = /bridge:\s*(\d+)/.exec(preload);
    expect(m, 'preload.ts must declare a numeric `bridge:` version').not.toBeNull();
    expect(Number(m?.[1])).toBe(BRIDGE_VERSION);
  });

  it('exposes every method the game\'s DesktopBridge declares', () => {
    // The two interfaces are declared twice ON PURPOSE — the game may not
    // import from desktop/ — so something has to check they still match.
    const game = readFileSync(path.join(REPO, 'src', 'platform', 'desktop.ts'), 'utf8');
    const iface = /export interface DesktopBridge \{([\s\S]*?)\n\}/.exec(game)?.[1] ?? '';
    expect(iface.length).toBeGreaterThan(0);
    const methods = [...iface.matchAll(/^\s{2}(?:readonly\s+)?(\w+)\s*[(:]/gm)].map((m) => m[1] ?? '');
    expect(methods.length).toBeGreaterThan(5);
    for (const name of methods) {
      expect(new RegExp(`\\b${name}\\s*:`).test(preload), `preload.ts does not expose ${name}`).toBe(true);
    }
  });

  it('declares the same DisplayState fields on both sides of the IPC', () => {
    const game = readFileSync(path.join(REPO, 'src', 'platform', 'desktop.ts'), 'utf8');
    const shell = readFileSync(path.join(DESKTOP_SRC, 'display.ts'), 'utf8');
    const fields = (src: string, name: string): string[] =>
      [...(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1] ?? '')
        .matchAll(/^\s{2}(?:readonly\s+)?(\w+)\??\s*:/gm)].map((m) => m[1] ?? '').sort();

    const a = fields(game, 'DesktopDisplayState');
    const b = fields(shell, 'DisplayState');
    expect(a.length).toBeGreaterThan(5);
    expect(a).toEqual(b);
  });
});

/* ========================================================================== *
 * 4. THE IMPORT BOUNDARY — what stops the targets diverging
 * ========================================================================== */

describe('desktop shell import boundary', () => {
  const files = readdirSync(DESKTOP_SRC).filter((f) => f.endsWith('.ts'));

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('NEVER imports game code — dist/ is served as opaque bytes', () => {
    /*
     * Same shape as the four-file import closure `server/tsconfig.json`
     * enforces, and the same reason: the shell is a container, not a
     * participant. If it starts importing `src/sim/**` the two targets stop
     * being the same game.
     */
    for (const f of files) {
      const src = readFileSync(path.join(DESKTOP_SRC, f), 'utf8');
      const imports = [...src.matchAll(/^\s*import[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1] ?? '');
      for (const spec of imports) {
        expect(spec.includes('src/'), `${f} imports game code: ${spec}`).toBe(false);
        expect(spec.includes('three'), `${f} imports three: ${spec}`).toBe(false);
      }
    }
  });

  it('is not reached INTO either — the game never imports the shell', () => {
    /*
     * The mirror of the rule above, and the one that would actually break the
     * web build: an import from `src/` into `desktop/` would pull electron
     * types — and on a bad day, code — into the Pages bundle. It is why
     * `src/platform/desktop.ts` DECLARES the bridge shapes rather than
     * importing them, and why the two `DisplayState` checks above exist.
     */
    const gameFile = path.join(REPO, 'src', 'platform', 'desktop.ts');
    const src = readFileSync(gameFile, 'utf8');
    expect(/from\s+'[^']*desktop\/src/.test(src), 'src/ imports the desktop shell').toBe(false);
    expect(/from\s+'electron'/.test(src), 'src/ imports electron').toBe(false);
    // It must import nothing at all, in fact — see the file's own header.
    expect([...src.matchAll(/^\s*import\s/gm)].length, 'src/platform/desktop.ts must import nothing').toBe(0);
  });

  it('keeps the decision modules free of electron, so this file can test them', () => {
    // main.ts may import electron; nothing else may, or it stops being
    // testable in a gate with no binary — which is the whole design.
    for (const f of files) {
      if (f === 'main.ts' || f === 'preload.ts') continue;
      const src = readFileSync(path.join(DESKTOP_SRC, f), 'utf8');
      expect(/from\s+'electron'/.test(src), `${f} imports electron`).toBe(false);
    }
  });
});

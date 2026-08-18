/**
 * ============================================================================
 * VOLTMARCH desktop — src/app-url.ts
 * ============================================================================
 * THE URL THE WINDOW LOADS, INCLUDING THE BOOT FLAGS.
 *
 * Imports nothing from electron. See `docs/ELECTRON_PLAN.md` §7.
 *
 * ----------------------------------------------------------------------------
 * THE QUERY STRING STAYS THE MECHANISM. DO NOT INVENT A SECOND ONE.
 * ----------------------------------------------------------------------------
 * `?gpu=`, `?map=`, `?seed=`, `?mapseed=`, `?relay=`, `?shot=` and the rest are
 * read at ~25 sites through `new URLSearchParams(location.search)`, and a
 * custom scheme preserves `location.search` byte-for-byte — the protocol
 * handler destructures `pathname` and never sees the query, so no file lookup
 * is affected. Three reasons not to replace it:
 *
 *   1. `tools/shoot.mjs`, `tools/desync-probe.mjs` and the replay system
 *      already read it.
 *   2. `Shell.bootGame` WRITES it back with `history.replaceState` on every
 *      match boot, so a parallel mechanism would immediately disagree with the
 *      address bar.
 *   3. It is the only channel that survives the `location.assign` reload in
 *      `Shell.hardLaunch`.
 *
 * And NOT `additionalArguments`: it appends to `process.argv` in the renderer,
 * but with `sandbox: true` + `contextIsolation: true` page code cannot see
 * `process` at all, so it would need re-exposing through the preload bridge —
 * at which point it is a worse query string that no existing call site reads.
 *
 * ----------------------------------------------------------------------------
 * TWO FLAG SYSTEMS, TWO LAYERS, NEVER MERGED
 * ----------------------------------------------------------------------------
 * `?gpu=webgpu` is a RENDERER flag read by `src/render/backend.ts` after the
 * page loads. Forcing the discrete GPU is a CHROMIUM COMMAND-LINE SWITCH that
 * must be appended before the GPU process launches. Different layers, different
 * timing. `flags.ts` owns the second; this file owns the first.
 * ============================================================================
 */

/** The scheme and host the app is served on. */
export const SCHEME = 'app';
export const HOST = 'voltmarch';
export const ORIGIN = `${SCHEME}://${HOST}`;

/**
 * Boot flags that may be set from the desktop command line, and nothing else.
 *
 * An allowlist rather than a passthrough. The renderer resolves `?relay=` into
 * a WebSocket it will connect to and `?shot=` into a harness path that skips
 * the shell, so "whatever the user typed" is not a safe input to widen to. A
 * flag added here is a deliberate act; `docs/ELECTRON_PLAN.md` §7 proposes a
 * test that fails when an unregistered one appears.
 */
export const ALLOWED_FLAGS: readonly string[] = [
  'gpu',
  'map',
  'art',
  'seed',
  'mapseed',
  'biome',
  'fog',
  'relay',
  'skipmenu',
  'unlockall',
];

/**
 * Build the query string from `process.argv`.
 *
 * Accepts `--vm-<flag>=<value>` (e.g. `--vm-map=sunder-atoll`) plus the
 * shorthand `--webgpu`. Unknown flags are DROPPED rather than passed through —
 * see `ALLOWED_FLAGS`.
 */
export function flagsFromArgv(argv: readonly string[]): URLSearchParams {
  const q = new URLSearchParams();
  if (argv.includes('--webgpu')) q.set('gpu', 'webgpu');

  for (const a of argv) {
    const m = /^--vm-([a-z]+)=(.*)$/.exec(a);
    if (m === null) continue;
    // Both groups are non-optional in the pattern, but `noUncheckedIndexedAccess`
    // types them `string | undefined` and it is right to make us say so.
    const name = m[1];
    const value = m[2];
    if (name === undefined || value === undefined) continue;
    if (!ALLOWED_FLAGS.includes(name)) continue;
    q.set(name, value);
  }
  return q;
}

/** The full URL to hand `win.loadURL`. */
export function appUrl(query: URLSearchParams, devOrigin: string | null = null): string {
  const qs = query.toString();
  const base = devOrigin ?? ORIGIN;
  return `${base}/index.html${qs === '' ? '' : '?' + qs}`;
}

/**
 * The Vite dev server to load instead of `app://`, or null for the normal path.
 *
 * `--vm-dev` alone takes the Vite default; `--vm-dev=http://localhost:5174`
 * names another. Parsed from argv rather than from the settings file, because
 * this is a developer affordance and must not be something a player can end up
 * in by editing JSON — a missing dev server would be an unrecoverable boot.
 *
 * ----------------------------------------------------------------------------
 * WHY THIS IS SAFE, AND THE ONE THING IT COSTS
 * ----------------------------------------------------------------------------
 * Both privileges the `app://` scheme exists for survive on loopback, which is
 * the only reason this is worth having rather than a trap:
 *
 *   - `secure`  — `http://localhost` is a "potentially trustworthy origin" per
 *                 the W3C definition, so it is a SecureContext and
 *                 `navigator.gpu` still exists. `?gpu=webgpu` works in dev.
 *   - `standard`— a real origin, so `localStorage` and `indexedDB` work, which
 *                 is what `SaveStore` needs.
 *
 * WHAT IT COSTS: the storage ORIGIN differs, so dev-mode saves, replays and
 * progression live in a separate profile from the packaged app. That is
 * usually what you want while developing and is occasionally baffling if you
 * forget, so `main.ts` logs the origin on every boot.
 *
 * The response-header CSP is applied by `protocol.handle`, which the dev server
 * bypasses entirely — so dev mode runs WITHOUT the CSP the packaged app
 * enforces. Acceptable for a developer flag pointed at your own machine; it is
 * also the reason this must never become a setting.
 */
export function devOriginFromArgv(argv: readonly string[]): string | null {
  const VITE_DEFAULT = 'http://localhost:5173';
  for (const a of argv) {
    if (a === '--vm-dev') return VITE_DEFAULT;
    if (a.startsWith('--vm-dev=')) {
      const raw = a.slice('--vm-dev='.length).trim();
      if (raw === '') return VITE_DEFAULT;
      try {
        const u = new URL(raw);
        // Loopback only. A dev flag that will load an arbitrary remote origin
        // into a window with a preload bridge attached is a different thing.
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        if (!isLoopbackHost(u.hostname)) return null;
        return u.origin;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** `localhost`, `127.0.0.0/8` and `[::1]` — nothing else is a dev server. */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Is this URL one of ours?
 *
 * **Never compare `.origin`.** `new URL('app://voltmarch/x').origin` is the
 * STRING `'null'` in the main process — Node's WHATWG parser knows nothing
 * about a privileged-scheme registration, which only exists inside Chromium.
 * Compare protocol and host.
 */
export function isOwnUrl(url: string, devOrigin: string | null = null): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === `${SCHEME}:` && u.host === HOST) return true;
    /*
     * IN DEV MODE THE DEV ORIGIN IS ALSO OURS, and forgetting this breaks
     * STARTING A MATCH rather than anything obviously URL-shaped.
     * `Shell.hardLaunch` calls `location.assign` and the GPU-failure panel's
     * two buttons call `location.replace`; all three are renderer-initiated,
     * so they fire `will-navigate` and a deny-all handler eats them. That trap
     * is already documented in `desktop/README.md` for the `app://` case — dev
     * mode reintroduces it verbatim unless the origin is allowed here too.
     */
    return devOrigin !== null && u.origin === devOrigin;
  } catch {
    return false;
  }
}

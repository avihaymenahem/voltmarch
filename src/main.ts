/**
 * RED ALERT — entry point.
 *
 * This file does five things and nothing else:
 *   1. parse the boot flags out of the URL (?shot ?map ?art ?tier ?seed)
 *   2. hand them to `src/game/Bootstrap.ts`
 *   3. keep the renderer sized to the viewport
 *   4. pause the sim when the tab is hidden
 *   5. make sure a failure is a readable message on screen, never a black page
 *
 * It deliberately knows almost nothing about the game. Everything real lives
 * behind Bootstrap.
 */

declare global {
  /** Compiled out of production builds — see `define` in vite.config.ts. */
  const __DEV__: boolean;

  interface Window {
    /** Curtain status line. Defined by the inline shell script in index.html. */
    __raStatus?(text: string): void;
    /** Curtain error surface. Defined by the inline shell script in index.html. */
    __raFail?(title: string, detail: string, state?: 'error' | 'pending'): void;
    /* `window.__RA` — the scripting/capture handle — is declared by
       src/render/debug.ts, which owns it. Declaring it here as well would be a
       TS2717 duplicate-property conflict. */
  }
}

/* -------------------------------------------------------------------------- */
/* Boot flags                                                                  */
/* -------------------------------------------------------------------------- */

const query = new URLSearchParams(location.search);

function flag(name: string): string | null {
  const v = query.get(name);
  return v === null || v === '' ? null : v;
}

function intFlag(name: string): number | null {
  const v = flag(name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mount<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`index.html is missing the #${id} mount point`);
  return el;
}

const options = {
  canvas: mount<HTMLCanvasElement>('gl'),
  hudRoot: mount('hud-root'),
  menuRoot: mount('menu-root'),
  debugRoot: mount('debug-root'),
  /** Freeze the sim and pose the camera for a diffable screenshot. */
  shot: flag('shot'),
  /** Map preset name. */
  map: flag('map'),
  /** ArtDirection mood preset: noon | dusk | night | overcast | dust. */
  art: flag('art'),
  /** Quality tier override: low | medium | high | ultra. */
  tier: flag('tier'),
  /** Deterministic RNG seed. */
  seed: intFlag('seed'),
};

/* -------------------------------------------------------------------------- */
/* Curtain                                                                     */
/* -------------------------------------------------------------------------- */

const curtain = document.getElementById('loading');

function status(text: string): void {
  window.__raStatus?.(text);
}

function fail(title: string, detail: unknown, state: 'error' | 'pending' = 'error'): void {
  const body =
    detail instanceof Error ? (detail.stack ?? `${detail.name}: ${detail.message}`) : String(detail);
  // 'pending' is an expected state, not a fault — keep it out of console.error so
  // it never shows up in the screenshot harness's error report.
  (state === 'pending' ? console.info : console.error)(`[RA] ${title}\n${body}`);
  window.__raFail?.(title, body, state);
}

function dismissCurtain(): void {
  if (!curtain || curtain.dataset.state === 'error') return;
  curtain.classList.add('is-hidden');
  window.setTimeout(() => {
    curtain.hidden = true;
  }, 700);
}

/** Resolves after two presented frames, i.e. once something is actually on screen. */
function nextPresentedFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/* -------------------------------------------------------------------------- */
/* Game handle                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `src/game/Bootstrap.ts` owns the engine API. main.ts deliberately keeps only
 * the four calls it actually makes, so this file never becomes a second place
 * where that API is defined.
 */
import { bootstrap, type GameHandle } from './game/Bootstrap';

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

let game: GameHandle | null = null;

async function main(): Promise<void> {
  status('Loading systems');

  status('Building world');
  game = bootstrap(options);

  status('Compiling shaders');
  await game.ready;
  game.start();

  installViewportHandlers();
  installLifecycleHandlers();

  await nextPresentedFrame();
  status('Ready');
  dismissCurtain();
}

/* -------------------------------------------------------------------------- */
/* Viewport                                                                    */
/* -------------------------------------------------------------------------- */

let resizePending = false;

function pushViewportSize(): void {
  resizePending = false;
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  game?.resize?.(w, h, dpr);
}

function requestResize(): void {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(pushViewportSize);
}

function installViewportHandlers(): void {
  window.addEventListener('resize', requestResize, { passive: true });
  // Fires when the window moves between monitors with different scaling.
  window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', requestResize);
  pushViewportSize();
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

function installLifecycleHandlers(): void {
  // A hidden tab gets throttled rAF; without this the accumulator would try to
  // catch up on return and burn its whole substep budget.
  document.addEventListener('visibilitychange', () => {
    game?.setPaused?.(document.hidden);
  });

  // WebGL context loss is recoverable-ish, but silently dying is not acceptable.
  options.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    fail('Graphics Context Lost', 'The WebGL context was lost. Reload to continue.');
  });
}

/* -------------------------------------------------------------------------- */

main().catch((err) => fail('Boot Failure', err));

if (import.meta.hot) {
  import.meta.hot.dispose(() => game?.dispose?.());
}

export {};

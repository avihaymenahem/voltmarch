/**
 * VOLTMARCH — entry point.
 *
 * This file does five things and nothing else:
 *   1. parse the boot flags out of the URL (?shot ?map ?art ?tier ?seed ?skipmenu)
 *   2. choose between the TWO boot paths those flags select
 *   3. keep the renderer sized to the viewport
 *   4. pause the sim when the tab is hidden
 *   5. make sure a failure is a readable message on screen, never a black page
 *
 * THE TWO BOOT PATHS
 * ------------------
 *   HARNESS  `?shot=<name>` — straight into the posed scenario through
 *            `bootstrap()`, exactly as before. No shell, no menu, no stylesheet,
 *            no state machine. `tools/shoot.mjs` and the entire visual critique
 *            loop depend on this path being untouched, and it is: the shell
 *            module is not even imported on it.
 *
 *   PRODUCT  everything else — control passes to `src/shell/Shell.ts`, which
 *            owns the title screen, the lobby, the options, the pause menu and
 *            the match lifecycle. `?skipmenu=1` uses this path but launches
 *            straight into a match, which is what a developer iterating on
 *            gameplay wants and what the old behaviour effectively was.
 *
 * `?map=`, `?art=`, `?tier=` and `?seed=` continue to work on both paths.
 */

declare global {
  /** Compiled out of production builds — see `define` in vite.config.ts. */
  const __DEV__: boolean;

  interface Window {
    /** Curtain status line. Defined by the inline shell script in index.html. */
    __vmStatus?(text: string): void;
    /** Curtain error surface. Defined by the inline shell script in index.html. */
    __vmFail?(title: string, detail: string, state?: 'error' | 'pending'): void;
    /* `window.__VM` — the scripting/capture handle — is declared by
       src/render/debug.ts, which owns it. `window.__vmShell` / `__vmSettings`
       are declared by src/shell/Shell.ts for the same reason. */
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

/** `?skipmenu` with no value counts as on, like every other boolean flag here. */
function boolFlag(name: string): boolean {
  if (!query.has(name)) return false;
  const v = query.get(name);
  return v === null || v === '' || v === '1' || v === 'true';
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

/** The screenshot harness owns the page whenever `?shot=` is present. */
const harnessMode = options.shot !== null;
/** Land in a match with no title screen. */
const skipMenu = boolFlag('skipmenu');
/**
 * `?campaign=<chapter>.<NN>.<slug>` — boot straight into one operation.
 *
 * Read here and handed to the SHELL, never to `bootstrap()`. `?tier=` is the
 * cautionary example: it is parsed into `options` and never reaches the shell,
 * so it has been harness-only for its whole life while this file's flag list
 * implied otherwise.
 */
const campaign = flag('campaign');

/* -------------------------------------------------------------------------- */
/* Curtain                                                                     */
/* -------------------------------------------------------------------------- */

const curtain = document.getElementById('loading');

function status(text: string): void {
  window.__vmStatus?.(text);
}

function fail(title: string, detail: unknown, state: 'error' | 'pending' = 'error'): void {
  const body =
    detail instanceof Error ? (detail.stack ?? `${detail.name}: ${detail.message}`) : String(detail);
  // 'pending' is an expected state, not a fault — keep it out of console.error so
  // it never shows up in the screenshot harness's error report.
  (state === 'pending' ? console.info : console.error)(`[RA] ${title}\n${body}`);
  window.__vmFail?.(title, body, state);
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
/* Engine handles                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `src/game/Bootstrap.ts` owns the engine API and `src/shell/Shell.ts` owns the
 * product around it. main.ts deliberately keeps only the calls it actually
 * makes, so this file never becomes a second place where either API is defined.
 */
import { bootstrap, type GameHandle } from './game/Bootstrap';
import { prepareRenderer } from './render/renderer';
import type { Shell } from './shell/Shell';

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

/** Set only on the harness path. The shell owns its own handle otherwise. */
let game: GameHandle | null = null;
let shell: Shell | null = null;

async function main(): Promise<void> {
  installViewportHandlers();
  installLifecycleHandlers();

  if (harnessMode) {
    await bootHarness();
    return;
  }
  await bootProduct();
}

/** `?shot=` — the pre-shell behaviour, byte for byte. */
async function bootHarness(): Promise<void> {
  status('Building world');
  /*
   * `?gpu=webgpu` ACQUIRES THE DEVICE HERE, BEFORE THE ENGINE EXISTS.
   * `WebGPURenderer.render()` throws until `await renderer.init()` has resolved
   * and `bootstrap()` is synchronous, so the async half lives in front of it.
   * On the WebGL path this is a no-op that imports nothing — which is what keeps
   * `three/webgpu` out of the bundle a WebGL player downloads.
   */
  await prepareRenderer(options.canvas);
  game = bootstrap(options);

  status('Compiling shaders');
  await game.ready;
  game.start();

  await nextPresentedFrame();
  status('Ready');
  dismissCurtain();
}

/** Everything a player ever sees. */
async function bootProduct(): Promise<void> {
  status('Loading front end');
  // Imported lazily so the harness path never pays for the shell bundle, and
  // so a fault inside the front end can never take the screenshot loop down.
  const { Shell: ShellClass, publishShell } = await import('./shell/Shell');

  const instance = new ShellClass({
    canvas: options.canvas,
    hudRoot: options.hudRoot,
    menuRoot: options.menuRoot,
    debugRoot: options.debugRoot,
    skipMenu,
    campaign,
    status,
    onError: (title, detail) => fail(title, detail),
    onReady: () => {
      status('Ready');
      dismissCurtain();
    },
  });
  shell = instance;
  publishShell(instance);

  await instance.start();
  await nextPresentedFrame();
  // `onReady` fires on the menu path; `?skipmenu=1` lands straight in a match
  // and never calls it, so drop the curtain here too. Both are idempotent.
  dismissCurtain();
}

/* -------------------------------------------------------------------------- */
/* Viewport                                                                    */
/* -------------------------------------------------------------------------- */

let resizePending = false;

function currentGame(): GameHandle | null {
  return game ?? shell?.getGame() ?? null;
}

function pushViewportSize(): void {
  resizePending = false;
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  currentGame()?.resize?.(w, h, dpr);
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
  // catch up on return and burn its whole substep budget. On the product path
  // the Shell owns this, because only it knows whether a menu is open.
  document.addEventListener('visibilitychange', () => {
    if (harnessMode) game?.setPaused?.(document.hidden);
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
  import.meta.hot.dispose(() => {
    shell?.dispose();
    game?.dispose?.();
  });
}

export {};

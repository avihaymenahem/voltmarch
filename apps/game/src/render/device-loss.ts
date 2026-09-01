/**
 * ============================================================================
 * VOLTMARCH — src/render/device-loss.ts
 * ============================================================================
 * A WEBGPU DEVICE CAN DIE AT ANY MOMENT AND IT IS NOT AN ERROR IN OUR CODE.
 *
 * Driver resets, GPU-process restarts, a laptop switching between its integrated
 * and discrete adapters, an OS power event, a `TDR` timeout on Windows — every
 * one of those resolves `device.lost` and every one of them is normal operating
 * weather. `GPUDevice.lost` is a PROMISE, not an error channel, precisely
 * because the spec expects applications to plan for it.
 *
 * ── WHAT WENT WRONG, AND WHY IT WAS STRUCTURAL ──────────────────────────────
 * Reported by a player whose driver reset mid-session. The page did not show a
 * message; it died with
 *
 *     TypeError: Cannot read properties of null (reading 'getSupportedExtensions')
 *         at new WebGLExtensions
 *         at WebGLBackend.init
 *
 * which names nothing a human can act on and does not mention the GPU at all.
 * Traced through three 0.185's own source, the chain is exact and it is three's,
 * not ours:
 *
 *   1. `WebGPURenderer`'s constructor installs a `getFallback` that returns
 *      `new WebGLBackend( parameters )` — `WebGPURenderer.js`, unconditionally,
 *      for every construction that is not `forceWebGL`.
 *   2. `Renderer.init()` catches ANY throw out of `WebGPUBackend.init` and calls
 *      it — `Renderer.js`. `requestAdapter()` returning null and
 *      `requestDevice()` rejecting on a dead driver both land here.
 *   3. `WebGLBackend.init` then runs
 *      `renderer.domElement.getContext( 'webgl2', … )` — the SAME canvas — and
 *      `new WebGLExtensions( this )` on the result.
 *
 * **A canvas can only ever hold one context type.** `index.html` ships ONE
 * canvas (`#gl`) and `WebGPUBackend` has already called `getContext('webgpu')`
 * on it, so step 3's `getContext('webgl2')` returns `null` by specification and
 * `WebGLExtensions` dereferences it. Three's own fallback is therefore
 * STRUCTURALLY UNAVAILABLE to any application that shares one canvas, which is
 * every application that puts its canvas in its HTML.
 *
 * And `assertBackend()` — the guard written for exactly this class of lie —
 * never fired, because it runs on the object `init()` RESOLVES with and here
 * `init()` REJECTS. A guard downstream of the throw cannot see the throw.
 *
 * ── WHAT THIS MODULE IS ─────────────────────────────────────────────────────
 * The three-free half of the answer: loss detection, the quarantine that keeps a
 * poisoned canvas away from any later WebGL construction, the words the human
 * reads, and the URL that gets them out. It imports nothing from three and
 * touches the DOM only through `showGpuFailure`, so `tests/gpu-device-loss.spec.ts`
 * drives every decision in the ordinary node pool against hand-built fakes —
 * same reasoning as `backend.ts`, and the reason a device loss can be tested
 * without crashing a GPU.
 *
 * The wiring lives in `renderer.ts#prepareRenderer` / `#createRenderer`.
 * ============================================================================
 */

import type { AdapterIdentity } from './backend';
import { describeAdapter } from './backend';

/* ==========================================================================
 * 1. DETECTION
 * ========================================================================== */

/**
 * `GPUDeviceLostInfo`, structurally.
 *
 * `reason` is `'destroyed'` or `'unknown'` in the current spec and browsers have
 * shipped other strings, so it is read as a plain string rather than a union —
 * an unrecognised reason must still be reported, not swallowed by a type.
 */
export interface DeviceLostInfoLike {
  readonly reason?: string | null;
  readonly message?: string | null;
}

/** The one member of `GPUDevice` this module needs. */
export interface DeviceLike {
  readonly lost?: Promise<DeviceLostInfoLike> | null;
  readonly adapterInfo?: unknown;
}

/**
 * `reason === 'destroyed'` means WE called `device.destroy()`.
 *
 * It is a teardown, not a failure, and raising a panel over an intentional
 * shutdown would fire on every page close. Three's own `WebGPUBackend.init`
 * filters the same value for the same reason; this is the second place it has to
 * be filtered because we subscribe to `device.lost` ourselves rather than
 * monkey-patching `renderer.onDeviceLost`.
 */
export function isDeliberateDestroy(info: DeviceLostInfoLike | null | undefined): boolean {
  return info?.reason === 'destroyed';
}

/**
 * Subscribe to a device's loss.
 *
 * **`device.lost` RESOLVES, IT DOES NOT REJECT.** A `.catch` on it is dead code
 * and an `await` on it inside a boot path never returns — the promise simply
 * stays pending for the entire life of a healthy device. The only correct shape
 * is a detached `.then`, which is what this is.
 *
 * Returns a canceller. The subscription cannot be removed from the promise, so
 * cancelling sets a flag the continuation reads: a renderer disposed between the
 * subscribe and the loss must not raise a panel over a page that has moved on.
 *
 * `onLost` is called AT MOST ONCE and never for a deliberate destroy.
 */
export function watchDeviceLoss(
  device: DeviceLike | null | undefined,
  onLost: (info: DeviceLostInfoLike) => void,
): () => void {
  let live = true;
  const lost = device?.lost;
  if (lost === null || lost === undefined || typeof lost.then !== 'function') {
    // No `lost` promise at all — an old browser, or a stub. Nothing to watch;
    // the canceller is still returned so callers need no branch.
    return () => {
      live = false;
    };
  }
  void lost.then(
    (info) => {
      if (!live) return;
      if (isDeliberateDestroy(info)) return;
      live = false;
      onLost(info ?? {});
    },
    // Not expected by the spec, but a stub or a future revision could reject and
    // an unhandled rejection here would surface as a second, wronger error.
    () => {
      /* ignored — a rejected `lost` tells us nothing a loss would not */
    },
  );
  return () => {
    live = false;
  };
}

/* ==========================================================================
 * 2. THE QUARANTINE
 * ========================================================================== */

/**
 * Canvases that have held a `webgpu` context, and their replacements.
 *
 * **A CANVAS IS SINGLE-USE ACROSS CONTEXT TYPES.** Once `getContext('webgpu')`
 * has been called on an element, `getContext('webgl2')` on that same element
 * returns `null` forever — there is no release, no reset, and no attribute that
 * undoes it. So "recover onto WebGL" cannot mean "construct a `WebGLRenderer` on
 * the canvas the failed `WebGPURenderer` was using"; that is precisely the
 * `getSupportedExtensions` crash, reproduced by us instead of by three.
 *
 * The bookkeeping is separated from the DOM surgery deliberately. Deciding WHICH
 * element a caller should get is the part with the invariant worth pinning —
 * "`resolve` never returns a poisoned element, however many times a canvas has
 * been replaced" — and it is pure, so it is tested. Minting the replacement is
 * ten lines of straight-line `createElement`/`replaceChild` in `renderer.ts`.
 *
 * Generic over the element type for the same reason `liveBackendOf` takes
 * `unknown`: the test drives it with `{}` and the product drives it with
 * `HTMLCanvasElement`, and neither needs a cast.
 */
export class CanvasQuarantine<T extends object> {
  private readonly poisoned = new WeakSet<T>();
  private readonly replacements = new WeakMap<T, T>();

  /** Mark a canvas as having held a `webgpu` context. Idempotent. */
  poison(canvas: T): void {
    this.poisoned.add(canvas);
  }

  /** True once `poison` has been called for this element or it IS a replacement target. */
  isPoisoned(canvas: T): boolean {
    return this.poisoned.has(canvas);
  }

  /**
   * The element a caller should actually use.
   *
   * Follows the replacement chain first — callers hold references taken before
   * a swap (`Shell` keeps `options.canvas` for the life of the page, and
   * `bootstrap()` is handed the same field on every match) and a stale reference
   * must not resurrect a detached element. Then, if what it lands on is
   * poisoned, mints a fresh one and records the link.
   *
   * `mint` is called at most once per poisoned element, LAZILY: a device that is
   * lost mid-match leaves the last drawn frame on screen until something
   * actually needs a usable canvas, rather than blanking the page under the
   * notice the player is still reading.
   */
  resolve(canvas: T, mint: (old: T) => T): T {
    let current = canvas;
    // Bounded rather than `while (true)`: a cycle here would hang the boot, and
    // a canvas that has been replaced more than a handful of times in one page
    // is a bug we would rather see as a wrong element than as a frozen tab.
    for (let i = 0; i < 8; i++) {
      const next = this.replacements.get(current);
      if (next === undefined) break;
      current = next;
    }
    if (!this.poisoned.has(current)) return current;
    const fresh = mint(current);
    this.replacements.set(current, fresh);
    return fresh;
  }
}

/* ==========================================================================
 * 3. THE WORDS
 * ========================================================================== */

/** Which side of `init()` the failure landed on. */
export type GpuFailurePhase =
  /** `WebGPURenderer.init()` rejected — no device was ever acquired. */
  | 'init'
  /** A live device resolved its `lost` promise. Frames had already been drawn. */
  | 'lost';

export interface GpuFailure {
  readonly phase: GpuFailurePhase;
  /** `GPUDeviceLostInfo.reason`, or null on the init path. */
  readonly reason: string | null;
  /** The browser's own words. Never shown alone — it is rarely a sentence. */
  readonly message: string;
  /** Which GPU it was, when the adapter said. */
  readonly adapter: AdapterIdentity | null;
}

/** A rendered failure, ready for a panel, a console line and a test. */
export interface GpuFailureReport {
  readonly title: string;
  /** The explanation, one sentence per entry. Plain prose, no jargon. */
  readonly lines: ReadonlyArray<string>;
  /** The browser's raw text, kept separate so the prose above stays readable. */
  readonly detail: string;
  /** Label for the button that reloads with the temporary WebGL rollback. */
  readonly webglAction: string;
  /** Label for the button that retries WebGPU on a fresh page. */
  readonly retryAction: string;
}

/**
 * Turn a failure into words a player can act on.
 *
 * PURE, AND THAT IS THE POINT. The message is the entire product of this feature
 * for anyone who is not reading the source — the difference between "the page
 * died" and "your graphics driver reset; here is the button" — so it is a value
 * a test can assert on rather than a string built inside a DOM call nobody can
 * reach without a browser.
 *
 * It never says "error", never names a stack frame, and never asks the reader to
 * open a console. `docs/RENDER_FINDINGS.md` §7c is cited in the console line
 * only, where the next engineer will be looking.
 */
export function gpuFailureReport(failure: GpuFailure): GpuFailureReport {
  const gpu = describeAdapter(failure.adapter);
  const onGpu = gpu === null ? '' : ` on ${gpu}`;

  const lines: string[] =
    failure.phase === 'lost'
      ? [
          `The graphics device this game was running on${onGpu} was lost.`,
          'That is almost always a driver reset, a GPU process restart, or a laptop ' +
            'switching between its two graphics chips — it is not caused by anything ' +
            'you did in the game.',
          'The match cannot continue on this device: every texture and buffer it held ' +
            'went with it. Reload to start again.',
        ]
      : [
          `A WebGPU device could not be created${onGpu}.`,
          'This happens when the driver is still recovering from a reset, when the ' +
            'browser has blocked WebGPU for this GPU, or when the machine has no ' +
            'WebGPU-capable adapter at all.',
          'WebGPU is the normal renderer. You can retry it, or use the temporary ' +
            '?gpu=webgl rollback on this machine.',
        ];

  const reason = failure.reason !== null && failure.reason !== '' ? `${failure.reason}: ` : '';
  return {
    title: failure.phase === 'lost' ? 'Graphics Device Lost' : 'WebGPU Unavailable',
    lines,
    detail: `${reason}${failure.message !== '' ? failure.message : 'no further detail reported'}`,
    webglAction: 'Continue on WebGL',
    retryAction: failure.phase === 'lost' ? 'Reload' : 'Try WebGPU again',
  };
}

/** One line for the console and for a crash report. */
export function gpuFailureConsoleLine(failure: GpuFailure): string {
  const gpu = describeAdapter(failure.adapter) ?? 'adapter not reported';
  const where = failure.phase === 'lost' ? 'device lost' : 'device unavailable';
  const reason = failure.reason !== null && failure.reason !== '' ? ` reason=${failure.reason}` : '';
  return (
    `[render] WebGPU ${where} — ${gpu}${reason} — ${failure.message || 'no detail'}. ` +
    'WebGPU is the product default; the temporary rollback is ?gpu=webgl. ' +
    'See docs/RENDER_FINDINGS.md §7g.'
  );
}

/* ==========================================================================
 * 4. THE WAY OUT
 * ========================================================================== */

/**
 * The same page with the explicit temporary `?gpu=webgl` rollback.
 *
 * THE GPU VALUE IS THE ONLY THING CHANGED. `?seed=`, `?map=`, `?mapseed=` and
 * `?shot=` all decide what the page IS, and a "get me back to a working
 * renderer" button that silently rerolled the map would be a second, quieter
 * version of the substitution this whole design refuses.
 *
 * Falls back to the input unchanged if it cannot be parsed, which is the safe
 * direction: a button that reloads the identical URL is useless, a button that
 * navigates somewhere unexpected is worse.
 */
export function hrefForWebgl(href: string): string {
  try {
    const url = new URL(href);
    url.searchParams.set('gpu', 'webgl');
    return url.toString();
  } catch {
    return href;
  }
}

/* ==========================================================================
 * 5. THE PANEL
 * ========================================================================== */

/** The DOM this module needs, so a caller can hand it something else. */
export interface FailureHost {
  /** Where the panel is appended. `document.body` in the product. */
  readonly body: {
    appendChild(node: unknown): void;
    querySelector(selectors: string): unknown;
  };
  createElement(tag: string): {
    className: string;
    textContent: string | null;
    readonly style: { cssText: string };
    setAttribute(name: string, value: string): void;
    appendChild(node: unknown): void;
    addEventListener(type: string, listener: () => void): void;
  };
}

/** Marks the panel so a second failure replaces nothing and adds nothing. */
export const GPU_FAILURE_PANEL_CLASS = 'vm-gpu-failure';

const PANEL_CSS =
  'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
  'justify-content:center;background:rgba(6,8,11,0.92);' +
  "font-family:Rajdhani,'Segoe UI',system-ui,sans-serif;color:#dfe6ef;padding:24px;";
const CARD_CSS =
  'max-width:560px;background:#11161d;border:1px solid #2b3542;border-radius:6px;' +
  'padding:28px 30px;box-shadow:0 18px 60px rgba(0,0,0,0.6);';
const TITLE_CSS =
  'font-size:22px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;' +
  'margin:0 0 14px;color:#ffb454;';
const LINE_CSS = 'font-size:16px;line-height:1.5;margin:0 0 10px;';
const DETAIL_CSS =
  'font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.45;' +
  'color:#8b97a6;margin:16px 0 20px;word-break:break-word;';
const ROW_CSS = 'display:flex;gap:10px;flex-wrap:wrap;';
const BUTTON_CSS =
  'font:inherit;font-size:15px;font-weight:600;letter-spacing:0.04em;padding:10px 18px;' +
  'border-radius:4px;border:1px solid #3a4757;background:#1b2530;color:#dfe6ef;cursor:pointer;';
const PRIMARY_CSS = BUTTON_CSS + 'background:#2f6df6;border-color:#2f6df6;color:#fff;';

/**
 * Put the failure on screen with the two buttons that resolve it.
 *
 * **THIS IS THE HALF THE PLAYER SEES AND IT IS NOT A CONSOLE MESSAGE.** The
 * report that produced this work said the page "died"; what actually happened is
 * that a `TypeError` went to the console of a player who was not looking at one.
 *
 * Idempotent: a device that is lost while an init failure is already on screen
 * must not stack two panels. First failure wins, because it is the one with the
 * cause in it.
 */
export function showGpuFailure(
  report: GpuFailureReport,
  host: FailureHost,
  actions: { onWebgl: () => void; onRetry: () => void },
): boolean {
  if (host.body.querySelector(`.${GPU_FAILURE_PANEL_CLASS}`) != null) return false;

  const root = host.createElement('div');
  root.className = GPU_FAILURE_PANEL_CLASS;
  root.style.cssText = PANEL_CSS;
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-label', report.title);

  const card = host.createElement('div');
  card.style.cssText = CARD_CSS;

  const title = host.createElement('h2');
  title.style.cssText = TITLE_CSS;
  title.textContent = report.title;
  card.appendChild(title);

  for (const line of report.lines) {
    const p = host.createElement('p');
    p.style.cssText = LINE_CSS;
    p.textContent = line;
    card.appendChild(p);
  }

  const detail = host.createElement('p');
  detail.style.cssText = DETAIL_CSS;
  detail.textContent = report.detail;
  card.appendChild(detail);

  const row = host.createElement('div');
  row.style.cssText = ROW_CSS;

  const webgl = host.createElement('button');
  webgl.style.cssText = PRIMARY_CSS;
  webgl.textContent = report.webglAction;
  webgl.addEventListener('click', actions.onWebgl);
  row.appendChild(webgl);

  const retry = host.createElement('button');
  retry.style.cssText = BUTTON_CSS;
  retry.textContent = report.retryAction;
  retry.addEventListener('click', actions.onRetry);
  row.appendChild(retry);

  card.appendChild(row);
  root.appendChild(card);
  host.body.appendChild(root);
  return true;
}

/* ==========================================================================
 * 6. THE ERROR
 * ========================================================================== */

/**
 * Thrown by `prepareRenderer` when `?gpu=webgpu` cannot be honoured.
 *
 * A SEPARATE TYPE FROM `BackendMismatchError` BECAUSE IT IS A DIFFERENT
 * QUESTION. That one means "a renderer was built and it is the wrong one"; this
 * one means "no renderer was built at all". A caller that wants to distinguish
 * "the flag lied" from "the machine said no" can, and the boot path that catches
 * this one must not construct an engine.
 */
export class GpuUnavailableError extends Error {
  // `override` because `Error.cause` is declared by the standard library: this
  // IS that field, carrying the original rejection from `WebGPURenderer.init()`.
  constructor(readonly failure: GpuFailure, override readonly cause?: unknown) {
    super(gpuFailureConsoleLine(failure));
    this.name = 'GpuUnavailableError';
  }
}

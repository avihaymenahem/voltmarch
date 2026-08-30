/**
 * ============================================================================
 * src/ui/perf.system.ts — THE PERFORMANCE OVERLAY'S REGISTRATION
 * ============================================================================
 * Discovered by glob from `src/game/Systems.ts`. This file is the entire wiring
 * step: a module joins the game by existing, and no agent edits `Bootstrap.ts`
 * or `Systems.ts` to register one.
 *
 * PHASE
 * -----
 * `frame` at RenderPhase.Hud (80), order 300 — after `ui.hud` (100) so the HUD
 * root exists and the panel inherits `--vm-u`, and after `ui.objectives` (200)
 * so the two corner panels mount in a fixed order. There is no `simTick`: the
 * overlay measures the render path, and `performance.now()` is banned inside
 * the fixed step by a test that is right to ban it.
 *
 * NO SECOND SOURCE OF TRUTH
 * -------------------------
 * Every counter on the panel comes from `ctx().debug.api.stats()` — the same
 * `__VM.stats()` that `tools/shoot.mjs` and `tools/metrics.mjs` drive, reached
 * through the context rather than through the global so a `?shot=` boot cannot
 * find it half-installed. CLAUDE.md says changing that surface breaks the whole
 * visual-critique pipeline; nothing here changes it, and nothing here
 * duplicates it. The one number `stats()` does not carry is the FULL JS cost of
 * a frame — its `cpuMs` covers `present()` only, because that is where the
 * debug layer's own brackets sit — so that comes from the loop's `Profiler`,
 * which already measures exactly it.
 *
 * THE TOGGLE
 * ----------
 * `settings.graphics.perfOverlay`, off by default, reached through
 * `globalThis.__vmSettings` and NOT by importing the store: the store lives in
 * the lazily-loaded shell chunk and a `?shot=` boot never loads the shell at
 * all. This is the same duck-typed seam `src/ui/Hud.ts` and
 * `src/input/input.system.ts` already use, and it is exactly what the Settings
 * screen's header says the published store is for.
 *
 * THE KEYBOARD SHORTCUT, AND WHY IT IS NOT HARD-CODED
 * --------------------------------------------------
 * Every binding in this game must come from `src/input/ActionCatalogue.ts` so
 * the help screen and the tutorial can never teach a stale key. That file is
 * unverified in-tree work owned by another workflow and this one may not edit
 * it, so the shortcut is resolved from the catalogue AT RUNTIME: if
 * `sys.perfHud` is present, the key is live; if it is absent — which it is
 * today — no key is bound and the console says so. Nothing here teaches a key
 * the help screen does not know about, and the shortcut goes live the day the
 * entry below is added, with no edit to this file:
 *
 *     {
 *       id: 'sys.perfHud',
 *       label: 'Performance Overlay (HUD)',
 *       description:
 *         'Frame time, the CPU/GPU split, draw calls against the 130 budget, and ' +
 *         'whether a 60 fps reading has real headroom or is vsync capping a ' +
 *         'saturated GPU. Also on the Graphics tab in Options, where the choice ' +
 *         'is persisted. Distinct from F3, which is the developer render overlay.',
 *       category: 'interface',
 *       surface: 'global',
 *       binding: 'fixed',
 *       defaultChord: chord('F4'),
 *     },
 *
 * F4 rather than F3: `src/render/debug.ts` reads `e.code === 'F3'` directly and
 * ignores modifiers, so Shift+F3 would toggle BOTH overlays. F4 is bound by
 * nothing in this build and is not in `RESERVED_CODES`.
 *
 * A `KEYBINDS` row in `src/shell/settings-store.ts` is deliberately NOT added:
 * `tests/action-catalogue.spec.ts` asserts every KEYBINDS id has a catalogue
 * row, so adding one before the row above exists would break a gate. The action
 * is `fixed` in any case, and fixed actions are not stored.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { RenderPhase, type RenderContext } from '../core/types';
import { ctx } from '../game/context';
import { liveChordFor, type ActionChord, type StoredBindings } from '../input/ActionCatalogue';
import type { LiveBackend } from '../render/backend';
import { adaptiveResolutionEnabled } from '../render/adaptive-res.system';

import {
  DRAW_BUDGET,
  PerfHud,
  WebGpuTimer,
  asTimerGl,
  perfFrameShareOf,
  perfPanelHeightUnits,
  shortDevice,
  type PerfReadout,
  type PerfSource,
} from './PerfHud';

/** The catalogue id the shortcut is resolved from. See the header. */
export const PERF_ACTION_ID = 'sys.perfHud';

/** How often the panel checks whether the developer F3 overlay is up. */
const DEBUG_PROBE_SECONDS = 0.5;

/** How often a missing settings store is looked for again. */
const SETTINGS_PROBE_SECONDS = 1;

let hud: PerfHud | null = null;

declare global {
  // eslint-disable-next-line no-var
  var __vmPerf: PerfHud | undefined;
}

/* ==========================================================================
 * THE SETTINGS SEAM
 * ========================================================================== */

interface SettingsBridge {
  get(): {
    graphics?: { perfOverlay?: boolean };
    controls?: { bindings?: StoredBindings };
  };
  patch(patch: { graphics: { perfOverlay: boolean } }): unknown;
  subscribe(fn: () => void): () => void;
}

/** The live store, or null. Duck-typed for the reason in the file header. */
function readSettings(): SettingsBridge | null {
  const g = globalThis as { __vmSettings?: unknown };
  const s = g.__vmSettings;
  if (typeof s !== 'object' || s === null) return null;
  const v = s as Partial<SettingsBridge>;
  if (typeof v.get !== 'function') return null;
  if (typeof v.patch !== 'function') return null;
  if (typeof v.subscribe !== 'function') return null;
  return s as SettingsBridge;
}

/** `graphics.perfOverlay`, or false when anything at all is missing. */
export function readPerfSetting(store: SettingsBridge | null): boolean {
  if (store === null) return false;
  try {
    return store.get().graphics?.perfOverlay === true;
  } catch {
    return false;
  }
}

/** True when a keystroke matches a chord. Modifiers must match exactly. */
export function chordMatches(chord: ActionChord | null, e: KeyboardEvent): boolean {
  if (chord === null || chord.code === '') return false;
  return (
    e.code === chord.code &&
    e.ctrlKey === chord.ctrl &&
    e.shiftKey === chord.shift &&
    e.altKey === chord.alt
  );
}

/* ==========================================================================
 * THE ENGINE SEAM
 * ========================================================================== */

/** The four buckets `stats()` publishes. Structural: nothing here imports post.ts. */
export interface DrawSplitLike {
  readonly shadow: number;
  readonly colour: number;
  readonly total: number;
}

/**
 * The COLOUR-PASS draw count, or null when the live renderer cannot split the
 * frame.
 *
 * **THE SAME TEST `src/render/debug.ts` MAKES, deliberately duplicated rather
 * than re-derived.** A zero colour bucket underneath a non-zero total means the
 * split is UNAVAILABLE, not that nothing drew: `src/render/post.ts` reports the
 * node path as zeros with a true total because the node `Renderer` has no seam
 * between the shadow pass and the colour pass to meter, and the WebGL path
 * reports the same shape when there is no post chain to install the meters in.
 * Two different answers to one question is how a fake split gets believed, so
 * this is the F3 overlay's condition verbatim.
 *
 * A total of zero is left alone: nothing was submitted, and `0 col` is then the
 * honest reading rather than a missing one.
 */
export function colourDrawsOf(split: DrawSplitLike): number | null {
  if (split.total > 0 && split.colour === 0 && split.shadow === 0) return null;
  return split.colour;
}

/**
 * Reads the panel's numbers off surfaces that already exist.
 *
 * `cpuMs()` is called every frame and is a single field read. `read()` is
 * called four times a second and is the only place `stats()` is touched — it
 * allocates a small object per call, which is why it is not on the hot path.
 *
 * THE GPU IDENTITY IS RESOLVED ONCE. Neither the live backend nor the adapter
 * can change within a page — a lost WebGPU device does not come back and the
 * route out is a reboot — so `shortDevice`'s regex work happens on the first
 * successful read and never again, and the 4 Hz path assigns two cached fields.
 */
class EngineSource implements PerfSource {
  private backend: LiveBackend | null = null;
  private device = '—';
  private gpuResolved = false;

  cpuMs(): number {
    try {
      return ctx().registry.profiler.frameMs;
    } catch {
      return 0;
    }
  }

  read(out: PerfReadout): void {
    this.resolveGpu();
    let s;
    try {
      s = ctx().debug.api.stats();
    } catch {
      return;
    }
    out.drawCalls = s.drawCalls;
    out.drawCallsColour = colourDrawsOf(s.drawCallsByPass);
    out.triangles = s.triangles;
    out.trianglesColour = s.trianglesByPass?.colour ?? null;
    out.entities = s.counters.entities;
    out.simMs = s.counters.simMs;
    out.substeps = s.counters.substeps;
    out.tier = s.quality;
    out.resolution = s.resolution;
    out.pixelRatio = s.pixelRatio;
    out.backend = this.backend;
    out.device = this.device;
    try {
      const profiler = ctx().registry.profiler;
      out.waterCpuMs = profiler.get('world.water#f')?.avg ?? 0;
      out.particlesCpuMs = profiler.get('vfx#f')?.avg ?? 0;
      out.uiCpuMs =
        (profiler.get('ui.hud#f')?.avg ?? 0) +
        (profiler.get('ui.objectives#f')?.avg ?? 0) +
        (profiler.get('ui.perf#f')?.avg ?? 0);
      out.longFrameCount = profiler.longFrameCount;
      out.lastLongFrameGapMs = profiler.lastLongFrameGapMs;
      out.lastLongFrameCpuMs = profiler.lastLongFrameCpuMs;
      out.worstLongFrameGapMs = profiler.worstLongFrameGapMs;
    } catch {
      out.waterCpuMs = 0;
      out.particlesCpuMs = 0;
      out.uiCpuMs = 0;
      out.longFrameCount = 0;
      out.lastLongFrameGapMs = 0;
      out.lastLongFrameCpuMs = 0;
      out.worstLongFrameGapMs = 0;
    }
  }

  /**
   * `handle.backend` is the READ — the live backend off the renderer object,
   * never `requestedBackend()`. `handle.capabilities.gpu` is already the
   * adapter's own account of itself with the WebGL probe as its fallback (see
   * `createRenderer`), so this is one source rather than a second opinion.
   */
  private resolveGpu(): void {
    if (this.gpuResolved) return;
    try {
      const handle = ctx().handle;
      this.backend = handle.backend;
      this.device = shortDevice(handle.capabilities.gpu);
      this.gpuResolved = true;
    } catch {
      /* Before the context exists. Retried on the next update, 250 ms away. */
    }
  }
}

/* ==========================================================================
 * THE MODULE
 * ========================================================================== */

/** The HUD root if it exists, else the raw mount, else null. */
function resolveMount(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const root = document.querySelector<HTMLElement>('.vm-hud');
  if (root !== null) return root;
  return document.getElementById('hud-root');
}

/**
 * The developer overlay from `src/render/debug.ts`, which owns the id
 * `vm-perf`. This panel uses `vm-perf` as a CLASS, so the lookup cannot find
 * itself. Resolved once and then only read, never queried again.
 */
let debugOverlay: HTMLElement | null = null;
let debugProbeIn = 0;
let settingsProbeIn = 0;
let store: SettingsBridge | null = null;
let unsubscribe: (() => void) | null = null;
let keyListener: ((e: KeyboardEvent) => void) | null = null;

function applyStoredVisibility(): void {
  const visible = readPerfSetting(store);
  hud?.setVisible(visible);
  try {
    ctx().registry.profiler.enabled = visible;
  } catch {
    /* The setting may arrive before the registry is ready. */
  }
}

function bindSettings(): void {
  const found = readSettings();
  if (found === null || found === store) return;
  unsubscribe?.();
  store = found;
  try {
    unsubscribe = found.subscribe(() => { applyStoredVisibility(); });
  } catch {
    unsubscribe = null;
  }
  applyStoredVisibility();
}

/** Flip the setting where there is a store, and the panel alone where there is not. */
function toggleOverlay(): void {
  const panel = hud;
  if (panel === null) return;
  const next = !panel.shown;
  if (store !== null) {
    try {
      store.patch({ graphics: { perfOverlay: next } });
      return;
    } catch {
      /* Fall through: an unwritable store must not cost the player the key. */
    }
  }
  panel.setVisible(next);
  try {
    ctx().registry.profiler.enabled = next;
  } catch {
    /* Standalone harness without a registry. */
  }
}

export default defineSystem({
  id: 'ui.perf',
  renderPhase: RenderPhase.Hud,
  order: 300,

  init(): void {
    const mount = resolveMount();
    if (mount === null) {
      console.info('[perf] no HUD root; the performance overlay will not mount');
      return;
    }

    // The overlay is intentionally off by default, but a headless hitch probe
    // still needs attribution rather than only a wall-clock gap. Keep this on
    // the existing debug-hook surface so diagnostics can arm the same profiler
    // without making the player open a panel or reaching into game context.
    const profiler = ctx().registry.profiler;
    ctx().debug.api.registerHook('perfStart', () => {
      profiler.reset();
      profiler.enabled = true;
      return true;
    });
    ctx().debug.api.registerHook('perfSystems', () => profiler.all([])
      .map((row) => ({ ...row }))
      .sort((a, b) => b.peak - a.peak));

    // Each backend supplies its native timer: WebGL's extension or Three's
    // WebGPU timestamp-query resolver. Neither path substitutes frame time.
    let gl: ReturnType<typeof asTimerGl> = null;
    let timer: WebGpuTimer | undefined;
    try {
      const handle = ctx().handle;
      const webgl = handle.webgl;
      gl = webgl === null ? null : asTimerGl(webgl.getContext());
      timer = handle.node === null ? undefined : new WebGpuTimer(handle.node);
    } catch {
      gl = null;
      timer = undefined;
    }

    // The screenshot/performance harness has no settings store to turn this
    // panel on. `?gpupasses` is a read-only developer boot flag that makes the
    // real per-pass timestamp rows observable during renderer experiments.
    const queryWantsPasses = typeof location !== 'undefined'
      && new URLSearchParams(location.search).has('gpupasses');
    hud = new PerfHud({ mount, source: new EngineSource(), gl, timer, visible: queryWantsPasses });
    // For the console and for `tools/playtest.mjs`, exactly as `ui.objectives`
    // publishes its panel. Nothing in the game reads it.
    globalThis.__vmPerf = hud;

    bindSettings();

    keyListener = (e: KeyboardEvent): void => {
      // Resolved per keystroke rather than cached: the catalogue entry may not
      // exist yet (see the header), and a player who rebinds mid-match must not
      // have to reload for it to take.
      let bindings: StoredBindings | undefined;
      try {
        bindings = store?.get().controls?.bindings;
      } catch {
        bindings = undefined;
      }
      if (!chordMatches(liveChordFor(PERF_ACTION_ID, bindings), e)) return;
      e.preventDefault();
      toggleOverlay();
    };
    window.addEventListener('keydown', keyListener);

    const chord = liveChordFor(PERF_ACTION_ID, undefined);
    const share = (perfFrameShareOf(1280, 720) * 100).toFixed(2);
    // The LIVE backend, read off the renderer. A boot log that named the
    // requested one would be the exact failure `src/render/backend.ts` exists
    // to stop; and the timer's availability is a consequence of this line, so
    // the two belong beside each other.
    let live: string;
    try {
      live = ctx().handle.backend;
    } catch {
      live = 'unknown';
    }
    console.info(
      `[perf] overlay mounted — off by default, ${perfPanelHeightUnits()}u tall ` +
      `(${share}% of a 720p frame), WebGL colour-pass draw budget ${DRAW_BUDGET}, ` +
      `backend ${live}, ` +
      `gpu timer ${hud.gpuTimerAvailable ? 'available' : 'unavailable (headroom cannot be proven)'}; ` +
      (chord === null
        ? `no key bound — add "${PERF_ACTION_ID}" to src/input/ActionCatalogue.ts and the ` +
          'shortcut goes live with no edit here'
        : `key ${chord.code}`),
    );
  },

  frame(r: RenderContext): void {
    const panel = hud;
    if (panel === null) return;

    if (store === null) {
      settingsProbeIn -= r.dt;
      if (settingsProbeIn <= 0) {
        settingsProbeIn = SETTINGS_PROBE_SECONDS;
        bindSettings();
      }
    }

    // The visible panel and the optional governor share one instrument. When
    // both are off, timestamp writes stop completely.
    panel.setProfilingActive(panel.shown || adaptiveResolutionEnabled());

    // Only while the panel is up: DOM diagnostics that are off cost nothing.
    if (panel.shown) {
      debugProbeIn -= r.dt;
      if (debugProbeIn <= 0) {
        debugProbeIn = DEBUG_PROBE_SECONDS;
        if (debugOverlay === null && typeof document !== 'undefined') {
          debugOverlay = document.getElementById('vm-perf');
        }
        const up = debugOverlay !== null && debugOverlay.style.display !== 'none';
        panel.root.classList.toggle('is-clear-of-debug', up);
      }
    }

    panel.frame(r.dt);
  },

  dispose(): void {
    if (keyListener !== null) {
      window.removeEventListener('keydown', keyListener);
      keyListener = null;
    }
    unsubscribe?.();
    unsubscribe = null;
    store = null;
    debugOverlay = null;
    if (globalThis.__vmPerf === hud) globalThis.__vmPerf = undefined;
    hud?.dispose();
    hud = null;
    try {
      ctx().registry.profiler.enabled = false;
    } catch {
      /* Context may already be disposed. */
    }
  },
});

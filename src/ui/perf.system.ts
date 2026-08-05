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

import {
  DRAW_BUDGET,
  PerfHud,
  asTimerGl,
  perfFrameShareOf,
  perfPanelHeightUnits,
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

/**
 * Reads the panel's numbers off surfaces that already exist.
 *
 * `cpuMs()` is called every frame and is a single field read. `read()` is
 * called four times a second and is the only place `stats()` is touched — it
 * allocates a small object per call, which is why it is not on the hot path.
 */
class EngineSource implements PerfSource {
  cpuMs(): number {
    try {
      return ctx().registry.profiler.frameMs;
    } catch {
      return 0;
    }
  }

  read(out: PerfReadout): void {
    let s;
    try {
      s = ctx().debug.api.stats();
    } catch {
      return;
    }
    out.drawCalls = s.drawCalls;
    out.triangles = s.triangles;
    out.entities = s.counters.entities;
    out.simMs = s.counters.simMs;
    out.substeps = s.counters.substeps;
    out.tier = s.quality;
    out.resolution = s.resolution;
    out.pixelRatio = s.pixelRatio;
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
  hud?.setVisible(readPerfSetting(store));
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

    // The renderer's context, when it is a WebGL2 one that will actually run
    // timer queries. `asTimerGl` returns null for anything else and the panel
    // then reports "gpu n/a" rather than inventing a number.
    let gl: ReturnType<typeof asTimerGl> = null;
    try {
      gl = asTimerGl(ctx().handle.renderer.getContext());
    } catch {
      gl = null;
    }

    hud = new PerfHud({ mount, source: new EngineSource(), gl, visible: false });
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
    console.info(
      `[perf] overlay mounted — off by default, ${perfPanelHeightUnits()}u tall ` +
      `(${share}% of a 720p frame), draw budget ${DRAW_BUDGET}, ` +
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

    // Only while the panel is up: an overlay that is off must cost nothing at
    // all, including this.
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
  },
});

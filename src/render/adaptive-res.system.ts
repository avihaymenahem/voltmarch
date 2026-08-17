/**
 * ============================================================================
 * VOLTMARCH — src/render/adaptive-res.system.ts
 * ============================================================================
 * The registration shim for dynamic resolution scaling. The controller is in
 * `AdaptiveResolution.ts`; this file measures a frame and applies a decision.
 *
 * It exists as a MODULE rather than as an edit to `renderer.ts` on purpose: the
 * whole lever is already public (`RendererHandle.setResolutionScale`), so this
 * needs no change to the renderer, no change to `core/`, and can be removed by
 * deleting one file. That is what the plugin contract is for.
 *
 * `RenderPhase.Present` is the last phase, so `ctx.dt` here is the interval
 * across a whole rendered frame — which is exactly the quantity the controller
 * steers on. Sampling earlier would measure part of a frame and read fast.
 *
 * IT IS ALSO THE ONLY SAFE PLACE TO APPLY THE DECISION, AND THAT IS NOT LUCK.
 * `RenderPhase.Present` runs inside `GameLoop.renderPass`, BEFORE the host's
 * render hook draws. So the reallocation this causes is followed by a complete
 * frame in the same task and nothing flat can be presented — `beginFrame()`
 * cancels the `RepaintGuard` repaint, so it is free as well as correct. Moving
 * this system after the draw, or applying a decision from a timer or an rAF of
 * its own, would put it straight back on the path that produced the macOS black
 * flash. See `src/render/RepaintGuard.ts`.
 * ============================================================================
 */

import { RenderPhase } from '../core/types';
import type { RenderContext } from '../core/types';
import { defineSystem } from '../core/loop';
import { ctx } from '../game/context';
import type { RendererHandle } from './renderer';

import { AdaptiveResolution } from './AdaptiveResolution';
import { calibrationRunning } from './calibration.system';

let handle: RendererHandle | null = null;
let controller: AdaptiveResolution | null = null;
/**
 * OFF UNTIL SOMETHING TURNS IT ON, and that is the shipped default now.
 *
 * This was `true`, so dynamic scaling ran on any page that never called
 * `setAdaptiveResolution` — including `?shot=`, where only `handle.isFixedSize`
 * stood between the capture set and a controller resizing the drawing buffer.
 * The product default moved to off (`settings-store.ts#defaultSettings`, and the
 * v3 migration beside it), and a module default that disagreed with it would be
 * a second answer to the same question.
 *
 * `shell/Settings.ts#applySettings` pushes the player's choice on every boot, so
 * a player who wants it back gets it back on the frame they ask.
 */
let enabled = false;
/** Unsubscribe for the layout-box watcher below. */
let offResize: (() => void) | null = null;
/** Last CSS layout box seen, so a genuine window change can be told apart. */
let lastCssW = 0;
let lastCssH = 0;
/**
 * The last scale THIS controller commanded, or -1 before it has commanded one.
 *
 * Anything else observed on the handle came from another caller — the Settings
 * slider or `__VM.setResolutionScale` — and is treated as a deliberate choice.
 */
let lastCommanded = -1;

/** Adjustments made this match. Surfaced so a silent no-op is visible. */
export let adaptiveChanges = 0;
/** Median frame time the controller last steered on, in ms. */
export let adaptiveMedianMs = 0;

/**
 * Turn dynamic scaling on or off at runtime.
 *
 * Off restores the tier's ceiling immediately rather than leaving the player
 * parked at whatever the controller last chose — a disabled feature must not
 * keep having an effect.
 */
export function setAdaptiveResolution(on: boolean): void {
  enabled = on;
  if (!on && handle !== null && controller !== null) {
    handle.setResolutionScale(controller.maxScale);
    controller.reset(controller.maxScale);
    lastCommanded = handle.resolutionScale;
  }
}

/**
 * The scale actually being rendered at, or `null` before the system has run.
 *
 * Exists because the Settings screen was telling the player a number that was
 * not true. The slider renders `settings.graphics.resolutionScale` straight out
 * of the persisted store, while this controller writes through
 * `handle.setResolutionScale` and never writes back — so on a GPU-bound machine
 * the screen said "100%" while the renderer had walked down to 55% and was
 * upscaling. That reads as broken antialiasing and there was nothing anywhere
 * in the UI that could tell you otherwise: `perfOverlay` is off by default and
 * `stats().resolution` is the only other surface.
 */
export function adaptiveLiveScale(): number | null {
  return handle === null ? null : handle.resolutionScale;
}

export function adaptiveResolutionEnabled(): boolean { return enabled; }

export default defineSystem({
  id: 'render.adaptiveResolution',
  renderPhase: RenderPhase.Present,
  // After everything else at Present, so the interval covers the full frame.
  order: 100,

  init(): void {
    const c = ctx();
    handle = c.handle;
    // Start from whatever the quality tier chose. That value is the CEILING —
    // the controller only ever reclaims frame time below it, so it can never
    // quietly override a deliberate setting.
    controller = new AdaptiveResolution(handle.resolutionScale);
    adaptiveChanges = 0;
    adaptiveMedianMs = 0;

    /*
     * STAND DOWN WHILE THE WINDOW IS ACTUALLY CHANGING SIZE.
     *
     * A fullscreen toggle or a drag between displays is a burst of resizes, and
     * every frame in that burst is expensive for reasons that have nothing to do
     * with how heavy the scene is — buffers are being reallocated, shaders
     * re-specialised, the compositor re-laying out. Feeding those intervals to
     * the controller makes it cut resolution for a transient, and the cut is
     * itself another reallocation on top of the burst.
     *
     * So a change to the CSS LAYOUT BOX throws the window away and restarts the
     * cooldown. Only the layout box: the drawing-buffer size also changes on
     * every step this controller takes, and resetting on that would mean it
     * could never judge its own decision.
     */
    lastCssW = handle.size.cssWidth;
    lastCssH = handle.size.cssHeight;
    offResize = handle.onResize((size) => {
      if (size.cssWidth === lastCssW && size.cssHeight === lastCssH) return;
      lastCssW = size.cssWidth;
      lastCssH = size.cssHeight;
      controller?.reset(controller.current);
    });
  },

  frame(rc: RenderContext): void {
    if (!enabled || handle === null || controller === null) return;
    // A fixed-size render is a screenshot. The harness requires one
    // drawing-buffer pixel per requested pixel, and a scaled capture would
    // silently corrupt the visual scorecard — the exact class of defect
    // `docs/SPEC_DRIFT_AUDIT.md` catalogues. Never steer during one.
    if (handle.isFixedSize) return;
    /*
     * TWO CONTROLLERS MUST NOT STEER ONE HANDLE.
     *
     * `render.hardwareCalibration` runs at Present order 90, immediately before
     * this, and it deliberately moves the scale between two probe values to fit
     * a line. Every one of those moves looks to the check below like a
     * deliberate outside choice, so without this the calibration would re-arm
     * this controller's ceiling on every probe and then be steered against
     * while it measured — a line fitted through a moving target.
     */
    if (calibrationRunning()) return;

    /*
     * DID SOMEONE ELSE MOVE THE SCALE?
     *
     * `handle.setResolutionScale` has other callers — the Settings slider, and
     * `__VM.setResolutionScale` in the debug surface. Before this check, the
     * controller had no idea that had happened: it kept steering from its own
     * stale `current`, so a player who set 150% had it clawed straight back and
     * permanently re-clamped to the boot-time tier ceiling.
     *
     * `lastCommanded` is the last value THIS controller asked for. Any
     * disagreement with the live scale therefore came from outside, and an
     * outside change is a deliberate one: adopt it as the new ceiling.
     *
     * Compared with a tolerance because the scale round-trips through
     * `planDrawingBuffer` and back; an exact === would re-arm every frame.
     */
    const live = handle.resolutionScale;
    /*
     * `Number.isFinite` is not paranoia here. `resolutionScale` is typed
     * `number`, but I observed it reading `null` on a live handle while probing
     * a non-compositing page, alongside a `stats().resolution` of "NaNxNaN".
     * Whether that is a real defect elsewhere or an artifact of a renderer that
     * never got a valid drawing buffer, it must not become MY defect: an
     * unguarded `setCeiling(null)` sets both `scale` and `ceiling` to null, and
     * every subsequent decision arithmetics to NaN.
     *
     * CLAUDE.md records where that ends — "NaN propagating into a black frame",
     * where one bad value reached an instance colour, bloom spread it through
     * its mip chain, and every pixel died while stats cheerfully reported 285
     * draws. A controller that silently does nothing is a far better failure
     * than one that poisons the resolution.
     */
    if (!Number.isFinite(live)) return;
    if (lastCommanded >= 0 && Math.abs(live - lastCommanded) > 1e-3) {
      controller.setCeiling(live);
      lastCommanded = live;
      return;
    }

    const decision = controller.sample(rc.dt * 1000, rc.dt);
    adaptiveMedianMs = decision.medianMs;
    if (decision.scale === null) return;

    handle.setResolutionScale(decision.scale);
    lastCommanded = handle.resolutionScale;
    adaptiveChanges++;
  },

  dispose(): void {
    offResize?.();
    offResize = null;
    handle = null;
    controller = null;
    adaptiveChanges = 0;
    adaptiveMedianMs = 0;
    lastCssW = 0;
    lastCssH = 0;
  },
});

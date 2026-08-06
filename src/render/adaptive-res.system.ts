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

let handle: RendererHandle | null = null;
let controller: AdaptiveResolution | null = null;
let enabled = true;
/** Unsubscribe for the layout-box watcher below. */
let offResize: (() => void) | null = null;
/** Last CSS layout box seen, so a genuine window change can be told apart. */
let lastCssW = 0;
let lastCssH = 0;

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
  }
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

    const decision = controller.sample(rc.dt * 1000, rc.dt);
    adaptiveMedianMs = decision.medianMs;
    if (decision.scale === null) return;

    handle.setResolutionScale(decision.scale);
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

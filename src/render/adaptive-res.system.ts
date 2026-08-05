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
    handle = null;
    controller = null;
    adaptiveChanges = 0;
    adaptiveMedianMs = 0;
  },
});

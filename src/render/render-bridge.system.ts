/**
 * VOLTMARCH — the RenderBridge system module.
 *
 * Joins the frame at `RenderPhase.Bridge` (30): after terrain and the fog-of-war
 * upload, before unit/building anim (40/50) and VFX (60). That ordering is not
 * cosmetic —
 *   - anim modules write `recoil` / `animTime` / `emissive` for the NEXT frame
 *     and read the instance slots this pass allocated;
 *   - VFX calls `socketWorld()`, which is only valid once this pass has written
 *     the frame's interpolated transforms.
 *
 * The module itself is deliberately thin. All of the work lives in
 * RenderBridge.ts / InstanceBatcher.ts; this file exists to own the lifetime and
 * to publish the singleton other modules reach through `socketWorld()`.
 */

import { defineSystem } from '../core/loop';
import { RenderPhase } from '../core/types';
import type { RenderContext } from '../core/types';
import { infantryLegibilityScale } from '../core/config';
import { ctx } from '../game/context';

import { RenderBridge, clearKindMeshes, setRenderBridge } from './RenderBridge';

let bridge: RenderBridge | null = null;

export default defineSystem({
  id: 'render.bridge',
  renderPhase: RenderPhase.Bridge,
  order: 100,

  init(): void {
    const { world, sceneRig } = ctx();
    bridge = new RenderBridge(world.store, sceneRig.scene);
    setRenderBridge(bridge);
  },

  frame(r: RenderContext): void {
    const b = bridge;
    if (b === null) return;

    // THE INFANTRY LEGIBILITY FLOOR. Computed here rather than in the bridge
    // because it needs two things the bridge has no business holding: the
    // camera's zoom distance and field of view, and the size of the drawing
    // buffer the renderer is actually filling — which is CSS pixels times the
    // device ratio times whatever adaptive resolution has decided this second.
    // That last term is why the number is read fresh every frame instead of on
    // resize: a GPU stall drops the buffer and the floor has to answer for it.
    const { cameraRig, handle, debug } = ctx();
    const infantryScale = infantryLegibilityScale(
      cameraRig.distance, cameraRig.camera.fov, handle.size.height, handle.size.cssHeight,
    );
    b.update(r.alpha, infantryScale);
    // Quoted x100 so the F3 overlay can show it as a whole number; 100 means
    // "not scaling", which is what a close camera must always read.
    debug.counters.infScale = Math.round(infantryScale * 100);

    // Counters the F3 overlay reads. Nobody else computes these — the bridge is
    // the only place that knows what actually got drawn as opposed to what
    // merely exists in the EntityStore.
    const counters = ctx().debug.counters;
    counters.units = b.visibleUnits;
    counters.buildings = b.visibleBuildings;
    counters.instBatches = b.batchCount;
    counters.instDraws = b.drawCalls;
    counters.instances = b.instanceCount;
  },

  dispose(): void {
    // Order matters: clear the registry while the bridge is still published, so
    // each entry's batch is destroyed through the live batcher instead of being
    // orphaned with a dangling reference.
    clearKindMeshes();
    setRenderBridge(null);
    bridge?.dispose();
    bridge = null;
  },
});

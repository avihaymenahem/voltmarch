/**
 * RED ALERT — the RenderBridge system module.
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

    b.update(r.alpha);

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

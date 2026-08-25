/**
 * ============================================================================
 * VOLTMARCH — src/sim/production.system.ts
 * ============================================================================
 * Registration for the build loop.
 *
 * ONE module, TWO clocks:
 *   - `simTick` at Phase.Production (200) runs the queues, the credit drip,
 *     construction and egress. Deterministic, fixed 30 Hz, no wall clock.
 *   - `frame` at RenderPhase.Overlay (70) runs the placement ghost, which is
 *     pure presentation and must move at the display rate, not the sim rate —
 *     a ghost that only updates 30 times a second feels broken on a 144 Hz
 *     monitor even though nothing is wrong.
 *
 * Phase.Production is deliberately EARLY in the tick: a unit produced this tick
 * gets its steering, movement and targeting in the same tick rather than
 * standing in the factory door for one frame.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase, RenderPhase } from '../core/types';
import type { RenderContext, SimContext } from '../core/types';
import { ctx } from '../game/context';

import { PlacementController } from './Placement';
import { ProductionService, createCatalog, setProduction } from './Production';
import type { DebugCounters } from '../render/debug';

let service: ProductionService | null = null;
let placement: PlacementController | null = null;
let counters: DebugCounters | null = null;

export default defineSystem({
  id: 'sim.production',
  phase: Phase.Production,
  renderPhase: RenderPhase.Overlay,
  order: 0,

  async init(): Promise<void> {
    const { world, channels, sceneRig, cameraRig, handle, debug } = ctx();

    // Async because the def-table glob is lazy. Everything downstream of this
    // point is synchronous and allocation-free.
    const { catalog, binding } = await createCatalog();

    service = new ProductionService(world, channels, catalog);
    service.bindingTables = binding.tables;
    setProduction(service);

    placement = new PlacementController({
      world,
      scene: sceneRig.scene,
      rig: cameraRig,
      canvas: handle.canvas,
      service,
    });

    // Console handles. The screenshot harness and a human debugging a stuck
    // queue both want to poke this without a HUD in the way.
    const g = globalThis as unknown as Record<string, unknown>;
    g.__vmProduction = service;
    g.__vmPlacement = placement;

    counters = debug.counters;
    counters.queued = 0;
    counters.placing = 0;
    counters.factories = 0;

    console.info(
      `[production] ${catalog.count} catalog entries, ` +
      `${catalog.bound ? 'bound to real def tables' : 'fallback content'} — ` +
      `${catalog.roster(1 /* Allies */, 0).length} Allied structures, ` +
      `${catalog.roster(2 /* Soviets */, 3).length} Soviet vehicles`,
    );
  },

  simTick(s: SimContext): void {
    service?.tick(s);
  },

  frame(_r: RenderContext): void {
    if (placement === null || service === null) return;
    placement.frame();

    if (counters === null) return;
    const world = service.world;
    const p = world.players[world.localPlayer as number];
    if (p === undefined) return;
    let queued = 0;
    let factories = 0;
    for (let t = 0; t < p.queues.length; t++) {
      queued += p.queues[t].items.length;
      factories += p.queues[t].factoryCount;
    }
    counters.queued = queued;
    counters.factories = factories;
    counters.placing = placement.active ? 1 : 0;
  },

  dispose(): void {
    placement?.dispose();
    placement = null;
    service?.dispose();
    service = null;
    counters = null;
    setProduction(null);
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.__vmProduction;
    delete g.__vmPlacement;
  },
});

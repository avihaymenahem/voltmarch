/**
 * ============================================================================
 * VOLTMARCH — src/sim/regen.system.ts
 * ============================================================================
 * The registration shim for idle self-repair. All the work is in `Regen.ts`.
 *
 * `Phase.Cleanup` is deliberate: it runs after `Damage` has drained the queue
 * and resolved deaths, so regeneration can never top up an entity that is
 * already dying on this tick, and never races the damage it is meant to follow.
 *
 * Sliced to every `REGEN_TICK_INTERVAL` ticks rather than run every tick.
 * Healing 1.5% of max per second does not need 30 Hz resolution, and the pass
 * is a full scan of the entity array — exactly the kind of work `sliceEvery`
 * exists for. `dt` is scaled by the interval so the RATE is identical either
 * way; changing the interval retunes cost, never balance.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { SimContext } from '../core/types';
import type { World } from '../core/world';
import { ctx } from '../game/context';

import { REGEN_TICK_INTERVAL, regenTick } from './Regen';

let world: World | null = null;

/** Entities healed on the last pass. Read by tests and the debug handle. */
export let lastHealedCount = 0;

export default defineSystem({
  id: 'sim.regen',
  phase: Phase.Cleanup,
  // After the damage system's own cleanup, which owns death this tick.
  order: 50,

  init(): void {
    world = ctx().world;
    lastHealedCount = 0;
  },

  simTick(s: SimContext): void {
    if (world === null) return;
    if (s.tick % REGEN_TICK_INTERVAL !== 0) return;
    // One pass every N ticks, worth N ticks of healing.
    lastHealedCount = regenTick(world, s, s.dt * REGEN_TICK_INTERVAL);
  },

  dispose(): void {
    world = null;
    lastHealedCount = 0;
  },
});

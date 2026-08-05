/**
 * ============================================================================
 * VOLTMARCH — src/sim/crush.system.ts
 * ============================================================================
 * The registration shim for crushing. All the work is in `Crush.ts`, and its
 * header carries the reasoning.
 *
 * `Phase.Movement` with a late order, matching `Crates.ts` — the game's other
 * drive-over mechanic — so the test reads THIS tick's integrated positions and
 * the victim is consumed before `Phase.SpatialRebuild`. `order: 970` puts it
 * behind the integrator (100), the harvester dock check (900) and the crate
 * pickup (950): a crate under a tree should be collected on the same tick the
 * tree comes down, not the one after.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { SimContext } from '../core/types';
import { ctx } from '../game/context';
import type { DebugHandle } from '../render/debug';

import { CrushResolver } from './Crush';

let resolver: CrushResolver | null = null;
/** Held from `init` so the tick does not pay for a `ctx()` lookup. */
let debugHandle: DebugHandle | null = null;

/** The live resolver, for the debug handle and the tests. */
export function crushResolver(): CrushResolver | null { return resolver; }

export default defineSystem({
  id: 'sim.crush',
  phase: Phase.Movement,
  order: 970,

  init(): void {
    const { world, channels, debug } = ctx();
    resolver = new CrushResolver(world, channels);
    debugHandle = debug;
    debug.setCounter('propsCrushed', 0);
  },

  simTick(s: SimContext): void {
    if (resolver === null) return;
    resolver.simTick(s);
    // Only on a tick that actually felled something: the overlay wants the
    // running total, not 30 identical writes a second.
    if (resolver.lastCrushed > 0) {
      debugHandle?.setCounter('propsCrushed', resolver.crushedProps + resolver.crushedScatter);
    }
  },

  dispose(): void {
    resolver?.reset();
    resolver = null;
    debugHandle = null;
  },
});

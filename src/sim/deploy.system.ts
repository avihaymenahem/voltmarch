/**
 * ============================================================================
 * VOLTMARCH — src/sim/deploy.system.ts
 * ============================================================================
 * Registration for the deploy mechanic.
 *
 * PHASE.COMMAND, ORDER 9500 — and both halves of that are load-bearing.
 *
 *   Phase.Command  because `orderKind` and `state` are Command-owned columns in
 *                  the write-ownership table at the top of core/loop.ts, and
 *                  this is the module that CONSUMES an `OrderKind.Deploy`.
 *                  Running the transition anywhere else would mean a second
 *                  phase writing the behaviour FSM.
 *
 *   order 9500     because `src/input/Commands.ts`'s fallback order executor
 *                  sits at 9000 and is what writes a freshly issued Deploy onto
 *                  the entity. At 9500 we read it the same tick it was issued
 *                  instead of one tick later, so pressing D has no perceptible
 *                  delay before the vehicle locks down.
 *
 * Landing here also means a structure spawned by a deploy exists BEFORE
 * Phase.Production (200) runs, so the new Construction Yard is counted as a
 * factory, feeds the tech mask and lights up the sidebar on the very same tick.
 *
 * `init` is async only to await the def-table glob — `UnitDef.deploysInto` is
 * the authority on what unfolds into what, and `Deploy.ts` falls back to its
 * own three-row table if no data module was found (a `?shot=` boot, a headless
 * test). Nothing downstream of the await is async.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { SimContext } from '../core/types';
import { ctx } from '../game/context';
import { resolveDefBinding } from '../game/Scenarios';

import { DeployService, bindDeployTables, setDeploy } from './Deploy';

let service: DeployService | null = null;

export default defineSystem({
  id: 'sim.deploy',
  phase: Phase.Command,
  // Behind input's fallback order executor (9000), so an order issued this tick
  // is already written onto the entity when we look at it.
  order: 9500,

  async init(): Promise<void> {
    const { world, channels } = ctx();

    try {
      const binding = await resolveDefBinding();
      bindDeployTables(binding.tables);
    } catch {
      // No data module. `Deploy.FALLBACK_DEPLOYS_INTO` is a working answer, not
      // a stub — the mechanic stays live on fallback content.
      bindDeployTables(null);
    }

    service = new DeployService(world, channels);
    setDeploy(service);

    // Console handle, matching __vmProduction / __vmPlacement. The screenshot
    // harness and anyone debugging a stuck MCV both want to poke this.
    const g = globalThis as unknown as Record<string, unknown>;
    g.__vmDeploy = service;
  },

  simTick(s: SimContext): void {
    service?.tick(s);
  },

  dispose(): void {
    service?.dispose();
    service = null;
    setDeploy(null);
    bindDeployTables(null);
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.__vmDeploy;
  },
});

/**
 * ============================================================================
 * VOLTMARCH — src/sim/relocate.system.ts
 * ============================================================================
 * Registration for the relocation mechanic.
 *
 * PHASE.COMMAND, ORDER 9600 — and every part of that is load-bearing.
 *
 *   Phase.Command  because this is the module that consumes a player's
 *                  relocation order, and because `state` is a Command-owned
 *                  column in the write-ownership table at the top of
 *                  core/loop.ts — uprooting a structure writes it.
 *
 *   order 9600     behind `sim.deploy` (9500) and behind input's fallback order
 *                  executor (9000). Behind deploy specifically: a structure
 *                  that is mid-deploy this tick has already been given its
 *                  `UnitState.Deploying`, so `subjectFault` sees it and refuses
 *                  rather than uprooting something halfway through becoming a
 *                  vehicle.
 *
 * Landing at the END of Phase.Command also means a structure that arrives this
 * tick exists BEFORE Phase.Production (200) runs, so the census counts it, the
 * tech mask sees it and the rally / primary intents this module pushes are
 * drained in the SAME tick rather than the next one.
 *
 * `init` is synchronous. Unlike `sim.deploy` this module needs no def tables —
 * `Deploy.isUndeployable` answers the one content question it asks, off whatever
 * tables deploy itself bound.
 *
 * WHY THE PRODUCTION SERVICE IS NOT INJECTED HERE
 * -----------------------------------------------
 * `SystemRegistry.initAll` runs inits in PHASE order. This module is
 * Phase.Command (100); `sim.production` is Phase.Production (200). So at the
 * moment this `init` runs, `production()` is genuinely null and will be for the
 * rest of the boot sequence. `RelocateService` therefore resolves it per call,
 * exactly as `DeployService` does, and the seam is installed here so the
 * placement ghost can offer the gesture the instant production does land.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { SimContext } from '../core/types';
import { ctx } from '../game/context';

import { setRelocateSeam } from './Placement';
import { RELOCATE, RelocateService, setRelocate } from './Relocate';

let service: RelocateService | null = null;

export default defineSystem({
  id: 'sim.relocate',
  phase: Phase.Command,
  // Behind sim.deploy (9500), so a structure that started packing into a
  // vehicle this tick is already in `UnitState.Deploying` when we look at it.
  order: 9600,

  init(): void {
    const { world, channels } = ctx();

    service = new RelocateService(world, channels);
    setRelocate(service);
    // The return path Placement.ts's ghost commits through. Installed here and
    // cleared in dispose; with nothing installed `beginRelocate` simply refuses,
    // so the ghost is never handed a subject it could not put down.
    setRelocateSeam(service);

    // Console handle, matching __vmProduction / __vmPlacement / __vmDeploy. The
    // HUD's relocate button reads this one, and so does tools/playtest.mjs.
    const g = globalThis as unknown as Record<string, unknown>;
    g.__vmRelocate = service;

    console.info(
      `[relocate] structures move for ${Math.round(RELOCATE.costFraction * 100)}% of build cost ` +
      `(min ${RELOCATE.minCost}), ${RELOCATE.transitSeconds}s in transit`,
    );
  },

  simTick(s: SimContext): void {
    service?.tick(s);
  },

  dispose(): void {
    service?.dispose();
    service = null;
    setRelocate(null);
    setRelocateSeam(null);
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.__vmRelocate;
  },
});

/**
 * ============================================================================
 * VOLTMARCH — src/sim/abilities.system.ts
 * ============================================================================
 * Registration for the commander abilities.
 *
 * PHASE.COMMAND, ORDER 9600 — both halves load-bearing, and both for the same
 * reasons `sim/deploy.system.ts` gives at 9500:
 *
 *   Phase.Command  `orderKind` is a Command-owned column in the write-ownership
 *                  table at the top of `core/loop.ts`, and this module CONSUMES
 *                  an `OrderKind.UseAbility`. Consuming it anywhere else would
 *                  mean a second phase writing the behaviour FSM.
 *
 *   order 9600     behind input's fallback order executor (9000), which is what
 *                  writes a freshly issued order onto the entity, and behind
 *                  deploy (9500). So an ability pressed this tick fires this
 *                  tick — a one-tick lag on a hero button is felt.
 *
 * Landing in Command also means an ability resolves BEFORE Targeting (900),
 * Weapons (1000) and Damage (1200): a Prism Focus queued here is applied in the
 * same tick's damage pass, and an Iron Will granted here protects against fire
 * that has not been resolved yet rather than against next tick's.
 *
 * `init` is async only to await the def-table glob — `UnitDef.ability` is the
 * authority on which unit carries what, and there is no fallback table for it
 * on purpose: a commander is content, and on a boot with no content module
 * (a `?shot=` capture, a headless render test) there are no commanders to have
 * abilities. The service simply answers `AbilityId.None` for everything.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import type { SimContext } from '../core/types';
import { ctx } from '../game/context';
import { resolveDefBinding } from '../game/Scenarios';

import { AbilityService, setAbilityService } from './Abilities';

let service: AbilityService | null = null;

export default defineSystem({
  id: 'sim.abilities',
  phase: Phase.Command,
  order: 9600,

  async init(): Promise<void> {
    const { world, channels } = ctx();

    service = new AbilityService(world, channels);

    try {
      const binding = await resolveDefBinding();
      service.bindTables(binding.tables?.units ?? null);
    } catch {
      // No data module. Every unit reads as ability-less, which is correct:
      // the four commanders only exist in the content tables.
      service.bindTables(null);
    }

    setAbilityService(service);

    // Console handle, matching __vmProduction / __vmDeploy. Debugging a
    // cooldown that will not clear starts here.
    const g = globalThis as unknown as Record<string, unknown>;
    g.__vmAbilities = service;
  },

  simTick(s: SimContext): void {
    service?.tick(s);
  },

  dispose(): void {
    service?.dispose();
    service = null;
    setAbilityService(null);
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.__vmAbilities;
  },
});

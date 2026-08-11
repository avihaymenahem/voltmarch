/**
 * ============================================================================
 * src/sim/civilian.system.ts — AN OIL DERRICK PAYS WHOEVER HOLDS IT
 * ============================================================================
 *
 * The reason to walk an engineer across the map. `src/data/Civilians.ts` puts
 * three neutral structures on it and two of them are firing positions; this is
 * the third one's whole mechanic.
 *
 * IT JOINS THE GAME BY EXISTING. `src/game/Systems.ts` globs `*.system.ts` and
 * registers whatever default-exports a `SystemModule`, which is why nothing in
 * `features.system.ts` or `Bootstrap.ts` had to be edited to add a verb.
 *
 * WHY IT IS NOT A LUMP ON CAPTURE
 * -------------------------------
 * `GarrisonService.enter` flips a neutral structure to the occupier by calling
 * `captureService().captureBuilding(...)`, and `releaseEmptied` flips it back
 * the instant the last man walks out. A bonus paid on `'building:captured'`
 * would therefore pay out every time one rifleman entered and left a derrick,
 * forever, and the exploit is in the plumbing rather than in the balance — no
 * amount of tuning removes it. A drip has no such edge: the payout is a
 * function of who holds the deed at each interval and of nothing else.
 *
 * WHY IT IS OFF THE TICK COUNTER
 * ------------------------------
 * The three wall-clock sources CLAUDE.md names are banned inside `simTick` and
 * `tests/foundation.spec.ts` enforces it with a regex over the whole file —
 * COMMENTS INCLUDED, which is why this paragraph does not spell them. (It did,
 * and the gate failed the file for describing the rule it obeys. That is the
 * gate being blunt rather than wrong: a comment naming one is one search-and-
 * replace away from being code that calls it.)
 *
 * The real reason is narrower than hygiene anyway: two clients in deterministic
 * lockstep have to bank the same credit on the same tick. `s.tick %
 * intervalTicks` is the same integer on both machines whatever their clocks
 * say; `s.time` would be too (it is `tick * SIM_DT`) but it is a float, and a
 * float modulus is a desync waiting for a long match.
 *
 * ITERATION ORDER IS `store.byKind[Building]`, which is the same array in the
 * same order on both clients because entity allocation is deterministic. It is
 * scanned in full rather than kept as a derrick list on purpose: a list would
 * need maintaining against capture, sale, destruction and `markDead`, and the
 * scan happens once a second over the ~40 structures a match holds.
 *
 * PHASE. `Phase.Economy`, after `economy.system.ts`'s own ledger flush at
 * order 400 and after the repair drip at 500, so a payout lands in the same
 * `economy:credits` coalescing window as everything else that tick.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { CreditReason, EntityFlag, EntityKind, Faction, Phase } from '../core/types';
import type { PlayerId, SimContext } from '../core/types';
import type { World } from '../core/world';
import { ctx } from '../game/context';
import { resolveDefBinding } from '../game/Scenarios';
import { CIVILIAN_INCOME } from '../data/Civilians';

import { getEconomy, type Economy } from './Economy';

/**
 * The def index of the paying structure, or -1 for "there is none".
 *
 * Resolved ONCE, in `init`, off the same `resolveDefBinding()` every other
 * consumer uses — so it is content, identical on every client, and settled
 * before the first tick runs. -1 makes this module completely inert, which is
 * the correct behaviour for a boot with no data module at all.
 */
let derrickDefId = -1;

/** Captured at init so the tick never pays for a context lookup. */
let world: World | null = null;

/** Diagnostics for `__vmCivilians`. Not read by the simulation. */
export interface DerrickStats {
  payouts: number;
  credited: number;
  derricksHeld: number;
}

const stats: DerrickStats = { payouts: 0, credited: 0, derricksHeld: 0 };

/**
 * ONE PAYOUT ROUND. Returns how many derricks were held by a real army.
 *
 * Split out of `simTick` and exported so `tests/civilians.spec.ts` can drive it
 * against a plain `World` + `Economy`. The registration shim above is the only
 * part of this file that touches `ctx()`, which is the same split
 * `features.spec.ts` relies on for the five services in `features.system.ts` —
 * and it is the difference between a mechanic with a test and a mechanic that
 * needs a browser to prove.
 *
 * ALLOCATION-FREE and order-stable: it walks `store.byKind[Building]`, which is
 * the same array in the same order on every client, so two machines in lockstep
 * credit the same players in the same sequence.
 */
export function payDerricks(
  w: World, economy: Economy, defId: number, out?: DerrickStats,
): number {
  const st = w.store;
  const list = st.byKind[EntityKind.Building];
  const n = st.byKindCount[EntityKind.Building];
  let held = 0;

  for (let a = 0; a < n; a++) {
    const i = list[a];
    if (st.defId[i] !== defId) continue;
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0) continue;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction)) !== 0) continue;

    // A derrick nobody has taken pays nobody. `world.players[owner]` is Gaia
    // until an engineer or a garrison changes the deed, and Gaia has no bank
    // worth crediting — paying it would also hand the HUD a credit event for a
    // player that is not in the match.
    const owner = st.owner[i] as PlayerId;
    const p = w.players[owner as number];
    if (p === undefined || p.faction === Faction.Neutral) continue;

    held++;
    // `deposit`, not `grant`: this is income and it honours the storage cap
    // exactly as a harvester load does, so a player sitting at their cap with
    // two derricks gets the same "silos needed" answer the game already gives
    // them. `CreditReason.Bounty` is the reason `Crates.ts` already uses for
    // money that did not come out of the ground — it skips the AI's
    // `resourceBonus` handicap (which must apply to MINING, not to a fixed map
    // reward) and the mission tracker does not count it as ore.
    const banked = economy.deposit(owner, CIVILIAN_INCOME.credits, CreditReason.Bounty);
    if (banked > 0 && out !== undefined) {
      out.payouts++;
      out.credited += banked;
    }
  }
  return held;
}

export default defineSystem({
  id: 'sim.civilian',
  phase: Phase.Economy,
  order: 600,

  async init(): Promise<void> {
    world = ctx().world;
    const binding = await resolveDefBinding();
    derrickDefId = binding.buildingId[CIVILIAN_INCOME.key] ?? -1;

    stats.payouts = 0;
    stats.credited = 0;
    stats.derricksHeld = 0;

    (globalThis as unknown as Record<string, unknown>).__vmCivilians = {
      defId: () => derrickDefId,
      stats,
      income: CIVILIAN_INCOME,
    };

    if (derrickDefId < 0) {
      // Loud, because the failure is otherwise invisible: derricks stand on
      // the map, change hands, and silently pay nobody. Exactly the shape of
      // the "finished mechanic with no content" defect this whole change set
      // exists to close.
      console.warn(
        `[civilian] no def bound for "${CIVILIAN_INCOME.key}" — oil derricks will pay nothing. `
        + 'Check BUILDING_ALIASES in src/game/Scenarios.ts.',
      );
      return;
    }
    console.info(
      `%c[civilian]%c oil derricks pay ${CIVILIAN_INCOME.credits} credits every `
      + `${CIVILIAN_INCOME.intervalTicks} ticks (def ${derrickDefId})`,
      'color:#fd7', 'color:inherit',
    );
  },

  simTick(s: SimContext): void {
    if (derrickDefId < 0 || world === null) return;
    if (s.tick % CIVILIAN_INCOME.intervalTicks !== 0) return;
    const economy = getEconomy();
    if (economy === null) return;
    stats.derricksHeld = payDerricks(world, economy, derrickDefId, stats);
  },

  dispose(): void {
    derrickDefId = -1;
    world = null;
    delete (globalThis as unknown as Record<string, unknown>).__vmCivilians;
  },
});

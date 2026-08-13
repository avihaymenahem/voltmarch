/**
 * ============================================================================
 * src/sim/civilian.system.ts — A CAPTURED STRUCTURE PAYS WHOEVER HOLDS IT
 * ============================================================================
 *
 * The reason to walk an engineer across the map — or a squad, which flips the
 * deed just as well for as long as they stand in it. `src/data/Civilians.ts`
 * puts four neutral structures on it; two are firing positions, and the other
 * two (the Oil Derrick and the Ore Mine) are this file's whole mechanic.
 *
 * TWO SOURCES, ONE LOOP, AND NO SECOND MECHANISM. The mine arrived from "lets
 * spawn small amount of coal / ore / money mines around the map, conquering
 * with troops make us get income" and it is the derrick's rule pointed at a
 * second def id at a third of the rate. The only change this file needed was
 * turning one resolved def id into `CIVILIAN_INCOME_SOURCES`; everything below
 * about determinism, iteration order and the phase is unchanged and still
 * true, because none of it ever depended on there being exactly one.
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
import { CIVILIAN_INCOME, CIVILIAN_INCOME_SOURCES } from '../data/Civilians';

import { getEconomy, type Economy } from './Economy';

/**
 * The def index of each paying structure, parallel to
 * `CIVILIAN_INCOME_SOURCES`, or -1 for "this build has no such def".
 *
 * Resolved ONCE, in `init`, off the same `resolveDefBinding()` every other
 * consumer uses — so it is content, identical on every client, and settled
 * before the first tick runs. All -1 makes this module completely inert, which
 * is the correct behaviour for a boot with no data module at all.
 *
 * A PLAIN ARRAY AND NOT A MAP, because the tick walks it once per payout round
 * and the whole file allocates nothing per tick. It is two entries long.
 */
const sourceDefIds: number[] = CIVILIAN_INCOME_SOURCES.map(() => -1);

/**
 * The interval every source shares. See `CIVILIAN_INCOME_SOURCES` for why there
 * is only one: the payout round is gated on a single `s.tick % n`, and a source
 * with its own period would need a second coalescing window for one mechanic.
 * `tests/civilians.spec.ts` asserts the sources agree, so this is a read of the
 * first rather than a choice made here.
 */
const INTERVAL_TICKS = CIVILIAN_INCOME.intervalTicks;

/** Captured at init so the tick never pays for a context lookup. */
let world: World | null = null;

/** Diagnostics for `__vmCivilians`. Not read by the simulation. */
export interface DerrickStats {
  payouts: number;
  credited: number;
  /** Derricks held by a real army at the last payout. */
  derricksHeld: number;
  /** Ore mines held by a real army at the last payout. */
  minesHeld: number;
}

const stats: DerrickStats = { payouts: 0, credited: 0, derricksHeld: 0, minesHeld: 0 };

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
export function payHolders(
  w: World, economy: Economy, defId: number, credits: number, out?: DerrickStats,
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
    const banked = economy.deposit(owner, credits, CreditReason.Bounty);
    if (banked > 0 && out !== undefined) {
      out.payouts++;
      out.credited += banked;
    }
  }
  return held;
}

/**
 * The derrick's binding of `payHolders`, kept because it is the one every
 * existing caller and `tests/civilians.spec.ts` name. It is not a legacy shim
 * — the derrick is still a source and this is still exactly its payout — but
 * new code should call `payHolders` with the source it means.
 */
export function payDerricks(
  w: World, economy: Economy, defId: number, out?: DerrickStats,
): number {
  return payHolders(w, economy, defId, CIVILIAN_INCOME.credits, out);
}

export default defineSystem({
  id: 'sim.civilian',
  phase: Phase.Economy,
  order: 600,

  async init(): Promise<void> {
    world = ctx().world;
    const binding = await resolveDefBinding();

    stats.payouts = 0;
    stats.credited = 0;
    stats.derricksHeld = 0;
    stats.minesHeld = 0;

    (globalThis as unknown as Record<string, unknown>).__vmCivilians = {
      defId: () => sourceDefIds[0]!,
      defIds: () => sourceDefIds.slice(),
      stats,
      income: CIVILIAN_INCOME,
      sources: CIVILIAN_INCOME_SOURCES,
    };

    for (let k = 0; k < CIVILIAN_INCOME_SOURCES.length; k++) {
      const src = CIVILIAN_INCOME_SOURCES[k]!;
      const defId = binding.buildingId[src.key] ?? -1;
      sourceDefIds[k] = defId;
      if (defId < 0) {
        // Loud, because the failure is otherwise invisible: the structure
        // stands on the map, changes hands, and silently pays nobody. Exactly
        // the shape of the "finished mechanic with no content" defect this
        // whole module exists to close.
        console.warn(
          `[civilian] no def bound for "${src.key}" — it will pay nothing. `
          + 'Check BUILDING_ALIASES in src/game/Scenarios.ts.',
        );
        continue;
      }
      console.info(
        `%c[civilian]%c "${src.key}" pays ${src.credits} credits every `
        + `${src.intervalTicks} ticks (def ${defId})`,
        'color:#fd7', 'color:inherit',
      );
    }
  },

  simTick(s: SimContext): void {
    if (world === null) return;
    if (s.tick % INTERVAL_TICKS !== 0) return;
    const economy = getEconomy();
    if (economy === null) return;
    // FIXED ORDER over a fixed-length array, which is the lockstep clause: two
    // clients credit the same players from the same sources in the same
    // sequence, so the coalesced `economy:credits` event carries the same
    // numbers on both machines.
    for (let k = 0; k < CIVILIAN_INCOME_SOURCES.length; k++) {
      const defId = sourceDefIds[k]!;
      if (defId < 0) continue;
      const held = payHolders(world, economy, defId, CIVILIAN_INCOME_SOURCES[k]!.credits, stats);
      if (k === 0) stats.derricksHeld = held;
      else stats.minesHeld = held;
    }
  },

  dispose(): void {
    sourceDefIds.fill(-1);
    world = null;
    delete (globalThis as unknown as Record<string, unknown>).__vmCivilians;
  },
});

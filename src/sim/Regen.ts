/**
 * ============================================================================
 * VOLTMARCH — src/sim/Regen.ts
 * ============================================================================
 * IDLE SELF-REPAIR for mobile units.
 *
 * Requested: "add some healing over time to troops and vehicles when idle."
 *
 * `RepairSell.ts` already drip-heals STRUCTURES, but only when the player flags
 * them and only while they can pay `REPAIR_COST_PER_HP`. Mobile units had no
 * recovery at all short of a Heal crate, so a tank that won a fight at 12% HP
 * stayed at 12% for the rest of the match. That turns every skirmish into a
 * permanent tax and pushes the whole game toward one big doomstack, because
 * damaged units are never worth committing again.
 *
 * WHAT COUNTS AS IDLE
 * -------------------
 * Two conditions, and both matter:
 *
 *   1. **Out of combat.** `store.lastHitTime` is already maintained by
 *      `Damage.ts:344` and already read by `AI.ts` and `Targeting.ts`, so this
 *      needs no new bookkeeping and no event subscription. A unit must have
 *      gone `OUT_OF_COMBAT_SEC` without taking a hit.
 *   2. **Not doing anything.** `UnitState.Idle` or `Guarding` only. A unit that
 *      is moving, attacking, harvesting or capturing is working, not resting.
 *
 * Deliberately NOT "regenerates while retreating": healing mid-withdrawal makes
 * hit-and-run strictly dominant, which is the failure mode this kind of rule
 * usually introduces. You have to actually stop and hold still.
 *
 * WHY IT IS SLOW
 * --------------
 * `REGEN_FRACTION_PER_SEC` is a fraction of MAX hp, so a heavy tank and a rifle
 * squad take the same wall-clock time to recover — which is the behaviour that
 * reads as fair. At 2.5%/s a unit needs ~40 s from near-death to full. That is
 * long enough that pulling a damaged force back is a real decision with a real
 * cost in tempo, and short enough that it happens within one match.
 *
 * THE RETUNE, AND WHAT IT WAS FIXING
 * ----------------------------------
 * The player listed "troops and vehicles heal over time" among the things they
 * could not see in the shipped build. `sim.regen` was registered and running;
 * two separate things made it invisible, and only one of them is in this file.
 *
 *   1. NOTHING DREW IT. `src/ui/Overlay.ts` showed a health bar for a unit that
 *      was selected, hovered, or hit inside `HUD_OVERLAY.damageBarSeconds` (4 s)
 *      — and regeneration does not start until `REGEN_OUT_OF_COMBAT_SEC` (8 s)
 *      after the last hit. The bar was therefore guaranteed to be GONE by the
 *      time healing began. That is the bigger of the two faults and it is fixed
 *      over there; `isRegenerating` below is exported so the overlay asks this
 *      module rather than keeping a second copy of the rule.
 *
 *   2. THE CEILING MADE IT A NO-OP IN ITS MOST COMMON CASE. `REGEN_CEILING` was
 *      0.75, so a unit that came out of a skirmish at 80% healed NOTHING, ever
 *      — and "lightly damaged" is what most units are after most fights. A
 *      player watching an 80% tank sit still for a minute is watching a feature
 *      that, for that unit, does not exist.
 *
 *      The stated reason for the ceiling was that "full self-repair would make
 *      the Service Depot and the Heal crate pointless". Half of that is not
 *      true: there is no Service Depot in this game — grep the def tables, no
 *      structure repairs mobile units. The Heal crate (`src/sim/Crates.ts`) is
 *      real, and it is a different product: instant, area-of-effect, to FULL,
 *      and it works while the unit is moving and under fire. None of those are
 *      things this rule can do, so it never competed with the crate.
 *
 *      The ceiling is now 1.0. The gate that keeps this from being free is not
 *      a cap on the result, it is the cost of getting it: you must break off,
 *      stop moving, and stand still for eight seconds plus the recovery itself.
 *
 * The rate went 1.5%/s -> 2.5%/s in the same pass. 1.5%/s over the 0.5 s slice
 * is 0.75% of a bar per tick, which on a 34-design-px bar is a quarter of a
 * pixel: even with the bar now on screen there was nothing to watch. 2.5%/s
 * refills a lightly damaged unit in a few seconds — the case the player will
 * actually see — and still costs ~40 s for a near-dead one.
 *
 * IT APPLIES TO EVERY PLAYER, INCLUDING THE AI. A regeneration rule that only
 * the human gets is a cheat in the player's favour and would quietly invalidate
 * every balance measurement taken since.
 *
 * DETERMINISM
 * -----------
 * Pure arithmetic against `s.time` and the store. No `Math.random`, no
 * `Date.now`, no allocation. Runs at `Phase.Cleanup`, AFTER `Damage` has
 * applied the queue and resolved deaths, so it can never heal an entity that
 * is already dying this tick or race the damage it is meant to follow.
 * ============================================================================
 */

import { EntityFlag, EntityKind, UnitState } from '../core/types';
import type { SimContext } from '../core/types';
import type { World } from '../core/world';

/**
 * Seconds a unit must go without being hit before it starts recovering.
 *
 * Longer than `Targeting.RETALIATE_MEMORY` on purpose: a unit that is still
 * angry about being shot is not resting.
 */
export const REGEN_OUT_OF_COMBAT_SEC = 8;

/**
 * Fraction of MAX hp restored per second once resting.
 *
 * Of max, not of current, so recovery time is the same for every unit class.
 * 0.025 is ~40 s from a sliver to full.
 *
 * It was 0.015. See "THE RETUNE" in the header: at 0.015 a 0.5 s slice moved a
 * 34-px health bar by a quarter of a pixel, so even once the bar was drawn
 * there was nothing on it to see.
 */
export const REGEN_FRACTION_PER_SEC = 0.025;

/**
 * Units recover to this fraction of max on their own.
 *
 * 1.0 — all the way. It was 0.75, which meant a unit that finished a fight at
 * 80% healed nothing at all, and that is the state most units are in most of
 * the time. The stated reason was to protect the Service Depot, and there is no
 * Service Depot in this game. The Heal crate is real and is untouched by this:
 * it is instant, area, and works while the unit is moving and under fire.
 *
 * Kept as a named constant rather than deleted, because the RULE — "there is a
 * ceiling on unassisted recovery" — is a lever a balance pass may want back,
 * and `tests/regen.spec.ts` pins the behaviour against this name.
 */
export const REGEN_CEILING = 1.0;

/** Ticks between passes. Regen is slow; it does not need to run at 30 Hz. */
export const REGEN_TICK_INTERVAL = 15;

/** True for the states that count as resting. */
function isResting(state: number): boolean {
  return state === UnitState.Idle || state === UnitState.Guarding;
}

/** True for the entity kinds that self-repair. Structures are RepairSell's. */
function isMobileUnit(kind: number): boolean {
  return kind === EntityKind.Infantry || kind === EntityKind.Vehicle;
}

/**
 * Is the entity at slot `i` recovering hit points RIGHT NOW?
 *
 * Exported because the HUD has to draw it and there must be exactly ONE
 * statement of the rule. `src/ui/Overlay.ts` calls this to decide whether to
 * put a health bar up for an idle unit and mark it as healing; `regenTick`
 * below calls it to decide whether to add the hp. If those two ever disagreed
 * the interface would be lying about the simulation, which is the whole defect
 * this pass exists to fix — so they cannot be two predicates.
 *
 * Pure: reads the store and a clock, writes nothing, allocates nothing. Safe
 * from a render frame and safe from `simTick`.
 *
 * `st` is duck-typed to the six columns it reads rather than to `EntityStore`,
 * so the UI does not acquire a dependency on the world module's class.
 */
export interface RegenReadable {
  readonly flags: Int32Array | Uint32Array;
  readonly kind: Int32Array | Uint8Array;
  readonly hp: Float32Array;
  readonly maxHp: Float32Array;
  readonly state: Int32Array | Uint8Array;
  readonly lastHitTime: Float32Array;
}

export function isRegenerating(st: RegenReadable, i: number, time: number): boolean {
  const f = st.flags[i];
  if ((f & EntityFlag.Alive) === 0) return false;
  if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction
    | EntityFlag.Garrisoned)) !== 0) return false;
  if (!isMobileUnit(st.kind[i])) return false;

  const max = st.maxHp[i];
  if (max <= 0) return false;
  // Note the `>=`: a unit healed past the ceiling by a crate is left alone
  // rather than dragged back down to it.
  if (st.hp[i] >= max * REGEN_CEILING) return false;

  if (!isResting(st.state[i])) return false;
  return time - st.lastHitTime[i] >= REGEN_OUT_OF_COMBAT_SEC;
}

/**
 * One regeneration pass. Returns how many entities were healed, which the
 * system module reports so a silent no-op is visible rather than assumed.
 */
export function regenTick(world: World, s: SimContext, dt: number): number {
  const st = world.store;
  const n = st.count;
  let healed = 0;

  for (let i = 0; i < n; i++) {
    // ONE predicate, shared with the HUD. See `isRegenerating`.
    if (!isRegenerating(st, i, s.time)) continue;

    const max = st.maxHp[i];
    const ceiling = max * REGEN_CEILING;
    const next = st.hp[i] + max * REGEN_FRACTION_PER_SEC * dt;
    st.hp[i] = next > ceiling ? ceiling : next;
    healed++;
  }

  return healed;
}

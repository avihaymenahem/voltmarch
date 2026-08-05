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
 * reads as fair. At 1.5%/s a unit needs ~67 s from near-death to full. That is
 * long enough that pulling a damaged force back is a real decision with a real
 * cost in tempo, and short enough that it happens within one match.
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
 * 0.015 is ~67 s from a sliver to full.
 */
export const REGEN_FRACTION_PER_SEC = 0.015;

/**
 * Units only ever recover to this fraction of max on their own.
 *
 * Full self-repair would make the Service Depot and the Heal crate pointless.
 * Getting a battered force back to three-quarters is the part that improves the
 * game; the last quarter is what those exist to sell.
 */
export const REGEN_CEILING = 0.75;

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
 * One regeneration pass. Returns how many entities were healed, which the
 * system module reports so a silent no-op is visible rather than assumed.
 */
export function regenTick(world: World, s: SimContext, dt: number): number {
  const st = world.store;
  const n = st.count;
  let healed = 0;

  for (let i = 0; i < n; i++) {
    const f = st.flags[i];
    if ((f & EntityFlag.Alive) === 0) continue;
    if ((f & (EntityFlag.PendingDestroy | EntityFlag.UnderConstruction
      | EntityFlag.Garrisoned)) !== 0) continue;
    if (!isMobileUnit(st.kind[i])) continue;

    const max = st.maxHp[i];
    if (max <= 0) continue;
    const ceiling = max * REGEN_CEILING;
    const hp = st.hp[i];
    // Already at or above the self-repair ceiling. Note the `>=`: a unit healed
    // past the ceiling by a crate or a depot is left alone rather than dragged
    // back down to it.
    if (hp >= ceiling) continue;

    if (!isResting(st.state[i])) continue;
    if (s.time - st.lastHitTime[i] < REGEN_OUT_OF_COMBAT_SEC) continue;

    const next = hp + max * REGEN_FRACTION_PER_SEC * dt;
    st.hp[i] = next > ceiling ? ceiling : next;
    healed++;
  }

  return healed;
}

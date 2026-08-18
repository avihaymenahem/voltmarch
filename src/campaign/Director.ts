/**
 * ============================================================================
 * VOLTMARCH — src/campaign/Director.ts
 * ============================================================================
 * THE EVALUATOR. Reads an operation's trigger table against a `WorldQuery`,
 * writes the trigger bookkeeping on `OperationState`, and fills a
 * caller-supplied array with the effects that should be applied this tick.
 *
 * IT TOUCHES THE WORLD THROUGH `WorldQuery` AND NOTHING ELSE, which is what
 * makes it testable with no engine and what makes "the Director read something
 * presentation-side" a compile error rather than a divergence found by the
 * replay probe two phases late. It imports one type module. It has no clock —
 * `tick` is a parameter — and no randomness.
 *
 * ============================================================================
 * DETERMINISM, AND WHAT "PURE" HONESTLY MEANS HERE
 * ============================================================================
 * `runDirector` MUTATES `state.armedAt` and `state.fired`. It is not pure in
 * the referential sense and pretending otherwise would be the vacuous kind of
 * claim this project keeps catching itself making. What it IS:
 *
 *   - a total function of `(op, state, world facts, tick)` — no `Date.now`, no
 *     `performance.now`, no `Math.random`, no DOM, no profile, no `isBuildable`;
 *   - deterministic — run it twice from a CLONED state and the effect list is
 *     deep-equal, which is exactly what `campaign-determinism.spec.ts` asserts;
 *   - allocation-free on the hot path — the caller supplies the output array
 *     and this function only pushes into it.
 *
 * Every objective, credit and outcome write happens in the SINK, not here, so
 * the two halves can be tested apart and so a dry run costs nothing.
 *
 * ============================================================================
 * THE TWO-PASS EVALUATION, WHICH IS THE ONE SUBTLE THING IN THE FILE
 * ============================================================================
 * `elapsedSinceArmed` is a HOLD TIMER, and a hold timer needs to know when its
 * siblings started being true. So each trigger is evaluated twice:
 *
 *   1. **The arming pass**, with every `elapsedSinceArmed` forced true. If the
 *      rest of the tree holds, the trigger is armed — record the tick, once. If
 *      it does not, DISARM: drop the tick entirely.
 *   2. **The real pass.** `elapsedSinceArmed` now compares against that tick.
 *
 * "Hold three derricks for six minutes" is therefore
 * `all: [ownerCount(...), elapsedSinceArmed(minutes(6))]`, and losing a derrick
 * at minute five restarts the clock — which is what a player expects and what a
 * plain `elapsed` gets wrong in the direction that gives the win away.
 *
 * A trigger with no `elapsedSinceArmed` anywhere in its tree evaluates the same
 * both passes, so the second pass is free for the 90% case and the first pass
 * costs one extra walk of a tree that is typically three nodes deep.
 * ========================================================================== */

import type {
  Condition, Effect, OperationDef, OperationState, TriggerDef, WorldQuery,
} from './types';

/* ==========================================================================
 * 1. CONDITIONS
 * ========================================================================== */

/**
 * `armFree` is the arming pass: every `elapsedSinceArmed` answers true, so the
 * result describes whether the trigger's OTHER conditions hold right now.
 */
function holds(
  c: Condition,
  op: OperationDef,
  state: OperationState,
  q: WorldQuery,
  tick: number,
  armTick: number,
  armFree: boolean,
): boolean {
  switch (c.on) {
    case 'elapsed':
      return tick - state.startTick >= c.ticks;

    case 'elapsedSinceArmed':
      if (armFree) return true;
      return armTick >= 0 && tick - armTick >= c.ticks;

    case 'entityAlive':
      return q.aliveWithTag(c.tag) > 0;

    case 'entityDead':
      // TRUE BEFORE THE TAG EXISTS. That is a real trap and it is why
      // `campaign-reachability.spec.ts` requires every tag a condition names to
      // be produced by that operation's layout — otherwise a `protect` fails on
      // tick one, silently, in the player's favour-shaped direction.
      return q.aliveWithTag(c.tag) === 0;

    case 'entityHpBelow': {
      const f = q.weakestHpFrac(c.tag);
      // -1 means nothing alive carries the tag. A dead escort is NOT "below
      // 30% health" — that is `entityDead`, and conflating them makes a
      // wounded-convoy warning fire forever after the convoy dies.
      return f >= 0 && f < c.frac;
    }

    case 'unitsInArea':
      return q.unitsInArea(c.player, c.area, c.tag ?? null) >= c.min;

    case 'ownerCount': {
      const n = q.ownerCount(c.player, c.role, c.tag ?? null);
      if (c.min !== undefined && n < c.min) return false;
      if (c.max !== undefined && n > c.max) return false;
      return true;
    }

    case 'structureCaptured':
      return q.ownerOfTag(c.tag) === c.player;

    case 'credits': {
      const n = q.creditsOf(c.player);
      if (c.min !== undefined && n < c.min) return false;
      if (c.max !== undefined && n > c.max) return false;
      return true;
    }

    case 'playerBeaten':
      return q.isBeaten(c.player);

    case 'objectiveComplete':
      return state.objectives.get(c.id) === 'complete';

    case 'objectiveFailed':
      return state.objectives.get(c.id) === 'failed';

    case 'all': {
      const list = c.of;
      for (let i = 0; i < list.length; i++) {
        if (!holds(list[i], op, state, q, tick, armTick, armFree)) return false;
      }
      return true;
    }

    case 'any': {
      const list = c.of;
      for (let i = 0; i < list.length; i++) {
        if (holds(list[i], op, state, q, tick, armTick, armFree)) return true;
      }
      return false;
    }

    case 'not':
      // NOTE THE ARMING PASS INVERTS TOO, which is correct and worth stating:
      // `not(elapsedSinceArmed)` reads false while arm-free, so a trigger whose
      // whole tree is that negation never arms — and never fires. That is a
      // nonsense trigger and `validateCampaign` refuses `elapsedSinceArmed`
      // under a `not` rather than letting it evaluate to something defensible.
      return !holds(c.of, op, state, q, tick, armTick, armFree);

    default:
      return false;
  }
}

/** True when this tree contains an `elapsedSinceArmed` anywhere. */
export function usesArmTimer(c: Condition): boolean {
  switch (c.on) {
    case 'elapsedSinceArmed':
      return true;
    case 'all':
    case 'any': {
      const list = c.of;
      for (let i = 0; i < list.length; i++) if (usesArmTimer(list[i])) return true;
      return false;
    }
    case 'not':
      return usesArmTimer(c.of);
    default:
      return false;
  }
}

/* ==========================================================================
 * 2. THE TICK
 * ========================================================================== */

/**
 * Evaluate every trigger once and append the effects that should fire.
 *
 * `out` is caller-supplied and appended to — it is NOT cleared here, so a
 * caller batching two sources gets both. Returns how many effects were added,
 * so a caller can tell "nothing fired" from "the array was already full".
 *
 * ORDER IS THE FILE'S ORDER, and it is load-bearing rather than incidental: an
 * operation whose triggers both end the match on the same tick resolves to
 * whichever is written first, so the author can put the loss condition above
 * the win and mean it. `validateCampaign` does not reorder.
 */
export function runDirector(
  op: OperationDef,
  state: OperationState,
  q: WorldQuery,
  tick: number,
  out: Effect[],
): number {
  // An operation that has already ended evaluates nothing. Without this a
  // repeat trigger goes on spawning waves into a world the shell is tearing
  // down, and the last one to fire decides what the end screen says.
  if (state.outcome !== null) return 0;

  const before = out.length;
  const triggers = op.triggers;

  for (let i = 0; i < triggers.length; i++) {
    const t: TriggerDef = triggers[i];
    if (state.fired.has(t.id)) continue;

    const armed = state.armedAt.get(t.id);
    const armTick = armed === undefined ? -1 : armed;

    // Pass 1 — arming.
    const arming = holds(t.when, op, state, q, tick, armTick, true);
    if (!arming) {
      // DISARM. Deleting rather than setting -1 keeps the save chunk to the
      // triggers that are actually armed, and keeps `has()` meaningful.
      if (armed !== undefined) state.armedAt.delete(t.id);
      continue;
    }
    if (armed === undefined) state.armedAt.set(t.id, tick);

    // Pass 2 — the real one, against the arm tick just settled.
    const now = state.armedAt.get(t.id) ?? tick;
    if (!holds(t.when, op, state, q, tick, now, false)) continue;

    const effects = t.then;
    for (let e = 0; e < effects.length; e++) out.push(effects[e]);
    if (t.repeat !== true) state.fired.add(t.id);
  }

  return out.length - before;
}

/* ==========================================================================
 * 3. STATE
 * ========================================================================== */

/** A fresh state for one operation. `startTick` is stamped by the runtime. */
export function newOperationState(op: OperationDef, startTick: number): OperationState {
  const objectives = new Map<string, 'hidden' | 'active' | 'complete' | 'failed'>();
  for (const o of op.objectives) objectives.set(o.id, o.hidden === true ? 'hidden' : 'active');
  return {
    operationId: op.id,
    startTick,
    armedAt: new Map<string, number>(),
    fired: new Set<string>(),
    objectives,
    paid: new Set<string>(),
    outcome: null,
    reason: '',
  };
}

/**
 * The medal an outcome earned.
 *
 * DERIVED, NEVER STORED AS PAYABLE. Bronze is winning; silver adds every
 * secondary; gold is silver at Hard or above. The profile stores the BEST per
 * operation and compares with `>`, so replaying on Easy cannot take a gold
 * away — a reward that can be lost by playing more is a reward nobody trusts.
 */
export function medalFor(
  op: OperationDef,
  state: OperationState,
  difficulty: number,
  hardOrAbove = 2,
): 0 | 1 | 2 | 3 {
  if (state.outcome !== 'won') return 0;
  for (const o of op.objectives) {
    if (o.kind !== 'secondary') continue;
    if (state.objectives.get(o.id) !== 'complete') return 1;
  }
  return difficulty >= hardOrAbove ? 3 : 2;
}

/**
 * Idle self-repair for mobile units.
 *
 * Requested: "add some healing over time to troops and vehicles when idle."
 *
 * The rules that matter are the ones that stop it becoming degenerate — you
 * must actually stop, you must be out of combat, structures are not included —
 * so those are what is pinned here.
 *
 * WHAT CHANGED, AND WHY THE "NEVER REACHES FULL" TEST IS GONE
 * -----------------------------------------------------------
 * The player listed idle healing among the things they could not see in the
 * shipped build. Two faults, and this file only covers one of them:
 *
 *   - the HUD never drew it (fixed in `src/ui/Overlay.ts` — the damage bar
 *     expires at 4 s and healing does not start until 8 s, so the bar was
 *     guaranteed to be gone for the whole of the recovery);
 *   - `REGEN_CEILING` was 0.75, so a unit that came out of a fight at 80% —
 *     the state most units are in most of the time — healed NOTHING. The
 *     stated reason was to protect a Service Depot that does not exist in this
 *     game. It is 1.0 now, and what keeps recovery expensive is the ENTRY
 *     condition (break off, stop, wait 8 s), not a cap on the result.
 *
 * So this file no longer asserts "never reaches full". It asserts the opposite,
 * and — more usefully — it pins the case that used to be a silent no-op: a
 * lightly damaged unit must actually heal.
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Rng } from '../src/core/math';
import { EntityFlag, EntityKind, Faction, UnitState } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { SIM_DT } from '../src/core/config';

import {
  REGEN_CEILING, REGEN_FRACTION_PER_SEC, REGEN_OUT_OF_COMBAT_SEC, isRegenerating, regenTick,
} from '../src/sim/Regen';

const P0 = 0 as PlayerId;

function makeWorld(): World {
  const w = new World();
  w.addPlayer(Faction.Allies, 'A', true, true);
  w.addPlayer(Faction.Soviets, 'B', false, false);
  return w;
}

function spawn(
  w: World, kind: EntityKind, hpFrac: number, state: UnitState = UnitState.Idle,
): EntityId {
  const st = w.store;
  const h = st.alloc(kind, -1, P0, Faction.Allies, 0, 0, 0, 0);
  const i = st.index(h);
  st.maxHp[i] = 1000;
  st.hp[i] = 1000 * hpFrac;
  st.state[i] = state;
  st.lastHitTime[i] = -1e9; // long out of combat
  return h;
}

/** A context far enough into the match that the out-of-combat test passes. */
function context(time: number, dt = 1): SimContext {
  return { dt, tick: Math.round(time / SIM_DT), time, rng: new Rng(1) };
}

const hp = (w: World, h: EntityId): number => w.store.hp[w.store.index(h)];

describe('idle self-repair', () => {
  it('heals an idle vehicle that is out of combat', () => {
    const w = makeWorld();
    const tank = spawn(w, EntityKind.Vehicle, 0.2);
    const before = hp(w, tank);

    expect(regenTick(w, context(100), 1)).toBe(1);
    expect(hp(w, tank)).toBeCloseTo(before + 1000 * REGEN_FRACTION_PER_SEC, 5);
  });

  it('heals infantry too — "troops and vehicles"', () => {
    const w = makeWorld();
    const squad = spawn(w, EntityKind.Infantry, 0.2);
    expect(regenTick(w, context(100), 1)).toBe(1);
    expect(hp(w, squad)).toBeGreaterThan(200);
  });

  it('does NOT heal a unit that was hit recently', () => {
    // You have to disengage. Healing under fire, or seconds after it, makes
    // hit-and-run strictly dominant.
    const w = makeWorld();
    const tank = spawn(w, EntityKind.Vehicle, 0.2);
    const i = w.store.index(tank);
    const now = 100;
    w.store.lastHitTime[i] = now - (REGEN_OUT_OF_COMBAT_SEC - 1);

    expect(regenTick(w, context(now), 1)).toBe(0);
    expect(hp(w, tank)).toBe(200);
  });

  it('starts healing once the out-of-combat dwell has elapsed', () => {
    const w = makeWorld();
    const tank = spawn(w, EntityKind.Vehicle, 0.2);
    const i = w.store.index(tank);
    const now = 100;
    w.store.lastHitTime[i] = now - (REGEN_OUT_OF_COMBAT_SEC + 0.1);

    expect(regenTick(w, context(now), 1)).toBe(1);
  });

  it('does NOT heal a unit that is moving or attacking', () => {
    const w = makeWorld();
    const moving = spawn(w, EntityKind.Vehicle, 0.2, UnitState.Moving);
    const fighting = spawn(w, EntityKind.Vehicle, 0.2, UnitState.Attacking);
    const hauling = spawn(w, EntityKind.Vehicle, 0.2, UnitState.SeekOre);

    expect(regenTick(w, context(100), 1)).toBe(0);
    expect(hp(w, moving)).toBe(200);
    expect(hp(w, fighting)).toBe(200);
    expect(hp(w, hauling)).toBe(200);
  });

  it('heals a unit holding position on guard', () => {
    const w = makeWorld();
    const guard = spawn(w, EntityKind.Vehicle, 0.2, UnitState.Guarding);
    expect(regenTick(w, context(100), 1)).toBe(1);
    expect(hp(w, guard)).toBeGreaterThan(200);
  });

  it('does NOT heal structures — RepairSell owns those', () => {
    const w = makeWorld();
    const hq = spawn(w, EntityKind.Building, 0.2);
    expect(regenTick(w, context(100), 1)).toBe(0);
    expect(hp(w, hq)).toBe(200);
  });

  it('recovers all the way to the ceiling and then stops', () => {
    const w = makeWorld();
    const tank = spawn(w, EntityKind.Vehicle, 0.2);
    for (let k = 0; k < 500; k++) regenTick(w, context(100), 1);
    expect(hp(w, tank)).toBeCloseTo(1000 * REGEN_CEILING, 5);
    // Idempotent at the ceiling: no overshoot, and no work reported.
    expect(regenTick(w, context(100), 1)).toBe(0);
  });

  it('never overshoots the ceiling on a long dt', () => {
    // The system runs one pass worth `REGEN_TICK_INTERVAL` ticks of dt, so the
    // step CAN be larger than the remaining deficit.
    const w = makeWorld();
    const tank = spawn(w, EntityKind.Vehicle, 0.99);
    regenTick(w, context(100), 60);
    expect(hp(w, tank)).toBe(1000 * REGEN_CEILING);
  });

  /* THE NO-OP THAT MADE THE FEATURE INVISIBLE.
   *
   * At the old 0.75 ceiling this returned 0 and the tank stayed at 800 for the
   * rest of the match. "Lightly damaged after a skirmish" is the commonest
   * state a unit is in, so the commonest thing the player could observe was
   * nothing happening at all. */
  it('heals a LIGHTLY damaged unit — the case the old 0.75 ceiling refused', () => {
    const w = makeWorld();
    const tank = spawn(w, EntityKind.Vehicle, 0.8);
    expect(regenTick(w, context(100), 1)).toBe(1);
    expect(hp(w, tank)).toBeGreaterThan(800);
    // And it gets all the way back, rather than to some fraction of the way.
    for (let k = 0; k < 500; k++) regenTick(w, context(100), 1);
    expect(hp(w, tank)).toBe(1000);
  });

  it('is fast enough to be watchable: a light scratch closes in seconds', () => {
    // The rate is the other half of "I cannot see it". At the old 0.015 a
    // half-second slice moved a 34-design-px bar by a quarter of a pixel.
    const w = makeWorld();
    const tank = spawn(w, EntityKind.Vehicle, 0.9);
    for (let k = 0; k < 5; k++) regenTick(w, context(100), 1);
    expect(hp(w, tank)).toBe(1000);
    expect(REGEN_FRACTION_PER_SEC).toBeGreaterThanOrEqual(0.02);
  });

  it('does not heal the dying, the unbuilt, or the garrisoned', () => {
    const w = makeWorld();
    const st = w.store;
    const dying = spawn(w, EntityKind.Vehicle, 0.2);
    const unbuilt = spawn(w, EntityKind.Vehicle, 0.2);
    const inside = spawn(w, EntityKind.Infantry, 0.2);
    st.flags[st.index(dying)] |= EntityFlag.PendingDestroy;
    st.flags[st.index(unbuilt)] |= EntityFlag.UnderConstruction;
    st.flags[st.index(inside)] |= EntityFlag.Garrisoned;

    expect(regenTick(w, context(100), 1)).toBe(0);
  });

  it('heals every player, not just the local one', () => {
    // A regeneration rule only the human gets is a cheat, and would silently
    // invalidate every balance measurement taken since.
    const w = makeWorld();
    const st = w.store;
    const mine = spawn(w, EntityKind.Vehicle, 0.2);
    const theirs = st.alloc(EntityKind.Vehicle, -1, 1 as PlayerId, Faction.Soviets, 20, 0, 0, 0);
    const j = st.index(theirs);
    st.maxHp[j] = 1000; st.hp[j] = 200;
    st.state[j] = UnitState.Idle;
    st.lastHitTime[j] = -1e9;

    expect(regenTick(w, context(100), 1)).toBe(2);
    expect(hp(w, mine)).toBeGreaterThan(200);
    expect(st.hp[j]).toBeGreaterThan(200);
  });

  /* ------------------------------------------------------------------------
   * THE PREDICATE THE HUD DRAWS FROM
   *
   * `src/ui/Overlay.ts` puts a health bar and a green cross over a unit that is
   * self-repairing, and `src/ui/Hud.ts` puts REPAIRING on the selection card.
   * Both ask `isRegenerating`, and so does `regenTick`. If they were two
   * predicates the interface could say "healing" while the sim did nothing —
   * which is a worse bug than the invisible healing it replaced, because it is
   * a lie rather than a silence.
   *
   * So what is pinned is the EQUIVALENCE, not the two behaviours separately.
   * ---------------------------------------------------------------------- */
  it('the exported predicate agrees with what regenTick actually heals', () => {
    const w = makeWorld();
    const st = w.store;
    const now = 100;

    // One of every interesting shape, in one world.
    const cases: Array<[string, EntityId]> = [
      ['idle vehicle, hurt', spawn(w, EntityKind.Vehicle, 0.3)],
      ['idle infantry, hurt', spawn(w, EntityKind.Infantry, 0.3)],
      ['guarding, hurt', spawn(w, EntityKind.Vehicle, 0.3, UnitState.Guarding)],
      ['moving, hurt', spawn(w, EntityKind.Vehicle, 0.3, UnitState.Moving)],
      ['attacking, hurt', spawn(w, EntityKind.Vehicle, 0.3, UnitState.Attacking)],
      ['idle, already full', spawn(w, EntityKind.Vehicle, 1.0)],
      ['idle, barely scratched', spawn(w, EntityKind.Vehicle, 0.98)],
      ['structure, hurt', spawn(w, EntityKind.Building, 0.3)],
    ];
    const recent = spawn(w, EntityKind.Vehicle, 0.3);
    st.lastHitTime[st.index(recent)] = now - 1;
    cases.push(['idle but just shot', recent]);
    const dying = spawn(w, EntityKind.Vehicle, 0.3);
    st.flags[st.index(dying)] |= EntityFlag.PendingDestroy;
    cases.push(['dying', dying]);

    const before = cases.map(([, h]) => hp(w, h));
    const predicted = cases.map(([, h]) => isRegenerating(st, st.index(h), now));
    const healedCount = regenTick(w, context(now), 1);
    const actuallyHealed = cases.map(([, h], k) => hp(w, h) > before[k]);

    for (let k = 0; k < cases.length; k++) {
      expect(actuallyHealed[k], `${cases[k][0]}: predicate said ${predicted[k]}`)
        .toBe(predicted[k]);
    }
    expect(healedCount).toBe(predicted.filter(Boolean).length);
    // And the scan is not vacuous in either direction.
    expect(predicted.filter(Boolean).length).toBeGreaterThan(0);
    expect(predicted.filter((p) => !p).length).toBeGreaterThan(0);
  });

  it('scales with dt, so the slice interval cannot change balance', () => {
    // The system runs one pass every N ticks worth N ticks of dt. Rate must be
    // identical either way, or retuning cost would silently retune the game.
    const a = makeWorld();
    const fast = spawn(a, EntityKind.Vehicle, 0.2);
    for (let k = 0; k < 15; k++) regenTick(a, context(100), SIM_DT);

    const b = makeWorld();
    const sliced = spawn(b, EntityKind.Vehicle, 0.2);
    regenTick(b, context(100), SIM_DT * 15);

    // RELATIVE, not absolute. `store.hp` is a Float32Array, so fifteen small
    // adds and one large add cannot land on the same bit pattern — at 212 hp
    // they differ by 8e-5, which is one ulp of a float32 and not a difference
    // in rate. An absolute `toBeCloseTo(_, 4)` passed only because the old
    // 1.5%/s happened to round well, and would fail again on the next retune.
    const rel = Math.abs(hp(a, fast) - hp(b, sliced)) / hp(b, sliced);
    expect(rel).toBeLessThan(1e-5);
  });
});

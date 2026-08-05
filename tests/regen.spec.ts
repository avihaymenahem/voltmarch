/**
 * Idle self-repair for mobile units.
 *
 * Requested: "add some healing over time to troops and vehicles when idle."
 *
 * The rules that matter are the ones that stop it becoming degenerate — you
 * must actually stop, you must be out of combat, structures are not included,
 * and it never reaches full — so those are what is pinned here.
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Rng } from '../src/core/math';
import { EntityFlag, EntityKind, Faction, UnitState } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { SIM_DT } from '../src/core/config';

import {
  REGEN_CEILING, REGEN_FRACTION_PER_SEC, REGEN_OUT_OF_COMBAT_SEC, regenTick,
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

  it('stops at the ceiling and never reaches full', () => {
    // The last quarter is what the depot and the Heal crate exist to sell.
    const w = makeWorld();
    const tank = spawn(w, EntityKind.Vehicle, 0.2);
    for (let k = 0; k < 500; k++) regenTick(w, context(100), 1);
    expect(hp(w, tank)).toBeCloseTo(1000 * REGEN_CEILING, 5);
    expect(hp(w, tank)).toBeLessThan(1000);
  });

  it('leaves a unit healed past the ceiling alone rather than dragging it down', () => {
    const w = makeWorld();
    const tank = spawn(w, EntityKind.Vehicle, 0.95);
    expect(regenTick(w, context(100), 1)).toBe(0);
    expect(hp(w, tank)).toBe(950);
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

  it('scales with dt, so the slice interval cannot change balance', () => {
    // The system runs one pass every N ticks worth N ticks of dt. Rate must be
    // identical either way, or retuning cost would silently retune the game.
    const a = makeWorld();
    const fast = spawn(a, EntityKind.Vehicle, 0.2);
    for (let k = 0; k < 15; k++) regenTick(a, context(100), SIM_DT);

    const b = makeWorld();
    const sliced = spawn(b, EntityKind.Vehicle, 0.2);
    regenTick(b, context(100), SIM_DT * 15);

    expect(hp(a, fast)).toBeCloseTo(hp(b, sliced), 4);
  });
});

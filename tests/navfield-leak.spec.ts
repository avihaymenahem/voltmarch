/**
 * THE FLOW FIELD POOL IS 24 SLOTS, AND EVERY REF MUST COME BACK.
 *
 * Reported as: "Trying to command my army to move to a certain point after a
 * long game, and nothing, they just not respond" — with a screenshot of a
 * selected army standing still, order marker on the ground.
 *
 * `FlowFieldCache` has `FLOWFIELD_CACHE_SIZE` slots and a slot is reusable only
 * at `refs` zero: the victim scan opens with `if (f.refs > 0) continue` and
 * gives up with `return -1  // every field pinned`. `refs` is decremented in
 * exactly one function, `release`, and every caller of it lives inside
 * `NavAssigner` behind an `isMover` test that refuses `PendingDestroy` and
 * `Garrisoned`. So THREE ordinary events took a ref to the grave:
 *
 *   - a unit dying in transit (any combat death under a move order),
 *   - a unit garrisoning a building,
 *   - a unit boarding a transport.
 *
 * The generation bump in `flushDestroyed` then erased `navField`, so the ref
 * became unreachable for the rest of the match. Nothing inside a match ever
 * gave one back; only `reset()` between matches did. A countdown from 24 that
 * only ticks down — which is exactly the "after a long game" shape.
 *
 * WHAT THE PLAYER SEES AT ZERO. `requestFieldClass` returns -1,
 * `NavAssigner`'s no-field branch calls `finishOrder`, which sets `Arrived`,
 * zeroes velocity and puts `Moving` back to `Idle`. The order is issued and
 * cancelled inside one tick, in silence. An IDLE selection is the worst case,
 * because idle units hold no field of their own, so the whole group parks at
 * once — which is the screenshot.
 *
 * THE FIX IS IN TWO PLACES AND BOTH ARE NEEDED. `NavAssigner` releases when a
 * unit stops being a mover (garrison, boarding, an early-marked death), and
 * `Damage.cleanupTick` releases through `flushDestroyed`'s `onFree` hook — a
 * unit killed at Phase.Damage is flushed at Phase.Cleanup in the same tick,
 * after the assigner already ran at Phase.PathRequest, so the assigner can
 * never see an ordinary combat death.
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { EntityFlag, EntityKind, Faction, Locomotor, UnitState } from '../src/core/types';
import type { PlayerId, SimContext } from '../src/core/types';
import { FLOWFIELD_CACHE_SIZE, SIM_DT } from '../src/core/config';
import { Rng } from '../src/core/math';
import { FlowFieldCache, MoveClass, setActiveNav } from '../src/sim/Flowfield';
import { NavAgents, NavAssigner, SteeringSolver } from '../src/sim/Steering';
import { MovementIntegrator } from '../src/sim/Movement';
import { DamageSystem } from '../src/sim/Damage';

const P0 = 0 as PlayerId;

interface Rig {
  world: World;
  channels: Channels;
  nav: FlowFieldCache;
  assigner: NavAssigner;
  steering: SteeringSolver;
  movement: MovementIntegrator;
  damage: DamageSystem;
  tick: number;
  step(n?: number): void;
  /** Kill a unit through the REAL death path, hook and all. */
  kill(i: number): void;
}

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  const channels = new Channels();
  const nav = new FlowFieldCache(world.terrain);
  const agents = new NavAgents();
  setActiveNav(nav);
  const rig: Rig = {
    world,
    channels,
    nav,
    assigner: new NavAssigner(world, nav, agents),
    steering: new SteeringSolver(world, nav, agents),
    movement: new MovementIntegrator(world, nav, channels),
    damage: new DamageSystem(world, channels),
    tick: 0,
    step(n = 1): void {
      const rng = new Rng(1234);
      for (let k = 0; k < n; k++) {
        rig.tick++;
        const ctx: SimContext = { dt: SIM_DT, tick: rig.tick, time: rig.tick * SIM_DT, rng };
        world.store.snapshotPrev();
        rig.assigner.simTick(ctx);      // Phase.PathRequest 500
        rig.steering.simTick(ctx);
        rig.movement.simTick(ctx);
        rig.damage.cleanupTick(ctx);    // Phase.Cleanup 1400 — flushDestroyed
        world.spatial.rebuild();
      }
    },
    /* THE REAL DEATH PATH, and using it is the whole point.
     *
     * An earlier draft called `st.flushDestroyed(...)` with its own release
     * callback inline, which made the test pass whether or not `Damage.ts` was
     * wired up at all — it pinned the cache's arithmetic and nothing about the
     * product. `markDead` here and `damage.cleanupTick` in `step` is the same
     * order the phase table runs them in: the kill lands at Phase.Damage, the
     * flush at Phase.Cleanup, both AFTER the assigner has had its pass. That
     * ordering is exactly why the assigner's own guard cannot catch a combat
     * death and why the `onFree` hook has to exist. */
    kill(i: number): void {
      world.store.markDead(world.store.handleOf(i));
    },
  };
  return rig;
}

function spawnTank(rig: Rig, x: number, z: number): number {
  const st = rig.world.store;
  const id = st.alloc(EntityKind.Vehicle, 0, P0, Faction.Allies, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= EntityFlag.CanMove;
  st.maxSpeed[i] = 6;
  st.accel[i] = 8;
  st.turnRate[i] = 2.2;
  st.radius[i] = 1.7;
  st.locomotor[i] = Locomotor.Track;
  st.hp[i] = 100; st.maxHp[i] = 100;
  return i;
}

function orderTo(rig: Rig, i: number, x: number, z: number): void {
  const st = rig.world.store;
  st.orderX[i] = x;
  st.orderZ[i] = z;
  st.state[i] = UnitState.Moving;
}

/**
 * A goal far enough from every other goal used here that it lands in its OWN
 * field. Goals quantise into buckets, so two nearby goals share one field and
 * one ref — which would hide the leak rather than exercise it.
 */
function goalFor(n: number): { x: number; z: number } {
  return { x: 120 + (n % 8) * 40, z: 120 + Math.floor(n / 8) * 40 };
}

describe('the flow field pool never leaks a ref', () => {
  it('survives far more in-transit deaths than it has slots', () => {
    const rig = makeRig();
    const st = rig.world.store;

    // Three times the pool, each on its own goal bucket. Before the fix this
    // pinned every slot inside the first ~24 and never recovered.
    const rounds = FLOWFIELD_CACHE_SIZE * 3;
    for (let n = 0; n < rounds; n++) {
      const g = goalFor(n);
      const i = spawnTank(rig, 60, 60);
      orderTo(rig, i, g.x, g.z);
      rig.step(3);                       // acquire a field and start driving
      expect(st.navField[i], `round ${n}: never got a field`).toBeGreaterThanOrEqual(0);

      // Killed in transit — the case that leaked. `markDead` only flags; the
      // slot is freed by `flushDestroyed`, which is where the release hook is.
      rig.kill(i);
      rig.step(1);      // Damage.cleanupTick flushes and releases
    }

    // One more step: `refreshStats` runs inside `nav.update()` at the TOP of
    // the assigner tick, so the aggregate lags the last release by one step.
    rig.step(1);
    expect(rig.nav.stats.refs, 'every ref should have come back').toBe(0);
  });

  it('still answers a move order after those deaths', () => {
    const rig = makeRig();
    const st = rig.world.store;

    for (let n = 0; n < FLOWFIELD_CACHE_SIZE * 3; n++) {
      const g = goalFor(n);
      const i = spawnTank(rig, 60, 60);
      orderTo(rig, i, g.x, g.z);
      rig.step(3);
      rig.kill(i);
      rig.step(1);      // Damage.cleanupTick flushes and releases
    }

    /* THE PLAYER-FACING ASSERTION. A fresh unit, a fresh goal, one order.
     * Before the fix this unit got `navField = -1`, `finishOrder` put it
     * straight back to `Idle`, and it never moved a metre — the whole report,
     * reproduced in eight lines. */
    const survivor = spawnTank(rig, 60, 60);
    orderTo(rig, survivor, 300, 300);
    rig.step(30);

    expect(st.navField[survivor], 'the pool is pinned shut').toBeGreaterThanOrEqual(0);
    expect(st.state[survivor], 'the order was cancelled on the tick it was issued')
      .toBe(UnitState.Moving);
    expect(Math.hypot(st.posX[survivor] - 60, st.posZ[survivor] - 60),
      'it never moved').toBeGreaterThan(1);
  });

  it('gives the field back when a unit is garrisoned or boards a transport', () => {
    const rig = makeRig();
    const st = rig.world.store;

    // No death involved — `isMover` refuses `Garrisoned` just as it refuses
    // `PendingDestroy`, so this is a second door into the same pool. A
    // harvester or a tank riding a transport takes it every time it loads.
    for (let n = 0; n < FLOWFIELD_CACHE_SIZE * 2; n++) {
      const g = goalFor(n);
      const i = spawnTank(rig, 60, 60);
      orderTo(rig, i, g.x, g.z);
      rig.step(3);
      expect(st.navField[i], `round ${n}: never got a field`).toBeGreaterThanOrEqual(0);

      // Exactly what `Transport.board` and `Garrison.embark` do to a passenger.
      st.flags[i] |= EntityFlag.Garrisoned | EntityFlag.Immobilized;
      st.state[i] = UnitState.Idle;
      rig.step(1);

      expect(st.navField[i], `round ${n}: boarding leaked a field`).toBe(-1);
    }

    // `stats.refs` is recomputed by `refreshStats` inside `nav.update()`, which
    // runs at the TOP of the assigner tick — so it reports the count from
    // BEFORE the release that same tick, and is one step stale. Step once more
    // so the aggregate has seen the final release. The per-round `navField`
    // assertion above is the un-lagged check.
    rig.step(1);
    expect(rig.nav.stats.refs, 'boarding leaked refs').toBe(0);
  });

  it('reports a real free slot count, so exhaustion is observable', () => {
    // The diagnostic the next person needs: `stats.refs` is what says whether
    // the pool is healthy, and it is what a live `__vmNav.stats()` shows.
    const rig = makeRig();
    expect(rig.nav.stats.refs).toBe(0);

    const i = spawnTank(rig, 60, 60);
    orderTo(rig, i, 300, 300);
    rig.step(3);
    expect(rig.nav.stats.refs, 'a driving unit holds exactly one ref').toBe(1);
  });
});

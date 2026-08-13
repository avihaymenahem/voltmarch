/**
 * A HARVESTER OBEYS THE PLAYER — see `takeNewOrder` in `src/sim/Harvesting.ts`
 * and the guards at the top of `write` in `src/input/Commands.ts`.
 *
 * Reported, and it was six defects rather than one: "Ore harvester just keep
 * ignoring my commands!!". Every one of them is the same shape — an order the
 * game ACKNOWLEDGES (cursor, order marker, EVA) and then drops on the floor, or
 * a state the harvester enters and nothing in the game can get it out of again.
 *
 *   1. Attack. `write` set `UnitState.Attacking` with no `CanAttack` guard, the
 *      mirror of the guard that already existed for the Harvest case. Ctrl+A and
 *      one right-click on an enemy sent every miner into the enemy base, where
 *      `Targeting` skips unarmed units, `Steering.finishOrder` demotes only
 *      Moving/Fleeing/AttackMoving, and the FSM's default branch re-plans only
 *      under `OrderKind.Harvest`. The state was terminal.
 *   2. Guard. Same dead end without the driving.
 *   3. Stop. Did nothing at all — `UnitState.Idle` means "player parked me" for
 *      every other unit and "I have no work" to this FSM, so `decide()` put the
 *      hull straight back on the ore inside a second.
 *   4. "Go unload" (right-click your own refinery). Resolved to Harvest + a
 *      target, and `orderTarget` was read by NOBODY on that path.
 *   5. A redirect with a full hopper abandoned the delivery, crossed the map,
 *      and turned round without scooping because there was no space.
 *   6. A redirect the leash could not satisfy livelocked: `beginReturn`
 *      publishes no destination, so the order edge re-fired every tick forever
 *      and `anchorOnField` reset the patience clock each time.
 *
 * The rig is `tests/harvester-leash.spec.ts`'s — flat null terrain, no nav,
 * because these are DECISIONS rather than locomotion — with the real
 * `OrderExecutor` in front of it, because three of the six live there and a
 * hand-rolled `write` would have pinned the bug rather than the fix.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import {
  EntityFlag, EntityKind, Faction, Locomotor, OrderKind, Stance, UnitState,
} from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { CELL, SIM_DT, SIM_HZ } from '../src/core/config';
import { Rng } from '../src/core/math';

import { Economy, OreField } from '../src/sim/Economy';
import { HarvesterController, setHarvesterDrive } from '../src/sim/Harvesting';
import { RepairSellService } from '../src/sim/RepairSell';
import { OrderExecutor, issueOrder } from '../src/input/Commands';

const HUMAN = 0 as PlayerId;
const FOE = 1 as PlayerId;

/** Two patches, far enough apart that neither is inside the other's leash. */
const HOME_X = 160;
const FAR_X = 360;
const PATCH_Z = 256;
/** The home refinery, and a second one the player can name by clicking it. */
const REF_X = 120;
const REF2_X = 210;

interface Rig {
  world: World;
  channels: Channels;
  ore: OreField;
  harvesters: HarvesterController;
  orders: OrderExecutor;
  tick: number;
  step(n?: number): void;
}

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  world.addPlayer(Faction.Soviets, 'B', false, false);
  const channels = new Channels();
  const ore = new OreField();
  const economy = new Economy(world, channels);
  const harvesters = new HarvesterController(world, channels, ore, economy);
  const orders = new OrderExecutor(world, channels);
  world.ore = ore;
  setHarvesterDrive('full');

  const rng = new Rng(1234);
  const rig: Rig = {
    world, channels, ore, harvesters, orders,
    tick: 0,
    step(n = 1): void {
      for (let k = 0; k < n; k++) {
        world.store.snapshotPrev();
        rig.tick++;
        world.tick = rig.tick;
        world.time = rig.tick * SIM_DT;
        const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: world.time, rng };
        // Phase.Command before Phase.Economy, exactly as core/loop.ts orders
        // them — the executor at order 9000 and the FSM at Economy 0, so an
        // order and the FSM's reaction to it land on the SAME tick.
        orders.tick();
        harvesters.simTick(s);
        economy.tick(s.dt, s.time);
        harvesters.drive(s.dt);
      }
    },
  };
  return rig;
}

/** Find the index of the first live refinery, whichever one that is. */
function anyRefinery(rig: Rig): number {
  const st = rig.world.store;
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if ((st.flags[i] & EntityFlag.IsRefinery) !== 0) return i;
  }
  return -1;
}

function spawnRefinery(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Building, -1, owner, rig.world.player(owner).faction, x, 0, z, 0);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.IsRefinery;
  s.footprintW[i] = 3;
  s.footprintH[i] = 3;
  s.maxHp[i] = 1200;
  s.hp[i] = 1200;
  s.radius[i] = 6;
  s.buildProgress[i] = 1;
  return id;
}

function spawnHarvester(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Vehicle, -1, owner, rig.world.player(owner).faction, x, 0, z, 0);
  const i = s.index(id);
  // NO `CanAttack`, which is the real roster: every faction's harvester is
  // `weapons: UNARMED`. That absence is what made Attacking terminal.
  s.flags[i] |= EntityFlag.IsHarvester | EntityFlag.CanMove;
  s.cargoMax[i] = 300;
  s.cargo[i] = 0;
  s.maxSpeed[i] = 8;
  s.accel[i] = 8;
  s.turnRate[i] = 4;
  s.locomotor[i] = Locomotor.Track;
  s.radius[i] = 2.2;
  s.maxHp[i] = 1000;
  s.hp[i] = 1000;
  s.state[i] = UnitState.Idle;
  return id;
}

function spawnTank(rig: Rig, owner: PlayerId, x: number, z: number): EntityId {
  const s = rig.world.store;
  const id = s.alloc(EntityKind.Vehicle, -1, owner, rig.world.player(owner).faction, x, 0, z, 0);
  const i = s.index(id);
  s.flags[i] |= EntityFlag.CanMove | EntityFlag.CanAttack;
  s.maxSpeed[i] = 8;
  s.maxHp[i] = 400;
  s.hp[i] = 400;
  s.radius[i] = 2;
  s.state[i] = UnitState.Idle;
  return id;
}

/** Issue one order through the real bus, for a whole group. */
function order(
  rig: Rig, kind: OrderKind, ids: EntityId[], x: number, z: number, target: EntityId = 0 as EntityId,
): void {
  issueOrder(
    rig.world, rig.channels, HUMAN, kind,
    Int32Array.from(ids as unknown as number[]), ids.length, x, z, target,
  );
}

describe('a harvester obeys the player', () => {
  let rig: Rig;
  let h: EntityId;
  let hi: number;

  beforeEach(() => {
    rig = makeRig();
    rig.ore.seedField(HOME_X, PATCH_Z, 24, 900);
    rig.ore.seedField(FAR_X, PATCH_Z, 24, 900);
    spawnRefinery(rig, HUMAN, REF_X, PATCH_Z);
    h = spawnHarvester(rig, HUMAN, HOME_X, PATCH_Z - 20);
    hi = rig.world.store.index(h);
    rig.step(SIM_HZ);          // let it find work of its own accord
  });

  /* -- 1. combat orders ---------------------------------------------------- */

  it('keeps mining when a mixed selection is ordered to attack', () => {
    const st = rig.world.store;
    const tank = spawnTank(rig, HUMAN, HOME_X + 10, PATCH_Z);
    const enemy = spawnTank(rig, FOE, 460, 60);
    expect(st.state[hi]).not.toBe(UnitState.Idle);

    // The drag box caught the miner along with the escort. One command, both.
    order(rig, OrderKind.Attack, [tank, h], 460, 60, enemy);
    rig.step(4);

    expect(st.state[hi], 'a harvester must never enter Attacking').not.toBe(UnitState.Attacking);
    expect(st.orderKind[hi]).toBe(OrderKind.Harvest);
    expect(st.state[rig.world.store.index(tank)]).toBe(UnitState.Attacking);
  });

  it('still mines a minute after being ordered to attack', () => {
    const st = rig.world.store;
    const enemy = spawnTank(rig, FOE, 460, 60);
    order(rig, OrderKind.Attack, [h], 460, 60, enemy);
    rig.step(60 * SIM_HZ);

    // The measurable claim: the economy kept running. Before the guard the hull
    // drove at the enemy and stayed there for the rest of the match.
    expect(rig.harvesters.stats().delivered).toBeGreaterThan(0);
    expect(Math.hypot(st.posX[hi] - 460, st.posZ[hi] - 60)).toBeGreaterThan(100);
  });

  it('keeps mining when ordered to guard', () => {
    const st = rig.world.store;
    order(rig, OrderKind.Guard, [h], st.posX[hi], st.posZ[hi]);
    rig.step(60 * SIM_HZ);

    expect(st.state[hi]).not.toBe(UnitState.Guarding);
    expect(rig.harvesters.stats().delivered).toBeGreaterThan(0);
  });

  /* -- 2. Stop actually stops ---------------------------------------------- */

  it('parks on Stop and stays parked', () => {
    const st = rig.world.store;
    order(rig, OrderKind.Stop, [h], 0, 0);
    rig.step(1);
    const x = st.posX[hi];
    const z = st.posZ[hi];

    rig.step(30 * SIM_HZ);
    expect(st.state[hi]).toBe(UnitState.Idle);
    expect(st.orderKind[hi]).toBe(OrderKind.Stop);
    expect(Math.hypot(st.posX[hi] - x, st.posZ[hi] - z)).toBeLessThan(0.5);
  });

  it('goes back to work on the next order after a Stop', () => {
    const st = rig.world.store;
    order(rig, OrderKind.Stop, [h], 0, 0);
    rig.step(SIM_HZ);
    expect(st.state[hi]).toBe(UnitState.Idle);

    order(rig, OrderKind.Harvest, [h], FAR_X, PATCH_Z);
    rig.step(4);
    expect(st.orderKind[hi]).toBe(OrderKind.Harvest);
    expect(st.state[hi]).toBe(UnitState.SeekOre);
  });

  it('sends a FRESH harvester to work — a new hull is not a parked one', () => {
    // `OrderKind.None` + `Idle` is how every unit arrives, and it is also what
    // `Transport.place`, `Garrison.recover` and Chronoshift leave behind. None
    // of them may read as a park; only the executor's `Stop` may.
    const fresh = spawnHarvester(rig, HUMAN, HOME_X + 6, PATCH_Z - 24);
    const fi = rig.world.store.index(fresh);
    expect(rig.world.store.orderKind[fi]).toBe(OrderKind.None);

    rig.step(2 * SIM_HZ);
    expect(rig.world.store.state[fi]).not.toBe(UnitState.Idle);
  });

  it('goes back to work after being put down by a transport', () => {
    const st = rig.world.store;
    order(rig, OrderKind.Stop, [h], 0, 0);
    rig.step(2);
    // `Transport.place`'s tail, verbatim: the pair that is NOT a park.
    st.orderKind[hi] = OrderKind.None;
    st.orderTarget[hi] = 0;
    st.state[hi] = UnitState.Idle;

    rig.step(2 * SIM_HZ);
    expect(st.state[hi]).not.toBe(UnitState.Idle);
  });

  /* -- 3. go unload -------------------------------------------------------- */

  it('hauls to the refinery when told to unload with a part-full hopper', () => {
    const st = rig.world.store;
    const ref = spawnRefinery(rig, HUMAN, REF2_X, PATCH_Z);
    st.cargo[hi] = 120;

    // Right-click your own refinery: Harvest, carrying the refinery as target.
    order(rig, OrderKind.Harvest, [h], st.posX[st.index(ref)], st.posZ[st.index(ref)], ref);
    rig.step(2);

    expect(st.state[hi]).toBe(UnitState.ReturnToRefinery);
    expect(st.dockTarget[hi], 'the refinery the player clicked, not the nearest')
      .toBe(ref as number);
  });

  it('banks the PARTIAL load rather than filling up first', () => {
    const st = rig.world.store;
    st.cargo[hi] = 120;
    const refIdx = anyRefinery(rig);

    order(rig, OrderKind.Harvest, [h], st.posX[refIdx], st.posZ[refIdx], st.handleOf(refIdx));
    for (let t = 0; t < 90 * SIM_HZ && rig.harvesters.stats().delivered === 0; t++) rig.step(1);

    /* THE SIZE OF THE FIRST DELIVERY IS THE DISCRIMINATOR, and "did it deliver
     * at all" is not: a harvester that ignores the order mines on, fills to 300
     * and delivers that within the same window, so the weaker assertion passes
     * either way and pins nothing. Obeyed, the first load banked is the 120 it
     * was already carrying. */
    expect(rig.harvesters.stats().delivered,
      'it should bank the 120 it was carrying, not mine on to 300 first')
      .toBeLessThan(200);
  });

  it('ignores an unload order with an empty hopper', () => {
    const st = rig.world.store;
    st.cargo[hi] = 0;
    const refIdx = st.index(spawnRefinery(rig, HUMAN, REF2_X, PATCH_Z));

    order(rig, OrderKind.Harvest, [h], st.posX[refIdx], st.posZ[refIdx], st.handleOf(refIdx));
    rig.step(4);

    // Walking an empty hopper to a refinery to do nothing would be obedient and
    // useless. It stays on the job.
    expect(st.state[hi]).not.toBe(UnitState.ReturnToRefinery);
  });

  it('does not eject a harvester that is already docked and unloading', () => {
    const st = rig.world.store;
    st.cargo[hi] = 300;
    for (let t = 0; t < 60 * SIM_HZ && st.state[hi] !== UnitState.Docked; t++) rig.step(1);
    expect(st.state[hi], 'precondition: it reached the dock').toBe(UnitState.Docked);

    const refIdx = anyRefinery(rig);
    order(rig, OrderKind.Harvest, [h], st.posX[refIdx], st.posZ[refIdx], st.handleOf(refIdx));

    /* EVERY TICK, not just the end state. The executor used to force SeekOre,
     * which threw the hull off the apron — and `tickReturn` puts it straight
     * back on the next tick because it is standing on the dock, so sampling
     * only the end state cannot see the ejection at all. */
    for (let t = 0; t < 4; t++) {
      rig.step(1);
      expect(st.state[hi], `tick ${t}: the hull must not leave the dock`).toBe(UnitState.Docked);
    }
  });

  /* -- 4. redirects -------------------------------------------------------- */

  it('delivers first when redirected with a full hopper, and obeys the click after', () => {
    const st = rig.world.store;
    st.cargo[hi] = 300;
    rig.step(2);

    order(rig, OrderKind.Harvest, [h], FAR_X, PATCH_Z);
    rig.step(2);

    // The click is obeyed — the anchor moved to the far patch — but the load in
    // the hopper is banked first rather than riding 200 m and back untouched.
    expect(st.state[hi]).toBe(UnitState.ReturnToRefinery);
    expect(Math.hypot(st.guardX[hi] - FAR_X, st.guardZ[hi] - PATCH_Z)).toBeLessThan(2 * CELL);

    /* AND IT ACTUALLY ARRIVES, which is the livelock guard.
     *
     * This branch is the one that publishes NO destination: `beginReturn`
     * chooses a dock and returns, and `takeNewOrder`'s own `return true` skips
     * the `tickReturn` that would have published it. Without `consumeOrder`
     * recording the point, the order edge — a diff of the order columns against
     * `destX/destZ` — is still standing on the next tick, so the whole path
     * re-runs forever and the hull never moves. `delivered` is the only
     * observable that separates "chose a dock" from "reached one". */
    for (let t = 0; t < 90 * SIM_HZ && rig.harvesters.stats().delivered === 0; t++) rig.step(1);
    expect(rig.harvesters.stats().delivered,
      'the redirect must be consumed once, or tickReturn never runs').toBeGreaterThan(0);
  });

  /* -- 5. the dock queue is a line, not a pile ----------------------------- */

  it('gives queued haulers separate dock slots', () => {
    /* Reported as "Ore harvesters: They keep clashing each other".
     *
     * `commitDockPoint` used to hand every non-lock-holding hauler the SAME
     * point — `reach + HARVESTER_QUEUE_GAP` — while the comment directly above
     * it described an indexed queue, and `queueRank` sat twenty lines below
     * computing exactly that index for a caller that threw it away. N hulls
     * converging on one coordinate settle ~7.7 m apart via `Movement.relax` and
     * shove each other the whole way in.
     *
     * The assertion is deliberately about SEPARATION rather than exact
     * coordinates: the stagger's sign and spacing are tuning, but "no two
     * waiters are sent to the same place" is the invariant. */
    const st = rig.world.store;
    const hulls = [h];
    for (let k = 0; k < 3; k++) hulls.push(spawnHarvester(rig, HUMAN, HOME_X + 8 * k, PATCH_Z - 26));
    for (const u of hulls) st.cargo[st.index(u)] = 300;

    // Let them all decide to haul, and let the dock lock settle.
    rig.step(6 * SIM_HZ);

    const waiting = hulls
      .map((u) => st.index(u))
      .filter((i) => st.state[i] === UnitState.ReturnToRefinery);
    expect(waiting.length, 'precondition: at least two haulers queued').toBeGreaterThan(1);

    for (let a = 0; a < waiting.length; a++) {
      for (let b = a + 1; b < waiting.length; b++) {
        const d = Math.hypot(
          st.orderX[waiting[a]] - st.orderX[waiting[b]],
          st.orderZ[waiting[a]] - st.orderZ[waiting[b]],
        );
        expect(d, 'two queued haulers were sent to the same point').toBeGreaterThan(1);
      }
    }
  });

  /* -- 6. stance must not move the anchor ---------------------------------- */

  it('keeps its ore anchor when the player changes stance', () => {
    const st = rig.world.store;
    const repair = new RepairSellService(rig.world, rig.channels);
    order(rig, OrderKind.Harvest, [h], HOME_X, PATCH_Z);
    rig.step(4);
    const ax = st.guardX[hi];
    const az = st.guardZ[hi];

    // Drive it well away from its anchor, then change stance there.
    rig.step(20 * SIM_HZ);
    repair.applyStance(HUMAN, Int32Array.of(h as number), 1, Stance.Defensive);

    expect(Math.hypot(st.guardX[hi] - ax, st.guardZ[hi] - az),
      'a stance click must not move the patch a harvester is bound to')
      .toBeLessThan(0.001);
  });
});

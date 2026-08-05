/**
 * UNITS MUST NEVER GET PERMANENTLY WEDGED BETWEEN BUILDINGS.
 *
 * Two layers are under test and they are deliberately tested apart, because
 * they answer different questions and a green result from one hides a red one
 * from the other:
 *
 *   PREVENTION — `Flowfield`'s clearance rule (§4c). A slot narrower than the
 *                widest hull is not routable, EXCEPT when closing it would cut
 *                the map in two. The interesting cases are the boundary ones:
 *                a two-cell street must stay open, a one-cell slot with an
 *                alternative must close, a one-cell slot with no alternative
 *                must stay open, and nothing that was physically connected may
 *                stop being routable.
 *
 *   RECOVERY   — `Steering`'s wedge watchdog. It has to free a unit that IS
 *                stuck (including one the clearance rule itself sealed in) and
 *                it has to leave alone a unit that is merely slow. The second
 *                half matters more than the first: a watchdog that shoves
 *                healthy units is worse than no watchdog.
 *
 * Everything here is headless — typed arrays and the `ITerrain` port, no GL.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { EntityFlag, EntityKind, Faction, Locomotor, UnitState } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { CELL, MAP_CELLS, NAV_MIN_CORRIDOR_CELLS, SIM_DT } from '../src/core/config';
import { Rng } from '../src/core/math';
import { FlowFieldCache, MoveClass } from '../src/sim/Flowfield';
import {
  NavAgents, NavAssigner, SteeringSolver, navWedgeCounters, resetNavWedgeCounters,
} from '../src/sim/Steering';
import { MovementIntegrator, setMoveClass } from '../src/sim/Movement';

const P0 = 0 as PlayerId;

/** Cell index -> the world coordinate of its centre. */
const C = (c: number): number => (c + 0.5) * CELL;

interface Rig {
  world: World;
  nav: FlowFieldCache;
  agents: NavAgents;
  assigner: NavAssigner;
  steering: SteeringSolver;
  movement: MovementIntegrator;
  tick: number;
  step(n?: number): void;
}

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  const channels = new Channels();
  const nav = new FlowFieldCache(world.terrain);
  const agents = new NavAgents();
  const rig: Rig = {
    world,
    nav,
    agents,
    assigner: new NavAssigner(world, nav, agents),
    steering: new SteeringSolver(world, nav, agents),
    movement: new MovementIntegrator(world, nav, channels),
    tick: 0,
    step(n = 1): void {
      const rng = new Rng(1234);
      for (let k = 0; k < n; k++) {
        rig.tick++;
        const s: SimContext = { dt: SIM_DT, tick: rig.tick, time: rig.tick * SIM_DT, rng };
        world.store.snapshotPrev();
        rig.assigner.simTick(s);
        rig.steering.simTick(s);
        rig.movement.simTick(s);
        world.spatial.rebuild();
      }
    },
  };
  return rig;
}

/**
 * A Scrapjaw — the unit the bug was reported against. Radius 3.87 m is
 * `hullRadius` of the 8.6 x 4.0 harvester body, i.e. 7.74 m across against a
 * 4 m cell. That ratio is the whole reason the clearance rule exists, so it is
 * spelled out here rather than imported: if the dimensions change, this test
 * should keep testing the shape it was written for.
 */
function spawnScrapjaw(rig: Rig, x: number, z: number): number {
  const st = rig.world.store;
  const id = st.alloc(EntityKind.Vehicle, 0, P0, Faction.Allies, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= EntityFlag.CanMove;
  st.maxSpeed[i] = 5.6;
  st.accel[i] = 6;
  st.turnRate[i] = 1.6;
  st.radius[i] = 3.87;
  st.locomotor[i] = Locomotor.Wheel;
  st.hp[i] = 850;
  st.maxHp[i] = 850;
  setMoveClass(st, id, MoveClass.Wheel);
  return i;
}

/** Occupy a footprint rect, exactly as a finished structure does. */
function building(rig: Rig, cx: number, cz: number, w: number, h: number): void {
  rig.world.terrain.markOccupied(cx, cz, w, h, (1000 + cx * 137 + cz) as EntityId);
}

function orderTo(rig: Rig, i: number, x: number, z: number): void {
  const st = rig.world.store;
  st.orderX[i] = x;
  st.orderZ[i] = z;
  st.state[i] = UnitState.Moving;
}

/* ========================================================================== */

describe('nav clearance — a slot the hull does not fit through', () => {
  it('is configured to bite for vehicles and not for infantry', () => {
    // Foot units are ~1 m across and threading a doorway is something they
    // should do. Everything with a vehicle hull wants two cells.
    expect(NAV_MIN_CORRIDOR_CELLS[MoveClass.Foot]).toBe(1);
    expect(NAV_MIN_CORRIDOR_CELLS[MoveClass.Track]).toBeGreaterThanOrEqual(2);
    expect(NAV_MIN_CORRIDOR_CELLS[MoveClass.Wheel]).toBeGreaterThanOrEqual(2);
    expect(NAV_MIN_CORRIDOR_CELLS[MoveClass.Hover]).toBeGreaterThanOrEqual(2);
  });

  it('closes a one-cell slot when a two-cell street exists', () => {
    const rig = makeRig();
    // A wall down cx 50..52 with two doors: one cell at cz 40, two at cz 60-61.
    building(rig, 50, 0, 3, 40);
    building(rig, 50, 41, 3, 19);
    building(rig, 50, 62, 3, MAP_CELLS - 62);

    expect(rig.nav.narrowCells(MoveClass.Wheel)).toBe(3);
    expect(rig.nav.restoredCells(MoveClass.Wheel)).toBe(0);
    // Not routable...
    expect(rig.nav.isPassableClass(51, 40, MoveClass.Wheel)).toBe(false);
    // ...but still perfectly solid ground. A unit caught in there can drive out.
    expect(rig.nav.isStandable(51, 40, MoveClass.Wheel)).toBe(true);
    // The two-cell street is untouched.
    expect(rig.nav.isPassableClass(51, 60, MoveClass.Wheel)).toBe(true);
    expect(rig.nav.isPassableClass(51, 61, MoveClass.Wheel)).toBe(true);
  });

  it('leaves the same slot open when it is the only way through', () => {
    const rig = makeRig();
    building(rig, 50, 0, 3, 40);
    building(rig, 50, 41, 3, MAP_CELLS - 41);

    expect(rig.nav.narrowCells(MoveClass.Wheel)).toBe(0);
    expect(rig.nav.restoredCells(MoveClass.Wheel)).toBe(3);
    expect(rig.nav.isPassableClass(51, 40, MoveClass.Wheel)).toBe(true);
  });

  it('never disconnects anything the physical grid connected', () => {
    const rig = makeRig();
    // A block layout with one-cell streets: every corridor in it is a slot, so
    // this is the worst case for the restore pass.
    for (let bz = 0; bz < 5; bz++) {
      for (let bx = 0; bx < 5; bx++) building(rig, 40 + bx * 4, 40 + bz * 4, 3, 3);
    }
    const hard = rig.nav.hardGridFor(MoveClass.Wheel);
    const route = rig.nav.costGridFor(MoveClass.Wheel);

    // Every cell the routing grid still accepts must be in the same routing
    // region as every other routing-open cell it can reach physically. The
    // cheap equivalent, and the one that would actually fail if the restore
    // pass were wrong: no routing-open cell may be cut off from the routing
    // main region while its physical neighbourhood is not.
    const main = rig.nav.mainRegion(MoveClass.Wheel);
    let stranded = 0;
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const i = cz * MAP_CELLS + cx;
        if (hard[i] >= 255 || route[i] >= 255) continue;
        if (rig.nav.regionOf(cx, cz, MoveClass.Wheel) !== main) stranded++;
      }
    }
    expect(stranded).toBe(0);
  });

  it('lets a harvester cross a wall by the street rather than the slot', () => {
    const rig = makeRig();
    building(rig, 50, 0, 3, 40);
    building(rig, 50, 41, 3, 19);
    building(rig, 50, 62, 3, MAP_CELLS - 62);
    const st = rig.world.store;
    const i = spawnScrapjaw(rig, C(40), C(40));
    orderTo(rig, i, C(64), C(40));

    for (let s = 0; s < 90; s++) rig.step(30);

    const dx = st.posX[i] - C(64);
    const dz = st.posZ[i] - C(40);
    expect(Math.sqrt(dx * dx + dz * dz)).toBeLessThan(8);
  });
});

/* ========================================================================== */

describe('nav wedge watchdog', () => {
  beforeEach(() => { resetNavWedgeCounters(); });

  it('frees a unit sealed into an alcove, and says so', () => {
    const rig = makeRig();
    const st = rig.world.store;
    // A two-cell dead end inside a wall. The clearance rule closes it (a stub
    // bridges nothing, so it is not restored), which means the flow field has
    // no direction to give a unit standing in it and the unit grinds into the
    // wall at full throttle. Nothing but the watchdog can see this: the speed
    // watchdog reads max speed, and the region test reads 0 because the cell is
    // not routable at all.
    building(rig, 50, 40, 3, 10);
    building(rig, 50, 51, 3, 9);
    building(rig, 52, 50, 1, 1);
    expect(rig.nav.isPassableClass(51, 50, MoveClass.Wheel)).toBe(false);
    expect(rig.nav.isStandable(51, 50, MoveClass.Wheel)).toBe(true);

    const i = spawnScrapjaw(rig, C(51), C(50));
    orderTo(rig, i, C(80), C(50));
    const x0 = st.posX[i];
    const z0 = st.posZ[i];

    for (let s = 0; s < 60; s++) rig.step(30);

    const moved = Math.hypot(st.posX[i] - x0, st.posZ[i] - z0);
    expect(moved).toBeGreaterThan(40);
    const c = navWedgeCounters();
    expect(c.detections).toBeGreaterThan(0);
    expect(c.repaths).toBeGreaterThan(0);
    expect(c.displaced).toBe(1);
  });

  it('displaces a unit at most once per order', () => {
    const rig = makeRig();
    // A sealed one-cell pocket the unit will walk straight back into: the
    // ladder has to terminate rather than shovelling it every six seconds.
    building(rig, 50, 40, 3, 10);
    building(rig, 50, 51, 3, 9);
    building(rig, 52, 50, 1, 1);
    const i = spawnScrapjaw(rig, C(51), C(50));
    orderTo(rig, i, C(51), C(50));      // ordered to where it already is
    rig.world.store.orderX[i] = C(53);  // ...just inside the wall
    rig.world.store.orderZ[i] = C(50);

    for (let s = 0; s < 180; s++) rig.step(30);

    const c = navWedgeCounters();
    expect(c.displaced).toBeLessThanOrEqual(1);
  });

  it('leaves a converging crowd alone', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const units: number[] = [];
    for (let k = 0; k < 20; k++) {
      units.push(spawnScrapjaw(rig, C(40 + (k % 5) * 2), C(40 + ((k / 5) | 0) * 2)));
    }
    for (const i of units) orderTo(rig, i, C(60), C(60));

    for (let s = 0; s < 120; s++) rig.step(30);

    // Twenty 7.7 m hulls funnelling onto one point shove each other for a long
    // time. None of that is a wedge and none of it may be treated as one.
    expect(navWedgeCounters().detections).toBe(0);
    expect(units.every((i) => st.state[i] === UnitState.Idle)).toBe(true);
  });

  it('leaves a unit standing still to shoot alone', () => {
    const rig = makeRig();
    const st = rig.world.store;
    // Boxed in AND holding a target: the exemption has to win, or a tank that
    // halted in a firing position gets shoved out of it mid-engagement.
    building(rig, 50, 40, 3, 10);
    building(rig, 50, 51, 3, 9);
    building(rig, 52, 50, 1, 1);
    const i = spawnScrapjaw(rig, C(51), C(50));
    orderTo(rig, i, C(80), C(50));
    const x0 = st.posX[i];

    for (let s = 0; s < 60; s++) {
      st.targetId[i] = 4242;            // whatever it is, it is engaging it
      rig.step(30);
    }

    expect(navWedgeCounters().detections).toBe(0);
    expect(Math.abs(st.posX[i] - x0)).toBeLessThan(4);
  });

  it('is deterministic: one seed, two runs, identical outcome', () => {
    const run = (): { x: number; z: number; c: string } => {
      resetNavWedgeCounters();
      const rig = makeRig();
      building(rig, 50, 40, 3, 10);
      building(rig, 50, 51, 3, 9);
      building(rig, 52, 50, 1, 1);
      const i = spawnScrapjaw(rig, C(51), C(50));
      orderTo(rig, i, C(80), C(50));
      for (let s = 0; s < 60; s++) rig.step(30);
      const st = rig.world.store;
      return { x: st.posX[i], z: st.posZ[i], c: JSON.stringify(navWedgeCounters()) };
    };
    const a = run();
    const b = run();
    expect(b).toEqual(a);
  });
});

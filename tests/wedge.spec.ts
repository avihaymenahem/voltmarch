/**
 * UNITS MUST NEVER GET PERMANENTLY WEDGED BETWEEN BUILDINGS.
 *
 * Three layers are under test and they are deliberately tested apart, because
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
 *   AGREEMENT  — `NavAssigner` and `SteeringSolver` must be driving each unit
 *                to the SAME POINT. They were not: the solver applied the
 *                formation slot only inside a 22 m radius and the assigner
 *                applied it always, so beyond that radius the phase that
 *                decides "have I arrived / should I give up / is my path
 *                clear" and the phase that decides which way to lean disagreed
 *                by the whole slot offset. Both now read `agentTarget()`.
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
import {
  CELL, MAP_CELLS, NAV_FORMATION_MAX_OFFSET, NAV_MIN_CORRIDOR_CELLS, SIM_DT,
} from '../src/core/config';
import { Rng } from '../src/core/math';
import { FlowFieldCache, MoveClass } from '../src/sim/Flowfield';
import {
  agentTarget, NavAgents, NavAssigner, SteeringSolver, navWedgeCounters,
  resetNavWedgeCounters, seeksGoal,
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
  /** A context for the CURRENT tick, so a phase can be run on its own. */
  ctx(): SimContext;
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
    ctx(): SimContext {
      return { dt: SIM_DT, tick: rig.tick, time: rig.tick * SIM_DT, rng: new Rng(1234) };
    },
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

/* ==========================================================================
 * ONE TARGET POINT
 *
 * The defect these pin, in one sentence: `SteeringSolver` applied the formation
 * slot only inside NAV_FORMATION_ENGAGE_RADIUS (22 m) and `NavAssigner` applied
 * it unconditionally, so for every unit further out than that the two phases
 * were driving the same unit to two different places.
 *
 * The consequences ran in both directions. Outward: every remedy that worked by
 * moving the slot — the speed watchdog's nudge, rungs 1..N of the wedge ladder —
 * was inert, because the solver could not see it. Inward: a slot LARGER than the
 * radius that switched it on could not be satisfied at all, and
 * NAV_FORMATION_MAX_OFFSET permits 30 m against a 22 m radius, so an ordinary
 * group order produced units that hunted across the boundary forever.
 * ========================================================================== */

describe('the assigner and the solver drive to the same point', () => {
  /**
   * THE MECHANISM, ISOLATED: one unit, one hand-set slot, no crowd.
   *
   * 28 m is deliberate. It is under NAV_FORMATION_MAX_OFFSET (30) so a real
   * group order can produce it, and over the 22 m radius the solver used to
   * gate on — which is the combination that could not be satisfied. The unit
   * closed to 21 m of the ORDER POINT, its target jumped to a slot 28 m the
   * other side, it drove back out past 22 m, and the target jumped back.
   * Measured before the fix: it oscillated between 15 m and 24 m of the order
   * point and the give-up ladder parked it 23.5 m short.
   *
   * Now there is no boundary to hunt across, so it closes and stays closed.
   * The assertion is that shape and not the final pose, because the final pose
   * is the weaker half: measured before the fix, the unit came within 6.3 m of
   * its slot, backed out to 14.1 m, came back to 9.9 m, backed out again and
   * only then settled at 4.5 m. It DID eventually park in tolerance, so a test
   * that only looked at where it stopped would have called that healthy.
   */
  it('a lone unit with a wide slot closes on it and does not back out', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const ag = rig.agents;
    const i = spawnScrapjaw(rig, C(40), C(64));
    orderTo(rig, i, C(60), C(64));
    rig.step(2);
    ag.slotX[i] = 0; ag.slotZ[i] = 28;

    const COMMITTED = 10;
    let committed = false;
    let worst = 0;
    for (let t = 0; t < 1200; t++) {
      rig.step(1);
      const d = Math.hypot(st.posX[i] - (ag.goalX[i] + ag.slotX[i]),
        st.posZ[i] - (ag.goalZ[i] + ag.slotZ[i]));
      if (committed && d > worst) worst = d;
      if (d < COMMITTED) committed = true;
    }
    expect(committed).toBe(true);
    expect(worst).toBeLessThan(COMMITTED);
    expect(seeksGoal(st.state[i])).toBe(false);
    const toSlot = Math.hypot(st.posX[i] - (ag.goalX[i] + ag.slotX[i]),
      st.posZ[i] - (ag.goalZ[i] + ag.slotZ[i]));
    expect(toSlot).toBeLessThan(st.radius[i] + 2);
  });

  /** The one definition. Both phases call it; neither re-derives it. */
  it('agentTarget is the order point plus the slot, with no distance gate', () => {
    const rig = makeRig();
    const ag = rig.agents;
    const out = new Float32Array(2);
    ag.goalX[0] = 100; ag.goalZ[0] = 200;
    ag.slotX[0] = 7; ag.slotZ[0] = -3;
    agentTarget(ag, 0, out);
    expect([out[0], out[1]]).toEqual([107, 197]);
  });

  /**
   * THE LOAD-BEARING ONE, and it is an ordinary group order rather than a
   * contrived pose: nine vehicles spread across the map, one click.
   *
   * `assignFormations` clamps a slot to `min(NAV_FORMATION_MAX_OFFSET,
   * sqrt(members) * meanRadius * NAV_FORMATION_SPACING)`, and for nine
   * harvester-sized hulls that is `min(30, 30.2)` = 30 — comfortably past the
   * 22 m radius the solver used to gate on. The four corner units therefore got
   * slots the solver refused to steer to until they were inside 22 m of the
   * ORDER POINT, at which moment their target jumped 30 m sideways, they drove
   * back out past 22 m, and it jumped back.
   *
   * Measured before the fix, at 9000 ticks — five simulated minutes: three of
   * the nine were still in `UnitState.Moving`, 6.5 to 11.5 m from their slots,
   * oscillating. After: nine of nine parked at 4.2-4.3 m, which is
   * `radius + NAV_ARRIVE_SLACK` and therefore exactly arrival.
   */
  it('a spread-out group all arrive, including the far corners', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const ag = rig.agents;
    const units: number[] = [];
    for (let k = 0; k < 9; k++) {
      units.push(spawnScrapjaw(rig, C(30) + (k % 3) * 40, C(30) + ((k / 3) | 0) * 40));
    }
    for (const i of units) orderTo(rig, i, C(64), C(64));
    rig.step(2);

    // The precondition the bug needed. If the formation clamp ever shrinks
    // below the old radius this test stops testing anything, so assert it.
    const widest = Math.max(...units.map((i) => Math.hypot(ag.slotX[i], ag.slotZ[i])));
    expect(widest).toBeCloseTo(NAV_FORMATION_MAX_OFFSET, 5);

    for (let t = 0; t < 3000; t++) rig.step(1);

    const stillGoing = units.filter((i) => seeksGoal(st.state[i]));
    expect(stillGoing).toEqual([]);
    for (const i of units) {
      const d = Math.hypot(st.posX[i] - (ag.goalX[i] + ag.slotX[i]),
        st.posZ[i] - (ag.goalZ[i] + ag.slotZ[i]));
      expect(d).toBeLessThan(st.radius[i] + 2);
    }
  });
});

/* ========================================================================== */

describe('nav wedge watchdog', () => {
  beforeEach(() => { resetNavWedgeCounters(); });

  /**
   * THE LADDER MUST STILL REACH ITS LAST RUNG.
   *
   * This case is why the shove is not allowed to be its own alibi. A wheeled
   * hull 7.7 m across, sealed in a two-cell alcove whose only mouth is behind
   * it, physically cannot turn around: steering authority scales with road
   * speed and it has none, so a reversal takes about eleven seconds it never
   * gets. No shove can free it and the honest answer is still the displacement
   * rung.
   *
   * But a shove MOVES it — three metres off the far wall — and the ladder used
   * to read any movement at all as the unit coming free and refund the rung it
   * had just climbed. With a shove that does nothing (which is what the slot
   * offset was) that never showed. With one that works it is fatal: measured at
   * six detections, five shoves, ZERO displacements and 2.76 m of net travel in
   * sixty seconds, cycling between rungs 2 and 3 forever. `NavAgents.anchorTick`
   * is the fix — a window that opened while we were still shoving re-anchors but
   * does not pay the rung back — and `displaced === 1` here is what pins it.
   */
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
    // The ladder CLIMBED rather than cycling. Every detection is one rung, so
    // reaching the displacement rung (0 re-plan, 1 and 2 shove, 3 displace) in
    // four is a monotone climb; anything much larger is the refund bug back.
    expect(c.detections).toBeLessThanOrEqual(5);
    // And nothing gave up on the way. The speed watchdog used to park the order
    // outright four seconds into a climb the wedge ladder needs thirty-six to
    // finish, and a parked move order goes Idle and never comes back.
    expect(c.parked).toBe(0);
  });

  /**
   * THE RUNG THAT NEVER RAN.
   *
   * Rungs 1..N shove the unit sideways, and the shove has to survive the one
   * situation every wedged unit is in: a long way from its order point, with a
   * flow field live. It did not. It was a formation-slot offset, the solver
   * ignored the slot beyond 22 m, and even inside that radius the direction
   * under a live field comes from `nav.sample()` and never looks at the target
   * point at all — so the entire middle of the escalation ladder was a no-op and
   * the sequence was really "wait, wait, wait, teleport".
   *
   * A goal offset could not have been made to work either: 5 m of offset at 120
   * m of range turns a unit by 2.4 degrees and the shove has to clear a 7.7 m
   * hull. It is a steering term now, blended in beside separation and avoidance.
   */
  it('the shove steers the unit, at range, under a flow field', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const i = spawnScrapjaw(rig, C(40), C(64));
    orderTo(rig, i, C(100), C(64));
    rig.step(40);
    expect(Math.hypot(st.posX[i] - C(100), st.posZ[i] - C(64))).toBeGreaterThan(100);
    expect(st.navField[i]).toBeGreaterThanOrEqual(0);

    const s = rig.ctx();
    rig.steering.simTick(s);
    const straight = st.desiredYaw[i];

    // Square across the road, held past this tick.
    rig.agents.armNudge(i, 0, -1, rig.tick, 60);
    rig.steering.simTick(s);
    const shoved = st.desiredYaw[i];

    // Not a rounding error: a real, large change of heading.
    expect(Math.abs(shoved - straight)).toBeGreaterThan(0.5);

    // And it expires on its own rather than becoming a permanent list.
    rig.agents.armNudge(i, 0, -1, rig.tick - 1, 0);
    rig.steering.simTick(s);
    expect(st.desiredYaw[i]).toBe(straight);
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

/**
 * ============================================================================
 * tests/spawn-safety.spec.ts — DEFENCE IN DEPTH AGAINST UNREACHABLE GROUND
 * ============================================================================
 * `tests/reachability.spec.ts` owns the generator's invariant: no passable
 * pocket inside the spawn area. This file owns everything that has to hold
 * ANYWAY when that invariant is broken — because a procedural generator will
 * always eventually produce something nobody predicted, and the failure it
 * produced last time ("spawned tanks stuck inside the valley and cant get
 * out") was invisible for exactly as long as nothing checked.
 *
 * Three independent layers, tested independently:
 *
 *   1. SPAWN     — `ScenarioBuilder` never places an entity on ground that is
 *                  not joined to the map, and says so when it has to move one.
 *   2. PATHING   — `FlowFieldCache` knows which cells can reach which, and an
 *                  order whose goal is in another region is retargeted or
 *                  refused instead of steering into the cliff between them.
 *   3. RECOVERY  — a unit that ends up in a pocket regardless is lifted out,
 *                  deterministically, and completes its order.
 *
 * The pockets here are built with `markOccupied`, which closes cells for both
 * `ITerrain.isPassable` and the nav cost grid — the same shape a terrace ring
 * makes, without needing a heightfield.
 * ============================================================================
 */

import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';

import { World, PerEntityObj } from '../src/core/world';
import { Channels } from '../src/core/events';
import {
  EntityFlag, EntityKind, Faction, Locomotor, UnitState,
} from '../src/core/types';
import type { EntityId, ITerrain, PlayerId, SimContext } from '../src/core/types';
import { CELL, SIM_DT } from '../src/core/config';
import { Rng, worldToCell } from '../src/core/math';
import {
  FlowFieldCache, MoveClass, TerrainRegions, NAV_POCKET_MAX_CELLS,
} from '../src/sim/Flowfield';
import {
  NavAgents, NavAssigner, SteeringSolver, navRescueCount, resetNavRescueCount,
} from '../src/sim/Steering';
import { MovementIntegrator } from '../src/sim/Movement';
import {
  ScenarioBuilder, buildScenario, clearScenario, scenarioConnectivity,
  type DefBinding,
} from '../src/game/Scenarios';
import { Terrain } from '../src/world/Terrain';

const P0 = 0 as PlayerId;
const NO_DEFS: DefBinding = { tables: null, unitId: {}, buildingId: {} };

/* ==========================================================================
 * FIXTURE: a walled pocket
 *
 * A hollow square of closed cells with open ground inside it. `LO..HI` is the
 * interior; the ring sits one cell outside on every side. Nothing can cross
 * it, so the interior is a region of its own.
 * ========================================================================== */

const LO = 40;
const HI = 45;
const INTERIOR_CELLS = (HI - LO + 1) * (HI - LO + 1);   // 36

/** Somewhere inside the pocket, in metres. */
const IN_X = (LO + 2.5) * CELL;
const IN_Z = (LO + 2.5) * CELL;

function wallPocket(port: ITerrain): void {
  const a = LO - 1;
  const b = HI + 1;
  for (let c = a; c <= b; c++) {
    port.markOccupied(c, a, 1, 1, 1 as EntityId);
    port.markOccupied(c, b, 1, 1, 1 as EntityId);
    port.markOccupied(a, c, 1, 1, 1 as EntityId);
    port.markOccupied(b, c, 1, 1, 1 as EntityId);
  }
}

/** True when a cell is outside the walled square entirely. */
function outsidePocket(cx: number, cz: number): boolean {
  return cx < LO - 1 || cx > HI + 1 || cz < LO - 1 || cz > HI + 1;
}

/* ==========================================================================
 * FIXTURE: the sim rig (same shape as tests/pathing.spec.ts)
 * ========================================================================== */

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

function spawnTank(rig: Rig, x: number, z: number, loco = Locomotor.Track): number {
  const st = rig.world.store;
  const id = st.alloc(EntityKind.Vehicle, 0, P0, Faction.Allies, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= EntityFlag.CanMove;
  st.maxSpeed[i] = 6;
  st.accel[i] = 8;
  st.turnRate[i] = 2.2;
  st.radius[i] = 1.7;
  st.locomotor[i] = loco;
  st.hp[i] = 100; st.maxHp[i] = 100;
  return i;
}

function orderTo(rig: Rig, i: number, x: number, z: number): void {
  const st = rig.world.store;
  st.orderX[i] = x;
  st.orderZ[i] = z;
  st.state[i] = UnitState.Moving;
}

function cellOf(rig: Rig, i: number): [number, number] {
  const st = rig.world.store;
  return [worldToCell(st.posX[i]), worldToCell(st.posZ[i])];
}

beforeEach(() => {
  resetNavRescueCount();
  clearScenario();
});

/* ==========================================================================
 * 1. THE LABELLING ITSELF
 * ========================================================================== */

describe('TerrainRegions — terrain connectivity, ignoring nothing', () => {
  it('separates a walled pocket from the map and measures it', () => {
    const world = new World();
    wallPocket(world.terrain);
    const r = new TerrainRegions(world.terrain, Locomotor.Track);

    expect(r.regionCount).toBe(2);
    expect(r.isMain(LO + 2, LO + 2)).toBe(false);
    expect(r.regionCellsAt(LO + 2, LO + 2)).toBe(INTERIOR_CELLS);
    expect(r.isMain(4, 4)).toBe(true);
    // The pocket is small enough that the rescue's strict tier will act on it.
    expect(r.regionCellsAt(LO + 2, LO + 2)).toBeLessThanOrEqual(NAV_POCKET_MAX_CELLS);
    // The wall cells themselves belong to no region at all.
    expect(r.regionAt(LO - 1, LO - 1)).toBe(0);
  });

  it('finds a way out of the pocket and it is genuinely outside', () => {
    const world = new World();
    wallPocket(world.terrain);
    const r = new TerrainRegions(world.terrain, Locomotor.Track);
    const out = new Int32Array(2);

    expect(r.nearestMain(LO + 2, LO + 2, out, 20)).toBe(true);
    expect(outsidePocket(out[0], out[1])).toBe(true);
    expect(r.isMain(out[0], out[1])).toBe(true);
  });

  it('is deterministic — the same map gives the same escape cell', () => {
    const build = (): number[] => {
      const world = new World();
      wallPocket(world.terrain);
      const r = new TerrainRegions(world.terrain, Locomotor.Track);
      const out = new Int32Array(2);
      r.nearestMain(LO + 2, LO + 3, out, 20);
      return [out[0], out[1], r.regionCount, r.mainRegionCells];
    };
    expect(build()).toEqual(build());
  });

  it('reports a whole map as one region when nothing is walled off', () => {
    const world = new World();
    const r = new TerrainRegions(world.terrain, Locomotor.Track);
    expect(r.regionCount).toBe(1);
    expect(r.mainFraction).toBe(1);
    expect(r.isMain(64, 64)).toBe(true);
  });
});

/* ==========================================================================
 * 2. THE NAV CACHE KNOWS WHAT IS REACHABLE
 * ========================================================================== */

describe('FlowFieldCache — regions', () => {
  it('answers reachability exactly, both ways', () => {
    const rig = makeRig();
    wallPocket(rig.world.terrain);

    const inside = rig.nav.regionOf(LO + 2, LO + 2, MoveClass.Track);
    const main = rig.nav.mainRegion(MoveClass.Track);
    expect(inside).toBeGreaterThan(0);
    expect(inside).not.toBe(main);
    expect(rig.nav.regionSize(inside, MoveClass.Track)).toBe(INTERIOR_CELLS);

    expect(rig.nav.isReachable(LO + 2, LO + 2, 4, 4, MoveClass.Track)).toBe(false);
    expect(rig.nav.isReachable(LO + 1, LO + 1, HI, HI, MoveClass.Track)).toBe(true);
    expect(rig.nav.isReachable(4, 4, 100, 100, MoveClass.Track)).toBe(true);
    // Aircraft are not on the grid, so nothing is ever cut off from them.
    expect(rig.nav.isReachable(LO + 2, LO + 2, 4, 4, MoveClass.Air)).toBe(true);
  });

  it('re-labels when a wall appears', () => {
    const rig = makeRig();
    expect(rig.nav.connectivity(MoveClass.Track).regions).toBe(1);
    wallPocket(rig.world.terrain);
    const c = rig.nav.connectivity(MoveClass.Track);
    expect(c.regions).toBe(2);
    expect(c.mainCells).toBe(c.passable - INTERIOR_CELLS);
    expect(c.mainFraction).toBeLessThan(1);
  });

  it('pulls an unreachable goal back to the nearest cell the unit can reach', () => {
    const rig = makeRig();
    wallPocket(rig.world.terrain);
    const before = rig.nav.stats.unreachable;

    // Ordered from inside the pocket to open ground 15 cells away.
    const f = rig.nav.requestFieldClass(60, 60, MoveClass.Track, LO + 2, LO + 2);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(rig.nav.stats.unreachable).toBe(before + 1);

    const goal = new Float32Array(2);
    expect(rig.nav.goalOf(f, goal)).toBe(true);
    const gc = rig.nav.regionOf(worldToCell(goal[0]), worldToCell(goal[1]), MoveClass.Track);
    // The retargeted goal is inside the unit's OWN region — a reachable point.
    expect(gc).toBe(rig.nav.regionOf(LO + 2, LO + 2, MoveClass.Track));
  });

  it('refuses outright when nothing reachable is anywhere near the goal', () => {
    const rig = makeRig();
    wallPocket(rig.world.terrain);
    // The far corner of the map is well past the search radius from a 6x6 hole.
    expect(rig.nav.requestFieldClass(120, 120, MoveClass.Track, LO + 2, LO + 2)).toBe(-1);
  });

  it('leaves an ordinary order completely alone', () => {
    const rig = makeRig();
    wallPocket(rig.world.terrain);
    const before = rig.nav.stats.unreachable;
    // Both ends on the main region: no retarget, and the goal still buckets,
    // so a group order still collapses onto one shared field.
    const a = rig.nav.requestFieldClass(100, 100, MoveClass.Track, 10, 10);
    const b = rig.nav.requestFieldClass(101, 101, MoveClass.Track, 12, 14);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBe(a);
    expect(rig.nav.stats.unreachable).toBe(before);
  });
});

/* ==========================================================================
 * 3. RECOVERY — a unit that is in a pocket anyway gets out
 * ========================================================================== */

describe('stuck recovery', () => {
  it('lifts a trapped tank out on the tick it is ordered away', () => {
    const rig = makeRig();
    wallPocket(rig.world.terrain);
    const i = spawnTank(rig, IN_X, IN_Z);
    rig.world.spatial.rebuild();
    orderTo(rig, i, 100 * CELL, 100 * CELL);

    rig.step(1);

    const [cx, cz] = cellOf(rig, i);
    expect(outsidePocket(cx, cz)).toBe(true);
    expect(rig.nav.regionOf(cx, cz, MoveClass.Track)).toBe(rig.nav.mainRegion(MoveClass.Track));
    expect(rig.assigner.rescues).toBe(1);
    expect(navRescueCount()).toBe(1);
  });

  it('the rescued tank then completes the order it was given', () => {
    const rig = makeRig();
    wallPocket(rig.world.terrain);
    const i = spawnTank(rig, IN_X, IN_Z);
    rig.world.spatial.rebuild();
    orderTo(rig, i, 70 * CELL, 70 * CELL);

    // It is lifted onto the near side of the wall, so it still has to drive
    // around the outside of it — ~180 m at 6 m/s.
    rig.step(1400);
    const st = rig.world.store;
    expect(Math.hypot(st.posX[i] - 70 * CELL, st.posZ[i] - 70 * CELL)).toBeLessThan(6);
    expect(st.state[i]).toBe(UnitState.Idle);
  });

  it('does not snap the render interpolation across the wall', () => {
    const rig = makeRig();
    wallPocket(rig.world.terrain);
    const i = spawnTank(rig, IN_X, IN_Z);
    rig.world.spatial.rebuild();
    orderTo(rig, i, 100 * CELL, 100 * CELL);
    rig.step(1);
    const st = rig.world.store;
    // prev is dragged to the new pose, so the frame interpolates from where
    // the unit IS rather than sliding it through the cliff over one frame.
    expect(st.prevX[i]).toBeCloseTo(st.posX[i], 5);
    expect(st.prevZ[i]).toBeCloseTo(st.posZ[i], 5);
  });

  it('leaves a unit whose order is INSIDE its own pocket alone', () => {
    const rig = makeRig();
    wallPocket(rig.world.terrain);
    const i = spawnTank(rig, (LO + 0.5) * CELL, (LO + 0.5) * CELL);
    rig.world.spatial.rebuild();
    // Ordered to the far corner of the pocket: perfectly achievable.
    orderTo(rig, i, (HI + 0.5) * CELL, (HI + 0.5) * CELL);

    rig.step(120);
    const [cx, cz] = cellOf(rig, i);
    expect(outsidePocket(cx, cz)).toBe(false);
    expect(rig.assigner.rescues).toBe(0);
  });

  it('never touches a unit that is simply driving across open ground', () => {
    const rig = makeRig();
    const i = spawnTank(rig, 200, 200);
    rig.world.spatial.rebuild();
    orderTo(rig, i, 300, 260);
    rig.step(400);
    expect(rig.assigner.rescues).toBe(0);
    expect(rig.assigner.unreachableOrders).toBe(0);
  });

  it('is deterministic — two identical runs land on identical poses', () => {
    const run = (): number[] => {
      resetNavRescueCount();
      const rig = makeRig();
      wallPocket(rig.world.terrain);
      const ids: number[] = [];
      for (let k = 0; k < 4; k++) {
        ids.push(spawnTank(rig, (LO + k) * CELL + 2, (LO + 1) * CELL + 2));
      }
      rig.world.spatial.rebuild();
      for (const i of ids) orderTo(rig, i, 100 * CELL, 100 * CELL);
      rig.step(300);
      const out: number[] = [];
      for (const i of ids) {
        out.push(rig.world.store.posX[i], rig.world.store.posZ[i], rig.world.store.yaw[i]);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

/* ==========================================================================
 * 4. MOVEMENT — a unit standing on a closed cell can still walk off it
 * ========================================================================== */

describe('movement — never imprisoned by the wall-slide rule', () => {
  it('walks out of a cell that was closed underneath it', () => {
    const rig = makeRig();
    const i = spawnTank(rig, 50 * CELL + 2, 50 * CELL + 2);
    rig.world.spatial.rebuild();
    // A structure lands on top of it: every candidate step is now "into a
    // blocked cell", which used to freeze it in place forever.
    rig.world.terrain.markOccupied(49, 49, 3, 3, 7 as EntityId);
    orderTo(rig, i, 70 * CELL, 50 * CELL);

    rig.step(90);
    const st = rig.world.store;
    expect(st.posX[i]).toBeGreaterThan(52 * CELL);
  });
});

/* ==========================================================================
 * 5. SPAWN VALIDATION
 * ========================================================================== */

describe('ScenarioBuilder — nothing spawns in a pit it cannot leave', () => {
  function builderOnPockedMap(): { world: World; b: ScenarioBuilder } {
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    // The pocket must exist BEFORE the builder, because the builder snapshots
    // terrain connectivity in its constructor.
    wallPocket(world.terrain);
    const keys = new PerEntityObj<string>(world.store);
    return { world, b: new ScenarioBuilder(world, NO_DEFS, keys, 4242, 'temperate') };
  }

  it('relocates a unit dropped into a pocket onto connected ground', () => {
    const { world, b } = builderOnPockedMap();
    const id = b.spawnUnit('grizzly', b.allies, IN_X, IN_Z);
    const i = world.store.index(id);
    expect(i).toBeGreaterThanOrEqual(0);

    const cx = worldToCell(world.store.posX[i]);
    const cz = worldToCell(world.store.posZ[i]);
    expect(outsidePocket(cx, cz)).toBe(true);
  });

  it('relocates a whole formation, not just the first of it', () => {
    const { world, b } = builderOnPockedMap();
    const placed = b.formation('grizzly', b.allies, IN_X, IN_Z, 6, { spacing: 4 });
    expect(placed).toBe(6);

    const st = world.store;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.kind[i] !== EntityKind.Vehicle) continue;
      const [cx, cz] = [worldToCell(st.posX[i]), worldToCell(st.posZ[i])];
      expect(outsidePocket(cx, cz)).toBe(true);
    }
  });

  it('moves a refinery out of a pit so harvesters can reach it', () => {
    const { world, b } = builderOnPockedMap();
    const id = b.spawnBuilding('refinery', b.allies, IN_X, IN_Z);
    const i = world.store.index(id);
    expect(i).toBeGreaterThanOrEqual(0);
    const cx = worldToCell(world.store.posX[i]);
    const cz = worldToCell(world.store.posZ[i]);
    expect(outsidePocket(cx, cz)).toBe(true);
  });

  it('leaves everything on healthy ground exactly where the layout put it', () => {
    const { world, b } = builderOnPockedMap();
    const x = 100 * CELL + 1.25;
    const z = 90 * CELL + 3.5;
    const id = b.spawnUnit('grizzly', b.allies, x, z);
    const i = world.store.index(id);
    expect(world.store.posX[i]).toBeCloseTo(x, 5);
    expect(world.store.posZ[i]).toBeCloseTo(z, 5);
    expect(b.auditConnectivity().relocated).toBe(0);
  });

  it('reports what it had to do rather than correcting silently', () => {
    const { b } = builderOnPockedMap();
    b.spawnUnit('grizzly', b.allies, IN_X, IN_Z);
    b.spawnUnit('gi', b.allies, IN_X + CELL, IN_Z + CELL);

    const report = b.auditConnectivity();
    expect(report.regions).toBe(2);
    expect(report.relocated).toBe(2);
    expect(report.relocatedMaxMetres).toBeGreaterThan(0);
    expect(report.strandedEntities).toBe(0);
    expect(report.summary).toContain('2 placements relocated');
  });
});

/* ==========================================================================
 * 6. END TO END ON REAL GENERATED TERRAIN
 *
 * The point of the whole exercise: whatever the generator produces, and
 * whether or not it has been fixed, a built scenario must not contain a single
 * entity standing on ground it cannot leave. These are the seeds the bug
 * report measured as worst.
 * ========================================================================== */

describe('a built scenario on real terrain', () => {
  for (const seed of [7, 9]) {
    it(`strands nothing on temperate/seed=${seed}`, () => {
      const scene = new THREE.Scene();
      const terrain = new Terrain({ scene, seed, biome: 'temperate', anisotropy: 1 });
      const world = new World();
      world.terrain = terrain;
      world.addPlayer(Faction.Allies, 'Commander', true, true);
      world.addPlayer(Faction.Soviets, 'Opponent', false, false);

      try {
        buildScenario(world, 'skirmish', seed, { map: 'temperate' });
        const report = scenarioConnectivity();
        expect(report).not.toBeNull();
        expect(report?.strandedEntities).toBe(0);
      } finally {
        clearScenario();
        terrain.dispose();
      }
    });
  }
});

/**
 * Pathfinding, steering and movement — the sim-only half of the module.
 *
 * Everything here runs headless: the flow field, the steering blend and the
 * integrator only touch typed arrays and the `ITerrain` port, so the whole
 * path from "order issued" to "unit standing on the goal" is testable in Node
 * with no GL context and no terrain mesh.
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { EntityFlag, EntityKind, Faction, Locomotor, UnitState } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { CELL, SIM_DT, WATER_LEVEL } from '../src/core/config';
import { Rng, worldToCell } from '../src/core/math';
import { FlowFieldCache, MoveClass } from '../src/sim/Flowfield';
import { NavAgents, NavAssigner, SteeringSolver } from '../src/sim/Steering';
import { MovementIntegrator, setMoveClass } from '../src/sim/Movement';

const P0 = 0 as PlayerId;

interface Rig {
  world: World;
  channels: Channels;
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
    channels,
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
        const ctx: SimContext = { dt: SIM_DT, tick: rig.tick, time: rig.tick * SIM_DT, rng };
        world.store.snapshotPrev();
        rig.assigner.simTick(ctx);
        rig.steering.simTick(ctx);
        rig.movement.simTick(ctx);
        world.spatial.rebuild();
      }
    },
  };
  return rig;
}

/** A tank-ish mover. Returns the slot index, which is what the sim works in. */
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

function dist(rig: Rig, i: number, x: number, z: number): number {
  const st = rig.world.store;
  const dx = st.posX[i] - x, dz = st.posZ[i] - z;
  return Math.sqrt(dx * dx + dz * dz);
}

/* ========================================================================== */

describe('FlowFieldCache — fields', () => {
  it('expands a field and points it at the goal', () => {
    const rig = makeRig();
    const f = rig.nav.requestFieldClass(60, 60, MoveClass.Track);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(rig.nav.isReady(f)).toBe(false);

    for (let k = 0; k < 12 && !rig.nav.isReady(f); k++) rig.nav.update();
    expect(rig.nav.isReady(f)).toBe(true);

    // The goal is quantised into its bucket, so ask the field where it points
    // rather than assuming the cell we requested.
    const goal = new Float32Array(2);
    rig.nav.goalOf(f, goal);
    const out = new Float32Array(2);
    // Standing 40 m to the -X side of the goal, on its row: flow must be +X.
    expect(rig.nav.sample(f, goal[0] - 40, goal[1], out)).toBe(true);
    expect(out[0]).toBeGreaterThan(0.9);
    expect(Math.abs(out[1])).toBeLessThan(0.2);
  });

  it('shares one field between goals in the same bucket', () => {
    const rig = makeRig();
    const a = rig.nav.requestFieldClass(60, 60, MoveClass.Track);
    const b = rig.nav.requestFieldClass(61, 62, MoveClass.Track);
    expect(b).toBe(a);
    // Different bucket => different field.
    const c = rig.nav.requestFieldClass(80, 80, MoveClass.Track);
    expect(c).not.toBe(a);
  });

  it('gives different classes different fields', () => {
    const rig = makeRig();
    const a = rig.nav.requestFieldClass(60, 60, MoveClass.Track);
    const b = rig.nav.requestFieldClass(60, 60, MoveClass.Foot);
    expect(b).not.toBe(a);
  });

  it('routes around a wall instead of through it', () => {
    const rig = makeRig();
    // A 40-cell wall on x=64 with a gap only at the very top of the map.
    for (let cz = 0; cz < 100; cz++) {
      rig.world.terrain.markOccupied(64, cz, 1, 1, 1 as EntityId);
    }
    const goalCx = 78, goalCz = 40;
    const f = rig.nav.requestFieldClass(goalCx, goalCz, MoveClass.Track);
    for (let k = 0; k < 24 && !rig.nav.isReady(f); k++) rig.nav.update();
    expect(rig.nav.isReady(f)).toBe(true);

    // Standing due west of the goal, behind the wall: the flow must NOT point
    // straight at it (that is the wall); it must lead north toward the gap.
    const out = new Float32Array(2);
    expect(rig.nav.sample(f, 50 * CELL, 40 * CELL, out)).toBe(true);
    expect(out[1]).toBeGreaterThan(0.2);
  });

  it('rebuilds when occupancy changes', () => {
    const rig = makeRig();
    const f = rig.nav.requestFieldClass(60, 60, MoveClass.Track);
    for (let k = 0; k < 12 && !rig.nav.isReady(f); k++) rig.nav.update();
    expect(rig.nav.isReady(f)).toBe(true);

    rig.world.terrain.markOccupied(50, 50, 3, 3, 1 as EntityId);
    rig.nav.update();
    // The occupancy bump invalidated it; it re-expands under the same handle.
    expect(rig.nav.costAt(51, 51, MoveClass.Track)).toBeGreaterThanOrEqual(255);
  });

  it('snaps an unreachable goal to the nearest standable cell', () => {
    const rig = makeRig();
    rig.world.terrain.markOccupied(60, 60, 4, 4, 1 as EntityId);
    const f = rig.nav.requestFieldClass(61, 61, MoveClass.Track);
    expect(f).toBeGreaterThanOrEqual(0);
    const goal = new Float32Array(2);
    expect(rig.nav.goalOf(f, goal)).toBe(true);
    const gcx = worldToCell(goal[0]), gcz = worldToCell(goal[1]);
    expect(rig.nav.isPassableClass(gcx, gcz, MoveClass.Track)).toBe(true);
  });

  it('refuses land for naval and water is absent on flat terrain', () => {
    const rig = makeRig();
    // FlatTerrain has no water at all, so every cell is closed to a ship.
    expect(rig.nav.isPassableClass(40, 40, MoveClass.Naval)).toBe(false);
    expect(rig.nav.isPassableClass(40, 40, MoveClass.Track)).toBe(true);
    // Aircraft ignore the grid entirely.
    rig.world.terrain.markOccupied(40, 40, 2, 2, 1 as EntityId);
    expect(rig.nav.isPassableClass(40, 40, MoveClass.Air)).toBe(true);
    expect(rig.nav.isPassableClass(40, 40, MoveClass.Track)).toBe(false);
  });

  it('reports a blocked straight line', () => {
    const rig = makeRig();
    expect(rig.nav.isDirectPathClearClass(100, 100, 160, 100, MoveClass.Track)).toBe(true);
    for (let cz = 20; cz < 40; cz++) rig.world.terrain.markOccupied(32, cz, 1, 1, 1 as EntityId);
    expect(rig.nav.isDirectPathClearClass(100, 100, 160, 100, MoveClass.Track)).toBe(false);
  });
});

/* ========================================================================== */

describe('movement — a unit actually gets there', () => {
  it('drives across open ground and stops on the goal', () => {
    const rig = makeRig();
    const i = spawnTank(rig, 200, 200);
    orderTo(rig, i, 260, 200);
    rig.step(400);
    expect(dist(rig, i, 260, 200)).toBeLessThan(4);
    expect(rig.world.store.state[i]).toBe(UnitState.Idle);
    expect(rig.world.store.speed[i]).toBeLessThan(0.5);
  });

  it('never leaves the map', () => {
    const rig = makeRig();
    const i = spawnTank(rig, 8, 8);
    orderTo(rig, i, -400, -400);
    rig.step(120);
    expect(rig.world.store.posX[i]).toBeGreaterThanOrEqual(0);
    expect(rig.world.store.posZ[i]).toBeGreaterThanOrEqual(0);
  });

  it('turns in place before driving (tracked chassis)', () => {
    const rig = makeRig();
    const i = spawnTank(rig, 200, 200);
    const st = rig.world.store;
    st.yaw[i] = Math.PI;                 // facing -Z
    orderTo(rig, i, 200, 260);           // ordered to +Z: a full reversal
    rig.step(3);
    // Three ticks in, it has rotated but barely moved.
    expect(Math.abs(st.yaw[i] - Math.PI)).toBeGreaterThan(0.05);
    expect(dist(rig, i, 200, 200)).toBeLessThan(1.0);
  });

  it('a wheeled chassis cannot spin on the spot', () => {
    const rig = makeRig();
    const i = spawnTank(rig, 200, 200, Locomotor.Wheel);
    const st = rig.world.store;
    st.yaw[i] = 0;
    orderTo(rig, i, 140, 200);
    const before = st.yaw[i];
    rig.step(2);
    const tracked = makeRig();
    const j = spawnTank(tracked, 200, 200, Locomotor.Track);
    tracked.world.store.yaw[j] = 0;
    orderTo(tracked, j, 140, 200);
    tracked.step(2);
    // Same order, same two ticks: the tracked hull has swung further because
    // the wheeled one has almost no steering authority at a standstill.
    const wheelTurn = Math.abs(st.yaw[i] - before);
    const trackTurn = Math.abs(tracked.world.store.yaw[j] - before);
    expect(trackTurn).toBeGreaterThan(wheelTurn);
  });

  it('routes a unit around a building', () => {
    const rig = makeRig();
    // Wall across the direct line, with open ground above and below.
    for (let cz = 44; cz <= 56; cz++) rig.world.terrain.markOccupied(54, cz, 1, 1, 1 as EntityId);
    const i = spawnTank(rig, 40 * CELL, 50 * CELL);
    orderTo(rig, i, 70 * CELL, 50 * CELL);
    rig.step(900);
    expect(rig.world.store.posX[i]).toBeGreaterThan(54 * CELL);
  });

  it('keeps overlapping units apart', () => {
    const rig = makeRig();
    const a = spawnTank(rig, 200, 200);
    const b = spawnTank(rig, 200.2, 200.1);
    rig.world.spatial.rebuild();
    rig.step(30);
    const st = rig.world.store;
    const d = Math.hypot(st.posX[a] - st.posX[b], st.posZ[a] - st.posZ[b]);
    expect(d).toBeGreaterThan(1.5);
  });
});

/* ========================================================================== */

describe('formations', () => {
  it('a group order preserves relative positions', () => {
    const rig = makeRig();
    const units: number[] = [];
    for (let k = 0; k < 5; k++) units.push(spawnTank(rig, 180 + k * 6, 200));
    rig.world.spatial.rebuild();
    for (const i of units) orderTo(rig, i, 300, 300);
    rig.step(1200);

    const st = rig.world.store;
    // They arrived spread out, not stacked on one point.
    let minD = Infinity, maxD = 0;
    for (let a = 0; a < units.length; a++) {
      for (let b = a + 1; b < units.length; b++) {
        const d = Math.hypot(
          st.posX[units[a]] - st.posX[units[b]],
          st.posZ[units[a]] - st.posZ[units[b]],
        );
        if (d < minD) minD = d;
        if (d > maxD) maxD = d;
      }
    }
    expect(minD).toBeGreaterThan(2.5);
    expect(maxD).toBeLessThan(40);
    // And every one of them is somewhere near the order point.
    for (const i of units) expect(dist(rig, i, 300, 300)).toBeLessThan(24);
  });
});

/* ========================================================================== */

describe('determinism', () => {
  it('two identical runs land on identical positions', () => {
    const run = (): number[] => {
      const rig = makeRig();
      const out: number[] = [];
      const ids: number[] = [];
      for (let k = 0; k < 12; k++) ids.push(spawnTank(rig, 160 + (k % 4) * 5, 160 + ((k / 4) | 0) * 5));
      rig.world.spatial.rebuild();
      for (const i of ids) orderTo(rig, i, 300, 260);
      rig.step(240);
      for (const i of ids) { out.push(rig.world.store.posX[i], rig.world.store.posZ[i], rig.world.store.yaw[i]); }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

/* ========================================================================== */

describe('body tilt', () => {
  /** Ground that rises linearly toward +X: a constant 20% grade. */
  function slopedTerrain(rig: Rig): void {
    const base = rig.world.terrain;
    rig.world.terrain = {
      ...base,
      heightAt: (x: number) => x * 0.2,
      normalAt: (_x: number, _z: number, out: Float32Array) => {
        // Surface y = 0.2x  =>  normal proportional to (-0.2, 1, 0).
        const l = Math.sqrt(0.04 + 1);
        out[0] = -0.2 / l; out[1] = 1 / l; out[2] = 0;
        return out;
      },
      slopeAt: () => Math.atan(0.2),
      isPassable: base.isPassable.bind(base),
      isBuildable: base.isBuildable.bind(base),
      isOccupied: base.isOccupied.bind(base),
      markOccupied: base.markOccupied.bind(base),
      clearOccupied: base.clearOccupied.bind(base),
      occupancyVersion: base.occupancyVersion.bind(base),
      isWater: base.isWater.bind(base),
      raycastGround: base.raycastGround.bind(base),
    };
  }

  it('pitches nose-up driving uphill and rolls driving across the slope', () => {
    const rig = makeRig();
    slopedTerrain(rig);

    const up = spawnTank(rig, 200, 200);
    rig.world.store.yaw[up] = Math.PI / 2;      // facing +X, straight uphill
    const across = spawnTank(rig, 200, 240);
    rig.world.store.yaw[across] = 0;            // facing +Z, slope on its right

    rig.step(20);
    const st = rig.world.store;
    // Uphill: nose up => positive pitch, no roll.
    expect(st.hullPitch[up]).toBeGreaterThan(0.05);
    expect(Math.abs(st.hullRoll[up])).toBeLessThan(0.02);
    // Across: ground rises to the +X side, which is this hull's right, so the
    // right side lifts => negative roll (the bridge's +roll drops the +X side).
    expect(st.hullRoll[across]).toBeLessThan(-0.05);
    expect(Math.abs(st.hullPitch[across])).toBeLessThan(0.02);
  });

  it('conforms posY to the ground', () => {
    const rig = makeRig();
    slopedTerrain(rig);
    const i = spawnTank(rig, 200, 200);
    rig.step(2);
    expect(rig.world.store.posY[i]).toBeCloseTo(rig.world.store.posX[i] * 0.2, 3);
  });
});

/* ========================================================================== */

describe('move classes', () => {
  it('aircraft ignore the ground and hold cruise altitude', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const i = spawnTank(rig, 200, 200, Locomotor.Hover);
    setMoveClass(st, st.handleOf(i), MoveClass.Air);
    // A building directly on the flight path changes nothing.
    rig.world.terrain.markOccupied(54, 49, 3, 3, 1 as EntityId);
    orderTo(rig, i, 260, 200);
    rig.step(400);
    expect(dist(rig, i, 260, 200)).toBeLessThan(5);
    expect(st.posY[i]).toBeGreaterThan(10);
  });

  it('an explicit class survives and a stale one does not', () => {
    const rig = makeRig();
    const st = rig.world.store;
    const i = spawnTank(rig, 200, 200, Locomotor.Hover);
    const id = st.handleOf(i);
    expect(setMoveClass(st, id, MoveClass.Naval)).toBe(true);
    st.markDead(id);
    st.flushDestroyed();
    expect(setMoveClass(st, id, MoveClass.Air)).toBe(false);
  });
});

/* ========================================================================== */

describe('naval', () => {
  /** FlatTerrain, but everything at cx >= 64 is water. */
  function harbour(rig: Rig): void {
    const base = rig.world.terrain;
    rig.world.terrain = {
      heightAt: () => 0,
      normalAt: (_x: number, _z: number, out: Float32Array) => {
        out[0] = 0; out[1] = 1; out[2] = 0; return out;
      },
      slopeAt: () => 0,
      isPassable: (cx: number, cz: number, loco: number) =>
        base.isPassable(cx, cz, loco) && (cx < 64 || loco === Locomotor.Hover),
      isBuildable: base.isBuildable.bind(base),
      isOccupied: base.isOccupied.bind(base),
      markOccupied: base.markOccupied.bind(base),
      clearOccupied: base.clearOccupied.bind(base),
      occupancyVersion: base.occupancyVersion.bind(base),
      isWater: (cx: number) => cx >= 64,
      raycastGround: base.raycastGround.bind(base),
    };
    rig.nav.setTerrain(rig.world.terrain);
  }

  it('ships path on water and nowhere else', () => {
    const rig = makeRig();
    harbour(rig);
    expect(rig.nav.isPassableClass(70, 40, MoveClass.Naval)).toBe(true);
    expect(rig.nav.isPassableClass(40, 40, MoveClass.Naval)).toBe(false);
    // ...and ground units are shut out of the water.
    expect(rig.nav.isPassableClass(70, 40, MoveClass.Track)).toBe(false);
    // Hovercraft take both.
    expect(rig.nav.isPassableClass(70, 40, MoveClass.Hover)).toBe(true);
    expect(rig.nav.isPassableClass(40, 40, MoveClass.Hover)).toBe(true);
  });

  it('a ship stays on the waterline and never drives ashore', () => {
    const rig = makeRig();
    harbour(rig);
    const st = rig.world.store;
    const i = spawnTank(rig, 80 * CELL, 40 * CELL, Locomotor.Hover);
    setMoveClass(st, st.handleOf(i), MoveClass.Naval);
    orderTo(rig, i, 20 * CELL, 40 * CELL);       // ordered deep inland
    rig.step(600);
    expect(st.posX[i]).toBeGreaterThan(63 * CELL);
    expect(st.posY[i]).toBeCloseTo(WATER_LEVEL, 5);
  });
});

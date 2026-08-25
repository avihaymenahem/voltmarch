/**
 * ============================================================================
 * VOLTMARCH — tests/clash.spec.ts
 * ============================================================================
 * TWO VEHICLES THAT MEET MUST NOT STOP FOREVER.
 *
 * The reported bug, twice: "sometimes vehicles clash but dont find a way to
 * move so they stuck forever". Reproduced here at 12 seeds out of 12 before the
 * fix — order two tanks past each other on open ground and they meet nose to
 * nose, their speed decays exponentially to zero over about four seconds, the
 * gap freezes at exactly `radius(a) + radius(b)`, and four seconds after that
 * the give-up ladder parks them both sixty metres short of where they were sent.
 *
 * WHY IT DEADLOCKED — the two faults, and why either alone is not enough:
 *
 *   THE QUEUE BRAKE HAD NO FLOOR. It sets my desired speed to the speed of
 *   whoever is in front of me plus `(gap - contact) * STEER_QUEUE_BRAKE`.
 *   Movement's relaxation holds the gap a hair BELOW contact, so that term is
 *   negative, and two units facing each other run `v <- v' - eps` on both sides
 *   at once. A contraction with the fixed point zero.
 *
 *   NOTHING LEANED SIDEWAYS. Head-on, the separation push is exactly
 *   anti-parallel to travel, so the blend never leaves the axis. Obstacle
 *   avoidance probes the terrain grid and another unit is not in it.
 *
 * So the fix is two things at once — a floor on the brake (STEER_QUEUE_MIN_FRAC)
 * and a "both keep right" sidestep (STEER_PASS_*) — and both halves are load
 * bearing. Measured against this file:
 *
 *   revert both       6 of 9 red
 *   revert the floor  5 of 9 red, including the head-on pair
 *   revert the step   3 of 9 red — a lone pair squeezes past on the crawl
 *                     alone, but the columns and the gate do not
 *
 * The three that stay green in every case are the ones that exist to prove the
 * fix did NOT break the healthy path: a lone unit still brakes to a stop and
 * parks, a lone unit still drives straight, and a run is still reproducible.
 *
 * Everything is headless — typed arrays and the `ITerrain` port, no GL, no
 * renderer, no browser. Same rig shape as tests/wedge.spec.ts.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { EntityFlag, EntityKind, Faction, Locomotor, UnitState } from '../src/core/types';
import type { EntityId, PlayerId, SimContext } from '../src/core/types';
import { CELL, MAP_CELLS, SIM_DT } from '../src/core/config';
import { Rng } from '../src/core/math';
import { FlowFieldCache, MoveClass } from '../src/sim/Flowfield';
import { NavAgents, NavAssigner, SteeringSolver, seeksGoal } from '../src/sim/Steering';
import { MovementIntegrator, setMoveClass } from '../src/sim/Movement';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

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

function makeRig(seed = 1234): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  world.addPlayer(Faction.Soviets, 'B', false, false);
  const channels = new Channels();
  const nav = new FlowFieldCache(world.terrain);
  const agents = new NavAgents();
  const rng = new Rng(seed);
  const rig: Rig = {
    world,
    nav,
    agents,
    assigner: new NavAssigner(world, nav, agents),
    steering: new SteeringSolver(world, nav, agents),
    movement: new MovementIntegrator(world, nav, channels),
    tick: 0,
    step(n = 1): void {
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
 * A vehicle with the reported unit's proportions: 3.87 m hull radius against a
 * 4 m cell, so two of them nose to nose span nearly two cells. Spelled out
 * rather than imported from Defs — if the roster changes, this file should keep
 * testing the geometry it was written for.
 */
function spawnTank(rig: Rig, x: number, z: number, player: PlayerId = P0): number {
  const st = rig.world.store;
  const faction = player === P0 ? Faction.Allies : Faction.Soviets;
  const id = st.alloc(EntityKind.Vehicle, 0, player, faction, x, 0, z, 0);
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

function building(rig: Rig, cx: number, cz: number, w: number, h: number): void {
  rig.world.terrain.markOccupied(cx, cz, w, h, (1000 + cx * 137 + cz) as EntityId);
}

function orderTo(rig: Rig, i: number, x: number, z: number): void {
  const st = rig.world.store;
  st.orderX[i] = x;
  st.orderZ[i] = z;
  st.state[i] = UnitState.Moving;
}

/**
 * Metres from the unit to the point it is ACTUALLY driving at — its formation
 * slot, not the raw order point. Four tanks told to stand on one spot
 * legitimately end up a column long, and measuring against the click would call
 * that a failure.
 */
function distToSlot(rig: Rig, i: number): number {
  const st = rig.world.store;
  const ag = rig.agents;
  return Math.hypot(st.posX[i] - (ag.goalX[i] + ag.slotX[i]),
    st.posZ[i] - (ag.goalZ[i] + ag.slotZ[i]));
}

/** True when a unit settled where it was sent. */
function settled(rig: Rig, i: number): boolean {
  return distToSlot(rig, i) <= rig.world.store.radius[i] + 6;
}

/**
 * Run and report the failure mode directly: units that ended the run neither
 * settled nor moving. Both halves matter — a unit frozen with `UnitState` still
 * saying "Moving" and a unit the give-up ladder parked sixty metres short are
 * the same bug wearing two hats, and the player cannot tell them apart.
 */
function stranded(rig: Rig, units: number[], ticks: number): string[] {
  const st = rig.world.store;
  const WINDOW = 150;                              // 5 s at 30 Hz
  const lastX = units.map((i) => st.posX[i]);
  const lastZ = units.map((i) => st.posZ[i]);
  const moved = units.map(() => Infinity);
  for (let t = 0; t < ticks; t++) {
    rig.step(1);
    if (t % WINDOW !== WINDOW - 1) continue;
    for (let k = 0; k < units.length; k++) {
      const i = units[k];
      moved[k] = Math.hypot(st.posX[i] - lastX[k], st.posZ[i] - lastZ[k]);
      lastX[k] = st.posX[i];
      lastZ[k] = st.posZ[i];
    }
  }
  const bad: string[] = [];
  for (let k = 0; k < units.length; k++) {
    const i = units[k];
    if (settled(rig, i)) continue;
    const d = distToSlot(rig, i).toFixed(1);
    if (!seeksGoal(st.state[i])) bad.push(`u${i} gave up ${d} m short (state ${st.state[i]})`);
    else if (moved[k] < 1) bad.push(`u${i} frozen ${d} m short while still ordered`);
  }
  return bad;
}

/* ==========================================================================
 * 1. THE REPORTED BUG
 * ========================================================================== */

describe('vehicles that clash still get where they were sent', () => {
  /**
   * THE LOAD-BEARING ONE. Two tanks, open ground, ordered onto each other's
   * position. Twelve lateral offsets so the result cannot be an artefact of one
   * perfectly symmetric pose — and the perfectly symmetric pose (offset 0) is
   * deliberately one of them, because that is the case that used to deadlock
   * hardest.
   *
   * Before the fix: 12 of 12 offsets left BOTH tanks stopped for good, roughly
   * sixty metres short. After: 0 of 12.
   */
  it('a head-on pair passes each other, at every offset', () => {
    const failures: string[] = [];
    for (let k = 0; k < 12; k++) {
      const rig = makeRig(k + 1);
      const off = k * 0.37;
      const a = spawnTank(rig, C(40) + off, C(64));
      const b = spawnTank(rig, C(70), C(64) + off * 0.5);
      orderTo(rig, a, C(70), C(64));
      orderTo(rig, b, C(40), C(64));
      const bad = stranded(rig, [a, b], 900);
      if (bad.length > 0) failures.push(`offset ${off.toFixed(2)}: ${bad.join('; ')}`);
    }
    expect(failures).toEqual([]);
  });

  /**
   * The same collision with mass behind it: two five-tank columns driving
   * through each other. This is the shape a player actually produces — select
   * everything, click across the map, meet the enemy coming the other way.
   */
  it('two five-tank columns drive through each other', () => {
    const failures: string[] = [];
    for (let seed = 0; seed < 4; seed++) {
      const rig = makeRig(seed + 1);
      const units: number[] = [];
      for (let k = 0; k < 5; k++) units.push(spawnTank(rig, C(36) - k * 9, C(64) + seed * 0.2));
      for (let k = 0; k < 5; k++) units.push(spawnTank(rig, C(88) + k * 9, C(64) - seed * 0.2, P1));
      for (let k = 0; k < 5; k++) orderTo(rig, units[k], C(84), C(64));
      for (let k = 5; k < 10; k++) orderTo(rig, units[k], C(36), C(64));
      const bad = stranded(rig, units, 1500);
      if (bad.length > 0) failures.push(`seed ${seed}: ${bad.join('; ')}`);
    }
    expect(failures).toEqual([]);
  });

  /**
   * The nastiest version: the same head-on meeting inside a two-cell gate, the
   * only way through a wall. There is no room to pass side by side, so one
   * column has to spill back out of the gate and let the other through.
   */
  it('two columns meeting inside a gate untangle themselves', () => {
    const failures: string[] = [];
    for (let seed = 0; seed < 4; seed++) {
      const rig = makeRig(seed + 1);
      building(rig, 60, 0, 3, 63);
      building(rig, 60, 65, 3, MAP_CELLS - 65);
      const units: number[] = [];
      for (let k = 0; k < 4; k++) units.push(spawnTank(rig, C(50) - k * 9, C(64) + seed * 0.25));
      for (let k = 0; k < 4; k++) units.push(spawnTank(rig, C(72) + k * 9, C(64) - seed * 0.25, P1));
      for (let k = 0; k < 4; k++) orderTo(rig, units[k], C(75), C(64));
      for (let k = 4; k < 8; k++) orderTo(rig, units[k], C(48), C(64));
      const bad = stranded(rig, units, 2100);
      if (bad.length > 0) failures.push(`seed ${seed}: ${bad.join('; ')}`);
    }
    expect(failures).toEqual([]);
  });

  /**
   * A column ordered onto a spot a stationary group is already standing on.
   * Nobody is coming the other way here — the obstruction simply never moves —
   * so this is the half of the fix that is about a STALLED neighbour rather
   * than an oncoming one.
   */
  it('a column ordered into a parked crowd still finds room', () => {
    const failures: string[] = [];
    for (let seed = 0; seed < 4; seed++) {
      const rig = makeRig(seed + 1);
      for (let k = 0; k < 9; k++) {
        spawnTank(rig, C(80) + (k % 3) * 2.2, C(64) + ((k / 3) | 0) * 2.2, P1);
      }
      const units: number[] = [];
      for (let k = 0; k < 6; k++) units.push(spawnTank(rig, C(50) - k * 9, C(64) + seed * 0.3));
      for (const i of units) orderTo(rig, i, C(82), C(65));
      const bad = stranded(rig, units, 1800);
      if (bad.length > 0) failures.push(`seed ${seed}: ${bad.join('; ')}`);
    }
    expect(failures).toEqual([]);
  });
});

/* ==========================================================================
 * 2. THE MECHANISM, ISOLATED
 *
 * The tests above would also pass if a future change made units simply pass
 * THROUGH each other, or if some watchdog teleported them apart. These pin the
 * two specific properties the fix rests on, so a regression says WHICH half
 * broke instead of only that something did.
 * ========================================================================== */

describe('the queue brake can slow a unit but never stop it', () => {
  /**
   * The exact signature of the original bug: both units' speeds decaying
   * together to zero while both still hold orders and neither is near its goal.
   * One tick of that is a normal collision; a hundred consecutive ticks of it is
   * the deadlock.
   */
  it('never lets a colliding pair sit at zero speed under orders', () => {
    const rig = makeRig(7);
    const st = rig.world.store;
    const a = spawnTank(rig, C(40), C(64));
    const b = spawnTank(rig, C(70), C(64));
    orderTo(rig, a, C(70), C(64));
    orderTo(rig, b, C(40), C(64));

    let stall = 0;
    let worst = 0;
    for (let t = 0; t < 900; t++) {
      rig.step(1);
      const bothOrdered = seeksGoal(st.state[a]) && seeksGoal(st.state[b]);
      const bothFar = distToSlot(rig, a) > 12 && distToSlot(rig, b) > 12;
      const bothDead = st.speed[a] < 0.2 && st.speed[b] < 0.2;
      if (bothOrdered && bothFar && bothDead) stall++;
      else stall = 0;
      if (stall > worst) worst = stall;
    }
    // 30 ticks is a second. A head-on meeting may cost a moment of shuffling;
    // it may not cost a second of two hulls standing dead in the road.
    expect(worst).toBeLessThan(30);
  });

  /**
   * A unit braking for the goal is a different thing from a unit braking for a
   * neighbour, and the floor must not leak into the first: an arriving unit has
   * to be able to reach zero and park, or it circles its own destination.
   */
  it('still lets a lone unit brake all the way down and park', () => {
    const rig = makeRig(3);
    const st = rig.world.store;
    const a = spawnTank(rig, C(40), C(64));
    orderTo(rig, a, C(56), C(64));
    for (let t = 0; t < 600; t++) rig.step(1);
    expect(st.state[a]).toBe(UnitState.Idle);
    expect(st.speed[a]).toBeLessThan(0.1);
    expect(distToSlot(rig, a)).toBeLessThan(st.radius[a] + 2);
  });
});

describe('the head-on sidestep', () => {
  /**
   * WHY "BOTH KEEP RIGHT" AND NOT AN ID TIE-BREAK.
   *
   * Two units with opposed headings have opposed right-hand vectors, so both
   * turning to their own right sends them to opposite sides of the road. An
   * id-parity rule would do the reverse: `i` steps to its right and `j` to its
   * left, which for opposed headings is the SAME world direction, and they stay
   * locked together. This test pins the resulting geometry — the two units must
   * separate ACROSS the axis they were driving along, in opposite senses.
   */
  it('sends the two hulls to opposite sides of the road', () => {
    const rig = makeRig(11);
    const st = rig.world.store;
    const a = spawnTank(rig, C(40), C(64));
    const b = spawnTank(rig, C(70), C(64));
    orderTo(rig, a, C(70), C(64));
    orderTo(rig, b, C(40), C(64));

    // Run until they are in contact, then watch the lateral split open.
    let contact = -1;
    for (let t = 0; t < 900 && contact < 0; t++) {
      rig.step(1);
      if (Math.abs(st.posX[b] - st.posX[a]) < st.radius[a] + st.radius[b] + 0.5) contact = t;
    }
    expect(contact).toBeGreaterThan(0);
    const zA0 = st.posZ[a];
    const zB0 = st.posZ[b];
    for (let t = 0; t < 90; t++) rig.step(1);
    const dA = st.posZ[a] - zA0;
    const dB = st.posZ[b] - zB0;
    // Opposite senses across the axis of travel, and enough of it to matter.
    expect(dA * dB).toBeLessThan(0);
    expect(Math.abs(dA) + Math.abs(dB)).toBeGreaterThan(2);
  });

  /**
   * The sidestep must not become a permanent rightward drift. A unit with a
   * clear road ahead has to drive straight at it, or every march across the map
   * arrives bent.
   */
  it('does not deflect a unit that has nobody in front of it', () => {
    const rig = makeRig(5);
    const st = rig.world.store;
    const a = spawnTank(rig, C(40), C(64));
    orderTo(rig, a, C(80), C(64));
    let maxDrift = 0;
    for (let t = 0; t < 1500; t++) {
      rig.step(1);
      const drift = Math.abs(st.posZ[a] - C(64));
      if (drift > maxDrift) maxDrift = drift;
    }
    // The flow field's own 4 m cells account for a couple of metres of wander.
    expect(maxDrift).toBeLessThan(10);
    expect(distToSlot(rig, a)).toBeLessThan(st.radius[a] + 2);
  });
});

/* ==========================================================================
 * 3. DETERMINISM
 *
 * `npm run soak` asserts two AI-vs-AI replays are identical, so a tie-break
 * that drew from `s.rng` — or from anything else that varies — would desync
 * every replay in the project. The sidestep uses the unit's own right-hand
 * vector and nothing else; this is the proof.
 * ========================================================================== */

describe('determinism', () => {
  it('one seed, two runs, identical poses', () => {
    const run = (): string => {
      const rig = makeRig(99);
      const ids: number[] = [];
      for (let k = 0; k < 5; k++) ids.push(spawnTank(rig, C(36) - k * 9, C(64)));
      for (let k = 0; k < 5; k++) ids.push(spawnTank(rig, C(88) + k * 9, C(64), P1));
      for (let k = 0; k < 5; k++) orderTo(rig, ids[k], C(84), C(64));
      for (let k = 5; k < 10; k++) orderTo(rig, ids[k], C(36), C(64));
      for (let t = 0; t < 900; t++) rig.step(1);
      const st = rig.world.store;
      return ids.map((i) => `${st.posX[i].toFixed(6)},${st.posZ[i].toFixed(6)},${st.yaw[i].toFixed(6)}`)
        .join('|');
    };
    expect(run()).toBe(run());
  });
});

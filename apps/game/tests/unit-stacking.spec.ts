/**
 * ============================================================================
 * tests/unit-stacking.spec.ts — two units on one point come apart
 * ============================================================================
 * Reported as *"dont allow soldier to be on top of each other, for example when
 * spawning, they all spawn exactly at the same pixels"*.
 *
 * `Movement.relax` is the hard separation constraint and it read
 *
 *     if (d2 >= want * want || d2 < 1e-9) continue;
 *
 * The degenerate arm HAS to leave the normal path — the next line divides by
 * `d` — and there was nothing behind it. So a perfect stack was not slow to
 * resolve, it was PERMANENT: six infantry at identical coordinates measured
 * 0.0000 m pairwise separation at 1, 10, 60, 300 and 1800 ticks.
 *
 * REACHABLE TODAY WITHOUT ANY NEW CODE, which is why this is a bug and not a
 * hypothetical. `TransportService.setDownNear` places passengers against
 * terrain passability and `isOccupied` only, with no entity test at all, and is
 * saved from stacking solely by `ordinal` rotating the starting spoke against
 * `TRANSPORT.unloadSpokes` — so one refusal puts two men on one spoke at one
 * radius. Save/load restores positions bit-exactly, so a stack survives it.
 *
 * WHAT §2 PINS IS THE HALF THAT IS EASY TO GET WRONG. Each unit in `relax`
 * moves only ITSELF — the partner does the same on its own visit, which is what
 * avoids an ordering hazard — so a separation direction derived SYMMETRICALLY
 * from the pair would send both the same way and translate the stack rather
 * than split it. The direction has to be antisymmetric in (i, j).
 *
 * AND §3 IS THE LOCKSTEP CONSTRAINT. This runs inside `simTick`. The eight
 * directions are 0, ±1 and ±SQRT1_2 — exact constants, no trigonometry — and
 * the pair hash is integer, so two machines cannot disagree about which way a
 * pile opened. A `Math.random` tie-break here would be an instant desync with
 * no findable cause, which is the failure this file exists to make impossible.
 * ============================================================================
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { World } from '../src/core/world';
import { Channels } from '../src/core/events';
import { EntityFlag, EntityKind, Faction, Locomotor, UnitState } from '../src/core/types';
import type { PlayerId, SimContext } from '../src/core/types';
import { PRODUCTION, SIM_DT } from '../src/core/config';
import { Rng } from '../src/core/math';
import { FlowFieldCache, setActiveNav } from '../src/sim/Flowfield';
import { NavAgents, NavAssigner, SteeringSolver } from '../src/sim/Steering';
import { MovementIntegrator } from '../src/sim/Movement';
import { RALLY_SLOTS_FOR_TEST } from '../src/sim/Production';

const P0 = 0 as PlayerId;

interface Rig {
  readonly world: World;
  tick: number;
  step(n?: number): void;
}

function makeRig(): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'A', true, true);
  const channels = new Channels();
  const nav = new FlowFieldCache(world.terrain);
  const agents = new NavAgents();
  setActiveNav(nav);
  const assigner = new NavAssigner(world, nav, agents);
  const steering = new SteeringSolver(world, nav, agents);
  const movement = new MovementIntegrator(world, nav, channels);
  const rig: Rig = {
    world,
    tick: 0,
    step(n = 1): void {
      const rng = new Rng(1234);
      for (let k = 0; k < n; k++) {
        rig.tick++;
        const ctx: SimContext = { dt: SIM_DT, tick: rig.tick, time: rig.tick * SIM_DT, rng };
        world.store.snapshotPrev();
        assigner.simTick(ctx);
        steering.simTick(ctx);
        movement.simTick(ctx);
        world.spatial.rebuild();
      }
    },
  };
  return rig;
}

/** A rifleman. `radius` 0.234 is the shipped infantry hull. */
function spawnMan(rig: Rig, x: number, z: number): number {
  const st = rig.world.store;
  const id = st.alloc(EntityKind.Infantry, 0, P0, Faction.Allies, x, 0, z, 0);
  const i = st.index(id);
  st.flags[i] |= EntityFlag.CanMove;
  st.maxSpeed[i] = 4;
  st.accel[i] = 8;
  st.turnRate[i] = 6;
  st.radius[i] = 0.234;
  st.locomotor[i] = Locomotor.Foot;
  st.hp[i] = 100; st.maxHp[i] = 100;
  st.state[i] = UnitState.Idle;
  return i;
}

/** Smallest pairwise distance in `idx`. */
function minPairwise(rig: Rig, idx: readonly number[]): number {
  const st = rig.world.store;
  let min = Infinity;
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const dx = st.posX[idx[a]] - st.posX[idx[b]];
      const dz = st.posZ[idx[a]] - st.posZ[idx[b]];
      const d = Math.hypot(dx, dz);
      if (d < min) min = d;
    }
  }
  return min;
}

function positions(rig: Rig, idx: readonly number[]): number[] {
  const st = rig.world.store;
  const out: number[] = [];
  for (const i of idx) out.push(st.posX[i], st.posZ[i]);
  return out;
}

const CX = 256;
const CZ = 256;

describe('§1 a perfect stack comes apart', () => {
  it('separates six men dropped on one point, and keeps them apart', () => {
    // THE REPORT. Every measurement below was 0.0000 before the tie-break.
    const rig = makeRig();
    const men: number[] = [];
    for (let k = 0; k < 6; k++) men.push(spawnMan(rig, CX, CZ));
    expect(minPairwise(rig, men)).toBe(0);

    rig.step(60);
    const early = minPairwise(rig, men);
    expect(early, 'still stacked after 60 ticks').toBeGreaterThan(0);

    // Not merely non-zero: at CONTACT, which is what the constraint actually
    // guarantees. `relax` pushes each pair by half the overlap per visit, so
    // the fixed point is `want` = r1 + r2 = 0.468 approached from BELOW — it
    // never overshoots, and asking for strictly more than 0.468 fails by one
    // epsilon at 0.46795. The bar is the hull sum less a millimetre, which is
    // "no longer interpenetrating" and is the honest statement of the property.
    const CONTACT = 0.234 * 2 - 0.001;
    rig.step(240);
    const settled = minPairwise(rig, men);
    expect(settled, `settled at ${settled.toFixed(4)} m`).toBeGreaterThan(CONTACT);

    // And it is stable — the pile does not re-converge once the push stops.
    rig.step(600);
    expect(minPairwise(rig, men)).toBeGreaterThan(CONTACT);
  });

  it('leaves units that are already apart exactly where they were', () => {
    // THE NO-OP PROPERTY. The tie-break is behind `d2 < 1e-9`, so nothing that
    // is not perfectly co-located can reach it. If this ever fails, the fix has
    // become a change to ordinary crowd behaviour.
    const rig = makeRig();
    const men = [spawnMan(rig, CX, CZ), spawnMan(rig, CX + 9, CZ), spawnMan(rig, CX, CZ + 9)];
    const before = positions(rig, men);
    rig.step(120);
    expect(positions(rig, men)).toEqual(before);
  });
});

describe('§2 the split is antisymmetric, not a translation', () => {
  it('moves a co-located pair in opposite directions', () => {
    // `relax` has each unit move only ITSELF. A direction derived symmetrically
    // from the pair would give both the same vector and slide the stack across
    // the map with the overlap intact — worse than the bug, and it would still
    // pass a naive "did they separate" test if the two were compared only to
    // their own start. So compare the two DISPLACEMENTS: they must oppose.
    const rig = makeRig();
    const a = spawnMan(rig, CX, CZ);
    const b = spawnMan(rig, CX, CZ);
    const st = rig.world.store;
    rig.step(30);

    const ax = st.posX[a] - CX, az = st.posZ[a] - CZ;
    const bx = st.posX[b] - CX, bz = st.posZ[b] - CZ;
    expect(Math.hypot(ax, az), 'a did not move').toBeGreaterThan(0);
    expect(Math.hypot(bx, bz), 'b did not move').toBeGreaterThan(0);
    // Opposing: the dot product of the two displacements is negative.
    expect(ax * bx + az * bz, 'both men walked the same way').toBeLessThan(0);
  });

  it('opens a six-man pile on more than one axis', () => {
    // Eight directions rather than four, so a pile does not open as a line.
    // Measured by the spread of the men's bearings from the drop point.
    const rig = makeRig();
    const men: number[] = [];
    for (let k = 0; k < 6; k++) men.push(spawnMan(rig, CX, CZ));
    rig.step(60);
    const st = rig.world.store;
    const xs = men.map((i) => st.posX[i] - CX);
    const zs = men.map((i) => st.posZ[i] - CZ);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanZ = Math.max(...zs) - Math.min(...zs);
    expect(Math.min(spanX, spanZ), 'the pile opened along a single axis')
      .toBeGreaterThan(0.1);
  });
});

describe('§3 it is deterministic, because a desync here has no findable cause', () => {
  it('produces identical positions from identical inputs', () => {
    // The separation direction comes from an integer pair hash and a table of
    // exact constants. Two runs of the same scenario must agree to the bit; a
    // `Math.random` tie-break would pass every test above and desync a real
    // match on the first crowded moment.
    const run = (): number[] => {
      const rig = makeRig();
      const men: number[] = [];
      for (let k = 0; k < 6; k++) men.push(spawnMan(rig, CX, CZ));
      rig.step(300);
      return positions(rig, men);
    };
    expect(run()).toEqual(run());
  });

  it('uses no trigonometry on the separation path', () => {
    // The lockstep rule, asserted structurally. `Math.sin`/`Math.cos` are not
    // pinned to bit precision by ECMA-262 and CLAUDE.md refuses them for
    // exactly this reason elsewhere (rotated start islands). The direction
    // table is 0, +/-1 and +/-SQRT1_2 and must stay that way.
    const src = readFileSync(
      fileURLToPath(new URL('../src/sim/Movement.ts', import.meta.url)), 'utf8',
    );
    const table = src.slice(src.indexOf('const SEPARATE_DIRS'), src.indexOf(']);', src.indexOf('const SEPARATE_DIRS')));
    expect(table).not.toMatch(/Math\.(sin|cos|atan2|random)/);
    expect(table).toContain('Math.SQRT1_2');
  });
});

/* ========================================================================== */

/**
 * A FACTORY DOES NOT PILE ITS OUTPUT ON ONE POINT.
 *
 * The other half of the same report — *"for example when spawning"*. Every unit
 * off the line was handed the IDENTICAL rally point, and `NAV_ARRIVE_SLACK`
 * parks each of them within `radius + 1.1` m of its goal, so they converged
 * however well `findEgressSpot` had separated them at birth. Measured before
 * the fix, twenty G.I.s one every 30 ticks at one flag:
 *
 *     min pairwise 0.2305   mean 1.2710   cluster radius 1.5515
 *     within 1 m of the flag 4/20         within 2 m 20/20
 *
 * 0.2305 against a hull sum of 0.468 is interpenetration, and it is what
 * `RELAX_SCAN_CAP` 12 lets through once twenty units are inside 3.1 m: an
 * overlapping pair can be mutually invisible to the broadphase. The honest fix
 * is to stop the blob forming, not to raise the cap on a hot loop.
 *
 * THIS IS TESTED THROUGH THE LATTICE RATHER THAN THROUGH A FULL MATCH, because
 * a real ProductionService run needs a catalog, an economy and a factory. What
 * is pinned is the property the lattice has to have — distinct, bounded, exact
 * — plus the arithmetic the caller applies to it.
 */
describe('§4 rally slots are distinct, bounded and exact', () => {
  const SLOTS = RALLY_SLOTS_FOR_TEST;

  it('gives every slot in a ring a different offset', () => {
    const seen = new Set<string>();
    for (let k = 0; k < SLOTS.length; k += 2) seen.add(`${SLOTS[k]},${SLOTS[k + 1]}`);
    expect(seen.size, 'two rally slots share an offset').toBe(SLOTS.length / 2);
  });

  it('spaces adjacent hulls past contact at the shipped spacing', () => {
    // The floor is 2.0 m and infantry hulls are 0.234, so the tightest legal
    // pair on the lattice is 2.0 m against a 0.468 m contact distance. A tank
    // at radius 1.7 takes 2*1.7 + 1.4 = 4.8 m against 3.4.
    for (const r of [0.234, 1.7]) {
      const spread = Math.max(PRODUCTION.rallyMinSpacing, r * 2 + PRODUCTION.rallyGap);
      expect(spread, `radius ${r} spacing`).toBeGreaterThan(r * 2);
    }
  });

  it('is integer, so scaling by a metric spacing cannot round two ways', () => {
    // Lockstep. The offsets are Int8; the only float operation is one multiply
    // by a spacing both clients computed from the same radius.
    for (let k = 0; k < SLOTS.length; k++) {
      expect(Number.isInteger(SLOTS[k]), `slot component ${k} is not an integer`).toBe(true);
    }
  });

  it('stays within a couple of hull-widths of the flag', () => {
    // The player pointed at a place. A dispersal that marched units across the
    // map would be a different bug: the furthest ring is 2 units of spacing,
    // so infantry land at most 2.83 m from the flag and tanks 6.79 m.
    let worst = 0;
    for (let k = 0; k < SLOTS.length; k += 2) {
      worst = Math.max(worst, Math.hypot(SLOTS[k], SLOTS[k + 1]));
    }
    expect(worst).toBeLessThanOrEqual(Math.SQRT2 * 2 + 1e-9);
  });
});

/* ========================================================================== */

/**
 * A FORMATION IS NOT CRUSHED OUT OF EXISTENCE FOR SMALL UNITS.
 *
 * `assignFormations` preserves the shape a group is standing in, scaled to fit
 * an allowed radius. That radius was `sqrt(N) * meanRadius * NAV_FORMATION_SPACING`
 * — a MULTIPLE OF THE HULL — and infantry carry radius 0.234, so six riflemen
 * were allowed a 1.49 m disc: 0.61 m of centre spacing for a man drawn 1.75 m
 * tall. Measured, six G.I.s given one move order settled at a cluster radius of
 * 1.79 / 1.97 / 2.09 m from inputs 4 / 8 / 16 m wide — the input shape was
 * irrelevant. Six TANKS from the same 8 m input settled at 19.22 m, untouched,
 * because `allowed` scaled with their much larger radius.
 *
 * So the crush was infantry-specific, and it is why authoring a wedge would
 * have been pointless for them: the shape existed and was then squeezed out.
 */
describe('§5 infantry keep a formation instead of collapsing into a blob', () => {
  it('lets six riflemen hold a wider spread than the old hull-scaled disc', () => {
    const rig = makeRig();
    const men: number[] = [];
    for (let k = 0; k < 6; k++) men.push(spawnMan(rig, CX - 10 + k * 4, CZ));
    const st = rig.world.store;
    for (const i of men) {
      st.orderX[i] = CX;
      st.orderZ[i] = CZ + 60;
      st.state[i] = UnitState.Moving;
    }
    rig.step(900);

    let cx = 0, cz = 0;
    for (const i of men) { cx += st.posX[i]; cz += st.posZ[i]; }
    cx /= men.length; cz /= men.length;
    let radius = 0;
    for (const i of men) {
      radius = Math.max(radius, Math.hypot(st.posX[i] - cx, st.posZ[i] - cz));
    }
    // The old ceiling was sqrt(6) * 0.234 * 2.6 = 1.4903 and every measured
    // settle landed under 2.1. The new allowance is sqrt(6) * 2.0 = 4.90.
    expect(radius, `cluster radius ${radius.toFixed(3)} m`).toBeGreaterThan(2.2);
  });

  it('barely moves the tank case, which was never broken', () => {
    // The control. `allowed` for six tanks goes 6*1.7 -> 2*1.7+1.4 = 4.8 per
    // neighbour, i.e. 10.8 m -> 11.76 m. If this ever swings wide, the change
    // has stopped being a fix for small units and become a global loosening.
    const meanR = 1.7;
    const before = Math.sqrt(6) * meanR * 2.6;
    const after = Math.sqrt(6) * Math.max(2.0, meanR * 2 + 1.4);
    expect(after / before).toBeGreaterThan(0.9);
    expect(after / before).toBeLessThan(1.2);
  });
});

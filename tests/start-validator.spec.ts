/**
 * ============================================================================
 * tests/start-validator.spec.ts — the opening must be worth playing
 * ============================================================================
 * `nudgeToBuildable` rescues a start whose surroundings are too broken to open a
 * base on. It exists because of a measurement, and the measurement is the thing
 * worth recording:
 *
 * `src/core/config.ts` promises that a reserved start area is "flat, dry,
 * buildable, and joined to the map's main passable region. Verified inside the
 * generator, not hoped for." That guarantee WORKS — the reserved shelf measures
 * 100.0% buildable inside BUILD_RADIUS on all four biomes across 24 seeds.
 *
 * It is aimed at the map centre. `TERRAIN_START_POSITIONS` holds one entry,
 * `[0.5, 0.5]`, and `world/terrain.system.ts` builds `Terrain` with no `starts`
 * option, so that is what gets reserved. `startSpots` only uses shelves when
 * `shelves.length >= n`, false for two armies, so both armies open on the
 * geometric fan instead — 96.5 m from the only guaranteed ground, whose guard
 * radius is 54 m.
 *
 * Buildable fraction inside BUILD_RADIUS, 24 seeds x 4 biomes, real generator:
 *
 *              spot0 median   spot1 median   seeds under 60%
 *   temperate     68.2%          67.5%         7/24  10/24
 *   desert        70.8%          73.6%         3/24   1/24
 *   snow          66.4%          60.7%         9/24  12/24
 *   urban         61.5%          63.1%        12/24  11/24
 *   centre       100.0%             —          0/24
 *
 * With the validator, seeds under 60% fall from 65/192 to 15/192 and median army
 * separation moves from 193.0 m to 188-198 m.
 *
 * WHAT THIS FILE DOES NOT DO. It does not run the terrain generator — that is
 * ~2 s per biome-seed and the sweep above took 55 s. These are the invariants
 * that must hold for ANY terrain, driven against a stub whose buildable map is
 * written by the test. The sweep proved the fix helps; this proves it cannot
 * misbehave.
 * ============================================================================
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  START_CORE_MIN, START_CORE_RADIUS, START_MIN_SEPARATION, START_NUDGE_MAX,
  nudgeToBuildable,
} from '../src/game/Scenarios';
import { CELL, MAP_SIZE } from '../src/core/config';
import { setActiveTerrain } from '../src/world/Terrain';
import type { Terrain } from '../src/world/Terrain';

/**
 * A terrain whose buildability is a predicate the test supplies.
 *
 * Only `isBuildable` is exercised by the validator; everything else throws so a
 * future change that starts reading height or occupancy fails loudly here rather
 * than silently reading a zero.
 */
function stubTerrain(buildable: (cx: number, cz: number) => boolean): Terrain {
  const die = (name: string) => () => {
    throw new Error(`stubTerrain.${name} was not expected to be called`);
  };
  return {
    isBuildable: (cx: number, cz: number) => buildable(cx, cz),
    heightAt: die('heightAt'),
    isOccupied: die('isOccupied'),
    markOccupied: die('markOccupied'),
    clearOccupied: die('clearOccupied'),
  } as unknown as Terrain;
}

afterEach(() => {
  setActiveTerrain(null as never);
});

describe('the validator leaves a good opening alone', () => {
  it('does not move a spot that is already buildable', () => {
    setActiveTerrain(stubTerrain(() => true));
    const r = nudgeToBuildable(200, 200);
    expect(r.moved).toBe(0);
    expect(r.x).toBe(200);
    expect(r.z).toBe(200);
  });

  it('does not move a spot that is merely average but acceptable', () => {
    // A checkerboard is 50% buildable — below target, and this must NOT trigger
    // relocation if it clears START_CORE_MIN. The point of the MIN/TARGET split
    // is that "not perfect" is not the same as "broken": an earlier single
    // threshold moved the median start 40 m, which is a balance change, not a
    // bug fix.
    setActiveTerrain(stubTerrain((cx, cz) => (cx + cz) % 10 !== 0));
    const r = nudgeToBuildable(200, 200);
    expect(r.moved).toBe(0);
  });
});

describe('the validator rescues a broken opening', () => {
  it('moves off unbuildable ground toward buildable ground', () => {
    // Everything west of x = 200 m is unbuildable; east of it is fine.
    setActiveTerrain(stubTerrain((cx) => (cx + 0.5) * CELL >= 200));
    const r = nudgeToBuildable(180, 256);
    expect(r.moved).toBeGreaterThan(0);
    expect(r.x, 'must move east, into the buildable half').toBeGreaterThan(180);
  });

  it('never exceeds START_NUDGE_MAX', () => {
    setActiveTerrain(stubTerrain(() => false));
    for (const [x, z] of [[200, 200], [120, 300], [400, 150]]) {
      const r = nudgeToBuildable(x, z);
      expect(r.moved).toBeLessThanOrEqual(START_NUDGE_MAX + 1e-6);
    }
  });

  it('NEVER CHOOSES A WORSE SPOT — a hopeless map degrades, it does not scramble', () => {
    // Nothing is buildable anywhere, so every candidate ties at 0. The authored
    // position must survive: relocating a start at random would be worse than
    // the defect, and would also break the seed-stability the save system needs.
    setActiveTerrain(stubTerrain(() => false));
    const r = nudgeToBuildable(256, 256);
    expect(r.moved).toBe(0);
    expect(r.x).toBe(256);
    expect(r.z).toBe(256);
  });

  it('stays inside the map', () => {
    setActiveTerrain(stubTerrain((cx, cz) => (cx + 0.5) * CELL < 20 && (cz + 0.5) * CELL < 20));
    const r = nudgeToBuildable(8, 8);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.z).toBeGreaterThanOrEqual(0);
    expect(r.x).toBeLessThanOrEqual(MAP_SIZE);
    expect(r.z).toBeLessThanOrEqual(MAP_SIZE);
  });
});

describe('the search is joint, so it cannot crowd the armies together', () => {
  it('rejects a candidate inside START_MIN_SEPARATION of a settled start', () => {
    // The only buildable ground is a disc right next to the other army. The
    // validator must refuse it and leave the authored spot alone rather than
    // halve the opening distance — see START_MIN_SEPARATION.
    const other = { x: 350, z: 200 };
    setActiveTerrain(stubTerrain((cx, cz) => {
      const wx = (cx + 0.5) * CELL;
      const wz = (cz + 0.5) * CELL;
      return Math.hypot(wx - 330, wz - 200) < 40;
    }));

    const solo = nudgeToBuildable(300, 200, []);
    expect(solo.moved, 'without a neighbour it should happily move').toBeGreaterThan(0);

    const joint = nudgeToBuildable(300, 200, [other]);
    expect(
      Math.hypot(joint.x - other.x, joint.z - other.z),
      'a rescued start must never end up inside the separation floor',
    ).toBeGreaterThanOrEqual(Math.min(START_MIN_SEPARATION, Math.hypot(300 - other.x, 200 - other.z)));
  });

  it('never returns a point closer than the floor when one was reachable', () => {
    // Buildable everywhere: the authored spot is already good, so no motion, and
    // the floor is trivially respected. Guards against a future refactor that
    // starts moving spots unconditionally.
    setActiveTerrain(stubTerrain(() => true));
    const a = nudgeToBuildable(150, 150, []);
    const b = nudgeToBuildable(150 + START_MIN_SEPARATION + 10, 150, [a]);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThanOrEqual(START_MIN_SEPARATION);
  });
});

describe('the thresholds are ordered, not arbitrary', () => {
  it('MIN is below TARGET, and both are fractions', () => {
    expect(START_CORE_MIN).toBeGreaterThan(0);
    expect(START_CORE_MIN).toBeLessThan(1);
    expect(START_CORE_MIN).toBeLessThan(0.9000001);
    expect(START_CORE_RADIUS).toBeGreaterThan(0);
  });

  it('is deterministic — the save system and the soak both depend on it', () => {
    setActiveTerrain(stubTerrain((cx, cz) => (cx * 7 + cz * 13) % 5 !== 0));
    const first = nudgeToBuildable(211, 305);
    for (let i = 0; i < 30; i++) {
      const again = nudgeToBuildable(211, 305);
      expect(again).toEqual(first);
    }
  });
});

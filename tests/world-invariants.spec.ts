/**
 * ============================================================================
 * tests/world-invariants.spec.ts — properties nothing in particular owns
 * ============================================================================
 * "Having so much regressions means we are missing testables in tests, which
 *  means coverage getting lower... why?"
 *
 * The test COUNT has been going up, not down. The gap is a KIND of test.
 *
 * Almost every case in this suite is a characterisation test: it was written
 * alongside a change, and it pins the thing that change touched. That is good
 * and it catches a great deal. What it structurally cannot catch is a property
 * that belongs to NO SINGLE FEATURE — because no feature's test file is the
 * obvious home for it, so nobody writes it, so it is only ever discovered by
 * a player.
 *
 * TWO WORKED EXAMPLES FROM ONE DAY, both reported by the user:
 *
 *   1. `tests/start-shelves.spec.ts` had seven passing cases about start areas.
 *      Every one measured the QUALITY OF THE GROUND at a start. When a change
 *      moved the starts themselves 96 m, all seven stayed green — because
 *      "the two armies open ~193 m apart" was owned by nobody.
 *
 *   2. Base layout has tests for progression gating, for clearance, for
 *      rotation and for spawn safety. None of them asserts THAT NO TWO
 *      BUILDINGS OVERLAP, so a relocation path inside `spawnBuilding` could
 *      quietly stack two structures on one square and every suite passed.
 *
 * Both are the same shape: the feature tests describe the features, and the
 * defect lives in between them.
 *
 * SO THIS FILE IS DELIBERATELY NOT ABOUT A FEATURE. Every case here is a
 * property of a FINISHED WORLD that must hold no matter which subsystem
 * changed — the kind of assertion that has no natural owner and therefore needs
 * an unnatural home. It is expected to grow whenever a regression escapes:
 * a defect that reaches a player is, by definition, one this file was missing.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { World } from '../src/core/world';
import { Terrain } from '../src/world/Terrain';
import { BIOME_NAMES } from '../src/world/Biomes';
import { EntityFlag, EntityKind } from '../src/core/types';
import { CELL, MAP_SIZE } from '../src/core/config';
import { hashOnly } from '../src/game/Checksum';
import { SKIRMISH_START_OFFSETS, buildScenario, startSpots } from '../src/game/Scenarios';

const CX = MAP_SIZE * 0.5;
const CZ = MAP_SIZE * 0.5;

/**
 * The world every case here inspects: a real generated map, really populated.
 *
 * THE CONSTRUCTOR ALREADY GENERATED. This used to call `terrain.generate()`
 * after it. `Terrain`'s constructor ends in `adopt(fields)` or `generate()`, and
 * nothing here passes prewarmed `fields`, so every map was built twice —
 * heightfield, ramp carver, splat and all 64 chunk meshes, for a result the
 * second pass could only reproduce. `generate()` documents itself as pure, and
 * it is: measured across four biomes x two seeds x with-and-without reserved
 * starts, a second call leaves `height`, `wallUp`, `wallTop`, `surface`,
 * `passGrid`, `buildGrid`, `startLocations()` and `startReport()`
 * byte-identical. So the call was cost with no effect, and dropping it changes
 * no number this file asserts.
 */
function buildWorld(seed: number, biome: string): World {
  const world = new World();
  const scene = new THREE.Scene();
  world.terrain = new Terrain({
    scene, seed, biome: biome as never, anisotropy: 1,
    // THE SAME SHELVES `src/world/terrain.system.ts` RESERVES. A test world
    // built without them is not the world the game generates, and the start
    // guarantee it is checking would legitimately not hold.
    starts: [
      { x: CX, z: CZ },
      ...SKIRMISH_START_OFFSETS.map((o) => ({ x: CX + o.dx, z: CZ + o.dz })),
    ],
  });
  return world;
}

/* ==========================================================================
 * ONE GENERATION PER BIOME AT THE SHARED SEED
 *
 * Two cases below asked different questions of the IDENTICAL four maps — the
 * NaN sweep over the store and the "a start is buildable" check both built
 * `buildWorld(4242, biome)` for every biome. That is four generations bought
 * twice, on top of the doubling `buildWorld` itself used to carry, in a file
 * that already sat near the 120 s `testTimeout` and timed out for real under
 * concurrent load. Same shape as `trackScan()` in `tests/reachability.spec.ts`,
 * and this mirrors it.
 *
 * NO CASE CAN CORRUPT ANOTHER'S WORLD, because no case is handed a world. The
 * cache holds plain strings; each `World` is unreachable before the first
 * assertion runs, so nothing depends on which `it()` triggered the scan.
 *
 * THE OTHER SEEDS ARE DELIBERATELY NOT CACHED. `buildScenario` MUTATES the
 * world it is given, so the overlap sweep cannot share one; and the determinism
 * cases have to generate the same seed twice for real, or they compare an object
 * with itself and prove nothing. Both are correctness, not oversight.
 *
 * Computed lazily rather than in `beforeAll` for the reason `reachability.spec`
 * records: a hook carries the same clock as a test, so moving the work there
 * would move the timeout rather than remove it.
 * ========================================================================== */

/** The seed both read-only sweeps below run on. */
const SHARED_SEED = 4242;

interface FreshCase {
  biome: string;
  /** One entry per store column that came out non-finite on a live slot. */
  nonFinite: string[];
  /** One entry per two-army start cell a base could not be placed on. */
  unbuildableStarts: string[];
}

let freshCases: FreshCase[] | null = null;

function freshScan(): FreshCase[] {
  if (freshCases !== null) return freshCases;
  const out: FreshCase[] = [];
  for (const biome of BIOME_NAMES) {
    const world = buildWorld(SHARED_SEED, biome);
    const s = world.store;
    const columns: ReadonlyArray<readonly [string, Float32Array]> = [
      ['posX', s.posX], ['posY', s.posY], ['posZ', s.posZ],
      ['yaw', s.yaw], ['turretYaw', s.turretYaw],
      ['hp', s.hp], ['velX', s.velX], ['velZ', s.velZ],
      ['orderX', s.orderX], ['orderZ', s.orderZ],
    ];
    const nonFinite: string[] = [];
    for (let a = 0; a < s.aliveCount; a++) {
      const i = s.alive[a];
      for (const [name, col] of columns) {
        if (!Number.isFinite(col[i])) nonFinite.push(`${biome}: ${name} on slot ${i}`);
      }
    }

    const unbuildableStarts: string[] = [];
    for (const spot of startSpots(CX, CZ, 2)) {
      const cx = Math.floor(spot.x / CELL);
      const cz = Math.floor(spot.z / CELL);
      if (!world.terrain.isBuildable(cx, cz)) {
        unbuildableStarts.push(`${biome} start ${cx},${cz}`);
      }
    }

    out.push({ biome, nonFinite, unbuildableStarts });
  }
  freshCases = out;
  return out;
}

/** Axis-aligned footprint rectangle of a building slot, in metres. */
function footprintRect(
  s: World['store'], i: number,
): { x0: number; z0: number; x1: number; z1: number } {
  const hw = (s.footprintW[i] * CELL) / 2;
  const hh = (s.footprintH[i] * CELL) / 2;
  return {
    x0: s.posX[i] - hw, x1: s.posX[i] + hw,
    z0: s.posZ[i] - hh, z1: s.posZ[i] + hh,
  };
}

/** Metres of overlap between two rectangles, 0 when they only touch. */
function overlapArea(
  a: ReturnType<typeof footprintRect>, b: ReturnType<typeof footprintRect>,
): number {
  // A small epsilon, because two walls in a run are SUPPOSED to share an edge
  // and floating point puts that edge a nanometre inside sometimes.
  const eps = 1e-6;
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) - eps;
  const h = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) - eps;
  return w > 0 && h > 0 ? w * h : 0;
}

/* ========================================================================== */

describe('no two structures stand on the same ground', () => {
  /**
   * "Auto placement of pre seeded construction yielded this, placing building
   *  on top of each other" — reported with a screenshot of two Soviet
   *  structures interpenetrating.
   *
   * There is no single feature this belongs to, which is exactly why it was
   * never asserted. Progression gating, clearance, rotation and spawn safety
   * all have suites; "the base is not stacked" had none.
   */
  it('holds for every scenario base, across seeds and biomes', () => {
    const failures: string[] = [];
    for (const biome of BIOME_NAMES) {
      for (const seed of [1, 7, 4242, 0x51c0de]) {
        const world = buildWorld(seed, biome);
        world.addPlayer(0 as never, 'A', true, true);
        world.addPlayer(1 as never, 'B', false, false);
        // THE SHIPPING PATH. `start: 'base'` is the pre-seeded opening the
        // report is about — the one that "yielded this, placing building on top
        // of each other".
        buildScenario(world, 'skirmish', seed, { start: 'base' });

        const s = world.store;
        const rects: { i: number; r: ReturnType<typeof footprintRect> }[] = [];
        for (let a = 0; a < s.aliveCount; a++) {
          const i = s.alive[a];
          if (s.kind[i] !== EntityKind.Building) continue;
          if (s.footprintW[i] <= 0) continue;
          rects.push({ i, r: footprintRect(s, i) });
        }
        for (let x = 0; x < rects.length; x++) {
          for (let y = x + 1; y < rects.length; y++) {
            const area = overlapArea(rects[x]!.r, rects[y]!.r);
            if (area > 0.5) {
              failures.push(
                `${biome}/${seed}: slots ${rects[x]!.i} and ${rects[y]!.i} `
                + `overlap by ${area.toFixed(1)} m2`,
              );
            }
          }
        }
      }
    }
    expect(failures.join('\n'), `${failures.length} overlapping pairs`).toBe('');
  });
});

/* ========================================================================== */

describe('the two armies open a real distance apart', () => {
  /**
   * "enemies base is like 10 meters from mine, thats kinda weird."
   *
   * A regression introduced the same day, and the reason it escaped is the
   * whole subject of this file: seven start-area cases were green throughout,
   * because every one of them measured the ground AT a start rather than where
   * the starts were.
   */
  it('is at least 170 m, on the authored two-army diagonal', () => {
    const spots = startSpots(CX, CZ, 2);
    const d = Math.hypot(spots[0]!.x - spots[1]!.x, spots[0]!.z - spots[1]!.z);
    expect(d, `armies opened ${d.toFixed(1)} m apart`).toBeGreaterThan(170);
  });

  it('holds for three and four armies too', () => {
    // No shipping map offers these, which is exactly why they are the ones
    // that would rot unnoticed.
    for (const n of [3, 4]) {
      const spots = startSpots(CX, CZ, n);
      expect(spots).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const d = Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z);
          expect(d, `${n} armies: ${i} and ${j} are ${d.toFixed(1)} m apart`)
            .toBeGreaterThan(60);
        }
      }
    }
  });

  it('keeps every army inside the map', () => {
    for (const n of [2, 3, 4]) {
      for (const spot of startSpots(CX, CZ, n)) {
        expect(spot.x).toBeGreaterThan(0);
        expect(spot.x).toBeLessThan(MAP_SIZE);
        expect(spot.z).toBeGreaterThan(0);
        expect(spot.z).toBeLessThan(MAP_SIZE);
      }
    }
  });
});

/* ========================================================================== */

describe('nothing in the store is NaN', () => {
  /**
   * A NaN in a position column becomes a NaN in an instance matrix, and
   * CLAUDE.md records what that did once: the bloom pass spread it through its
   * whole mip chain and every pixel went dead while stats cheerfully reported
   * 285 draws.
   *
   * Two separate NaN holes were found and fixed by hand this week — one in
   * `clampWorld` reaching a nav goal, one in a faction index. Neither had a
   * test. This is the one that would have caught both.
   */
  it('holds for a freshly generated world', () => {
    const bad = freshScan().flatMap((c) => c.nonFinite);
    expect(bad, `\n${bad.join('\n')}\n`).toEqual([]);
    expect(freshScan().length, 'biomes measured').toBe(BIOME_NAMES.length);
  });

  it('holds for terrain heights across the whole map', () => {
    for (const biome of BIOME_NAMES) {
      const world = buildWorld(7, biome);
      for (let z = 0; z <= MAP_SIZE; z += 37) {
        for (let x = 0; x <= MAP_SIZE; x += 37) {
          expect(Number.isFinite(world.terrain.heightAt(x, z)), `${biome} at ${x},${z}`)
            .toBe(true);
        }
      }
    }
  });
});

/* ========================================================================== */

describe('a seed produces the same world twice', () => {
  /**
   * The property the whole replay feature rests on, asserted directly rather
   * than only through a replay. If this ever fails, every replay is worthless
   * and no amount of command-stream correctness will save it.
   */
  it('generates an identical heightfield for the same seed and biome', () => {
    for (const biome of BIOME_NAMES) {
      const a = buildWorld(0x51c0de, biome);
      const b = buildWorld(0x51c0de, biome);
      for (let z = 0; z <= MAP_SIZE; z += 53) {
        for (let x = 0; x <= MAP_SIZE; x += 53) {
          expect(a.terrain.heightAt(x, z), `${biome} at ${x},${z}`)
            .toBe(b.terrain.heightAt(x, z));
        }
      }
    }
  });

  it('hashes two identically-built worlds the same', () => {
    const a = buildWorld(99, 'temperate');
    const b = buildWorld(99, 'temperate');
    expect(hashOnly(a)).toBe(hashOnly(b));
  });

  it('hashes two DIFFERENT seeds differently, so the check is not vacuous', () => {
    // Without this, a checksum that always returned the same constant would
    // make the case above pass forever.
    const a = buildWorld(1, 'temperate');
    const b = buildWorld(2, 'temperate');
    const sampleA: number[] = [];
    const sampleB: number[] = [];
    for (let x = 0; x <= MAP_SIZE; x += 61) {
      sampleA.push(a.terrain.heightAt(x, CZ));
      sampleB.push(b.terrain.heightAt(x, CZ));
    }
    expect(sampleA).not.toEqual(sampleB);
  });
});

/* ========================================================================== */

describe('every start is somewhere an army can actually operate', () => {
  it('is buildable and connected on every biome', () => {
    const bad = freshScan().flatMap((c) => c.unbuildableStarts);
    expect(bad, `\n${bad.join('\n')}\n`).toEqual([]);
    expect(freshScan().length, 'biomes measured').toBe(BIOME_NAMES.length);
  });
});

/* ========================================================================== */

describe('the flags a dead entity leaves behind', () => {
  /**
   * `EntityFlag.Burning` was once never cleared and buildings burned forever;
   * `BeingRepaired` was once set by a path that never cleared it. Both were
   * found by playing. A flag that can be set must be clearable, and a freed
   * slot must not inherit either.
   */
  it('does not leak transient flags onto a recycled slot', () => {
    const world = new World();
    world.addPlayer(0 as never, 'A', true, true);
    const s = world.store;
    const h = s.alloc(EntityKind.Vehicle, -1, 0 as never, 0 as never, CX, 0, CZ, 0);
    const i = s.index(h);
    s.flags[i] |= EntityFlag.Burning | EntityFlag.BeingRepaired | EntityFlag.Selected;
    s.markDead(h);
    s.flushDestroyed();

    const h2 = s.alloc(EntityKind.Vehicle, -1, 0 as never, 0 as never, CX, 0, CZ, 0);
    const i2 = s.index(h2);
    expect(i2, 'the slot must actually be reused for this to prove anything').toBe(i);
    for (const [name, flag] of [
      ['Burning', EntityFlag.Burning],
      ['BeingRepaired', EntityFlag.BeingRepaired],
      ['Selected', EntityFlag.Selected],
      ['PendingDestroy', EntityFlag.PendingDestroy],
    ] as const) {
      expect((s.flags[i2] & flag) === 0, `${name} leaked onto the recycled slot`).toBe(true);
    }
  });
});

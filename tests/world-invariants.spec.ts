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
 * A real generated map, with NOTHING STANDING ON IT.
 *
 * This said "a real generated map, really populated" and the second half was
 * false: `Terrain` places no entities, so `world.store.aliveCount` is 0 here and
 * every column is untouched. Two cases below inspected exactly this and were
 * therefore unfailable — see `populate` for what that cost and how it is fixed.
 * Read the name as what it is: the GROUND, before an army arrives.
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

/**
 * Seat two armies and build the pre-seeded opening into `world`. Returns it.
 *
 * TWO ASSERTIONS IN THIS FILE COULD NOT FAIL, AND THIS IS THE FIX FOR BOTH.
 * They are worth writing down, because they are the file's own subject matter
 * turned on the file: a guard that cannot fail is not a weak test, it is the
 * absence of a test wearing one's clothes.
 *
 *   1. "nothing in the store is NaN -> holds for a freshly generated world"
 *      swept ten store columns over `alive[0..aliveCount)`. On a bare
 *      `buildWorld` that count is 0, so the sweep read ZERO ROWS. It passed by
 *      walking an empty loop, and it would have passed just as green with every
 *      column in the store full of NaN.
 *
 *   2. "hashes two identically-built worlds the same" compared `hashOnly` of
 *      two bare worlds. `hashOnly` folds census + entities + players and never
 *      touches terrain, so on two empty, playerless worlds it is a CONSTANT
 *      (2525216261, measured). The case compared that constant with itself. No
 *      amount of non-determinism in map generation could have moved it — which
 *      is precisely the property it was written to defend.
 *
 * Both now run against a world with 232 live entities and two players in it.
 * `start: 'base'` rather than the default `mcv` on purpose: it is the opening
 * that puts the most state in the store, and it is the shipping path the
 * overlap sweep below already exercises.
 */
function populate(world: World, seed: number): World {
  world.addPlayer(0 as never, 'A', true, true);
  world.addPlayer(1 as never, 'B', false, false);
  buildScenario(world, 'skirmish', seed, { start: 'base' });
  return world;
}

/** `buildWorld` with an army standing on it. */
function populated(seed: number, biome: string): World {
  return populate(buildWorld(seed, biome), seed);
}

/**
 * What `hashOnly` returns for a world with no entities and no players.
 *
 * Named rather than inlined because it is the exact value the hash case used to
 * compare against itself, and an assertion that the populated hash is NOT this
 * is the cheapest possible statement that the fold saw some state.
 */
const EMPTY_WORLD_HASH = hashOnly(new World());

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
 * cache holds plain strings and counts; each `World` is unreachable before the
 * first assertion runs, so nothing depends on which `it()` triggered the scan.
 * That is what lets the scan MUTATE its own world — it now runs `populate` on
 * each one, after the read-only start check and before the store sweep — and
 * still hand two independent cases their answers.
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
  /** Live slots the NaN sweep walked. Zero means the sweep proved nothing. */
  entities: number;
  /** Slot-column pairs the NaN sweep actually read. Same purpose. */
  reads: number;
}

let freshCases: FreshCase[] | null = null;

function freshScan(): FreshCase[] {
  if (freshCases !== null) return freshCases;
  const out: FreshCase[] = [];
  for (const biome of BIOME_NAMES) {
    const world = buildWorld(SHARED_SEED, biome);

    /*
     * THE STARTS ARE MEASURED FIRST, AND THE ORDER IS LOAD-BEARING.
     *
     * `isBuildable` is `buildGrid[i] !== 0 && occupant[i] === 0`, and
     * `populate` below stamps `markOccupied` across every structure it places —
     * starting with the one on this exact cell. Asking afterwards would report
     * every start unbuildable and would be measuring THE BASE rather than the
     * ground under it. It would fail loudly rather than silently, which is the
     * only reason this is a comment and not a mechanism.
     */
    const unbuildableStarts: string[] = [];
    for (const spot of startSpots(CX, CZ, 2)) {
      const cx = Math.floor(spot.x / CELL);
      const cz = Math.floor(spot.z / CELL);
      if (!world.terrain.isBuildable(cx, cz)) {
        unbuildableStarts.push(`${biome} start ${cx},${cz}`);
      }
    }

    // THEN PUT AN ARMY ON IT, so the sweep below has rows to sweep. See
    // `populate`: without this the loop ran zero times and could not fail.
    populate(world, SHARED_SEED);

    const s = world.store;
    const columns: ReadonlyArray<readonly [string, Float32Array]> = [
      ['posX', s.posX], ['posY', s.posY], ['posZ', s.posZ],
      ['yaw', s.yaw], ['turretYaw', s.turretYaw],
      ['hp', s.hp], ['velX', s.velX], ['velZ', s.velZ],
      ['orderX', s.orderX], ['orderZ', s.orderZ],
    ];
    const nonFinite: string[] = [];
    let reads = 0;
    for (let a = 0; a < s.aliveCount; a++) {
      const i = s.alive[a];
      for (const [name, col] of columns) {
        reads++;
        if (!Number.isFinite(col[i])) nonFinite.push(`${biome}: ${name} on slot ${i}`);
      }
    }

    out.push({
      biome, nonFinite, unbuildableStarts, reads, entities: s.aliveCount,
    });
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
        // THE SHIPPING PATH. `populate`'s `start: 'base'` is the pre-seeded
        // opening the report is about — the one that "yielded this, placing
        // building on top of each other". It is a shared helper rather than
        // four inlined lines because the NaN sweep and both hash cases must
        // build the SAME world this one does, or they drift apart silently.
        const world = populated(seed, biome);

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
  it('holds for a freshly built base and its army', () => {
    const cases = freshScan();
    const bad = cases.flatMap((c) => c.nonFinite);
    expect(bad, `\n${bad.join('\n')}\n`).toEqual([]);
    expect(cases.length, 'biomes measured').toBe(BIOME_NAMES.length);

    /*
     * THE SWEEP MUST HAVE SWEPT SOMETHING.
     *
     * This case spent its whole life green over an EMPTY store — `buildWorld`
     * places no entities, so `aliveCount` was 0 and the loop above ran zero
     * times. It could not have failed if every column were NaN. The bound is
     * 100 against a measured 232 live entities per biome: loose enough not to
     * pin the scenario's exact roster, tight enough that a world which quietly
     * stopped being populated fails here instead of passing vacuously.
     */
    for (const c of cases) {
      expect(c.entities, `${c.biome}: the sweep found no entities to inspect`)
        .toBeGreaterThan(100);
    }
    const reads = cases.reduce((n, c) => n + c.reads, 0);
    expect(reads, 'slot-column pairs actually read').toBeGreaterThan(4000);
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
    // POPULATED, and that is the entire point. On two bare worlds `hashOnly` is
    // a constant — it folds census, entities and players, and never terrain —
    // so this compared 2525216261 with itself and could not fail however
    // non-deterministic generation became. See `populate`.
    const a = populated(99, 'temperate');
    const b = populated(99, 'temperate');
    expect(hashOnly(a)).toBe(hashOnly(b));

    // The fold saw state. Without this the case could silently return to
    // comparing the empty constant the day `populate` stops populating.
    expect(a.store.aliveCount, 'entities folded into the hash').toBeGreaterThan(100);
    expect(hashOnly(a), 'the hash is the empty-world constant')
      .not.toBe(EMPTY_WORLD_HASH);
  });

  it('hashes two DIFFERENT seeds differently, so the check is not vacuous', () => {
    // Without this, a checksum that always returned the same constant would
    // make the case above pass forever.
    const a = populated(1, 'temperate');
    const b = populated(2, 'temperate');

    /*
     * BOTH HALVES, AND THEY ANSWER DIFFERENT QUESTIONS.
     *
     * The height sample is the direct statement that GENERATION moved — it
     * fails naming a coordinate, which is a debuggable failure. But it does not
     * touch `hashOnly` at all, so on its own it was an anti-vacuity guard for a
     * function it never called: a `hashOnly` hardcoded to `return 7` would have
     * left this green while the case above passed forever on the constant.
     *
     * So the hash comparison is added rather than substituted. Neither is
     * stronger than the other and dropping either one loses a real signal.
     */
    const sampleA: number[] = [];
    const sampleB: number[] = [];
    for (let x = 0; x <= MAP_SIZE; x += 61) {
      sampleA.push(a.terrain.heightAt(x, CZ));
      sampleB.push(b.terrain.heightAt(x, CZ));
    }
    expect(sampleA).not.toEqual(sampleB);
    expect(hashOnly(a), 'two different seeds hashed the same')
      .not.toBe(hashOnly(b));
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

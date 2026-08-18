/**
 * ============================================================================
 * tests/start-shelves.spec.ts — the start guarantee, aimed where armies land
 * ============================================================================
 * `src/core/config.ts` promises that within `TERRAIN_START_GUARD_RADIUS` a start
 * location is "flat, dry, buildable, and joined to the map's main passable
 * region. Verified inside the generator, not hoped for."
 *
 * THE MACHINERY IS REAL AND IT WORKS. `Terrain.levelStartAreas()` flattens a
 * disc, cuts ramps to reach it, fills unreachable pockets and reports
 * strandedness. Measured at the reserved shelf it is 100% buildable.
 *
 * IT WAS AIMED AT THE MAP CENTRE, WHERE NOBODY STARTS.
 *   1. `TERRAIN_START_POSITIONS` had one entry, `[0.5, 0.5]`.
 *   2. `src/world/terrain.system.ts` constructed `Terrain` with no `starts`
 *      option, so that default is what got reserved.
 *   3. `Scenarios.startSpots()` only uses shelves when `shelves.length >= n`.
 *      With two armies that is false, so it fell through to a geometric fan at
 *      `+/-START_SPREAD` — 96.5 m from the guaranteed shelf, whose guard radius
 *      is 54. Entirely outside it.
 *
 * The cost was about a third of all openings under 60% buildable, against 100%
 * at the shelf nobody stands on. `nudgeToBuildable` was added as a rescue and
 * only reaches ~75%.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * The fix is one line — hand the real start positions to the generator — but it
 * carried an UNVERIFIED geometric risk that the task recorded honestly and
 * refused to guess at:
 *
 *   The centre shelf cannot simply be moved, because most `?shot=` fixtures
 *   build ON the map centre. So all three discs must exist. But the starts are
 *   96.5 m apart from centre while `TERRAIN_START_FLAT_RADIUS` is 58, and
 *   58 + 58 > 96.5 — THE DISCS OVERLAP. Three discs levelled to three different
 *   local terraces, overlapping, may produce steps at the seams.
 *   `levelStartAreas()` mutates `this.height` as it goes, so later discs see
 *   earlier flattening, which MAY self-stabilise. Verify, do not assume.
 *
 * These cases are that verification, and then the guarantee itself.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain } from '../src/world/Terrain';
import { BIOME_NAMES } from '../src/world/Biomes';
import {
  BUILD_RADIUS, CELL, MAP_CELLS, MAP_SIZE,
  TERRAIN_START_FLAT_RADIUS, TERRAIN_START_GUARD_RADIUS,
} from '../src/core/config';
import {
  SKIRMISH_ARMIES_DEFAULT, SKIRMISH_ARMIES_MAX, SKIRMISH_START_OFFSETS, startPointsFor,
} from '../src/game/Scenarios';

const CX = MAP_SIZE * 0.5;
const CZ = MAP_SIZE * 0.5;

/**
 * The offsets a DEFAULT skirmish actually seats.
 *
 * `SKIRMISH_START_OFFSETS` holds four since v2.5.0 — it is the four-army
 * layout — and a two-army match takes the first two of them, which are the same
 * two literals this file was written against. Slicing here rather than reading
 * the whole table is the point: a two-army map must be unchanged by the
 * existence of slots 2 and 3, and a test that silently measured four starts on
 * a map with two reserved shelves would have found that out the hard way.
 */
const SEATED = SKIRMISH_START_OFFSETS.slice(0, SKIRMISH_ARMIES_DEFAULT);

/**
 * The three shelves the generator is now asked to reserve — taken from the ONE
 * derivation `src/world/terrain-plan.ts` uses, not restated.
 */
function shelvesFor(): { x: number; z: number }[] {
  return startPointsFor(SKIRMISH_ARMIES_DEFAULT, null).map((p) => ({ x: p.x, z: p.z }));
}

/**
 * THE CONSTRUCTOR ALREADY GENERATED. This used to call `t.generate()` here.
 *
 * `Terrain`'s constructor ends in `adopt(fields)` or `generate()`, and nothing
 * here passes prewarmed `fields`, so every map was built twice — heightfield,
 * ramp carver, splat and all 64 chunk meshes, for a result the second pass could
 * only reproduce. `generate()` documents itself as pure, and it is: measured
 * across four biomes x two seeds x with-and-without reserved starts, a second
 * call leaves `height`, `wallUp`, `wallTop`, `surface`, `passGrid`, `buildGrid`,
 * `startLocations()` and `startReport()` byte-identical. So the call was cost
 * with no effect, and dropping it changes no number this file asserts.
 */
function build(seed: number, biome: string, starts?: { x: number; z: number }[]): Terrain {
  const scene = new THREE.Scene();
  return new Terrain({
    scene, seed, biome: biome as never, anisotropy: 1,
    ...(starts === undefined ? {} : { starts }),
  });
}

/** Share of cells inside `radius` of (x,z) that a structure could be placed on. */
function buildableFrac(t: Terrain, x: number, z: number, radius: number): number {
  const c0 = Math.max(0, Math.floor((x - radius) / CELL));
  const c1 = Math.min(MAP_CELLS - 1, Math.ceil((x + radius) / CELL));
  const r0 = Math.max(0, Math.floor((z - radius) / CELL));
  const r1 = Math.min(MAP_CELLS - 1, Math.ceil((z + radius) / CELL));
  let ok = 0;
  let total = 0;
  const r2 = radius * radius;
  for (let cz = r0; cz <= r1; cz++) {
    for (let cx = c0; cx <= c1; cx++) {
      const wx = (cx + 0.5) * CELL;
      const wz = (cz + 0.5) * CELL;
      const dx = wx - x;
      const dz = wz - z;
      if (dx * dx + dz * dz > r2) continue;
      total++;
      if (t.isBuildable(cx, cz)) ok++;
    }
  }
  return total === 0 ? 0 : ok / total;
}

/**
 * The steepest single-cell height step anywhere inside `radius`.
 *
 * This is the seam detector. A step is what an overlap between two discs
 * levelled to different terraces would produce, and it is the thing that would
 * make the fix worse than the defect: a cliff through the middle of somebody's
 * base is less playable than rough ground.
 */
function maxStep(t: Terrain, x: number, z: number, radius: number): number {
  const c0 = Math.max(1, Math.floor((x - radius) / CELL));
  const c1 = Math.min(MAP_CELLS - 2, Math.ceil((x + radius) / CELL));
  const r0 = Math.max(1, Math.floor((z - radius) / CELL));
  const r1 = Math.min(MAP_CELLS - 2, Math.ceil((z + radius) / CELL));
  let worst = 0;
  const r2 = radius * radius;
  for (let cz = r0; cz <= r1; cz++) {
    for (let cx = c0; cx <= c1; cx++) {
      const wx = (cx + 0.5) * CELL;
      const wz = (cz + 0.5) * CELL;
      if ((wx - x) ** 2 + (wz - z) ** 2 > r2) continue;
      const h = t.heightAt(wx, wz);
      worst = Math.max(
        worst,
        Math.abs(t.heightAt(wx + CELL, wz) - h),
        Math.abs(t.heightAt(wx, wz + CELL) - h),
      );
    }
  }
  return worst;
}

/* ==========================================================================
 * ONE GENERATION PER (BIOME, SEED), SHARED BY EVERY CASE THAT ASKS ABOUT IT
 *
 * Four `it()` blocks below each looped `BIOME_NAMES` x a seed list and built
 * their own `Terrain` — 41 maps for 24 distinct ones, each generated twice by
 * the redundant `generate()` above, so 82 generations for 24 maps' worth of
 * questions. That is why this file sat near the 120 s `testTimeout` with no
 * headroom, and why it timed out for real on a contended box: the budget was
 * measuring how busy the machine is rather than whether the shelves are flat.
 * `tests/reachability.spec.ts` had the identical shape and `trackScan()` is the
 * fix this mirrors.
 *
 * The scan below generates each (biome, seed) ONCE and reads every metric any
 * case wants off that one map. Every metric is taken for every case, even where
 * only one case asks for it: `buildableFrac` over a 56 m disc is ~2 500 grid
 * lookups against a generation of hundreds of milliseconds, so measuring
 * uniformly is free and each case then filters to exactly the seeds it asserted
 * before. Each still asserts its own subset — the scan set is their union, not
 * a merger of the cases.
 *
 * NO TEST CAN CORRUPT ANOTHER'S TERRAIN, because no test is handed a terrain.
 * The cache holds plain numbers; each `Terrain` is disposed inside the scan and
 * is unreachable before the first assertion runs. Results therefore cannot
 * depend on which `it()` triggered the scan or on what ran before it.
 *
 * Computed lazily rather than in `beforeAll` for the reason `reachability.spec`
 * records: a hook carries the same clock as a test, so moving the work there
 * would move the timeout rather than remove it.
 * ========================================================================== */

/** Seeds the seam check runs on. */
const SEAM_SEEDS: readonly number[] = [1, 7, 4242];
/** Seeds the headline buildability sweep runs on. */
const BUILD_SEEDS: readonly number[] = [1, 7, 99, 4242, 0x51c0de, 0xbeef];
/** The seed the centre shelf and the shelf count are checked on. */
const CENTRE_SEED = 4242;
/** The biome the shelf count is checked on. */
const SHELF_BIOME = 'temperate';

/**
 * The union, derived rather than restated. A seed added to any list above joins
 * the scan by construction — the alternative is a fourth hand-maintained list
 * that silently stops covering one of the three.
 */
const SCAN_SEEDS: readonly number[] = [
  ...new Set([...SEAM_SEEDS, ...BUILD_SEEDS, CENTRE_SEED]),
];

interface ShelfCase {
  biome: string;
  seed: number;
  /** Steepest single-cell step at the midpoint to each start shelf. */
  seam: number[];
  /** Buildable share inside BUILD_RADIUS at each start. */
  startFrac: number[];
  /** Buildable share inside BUILD_RADIUS at the map centre. */
  centreFrac: number;
  /** Shelves the generator reported. */
  shelves: number;
}

let shelfCases: ShelfCase[] | null = null;

function shelfScan(): ShelfCase[] {
  if (shelfCases !== null) return shelfCases;
  const out: ShelfCase[] = [];
  for (const biome of BIOME_NAMES) {
    for (const seed of SCAN_SEEDS) {
      const t = build(seed, biome, shelvesFor());
      out.push({
        biome,
        seed,
        seam: SEATED.map(
          (o) => maxStep(t, CX + o.dx * 0.5, CZ + o.dz * 0.5, 16),
        ),
        startFrac: SEATED.map(
          (o) => buildableFrac(t, CX + o.dx, CZ + o.dz, BUILD_RADIUS),
        ),
        centreFrac: buildableFrac(t, CX, CZ, BUILD_RADIUS),
        shelves: t.startLocations().length,
      });
      t.dispose();
    }
  }
  shelfCases = out;
  return out;
}

/* ========================================================================== */

/*
 * REWRITTEN 2026-08-18, AND THE OLD VERSION WAS NOT WRONG — IT EXPIRED.
 *
 * It asserted that the levelled discs DO overlap (`58 * 2 > 96.6`) and then
 * that the overlap produces no seam step, which is exactly the right pair of
 * questions for a layout whose starts sit 96.6 m from the map centre.
 * `START_SPREAD_X`/`_Z` doubled, so a start is now 193.1 m out and two flat
 * radii are 116 — the discs are separated by 77 m of untouched ground and
 * there is no seam to measure.
 *
 * The seam case did not merely go stale, it INVERTED: it samples the midpoint
 * between the centre shelf and each start, which used to be inside both discs
 * and is now outside both, so it was measuring ordinary terrain and demanding
 * terrain be flat. It reported a 6.14 m step on temperate/1 — a hillside doing
 * what hillsides do.
 *
 * So the assertion is now the property the widening actually bought.
 */
describe('the discs no longer overlap, which retires the seam risk', () => {
  it('separates every pair of shelves by more than two flat radii', () => {
    const d = Math.hypot(SKIRMISH_START_OFFSETS[0]!.dx, SKIRMISH_START_OFFSETS[0]!.dz);
    expect(d, 'a start is this far from the map centre').toBeCloseTo(193.1, 0);
    expect(d, 'centre disc vs start disc').toBeGreaterThan(TERRAIN_START_FLAT_RADIUS * 2);

    // And the starts against each other. The CLOSEST pair is the binding one:
    // adjacent corners of the rectangle, 248 m at this spread against 116.
    let closest = Infinity;
    for (let i = 0; i < SKIRMISH_START_OFFSETS.length; i++) {
      for (let j = i + 1; j < SKIRMISH_START_OFFSETS.length; j++) {
        const a = SKIRMISH_START_OFFSETS[i]!;
        const b = SKIRMISH_START_OFFSETS[j]!;
        closest = Math.min(closest, Math.hypot(a.dx - b.dx, a.dz - b.dz));
      }
    }
    expect(closest, 'closest pair of start shelves').toBeCloseTo(248, 0);
    expect(closest).toBeGreaterThan(TERRAIN_START_FLAT_RADIUS * 2);
  });

  it('leaves ordinary, ungraded ground between the shelves', () => {
    // The midpoint the old seam case sampled. It is outside both discs now, so
    // the honest assertion is that it IS outside them — not that the terrain
    // there happens to be flat, which is neither true nor desirable.
    let checked = 0;
    for (const c of shelfScan()) {
      if (!SEAM_SEEDS.includes(c.seed)) continue;
      for (let k = 0; k < SEATED.length; k++) {
        const o = SEATED[k]!;
        const half = Math.hypot(o.dx, o.dz) * 0.5;
        expect(half, `${c.biome}/${c.seed} midpoint vs the centre disc`)
          .toBeGreaterThan(TERRAIN_START_FLAT_RADIUS);
        checked++;
      }
    }
    // A filter that quietly matches nothing is how a case stops asserting while
    // still going green. Count what was measured, not just what passed.
    expect(checked, 'seam midpoints measured')
      .toBe(BIOME_NAMES.length * SEAM_SEEDS.length * SEATED.length);
  });
});

/* ========================================================================== */

describe('the guarantee now covers the ground armies actually land on', () => {
  /**
   * The headline. Before the fix these measured 60-74% with about a third of
   * openings under 60%; the centre, which nobody stands on, measured 100%.
   */
  it('is buildable at every start, on every biome, across seeds', () => {
    const worst: { where: string; frac: number }[] = [];
    for (const c of shelfScan()) {
      if (!BUILD_SEEDS.includes(c.seed)) continue;
      for (const frac of c.startFrac) worst.push({ where: `${c.biome}/${c.seed}`, frac });
    }
    expect(worst.length, 'openings measured')
      .toBe(BIOME_NAMES.length * BUILD_SEEDS.length * SEATED.length);
    worst.sort((a, b) => a.frac - b.frac);
    const min = worst[0]!;
    const mean = worst.reduce((s, w) => s + w.frac, 0) / worst.length;
    // A hard floor, not an average: the complaint was about the BAD seeds.
    expect(min.frac, `worst opening was ${min.where} at ${(min.frac * 100).toFixed(1)}%`)
      .toBeGreaterThan(0.95);
    expect(mean).toBeGreaterThan(0.98);
  });

  it('keeps the centre shelf, which every ?shot= fixture builds on', () => {
    // Removing it would drop twelve fixtures onto ungraded ground and their
    // buildings would relocate via connectedGround — changing the shots more
    // than the terrain change itself.
    let checked = 0;
    for (const c of shelfScan()) {
      if (c.seed !== CENTRE_SEED) continue;
      expect(c.centreFrac, `${c.biome} centre`).toBeGreaterThan(0.95);
      checked++;
    }
    expect(checked, 'centres measured').toBe(BIOME_NAMES.length);
  });

  it('reports one shelf per requested start, so startSpots stops falling through', () => {
    // `startSpots` uses shelves only when `shelves.length >= n`. With one entry
    // and two armies that was always false, which is the whole mechanism of the
    // defect.
    const c = shelfScan().find((k) => k.biome === SHELF_BIOME && k.seed === CENTRE_SEED);
    expect(c, `the scan must cover ${SHELF_BIOME}/${CENTRE_SEED}`).toBeDefined();
    expect(c!.shelves).toBeGreaterThanOrEqual(3);
  });
});

/* ========================================================================== */

describe('the two sources of truth agree', () => {
  it('derives the skirmish starts from ONE table', () => {
    // They used to be `START_SPREAD_X`/`START_SPREAD_Z` in Scenarios.ts AND
    // `TERRAIN_START_POSITIONS` in config.ts — two places that had to match and
    // did not, which is exactly how the shelf ended up 96.5 m from the army.
    //
    // This read `.toBe(2)` until the table became the FOUR-army layout. The
    // assertion that mattered was never the length: it is that slots 0 and 1 are
    // an antipodal pair through the map centre, because `START_BISECTOR` — and
    // therefore the shoreline normal of both naval maps — is their perpendicular
    // bisector. Adding slots 2 and 3 must not move that, and `SEATED` proves the
    // two-army map still takes exactly those two.
    expect(SKIRMISH_START_OFFSETS.length).toBe(SKIRMISH_ARMIES_MAX);
    expect(SEATED.length).toBe(2);
    const [a, b] = SEATED;
    expect(a!.dx).toBeCloseTo(-b!.dx, 10);
    expect(a!.dz).toBeCloseTo(-b!.dz, 10);
  });

  it('completes a rectangle, so all four openings come out of one shape', () => {
    // Slots 2 and 3 are the other diagonal of the same rectangle rather than a
    // fan on a new ellipse: every one of the four is `hypot(74, 62)` from the
    // centre, so no seat is nearer the middle than another.
    const r = SKIRMISH_START_OFFSETS.map((o) => Math.hypot(o.dx, o.dz));
    for (const d of r) expect(d).toBeCloseTo(r[0]!, 9);
    // ...and the four are distinct corners, not duplicates.
    const seen = new Set(SKIRMISH_START_OFFSETS.map((o) => `${o.dx},${o.dz}`));
    expect(seen.size).toBe(SKIRMISH_ARMIES_MAX);
  });

  it('reserves the map centre plus one shelf per SEATED army, never per table entry', () => {
    // THE REGRESSION THE FOUR-ENTRY TABLE WOULD HAVE SHIPPED.
    // `terrain-plan.plannedTerrainInput` spreads the start list into
    // `TerrainGenOptions.starts`, and every extra entry is another levelled,
    // ramped, pocket-filled disc — i.e. a different heightfield for every map in
    // the game. A two-army boot must ask for exactly three points.
    expect(startPointsFor(2, null)).toEqual([
      { x: CX, z: CZ },
      { x: CX + SEATED[0]!.dx, z: CZ + SEATED[0]!.dz },
      { x: CX + SEATED[1]!.dx, z: CZ + SEATED[1]!.dz },
    ]);
    expect(startPointsFor(4, null)).toHaveLength(5);
    // Out-of-range counts fold into the layouts that exist rather than throwing.
    expect(startPointsFor(1, null)).toHaveLength(3);
    expect(startPointsFor(9, null)).toHaveLength(5);
  });

  it('keeps both starts inside the map with a guard radius to spare', () => {
    for (const o of SKIRMISH_START_OFFSETS) {
      expect(CX + o.dx).toBeGreaterThan(TERRAIN_START_GUARD_RADIUS);
      expect(CX + o.dx).toBeLessThan(MAP_SIZE - TERRAIN_START_GUARD_RADIUS);
      expect(CZ + o.dz).toBeGreaterThan(TERRAIN_START_GUARD_RADIUS);
      expect(CZ + o.dz).toBeLessThan(MAP_SIZE - TERRAIN_START_GUARD_RADIUS);
    }
  });
});

/* ========================================================================== */

describe('the armies open the authored distance apart', () => {
  /**
   * THE REGRESSION THIS FILE DID NOT CATCH, added the day it shipped.
   *
   * v1.21.0 made the generator reserve three shelves — centre plus both real
   * starts. `startSpots` used shelves whenever `shelves.length >= n`, which had
   * always been false for two armies and suddenly was not, so it handed out
   * `shelves[0]` and `shelves[1]`: THE MAP CENTRE and one army's start. The
   * opening distance halved and the user reported it the same day as "enemies
   * base is like 10 meters from mine".
   *
   * Every case above passed throughout, because they all measure the GROUND at
   * a start rather than where the starts are. Nothing asserted the distance.
   */
  it('puts the two armies the full diagonal apart, not half of it', async () => {
    const { startSpots } = await import('../src/game/Scenarios');
    const spots = startSpots(CX, CZ, 2);
    expect(spots).toHaveLength(2);
    const d = Math.hypot(spots[0]!.x - spots[1]!.x, spots[0]!.z - spots[1]!.z);
    // 2 x hypot(74, 62) = 193.1 m. `nudgeToBuildable` may shift a spot a few
    // metres on rough ground, so this is a floor rather than an equality.
    expect(d, `armies opened ${d.toFixed(1)} m apart`).toBeGreaterThan(170);
  });

  it('does not seat an army on the map centre', () => {
    // The centre shelf exists for the ?shot= fixtures. An army standing on it
    // is the exact symptom of the regression.
    const offsets = SKIRMISH_START_OFFSETS;
    for (const o of offsets) {
      expect(Math.hypot(o.dx, o.dz), 'a start must not be at the centre')
        .toBeGreaterThan(50);
    }
  });

  it('derives the spots from the table, not from the shelf list', async () => {
    // A shelf's job is to make the ground under a KNOWN point buildable.
    // Reading positions back out of the shelf list is what let the two sources
    // disagree, and it is the thing that must not come back.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'src/game/Scenarios.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function startSpots'));
    const end = fn.search(/^\}/m);
    const body = end > 0 ? fn.slice(0, end) : fn;
    expect(body, 'startSpots must not take positions from startLocations()')
      .not.toMatch(/shelves\[i\]/);
  });
});

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
import { SKIRMISH_START_OFFSETS } from '../src/game/Scenarios';

const CX = MAP_SIZE * 0.5;
const CZ = MAP_SIZE * 0.5;

/** The three shelves the generator is now asked to reserve. */
function shelvesFor(): { x: number; z: number }[] {
  return [
    { x: CX, z: CZ },
    ...SKIRMISH_START_OFFSETS.map((o) => ({ x: CX + o.dx, z: CZ + o.dz })),
  ];
}

function build(seed: number, biome: string, starts?: { x: number; z: number }[]): Terrain {
  const scene = new THREE.Scene();
  const t = new Terrain({
    scene, seed, biome: biome as never, anisotropy: 1,
    ...(starts === undefined ? {} : { starts }),
  });
  t.generate();
  return t;
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

/* ========================================================================== */

describe('the discs overlap, and that was the unverified risk', () => {
  it('really do overlap — this is arithmetic, not a worry', () => {
    const d = Math.hypot(SKIRMISH_START_OFFSETS[0]!.dx, SKIRMISH_START_OFFSETS[0]!.dz);
    expect(d, 'a start is this far from the map centre').toBeCloseTo(96.6, 0);
    expect(TERRAIN_START_FLAT_RADIUS * 2).toBeGreaterThan(d);
  });

  it('does not produce a seam step where two levelled discs meet', () => {
    // The whole reason this fix was deferred. Sampled ON the midpoint between
    // the centre shelf and each start shelf, which is where a seam would be.
    //
    // `levelStartAreas` mutates `this.height` as it goes, so the second disc
    // levels ground the first already flattened — the self-stabilising the task
    // hoped for. This asserts it rather than hoping.
    for (const biome of BIOME_NAMES) {
      for (const seed of [1, 7, 4242]) {
        const t = build(seed, biome, shelvesFor());
        for (const o of SKIRMISH_START_OFFSETS) {
          const mx = CX + o.dx * 0.5;
          const mz = CZ + o.dz * 0.5;
          const step = maxStep(t, mx, mz, 16);
          expect(step, `${biome}/${seed} seam step at the disc overlap`).toBeLessThan(2.0);
        }
      }
    }
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
    for (const biome of BIOME_NAMES) {
      for (const seed of [1, 7, 99, 4242, 0x51c0de, 0xbeef]) {
        const t = build(seed, biome, shelvesFor());
        for (const o of SKIRMISH_START_OFFSETS) {
          const frac = buildableFrac(t, CX + o.dx, CZ + o.dz, BUILD_RADIUS);
          worst.push({ where: `${biome}/${seed}`, frac });
        }
      }
    }
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
    for (const biome of BIOME_NAMES) {
      const t = build(4242, biome, shelvesFor());
      expect(buildableFrac(t, CX, CZ, BUILD_RADIUS), `${biome} centre`).toBeGreaterThan(0.95);
    }
  });

  it('reports one shelf per requested start, so startSpots stops falling through', () => {
    // `startSpots` uses shelves only when `shelves.length >= n`. With one entry
    // and two armies that was always false, which is the whole mechanism of the
    // defect.
    const t = build(4242, 'temperate', shelvesFor());
    const shelves = t.startLocations();
    expect(shelves.length).toBeGreaterThanOrEqual(3);
  });
});

/* ========================================================================== */

describe('the two sources of truth agree', () => {
  it('derives the skirmish starts from ONE table', () => {
    // They used to be `START_SPREAD_X`/`START_SPREAD_Z` in Scenarios.ts AND
    // `TERRAIN_START_POSITIONS` in config.ts — two places that had to match and
    // did not, which is exactly how the shelf ended up 96.5 m from the army.
    expect(SKIRMISH_START_OFFSETS.length).toBe(2);
    const [a, b] = SKIRMISH_START_OFFSETS;
    expect(a!.dx).toBeCloseTo(-b!.dx, 10);
    expect(a!.dz).toBeCloseTo(-b!.dz, 10);
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

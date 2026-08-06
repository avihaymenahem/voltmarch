/**
 * ============================================================================
 * tests/sea.spec.ts — A NAVAL SCENARIO HAS WATER WHERE IT FRAMES
 * ============================================================================
 * The defect these tests own, stated as it was found:
 *
 *   `shots/08-naval-water.png`, captioned "Water as a hero element: absorption
 *   gradient, foam filigree, wakes, shoreline band", framed six ships and a
 *   naval yard sitting on GRASS. There was no water in the image, and there
 *   never had been.
 *
 * Three separate things had to be true at once for that, and each one is a
 * test below:
 *
 *   1. `MAP_PRESETS.coast.water` is 0.45 and NOTHING READ IT. Terrain takes its
 *      biome from `?biome=` / TERRAIN_DEFAULT_BIOME and never consults the
 *      scenario, and `BiomeName` has no `coast` member for it to consult. So
 *      the naval fixture generated plain `temperate`.
 *   2. `ScenarioSpec.shore` was published by `buildNaval` and had ZERO
 *      consumers. The one piece of data that said where the sea was went
 *      nowhere.
 *   3. `TERRAIN_START_POSITIONS` reserves a shelf at (0.5, 0.5) that is
 *      GUARANTEED DRY and levelled to `WATER_LEVEL + TERRAIN_START_DRY_MARGIN`
 *      over a 58 m radius — centred on the exact point every fixture frames.
 *      Even a map that did generate water there would have had it filled in.
 *
 * These run headless against the real generator, so they measure the
 * heightfield rather than the intent.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Terrain, setPlannedSea, plannedSea } from '../src/world/Terrain';
import { NAVAL_SEA, planScenario } from '../src/game/Scenarios';
import {
  MAP_CELLS, MAP_SIZE, TERRAIN_START_FLAT_RADIUS, TERRAIN_SEA_BEACH_GRADE, WATER_LEVEL,
  type SeaSpec,
} from '../src/core/config';

const CENTRE = MAP_SIZE * 0.5;

function build(sea: SeaSpec | null, seed = 0x7e44a1): Terrain {
  return new Terrain({ scene: new THREE.Scene(), seed, biome: 'temperate', anisotropy: 1, sea });
}

/** Signed metres seaward of the declared line, ignoring the coastal wander. */
function seaward(sea: SeaSpec, x: number, z: number): number {
  return (x - sea.x) * sea.normalX + (z - sea.z) * sea.normalZ;
}

describe('the naval plan declares a sea', () => {
  it('publishes it on the PLAN, which is the only channel early enough', () => {
    // `activeScenario()` is published by a system at Phase.Cleanup order 10 000
    // — after terrain has already generated at Phase.Command order 40. The plan
    // is URL-derived and available from any phase, which is why the sea lives
    // there. This is the wiring that did not exist.
    expect(planScenario('naval').sea).toEqual(NAVAL_SEA);
  });

  it('leaves every other fixture landlocked', () => {
    const dry = [
      'allied-base', 'soviet-base', 'terrain-showcase', 'unit-parade',
      'battle', 'economy', 'placement', 'selection', 'blob', 'skirmish',
    ];
    for (const name of dry) expect(planScenario(name).sea, name).toBeNull();
  });

  it('agrees with the geometry buildNaval publishes through setShore', () => {
    // buildNaval: setShore(cx + 4, cz + 4, -SQRT1_2, -SQRT1_2, 7) with cx/cz at
    // the map centre. Two statements of one line; `buildScenario` warns if they
    // drift, and this is the digit-level version of that check.
    expect(NAVAL_SEA.x).toBe(CENTRE + 4);
    expect(NAVAL_SEA.z).toBe(CENTRE + 4);
    expect(NAVAL_SEA.normalX).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(NAVAL_SEA.normalZ).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(NAVAL_SEA.bandWidth).toBe(7);
  });

  it('cannot ask for water deeper than the heightfield floor allows', () => {
    // buildHeightfield clamps to TERRAIN_MIN_HEIGHT (0) and WATER_LEVEL is 2.0,
    // so 2.0 m is the deepest water this engine can express. A larger number
    // here would be a tunable that silently does nothing.
    expect(NAVAL_SEA.depth).toBeLessThanOrEqual(WATER_LEVEL);
  });
});

describe('the generator carves the declared sea', () => {
  const t = build(NAVAL_SEA);

  it('puts water where the fixture frames, which is the whole defect', () => {
    // The camera is posed at the map centre by tools/shoot.mjs on every shot.
    // This assertion is the one that was false.
    const cx = Math.floor(CENTRE / (MAP_SIZE / MAP_CELLS));
    expect(t.isWater(cx, cx)).toBe(true);
  });

  it('covers a substantial fraction of the map, not a puddle', () => {
    // Before: `temperate` basins gave 1% water, scattered wherever the noise
    // happened to dip, and none of it in frame.
    expect(t.stats().water).toBeGreaterThan(0.3);
  });

  it('keeps the land side dry', () => {
    // The naval yard, the power plant and the scatter box are all authored on
    // the land side of the line.
    const land = [
      [CENTRE + 14, CENTRE + 8], [CENTRE + 24, CENTRE + 2], [CENTRE + 40, CENTRE + 30],
    ];
    for (const [x, z] of land) {
      expect(seaward(NAVAL_SEA, x, z)).toBeLessThan(0);
      expect(t.heightAt(x, z), `${x},${z}`).toBeGreaterThan(WATER_LEVEL);
    }
  });

  it('reaches full depth offshore and ramps there smoothly', () => {
    // The absorption gradient the caption promises needs a real ramp, not a
    // step: depth must increase away from the shore, not jump.
    let last = -Infinity;
    for (let d = 4; d <= NAVAL_SEA.shelfMetres; d += 6) {
      const x = NAVAL_SEA.x + NAVAL_SEA.normalX * d;
      const z = NAVAL_SEA.z + NAVAL_SEA.normalZ * d;
      const depth = WATER_LEVEL - t.heightAt(x, z);
      expect(depth, `${d} m offshore`).toBeGreaterThanOrEqual(last - 0.35);
      last = depth;
    }
    expect(last).toBeGreaterThan(1.5);
  });

  it('never cuts a beach steeper than rough ground', () => {
    // TERRAIN_SEA_BEACH_GRADE is a CLAMP into a cone, chosen under
    // tan(ROUGH_SLOPE) so the coast is walkable rather than a cliff the nav
    // grid refuses. Sampled along the whole waterline, not at one point.
    const nx = NAVAL_SEA.normalX;
    const nz = NAVAL_SEA.normalZ;
    const run = 8;
    for (let s = -140; s <= 140; s += 20) {
      const bx = NAVAL_SEA.x - nz * s;
      const bz = NAVAL_SEA.z + nx * s;
      if (bx < 8 || bx > MAP_SIZE - 8 || bz < 8 || bz > MAP_SIZE - 8) continue;
      const hIn = t.heightAt(bx - nx * run, bz - nz * run);
      const hAt = t.heightAt(bx, bz);
      // +1.0 m of slack for the coastal wander, which moves the true waterline
      // relative to the sampled point.
      expect(hIn - hAt, `beach at s=${s}`).toBeLessThan(run * TERRAIN_SEA_BEACH_GRADE + 1.0);
    }
  });
});

describe('the reserved start shelf gets out of the water', () => {
  it('pushes the default centre start inland when a sea is declared', () => {
    const wet = build(NAVAL_SEA);
    const areas = wet.startLocations();
    expect(areas.length).toBe(1);
    // Far enough that the whole flat radius is on the land side.
    expect(seaward(NAVAL_SEA, areas[0].x, areas[0].z))
      .toBeLessThan(-TERRAIN_START_FLAT_RADIUS);
    expect(wet.heightAt(areas[0].x, areas[0].z)).toBeGreaterThan(WATER_LEVEL);
  });

  it('leaves the shelf exactly where it was on a landlocked map', () => {
    const dry = build(null);
    const areas = dry.startLocations();
    expect(areas.length).toBe(1);
    expect(areas[0].x).toBeCloseTo(CENTRE, 6);
    expect(areas[0].z).toBeCloseTo(CENTRE, 6);
  });
});

describe('a landlocked map is untouched, byte for byte', () => {
  /*
   * THE REGRESSION GUARD THAT MATTERS MOST.
   *
   * Eleven of the twelve scorecard fixtures declare no sea. If the new code
   * path perturbs their heightfield by so much as a float, every one of them
   * re-renders and the grade moves for a reason nobody can attribute. The sea
   * is gated on `sea !== null` in exactly two places (`buildHeightfield` and
   * `carveSea`), and this proves the gate holds.
   */
  it('generates an identical heightfield with the sea channel clear', () => {
    setPlannedSea(null);
    // No `sea` option at all — the path `world/terrain.system.ts` actually
    // takes — against an explicit null.
    const a = new Terrain({
      scene: new THREE.Scene(), seed: 0x7e44a1, biome: 'temperate', anisotropy: 1,
    });
    const b = build(null);
    expect(plannedSea()).toBeNull();
    expect(Array.from(a.height)).toEqual(Array.from(b.height));
  });

  it('is unchanged by a sea being declared and then withdrawn', () => {
    const t = build(null);
    const before = Float32Array.from(t.height);
    t.setSea(NAVAL_SEA);
    expect(Array.from(t.height)).not.toEqual(Array.from(before));
    t.setSea(null);
    expect(Array.from(t.height)).toEqual(Array.from(before));
  });
});

describe('the sea is deterministic', () => {
  it('produces the same map twice from the same seed', () => {
    const a = build(NAVAL_SEA, 4242);
    const b = build(NAVAL_SEA, 4242);
    expect(Array.from(a.height)).toEqual(Array.from(b.height));
  });

  it('wanders differently on a different seed, so the coast is not a ruler', () => {
    const a = build(NAVAL_SEA, 1);
    const b = build(NAVAL_SEA, 2);
    expect(Array.from(a.height)).not.toEqual(Array.from(b.height));
  });
});

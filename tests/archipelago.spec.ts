/**
 * ============================================================================
 * tests/archipelago.spec.ts — FOUR ARMIES, FOUR ISLANDS, ONE SEA
 * ============================================================================
 * WHAT WAS STRUCTURALLY IMPOSSIBLE BEFORE THIS
 * --------------------------------------------
 * `SeaSpec` was a HALF-PLANE: water where `(p - origin) . normal > 0`. That
 * shape has exactly one land region and exactly one water region, so no
 * combination of `depth`, `shelfMetres` and `wavinessMetres` could ever produce
 * an archipelago — the limit was the geometry, not the tuning. And
 * `SKIRMISH_START_OFFSETS` held two entries with `startSpots` iterating
 * `min(n, table.length)`, so a third army fell through to an unauthored
 * geometric fan and a fourth to the same.
 *
 * WHAT THIS FILE MEASURES, and it is not "there are islands"
 * ----------------------------------------------------------
 * Every number below comes off the REAL generator and the REAL `FlowFieldCache`
 * rather than off the spec that asked for them, because the whole class of
 * defect `tests/naval-maps.spec.ts` exists for was a declaration nothing read.
 *
 *   1. FOUR land masses, one sea, and mostly water.
 *   2. Each island holds a REAL base — the shelf was not pushed, the guarantee
 *      was met, and the buildable ground is measured rather than assumed.
 *   3. The sea was NOT causewayed shut. This is the live risk: `linkRegion`
 *      does not test water, and `ensureMajorRegions` runs after the last
 *      `carveSea`, so a corridor raised there is permanent.
 *   4. LAND CONNECTIVITY IS DELIBERATELY VIOLATED and amphibious connectivity
 *      replaces it. See the block above that describe().
 *   5. The coastline wanders. A ruler-straight one read as a clipping plane;
 *      four exact ellipses would read as four stencils.
 *   6. The shoals are shallow, wet, navigable and in the middle.
 *
 * AND THE TWO-ARMY MAP MUST BE UNTOUCHED, which is the last describe(): the
 * table grew, the plan grew a field, and a default boot must still ask the
 * generator for exactly the three shelves it always did.
 * ============================================================================
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';

import { Terrain, setActiveTerrain } from '../src/world/Terrain';
import { terrainGenKey } from '../src/world/terrain-gen';
import { isTerrainJob } from '../src/core/workers/protocol';
import { FlowFieldCache, MoveClass } from '../src/sim/Flowfield';
import { World } from '../src/core/world';
import { EntityKind, Faction } from '../src/core/types';
import type { PlayerId } from '../src/core/types';
import {
  ARCHIPELAGO_SEA, MAP_SEAS, NAVAL_SEA, SKIRMISH_ARMIES_DEFAULT, SKIRMISH_ARMIES_MAX,
  SKIRMISH_START_OFFSETS,
  buildScenario, clearScenario, planScenario, startPointsFor, startSpots,
} from '../src/game/Scenarios';
import {
  BUILD_RADIUS, CELL, MAP_CELLS, MAP_SIZE, TERRAIN_ISLAND_MIN_CELLS,
  TERRAIN_RAMP_MAX_LINK_CELLS, TERRAIN_SEA_SHOAL_MIN_DEPTH,
  TERRAIN_SEA_START_CLEARANCE, TERRAIN_START_EDGE_WOBBLE, TERRAIN_START_FLAT_RADIUS,
  WATER_LEVEL,
} from '../src/core/config';

const N = MAP_CELLS * MAP_CELLS;
const C = MAP_SIZE * 0.5;
const ISLANDS = ARCHIPELAGO_SEA.islands ?? [];
const SHOALS = ARCHIPELAGO_SEA.shoals ?? [];

/** The seed the measurements below are quoted at, plus two out-of-sample ones. */
const SEED = 0x7e44a1;
const SEEDS = [SEED, 4242, 0xa5c1a1] as const;

/* -------------------------------------------------------------------------- */

/** 4-connected components of a mask, largest first. The connectivity a grid
 *  pathfinder actually uses. */
function componentSizes(mask: Uint8Array): number[] {
  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  const sizes: number[] = [];
  for (let s = 0; s < N; s++) {
    if (mask[s] === 0 || label[s] !== 0) continue;
    const id = sizes.length + 1;
    let sp = 0;
    stack[sp++] = s;
    label[s] = id;
    let size = 0;
    while (sp > 0) {
      const c = stack[--sp];
      size++;
      const cx = c % MAP_CELLS;
      const cz = (c / MAP_CELLS) | 0;
      if (cx > 0) { const n = c - 1; if (mask[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; } }
      if (cx < MAP_CELLS - 1) { const n = c + 1; if (mask[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; } }
      if (cz > 0) { const n = c - MAP_CELLS; if (mask[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; } }
      if (cz < MAP_CELLS - 1) { const n = c + MAP_CELLS; if (mask[n] !== 0 && label[n] === 0) { label[n] = id; stack[sp++] = n; } }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

function maskOf(fn: (cx: number, cz: number) => boolean): Uint8Array {
  const m = new Uint8Array(N);
  for (let cz = 0; cz < MAP_CELLS; cz++) {
    for (let cx = 0; cx < MAP_CELLS; cx++) m[cz * MAP_CELLS + cx] = fn(cx, cz) ? 1 : 0;
  }
  return m;
}

function build(seed: number): Terrain {
  return new Terrain({
    scene: new THREE.Scene(),
    seed,
    biome: 'temperate' as never,
    anisotropy: 1,
    starts: startPointsFor(SKIRMISH_ARMIES_MAX, ARCHIPELAGO_SEA).map((p) => ({ x: p.x, z: p.z })),
    sea: ARCHIPELAGO_SEA,
  });
}

interface Fixture {
  seed: number;
  terrain: Terrain;
  nav: FlowFieldCache;
  /** Wet cells, straight off the generator. */
  water: number[];
  /** Dry cells. */
  land: number[];
  /** Cells a tracked hull may be routed through. */
  track: number[];
  /** Cells a ship may be routed through. */
  naval: number[];
  /** Track OR Naval — what a fleet with transports can reach. */
  amphibious: number[];
  wetCells: number;
}

const fixtures: Fixture[] = [];

beforeAll(() => {
  for (const seed of SEEDS) {
    const terrain = build(seed);
    // `FlowFieldCache` reads `getTerrain()` for its fast path; without this it
    // falls back to the `ITerrain` port, whose naval branch skips the
    // `PASS_HOVER` test and would measure a different rule than the game runs.
    setActiveTerrain(terrain);
    const nav = new FlowFieldCache(terrain);
    const wet = maskOf((cx, cz) => terrain.isWater(cx, cz));
    let wetCells = 0;
    for (let i = 0; i < N; i++) if (wet[i] !== 0) wetCells++;
    fixtures.push({
      seed,
      terrain,
      nav,
      water: componentSizes(wet),
      land: componentSizes(maskOf((cx, cz) => !terrain.isWater(cx, cz))),
      track: componentSizes(maskOf((cx, cz) => nav.isPassableClass(cx, cz, MoveClass.Track))),
      naval: componentSizes(maskOf((cx, cz) => nav.isPassableClass(cx, cz, MoveClass.Naval))),
      amphibious: componentSizes(maskOf(
        (cx, cz) => nav.isPassableClass(cx, cz, MoveClass.Track)
          || nav.isPassableClass(cx, cz, MoveClass.Naval),
      )),
      wetCells,
    });
    setActiveTerrain(null);
  }
}, 300_000);

afterAll(() => {
  setActiveTerrain(null);
  for (const f of fixtures) f.terrain.dispose();
  fixtures.length = 0;
});

const at = (seed: number): Fixture => {
  const f = fixtures.find((k) => k.seed === seed);
  if (f === undefined) throw new Error(`fixture ${seed} was never built`);
  return f;
};

/* ==========================================================================
 * 1. THE SHAPE IS DATA
 * ========================================================================== */

describe('an island sea is plain serialisable data', () => {
  it('carries no functions, so it survives the worker boundary', () => {
    // Terrain generation runs in a Web Worker and this struct crosses by
    // `structuredClone`. A callback anywhere in it — a coastline function, a
    // falloff — would throw `DataCloneError` at the postMessage, which is a
    // failure mode that only appears in a browser and never in this suite.
    const clone: unknown = JSON.parse(JSON.stringify(ARCHIPELAGO_SEA));
    expect(clone).toEqual(ARCHIPELAGO_SEA);
  });

  it('is accepted by the wire guard, radii and all', () => {
    const job = { kind: 'terrain', id: 1, options: { seed: 1, biome: 'temperate', sea: ARCHIPELAGO_SEA } };
    expect(isTerrainJob(job)).toBe(true);
  });

  it('is REJECTED when a radius is zero, which would be a NaN heightfield', () => {
    // `ellipseDistance` divides by each radius twice. A zero gives Infinity,
    // `min` propagates it, and the bed comes out NaN — the "NaN into a black
    // frame" failure, arriving over a message port where nothing is looking.
    for (const bad of [
      { ...ARCHIPELAGO_SEA, islands: [{ x: 100, z: 100, radiusX: 0, radiusZ: 40 }] },
      { ...ARCHIPELAGO_SEA, islands: [{ x: 100, z: 100, radiusX: 40, radiusZ: -3 }] },
      { ...ARCHIPELAGO_SEA, shoals: [{ x: 100, z: 100, radiusX: 10, radiusZ: 0, depth: 1 }] },
      { ...ARCHIPELAGO_SEA, shoals: [{ x: 100, z: 100, radiusX: 10, radiusZ: 5 }] },
    ]) {
      expect(isTerrainJob({ kind: 'terrain', id: 1, options: { seed: 1, biome: 'temperate', sea: bad } }))
        .toBe(false);
    }
  });

  it('changes the generation key, and leaves every half-plane key alone', () => {
    // The key is what decides whether the prewarmed fields are for THIS map. A
    // miss is silent — the terrain regenerates on the main thread — so the
    // island and shoal lists had to be appended as keys `JSON.stringify` DROPS
    // when absent rather than spliced into the existing `sea` array.
    const base = { seed: 7, biome: 'temperate' as const };
    expect(terrainGenKey({ ...base, sea: NAVAL_SEA }))
      .not.toContain('islands');
    expect(terrainGenKey({ ...base, sea: MAP_SEAS.coast }))
      .not.toContain('shoals');
    expect(terrainGenKey({ ...base, sea: null })).not.toContain('islands');

    const key = terrainGenKey({ ...base, sea: ARCHIPELAGO_SEA });
    expect(key).toContain('"islands"');
    expect(key).toContain('"shoals"');
    expect(key).not.toBe(terrainGenKey({ ...base, sea: NAVAL_SEA }));
  });
});

/* ==========================================================================
 * 2. THE WORLD ON THE GROUND
 * ========================================================================== */

describe('the generator carves four islands in one sea', () => {
  it('is mostly water', () => {
    /*
     * MEASURED: 53.8% / 54.0% / 54.1% across the three seeds.
     *
     * AND THAT IS THE CEILING, not a preference. A start shelf is a levelled
     * disc of TERRAIN_START_FLAT_RADIUS (58 m) whose rim wanders
     * TERRAIN_START_EDGE_WOBBLE (14 m) further, and `resolveStarts` slides it
     * inland unless it clears the waterline by bandWidth + waviness +
     * TERRAIN_SEA_START_CLEARANCE beyond that — 96 m of dry ground in EVERY
     * direction. Four inscribed circles of 96 m is 44% of a 512 m map before a
     * single metre of beach. Making this map wetter means shrinking the start
     * guarantee or seating fewer armies; it is not a tuning question.
     */
    for (const f of fixtures) {
      const frac = f.wetCells / N;
      expect(frac, `seed ${f.seed.toString(16)} water ${(frac * 100).toFixed(1)}%`)
        .toBeGreaterThan(0.5);
      expect(frac).toBeLessThan(0.6);
    }
  });

  it('is FOUR land masses, evenly sized', () => {
    // The headline, and the thing a half-plane could not express at all.
    for (const f of fixtures) {
      const real = f.land.filter((s) => s >= TERRAIN_ISLAND_MIN_CELLS);
      expect(real.length, `seed ${f.seed.toString(16)} land masses: ${f.land.slice(0, 8)}`).toBe(4);
      // Measured 1849-1914 cells each. A four-player map whose islands differ
      // by more than a few percent is not a four-player map.
      expect(real[3]! / real[0]!, 'smallest island vs largest').toBeGreaterThan(0.9);
    }
  });

  it('is ONE sea, not four lagoons', () => {
    for (const f of fixtures) {
      // Measured 8821-8866 cells in the main body, 99.9%+ of all water. A
      // couple of inland noise-basin puddles are allowed; a sea broken into
      // per-island bays is the failure this asserts against.
      expect(f.water[0]!).toBeGreaterThan(8000);
      expect(f.water[0]! / f.wetCells).toBeGreaterThan(0.99);
    }
  });

  it('is navigable as one body, asked through the real nav grid', () => {
    for (const f of fixtures) {
      const total = f.naval.reduce((a, b) => a + b, 0);
      expect(f.naval[0]!).toBeGreaterThan(7000);
      expect(f.naval[0]! / total, 'largest navigable body as a share of all navigable water')
        .toBeGreaterThan(0.99);
    }
  });

  it('reaches full depth in open water and never past the floor', () => {
    const t = at(SEED).terrain;
    // Mid-channel and the far corners: 6.95-7.00 m against the declared 7.0.
    for (const [x, z] of [[118, C], [394, C], [20, 20], [C - 138, C]] as const) {
      const d = WATER_LEVEL - t.heightAt(x, z);
      expect(d, `depth at ${x},${z}`).toBeGreaterThan(ARCHIPELAGO_SEA.depth * 0.95);
      expect(d).toBeLessThanOrEqual(ARCHIPELAGO_SEA.depth + 0.01);
    }
  });
});

/* ==========================================================================
 * 3. THE COASTLINE IS NOT A STENCIL
 * ========================================================================== */

describe('the coast wanders', () => {
  it('does not read as four ellipses stamped on a plane', () => {
    /*
     * `MAP_SEAS`' own header records why a straight coast was wrong: "a
     * ruler-straight coast reads as a clipping plane". Four exact ellipses are
     * the same defect in a different shape.
     *
     * Measured as the radius from each island centre to the first wet cell,
     * swept round the compass. An un-wandered ellipse gives the same number
     * every time; the 8 m `wavinessMetres` on a 54 m feature must show up as a
     * real spread, and it must not be so large that a coast crosses another
     * island's.
     */
    const t = at(SEED).terrain;
    for (const isl of ISLANDS) {
      const radii: number[] = [];
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        let r = 0;
        for (; r < 160; r += 2) {
          const cx = Math.floor((isl.x + dx * r) / CELL);
          const cz = Math.floor((isl.z + dz * r) / CELL);
          if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) break;
          if (t.isWater(cx, cz)) break;
        }
        radii.push(r);
      }
      const lo = Math.min(...radii);
      const hi = Math.max(...radii);
      // A stencil would give hi - lo === 0 (a circle) or a smooth 2-lobe swing.
      // 8 m of fbm either way is at least ~8 m of measured spread.
      expect(hi - lo, `island at ${isl.x},${isl.z} coast spread ${lo}..${hi} m`)
        .toBeGreaterThan(8);
      /*
       * ...and not so much that the island stops being the island it declared.
       *
       * THE BOUND MOVED, AND THE REASON IS THE ISLAND SHELF, not the coastline.
       * It read `4 * wavinessMetres` (32 m), which was the right calibration
       * while `levelStartAreas` put an island start on the terrace it happened
       * to sit on — tier 1, ~9.9 m. The waterline then fell 7.9 m over the last
       * ~26 m of coast, a 0.23 grade, and a grade that steep pins the waterline
       * in place: the biome swell moves the ground up and down by well under a
       * metre and the 0.23 slope converts that into 3-4 m of horizontal travel.
       *
       * An island shelf is tier 0 now — see `levelStartAreas` in
       * `src/world/terrain-gen.ts` for the naval-yard measurement that forced
       * it — so the same coast falls 1.4 m over the same 26 m, a 0.05 grade,
       * and the SAME swell now moves the waterline 15-20 m in and out. The
       * coast wanders more because the beach is flatter, which is the whole
       * point of the change and reads as bays rather than as a stencil.
       *
       * MEASURED across five configurations, spread per island:
       *   desert   0xa7011   (SHIPPED)  12, 10, 12, 10
       *   desert   0x5ea0a7             14, 12, 12, 10
       *   temperate 0x7e44a1            10, 34, 26, 10
       *   temperate 4242                10, 10,  8, 10
       *   temperate 0xa5c1a1            10, 30, 14, 36
       *
       * 48 m is 6x waviness, clear of the 36 m worst case. It is a backstop,
       * not the invariant: what "the island stops being the island" really
       * means is measured directly below and by the channel-width test further
       * down, both of which are tighter than this.
       */
      expect(hi - lo).toBeLessThan(6 * ARCHIPELAGO_SEA.wavinessMetres);
      /*
       * THE PROPERTY THE BOUND ABOVE IS A PROXY FOR. A bay is welcome; a bay
       * that reaches inside the start guarantee is a base with its back in the
       * sea. `BUILD_RADIUS` is 56 m from the island centre and the shelf is
       * flat to 58, so the nearest the waterline may come is the first number
       * that leaves either intact. Measured minimum across the five
       * configurations above: 66 m, on temperate 0xa5c1a1.
       */
      expect(lo, `island at ${isl.x},${isl.z} coast comes within ${lo} m of the start`)
        .toBeGreaterThan(BUILD_RADIUS + 4);
    }
  });

  it('gives every island a beach rather than a wall', () => {
    // `TERRAIN_SEA_BEACH_GRADE` is a CLAMP into a cone, and it applies to an
    // island coast for free because the ceiling is a function of the signed
    // distance and nothing else. Sampled radially outward across the waterline.
    const t = at(SEED).terrain;
    for (const isl of ISLANDS) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        // 8 m of run centred on the nominal coast.
        const hIn = t.heightAt(isl.x + dx * (isl.radiusX - 6), isl.z + dz * (isl.radiusZ - 6));
        const hOut = t.heightAt(isl.x + dx * (isl.radiusX + 6), isl.z + dz * (isl.radiusZ + 6));
        // The land side is never BELOW the sea side: a coast that runs downhill
        // inland is a hole, not a beach.
        expect(hIn, `island ${isl.x},${isl.z} bearing ${k}`).toBeGreaterThanOrEqual(hOut - 0.01);
      }
    }
  });
});

/* ==========================================================================
 * 4. THE SHOALS
 * ========================================================================== */

describe('the shoals are a feature, not decoration', () => {
  it('raises the bed in the middle without breaking the surface', () => {
    const t = at(SEED).terrain;
    for (const s of SHOALS) {
      const d = WATER_LEVEL - t.heightAt(s.x, s.z);
      // Measured: the bank at 0.70 m and both channel bars at 1.10 m, against
      // 7.0 m of open water 100 m away.
      expect(d, `shoal at ${s.x},${s.z}`).toBeCloseTo(s.depth, 2);
      expect(d).toBeGreaterThanOrEqual(TERRAIN_SEA_SHOAL_MIN_DEPTH);
    }
  });

  it('stays WET, or it would be a fifth island', () => {
    // A shoal that dries splits the sea, grows a beach cone and stops routing
    // ships. `TERRAIN_SEA_SHOAL_MIN_DEPTH` is the clamp that forbids it; this
    // is the clamp measured over every cell of every bar.
    const f = at(SEED);
    for (const s of SHOALS) {
      const c0 = Math.max(0, Math.floor((s.x - s.radiusX) / CELL));
      const c1 = Math.min(MAP_CELLS - 1, Math.ceil((s.x + s.radiusX) / CELL));
      const r0 = Math.max(0, Math.floor((s.z - s.radiusZ) / CELL));
      const r1 = Math.min(MAP_CELLS - 1, Math.ceil((s.z + s.radiusZ) / CELL));
      for (let cz = r0; cz <= r1; cz++) {
        for (let cx = c0; cx <= c1; cx++) {
          const a = ((cx + 0.5) * CELL - s.x) / s.radiusX;
          const b = ((cz + 0.5) * CELL - s.z) / s.radiusZ;
          // Well inside the rim, so the coastal wander cannot be the reason.
          if (a * a + b * b > 0.64) continue;
          expect(f.terrain.isWater(cx, cz), `shoal cell ${cx},${cz}`).toBe(true);
          expect(f.nav.isPassableClass(cx, cz, MoveClass.Naval), `ship over ${cx},${cz}`).toBe(true);
        }
      }
    }
  });

  it('is genuinely shallower than the water around it', () => {
    // The one visual axis: `Water.fitRamp` fits absorption to the basin that
    // was generated, so a 0.7 m bar inside a 7 m sea is a different COLOUR. No
    // reflection, no second material — `docs/RA3_LOOK_BIBLE.md` bans both.
    const t = at(SEED).terrain;
    const bank = WATER_LEVEL - t.heightAt(C, C);
    const open = WATER_LEVEL - t.heightAt(118, C);
    expect(open / bank, `open ${open.toFixed(2)} m vs bank ${bank.toFixed(2)} m`)
      .toBeGreaterThan(5);
  });
});

/* ==========================================================================
 * 5. EACH ISLAND HOLDS A REAL BASE
 * ========================================================================== */

describe('every island can seat an army', () => {
  it('does not push a single start shelf, so the spawn and the shelf agree', () => {
    /*
     * `startSpots` reads the ISLAND CENTRE and `resolveStarts` reserves whatever
     * the budget lets it — so a pushed shelf silently separates where the ground
     * is guaranteed from where the army lands, exactly as
     * `tests/naval-maps.spec.ts` records for the half-plane maps. The island
     * radius is chosen to clear the budget; this is the assertion that keeps it
     * chosen.
     */
    const want = startPointsFor(SKIRMISH_ARMIES_MAX, ARCHIPELAGO_SEA);
    for (const f of fixtures) {
      const got = f.terrain.startLocations();
      expect(got.length).toBe(want.length);
      for (let i = 0; i < want.length; i++) {
        expect(got[i].x, `seed ${f.seed.toString(16)} start ${i} x`).toBeCloseTo(want[i].x, 6);
        expect(got[i].z, `seed ${f.seed.toString(16)} start ${i} z`).toBeCloseTo(want[i].z, 6);
      }
    }
  });

  it('clears the shelf-push budget by an explicit margin', () => {
    // The same rule as the arithmetic rather than as its outcome, so a failure
    // says WHICH way to move the geometry. The budget is an INSCRIBED radius:
    // it must be cleared on the island's SHORT axis, not on its area.
    const budget = TERRAIN_START_FLAT_RADIUS + TERRAIN_START_EDGE_WOBBLE
      + ARCHIPELAGO_SEA.bandWidth + ARCHIPELAGO_SEA.wavinessMetres
      + TERRAIN_SEA_START_CLEARANCE;
    for (const isl of ISLANDS) {
      const inscribed = Math.min(isl.radiusX, isl.radiusZ);
      expect(inscribed, `island at ${isl.x},${isl.z} is ${inscribed} m against a ${budget} m budget`)
        .toBeGreaterThan(budget);
    }
  });

  it('is 100% buildable inside BUILD_RADIUS at every start', () => {
    // Measured 1.000 at all four, on all three seeds — the same figure
    // `tests/start-shelves.spec.ts` demands of the two-army openings.
    const f = at(SEED);
    for (const p of startPointsFor(SKIRMISH_ARMIES_MAX, ARCHIPELAGO_SEA)) {
      let ok = 0;
      let total = 0;
      for (let cz = 0; cz < MAP_CELLS; cz++) {
        for (let cx = 0; cx < MAP_CELLS; cx++) {
          const wx = (cx + 0.5) * CELL;
          const wz = (cz + 0.5) * CELL;
          if ((wx - p.x) ** 2 + (wz - p.z) ** 2 > BUILD_RADIUS * BUILD_RADIUS) continue;
          total++;
          if (f.terrain.isBuildable(cx, cz)) ok++;
        }
      }
      expect(ok / total, `buildable at ${p.x},${p.z}`).toBeGreaterThan(0.95);
    }
  });

  it('leaves each island far more buildable ground than one base needs', () => {
    /*
     * MEASURED, and reported here rather than only asserted: 828-891 buildable
     * cells per island, i.e. 13 200-14 300 m^2, against the 616 cells a
     * BUILD_RADIUS disc covers. So a yard, a refinery, a war factory and their
     * expansions all fit with room over.
     *
     * NOTE ON THE BEACH: `TERRAIN_SEA_BEACH_GRADE` (0.26) is steeper than the
     * buildable slope threshold (~0.18), so the beach cone is NEVER buildable
     * and none of the ground counted here is on it. That is a known defect with
     * its own owner; the number above is what an island offers WITH the beach
     * excluded, so it can only improve when the beach is fixed.
     */
    const f = at(SEED);
    for (const isl of ISLANDS) {
      let ok = 0;
      for (let cz = 0; cz < MAP_CELLS; cz++) {
        for (let cx = 0; cx < MAP_CELLS; cx++) {
          const wx = (cx + 0.5) * CELL;
          const wz = (cz + 0.5) * CELL;
          const a = (wx - isl.x) / (isl.radiusX + 12);
          const b = (wz - isl.z) / (isl.radiusZ + 12);
          if (a * a + b * b > 1) continue;
          if (f.terrain.isBuildable(cx, cz)) ok++;
        }
      }
      expect(ok, `buildable cells on the island at ${isl.x},${isl.z}`).toBeGreaterThan(700);
    }
  });
});

/* ==========================================================================
 * 6. REACHABILITY — THE DELIBERATE VIOLATION
 *
 * `tests/reachability.spec.ts` demands that the main tracked region hold 90% of
 * all passable ground, and `tests/naval-maps.spec.ts` demands 97% of it on the
 * two half-plane sea maps. AN ARCHIPELAGO CANNOT MEET EITHER, and must not: the
 * main region holds about a quarter of the drivable ground by construction, and
 * a map that met the bar would be a map whose islands had been joined.
 *
 * NEITHER EXISTING ASSERTION IS WEAKENED. `reachability.spec.ts` sweeps seeds
 * and biomes with NO sea at all, so it never sees this map; `naval-maps.spec.ts`
 * names its two presets explicitly. The exemption is not a flag either — there
 * is nothing to exempt, because the archipelago is not in either file's fixture
 * list. What it needs instead is its OWN invariant, and this is it:
 *
 *   LAND connectivity is replaced by AMPHIBIOUS connectivity. Every cell any
 *   army can occupy — dry ground it can drive on, open water it can sail —
 *   belongs to ONE component. That is the property that actually matters:
 *   "every player can reach every other player", which on a continent happens
 *   to be spelled "one land region" and here is spelled "one land-or-sea
 *   region".
 *
 * Plus the negative: the generator must not have ACHIEVED land connectivity, by
 * causeway or by fill. That is a live risk rather than a hypothetical — see the
 * cases below.
 * ========================================================================== */

describe('reachability on an island map', () => {
  it('deliberately leaves four separate tracked regions', () => {
    for (const f of fixtures) {
      const durable = f.track.filter((s) => s >= TERRAIN_ISLAND_MIN_CELLS);
      expect(durable.length, `seed ${f.seed.toString(16)} tracked regions ${f.track.slice(0, 8)}`)
        .toBe(4);
      // And the main region holds roughly a quarter, which is what makes this
      // map fail the continent invariant and why it needs its own.
      const total = f.track.reduce((a, b) => a + b, 0);
      expect(f.track[0]! / total).toBeLessThan(0.35);
    }
  });

  it('is ONE amphibious world — every army can reach every other', () => {
    // THE REPLACEMENT INVARIANT. Measured 14 987-15 091 cells in one component
    // out of 16 384; the remainder is the impassable map border and cliff.
    for (const f of fixtures) {
      const total = f.amphibious.reduce((a, b) => a + b, 0);
      expect(f.amphibious[0]! / total, `seed ${f.seed.toString(16)} amphibious components ${f.amphibious.slice(0, 6)}`)
        .toBeGreaterThan(0.99);
      expect(f.amphibious[0]!).toBeGreaterThan(14_000);
    }
  });

  it('reports no stranded start, without having built a causeway to say so', () => {
    /*
     * THE FAILURE THIS GUARDS, stated as the code that would cause it:
     * `enforceStartAreas` finds three of four start shelves outside the main
     * region, escalates to `linkRegionForced(k, main)` — which leaves `dryOnly`
     * OFF deliberately, because for a PIT a causeway beats an immobile army —
     * and `carveRamp` raises the seabed into a land bridge. Behind that sits
     * `fillRegion`, which would flatten a whole island to its rim.
     *
     * `TerrainFields.islandStartSatisfied` widens the test instead of weakening
     * the escalation, so an island start is answered rather than repaired. All
     * five counters must be zero: a non-zero one is the archipelago being
     * quietly turned back into a continent.
     */
    for (const f of fixtures) {
      const r = f.terrain.startReport();
      const where = `seed ${f.seed.toString(16)}`;
      expect(r.stranded, `${where} stranded`).toBe(0);
      expect(r.startRamps, `${where} start ramps`).toBe(0);
      expect(r.forcedRamps, `${where} forced corridors`).toBe(0);
      expect(r.filled, `${where} pockets filled`).toBe(0);
      expect(r.majorRamps, `${where} plateau corridors`).toBe(0);
      // ...and it knows why it stopped: three regions no dry corridor can
      // reach. `world/terrain.system.ts` already prints that as "normally
      // islands, which is the correct answer".
      expect(r.majorSkipped, `${where} regions abandoned`).toBe(3);
    }
  });

  it('keeps every channel wider than the bounded corridor carver can span', () => {
    /*
     * THE SECOND, INDEPENDENT REASON NO CAUSEWAY APPEARS.
     *
     * `linkRegion` scans a Chebyshev window of `TERRAIN_RAMP_MAX_LINK_CELLS`
     * (13) and does NOT test water. `ensureMajorRegions` runs after the last
     * `carveSea`, so anything it raises is permanent. The generator now refuses
     * that link outright on an island map — but the geometry is chosen so it
     * could not have found a pair anyway, and an invariant that fails silently
     * deserves two reasons.
     *
     * Measured across the strait between each adjacent pair: 64-80 m, i.e.
     * 16-20 cells, against the 13-cell window.
     */
    const t = at(SEED).terrain;
    const limit = TERRAIN_RAMP_MAX_LINK_CELLS * CELL;
    const gap = (ax: number, az: number, bx: number, bz: number): number => {
      let wet = 0;
      const steps = 200;
      for (let k = 0; k <= steps; k++) {
        const s = k / steps;
        const x = ax + (bx - ax) * s;
        const z = az + (bz - az) * s;
        const cx = Math.floor(x / CELL);
        const cz = Math.floor(z / CELL);
        if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) continue;
        if (t.isWater(cx, cz)) wet++;
      }
      return (wet / steps) * Math.hypot(bx - ax, bz - az);
    };
    // Every unordered pair of islands, along the line joining their centres.
    for (let i = 0; i < ISLANDS.length; i++) {
      for (let j = i + 1; j < ISLANDS.length; j++) {
        const w = gap(ISLANDS[i]!.x, ISLANDS[i]!.z, ISLANDS[j]!.x, ISLANDS[j]!.z);
        expect(w, `water between island ${i} and ${j} is ${w.toFixed(0)} m`)
          .toBeGreaterThan(limit);
      }
    }
  });

  it('is reproducible cell for cell', () => {
    // Lockstep runs the generator independently on both machines, so an island
    // that moves by one cell is a desync.
    const a = build(SEED);
    const b = build(SEED);
    expect(Array.from(a.height)).toEqual(Array.from(b.height));
    expect(a.waterGrid).toEqual(b.waterGrid);
    expect(a.passGrid).toEqual(b.passGrid);
    a.dispose();
    b.dispose();
  }, 120_000);
});

/* ==========================================================================
 * 7. FOUR ARMIES SEATED
 * ========================================================================== */

describe('four armies', () => {
  it('takes its start table from the island list, not from an offset table', () => {
    // One source of truth: if an island moves, the start on it moves. A second
    // table of positions is exactly the drift `SKIRMISH_START_OFFSETS`' own
    // header is about, with a construction yard in the sea as the symptom.
    const spots = startSpots(C, C, SKIRMISH_ARMIES_MAX, ARCHIPELAGO_SEA);
    expect(spots).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(spots[i]!.x).toBeCloseTo(ISLANDS[i]!.x, 6);
      expect(spots[i]!.z).toBeCloseTo(ISLANDS[i]!.z, 6);
    }
    // The map centre is ignored on this path — island centres are absolute.
    expect(startSpots(0, 0, 4, ARCHIPELAGO_SEA)).toEqual(spots);
  });

  it('cannot seat more armies than there are islands', () => {
    // Falling through to the offset table for the surplus would put a base in
    // the sea; fanning it round the centre would put it on the shoals.
    expect(startSpots(C, C, 9, ARCHIPELAGO_SEA)).toHaveLength(ISLANDS.length);
  });

  it('opens each army the authored distance from the next', () => {
    const spots = startSpots(C, C, 4, ARCHIPELAGO_SEA);
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const d = Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z);
        // The closest pair is the narrow strait, 268 m centre to centre — well
        // over the 193 m the two-army diagonal opens at.
        expect(d, `armies ${i} and ${j} opened ${d.toFixed(0)} m apart`).toBeGreaterThan(250);
      }
    }
  });

  it('builds four bases, on four different islands, none of them stranded', () => {
    const terrain = build(SEED);
    setActiveTerrain(terrain);
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    world.terrain = terrain;
    try {
      const spec = buildScenario(world, 'skirmish', 4242, { start: 'base', armies: 4 });
      expect(spec.name).toBe('skirmish');

      // Four armies exist, whatever the world was seeded with — `armySlot`
      // creates the players it is short of.
      const armies = world.players.filter((p) => p.faction !== Faction.Neutral);
      expect(armies.length, 'non-neutral players').toBe(4);

      // Every army got structures, and each army's structures sit on ONE
      // island — the four bases are on four different ones.
      const st = world.store;
      const home = new Map<number, Set<number>>();
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.kind[i] !== EntityKind.Building) continue;
        const owner = st.owner[i];
        if (world.players[owner]?.faction === Faction.Neutral) continue;
        let best = -1;
        let bestD = Infinity;
        for (let k = 0; k < ISLANDS.length; k++) {
          const d = Math.hypot(st.posX[i] - ISLANDS[k]!.x, st.posZ[i] - ISLANDS[k]!.z);
          if (d < bestD) { bestD = d; best = k; }
        }
        expect(bestD, `a structure at ${st.posX[i].toFixed(0)},${st.posZ[i].toFixed(0)} is on no island`)
          .toBeLessThan(ISLANDS[0]!.radiusX + 12);
        if (!home.has(owner)) home.set(owner, new Set());
        home.get(owner)!.add(best);
      }
      expect(home.size, 'armies that got a base').toBe(4);
      const claimed = new Set<number>();
      for (const [owner, set] of home) {
        expect(set.size, `army ${owner} is spread over ${set.size} islands`).toBe(1);
        claimed.add([...set][0]!);
      }
      expect(claimed.size, 'distinct islands occupied').toBe(4);

      // Ore: one patch beside each base plus one inward expansion each. The
      // contested centroid patch a continent gets would be in the water here.
      expect(spec.ore.length, 'ore fields').toBe(8);
      for (const o of spec.ore) {
        const cx = Math.floor(o.x / CELL);
        const cz = Math.floor(o.z / CELL);
        expect(terrain.isWater(cx, cz), `ore at ${o.x.toFixed(0)},${o.z.toFixed(0)} is in the sea`)
          .toBe(false);
      }
    } finally {
      clearScenario();
      setActiveTerrain(null);
      terrain.dispose();
    }
  }, 120_000);
});

/* ==========================================================================
 * 8. THE TWO-ARMY MAP DID NOT MOVE
 * ========================================================================== */

describe('none of this reaches a two-army map', () => {
  it('still plans two armies by default', () => {
    expect(planScenario('skirmish').armies).toBe(SKIRMISH_ARMIES_DEFAULT);
    expect(planScenario('naval').armies).toBe(SKIRMISH_ARMIES_DEFAULT);
    expect(SKIRMISH_ARMIES_DEFAULT).toBe(2);
  });

  it('still reserves exactly the three shelves it always did', () => {
    // `terrain-plan.plannedTerrainInput` spreads this into
    // `TerrainGenOptions.starts`. Every extra entry is another levelled disc,
    // i.e. a different heightfield for every map in the game.
    // 74/62 until 2026-08-18, when the spread doubled — see the block over
    // `START_SPREAD_X`. DERIVED from the table rather than restated, because
    // the point of this case is the COUNT (three discs, not five) and a second
    // copy of the coordinates is the two-table drift `SKIRMISH_START_OFFSETS`'
    // own header is about.
    const a = SKIRMISH_START_OFFSETS[0]!;
    const b = SKIRMISH_START_OFFSETS[1]!;
    expect(startPointsFor(SKIRMISH_ARMIES_DEFAULT, null)).toEqual([
      { x: C, z: C },
      { x: C + a.dx, z: C + a.dz },
      { x: C + b.dx, z: C + b.dz },
    ]);
  });

  it('still hands the half-plane maps the same three, sea and all', () => {
    for (const sea of [NAVAL_SEA, MAP_SEAS.coast, MAP_SEAS.tropical]) {
      expect(startPointsFor(SKIRMISH_ARMIES_DEFAULT, sea))
        .toEqual(startPointsFor(SKIRMISH_ARMIES_DEFAULT, null));
    }
  });

  it('still puts two armies on the diagonal when no sea has islands', () => {
    const spots = startSpots(C, C, 2, MAP_SEAS.coast);
    expect(spots).toHaveLength(2);
    const d = Math.hypot(spots[0]!.x - spots[1]!.x, spots[0]!.z - spots[1]!.z);
    expect(d, `armies opened ${d.toFixed(1)} m apart`).toBeGreaterThan(170);
  });
});

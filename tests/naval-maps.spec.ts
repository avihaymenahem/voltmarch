/**
 * ============================================================================
 * tests/naval-maps.spec.ts — THE COMBAT NAVY HAS SOMEWHERE TO EXIST
 * ============================================================================
 * The defect these tests own, stated as it was measured:
 *
 *   `NAVAL_SEA` had exactly ONE reader — `PLANS.naval`, a `?shot=` fixture that
 *   is not a playable match — and every other route through `planScenario`
 *   resolved `plan.sea ?? null` to null. Measured on the real generator at the
 *   pinned `mapSeed` and biome of all six entries in `settings-store.MAPS`,
 *   water ran 0.00%-0.16% of cells and the largest single body on any shipped
 *   map was 14 cells (224 m2). Four naval structures, nine hulls and two unlock
 *   chains were unreachable content: there was nowhere to sail, nowhere to
 *   fight, and nowhere to put a dock.
 *
 *   `contested-strait` shipped with the blurb "A shoreline through the middle.
 *   Naval yards earn their cost here" and had 23 wet cells over ten
 *   disconnected bodies.
 *
 * WHAT THESE TESTS ARE FOR, and it is not "there is some water". A puddle would
 * pass that. They measure the three things a naval game actually needs:
 *
 *   1. ONE BODY, BIG. The sea has to be a single connected expanse spanning the
 *      map, not an archipelago of ponds that happens to add up.
 *   2. NAVIGABLE END TO END, asked through the REAL `FlowFieldCache` at
 *      `MoveClass.Naval` rather than through a re-implementation of its rule.
 *      `Flowfield.rebuildCost` inverts the passability test for ships
 *      (`water && PASS_HOVER`) and a test that restated that inline would keep
 *      passing after the rule changed.
 *   3. A DOCK SITE. A buildable 3x3 footprint whose factory door can reach open
 *      water, because a Naval Yard that cannot be founded on the coast is the
 *      same unreachable content by a different route.
 *
 * AND THE LAND GAME MUST NOT HAVE MOVED. A quarter of each map became sea, so
 * the last three tests are the counterweight: the start shelves are where they
 * were to the metre, both armies are still in the main tracked region, and the
 * four landlocked maps are untouched. `tests/reachability.spec.ts` guards the
 * generator's own invariant; this guards the specific claim that adding a sea
 * did not cost anything on shore.
 *
 * All of it runs headless against the real generator, so it measures the
 * heightfield rather than the intent.
 * ============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { Terrain, setActiveTerrain, PASS_HOVER, PASS_TRACK } from '../src/world/Terrain';
import { MAP_SEAS, SKIRMISH_START_OFFSETS, planScenario } from '../src/game/Scenarios';
import { FlowFieldCache, MoveClass } from '../src/sim/Flowfield';
import {
  CELL, MAP_CELLS, MAP_SIZE, PRODUCTION,
  TERRAIN_SEA_START_CLEARANCE, TERRAIN_START_EDGE_WOBBLE, TERRAIN_START_FLAT_RADIUS,
  NAVAL_BUILDING_DIMENSIONS,
} from '../src/core/config';

/**
 * The shipped battlefields whose preset carries a sea, with the exact `mapSeed`
 * and `biome` `settings-store.MAPS` pins for them. Restated rather than
 * imported: `settings-store.ts` is the lobby's persistence layer and pulls in
 * `localStorage`, and the point of the duplication is that if someone re-rolls
 * a map's seed, THIS is the file that fails and says the sea was measured on a
 * map that no longer exists.
 */
const SEA_MAPS = [
  { id: 'contested-strait', preset: 'coast', biome: 'temperate', mapSeed: 0x0cea11 },
  { id: 'coral-shore', preset: 'tropical', biome: 'temperate', mapSeed: 0xc0aa11 },
] as const;

/** The four that must stay dry, same source. */
const LANDLOCKED = [
  { id: 'temperate-valley', preset: 'temperate', biome: 'temperate', mapSeed: 0x7e44a1 },
  { id: 'airbase-flats', preset: 'arid', biome: 'desert', mapSeed: 0x3ba9f1 },
  { id: 'frozen-sector', preset: 'snow', biome: 'snow', mapSeed: 0x51c0de },
  { id: 'industrial-grid', preset: 'urban', biome: 'urban', mapSeed: 0x1d0c17 },
] as const;

const TOTAL_CELLS = MAP_CELLS * MAP_CELLS;

/** Exactly what `terrain-plan.plannedTerrainInput` hands the generator. */
function requestedStarts(): { x: number; z: number }[] {
  return [
    { x: MAP_SIZE * 0.5, z: MAP_SIZE * 0.5 },
    ...SKIRMISH_START_OFFSETS.map((o) => ({ x: MAP_SIZE * 0.5 + o.dx, z: MAP_SIZE * 0.5 + o.dz })),
  ];
}

function build(preset: string, biome: string, mapSeed: number): Terrain {
  const t = new Terrain({
    scene: new THREE.Scene(),
    seed: mapSeed,
    biome: biome as never,
    anisotropy: 1,
    starts: requestedStarts(),
    sea: MAP_SEAS[preset] ?? null,
  });
  t.generate();
  return t;
}

interface Component {
  /** Cells in the largest 4-connected component. */
  size: number;
  /** How many components the mask has at all. */
  count: number;
  /** Total set cells. */
  total: number;
  /** One cell index inside the largest component, or -1. */
  seed: number;
  /** Label grid, 0 where the mask is clear. */
  label: Int32Array;
  /** The largest component's label. */
  main: number;
}

/** 4-connected labelling — the connectivity a grid pathfinder actually uses. */
function components(mask: Uint8Array): Component {
  const label = new Int32Array(TOTAL_CELLS);
  const stack = new Int32Array(TOTAL_CELLS);
  let next = 0;
  let best = 0;
  let main = 0;
  let seed = -1;
  let total = 0;
  for (let i = 0; i < TOTAL_CELLS; i++) if (mask[i] !== 0) total++;

  for (let start = 0; start < TOTAL_CELLS; start++) {
    if (mask[start] === 0 || label[start] !== 0) continue;
    const id = ++next;
    let sp = 0;
    stack[sp++] = start;
    label[start] = id;
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
    if (size > best) { best = size; main = id; seed = start; }
  }
  return { size: best, count: next, total, seed, label, main };
}

/** Cells this class may be ROUTED through, asked through the real nav grid. */
function navMask(nav: FlowFieldCache, cls: MoveClass): Uint8Array {
  const m = new Uint8Array(TOTAL_CELLS);
  for (let cz = 0; cz < MAP_CELLS; cz++) {
    for (let cx = 0; cx < MAP_CELLS; cx++) {
      if (nav.isPassableClass(cx, cz, cls)) m[cz * MAP_CELLS + cx] = 1;
    }
  }
  return m;
}

/** Raw water, straight off the generator. */
function waterMask(t: Terrain): Uint8Array {
  const m = new Uint8Array(TOTAL_CELLS);
  for (let i = 0; i < TOTAL_CELLS; i++) m[i] = t.waterGrid[i];
  return m;
}

interface Fixture {
  readonly id: string;
  readonly terrain: Terrain;
  readonly nav: FlowFieldCache;
  readonly water: Component;
  readonly naval: Component;
  readonly track: Component;
}

const fixtures = new Map<string, Fixture>();

beforeAll(() => {
  for (const m of SEA_MAPS) {
    const terrain = build(m.preset, m.biome, m.mapSeed);
    // `FlowFieldCache` reads `getTerrain()` for its fast path — without this it
    // falls back to the `ITerrain` port, whose naval branch skips the
    // `PASS_HOVER` test and would measure a DIFFERENT rule than the game runs.
    setActiveTerrain(terrain);
    const nav = new FlowFieldCache(terrain);
    fixtures.set(m.id, {
      id: m.id,
      terrain,
      nav,
      water: components(waterMask(terrain)),
      naval: components(navMask(nav, MoveClass.Naval)),
      track: components(navMask(nav, MoveClass.Track)),
    });
    setActiveTerrain(null);
  }
});

afterAll(() => {
  setActiveTerrain(null);
  fixtures.clear();
});

function fx(id: string): Fixture {
  const f = fixtures.get(id);
  if (f === undefined) throw new Error(`fixture ${id} was never built`);
  return f;
}

/* ========================================================================== */

describe('the sea reaches the maps that are named after it', () => {
  it('declares one for the coast and tropical presets and nothing else', () => {
    expect(Object.keys(MAP_SEAS).sort()).toEqual(['coast', 'tropical']);
    for (const m of LANDLOCKED) expect(MAP_SEAS[m.preset], m.id).toBeUndefined();
  });

  it('resolves through planScenario, which is what the terrain generator reads', () => {
    // The whole wiring, in one assertion. `plannedTerrainInput()` takes
    // `plannedScenario().sea`; before this change that was null for every
    // playable boot no matter which battlefield the lobby had chosen.
    expect(planScenario('skirmish', 'coast').sea).toEqual(MAP_SEAS.coast);
    expect(planScenario('skirmish', 'tropical').sea).toEqual(MAP_SEAS.tropical);
    expect(planScenario('skirmish', 'temperate').sea).toBeNull();
  });

  it('never overrides a fixture that authored its own shoreline', () => {
    // `buildNaval` places six hulls against `NAVAL_SEA` and
    // `assertShoreMatchesSea` fails the pair if they drift, so `?map=coast`
    // must not be able to move it. `plan.sea` wins.
    expect(planScenario('naval', 'coast').sea).not.toEqual(MAP_SEAS.coast);
    expect(planScenario('naval').sea).not.toEqual(MAP_SEAS.coast);
  });
});

/* ========================================================================== */

describe('there is a real ocean on the ground', () => {
  for (const m of SEA_MAPS) {
    it(`${m.id}: covers a sixth of the map, not a puddle`, () => {
      const f = fx(m.id);
      const frac = f.water.total / TOTAL_CELLS;
      // Measured: coast 23.7%, tropical 20.2%. The floor is well under both so
      // a biome or seed re-roll does not fail this for a rounding change, and
      // well over the 0.16% these maps used to carry.
      expect(frac, `${m.id} water fraction ${(frac * 100).toFixed(2)}%`)
        .toBeGreaterThan(0.15);
    });

    it(`${m.id}: is ONE sea, not an archipelago`, () => {
      const f = fx(m.id);
      // The number that matters is not "how much water" but "how much water in
      // the biggest piece" — 23 cells over ten ponds is what the map had
      // before, and it sums to a fraction that a coverage test would pass.
      expect(f.water.size).toBeGreaterThan(2500);
      expect(f.water.size / f.water.total).toBeGreaterThan(0.95);
    });

    it(`${m.id}: the sea a ship can actually route through spans the map`, () => {
      const f = fx(m.id);
      // Asked through `FlowFieldCache.isPassableClass(_, _, MoveClass.Naval)`,
      // which is the planner's own question — clearance rule, occupancy sync,
      // the `water && PASS_HOVER` inversion and all.
      expect(f.naval.size, `${m.id} largest navigable body`).toBeGreaterThan(2000);
      // Navigable water is water minus cliffs and the map border, so it is
      // always smaller; it must not be shattered by that subtraction.
      expect(f.naval.size / f.naval.total).toBeGreaterThan(0.9);
    });

    it(`${m.id}: is navigable END TO END, not merely large`, () => {
      const f = fx(m.id);
      // Two cells of the main body as far apart as it gets, and the fact that
      // they carry the same component label IS the path — the labelling is
      // 4-connected over the same grid the flow field expands.
      let ax = 0, az = 0, bx = 0, bz = 0, far = -1;
      const pts: number[] = [];
      for (let i = 0; i < TOTAL_CELLS; i++) if (f.naval.label[i] === f.naval.main) pts.push(i);
      // Bounding-box corners of the body, then the furthest pair among the
      // member cells nearest each corner. Cheap and deterministic.
      let minX = MAP_CELLS, maxX = -1, minZ = MAP_CELLS, maxZ = -1;
      for (const i of pts) {
        const cx = i % MAP_CELLS;
        const cz = (i / MAP_CELLS) | 0;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cz < minZ) minZ = cz;
        if (cz > maxZ) maxZ = cz;
      }
      for (const i of pts) {
        const cx = i % MAP_CELLS;
        const cz = (i / MAP_CELLS) | 0;
        for (const j of [pts[0], pts[pts.length - 1]]) {
          const jx = j % MAP_CELLS;
          const jz = (j / MAP_CELLS) | 0;
          const d = (cx - jx) * (cx - jx) + (cz - jz) * (cz - jz);
          if (d > far) { far = d; ax = cx; az = cz; bx = jx; bz = jz; }
        }
      }
      const metres = Math.hypot(ax - bx, az - bz) * CELL;
      expect(metres, `${m.id}: longest run of open water`).toBeGreaterThan(280);
      // Both ends really are routable, and really are the same body.
      expect(f.nav.isPassableClass(ax, az, MoveClass.Naval)).toBe(true);
      expect(f.nav.isPassableClass(bx, bz, MoveClass.Naval)).toBe(true);
      expect(f.naval.label[az * MAP_CELLS + ax]).toBe(f.naval.main);
      expect(f.naval.label[bz * MAP_CELLS + bx]).toBe(f.naval.main);
      // And it is wide as well as long — a one-cell channel is not a sea.
      expect((maxX - minX) * CELL).toBeGreaterThan(280);
      expect((maxZ - minZ) * CELL).toBeGreaterThan(280);
    });

    it(`${m.id}: a naval yard has somewhere to put its dock`, () => {
      const f = fx(m.id);
      const t = f.terrain;
      const w = NAVAL_BUILDING_DIMENSIONS.navalYard.w;
      const h = NAVAL_BUILDING_DIMENSIONS.navalYard.h;
      // A founding site is a fully buildable 3x3 (which by construction is dry,
      // flat and unoccupied — `buildGrid` requires `isWater === 0`) from which
      // the production spiral can reach open water. `egressSearchRings` is 5
      // cells, and the yard's own exit sits `halfDepth + exitClearance` in
      // front of the centre, so the reach from a 3x3's centre is about 8 cells.
      const reach = PRODUCTION.egressSearchRings + 3;
      const siteMask = new Uint8Array(TOTAL_CELLS);
      let sites = 0;
      for (let cz = 0; cz + h < MAP_CELLS; cz++) {
        for (let cx = 0; cx + w < MAP_CELLS; cx++) {
          let ok = true;
          for (let dz = 0; ok && dz < h; dz++) {
            for (let dx = 0; dx < w; dx++) {
              if (!t.isBuildable(cx + dx, cz + dz)) { ok = false; break; }
            }
          }
          if (!ok) continue;
          // Chebyshev ring search out to `reach` for a cell of the MAIN sea —
          // not just any water, or a landlocked pond would qualify.
          let wet = false;
          for (let dz = -reach; !wet && dz <= reach; dz++) {
            for (let dx = -reach; dx <= reach; dx++) {
              const px = cx + 1 + dx;
              const pz = cz + 1 + dz;
              if (px < 0 || pz < 0 || px >= MAP_CELLS || pz >= MAP_CELLS) continue;
              if (f.naval.label[pz * MAP_CELLS + px] === f.naval.main) { wet = true; break; }
            }
          }
          if (wet) { sites++; siteMask[cz * MAP_CELLS + cx] = 1; }
        }
      }
      const largestSitePatch = components(siteMask).size;
      // Not "at least one": a single legal tile on a 400 m coast is a needle,
      // and the player places this by dragging a ghost along the beach.
      //
      // MEASURED: contested-strait 178, coral-shore 81. The floor sits under
      // both because the two are genuinely different coasts — see the note on
      // `MAP_SEAS.tropical` — and because the number this really guards is the
      // one it started at, which was 35 in slivers no wider than 11 cells.
      expect(sites, `${m.id}: buildable 3x3 sites able to egress onto the main sea`)
        .toBeGreaterThan(50);
      // ...and they are not all one-tile slivers.
      expect(largestSitePatch, `${m.id}: biggest contiguous run of dock sites`)
        .toBeGreaterThan(15);
    });
  }
});

/* ========================================================================== */

describe('the land game did not move', () => {
  for (const m of SEA_MAPS) {
    it(`${m.id}: not one start shelf was pushed inland`, () => {
      // THE INVARIANT THE WHOLE GEOMETRY WAS CHOSEN FOR.
      //
      // `TerrainFields.resolveStarts` slides a start point along `-normal` when
      // it sits within `flatRadius + edgeWobble + bandWidth + waviness +
      // seaClearance` of the waterline. `startSpots` does NOT read the pushed
      // list back — it adds `SKIRMISH_START_OFFSETS` to shelf 0 — so any
      // non-zero push silently separates where the ground is guaranteed from
      // where the army lands. Every offset in `MAP_SEAS` clears the budget, and
      // this is the assertion that keeps it that way.
      const want = requestedStarts();
      const got = fx(m.id).terrain.startLocations();
      expect(got.length).toBe(want.length);
      for (let i = 0; i < want.length; i++) {
        expect(got[i].x, `${m.id} start ${i} x`).toBeCloseTo(want[i].x, 6);
        expect(got[i].z, `${m.id} start ${i} z`).toBeCloseTo(want[i].z, 6);
      }
    });

    it(`${m.id}: every start clears the shelf-push budget with margin`, () => {
      // The same rule stated as the arithmetic rather than as its outcome, so a
      // failure says WHICH way to move the waterline instead of only that a
      // shelf moved.
      const sea = MAP_SEAS[m.preset];
      const budget = TERRAIN_START_FLAT_RADIUS + TERRAIN_START_EDGE_WOBBLE
        + sea.bandWidth + sea.wavinessMetres + TERRAIN_SEA_START_CLEARANCE;
      for (const p of requestedStarts()) {
        const inland = -((p.x - sea.x) * sea.normalX + (p.z - sea.z) * sea.normalZ);
        expect(inland, `${m.id}: start (${p.x}, ${p.z}) is ${inland.toFixed(1)} m inland`)
          .toBeGreaterThan(budget);
      }
    });

    it(`${m.id}: both armies are still in the main tracked region`, () => {
      // The land half of reachability, on the exact configuration a player
      // boots. `tests/reachability.spec.ts` sweeps seeds and biomes but always
      // with the DEFAULT starts and no sea, so it cannot see this.
      const f = fx(m.id);
      const spots = requestedStarts();
      for (const p of spots) {
        const cx = Math.min(MAP_CELLS - 1, Math.max(0, Math.floor(p.x / CELL)));
        const cz = Math.min(MAP_CELLS - 1, Math.max(0, Math.floor(p.z / CELL)));
        expect(f.nav.isPassableClass(cx, cz, MoveClass.Track), `${m.id} start (${p.x},${p.z})`)
          .toBe(true);
        expect(f.track.label[cz * MAP_CELLS + cx], `${m.id} start (${p.x},${p.z}) region`)
          .toBe(f.track.main);
      }
      // And the sea did not carve the continent into islands: the main tracked
      // region still holds nearly all the drivable ground there is.
      expect(f.track.size / f.track.total).toBeGreaterThan(0.97);
    });

    it(`${m.id}: there is still far more land than sea`, () => {
      const f = fx(m.id);
      expect(f.track.total).toBeGreaterThan(f.naval.total * 2);
    });
  }

  for (const m of LANDLOCKED) {
    it(`${m.id}: is still bone dry`, () => {
      // No sea for these presets, so nothing about their generation changed.
      // Measured before and after: identical, 0.00%-0.16% noise-basin puddles.
      const t = build(m.preset, m.biome, m.mapSeed);
      let wet = 0;
      for (let i = 0; i < TOTAL_CELLS; i++) if (t.waterGrid[i] !== 0) wet++;
      expect(wet / TOTAL_CELLS, `${m.id} water fraction`).toBeLessThan(0.01);
      const want = requestedStarts();
      const got = t.startLocations();
      for (let i = 0; i < want.length; i++) {
        expect(got[i].x).toBeCloseTo(want[i].x, 6);
        expect(got[i].z).toBeCloseTo(want[i].z, 6);
      }
    });
  }
});

/* ========================================================================== */

describe('the sea is reproducible', () => {
  it('two generations of one map agree cell for cell', () => {
    // Determinism is not decoration here: `mapSeed` is pinned per battlefield
    // precisely so a map IS a map, and lockstep multiplayer runs the generator
    // independently on both machines.
    const m = SEA_MAPS[0];
    const a = build(m.preset, m.biome, m.mapSeed);
    const b = build(m.preset, m.biome, m.mapSeed);
    expect(a.waterGrid).toEqual(b.waterGrid);
    expect(a.passGrid).toEqual(b.passGrid);
  });

  it('water is exactly the cells the shoreline half-plane claims', () => {
    // A spot check that the carved bed follows the declared geometry rather
    // than the biome's own basins: deep inside the half-plane must be wet, deep
    // outside it must be dry, on BOTH maps and in both directions of the
    // normal. `wavinessMetres` only bends the line locally, so a 60 m standoff
    // is unambiguous.
    for (const m of SEA_MAPS) {
      const sea = MAP_SEAS[m.preset];
      const t = fx(m.id).terrain;
      for (const d of [60, 90, 120]) {
        const wetX = sea.x + sea.normalX * d;
        const wetZ = sea.z + sea.normalZ * d;
        const dryX = sea.x - sea.normalX * d;
        const dryZ = sea.z - sea.normalZ * d;
        expect(t.isWater(Math.floor(wetX / CELL), Math.floor(wetZ / CELL)), `${m.id} +${d}m`)
          .toBe(true);
        expect(t.isWater(Math.floor(dryX / CELL), Math.floor(dryZ / CELL)), `${m.id} -${d}m`)
          .toBe(false);
      }
    }
  });
});

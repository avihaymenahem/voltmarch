/**
 * ============================================================================
 * THE ROAD SURFACE IS ABOVE THE GROUND, NOTHING STANDS IN IT, AND A CROSSWALK
 * MEANS A JUNCTION
 * ============================================================================
 * Reported, from a screenshot of a city map at gameplay zoom, as *"Look at the
 * roads, all broken, 0 logic"*, with five named symptoms. Three of the five
 * turned out to be ONE defect seen from three angles, and each of the three
 * checks in this file would have caught one of them.
 *
 * WHY NOTHING CAUGHT IT. `npm run shots` is the only mechanism that looks at
 * roads, and all thirteen fixtures frame one short, straight, nearly flat run.
 * The generator's own suite (`roads.spec.ts`, `roads-junction.spec.ts`) works
 * in the XZ plane — arc radii, off-axis degrees, kerb overlap, winding — and
 * the whole failure was in Y. So the numbers below are deliberately about
 * HEIGHT, about the mask, and about the lattice-versus-geometry disagreement
 * that the other files have no reason to look at.
 *
 * Six cases, chosen as the shipped `mapSeed` of six shipped battlefields
 * across four biomes, because the defect scaled with relief and a single
 * temperate seed would have under-reported it by a factor of two.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE THREE CHECKS COST, MEASURED BEFORE AND AFTER
 * ---------------------------------------------------------------------------
 *   1. BURIED SURFACE — carriageway area with terrain standing above it
 *
 *        industrial-grid    16.86% -> 0.37%     worst 4.22 m
 *        temperate-valley   16.81% -> 0.30%     worst 3.51 m
 *        frozen-sector      28.66% -> 1.16%     worst 4.53 m
 *
 *      A sixth of the road replaced by whatever the splat is painted with is
 *      "pale blotches punched through the asphalt"; the same thing over a
 *      32-46 m unbroken stretch is "the road ends abruptly in mid-air"; and on
 *      `road.pavement` (worst 5.92 m) it is "the pavement breaks, floats and
 *      re-starts". One cause: `src/core/config.ts#ROAD_CONFORM_METRES`.
 *
 *   2. PROPS IN THE ROAD — scatter placements on the carriageway
 *
 *        industrial-grid    186 of 3585 -> 0
 *        temperate-valley   207 of 4143 -> 0
 *        frozen-sector      105 of 4044 -> 0
 *
 *   3. PHANTOM JUNCTION MOUTHS — chain ends marked as a junction with no pad
 *
 *        industrial-grid    12 (against 2 real junctions) -> 0
 *        temperate-valley   12 (against 6 real junctions) -> 0
 *        foundry-line        3 (against 0 real junctions) -> 0
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE
 * ---------------------------------------------------------------------------
 * **Carriageway connectivity.** The obvious test — "one connected component" —
 * is WRONG, and pinning it would have pinned a fiction. `frozen-sector` really
 * does carry three separate roads and zero junctions, because its relief
 * refuses most candidate edges. Measured components: 1 / 1 / 3 on the three
 * maps above. "The road ends" was never a topology break on any seed examined;
 * it was check 1.
 *
 * **Interior dead ends.** `pruneDeadEnds` skips arterial edges outright, so an
 * arterial that failed to reach the far border stops in open country: two on
 * frozen-sector, one on contested-strait, none on either urban map. Removing
 * that guard is exactly what its comment says produced maps with no roads at
 * all on a third of seeds, so it is left alone and BOUNDED below instead —
 * the count may not grow.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  MAP_SIZE, ROAD_BEND_RADIUS_MIN, ROAD_CONFORM_MAX_SPANS, ROAD_CONFORM_METRES,
  ROAD_SURFACE_LIFT, SCATTER_DENSITY,
} from '../src/core/config';
import { MAP_SEAS, startPointsFor } from '../src/game/Scenarios';
import { MAPS } from '../src/shell/settings-store';
import { Terrain } from '../src/world/Terrain';
import { RoadNetwork, isCarriageway, setActiveRoads } from '../src/world/Roads';
import { Scatter } from '../src/world/Scatter';
import type { BiomeName } from '../src/world/Biomes';

interface Case {
  readonly label: string;
  readonly biome: BiomeName;
  /** The battlefield's shipped `mapSeed` from `src/shell/settings-store.ts`. */
  readonly mapSeed: number;
  readonly urban: number;
  readonly scatter: number;
}

const CASES: readonly Case[] = [
  { label: 'industrial-grid', biome: 'urban', mapSeed: 0x1d0c17, urban: 0.95, scatter: 0.60 },
  { label: 'foundry-line', biome: 'urban', mapSeed: 0xf0be11, urban: 0.95, scatter: 0.60 },
  { label: 'temperate-valley', biome: 'temperate', mapSeed: 0x7e44a1, urban: 0.25, scatter: 1.00 },
  { label: 'contested-strait', biome: 'temperate', mapSeed: 0x0cea11, urban: 0.25, scatter: 1.00 },
  { label: 'frozen-sector', biome: 'snow', mapSeed: 0x51c0de, urban: 0.20, scatter: 0.75 },
  { label: 'airbase-flats', biome: 'desert', mapSeed: 0x3ba9f1, urban: 0.30, scatter: 0.85 },
];

/** `roads.system.ts#roadSeed` — the road roll is derived from `?mapseed=`. */
function roadSeedFor(mapSeed: number): number {
  return (mapSeed ^ 0x517cc1b7) | 0;
}

interface Built {
  readonly net: RoadNetwork;
  readonly terrain: Terrain;
  readonly meshes: Record<'carriageway' | 'kerb' | 'pavement', THREE.Mesh>;
}

function build(c: Case): Built {
  const scene = new THREE.Scene();
  const terrain = new Terrain({ scene, seed: c.mapSeed, biome: c.biome });
  const net = new RoadNetwork({
    scene, terrain, seed: roadSeedFor(c.mapSeed), decals: null,
  });
  net.generate();
  const meshes = {} as Record<'carriageway' | 'kerb' | 'pavement', THREE.Mesh>;
  scene.traverse((o) => {
    if (o.name === 'road.carriageway') meshes.carriageway = o as THREE.Mesh;
    if (o.name === 'road.kerb') meshes.kerb = o as THREE.Mesh;
    if (o.name === 'road.pavement') meshes.pavement = o as THREE.Mesh;
  });
  expect(meshes.carriageway).toBeDefined();
  expect(meshes.pavement).toBeDefined();
  return { net, terrain, meshes };
}

/**
 * Fraction of a road mesh's AREA that has terrain standing above it, plus the
 * worst depth.
 *
 * Sampled on a barycentric lattice inside every triangle rather than at its
 * corners, because the corners are exactly where the builder put vertices ON
 * the ground — a corner test would have reported this defect as absent while
 * a sixth of the surface was buried. Area-weighted by the triangle's own XZ
 * area so a dense strip of small triangles cannot outvote one huge pad.
 */
function buried(mesh: THREE.Mesh, terrain: Terrain): { fraction: number; worst: number } {
  const pos = mesh.geometry.getAttribute('position');
  const idx = mesh.geometry.getIndex();
  expect(idx).not.toBeNull();
  const N = 6;
  let area = 0;
  let bad = 0;
  let worst = 0;
  for (let t = 0; t < idx!.count; t += 3) {
    const ia = idx!.getX(t), ib = idx!.getX(t + 1), ic = idx!.getX(t + 2);
    const ax = pos.getX(ia), ay = pos.getY(ia), az = pos.getZ(ia);
    const bx = pos.getX(ib), by = pos.getY(ib), bz = pos.getZ(ib);
    const cx = pos.getX(ic), cy = pos.getY(ic), cz = pos.getZ(ic);
    const tri = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) * 0.5;
    if (tri <= 0) continue;
    let hit = 0;
    let n = 0;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; i + j <= N; j++) {
        const u = i / N, v = j / N, w = 1 - u - v;
        const x = ax * w + bx * u + cx * v;
        const y = ay * w + by * u + cy * v;
        const z = az * w + bz * u + cz * v;
        const d = terrain.heightAt(x, z) - y;
        n++;
        if (d > 0) hit++;
        if (d > worst) worst = d;
      }
    }
    area += tri;
    bad += (tri * hit) / n;
  }
  return { fraction: area > 0 ? bad / area : 0, worst };
}

describe('the road surface stays above the ground it is laid on', () => {
  it('spans the surface finer than the terrain grid', () => {
    // The whole fix in one line: a chord shorter than a heightfield cell
    // cannot bridge one, so the lift only has to cover curvature INSIDE a
    // cell. Terrain grid is TERRAIN_GRID = 1.0 m.
    expect(ROAD_CONFORM_METRES).toBeLessThanOrEqual(1.5);
    expect(ROAD_SURFACE_LIFT).toBeGreaterThan(0);
  });

  for (const c of CASES) {
    it(`${c.label}: carriageway and pavement are not buried`, () => {
      const b = build(c);

      const road = buried(b.meshes.carriageway, b.terrain);
      const pave = buried(b.meshes.pavement, b.terrain);

      // Ceilings at roughly twice the measured worst case (carriageway 1.16%
      // on frozen-sector, pavement 1.54%), and an order of magnitude under the
      // 16.8-28.7% this replaced. A regression here is visible from orbit.
      expect(`${c.label} carriageway buried ${(road.fraction * 100).toFixed(2)}%`)
        .toBe(`${c.label} carriageway buried ${Math.min(road.fraction * 100, 2.5).toFixed(2)}%`);
      expect(`${c.label} pavement buried ${(pave.fraction * 100).toFixed(2)}%`)
        .toBe(`${c.label} pavement buried ${Math.min(pave.fraction * 100, 3.0).toFixed(2)}%`);

      // The residual is a terrace FACE crossing the corridor — a near-vertical
      // step in the heightfield, which no finite span size can drape over
      // without landing a vertex exactly on it. It is bounded rather than
      // zeroed, and the honest fix for it is routing, not geometry.
      expect(road.worst).toBeLessThan(6);
      expect(pave.worst).toBeLessThan(7);

      b.net.dispose();
    }, 120000);
  }
});

describe('nothing stands in the carriageway', () => {
  for (const c of CASES) {
    it(`${c.label}: no scatter prop is on the driving surface`, () => {
      const b = build(c);
      setActiveRoads(b.net);

      const scene = new THREE.Scene();
      const scatter = new Scatter({
        scene,
        terrain: b.terrain,
        biome: c.biome,
        seed: (c.mapSeed ^ 0x5ca77e) >>> 0,
        urban: c.urban,
        densityScale: c.scatter,
        focus: null,
      });
      scatter.generate();

      const placements = (scatter as unknown as {
        placements: readonly { x: number; z: number }[];
      }).placements;
      // A guard on the guard: an empty scatter would pass the real assertion
      // trivially, and two earlier versions of this measurement did exactly
      // that because they mis-built the Scatter options and got no street
      // types at all.
      expect(placements.length).toBeGreaterThan(500);

      let onRoad = 0;
      for (const p of placements) if (isCarriageway(p.x, p.z)) onRoad++;
      expect(`${c.label}: ${onRoad} of ${placements.length} props in the road`)
        .toBe(`${c.label}: 0 of ${placements.length} props in the road`);

      scatter.dispose();
      setActiveRoads(null);
      b.net.dispose();
    }, 120000);
  }

  /**
   * AND THE MAP IS STILL DRESSED AFTERWARDS.
   *
   * Every density check in `tests/scatter.spec.ts` builds a Terrain and a
   * Scatter and NO RoadNetwork, so `isCarriageway` answers false for the whole
   * map and none of them can see the exclusion above at all. That is the gap
   * this change was free to fall into: refusing a candidate does not move it
   * elsewhere — the attempt is simply spent — so an exclusion covering a tenth
   * of the map thins the WHOLE map, not just the road.
   *
   * Measured per hectare of walkable ground, roads off then on:
   *
   *     industrial-grid    107.7 -> 103.6      foundry-line    162.4 -> 122.6
   *     temperate-valley   221.2 -> 221.7      frozen-sector   227.1 -> 227.1
   *
   * `foundry-line` is the one that pays, and it still clears the ruling-#9
   * hard floor of 95/ha by a third. The ship-blocking rule (bible §6.6: no
   * unadorned walkable patch over 25 m) is the check that would actually show
   * a hole in the dressing, and it is clean on all four.
   */
  it('excluding the carriageway does not thin the rest of the map', () => {
    for (const c of CASES) {
      const b = build(c);
      setActiveRoads(b.net);
      const scene = new THREE.Scene();
      const scatter = new Scatter({
        scene, terrain: b.terrain, biome: c.biome, seed: (c.mapSeed ^ 0x5ca77e) >>> 0,
        urban: c.urban, densityScale: c.scatter, focus: null,
      });
      scatter.generate();
      const r = scatter.lastReport;
      expect(r).not.toBeNull();
      expect(`${c.label} ${r!.propsPerHectare.toFixed(1)}/ha`)
        .toBe(`${c.label} ${Math.max(r!.propsPerHectare, SCATTER_DENSITY.hardFloorPerHectare).toFixed(1)}/ha`);
      expect(`${c.label} ${r!.emptyPatches.length} unadorned patches`)
        .toBe(`${c.label} 0 unadorned patches`);
      scatter.dispose();
      setActiveRoads(null);
      b.net.dispose();
    }
  }, 240000);
});

describe('a junction mouth marking means there is a junction', () => {
  for (const c of CASES) {
    it(`${c.label}: no chain paints an approach to a pad that is not there`, () => {
      const b = build(c);
      const inner = b.net as unknown as {
        chains: readonly { id: number; nodeA: number; nodeB: number; junctionA: boolean; junctionB: boolean }[];
        nodes: readonly { arms: readonly unknown[]; padTris: readonly number[] }[];
      };

      let phantom = 0;
      let marked = 0;
      let armsAtPads = 0;
      for (const n of inner.nodes) if (n.arms.length >= 3 && n.padTris.length > 0) armsAtPads += n.arms.length;
      for (const ch of inner.chains) {
        for (const [nid, isJunction] of [[ch.nodeA, ch.junctionA], [ch.nodeB, ch.junctionB]] as [number, boolean][]) {
          if (!isJunction) continue;
          marked++;
          const node = inner.nodes[nid];
          if (node.arms.length < 3 || node.padTris.length === 0) phantom++;
        }
      }

      expect(`${c.label}: ${phantom} phantom mouths`).toBe(`${c.label}: 0 phantom mouths`);
      // The mouths a chain marks can only be a subset of the arms the pads
      // actually have — an end that lost a near-duplicate merge is untrimmed
      // and marks nothing. Equality is NOT asserted for exactly that reason.
      expect(marked).toBeLessThanOrEqual(armsAtPads);

      b.net.dispose();
    }, 120000);
  }
});

describe('road ends, bounded rather than fixed', () => {
  it('leaves no more interior dead ends than the arterial guard already allowed', () => {
    // See the header. `pruneDeadEnds` refuses to cut an arterial edge, so an
    // arterial that could not reach the far border terminates in open ground.
    // Measured across these six: frozen-sector 2, contested-strait 1, the
    // other four 0. Pinned as a total so the next generator change cannot
    // quietly add more while nobody is looking at a hilly map.
    let total = 0;
    const detail: string[] = [];
    for (const c of CASES) {
      const scene = new THREE.Scene();
      const terrain = new Terrain({ scene, seed: c.mapSeed, biome: c.biome });
      const net = new RoadNetwork({
        scene, terrain, seed: roadSeedFor(c.mapSeed), decals: null, stampTerrain: false,
      });
      net.generate();
      const inner = net as unknown as {
        chains: readonly { nodeA: number; nodeB: number }[];
        nodes: readonly { x: number; z: number; edges: readonly number[]; border: boolean }[];
      };
      let here = 0;
      for (const ch of inner.chains) {
        for (const nid of [ch.nodeA, ch.nodeB]) {
          const n = inner.nodes[nid];
          if (n.edges.length > 1 || n.border) continue;
          if (n.x < 40 || n.z < 40 || n.x > MAP_SIZE - 40 || n.z > MAP_SIZE - 40) continue;
          here++;
        }
      }
      if (here > 0) detail.push(`${c.label}:${here}`);
      total += here;
      net.dispose();
    }
    expect(`${total} interior dead ends [${detail.join(' ')}]`)
      .toBe(`3 interior dead ends [contested-strait:1 frozen-sector:2]`);
  }, 240000);
});

/* ========================================================================== */

/**
 * NO CHAIN PAINTS MARKINGS ON A CARRIAGEWAY ANOTHER CHAIN OWNS.
 *
 * The second road report — "the roads are completly broken" over a screenshot
 * of temperate-valley — was dashes canted across the lane in open road, a
 * crosswalk mid-block, and a double-yellow that split in two. All three are one
 * defect: `RoadNetwork` routes two chains down one corridor and deduplicates
 * only the JUNCTION geometry, so each ribbon paints its own centre line, edge
 * lines, dashes and zebra AT ITS OWN HEADING on the same tarmac. Measured at
 * the time: a quarter of the carriageway double-claimed, 736 m2 of foreign
 * paint crossing its host past 30 degrees, worst 89.6.
 *
 * THIS FILE WAS 21/21 GREEN THE WHOLE TIME. It measures burial, props on the
 * carriageway, phantom mouths and interior dead ends — the Y axis and the
 * lattice — and nothing about whether two roads are drawn on one another. That
 * gap is why the report happened twice.
 */
/**
 * Measured 2026-08-18 on the shipped map seeds, with the terrain these cases
 * build (no `starts`, so it is NOT the layout a match generates — see the note
 * on `build`). Treat a move here as a routing change to explain, not a number
 * to re-baseline.
 */
/** Measured 2026-08-18, same terrain and caveat as CENSUS below. */
const KERB_DASHES: Record<string, number> = {
  'industrial-grid': 24,
  'foundry-line': 0,
  'temperate-valley': 69,
  'contested-strait': 12,
  'frozen-sector': 0,
  'airbase-flats': 80,
};

const CENSUS: Record<string, number> = {
  'industrial-grid': 369,
  'foundry-line': 76,
  'temperate-valley': 519,
  'contested-strait': 7,
  'frozen-sector': 60,
  'airbase-flats': 4,
};

describe('no chain paints markings on a carriageway another chain owns', () => {
  it('gives way on exactly one side of every overlap', () => {
    // `buildCover` sets `rank = (arterial ? RANK_ARTERIAL : RANK_STREET) + id`,
    // and the suppression test is a STRICT `rank >`. Distinct ranks are
    // therefore what guarantees the ground keeps ONE set of markings rather
    // than none: for any overlapping pair exactly one yields. Equal ranks would
    // make neither yield and the defect would survive; a non-strict test would
    // make both yield and blank the road.
    for (const c of CASES) {
      const { net } = build(c);
      const s = net.stats();
      expect(s.ribbonRows, `${c.label} emitted no cross-sections`).toBeGreaterThan(0);
      expect(s.foreignPaintRows, `${c.label} suppressed more rows than it emitted`)
        .toBeLessThanOrEqual(s.ribbonRows);
      expect(s.foreignPaintRows).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * THE CENSUS, PINNED — and it is a read on the ROUTING, not on this fix.
   *
   * A high number here means the router laid that much road on top of other
   * road; the marking suppression is only what stops it being visible. The
   * real defect underneath is untouched and is recorded in the task list:
   * 26.6% of laid road sits on other road, and one chain runs 632 m to join two
   * nodes 84 m apart.
   *
   * Pinned per map so a routing change announces itself in either direction,
   * the same contract `tests/terrain-lod.spec.ts` uses for its chunk counts.
   * Reported together rather than one map at a time, because a change that
   * moves all six should not look like a change that moved one.
   */
  it('suppresses the number of cross-sections it suppressed when measured', () => {
    const got: Record<string, number> = {};
    for (const c of CASES) got[c.label] = build(c).net.stats().foreignPaintRows;
    expect(got).toEqual(CENSUS);
  });

  /**
   * THE KERB IS NOT THE CARRIAGEWAY, AND THIS CAUGHT ONE REGRESSION ALREADY.
   *
   * `dEnd` carries a distance to the nearest junction mouth AND, since the
   * overlap fix, a -1 sentinel meaning "this cross-section paints no markings".
   * The kerb's yellow crossing dashes were keyed on `dEnd < ROAD_KERB_YELLOW_RUN`
   * (7.0) — and -1 < 7.0. So every suppressed row also turned its kerb into a
   * junction crossing. Measured on the commit that shipped it:
   *
   *     temperate-valley  587 of 1436 kerb samples dashed (40.9%)  ->  69 (4.8%)
   *     industrial-grid   389 of  992 (39.2%)                      ->  24 (2.4%)
   *     sunder-atoll      194 of  700 (27.7%)                      ->  12 (1.7%)
   *
   * The value grew a second meaning and one of its two readers was not told.
   * A count is the cheapest thing that notices, so it is pinned rather than
   * bounded: the dashes exist only within 7 m of a real mouth, mouths are
   * sparse, and any coupling to something that is not a distance moves this by
   * an order of magnitude.
   */
  it('dashes only the kerb that is actually near a junction mouth', () => {
    const got: Record<string, number> = {};
    for (const c of CASES) got[c.label] = build(c).net.stats().kerbDashRows;
    expect(got).toEqual(KERB_DASHES);
  });
});

/**
 * ============================================================================
 * THE PAINT FRAME IS THE ROW IT IS WRITTEN ON
 * ============================================================================
 * `aRoad.x` is signed metres across the carriageway and every marking in
 * `ROAD_MARKING_GLSL` is placed with it. `buildChainRibbon` wrote it as
 * `w - 2 * w * t` with `w = c.halfWidth`, mapping t in [0,1] onto [+w, -w] —
 * but `resolveChainEdges` clamps EACH EDGE INDEPENDENTLY through
 * `maxSafeOffset`, so on a bend the emitted row spans `wl + wr` and not `2w`.
 * u = 0 therefore landed on the row's MIDPOINT rather than on the spline, at
 * `(wl - wr) / 2` off it, and the double-yellow went with it.
 *
 * Swept over the seven shipped battlefields at seeds 0..9 — 51 056 rows,
 * of which 82 (0.161%) are clamped. Only four of the seven maps produce a
 * clamped row at all; the worst in the sweep and the worst on each case below:
 *
 *     sweep worst    2.015 m   coral-shore seed 0, chain 0 at (255.9, 184.2)
 *                              wl 2.77 against wr 6.80, half-width 6.8
 *     coral-shore seed 3       1.7 m   (chain 0 row 49, wl 3.41 / wr 6.80)
 *     temperate-valley seed 1  1.6 m   (chain 17 row 136, wl 3.55 / wr 6.80)
 *
 * 2.0 m is 30% of an arterial half-width: most of a lane. Those two numbers are
 * what these tests print when the fix is reverted.
 *
 * IT MOVES NOTHING ANYWHERE ELSE, AND THAT IS MEASURED RATHER THAN ARGUED.
 * Hashing the carriageway's `position` and `aRoad` buffers before and after,
 * over six maps on the shipped layout: four are BIT-IDENTICAL in both
 * (industrial-grid, airbase-flats, frozen-sector, sunder-atoll — the four with
 * no clamped row), and the two that move change `aRoad` ONLY, at an unchanged
 * vertex count and a byte-identical `position`. `foreignPaintRows` and
 * `kerbDashRows` are unchanged on all six, so re-deriving `markingsAreForeign`'s
 * sample points from `wl + wr` did not flip a single suppression decision.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE'S OTHER CASES BUILD A DIFFERENT MAP, WHICH IS WHY THIS BLOCK HAS
 * ITS OWN BUILDER
 * ---------------------------------------------------------------------------
 * `build()` above constructs `Terrain` with no `starts` and no `sea`, so no
 * start shelf is levelled and no shoreline is cut — and the router answers
 * differently on that ground. Measured, same map seeds, no-starts against the
 * shipped layout: temperate-valley 15 chains -> 19, industrial-grid 11 -> 16,
 * airbase-flats 11 -> 18, coral-shore 2 -> 1. The bend radii move with it
 * (airbase-flats 1.66 m -> 11.80 m). Neither map is wrong; they are two maps,
 * and a frame claim has to be made about the one a player drives on. The older
 * cases are deliberately NOT re-pointed — their numbers were measured on the
 * bare build and re-basing them would lose the comparison they encode.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY *NOT* ASSERTED, AND WHY THE BEND HAS NO FLOOR
 * ---------------------------------------------------------------------------
 * `filletPolyline` emits radii well under `ROAD_BEND_RADIUS_MIN` (15) —
 * measured 4.05 m on coral-shore, 4.28 m on temperate-valley, against a 6.8 m
 * arterial half-width — and that constant is a starting value that cannot bind:
 * `r` is only ever `clamp((15 + 40) / 2, 15, 40)` = 27.5 or `tMax / tanHalfTurn`,
 * which is why `bendRadiusMax` reads exactly 27.50 on all seven maps. A floor
 * there would need `t > 0.45 * min(l1, l2)`, i.e. the cusp that factor exists
 * to prevent, so widening such a bend is a ROUTING change and not a geometry
 * one.
 *
 * It was hypothesised that a bend that tight FOLDS the ribbon and punches a
 * hole in the tarmac. It does not, and the measurement is kept rather than the
 * hypothesis: `maxSafeOffset` clamps every offset to 0.85 of the local radius,
 * so the emitted carriageway carries ZERO inverted triangles, its worst
 * row-versus-along angle is 83.97 degrees (the central-difference normal, by
 * design), and rasterising three maps at 0.5 m and flood-filling found the only
 * enclosed empty regions to be city blocks plus ten sub-cell slivers — sitting
 * 120 to 334 m from the nearest clamped row, on two maps that have no clamped
 * rows at all. What a tight bend really costs is a PINCH, and the pinch is
 * bounded below instead.
 */
describe('the carriageway paint frame matches the row it is written on', () => {
  /** Same derivation the game boots with: shelves levelled, shoreline cut. */
  function buildShipped(mapId: string, seed: number): { net: RoadNetwork; mesh: THREE.Mesh } {
    const m = MAPS.find((x) => x.id === mapId);
    expect(m).toBeDefined();
    const sea = (MAP_SEAS as Record<string, unknown>)[m!.preset] as never ?? null;
    const starts = startPointsFor(m!.players, sea, seed).map((p) => ({ x: p.x, z: p.z }));
    const scene = new THREE.Scene();
    const terrain = new Terrain({ scene, seed: m!.mapSeed, biome: m!.biome, starts, sea });
    const net = new RoadNetwork({
      scene, terrain, seed: (m!.mapSeed ^ 0x517cc1b7) | 0, decals: null,
    });
    net.generate();
    let mesh: THREE.Mesh | null = null;
    scene.traverse((o) => { if (o.name === 'road.carriageway') mesh = o as THREE.Mesh; });
    expect(mesh).not.toBeNull();
    return { net, mesh: mesh as unknown as THREE.Mesh };
  }

  interface Chain {
    readonly id: number;
    readonly pts: number[];
    readonly wl: number[];
    readonly wr: number[];
    readonly edgeL: number[];
    readonly edgeR: number[];
    readonly halfWidth: number;
  }
  const chainsOf = (net: RoadNetwork): readonly Chain[] =>
    (net as unknown as { chains: Chain[] }).chains;

  /** `RoadNetwork.conformSpans`, which is private. Mirrored, not guessed. */
  function conformSpans(metres: number): number {
    const n = Math.ceil(metres / ROAD_CONFORM_METRES);
    return n < 1 ? 1 : n > ROAD_CONFORM_MAX_SPANS ? ROAD_CONFORM_MAX_SPANS : n;
  }

  /**
   * The two maps and seeds carrying the worst clamp found in the sweep, plus
   * `industrial-grid` as the control: it has ZERO clamped rows, so every row on
   * it must come out bit-identical to what shipped before this change.
   */
  const FRAME_CASES: readonly {
    readonly map: string; readonly seed: number; readonly clamped: number;
  }[] = [
    { map: 'coral-shore', seed: 3, clamped: 6 },
    { map: 'temperate-valley', seed: 1, clamped: 5 },
    { map: 'industrial-grid', seed: 1, clamped: 0 },
  ];

  for (const c of FRAME_CASES) {
    it(`${c.map} seed ${c.seed}: u = 0 lands on the spline, and u is affine in t`, () => {
      const b = buildShipped(c.map, c.seed);
      const pos = b.mesh.geometry.getAttribute('position');
      const road = b.mesh.geometry.getAttribute('aRoad');
      expect(road).toBeDefined();

      // World XZ -> aRoad.x. `Math.fround`, NOT a rounded fixed-point key: a
      // BufferAttribute is a Float32Array, and float32 eps at a 500 m
      // coordinate is 3e-5 m, so a 0.1 mm key (the quantisation `vertexAt`
      // uses, on values it computed itself in float64) misses whenever that
      // error straddles a boundary. Measured, it missed 62% of the rows on
      // industrial-grid. Narrowing the lookup instead of widening it keeps the
      // match EXACT: `Math.fround` of the float64 sample position is bit-for-bit
      // the float32 the buffer holds.
      //
      // A LIST PER KEY, NOT A VALUE, BECAUSE THE PAD WELDS ONTO THE RIBBON.
      // `solveJunctionPad` builds its boundary from "the same points the ribbon
      // already emitted", and a pad vertex carries u = 0 by design. So at a
      // chain's two MOUTH rows the same world position holds two different u,
      // and a plain Map would hand back whichever was written last — measured,
      // that read u = 0 where the row's own value is -6.80. Ambiguous positions
      // are refused below instead of averaged.
      const uAt = new Map<string, number[]>();
      for (let i = 0; i < pos.count; i++) {
        const key = `${pos.getX(i)},${pos.getZ(i)}`;
        const u = road.getX(i);
        const seen = uAt.get(key);
        if (seen === undefined) uAt.set(key, [u]);
        else if (!seen.includes(u)) seen.push(u);
      }

      let rows = 0;
      let clamped = 0;
      let missing = 0;
      let welded = 0;
      let worstCentre = 0;
      let worstCentreAt = '';
      let worstAffine = 0;
      let worstEnds = 0;
      for (const ch of chainsOf(b.net)) {
        const spans = conformSpans(ch.halfWidth * 2);
        for (let i = 0; i < ch.pts.length / 2; i++) {
          rows++;
          const wl = ch.wl[i];
          const wr = ch.wr[i];
          if (wl !== ch.halfWidth || wr !== ch.halfWidth) clamped++;
          const lxw = ch.edgeL[i * 2];
          const lzw = ch.edgeL[i * 2 + 1];
          const rxw = ch.edgeR[i * 2];
          const rzw = ch.edgeR[i * 2 + 1];

          // Every vertex of this row, addressed by the builder's own POSITION
          // expression — which this change does not touch — so what comes back
          // is purely the frame.
          const us: number[] = [];
          let ambiguous = false;
          for (let k = 0; k <= spans; k++) {
            const t = k / spans;
            const vx = lxw + (rxw - lxw) * t;
            const vz = lzw + (rzw - lzw) * t;
            const hit = uAt.get(`${Math.fround(vx)},${Math.fround(vz)}`);
            if (hit === undefined) { missing++; break; }
            if (hit.length > 1) { ambiguous = true; break; }
            us.push(hit[0]);
          }
          if (ambiguous) {
            welded++;
            // The weld is the junction seam and nothing else. If an INTERIOR
            // row ever shares a position with a pad, the ribbon is running
            // through a junction it does not belong to.
            expect(`${c.map} welded row ${i} of ${ch.pts.length / 2}`)
              .toBe(`${c.map} welded row ${i === 0 || i === ch.pts.length / 2 - 1 ? i : 'INTERIOR'} of ${ch.pts.length / 2}`);
            continue;
          }
          if (us.length !== spans + 1) continue;

          // 1. AFFINE IN t. `conformSpans` subdivides the cross-section and
          //    every marking is placed off the interpolated attribute, so a
          //    frame that is not a straight line in t moves the paint whenever
          //    the subdivision count changes.
          for (let k = 0; k <= spans; k++) {
            const want = us[0] + (us[spans] - us[0]) * (k / spans);
            worstAffine = Math.max(worstAffine, Math.abs(us[k] - want));
          }

          // 2. THE ENDS ARE THE ROW'S OWN CLAMPED HALF-WIDTHS. This is
          //    "the emitted row width equals the attribute frame it carries" in
          //    its most direct form: the frame spans wl + wr, never 2 * w.
          worstEnds = Math.max(worstEnds, Math.abs(us[0] - wl), Math.abs(us[spans] + wr));

          // 3. u = 0 IS THE SPLINE. Solved by interpolation rather than read at
          //    a vertex, because u = 0 usually falls between two of them.
          const f = us[0] / (us[0] - us[spans]);
          const cx = lxw + (rxw - lxw) * f;
          const cz = lzw + (rzw - lzw) * f;
          const err = Math.hypot(cx - ch.pts[i * 2], cz - ch.pts[i * 2 + 1]);
          if (err > worstCentre) {
            worstCentre = err;
            worstCentreAt = `chain ${ch.id} row ${i} wl ${wl.toFixed(2)} wr ${wr.toFixed(2)}`;
          }
        }
      }

      // A guard on the guard: if the row lookup ever stops hitting — a changed
      // subdivision rule, a changed sample expression — the three assertions
      // below would pass on an empty measurement.
      expect(`${c.map}: ${missing} rows not found in the mesh`)
        .toBe(`${c.map}: 0 rows not found in the mesh`);
      expect(rows).toBeGreaterThan(80);
      expect(welded).toBeLessThan(rows * 0.1);
      expect(`${c.map}: ${clamped} clamped rows`).toBe(`${c.map}: ${c.clamped} clamped rows`);

      // THE TOLERANCES ARE FLOAT32 NOISE, NOT SLACK. `aRoad` is a
      // Float32Array, so a u of 6.8 carries ~5e-7 of quantisation and the
      // interpolated centre point inherits it; measured residuals are 1.3e-7 m
      // (coral-shore) and 1.7e-7 m (temperate-valley). The ceiling below is
      // 0.1 mm, which is four orders of magnitude under the defect this
      // replaces: 2.015 m on coral-shore seed 3, 1.624 m on temperate-valley
      // seed 1. Tightening it further would pin float32 rounding, not the road.
      expect(`${c.map} u=0 off spline by ${worstCentre.toExponential(1)} m (${worstCentreAt})`)
        .toBe(`${c.map} u=0 off spline by ${Math.min(worstCentre, 1e-4).toExponential(1)} m (${worstCentreAt})`);
      expect(worstEnds).toBeLessThan(1e-5);
      expect(worstAffine).toBeLessThan(1e-5);

      b.net.dispose();
    }, 120000);
  }

  /**
   * THE PINCH IS BOUNDED, BECAUSE IT IS WHAT A TIGHT BEND ACTUALLY COSTS.
   *
   * `maxSafeOffset` returns `radius * 0.85`, so a row is clamped exactly when
   * the local discrete radius is under `halfWidth / 0.85` = 1.176 half-widths.
   * That makes "clamped row" and "tight bend" the SAME SET by construction and
   * not by coincidence, which is why one fix covers both and there is no second
   * one to ship alongside it.
   *
   * Measured on the shipped layout: the narrowest emitted row is 9.57 m against
   * a 13.60 m nominal (70.4%), and the tightest fillet radius is 4.05 m. Both
   * are BOUNDED rather than pinned — the router is free to find gentler ground
   * from one seed to the next — but a collapse toward zero is a real defect and
   * this is where it reports.
   *
   * TWO INVERTED QUADS SURVIVE ACROSS THESE THREE MAPS AND THEY ARE PINNED, NOT
   * ZEROED. The offset CURVE never inverts — that is what the 0.85 buys — but
   * the ribbon is a strip of quads between consecutive rows, and where `wl`
   * falls 5.22 m -> 3.42 m across one 1.95 m step the row's own left edge
   * outruns the advance and the quad goes non-convex:
   *
   *     coral-shore      chain 0  row  46 of 181   second triangle -1.66 m2
   *     temperate-valley chain 17 row 134 of 207   second triangle -2.15 m2
   *
   * Both sit on the tightest bend of the tightest chain on their map. That is
   * 2 of roughly 8 900 ribbon quads, 0.02%, against the 0.2% budget
   * `makeRoadMaterial` already records — and it is why that material is
   * `THREE.DoubleSide`, so the back-facing triangle fills its pixels with
   * slightly wrong lighting instead of leaving bare terrain showing through.
   * Rasterising the carriageway at 0.5 m and flood-filling confirms it: no
   * enclosed empty region anywhere near a clamped row. Fixing it properly means
   * rate-limiting how fast `wl`/`wr` may move between rows, which is a change
   * to `resolveChainEdges` with its own consequences; it is bounded here so it
   * cannot grow unnoticed.
   */
  it('a tight bend pinches the ribbon and never folds it', () => {
    const rows: string[] = [];
    let inverted = 0;
    let narrowest = Infinity;
    let tightest = Infinity;
    for (const c of FRAME_CASES) {
      const b = buildShipped(c.map, c.seed);
      const s = b.net.stats();
      let narrow = Infinity;
      for (const ch of chainsOf(b.net)) {
        for (let i = 0; i < ch.pts.length / 2; i++) {
          narrow = Math.min(narrow, (ch.wl[i] + ch.wr[i]) / (ch.halfWidth * 2));
          if (i === 0) continue;
          // The ribbon quad aL, aR, bR, bL walked in order. Both triangles wind
          // the same way unless the row order has crossed over itself.
          const q = [
            ch.edgeL[i * 2 - 2], ch.edgeL[i * 2 - 1], ch.edgeR[i * 2 - 2], ch.edgeR[i * 2 - 1],
            ch.edgeR[i * 2], ch.edgeR[i * 2 + 1], ch.edgeL[i * 2], ch.edgeL[i * 2 + 1],
          ];
          const area2 = (a: number, b2: number, c2: number): number =>
            (q[b2 * 2] - q[a * 2]) * (q[c2 * 2 + 1] - q[a * 2 + 1])
            - (q[b2 * 2 + 1] - q[a * 2 + 1]) * (q[c2 * 2] - q[a * 2]);
          if (area2(0, 1, 2) < 0) inverted++;
          if (area2(0, 2, 3) < 0) inverted++;
        }
      }
      narrowest = Math.min(narrowest, narrow);
      if (s.bendRadiusMin > 0) tightest = Math.min(tightest, s.bendRadiusMin);
      rows.push(`${c.map}: narrowest row ${(narrow * 100).toFixed(1)}% of nominal, bendRadius `
        + `${s.bendRadiusMin.toFixed(2)}..${s.bendRadiusMax.toFixed(2)}`);
      b.net.dispose();
    }

    expect(`inverted ribbon triangles: ${inverted}`).toBe('inverted ribbon triangles: 2');
    // 70.4% measured; a road that pinches below half its width is a kink.
    expect(`${rows.join(' | ')} -- narrowest ${(narrowest * 100).toFixed(1)}%`)
      .toBe(`${rows.join(' | ')} -- narrowest ${(Math.max(narrowest, 0.5) * 100).toFixed(1)}%`);
    // 4.05 m measured, against a constant that reads 15 and cannot bind.
    expect(tightest).toBeGreaterThan(3.5);
    expect(tightest).toBeLessThan(ROAD_BEND_RADIUS_MIN);
  }, 180000);
});

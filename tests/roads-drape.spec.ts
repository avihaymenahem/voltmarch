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

import { MAP_SIZE, ROAD_CONFORM_METRES, ROAD_SURFACE_LIFT, SCATTER_DENSITY } from '../src/core/config';
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

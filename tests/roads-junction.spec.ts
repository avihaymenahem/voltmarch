/**
 * WHERE TWO ROADS CROSS, THE PAVEMENT STOPS.
 *
 * The reported bug: "overlapping roads sometimes overlaps pavements as well".
 * Two road splines can legitimately share ground — A* routes two lattice edges
 * through the same terrain gap, `mergeArms` deliberately leaves the loser of a
 * merge untrimmed under the pad, and a node that drops below three arms loses
 * its pad entirely. For the CARRIAGEWAY that is a tolerable overdraw, one flat
 * dark surface over another. For the KERB AND PAVEMENT it is not: they are
 * pale, raised 0.17 m and shadow-casting, so a sidewalk running diagonally
 * across a road is exactly as obvious as it sounds.
 *
 * This file measures that, rather than judging it: it clips every pavement slab
 * triangle against every carriageway triangle and reports the overlapping area.
 *
 * THE TWO-WAY FAILURE. Too little cutback leaves the overlap. Too much opens a
 * gap in the pavement at every junction, which reads as broken pavement just as
 * badly — so the retained pavement area and the surviving corner islands are
 * pinned here too, and a "fix" that resolves the overlap by deleting the
 * sidewalk fails this file.
 *
 * MEASURED ON THESE SIX SEEDS, before the junction fix and after:
 *
 *   worst single triangle       172.88 m^2 ->   1.60 m^2
 *   pavement on carriageway      106621 m^2 ->   98.3 m^2  (full 32-seed sweep)
 *   triangles over 1 m^2 each         27550 ->        8    (full 32-seed sweep)
 *   seeds showing any of that          31/32 ->     6/32
 *   road mesh triangles              541963 ->   380631    (full 32-seed sweep)
 *
 * The last line is not a side note. Coplanar pale-on-dark geometry is overdraw
 * and a z-fighting source, and 30% of the road network's triangles were the
 * pavement and kerb of surfaces that should never have been drawn.
 *
 * The residue is not an artifact and is not zero by design. `CUT_MARGIN` is
 * 0.25 m: a sample has to be buried that deep before its pavement is cut, so
 * that fp noise on a resampled spline cannot nibble legitimate pavement away at
 * every junction mouth. A quarter of a metre of pavement overhanging the kerb
 * is hidden behind the kerb's own 0.17 m step and cannot z-fight, because the
 * two surfaces are not coplanar. Whole SLABS lying on the tarmac are the bug,
 * and that is what GROSS_OVERLAP_M2 draws the line at.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Terrain } from '../src/world/Terrain';
import { RoadNetwork, RoadSurface, ROAD_MASK_N } from '../src/world/Roads';
import { MAP_SIZE } from '../src/core/config';

/* --------------------------------------------------------------------------
 * Polygon clipping. Sutherland-Hodgman against a triangle, which is convex, so
 * the clip of a triangle by a triangle is a convex polygon of up to 6 vertices.
 * -------------------------------------------------------------------------- */

interface Tri { ax: number; az: number; bx: number; bz: number; cx: number; cz: number }

function signedArea2(t: Tri): number {
  return (t.bx - t.ax) * (t.cz - t.az) - (t.bz - t.az) * (t.cx - t.ax);
}

function clipByTriangle(poly: readonly number[], t: Tri): number[] {
  const ex = [t.ax, t.bx, t.cx];
  const ez = [t.az, t.bz, t.cz];
  let cur = poly as number[];
  for (let e = 0; e < 3; e++) {
    const x0 = ex[e], z0 = ez[e];
    const x1 = ex[(e + 1) % 3], z1 = ez[(e + 1) % 3];
    const dx = x1 - x0, dz = z1 - z0;
    const out: number[] = [];
    const n = cur.length / 2;
    if (n === 0) return out;
    for (let i = 0; i < n; i++) {
      const px = cur[i * 2], pz = cur[i * 2 + 1];
      const qx = cur[((i + 1) % n) * 2], qz = cur[((i + 1) % n) * 2 + 1];
      const sp = dx * (pz - z0) - dz * (px - x0);
      const sq = dx * (qz - z0) - dz * (qx - x0);
      if (sp >= 0) out.push(px, pz);
      if ((sp >= 0) !== (sq >= 0)) {
        const s = sp / (sp - sq);
        out.push(px + (qx - px) * s, pz + (qz - pz) * s);
      }
    }
    cur = out;
  }
  return cur;
}

function polygonArea(p: readonly number[]): number {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return Math.abs(a) * 0.5;
}

/**
 * Triangles of one road mesh, projected to XZ and normalised to positive area.
 *
 * `wantSkirt` splits the pavement mesh on `aPave.w`, which the builder sets to
 * 1 on the skirt foot and 0 on every slab vertex.
 *
 * THIS USED TO READ `aPave.z`, THE OUTER FRACTION, AND TAKE "no vertex is 0" AS
 * "this is the skirt". That worked only while the slab was exactly two vertices
 * wide, so every slab triangle was guaranteed a 0 corner. The moment the
 * pavement was subdivided across its width to stop it burying itself in the
 * terrain, the sub-quads away from the kerb had no zero corner either, 40% of
 * the sidewalk was counted as skirt, and this file failed with the pavement
 * area collapsing from 8.3k to 3.6k m^2 — a measurement artefact that reads
 * exactly like the deletion regression the floor below exists to catch. An
 * explicit flag cannot be re-derived wrongly by the next change to the mesh.
 */
function meshTriangles(mesh: THREE.Mesh, wantSkirt: boolean | null): Tri[] {
  const pos = mesh.geometry.getAttribute('position');
  const pave = mesh.geometry.getAttribute('aPave') as THREE.BufferAttribute | undefined;
  const idx = mesh.geometry.getIndex();
  expect(idx).not.toBeNull();
  const out: Tri[] = [];
  for (let i = 0; i < idx!.count; i += 3) {
    const i0 = idx!.getX(i), i1 = idx!.getX(i + 1), i2 = idx!.getX(i + 2);
    if (wantSkirt !== null && pave !== undefined) {
      const isSkirt = pave.getW(i0) > 0.5 && pave.getW(i1) > 0.5 && pave.getW(i2) > 0.5;
      if (isSkirt !== wantSkirt) continue;
    }
    let t: Tri = {
      ax: pos.getX(i0), az: pos.getZ(i0),
      bx: pos.getX(i1), bz: pos.getZ(i1),
      cx: pos.getX(i2), cz: pos.getZ(i2),
    };
    if (signedArea2(t) < 0) t = { ...t, bx: t.cx, bz: t.cz, cx: t.bx, cz: t.bz };
    if (Math.abs(signedArea2(t)) * 0.5 < 1e-4) continue;
    out.push(t);
  }
  return out;
}

/** Uniform grid over triangles, so the pairwise clip is not O(n^2). */
const GRID_METRES = 8;
function gridOf(tris: readonly Tri[]): Map<number, number[]> {
  const g = new Map<number, number[]>();
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    const x0 = Math.min(t.ax, t.bx, t.cx), x1 = Math.max(t.ax, t.bx, t.cx);
    const z0 = Math.min(t.az, t.bz, t.cz), z1 = Math.max(t.az, t.bz, t.cz);
    for (let cz = Math.floor(z0 / GRID_METRES); cz <= Math.floor(z1 / GRID_METRES); cz++) {
      for (let cx = Math.floor(x0 / GRID_METRES); cx <= Math.floor(x1 / GRID_METRES); cx++) {
        const k = cx * 100003 + cz;
        let list = g.get(k);
        if (list === undefined) { list = []; g.set(k, list); }
        list.push(i);
      }
    }
  }
  return g;
}

interface Overlap {
  /** Total overlapping area, m^2. */
  area: number;
  /** Worst single pavement triangle, m^2. */
  worst: number;
  /** Where the worst one is, for a failure message that can be looked at. */
  worstAt: string;
  /** Triangles overlapping by more than GROSS_OVERLAP_M2. */
  gross: number;
  grossArea: number;
}

/** Overlap of every triangle in `a` against the whole of `b`. */
function overlap(a: readonly Tri[], b: readonly Tri[], grossM2: number): Overlap {
  const gb = gridOf(b);
  const res: Overlap = { area: 0, worst: 0, worstAt: 'nowhere', gross: 0, grossArea: 0 };
  for (const t of a) {
    const x0 = Math.min(t.ax, t.bx, t.cx), x1 = Math.max(t.ax, t.bx, t.cx);
    const z0 = Math.min(t.az, t.bz, t.cz), z1 = Math.max(t.az, t.bz, t.cz);
    const seen = new Set<number>();
    let acc = 0;
    for (let cz = Math.floor(z0 / GRID_METRES); cz <= Math.floor(z1 / GRID_METRES); cz++) {
      for (let cx = Math.floor(x0 / GRID_METRES); cx <= Math.floor(x1 / GRID_METRES); cx++) {
        const list = gb.get(cx * 100003 + cz);
        if (list === undefined) continue;
        for (const j of list) {
          if (seen.has(j)) continue;
          seen.add(j);
          const clipped = clipByTriangle([t.ax, t.az, t.bx, t.bz, t.cx, t.cz], b[j]);
          if (clipped.length >= 6) acc += polygonArea(clipped);
        }
      }
    }
    if (acc < 0.1) continue;
    res.area += acc;
    if (acc > grossM2) { res.gross++; res.grossArea += acc; }
    if (acc > res.worst) {
      res.worst = acc;
      res.worstAt = `${((t.ax + t.bx + t.cx) / 3).toFixed(1)},${((t.az + t.bz + t.cz) / 3).toFixed(1)}`;
    }
  }
  return res;
}

function totalArea(tris: readonly Tri[]): number {
  let a = 0;
  for (const t of tris) a += Math.abs(signedArea2(t)) * 0.5;
  return a;
}

/* --------------------------------------------------------------------------
 * The measurement
 * -------------------------------------------------------------------------- */

/**
 * A pavement triangle overlapping the carriageway by more than this is a slab
 * lying on the road, not the CUT_MARGIN tolerance band.
 *
 * A pavement quad is ROAD_SAMPLE_METRES x ROAD_PAVEMENT_WIDTH = 2 x 3.2 m, so
 * one triangle is about 3.2 m^2 and the margin band along a 2 m edge is at most
 * 2 x 0.25 = 0.5 m^2. The measured worst single triangle over the full 32-seed
 * sweep is 1.60 m^2 -- a sliver where a road corner pokes between two cut
 * samples -- against 172.88 m^2 before the junction fix. 2.0 sits in the empty
 * space between "sliver" and "slab", two orders of magnitude below the bug.
 */
const GROSS_OVERLAP_M2 = 2.0;

/** Six seeds, four biomes, pinned. Every one of them showed the bug. */
const CASES: readonly (readonly [string, number])[] = [
  ['temperate', 7],
  ['temperate', 99],
  ['desert', 12513025],
  ['snow', 19090108],
  ['urban', 99],
  ['urban', 10855845],
];

interface Built {
  net: RoadNetwork;
  slab: Tri[];
  carriageway: Tri[];
  junctions: number;
}

function build(biome: string, seed: number): Built {
  const scene = new THREE.Scene();
  const terrain = new Terrain({ scene, seed: seed ^ 0x9e37, biome });
  const net = new RoadNetwork({ scene, terrain, seed, decals: null, stampTerrain: false });
  net.generate();
  let pavement: THREE.Mesh | null = null;
  let carriageway: THREE.Mesh | null = null;
  scene.traverse((o) => {
    if (o.name === 'road.pavement') pavement = o as THREE.Mesh;
    if (o.name === 'road.carriageway') carriageway = o as THREE.Mesh;
  });
  expect(pavement).not.toBeNull();
  expect(carriageway).not.toBeNull();
  return {
    net,
    slab: meshTriangles(pavement!, false),
    carriageway: meshTriangles(carriageway!, null),
    junctions: net.stats().junctions,
  };
}

describe('junction pavement does not lie on the carriageway', () => {
  for (const [biome, seed] of CASES) {
    it(`${biome} ${seed}`, () => {
      const b = build(biome, seed);
      const o = overlap(b.slab, b.carriageway, GROSS_OVERLAP_M2);

      // The bug, stated as a number. Before the fix this seed set produced
      // single triangles up to 172.88 m^2 of sidewalk lying on tarmac.
      expect(`${o.gross} gross, worst ${o.worst.toFixed(2)}m2 at ${o.worstAt}`)
        .toBe(`0 gross, worst ${o.worst.toFixed(2)}m2 at ${o.worstAt}`);
      expect(o.worst).toBeLessThan(GROSS_OVERLAP_M2);

      // And in aggregate: what is left is the CUT_MARGIN band, which is
      // bounded by the length of kerb in contact with a foreign carriageway.
      // 120 m^2 per seed is generous against a measured worst of 79 m^2 and
      // ruinous for the pre-fix state, which measured thousands.
      expect(o.area).toBeLessThan(120);

      b.net.dispose();
    }, 60000);
  }

  it('cuts the pavement back without deleting it', () => {
    // The other half of the two-way failure. A cutback that resolves every
    // overlap by removing the sidewalk is not a fix, so pin the floor: these
    // six seeds retain 8.3k m^2 of pavement slab each on average, and the
    // thinnest single seed 3.2k.
    let total = 0;
    let thinnest = Infinity;
    for (const [biome, seed] of CASES) {
      const b = build(biome, seed);
      const area = totalArea(b.slab);
      total += area;
      thinnest = Math.min(thinnest, area);
      // Pavement must still flank the roads it belongs to, everywhere.
      expect(area).toBeGreaterThan(2000);
      b.net.dispose();
    }
    expect(total / CASES.length).toBeGreaterThan(6000);
    expect(thinnest).toBeGreaterThan(2000);
  }, 120000);

  it('leaves the corner islands for scatter to plant into', () => {
    // The constraint recorded in Roads.ts: a junction pad is a STAR, not a
    // disc, and the ground it does not reach between two arms is deliberately
    // left bare so the scatter system can put a tree there. A junction fix that
    // produced clean corners by flooding them would be a regression.
    //
    // Measured against the 2 m road mask, which is what scatter reads, on a
    // ring at 60% of each pad radius -- the radius that runs through the corner
    // islands. AGGREGATED over every junction of every seed rather than
    // asserted per junction: a dense crossing legitimately leaves no island at
    // all and one of these measures 0.00. Flooding shows up as the aggregate
    // collapsing, and that is what this guards.
    let bare = 0;
    let steps = 0;
    let junctions = 0;
    for (const [biome, seed] of CASES) {
      const scene = new THREE.Scene();
      const terrain = new Terrain({ scene, seed: seed ^ 0x9e37, biome });
      const net = new RoadNetwork({ scene, terrain, seed, decals: null, stampTerrain: false });
      net.generate();
      for (const n of net.junctionCentres()) {
        const r = n.radius * 0.6;
        for (let k = 0; k < 72; k++) {
          const a = (k / 72) * Math.PI * 2;
          const x = n.x + Math.cos(a) * r;
          const z = n.z + Math.sin(a) * r;
          if (x < 0 || z < 0 || x >= MAP_SIZE || z >= MAP_SIZE) continue;
          steps++;
          if (!net.isRoad(x, z)) bare++;
        }
        junctions++;
      }
      net.dispose();
    }
    expect(junctions).toBeGreaterThan(10);
    // Measured: 0.40 of the sampled ring is plantable ground.
    expect(bare / steps).toBeGreaterThan(0.30);
  }, 120000);

  it('emits no backfacing junction pad triangles', () => {
    // A junction pad used to be a triangle fan from the node, which is a valid
    // triangulation only when the boundary is star-shaped about it. When it is
    // not, the fan lays triangles OUTSIDE the pad's own kerb line -- the tarmac
    // the stray pavement was found sitting on -- and, where a spoke crosses the
    // boundary, INVERTED ones, which render as a hole with bare terrain showing
    // through. All six of these seeds had them: 44 inverted pad triangles
    // between them, the worst 300.8 m^2.
    //
    // Scoped to the PAD, which `aRoad.w < 0` marks.
    //
    // THE RIBBON FIGURE IS NOW ZERO, AND THIS LINE USED TO ALLOW ONE. The chain
    // ribbons carried four inverted triangles across this seed set -- 0.97,
    // 1.29, 5.13 and 14.57 m^2 -- from the fold-through clamp, which looks at
    // one sample's turn and so cannot see a bend that folds over three or more.
    // The clamp is still blind in exactly that way; what changed is that
    // `MeshBuf.quadUp` refuses to emit a ribbon triangle that faces the ground,
    // and a fold-through covers its own footprint the right way up anyway. An
    // inverted triangle in a horizontal surface renders as a hole with terrain
    // through it, which is one of the things "the roads are all broken" meant,
    // so the tolerance is gone rather than widened.
    for (const [biome, seed] of CASES) {
      const scene = new THREE.Scene();
      const terrain = new Terrain({ scene, seed: seed ^ 0x9e37, biome });
      const net = new RoadNetwork({ scene, terrain, seed, decals: null, stampTerrain: false });
      net.generate();
      let mesh: THREE.Mesh | null = null;
      scene.traverse((o) => { if (o.name === 'road.carriageway') mesh = o as THREE.Mesh; });
      const g = (mesh! as THREE.Mesh).geometry;
      const pos = g.getAttribute('position');
      const aRoad = g.getAttribute('aRoad');
      const idx = g.getIndex()!;
      let pad = 0;
      let ribbon = 0;
      for (let i = 0; i < idx.count; i += 3) {
        const i0 = idx.getX(i), i1 = idx.getX(i + 1), i2 = idx.getX(i + 2);
        const ax = pos.getX(i0), az = pos.getZ(i0);
        const bx = pos.getX(i1), bz = pos.getZ(i1);
        const cx = pos.getX(i2), cz = pos.getZ(i2);
        // Every road surface in this module is wound the same way: negative
        // signed area in XZ is the winding that faces +Y.
        const sa = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
        if (sa <= 1e-4) continue;
        if (aRoad.getW(i0) < 0) pad++; else ribbon++;
      }
      expect(`${biome} ${seed}: ${pad} inverted pad`)
        .toBe(`${biome} ${seed}: 0 inverted pad`);
      expect(`${biome} ${seed}: ${ribbon} inverted ribbon`)
        .toBe(`${biome} ${seed}: 0 inverted ribbon`);
      net.dispose();
    }
  }, 120000);

  it('the mask still marks pavement outside every carriageway', () => {
    // Guard on the cut's blast radius: it removes GEOMETRY, never the mask, so
    // units keep walking on sidewalks the renderer no longer draws there. If a
    // future change routes the cut through `rasteriseMask` this fails.
    const b = build('temperate', 99);
    let pavement = 0;
    let carriageway = 0;
    for (let i = 0; i < b.net.mask.length; i++) {
      if (b.net.mask[i] >= RoadSurface.Carriageway) carriageway++;
      else if (b.net.mask[i] !== RoadSurface.None) pavement++;
    }
    expect(b.net.mask.length).toBe(ROAD_MASK_N * ROAD_MASK_N);
    expect(carriageway).toBeGreaterThan(0);
    expect(pavement).toBeGreaterThan(carriageway * 0.25);
    b.net.dispose();
  }, 60000);
});

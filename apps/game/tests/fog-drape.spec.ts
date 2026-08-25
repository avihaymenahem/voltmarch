/**
 * ============================================================================
 * tests/fog-drape.spec.ts — the shroud carpet may never sink below the ground
 * ============================================================================
 * Reported as an URBAN campaign map showing large black regions with fully-lit
 * islands of terrain floating in them: terrace tops with their vertical faces
 * visible, and the roads on them drawn at full brightness over black ground.
 *
 * THE MECHANISM. `FogOfWar` shrouds the ground with ONE draped carpet, and
 * since the split described in `FogOfWar.ts` §1b that carpet is DEPTH-TESTED —
 * it owns the ground plane, and everything standing above the ground tints
 * itself instead. The carpet's grid is `FOG_MESH_SAMPLES_PER_CELL` samples per
 * cell, which is one vertex every 4 m at the shipped value, and its constant
 * used to carry the reasoning "1 is plenty: the fog value itself is bilinear-
 * filtered in the fragment shader, so this grid only has to follow the terrain
 * SILHOUETTE".
 *
 * **THAT REASONING IS WRONG FOR TERRACED GROUND, WHICH IS ALL OF IT.** A
 * terrace is a near-vertical step inside one 4 m span. A linear span across a
 * step cuts a DIAGONAL RAMP through it: on the low side the carpet is above the
 * ground and shrouds correctly, on the high side it sits BELOW the terrain, the
 * depth test lets the terrain win, and never-explored high ground renders at
 * full daylight. Neither `TerrainMaterial` nor the road materials call
 * `applyShroudTint` — both say so, deliberately, because the carpet owns the
 * ground plane — so the roads go with it.
 *
 * WHAT THIS FILE MEASURES, AND WHY IT IS NOT A CONSTANT
 * -----------------------------------------------------
 * It builds a real `TerrainFields` and a real `FogOfWar`, takes the geometry
 * the game actually ships out of `fog.mesh.geometry`, RASTERISES it — index
 * buffer, triangle by triangle, no assumption about the triangulation or the
 * vertex order — and compares the carpet surface against `terrain.heightAt`
 * over a dense grid. A re-implemented drape formula nobody checks would be the
 * same defect wearing the other hat.
 *
 * THE FALSIFIER COMES FIRST. §1 runs the identical instrument over a POINT
 * drape — the pre-fix geometry, same grid, same step, same `heightAt` — and
 * REQUIRES it to report several per cent of the map standing above the carpet.
 * Without that, a pass here is indistinguishable from a measurement that never
 * fires, which is the vacuous-spec failure this repo has shipped more than once.
 *
 * WHAT IT DOES NOT CLAIM. Nothing about how it looks. `npm run shots` cannot
 * see any of this: the fixtures are posed on named maps with the shroud
 * disabled or revealed, and no capture frames a fogged terrace. Do not read an
 * unchanged look-bible grade as evidence about the shroud.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { FogOfWar } from '../src/render/FogOfWar';
import { TerrainFields } from '../src/world/terrain-gen';
import {
  FOG_MESH_LIFT, FOG_MESH_SAMPLES_PER_CELL, MAP_CELLS, MAP_SIZE, TERRAIN_GRID,
} from '../src/core/config';
import { MAP_SEAS, startPointsFor } from '../src/game/Scenarios';
import { BIOME_NAMES, type BiomeName } from '../src/world/Biomes';
import { CAMPAIGNS } from '../src/campaign/index';

/* ==========================================================================
 * THE INSTRUMENT
 * ========================================================================== */

/**
 * Dense sample spacing, and an offset that keeps every sample OFF a carpet
 * vertex.
 *
 * The offset is load-bearing. A first pass sampled on exact multiples of 0.5 m
 * and reported a flat 0.000% for a grid whose step was also 0.5 m — because
 * every sample point WAS a vertex, where the carpet equals the ground by
 * construction and the measurement can see nothing between them. 0.1379 is an
 * awkward fraction of every step this file uses.
 */
const SAMPLE_M = 0.5;
const SAMPLE_OFFSET = 0.1379;

interface Overshoot {
  /** Fraction of sampled points where the terrain stands above the carpet. */
  frac: number;
  /** Worst such excursion, in metres. */
  worst: number;
  /** Points sampled. */
  samples: number;
}

/**
 * Rasterise a carpet geometry and compare it against the ground beneath it.
 *
 * Walks the INDEX BUFFER and barycentrically interpolates each triangle, so it
 * makes no assumption about how `buildDrapedGrid` splits its quads or orders
 * its vertices. `covered` guards against a hole in the mesh silently reading as
 * "no overshoot here".
 */
function measureOvershoot(
  geo: THREE.BufferGeometry, heightAt: (x: number, z: number) => number,
): Overshoot {
  const pos = geo.getAttribute('position').array as ArrayLike<number>;
  const idx = geo.getIndex();
  expect(idx, 'the carpet must be indexed').not.toBeNull();
  const ind = idx!.array as ArrayLike<number>;

  const n = Math.floor((MAP_SIZE - SAMPLE_OFFSET) / SAMPLE_M) + 1;
  const carpet = new Float32Array(n * n).fill(-Infinity);

  for (let t = 0; t < ind.length; t += 3) {
    const a = ind[t] * 3; const b = ind[t + 1] * 3; const c = ind[t + 2] * 3;
    const ax = pos[a]; const ay = pos[a + 1]; const az = pos[a + 2];
    const bx = pos[b]; const by = pos[b + 1]; const bz = pos[b + 2];
    const cx = pos[c]; const cy = pos[c + 1]; const cz = pos[c + 2];

    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (den === 0) continue;
    const inv = 1 / den;

    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - SAMPLE_OFFSET) / SAMPLE_M));
    const i1 = Math.min(n - 1, Math.floor((Math.max(ax, bx, cx) - SAMPLE_OFFSET) / SAMPLE_M));
    const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - SAMPLE_OFFSET) / SAMPLE_M));
    const j1 = Math.min(n - 1, Math.floor((Math.max(az, bz, cz) - SAMPLE_OFFSET) / SAMPLE_M));

    for (let j = j0; j <= j1; j++) {
      const z = SAMPLE_OFFSET + j * SAMPLE_M;
      const row = j * n;
      for (let i = i0; i <= i1; i++) {
        const x = SAMPLE_OFFSET + i * SAMPLE_M;
        const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) * inv;
        if (w0 < 0) continue;
        const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) * inv;
        if (w1 < 0) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < 0) continue;
        const y = w0 * ay + w1 * by + w2 * cy;
        if (y > carpet[row + i]) carpet[row + i] = y;
      }
    }
  }

  let covered = 0; let above = 0; let worst = 0; let total = 0;
  for (let j = 0; j < n; j++) {
    const z = SAMPLE_OFFSET + j * SAMPLE_M;
    const row = j * n;
    for (let i = 0; i < n; i++) {
      total++;
      const y = carpet[row + i];
      if (y === -Infinity) continue;
      covered++;
      const d = heightAt(SAMPLE_OFFSET + i * SAMPLE_M, z) - y;
      if (d > 0) { above++; if (d > worst) worst = d; }
    }
  }
  // A carpet that does not span the map would read as a flawless one.
  expect(covered / total, 'the carpet must cover the whole map').toBeGreaterThan(0.999);
  return { frac: above / covered, worst, samples: covered };
}

/** The pre-fix geometry: one point sample per vertex. §1's control. */
function pointDrapedGrid(
  heightAt: (x: number, z: number) => number, spc: number,
): THREE.BufferGeometry {
  const segments = MAP_CELLS * spc;
  const n = segments + 1;
  const step = MAP_SIZE / segments;
  const positions = new Float32Array(n * n * 3);
  const indices = new Uint32Array(segments * segments * 6);
  let p = 0;
  for (let iz = 0; iz < n; iz++) {
    const z = iz * step;
    for (let ix = 0; ix < n; ix++) {
      const x = ix * step;
      positions[p] = x;
      positions[p + 1] = heightAt(x, z) + FOG_MESH_LIFT;
      positions[p + 2] = z;
      p += 3;
    }
  }
  let k = 0;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * n + ix; const b = a + 1; const c = a + n; const d = c + 1;
      indices[k] = a; indices[k + 1] = c; indices[k + 2] = b;
      indices[k + 3] = b; indices[k + 4] = c; indices[k + 5] = d;
      k += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

interface Case { label: string; biome: BiomeName; preset: string; mapSeed: number; armies: number; simSeed: number }

function terrainFor(c: Case): TerrainFields {
  const sea = MAP_SEAS[c.preset] ?? null;
  const t = new TerrainFields({
    seed: c.mapSeed,
    biome: c.biome,
    starts: startPointsFor(c.armies, sea, c.simSeed).map((p) => ({ x: p.x, z: p.z })),
    sea,
  });
  t.generate();
  return t;
}

function fogGeometryFor(t: TerrainFields): THREE.BufferGeometry {
  const scene = new THREE.Scene();
  const fog = new FogOfWar({ scene, heightAt: (x, z) => t.heightAt(x, z) });
  return fog.mesh.geometry;
}

/* -- the cases ------------------------------------------------------------ */

/** The four biomes on one map, to answer "is this terrain-shape-specific?". */
const BIOME_CASES: readonly Case[] = BIOME_NAMES.map((b) => ({
  label: `biome ${b}`, biome: b, preset: 'urban', mapSeed: 0x5e1ec7, armies: 4, simSeed: 90210,
}));

/** The reported case: a shipped URBAN campaign operation, on its own seeds. */
const URBAN_OPS: readonly Case[] = CAMPAIGNS
  .flatMap((c) => c.operations)
  .filter((o) => o.map.preset === 'urban')
  .slice(0, 2)
  .map((o) => ({
    label: o.id,
    biome: o.map.biome as BiomeName,
    preset: o.map.preset,
    mapSeed: o.map.mapSeed,
    armies: o.map.armies,
    simSeed: o.map.simSeed,
  }));

/** One coastal map, so the sea path is covered rather than assumed. */
const COASTAL: Case = {
  label: 'coast (sea carved)', biome: 'temperate', preset: 'coast',
  mapSeed: 0x5e1ec7, armies: 4, simSeed: 90210,
};

/* ==========================================================================
 * 1. THE FALSIFIER — the instrument must be able to report a failure
 * ========================================================================== */

describe('the measurement can see a carpet sinking below the ground', () => {
  it('reports several per cent of the map against the PRE-FIX point drape', () => {
    // This is the geometry that shipped, rebuilt exactly: same grid, same step,
    // same sampler, one point sample per vertex. If this comes back clean the
    // instrument is broken and every pass below is worthless.
    for (const c of URBAN_OPS) {
      const t = terrainFor(c);
      const m = measureOvershoot(pointDrapedGrid((x, z) => t.heightAt(x, z), FOG_MESH_SAMPLES_PER_CELL), (x, z) => t.heightAt(x, z));
      expect(m.frac, `${c.label}: point drape must overshoot`).toBeGreaterThan(0.02);
      expect(m.worst, `${c.label}: point drape must overshoot by metres`).toBeGreaterThan(2);
    }
  }, 120_000);

  it('reports it on every biome, so this was never urban-specific', () => {
    for (const c of BIOME_CASES) {
      const t = terrainFor(c);
      const m = measureOvershoot(pointDrapedGrid((x, z) => t.heightAt(x, z), FOG_MESH_SAMPLES_PER_CELL), (x, z) => t.heightAt(x, z));
      expect(m.frac, `${c.label}: point drape must overshoot`).toBeGreaterThan(0.02);
      expect(m.worst, `${c.label}: point drape must overshoot by metres`).toBeGreaterThan(2);
    }
  }, 120_000);

  it('is not fixed by raising the grid — a finer POINT drape still fails', () => {
    // `FOG_MESH_SAMPLES_PER_CELL` is the obvious lever and it is not the fix:
    // no finite grid follows a discontinuity. Doubling it costs four times the
    // triangles and still leaves metres of terrain standing in daylight. This
    // exists so the next person to reach for the constant is answered by a
    // failing test rather than by a paragraph.
    const c = URBAN_OPS[0];
    const t = terrainFor(c);
    const m = measureOvershoot(pointDrapedGrid((x, z) => t.heightAt(x, z), 2), (x, z) => t.heightAt(x, z));
    expect(m.frac, 'point drape at twice the resolution still overshoots').toBeGreaterThan(0.005);
    expect(m.worst, 'and still by metres').toBeGreaterThan(2);
  }, 120_000);
});

/* ==========================================================================
 * 2. THE PROPERTY — the shipped carpet never sinks below the ground
 * ========================================================================== */

/**
 * Float32 vertex storage rounds; nothing else here does. At map heights of a
 * few tens of metres that is single-digit micrometres, so a millimetre is four
 * orders of margin and still nowhere near the decimetres a real regression
 * produces.
 */
const EPS_M = 1e-3;

describe('the shipped shroud carpet is at or above the ground everywhere', () => {
  for (const c of [...BIOME_CASES, ...URBAN_OPS, COASTAL]) {
    it(`${c.label}`, () => {
      const t = terrainFor(c);
      const m = measureOvershoot(fogGeometryFor(t), (x, z) => t.heightAt(x, z));
      expect(m.samples, 'sampled the whole map densely').toBeGreaterThan(1_000_000);
      expect(m.worst, `${c.label}: terrain stands above the carpet`).toBeLessThanOrEqual(EPS_M);
      expect(m.frac, `${c.label}: fraction of the map poking through`).toBe(0);
    }, 120_000);
  }
});

describe('re-draping keeps the guarantee', () => {
  it('survives rebuildHeights, which used to re-sample per vertex', () => {
    // `rebuildHeights` walked the stored vertex XZs and wrote a POINT sample
    // back. That is the pre-fix drape restored on the first terrain
    // regeneration, silently, with the constructor still correct.
    const c = URBAN_OPS[0];
    const t = terrainFor(c);
    const scene = new THREE.Scene();
    const fog = new FogOfWar({ scene, heightAt: (x, z) => t.heightAt(x, z) });
    fog.rebuildHeights((x, z) => t.heightAt(x, z));
    const m = measureOvershoot(fog.mesh.geometry, (x, z) => t.heightAt(x, z));
    expect(m.worst).toBeLessThanOrEqual(EPS_M);
    expect(m.frac).toBe(0);
  }, 120_000);
});

/* ==========================================================================
 * 3. THE GUARANTEE IS BOUGHT BY THE DRAPE, NOT BY GEOMETRY
 * ========================================================================== */

describe('the fix costs no triangles', () => {
  it('is still one 129x129 grid, 32768 triangles, one draw call', () => {
    // Without this, §2 could be satisfied one day by quietly raising
    // `FOG_MESH_SAMPLES_PER_CELL` to 8 — which is 64x the triangles, was
    // measured NOT to reach zero, and is the thing §1 exists to refuse.
    const t = terrainFor(BIOME_CASES[0]);
    const geo = fogGeometryFor(t);
    const segments = MAP_CELLS * FOG_MESH_SAMPLES_PER_CELL;
    expect(geo.getAttribute('position').count).toBe((segments + 1) ** 2);
    expect(geo.getIndex()!.count / 3).toBe(segments * segments * 2);
    expect(FOG_MESH_SAMPLES_PER_CELL).toBe(1);
  }, 120_000);

  it('samples the ground at least as finely as the ground is defined', () => {
    // The proof that nothing can poke through rests on the maximum being taken
    // over samples no coarser than the terrain grid — otherwise the discrete
    // maximum is not the continuous one and the guarantee is only a hope.
    const step = MAP_SIZE / (MAP_CELLS * FOG_MESH_SAMPLES_PER_CELL);
    const sub = Math.max(1, Math.ceil(step / TERRAIN_GRID));
    expect(step / sub).toBeLessThanOrEqual(TERRAIN_GRID);
  });
});

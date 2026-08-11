/**
 * ============================================================================
 * VOLTMARCH — src/world/water-gen.ts
 * ============================================================================
 * THE WATER BAKE, WITH NO RENDERER ANYWHERE NEAR IT.
 *
 * Split out of `Water.ts` for the same reason `terrain-gen.ts` was split out of
 * `Terrain.ts`: the bake is 200-650 ms of unbroken main-thread time at boot and
 * the loading curtain cannot animate through any of it. Everything here is
 * arithmetic over typed arrays, so a Web Worker can run it — and therefore
 * NOTHING HERE MAY IMPORT THREE, `src/render/**` OR `src/game/**`.
 * `tests/world-workers.spec.ts` walks the import graph and fails on a violation.
 *
 * WHAT THE BAKE PRODUCES
 * ----------------------
 *   depth       signed metres of water over the bed, per field texel
 *   shore       signed metres to the waterline, positive offshore
 *   waterCells  the per-CELL mask gameplay code reads
 *   field       the RGBA8 bytes the shader samples (see `Water.ts` §1)
 *   rampDepth   the p97 depth the absorption ramp is fitted to
 *   plus coverage, max depth and coastline length for the boot log
 *
 * THE BED IS A FUNCTION, AND THAT IS THE WHOLE SEAM
 * -------------------------------------------------
 * `bakeWaterFields` takes `bedHeight(x, z)` rather than a terrain. On the main
 * thread that function is `terrain.heightAt`; in the worker it is
 * `heightAtGrid` closed over the height array the terrain job just produced —
 * and `Terrain.heightAt` is one call into that same free function, so the two
 * are not "equivalent", they are the same arithmetic. That is what makes the
 * byte-identity claim in `tests/world-workers.spec.ts` a fact about the code
 * rather than a hope about two copies of it.
 * ============================================================================
 */

import {
  MAP_CELLS, MAP_SIZE, WATER_FIELD, WATER_LOOK, WATER_SHORE,
} from '../core/config';
import { clamp, clamp01, fbm2 } from '../core/math';

/* ==========================================================================
 * 1. DERIVED LAYOUT
 * ========================================================================== */

/** Field texels along one axis. */
export const FIELD_N = WATER_FIELD.resolution;
/** Metres per field texel. */
export const FIELD_M = MAP_SIZE / FIELD_N;
export const INV_FIELD_M = 1 / FIELD_M;
/** Field texels in total. The wire guard checks lengths against this. */
export const FIELD_TEXELS = FIELD_N * FIELD_N;
/** Bytes in the packed RGBA8 field texture. */
export const FIELD_BYTES = FIELD_TEXELS * 4;

/** Anything at or below this depth is not water. */
export const MIN_DEPTH = 0.02;

/* ==========================================================================
 * 2. THE HEIGHT SOURCE PORT
 *
 * Water only needs one thing from the terrain: bed height at a world point.
 * Taking a function instead of the Terrain class keeps this module testable
 * headless, keeps it runnable in a worker, and stops it growing a dependency on
 * the terrain's internals.
 * ========================================================================== */

export type BedHeightFn = (x: number, z: number) => number;

export interface WaterBakeOptions {
  /** Bed height in metres at a world position. Usually `terrain.heightAt`. */
  readonly bedHeight: BedHeightFn;
  /** Still-water surface height. */
  readonly level: number;
  /** Seabed noise seed. */
  readonly seed: number;
}

/**
 * Everything the bake produces, as transferable typed arrays plus six scalars.
 *
 * This is the exact payload the worker reply carries. `Water.rebuild` copies
 * the arrays into its own — the live `depth` and `shore` are `readonly` fields
 * that the VFX, audio and movement modules already hold references to.
 */
export interface WaterFieldData {
  /** Identifies the bed and the settings these fields were baked from. */
  readonly key: string;
  /** Depth in metres below the waterline, per field texel. Negative on land. */
  readonly depth: Float32Array;
  /** Signed metres to the waterline: positive offshore, negative inland. */
  readonly shore: Float32Array;
  /** Per-CELL water mask, so gameplay code can ask in cell space like ITerrain. */
  readonly waterCells: Uint8Array;
  /** RGBA8 field texture bytes, length FIELD_N * FIELD_N * 4. */
  readonly field: Uint8Array;
  /** Fraction of the map below the waterline. */
  readonly coverage: number;
  /** Deepest point, metres. */
  readonly maxDepth: number;
  /** p97 depth — what the absorption ramp is fitted to. */
  readonly rampDepth: number;
  /** Metres of land/water contact on the map. */
  readonly shorelineMetres: number;
  /** Wall-clock milliseconds the bake took, measured where it ran. */
  readonly bakeMs: number;
}

/* ==========================================================================
 * 3. THE BAKE
 * ========================================================================== */

/**
 * A stable identity for one bake. See `terrainGenKey` for why this exists at
 * all: the prewarm and the eventual `new Water(...)` are reached through two
 * different code paths, so "these are the same map" is compared, never assumed.
 *
 * The bed is identified by the TERRAIN key rather than by the height array,
 * because the terrain that will be standing under this water is the one the
 * terrain prewarm produced, and that is the thing the two sides can both name.
 */
export function waterGenKey(terrainKey: string, level: number, seed: number): string {
  return `${terrainKey}|water|${level}|${seed | 0}`;
}

/**
 * Re-derive everything from the bed. Pure, synchronous, and the ONLY
 * implementation — `Water.rebuild` calls exactly this when there is no
 * prewarmed set to adopt.
 *
 * Cost is ~200-650 ms for a 512^2 field: one heightfield resample, two exact
 * euclidean distance transforms, one field pack and one histogram.
 *
 * `Date.now` rather than `performance.now`: this runs inside a worker as well as
 * on the main thread, and the number is a log line, never a sim input.
 */
export function bakeWaterFields(options: WaterBakeOptions, key = ''): WaterFieldData {
  const t0 = Date.now();
  const n = FIELD_N * FIELD_N;
  const depth = new Float32Array(n);
  const shore = new Float32Array(n);
  const waterCells = new Uint8Array(MAP_CELLS * MAP_CELLS);
  const field = new Uint8Array(n * 4);

  sampleDepth(depth, waterCells, options.bedHeight, options.level);
  buildShoreDistance(depth, shore);
  packField(depth, shore, field, options.seed);
  const stats = fitRamp(depth);

  return {
    key,
    depth,
    shore,
    waterCells,
    field,
    coverage: stats.coverage,
    maxDepth: stats.maxDepth,
    rampDepth: stats.rampDepth,
    shorelineMetres: stats.shorelineMetres,
    bakeMs: Date.now() - t0,
  };
}

/**
 * The buffers a bake owns, for `postMessage`'s transfer list. ~2.3 MB per map.
 */
export function waterFieldTransfers(data: WaterFieldData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const a of [data.depth, data.shore, data.waterCells, data.field]) {
    const buf = a.buffer;
    if (buf instanceof ArrayBuffer && !out.includes(buf)) out.push(buf);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The passes. Lifted verbatim out of `Water.ts` — same arithmetic, same order. */
/* -------------------------------------------------------------------------- */

/** Resample the bed onto the field grid and derive the cell water mask. */
function sampleDepth(
  depth: Float32Array, waterCells: Uint8Array, bedHeight: BedHeightFn, level: number,
): void {
  for (let z = 0; z < FIELD_N; z++) {
    const wz = (z + 0.5) * FIELD_M;
    const row = z * FIELD_N;
    for (let x = 0; x < FIELD_N; x++) {
      depth[row + x] = level - bedHeight((x + 0.5) * FIELD_M, wz);
    }
  }

  // Cell mask: a cell is water if its centre is. Matches ITerrain.isWater's
  // granularity so nav and water never disagree about a cell.
  const cellM = MAP_SIZE / MAP_CELLS;
  for (let cz = 0; cz < MAP_CELLS; cz++) {
    for (let cx = 0; cx < MAP_CELLS; cx++) {
      const d = sampleBilinear(depth, (cx + 0.5) * cellM, (cz + 0.5) * cellM);
      waterCells[cz * MAP_CELLS + cx] = (d > 0 ? d : 0) > MIN_DEPTH ? 1 : 0;
    }
  }
}

/**
 * Signed distance to the waterline, via two exact euclidean distance
 * transforms (Felzenszwalb & Huttenlocher, O(n) per axis).
 *
 * An approximate chamfer transform would be cheaper, but the shoreline band
 * is 2 m wide on a 1 m grid: a 5-8% distance error is a visible 10-15 cm
 * wobble in a band that scorecard #27 measures in pixels. Exact is worth
 * 8 ms once.
 */
function buildShoreDistance(depth: Float32Array, shore: Float32Array): void {
  const n = FIELD_N * FIELD_N;
  // Deliberately FINITE, not Infinity: the parabola intersection below
  // subtracts two of these, and Infinity - Infinity is NaN.
  const INF = 1e12;
  // 2 MB each and only alive during a rebuild — not worth keeping resident
  // for the whole match to save a load-time allocation.
  const land = new Float64Array(n);
  const water = new Float64Array(n);

  // Seed: distance-to-land is 0 on land; distance-to-water is 0 in water.
  for (let i = 0; i < n; i++) {
    const wet = depth[i] > 0;
    land[i] = wet ? INF : 0;
    water[i] = wet ? 0 : INF;
  }
  edt2d(land);
  edt2d(water);

  for (let i = 0; i < n; i++) {
    // Offshore: distance to the nearest land texel. Inland: negated
    // distance to the nearest water texel. The half-texel offset puts the
    // zero crossing on the contact instead of on the first wet texel.
    const s = depth[i] > 0
      ? Math.sqrt(land[i]) - 0.5
      : -(Math.sqrt(water[i]) - 0.5);
    shore[i] = s * FIELD_M;
  }
}

/* Scratch for the transform. Module-level and reused, exactly as the class
 * fields it replaces were — the bake runs once per map and never concurrently
 * with itself, on the main thread or inside a worker. */
const EDT_F = new Float64Array(FIELD_N);
const EDT_D = new Float64Array(FIELD_N);
const EDT_V = new Int32Array(FIELD_N);
const EDT_Z = new Float64Array(FIELD_N + 1);

/** In-place squared EDT of a 2D grid of 0 / INF seeds. */
function edt2d(grid: Float64Array): void {
  const f = EDT_F;
  const d = EDT_D;
  // Columns first.
  for (let x = 0; x < FIELD_N; x++) {
    for (let z = 0; z < FIELD_N; z++) f[z] = grid[z * FIELD_N + x];
    edt1d(f, d);
    for (let z = 0; z < FIELD_N; z++) grid[z * FIELD_N + x] = d[z];
  }
  // Then rows.
  for (let z = 0; z < FIELD_N; z++) {
    const row = z * FIELD_N;
    for (let x = 0; x < FIELD_N; x++) f[x] = grid[row + x];
    edt1d(f, d);
    for (let x = 0; x < FIELD_N; x++) grid[row + x] = d[x];
  }
}

/** 1D squared EDT: lower envelope of the parabolas rooted at each sample. */
function edt1d(f: Float64Array, d: Float64Array): void {
  const n = FIELD_N;
  const v = EDT_V;
  const z = EDT_Z;
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let p = v[k];
    let s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
    // Pop parabolas that have left the lower envelope. z[0] = -Infinity
    // guarantees this terminates at k = 0.
    while (s <= z[k]) {
      k--;
      p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/**
 * Encode depth, shore distance and the two seabed noises into the texture.
 *
 * The seabed noises are 18 m and 5 m features over a 512 m map — grossly
 * oversampled at the field's 1 m grid. They are generated on coarse grids
 * and bilinearly upsampled, which removes ~1.2 M simplex evaluations from
 * every bake for a difference no pixel can carry.
 */
function packField(
  depth: Float32Array, shore: Float32Array, field: Uint8Array, s: number,
): void {
  const enc = WATER_FIELD.encodeMetres;
  const shoreEnc = WATER_SHORE.encodeMetres;

  const blob = noiseGrid(128, 1 / WATER_LOOK.seabedBlobMetres, 3, s + 5);
  const grit = noiseGrid(256, 1 / (WATER_LOOK.seabedBlobMetres * 0.28), 2, s + 17);

  for (let z = 0; z < FIELD_N; z++) {
    const row = z * FIELD_N;
    for (let x = 0; x < FIELD_N; x++) {
      const i = row + x;
      const o = i * 4;

      // Signed sqrt encoding: 8 bits, ~3 cm resolution in the first metre.
      const dNorm = clamp(depth[i] / enc, -1, 1);
      const sg = dNorm < 0 ? -1 : 1;
      field[o] = enc8(0.5 + 0.5 * sg * Math.sqrt(Math.abs(dNorm)));

      field[o + 1] = enc8(0.5 + 0.5 * clamp(shore[i] / shoreEnc, -1, 1));

      // Seabed: large soft masses 0.8-4 TL across, plus one finer octave.
      // Bible §7 caps the contrast at 18-25 L units, so these are deliberately
      // low-amplitude — a high-contrast seabed reads as a swimming pool.
      field[o + 2] = enc8(0.5 + 0.42 * sampleGrid(blob, x, z));
      field[o + 3] = enc8(0.5 + 0.42 * sampleGrid(grit, x, z));
    }
  }
}

/**
 * Fit the absorption ramp to the basin that was actually generated, and
 * collect the stats the boot log prints. See `Water.ts`'s header for why.
 */
function fitRamp(depth: Float32Array): {
  coverage: number; maxDepth: number; rampDepth: number; shorelineMetres: number;
} {
  const n = FIELD_N * FIELD_N;
  let wet = 0;
  let maxDepth = 0;
  // 64-bin histogram over 0..encodeMetres is enough to find a p97.
  const BINS = 64;
  const hist = new Uint32Array(BINS);
  const binM = WATER_FIELD.encodeMetres / BINS;
  for (let i = 0; i < n; i++) {
    const d = depth[i];
    if (d <= MIN_DEPTH) continue;
    wet++;
    if (d > maxDepth) maxDepth = d;
    const b = (d / binM) | 0;
    hist[b >= BINS ? BINS - 1 : b]++;
  }

  let p97 = 0;
  if (wet > 0) {
    const target = wet * 0.97;
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += hist[b];
      if (acc >= target) { p97 = (b + 1) * binM; break; }
    }
  }

  // Shoreline length: count field texels straddling the contact. Each such
  // texel contributes about one texel edge of coastline.
  let contact = 0;
  for (let z = 1; z < FIELD_N - 1; z++) {
    const row = z * FIELD_N;
    for (let x = 1; x < FIELD_N - 1; x++) {
      const i = row + x;
      if (depth[i] <= 0) continue;
      if (depth[i - 1] <= 0 || depth[i + 1] <= 0 ||
          depth[i - FIELD_N] <= 0 || depth[i + FIELD_N] <= 0) contact++;
    }
  }

  return {
    coverage: wet / n,
    maxDepth,
    rampDepth: clamp(p97, WATER_LOOK.rampDepthMin, WATER_LOOK.rampDepthMetres),
    shorelineMetres: contact * FIELD_M,
  };
}

/* ==========================================================================
 * 4. SHARED HELPERS — `Water.ts` imports these rather than keeping a copy
 * ========================================================================== */

export function enc8(v: number): number {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return (c * 255 + 0.5) | 0;
}

interface CoarseGrid {
  readonly n: number;
  readonly data: Float32Array;
}

/** fbm over the whole map on an (n+1)^2 grid, for bilinear upsampling. */
function noiseGrid(n: number, scale: number, octaves: number, seed: number): CoarseGrid {
  const data = new Float32Array((n + 1) * (n + 1));
  const step = MAP_SIZE / n;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      data[j * (n + 1) + i] = fbm2(i * step * scale, j * step * scale, octaves, 2, 0.5, seed);
    }
  }
  return { n, data };
}

/** Bilinear read of a coarse grid at field-texel coordinates. */
function sampleGrid(g: CoarseGrid, fx: number, fz: number): number {
  const sx = (fx + 0.5) * FIELD_M * (g.n / MAP_SIZE);
  const sz = (fz + 0.5) * FIELD_M * (g.n / MAP_SIZE);
  let i0 = sx | 0; if (i0 > g.n - 1) i0 = g.n - 1;
  let j0 = sz | 0; if (j0 > g.n - 1) j0 = g.n - 1;
  const tx = sx - i0;
  const tz = sz - j0;
  const r0 = j0 * (g.n + 1) + i0;
  const r1 = r0 + (g.n + 1);
  const a = g.data[r0] + (g.data[r0 + 1] - g.data[r0]) * tx;
  const b = g.data[r1] + (g.data[r1 + 1] - g.data[r1]) * tx;
  return a + (b - a) * tz;
}

export function smoothstep01(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * Bilinear sample of a field-resolution grid at a world position. Texel
 * centres sit at (i + 0.5) metres, matching the bake and the shader's own
 * `texture2D(uField, p / MAP_SIZE)`.
 */
export function sampleBilinear(grid: Float32Array, x: number, z: number): number {
  let fx = x * INV_FIELD_M - 0.5;
  let fz = z * INV_FIELD_M - 0.5;
  if (!(fx > 0)) fx = 0; else if (fx > FIELD_N - 1) fx = FIELD_N - 1;
  if (!(fz > 0)) fz = 0; else if (fz > FIELD_N - 1) fz = FIELD_N - 1;
  let x0 = fx | 0; if (x0 > FIELD_N - 2) x0 = FIELD_N - 2;
  let z0 = fz | 0; if (z0 > FIELD_N - 2) z0 = FIELD_N - 2;
  const tx = fx - x0;
  const tz = fz - z0;
  const r0 = z0 * FIELD_N + x0;
  const r1 = r0 + FIELD_N;
  const a = grid[r0] + (grid[r0 + 1] - grid[r0]) * tx;
  const b = grid[r1] + (grid[r1 + 1] - grid[r1]) * tx;
  return a + (b - a) * tz;
}

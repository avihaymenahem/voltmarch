/**
 * ============================================================================
 * VOLTMARCH — src/world/water-texture-gen.ts
 * ============================================================================
 * THE WATER SURFACE TEXTURES, WITH NO RENDERER IN SIGHT.
 *
 * Split out of `WaterMaterial.ts` for exactly the reason `water-gen.ts` was
 * split out of `Water.ts`: so a Web Worker can run it. `WaterMaterial.ts`
 * imports THREE and `../render/FogOfWar`; a worker that reached either would
 * pull ~700 kB of renderer into a chunk that renders nothing, and
 * `tests/texture-workers.spec.ts` walks the graph and fails on it.
 *
 * This file imports `../core/math` and NOTHING ELSE. That is the whole contract.
 *
 * WHY IT WAS WORTH MOVING
 * -----------------------
 * `createWaterMaterial` measured at 230-270 ms of main-thread time on the
 * `08-naval-water` fixture — after the field BAKE had already been moved off
 * thread by `water-gen.ts`, which left the texture build as essentially the
 * entire remaining cost of `world.water`'s init. Two functions account for all
 * of it:
 *
 *   `buildWaveSlopes`  4 tileNoise calls/texel over 256², each 4 fbm evaluations
 *   `buildFoamLace`    1 tileNoise call/texel over 512², plus a 4096-bin rank
 *                      transform over the whole tile
 *
 * Neither reads a uniform, a palette or a light rig — they are pure functions of
 * `(size, seed)`. So they cross the wire as bytes and the main thread's only job
 * is to wrap them in a `DataTexture`, which is a pointer assignment.
 *
 * THE BYTES ARE THE PRODUCT, NOT A `Texture`
 * ------------------------------------------
 * A `THREE.Texture` cannot be constructed off-thread and an `ImageBitmap` cannot
 * carry these at all: the wave map's four channels are two SIGNED slope vectors
 * encoded about 0.5, not colour, and the lace is a single-channel R8. Round-
 * tripping either through an `ImageBitmap` would mean an RGBA canvas, a colour
 * space, and a premultiply step — three chances to change a value that the
 * shader reads as a derivative. Raw `Uint8Array` transferred into a `DataTexture`
 * is the same memory the synchronous path would have produced, and it is the
 * shape `TexturePool` already transfers for every other job kind.
 * ============================================================================
 */

import { clamp01, fbm2, lerp, simplex2 } from '../core/math';

/* ==========================================================================
 * 1. PERIODIC NOISE
 *
 * Both canvases must TILE. Simplex fbm does not, so every sample goes through
 * `tileNoise`, the standard four-corner torus blend: sample the same noise at
 * four offsets of one tile and bilinearly blend by position. It is exactly
 * periodic. Its one artifact — reduced variance toward the tile centre — is
 * erased for the lace by the gaussian remap below, and is invisible in a
 * slope map.
 * ========================================================================== */

/** Exactly-periodic 2D fbm over a `period`-unit torus. */
function tileNoise(
  x: number, y: number, period: number, octaves: number, seed: number,
): number {
  const u = x / period;
  const v = y / period;
  const iu = 1 - u;
  const iv = 1 - v;
  return (
    fbm2(x, y, octaves, 2, 0.5, seed) * iu * iv +
    fbm2(x - period, y, octaves, 2, 0.5, seed) * u * iv +
    fbm2(x, y - period, octaves, 2, 0.5, seed) * iu * v +
    fbm2(x - period, y - period, octaves, 2, 0.5, seed) * u * v
  );
}

/** Periodic single-octave simplex, for the domain warp. */
function tileWarp(x: number, y: number, period: number, seed: number): number {
  const u = x / period;
  const v = y / period;
  const iu = 1 - u;
  const iv = 1 - v;
  return (
    simplex2(x, y, seed) * iu * iv +
    simplex2(x - period, y, seed) * u * iv +
    simplex2(x, y - period, seed) * iu * v +
    simplex2(x - period, y - period, seed) * u * v
  );
}

/**
 * Inverse normal CDF (Acklam's rational approximation, |error| < 1.15e-9).
 * Used to push the ridge field onto a gaussian so that "what threshold gives
 * 6% coverage" has an answer instead of a guess.
 *
 * EXPORTED because `WaterMaterial.shoreChurnThreshold` inverts the same
 * distribution to solve for scorecard #27's coverage. Two copies of an inverse
 * CDF is two chances to get a threshold slightly wrong, and the symptom would
 * be foam coverage a few percent off rather than anything that looks like a bug.
 */
export function probit(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const pl = 0.02425;
  if (p <= 0) return -6;
  if (p >= 1) return 6;
  let q: number;
  let r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/* ==========================================================================
 * 2. THE TWO TILES
 * ========================================================================== */

/** Standard deviation the lace field is remapped onto. */
export const LACE_SIGMA = 0.15;

/**
 * The foam lace: a domain-warped ridge network, monotonically remapped to
 * N(0.5, LACE_SIGMA) clipped to [0,1].
 *
 * Ridges (`1 - |fbm|` squared) give the torn-lace topology the bible asks
 * for; a plain fbm thresholded high gives round blobs, which is the exact
 * scorecard #26 failure. The remap is a rank transform, so it moves no level
 * set — the filament network is bit-for-bit what the ridge produced, only the
 * value attached to each contour changes.
 */
export function buildFoamLace(size: number, seed: number): Uint8Array {
  const raw = new Float32Array(size * size);
  // ~4.4 ridge cells across the tile: at WATER_FOAM.laceTileMetres this puts
  // the filament spacing near 2.7 m, which is what makes a 6% coverage land
  // at 2-3 px wide on a 2560x1440 frame.
  const freq = 4.4;
  const warpFreq = 2.0;
  const warpAmp = 0.16;

  // The warp is two octaves of feature at warpFreq=2 over the whole tile, so
  // it is smooth to a scale of ~1/4 tile. Evaluating it per texel at 512^2
  // costs 8 simplex calls a texel for a field that a 64^2 grid resolves
  // exactly. Precompute and bilinearly upsample: 1/64th of the work, no
  // measurable difference in the output.
  const WN = 64;
  const warpX = new Float32Array((WN + 1) * (WN + 1));
  const warpY = new Float32Array((WN + 1) * (WN + 1));
  for (let j = 0; j <= WN; j++) {
    for (let i = 0; i <= WN; i++) {
      const u = (i / WN) * warpFreq;
      const v = (j / WN) * warpFreq;
      warpX[j * (WN + 1) + i] = tileWarp(u, v, warpFreq, seed + 11) * warpAmp;
      warpY[j * (WN + 1) + i] = tileWarp(u, v, warpFreq, seed + 29) * warpAmp;
    }
  }

  for (let y = 0; y < size; y++) {
    const gy = (y / size) * WN;
    const j0 = gy | 0;
    const fy = gy - j0;
    const r0 = j0 * (WN + 1);
    const r1 = r0 + (WN + 1);
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * WN;
      const i0 = gx | 0;
      const fx = gx - i0;
      // Domain warp first — an unwarped ridge network reads as a regular mesh.
      const wx = lerp(lerp(warpX[r0 + i0], warpX[r0 + i0 + 1], fx),
        lerp(warpX[r1 + i0], warpX[r1 + i0 + 1], fx), fy);
      const wy = lerp(lerp(warpY[r0 + i0], warpY[r0 + i0 + 1], fx),
        lerp(warpY[r1 + i0], warpY[r1 + i0 + 1], fx), fy);
      const px = (x / size + wx) * freq;
      const py = (y / size + wy) * freq;
      // Ridge: 1 - |fbm|, squared to sharpen the crest into a filament.
      // Three octaves: the filament WIDTH comes from the base frequency, so a
      // fourth octave only adds wiggle the gaussian remap flattens out anyway.
      const n = tileNoise(px, py, freq, 3, seed);
      const r = 1 - Math.abs(n);
      raw[y * size + x] = r * r;
    }
  }

  return gaussianRemap(raw, size, LACE_SIGMA);
}

/** Rank-transform `raw` onto N(0.5, sigma) clipped to [0,1], as 8-bit. */
function gaussianRemap(raw: Float32Array, size: number, sigma: number): Uint8Array {
  const n = size * size;
  // 4096-bin histogram is plenty: the output is 8-bit anyway.
  const BINS = 4096;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (raw[i] < lo) lo = raw[i];
    if (raw[i] > hi) hi = raw[i];
  }
  const span = hi - lo > 1e-9 ? hi - lo : 1;
  const hist = new Uint32Array(BINS);
  for (let i = 0; i < n; i++) {
    const b = ((raw[i] - lo) / span) * (BINS - 1);
    hist[b < 0 ? 0 : b > BINS - 1 ? BINS - 1 : b | 0]++;
  }
  // Cumulative -> the value each bin maps to.
  const map = new Uint8Array(BINS);
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    // Mid-rank so the extremes are not pinned to the clamp.
    const cdf = (acc + hist[b] * 0.5) / n;
    acc += hist[b];
    const g = 0.5 + sigma * probit(cdf);
    map[b] = Math.round(clamp01(g) * 255);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const b = ((raw[i] - lo) / span) * (BINS - 1);
    out[i] = map[b < 0 ? 0 : b > BINS - 1 ? BINS - 1 : b | 0];
  }
  return out;
}

/**
 * The wave slope map. RG carry band B (the visible crinkle), BA carry band C
 * (the 2-4 px micro-detail that stops the specular reading as plastic).
 *
 * Slopes, not normals: the water plane's tangent frame is the world XZ plane,
 * so d(height)/dx and d(height)/dz go straight into the fragment normal with
 * no TBN matrix and no per-vertex tangent attribute.
 */
export function buildWaveSlopes(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const midFreq = 7.0;   // ~7 crests per tile -> ~1.1 m features at an 8 m tile
  const hiFreq = 26.0;   // ~4x finer; band C
  const h1 = new Float32Array(size * size);
  const h2 = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;
      h1[i] = tileNoise(u * midFreq, v * midFreq, midFreq, 3, seed + 3);
      h2[i] = tileNoise(u * hiFreq, v * hiFreq, hiFreq, 2, seed + 7);
    }
  }

  // Central differences with wraparound — the map tiles, so the derivative
  // must tile too or a seam appears exactly where the normal is steepest.
  const scale1 = 2.6;
  const scale2 = 1.9;
  for (let y = 0; y < size; y++) {
    const yp = (y + 1) % size;
    const ym = (y + size - 1) % size;
    for (let x = 0; x < size; x++) {
      const xp = (x + 1) % size;
      const xm = (x + size - 1) % size;
      const i = y * size + x;
      const gx1 = (h1[y * size + xp] - h1[y * size + xm]) * 0.5 * scale1;
      const gy1 = (h1[yp * size + x] - h1[ym * size + x]) * 0.5 * scale1;
      const gx2 = (h2[y * size + xp] - h2[y * size + xm]) * 0.5 * scale2;
      const gy2 = (h2[yp * size + x] - h2[ym * size + x]) * 0.5 * scale2;
      const o = i * 4;
      out[o] = enc8(gx1);
      out[o + 1] = enc8(gy1);
      out[o + 2] = enc8(gx2);
      out[o + 3] = enc8(gy2);
    }
  }
  return out;
}

function enc8(v: number): number {
  return Math.round(clamp01(v * 0.5 + 0.5) * 255);
}

/* ==========================================================================
 * 3. THE JOB
 * ========================================================================== */

/**
 * Both tiles, plus the dimensions the main thread needs to wrap them.
 *
 * `waveSize` and `laceSize` travel WITH the bytes rather than being re-derived
 * on the other side. `createWaterMaterial` computes `waveSize = size >> 1` from
 * its own options, and a prewarm built against a different `WATER_TEXTURE_SIZE`
 * would otherwise be wrapped at the wrong dimensions — which is not an error,
 * it is a `DataTexture` reading past its own buffer.
 */
export interface WaterTextureData {
  /** Proves these bytes describe the material about to be built. */
  readonly key: string;
  /** RGBA8 slope map, `waveSize²·4` bytes. */
  readonly waves: Uint8Array;
  readonly waveSize: number;
  /** R8 foam ridge field, `laceSize²` bytes. */
  readonly lace: Uint8Array;
  readonly laceSize: number;
  /** Milliseconds spent generating, measured where the work happened. */
  readonly generateMs: number;
}

/**
 * The identity of a water texture set: everything `generateWaterTextures` reads.
 *
 * The PALETTE is deliberately absent. Colour enters through uniforms
 * (`uRamp`, `uFoamColor`, `uSeabed`), never through these two tiles, so a
 * `?water=arctic` override does not invalidate a prewarm — and if that ever
 * stops being true this key is the thing that has to change with it.
 */
export function waterTextureKey(size: number, seed: number): string {
  return `water-tex:${size}:${seed | 0}`;
}

/** Generate both tiles. Pure, synchronous, and the only implementation. */
export function generateWaterTextures(size: number, seed: number): WaterTextureData {
  const t0 = Date.now();
  // Half resolution for the slope map, exactly as `createWaterMaterial` does:
  // it is sampled at an 8 m and a 1.05 m tile and is heavily oversampled at
  // either. The LACE stays full size because its filament width is the thing
  // scorecard #26 measures.
  const waveSize = Math.max(64, size >> 1);
  const waves = buildWaveSlopes(waveSize, seed);
  const lace = buildFoamLace(size, seed + 101);
  return {
    key: waterTextureKey(size, seed),
    waves,
    waveSize,
    lace,
    laceSize: size,
    generateMs: Date.now() - t0,
  };
}

/** The buffers a reply owns, for `postMessage`'s transfer list. */
export function waterTextureTransfers(d: WaterTextureData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const a of [d.waves, d.lace]) {
    const buf = a.buffer;
    if (buf instanceof ArrayBuffer && !out.includes(buf)) out.push(buf);
  }
  return out;
}

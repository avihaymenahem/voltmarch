/**
 * ============================================================================
 * RED ALERT — src/core/assets.ts
 * ============================================================================
 * THE PROCEDURAL TEXTURE FACTORY.
 *
 * HARD REQUIREMENT: this game ships ZERO downloaded art. Every albedo, normal
 * and ORM map in the game is generated here from noise and code, which means
 * a critic can retune the entire material look by editing numbers in
 * config.ts and reloading — no asset pipeline, no binary files, no drift
 * between "the texture we shipped" and "the texture the code makes".
 *
 * THE PIPELINE
 * ------------
 *   1. A generator produces a `Surface`: parallel float channels
 *      (albedo RGB, height, roughness, metalness, ao, alpha) at NxN.
 *   2. `normalFromHeight` / `cavityFromHeight` / `curvatureFromHeight` derive
 *      the geometric channels from the SAME height field, so the normal map
 *      and the cavity grime always agree with each other.
 *   3. Channels are packed into GPU textures per the packing standard below
 *      and handed out as `THREE.DataTexture`.
 *   4. Everything is cached by a stable key string. The same texture is never
 *      generated twice, and an art change invalidates only the affected keys.
 *
 * THE PACKING STANDARD (normative — every generator and shader obeys it)
 * ---------------------------------------------------------------------
 *   ALBEDO : R,G,B = base colour (sRGB)   A = TEAM MASK
 *            The alpha channel says "tint this pixel with the faction colour".
 *            That is how one shared texture serves both armies.
 *   NORMAL : R,G  = tangent-space normal XY  B = CAVITY  A = CURVATURE
 *            Cavity drives grime accumulation; curvature drives edge wear.
 *            Packing them here means no extra texture fetch for either.
 *   ORM    : R = ambient occlusion  G = roughness  B = metalness
 *            A = EMISSIVE MASK
 *
 * DETERMINISM: every generator is seeded and pure. `Math.random()` is banned.
 * Two runs produce byte-identical pixels, which is what makes the screenshot
 * harness diffable.
 *
 * WORKER SAFETY: the generators below touch no DOM and no THREE. They operate
 * on plain typed arrays, so they can be moved into a Web Worker wholesale
 * (anything >= 256^2 should be) without modification.
 * ============================================================================
 */

import * as THREE from 'three';
import {
  clamp01, clamp, lerp, smoothstep, fbm2, ridged2, simplex2, worley2,
  hexToRgb, hash2f, hash2i, Rng, srgbToLinear, TAU, mixInt, hexToInt,
  luminance,
} from './math';

/* ==========================================================================
 * 1. THE SURFACE BUFFER
 * ========================================================================== */

/**
 * A generated surface, before packing. All channels are float 0..1 at NxN,
 * except `height` which is also 0..1 but is treated as a displacement field.
 *
 * Generators fill whichever channels are meaningful for them; the factory
 * packs whatever is present and substitutes sensible constants for the rest.
 */
export interface Surface {
  size: number;
  /** Interleaved RGB, length size*size*3, sRGB 0..1. */
  albedo: Float32Array;
  /** Height field, length size*size, 0..1. Drives normal/cavity/curvature. */
  height: Float32Array;
  /** Per-pixel roughness 0..1. */
  roughness: Float32Array;
  /** Per-pixel metalness 0..1. */
  metalness: Float32Array;
  /** Baked ambient occlusion 0..1 (1 = fully open). */
  ao: Float32Array;
  /** Opacity / decal alpha 0..1. */
  alpha: Float32Array;
  /** Team-tint mask 0..1, written into the albedo alpha channel. */
  teamMask: Float32Array;
  /** Emissive mask 0..1, written into the ORM alpha channel. */
  emissive: Float32Array;
}

/** Allocate an empty surface with neutral defaults. */
export function createSurface(size: number): Surface {
  const n = size * size;
  const s: Surface = {
    size,
    albedo: new Float32Array(n * 3),
    height: new Float32Array(n),
    roughness: new Float32Array(n),
    metalness: new Float32Array(n),
    ao: new Float32Array(n),
    alpha: new Float32Array(n),
    teamMask: new Float32Array(n),
    emissive: new Float32Array(n),
  };
  s.albedo.fill(0.5);
  s.height.fill(0.5);
  s.roughness.fill(0.8);
  s.ao.fill(1);
  s.alpha.fill(1);
  return s;
}

/** Write an RGB triple at pixel index i. */
function setRgb(s: Surface, i: number, r: number, g: number, b: number): void {
  const o = i * 3;
  s.albedo[o] = r; s.albedo[o + 1] = g; s.albedo[o + 2] = b;
}

/* ==========================================================================
 * 2. CHANNEL DERIVATION
 *
 * All three geometric channels come from the SAME height field, so they can
 * never disagree — a bevel that shows in the normal map always shows in the
 * curvature that drives its edge wear.
 * ========================================================================== */

/** Wrapped height sample, so derived maps tile seamlessly. */
function h(height: Float32Array, size: number, x: number, y: number): number {
  const xi = ((x % size) + size) % size;
  const yi = ((y % size) + size) % size;
  return height[yi * size + xi];
}

/**
 * Sobel-derived tangent-space normal.
 * Writes XY into `outX`/`outY` as signed -1..1. `strength` scales the slope:
 * 1.0 is subtle, 4.0 is aggressive panel-line relief.
 */
export function normalFromHeight(
  height: Float32Array, size: number, strength: number,
  outX: Float32Array, outY: Float32Array,
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel 3x3.
      const tl = h(height, size, x - 1, y - 1), t = h(height, size, x, y - 1), tr = h(height, size, x + 1, y - 1);
      const l  = h(height, size, x - 1, y),                                   r  = h(height, size, x + 1, y);
      const bl = h(height, size, x - 1, y + 1), b = h(height, size, x, y + 1), br = h(height, size, x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      // Normalize the (-dx, -dy, 1/strength) gradient normal.
      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = y * size + x;
      outX[i] = nx * inv;
      outY[i] = ny * inv;
    }
  }
}

/**
 * Cavity: how recessed a pixel is relative to its local neighbourhood.
 * 1 = flush or raised, 0 = deep in a crevice. This is what makes grime
 * collect in panel gaps instead of smearing over flat plates.
 */
export function cavityFromHeight(
  height: Float32Array, size: number, radius: number, out: Float32Array,
): void {
  const r = Math.max(1, radius | 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0, count = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          sum += h(height, size, x + dx, y + dy);
          count++;
        }
      }
      const local = sum / count;
      const self = height[y * size + x];
      // Positive when raised above the neighbourhood.
      out[y * size + x] = clamp01(0.5 + (self - local) * 4);
    }
  }
}

/**
 * Curvature: the Laplacian of the height field. High on convex EDGES, which is
 * exactly where paint wears through to bare metal. Remapped to 0..1 with 0.5
 * as flat.
 */
export function curvatureFromHeight(
  height: Float32Array, size: number, out: Float32Array,
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = height[y * size + x];
      const lap =
        h(height, size, x - 1, y) + h(height, size, x + 1, y) +
        h(height, size, x, y - 1) + h(height, size, x, y + 1) - 4 * c;
      out[y * size + x] = clamp01(0.5 - lap * 6);
    }
  }
}

/** Box blur in place, `passes` times. Cheap separable approximation of Gaussian. */
export function blur(data: Float32Array, size: number, radius: number, passes = 1): void {
  const tmp = new Float32Array(data.length);
  const r = Math.max(1, radius | 0);
  for (let p = 0; p < passes; p++) {
    // Horizontal.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let d = -r; d <= r; d++) {
          const xi = ((x + d) % size + size) % size;
          sum += data[y * size + xi];
        }
        tmp[y * size + x] = sum / (r * 2 + 1);
      }
    }
    // Vertical.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let d = -r; d <= r; d++) {
          const yi = ((y + d) % size + size) % size;
          sum += tmp[yi * size + x];
        }
        data[y * size + x] = sum / (r * 2 + 1);
      }
    }
  }
}

/** Normalize a channel to exactly 0..1. */
export function normalizeChannel(data: Float32Array): void {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < lo) lo = data[i];
    if (data[i] > hi) hi = data[i];
  }
  const d = hi - lo;
  if (d < 1e-9) return;
  const inv = 1 / d;
  for (let i = 0; i < data.length; i++) data[i] = (data[i] - lo) * inv;
}

/* ==========================================================================
 * 3. DRAWING PRIMITIVES ON A FLOAT CHANNEL
 *
 * Implemented directly on the buffers rather than via a canvas 2D context, so
 * every generator is pure, worker-safe and deterministic across browsers
 * (canvas antialiasing is NOT consistent between engines, which would break
 * screenshot diffing).
 * ========================================================================== */

/** Additive wrapped line with a soft width. Used for scratches and seams. */
export function drawLine(
  data: Float32Array, size: number,
  x0: number, y0: number, x1: number, y1: number,
  width: number, value: number,
): void {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy)));
  const w = Math.max(0.5, width);
  const wi = Math.ceil(w);
  for (let s = 0; s <= len; s++) {
    const t = s / len;
    const px = x0 + dx * t, py = y0 + dy * t;
    for (let oy = -wi; oy <= wi; oy++) {
      for (let ox = -wi; ox <= wi; ox++) {
        const d = Math.sqrt(ox * ox + oy * oy);
        if (d > w) continue;
        const fall = 1 - d / w;
        const xi = ((Math.round(px) + ox) % size + size) % size;
        const yi = ((Math.round(py) + oy) % size + size) % size;
        const i = yi * size + xi;
        data[i] = clamp01(data[i] + value * fall);
      }
    }
  }
}

/** Filled soft-edged circle. Rivets, bolts, bullet holes. */
export function drawDisc(
  data: Float32Array, size: number,
  cx: number, cy: number, radius: number, value: number, softness = 0.35,
): void {
  const r = Math.ceil(radius + 1);
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const d = Math.sqrt(ox * ox + oy * oy);
      if (d > radius) continue;
      const fall = smoothstep(radius, radius * (1 - softness), d);
      const xi = ((Math.round(cx) + ox) % size + size) % size;
      const yi = ((Math.round(cy) + oy) % size + size) % size;
      const i = yi * size + xi;
      data[i] = clamp01(data[i] + value * fall);
    }
  }
}

/** Axis-aligned rect outline — panel gaps. */
export function drawRectOutline(
  data: Float32Array, size: number,
  x: number, y: number, w: number, hgt: number, width: number, value: number,
): void {
  drawLine(data, size, x, y, x + w, y, width, value);
  drawLine(data, size, x, y + hgt, x + w, y + hgt, width, value);
  drawLine(data, size, x, y, x, y + hgt, width, value);
  drawLine(data, size, x + w, y, x + w, y + hgt, width, value);
}

/**
 * A ring of rivets around a rect perimeter — the Soviet signature.
 * `spacing` is in pixels.
 */
export function drawRivetRing(
  data: Float32Array, size: number,
  x: number, y: number, w: number, hgt: number,
  spacing: number, radius: number, value: number,
): void {
  for (let px = x; px < x + w; px += spacing) {
    drawDisc(data, size, px, y, radius, value);
    drawDisc(data, size, px, y + hgt, radius, value);
  }
  for (let py = y; py < y + hgt; py += spacing) {
    drawDisc(data, size, x, py, radius, value);
    drawDisc(data, size, x + w, py, radius, value);
  }
}

/* ==========================================================================
 * 3B. THE NOISE BUDGET
 *
 * READ THIS BEFORE ADDING ANY DETAIL LAYER.
 *
 * Red Alert 3's surfaces are CLEAN PAINTED PLASTIC. Zoom into a real RA3 frame
 * and the asphalt is a near-uniform dark grey-brown, the pavement is a
 * near-uniform pale beige, and a tank hull is large unbroken areas of flat
 * paint. ALL of the visual interest comes from crisp drawn geometry — lane
 * lines, kerbs, panel seams, insignia — and NONE of it from surface noise.
 *
 * THE ONE RULE
 * ------------
 *   If per-pixel noise is visible at normal gameplay zoom, it is wrong.
 *
 * Two things make noise visible: AMPLITUDE and FREQUENCY. A layer is safe only
 * if both are small. `NOISE_BUDGET` caps them, and `budgetedNoise()` is the
 * only sanctioned way to sample a variation field inside a clean generator —
 * it clamps BOTH, so it is arithmetically impossible to get static out of it.
 *
 * Legacy generators (section 4) predate this and deliberately violate it; they
 * are kept only so the in-flight call sites keep compiling. Do not copy them.
 * ========================================================================== */

export const NOISE_BUDGET = {
  /**
   * Maximum fractional swing a detail layer may apply to an albedo value.
   * 0.02 = +/-2% brightness. Below the ~3% JND for a large flat field under
   * game lighting, so it is FELT as variation and never SEEN as texture.
   */
  ALBEDO: 0.02,
  /** Roughness tolerates more, because it modulates a highlight, not a colour. */
  ROUGHNESS: 0.06,
  /**
   * Maximum height swing a NON-STRUCTURAL layer may contribute. Structural
   * features (seams, joints, slab edges) are exempt — they are geometry, and
   * they are what the normal map is supposed to show.
   */
  HEIGHT: 0.012,
  /** Per-slab / per-stone flat value offset. Cell-constant, so it never shimmers. */
  SLAB_VARIATION: 0.05,
  /**
   * The hard floor on feature wavelength, in TEXELS. Anything finer than this
   * aliases into static under mipmapping and at RTS camera distance. 24 texels
   * at 512 is 1/21 of the tile — a broad drift, not a grain.
   */
  MIN_FEATURE_TEXELS: 24,
} as const;

/** A band-limited, exactly-periodic field: six plane waves at integer frequencies. */
interface WaveSet {
  nx: Int32Array; ny: Int32Array; phase: Float32Array; amp: Float32Array;
}
const WAVE_HARMONICS = 6;
const waveCache = new Map<string, WaveSet>();

/**
 * Why not simplex? Because simplex noise is NOT PERIODIC, so any drift built
 * from it leaves a visible seam at the tile boundary — and a seam on a road
 * that repeats every 8 metres is far more obvious than the grain we removed.
 *
 * A sum of plane waves at INTEGER frequencies is periodic by construction,
 * band-limited by construction (so the frequency clamp is exact, not
 * approximate), and has an analytic bound on its slope. That last property is
 * what lets `NOISE_BUDGET.MIN_FEATURE_TEXELS` be a guarantee instead of a hope.
 */
function waveSet(cycles: number, seed: number): WaveSet {
  const key = `${cycles}:${seed}`;
  const hit = waveCache.get(key);
  if (hit !== undefined) return hit;

  const nx = new Int32Array(WAVE_HARMONICS), ny = new Int32Array(WAVE_HARMONICS);
  const phase = new Float32Array(WAVE_HARMONICS), amp = new Float32Array(WAVE_HARMONICS);
  let norm = 0;
  for (let k = 0; k < WAVE_HARMONICS; k++) {
    const a = hash2f(k * 7 + 1, seed) * TAU;
    // 0.55..1.0 of the base frequency: never ABOVE it, so the wavelength floor
    // holds for every component.
    const r = 0.55 + hash2f(k * 7 + 2, seed) * 0.45;
    nx[k] = Math.round(Math.cos(a) * cycles * r);
    ny[k] = Math.round(Math.sin(a) * cycles * r);
    if (nx[k] === 0 && ny[k] === 0) nx[k] = 1;
    phase[k] = hash2f(k * 7 + 3, seed);
    amp[k] = 1 / (1 + k * 0.45);
    norm += amp[k];
  }
  // Normalized so the sum is bounded by exactly 1 — the amplitude clamp below
  // is then a hard bound, not a statistical one.
  for (let k = 0; k < WAVE_HARMONICS; k++) amp[k] /= norm;

  const ws: WaveSet = { nx, ny, phase, amp };
  if (waveCache.size > 512) waveCache.clear();
  waveCache.set(key, ws);
  return ws;
}

/**
 * THE ONLY sanctioned variation source inside a clean generator.
 *
 * Returns a smooth, exactly-tiling value in [-amp, +amp] where
 * `amp = min(amplitude, budget)` and every spatial component has a wavelength
 * of at least `NOISE_BUDGET.MIN_FEATURE_TEXELS`. Both clamps are silent and
 * unconditional: you cannot ask this function for static and you cannot ask it
 * for contrast. The steepest possible one-texel step it can produce is
 * `amp * 2*PI / MIN_FEATURE_TEXELS`, which at the default budget is 0.005 —
 * two orders of magnitude below what reads as texture.
 *
 * @param x,y                pixel coordinates
 * @param size               texture size, so the field tiles with the texture
 * @param wavelengthTexels   requested feature size; clamped UP to the floor
 * @param amplitude          requested swing; clamped DOWN to `budget`
 */
export function budgetedNoise(
  x: number, y: number, size: number,
  wavelengthTexels: number, amplitude: number, seed: number,
  budget: number = NOISE_BUDGET.ALBEDO,
): number {
  const wl = Math.max(NOISE_BUDGET.MIN_FEATURE_TEXELS, wavelengthTexels);
  const amp = Math.min(Math.abs(amplitude), budget);
  if (amp <= 0) return 0;
  const cycles = Math.max(1, Math.round(size / wl));
  const w = waveSet(cycles, seed | 0);
  const u = x / size, v = y / size;
  let g = 0;
  for (let k = 0; k < WAVE_HARMONICS; k++) {
    g += w.amp[k] * Math.sin(TAU * (w.nx[k] * u + w.ny[k] * v + w.phase[k]));
  }
  return g * amp;
}

/**
 * A single very broad gradient across the whole tile — the ONLY weathering RA3
 * really has. Returns a multiplier centred on 1.0 within the albedo budget.
 * `wear` is 0..1 and maps onto the budget; at wear = 1 it is still only 2%.
 */
export function broadDrift(
  x: number, y: number, size: number, wear: number, seed: number,
  budget: number = NOISE_BUDGET.ALBEDO,
): number {
  return 1 + budgetedNoise(x, y, size, size * 0.5, clamp01(wear) * budget, seed, budget);
}

/**
 * DIAGNOSTIC. The automated form of "does this look like TV static?".
 *
 * `speckleRatio` is the fraction of texels that are a strict local extremum in
 * BOTH axes at once by more than half the albedo budget — a lone texel that
 * agrees with none of its four neighbours. That two-axis requirement is what
 * makes the metric usable: a crisp drawn line IS a one-texel extremum across
 * its width, but it continues along its length, so it scores zero. Only
 * genuinely isotropic per-pixel noise trips it.
 *
 * Uniform white noise scores about 0.44. Every clean generator scores under
 * 0.001. The threshold is set at 0.02, which is two orders of magnitude of
 * headroom in one direction and twenty times in the other.
 *
 * `maxStep` is the largest horizontal neighbour step anywhere. It is only
 * meaningful for a surface with NO drawn features (flat paint, asphalt) —
 * anywhere else, a large step is a crisp edge doing its job.
 */
export function checkNoiseBudget(s: Surface): {
  maxStep: number; speckleRatio: number; ok: boolean;
} {
  const n = s.size;
  const lum = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    lum[i] = luminance(s.albedo[i * 3], s.albedo[i * 3 + 1], s.albedo[i * 3 + 2]);
  }
  const gate = NOISE_BUDGET.ALBEDO * 0.5;
  let maxStep = 0, speckle = 0;
  for (let y = 0; y < n; y++) {
    const yUp = ((y + n - 1) % n) * n, yDn = ((y + 1) % n) * n, yc = y * n;
    for (let x = 0; x < n; x++) {
      const c = lum[yc + x];
      const dl = c - lum[yc + ((x + n - 1) % n)];
      const dr = c - lum[yc + ((x + 1) % n)];
      const du = c - lum[yUp + x];
      const dd = c - lum[yDn + x];
      const step = Math.max(Math.abs(dl), Math.abs(dr));
      if (step > maxStep) maxStep = step;
      if (dl * dr > 0 && Math.abs(dl) > gate && Math.abs(dr) > gate
        && du * dd > 0 && Math.abs(du) > gate && Math.abs(dd) > gate) speckle++;
    }
  }
  const speckleRatio = speckle / (n * n);
  return { maxStep, speckleRatio, ok: speckleRatio < 0.02 };
}

/* ==========================================================================
 * 3C. CRISP VECTOR RASTERIZATION
 *
 * The clean generators draw SHAPES, not noise. Canvas 2D is still banned here
 * (its antialiasing differs between engines and would break screenshot
 * diffing), so shapes are rasterized from an exact signed distance field with
 * a one-texel linear ramp at the boundary. That gives:
 *
 *   - hard edges (a lane line is 2 texels wide and looks it),
 *   - exactly 1 texel of antialiasing, no more,
 *   - byte-identical output on every engine,
 *   - free stroking: |sdf| - halfWidth is the outline of any fill.
 *
 * Everything writes COVERAGE (0..1) into a scratch channel with a max()
 * composite, so overlapping strokes never double-darken.
 * ========================================================================== */

/** A closed polygon as flat [x0,y0,x1,y1,...] in NORMALIZED 0..1 UV. */
export type Polygon = readonly number[];

/** Named clean shapes. All are drawn as real paths — none are noise-derived. */
export type DecalShape =
  /** Soviet five-point star, point up. */
  | 'star5'
  /** Three-point star. */
  | 'star3'
  /** Equilateral triangle, point up. */
  | 'triangle'
  /** Plus / cross. */
  | 'cross'
  /** Chevron band, point up. Tiles vertically. */
  | 'chevron'
  /** Road "straight on" arrow. */
  | 'arrowStraight'
  /** Road "turn" arrow — the exact shape in the RA3 city-road reference. */
  | 'arrowTurn'
  /** Dashed lane line segment. Tiles vertically into a dashed line. */
  | 'laneDash'
  /** Continuous lane line. Tiles vertically. */
  | 'laneSolid'
  /** Zebra crossing bars. Tiles vertically. */
  | 'crosswalk'
  /** 45-degree hazard stripes. Tiles in both axes. */
  | 'hazardStripes'
  /** Filled disc. */
  | 'disc'
  /** Annulus. */
  | 'ring'
  /** Horizontal bar across the tile. Tiles vertically. */
  | 'bar'
  /** Up to three 7-segment digits from `glyph`. Unit hull numbers. */
  | 'numeral';

/** Either a named shape or an explicit list of closed polygons in 0..1 UV. */
export type DecalPath = DecalShape | readonly Polygon[];

/** Panel seam layouts for `panelLines`. */
export type PanelLayout =
  /** Regular NxN cell grid. Hull plates, wall panels. */
  | 'grid'
  /** Horizontal courses with a few vertical dividers. Building facades. */
  | 'rows'
  /** Concentric rings plus spokes. Turret tops, domes, pads. */
  | 'radial'
  /** Rows subdivided into unequal columns. The classic mechanical greeble. */
  | 'greeble';

/**
 * Antialiased coverage from a signed distance in texels.
 * `d < -0.5` is fully inside, `d > 0.5` fully outside — a ONE texel ramp.
 */
function coverageOf(d: number): number {
  return d <= -0.5 ? 1 : d >= 0.5 ? 0 : 0.5 - d;
}

/** max()-composite a coverage value into a wrapped buffer. */
function putCoverage(cov: Float32Array, size: number, x: number, y: number, c: number): void {
  if (c <= 0) return;
  const xi = ((x % size) + size) % size;
  const yi = ((y % size) + size) % size;
  const i = yi * size + xi;
  if (c > cov[i]) cov[i] = c;
}

/**
 * Crisp wrapped line segment written as coverage. `width` is in texels and is
 * EXACT — a width of 2 covers exactly two texels plus one texel of ramp.
 * Cost is proportional to the segment's bounding box, so a full layout of
 * seams is cheap even at 1024.
 */
export function strokeSegment(
  cov: Float32Array, size: number,
  x0: number, y0: number, x1: number, y1: number,
  width: number,
): void {
  const hw = Math.max(0.25, width * 0.5);
  const pad = Math.ceil(hw + 1);
  const minX = Math.floor(Math.min(x0, x1)) - pad, maxX = Math.ceil(Math.max(x0, x1)) + pad;
  const minY = Math.floor(Math.min(y0, y1)) - pad, maxY = Math.ceil(Math.max(y0, y1)) + pad;
  const ex = x1 - x0, ey = y1 - y0;
  const el = ex * ex + ey * ey;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const wx = x - x0, wy = y - y0;
      const t = el < 1e-9 ? 0 : clamp01((wx * ex + wy * ey) / el);
      const dx = wx - ex * t, dy = wy - ey * t;
      putCoverage(cov, size, x, y, coverageOf(Math.sqrt(dx * dx + dy * dy) - hw));
    }
  }
}

/** Crisp wrapped axis-aligned rectangle OUTLINE as coverage. */
export function strokeRect(
  cov: Float32Array, size: number,
  x: number, y: number, w: number, hgt: number, width: number,
): void {
  strokeSegment(cov, size, x, y, x + w, y, width);
  strokeSegment(cov, size, x, y + hgt, x + w, y + hgt, width);
  strokeSegment(cov, size, x, y, x, y + hgt, width);
  strokeSegment(cov, size, x + w, y, x + w, y + hgt, width);
}

/**
 * A smooth dome stamped into a HEIGHT channel — rivets and bolt heads.
 * Additive, wrapped, with a one-texel rim ramp. Structural, so it is exempt
 * from `NOISE_BUDGET.HEIGHT`.
 */
export function stampDome(
  height: Float32Array, size: number,
  cx: number, cy: number, radius: number, amplitude: number,
): void {
  const r = Math.max(0.5, radius);
  const ri = Math.ceil(r + 1);
  const x0 = Math.round(cx), y0 = Math.round(cy);
  for (let oy = -ri; oy <= ri; oy++) {
    for (let ox = -ri; ox <= ri; ox++) {
      const d = Math.sqrt(ox * ox + oy * oy);
      const rim = coverageOf(d - r);
      if (rim <= 0) continue;
      const t = clamp01(1 - (d / r) * (d / r));
      const xi = (((x0 + ox) % size) + size) % size;
      const yi = (((y0 + oy) % size) + size) % size;
      const i = yi * size + xi;
      height[i] = clamp01(height[i] + amplitude * Math.sqrt(t) * rim);
    }
  }
}

/** Flatten polygons into an edge list [ax,ay,bx,by,...] scaled to texels. */
function buildEdges(polys: readonly Polygon[], size: number): Float64Array {
  let n = 0;
  for (const p of polys) n += (p.length / 2) | 0;
  const e = new Float64Array(n * 4);
  let o = 0;
  for (const p of polys) {
    const m = (p.length / 2) | 0;
    for (let j = 0; j < m; j++) {
      const k = (j + 1) % m;
      e[o] = p[j * 2] * size;      e[o + 1] = p[j * 2 + 1] * size;
      e[o + 2] = p[k * 2] * size;  e[o + 3] = p[k * 2 + 1] * size;
      o += 4;
    }
  }
  return e;
}

/**
 * Rasterize closed polygons as crisp coverage.
 *
 * `mode: 'fill'`   — the interior, even-odd rule (so a ring is outer + inner
 *                    with no winding bookkeeping).
 * `mode: 'stroke'` — a band of `width` texels centred on the boundary.
 *
 * Coordinates are 0..1 UV and MAY fall outside the tile: writes wrap, so a
 * pattern designed to tile (hazard stripes, lane lines) tiles exactly.
 */
export function rasterizePolygons(
  cov: Float32Array, size: number, polys: readonly Polygon[],
  mode: 'fill' | 'stroke' = 'fill', width = 2,
): void {
  if (polys.length === 0) return;
  const edges = buildEdges(polys, size);
  const ne = (edges.length / 4) | 0;
  if (ne === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < ne; i++) {
    const ax = edges[i * 4], ay = edges[i * 4 + 1];
    if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
    if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
  }
  const pad = Math.ceil((mode === 'stroke' ? width * 0.5 : 0) + 2);
  const x0 = Math.floor(minX) - pad, x1 = Math.ceil(maxX) + pad;
  const y0 = Math.floor(minY) - pad, y1 = Math.ceil(maxY) + pad;
  const hw = width * 0.5;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let best = Infinity;
      let inside = false;
      for (let i = 0; i < ne; i++) {
        const ax = edges[i * 4], ay = edges[i * 4 + 1];
        const bx = edges[i * 4 + 2], by = edges[i * 4 + 3];
        const ex = bx - ax, ey = by - ay;
        const wx = x - ax, wy = y - ay;
        const el = ex * ex + ey * ey;
        const t = el < 1e-12 ? 0 : clamp01((wx * ex + wy * ey) / el);
        const dx = wx - ex * t, dy = wy - ey * t;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) best = d2;
        // Even-odd crossing test on the +x ray.
        if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) {
          inside = !inside;
        }
      }
      const d = inside ? -Math.sqrt(best) : Math.sqrt(best);
      putCoverage(cov, size, x, y, coverageOf(mode === 'fill' ? d : Math.abs(d) - hw));
    }
  }
}

/* -- shape construction ---------------------------------------------------- */

/** Regular star polygon, point up, centred on the tile. */
function starPoly(points: number, rOuter: number, rInner: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI * 0.5 + (i / (points * 2)) * TAU;
    const r = (i & 1) === 0 ? rOuter : rInner;
    out.push(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r);
  }
  return out;
}

/** Circle approximated by `segs` chords. 48 is below a texel of error at 512. */
function circlePoly(cx: number, cy: number, r: number, segs = 48): number[] {
  const out: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * TAU;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

function rectPoly(x: number, y: number, w: number, hgt: number): number[] {
  return [x, y, x + w, y, x + w, y + hgt, x, y + hgt];
}

/**
 * A constant-width band following a centreline, with an optional arrowhead at
 * the last point. This is how the road arrows are built: a real swept path,
 * so the corners are clean and the width is exact.
 */
function ribbonPoly(
  pts: readonly number[], halfW: number, headLen = 0, headHalfW = 0,
): number[] {
  const n = (pts.length / 2) | 0;
  const tipX = pts[(n - 1) * 2], tipY = pts[(n - 1) * 2 + 1];
  let dx = tipX - pts[(n - 2) * 2], dy = tipY - pts[(n - 2) * 2 + 1];
  const dl = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= dl; dy /= dl;
  const baseX = tipX - dx * headLen, baseY = tipY - dy * headLen;

  const path = pts.slice(0, (n - 1) * 2);
  path.push(headLen > 0 ? baseX : tipX, headLen > 0 ? baseY : tipY);

  const m = (path.length / 2) | 0;
  const left = new Float64Array(m * 2), right = new Float64Array(m * 2);
  for (let i = 0; i < m; i++) {
    let tx: number, ty: number;
    if (i === 0) { tx = path[2] - path[0]; ty = path[3] - path[1]; }
    else if (i === m - 1) { tx = path[i * 2] - path[(i - 1) * 2]; ty = path[i * 2 + 1] - path[(i - 1) * 2 + 1]; }
    else { tx = path[(i + 1) * 2] - path[(i - 1) * 2]; ty = path[(i + 1) * 2 + 1] - path[(i - 1) * 2 + 1]; }
    const l = Math.sqrt(tx * tx + ty * ty) || 1;
    const nx = -ty / l, ny = tx / l;
    left[i * 2] = path[i * 2] + nx * halfW;  left[i * 2 + 1] = path[i * 2 + 1] + ny * halfW;
    right[i * 2] = path[i * 2] - nx * halfW; right[i * 2 + 1] = path[i * 2 + 1] - ny * halfW;
  }

  const poly: number[] = [];
  for (let i = 0; i < m; i++) poly.push(left[i * 2], left[i * 2 + 1]);
  if (headLen > 0) {
    const nx = -dy, ny = dx;
    poly.push(baseX + nx * headHalfW, baseY + ny * headHalfW);
    poly.push(tipX, tipY);
    poly.push(baseX - nx * headHalfW, baseY - ny * headHalfW);
  }
  for (let i = m - 1; i >= 0; i--) poly.push(right[i * 2], right[i * 2 + 1]);
  return poly;
}

/** Seven-segment rects for one digit, in a 0..1 box. */
const SEG_RECTS: readonly (readonly [number, number, number, number])[] = [
  [0.28, 0.10, 0.44, 0.11],  // a  top
  [0.64, 0.13, 0.11, 0.39],  // b  top-right
  [0.64, 0.48, 0.11, 0.39],  // c  bottom-right
  [0.28, 0.79, 0.44, 0.11],  // d  bottom
  [0.25, 0.48, 0.11, 0.39],  // e  bottom-left
  [0.25, 0.13, 0.11, 0.39],  // f  top-left
  [0.28, 0.445, 0.44, 0.11], // g  middle
];

/** Bit i set = segment i lit, for digits 0-9. */
const SEG_DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

function numeralPolys(glyph: string): number[][] {
  const chars = glyph.replace(/[^0-9]/g, '').slice(0, 3) || '0';
  const sx = 1 / chars.length;
  // Scale the glyph box UNIFORMLY (a digit's design aspect is ~1:1.6), then
  // centre the row vertically. Squeezing x alone would make the strokes thin.
  const sy = Math.min(1, sx * 1.6);
  const oy = (1 - sy) * 0.5;
  const out: number[][] = [];
  for (let c = 0; c < chars.length; c++) {
    const mask = SEG_DIGITS[chars.charCodeAt(c) - 48];
    for (let sIdx = 0; sIdx < 7; sIdx++) {
      if ((mask & (1 << sIdx)) === 0) continue;
      const [rx, ry, rw, rh] = SEG_RECTS[sIdx];
      out.push(rectPoly(c * sx + rx * sx, oy + ry * sy, rw * sx, rh * sy));
    }
  }
  return out;
}

/** Turn a named shape (or an explicit path) into polygons in 0..1 UV. */
export function decalPolygons(path: DecalPath, glyph = '0'): readonly Polygon[] {
  if (typeof path !== 'string') return path;
  switch (path) {
    case 'star5': return [starPoly(5, 0.47, 0.196)];
    case 'star3': return [starPoly(3, 0.47, 0.20)];
    case 'triangle': return [[0.5, 0.06, 0.94, 0.86, 0.06, 0.86]];
    case 'cross': return [[
      0.39, 0.06, 0.61, 0.06, 0.61, 0.39, 0.94, 0.39, 0.94, 0.61,
      0.61, 0.61, 0.61, 0.94, 0.39, 0.94, 0.39, 0.61, 0.06, 0.61,
      0.06, 0.39, 0.39, 0.39,
    ]];
    case 'chevron': return [[
      0.5, 0.10, 0.97, 0.60, 0.97, 0.86, 0.5, 0.36, 0.03, 0.86, 0.03, 0.60,
    ]];
    case 'arrowStraight':
      return [ribbonPoly([0.5, 0.96, 0.5, 0.14], 0.085, 0.30, 0.20)];
    case 'arrowTurn': {
      // Shaft up the left, quarter-turn right, head pointing +x.
      const pts: number[] = [0.26, 0.97, 0.26, 0.58];
      const cx = 0.58, cy = 0.58, r = 0.32;
      for (let k = 1; k <= 8; k++) {
        const a = Math.PI + (k / 8) * (Math.PI * 0.5);
        pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      pts.push(0.96, 0.26);
      return [ribbonPoly(pts, 0.075, 0.26, 0.185)];
    }
    case 'laneDash': return [rectPoly(0.43, 0.08, 0.14, 0.52)];
    case 'laneSolid': return [rectPoly(0.43, -0.02, 0.14, 1.04)];
    case 'crosswalk': {
      const out: number[][] = [];
      for (let i = 0; i < 4; i++) out.push(rectPoly(-0.02, i * 0.25 + 0.03, 1.04, 0.15));
      return out;
    }
    case 'hazardStripes': {
      // 45-degree bands, period 0.25 in x. Slope 1 with an integer number of
      // periods per tile means this wraps exactly in BOTH axes.
      const out: number[][] = [];
      for (let i = 0; i < 4; i++) {
        const o = i * 0.25;
        out.push([o, 0, o + 0.125, 0, o + 1.125, 1, o + 1, 1]);
      }
      return out;
    }
    case 'disc': return [circlePoly(0.5, 0.5, 0.46)];
    case 'ring': return [circlePoly(0.5, 0.5, 0.46), circlePoly(0.5, 0.5, 0.32)];
    case 'bar': return [rectPoly(-0.02, 0.40, 1.04, 0.20)];
    default: return numeralPolys(glyph);
  }
}

/** Stable cache-key fragment for a decal path. */
function decalPathKey(path: DecalPath): string {
  if (typeof path === 'string') return path;
  let k = 'poly';
  for (const p of path) k += ':' + p.join(',');
  return k;
}

/* -- relaxed cellular ------------------------------------------------------ */

/**
 * Cobblestone cells. Unlike `worley2` this uses a BOUNDED jitter (so the
 * stones stay stone-shaped instead of degenerating into slivers) and wraps the
 * cell grid, so the result tiles exactly when `cells` divides the texture.
 * Writes [F1, F2, cellHash] into `out`.
 */
function relaxedCell(
  x: number, y: number, cells: number, jitter: number, seed: number, out: Float32Array,
): void {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      // Wrap the CELL INDEX so opposite tile edges agree.
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const hsh = hash2i(wx * 131 + seed, wy * 977 + seed);
      const ox = 0.5 + (((hsh & 0xffff) / 65536) - 0.5) * jitter;
      const oy = 0.5 + ((((hsh >>> 16) & 0xffff) / 65536) - 0.5) * jitter;
      const ddx = cx + ox - x, ddy = cy + oy - y;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < f1) { f2 = f1; f1 = d; id = hsh; }
      else if (d < f2) { f2 = d; }
    }
  }
  out[0] = f1; out[1] = f2; out[2] = id / 4294967296;
}

/* ==========================================================================
 * 3D. STRUCTURAL NORMAL MAPS
 *
 * `normalFromHeight` is a plain Sobel: it amplifies whatever is in the height
 * field, INCLUDING single-texel noise. A normal map built that way turns a
 * flat surface into sandpaper the moment a specular light hits it, which is
 * one of the two reasons our surfaces read as amateur.
 *
 * `normalFromStructure` is the replacement. It differs in exactly two ways:
 *
 *   1. ONE 3x3 box pass before the Sobel. A lone spiky texel loses ~89% of its
 *      amplitude; a 2-texel-wide groove loses almost nothing. That is the
 *      whole difference between noise and structure at this scale.
 *   2. A SOFT-THRESHOLD deadband. Gradients below `STRUCTURE_GRADIENT_FLOOR`
 *      are residual drift, not geometry, and are subtracted to exactly zero.
 *      Soft (not hard) so there is no visible contour where it kicks in.
 *
 * HONEST LIMIT: this is a safety net, not a laundry. A 2-texel groove and a
 * 1-texel spike are only three times apart in frequency, so no filter can keep
 * one and fully kill the other. Against a budget-legal drift the deadband wins
 * outright and the normal map comes out EXACTLY flat; against full-contrast
 * white noise it only damps. The real guarantee is upstream: the clean
 * generators put nothing but structure in the height field in the first place.
 * ========================================================================== */

/**
 * Per-texel height gradient below which a slope is drift, not geometry.
 * A 0.10-deep groove over 2 texels gives ~0.05/texel — 14x this floor, so real
 * seams are untouched. A budgeted drift over 24+ texels gives ~0.0005/texel,
 * an order of magnitude BELOW it, so it contributes literally nothing.
 */
export const STRUCTURE_GRADIENT_FLOOR = 0.0035;

/**
 * Tangent-space normal from the STRUCTURAL content of a height field.
 * Same signature and output convention as `normalFromHeight`; use this one for
 * every clean surface.
 */
export function normalFromStructure(
  height: Float32Array, size: number, strength: number,
  outX: Float32Array, outY: Float32Array,
): void {
  const smooth = new Float32Array(height.length);
  smooth.set(height);
  blur(smooth, size, 1, 1);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = h(smooth, size, x - 1, y - 1), t = h(smooth, size, x, y - 1), tr = h(smooth, size, x + 1, y - 1);
      const l  = h(smooth, size, x - 1, y),                                     r  = h(smooth, size, x + 1, y);
      const bl = h(smooth, size, x - 1, y + 1), b = h(smooth, size, x, y + 1), br = h(smooth, size, x + 1, y + 1);
      // Sobel, normalized to a per-texel slope (the /8 is the kernel weight sum).
      const dx = ((tr + 2 * r + br) - (tl + 2 * l + bl)) / 8;
      const dy = ((bl + 2 * b + br) - (tl + 2 * t + tr)) / 8;

      const i = y * size + x;
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag <= STRUCTURE_GRADIENT_FLOOR) { outX[i] = 0; outY[i] = 0; continue; }
      // Soft threshold: keep the direction, remove the floor from the length.
      const k = (mag - STRUCTURE_GRADIENT_FLOOR) / mag;
      const nx = -dx * k * strength * 8;
      const ny = -dy * k * strength * 8;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      outX[i] = nx * inv;
      outY[i] = ny * inv;
    }
  }
}

/**
 * `packNormal`, but structural: the normal, cavity and curvature all come from
 * the noise-suppressed height, so none of the three can carry static.
 */
export function packNormalStructural(s: Surface, relief = 2, cavityRadius = 3): Uint8Array {
  const n = s.size * s.size;
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const cav = new Float32Array(n);
  const cur = new Float32Array(n);

  normalFromStructure(s.height, s.size, relief, nx, ny);

  const smooth = new Float32Array(n);
  smooth.set(s.height);
  blur(smooth, s.size, 1, 1);
  cavityFromHeight(smooth, s.size, cavityRadius, cav);
  curvatureFromHeight(smooth, s.size, cur);

  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = b8(nx[i] * 0.5 + 0.5);
    out[o + 1] = b8(ny[i] * 0.5 + 0.5);
    out[o + 2] = b8(cav[i]);
    out[o + 3] = b8(cur[i]);
  }
  return out;
}

/* ==========================================================================
 * 4. GENERATORS
 *
 * Each fills a Surface. Keep them SHORT — the shared helpers above are where
 * the complexity belongs.
 * ========================================================================== */

/** Parameters accepted by the generators. All optional with sane defaults. */
export interface GenParams {
  size?: number;
  seed?: number;
  /** Primary colour, '#RRGGBB'. */
  colorA?: string;
  /** Secondary colour. */
  colorB?: string;
  /** Tertiary colour (third camo tone, aggregate speckle, rust). */
  colorC?: string;
  /** World-space repeat scale. Larger = bigger features. */
  scale?: number;
  /** 0..1 generator-specific intensity. */
  amount?: number;
  /** Base roughness the generator modulates around. */
  roughness?: number;
  /** Base metalness. */
  metalness?: number;
  /** Height relief strength for the derived normal map. */
  relief?: number;
}

/**
 * THE CLEAN SET's parameters (section 4B).
 *
 * Kept in a SEPARATE interface from `GenParams` on purpose: existing code
 * annotates things as `Required<GenParams>`, and bolting twenty new required
 * fields onto that type would break every such site. The legacy generators
 * ignore everything here.
 */
export interface CleanGenParams {
  /**
   * Base colour for the clean generators. Falls back to `colorA` when empty,
   * so a caller can keep using `colorA` if it prefers.
   */
  colour?: string;
  /**
   * 0..1 gloss. 0 = matte primer, 1 = wet lacquer. Drives ROUGHNESS ONLY —
   * it never adds texture. RA3 vehicles sit around 0.45-0.6.
   */
  sheen?: number;
  /**
   * Team-tint mask the clean generators write into albedo alpha. 0 = never
   * tinted (base paint), 1 = fully tinted (a team-colour slab).
   */
  team?: number;
  /** Seam layout for `panelLines`. */
  layout?: PanelLayout;
  /** Colour of seams, slab joints and drawn lines. */
  lineColour?: string;
  /** Line / seam / joint width in TEXELS. 1.5-2.5 is the RA3 look at 512. */
  lineWidth?: number;
  /** Margin in texels from the tile edge to the outer frame line. 0 = none. */
  inset?: number;
  /**
   * `decal` only. 0 (the default) FILLS the path; > 0 strokes its outline at
   * that many texels instead. Separate from `lineWidth` so a decal never
   * accidentally inherits a panel-seam width and comes out hollow.
   */
  outline?: number;
  /** Rivet spacing in texels along a seam. 0 = no rivets. */
  rivets?: number;
  /**
   * 0..1 broad weathering. Maps onto `NOISE_BUDGET.ALBEDO`, so even at 1 it is
   * a 2% drift across the whole tile. It can never become texture.
   */
  wear?: number;
  /** Paving slab width in texels. Should divide `size` so the tile is seamless. */
  slabW?: number;
  /** Paving slab height in texels. Should divide `size`. */
  slabH?: number;
  /** Joint width in texels. */
  jointWidth?: number;
  /** Joint colour. */
  jointColour?: string;
  /** 0..1 per-slab / per-stone FLAT value offset. Capped by the noise budget. */
  variation?: number;
  /** Running-bond row offset as a fraction of `slabW`. 0 = stack bond, 0.5 = brick. */
  bond?: number;
  /** Cobble cell size in texels. Should divide `size`. */
  stoneSize?: number;
  /** 0..1 stone irregularity for `cobblestone`. 0.35 is the RA3 plaza look. */
  jitter?: number;
  /** Decal shape name, or explicit closed polygons in 0..1 UV. */
  path?: DecalPath;
  /** Digits for the 'numeral' decal shape. */
  glyph?: string;
  /** Brush direction for `brushedMetal`: streaks run ALONG this axis. */
  direction?: 'x' | 'y';
}

/** Everything a generator may read. This is what you pass to the factory. */
export type AnyGenParams = GenParams & CleanGenParams;

/** A generator turns params into a Surface. Pure, seeded, worker-safe. */
export type Generator = (p: Required<AnyGenParams>) => Surface;

const DEFAULT_PARAMS: Required<AnyGenParams> = {
  size: 512, seed: 1,
  colorA: '#808080', colorB: '#606060', colorC: '#404040',
  scale: 4, amount: 1, roughness: 0.8, metalness: 0, relief: 2,
  // Clean set. `colour: ''` means "fall back to colorA".
  colour: '', sheen: 0.4, team: 0,
  layout: 'grid', lineColour: '#1b1e22', lineWidth: 1.8, inset: 0, outline: 0, rivets: 0,
  wear: 0.35,
  slabW: 128, slabH: 96, jointWidth: 2.5, jointColour: '#8a8175',
  variation: 0.035, bond: 0, stoneSize: 32, jitter: 0.35,
  path: 'star5', glyph: '0', direction: 'x',
};

/** Scratch RGB triple reused by generators. Never escapes this module. */
const RGB_A = new Float32Array(3);
const RGB_B = new Float32Array(3);
const RGB_C = new Float32Array(3);
const WORLEY = new Float32Array(3);

// --- fbm noise -------------------------------------------------------------

/** Plain coherent noise. The base layer under most other generators. */
const genNoise: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);
  hexToRgb(p.colorB, RGB_B);
  const f = p.scale / p.size;
  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      const n = clamp01(fbm2(x * f, y * f, 5, 2, 0.5, p.seed) * 0.5 + 0.5);
      s.height[i] = n;
      setRgb(s, i,
        lerp(RGB_B[0], RGB_A[0], n),
        lerp(RGB_B[1], RGB_A[1], n),
        lerp(RGB_B[2], RGB_A[2], n));
      s.roughness[i] = p.roughness;
      s.metalness[i] = p.metalness;
    }
  }
  return s;
};

// --- brushed / worn metal --------------------------------------------------

/**
 * Anisotropic brushed metal: fine directional streaks plus a few deep
 * scratches. The directional stretch is what makes it read as METAL rather
 * than as grey noise.
 */
const genMetal: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);
  const rng = new Rng(p.seed);
  const f = p.scale / p.size;

  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      // Stretched 16:1 along X = brush direction.
      const streak = fbm2(x * f * 0.25, y * f * 16, 4, 2, 0.55, p.seed);
      const macro = fbm2(x * f * 0.5, y * f * 0.5, 3, 2, 0.5, p.seed + 71);
      const n = clamp01(0.5 + streak * 0.28 + macro * 0.16);
      s.height[i] = n;
      const tint = 0.82 + n * 0.30;
      setRgb(s, i, RGB_A[0] * tint, RGB_A[1] * tint, RGB_A[2] * tint);
      // Roughness follows the brush grain — this is where the anisotropic
      // highlight comes from.
      s.roughness[i] = clamp01(p.roughness + (n - 0.5) * 0.34);
      s.metalness[i] = p.metalness;
    }
  }

  // A handful of deep scratches cutting across the grain.
  const scratches = 18 + ((p.size / 64) | 0);
  for (let k = 0; k < scratches; k++) {
    const x0 = rng.range(0, p.size), y0 = rng.range(0, p.size);
    const a = rng.range(-0.35, 0.35);
    const len = rng.range(p.size * 0.1, p.size * 0.55);
    drawLine(s.height, p.size, x0, y0,
      x0 + Math.cos(a) * len, y0 + Math.sin(a) * len,
      rng.range(0.6, 1.6), rng.range(0.10, 0.26));
  }
  return s;
};

// --- rust ------------------------------------------------------------------

/**
 * Worley-seeded rust blooms with erosion runs. Weighted toward cavities and
 * lower surfaces by the caller (the shader multiplies this by cavity), so this
 * generator only has to produce a convincing BLOOM SHAPE.
 */
const genRust: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);   // clean metal
  hexToRgb(p.colorC, RGB_C);   // rust
  const f = p.scale / p.size;

  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      // Bloom cores.
      worley2(x * f, y * f, p.seed, WORLEY);
      const core = 1 - clamp01(WORLEY[0] * 1.4);
      // Break the cell boundaries up so it never reads as Voronoi.
      const warp = fbm2(x * f * 2.5, y * f * 2.5, 4, 2, 0.5, p.seed + 13);
      // Vertical erosion runs: rust bleeds DOWNWARD.
      const run = fbm2(x * f * 6, y * f * 0.7, 3, 2, 0.6, p.seed + 29);
      let mask = clamp01(core * 0.85 + warp * 0.35 + run * 0.22);
      mask = smoothstep(0.42, 0.78, mask) * p.amount;

      s.height[i] = 0.5 + mask * 0.22;
      s.alpha[i] = mask;
      setRgb(s, i,
        lerp(RGB_A[0], RGB_C[0], mask),
        lerp(RGB_A[1], RGB_C[1], mask),
        lerp(RGB_A[2], RGB_C[2], mask));
      // Rust is rough and non-metallic; clean steel is neither.
      s.roughness[i] = lerp(p.roughness, 0.96, mask);
      s.metalness[i] = lerp(p.metalness, 0.05, mask);
    }
  }
  return s;
};

// --- camo ------------------------------------------------------------------

/**
 * Three-tone faction camo. DOMAIN WARP IS MANDATORY: without it this reads as
 * regular procedural noise, which is the single most common tell of a
 * programmer-art texture.
 */
const genCamo: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);
  hexToRgb(p.colorB, RGB_B);
  hexToRgb(p.colorC, RGB_C);
  const f = p.scale / p.size;

  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      // Warp the sample position before sampling — this is what produces the
      // irregular interlocking blob shapes real camo has.
      const wx = x * f + simplex2(x * f * 1.7, y * f * 1.7, p.seed) * 0.55;
      const wy = y * f + simplex2(x * f * 1.7 + 5.2, y * f * 1.7 + 1.3, p.seed + 91) * 0.55;
      const n = fbm2(wx, wy, 3, 2.1, 0.5, p.seed);

      let r: number, g: number, b: number;
      if (n < -0.12) { r = RGB_B[0]; g = RGB_B[1]; b = RGB_B[2]; }
      else if (n < 0.18) { r = RGB_A[0]; g = RGB_A[1]; b = RGB_A[2]; }
      else { r = RGB_C[0]; g = RGB_C[1]; b = RGB_C[2]; }

      // A little fine grain so the flat blobs are not perfectly flat.
      const grain = 1 + simplex2(x * 0.3, y * 0.3, p.seed + 7) * 0.035;
      setRgb(s, i, r * grain, g * grain, b * grain);
      s.height[i] = 0.5;
      s.roughness[i] = p.roughness + simplex2(x * f * 4, y * f * 4, p.seed + 3) * 0.05;
      s.metalness[i] = p.metalness;
    }
  }
  return s;
};

// --- concrete --------------------------------------------------------------

/**
 * Poured concrete: form-board lines, aggregate speckle, a crack network and
 * water staining. Buildings live or die on this one.
 */
const genConcrete: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);
  hexToRgb(p.colorC, RGB_C);
  const f = p.scale / p.size;
  const boardHeight = p.size / 6;

  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      // Base mottling.
      const base = fbm2(x * f, y * f, 5, 2, 0.5, p.seed) * 0.5 + 0.5;
      // Aggregate speckle: small worley cells with per-cell brightness.
      worley2(x * f * 14, y * f * 14, p.seed + 5, WORLEY);
      const aggregate = smoothstep(0.42, 0.06, WORLEY[0]) * (0.35 + WORLEY[2] * 0.65);
      // Crack network: ridged noise thresholded hard.
      const crack = smoothstep(0.86, 0.99, ridged2(x * f * 2.2, y * f * 2.2, 4, 2, 0.5, p.seed + 17));
      // Water staining bleeding downward from form-board joints.
      const jointPhase = (y % boardHeight) / boardHeight;
      const joint = smoothstep(0.06, 0.0, jointPhase);
      const stainNoise = fbm2(x * f * 5, y * f * 0.6, 3, 2, 0.6, p.seed + 23) * 0.5 + 0.5;
      const stain = clamp01(joint * 0.5 + smoothstep(0.55, 1.0, stainNoise) * jointPhase * 0.45);

      const v = clamp01(base * 0.72 + aggregate * 0.28);
      let r = RGB_A[0] * (0.80 + v * 0.34);
      let g = RGB_A[1] * (0.80 + v * 0.34);
      let b = RGB_A[2] * (0.80 + v * 0.34);
      // Stains darken and cool the surface.
      r = lerp(r, RGB_C[0] * 0.75, stain * p.amount);
      g = lerp(g, RGB_C[1] * 0.75, stain * p.amount);
      b = lerp(b, RGB_C[2] * 0.78, stain * p.amount);
      // Cracks are near-black.
      const ck = crack * 0.8;
      setRgb(s, i, r * (1 - ck), g * (1 - ck), b * (1 - ck));

      s.height[i] = clamp01(0.5 + (v - 0.5) * 0.35 - crack * 0.35 - joint * 0.12);
      s.roughness[i] = clamp01(p.roughness + crack * 0.06 - stain * 0.10);
      s.metalness[i] = 0;
      s.ao[i] = clamp01(1 - crack * 0.55 - joint * 0.2);
    }
  }
  return s;
};

// --- painted panel metal ---------------------------------------------------

/**
 * Painted sheet metal: panel gap grid, rivet rows, and paint chipping at the
 * panel edges (which is exactly where real paint fails).
 */
const genPanelMetal: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);
  hexToRgb(p.colorB, RGB_B);  // bare metal under the paint
  const rng = new Rng(p.seed);
  const panel = Math.max(16, (p.size / Math.max(1, p.scale)) | 0);

  // Base paint with subtle orange-peel.
  const f = 4 / p.size;
  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      const peel = fbm2(x * f * 8, y * f * 8, 3, 2, 0.5, p.seed) * 0.5 + 0.5;
      s.height[i] = 0.55 + peel * 0.05;
      setRgb(s, i,
        RGB_A[0] * (0.94 + peel * 0.12),
        RGB_A[1] * (0.94 + peel * 0.12),
        RGB_A[2] * (0.94 + peel * 0.12));
      s.roughness[i] = clamp01(p.roughness + (peel - 0.5) * 0.08);
      s.metalness[i] = p.metalness;
      s.teamMask[i] = 1;   // painted areas take the faction tint
    }
  }

  // Panel gaps: recessed lines on a grid.
  const gapDepth = -0.30 * p.relief;
  for (let gy = 0; gy < p.size; gy += panel) {
    drawLine(s.height, p.size, 0, gy, p.size, gy, 1.1, gapDepth);
  }
  for (let gx = 0; gx < p.size; gx += panel) {
    drawLine(s.height, p.size, gx, 0, gx, p.size, 1.1, gapDepth);
  }

  // Rivet rows along every gap.
  const rivetR = Math.max(1.2, p.size / 340);
  const rivetStep = Math.max(6, (panel / 5) | 0);
  for (let gy = 0; gy < p.size; gy += panel) {
    for (let x = rivetStep * 0.5; x < p.size; x += rivetStep) {
      drawDisc(s.height, p.size, x, gy + 3, rivetR, 0.22);
    }
  }

  // Paint chipping: exposes colorB near the gaps.
  const chips = (p.size / 6) | 0;
  for (let k = 0; k < chips; k++) {
    const gx = Math.floor(rng.next() * (p.size / panel)) * panel;
    const cy = rng.range(0, p.size);
    const cx = gx + rng.range(-3, 3);
    const rad = rng.range(1.5, 4.5);
    const ri = Math.ceil(rad);
    for (let oy = -ri; oy <= ri; oy++) {
      for (let ox = -ri; ox <= ri; ox++) {
        if (ox * ox + oy * oy > rad * rad) continue;
        const xi = ((Math.round(cx) + ox) % p.size + p.size) % p.size;
        const yi = ((Math.round(cy) + oy) % p.size + p.size) % p.size;
        const i = yi * p.size + xi;
        setRgb(s, i, RGB_B[0], RGB_B[1], RGB_B[2]);
        s.roughness[i] = 0.55;
        s.metalness[i] = 0.9;   // bare metal underneath
        s.teamMask[i] = 0;      // chipped areas do NOT take the team tint
      }
    }
  }
  return s;
};

// --- cloth -----------------------------------------------------------------

/** Fatigue weave with webbing lines. Infantry only. */
const genCloth: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);
  const f = p.scale / p.size;
  const weave = Math.max(2, (p.size / 96) | 0);

  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      // Over/under weave: two out-of-phase square waves.
      const wx = Math.sin((x / weave) * TAU) * 0.5 + 0.5;
      const wy = Math.sin((y / weave) * TAU) * 0.5 + 0.5;
      const w = (wx * 0.5 + wy * 0.5);
      // Fibre irregularity.
      const fibre = fbm2(x * f * 3, y * f * 3, 3, 2, 0.55, p.seed) * 0.5 + 0.5;
      const v = clamp01(0.72 + w * 0.18 + (fibre - 0.5) * 0.28);
      setRgb(s, i, RGB_A[0] * v, RGB_A[1] * v, RGB_A[2] * v);
      s.height[i] = 0.5 + (w - 0.5) * 0.28 + (fibre - 0.5) * 0.14;
      s.roughness[i] = clamp01(p.roughness + (1 - v) * 0.08);
      s.metalness[i] = 0;   // cloth is NEVER metallic
      s.teamMask[i] = 1;
    }
  }
  return s;
};

// --- terrain ---------------------------------------------------------------

/** Ground: grass/dirt/rock/sand share one generator with different colours. */
const genGround: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);
  hexToRgb(p.colorB, RGB_B);
  hexToRgb(p.colorC, RGB_C);
  const f = p.scale / p.size;

  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      const macro = fbm2(x * f, y * f, 5, 2, 0.5, p.seed) * 0.5 + 0.5;
      const detail = fbm2(x * f * 7, y * f * 7, 4, 2, 0.5, p.seed + 41) * 0.5 + 0.5;
      // Pebbles/clumps.
      worley2(x * f * 9, y * f * 9, p.seed + 3, WORLEY);
      const clump = smoothstep(0.55, 0.1, WORLEY[0]);

      const t = clamp01(macro * 0.6 + detail * 0.4);
      let r = lerp(RGB_B[0], RGB_A[0], t);
      let g = lerp(RGB_B[1], RGB_A[1], t);
      let b = lerp(RGB_B[2], RGB_A[2], t);
      r = lerp(r, RGB_C[0], clump * 0.45);
      g = lerp(g, RGB_C[1], clump * 0.45);
      b = lerp(b, RGB_C[2], clump * 0.45);
      setRgb(s, i, r, g, b);

      s.height[i] = clamp01(detail * 0.55 + clump * 0.45);
      s.roughness[i] = clamp01(p.roughness - clump * 0.06);
      s.metalness[i] = 0;
      s.ao[i] = clamp01(1 - (1 - detail) * 0.25);
    }
  }
  return s;
};

// --- crystal ---------------------------------------------------------------

/** Faceted ore crystal: worley cells become flat facets with an emissive core. */
const genCrystal: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);
  const f = p.scale / p.size;

  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      worley2(x * f * 5, y * f * 5, p.seed, WORLEY);
      // Flat facets: quantize by cell id, edges from F2-F1.
      const facet = WORLEY[2];
      const edge = smoothstep(0.14, 0.0, WORLEY[1] - WORLEY[0]);
      const v = 0.62 + facet * 0.38;
      setRgb(s, i,
        clamp01(RGB_A[0] * v + edge * 0.35),
        clamp01(RGB_A[1] * v + edge * 0.30),
        clamp01(RGB_A[2] * v + edge * 0.18));
      s.height[i] = clamp01(0.35 + facet * 0.5 - edge * 0.4);
      s.roughness[i] = clamp01(p.roughness - edge * 0.1);
      s.metalness[i] = 0;
      // Cores glow; edges glow harder. Scaled at runtime by remaining ore.
      s.emissive[i] = clamp01(0.35 + facet * 0.35 + edge * 0.5);
    }
  }
  return s;
};

// --- scorch decal ----------------------------------------------------------

/** Radial scorch mark with a ragged noise edge. Alpha carries the shape. */
const genScorch: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);
  const c = p.size * 0.5;
  const f = 6 / p.size;

  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      const dx = (x - c) / c, dy = (y - c) / c;
      const d = Math.sqrt(dx * dx + dy * dy);
      // Ragged edge: perturb the radius by angular noise.
      const ang = Math.atan2(dy, dx);
      const ragged = simplex2(Math.cos(ang) * 2.2, Math.sin(ang) * 2.2, p.seed) * 0.18;
      const grain = fbm2(x * f, y * f, 4, 2, 0.5, p.seed + 11) * 0.5 + 0.5;
      const a = clamp01(smoothstep(0.95 + ragged, 0.15, d) * (0.55 + grain * 0.65)) * p.amount;
      s.alpha[i] = a;
      const soot = 0.7 + grain * 0.5;
      setRgb(s, i, RGB_A[0] * soot, RGB_A[1] * soot, RGB_A[2] * soot);
      s.height[i] = 0.5 - a * 0.15;
      s.roughness[i] = 0.95;
      s.metalness[i] = 0;
    }
  }
  return s;
};

// --- tread imprint ---------------------------------------------------------

/** Tiling tread print: chevron blocks. Alpha + height for the decal normal. */
const genTreadPrint: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);
  const blocks = Math.max(4, (p.scale | 0));
  const blockH = p.size / blocks;

  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      const u = x / p.size;
      // Chevron: shift the block phase with |u - 0.5|.
      const shift = Math.abs(u - 0.5) * blockH * 1.2;
      const phase = ((y + shift) % blockH) / blockH;
      const inBlock = phase < 0.62 ? 1 : 0;
      // Tread does not reach the very edge of the track.
      const edge = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u);
      const a = inBlock * edge;
      s.alpha[i] = a;
      s.height[i] = 0.5 + a * 0.28;
      setRgb(s, i, RGB_A[0], RGB_A[1], RGB_A[2]);
      s.roughness[i] = 0.9;
      s.metalness[i] = 0;
    }
  }
  return s;
};

// --- smoke puff ------------------------------------------------------------

/** Soft billowing alpha with internal curl detail — never a fuzzy circle. */
const genSmokePuff: Generator = (p) => {
  const s = createSurface(p.size);
  const c = p.size * 0.5;
  const f = 3.5 / p.size;

  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      const dx = (x - c) / c, dy = (y - c) / c;
      const d = Math.sqrt(dx * dx + dy * dy);
      // Billows: low-frequency lumps pushing the silhouette in and out.
      const billow = fbm2(x * f, y * f, 4, 2.2, 0.55, p.seed) * 0.5 + 0.5;
      const radius = 0.62 + (billow - 0.5) * 0.55;
      const a = clamp01(smoothstep(radius, radius * 0.25, d));
      // Internal structure so it does not read as a flat blob when lit.
      const inner = fbm2(x * f * 3.5, y * f * 3.5, 4, 2, 0.5, p.seed + 19) * 0.5 + 0.5;
      s.alpha[i] = a * (0.55 + inner * 0.55);
      const v = 0.55 + inner * 0.45;
      setRgb(s, i, v, v, v);
      s.height[i] = 0.5 + (inner - 0.5) * 0.5;
      s.roughness[i] = 1;
      s.metalness[i] = 0;
    }
  }
  return s;
};

// --- blue noise ------------------------------------------------------------

/**
 * Tiling blue noise for SSAO sampling, dithering, soft particles and decal
 * fade. Produced by repeatedly removing the low-frequency content from white
 * noise and re-ranking to a uniform distribution — a cheap void-and-cluster
 * approximation that is more than good enough for dithering, and far faster
 * than the real algorithm at boot time.
 */
const genBlueNoise: Generator = (p) => {
  const s = createSurface(p.size);
  const n = p.size * p.size;
  const rng = new Rng(p.seed);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = rng.next();

  const low = new Float32Array(n);
  const order = new Int32Array(n);
  for (let pass = 0; pass < 4; pass++) {
    low.set(buf);
    blur(low, p.size, 1, 2);
    for (let i = 0; i < n; i++) buf[i] -= low[i];
    // Re-rank to a uniform 0..1 distribution.
    for (let i = 0; i < n; i++) order[i] = i;
    const arr = Array.from(order);
    arr.sort((a, b) => buf[a] - buf[b]);
    for (let r = 0; r < n; r++) buf[arr[r]] = r / (n - 1);
  }

  for (let i = 0; i < n; i++) {
    const v = buf[i];
    setRgb(s, i, v, v, v);
    s.height[i] = v;
    s.alpha[i] = v;
    s.roughness[i] = v;
  }
  return s;
};

// --- checker ---------------------------------------------------------------

/** Debug checker. Deliberately magenta-ish so an unimplemented material screams. */
const genChecker: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(p.colorA, RGB_A);
  hexToRgb(p.colorB, RGB_B);
  const sz = Math.max(2, (p.size / Math.max(2, p.scale)) | 0);
  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      const on = (((x / sz) | 0) + ((y / sz) | 0)) & 1;
      const c = on ? RGB_A : RGB_B;
      setRgb(s, i, c[0], c[1], c[2]);
      s.height[i] = on ? 0.6 : 0.4;
      s.roughness[i] = p.roughness;
      s.metalness[i] = p.metalness;
    }
  }
  return s;
};

/* ==========================================================================
 * 4B. THE CLEAN SET — RA3 SURFACES
 *
 * Everything below obeys THE ONE RULE: no per-pixel noise, ever. Variation is
 * either (a) a budgeted broad drift, (b) a flat per-cell offset, or (c) a
 * crisp drawn shape. Height fields contain STRUCTURE ONLY, so the derived
 * normal map shows seams and joints and nothing else.
 *
 * These replace the legacy generators above for every visible surface. The old
 * ones stay only until the last call site has moved.
 * ========================================================================== */

/** Resolve the clean base colour, honouring the `colorA` fallback. */
function baseColour(p: Required<AnyGenParams>): string {
  return p.colour !== '' ? p.colour : p.colorA;
}

/**
 * Sheen -> roughness. 0 = 0.78 (chalky primer), 1 = 0.14 (wet lacquer).
 * RA3's vehicles read glossy on the upper surfaces, so the useful band is
 * 0.4-0.7, giving roughness 0.52-0.33.
 */
function sheenRoughness(sheen: number): number {
  return lerp(0.78, 0.14, clamp01(sheen));
}

/**
 * Resolve a clean surface's roughness from three knobs, most specific first:
 *
 *   1. an explicitly supplied `roughness`  — you know exactly what you want
 *   2. an explicitly supplied `sheen`      — you want a gloss level
 *   3. the generator's own default         — you want the RA3 default for this
 *                                            material class
 *
 * "Explicitly supplied" means "different from the shared default", which is
 * the only signal available once the params have been merged. Passing a value
 * equal to the default is therefore a no-op, which is exactly what a caller
 * would expect anyway.
 */
function cleanRoughness(p: Required<AnyGenParams>, fallback: number): number {
  if (p.roughness !== DEFAULT_PARAMS.roughness) return clamp01(p.roughness);
  if (p.sheen !== DEFAULT_PARAMS.sheen) return sheenRoughness(p.sheen);
  return fallback;
}

// --- flatPaint -------------------------------------------------------------

/**
 * THE WORKHORSE. A near-solid painted surface.
 *
 * Deliberately boring: one colour, one broad drift inside the noise budget, a
 * perfectly flat height field (so the normal map is exactly flat and the
 * specular is clean). Large unbroken areas of a single colour are CORRECT —
 * they are what makes RA3 read as painted plastic. Do not "break it up".
 *
 * Use for: vehicle hull base paint, building wall base, team-colour slabs
 * (with `team: 1`), interior surfaces, anything that should just be a colour.
 */
const genFlatPaint: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(baseColour(p), RGB_A);
  const rough = cleanRoughness(p, sheenRoughness(0.4));
  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      const v = broadDrift(x, y, p.size, p.wear, p.seed);
      setRgb(s, i, RGB_A[0] * v, RGB_A[1] * v, RGB_A[2] * v);
      s.height[i] = 0.5;                       // exactly flat: no normal at all
      s.roughness[i] = clamp01(rough + budgetedNoise(
        x, y, p.size, p.size * 0.4, p.wear * NOISE_BUDGET.ROUGHNESS,
        p.seed + 401, NOISE_BUDGET.ROUGHNESS));
      s.metalness[i] = p.metalness;
      s.teamMask[i] = clamp01(p.team);
    }
  }
  return s;
};

// --- panelLines ------------------------------------------------------------

/**
 * Build the seam segments for a layout as a flat [x0,y0,x1,y1,...] list, in
 * texels. Keeping the layout as DATA means the same segments drive the albedo
 * lines, the height grooves and the rivet placement, so they can never
 * disagree.
 */
function panelSegments(p: Required<AnyGenParams>): number[] {
  const n = p.size;
  const seg: number[] = [];
  const push = (x0: number, y0: number, x1: number, y1: number): void => {
    seg.push(x0, y0, x1, y1);
  };
  const inset = clamp(p.inset, 0, n * 0.4);

  switch (p.layout) {
    case 'rows': {
      const rows = Math.max(1, Math.round(p.scale));
      const rowH = n / rows;
      for (let r = 0; r < rows; r++) {
        const y = r * rowH;
        push(0, y, n, y);
        // One to three vertical dividers per row, at deterministic positions.
        const count = 1 + (hash2i(r, p.seed) % 3);
        for (let d = 1; d <= count; d++) {
          const t = hash2f(r * 31 + d, p.seed + 17);
          const x = Math.round((0.12 + t * 0.76) * n);
          push(x, y, x, y + rowH);
        }
      }
      break;
    }
    case 'radial': {
      const rings = Math.max(1, Math.round(p.scale));
      const cx = n * 0.5, cy = n * 0.5;
      const maxR = n * 0.5 - inset;
      for (let k = 1; k <= rings; k++) {
        const r = (k / rings) * maxR;
        const steps = Math.max(16, Math.round(r * 0.6));
        for (let i = 0; i < steps; i++) {
          const a0 = (i / steps) * TAU, a1 = ((i + 1) / steps) * TAU;
          push(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r,
               cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
        }
      }
      const spokes = Math.max(3, rings * 2);
      for (let k = 0; k < spokes; k++) {
        const a = (k / spokes) * TAU;
        push(cx + Math.cos(a) * (maxR / rings), cy + Math.sin(a) * (maxR / rings),
             cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
      }
      break;
    }
    case 'greeble': {
      const rows = Math.max(2, Math.round(p.scale));
      let y = 0;
      for (let r = 0; r < rows && y < n; r++) {
        // Unequal row heights, but always a whole number of texels.
        const hh = Math.round((n / rows) * (0.65 + hash2f(r, p.seed + 5) * 0.7));
        const y1 = Math.min(n, y + hh);
        push(0, y, n, y);
        const cols = 2 + (hash2i(r, p.seed + 9) % 4);
        let acc = 0;
        for (let c = 1; c < cols; c++) {
          acc += 0.4 + hash2f(r * 53 + c, p.seed + 11) * 1.2;
        }
        let run = 0;
        for (let c = 1; c < cols; c++) {
          run += 0.4 + hash2f(r * 53 + c, p.seed + 11) * 1.2;
          const x = Math.round((run / (acc + 0.6)) * n);
          push(x, y, x, y1);
        }
        y = y1;
      }
      push(0, 0, n, 0);
      break;
    }
    default: {
      const cells = Math.max(1, Math.round(p.scale));
      const step = n / cells;
      for (let k = 0; k < cells; k++) {
        const v = Math.round(k * step);
        push(v, 0, v, n);
        push(0, v, n, v);
      }
      break;
    }
  }

  if (inset > 0) {
    push(inset, inset, n - inset, inset);
    push(inset, n - inset, n - inset, n - inset);
    push(inset, inset, inset, n - inset);
    push(n - inset, inset, n - inset, n - inset);
  }
  return seg;
}

/** Groove depth in the 0..1 height field. Structural, exempt from the budget. */
const SEAM_DEPTH = 0.11;

/**
 * Crisp geometric panel seams over a flat paint base.
 *
 * The seams are REAL LINES on a deliberate layout, drawn from a signed
 * distance field: 1-2 texels wide, hard-edged, straight, with clean corners.
 * They cut a groove into the height field, which is the ONLY thing the
 * structural normal map will show.
 *
 * Use for: vehicle hulls, building walls, turret tops (`radial`), industrial
 * facades (`greeble`).
 */
const genPanelLines: Generator = (p) => {
  const s = genFlatPaint(p);
  const n = p.size;
  hexToRgb(p.lineColour, RGB_B);

  const seamCov = new Float32Array(n * n);
  const seg = panelSegments(p);
  for (let i = 0; i < seg.length; i += 4) {
    strokeSegment(seamCov, n, seg[i], seg[i + 1], seg[i + 2], seg[i + 3], p.lineWidth);
  }

  for (let i = 0; i < n * n; i++) {
    const c = seamCov[i];
    if (c <= 0) continue;
    const o = i * 3;
    s.albedo[o] = lerp(s.albedo[o], RGB_B[0], c);
    s.albedo[o + 1] = lerp(s.albedo[o + 1], RGB_B[1], c);
    s.albedo[o + 2] = lerp(s.albedo[o + 2], RGB_B[2], c);
    s.height[i] = 0.5 - SEAM_DEPTH * c;
    // A seam is a shadow line, not a polished surface.
    s.roughness[i] = clamp01(lerp(s.roughness[i], 0.85, c));
    s.ao[i] = 1 - 0.32 * c;
    s.teamMask[i] = s.teamMask[i] * (1 - c);
  }

  // Rivets: geometry only. They dome the height field and never touch albedo,
  // so they show as lit relief instead of as painted dots.
  if (p.rivets > 0) {
    const r = Math.max(1.1, n / 320);
    for (let i = 0; i < seg.length; i += 4) {
      const x0 = seg[i], y0 = seg[i + 1], x1 = seg[i + 2], y1 = seg[i + 3];
      const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
      const count = Math.floor(len / p.rivets);
      for (let k = 0; k <= count; k++) {
        const t = count === 0 ? 0.5 : k / count;
        stampDome(s.height, n, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, 0.09);
      }
    }
  }
  return s;
};

// --- asphalt ---------------------------------------------------------------

/**
 * RA3 road surface: essentially a flat dark colour.
 *
 * Look at `docs/surface-refs/ra3-units-road.png` — the asphalt is a smooth,
 * almost featureless dark grey-brown. ALL the interest on an RA3 road comes
 * from the markings and the kerb, which are separate crisp decals. So this
 * generator is deliberately close to `solid()`: one broad drift within the
 * albedo budget and a PERFECTLY FLAT height field.
 *
 * A flat height field is the important half. The old concrete-based road had a
 * noise normal map, which is what made it glitter like crumpled foil under the
 * sun light.
 */
const genAsphalt: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(baseColour(p), RGB_A);
  const rough = cleanRoughness(p, 0.72);
  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      // Two very broad, out-of-phase drifts read as the faint patchiness of a
      // resurfaced road without ever resolving into a pattern.
      const v = 1
        + budgetedNoise(x, y, p.size, p.size * 0.5, p.wear * NOISE_BUDGET.ALBEDO, p.seed)
        + budgetedNoise(x, y, p.size, p.size * 0.22, p.wear * NOISE_BUDGET.ALBEDO * 0.4, p.seed + 61);
      setRgb(s, i, RGB_A[0] * v, RGB_A[1] * v, RGB_A[2] * v);
      s.height[i] = 0.5;                       // NO surface relief. None.
      s.roughness[i] = clamp01(rough + budgetedNoise(
        x, y, p.size, p.size * 0.3, p.wear * NOISE_BUDGET.ROUGHNESS,
        p.seed + 7, NOISE_BUDGET.ROUGHNESS));
      s.metalness[i] = 0;
      s.teamMask[i] = 0;
    }
  }
  return s;
};

// --- paving ----------------------------------------------------------------

/**
 * Rectangular paving slabs — the sidewalk, the plaza, the concrete pad.
 *
 * Real slabs: a flat pale field cut by crisp joints on a regular grid, each
 * slab a FLAT colour a percent or two away from its neighbours. That per-slab
 * offset is cell-constant, so it never shimmers under mip filtering the way
 * per-pixel speckle does.
 *
 * Tiling: choose `slabW`/`slabH` that divide `size`, and `bond` of 0 or 0.5
 * with an even row count.
 */
const genPaving: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(baseColour(p), RGB_A);
  hexToRgb(p.jointColour, RGB_B);
  const sw = Math.max(4, p.slabW), sh = Math.max(4, p.slabH);
  const hjw = Math.max(0.5, p.jointWidth) * 0.5;
  const varAmp = Math.min(Math.abs(p.variation), NOISE_BUDGET.SLAB_VARIATION);
  const rough = cleanRoughness(p, 0.74);

  for (let y = 0; y < p.size; y++) {
    const row = Math.floor(y / sh);
    const off = row * p.bond * sw;
    const fy = y - row * sh;
    const dy = Math.min(fy, sh - fy);
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      const gx = x + off;
      const col = Math.floor(gx / sw);
      const fx = gx - col * sw;
      const dx = Math.min(fx, sw - fx);
      // Coverage of the joint: crisp, exactly `jointWidth` texels wide.
      const j = coverageOf(Math.min(dx, dy) - hjw);

      // Flat per-slab offset. Constant across the whole slab — that is what
      // makes it read as a slab and not as grain.
      const slabV = 1 + (hash2f(col, row + p.seed * 7) - 0.5) * 2 * varAmp;
      const drift = broadDrift(x, y, p.size, p.wear, p.seed + 3);
      const v = slabV * drift;

      setRgb(s, i,
        lerp(RGB_A[0] * v, RGB_B[0], j),
        lerp(RGB_A[1] * v, RGB_B[1], j),
        lerp(RGB_A[2] * v, RGB_B[2], j));
      // Slab face perfectly flat; only the joint is geometry.
      s.height[i] = 0.5 - 0.10 * j;
      s.roughness[i] = clamp01(lerp(rough, 0.88, j));
      s.metalness[i] = 0;
      s.ao[i] = 1 - 0.28 * j;
      s.teamMask[i] = 0;
    }
  }
  return s;
};

// --- cobblestone -----------------------------------------------------------

/**
 * Stone setts — the RA3 plaza in `docs/surface-refs/ra3-road-city.png`.
 *
 * Actual cells from a RELAXED cellular partition (bounded jitter, so the
 * stones stay stone-shaped), each a FLAT colour, separated by a crisp joint.
 * The only height is a gentle crown per stone, which is real geometry and is
 * exactly what makes cobbles read as cobbles.
 *
 * Tiling: `stoneSize` should divide `size`.
 */
const genCobblestone: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(baseColour(p), RGB_A);
  hexToRgb(p.jointColour, RGB_B);
  const cells = Math.max(2, Math.round(p.size / Math.max(4, p.stoneSize)));
  const cellTexels = p.size / cells;
  const f = cells / p.size;
  const hjw = Math.max(0.5, p.jointWidth) * 0.5;
  const varAmp = Math.min(Math.abs(p.variation), NOISE_BUDGET.SLAB_VARIATION);
  const rough = cleanRoughness(p, 0.76);
  const cell = new Float32Array(3);

  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      relaxedCell(x * f, y * f, cells, clamp01(p.jitter), p.seed, cell);
      // (F2 - F1) is twice the distance to the cell boundary, in cell units.
      const edgeTexels = (cell[1] - cell[0]) * cellTexels * 0.5;
      const j = coverageOf(edgeTexels - hjw);

      const stoneV = 1 + (cell[2] - 0.5) * 2 * varAmp;
      const v = stoneV * broadDrift(x, y, p.size, p.wear, p.seed + 13);
      setRgb(s, i,
        lerp(RGB_A[0] * v, RGB_B[0], j),
        lerp(RGB_A[1] * v, RGB_B[1], j),
        lerp(RGB_A[2] * v, RGB_B[2], j));

      // Crown: flat over most of the stone, rolling off into the joint.
      const crown = smoothstep(0, cellTexels * 0.28, edgeTexels);
      s.height[i] = 0.40 + 0.16 * crown;
      s.roughness[i] = clamp01(lerp(rough, 0.9, j));
      s.metalness[i] = 0;
      s.ao[i] = 1 - 0.35 * (1 - crown);
      s.teamMask[i] = 0;
    }
  }
  return s;
};

// --- decal -----------------------------------------------------------------

/**
 * Crisp vector shapes: insignia, road markings, arrows, chevrons, hazard
 * stripes, hull numbers.
 *
 * The shape is rasterized from an exact signed distance field, so the Soviet
 * star has five clean straight-edged points with ONE texel of antialiasing —
 * never a noise-modulated splatter. Alpha carries the shape; RGB is the flat
 * colour everywhere, so there is no fringe when the alpha ramps.
 *
 * `outline > 0` switches from FILL to STROKE, which is how you get an outlined
 * roundel or a hollow chevron from the same path.
 *
 * Request with `channel: 'mask'` and `tiling: false` for a stamped decal, or
 * `channel: 'mask'` with `tiling: true` for the repeating markings.
 */
const genDecal: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(baseColour(p), RGB_A);
  const cov = new Float32Array(p.size * p.size);
  const polys = decalPolygons(p.path, p.glyph);
  rasterizePolygons(cov, p.size, polys,
    p.outline > 0 ? 'stroke' : 'fill', p.outline);

  const rough = cleanRoughness(p, sheenRoughness(0.4));
  for (let i = 0; i < p.size * p.size; i++) {
    const a = clamp01(cov[i] * p.amount);
    s.alpha[i] = a;
    setRgb(s, i, RGB_A[0], RGB_A[1], RGB_A[2]);
    // Paint sits ON the surface: a hair proud, and smoother than what it
    // covers, which is what makes road markings catch the light in RA3.
    s.height[i] = 0.5 + 0.02 * a;
    s.roughness[i] = rough;
    s.metalness[i] = p.metalness;
    s.teamMask[i] = clamp01(p.team) * a;
  }
  return s;
};

// --- brushedMetal ----------------------------------------------------------

/**
 * Fine ANISOTROPIC brushing. Bare steel, gun barrels, exhaust shrouds.
 *
 * Built from harmonics with INTEGER frequencies across the grain (so it tiles
 * exactly) modulated slowly along the grain. It is directional by
 * construction, which is the difference between "brushed metal" and "grey
 * noise": the streaks are ~6 texels apart across the grain and hundreds of
 * texels long along it.
 *
 * Amplitude is inside the albedo budget. The visible effect comes almost
 * entirely from the ROUGHNESS streaks, which shape the highlight without
 * touching the colour.
 */
const genBrushedMetal: Generator = (p) => {
  const s = createSurface(p.size);
  hexToRgb(baseColour(p), RGB_A);
  const rough = cleanRoughness(p, 0.34);

  // Across-grain wavelength in texels, floored so it can never become static.
  const acrossWl = Math.max(4, p.scale > 0 ? p.size / (p.scale * 16) : 6);
  const H = 5;
  const nk = new Int32Array(H), mk = new Int32Array(H);
  const ak = new Float32Array(H), ph = new Float32Array(H);
  let norm = 0;
  const n0 = Math.max(1, Math.round(p.size / acrossWl));
  for (let k = 0; k < H; k++) {
    nk[k] = Math.max(1, Math.round(n0 / (k + 1)));
    mk[k] = k + 1;
    ak[k] = 1 / (k + 1);
    ph[k] = hash2f(k, p.seed) * TAU;
    norm += ak[k];
  }

  const alongX = p.direction === 'x';
  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const i = y * p.size + x;
      // u runs ACROSS the grain, v ALONG it.
      const u = (alongX ? y : x) / p.size;
      const v = (alongX ? x : y) / p.size;
      let g = 0;
      for (let k = 0; k < H; k++) {
        const wobble = Math.sin(TAU * (mk[k] * v + ph[k])) * 0.22;
        g += ak[k] * Math.sin(TAU * (nk[k] * u + wobble) + ph[k]);
      }
      g /= norm;

      const tint = 1 + g * NOISE_BUDGET.ALBEDO;
      setRgb(s, i, RGB_A[0] * tint, RGB_A[1] * tint, RGB_A[2] * tint);
      s.height[i] = 0.5;                       // brushing is not geometry
      s.roughness[i] = clamp01(rough + g * NOISE_BUDGET.ROUGHNESS);
      s.metalness[i] = p.metalness > 0 ? p.metalness : 1;
      s.teamMask[i] = 0;
    }
  }
  return s;
};

/**
 * The clean kinds. Requests for these get `packNormalStructural` instead of the
 * plain Sobel, so a stray gradient can never become a sandpaper normal map.
 */
export const CLEAN_KINDS: ReadonlySet<string> = new Set([
  'flatPaint', 'panelLines', 'asphalt', 'paving', 'cobblestone',
  'decal', 'brushedMetal',
]);

/** THE GENERATOR REGISTRY. Adding a surface type means adding one entry here. */
export const GENERATORS: Record<string, Generator> = {
  // --- the clean set (section 4B) — use these ---
  flatPaint: genFlatPaint,
  panelLines: genPanelLines,
  asphalt: genAsphalt,
  paving: genPaving,
  cobblestone: genCobblestone,
  decal: genDecal,
  brushedMetal: genBrushedMetal,
  // --- legacy (section 4) — being retired, do not add call sites ---
  noise: genNoise,
  metal: genMetal,
  rust: genRust,
  camo: genCamo,
  concrete: genConcrete,
  panelMetal: genPanelMetal,
  cloth: genCloth,
  ground: genGround,
  crystal: genCrystal,
  scorch: genScorch,
  treadPrint: genTreadPrint,
  smokePuff: genSmokePuff,
  blueNoise: genBlueNoise,
  checker: genChecker,
};

export type TextureKind = keyof typeof GENERATORS;

/* ==========================================================================
 * 5. GRADIENT RAMPS (1D LUTs)
 * ========================================================================== */

/**
 * Bake a colour ramp into a 1xN sRGB texture. The fire gradient in
 * ArtDirection.vfx is turned into one of these and sampled by normalized
 * particle life — which is why retuning an explosion is a data edit.
 */
export function makeGradientData(
  stops: readonly (readonly [number, string])[], width = 256,
): Uint8Array {
  const data = new Uint8Array(width * 4);
  if (stops.length === 0) return data;
  for (let x = 0; x < width; x++) {
    const t = x / (width - 1);
    // Find the bracketing stops.
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const span = b[0] - a[0];
    const lt = span < 1e-6 ? 0 : (t - a[0]) / span;
    const c = mixInt(hexToInt(a[1]), hexToInt(b[1]), lt);
    const o = x * 4;
    data[o] = (c >> 16) & 0xff;
    data[o + 1] = (c >> 8) & 0xff;
    data[o + 2] = c & 0xff;
    data[o + 3] = 255;
  }
  return data;
}

/* ==========================================================================
 * 6. PACKING TO GPU TEXTURES
 * ========================================================================== */

/** Quantize a float 0..1 to a byte. */
function b8(v: number): number {
  return clamp(Math.round(v * 255), 0, 255);
}

/** Pack the albedo channels (RGB sRGB + team mask in A). */
export function packAlbedo(s: Surface): Uint8Array {
  const n = s.size * s.size;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4, a = i * 3;
    out[o] = b8(s.albedo[a]);
    out[o + 1] = b8(s.albedo[a + 1]);
    out[o + 2] = b8(s.albedo[a + 2]);
    out[o + 3] = b8(s.teamMask[i]);
  }
  return out;
}

/** Pack the normal channels (normal XY + cavity in B + curvature in A). */
export function packNormal(s: Surface, relief = 2, cavityRadius = 3): Uint8Array {
  const n = s.size * s.size;
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const cav = new Float32Array(n);
  const cur = new Float32Array(n);
  normalFromHeight(s.height, s.size, relief, nx, ny);
  cavityFromHeight(s.height, s.size, cavityRadius, cav);
  curvatureFromHeight(s.height, s.size, cur);

  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    // Signed -1..1 mapped into 0..255.
    out[o] = b8(nx[i] * 0.5 + 0.5);
    out[o + 1] = b8(ny[i] * 0.5 + 0.5);
    out[o + 2] = b8(cav[i]);
    out[o + 3] = b8(cur[i]);
  }
  return out;
}

/** Pack ORM (ao / roughness / metalness + emissive mask in A). */
export function packOrm(s: Surface): Uint8Array {
  const n = s.size * s.size;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = b8(s.ao[i]);
    out[o + 1] = b8(s.roughness[i]);
    out[o + 2] = b8(s.metalness[i]);
    out[o + 3] = b8(s.emissive[i]);
  }
  return out;
}

/** Pack an alpha-only mask into RGBA (RGB = albedo, A = alpha). Decals. */
export function packMask(s: Surface): Uint8Array {
  const n = s.size * s.size;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4, a = i * 3;
    out[o] = b8(s.albedo[a]);
    out[o + 1] = b8(s.albedo[a + 1]);
    out[o + 2] = b8(s.albedo[a + 2]);
    out[o + 3] = b8(s.alpha[i]);
  }
  return out;
}

/** Which packing a request wants. */
export type Channel = 'albedo' | 'normal' | 'orm' | 'mask';

/* ==========================================================================
 * 7. THE FACTORY
 * ========================================================================== */

/** A texture request. The key is derived from every field, so it is stable. */
export interface TextureRequest extends AnyGenParams {
  kind: TextureKind;
  channel?: Channel;
  /** Repeat (true) or clamp (false). Decals clamp; surfaces repeat. */
  tiling?: boolean;
  /** Max anisotropic samples. Clamped to the renderer capability at upload. */
  anisotropy?: number;
  /**
   * Force (true) or forbid (false) the structural normal packer. Defaults to
   * true for every kind in `CLEAN_KINDS` and false for the legacy generators.
   * Set this to `true` on a legacy kind to strip its noise normal map without
   * changing its albedo — the cheapest possible first step off the old set.
   */
  structuralNormal?: boolean;
}

/** Every clean-set field, in a fixed order. Part of the cache key. */
function cleanKeyPart(p: Required<AnyGenParams>): string {
  return [
    p.colour, p.sheen, p.team, p.layout, p.lineColour, p.lineWidth, p.inset,
    p.outline, p.rivets, p.wear, p.slabW, p.slabH, p.jointWidth, p.jointColour,
    p.variation, p.bond, p.stoneSize, p.jitter,
    decalPathKey(p.path), p.glyph, p.direction,
  ].join('|');
}

/** Stable cache key. Every parameter that changes pixels must appear here. */
export function textureKey(req: TextureRequest): string {
  const p: Required<AnyGenParams> = { ...DEFAULT_PARAMS, ...stripUndefined(req) };
  return [
    req.kind, req.channel ?? 'albedo', p.size, p.seed,
    p.colorA, p.colorB, p.colorC,
    p.scale, p.amount, p.roughness, p.metalness, p.relief,
    cleanKeyPart(p),
    req.tiling === false ? 'clamp' : 'repeat',
    req.structuralNormal === undefined ? 'sn-' : req.structuralNormal ? 'sn1' : 'sn0',
  ].join('|');
}

interface CacheEntry {
  texture: THREE.DataTexture;
  key: string;
  bytes: number;
  /** Frame index of the last access, for LRU eviction. */
  lastUsed: number;
}

/**
 * THE ONLY WAY TO GET A TEXTURE.
 *
 * Generation is synchronous here. Anything >= 256^2 should be moved to a
 * worker in the render layer; the generators are already worker-safe (no DOM,
 * no THREE), so that migration touches only this class.
 */
export class TextureFactory {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly surfaceCache = new Map<string, Surface>();
  private clock = 0;

  /** Total bytes of GPU texture data currently held. */
  bytes = 0;
  /** Soft budget; least-recently-used textures are evicted above it. */
  budgetBytes = 192 * 1024 * 1024;
  /** Diagnostics. */
  generated = 0;
  hits = 0;

  /** Default anisotropy applied to repeating surface textures. */
  defaultAnisotropy = 8;
  /**
   * Hardware ceiling. The renderer should set this from
   * `renderer.capabilities.getMaxAnisotropy()` at boot; every request is
   * clamped to it, so asking for 16 on a device that supports 4 is safe.
   */
  maxAnisotropy = 16;

  /**
   * Get (or generate) a texture. Always returns a usable texture immediately.
   */
  get(req: TextureRequest): THREE.DataTexture {
    const key = textureKey(req);
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      hit.lastUsed = ++this.clock;
      this.hits++;
      return hit.texture;
    }

    const p: Required<AnyGenParams> = { ...DEFAULT_PARAMS, ...stripUndefined(req) };
    const surface = this.surface(req.kind, p);
    const channel: Channel = req.channel ?? 'albedo';

    // Clean kinds get the structural normal packer by default; a caller can
    // force either packer with `structuralNormal`.
    const structural = req.structuralNormal ?? CLEAN_KINDS.has(req.kind);

    let data: Uint8Array;
    let srgb = false;
    switch (channel) {
      case 'albedo': data = packAlbedo(surface); srgb = true; break;
      case 'normal':
        data = structural
          ? packNormalStructural(surface, p.relief)
          : packNormal(surface, p.relief);
        break;
      case 'orm':    data = packOrm(surface); break;
      default:       data = packMask(surface); srgb = true; break;
    }

    const tex = new THREE.DataTexture(data, p.size, p.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = key;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const wrap = req.tiling === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.wrapS = wrap;
    tex.wrapT = wrap;
    tex.magFilter = THREE.LinearFilter;
    // Trilinear + anisotropy is not optional. A missing mip chain turns ANY
    // fine detail into shimmering static at RTS camera distance, which reads
    // exactly like the noise this refactor exists to remove.
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = clamp(req.anisotropy ?? this.defaultAnisotropy, 1, this.maxAnisotropy);
    tex.needsUpdate = true;

    const bytes = data.byteLength * 4 / 3;  // + mip chain
    this.cache.set(key, { texture: tex, key, bytes, lastUsed: ++this.clock });
    this.bytes += bytes;
    this.generated++;
    this.evictIfNeeded();
    return tex;
  }

  /**
   * Get the raw generated Surface, cached independently of the packed
   * textures — so requesting albedo + normal + orm for one material runs the
   * generator ONCE, not three times.
   */
  surface(kind: TextureKind, params: AnyGenParams): Surface {
    // Accepts a PARTIAL param set: defaults are filled here, so a caller that
    // only cares about three fields does not have to spell out twenty.
    const p: Required<AnyGenParams> = {
      ...DEFAULT_PARAMS, ...stripUndefined({ kind, ...params } as TextureRequest),
    };
    const skey = [
      kind, p.size, p.seed, p.colorA, p.colorB, p.colorC,
      p.scale, p.amount, p.roughness, p.metalness,
      cleanKeyPart(p),
    ].join('|');
    const hit = this.surfaceCache.get(skey);
    if (hit !== undefined) return hit;

    const gen = GENERATORS[kind] ?? GENERATORS.checker;
    const s = gen(p);
    this.surfaceCache.set(skey, s);
    return s;
  }

  /** Bake a 1D colour ramp (fire gradient, health bar, LUT strip). */
  gradient(
    stops: readonly (readonly [number, string])[], width = 256, name = 'gradient',
  ): THREE.DataTexture {
    const key = `gradient|${name}|${width}|${stops.map((s) => s[0] + s[1]).join(',')}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) { hit.lastUsed = ++this.clock; this.hits++; return hit.texture; }

    const data = makeGradientData(stops, width);
    const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = key;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    this.cache.set(key, { texture: tex, key, bytes: data.byteLength, lastUsed: ++this.clock });
    this.bytes += data.byteLength;
    this.generated++;
    return tex;
  }

  /**
   * A 1x1 texture of a solid colour. Used as the immediate placeholder while a
   * real texture generates, and as the flat-colour stub for unimplemented
   * archetypes.
   */
  solid(hex: string, srgb = true): THREE.DataTexture {
    const key = `solid|${hex}|${srgb}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) { hit.lastUsed = ++this.clock; this.hits++; return hit.texture; }

    hexToRgb(hex, RGB_A);
    const data = new Uint8Array([b8(RGB_A[0]), b8(RGB_A[1]), b8(RGB_A[2]), 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = key;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.cache.set(key, { texture: tex, key, bytes: 4, lastUsed: ++this.clock });
    this.bytes += 4;
    return tex;
  }

  /**
   * Drop every cached texture whose key starts with `prefix`, so an art change
   * that alters (say) the Soviet camo colours rebuilds only those textures and
   * not the other 40 MB.
   */
  invalidate(prefix: string): number {
    let n = 0;
    for (const [key, entry] of this.cache) {
      if (!key.startsWith(prefix)) continue;
      entry.texture.dispose();
      this.bytes -= entry.bytes;
      this.cache.delete(key);
      n++;
    }
    for (const key of this.surfaceCache.keys()) {
      if (key.startsWith(prefix)) this.surfaceCache.delete(key);
    }
    return n;
  }

  /** Evict least-recently-used entries until we are under budget. */
  private evictIfNeeded(): void {
    if (this.bytes <= this.budgetBytes) return;
    const entries = Array.from(this.cache.values()).sort((a, b) => a.lastUsed - b.lastUsed);
    for (let i = 0; i < entries.length && this.bytes > this.budgetBytes * 0.9; i++) {
      const e = entries[i];
      e.texture.dispose();
      this.bytes -= e.bytes;
      this.cache.delete(e.key);
    }
  }

  /** Release everything. Between matches / on teardown. */
  dispose(): void {
    for (const e of this.cache.values()) e.texture.dispose();
    this.cache.clear();
    this.surfaceCache.clear();
    this.bytes = 0;
  }

  /** Diagnostics for the F3 overlay. */
  stats(): { count: number; megabytes: number; generated: number; hits: number } {
    return {
      count: this.cache.size,
      megabytes: this.bytes / (1024 * 1024),
      generated: this.generated,
      hits: this.hits,
    };
  }
}

/** Fields of TextureRequest that are NOT generator params. */
const NON_GEN_KEYS = new Set(['kind', 'channel', 'tiling', 'anisotropy', 'structuralNormal']);

/** Strip undefined values so a spread does not clobber defaults with undefined. */
function stripUndefined(req: TextureRequest): Partial<AnyGenParams> {
  const out: Record<string, unknown> = {};
  const src = req as unknown as Record<string, unknown>;
  for (const k in src) {
    if (src[k] !== undefined && !NON_GEN_KEYS.has(k)) out[k] = src[k];
  }
  return out as Partial<AnyGenParams>;
}

/** The shared factory. One per process; tests may construct their own. */
export const textures = new TextureFactory();

/* ==========================================================================
 * 8. CANVAS INTEROP
 *
 * The generators above deliberately avoid canvas 2D (its antialiasing differs
 * between engines, which would break screenshot diffing). Canvas is used only
 * where the OUTPUT must be a DOM image: HUD panel backgrounds injected into
 * CSS as data URLs.
 * ========================================================================== */

/** OffscreenCanvas where available, else a DOM canvas, else null (headless). */
export function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    return c;
  }
  return null;
}

/**
 * Render a Surface's packed albedo into a canvas and return a data URL, for
 * the CSS layer of the HUD. Returns an empty string in a headless context.
 */
export function surfaceToDataUrl(s: Surface, channel: Channel = 'albedo'): string {
  const canvas = createCanvas(s.size, s.size);
  if (canvas === null) return '';
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (ctx === null) return '';

  const data = channel === 'normal' ? packNormal(s)
    : channel === 'orm' ? packOrm(s)
    : channel === 'mask' ? packMask(s)
    : packAlbedo(s);
  // packAlbedo puts the team mask in alpha; for a DOM image we want opaque.
  const rgba = new Uint8ClampedArray(data.length);
  rgba.set(data);
  if (channel === 'albedo' || channel === 'normal' || channel === 'orm') {
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  }
  ctx.putImageData(new ImageData(rgba, s.size, s.size), 0, 0);

  if (typeof (canvas as HTMLCanvasElement).toDataURL === 'function') {
    return (canvas as HTMLCanvasElement).toDataURL('image/png');
  }
  return '';
}

/** Wrap an existing canvas as a THREE texture (cameo baking, HUD atlases). */
export function textureFromCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas, srgb = true,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/* ==========================================================================
 * 9. CONVENIENCE BUILDERS
 *
 * The three-texture set a PBR material actually needs, generated from ONE
 * surface pass. This is the call a material factory makes.
 * ========================================================================== */

export interface MaterialTextures {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  ormMap: THREE.DataTexture;
}

/** Albedo + normal + ORM for one surface request, sharing one generation. */
export function materialTextureSet(
  factory: TextureFactory, req: TextureRequest,
): MaterialTextures {
  return {
    map: factory.get({ ...req, channel: 'albedo' }),
    normalMap: factory.get({ ...req, channel: 'normal' }),
    ormMap: factory.get({ ...req, channel: 'orm' }),
  };
}

/**
 * Linear-space RGB triple for a hex colour, for direct upload into a uniform.
 * Allocates — call at material construction, never per frame.
 */
export function linearColorTriple(hex: string): [number, number, number] {
  hexToRgb(hex, RGB_A);
  return [srgbToLinear(RGB_A[0]), srgbToLinear(RGB_A[1]), srgbToLinear(RGB_A[2])];
}

/** Deterministic per-instance variation seed from an entity seed. */
export function instanceSeed(entitySeed: number, salt: number): number {
  return hash2f((entitySeed * 65536) | 0, salt);
}

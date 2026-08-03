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
  hexToRgb, hash2f, Rng, srgbToLinear, TAU, mixInt, hexToInt,
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

/** A generator turns params into a Surface. Pure, seeded, worker-safe. */
export type Generator = (p: Required<GenParams>) => Surface;

const DEFAULT_PARAMS: Required<GenParams> = {
  size: 512, seed: 1,
  colorA: '#808080', colorB: '#606060', colorC: '#404040',
  scale: 4, amount: 1, roughness: 0.8, metalness: 0, relief: 2,
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

/** THE GENERATOR REGISTRY. Adding a surface type means adding one entry here. */
export const GENERATORS: Record<string, Generator> = {
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
export interface TextureRequest extends GenParams {
  kind: TextureKind;
  channel?: Channel;
  /** Repeat (true) or clamp (false). Decals clamp; surfaces repeat. */
  tiling?: boolean;
  /** Max anisotropic samples. Clamped to the renderer capability at upload. */
  anisotropy?: number;
}

/** Stable cache key. Every parameter that changes pixels must appear here. */
export function textureKey(req: TextureRequest): string {
  const p = { ...DEFAULT_PARAMS, ...req };
  return [
    req.kind, req.channel ?? 'albedo', p.size, p.seed,
    p.colorA, p.colorB, p.colorC,
    p.scale, p.amount, p.roughness, p.metalness, p.relief,
    req.tiling === false ? 'clamp' : 'repeat',
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

    const p: Required<GenParams> = { ...DEFAULT_PARAMS, ...stripUndefined(req) };
    const surface = this.surface(req.kind, p);
    const channel: Channel = req.channel ?? 'albedo';

    let data: Uint8Array;
    let srgb = false;
    switch (channel) {
      case 'albedo': data = packAlbedo(surface); srgb = true; break;
      case 'normal': data = packNormal(surface, p.relief); break;
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
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = req.anisotropy ?? this.defaultAnisotropy;
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
  surface(kind: TextureKind, p: Required<GenParams>): Surface {
    const skey = [
      kind, p.size, p.seed, p.colorA, p.colorB, p.colorC,
      p.scale, p.amount, p.roughness, p.metalness,
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

/** Strip undefined values so a spread does not clobber defaults with undefined. */
function stripUndefined(req: TextureRequest): Partial<GenParams> {
  const out: Record<string, unknown> = {};
  const src = req as unknown as Record<string, unknown>;
  for (const k in src) {
    if (src[k] !== undefined && k !== 'kind' && k !== 'channel' && k !== 'tiling' && k !== 'anisotropy') {
      out[k] = src[k];
    }
  }
  return out as Partial<GenParams>;
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

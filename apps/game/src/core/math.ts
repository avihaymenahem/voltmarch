/**
 * ============================================================================
 * VOLTMARCH — src/core/math.ts
 * ============================================================================
 * Allocation-free scalar and 2D math, deterministic RNG, coherent noise, and
 * grid<->world conversion.
 *
 * HARD RULES
 * ----------
 * 1. NOTHING in this file allocates in a hot path. Functions that need to
 *    return a vector take a caller-supplied `out` array and return it.
 * 2. `Math.random()` is BANNED inside src/sim/** and inside every texture
 *    generator. Determinism is what makes the AI-vs-AI soak test meaningful
 *    and what makes a seeded map reproducible. Use `Rng` from this file.
 *    (`npm test` greps for violations.)
 * 3. Angles are radians, wrapped to [-PI, PI), measured about +Y, with 0
 *    facing +Z and increasing toward +X.
 * ============================================================================
 */

import { CELL, MAP_CELLS, MAP_SIZE } from './config';
import type { IRng } from './types';

/* ==========================================================================
 * CONSTANTS
 * ========================================================================== */

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI * 0.5;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
/** Small enough to ignore, large enough to survive f32 round-tripping. */
const EPSILON = 1e-6;

/* ==========================================================================
 * SCALAR
 * ========================================================================== */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Where does `v` sit between a and b, as 0..1? Returns 0 when a === b. */
function inverseLerp(a: number, b: number, v: number): number {
  const d = b - a;
  return Math.abs(d) < EPSILON ? 0 : (v - a) / d;
}

/** Map v from [inMin,inMax] onto [outMin,outMax], unclamped. */
export function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin + (outMax - outMin) * inverseLerp(inMin, inMax, v);
}

/** Hermite smoothstep. Clamped. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(inverseLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

export function step(edge: number, x: number): number {
  return x < edge ? 0 : 1;
}

/** Branchless-ish sign that returns 0 for 0. */
export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Fractional part, always positive. */
export function fract(v: number): number {
  return v - Math.floor(v);
}

/** Always-positive modulo. */
export function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/**
 * Frame-rate independent exponential approach.
 * `lambda` is the decay rate: higher converges faster. dt in seconds.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Square, because `x*x` with a long expression is a bug factory. */
export function sq(v: number): number { return v * v; }

/* ==========================================================================
 * ANGLES
 * ========================================================================== */

/**
 * Wrap to the half-open range [-PI, PI).
 *
 * NOTE the half-open-ness: exactly-opposite headings normalize to -PI, never
 * +PI. -PI and +PI denote the SAME direction, so never compare two angles for
 * equality — compare `Math.abs(angleDelta(a, b))` against a tolerance instead
 * (that is what `isFacing` is for).
 */
export function wrapAngle(a: number): number {
  a = mod(a + PI, TAU);
  return a - PI;
}

/**
 * Shortest signed difference from `a` to `b`, in [-PI, PI).
 * A perfect 180-degree reversal yields -PI, so a unit ordered to turn exactly
 * around always turns the same way. That is arbitrary but DETERMINISTIC, which
 * is what the replay and soak tests require.
 */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Interpolate along the SHORTEST arc. A naive lerp spins turrets the wrong way. */
export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + angleDelta(a, b) * t);
}

/** Rotate `current` toward `target` by at most `maxDelta` radians. */
export function turnToward(current: number, target: number, maxDelta: number): number {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxDelta) return wrapAngle(target);
  return wrapAngle(current + Math.sign(d) * maxDelta);
}

/** True if `current` faces `target` within `tolerance` radians. */
export function isFacing(current: number, target: number, tolerance: number): boolean {
  return Math.abs(angleDelta(current, target)) <= tolerance;
}

/**
 * Yaw that points from (x0,z0) toward (x1,z1) under our convention
 * (0 = +Z, increasing toward +X).
 */
export function yawTo(x0: number, z0: number, x1: number, z1: number): number {
  return Math.atan2(x1 - x0, z1 - z0);
}

/* ==========================================================================
 * FLAT ARRAY TYPE
 *
 * Callers supply [x,z] output buffers to allocation-free geometry helpers.
 * ========================================================================== */

export type Vec2Array = Float32Array | number[];

/* -- scalar-pair variants (no array at all — the fastest path) ------------- */

export function dist2(x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0, dz = z1 - z0;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Squared distance. Use this for comparisons — never take a sqrt to compare. */
export function distSq2(x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0, dz = z1 - z0;
  return dx * dx + dz * dz;
}

/**
 * Closest point on segment (ax,az)-(bx,bz) to (px,pz).
 * Writes [x, z] into `out`, returns the parametric t in 0..1.
 */
export function closestPointOnSegment(
  px: number, pz: number,
  ax: number, az: number, bx: number, bz: number,
  out: Vec2Array,
): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = 0;
  if (l2 > EPSILON) t = clamp01(((px - ax) * dx + (pz - az) * dz) / l2);
  out[0] = ax + dx * t;
  out[1] = az + dz * t;
  return t;
}

/**
 * Swept segment vs circle. THE test that stops projectiles tunnelling through
 * targets at 30 Hz — a bullet moving 60 m/s covers 2 m per tick.
 *
 * Returns the parametric t in [0,1] of the first intersection, or -1 for a miss.
 */
export function segCircleHit(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, r: number,
): number {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - cx, fz = az - cz;
  const a = dx * dx + dz * dz;
  if (a < EPSILON) {
    // Degenerate segment: it is a point test.
    return (fx * fx + fz * fz <= r * r) ? 0 : -1;
  }
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + disc) / (2 * a);
  if (t2 >= 0 && t2 <= 1) return t2;
  // Starting inside the circle counts as an immediate hit.
  if (t1 < 0 && t2 > 1) return 0;
  return -1;
}

/**
 * Launch angle for a ballistic shell to travel `dist` horizontally with a
 * height difference `dy`, at `speed`, under `gravity`.
 * Returns the LOW arc angle in radians, or NaN when the target is out of range.
 */
export function ballisticArc(dist: number, dy: number, speed: number, gravity: number): number {
  const s2 = speed * speed;
  const root = s2 * s2 - gravity * (gravity * dist * dist + 2 * dy * s2);
  if (root < 0) return NaN;
  return Math.atan((s2 - Math.sqrt(root)) / (gravity * dist));
}

/**
 * First-order target lead. Solves for the interception point of a projectile
 * of speed `projSpeed` fired from (sx,sz) at a target at (tx,tz) moving at
 * (tvx,tvz). Writes the aim point [x, z] into `out`.
 *
 * Falls back to the target's current position when no solution exists (target
 * outrunning the projectile), which is the correct visual behaviour: the shot
 * trails behind rather than aiming at nothing.
 */
export function leadTarget(
  sx: number, sz: number,
  tx: number, tz: number,
  tvx: number, tvz: number,
  projSpeed: number,
  out: Vec2Array,
): Vec2Array {
  const dx = tx - sx, dz = tz - sz;
  const a = tvx * tvx + tvz * tvz - projSpeed * projSpeed;
  const b = 2 * (dx * tvx + dz * tvz);
  const c = dx * dx + dz * dz;

  let t = -1;
  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) > EPSILON) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sd = Math.sqrt(disc);
      const t1 = (-b - sd) / (2 * a);
      const t2 = (-b + sd) / (2 * a);
      // Smallest positive root.
      if (t1 > 0 && t2 > 0) t = Math.min(t1, t2);
      else t = Math.max(t1, t2);
    }
  }
  if (!(t > 0) || !isFinite(t)) t = 0;
  out[0] = tx + tvx * t;
  out[1] = tz + tvz * t;
  return out;
}

/* ==========================================================================
 * GRID <-> WORLD
 *
 * Cell (0,0) covers world x,z in [0, CELL). The CENTRE of cell (cx,cz) is at
 * ((cx + 0.5) * CELL, (cz + 0.5) * CELL).
 * ========================================================================== */

/** World X (or Z) to a cell index along that axis. Floors, so it is negative
 *  off the top/left edge — always pair with `isInMap` or `clampCell`. */
export function worldToCell(w: number): number {
  return Math.floor(w / CELL);
}

/** Cell index to the world coordinate of the cell CENTRE. */
export function cellToWorld(c: number): number {
  return (c + 0.5) * CELL;
}

/** Flatten (cx,cz) into a row-major index. Caller must ensure it is in bounds. */
export function cellIndex(cx: number, cz: number): number {
  return cz * MAP_CELLS + cx;
}

/** True if a cell coordinate pair is inside the map. */
export function isInMap(cx: number, cz: number): boolean {
  return cx >= 0 && cz >= 0 && cx < MAP_CELLS && cz < MAP_CELLS;
}

/** Clamp a single cell axis into the map. */
export function clampCell(c: number): number {
  return c < 0 ? 0 : c >= MAP_CELLS ? MAP_CELLS - 1 : c;
}

/** Clamp a world coordinate into the map, with an optional inset margin. */
export function clampWorld(w: number, margin = 0): number {
  const lo = margin, hi = MAP_SIZE - margin;
  return w < lo ? lo : w > hi ? hi : w;
}

/**
 * Snap a world position to the correct origin for a building of footprint
 * (w,h) cells so it sits centred on whole cells. Writes [x,z] into `out`.
 * Odd footprints land on a cell centre; even footprints land on a cell edge.
 */
export function snapFootprintToGrid(
  x: number, z: number, w: number, h: number, out: Vec2Array,
): Vec2Array {
  const cx = Math.round(x / CELL - w * 0.5);
  const cz = Math.round(z / CELL - h * 0.5);
  out[0] = (cx + w * 0.5) * CELL;
  out[1] = (cz + h * 0.5) * CELL;
  return out;
}

/** Origin cell (minimum corner) of a footprint centred at a world position. */
export function footprintOriginCell(x: number, z: number, w: number, h: number, out: Int32Array): Int32Array {
  out[0] = Math.round(x / CELL - w * 0.5);
  out[1] = Math.round(z / CELL - h * 0.5);
  return out;
}

/* ==========================================================================
 * HASHING
 *
 * Integer hashes used for stable per-entity/per-cell randomness that does not
 * need an RNG stream (and therefore does not perturb determinism).
 * ========================================================================== */

/** Robert Jenkins' 32 bit integer hash. Returns an unsigned 32-bit int. */
export function hashU32(x: number): number {
  x = (x + 0x7ed55d16 + (x << 12)) | 0;
  x = (x ^ 0xc761c23c ^ (x >>> 19)) | 0;
  x = (x + 0x165667b1 + (x << 5)) | 0;
  x = ((x + 0xd3a2646c) ^ (x << 9)) | 0;
  x = (x + 0xfd7046c5 + (x << 3)) | 0;
  x = (x ^ 0xb55a4f09 ^ (x >>> 16)) | 0;
  return x >>> 0;
}

/** Hash two integers to an unsigned 32-bit int. */
export function hash2i(x: number, y: number): number {
  return hashU32((x * 73856093) ^ (y * 19349663));
}

/** Hash three integers. */
function hash3i(x: number, y: number, z: number): number {
  return hashU32((x * 73856093) ^ (y * 19349663) ^ (z * 83492791));
}

/** Hash two integers to a float in [0,1). */
export function hash2f(x: number, y: number): number {
  return hash2i(x, y) / 4294967296;
}

/** Hash three integers to a float in [0,1). */
function hash3f(x: number, y: number, z: number): number {
  return hash3i(x, y, z) / 4294967296;
}

/* ==========================================================================
 * SEEDED PRNG
 *
 * mulberry32: 32 bits of state, excellent statistical quality for a game,
 * and — critically — reproducible across machines and browsers, which
 * `Math.random()` is not.
 * ========================================================================== */

/**
 * Raw mulberry32 generator. Returns a closure producing floats in [0,1).
 * Prefer the `Rng` class unless you specifically want a bare function.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The deterministic random source. Every sim system, map generator and texture
 * generator uses one of these. Two runs with the same seed produce byte-identical
 * results — that is what makes the determinism soak test worth running.
 */
export class Rng implements IRng {
  private a: number;
  /** Cached second sample from the Box-Muller pair. */
  private spare = 0;
  private hasSpare = false;

  constructor(seed: number) {
    this.a = seed >>> 0;
    // Avoid the degenerate all-zero state.
    if (this.a === 0) this.a = 0x9e3779b9;
  }

  /** Uniform [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max], inclusive both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniform element. Throws nothing on an empty array — returns undefined. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** -1 or +1. */
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** Standard normal (mean 0, stddev 1) via Box-Muller with a cached spare. */
  gauss(): number {
    if (this.hasSpare) { this.hasSpare = false; return this.spare; }
    let u = 0, v = 0, s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this.spare = v * m;
    this.hasSpare = true;
    return u * m;
  }

  /** Uniform point on the unit circle, written into `out` as [x, z]. */
  unitVec2(out: Vec2Array): Vec2Array {
    const a = this.next() * TAU;
    out[0] = Math.cos(a); out[1] = Math.sin(a);
    return out;
  }

  /** Uniform point inside a disc of radius r, written into `out`. */
  inDisc(r: number, out: Vec2Array): Vec2Array {
    const a = this.next() * TAU;
    const d = r * Math.sqrt(this.next());
    out[0] = Math.cos(a) * d; out[1] = Math.sin(a) * d;
    return out;
  }

  /**
   * A new independent stream. Use this so a subsystem consuming a variable
   * number of samples cannot perturb the main stream and break determinism.
   */
  fork(): Rng {
    return new Rng(hashU32(this.a ^ 0x9e3779b9));
  }

  /** In-place Fisher-Yates. Deterministic given the same seed and input. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  getState(): number { return this.a; }
  setState(s: number): void { this.a = s >>> 0; this.hasSpare = false; }
}

/**
 * A shared non-deterministic RNG for PRESENTATION ONLY (UI jitter, menu
 * sparkle). It is explicitly named so a reviewer can see at a glance that no
 * sim code is using it.
 */
export const presentationRng = new Rng(0xc0ffee);

/* ==========================================================================
 * COHERENT NOISE
 *
 * Both the terrain generator and the texture generators use THESE functions,
 * so rust streaks and ground erosion share a visual family. Do not roll your
 * own noise in a generator.
 * ========================================================================== */

/** Smooth interpolant used by value noise. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 2D value noise in [-1, 1]. Cheap; good for masks and low-frequency breakup. */
export function value2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);

  const s = seed | 0;
  const n00 = hash3f(xi, yi, s);
  const n10 = hash3f(xi + 1, yi, s);
  const n01 = hash3f(xi, yi + 1, s);
  const n11 = hash3f(xi + 1, yi + 1, s);

  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * 2 - 1;
}

// --- Simplex ---------------------------------------------------------------

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** 12 gradient directions for 2D simplex, as flat [x,y] pairs. */
const GRAD2 = new Float32Array([
  1, 1, -1, 1, 1, -1, -1, -1,
  1, 0, -1, 0, 1, 0, -1, 0,
  0, 1, 0, -1, 0, 1, 0, -1,
]);

/**
 * 2D simplex noise, roughly [-1, 1]. The primary shape source for terrain,
 * camo blobs, rust blooms and cloud noise.
 */
export function simplex2(xin: number, yin: number, seed = 0): number {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t), y0 = yin - (j - t);

  let i1 = 0, j1 = 0;
  if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }

  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;

  const g0 = (hash3i(i, j, seed) % 12) * 2;
  const g1 = (hash3i(i + i1, j + j1, seed) % 12) * 2;
  const g2 = (hash3i(i + 1, j + 1, seed) % 12) * 2;

  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { t0 *= t0; n0 = t0 * t0 * (GRAD2[g0] * x0 + GRAD2[g0 + 1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { t1 *= t1; n1 = t1 * t1 * (GRAD2[g1] * x1 + GRAD2[g1 + 1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { t2 *= t2; n2 = t2 * t2 * (GRAD2[g2] * x2 + GRAD2[g2 + 1] * y2); }

  return 70 * (n0 + n1 + n2);
}

/**
 * Fractional Brownian motion: `octaves` layers of simplex at doubling
 * frequency and halving amplitude. The default terrain shape.
 */
export function fbm2(
  x: number, y: number, octaves = 4, lacunarity = 2.0, gain = 0.5, seed = 0,
): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += simplex2(x * freq, y * freq, seed + o * 131) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Ridged multifractal in [0,1]. Produces sharp crests — the right primitive
 * for cliff ridges and for the veins in rust and cracked concrete.
 */
export function ridged2(
  x: number, y: number, octaves = 4, lacunarity = 2.0, gain = 0.5, seed = 0,
): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(simplex2(x * freq, y * freq, seed + o * 131));
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Worley (cellular) noise. Writes [F1, F2, cellId] into `out`:
 *  - F1 = distance to the nearest feature point (rust bloom cores, crystal facets)
 *  - F2 = distance to the second nearest (F2-F1 gives crack/vein lines)
 *  - cellId = a stable hash of the owning cell, for per-cell randomness
 * Returns `out`.
 */
export function worley2(x: number, y: number, seed: number, out: Float32Array): Float32Array {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, id = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const h = hash3i(cx, cy, seed);
      // Two decorrelated offsets in [0,1) from one hash.
      const ox = (h & 0xffff) / 65536;
      const oy = ((h >>> 16) & 0xffff) / 65536;
      const px = cx + ox, py = cy + oy;
      const ddx = px - x, ddy = py - y;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < f1) { f2 = f1; f1 = d; id = h; }
      else if (d < f2) { f2 = d; }
    }
  }
  out[0] = f1; out[1] = f2; out[2] = id / 4294967296;
  return out;
}

/* ==========================================================================
 * COLOR
 *
 * Shared by config consumers, the HUD theme and every texture generator, so a
 * hex string in config.ts means exactly one thing everywhere.
 * ========================================================================== */

/** '#RRGGBB' (or 'RRGGBB') to a packed 0xRRGGBB integer. */
export function hexToInt(hex: string): number {
  const s = hex.charCodeAt(0) === 35 /* '#' */ ? hex.slice(1) : hex;
  return parseInt(s, 16) | 0;
}

/** '#RRGGBB' to sRGB floats in 0..1, written into `out` as [r,g,b]. */
export function hexToRgb(hex: string, out: Float32Array | number[]): Float32Array | number[] {
  const v = hexToInt(hex);
  out[0] = ((v >> 16) & 0xff) / 255;
  out[1] = ((v >> 8) & 0xff) / 255;
  out[2] = (v & 0xff) / 255;
  return out;
}

/** sRGB 0..1 to linear 0..1. Use before any lighting math. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear 0..1 to sRGB 0..1. */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** '#RRGGBB' to LINEAR floats, written into `out`. What shaders want. */
export function hexToLinearRgb(hex: string, out: Float32Array | number[]): Float32Array | number[] {
  hexToRgb(hex, out);
  out[0] = srgbToLinear(out[0] as number);
  out[1] = srgbToLinear(out[1] as number);
  out[2] = srgbToLinear(out[2] as number);
  return out;
}

/** Mix two packed colours in sRGB space. */
export function mixInt(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (((ar + (br - ar) * t) | 0) << 16)
       | (((ag + (bg - ag) * t) | 0) << 8)
       | (((ab + (bb - ab) * t) | 0));
}

/** Relative luminance of sRGB 0..1 components. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * HSV to RGB, all in 0..1. Written into `out` as [r,g,b].
 * Used by generators that need a hue family rather than fixed hex values.
 */
export function hsvToRgb(h: number, s: number, v: number, out: Float32Array | number[]): Float32Array | number[] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: out[0] = v; out[1] = t; out[2] = p; break;
    case 1: out[0] = q; out[1] = v; out[2] = p; break;
    case 2: out[0] = p; out[1] = v; out[2] = t; break;
    case 3: out[0] = p; out[1] = q; out[2] = v; break;
    case 4: out[0] = t; out[1] = p; out[2] = v; break;
    default: out[0] = v; out[1] = p; out[2] = q; break;
  }
  return out;
}

/**
 * ============================================================================
 * VOLTMARCH — src/world/terrain-texture-gen.ts
 * ============================================================================
 * THE GROUND TILES, WITH NO RENDERER IN SIGHT.
 *
 * Split out of `TerrainMaterial.ts` for exactly the reason `terrain-gen.ts` was
 * split out of `Terrain.ts`: so a Web Worker can run it. `TerrainMaterial.ts`
 * imports THREE; a worker that reached it would pull ~700 kB of renderer into a
 * chunk that renders nothing, and `tests/texture-workers.spec.ts` walks the
 * graph and fails on it.
 *
 * This file imports `../core/surfaces`, `../core/math` and `./Biomes` — all
 * three of which are already inside the worker graph, and none of which touches
 * THREE. It must NEVER import `../core/assets`: that module re-exports
 * everything here from `surfaces.ts` and ALSO carries the renderer, so reaching
 * there for `budgetedNoise` would drag Three.js in through the back door. That
 * is not hypothetical — it is the identical trap the `surfaces.ts` split was
 * created to close, and `TerrainMaterial.ts` imported exactly that way until
 * this file existed.
 *
 * WHY IT WAS WORTH MOVING
 * -----------------------
 * `createTerrainMaterials` measured at 350-435 ms of main-thread time on the
 * `08-naval-water` fixture — after the heightfield and the chunk vertices had
 * already been moved off thread by `terrain-gen.ts`, which left the layer tiles
 * as essentially the entire remaining cost of `world.terrain`'s init. The bulk
 * is `buildLayerArrayBytes`: six 256² tiles, four of which are `field` surfaces
 * costing two `budgetedNoise` evaluations, a third for the patch mask, and a
 * twelve-harmonic mesoscale row per texel.
 *
 * All of it is a pure function of `(biome, size, seed)`. Nothing here reads a
 * uniform, a camera or a light rig, which is what makes it movable at all.
 *
 * THE BYTES ARE THE PRODUCT, NOT A `Texture`
 * ------------------------------------------
 * `buildLayerArrayBytes` returns ONE flat `Uint8Array` holding all six layers
 * back to back, which is precisely the layout `THREE.DataArrayTexture` wants.
 * That is also why an `ImageBitmap` was not an option here even in principle: a
 * bitmap is a single 2D image and there is no texture-ARRAY form of it, so six
 * of them would mean six transfers plus a six-slice copy on the main thread to
 * reassemble the very buffer this already is. A transferred typed array costs a
 * pointer.
 *
 * The same argument settles the warp and macro tiles for a different reason:
 * their channels are noise fields, not colour. `createImageBitmap` is entitled
 * to apply colour-space conversion and premultiplied alpha, and a warp texture
 * whose R and G have been through either is a splat lookup displaced by the
 * wrong amount — which nobody would ever see as a bug, only as slightly
 * different ground. Raw bytes have no such latitude.
 *
 * ONE IMPLEMENTATION, NOT TWO
 * ---------------------------
 * Everything below is the code that used to live in `TerrainMaterial.ts`, moved
 * rather than reimplemented, and re-exported from there so that every existing
 * caller and both specs still import the same names from the same place. The
 * one edit of substance is in `buildLayerSurface`, which used to reach for the
 * `textures` singleton in `assets.ts`; it now calls the `generateSurface` /
 * `resolveParams` pair that `TextureFactory.surface()` itself calls, with its
 * own memo in front. Same function, same parameters, same bytes.
 * ============================================================================
 */

import {
  NOISE_BUDGET, budgetedNoise, createSurface, generateSurface, packAlbedo,
  resolveParams, surfaceKey, type Surface, type TextureKind, type TextureRequest,
} from '../core/surfaces';
import { clamp01, fbm2, lerp, simplex2, smoothstep } from '../core/math';
import { SURFACE_COUNT, type BiomeDef, type SurfaceLayerDef } from './Biomes';

/* ==========================================================================
 * 1. THE SUPPORT TILES
 * ========================================================================== */

/**
 * Two independent fbm channels in R and G, used to displace the splat lookup.
 * They must be INDEPENDENT: a warp built from one channel and its inverse
 * pushes every boundary along a single diagonal and reads as a shear.
 *
 * TWO octaves, not three, and at 2/3 the base frequency. The point of the warp
 * is to stop a surface boundary being a straight line — it is not a source of
 * detail. The third octave landed at ~5 texels of a 128-texel tile spread over
 * 11 m, i.e. a 40 cm wobble, which turned every grass/dirt edge into a fringe
 * of noise instead of a shape.
 */
export const WARP_N = 128;

/** The warp tile's bytes. The `DataTexture` around them is built by the caller. */
export function buildWarpBytes(seed: number): Uint8Array {
  const N = WARP_N;
  const data = new Uint8Array(N * N * 4);
  const f = 4 / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      const a = fbm2(x * f, y * f, 2, 2, 0.5, seed);
      const b = fbm2(x * f + 11.3, y * f + 7.9, 2, 2, 0.5, seed + 977);
      data[o] = Math.max(0, Math.min(255, Math.round((a * 0.5 + 0.5) * 255)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round((b * 0.5 + 0.5) * 255)));
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  return data;
}

/**
 * R = regional luminance swell, G = an independent mask driving the tint pull,
 * B = a coarse blotch. Sampled at 28-38 m per repeat, this is the layer that
 * makes an 8 m grass tile invisible.
 *
 * TWO octaves everywhere. At four octaves and a base of 3.5 cycles per 256
 * texels, the finest octave was ~9 texels of a tile covering 34 m — a 1.2 m
 * blotch, which at RTS distance reads as dirt smeared on the lawn rather than
 * as regional variation. Two octaves puts the finest feature at ~6.5 m, so the
 * layer does exactly one job: hide the repeat of an 8 m tile.
 */
export const MACRO_N = 256;

/** The macro tile's bytes. */
export function buildMacroBytes(seed: number): Uint8Array {
  const N = MACRO_N;
  const data = new Uint8Array(N * N * 4);
  const f = 2.6 / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      const a = fbm2(x * f, y * f, 2, 2, 0.5, seed) * 0.5 + 0.5;
      const b = fbm2(x * f * 1.4 + 3.1, y * f * 1.4 - 5.4, 2, 2, 0.5, seed + 421) * 0.5 + 0.5;
      const c = simplex2(x * f * 0.6, y * f * 0.6, seed + 88) * 0.5 + 0.5;
      data[o] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      data[o + 1] = Math.round(Math.max(0, Math.min(1, b)) * 255);
      data[o + 2] = Math.round(Math.max(0, Math.min(1, c)) * 255);
      data[o + 3] = 255;
    }
  }
  return data;
}

/* --------------------------------------------------------------------------
 * 3B. THE CLEAN LAYER TILES
 * ------------------------------------------------------------------------ */

/**
 * Hard ceiling on a field layer's broad value drift. 6% peak-to-mean is what
 * "you can tell it is not a solid fill" costs; anything past that starts to
 * read as staining rather than as ground.
 */
export const FIELD_DRIFT_CAP = 0.06;

/** Hard ceiling on how far a patch can pull toward `shade` / `accent`. */
export const FIELD_PATCH_CAP = 0.45;

/**
 * Shortest wavelength any field drift may use, in texels — twice the
 * `assets.ts` floor. A layer tiles at 5-10 m over 256 texels, so 48 texels is
 * 1-2 m of ground and roughly 40 screen pixels at 1440p. That is the boundary
 * between "broad soft variation" and "grain".
 */
export const FIELD_MIN_WAVELENGTH = NOISE_BUDGET.MIN_FEATURE_TEXELS * 2;

/* --------------------------------------------------------------------------
 * 3B-bis. THE MESOSCALE BAND — the hole the purge left behind
 * ------------------------------------------------------------------------ */

/**
 * ============================================================================
 * WHY THIS EXISTS, GIVEN THAT "NO NOISE" IS THE ONE RULE
 * ============================================================================
 * Both things are true at once:
 *
 *   - The purge above was right. `genGround` wrote five octaves of fbm plus a
 *     7x fbm plus a 9x worley field at 2-4 cm per texel, while the camera
 *     resolves ~1-4 cm per screen pixel. That is per-PIXEL noise, it aliases,
 *     and roads looked like TV static.
 *   - And the ground had a HOLE in it. Count what the terrain actually varies
 *     at today: 28-38 m macro, 4 m per-cell hash, +/-0.6 m mask warp, and
 *     nothing inside a field tile shorter than 48 texels ~ 1.5 m. Below 4 cm
 *     is banned and above 1.5 m is covered, so the whole 4 cm - 1.5 m band is
 *     empty — and that band is precisely what the eye reads as SURFACE
 *     MATERIAL. Soil mottling, grass clumping, patchiness, wear. Its absence
 *     is why a lawn at minimum zoom is a flat olive slab.
 *
 * So the rule is not "no variation". The rule is "nothing at or below the
 * screen-pixel scale", and the fix is to say that in a number.
 *
 * ----------------------------------------------------------------------------
 * THE FLOOR, DERIVED FROM THE ACTUAL CAMERA
 * ----------------------------------------------------------------------------
 * `tests/terrain-frequency.spec.ts` re-derives every line of this from the live
 * `RENDER_CONFIG.camera`, so lowering `minDistance` or flattening the pitch
 * clamp turns the suite red instead of quietly resurrecting the sandpaper.
 * The numbers below are today's:
 *
 *   fov 36 deg vertical over 1440 px  ->  2*tan(18)/1440 = 4.5128e-4
 *                                          metres of view plane per pixel,
 *                                          per metre of slant range
 *   minDistance 30 m, pitchAtMinDistance 46 deg
 *   camera height          h = 30 * sin(46)          = 21.580 m
 *   bottom-of-frame ray at   46 + 36/2 = 64 deg below horizontal
 *   nearest visible ground   D = h / sin(64)         = 24.010 m   <- worst case
 *   ground metres per screen pixel, along the SCREEN-HORIZONTAL axis (which
 *   lies in the ground plane, so it is un-foreshortened and therefore the
 *   FINER of the two axes):
 *                            24.010 * 4.5128e-4      = 0.010835 m  (1.08 cm)
 *
 * A shallower pitch moves that D down, so the pitch clamp is load-bearing and
 * the test asserts against it.
 *
 * At a floor of `MESO_MIN_SCREEN_PX` = 16 screen pixels, the shortest ground
 * wavelength anything here may carry is 16 * 0.010835 = 0.1734 m. We declare
 * 0.24 m, a 38% margin, and the finest component actually used is 0.32 m —
 * about 30 screen pixels at the worst case. Nothing near a pixel.
 * ============================================================================
 */

/**
 * The safety floor, in SCREEN pixels at 1440p, at the closest gameplay zoom.
 *
 * 8 px is the defensible minimum — below it a feature is inside the SMAA
 * kernel and inside the mip transition, which is where the original bug lived.
 * 16 is chosen instead because the derivation has three soft spots (the
 * viewport can be taller than 1440 on an ultrawide, `pitch` is becoming
 * player-adjustable, and a future zoom-in would shrink `minDistance`), and a
 * 2x margin is cheaper than re-deriving this under pressure.
 */
export const MESO_MIN_SCREEN_PX = 16;

/**
 * The declared ground-space floor in metres. Must be >= the value the camera
 * derivation above produces; the test computes that value and compares.
 */
export const MESO_MIN_METRES = 0.24;

/**
 * A texel floor as well as a metre floor, and the tile takes whichever is
 * COARSER.
 *
 * The metre floor answers "does this alias on screen". The texel floor answers
 * a different question: "does this survive mipping and does it trip
 * `checkNoiseBudget`". A 10-texel feature is still 5 texels at mip 1 and 2.5 at
 * mip 2, so it fades out with distance rather than sparkling — and its steepest
 * one-texel step is `amp * (1 - cos(2*pi/10))` = 0.19 * amp, two orders below
 * the speckle gate at the amplitudes used here.
 *
 * Half of `NOISE_BUDGET.MIN_FEATURE_TEXELS`, and deliberately NOT a change to
 * that constant: every other generator in the game keeps the 24-texel floor.
 * This is the one place with a measured screen-pixel argument for going below
 * it, so this is the only place that does.
 */
export const MESO_MIN_TEXELS = 10;

/** Fine octave, in METRES of ground. Linear, so its harmonic order is 1. */
export const MESO_FINE_METRES = 0.32;

/**
 * Wide octave, in METRES of ground. Shaped by `mesoShape` below, which is a
 * CUBIC, so it carries energy up to 3x its fundamental: its effective shortest
 * wavelength is 1.25 / 3 = 0.417 m.
 *
 * This is the trap that produced the original bug in a different costume. fbm
 * has energy all the way to Nyquist by definition; a NONLINEARITY applied to a
 * band-limited field does the same thing more quietly. `smoothstep` is a cubic
 * and multiplies the bandwidth by 3, `abs()`/`max(0,x)` rectification has
 * harmonics that never terminate at all. So: the wide octave gets a cubic and
 * pays 3x for it, the fine octave gets nothing, and the result is applied
 * ADDITIVELY rather than through a `lerp` — because `lerp(v, c, t)` multiplies
 * two fields together and a product's bandwidth is the SUM of theirs.
 */
export const MESO_WIDE_METRES = 1.25;

/** Bandwidth multiplier of `mesoShape`. A cubic polynomial: exactly 3. */
export const MESO_WIDE_ORDER = 3;

/**
 * Clump shaper for the wide octave. `0.35*t + 0.65*t^3` on t in [-1,1]:
 * odd (so it adds no DC), bounded by 1, and flat near zero — which is what
 * turns a sine field into "mostly ordinary ground with occasional patches"
 * rather than a rolling swell. Degree 3, and nothing here may raise that
 * without raising `MESO_WIDE_METRES` to match.
 */
function mesoShape(t: number): number {
  return 0.35 * t + 0.65 * t * t * t;
}

/** Relative weight of the two octaves. Sums to exactly 1, so |meso| <= 1. */
export const MESO_FINE_WEIGHT = 0.45;
export const MESO_WIDE_WEIGHT = 0.55;

/**
 * How far a texel may travel along the bare<->lush axis, per unit of `L.patch`.
 * `patch` already means "how blotchy is this ground" per layer, so reusing it
 * keeps sand and snow flat (0.22 / 0.18) and lets dirt mottle (0.38) without
 * inventing a def field.
 */
export const MESO_PULL_GAIN = 2.6;

/** Absolute ceiling on that pull, whatever `patch` says. */
export const MESO_PULL_MAX = 0.95;

/**
 * THE AXIS ITSELF — and why it is a colour axis and not a brightness one.
 *
 * Uniform luminance jitter is the thing that reads as dirt on the lens; it is
 * also exactly what the banned full-screen film grain was already doing. Real
 * ground varies in HUE and CHROMA: a dense clump of grass is more saturated and
 * slightly DARKER (the blades shadow each other), a thin patch is less
 * saturated, slightly lighter and warmer because soil is showing through.
 *
 * So the axis is built as two derived endpoints and applied as a signed
 * displacement about the layer's own colour:
 *
 *   lush = chroma x 1.56, luma x 0.925
 *   bare = chroma x 0.36, luma x 1.075, warmed
 *
 * Those look violent written down and are not, because the field they multiply
 * has an RMS of 0.11 and a measured peak of 0.49 — a twelve-harmonic sum with
 * random phases is nowhere near its bound. Measured on the temperate grass tile
 * at 256: saturation 0.817 +/- 0.037, value 0.431 +/- 0.007. That is 4.6% of
 * chroma against 1.6% of brightness, which is the ratio the whole design is
 * for, and `tests/terrain-frequency.spec.ts` asserts it stays above 1.5.
 *
 * Three properties make this safe by construction, which matters because the
 * emerald window (scorecard #9, weight 3, automatic fail) is one bad green
 * away:
 *
 *   1. Chroma scaling is `v -> L + (v - L)*k` about the texel's own luminance
 *      with k > 0. That is monotone in v, so it CANNOT reorder the channels:
 *      a layer authored with r >= g still has r >= g afterwards, at any k.
 *   2. It is also luminance-NEUTRAL under the same weights `checkNoiseBudget`
 *      uses, so the chroma half of this contributes exactly zero to the speckle
 *      metric and zero to the tile's contrast ratio.
 *   3. The warm tilt raises r and lowers b, which moves AWAY from hue 100-120,
 *      and it is gated off entirely on cool surfaces (`r < b`) so that snow ice
 *      does not turn brown.
 */
const MESO_LUSH_CHROMA = 1.56;
const MESO_LUSH_LUMA = 0.925;
const MESO_BARE_CHROMA = 0.36;
const MESO_BARE_LUMA = 1.075;
/** Per-channel tilt of the bare end, before luma is renormalised. */
const MESO_WARM = [1.14, 0.93, 0.82] as const;

const LUMA_R = 0.2126, LUMA_G = 0.7152, LUMA_B = 0.0722;

/* -- the band-limited field ------------------------------------------------ */

/**
 * A sum of plane waves at INTEGER frequencies, same construction as
 * `assets.ts` `budgetedNoise` and for the same three reasons: exactly periodic
 * (so the tile is seamless), band-limited by construction (so the floor is a
 * guarantee rather than a hope), and bounded in amplitude.
 *
 * It is a separate implementation rather than a parameter on `budgetedNoise`
 * because `budgetedNoise`'s 24-texel floor is a promise made to every other
 * generator in the game, and the correct way to take a lower floor is to bring
 * your own screen-pixel argument — not to weaken theirs.
 *
 * Two differences from `budgetedNoise`, both tightening:
 *   - `cycles` is FLOORED, not rounded, so the realised wavelength is always
 *     >= the requested one rather than within half a texel of it;
 *   - every harmonic is clamped so `|n| <= cycles` AFTER rounding. Rounding the
 *     two axes independently can otherwise push a diagonal harmonic past the
 *     base frequency by up to 0.71 cycles.
 */

/**
 * TWELVE harmonics, STRATIFIED, over a band running down to 0.30 of the base
 * frequency. All three of those were bought with a visible artefact.
 *
 *  - Five harmonics inside 0.62-1.0 of one frequency is not a noise field, it
 *    is a moire lattice, and at the amplitude this ships at you can see the
 *    grid: a regular diagonal cross-hatch over the whole lawn.
 *  - Widening the band to 0.30-1.0 costs nothing, because the wavelength floor
 *    constrains only the TOP of the band. Everything below is free.
 *  - Twelve UNIFORMLY RANDOM directions still clump, and a clump of parallel
 *    waves is a streak: the grass tile came out combed diagonally. Jittered
 *    stratification (see `mesoWaveSet`) fixed it.
 *
 * Amplitudes are FLAT rather than rolled off, for the same reason: any
 * roll-off puts most of the energy in the first two or three harmonics and the
 * lattice comes straight back.
 */
const MESO_HARMONICS = 12;
/** Lowest fraction of the base frequency a harmonic may take. */
const MESO_BAND_LOW = 0.30;
const TAU = Math.PI * 2;

interface MesoWaves {
  nx: Int32Array; ny: Int32Array; phase: Int32Array; amp: Float32Array;
}

const mesoCache = new Map<string, MesoWaves>();

/**
 * `sin(TAU * j / size)` for integer j. Every harmonic's argument here is
 * `TAU * (nx*x + ny*y + phase) / size` with all four terms INTEGER, so the sine
 * only ever takes `size` distinct values and a table is EXACT rather than an
 * approximation. (Phase is quantised to whole texels to make it so, which costs
 * nothing — the phase was an arbitrary random offset to begin with.)
 *
 * Worth doing because this is 24 harmonic evaluations per texel across four
 * 256x256 layers per biome. Table plus the row recurrence in `mesoOctaveRow`
 * took the whole mesoscale field from 51 ms per layer to 2.2 ms.
 */
const mesoSinTables = new Map<number, Float64Array>();

function mesoSinTable(size: number): Float64Array {
  const hit = mesoSinTables.get(size);
  if (hit !== undefined) return hit;
  const t = new Float64Array(size);
  for (let j = 0; j < size; j++) t[j] = Math.sin((TAU * j) / size);
  if (mesoSinTables.size > 8) mesoSinTables.clear();
  mesoSinTables.set(size, t);
  return t;
}

/** Deterministic integer hash -> [0,1). No `Math.random`, ever. */
function mesoHash(i: number, seed: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(seed, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Build (or fetch) the harmonic set whose highest spatial frequency is exactly
 * `cycles` per tile. Exported so the test can assert that bound directly rather
 * than trusting this comment.
 */
export function mesoWaveSet(cycles: number, seed: number, size: number): MesoWaves {
  const key = `${cycles}:${seed}:${size}`;
  const hit = mesoCache.get(key);
  if (hit !== undefined) return hit;

  const nx = new Int32Array(MESO_HARMONICS), ny = new Int32Array(MESO_HARMONICS);
  const phase = new Int32Array(MESO_HARMONICS), amp = new Float32Array(MESO_HARMONICS);
  let norm = 0;
  for (let k = 0; k < MESO_HARMONICS; k++) {
    // STRATIFIED, not random, in both angle and radius.
    //
    // Twelve independently-random directions are not twelve evenly-spread
    // directions — they clump, and a clump of parallel waves is a visible
    // streak. The grass tile came out combed diagonally at this amplitude with
    // uniform-random angles. Jittered stratification keeps every draw distinct
    // while guaranteeing the directions actually cover the circle.
    //
    // The angle strata span [0, PI), not [0, 2*PI): for a real-valued field a
    // wave at theta and one at theta+PI are the same wave with a sign flip, so
    // spreading over the full circle wastes half the strata on duplicates.
    const a = ((k + mesoHash(k * 5 + 1, seed)) / MESO_HARMONICS) * Math.PI;
    // Radius strata are visited in a permuted order — 5 is coprime with 12, so
    // `5k mod 12` hits every stratum exactly once — which stops the low
    // frequencies all landing on neighbouring directions.
    const rk = (k * 5) % MESO_HARMONICS;
    // MESO_BAND_LOW..1.0 of the base frequency. Never above it.
    const r = MESO_BAND_LOW
      + ((rk + mesoHash(k * 5 + 2, seed)) / MESO_HARMONICS) * (1 - MESO_BAND_LOW);
    let ix = Math.round(Math.cos(a) * cycles * r);
    let iy = Math.round(Math.sin(a) * cycles * r);
    if (ix === 0 && iy === 0) ix = 1;
    // Hard clamp: independent rounding can push |n| past `cycles`.
    const mag = Math.sqrt(ix * ix + iy * iy);
    if (mag > cycles) {
      const s = cycles / mag;
      ix = Math.trunc(ix * s);
      iy = Math.trunc(iy * s);
      if (ix === 0 && iy === 0) ix = Math.max(1, Math.floor(cycles));
    }
    nx[k] = ix;
    ny[k] = iy;
    phase[k] = Math.floor(mesoHash(k * 5 + 3, seed) * size) % size;
    // FLAT. With twelve harmonics any roll-off puts most of the energy in the
    // first few and the lattice comes straight back; equal weights are what
    // makes the sum read as mottling.
    amp[k] = 1;
    norm += amp[k];
  }
  // Normalised so the sum is bounded by exactly 1.
  for (let k = 0; k < MESO_HARMONICS; k++) amp[k] /= norm;

  const ws: MesoWaves = { nx, ny, phase, amp };
  if (mesoCache.size > 256) mesoCache.clear();
  mesoCache.set(key, ws);
  return ws;
}

/**
 * Cycles per tile for a requested ground wavelength, honouring BOTH floors.
 * Exported: this is the number the frequency test reasons about.
 */
export function mesoCycles(size: number, tileMetres: number, wantMetres: number): number {
  const texelsPerMetre = size / tileMetres;
  const wlTexels = Math.max(MESO_MIN_TEXELS, wantMetres * texelsPerMetre);
  return Math.max(1, Math.floor(size / wlTexels));
}

/** The realised ground wavelength of a component, after both floors. */
export function mesoWavelengthMetres(
  size: number, tileMetres: number, wantMetres: number,
): number {
  return tileMetres / mesoCycles(size, tileMetres, wantMetres);
}

/**
 * One band-limited octave across a whole SCANLINE, into `out[0..size)`.
 *
 * Row-incremental on purpose. The sine index is
 * `(nx*x + ny*y + phase) mod size` with every term an integer, so along a row
 * it advances by exactly `nx` per texel — no multiply, no modulo, one compare.
 * Twenty-four table reads per texel is the single most expensive thing in tile
 * generation (it measured 51 of the 116 ms a 256x256 field layer costs, i.e.
 * +203 ms on every biome build), and this is the version that gives that back
 * without changing a single output value.
 *
 * `step` is reduced into [0, size) and `j` starts there, so `j + step < 2*size`
 * and one conditional subtraction is a complete wrap.
 */
function mesoOctaveRow(
  out: Float64Array, y: number, size: number, cycles: number, seed: number,
): void {
  const w = mesoWaveSet(cycles, seed, size);
  const sin = mesoSinTable(size);
  out.fill(0, 0, size);
  for (let k = 0; k < MESO_HARMONICS; k++) {
    let j = (((w.ny[k] * y + w.phase[k]) % size) + size) % size;
    const step = ((w.nx[k] % size) + size) % size;
    const a = w.amp[k];
    for (let x = 0; x < size; x++) {
      out[x] += a * sin[j];
      j += step;
      if (j >= size) j -= size;
    }
  }
}

/** Scratch rows, grown on demand. Tile generation is single-threaded. */
let mesoRowFine = new Float64Array(0);
let mesoRowWide = new Float64Array(0);

/**
 * The mesoscale clump field for one layer across a scanline, each value in
 * [-1, 1]. Negative is bare / thin / dry, positive is dense / lush.
 */
export function mesoFieldRow(
  out: Float64Array, y: number, size: number, tileMetres: number, seed: number,
): void {
  if (mesoRowFine.length < size) {
    mesoRowFine = new Float64Array(size);
    mesoRowWide = new Float64Array(size);
  }
  mesoOctaveRow(mesoRowFine, y, size, mesoCycles(size, tileMetres, MESO_FINE_METRES), seed + 131);
  mesoOctaveRow(mesoRowWide, y, size, mesoCycles(size, tileMetres, MESO_WIDE_METRES), seed + 197);
  for (let x = 0; x < size; x++) {
    out[x] = MESO_FINE_WEIGHT * mesoRowFine[x] + MESO_WIDE_WEIGHT * mesoShape(mesoRowWide[x]);
  }
}

/** Scratch for the single-texel accessor below. */
let mesoRowOne = new Float64Array(0);

/**
 * One texel of the mesoscale field. Defined THROUGH the row version rather
 * than beside it, so there is exactly one implementation and the two cannot
 * drift — the row form is the one that ships and this is the one the tests
 * read, and a second copy of the index arithmetic is how they would disagree.
 *
 * Exported so `tests/terrain-frequency.spec.ts` can run a real DFT over the
 * field and assert there is no energy above the declared cutoff — the
 * empirical half of the safety argument, as opposed to the structural half.
 */
export function mesoField(
  x: number, y: number, size: number, tileMetres: number, seed: number,
): number {
  if (mesoRowOne.length < size) mesoRowOne = new Float64Array(size);
  mesoFieldRow(mesoRowOne, y, size, tileMetres, seed);
  return mesoRowOne[x];
}

/* -- the colour axis ------------------------------------------------------- */

/**
 * One end of the bare<->lush axis. `warm` is 0 or 1 and is applied BEFORE the
 * luma renormalisation, so the tilt changes hue without changing brightness.
 */
function mesoEnd(
  base: Float32Array, chroma: number, luma: number, warm: number, out: Float32Array,
): void {
  let r = base[0] * (1 + (MESO_WARM[0] - 1) * warm);
  let g = base[1] * (1 + (MESO_WARM[1] - 1) * warm);
  let b = base[2] * (1 + (MESO_WARM[2] - 1) * warm);

  const l0 = base[0] * LUMA_R + base[1] * LUMA_G + base[2] * LUMA_B;
  const l1 = r * LUMA_R + g * LUMA_G + b * LUMA_B;
  const target = l0 * luma;
  const k = target / Math.max(l1, 1e-5);
  r *= k; g *= k; b *= k;

  // Chroma about the (now exact) target luminance: monotone in each channel, so
  // it cannot reorder r/g/b, and luminance-neutral under the same weights.
  out[0] = target + (r - target) * chroma;
  out[1] = target + (g - target) * chroma;
  out[2] = target + (b - target) * chroma;
}

const MESO_LUSH = new Float32Array(3);
const MESO_BARE = new Float32Array(3);

/**
 * Fraction of a layer's own `r - g` margin the hue tilt is allowed to spend.
 *
 * `r >= g` on every natural ground layer is the property that survives the
 * lighting — see the header of `Biomes.ts`. The blue hemisphere fill multiplies
 * green 1.7x harder than red and the blue-grey fog lerp then lifts blue, so a
 * `g > r` albedo lands at hue ~104 no matter how it was authored. Chroma and
 * luma scaling are monotone per channel and cannot break it. The WARM TILT can,
 * and on `snow/rock` (`#6B6A60`, r over g by exactly one 8-bit step) it did:
 * 9035 texels of 65536 came out green-dominant before this budget existed.
 *
 * Half, not all, because the drift and the shade/accent lerps upstream also
 * shrink the margin slightly before the meso term ever sees it.
 */
const MESO_ORDER_KEEP = 0.5;

/**
 * Half the difference between the two endpoints, i.e. the displacement applied
 * per unit of the (signed) clump field. Writes into `out`.
 *
 * The warm tilt is scaled down — to zero if necessary — until the axis provably
 * cannot reorder red and green anywhere on the tile. A near-neutral grey has no
 * hue headroom to spend and correctly gets no hue drift; grass, with six 8-bit
 * steps between r and g, gets all of it.
 */
function mesoAxis(
  base: Float32Array, shade: Float32Array, accent: Float32Array,
  pull: number, out: Float32Array,
): void {
  // Warm is meaningful only where soil could plausibly show through. On a
  // cool-hued layer (snow ice, `b > r`) it would rotate cyan to orange.
  const coolGate = base[0] >= base[2] ? 1 : 0;

  // Everything upstream of the meso term is either a uniform scale (the drift)
  // or a lerp between these three authored tones, and both preserve `r >= g`.
  // So the smallest of their margins bounds what the meso term may eat.
  const margin = Math.min(base[0] - base[1], shade[0] - shade[1], accent[0] - accent[1]);
  const budget = Math.max(0, margin) * MESO_ORDER_KEEP / Math.max(pull, 1e-4);

  mesoEnd(base, MESO_LUSH_CHROMA, MESO_LUSH_LUMA, 0, MESO_LUSH);

  // `|axis_r - axis_g|` is monotone in `warm`, so bisect. Once per layer, and
  // the layer surfaces are cached, so the cost is not on any hot path.
  let lo = 0, hi = coolGate;
  for (let iter = 0; iter < 18; iter++) {
    const mid = (lo + hi) * 0.5;
    mesoEnd(base, MESO_BARE_CHROMA, MESO_BARE_LUMA, mid, MESO_BARE);
    const skew = Math.abs((MESO_LUSH[0] - MESO_BARE[0]) - (MESO_LUSH[1] - MESO_BARE[1])) * 0.5;
    if (skew <= budget) lo = mid; else hi = mid;
  }
  mesoEnd(base, MESO_BARE_CHROMA, MESO_BARE_LUMA, lo, MESO_BARE);

  for (let c = 0; c < 3; c++) out[c] = (MESO_LUSH[c] - MESO_BARE[c]) * 0.5;
}

/** How far this layer travels along that axis. */
export function mesoPull(L: SurfaceLayerDef): number {
  return Math.min(MESO_PULL_MAX, clamp01(L.patch ?? 0.3) * MESO_PULL_GAIN);
}

/** Parse '#RRGGBB' to sRGB 0..1, which is the space `Surface.albedo` is in. */
function hexTriple(hex: string, out: Float32Array): Float32Array {
  const v = parseInt(hex.replace('#', ''), 16) | 0;
  out[0] = ((v >> 16) & 0xff) / 255;
  out[1] = ((v >> 8) & 0xff) / 255;
  out[2] = (v & 0xff) / 255;
  return out;
}

const FIELD_BASE = new Float32Array(3);
const FIELD_SHADE = new Float32Array(3);
const FIELD_ACCENT = new Float32Array(3);
const FIELD_MESO_AXIS = new Float32Array(3);

/** Field surfaces are generated here, so they need their own cache. */
const fieldCache = new Map<string, Surface>();

/**
 * A broad, soft, near-flat natural ground tile.
 *
 * FOUR band-limited layers and nothing else:
 *   - two out-of-phase value drifts at 1/5 and 1/2.2 of the tile,
 *   - one very low frequency mask that pulls toward `shade` on its low side
 *     and `accent` on its high side, giving damp/dry blotches several metres
 *     across,
 *   - and the MESOSCALE colour axis, 0.32-1.25 m, which is the band section
 *     3B-bis exists to fill. It is a hue/chroma displacement, not a brightness
 *     one, and it is ADDED rather than lerped so that it introduces no
 *     frequency-mixing product with the three above.
 *
 * The first three go through `budgetedNoise` and the fourth through
 * `mesoFieldRow`; both are sums of plane waves at integer frequencies, so they
 * are exactly periodic (the tile is seamless), band-limited by construction
 * (the wavelength floor is a guarantee and not a hope), and amplitude-clamped.
 * There is deliberately no way to ask either of them for contrast.
 */
export function buildFieldSurface(L: SurfaceLayerDef, size: number): Surface {
  const s = createSurface(size);
  const base = hexTriple(L.albedo, FIELD_BASE);
  const shade = hexTriple(L.shade, FIELD_SHADE);
  const accent = hexTriple(L.accent, FIELD_ACCENT);

  const amp = Math.min(Math.abs(L.variation ?? 0.045), FIELD_DRIFT_CAP);
  const patch = clamp01(L.patch ?? 0.3) * FIELD_PATCH_CAP;
  const seed = L.seed | 0;

  const wlFine = Math.max(FIELD_MIN_WAVELENGTH, size / 5);
  const wlWide = Math.max(FIELD_MIN_WAVELENGTH, size / 2.2);
  const wlPatch = Math.max(FIELD_MIN_WAVELENGTH, size / 1.6);

  // Mesoscale: one constant colour direction, one signed field, one gain.
  const pull = mesoPull(L);
  const axis = FIELD_MESO_AXIS;
  mesoAxis(base, shade, accent, pull, axis);
  const mesoRow = new Float64Array(size);

  for (let y = 0; y < size; y++) {
    mesoFieldRow(mesoRow, y, size, L.tileMetres, seed);
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const drift =
        budgetedNoise(x, y, size, wlFine, amp * 0.55, seed + 11, FIELD_DRIFT_CAP) +
        budgetedNoise(x, y, size, wlWide, amp * 0.45, seed + 29, FIELD_DRIFT_CAP);

      // One mask, two mutually exclusive pulls: below 0.5 toward shade, above
      // toward accent. One mask rather than two because two independent masks
      // can overlap and cancel, and the result is a flat average instead of
      // legible patches.
      const m = 0.5 + budgetedNoise(x, y, size, wlPatch, 0.5, seed + 53, 0.5);
      const toAccent = smoothstep(0.50, 0.72, m) * patch;
      const toShade = smoothstep(0.50, 0.28, m) * patch;

      const meso = mesoRow[x] * pull;

      const o = i * 3;
      for (let c = 0; c < 3; c++) {
        let v = base[c] * (1 + drift);
        v = lerp(v, accent[c], toAccent);
        v = lerp(v, shade[c], toShade);
        // Additive, not lerped: a lerp would multiply this field by the three
        // above and a product's bandwidth is the SUM of its factors'.
        v += axis[c] * meso;
        s.albedo[o + c] = clamp01(v);
      }

      // Exactly flat. Nothing on natural ground is geometry at this scale, and
      // a constant height field is the guarantee that no packer can turn this
      // tile back into a sandpaper normal map.
      s.height[i] = 0.5;
      s.roughness[i] = clamp01(L.roughness);
      s.metalness[i] = 0;
      s.ao[i] = 1;
      s.teamMask[i] = 0;
    }
  }
  return s;
}

/**
 * How many slabs / setts fit across one tile.
 *
 * Restricted to powers of two that divide `size`, because `paving` and
 * `cobblestone` only tile seamlessly when the cell grid divides the texture
 * exactly — a 4.8 m tile with 1.2 m slabs wants 4 across, and asking for a
 * non-divisor silently produces a sheared row at the wrap.
 */
function snapCells(tileMetres: number, featureMetres: number, size: number): number {
  const want = Math.max(1, tileMetres / Math.max(0.05, featureMetres));
  let best = 1;
  for (const c of [1, 2, 4, 8, 16, 32, 64]) {
    if (size % c !== 0) continue;
    if (Math.abs(Math.log(c / want)) < Math.abs(Math.log(best / want))) best = c;
  }
  return best;
}

/** Build (or fetch) one layer's albedo Surface. */
export function buildLayerSurface(L: SurfaceLayerDef, size: number): Surface {
  if (L.surface === 'field') {
    const key = [
      size, L.seed, L.albedo, L.shade, L.accent, L.roughness, L.variation, L.patch,
    ].join('|');
    const hit = fieldCache.get(key);
    if (hit !== undefined) return hit;
    const s = buildFieldSurface(L, size);
    if (fieldCache.size > 64) fieldCache.clear();
    fieldCache.set(key, s);
    return s;
  }

  const cells = snapCells(L.tileMetres, L.featureMetres ?? 1.2, size);
  const cellTexels = size / cells;
  // Joints are drawn at ~4.5 cm of world width, clamped so they never fall
  // below the ~1.6 texels a crisp anti-aliased line needs, nor grow into a
  // band wide enough to darken the surface average.
  const jointWidth = Math.min(3.0, Math.max(1.6, (size / L.tileMetres) * 0.045));

  if (L.surface === 'cobble') {
    return slabSurface('cobblestone', {
      size, seed: L.seed,
      colour: L.albedo, jointColour: L.joint ?? L.shade,
      stoneSize: cellTexels, jointWidth,
      // 0.42 rather than the generator's 0.35 default: RA3's plaza setts are
      // visibly irregular in outline, and at 0.35 the grid still reads.
      variation: L.variation ?? 0.04, jitter: 0.42,
      wear: 0.3, roughness: L.roughness,
    });
  }

  return slabSurface('paving', {
    size, seed: L.seed,
    colour: L.albedo, jointColour: L.joint ?? L.shade,
    slabW: cellTexels, slabH: cellTexels, jointWidth,
    variation: L.variation ?? 0.03, bond: 0,
    wear: 0.3, roughness: L.roughness,
  });
}

/**
 * `TextureFactory.surface()`, without the factory.
 *
 * That method is four lines — resolve the partial params, key them, memo, and
 * call `generateSurface` — and every one of those four lives in `surfaces.ts`.
 * What it is NOT allowed to be is imported from `assets.ts`, which is where the
 * singleton lives and which carries THREE. So the four lines are spelled out
 * here against the same functions, and the result is byte-identical because it
 * IS the same generator run on the same resolved parameters.
 *
 * The memo is kept because the concrete and paving layers are rebuilt on every
 * `applyBiome`, and a console biome swap back and forth would otherwise pay for
 * them twice. Same bound and same clear-on-overflow policy as `fieldCache`.
 */
const slabCache = new Map<string, Surface>();

function slabSurface(kind: TextureKind, params: Record<string, unknown>): Surface {
  const p = resolveParams({ kind, ...params } as TextureRequest);
  const key = surfaceKey(kind, p);
  const hit = slabCache.get(key);
  if (hit !== undefined) return hit;
  const s = generateSurface(kind, p);
  if (slabCache.size > 64) slabCache.clear();
  slabCache.set(key, s);
  return s;
}

/* ==========================================================================
 * 3. THE LAYER ARRAY, AND THE JOB
 * ========================================================================== */

/**
 * Pack all six biome layers into one flat buffer, laid out exactly as
 * `THREE.DataArrayTexture` wants it: layer 0's RGBA, then layer 1's, and so on.
 *
 * This is the expensive one — four `field` tiles at 256² is the bulk of the
 * 350-435 ms this module was costing the boot.
 */
export function buildLayerArrayBytes(biome: BiomeDef, size: number): Uint8Array {
  const layerBytes = size * size * 4;
  const data = new Uint8Array(layerBytes * SURFACE_COUNT);
  for (let i = 0; i < SURFACE_COUNT; i++) {
    data.set(packAlbedo(buildLayerSurface(biome.layers[i], size)), layerBytes * i);
  }
  return data;
}

/**
 * Every tile `createTerrainMaterials` would otherwise build on the main thread.
 *
 * `layerSize` travels WITH the bytes rather than being re-derived on the far
 * side. A set generated against a different `TERRAIN_LAYER_TEXTURE_SIZE` is not
 * an error to detect later — it is a `DataArrayTexture` reading past the end of
 * its own buffer, which is the class of bug that renders as a black frame and
 * reports nothing.
 */
export interface TerrainTextureData {
  /** Proves these bytes describe the material about to be built. */
  readonly key: string;
  /** Six RGBA8 layers back to back, `layerSize²·4·SURFACE_COUNT` bytes. */
  readonly layers: Uint8Array;
  readonly layerSize: number;
  /** RGBA8 splat-warp tile, `WARP_N²·4` bytes. */
  readonly warp: Uint8Array;
  /** RGBA8 macro-breakup tile, `MACRO_N²·4` bytes. */
  readonly macro: Uint8Array;
  /** Milliseconds spent generating, measured where the work happened. */
  readonly generateMs: number;
}

/**
 * The identity of a terrain texture set: everything `generateTerrainTextures`
 * reads and nothing it does not.
 *
 * The biome enters by KEY rather than by value. A `BiomeDef` is a large record
 * and hashing it would make this key a moving target every time somebody edits
 * a colour; the key is what `Terrain` already uses to name a biome, and
 * `BIOMES[key]` is the single source of the rest.
 */
export function terrainTextureKey(biomeKey: string, size: number, seed: number): string {
  return `terrain-tex:${biomeKey}:${size}:${seed | 0}`;
}

/**
 * Generate the whole set. Pure, synchronous, and the only implementation —
 * `createTerrainMaterials` calls these same three functions when it has no
 * prewarm to adopt.
 *
 * The two seed salts are `createTerrainMaterials`'s, not new ones: the warp
 * takes `seed ^ 0x51ab` and the macro `seed ^ 0x9d31`. They live here now so
 * that there is one place they are written down, rather than one on each side
 * of a wire that has to agree.
 */
export function generateTerrainTextures(
  biome: BiomeDef, size: number, seed: number,
): TerrainTextureData {
  const t0 = Date.now();
  return {
    key: terrainTextureKey(biome.key, size, seed),
    layers: buildLayerArrayBytes(biome, size),
    layerSize: size,
    warp: buildWarpBytes(warpSeed(seed)),
    macro: buildMacroBytes(macroSeed(seed)),
    generateMs: Date.now() - t0,
  };
}

/** The warp tile's seed salt. One definition, both threads. */
export function warpSeed(seed: number): number {
  return seed ^ 0x51ab;
}

/** The macro tile's seed salt. One definition, both threads. */
export function macroSeed(seed: number): number {
  return seed ^ 0x9d31;
}

/** The buffers a reply owns, for `postMessage`'s transfer list. */
export function terrainTextureTransfers(d: TerrainTextureData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const a of [d.layers, d.warp, d.macro]) {
    const buf = a.buffer;
    if (buf instanceof ArrayBuffer && !out.includes(buf)) out.push(buf);
  }
  return out;
}

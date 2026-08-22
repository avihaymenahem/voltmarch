/**
 * VOLTMARCH — src/render/ao-params.ts
 * =============================================================================
 * THE AMBIENT-OCCLUSION NUMBERS, BELONGING TO NEITHER RENDERER.
 *
 * Resolution rule, denoise kernel, noise seed and the two parameter blocks the
 * AO march and the denoise are configured with. Imports nothing at runtime —
 * `three` and `three/webgpu` are both absent — so `post.ts` (WebGL,
 * `GTAOPass` + `PoissonDenoiseShader`) and `nodes/ao-node.ts` (TSL, `GTAONode` +
 * `DenoiseNode`) can share one source of truth without either dragging the
 * other's build of three into the bundle.
 *
 * These functions LIVED IN `post.ts` and are re-exported from it, so
 * `tests/perf-budget.spec.ts` and every existing caller are unaffected. They
 * moved because the node port needs the same numbers, and the alternative — a
 * second copy — is how `halfRes` came to be documented, defaulted, tier-mapped
 * and dead in the first place. The reasoning for each value is in `post.ts`,
 * where it was measured; this file carries the value and a pointer, not a
 * second telling.
 */

import type { AoConfig } from './renderer';

/**
 * Fraction of the drawing buffer the AO chain runs at when `ao.halfRes` is on.
 *
 * A half, not a third: below a half the saving collapses because what remains is
 * the full-resolution composite, while the upsample error keeps growing. The
 * measurement (64.8 / 49.1 / 46.4 ms at 1.0 / 0.5 / 0.33) is in `post.ts`.
 */
export const AO_HALF_RES_SCALE = 0.5;

/**
 * The G-buffer / march / denoise size for a given drawing buffer.
 *
 * Pure, and exported, so `tests/perf-budget.spec.ts` can assert the arithmetic
 * without a GL context — a resolution rule nobody has watched produce a number
 * is how `halfRes` came to be documented, defaulted, tier-mapped and dead.
 */
export function aoTargetSize(
  width: number,
  height: number,
  halfRes: boolean,
): { width: number; height: number } {
  const s = halfRes ? AO_HALF_RES_SCALE : 1;
  return {
    width: Math.max(2, Math.round(width * s)),
    height: Math.max(2, Math.round(height * s)),
  };
}

/**
 * Poisson-denoise kernel radius, in the AO target's OWN texels.
 *
 * Halved with the resolution so the filter keeps covering the same fraction of
 * the image. The old value was backwards — a WIDER kernel where there are FEWER
 * texels — and it was wired to a uniform name that does not exist, so it did
 * nothing at all. See `post.ts#applyAoConfig`.
 */
export function aoDenoiseRadius(halfRes: boolean): number {
  return halfRes ? 4 : 8;
}

/**
 * Seed for the denoise rotation field. Any fixed value will do; what matters is
 * that it is fixed.
 *
 * BOTH CHAINS SHIP A GENERATOR THAT DEFAULTS TO `Math.random()`, independently.
 * `GTAOPass._generateNoise()` builds its 64x64 rotation texture from
 * `new SimplexNoise()`, whose default RNG argument is `Math`; so does
 * `DenoiseNode`'s own `generateDefaultNoise()`. Unseeded, every boot's AO lands
 * differently in every crease — with the post chain off, two boots of
 * `?shot=allied-base` are BYTE-IDENTICAL; with it on, 27% of subpixels move,
 * and the deltas sit on geometry edges where both the eye and a Sobel metric
 * look. `src/core/math.ts` already bans `Math.random()` "inside every texture
 * generator"; the only reason these escape it is that both generators live in
 * three rather than in this repo.
 *
 * Not module-private, and not in `core/config.ts`: it is not a tunable — there
 * is nothing to tune, and changing it moves every AO crease in every fixture —
 * but it MUST be the same number in both chains or the two backends produce
 * different frames from the same build.
 */
export const AO_NOISE_SEED = 0x5eed_a011;

/** Size of the square rotation-noise texture both chains generate. */
export const AO_NOISE_SIZE = 64;

/**
 * Visual-energy calibration for Three's newer node GTAO integral.
 *
 * `GTAONode` is not a literal TSL port of `GTAOShader`: it uses the newer
 * foreshortening-weighted Activision integral, while `GTAOPass` still ships the
 * older simplified slice integral. With identical march, denoise and composite
 * parameters the node result darkened every measured Laplacian bin by
 * 1.78-1.96x. Scaling only the final mix preserves the newer integral's shape
 * while matching the established WebGL art target.
 */
export const AO_NODE_INTENSITY_SCALE = 0.475;

/**
 * The AO march's parameters, derived from config.
 *
 * `scale` is GTAO's contrast curve on the occlusion term, which is where the art
 * bible's "power 1.6" lands — it is NOT a magnitude. `distanceExponent` and
 * `thickness` are pinned at 1.0 rather than left to a default so that the two
 * implementations cannot diverge on a value neither of them states.
 *
 * There is no `screenSpaceRadius`: `GTAOPass` is handed `false` and `GTAONode`
 * has no such option, so both march in world space. Same behaviour, and naming
 * it here would imply a knob the node path cannot honour.
 */
export interface AoMarchParams {
  radius: number;
  distanceExponent: number;
  thickness: number;
  scale: number;
  samples: number;
}

export function aoMarchParams(cfg: AoConfig): AoMarchParams {
  return {
    radius: cfg.radius,
    distanceExponent: 1.0,
    thickness: 1.0,
    scale: cfg.power,
    samples: cfg.samples,
  };
}

/**
 * The denoise's parameters.
 *
 * `lumaPhi` / `depthPhi` / `normalPhi` are `GTAOPass`'s OWN defaults, not
 * `PoissonDenoiseShader`'s and not `DenoiseNode`'s — both of those ship 5/5/5,
 * and `GTAOPass` overwrites them with 10/2/3 in its constructor. The WebGL chain
 * inherits that silently by never setting them; the node chain has to set them
 * explicitly or it denoises with a different filter. Writing them down is the
 * only way the two can be compared.
 */
export interface AoDenoiseParams {
  lumaPhi: number;
  depthPhi: number;
  normalPhi: number;
  radius: number;
}

export function aoDenoiseParams(cfg: AoConfig): AoDenoiseParams {
  return {
    lumaPhi: 10,
    depthPhi: 2,
    normalPhi: 3,
    radius: aoDenoiseRadius(cfg.halfRes),
  };
}

/**
 * The Poisson sample disc both denoisers walk: 16 samples, 2 rings, radius
 * exponent 2.
 *
 * THE EXPONENT IS THE ONE THAT DIFFERS BY DEFAULT. `GTAOPass.pdRadiusExponent`
 * is 2; `DenoiseNode` builds its own array with `generateDenoiseSamples(16, 2, 1)`,
 * i.e. exponent 1, which spreads the taps evenly along the radius instead of
 * clustering them near the centre. Same count, same rings, different filter —
 * the kind of difference that shows up as slightly softer contact shadows and
 * nothing a build error would catch. The node chain overwrites its array with
 * this one.
 */
export const AO_DENOISE_SAMPLES = 16;
export const AO_DENOISE_RINGS = 2;
export const AO_DENOISE_RADIUS_EXPONENT = 2;

/** One Poisson tap: `(cos a, sin a, r)`, exactly as both shaders consume it. */
export interface DenoiseSample {
  x: number;
  y: number;
  z: number;
}

/**
 * three's `generateDenoiseSamples`, transcribed so both chains can be handed the
 * identical array and a test can compare them element by element.
 */
export function denoiseSampleDisc(
  numSamples: number = AO_DENOISE_SAMPLES,
  numRings: number = AO_DENOISE_RINGS,
  radiusExponent: number = AO_DENOISE_RADIUS_EXPONENT,
): DenoiseSample[] {
  const out: DenoiseSample[] = [];
  for (let i = 0; i < numSamples; i++) {
    const angle = (2 * Math.PI * numRings * i) / numSamples;
    const radius = Math.pow(i / (numSamples - 1), radiusExponent);
    out.push({ x: Math.cos(angle), y: Math.sin(angle), z: radius });
  }
  return out;
}

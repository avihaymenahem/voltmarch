/**
 * VOLTMARCH — src/render/grade-curve.ts
 * =============================================================================
 * THE GRADE, EXPRESSED AS NUMBERS RATHER THAN AS A SHADER.
 *
 * This module holds the part of the colour grade that is not GLSL, not WGSL and
 * not a node graph: the tone-mode table, the two curve constants, and the pure
 * `GradeConfig -> uniform values` mapping. It imports nothing at runtime — not
 * `three`, not `three/webgpu` — so BOTH post chains can share it and neither
 * drags the other's renderer into the bundle. The only import is a `type`, which
 * `isolatedModules` erases outright.
 *
 * WHY IT EXISTS. `docs/RENDER_FINDINGS.md` §5: the WebGL grade pass ran on its
 * constructor literals for its entire life because `ShaderPass` deep-copies a
 * plain shader description, so `syncConfig`'s writes went into a detached object
 * and grain and chromatic aberration shipped LIVE while `config.ts` said 0. The
 * lesson recorded there is "a test that reads the CONFIG proves nothing about
 * the SHADER". The corollary this file acts on is the other half: **the mapping
 * from config to uniform is itself a thing worth pinning**, and it is only
 * pinnable if it is a pure function rather than eighteen assignments buried in a
 * closure that needs a GL context to reach.
 *
 * `gradeUniformValuesFor()` below is a transcription of the grade block of
 * `post.ts#syncConfig`, and `tests/post-nodes.spec.ts` checks it against
 * `THREE.Color`'s own sRGB decode so the two cannot drift.
 *
 * THE TWO CURVE CONSTANTS ARE DUPLICATED HERE ON PURPOSE, and the duplication
 * is guarded rather than trusted: `post.ts` keeps them as GLSL literals in its
 * shader string (interpolating them would rewrite the shader text for no gain),
 * and `tests/post-nodes.spec.ts` greps that string for these exact values. The
 * reasoning for each number lives at its declaration in `post.ts` and is not
 * repeated here — read it there before changing either.
 */

import type { GradeConfig, ToneMappingMode } from './renderer';

/**
 * `GradeConfig.mode` -> the integer the shader branches on.
 *
 * ONE TABLE, TWO CONSUMERS. `post.ts` imports it; the TSL grade imports it. It
 * used to be a module-private literal inside `post.ts`, which is exactly how a
 * second copy gets written the first time anyone needs it elsewhere.
 *
 * `linear` maps to 0 — the passthrough — because a linear "tone mapping" is the
 * absence of one, and the grade's own display encode follows regardless.
 */
export const TONE_MODE_ID: Record<ToneMappingMode, number> = {
  none: 0,
  agx: 1,
  aces: 2,
  neutral: 3,
  linear: 0,
};

/**
 * Scene-linear middle grey: the contrast pivot. See `post.ts`, which carries the
 * full argument for a gamma pivot over an affine contrast.
 */
export const GRADE_PIVOT = 0.18;

/**
 * The graded scene-linear value that IS display white. See `post.ts` — this is
 * a declared white point rather than a hoped-for one, and it is the whole of
 * scorecard #6.
 */
export const GRADE_WHITE = 0.94;

/** Rec.709 luma weights. The grade is luminance-preserving against these. */
export const GRADE_LUMA: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

/**
 * `lift` is additive and must stay tiny, so `post.ts#syncConfig` halves it after
 * decoding. Named rather than inlined because the TSL grade has to apply the
 * same halving and a second literal 0.5 is a second thing to keep in step.
 */
export const GRADE_LIFT_SCALE = 0.5;

/** The clamp `syncConfig` puts on `vignetteSoftness` before it reaches the shader. */
export const VIGNETTE_SOFTNESS_MIN = 0.05;
export const VIGNETTE_SOFTNESS_MAX = 1.15;

/** A plain RGB triple. Deliberately not `THREE.Vector3` — this file imports no renderer. */
export interface Rgb {
  x: number;
  y: number;
  z: number;
}

/**
 * three's own sRGB -> linear transfer function, transcribed.
 *
 * `THREE.Color.setHex(hex, SRGBColorSpace)` runs `ColorManagement.toWorkingColorSpace`,
 * which is this. Transcribed rather than imported because importing it would pull
 * `three` into a module whose entire purpose is to belong to neither renderer;
 * `tests/post-nodes.spec.ts` asserts the two agree to 1e-12 over a sweep, which
 * is a stronger guarantee than the import would have been.
 */
export function srgbChannelToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** An sRGB hex literal -> a linear-space RGB triple, written into `out`. */
export function srgbHexToLinear(hex: number, out: Rgb): Rgb {
  out.x = srgbChannelToLinear(((hex >> 16) & 0xff) / 255);
  out.y = srgbChannelToLinear(((hex >> 8) & 0xff) / 255);
  out.z = srgbChannelToLinear((hex & 0xff) / 255);
  return out;
}

/**
 * An sRGB hex -> a linear triple normalised so that multiplying by it does not
 * change overall luminance. The three tint uniforms are all this shape: they
 * rotate hue without moving the histogram, which is what keeps scorecard #4 and
 * #6 independent of the tint campaign in `config.ts`.
 */
export function lumaNormalizedHex(hex: number, out: Rgb): Rgb {
  srgbHexToLinear(hex, out);
  const l = GRADE_LUMA[0] * out.x + GRADE_LUMA[1] * out.y + GRADE_LUMA[2] * out.z;
  const inv = l > 1e-4 ? 1 / l : 1;
  out.x *= inv;
  out.y *= inv;
  out.z *= inv;
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Every scalar and vector the grade shader needs, derived from config.
 *
 * `grain`, `grainSize` and `chromaticAberration` are ABSENT, and that is a
 * decision rather than an oversight — see `nodes/grade-node.ts`. Both effects
 * are banned by name in CLAUDE.md and `RA3_LOOK_BIBLE.md` §4.6/§11, both are 0
 * in the shipped config, and the TSL grade does not implement either, so there
 * is no uniform for them to arrive through.
 */
export interface GradeUniformValues {
  exposure: number;
  toneMode: number;
  shadowTint: Rgb;
  midTint: Rgb;
  highTint: Rgb;
  lift: Rgb;
  gain: Rgb;
  contrast: number;
  saturation: number;
  shadowSaturation: number;
  vignette: number;
  vignetteSoftness: number;
  sharpen: number;
}

/** Allocate one output record. Callers reuse it; nothing here runs per frame. */
export function makeGradeUniformValues(): GradeUniformValues {
  const rgb = (): Rgb => ({ x: 0, y: 0, z: 0 });
  return {
    exposure: 1,
    toneMode: TONE_MODE_ID.agx,
    shadowTint: rgb(),
    midTint: rgb(),
    highTint: rgb(),
    lift: rgb(),
    gain: rgb(),
    contrast: 1,
    saturation: 1,
    shadowSaturation: 1,
    vignette: 0,
    vignetteSoftness: 0.62,
    sharpen: 0,
  };
}

/**
 * `GradeConfig` -> shader values, written into `out` (no allocation).
 *
 * A LINE-FOR-LINE TRANSCRIPTION of the `if (gradeUniforms)` block in
 * `post.ts#syncConfig`, including the two adjustments that are easy to miss and
 * that a second implementation would silently drop:
 *
 *   - `lift` is HALVED after decoding (`GRADE_LIFT_SCALE`).
 *   - `vignetteSoftness` is CLAMPED to 0.05..1.15 before it reaches the shader.
 *
 * `TONE_MODE_ID[mode] ?? 1` reproduces `syncConfig`'s fallback exactly: an
 * unrecognised mode string lands on AgX, not on passthrough. That matters
 * because passthrough plus the declared white point is a blown frame, and a
 * typo in a mood preset should not produce one.
 */
export function gradeUniformValuesFor(cfg: GradeConfig, out: GradeUniformValues): GradeUniformValues {
  out.exposure = cfg.exposure;
  out.toneMode = TONE_MODE_ID[cfg.mode] ?? 1;
  lumaNormalizedHex(cfg.shadowTint, out.shadowTint);
  lumaNormalizedHex(cfg.midTint, out.midTint);
  lumaNormalizedHex(cfg.highlightTint, out.highTint);
  srgbHexToLinear(cfg.lift, out.lift);
  out.lift.x *= GRADE_LIFT_SCALE;
  out.lift.y *= GRADE_LIFT_SCALE;
  out.lift.z *= GRADE_LIFT_SCALE;
  srgbHexToLinear(cfg.gain, out.gain);
  out.contrast = cfg.contrast;
  out.saturation = cfg.saturation;
  out.shadowSaturation = cfg.shadowSaturation;
  out.vignette = cfg.vignette;
  out.vignetteSoftness = clamp(cfg.vignetteSoftness, VIGNETTE_SOFTNESS_MIN, VIGNETTE_SOFTNESS_MAX);
  out.sharpen = cfg.sharpen;
  return out;
}

/**
 * The bloom strength the pass is actually handed.
 *
 * `post.ts#syncConfig` does `strength * max(0.25, emissiveBoost / 1.6)`, so the
 * authored `BloomConfig.strength` is NOT the effective figure and the settled
 * energy pair has to be quoted through this function or not at all. 1.6 is the
 * identity point: at the shipped `emissiveBoost` the multiplier is exactly 1.
 *
 * Pure and exported for the same reason `aoTargetSize` in `post.ts` is — the
 * settled pair (`threshold` 1.20, authored `strength` 0.42, `radius` 0.34) cost
 * 1.8 grade points to establish, and a second implementation of a formula
 * nobody has watched produce a number is how the first one drifted.
 */
export function effectiveBloomStrength(strength: number, emissiveBoost: number): number {
  return strength * Math.max(0.25, emissiveBoost / 1.6);
}

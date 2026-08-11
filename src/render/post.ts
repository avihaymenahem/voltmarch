/**
 * VOLTMARCH — src/render/post.ts
 * =============================================================================
 * The post-processing chain.
 *
 * ORDER (do not reorder without reading this):
 *
 *      RenderPass  ->  AO  ->  Bloom  ->  Grade  ->  SMAA
 *      [ HDR, linear, RGBA16F ..................]  [ LDR, sRGB ]
 *
 *  1. RenderPass draws the scene into a HALF-FLOAT target. The renderer's own
 *     tonemapping is switched OFF (`NoToneMapping`) for exactly this reason:
 *     values above 1.0 must survive to the bloom threshold. If tonemapping ran
 *     in the material shader, a 40x-bright tesla arc and a white concrete wall
 *     would both arrive at the bloom pass as ~1.0 and the whole image would
 *     haze. This is the single most common way an otherwise good-looking
 *     three.js scene ends up looking like a mobile game.
 *
 *  2. AO darkens ambient contact. It runs before bloom so that an occluded
 *     crevice cannot bloom.
 *
 *  3. Bloom thresholds in HDR just above sunlit white paint, so only a genuine
 *     specular glint or an emissive blooms.
 *
 *  4. Grade is where tonemapping actually happens: exposure -> ACES (or AgX)
 *     -> 3-way shadow/mid/highlight tint -> lift/gain -> GAMMA contrast about
 *     scene-linear 0.18 -> white point -> saturation (with separate shadow
 *     saturation) -> highlight-to-white rolloff -> vignette -> sRGB encode ->
 *     film grain. Chromatic aberration and an unsharp mask are folded into the
 *     same pass so we pay for one full-screen fetch, not three.
 *
 *     The contrast/white-point pair is the whole of scorecard #6 ("something in
 *     frame must reach white") and is documented at GRADE_PIVOT / GRADE_WHITE
 *     below. Both are deliberately curve constants rather than art-bible knobs:
 *     they define what "display white" MEANS for this game, and a mood that
 *     wants a different histogram moves `tone.exposure` and `tone.contrast`.
 *
 *  5. SMAA runs last, on the final LDR sRGB image, which is where edge
 *     detection actually wants to be. MSAA is off in the renderer; this is the
 *     AA path.
 *
 * GRACEFUL DEGRADATION
 * --------------------
 * Every pass is constructed inside its own try/catch. If anything throws, that
 * pass is recorded in `chain.failures` and simply omitted from the composer; if
 * the composer itself cannot be built we fall back to `renderer.render()` with
 * ACESFilmic tonemapping restored on the renderer. The game never fails to draw.
 *
 * THE CHAIN IS FINAL BEFORE THE FIRST PRESENTED FRAME
 * ---------------------------------------------------
 * The AO pass used to arrive through `await import()` and call
 * `composer.addPass()` whenever it resolved — i.e. some indeterminate number of
 * frames into the session, after the game was already on screen. Mutating a
 * live composer reallocates its ping-pong targets and introduces a pass whose
 * program has never been compiled; the frame that lands in that window can be
 * presented black. It is a near-perfect match for "black overlays for a split
 * second, a couple of times", because it fires once at boot and again on every
 * Settings toggle that reorders the chain.
 *
 * So: AO is now a STATIC import, constructed synchronously inside
 * `createPostChain()`. `three@0.185` ships both `GTAOPass.js` and `SSAOPass.js`,
 * so there is nothing to feature-detect at runtime that a try/catch around the
 * constructor does not already cover — and a missing module is now a build
 * error rather than a silent runtime downgrade.
 *
 * Any reorder that DOES happen later (a Settings toggle, `setPassEnabled`) sets
 * `chainDirty`, and the next `render()` draws one throwaway frame into the
 * composer's own targets before presenting. See `warmUp()`.
 *
 * AO RUNS AT HALF RESOLUTION, AND NOW ACTUALLY DOES
 * -------------------------------------------------
 * `AoConfig.halfRes` has existed since the config was written, is documented as
 * "Render AO at half resolution and bilaterally upsample", is `true` in the
 * art-bible defaults and in three of the four quality tiers — and until now
 * nothing read it. The only line that mentioned it wrote to
 * a denoise uniform named `pdRadius`, which GTAOPass does not have. So every
 * player ran full-resolution GTAO regardless of tier.
 *
 * Measured on the reporter's machine (AMD Renoir iGPU, ANGLE D3D11) at a fixed
 * 2560x1440 drawing buffer, GPU timer queries, 25 warm-up frames discarded:
 *
 *     whole frame, AO full-res      64.8 ms
 *     whole frame, AO at 0.5        49.1 ms      <- -15.7 ms, 24% of the frame
 *     whole frame, AO at 0.33       46.4 ms      <- only -2.7 ms more
 *
 * It stops paying below a half because what is left is not the AO: it is
 * GTAOPass's own composite, which is two FULL-resolution RGBA16F passes (a copy
 * of the read buffer followed by a multiply blend) and does not shrink.
 *
 * The G-buffer, the AO march and the Poisson denoise all move together —
 * `GTAOPass.setSize` sizes them as a set — and the result is sampled by the
 * blend at full resolution through a LinearFilter, so the upsample is bilinear
 * over an already depth-and-normal-aware denoise. At this camera (30-60 m up,
 * 46-58 degrees) the AO term is a soft contact darkening a few pixels wide;
 * halving its resolution is not visible, and the scorecard is the arbiter.
 *
 * The scaling is installed by wrapping the pass's own `setSize`, not by
 * scaling at the call site, because `EffectComposer.setSize` also calls it and
 * a rule that only one of two callers obeys is not a rule.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

import { Rng } from '../core/math';

import {
  RENDER_CONFIG,
  onConfigChanged,
  touched,
  srgbVec3,
  type RendererHandle,
  type ToneMappingMode,
} from './renderer';
import { LAYERS } from './scene';

declare const __DEV__: boolean;
const DEV: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

export type PassId = 'render' | 'ao' | 'bloom' | 'grade' | 'smaa';

/**
 * Fraction of the drawing buffer the AO chain runs at when `ao.halfRes` is on.
 *
 * A half, not a third. See the file header: below a half the saving collapses
 * because what remains is GTAOPass's full-resolution composite, while the
 * upsample error keeps growing.
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
 * The denoise runs at the AO resolution, so a constant texel radius would
 * silently halve the world-space footprint of the blur the moment `halfRes`
 * turned on — the AO would come back noisier at the cheaper setting, which is
 * the wrong direction. Halving the radius with the resolution keeps the filter
 * covering the same part of the image. 8 is GTAOPass's own default.
 */
/**
 * Seed for the Poisson-denoise rotation field. Any fixed value will do; what
 * matters is that it is fixed. Declared module-private rather than in
 * `core/config.ts` because it is not a tunable — there is nothing to tune, and
 * changing it moves every AO crease in every fixture.
 */
const AO_NOISE_SEED = 0x5eed_a011;

export function aoDenoiseRadius(halfRes: boolean): number {
  return halfRes ? 4 : 8;
}

/**
 * The canonical order. Rationale is in the file header. Nobody edits this
 * array without editing that comment first.
 */
export const PASS_ORDER: readonly PassId[] = ['render', 'ao', 'bloom', 'grade', 'smaa'] as const;

const TONE_MODE_ID: Record<ToneMappingMode, number> = {
  none: 0,
  agx: 1,
  aces: 2,
  neutral: 3,
  linear: 0,
};

/* ========================================================================== */
/* Grade shader                                                               */
/* ========================================================================== */

const GRADE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const GRADE_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tDiffuse;
uniform vec2  uTexel;          // 1 / resolution
uniform float uTime;

uniform float uExposure;
uniform int   uToneMode;       // 0 = passthrough, 1 = AgX, 2 = ACES, 3 = neutral

uniform vec3  uShadowTint;     // luma-normalised
uniform vec3  uMidTint;
uniform vec3  uHighTint;
uniform vec3  uLift;
uniform vec3  uGain;

uniform float uContrast;
uniform float uSaturation;
uniform float uShadowSaturation;

uniform float uVignette;
uniform float uVignetteSoftness;
uniform float uGrain;
uniform float uGrainSize;
uniform float uCA;
uniform float uSharpen;

varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

/**
 * Scene-linear middle grey. The contrast pivot: a pixel at exactly this value
 * is the one value the contrast stage cannot move.
 */
const float GRADE_PIVOT = 0.18;

/**
 * The graded scene-linear value that IS display white.
 *
 * Scorecard #6 requires p99 luminance >= 0.90 sRGB — i.e. something in the
 * frame must actually clip. Every filmic curve we can pick (AgX, ACES,
 * Khronos-neutral) asymptotes toward 1.0 and only gets there for inputs 15-20x
 * middle grey, which a noon RTS frame simply does not contain: the brightest
 * thing on screen is white concrete at ~1.0 scene-linear, and AgX maps that to
 * 0.67. Measured across all 12 shot scenarios the result was p99 0.61-0.89 with
 * ZERO clipped pixels anywhere.
 *
 * So the white point is declared rather than hoped for. Anything at or above
 * GRADE_WHITE after the contrast stage clips to paper white; the curve above
 * still rolls off smoothly because the tonemap has already compressed it.
 *
 * This is a NORMALISATION, not an exposure lift: it runs after the gamma
 * contrast has already pushed the shadows down, so the blacks it multiplies
 * are ~0.005 and stay ~0.006. Raising tone.exposure instead would move the
 * blacks and the mids by the same factor — bible risk R5, the exact instinct
 * that breaks scorecard #4 and #6-low.
 */
const float GRADE_WHITE = 0.94;

float luma(vec3 c) { return dot(c, LUMA); }

/* ---------------- AgX (Blender / Filament minimal implementation) --------- */

const mat3 AGX_IN = mat3(
  0.842479062253094,  0.0423282422610123, 0.0423756549057051,
  0.0784335999999992, 0.878468636469772,  0.0784336,
  0.0792237451477643, 0.0791661274605434, 0.879142973793104
);
const mat3 AGX_OUT = mat3(
   1.19687900512017,  -0.0528968517574562, -0.0529716355144438,
  -0.0980208811401368, 1.15190312990417,   -0.0980434501171241,
  -0.0990297440797205,-0.0989611768448433,  1.15107367264116
);

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return  15.5 * x4 * x2
        - 40.14 * x4 * x
        + 31.96 * x4
        - 6.868 * x2 * x
        + 0.4298 * x2
        + 0.1191 * x
        - 0.00232;
}

vec3 toneAgx(vec3 col) {
  col = AGX_IN * col;
  col = clamp(log2(max(col, 1e-10)), -12.47393, 4.026069);
  col = (col + 12.47393) / (4.026069 + 12.47393);
  col = agxContrast(col);
  col = AGX_OUT * col;
  // AgX emits display-encoded values; bring them back to linear so the rest of
  // the grade (and the final sRGB encode) operate in one consistent space.
  return pow(max(col, 0.0), vec3(2.2));
}

/* ---------------- ACES (Narkowicz fit) ------------------------------------ */

vec3 toneAces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/* ---------------- Khronos PBR neutral -------------------------------------- */

vec3 toneNeutral(vec3 col) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(col.r, min(col.g, col.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  col -= offset;
  float peak = max(col.r, max(col.g, col.b));
  if (peak < startCompression) return col;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  col *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(col, vec3(newPeak), g);
}

vec3 tonemap(vec3 c) {
  if (uToneMode == 1) return toneAgx(c);
  if (uToneMode == 2) return toneAces(c);
  if (uToneMode == 3) return toneNeutral(c);
  return c;
}

/* ---------------- sRGB encode --------------------------------------------- */

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

/* ---------------- grain --------------------------------------------------- */

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec2 uv = vUv;
  vec2 centered = uv - 0.5;

  /* --- chromatic aberration: radial, quadratic, edges only --------------- */
  vec3 col;
  if (uCA > 0.0001) {
    float r2 = dot(centered, centered);
    vec2 off = centered * uCA * (0.35 + r2 * 3.0);
    col.r = texture2D(tDiffuse, uv + off).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - off).b;
  } else {
    col = texture2D(tDiffuse, uv).rgb;
  }

  /* --- unsharp mask ------------------------------------------------------ */
  if (uSharpen > 0.0001) {
    vec3 blur =
      texture2D(tDiffuse, uv + vec2( uTexel.x, 0.0)).rgb +
      texture2D(tDiffuse, uv + vec2(-uTexel.x, 0.0)).rgb +
      texture2D(tDiffuse, uv + vec2(0.0,  uTexel.y)).rgb +
      texture2D(tDiffuse, uv + vec2(0.0, -uTexel.y)).rgb;
    blur *= 0.25;
    col += (col - blur) * uSharpen;
    col = max(col, 0.0);
  }

  /* --- exposure + tonemap ------------------------------------------------ */
  col *= uExposure;
  col = tonemap(col);

  /* --- 3-way colour ------------------------------------------------------ */
  float l = luma(col);
  float wS = 1.0 - smoothstep(0.0, 0.42, l);
  float wH = smoothstep(0.45, 1.0, l);
  float wM = max(0.0, 1.0 - wS - wH);
  float wsum = max(1e-4, wS + wM + wH);
  vec3 tint = (uShadowTint * wS + uMidTint * wM + uHighTint * wH) / wsum;
  col *= tint;

  /* --- lift / gain ------------------------------------------------------- */
  col = col * uGain + uLift * (1.0 - l);

  /* --- contrast: a GAMMA pivot at scene-linear 0.18 ----------------------
   * This used to be the affine (col - 0.18) * C + 0.18. An affine contrast
   * translates the whole curve: to gain 0.2 at the top it also SUBTRACTS a
   * fixed 0.2 * (C-1) everywhere, which slams a large fraction of the frame
   * flat onto zero and shows up as a hard, plastic-looking crush.
   *
   * A gamma pivot pins BOTH endpoints — 0 stays 0, GRADE_PIVOT stays
   * GRADE_PIVOT — and spends its entire budget on the slope, so the shadows
   * roll down smoothly while the top of the range expands into the white
   * point above. That is the "more contrast, not more brightness" the RA3
   * side-by-side is actually asking for.
   */
  col = GRADE_PIVOT * pow(max(col, 0.0) / GRADE_PIVOT, vec3(uContrast));

  /* --- highlight reach: declare the white point --------------------------- */
  col /= GRADE_WHITE;
  col = max(col, 0.0);

  /* --- saturation (shadows desaturate further) --------------------------- */
  float sat = uSaturation * mix(1.0, uShadowSaturation, wS);
  col = mix(vec3(luma(col)), col, sat);
  col = max(col, 0.0);

  /* --- blown highlights go to PAPER WHITE, not to a coloured clip ---------
   * Without this a clipped specular clamps per channel and comes out tinted
   * (1.0, 1.0, 0.74) — a yellow blob, not a highlight. Folding the overflow
   * back toward white is what a real sensor does, and it is also what keeps
   * scorecard #20 (saturation must fall as luminance rises) true at the very
   * top of the curve now that the top of the curve exists at all.
   */
  {
    float over = max(col.r, max(col.g, col.b)) - 1.0;
    col = mix(col, vec3(1.0), clamp(over, 0.0, 1.0));
  }

  /* --- vignette ---------------------------------------------------------- */
  if (uVignette > 0.0001) {
    float d = length(centered) * 1.41421356;
    float v = 1.0 - smoothstep(uVignetteSoftness, 1.18, d);
    col *= mix(1.0, v, uVignette);
  }

  /* --- display encode ---------------------------------------------------- */
  vec3 outCol = linearToSrgb(col);

  /* --- film grain (display space, mid-weighted) -------------------------- */
  if (uGrain > 0.0001) {
    vec2 gp = floor(gl_FragCoord.xy / max(uGrainSize, 0.5));
    float n = hash13(vec3(gp, floor(uTime * 24.0)));
    // Strongest in the mids, absent in blacks and blown highlights.
    float resp = 1.0 - abs(luma(outCol) * 2.0 - 1.0);
    outCol += (n - 0.5) * uGrain * resp * 2.0;
  }

  gl_FragColor = vec4(clamp(outCol, 0.0, 1.0), 1.0);
}
`;

interface GradeUniforms {
  tDiffuse: { value: THREE.Texture | null };
  uTexel: { value: THREE.Vector2 };
  uTime: { value: number };
  uExposure: { value: number };
  uToneMode: { value: number };
  uShadowTint: { value: THREE.Vector3 };
  uMidTint: { value: THREE.Vector3 };
  uHighTint: { value: THREE.Vector3 };
  uLift: { value: THREE.Vector3 };
  uGain: { value: THREE.Vector3 };
  uContrast: { value: number };
  uSaturation: { value: number };
  uShadowSaturation: { value: number };
  uVignette: { value: number };
  uVignetteSoftness: { value: number };
  uGrain: { value: number };
  uGrainSize: { value: number };
  uCA: { value: number };
  uSharpen: { value: number };
  [key: string]: THREE.IUniform;
}

function makeGradeUniforms(): GradeUniforms {
  return {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    uTime: { value: 0 },
    uExposure: { value: 0.90 },
    uToneMode: { value: TONE_MODE_ID.aces },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uMidTint: { value: new THREE.Vector3(1, 1, 1) },
    uHighTint: { value: new THREE.Vector3(1, 1, 1) },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uContrast: { value: 1.32 },
    uSaturation: { value: 1.02 },
    uShadowSaturation: { value: 0.94 },
    uVignette: { value: 0.20 },
    uVignetteSoftness: { value: 0.62 },
    uGrain: { value: 0.016 },
    uGrainSize: { value: 1.4 },
    uCA: { value: 0.0016 },
    uSharpen: { value: 0.40 },
  };
}

/** Normalise a colour so multiplying by it does not change overall luminance. */
const _tmpVec = new THREE.Vector3();
function lumaNormalized(hex: number, out: THREE.Vector3): THREE.Vector3 {
  srgbVec3(hex, _tmpVec);
  const l = 0.2126 * _tmpVec.x + 0.7152 * _tmpVec.y + 0.0722 * _tmpVec.z;
  const inv = l > 1e-4 ? 1 / l : 1;
  return out.set(_tmpVec.x * inv, _tmpVec.y * inv, _tmpVec.z * inv);
}

/* ========================================================================== */
/* PostChain                                                                  */
/* ========================================================================== */

export interface PostChain {
  /** null when the composer could not be constructed at all. */
  readonly composer: EffectComposer | null;
  /** Live pass instances by id. Missing = not constructed. */
  readonly passes: Readonly<Partial<Record<PassId, Pass>>>;
  /** Construction errors, keyed by pass id. Empty on a healthy boot. */
  readonly failures: Readonly<Partial<Record<PassId, string>>>;
  readonly enabled: boolean;
  /** True when the chain is actually driving the frame (composer alive+on). */
  readonly active: boolean;

  /** Draw one frame. Falls back to renderer.render() when inactive. */
  render(dt: number): void;
  setCamera(camera: THREE.Camera): void;
  setScene(scene: THREE.Scene): void;
  setEnabled(v: boolean): void;
  setPassEnabled(id: PassId, v: boolean): void;
  isPassEnabled(id: PassId): boolean;
  /** Re-read RENDER_CONFIG.post into every pass uniform. Cheap; no rebuilds. */
  syncConfig(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export interface CreatePostOptions {
  handle: RendererHandle;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

export function createPostChain(options: CreatePostOptions): PostChain {
  const { handle } = options;
  const renderer = handle.renderer;
  let scene = options.scene;
  let camera = options.camera;

  const cfg = RENDER_CONFIG.post;
  const passes: Partial<Record<PassId, Pass>> = {};
  const failures: Partial<Record<PassId, string>> = {};
  const passEnabled: Record<PassId, boolean> = {
    render: true,
    ao: cfg.ao.enabled,
    bloom: cfg.bloom.enabled,
    grade: cfg.grade.enabled,
    smaa: cfg.smaa.enabled,
  };

  let composer: EffectComposer | null = null;
  let gradeUniforms: GradeUniforms | null = null;
  let elapsed = 0;
  let disposed = false;
  let enabled = cfg.enabled;
  let warnedDirt = false;
  /** Set by `rebuild()`; consumed by `render()`, which warms up first. */
  let chainDirty = false;
  /**
   * Live mirror of `cfg.ao.halfRes`, read by the `setSize` wrapper. Kept beside
   * the pass rather than read from config inside the wrapper so that flipping
   * the flag is a single, observable transition in `applyAoConfig`.
   */
  let aoHalfRes = cfg.ao.halfRes;

  const width = () => Math.max(2, handle.size.width);
  const height = () => Math.max(2, handle.size.height);

  /* ---- composer + HDR targets ------------------------------------------ */
  try {
    /*
     * THE ONLY GEOMETRIC ANTIALIASING IN THIS PIPELINE. See
     * `PostConfig.msaaSamples` for the measurement and for why the renderer's
     * `antialias: false` context flag was never the knob — the scene is drawn
     * into this target, not into the default framebuffer.
     *
     * Clamped to what the driver actually reports. WebGL2 guarantees at least
     * 4; asking for 8 on hardware that caps at 4 is a silently-invalid target
     * on some drivers rather than a clamp, which is a black frame — the failure
     * mode this file's try/catch exists for, and one worth not provoking.
     */
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const maxSamples = typeof gl.getParameter === 'function' && 'MAX_SAMPLES' in gl
      ? (gl.getParameter(gl.MAX_SAMPLES) as number) : 0;
    const samples = Math.max(0, Math.min(cfg.msaaSamples | 0, maxSamples || 0));

    const rt = new THREE.WebGLRenderTarget(width(), height(), {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace, // working (linear) space, not display
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples,
    });
    rt.texture.name = 'PostHDR';
    composer = new EffectComposer(renderer, rt);
    composer.renderToScreen = true;
  } catch (err) {
    failures.render = String(err);
    console.error('[post] EffectComposer construction failed — falling back to direct render', err);
    composer = null;
  }

  /* ---- individual passes ------------------------------------------------ */
  function build(id: PassId, factory: () => Pass): void {
    if (!composer) return;
    try {
      const p = factory();
      passes[id] = p;
    } catch (err) {
      failures[id] = String(err);
      console.warn(`[post] pass "${id}" failed to construct; continuing without it`, err);
    }
  }

  if (composer) {
    build('render', () => {
      const p = new RenderPass(scene, camera);
      p.clear = true;
      return p as unknown as Pass;
    });

    build('bloom', () => {
      const b = new UnrealBloomPass(
        new THREE.Vector2(width(), height()),
        cfg.bloom.strength,
        cfg.bloom.radius,
        cfg.bloom.threshold
      );
      return b as unknown as Pass;
    });

    build('grade', () => {
      gradeUniforms = makeGradeUniforms();
      const p = new ShaderPass({
        name: 'GradePass',
        uniforms: gradeUniforms as unknown as { [k: string]: THREE.IUniform },
        vertexShader: GRADE_VERT,
        fragmentShader: GRADE_FRAG,
      });
      return p as unknown as Pass;
    });

    build('smaa', () => {
      const p = new (SMAAPass as unknown as new (w?: number, h?: number) => Pass)(width(), height());
      return p;
    });

    /* ---- AO: GTAO, else SSAO, else none — BUILT SYNCHRONOUSLY -----------
     * This runs inside the same `if (composer)` block as every other pass, so
     * the chain `rebuild()` below sees its final membership. Nothing is added
     * to the composer after `createPostChain()` returns. See the file header.
     */
    build('ao', () => {
      const ao = aoTargetSize(width(), height(), cfg.ao.halfRes);
      try {
        const p = new GTAOPass(scene, camera, ao.width, ao.height);
        p.output = GTAOPass.OUTPUT.Default;
        seedAoDenoiseNoise(p);
        installAoOccluderFilter(p);
        installAoResolutionScale(p);
        installAoInPlaceComposite(p);
        if (DEV) console.info(`[post] AO: GTAO @ ${ao.width}x${ao.height}`);
        return p as unknown as Pass;
      } catch (errGtao) {
        console.warn('[post] GTAO unavailable — falling back to SSAO', errGtao);
        const p = new SSAOPass(scene, camera, ao.width, ao.height);
        p.output = SSAOPass.OUTPUT.Default;
        installAoResolutionScale(p);
        if (DEV) console.info(`[post] AO: SSAO @ ${ao.width}x${ao.height} (GTAO unavailable)`);
        return p as unknown as Pass;
      }
    });
  }

  /**
   * RESEED GTAO'S POISSON-DENOISE NOISE. It ships seeded from `Math.random()`.
   *
   * `GTAOPass._generateNoise()` builds a 64x64 RGBA rotation texture from
   * `new SimplexNoise()`, and `SimplexNoise`'s default RNG argument is `Math`.
   * So every boot gets a different denoise rotation field, every boot's AO
   * lands slightly differently in every crease, and the screenshot harness
   * cannot produce the same image twice.
   *
   * It is not subtle in aggregate: with the whole post chain disabled, two
   * boots of `?shot=allied-base` are BYTE-IDENTICAL; with it enabled, 27% of
   * subpixels move. Individually the deltas are 1-4/255 and they sit on
   * geometry edges, which is exactly where the eye and a Sobel edge metric both
   * look. `src/core/math.ts` already states the rule this breaks —
   * "`Math.random()` is BANNED ... inside every texture generator" — and the
   * only reason this one escaped it is that the generator is in three's
   * examples rather than in this repo.
   *
   * Regenerated with the project's own seeded `Rng`, using the same formula and
   * the same 64 px size, then rebound: the constructor already copied the old
   * texture into `pdMaterial.uniforms.tNoise`, so replacing only the field
   * would change nothing.
   */
  function seedAoDenoiseNoise(pass: unknown): void {
    const p = pass as {
      pdNoiseTexture?: THREE.DataTexture;
      pdMaterial?: { uniforms?: { tNoise?: { value: THREE.Texture | null } } };
    };
    const old = p.pdNoiseTexture;
    if (old === undefined) return;

    const size = 64;
    const rng = new Rng(AO_NOISE_SEED);
    const simplex = new SimplexNoise({ random: () => rng.next() });
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const o = (i * size + j) * 4;
        data[o] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
        data[o + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
        data[o + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255;
        data[o + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;

    p.pdNoiseTexture = tex;
    const uniform = p.pdMaterial?.uniforms?.tNoise;
    if (uniform !== undefined) uniform.value = tex;
    old.dispose();
  }

  /**
   * Make the AO pass size ITSELF, not the drawing buffer.
   *
   * Wrapping the pass's own `setSize` rather than scaling at the call site is
   * deliberate: `EffectComposer.setSize` calls it too, and it is called on
   * every resize, every DPR change and every `resolutionScale` step the
   * adaptive controller takes. A scaling rule that only `applyPendingSize`
   * honours would be undone by the very next composer resize.
   *
   * `aoHalfRes` is read at call time, so flipping the config re-sizes on the
   * next `applyAoConfig` without rebuilding the pass.
   */
  function installAoResolutionScale(pass: unknown): void {
    const p = pass as { setSize?: (w: number, h: number) => void };
    const base = p.setSize;
    if (typeof base !== 'function') return;
    const bound = base.bind(p);
    p.setSize = (w: number, h: number): void => {
      const s = aoTargetSize(w, h, aoHalfRes);
      bound(s.width, s.height);
    };
  }

  /**
   * COMPOSITE THE AO IN PLACE, IN ONE FULL-RESOLUTION PASS INSTEAD OF TWO.
   *
   * `GTAOPass.OUTPUT.Default` does this:
   *
   *     copy   readBuffer  -> writeBuffer     (NoBlending, full res, RGBA16F)
   *     blend  AO          -> writeBuffer     (dst*src multiply, full res)
   *
   * The copy exists only to SEED the destination, because the blend is
   * `blendSrc: DstColorFactor, blendDst: ZeroFactor` — a pure multiply against
   * whatever is already in the target. But the scene is already sitting in
   * `readBuffer` (three's own `RenderPass` has `needsSwap = false` and renders
   * there), so multiplying straight into `readBuffer` and declining the swap
   * produces the identical image with the copy deleted.
   *
   * Measured, live match, fixed 2560x1440, GPU timer queries:
   *
   *     AO with the full composite        43.53 ms
   *     AO with the composite skipped     37.52 ms      <- the two passes are 6.02 ms
   *
   * Half of that is the copy: one full-resolution RGBA16F read plus a
   * full-resolution RGBA16F write, 59 MB of traffic per frame on a GPU sharing
   * system memory with the CPU, to produce a buffer whose entire content is
   * about to be multiplied by something else.
   *
   * The one case that still needs both passes is AO being the LAST pass in the
   * chain — bloom, grade and SMAA all disabled — because then the destination
   * is the default framebuffer, which holds nothing to multiply. That path is
   * kept, byte for byte, rather than left as a latent black frame.
   *
   * Nothing here is done when the AO pass is the SSAO fallback: it has no
   * `blendMaterial` and its composite is a different shape.
   */
  function installAoInPlaceComposite(pass: unknown): void {
    const p = pass as {
      output: number;
      needsSwap: boolean;
      renderToScreen: boolean;
      blendIntensity?: number;
      blendMaterial?: THREE.ShaderMaterial;
      copyMaterial?: THREE.ShaderMaterial;
      pdRenderTarget?: THREE.WebGLRenderTarget;
      render(
        renderer: THREE.WebGLRenderer,
        writeBuffer: THREE.WebGLRenderTarget,
        readBuffer: THREE.WebGLRenderTarget,
        deltaTime: number,
        maskActive: boolean,
      ): void;
      _renderPass?(
        renderer: THREE.WebGLRenderer,
        material: THREE.Material,
        target: THREE.WebGLRenderTarget | null,
        clearColor?: number,
        clearAlpha?: number,
      ): void;
    };

    const blend = p.blendMaterial;
    const copy = p.copyMaterial;
    const pd = p.pdRenderTarget;
    const renderPass = p._renderPass;
    if (blend === undefined || copy === undefined || pd === undefined || typeof renderPass !== 'function') {
      return;
    }

    const baseRender = p.render.bind(p);
    const doPass = renderPass.bind(p);

    // GTAO now produces the AO texture and stops. We own the composite.
    p.output = GTAOPass.OUTPUT.Off;
    p.needsSwap = false;

    p.render = function inPlaceComposite(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      baseRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      blend.uniforms.intensity.value = p.blendIntensity ?? 1;
      blend.uniforms.tDiffuse.value = pd.texture;
      if (p.renderToScreen) {
        // Nothing in the default framebuffer to multiply — seed it first.
        copy.uniforms.tDiffuse.value = readBuffer.texture;
        copy.blending = THREE.NoBlending;
        doPass(renderer, copy, null);
        doPass(renderer, blend, null);
        return;
      }
      doPass(renderer, blend, readBuffer);
    };
  }

  /**
   * KEEP NON-OCCLUDERS OUT OF THE AO NORMAL/DEPTH PREPASS.
   *
   * `GTAOPass` renders the whole scene a second time with a normal material to
   * build its G-buffer, and its own filter only skips Points and Lines. Every
   * transparent MESH therefore lands in that buffer as a solid, opaque
   * occluder — and the ground decal field is a flat sheet of quads lying on the
   * terrain, so GTAO reads a wall a few centimetres above the ground and
   * occludes everything under it. That is the hard-edged pure-black polygons in
   * `?shot=battle` and `?shot=naval`; the smoke layers add the same defect in
   * the air. Turning AO off made both disappear entirely, which is how this was
   * isolated: the decal SHADER was innocent (forcing its darkening floor to
   * 0.95 changed nothing).
   *
   * The predicate is the honest one: an object that does not write depth in the
   * main pass, or that is transparent, or that lives on the effects/overlay
   * layers, is not an occluder. It is also a straight perf win — the prepass
   * stops drawing the particle, beam and decal layers.
   */
  function installAoOccluderFilter(pass: unknown): void {
    const p = pass as {
      scene: THREE.Scene;
      _visibilityCache?: THREE.Object3D[];
      _overrideVisibility?: () => void;
    };
    const base = p._overrideVisibility;
    if (typeof base !== 'function') return;

    p._overrideVisibility = function overrideVisibility(this: typeof p): void {
      base.call(this);
      const cache = this._visibilityCache;
      if (cache === undefined) return;
      this.scene.traverse((o) => {
        if (!o.visible || !(o as THREE.Mesh).isMesh) return;
        if (aoOccluder(o as THREE.Mesh)) return;
        o.visible = false;
        cache.push(o);
      });
    };
  }

  function aoOccluder(mesh: THREE.Mesh): boolean {
    if (mesh.layers.isEnabled(LAYERS.EFFECTS) || mesh.layers.isEnabled(LAYERS.OVERLAY)) return false;
    const mat = mesh.material;
    const list = Array.isArray(mat) ? mat : [mat];
    for (const m of list) {
      if (m === undefined || m === null) continue;
      if (m.transparent === true || m.depthWrite === false) return false;
      if (m.blending !== THREE.NormalBlending && m.blending !== THREE.NoBlending) return false;
    }
    return true;
  }

  function applyAoConfig(): void {
    const ao = passes.ao as any;
    if (!ao) return;
    const c = cfg.ao;

    // `halfRes` changes the SIZE of three render targets, so it cannot be
    // folded in with the scalar uniforms below — it has to re-drive setSize.
    // Detected as a transition, because re-sizing costs three reallocations.
    if (aoHalfRes !== c.halfRes) {
      aoHalfRes = c.halfRes;
      if (appliedW > 0 && appliedH > 0 && typeof ao.setSize === 'function') {
        // The wrapper installed in `installAoResolutionScale` applies the new
        // scale; pass drawing-buffer pixels, exactly as every other caller does.
        ao.setSize(appliedW, appliedH);
      }
    }

    // GTAOPass
    if (typeof ao.updateGtaoMaterial === 'function') {
      try {
        ao.updateGtaoMaterial({
          radius: c.radius,
          distanceExponent: 1.0,
          thickness: 1.0,
          // GTAO's `scale` is the contrast curve on the AO term — this is
          // where the art bible's "power 1.6" lands.
          scale: c.power,
          samples: c.samples,
          screenSpaceRadius: false,
        });
      } catch {
        /* parameter shape drift between three versions — non-fatal */
      }
      if ('blendIntensity' in ao) ao.blendIntensity = c.intensity;
      /*
       * The Poisson denoise radius.
       *
       * This line used to reach into the denoise material for a uniform named
       * `pdRadius`, and GTAOPass has no uniform by that name — it is called
       * `radius`, and the pass exposes `updatePdMaterial` to set it. The guard
       * was `if (uniform)`, so
       * the whole statement evaluated to nothing on every build of three this
       * project has ever shipped and no error was ever raised. It is the same
       * defect class as `halfRes` itself: a setting that reads as configured,
       * has a documented meaning, and is wired to nothing.
       *
       * The old value was also backwards — 4 at half resolution and 2 at full,
       * i.e. a WIDER kernel where there are FEWER texels. `aoDenoiseRadius`
       * halves the texel radius with the resolution, which is what keeps the
       * blur covering the same fraction of the image.
       */
      if (typeof ao.updatePdMaterial === 'function') {
        try {
          ao.updatePdMaterial({ radius: aoDenoiseRadius(c.halfRes) });
        } catch {
          /* parameter shape drift between three versions — non-fatal */
        }
      }
    }
    // SSAOPass
    if ('kernelRadius' in ao) ao.kernelRadius = c.radius * 4;
    if ('minDistance' in ao) ao.minDistance = 0.002;
    if ('maxDistance' in ao) ao.maxDistance = 0.12;
    if ('kernelSize' in ao && typeof ao.kernelSize === 'number') ao.kernelSize = c.samples;
  }

  /* ---- composer pass ordering ------------------------------------------ */
  function rebuild(): void {
    if (!composer) return;
    composer.passes.length = 0;
    let last: Pass | null = null;
    for (const id of PASS_ORDER) {
      const p = passes[id];
      if (!p) continue;
      if (!passEnabled[id]) {
        p.enabled = false;
        continue;
      }
      p.enabled = true;
      p.renderToScreen = false;
      composer.addPass(p);
      last = p;
    }
    if (last) last.renderToScreen = true;

    // The renderer must NOT tonemap when the grade pass is doing it.
    const gradeLive = !!passes.grade && passEnabled.grade && enabled;
    handle.setToneMappingMode(gradeLive ? 'none' : RENDER_CONFIG.post.grade.mode);

    // Membership or order changed: the next presented frame must not be the
    // first one this arrangement has ever drawn. See `warmUp()`.
    chainDirty = true;
  }

  /**
   * Draw one complete frame into the composer's OWN targets and throw it away.
   *
   * Called before presenting whenever the pass list has just changed. It forces
   * every program in the new arrangement to compile and every ping-pong target
   * to be allocated and written, so the frame that actually reaches the screen
   * is a finished one. Without it, the first frame after a reorder can present
   * a target that was allocated this tick and never drawn into — black.
   *
   * The trick is simply to clear `renderToScreen` on the tail pass, so the
   * chain terminates in an offscreen buffer instead of the default framebuffer.
   */
  function warmUp(): void {
    if (!composer || composer.passes.length === 0) return;
    const last = composer.passes[composer.passes.length - 1];
    const wasScreen = last.renderToScreen;
    last.renderToScreen = false;
    try {
      composer.render(1 / 60);
    } catch (err) {
      console.warn('[post] warm-up frame failed; presenting anyway', err);
    } finally {
      last.renderToScreen = wasScreen;
      renderer.setRenderTarget(null);
    }
  }

  /* ---- config -> uniforms ---------------------------------------------- */
  function syncConfig(): void {
    const bloom = passes.bloom as any;
    if (bloom) {
      bloom.threshold = cfg.bloom.threshold;
      // emissiveBoost is normalised so the bible's default pair
      // (strength 0.55, emissiveBoost 1.6) yields exactly 0.55. Raising
      // emissiveBoost raises the glow without touching the threshold, which is
      // the knob a critic actually wants ("the tesla coil should read hotter").
      bloom.strength = cfg.bloom.strength * Math.max(0.25, cfg.bloom.emissiveBoost / 1.6);
      bloom.radius = cfg.bloom.radius;
      const dirtUniform = bloom.compositeMaterial?.uniforms?.dirtTexture;
      if (!dirtUniform && cfg.bloom.lensDirt > 0 && !warnedDirt && DEV) {
        warnedDirt = true;
        console.info('[post] lens dirt not supported by this UnrealBloomPass build — ignored');
      }
    }

    if (gradeUniforms) {
      const g = cfg.grade;
      gradeUniforms.uExposure.value = g.exposure;
      gradeUniforms.uToneMode.value = TONE_MODE_ID[g.mode] ?? 1;
      lumaNormalized(g.shadowTint, gradeUniforms.uShadowTint.value);
      lumaNormalized(g.midTint, gradeUniforms.uMidTint.value);
      lumaNormalized(g.highlightTint, gradeUniforms.uHighTint.value);
      // lift is additive and must stay tiny; gain is a direct multiplier.
      srgbVec3(g.lift, gradeUniforms.uLift.value).multiplyScalar(0.5);
      srgbVec3(g.gain, gradeUniforms.uGain.value);
      gradeUniforms.uContrast.value = g.contrast;
      gradeUniforms.uSaturation.value = g.saturation;
      gradeUniforms.uShadowSaturation.value = g.shadowSaturation;
      gradeUniforms.uVignette.value = g.vignette;
      gradeUniforms.uVignetteSoftness.value = THREE.MathUtils.clamp(g.vignetteSoftness, 0.05, 1.15);
      gradeUniforms.uGrain.value = g.grain;
      gradeUniforms.uGrainSize.value = g.grainSize;
      gradeUniforms.uCA.value = g.chromaticAberration;
      gradeUniforms.uSharpen.value = g.sharpen;
    }

    applyAoConfig();

    // Toggles may have flipped in config; mirror them and re-order.
    let orderDirty = false;
    const want: Record<PassId, boolean> = {
      render: true,
      ao: cfg.ao.enabled,
      bloom: cfg.bloom.enabled,
      grade: cfg.grade.enabled,
      smaa: cfg.smaa.enabled,
    };
    for (const id of PASS_ORDER) {
      if (passEnabled[id] !== want[id]) {
        passEnabled[id] = want[id];
        orderDirty = true;
      }
    }
    if (enabled !== cfg.enabled) {
      enabled = cfg.enabled;
      orderDirty = true;
    }
    if (orderDirty) rebuild();
  }

  /* ---- size -------------------------------------------------------------
   * REALLOCATION IS DEFERRED AND DEDUPED.
   *
   * `setSize` used to rebuild every composer target and every pass target
   * synchronously, on every call — and it is called from the renderer's resize
   * listener, which fires on subscribe, on every ResizeObserver tick, on every
   * DPR change and on every forced resize (a resolution-scale change, a
   * screenshot's `setFixedSize`). On a Retina MacBook at DPR 2 a fullscreen
   * transition or a display switch fires that burst several times in a row, and
   * each one throws away several full-resolution half-float targets.
   *
   * Two changes:
   *   1. An unchanged size is a no-op. This alone removes most of the churn —
   *      `onResize` fires immediately on subscribe with the size we were just
   *      constructed at, and DPR listeners re-fire with identical numbers.
   *   2. A genuine change is recorded and applied at the TOP of the next
   *      `render()`, never in the middle of one. A burst of resize events
   *      inside one frame therefore costs exactly one reallocation, and there
   *      is no window in which a frame could be presented between a target
   *      being disposed and its replacement being drawn into: the very next
   *      thing after `applyPendingSize()` is a full chain render that clears
   *      and writes every target it touches.
   */
  let appliedW = 0;
  let appliedH = 0;
  let pendingW = 0;
  let pendingH = 0;
  let sizeDirty = false;

  function setSize(w: number, h: number): void {
    const pw = Math.max(2, Math.round(w));
    const ph = Math.max(2, Math.round(h));
    if (pw === appliedW && ph === appliedH) {
      sizeDirty = false; // a pending change was superseded by "back to current"
      return;
    }
    pendingW = pw;
    pendingH = ph;
    sizeDirty = true;
  }

  function applyPendingSize(): void {
    if (!sizeDirty) return;
    sizeDirty = false;
    const pw = pendingW;
    const ph = pendingH;
    if (pw === appliedW && ph === appliedH) return;
    appliedW = pw;
    appliedH = ph;

    composer?.setSize(pw, ph);
    // EffectComposer.setSize takes drawing-buffer pixels; our handle already
    // reports those, so pixelRatio must stay at 1 inside the composer.
    (composer as any)?.setPixelRatio?.(1);
    for (const id of PASS_ORDER) {
      const p: any = passes[id];
      if (p && typeof p.setSize === 'function') {
        try {
          p.setSize(pw, ph);
        } catch (err) {
          console.warn(`[post] setSize failed for "${id}"`, err);
        }
      }
    }
    if (gradeUniforms) gradeUniforms.uTexel.value.set(1 / pw, 1 / ph);
  }

  const offResize = handle.onResize((size) => setSize(size.width, size.height));

  const offConfig = onConfigChanged((changed) => {
    if (touched(changed, 'post')) syncConfig();
  });

  rebuild();
  syncConfig();
  setSize(width(), height());
  // Size the chain once, synchronously, so `uTexel` and every pass target are
  // correct before anyone can read them. From here on sizing is deferred.
  applyPendingSize();

  /* ---- render ----------------------------------------------------------- */
  const chain: PostChain = {
    get composer() {
      return composer;
    },
    passes,
    failures,
    get enabled() {
      return enabled;
    },
    get active() {
      return !!composer && enabled && composer.passes.length > 0;
    },

    render(dt: number) {
      if (disposed) return;
      // Drawing into a lost context presents an undefined buffer. Skipping the
      // frame leaves the last complete one on screen until the context is back.
      if (handle.isContextLost()) return;

      // Any reallocation happens HERE — between frames, never inside one.
      applyPendingSize();

      elapsed += dt;
      if (gradeUniforms) gradeUniforms.uTime.value = elapsed;

      if (composer && enabled && composer.passes.length > 0) {
        if (chainDirty) {
          chainDirty = false;
          warmUp();
        }
        composer.render(dt);
      } else {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      }
    },

    setCamera(cam: THREE.Camera) {
      camera = cam;
      for (const id of PASS_ORDER) {
        const p: any = passes[id];
        if (p && 'camera' in p) p.camera = cam;
      }
    },

    setScene(s: THREE.Scene) {
      scene = s;
      for (const id of PASS_ORDER) {
        const p: any = passes[id];
        if (p && 'scene' in p) p.scene = s;
      }
    },

    setEnabled(v: boolean) {
      if (enabled === v) return;
      enabled = v;
      RENDER_CONFIG.post.enabled = v;
      rebuild();
    },

    setPassEnabled(id: PassId, v: boolean) {
      if (id === 'render') return;
      if (passEnabled[id] === v) return;
      passEnabled[id] = v;
      switch (id) {
        case 'ao':
          cfg.ao.enabled = v;
          break;
        case 'bloom':
          cfg.bloom.enabled = v;
          break;
        case 'grade':
          cfg.grade.enabled = v;
          break;
        case 'smaa':
          cfg.smaa.enabled = v;
          break;
      }
      rebuild();
    },

    isPassEnabled(id: PassId) {
      return !!passes[id] && passEnabled[id];
    },

    syncConfig,
    setSize,

    dispose() {
      if (disposed) return;
      disposed = true;
      offResize();
      offConfig();
      for (const id of PASS_ORDER) {
        const p: any = passes[id];
        try {
          p?.dispose?.();
        } catch {
          /* some passes have no dispose */
        }
        delete passes[id];
      }
      try {
        (composer as any)?.renderTarget1?.dispose?.();
        (composer as any)?.renderTarget2?.dispose?.();
        (composer as any)?.dispose?.();
      } catch {
        /* ignore */
      }
      composer = null;
      handle.setToneMappingMode(RENDER_CONFIG.post.grade.mode);
    },
  };

  if (DEV) {
    const built = PASS_ORDER.filter((id) => !!passes[id]);
    console.info(
      `[post] chain: ${built.join(' -> ')}${
        Object.keys(failures).length ? `  (failed: ${Object.keys(failures).join(', ')})` : ''
      }`
    );
  }

  return chain;
}

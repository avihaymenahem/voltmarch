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
 *     detection actually wants to be. SMAA is the MORPHOLOGICAL AA path; the
 *     geometric one is the optional MSAA scene target described next.
 *
 * MSAA: ONE MULTISAMPLED TARGET, ONE RESOLVE, AND THE CLONE TRAP THAT COST 8 FPS
 * ------------------------------------------------------------------------------
 * `PostConfig.msaaSamples` is off by default and no quality tier turns it on.
 * When the `graphics.msaa` settings toggle DOES turn it on, this is the shape it
 * takes, and the shape matters more than the feature:
 *
 *     RenderPass -> sceneMsaa (samples>0)  [three resolves it, once]
 *                -> resolveQuad            [one textured full-screen copy]
 *                -> composer readBuffer (samples 0)
 *                -> AO -> Bloom -> Grade -> SMAA, all on plain targets
 *
 * ── THE TRAP ─────────────────────────────────────────────────────────────────
 * The first attempt set `samples` on the render target handed to
 * `new EffectComposer(renderer, rt)`. `EffectComposer`'s constructor does
 * `this.renderTarget2 = renderTarget.clone()`, and `WebGLRenderTarget.copy`
 * copies `samples`. So BOTH halves of the ping-pong pair were multisampled, and
 * every pass in the chain then rendered into a multisampled RGBA16F target.
 * `WebGLRenderer.render()` ends with `textures.updateMultisampleRenderTarget(
 * _currentRenderTarget )`, which blits whenever `samples > 0` — so AO, bloom,
 * grade and SMAA each forced a resolve of their own. Five resolves a frame where
 * the geometry needed one, on full-screen quads that have no coverage to sample
 * in the first place. At 2560x1440, RGBA16F, 4 samples, that is ~120 MB of blit
 * traffic per frame added for nothing. It cost a reporter on an integrated
 * Radeon 7-8 fps of ~22 and was reverted. Do not hand `EffectComposer` a
 * multisampled target. The literal `samples: 0` below is load-bearing.
 *
 * ── WHAT "EXACTLY ONE RESOLVE" IS AND IS NOT CLAIMING ────────────────────────
 * Provable by reading this file plus three@0.185.1:
 *
 *   - `sceneMsaa` is the ONLY render target in this file constructed with
 *     `samples > 0`. Everything else, the composer pair included, is 0.
 *   - `installSceneMsaaResolve` is the ONLY place that binds it, and it binds it
 *     once per `composer.render()`.
 *   - three resolves a multisampled target at the end of each
 *     `WebGLRenderer.render()` that targeted it, guarded on `samples > 0`
 *     (three.module.js: `if ( _currentRenderTarget !== null && ... )`). One
 *     bind, one `renderer.render`, one resolve.
 *   - The other `updateMultisampleRenderTarget` call sites in three are the
 *     transmission pass. This project ships no transmissive material
 *     (`core/config.ts`: "No transmission — far too expensive at RTS counts"),
 *     so that path cannot fire.
 *
 * NOT claimed: that the whole thing is free. The transfer from `sceneMsaa` into
 * the composer's read buffer is a real full-resolution RGBA16F copy — the same
 * kind of copy `installAoInPlaceComposite` below went to some trouble to delete.
 * A direct `gl.blitFramebuffer` from the multisample framebuffer straight into
 * the read buffer's framebuffer would fold the transfer INTO the resolve and
 * cost nothing extra, and it is the obvious next step. It is not shipped here
 * because it needs `renderer.properties.get(rt).__webglFramebuffer` — private,
 * version-fragile, and a wrong blit is a black frame — and there is no GPU in
 * the test environment to verify it on. What is shipped is the shape that can be
 * checked by reading it.
 *
 * ALSO NOT claimed: a frame-time number. The 7-8 fps regression above was
 * measured on hardware nobody here has, and this change has not been re-measured
 * on it. The defensible statement is structural — four of the five resolves are
 * gone — not "it is now fast". The lesson from the first attempt is on the
 * record in `PostConfig.msaaSamples`: a vsync-locked frame cannot measure a cost
 * smaller than its own idle headroom, so "no change" there means nothing at all.
 *
 * ── WHAT WAS ACTUALLY OBSERVED ───────────────────────────────────────────────
 * Headless Chromium, ANGLE, WebGL2 (`MAX_SAMPLES` 8), `?shot=allied-base`,
 * `msaaSamples` flipped 0 -> 4 -> 0 live through `__VM.configure`. Every render
 * target reachable from the post chain was walked and its `samples` read:
 *
 *     PostHDR                0      EffectComposer.rt2     0
 *     UnrealBloomPass mips   0 x4   SMAAPass.edges/weights 0
 *
 * All of them, WHILE MSAA WAS ON. That is the clone trap, observed absent: the
 * pair `EffectComposer` builds by cloning `PostHDR` is single-sampled, so no
 * post pass can resolve. Draw calls went 271 -> 272, exactly the one transfer
 * quad and nothing else. Mean frame luminance 108.60 -> 108.99 (MSAA must not
 * move the grade) and back to 108.60 byte-for-byte when switched off again;
 * 30.4% of subpixels moved, i.e. it is genuinely resampling edges rather than
 * being wired to nothing. No GL error, no console error.
 *
 * None of that is a frame time. It is "the structure is what the comment says".
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
 * The chain is warmed ONCE at construction, with the loading curtain still up
 * and the game loop not yet running, so every post program is compiled before
 * the first presented frame rather than during it. Any reorder that DOES happen
 * later (a Settings toggle, `setPassEnabled`) sets `chainDirty`, and the next
 * `render()` draws one throwaway frame into the composer's own targets before
 * presenting. See `warmUp()` — including why the first version of it presented
 * that throwaway frame instead of hiding it.
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
import { FullScreenQuad, type Pass } from 'three/examples/jsm/postprocessing/Pass.js';

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

/**
 * How many MSAA samples the SCENE target actually gets.
 *
 * Pure and exported for the same reason `aoTargetSize` is: the previous MSAA
 * attempt was a number nobody watched a test produce, and it shipped a chain
 * where every pass was multisampled. See the file header.
 *
 * Two rules, and both are about not provoking the black frame this file's
 * try/catch exists for:
 *
 *  - CLAMPED TO THE DRIVER. WebGL2 guarantees `MAX_SAMPLES >= 4`; asking for 8
 *    where the driver caps at 4 is, on some drivers, a silently-incomplete
 *    framebuffer rather than a clamp.
 *  - ANYTHING BELOW 2 IS OFF. A one-sample "multisampled" target is a second
 *    full-size allocation, a resolve blit and a transfer copy in exchange for
 *    exactly the image a plain target already produced. `0` is the honest
 *    encoding of "no MSAA path at all", and the caller tests it as such.
 */
export function msaaSampleCount(requested: number, maxSamples: number): number {
  const want = Number.isFinite(requested) ? Math.floor(requested) : 0;
  const cap = Number.isFinite(maxSamples) ? Math.floor(maxSamples) : 0;
  if (want < 2 || cap < 2) return 0;
  return Math.min(want, cap);
}

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

  /* --- unsharp mask: LUMA ONLY -------------------------------------------
   * The overshoot is applied as a SCALE on the whole triple, computed from
   * luma, rather than as a per-channel add.
   *
   * The per-channel version -- col += (col - blur) * uSharpen, then a clamp to
   * zero -- is a chroma generator at any high-contrast edge. On the dark side of a
   * whitecap the undershoot drives every channel negative; the clamp lands R
   * and B on exactly 0 while G survives, and the grade's "blown highlights go
   * to paper white" fold then lifts R and B back TOGETHER, so the pixel comes
   * out at hue exactly 120.0 with R == B. That is not a rounding artefact: on
   * 08-naval-water: 15 265 pixels sat at h in [119.5, 120] and 23.7% of the
   * whole scorecard-#9 leak was |R - B| <= 2, i.e. ringing rather than art.
   * Bible 4.6 measures R/B edge registration at +0.0 px in every reference
   * frame and metrics.mjs #36 read us at 0.78-1.02 against RA3's 0.512.
   *
   * Luma is linear, so luma(col * s) == luma(col) * s: this produces exactly
   * the same luminance edge the per-channel version did, which is the half
   * scorecard #34 measures (its Sobel runs on grey). Only the chroma differs.
   * A pixel whose sharpened luma goes negative goes to BLACK, which has no hue
   * at all, instead of to a saturated primary.
   */
  if (uSharpen > 0.0001) {
    vec3 blur =
      texture2D(tDiffuse, uv + vec2( uTexel.x, 0.0)).rgb +
      texture2D(tDiffuse, uv + vec2(-uTexel.x, 0.0)).rgb +
      texture2D(tDiffuse, uv + vec2(0.0,  uTexel.y)).rgb +
      texture2D(tDiffuse, uv + vec2(0.0, -uTexel.y)).rgb;
    blur *= 0.25;
    float lc = luma(col);
    float ls = lc + (lc - luma(blur)) * uSharpen;
    col *= max(ls, 0.0) / max(lc, 1e-4);
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

/* ========================================================================== */
/* MSAA transfer shader                                                       */
/* ========================================================================== */

/**
 * The quad that moves the resolved scene out of `sceneMsaa` and into the
 * composer's read buffer.
 *
 * Deliberately its own two-line shader rather than three's `CopyShader`: that
 * one multiplies by an `opacity` uniform we would always leave at 1, and its
 * vertex shader runs a full `projectionMatrix * modelViewMatrix` for a quad
 * whose positions are already clip space. This is the same trick `GRADE_VERT`
 * uses. It is one texture fetch and one write per pixel, and it should stay
 * that way — anything else added here runs on the multisampled path only, which
 * is exactly the configuration that cannot afford it.
 */
const RESOLVE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const RESOLVE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
}
`;

/* ========================================================================== */
/* AO G-buffer: normals reconstructed from the scene's own depth              */
/* ========================================================================== */

/**
 * ONE FULL-SCREEN QUAD THAT REPLACES A WHOLE SECOND RENDER OF THE SCENE.
 *
 * `GTAOPass` builds its G-buffer by drawing every mesh again with
 * `MeshNormalMaterial` — measured at 39-57 draw calls across the thirteen
 * capture fixtures, 26.8-29.4% of every frame's total, and the single largest
 * remaining cost in the renderer. It only does that because it owns no depth:
 * `setGBuffer(depthTexture, normalTexture)` sets `_renderGBuffer = false` and
 * the prepass disappears.
 *
 * The scene has already written depth into the composer's colour target. Making
 * that depth SAMPLEABLE (a `DepthTexture` in place of the renderbuffer three
 * would otherwise allocate — same storage, same format, no extra memory) hands
 * GTAO everything it is missing except the normals, and a view normal is the
 * cross product of the two view-space depth derivatives.
 *
 * WHY A QUAD RATHER THAN `NORMAL_VECTOR_TYPE = 0`. Passing a depth texture and
 * NO normal texture is the one-line version: both shaders then call their own
 * `computeNormalFromDepth`. It is right for GTAOShader, which needs the normal
 * once per pixel and hoists it above the DIRECTIONS loop. It is wrong for
 * `PoissonDenoiseShader`, which calls `getViewNormal` once for the centre tap
 * and AGAIN FOR EVERY ONE OF ITS 16 POISSON SAMPLES — 17 reconstructions of 9
 * `texelFetch`es and 3 inverse-projection transforms each, ~150 fetches and ~50
 * `mat4 * vec4` per denoised pixel, where today it does one texture read. That
 * is trading a draw-call cost this repo can measure for a shader cost it cannot
 * (there is no GPU timer in the capture harness), which is the swap
 * `PostConfig.msaaSamples` already has a paragraph about.
 *
 * So the reconstruction happens ONCE, into the normal target `GTAOPass` already
 * allocates and already resizes, and both shaders keep the single-fetch
 * `NORMAL_VECTOR_TYPE = 1` path they use today. The body below is three's own
 * `computeNormalFromDepth` (GTAOShader.js) verbatim — same 9 taps, same
 * pick-the-continuous-side heuristic across the depth discontinuity — and the
 * result is packed `n * 0.5 + 0.5` because that is what `MeshNormalMaterial`
 * wrote and what `unpackRGBToNormal` on the other side expects. Only the SOURCE
 * of the normals changes; nothing downstream of the G-buffer moves.
 *
 * `USE_REVERSED_DEPTH_BUFFER` is injected by three's program builder for every
 * material when the renderer asks for it, exactly as it is for `GTAOShader`, so
 * this branch stays in step with the pass it feeds rather than assuming.
 */
const NORMAL_FROM_DEPTH_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const NORMAL_FROM_DEPTH_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tDepth;
uniform mat4 cameraProjectionMatrixInverse;

varying vec2 vUv;

vec3 getViewPosition(const in vec2 screenPosition, const in float depth) {
  #ifdef USE_REVERSED_DEPTH_BUFFER
    vec4 clipSpacePosition = vec4(vec2(screenPosition) * 2.0 - 1.0, depth, 1.0);
  #else
    vec4 clipSpacePosition = vec4(vec3(screenPosition, depth) * 2.0 - 1.0, 1.0);
  #endif
  vec4 viewSpacePosition = cameraProjectionMatrixInverse * clipSpacePosition;
  return viewSpacePosition.xyz / viewSpacePosition.w;
}

float fetchDepth(const ivec2 p) {
  return texelFetch(tDepth, p, 0).x;
}

void main() {
  vec2 size = vec2(textureSize(tDepth, 0));
  ivec2 p = ivec2(vUv * size);
  float c0 = fetchDepth(p);
  float l2 = fetchDepth(p - ivec2(2, 0));
  float l1 = fetchDepth(p - ivec2(1, 0));
  float r1 = fetchDepth(p + ivec2(1, 0));
  float r2 = fetchDepth(p + ivec2(2, 0));
  float b2 = fetchDepth(p - ivec2(0, 2));
  float b1 = fetchDepth(p - ivec2(0, 1));
  float t1 = fetchDepth(p + ivec2(0, 1));
  float t2 = fetchDepth(p + ivec2(0, 2));
  float dl = abs((2.0 * l1 - l2) - c0);
  float dr = abs((2.0 * r1 - r2) - c0);
  float db = abs((2.0 * b1 - b2) - c0);
  float dt = abs((2.0 * t1 - t2) - c0);
  vec3 ce = getViewPosition(vUv, c0).xyz;
  vec3 dpdx = (dl < dr)
    ?  ce - getViewPosition((vUv - vec2(1.0 / size.x, 0.0)), l1).xyz
    : -ce + getViewPosition((vUv + vec2(1.0 / size.x, 0.0)), r1).xyz;
  vec3 dpdy = (db < dt)
    ?  ce - getViewPosition((vUv - vec2(0.0, 1.0 / size.y)), b1).xyz
    : -ce + getViewPosition((vUv + vec2(0.0, 1.0 / size.y)), t1).xyz;
  gl_FragColor = vec4(normalize(cross(dpdx, dpdy)) * 0.5 + 0.5, 1.0);
}
`;

/**
 * A depth attachment the AO pass can SAMPLE.
 *
 * Handed to a scene-bound render target in place of the depth renderbuffer
 * three allocates by default when `depthBuffer` is true. `DEPTH_COMPONENT24`
 * either way, so this is the same storage under a name the shader can read —
 * not an extra buffer. `RenderTarget.setSize` does not touch an attached depth
 * texture, but `WebGLTextures.setupDepthTexture` corrects `image.width/height`
 * from the target's own size on every re-setup, so a resize needs nothing here.
 */
function makeSceneDepthTexture(name: string): THREE.DepthTexture {
  const d = new THREE.DepthTexture(1, 1);
  d.format = THREE.DepthFormat;
  d.type = THREE.UnsignedIntType;
  d.minFilter = THREE.NearestFilter;
  d.magFilter = THREE.NearestFilter;
  d.name = name;
  return d;
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

/**
 * WHAT A FRAME'S DRAW CALLS WERE ACTUALLY SPENT ON.
 *
 * `renderer.info.autoReset` is false and `beginFrame()` resets the counter once
 * per frame (see `renderer.ts`), so `renderer.info.render.calls` — the number
 * `shots/_report.json` publishes as `drawCalls`, and the number every budget
 * argument in this repo has quoted — is a SUM OVER EVERY SCENE SUBMISSION IN
 * THE FRAME. There are three: the shadow map, the colour pass, and GTAO's
 * normal prepass, which draws the whole scene a second time by design.
 *
 * `MAX_DRAW_CALLS` and `drawCalls` are therefore different quantities, and the
 * gap between them has been read as a budget overrun for several releases.
 * Instrumented at `renderBufferDirect`, `01-establishing-base`'s 219 is
 * 54 shadow + 78 colour + 67 AO prepass + 20 full-screen quads: the pass the
 * budget is about is 78, inside a total of 219.
 *
 * THE PREPASS IS GONE AND THE THIRD SUBMISSION WITH IT. `installAoDepthGBuffer`
 * gives GTAO the depth the colour pass already wrote, so the frame is two scene
 * submissions and a handful of quads. On the same fixture, measured the same
 * way: 53 shadow + 77 colour + 0 AO + 21 quads = 151, from 207. The `ao` bucket
 * stays because the prepass is still the fallback path — see the field itself.
 *
 * So the INSTRUMENT is split, not the renderer — nothing about the frame
 * changes. Four buckets, exhaustive by construction because `post` is the
 * residual: `shadow + colour + ao + post === total` always, and a meter that
 * stops firing shows up as an implausibly large `post` rather than as a total
 * that is quietly wrong.
 */
export interface DrawCallBreakdown {
  /** Shadow-map submissions. Once a frame — see `beginFrame()` in renderer.ts. */
  shadow: number;
  /** The main scene submission with the shadow map taken out. THIS is what `MAX_DRAW_CALLS` bounds. */
  colour: number;
  /**
   * GTAO's normal/depth prepass: the scene again, minus the non-occluders
   * filtered below.
   *
   * **ZERO ON EVERY SHIPPING PATH SINCE `installAoDepthGBuffer`**, which hands
   * the pass the scene's own depth texture and clears `_renderGBuffer`. It was
   * 39-57 across the thirteen capture fixtures — 26.8-29.4% of the frame — and
   * it is kept as a bucket rather than deleted for two reasons: the prepass is
   * still the fallback when a three upgrade moves the internals that wiring
   * needs, and a bucket that silently disappears takes the proof that it went
   * with it. A non-zero `ao` in `shots/_report.json` now means the fallback is
   * live and something should be looked at.
   */
  ao: number;
  /**
   * The residual — full-screen quads: AO's normal reconstruction and composite,
   * bloom's mip chain, grade, SMAA, copies.
   */
  post: number;
  /** The frame's `renderer.info.render.calls`, i.e. the figure the harness reports. */
  total: number;
}

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
  /**
   * Last frame's draw calls, split by pass. Live object, rewritten in place at
   * the end of every `render()` — copy it before handing it anywhere.
   */
  readonly drawCallsByPass: Readonly<DrawCallBreakdown>;

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
  /** Set by `rebuild()`; consumed by `render()`, which warms up first. */
  let chainDirty = false;
  /**
   * Live mirror of `cfg.ao.halfRes`, read by the `setSize` wrapper. Kept beside
   * the pass rather than read from config inside the wrapper so that flipping
   * the flag is a single, observable transition in `applyAoConfig`.
   */
  let aoHalfRes = cfg.ao.halfRes;
  /**
   * The quad material that fills the AO normal target from the scene's depth.
   * Null while the AO pass is SSAO, or while the depth G-buffer could not be
   * installed and the normal prepass is still doing the job.
   */
  let normalFromDepthMaterial: THREE.ShaderMaterial | null = null;

  const width = () => Math.max(2, handle.size.width);
  const height = () => Math.max(2, handle.size.height);

  /* ---- draw-call attribution (see `DrawCallBreakdown`) ------------------- */
  /**
   * ONE record, rewritten in place at the end of every frame. `stats()` copies
   * it; this file never reallocates it, because everything below runs inside the
   * frame loop and the zero-allocation rule applies there.
   */
  const drawCallsByPass: DrawCallBreakdown = { shadow: 0, colour: 0, ao: 0, post: 0, total: 0 };
  /** `renderer.info.render.calls` when this frame's real drawing began. */
  let callsAtFrameStart = 0;
  /** Accumulators, zeroed per frame by `beginDrawCallFrame`. */
  let shadowCalls = 0;
  let sceneCalls = 0;
  let aoCalls = 0;
  /** The pair of marks the AO prepass meter brackets its window with. */
  let aoMarkCalls = 0;
  let aoMarkShadow = 0;

  function beginDrawCallFrame(): void {
    // A DELTA rather than an absolute, so the accounting still adds up on the
    // paths that draw without `handle.beginFrame()` having reset the counter.
    callsAtFrameStart = renderer.info.render.calls;
    shadowCalls = 0;
    sceneCalls = 0;
    aoCalls = 0;
  }

  function endDrawCallFrame(): void {
    const total = renderer.info.render.calls - callsAtFrameStart;
    drawCallsByPass.shadow = shadowCalls;
    drawCallsByPass.colour = sceneCalls;
    drawCallsByPass.ao = aoCalls;
    // The residual, deliberately — see the interface's own doc for why the four
    // buckets are exhaustive rather than merely hopeful.
    drawCallsByPass.post = total - shadowCalls - sceneCalls - aoCalls;
    drawCallsByPass.total = total;
  }

  /*
   * COUNT THE SHADOW PASS SEPARATELY, WITHOUT MOVING IT.
   *
   * `WebGLRenderer.render` calls `shadowMap.render` before it submits the scene,
   * so from the composer's side the shadow draws and the colour draws arrive as
   * one number. This is the only seam between them. The wrapper is read-only —
   * two counter reads and a forward — and it is what lets `colour` be the figure
   * `MAX_DRAW_CALLS` is actually about.
   *
   * Restored in `dispose()`: a second chain built over the same renderer would
   * otherwise stack one wrapper per boot and count the same draws N times.
   */
  const shadowMap = renderer.shadowMap;
  const baseShadowRender = shadowMap.render;
  shadowMap.render = function meteredShadowRender(
    lights: THREE.Light[], sc: THREE.Scene, cam: THREE.Camera,
  ): void {
    const before = renderer.info.render.calls;
    baseShadowRender.call(shadowMap, lights, sc, cam);
    shadowCalls += renderer.info.render.calls - before;
  };

  /**
   * The colour pass, with the shadow map that three renders inside it taken back
   * out. Installed OUTSIDE `installSceneMsaaResolve`, so the MSAA transfer quad —
   * one draw, and only while MSAA is on — is counted with the scene it serves
   * rather than with the post quads.
   */
  function installSceneCallMeter(pass: RenderPass): void {
    const p = pass as unknown as {
      render(
        r: THREE.WebGLRenderer,
        writeBuffer: THREE.WebGLRenderTarget,
        readBuffer: THREE.WebGLRenderTarget,
        deltaTime: number,
        maskActive: boolean,
      ): void;
    };
    const base = p.render.bind(p);
    p.render = function meteredSceneRender(r, writeBuffer, readBuffer, deltaTime, maskActive) {
      const before = renderer.info.render.calls;
      const shadowBefore = shadowCalls;
      base(r, writeBuffer, readBuffer, deltaTime, maskActive);
      sceneCalls += (renderer.info.render.calls - before) - (shadowCalls - shadowBefore);
    };
  }

  /* ---- MSAA state (see the file header) --------------------------------- */
  /** Driver cap on `samples`, read once at construction. 0 = no MSAA possible. */
  let maxSamples = 0;
  /** The one multisampled target in this file. `null` whenever MSAA is off. */
  let sceneMsaa: THREE.WebGLRenderTarget | null = null;
  let resolveMaterial: THREE.ShaderMaterial | null = null;
  let resolveQuad: FullScreenQuad | null = null;
  /** Samples currently ALLOCATED on `sceneMsaa`, not what config asked for. */
  let msaaSamples = 0;

  /* ---- composer + HDR targets ------------------------------------------ */
  try {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    maxSamples = typeof gl.getParameter === 'function' && 'MAX_SAMPLES' in gl
      ? (gl.getParameter(gl.MAX_SAMPLES) as number) : 0;

    const rt = new THREE.WebGLRenderTarget(width(), height(), {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace, // working (linear) space, not display
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      /*
       * NEVER NON-ZERO. `EffectComposer` CLONES this target to make the second
       * half of its ping-pong pair, and `WebGLRenderTarget.copy` copies
       * `samples` — so a number here multisamples every buffer the post chain
       * ever writes into, and every pass then pays a resolve. That is the
       * regression documented at length in the file header, and this literal is
       * the whole of the fix. Geometric AA lives on `sceneMsaa` instead.
       */
      samples: 0,
    });
    rt.texture.name = 'PostHDR';
    composer = new EffectComposer(renderer, rt);
    composer.renderToScreen = true;

    /*
     * BOTH HALVES OF THE PING-PONG, BECAUSE THE SCENE LANDS IN EITHER ONE.
     *
     * `EffectComposer.render()` does not reset `readBuffer` at the top of a
     * frame, and this chain swaps an ODD number of times (bloom, grade, SMAA;
     * render and AO both declare `needsSwap = false`), so the target
     * `RenderPass` draws into alternates between `renderTarget1` and
     * `renderTarget2` frame by frame. Attaching to one of them would give the
     * AO pass a correct depth buffer every other frame and a stale one in
     * between — a flicker, not a crash, which is the worst kind.
     *
     * Two textures rather than one shared between the pair: three records
     * `properties.get(depthTexture).__renderTarget`, i.e. a depth texture
     * belongs to one target, and the AO wrapper reads the depth off the buffer
     * it is actually handed rather than off a module variable that has to be
     * kept in step. Neither costs memory — `depthBuffer: true` above already
     * allocated a full-resolution depth attachment on each.
     */
    composer.renderTarget1.depthTexture = makeSceneDepthTexture('SceneDepth1');
    composer.renderTarget2.depthTexture = makeSceneDepthTexture('SceneDepth2');
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
      // Installed unconditionally and inert while `sceneMsaa` is null, so the
      // settings toggle never has to re-wrap a live pass.
      installSceneMsaaResolve(p);
      // Outermost, so it sees the resolve transfer too. See `DrawCallBreakdown`.
      installSceneCallMeter(p);
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
      const p = new ShaderPass({
        name: 'GradePass',
        uniforms: makeGradeUniforms() as unknown as { [k: string]: THREE.IUniform },
        vertexShader: GRADE_VERT,
        fragmentShader: GRADE_FRAG,
      });
      /*
       * THE HANDLE MUST COME BACK OUT OF THE PASS, NOT GO INTO IT.
       *
       * `ShaderPass` handed a plain shader DESCRIPTION does
       * `this.uniforms = UniformsUtils.clone( shader.uniforms )` — a deep copy.
       * (It aliases only when handed a real `ShaderMaterial`.) This block used
       * to keep the object it passed in, so `gradeUniforms` pointed at a
       * detached copy and EVERY write to it went nowhere: `syncConfig`, the
       * `uTexel` write in `setSize`, and the per-frame `uTime`.
       *
       * The grade therefore ran, for its entire life, on the literals in
       * `makeGradeUniforms()`. Read live off a booted `07-soviet-base`:
       *
       *     uShadowTint  (1,1,1)      uMidTint (1,1,1)   uHighTint (1,1,1)
       *     uLift        (0,0,0)      uGain    (1,1,1)
       *     uGrain       0.016        uCA      0.0016
       *     uTexel       (1/1920, 1/1080)  at a 2560x1440 buffer
       *     uTime        0
       *
       * against a `RENDER_CONFIG.post.grade` that correctly held shadowTint
       * #4F5667, lift #06090F, gain #FFF6E8, grain 0 and CA 0. Four separate
       * defects, none of which announced itself:
       *
       *  1. The WHOLE 3-way colour balance was a no-op. Every measurement in
       *     the `shadowTint` block of `config.ts` — three values, each with a
       *     scorecard #9 number attached — moved a uniform the shader never
       *     saw. So did `lift` and `gain`.
       *  2. GRAIN AND CHROMATIC ABERRATION WERE BOTH LIVE. Both are banned by
       *     name in CLAUDE.md and RA3_LOOK_BIBLE.md §4.6, both were turned off
       *     in config by `docs/SPEC_DRIFT_AUDIT.md` finding 8, and both kept
       *     running because turning them off in config reached nothing.
       *     `tools/metrics.mjs` #36 (R/B edge misregistration) read 0.78-1.02
       *     against RA3's measured 0.512 and nobody could account for it: that
       *     was uCA 0.0016, exactly as designed, on a pass that should be dead.
       *  3. The unsharp mask sampled on a 1920x1080 texel grid at 1440p.
       *  4. `uTime` never advanced, which is the only reason the grain was not
       *     caught by the shot harness — a frozen hash pattern is
       *     byte-identical run to run, so `tools/shoot.mjs` reported stability
       *     over an effect that is banned precisely because it is unstable.
       *
       * The scalars hid all of it: every literal above except grain, CA, texel
       * and time is EXACTLY the `TONE_NOON` value, so exposure, contrast,
       * saturation, shadowSaturation, vignette, sharpen and the tone mode all
       * read back correct and the pass looked synced.
       *
       * Do not "tidy" this by assigning `gradeUniforms` before the `new`.
       */
      gradeUniforms = p.uniforms as unknown as GradeUniforms;
      return p as unknown as Pass;
    });

    build('smaa', () => {
      // `SMAAPass` takes NO constructor arguments in three 0.185 (it sizes
      // itself from `setSize`). The old two-argument cast still compiled and
      // still worked, because the extras were ignored — but a cast that hides a
      // signature change is how the next upgrade breaks silently.
      const p = new SMAAPass() as unknown as Pass;
      demoteSmaaTargets(p);
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
        /*
         * The occluder filter and the prepass meter are installed FIRST and
         * UNCONDITIONALLY, and `installAoDepthGBuffer` then tries to delete the
         * prepass they describe. When it succeeds — the shipping path — three
         * never calls `_overrideVisibility`, so neither fires and `ao` reports
         * 0. When it fails, because a three upgrade moved one of the six
         * internals it needs, the prepass is still there and must still be
         * filtered or the black decal polygons come straight back. Installing
         * them the other way round would make the fallback the unfiltered one.
         */
        installAoOccluderFilter(p);
        // After the filter, so the mark is taken once the traverse (which draws
        // nothing) is done and the window holds only the prepass itself.
        installAoPrepassMeter(p);
        const fromDepth = installAoDepthGBuffer(p);
        installAoResolutionScale(p);
        installAoInPlaceComposite(p);
        if (DEV) {
          console.info(
            `[post] AO: GTAO @ ${ao.width}x${ao.height}` +
            (fromDepth ? ' (normals from scene depth, no prepass)' : ' (normal prepass — depth G-buffer unavailable)')
          );
        }
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

  /* ======================================================================= */
  /* MSAA: the scene pass, and only the scene pass                           */
  /* ======================================================================= */

  /**
   * DRAW THE SCENE INTO THE MULTISAMPLED TARGET, THEN MOVE IT ONCE.
   *
   * `RenderPass.render` draws into whatever it is handed as `readBuffer` (it has
   * `needsSwap = false`, so the composer leaves the result there for the next
   * pass to read). All this wrapper does is hand it `sceneMsaa` instead, then
   * transfer the result to where the composer expects it.
   *
   * The RESOLVE is not this function's doing and is not the quad below: three
   * blits the multisample renderbuffers into `sceneMsaa.texture` at the end of
   * the `renderer.render()` inside `base(...)`. By the time the quad runs it is
   * sampling an ordinary single-sampled texture. One bind, one resolve — see the
   * file header for why that count is the entire point of the exercise.
   *
   * `renderToScreen` is forced off across `base` because `RenderPass` reads it
   * to decide between `null` and its `readBuffer` argument, and the whole idea
   * is that the scene never goes straight to the default framebuffer. The
   * original value still decides where the TRANSFER lands, so the degenerate
   * "render is the only enabled pass" chain keeps its antialiasing instead of
   * silently falling back to an aliased direct draw.
   *
   * Inert, with a single null check, whenever MSAA is off — which is the default
   * and every quality tier.
   */
  function installSceneMsaaResolve(pass: RenderPass): void {
    const p = pass as unknown as {
      renderToScreen: boolean;
      render(
        r: THREE.WebGLRenderer,
        writeBuffer: THREE.WebGLRenderTarget,
        readBuffer: THREE.WebGLRenderTarget,
        deltaTime: number,
        maskActive: boolean,
      ): void;
    };
    const base = p.render.bind(p);

    p.render = function msaaSceneRender(r, writeBuffer, readBuffer, deltaTime, maskActive) {
      const target = sceneMsaa;
      const quad = resolveQuad;
      const mat = resolveMaterial;
      if (target === null || quad === null || mat === null) {
        base(r, writeBuffer, readBuffer, deltaTime, maskActive);
        return;
      }

      const toScreen = p.renderToScreen;
      p.renderToScreen = false;
      try {
        base(r, writeBuffer, target, deltaTime, maskActive);
      } finally {
        p.renderToScreen = toScreen;
      }

      mat.uniforms.tDiffuse.value = target.texture;
      r.setRenderTarget(toScreen ? null : readBuffer);
      quad.render(r);
    };
  }

  /** Free the MSAA target and its transfer quad. Safe to call when already off. */
  function disposeMsaa(): void {
    // Explicit: `RenderTarget.dispose()` releases the target, not a texture the
    // caller attached to it.
    sceneMsaa?.depthTexture?.dispose();
    sceneMsaa?.dispose();
    sceneMsaa = null;
    resolveQuad?.dispose();
    resolveQuad = null;
    resolveMaterial?.dispose();
    resolveMaterial = null;
  }

  /**
   * Bring `sceneMsaa` in line with `cfg.msaaSamples`.
   *
   * A sample count cannot be changed on a live framebuffer, so a change here is
   * an allocate-or-free, which is why it is a TRANSITION check and not a
   * per-frame assignment. It is safe to do synchronously — unlike the deferred
   * resize below, nothing is disposed that the current frame is mid-way through
   * reading, because config listeners fire from DOM event handlers rather than
   * from inside `composer.render()`. `chainDirty` is still set, so `warmUp()`
   * draws one full frame through the new arrangement — which is what compiles
   * the transfer quad's program and allocates its target — ahead of the normal
   * `composer.render()` for the tick.
   *
   * The settings row for this used to say "takes effect after a restart", which
   * was true only because the samples went onto the composer's own target. They
   * do not any more.
   */
  function applyMsaaConfig(): void {
    const want = composer === null ? 0 : msaaSampleCount(cfg.msaaSamples, maxSamples);
    if (want === msaaSamples) return;
    msaaSamples = want;
    disposeMsaa();

    if (want > 0) {
      const w = appliedW > 0 ? appliedW : width();
      const h = appliedH > 0 ? appliedH : height();
      // Same descriptor as the composer target — the transfer must not change
      // format, type or colour space, or the grade would be reading a different
      // number than the scene wrote.
      sceneMsaa = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.NoColorSpace,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
        samples: want,
        /*
         * THE MSAA HALF OF THE AO G-BUFFER, AND IT HAS TO BE HERE RATHER THAN
         * ON THE COMPOSER TARGETS.
         *
         * With MSAA on, the scene is drawn into THIS target, so this is the
         * only depth that describes it. The composer's read buffer receives a
         * colour-only transfer quad, and `FullScreenQuad.render` goes through
         * `renderer.render`, which clears — so the depth on the read buffer at
         * AO time is a cleared 1.0, not the scene.
         *
         * A multisampled depth attachment cannot be sampled, and this one is
         * not the one that gets sampled: three attaches the TEXTURE to the
         * single-sample framebuffer and a multisample depth RENDERBUFFER to the
         * multisampled one, then `updateMultisampleRenderTarget` blits with
         * `DEPTH_BUFFER_BIT` set whenever `resolveDepthBuffer && depthBuffer`
         * (both default true). So the texture holds resolved depth by the time
         * `renderer.render()` returns — the same one resolve the file header
         * counts, carrying depth as well as colour.
         */
        depthTexture: makeSceneDepthTexture('SceneMSAADepth'),
      });
      sceneMsaa.texture.name = 'SceneMSAA';
      resolveMaterial = new THREE.ShaderMaterial({
        name: 'MsaaResolvePass',
        uniforms: { tDiffuse: { value: null } },
        vertexShader: RESOLVE_VERT,
        fragmentShader: RESOLVE_FRAG,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
      resolveQuad = new FullScreenQuad(resolveMaterial);
    }

    chainDirty = true;
    if (DEV) {
      console.info(
        want > 0
          ? `[post] MSAA: scene target at ${want}x (driver max ${maxSamples}), one resolve`
          : '[post] MSAA: off — the scene renders straight into the composer buffer'
      );
    }
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
   * DELETE GTAO'S SECOND RENDER OF THE SCENE.
   *
   * The reasoning is at `NORMAL_FROM_DEPTH_FRAG`; this is the wiring. Three
   * things happen, and all three are needed:
   *
   *  1. `setGBuffer(depth, normal)` sets `_renderGBuffer = false`, which is the
   *     one flag standing between this chain and 39-57 draw calls a frame. The
   *     arguments only have to be non-undefined for the defines it derives —
   *     `NORMAL_VECTOR_TYPE = 1` because a normal texture was supplied, and
   *     `DEPTH_SWIZZLING = 'x'` because depth and normal are different textures
   *     — so the depth handed here is a representative, not the live one.
   *  2. The live depth is bound per frame, off the buffer the scene was
   *     ACTUALLY drawn into: `sceneMsaa` when MSAA is on, otherwise the
   *     `readBuffer` the composer handed this pass. Never a captured variable;
   *     see the note on the ping-pong at the composer's construction.
   *  3. The normal target is filled by one full-screen quad instead of a scene
   *     submission, through GTAOPass's own `_renderPass` helper, so the clear
   *     and the `autoClear` save/restore are the ones the rest of the pass uses.
   *
   * WHAT THE AO NOW CONSIDERS AN OCCLUDER, AND WHAT THAT COST. The old G-buffer
   * was a filtered scene (`aoOccluder` below). The new one is the depth buffer
   * the frame already wrote, so the occluder set is exactly "everything that
   * writes depth in the main pass" and the filter cannot reach it. Two objects
   * change side, and both were deliberate exclusions:
   *
   *   - WATER. `WaterMaterial` is the only transparent material in the game
   *     with `depthWrite: true`, so the sea surface was absent from the old
   *     G-buffer and is present in the new one.
   *   - BUILDING PADS. `userData.vmAoOccluder = false` kept 40 mm of slab out of
   *     the old G-buffer. It is opaque and depth-writing, so it is in the new
   *     one.
   *
   * Neither can be filtered out of a depth buffer that the colour pass wrote:
   * what is behind them was overwritten, and recovering it means submitting the
   * scene again, which is the cost being removed.
   *
   * THE WATER CASE WAS THE PREDICTED REGRESSION AND IT IS AN IMPROVEMENT, which
   * is worth stating plainly because the prediction was reasonable and wrong.
   * The fear was that an opaque sea surface would delete the seabed's AO. What
   * it actually deletes is the OLD defect: `aoOccluder`'s own rule, three
   * paragraphs down, is that an excluded mesh's pixels sample whatever depth is
   * BEHIND them, and it is only free "for anything within a few centimetres of
   * the surface behind it". The sea is metres above its bed, so every water
   * pixel was reading the seabed's occlusion — the umbrella defect, on the
   * whole ocean. Measured as mean |delta| against an AO-disabled capture of the
   * same build, i.e. how much AO the frame actually receives:
   *
   *                          prepass   depth G-buffer
   *     08-naval-water        2.1427       2.4826
   *     13-atoll-crossing     1.7485       2.1786
   *     01-establishing-base  3.5431       3.5204
   *
   * The two naval fixtures GAIN AO; the land fixtures are unchanged inside a
   * percent. On screen the gain is a contact shadow at every hull's waterline,
   * which the prepass could not produce at all — a warship used to sit ON the
   * sea rather than in it. The weighted grade is 0.892308 with 16 failures
   * either way, unchanged to six decimals, which is the scorecard behaving
   * exactly as `tools/shot-compare.mjs`'s header says it does.
   *
   * Pads were re-checked the same way and are benign: a 40 mm slab at the
   * fixtures' camera distance is sub-pixel relief, and an A/B crop across a pad
   * edge on `08-naval-water` peaks at 44/255 with no fringe.
   *
   * `aoOccluder` and its opt-out stay because they still govern the fallback
   * prepass, and only because of that.
   *
   * Returns false, having changed nothing, if any internal it needs is missing:
   * a half-installed G-buffer is a black or inverted AO term, and the prepass it
   * would have replaced still works.
   */
  function installAoDepthGBuffer(pass: unknown): boolean {
    const p = pass as {
      camera: THREE.Camera;
      normalRenderTarget?: THREE.WebGLRenderTarget;
      gtaoMaterial?: THREE.ShaderMaterial;
      pdMaterial?: THREE.ShaderMaterial;
      setGBuffer?(depthTexture: THREE.DepthTexture, normalTexture: THREE.Texture): void;
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

    const normalTarget = p.normalRenderTarget;
    const gtao = p.gtaoMaterial;
    const pd = p.pdMaterial;
    const setGBuffer = p.setGBuffer;
    const renderPass = p._renderPass;
    const seedDepth = composer?.renderTarget1.depthTexture ?? null;
    if (
      normalTarget === undefined || gtao === undefined || pd === undefined ||
      typeof setGBuffer !== 'function' || typeof renderPass !== 'function' ||
      seedDepth === null
    ) {
      if (DEV) console.warn('[post] AO depth G-buffer unavailable — keeping the normal prepass');
      return false;
    }

    setGBuffer.call(p, seedDepth, normalTarget.texture);

    normalFromDepthMaterial = new THREE.ShaderMaterial({
      name: 'AoNormalFromDepth',
      uniforms: {
        tDepth: { value: seedDepth },
        cameraProjectionMatrixInverse: { value: new THREE.Matrix4() },
      },
      vertexShader: NORMAL_FROM_DEPTH_VERT,
      fragmentShader: NORMAL_FROM_DEPTH_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const normalMat = normalFromDepthMaterial;

    const baseRender = p.render.bind(p);
    const doPass = renderPass.bind(p);

    p.render = function depthGBufferRender(renderer_, writeBuffer, readBuffer, deltaTime, maskActive) {
      // The scene's own depth, from whichever target it was drawn into.
      const depth = (sceneMsaa !== null ? sceneMsaa.depthTexture : readBuffer.depthTexture) ?? seedDepth;
      normalMat.uniforms.tDepth.value = depth;
      gtao.uniforms.tDepth.value = depth;
      pd.uniforms.tDepth.value = depth;
      // `.copy` into the matrix allocated once above — this runs in the frame loop.
      (normalMat.uniforms.cameraProjectionMatrixInverse.value as THREE.Matrix4)
        .copy(p.camera.projectionMatrixInverse);
      doPass(renderer_, normalMat, normalTarget);
      baseRender(renderer_, writeBuffer, readBuffer, deltaTime, maskActive);
    };

    return true;
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
  /**
   * SMAA's two internal targets hold 0..1 MASKS. Give them 8 bits.
   *
   * `SMAAPass` hardcodes `HalfFloatType` on `_edgesRT` and `_weightsRT`. Neither
   * is an image: `_edgesRT` is a two-channel edge mask and `_weightsRT` is the
   * blend-weight lookup, both defined on 0..1, and Jimenez et al. specify RG8
   * and RGBA8 for exactly these. Sixteen bits per channel buys no precision
   * anything downstream can use, and costs the bandwidth twice — once writing
   * each target, once reading it back in the next sub-pass.
   *
   * WHY THIS IS WORTH DOING AT ALL: SMAA measured at 5.36 ms on the reference
   * iGPU, the second-largest cost in the chain and larger than bloom and grade
   * combined, on a frame that profiling showed is bandwidth-bound rather than
   * draw-call-bound. Four full-resolution surfaces halve, 29.5 MB to 14.75 MB
   * each at 2560x1440.
   *
   * THE PRECONDITION, AND IT IS LOAD-BEARING: this is only correct because SMAA
   * runs LAST, on the LDR sRGB image the grade pass has already encoded. Its
   * inputs are display-referred and already 8-bit-representable. Move SMAA
   * earlier in `PASS_ORDER` — anywhere it would see scene-linear HDR — and
   * these targets must go back to half-float. `tests/post-chain.spec.ts` pins
   * the ordering next to this reasoning so the two cannot drift apart.
   *
   * `SMAAPass.setSize` only forwards to the targets' own `setSize`, so
   * replacing the objects here is enough; `applyPendingSize` keeps working.
   */
  function demoteSmaaTargets(pass: unknown): void {
    const p = pass as {
      _edgesRT?: THREE.WebGLRenderTarget;
      _weightsRT?: THREE.WebGLRenderTarget;
    };
    const edges = p._edgesRT;
    const weights = p._weightsRT;
    // Renamed or restructured upstream: leave the pass exactly as three built
    // it rather than half-applying this.
    if (edges === undefined || weights === undefined) {
      if (DEV) console.warn('[post] SMAA internals not found — targets left half-float');
      return;
    }

    const swap = (
      old: THREE.WebGLRenderTarget, name: string,
    ): THREE.WebGLRenderTarget => {
      const next = new THREE.WebGLRenderTarget(old.width, old.height, {
        type: THREE.UnsignedByteType,
        // A mask needs neither, and both are full-resolution attachments.
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: old.texture.minFilter,
        magFilter: old.texture.magFilter,
        // Format is deliberately left at the default RGBA rather than copied.
        // `texture.format` is typed `AnyPixelFormat`, which admits compressed
        // formats a render target cannot take, and SMAA's own targets are
        // plain RGBA anyway — the saving here is the TYPE, not the channels.
      });
      next.texture.name = name;
      old.dispose();
      return next;
    };

    p._edgesRT = swap(edges, 'SMAA.edges');
    p._weightsRT = swap(weights, 'SMAA.weights');
  }

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
   * The cache `hideAoNonOccluders` pushes into, handed over for the duration of a
   * single `_overrideVisibility` call. A handoff rather than a captured argument
   * because the callback is created ONCE, at chain construction, and the traverse
   * below runs every frame — see the block on the filter itself.
   *
   * Declared BEFORE the filter that assigns it: `build('ao')` runs during
   * construction, so a `let` further down the file would be in its temporal dead
   * zone if anything ever rendered a prepass before construction finished.
   */
  let aoVisibilityCache: THREE.Object3D[] | null = null;

  /** The object flags this filter reads. None of them are declared on `Object3D`. */
  type AoCandidate = THREE.Object3D & {
    readonly isPoints?: boolean;
    readonly isLine?: boolean;
    readonly isLine2?: boolean;
    readonly isMesh?: boolean;
  };

  const hideAoNonOccluders = (o: THREE.Object3D): void => {
    if (!o.visible) return;
    const c = o as AoCandidate;
    /*
     * GTAOPass's own rule, reproduced: points and lines carry no meaningful
     * normal, so they must not contribute to AO. Tested BEFORE `isMesh` because
     * `Line2` extends `LineSegments2` extends `Mesh` — it answers true to both,
     * and the old two-traverse arrangement gave the line rule first look at it.
     */
    const lineish = c.isPoints === true || c.isLine === true || c.isLine2 === true;
    if (!lineish) {
      if (c.isMesh !== true) return;
      if (aoOccluder(o as THREE.Mesh)) return;
    }
    o.visible = false;
    aoVisibilityCache?.push(o);
  };

  /**
   * KEEP NON-OCCLUDERS OUT OF THE AO NORMAL/DEPTH PREPASS.
   *
   * SCOPE, FIRST, BECAUSE IT NARROWED. `installAoDepthGBuffer` deletes the
   * prepass on every path where three's internals are where this file expects
   * them, and `_overrideVisibility` is the prepass's own fence — so on the
   * shipping path NOTHING BELOW RUNS, and `userData.vmAoOccluder` does not
   * affect a shipped pixel. What governs the AO now is the main pass's depth
   * buffer, i.e. `depthWrite`, and the two objects that changed side as a result
   * are named in `installAoDepthGBuffer`. This is kept, working and tested,
   * because the prepass is what a three upgrade falls back to, and an
   * unfiltered prepass is the black-polygon defect described next. Do not read
   * it as the live occluder rule.
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
   *
   * ONE TRAVERSE, NOT TWO, AND ONE CALLBACK FOR THE LIFE OF THE CHAIN. This used
   * to delegate to `base` and then walk the scene AGAIN with a fresh arrow — two
   * full traverses of ~300 nodes and two closures allocated per frame, inside the
   * frame loop, which the project forbids. `base`'s own rule (hide visible
   * Points/Line/Line2, push them to the cache) is four lines and is reproduced
   * in `hideAoNonOccluders` just above, so the SET of hidden objects is
   * identical to what the pair produced; only the push order differs, and
   * `_restoreVisibility` just walks the cache setting `visible = true`. `base` is
   * still resolved and type-checked, because a GTAOPass without
   * `_overrideVisibility` is a version whose prepass this file cannot filter at
   * all, and installing half of this would be worse than installing none.
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
      const cache = this._visibilityCache;
      if (cache === undefined) {
        // Shape drift: let three do whatever it now does, and filter nothing.
        base.call(this);
        return;
      }
      aoVisibilityCache = cache;
      this.scene.traverse(hideAoNonOccluders);
      aoVisibilityCache = null;
    };
  }

  function aoOccluder(mesh: THREE.Mesh): boolean {
    /*
     * THE OPT-OUT, and it is a statement about geometry rather than a hint.
     * A mesh whose author knows it must not occlude — a batched sheet that lies
     * on the ground, anything whose depth is a lie — stamps
     * `userData.vmAoOccluder = false` and drops out of BOTH halves of the
     * G-buffer, because the traverse above flips `visible` and pushes to
     * GTAOPass's own `_visibilityCache`. Those pixels then sample the terrain
     * depth beneath, which is exactly the decal precedent this filter was
     * written for. STRICT `=== false`: an unset `userData` — every mesh in the
     * game bar the few that ask — keeps the behaviour it has always had.
     *
     * THE RULE FOR DECIDING WHO MAY OPT OUT, measured rather than argued.
     * An excluded mesh's pixels sample whatever depth is BEHIND it. For a 40 mm
     * pad or a decal sheet that is the terrain it lies on, so the substitution
     * is very nearly exact and the exclusion is free. For anything standing
     * PROUD of the ground it is wrong by the object's whole height, and the
     * background's occlusion gets painted onto the object: an A/B over the
     * thirteen fixtures put a ragged dark fringe along a cafe umbrella's top
     * edge at max delta 171/255 and a grey smear across the lit top faces of a
     * crate stack.
     *
     * So the test is NOT "is this thing small" — it is "is this thing within a
     * few centimetres of the surface behind it". Scatter props fail that test
     * and were measured and REJECTED (`tools/shot-compare.mjs`, and the branch
     * `scatter-ao-occluder-ab` holds the diff and the crops): excluding all 22
     * types saves 14-22 draws a frame and moves the scorecard by nothing, but
     * costs the props their ground contact, which nothing else supplies —
     * `contact-shadows.system.ts` reads the ENTITY store and scatter props are
     * not entities. The route that gets those draws honestly is to give them
     * the contact-decal layer bible §3.3 prescribes and THEN exclude them.
     */
    if (mesh.userData.vmAoOccluder === false) return false;
    if (mesh.layers.isEnabled(LAYERS.EFFECTS) || mesh.layers.isEnabled(LAYERS.OVERLAY)) return false;
    // Branch rather than `Array.isArray(mat) ? mat : [mat]`: that wrapper
    // allocated a one-element array for every single-material mesh in the scene,
    // every frame, and this runs from `_overrideVisibility` at GTAOPass.js:504.
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      for (let i = 0; i < mat.length; i++) {
        if (!materialOccludes(mat[i])) return false;
      }
      return true;
    }
    return materialOccludes(mat);
  }

  /** One material's half of `aoOccluder`. A null slot disqualifies nothing. */
  function materialOccludes(m: THREE.Material | null | undefined): boolean {
    if (m === undefined || m === null) return true;
    if (m.transparent === true || m.depthWrite === false) return false;
    return m.blending === THREE.NormalBlending || m.blending === THREE.NoBlending;
  }

  /**
   * Bracket GTAO's normal/depth prepass, which USED TO BE the second of the
   * frame's three scene submissions and the one nobody expected.
   * `_overrideVisibility` and `_restoreVisibility` are the pass's own fences
   * around it (GTAOPass.js:504-506) — nothing else needs hooking, and nothing
   * about the frame changes.
   *
   * It is the same fence `installAoDepthGBuffer` removes the need for, so on the
   * shipping path this meter never fires and `drawCallsByPass.ao` is 0 — which
   * is the measurement, not a gap in it. Left installed so that a fallback to
   * the prepass is VISIBLE in `shots/_report.json` rather than silent.
   *
   * The shadow delta is subtracted for the same reason it is in the colour meter:
   * whichever submission happens to rebuild the shadow map, those draws belong to
   * `shadow` and must not be counted twice.
   */
  function installAoPrepassMeter(pass: unknown): void {
    const p = pass as {
      _overrideVisibility?: () => void;
      _restoreVisibility?: () => void;
    };
    const over = p._overrideVisibility;
    const restore = p._restoreVisibility;
    // Both or neither: a start mark with no end would leave `ao` at 0 and quietly
    // inflate the `post` residual instead.
    if (typeof over !== 'function' || typeof restore !== 'function') return;

    p._overrideVisibility = function meteredOverride(this: typeof p): void {
      over.call(this);
      aoMarkCalls = renderer.info.render.calls;
      aoMarkShadow = shadowCalls;
    };
    p._restoreVisibility = function meteredRestore(this: typeof p): void {
      restore.call(this);
      aoCalls += (renderer.info.render.calls - aoMarkCalls) - (shadowCalls - aoMarkShadow);
    };
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
   * Called at construction, and again before presenting whenever the pass list
   * changes. It forces every program in the arrangement to compile and every
   * ping-pong target to be allocated and written, so the frame that actually
   * reaches the screen is a finished one. Without it, the first frame after a
   * reorder can present a target that was allocated this tick and never drawn
   * into — black.
   *
   * IT SET THE WRONG FLAG, AND SO IT WAS NEVER OFFSCREEN AT ALL.
   * ------------------------------------------------------------
   * The original cleared `renderToScreen` on the TAIL PASS. That flag does not
   * survive contact with `EffectComposer.render()`, whose loop opens with
   *
   *     pass.renderToScreen = ( this.renderToScreen && this.isLastEnabledPass( i ) );
   *
   * — every pass, every frame, unconditionally. So the value written here was
   * overwritten before the pass it belonged to ever ran, `this.renderToScreen`
   * was `true` (set at construction, never touched since), and the "throwaway"
   * frame went straight to the DEFAULT FRAMEBUFFER. Two consequences, both the
   * opposite of the intent: the tail pass blitted a frame nobody asked for onto
   * the canvas, and the offscreen target the comment promised was "allocated
   * and written" was the one thing the chain skipped writing.
   *
   * `rebuild()`'s `p.renderToScreen` writes are overwritten by the same line and
   * are therefore decorative; they are harmless and left alone. THIS one was
   * load-bearing, so it moves up to the composer-level flag, which is the only
   * one that loop reads.
   */
  function warmUp(): void {
    if (!composer || composer.passes.length === 0) return;
    // A lost context makes every draw below a no-op that still costs the frame.
    if (handle.isContextLost()) return;
    const wasScreen = composer.renderToScreen;
    composer.renderToScreen = false;
    try {
      composer.render(1 / 60);
    } catch (err) {
      console.warn('[post] warm-up frame failed; presenting anyway', err);
    } finally {
      composer.renderToScreen = wasScreen;
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
      // `lensDirt` used to be read here, and the only thing it ever did was
      // decide whether to print this console.info — UnrealBloomPass has no dirt
      // uniform to feed. RA3_LOOK_BIBLE.md §11 bans lens dirt by name, so the
      // field is deleted rather than wired; tests/banned-effects.spec.ts now
      // scans for it so it cannot come back as a configured no-op.
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
    applyMsaaConfig();

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
    // `composer.setSize` only knows about its own pair and its passes. The MSAA
    // scene target is ours, so it resizes here or it stays at the boot size and
    // the transfer quad stretches a stale image over the frame.
    sceneMsaa?.setSize(pw, ph);
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

  /*
   * COMPILE HERE, WHERE NOBODY IS LOOKING.
   *
   * `warmUp()` was only ever reachable from `render()`, i.e. from INSIDE the
   * first frame the player sees — so the hitch it exists to prevent was being
   * paid at exactly the moment it was supposed to be hidden, and paid twice
   * over, because that first frame then rendered the whole chain again.
   * `createPostChain()` runs during `bootstrap()` with the loading curtain up
   * and the game loop not yet started, which is the last quiet moment there is.
   *
   * It compiles the POST programs — bloom's mip chain, the grade quad, SMAA's
   * three passes, AO, the copy shader — against whatever the scene holds at
   * boot, which is nearly nothing. World materials are not this function's
   * business and still compile on their own first draw.
   *
   * `chainDirty` is cleared because `rebuild()` above set it and the debt is
   * now paid; the first `render()` should find a warm chain and just present.
   */
  chainDirty = false;
  warmUp();

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
    drawCallsByPass,

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
        // AFTER `warmUp()`, deliberately: it draws a complete throwaway frame
        // through the same passes, and folding that in would double every
        // bucket on the one frame that follows a rebuild.
        beginDrawCallFrame();
        composer.render(dt);
        endDrawCallFrame();
      } else {
        beginDrawCallFrame();
        renderer.setRenderTarget(null);
        const before = renderer.info.render.calls;
        const shadowBefore = shadowCalls;
        renderer.render(scene, camera);
        // The composer's RenderPass is not in this path, so neither is its meter.
        // Attribute the direct draw to `colour` by hand, or the whole frame lands
        // in the residual and reads as post.
        sceneCalls += (renderer.info.render.calls - before) - (shadowCalls - shadowBefore);
        endDrawCallFrame();
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
      // Before anything else: the renderer outlives this chain, and a stacked
      // shadow meter would count the next chain's frames once per dead chain.
      shadowMap.render = baseShadowRender;
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
      normalFromDepthMaterial?.dispose();
      normalFromDepthMaterial = null;
      try {
        disposeMsaa();
        msaaSamples = 0;
        // The depth attachments are ours, not the targets': `RenderTarget`
        // disposes what it allocated, and it did not allocate these.
        composer?.renderTarget1.depthTexture?.dispose();
        composer?.renderTarget2.depthTexture?.dispose();
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

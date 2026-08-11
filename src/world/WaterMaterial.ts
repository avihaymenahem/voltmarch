/**
 * ============================================================================
 * VOLTMARCH — src/world/WaterMaterial.ts
 * ============================================================================
 * THE WATER SHADER. On a naval map this is 60-70% of the frame, so it gets the
 * same care the ground shader gets — and it is governed by the single most
 * counter-intuitive ruling in the bible.
 *
 * RULING #7 / RISK R7 — WATER IS NOT A MIRROR
 * -------------------------------------------
 * Every instinct says "add a reflection probe, the water will look amazing".
 * It is measurably wrong. RA3's water is ABSORPTION + REFRACTED SEABED + FOAM
 * + TIGHT GLINT on a base that is 20-40% grey. The moment a reflection term
 * climbs past mix 0.10 the open-water median jumps over L=115, the foam stops
 * popping (because the base is no longer dark) and the whole map reads as a
 * mobile game. So:
 *   - there is NO skybox term in this shader, at all, anywhere;
 *   - there is no planar mirror and no reflection render target;
 *   - the only reflective term is a grazing-angle fresnel (exponent 5.0)
 *     against the colour of the LAND, hard-clamped to `WATER_SSR.mixMax` in
 *     `createWaterMaterial` — not merely documented, clamped.
 * `probeOpenWaterLuminance()` at the bottom of this file is the automated
 * guard the bible asks for (scorecard #25): it runs the shader's own colour
 * maths plus the real tone-map path on the CPU and reports the 0-255 mean.
 *
 * WHY THE SEABED IS RECONSTRUCTED, NOT SAMPLED
 * --------------------------------------------
 * Bible §7 wants per-channel absorption (`exp(-depth * vec3(0.62,0.28,0.20))`,
 * red dies first) over a REFRACTED seabed. Neither is expressible with alpha
 * blending: fixed-function blending has one alpha, not three, and it cannot
 * offset the destination's UVs. The usual fix is a scene-colour copy, which
 * costs a full-resolution resolve every frame.
 *
 * Instead the water reads a baked FIELD TEXTURE (Water.ts) holding the
 * terrain's own depth, its shoreline distance and its seabed variation, and
 * reconstructs the bed. That buys three things a scene copy does not: the
 * refraction offset is free (just move the lookup), the shoreline band is
 * exact (it comes from a real distance transform, so "100% of the contact"
 * is structural), and the water is opaque so it never sorts against anything.
 *
 * THE THREE WAVE BANDS (bible §7)
 * -------------------------------
 *   A  swell   lambda 1.2-2.5 TL, +/-0.02 TL, 0.10 TL/s — displaces geometry,
 *              drives the foam crest. Analytic, crest-sharpened `|sin|^0.6`.
 *   B  chop    the visible crinkle, 0.35 TL/s — normal map, two rotations.
 *   C  micro   2-4 px, 0.9 TL/s — normal map. WITHOUT BAND C THE SPECULAR
 *              READS AS PLASTIC. It is not a polish item.
 * All three come out of ONE 512^2 RGBA texture (mid-frequency slope in RG,
 * high-frequency in BA) sampled three times at the bible's 0/47/113 degrees.
 *
 * FOAM IS FILIGREE (scorecard #26)
 * --------------------------------
 * Foam is never a soft alpha blob. It is a noise-warped RIDGE field —
 * `1 - |fbm|`, domain-warped — baked to a texture and thresholded against the
 * crest height in the shader. Two things make the coverage predictable rather
 * than hopeful: the ridge field is monotonically remapped to a gaussian at
 * bake time (a monotone remap moves NO level set, so filament topology is
 * untouched while the threshold-to-coverage relation becomes exact), and the
 * texture tiles at 12 m over 512 texels so a 6% coverage lands filaments at
 * 2-3 px at the reference resolution.
 * ============================================================================
 */

import * as THREE from 'three';
import {
  MAP_SIZE, WATER_FIELD, WATER_FOAM, WATER_GLINT, WATER_LOOK, WATER_SHORE,
  WATER_SSR, WATER_TEXTURE_SIZE, WATER_WAKE, WATER_WAVES,
  type WaterPalette,
} from '../core/config';
import { DEG2RAD, TAU, clamp, clamp01, fbm2, hexToLinearRgb, lerp, simplex2 } from '../core/math';
import { shroudUniforms } from '../render/FogOfWar';
import {
  LACE_SIGMA, buildFoamLace, buildWaveSlopes, probit, waterTextureKey,
  type WaterTextureData,
} from './water-texture-gen';

/* ==========================================================================
 * 1. UNIFORMS
 * ========================================================================== */

export interface WaterUniforms {
  /** RGBA8. R = signed depth (sqrt-encoded), G = shore distance, BA = seabed. */
  uField: { value: THREE.Texture | null };
  /** RGBA8. RG = mid-frequency slope, BA = high-frequency slope. */
  uWaves: { value: THREE.Texture | null };
  /** R8 gaussian-remapped ridge field. The foam filigree. */
  uLace: { value: THREE.Texture | null };
  /** R8 world-space wake accumulation buffer. */
  uWake: { value: THREE.Texture | null };

  uTime: { value: number };
  uInvMapSize: { value: number };
  uWaterLevel: { value: number };
  /** Metres encoded by the field's signed depth channel. */
  uEncodeMetres: { value: number };
  /** Metres encoded by the field's shore-distance channel. */
  uShoreEncode: { value: number };

  /* -- body colour ------------------------------------------------------- */
  uRamp: { value: THREE.Vector3[] };
  uRampDepth: { value: number };
  uAbsorb: { value: THREE.Vector3 };
  uSeabed: { value: THREE.Vector3 };
  /** x = seabed fade metres, y = seabed contrast, z = refraction metres. */
  uBed: { value: THREE.Vector3 };

  /* -- waves ------------------------------------------------------------- */
  /** x,y = swell wavelengths, z = amplitude, w = speed. */
  uWaveA: { value: THREE.Vector4 };
  /** x = chop tile, y = chop speed, z = chop strength, w = crest sharpness. */
  uWaveB: { value: THREE.Vector4 };
  /** x = micro tile, y = micro speed, z = micro strength, w = sea state. */
  uWaveC: { value: THREE.Vector4 };
  uSwellDir: { value: THREE.Vector4 };
  /** cos/sin of the 47 and 113 degree sampling rotations. */
  uRot47: { value: THREE.Vector2 };
  uRot113: { value: THREE.Vector2 };

  /* -- foam -------------------------------------------------------------- */
  uFoamColor: { value: THREE.Vector3 };
  /** x = threshold lo, y = threshold hi, z = crest gain, w = scroll m/s. */
  uFoam: { value: THREE.Vector4 };
  /** x = lace tile, y = detail tile, z = detail mix, w = mix renormaliser. */
  uLaceParams: { value: THREE.Vector4 };
  /** x = choppy threshold bias, y = distance compensation, z = wake gain. */
  uFoamMisc: { value: THREE.Vector3 };

  /* -- shoreline --------------------------------------------------------- */
  uShoreFoam: { value: THREE.Vector3 };
  uShoreMid: { value: THREE.Vector3 };
  uShoreWater: { value: THREE.Vector3 };
  /** x = band metres, y = pulse rad/s, z = pulse amount, w = scroll m/s. */
  uShore: { value: THREE.Vector4 };
  /** x = lighten depth, y = churn threshold, z = churn tile. */
  uShoreMisc: { value: THREE.Vector3 };

  /* -- lighting ---------------------------------------------------------- */
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Vector3 };
  uHemiSky: { value: THREE.Vector3 };
  uHemiGround: { value: THREE.Vector3 };
  uLightNorm: { value: number };
  /** x = sun diffuse, y = fill diffuse, z = output gain. */
  uGrade: { value: THREE.Vector3 };
  /** x = roughness, y = anisotropy, z = intensity, w = distance widening. */
  uGlint: { value: THREE.Vector4 };
  /** x = mix (<= WATER_SSR.mixMax), y = fresnel power, z = shore falloff. */
  uSsr: { value: THREE.Vector3 };
  uReflect: { value: THREE.Vector3 };

  /* The shared shroud mask. Owned by FogOfWar, held here BY REFERENCE. */
  uFogMask: { value: THREE.Texture | null };
  uFogTint: { value: THREE.Vector4 };
  uFogDark: { value: THREE.Vector4 };
  uFogParams: { value: THREE.Vector2 };
  uFogAmount: { value: number };

  [key: string]: THREE.IUniform;
}

/* ==========================================================================
 * 2. PROCEDURAL TEXTURES — GENERATED ELSEWHERE
 *
 * The two tiles this material samples, `water.waveSlopes` and `water.foamLace`,
 * are built by `./water-texture-gen.ts` and re-exported here unchanged.
 *
 * THEY MOVED BECAUSE THEY WERE THE BOOT. Measured on `08-naval-water`,
 * `createWaterMaterial` was 230-270 ms of main-thread time and these two
 * functions were essentially all of it. They are pure functions of
 * `(size, seed)` — no uniform, no palette, no light rig — so they are exactly
 * the shape a worker can run, and `src/core/workers/world-warm.ts` now does.
 *
 * THE RE-EXPORT IS NOT TIDINESS. `tests/water.spec.ts` imports `buildFoamLace`,
 * `buildWaveSlopes` and `LACE_SIGMA` from THIS module, and scorecard #26's
 * filament measurement is built on them. Keeping the names here means the split
 * is invisible to every caller, so the guards did not have to be rewritten to
 * accommodate a refactor — which is how a guard quietly stops guarding.
 * ========================================================================== */

export { LACE_SIGMA, buildFoamLace, buildWaveSlopes };
export type { WaterTextureData };

/* ==========================================================================
 * 3. SHADER
 * ========================================================================== */

/**
 * Shared between both stages: the analytic swell. The fragment stage
 * re-evaluates it rather than interpolating a varying, because the crest
 * height drives the foam threshold and a linearly interpolated crest across a
 * 2 m quad visibly stair-steps the foam edge.
 */
const WAVE_COMMON = /* glsl */ `
uniform float uTime;
uniform vec4  uWaveA;      // swell lambda 1, lambda 2, amplitude, speed
uniform vec4  uWaveB;      // chop tile, chop speed, chop strength, crest sharpness
uniform vec4  uWaveC;      // micro tile, micro speed, micro strength, sea state
uniform vec4  uSwellDir;   // dir1.xy, dir2.xy

#ifndef PI
  #define PI 3.141592653589793
#endif
#define TAU 6.283185307179586

// sign(s) * |s|^k. k < 1 sharpens the crest; a plain sine reads as jelly.
// Also returns d/dphase, which is the surface slope along the wave direction.
float crestWave(float phase, float k, out float dh) {
  float s = sin(phase);
  float a = max(abs(s), 1e-4);
  dh = k * pow(a, k - 1.0) * cos(phase);
  return sign(s) * pow(a, k);
}

// Band A. Two crossed crest-sharpened waves; grad is d(height)/d(xz).
float swellHeight(vec2 p, out vec2 grad) {
  float k1 = TAU / uWaveA.x;
  float k2 = TAU / uWaveA.y;
  float ph1 = dot(p, uSwellDir.xy) * k1 - uTime * uWaveA.w * k1;
  float ph2 = dot(p, uSwellDir.zw) * k2 - uTime * uWaveA.w * 0.83 * k2;
  float d1, d2;
  float h1 = crestWave(ph1, uWaveB.w, d1);
  float h2 = crestWave(ph2, uWaveB.w, d2);
  float amp = uWaveA.z * (0.55 + 0.45 * uWaveC.w);
  grad = (uSwellDir.xy * (d1 * k1 * 0.62) + uSwellDir.zw * (d2 * k2 * 0.38)) * amp;
  return (h1 * 0.62 + h2 * 0.38) * amp;
}
`;

const WATER_VERT = /* glsl */ `
precision highp float;

uniform sampler2D uField;
uniform float uInvMapSize;
uniform float uWaterLevel;
uniform float uEncodeMetres;

varying vec3 vWorld;
varying vec2 vFieldUv;

${WAVE_COMMON}

float decodeSigned(float e) {
  float s = e * 2.0 - 1.0;
  return sign(s) * s * s * uEncodeMetres;
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;
  vFieldUv = p * uInvMapSize;

  // Kill the swell as the bed comes up, or the crests poke through the beach
  // and the shoreline band tears. Vertex texture fetch is core in WebGL2.
  float depth = decodeSigned(texture2D(uField, vFieldUv).r);
  float shallow = smoothstep(0.0, 0.75, depth);

  vec2 grad;
  float h = swellHeight(p, grad) * shallow;

  wp.y = uWaterLevel + h;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uField;
uniform sampler2D uWaves;

// Shared with every other material that draws above the fog carpet.
// See FogOfWar.ts §1b.
uniform sampler2D uFogMask;
uniform vec4  uFogTint;
uniform vec4  uFogDark;
uniform vec2  uFogParams;
uniform float uFogAmount;
uniform sampler2D uLace;
uniform sampler2D uWake;

uniform float uInvMapSize;
uniform float uWaterLevel;
uniform float uEncodeMetres;
uniform float uShoreEncode;

uniform vec3  uRamp[8];
uniform float uRampDepth;
uniform vec3  uAbsorb;
uniform vec3  uSeabed;
uniform vec3  uBed;          // fade metres, contrast, refraction metres

uniform vec2  uRot47;
uniform vec2  uRot113;

uniform vec3  uFoamColor;
uniform vec4  uFoam;         // lo, hi, crest gain, scroll
uniform vec4  uLaceParams;   // tile, detail tile, detail mix, renormaliser
uniform vec3  uFoamMisc;     // choppy bias, distance compensation, wake gain

uniform vec3  uShoreFoam;
uniform vec3  uShoreMid;
uniform vec3  uShoreWater;
uniform vec4  uShore;        // band metres, pulse rad/s, pulse amount, scroll
uniform vec3  uShoreMisc;    // lighten depth, churn threshold, churn tile

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uHemiSky;
uniform vec3  uHemiGround;
uniform float uLightNorm;
uniform vec3  uGrade;        // sun diffuse, fill diffuse, output gain
uniform vec4  uGlint;        // roughness, anisotropy, intensity, distance widen
uniform vec3  uSsr;          // mix, fresnel power, shore falloff
uniform vec3  uReflect;

varying vec3 vWorld;
varying vec2 vFieldUv;

${WAVE_COMMON}

float decodeSigned(float e) {
  float s = e * 2.0 - 1.0;
  return sign(s) * s * s * uEncodeMetres;
}

// Rotate a vector by (cos, sin) and its inverse. Used to sample the slope map
// at the bible's 0/47/113 degrees: the DOMAIN is rotated, so the sampled
// gradient has to be rotated back to world space or the ripples shear.
vec2 rot2(vec2 v, vec2 cs)   { return vec2(v.x * cs.x - v.y * cs.y, v.x * cs.y + v.y * cs.x); }
vec2 unrot2(vec2 v, vec2 cs) { return vec2(v.x * cs.x + v.y * cs.y, -v.x * cs.y + v.y * cs.x); }

// Piecewise-linear 8-stop ramp. Written as a chain of mixes because GLSL ES
// 1.00 only permits constant-index-expressions into a uniform array.
vec3 rampSample(float t) {
  float f = clamp(t, 0.0, 1.0) * 7.0;
  vec3 c = uRamp[0];
  for (int i = 1; i < 8; i++) {
    c = mix(c, uRamp[i], clamp(f - float(i - 1), 0.0, 1.0));
  }
  return c;
}

void main() {
  vec4 field = texture2D(uField, vFieldUv);
  float depth = decodeSigned(field.r);
  // Land. The mesh carries a small margin past the waterline so the geometry
  // never ends before the water does; this is where that margin is thrown away.
  if (depth <= 0.0) discard;

  vec3 viewVec = cameraPosition - vWorld;
  float viewDist = length(viewVec);
  vec3 V = viewVec / max(viewDist, 1e-4);
  vec2 p = vWorld.xz;

  /* ---- normal: band A slope + bands B and C from the slope map ---------- */
  vec2 grad;
  float crest = swellHeight(p, grad);
  float crestN = clamp(crest / max(uWaveA.z, 1e-4), -1.0, 1.0);

  float shallow = smoothstep(0.0, 0.75, depth);
  vec2 slope = grad * shallow;

  // Band B, two rotations of the mid-frequency channel.
  vec2 dirB = vec2(0.82, 0.57) * (uTime * uWaveB.y);
  vec2 b0 = (texture2D(uWaves, (p + dirB) / uWaveB.x).rg * 2.0 - 1.0);
  vec2 q47 = rot2(p, uRot47);
  vec2 b1 = texture2D(uWaves, (q47 - dirB.yx * 0.77) / (uWaveB.x * 0.63)).rg * 2.0 - 1.0;
  slope += (b0 + unrot2(b1, uRot47)) * uWaveB.z;

  // Band C, the micro-detail. Rotated 113 degrees and scrolling fastest.
  vec2 q113 = rot2(p, uRot113);
  vec2 c0 = texture2D(uWaves, (q113 + vec2(0.31, -0.95) * (uTime * uWaveC.y)) / uWaveC.x).ba * 2.0 - 1.0;
  slope += unrot2(c0, uRot113) * uWaveC.z;

  // Sea state scales the crinkle but not the swell, exactly like real chop.
  slope *= (0.6 + 0.4 * uWaveC.w);
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

  /* ---- absorption over a refracted seabed (bible §7) -------------------- */
  vec2 refr = N.xz * uBed.z * clamp(depth * 0.5, 0.0, 1.0);
  vec4 bedField = texture2D(uField, vFieldUv + refr * uInvMapSize);
  float bedDepth = max(decodeSigned(bedField.r), 0.0);

  float blob = (bedField.b - 0.5) * 2.0;
  float grit = (bedField.a - 0.5) * 2.0;
  vec3 seabed = uSeabed * (1.0 + blob * uBed.y + grit * uBed.y * 0.45);

  vec3 trans = exp(-bedDepth * uAbsorb);
  // Hard cutoff: the bible is explicit that the bed is COMPLETELY invisible
  // past ~2 TL. Absorption alone leaves a faint ghost that reads as fog.
  trans *= smoothstep(uBed.x, uBed.x * 0.35, bedDepth);

  vec3 body = mix(rampSample(depth / uRampDepth), seabed * trans, trans.g);

  /* ---- shoreline: distance field -> band, lightening, churn ------------- */
  // G is SIGNED: positive offshore, negative inland. Signed is what makes the
  // landward gradient below continuous across the contact — an unsigned
  // distance has a crease exactly on the waterline, which is exactly where
  // the band needs a clean direction.
  float shoreDist = (field.g - 0.5) * 2.0 * uShoreEncode;
  float shoreT = 1.0 - clamp(shoreDist / uShore.x, 0.0, 1.0);

  // Landward direction = downhill in the shore-distance field. Two forward
  // taps; a central difference would cost four for no visible gain.
  float e = 1.5 * uInvMapSize;
  float gsx = texture2D(uField, vFieldUv + vec2(e, 0.0)).g - field.g;
  float gsz = texture2D(uField, vFieldUv + vec2(0.0, e)).g - field.g;
  vec2 landward = -normalize(vec2(gsx, gsz) + vec2(1e-5));

  float lighten = 1.0 - clamp(depth / uShoreMisc.x, 0.0, 1.0);
  body = mix(body, uShoreWater, shoreT * lighten * 0.62);

  /* ---- foam ------------------------------------------------------------ */
  // Warp the lace lookup by the wave normal so the filaments ride the crests
  // instead of sitting on a static grid.
  vec2 lp = p + N.xz * 0.55 + vec2(0.71, 0.32) * (uTime * uFoam.w);
  float laceA = texture2D(uLace, lp / uLaceParams.x).r;
  float laceB = texture2D(uLace, rot2(lp, uRot47) / uLaceParams.y).r;
  float lace = mix(laceA, laceB, uLaceParams.z);
  // Mixing two gaussians narrows the distribution; renormalise or the
  // measured coverage drifts away from scorecard #26.
  lace = 0.5 + (lace - 0.5) * uLaceParams.w;

  // Thresholds open up with sea state and with distance. The distance term is
  // mip compensation: a filament field averages toward its mean under
  // minification, and without this the far half of the frame loses its foam.
  float thr = uFoam.x - uWaveC.w * uFoamMisc.x - uFoamMisc.y * clamp(viewDist / 90.0, 0.0, 1.0);
  float crestPush = crestN * uFoam.z * 0.5 * (0.4 + 0.6 * uWaveC.w);
  float foam = smoothstep(thr, thr + (uFoam.y - uFoam.x), lace + crestPush);

  // Wakes. FULLY multiplied by the lace — an accumulation buffer on its own is
  // a soft blob, which is the scorecard #26 failure arrived at from the wake
  // side. An earlier version kept a 0.30 floor here "so the churn reads solid";
  // rendered, that turned a ship's track into a white slug. The wake decides
  // WHERE there is foam, the lace decides what shape it is.
  float wake = texture2D(uWake, vFieldUv).r * uFoamMisc.z;
  float wakeFoam = smoothstep(0.06, 0.55, wake) * smoothstep(0.30, 0.62, lace);
  foam = max(foam, wakeFoam);

  // The permanent shoreline band: denser, bluer, pulsing, scrolling landward.
  vec2 sp = p + landward * (uTime * uShore.w) + N.xz * 0.3;
  float churn = texture2D(uLace, sp / uShoreMisc.z).r;
  float pulse = 1.0 + uShore.z * sin(uTime * uShore.y + p.x * 0.21 + p.y * 0.17);
  float bandMask = smoothstep(0.0, 0.35, shoreT) * pulse;
  float shoreFoam = smoothstep(uShoreMisc.y, uShoreMisc.y + 0.14, churn + bandMask * 0.30)
                  * smoothstep(0.0, 0.12, shoreT);
  float shoreMix = clamp(shoreFoam, 0.0, 1.0);
  foam = clamp(max(foam, shoreMix), 0.0, 1.0);

  vec3 foamCol = mix(uFoamColor, mix(uShoreMid, uShoreFoam, smoothstep(0.35, 0.85, churn)),
                     smoothstep(0.0, 0.6, shoreT));

  /* ---- lighting -------------------------------------------------------- */
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 hemi = mix(uHemiGround, uHemiSky, 0.5 + 0.5 * N.y);
  vec3 lightBody = (uGrade.x * ndl * uSunColor + uGrade.y * hemi) / uLightNorm;
  vec3 lightFoam = (${WATER_LOOK.foamSunDiffuse.toFixed(4)} * ndl * uSunColor
                  + ${WATER_LOOK.foamFillDiffuse.toFixed(4)} * hemi) / uLightNorm;

  vec3 col = mix(body * lightBody, foamCol * lightFoam, foam);

  /* ---- grazing term — RULING #7 ---------------------------------------- */
  // No sky. No cube map. No screen-space trace. The colour of the LAND, at
  // grazing angles only, faded out offshore, and the mix is clamped to 0.10
  // on the CPU before it ever reaches this line.
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uSsr.y);
  float nearShore = 1.0 - clamp(shoreDist / uSsr.z, 0.0, 1.0);
  col = mix(col, uReflect * lightBody, fres * uSsr.x * (0.2 + 0.8 * nearShore) * (1.0 - foam));

  /* ---- glint: anisotropic GGX, stretched along the light azimuth -------- */
  vec3 H = normalize(uSunDir + V);
  vec2 az = normalize(uSunDir.xz + vec2(1e-5));
  vec3 X = vec3(az.x, 0.0, az.y);
  X = normalize(X - N * dot(N, X));
  vec3 Y = cross(N, X);
  // Widen the lobe with distance: the cheapest specular antialiasing there is,
  // and it keeps a 3 px highlight from crawling across the far half of the map.
  float rough = uGlint.x * (1.0 + uGlint.w * clamp(viewDist / 120.0, 0.0, 1.0));
  float ax = max(rough * uGlint.y, 0.004);
  float ay = max(rough / uGlint.y, 0.004);
  float xh = dot(X, H) / ax;
  float yh = dot(Y, H) / ay;
  float nh = max(dot(N, H), 0.0);
  float dd = xh * xh + yh * yh + nh * nh;
  // The anisotropic GGX D term NORMALISED by its own peak (1/(PI*ax*ay)), so
  // uGlint.z is "how many times over white does a dead-on glint go" instead of
  // an arbitrary scale that changes meaning every time the roughness moves.
  // The raw D peaks near 10^2 at these roughnesses; feeding that straight into
  // the sun colour turned the whole surface into a highlight and pushed the
  // frame mean from L=58 to L=131, which is scorecard #25's exact failure.
  float lobe = clamp(1.0 / max(dd * dd, 1e-6), 0.0, 1.0);
  vec3 spec = lobe * ndl * uSunColor * uGlint.z * (1.0 - foam * 0.85);

  col = (col + spec) * uGrade.z;

  /* ---- the shroud, self-applied ---------------------------------------- */
  // The fog carpet is draped on the SEABED and depth-tested, while this surface
  // sits at WATER_LEVEL above it and writes depth in an earlier render band —
  // so the carpet can never cover the sea. Without this block, unexplored ocean
  // renders as bright daylight water. Same formula as applyShroudTint().
  {
    float vmV   = texture2D(uFogMask, vWorld.xz * uFogParams.x).r;
    float vmRem = 1.0 - smoothstep(0.0, uFogParams.y, vmV);
    float vmFog = 1.0 - smoothstep(uFogParams.y, 1.0, vmV);
    float vmA   = mix(uFogTint.w * vmFog, uFogDark.w, vmRem) * uFogAmount;
    col = mix(col, mix(uFogTint.xyz, uFogDark.xyz, vmRem), vmA);
  }

  // The waterline is one texel wide in the field, so fade the last few
  // centimetres of depth rather than leaving a hard stair-stepped edge.
  float alpha = smoothstep(0.0, 0.12, depth);

  gl_FragColor = vec4(col, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ==========================================================================
 * 4. FACTORY
 * ========================================================================== */

export interface WaterMaterialOptions {
  palette: WaterPalette;
  /** Effective ramp depth in metres — Water.ts fits this to the real basin. */
  rampDepth: number;
  seed?: number;
  textureSize?: number;
  anisotropy?: number;
  /**
   * Tiles generated somewhere else — normally by the boot-time worker in
   * `src/core/workers/world-warm.ts`.
   *
   * ADOPTED ONLY ON AN EXACT KEY MATCH, and a miss is not an error: it falls
   * through to generating them right here, which is what this function did
   * before the worker existed and is the fallback for every way the worker can
   * fail. `null` and a stale key take the same path.
   */
  textures?: WaterTextureData | null;
}

export interface WaterLightRig {
  /** Unit vector pointing TOWARD the sun. */
  sunDir: THREE.Vector3;
  /** Linear sun colour, already multiplied by intensity. */
  sunColor: THREE.Vector3;
  hemiSky: THREE.Vector3;
  hemiGround: THREE.Vector3;
}

export interface WaterMaterialSet {
  readonly material: THREE.ShaderMaterial;
  readonly uniforms: WaterUniforms;
  /** Textures this set owns and will dispose. */
  readonly waveTexture: THREE.DataTexture;
  readonly laceTexture: THREE.DataTexture;
  /**
   * True when both tiles came from `options.textures` rather than being built
   * here. For the boot log only — nothing branches on it.
   */
  readonly texturesAdopted: boolean;
  /** Swap palette without a shader recompile. */
  applyPalette(palette: WaterPalette, rampDepth: number): void;
  /** Push the scene's sun/hemisphere in. Called once per frame. */
  applyLighting(rig: WaterLightRig): void;
  setField(tex: THREE.Texture | null): void;
  setWake(tex: THREE.Texture | null): void;
  setTime(t: number): void;
  setWaterLevel(y: number): void;
  setSeaState(v: number): void;
  setAnisotropy(a: number): void;
  dispose(): void;
}

const _v3 = new THREE.Vector3();
const _rgb = new Float32Array(3);

function linearVec(hex: string, out?: THREE.Vector3): THREE.Vector3 {
  hexToLinearRgb(hex, _rgb as unknown as number[]);
  const v = out ?? new THREE.Vector3();
  return v.set(_rgb[0], _rgb[1], _rgb[2]);
}

/**
 * Resample an authored, unevenly spaced ramp onto N even stops.
 *
 * The shader wants even spacing so its lookup is a branchless chain of mixes.
 * Eight stops over `rampDepth` is one stop per ~1 m on a 2.4 TL basin, which
 * is finer than the 8-bit depth field can resolve anyway.
 */
export function resampleRamp(palette: WaterPalette, stops: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const src = palette.ramp;
  const last = src.length - 1;
  for (let i = 0; i < stops; i++) {
    const t = stops === 1 ? 0 : i / (stops - 1);
    let k = 0;
    while (k < last - 1 && t > src[k + 1].t) k++;
    const a = src[k];
    const b = src[k + 1] ?? a;
    const span = b.t - a.t;
    const f = span > 1e-6 ? clamp01((t - a.t) / span) : 0;
    out.push(linearVec(a.hex).lerp(linearVec(b.hex), f));
  }
  return out;
}

/**
 * The lace threshold that yields `WATER_SHORE.coverage` inside the band.
 *
 * Inside the band the shader adds `bandMask * 0.30` (bandMask ~ 1) to a lace
 * value distributed N(0.5, LACE_SIGMA), then runs it through a 0.14-wide
 * smoothstep. Solving for the threshold rather than eyeballing it is what
 * makes scorecard #27's "~45% coverage" a property of the code.
 */
function shoreChurnThreshold(): number {
  const push = 0.30;
  const rampWidth = 0.14;
  const level = 0.5 + LACE_SIGMA * probit(1 - clamp(WATER_SHORE.coverage, 0.02, 0.98));
  return level + push - rampWidth * 0.5;
}

/**
 * `1 / sqrt(m^2 + (1-m)^2)` — mixing two independent gaussians of equal sigma
 * with weight m narrows the result by exactly that factor. Undoing it keeps
 * the foam coverage where the probe measured it.
 */
function laceRenormaliser(mix: number): number {
  return 1 / Math.sqrt(mix * mix + (1 - mix) * (1 - mix));
}

export function createWaterMaterial(opts: WaterMaterialOptions): WaterMaterialSet {
  const size = opts.textureSize ?? WATER_TEXTURE_SIZE;
  const seed = opts.seed ?? 0;
  // The slope map is sampled at an 8 m tile (32 texels/m) and a 1.05 m tile
  // (244 texels/m); both are heavily oversampled at half resolution, and this
  // is the single biggest chunk of the module's load time. The LACE stays at
  // full resolution because its filament width is the thing scorecard #26
  // measures.
  const waveSize = Math.max(64, size >> 1);

  /*
   * ADOPT OR GENERATE — and the key comparison is what makes that safe.
   *
   * A prewarmed set is accepted only when it was generated from exactly this
   * size and seed. `waterTextureKey` is the ONE definition of that identity and
   * both sides call it, so a mismatch cannot be papered over by two agreeing
   * comments. Anything else — no worker, `?watertexworkers=off`, a job that
   * timed out, a `?water=` palette on a build whose tiles were baked for a
   * different `WATER_TEXTURE_SIZE` — falls through to the two calls below,
   * which is the path this function has always taken.
   *
   * The bytes are used AS-IS, with no copy: `DataTexture` keeps the reference
   * and the worker's buffer was transferred, so it is ours to own.
   */
  const pre = opts.textures ?? null;
  const adopted = pre !== null
    && pre.key === waterTextureKey(size, seed)
    && pre.waveSize === waveSize
    && pre.laceSize === size
    && pre.waves.length === waveSize * waveSize * 4
    && pre.lace.length === size * size;

  const waveTexture = new THREE.DataTexture(
    adopted && pre !== null ? pre.waves : buildWaveSlopes(waveSize, seed),
    waveSize, waveSize,
    THREE.RGBAFormat, THREE.UnsignedByteType,
  );
  waveTexture.name = 'water.waveSlopes';
  waveTexture.wrapS = THREE.RepeatWrapping;
  waveTexture.wrapT = THREE.RepeatWrapping;
  waveTexture.magFilter = THREE.LinearFilter;
  waveTexture.minFilter = THREE.LinearMipmapLinearFilter;
  waveTexture.generateMipmaps = true;
  waveTexture.needsUpdate = true;

  const laceTexture = new THREE.DataTexture(
    adopted && pre !== null ? pre.lace : buildFoamLace(size, seed + 101),
    size, size, THREE.RedFormat, THREE.UnsignedByteType,
  );
  laceTexture.name = 'water.foamLace';
  laceTexture.wrapS = THREE.RepeatWrapping;
  laceTexture.wrapT = THREE.RepeatWrapping;
  laceTexture.magFilter = THREE.LinearFilter;
  laceTexture.minFilter = THREE.LinearMipmapLinearFilter;
  laceTexture.generateMipmaps = true;
  laceTexture.needsUpdate = true;

  const rot = WATER_WAVES.rotationDeg;
  const d1 = WATER_WAVES.swellHeadingDeg * DEG2RAD;
  const d2 = WATER_WAVES.swellHeadingDeg2 * DEG2RAD;

  // RULING #7 lives here. Not in a comment — in a clamp.
  const ssrMix = Math.min(WATER_SSR.mix, WATER_SSR.mixMax);

  const uniforms: WaterUniforms = {
    uField: { value: null },
    uWaves: { value: waveTexture },
    uLace: { value: laceTexture },
    uWake: { value: null },

    uTime: { value: 0 },
    uInvMapSize: { value: 1 / MAP_SIZE },
    uWaterLevel: { value: 0 },
    uEncodeMetres: { value: WATER_FIELD.encodeMetres },
    uShoreEncode: { value: WATER_SHORE.encodeMetres },

    uRamp: { value: resampleRamp(opts.palette, WATER_LOOK.rampStops) },
    uRampDepth: { value: opts.rampDepth },
    uAbsorb: { value: new THREE.Vector3() },
    uSeabed: { value: linearVec(opts.palette.seabed) },
    uBed: {
      value: new THREE.Vector3(
        WATER_LOOK.seabedFadeMetres, WATER_LOOK.seabedContrast, WATER_LOOK.refractionMetres,
      ),
    },

    uWaveA: {
      value: new THREE.Vector4(
        WATER_WAVES.swellMetres, WATER_WAVES.swellMetres2,
        WATER_WAVES.swellAmplitude, WATER_WAVES.swellSpeed,
      ),
    },
    uWaveB: {
      value: new THREE.Vector4(
        WATER_WAVES.chopTileMetres, WATER_WAVES.chopSpeed,
        WATER_WAVES.chopStrength, WATER_WAVES.swellSharpness,
      ),
    },
    uWaveC: {
      value: new THREE.Vector4(
        WATER_WAVES.microTileMetres, WATER_WAVES.microSpeed,
        WATER_WAVES.microStrength, WATER_WAVES.seaState,
      ),
    },
    uSwellDir: {
      value: new THREE.Vector4(Math.cos(d1), Math.sin(d1), Math.cos(d2), Math.sin(d2)),
    },
    uRot47: { value: new THREE.Vector2(Math.cos(rot[1] * DEG2RAD), Math.sin(rot[1] * DEG2RAD)) },
    uRot113: { value: new THREE.Vector2(Math.cos(rot[2] * DEG2RAD), Math.sin(rot[2] * DEG2RAD)) },

    uFoamColor: { value: linearVec(opts.palette.foam) },
    uFoam: {
      value: new THREE.Vector4(
        WATER_FOAM.thresholdLo, WATER_FOAM.thresholdHi,
        WATER_FOAM.crestGain, WATER_FOAM.scrollSpeed,
      ),
    },
    uLaceParams: {
      value: new THREE.Vector4(
        WATER_FOAM.laceTileMetres, WATER_FOAM.laceDetailMetres, WATER_FOAM.laceDetailMix,
        laceRenormaliser(WATER_FOAM.laceDetailMix),
      ),
    },
    uFoamMisc: {
      // y is the mip compensation. It was a bare 0.03 here and invisible to
      // `probeFoam`; it is `WATER_FOAM.distanceBias` now so the probe reads the
      // same number the shader does.
      value: new THREE.Vector3(
        WATER_FOAM.choppyBias, WATER_FOAM.distanceBias, WATER_WAKE.foamGain,
      ),
    },

    uShoreFoam: { value: linearVec(opts.palette.shoreFoam) },
    uShoreMid: { value: linearVec(opts.palette.shoreMid) },
    uShoreWater: { value: linearVec(opts.palette.shoreWater) },
    uShore: {
      value: new THREE.Vector4(
        WATER_SHORE.bandMetres, WATER_SHORE.pulseHz * TAU,
        WATER_SHORE.pulseAmount, WATER_SHORE.scrollSpeed,
      ),
    },
    uShoreMisc: {
      value: new THREE.Vector3(
        WATER_SHORE.lightenDepthMetres, shoreChurnThreshold(), WATER_FOAM.laceTileMetres * 0.5,
      ),
    },

    uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.7).normalize() },
    uSunColor: { value: new THREE.Vector3(3.1, 2.8, 2.3) },
    uHemiSky: { value: new THREE.Vector3(0.2, 0.35, 0.7) },
    uHemiGround: { value: new THREE.Vector3(0.25, 0.2, 0.12) },
    uLightNorm: { value: 1 },
    uGrade: {
      value: new THREE.Vector3(
        WATER_LOOK.sunDiffuse, WATER_LOOK.fillDiffuse, WATER_LOOK.outputGain,
      ),
    },
    uGlint: {
      value: new THREE.Vector4(
        WATER_GLINT.roughness, WATER_GLINT.anisotropy, WATER_GLINT.intensity, 0.9,
      ),
    },
    uSsr: {
      value: new THREE.Vector3(
        ssrMix, WATER_SSR.fresnelPower,
        // The shore channel saturates at its encode range, so a falloff past
        // that would leave the grazing term at a permanent floor offshore.
        Math.min(WATER_SSR.shoreFalloffMetres, WATER_SHORE.encodeMetres * 0.92),
      ),
    },
    uReflect: { value: linearVec(opts.palette.reflect) },

    // BY REFERENCE, not copied — FogOfWar swaps the mask in when it is
    // constructed, long after this material exists. Copies would freeze the
    // 1x1 "fully visible" default and the sea would never be shrouded.
    uFogMask: shroudUniforms.uFogMask,
    uFogTint: shroudUniforms.uFogTint,
    uFogDark: shroudUniforms.uFogDark,
    uFogParams: shroudUniforms.uFogParams,
    uFogAmount: shroudUniforms.uFogAmount,
  };

  const material = new THREE.ShaderMaterial({
    name: 'WaterMaterial',
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    // Bible §0 property 4 and the "explicitly zero" list: no fog anywhere.
    fog: false,
    toneMapped: true,
  });

  applyAbsorb(uniforms, opts.palette, opts.rampDepth);

  if (opts.anisotropy !== undefined) {
    waveTexture.anisotropy = opts.anisotropy;
    laceTexture.anisotropy = opts.anisotropy;
  }

  return {
    material,
    uniforms,
    waveTexture,
    laceTexture,
    texturesAdopted: adopted,

    applyPalette(palette: WaterPalette, rampDepth: number): void {
      const stops = resampleRamp(palette, WATER_LOOK.rampStops);
      const dst = uniforms.uRamp.value;
      for (let i = 0; i < stops.length; i++) dst[i].copy(stops[i]);
      uniforms.uRampDepth.value = rampDepth;
      linearVec(palette.seabed, uniforms.uSeabed.value);
      linearVec(palette.foam, uniforms.uFoamColor.value);
      linearVec(palette.shoreFoam, uniforms.uShoreFoam.value);
      linearVec(palette.shoreMid, uniforms.uShoreMid.value);
      linearVec(palette.shoreWater, uniforms.uShoreWater.value);
      linearVec(palette.reflect, uniforms.uReflect.value);
      applyAbsorb(uniforms, palette, rampDepth);
    },

    applyLighting(rig: WaterLightRig): void {
      uniforms.uSunDir.value.copy(rig.sunDir);
      uniforms.uSunColor.value.copy(rig.sunColor);
      uniforms.uHemiSky.value.copy(rig.hemiSky);
      uniforms.uHemiGround.value.copy(rig.hemiGround);
      uniforms.uLightNorm.value = lightNorm(rig);
    },

    setField(tex: THREE.Texture | null): void { uniforms.uField.value = tex; },
    setWake(tex: THREE.Texture | null): void { uniforms.uWake.value = tex; },
    setTime(t: number): void { uniforms.uTime.value = t; },
    setWaterLevel(y: number): void { uniforms.uWaterLevel.value = y; },
    setSeaState(v: number): void { uniforms.uWaveC.value.w = clamp01(v); },
    setAnisotropy(a: number): void {
      waveTexture.anisotropy = a;
      laceTexture.anisotropy = a;
      waveTexture.needsUpdate = true;
      laceTexture.needsUpdate = true;
    },

    dispose(): void {
      waveTexture.dispose();
      laceTexture.dispose();
      material.dispose();
    },
  };
}

/**
 * Absorption is scaled by the same factor the ramp depth is. A procedural
 * basin is often only 2 m deep; at the bible's literal coefficients the water
 * would be almost perfectly clear and the whole absorption identity would be
 * invisible. Scaling both together preserves the LOOK at any basin depth —
 * the seabed still vanishes at the same FRACTION of the way down.
 */
function applyAbsorb(u: WaterUniforms, palette: WaterPalette, rampDepth: number): void {
  const k = WATER_LOOK.rampDepthMetres / Math.max(rampDepth, 0.25);
  u.uAbsorb.value.set(
    palette.absorb[0] * k, palette.absorb[1] * k, palette.absorb[2] * k,
  );
  u.uBed.value.x = WATER_LOOK.seabedFadeMetres / k;
}

/**
 * The value `lightBody` takes for flat calm water under this rig. Dividing by
 * it means the authored ramp hexes render as themselves at noon (they were
 * sampled off graded frames, so they ARE the target pixel values) while a
 * night or overcast preset still darkens and tints the water correctly.
 */
function lightNorm(rig: WaterLightRig): number {
  const ndl = Math.max(rig.sunDir.y, 0);
  _v3.copy(rig.sunColor).multiplyScalar(WATER_LOOK.sunDiffuse * ndl)
    .addScaledVector(rig.hemiSky, WATER_LOOK.fillDiffuse);
  const l = 0.2126 * _v3.x + 0.7152 * _v3.y + 0.0722 * _v3.z;
  return l > 1e-4 ? l : 1e-4;
}

/* ==========================================================================
 * 5. THE AUTOMATED GUARDS (bible §14 R7, scorecard #25 and #26)
 *
 * Both of these are pure maths — no GL, no DOM — so they run at boot, in a
 * unit test, and in node. R7's mitigation is literally "an automated
 * water-luminance probe"; this is it.
 * ========================================================================== */

/* ---- tone map, ported from render/post.ts so the probe sees what ships --- */

const AGX_IN = [
  0.842479062253094, 0.0784335999999992, 0.0792237451477643,
  0.0423282422610123, 0.878468636469772, 0.0791661274605434,
  0.0423756549057051, 0.0784336, 0.879142973793104,
];
const AGX_OUT = [
  1.19687900512017, -0.0980208811401368, -0.0990297440797205,
  -0.0528968517574562, 1.15190312990417, -0.0989611768448433,
  -0.0529716355144438, -0.0980434501171241, 1.15107367264116,
];

function mat3mul(m: number[], v: number[], out: number[]): number[] {
  out[0] = m[0] * v[0] + m[3] * v[1] + m[6] * v[2];
  out[1] = m[1] * v[0] + m[4] * v[1] + m[7] * v[2];
  out[2] = m[2] * v[0] + m[5] * v[1] + m[8] * v[2];
  return out;
}

function agxContrast(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4
    - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

/** AgX, matching render/post.ts exactly (including its linearising pow 2.2). */
export function toneAgx(rgb: number[], out: number[]): number[] {
  mat3mul(AGX_IN, rgb, out);
  for (let i = 0; i < 3; i++) {
    let c = Math.log2(Math.max(out[i], 1e-10));
    c = clamp(c, -12.47393, 4.026069);
    c = (c + 12.47393) / (4.026069 + 12.47393);
    out[i] = agxContrast(c);
  }
  const t = [out[0], out[1], out[2]];
  mat3mul(AGX_OUT, t, out);
  for (let i = 0; i < 3; i++) out[i] = Math.pow(Math.max(out[i], 0), 2.2);
  return out;
}

/** Narkowicz ACES, matching render/post.ts. */
export function toneAces(rgb: number[], out: number[]): number[] {
  for (let i = 0; i < 3; i++) {
    const x = rgb[i];
    out[i] = clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
  }
  return out;
}

function linearToSrgb8(c: number): number {
  const v = clamp01(c);
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return s * 255;
}

export interface LuminanceProbe {
  /** Mean sRGB luminance 0-255 over the sampled depth range. */
  mean: number;
  /** Per-sample values, shallowest first. */
  samples: number[];
  /** True if `mean` is inside WATER_LOOK.luminanceBand. */
  pass: boolean;
  /** Mean foam fraction the estimate used. 0 when `foam` is disabled. */
  foamCoverage: number;
}

export interface LuminanceProbeOptions {
  /**
   * Include the foam layer. DEFAULT TRUE, and that default is the whole point —
   * see the header of `probeOpenWaterLuminance`.
   */
  foam?: boolean;
  /** Sea state. Defaults to the SHIPPING value, not a hand-picked calm one. */
  seaState?: number;
  /**
   * How far into the mip-compensation ramp the sampled water sits, 0..1 —
   * the shader's `clamp(viewDist / 90, 0, 1)`. Open water in a framed shot is
   * mostly mid-to-far, so 0.5 is the default rather than 0.
   */
  distanceFrac?: number;
}

/**
 * The crest term, EXACTLY as `swellHeight` builds it.
 *
 * Two crest-sharpened waves at 0.62/0.38, scaled by `(0.55 + 0.45 * seaState)`
 * — `crestN` divides the summed height back by `uWaveA.z`, so the amplitude
 * that survives into `crestPush` is that factor, not 1. `probeFoam` modelled
 * this as a bare `sin`, which both dropped the 0.55+0.45s scale and gave the
 * wrong shape: `pow(|sin|, 0.6)` has BROADER crests than a sine and therefore
 * spends more of its period near the extremes.
 */
function crestPushSamples(sea: number, n: number): Float64Array {
  const k = WATER_WAVES.swellSharpness;
  const scale = 0.55 + 0.45 * sea;
  const gain = WATER_FOAM.crestGain * 0.5 * (0.4 + 0.6 * sea);
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const s1 = Math.sin((TAU * i) / n);
    const h1 = Math.sign(s1) * Math.pow(Math.max(Math.abs(s1), 1e-4), k);
    for (let j = 0; j < n; j++) {
      const s2 = Math.sin((TAU * j) / n);
      const h2 = Math.sign(s2) * Math.pow(Math.max(Math.abs(s2), 1e-4), k);
      const crestN = clamp((h1 * 0.62 + h2 * 0.38) * scale, -1, 1);
      out[i * n + j] = crestN * gain;
    }
  }
  return out;
}

/**
 * The distribution of the shader's `foam` value over open water, as a weighted
 * histogram. Needed rather than a mean because the tone map is non-linear:
 * tonemapping the average foam is NOT the average of the tonemapped pixels, and
 * foam is close to a two-state field.
 */
function foamHistogram(sea: number, distanceFrac: number, bins: number):
{ f: Float64Array; w: Float64Array; mean: number } {
  // Faithful to the shader: base threshold, sea-state bias, AND the distance
  // mip compensation that `probeFoam` omits entirely.
  const thr = WATER_FOAM.thresholdLo
    - sea * WATER_FOAM.choppyBias
    - WATER_FOAM.distanceBias * clamp01(distanceFrac);
  const width = WATER_FOAM.thresholdHi - WATER_FOAM.thresholdLo;

  const push = crestPushSamples(sea, 24);
  const f = new Float64Array(bins);
  const w = new Float64Array(bins);
  for (let b = 0; b < bins; b++) f[b] = (b + 0.5) / bins;

  // lace ~ N(0.5, LACE_SIGMA), integrated over +/-4 sigma.
  const LN = 96;
  const lo = 0.5 - 4 * LACE_SIGMA;
  const hi = 0.5 + 4 * LACE_SIGMA;
  const step = (hi - lo) / LN;
  let total = 0;
  let mean = 0;
  for (let i = 0; i < LN; i++) {
    const lace = lo + step * (i + 0.5);
    const z = (lace - 0.5) / LACE_SIGMA;
    const pdf = Math.exp(-0.5 * z * z);
    for (let p = 0; p < push.length; p++) {
      const t = clamp01((lace + push[p] - thr) / width);
      const foam = t * t * (3 - 2 * t);
      const b = Math.min(bins - 1, Math.floor(foam * bins));
      w[b] += pdf;
      total += pdf;
      mean += foam * pdf;
    }
  }
  for (let b = 0; b < bins; b++) w[b] /= total;
  return { f, w, mean: mean / total };
}

/**
 * Scorecard #25: open-water mean luminance must land in 45-115 of 255.
 *
 * WHY THIS FUNCTION WAS REWRITTEN — IT PASSED A FRAME THAT MEASURED 210/255.
 * ------------------------------------------------------------------------
 * It used to run the BODY path only: flat water, no foam, no glint. It reported
 * 77.4 and PASS. The first rendered naval frame that actually contained water
 * measured 209.9 over open sea, with 27% of pixels above 235. The probe was not
 * wrong about the body — it was answering a question nobody had asked, because
 * the body is not what you are looking at.
 *
 * Ablations, in a real frame:
 *   glint 3.4 -> 0.0     209.9 -> 209.7   the glint is 0.2 of 210. Not the cause.
 *   foam on   -> off     201.7 ->  45.0   foam is essentially all of it.
 *
 * So foam is modelled here now, and modelled as a DISTRIBUTION rather than a
 * mean, because the tone map is non-linear and foam is close to a two-state
 * field — tonemapping the average is not the average of the tonemapped.
 *
 * Two things make foam dominate at coverage far below 100%:
 *   1. `lightFoam` uses a 0.80 sun coefficient against the body's
 *      `WATER_LOOK.sunDiffuse` of 0.30 — foam is lit 2.67x harder, before its
 *      near-white albedo and an HDR sun of ~(3.1, 2.8, 2.3).
 *   2. The mip-compensation threshold drop (`WATER_FOAM.distanceBias`) opens
 *      coverage up with distance, and `probeFoam` never modelled it.
 *
 * The glint is still excluded, and that is now a MEASURED decision rather than
 * an assumption: at 0.2 of 210 it is below the noise of everything else here.
 * If `WATER_GLINT.intensity` is ever raised substantially, re-measure before
 * trusting this number again.
 */
export function probeOpenWaterLuminance(
  palette: WaterPalette,
  rampDepth: number,
  rig: WaterLightRig,
  exposure: number,
  toneMode: 'agx' | 'aces' | 'none' = 'agx',
  opts: LuminanceProbeOptions = {},
): LuminanceProbe {
  const useFoam = opts.foam ?? true;
  const sea = opts.seaState ?? WATER_WAVES.seaState;
  const distFrac = opts.distanceFrac ?? 0.5;
  const ramp = resampleRamp(palette, WATER_LOOK.rampStops);
  const norm = lightNorm(rig);
  const k = WATER_LOOK.rampDepthMetres / Math.max(rampDepth, 0.25);
  const absorb = [palette.absorb[0] * k, palette.absorb[1] * k, palette.absorb[2] * k];
  const seabed = linearVec(palette.seabed);
  const fade = WATER_LOOK.seabedFadeMetres / k;

  // Flat water: N = up, so ndl = sunDir.y and the hemisphere reads pure sky.
  const ndl = Math.max(rig.sunDir.y, 0);
  const light = [
    (WATER_LOOK.sunDiffuse * ndl * rig.sunColor.x + WATER_LOOK.fillDiffuse * rig.hemiSky.x) / norm,
    (WATER_LOOK.sunDiffuse * ndl * rig.sunColor.y + WATER_LOOK.fillDiffuse * rig.hemiSky.y) / norm,
    (WATER_LOOK.sunDiffuse * ndl * rig.sunColor.z + WATER_LOOK.fillDiffuse * rig.hemiSky.z) / norm,
  ];

  // The foam layer, lit its own way. `lightFoam` in the shader is
  // `(0.80 * ndl * sun + 0.85 * hemi) / norm` — a 0.80 sun coefficient against
  // the body's 0.30. That 2.67x is most of why foam dominates the frame at a
  // coverage well under half.
  const foamCol = linearVec(palette.foam);
  const fs = WATER_LOOK.foamSunDiffuse;
  const ff = WATER_LOOK.foamFillDiffuse;
  const lightFoam = [
    (fs * ndl * rig.sunColor.x + ff * rig.hemiSky.x) / norm,
    (fs * ndl * rig.sunColor.y + ff * rig.hemiSky.y) / norm,
    (fs * ndl * rig.sunColor.z + ff * rig.hemiSky.z) / norm,
  ];
  const foamLin = [
    foamCol.x * lightFoam[0] * WATER_LOOK.outputGain * exposure,
    foamCol.y * lightFoam[1] * WATER_LOOK.outputGain * exposure,
    foamCol.z * lightFoam[2] * WATER_LOOK.outputGain * exposure,
  ];
  const hist = useFoam
    ? foamHistogram(sea, distFrac, 16)
    : { f: new Float64Array([0]), w: new Float64Array([1]), mean: 0 };

  const samples: number[] = [];
  const lin = [0, 0, 0];
  const tone = [0, 0, 0];
  const body0 = [0, 0, 0];
  // "Open water" = past the shore band. Sample the ramp evenly from a quarter
  // depth to the bottom; the first quarter is shelf, not open water.
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = 0.25 + (0.75 * i) / (N - 1);
    const depth = t * rampDepth;
    const f = clamp01(t) * (ramp.length - 1);
    const i0 = Math.min(ramp.length - 1, Math.floor(f));
    const i1 = Math.min(ramp.length - 1, i0 + 1);
    const g = f - i0;
    const body = [
      lerp(ramp[i0].x, ramp[i1].x, g),
      lerp(ramp[i0].y, ramp[i1].y, g),
      lerp(ramp[i0].z, ramp[i1].z, g),
    ];
    const cutoff = smoothstepDown(fade, fade * 0.35, depth);
    const trans = [
      Math.exp(-depth * absorb[0]) * cutoff,
      Math.exp(-depth * absorb[1]) * cutoff,
      Math.exp(-depth * absorb[2]) * cutoff,
    ];
    const bed = [seabed.x, seabed.y, seabed.z];
    for (let c = 0; c < 3; c++) {
      const mixed = lerp(body[c], bed[c] * trans[c], trans[1]);
      body0[c] = mixed * light[c] * WATER_LOOK.outputGain * exposure;
    }

    // Tone-map EACH foam bucket and average the results, never the other way
    // round. AgX is strongly compressive at the top, so averaging first would
    // hide exactly the blow-out this probe exists to catch.
    let acc = 0;
    for (let b = 0; b < hist.f.length; b++) {
      const wt = hist.w[b];
      if (wt <= 0) continue;
      const fr = hist.f[b];
      lin[0] = lerp(body0[0], foamLin[0], fr);
      lin[1] = lerp(body0[1], foamLin[1], fr);
      lin[2] = lerp(body0[2], foamLin[2], fr);
      if (toneMode === 'agx') toneAgx(lin, tone);
      else if (toneMode === 'aces') toneAces(lin, tone);
      else { tone[0] = lin[0]; tone[1] = lin[1]; tone[2] = lin[2]; }
      acc += wt * (
        0.2126 * linearToSrgb8(tone[0]) +
        0.7152 * linearToSrgb8(tone[1]) +
        0.0722 * linearToSrgb8(tone[2])
      );
    }
    samples.push(acc);
  }

  let mean = 0;
  for (let i = 0; i < samples.length; i++) mean += samples[i];
  mean /= samples.length;
  const band = WATER_LOOK.luminanceBand;
  return {
    mean, samples, foamCoverage: hist.mean,
    pass: mean >= band[0] && mean <= band[1],
  };
}

function smoothstepDown(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export interface FoamProbe {
  calm: number;
  choppy: number;
  /** Approximate filament width in px at 2560x1440, default zoom. */
  filamentPx: number;
  pass: boolean;
}

/**
 * Scorecard #26: filaments 1.5-4 px wide, coverage 4-8% calm / 12-16% choppy.
 *
 * The lace is a rank-transformed gaussian, so the coverage of
 * `smoothstep(thr, thr + w, lace + crestPush)` can be integrated exactly
 * instead of Monte-Carlo'd: average the gaussian tail probability over one
 * period of the crest. Filament width comes from the geometry — a network of
 * filaments of width `w` at spacing `s` covers about `2w/s`.
 */
export function probeFoam(
  seaStateCalm = WATER_WAVES.seaState, seaStateChoppy = 0.9, distanceFrac = 0.5,
): FoamProbe {
  // TWO CORRECTIONS, both of which made this report a number the shader never
  // produced, and both of which it certified as PASS:
  //
  //  1. `seaStateCalm` defaulted to 0.12. The game ships `WATER_WAVES.seaState`
  //     = 0.28. The probe was grading a sea state that does not exist in play.
  //  2. The mip-compensation threshold drop (`WATER_FOAM.distanceBias`, up to
  //     -0.03) was not modelled AT ALL, so this only ever described water at
  //     the camera. Most of a framed shot is not at the camera.
  //
  // It also modelled the crest as a bare `sin`, dropping both the
  // `(0.55 + 0.45 * sea)` normalisation `crestN` applies and the broader-topped
  // shape of `pow(|sin|, 0.6)`. `foamHistogram` is now the single
  // implementation, shared with `probeOpenWaterLuminance`, so the two cannot
  // disagree about what the shader does.
  const coverage = (sea: number): number => foamHistogram(sea, distanceFrac, 16).mean;
  const calm = coverage(seaStateCalm);
  const choppy = coverage(seaStateChoppy);
  // 4.4 ridge cells per tile -> spacing = tile / 4.4 metres; a 2D network
  // covers ~2w/s, and the reference camera resolves 29.6 px per metre.
  const spacing = WATER_FOAM.laceTileMetres / 4.4;
  const filamentPx = (calm * spacing * 0.5) * (207 / 7);
  const cc = WATER_FOAM.coverageCalm;
  const ch = WATER_FOAM.coverageChoppy;
  return {
    calm, choppy, filamentPx,
    pass: calm >= cc[0] && calm <= cc[1] && choppy >= ch[0] && choppy <= ch[1] &&
      filamentPx >= 1.5 && filamentPx <= 4.0,
  };
}

/** Abramowitz-Stegun 7.1.26, |error| < 1.5e-7. Plenty for a coverage estimate. */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 +
    t * (-1.453152027 + t * 1.061405429))));
  return s * (1 - poly * Math.exp(-a * a));
}

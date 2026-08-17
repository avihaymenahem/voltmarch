/**
 * ============================================================================
 * VOLTMARCH — src/vfx/vfx-material-constants.ts
 * ============================================================================
 * THE NUMBERS THE VFX SHADERS ARE TUNED ON, IN ONE PLACE.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * There are now TWO sets of VFX materials: the shipping `THREE.ShaderMaterial`s
 * in `./Particles.ts` and `./Beams.ts`, and the TSL node materials in
 * `./vfx-node-materials.ts` for the WebGPU / WebGL2-fallback path. Every number
 * below used to be a module-private `const` interpolated into a GLSL template
 * string. A second implementation that re-typed any of them would be a
 * brightness change on one renderer only — which is the shape of a bug this
 * project has now had reported SEVEN times, and six of those reports were
 * chasing a stacking behaviour that measured correct on the case being measured.
 *
 * `terrain-uniforms.ts` and `water-uniforms.ts` are the same idea for the ground
 * and the sea. Same rule as those two: **nothing in here may import TSL or emit
 * GLSL.** It is the shared vocabulary, not either implementation.
 *
 * WHAT IS *NOT* HERE, AND MUST NOT BE MOVED HERE
 * ----------------------------------------------
 * `./FlashBudget.ts`. The two-tier glare budget is CPU arithmetic that runs
 * before any of this — it returns a multiplier which the emitters fold into
 * `EmitDesc`'s intensity, and that intensity arrives at both shaders as the
 * SAME `aTint.x` instance attribute. **No shader reads the budget and no shader
 * can change it.** That is why porting these materials cannot move the
 * flash-stack numbers, and it is worth stating here rather than leaving the
 * next reader to prove it.
 * ============================================================================
 */

import * as THREE from 'three';
import { MathUtils } from 'three';
import { VFX_PX_REFERENCE_HEIGHT, VFX_RAMPS, VFX_SMOKE } from '../core/config';
import { hexToLinearRgb } from '../core/math';

/* ==========================================================================
 * 1. THE ADDITIVE HALO CURVE
 * ========================================================================== */

/**
 * Where the HDR gain starts collapsing toward 1.0 across a radial sprite, and
 * where it gets there.
 *
 * Pinned to the fireball ramp's own white-core stop (0.52) so the two cannot
 * drift apart. Inside the core the sprite keeps every bit of its authored gain
 * (scorecard #14 wants the brightest 40% at L>245); outside it the sprite falls
 * under the 1.05 bloom threshold within a fifth of its radius.
 *
 * The previous curve was `pow(1 - t, 0.6)`, which at t=0.87 still returned 1.95
 * against a fireball fringe of 1.0 linear in red — so the ENTIRE billow out to
 * t~0.96 sat above threshold and each of 8-14 billows fed the bloom mip chain as
 * a solid 18 m disc. That is the "glow on a tank explosion is too big" report,
 * and it was a shader curve rather than a bloom setting.
 */
export const VFX_HALO_T0 = 0.50;
export const VFX_HALO_T1 = 0.70;

/* ==========================================================================
 * 2. THE LIT-SMOKE DYNAMIC LIGHT
 * ========================================================================== */

/**
 * Gain on, and ceiling for, how much ONE VFX point light may add to a smoke
 * puff, in scene-linear.
 *
 * THIS PAIR IS THE FIX FOR THE WHITE-FRAME BUG in `05-combat` and
 * `08-naval-water`. `uFxColor` carries the light pool's RAW CANDELA and an
 * explosion light is peak 28 x the x5 exposure scale = 140; the old line added
 * that straight into `col` behind a bare 1/d^1.35 falloff, so a puff five metres
 * from a blast received +12.9 linear — forty-five times what the bible allows a
 * lit puff. 0.30 is bible §8.7's `#926339` fireball-lit underside, whose
 * brightest channel is 0.283 linear.
 */
export const VFX_LIT_FX_GAIN = 0.35;
export const VFX_LIT_FX_MAX = 0.30;

/** 1/PI. The dynamic term is IRRADIANCE, so it is multiplied by albedo and this. */
export const VFX_INV_PI = 0.3183098862;

/** The point light's distance falloff exponent, inside a squared range window. */
export const VFX_LIT_FX_FALLOFF_EXP = 1.35;

/** Sky/ground bounce weight in the puff's albedo sum. */
export const VFX_LIT_HEMI_GAIN = 0.22;

/** Sun-rim sharpness on a puff: `pow( max( ndl, 0 ), 3 )`. */
export const VFX_LIT_RIM_EXP = 3.0;

/* ==========================================================================
 * 3. SHARED SPRITE / RIBBON PARAMETERS
 * ========================================================================== */

/**
 * Below this the fragment is discarded rather than blended.
 *
 * Three sites use it — the atlas cutout, the composed sprite alpha and the
 * ribbon's cross-section — and at 1200 additive sprites a blended zero is real
 * overdraw for no pixels.
 */
export const VFX_ALPHA_CUTOFF = 0.003;

/** One row per ramp in the 16-row LUT. Bound as `uRowStep` on all three materials. */
export const VFX_ROW_STEP = 1 / VFX_RAMPS.length;

/**
 * Metres per REFERENCE PIXEL at one metre of view depth.
 *
 * `2 * tan(fovY/2) / 1440` — the whole reason a beam's width is authored in
 * pixels and stays that width at any zoom or resolution. `RibbonBatch.setFov`
 * and the node ribbon both call this, so a camera FOV change means the same
 * thing on both renderers.
 */
export function ribbonPxScale(fovDeg: number): number {
  return 2 * Math.tan(MathUtils.degToRad(fovDeg) * 0.5) / VFX_PX_REFERENCE_HEIGHT;
}

/** The FOV both ribbon batches are constructed at, before the camera speaks. */
export const RIBBON_DEFAULT_FOV_DEG = 36;

/* ==========================================================================
 * 4. THE LIT-SMOKE UNIFORM DEFAULTS
 *
 * Fourteen values, every one of which the GLSL material wrote out inline. They
 * are produced by a FUNCTION rather than exported as a frozen object because
 * both materials need their own mutable Vector3s — `syncLighting` and
 * `setDominantLight` write these every frame, and a shared Vector would make
 * one renderer's camera drive the other's.
 * ========================================================================== */

function linearVec3(hex: string): THREE.Vector3 {
  const out = new Float32Array(3);
  hexToLinearRgb(hex, out as unknown as number[]);
  return new THREE.Vector3(out[0], out[1], out[2]);
}

export function litSmokeDefaults() {
  return {
    uSunDirView: new THREE.Vector3(0, 1, 0),
    uSunColor: new THREE.Vector3(1, 0.87, 0.72),
    uUpView: new THREE.Vector3(0, 1, 0),
    uHemiSky: new THREE.Vector3(0.28, 0.42, 0.72),
    uHemiGround: new THREE.Vector3(0.18, 0.14, 0.10),
    uShadeDark: linearVec3(VFX_SMOKE.shadeDark),
    uShadeLit: linearVec3(VFX_SMOKE.shadeLit),
    uRimLit: linearVec3(VFX_SMOKE.rimLit),
    uTintGain: VFX_SMOKE.tintGain,
    uShadeGain: VFX_SMOKE.shadeGain,
    uRimGain: VFX_SMOKE.rimGain,
    /** Parked far below the map = inactive. Not zero: zero is a real position. */
    uFxPosView: new THREE.Vector3(0, -1e6, 0),
    uFxColor: new THREE.Vector3(0, 0, 0),
    uFxRange: 0,
  };
}

/* ==========================================================================
 * 5. THE DEBRIS MATERIAL
 *
 * The only opaque VFX material and the only one that casts a shadow. A stock
 * standard material on both paths, so the port is a class swap — but the four
 * numbers still live here so the swap cannot quietly re-roughen the chips.
 * ========================================================================== */

export const VFX_DEBRIS = {
  /** Constructed from three float components, i.e. these ARE linear. */
  color: [0.055, 0.048, 0.042] as const,
  roughness: 0.78,
  metalness: 0.35,
  flatShading: true,
} as const;

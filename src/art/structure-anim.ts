/**
 * ============================================================================
 * VOLTMARCH — src/art/structure-anim.ts
 * ============================================================================
 * EVERY NUMBER THE STRUCTURE ANIMATION SHADER USES, IN ONE TABLE.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * There are two structure materials now: `BuildingFactory.applyStructureShader`
 * (the shipping `MeshPhysicalMaterial` + `onBeforeCompile` GLSL) and
 * `StructureNodeMaterial.ts` (the TSL graph for the WebGPU/WebGL2 node path).
 * They animate the same buildings and must agree, to the last decimal, about
 * when a door opens and how hard a hit building soots.
 *
 * The obvious implementation is two sets of literals. That is precisely the
 * drift `docs/SPEC_DRIFT_AUDIT.md` catalogues — two tables that agree today, one
 * edited tomorrow, and a divergence nobody is looking for — so the numbers live
 * HERE, once, and both shaders read them. Same argument, same shape and the same
 * conclusion as `world/terrain-uniforms.ts`.
 *
 * TWO KINDS OF NUMBER, AND BOTH ARE HERE ON PURPOSE
 * -------------------------------------------------
 * Some are DERIVED from `BUILDING_ANIM` in `config.ts` (`damageOnset * 0.3`,
 * `burnFlickerHz * 6.28318`). Those carry the real drift risk: a config edit
 * reaches both paths automatically, but the derivation itself is a line of code
 * that could be changed in one place and not the other.
 *
 * The rest are shader TUNING constants that never had a home in `config.ts` —
 * the flicker's 0.68 floor, the emissive window mask's 6x gain, the door's 0.10
 * ramp. They were baked into a GLSL template string, which is a fine home for a
 * value with exactly one reader and a poor one for a value with two. They are
 * named here rather than re-typed there.
 *
 * `6.28318` IS NOT A TYPO AND IS NOT `GAIT_TURNS_TO_RADIANS`. The structure
 * shader has always used 6.28318 and the gait shader 6.2831853. Unifying them
 * would change the door phase and the burn flicker of every building in the
 * game by a few parts per million for no reason anyone asked for, so they stay
 * as two constants with two names.
 * ============================================================================
 */

import { BUILDING_ANIM } from '../core/config';
import { hexToLinearRgb } from '../core/math';

/** Turns to radians, as the STRUCTURE shader has always spelled it. */
const STRUCTURE_TAU = 6.28318;

/**
 * Every scalar the structure animation reads.
 *
 * The names match the GLSL locals wherever the GLSL had one, so the two shaders
 * can be diffed by eye.
 */
export const STRUCTURE_ANIM = {
  /* ---- the construction rise ------------------------------------------- */
  /** Metres of ground cut the bright scan line rides. */
  riseBandMeters: BUILDING_ANIM.riseBandMeters,
  /** Multiplier on the rise band's emissive. */
  riseBandGain: 2.2,

  /* ---- the bay door ----------------------------------------------------- */
  doorPeriodSeconds: BUILDING_ANIM.doorPeriodSeconds,
  /** The door is fully open by this fraction of the cycle. */
  doorRampFraction: 0.10,
  doorOpenFraction: BUILDING_ANIM.doorOpenFraction,
  /**
   * Where the door has finished closing.
   *
   * THE GLSL WROTE THIS AS A DESCENDING `smoothstep( 0.44, 0.30, ph )`, which is
   * merely unspecified in GLSL and is UNDEFINED in WGSL. The node path writes it
   * as `1 - smoothstep( 0.30, 0.44, ph )`, which is exactly equal because
   * S(1-t) === 1-S(t) for 3t^2-2t^3. Both edges are named here so neither shader
   * has to know which order the other uses.
   */
  doorCloseFraction: BUILDING_ANIM.doorOpenFraction + 0.14,

  /* ---- damage ----------------------------------------------------------- */
  /** Bible 8.8: a hurt structure soots, it does not recolour. */
  damageOnsetLo: BUILDING_ANIM.damageOnset * 0.3,
  damageOnset: BUILDING_ANIM.damageOnset,
  sootMultiplier: BUILDING_ANIM.sootMultiplier,

  /* ---- interior fire ---------------------------------------------------- */
  burnOnsetLo: BUILDING_ANIM.burnOnset * 0.2,
  burnOnset: BUILDING_ANIM.burnOnset,
  /**
   * The emissive map is already zero everywhere except the window plates, so it
   * doubles as the window mask; this is the gain that turns it into one.
   */
  burnMaskGain: 6.0,
  burnFlickerRadians: BUILDING_ANIM.burnFlickerHz * STRUCTURE_TAU,
  burnFlickerBase: 0.68,
  burnFlickerAmp: 0.32,
  /** Per-instance seed scale, so two burning buildings do not flicker in step. */
  burnFlickerSeedScale: 37.0,
  burnEmissiveGain: 2.4,

  /* ---- selection -------------------------------------------------------- */
  /** Readability comes from accents, never from raising the exposure (R5). */
  selectEmissive: BUILDING_ANIM.selectEmissive,
  selectPulseRadians: BUILDING_ANIM.selectPulseHz * STRUCTURE_TAU,
  selectPulseBase: 0.72,
  selectPulseAmp: 0.28,
} as const;

/* ==========================================================================
 * THE TWO COLOURS, IN LINEAR SPACE
 * ========================================================================== */

function linear(hex: string): readonly [number, number, number] {
  const out = new Float32Array(3);
  hexToLinearRgb(hex, out);
  return [out[0], out[1], out[2]];
}

/**
 * `lin()` in `BuildingFactory.ts` used to convert these at GLSL-emit time and
 * print them to four decimal places. It still prints them; it just reads the
 * floats from here, so the node path and the GLSL path convert ONCE and cannot
 * disagree about what `#FFB01E` means.
 */
export const STRUCTURE_ANIM_LINEAR = {
  burnColor: linear(BUILDING_ANIM.burnColor),
  riseBandColor: linear(BUILDING_ANIM.riseBandColor),
} as const;

/* ==========================================================================
 * THE FEATURE CODES
 *
 * `aFeature.x` is a small integer selected in the GLSL with pairs of `step()`
 * calls against half-open bands — `step(0.5, code) * step(code, 1.5)` is "code
 * is 1". The bands are written out here so the node path selects on the same
 * numbers rather than on a second reading of the same trick.
 * ========================================================================== */

export const STRUCTURE_FEATURE = {
  /** A pad never rises: its skirt is BELOW the origin on purpose. */
  pad: 1,
  /** A bay door retracts DOWNWARD into the floor. */
  door: 2,
  /** A radar sweep, about the model Y axis. */
  spin: 3,
} as const;

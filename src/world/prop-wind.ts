/**
 * ============================================================================
 * VOLTMARCH — src/world/prop-wind.ts
 * ============================================================================
 * THE WIND, IN ONE TABLE, READ BY BOTH PROP MATERIALS.
 *
 * `PropLibrary.createPropMaterial` is the shipping WebGL material and
 * `PropNodeMaterial.ts` is its TSL twin. They sway the same trees and must agree
 * about every coefficient, or a canopy leans one way on WebGL and another on
 * WebGPU — which is the "two grade baselines" risk in §4.5 of
 * `docs/WEBGPU_MIGRATION_PLAN.md`, arriving through the smallest possible door.
 *
 * The numbers were literals inside a GLSL template string, which is a fine home
 * for a value with exactly one reader and a poor one for a value with two.
 *
 * TWO HARMONICS, ON PURPOSE. `SCATTER_WIND.hz` sets the fundamental; the second
 * term at 2.37x and 2.11x is what stops the motion reading as one clean sine,
 * which is the difference between a forest and a metronome.
 * ============================================================================
 */

import { SCATTER_WIND } from '../core/config';

/** Radians per second. TAU is not imported: this is the only place it is used. */
const TAU = Math.PI * 2;

export const PROP_WIND = {
  /** Fundamental, in radians per second. */
  radiansPerSecond: SCATTER_WIND.hz * TAU,

  /**
   * The per-instance phase, taken off the instance's WORLD X and Z.
   *
   * Two irrational-looking coefficients rather than one, so two props on the
   * same row of a plantation grid do not land on the same phase. This is the one
   * quantity in this table the node path cannot reach for itself — see
   * `PropNodeMaterial.PROP_WIND_PHASE_ATTRIBUTE` and `STAGE_D_TSL_GAPS`.
   */
  phaseX: 0.113,
  phaseZ: 0.171,

  /** Weights of the first and second harmonic. They sum to 1. */
  harmonicA: 0.78,
  harmonicB: 0.22,

  /** Second harmonic of the X sway: rate, and how hard the phase detunes it. */
  xRateB: 2.37,
  xPhaseB: 0.7,

  /** First harmonic of the Z sway. Z leads with a cosine, so the tip traces an
   *  ellipse rather than a line. */
  zRateA: 0.83,
  zPhaseA: 1.31,
  /** Second harmonic of the Z sway. */
  zRateB: 2.11,

  /** Z sways less than X: the wind has a direction, even a procedural one. */
  zAmplitude: 0.72,
} as const;

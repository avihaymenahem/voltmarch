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

/**
 * THE PER-INSTANCE WIND PHASE, AS A REAL ATTRIBUTE. Published by `Scatter`,
 * consumed by `PropNodeMaterial`.
 *
 * The shipping GLSL does not need it — it reads the phase straight off the
 * instance transform:
 *
 *     swayPhase = instanceMatrix[3].x * phaseX + instanceMatrix[3].z * phaseZ
 *
 * `instanceMatrix` is not reachable from a shared TSL node material. three
 * builds it inside `createInstanceMatrixNode` from the mesh it is given — as a
 * uniform buffer for small counts and as an interleaved attribute for large ones
 * (`src/nodes/accessors/Instance.js`) — and never surfaces it as an accessor. A
 * material shared by every prop type in the game cannot ask for a specific
 * mesh's buffer, and the mesh is not known until the draw.
 *
 * WHY THE NAME LIVES HERE AND NOT IN `PropNodeMaterial.ts`, where it started.
 * `Scatter` is in the main bundle and `PropNodeMaterial` imports `three/webgpu`;
 * a `Scatter` that imported the constant from the material would pull the whole
 * node system into the WebGL build. `PropNodeMaterial` re-exports it, so the
 * shader side still reads as its owner.
 *
 * ONLY THE NODE PATH READS IT, and the four bytes an instance are spent on both
 * renderers anyway. `PropLibrary`'s GLSL was deliberately left on
 * `instanceMatrix[3]`: switching it would move the phase from a float32 computed
 * in the shader to a float64 computed on the CPU and rounded — the same number to
 * seven decimals, and `npm run shots` promises BYTE-identical captures. So the
 * two derive one quantity by two routes, and `tests/scatter-wind-phase.spec.ts`
 * pins them against each other instead of assuming they agree.
 */
export const PROP_WIND_PHASE_ATTRIBUTE = 'aSwayPhase';

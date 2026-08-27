/**
 * Shared CPU witnesses for the prop shader's deterministic life effects.
 *
 * The shader decides which lamp instances have a faulty ballast from the same
 * phase Scatter already derives from world XZ for foliage wind. Ground-story
 * composition uses this helper to avoid painting a permanent light pool below
 * a lamp whose head visibly cuts out.
 */

import { PROP_LIGHT_ANIM } from '../core/config';
import { fract } from '../core/math';
import { PROP_WIND } from './prop-wind';

/** The exact per-instance phase published by Scatter and reconstructed by GLSL. */
export function propLifePhase(x: number, z: number): number {
  return x * PROP_WIND.phaseX + z * PROP_WIND.phaseZ;
}

/** Must match the fault-selection expression in both prop material backends. */
export function isFaultyLampPhase(phase: number): boolean {
  const h = fract(Math.sin(phase * PROP_LIGHT_ANIM.faultHashFrequency)
    * PROP_LIGHT_ANIM.faultHashScale);
  return h >= 1 - PROP_LIGHT_ANIM.faultyFraction;
}

export function isFaultyLampAt(x: number, z: number): boolean {
  return isFaultyLampPhase(propLifePhase(x, z));
}

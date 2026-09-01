import type { SurfaceEnvironmentState } from '../world/surface-environment';

/**
 * WebGPU structure-material pilot coefficients.
 *
 * The shader consumes these as compile-time numbers, so changing weather only
 * mutates the one retained packed uniform. Foundation concrete is deliberately
 * more porous than coated architecture; painted panels mostly change their
 * roughness while exposed machinery and concrete take restrained colour change.
 */
export interface StructureSurfaceProfile {
  readonly wetPaintDarken: number;
  readonly wetPorousDarken: number;
  readonly wetPaintRoughnessDrop: number;
  readonly wetPorousRoughnessDrop: number;
  readonly dustTintStrength: number;
  readonly dustRoughnessGain: number;
  readonly contactDarken: number;
  readonly contactHeightMetres: number;
  readonly minimumRoughness: number;
}

export const STRUCTURE_SURFACE_PROFILES: Readonly<Record<'structure' | 'foundation', StructureSurfaceProfile>> = {
  structure: {
    wetPaintDarken: 0.010,
    wetPorousDarken: 0.052,
    wetPaintRoughnessDrop: 0.14,
    wetPorousRoughnessDrop: 0.075,
    dustTintStrength: 0.055,
    dustRoughnessGain: 0.026,
    contactDarken: 0.040,
    contactHeightMetres: 1.55,
    minimumRoughness: 0.34,
  },
  foundation: {
    wetPaintDarken: 0.038,
    wetPorousDarken: 0.072,
    wetPaintRoughnessDrop: 0.09,
    wetPorousRoughnessDrop: 0.12,
    dustTintStrength: 0.075,
    dustRoughnessGain: 0.034,
    contactDarken: 0.052,
    contactHeightMetres: 0.72,
    minimumRoughness: 0.66,
  },
};

export const STRUCTURE_DUST_TINT_LINEAR = [0.48, 0.36, 0.24] as const;

export interface StructureSurfaceResponse {
  readonly wetDarken: number;
  readonly roughnessDelta: number;
  readonly dustTint: number;
  readonly contactDarken: number;
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** CPU reference used by contract tests and tuning tools; the TSL graph mirrors it. */
export function solveStructureSurfaceResponse(
  profile: StructureSurfaceProfile,
  environment: SurfaceEnvironmentState,
  paintedMask: number,
  upwardNormal: number,
  localHeightMetres: number,
): StructureSurfaceResponse {
  const painted = clamp01(paintedMask);
  const porous = 1 - painted;
  const wet = clamp01(environment.wetness);
  const up = clamp01(upwardNormal);
  const dust = clamp01(environment.dust) * up * up * (porous + painted * 0.18) * (1 - wet * 0.82);
  const contact = clamp01(environment.contact)
    * (1 - clamp01(Math.abs(localHeightMetres) / profile.contactHeightMetres));
  return {
    wetDarken: wet * (
      profile.wetPorousDarken * porous + profile.wetPaintDarken * painted
    ),
    roughnessDelta: dust * profile.dustRoughnessGain - wet * (
      profile.wetPorousRoughnessDrop * porous + profile.wetPaintRoughnessDrop * painted
    ),
    dustTint: dust * profile.dustTintStrength,
    contactDarken: contact * profile.contactDarken,
  };
}

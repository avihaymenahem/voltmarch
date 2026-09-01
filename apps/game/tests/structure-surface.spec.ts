import { describe, expect, it } from 'vitest';
import {
  STRUCTURE_SURFACE_PROFILES, solveStructureSurfaceResponse,
} from '../src/art/structure-surface';
import type { SurfaceEnvironmentState } from '../src/world/surface-environment';

function environment(
  patch: Partial<SurfaceEnvironmentState> = {},
): SurfaceEnvironmentState {
  return {
    dayPhase: 0,
    wetness: 0,
    snow: 0,
    dust: 0,
    shoreWetness: 0,
    salt: 0,
    snowContamination: 0,
    contact: 0,
    ...patch,
  };
}

describe('WebGPU structure surface pilot', () => {
  it('does nothing when no physical cause is present', () => {
    expect(solveStructureSurfaceResponse(
      STRUCTURE_SURFACE_PROFILES.structure,
      environment(),
      1,
      1,
      0,
    )).toEqual({ wetDarken: 0, roughnessDelta: 0, dustTint: 0, contactDarken: 0 });
  });

  it('changes coated paint mainly through roughness when wet', () => {
    const painted = solveStructureSurfaceResponse(
      STRUCTURE_SURFACE_PROFILES.structure,
      environment({ wetness: 1 }),
      1,
      1,
      2,
    );
    const porous = solveStructureSurfaceResponse(
      STRUCTURE_SURFACE_PROFILES.structure,
      environment({ wetness: 1 }),
      0,
      1,
      2,
    );
    expect(painted.roughnessDelta).toBeLessThan(-0.1);
    expect(painted.wetDarken).toBeLessThan(porous.wetDarken * 0.25);
  });

  it('keeps dust orientation- and material-class-dependent', () => {
    const upwardConcrete = solveStructureSurfaceResponse(
      STRUCTURE_SURFACE_PROFILES.foundation,
      environment({ dust: 1 }),
      0,
      1,
      1,
    );
    const verticalPaint = solveStructureSurfaceResponse(
      STRUCTURE_SURFACE_PROFILES.structure,
      environment({ dust: 1 }),
      1,
      0,
      1,
    );
    expect(upwardConcrete.dustTint).toBeGreaterThan(0.05);
    expect(verticalPaint.dustTint).toBe(0);
  });

  it('bounds contact contamination to the foundation band', () => {
    const atGround = solveStructureSurfaceResponse(
      STRUCTURE_SURFACE_PROFILES.foundation,
      environment({ contact: 1 }),
      0,
      1,
      0,
    );
    const aboveBand = solveStructureSurfaceResponse(
      STRUCTURE_SURFACE_PROFILES.foundation,
      environment({ contact: 1 }),
      0,
      1,
      2,
    );
    expect(atGround.contactDarken).toBe(STRUCTURE_SURFACE_PROFILES.foundation.contactDarken);
    expect(aboveBand.contactDarken).toBe(0);
  });
});

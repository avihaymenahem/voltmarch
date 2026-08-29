import { describe, expect, it } from 'vitest';

import { vfxDensityAtPressure } from '../src/vfx/pressure-density';

describe('combat VFX pressure density', () => {
  it('preserves authored density under normal load', () => {
    expect(vfxDensityAtPressure(0)).toBe(1);
    expect(vfxDensityAtPressure(0.55)).toBe(1);
  });

  it('smoothly sheds redundant particles as a pool fills', () => {
    expect(vfxDensityAtPressure(0.725)).toBeCloseTo(0.625, 6);
    expect(vfxDensityAtPressure(0.9)).toBe(0.25);
    expect(vfxDensityAtPressure(1)).toBe(0.25);
  });

  it('fails safe for invalid telemetry', () => {
    expect(vfxDensityAtPressure(Number.NaN)).toBe(1);
  });
});

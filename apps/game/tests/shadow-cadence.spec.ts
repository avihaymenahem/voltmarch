import { describe, expect, it } from 'vitest';
import {
  ShadowCadence,
  shadowCadenceModeFromSearch,
} from '../src/render/shadow-cadence';

describe('ShadowCadence', () => {
  it('updates stable 60 Hz presentation at 30 Hz', () => {
    const cadence = new ShadowCadence('adaptive');
    expect([0, 1, 2, 3, 4].map(() => cadence.shouldUpdate(1 / 60)))
      .toEqual([true, false, true, false, true]);
  });

  it('does not skip frames at 30 fps or below', () => {
    const cadence = new ShadowCadence('adaptive');
    expect([0, 1, 2, 3].map(() => cadence.shouldUpdate(1 / 30)))
      .toEqual([true, true, true, true]);
  });

  it('forces camera movement immediately and restarts the stable interval', () => {
    const cadence = new ShadowCadence('adaptive');
    expect(cadence.shouldUpdate(1 / 60)).toBe(true);
    expect(cadence.shouldUpdate(1 / 60)).toBe(false);
    expect(cadence.shouldUpdate(1 / 60, true)).toBe(true);
    expect(cadence.shouldUpdate(1 / 60)).toBe(false);
    expect(cadence.shouldUpdate(1 / 60)).toBe(true);
  });

  it('offers deterministic full and alternating A/B modes', () => {
    const legacy = new ShadowCadence('legacy');
    expect([0, 1, 2].map(() => legacy.shouldUpdate(1 / 30)))
      .toEqual([true, true, true]);

    const half = new ShadowCadence('half');
    expect([0, 1, 2, 3, 4].map(() => half.shouldUpdate(1 / 30)))
      .toEqual([true, false, true, false, true]);
  });

  it('parses benchmark aliases and defaults safely', () => {
    expect(shadowCadenceModeFromSearch('?shadowcadence=legacy')).toBe('legacy');
    expect(shadowCadenceModeFromSearch('shadowcadence=alternate')).toBe('half');
    expect(shadowCadenceModeFromSearch('?shadowcadence=unknown')).toBe('adaptive');
  });
});

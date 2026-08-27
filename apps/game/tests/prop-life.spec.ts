import { describe, expect, it } from 'vitest';

import { PROP_LIGHT_ANIM } from '../src/core/config';
import { PropLibrary } from '../src/world/PropLibrary';
import { isFaultyLampAt, isFaultyLampPhase, propLifePhase } from '../src/world/prop-life';

describe('map-life prop fixtures', () => {
  it('selects a deterministic sparse subset of lamps for faulty ballasts', () => {
    let faulty = 0;
    const samples = 4096;
    for (let i = 0; i < samples; i++) {
      const x = (i * 17.31) % 512;
      const z = (i * 43.07) % 512;
      const phase = propLifePhase(x, z);
      expect(isFaultyLampAt(x, z)).toBe(isFaultyLampPhase(phase));
      if (isFaultyLampAt(x, z)) faulty++;
    }
    expect(faulty / samples).toBeGreaterThan(PROP_LIGHT_ANIM.faultyFraction - 0.025);
    expect(faulty / samples).toBeLessThan(PROP_LIGHT_ANIM.faultyFraction + 0.025);
  });

  it('encodes fault-capable lamps and independently timed traffic lenses', () => {
    const lib = new PropLibrary({ biome: 'urban', seed: 0x51a77e });
    const codes = (key: string): Set<number> => {
      const surface = lib.get(key)!.geometry.getAttribute('aSurface');
      const found = new Set<number>();
      for (let i = 0; i < surface.count; i++) found.add(Math.round(surface.getX(i)));
      return found;
    };

    expect(codes('streetLamp')).toContain(PROP_LIGHT_ANIM.faultCapableCode);
    expect(codes('streetLampTwin')).toContain(PROP_LIGHT_ANIM.faultCapableCode);
    const signal = codes('trafficLight');
    expect(signal).toContain(PROP_LIGHT_ANIM.signalRedCode);
    expect(signal).toContain(PROP_LIGHT_ANIM.signalAmberCode);
    expect(signal).toContain(PROP_LIGHT_ANIM.signalGreenCode);
    lib.dispose();
  });
});

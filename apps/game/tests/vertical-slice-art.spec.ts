import { describe, expect, it } from 'vitest';

import { GreebleFactory } from '../src/art/Greeble';
import { MERIDIAN_UNIT_MASS_BY_KEY, MERIDIAN_UNIT_PALETTE } from '../src/art/Faction3Units';
import { RECLAIM_UNIT_MASS_BY_KEY, RECLAIM_UNIT_PALETTE } from '../src/art/Faction4Units';
import { UNIT_MASS_BY_KEY } from '../src/art/UnitDefs';
import { UnitLibrary } from '../src/art/UnitFactory';
import { RA3_ALLIES, RA3_SOVIETS } from '../src/core/config';

describe('the four-faction vertical slice', () => {
  it('keeps the main armour readable and within the merged-geometry budget', () => {
    const cases = [
      [UNIT_MASS_BY_KEY.get('allied_guardian')!, RA3_ALLIES, 0x4111],
      [UNIT_MASS_BY_KEY.get('soviet_rhino')!, RA3_SOVIETS, 0x5077],
      [MERIDIAN_UNIT_MASS_BY_KEY.get('meridian_solarch')!, MERIDIAN_UNIT_PALETTE, 0x4d52],
      [RECLAIM_UNIT_MASS_BY_KEY.get('reclaim_grinder')!, RECLAIM_UNIT_PALETTE, 0x5243],
    ] as const;
    const library = new UnitLibrary(new GreebleFactory());
    const signatures = new Set<string>();

    for (const [list, palette, seed] of cases) {
      const stats = library.build(list, palette, 256, seed).stats;
      expect(stats.errors, list.key).toEqual([]);
      expect(stats.triangles, list.key).toBeLessThan(8000);
      expect(stats.factionColourFraction, list.key).toBeGreaterThan(stats.teamFraction);
      signatures.add(`${stats.bounds.join('x')}@${stats.triangles}`);
    }
    expect(signatures.size).toBe(cases.length);
  });
});

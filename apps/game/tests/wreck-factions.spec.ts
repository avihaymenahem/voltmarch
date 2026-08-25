import { describe, expect, it } from 'vitest';

import {
  buildWreckSet, type WreckFaction,
} from '../src/art/Wrecks';
import { propPalette } from '../src/world/PropLibrary';

const FACTIONS: readonly WreckFaction[] = [
  'allies', 'soviets', 'meridian', 'reclaim', 'neutral',
];

function fingerprint(values: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) {
    const q = Math.round(values[i] * 10_000);
    h ^= q;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('V2 faction wrecks', () => {
  it('builds a deterministic hulk and ruin for every playable faction', () => {
    const set = buildWreckSet(propPalette('temperate'), {
      factions: FACTIONS,
      classes: ['medium'],
      sizes: ['small'],
    });
    try {
      expect(set.vehicles.size).toBe(FACTIONS.length);
      expect(set.rubble.size).toBe(FACTIONS.length);
      for (const faction of FACTIONS) {
        expect(set.hulk(faction, 'medium').name).toBe(`wreck.${faction}.medium`);
        expect(set.ruin(faction, 'small').name).toBe(`rubble.${faction}.small`);
      }
    } finally {
      set.dispose();
    }
  });

  it('does not collapse the five hulks to one neutral geometry', () => {
    const set = buildWreckSet(propPalette('temperate'), {
      factions: FACTIONS,
      classes: ['medium'],
      sizes: [],
    });
    try {
      const shapes = new Set(FACTIONS.map((faction) => fingerprint(
        set.hulk(faction, 'medium').getAttribute('position').array,
      )));
      expect(shapes.size).toBe(FACTIONS.length);
    } finally {
      set.dispose();
    }
  });
});

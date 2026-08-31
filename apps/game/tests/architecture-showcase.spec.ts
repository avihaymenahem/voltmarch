import { describe, expect, it } from 'vitest';

import { Faction } from '../src/core/types';
import { BUILDINGS } from '../src/data/Defs';
import { ARCHITECTURE_SHOWCASE_LANES } from '../src/game/scenarios/Showcases';

const factionLabel = (faction: Faction): string => {
  switch (faction) {
    case Faction.Allies: return 'Allies';
    case Faction.Soviets: return 'Soviets';
    case Faction.Meridian: return 'Meridian';
    case Faction.Reclaim: return 'Reclaim';
    default: return `Faction ${Number(faction)}`;
  }
};

describe('architecture showcase roster', () => {
  it('contains one comparison lane for every playable faction', () => {
    expect(ARCHITECTURE_SHOWCASE_LANES.map((lane) => lane.faction)).toEqual([
      Faction.Allies,
      Faction.Soviets,
      Faction.Meridian,
      Faction.Reclaim,
    ]);
  });

  it('keeps a fixed six-by-three role grid without duplicate structures', () => {
    const expectedCounts = [18, 18, 16, 16];
    for (let i = 0; i < ARCHITECTURE_SHOWCASE_LANES.length; i++) {
      const keys = ARCHITECTURE_SHOWCASE_LANES[i].buildings.filter(
        (key): key is string => key !== null,
      );
      expect(ARCHITECTURE_SHOWCASE_LANES[i].buildings).toHaveLength(18);
      expect(keys).toHaveLength(expectedCounts[i]);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('references only real building definitions', () => {
    const catalog = new Set(BUILDINGS.map((building) => building.key));
    for (const lane of ARCHITECTURE_SHOWCASE_LANES) {
      for (const key of lane.buildings) {
        if (key !== null) expect(catalog.has(key), `${factionLabel(lane.faction)}/${key}`).toBe(true);
      }
    }
  });

  it('covers every faction-exclusive Meridian and Reclamation structure', () => {
    for (const faction of [Faction.Meridian, Faction.Reclaim] as const) {
      const lane = ARCHITECTURE_SHOWCASE_LANES.find((candidate) => candidate.faction === faction)!;
      const shown = new Set(lane.buildings.filter((key): key is string => key !== null));
      const factionKeys = BUILDINGS
        .filter((building) => building.faction === faction)
        .map((building) => building.key);
      expect([...factionKeys].sort()).toEqual([...shown].sort());
    }
  });
});

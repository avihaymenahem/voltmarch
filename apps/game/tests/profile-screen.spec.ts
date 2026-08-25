/** Service Record: pure rendering models over the real mission catalogue. */

import { describe, expect, it } from 'vitest';

import { Faction } from '../src/core/types';
import { MISSIONS, UNLOCKS } from '../src/data/Missions';
import type { CatalogueEntry, ProfileView } from '../src/ui/Objectives';
import {
  careerRecord,
  cosmeticCollection,
  cosmeticName,
  factionCareerRows,
} from '../src/shell/Profile';
import { cosmeticKind } from '../src/shell/CosmeticMarks';
import type { FactionOption } from '../src/shell/Shell';

function catalogue(completed: readonly string[] = []): CatalogueEntry[] {
  const done = new Set(completed);
  return MISSIONS.map((mission) => ({
    ...mission,
    locked: false,
    progress: {
      id: mission.id,
      value: done.has(mission.id) ? mission.target : 0,
      target: mission.target,
      complete: done.has(mission.id),
      claimedAt: done.has(mission.id) ? 1234 : null,
    },
  }));
}

function profile(over: Partial<ProfileView> = {}): ProfileView {
  return {
    version: 4,
    createdAt: 1,
    updatedAt: 2,
    unlocked: [],
    missions: [],
    stats: {
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      currentStreak: 0,
      bestStreak: 0,
      winsByFaction: {},
    },
    campaign: {},
    ...over,
  };
}

describe('Service Record honours collection', () => {
  it('derives every shipped cosmetic from mission rewards without a second catalogue', () => {
    const awards = cosmeticCollection(catalogue(), []);
    expect(awards).toHaveLength(17);
    expect(awards.filter((a) => a.kind === 'insignia')).toHaveLength(10);
    expect(awards.filter((a) => a.kind === 'decal')).toHaveLength(7);
    expect(new Set(awards.map((a) => a.id)).size).toBe(awards.length);
  });

  it('joins durable ownership while preserving the mission that paid each award', () => {
    const awards = cosmeticCollection(catalogue(['tactics.streak.1']), [UNLOCKS.insigniaGold]);
    const gold = awards.find((a) => a.id === UNLOCKS.insigniaGold);
    expect(gold).toMatchObject({
      earned: true,
      kind: 'insignia',
      name: 'Gold',
      missionId: 'tactics.streak.1',
      complete: true,
    });
  });

  it('does not mistake the generic unlock twin for a second cosmetic', () => {
    const ids = cosmeticCollection(catalogue(), []).map((a) => a.id);
    expect(ids.filter((id) => id === UNLOCKS.decalGrid)).toHaveLength(1);
  });

  it('humanises both known and defensive ids', () => {
    expect(cosmeticName('cosmetic.insignia.unbroken')).toBe('Unbroken');
    expect(cosmeticName('cosmetic.decal.centurion')).toBe('Centurion');
    expect(cosmeticName('odd_reward')).toBe('Odd Reward');
  });

  it('classifies only the two cosmetic namespaces the renderer understands', () => {
    expect(cosmeticKind('cosmetic.insignia.gold')).toBe('insignia');
    expect(cosmeticKind('cosmetic.decal.grid')).toBe('decal');
    expect(cosmeticKind('unit.soviet.rhino')).toBeNull();
  });
});

describe('Service Record career model', () => {
  it('renders the lifetime counters, mission completion, medals and win rate', () => {
    const rows = catalogue(['tactics.wins.1', 'tactics.streak.1']);
    const p = profile({
      unlocked: [UNLOCKS.insigniaBronze, UNLOCKS.insigniaGold],
      stats: {
        matchesPlayed: 20,
        wins: 13,
        losses: 7,
        currentStreak: 3,
        bestStreak: 6,
        winsByFaction: { [Faction.Allies]: 8, [Faction.Soviets]: 5 },
      },
      campaign: { op1: 3, op2: 1, op3: 0 },
    });
    expect(careerRecord(p, rows)).toMatchObject({
      matches: 20,
      wins: 13,
      losses: 7,
      currentStreak: 3,
      bestStreak: 6,
      winRate: 65,
      missionsComplete: 2,
      operationsComplete: 2,
      goldOperations: 1,
      honoursEarned: 2,
      honoursTotal: 17,
    });
  });

  it('fails soft for an older view with no stats', () => {
    const p = profile({ stats: undefined });
    expect(careerRecord(p, catalogue())).toMatchObject({ matches: 0, wins: 0, winRate: 0 });
  });

  it('maps enum-keyed wins onto the live faction table', () => {
    const factions: FactionOption[] = [
      { key: 'allies', name: 'Allied Forces', id: Faction.Allies, color: '#36c', blurb: '' },
      { key: 'soviets', name: 'Soviet Union', id: Faction.Soviets, color: '#c33', blurb: '' },
    ];
    const p = profile({
      stats: {
        matchesPlayed: 9, wins: 9, losses: 0, currentStreak: 9, bestStreak: 9,
        winsByFaction: { [Faction.Allies]: 4, [Faction.Soviets]: 5 },
      },
    });
    expect(factionCareerRows(p, factions).map((f) => [f.key, f.wins]))
      .toEqual([['allies', 4], ['soviets', 5]]);
  });
});

/**
 * PROGRESSION UI — the falsifiable half.
 *
 * `src/ui/Objectives.ts` and `src/shell/Missions.ts` are mostly DOM, and the
 * suite runs under `environment: 'node'` like the rest of the repo, so the
 * panels themselves are covered by booting the page (the screenshot harness's
 * job). What IS covered here is every decision those panels make before they
 * touch an element:
 *
 *   - the handle probe, which must reject a half-published progression object
 *     rather than let a `?shot=` boot throw inside the HUD;
 *   - the visible-objective policy, which is the concrete answer to the design
 *     doc's "objective spam. Cap the visible set";
 *   - chain construction, which walks author-supplied `requires` ids and must
 *     survive a cycle and a dangling reference without hanging the front end;
 *   - the reward copy, which is the only thing standing between an unlock id
 *     and a sentence a player reads.
 *
 * `src/ui/Objectives.ts` is imported directly because it deliberately depends
 * on nothing but `Chrome`/`icons`. `src/shell/Missions.ts` is imported for its
 * pure exports only; it reaches the shell's DOM kit, which is why nothing here
 * constructs a `MissionsPanel`.
 */

import { describe, expect, it } from 'vitest';

import {
  COMPLETE_HOLD_SECONDS,
  MAX_VISIBLE_OBJECTIVES,
  objectiveFraction,
  objectiveReadout,
  objectiveSignature,
  readProgression,
  selectVisibleObjectives,
  type ActiveObjective,
  type CatalogueEntry,
  type MissionProgress,
  type ProgressionView,
} from '../src/ui/Objectives';

import {
  MISSION_CATEGORIES,
  buildChains,
  humaniseId,
  missionState,
  rewardCopy,
  summarise,
  unlockLabel,
} from '../src/shell/Missions';

import type {
  MissionEntry as CoreMissionEntry,
  ObjectiveEntry as CoreObjectiveEntry,
  ProgressionView as CoreProgressionView,
  Reward as CoreReward,
} from '../src/progression/types';

/* ==========================================================================
 * THE CONTRACT SEAM
 *
 * `src/ui/Objectives.ts` restates the frozen contract STRUCTURALLY instead of
 * importing `src/progression/types.ts`, so the HUD compiles, ships and boots
 * with the whole progression layer absent — which is the state a `?shot=`
 * capture runs in, and the state this repository was in while both modules were
 * being written.
 *
 * The cost of that choice is drift, and this is where it is paid. These four
 * assertions fail to compile the moment the real contract stops satisfying the
 * seam the UI codes against, which is the only failure mode the duplication can
 * produce. They live in the test program rather than in `src/**` on purpose: a
 * check that would break the GAME if the progression module were removed would
 * defeat the point of the seam existing.
 * ========================================================================== */

/** `T` must be assignable to `U`, checked at compile time. */
type AssertAssignable<T extends U, U> = T;

type _ViewFitsSeam = AssertAssignable<CoreProgressionView, ProgressionView>;
type _EntryFitsSeam = AssertAssignable<CoreMissionEntry, CatalogueEntry>;
type _ObjectiveFitsSeam = AssertAssignable<CoreObjectiveEntry, ActiveObjective>;
type _RewardFitsSeam = AssertAssignable<CoreReward, Parameters<typeof rewardCopy>[0]>;

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

function progress(over: Partial<MissionProgress> = {}): MissionProgress {
  return { id: 'm', value: 0, target: 10, complete: false, claimedAt: null, ...over };
}

function objective(id: string, over: Partial<MissionProgress> = {}): ActiveObjective {
  return {
    id,
    scope: 'match',
    title: id.toUpperCase(),
    description: `do ${id}`,
    category: 'combat',
    target: 10,
    reward: [],
    progress: progress({ id, ...over }),
  };
}

function entry(
  id: string,
  over: Partial<CatalogueEntry> = {},
): CatalogueEntry {
  return {
    id,
    scope: 'profile',
    title: id.toUpperCase(),
    description: `do ${id}`,
    category: 'combat',
    target: 10,
    reward: [],
    locked: false,
    progress: progress({ id }),
    ...over,
  };
}

/** A minimal object that satisfies the frozen `ProgressionView` contract. */
function stubView(over: Partial<ProgressionView> = {}): ProgressionView {
  return {
    profile: () => ({ version: 1, unlocked: [], missions: [] }),
    catalogue: () => [],
    activeObjectives: () => [],
    drainPending: () => [],
    isUnlocked: () => false,
    subscribe: () => () => undefined,
    resetProfile: () => undefined,
    exportProfile: () => '{}',
    importProfile: () => true,
    ...over,
  };
}

/* ==========================================================================
 * THE HANDLE PROBE
 * ========================================================================== */

describe('readProgression — degrades rather than throws', () => {
  const g = globalThis as { __vmProgression?: unknown };

  it('returns null when nothing has published a handle', () => {
    delete g.__vmProgression;
    expect(readProgression()).toBeNull();
  });

  it('returns null for junk, including things that are nearly right', () => {
    for (const junk of [null, undefined, 0, 'nope', [], true, {}, { catalogue: 1 }]) {
      g.__vmProgression = junk;
      expect(readProgression()).toBeNull();
    }
    // Every member but one: a module still wiring itself up must not be used.
    const partial = stubView() as unknown as Record<string, unknown>;
    delete partial.drainPending;
    g.__vmProgression = partial;
    expect(readProgression()).toBeNull();
    delete g.__vmProgression;
  });

  it('accepts a complete handle', () => {
    const view = stubView();
    g.__vmProgression = view;
    expect(readProgression()).toBe(view);
    delete g.__vmProgression;
  });
});

/* ==========================================================================
 * OBJECTIVE READOUTS
 * ========================================================================== */

describe('objective readouts', () => {
  it('clamps the fraction into 0..1 for any data', () => {
    expect(objectiveFraction(progress({ value: -5 }))).toBe(0);
    expect(objectiveFraction(progress({ value: 5 }))).toBe(0.5);
    expect(objectiveFraction(progress({ value: 999 }))).toBe(1);
    expect(objectiveFraction(progress({ value: 0, complete: true }))).toBe(1);
  });

  it('survives a zero target instead of producing NaN', () => {
    expect(objectiveFraction(progress({ target: 0, value: 0 }))).toBe(0);
    expect(Number.isFinite(objectiveFraction(progress({ target: 0, value: 3 })))).toBe(true);
  });

  it('reads a flag mission as a flag, not as 0 / 1 progress', () => {
    expect(objectiveReadout(progress({ target: 1 }))).toBe('0 / 1');
    expect(objectiveReadout(progress({ target: 1, complete: true }))).toBe('DONE');
    expect(objectiveReadout(progress({ target: 25, value: 12.7 }))).toBe('12 / 25');
  });
});

/* ==========================================================================
 * THE VISIBLE SET — the cure for objective spam
 * ========================================================================== */

describe('selectVisibleObjectives', () => {
  it('never shows more than the cap, and reports the overflow', () => {
    const active = ['a', 'b', 'c', 'd', 'e'].map((id) => objective(id));
    const { rows, overflow } = selectVisibleObjectives(active, new Map(), 0);
    expect(rows.length).toBe(MAX_VISIBLE_OBJECTIVES);
    expect(overflow).toBe(active.length - MAX_VISIBLE_OBJECTIVES);
  });

  it('keeps the provider order for live objectives', () => {
    const active = ['a', 'b', 'c'].map((id) => objective(id));
    const { rows } = selectVisibleObjectives(active, new Map(), 0);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('promotes a freshly completed objective above live ones', () => {
    const active = [objective('a'), objective('b'), objective('done', { complete: true })];
    const doneAt = new Map([['done', 100]]);
    const { rows } = selectVisibleObjectives(active, doneAt, 101);
    expect(rows[0].id).toBe('done');
  });

  it('demotes a completion once its hold window has passed', () => {
    const active = [objective('a'), objective('b'), objective('done', { complete: true })];
    const doneAt = new Map([['done', 0]]);
    const { rows } = selectVisibleObjectives(active, doneAt, COMPLETE_HOLD_SECONDS + 1);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'done']);
  });

  it('treats a completion nobody stamped as stale rather than fresh', () => {
    const active = [objective('a'), objective('done', { complete: true })];
    const { rows } = selectVisibleObjectives(active, new Map(), 500);
    expect(rows[0].id).toBe('a');
  });

  it('shows nothing, and claims no overflow, for an empty match', () => {
    const { rows, overflow } = selectVisibleObjectives([], new Map(), 0);
    expect(rows).toEqual([]);
    expect(overflow).toBe(0);
  });
});

describe('objectiveSignature', () => {
  it('moves when a counter moves and holds still otherwise', () => {
    const a = [objective('x', { value: 3 })];
    const b = [objective('x', { value: 3 })];
    const c = [objective('x', { value: 4 })];
    expect(objectiveSignature(a, 0)).toBe(objectiveSignature(b, 0));
    expect(objectiveSignature(a, 0)).not.toBe(objectiveSignature(c, 0));
  });

  it('moves when only the overflow count changes', () => {
    const rows = [objective('x')];
    expect(objectiveSignature(rows, 0)).not.toBe(objectiveSignature(rows, 2));
  });

  it('moves on completion even at an unchanged value', () => {
    const open = [objective('x', { value: 10 })];
    const done = [objective('x', { value: 10, complete: true })];
    expect(objectiveSignature(open, 0)).not.toBe(objectiveSignature(done, 0));
  });
});

/* ==========================================================================
 * REWARD COPY
 * ========================================================================== */

describe('humaniseId', () => {
  it('handles every id shape the contract permits', () => {
    expect(humaniseId('prism-tank')).toBe('Prism Tank');
    expect(humaniseId('prism_tank')).toBe('Prism Tank');
    expect(humaniseId('prismTank')).toBe('Prism Tank');
    expect(humaniseId('map.canyon')).toBe('Map Canyon');
    expect(humaniseId('unit:v4_launcher')).toBe('Unit V4 Launcher');
  });

  it('never returns an empty string', () => {
    expect(humaniseId('')).toBe('Unknown');
    expect(humaniseId('---')).toBe('Unknown');
  });
});

describe('unlockLabel', () => {
  it('drops the namespace the kind label already states', () => {
    expect(unlockLabel('unit.raider')).toBe('Raider');
    expect(unlockLabel('struct.defence.specialist')).toBe('Defence Specialist');
    expect(unlockLabel('power.orbital-scan')).toBe('Orbital Scan');
    expect(unlockLabel('map.frozen-sector')).toBe('Frozen Sector');
  });

  it('keeps a second token that is part of the name', () => {
    expect(unlockLabel('cosmetic.decal.grid')).toBe('Decal Grid');
    expect(unlockLabel('cosmetic.insignia.warlord')).toBe('Insignia Warlord');
  });

  it('leaves an id alone when the leading token is not a namespace', () => {
    expect(unlockLabel('frozen-sector')).toBe('Frozen Sector');
    expect(unlockLabel('chrono.sphere')).toBe('Chrono Sphere');
  });

  it('never strips an id down to nothing', () => {
    expect(unlockLabel('unit.')).toBe('Unit');
    expect(unlockLabel('unit')).toBe('Unit');
  });
});

describe('rewardCopy', () => {
  it('names the thing AND what it does, for every reward kind', () => {
    const cases = [
      { kind: 'unlock', unlockId: 'prism-tank' },
      { kind: 'credits', amount: 2000 },
      { kind: 'map', mapId: 'canyon' },
      { kind: 'power', powerId: 'chrono-sphere' },
      { kind: 'cosmetic', cosmeticId: 'ace-insignia' },
    ] as const;
    for (const r of cases) {
      const copy = rewardCopy(r);
      expect(copy.kind.length).toBeGreaterThan(0);
      expect(copy.name.length).toBeGreaterThan(0);
      expect(copy.effect.length).toBeGreaterThan(0);
      expect(copy.iconName.length).toBeGreaterThan(0);
    }
  });

  it('formats a credit bounty with a separator', () => {
    expect(rewardCopy({ kind: 'credits', amount: 12000 }).name).toBe('12,000 Credits');
  });

  it('falls back rather than throwing on a reward kind it has never seen', () => {
    const rogue = { kind: 'holiday', destination: 'Yalta' } as unknown as Parameters<typeof rewardCopy>[0];
    expect(rewardCopy(rogue).name).toBe('Unknown');
  });
});

/* ==========================================================================
 * CHAINS
 * ========================================================================== */

describe('buildChains', () => {
  it('puts a root first and its dependants after it, in depth order', () => {
    const chains = buildChains([
      entry('c', { requires: ['b'] }),
      entry('a'),
      entry('b', { requires: ['a'] }),
    ]);
    expect(chains.length).toBe(1);
    expect(chains[0].map((n) => n.entry.id)).toEqual(['a', 'b', 'c']);
    expect(chains[0].map((n) => n.depth)).toEqual([0, 1, 2]);
  });

  it('branches: two missions requiring the same root sit at the same depth', () => {
    const chains = buildChains([
      entry('root'),
      entry('left', { requires: ['root'] }),
      entry('right', { requires: ['root'] }),
    ]);
    expect(chains.length).toBe(1);
    expect(chains[0].map((n) => n.depth)).toEqual([0, 1, 1]);
  });

  it('emits independent roots as separate chains', () => {
    const chains = buildChains([entry('a'), entry('b')]);
    expect(chains.length).toBe(2);
  });

  it('treats a prerequisite outside the set as foreign, not as missing', () => {
    const chains = buildChains([entry('a', { requires: ['some-other-category'] })]);
    expect(chains.length).toBe(1);
    const node = chains[0][0];
    expect(node.depth).toBe(0);
    expect(node.after).toEqual([]);
    expect(node.foreign).toEqual(['Some Other Category']);
  });

  it('terminates on a cycle and emits every member exactly once', () => {
    const chains = buildChains([
      entry('a', { requires: ['b'] }),
      entry('b', { requires: ['a'] }),
    ]);
    const ids = chains.flat().map((n) => n.entry.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('emits every input exactly once even in a tangled table', () => {
    const input = [
      entry('a'),
      entry('b', { requires: ['a'] }),
      entry('c', { requires: ['a', 'b'] }),
      entry('d', { requires: ['ghost'] }),
      entry('e', { requires: ['f'] }),
      entry('f', { requires: ['e'] }),
    ];
    const ids = buildChains(input).flat().map((n) => n.entry.id).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('handles an empty table', () => {
    expect(buildChains([])).toEqual([]);
  });
});

/* ==========================================================================
 * STATE AND SUMMARY
 * ========================================================================== */

describe('missionState', () => {
  it('reads complete before locked, so a finished chain never shows as locked', () => {
    expect(missionState(entry('x', { locked: true, progress: progress({ complete: true }) })))
      .toBe('complete');
    expect(missionState(entry('x', { locked: true }))).toBe('locked');
    expect(missionState(entry('x'))).toBe('active');
  });
});

describe('summarise', () => {
  it('counts completions and unlocks', () => {
    const entries = [
      entry('a', { progress: progress({ complete: true }) }),
      entry('b'),
      entry('c'),
    ];
    expect(summarise(entries, 1)).toBe('1 of 3 complete · 1 unlock earned');
    expect(summarise(entries, 4)).toBe('1 of 3 complete · 4 unlocks earned');
  });

  it('says so rather than dividing by zero on an empty table', () => {
    expect(summarise([], 0)).toBe('No missions authored yet');
  });
});

describe('MISSION_CATEGORIES', () => {
  it('covers exactly the five categories in the frozen contract', () => {
    expect(MISSION_CATEGORIES.map((c) => c.id))
      .toEqual(['combat', 'economy', 'construction', 'tactics', 'mastery']);
  });

  it('every category says what it is for', () => {
    for (const c of MISSION_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.blurb.length).toBeGreaterThan(10);
      expect(c.iconName.length).toBeGreaterThan(0);
    }
  });
});

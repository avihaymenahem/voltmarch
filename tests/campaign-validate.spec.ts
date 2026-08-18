/**
 * ============================================================================
 * tests/campaign-validate.spec.ts — the import-time validator, driven by
 * campaigns that are deliberately wrong
 * ============================================================================
 * A validator nobody has watched fail is a validator that cannot. Every case
 * below builds a legal campaign, breaks exactly one thing, and asserts that the
 * fault is reported AND that the unbroken version is clean — so a rule cannot
 * pass by rejecting everything, which is the failure mode a "does it throw"
 * test cannot see.
 *
 * The message text is matched loosely (a substring naming the fault) and the
 * COUNT is matched exactly, because a rule that fires twice for one mistake
 * reads as two mistakes to whoever has to fix it. Where a single edit really
 * does break two rules — a singular/plural typo orphans the objective it meant
 * to name as well as failing to resolve — BOTH are asserted, by count and by
 * text, rather than the count being loosened to hide it.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';

import { minutes } from '../src/campaign/types';
import type { ChapterDef, Condition, Effect, OperationDef, TriggerDef } from '../src/campaign/types';
import { validateCampaign, totalParSeconds } from '../src/campaign/validate';
import type { CampaignFacts } from '../src/campaign/validate';
import { Faction } from '../src/core/types';

/* -- the world these fixtures live in ------------------------------------- */

const FACTS: CampaignFacts = {
  unitKeys: new Set(['conscript', 'rhino', 'gi', 'grizzly']),
  mapPresets: new Set(['temperate', 'arid', 'snow', 'urban']),
  unlockIds: new Set(['struct.defence.aa', 'unit.specialist', 'struct.tech']),
  evaLines: new Set(['reinforcements', 'unitLost', 'baseUnderAttack']),
  layoutTags: new Map([
    ['sov-01', new Set(['derrick', 'tap', 'office'])],
    ['sov-02', new Set(['column'])],
  ]),
  minArmies: 2,
  maxArmies: 4,
};

function operation(over: Partial<OperationDef> = {}): OperationDef {
  const base: OperationDef = {
    id: 'soviets.01.first-tap',
    chapter: 'soviets',
    faction: Faction.Soviets,
    index: 1,
    title: 'First Tap',
    beat: 'The March surfaces in a new place.',
    primaryType: 'assault',
    archetype: 'posed',
    parSec: 780,
    requires: [],
    map: {
      preset: 'arid', mapSeed: 11, simSeed: 12, armies: 2,
      biome: 'desert', opening: 'base', credits: 10_000,
    },
    layout: 'sov-01',
    outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },
    roster: { player: [], ai: ['struct.defence.aa'] },
    objectives: [
      { id: 'sink', kind: 'primary', title: 'Sink the first tap' },
      { id: 'derricks', kind: 'secondary', title: 'Keep three derricks standing', credits: 500 },
    ],
    triggers: [
      {
        id: 't.win',
        when: { on: 'entityDead', tag: 'tap' },
        then: [{ do: 'completeObjective', id: 'sink' }, { do: 'endOperation', result: 'win' }],
      },
      {
        id: 't.derricks',
        when: { on: 'ownerCount', player: 0, role: 'building', tag: 'derrick', max: 2 },
        then: [{ do: 'failObjective', id: 'derricks' }],
      },
      {
        id: 't.lose',
        when: { on: 'playerBeaten', player: 0 },
        then: [{ do: 'endOperation', result: 'loss', reason: 'sink' }],
      },
    ],
  };
  return { ...base, ...over };
}

function chapter(ops: readonly OperationDef[]): readonly ChapterDef[] {
  return [{
    id: 'soviets', faction: Faction.Soviets, title: 'Hold the Seam',
    blurb: 'Nine operations.', operations: ops,
  }];
}

const faultsFor = (ops: readonly OperationDef[]): readonly string[] =>
  validateCampaign(chapter(ops), FACTS);

/** Break one thing; expect exactly one fault naming `needle`. */
function expectOneFault(op: OperationDef, needle: string): void {
  const f = faultsFor([op]);
  expect(f, `expected exactly one fault, got: ${JSON.stringify(f, null, 2)}`).toHaveLength(1);
  expect(f[0]).toContain(needle);
}

/* ==========================================================================
 * 0. THE CONTROL
 * ========================================================================== */

describe('the fixture campaign is clean, or nothing below means anything', () => {
  it('a well-formed operation reports no faults', () => {
    expect(faultsFor([operation()])).toEqual([]);
  });

  it('and a well-formed two-operation chapter does too', () => {
    const second = operation({
      id: 'soviets.02.column', index: 2, primaryType: 'fixed-force', layout: 'sov-02',
      requires: ['soviets.01.first-tap'], parSec: 840,
      objectives: [{ id: 'kill', kind: 'primary', title: 'Break the column' }],
      triggers: [
        { id: 't.w', when: { on: 'entityDead', tag: 'column' }, then: [{ do: 'completeObjective', id: 'kill' }, { do: 'endOperation', result: 'win' }] },
        { id: 't.l', when: { on: 'playerBeaten', player: 0 }, then: [{ do: 'endOperation', result: 'loss' }] },
      ],
    });
    expect(faultsFor([operation(), second])).toEqual([]);
    expect(totalParSeconds(chapter([operation(), second]))).toBe(1620);
  });
});

/* ==========================================================================
 * 1. THE MATCH MUST BE ABLE TO END
 * ========================================================================== */

describe('an operation that cannot end is a build error', () => {
  const stripEnd = (result: 'win' | 'loss'): readonly TriggerDef[] =>
    operation().triggers.map((t) => ({
      ...t,
      then: t.then.filter((e: Effect) => !(e.do === 'endOperation' && e.result === result)),
    })).filter((t) => t.then.length > 0);

  it('no authored win and no annihilation win', () => {
    expectOneFault(operation({ triggers: stripEnd('win') }), 'cannot be won');
  });

  it('no authored loss and no asset-loss defeat', () => {
    expectOneFault(operation({ triggers: stripEnd('loss') }), 'cannot be lost');
  });

  it('opting into annihilation satisfies the win half', () => {
    expect(faultsFor([operation({
      triggers: stripEnd('win'),
      outcome: { annihilationWin: true, assetLossDefeat: false, ignoreSeats: [] },
    })])).toEqual([]);
  });

  it('opting into asset-loss satisfies the lose half', () => {
    expect(faultsFor([operation({
      triggers: stripEnd('loss'),
      outcome: { annihilationWin: false, assetLossDefeat: true, ignoreSeats: [] },
    })])).toEqual([]);
  });
});

/* ==========================================================================
 * 2. THE SILENT ONES
 * ========================================================================== */

describe('the faults that would otherwise be invisible at runtime', () => {
  it('a tag no layout stamps — entityDead reads TRUE before a tag exists', () => {
    const op = operation();
    expectOneFault({
      ...op,
      triggers: op.triggers.map((t) => t.id === 't.win'
        ? { ...t, when: { on: 'entityDead', tag: 'taps' } as Condition }
        : t),
    }, "tag 'taps'");
  });

  it('a spawn key with no FALLBACK_UNITS row would spawn nothing, silently', () => {
    const op = operation();
    expectOneFault({
      ...op,
      triggers: [...op.triggers, {
        id: 't.wave',
        when: { on: 'elapsed', ticks: minutes(3) },
        then: [{
          do: 'spawnUnits', player: 1, key: 'conscrpit', count: 6,
          at: { x: 100, z: 100 }, tag: 'wave',
        }],
      }],
    }, 'FALLBACK_UNITS');
  });

  it('an EVA line that is not a key of EVA_LINES — the announcer would say nothing', () => {
    // The failure this catches is INAUDIBLE. The announcer looks the id up,
    // finds nothing, and says nothing; the designer heard the beat in their
    // head and never hears it on the machine. S1's first draft named
    // `enemyUnitsApproaching`, which is not an id.
    const op = operation();
    expectOneFault({
      ...op,
      triggers: [...op.triggers, {
        id: 't.eva',
        when: { on: 'elapsed', ticks: 60 },
        then: [{ do: 'eva', line: 'enemyUnitsApproaching' } as Effect],
      }],
    }, 'EVA_LINES');
  });

  it('and a real one passes, so the rule is not simply refusing every eva', () => {
    const op = operation();
    expect(faultsFor([{
      ...op,
      triggers: [...op.triggers, {
        id: 't.eva',
        when: { on: 'elapsed', ticks: 60 },
        then: [{ do: 'eva', line: 'reinforcements' } as Effect],
      }],
    }])).toEqual([]);
  });

  it('elapsedSinceArmed under a not can never fire', () => {
    const op = operation();
    expectOneFault({
      ...op,
      triggers: op.triggers.map((t) => t.id === 't.derricks'
        ? { ...t, when: { on: 'not', of: { on: 'elapsedSinceArmed', ticks: 100 } } as Condition }
        : t),
    }, 'can never fire');
  });

  it('an ownerCount with neither min nor max is always true', () => {
    const op = operation();
    expectOneFault({
      ...op,
      triggers: op.triggers.map((t) => t.id === 't.derricks'
        ? { ...t, when: { on: 'ownerCount', player: 0, role: 'building', tag: 'derrick' } as Condition }
        : t),
    }, 'always true');
  });

  it('a seat number past the operation’s own army count', () => {
    const op = operation();
    expectOneFault({
      ...op,
      triggers: op.triggers.map((t) => t.id === 't.lose'
        ? { ...t, when: { on: 'playerBeaten', player: 3 } as Condition }
        : t),
    }, 'outside the 2');
  });
});

/* ==========================================================================
 * 3. OBJECTIVES
 * ========================================================================== */

describe('objectives are declared, referenced and paid correctly', () => {
  it('a trigger naming an objective that does not exist reports BOTH halves', () => {
    // A singular/plural typo is genuinely two faults and the validator is right
    // to say so: the reference resolves to nothing, AND the objective it meant
    // to name is now orphaned. Reporting only the first would leave the author
    // fixing the typo and never learning that the second rule exists.
    const op = operation();
    const f = faultsFor([{
      ...op,
      triggers: op.triggers.map((t) => t.id === 't.derricks'
        ? { ...t, then: [{ do: 'failObjective', id: 'derrick' } as Effect] }
        : t),
    }]);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain("undeclared objective 'derrick'");
    expect(f[1]).toContain("objective 'derricks' is declared and no trigger");
  });

  it('an objective nothing ever touches', () => {
    expectOneFault(operation({
      objectives: [
        ...operation().objectives,
        { id: 'ghost', kind: 'secondary', title: 'Nobody completes this', credits: 250 },
      ],
    }), "objective 'ghost' is declared and no trigger");
  });

  it('a hidden objective nothing reveals', () => {
    const f = faultsFor([operation({
      objectives: [
        ...operation().objectives,
        { id: 'secret', kind: 'secondary', title: 'Hidden', hidden: true },
      ],
    })]);
    expect(f.join('\n')).toContain('nothing reveals it');
  });

  it('a primary that declares credits — paying for the primary is paying for playing', () => {
    expectOneFault(operation({
      objectives: [
        { id: 'sink', kind: 'primary', title: 'Sink the first tap', credits: 900 },
        { id: 'derricks', kind: 'secondary', title: 'Keep three derricks standing', credits: 500 },
      ],
    }), 'is primary and declares credits');
  });

  it('an operation with no primary at all', () => {
    const f = faultsFor([operation({
      objectives: [{ id: 'sink', kind: 'secondary', title: 'Sink the first tap' },
        { id: 'derricks', kind: 'secondary', title: 'Keep three', credits: 500 }],
    })]);
    expect(f.join('\n')).toContain('no primary objective');
  });

  it('endOperation naming a reason that is not an objective', () => {
    const op = operation();
    expectOneFault({
      ...op,
      triggers: op.triggers.map((t) => t.id === 't.lose'
        ? { ...t, then: [{ do: 'endOperation', result: 'loss', reason: 'you died' } as Effect] }
        : t),
    }, 'is not an objective');
  });
});

/* ==========================================================================
 * 4. THE ROSTER
 * ========================================================================== */

describe('an operation may restrict only tagged content', () => {
  it('an unlock id that does not exist', () => {
    expectOneFault(operation({ roster: { player: ['unit.wizard'], ai: [] } }), 'UNLOCK_TAGS');
  });

  it('an UNTAGGED def key is refused for the same reason — the gate cannot express it', () => {
    // `barracks` is a real def and day-one open. Naming it here would read as a
    // restriction and produce none, which is worse than a build error.
    expectOneFault(operation({ roster: { player: [], ai: ['barracks'] } }), 'UNLOCK_TAGS');
  });

  it('real unlock ids on both sides are fine, and asymmetry is the point', () => {
    expect(faultsFor([operation({
      roster: { player: ['unit.specialist'], ai: ['struct.defence.aa', 'struct.tech'] },
    })])).toEqual([]);
  });
});

/* ==========================================================================
 * 5. THE CHAPTER AND THE GRAPH
 * ========================================================================== */

describe('chapter shape and the requires graph', () => {
  const two = (a: Partial<OperationDef>, b: Partial<OperationDef>): readonly string[] => faultsFor([
    operation(a),
    operation({
      id: 'soviets.02.column', index: 2, primaryType: 'fixed-force', layout: 'sov-02',
      requires: ['soviets.01.first-tap'],
      objectives: [{ id: 'kill', kind: 'primary', title: 'Break the column' }],
      triggers: [
        { id: 't.w', when: { on: 'entityDead', tag: 'column' }, then: [{ do: 'completeObjective', id: 'kill' }, { do: 'endOperation', result: 'win' }] },
        { id: 't.l', when: { on: 'playerBeaten', player: 0 }, then: [{ do: 'endOperation', result: 'loss' }] },
      ],
      ...b,
    }),
  ]);

  it('primaryType repeating immediately inside one chapter', () => {
    const f = two({}, { primaryType: 'assault' });
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('repeats immediately after');
  });

  it('a forward reference', () => {
    const f = two({ requires: ['soviets.02.column'] }, {});
    expect(f.join('\n')).toContain('declared later');
  });

  it('a requires id that resolves to nothing', () => {
    const f = two({}, { requires: ['soviets.09.nope'] });
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('is not an operation');
  });

  it('an operation requiring itself', () => {
    const f = two({}, { requires: ['soviets.02.column'] });
    expect(f.join('\n')).toContain('requires itself');
  });

  it('a chapter whose opener requires something', () => {
    const f = two({ requires: ['soviets.02.column'] }, {});
    expect(f.join('\n')).toContain('nothing would open it');
  });

  it('a duplicate operation id', () => {
    const f = faultsFor([operation(), operation({ index: 2, primaryType: 'defend' })]);
    expect(f.join('\n')).toContain('duplicate operation id');
  });

  it('an index that disagrees with its position', () => {
    const f = two({}, { index: 5 });
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('but it is operation 2');
  });

  it('a faction that disagrees with its chapter', () => {
    const f = faultsFor([operation({ faction: Faction.Allies })]);
    expect(f.join('\n')).toContain('faction disagrees');
  });

  it('a layout that is not registered', () => {
    expectOneFault(operation({ layout: 'sov-99' }), "layout 'sov-99' is not registered");
  });

  it('an unknown map preset', () => {
    expectOneFault(operation({ map: { ...operation().map, preset: 'moon' } }), "unknown map preset 'moon'");
  });

  it('an army count outside what the maps can seat', () => {
    expectOneFault(operation({ map: { ...operation().map, armies: 5 } }), 'outside 2..4');
  });

  it('a duplicate trigger id — save state is keyed by it', () => {
    const op = operation();
    const f = faultsFor([{ ...op, triggers: [...op.triggers, { ...op.triggers[0], then: [{ do: 'eva', line: 'x' } as Effect] }] }]);
    expect(f.join('\n')).toContain('duplicate trigger id');
  });
});

/* ==========================================================================
 * 6. THE VALIDATOR REPORTS EVERYTHING, NOT THE FIRST THING
 * ========================================================================== */

describe('one run reports every fault it found', () => {
  it('three independent mistakes produce three messages', () => {
    const f = faultsFor([operation({
      layout: 'sov-99',
      map: { ...operation().map, preset: 'moon' },
      roster: { player: ['unit.wizard'], ai: [] },
    })]);
    expect(f.length).toBeGreaterThanOrEqual(3);
    const joined = f.join('\n');
    for (const needle of ['sov-99', 'moon', 'UNLOCK_TAGS']) expect(joined).toContain(needle);
  });

  it('every message names the operation it came from', () => {
    for (const msg of faultsFor([operation({ layout: 'sov-99' })])) {
      expect(msg.startsWith('soviets.01.first-tap')).toBe(true);
    }
  });
});

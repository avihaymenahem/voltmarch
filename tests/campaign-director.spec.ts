/**
 * ============================================================================
 * tests/campaign-director.spec.ts — the trigger evaluator, with no engine
 * ============================================================================
 * The Director reads the world through `WorldQuery` and nothing else, which is
 * the whole reason it can be tested here: a fake query is nine lines and every
 * case below is a fact about the evaluator rather than about a match.
 *
 * THE THREE THINGS THAT WOULD ACTUALLY SHIP BROKEN
 * -----------------------------------------------
 *   1. **The hold timer not restarting.** "Hold three derricks for six minutes"
 *      is `all: [ownerCount, elapsedSinceArmed]`, and if losing a derrick at
 *      minute five does not clear the arm tick, the player is handed the win at
 *      minute six for holding nothing. That failure is in the player's favour,
 *      which is the direction nobody reports.
 *   2. **`entityDead` before the tag exists.** It is TRUE, by construction, and
 *      a mistyped `protect` therefore fails on tick one. The validator is what
 *      catches the typo; this file pins the behaviour the validator exists for.
 *   3. **Determinism.** Same state, same facts, same tick, twice — deep-equal
 *      effect lists. The replay probe would catch a violation eventually, in
 *      CI, one phase later and with no idea which trigger did it.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';

import { medalFor, newOperationState, runDirector, usesArmTimer } from '../src/campaign/Director';
import { minutes, seconds } from '../src/campaign/types';
import type {
  Area, Condition, CountRole, Effect, ObjectiveDef, OperationDef, OperationState,
  TriggerDef, WorldQuery,
} from '../src/campaign/types';
import { Faction } from '../src/core/types';

/* -- a world you can turn knobs on ---------------------------------------- */

interface Knobs {
  alive: Record<string, number>;
  hp: Record<string, number>;
  owner: Record<string, number>;
  inArea: number;
  counts: Record<string, number>;
  credits: Record<number, number>;
  beaten: Set<number>;
}

function knobs(): Knobs {
  return { alive: {}, hp: {}, owner: {}, inArea: 0, counts: {}, credits: {}, beaten: new Set() };
}

function query(k: Knobs): WorldQuery {
  return {
    aliveWithTag: (tag) => k.alive[tag] ?? 0,
    weakestHpFrac: (tag) => (k.alive[tag] ?? 0) > 0 ? (k.hp[tag] ?? 1) : -1,
    ownerOfTag: (tag) => k.owner[tag] ?? -1,
    unitsInArea: () => k.inArea,
    ownerCount: (player, role) => k.counts[`${player}:${role}`] ?? 0,
    creditsOf: (p) => k.credits[p] ?? 0,
    isBeaten: (p) => k.beaten.has(p),
  };
}

const AREA: Area = { x: 100, z: 100, r: 30 };

const ONE_PRIMARY: readonly ObjectiveDef[] = [
  { id: 'main', kind: 'primary', title: 'Do the thing' },
];

function op(
  triggers: readonly TriggerDef[],
  objectives: readonly ObjectiveDef[] = ONE_PRIMARY,
): OperationDef {
  return {
    id: 'soviets.01.probe',
    chapter: 'soviets',
    faction: Faction.Soviets,
    foe: Faction.Allies,
    index: 1,
    title: 'Probe',
    beat: 'A probe.',
    primaryType: 'assault',
    archetype: 'conditional',
    parSec: 780,
    requires: [],
    map: {
      preset: 'temperate', mapSeed: 1, simSeed: 2, armies: 2,
      biome: 'temperate', opening: 'base', credits: 10_000,
    },
    layout: 'soviets-probe',
    outcome: { annihilationWin: false, assetLossDefeat: false, ignoreSeats: [] },
    roster: { player: [], ai: [] },
    objectives,
    triggers,
  };
}

/** Run one tick and return what fired. */
function tickOnce(
  o: OperationDef, s: OperationState, k: Knobs, tick: number,
): readonly Effect[] {
  const out: Effect[] = [];
  runDirector(o, s, query(k), tick, out);
  return out;
}

/* ==========================================================================
 * 1. THE HOLD TIMER
 * ========================================================================== */

describe('elapsedSinceArmed is a hold timer and it restarts when the hold breaks', () => {
  const HOLD: Condition = {
    on: 'all',
    of: [
      { on: 'ownerCount', player: 0, role: 'building', tag: 'derrick', min: 3 },
      { on: 'elapsedSinceArmed', ticks: minutes(6) },
    ],
  };
  const TRIGGERS: readonly TriggerDef[] = [
    { id: 't.hold', when: HOLD, then: [{ do: 'endOperation', result: 'win' }] },
  ];

  it('arms on the tick the other conditions first hold, and not before', () => {
    const o = op(TRIGGERS);
    const s = newOperationState(o, 0);
    const k = knobs();

    tickOnce(o, s, k, 0);
    expect(s.armedAt.has('t.hold'), 'nothing held, so nothing armed').toBe(false);

    k.counts['0:building'] = 3;
    tickOnce(o, s, k, 90);
    expect(s.armedAt.get('t.hold')).toBe(90);
  });

  it('does not fire one tick early and does fire on the tick', () => {
    const o = op(TRIGGERS);
    const s = newOperationState(o, 0);
    const k = knobs();
    k.counts['0:building'] = 3;

    tickOnce(o, s, k, 100);
    expect(tickOnce(o, s, k, 100 + minutes(6) - 1)).toEqual([]);
    expect(tickOnce(o, s, k, 100 + minutes(6))).toEqual([{ do: 'endOperation', result: 'win' }]);
  });

  it('THE ONE THAT MATTERS: losing the hold clears the clock, it does not pause it', () => {
    const o = op(TRIGGERS);
    const s = newOperationState(o, 0);
    const k = knobs();

    k.counts['0:building'] = 3;
    tickOnce(o, s, k, 0);
    expect(s.armedAt.get('t.hold')).toBe(0);

    // Minute five: a derrick falls.
    k.counts['0:building'] = 2;
    tickOnce(o, s, k, minutes(5));
    expect(s.armedAt.has('t.hold'), 'the hold broke — the arm tick must be gone').toBe(false);

    // Retaken at minute five and a half. The six minutes start again from HERE,
    // so the original deadline must pass with nothing happening.
    k.counts['0:building'] = 3;
    tickOnce(o, s, k, minutes(5.5));
    expect(s.armedAt.get('t.hold')).toBe(minutes(5.5));
    expect(
      tickOnce(o, s, k, minutes(6)),
      'firing here would hand the player a six-minute hold they held for thirty seconds',
    ).toEqual([]);
    expect(tickOnce(o, s, k, minutes(11.5))).toHaveLength(1);
  });

  it('a tree with no arm timer is detected, so the second pass can be skipped', () => {
    expect(usesArmTimer(HOLD)).toBe(true);
    expect(usesArmTimer({ on: 'elapsed', ticks: 10 })).toBe(false);
    expect(usesArmTimer({ on: 'not', of: { on: 'elapsedSinceArmed', ticks: 5 } })).toBe(true);
  });
});

/* ==========================================================================
 * 2. THE TRAPS THE VALIDATOR EXISTS FOR
 * ========================================================================== */

describe('entityDead is true before the tag has ever existed', () => {
  it('fires on tick zero against a tag nothing stamps', () => {
    const o = op([
      { id: 't.protect', when: { on: 'entityDead', tag: 'convoy' }, then: [{ do: 'failObjective', id: 'main' }] },
    ]);
    const s = newOperationState(o, 0);
    expect(
      tickOnce(o, s, knobs(), 0),
      'this is not a bug in the Director — it is why campaign-validate refuses a tag no layout stamps',
    ).toEqual([{ do: 'failObjective', id: 'main' }]);
  });

  it('but entityHpBelow does NOT fire for a tag with nothing alive', () => {
    // A dead escort is not "below 30% health". Conflating the two makes a
    // wounded-convoy warning repeat forever after the convoy dies.
    const o = op([
      {
        id: 't.hurt',
        when: { on: 'entityHpBelow', tag: 'convoy', frac: 0.3 },
        then: [{ do: 'eva', line: 'unitLost' }],
      },
    ]);
    const s = newOperationState(o, 0);
    const k = knobs();
    expect(tickOnce(o, s, k, 0)).toEqual([]);

    k.alive.convoy = 1;
    k.hp.convoy = 0.9;
    expect(tickOnce(o, s, k, 1)).toEqual([]);
    k.hp.convoy = 0.2;
    expect(tickOnce(o, s, k, 2)).toHaveLength(1);
  });
});

/* ==========================================================================
 * 3. FIRING DISCIPLINE
 * ========================================================================== */

describe('a trigger fires once unless it says otherwise', () => {
  const T: readonly TriggerDef[] = [
    { id: 't.once', when: { on: 'elapsed', ticks: 0 }, then: [{ do: 'eva', line: 'a' }] },
    { id: 't.many', when: { on: 'elapsed', ticks: 0 }, then: [{ do: 'eva', line: 'b' }], repeat: true },
  ];

  it('the latch holds across ticks and the repeat does not', () => {
    const o = op(T);
    const s = newOperationState(o, 0);
    const k = knobs();
    expect(tickOnce(o, s, k, 0)).toHaveLength(2);
    expect(tickOnce(o, s, k, 1)).toEqual([{ do: 'eva', line: 'b' }]);
    expect(tickOnce(o, s, k, 2)).toEqual([{ do: 'eva', line: 'b' }]);
    expect(s.fired.has('t.once')).toBe(true);
    expect(s.fired.has('t.many')).toBe(false);
  });

  it('an ended operation evaluates nothing at all', () => {
    const o = op(T);
    const s = newOperationState(o, 0);
    s.outcome = 'won';
    expect(
      tickOnce(o, s, knobs(), 5),
      'a repeat trigger must not go on spawning waves into a world the shell is tearing down',
    ).toEqual([]);
  });

  it('effects are appended in file order, so a loss written above a win wins', () => {
    const o = op([
      { id: 't.loss', when: { on: 'elapsed', ticks: 0 }, then: [{ do: 'endOperation', result: 'loss' }] },
      { id: 't.win', when: { on: 'elapsed', ticks: 0 }, then: [{ do: 'endOperation', result: 'win' }] },
    ]);
    const s = newOperationState(o, 0);
    const fired = tickOnce(o, s, knobs(), 0);
    expect(fired[0]).toEqual({ do: 'endOperation', result: 'loss' });
  });

  it('the output array is appended to, never cleared', () => {
    const o = op([{ id: 't', when: { on: 'elapsed', ticks: 0 }, then: [{ do: 'eva', line: 'x' }] }]);
    const s = newOperationState(o, 0);
    const out: Effect[] = [{ do: 'eva', line: 'kept' }];
    const n = runDirector(o, s, query(knobs()), 0, out);
    expect(n).toBe(1);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ do: 'eva', line: 'kept' });
  });
});

/* ==========================================================================
 * 4. THE COMBINATORS AND EVERY PREDICATE
 * ========================================================================== */

describe('every condition reads what it claims to read', () => {
  const fire = (when: Condition, k: Knobs, tick = 0): boolean => {
    const o = op([{ id: 't', when, then: [{ do: 'eva', line: 'x' }] }]);
    return tickOnce(o, newOperationState(o, 0), k, tick).length > 0;
  };

  it('elapsed counts from the operation start, not from tick zero', () => {
    const o = op([{ id: 't', when: { on: 'elapsed', ticks: seconds(10) }, then: [{ do: 'eva', line: 'x' }] }]);
    const s = newOperationState(o, 1000);
    expect(tickOnce(o, s, knobs(), 1000 + seconds(10) - 1)).toEqual([]);
    expect(tickOnce(o, s, knobs(), 1000 + seconds(10))).toHaveLength(1);
  });

  it('ownerCount honours min, max and both together', () => {
    const k = knobs();
    k.counts['1:unit'] = 5;
    const role: CountRole = 'unit';
    expect(fire({ on: 'ownerCount', player: 1, role, min: 5 }, k)).toBe(true);
    expect(fire({ on: 'ownerCount', player: 1, role, min: 6 }, k)).toBe(false);
    expect(fire({ on: 'ownerCount', player: 1, role, max: 5 }, k)).toBe(true);
    expect(fire({ on: 'ownerCount', player: 1, role, max: 4 }, k)).toBe(false);
    expect(fire({ on: 'ownerCount', player: 1, role, min: 4, max: 6 }, k)).toBe(true);
  });

  it('unitsInArea, credits, structureCaptured and playerBeaten', () => {
    const k = knobs();
    k.inArea = 3;
    expect(fire({ on: 'unitsInArea', player: 0, area: AREA, min: 3 }, k)).toBe(true);
    expect(fire({ on: 'unitsInArea', player: 0, area: AREA, min: 4 }, k)).toBe(false);

    k.credits[0] = 2500;
    expect(fire({ on: 'credits', player: 0, min: 2000 }, k)).toBe(true);
    expect(fire({ on: 'credits', player: 0, max: 2000 }, k)).toBe(false);

    k.owner.office = 0;
    expect(fire({ on: 'structureCaptured', tag: 'office', player: 0 }, k)).toBe(true);
    expect(fire({ on: 'structureCaptured', tag: 'office', player: 1 }, k)).toBe(false);

    k.beaten.add(1);
    expect(fire({ on: 'playerBeaten', player: 1 }, k)).toBe(true);
    expect(fire({ on: 'playerBeaten', player: 0 }, k)).toBe(false);
  });

  it('objectiveComplete and objectiveFailed read the live state', () => {
    const o = op([
      { id: 't', when: { on: 'objectiveComplete', id: 'main' }, then: [{ do: 'eva', line: 'x' }] },
    ]);
    const s = newOperationState(o, 0);
    expect(tickOnce(o, s, knobs(), 0)).toEqual([]);
    s.objectives.set('main', 'complete');
    expect(tickOnce(o, s, knobs(), 1)).toHaveLength(1);
  });

  it('all, any and not', () => {
    const k = knobs();
    k.alive.a = 1;
    const A: Condition = { on: 'entityAlive', tag: 'a' };
    const B: Condition = { on: 'entityAlive', tag: 'b' };
    expect(fire({ on: 'all', of: [A, B] }, k)).toBe(false);
    expect(fire({ on: 'any', of: [A, B] }, k)).toBe(true);
    expect(fire({ on: 'not', of: B }, k)).toBe(true);
    expect(fire({ on: 'not', of: A }, k)).toBe(false);
  });
});

/* ==========================================================================
 * 5. DETERMINISM
 * ========================================================================== */

describe('the same state, facts and tick produce the same effects', () => {
  const clone = (s: OperationState): OperationState => ({
    operationId: s.operationId,
    startTick: s.startTick,
    armedAt: new Map(s.armedAt),
    fired: new Set(s.fired),
    objectives: new Map(s.objectives),
    paid: new Set(s.paid),
    outcome: s.outcome,
    reason: s.reason,
  });

  it('run twice from a cloned state and the lists are deep-equal', () => {
    const o = op([
      {
        id: 't.hold',
        when: {
          on: 'all',
          of: [
            { on: 'ownerCount', player: 0, role: 'building', min: 2 },
            { on: 'elapsedSinceArmed', ticks: seconds(30) },
          ],
        },
        then: [{ do: 'grantCredits', player: 0, amount: 500 }, { do: 'completeObjective', id: 'main' }],
      },
      { id: 't.late', when: { on: 'elapsed', ticks: seconds(90) }, then: [{ do: 'eva', line: 'y' }] },
    ]);
    const k = knobs();
    k.counts['0:building'] = 2;

    const a = newOperationState(o, 0);
    // Walk it forward so the arm map is genuinely populated before the compare.
    for (let t = 0; t <= seconds(40); t += 10) tickOnce(o, a, k, t);

    const b = clone(a);
    const at = seconds(120);
    const ra: Effect[] = [];
    const rb: Effect[] = [];
    runDirector(o, a, query(k), at, ra);
    runDirector(o, b, query(k), at, rb);

    expect(rb).toEqual(ra);
    expect([...b.armedAt.entries()]).toEqual([...a.armedAt.entries()]);
    expect([...b.fired]).toEqual([...a.fired]);
  });

  it('the Director source names no clock, no randomness and no DOM', async () => {
    // A source scan is weak on its own; it is here because the alternative —
    // noticing a `Date.now()` in a diff — is exactly the mechanism this repo
    // has repeatedly recorded as not being one.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'src/campaign/Director.ts'), 'utf8')
      // Strip block and line comments: prose describing a call is not a call.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const banned of ['Math.random', 'Date.now', 'performance.now', 'localStorage', 'document.', 'window.']) {
      expect(src, `Director.ts reaches for ${banned}`).not.toContain(banned);
    }
  });
});

/* ==========================================================================
 * 6. MEDALS
 * ========================================================================== */

describe('a medal is derived from the outcome, never stored as payable', () => {
  const OBJ = [
    { id: 'main', kind: 'primary' as const, title: 'Win' },
    { id: 'bonus', kind: 'secondary' as const, title: 'Also this', credits: 500 },
  ];
  const o = op([{ id: 't', when: { on: 'elapsed', ticks: 0 }, then: [{ do: 'completeObjective', id: 'main' }] }], OBJ);

  it('nothing for a loss, bronze for a win, silver for every secondary, gold at Hard', () => {
    const lost = newOperationState(o, 0);
    lost.outcome = 'lost';
    expect(medalFor(o, lost, 3)).toBe(0);

    const won = newOperationState(o, 0);
    won.outcome = 'won';
    expect(medalFor(o, won, 1)).toBe(1);

    won.objectives.set('bonus', 'complete');
    expect(medalFor(o, won, 1)).toBe(2);
    expect(medalFor(o, won, 2)).toBe(3);
  });

  it('an operation with no secondaries goes straight to silver on a win', () => {
    const plain = op([{ id: 't', when: { on: 'elapsed', ticks: 0 }, then: [{ do: 'completeObjective', id: 'main' }] }]);
    const s = newOperationState(plain, 0);
    s.outcome = 'won';
    expect(medalFor(plain, s, 0)).toBe(2);
  });
});

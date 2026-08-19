/**
 * ============================================================================
 * tests/campaign-store.spec.ts — campaign progress on the profile
 * ============================================================================
 * Three failures live here, and every one of them is silent in production.
 *
 *   - **A NEW PROFILE FIELD THAT EVAPORATES ON EVERY LOAD.** `normalizeProfile`
 *     rebuilds from `defaultProfile()` and copies only what it recognises, so a
 *     field added to the interface and to the writer but not to the normaliser
 *     round-trips perfectly in memory, writes a correct blob to storage, and is
 *     gone at the next boot. Nothing throws and no write fails. The only way to
 *     see it is to go through storage, which is what every migration case below
 *     does rather than calling `normalizeProfile` on an object it just built.
 *   - **A MEDAL THAT CAN BE LOST BY PLAYING MORE.** Gold is Hard-or-above; a
 *     curious replay on Easy scores silver. If the store wrote what it was
 *     handed, one click would permanently downgrade a record the player cannot
 *     see being written and has no route back to except replaying on Hard.
 *     Tested in BOTH directions, because "never lowers" also passes against a
 *     function that never writes at all.
 *   - **A `requires` GATE THAT IS ALWAYS OPEN OR ALWAYS SHUT.** The shipped
 *     campaign is one operation with an empty `requires`, so it cannot exercise
 *     a single edge and a green run against it means nothing. The graph cases
 *     below drive a fixture chain, and each asserts the locked state as well as
 *     the unlocked one.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  MAX_CAMPAIGN_ROWS,
  PROFILE_STORAGE_KEY,
  PROFILE_VERSION,
  ProfileStore,
  defaultProfile,
  migrateProfile,
  normalizeProfile,
  parseProfileExport,
  type StorageLike,
} from '../src/progression/profile-store';
import {
  campaignProgress,
  medalOf,
  operationComplete,
  recordOperation,
  unlockedOperations,
} from '../src/campaign/campaign-store';
import type { ChapterNode } from '../src/campaign/campaign-store';
import type { Profile } from '../src/progression/profile-store';
import type { Medal } from '../src/campaign/types';

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

/** Storage backed by a Map we can poke at, so a test can plant a hostile blob. */
function seededStorage(initial?: string): StorageLike & { raw(): string | null } {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(PROFILE_STORAGE_KEY, initial);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    raw: () => map.get(PROFILE_STORAGE_KEY) ?? null,
  };
}

/** No real timers: a headless test must never leave a handle behind. */
const NO_TIMERS = { schedule: () => 0, cancel: () => { /* nothing scheduled */ } };

function makeStore(storage: StorageLike): ProfileStore {
  return new ProfileStore(storage, { ...NO_TIMERS, now: () => 1_000 });
}

/**
 * A FIXTURE GRAPH, NOT THE SHIPPED CAMPAIGN.
 *
 * `CAMPAIGNS` holds one operation whose `requires` is empty, so it can prove
 * nothing about an edge — and importing it here would also pull the operation
 * table, the layouts and the validator into a spec about a profile field.
 * `ChapterDef` satisfies `ChapterNode` structurally, so this is the same call
 * the shell makes.
 */
const CHAIN: readonly ChapterNode[] = [{
  operations: [
    { id: 'op1', requires: [] },
    { id: 'op2', requires: ['op1'] },
    { id: 'op3', requires: ['op2'] },
    // TWO edges, so "satisfied the first one" cannot pass for "satisfied".
    { id: 'finale', requires: ['op1', 'op3'] },
    // A requirement nothing in the graph produces.
    { id: 'orphan', requires: ['not-an-operation'] },
  ],
}];

const unlockedFor = (profile: Readonly<Profile>): ReadonlySet<string> =>
  unlockedOperations(CHAIN, profile);

/** The menu hint, against the same fixture graph. `CHAIN` holds five operations. */
const progressFor = (
  profile: Readonly<Profile>,
): { completed: number; golds: number; total: number } => campaignProgress(CHAIN, profile);

/* ==========================================================================
 * 1. THE MIGRATION
 * ========================================================================== */

describe('The profile ladder reaches v3 and carries every earlier field with it', () => {
  it('takes a v2 blob to v3 with its missions, unlocks and stats untouched', () => {
    const v2 = {
      version: 2,
      unlocked: ['unit.raider', 'struct.defence.aa'],
      missions: { 'combat.kills.1': { value: 25, complete: true, claimedAt: 1234 } },
      stats: {
        matchesPlayed: 12, wins: 7, losses: 5,
        currentStreak: 2, bestStreak: 3, winsByFaction: { 1: 4 },
      },
    };
    const p = makeStore(seededStorage(JSON.stringify(v2))).get();

    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.unlocked).toEqual(['struct.defence.aa', 'unit.raider']);
    expect(p.missions['combat.kills.1']).toEqual({
      id: 'combat.kills.1', value: 25, complete: true, claimedAt: 1234,
    });
    expect(p.stats.wins).toBe(7);
    expect(p.stats.bestStreak).toBe(3);
    // The new field arrives EMPTY. A v2 profile predates the campaign, so any
    // seeded row would be progress the player never earned.
    expect(p.campaign).toEqual({});
  });

  it('walks BOTH rungs for a v1 blob rather than stopping at v2', () => {
    // `normalizeProfile` stamps PROFILE_VERSION whatever happened, so reading
    // the finished profile cannot tell a walked ladder from a skipped one.
    // Read the RAW migration output instead: without a 2 -> 3 rung this is 2.
    const raw = migrateProfile({
      version: 1,
      unlocked: ['unit.raider'],
      missions: { 'combat.kills.1': 25 },
      completed: ['combat.kills.1'],
      matches: 4,
      wins: 3,
    }) as Record<string, unknown>;

    expect(raw.version).toBe(3);
    expect(raw.campaign).toEqual({});
    // And the v1 -> v2 rung still did its own job on the way past.
    expect((raw.missions as Record<string, { complete: boolean }>)['combat.kills.1'].complete)
      .toBe(true);
  });

  it('reaches PROFILE_VERSION from every version at or below it', () => {
    // A bump with no step is the failure this catches: the loop in
    // `migrateProfile` breaks out at a missing rung and leaves the blob short.
    for (let v = 1; v <= PROFILE_VERSION; v++) {
      const out = migrateProfile({ version: v }) as Record<string, unknown>;
      expect(out.version).toBe(PROFILE_VERSION);
    }
    // `migrateProfile` takes the FIRST rung matching a version, so two rungs
    // starting at the same one is a step that silently never runs.
    expect(new Set(MIGRATIONS.map((m) => m.from)).size).toBe(MIGRATIONS.length);
  });

  it('round-trips a v3 profile through storage with its medals intact', () => {
    const storage = seededStorage();
    const a = makeStore(storage);
    expect(recordOperation(a, 'soviets.01.seam', 3)).toBe(true);
    expect(recordOperation(a, 'soviets.02.yard', 1)).toBe(true);
    a.flush();

    // THE LOAD IS THE POINT. A field the normaliser has no branch for survives
    // in memory and dies here, silently, on every single boot.
    const b = makeStore(storage);
    expect(medalOf(b.get(), 'soviets.01.seam')).toBe(3);
    expect(medalOf(b.get(), 'soviets.02.yard')).toBe(1);
    // Counted against a graph that CONTAINS both, so this is the honest 2 —
    // see the hostile-import case in §2 for what the row-walking version did.
    expect(campaignProgress([{
      operations: [
        { id: 'soviets.01.seam', requires: [] },
        { id: 'soviets.02.yard', requires: ['soviets.01.seam'] },
      ],
    }], b.get())).toEqual({ completed: 2, golds: 1, total: 2 });
  });

  it('keeps the campaign map of a FUTURE profile instead of wiping it', () => {
    const future = {
      version: PROFILE_VERSION + 5,
      unlocked: ['unit.raider'],
      campaign: { 'soviets.01.seam': 2 },
      somethingNew: { we: 'do not understand' },
    };
    const p = makeStore(seededStorage(JSON.stringify(future))).get();
    expect(medalOf(p, 'soviets.01.seam')).toBe(2);
    expect(p.unlocked).toEqual(['unit.raider']);
  });

  it('ships a default profile with an empty campaign map', () => {
    expect(defaultProfile(1).campaign).toEqual({});
    // Nothing completed, and the five operations the build has are still the
    // denominator — a fresh player reads "0 of 5", never "0 of 0".
    expect(progressFor(defaultProfile(1))).toEqual({ completed: 0, golds: 0, total: 5 });
  });

  it('keeps the campaign rows a blob still stamped v2 already carried', () => {
    // `migrateV2toV3` writes `raw.campaign ?? {}`, and the `??` is the entire
    // difference between importing a devtools-copied blob and silently deleting
    // the medals in it. Nothing else in the ladder would notice: a rung that
    // clobbers to `{}` produces a profile that is valid in every other respect.
    const store = makeStore(seededStorage(JSON.stringify({
      version: 2,
      unlocked: ['unit.raider'],
      campaign: { 'soviets.01.seam': 3, 'soviets.02.yard': 1 },
    })));

    expect(medalOf(store.get(), 'soviets.01.seam')).toBe(3);
    expect(medalOf(store.get(), 'soviets.02.yard')).toBe(1);
    // And the rung really did run, rather than the rows surviving because the
    // ladder stopped short and left the blob at v2.
    expect(store.get().version).toBe(PROFILE_VERSION);
  });

  it('imports an export body whose only recognisable field is the campaign map', () => {
    // `looksLikeProfile` is a disjunction and `campaign` is one of its arms.
    // Without that arm a blob carrying medals and nothing else is refused
    // outright, and the import button reports a bad file for a good one.
    const p = parseProfileExport(JSON.stringify({ campaign: { 'soviets.01.seam': 3 } }));
    expect(p).not.toBeNull();
    expect(medalOf(p as Profile, 'soviets.01.seam')).toBe(3);
    // The refusal still has to fire, or this passes against a predicate that
    // accepts every JSON object in the world and silently resets the player.
    expect(parseProfileExport(JSON.stringify({ hello: 'world' }))).toBeNull();
  });
});

/* ==========================================================================
 * 2. HOSTILE DATA
 * ========================================================================== */

describe('A hostile campaign map normalises rather than throwing', () => {
  it('drops every row that is not a medal while keeping the one that is', () => {
    const p = normalizeProfile({
      version: 3,
      campaign: {
        negative: -4,
        zero: 0,
        nan: Number.NaN,
        text: 'gold, honest',
        nothing: null,
        nested: { medal: 3 },
        ['x'.repeat(400)]: 3,
        good: 2,
      },
    });

    // The survivor is what stops this passing against "drop everything".
    expect(p.campaign).toEqual({ good: 2 });
    expect(operationComplete(p, 'negative')).toBe(false);
    expect(operationComplete(p, 'zero')).toBe(false);
    expect(operationComplete(p, 'good')).toBe(true);
  });

  it('clamps a medal above gold instead of dropping the completion', () => {
    // A future build with a fourth tier writes a 4. Rolling back should cost
    // the tier, never the operation — "downgrading is lossy; wiping is worse".
    const p = normalizeProfile({ version: 3, campaign: { op: 9_999 } });
    expect(p.campaign.op).toBe(3);
    expect(medalOf(p, 'op')).toBe(3);
  });

  it('bounds the map at MAX_CAMPAIGN_ROWS so an import cannot be a memory bomb', () => {
    const bomb: Record<string, number> = {};
    for (let i = 0; i < MAX_CAMPAIGN_ROWS * 3; i++) bomb[`op-${i}`] = 2;
    const p = normalizeProfile({ version: 3, campaign: bomb });

    expect(Object.keys(p.campaign).length).toBe(MAX_CAMPAIGN_ROWS);
    // Kept from the front, so the bound is a bound and not a wipe.
    expect(medalOf(p, 'op-0')).toBe(2);
    expect(medalOf(p, `op-${MAX_CAMPAIGN_ROWS * 3 - 1}`)).toBe(0);
  });

  it('answers 0 for an inherited key rather than handing back a Function', () => {
    // `campaign` is a plain object literal, so it inherits Object.prototype for
    // every profile that will ever exist. An operation id is content and could
    // legally be any string; a cast with no `typeof` guard returns a Function
    // to a caller typed to receive 0..3.
    const p = defaultProfile(1);
    expect(medalOf(p, 'constructor')).toBe(0);
    expect(medalOf(p, 'toString')).toBe(0);
    expect(operationComplete(p, 'valueOf')).toBe(false);
  });

  it('cannot be used to pollute Object.prototype through a __proto__ row', () => {
    const p = normalizeProfile({
      version: 3,
      campaign: JSON.parse('{"__proto__": 3, "good": 1}') as unknown,
    });
    expect((({}) as Record<string, unknown>).good).toBeUndefined();
    expect(Object.getPrototypeOf(p.campaign)).toBe(Object.prototype);
    expect(medalOf(p, '__proto__')).toBe(0);
    expect(medalOf(p, 'good')).toBe(1);
  });

  it('never throws, for any campaign value at all', () => {
    for (const junk of [null, undefined, 0, 'x', [], [[]], { a: [] }, new Date()]) {
      expect(() => normalizeProfile({ version: 3, campaign: junk })).not.toThrow();
      expect(() => migrateProfile({ version: 2, campaign: junk })).not.toThrow();
    }
    // And the reads over whatever came out of that are total too.
    const p = normalizeProfile({ version: 3, campaign: 'not a map' });
    expect(progressFor(p)).toEqual({ completed: 0, golds: 0, total: 5 });
    expect(medalOf(p, 'anything')).toBe(0);
  });
});

/* ==========================================================================
 * 3. THE MONOTONIC MEDAL
 * ========================================================================== */

describe('The best medal only ever goes up', () => {
  it('raises a stored bronze when the player earns a gold', () => {
    // DIRECTION ONE, and it is what stops "never lowers" passing against a
    // function that never writes anything at all.
    const store = makeStore(seededStorage());
    expect(recordOperation(store, 'op', 1)).toBe(true);
    expect(medalOf(store.get(), 'op')).toBe(1);
    expect(recordOperation(store, 'op', 3)).toBe(true);
    expect(medalOf(store.get(), 'op')).toBe(3);
  });

  it('refuses to take a gold away when the operation is replayed on Easy', () => {
    // DIRECTION TWO. `medalFor` awards gold only at Hard or above, so a single
    // curious replay at a lower difficulty is the whole failure mode.
    const store = makeStore(seededStorage());
    recordOperation(store, 'op', 3);
    for (const worse of [2, 1, 0] as Medal[]) {
      expect(recordOperation(store, 'op', worse)).toBe(false);
      expect(medalOf(store.get(), 'op')).toBe(3);
    }
  });

  it('survives the reload, so the refusal is not just an in-memory read', () => {
    const storage = seededStorage();
    const a = makeStore(storage);
    recordOperation(a, 'op', 3);
    recordOperation(a, 'op', 1);
    a.flush();

    expect(medalOf(makeStore(storage).get(), 'op')).toBe(3);
  });

  it('records nothing at all for a loss', () => {
    const store = makeStore(seededStorage());
    expect(recordOperation(store, 'op', 0)).toBe(false);
    // Not "a row holding zero" — no row. `operationComplete` is `medal > 0` on
    // the strength of that, and a stored 0 would claim completion to
    // `Object.keys` while denying it to `medalOf`.
    expect(Object.keys(store.get().campaign)).toEqual([]);
    expect(operationComplete(store.get(), 'op')).toBe(false);
  });

  it('writes through immediately rather than waiting on the debounce', () => {
    // Finishing an operation is the largest single thing this game asks of a
    // player, and the end screen is exactly where they close the tab.
    const storage = seededStorage();
    const store = makeStore(storage);

    // The control: a batched mutation leaves storage empty under NO_TIMERS.
    store.mutate((p) => { p.stats.wins++; return true; });
    expect(storage.raw()).toBeNull();

    recordOperation(store, 'op', 2);
    const written = JSON.parse(storage.raw() ?? 'null') as { campaign: Record<string, number> };
    expect(written.campaign.op).toBe(2);
  });

  it('refuses an id the normaliser would drop, rather than writing a row that vanishes', () => {
    const store = makeStore(seededStorage());
    expect(recordOperation(store, '', 3)).toBe(false);
    expect(recordOperation(store, 'x'.repeat(400), 3)).toBe(false);
    expect(Object.keys(store.get().campaign)).toEqual([]);
  });

  it('refuses a NEW row past MAX_CAMPAIGN_ROWS but still raises an existing one', () => {
    const full: Record<string, number> = {};
    for (let i = 0; i < MAX_CAMPAIGN_ROWS; i++) full[`op-${i}`] = 1;
    const store = makeStore(seededStorage(JSON.stringify({ version: 3, campaign: full })));

    expect(recordOperation(store, 'one-too-many', 3)).toBe(false);
    expect(medalOf(store.get(), 'one-too-many')).toBe(0);
    // The cap is about ROWS. A player who is already at it must still be able
    // to improve the medals they hold.
    expect(recordOperation(store, 'op-0', 3)).toBe(true);
    expect(medalOf(store.get(), 'op-0')).toBe(3);
  });
});

/* ==========================================================================
 * 4. THE REQUIRES GRAPH
 * ========================================================================== */

describe('`requires` gates the next operation, and completion is the only key', () => {
  it('opens the roots of the graph and nothing else on a fresh profile', () => {
    const open = unlockedFor(defaultProfile(1));
    expect(open.has('op1')).toBe(true);
    expect(open.has('op2')).toBe(false);
    expect(open.has('op3')).toBe(false);
    expect(open.has('finale')).toBe(false);
  });

  it('unlocks op2 the moment op1 is complete, and not one step further', () => {
    const store = makeStore(seededStorage());
    expect(unlockedFor(store.get()).has('op2')).toBe(false);

    recordOperation(store, 'op1', 1);
    const open = unlockedFor(store.get());
    expect(open.has('op2')).toBe(true);
    // op3 waits on op2. A gate that opened the whole chain would pass the
    // assertion above and fail this one.
    expect(open.has('op3')).toBe(false);
  });

  it('needs EVERY edge satisfied, not the first one it finds', () => {
    const store = makeStore(seededStorage());
    recordOperation(store, 'op1', 2);
    expect(unlockedFor(store.get()).has('finale')).toBe(false);

    recordOperation(store, 'op2', 2);
    recordOperation(store, 'op3', 2);
    expect(unlockedFor(store.get()).has('finale')).toBe(true);
  });

  it('never opens an operation whose requirement names nothing that exists', () => {
    const store = makeStore(seededStorage());
    for (const id of ['op1', 'op2', 'op3', 'finale']) recordOperation(store, id, 3);
    // An id nothing can complete is an id nothing can clear — and 'orphan' is
    // still absent even from a profile that has beaten every real operation.
    expect(unlockedFor(store.get()).has('orphan')).toBe(false);
  });

  it('shows an operation the player has completed even when its edges say no', () => {
    // Reachable by an edited blob, and by re-authoring an operation's
    // prerequisites in a build the player has already beaten it in. Hiding a
    // row the player holds a medal for is the worse answer.
    const store = makeStore(seededStorage());
    recordOperation(store, 'finale', 3);
    const open = unlockedFor(store.get());
    expect(open.has('finale')).toBe(true);
    expect(open.has('op2')).toBe(false);
  });

  it('counts wins and golds apart, for the menu hint', () => {
    const store = makeStore(seededStorage());
    recordOperation(store, 'op1', 3);
    recordOperation(store, 'op2', 1);
    recordOperation(store, 'op3', 3);
    expect(progressFor(store.get())).toEqual({ completed: 3, golds: 2, total: 5 });
  });
});

/* ==========================================================================
 * 5. THE MENU HINT COUNTS THIS BUILD'S OPERATIONS, NOT THE BLOB'S ROWS
 *
 * `campaignProgress` used to walk `Object.keys(profile.campaign)`, which makes
 * the STORED BLOB the authority on what the campaign contains. Measured against
 * that version: a profile carrying 1024 fabricated ids normalises to
 * MAX_CAMPAIGN_ROWS = 512 surviving rows and the function answered
 * `{ completed: 512, golds: 512 }` — completions for operations no build has
 * ever had. Every case here fails against it, in both directions.
 * ========================================================================== */

describe('Progress is measured against the operations this build has', () => {
  /** 1024 sane ids, none of them an operation. Normalises to 512 rows. */
  function hostileProfile(): Readonly<Profile> {
    const campaign: Record<string, number> = {};
    for (let i = 0; i < MAX_CAMPAIGN_ROWS * 2; i++) campaign[`not-an-operation-${i}`] = 3;
    return normalizeProfile({ version: 3, campaign });
  }

  it('counts nothing at all for a blob full of ids no operation has', () => {
    // THE REPORTED DEFECT, VERBATIM. The old function answered 512/512 here.
    const p = hostileProfile();
    expect(Object.keys(p.campaign).length, 'the rows really are on the profile')
      .toBe(MAX_CAMPAIGN_ROWS);
    expect(progressFor(p)).toEqual({ completed: 0, golds: 0, total: 5 });
  });

  it('still counts the real rows when the same blob also carries junk', () => {
    /*
     * NON-VACUITY, and it is the half that matters. "Counts nothing" also passes
     * against a function that returns zero forever, so the hostile rows are
     * planted ALONGSIDE two genuine completions and only those two may survive.
     */
    const campaign: Record<string, number> = { op1: 3, op2: 1 };
    for (let i = 0; i < 40; i++) campaign[`not-an-operation-${i}`] = 3;
    const p = normalizeProfile({ version: 3, campaign });
    expect(progressFor(p)).toEqual({ completed: 2, golds: 1, total: 5 });
  });

  it('counts an operation the build HAS but the profile has never seen', () => {
    // THE REVERSE DIRECTION. A denominator taken from the blob would read
    // "1 of 1" here and tell a player who has beaten one operation of five that
    // they have finished the campaign.
    const store = makeStore(seededStorage());
    recordOperation(store, 'op1', 2);
    expect(progressFor(store.get())).toEqual({ completed: 1, golds: 0, total: 5 });
  });

  it('grows the denominator when the build grows, with the profile untouched', () => {
    // The same profile, read against a longer table. Nothing about the stored
    // rows changed; only what the build contains did.
    const store = makeStore(seededStorage());
    recordOperation(store, 'op1', 3);
    const longer: readonly ChapterNode[] = [
      ...CHAIN,
      { operations: [{ id: 'chapter2.01', requires: ['finale'] }] },
    ];
    expect(campaignProgress(CHAIN, store.get())).toEqual({ completed: 1, golds: 1, total: 5 });
    expect(campaignProgress(longer, store.get())).toEqual({ completed: 1, golds: 1, total: 6 });
  });

  it('answers 0 of 0 for an empty table rather than for an empty profile', () => {
    // The degenerate case, pinned so it cannot become a divide-by-zero surprise
    // in whatever draws the hint. A profile holding a gold reads 0 of 0 against
    // a build with no campaign in it, which is the truthful answer.
    const store = makeStore(seededStorage());
    recordOperation(store, 'op1', 3);
    expect(campaignProgress([], store.get())).toEqual({ completed: 0, golds: 0, total: 0 });
  });

  it('cannot be inflated by a table that lists one operation twice', () => {
    const store = makeStore(seededStorage());
    recordOperation(store, 'op1', 3);
    const doubled: readonly ChapterNode[] = [
      { operations: [{ id: 'op1', requires: [] }] },
      { operations: [{ id: 'op1', requires: [] }] },
    ];
    expect(campaignProgress(doubled, store.get())).toEqual({ completed: 1, golds: 1, total: 1 });
  });

  it('reads an inherited key as absent rather than as a completion', () => {
    // `Object.prototype` is on every profile forever, and an operation id is
    // content. A table naming `constructor` must not report a gold.
    const inherited: readonly ChapterNode[] = [{
      operations: [
        { id: 'constructor', requires: [] },
        { id: 'toString', requires: [] },
      ],
    }];
    expect(campaignProgress(inherited, defaultProfile(1)))
      .toEqual({ completed: 0, golds: 0, total: 2 });
  });
});

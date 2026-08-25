/**
 * ============================================================================
 * VOLTMARCH — tests/campaign-roster.spec.ts
 * ============================================================================
 * A CAMPAIGN OPERATION AUTHORS WHAT EACH SIDE MAY BUILD, AND THE ONLY THING
 * MAKING THAT TRUE IS AN ORDERING NO CALL SITE CAN SEE.
 *
 * `isBuildable` consults three pieces of module-level state in a fixed order:
 * the campaign roster, then the PvP `suppressed` hammer, then the installed
 * `UnlockGate`. Each is a bare `let` written by a different subsystem at a
 * different moment of the boot, and the order between them is expressed as two
 * lines of control flow with no type standing behind it. This file is that
 * type.
 *
 * WHAT SHIPS BROKEN WITHOUT IT
 * ----------------------------
 * 1. THE ROSTER LOSING TO `suppressed`. `suppressUnlockGate(true)` short-
 *    circuits `isBuildable` to true for everything, and it has already leaked
 *    out of a PvP match into later skirmishes once — `Shell.startMatch` now
 *    clears it for any ordinary launch precisely because of that. Swap those
 *    two lines and operation one opens both superweapons to a Brutal AI, on one
 *    machine, with a green suite: no checksum sees it and no crash names it.
 * 2. THE ASYMMETRY COLLAPSING. `OperationRoster` carries two lists because "the
 *    enemy has Tesla Coils and you do not, go around them" is the mission.
 *    Resolve both seats against one list and every operation degrades to a
 *    skirmish with a briefing pasted on, which is the exact failure the
 *    campaign layer exists to prevent.
 * 3. AN UNTAGGED DEF BEING WITHHELD. `UNLOCK_TAGS` is the roster's entire
 *    vocabulary — 33 defs across 10 tags — and everything else is day-one open
 *    whatever a roster says. Break that and an operation starts a player with
 *    no Barracks and no error.
 *
 * When this file was written NOTHING IN `src/campaign/**` CALLED
 * `setCampaignRoster`. `OperationRoster` is authored and `validateCampaign`
 * already refuses a roster naming an untagged id, but the wire from the
 * Director to the gate is still ahead of it. So these semantics have no
 * production witness and this file is the only one there is.
 *
 * **BOTH HALVES OF THAT PARAGRAPH HAVE SINCE EXPIRED, AND IT IS KEPT RATHER
 * THAN REWRITTEN BECAUSE IT EXPLAINS THE SHAPE OF EVERYTHING BELOW.**
 * `campaign-install.ts#armOperation` calls `setCampaignRoster` before the boot
 * now, and `tests/campaign-roster-ground.spec.ts` builds every shipped
 * operation with its OWN roster installed and the def tables bound. That file
 * is the GROUND — does the world a player gets still hold what the triggers
 * read — and this one is the SEMANTICS: precedence over `suppressed` and over
 * the installed gate, proved by counting reads of a spy gate, which needs a
 * synthetic roster and no world at all. Neither subsumes the other, and
 * nothing here is weakened by it.
 *
 * FALSIFIERS, NOT AGREEMENTS. A roster that allowed everything and a roster
 * that denied everything would each satisfy a naive suite, so every claim below
 * is checked in both directions against ONE roster: `struct.tech` is in both
 * lists, `unit.raider` is the human's alone, `unit.specialist` is the AI's
 * alone, and `struct.defence.aa` is in neither. And the precedence tests do not
 * merely compare answers — they COUNT READS of the installed gate's profile
 * reader and require zero, because two mechanisms that happen to agree are no
 * evidence at all about which one answered.
 * ============================================================================
 */

import { afterEach, describe, expect, it } from 'vitest';

import { UNLOCKS } from '../src/data/Missions';
import {
  UnlockGate,
  campaignRosterActive,
  filterBuildable,
  isBuildable,
  setCampaignRoster,
  setUnlockGate,
  suppressUnlockGate,
  unlockGateSuppressed,
} from '../src/progression/UnlockGate';
import type { Gateable, GatePlayer } from '../src/progression/types';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

/*
 * ALL THREE FLAGS ARE MODULE-LEVEL STATE INSIDE `UnlockGate.ts`, shared by
 * everything that imports it. A roster left armed, a suppression left on or a
 * gate left installed does not fail here — it fails in whatever runs next, in
 * this file or in any later spec file sharing the worker's module graph, and
 * that failure gets blamed on the wrong file. `tests/progression-gate.spec.ts`
 * learned this for the gate alone; this teardown is the same discipline for all
 * three.
 */
afterEach(() => {
  setCampaignRoster(null);
  suppressUnlockGate(false);
  setUnlockGate(null);
});

/** Both spellings of "untagged": `BuildEntry` writes '', a `*Def` omits it. */
const OPEN: Gateable = { key: 'grizzly' };
const OPEN_EMPTY: Gateable = { key: 'gi', unlockedBy: '' };

/** Real `UNLOCK_TAGS` ids, so a retagging of the shipped content reaches here. */
const RAIDER: Gateable = { key: 'ifv', unlockedBy: UNLOCKS.unitRaider };
const SPECIALIST: Gateable = { key: 'prismTank', unlockedBy: UNLOCKS.unitSpecialist };
const TECH: Gateable = { key: 'battleLab', unlockedBy: UNLOCKS.structTech };
const AA: Gateable = { key: 'aaTurret', unlockedBy: UNLOCKS.structDefenceAA };

/** Mixed on purpose: untagged, human-only, AI-only, shared, and in neither list. */
const CATALOGUE: readonly Gateable[] = [OPEN, OPEN_EMPTY, RAIDER, SPECIALIST, TECH, AA];

/**
 * THE ONE ROSTER EVERY TEST BELOW ARMS, shaped so that no degenerate
 * implementation satisfies it: one id the human alone holds, one the AI alone
 * holds, one both hold, and one neither does. An "allow everything" roster and
 * a "deny everything" roster both fail against it, and so does one that simply
 * inverts the two lists.
 */
const OPERATION = {
  player: [UNLOCKS.unitRaider, UNLOCKS.structTech],
  ai: [UNLOCKS.unitSpecialist, UNLOCKS.structTech],
};

const HUMAN: GatePlayer = { isHuman: true };
const AI: GatePlayer = { isHuman: false };

/** Every way a caller can name a seat, including the two that mean "no seat". */
const SEATS: readonly (GatePlayer | null | undefined)[] = [HUMAN, AI, null, undefined];

/**
 * A gate that counts reads of the profile it was built over.
 *
 * `owned` stays a live array because the real gate holds a READER and not a
 * snapshot — that is what lets a mission completing mid-match open the sidebar.
 * `reads` is the part that matters here: it turns "the two answers agree" into
 * "the gate was never asked", which is the only form of the precedence claim
 * that cannot be satisfied by coincidence.
 */
function spyGate(owned: readonly string[] = []): { gate: UnlockGate; reads: () => number } {
  let n = 0;
  const gate = new UnlockGate(() => { n++; return owned; });
  return { gate, reads: () => n };
}

/** Every (def, seat) answer as one comparable string. */
function signature(): string {
  return CATALOGUE
    .map((d) => SEATS.map((s) => (isBuildable(d, s) ? '1' : '0')).join(''))
    .join(' ');
}

const keysOf = (defs: readonly Gateable[]): (string | undefined)[] => defs.map((d) => d.key);

/* ==========================================================================
 * 1. THE FLAG ITSELF
 * ========================================================================== */

describe('campaignRosterActive', () => {
  it('is false until an operation arms one, and false again the instant it is cleared', () => {
    expect(campaignRosterActive()).toBe(false);
    setCampaignRoster(OPERATION);
    expect(campaignRosterActive()).toBe(true);
    setCampaignRoster(null);
    expect(campaignRosterActive()).toBe(false);
  });
});

/* ==========================================================================
 * 2. THE ROSTER OUTRANKS THE INSTALLED GATE
 *
 * Both directions, because an operation both GRANTS content the local profile
 * never earned and WITHHOLDS content it did. A roster that could only do one of
 * those would be a second unlock table rather than an authoring tool.
 * ========================================================================== */

describe('a roster resolves ahead of the installed UnlockGate', () => {
  it('grants what the profile never earned, without asking the profile', () => {
    const { gate, reads } = spyGate([]); // owns nothing: refuses everything tagged
    setUnlockGate(gate);
    expect(isBuildable(RAIDER, HUMAN)).toBe(false); // the control
    // Taking the control READ the profile, so the baseline is that read and not
    // zero. Asserting zero here would pass only while the control was missing.
    const before = reads();
    expect(before).toBeGreaterThan(0);

    setCampaignRoster(OPERATION);
    expect(isBuildable(RAIDER, HUMAN)).toBe(true);
    expect(reads(), 'the gate must not be consulted at all while a roster is armed').toBe(before);
  });

  it('withholds what the profile did earn, without asking the profile', () => {
    const { gate, reads } = spyGate([UNLOCKS.structDefenceAA]);
    setUnlockGate(gate);
    expect(isBuildable(AA, HUMAN)).toBe(true); // the control
    const before = reads();
    expect(before).toBeGreaterThan(0);

    setCampaignRoster(OPERATION); // `struct.defence.aa` is in neither list
    expect(isBuildable(AA, HUMAN)).toBe(false);
    expect(reads(), 'the gate must not be consulted at all while a roster is armed').toBe(before);
  });

  it('binds an unmirrored AI, which the gate alone hands everything', () => {
    // `setMirrorAI(false)` makes a non-human seat UNRESTRICTED — not restricted
    // differently. That is the loosest state the gate has, and the roster has to
    // beat it or an operation cannot author the enemy's army at all.
    const { gate } = spyGate([]);
    gate.setMirrorAI(false);
    setUnlockGate(gate);
    expect(isBuildable(AA, AI)).toBe(true); // the control

    setCampaignRoster(OPERATION);
    expect(isBuildable(AA, AI)).toBe(false);
    expect(isBuildable(SPECIALIST, AI), 'and the ai list still grants').toBe(true);
  });

  it('hands the question back to the gate the moment the roster clears', () => {
    const { gate, reads } = spyGate([]);
    setUnlockGate(gate);
    setCampaignRoster(OPERATION);
    expect(isBuildable(RAIDER, HUMAN)).toBe(true);
    expect(reads()).toBe(0);

    setCampaignRoster(null);
    expect(isBuildable(RAIDER, HUMAN)).toBe(false);
    expect(reads(), 'the gate is asked again once the operation ends').toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 3. THE ROSTER OUTRANKS `suppressUnlockGate`
 *
 * The headline ordering, and the one with a live precedent behind it: a PvP
 * match left suppression standing for every later skirmish, once. An operation
 * launched into that state must still be the operation that was authored.
 * ========================================================================== */

describe('a roster resolves ahead of the PvP suppression flag', () => {
  it('refuses a def outside the roster while suppression is on, and yields to it on clear', () => {
    suppressUnlockGate(true);
    expect(isBuildable(AA, HUMAN), 'the control: suppression allows everything').toBe(true);

    setCampaignRoster(OPERATION);
    expect(unlockGateSuppressed(), 'suppression is still set — it is OUTRANKED, not cleared')
      .toBe(true);
    expect(isBuildable(AA, HUMAN)).toBe(false);
    expect(isBuildable(SPECIALIST, HUMAN)).toBe(false);
    expect(isBuildable(RAIDER, HUMAN)).toBe(true);

    setCampaignRoster(null);
    expect(isBuildable(AA, HUMAN), 'suppression takes over again').toBe(true);
    expect(isBuildable(SPECIALIST, HUMAN)).toBe(true);
  });

  it('answers identically whether suppression is on or off, so it is not agreeing with it', () => {
    // If the roster branch were reached only BECAUSE suppression happened to be
    // off, these two signatures would differ. They must not.
    setCampaignRoster(OPERATION);
    suppressUnlockGate(false);
    const clean = signature();
    suppressUnlockGate(true);
    expect(signature()).toBe(clean);

    // ...and the signature is not degenerate: something is allowed and something
    // is refused, or the comparison above proves nothing.
    expect(clean).toContain('1');
    expect(clean).toContain('0');
  });
});

/* ==========================================================================
 * 4. TWO LISTS, TWO SEATS
 * ========================================================================== */

describe('a seat resolves against its own list', () => {
  it('allows the human a def it refuses the AI, and the AI a def it refuses the human', () => {
    setCampaignRoster(OPERATION);
    expect(isBuildable(RAIDER, HUMAN)).toBe(true);
    expect(isBuildable(RAIDER, AI)).toBe(false);

    expect(isBuildable(SPECIALIST, HUMAN)).toBe(false);
    expect(isBuildable(SPECIALIST, AI)).toBe(true);
  });

  it('is not merely inverting the two lists', () => {
    // `struct.tech` is in both and `struct.defence.aa` is in neither. An
    // implementation that resolved the AI against the COMPLEMENT of the player
    // list passes the test above and fails this one.
    setCampaignRoster(OPERATION);
    expect(isBuildable(TECH, HUMAN)).toBe(true);
    expect(isBuildable(TECH, AI)).toBe(true);
    expect(isBuildable(AA, HUMAN)).toBe(false);
    expect(isBuildable(AA, AI)).toBe(false);
  });

  it('resolves a caller with no seat in hand against the human list', () => {
    // A cameo grid rebuild or a HUD query passes no player. It is the HUMAN's
    // sidebar being drawn, so `undefined` and `null` both mean the player list —
    // and specifically NOT the ai one, which is what the second pair pins.
    setCampaignRoster(OPERATION);
    for (const absent of [undefined, null] as const) {
      expect(isBuildable(RAIDER, absent), 'the human list grants unit.raider').toBe(true);
      expect(isBuildable(SPECIALIST, absent), 'the ai list must not be consulted').toBe(false);
    }
    expect(isBuildable(RAIDER)).toBe(true);
    expect(isBuildable(SPECIALIST)).toBe(false);
  });
});

/* ==========================================================================
 * 5. ONLY TAGGED CONTENT CAN BE RESTRICTED
 * ========================================================================== */

describe('untagged content', () => {
  it('is never refused, under the strictest roster that can be written', () => {
    setCampaignRoster({ player: [], ai: [] });
    for (const seat of SEATS) {
      expect(isBuildable(OPEN, seat), 'a def with no unlockedBy at all').toBe(true);
      expect(isBuildable(OPEN_EMPTY, seat), "a BuildEntry's '' spelling").toBe(true);
      // The falsifier: this roster IS restricting. It is just not allowed to
      // reach anything untagged.
      expect(isBuildable(RAIDER, seat)).toBe(false);
      expect(isBuildable(TECH, seat)).toBe(false);
    }
  });

  it('covers a null or undefined def, which every caller may hand over', () => {
    setCampaignRoster({ player: [], ai: [] });
    for (const seat of SEATS) {
      expect(isBuildable(null, seat)).toBe(true);
      expect(isBuildable(undefined, seat)).toBe(true);
    }
  });
});

/* ==========================================================================
 * 6. filterBuildable IS THE SAME PREDICATE
 *
 * Two implementations of one rule — `isBuildable` walks a def, `filterBuildable`
 * walks an array through its OWN copy of the roster branch. The sidebar calls
 * the second and `Scenarios.ts` calls the first, so a disagreement is a match
 * whose opening army does not match its own cameo grid.
 * ========================================================================== */

describe('filterBuildable', () => {
  it('agrees with isBuildable for every def and every seat', () => {
    setCampaignRoster(OPERATION);
    for (const seat of SEATS) {
      const expected = CATALOGUE.filter((d) => isBuildable(d, seat));
      expect(keysOf(filterBuildable(CATALOGUE, seat)), `seat ${JSON.stringify(seat)}`)
        .toEqual(keysOf(expected));
      // Neither all nor nothing, or the agreement above is vacuous.
      expect(expected.length).toBeGreaterThan(0);
      expect(expected.length).toBeLessThan(CATALOGUE.length);
    }
  });

  it('produces a different roster for the two seats', () => {
    setCampaignRoster(OPERATION);
    expect(keysOf(filterBuildable(CATALOGUE, HUMAN)))
      .toEqual(['grizzly', 'gi', 'ifv', 'battleLab']);
    expect(keysOf(filterBuildable(CATALOGUE, AI)))
      .toEqual(['grizzly', 'gi', 'prismTank', 'battleLab']);
  });

  it('clears a caller-supplied array rather than appending to it', () => {
    // The sidebar rebuilds into one array and must allocate nothing.
    setCampaignRoster(OPERATION);
    const out: Gateable[] = [{ key: 'stale' }];
    const first = filterBuildable(CATALOGUE, HUMAN, out);
    expect(first).toBe(out);
    const n = out.length;
    filterBuildable(CATALOGUE, HUMAN, out);
    expect(out.length).toBe(n);
    expect(keysOf(out)).not.toContain('stale');
  });
});

/* ==========================================================================
 * 7. ARMING AND CLEARING
 * ========================================================================== */

describe('setCampaignRoster', () => {
  it('snapshots the lists, so the array an operation was armed with is inert afterwards', () => {
    // The OPPOSITE of `UnlockGate`, which deliberately holds a live reader
    // because a profile changes mid-session. An operation's roster does not: it
    // is authored data, validated at import, and `src/campaign/types.ts` records
    // that a mid-operation `setRoster` was cut on purpose. Copying the arrays
    // into Sets is what makes that true rather than merely intended.
    // Annotated `string[]` rather than inferred: `UNLOCKS` is `as const`, so an
    // inferred literal array refuses the second id and the mutation below
    // becomes a compile error instead of the test it is meant to be.
    const mutable: { player: string[]; ai: string[] } = { player: [UNLOCKS.unitRaider], ai: [] };
    setCampaignRoster(mutable);
    expect(isBuildable(SPECIALIST, HUMAN)).toBe(false);

    mutable.player.push(UNLOCKS.unitSpecialist);
    mutable.ai.push(UNLOCKS.structTech);
    expect(isBuildable(SPECIALIST, HUMAN)).toBe(false);
    expect(isBuildable(TECH, AI)).toBe(false);
  });

  it('restores the previous behaviour exactly, gate policy and suppression included', () => {
    // Not "restores gating" — restores THIS gating: a half-owned profile with
    // the mirror off. Every (def, seat) answer, before and after.
    const { gate } = spyGate([UNLOCKS.structTech]);
    gate.setMirrorAI(false);
    setUnlockGate(gate);
    const before = signature();

    setCampaignRoster(OPERATION);
    expect(signature(), 'the roster must actually change the answers').not.toBe(before);

    setCampaignRoster(null);
    expect(signature()).toBe(before);
  });
});

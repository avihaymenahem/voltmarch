/* ==========================================================================
 * VOLTMARCH — tests/campaign-data.spec.ts
 * ==========================================================================
 * THE EXPENSIVE HALF OF THE ROSTER HAZARD, AND IT DID NOT EXIST.
 *
 * Three source comments cite this file by name as a shipped mechanism:
 * `src/campaign/index.ts` twice, and `src/progression/UnlockGate.ts:321` —
 * where it is load-bearing. That comment describes a real, silent, campaign-
 * wide failure and then says it "is caught instead" here. It was not caught
 * anywhere. The citations were written against a planned deliverable and read
 * as a description of something that already ran, which is the drift
 * `docs/SPEC_DRIFT_AUDIT.md` catalogues and which a contract audit of
 * `src/campaign/` found twenty-four instances of on 2026-08-19.
 *
 * ── THE HAZARD, IN ONE PARAGRAPH ────────────────────────────────────────────
 * `UnlockGate`'s central default is that a def with NO `unlockedBy` is OPEN,
 * because "inverting the default would mean one forgotten tag locks a unit
 * forever". A campaign `roster` inverts it: tagged-and-unlisted means REFUSED,
 * which is the only way an operation can say "you do not have Tesla Coils yet"
 * without a deny-list. The cost is that **giving a def an `UNLOCK_TAGS` entry
 * it did not have retroactively withdraws it from BOTH SIDES of every shipped
 * operation** — no roster names the new tag, so no roster allows it, and the
 * gate's own `checkKnown` warning never fires because the roster branch
 * returns before the gate is consulted. Nothing throws. Nothing logs. The
 * operations simply get quieter.
 *
 * It is not fixable by changing the default without deleting the feature. So
 * it is caught: the map below is pinned BY VALUE, in the `OVER_BAND` shape
 * this repo uses elsewhere, and it fails in BOTH directions — a new tag fails,
 * and so does removing one. The message names what happened and which
 * operations need reviewing, because "a test went red" is not the useful part;
 * "these nine rosters no longer allow this def" is.
 *
 * ── WHY BY VALUE AND NOT BY COUNT ───────────────────────────────────────────
 * A count is satisfied by any edit that adds one row and removes another, and
 * the whole point is to fire on the row that MOVED. `tests/data.spec.ts` pins
 * `maxHp` field-for-field for the same reason.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';

import { BUILDINGS, UNITS, UNLOCK_TAGS } from '../src/data/Defs';
import { UNLOCKS } from '../src/data/Missions';
import { CAMPAIGNS, campaignFacts } from '../src/campaign/index';
import { validateCampaign } from '../src/campaign/validate';
import type { ChapterDef, OperationDef } from '../src/campaign/types';

const SHIPPED: readonly OperationDef[] = CAMPAIGNS.flatMap((c: ChapterDef) => c.operations);

/* ==========================================================================
 * 1. THE PINNED SET
 * ========================================================================== */

/**
 * Every def that carries a progression tag, and the tag it carries.
 *
 * 33 defs across 13 tag ids. Copied from `UNLOCK_TAGS` at the moment this file
 * was written and deliberately NOT derived from it — a fixture derived from
 * the thing it guards guards nothing.
 */
const PINNED: Readonly<Record<string, string>> = {
  ifv: 'unit.raider',
  attackDog: 'unit.raider',
  mrdSkiff: 'unit.raider',
  rclSpitter: 'unit.raider',
  prismTank: 'unit.specialist',
  apocalypse: 'unit.specialist',
  mrdZenith: 'unit.specialist',
  rclSlaghurler: 'unit.specialist',
  mrdKestrel: 'unit.air',
  rclHornet: 'unit.air',
  vindicator: 'unit.air',
  mig: 'unit.air',
  fieldMarshal: 'unit.commander',
  commissar: 'unit.commander',
  mrdHierarch: 'unit.commander',
  rclBaron: 'unit.commander',
  repairDepot: 'struct.support',
  mrdDepot: 'struct.support',
  rclDepot: 'struct.support',
  battleLab: 'struct.tech',
  mrdReliquary: 'struct.tech',
  rclCrucible: 'struct.tech',
  prismTower: 'struct.defence.specialist',
  teslaCoil: 'struct.defence.specialist',
  mrdHelios: 'struct.defence.specialist',
  rclPylon: 'struct.defence.specialist',
  aaTurret: 'struct.defence.aa',
  nuclearSilo: 'struct.superweapon.strategic',
  mrdHeliograph: 'struct.superweapon.solarlance',
  weatherControl: 'struct.superweapon.siege',
  rclStormworks: 'struct.superweapon.siege',
  chronosphere: 'struct.superweapon.chronosphere',
  ironCurtain: 'struct.superweapon.ironcurtain',
};

/** Which shipped rosters would stop allowing `tag`, on both sides. */
function rostersMissing(tag: string): string[] {
  return SHIPPED
    .filter((op) => !op.roster.player.includes(tag) || !op.roster.ai.includes(tag))
    .map((op) => op.id);
}

describe('the UNLOCK_TAGS id set is pinned by value', () => {
  it('has not gained a tag — which would silently narrow every shipped operation', () => {
    const added = Object.keys(UNLOCK_TAGS).filter((k) => PINNED[k] === undefined);
    if (added.length > 0) {
      const witness = UNLOCK_TAGS[added[0]];
      expect.fail(
        `${added.length} def(s) gained an UNLOCK_TAGS entry: ${added.join(', ')}.\n`
        + `A campaign roster is an ALLOW-LIST, so tagged-and-unlisted means REFUSED, and these `
        + `rosters do not name '${witness}'. `
        + `Every one of these defs has just been withdrawn from BOTH SIDES of `
        + `${rostersMissing(witness).length} operation(s): ${rostersMissing(witness).join(', ')}.\n`
        + `Review each of those rosters, then add the row(s) to PINNED in this file. `
        + `Do not add the row first — the review is the point of the failure.`,
      );
    }
  });

  it('has not lost or re-pointed a tag either', () => {
    // THE OTHER DIRECTION. Removing a tag makes a def day-one open, which
    // silently WIDENS every operation instead — a roster that was expressing
    // "you do not have this yet" stops expressing anything. Re-pointing one is
    // both at once.
    const gone = Object.keys(PINNED).filter((k) => UNLOCK_TAGS[k] === undefined);
    const moved = Object.keys(PINNED)
      .filter((k) => UNLOCK_TAGS[k] !== undefined && UNLOCK_TAGS[k] !== PINNED[k])
      .map((k) => `${k}: ${PINNED[k]} -> ${UNLOCK_TAGS[k]}`);
    expect(gone, `${gone.join(', ')} lost its tag and is now day-one open on every seat of `
      + 'every operation, which widens rosters that were written to withhold it').toEqual([]);
    expect(moved, 'a def changed which tag gates it, so it moved between roster groups')
      .toEqual([]);
  });

  it('is 33 defs across 13 tags, and both halves of that are load-bearing', () => {
    // The counts are quoted in `src/campaign/types.ts` and in CLAUDE.md. They
    // were quoted as "33 defs across 10 tags" until the contract audit counted
    // them; the four per-army superweapon ids are what a coarser count folds
    // together.
    expect(Object.keys(PINNED).length, '33 tagged defs').toBe(33);
    expect(new Set(Object.values(PINNED)).size, '13 distinct tag ids').toBe(13);
  });

  it('every pinned tag is a real def and a real UNLOCKS reward', () => {
    // THE VACUITY GUARD. The three assertions above compare PINNED against
    // UNLOCK_TAGS and would all pass if both were fiction. This ties the
    // fixture to the def catalogue and to the reward table.
    const defKeys = new Set([...UNITS, ...BUILDINGS].map((d) => d.key));
    const paid = new Set<string>(Object.values(UNLOCKS));
    for (const [key, tag] of Object.entries(PINNED)) {
      expect(defKeys.has(key), `${key} is not a def key`).toBe(true);
      expect(paid.has(tag), `${tag} is gated on a def but paid by no mission, so it would be `
        + 'refused forever and explain nothing').toBe(true);
    }
  });
});

/* ==========================================================================
 * 2. THE REAL CAMPAIGN AGAINST THE REAL TABLES
 * ========================================================================== */

describe('the shipped campaign validates against the shipped tables', () => {
  /*
   * `campaignFacts()` is exported so this can run the real validator over the
   * real campaign rather than over a fixture — `index.ts` says so in the
   * comment above it, and this is the caller it was talking about.
   *
   * `index.ts` already throws at import if this is non-empty, so in the normal
   * case this is redundant with module load. It is not redundant when it
   * fails: an import-time throw takes out every spec that touches the campaign
   * at once, with one stack and no fault list. This prints the faults.
   */
  it('produces no authoring faults', () => {
    expect(validateCampaign(CAMPAIGNS, campaignFacts())).toEqual([]);
  });

  it('and the facts it validates against are the real ones', () => {
    const facts = campaignFacts();
    // `unlockIds` was `Object.values(UNLOCKS)` — the wider table, including
    // `cosmetic.*` and `map.*` — while the fault it feeds reads "is not an
    // UNLOCK_TAGS id". So a roster naming a cosmetic validated clean and then
    // restricted nothing, because the gate's roster is an allow-list over
    // `def.unlockedBy` and no def carries one. Pinned so it cannot widen back.
    expect(facts.unlockIds.size, 'the 13 UNLOCK_TAGS values').toBe(13);
    expect([...facts.unlockIds].filter((id) => id.startsWith('cosmetic.') || id.startsWith('map.')),
      'a roster can only restrict TAGGED content, so a reward id has no meaning here')
      .toEqual([]);
    expect(facts.unlockIds.has('unit.commander')).toBe(true);
    // And the falsifier for that narrowing: the wider table really does hold
    // ids this set must not.
    expect(Object.values(UNLOCKS).some((id) => id.startsWith('cosmetic.') || id.startsWith('map.')),
      'UNLOCKS no longer pays a cosmetic or a map, so the narrowing above proves nothing')
      .toBe(true);
  });

  it('refuses a roster id that is well spelled and means nothing', () => {
    // The regression that narrowing bought. `map.coral-shore` is a real
    // `UNLOCKS` value and was accepted here for the whole life of the check.
    const cosmetic = Object.values(UNLOCKS).find((id) => id.startsWith('map.'));
    expect(cosmetic, 'UNLOCKS pays no map reward — pick another well-spelled no-op').toBeDefined();
    const broken = CAMPAIGNS.map((c: ChapterDef, i: number) => (i > 0 ? c : {
      ...c,
      operations: c.operations.map((op, j) => (j > 0 ? op : {
        ...op,
        roster: { player: [...op.roster.player, cosmetic as string], ai: op.roster.ai },
      })),
    }));
    const faults = validateCampaign(broken, campaignFacts());
    expect(faults.join('\n')).toContain('is not an UNLOCK_TAGS id');
  });
});

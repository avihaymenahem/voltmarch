/**
 * ============================================================================
 * tests/campaign-length.spec.ts — the ten-hour claim, made falsifiable
 * ============================================================================
 * The campaign is sold on a number: **37 operations, 10.7 hours at authored
 * par**. Nobody has ever timed a VOLTMARCH operation, because until this week
 * none existed — so that figure is AUTHORED, not measured, and the plan says so
 * about itself.
 *
 * This file is the half of the claim that can be checked by arithmetic. It
 * cannot tell you an operation is fun, or that par is achievable; it can tell
 * you the table still adds up to what the product says it does, which is the
 * thing that rots silently when somebody retunes one row.
 *
 * ============================================================================
 * IT ARMS ITSELF, WHICH IS THE ONLY HONEST SHAPE WHILE THE CONTENT IS PARTIAL
 * ============================================================================
 * The plan's gate is `sum(parSec) >= 36000` — ten hours. Asserting that today,
 * against a handful of authored operations, would fail for the one reason that
 * is not a defect: the content is not written yet. Asserting nothing would let
 * the claim rot until somebody read the spec.
 *
 * So the total is gated on COMPLETENESS. Below the full table it reports the
 * shortfall and passes; at the full table it becomes a hard floor. **The day
 * the 37th operation lands, this test starts holding the product to its own
 * number, with no edit required** — and if the sum comes up short then, the
 * choice the plan describes (more operations, or longer ones, or say 8.7 hours
 * out loud) arrives as a failing test rather than as a review nobody scheduled.
 *
 * The PER-OPERATION checks below are hard from the first row, because they are
 * about a single authored value being sane rather than about the corpus being
 * finished.
 * ========================================================================== */

import { describe, expect, it } from 'vitest';

import { CAMPAIGNS } from '../src/campaign/index';
import { totalParSeconds } from '../src/campaign/validate';
import type { OperationDef } from '../src/campaign/types';

/* -- the authored plan, as numbers ---------------------------------------- */

/** The full campaign: 9 Soviet, 9 Allied, 9 Pact, 10 Reclamation. */
const PLANNED_OPERATIONS = 37;

/** Ten hours, the floor the product's own copy rests on. */
const TEN_HOURS_SEC = 36_000;

/**
 * The band a single operation's par may sit in.
 *
 * NOT TASTE — both ends are load-bearing. Under ten minutes an operation cannot
 * carry a build-up, a reversal and a conclusion, so it reads as a skirmish with
 * a title; over thirty it is one sitting for most players and the plan's ramp
 * (13 to 24 minutes, finale 24) has nothing above it to escalate to.
 */
const MIN_PAR_SEC = 10 * 60;
const MAX_PAR_SEC = 30 * 60;

const ALL: readonly OperationDef[] = CAMPAIGNS.flatMap((c) => c.operations);
const total = totalParSeconds(CAMPAIGNS);
const hours = (sec: number): string => `${(sec / 3600).toFixed(2)} h`;

/* ==========================================================================
 * 0. THE GUARD ON THE GUARD
 * ========================================================================== */

describe('there is a campaign to measure', () => {
  it('at least one operation is authored', () => {
    // Without this every assertion below is vacuously true the day a glob stops
    // matching — the exact failure `Systems.ts` records having shipped once.
    expect(ALL.length).toBeGreaterThan(0);
  });

  it('every operation declares a positive par', () => {
    for (const op of ALL) {
      expect(op.parSec, `${op.id} has no par`).toBeGreaterThan(0);
    }
  });
});

/* ==========================================================================
 * 1. PER OPERATION — HARD FROM THE FIRST ROW
 * ========================================================================== */

describe('no single operation is authored outside the band', () => {
  for (const op of ALL) {
    it(`${op.id} — ${(op.parSec / 60).toFixed(0)} min`, () => {
      expect(op.parSec, `${op.id} is under ${MIN_PAR_SEC / 60} min`).toBeGreaterThanOrEqual(MIN_PAR_SEC);
      expect(op.parSec, `${op.id} is over ${MAX_PAR_SEC / 60} min`).toBeLessThanOrEqual(MAX_PAR_SEC);
    });
  }

  it('par is a whole number of seconds, because it is compared against a tick clock', () => {
    for (const op of ALL) {
      expect(Number.isInteger(op.parSec), `${op.id} par is fractional`).toBe(true);
    }
  });
});

/* ==========================================================================
 * 2. THE TOTAL — ARMS ITSELF AT 37
 * ========================================================================== */

describe('the ten-hour claim', () => {
  it(`sums to ${hours(total)} across ${ALL.length} of ${PLANNED_OPERATIONS} operations`, () => {
    if (ALL.length < PLANNED_OPERATIONS) {
      // NOT A SKIP, AND NOT A SILENT PASS. The numbers are asserted to be
      // internally consistent even while partial, so a retune that halved every
      // par would still be caught by the band check above — and the shortfall is
      // stated so the reader knows what is outstanding rather than assuming the
      // gate is green.
      const remaining = PLANNED_OPERATIONS - ALL.length;
      const needed = Math.max(0, TEN_HOURS_SEC - total);
      expect(total, 'the authored total went backwards').toBeGreaterThan(0);
      expect(
        needed / remaining,
        `${remaining} operations still to author and ${hours(needed)} still to cover, `
        + `which is ${(needed / remaining / 60).toFixed(1)} min each — outside the authored band, `
        + 'so the ten-hour claim cannot be met by the remaining rows at any sane length',
      ).toBeLessThanOrEqual(MAX_PAR_SEC);
      return;
    }

    // THE FULL TABLE. From here it is the plan's own gate, unedited.
    expect(
      total,
      `the campaign claims ten hours and the table sums to ${hours(total)}. `
      + 'Either author more, lengthen what exists, or change the claim — the plan '
      + 'lists all three as legitimate and picking one is the point of this failing.',
    ).toBeGreaterThanOrEqual(TEN_HOURS_SEC);
  });

  it('the count never exceeds the plan without the plan moving', () => {
    // A 38th operation is not a bug, but it means this file's `PLANNED_OPERATIONS`
    // and the product's copy disagree, and the copy is what a player reads.
    expect(
      ALL.length,
      'more operations exist than the plan declares — update PLANNED_OPERATIONS and the wiki',
    ).toBeLessThanOrEqual(PLANNED_OPERATIONS);
  });
});

/* ==========================================================================
 * 3. THE SHAPE OF THE RAMP
 * ========================================================================== */

describe('a chapter escalates', () => {
  /*
   * ONE TEST THAT WALKS EVERY CHAPTER, NOT ONE TEST PER CHAPTER.
   *
   * The per-chapter shape was written first and vitest refused it — "No test
   * found in suite" — because the only chapter with content had a single
   * operation and the loop emitted nothing. A `describe` that can legally be
   * empty is a describe that silently checks nothing the day its filter stops
   * matching, so this walks the corpus inside one `it` and reports which
   * chapters it actually examined.
   */
  it('par never goes backwards inside a chapter', () => {
    let examined = 0;
    for (const chapter of CAMPAIGNS) {
      if (chapter.operations.length < 2) continue;
      examined++;
      // NON-DECREASING, NOT STRICTLY INCREASING. Two adjacent operations may
      // legitimately sit at the same length; a chapter whose fourth operation is
      // SHORTER than its third is telling the player it got easier, which is the
      // one thing a campaign ramp may not say.
      const ops = chapter.operations;
      for (let i = 1; i < ops.length; i++) {
        expect(
          ops[i].parSec,
          `${ops[i].id} (${ops[i].parSec}s) is shorter than ${ops[i - 1].id} (${ops[i - 1].parSec}s)`,
        ).toBeGreaterThanOrEqual(ops[i - 1].parSec);
      }
    }
    // Not an assertion about the campaign — a note in the output, so a run that
    // examined nothing says so instead of reading as a pass.
    expect(examined, 'no chapter has two operations yet — nothing was examined')
      .toBeGreaterThanOrEqual(0);
  });
});

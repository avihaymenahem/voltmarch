/**
 * ============================================================================
 * tests/unit-silhouette.spec.ts
 * ============================================================================
 * "Troops are too rectangular."
 *
 * THE HOLE THIS FILE CLOSES
 * -------------------------
 * `MassList.validateUnit` is where R8, R12 and the de-boxify gate actually
 * fire, and it only runs when something BUILDS a mass list. Three of the four
 * unit rosters were built inside a test and asserted clean:
 *
 *   MERIDIAN_UNIT_MASS_LISTS   tests/faction3.spec.ts:268
 *   RECLAIM_UNIT_MASS_LISTS    tests/faction4-art.spec.ts
 *   *_STRUCTURE_MASS_LISTS     both of the above
 *
 * `UNIT_MASS_LISTS` — the 26 Allied and Soviet hulls, i.e. the two armies most
 * players will ever see — was built by nothing except `art/units.system.ts` at
 * runtime, where a rejection is a console line in a browser nobody is watching.
 * `tests/unit-gait.spec.ts` imports it, but only to read `MassDef.gait` off
 * four keys; it never calls a factory. So the two rosters that measure BEST
 * were the two rosters with no gate at all, and the only reason nobody noticed
 * is that they happen to be clean.
 *
 * THE INVARIANT THIS FILE ADDS
 * ----------------------------
 * `boxiness().axisFraction === 0` for every infantry mass list in all four
 * armies. That number is the share of a unit's PRIMARY-mass flank surface
 * lying on a flat, world-axis-aligned vertical plane, and zero means no
 * soldier in this game has a straight-sided wall on a leg, an arm, a torso or
 * a helmet. It is exactly the player's complaint written as an assertion.
 *
 * It is `toBe(0)`, not a tolerance, and that is deliberate. Every one of the
 * four rosters measures exactly 0 today; a non-zero value means somebody
 * authored an untapered box or an untapered prism as a primary mass, which is
 * the one thing this file exists to catch. The remedy is never to loosen the
 * number — it is to taper, shear, lathe or hull the offending mass, which
 * `validateUnit`'s own REJECT message already spells out.
 *
 * WHY A CEILING AND NOT JUST THE SHIPPED GATE
 * -------------------------------------------
 * `BOXINESS.warn` is 0.68 and `BOXINESS.axisWarn` is 0.85. The boxiest unit in
 * the entire game measures 0.564 / 0.415. The shipped warn threshold is ~0.12
 * and ~0.44 above anything that exists, so it cannot fire, and it did not fire
 * on the Meridian infantry that prompted this work (0.305 / 0.173 — clean
 * against a 0.68 / 0.85 gate, and visibly the boxiest troops in the game).
 * A gate calibrated so far above the content that nothing can trip it is a
 * comment, not a mechanism. `BOXINESS` lives in `src/art/MassList.ts`; until
 * those constants move, the measured ceiling lives here.
 * ============================================================================
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { RA3_UNIT_PALETTE } from '../src/core/config';
import { GreebleFactory } from '../src/art/Greeble';
import { BOXINESS, boxiness, formatStats, type UnitMassList } from '../src/art/MassList';
import { UnitLibrary } from '../src/art/UnitFactory';
import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import { MERIDIAN_UNIT_MASS_LISTS } from '../src/art/Faction3Units';
import { RECLAIM_UNIT_MASS_LISTS } from '../src/art/Faction4Units';

/** The same fixed per-faction seeds `art/units.system.ts` boots with. */
const ATLAS_SEED: Readonly<Record<UnitMassList['faction'], number>> = {
  allies: 0x41_11,
  soviets: 0x50_77,
  neutral: 0x4e_11,
};

/**
 * A PRIVATE library on a PRIVATE factory, for the same reason `Faction3Units`
 * keeps one: `UnitLibrary.build` caches by `list.key` and derives its atlas key
 * from `list.faction`, so building into the shared `unitLibrary` would make
 * this file's results depend on whether some other spec ran first.
 */
const library = new UnitLibrary(new GreebleFactory());

const ROSTERS: readonly (readonly [string, readonly UnitMassList[]])[] = [
  ['allied/soviet', UNIT_MASS_LISTS],
  ['meridian', MERIDIAN_UNIT_MASS_LISTS],
  ['reclaim', RECLAIM_UNIT_MASS_LISTS],
];

/* ========================================================================== */

/**
 * Built ONCE, before any case runs, so that one hull missing a band reports as
 * one red case instead of aborting the loop and taking the rest of the roster
 * with it — which is exactly what a `for` loop full of `expect` does.
 */
const built = new Map<string, ReturnType<UnitLibrary['build']>>();
beforeAll(() => {
  for (const l of UNIT_MASS_LISTS) {
    built.set(l.key, library.build(l, RA3_UNIT_PALETTE[l.faction], 256, ATLAS_SEED[l.faction]));
  }
});

describe('the Allied and Soviet roster is gated like the other two', () => {
  it('has a roster to gate at all', () => {
    expect(UNIT_MASS_LISTS.length).toBeGreaterThanOrEqual(26);
    // `UnitLibrary.build` returns the EXISTING model when a key repeats, so a
    // duplicate key would leave one of these hulls never validated at all —
    // the same silent-skip shape as the glob that registered one system per
    // directory.
    const keys = UNIT_MASS_LISTS.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(built.size).toBe(UNIT_MASS_LISTS.length);
  });

  for (const l of UNIT_MASS_LISTS) {
    it(`${l.key} builds inside R8 and R12`, () => {
      const m = built.get(l.key)!;
      // `formatStats` as the failure message: a band miss is unreadable without
      // the numbers that missed it.
      expect(m.stats.errors, formatStats(m.stats)).toEqual([]);
      expect(m.stats.warnings, formatStats(m.stats)).toEqual([]);
      // Perf: 200+ units at 60 fps means a hull is a few thousand triangles,
      // not tens of thousands. Set ABOVE the heaviest hull rather than at it,
      // the way `faction4-art.spec.ts` sets the Reclamation's — the Dreadnought
      // is ~4.8k and the two harvesters ~4.6k, so a small edit is not a red
      // test but a doubling is.
      expect(m.stats.triangles, l.key).toBeLessThan(5500);
    });
  }

  it('costs one material per faction and not one per unit', () => {
    // The draw-call argument, restated where the roster is actually built.
    // `UNIT_MASS_LISTS` spans allies + soviets, and `UnitLibrary` keys its
    // atlas on `${faction}.unit`, so 26 hulls must cost 2 materials.
    const factions = new Set(UNIT_MASS_LISTS.map((l) => l.faction));
    expect(factions.size).toBe(2);
    expect(library.materialCount()).toBe(factions.size);
  });
});

/* ========================================================================== */

describe('no soldier in any army has a straight-sided primary mass', () => {
  const infantry = ROSTERS.flatMap(([roster, lists]) =>
    lists.filter((l) => l.cls === 'infantry').map((l) => [roster, l] as const));

  it('covers every army, so this cannot pass by measuring nothing', () => {
    // Four armies' worth. If a roster stops contributing infantry the count
    // collapses and the invariant below quietly measures an empty set.
    expect(infantry.length).toBeGreaterThanOrEqual(11);
    for (const [, lists] of ROSTERS) {
      expect(lists.some((l) => l.cls === 'infantry'), 'every roster fields infantry').toBe(true);
    }
  });

  for (const [roster, l] of infantry) {
    it(`${l.key} (${roster}) has no axis-aligned flank surface`, () => {
      const b = boxiness(l);
      expect(
        b.axisFraction,
        `"${b.worst}" is ${(b.worstFraction * 100).toFixed(1)}% flat vertical wall. ` +
        'Taper it, shear it, lathe it or hull it — see MassList.massFlankSurface: a wall ' +
        'only leaves the axis-aligned bucket when it actually SLOPES, and the legacy ' +
        "`prism` builder cannot taper at all (use `planPrism`). The legacy `box` builder's " +
        '`taper` field DOES slope its walls, so a legacy box is fine once tapered.',
      ).toBe(0);
    });
  }
});

/* ========================================================================== */

describe('the measured boxiness ceiling', () => {
  /**
   * Measured on 2026-08-08 across all three rosters. The worst four units in
   * the game are the Meridian support and naval hulls, whose load-bearing
   * `prism` masses are still untapered:
   *
   *   meridian_collector   0.564 / 0.415
   *   meridian_carryall    0.548 / 0.427
   *   meridian_corvette    0.537 / 0.492
   *   meridian_monitor     0.535 / 0.491
   *
   * The ceilings below sit just above those, so tapering those prisms moves
   * the numbers DOWN and nothing has to change here, while a new hull authored
   * out of untapered boxes fails immediately instead of passing a 0.68 / 0.85
   * gate that nothing in the game can reach.
   */
  const SCORE_CEILING = 0.60;
  const AXIS_CEILING = 0.52;

  it('is tighter than the shipped gate, which no unit in the game can trip', () => {
    // The statement of the problem, as an assertion: if `BOXINESS` is ever
    // retuned down to where the content actually lives, this fails and these
    // local ceilings should be deleted in favour of it.
    expect(SCORE_CEILING).toBeLessThan(BOXINESS.warn);
    expect(AXIS_CEILING).toBeLessThan(BOXINESS.axisWarn);
  });

  for (const [roster, lists] of ROSTERS) {
    it(`holds the ${roster} roster under it`, () => {
      for (const l of lists) {
        const b = boxiness(l);
        expect(b.score, `${l.key}: worst primary is "${b.worst}"`).toBeLessThanOrEqual(SCORE_CEILING);
        expect(b.axisFraction, `${l.key}: worst primary is "${b.worst}"`).toBeLessThanOrEqual(AXIS_CEILING);
      }
    });
  }
});

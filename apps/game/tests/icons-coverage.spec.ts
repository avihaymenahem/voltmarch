/**
 * ============================================================================
 * tests/icons-coverage.spec.ts — NO BUILD SLOT MAY FALL BACK TO ITS TAB
 * ============================================================================
 *
 * `iconForBuildable` is keyword substring matching with a per-tab last resort,
 * and the last resort is the problem: it always returns a REAL icon, so a key
 * no rule matches draws a tank, or a rifleman, or a depot, and nothing anywhere
 * goes red. That is the function working exactly as documented, which is why
 * this rotted quietly and twice.
 *
 * Found by adding the naval line: the Meridian Pact has had a keyword block
 * since it shipped and the RECLAMATION never got one, so `rclScrapper`,
 * `rclCrawler`, `rclHornet`, `rclScow`, `rclHulk` and `rclSlaghurler` all drew
 * a tank and `rclTinker` drew a rifleman — a whole army wearing the fallback.
 *
 * The assertion is deliberately "the fallback was not reached" rather than a
 * key -> icon table. A table would have to be edited every time a unit is added
 * and would therefore be edited to match whatever the code did, which is how a
 * roster assertion becomes a rubber stamp. This one can only be satisfied by
 * writing a rule.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { UNITS, BUILDINGS } from '../src/data/Defs';
import { BuildTab } from '../src/core/types';
import { iconForBuildable } from '../src/ui/icons';

/** The per-tab last resort in `icons.ts`. Reaching one is the failure. */
const FALLBACK: Readonly<Record<number, string>> = {
  [BuildTab.Structures]: 'depot',
  [BuildTab.Defense]: 'turret',
  [BuildTab.Infantry]: 'infantry',
  [BuildTab.Vehicles]: 'tank',
  [BuildTab.Powers]: 'superweapon',
};

/**
 * A key whose fallback icon is also the CORRECT icon cannot be told apart from
 * an unmatched one by this test, so each is listed with the rule that answers
 * it. Anything here must be matched by a real rule; the list exists so the
 * assertion below can be strict without being wrong.
 */
const FALLBACK_IS_ALSO_RIGHT = new Set([
  // Infantry tab, `infantry` glyph, and a rule really does answer them.
  'gi', 'conscript', 'mrdWayfarer', 'rclPicker', 'frogman', 'navalInfantry',
  'mrdTidewalker', 'rclDredger',
  // The four commanders. There is no hero glyph in `IconName`, and inventing
  // one to satisfy a test would be the test writing the design. A commander is
  // a man with a rifle and a hat; `infantry` is the honest answer.
  'fieldMarshal', 'commissar', 'mrdHierarch', 'rclBaron',
  // Vehicles tab, `tank` glyph, and right: a Refractor Tank is a tank.
  'grizzly', 'mrdSolarch', 'rclGrinder', 'prismTank',
]);

describe('every unit gets a real icon rule, not its tab’s last resort', () => {
  it('is checking a real roster', () => {
    expect(UNITS.length).toBeGreaterThan(50);
  });

  for (const u of UNITS) {
    it(`"${u.key}" is matched by a keyword rule`, () => {
      const icon = iconForBuildable(u.key, u.name, u.tab, false);
      if (icon !== FALLBACK[u.tab as number]) return;
      // The icon EQUALS the fallback. Either a rule produced it deliberately,
      // in which case the key is listed above, or nothing matched at all.
      expect(
        FALLBACK_IS_ALSO_RIGHT.has(u.key),
        `"${u.key}" (${u.name}) fell through to the "${icon}" tab fallback. `
        + 'Add a keyword to UNIT_RULES in src/ui/icons.ts, or list it above if '
        + 'the fallback really is the right glyph.',
      ).toBe(true);
    });
  }
});

describe('every structure gets a real icon rule', () => {
  /** Same shape, same reason. `depot` and `turret` are legitimate answers. */
  const STRUCTURE_FALLBACK_OK = new Set([
    // Defence tab, `turret` glyph, which is what a defence should draw.
    'pillbox', 'sentryGun', 'mrdWard', 'rclSpitpost',
    'flameTower', 'mrdGlaive', 'rclBarricade', 'rclPylon',
    // Repair depots. `depot` IS the glyph, so a matching rule and the fallback
    // are indistinguishable from here - see the header.
    'serviceDepot', 'mrdDepot', 'rclDepot',
    // The four civilian structures. Nobody builds them; they appear only as
    // capture targets on the map, never in a build grid, so the sidebar glyph
    // is not a thing a player reads. `depot` is a neutral building.
    'civOilDerrick', 'civHospital', 'civApartments', 'civOreMine',
    // THE THREE COMMAND POSTS, and this one is a deliberate hold rather than a
    // rule. `radar` would say "comms" and collide with the actual Radar Dome
    // one row up; `superweapon` would say "a thing you call down" and collide
    // with the six real superweapons in the same tab. A generic building is
    // less wrong than either, and a fourth glyph is a design decision.
    'commandPost', 'mrdPharos', 'rclSignalRig',
  ]);

  for (const b of BUILDINGS) {
    it(`"${b.key}" is matched by a keyword rule`, () => {
      const icon = iconForBuildable(b.key, b.name, b.tab, true);
      if (icon !== FALLBACK[b.tab as number]) return;
      expect(
        STRUCTURE_FALLBACK_OK.has(b.key),
        `"${b.key}" (${b.name}) fell through to the "${icon}" tab fallback.`,
      ).toBe(true);
    });
  }
});

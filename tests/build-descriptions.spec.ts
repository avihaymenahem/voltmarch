/**
 * ============================================================================
 * tests/build-descriptions.spec.ts — THE PANEL BRIEF IS COMPLETE AND TRUE
 * ============================================================================
 *
 * `src/data/Descriptions.ts` is the long-form text the strip at the foot of the
 * build rail prints. It is keyed by CONTENT KEY and lives beside the def table
 * rather than inside it, so nothing about adding a def forces anyone to add a
 * description — which is exactly the shape of omission that ships.
 *
 * So the gate is here. Every one of these failures is invisible on screen:
 *
 *   - a missing entry renders as the short blurb, silently, and the panel is
 *     back to being a second copy of the hover card;
 *   - an overlong one is cut by `-webkit-line-clamp` with no ellipsis;
 *   - a stale key sits in the map forever, read by nothing;
 *   - a digit is a number retyped out of a table nothing compares it against.
 *
 * The last one deserves its own sentence. `docs/SPEC_DRIFT_AUDIT.md` is a
 * catalogue of second copies that stopped agreeing with their originals, and
 * the wiki quoting the Multigunner IFV's pre-rebalance `22 x4` — on two pages,
 * for three releases — was an example of the same defect in the same product.
 * It has since been corrected in both. Every number a player needs
 * here is already derived and on screen — the cost on the cameo, the build time
 * and power draw in the tooltip, the prerequisite sentence out of `prereqs`.
 * A description is therefore prose ABOUT the numbers and never a copy of them,
 * and §4 makes that mechanical instead of a matter of taste.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { BUILD_DESCRIPTIONS, describeBuildable } from '../src/data/Descriptions';
import { DEF_TABLES } from '../src/data/Defs';
import { ProductionCatalog } from '../src/sim/Production';
import { resolveDefBinding } from '../src/game/Scenarios';
import { BuildTab, Faction } from '../src/core/types';

/**
 * The cap the strip can actually render, and it is MEASURED rather than
 * guessed. `.vm-brief` is 53u tall against a 240u rail: 7u of padding, a 9.5u
 * name line and four 9u text lines. Live at 1440p that is a 432 px text column
 * at 16 px Rajdhani. Probing that exact column with the exact shipped face:
 * ordinary mixed-case prose wraps at about 62 characters, and a string of long
 * words wraps as badly as 49.
 *
 * 190 is four lines at the BAD ratio, not the good one. The distinction is the
 * whole point of the number: at 200 the copy fits only because the sentences
 * happen to break well, which is a property of the words rather than of the
 * box, and the next author would not know that. 190 fits whatever anyone
 * writes. Every entry was then rendered in a real match at 1440p, 1080p and
 * 1366x768 and none of them clipped.
 *
 * Both bounds matter. Over the cap the tail is cut with no ellipsis and nobody
 * sees it happen. Well under it and the entry is not answering the three
 * questions a first-time player has, which is what the file is for.
 */
const MAX_CHARS = 190;
const MIN_CHARS = 80;

const FACTIONS = [Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim] as const;
const TABS = [BuildTab.Structures, BuildTab.Defense, BuildTab.Infantry, BuildTab.Vehicles] as const;

/**
 * The three construction yards. They are real content with real descriptions
 * and they are NOT in any roster — you deploy one, you never build one — so a
 * coverage sweep over `roster()` alone would miss them.
 */
const DEPLOY_ONLY_KEYS = ['conyard', 'mrdConclave', 'rclFoundry'] as const;

async function catalog(): Promise<ProductionCatalog> {
  const cat = new ProductionCatalog(await resolveDefBinding());
  // Guard the guard. An unbound catalog has an empty roster for every
  // (faction, tab), so every assertion below would pass over nothing.
  expect(cat.bound, 'unbound catalog — every check here would pass vacuously').toBe(true);
  return cat;
}

/* ==========================================================================
 * 1. COVERAGE — the mechanism, not a reviewer noticing
 * ========================================================================== */

describe('every buildable a player can see carries a panel description', () => {
  it('leaves no roster entry without one', async () => {
    const cat = await catalog();
    const missing: string[] = [];
    let checked = 0;

    for (const faction of FACTIONS) {
      for (const tab of TABS) {
        for (const entry of cat.roster(faction, tab)) {
          checked++;
          if (describeBuildable(entry.key).trim() === '') {
            missing.push(`${entry.key} (${entry.name})`);
          }
        }
      }
    }

    expect(checked, 'no roster entries were examined').toBeGreaterThan(100);
    expect(
      [...new Set(missing)].sort(),
      'buildables whose panel would fall back to the one-clause blurb',
    ).toEqual([]);
  });

  it('covers the construction yards, which are deployed and never built', () => {
    for (const key of DEPLOY_ONLY_KEYS) {
      expect(DEF_TABLES.buildingByKey.has(key), `${key} is not a real building key`).toBe(true);
      expect(describeBuildable(key).trim(), `${key} has no description`).not.toBe('');
    }
  });

  /**
   * The other direction, and it is the half that rots quietly: a description
   * for a key that no longer exists is dead text nobody will ever see fail.
   */
  it('has no entry for a key the game does not have', async () => {
    const cat = await catalog();
    const orphans = Object.keys(BUILD_DESCRIPTIONS).filter(
      (key) => cat.byKey(key) === null && !DEF_TABLES.buildingByKey.has(key)
        && !DEF_TABLES.unitByKey.has(key),
    );
    expect(orphans, 'descriptions keyed to content that does not exist').toEqual([]);
  });
});

/* ==========================================================================
 * 2. IT FITS THE BOX
 * ========================================================================== */

describe('every description fits the strip it renders in', () => {
  it('stays inside the four rendered lines', () => {
    const overlong = Object.entries(BUILD_DESCRIPTIONS)
      .filter(([, text]) => text.length > MAX_CHARS)
      .map(([key, text]) => `${key} ${text.length} chars`);
    expect(overlong, `clipped past ${MAX_CHARS} chars with no ellipsis to show it`).toEqual([]);
  });

  it('is long enough to be worth the rows it costs', () => {
    const thin = Object.entries(BUILD_DESCRIPTIONS)
      .filter(([, text]) => text.trim().length < MIN_CHARS)
      .map(([key, text]) => `${key} ${text.trim().length} chars`);
    expect(thin, `under ${MIN_CHARS} chars — that is a blurb, not an explanation`).toEqual([]);
  });

  it('is a single paragraph with no markup and no line breaks', () => {
    for (const [key, text] of Object.entries(BUILD_DESCRIPTIONS)) {
      expect(text, `${key} contains a newline`).not.toMatch(/[\r\n]/);
      expect(text, `${key} contains angle brackets`).not.toMatch(/[<>]/);
      expect(text, `${key} has leading or trailing space`).toBe(text.trim());
      expect(text, `${key} has a doubled space`).not.toMatch(/ {2}/);
    }
  });
});

/* ==========================================================================
 * 3. IT SAYS SOMETHING THE PLAYER DID NOT ALREADY HAVE
 * ========================================================================== */

describe('the panel is not a second copy of the card', () => {
  it('never restates the blurb the hover card already shows', async () => {
    const cat = await catalog();
    const dupes: string[] = [];
    for (const entry of cat.entries) {
      const desc = describeBuildable(entry.key).trim().toLowerCase();
      if (desc === '') continue;
      if (desc === entry.blurb.trim().toLowerCase()) dupes.push(entry.key);
    }
    expect(dupes, 'descriptions identical to the blurb — the original bug').toEqual([]);
  });

  it('never merely restates the name', async () => {
    const cat = await catalog();
    for (const entry of cat.entries) {
      const desc = describeBuildable(entry.key).trim().toLowerCase().replace(/[.\s]+$/, '');
      if (desc === '') continue;
      expect(desc, `${entry.key} only repeats its name`).not.toBe(entry.name.trim().toLowerCase());
    }
  });

  /**
   * The description is strictly longer than the blurb for every entry, which is
   * the whole reason the second field exists. A description that came out
   * shorter would mean somebody had pasted the wrong string into the map.
   */
  it('always says more than the blurb it replaced', async () => {
    const cat = await catalog();
    const shorter: string[] = [];
    for (const entry of cat.entries) {
      const desc = describeBuildable(entry.key);
      if (desc === '') continue;
      if (desc.length <= entry.blurb.length) {
        shorter.push(`${entry.key}: ${desc.length} <= blurb ${entry.blurb.length}`);
      }
    }
    expect(shorter, 'panel text no longer than the card text').toEqual([]);
  });
});

/* ==========================================================================
 * 4. NO NUMBERS. NOT ONE.
 * ========================================================================== */

describe('no description retypes a number the tables own', () => {
  /**
   * A bare digit anywhere is the failure. Not a style rule: the cost, the
   * build time, the power draw and the prerequisites are all already derived
   * and on screen beside this text, and every other quantity lives in
   * `Defs.ts`, `config.ts` or `Superweapons.ts`. A figure retyped here is a
   * second copy nothing compares — the exact defect the wiki demonstrates by
   * still quoting the Multigunner IFV's pre-rebalance gun.
   *
   * Comparisons are the supported form and cost nothing: "reaches further than
   * a Grizzly" cannot silently stop being true the way "reaches 26 m" can.
   */
  it('contains no digits at all', () => {
    const offenders = Object.entries(BUILD_DESCRIPTIONS)
      .filter(([, text]) => /\d/.test(text))
      .map(([key, text]) => `${key}: ${text.match(/\S*\d\S*/g)?.join(' ') ?? ''}`);
    expect(offenders, 'numbers retyped out of a table nothing compares them to').toEqual([]);
  });
});

/* ==========================================================================
 * 5. THE LOOKUP ITSELF
 * ========================================================================== */

describe('describeBuildable', () => {
  it('answers with the mapped text', () => {
    expect(describeBuildable('mrdReliquary')).toBe(BUILD_DESCRIPTIONS.mrdReliquary);
  });

  it('answers empty for an unknown key rather than throwing', () => {
    expect(describeBuildable('nothingLikeThis')).toBe('');
  });

  /**
   * `Record<string, string>` indexed by an arbitrary string reaches
   * `Object.prototype`. Without the `??` guard this returns a Function.
   */
  it('does not leak a prototype member', () => {
    expect(describeBuildable('toString')).toBe('');
    expect(describeBuildable('constructor')).toBe('');
  });
});

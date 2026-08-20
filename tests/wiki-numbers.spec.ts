/**
 * ============================================================================
 * tests/wiki-numbers.spec.ts — the player wiki may not quote a number the
 * shipped tables disagree with
 * ============================================================================
 * WHY THIS FILE EXISTS
 * --------------------
 * `wiki/` is about to be readable INSIDE the game. That promotes every sentence
 * in it from documentation to a claim the product makes to a player, which is
 * exactly what `tests/content-truthful.spec.ts` and
 * `tests/credits-truthful.spec.ts` exist to police for the content tables and
 * the credits screen. Nothing was policing the wiki.
 *
 * The motivating history is written down in the header of
 * `src/data/Descriptions.ts` and it is worth restating, because it is the
 * failure mode this file is shaped around:
 *
 *   - The Sabre IFV's gun was re-authored from `chaingun` (22 x4, 116 raw
 *     dps) to `ifvChaingun` (11 x5, 65 raw dps). **The wiki went on quoting the
 *     old figure for three releases** before anyone compared the two.
 *   - When that was finally fixed, six wiki claims were checked against
 *     `DEF_TABLES` and all six lost. TWO of the six then turned out to have the
 *     same wrong number in a SECOND place nobody had looked (`Combat.md`).
 *   - And a THIRD copy of both survived even that sweep, in `Strategy.md`'s
 *     effective-dps table, until this file was written. Three passes of careful
 *     human reading, three misses. A reviewer noticing is not a mechanism.
 *
 * So the rule this file enforces is the one `Descriptions.ts` states for itself:
 * **`DEF_TABLES` WINS, ALWAYS.** A number in `wiki/` is a second copy of
 * something a table already owns, and the only safe second copy is one a test
 * compares.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. Every weapon figure in the four `wiki/Faction-*.md` roster tables —
 *      weapon name, damage x burst, warhead, range, air — plus the cost, build
 *      time, hit points, armour class, speed and power draw in the same row,
 *      against `UNITS` / `BUILDINGS`.
 *   2. `wiki/Combat.md` §2's four weapon tables, exhaustively: damage, warhead,
 *      range, CYCLE and RAW DPS (both re-derived with `sim/Combat.ts#fire`'s own
 *      firing model), splash, needs-power, hits-air — and the "carried by"
 *      column, as a set, against every def that actually fires the row.
 *   3. Both copies of the armour matrix (`Combat.md` §1, `Strategy.md` §5).
 *   4. `Strategy.md`'s effective-dps table — raw dps times the matrix cell, to
 *      the rounding the table itself uses.
 *   5. The DERIVED numbers: duel times and squad times-to-kill, re-computed
 *      from the tables THROUGH `COMBAT_DAMAGE.globalMul`, plus the declared
 *      winner of each duel. These are what a weapon retune silently rots.
 *   6. Ore regrowth: the wiki's spread gate, base rate and node bonus against
 *      `config.ts`.
 *   7. The blackout roster: which armed structures keep firing on a dead grid,
 *      derived from `BUILDINGS[].power` rather than restated.
 *   8. `wiki/Campaign.md`'s three head counts of the mission table — its size,
 *      its profile/match split, and §9's reward-class census — every one of
 *      them re-derived from `MISSIONS[].reward` rather than restated.
 *   9. `wiki/Campaign.md` §1–§3, the STORY campaign: every shipped operation
 *      tabulated in play order with its par and objective counts, how partial
 *      the corpus is against `tests/campaign-length.spec.ts`'s own plan
 *      constants, the bonus payouts, and the medal rule — the last derived by
 *      RUNNING `medalFor` over each difficulty rung rather than by reading it.
 *
 * §8 AND §9 ARE THE SAME PAGE AND FAIL FOR OPPOSITE REASONS. The mission table
 * is finished, so it rots when a row is RETUNED. The campaign is partial, so it
 * rots when an operation is ADDED — and nothing about authoring one would
 * otherwise bring anybody to this file. §9's counts are equalities, and its
 * "the Pact chapter is unwritten" check is an assertion about absence, for
 * exactly that reason.
 *
 * THE PARSER FAILS LOUDLY, WHICH IS HALF THE POINT
 * ------------------------------------------------
 * A parser that quietly matches nothing is a green test that checks nothing.
 * Every section below therefore asserts a MINIMUM ROW COUNT before it asserts
 * anything about the rows, an unrecognised weapon name / warhead label / armour
 * label / unit name is a FAILURE rather than a skip, and every table this file
 * claims to read is located by an anchor that must exist.
 *
 * THE RULE FOR EDITING THIS FILE
 * ------------------------------
 * `UNTABLED_WEAPONS` and `UNCHECKED_CLAIMS` are declared-exception tables in the
 * house style of `OVER_BAND` in `tests/emplacement-band.spec.ts` and
 * `UNFIRED_ROWS` in `tests/content-truthful.spec.ts`, and both **fail in BOTH
 * directions**: adding a legitimate exception is a legitimate way to make this
 * file pass, but an exception that stops being true fails just as loudly as a
 * new violation, so nobody can fix half a pair and walk away. Deleting an
 * assertion is not a legitimate fix.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BUILDINGS, UNITS, WEAPONS } from '../src/data/Defs';
import { MISSIONS } from '../src/data/Missions';
import { ARMOR_MATRIX, COMBAT_DAMAGE } from '../src/core/config';
import {
  GUARD_LEASH, ORE_REGROW_NODE_BONUS, ORE_REGROW_RATE, ORE_REGROW_SPREAD,
  STANCE_CHASE_METRES, STANCE_RETURNS,
} from '../src/core/config';
import { CAMPAIGNS } from '../src/campaign/index';
import { medalFor, newOperationState } from '../src/campaign/Director';
import { totalParSeconds } from '../src/campaign/validate';
import { DIFFICULTIES, defaultSetup } from '../src/shell/settings-store';
import type { ChapterDef, ObjectiveDef, OperationDef } from '../src/campaign/types';
import type { BuildingDef, UnitDef, WeaponDef } from '../src/core/types';
import type { Reward } from '../src/progression/types';

const wiki = (page: string): string => readFileSync(
  join(__dirname, '..', 'wiki', `${page}.md`), 'utf8',
);

/* ==========================================================================
 * THE FIRING MODEL, COPIED FROM THE ONE PLACE THAT OWNS IT
 *
 * `sim/Combat.ts#fire` pays `burstDelay` between the rounds of a burst and then
 * the full `cooldown`, and `burstDelay` is deliberately excluded from the
 * veterancy cooldown scaling — so it is a constant of the row and belongs in
 * the cycle exactly as written. `tests/emplacement-band.spec.ts` states the
 * same model in its own header; both must move together if that ever changes.
 * ========================================================================== */

const cycleOf = (w: WeaponDef): number => (
  w.burstCount > 1 ? (w.burstCount - 1) * w.burstDelay + w.cooldown : w.cooldown
);
const rawDpsOf = (w: WeaponDef): number => (w.damage * w.burstCount) / cycleOf(w);
/** Raw dps through the armour matrix. Still BEFORE the global pace scalar. */
const effDpsOf = (w: WeaponDef, armor: number): number => rawDpsOf(w) * ARMOR_MATRIX[w.warhead][armor];
/**
 * Seconds for one `attacker` to kill one `victim`, THROUGH the pace scalar.
 *
 * `COMBAT_DAMAGE.globalMul` is applied in `Damage.applyOne`, the only function
 * in the game that writes `hp`, so it belongs in every TIME and in no DPS.
 * That distinction is the one this file exists to keep straight: a weapon's dps
 * is a fact about the row, a time-to-kill is a fact about the match.
 */
const ttk = (attacker: UnitDef, victim: UnitDef, attackers = 1): number => {
  const w = WEAPONS[attacker.weapons[0]];
  return victim.maxHp / (effDpsOf(w, victim.armor) * COMBAT_DAMAGE.globalMul * attackers);
};

/* ==========================================================================
 * LOOKUPS. Every one of them throws rather than returning undefined — an
 * unresolvable name in the wiki is a finding, not a row to skip.
 * ========================================================================== */

const ALL_DEFS: readonly (UnitDef | BuildingDef)[] = [...UNITS, ...BUILDINGS];

const DEF_BY_NAME: ReadonlyMap<string, UnitDef | BuildingDef> = (() => {
  const m = new Map<string, UnitDef | BuildingDef>();
  for (const d of ALL_DEFS) {
    // Two defs sharing a display name would make every lookup below ambiguous.
    expect(m.has(d.name), `two defs are both called "${d.name}"`).toBe(false);
    m.set(d.name, d);
  }
  return m;
})();

const WEAPON_BY_NAME: ReadonlyMap<string, WeaponDef> = (() => {
  const m = new Map<string, WeaponDef>();
  for (const w of WEAPONS) {
    expect(m.has(w.name), `two weapon rows are both called "${w.name}"`).toBe(false);
    m.set(w.name, w);
  }
  return m;
})();

/** Def display names that fire a given weapon index, as a set. */
const CARRIERS_BY_WEAPON: ReadonlyMap<number, ReadonlySet<string>> = (() => {
  const m = new Map<number, Set<string>>();
  for (const d of ALL_DEFS) {
    for (const wi of d.weapons) {
      const s = m.get(wi) ?? new Set<string>();
      s.add(d.name);
      m.set(wi, s);
    }
  }
  return m;
})();

/* -- label vocabularies ---------------------------------------------------
 * `WarheadClass` and `ArmorClass` are `const enum`s, so their reverse maps are
 * illegal under `isolatedModules` (see CLAUDE.md — five TS2476 errors shipped
 * through exactly that hole). These are plain literals instead, and the wiki
 * uses two spellings of each: full words in `Combat.md`'s dedicated column,
 * abbreviations in the faction tables' one-cell weapon summaries.
 * ----------------------------------------------------------------------- */

const WARHEAD_LABELS: Readonly<Record<string, number>> = {
  'small arms': 0, 'smallarms': 0,
  'autocannon': 1,
  'armour-piercing': 2, 'ap': 2,
  'high explosive': 3, 'he': 3,
  'rocket': 4,
  'tesla': 5,
  'prism': 6,
};

const ARMOR_LABELS: Readonly<Record<string, number>> = {
  'infantry': 0, 'inf': 0,
  'light': 1,
  'medium': 2, 'med': 2,
  'heavy': 3,
  'concrete': 4,
  'wood': 5,
};

/**
 * THE THREE TANKS THE WIKI CALLS BY THEIR SHORT NAME.
 *
 * `Combat.md`'s "carried by" column and `Strategy.md`'s effective-dps table both
 * write "Warden" where the cameo says "Warden Tank", which is the right call
 * for a page written for players. Declared rather than fuzzy-matched, because a
 * prefix match would also silently accept a genuinely wrong unit — and the
 * declaration is checked in BOTH directions: an alias that names no def, or that
 * the pages stop using, fails.
 */
const SHORT_UNIT_NAMES: Readonly<Record<string, string>> = {
  Warden: 'Warden Tank',
  Anvil: 'Anvil Tank',
  Sledge: 'Sledge Tank',
};

/** A wiki cell naming a unit -> the def, short names resolved. */
const defByWikiName = (name: string): UnitDef | BuildingDef | undefined => DEF_BY_NAME.get(
  SHORT_UNIT_NAMES[name] ?? name,
);

/** Row order of `ARMOR_MATRIX`, for the two prose copies of it. */
const MATRIX_ROW_LABELS: readonly string[] = [
  'small arms', 'autocannon', 'armour-piercing', 'high explosive', 'rocket', 'tesla', 'prism',
];

/* ==========================================================================
 * A MINIMAL MARKDOWN TABLE READER
 *
 * Deliberately dumb: a table is a pipe row, a `| --- |` separator, then pipe
 * rows until something that is not one. Anything it cannot read is reported by
 * the caller, never swallowed.
 * ========================================================================== */

interface MdRow { readonly cells: readonly string[]; readonly line: number }
interface MdTable { readonly headers: readonly string[]; readonly rows: readonly MdRow[] }

const splitRow = (line: string): string[] => line
  .replace(/^\s*\|/, '').replace(/\|\s*$/, '')
  .split('|')
  .map((c) => c.trim());

/** Strip markdown emphasis, code ticks and a trailing `(locked)` / `(air)`. */
const clean = (cell: string): string => cell
  .replace(/[*`]/g, '')
  .replace(/\s*\((?:locked|air)\)\s*/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function parseTables(text: string): MdTable[] {
  const lines = text.split(/\r?\n/);
  const out: MdTable[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trimStart().startsWith('|')) continue;
    if (!/^\s*\|[\s:|-]*-[\s:|-]*\|/.test(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map(clean);
    const rows: MdRow[] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trimStart().startsWith('|'); j++) {
      rows.push({ cells: splitRow(lines[j]).map(clean), line: j + 1 });
    }
    out.push({ headers, rows });
    i = j - 1;
  }
  return out;
}

/** Column index by header name. Throws through `expect` if the column moved. */
function col(t: MdTable, header: string, where: string): number {
  const i = t.headers.findIndex((h) => h.toLowerCase() === header.toLowerCase());
  expect(i, `${where}: no "${header}" column in | ${t.headers.join(' | ')} |`).toBeGreaterThanOrEqual(0);
  return i;
}

const num = (cell: string, where: string): number => {
  const v = Number(cell.replace(/,/g, '').replace(/[+\s]/g, '').replace(/m$|s$/, ''));
  expect(Number.isFinite(v), `${where}: "${cell}" is not a number`).toBe(true);
  return v;
};

const yesNo = (cell: string, where: string): boolean => {
  const c = cell.toLowerCase();
  expect(['yes', 'no'], `${where}: "${cell}" is neither yes nor no`).toContain(c);
  return c === 'yes';
};

const warheadOf = (cell: string, where: string): number => {
  const k = cell.toLowerCase().trim();
  const v = WARHEAD_LABELS[k];
  expect(v, `${where}: "${cell}" is not a warhead this file knows. Add it to WARHEAD_LABELS `
    + `or fix the wiki — an unrecognised label must never be skipped.`).toBeTypeOf('number');
  return v;
};

const armorOf = (cell: string, where: string): number => {
  const k = cell.toLowerCase().trim();
  const v = ARMOR_LABELS[k];
  expect(v, `${where}: "${cell}" is not an armour class this file knows`).toBeTypeOf('number');
  return v;
};

/**
 * `18 x3` -> { damage: 18, burst: 3 }; `60` -> { damage: 60, burst: 1 }.
 * Anything else is a failure: this is the exact shape the IFV defect hid in.
 */
function damageFigure(cell: string, where: string): { damage: number; burst: number } {
  const m = /^(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+))?$/.exec(cell.trim());
  expect(m, `${where}: "${cell}" is not a damage figure ("18 x3" or "60")`).not.toBeNull();
  return { damage: Number(m![1]), burst: m![2] === undefined ? 1 : Number(m![2]) };
}

/* ==========================================================================
 * 1. THE FACTION ROSTER TABLES
 *
 * Every table in a `wiki/Faction-*.md` that carries a `Weapon` column is a
 * roster: one row per def, with the numbers a player buys on. This is where
 * "Emplaced MG, 20 x5" outlived its own weapon row in three places at once.
 * ========================================================================== */

const FACTION_PAGES = [
  'Faction-Allies', 'Faction-Soviets', 'Faction-Meridian-Pact', 'Faction-Reclamation',
] as const;

/** A roster row with no gun says so in words; the def must agree. */
const UNARMED_CELLS = new Set(['unarmed', '—', '-', '–']);

describe('the faction roster tables agree with UNITS and BUILDINGS', () => {
  for (const page of FACTION_PAGES) {
    it(`${page}.md`, () => {
      const tables = parseTables(wiki(page)).filter((t) => t.headers.includes('Weapon'));
      expect(tables.length, `${page}.md: no roster table found — the parser matched nothing, `
        + 'which is a broken parser, not a clean page').toBeGreaterThanOrEqual(2);

      let checked = 0;
      for (const t of tables) {
        const iName = 0;
        const iWeapon = col(t, 'Weapon', page);
        const iRange = col(t, 'Range', page);
        const iAir = col(t, 'Air', page);
        const iCost = col(t, 'Cost', page);
        const iTime = col(t, 'Time', page);
        const iHp = col(t, 'HP', page);
        const iArmour = t.headers.indexOf('Armour');
        const iSpeed = t.headers.indexOf('Speed');
        const iPower = t.headers.indexOf('Power');

        for (const row of t.rows) {
          const name = row.cells[iName];
          const where = `${page}.md:${row.line} "${name}"`;
          const def = defByWikiName(name);
          expect(def, `${where}: no shipped def is called that. Either the wiki renamed a unit `
            + 'or the def moved — this row cannot be skipped.').toBeDefined();
          const d = def!;

          expect(num(row.cells[iCost], `${where} cost`), `${where}: cost`).toBe(d.cost);
          expect(num(row.cells[iTime], `${where} time`), `${where}: build time`).toBe(d.buildTime);
          expect(num(row.cells[iHp], `${where} hp`), `${where}: max HP`).toBe(d.maxHp);
          if (iArmour >= 0 && row.cells[iArmour] !== '—') {
            expect(armorOf(row.cells[iArmour], `${where} armour`), `${where}: armour class`)
              .toBe((d as UnitDef).armor);
          }
          if (iSpeed >= 0 && row.cells[iSpeed] !== '—') {
            expect(num(row.cells[iSpeed], `${where} speed`), `${where}: max speed`)
              .toBeCloseTo((d as UnitDef).maxSpeed, 5);
          }
          if (iPower >= 0) {
            expect(num(row.cells[iPower], `${where} power`), `${where}: power`)
              .toBe((d as BuildingDef).power);
          }

          checked++;
          const cell = row.cells[iWeapon];
          if (UNARMED_CELLS.has(cell.toLowerCase())) {
            expect(d.weapons.length, `${where}: the wiki says unarmed, the def carries a weapon`).toBe(0);
            continue;
          }
          expect(d.weapons.length, `${where}: the wiki names a weapon, the def is unarmed`)
            .toBeGreaterThan(0);

          const parts = cell.split(',').map((s) => s.trim());
          expect(parts.length, `${where}: "${cell}" is not "Name, damage, warhead[, extras]"`)
            .toBeGreaterThanOrEqual(3);

          const w = WEAPONS[d.weapons[0]];
          expect(parts[0], `${where}: the wiki names the wrong weapon`).toBe(w.name);

          const fig = damageFigure(parts[1], `${where} damage`);
          expect(fig.damage, `${where}: ${w.key} damage`).toBe(w.damage);
          expect(fig.burst, `${where}: ${w.key} burst count`).toBe(w.burstCount);
          expect(warheadOf(parts[2], `${where} warhead`), `${where}: ${w.key} warhead`).toBe(w.warhead);

          // Extras are optional in this table (only some rows state splash), but
          // a STATED figure must be right. `Combat.md` has a dedicated Splash
          // column and §7 a dedicated chain table, and both are checked
          // exhaustively below — so nothing is only ever checked here.
          for (const extra of parts.slice(3)) {
            const splash = /^(\d+(?:\.\d+)?)\s*m splash$/.exec(extra);
            if (splash !== null) {
              expect(Number(splash[1]), `${where}: ${w.key} splash radius`).toBeCloseTo(w.splashRadius, 5);
              continue;
            }
            const chain = /^chains to (\d+)$/.exec(extra);
            if (chain !== null) {
              expect(Number(chain[1]), `${where}: ${w.key} chain count`).toBe(w.chainCount);
              continue;
            }
            expect.fail(`${where}: "${extra}" is not a weapon extra this file knows `
              + '("N m splash" or "chains to N"). Teach the parser or fix the wiki.');
          }

          expect(num(row.cells[iRange], `${where} range`), `${where}: ${w.key} range`)
            .toBeCloseTo(w.range, 5);
          expect(yesNo(row.cells[iAir], `${where} air`), `${where}: ${w.key} can target air`)
            .toBe(w.canTargetAir);
        }
      }
      expect(checked, `${page}.md: parsed ${checked} roster rows, which is fewer than any of the four `
        + 'pages has ever had. The parser stopped seeing a table.').toBeGreaterThanOrEqual(18);
    });
  }
});

/* ==========================================================================
 * 2. `wiki/Combat.md` §2 — THE ARMOURY, EXHAUSTIVELY
 *
 * Four tables, one shape: the weapon's own row plus the two DERIVED columns a
 * balance pass rots without touching the wiki (cycle and raw dps).
 * ========================================================================== */

/**
 * Weapon rows `Combat.md` §2 deliberately does not tabulate, with the reason.
 * BOTH DIRECTIONS: an entry here must still be fired by nothing, and a row not
 * listed here must appear in a table. Fixing one half fails.
 */
const UNTABLED_WEAPONS: Readonly<Record<string, string>> = {
  chaingun:
    'The pre-content fallback row for the IFV and the Sickle. `REBALANCE_WEAPONS` '
    + 're-authored the shipped gun as `ifvChaingun`; no def fires this one, and the '
    + 'wiki tabulating it would put the exact 22 x4 figure back on the page.',
  artillery:
    'The V4 Launcher. Authored, fired by nothing in the current roster, and named '
    + 'in prose directly under the emplacements table so a reader is not misled.',
};

describe('Combat.md §2 quotes the armoury', () => {
  const text = wiki('Combat');

  it('every tabulated row matches WEAPONS, including the derived cycle and dps', () => {
    const tables = parseTables(text).filter(
      (t) => t.headers[0] === 'Weapon' && t.headers.includes('Damage') && t.headers.includes('Raw DPS'),
    );
    expect(tables.length, 'Combat.md: the §2 weapon tables were not found').toBe(4);

    let checked = 0;
    for (const t of tables) {
      const iDamage = col(t, 'Damage', 'Combat.md');
      const iWarhead = col(t, 'Warhead', 'Combat.md');
      const iRange = col(t, 'Range', 'Combat.md');
      const iCycle = col(t, 'Cycle', 'Combat.md');
      const iDps = col(t, 'Raw DPS', 'Combat.md');
      const iSplash = t.headers.indexOf('Splash');
      const iPower = t.headers.indexOf('Needs power');
      const iAir = col(t, 'Hits air', 'Combat.md');
      expect(iSplash >= 0 || iPower >= 0,
        'Combat.md: a §2 table has neither a Splash nor a Needs power column').toBe(true);

      for (const row of t.rows) {
        // `Tesla Coil (bolt)` disambiguates the hull-mounted copy from the tower.
        const wName = row.cells[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
        const where = `Combat.md:${row.line} "${wName}"`;
        const w = WEAPON_BY_NAME.get(wName);
        expect(w, `${where}: no weapon row is called that`).toBeDefined();
        const wd = w!;

        const fig = damageFigure(row.cells[iDamage], `${where} damage`);
        expect(fig.damage, `${where}: damage`).toBe(wd.damage);
        expect(fig.burst, `${where}: burst count`).toBe(wd.burstCount);
        expect(warheadOf(row.cells[iWarhead], `${where} warhead`), `${where}: warhead`).toBe(wd.warhead);

        // `42 (min 11)` — the minimum-range weapons carry it in the same cell.
        const rangeCell = row.cells[iRange];
        const minM = /\(min\s*(\d+(?:\.\d+)?)\)/.exec(rangeCell);
        expect(Number(minM?.[1] ?? 0), `${where}: minimum range`).toBeCloseTo(wd.minRange, 5);
        expect(num(rangeCell.replace(/\(.*\)/, ''), `${where} range`), `${where}: range`)
          .toBeCloseTo(wd.range, 5);

        expect(row.cells[iCycle], `${where}: cycle — (burst-1) x burstDelay + cooldown`)
          .toBe(`${cycleOf(wd).toFixed(2)} s`);
        expect(num(row.cells[iDps], `${where} dps`), `${where}: raw dps — damage x rounds / cycle`)
          .toBe(Math.round(rawDpsOf(wd)));

        if (iSplash >= 0) {
          const cell = row.cells[iSplash];
          if (wd.splashRadius === 0) {
            expect(cell, `${where}: no splash, so the cell must be an en dash`).toBe('–');
          } else {
            expect(num(cell, `${where} splash`), `${where}: splash radius`)
              .toBeCloseTo(wd.splashRadius, 5);
          }
        }
        if (iPower >= 0) {
          expect(yesNo(row.cells[iPower], `${where} power`), `${where}: WeaponDef.needsPower`)
            .toBe(wd.needsPower);
        }
        expect(yesNo(row.cells[iAir], `${where} air`), `${where}: canTargetAir`).toBe(wd.canTargetAir);
        checked++;
      }
    }
    expect(checked, 'Combat.md: parsed no weapon rows').toBeGreaterThanOrEqual(40);
  });

  it('tabulates every weapon a def actually fires, and the "carried by" column is the real set', () => {
    const tables = parseTables(text).filter(
      (t) => t.headers[0] === 'Weapon' && t.headers.includes('Raw DPS'),
    );
    /** weapon display name -> union of the carrier names the wiki lists. */
    const listed = new Map<string, Set<string>>();
    for (const t of tables) {
      for (const row of t.rows) {
        const wName = row.cells[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
        const s = listed.get(wName) ?? new Set<string>();
        for (const c of row.cells[1].split(',')) {
          const nm = clean(c);
          s.add(SHORT_UNIT_NAMES[nm] ?? nm);
        }
        listed.set(wName, s);
      }
    }

    for (let i = 0; i < WEAPONS.length; i++) {
      const w = WEAPONS[i];
      const carriers = CARRIERS_BY_WEAPON.get(i);
      const excuse = UNTABLED_WEAPONS[w.key];

      if (carriers === undefined) {
        // Nothing fires it. It must be a DECLARED exception, and it must not be
        // in a table — that is the second direction of the pair.
        expect(excuse, `no def fires "${w.key}" and Combat.md does not have to tabulate it, `
          + 'but the exemption must be declared in UNTABLED_WEAPONS with a reason').toBeTypeOf('string');
        expect(listed.has(w.name), `"${w.key}" is declared UNTABLED but Combat.md tabulates it — `
          + 'delete the exception or delete the row').toBe(false);
        continue;
      }

      expect(excuse, `"${w.key}" is declared UNTABLED but ${[...carriers].join(', ')} fires it. `
        + 'The exception outlived its cause: remove it and tabulate the row.').toBeUndefined();
      const shown = listed.get(w.name);
      expect(shown, `Combat.md §2 has no row for "${w.name}" (${w.key}), fired by `
        + `${[...carriers].join(', ')}`).toBeDefined();
      expect([...shown!].sort(), `Combat.md: the "carried by" cells for "${w.name}" name `
        + `${[...shown!].sort().join(', ')}; the defs that fire it are `
        + `${[...carriers].sort().join(', ')}`).toEqual([...carriers].sort());
    }

  });

  it('SHORT_UNIT_NAMES covers exactly the short names the two tables use', () => {
    // The other direction. Collect every unit name the two machine-read tables
    // print that is NOT a def name; that set must be exactly the declared
    // aliases. A new short name fails here rather than being quietly resolved,
    // and an alias the pages stopped using fails too.
    const unresolved = new Set<string>();
    for (const t of parseTables(text).filter((x) => x.headers[0] === 'Weapon' && x.headers.includes('Raw DPS'))) {
      for (const row of t.rows) {
        for (const c of row.cells[1].split(',')) {
          const nm = clean(c);
          if (!DEF_BY_NAME.has(nm)) unresolved.add(nm);
        }
      }
    }
    const dps = parseTables(wiki('Strategy')).find((x) => x.headers.includes('vs Infantry'));
    expect(dps, 'Strategy.md: the effective-dps table was not found').toBeDefined();
    for (const row of dps!.rows) if (!DEF_BY_NAME.has(row.cells[0])) unresolved.add(row.cells[0]);

    expect([...unresolved].sort(), 'every name in Combat.md\'s "carried by" column and in '
      + "Strategy.md's effective-dps table must be either a def name or a DECLARED short name")
      .toEqual(Object.keys(SHORT_UNIT_NAMES).sort());
    for (const [short, full] of Object.entries(SHORT_UNIT_NAMES)) {
      expect(DEF_BY_NAME.has(full), `SHORT_UNIT_NAMES maps "${short}" to "${full}", which is not a `
        + 'shipped def').toBe(true);
    }
  });

  it('§7 lists every chaining weapon and the right number of links', () => {
    const t = parseTables(text).find((x) => x.headers.includes('Extra links'));
    expect(t, 'Combat.md: the chain-lightning table was not found').toBeDefined();

    const seen = new Set<string>();
    for (const row of t!.rows) {
      const links = num(row.cells[1], `Combat.md:${row.line} links`);
      for (const raw of row.cells[0].split(',')) {
        const nm = clean(raw);
        const w = WEAPON_BY_NAME.get(nm);
        expect(w, `Combat.md:${row.line}: "${nm}" is not a weapon`).toBeDefined();
        expect(links, `Combat.md:${row.line}: ${w!.key} chainCount`).toBe(w!.chainCount);
        seen.add(w!.key);
      }
    }
    const chainers = WEAPONS.filter((w) => w.chainCount > 0).map((w) => w.key).sort();
    expect([...seen].sort(), 'Combat.md §7 must list every chaining weapon and nothing else')
      .toEqual(chainers);
  });
});

/* ==========================================================================
 * 3. BOTH COPIES OF THE ARMOUR MATRIX
 *
 * It is printed twice — `Combat.md` §1 and `Strategy.md` §5 — which is exactly
 * the "second place nobody looked" shape.
 * ========================================================================== */

describe('the armour matrix is quoted correctly wherever it appears', () => {
  for (const page of ['Combat', 'Strategy'] as const) {
    it(`${page}.md`, () => {
      const t = parseTables(wiki(page)).find(
        (x) => x.headers.includes('Infantry') && x.headers.includes('Concrete') && x.headers.includes('Wood'),
      );
      expect(t, `${page}.md: the armour matrix table was not found`).toBeDefined();
      expect(t!.rows.length, `${page}.md: the matrix must have one row per warhead`)
        .toBe(ARMOR_MATRIX.length);

      const cols = ['Infantry', 'Light', 'Medium', 'Heavy', 'Concrete', 'Wood']
        .map((h) => col(t!, h, page));

      t!.rows.forEach((row, r) => {
        const label = row.cells[0].toLowerCase().replace(/^warhead\s*/, '');
        expect(label, `${page}.md:${row.line}: the matrix rows are out of order`)
          .toBe(MATRIX_ROW_LABELS[r]);
        cols.forEach((c, a) => {
          expect(num(row.cells[c], `${page}.md:${row.line}`), `${page}.md:${row.line}: `
            + `ARMOR_MATRIX[${MATRIX_ROW_LABELS[r]}][${a}]`).toBeCloseTo(ARMOR_MATRIX[r][a], 5);
        });
      });
    });
  }
});

/* ==========================================================================
 * 4. `Strategy.md`'s EFFECTIVE-DPS TABLE
 *
 * The third copy of the IFV and Sandskiff figures lived here, and survived two
 * sweeps that fixed the other two copies.
 * ========================================================================== */

describe('Strategy.md effective damage per second', () => {
  it('is raw dps times the matrix cell for every listed unit', () => {
    const t = parseTables(wiki('Strategy')).find(
      (x) => x.headers.includes('vs Infantry') && x.headers.includes('vs Concrete'),
    );
    expect(t, 'Strategy.md: the effective-dps table was not found').toBeDefined();
    const wrong: string[] = [];
    expect(t!.rows.length, 'Strategy.md: the effective-dps table is suspiciously short')
      .toBeGreaterThanOrEqual(20);

    const iCost = col(t!, 'Cost', 'Strategy.md');
    const iHp = col(t!, 'HP / armour', 'Strategy.md');
    const iRange = col(t!, 'Range', 'Strategy.md');
    const vs = ['vs Infantry', 'vs Light', 'vs Medium', 'vs Heavy', 'vs Concrete']
      .map((h) => col(t!, h, 'Strategy.md'));

    for (const row of t!.rows) {
      const name = row.cells[0];
      const where = `Strategy.md:${row.line} "${name}"`;
      const def = defByWikiName(name) as UnitDef | undefined;
      expect(def, `${where}: no shipped unit is called that`).toBeDefined();
      const w = WEAPONS[def!.weapons[0]];
      expect(w, `${where}: the table lists an unarmed unit`).toBeDefined();

      expect(num(row.cells[iCost], `${where} cost`), `${where}: cost`).toBe(def!.cost);
      const hp = /^(\d[\d,]*)\s+(\S+)$/.exec(row.cells[iHp]);
      expect(hp, `${where}: "${row.cells[iHp]}" is not "HP armour"`).not.toBeNull();
      expect(num(hp![1], `${where} hp`), `${where}: max HP`).toBe(def!.maxHp);
      expect(armorOf(hp![2], `${where} armour`), `${where}: armour class`).toBe(def!.armor);
      expect(num(row.cells[iRange], `${where} range`), `${where}: range`).toBeCloseTo(w.range, 5);

      vs.forEach((c, armor) => {
        const want = Math.round(effDpsOf(w, armor));
        const got = num(row.cells[c], where);
        if (got === want) return;
        wrong.push(`${where} "${t!.headers[c]}": the page says ${got}, the tables say ${want} `
          + `(${w.key} raw ${rawDpsOf(w).toFixed(3)} x ${ARMOR_MATRIX[w.warhead][armor]})`);
      });
    }
    expect(wrong, `Strategy.md: ${wrong.length} effective-dps cells disagree with `
      + `WEAPONS x ARMOR_MATRIX:\n  ${wrong.join('\n  ')}`).toEqual([]);
  });
});

/* ==========================================================================
 * 5. THE DERIVED CLAIMS — TIMES, NOT DPS
 *
 * `COMBAT_DAMAGE.globalMul` moves every TIME in the wiki by 1/0.80 and no DPS
 * at all. That is the distinction this section pins, because it is the one a
 * careful reader gets wrong: the tables above stayed correct when the pace knob
 * landed and every sentence below did not.
 * ========================================================================== */

/** One second, to the precision the wiki quotes duels in. */
const secs = (s: number): string => `${s.toFixed(1)} s`;

interface Duel {
  /** Text that identifies the row in Strategy.md's duel table. */
  readonly row: string;
  readonly a: string;
  readonly b: string;
  /** The word the wiki bolds as the winner. Must name the faster killer. */
  readonly winner: string;
}

const DUELS: readonly Duel[] = [
  { row: 'Warden vs Anvil', a: 'Warden Tank', b: 'Anvil Tank', winner: 'Anvil' },
  { row: 'IFV vs Warden', a: 'Sabre IFV', b: 'Warden Tank', winner: 'Warden' },
  { row: 'IFV vs Anvil', a: 'Sabre IFV', b: 'Anvil Tank', winner: 'Anvil' },
  { row: 'IFV vs Solarch', a: 'Sabre IFV', b: 'Solarch', winner: 'IFV' },
];

describe('the derived time-to-kill claims survive the pace scalar', () => {
  const strategy = wiki('Strategy');
  /** The duel table's rows, keyed by their first cell. */
  const duelRows: ReadonlyMap<string, string> = (() => {
    const t = parseTables(strategy).find((x) => x.headers.includes('Matchup'));
    expect(t, 'Strategy.md: the duel table was not found').toBeDefined();
    return new Map(t!.rows.map((r) => [r.cells[0], r.cells[1]]));
  })();

  it('quotes both times of every duel, and names the right winner', () => {
    expect(duelRows.size, 'Strategy.md: parsed no duel rows').toBeGreaterThanOrEqual(6);

    for (const d of DUELS) {
      const cell = duelRows.get(d.row);
      expect(cell, `Strategy.md: no duel row called "${d.row}"`).toBeDefined();

      const A = DEF_BY_NAME.get(d.a) as UnitDef;
      const B = DEF_BY_NAME.get(d.b) as UnitDef;
      const aKillsB = ttk(A, B);
      const bKillsA = ttk(B, A);

      const faster = aKillsB < bKillsA ? A : B;
      expect(faster.name, `Strategy.md "${d.row}": the wiki bolds "${d.winner}", but `
        + `${A.name} needs ${secs(aKillsB)} and ${B.name} needs ${secs(bKillsA)}, so `
        + `${faster.name} wins. The declared winner and the tables disagree.`)
        .toContain(d.winner);
      expect(cell, `Strategy.md "${d.row}": must bold the winner`).toContain(`${d.winner} wins`);
      for (const t of [secs(aKillsB), secs(bKillsA)]) {
        expect(cell, `Strategy.md "${d.row}": should quote ${t} — ${A.name} kills ${B.name} in `
          + `${secs(aKillsB)}, ${B.name} kills ${A.name} in ${secs(bKillsA)}`).toContain(t);
      }
    }
  });

  it('quotes the four-Javelin answer to an Anvil', () => {
    const jav = DEF_BY_NAME.get('Javelin') as UnitDef;
    const rhino = DEF_BY_NAME.get('Anvil Tank') as UnitDef;
    const cell = duelRows.get('Javelins vs Anvils');
    expect(cell, 'Strategy.md: no "Javelins vs Anvils" duel row').toBeDefined();
    expect(cell, 'Strategy.md: four Javelins against one Anvil')
      .toContain(secs(ttk(jav, rhino, 4)));
  });

  it('quotes how long a rifle takes against the two heavy tanks', () => {
    const gi = DEF_BY_NAME.get('G.I.') as UnitDef;
    const rhino = DEF_BY_NAME.get('Anvil Tank') as UnitDef;
    const apoc = DEF_BY_NAME.get('Sledge Tank') as UnitDef;
    // Whole seconds: the sentence is prose, not a table.
    expect(strategy, 'Strategy.md §5: the small-arms-against-heavy sentence')
      .toContain(`${Math.round(ttk(gi, rhino))} seconds`);
    expect(strategy, 'Strategy.md §5: the small-arms-against-heavy sentence')
      .toContain(`${Math.round(ttk(gi, apoc))} to kill a Sledge`);
  });

  it('states the pace scalar itself, since every time above depends on it', () => {
    const combat = wiki('Combat');
    const mul = COMBAT_DAMAGE.globalMul.toFixed(2);
    expect(combat, `Combat.md must print the global damage scalar (${mul}) in the damage `
      + 'formula — every time-to-kill on every page is derived through it')
      .toContain(`x ${mul}`);
    expect(combat, 'Combat.md §10 must carry the scalar in "numbers to keep in your head"')
      .toContain(`| Global damage scalar | x${mul}`);
  });
});

/* ==========================================================================
 * 6. ORE REGROWTH
 *
 * `ORE_REGROW_SPREAD` went 0.3 -> 0.025 and two pages quoted the old gate as
 * "30% full". The gate is the SHAPE of recovery and the rate is how much there
 * is; both are quoted, so both are pinned.
 * ========================================================================== */

describe('the ore regrowth numbers match config.ts', () => {
  it('the upstream gate, the base rate and the node bonus', () => {
    const gate = (ORE_REGROW_SPREAD * 100).toFixed(1);
    for (const page of ['Economy', 'Maps'] as const) {
      // The two pages punctuate percentages differently ("2.5%" / "2.5 %"), so
      // the space is squeezed out before the compare rather than encoded here.
      const text = wiki(page).replace(/(\d)\s+%/g, '$1%');
      expect(text, `${page}.md: the upstream-neighbour gate is ORE_REGROW_SPREAD `
        + `(${ORE_REGROW_SPREAD}) — ${gate}% of the cell's own capacity, not the 30% it was `
        + 'before the stall was found').toContain(`${gate}%`);
      expect(text, `${page}.md: the base regrowth rate is ORE_REGROW_RATE`)
        .toContain(`${ORE_REGROW_RATE} ore`);
    }
    expect(ORE_REGROW_NODE_BONUS, 'the node bonus is quoted in prose as "three times faster"; '
      + 'change it and Economy.md, Maps.md and Strategy.md all need re-reading').toBe(3.0);
    expect(wiki('Economy'), 'Economy.md: the node bonus').toContain('three times the base rate');
    expect(wiki('Maps'), 'Maps.md: the node bonus').toContain('three times faster');
  });

  it('the gate stays under the claim floor, which is why it can be quoted at all', () => {
    // Restated from `config.ts`: a harvester mines a claimed cell to zero, so a
    // gate above `ORE_MIN_CLAIM` is a gate a worked field can never clear. If
    // this ever fails, the wiki's "it comes back" is the first thing to reread.
    expect(ORE_REGROW_SPREAD * 900).toBeLessThan(25);
  });
});

/* ==========================================================================
 * 7. THE BLACKOUT ROSTER
 *
 * `Combat.engage` gates on the ENTITY: a structure that DRAWS power and is not
 * `Powered` cannot fire, whatever its weapon row says. So "fires through a
 * blackout" is a fact about `BuildingDef.power`, and it is derived here rather
 * than restated.
 * ========================================================================== */

const ARMED_STRUCTURES = BUILDINGS.filter((b) => b.weapons.length > 0);
const FIRES_IN_BLACKOUT = ARMED_STRUCTURES.filter((b) => b.power === 0).map((b) => b.name);
const DARK_IN_BLACKOUT = ARMED_STRUCTURES.filter((b) => b.power !== 0).map((b) => b.name);

describe('the wiki names the right guns as blackout-proof', () => {
  it('exactly the zero-draw emplacements keep firing', () => {
    expect(FIRES_IN_BLACKOUT.sort(), 'the set of armed structures with no power draw. '
      + 'Three of the four armies keep one cheap gun on a dead grid; the Pact keeps none, '
      + 'which is its documented doctrine. Change a `power:` field and the wiki prose about '
      + 'blackouts needs rewriting.').toEqual(['Pillbox', 'Sentry Gun', 'Spitpost']);
    expect(DARK_IN_BLACKOUT.length, 'seven armed structures draw power and go dark')
      .toBe(ARMED_STRUCTURES.length - 3);
  });

  it('no page claims a power-drawing structure fires through a blackout', () => {
    const pages = [
      'Combat', 'Strategy', 'Base-Building', 'Economy',
      ...FACTION_PAGES,
    ] as const;
    for (const page of pages) {
      // Table rows are dropped: they are checked structurally above, and a cell
      // has no sentence-ending punctuation, so leaving them in glues the last
      // column of a table to the first sentence of the paragraph after it.
      const prose = wiki(page)
        .split(/\r?\n/).filter((l) => !l.trimStart().startsWith('|')).join(' ')
        .replace(/\s+/g, ' ');
      for (const sentence of prose.split(/(?<=[.!?])\s/)) {
        if (!/fires? through/i.test(sentence)) continue;
        for (const name of DARK_IN_BLACKOUT) {
          expect(sentence.includes(name), `${page}.md: the ${name} draws `
            + `${(DEF_BY_NAME.get(name) as BuildingDef).power} power, so a dead grid silences it. `
            + `This sentence says otherwise:\n    "${sentence.trim()}"`).toBe(false);
        }
      }
    }
  });

  it('Combat.md §3 names the three that do, and none of the seven that do not', () => {
    const sec = /\n## 3\.[\s\S]*?\n## 4\./.exec(wiki('Combat'));
    expect(sec, 'Combat.md: §3 "How a shot resolves" was not found').not.toBeNull();
    const p = sec![0];
    expect(/\*\*Power/.test(p), 'Combat.md §3 must still carry a **Power** paragraph').toBe(true);
    for (const name of FIRES_IN_BLACKOUT) {
      expect(p, `Combat.md §3 must name the ${name} as a gun that survives a dead grid`)
        .toContain(name);
    }
  });
});

/* ==========================================================================
 * 8. THE MISSION TABLE — `wiki/Campaign.md`
 *
 * `Campaign.md` is the one page that is almost entirely counts: how many
 * missions there are, how they split between the two scopes, and how many
 * missions pay each class of reward. Every one of those is a second copy of
 * something `src/data/Missions.ts` owns, and none of them was checked.
 *
 * IT HAD ALREADY ROTTED. §9 said there were **7 map unlocks**; there are four.
 * The other three were `map.saltpan-reach`, `map.foundry-line` and
 * `map.glacier-shelf`, cut with the three preset-clone battlefields that paid
 * them — and §8 of the SAME PAGE says "Four of the seven battlefields are
 * earned" and then lists exactly four. So the page disagreed with itself, two
 * screens apart, and read as authoritative in both places.
 *
 * THE COUNT COLUMN IS CHECKED UNDER BOTH READINGS, DELIBERATELY. "Map unlocks:
 * 4" could mean four unlock IDS or four MISSIONS that pay one, and the page
 * never says which. Every class below is asserted against both, plus an
 * assertion that the two agree — so today the ambiguity is harmless, and the
 * day some class gains a second payer for one id, this fails and makes the page
 * say which number it means rather than silently being right about one of them.
 * ========================================================================== */

/** Every reward emitted by every mission, flattened. */
const ALL_REWARDS: readonly Reward[] = MISSIONS.flatMap((m) => m.reward);

const isUnlockUnder = (r: Reward, prefix: string): boolean => (
  r.kind === 'unlock' && r.unlockId.startsWith(prefix)
);

interface RewardClass {
  /** Verbatim first cell of the row in `Campaign.md` §9. */
  readonly row: string;
  readonly is: (r: Reward) => boolean;
  readonly why: string;
}

/**
 * The seven rows of §9, each one a PREDICATE over `MISSIONS[].reward` rather
 * than a number. Checked in both directions: a row on the page that is not
 * declared here fails, and a declared row the page drops fails too.
 */
const REWARD_CLASSES: readonly RewardClass[] = [
  {
    row: 'Unit unlocks',
    is: (r) => isUnlockUnder(r, 'unit.'),
    why: 'raider, tier-3 specialist, aircraft, commander hero',
  },
  {
    row: 'Structure unlocks',
    // `struct.superweapon.*` is its own row below, so it must not be counted
    // twice — that prefix is a SUBSET of `struct.` and the naive test scores 9.
    is: (r) => isUnlockUnder(r, 'struct.') && !isUnlockUnder(r, 'struct.superweapon.'),
    why: 'tech centre, specialist defence, anti-air emplacement, support pad',
  },
  {
    row: 'Map unlocks',
    is: (r) => isUnlockUnder(r, 'map.'),
    why: 'Frozen Sector, Industrial Grid, Contested Strait, Coral Shore — and NOT the '
      + 'three preset-clone maps that were cut, which is where the stale 7 came from',
  },
  {
    row: 'Commander powers',
    /*
     * Zero, and it is derived rather than asserted flat. The `power` variant of
     * `Reward` was DELETED when powers moved into the match (a Command Post
     * buys them now), so the schema itself can no longer express one — the only
     * way a power can come back as a mission reward is an unlock id in the old
     * `power.` namespace, which is exactly what this looks for.
     */
    is: (r) => isUnlockUnder(r, 'power.'),
    why: 'bought from a Command Post since v2.6.0; no mission pays one',
  },
  {
    row: 'Superweapon unlocks',
    is: (r) => isUnlockUnder(r, 'struct.superweapon.'),
    why: 'five ids over six structures — siege covers two armies',
  },
  {
    row: 'Objective credits',
    is: (r) => r.kind === 'credits',
    why: 'one per match objective, and nothing pays them out (§6 says so)',
  },
  {
    row: 'Cosmetics',
    is: (r) => r.kind === 'cosmetic',
    why: 'insignia and decals, rendered by nothing',
  },
];

describe('Campaign.md counts the mission table correctly', () => {
  const text = wiki('Campaign');

  it('has a mission table to count at all', () => {
    // The vacuity guard for everything below: if `MISSIONS` ever came back
    // empty, every count would be 0 and the page would fail for the wrong
    // reason. Both scopes must be populated, because the split is a claim too.
    expect(MISSIONS.length, 'MISSIONS is empty or tiny').toBeGreaterThanOrEqual(40);
    expect(MISSIONS.filter((m) => m.scope === 'profile').length).toBeGreaterThanOrEqual(25);
    expect(MISSIONS.filter((m) => m.scope === 'match').length).toBeGreaterThanOrEqual(10);
    expect(ALL_REWARDS.length, 'no rewards were flattened out of the table')
      .toBeGreaterThanOrEqual(MISSIONS.length);
  });

  it('opens with the size of the table, and §4 splits it by scope', () => {
    expect(text, `Campaign.md's opening paragraph names the size of the mission table; `
      + `MISSIONS has ${MISSIONS.length} rows`)
      .toContain(`${MISSIONS.length}-row mission table`);

    const t = parseTables(text).find(
      (x) => x.headers[1] === 'Profile missions' && x.headers[2] === 'Match objectives',
    );
    expect(t, 'Campaign.md §4: the "Two scopes" table was not found').toBeDefined();
    expect(t!.rows.length, 'Campaign.md §4: the two-scopes table lost most of its rows')
      .toBeGreaterThanOrEqual(6);

    const row = t!.rows.find((r) => r.cells[0].toLowerCase() === 'count');
    expect(row, 'Campaign.md §4: the two-scopes table has no "Count" row').toBeDefined();
    const profile = MISSIONS.filter((m) => m.scope === 'profile').length;
    const match = MISSIONS.filter((m) => m.scope === 'match').length;
    expect(num(row!.cells[1], 'Campaign.md §4 profile count'),
      'Campaign.md §4: profile missions').toBe(profile);
    expect(num(row!.cells[2], 'Campaign.md §4 match count'),
      'Campaign.md §4: match objectives').toBe(match);
    expect(profile + match, 'the two scopes must account for every mission')
      .toBe(MISSIONS.length);
  });

  it('§6 lists every match objective and what each one pays', () => {
    const t = parseTables(text).find(
      (x) => x.headers[0] === 'Objective' && x.headers.includes('Pays'),
    );
    expect(t, 'Campaign.md §6: the match-objective table was not found').toBeDefined();

    const objectives = MISSIONS.filter((m) => m.scope === 'match');
    expect(t!.rows.length, `Campaign.md §6: the page tabulates ${t!.rows.length} objectives, `
      + `the table ships ${objectives.length}`).toBe(objectives.length);

    const iPays = col(t!, 'Pays', 'Campaign.md §6');
    const byTitle = new Map(objectives.map((m) => [m.title, m]));
    for (const row of t!.rows) {
      const title = row.cells[0];
      const where = `Campaign.md:${row.line} "${title}"`;
      const m = byTitle.get(title);
      expect(m, `${where}: no match objective is called that. A renamed objective must `
        + 'move the page with it — this row cannot be skipped.').toBeDefined();
      const paid = m!.reward.flatMap((r) => (r.kind === 'credits' ? [r.amount] : []));
      expect(paid.length, `${where}: a match objective that pays no credits`).toBe(1);
      expect(num(row.cells[iPays], `${where} pays`), `${where}: credits`).toBe(paid[0]);
    }
    expect(new Set(t!.rows.map((r) => r.cells[0])).size,
      'Campaign.md §6: the table repeats an objective').toBe(objectives.length);
  });

  it('§9 counts each reward class the way MISSIONS[].reward does', () => {
    const t = parseTables(text).find(
      (x) => x.headers[0] === 'Reward class' && x.headers.includes('Count'),
    );
    expect(t, 'Campaign.md §9: the reward-class table was not found').toBeDefined();
    expect(t!.rows.length, 'Campaign.md §9: the reward table lost rows')
      .toBe(REWARD_CLASSES.length);

    const iCount = col(t!, 'Count', 'Campaign.md §9');
    const byRow = new Map(t!.rows.map((r) => [r.cells[0], r]));

    // BOTH DIRECTIONS. A class on the page this file does not know how to derive
    // is a finding, not a row to skip — that is how the stale 7 survived.
    expect([...byRow.keys()].sort(), 'Campaign.md §9 must tabulate exactly the reward '
      + 'classes REWARD_CLASSES derives, and nothing else. A new row needs a predicate '
      + 'here; a deleted row needs its predicate removed.')
      .toEqual(REWARD_CLASSES.map((c) => c.row).sort());

    for (const c of REWARD_CLASSES) {
      const row = byRow.get(c.row)!;
      const where = `Campaign.md:${row.line} "${c.row}"`;
      const rewards = ALL_REWARDS.filter(c.is).length;
      const payers = MISSIONS.filter((m) => m.reward.some(c.is)).length;

      expect(rewards, `${where}: ${rewards} rewards of this class are spread over ${payers} `
        + 'missions, so the page\'s single "Count" is ambiguous. Say which number it means, '
        + 'and split this assertion to match.').toBe(payers);
      expect(num(row.cells[iCount], `${where} count`),
        `${where}: the page says ${row.cells[iCount]}, MISSIONS pays this class ${rewards} `
        + `times (${c.why})`).toBe(rewards);
    }
  });
});

/* ==========================================================================
 * 9. THE CAMPAIGN — `wiki/Campaign.md` §1 to §3
 *
 * The page opened with "VOLTMARCH has no story campaign" for as long as that
 * was true, and went on saying it after `src/campaign/` shipped. It is the
 * IN-GAME MANUAL, so that sentence was the product telling a player a feature
 * on its own title screen did not exist.
 *
 * Everything §1 to §3 quantifies is a second copy of something the operation
 * table owns, and the shape of the rot is different from §8's: the mission
 * table is finished and drifts by RETUNE, while the campaign is PARTIAL and
 * drifts by CONTENT ARRIVING. So the checks below are written to fire when an
 * operation is ADDED, not only when one is changed — the row count, the par
 * total, the medal rule and the "the Pact has none yet" sentence all move the
 * moment the sixth operation lands.
 *
 * THE PLAN'S TWO NUMBERS ARE READ OUT OF `tests/campaign-length.spec.ts`
 * RATHER THAN RESTATED. 37 and ten hours are that file's constants; the wiki
 * quotes them at a player, and a third copy here would be the copy that rots.
 * This is the shape `tests/manual.spec.ts` already uses to compare its link
 * prefix against `wiki-links.spec.ts` — grep the declaration, do not import it,
 * so the two are genuinely compared rather than agreeing with themselves.
 * ========================================================================== */

const SHIPPED: readonly OperationDef[] = CAMPAIGNS.flatMap((c: ChapterDef) => c.operations);

/** A constant declared in `tests/campaign-length.spec.ts`, by name. */
function planConstant(name: string): number {
  const src = readFileSync(join(__dirname, 'campaign-length.spec.ts'), 'utf8');
  const m = new RegExp(`const ${name} = ([0-9_]+)`).exec(src);
  expect(m, `campaign-length.spec.ts no longer declares ${name} — the wiki quotes it`)
    .not.toBeNull();
  return Number((m?.[1] ?? '').replace(/_/g, ''));
}

const secondariesOf = (op: OperationDef): readonly ObjectiveDef[] =>
  op.objectives.filter((o) => o.kind === 'secondary');

describe('Campaign.md describes the campaign that exists', () => {
  const text = wiki('Campaign');

  it('has a campaign to describe at all', () => {
    // The vacuity guard. Every assertion below is about a table that must not
    // be empty — and an empty one would make "5 of a planned 37" fail for the
    // one reason that is not the page's fault, which is worth saying in the
    // message rather than leaving to be diagnosed.
    expect(SHIPPED.length, 'no operation is authored — CAMPAIGNS came back empty')
      .toBeGreaterThan(0);
    expect(CAMPAIGNS.length, 'no chapter carries an operation').toBeGreaterThan(0);
    // AND THE OPPOSITE CLAIM, WHICH IS THE ONE THE OLD PAGE MADE. If this ever
    // reads true again the page has to go back to saying so.
    expect(text, 'Campaign.md still says the game has no story campaign')
      .not.toContain('VOLTMARCH has no story campaign');
  });

  it('§1 tabulates every shipped operation, in order, with its par and objective counts', () => {
    const t = parseTables(text).find(
      (x) => x.headers[1] === 'Operation' && x.headers.includes('Par (min)'),
    );
    expect(t, 'Campaign.md §1: the shipped-operations table was not found').toBeDefined();
    expect(t!.rows.length, `Campaign.md §1: the page tabulates ${t!.rows.length} operations, `
      + `${SHIPPED.length} are authored. A new operation must be added to the page — that is `
      + 'the whole reason this assertion counts rather than samples.').toBe(SHIPPED.length);

    const iIndex = col(t!, '#', 'Campaign.md §1');
    const iTitle = col(t!, 'Operation', 'Campaign.md §1');
    const iChapter = col(t!, 'Chapter', 'Campaign.md §1');
    const iPar = col(t!, 'Par (min)', 'Campaign.md §1');
    const iPrimary = col(t!, 'Primary', 'Campaign.md §1');
    const iBonus = col(t!, 'Bonus', 'Campaign.md §1');

    // IN ORDER, not as a set. The table is the play order — chapter by chapter,
    // index by index — and a page that listed the right five in the wrong
    // sequence would be telling a player to start in the middle of a chain.
    const chapterTitle = new Map<string, string>(
      CAMPAIGNS.map((c: ChapterDef) => [c.id, c.title] as const),
    );
    for (let i = 0; i < SHIPPED.length; i++) {
      const op = SHIPPED[i];
      const row = t!.rows[i];
      const where = `Campaign.md:${row.line} "${row.cells[iTitle]}"`;
      expect(row.cells[iTitle], `${where}: expected ${op.title} in this position`).toBe(op.title);
      expect(num(row.cells[iIndex], `${where} index`), `${where}: index`).toBe(op.index);
      expect(row.cells[iChapter], `${where}: chapter`).toBe(chapterTitle.get(op.chapter));
      expect(num(row.cells[iPar], `${where} par`), `${where}: par is ${op.parSec}s`)
        .toBe(Math.round(op.parSec / 60));
      expect(num(row.cells[iPrimary], `${where} primaries`), `${where}: primary objectives`)
        .toBe(op.objectives.filter((o) => o.kind === 'primary').length);
      expect(num(row.cells[iBonus], `${where} bonuses`), `${where}: bonus objectives`)
        .toBe(secondariesOf(op).length);
    }
  });

  it('§1 says how partial the campaign is, in the plan\'s own numbers', () => {
    const planned = planConstant('PLANNED_OPERATIONS');
    const tenHours = planConstant('TEN_HOURS_SEC');
    const parMin = Math.round(totalParSeconds(CAMPAIGNS) / 60);

    expect(text, `Campaign.md must say it ships ${SHIPPED.length} of ${planned} operations`)
      .toContain(`${SHIPPED.length} of a planned ${planned} operations`);
    expect(text, `Campaign.md must quote the authored par total, which is ${parMin} min`)
      .toContain(`${parMin} minutes of authored par`);
    expect(text, 'Campaign.md must quote the length the full table is authored against')
      .toContain(`${tenHours / 3600} hours`);
  });

  it('§1 is right about which chapter is unwritten', () => {
    /*
     * BOTH DIRECTIONS, and this is the assertion that fires on the day Pact
     * content lands rather than on the day somebody re-reads the page. The
     * sentence is a claim about ABSENCE, which is exactly the kind that rots
     * silently: nothing about authoring an operation would otherwise make
     * anybody open this file.
     */
    const chapters = new Set(SHIPPED.map((op) => op.chapter));
    /*
     * IT FIRED, AND THAT IS WHY IT NO LONGER READS THIS WAY. It used to assert
     * `chapters.has('pact') === false` plus the page's sentence "has no
     * operations written at all yet", precisely so that authoring the first
     * Pact operation would break it. On 2026-08-19 it did.
     *
     * Pinning the next chapter by name would just re-arm the same trap for
     * whichever one empties out, so the rule is stated generally instead: the
     * page may not claim ANY chapter is unwritten while operations exist for
     * every chapter, and it must say the opposite while that holds. A claim
     * about ABSENCE is the kind that rots silently — nothing about authoring
     * an operation would otherwise make anybody open this file.
     */
    expect(text, 'every chapter has content, so Campaign.md §1 may not say one is unwritten')
      .not.toContain('has no operations written at all yet');
    expect(text, 'Campaign.md §1 must say all four chapters have a card while they do')
      .toContain('All four chapters now');
    // The chapter table and the operation table have to agree about how many
    // cards the screen draws — `CAMPAIGNS` drops a chapter with no operations.
    expect(CAMPAIGNS.length, 'a chapter carries no operations and is still in CAMPAIGNS')
      .toBe(chapters.size);
  });

  it('§1 is right about the opening banks', () => {
    // Two claims, both cheap and both the kind that a single retune falsifies:
    // most operations open on less than a skirmish does, and one opens on
    // nothing. `defaultSetup()` owns the skirmish number; the page does not
    // quote it, so only the COMPARISON is asserted here.
    const bank = defaultSetup().startingCredits;
    const leaner = SHIPPED.filter((op) => op.map.credits < bank).length;
    expect(leaner, `${leaner} of ${SHIPPED.length} operations open under the skirmish ${bank}; `
      + 'Campaign.md §1 says most of them do').toBeGreaterThan(SHIPPED.length / 2);
    expect(SHIPPED.some((op) => op.map.credits === 0),
      'Campaign.md §1 says one operation opens with no bank at all').toBe(true);
    expect(text).toContain('one of them on nothing at all');
  });

  it('§1 is right that no shipped operation ends on annihilation', () => {
    // The page tells the player that killing everything does not end an
    // operation. That is `OutcomePolicy`, per operation, and an operation may
    // legitimately opt back in — at which point this sentence stops being true
    // for the whole campaign and the page has to say "every operation that
    // ships today" differently.
    const optedIn = SHIPPED.filter(
      (op) => op.outcome.annihilationWin || op.outcome.assetLossDefeat,
    ).map((op) => op.id);
    expect(optedIn, 'these operations use the skirmish annihilation rules, which Campaign.md §1 '
      + 'says none of them do').toEqual([]);
    expect(text).toContain('Destroying everything the enemy owns does not end an operation');
  });

  it('§2 prices the bonus objectives the way the operations do', () => {
    const paid = SHIPPED.flatMap(
      (op) => secondariesOf(op).flatMap((o) => (o.credits === undefined ? [] : [o.credits])),
    );
    expect(paid.length, 'no shipped bonus objective pays credits, so §2 has nothing to price')
      .toBeGreaterThan(0);
    expect(text, `bonus payouts run ${Math.min(...paid)}..${Math.max(...paid)} credits`)
      .toContain(`worth ${Math.min(...paid)} to ${Math.max(...paid)} credits`);

    // The page also says one bonus pays nothing. Checked, because "one" is a
    // count and because the sentence would be a lie the moment somebody priced
    // the last unpaid bonus.
    const unpaid = SHIPPED.flatMap(
      (op) => secondariesOf(op).filter((o) => o.credits === undefined),
    ).length;
    /*
     * DERIVED, NOT SPELLED. This was `toBe(1)` against the literal sentence
     * "One shipped bonus pays no credits at all", and it broke the moment a
     * second unpaid bonus was authored — a true page failing because the count
     * in it had moved. The count still has to be RIGHT; it just no longer has
     * to be one. The word is spelled out because the page bans digits.
     */
    const WORDS = ['no', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
      'Eighteen', 'Nineteen', 'Twenty'];
    expect(unpaid, 'more unpaid bonuses than this assertion can spell').toBeLessThan(WORDS.length);
    const noun = unpaid === 1 ? 'bonus pays' : 'bonuses pay';
    expect(text, `${unpaid} shipped bonus objectives pay no credits`)
      .toContain(`${WORDS[unpaid]} shipped ${noun} no credits at all`);

    // And that no primary does, which is a build-time rule rather than taste.
    const paidPrimaries = SHIPPED.flatMap(
      (op) => op.objectives.filter((o) => o.kind === 'primary' && o.credits !== undefined),
    ).map((o) => o.id);
    expect(paidPrimaries, 'a primary objective pays credits').toEqual([]);
  });

  it('§2 states the medal rule `medalFor` actually implements', () => {
    /*
     * DERIVED BY RUNNING THE GRADER, not by reading it. `medalFor` takes the
     * difficulty threshold as a defaulted parameter, so the only honest way to
     * quote "Hard or above" at a player is to ask it which rungs pay gold.
     */
    const op = SHIPPED.find((o) => secondariesOf(o).length > 0);
    expect(op, 'no shipped operation has a bonus objective — silver cannot be exercised')
      .toBeDefined();

    const won = newOperationState(op as OperationDef, 0);
    won.outcome = 'won';
    const lost = newOperationState(op as OperationDef, 0);
    lost.outcome = 'lost';

    // Bronze: a win with a bonus outstanding. Nothing at all for a loss.
    expect(medalFor(op as OperationDef, won, 3), 'bronze').toBe(1);
    expect(medalFor(op as OperationDef, lost, 3), 'a loss must record nothing').toBe(0);

    for (const o of secondariesOf(op as OperationDef)) won.objectives.set(o.id, 'complete');

    const gold: number[] = [];
    const silver: number[] = [];
    for (let d = 0; d < DIFFICULTIES.length; d++) {
      const m = medalFor(op as OperationDef, won, d);
      if (m === 3) gold.push(d);
      if (m === 2) silver.push(d);
    }
    expect(gold.length, 'no difficulty pays gold').toBeGreaterThan(0);
    expect(silver.length, 'every difficulty pays gold — §2 says some do not').toBeGreaterThan(0);

    /*
     * AND THE HIDDEN CASE, WHICH THE PAGE GETS RIGHT ONLY BECAUSE IT WAS RUN.
     * `medalFor` walks every declared secondary and wants `'complete'`, so an
     * objective the operation never revealed blocks silver exactly as a failed
     * one does. The natural sentence to write is the opposite — that something
     * you were never shown cannot count against you — and a first draft of this
     * page wrote it.
     */
    const withHidden = SHIPPED.find((o) => secondariesOf(o).some((s) => s.hidden === true));
    expect(withHidden, 'no shipped operation declares a hidden bonus, so the rule §2 states '
      + 'about them is unexercised — author one, or reword the page').toBeDefined();
    const partial = newOperationState(withHidden as OperationDef, 0);
    partial.outcome = 'won';
    for (const o of secondariesOf(withHidden as OperationDef)) {
      if (o.hidden !== true) partial.objectives.set(o.id, 'complete');
    }
    expect(medalFor(withHidden as OperationDef, partial, 3),
      'an undiscovered hidden bonus must still cost silver').toBe(1);
    expect(text).toContain('It still counts against your medal');

    const t = parseTables(text).find((x) => x.headers[0] === 'Medal');
    expect(t, 'Campaign.md §2: the medal table was not found').toBeDefined();
    const row = t!.rows.find((r) => r.cells[0] === 'Gold');
    expect(row, 'Campaign.md §2: the medal table has no Gold row').toBeDefined();
    // BOTH DIRECTIONS: every rung that pays gold is named, and no rung that
    // does not pay it is. Naming Normal would be the failure that matters.
    for (const d of gold) {
      expect(row!.cells[1], `Campaign.md §2: ${DIFFICULTIES[d]} pays gold and the row omits it`)
        .toContain(DIFFICULTIES[d]);
    }
    for (const d of silver) {
      expect(row!.cells[1], `Campaign.md §2: ${DIFFICULTIES[d]} does NOT pay gold`)
        .not.toContain(DIFFICULTIES[d]);
    }
  });
});

/* ==========================================================================
 * 9b. THE COMMANDER HERO IS GATED, AND TWO PAGES SAID IT WAS NOT
 *
 * `Factions.md` said "None is behind a mission unlock" and `Units-and-Verbs.md`
 * said "Commanders are not mission-locked — you can build one in your first
 * skirmish". Both were true when the four heroes shipped with no `unlockedBy`
 * and both stopped being true the release `unit.commander` landed — paid by
 * *Old Guard*, which `Campaign.md`'s own mission table has listed correctly the
 * whole time. So the manual contradicted itself two pages apart and read as
 * authoritative in both places, which is the §8 failure verbatim.
 *
 * THE ROT IS ONE-WAY AND THAT IS WHY IT SURVIVED THE REWORD. Both sentences
 * were edited in the same pass that rewrote this page's campaign half — from
 * "campaign unlock" to "mission unlock" — because the WORD was wrong. Nothing
 * about that edit asks whether the CLAIM is, and no test did either.
 * ========================================================================== */

describe('the wiki is right about what gates the commander hero', () => {
  /** The four heroes, by key. One per army; `maxAlive: 1`. */
  const COMMANDER_KEYS: readonly string[] = ['fieldMarshal', 'commissar', 'mrdHierarch', 'rclBaron'];

  const commanders = COMMANDER_KEYS.map((key) => {
    const d = UNITS.find((u) => u.key === key);
    expect(d, `no unit '${key}' — the commander roster moved and this file names it`)
      .toBeDefined();
    return d as UnitDef;
  });

  it('all four heroes are progression-gated, by one unlock, paid by one mission', () => {
    // The state assertion. If a hero is ever ungated again, this fails with the
    // key — and the two sentences below have to move back with it.
    const ungated = commanders.filter((d) => (d.unlockedBy ?? '') === '').map((d) => d.key);
    expect(ungated, 'a commander ships with no `unlockedBy`; Factions.md and Units-and-Verbs.md '
      + 'both state that all four are gated, and would have to say so differently').toEqual([]);

    expect(new Set(commanders.map((d) => d.unlockedBy)).size,
      'the four heroes no longer share one unlock id; both pages say "all four by the same one"')
      .toBe(1);
  });

  it('both pages name the mission that actually pays it, and neither says it is ungated', () => {
    const unlockId = commanders[0].unlockedBy ?? '';
    const payers = MISSIONS.filter(
      (m) => m.reward.some((r) => r.kind === 'unlock' && r.unlockId === unlockId),
    );
    expect(payers.length, `exactly one mission must grant '${unlockId}'`).toBe(1);
    const title = payers[0].title;

    for (const page of ['Factions', 'Units-and-Verbs'] as const) {
      const text = wiki(page);
      expect(text, `${page}.md describes the commanders and must name '${title}', `
        + `the mission that pays '${unlockId}'`).toContain(title);
      // AND THE OPPOSITE CLAIM, VERBATIM, IN BOTH ITS SHIPPED SPELLINGS. These
      // are the two sentences that were false; a revert has to fail here.
      expect(text, `${page}.md still claims the commander is not gated`)
        .not.toMatch(/not (?:mission|campaign)-locked/);
      expect(text, `${page}.md still claims no commander is behind an unlock`)
        .not.toMatch(/None\s+is behind a (?:mission|campaign) unlock/);
    }
  });
});

/* ==========================================================================
 * 9c. `How-to-Play.md` ENUMERATES THE MAIN MENU, AND AN ENUMERATION ROTS BY
 *     OMISSION — WHICH NO GREP FOR THE MISSING WORD CAN FIND
 *
 * "The main menu offers Tutorial, Skirmish, Multiplayer, …" did not name
 * **Campaign**, and could not have: the sentence never contained the word, so
 * the sweep that fixed every OTHER page — grep `wiki/` for "campaign" — was
 * structurally blind to it. The page a new player opens first for "Starting a
 * match" went on listing a title screen that had not existed for a week.
 *
 * DERIVED FROM `MainMenu.ts` BY READING IT, not by importing it: the module is
 * DOM-side and the labels are string literals, so the grep IS the comparison.
 * Same shape as `planConstant` above.
 * ========================================================================== */

/**
 * A nav label the page deliberately does not list. FAILS IN BOTH DIRECTIONS —
 * removing the button, or listing it on the page, fails here until the entry
 * goes with it.
 *
 * `Quit` closes the game; the sentence is about what the menu OFFERS, and this
 * omission predates the campaign and is recorded rather than quietly fixed.
 */
const MENU_LABELS_UNLISTED: readonly string[] = ['Quit'];

describe('How-to-Play.md lists the main menu the shell actually builds', () => {
  const menuSource = readFileSync(
    join(__dirname, '..', 'src', 'shell', 'MainMenu.ts'), 'utf8',
  );
  const text = wiki('How-to-Play');

  /** Every `button('X', {` label in `MainMenu.ts`, in source order. */
  const labels = [...menuSource.matchAll(/\bbutton\('([A-Z][A-Za-z ]*)',\s*\{/g)]
    .map((m) => m[1])
    // `Back` is the page frame's own control, not a menu entry.
    .filter((l) => l !== 'Back');

  it('finds the menu to compare against', () => {
    expect(labels.length, 'no menu buttons found — the `button(\'…\')` shape in MainMenu.ts '
      + 'changed and this check silently stopped comparing anything').toBeGreaterThan(5);
    expect(labels, 'MainMenu.ts no longer mounts a Campaign button; How-to-Play.md says it does')
      .toContain('Campaign');
  });

  it('names every menu entry, and every declared omission is still omitted', () => {
    const paragraph = /The main menu offers[^\n]*\n?[^\n]*\./.exec(text)?.[0] ?? '';
    expect(paragraph, 'How-to-Play.md no longer has a "The main menu offers …" sentence')
      .not.toBe('');

    for (const label of labels) {
      const listed = paragraph.includes(`**${label}**`);
      if (MENU_LABELS_UNLISTED.includes(label)) {
        expect(listed, `How-to-Play.md now lists "${label}" — drop it from `
          + 'MENU_LABELS_UNLISTED').toBe(false);
      } else {
        expect(listed, `How-to-Play.md's main-menu sentence omits "${label}", which `
          + 'MainMenu.ts mounts').toBe(true);
      }
    }

    // The other direction: an exception for a button that no longer exists.
    for (const label of MENU_LABELS_UNLISTED) {
      expect(labels, `MENU_LABELS_UNLISTED names "${label}", which MainMenu.ts no longer mounts`)
        .toContain(label);
    }
  });
});

/* ==========================================================================
 * 10. CLAIMS THAT CANNOT BE MACHINE-CHECKED
 *
 * Not everything above is reachable from a table, and faking a check is worse
 * than declaring the gap. Each entry names a page and a verbatim phrase, and
 * the test asserts the phrase IS STILL THERE — so an entry cannot outlive the
 * sentence it excuses. That is the both-directions property: deleting or
 * rewording the claim fails here until the entry goes with it.
 * ========================================================================== */

const UNCHECKED_CLAIMS: readonly { page: string; phrase: string; why: string }[] = [
  {
    page: 'Economy',
    phrase: 'a patch mined from the near edge fills back in',
    why: 'The SHAPE of regrowth. Derivable only by driving `OreField.regrow` for '
      + 'sim-minutes, which `tests/ore-regrowth.spec.ts` already does; restating '
      + 'the measured curve here would be a third copy of it.',
  },
  {
    page: 'Campaign',
    phrase: 'No mission advances, no unlock is granted, and no lifetime counter moves',
    why: 'The `suppressProgression` latch. Behavioural, not numeric, and it is already '
      + 'driven end to end by `tests/progression-suppress.spec.ts` — which emits '
      + '`match:started` on a real bus rather than checking that a caller skipped a '
      + 'call, because a caller-shaped test passes against the broken build.',
  },
  {
    page: 'Campaign',
    phrase: 'lists **the operation\'s** objectives',
    why: 'Where the objective panel gets its rows. `src/ui/objectives.system.ts` swaps '
      + 'the progression view for `campaignObjectiveView()` while a session is armed; '
      + '`tests/objectives-ux.spec.ts` drives that. A DOM behaviour is not reachable '
      + 'from `DEF_TABLES`, and an earlier draft of this page asserted the OPPOSITE — '
      + 'that nothing drew them — from a grep of the wrong seam. Pinned here so the '
      + 'sentence cannot rot back.',
  },
  {
    page: 'Strategy',
    phrase: 'at equal credits three Wardens beat two-and-a-third Anvils',
    why: 'A cost-normalised group claim. The 1v1 halves of the same row ARE checked '
      + 'above; this clause depends on a fight model no table owns.',
  },
];

describe('the declared unmachine-checkable claims are still on the page', () => {
  for (const c of UNCHECKED_CLAIMS) {
    it(`${c.page}.md — ${c.phrase.slice(0, 48)}…`, () => {
      expect(wiki(c.page), `UNCHECKED_CLAIMS names a phrase ${c.page}.md no longer contains. `
        + 'Either the claim was rewritten (delete the entry) or the page lost it '
        + `(restore one of the two). Reason on file: ${c.why}`).toContain(c.phrase);
    });
  }
});

/* ==========================================================================
 * 14. THE STANCES, AND THE ONE THAT MOVES
 *
 * Four wiki sites said "Aggressive and Defensive behave identically" and
 * "nothing chases a target of opportunity in this build", while How-to-Play.md
 * said the opposite in a table. All four were TRUE when written -- `GUARD_LEASH`
 * was declared and read nowhere, and `guardX/guardZ` were written by six modules
 * and consumed by none. v2.3.0's LEASH fix wired it and the manual did not
 * notice, so the in-game manual shipped contradicting itself.
 *
 * `STANCE_CHASE_METRES[Aggressive]` is `GUARD_LEASH` and every other entry is 0,
 * so the claim is a fact about that table and is derived from it here. The
 * aircraft band is what makes it matter to a player: `Targeting.reachOf` returns
 * `range * APPROACH_STOP_FRAC + chase`, so the envelope scales with weapon
 * range and a short retreat inside it is undone.
 * ========================================================================== */

const STANCE_NAMES = ['Aggressive', 'Defensive', 'Hold Fire', 'Hold Ground'] as const;

/**
 * `APPROACH_STOP_FRAC` is module-private to `src/sim/Targeting.ts`, so it is
 * READ OUT OF THE SOURCE rather than re-typed. A re-implemented constant nobody
 * checks is the same defect this section exists to close, wearing the other hat.
 */
function approachStopFrac(): number {
  const src = readFileSync(join(__dirname, '..', 'src', 'sim', 'Targeting.ts'), 'utf8');
  const m = /const APPROACH_STOP_FRAC = ([0-9.]+);/.exec(src);
  expect(m, 'src/sim/Targeting.ts no longer declares APPROACH_STOP_FRAC as a literal. '
    + 'The wiki quotes an aircraft chase band derived from it.').not.toBeNull();
  return Number(m![1]);
}

describe('the wiki is right about which stance chases', () => {
  it('Aggressive is the only stance with a chase envelope, and it is GUARD_LEASH', () => {
    expect(STANCE_CHASE_METRES[0], 'Aggressive chases GUARD_LEASH metres from its post')
      .toBe(GUARD_LEASH);
    for (let i = 1; i < STANCE_CHASE_METRES.length; i++) {
      expect(STANCE_CHASE_METRES[i], `${STANCE_NAMES[i]} must not chase — `
        + 'three wiki pages now say Aggressive is the only stance that leaves its post')
        .toBe(0);
    }
    // The other half of "all four differ": HoldGround is the only one that will
    // not walk home, which is what separates it from Defensive and Hold Fire.
    expect(STANCE_RETURNS, 'HoldGround is the only stance that does not return to post')
      .toEqual([true, true, true, false]);
  });

  it('the eighteen metres the pages spell out is GUARD_LEASH', () => {
    expect(GUARD_LEASH, 'Combat.md, Strategy.md and Units-and-Verbs.md all spell this '
      + 'as "eighteen metres". Change it and all three need re-reading.').toBe(18);
    for (const page of ['Combat', 'Strategy', 'Units-and-Verbs'] as const) {
      expect(wiki(page), `${page}.md: the chase envelope`).toContain('eighteen metres');
    }
  });

  it('the aircraft band the pages quote is derived from the real airframes', () => {
    const stop = approachStopFrac();
    const air = UNITS.filter((u) => u.locomotor === 5 && u.weapons.length > 0);
    expect(air.length, 'four airframes, one per army — air-layer.spec.ts pins that').toBe(4);

    const envelopes = air.map((u) => WEAPONS[u.weapons[0]].range * stop + GUARD_LEASH);
    // ROUNDED, not floored and ceiled: the real band is 31.6..36.4, and the
    // prose says "thirty-two to thirty-six". Widening it to 31..37 would quote a
    // range no airframe actually occupies.
    const lo = Math.round(Math.min(...envelopes));
    const hi = Math.round(Math.max(...envelopes));
    expect([lo, hi], 'the pages spell this band as "thirty-two to thirty-six metres". '
      + `Derived from the shipped airframes it is ${lo}..${hi}. Retune an aircraft weapon `
      + 'and the prose needs rewriting.').toEqual([32, 36]);

    for (const page of ['Combat', 'Strategy', 'Units-and-Verbs'] as const) {
      expect(wiki(page), `${page}.md: the aircraft chase band`)
        .toContain('thirty-two');
      expect(wiki(page), `${page}.md: the aircraft chase band`)
        .toContain('thirty-six metres');
    }
  });

  it('and the claim that they behave identically is gone from every page', () => {
    // Both directions. This is the sentence that shipped false for two releases,
    // in four places, while a fifth page said the opposite.
    const DEAD = [
      'behave identically',
      'are the same thing in this',
      'Nothing chases a target of opportunity',
      'nothing chases a target of opportunity',
      'there is no leash',
    ];
    for (const page of ['Combat', 'Strategy', 'Units-and-Verbs', 'How-to-Play'] as const) {
      for (const phrase of DEAD) {
        expect(wiki(page), `${page}.md still carries "${phrase}", which stopped being true `
          + 'when GUARD_LEASH was wired').not.toContain(phrase);
      }
    }
  });
});

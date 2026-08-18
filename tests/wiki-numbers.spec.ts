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
 *   - The Multigunner IFV's gun was re-authored from `chaingun` (22 x4, 116 raw
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
import { ARMOR_MATRIX, COMBAT_DAMAGE } from '../src/core/config';
import {
  ORE_REGROW_NODE_BONUS, ORE_REGROW_RATE, ORE_REGROW_SPREAD,
} from '../src/core/config';
import type { BuildingDef, UnitDef, WeaponDef } from '../src/core/types';

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
 * write "Grizzly" where the cameo says "Grizzly Tank", which is the right call
 * for a page written for players. Declared rather than fuzzy-matched, because a
 * prefix match would also silently accept a genuinely wrong unit — and the
 * declaration is checked in BOTH directions: an alias that names no def, or that
 * the pages stop using, fails.
 */
const SHORT_UNIT_NAMES: Readonly<Record<string, string>> = {
  Grizzly: 'Grizzly Tank',
  Rhino: 'Rhino Tank',
  Apocalypse: 'Apocalypse Tank',
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
  { row: 'Grizzly vs Rhino', a: 'Grizzly Tank', b: 'Rhino Tank', winner: 'Rhino' },
  { row: 'IFV vs Grizzly', a: 'Multigunner IFV', b: 'Grizzly Tank', winner: 'Grizzly' },
  { row: 'IFV vs Rhino', a: 'Multigunner IFV', b: 'Rhino Tank', winner: 'Rhino' },
  { row: 'IFV vs Solarch', a: 'Multigunner IFV', b: 'Solarch', winner: 'IFV' },
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

  it('quotes the four-Javelin answer to a Rhino', () => {
    const jav = DEF_BY_NAME.get('Javelin') as UnitDef;
    const rhino = DEF_BY_NAME.get('Rhino Tank') as UnitDef;
    const cell = duelRows.get('Javelins vs Rhinos');
    expect(cell, 'Strategy.md: no "Javelins vs Rhinos" duel row').toBeDefined();
    expect(cell, 'Strategy.md: four Javelins against one Rhino')
      .toContain(secs(ttk(jav, rhino, 4)));
  });

  it('quotes how long a rifle takes against the two heavy tanks', () => {
    const gi = DEF_BY_NAME.get('G.I.') as UnitDef;
    const rhino = DEF_BY_NAME.get('Rhino Tank') as UnitDef;
    const apoc = DEF_BY_NAME.get('Apocalypse Tank') as UnitDef;
    // Whole seconds: the sentence is prose, not a table.
    expect(strategy, 'Strategy.md §5: the small-arms-against-heavy sentence')
      .toContain(`${Math.round(ttk(gi, rhino))} seconds`);
    expect(strategy, 'Strategy.md §5: the small-arms-against-heavy sentence')
      .toContain(`${Math.round(ttk(gi, apoc))} to kill an Apocalypse`);
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
 * 8. CLAIMS THAT CANNOT BE MACHINE-CHECKED
 *
 * Not everything above is reachable from a table, and faking a check is worse
 * than declaring the gap. Each entry names a page and a verbatim phrase, and
 * the test asserts the phrase IS STILL THERE — so an entry cannot outlive the
 * sentence it excuses. That is the both-directions property: deleting or
 * rewording the claim fails here until the entry goes with it.
 * ========================================================================== */

const UNCHECKED_CLAIMS: readonly { page: string; phrase: string; why: string }[] = [
  {
    page: 'Combat',
    phrase: 'Aggressive and Defensive are the same thing in this',
    why: 'A behavioural claim about `Steering`/`Targeting`, not a number. '
      + '`tests/stances.spec.ts` is where a stance regression belongs.',
  },
  {
    page: 'Economy',
    phrase: 'a patch mined from the near edge fills back in',
    why: 'The SHAPE of regrowth. Derivable only by driving `OreField.regrow` for '
      + 'sim-minutes, which `tests/ore-regrowth.spec.ts` already does; restating '
      + 'the measured curve here would be a third copy of it.',
  },
  {
    page: 'Strategy',
    phrase: 'at equal credits three Grizzlies beat two-and-a-third Rhinos',
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

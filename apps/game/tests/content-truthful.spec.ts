/**
 * ============================================================================
 * tests/content-truthful.spec.ts — the content table may not claim what the
 * code does not do
 * ============================================================================
 * WHY THIS FILE EXISTS
 * --------------------
 * `tests/credits-truthful.spec.ts` checks the credits screen against what is
 * actually in `public/`. `tests/reward-wiring.spec.ts` checks that every reward
 * a mission pays reaches something. This is the same mechanism for the CONTENT
 * TABLES, and it exists because twelve separate defects of one shape shipped
 * together and every one of them was invisible to a green build:
 *
 *   a rule whose target the simulation can never emit  (`rank: 3`, cap 2)
 *   a blurb naming a weakness the entity cannot have   ("Dies in a brownout")
 *   a weapon flag on a carrier that cannot honour it   (`zenithBeam`)
 *   a column read by nothing                           (`crushLevel` with no
 *                                                       `EntityFlag.Crusher`)
 *   an unlock id that gates no def                     (five superweapons)
 *   a def gated behind an id no mission pays           (the other direction)
 *   an authored weapon row no def fires                (`artillery`)
 *
 * None of those is a crash and none of them is visible in a diff. Each one
 * reads, from the outside, exactly like a balance decision somebody made on
 * purpose — which CLAUDE.md names as the most expensive kind of content bug to
 * find. A reviewer noticing is not a mechanism; this is the mechanism.
 *
 * THE RULE FOR EDITING THIS FILE
 * ------------------------------
 * Several sections carry an ALLOW-LIST with a written reason per entry. Adding
 * a row to one is a legitimate way to make this file pass — but it forces the
 * reason to be typed out next to the exception, in a place that is read,
 * instead of the exception being silent. Deleting an assertion is not.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BUILDINGS, UNITS, UNLOCK_TAGS, WEAPONS,
} from '../src/data/Defs';
import {
  MISSIONS, UNLOCKS, UNLOCK_SOURCES, unlockRequirementText, unlockSource,
} from '../src/data/Missions';
import { ARMOR_MATRIX, VETERANCY_KILLS } from '../src/core/config';
import { OreField } from '../src/sim/Economy';
import { CreditReason, EntityFlag, EntityKind } from '../src/core/types';
import type { BuildingDef, UnitDef } from '../src/core/types';
import { DEFAULT_WEAPONS } from '../src/sim/Combat';
import { LOCKED_REASON, UnlockGate } from '../src/progression/UnlockGate';
import { UNLOCK_REQUIREMENTS } from '../src/data/Missions';

const at = (rel: string): string => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

/** Every shipped def, units and buildings together. */
const ALL_DEFS: readonly (UnitDef | BuildingDef)[] = [...UNITS, ...BUILDINGS];

/* ==========================================================================
 * 1. A RULE MUST BE SATISFIABLE
 *
 * `combat.veteran.2` asked for `rank: 3`. `Damage.ts` promotes with
 * `while (rank < 2 ...)`, `Crates.ts` refuses above 2, and `MissionTracker`
 * advances only when `p.rank >= rule.rank` — so the mission could never
 * complete, and it is the ONLY payer of `power.emergency-repair`. A fully
 * implemented commander power was unreachable and nothing said so.
 * ========================================================================== */

describe('every mission rule can actually be satisfied', () => {
  it('never asks for a veterancy rank the simulation cannot emit', () => {
    // `VETERANCY_KILLS` has one entry per PROMOTION, so its length is the top
    // rank. Derived rather than hard-coded: raising the cap should widen this
    // bound automatically, and lowering it should fail the mission table.
    const maxRank = VETERANCY_KILLS.length;
    expect(maxRank, 'the veterancy ladder collapsed').toBeGreaterThan(0);

    for (const m of MISSIONS) {
      // `MissionDef.rule` is optional in the type; the table's own self-check
      // refuses a row without one, so this narrows rather than tolerates.
      const rule = m.rule;
      if (rule === undefined || rule.on !== 'veterancy') continue;
      const rank = rule.rank ?? 1;
      expect(
        rank,
        `mission "${m.id}" waits for veterancy rank ${rank}, but the ladder stops at `
        + `${maxRank} (VETERANCY_KILLS has ${maxRank} entries). It can never complete, `
        + `and it pays: ${m.reward.map((r) => r.kind).join(', ')}.`,
      ).toBeLessThanOrEqual(maxRank);
      expect(rank, `mission "${m.id}" has a rank below 1`).toBeGreaterThanOrEqual(1);
    }
  });

  it('pins the ladder Damage.ts and Crates.ts actually implement', () => {
    // The bound above is only as good as its source. Both promotion sites cap
    // at the same number in the same words; if one changes, this catches the
    // other rather than letting the mission table follow the wrong one.
    expect(at('apps/game/src/sim/Damage.ts')).toContain('while (rank < 2');
    expect(at('apps/game/src/sim/Crates.ts')).toContain('rank >= 2');
    expect(VETERANCY_KILLS.length).toBe(2);
  });

  /* -- an ore target must be payable out of ore that exists --------------------
   * `economy.harvest.2` asked for 250,000 banked credits of harvested ore. The
   * whole map seeds ~76,000, so it asked a player to mine out three and a third
   * maps — and what it gates is not a superweapon but `struct.tech`, the tech
   * centre whose own blurb is "Unlocks the top of every tab" and which is the
   * `prereqs` entry on all six superweapon structures. A mid-game building was
   * priced further out than every superweapon chain in the file, so a fresh
   * profile could not reach the late-game layer AT ALL — and because the gate
   * mirrors onto the AI, neither could the opponent.
   *
   * Ore regrows, so this is not a hard ceiling on one match. It is the right
   * YARDSTICK all the same: "how many entire maps of ore is this?" is the
   * question nobody asked of the number, and one map is the reading that makes
   * the mission's own name true.                                              */
  it('never asks for more ore in one chain rung than a whole map holds', () => {
    // The real seeder over the real layout: `addStartOre` lays one R=30 field
    // per army plus one R=22 at the centroid. No `accept` predicate, so this is
    // the generous reading — a map with water removes cells, never adds them.
    const field = new OreField();
    const spots = [{ x: 140, z: 140 }, { x: 372, z: 372 }];
    for (const s of spots) field.seedField(s.x, s.z, 30);
    field.seedField(
      spots.reduce((a, s) => a + s.x, 0) / spots.length,
      spots.reduce((a, s) => a + s.z, 0) / spots.length,
      22,
    );
    const mapOre = field.totalOre();
    expect(mapOre, 'the ore seeder placed nothing').toBeGreaterThan(1000);

    /* THE BOUND APPLIES TO RUNGS THAT GATE BUILDABLE CONTENT, and that set is
     * derived from the def table rather than listed here. A long tail is
     * allowed to span a career — `construction.produce.2` asks for 750 units
     * and pays a MAP, which opens a row in the lobby and blocks no def. (This
     * cited `economy.harvest.3` and its 1,000,000 ore "which pays the Ore
     * Boost"; that mission paid a map by the time the sentence was read, and it
     * has since been retired with the preset-clone battlefield it paid.) An unlock id
     * some def carries as `unlockedBy` is a different animal: until it is paid,
     * a tab stops one tier short, and (via `UnlockGate.mirrorAI`) it stops
     * short for the opponent too. Nothing a player must own to SEE the rest of
     * the game may cost more ore than the game contains. */
    const gatesADef = (unlockId: string): boolean =>
      ALL_DEFS.some((d) => d.unlockedBy === unlockId);

    let checked = 0;
    for (const m of MISSIONS) {
      const rule = m.rule;
      if (rule === undefined || rule.on !== 'earn') continue;
      if (!(rule.reasons ?? []).includes(CreditReason.Harvest)) continue;
      const gated = m.reward
        .filter((r) => r.kind === 'unlock' && gatesADef(r.unlockId))
        .map((r) => (r.kind === 'unlock' ? r.unlockId : ''));
      if (gated.length === 0) continue;
      checked++;
      expect(
        m.target,
        `mission "${m.id}" wants ${m.target.toLocaleString()} credits of harvested ore and `
        + `gates ${gated.join(', ')} — content that defs carry as \`unlockedBy\`. `
        + `A whole map seeds ~${Math.round(mapOre).toLocaleString()}, so that is `
        + `${(m.target / mapOre).toFixed(1)} entire maps mined out before the tier opens, `
        + 'for the player AND for the AI that mirrors them. '
        + 'See the note on `economy.harvest.2` in src/data/Missions.ts.',
      ).toBeLessThanOrEqual(mapOre);
    }
    // Otherwise a refactor that renamed the rule or the reason would leave this
    // case green while checking nothing at all.
    expect(checked, 'no ore rung gates a def any more — has the table moved?').toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * 2. UNLOCK IDS RESOLVE IN BOTH DIRECTIONS
 *
 * `UnlockGate` already warns about a def gated behind an id no mission grants.
 * Nothing watched the other way, and that is where five superweapon ids sat
 * paying into nothing for a whole release while six superweapon structures
 * shipped day-one buildable.
 * ========================================================================== */

/** Reward kinds that are honoured somewhere other than a def gate. */
const NON_DEF_PREFIXES: readonly string[] = ['power.', 'map.', 'cosmetic.'];
const gatesADef = (id: string): boolean => !NON_DEF_PREFIXES.some((p) => id.startsWith(p));

describe('unlock ids and defs agree in both directions', () => {
  it('grants every declared id exactly once', () => {
    for (const key of Object.keys(UNLOCKS) as (keyof typeof UNLOCKS)[]) {
      const id = UNLOCKS[key];
      const payers = MISSIONS.filter(
        (m) => m.reward.some((r) => r.kind === 'unlock' && r.unlockId === id),
      );
      expect(payers.map((m) => m.id), `UNLOCKS.${key} ("${id}")`).toHaveLength(1);
    }
  });

  it('has at least one def behind every id that is supposed to gate one', () => {
    // THE DEFECT, PINNED. An id in this shape that no def carries is a reward
    // the player earns, is congratulated for, and can never spend.
    const declared = new Set(
      ALL_DEFS.map((d) => (d as { unlockedBy?: string }).unlockedBy)
        .filter((s): s is string => typeof s === 'string' && s.length > 0),
    );
    const orphaned: string[] = [];
    for (const src of UNLOCK_SOURCES) {
      if (!gatesADef(src.unlockId)) continue;
      if (!declared.has(src.unlockId)) orphaned.push(`${src.unlockId} (paid by ${src.missionId})`);
    }
    expect(
      orphaned,
      'these unlock ids gate nothing. Either tag a def with them in UNLOCK_TAGS, or retire '
      + 'the id and re-point the mission that pays it.',
    ).toEqual([]);
  });

  it('has exactly one granting mission behind every def gate', () => {
    const broken: string[] = [];
    for (const d of ALL_DEFS) {
      const id = (d as { unlockedBy?: string }).unlockedBy;
      if (id === undefined || id === '') continue;
      if (unlockSource(id) === undefined) broken.push(`"${d.key}" is gated behind "${id}", which no mission grants`);
    }
    expect(broken, 'a def gated behind an unpayable id is permanently unbuildable').toEqual([]);
  });

  it('keeps UNLOCK_TAGS and the def objects saying the same thing', () => {
    for (const [key, id] of Object.entries(UNLOCK_TAGS)) {
      const def = ALL_DEFS.find((d) => d.key === key);
      expect(def, `UNLOCK_TAGS gates "${key}", which is not a def`).toBeDefined();
      expect((def as { unlockedBy?: string }).unlockedBy, `def "${key}"`).toBe(id);
    }
  });

  it('gates all six superweapon structures', () => {
    // The specific regression: these shipped with no `unlockedBy` at all, so a
    // fresh profile could build a Nuclear Missile Silo in its first match.
    for (const key of ['nuclearSilo', 'ironCurtain', 'chronosphere', 'weatherControl',
      'mrdHeliograph', 'rclStormworks']) {
      const def = BUILDINGS.find((b) => b.key === key);
      expect(def, `no superweapon def "${key}"`).toBeDefined();
      expect(def!.unlockedBy, `"${key}" is a superweapon and must be earned`).toBeDefined();
      expect(def!.unlockedBy!.startsWith('struct.superweapon.'), key).toBe(true);
    }
  });

  it('names a real superweapon structure for every gated key', () => {
    // The join the other way: `Superweapons.ts#SUPERWEAPONS[].structureKeys` is
    // what actually arms a button, so a tag on a key that service never names
    // would gate a structure that charges nothing.
    const service = at('apps/game/src/sim/Superweapons.ts');
    for (const [key, id] of Object.entries(UNLOCK_TAGS)) {
      if (!id.startsWith('struct.superweapon.')) continue;
      expect(service, `"${key}" is tagged as a superweapon but Superweapons.ts never names it`)
        .toContain(`'${key}'`);
    }
  });
});

/* ==========================================================================
 * 3. A FLAG THE ENTITY CANNOT CARRY IS NOT A FEATURE
 *
 * Two columns and one weapon flag, all three of which were authored, read as
 * live, and gated on a bit nothing sets.
 * ========================================================================== */

const weaponsOf = (d: UnitDef | BuildingDef): readonly number[] => d.weapons;

describe('flags and the columns that depend on them', () => {
  it('gives every crushLevel a Crusher flag to switch it on', () => {
    // `Crush.ts#crushesUnit` tests `EntityFlag.Crusher` BEFORE it reads
    // `crushLevel`, so a level without the flag is a dead column that reads
    // like a working one. The Refractor Tank carried `crushLevel: 2` in BOTH def
    // tables and no flag, so the number was authored twice and honoured never.
    //
    // Only the def's own flag word is checked. For the two original armies the
    // fallback row in `Scenarios.ts` may also carry `Crusher` and `spawnUnit`
    // ORs the two, so a def passing this is sufficient but not necessary —
    // which is why the failure message names both places.
    const FALLBACK_CRUSHERS: ReadonlySet<string> = new Set([
      // Carried on the `Scenarios.FALLBACK_UNITS` row instead of here. Each of
      // these has `TURRETED | EntityFlag.Crusher` (or the harvester's
      // `IsHarvester | Crusher`) in that table, so the flag does reach the
      // entity; `data.spec.ts` does not compare flag words, so this list is how
      // that stays visible.
      'grizzly', 'rhino', 'apocalypse', 'harvester',
    ]);
    const dead: string[] = [];
    for (const u of UNITS) {
      if (u.crushLevel <= 0) continue;
      if ((u.flags & EntityFlag.Crusher) !== 0) continue;
      if (FALLBACK_CRUSHERS.has(u.key)) continue;
      dead.push(`"${u.key}" has crushLevel ${u.crushLevel} and no EntityFlag.Crusher`);
    }
    expect(
      dead,
      'either give the hull EntityFlag.Crusher (here or on its Scenarios.ts fallback row) '
      + 'or set crushLevel to 0 — a level with no flag crushes nothing.',
    ).toEqual([]);
  });

  it('keeps every vehicle uncrushable, which is what crushableBy on a hull means', () => {
    // THE OTHER HALF OF THE SAME COLUMN. Fifteen hulls carry `crushableBy` 4-6
    // and it is read by nothing, because `Crush.ts` tests
    // `EntityFlag.Crushable` first and NO VEHICLE HAS IT. Those numbers
    // describe a vehicle-ramming rule nobody designed: implementing it would
    // let a Sledge delete a 420 hp Anvil on contact.
    //
    // The numbers are left as authored because each one is duplicated in
    // `Scenarios.FALLBACK_UNITS` and `data.spec.ts` asserts the two tables
    // agree field for field. This assertion is what stops that from being a
    // trap: the day a vehicle gains `Crushable`, fifteen dormant thresholds go
    // live at once and the balance pass has to happen first.
    for (const u of UNITS) {
      if (u.kind !== EntityKind.Vehicle) continue;
      expect(
        (u.flags & EntityFlag.Crushable) === 0,
        `"${u.key}" now carries EntityFlag.Crushable, which switches on its crushableBy of `
        + `${u.crushableBy} and every other hull's at the same time. That is a ram rule, and `
        + 'it needs designing and pricing before it needs a flag.',
      ).toBe(true);
    }
  });

  it('keeps every foot unit crushable, which is what makes the column live', () => {
    // The control. Without it the assertion above would pass on a roster where
    // crushing had been deleted outright.
    const foot = UNITS.filter((u) => u.kind === EntityKind.Infantry);
    expect(foot.length).toBeGreaterThan(8);
    for (const u of foot) {
      expect(u.crushableBy, `"${u.key}" must be crushable`).toBeGreaterThan(0);
    }
  });

  it('only puts needsPower on a weapon something can actually honour', () => {
    // `Combat.ts` gates firing in TWO tiers now. The universal one is the
    // entity alone — any structure that draws power and is dark cannot fire,
    // whatever its gun. `WeaponDef.needsPower` is the STRICTER second tier,
    // for electric guns that also refuse during any grid deficit rather than
    // only when the shed picked that particular tower, and it still requires
    // `EntityFlag.NeedsPower` on the entity — which is what this test is
    // about. Only structures ever get that flag
    // (`Scenarios.building()` and `mrdFlags`/`rclFlags` derive it from a
    // negative power draw), and `EntityFlag.Powered` is only ever written by
    // `PowerGrid.recompute`, which walks `byKind[EntityKind.Building]`. So a
    // UNIT carrying a needsPower weapon either ignores the flag (if it is the
    // only carrier, the flag is dead data) or shares the row with a structure
    // that does honour it.
    const SHARED_WITH_A_STRUCTURE: ReadonlySet<string> = new Set([
      // The Tesla Coil's gun, drawing -75 on a structure, and "Melts armour.
      // Dies in a brownout." is true of the coil. The War Commissar fires the
      // same row and is simply unaffected — stripping the flag to tidy the
      // sharing would switch the COIL on during a brownout, turning a real
      // defensive decision into a freebie.
      'teslaBolt',
    ]);
    const dead: string[] = [];
    for (const w of WEAPONS) {
      if (!w.needsPower) continue;
      if (SHARED_WITH_A_STRUCTURE.has(w.key)) continue;
      const carriers = ALL_DEFS.filter((d) => weaponsOf(d).some((i) => WEAPONS[i] === w));
      const structural = carriers.filter((d) => BUILDINGS.includes(d as BuildingDef));
      if (carriers.length > 0 && structural.length === 0) {
        dead.push(
          `"${w.key}" is needsPower but is carried only by `
          + `${carriers.map((c) => c.key).join(', ')} — no structure, so nothing can be dark`,
        );
      }
    }
    expect(
      dead,
      'a hull cannot brown out. Either move the weapon to an emplacement, or drop needsPower '
      + 'and correct whatever blurb promised it.',
    ).toEqual([]);
  });
});

/* ==========================================================================
 * 4. A BLURB IS A PROMISE
 *
 * "Dies in a brownout" on the Zenith Emitter, "Needs the grid" on the Glaive
 * Post. One was unimplementable and one was simply not implemented, and both
 * are the first thing a player reads about the unit.
 * ========================================================================== */

/** Phrases that promise the def stops working when the grid fails. */
const BROWNOUT_CLAIM = /brownout|needs the grid|goes dark|dark in a|off the grid/i;
/** Phrases that promise the opposite. */
const BLACKOUT_PROOF = /through a blackout|fires through|never goes dark/i;

describe('a blurb that names a power dependency has one', () => {
  it('backs every brownout claim with a structure and a needsPower weapon', () => {
    const lying: string[] = [];
    for (const d of ALL_DEFS) {
      if (!BROWNOUT_CLAIM.test(d.blurb)) continue;
      const isStructure = BUILDINGS.includes(d as BuildingDef);
      const gated = weaponsOf(d).some((i) => WEAPONS[i]?.needsPower === true);
      if (!isStructure) {
        lying.push(`"${d.key}" (${d.blurb}) is not a structure, so it can never lose power`);
      } else if (!gated) {
        lying.push(`"${d.key}" (${d.blurb}) has no needsPower weapon — it fires in a blackout`);
      } else if ((d as BuildingDef).power >= 0) {
        lying.push(`"${d.key}" draws no power, so EntityFlag.NeedsPower is never set on it`);
      }
    }
    expect(lying, 'the blurb is the first thing a player reads. Make it true or change it.').toEqual([]);
  });

  it('backs every blackout-proof claim by really having no needsPower weapon', () => {
    // The converse, and it is not decoration: `rclSpitpost` says "Fires through
    // a blackout" and that is a deliberate contrast with the Pact's Glaive
    // Post, which now genuinely does go dark. If someone gated `postCoil` the
    // Reclamation would silently lose its stated identity.
    for (const d of ALL_DEFS) {
      if (!BLACKOUT_PROOF.test(d.blurb)) continue;
      for (const i of weaponsOf(d)) {
        expect(WEAPONS[i].needsPower, `"${d.key}" (${d.blurb}) fires ${WEAPONS[i].key}`).toBe(false);
      }
    }
  });

  it('finds the two claims it was written for', () => {
    // A regex gate that matches nothing passes forever. These two defs are the
    // reason the section exists, so they must keep being found.
    const glaive = BUILDINGS.find((b) => b.key === 'mrdGlaive')!;
    const spitpost = BUILDINGS.find((b) => b.key === 'rclSpitpost')!;
    expect(BROWNOUT_CLAIM.test(glaive.blurb), 'mrdGlaive').toBe(true);
    expect(BLACKOUT_PROOF.test(spitpost.blurb), 'rclSpitpost').toBe(true);
  });
});

/* ==========================================================================
 * 5. EVERY AUTHORED WEAPON ROW IS EITHER FIRED OR DECLARED
 * ========================================================================== */

/**
 * Rows in the sim's own armoury that no shipped def fires, with the reason.
 *
 * Both are still REACHABLE — `CONTENT_WEAPON` in `src/sim/combat.system.ts`
 * resolves a weapon by content key before the def tables bind — so they are
 * rows the fallback path serves and the roster does not.
 */
const UNFIRED_ROWS: Readonly<Record<string, string>> = {
  chaingun:
    'The Sabre IFV\'s old gun, at 115.8 raw dps the most over-scaled row in the game. '
    + 'Replaced by `ifvChaingun` in Defs.ts#REBALANCE_WEAPONS. It could not be retuned in place '
    + 'because this table borrows DEFAULT_WEAPONS verbatim as its prefix and does not own it.',
};

describe('the armoury', () => {
  it('has a written reason for every row no def fires', () => {
    const fired = new Set<number>();
    for (const d of ALL_DEFS) for (const i of weaponsOf(d)) fired.add(i);

    const unexplained: string[] = [];
    for (let i = 0; i < WEAPONS.length; i++) {
      if (fired.has(i)) continue;
      const key = WEAPONS[i].key;
      if (UNFIRED_ROWS[key] === undefined) {
        unexplained.push(`${i}:${key}`);
      }
    }
    expect(
      unexplained,
      'an authored weapon nothing fires is content that cost real work and reaches no player. '
      + 'Give it a carrier, or add it to UNFIRED_ROWS with the reason it has none.',
    ).toEqual([]);
  });

  it('still finds every declared unfired row genuinely unfired', () => {
    // A list of excuses that nobody re-checks is how the superweapon gap
    // survived a whole release. If one of these gets a carrier, say so.
    const fired = new Set<string>();
    for (const d of ALL_DEFS) for (const i of weaponsOf(d)) fired.add(WEAPONS[i].key);
    for (const key of Object.keys(UNFIRED_ROWS)) {
      expect(fired.has(key), `"${key}" is declared unfired but a def now carries it`).toBe(false);
    }
  });

  it('keeps every unfired row reachable on the pre-content fallback path', () => {
    // The distinction between "documented" and "dead". `CONTENT_WEAPON` is what
    // arms a unit whose def table has not bound, so a row named there is still
    // doing work under the `?shot=` harness and in every unit test.
    const fallback = at('apps/game/src/sim/combat.system.ts');
    for (const key of Object.keys(UNFIRED_ROWS)) {
      expect(fallback, `"${key}" is fired by nothing and named by nothing`).toContain(`'${key}'`);
    }
  });

  it('keeps the sim armoury as an exact prefix, by identity', () => {
    // Restated here because every appended block above depends on it, and a row
    // INSERTED into DEFAULT_WEAPONS would re-arm the whole game silently.
    for (let i = 0; i < DEFAULT_WEAPONS.length; i++) {
      expect(WEAPONS[i], `weapon row ${i}`).toBe(DEFAULT_WEAPONS[i]);
    }
  });
});

/* ==========================================================================
 * 6. THE SABRE IFV, PINNED
 *
 * Not a general balance test — those belong to a designer, not a spec file.
 * This pins the two specific claims that made the IFV a defect: it topped four
 * of the six armour columns per credit, and it beat a main battle tank 1v1
 * while being cheaper, faster and longer-sighted.
 * ========================================================================== */

const cycleOf = (i: number): number =>
  WEAPONS[i].cooldown + Math.max(0, WEAPONS[i].burstCount - 1) * WEAPONS[i].burstDelay;
const rawDpsOf = (i: number): number => (WEAPONS[i].damage * WEAPONS[i].burstCount) / cycleOf(i);
const effDpsOf = (i: number, armor: number): number =>
  rawDpsOf(i) * ARMOR_MATRIX[WEAPONS[i].warhead as number][armor];

/** Seconds for `a` to kill `b`, first weapon only, no veterancy. */
function timeToKill(a: UnitDef, b: UnitDef): number {
  return b.maxHp / effDpsOf(a.weapons[0], b.armor as number);
}

const unitByKey = (key: string): UnitDef => {
  const u = UNITS.find((x) => x.key === key);
  expect(u, `no unit "${key}"`).toBeDefined();
  return u!;
};

describe('the Sabre IFV', () => {
  it('loses a straight fight with a Warden', () => {
    // WAS 4.52 s against the Warden's 7.06 s — a 600-credit raider deleting a
    // 700-credit main battle tank. The margin is asserted, not just the sign:
    // a rank-1 promotion is +15% damage, so a duel decided by 3% is not decided.
    const ifv = unitByKey('ifv');
    const grizzly = unitByKey('grizzly');
    const ifvKills = timeToKill(ifv, grizzly);
    const tankKills = timeToKill(grizzly, ifv);
    expect(ifvKills, `IFV ${ifvKills.toFixed(2)}s vs Warden ${tankKills.toFixed(2)}s`)
      .toBeGreaterThan(tankKills * 1.1);
  });

  it('is not the best unit per credit against Medium, Heavy or Concrete', () => {
    // ARMOUR CLASSES 2, 3 and 4. AutoCannon is [0.80, 1.00, 0.65, 0.35, 0.35]
    // — the anti-LIGHT row — so topping the other three columns meant the
    // multipliers were being outrun by raw damage rather than respected.
    const ifv = unitByKey('ifv');
    const armed = UNITS.filter((u) => u.weapons.length > 0);
    for (const armor of [2, 3, 4]) {
      const perCredit = (u: UnitDef): number => effDpsOf(u.weapons[0], armor) / u.cost;
      const mine = perCredit(ifv);
      const better = armed.filter((u) => u.key !== ifv.key && perCredit(u) > mine);
      expect(
        better.length,
        `the IFV is still top of armour class ${armor} per credit at `
        + `${(mine * 1000).toFixed(1)} dps/1000cr`,
      ).toBeGreaterThan(0);
    }
  });

  it('is still the Allied answer to a gunship', () => {
    // The rebalance cut damage and nothing else. An IFV that could not shoot up
    // would leave the Allies with `aaTurret`, `prismTower` and the Javelin —
    // two emplacements and a 3.0 m/s infantryman — against four aircraft.
    const ifv = unitByKey('ifv');
    expect(WEAPONS[ifv.weapons[0]].canTargetAir).toBe(true);
    expect(WEAPONS[ifv.weapons[0]].key).toBe('ifvChaingun');
  });

  it('still beats the raider it is the opposite number of', () => {
    // The Sandskiff is the Pact's `unit.raider`, and `arcRepeater` was cut in
    // the same pass for the same reason. The IFV pays 50 more credits for 30
    // more hp and must still win the trade, or the Allied raider is strictly
    // dominated and the fix has only moved the defect.
    const ifv = unitByKey('ifv');
    const skiff = unitByKey('mrdSkiff');
    expect(timeToKill(ifv, skiff)).toBeLessThan(timeToKill(skiff, ifv));
  });

  it('leaves the Sandskiff losing to a Warden too', () => {
    const skiff = unitByKey('mrdSkiff');
    const grizzly = unitByKey('grizzly');
    expect(timeToKill(skiff, grizzly)).toBeGreaterThan(timeToKill(grizzly, skiff) * 1.1);
  });
});

/* ==========================================================================
 * 7. A LOCKED SLOT SAYS WHICH MISSION
 *
 * `LOCKED_REASON` was the only thing a padlocked cameo ever said: "Locked —
 * complete a mission", for every gated def in the game. The player hovering a
 * Proving Ground was being asked to guess.
 * ========================================================================== */

describe('the locked reason', () => {
  it('names the mission for every gated def', () => {
    const gate = new UnlockGate(() => [], { unlockHints: UNLOCK_REQUIREMENTS });
    expect(gate.hasUnlockHints).toBe(true);

    for (const d of ALL_DEFS) {
      const id = (d as { unlockedBy?: string }).unlockedBy;
      if (id === undefined || id === '') continue;
      const reason = gate.reasonFor(d as { key: string; unlockedBy?: string });
      expect(reason, `"${d.key}" still falls back to the generic line`).not.toBe(LOCKED_REASON);
      expect(reason.startsWith('Locked — '), `"${d.key}": ${reason}`).toBe(true);
      // The mission's own title has to be in there, or the sentence names
      // something the missions screen does not.
      const src = unlockSource(id)!;
      expect(reason, `"${d.key}"`).toContain(src.title);
    }
  });

  it('reads as one sentence for the def the bug was reported against', () => {
    // The exact case: hover a Proving Ground, be told to complete "a mission".
    expect(UNLOCK_TAGS.battleLab).toBe(UNLOCKS.structTech);
    expect(unlockRequirementText(UNLOCKS.structTech))
      .toBe('Strip Mine: mine 70,000 credits of ore');

    const gate = new UnlockGate(() => [], { unlockHints: UNLOCK_REQUIREMENTS });
    const lab = BUILDINGS.find((b) => b.key === 'battleLab')!;
    expect(gate.reasonFor(lab)).toBe('Locked — Strip Mine: mine 70,000 credits of ore');
  });

  it('falls back to the generic line rather than inventing one', () => {
    // A gate with no hints (every unit test, and the sim if nobody injects) and
    // an id nothing pays must both give the old constant, not a half-sentence.
    const bare = new UnlockGate(() => []);
    expect(bare.reasonFor({ key: 'x', unlockedBy: 'unit.raider' })).toBe(LOCKED_REASON);
    const hinted = new UnlockGate(() => [], { unlockHints: UNLOCK_REQUIREMENTS });
    expect(hinted.reasonFor({ key: 'x', unlockedBy: 'no.such.id' })).toBe(LOCKED_REASON);
  });

  it('says nothing at all about a def the player can build', () => {
    const gate = new UnlockGate(() => [UNLOCKS.structTech], { unlockHints: UNLOCK_REQUIREMENTS });
    expect(gate.reasonFor(BUILDINGS.find((b) => b.key === 'battleLab')!)).toBe('');
    expect(gate.reasonFor(BUILDINGS.find((b) => b.key === 'powerPlant')!)).toBe('');
  });
});

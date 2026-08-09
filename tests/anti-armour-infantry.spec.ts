/**
 * THE SQUARE THAT WAS EMPTY, AND THE FIVE TABLES A UNIT HAS TO APPEAR IN.
 *
 * Reported as "why don't normal troops shoot vehicles?". They did shoot; the
 * answer was that they could not hurt what they were shooting and the targeting
 * layer knew it. `ARMOR_MATRIX`'s SmallArms row is 0.10 against Heavy, every
 * buildable Allied and Soviet foot soldier fired SmallArms, and
 * `COMBAT_TARGETING.ineffective` correctly refuses to aim a rifle at a tank
 * while any softer target is in reach. Two of the four armies therefore had no
 * infantry answer to armour at all — the Pact has the Sunlancer and the
 * Reclamation's basic rifleman carries a Tesla arc, so only the two ORIGINAL
 * armies had the hole, which is why it survived two factions being added.
 *
 * §1 is the invariant that was violated. It is deliberately written about the
 * WHOLE roster rather than about the Javelin and the Flak Trooper, so it keeps
 * holding for the fifth army.
 *
 * §2 is the wiring. Adding these two units meant touching five parallel tables
 * and exactly one of the five had nothing policing it — `PRODUCTION_CONTENT`.
 * The symptom was not a missing unit: it was the AI reporting "no production
 * catalog — commands cannot name a buildable" and refusing to build ANYTHING,
 * with a fully-bound def table sitting right next to it.
 *
 * §3 is the balance property that makes a counter a counter instead of an
 * upgrade, and §4 pins the art bindings that were already rotting.
 */

import { describe, it, expect } from 'vitest';

import { BUILDINGS, UNITS, WEAPONS } from '../src/data/Defs';
import { FALLBACK_UNITS } from '../src/game/Scenarios';
import { PRODUCTION_CONTENT, BuildKind } from '../src/sim/Production';
import { FALLBACK_CATALOG } from '../src/sim/AIStrategy';
import { CAMEO_UNIT_MODELS } from '../src/ui/Cameos';
import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import { ARMOR_MATRIX, COMBAT_TARGETING } from '../src/core/config';
import { ArmorClass, EntityKind, Faction } from '../src/core/types';
import type { UnitDef, WeaponDef } from '../src/core/types';

const weaponOf = (u: UnitDef): WeaponDef | undefined =>
  u.weapons.length > 0 ? WEAPONS[u.weapons[0]] : undefined;

/** The multiplier read straight off the shipped table, not through the sim's mutable copy. */
const mult = (w: WeaponDef, a: ArmorClass): number => ARMOR_MATRIX[w.warhead as number][a as number];

/** Sustained raw damage per second, burst timing included. */
function rawDps(w: WeaponDef): number {
  const shots = Math.max(1, w.burstCount);
  const cycle = w.cooldown + (shots - 1) * w.burstDelay;
  return (w.damage * shots) / cycle;
}

/** Armies with a real roster. Neutral owns engineers and scenery, not a doctrine. */
const ARMIES: readonly Faction[] = [
  Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim,
];

/**
 * `Faction` is a `const enum`, so `Faction[f]` — the reverse map — is a compile
 * error under `isolatedModules`, which this repo sets. Writing the names out is
 * the whole fix; they are only ever test labels.
 */
const ARMY_NAME: Readonly<Record<number, string>> = {
  [Faction.Allies]: 'Allies',
  [Faction.Soviets]: 'Soviets',
  [Faction.Meridian]: 'Meridian',
  [Faction.Reclaim]: 'Reclaim',
};

const armedInfantry = (f: Faction): UnitDef[] => UNITS.filter(
  (u) => u.faction === f
    && u.kind === EntityKind.Infantry
    && u.weapons.length > 0
    // Heroes are capped at one alive and cannot be a doctrine's answer to
    // anything; `maxAlive` is how the def table says so.
    && u.maxAlive === 0,
);

describe('§1 every army answers a main battle tank on foot', () => {
  /**
   * MEDIUM, not Heavy, and the threshold is not a taste call — it is the exact
   * constant the targeting layer branches on.
   *
   * `Targeting.acquire` multiplies a candidate's score by
   * `COMBAT_TARGETING.ineffective` when the matchup is AT OR BELOW
   * `ineffectiveBelow`. SmallArms scores 0.28 against Medium, so every rifle in
   * the game trips it, and the arithmetic that follows is what the player
   * actually sees: against an enemy rifleman standing at the EDGE of a G.I.'s
   * 18 m range, a tank has to come within 2.2 m to out-score him. Not "prefers
   * infantry" — will not turn around at all. Even `retaliation` (1.5x) fails to
   * overcome a 0.35x cut, so a G.I. being shot by the tank still looks away.
   *
   * So "can this army's infantry FIGHT a tank" is not a damage question first.
   * It is `mult > ineffectiveBelow`, and anything at or under that number is a
   * unit the player will watch stand still.
   */
  it.each(ARMIES.map((f) => [ARMY_NAME[f], f] as const))(
    '%s has infantry that will aim at a Medium hull', (_name, faction) => {
      const willAim = armedInfantry(faction).filter(
        (u) => mult(weaponOf(u)!, ArmorClass.Medium) > COMBAT_TARGETING.ineffectiveBelow);
      expect(
        willAim.map((u) => u.key),
        `${ARMY_NAME[faction]} has no non-hero infantryman scoring above ` +
        `${COMBAT_TARGETING.ineffectiveBelow} against Medium armour, so COMBAT_TARGETING.ineffective ` +
        'deprioritises every tank for every soldier this army can build. That is the defect ' +
        'reported as "why don\'t normal troops shoot vehicles".',
      ).not.toEqual([]);
    });

  it('and out-damages its own line rifle there, which is the point of building one', () => {
    for (const [at, line] of [['javelin', 'gi'], ['flakTrooper', 'conscript']] as const) {
      const a = weaponOf(UNITS.find((u) => u.key === at)!)!;
      const l = weaponOf(UNITS.find((u) => u.key === line)!)!;
      expect(rawDps(a) * mult(a, ArmorClass.Medium), at)
        .toBeGreaterThan(rawDps(l) * mult(l, ArmorClass.Medium));
    }
  });

  it('leaves the LINE infantryman ineffective, which is the other half of the rule', () => {
    // If the line rifle ever answered armour, §1 above would pass for the wrong
    // reason and the counter-triangle would be flat. Both facts are load-bearing.
    for (const key of ['gi', 'conscript']) {
      const u = UNITS.find((d) => d.key === key)!;
      expect(mult(weaponOf(u)!, ArmorClass.Heavy), key).toBeLessThan(0.2);
      expect(mult(weaponOf(u)!, ArmorClass.Medium), key)
        .toBeLessThanOrEqual(COMBAT_TARGETING.ineffectiveBelow);
    }
  });
});

describe('§1b who answers HEAVY armour on foot, and who deliberately does not', () => {
  /**
   * An explicit, listed asymmetry — the same mechanism §4 uses for orphan art,
   * and for the same reason: an army missing from this list should be a
   * DECISION someone made, not a thing nobody noticed.
   *
   * The Soviets are the deliberate absence. `flakBurst` is 0.35 against Heavy,
   * which is exactly `ineffectiveBelow`, so a Flak Trooper will chip a Rhino
   * but will not prioritise one — and that is the faction's thesis stated in
   * mechanics: the Soviet answer to heavy armour is heavier armour. They get
   * Light (1.00) and Medium (0.65) instead, which is what actually closes the
   * reported complaint for them.
   *
   * 0.5 sits in a gap the matrix leaves wide open: the warheads that answer
   * Heavy score 0.90-1.00 (AP, Rocket, Tesla, Prism) and the ones that do not
   * score 0.10 and 0.35. Nothing is near 0.5, so this cannot flip on a retune.
   */
  const ANSWERS_HEAVY = 0.5;
  const EXPECTED: Readonly<Record<string, boolean>> = {
    Allies: true,      // javelin -> rocketLauncher, Rocket 0.95
    Soviets: false,    // flakTrooper -> flakBurst, AutoCannon 0.35 — on purpose
    Meridian: true,    // mrdLancer -> sunLance, Rocket 0.95
    Reclaim: true,     // rclPicker -> arcProd, Tesla 0.90 (the LINE rifleman)
  };

  it('matches the doctrine each faction was authored with', () => {
    const actual: Record<string, boolean> = {};
    for (const f of ARMIES) {
      actual[ARMY_NAME[f]] = armedInfantry(f).some(
        (u) => mult(weaponOf(u)!, ArmorClass.Heavy) >= ANSWERS_HEAVY);
    }
    expect(actual).toEqual(EXPECTED);
  });
});

describe('§2 a unit is only real once all five tables carry it', () => {
  /**
   * The seam that broke. `ProductionCatalog` is keyed on `PRODUCTION_CONTENT`
   * and the def binding only supplies ids for keys already in it, so a def-only
   * unit is `catalog.byKey(...) === null` -> `bindOracle` skips it -> the AI's
   * entry keeps `defId -1` -> `AiBrain.available()` reports "no production
   * catalog" and the brain stops building anything at all.
   */
  it('gives every produced unit a production content row', () => {
    const contentKeys = new Set(
      PRODUCTION_CONTENT.filter((c) => c.kind === BuildKind.Unit).map((c) => c.key));
    const produced = new Set(BUILDINGS.flatMap((b) => b.produces));
    const missing = [...produced].filter((k) => !contentKeys.has(k));
    expect(
      missing,
      'these units are named in a building\'s `produces` and in the def table but have no ' +
      'PRODUCTION_CONTENT row, so nothing can ever order one and the AI reports ' +
      '"no production catalog"',
    ).toEqual([]);
  });

  /**
   * The AI has no naval layer: nothing in `AI.ts` scores a shore, picks a
   * slipway or escorts anything, so every hull below is authored content the
   * brain cannot ever want. That is a real gap, not an oversight in this test,
   * and listing it here is the only thing that keeps it from growing by
   * accident — a NEW key falling in here fails.
   */
  const NO_AI_DOCTRINE: readonly string[] = [
    'transport', 'gunboat', 'destroyer', 'submarine', 'dreadnought',
    'mrdCorvette', 'mrdMonitor', 'rclScow', 'rclHulk',
  ];

  it('gives every produced unit a spawn fallback and a cameo', () => {
    const produced = [...new Set(BUILDINGS.flatMap((b) => b.produces))];
    const gaps: string[] = [];
    for (const k of produced) {
      // `Production.spawnUnit` reads FALLBACK_UNITS BEFORE the def table and
      // returns NONE without a row: the unit builds, bills the player, hits
      // 100% and never walks out.
      if (FALLBACK_UNITS[k] === undefined) gaps.push(`${k}: no FALLBACK_UNITS row`);
      if (CAMEO_UNIT_MODELS[k] === undefined) gaps.push(`${k}: no CAMEO_UNIT_MODELS binding`);
    }
    expect(gaps).toEqual([]);
  });

  it('gives every land unit an AI catalog entry', () => {
    const catalogKeys = new Set(FALLBACK_CATALOG.map((e) => e.key));
    const produced = [...new Set(BUILDINGS.flatMap((b) => b.produces))];
    const missing = produced.filter(
      (k) => !catalogKeys.has(k) && !NO_AI_DOCTRINE.includes(k));
    expect(
      missing,
      'the AI cannot name these in a ProductionStart, so it will never build one',
    ).toEqual([]);
    // And the converse, so the list above shrinks rather than drifts.
    expect(NO_AI_DOCTRINE.filter((k) => catalogKeys.has(k))).toEqual([]);
  });

  it('agrees on cost and gate across the def table, production and the AI', () => {
    for (const key of ['javelin', 'flakTrooper']) {
      const def = UNITS.find((u) => u.key === key)!;
      const content = PRODUCTION_CONTENT.find((c) => c.key === key)!;
      const entry = FALLBACK_CATALOG.find((e) => e.key === key)!;
      expect(content.cost, `${key} production cost`).toBe(def.cost);
      expect(content.buildTime, `${key} production build time`).toBe(def.buildTime);
      expect([...content.prereqs], `${key} production prereqs`).toEqual([...def.prereqs]);
      expect(entry.cost, `${key} AI cost`).toBe(def.cost);
      expect([...entry.prereqs], `${key} AI prereqs`).toEqual([...def.prereqs]);
      expect(entry.faction, `${key} AI faction`).toBe(def.faction);
    }
  });
});

describe('§3 the counter is a counter, not an upgrade', () => {
  const pairs = [
    { at: 'javelin', line: 'gi' },
    { at: 'flakTrooper', line: 'conscript' },
  ] as const;

  it.each(pairs)('$at beats $line on armour and loses to it on flesh', ({ at, line }) => {
    const a = weaponOf(UNITS.find((u) => u.key === at)!)!;
    const l = weaponOf(UNITS.find((u) => u.key === line)!)!;

    const dps = (w: WeaponDef, c: ArmorClass): number => rawDps(w) * mult(w, c);

    // The whole reason the unit exists. Medium and Heavy are the two columns
    // where SmallArms falls off its cliff (0.28 and 0.10), so they are the two
    // the counter has to win.
    expect(dps(a, ArmorClass.Heavy)).toBeGreaterThan(dps(l, ArmorClass.Heavy) * 2);
    expect(dps(a, ArmorClass.Medium)).toBeGreaterThan(dps(l, ArmorClass.Medium));

    // LIGHT IS DELIBERATELY NOT ASSERTED, and the reason is worth writing down
    // because it looks like a gap. SmallArms is still 0.55 against Light, so
    // volume beats warhead there: a G.I. puts 28.8 dps into an IFV and a
    // Javelin only 20.9, because a rocket every 2.5 s cannot out-shoot a
    // three-round burst every 1.03 s no matter what it is made of. The Flak
    // Trooper DOES win that column (autocannon, 1.00 vs Light) — which is the
    // whole difference between the two units, and asserting a shared rule here
    // would erase it.

    // The price. Without this an army just builds these instead of riflemen and
    // the infantry tab collapses to one unit.
    expect(dps(a, ArmorClass.Infantry)).toBeLessThan(dps(l, ArmorClass.Infantry));
  });

  it('elevates, because a shoulder launcher and a flak gun both point up', () => {
    for (const key of ['javelin', 'flakTrooper']) {
      expect(weaponOf(UNITS.find((u) => u.key === key)!)!.canTargetAir, key).toBe(true);
    }
  });

  it('keeps both of them crushable', () => {
    // The counter to the counter. A Javelin out-ranges a Rhino's gun by a metre;
    // what stops that being free is that the Rhino can simply drive over him.
    for (const key of ['javelin', 'flakTrooper']) {
      expect(UNITS.find((u) => u.key === key)!.crushableBy, key).toBe(1);
    }
  });
});

describe('§4 art that is built but never drawn', () => {
  /**
   * `soviet_flak` sat in `UNIT_MASS_LISTS` — merged, validated and paid for on
   * every boot — bound to no content key at all, while `Hud.FALLBACK_ROSTER`
   * advertised a Flak Trooper the game could not build. It was never a missing
   * model; it was a missing line in two tables.
   *
   * These four are the ones still in that state. The list is EXPLICIT so it can
   * only shrink on purpose: a new orphan fails here instead of quietly costing
   * geometry forever.
   */
  const KNOWN_ORPHANS: readonly string[] = [
    'allied_vindicator', 'soviet_mig',   // aircraft, no def rows yet
    'soviet_sickle', 'soviet_v4',        // in the HUD's fallback roster, nowhere else
  ];

  it('has no unbound unit model outside the known list', () => {
    const bound = new Set<string>();
    for (const v of Object.values(CAMEO_UNIT_MODELS)) {
      if (typeof v === 'string') bound.add(v);
      else { bound.add(v[0]); bound.add(v[1]); }
    }
    const orphans = UNIT_MASS_LISTS.map((l) => l.key).filter((k) => !bound.has(k));
    expect(orphans.slice().sort()).toEqual(KNOWN_ORPHANS.slice().sort());
  });

  it('draws the Flak Trooper and the Javelin from their own models', () => {
    expect(CAMEO_UNIT_MODELS.flakTrooper).toBe('soviet_flak');
    expect(CAMEO_UNIT_MODELS.javelin).toBe('allied_javelin');
    for (const k of ['soviet_flak', 'allied_javelin']) {
      expect(UNIT_MASS_LISTS.some((l) => l.key === k), k).toBe(true);
    }
  });
});

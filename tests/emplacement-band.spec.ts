/**
 * ============================================================================
 * tests/emplacement-band.spec.ts — how hard a static gun is allowed to hit
 * ============================================================================
 * WHY THIS FILE EXISTS
 * --------------------
 * Reported, verbatim: *"Gunner stations should be a less powerfull, one can
 * destroy a full army in a second"*, alongside *"In general, killing and dying
 * feels too fast in game"*. Both are TIME-TO-KILL claims, and neither had a
 * number attached to it anywhere in the tree. This file is that number.
 *
 * Nothing here re-derives balance from taste. Every figure below was measured
 * off the shipped tables — `WEAPONS`, `UNITS`, `BUILDINGS`, `ARMOR_MATRIX` —
 * with the same firing-cycle model `sim/Combat.ts#fire` implements:
 *
 *     burstCount > 1   cycle = (burstCount - 1) * burstDelay + cooldown
 *                      damage per cycle = burstCount * damage
 *     burstCount == 1  cycle = cooldown, damage per cycle = damage
 *
 * `burstDelay` is deliberately excluded from the veterancy/upgrade cooldown
 * scaling in that function, so it is a constant of the row and belongs in the
 * cycle exactly as written.
 *
 * THE MEASUREMENT THAT STARTED IT
 * -------------------------------
 * Anti-infantry dps of every defensive emplacement in the game
 * (`ARMOR_MATRIX[SmallArms][Infantry]` is 1.00, so for the MG posts the raw
 * number IS the anti-infantry number):
 *
 *     Glaive Post      450 cr   5 x 21 / 0.69 s   152.2      338 dps/1000cr
 *     Pillbox          400 cr   5 x 20 / 0.69 s   144.9      362 dps/1000cr
 *     Sentry Gun       400 cr   5 x 20 / 0.69 s   144.9      362 dps/1000cr
 *     Multigunner AA   800 cr   3 x 34 / 0.82 s    99.5      124 dps/1000cr
 *     Tesla Coil      1500 cr   1 x 120 / 2.40 s   80.0       53 dps/1000cr
 *     Arc Pylon       1450 cr   1 x 94 / 2.20 s    68.4       47 dps/1000cr
 *     Spitpost         420 cr   1 x 34 / 0.85 s    64.0      152 dps/1000cr
 *     Flame Tower      600 cr   1 x 26 / 0.50 s    46.8       78 dps/1000cr
 *     Helios Spire    1500 cr   1 x 116 / 2.80 s   45.6       30 dps/1000cr
 *     Prism Tower     1500 cr   1 x 115 / 3.00 s   42.2       28 dps/1000cr
 *
 * The two cheapest emplacements in the game are the two highest-dps rows in the
 * whole 42-row armoury, and they are 7-12x the credit efficiency of the towers
 * they are meant to be the budget version of.
 *
 * WHERE THE BAND COMES FROM — AN EIGHT-MAN SQUAD MUST BE ABLE TO TRADE
 * -------------------------------------------------------------------
 * The felt complaint is a squad walking into a post and evaporating, so the
 * bound is derived from that engagement rather than from a dps that looks nice.
 *
 * A post kills a squad ONE MAN AT A TIME (no splash on any MG row), so its
 * output is flat while the squad's decays a man at a time. With `D` = the
 * post's anti-infantry dps, `H` = a rifleman's HP and `r` = one rifleman's dps
 * against `ArmorClass.Concrete`, a man falls every `k = H / D` seconds and the
 * squad lands
 *
 *     r * k * (8 + 7 + 6 + 5 + 4 + 3 + 2 + 1)  =  36 * r * k
 *
 * before the last one dies. Setting that equal to the post's HP is the point at
 * which eight riflemen and one emplacement trade evenly. For the Allied pair —
 * G.I. 120 hp, `rifle` 52.4 raw, `ARMOR_MATRIX[SmallArms][Concrete]` 0.18 so
 * r = 9.43 dps, Pillbox 500 hp:
 *
 *     36 * 9.43 * (120 / D) = 500   ->   D = 81.5 dps
 *
 * At the shipped 144.9 the squad dies having dealt 282 of 500 — eight men, and
 * the box keeps 44% of its health. That is the report.
 *
 * THE BAND IS PRICE-NORMALISED, AND THAT IS NOT A CONVENIENCE
 * -----------------------------------------------------------
 * 81.5 dps on a 400-credit box is 204 dps per 1000 credits, and `BAND_MAX` is
 * that rounded to 210. An absolute dps ceiling was tried first and it indicted
 * the 800-credit Multigunner AA at 99.5, which is wrong: that structure costs
 * twice what a Pillbox does and buys 124 dps/1000cr, a third of the Pillbox's
 * 362. Cost IS power in an RTS, and `REBALANCE_WEAPONS`' own argument for
 * re-authoring the IFV's gun was made in exactly these units ("dps per 1000
 * credits, best in the whole roster among VEHICLES against Light (193) …").
 *
 * Checked against the rest of the roster the band leaves the Spitpost (152),
 * the Flame Tower (78), the Multigunner AA (124) and all four heavy towers
 * (28-53) inside, so it describes the emplacements that were always fine rather
 * than being reverse-engineered from the two that are not.
 *
 * ONE HONEST LIMIT OF THE MODEL. The squad derivation assumes the post kills
 * SEQUENTIALLY, one target at a time, which is true of every MG row and of the
 * beams. It under-states the Spitpost and the Arc Pylon, whose `chainCount`
 * spreads a fraction of each bolt onto neighbours (x1.60 and x2.18 of the
 * primary summed over the arc), and it under-states the Flame Tower, whose
 * 3.2 m splash lands on a clump. Those three are far enough inside the band
 * that the difference does not change the verdict; a new chained or splashing
 * emplacement near the ceiling would need this arithmetic redone.
 *
 * THE SECOND RULE IS ABOUT THE TRIGGER PULL, NOT THE DPS
 * -----------------------------------------------------
 * Five rounds leave a `pillboxMg` in 0.24 s. ONE pull is 100 damage, which is
 * the entire HP of a Conscript and more than a Scrap Picker's — so a burst was
 * a man, and the pulls arrive 1.45 times a second. A dps ceiling alone cannot
 * express that: a slow gun can sit inside the band and still one-shot a
 * rifleman.
 *
 * BUT ONE-SHOTTING IS NOT THE DEFECT — ONE-SHOTTING TWICE A SECOND IS. The
 * first version of this rule forbade a pull that deletes a line infantryman
 * outright, and it correctly indicted the MG posts and then went on to indict
 * all four heavy towers, which is nonsense: a 1500-credit beam that vaporises
 * a rifleman is exactly what a Prism Tower is FOR. What separates them is the
 * clock. The towers pull once every 2.2-3.0 s; the MG posts pull every 0.69 s.
 * So the rule is `MIN_ONE_SHOT_CYCLE`: an emplacement whose single pull kills a
 * line infantryman outright must wait at least 1.2 s before it can do it again.
 * The four towers clear that floor by 1.8x to 2.5x, so it too describes the
 * emplacements that were always fine.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It does not assert a GLOBAL time-to-kill. That was measured too — MBT mirror
 * duels run 8.6-10.8 s and line-infantry mirrors 2.0-2.4 s — and the only two
 * levers that move it uniformly are both fenced by exact-arithmetic assertions
 * in files a data change may not reach:
 *
 *   - raising HP: `tests/data.spec.ts` pins every `def.maxHp` to
 *     `Scenarios.FALLBACK_UNITS` / `FALLBACK_BUILDINGS` field for field, so it
 *     cannot be done from `src/data/Defs.ts` alone.
 *   - cutting damage: `tests/combat.spec.ts` pins
 *     `armorMultiplier(SmallArms, Infantry)` to exactly 1 and asserts a
 *     delivered hit equals `raw * armorMultiplier(...)` with no third term, so
 *     neither a scaled `ARMOR_MATRIX` nor a scalar in `Damage.applyOne`
 *     survives it.
 *
 * A band nobody can currently satisfy would be a red gate, and a band written
 * around the fence would be a number chosen by a test rather than by a
 * measurement. So the global figure stays a measurement and this file stays
 * about the emplacements.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { BUILDINGS, UNITS, WEAPONS } from '../src/data/Defs';
import { ARMOR_MATRIX } from '../src/core/config';
import { ArmorClass, BuildTab, WarheadClass } from '../src/core/types';
import type { BuildingDef, WeaponDef } from '../src/core/types';

/* ==========================================================================
 * THE MODEL — `sim/Combat.ts#fire`, and nothing else
 * ========================================================================== */

/** Seconds between the first round of one trigger pull and the first of the next. */
function cycleSeconds(w: WeaponDef): number {
  return w.burstCount > 1 ? (w.burstCount - 1) * w.burstDelay + w.cooldown : w.cooldown;
}

/** Damage one whole trigger pull puts downrange, before the armour matrix. */
function burstDamage(w: WeaponDef): number {
  return w.damage * (w.burstCount > 1 ? w.burstCount : 1);
}

/** Sustained damage per second before the armour matrix. */
function rawDps(w: WeaponDef): number {
  return burstDamage(w) / cycleSeconds(w);
}

/** Sustained damage per second against one target of `armor`. */
function dpsAgainst(w: WeaponDef, armor: ArmorClass): number {
  return rawDps(w) * ARMOR_MATRIX[w.warhead as number][armor as number];
}

const weaponByKey = new Map<string, WeaponDef>(WEAPONS.map((w) => [w.key, w]));
const buildingByKey = new Map<string, BuildingDef>(BUILDINGS.map((b) => [b.key, b]));

function weaponOfKey(key: string): WeaponDef {
  const w = weaponByKey.get(key);
  expect(w, `no weapon "${key}" in the armoury`).toBeDefined();
  return w as WeaponDef;
}

/** The first (and only, per `Combat.ts`) weapon a def actually fires. */
function firedWeapon(d: { weapons: readonly number[] }): WeaponDef | undefined {
  return d.weapons.length > 0 ? WEAPONS[d.weapons[0]] : undefined;
}

/* ==========================================================================
 * THE BAND
 * ========================================================================== */

/**
 * Ceiling on anti-infantry dps per 1000 credits for a defensive emplacement.
 * Derived in the header from the eight-man-squad trade: 81.5 dps on the
 * 400-credit Pillbox is 204 per 1000, rounded to 210.
 */
const BAND_MAX = 210;

/** Above this cost a structure is a heavy tower and buys its output honestly. */
const CHEAP_EMPLACEMENT_MAX_COST = 1600;

/** HP of the four armies' line infantry, and the input to both rules. */
const LINE_INFANTRY: readonly (readonly [string, number])[] = [
  ['gi', 120], ['conscript', 100], ['mrdWayfarer', 110], ['rclPicker', 85],
];

/**
 * Seconds an emplacement whose single trigger pull outright kills a line
 * infantryman must wait before it may do so again. The heavy towers, which are
 * supposed to do exactly this, sit at 2.20-3.00 s.
 */
const MIN_ONE_SHOT_CYCLE = 1.2;

/**
 * ROWS THAT EXCEED THE BAND, WITH THE REASON THEY STILL DO.
 *
 * The same shape as `UNFIRED_ROWS` in `tests/content-truthful.spec.ts` and for
 * the same reason: an exception has to be typed out next to its cause, in a
 * place that is read, instead of being silent. Two tests below, and BOTH
 * directions matter — a new exceeder fails the first, and fixing a declared one
 * fails the second, so nobody can land half of this and walk away.
 */
const OVER_BAND: Readonly<Record<string, string>> = {
  /*
   * EMPTY, AND IT GOT THAT WAY BY THE TEST BELOW DEMANDING IT.
   *
   * This table shipped for one commit holding `pillboxMg` and `glaiveRepeater`,
   * because the Pillbox row lives in `DEFAULT_WEAPONS[11]` in `src/sim/Combat.ts`
   * and was out of reach at the time, and the Glaive could not be taken to the
   * band alone — a Pact post at 82 dps against an Allied post at 145 fixes one
   * army by breaking three. Both entries said "the pair must move together".
   *
   * They then moved together:
   *
   *     pillboxMg       5 x 20 / 0.69 s = 144.9 dps  ->  5 x 13 / 0.79 s = 82.3
   *     glaiveRepeater  5 x 21 / 0.69 s = 152.2 dps  ->  5 x 12 / 0.79 s = 75.9
   *
   * and the second test below went red saying "declared over the band but is now
   * inside it — delete its OVER_BAND entry", which is the half of the design
   * that stops a declared exception outliving its cause. It is kept as an empty
   * table rather than deleted so the next exceeder has somewhere to be written
   * down, next to the rule it breaks.
   */
};

/* ==========================================================================
 * 1. THE BAND ITSELF
 * ========================================================================== */

describe('the emplacement band', () => {
  /** Every Defense-tab structure that actually has a gun. */
  const emplacements = BUILDINGS.filter(
    (b) => b.tab === BuildTab.Defense && b.cost > 0 && b.weapons.length > 0,
  );

  /** Anti-infantry dps per 1000 credits — the quantity the band is stated in. */
  const efficiency = (b: BuildingDef, w: WeaponDef): number =>
    dpsAgainst(w, ArmorClass.Infantry) * 1000 / b.cost;

  it('has emplacements to measure at all', () => {
    // A filter that silently matches nothing is a green test that checks
    // nothing, which is the failure mode this whole suite exists to catch.
    expect(emplacements.length).toBeGreaterThanOrEqual(9);
    expect(emplacements.every((b) => b.cost < CHEAP_EMPLACEMENT_MAX_COST)).toBe(true);
  });

  it('holds every emplacement under the anti-infantry ceiling', () => {
    const over: string[] = [];
    for (const b of emplacements) {
      const w = firedWeapon(b);
      if (w === undefined) continue;
      const e = efficiency(b, w);
      if (e <= BAND_MAX) continue;
      if (OVER_BAND[w.key] !== undefined) continue;
      over.push(
        `${b.key} (${b.cost} cr) fires "${w.key}" at ${dpsAgainst(w, ArmorClass.Infantry).toFixed(1)}`
        + ` dps vs infantry = ${e.toFixed(0)} per 1000 credits`,
      );
    }
    expect(
      over,
      `an emplacement over ${BAND_MAX} anti-infantry dps per 1000 credits kills a squad faster `
      + 'than the squad can answer it — see the derivation at the head of this file. Bring it '
      + 'into band, or add its weapon key to OVER_BAND with the reason it cannot come down.',
    ).toEqual([]);
  });

  it('still finds every declared exceeder genuinely over the band', () => {
    // The other direction. A list of excuses nobody re-checks is how the
    // superweapon gap survived a release; if one of these has been fixed, the
    // entry has to go, and the band tightens by itself.
    for (const key of Object.keys(OVER_BAND)) {
      const w = weaponOfKey(key);
      const carriers = emplacements.filter((b) => firedWeapon(b) === w);
      expect(carriers.length, `"${key}" is declared over the band but nothing fires it`)
        .toBeGreaterThan(0);
      // The cheapest carrier is the worst case, so that is the one to judge.
      const best = Math.max(...carriers.map((b) => efficiency(b, w)));
      expect(
        best,
        `"${key}" is declared over the band but is now inside it — delete its OVER_BAND entry`,
      ).toBeGreaterThan(BAND_MAX);
    }
  });

  it('never repeats a one-shot kill faster than the tower floor', () => {
    // The dps ceiling and this are different rules, and this is the one that
    // matches the words in the report. A pull worth a whole rifleman is the
    // strongest thing an emplacement can do; the question is how often.
    const deleters: string[] = [];
    for (const b of emplacements) {
      const w = firedWeapon(b);
      if (w === undefined) continue;
      const pull = burstDamage(w) * ARMOR_MATRIX[w.warhead as number][ArmorClass.Infantry as number];
      const killed = LINE_INFANTRY.filter(([, hp]) => pull >= hp);
      if (killed.length === 0) continue;
      const cycle = cycleSeconds(w);
      if (cycle >= MIN_ONE_SHOT_CYCLE) continue;
      if (OVER_BAND[w.key] !== undefined) continue;
      deleters.push(
        `${b.key} fires "${w.key}" for ${pull.toFixed(0)} every ${cycle.toFixed(2)}s, deleting `
        + killed.map(([k]) => k).join(' and '),
      );
    }
    expect(
      deleters,
      `an emplacement that outright kills a rifleman per pull may not pull faster than one per `
      + `${MIN_ONE_SHOT_CYCLE}s — that is one dead man per pull at 1.45 pulls a second, which is `
      + 'the reported "destroys a full army in a second". Split the damage across more rounds, '
      + 'or lengthen the cooldown.',
    ).toEqual([]);
  });

  it('keeps the line-infantry HP table honest against the def roster', () => {
    // MEDIAN_INFANTRY_HP and the squad derivation are both computed from these
    // four numbers. If a def moves, the band's arithmetic moves with it and
    // this is where that gets noticed.
    const byKey = new Map(UNITS.map((u) => [u.key, u]));
    for (const [key, hp] of LINE_INFANTRY) {
      const u = byKey.get(key);
      expect(u, `no unit "${key}"`).toBeDefined();
      expect(u?.maxHp, `${key} HP moved — re-derive BAND_MAX_DPS`).toBe(hp);
      expect(u?.armor, key).toBe(ArmorClass.Infantry);
    }
  });
});

/* ==========================================================================
 * 2. THE PAIR MUST MOVE TOGETHER
 * ========================================================================== */

describe('the Pact post and the Allied post', () => {
  /**
   * `MERIDIAN_WEAPONS`' own doctrine block, rule 1, verbatim: "Pact guns
   * out-RANGE their opposite number by 1-3 m and under-DAMAGE it, so a Pact
   * line wins a standoff and loses a brawl."
   *
   * `glaiveRepeater` was the one Pact gun taking BOTH sides of that trade — 24 m
   * against the Pillbox's 22 AND 152.2 raw against its 144.9. That is why the
   * row moved at all, and pinning it here is what stops the eventual Combat.ts
   * fix from cutting `pillboxMg` alone and quietly re-inverting it.
   */
  it('obeys the Pact doctrine: more reach, less damage', () => {
    const glaive = weaponOfKey('glaiveRepeater');
    const pillbox = weaponOfKey('pillboxMg');

    expect(glaive.warhead, 'both posts are the anti-infantry MG class').toBe(WarheadClass.SmallArms);
    expect(pillbox.warhead).toBe(WarheadClass.SmallArms);

    const reach = glaive.range - pillbox.range;
    expect(reach, 'the Pact post out-ranges by 1-3 m').toBeGreaterThanOrEqual(1);
    expect(reach).toBeLessThanOrEqual(3);

    const ratio = rawDps(glaive) / rawDps(pillbox);
    expect(
      ratio,
      'the Pact post must UNDER-damage the Pillbox. If pillboxMg has just been brought into '
      + 'band, bring glaiveRepeater down with it — the whole point of this assertion is that '
      + 'the two cannot be fixed one at a time.',
    ).toBeLessThan(1);
    expect(ratio, 'and by roughly the 8.5-11% every other Pact gun gives up').toBeGreaterThan(0.85);
  });

  it('carries the emplacements the two armies actually build', () => {
    // The doctrine test above is worthless if these defs stop firing these
    // rows; that is exactly how it would silently stop applying.
    for (const [key, weapon] of [
      ['pillbox', 'pillboxMg'], ['sentryGun', 'pillboxMg'], ['mrdGlaive', 'glaiveRepeater'],
    ] as const) {
      const b = buildingByKey.get(key);
      expect(b, `no building "${key}"`).toBeDefined();
      expect(WEAPONS[(b as BuildingDef).weapons[0]].key, key).toBe(weapon);
    }
  });
});

/* ==========================================================================
 * 3. THE HEAVY TOWERS ARE THE CONTROL GROUP
 * ========================================================================== */

describe('the heavy towers', () => {
  /**
   * These four are what the band was checked against, and they are the reason
   * the cheap posts read as broken rather than as the game being fast: a
   * 1450-1500 credit tower buys 42-80 anti-infantry dps, and a 400-credit box
   * bought 145. If a future change brings a tower UP past its cheap twin, the
   * price curve has inverted and that is worth failing over.
   */
  const HEAVY = ['prismTower', 'teslaCoil', 'mrdHelios', 'rclPylon'] as const;

  it('costs more than the cheap posts and out-damages them against armour', () => {
    const cheapest = Math.min(
      ...['pillbox', 'sentryGun', 'mrdGlaive', 'rclSpitpost']
        .map((k) => buildingByKey.get(k)?.cost ?? Infinity),
    );
    for (const key of HEAVY) {
      const b = buildingByKey.get(key);
      expect(b, `no building "${key}"`).toBeDefined();
      const tower = b as BuildingDef;
      expect(tower.cost, `${key} is a heavy tower`).toBeGreaterThan(cheapest * 2);

      const w = firedWeapon(tower);
      expect(w, `${key} has no gun`).toBeDefined();
      // The thing a heavy tower is FOR: it answers armour, which is precisely
      // what a SmallArms post cannot do (0.10 against Heavy).
      expect(
        dpsAgainst(w as WeaponDef, ArmorClass.Heavy),
        `${key} must beat an MG post against heavy armour or it has no role`,
      ).toBeGreaterThan(dpsAgainst(weaponOfKey('pillboxMg'), ArmorClass.Heavy));
    }
  });
});

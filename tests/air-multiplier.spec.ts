/**
 * ============================================================================
 * tests/air-multiplier.spec.ts — what a rifleman is worth against an aircraft
 * ============================================================================
 * WHY THIS FILE EXISTS
 * --------------------
 * Reported, verbatim: *"Redecide who can shoot drones and planes, they are
 * being destroyed in nano seconds"*. Measured off the shipped tables, that was
 * TRUE in the massed case and FALSE in the single-shooter case, and the gap
 * between them is the whole finding: nothing single is a nanosecond — the worst
 * row in the sweep is an 800-credit purpose-built AA turret at 1.81 s, which is
 * what an AA turret is FOR. What is a nanosecond is the infantry screen a
 * player already owns without ever deciding to.
 *
 * Delivered dps per 1000 credits against `ArmorClass.Light` (every aircraft is
 * Light — pinned in `air-layer.spec.ts`), before `WeaponDef.airMultiplier`:
 *
 *     army      line infantryman       its best dedicated answer     inversion
 *     Allies    gi           115.3     aaTurret       124.4            0.927x
 *     Meridian  mrdWayfarer  117.9     mrdSkiff        99.5            1.184x
 *     Soviets   conscript    220.0     flakTrooper     86.3            2.550x
 *     Reclaim   rclPicker    209.1     rclSkimmer      60.0            3.485x
 *
 * THE MECHANISM IS THE RAW DPS, NOT THE MATRIX CELL. A rifle is balanced to
 * kill infantry (SmallArms 1.00 vs Infantry) and therefore carries 47-52 raw
 * dps; 55% of that is still 20-23. `flakBurst` is balanced as an infantryman
 * and carries 32.4 raw at 100%. The purpose-built weapon's 1.6x multiplier and
 * its 1.6x raw deficit CANCEL EXACTLY. So the defect is not that 21 live rows
 * carry `canTargetAir` — it is four of them riding the unit each army has the
 * most of, with an air number nobody ever chose.
 *
 * THE FIX IS A MULTIPLIER AND NOT A FLAG, AND THAT IS THE LOAD-BEARING PART.
 * `canTargetAir` defaults FALSE, so an enemy reduced to nothing but aircraft is
 * unkillable by a ground-only army and the match hangs forever. The floor that
 * stops it — *from every reachable tech state, every army must be able to
 * produce something whose weapon carries `canTargetAir`, with no progression
 * gate and no map dependency* — is held up ENTIRELY by these four rifles. (The
 * complete ungated non-naval AA roster is three infantry each for the Allies,
 * Soviets and Pact, and two for the Reclamation, both firing `arcProd`.)
 * Deleting the flag is the cleanest-looking answer and it removes the floor in
 * all four armies at once. A weapon that still kills an aircraft SLOWLY keeps
 * the floor by construction, which is what §1 below refuses to let anyone undo.
 *
 * WHERE THE NUMBER COMES FROM — A WINDOW, NOT A TASTE
 * ---------------------------------------------------
 * Three bounds, every one of them computed from the shipped defs. Eight men is
 * the unit throughout: one Barracks tab-full, the screen a player already owns,
 * and the same squad `tests/emplacement-band.spec.ts` derives its ceiling from.
 *
 *   CEILING A — ONE PASS. An aircraft's atomic piece of work is one attack
 *   pass, `2R / v` across the SHOOTER's disc, measured per hull on the shipped
 *   speeds: 3.13 s (Petrel), 3.33 (Kestrel), 2.52 (Interceptor), 2.55
 *   (Swarmhornet). An aircraft that cannot survive one pass over a screen it
 *   did not choose to fight is not a unit class. `8 q m T < hp` gives
 *   0.416 / 0.382 / 0.428 / 0.469 — binding 0.382, the Pact.
 *
 *   CEILING B — THE COUNTER MUST BE THE ANSWER. Credit for credit, an army's
 *   own dedicated answer must beat its line infantryman against aircraft, or
 *   the purpose-built thing is a trap nobody should ever buy. That is 1/the
 *   inversion column: 1.078 / 0.844 / 0.392 / 0.287 — binding 0.287.
 *
 *   FLOOR — THE ANTI-HANG FLOOR MUST STAY REAL. A floor that takes a minute is
 *   not a floor. Eight men must still kill an aircraft inside ten seconds:
 *   0.130 / 0.127 / 0.108 / 0.120 — binding 0.130, the Allies.
 *
 * Window [0.130, 0.287]. `LINE_RIFLE_AIR_MUL` is 0.25 — 13% under the tightest
 * ceiling, 92% over the tightest floor. It sits HIGH in the window on purpose:
 * the floor is the property that must never be lost, and the ceilings are the
 * ones the report is about.
 *
 * TRAP 1, AND WHY THIS IS NOT ONE NUMBER SET BY THE CHEAPEST UNIT. A per-credit
 * anchor always flatters the cheapest unit in the game, and Ceiling B's binding
 * value IS set by a 90-credit Scrap Picker whose ABSOLUTE air output is the
 * LOWEST of the four (18.8 delivered dps against a G.I.'s 23.1). It does not
 * set the shipped constant: the window is bracketed at the top by the
 * Reclamation and at the bottom by the ALLIES, and 0.25 satisfies all four
 * armies' own bounds at once. Four per-row values were considered and rejected
 * — the four windows overlap on [0.130, 0.287], so four numbers would encode a
 * precision the arithmetic does not support. The FIELD is per-weapon so they
 * can diverge later; the VALUE is one because today the evidence says one.
 *
 * TRAP 2, DELIBERATELY OUT OF SCOPE. The AA Battery becomes the dominant answer
 * after this and must be RE-MEASURED — in its own commit, never the one that
 * lands the nerf. `tests/aircraft-killer-probe.spec.ts` §4 prints its live
 * figures; nothing here asserts a ceiling on it.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It asserts no ABSOLUTE seconds-to-kill. Every wall-clock figure in the
 * derivation runs through `COMBAT_DAMAGE.globalMul`, which is the pace knob and
 * is invariant on trades; a test that pinned seconds would go red the next time
 * somebody changed the pace, for no balance reason at all. Every assertion
 * below is a RATIO or a bound re-derived from the same tables in the same run.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { BUILDINGS, UNITS, WEAPONS } from '../src/data/Defs';
import { ARMOR_MATRIX, COMBAT_DAMAGE } from '../src/core/config';
import { LINE_RIFLE_AIR_MUL } from '../src/sim/Combat';
import { ArmorClass, Locomotor } from '../src/core/types';
import type { BuildingDef, UnitDef, WeaponDef } from '../src/core/types';

/* ==========================================================================
 * THE MODEL — `sim/Combat.ts#fire` and `sim/Damage.ts#applyOne`, and nothing
 * else. Identical to `emplacement-band.spec.ts`'s, deliberately: two files
 * asserting balance off two different firing models is how they come to
 * disagree.
 * ========================================================================== */

function cycleSeconds(w: WeaponDef): number {
  return w.burstCount > 1 ? (w.burstCount - 1) * w.burstDelay + w.cooldown : w.cooldown;
}

function rawDps(w: WeaponDef): number {
  return (w.damage * (w.burstCount > 1 ? w.burstCount : 1)) / cycleSeconds(w);
}

/**
 * Delivered dps against an aircraft, INCLUDING `airMultiplier`.
 *
 * `globalMul` is in here because these numbers are compared against each other
 * and against aircraft HP, both of which it scales identically; it cancels out
 * of every ratio below and is present so the figures match the ones quoted in
 * `Combat.ts` and CLAUDE.md rather than being a second convention.
 */
function airDps(w: WeaponDef): number {
  return rawDps(w)
    * ARMOR_MATRIX[w.warhead as number][ArmorClass.Light as number]
    * w.airMultiplier
    * COMBAT_DAMAGE.globalMul;
}

/** The same, with the multiplier forced to 1 — the "before" column. */
function airDpsUnscaled(w: WeaponDef): number {
  return airDps(w) / w.airMultiplier;
}

const unitByKey = new Map<string, UnitDef>(UNITS.map((u) => [u.key, u]));
const buildingByKey = new Map<string, BuildingDef>(BUILDINGS.map((b) => [b.key, b]));

/** The first (and only, per `Combat.ts`) weapon a def actually fires. */
function firedWeapon(d: { weapons: readonly number[] }): WeaponDef | undefined {
  return d.weapons.length > 0 ? WEAPONS[d.weapons[0]] : undefined;
}

/* ==========================================================================
 * THE FOUR ARMIES, AND THE THREE DEFS EACH ONE CONTRIBUTES
 *
 * `line` and `plane` are named because they are the subjects. `dedicated` is
 * DERIVED below rather than named, so that a new anti-air unit or a retune
 * changes what the ceiling is measured against instead of leaving this file
 * comparing against a row nobody builds any more.
 * ========================================================================== */

interface Army {
  readonly army: string;
  readonly faction: number;
  /** The line infantryman, and his HP/cost, pinned so a def move is noticed. */
  readonly line: string;
  readonly lineHp: number;
  readonly lineCost: number;
  /** That army's one aircraft. */
  readonly plane: string;
}

const ARMIES: readonly Army[] = [
  { army: 'Allies', faction: 1, line: 'gi', lineHp: 120, lineCost: 200, plane: 'vindicator' },
  { army: 'Soviets', faction: 2, line: 'conscript', lineHp: 100, lineCost: 100, plane: 'mig' },
  { army: 'Meridian', faction: 3, line: 'mrdWayfarer', lineHp: 110, lineCost: 175, plane: 'mrdKestrel' },
  { army: 'Reclaim', faction: 4, line: 'rclPicker', lineHp: 85, lineCost: 90, plane: 'rclHornet' },
];

/** The squad the whole derivation is stated in. One Barracks tab-full. */
const SQUAD = 8;

/** Seconds inside which that squad must still be able to kill an aircraft. */
const FLOOR_SECONDS = 10;

/** The four rows the multiplier is allowed to appear on, and nothing else. */
const NERFED_ROWS: readonly string[] = ['rifle', 'conscriptRifle', 'pulseCarbine', 'arcProd'];

function lineWeaponOf(a: Army): WeaponDef {
  const u = unitByKey.get(a.line);
  expect(u, `no unit "${a.line}"`).toBeDefined();
  const w = firedWeapon(u as UnitDef);
  expect(w, `${a.line} is unarmed`).toBeDefined();
  return w as WeaponDef;
}

function planeOf(a: Army): UnitDef {
  const u = unitByKey.get(a.plane);
  expect(u, `no aircraft "${a.plane}"`).toBeDefined();
  return u as UnitDef;
}

/** Delivered air dps per 1000 credits — the unit the inversion is stated in. */
function perThousand(cost: number, w: WeaponDef): number {
  return airDps(w) * 1000 / cost;
}

/**
 * That army's BEST DEDICATED ANSWER: the highest per-credit air output it can
 * field that is not one of the four line rifles and is not itself an aircraft.
 *
 * Derived rather than named for the reason `emplacement-band.spec.ts` derives
 * its emplacement list: a hard-coded opponent is a comparison that stops
 * applying the moment content moves, silently and in the direction that makes
 * the test pass.
 */
function bestDedicated(a: Army): { key: string; cost: number; per1000: number } {
  let best: { key: string; cost: number; per1000: number } | null = null;
  const consider = (key: string, faction: number, cost: number, w: WeaponDef | undefined,
    isAircraft: boolean): void => {
    if (w === undefined || !w.canTargetAir) return;
    if (faction !== a.faction) return;
    if (isAircraft) return;
    if (NERFED_ROWS.includes(w.key)) return;
    if (cost <= 0) return;
    const p = perThousand(cost, w);
    if (best === null || p > best.per1000) best = { key, cost, per1000: p };
  };
  for (const u of UNITS) {
    consider(u.key, u.faction, u.cost, firedWeapon(u), u.locomotor === Locomotor.Air);
  }
  for (const b of BUILDINGS) consider(b.key, b.faction, b.cost, firedWeapon(b), false);
  expect(best, `${a.army} has no dedicated answer to an aircraft at all`).not.toBeNull();
  return best as unknown as { key: string; cost: number; per1000: number };
}

/* ==========================================================================
 * 1. THE ROSTER — EXACTLY FOUR ROWS, AND ALL FOUR STILL ELEVATE
 *
 * Both directions, and the second one is the anti-hang floor's only structural
 * defence: a future author who decides the rifles are nerfed enough to lose the
 * flag deletes the floor in all four armies at once, and this is what stops it.
 * ========================================================================== */

describe('the air multiplier is on four rows and nowhere else', () => {
  it('defaults to 1, so a row that has not asked for one is untouched', () => {
    const carriers = WEAPONS.filter((w) => w.airMultiplier !== 1).map((w) => w.key);
    expect(
      [...carriers].sort(),
      'a weapon outside the four line-infantry rifles carries an air multiplier. That is a '
      + 'balance change to a row the derivation at the head of this file was not computed for '
      + '— either extend the derivation or take the multiplier off.',
    ).toEqual([...NERFED_ROWS].sort());
  });

  it('gives all four the SAME value, because the derivation is one window', () => {
    for (const key of NERFED_ROWS) {
      const w = WEAPONS.find((x) => x.key === key);
      expect(w, `no weapon "${key}"`).toBeDefined();
      expect(
        (w as WeaponDef).airMultiplier,
        `"${key}" has drifted off LINE_RIFLE_AIR_MUL. The four windows overlap on `
        + '[0.130, 0.287]; if one army genuinely needs its own value, re-derive all four and '
        + 'say so at the head of this file rather than editing one row.',
      ).toBe(LINE_RIFLE_AIR_MUL);
    }
  });

  it('never puts a multiplier on a gun that cannot shoot up in the first place', () => {
    // Dead config: an `airMultiplier` on a row without `canTargetAir` scales a
    // damage number that can never be delivered, and reads as a nerf that is
    // doing nothing.
    for (const w of WEAPONS) {
      if (w.airMultiplier === 1) continue;
      expect(w.canTargetAir, `"${w.key}" carries an air multiplier but cannot target air`)
        .toBe(true);
    }
  });

  it('KEEPS canTargetAir ON ALL FOUR — this is the anti-hang floor', () => {
    // The whole reason the fix is a multiplier. See the header.
    for (const key of NERFED_ROWS) {
      const w = WEAPONS.find((x) => x.key === key) as WeaponDef;
      expect(
        w.canTargetAir,
        `"${key}" no longer elevates. The anti-hang floor — every army must be able to produce `
        + 'something ungated that can hurt an aircraft — is held up entirely by these four rows. '
        + 'Nerf them with the multiplier; do not take the flag.',
      ).toBe(true);
    }
    expect(LINE_RIFLE_AIR_MUL, 'a zero multiplier IS deleting the flag, with extra steps')
      .toBeGreaterThan(0);
  });

  it('carries the line infantry the four armies actually build', () => {
    // Without this the two rules above are assertions about rows nobody fires.
    for (const a of ARMIES) {
      const u = unitByKey.get(a.line) as UnitDef;
      expect(u, `no unit "${a.line}"`).toBeDefined();
      expect(u.faction, a.line).toBe(a.faction);
      expect(u.maxHp, `${a.line} HP moved — re-derive the window`).toBe(a.lineHp);
      expect(u.cost, `${a.line} cost moved — re-derive Ceiling B`).toBe(a.lineCost);
      expect(u.unlockedBy, `${a.line} is progression-gated — the floor is map/profile dependent`)
        .toBeUndefined();
      expect(NERFED_ROWS).toContain(lineWeaponOf(a).key);
    }
  });
});

/* ==========================================================================
 * 2. THE WINDOW — RE-DERIVED, NOT QUOTED
 *
 * Every bound below is computed from `UNITS`, `BUILDINGS`, `WEAPONS` and
 * `ARMOR_MATRIX` in this run. If a def moves, the window moves with it and the
 * shipped constant is judged against the new one.
 * ========================================================================== */

describe('LINE_RIFLE_AIR_MUL sits inside every army\'s own window', () => {
  /** `2R / v` across the shooter's disc — one attack pass, per hull. */
  const passSeconds = (a: Army): number => 2 * lineWeaponOf(a).range / planeOf(a).maxSpeed;

  it('keeps an aircraft alive through one pass over an eight-man screen', () => {
    // CEILING A. Below the bound the aircraft survives; at or above it, an
    // ad-hoc screen deletes it inside the one thing it exists to do.
    const rows: string[] = [];
    for (const a of ARMIES) {
      const plane = planeOf(a);
      const q = airDps(lineWeaponOf(a));
      const t = passSeconds(a);
      const dealt = SQUAD * q * t;
      rows.push(`${a.army} ${dealt.toFixed(0)}/${plane.maxHp} hp over ${t.toFixed(2)}s`);
      expect(
        dealt,
        `${SQUAD} x ${a.line} kill a ${a.plane} inside one ${t.toFixed(2)}s pass — that is the `
        + 'report. Lower LINE_RIFLE_AIR_MUL, or re-derive Ceiling A at the head of this file.',
      ).toBeLessThan(plane.maxHp);
    }
    expect(rows.length).toBe(4);
  });

  it('leaves the dedicated answer strictly ahead per credit — the inversion is gone', () => {
    // CEILING B, and the table the report is really about.
    for (const a of ARMIES) {
      const line = perThousand(a.lineCost, lineWeaponOf(a));
      const ded = bestDedicated(a);
      expect(
        line / ded.per1000,
        `${a.army}: ${a.line} still out-shoots ${ded.key} against aircraft per credit `
        + `(${line.toFixed(1)} vs ${ded.per1000.toFixed(1)} dps per 1000 cr). A counter nobody `
        + 'should ever buy is not a counter.',
      ).toBeLessThan(1);
    }
  });

  it('still lets eight men take an aircraft down inside ten seconds', () => {
    // THE FLOOR, and the direction that fails if somebody keeps cutting.
    for (const a of ARMIES) {
      const plane = planeOf(a);
      const seconds = plane.maxHp / (SQUAD * airDps(lineWeaponOf(a)));
      expect(
        seconds,
        `${SQUAD} x ${a.line} need ${seconds.toFixed(1)}s to kill a ${a.plane}. A floor that `
        + 'takes that long is not a floor — the multiplier has gone under the window.',
      ).toBeLessThan(FLOOR_SECONDS);
    }
  });

  it('has a non-empty window at all, which is not guaranteed', () => {
    /*
     * THE BOUNDS COME FROM DIFFERENT ARMIES AND NOTHING MAKES THEM COMPATIBLE.
     * Ceiling B is set by the Reclamation and the floor by the Allies; a def
     * change to either could cross them, at which point no single value exists
     * and the honest answer is four per-row numbers (or a content fix), not a
     * constant nudged until one test goes quiet. Fail here instead.
     */
    let floor = 0;
    let ceiling = Infinity;
    const report: string[] = [];
    for (const a of ARMIES) {
      const plane = planeOf(a);
      const q = airDpsUnscaled(lineWeaponOf(a));
      const ceilPass = plane.maxHp / (SQUAD * passSeconds(a) * q);
      const ceilCounter = bestDedicated(a).per1000 / (q * 1000 / a.lineCost);
      const f = plane.maxHp / (SQUAD * FLOOR_SECONDS * q);
      floor = Math.max(floor, f);
      ceiling = Math.min(ceiling, ceilPass, ceilCounter);
      report.push(
        `${a.army}: pass ${ceilPass.toFixed(3)} counter ${ceilCounter.toFixed(3)} floor ${f.toFixed(3)}`,
      );
    }
    expect(
      floor,
      `no value satisfies all four armies at once — ${report.join(' | ')}`,
    ).toBeLessThan(ceiling);
    expect(LINE_RIFLE_AIR_MUL, `outside the derived window — ${report.join(' | ')}`)
      .toBeGreaterThan(floor);
    expect(LINE_RIFLE_AIR_MUL, `outside the derived window — ${report.join(' | ')}`)
      .toBeLessThan(ceiling);
  });

  it('had a real inversion to fix, so the assertions above are not vacuous', () => {
    /*
     * THE FALSIFIER. Every rule in §2 is satisfied by a multiplier of zero and
     * by a game with no aircraft in it. This is the control: with the multiplier
     * forced to 1 — the behaviour shipped up to 2026-08-19 — at least two armies'
     * line infantry OUT-SHOOT their own dedicated answer per credit, and every
     * army's eight-man screen kills an aircraft inside one pass.
     */
    let inverted = 0;
    let insideThePass = 0;
    for (const a of ARMIES) {
      const w = lineWeaponOf(a);
      const line = airDpsUnscaled(w) * 1000 / a.lineCost;
      if (line / bestDedicated(a).per1000 > 1) inverted++;
      const t = 2 * w.range / planeOf(a).maxSpeed;
      if (SQUAD * airDpsUnscaled(w) * t >= planeOf(a).maxHp) insideThePass++;
    }
    expect(inverted, 'no army was ever inverted — this file is measuring the wrong thing')
      .toBeGreaterThanOrEqual(2);
    expect(insideThePass, 'no screen ever killed an aircraft inside a pass').toBe(4);
  });
});

/* ==========================================================================
 * 3. THE REPORT, IN WALL CLOCK — EQUAL MONEY, AND THE PURCHASE MUST WIN
 *
 * The felt complaint is a clock, so this is the clock. Everything here is a
 * RATIO between two figures measured in the same run, so `globalMul` cancels.
 * ========================================================================== */

describe('equal money, and the answer you bought on purpose', () => {
  /** A round number near the AA Battery's price. Only ratios are asserted. */
  const SPEND = 800;

  it('makes an ad-hoc screen slower than the same money in dedicated AA', () => {
    const rows: string[] = [];
    for (const a of ARMIES) {
      const plane = planeOf(a);
      const w = lineWeaponOf(a);
      const screen = (SPEND / a.lineCost) * airDps(w);
      const was = (SPEND / a.lineCost) * airDpsUnscaled(w);
      const ded = bestDedicated(a);
      const bought = (SPEND / ded.cost) * (ded.per1000 * ded.cost / 1000);
      rows.push(
        `${a.army.padEnd(9)} vs ${a.plane.padEnd(11)} ${SPEND}cr of ${a.line.padEnd(12)}`
        + ` ${(plane.maxHp / was).toFixed(2)}s -> ${(plane.maxHp / screen).toFixed(2)}s`
        + `   ${SPEND}cr of ${ded.key} ${(plane.maxHp / bought).toFixed(2)}s`,
      );
      expect(
        plane.maxHp / screen,
        `${SPEND} credits of ${a.line} still kill a ${a.plane} faster than ${SPEND} credits of `
        + `${ded.key}. That ordering IS the report.`,
      ).toBeGreaterThan(plane.maxHp / bought);
    }
    // Printed, not asserted: these are wall-clock seconds and therefore move
    // with `globalMul`. The report is quoted from this table, so it has to be
    // re-derivable without editing the file.
    console.log(`[air-mul] equal spend, seconds to clear one aircraft\n${rows.join('\n')}`);
  });

  it('leaves the AA Battery faster than any army\'s screen at the same price', () => {
    /*
     * The one purpose-built anti-air EMPLACEMENT in the game, and the reference
     * the report is implicitly against: eight Conscripts (800 credits) used to
     * clear an aircraft in about a second where the 800-credit Battery needed
     * 1.81-2.41 s. Asserted as a ratio, not as seconds.
     *
     * NOTHING HERE BOUNDS THE BATTERY FROM ABOVE. It becomes the dominant
     * answer after this change and that re-measurement is a separate commit —
     * see trap 2 in the header.
     */
    const aa = buildingByKey.get('aaTurret');
    expect(aa, 'no aaTurret').toBeDefined();
    const aaW = firedWeapon(aa as BuildingDef) as WeaponDef;
    expect(aaW.airMultiplier, 'the AA Battery has been given a multiplier of its own').toBe(1);
    for (const a of ARMIES) {
      const plane = planeOf(a);
      const screen = ((aa as BuildingDef).cost / a.lineCost) * airDps(lineWeaponOf(a));
      expect(
        plane.maxHp / screen,
        `${a.army}: an AA Battery's price in ${a.line} still clears a ${a.plane} faster than the `
        + 'AA Battery does',
      ).toBeGreaterThan(plane.maxHp / airDps(aaW));
    }
  });

  it('keeps one rifleman able to finish the job alone', () => {
    /*
     * THE FLOOR AT ITS THINNEST, and the reason the fix is a scale rather than
     * a flag. A single line infantryman, unassisted, must still be able to
     * bring down every airframe in the game — slowly is fine, never is not.
     *
     * THE BOUND IS DELIBERATELY LOOSER THAN §2's FLOOR AND MUST STAY THAT WAY.
     * §2 binds at 0.130 (eight Allies inside ten seconds); two minutes here
     * binds at 0.106 (one Scrap Picker against a Petrel Bomber, the worst
     * cross-army pair). A first draft used sixty seconds, which binds at 0.213
     * — INSIDE the window this file's own header derives, so it would have
     * failed a legal value and quietly become the real constraint. A
     * reachability check that out-binds the balance rule is not a second
     * opinion, it is an undeclared third bound.
     */
    for (const a of ARMIES) {
      const q = airDps(lineWeaponOf(a));
      expect(q, `${a.line} does no damage to aircraft at all — the floor is gone`)
        .toBeGreaterThan(0);
      for (const u of UNITS) {
        if (u.locomotor !== Locomotor.Air) continue;
        expect(
          u.maxHp / q,
          `one ${a.line} needs over two minutes to kill a ${u.key} — the multiplier is at or `
          + 'near zero and the floor has stopped being reachable in practice',
        ).toBeLessThan(120);
      }
    }
  });
});

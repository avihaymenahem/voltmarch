/**
 * ============================================================================
 * tests/air-ground-blind.spec.ts — THE INTERCEPTOR NEVER HIT THE GROUND
 * ============================================================================
 * `Combat.engage` clamps launch pitch to `COMBAT_WEAPONS.minElevationDeg`
 * (-12 degrees) through the same `clamp(atan2(dy, max(0.5, flat)), MIN, MAX)`
 * that produces the overhead blind cone from the other end. An aircraft sits at
 * `AIR_CRUISE_ALTITUDE` (22 m) and `Targeting.approach` parks it at
 * `range * 0.80` of surface distance from what it is shooting, so pointing at a
 * ground target needs roughly **-50 to -58 degrees**. It fires at -12.
 *
 * THREE OF THE FOUR AIRFRAMES ESCAPE THAT ONLY BECAUSE THEIR ROUNDS ARE NOT
 * STRAIGHT LINES. `vindicatorMissile` and `kestrelPod` are homing `Rocket`s and
 * `hornetArc` is a `TeslaBolt`, which launches no projectile at all.
 * `migCannon` is the one aircraft weapon that is a plain `Bullet` — so its
 * round leaves at -12 and reaches ground level about a hundred metres
 * downrange, passing tens of metres over the thing it was aimed at.
 *
 * Measured before the fix: an Interceptor parked over a Power Plant fires
 * **thirty-six rounds in ten seconds and lands nothing**, at every separation
 * from zero to twenty-four metres. Meanwhile `Targeting` acquired the target,
 * `approach` drove the hull into the anti-air answering it, and it pulled the
 * trigger 3.6 times a second until it died. A 1000-credit air-superiority
 * fighter committing suicide against a building, in silence.
 *
 * ── WHY A FLAG AND NOT AN ELEVATION FIX ─────────────────────────────────────
 * `canTargetGround: false` makes the shipped BEHAVIOUR intentional at zero
 * balance cost, and stops the acquisition — which is the actual defect, because
 * a unit that cannot hurt something must not fly to it. The hull's blurb
 * already said so: *"Owns the sky and nothing under it."*
 *
 * Letting the gun depress instead — a per-row elevation override, which this
 * codebase does not have — is a FEATURE, not a fix: it would take the hull from
 * 0 to **26.5 delivered dps against Concrete and 75.8 against Light**. That is
 * a large change to a shipped unit and it belongs to whoever decides the
 * Interceptor should have a ground role.
 *
 * **DO NOT "FIX" THIS BY RAISING `minElevationDeg` GLOBALLY.** `MIN_ELEV` and
 * `MAX_ELEV` are module-scope in `Combat.ts` and feed every direct-fire launch
 * vector, `ballisticArc`'s clamp for every `Shell` (including the "out of
 * ballistic reach" branch artillery depends on), and `st.barrelPitch`, which is
 * rendered. Raising the MAX half would also close the overhead cone for the
 * four line-infantry rifles at once and re-open ceiling B of
 * `tests/air-multiplier.spec.ts`, whose window was derived against exactly that
 * screen.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { AIR_CRUISE_ALTITUDE, ARMOR_MATRIX, COMBAT_WEAPONS } from '../src/core/config';
import { ArmorClass, Locomotor, ProjectileKind, WarheadClass } from '../src/core/types';
import { DEFAULT_WEAPONS, weaponCanHurt } from '../src/sim/Combat';
import { UNITS, WEAPONS } from '../src/data/Defs';
import type { WeaponDef } from '../src/core/types';

/** The shipped armoury, both tables, deduplicated by key. */
const ARMOURY: readonly WeaponDef[] = (() => {
  const seen = new Map<string, WeaponDef>();
  for (const w of [...DEFAULT_WEAPONS, ...WEAPONS]) seen.set(w.key, w);
  return [...seen.values()];
})();

const byKey = (k: string): WeaponDef => {
  const w = ARMOURY.find((x) => x.key === k);
  expect(w, `${k} is not in the shipped armoury`).toBeDefined();
  return w as WeaponDef;
};

/* ==========================================================================
 * 1. THE ROSTER, PINNED BY VALUE AND IN BOTH DIRECTIONS
 * ========================================================================== */

describe('canTargetGround is off on exactly one row', () => {
  it('found a real armoury to check', () => {
    // THE VACUITY GUARD. An empty or tiny table would make "exactly one" pass
    // for the one reason that is not the data being right.
    expect(ARMOURY.length, 'the two weapon tables came back nearly empty')
      .toBeGreaterThan(30);
    expect(byKey('migCannon').damage, 'the Interceptor Autocannon still exists').toBe(24);
  });

  it('is migCannon, and nothing else', () => {
    /*
     * BOTH DIRECTIONS. A second ground-blind row is a design decision somebody
     * has to make on purpose — the hull carrying it will stop acquiring ground
     * targets and stop flying to them — so it fails here first. And REMOVING
     * this one fails too, which is what stops a future "tidy-up" handing the
     * Interceptor back a suicide it cannot benefit from.
     */
    const blind = ARMOURY.filter((w) => !w.canTargetGround).map((w) => w.key).sort();
    expect(blind, 'the ground-blind roster has changed — see this file\'s header before '
      + 'adding or removing one').toEqual(['migCannon']);
  });

  it('and the default is TRUE, which is the opposite of its sibling', () => {
    // `canTargetAir` defaults FALSE because answering air is a capability a row
    // has to claim. Ground is the ordinary case, so this defaults TRUE — and a
    // row that forgot to say either way must shoot the ground, not nothing.
    const air = ARMOURY.filter((w) => w.canTargetAir).length;
    expect(air, 'some rows answer air').toBeGreaterThan(5);
    expect(ARMOURY.filter((w) => w.canTargetGround).length, 'and all but one shoot ground')
      .toBe(ARMOURY.length - 1);
  });
});

/* ==========================================================================
 * 2. THE GATE THE SIM ACTUALLY READS
 * ========================================================================== */

describe('weaponCanHurt refuses a ground target for a ground-blind row', () => {
  const mig = byKey('migCannon');

  it('refuses every ground armour class', () => {
    for (const armor of [
      ArmorClass.Infantry, ArmorClass.Light, ArmorClass.Medium,
      ArmorClass.Heavy, ArmorClass.Concrete,
    ]) {
      expect(weaponCanHurt(mig, armor, false), `ground armour ${armor}`).toBe(false);
    }
  });

  it('and still answers air, which is the whole point of the hull', () => {
    // THE FALSIFIER. If this went false too the flag would have deleted the
    // unit rather than corrected it, and every assertion above would still pass.
    expect(weaponCanHurt(mig, ArmorClass.Light, true), 'every aircraft is Light').toBe(true);
    expect(mig.canTargetAir).toBe(true);
  });

  it('and an ordinary row is unaffected in both directions', () => {
    const cannon = byKey('heavyCannon');
    expect(weaponCanHurt(cannon, ArmorClass.Heavy, false), 'a tank still shoots tanks').toBe(true);
    expect(weaponCanHurt(cannon, ArmorClass.Light, true), 'and still cannot look up').toBe(false);
  });

  it('is the gate Targeting acquires through, not a second copy of one', () => {
    /*
     * `Targeting.isValidTarget` calls `weaponCanHurt` and is its only caller in
     * `src/sim/**`. That is what makes this an ACQUISITION fix rather than a
     * damage one — the damage was already zero. Checked structurally because
     * the alternative is driving a whole world to observe an absence.
     */
    const src = readTargeting();
    expect(src, 'Targeting no longer acquires through weaponCanHurt — this file assumes it does')
      .toContain('weaponCanHurt(w, st.armorClass[t] as ArmorClass, isAirborne(st, t))');
  });
});

function readTargeting(): string {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(__dirname, '..', 'src', 'sim', 'Targeting.ts'), 'utf8');
}

/* ==========================================================================
 * 3. WHY THE FLAG COSTS NOTHING — THE CLAMP, FROM THE SHIPPED CONSTANTS
 * ========================================================================== */

describe('the round could never have arrived, and the constants say so', () => {
  /*
   * DERIVED IN THE TEST FROM REAL CONSTANTS RATHER THAN QUOTED, so that moving
   * any one of them fails here and forces the balance question to be re-asked
   * instead of silently answering itself.
   *
   * `migCannon` is a `Bullet`: `Projectiles` gives it no gravity and no homing,
   * so its path is the straight line `engage` launched. If the launch pitch is
   * clamped shallower than the bearing to the target, the round passes over it.
   */
  const mig = byKey('migCannon');
  const MIN_ELEV = COMBAT_WEAPONS.minElevationDeg;
  /** `Targeting.APPROACH_STOP_FRAC`, which is private. Pinned in §4. */
  const STOP_FRAC = 0.80;

  it('needs a far steeper depression than the clamp allows', () => {
    const standoff = mig.range * STOP_FRAC;
    const needed = Math.atan2(-AIR_CRUISE_ALTITUDE, standoff) * (180 / Math.PI);
    expect(standoff, 'the standoff approach parks it at').toBeCloseTo(16.8, 1);
    expect(needed, 'the bearing to a target on the ground').toBeLessThan(-50);
    expect(MIN_ELEV, 'and the clamp').toBe(-12);
    expect(needed).toBeLessThan(MIN_ELEV);
  });

  it('so the round is still tens of metres up when it passes the target', () => {
    const standoff = mig.range * STOP_FRAC;
    const drop = standoff * Math.tan(-MIN_ELEV * (Math.PI / 180));
    const height = AIR_CRUISE_ALTITUDE - drop;
    // A Power Plant's whole silhouette is a few metres tall. Nothing about the
    // hit test reaches this.
    expect(height, 'height above ground as it passes the target').toBeGreaterThan(15);
    // And where it finally arrives, which is the other half of the picture.
    const rangeToGround = AIR_CRUISE_ALTITUDE / Math.tan(-MIN_ELEV * (Math.PI / 180));
    expect(rangeToGround, 'ground level is this far downrange').toBeGreaterThan(100);
  });

  it('and the armour cells that made it look capable are real but unreachable', () => {
    /*
     * The `mig` def's comment used to end "0.35 vs Heavy and Concrete is why it
     * is not also a tank or a siege unit", describing a capability that has
     * never delivered a point of damage. The cells exist; the round does not
     * arrive. Pinned so the correction cannot quietly rot back.
     */
    expect(ARMOR_MATRIX[WarheadClass.AutoCannon][ArmorClass.Concrete]).toBeCloseTo(0.35, 2);
    expect(ARMOR_MATRIX[WarheadClass.AutoCannon][ArmorClass.Heavy]).toBeCloseTo(0.35, 2);
    expect(ARMOR_MATRIX[WarheadClass.AutoCannon][ArmorClass.Light]).toBeCloseTo(1.0, 2);
  });
});

/* ==========================================================================
 * 4. THE THREE AIRFRAMES THIS DOES NOT TOUCH
 * ========================================================================== */

describe('the other three aircraft keep their ground role', () => {
  const AIR = UNITS.filter((u) => u.locomotor === Locomotor.Air);

  it('there are four aircraft and one of them is the Interceptor', () => {
    expect(AIR.length, 'four armies, one airframe each').toBe(4);
    expect(AIR.some((u) => u.key === 'mig')).toBe(true);
  });

  /*
   * `UnitDef.weapons` IS A LIST OF INDICES, NOT OF ROWS. `data/Defs.ts`'s `w()`
   * helper returns a `WEAPON_INDEX` position, so reading `.canTargetGround`
   * straight off an entry gives `undefined` — which is falsy, and would have
   * made the assertion below report all four airframes as ground-blind. It did,
   * on the first run of this file. Resolve through the table.
   */
  const rowsOf = (u: { readonly weapons: readonly number[] }): WeaponDef[] =>
    u.weapons.map((i) => WEAPONS[i]).filter((r): r is WeaponDef => r !== undefined);

  it('resolves a real weapon row for every airframe', () => {
    // THE VACUITY GUARD for the indirection above: an empty resolve would make
    // both assertions below pass by having nothing to disagree with.
    for (const u of AIR) {
      expect(rowsOf(u).length, `${u.key} resolved no weapon row`).toBeGreaterThan(0);
    }
  });

  it('only the Interceptor is ground-blind', () => {
    const blind = AIR.filter((u) => rowsOf(u).some((w) => !w.canTargetGround)).map((u) => u.key);
    expect(blind, 'the other three connect because their rounds are not straight lines — two '
      + 'homing Rockets and a TeslaBolt, which launches no projectile at all').toEqual(['mig']);
  });

  it('and the reason is the projectile kind, not the flag', () => {
    // THE CAUSAL CLAIM, ASSERTED. If another airframe is ever given a plain
    // Bullet it inherits this defect silently, and this is the line that says so.
    const straight = AIR.filter(
      (u) => rowsOf(u).some((w) => w.projectile === ProjectileKind.Bullet),
    ).map((u) => u.key);
    expect(straight, 'exactly one airframe fires a straight round').toEqual(['mig']);
  });
});

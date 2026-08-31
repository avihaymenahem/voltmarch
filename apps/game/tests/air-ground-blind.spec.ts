/**
 * ============================================================================
 * tests/air-ground-blind.spec.ts — EXPLICIT AIR-SUPERIORITY WEAPONS
 * ============================================================================
 * The Interceptor is an air-superiority specialist. Its `migCannon` and the
 * static AA Battery's `aaCannon` carry `canTargetGround: false`, so Targeting
 * never acquires a target the weapon is not designed to fight.
 *
 * ── WHY A FLAG AND NOT AN ELEVATION FIX ─────────────────────────────────────
 * Direct fire that crosses the air layer now follows its actual bearing, so the
 * old elevation-clamp miss is no longer the reason for the restriction. Removing
 * the flag would create a new ground role and materially change the hull's DPS;
 * that remains a balance decision, not a geometry fix.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { ArmorClass, Locomotor } from '../src/core/types';
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

describe('ground-blind weapons are explicit specialist AA', () => {
  it('found a real armoury to check', () => {
    // THE VACUITY GUARD. An empty or tiny table would make a specialist roster
    // pass for the one reason that is not the data being right.
    expect(ARMOURY.length, 'the two weapon tables came back nearly empty')
      .toBeGreaterThan(30);
    expect(byKey('migCannon').damage, 'the Interceptor Autocannon still exists').toBe(24);
  });

  it('is the Interceptor gun and the static AA Battery, and nothing else', () => {
    /*
     * BOTH DIRECTIONS. A second ground-blind row is a design decision somebody
     * has to make on purpose — the hull carrying it will stop acquiring ground
     * targets and stop flying to them — so it fails here first. And REMOVING
     * this one fails too, which is what stops a future "tidy-up" handing the
     * Interceptor back a suicide it cannot benefit from.
     */
    const blind = ARMOURY.filter((w) => !w.canTargetGround).map((w) => w.key).sort();
    expect(blind, 'the ground-blind roster has changed — see this file\'s header before '
      + 'adding or removing one').toEqual(['aaCannon', 'migCannon']);
  });

  it('and the default is TRUE, which is the opposite of its sibling', () => {
    // `canTargetAir` defaults FALSE because answering air is a capability a row
    // has to claim. Ground is the ordinary case, so this defaults TRUE — and a
    // row that forgot to say either way must shoot the ground, not nothing.
    const air = ARMOURY.filter((w) => w.canTargetAir).length;
    expect(air, 'some rows answer air').toBeGreaterThan(5);
    expect(ARMOURY.filter((w) => w.canTargetGround).length, 'and all but the two AA specialists shoot ground')
      .toBe(ARMOURY.length - 2);
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

/* ===========================================================================
 * 3. THE THREE AIRFRAMES THIS DOES NOT TOUCH
 * ========================================================================== */

describe('the other aircraft keep their ground role', () => {
  const AIR = UNITS.filter((u) => u.locomotor === Locomotor.Air);

  it('there are eight aircraft and one of them is the Interceptor', () => {
    expect(AIR.length, 'four tactical airframes plus four strategic bombers').toBe(8);
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
    expect(blind, 'only the authored air-superiority specialist is ground-blind')
      .toEqual(['mig']);
  });
});

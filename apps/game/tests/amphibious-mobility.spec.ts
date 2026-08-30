/**
 * ============================================================================
 * tests/amphibious-mobility.spec.ts — WHO MAY ENTER THE WATER, AND WHO MAY NOT
 * ============================================================================
 *
 * Three mechanisms landed together and none of them had a home:
 *
 *   1. `waterOnly` — every hull a shipyard builds is `MoveClass.Naval` and may
 *      never cross a beach. This used to be one flag named `naval` that ALSO
 *      decided the Sunder Atoll progression exemption, and the line was drawn
 *      at "does it carry passengers" so the unarmed Hover Transport could
 *      beach. Two hulls have both a hold and a gun; `rclScow` — dock-built,
 *      naval sortOrder, a sixty-eight damage HE bow gun — could therefore drive
 *      to the middle of an island and shell a base.
 *
 *   2. `amphibious` — a LAND unit that may enter water: `MoveClass.Hover`, the
 *      one ground class `Flowfield.rebuildCost` does not block on a wet cell.
 *      The four swimmers, and nothing else.
 *
 *   3. `movesShareSpace` — `Steering` and `Movement` both used to ask
 *      `(jc === Naval) !== (cls === Naval)`, which is right for a world of
 *      ships and tanks and wrong the moment anything amphibious exists. A
 *      destroyer drove straight through amphibious units.
 *
 * Every assertion here is about a RULE rather than a roster, deliberately.
 * `tests/naval-shore.spec.ts` had a list of seven keys under the name "marks
 * exactly the gunned hulls as warships" while excluding two gunned hulls, and
 * that list is how the Slag Scow stayed wrong for as long as it did.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { UNITS } from '../src/data/Defs';
import { EntityKind, Locomotor } from '../src/core/types';
import { MoveClass, locomotorForMoveClass, movesShareSpace } from '../src/sim/Flowfield';

/* ========================================================================== */
/* 1. The two def bits                                                        */
/* ========================================================================== */

describe('waterOnly is every shipyard hull, carriers included', () => {
  const wet = UNITS.filter((u) => u.waterOnly);

  it('is a real set, so nothing below passes vacuously', () => {
    expect(wet.length).toBeGreaterThanOrEqual(16);
  });

  it('never lands on infantry', () => {
    for (const u of wet) expect(u.kind, `"${u.key}"`).toBe(EntityKind.Vehicle);
  });

  it('covers every hull with a hold except the one ground APC', () => {
    // THE RULE THAT WAS MISSING. A hold is not a licence to walk: a carrier
    // lands its squad from open water through `Transport.place`, which walks a
    // widening ring for a cell the PASSENGER can stand on. The Sandskiff is the
    // single exception because it is a ground APC gated on `mrdForgeyard`, a
    // LAND structure. Seats alone do not make a vehicle a ship.
    const carriers = UNITS.filter((u) => u.cargoSlots > 0);
    expect(carriers.length, 'no carriers found — the roster moved').toBeGreaterThan(5);
    for (const u of carriers) {
      if (u.key === 'mrdSkiff') { expect(u.waterOnly).toBe(false); continue; }
      expect(u.waterOnly, `"${u.key}" carries and can still cross a beach`).toBe(true);
    }
  });

  it('never marks a hull both water-only and amphibious', () => {
    // `Production.spawnUnit` tests `waterOnly` first and `amphibious` in the
    // `else`, so a def carrying both would silently lose the second — and the
    // two mean opposite things.
    for (const u of UNITS) {
      expect(u.waterOnly && u.amphibious, `"${u.key}"`).toBe(false);
    }
  });
});

describe('amphibious is the four swimmers and nothing else', () => {
  const swimmers = UNITS.filter((u) => u.amphibious);

  it('is exactly one per army', () => {
    expect(swimmers.map((u) => u.key).sort())
      .toEqual(['frogman', 'mrdTidewalker', 'navalInfantry', 'rclDredger']);
  });

  it('keeps Locomotor.Foot, which is the whole reason it is a def bit', () => {
    /*
     * NOT a new `Locomotor` member. `passGrid` sets bits 0-3 only and
     * `Production.findEgressSpot` asks `isPassable(cx, cz, loco)`, so a
     * locomotor with no bit is impassable on every cell of the map: the
     * finished man would sit `ready: true` at the head of the Infantry queue
     * forever, silently, with the player already charged, blocking every
     * rifleman behind him. That is bit-for-bit the aircraft egress bug, which
     * `core/types.ts` documents twice as the thing never to do again.
     */
    for (const u of swimmers) expect(u.locomotor, `"${u.key}"`).toBe(Locomotor.Foot);
  });

  it('is slower than the rifleman it shares a barracks with', () => {
    // The price of the extra verb, and the reason a swimmer is a raiding tool
    // rather than a main line. Compared against the cheapest armed foot unit of
    // the same faction, which is that army's line infantry.
    for (const s of swimmers) {
      const line = UNITS
        .filter((u) => u.kind === EntityKind.Infantry && u.faction === s.faction
          && !u.amphibious && !u.canCapture && u.weapons.length > 0 && u.maxAlive === 0)
        .sort((a, b) => a.cost - b.cost)[0];
      expect(line, `no line infantry for "${s.key}"`).toBeDefined();
      expect(s.maxSpeed, `"${s.key}" is not slower than "${line.key}"`)
        .toBeLessThan(line.maxSpeed);
    }
  });

  it('is crushable, like every other man on the field', () => {
    // A swimmer is `EntityKind.Infantry` and `Crush.crushesUnit` has no water
    // test, so this is what keeps him from being quietly uncrushable on land.
    for (const u of swimmers) expect(u.crushableBy, `"${u.key}"`).toBeGreaterThan(0);
  });
});

describe('ordinary land vehicles cannot enter water', () => {
  const groundVehicles = UNITS.filter((u) => u.kind === EntityKind.Vehicle
    && !u.waterOnly && u.locomotor !== Locomotor.Air);

  it('uses only track or wheel locomotion', () => {
    expect(groundVehicles.length, 'no ground vehicles found — the roster moved').toBeGreaterThan(10);
    for (const u of groundVehicles) {
      expect([Locomotor.Track, Locomotor.Wheel], `"${u.key}" can still cross water`)
        .toContain(u.locomotor);
      expect(u.amphibious, `"${u.key}" is marked amphibious`).toBe(false);
    }
  });
});

/* ========================================================================== */
/* 2. The predicate that replaced the naval-vs-everything test                 */
/* ========================================================================== */

describe('movesShareSpace', () => {
  const GROUND = [MoveClass.Foot, MoveClass.Track, MoveClass.Wheel];

  it('keeps aircraft out of everyone else’s way', () => {
    for (const c of [...GROUND, MoveClass.Hover, MoveClass.Naval, MoveClass.Air]) {
      expect(movesShareSpace(MoveClass.Air, c), `Air vs ${c}`).toBe(false);
      expect(movesShareSpace(c, MoveClass.Air), `${c} vs Air`).toBe(false);
    }
  });

  it('puts a ship and an amphibious hull in the same water', () => {
    // THE CASE THE OLD PREDICATE GOT WRONG. `(jc === Naval) !== (cls === Naval)`
    // made these two mutually invisible for separation AND for hard relaxation,
    // so a destroyer would drive through a swimming squad — silent
    // interpenetration, not a collision.
    expect(movesShareSpace(MoveClass.Naval, MoveClass.Hover)).toBe(true);
    expect(movesShareSpace(MoveClass.Hover, MoveClass.Naval)).toBe(true);
  });

  it('keeps a ship out of the way of anything that cannot swim', () => {
    for (const c of GROUND) {
      expect(movesShareSpace(MoveClass.Naval, c), `Naval vs ${c}`).toBe(false);
      expect(movesShareSpace(c, MoveClass.Naval), `${c} vs Naval`).toBe(false);
    }
  });

  it('leaves every land pairing colliding, including hover on ground', () => {
    for (const a of [...GROUND, MoveClass.Hover]) {
      for (const b of [...GROUND, MoveClass.Hover]) {
        expect(movesShareSpace(a, b), `${a} vs ${b}`).toBe(true);
      }
    }
  });

  it('is symmetric for every pair, which the callers assume', () => {
    // `Steering` asks (neighbour, self) and `Movement.relax` asks the same pair
    // from both sides as it walks the alive list. An asymmetric answer would
    // push one unit and not the other, which reads as one hull shoving another
    // through a wall.
    const all = [MoveClass.Foot, MoveClass.Track, MoveClass.Wheel,
      MoveClass.Hover, MoveClass.Naval, MoveClass.Air];
    for (const a of all) {
      for (const b of all) {
        expect(movesShareSpace(a, b), `${a}/${b}`).toBe(movesShareSpace(b, a));
      }
    }
  });
});

/* ========================================================================== */
/* 3. The locomotor a move class reports to the terrain                        */
/* ========================================================================== */

describe('a swimmer asks the terrain the right question', () => {
  it('resolves MoveClass.Hover to the locomotor that crosses water', () => {
    // `Transport.place` picks the unload cell with
    // `locomotorForMoveClass(moveClassAt(st, i))`, so this mapping is what lets
    // a swimmer be put down offshore and a tank be refused foot-only ground.
    // It was hardcoded `Locomotor.Foot`, which is right for a rifleman and
    // wrong twice over now.
    expect(locomotorForMoveClass(MoveClass.Hover)).toBe(Locomotor.Hover);
    expect(locomotorForMoveClass(MoveClass.Naval)).toBe(Locomotor.Hover);
    expect(locomotorForMoveClass(MoveClass.Foot)).toBe(Locomotor.Foot);
    expect(locomotorForMoveClass(MoveClass.Track)).toBe(Locomotor.Track);
  });
});

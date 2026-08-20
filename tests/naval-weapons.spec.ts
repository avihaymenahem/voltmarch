import { describe, expect, it } from 'vitest';

import { MERIDIAN_UNIT_MASS_LISTS } from '../src/art/Faction3Units';
import { RECLAIM_UNIT_MASS_LISTS } from '../src/art/Faction4Units';
import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import type { MassDef, UnitMassList } from '../src/art/MassList';
import { PartId } from '../src/core/types';

const NAVAL = [
  ...UNIT_MASS_LISTS,
  ...MERIDIAN_UNIT_MASS_LISTS,
  ...RECLAIM_UNIT_MASS_LISTS,
].filter((u) => u.cls === 'naval');

function unit(key: string): UnitMassList {
  const found = NAVAL.find((u) => u.key === key);
  if (found === undefined) throw new Error(`missing naval art ${key}`);
  return found;
}

function mass(list: UnitMassList, name: string): MassDef {
  const found = list.masses.find((m) => m.name === name);
  if (found === undefined) throw new Error(`${list.key}: missing ${name}`);
  return found;
}

function muzzleZ(list: UnitMassList): number {
  const socket = list.sockets.find((s) => s.part === PartId.MuzzleA);
  if (socket === undefined) throw new Error(`${list.key}: missing MuzzleA`);
  return socket.pos[2];
}

describe('surface-ship bow weapons meet their effects sockets', () => {
  it.each([
    ['allied_destroyer', 'foreBarrel', 'foreMuzzle'],
    ['allied_gunboat', 'foreBarrel', 'foreMuzzle'],
    ['allied_hydrofoil', 'foreBarrel', 'foreMuzzle'],
    ['soviet_picket', 'foreBarrel', 'foreMuzzle'],
  ] as const)('%s has no gap or overshoot at the muzzle', (key, barrelName, muzzleName) => {
    const ship = unit(key);
    const barrel = mass(ship, barrelName);
    const muzzle = mass(ship, muzzleName);
    expect(barrel.anchor[2] + barrel.size[2] * 0.5).toBeCloseTo(muzzleZ(ship), 9);
    expect(muzzle.rot?.[0]).toBeCloseTo(Math.PI * 0.5, 9);
    expect(muzzle.anchor[2] + muzzle.size[1] * 0.5).toBeCloseTo(muzzleZ(ship), 9);
  });

  it.each(['meridian_corvette', 'meridian_cutter'] as const)(
    '%s terminates its ceremonial bow gun on the socket', (key) => {
      const ship = unit(key);
      const barrel = mass(ship, 'foreBarrel');
      const muzzle = mass(ship, 'foreMuzzle');
      expect(barrel.anchor[2] + barrel.size[1] * 0.5).toBeCloseTo(muzzleZ(ship), 9);
      expect(muzzle.anchor[2] + muzzle.size[1] * 0.5).toBeCloseTo(muzzleZ(ship), 9);
    },
  );

  it.each([
    ['reclaim_scow', 'bowBarrel', 'bowMuzzle'],
    ['reclaim_skimmer', 'bowBarrel', 'bowMuzzle'],
    ['reclaim_hulk', 'cellBarrel', 'cellMuzzle'],
  ] as const)('%s carries visible salvaged muzzle hardware to the socket', (key, barrelName, muzzleName) => {
    const ship = unit(key);
    const barrel = mass(ship, barrelName);
    const muzzle = mass(ship, muzzleName);
    expect(barrel.rot?.[0]).toBeCloseTo(Math.PI * 0.5, 9);
    expect(barrel.anchor[2] + barrel.size[1] * 0.5).toBeCloseTo(muzzleZ(ship), 9);
    expect(muzzle.anchor[2] + muzzle.size[1] * 0.5).toBeCloseTo(muzzleZ(ship), 9);
  });
});

describe('Meridian decks keep negative space around their working gear', () => {
  it.each(['meridian_corvette', 'meridian_monitor', 'meridian_cutter'] as const)(
    '%s uses perimeter rails instead of a solid deck-sized grille', (key) => {
      const ship = unit(key);
      expect(ship.masses.some((m) => m.name === 'rail')).toBe(false);
      expect(mass(ship, 'rail.side').mirrorX).toBe(true);
      expect(mass(ship, 'rail.bow').size[2]).toBeLessThan(ship.hullLength * 0.02);
    },
  );

  it.each(['meridian_lighter', 'meridian_argosy'] as const)(
    '%s builds its vehicle well and gantry from tapered procedural forms', (key) => {
      const ship = unit(key);
      expect(mass(ship, 'wellCoaming').primitive).toBe('taperedBox');
      expect(mass(ship, 'wellFloor').primitive).toBe('planPrism');
      if (key === 'meridian_argosy') {
        expect(mass(ship, 'gantryLeg').primitive).toBe('taperedBox');
        expect(mass(ship, 'gantryBeam').primitive).toBe('taperedBox');
      }
    },
  );
});

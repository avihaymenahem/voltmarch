/**
 * The main gun is the longest line on a tank. If its visible geometry stops
 * behind the muzzle socket, the flash and projectile float in empty air and the
 * whole vehicle reads as a short toy even when the hull is well proportioned.
 */

import { describe, expect, it } from 'vitest';

import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import type { MassDef, UnitMassList } from '../src/art/MassList';
import { PartId } from '../src/core/types';

function unit(key: string): UnitMassList {
  const list = UNIT_MASS_LISTS.find((u) => u.key === key);
  if (list === undefined) throw new Error(`missing unit art '${key}'`);
  return list;
}

function mass(list: UnitMassList, name: string): MassDef {
  const found = list.masses.find((m) => m.name === name);
  if (found === undefined) throw new Error(`${list.key}: missing '${name}'`);
  return found;
}

function muzzleZ(list: UnitMassList): number {
  const socket = list.sockets.find((s) => s.part === PartId.MuzzleA);
  if (socket === undefined) throw new Error(`${list.key}: missing MuzzleA socket`);
  return socket.pos[2];
}

describe('tracked-tank main-gun geometry', () => {
  const mainBattleTanks = ['allied_guardian', 'soviet_rhino'] as const;

  it.each(mainBattleTanks)('%s visible barrel terminates at its muzzle socket', (key) => {
    const list = unit(key);
    const barrel = mass(list, 'barrel');
    expect(barrel.primitive).toBe('extrude');
    expect(barrel.turret).toBe(true);
    expect(barrel.anchor[2] + barrel.size[2] * 0.5,
      `${key}: muzzle flash must not float beyond the tube`).toBeCloseTo(muzzleZ(list), 9);
  });

  it.each(mainBattleTanks)('%s carries a modelled bore evacuator', (key) => {
    const list = unit(key);
    const evacuator = mass(list, 'boreEvacuator');
    expect(evacuator.primitive).toBe('cylinder');
    expect(evacuator.turret).toBe(true);
    expect(evacuator.group).toBe('muzzles');
    expect(evacuator.size[0], `${key}: sleeve has to stand proud of the barrel`)
      .toBeGreaterThan(mass(list, 'barrel').size[0]);
  });

  it('gives the Coalition a round collar and Dominion a ported block brake', () => {
    const allied = unit('allied_guardian');
    const soviet = unit('soviet_rhino');
    const collar = mass(allied, 'muzzleCollar');
    const brake = mass(soviet, 'muzzleBrake');

    expect(collar.primitive).toBe('cone');
    expect(collar.anchor[2] + collar.size[1] * 0.5).toBeCloseTo(muzzleZ(allied), 9);
    expect(brake.primitive).toBe('taperedBox');
    expect(brake.faceSlots?.pz, 'the brake front reads as an open dark bore').toBe('grille');
    expect(brake.anchor[2] + brake.size[2] * 0.5).toBeCloseTo(muzzleZ(soviet), 9);
  });

  it('aligns both Sledge barrels and their mirrored brakes to the heavy-tank socket', () => {
    const sledge = unit('soviet_apocalypse');
    const barrel = mass(sledge, 'barrel');
    const brake = mass(sledge, 'muzzleBrake');
    expect(barrel.mirrorX).toBe(true);
    expect(brake.mirrorX).toBe(true);
    expect(barrel.anchor[2] + barrel.size[2] * 0.5).toBeCloseTo(muzzleZ(sledge), 9);
    expect(brake.anchor[2] + brake.size[2] * 0.5).toBeCloseTo(muzzleZ(sledge), 9);
    expect(sledge.sockets.some((s) => s.part === PartId.MuzzleB)).toBe(true);
  });
});

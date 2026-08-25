import { describe, expect, it } from 'vitest';

import { MERIDIAN_UNIT_MASS_LISTS } from '../src/art/Faction3Units';
import { RECLAIM_UNIT_MASS_LISTS } from '../src/art/Faction4Units';
import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import { MassRole, type UnitMassList } from '../src/art/MassList';
import { PartId } from '../src/core/types';

const AIR = [
  ...UNIT_MASS_LISTS,
  ...MERIDIAN_UNIT_MASS_LISTS,
  ...RECLAIM_UNIT_MASS_LISTS,
].filter((u) => u.cls === 'air');

function byKey(key: string): UnitMassList {
  const unit = AIR.find((u) => u.key === key);
  if (unit === undefined) throw new Error(`missing aircraft ${key}`);
  return unit;
}

describe('aircraft geometry reaches its live effects sockets', () => {
  it('covers all four shipped aircraft', () => {
    expect(AIR.map((u) => u.key).sort()).toEqual([
      'allied_vindicator', 'meridian_kestrel', 'reclaim_hornet', 'soviet_mig',
    ]);
  });

  for (const unit of AIR) {
    it(`${unit.key} has visible paired gun mouths ending on its muzzle sockets`, () => {
      const gun = unit.masses.find((m) => m.name === 'gunMuzzle');
      const muzzleA = unit.sockets.find((s) => s.part === PartId.MuzzleA);
      const muzzleB = unit.sockets.find((s) => s.part === PartId.MuzzleB);
      expect(gun, 'missing gunMuzzle mass').toBeDefined();
      expect(gun!.mirrorX, 'gun mouth must emit both wing copies').toBe(true);
      expect(muzzleA).toBeDefined();
      expect(muzzleB).toBeDefined();
      expect(gun!.anchor[0]).toBeCloseTo(muzzleA!.pos[0], 9);
      expect(-gun!.anchor[0]).toBeCloseTo(muzzleB!.pos[0], 9);
      // The cylinders run along local Y and a positive quarter-turn maps that
      // axis to world +Z, so their forward face is centre + half length.
      expect(gun!.rot?.[0]).toBeCloseTo(Math.PI * 0.5, 9);
      expect(gun!.anchor[2] + gun!.size[1] * 0.5).toBeCloseTo(muzzleA!.pos[2], 9);
    });

    it(`${unit.key} points its nose forward and joins it to the forebody`, () => {
      const nose = unit.masses.find((m) => m.name === 'nose');
      const fore = unit.masses.find((m) => m.name === 'forwardFuselage' || m.name === 'foreBody');
      expect(nose).toBeDefined();
      expect(fore).toBeDefined();
      expect(nose!.rot?.[0]).toBeCloseTo(Math.PI * 0.5, 9);
      const noseRoot = nose!.anchor[2] - nose!.size[1] * 0.5;
      const foreFront = fore!.anchor[2] + fore!.size[2] * 0.5;
      expect(noseRoot, 'nose root must overlap the fuselage').toBeLessThan(foreFront);
    });
  }
});

describe('the four aircraft keep faction-readable silhouettes', () => {
  it('gives the Soviet interceptor twin fins and twin exposed nozzles', () => {
    const soviet = byKey('soviet_mig');
    expect(soviet.masses.find((m) => m.name === 'tailFin')?.mirrorX).toBe(true);
    expect(soviet.masses.find((m) => m.name === 'nacelleNozzle')?.mirrorX).toBe(true);
  });

  it('keeps the Allied bomber on one integrated keel with a blended exhaust', () => {
    const allied = byKey('allied_vindicator');
    expect(allied.masses.find((m) => m.name === 'tailFin')?.mirrorX).not.toBe(true);
    expect(allied.masses.some((m) => m.name === 'nacelleNozzle')).toBe(false);
  });

  it('builds the Meridian primary silhouette from faceted tapered forms, not legacy boxes', () => {
    const meridian = byKey('meridian_kestrel');
    const primaries = meridian.masses.filter((m) => m.role === MassRole.Primary);
    expect(primaries.length).toBeGreaterThanOrEqual(4);
    expect(primaries.some((m) => m.primitive === 'box' || m.primitive === 'chamferBox')).toBe(false);
  });

  it('keeps the Reclamation salvage pod asymmetric while its guns remain paired', () => {
    const reclaim = byKey('reclaim_hornet');
    expect(reclaim.masses.find((m) => m.name === 'pod')?.mirrorX).not.toBe(true);
    expect(reclaim.masses.find((m) => m.name === 'gunMuzzle')?.mirrorX).toBe(true);
  });
});

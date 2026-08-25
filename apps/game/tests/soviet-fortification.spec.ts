import { describe, expect, it } from 'vitest';

import { STRUCTURE_MASS_LISTS } from '../src/art/BuildingDefs';
import { BuildingLibrary, Feature } from '../src/art/BuildingFactory';
import { GreebleFactory } from '../src/art/Greeble';
import {
  BUILDING_GREEBLE, CELL, RA3_PAD_PALETTE, RA3_STRUCTURE_PALETTE,
} from '../src/core/config';
import { PartId } from '../src/core/types';

const wall = STRUCTURE_MASS_LISTS.find((l) => l.key === 'soviet_wall')!;
const gate = STRUCTURE_MASS_LISTS.find((l) => l.key === 'soviet_gate')!;

describe('the Soviet wall and gate are one modular fortification kit', () => {
  it('keeps the wall inside one cell so repeated segments join without overlap', () => {
    expect(wall.cls).toBe('wall');
    expect(wall.footprintW).toBe(1);
    expect(wall.footprintH).toBe(1);

    for (const mass of wall.masses) {
      const xEdge = Math.abs(mass.anchor[0]) + mass.size[0] * 0.5;
      expect(xEdge, mass.name).toBeLessThanOrEqual(CELL * 0.5 + 1e-6);
      expect(mass.anchor[1] - mass.size[1] * 0.5, mass.name).toBeGreaterThanOrEqual(-1e-6);
    }

    expect(wall.masses.some((m) => m.target === 'pad'), 'a tiled wall must not stamp foundation pads')
      .toBe(false);

    const touching = wall.masses
      .filter((m) => Math.abs(Math.abs(m.anchor[0]) + m.size[0] * 0.5 - CELL * 0.5) < 1e-6)
      .map((m) => m.name);
    expect(touching, 'only the continuous core may touch a neighbouring module').toEqual(['revetment.core']);

    const team = wall.masses.filter((m) => m.slot === 'teamSlab');
    expect(team.map((m) => m.name).sort()).toEqual(['team.spine.front', 'team.spine.rear']);
    expect(team.every((m) => m.mirrorX !== true)).toBe(true);
    expect(team.map((m) => Math.sign(m.anchor[2])).sort()).toEqual([-1, 1]);
  });

  it('spends its geometry on a two-sided silhouette while staying cheap enough to repeat', () => {
    const library = new BuildingLibrary(new GreebleFactory());
    const model = library.build(wall, {
      structure: RA3_STRUCTURE_PALETTE.soviets,
      pad: RA3_PAD_PALETTE.soviets,
      panelDensity: BUILDING_GREEBLE.panelDensitySoviets,
      seed: BUILDING_GREEBLE.seedSoviets,
      padSeed: BUILDING_GREEBLE.seedPadSoviets,
    }, 256);

    expect(model.stats.errors).toEqual([]);
    expect(model.stats.parts).toBe(1);
    expect(model.stats.triangles).toBeGreaterThanOrEqual(650);
    expect(model.stats.triangles).toBeLessThanOrEqual(900);
    expect(model.stats.greebleCount).toBeGreaterThanOrEqual(3);
  });

  it('leaves a real vehicle aperture and retracts every leaf detail together', () => {
    expect(gate.cls).toBe('wall');
    expect(gate.masses.some((m) => m.target === 'pad'), 'the gate must continue the wall terrain rhythm')
      .toBe(false);

    const pylon = gate.masses.find((m) => m.name === 'pylon.core')!;
    const clearWidth = 2 * (Math.abs(pylon.anchor[0]) - pylon.size[0] * 0.5);
    expect(clearWidth).toBeGreaterThanOrEqual(2.4);

    const moving = gate.masses.filter((m) => m.feature === Feature.Door);
    expect(moving.map((m) => m.name).sort()).toEqual(['leaf', 'leaf.hazard', 'leaf.outer.rail']);
    expect(moving.every((m) => m.mirrorX === true)).toBe(true);
    expect(moving.every((m) => (m.anim ?? 0) >= gate.height * 0.70)).toBe(true);
    expect(gate.sockets.some((s) => s.part === PartId.Door)).toBe(true);
  });
});

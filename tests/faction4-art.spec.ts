/**
 * THE RECLAMATION, AS ART.
 *
 * `Faction4Units.ts` shipped without its structures and the whole army rendered
 * as magenta placeholder boxes for a while, which is the failure this file
 * exists to make impossible to repeat. Three seams:
 *
 *   1. Both factories REJECT on a band miss, so a mass list that drifts out of
 *      R8 takes the model off the map with one console line and a hazard box in
 *      its place. Building every list here turns that into a red test.
 *   2. The two namespaces. A model nobody references and a def key with no
 *      model look identical from inside either file and are only visible from
 *      between them.
 *   3. RCL-4. Not one Reclamation structure may slew, because not one
 *      Reclamation def sets `hasTurret`.
 */

import { describe, expect, it } from 'vitest';

import { BUILDINGS, DEF_TABLES, FACTION_RECLAIM } from '../src/data/Defs';
import { formatStats } from '../src/art/MassList';
import {
  RECLAIM_UNIT_MASS_LISTS, RECLAIM_UNIT_MODELS, RECLAIM_UNIT_PALETTE, reclaimUnitLibrary,
} from '../src/art/Faction4Units';
import {
  RECLAIM_PAD_PALETTE, RECLAIM_STRUCTURE_MASS_LISTS, RECLAIM_STRUCTURE_MODELS,
  RECLAIM_STRUCTURE_PALETTE, reclaimBuildingLibrary,
} from '../src/art/Faction4Buildings';

const rclBuildings = BUILDINGS.filter((b) => (b.faction as number) === (FACTION_RECLAIM as number));

/** The same shape `faction4.system.ts` hands the library. */
const palettes = {
  structure: RECLAIM_STRUCTURE_PALETTE,
  pad: RECLAIM_PAD_PALETTE,
  panelDensity: 3.0,
  seed: 0x52_43,
  padSeed: 0x52_9d,
};

describe('the Reclamation — art', () => {
  it('builds every hull inside R8 and R12', () => {
    for (const l of RECLAIM_UNIT_MASS_LISTS) {
      const m = reclaimUnitLibrary.build(l, RECLAIM_UNIT_PALETTE, 256, 0x52_43);
      expect(m.stats.errors, formatStats(m.stats)).toEqual([]);
      expect(m.stats.warnings, formatStats(m.stats)).toEqual([]);
      // Perf: 200+ units at 60 fps means a hull is a few thousand triangles,
      // not tens of thousands. An exposed frame costs more geometry than a
      // closed volume — the Scrapjaw is ~4.3k and the 15 m Reclaimed Hulk ~5.7k
      // — and that is the trade this army makes on purpose. The ceiling is set
      // above the heaviest hull, not at it, so a small edit is not a red test.
      expect(m.stats.triangles, l.key).toBeLessThan(6500);
    }
  });

  it('builds every structure inside its bands', () => {
    for (const l of RECLAIM_STRUCTURE_MASS_LISTS) {
      const m = reclaimBuildingLibrary.build(l, palettes, 256);
      expect(m.stats.errors, l.key).toEqual([]);
      expect(m.stats.warnings, l.key).toEqual([]);
      // Perf: a structure is a few thousand triangles and two draw calls.
      expect(m.stats.triangles, l.key).toBeLessThan(4000);
      expect(m.stats.parts, l.key).toBeLessThanOrEqual(2);
    }
  });

  it('has a model for every content key and a content key for every model', () => {
    for (const [contentKey, modelKey] of Object.entries(RECLAIM_UNIT_MODELS)) {
      expect(DEF_TABLES.unitByKey.has(contentKey), contentKey).toBe(true);
      expect(RECLAIM_UNIT_MASS_LISTS.some((l) => l.key === modelKey), modelKey).toBe(true);
    }
    for (const [contentKey, modelKey] of Object.entries(RECLAIM_STRUCTURE_MODELS)) {
      expect(DEF_TABLES.buildingByKey.has(contentKey), contentKey).toBe(true);
      expect(RECLAIM_STRUCTURE_MASS_LISTS.some((l) => l.key === modelKey), modelKey).toBe(true);
    }
    // Nothing in either roster is built but never drawn, and — the failure this
    // file was written for — no Reclamation def is left without art.
    expect(Object.keys(RECLAIM_STRUCTURE_MODELS).length).toBe(RECLAIM_STRUCTURE_MASS_LISTS.length);
    expect(rclBuildings.length).toBe(RECLAIM_STRUCTURE_MASS_LISTS.length);
    for (const b of rclBuildings) {
      expect(RECLAIM_STRUCTURE_MODELS[b.key], `${b.key} has no model binding`).toBe(b.model);
    }
  });

  it('agrees with the def table about the model key of every structure', () => {
    const byModel = new Set(RECLAIM_STRUCTURE_MASS_LISTS.map((l) => l.key));
    for (const b of rclBuildings) expect(byModel.has(b.model), b.model).toBe(true);
  });

  it('RCL-4: not one structure slews', () => {
    for (const l of RECLAIM_STRUCTURE_MASS_LISTS) {
      expect(l.turretPivot, l.key).toBeUndefined();
      for (const m of l.masses) expect(m.target, `${l.key}.${m.name}`).not.toBe('turret');
      for (const s of l.sockets) expect(s.turret ?? false, `${l.key} socket ${s.part}`).toBe(false);
    }
    // And the content layer agrees, which is what makes it a rule and not a
    // stylistic preference: `sim/Combat.ts` reads `hasTurret`, not the mesh.
    for (const b of rclBuildings) expect(b.hasTurret, b.key).toBe(false);
  });

  it('shares one architecture atlas across the whole army', () => {
    // The draw-call argument: 12 structures cost two materials (architecture +
    // ground) and 11 hulls cost one. Anything else is a per-model atlas.
    expect(reclaimBuildingLibrary.materialCount()).toBe(2);
    expect(reclaimUnitLibrary.materialCount()).toBe(1);
  });

  it('paints nothing the texture overhaul forbids', () => {
    // Clean painted surfaces: large flat areas, crisp panel lines, zero
    // speckle. `speckleRatio` is a per-pixel local-extremum count — white noise
    // scores ~0.44 and a drawn line scores 0.
    for (const m of reclaimBuildingLibrary.all()) {
      expect(m.atlas.metrics.speckleRatio, m.key).toBeLessThan(0.010);
    }
  });

  it('stands on real foundation geometry', () => {
    for (const m of reclaimBuildingLibrary.all()) {
      // A wall follows terrain and correctly has no apron. Everything else
      // meets the ground on a slab with a buried skirt.
      if (m.cls === 'wall') expect(m.pad, m.key).toBeNull();
      else expect(m.pad, m.key).not.toBeNull();
    }
  });
});

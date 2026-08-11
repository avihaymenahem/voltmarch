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

import { Faction } from '../src/core/types';
import { BUILDINGS, DEF_TABLES, FACTION_RECLAIM } from '../src/data/Defs';
import { FACTION_RECLAIM as AI_FACTION_RECLAIM } from '../src/sim/AIStrategy';
import { MassRole, boxiness, formatStats } from '../src/art/MassList';
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

describe('the Reclamation — faction id', () => {
  /**
   * `src/sim/**` may not import `src/data/**`, so THREE copies of the number 4
   * exist: the enum, the data-side constant, and the sim-side constant. The
   * comment on the sim-side one claimed `tests/faction4.spec.ts` kept them in
   * agreement. That file has never existed and nothing asserted this, so the
   * one hazard the zero-import rule creates was the one thing unguarded.
   * `faction3.spec.ts:42-43` has had exactly this pair for the Meridian Pact
   * all along, which is how the gap was visible at all.
   */
  it('agrees across the enum and both hand-kept constants', () => {
    expect(Faction.Reclaim as number).toBe(4);
    expect(FACTION_RECLAIM as number).toBe(Faction.Reclaim as number);
    expect(AI_FACTION_RECLAIM as number).toBe(FACTION_RECLAIM as number);
  });
});

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

  /**
   * THE RECTANGULARITY THAT ISN'T. Pinned rather than reported, because a
   * measurement in a commit message protects nothing.
   *
   * The Meridian Pact's hulls measured 0.535-0.564 score and 0.415-0.492
   * axis-aligned before v1.28.0, against 0.149 for the boxiest Allied vehicle.
   * The cause was the LEGACY `prism` primitive: `UnitFactory.buildPrism` emits
   * the same plan at both wall rings — it has no taper term at all — so its
   * walls stand dead vertical and `massFlankSurface` scores them fully
   * axis-aligned. This roster never used it. Every Reclamation Primary mass is a
   * `taperedBox` with a real taper and shear, a `plate`, a lathe or a convex
   * `hull`, all four of which report ZERO axis-aligned flank surface, so the
   * whole army measures 0.000 axis — not "low", zero, on all twelve hulls.
   *
   * The 80 `box` masses in the file are the team slab, insignia and glow decal
   * helpers, which are TeamSlab/Insignia/Emissive roles. `boxiness()` only walks
   * Primary masses, which is correct: a 6 cm let-in panel is not what makes a
   * model read as a brick.
   */
  it('is not rectangular, and it is the primitives that make that true', () => {
    for (const l of RECLAIM_UNIT_MASS_LISTS) {
      const b = boxiness(l);
      // Exactly zero. A single `prism` or plain `box` Primary anywhere in the
      // roster moves this off the floor, which is the regression to catch.
      expect(b.axisFraction, `${l.key} worst=${b.worst}@${b.worstFraction}`).toBe(0);
      // Score is then pure silhouette fill. The heaviest is the Swarmhornet at
      // 0.281; the boxiest Allied vehicle is 0.417 and Meridian's were 0.564.
      expect(b.score, `${l.key} score ${b.score.toFixed(3)}`).toBeLessThan(0.32);
    }
  });

  it('never reaches for the two primitives with no taper term', () => {
    // The causal half of the case above, stated where an author will trip over
    // it: `prism` cannot taper and `box` is the un-chamfered legacy fallback.
    // Either one as a Primary is how a hull goes back to being a brick.
    for (const l of RECLAIM_UNIT_MASS_LISTS) {
      for (const m of l.masses) {
        if (m.role !== MassRole.Primary) continue;
        expect(m.primitive, `${l.key}/${m.name}`).not.toBe('prism');
        expect(m.primitive, `${l.key}/${m.name}`).not.toBe('box');
      }
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

/**
 * THE RUNNING GEAR HAS TO BE ONE OBJECT.
 *
 * Reported as "the wheels look unrelated to the vehicle, too small and not
 * connected", and it was arithmetic rather than taste. `outriggerGear` placed
 * the swing arm and its road wheel from two independent constants: the arm at
 * `hullW * 0.50` with a 0.20 full width, the wheel at `hullW * 0.62` and 0.34
 * thick. The clearance between them is `0.12 * hullW - 0.27`, which is POSITIVE
 * for every hull in the roster — so every wheel on every Reclamation vehicle
 * floated between 7 and 11 cm off the arm holding it.
 *
 * Nothing caught it because nothing was looking: the silhouette gates measure
 * coverage, boxiness and colour fractions, and a detached wheel scores exactly
 * as well as an attached one on all three.
 */
describe('the Reclamation — running gear', () => {
  const gearOf = (list: (typeof RECLAIM_UNIT_MASS_LISTS)[number]) => {
    const arms = list.masses.filter((m) => m.name.startsWith('swing'));
    const tyres = list.masses.filter((m) => m.name.startsWith('wheel'));
    const hubs = list.masses.filter((m) => m.name.startsWith('hub'));
    return { arms, tyres, hubs };
  };
  const wheeled = RECLAIM_UNIT_MASS_LISTS.filter((l) => gearOf(l).tyres.length > 0);

  it('has vehicles with outrigger gear to check', () => {
    expect(wheeled.length).toBeGreaterThan(0);
  });

  it('never leaves a gap between a swing arm and its wheel', () => {
    const gaps: string[] = [];
    for (const list of wheeled) {
      const { arms, tyres } = gearOf(list);
      expect(arms.length, `${list.key}: one arm per wheel`).toBe(tyres.length);
      for (let i = 0; i < tyres.length; i++) {
        const arm = arms[i];
        const tyre = tyres[i];
        // Both are mirrored to -X, so checking the +X side is the whole test.
        const armOuter = arm.anchor[0] + arm.size[0] * 0.5;
        // The tyre is a cylinder rotated a quarter turn about Z, so its HEIGHT
        // (size[1]) is its extent along X — that is what a wheel's width is.
        const tyreInner = tyre.anchor[0] - tyre.size[1] * 0.5;
        const gap = tyreInner - armOuter;
        if (gap > 1e-6) {
          gaps.push(`${list.key} wheel${i}: ${(gap * 100).toFixed(1)} cm of daylight `
            + `(arm outer ${armOuter.toFixed(3)}, tyre inner ${tyreInner.toFixed(3)})`);
        }
      }
    }
    expect(gaps, 'a road wheel is not touching the arm that carries it').toEqual([]);
  });

  it('stands every wheel on the ground plane, not sunk into it', () => {
    const sunk: string[] = [];
    for (const list of wheeled) {
      for (const tyre of gearOf(list).tyres) {
        // Radius is half the DIAMETER, and `size[0]` is a diameter for a
        // cylinder — `MassList` builds it as `Math.min(w, d) * 0.5`. Naming
        // that value `r` at the call site is what hid a 2x size error.
        const radius = tyre.size[0] * 0.5;
        const bottom = tyre.anchor[1] - radius;
        if (Math.abs(bottom) > 0.06) {
          sunk.push(`${list.key} ${tyre.name}: bottom at ${bottom.toFixed(3)} m`);
        }
      }
    }
    expect(sunk, 'a road wheel is buried in the ground or hovering above it').toEqual([]);
  });

  it('gives every wheel a team-coloured hub, concentric and proud of the tyre', () => {
    for (const list of wheeled) {
      const { tyres, hubs } = gearOf(list);
      expect(hubs.length, `${list.key}: one hub per wheel`).toBe(tyres.length);
      for (let i = 0; i < tyres.length; i++) {
        const tyre = tyres[i];
        const hub = hubs[i];
        expect(hub.slot, `${list.key} hub${i} carries the faction colour`).toBe('teamSlab');
        // Concentric, or it reads as a bolt-on rather than as the wheel's hub.
        expect(hub.anchor[0]).toBeCloseTo(tyre.anchor[0], 6);
        expect(hub.anchor[1]).toBeCloseTo(tyre.anchor[1], 6);
        expect(hub.anchor[2]).toBeCloseTo(tyre.anchor[2], 6);
        // Narrower than the tyre it sits in, and wider ACROSS the axle so it
        // is visible on the outboard face instead of being swallowed.
        expect(hub.size[0]).toBeLessThan(tyre.size[0]);
        expect(hub.size[1]).toBeGreaterThan(tyre.size[1]);
      }
    }
  });
});

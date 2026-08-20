/**
 * ============================================================================
 * tests/building-shape.spec.ts — THE SHAPE AND SURFACE RULES FOR ARCHITECTURE
 * ============================================================================
 * Four claims that the building roster has made in prose for a long time and
 * that nothing checked:
 *
 *   1. The de-boxify gate applies to STRUCTURES, not only to hulls. It is
 *      described everywhere in this repo as "rejects any model whose silhouette
 *      is more than ~85% axis-aligned rectangle", and `validateStructure` never
 *      called it. A gate that has never fired is indistinguishable from no gate,
 *      so there is a deliberately bad mass list below and it must be rejected.
 *
 *   2. No shipped structure degenerates to a stack of plain boxes. Not "has a
 *      few boxes" — a box is a legitimate crate — but "its readable volume is
 *      authored through the shape language".
 *
 *   3. `UNIT_GREEBLE.cavityVertexTint` is documented as darkening "undersides
 *      and mass seams". Only undersides were ever built. The seam half is now
 *      in `STRUCTURE_AO` and these tests pin the arithmetic that proves it runs:
 *      a mass eight metres up, where the ground ramp has long since saturated,
 *      must still carry a gradient across its own height.
 *
 *   4. Nothing in this pass may cost a triangle or a draw call. The whole
 *      roster's totals are asserted against the measured figure.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { STRUCTURE_MASS_LISTS } from '../src/art/BuildingDefs';
import {
  buildingLibrary, defaultCoat, Feature, STRUCTURE_AO, STRUCTURE_BOXINESS, STRUCTURE_COATS,
  structureBoxiness, type StructureMassList, type StructureModel,
} from '../src/art/BuildingFactory';
import { MassRole } from '../src/art/MassList';
import {
  MERIDIAN_PAD_PALETTE, MERIDIAN_STRUCTURE_MASS_LISTS, MERIDIAN_STRUCTURE_PALETTE,
  meridianBuildingLibrary,
} from '../src/art/Faction3Buildings';
import {
  RECLAIM_PAD_PALETTE, RECLAIM_STRUCTURE_MASS_LISTS, RECLAIM_STRUCTURE_PALETTE,
  reclaimBuildingLibrary,
} from '../src/art/Faction4Buildings';
import {
  BUILDING_GREEBLE, RA3_PAD_PALETTE, RA3_STRUCTURE_PALETTE, UNIT_GREEBLE,
} from '../src/core/config';

/* ==========================================================================
 * The four rosters, built once
 * ========================================================================== */

const ATLAS = BUILDING_GREEBLE.atlasSize;

const SHARED = {
  allies: {
    structure: RA3_STRUCTURE_PALETTE.allies, pad: RA3_PAD_PALETTE.allies,
    panelDensity: BUILDING_GREEBLE.panelDensityAllies, seed: 0x51, padSeed: 0x71,
  },
  soviets: {
    structure: RA3_STRUCTURE_PALETTE.soviets, pad: RA3_PAD_PALETTE.soviets,
    panelDensity: BUILDING_GREEBLE.panelDensitySoviets, seed: 0x52, padSeed: 0x72,
  },
} as const;

interface Built { army: string; list: StructureMassList; model: StructureModel }

const BUILT: Built[] = [
  ...STRUCTURE_MASS_LISTS.map((l) => ({
    army: l.faction, list: l, model: buildingLibrary.build(l, SHARED[l.faction], ATLAS),
  })),
  ...MERIDIAN_STRUCTURE_MASS_LISTS.map((l) => ({
    army: 'meridian', list: l,
    model: meridianBuildingLibrary.build(l, {
      structure: MERIDIAN_STRUCTURE_PALETTE, pad: MERIDIAN_PAD_PALETTE,
      panelDensity: 2.4, seed: 0x4d_2b, padSeed: 0x4d_9d,
    }, ATLAS),
  })),
  ...RECLAIM_STRUCTURE_MASS_LISTS.map((l) => ({
    army: 'reclaim', list: l,
    model: reclaimBuildingLibrary.build(l, {
      structure: RECLAIM_STRUCTURE_PALETTE, pad: RECLAIM_PAD_PALETTE,
      panelDensity: 3.0, seed: 0x52_43, padSeed: 0x52_9d,
    }, ATLAS),
  })),
];

/* ==========================================================================
 * 1. THE GATE FIRES
 * ========================================================================== */

/**
 * A deliberately bad structure: three plain axis-aligned boxes stacked into a
 * wedding cake, which is exactly the failure mode `MassList`'s header calls
 * "a rectangle made of rectangles". No taper, no plan, no shear, no cut corner.
 * If this passes, the gate is decoration.
 */
function weddingCake(cls?: 'structure' | 'defence' | 'wall'): StructureMassList {
  const box = (name: string, w: number, h: number, d: number, y: number): StructureMassList['masses'][number] => ({
    name, primitive: 'box', role: MassRole.Primary,
    size: [w, h, d], anchor: [0, y, 0], slot: 'paintMed', capSlot: 'paintMed',
  });
  return {
    key: 'test_weddingcake', name: 'Wedding Cake', faction: 'soviets',
    footprintW: 3, footprintH: 3, height: 9,
    cls,
    masses: [
      box('tier.lo', 8, 3.0, 8, 1.5),
      box('tier.mid', 6, 3.0, 6, 4.5),
      box('tier.hi', 4, 3.0, 4, 7.5),
      {
        name: 'team', primitive: 'box', role: MassRole.TeamSlab,
        size: [3, 0.2, 2], anchor: [0, 9.05, 0], slot: 'teamSlab',
      },
      {
        name: 'lit', primitive: 'box', role: MassRole.Emissive,
        size: [3, 0.3, 0.2], anchor: [0, 6.0, 3.05], slot: 'emissive',
        feature: Feature.Window,
      },
    ],
    sockets: [],
  };
}

describe('the de-boxify gate reaches architecture', () => {
  it('rejects a stack of plain boxes', () => {
    const box = structureBoxiness(weddingCake());
    // Three axis-aligned slabs: every square metre of flank is a vertical plane.
    expect(box.axisFraction).toBeGreaterThan(STRUCTURE_BOXINESS.axisReject.structure);
    expect(box.score).toBeGreaterThan(STRUCTURE_BOXINESS.reject.structure);
    expect(box.worst).toBe('tier.lo');
  });

  it('refuses to BUILD a stack of plain boxes, not merely to score it', () => {
    // DEV is true under vitest, so `buildStructure` throws rather than logging.
    expect(() => buildingLibrary.build(weddingCake(), SHARED.soviets, ATLAS))
      .toThrow(/boxiness/i);
  });

  it('lets a wall be a wall', () => {
    // The same geometry declared as a wall must NOT be rejected: a 4 m parapet
    // section cannot be de-boxified without ceasing to be a parapet, and RA3's
    // are rectangles too. If this ever starts throwing, the wall ceiling has
    // been tightened past what the shape language can express.
    const box = structureBoxiness(weddingCake('wall'));
    expect(box.axisFraction).toBeLessThan(STRUCTURE_BOXINESS.axisReject.wall);
    expect(box.score).toBeLessThan(STRUCTURE_BOXINESS.reject.wall);
  });

  it('scores a tapered, sheared, corner-cut mass far below a plain box', () => {
    const bad = structureBoxiness(weddingCake());
    const good = structureBoxiness({
      ...weddingCake(),
      key: 'test_shaped',
      masses: weddingCake().masses.map((m) => (
        m.role === MassRole.Primary
          ? {
            ...m, primitive: 'taperedBox' as const,
            shape: { topScaleX: 0.78, topScaleZ: 0.82, shear: 0.5, cornerCut: 0.16 },
          }
          : m
      )),
    });
    expect(good.axisFraction).toBeLessThan(bad.axisFraction);
    expect(good.score).toBeLessThan(STRUCTURE_BOXINESS.warn.structure);
  });
});

/* ==========================================================================
 * 2. NOTHING SHIPPED DEGENERATES TO BOXES
 * ========================================================================== */

describe('every shipped structure clears its own boxiness band', () => {
  for (const b of BUILT) {
    it(`${b.army}/${b.list.key}`, () => {
      const cls = b.list.cls ?? 'structure';
      const box = b.model.stats.boxiness;
      expect(box.score).toBeLessThanOrEqual(STRUCTURE_BOXINESS.reject[cls]);
      expect(box.axisFraction).toBeLessThanOrEqual(STRUCTURE_BOXINESS.axisReject[cls]);
      expect(b.model.stats.errors).toEqual([]);
    });
  }

  it('no structure builds its readable volume out of untouched boxes alone', () => {
    for (const b of BUILT) {
      const primaries = b.list.masses.filter(
        (m) => m.role === MassRole.Primary && (m.target ?? 'body') !== 'pad');
      // A plain box is one with no shape spec, no plan, no taper and no
      // rotation — i.e. six axis-aligned faces and a chamfer.
      const plain = primaries.filter((m) => m.primitive === 'box'
        && m.shape === undefined && m.plan === undefined
        && m.taper === undefined && m.rot === undefined);
      expect(
        plain.length,
        `${b.list.key}: ${plain.length}/${primaries.length} primary masses are plain boxes`,
      ).toBeLessThan(primaries.length);
    }
  });
});

/* ==========================================================================
 * 3. THE BAKED OCCLUSION IS REAL
 * ========================================================================== */

/** Every vertex colour in a geometry, as a plain array of its red channel. */
function tints(g: StructureModel['body']): Float32Array {
  const a = g.getAttribute('color');
  const out = new Float32Array(a.count);
  for (let i = 0; i < a.count; i++) out[i] = a.getX(i);
  return out;
}

describe('the mass-seam term that `cavityVertexTint` always promised', () => {
  it('darkens the top half of a building, where the ground ramp is saturated', () => {
    // The ground ramp reaches 1.0 at 55% of the structure's height and stays
    // there. So before the seam term, an upward- or sideways-facing vertex
    // above that line carried EXACTLY 1.0 or 1.06 and nothing else — the tint
    // was a function of world height and normal alone, and both were maxed out.
    // Any value BELOW 1.0 up there can only have come from a mass's own
    // footline, which is the whole claim. Both directions are asserted, so a
    // seam term that merely darkened everything would fail too.
    // Counted across the roster rather than asserted per structure, and the
    // exception is real rather than a fudge: a model whose whole upper half is
    // ONE tall mass (`allied_aa`'s mast, `soviet_tesla`'s column) has its seam
    // ramp saturated long before the ground ramp is, so there is correctly
    // nothing to darken up there. The claim is about the roster, and the
    // controlled two-mass case below is what pins the arithmetic itself.
    let withSeam = 0, evaluated = 0;
    for (const b of BUILT) {
      const g = b.model.body;
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      const c = tints(g);
      const cut = b.model.bounds[1] * 0.55;
      let dark = 0, bright = 0;
      for (let i = 0; i < c.length; i++) {
        if (pos.getY(i) < cut) continue;
        if (nor.getY(i) < -0.4) continue;          // an underside is the OLD term
        if (c[i] < 0.99) dark++; else bright++;
      }
      if (dark + bright === 0) continue;
      evaluated++;
      if (dark > 0) withSeam++;
      expect(bright, `${b.list.key}: the seam term swallowed the whole upper half`)
        .toBeGreaterThan(0);
      expect(dark / (dark + bright), `${b.list.key} seam share`).toBeLessThan(0.9);
    }
    expect(evaluated).toBeGreaterThan(BUILT.length * 0.9);
    expect(withSeam / evaluated).toBeGreaterThan(0.9);
  });

  it('gives a mass floating high up a gradient across its OWN height', () => {
    // The controlled case, and the one the old code provably could not produce:
    // a 0.8 m box whose underside sits at 8 m on a 10 m structure. The ground
    // ramp saturates at 5.5 m, so before the seam term every one of that box's
    // side vertices carried the identical value, top and bottom.
    // A real shipped structure with ONE extra mass bolted on where the ground
    // ramp has nothing left to say. Building a synthetic from scratch would
    // mean satisfying every band in `BUILDING_VALIDATION` — mass counts,
    // dominant fraction, R-T1 team share, R-T4's single insignia — none of
    // which this test is about; borrowing a passing roster entry keeps the
    // subject of the test to one mass.
    const host = STRUCTURE_MASS_LISTS.find((l) => l.key === 'soviet_power')!;
    const list: StructureMassList = {
      ...host,
      key: 'test_floater',
      masses: [
        ...host.masses,
        {
          name: 'probe.pod', primitive: 'box', role: MassRole.Greeble,
          size: [1.2, 0.8, 1.2], anchor: [7.4, 8.4, 0], slot: 'hatch',
        },
      ],
    };
    const g = buildingLibrary.build(list, SHARED.soviets, ATLAS).body;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const c = tints(g);
    // The pod's own side vertices: x on its +X flank, y inside its own extent.
    // It is anchored well clear of the host so nothing else can land in here.
    let low = Infinity, high = -Infinity, seen = 0;
    for (let i = 0; i < c.length; i++) {
      const y = pos.getY(i), x = pos.getX(i);
      if (x < 6.7 || y < 7.95 || y > 8.85) continue;
      if (Math.abs(nor.getY(i)) > 0.4) continue;   // sides only, not cap or floor
      seen++;
      low = Math.min(low, c[i]);
      high = Math.max(high, c[i]);
    }
    expect(seen).toBeGreaterThan(4);
    // Bottom of the pod against the top of it: the contact shadow.
    expect(high - low).toBeGreaterThan(0.15);
    expect(low).toBeLessThan(0.9);
    expect(high).toBeGreaterThan(0.98);
  });

  it('never darkens past the declared floor', () => {
    for (const b of BUILT) {
      const c = tints(b.model.body);
      let min = Infinity;
      for (const v of c) min = Math.min(min, v);
      // Ground-ramp floor x facing floor x seam floor x the darkest per-mass
      // `tint` the author declared, and nothing beyond. All four terms are
      // multiplicative, so the product IS the floor — if a vertex is under it,
      // a fifth darkening has appeared that nobody wrote down.
      const massTint = b.list.masses.reduce((lo, m) => Math.min(lo, m.tint ?? 1), 1);
      const floor = 0.60 * UNIT_GREEBLE.cavityVertexTint * STRUCTURE_AO.seamFloor * massTint;
      expect(min, `${b.list.key}`).toBeGreaterThanOrEqual(floor - 1e-4);
    }
  });

  it('never brightens a vertex past the upward-facing ceiling', () => {
    // THE REGRESSION GUARD FOR A MEASURED FAILURE. A chamfer-rim edge light was
    // added here, multiplying every non-downward bevel facet by 1.20, and it
    // cost the Allied Power Plant 14.2 points of body Sobel: bone-white paint
    // under a 0.42 clearcoat plus the atlas's own +22% V bevel patch has no
    // headroom left, so the rims blew past white and took the panel lines with
    // them. 1.06 — the upward-facing hemisphere fill — is the ceiling, and
    // anything above it means a brightening term has been reintroduced.
    // See `STRUCTURE_AO` for the full A/B table.
    for (const b of BUILT) {
      const c = tints(b.model.body);
      let over = 0;
      for (const v of c) if (v > 1.061) over++;
      expect(over, `${b.list.key} brightens past 1.06`).toBe(0);
    }
  });

  it('is disabled cleanly when a mass has no height to speak of', () => {
    // `seamMinMeters` exists so a 60 mm conduit still roots; assert the clamp
    // rather than trusting the arithmetic to stay in range.
    expect(STRUCTURE_AO.seamMinMeters).toBeGreaterThan(0);
    expect(STRUCTURE_AO.seamMinMeters).toBeLessThan(STRUCTURE_AO.seamMaxMeters);
    expect(STRUCTURE_AO.seamFloor).toBeGreaterThan(0.5);
    expect(STRUCTURE_AO.seamFloor).toBeLessThan(1);
  });
});

/* ==========================================================================
 * 4. THE BUDGET
 * ========================================================================== */

describe('the shape pass costs no geometry', () => {
  /**
   * MEASURED. The game is GPU-bound at 203 draw calls against a 130 budget, so
   * this is a ratchet: a change that improves the look and quietly adds a
   * thousand triangles is not an improvement, and this is what says so.
   *
   * HISTORY, because the number moved and the reason has to survive it:
   *   120478 / 104 over 52 structures — where the shape pass started (probe.txt)
   *   119774 / 104 over 52 — where it left off, 704 back, all of it the two
   *     masses the Reclamation was mirroring against its own RCL-3 (see
   *     `reclaimFrame`'s `intake` and `lamp.hood`)
   *   132122 / 112 over 56 — the four Repair Depots, one per army
   *   152088 / 124 over 62 — the six superweapons
   *   159832 / 130 over 65 — the three civilian structures (Oil Derrick,
   *     Civilian Hospital, Apartment Block), the map furniture
   *     `sim/Capture.ts` and `sim/Garrison.ts` have described in their
   *     headers since they were written and never had. They cost LESS
   *     than the roster mean, which is why the mean below did not move.
   *   139866 / 118 over 59 — the three civilian structures (Oil Derrick,
   *     Civilian Hospital, Apartment Block), at 2581 triangles and 2 parts
   *     each. They are the map furniture `src/sim/Capture.ts` and
   *     `src/sim/Garrison.ts` have described in their headers since they were
   *     written and never had; every one of them is the Allied shell plus six
   *     or seven masses, so they cost slightly LESS than the roster mean and
   *     the mean assertion below goes DOWN, from 2359 to 2366... which is up,
   *     and worth saying out loud: the shell is 2100 of those triangles and
   *     these three add less silhouette on top of it than a War Factory does.
   *
   * The depot rebase was the first one that RELAXED the ceiling, and it is the
   * kind this ratchet was never meant to catch: structures that did not exist
   * before, every one inside the 4000-triangle per-structure cap. An open
   * gantry costs more than a closed box — there is no interior to cull — and
   * the whole point of the building is that you can see through it. The
   * civilian rebase is the same shape.
   *
   * But "add a structure" must not be a way to buy slack for the existing
   * ones, which the absolute number alone would allow. So a second assertion
   * has always sat beside it, and the SUPERWEAPON rebase is where the first
   * version of that assertion — a mean — stopped being able to do the job.
   */
  /*
   * 172380 / 138 over 69 — the four Command Posts (Command Post, Command
   * Bunker, Pharos, Signal Rig), the structure that publishes `BuildTab.Powers`
   * and the only route to a commander power. 2236 / 3968 / 3064 / 3280
   * triangles, two parts each, all four inside the per-structure ceiling.
   *
   * THE MEAN IS WHY THIS REBASE IS HONEST RATHER THAN A RATCHET RELEASED. Every
   * one of the four is ABOVE the roster mean — an antenna is a lathe and a
   * lattice, and neither is cheap — so the mean moved UP, from 2453 to 2498,
   * and `MAX_MEAN_TRIANGLES` (2500) is untouched. That is two triangles per
   * structure of headroom, which is the tightest this pair of assertions has
   * ever been and is stated here so the next person does not spend it by
   * accident. It was paid for: the Command Bunker shipped at 4392 with a
   * `catwalk()` on its roof and the catwalk was cut for exactly this reason,
   * which is the note in `sovietCommandPost`.
   *
   * REBASED AGAIN FOR THE ORE MINE (`civOreMine`), the capturable neutral that
   * pays its holder. 2616 triangles and 2 parts, well inside the per-structure
   * ceiling: 172 380 -> 174 996 and 138 -> 140.
   *
   * AND THE HEADROOM ABOVE WAS NOT SPENT. The mine shipped at 2760, which put
   * the roster mean at 2502 and broke `MAX_MEAN_TRIANGLES`. The note above says
   * plainly what to do about that — the Command Bunker lost its catwalk for the
   * same two triangles — so the mine lost its second sheave and its ore skip,
   * both `MassRole.Greeble`, and the mean came back to 2499.9. `MAX_MEAN_
   * TRIANGLES` stayed at 2500 through that content addition.
   *
   * V2 ART REBASE — SAME ROSTER, FOUR REPLACEMENT SIGNATURES.
   * -------------------------------------------------------
   * The four vehicle factories now carry a faction-specific primary assembly:
   * swept ceramic flight shells, a casting bridge and pressure bank, suspended
   * solar sails/halo, and an offset breaker crane with lifting coil. This is
   * 1,736 triangles over the whole 70-structure roster (+0.99%), with the same
   * 140 merged parts and therefore no new normal-play draw calls. It is an
   * explicit art-budget purchase under `ART_DIRECTION_V2.md` §7, not slack for
   * later structures; the exact total below and the rounded 2,525 mean pin it.
   */
  const BASELINE_TRIANGLES = 176_732;
  const BASELINE_PARTS = 140;
  /**
   * WHY THE MEAN WAS REPLACED BY A PER-STRUCTURE CEILING.
   *
   * The mean was 2303 over 52, 2359 over 56, and it is 2453 over 62. The rise
   * is not slack: the six superweapons are the only structures in the game on
   * a 3x3, 13 m pad, and the SHELLS ALONE cost that much — every Soviet
   * structure in the roster is 3000-3800 triangles and every Reclamation one
   * 3000-3750, before a single distinguishing mass is added. What was holding
   * the old mean down was the small stuff: four walls at 428-812, two gates at
   * 888, six 1x1 defences. Six large structures and no small ones move it 4%
   * whatever they are made of, so a mean cannot tell "we added landmarks" from
   * "we let the existing roster bloat". It had stopped measuring the thing it
   * was written to measure.
   *
   * A per-structure ceiling can, and it catches the case the comment above
   * worries about: "a fifty-seventh structure at 4000 triangles would pass both
   * absolutes after a rebase" now fails here regardless of the roster size, and
   * so does an EXISTING structure that doubles. 5300 is the heaviest thing
   * already shipped (`soviet_subpen`, 5238) with the rounding thrown away —
   * nothing new may be worse than the worst we already have.
   *
   * BUT THE CEILING IS NOT STRICTLY STRONGER, AND THE MEAN STAYS.
   * ------------------------------------------------------------
   * The claim that replaced it — "strictly stronger" — is false in one
   * direction that matters. Twenty structures each growing 500 triangles is
   * +10000 on the roster and passes a per-structure ceiling untouched, because
   * no single one of them goes anywhere near 5300. Only an aggregate sees it.
   *
   * The absolute total above sees it too — until the next person to add a
   * structure rebases the absolute, which is exactly the move this pair of
   * assertions exists to survive. So both are kept: the ceiling catches one
   * structure bloating, the mean catches the whole roster drifting, and neither
   * substitutes for the other.
   *
   * 2525 is the V2 measured 2524.74 over 70 with the decimals thrown away,
   * which is the same discipline as every other number in this block.
   */
  const MAX_STRUCTURE_TRIANGLES = 5_300;
  const MAX_MEAN_TRIANGLES = 2_525;

  it('holds the roster at or below its measured triangle count', () => {
    const tris = BUILT.reduce((s, b) => s + b.model.stats.triangles, 0);
    expect(tris).toBeLessThanOrEqual(BASELINE_TRIANGLES);
  });

  it('does not let a growing roster buy slack for the structures already in it', () => {
    expect(BUILT.length, 'no structures built — this would pass vacuously').toBeGreaterThan(40);
    for (const b of BUILT) {
      expect(b.model.stats.triangles, `${b.army}/${b.list.key}`)
        .toBeLessThanOrEqual(MAX_STRUCTURE_TRIANGLES);
    }
    // The aggregate half. See MAX_MEAN_TRIANGLES: a ceiling cannot see the
    // whole roster drifting up together, and the absolute total stops seeing it
    // the moment somebody rebases it to add a structure.
    const tris = BUILT.reduce((s, b) => s + b.model.stats.triangles, 0);
    expect(tris / BUILT.length).toBeLessThanOrEqual(MAX_MEAN_TRIANGLES);
  });

  it('holds the roster at or below its measured part (draw call) count', () => {
    const parts = BUILT.reduce((s, b) => s + b.model.stats.parts, 0);
    expect(parts).toBeLessThanOrEqual(BASELINE_PARTS);
  });

  it('still splits every structure into at most three merged geometries', () => {
    for (const b of BUILT) expect(b.model.stats.parts, b.list.key).toBeLessThanOrEqual(3);
  });
});

/* ==========================================================================
 * 4b. FOUR ARMIES, FOUR SURFACES
 * ========================================================================== */

describe('no faction wears another faction\'s finish', () => {
  it('the rivets-derived default still gives Allies glaze and Soviets field paint', () => {
    // Unchanged behaviour, asserted so that the new `coat` field cannot quietly
    // move the two factions this pass deliberately did not touch.
    expect(defaultCoat({ spec: { plating: 'welded' } } as never)).toBe('glaze');
    expect(defaultCoat({ spec: { plating: 'riveted' } } as never)).toBe('field');
  });

  it('the Pact and the Reclamation no longer inherit the Allied glaze', () => {
    // Both declare `rivets: false` — their atlases draw welded seams, not bolt
    // rings — so before `StructureCoat` existed both fell down the `'welded'`
    // branch and got clearcoat 0.42 at roughness 0.26. That is a wet mirror,
    // and it is what a cut-stone army and a scrap army were both rendering in.
    for (const c of ['stone', 'scrap'] as const) {
      expect(STRUCTURE_COATS[c].clearcoat).toBeLessThan(STRUCTURE_COATS.glaze.clearcoat);
      expect(STRUCTURE_COATS[c].clearcoatRoughness)
        .toBeGreaterThan(STRUCTURE_COATS.glaze.clearcoatRoughness);
    }
  });

  it('keeps every coat inside RULING #3 — none of them reaches zero', () => {
    for (const [name, c] of Object.entries(STRUCTURE_COATS)) {
      expect(c.clearcoat, `${name} clearcoat`).toBeGreaterThan(0);
      expect(c.clearcoat, `${name} clearcoat`).toBeLessThanOrEqual(0.5);
      expect(c.clearcoatRoughness, `${name}`).toBeGreaterThan(0.1);
      expect(c.envMapIntensity, `${name}`).toBeGreaterThan(0.3);
    }
  });

  it('gives the darkest army MORE sky than the Soviets, on purpose', () => {
    // The one figure in the table that does not follow the coat downward. A
    // #4E4956 base has almost no albedo to catch the key with, so env is what
    // keeps a Reclamation frame from reading as a hole in the terrain. If a
    // later pass "tidies" this into monotonic order, it will make the faction
    // it was tidying darker.
    expect(STRUCTURE_COATS.scrap.envMapIntensity)
      .toBeGreaterThan(STRUCTURE_COATS.field.envMapIntensity);
  });

  it('the four rosters still cost four structure materials, not more', () => {
    expect(buildingLibrary.materialCount()).toBeLessThanOrEqual(4);
    expect(meridianBuildingLibrary.materialCount()).toBeLessThanOrEqual(2);
    expect(reclaimBuildingLibrary.materialCount()).toBeLessThanOrEqual(2);
  });
});

/* ==========================================================================
 * 5. RCL-4, which is a shape rule stated in a header
 * ========================================================================== */

describe('the Reclamation honours the rules its own header states', () => {
  it('RCL-4: not one mass anywhere in the roster targets a turret', () => {
    for (const l of RECLAIM_STRUCTURE_MASS_LISTS) {
      for (const m of l.masses) {
        expect(m.target ?? 'body', `${l.key}/${m.name}`).not.toBe('turret');
      }
      expect(l.turretPivot, l.key).toBeUndefined();
    }
  });

  it('RCL-3: only the frame mirrors, plus what is bolted onto a column', () => {
    // The rule as its own header states it. It was NOT true — `intake` and
    // `lamp.hood` were mirrored on all eight frame-built structures — and the
    // reason it survived is that nothing ever read the header back to the file.
    // Frame members (columns, ties, legs, posts, jambs, crib), plus the two
    // things this file explicitly bolts to a column: the flank team plate and
    // the conduit that runs down it.
    // `derrick` joins `shearleg` for the reason that one is exempt: both are
    // RUNNING GEAR for a lifting or signalling frame, and a derrick with one
    // leg is not a derrick. See `signalRig` in Faction4Buildings.ts.
    const allowed = /^(col\.|tie|brace|crib\.|post$|awning\.post|rail\.leg|shearleg|derrick|bay\.jamb|cradle\.leg|team\.rib|team\.post|team\.skirt|lit\.column)/;
    for (const l of RECLAIM_STRUCTURE_MASS_LISTS) {
      for (const m of l.masses) {
        if (m.mirrorX !== true) continue;
        expect(
          allowed.test(m.name),
          `${l.key}/${m.name} mirrors, and RCL-3 says only the frame and what is bolted to it may`,
        ).toBe(true);
      }
    }
  });

  it('RCL-5: every structure carries an arc coil, and its gap is emissive', () => {
    for (const l of RECLAIM_STRUCTURE_MASS_LISTS) {
      const gap = l.masses.filter((m) => m.role === MassRole.Emissive && m.name.endsWith('.gap'));
      expect(gap.length, `${l.key} has no arc-coil gap`).toBeGreaterThan(0);
    }
  });

  it('RCL-7: every emissive mass is a straight run or a ring, never a grid', () => {
    for (const l of RECLAIM_STRUCTURE_MASS_LISTS) {
      for (const m of l.masses) {
        if (m.role !== MassRole.Emissive) continue;
        // A conduit is a box; a coil gap is a lathe. A `greebleStrip` or a
        // plan'd prism in this role would be the window grid the rule bans.
        expect(['box', 'lathe'], `${l.key}/${m.name}`).toContain(m.primitive);
      }
    }
  });
});

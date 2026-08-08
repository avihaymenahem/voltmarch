/**
 * ============================================================================
 * tests/unit-silhouette.spec.ts
 * ============================================================================
 * "Troops are too rectangular."
 *
 * THE HOLE THIS FILE CLOSES
 * -------------------------
 * `MassList.validateUnit` is where R8, R12 and the de-boxify gate actually
 * fire, and it only runs when something BUILDS a mass list. Three of the four
 * unit rosters were built inside a test and asserted clean:
 *
 *   MERIDIAN_UNIT_MASS_LISTS   tests/faction3.spec.ts:268
 *   RECLAIM_UNIT_MASS_LISTS    tests/faction4-art.spec.ts
 *   *_STRUCTURE_MASS_LISTS     both of the above
 *
 * `UNIT_MASS_LISTS` — the 26 Allied and Soviet hulls, i.e. the two armies most
 * players will ever see — was built by nothing except `art/units.system.ts` at
 * runtime, where a rejection is a console line in a browser nobody is watching.
 * `tests/unit-gait.spec.ts` imports it, but only to read `MassDef.gait` off
 * four keys; it never calls a factory. So the two rosters that measure BEST
 * were the two rosters with no gate at all, and the only reason nobody noticed
 * is that they happen to be clean.
 *
 * THE INVARIANT THIS FILE ADDS
 * ----------------------------
 * `boxiness().axisFraction === 0` for every infantry mass list in all four
 * armies. That number is the share of a unit's PRIMARY-mass flank surface
 * lying on a flat, world-axis-aligned vertical plane, and zero means no
 * soldier in this game has a straight-sided wall on a leg, an arm, a torso or
 * a helmet. It is exactly the player's complaint written as an assertion.
 *
 * It is `toBe(0)`, not a tolerance, and that is deliberate. Every one of the
 * four rosters measures exactly 0 today; a non-zero value means somebody
 * authored an untapered box or an untapered prism as a primary mass, which is
 * the one thing this file exists to catch. The remedy is never to loosen the
 * number — it is to taper, shear, lathe or hull the offending mass, which
 * `validateUnit`'s own REJECT message already spells out.
 *
 * WHY A CEILING AND NOT JUST THE SHIPPED GATE
 * -------------------------------------------
 * THIS SECTION USED TO SAY "`BOXINESS.warn` is 0.68 and `BOXINESS.axisWarn` is
 * 0.85 ... so it cannot fire". v1.29.0 retuned them to 0.50 / 0.25, against a
 * game whose worst unit measures 0.417 / 0.149, and `faction3.spec.ts`,
 * `faction4-art.spec.ts` and this file all assert `stats.warnings` is empty, so
 * `warn` is now a live CI gate rather than a console line. The paragraph
 * describing it as untrippable outlived the retune by one release — the same
 * kind of rot as the §4b roster table, in the file that exists to catch rot.
 *
 * The local ceilings stay, and now do a job the shipped gate cannot: `BOXINESS`
 * has to leave an author room to work in, so it sits ~0.08 and ~0.10 above the
 * content. These sit ~0.003 above it. They are a RATCHET — they say the roster
 * does not get boxier than it is today, and every time one of them has moved it
 * has moved down.
 *
 * THE SECOND HALF OF THIS FILE MEASURES THE MESH, NOT THE METRIC
 * --------------------------------------------------------------
 * `boxiness()` is analytic: it reads `MassDef` fields and never builds a
 * triangle. That is its virtue — a def author gets the number before any
 * geometry exists — and it is also the one way this whole exercise could be
 * fooled. Two proposed fixes for the Meridian hulls were refuted for exactly
 * that reason: their authors moved the metric and never looked at the mesh.
 *
 * So `the taper reaches the geometry` below drives the real
 * `shapeSpecFor -> shapeMesh -> fitMesh` path — the same three calls
 * `UnitFactory.buildUnit` makes — and measures the built polygons: how much
 * horizontal-facing area has a normal with `n.y === 0` (a dead vertical wall),
 * and how far apart the bottom and top rings actually sit. A taper that exists
 * only in the metric fails those.
 *
 * That block covered the Meridian roster alone, because the Meridian roster was
 * what had just been fixed. It now covers the ten Allied and Soviet tracked
 * hulls too — the units at the top of the boxiness table — and they pass: all
 * seventeen of their `taperedBox` and `planPrism` primaries have ZERO
 * dead-vertical flank on the built mesh, with ring separations of 5.7% to
 * 23.6%. There is no untapered load-bearing mass left on any of them.
 *
 * Which is worth stating plainly, because the table invites the opposite
 * reading: what keeps those ten off 0.000 is not their art. It is the `tracks`
 * constant in `MassList.massFlankSurface`, which no field in `UnitDefs.ts`
 * reaches, and which does not match the mesh it says it was measured from.
 * `tests/flank-model.spec.ts` is that measurement.
 * ============================================================================
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { RA3_UNIT_PALETTE } from '../src/core/config';
import { GreebleFactory } from '../src/art/Greeble';
import {
  BOXINESS, boxiness, defaultChamfer, expandMasses, formatStats, MassRole,
  shapeFitMode, shapeSpecFor, type MassDef, type UnitMassList,
} from '../src/art/MassList';
import { fitMesh, shapeMesh } from '../src/art/Shapes';
import { UnitLibrary } from '../src/art/UnitFactory';
import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import { MERIDIAN_UNIT_MASS_LISTS } from '../src/art/Faction3Units';
import { RECLAIM_UNIT_MASS_LISTS } from '../src/art/Faction4Units';

/** The same fixed per-faction seeds `art/units.system.ts` boots with. */
const ATLAS_SEED: Readonly<Record<UnitMassList['faction'], number>> = {
  allies: 0x41_11,
  soviets: 0x50_77,
  neutral: 0x4e_11,
};

/**
 * A PRIVATE library on a PRIVATE factory, for the same reason `Faction3Units`
 * keeps one: `UnitLibrary.build` caches by `list.key` and derives its atlas key
 * from `list.faction`, so building into the shared `unitLibrary` would make
 * this file's results depend on whether some other spec ran first.
 */
const library = new UnitLibrary(new GreebleFactory());

const ROSTERS: readonly (readonly [string, readonly UnitMassList[]])[] = [
  ['allied/soviet', UNIT_MASS_LISTS],
  ['meridian', MERIDIAN_UNIT_MASS_LISTS],
  ['reclaim', RECLAIM_UNIT_MASS_LISTS],
];

/* ========================================================================== */

/**
 * Built ONCE, before any case runs, so that one hull missing a band reports as
 * one red case instead of aborting the loop and taking the rest of the roster
 * with it — which is exactly what a `for` loop full of `expect` does.
 */
const built = new Map<string, ReturnType<UnitLibrary['build']>>();
beforeAll(() => {
  for (const l of UNIT_MASS_LISTS) {
    built.set(l.key, library.build(l, RA3_UNIT_PALETTE[l.faction], 256, ATLAS_SEED[l.faction]));
  }
});

describe('the Allied and Soviet roster is gated like the other two', () => {
  it('has a roster to gate at all', () => {
    expect(UNIT_MASS_LISTS.length).toBeGreaterThanOrEqual(26);
    // `UnitLibrary.build` returns the EXISTING model when a key repeats, so a
    // duplicate key would leave one of these hulls never validated at all —
    // the same silent-skip shape as the glob that registered one system per
    // directory.
    const keys = UNIT_MASS_LISTS.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(built.size).toBe(UNIT_MASS_LISTS.length);
  });

  for (const l of UNIT_MASS_LISTS) {
    it(`${l.key} builds inside R8 and R12`, () => {
      const m = built.get(l.key)!;
      // `formatStats` as the failure message: a band miss is unreadable without
      // the numbers that missed it.
      expect(m.stats.errors, formatStats(m.stats)).toEqual([]);
      expect(m.stats.warnings, formatStats(m.stats)).toEqual([]);
      // Perf: 200+ units at 60 fps means a hull is a few thousand triangles,
      // not tens of thousands. Set ABOVE the heaviest hull rather than at it,
      // the way `faction4-art.spec.ts` sets the Reclamation's — the Dreadnought
      // is ~4.8k and the two harvesters ~4.6k, so a small edit is not a red
      // test but a doubling is.
      expect(m.stats.triangles, l.key).toBeLessThan(5500);
    });
  }

  it('costs one material per faction and not one per unit', () => {
    // The draw-call argument, restated where the roster is actually built.
    // `UNIT_MASS_LISTS` spans allies + soviets, and `UnitLibrary` keys its
    // atlas on `${faction}.unit`, so 26 hulls must cost 2 materials.
    const factions = new Set(UNIT_MASS_LISTS.map((l) => l.faction));
    expect(factions.size).toBe(2);
    expect(library.materialCount()).toBe(factions.size);
  });
});

/* ========================================================================== */

describe('no soldier in any army has a straight-sided primary mass', () => {
  const infantry = ROSTERS.flatMap(([roster, lists]) =>
    lists.filter((l) => l.cls === 'infantry').map((l) => [roster, l] as const));

  it('covers every army, so this cannot pass by measuring nothing', () => {
    // Four armies' worth. If a roster stops contributing infantry the count
    // collapses and the invariant below quietly measures an empty set.
    expect(infantry.length).toBeGreaterThanOrEqual(11);
    for (const [, lists] of ROSTERS) {
      expect(lists.some((l) => l.cls === 'infantry'), 'every roster fields infantry').toBe(true);
    }
  });

  for (const [roster, l] of infantry) {
    it(`${l.key} (${roster}) has no axis-aligned flank surface`, () => {
      const b = boxiness(l);
      expect(
        b.axisFraction,
        `"${b.worst}" is ${(b.worstFraction * 100).toFixed(1)}% flat vertical wall. ` +
        'Taper it, shear it, lathe it or hull it — see MassList.massFlankSurface: a wall ' +
        'only leaves the axis-aligned bucket when it actually SLOPES, and the legacy ' +
        "`prism` builder cannot taper at all (use `planPrism`). The legacy `box` builder's " +
        '`taper` field DOES slope its walls, so a legacy box is fine once tapered.',
      ).toBe(0);
    });
  }
});

/* ========================================================================== */

describe('the measured boxiness ceiling', () => {
  /**
   * Measured on 2026-08-08 across all three rosters, and RE-MEASURED the same
   * day once the Meridian hulls were tapered. The worst four units in the game
   * used to be the Meridian support and naval hulls, whose load-bearing `prism`
   * masses were untapered and therefore stood dead vertical:
   *
   *   meridian_collector   0.564 / 0.415  ->  0.310 / 0.000
   *   meridian_carryall    0.548 / 0.427  ->  0.290 / 0.000
   *   meridian_corvette    0.537 / 0.492  ->  0.233 / 0.000
   *   meridian_monitor     0.535 / 0.491  ->  0.230 / 0.000
   *
   * The worst figures in the game are `allied_prism` at 0.416731 blended and
   * `allied_harvester` at 0.148953 axis, and they have not moved since: the ten
   * Allied and Soviet tracked hulls that hold both records were re-examined on
   * the BUILT MESH this round and every load-bearing wall on all ten already
   * slopes (see the block at the end of this file, and `flank-model.spec.ts`
   * for where the residual actually comes from). Nothing was left to taper, so
   * nothing was churned, so the numbers are unchanged.
   *
   * TIGHTENED 0.45 -> 0.42 and 0.20 -> 0.15 for that reason. A ceiling is only
   * a ratchet if it sits on the content; 0.20 against a measured 0.149 left
   * room for a 34% regression on the axis sub-metric to land green, and this
   * file exists because a threshold with that much slack is how the shipped
   * gate ended up meaning nothing. The margin now is ~0.003 on score and
   * ~0.001 on axis. That is deliberate and it is safe: `boxiness()` is pure
   * arithmetic over `MassDef` fields with no RNG, no clock and no GL, so these
   * are exact repeatable numbers, not samples — there is nothing here to flake.
   *
   * When they are next in the way, the answer is to look at the hull, not at
   * this number: every time one of them has moved so far it has moved down.
   */
  const SCORE_CEILING = 0.42;
  const AXIS_CEILING = 0.15;

  it('is tighter than the shipped gate, which must leave authoring room', () => {
    // `BOXINESS` is a gate a def author works against, so it sits ~0.08 and
    // ~0.10 clear of the content on purpose. These sit ON the content. If the
    // two ever meet, delete these in favour of the shipped constants.
    expect(SCORE_CEILING).toBeLessThan(BOXINESS.warn);
    expect(AXIS_CEILING).toBeLessThan(BOXINESS.axisWarn);
  });

  for (const [roster, lists] of ROSTERS) {
    it(`holds the ${roster} roster under it`, () => {
      for (const l of lists) {
        const b = boxiness(l);
        expect(b.score, `${l.key}: worst primary is "${b.worst}"`).toBeLessThanOrEqual(SCORE_CEILING);
        expect(b.axisFraction, `${l.key}: worst primary is "${b.worst}"`).toBeLessThanOrEqual(AXIS_CEILING);
      }
    });
  }
});

/* ========================================================================== */

describe('no primary mass in the game is a legacy `prism`', () => {
  /**
   * THE SINGLE STRUCTURAL RULE BEHIND EVERY NUMBER ABOVE.
   *
   * `UnitFactory.buildPrism` emits the SAME plan at both wall rings. There is no
   * taper term in it, there is no field on `MassDef` that could supply one, and
   * so every wall of every legacy `prism` stands dead vertical — which is why
   * `MassList.massFlankSurface` scores a hexagon at 0.275 and an octagon higher
   * still. `planPrism` takes the identical polygon in metres and CAN taper.
   *
   * This is a rule about PRIMARY masses only, and deliberately. A greeble is a
   * hand-sized object read as a shape rather than as a surface; the roster still
   * uses `prism` for battery packs, ram bows and intake scoops, and should.
   */
  for (const [roster, lists] of ROSTERS) {
    it(`${roster}`, () => {
      const offenders: string[] = [];
      for (const l of lists) {
        for (const m of expandMasses(l.masses)) {
          if (m.role === MassRole.Primary && m.primitive === 'prism') {
            offenders.push(`${l.key}/${m.name}`);
          }
        }
      }
      expect(
        offenders,
        'a legacy `prism` cannot slope its walls at any parameter. Use `planPrism` and ' +
        'give it the same polygon in metres plus a top/bottom scale — see ' +
        '`hexPlan`/`octPlan`/`wedgePlan` in src/art/Faction3Units.ts.',
      ).toEqual([]);
    });
  }
});

/* ========================================================================== */

describe('the taper reaches the geometry, not just the metric', () => {
  /**
   * Build one mass the way `UnitFactory.buildUnit` builds it and measure the
   * polygons. Returns null for the legacy `box` / `lathe` primitives, which
   * `shapeSpecFor` does not own and which the factory still builds itself.
   */
  function builtMesh(m: MassDef, faction: UnitMassList['faction']): ReturnType<typeof shapeMesh> | null {
    const spec = shapeSpecFor(m, defaultChamfer(m, faction));
    if (spec === null) return null;
    // Mirror `MassList#emitMassShape` exactly, including the 'none' branch:
    // `shapeFitMode` returns 'stretch' | 'uniform' | 'none' and `fitMesh` takes
    // only the first two, so a fit-exempt mass must NOT be handed to it. This
    // read `fitMesh(..., shapeFitMode(m))`, copied from the integration example
    // in MassList.ts, which had the same bug — it did not typecheck, and vitest
    // never noticed because esbuild strips types.
    const fit = shapeFitMode(m);
    const built = shapeMesh(spec);
    return fit === 'none' ? built : fitMesh(built, m.size as [number, number, number], fit);
  }

  /** The share of horizontal-facing built area whose normal is exactly level. */
  function verticalWallShare(mesh: ReturnType<typeof shapeMesh>): number {
    let vertical = 0, total = 0;
    for (const p of mesh.polys) {
      // Decks and undersides are excluded for the same reason `boxiness` excludes
      // them: nobody has ever called a model boxy because its roof was flat.
      if (Math.abs(p.n[1]) > 0.9) continue;
      total += p.area;
      if (Math.abs(p.n[1]) < 1e-4) vertical += p.area;
    }
    return total > 1e-9 ? vertical / total : 0;
  }

  /** XZ extents of the lowest and highest vertex rings of a built mesh. */
  function ringExtents(mesh: ReturnType<typeof shapeMesh>): { bottom: [number, number]; top: [number, number] } {
    const y0 = mesh.min[1], y1 = mesh.max[1];
    const mid = (y0 + y1) * 0.5;
    const acc = [
      { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity },
      { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity },
    ];
    for (const p of mesh.polys) {
      for (const v of p.v) {
        const a = acc[v[1] < mid ? 0 : 1];
        if (v[0] < a.x0) a.x0 = v[0];
        if (v[0] > a.x1) a.x1 = v[0];
        if (v[2] < a.z0) a.z0 = v[2];
        if (v[2] > a.z1) a.z1 = v[2];
      }
    }
    return {
      bottom: [acc[0].x1 - acc[0].x0, acc[0].z1 - acc[0].z0],
      top: [acc[1].x1 - acc[1].x0, acc[1].z1 - acc[1].z0],
    };
  }

  const meridianPrimaries = MERIDIAN_UNIT_MASS_LISTS.flatMap((l) =>
    expandMasses(l.masses)
      .filter((m) => m.role === MassRole.Primary && builtMesh(m, l.faction) !== null)
      .map((m) => [l, m] as const));

  it('has masses to measure, in every template the army has', () => {
    // 29 across the twelve hulls at the time of writing — the four infantry
    // torsos and arms, and every skirt, chassis, hull, deck, bridge, drum,
    // throat, ramp and fore body. If a refactor sends these back down the
    // legacy path the count collapses and every case below measures nothing.
    expect(meridianPrimaries.length).toBeGreaterThanOrEqual(29);
    const templates = new Set(meridianPrimaries.map(([l]) => l.cls));
    expect([...templates].sort()).toEqual(['air', 'infantry', 'naval', 'vehicle']);
  });

  for (const [l, m] of meridianPrimaries) {
    it(`${l.key}/${m.name} has no dead-vertical wall on the built mesh`, () => {
      const mesh = builtMesh(m, l.faction)!;
      expect(mesh.polys.length).toBeGreaterThan(0);
      // `toBe(0)`, not a tolerance. `prismFromPlanMesh` tilts EVERY wall the
      // moment any top/bottom scale or shear is non-unit, so a single square
      // metre of level normal means the taper was dropped, not shaved.
      expect(
        verticalWallShare(mesh),
        `${m.primitive} "${m.name}" still has a flat vertical wall. Give it a real ` +
        'topScale/bottomScale/shear — the metric would not have caught this.',
      ).toBe(0);
    });
  }

  it('slopes the walls far enough to see, not by an epsilon', () => {
    // The other way a taper can be fake: satisfy the metric with 0.999. A
    // `planPrism` primary must move its plan by at least 4% of the mass's own
    // size between the bottom ring and the top one, on at least one axis.
    const slim: string[] = [];
    for (const [l, m] of meridianPrimaries) {
      if (m.primitive !== 'planPrism') continue;
      const { bottom, top } = ringExtents(builtMesh(m, l.faction)!);
      const dx = Math.abs(top[0] - bottom[0]) / Math.max(1e-6, m.size[0]);
      const dz = Math.abs(top[1] - bottom[1]) / Math.max(1e-6, m.size[2]);
      if (Math.max(dx, dz) < 0.04) {
        slim.push(`${l.key}/${m.name} dx=${dx.toFixed(3)} dz=${dz.toFixed(3)}`);
      }
    }
    expect(slim, 'these tapers are too small to read at gameplay zoom').toEqual([]);
  });

  it('leaves the mass inside its declared `size`, which every R8 band divides by', () => {
    // `fitMesh` normalises the built mesh into `size`, so an over-large shear
    // does not overflow the AABB — it SQUASHES the hull to fit and silently
    // shortens it. This pins the other side of that: the built extent is
    // `size` on every axis, so `massExtents`, `unitBounds`, `silhouetteArea`
    // and the turret/hull ratio all keep meaning what they say.
    for (const [l, m] of meridianPrimaries) {
      const mesh = builtMesh(m, l.faction)!;
      for (let a = 0; a < 3; a++) {
        expect(mesh.max[a] - mesh.min[a], `${l.key}/${m.name} axis ${a}`)
          .toBeCloseTo(m.size[a], 6);
      }
    }
  });

  /* ---------------------------------------------------------------------- *
   * THE SAME THREE MEASUREMENTS, ON THE TEN TRACKED HULLS.
   *
   * These are the units at the top of the boxiness table, and the table reads
   * like an indictment of their art: ten Allied and Soviet ground vehicles at
   * 0.118-0.149 axis, and every other unit in the game at exactly 0.000.
   *
   * On the mesh it is not their art. Their hulls, chassis, hoppers, cab blocks,
   * scoops and rocket racks are `taperedBox` and `planPrism` with real
   * top/bottom scales, real shear and real corner cuts, and every one of them
   * measures zero dead-vertical flank here. What the table is measuring is the
   * `tracks` constant — see `tests/flank-model.spec.ts`.
   *
   * Restricted to those two primitives DELIBERATELY. `revolve`, `extrude`,
   * `plate` and `tracks` all carry dead-vertical polygons by construction — a
   * lathe wall is vertical wherever its profile is, a plate's rim is vertical
   * wherever its outline edge is — and their de-boxifying property is that
   * those walls are not AXIS-ALIGNED, which is a different measurement made by
   * `boxiness()` and by `flank-model.spec.ts`. Asserting `verticalWallShare`
   * on them would be asserting the wrong thing and would fail honestly-built
   * geometry.
   * ---------------------------------------------------------------------- */

  /** Every tracked vehicle in the game. The Pact hovers; the Reclamation walks. */
  const TRACKED_HULLS: readonly string[] = [
    'allied_guardian', 'allied_ifv', 'allied_prism', 'allied_harvester', 'allied_dozer',
    'soviet_rhino', 'soviet_apocalypse', 'soviet_v4', 'soviet_harvester', 'soviet_dozer',
  ];

  const trackedWalls = UNIT_MASS_LISTS
    .filter((l) => TRACKED_HULLS.includes(l.key))
    .flatMap((l) => expandMasses(l.masses)
      .filter((m) => m.role === MassRole.Primary
        && (m.primitive === 'taperedBox' || m.primitive === 'planPrism'))
      .map((m) => [l, m] as const));

  it('finds a sloped-wall primary on every one of the ten tracked hulls', () => {
    // 17 at the time of writing: 14 `taperedBox` and 3 `planPrism`. If a hull
    // is ever re-authored back onto a legacy primitive it drops out of this
    // list silently, so the count and the per-unit coverage are both pinned.
    expect(trackedWalls.length).toBeGreaterThanOrEqual(17);
    const covered = new Set(trackedWalls.map(([l]) => l.key));
    expect([...covered].sort()).toEqual([...TRACKED_HULLS].sort());
    const kinds = new Set(trackedWalls.map(([, m]) => m.primitive));
    expect([...kinds].sort()).toEqual(['planPrism', 'taperedBox']);
  });

  for (const [l, m] of trackedWalls) {
    it(`${l.key}/${m.name} has no dead-vertical wall on the built mesh`, () => {
      const mesh = builtMesh(m, l.faction)!;
      expect(mesh.polys.length).toBeGreaterThan(0);
      expect(
        verticalWallShare(mesh),
        `${m.primitive} "${m.name}" still has a flat vertical wall. Give it a real ` +
        'topScale/bottomScale/shear — the metric would not have caught this.',
      ).toBe(0);
    });
  }

  it('slopes the tracked hulls far enough to see, not by an epsilon', () => {
    // Same 4% bar the Pact is held to. The tightest on these ten is the
    // harvester scoop at 5.7%; the loosest is the harvester hopper at 23.6%.
    const slim: string[] = [];
    for (const [l, m] of trackedWalls) {
      const { bottom, top } = ringExtents(builtMesh(m, l.faction)!);
      const dx = Math.abs(top[0] - bottom[0]) / Math.max(1e-6, m.size[0]);
      const dz = Math.abs(top[1] - bottom[1]) / Math.max(1e-6, m.size[2]);
      if (Math.max(dx, dz) < 0.04) slim.push(`${l.key}/${m.name} dx=${dx.toFixed(3)} dz=${dz.toFixed(3)}`);
    }
    expect(slim, 'these tapers are too small to read at gameplay zoom').toEqual([]);
  });

  it('leaves every tracked-hull mass inside its declared `size`', () => {
    // R8's dominant-mass floor is 35% and these ten sit at 36.7-40.4%, so a
    // mass that quietly built smaller than its `size` would push one of them
    // through the floor. That is the trap a `prism` -> `planPrism` migration
    // walks into (`silhouetteFillOf` scores them 0.90 and 0.86), and it is why
    // this check is worth repeating here rather than assuming.
    for (const [l, m] of trackedWalls) {
      const mesh = builtMesh(m, l.faction)!;
      for (let a = 0; a < 3; a++) {
        expect(mesh.max[a] - mesh.min[a], `${l.key}/${m.name} axis ${a}`).toBeCloseTo(m.size[a], 6);
      }
    }
  });
});

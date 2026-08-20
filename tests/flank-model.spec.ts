/**
 * ============================================================================
 * tests/flank-model.spec.ts
 * ============================================================================
 * DOES THE DE-BOXIFY METRIC DESCRIBE THE MESH IT SCORES?
 *
 * `MassList.boxiness()` is analytic. It reads `MassDef` fields and never builds
 * a triangle, and §4b says why: a def author gets the number back before any
 * geometry exists. That is a real virtue and it is also a standing hazard —
 * `massFlankSurface` is a HAND-WRITTEN MODEL of what each primitive's geometry
 * does, and nothing anywhere checked the model against the geometry.
 *
 * `tests/unit-silhouette.spec.ts` closed half of this hole: its
 * "the taper reaches the geometry" block builds a mass through the real
 * `shapeSpecFor -> shapeMesh -> fitMesh` path and proves the walls slope. But
 * that block asks "did the AUTHOR's taper reach the mesh". It does not ask
 * "does the METRIC's model of this primitive match the mesh", and those are
 * different questions with different failure modes.
 *
 * THE FAILURE THIS FILE EXISTS FOR
 * -------------------------------
 * `massFlankSurface`'s `tracks` case is the only one in the switch that claims
 * a specific measured number:
 *
 *     case 'tracks': {
 *       const band = 2 * d * h;
 *       return { x: band * 0.38, z: band * 0.04, other: band * 0.58 };
 *     }
 *
 * under a comment reading "The splits are measured off the built meshes with
 * `Shapes.axisAlignedFraction` restricted to horizontal-facing polygons, not
 * guessed: a track run really is ~38% flat wall (the band's two faces), and the
 * wheels, sprocket, idler, teeth and skirt are the rest."
 *
 * Run exactly that procedure on exactly those meshes and it gives 0.78-0.82,
 * not 0.42, and the decomposition is wrong in its parts as well as its total.
 * Measured on `soviet_rhino/track`, as a share of horizontal-facing area:
 *
 *   band      45.0%  of which  89.4% flat     the two +-X caps of the extrusion
 *   skirt     20.3%            97.5% flat     a plate whose thickness runs on X
 *   wheel     19.8%            66.8% flat     disc faces, edge-on to the camera
 *   sprocket   5.7%            50.5% flat
 *   idler      5.7%            50.5% flat
 *   tooth      2.2%            19.3% flat
 *   roller     1.3%            73.2% flat
 *
 * So the band is not 38% of the flank, it is 45% — and the wheels, sprocket,
 * idler, teeth and skirt are not "the rest" in the sense of being the round
 * remainder. Every one of them except the teeth is half flat or better, because
 * every rotating part is a disc lathed about +Y and then turned a quarter turn
 * about Z, so its two circular faces land exactly on +-X, and the skirt is a
 * plate whose thickness runs along X so its two big faces do too.
 *
 * That single constant is the entire axis-aligned flank surface of the ten
 * Allied and Soviet tracked hulls — the only units in the game `boxiness()`
 * scores above zero on the axis sub-metric. Their hulls, turrets, barrels,
 * hoppers, scoops, racks and blades all measure 0.000 and, checked on the mesh,
 * deserve to. What the top of the roster table is measuring is not their art.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT
 * ------------------------------------
 * The same reason `tests/credits-truthful.spec.ts` exists: this rotted because
 * nobody was looking, and a reviewer noticing is not a mechanism. The numbers
 * below are PINNED. If somebody corrects `massFlankSurface`, or changes
 * `trackAssemblyMesh`, these go red and say what to do about it.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import {
  defaultChamfer, eulerMatrix, expandMasses, massFlankSurface, MassRole,
  shapeFitMode, shapeSpecFor, type MassDef, type UnitMassList,
} from '../src/art/MassList';
import { fitMesh, shapeMesh, type ShapeMesh } from '../src/art/Shapes';
import { UNIT_MASS_LISTS } from '../src/art/UnitDefs';
import { MERIDIAN_UNIT_MASS_LISTS } from '../src/art/Faction3Units';
import { RECLAIM_UNIT_MASS_LISTS } from '../src/art/Faction4Units';

/** The same 6-degree window `MassList` uses. Kept local so a drift shows up. */
const AXIS_COS = Math.cos(6 * Math.PI / 180);
/**
 * §4b's deck rule, stated as the section header states it: flank surface is
 * "everything whose normal is more horizontal than vertical". cos 45.
 */
const DECK_COS = Math.SQRT1_2;

/**
 * Build one mass exactly the way `UnitFactory.buildUnit` builds it. Null for
 * the legacy `box` / `lathe` primitives, which `shapeSpecFor` does not own.
 *
 * This is deliberately a copy of `unit-silhouette.spec.ts`'s `builtMesh`,
 * including the 'none' branch that file's header explains: `shapeFitMode`
 * returns 'stretch' | 'uniform' | 'none' and `fitMesh` takes only the first
 * two, so a fit-exempt mass must not be handed to it.
 */
function builtMesh(m: MassDef, faction: UnitMassList['faction']): ShapeMesh | null {
  const spec = shapeSpecFor(m, defaultChamfer(m, faction));
  if (spec === null) return null;
  const fit = shapeFitMode(m);
  const built = shapeMesh(spec);
  return fit === 'none' ? built : fitMesh(built, m.size as [number, number, number], fit);
}

interface Flank {
  /** Square metres of horizontal-facing area lying on a world axis plane. */
  flat: number;
  /** Total horizontal-facing square metres. */
  total: number;
  /** `flat / total`, the thing `massFlankSurface` models. */
  share: number;
}

/**
 * A BUILT mesh's flank split, in world space, under exactly the two rules
 * `massFlankSurface` and `massAxisAlignedFraction` document: decks excluded at
 * 45 degrees, axis alignment judged within 6.
 *
 * `eulerMatrix` is imported rather than reimplemented so the rotation
 * convention cannot drift away from the one the metric uses.
 */
function meshFlank(m: MassDef, faction: UnitMassList['faction']): Flank | null {
  const mesh = builtMesh(m, faction);
  if (mesh === null) return null;
  const r = eulerMatrix(m.rot as [number, number, number] | undefined);
  let flat = 0, total = 0;
  for (const p of mesh.polys) {
    const nx = r[0] * p.n[0] + r[1] * p.n[1] + r[2] * p.n[2];
    const ny = r[3] * p.n[0] + r[4] * p.n[1] + r[5] * p.n[2];
    const nz = r[6] * p.n[0] + r[7] * p.n[1] + r[8] * p.n[2];
    if (Math.abs(ny) >= DECK_COS) continue;
    total += p.area;
    if (Math.abs(nx) >= AXIS_COS || Math.abs(nz) >= AXIS_COS) flat += p.area;
  }
  return { flat, total, share: total > 1e-9 ? flat / total : 0 };
}

/** What `massFlankSurface` predicts for the same mass. */
function modelFlank(m: MassDef, faction: UnitMassList['faction']): Flank {
  const a = massFlankSurface(m, defaultChamfer(m, faction));
  const total = a.x + a.z + a.other;
  return { flat: a.x + a.z, total, share: total > 1e-9 ? (a.x + a.z) / total : 0 };
}

interface Sample { key: string; mass: MassDef; faction: UnitMassList['faction'] }

/** Every primary mass in the game that `shapeSpecFor` can build. */
const SAMPLES: readonly Sample[] = [
  ...UNIT_MASS_LISTS, ...MERIDIAN_UNIT_MASS_LISTS, ...RECLAIM_UNIT_MASS_LISTS,
].flatMap((l) => expandMasses(l.masses)
  .filter((m) => m.role === MassRole.Primary && shapeSpecFor(m, defaultChamfer(m, l.faction)) !== null)
  .map((m) => ({ key: `${l.key}/${m.name}`, mass: m, faction: l.faction })));

const TRACKS = SAMPLES.filter((s) => s.mass.primitive === 'tracks');

/* ========================================================================== */

describe('there is something to measure', () => {
  it('covers the whole game, so this file cannot pass by measuring nothing', () => {
    // 177 primaries across the three rosters at the time of writing. A refactor
    // that sent these back down the legacy `box` path would silently empty
    // every case below.
    expect(SAMPLES.length).toBeGreaterThanOrEqual(150);
    const kinds = new Set(SAMPLES.map((s) => s.mass.primitive));
    // The de-boxify vocabulary, actually in use.
    for (const k of ['taperedBox', 'planPrism', 'revolve', 'plate', 'hull', 'extrude', 'tracks']) {
      expect(kinds, `no primary mass in the game is a \`${k}\``).toContain(k);
    }
  });

  it('measures the ten tracked hulls, which are the whole subject', () => {
    // Every tracked vehicle in the game is Allied or Soviet; the Pact hovers and
    // the Reclamation walks and crawls. This is why the axis sub-metric is
    // non-zero on exactly ten units and exactly zero on the other forty.
    expect(TRACKS).toHaveLength(10);
  });
});

/* ========================================================================== */

describe('`tracks` is the only model that states a measured flat share', () => {
  it('every other primitive is modelled as having no flat wall at all', () => {
    const claims = SAMPLES
      .filter((s) => s.mass.primitive !== 'tracks' && modelFlank(s.mass, s.faction).share > 1e-9)
      .map((s) => `${s.key} (${s.mass.primitive})`);
    // Not a quality claim — a statement of where the model's risk is
    // concentrated. Every other branch of the switch returns a flat share of
    // zero or a closed-form solve, so `tracks` is the one hand-entered constant.
    expect(claims).toEqual([]);
  });

  it('models every track run in the game at exactly 42.0%', () => {
    // x 0.38 + z 0.04 over a total of 1.00, and `massAxisAlignedFraction` finds
    // both local axes horizontal because no track mass is rotated. The constant
    // does not read `size`, `wheels`, `skirtHeight`, `sprocketScale`,
    // `returnRollers` or `segments`, so NOTHING an author can write in
    // `UnitDefs.ts` moves it. That is the fact that makes this a metric bug and
    // not an art bug.
    for (const s of TRACKS) {
      expect(modelFlank(s.mass, s.faction).share, s.key).toBeCloseTo(0.42, 10);
    }
  });

  it('but the mesh those numbers claim to come from measures 78-82%', () => {
    /*
     * THE PIN. `massFlankSurface`'s comment says the split was "measured off the
     * built meshes with `Shapes.axisAlignedFraction` restricted to
     * horizontal-facing polygons". This runs that procedure. If you are here
     * because this went red, the likely causes in order are:
     *
     *   1. you corrected the constant  -> good; retire this case and update
     *      MassList §4b's roster table and tests/unit-silhouette.spec.ts's
     *      SCORE_CEILING / AXIS_CEILING, all of which move with it;
     *   2. you changed `trackAssemblyMesh` -> re-measure and re-pin here;
     *   3. you changed the deck or axis window -> both are named constants at
     *      the top of this file, on purpose.
     */
    for (const s of TRACKS) {
      const mesh = meshFlank(s.mass, s.faction)!;
      expect(
        mesh.share,
        `${s.key}: the model says 42.0%, the built mesh says ${(mesh.share * 100).toFixed(1)}%. ` +
        'The constant is `case \'tracks\'` in MassList.massFlankSurface.',
      ).toBeGreaterThan(0.72);
      expect(mesh.share, s.key).toBeLessThan(0.86);
    }
  });

  it('and models the flank area itself 1.5-2.1x short', () => {
    // `2 * d * h` is the band's two faces and nothing else, so the wheels, the
    // sprocket, the idler, the rollers, the teeth and the skirt contribute no
    // area at all to the model. They are most of what a track run actually is.
    for (const s of TRACKS) {
      const ratio = meshFlank(s.mass, s.faction)!.total / modelFlank(s.mass, s.faction).total;
      expect(ratio, `${s.key} mesh/model flank area`).toBeGreaterThan(1.45);
      expect(ratio, `${s.key} mesh/model flank area`).toBeLessThan(2.10);
    }
  });

  it('because the band, the skirt AND the running gear are all dead flat', () => {
    /*
     * The comment's decomposition, checked part by part. "a track run really is
     * ~38% flat wall (the band's two faces), and the wheels, sprocket, idler,
     * teeth and skirt are the rest" reads as: the band is the flat part and the
     * hardware is the round part. Neither half is true.
     */
    const s = TRACKS.find((t) => t.key === 'soviet_rhino/track')!;
    const mesh = builtMesh(s.mass, s.faction)!;
    const r = eulerMatrix(s.mass.rot as [number, number, number] | undefined);
    const groups = new Map<string, { flat: number; total: number }>();
    let all = 0;
    for (const p of mesh.polys) {
      const nx = r[0] * p.n[0] + r[1] * p.n[1] + r[2] * p.n[2];
      const ny = r[3] * p.n[0] + r[4] * p.n[1] + r[5] * p.n[2];
      const nz = r[6] * p.n[0] + r[7] * p.n[1] + r[8] * p.n[2];
      if (Math.abs(ny) >= DECK_COS) continue;
      const g = groups.get(p.group ?? '(none)') ?? { flat: 0, total: 0 };
      g.total += p.area;
      all += p.area;
      if (Math.abs(nx) >= AXIS_COS || Math.abs(nz) >= AXIS_COS) g.flat += p.area;
      groups.set(p.group ?? '(none)', g);
    }
    const share = (g: string): number => (groups.get(g)?.flat ?? 0) / Math.max(1e-9, groups.get(g)?.total ?? 0);

    // The band is not 38% of the flank — it is 45% of it, and it is ~90% flat,
    // because a stadium extruded along X has two flat +-X caps. What is NOT
    // flat is only the rounded ends of the stadium.
    expect((groups.get('band')!.total) / all, 'band share of flank area').toBeGreaterThan(0.40);
    expect(share('band'), 'band flat share').toBeGreaterThan(0.85);
    // The skirt is a `plateMesh` whose thickness runs along X. Both big faces
    // are flat +-X walls, and it is a fifth of the flank on its own.
    expect(share('skirt'), 'skirt flat share').toBeGreaterThan(0.90);
    // A road wheel is a disc lathed about +Y and turned a quarter turn about Z,
    // so its two circular faces face exactly +-X. V3's 12-segment rim carries
    // more of the measured surface than the old hexagonal approximation, but
    // the two caps must still remain the largest share.
    expect(share('wheel'), 'road-wheel flat share').toBeGreaterThan(0.45);
    expect(share('sprocket'), 'sprocket flat share').toBeGreaterThan(0.45);
    expect(share('idler'), 'idler flat share').toBeGreaterThan(0.45);
    // Eight smaller teeth now follow the sprocket closely enough that their
    // broad faces dominate this axis-bin metric. Pin that measured result: the
    // visual roundness comes from their radial sequence, not curved tooth faces.
    expect(share('tooth'), 'sprocket-tooth flat share').toBeGreaterThan(0.75);
  });
});

/* ========================================================================== */

describe('the analytic model never counts a cap polygon', () => {
  /**
   * The general shape of the defect `tracks` is one instance of.
   *
   * Every branch of `massFlankSurface` solves a primitive's SIDE WALLS and stops
   * there, which is right while a mass sits upright — its caps face +-Y and §4b
   * excludes decks on purpose. `massAxisAlignedFraction` then applies `rot`, but
   * all it can do with a rotation is SWAP which of `x` and `z` counts as flat.
   * There is no path by which cap area enters the flank buckets at all.
   *
   * So a mass whose caps have been turned to face sideways — a disc on its edge,
   * a plate stood upright, an extrusion aimed down +Z — contributes a modelled
   * flat share of exactly zero no matter how flat, how axis-square and how large
   * those caps really are.
   *
   * This case is NOT a claim that every one of these should count. A layered
   * `plate` is the remedy `validateUnit` itself prescribes ("then layer plates
   * over it for the surface read"), and scoring its face as boxiness would
   * penalise the prescribed fix; a road wheel's face is flat but circular, and
   * nobody calls a circle boxy. It is a claim that the gap is real, is large,
   * and is currently undocumented — which is how the `tracks` constant sat
   * wrong through two releases that were specifically about this metric.
   */
  it('so masses whose caps face sideways are modelled at zero and measure high', () => {
    const blind = SAMPLES
      .filter((s) => s.mass.primitive !== 'tracks')
      .map((s) => ({ key: s.key, prim: s.mass.primitive, model: modelFlank(s.mass, s.faction).share, mesh: meshFlank(s.mass, s.faction)!.share }))
      .filter((r) => r.model < 1e-9 && r.mesh > 0.5)
      .sort((a, b) => b.mesh - a.mesh);

    // Non-empty, and every one of them modelled at exactly zero. If a fix to
    // `massFlankSurface` empties this list, delete the case and say so.
    expect(
      blind.length,
      'no mass is modelled flat-free while measuring over 50% flat — if this is ' +
      'because massFlankSurface learned to count caps, retire this case.',
    ).toBeGreaterThan(0);
    for (const r of blind) expect(r.model, `${r.key} (${r.prim})`).toBe(0);
  });
});

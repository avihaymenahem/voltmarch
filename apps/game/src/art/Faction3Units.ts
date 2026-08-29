/**
 * ============================================================================
 * src/art/Faction3Units.ts — THE MERIDIAN PACT, AS UNIT ART
 * ============================================================================
 * The third army's twelve hulls, its unit palette, and the two calls that put
 * them on screen. Nothing here edits `MassList.ts`, `UnitFactory.ts`,
 * `Greeble.ts` or `UnitDefs.ts` — it imports all four and adds beside them.
 *
 *
 * WHY THE PACT DOES NOT LOOK LIKE EITHER EXISTING ARMY
 * ----------------------------------------------------
 * Bible 5.7 separates the Allies and the Soviets on ONE axis — welded ceramic
 * monocoque against bolted plate — and RA3 gets away with that because there
 * are only two of them. A third army placed on the same axis lands in the
 * middle and reads as "the other one". So the Pact is separated on axes the
 * other two do not use at all:
 *
 *   SILHOUETTE   Nothing the Pact fields touches the ground. Every hull rides
 *                a wide OCTAGONAL PLENUM SKIRT that is broader than the body
 *                above it, so the family reads bottom-heavy in plan and
 *                top-heavy in elevation. The Allies stand on proud tracks and
 *                the Soviets on proud tracks; the Pact stands on a shadow.
 *
 *   PLAN         Every load-bearing volume is a HEXAGONAL or OCTAGONAL prism
 *                or a LATHED DRUM. There is not one axis-aligned rectangular
 *                primary mass in the roster, which is the de-boxify gate's
 *                whole point and is why the measured `axisFraction` on these
 *                lists is near zero rather than near the Soviet 0.80.
 *
 *   FURNITURE    Where an Allied hull carries stowage and an aerial and a
 *                Soviet hull carries an exhaust stack and a bolt ring, a Pact
 *                hull carries a CANTED MIRROR VANE. It is on all twelve of
 *                them, it is the thing that makes the army legible at 40 m,
 *                and it is the visual half of the faction's mechanical
 *                signature (see the power argument in src/data/Defs.ts §6).
 *
 *   PALETTE      Warm bone ceramic, JADE team slabs, GOLD emissive. The other
 *                two armies own cool-grey/cobalt/cyan and olive/crimson/orange
 *                respectively; every one of those three channels moves here.
 *
 *
 * SURFACE DISCIPLINE
 * ------------------
 * The texture overhaul is honoured exactly: large flat colour areas, crisp
 * geometric panel lines, vector insignia, ZERO noise. That is not a choice this
 * file gets to make — it is carried by `Greeble.ts`'s painters, and everything
 * here does is choose `plating: 'welded'` (via `rivets: false`) and a gloss
 * that suits fired ceramic. No speckle is reachable from this file.
 *
 *
 * PRIMITIVES
 * ----------
 * This section used to read: "authored in the three primitives
 * `UnitFactory.buildUnit` actually dispatches on today — `box`, `lathe`,
 * `prism`. `Shapes.ts`'s eight new primitives are deliberately NOT used yet:
 * `buildUnit`'s mass loop still ends in `default: buildBox(...)`, so a
 * `revolve` or a `tracks` mass would VALIDATE against its real shape and RENDER
 * as a plain box."
 *
 * THAT HAS NOT BEEN TRUE SINCE THE SHAPE LIBRARY WAS WIRED UP.
 * `UnitFactory.buildUnit`'s mass loop calls `shapeSpecFor(m, chamfer)` first and
 * only falls through to `buildBox` when it returns null — which is now the
 * legacy `'box'` alone. Every `Shapes.ts` primitive builds its real geometry.
 *
 * The note stayed, and because it stayed this file remained the only roster in
 * the game still authored entirely in the three legacy primitives. That is not
 * a cosmetic difference: `MassList.massFlankSurface` sends a wall into the
 * de-boxify gate's `other` bucket only when the wall actually SLOPES, the
 * legacy `prism` builder has no taper at all, and so the Pact's infantry
 * measured 0.173 axis-aligned flank surface while the Allied, Soviet and
 * Reclamation infantry all measured 0.000. A player put it as "troops are too
 * rectangular" and they were right, about this army specifically.
 *
 * EVERY PRIMARY MASS IN THIS FILE IS NOW A SLOPED-WALL PRIMITIVE. The infantry
 * went first (§4); this round finished the job on the hover-tank, support,
 * naval and flyer templates, which had been left holding the four worst
 * axis-aligned scores in the game. Measured, score then axis sub-metric:
 *
 *   meridian_collector  0.564 / 0.415  ->  0.310 / 0.000
 *   meridian_carryall   0.548 / 0.427  ->  0.290 / 0.000
 *   meridian_corvette   0.537 / 0.492  ->  0.233 / 0.000
 *   meridian_monitor    0.535 / 0.491  ->  0.230 / 0.000
 *   meridian_solarch    0.421 / 0.187  ->  0.305 / 0.000
 *   meridian_skiff      0.421 / 0.177  ->  0.310 / 0.000
 *   meridian_zenith     0.434 / 0.154  ->  0.339 / 0.000
 *   meridian_kestrel    0.294 / 0.049  ->  0.264 / 0.000
 *
 * Every Meridian hull measures 0.000 axis-aligned flank surface, which is what
 * the four infantry rosters already measured and what the whole gate is for.
 * The game's worst axis figure is now `allied_harvester` at 0.149 and its worst
 * blended score `allied_prism` at 0.417 — both a long way under where the Pact
 * used to sit, which is what makes tightening `BOXINESS.warn` possible at all.
 * It cost 84 TRIANGLES LESS across the twelve hulls, because a `planPrism` rim
 * chamfer is a band and a fan rather than two quads per plan edge.
 *
 * The fix was `planPrism` carrying the SAME polygon the legacy `prism` was
 * drawing (§2b restates all three at real scale) plus a real taper. No plan
 * changed. The octagonal plenum skirt is still octagonal and still 1.22x the
 * hull; it is a bell now instead of a drum.
 * ============================================================================
 */

import { UNIT_LADDER, type UnitPalette } from '../core/config';
import { EntityKind, Faction, PartId } from '../core/types';
import { GreebleFactory } from './Greeble';
import { MassRole, type MassDef, type SocketSpec, type UnitMassList } from './MassList';
import { UnitLibrary, type UnitModel } from './UnitFactory';
import { IMPORTED_UNIT_SPECS, loadImportedUnitOverride } from './ImportedUnitAssets';
import { IMPORTED_INFANTRY_FAMILIES, loadImportedInfantryFamily } from './ImportedInfantryAssets';
import {
  FACTION_ANY, registerKindMesh, type KindMesh, type SocketSpec as BridgeSocket,
} from '../render/RenderBridge';

/* ==========================================================================
 * 1. THE PALETTE
 * ========================================================================== */

/**
 * THE PACT HULL PALETTE. Same shape as `RA3_ALLIES` / `RA3_SOVIETS` in
 * config.ts, and authored here only because `RA3_UNIT_PALETTE` is a
 * three-member record in a file this module does not own. When
 * `RA3_UNIT_PALETTE.meridian` lands, this constant moves across verbatim.
 *
 * R12 is respected the same way the other two are: `base` is NOT a faction
 * colour. It is fired bone ceramic, and the jade only ever reaches a surface
 * through the `teamSlab` tile, in flat plates measuring 8-14% of the hull.
 */
export const MERIDIAN_UNIT_PALETTE: UnitPalette = {
  /** Fired bone ceramic. Warmer and lighter than Allied grey, far off olive. */
  base: '#C9BFA6',
  shadow: '#3A3226',
  /** Jade. The third primary — neither cobalt nor crimson. */
  team: '#0FA98C',
  teamSecondary: '#0A6E5C',
  /** A radiant rosette rather than an eagle or a star. `Greeble.ts` offers two
   *  glyphs; the star reads as a sun disc under the Pact's gold, which is the
   *  right answer until a third glyph exists. */
  insignia: 'star',
  insigniaColor: '#F2C544',
  hullNumber: 6151,
  /** Gold collector glow. Allied cyan and Soviet furnace orange are both taken. */
  emissive: '#FFC24A',
  bareMetal: '#5D5045',
  /** Read as the plenum skirt's shadow gap rather than as track links. */
  trackLink: '#241C14',
  glass: '#1E3A38',
  stencil: '#E4DCC8',
  hazard: '#E5CB43',
  /** Welded ceramic monocoque, like the Allies. The Pact is not a bolt culture. */
  rivets: false,
};

/**
 * WHICH SURFACE LANGUAGE THE MASS LISTS DECLARE.
 *
 * `UnitMassList.faction` is the union `'allies' | 'soviets' | 'neutral'` in
 * `MassList.ts`, which is not this module's file. The field is read for exactly
 * two things: `defaultChamfer()`'s per-faction fraction, and `validateUnit()`'s
 * "skip team-colour and insignia checks when neutral".
 *
 * `'allies'` is therefore the correct declaration and not a workaround:
 *   - it selects the 10.0% chamfer fraction, which is the welded-ceramic
 *     language the Pact shares with the Allies (the Soviet 7.5% is a bolted
 *     plate figure), and
 *   - it keeps the team-colour band and the one-insignia rule ENFORCED, which
 *     `'neutral'` would silently switch off — the single worst thing that could
 *     happen to a brand new roster.
 *
 * It does not leak Allied colour anywhere: the atlas is built from
 * `MERIDIAN_UNIT_PALETTE` on a private `GreebleFactory`, so the Pact's textures
 * are its own regardless of what this string says.
 */
export const MERIDIAN_ART_FACTION: UnitMassList['faction'] = 'allies';

/** Deterministic, so the atlas is diffable between runs. */
const MERIDIAN_ATLAS_SEED = 0x4d_52;

/** Four-digit stencil, shared by the whole army. */
const HULL_NUMBER = MERIDIAN_UNIT_PALETTE.hullNumber;

/* ==========================================================================
 * 2. MASS CONSTRUCTORS
 *
 * Same five shorthands `UnitDefs.ts` uses, because the validator counts roles
 * and a second vocabulary for the same five roles would be a bug farm.
 * ========================================================================== */

type V3 = readonly [number, number, number];

interface SlabOpts {
  turret?: boolean;
  mirrorX?: boolean;
  rot?: V3;
  /**
   * See `MassDef.gait`. A jade panel painted on a thigh has to swing WITH the
   * thigh, or the walk shears the paint off the leg. `UnitDefs.PanelOpts`
   * carries the same field for the same reason.
   */
  gait?: MassDef['gait'];
}

/** A flat jade panel let into the hull. R-T2: a quad, never a gradient. */
function slab(name: string, size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name, primitive: 'box', role: MassRole.TeamSlab, size, anchor,
    slot: 'teamSlab', chamfer: 0.02,
    ...(o.turret ? { turret: true } : {}),
    ...(o.mirrorX ? { mirrorX: true } : {}),
    ...(o.rot ? { rot: o.rot } : {}),
    ...(o.gait !== undefined ? { gait: o.gait } : {}),
  };
}

/** THE one insignia decal (R-T4). Exactly one per unit or the build is rejected. */
function insignia(size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name: 'insignia', primitive: 'box', role: MassRole.Insignia, size, anchor,
    slot: 'insignia', chamfer: 0.02,
    ...(o.turret ? { turret: true } : {}),
    ...(o.rot ? { rot: o.rot } : {}),
  };
}

/** A masked emissive panel. R-T5: 0.5-3% of surface, clean rectangles only. */
function glow(name: string, size: V3, anchor: V3, o: SlabOpts = {}): MassDef {
  return {
    name, primitive: 'box', role: MassRole.Emissive, size, anchor,
    slot: 'emissive', chamfer: 0.02,
    ...(o.turret ? { turret: true } : {}),
    ...(o.mirrorX ? { mirrorX: true } : {}),
  };
}

function greeble(
  name: string, primitive: MassDef['primitive'], size: V3, anchor: V3,
  slot: MassDef['slot'], extra: Partial<MassDef> = {},
): MassDef {
  return { name, primitive, role: MassRole.Greeble, size, anchor, slot, ...extra };
}

function primary(
  name: string, primitive: MassDef['primitive'], size: V3, anchor: V3,
  slot: MassDef['slot'], extra: Partial<MassDef> = {},
): MassDef {
  return { name, primitive, role: MassRole.Primary, size, anchor, slot, ...extra };
}

/* ==========================================================================
 * 2b. THE PACT'S THREE PLANS, IN METRES
 *
 * `MassList` already owns these three polygons — `HEXAGON`, `octagon(0.20)` and
 * `WEDGE` — but it owns them in UNIT SPACE (-0.5..0.5 on both axes), because
 * that is what the legacy `prism` builder wants: it takes a NAMED plan and
 * multiplies it by `size` itself.
 *
 * `planPrism` takes its plan in real metres instead, and `planPrism` is the only
 * one of the two that can TAPER. So the identical polygons are restated here at
 * real scale. Keeping them identical is the whole point: the Pact's plan
 * language does not change, only whether its walls are allowed to slope.
 *
 * WHY THAT MATTERS, IN ONE PARAGRAPH. `MassList.massFlankSurface` credits a wall
 * to the de-boxify gate's `other` bucket only when the wall actually SLOPES, and
 * `UnitFactory.buildPrism` emits the same plan at both wall rings — it has no
 * taper term at all, so every legacy `prism` stands dead vertical. A hexagon has
 * two walls square to +-Z and an octagon has four; held vertical, those measured
 * as flat axis-aligned rectangle and put the Pact's hover, support, naval and
 * flyer hulls at the four worst boxiness scores in the game.
 * ========================================================================== */

/** A CCW-from-above plan in metres — what `MassShape.plan` wants. */
type Plan = readonly (readonly [number, number])[];

/**
 * THE PACT HEXAGON: points at +-X, flat walls at +-Z. `MassList`'s `HEXAGON`
 * at real scale.
 */
function hexPlan(w: number, d: number): Plan {
  const a = w * 0.5, b = d * 0.5;
  return [[-a * 0.5, -b], [a * 0.5, -b], [a, 0], [a * 0.5, b], [-a * 0.5, b], [-a, 0]];
}

/**
 * THE PLENUM OCTAGON. `MassList`'s `octagon(0.20)` at real scale — the corner
 * cut is 20% of each half-extent, which is what `planPolygon('octagon', 0)`
 * resolves to and therefore what every Pact skirt and chassis has always been.
 */
function octPlan(w: number, d: number): Plan {
  const a = w * 0.5, b = d * 0.5, k = 0.6;   // 0.3 / 0.5
  return [
    [-a * k, -b], [a * k, -b], [a, -b * k], [a, b * k],
    [a * k, b], [-a * k, b], [-a, b * k], [-a, -b * k],
  ];
}

/** THE PROW WEDGE: full beam aft, tapering to a stem at +Z. `MassList`'s `WEDGE`. */
function wedgePlan(w: number, d: number): Plan {
  const a = w * 0.5, b = d * 0.5;
  return [[-a, -b], [a, -b], [a * 0.60, b * 0.48], [0, b], [-a * 0.60, b * 0.48]];
}

/* ==========================================================================
 * 3. THE TWO SUB-ASSEMBLIES THAT MAKE THE ARMY
 * ========================================================================== */

/**
 * THE PLENUM SKIRT — the Pact's answer to the proud track pair.
 *
 * Bible 5.3 asks a ground vehicle for a base that protrudes outboard and stands
 * 18-25% of unit height; the Allies and Soviets both answer with tracks. The
 * Pact answers with one OCTAGONAL prism wider than the hull above it, its walls
 * slotted as `grille` so the intake plenum reads as dark plant against the bone
 * body — the same tonal job the near-black track links do, with none of the
 * same shape. Two lift-fan rows break through the outboard shoulder of the
 * plenum, where their rotors and blades remain visible from the tactical camera
 * instead of being buried under the hull cap.
 *
 * `outboard` is the skirt half-width over the hull half-width. 1.22 puts the
 * turret/hull width ratio at 1.02/1.22 = 0.84, dead centre of R8's 0.75-0.95.
 *
 * THE WALLS SLOPE, and that is not decoration. `size` is unchanged, so every R8
 * number derived from it — the outboard fraction, the turret/hull ratio, the
 * silhouette rectangle — is exactly what it was; what changed is that the OCTAGON
 * IS NOW A REAL BELL. The widest ring is the one at the ground, where a plenum's
 * cushion actually escapes, and it draws in to 0.84 x 0.88 at the top, which
 * lands the skirt's crown at 1.02 x the hull box it meets. Before this the eight
 * walls were dead vertical (`buildPrism` has no taper term) and four of them
 * measured as flat axis-aligned rectangle — on the tanks the skirt was the
 * flattest primary mass at 0.56, and it is 0.000 now.
 */
function plenumSkirt(hullWidth: number, skirtHeight: number, length: number, fans: number): MassDef[] {
  const w = hullWidth * 1.22;
  const out: MassDef[] = [
    primary('skirt', 'planPrism', [w, skirtHeight, length], [0, skirtHeight * 0.5, 0], 'grille', {
      capSlot: 'paintSmall', chamfer: 0.06,
      shape: { plan: octPlan(w, length), topScaleX: 0.84, topScaleZ: 0.88 },
    }),
  ];
  // `r` is the authored DISC DIAMETER (lathe sizes are diameters). Keep the fan
  // inside the skirt, but move its centre far enough outboard that the hull no
  // longer covers the whole intake from above.
  const r = Math.min(skirtHeight * 1.30, hullWidth * 0.20);
  const fanX = hullWidth * 0.48;
  const fanR = r * 0.5;
  for (let i = 0; i < fans; i++) {
    const z = -length * 0.34 + (length * 0.68 * i) / Math.max(1, fans - 1);
    out.push(greeble(`fan${i}`, 'lathe', [r, skirtHeight * 0.42, r], [fanX, skirtHeight * 0.90, z], 'bareMetal', {
      // The fan run is ONE readable object, so all of them share a group and
      // cost a single slot against bible 5.3's 6-12 detail budget.
      mirrorX: true, profile: 'disc', segments: 18, group: 'liftFans',
    }));
    // One triangular impeller plate gives the intake three broad vanes as one
    // coherent object. The negative-space metal rim around it does more visual
    // work than twelve tiny boxes, while keeping the whole vehicle under the
    // per-hull triangle budget.
    const bladeRadius = fanR * 0.74;
    out.push(greeble(`fan${i}.rotor`, 'plate',
      [bladeRadius * 1.72, Math.max(0.04, skirtHeight * 0.08), bladeRadius * 1.50],
      [fanX, skirtHeight * 1.12, z], 'grille', {
        mirrorX: true, rot: [0, 0.22, 0], group: 'liftFans',
        shape: {
          outline: [
            [0, bladeRadius],
            [-bladeRadius * 0.866, -bladeRadius * 0.5],
            [bladeRadius * 0.866, -bladeRadius * 0.5],
          ],
          thickness: Math.max(0.04, skirtHeight * 0.08),
          bevel: 0.018,
        },
      }));
  }
  return out;
}

/**
 * THE MIRROR VANE — the faction cue, on all twelve hulls.
 *
 * A canted collector panel with a gold strip along its leading edge. Rotated on
 * two axes on purpose: a vane that lay flat would read as a hatch, and the
 * whole point is that the Pact's hardware is visibly harvesting light.
 */
function mirrorVane(
  name: string, span: number, chord: number, anchor: V3, tilt: number, o: Partial<MassDef> = {},
): MassDef[] {
  return [
    greeble(name, 'box', [span, 0.10, chord], anchor, 'stripe', {
      rot: [tilt, 0, 0.16], group: name, faceSlots: { py: 'glass' }, chamfer: 0.03, ...o,
    }),
    greeble(`${name}.spar`, 'box', [0.11, 0.11, chord * 0.92], [anchor[0], anchor[1] - 0.16, anchor[2]], 'bareMetal', {
      rot: [tilt, 0, 0.16], group: name, chamfer: 0.02, ...o,
    }),
  ];
}

/**
 * The furniture every Pact hull carries. Five discrete objects, all >= 0.14 m
 * so nothing is sub-pixel at gameplay zoom.
 */
function pactGreebles(hullW: number, hullL: number, deckY: number): MassDef[] {
  return [
    greeble('radiator', 'box', [hullW * 0.30, 0.24, hullL * 0.18], [-hullW * 0.30, deckY + 0.12, -hullL * 0.34], 'vent', {
      mirrorX: true, group: 'radiators',
    }),
    greeble('capacitor', 'lathe', [0.30, 0.58, 0.30], [hullW * 0.32, deckY + 0.29, -hullL * 0.30], 'bareMetal', {
      mirrorX: true, profile: 'capsule', segments: 12, group: 'capacitors',
    }),
    greeble('lamp', 'box', [0.28, 0.22, 0.16], [hullW * 0.30, deckY - 0.06, hullL * 0.44], 'paintTiny', {
      mirrorX: true, faceSlots: { pz: 'glass' }, group: 'lamps',
    }),
    greeble('towEye', 'lathe', [0.22, 0.30, 0.22], [hullW * 0.20, deckY - 0.24, hullL * 0.47], 'bareMetal', {
      mirrorX: true, profile: 'disc', segments: 10, rot: [0, 0, Math.PI * 0.5], group: 'towEyes',
    }),
    greeble('deckLouvre', 'box', [hullW * 0.44, 0.10, hullL * 0.18], [0, deckY + 0.05, -hullL * 0.20], 'paintTiny', {
      faceSlots: { py: 'grille' }, group: 'louvres',
    }),
  ];
}

/* ==========================================================================
 * 4. INFANTRY
 *
 * R-S4: 0.30-0.38 x a 7 m MBT hull. The Pact silhouette differs from a
 * Conscript's at 20 px by three things and only three: a CONICAL helmet where
 * the other two armies wear domes, a hard SHOULDER MANTLE plate, and the vane
 * on the pack. Everything below the waist is deliberately identical, because
 * legs at that pixel count are two smudges whatever you do to them.
 * ========================================================================== */

interface PactInfantryOpts {
  key: string;
  name: string;
  /** 'carbine' | 'lance' | 'tool' — the held object and nothing else. */
  weapon: 'carbine' | 'lance' | 'tool';
  /**
   * 'vane' collector pack | 'cells' battery stack | 'kit' artificer's case |
   * 'gills' the tidewalker's sealed rebreather.
   *
   * `'gills'` ALSO REPLACES THE BOOT WITH A SWIM FIN, exactly as
   * `UnitDefs.InfantryOpts.pack` does with `'rebreather'`, and for the reason
   * given there: the swimmers are the only soldiers whose silhouette has to
   * read as amphibious at 20 px, and one option that cannot be half-applied
   * beats two that can. Every other pack leaves the boot alone.
   */
  pack: 'vane' | 'cells' | 'kit' | 'gills';
  /**
   * A commander. Three added shapes, all in the outline — see the note on
   * `InfantryOpts.officer` in `UnitDefs.ts`, which this mirrors deliberately so
   * all four armies' heroes read as heroes by the same rule.
   *
   * This army's version is liturgical: a vestment rather than a cape, a
   * mantle that continues the hexagonal plan language, and a taller cone.
   */
  officer?: boolean;
}

function pactInfantry(o: PactInfantryOpts): UnitMassList {
  const H = UNIT_LADDER.infantryHeightMeters;      // 2.2 m
  const W = UNIT_LADDER.infantryWidthMeters;       // 0.78 m shoulder span
  const legTop = H * 0.415;
  const torsoH = H * 0.415;
  const torsoY = legTop + torsoH * 0.5;            // 0.623 H — the dominant mass
  const torsoW = W * (o.officer === true ? 1.02 : 0.86);
  const torsoD = W * (o.officer === true ? 1.00 : 0.86);

  /**
   * THE WALK, which this army did not have.
   *
   * v1.17.0 shipped the infantry walk cycle and it reached the Allied and Soviet
   * rosters only, because it was authored inside `UnitDefs.infantry()` and
   * nothing else was looked at. `grep -c gait` returned 10 for `UnitDefs.ts` and
   * 0 for both this file and `Faction4Units.ts`: half the game's armies slid
   * along the ground with their legs welded shut, and `tests/unit-gait.spec.ts`
   * could not see it because it imported `UNIT_MASS_LISTS` and inspected Allied
   * keys only.
   *
   * The MECHANISM is exactly `UnitDefs`': there is only one, and a second one
   * would be a bug farm. `MassDef.gait` bakes `(swingSign, pivotY)` into a
   * per-vertex `aGait` attribute over the vertices this mass emits, `mirrorX`
   * flips the sign so ONE declaration animates both limbs, 'arm' inverts it
   * again for the contralateral rhythm, and `src/render/Gait.ts` rotates about
   * the X axis through `pivotY` in the vertex stage. Nothing per-frame is added:
   * `unit-anim.system.ts` already walked every `EntityKind.Infantry` including
   * these four, wrote their phase, and had no vertices to move.
   *
   * The PIVOTS are the Pact's own. The shoulder sits at the mantle line rather
   * than at `torsoH * 0.30`, which is where the Allied and Soviet arms hang
   * from — this army wears a hard shoulder plate and the arm swings from under
   * it, so the stroke is shorter and higher and the figure reads processional
   * rather than jogging. The hip is `legTop` and is NOT a free choice: boot and
   * thigh band repeat it exactly, and a limb whose parts pivot about different
   * heights shears itself apart in motion.
   */
  const hip = { limb: 'leg', pivotY: legTop } as const;
  const shoulder = { limb: 'arm', pivotY: torsoY + torsoH * 0.36 } as const;

  const masses: MassDef[] = [
    // The legs are the one primary that was never the problem: the legacy `box`
    // builder DOES honour `taper`, so these walls already slope from thigh to
    // ankle and already measure 0.000 axis-aligned. Left alone deliberately —
    // `taperedBox` would fit the tapered mesh INSIDE `size` where `buildBox`
    // lets the top overhang it, so migrating would quietly slim the thigh by
    // 22% for no gain on any metric.
    primary('leg', 'box', [W * 0.34, legTop, W * 0.44], [W * 0.24, legTop * 0.5, 0], 'paintSmall', {
      mirrorX: true, taper: [1.22, 1.08, 0.02], gait: hip,
    }),
    // Hexagonal torso: the Pact's plan language reaches all the way down to a
    // 2 m figure, and it is what stops the silhouette reading as a Conscript.
    //
    // A `planPrism` and NOT the legacy `prism`, and that is the whole fix for
    // "troops are too rectangular". A hexagonal plan still has two walls square
    // to +-Z — the chest and the back — and an untapered prism holds them
    // vertical, so the de-boxify gate scored this mass at 0.275 axis-aligned
    // flank surface and it was the single largest contributor on the roster.
    // `buildPrism` cannot taper; `prismFromPlanMesh` can, and a wall that slopes
    // is not a flat rectangle to the metric OR to the eye.
    //
    // The taper is also just correct: broad across the chest, drawn in at the
    // waist, and carried a few centimetres back at the top so the figure reads
    // upright and ceremonial rather than hunched — the Reclamation's infantry
    // shear the other way on purpose (`Faction4Units.ts`), and at 20 px the
    // direction of that lean is one of the few things that still reads.
    //
    // The Hierarch's is BROADER — R-S4 holds the dominant mass to 35-50% of the
    // silhouette, and hanging a vestment off the back adds silhouette the torso
    // then does not own. Measured: 32.1% with the base torso, which the
    // validator rejected outright. Widening in X and Z only leaves the 2.1-2.7 m
    // height band untouched.
    primary('torso', 'planPrism', [torsoW, torsoH, torsoD], [0, torsoY, 0], 'paintMed', {
      capSlot: 'paintSmall',
      shape: {
        plan: hexPlan(torsoW, torsoD),
        topScaleX: 1.00, topScaleZ: 0.94,
        bottomScaleX: 0.78, bottomScaleZ: 0.86,
        shear: -W * 0.05,
      },
    }),
    // Conical helmet, not a dome. One shape, read at any distance. A revolve has
    // no flat wall at any segment count, so this mass was never part of the
    // problem and is left on the legacy `lathe` builder that already draws it.
    primary('helmet', 'lathe', [W * 0.58, H * 0.150, W * 0.60], [0, legTop + torsoH + H * 0.050, 0.01], 'paintSmall', {
      profile: 'cone', segments: 20, topRadius: 0.34,
    }),
    // The other half of the fix. This was a DEAD STRAIGHT box — four vertical
    // walls, no taper, 0.387 axis-aligned, and doubled because it is mirrored.
    // Tapering it from the mantle down to the gauntlet costs nothing (a
    // `taperedBox` emits FEWER triangles than the legacy chamfered box) and is
    // what an armoured arm is shaped like.
    primary('arm', 'taperedBox', [W * 0.24, torsoH * 0.86, W * 0.28], [W * 0.52, torsoY + 0.02, 0.06], 'paintSmall', {
      mirrorX: true, rot: [0.12, 0, -0.06], gait: shoulder,
      shape: { topScaleX: 1.20, topScaleZ: 1.12, bottomScaleX: 0.74, bottomScaleZ: 0.82 },
    }),
    // A faceted ceramic gauntlet carries the Pact's hexagonal language into
    // the hand silhouette. It shares the shoulder pivot with the forearm so it
    // cannot shear loose when the procedural gait swings.
    greeble('gauntlet', 'planPrism', [W * 0.29, torsoH * 0.18, W * 0.32],
      [W * 0.52, torsoY - torsoH * 0.37, 0.12], 'paintTiny', {
        mirrorX: true, group: 'gauntlets', gait: shoulder, capSlot: 'bareMetal',
        shape: {
          plan: hexPlan(W * 0.29, W * 0.32),
          topScaleX: 0.80, topScaleZ: 0.84,
          bottomScaleX: 1.08, bottomScaleZ: 1.12,
        },
      }),
  ];

  if (o.weapon === 'lance') {
    masses.push(greeble('lanceTube', 'lathe', [0.19, 1.06, 0.19], [W * 0.50, torsoY + 0.20, 0.22], 'bareMetal', {
      profile: 'cyl', segments: 12, topRadius: 0.84, rot: [1.30, 0, 0.10], group: 'lance',
    }));
    masses.push(greeble('lanceRing', 'lathe', [0.30, 0.16, 0.30], [W * 0.50, torsoY + 0.52, 0.54], 'bareMetal', {
      profile: 'disc', segments: 12, rot: [1.30, 0, 0.10], group: 'lance',
    }));
  } else if (o.weapon === 'tool') {
    masses.push(greeble('toolArm', 'lathe', [0.15, 0.74, 0.15], [W * 0.52, torsoY - 0.10, 0.34], 'bareMetal', {
      profile: 'cyl', segments: 10, rot: [Math.PI * 0.5, 0, 0], group: 'tool',
    }));
    masses.push(greeble('toolHead', 'prism', [0.26, 0.22, 0.22], [W * 0.52, torsoY - 0.10, 0.74], 'paintTiny', {
      plan: 'hexagon', capSlot: 'paintTiny', group: 'tool',
    }));
  } else {
    masses.push(greeble('carbine', 'planPrism', [0.12, 0.17, 0.94], [W * 0.44, torsoY - 0.04, 0.24], 'bareMetal', {
      rot: [0.18, 0.06, 0], group: 'carbine', capSlot: 'paintTiny',
      shape: {
        plan: hexPlan(0.12, 0.94),
        topScaleX: 0.88, topScaleZ: 0.74,
        bottomScaleX: 1.04, bottomScaleZ: 1.00,
        shear: 0.02,
      },
    }));
    masses.push(greeble('cell', 'prism', [0.12, 0.22, 0.16], [W * 0.44, torsoY - 0.20, 0.16], 'paintTiny', {
      plan: 'hexagon', capSlot: 'emissive', group: 'carbine',
    }));
  }

  if (o.pack === 'cells') {
    masses.push(greeble('cellStack', 'prism', [W * 0.56, 0.44, 0.24], [0, torsoY + 0.10, -W * 0.42], 'paintSmall', {
      plan: 'hexagon', capSlot: 'paintTiny', group: 'pack',
    }));
  } else if (o.pack === 'kit') {
    masses.push(greeble('kit', 'planPrism', [W * 0.62, 0.42, 0.22], [0, torsoY + 0.06, -W * 0.42], 'paintSmall', {
      group: 'pack', capSlot: 'paintTiny',
      shape: {
        plan: hexPlan(W * 0.62, 0.22),
        topScaleX: 0.92, topScaleZ: 0.86,
        bottomScaleX: 1.04, bottomScaleZ: 1.02,
      },
    }));
  } else if (o.pack === 'gills') {
    // A LATHED BELL, not the twin bottles the other three armies' divers wear.
    // The Pact does not carry its air; it carries a ceramic gill that takes the
    // oxygen out of the water, and the shape says so — one drum with a hex
    // manifold on it rather than two steel tubes and a yoke.
    masses.push(greeble('gill', 'lathe', [W * 0.56, 0.52, 0.30], [0, torsoY + 0.12, -W * 0.44], 'paintSmall', {
      profile: 'capsule', segments: 12, rot: [0, 0, Math.PI * 0.5], group: 'pack',
    }));
    masses.push(greeble('gillYoke', 'prism', [W * 0.34, 0.16, 0.22], [0, torsoY + 0.42, -W * 0.40], 'bareMetal', {
      plan: 'hexagon', capSlot: 'bareMetal', group: 'pack',
    }));
  } else {
    masses.push(greeble('collector', 'planPrism', [W * 0.52, 0.40, 0.20], [0, torsoY + 0.10, -W * 0.42], 'paintSmall', {
      group: 'pack', capSlot: 'bareMetal',
      shape: {
        plan: hexPlan(W * 0.52, 0.20),
        topScaleX: 0.86, topScaleZ: 0.82,
        bottomScaleX: 1.06, bottomScaleZ: 1.04,
        shear: -0.02,
      },
    }));
  }
  // The faction cue, at infantry scale: a folded vane over the shoulder.
  masses.push(...mirrorVane('vane', W * 0.66, 0.34, [0, torsoY + 0.44, -W * 0.30], -0.55));

  masses.push(
    // Sized so every variant tops out at exactly H whatever it carries, so the
    // R-S4 height ratio cannot swing with the backpack.
    greeble('crest', 'lathe', [0.06, H * 0.13, 0.06], [-W * 0.16, H - H * 0.065, -0.05], 'bareMetal', {
      profile: 'cyl', segments: 8, group: 'crest',
    }),
    // Boot and thigh band ride the SAME hip as the leg. The boot is the far end
    // of the limb, so a boot left welded to the ground is the single most
    // obvious way a walk cycle can look broken. The fin keeps the boot's NAME
    // and group as well as its pivot — `RIDES_THE_LEG` in
    // `tests/infantry-gait-rosters.spec.ts` is keyed on the name.
    o.pack === 'gills'
      ? greeble('boot', 'taperedBox', [W * 0.42, 0.13, W * 1.18], [W * 0.24, 0.066, W * 0.24], 'paintTiny', {
        mirrorX: true, group: 'boots', gait: hip,
        shape: { topScaleX: 0.60, topScaleZ: 1.16, shear: W * 0.14, cornerCut: 0.08 },
      })
      : greeble('boot', 'planPrism', [W * 0.42, 0.16, W * 0.64], [W * 0.24, 0.08, 0.06], 'paintTiny', {
        mirrorX: true, group: 'boots', gait: hip, capSlot: 'bareMetal',
        shape: {
          plan: hexPlan(W * 0.42, W * 0.64),
          topScaleX: 0.82, topScaleZ: 0.80,
          bottomScaleX: 1.02, bottomScaleZ: 1.08,
          shear: -0.04,
        },
      }),
    greeble('belt', 'planPrism', [W * 0.90, 0.12, W * 0.66], [0, torsoY - torsoH * 0.34, 0], 'paintTiny', {
      group: 'belt', shape: { plan: hexPlan(W * 0.90, W * 0.66), topScaleX: 0.96, topScaleZ: 0.94 },
    }),
    greeble('gorget', 'prism', [W * 0.60, 0.11, W * 0.50], [0, legTop + torsoH - 0.03, 0], 'paintTiny', {
      group: 'gorget', plan: 'hexagon', capSlot: 'bareMetal',
    }),
  );

  if (o.officer === true) {
    masses.push(
      // The vestment: a tall, thin hexagonal slab hung down the back. A
      // `prism` and not a `plate` on purpose — the hexagon IS this army's plan
      // language, and it is one of the three primitives this file's header
      // commits to, so the vestment cannot quietly render as a box the way an
      // unsupported primitive would.
      greeble('vestment', 'prism', [W * 0.88, 1.00, 0.10], [0, torsoY - torsoH * 0.30, -W * 0.46], 'paintMed', {
        plan: 'hexagon', capSlot: 'paintSmall', rot: [0.14, 0, 0], group: 'vestment',
      }),
      // A hexagonal shoulder mantle, LEFT only. The plan language reaches the
      // hero the same way it reaches the tanks.
      greeble('mantleHigh', 'prism', [W * 0.50, 0.30, W * 0.52], [-W * 0.46, torsoY + torsoH * 0.36, 0], 'paintSmall', {
        plan: 'hexagon', capSlot: 'paintTiny', rot: [0, 0, 0.20], group: 'mantle',
      }),
      // The cone grows a finial. Anchored so the top lands on H, like the
      // crest greeble it stands beside.
      greeble('finial', 'lathe', [0.09, H * 0.15, 0.09], [0, H - H * 0.075, -0.02], 'bareMetal', {
        profile: 'cone', segments: 8, topRadius: 0.12, group: 'crest',
      }),
    );
  }

  // R-T1 for infantry is 20-28% of surface: chest, both mantles, helmet band,
  // thigh bands. Sizes are the proven ones from the shipped roster.
  masses.push(
    slab('chestPlate', [W * 0.72, torsoH * 0.66, 0.06], [0, torsoY + 0.04, W * 0.32]),
    slab('mantle', [W * 0.34, 0.34, W * 0.44], [W * 0.44, torsoY + torsoH * 0.30, 0], { mirrorX: true }),
    slab('helmBand', [W * 0.58, 0.12, W * 0.62], [0, legTop + torsoH + H * 0.030, 0.01]),
    slab('thighBand', [W * 0.42, 0.20, W * 0.50], [W * 0.24, legTop * 0.72, 0], { mirrorX: true, gait: hip }),
  );
  masses.push(insignia([0.26, 0.26, 0.05], [W * 0.30, torsoY + torsoH * 0.24, W * 0.33]));
  masses.push(
    glow('visor', [W * 0.46, 0.14, 0.05], [0, legTop + torsoH + H * 0.030, W * 0.29]),
    glow('packLamp', [W * 0.30, 0.16, 0.05], [0, torsoY + 0.24, -W * 0.53]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.MuzzleA, pos: [W * 0.44, torsoY + 0.02, 0.78] },
    { part: PartId.Emitter, pos: [0, torsoY, 0] },
  ];

  return {
    key: o.key,
    name: o.name,
    faction: MERIDIAN_ART_FACTION,
    cls: 'infantry',
    hullLength: W,
    masses,
    sockets,
    hullNumber: HULL_NUMBER,
  };
}

/* ==========================================================================
 * 5. THE HOVER-TANK TEMPLATE
 *
 * The proportions are the shipped tank template's to the digit — chassis in the
 * bottom 42%, dominant mass centred at 0.655 H, turret at 1.02x the hull box —
 * because those numbers are what R8 measures and they are already proven to
 * land inside every band. What changes is every SHAPE that carries them.
 * ========================================================================== */

interface PactTankOpts {
  key: string;
  name: string;
  hullLength: number;
  hullWidth: number;
  /** Total silhouette height including the mast. */
  height: number;
  /** 'lance' single barrel | 'repeater' twin | 'emitter' beam head. */
  gun: 'lance' | 'repeater' | 'emitter';
  fans?: number;
}

function pactTank(o: PactTankOpts): UnitMassList {
  const H = o.height;
  const L = o.hullLength;
  const W = o.hullWidth;

  const skirtH = H * UNIT_LADDER.chassisHeightFraction * 0.55;
  const hullH = H * 0.255;
  const hullY = skirtH + hullH * 0.5;
  const turretH = H * 0.46;
  const turretY = H * 0.625;
  const turretW = W * UNIT_LADDER.turretWidthOverHull;
  const turretL = L * 0.72;
  // The beam emitter needs a deeper gun house to cradle its long power head.
  // Width stays on the shared faction ratio; only the longitudinal bustle grows.
  const turretShellL = turretL * (o.gun === 'emitter' ? 1.12 : 1.0);
  const deckY = skirtH + hullH;
  const turretRoof = turretY + turretH * 0.5;

  const masses: MassDef[] = [
    ...plenumSkirt(W, skirtH, L * 0.94, o.fans ?? 4),
    // Hexagonal hull: a pointed prow and a pointed transom in plan, so the
    // flanks are four angled walls rather than two flat ones.
    //
    // That sentence used to end "and it has no axis-aligned wall at all", which
    // was false. A hexagon has SIX walls and two of them — the cheeks either
    // side of the prow point — are square to +-X; held vertical by a builder
    // with no taper term, they measured as flat axis-aligned rectangle. The
    // taper is what makes the claim true: the deck draws in and slides aft, so
    // the prow reads as a raked glacis and no wall on the hull is a vertical
    // plane. `shear` is held under `(1 - topScaleZ) * L / 2` on purpose — past
    // that the sheared top ring pushes the mass's own Z bounds out and `fitMesh`
    // squashes the whole hull back to `size`, silently shortening it.
    primary('hull', 'planPrism', [W, hullH, L], [0, hullY, 0], 'paintLarge', {
      capSlot: 'paintLarge',
      shape: {
        plan: hexPlan(W, L),
        topScaleX: 0.86, topScaleZ: 0.92, shear: -L * 0.035,
      },
    }),
    // Lathed drum turret, tapering to a smaller crown. Deliberately oversized
    // at 1.02x the hull box (bible 5.3 — a real MBT is 0.55 and RA3 is not real).
    primary('turret', 'lathe', [turretW * 1.08, turretH, turretShellL], [0, turretY, -L * 0.04], 'paintLarge', {
      turret: true, profile: 'cyl', segments: 24, topRadius: 0.70, capSlot: 'paintMed',
    }),
  ];

  /* -- armament ---------------------------------------------------------- */
  // Keep the live socket on the visible weapon, but do not stretch the Pact's
  // compact energy heads into Allied long-gun proportions. The old 0.40L
  // socket sat 1.7 m beyond a Solarch's bow and forced aligned geometry to
  // overwhelm the turret silhouette; 0.24L leaves a clear 0.6-0.7 m projection.
  const muzzleZ = turretL * 0.5 + L * 0.24;
  const gunY = turretY + turretH * 0.04;
  switch (o.gun) {
    case 'repeater': {
      const barrelLength = L * 0.58;
      masses.push(
        primary('barrel', 'lathe', [0.24, barrelLength, 0.24], [W * 0.15, gunY, muzzleZ - barrelLength * 0.5], 'bareMetal', {
          turret: true, mirrorX: true, profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0], topRadius: 0.88,
        }),
        greeble('muzzleRing', 'lathe', [0.34, 0.26, 0.34], [W * 0.15, gunY, muzzleZ - 0.13], 'bareMetal', {
          turret: true, mirrorX: true, profile: 'disc', segments: 12, rot: [Math.PI * 0.5, 0, 0], group: 'muzzles',
        }),
      );
      break;
    }
    case 'emitter': {
      const crystalLength = 0.44;
      const housingLength = L * 0.46;
      const crystalBase = muzzleZ - crystalLength;
      masses.push(
        primary('emitterHousing', 'lathe', [W * 0.46, housingLength, W * 0.46], [0, gunY + 0.10, crystalBase - housingLength * 0.5], 'paintMed', {
          turret: true, profile: 'cyl', segments: 14, rot: [Math.PI * 0.5, 0, 0], topRadius: 0.70,
        }),
        greeble('emitterCrystal', 'lathe', [W * 0.28, crystalLength, W * 0.28], [0, gunY + 0.10, muzzleZ - crystalLength * 0.5], 'emissive', {
          turret: true, profile: 'cone', segments: 8, topRadius: 0.22, rot: [Math.PI * 0.5, 0, 0], group: 'muzzles',
        }),
      );
      break;
    }
    default: {
      const lanceLength = L * 0.66;
      masses.push(
        primary('lance', 'lathe', [0.34, lanceLength, 0.34], [0, gunY, muzzleZ - lanceLength * 0.5], 'bareMetal', {
          turret: true, profile: 'cyl', segments: 14, rot: [Math.PI * 0.5, 0, 0], topRadius: 0.80,
        }),
        greeble('lanceCollar', 'lathe', [0.48, 0.34, 0.48], [0, gunY, muzzleZ - 0.17], 'bareMetal', {
          turret: true, profile: 'cyl', segments: 14, topRadius: 0.78, rot: [Math.PI * 0.5, 0, 0], group: 'muzzles',
        }),
      );
      break;
    }
  }

  /* -- greebles ---------------------------------------------------------- */
  masses.push(
    ...pactGreebles(W, L, deckY),
    // The vane sits on the REAR DECK, not the turret roof. A rotated plate's
    // axis-aligned extent is `2*(|sx.z|*hz + ...)`, so a 1.2 m chord tilted 35
    // degrees adds 0.36 m to `bounds[1]` — and `bounds[1]` is the divisor in the
    // top-heavy check, so a vane on the roof pushes the dominant mass centre
    // out of R8's 0.60-0.70 band and rejects the whole hull.
    ...mirrorVane('vane', W * 0.68, L * 0.24, [-W * 0.18, deckY + 0.38, -L * 0.30], -0.48),
    greeble('mantlet', 'lathe', [turretW * 0.42, turretH * 0.66, turretW * 0.42], [0, gunY, turretL * 0.46], 'bareMetal', {
      turret: true, profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0], group: 'mantlet',
    }),
    // Everything above the turret roof is sized so the silhouette tops out at
    // exactly H: an overshooting mast would push `bounds[1]` past the height
    // the top-heavy check divides by, and every hull would fail it.
    greeble('cupola', 'lathe', [turretW * 0.30, H * 0.085, turretW * 0.30], [turretW * 0.24, turretRoof + H * 0.042, -turretL * 0.10], 'hatch', {
      turret: true, profile: 'dome', segments: 12, group: 'cupola',
    }),
    greeble('sensorMast', 'lathe', [0.07, H * 0.155, 0.07], [-turretW * 0.38, H - H * 0.078, -turretL * 0.36], 'bareMetal', {
      turret: true, profile: 'cyl', segments: 8, group: 'mast',
    }),
  );

  if (o.key === 'meridian_solarch') {
    masses.push(
      // The Solarch's lance used to leave the broad drum through one round
      // collar, making the expensive main-line hull read less resolved than
      // its simpler siblings. A low hexagonal yoke now bridges the barrel into
      // the turret cheeks and repeats the Pact's faceted ceramic language.
      greeble('lanceYoke', 'planPrism', [turretW * 0.66, H * 0.10, turretL * 0.20],
        [0, gunY + H * 0.09, turretL * 0.36], 'paintMed', {
          turret: true, capSlot: 'paintTiny', group: 'mantlet',
          shape: {
            plan: hexPlan(turretW * 0.66, turretL * 0.20),
            topScaleX: 0.82, topScaleZ: 0.78,
          },
        }),
      // One offset optical jewel, not a symmetric pair: the Pact stays
      // ceremonial and precise instead of drifting into Allied twin optics.
      greeble('lanceOptic', 'lathe', [W * 0.18, H * 0.075, W * 0.18],
        [-turretW * 0.24, gunY + H * 0.18, turretL * 0.31], 'glass', {
          turret: true, profile: 'dome', segments: 12, group: 'mantlet',
        }),
      // A pair of shallow crown ribs catches the tactical light and breaks the
      // old featureless rear arc without repainting the whole turret roof.
      greeble('crownRib', 'taperedBox', [W * 0.08, H * 0.055, turretL * 0.32],
        [W * 0.22, turretRoof + H * 0.018, -turretL * 0.18], 'bareMetal', {
          turret: true, mirrorX: true, group: 'mantlet', rot: [0, 0.08, 0],
          shape: { topScaleX: 0.58, topScaleZ: 0.86, shear: -L * 0.01 },
        }),
    );
  }

  /* -- team colour (R-T1: 8-14% of visible surface, flat slabs only) ------ */
  masses.push(
    slab('turretCheek', [0.07, turretH * 0.56, turretL * 0.52], [turretW * 0.42, turretY + turretH * 0.04, -turretL * 0.04], { turret: true, mirrorX: true }),
    slab('hullFlank', [0.07, hullH * 0.62, L * 0.50], [W * 0.46, hullY, -L * 0.06], { mirrorX: true }),
    // Top-facing slabs stay SMALL panel inserts. A turret-roof-sized plate
    // measures inside R-T1 and still reads as a repainted tank, because a
    // 39-degree camera weights a deck about 2.5x a flank.
    slab('turretCap', [turretW * 0.34, 0.07, turretL * 0.30], [-turretW * 0.14, turretRoof, -turretL * 0.02], { turret: true }),
    slab('prowBand', [W * 0.42, 0.07, L * 0.09], [0, deckY, L * 0.40], {}),
  );
  masses.push(insignia([turretW * 0.28, 0.06, turretW * 0.28], [turretW * 0.18, turretRoof + 0.02, turretL * 0.18], { turret: true }));
  masses.push(
    glow('sternLamp', [0.38, 0.26, 0.06], [W * 0.26, deckY - 0.08, -L * 0.48], { mirrorX: true }),
    glow('deckStrip', [W * 0.60, 0.06, L * 0.16], [0, deckY + 0.02, -L * 0.38]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.Turret, pos: [0, turretY, -L * 0.04] },
    { part: PartId.MuzzleA, pos: [o.gun === 'repeater' ? W * 0.15 : 0, gunY, muzzleZ], turret: true },
    { part: PartId.Exhaust, pos: [W * 0.32, deckY + 0.55, -L * 0.30] },
    { part: PartId.Antenna, pos: [-turretW * 0.38, H, -turretL * 0.36], turret: true },
  ];
  if (o.gun === 'repeater') {
    sockets.push({ part: PartId.MuzzleB, pos: [-W * 0.15, gunY, muzzleZ], turret: true });
  }

  return {
    key: o.key,
    name: o.name,
    faction: MERIDIAN_ART_FACTION,
    cls: 'vehicle',
    hullLength: L,
    turretPivot: [0, turretY, -L * 0.04],
    masses,
    sockets,
    hullNumber: HULL_NUMBER,
  };
}

/* ==========================================================================
 * 6. TURRETLESS SUPPORT — the Sun Collector and the Carryall
 *
 * No turret, so the dominant mass is the superstructure and it still has to sit
 * at 0.60-0.70 H. On the Collector that is the ore drum; on the Carryall it is
 * the folded Conclave package it turns into.
 * ========================================================================== */

interface PactSupportOpts {
  key: string;
  name: string;
  hullLength: number;
  hullWidth: number;
  height: number;
  role: 'collector' | 'carryall';
}

function pactSupport(o: PactSupportOpts): UnitMassList {
  const H = o.height, L = o.hullLength, W = o.hullWidth;
  const skirtH = H * 0.30;
  const chassisH = H * 0.16;
  const chassisY = skirtH + chassisH * 0.5;
  const deckY = skirtH + chassisH;
  const bodyH = H * 0.52;
  const bodyY = H * 0.645;
  // The drum carries R8's dominant-mass check on both support hulls, and
  // `silhouetteFillOf` scores a `planPrism` at 0.86 against a `prism`'s 0.90 —
  // so migrating the primitive alone would have taken the Collector from 36.8%
  // of the silhouette to 35.2%, a fifth of a point off the 35% floor and a
  // rejected model on the next unrelated tweak. Four percent more barrel buys
  // the margin back and is the right shape anyway: an ore drum is a big object.
  const bodyL = L * 0.70;

  const masses: MassDef[] = [
    ...plenumSkirt(W, skirtH, L * 0.90, 5),
    // The chassis draws in toward the deck, so the body above it sits on a
    // visible shoulder rather than on a flush ledge. Eight sloped walls.
    primary('chassis', 'planPrism', [W, chassisH, L], [0, chassisY, 0], 'paintLarge', {
      capSlot: 'paintLarge',
      shape: { plan: octPlan(W, L), topScaleX: 0.88, topScaleZ: 0.94 },
    }),
    // The dominant mass: an ore drum, or the folded structure package. Tapered
    // the other way from everything below it — narrow at the waist, flaring to
    // a full-width mouth at the lid — because that is what a hopper is, and
    // because a hull whose every volume narrows upward reads as a wedding cake.
    primary(o.role === 'collector' ? 'drum' : 'package', 'planPrism',
      [W * 0.96, bodyH, bodyL], [0, bodyY, -L * 0.10], 'paintLarge', {
        capSlot: 'paintLarge',
        shape: {
          plan: hexPlan(W * 0.96, bodyL),
          bottomScaleX: 0.84, bottomScaleZ: 0.90,
        },
      }),
  ];

  if (o.role === 'collector') {
    masses.push(
      // The intake throat: the second read, and the thing that says "harvester".
      // A wedge plan has ONE axis-aligned wall — the transom across its back —
      // and the taper tips it, so the mouth flares down and out toward the ore
      // the way a scoop does.
      primary('throat', 'planPrism', [W * 1.00, H * 0.26, L * 0.24], [0, deckY + H * 0.02, L * 0.42], 'paintMed', {
        capSlot: 'stripe',
        shape: {
          plan: wedgePlan(W * 1.00, L * 0.24),
          topScaleX: 0.82, topScaleZ: 0.88, shear: -L * 0.012,
        },
      }),
      greeble('throatTeeth', 'box', [W * 0.96, 0.14, 0.22], [0, deckY - H * 0.06, L * 0.52], 'bareMetal', { group: 'teeth' }),
      greeble('throatArm', 'lathe', [0.20, L * 0.24, 0.20], [W * 0.38, deckY + H * 0.10, L * 0.30], 'bareMetal', {
        mirrorX: true, profile: 'cyl', segments: 10, rot: [Math.PI * 0.5, 0, 0], group: 'throatArms',
      }),
      greeble('drumLid', 'lathe', [W * 0.60, 0.20, L * 0.36], [0, bodyY + bodyH * 0.5, -L * 0.10], 'hatch', {
        profile: 'disc', segments: 12, group: 'lid',
      }),
      greeble('riser', 'box', [W * 0.30, 0.18, L * 0.30], [0, bodyY + bodyH * 0.28, L * 0.22], 'grille', {
        rot: [-0.32, 0, 0], group: 'riser',
      }),
    );
  } else {
    masses.push(
      // The bow ramp. Same wedge, tapered the other way from the Collector's
      // throat: this one is a door, so it is widest at the deck it folds down
      // from and narrows toward the ground it lands on.
      primary('foreRamp', 'planPrism', [W * 1.06, H * 0.28, L * 0.16], [0, skirtH * 0.68, L * 0.50], 'paintMed', {
        capSlot: 'stripe',
        shape: {
          plan: wedgePlan(W * 1.06, L * 0.16),
          bottomScaleX: 0.80, bottomScaleZ: 0.86,
        },
      }),
      greeble('rampArm', 'lathe', [0.22, L * 0.28, 0.22], [W * 0.40, skirtH * 0.86, L * 0.34], 'bareMetal', {
        mirrorX: true, profile: 'cyl', segments: 10, rot: [Math.PI * 0.5, 0, 0], group: 'rampArms',
      }),
      greeble('pylon', 'lathe', [0.32, H * 0.17, 0.32], [-W * 0.26, H - H * 0.085, -L * 0.20], 'bareMetal', {
        profile: 'cone', segments: 10, topRadius: 0.40, group: 'pylon',
      }),
      greeble('jib', 'box', [0.20, 0.18, L * 0.40], [-W * 0.26, H - H * 0.115, L * 0.02], 'bareMetal', {
        rot: [0.16, 0, 0], group: 'pylon',
      }),
      greeble('packLid', 'lathe', [W * 0.56, 0.16, L * 0.32], [0, bodyY + bodyH * 0.5, -L * 0.10], 'hatch', {
        profile: 'disc', segments: 12, group: 'lid',
      }),
    );
  }

  masses.push(
    ...pactGreebles(W, L, deckY),
    // On the deck, not on the roof — same reason as the tank template's.
    ...mirrorVane('vane', W * 0.40, L * 0.14, [-W * 0.30, deckY + 0.40, -L * 0.34], -0.50),
    greeble('cabGlass', 'box', [W * 0.52, bodyH * 0.34, 0.10], [0, bodyY + bodyH * 0.16, -L * 0.10 + L * 0.33], 'paintTiny', {
      faceSlots: { pz: 'glass' }, group: 'cab',
    }),
  );

  masses.push(
    slab('bodyFlank', [0.07, bodyH * 0.46, L * 0.46], [W * 0.45, bodyY, -L * 0.10], { mirrorX: true }),
    slab('bodyCap', [W * 0.38, 0.07, L * 0.24], [W * 0.10, bodyY + bodyH * 0.5, -L * 0.10]),
    slab('chassisBand', [0.07, chassisH * 0.56, L * 0.56], [W * 0.47, chassisY, 0], { mirrorX: true }),
    slab('sternPlate', [W * 0.56, bodyH * 0.34, 0.07], [0, bodyY, -L * 0.10 - L * 0.33]),
  );
  masses.push(insignia([W * 0.26, 0.06, W * 0.26], [W * 0.22, bodyY + bodyH * 0.5 + 0.02, -L * 0.24]));
  masses.push(
    // R-T5 is measured against TOTAL triangle area including faces the camera
    // never sees, and a turretless hull has a lot of those, so the support
    // chassis needs a third strip to clear the 0.5% floor the tanks clear on two.
    glow('beacon', [0.40, 0.30, 0.40], [-W * 0.30, bodyY + bodyH * 0.5 + 0.16, -L * 0.28]),
    glow('sideLamp', [0.06, 0.62, 1.70], [W * 0.48, deckY + 0.30, L * 0.12], { mirrorX: true }),
    glow('deckStrip', [W * 0.50, 0.06, L * 0.14], [0, deckY + 0.02, -L * 0.42]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.Scoop, pos: [0, deckY, L * 0.52] },
    { part: PartId.Hopper, pos: [0, bodyY + bodyH * 0.5, -L * 0.10] },
    { part: PartId.Exhaust, pos: [W * 0.32, deckY + 0.55, -L * 0.30] },
    { part: PartId.DockEntry, pos: [0, deckY, -L * 0.5] },
  ];

  return {
    key: o.key, name: o.name, faction: MERIDIAN_ART_FACTION, cls: 'vehicle',
    hullLength: L, masses, sockets, hullNumber: HULL_NUMBER,
  };
}

/* ==========================================================================
 * 7. NAVAL
 *
 * `air` and `naval` are exempt from the top-heavy check (a ship's dominant mass
 * is its hull, at the waterline) and held to everything else.
 * ========================================================================== */

interface PactShipOpts {
  key: string; name: string;
  length: number; beam: number; height: number;
  /**
   * What the bow carries. `'ramp'` is not an armament and that is the point:
   * a lighter's bow is a door, so the branch that would put a gun there puts a
   * hexagonal leaf on hinges instead, walks the bridge right aft to open the
   * well, and deletes the stern mount and the ram the two warships share. See
   * `ShipOpts.armament` in `UnitDefs.ts`, which this mirrors so all four armies'
   * landing ships are built by the same decision.
   */
  armament: 'battery' | 'lances' | 'ramp';
  /**
   * The eight-slot hull, which only this army and the Reclamation field.
   *
   * It adds a travelling gantry over the well, and it exists because the Pact
   * is the one army with TWO ramp ships in one sidebar: without it the Argosy
   * is the Lighter at a hundred and eighteen per cent, and two cameos that
   * differ only in scale are two cameos a player cannot tell apart.
   */
  heavy?: boolean;
}

function pactShip(o: PactShipOpts): UnitMassList {
  const L = o.length, W = o.beam, H = o.height;
  const hullH = H * 0.34;
  const hullY = hullH * 0.5;
  const superH = H * 0.42;
  const superY = H * 0.655;
  const deckY = hullH + H * 0.10;
  const lander = o.armament === 'ramp';
  // The bridge position is the whole difference between a warship's profile and
  // a lighter's, so it is ONE number everything hanging off the bridge derives
  // from rather than eight repetitions of `-L * 0.10`.
  const superZ = lander ? -L * 0.34 : -L * 0.10;
  const superL = lander ? L * 0.22 : L * 0.34;
  const mastZ = lander ? superZ : -L * 0.16;
  const turreted = o.armament === 'battery';
  const turretY = hullH + H * 0.19;
  const turretZ = L * 0.28;
  // Replacing the cutter's deck-sized fake rail with real perimeter members
  // removes a large non-team surface. Its existing panels then land at 14.1%,
  // one tenth above R-T1; a two-percent linear trim keeps the same graphic read
  // while returning the smallest hull to the measured band.
  const teamScale = o.key === 'meridian_cutter' ? 0.98 : 1;

  const masses: MassDef[] = [
    // DEADRISE. The hull was the single flattest primary mass in the game at
    // 0.65 axis-aligned — a wedge plan still has a transom square across its
    // stern, and `buildPrism` held it and both quarters dead vertical, which is
    // a barge. Drawing the bottom ring in to 0.76 x 0.94 gives roughly 25
    // degrees of deadrise per side, so the hull falls away to a keel and every
    // wall on it slopes. This is also the one place the Pact gets to look like
    // a ship rather than like a hovercraft that happens to float.
    primary('hull', 'planPrism', [W, hullH, L], [0, hullY, 0], 'paintLarge', {
      capSlot: 'paintLarge',
      shape: {
        plan: wedgePlan(W, L),
        bottomScaleX: 0.76, bottomScaleZ: 0.94,
      },
    }),
    // The deck rolls in at the gunwale rather than standing as a proud rim.
    primary('deck', 'planPrism', [W * 0.94, H * 0.10, L * 0.90], [0, hullH + H * 0.05, -L * 0.02], 'paintMed', {
      capSlot: 'paintLarge',
      shape: { plan: octPlan(W * 0.94, L * 0.90), topScaleX: 0.93, topScaleZ: 0.97 },
    }),
    // The superstructure narrows going up, which is what a warship bridge does
    // and what stops the second-largest mass on the hull reading as a shed.
    primary('bridge', 'planPrism', [W * 0.72, superH, superL], [0, superY, superZ], 'paintLarge', {
      capSlot: 'paintLarge',
      shape: {
        plan: hexPlan(W * 0.72, superL),
        topScaleX: 0.80, topScaleZ: 0.88, shear: -L * 0.018,
      },
    }),
    // Sized so the mast crown IS the top of the silhouette.
    primary('mast', 'lathe', [W * 0.26, H * 0.20, W * 0.26], [0, H - H * 0.10, mastZ], 'bareMetal', {
      profile: 'cone', segments: 12, topRadius: 0.36,
    }),
  ];

  if (lander) {
    masses.push(
      // THE RAMP IS A PRIMARY, because it is the shape a player has to read
      // from across the map to know this hull carries their tanks. A hexagonal
      // leaf and not a plate: the Pact's plan language reaches the door the same
      // way it reaches the bridge behind it, and a tapered `planPrism` keeps the
      // de-boxify gate's axis fraction at zero where an untapered one would not.
      primary('bowRamp', 'planPrism', [W * 0.78, H * 0.09, L * 0.30], [0, deckY + H * 0.08, L * 0.36], 'stripe', {
        capSlot: 'stripe', rot: [-0.46, 0, 0],
        shape: { plan: hexPlan(W * 0.78, L * 0.30), topScaleX: 0.86, topScaleZ: 0.94 },
      }),
      greeble('rampHinge', 'lathe', [0.26, W * 0.46, 0.26], [0, deckY + H * 0.02, L * 0.22], 'bareMetal', {
        profile: 'cyl', segments: 10, rot: [0, 0, Math.PI * 0.5], group: 'rampGear',
      }),
      // The well: a coaming down each side of the open vehicle deck, and the
      // capstan that hauls the door shut at the head of it. Without the coaming
      // the deck is a flat plate and the hull reads as a barge with a lid.
      greeble('wellCoaming', 'taperedBox', [0.14, H * 0.20, L * 0.50], [W * 0.46, deckY + H * 0.10, L * 0.04], 'paintMed', {
        mirrorX: true, rot: [0, 0, -0.14], group: 'well', chamfer: 0.04,
        shape: { topScaleX: 0.62, topScaleZ: 0.94, shear: -0.04 },
      }),
      greeble('capstan', 'lathe', [0.52, W * 0.42, 0.52], [0, deckY + H * 0.16, -L * 0.14], 'bareMetal', {
        profile: 'capsule', segments: 10, rot: [0, 0, Math.PI * 0.5], group: 'well',
      }),
      // NON-SKID, and it is here for a measured reason as much as a real one.
      // Deleting the stern mount, the ram and the guard rail took every large
      // metal surface off the hull with them, and the Lighter measured 3.7%
      // bare metal against bible 5.4's 5-34% floor. A vehicle deck is ribbed
      // steel rather than painted topside anyway — this is the one surface on
      // the ship a tank's tracks actually touch.
      greeble('wellFloor', 'planPrism', [W * 0.66, 0.10, L * 0.44], [0, deckY + 0.05, L * 0.02], 'tread', {
        group: 'well', chamfer: 0.03, capSlot: 'tread',
        shape: { plan: hexPlan(W * 0.66, L * 0.44), topScaleX: 0.96, topScaleZ: 0.98 },
      }),
      greeble('bollard', 'lathe', [0.28, 0.54, 0.28], [W * 0.42, deckY + 0.27, L * 0.14], 'bareMetal', {
        mirrorX: true, profile: 'cyl', segments: 8, group: 'deckFittings',
      }),
    );
    if (o.heavy === true) {
      // The gantry: a portal frame straddling the well on two legs, which is
      // what an eight-slot hull needs to strike cargo down and what tells it
      // apart from the four-slot hull beside it in the sidebar.
      masses.push(
        greeble('gantryLeg', 'taperedBox', [0.20, H * 0.30, 0.24], [W * 0.40, deckY + H * 0.15, -L * 0.02], 'bareMetal', {
          mirrorX: true, group: 'gantry', chamfer: 0.03,
          shape: { topScaleX: 0.70, topScaleZ: 0.80 },
        }),
        greeble('gantryBeam', 'taperedBox', [W * 0.94, 0.22, 0.30], [0, deckY + H * 0.31, -L * 0.02], 'bareMetal', {
          group: 'gantry', chamfer: 0.03,
          shape: { topScaleX: 0.94, topScaleZ: 0.62 },
        }),
      );
    }
  } else if (o.armament === 'battery') {
    masses.push(
      primary('foreMount', 'lathe', [W * 0.50, H * 0.20, W * 0.54], [0, turretY, turretZ], 'paintMed', {
        turret: true, profile: 'cyl', segments: 12, topRadius: 0.80, group: 'foreGun',
      }),
      greeble('foreBarrel', 'lathe', [0.26, L * 0.20, 0.26], [0, hullH + H * 0.21, L * 0.36], 'bareMetal', {
        turret: true, profile: 'cyl', segments: 12, rot: [Math.PI * 0.5, 0, 0], group: 'foreGun',
      }),
      greeble('foreMuzzle', 'lathe', [0.36, L * 0.06, 0.36], [0, hullH + H * 0.21, L * 0.43], 'bareMetal', {
        turret: true, profile: 'disc', segments: 10, topRadius: 0.72, rot: [Math.PI * 0.5, 0, 0], group: 'foreGun',
      }),
    );
  } else {
    masses.push(
      greeble('lanceCell', 'prism', [W * 0.56, H * 0.16, L * 0.20], [0, hullH + H * 0.16, L * 0.26], 'grille', {
        plan: 'hexagon', capSlot: 'grille', group: 'cells',
      }),
      greeble('cellLid', 'box', [W * 0.58, 0.10, L * 0.21], [0, hullH + H * 0.24, L * 0.26], 'stripe', { group: 'cells' }),
    );
  }

  masses.push(
    ...mirrorVane('vane', W * 0.62, L * 0.10, [0, superY + superH * 0.5 + 0.22, superZ], -0.50),
    greeble('bridgeGlass', 'box', [W * 0.56, superH * 0.30, 0.12], [0, superY + superH * 0.16, superZ + superL * 0.5], 'paintTiny', {
      faceSlots: { pz: 'glass' }, group: 'bridgeGlass',
    }),
    greeble('dish', 'lathe', [W * 0.26, 0.16, W * 0.26], [0, H * 0.80, mastZ], 'bareMetal', {
      profile: 'disc', segments: 12, rot: [-0.5, 0, 0], group: 'dish',
    }),
    greeble('tender', 'lathe', [0.42, 1.40, 0.42], [W * 0.40, hullH + H * 0.14, -L * 0.24], 'paintSmall', {
      mirrorX: true, profile: 'capsule', segments: 10, rot: [Math.PI * 0.5, 0, 0], group: 'tenders',
    }),
  );

  // None of these three can share a hull with a bow door and an open well: the
  // guard rail spans the deck the cargo stands on, the stern mount is a gun on
  // an unarmed lift, and a ram bow is the one thing that physically cannot
  // share a stem with a ramp. Leaving them on was the fastest way to build the
  // warship silhouette the `'ramp'` variant exists to avoid.
  if (!lander) {
    masses.push(
      // The old "rail" was one solid grate spanning 98% of the entire deck — a
      // lid, not a guard rail. These three narrow edge members leave the deck
      // open and produce the same perimeter read with actual negative space.
      greeble('rail.side', 'taperedBox', [0.12, 0.16, L * 0.72], [W * 0.44, hullH + H * 0.14, -L * 0.02], 'bareMetal', {
        mirrorX: true, group: 'rails', shape: { topScaleX: 0.68, topScaleZ: 0.98 },
      }),
      greeble('rail.bow', 'taperedBox', [W * 0.82, 0.16, 0.12], [0, hullH + H * 0.14, L * 0.34], 'bareMetal', {
        group: 'rails', shape: { topScaleX: 0.96, topScaleZ: 0.68 },
      }),
      greeble('sternMount', 'prism', [W * 0.30, H * 0.12, L * 0.10], [0, hullH + H * 0.16, -L * 0.36], 'bareMetal', {
        plan: 'hexagon', capSlot: 'grille', group: 'sternGun',
      }),
      greeble('ram', 'prism', [W * 0.30, hullH * 0.60, L * 0.10], [0, hullY, L * 0.50], 'bareMetal', {
        plan: 'triangle', capSlot: 'bareMetal', group: 'ram',
      }),
    );
  }

  masses.push(
    slab('hullStripe', [0.08, hullH * 0.28 * teamScale, L * 0.70 * teamScale], [W * 0.46, hullH * 0.74, -L * 0.02], { mirrorX: true }),
    slab('bridgeBand', [0.08, superH * 0.44 * teamScale, superL * 0.76 * teamScale], [W * 0.33, superY, superZ], { mirrorX: true }),
    slab('bridgeCap', [W * 0.34 * teamScale, 0.08, superL * 0.53 * teamScale], [0, superY + superH * 0.5, superZ]),
    slab('deckPatch', [W * 0.52 * teamScale, 0.08, L * 0.16 * teamScale], [0, deckY, L * 0.10]),
  );
  // Aft on a warship, where the deck is clear. On a lighter that patch of deck
  // is under the bridge, so it moves forward into the well instead.
  masses.push(insignia([W * 0.36, 0.06, W * 0.36], [0, deckY, lander ? -L * 0.18 : -L * 0.30]));
  masses.push(
    glow('navLight', [0.34, 0.30, 0.06], [W * 0.38, hullH + H * 0.20, L * 0.34], { mirrorX: true }),
    glow('bridgeGlow', [W * 0.62, 0.26, 0.06], [0, superY + superH * 0.30, superZ + superL * 0.5]),
    // On a lighter the middle of the deck is the well floor, so the strip rides
    // on top of the non-skid rather than inside it.
    glow('deckRun', [W * 0.30, 0.05, L * 0.36], [0, lander ? deckY + 0.13 : hullH + H * 0.11, -L * 0.02]),
  );

  return {
    key: o.key, name: o.name, faction: MERIDIAN_ART_FACTION, cls: 'naval',
    hullLength: L, masses, hullNumber: HULL_NUMBER,
    ...(turreted ? { turretPivot: [0, turretY, turretZ] as const } : {}),
    sockets: lander
      // A lighter has no muzzle to hang a flash on and a door where the bow
      // socket would be, so it publishes what a lift publishes: the point cargo
      // walks through, and the stack.
      ? [
        { part: PartId.DockEntry, pos: [0, deckY, L * 0.46] },
        { part: PartId.Door, pos: [0, deckY, L * 0.40] },
        { part: PartId.Exhaust, pos: [0, superY + superH * 0.5 + H * 0.30, mastZ] },
      ]
      : [
        turreted
          ? { part: PartId.MuzzleA, pos: [0, H * 0.02, L * 0.18], turret: true }
          : { part: PartId.MuzzleA, pos: [0, hullH + H * 0.21, L * 0.46] },
        { part: PartId.Exhaust, pos: [0, superY + superH * 0.5 + H * 0.30, mastZ] },
        { part: PartId.Dish, pos: [0, superY + superH * 0.5 + H * 0.30, mastZ] },
      ],
  };
}

/* ==========================================================================
 * 8. THE KESTREL — the Pact flyer
 *
 * A blended lifting body rather than a tube-and-wing: the fuselage is split
 * fore and aft (a single long tube would be ~73% of the side silhouette, which
 * is exactly the "three plain boxes" half of R8) and both halves taper.
 * ========================================================================== */

function pactFlyer(key: string, name: string, L: number, S: number, H: number): UnitMassList {
  const fuseH = H * 0.42;
  const fuseY = H * 0.655;
  const wingY = fuseY - fuseH * 0.18;

  const masses: MassDef[] = [
    // A BLENDED LIFTING BODY, finally shaped like one. The hexagonal section is
    // unchanged; what it does now is draw in hard toward a spine, so the fore
    // fuselage is a broad flat underside rising to a narrow deck instead of six
    // vertical walls. It was the Kestrel's only axis-aligned primary (0.132) and
    // the last untapered `prism` primary in the army.
    //
    // The chord grew from 0.56 L to 0.60 L in the same edit, and that is not
    // taste either: `silhouetteFillOf` scores a `planPrism` at 0.86 against a
    // `prism`'s 0.90, which would have dropped this mass from 36.5% of the
    // silhouette to 34.9% and tripped R8's 35% dominant-mass floor. The extra
    // chord also closes a real gap — the fore body now meets the base of the
    // nose cone instead of stopping a few centimetres short of it.
    primary('foreBody', 'planPrism', [S * 0.20, fuseH, L * 0.60], [0, fuseY, L * 0.16], 'paintLarge', {
      capSlot: 'paintMed',
      shape: {
        plan: hexPlan(S * 0.20, L * 0.60),
        topScaleX: 0.72, topScaleZ: 0.92, shear: -L * 0.020,
      },
    }),
    primary('aftBoom', 'planPrism', [S * 0.16, fuseH * 0.78, L * 0.48], [0, fuseY - fuseH * 0.04, -L * 0.26], 'paintMed', {
      capSlot: 'paintSmall',
      shape: {
        plan: hexPlan(S * 0.16, L * 0.48),
        topScaleX: 0.68, topScaleZ: 0.74,
        bottomScaleX: 0.88, bottomScaleZ: 0.92,
        shear: -L * 0.055,
      },
    }),
    // Swept trapezoidal wing. The rotation is what makes it a wing and not a
    // plank, and it is also what takes its axis-aligned surface fraction to 0.
    primary('wing', 'planPrism', [S * 0.42, H * 0.10, L * 0.34], [S * 0.26, wingY, -L * 0.06], 'paintLarge', {
      mirrorX: true, rot: [0, -0.30, 0.12], capSlot: 'paintMed',
      shape: {
        plan: [
          [-S * 0.21, -L * 0.17], [S * 0.21, -L * 0.06],
          [S * 0.21, L * 0.17], [-S * 0.21, L * 0.06],
        ],
        topScaleX: 0.92, topScaleZ: 0.94,
        bottomScaleX: 1.02, bottomScaleZ: 1.00,
      },
    }),
    primary('fin', 'planPrism', [H * 0.30, 0.15, L * 0.21], [S * 0.16, H - H * 0.15, -L * 0.40], 'paintMed', {
      mirrorX: true, rot: [0, 0, 1.24], capSlot: 'paintSmall',
      shape: {
        plan: [
          [-H * 0.15, -L * 0.105], [H * 0.15, -L * 0.040],
          [H * 0.15, L * 0.105], [-H * 0.15, L * 0.040],
        ],
        topScaleX: 0.90, topScaleZ: 0.92,
        bottomScaleX: 1.02, bottomScaleZ: 1.00,
      },
    }),
  ];

  masses.push(
    // The legacy cone pointed aft and floated beyond the forebody. Positive
    // quarter-turn points its narrow end forward; this anchor buries the wide
    // root in the blended body and carries the tip to 0.52 L.
    greeble('nose', 'lathe', [S * 0.18, L * 0.20, fuseH * 0.90], [0, fuseY, L * 0.42], 'paintMed', {
      profile: 'cone', segments: 12, topRadius: 0.20, rot: [Math.PI * 0.5, 0, 0], group: 'nose',
    }),
    greeble('canopy', 'lathe', [S * 0.15, fuseH * 0.42, L * 0.24], [0, fuseY + fuseH * 0.42, L * 0.20], 'glass', {
      profile: 'dome', segments: 12, group: 'canopy',
    }),
    ...mirrorVane('vane', S * 0.24, L * 0.14, [0, fuseY + fuseH * 0.52, -L * 0.10], -0.42),
    greeble('intake', 'prism', [S * 0.10, fuseH * 0.42, L * 0.16], [S * 0.13, fuseY - fuseH * 0.10, L * 0.06], 'grille', {
      mirrorX: true, plan: 'hexagon', capSlot: 'grille', group: 'intakes',
    }),
    greeble('skid', 'taperedBox', [S * 0.07, H * 0.12, L * 0.12], [S * 0.12, fuseY - fuseH * 0.5, -L * 0.02], 'paintTiny', {
      mirrorX: true, group: 'skids', shape: { topScaleX: 0.72, topScaleZ: 0.66, shear: -0.03 },
    }),
    greeble('pylon', 'taperedBox', [0.14, H * 0.10, L * 0.10], [S * 0.24, wingY - H * 0.07, -L * 0.04], 'bareMetal', {
      mirrorX: true, group: 'pylons', shape: { topScaleX: 0.58, topScaleZ: 0.72 },
    }),
    greeble('pod', 'lathe', [0.26, L * 0.26, 0.26], [S * 0.24, wingY - H * 0.13, -L * 0.02], 'bareMetal', {
      mirrorX: true, profile: 'capsule', segments: 10, rot: [Math.PI * 0.5, 0, 0], group: 'pods',
    }),
    greeble('gunMuzzle', 'lathe', [0.17, L * 0.14, 0.17], [S * 0.24, wingY - H * 0.13, L * 0.03], 'bareMetal', {
      mirrorX: true, profile: 'cyl', segments: 10, topRadius: 0.72,
      rot: [Math.PI * 0.5, 0, 0], group: 'pods',
    }),
    greeble('thruster', 'lathe', [S * 0.14, 0.26, S * 0.14], [0, fuseY, -L * 0.52], 'bareMetal', {
      profile: 'cyl', segments: 12, topRadius: 0.82, rot: [Math.PI * 0.5, 0, 0], group: 'thruster',
    }),
  );

  masses.push(
    slab('wingBand', [S * 0.22, 0.07, L * 0.11], [S * 0.28, wingY + H * 0.05, -L * 0.06], { mirrorX: true }),
    slab('finFlash', [0.07, H * 0.18, L * 0.10], [S * 0.19, H - H * 0.16, -L * 0.40], { mirrorX: true }),
    slab('spine', [S * 0.08, 0.07, L * 0.24], [0, fuseY + fuseH * 0.5, -L * 0.06]),
  );
  masses.push(insignia([S * 0.13, 0.06, S * 0.13], [S * 0.28, wingY + H * 0.06, -L * 0.06]));
  masses.push(
    glow('afterglow', [S * 0.13, 0.18, 0.06], [0, fuseY, -L * 0.56]),
    glow('tipLight', [0.10, 0.22, L * 0.20], [S * 0.44, wingY + H * 0.02, -L * 0.06], { mirrorX: true }),
  );

  return {
    key, name, faction: MERIDIAN_ART_FACTION, cls: 'air',
    hullLength: L, masses, hullNumber: HULL_NUMBER,
    sockets: [
      { part: PartId.MuzzleA, pos: [S * 0.24, wingY - H * 0.13, L * 0.10] },
      { part: PartId.MuzzleB, pos: [-S * 0.24, wingY - H * 0.13, L * 0.10] },
      { part: PartId.Exhaust, pos: [0, fuseY, -L * 0.56] },
    ],
  };
}

/* ==========================================================================
 * 9. THE ROSTER
 *
 * Dimensions come off the same scale ladder the shipped roster uses: the
 * Solarch is a 6.4 m hull against the Warden's 6.6 and the Anvil's 7.0, which
 * is the "lighter than both, not smaller than either" read the stats promise.
 * ========================================================================== */

export const MERIDIAN_UNIT_MASS_LISTS: readonly UnitMassList[] = [
  pactInfantry({ key: 'meridian_wayfarer', name: 'Wayfarer', weapon: 'carbine', pack: 'vane' }),
  pactInfantry({ key: 'meridian_lancer', name: 'Sunlancer', weapon: 'lance', pack: 'cells' }),
  pactInfantry({ key: 'meridian_artificer', name: 'Artificer', weapon: 'tool', pack: 'kit' }),
  pactInfantry({ key: 'meridian_hierarch', name: 'Hierarch', weapon: 'lance', pack: 'cells', officer: true }),

  pactTank({
    key: 'meridian_solarch', name: 'Solarch',
    hullLength: 6.4, hullWidth: 3.1, height: 2.50, gun: 'lance', fans: 4,
  }),
  pactTank({
    key: 'meridian_skiff', name: 'Sandskiff',
    hullLength: 5.4, hullWidth: 2.8, height: 2.35, gun: 'repeater', fans: 3,
  }),
  pactTank({
    key: 'meridian_zenith', name: 'Zenith Emitter',
    hullLength: 6.6, hullWidth: 3.0, height: 2.65, gun: 'emitter', fans: 4,
  }),
  pactSupport({
    key: 'meridian_collector', name: 'Sun Collector',
    hullLength: 8.4, hullWidth: 3.9, height: 3.25, role: 'collector',
  }),
  pactSupport({
    key: 'meridian_carryall', name: 'Pactworks Carryall',
    hullLength: 9.0, hullWidth: 4.4, height: 3.80, role: 'carryall',
  }),

  pactShip({ key: 'meridian_corvette', name: 'Kite Corvette', length: 10.0, beam: 3.6, height: 3.0, armament: 'battery' }),
  pactShip({ key: 'meridian_monitor', name: 'Sunmonitor', length: 15.0, beam: 4.6, height: 4.4, armament: 'lances' }),
  // The three naval rungs added when every army got a full fleet. The cutter is
  // the smallest hull the Pact floats on purpose — it is bought for its sight
  // radius, and a silhouette that reads as cheap is half of what stops a player
  // sending it into a fight it cannot win.
  pactShip({ key: 'meridian_cutter', name: 'Sun Cutter', length: 9.2, beam: 3.3, height: 2.8, armament: 'battery' }),
  pactShip({ key: 'meridian_lighter', name: 'Sun Lighter', length: 11.2, beam: 5.0, height: 3.0, armament: 'ramp' }),
  pactShip({ key: 'meridian_argosy', name: 'Argosy', length: 13.2, beam: 6.0, height: 3.6, armament: 'ramp', heavy: true }),

  pactFlyer('meridian_kestrel', 'Kestrel Gunship', 10.5, 11.0, 2.9),

  pactInfantry({ key: 'meridian_tidewalker', name: 'Tidewalker', weapon: 'carbine', pack: 'gills' }),
];

/** key -> mass list, for anything that wants the geometry rather than the model. */
export const MERIDIAN_UNIT_MASS_BY_KEY: ReadonlyMap<string, UnitMassList> =
  new Map(MERIDIAN_UNIT_MASS_LISTS.map((u) => [u.key, u]));

/**
 * Content key -> model key. The content vocabulary belongs to
 * `src/data/Defs.ts`; this is the one place the two namespaces meet, exactly as
 * `CONTENT_TO_MODEL` does it in `units.system.ts`.
 */
export const MERIDIAN_UNIT_MODELS: Readonly<Record<string, string>> = {
  mrdWayfarer: 'meridian_wayfarer',
  mrdLancer: 'meridian_lancer',
  mrdArtificer: 'meridian_artificer',
  mrdHierarch: 'meridian_hierarch',
  mrdCollector: 'meridian_collector',
  mrdSkiff: 'meridian_skiff',
  mrdSolarch: 'meridian_solarch',
  mrdZenith: 'meridian_zenith',
  mrdCarryall: 'meridian_carryall',
  mrdKestrel: 'meridian_kestrel',
  mrdCorvette: 'meridian_corvette',
  mrdMonitor: 'meridian_monitor',
  mrdCutter: 'meridian_cutter',
  mrdLighter: 'meridian_lighter',
  mrdArgosy: 'meridian_argosy',
  mrdTidewalker: 'meridian_tidewalker',
};

/* ==========================================================================
 * 10. BUILD AND HAND OFF
 *
 * A PRIVATE library on a PRIVATE `GreebleFactory`, and both words matter.
 * `UnitLibrary.build` derives its atlas key from `list.faction`, and the shared
 * `unitLibrary` is filled by `units.system.ts` in the same boot — sharing it
 * would mean the Pact's palette either collided with the Allied atlas or won
 * it, depending on init order. A private factory makes the question
 * unanswerable instead of answered-by-luck, at a cost of one extra material.
 * ========================================================================== */

export const meridianUnitLibrary = new UnitLibrary(new GreebleFactory());

/** Translate a built model into the bridge's shape. Mirrors `units.system.ts`. */
function toKindMesh(m: UnitModel): KindMesh {
  const sockets: BridgeSocket[] = m.sockets.map((s) => ({
    part: s.part, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, followsTurret: false,
  }));
  for (const s of m.turretSockets) {
    sockets.push({
      part: s.part,
      x: s.x + m.turretPivot[0], y: s.y + m.turretPivot[1], z: s.z + m.turretPivot[2],
      yaw: s.yaw, pitch: s.pitch, followsTurret: true, pivotY: m.turretPivot[1],
    });
  }
  return {
    geometry: m.hull,
    material: m.material,
    parts: m.turret === null ? undefined : [{
      geometry: m.turret,
      material: m.material,
      x: m.turretPivot[0], y: m.turretPivot[1], z: m.turretPivot[2],
      followsTurret: true,
      part: PartId.Turret,
      castShadow: true,
      receiveShadow: true,
    }],
    sockets,
    turretPivotY: m.turretPivot[1],
    castShadow: true,
    receiveShadow: true,
  };
}

export interface MeridianBuildReport {
  models: UnitModel[];
  failed: string[];
  registrations: number;
  bound: number;
}

/**
 * Build every Pact hull and publish it to `RenderBridge`.
 *
 * `unitId` is `resolveDefBinding().unitId` — content key -> def index. Passing
 * it in rather than resolving it here keeps this module free of any dependency
 * on `src/game/**`, which is the same discipline `sim/AIStrategy.ts` follows
 * with `DefLookup`.
 *
 * REGISTRATION FACTION. Every model goes on at `FACTION_ANY`, not at
 * `Faction.Meridian`, and that is correct rather than a shortcut:
 * `RenderBridge.factionSlot()` packs 0..2 and folds everything else onto the
 * wildcard slot, so a faction-3 registration IS a FACTION_ANY registration —
 * and it is also the honest description, because each of these defIds belongs
 * to exactly one army and can never be resolved for another.
 */
export async function buildAndRegisterMeridianUnits(
  atlasSize: number,
  unitId: Readonly<Record<string, number>>,
): Promise<MeridianBuildReport> {
  const models: UnitModel[] = [];
  const failed: string[] = [];

  // Atlas off-thread first — this library owns a PRIVATE GreebleFactory, so
  // `art.units`' prewarm cannot reach its cache. The loop stays synchronous.
  await meridianUnitLibrary.prewarm(
    MERIDIAN_UNIT_MASS_LISTS[0].faction, MERIDIAN_UNIT_PALETTE, atlasSize, MERIDIAN_ATLAS_SEED);

  for (const list of MERIDIAN_UNIT_MASS_LISTS) {
    try {
      models.push(meridianUnitLibrary.build(list, MERIDIAN_UNIT_PALETTE, atlasSize, MERIDIAN_ATLAS_SEED));
    } catch (err) {
      // One bad mass list must not take the roster — or the render — down.
      failed.push(`${list.key}: ${String(err)}`);
    }
  }

  const meshes = new Map<string, KindMesh>();
  const infantryFamily = IMPORTED_INFANTRY_FAMILIES.find((family) => family.key === 'meridian_wayfarer');
  if (infantryFamily !== undefined) {
    try {
      const variants = await loadImportedInfantryFamily(
        infantryFamily, (key) => meridianUnitLibrary.get(key),
      );
      for (const [key, mesh] of variants) meshes.set(key, mesh);
      console.info(`[units] imported shared ${infantryFamily.label} body for ${variants.size} roles`);
    } catch (error) {
      console.error(`[units] imported ${infantryFamily.label} rejected; using procedural fallbacks`, error);
    }
  }
  const importedKeys = [
    'meridian_collector', 'meridian_carryall', 'meridian_kestrel',
    'meridian_cutter', 'meridian_corvette', 'meridian_monitor',
    'meridian_lighter', 'meridian_argosy',
  ] as const;
  for (const key of importedKeys) {
    const spec = IMPORTED_UNIT_SPECS.find((candidate) => candidate.key === key);
    const model = meridianUnitLibrary.get(key);
    if (spec === undefined || model === undefined) continue;
    try {
      meshes.set(key, await loadImportedUnitOverride(model, spec));
      console.info(`[units] imported ${spec.label} with LOD and shadow proxy`);
    } catch (error) {
      console.error(`[units] imported ${spec.label} rejected; using procedural fallback`, error);
    }
  }
  const meshFor = (key: string): KindMesh | null => {
    const model = meridianUnitLibrary.get(key);
    if (model === undefined) return null;
    let mesh = meshes.get(key);
    if (mesh === undefined) { mesh = toKindMesh(model); meshes.set(key, mesh); }
    return mesh;
  };

  let registrations = 0;
  let bound = 0;
  for (const [contentKey, modelKey] of Object.entries(MERIDIAN_UNIT_MODELS)) {
    const mesh = meshFor(modelKey);
    const model = meridianUnitLibrary.get(modelKey);
    if (mesh === null || model === undefined) continue;
    const kind = model.cls === 'infantry' ? EntityKind.Infantry : EntityKind.Vehicle;
    const defId = unitId[contentKey];
    if (defId !== undefined && defId >= 0) {
      registerKindMesh(kind, FACTION_ANY, mesh, defId);
      registrations++;
      bound++;
    }
  }

  // Per-kind defaults for the Pact, so a Meridian entity spawned with defId -1
  // (a scenario placement, a debug spawn) draws Pact art instead of the
  // bridge's hazard box.
  //
  // These land on the WILDCARD slot, because `factionSlot()` folds 3 onto it —
  // i.e. they become the bridge's LAST-RESORT entry for the kind. That is the
  // right place for them and it takes nothing away from the other two armies:
  // resolution tries (kind, faction, defId), then (kind, ANY, defId), then
  // (kind, faction, -1) — and `units.system.ts` registers a (kind, faction, -1)
  // default for Allies, Soviets AND Neutral, so all three are answered before
  // the chain ever reaches here.
  const wayfarer = meshFor('meridian_wayfarer');
  const solarch = meshFor('meridian_solarch');
  if (wayfarer !== null) {
    registerKindMesh(EntityKind.Infantry, 3 as Faction, wayfarer, -1);
    registrations++;
  }
  if (solarch !== null) {
    registerKindMesh(EntityKind.Vehicle, 3 as Faction, solarch, -1);
    registrations++;
  }

  return { models, failed, registrations, bound };
}

/** Release every Pact geometry, material and atlas. */
export function disposeMeridianUnits(): void {
  meridianUnitLibrary.dispose();
}

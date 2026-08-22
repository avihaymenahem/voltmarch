/**
 * ============================================================================
 * VOLTMARCH — src/art/UnitDefs.ts
 * ============================================================================
 * THE ROSTER, AS MASS LISTS.
 *
 * Every unit is data: no geometry code, no THREE, no magic number that is not
 * derived from the scale ladder in UNIT_LADDER.
 *
 * WHAT CHANGED THIS ROUND
 * -----------------------
 * Two complaints, one file.
 *
 *   1. "Our models are too rectangular, like old school 3d models."
 *      Every primary mass in the roster is rebuilt on the `Shapes.ts`
 *      vocabulary: `tracks` running gear instead of a slab on rollers,
 *      `taperedBox` hulls with a real sheared glacis, `revolve` turrets with no
 *      flat side at any segment count, `extrude` barrels that step out behind
 *      the muzzle brake, `hull` convex bodies for fuselages and animals, and
 *      layered `plate` armour for the surface read. `MassList.boxiness()`
 *      measures the result and `validateUnit` rejects a regression.
 *
 *   2. "Find missing models."
 *      Seven entities were wearing another unit's mesh. They now have their
 *      own: the Attack Submarine, the Assault Destroyer (`gunboat`), the Hover
 *      Transport, the Sledge Tank and the Attack Dog — and the G.I. and the
 *      Conscript, which were two draw batches of byte-identical geometry, are
 *      now two genuinely different soldiers.
 *
 * TWO AUTHORING RULES WORTH STATING
 * ---------------------------------
 * 1. PLATES AND GREEBLE RUNS ARE STANDALONE MASSES, not `MassDef.plates` /
 *    `MassDef.greebles` children. Both spellings are legal and the child form is
 *    terser, but a child only exists after `expandMasses()` — so a factory that
 *    has not yet been taught to expand drops it on the floor, and the unit
 *    silently loses a fifth of its surface (and with it its measured
 *    team-colour fraction). A standalone `plate` mass degrades to a chamfered
 *    slab of exactly its own `size`, in exactly its own place, with exactly its
 *    own slot. Every new primitive here degrades that way on purpose.
 *
 * 2. A `plate`'s THICKNESS RUNS ALONG ITS LOCAL +Y and its outline lies in the
 *    local XZ plane. So a plate mass is always authored as
 *    `size = [outlineWidth, thickness, outlineLength]` and then ROTATED into
 *    place; `massExtents` turns that back into the correct world AABB. The
 *    `panel*` constructors below do the swap so no call site has to.
 *
 * THE TEMPLATE THAT MOST OF THEM SHARE
 * ------------------------------------
 * Bible 5.3 in five numbers, and every helper below is written to hit them:
 *
 *   chassis        0 .. 0.42 H     a thin base (bible: 35-45%)
 *   superstructure 0.42 .. 1.0 H   the top 55-65%
 *   tracks         22% of H tall, protruding 11% of hull width per side
 *   turret         0.75-0.95 x hull width — deliberately too big
 *   dominant mass  centred at 0.60-0.70 H, 35-50% of side-projected area
 *
 * TEAM COLOUR (R12/R-T1) is never a hull tint. Each unit carries 3-5 discrete
 * `teamSlab` panels let into the hull, sized so the measured surface fraction
 * lands in 8-14% (vehicles) or 20-28% (infantry and walkers), plus exactly one
 * `insignia` panel. The validator measures real triangle area and rejects the
 * unit if it misses.
 * ============================================================================
 */

import { PartId } from '../core/types';
import { UNIT_GEOMETRY, UNIT_LADDER } from '../core/config';
import {
  MassRole, TURRET_PROFILE, DOME_PROFILE, CAPSULE_PROFILE,
  rectOutline, taperOutline,
  type MassDef, type SocketSpec, type UnitMassList,
} from './MassList';
import type { SlotName } from './Greeble';

/* ==========================================================================
 * 1. LOCAL VOCABULARY
 * ========================================================================== */

type V3 = readonly [number, number, number];
type V2 = readonly [number, number];
type Profile = readonly V2[];

const HALF_PI = Math.PI * 0.5;

interface PanelOpts {
  turret?: boolean;
  mirrorX?: boolean;
  /**
   * Linear scale on the panel's two IN-PLANE axes; its thickness is untouched.
   *
   * R-T1's 8-14% is measured off the built mesh, so it moves whenever the
   * surface around the panel moves — and layering armour plates over every hull
   * this round added roughly a sixth of a vehicle's surface, which dropped the
   * whole roster from ~9% to ~7.5% without a single team panel changing size.
   * A panel's area goes as the SQUARE of this, so 1.25 buys back 56%.
   */
  k?: number;
  /**
   * See `MassDef.gait`. A team panel on a moving limb has to swing WITH it —
   * the thigh band is painted on the thigh.
   */
  gait?: MassDef['gait'];
}

/**
 * A thin panel given as WORLD extents. The thinnest axis is taken to be the
 * panel's normal and the mass is emitted as a `plate` rotated onto it, because a
 * plate's thickness always runs along its own +Y.
 *
 * This is the constructor behind every team slab, insignia and emissive panel in
 * the file: R-T2 says team colour is a flat let-in panel, never a tint and never
 * a gradient, and a `plate` is a let-in panel with a fully bevelled rim for 28
 * triangles.
 */
function panel(
  name: string, role: MassRole, slot: SlotName, size: V3, anchor: V3, o: PanelOpts = {},
): MassDef {
  const k = o.k ?? 1;
  const [w, h, d] = size;
  let local: V3;
  let rot: V3 | undefined;
  if (h <= w && h <= d) {            // normal +Y — a deck insert
    local = [w * k, h, d * k];
  } else if (w <= d) {               // normal +-X — a flank band
    local = [h * k, w, d * k];
    rot = [0, 0, HALF_PI];
  } else {                           // normal +-Z — a facade plate
    local = [w * k, d, h * k];
    rot = [HALF_PI, 0, 0];
  }
  return {
    name, primitive: 'plate', role, size: local, anchor, slot, capSlot: slot, chamfer: 0.02,
    ...(rot !== undefined ? { rot } : {}),
    ...(o.turret === true ? { turret: true } : {}),
    ...(o.mirrorX === true ? { mirrorX: true } : {}),
    ...(o.gait !== undefined ? { gait: o.gait } : {}),
  };
}

/** A flat team-colour panel let into the hull (R-T1 / R-T2). */
function slab(name: string, size: V3, anchor: V3, o: PanelOpts = {}): MassDef {
  return panel(name, MassRole.TeamSlab, 'teamSlab', size, anchor, o);
}

/**
 * PER-FAMILY TEAM-PANEL SCALE.
 *
 * These are not taste. `validateUnit` measures `teamSlab` coverage off the BUILT
 * MESH in screen-projected area, so the right number for each family can only be
 * read off a boot, and these are the values that put every family in the middle
 * of R-T1's band rather than on its floor: vehicles and naval at ~11.5% against
 * 8-14%, infantry and walkers at ~24% against 20-28%.
 *
 * They differ per family because the SURROUNDING surface differs. A submarine is
 * one long smooth pressure hull with very little else on it, so the same panel
 * measures far less of it than it does of a tank buried in tracks, plates and
 * stowage. Re-read them off the boot report if the hardware around the panels
 * changes again — that report is the only authority on this number.
 *
 * RE-READ ONCE, and this is why: these were first measured against a build in
 * which `UnitFactory` still ended its mass loop at `default: buildBox`, so every
 * `revolve`, `tracks`, `extrude` and `hull` mass rendered as a plain box. Wiring
 * the real primitives in changed the surface area AROUND the panels on almost
 * every hull — a lathed turret has less surface than the box that stood in for
 * it, a track run has far more — and eleven models fell out of R-T1's band. A
 * panel's area scales as k^2, so each family below was rescaled by
 * `k_new = k_old * sqrt(target / measured)` against the band MIDPOINT, and the
 * families that were still comfortably inside their band (tank, support,
 * transport) were deliberately left alone rather than churned.
 */
const TEAM_K = {
  // 28.8% measured -> 24% (band 20-28)
  infantry: 1.02,
  // 29.8% -> 24%
  dog: 1.03,
  tank: 1.25,
  support: 1.21,
  // 30.3% -> 24%
  walker: 1.05,
  // 14.1% -> 11% (band 8-14)
  ship: 0.99,
  // 16.1% -> 11%
  submarine: 1.09,
  transport: 1.17,
  // 15.6% -> 11%
  plane: 1.11,
} as const;

/** THE one insignia decal (R-T4). 8-14% of hull width, top/outward facing. */
function insignia(size: V3, anchor: V3, o: PanelOpts = {}): MassDef {
  return panel('insignia', MassRole.Insignia, 'insignia', size, anchor, o);
}

/** A masked emissive panel. R-T5: 1-3% of surface, clean rounded rectangles. */
function glowPanel(name: string, size: V3, anchor: V3, o: PanelOpts = {}): MassDef {
  return panel(name, MassRole.Emissive, 'emissive', size, anchor, o);
}

/** A small detail object. 6-12 of these per unit, every one >= 3 px on screen. */
function greeble(
  name: string, primitive: MassDef['primitive'], size: V3, anchor: V3,
  slot: SlotName, extra: Partial<MassDef> = {},
): MassDef {
  return { name, primitive, role: MassRole.Greeble, size, anchor, slot, ...extra };
}

/** One of the 3-6 shapes a critic reads from across the map. */
function primary(
  name: string, primitive: MassDef['primitive'], size: V3, anchor: V3,
  slot: SlotName, extra: Partial<MassDef> = {},
): MassDef {
  return { name, primitive, role: MassRole.Primary, size, anchor, slot, ...extra };
}

/** The XZ bounding extents of an outline, which is a plate's local w and d. */
function outlineSize(outline: readonly V2[]): [number, number] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of outline) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return [Math.max(1e-3, maxX - minX), Math.max(1e-3, maxZ - minZ)];
}

/**
 * A real armour plate: an outline in metres, extruded along its own +Y, then
 * rotated onto the surface it lies over.
 *
 * THE single highest-value call in the file. Three trapezoidal plates sitting
 * proud of one tapered hull at three slightly different angles is what separates
 * hi-tech armour from a painted brick, and each one costs about 28 triangles.
 */
function plateMass(
  name: string, role: MassRole, outline: readonly V2[], thickness: number,
  anchor: V3, rot: V3 | undefined, slot: SlotName, extra: Partial<MassDef> = {},
): MassDef {
  const [w, d] = outlineSize(outline);
  return {
    name, primitive: 'plate', role, size: [w, thickness, d], anchor, slot, capSlot: slot,
    ...(rot !== undefined ? { rot } : {}),
    shape: { outline, thickness, fit: 'none' },
    ...extra,
  };
}

/** `plateMass` at greeble role, with a group so a plate set costs one slot. */
function armour(
  name: string, outline: readonly V2[], thickness: number, anchor: V3,
  rot: V3 | undefined, slot: SlotName, group: string, extra: Partial<MassDef> = {},
): MassDef {
  return plateMass(name, MassRole.Greeble, outline, thickness, anchor, rot, slot, { group, ...extra });
}

/** A deterministic run of louvres, bolt pairs and junction boxes. ONE object. */
function greebleRun(
  name: string, length: number, width: number, height: number,
  anchor: V3, seed: number, extra: Partial<MassDef> = {},
): MassDef {
  return {
    name, primitive: 'greebleStrip', role: MassRole.Greeble,
    size: [width, height, length], anchor, slot: 'bareMetal', group: name,
    shape: { density: 2.2, seed: seed >>> 0, fit: 'none' },
    ...extra,
  };
}

/* -- profiles --------------------------------------------------------------
 * Normalised [radius, y] in 0..0.5 / 0..1; `fitMesh` stretches them into the
 * mass's `size`. Two turret profiles, because an Allied turret is a smooth
 * shouldered casting and a Soviet one is a squat welded pot with a hard brow.
 * ------------------------------------------------------------------------- */

/** Allied: wide chamfered base, sloped shoulder, small flat roof. */
const ALLIED_TURRET: Profile = TURRET_PROFILE;

/** Soviet: near-vertical skirt, a hard brow step, a broad flat roof. */
const SOVIET_TURRET: Profile = [
  [0, 0], [0.47, 0], [0.50, 0.09], [0.50, 0.46], [0.45, 0.52],
  [0.42, 0.86], [0.36, 1.0], [0, 1.0],
];

/** A drum: chamfered rim, straight body, chamfered crown. */
const DRUM_PROFILE: Profile = [
  [0, 0], [0.42, 0], [0.50, 0.09], [0.50, 0.91], [0.42, 1.0], [0, 1.0],
];

/** A tapered stack / cooling drum / prism housing. */
const TAPER_DRUM: Profile = [
  [0, 0], [0.44, 0], [0.50, 0.08], [0.44, 0.62], [0.38, 0.92], [0.32, 1.0], [0, 1.0],
];

/** A greatcoat: shoulders, a waisted middle, a flared hem. */
const COAT_PROFILE: Profile = [
  [0, 0], [0.50, 0.02], [0.44, 0.14], [0.38, 0.40], [0.40, 0.62],
  [0.47, 0.82], [0.44, 0.96], [0, 1.0],
];

/** A brimmed steel helmet: a flat crown over a proud rim. */
const BRIM_PROFILE: Profile = [
  [0, 0], [0.50, 0.02], [0.46, 0.16], [0.40, 0.44], [0.31, 0.74], [0.17, 0.94], [0, 1.0],
];

/** The section a gun barrel is swept along: a 10-sided tube. */
const BARREL_SECTION: readonly V2[] = [
  [0.21, 0], [0.17, 0.12], [0.06, 0.20], [-0.06, 0.20], [-0.17, 0.12],
  [-0.21, 0], [-0.17, -0.12], [-0.06, -0.20], [0.06, -0.20], [0.17, -0.12],
];

/** A hexagonal duct section, for exhaust trunks, jibs and missile rails. */
function ductSection(r: number): V2[] {
  return [
    [0.50 * r, 0], [0.25 * r, 0.43 * r], [-0.25 * r, 0.43 * r],
    [-0.50 * r, 0], [-0.25 * r, -0.43 * r], [0.25 * r, -0.43 * r],
  ];
}

/** An n-sided ring of radius r, for extruded tubes and hulls. */
function ring(r: number, sides: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/* ==========================================================================
 * 2. SUB-ASSEMBLIES
 * ========================================================================== */

/**
 * THE RUNNING GEAR. One `tracks` assembly per side: a stadium-section band with
 * ROUND ends, road wheels standing PROUD OF THE BAND'S OUTBOARD FACE, a toothed
 * drive sprocket aft, an idler forward, return rollers on the top run and an
 * angled skirt.
 *
 * This one substitution is the largest single de-boxifier in the roster. The old
 * spelling was an axis-aligned slab with six discs stuck to it and it measured
 * 100% flat wall; the assembly measures 42%, and it is the mass a critic's eye
 * lands on first on any tracked vehicle.
 *
 * `size[0]` is the assembly's WHOLE X footprint, band + proud hubs + skirt, so
 * it is the band fraction of hull width divided by the band's share of that
 * footprint. Written that way, the band comes out at 0.16 * hullWidth however
 * the layout fractions are retuned, and the outer edge still lands exactly on
 * `trackOutboardFraction` — the anchor cancels `w`, so 2*|x| + w is 1.22 *
 * hullWidth for any width at all. This used to read `hullWidth * 0.30`, which
 * was 41% wider than the band it produced because the invisible inboard hub
 * cluster was padding the AABB and `fitMesh` was squashing X by 0.5315.
 */
function runningGear(
  hullWidth: number, trackHeight: number, length: number, wheels: number,
  o: { skirt?: number; rollers?: number } = {},
): MassDef {
  const w = hullWidth * UNIT_GEOMETRY.trackBandFractionOfHull / UNIT_GEOMETRY.trackBandFraction;
  const x = hullWidth * 0.5 + hullWidth * UNIT_GEOMETRY.trackOutboardFraction - w * 0.5;
  return {
    name: 'track', primitive: 'tracks', role: MassRole.Primary,
    size: [w, trackHeight, length], anchor: [x, trackHeight * 0.5, 0],
    slot: 'tread', capSlot: 'bareMetal', mirrorX: true, group: 'running gear',
    shape: {
      wheels,
      returnRollers: o.rollers ?? 2,
      sprocketScale: 0.94,
      skirtHeight: o.skirt ?? trackHeight * 0.44,
    },
  };
}

/**
 * The greeble kit every vehicle carries: exhaust, stowage, headlamp cluster and
 * a tow point. Four discrete objects, all >= 0.16 m so nothing is sub-pixel at
 * gameplay zoom, and all of them lathed or tapered rather than cubic.
 */
function vehicleGreebles(hullW: number, hullL: number, deckY: number): MassDef[] {
  return [
    greeble('exhaust', 'cylinder', [0.26, 0.62, 0.26], [hullW * 0.34, deckY + 0.28, -hullL * 0.30], 'bareMetal', {
      mirrorX: true, group: 'exhaust', shape: { segments: 12, rTop: 0.84 },
    }),
    greeble('stowage', 'taperedBox', [hullW * 0.30, 0.26, hullL * 0.16], [-hullW * 0.30, deckY + 0.13, -hullL * 0.36], 'paintSmall', {
      mirrorX: true, group: 'stowage', shape: { topScaleX: 0.82, topScaleZ: 0.90 },
    }),
    greeble('headlamp', 'chamferBox', [0.30, 0.24, 0.18], [hullW * 0.32, deckY - 0.05, hullL * 0.44], 'paintTiny', {
      mirrorX: true, group: 'lamps', faceSlots: { pz: 'glass' },
    }),
    greeble('towHook', 'chamferBox', [0.20, 0.16, 0.34], [hullW * 0.22, deckY - 0.24, hullL * 0.48], 'bareMetal', {
      mirrorX: true, group: 'tow gear',
    }),
  ];
}

/**
 * A stepped gun barrel: a 10-sided tube swept forward that steps OUT behind the
 * muzzle brake and back in at the crown. A lathed cylinder cannot do that step,
 * and the step is the whole silhouette of a modern tank gun at RTS distance.
 */
function barrelMass(
  name: string, calibre: number, length: number, anchor: V3,
  o: { turret?: boolean; mirrorX?: boolean; role?: MassRole; group?: string } = {},
): MassDef {
  return {
    name, primitive: 'extrude', role: o.role ?? MassRole.Primary,
    size: [calibre, calibre, length], anchor, slot: 'bareMetal',
    ...(o.turret === true ? { turret: true } : {}),
    ...(o.mirrorX === true ? { mirrorX: true } : {}),
    ...(o.group !== undefined ? { group: o.group } : {}),
    shape: {
      profile: BARREL_SECTION,
      path: [[0, 0, -1.0], [0, 0, 0.42], [0, 0, 0.58], [0, 0, 1.0]],
      scale: [1.0, 0.92, 1.34, 1.16],
      capStart: true, capEnd: true,
    },
  };
}

/* ==========================================================================
 * 3. INFANTRY
 *
 * R-S4: 0.30-0.38 x a 7 m MBT hull, so 2.1-2.7 m. Team colour is 20-28% here,
 * not 8-14% — infantry are read at a much smaller pixel count and need the flag.
 *
 * The G.I. and the Conscript used to be the SAME MESH under two paint jobs:
 * both 1206 triangles, both 1.05 x 2.2 x 1.18 m. Two armies that differ only by
 * hue is exactly the failure R12 warns about, so they are now built from
 * different silhouettes — the Peacekeeper is a plated modern soldier with a
 * convex-hull chest rig and a domed helmet, the Conscript is a flared greatcoat
 * revolve under a brimmed steel helmet.
 * ========================================================================== */

interface InfantryOpts {
  key: string;
  name: string;
  faction: UnitMassList['faction'];
  hullNumber: number;
  /** 'rifle' | 'launcher' | 'tool' — changes the held object only. */
  weapon: 'rifle' | 'launcher' | 'tool';
  /**
   * Backpack shape: engineers carry a toolbox, flak troopers a magazine drum.
   *
   * `'rebreather'` ALSO REPLACES THE BOOT WITH A SWIM FIN, and that coupling is
   * deliberate rather than lazy: the swimmers are the only soldiers in the game
   * whose silhouette has to read as amphibious at 20 px, and one option that
   * cannot be half-applied is worth more than two that can. A man wearing twin
   * bottles is a diver; a diver wears fins. Every other pack leaves the boot
   * exactly as it was.
   */
  pack: 'radio' | 'drum' | 'case' | 'rebreather';
  /** The silhouette family. This is what stops two armies sharing one mesh. */
  build: 'plated' | 'greatcoat';
  /**
   * A commander. Adds a back cape, an oversized left pauldron and a helmet
   * crest — three shapes, all in the OUTLINE, because that is the only place a
   * hero can be told from a rifleman at gameplay zoom. A recoloured texture or
   * a bigger insignia would be invisible at the 57 px infantry occupies (task
   * #26 is the standing measurement of exactly how little room there is).
   *
   * Nothing here raises the model above `H`: the crest is authored to top out
   * at the same height as the aerial it sits beside, so R-S4's 2.1-2.7 m band
   * is unaffected and one commander cannot quietly become a walker.
   */
  officer?: boolean;
}

function infantry(o: InfantryOpts): UnitMassList {
  const H = UNIT_LADDER.infantryHeightMeters;      // 2.2 m
  const W = UNIT_LADDER.infantryWidthMeters;       // 0.78 m shoulder span
  const legTop = H * 0.415;                        // 0.913
  const torsoH = H * 0.415;                        // 0.913
  const torsoY = legTop + torsoH * 0.5;            // 1.370 -> 0.623 H
  const coat = o.build === 'greatcoat';

  const masses: MassDef[] = [
    // Legs. The Peacekeeper's are armoured and straight-sided; the Conscript's
    // taper hard into a heavy boot under a coat hem.
    primary('leg', 'taperedBox', [W * 0.34, legTop, W * 0.44], [W * 0.24, legTop * 0.5, 0], 'paintSmall', {
      mirrorX: true,
      // THE WALK CYCLE. One declaration animates both legs: the mirrored copy
      // gets the opposite sign automatically, which is the whole reason the
      // gait is expressed per MASS rather than per emitted vertex range.
      // Everything else that hangs off the leg — boot, knee pad, thigh band —
      // repeats this pivot so the limb moves as one piece. See
      // `MassDef.gait` and `src/render/Gait.ts`.
      gait: { limb: 'leg', pivotY: legTop },
      shape: coat
        ? { topScaleX: 1.34, topScaleZ: 1.18, bottomScaleX: 0.76, bottomScaleZ: 0.86 }
        : { topScaleX: 1.20, topScaleZ: 1.08, bottomScaleX: 0.88, bottomScaleZ: 0.92 },
    }),

    // Torso: the dominant mass, and the one that carries the faction read.
    coat
      // SOVIET: a greatcoat. A revolve flared at the hem — no flat wall anywhere
      // on it, and the flare is the single loudest Conscript cue.
      ? primary('coat', 'revolve', [W * 0.94, torsoH * 1.06, W * 0.88], [0, torsoY - torsoH * 0.03, 0], 'paintMed', {
        shape: { profile: COAT_PROFILE, segments: 20 },
      })
      // ALLIED: a plated chest rig. A convex hull with a raised sternum, chined
      // flanks and a shoulder shelf; wider at the shoulders than at the waist,
      // which is the toy-soldier read and puts the visual mass up high.
      : primary('torso', 'hull', [W * 0.92, torsoH, W * 0.84], [0, torsoY, 0], 'paintMed', {
        shape: {
          points: [
            [0, 0.46, 0.30], [0.44, 0.42, 0.10], [-0.44, 0.42, 0.10],
            [0.50, 0.10, -0.06], [-0.50, 0.10, -0.06],
            [0.34, -0.50, 0.20], [-0.34, -0.50, 0.20],
            [0.30, -0.50, -0.30], [-0.30, -0.50, -0.30],
            [0.30, 0.34, -0.42], [-0.30, 0.34, -0.42],
            [0, 0.02, 0.50],
          ],
          chamfer: 0.035,
        },
      }),

    // Helmet: enough radial resolution for a clean gameplay highlight without
    // changing the authored brim/dome profile into a featureless sphere.
    primary('helmet', 'revolve', [W * (coat ? 0.62 : 0.56), H * 0.145, W * (coat ? 0.66 : 0.60)],
      [0, legTop + torsoH + H * 0.048, 0.01], 'paintSmall', {
        shape: { profile: coat ? BRIM_PROFILE : DOME_PROFILE, segments: 20 },
      }),

    primary('arm', 'taperedBox', [W * 0.24, torsoH * 0.86, W * 0.28], [W * 0.52, torsoY + 0.02, 0.06], 'paintSmall', {
      mirrorX: true, rot: [0.12, 0, -0.06],
      // 'arm' inverts the sign again, so the left arm swings with the RIGHT
      // leg. That contralateral rhythm is most of what makes a walk read as a
      // walk; arms and legs in phase reads as a childrens' march.
      gait: { limb: 'arm', pivotY: torsoY + torsoH * 0.30 },
      shape: { topScaleX: 1.14, topScaleZ: 1.10, bottomScaleX: 0.80, bottomScaleZ: 0.84 },
    }),
    // Hands used to disappear into the ends of the arm prisms, leaving both
    // factions with the same blunt "peg arm" silhouette.  These ride the arm
    // pivot so they remain attached throughout the gait.  The Allied cuff is a
    // compact articulated glove; the Soviet gets a wider, round field gauntlet.
    coat
      ? greeble('gauntlet', 'revolve', [W * 0.31, torsoH * 0.18, W * 0.32],
        [W * 0.52, torsoY - torsoH * 0.37, 0.12], 'bareMetal', {
          mirrorX: true, group: 'gauntlets', gait: { limb: 'arm', pivotY: torsoY + torsoH * 0.30 },
          shape: { profile: DRUM_PROFILE, segments: 10 },
        })
      : greeble('gauntlet', 'taperedBox', [W * 0.27, torsoH * 0.17, W * 0.30],
        [W * 0.52, torsoY - torsoH * 0.37, 0.12], 'paintTiny', {
          mirrorX: true, group: 'gauntlets', gait: { limb: 'arm', pivotY: torsoY + torsoH * 0.30 },
          shape: { topScaleX: 0.82, topScaleZ: 0.88, bottomScaleX: 1.08, bottomScaleZ: 1.12, shear: 0.02 },
        }),
  ];

  /* -- weapon ------------------------------------------------------------- */
  if (o.weapon === 'launcher') {
    // TWO LAUNCHERS, THE SAME WAY THERE ARE TWO RIFLES BELOW.
    //
    // This branch used to emit ONE tube for both armies while the rifle branch
    // has always forked on `coat`, and that asymmetry was invisible only
    // because `soviet_flak` was the sole launcher in the game. It stopped being
    // invisible the moment a plated soldier picked one up, for a reason worth
    // recording: the greatcoat torso projects 0.624 of silhouette area and the
    // plated chest rig only 0.508, so the coat family runs 4-7 points clear of
    // R8's 35% dominant-mass floor while the plated family runs 0.04-2.8 —
    // `allied_marshal` sits at 35.04%. A 1.02 m tube projects 0.471, which is
    // most of a plated torso, and it put `allied_javelin` at 34.75%: REJECTED.
    //
    // The fix is not a smaller number until the bar clears. The Soviet tube is
    // unchanged — long, crude, carried away from the body. The Allied one is a
    // different weapon: shorter, fatter, braced back over the shoulder so it
    // overlaps the pauldron instead of standing proud of it. That is the
    // silhouette difference the header of this section asks for between two
    // armies' equivalents, and the metric follows from it rather than driving it.
    masses.push(
      coat
        ? greeble('launchTube', 'cylinder', [0.20, 1.02, 0.20], [W * 0.50, torsoY + 0.20, 0.22], 'bareMetal', {
          rot: [1.30, 0, 0.10], group: 'weapon', shape: { segments: 12 },
        })
        : greeble('launchTube', 'cylinder', [0.24, 0.74, 0.24], [W * 0.46, torsoY + 0.26, 0.06], 'bareMetal', {
          rot: [1.06, 0, 0.14], group: 'weapon', shape: { segments: 12 },
        }),
      coat
        ? greeble('launchMouth', 'cone', [0.28, 0.18, 0.28], [W * 0.50, torsoY + 0.50, 0.52], 'bareMetal', {
          rot: [1.30, 0, 0.10], group: 'weapon', shape: { segments: 12, rTop: 1.5 },
        })
        : greeble('launchMouth', 'cone', [0.32, 0.16, 0.32], [W * 0.46, torsoY + 0.56, 0.34], 'bareMetal', {
          rot: [1.06, 0, 0.14], group: 'weapon', shape: { segments: 12, rTop: 1.5 },
        }),
    );
  } else if (o.weapon === 'tool') {
    // TWO TOOLS, FOR THE SAME REASON THERE ARE TWO LAUNCHERS AND TWO RIFLES.
    //
    // This branch emitted ONE tool for both silhouette families, and for its
    // whole life that was unfalsifiable: `allied_engineer` was the only unit in
    // the game carrying `weapon: 'tool'`, because the Soviets had no engineer
    // model at all — `units.system.ts` handed them the Allied one. Fixing that
    // by adding a greatcoat with the identical tool would have shipped exactly
    // the R12 failure this section's header describes, one silhouette family
    // later.
    //
    // The two differ in ARM POSE, which is the only thing readable at the 57 px
    // an infantryman occupies. The Allied engineer holds a slim powered wrench
    // out FORWARD and level, at arm's length, clear of the body: a technician
    // reaching into a panel. The Soviet holds a cutting torch DOWN and across
    // the hip, short and fat and bell-mouthed, fed by the bottle on his back —
    // one continuous diagonal from shoulder to knee, which is a silhouette the
    // plated family cannot make.
    masses.push(
      coat
        ? greeble('cutterLance', 'cylinder', [0.21, 0.50, 0.21], [W * 0.44, torsoY - 0.30, 0.26], 'bareMetal', {
          rot: [1.16, 0, -0.22], group: 'weapon', shape: { segments: 10 },
        })
        : greeble('toolArm', 'cylinder', [0.16, 0.72, 0.16], [W * 0.52, torsoY - 0.10, 0.34], 'bareMetal', {
          rot: [HALF_PI, 0, 0], group: 'weapon', shape: { segments: 8 },
        }),
      coat
        // A flared bell, not a box: `rTop` 1.7 opens the cone the wrong way up
        // so the wide end leads. That mouth is the whole tell at gameplay zoom.
        ? greeble('cutterBell', 'cone', [0.32, 0.22, 0.32], [W * 0.42, torsoY - 0.62, 0.48], 'paintTiny', {
          rot: [1.16, 0, -0.22], group: 'weapon', shape: { segments: 10, rTop: 1.7 },
        })
        : greeble('toolHead', 'chamferBox', [0.26, 0.22, 0.22], [W * 0.52, torsoY - 0.10, 0.74], 'paintTiny', { group: 'weapon' }),
    );
  } else {
    // The rifles differ too: the Peacekeeper carries a short bullpup with a
    // scope block, the Conscript a long rifle with a drum magazine.
    masses.push(
      greeble('rifle', 'extrude', [0.11, 0.17, coat ? 1.14 : 0.94], [W * 0.44, torsoY - 0.04, coat ? 0.30 : 0.24], 'bareMetal', {
        rot: [0.18, 0.06, 0], group: 'weapon',
        shape: {
          profile: [[0.055, -0.085], [0.055, 0.06], [0.02, 0.085], [-0.02, 0.085], [-0.055, 0.06], [-0.055, -0.085]],
          path: [[0, 0, -0.5], [0, 0, -0.06], [0, 0, 0.16], [0, 0, 0.5]],
          scale: coat ? [1.25, 1.0, 0.80, 0.72] : [1.05, 1.35, 0.90, 0.82],
          capStart: true, capEnd: true,
        },
      }),
      coat
        ? greeble('drumMag', 'revolve', [0.26, 0.12, 0.26], [W * 0.44, torsoY - 0.18, 0.18], 'paintTiny', {
          rot: [HALF_PI, 0, 0], group: 'weapon', shape: { profile: DRUM_PROFILE, segments: 10 },
        })
        : greeble('scopeBlock', 'chamferBox', [0.08, 0.14, 0.26], [W * 0.44, torsoY + 0.09, 0.18], 'paintTiny', { group: 'weapon' }),
    );
  }

  /* -- backpack ----------------------------------------------------------- */
  if (o.pack === 'drum') {
    masses.push(greeble('drum', 'revolve', [0.42, 0.40, 0.42], [0, torsoY + 0.12, -W * 0.44], 'bareMetal', {
      rot: [HALF_PI, 0, 0], group: 'pack', shape: { profile: DRUM_PROFILE, segments: 12 },
    }));
  } else if (o.pack === 'case') {
    masses.push(coat
      // THE GAS BOTTLE LIES ACROSS THE SHOULDERS. Every other back in the
      // roster is vertical — the radio slab stands, the flak drum is a disc
      // facing aft, the diver's twin bottles stand on end — so a single fat
      // horizontal capsule is the one back profile left that reads as neither
      // of them from behind, which is where a man walking away is seen. It is
      // also what the torch in front of him is plumbed to, so the two halves of
      // the Soviet engineer tell one story instead of being two option flips.
      ? greeble('gasBottle', 'revolve', [0.27, W * 1.00, 0.27], [0, torsoY + 0.02, -W * 0.45], 'bareMetal', {
        rot: [0, 0, HALF_PI], group: 'pack', shape: { profile: CAPSULE_PROFILE, segments: 10 },
      })
      : greeble('toolcase', 'taperedBox', [W * 0.62, 0.42, 0.22], [0, torsoY + 0.06, -W * 0.42], 'paintSmall', {
        group: 'pack', shape: { topScaleX: 0.90, topScaleZ: 0.84 },
      }));
  } else if (o.pack === 'rebreather') {
    // TWIN BOTTLES ACROSS THE SHOULDERS, not one slab. A single tank reads as
    // the radio pack it replaced; a pair with a manifold yoke over them is the
    // one back profile in the roster that cannot be anything but a diver, and
    // it is visible from behind, which is where a swimmer is usually seen.
    masses.push(
      greeble('bottle', 'revolve', [0.22, 0.68, 0.22], [W * 0.22, torsoY + 0.10, -W * 0.44], 'bareMetal', {
        mirrorX: true, group: 'pack', shape: { profile: CAPSULE_PROFILE, segments: 10 },
      }),
      greeble('manifold', 'cylinder', [0.14, W * 0.58, 0.14], [0, torsoY + 0.40, -W * 0.42], 'bareMetal', {
        rot: [0, 0, HALF_PI], group: 'pack', shape: { segments: 8 },
      }),
    );
  } else {
    masses.push(
      greeble('radio', 'taperedBox', [W * 0.52, 0.44, 0.22], [0, torsoY + 0.10, -W * 0.42], 'paintSmall', {
        group: 'pack', shape: { topScaleX: 0.88, topScaleZ: 0.86, shear: -0.03 },
      }),
      greeble('aerial', 'cylinder', [0.05, 0.62, 0.05], [W * 0.20, torsoY + 0.52, -W * 0.42], 'bareMetal', {
        rot: [-0.14, 0, 0], group: 'pack', shape: { segments: 8 },
      }),
    );
  }

  masses.push(
    // Every variant tops out at exactly H, whatever it is carrying, so the R-S4
    // height ratio does not swing with the backpack.
    greeble('helmetAerial', 'cylinder', [0.05, H * 0.14, 0.05], [-W * 0.18, H - H * 0.07, -0.06], 'bareMetal', {
      group: 'helmet gear', shape: { segments: 8 },
    }),
    // The fin keeps the NAME, the group and the hip pivot of the boot it
    // replaces, and all three are load-bearing: `RIDES_THE_LEG` in
    // `tests/infantry-gait-rosters.spec.ts` is keyed on the name, and a blade
    // hanging half a metre off the ankle shears off the shin the moment the
    // walk cycle runs unless it turns about the same joint the thigh does.
    o.pack === 'rebreather'
      ? greeble('boot', 'taperedBox', [W * 0.42, 0.13, W * 1.18], [W * 0.24, 0.066, W * 0.24], 'paintTiny', {
        mirrorX: true, group: 'boots', gait: { limb: 'leg', pivotY: legTop },
        shape: { topScaleX: 0.60, topScaleZ: 1.16, shear: W * 0.14 },
      })
      : greeble('boot', 'taperedBox',
        coat ? [W * 0.46, 0.19, W * 0.70] : [W * 0.38, 0.15, W * 0.60],
        [W * 0.24, coat ? 0.095 : 0.075, coat ? 0.08 : 0.055], 'paintTiny', {
        mirrorX: true, group: 'boots', gait: { limb: 'leg', pivotY: legTop },
        shape: coat
          ? { topScaleX: 1.18, topScaleZ: 0.96, bottomScaleX: 0.92, bottomScaleZ: 1.08, cornerCut: 0.08 }
          : { topScaleX: 0.94, topScaleZ: 0.84, bottomScaleX: 1.06, bottomScaleZ: 1.10, shear: -0.05 },
      }),
    plateMass('webbing', MassRole.Greeble, taperOutline(W * 0.90, W * 0.66, 0.86), 0.12,
      [0, torsoY - torsoH * 0.34, 0], undefined, 'paintTiny', { group: 'webbing' }),
    greeble('collar', 'revolve', [W * 0.60, 0.11, W * 0.50], [0, legTop + torsoH - 0.03, 0], 'paintTiny', {
      group: 'collar', shape: { profile: DRUM_PROFILE, segments: 10 },
    }),
    greeble('kneePad', 'taperedBox', [W * 0.28, 0.17, W * 0.30], [W * 0.24, legTop * 0.44, W * 0.11], 'paintTiny', {
      mirrorX: true, group: 'knee pads', gait: { limb: 'leg', pivotY: legTop },
      shape: { topScaleX: 0.84, topScaleZ: 0.72, shear: -0.03 },
    }),
    greeble('pouch', 'taperedBox', [W * 0.20, 0.20, 0.15], [W * 0.27, torsoY - torsoH * 0.40, W * 0.24], 'paintTiny', {
      mirrorX: true, group: 'pouches', shape: { topScaleX: 0.88, topScaleZ: 0.78 },
    }),
  );

  /* -- the commander's three silhouette shapes ---------------------------- */
  if (o.officer === true) {
    masses.push(
      // The cape. A tapered plate from the shoulder line to mid-calf, canted a
      // few degrees off vertical so it reads as cloth hanging rather than as a
      // board bolted on. This is the shape that does the work at 20 px.
      armour('cape', taperOutline(W * 1.24, W * 0.86, 1.34), 0.06,
        [0, torsoY - torsoH * 0.16, -W * 0.52], [0.16, 0, 0],
        'paintMed', 'cape'),
      // One oversized pauldron, LEFT only. Asymmetry is what stops this reading
      // as "the rifleman, but chunkier".
      greeble('pauldron', 'taperedBox', [W * 0.46, 0.30, W * 0.54],
        [-W * 0.46, torsoY + torsoH * 0.34, 0], 'paintSmall', {
          rot: [0, 0, 0.16], group: 'pauldron',
          shape: { topScaleX: 1.16, topScaleZ: 1.06, bottomScaleX: 0.72, bottomScaleZ: 0.80 },
        }),
      // The crest, sitting on the helmet's centreline. Its half-height is
      // subtracted from its anchor so the top lands exactly on H.
      greeble('crest', 'taperedBox', [0.07, H * 0.14, W * 0.40],
        [0, H - H * 0.07, -0.02], 'bareMetal', {
          group: 'crest',
          shape: { topScaleX: 0.70, topScaleZ: 0.58, bottomScaleX: 1.0, bottomScaleZ: 1.0 },
        }),
    );
  }

  // Team colour: 20-28% of surface (R-T1). Chest, both shoulders, helmet band.
  masses.push(
    slab('chestPlate', [W * 0.72, torsoH * 0.66, 0.06], [0, torsoY + 0.04, W * 0.32], { k: TEAM_K.infantry }),
    slab('shoulderPad', [W * 0.34, 0.34, W * 0.44], [W * 0.44, torsoY + torsoH * 0.30, 0], { mirrorX: true , k: TEAM_K.infantry }),
    slab('helmetBand', [W * 0.58, 0.12, W * 0.62], [0, legTop + torsoH + H * 0.030, 0.01], { k: TEAM_K.infantry }),
    slab('thighBand', [W * 0.42, 0.20, W * 0.50], [W * 0.24, legTop * 0.72, 0],
      { mirrorX: true, k: TEAM_K.infantry, gait: { limb: 'leg', pivotY: legTop } }),
  );
  masses.push(insignia([0.26, 0.26, 0.05], [W * 0.30, torsoY + torsoH * 0.24, W * 0.33]));
  masses.push(
    glowPanel('visor', [W * 0.46, 0.14, 0.05], [0, legTop + torsoH + H * 0.030, W * 0.29]),
    glowPanel('packLamp', [W * 0.30, 0.16, 0.05], [0, torsoY + 0.24, -W * 0.53]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.MuzzleA, pos: [W * 0.44, torsoY + 0.02, 0.78] },
    { part: PartId.Emitter, pos: [0, torsoY, 0] },
  ];

  return {
    key: o.key,
    name: o.name,
    faction: o.faction,
    cls: 'infantry',
    hullLength: W,
    masses,
    sockets,
    hullNumber: o.hullNumber,
  };
}

/* ==========================================================================
 * 4. THE ATTACK DOG
 *
 * A quadruped, not a rifleman. This is the entity the audit ranked #4 by
 * visibility: it drew `soviet_conscript`, so a Soviet scouting rush was three
 * standing riflemen sprinting at 9 m/s.
 *
 * Class is `walker`, not `infantry`: `validateUnit` holds infantry to R-S4's
 * 0.30-0.38 x MBT-hull height band (2.1-2.7 m), which a dog cannot satisfy
 * without becoming a bear. See the report — `units.system.ts` must map the
 * `attackDog` content key to `EntityKind.Infantry` explicitly rather than
 * inferring the kind from `cls`.
 * ========================================================================== */

function attackDog(): UnitMassList {
  const H = 1.36;                 // withers to ground; the ears clear it
  const L = 1.70;
  const bodyY = H * 0.655;
  const bodyH = H * 0.46;
  const bodyL = L * 0.68;

  const masses: MassDef[] = [
    // The chest-and-flank barrel: a convex hull, deep at the shoulder and
    // tucked at the loin, which is the whole dog read in one mass.
    primary('body', 'hull', [0.52, bodyH, bodyL], [0, bodyY, L * 0.02], 'paintMed', {
      shape: {
        points: [
          [0, 0.40, 0.50], [0.34, 0.30, 0.30], [-0.34, 0.30, 0.30],
          [0.44, -0.04, 0.22], [-0.44, -0.04, 0.22],
          [0.30, -0.44, 0.16], [-0.30, -0.44, 0.16],
          [0.30, 0.34, -0.24], [-0.30, 0.34, -0.24],
          [0.26, -0.34, -0.34], [-0.26, -0.34, -0.34],
          [0, 0.06, -0.50],
        ],
        chamfer: 0.035,
      },
    }),
    // The head: a wedge skull with a tapered muzzle, tipped forward and down.
    primary('head', 'hull', [0.34, H * 0.30, L * 0.26], [0, H * 0.80, L * 0.40], 'paintMed', {
      rot: [0.22, 0, 0],
      shape: {
        points: [
          [0.28, 0.34, -0.44], [-0.28, 0.34, -0.44], [0.34, -0.10, -0.34], [-0.34, -0.10, -0.34],
          [0.20, 0.16, 0.24], [-0.20, 0.16, 0.24], [0.22, -0.30, 0.16], [-0.22, -0.30, 0.16],
          [0.11, -0.02, 0.50], [-0.11, -0.02, 0.50], [0, -0.24, 0.44],
        ],
        chamfer: 0.03,
      },
    }),
    // Fore and hind legs. Tapered and angled, mirrored — four legs out of two
    // masses, and neither has a vertical wall.
    primary('foreleg', 'taperedBox', [0.15, H * 0.50, 0.22], [0.19, H * 0.25, L * 0.26], 'paintSmall', {
      mirrorX: true, rot: [-0.14, 0, 0.04],
      shape: { topScaleX: 1.40, topScaleZ: 1.55, bottomScaleX: 0.62, bottomScaleZ: 0.72 },
    }),
    primary('hindleg', 'taperedBox', [0.17, H * 0.52, 0.30], [0.20, H * 0.26, -L * 0.24], 'paintSmall', {
      mirrorX: true, rot: [0.20, 0, 0.05],
      shape: { topScaleX: 1.50, topScaleZ: 1.70, bottomScaleX: 0.58, bottomScaleZ: 0.62 },
    }),
  ];

  masses.push(
    greeble('muzzle', 'cone', [0.17, 0.24, 0.17], [0, H * 0.76, L * 0.56], 'paintTiny', {
      rot: [-HALF_PI + 0.18, 0, 0], group: 'head gear', shape: { segments: 10, rTop: 0.52 },
    }),
    plateMass('ear', MassRole.Greeble,
      [[0.05, -0.10], [0.03, 0.06], [0, 0.11], [-0.05, 0.02], [-0.04, -0.10]], 0.04,
      [0.10, H * 0.98, L * 0.30], [0.30, 0.22, 0.16], 'paintSmall', { mirrorX: true, group: 'ears' }),
    greeble('tail', 'cone', [0.09, 0.42, 0.09], [0, H * 0.72, -L * 0.44], 'paintSmall', {
      rot: [-1.05, 0, 0], group: 'tail', shape: { segments: 8, rTop: 0.28 },
    }),
    greeble('paw', 'chamferBox', [0.16, 0.09, 0.22], [0.19, 0.045, L * 0.29], 'paintTiny', { mirrorX: true, group: 'paws' }),
    greeble('pawRear', 'chamferBox', [0.17, 0.09, 0.24], [0.20, 0.045, -L * 0.29], 'paintTiny', { mirrorX: true, group: 'paws' }),
    // The kit that makes it a MILITARY dog rather than a stray: a harness
    // frame, saddle panniers and a hardened sensor pod.
    armour('harness', taperOutline(0.50, bodyL * 0.60, 0.74), 0.05,
      [0, bodyY + bodyH * 0.44, L * 0.02], undefined, 'bareMetal', 'harness'),
    greeble('pannier', 'taperedBox', [0.09, 0.20, bodyL * 0.40], [0.25, bodyY + bodyH * 0.08, -L * 0.02], 'paintSmall', {
      mirrorX: true, group: 'panniers', shape: { topScaleX: 0.80, topScaleZ: 0.88 },
    }),
    greeble('sensorPod', 'cylinder', [0.10, 0.14, 0.10], [0.10, bodyY + bodyH * 0.56, L * 0.16], 'bareMetal', {
      rot: [0.30, 0, 0], group: 'sensor', shape: { segments: 10 },
    }),
  );

  // Walkers take the infantry team band: 20-28%.
  masses.push(
    slab('collar', [0.40, 0.13, 0.30], [0, H * 0.74, L * 0.24], { k: TEAM_K.dog }),
    slab('saddle', [0.44, 0.06, bodyL * 0.50], [0, bodyY + bodyH * 0.50, L * 0.02], { k: TEAM_K.dog }),
    slab('flankBand', [0.05, bodyH * 0.46, bodyL * 0.42], [0.26, bodyY - bodyH * 0.06, 0], { mirrorX: true , k: TEAM_K.dog }),
    slab('hipBand', [0.20, 0.10, 0.26], [0.20, H * 0.46, -L * 0.24], { mirrorX: true , k: TEAM_K.dog }),
  );
  masses.push(insignia([0.16, 0.04, 0.16], [0, bodyY + bodyH * 0.52, -L * 0.14]));
  masses.push(
    glowPanel('eye', [0.24, 0.10, 0.05], [0, H * 0.86, L * 0.48]),
    glowPanel('packLamp', [0.18, 0.05, 0.20], [0, bodyY + bodyH * 0.52, -L * 0.24]),
  );

  return {
    key: 'soviet_dog',
    name: 'Attack Dog',
    faction: 'soviets',
    cls: 'walker',
    hullLength: L,
    masses,
    sockets: [
      { part: PartId.MuzzleA, pos: [0, H * 0.76, L * 0.62] },
      { part: PartId.Emitter, pos: [0, bodyY, 0] },
    ],
    hullNumber: 8188,
  };
}

/* ==========================================================================
 * 5. THE TRACKED-TANK TEMPLATE
 * ========================================================================== */

type GunKind = 'cannon' | 'twinCannon' | 'prism' | 'flak' | 'rocketRack';

interface TankOpts {
  key: string;
  name: string;
  faction: UnitMassList['faction'];
  hullNumber: number;
  /** Hull long axis. MBT = 7.0 m and everything else is a ratio of it. */
  hullLength: number;
  hullWidth: number;
  /** Total silhouette height including the mast. */
  height: number;
  /** Soviet hulls are slab-shouldered; Allied hulls are sleek and low. */
  brutalist: boolean;
  gun: GunKind;
  wheels?: number;
  /** Tier-3 heavies get a second armour belt, more rollers and a deep skirt. */
  heavy?: boolean;
  /** V2 construction language for the first four-faction vertical slice. */
  v2Style?: 'precision' | 'dominion';
}

function tank(o: TankOpts): UnitMassList {
  const H = o.height;
  const L = o.hullLength;
  const W = o.hullWidth;
  // V2 is the default grammar for the whole tracked combat roster, not a skin
  // reserved for the two showcase tanks. The override remains for deliberate
  // one-off prototypes, while every shipped Allied/Soviet tank inherits its
  // faction construction language automatically.
  const v2Style = o.v2Style ?? (o.faction === 'allies' ? 'precision' : 'dominion');

  // Bible 5.3: chassis is a thin 35-45% base, superstructure is the top 55-65%.
  const trackH = H * UNIT_LADDER.chassisHeightFraction * 0.55;
  // V3 lowers the fighting compartment and spends the height on width and
  // length. The legacy 0.50H turret was the main reason tanks read as toy
  // blocks: half the vehicle was a single upright mass.
  const hullH = H * 0.255;
  const hullY = trackH + hullH * 0.5;
  const turretH = H * 0.46;
  const turretY = H * 0.625;
  const turretW = W * UNIT_LADDER.turretWidthOverHull;
  const turretL = L * 0.74;
  const turretZ = -L * 0.06;
  const deckY = trackH + hullH;
  const turretRoof = turretY + turretH * 0.5;
  const gunY = turretY + turretH * 0.06;

  const masses: MassDef[] = [
    /* -- 1. running gear ------------------------------------------------- */
    runningGear(W, trackH, L * 0.94, o.wheels ?? 5, {
      skirt: trackH * (o.heavy === true ? 0.58 : 0.44),
      rollers: o.heavy === true ? 3 : 2,
    }),

    /* -- 2. hull: tapered, sheared into a glacis, octagonal in plan ------ */
    // `shear` is the important field. Sliding the top face aft turns the front
    // wall into a real sloped glacis, which is the most recognisable line on an
    // RA3 tank and the reason this mass measures 0% flat wall instead of 100%.
    v2Style === 'precision'
      // Coalition hull: one continuous aerospace shell with a spear prow,
      // pinched waist and clipped stern. These are real convex-hull planes,
      // not plates laid over the rectangular legacy chassis.
      ? primary('hull', 'hull', [W, hullH, L], [0, hullY, 0], 'paintLarge', {
        shape: {
          points: [
            [0, 0.34, 0.50], [0.32, 0.28, 0.42], [-0.32, 0.28, 0.42],
            [0.48, 0.08, 0.20], [-0.48, 0.08, 0.20],
            [0.40, 0.26, -0.46], [-0.40, 0.26, -0.46],
            [0.26, 0.42, -0.50], [-0.26, 0.42, -0.50],
            [0, -0.48, 0.46], [0.48, -0.40, 0.18], [-0.48, -0.40, 0.18],
            [0.42, -0.46, -0.46], [-0.42, -0.46, -0.46],
          ],
          chamfer: 0.055,
        },
      })
      : v2Style === 'dominion'
        // Dominion hull: a broad cast wedge with hammerhead shoulders and a
        // narrower engine tail. Its outline is intentionally heavier than the
        // Coalition spear, but it is no longer a beveled rectangular block.
        ? primary('hull', 'hull', [W, hullH, L], [0, hullY, 0], 'paintLarge', {
          shape: {
            points: [
              [0.34, 0.34, 0.50], [-0.34, 0.34, 0.50],
              [0.50, 0.18, 0.34], [-0.50, 0.18, 0.34],
              [0.46, 0.30, -0.28], [-0.46, 0.30, -0.28],
              [0.34, 0.40, -0.50], [-0.34, 0.40, -0.50],
              [0.42, -0.46, 0.46], [-0.42, -0.46, 0.46],
              [0.50, -0.42, 0.22], [-0.50, -0.42, 0.22],
              [0.36, -0.48, -0.50], [-0.36, -0.48, -0.50],
            ],
            chamfer: 0.05,
          },
        })
        : primary('hull', 'taperedBox', [W, hullH, L], [0, hullY, 0], 'paintLarge', {
          shape: o.brutalist
            ? { topScaleX: 0.90, topScaleZ: 0.94, shear: -L * 0.045, cornerCut: W * 0.075 }
            : { topScaleX: 0.86, topScaleZ: 0.90, shear: -L * 0.065, cornerCut: W * 0.055 },
        }),

    /* -- 3. turret: lathed, 14 facets, no flat side at all --------------- */
    v2Style === 'precision'
        ? primary('turret', 'hull', [turretW * 1.26, turretH, turretL * 1.18], [0, turretY, turretZ], 'paintLarge', {
        turret: true, capSlot: 'paintLarge',
        shape: {
          points: [
            [0, 0.42, 0.38], [0.38, 0.32, 0.30], [-0.38, 0.32, 0.30],
            [0.52, 0.00, 0.12], [-0.52, 0.00, 0.12],
            [0.45, -0.42, 0.34], [-0.45, -0.42, 0.34],
            [0.48, -0.38, -0.36], [-0.48, -0.38, -0.36],
            [0.34, 0.20, -0.50], [-0.34, 0.20, -0.50],
            [0, 0.34, -0.46],
          ],
          chamfer: 0.05,
        },
      })
      : v2Style === 'dominion'
        // A cast hammerhead gun house. The earlier tapered box had sloped walls
        // but kept a rectangular plan from the gameplay camera; this convex
        // casting pushes mass into the trunnion cheeks, pinches the engine-side
        // tail and gives every corner a different plane.
        ? primary('turret', 'hull', [turretW * 1.18, turretH, turretL * 1.18],
          [0, turretY, turretZ], 'paintLarge', {
            turret: true, capSlot: 'paintLarge',
            shape: {
              points: [
                [0.38, 0.34, 0.48], [-0.38, 0.34, 0.48],
                [0.50, 0.10, 0.30], [-0.50, 0.10, 0.30],
                [0.46, -0.42, 0.38], [-0.46, -0.42, 0.38],
                [0.50, -0.38, -0.24], [-0.50, -0.38, -0.24],
                [0.31, 0.26, -0.50], [-0.31, 0.26, -0.50],
                [0.36, -0.34, -0.46], [-0.36, -0.34, -0.46],
              ],
              chamfer: 0.055,
            },
          })
      : primary('turret', 'revolve', [turretW, turretH, turretL], [0, turretY, turretZ], 'paintLarge', {
        turret: true, capSlot: 'paintLarge',
        shape: {
          profile: o.brutalist ? SOVIET_TURRET : ALLIED_TURRET,
          segments: 14,
        },
      }),
  ];

  if (v2Style === 'precision') {
    masses.push(
      // One continuous shoulder fairing per flank. It hides the top half of the
      // running gear and gives the Coalition its aerospace silhouette before
      // colour or panel work is visible.
      primary('trackFairing', 'taperedBox', [W * 0.22, trackH * 1.02, L * 0.90],
        [W * 0.54, trackH * 0.77, -L * 0.01], 'paintMed', {
          mirrorX: true, group: 'fairings',
          shape: { topScaleX: 0.48, topScaleZ: 0.80, shear: -L * 0.07, cornerCut: 0.20 },
        }),
      armour('noseWing', taperOutline(W * 0.78, L * 0.22, 0.28), 0.10,
        [0, deckY + 0.04, L * 0.36], [-0.16, 0, 0], 'paintMed', 'nose shell'),
      greeble('commandFin', 'taperedBox', [0.12, H * 0.22, L * 0.16],
        [-turretW * 0.22, H - H * 0.13, turretZ - turretL * 0.30], 'bareMetal', {
          turret: true, group: 'command fin',
          shape: { topScaleX: 0.45, topScaleZ: 0.54, shear: -0.08 },
        }),
      // A second, thinner shell over the fairing gives the running gear a
      // deliberate aerospace shoulder instead of one deep slab. It remains in
      // the fairings group, so the added geometry costs no readable-greeble
      // budget and still merges into the existing hull draw.
      armour('fairingBlade', taperOutline(L * 0.50, trackH * 0.40, 0.64, 0.86), 0.07,
        [W * 0.615, trackH * 0.88, -L * 0.015],
        [0, HALF_PI, HALF_PI - 0.18], 'paintSmall', 'hull armour', { mirrorX: true }),
      // A broad cobalt sensor canopy is the secondary read against the white
      // monocoque. It is a faceted wedge, not a dark texture patch, so it keeps
      // its silhouette and specular break after the atlas detail disappears.
      greeble('sensorCanopy', 'hull', [turretW * 0.62, H * 0.10, turretL * 0.34],
        [0, turretRoof + H * 0.032, turretZ + turretL * 0.07], 'glass', {
          turret: true, group: 'cupola',
          shape: {
            points: [
              [0, 0.50, 0.44], [0.46, 0.10, 0.30], [-0.46, 0.10, 0.30],
              [0.40, -0.50, 0.38], [-0.40, -0.50, 0.38],
              [0.32, 0.24, -0.50], [-0.32, 0.24, -0.50],
              [0.38, -0.50, -0.42], [-0.38, -0.50, -0.42],
            ],
            chamfer: 0.045,
          },
        }),
      // Twin vector exhausts are a rear-facing counter-read to the spear prow.
      // Dark apertures and swept housings are visible at gameplay pitch without
      // adding another colour patch to the quiet macro shell.
      greeble('vectorVent', 'taperedBox', [W * 0.17, H * 0.12, L * 0.15],
        [W * 0.29, deckY + H * 0.055, -L * 0.43], 'grille', {
          mirrorX: true, group: 'hull.spineRun',
          shape: { topScaleX: 0.64, topScaleZ: 0.72, shear: -L * 0.025, cornerCut: 0.06 },
        }),
    );
  } else if (v2Style === 'dominion') {
    masses.push(
      // A cast shoulder collar visually locks the turret into the hull instead
      // of leaving another disc perched on another box.
      primary('turretCollar', 'revolve', [turretW * 1.04, turretH * 0.22, turretW * 0.96],
        [0, deckY + turretH * 0.10, turretZ], 'bareMetal', {
          shape: { profile: DRUM_PROFILE, segments: 16 }, group: 'turret collar',
        }),
      greeble('engineDrum', 'revolve', [W * 0.30, H * 0.28, W * 0.30],
        [W * 0.30, deckY + H * 0.10, -L * 0.34], 'bareMetal', {
          mirrorX: true, group: 'power pack', shape: { profile: DRUM_PROFILE, segments: 20 },
        }),
      greeble('exhaustStack', 'cone', [0.24, H * 0.34, 0.24],
        [W * 0.36, deckY + H * 0.15, -L * 0.30], 'bareMetal', {
          mirrorX: true, group: 'power pack', shape: { segments: 12, rTop: 0.76 },
        }),
      // A thick forged brow makes the roof a stepped casting rather than the
      // top face of a tapered box. Its shallow forward rake remains readable
      // after the panel texture has disappeared at RTS distance.
      armour('turretBrow', taperOutline(turretW * 0.76, turretL * 0.21, 0.76), 0.12,
        [0, turretRoof + 0.035, turretZ + turretL * 0.31], [-0.12, 0, 0],
        'paintMed', 'turret armour', { turret: true }),
      // Cast trunnion bosses lock the broad gun house to the collar. The old
      // turret had one uninterrupted vertical cheek and read as a crate.
      greeble('cheekBoss', 'cylinder', [H * 0.16, H * 0.12, H * 0.16],
        [turretW * 0.51, turretY - turretH * 0.02, turretZ + turretL * 0.08], 'bareMetal', {
          turret: true, mirrorX: true, rot: [0, 0, HALF_PI], group: 'turret armour',
          shape: { segments: 10, rTop: 0.90, capChamfer: 0.045 },
        }),
      // One offset armoured searchlight is a functional asymmetry cue without
      // changing the Dominion's otherwise disciplined bilateral massing.
      greeble('searchlight', 'cylinder', [H * 0.14, H * 0.11, H * 0.14],
        [turretW * 0.34, turretY + turretH * 0.12, turretZ + turretL * 0.48], 'glass', {
          turret: true, rot: [HALF_PI, 0, 0], group: 'cupola',
          shape: { segments: 10, rTop: 0.86, capChamfer: 0.04 },
        }),
      // Segmented applique over the upper track run gives the lower silhouette
      // the same forged hierarchy as the turret and preserves visible tracks.
      armour('skirtApron', taperOutline(L * 0.48, trackH * 0.70, 0.78, 0.90), 0.09,
        [W * 0.575, trackH * 0.68, -L * 0.035],
        [0, HALF_PI, HALF_PI - 0.10], 'paintSmall', 'power pack', { mirrorX: true }),
    );
  }

  /* -- 4. armament -------------------------------------------------------- */
  const muzzleZ = turretL * 0.5 + L * 0.40;
  switch (o.gun) {
    case 'twinCannon': {
      const barrelLength = L * 0.66;
      masses.push(
        // Derive the barrel centre from the muzzle socket. The old anchor left
        // more than a metre of daylight between the visible tube and the flash.
        barrelMass('barrel', 0.30, barrelLength, [W * 0.16, gunY, muzzleZ - barrelLength * 0.5], { turret: true, mirrorX: true }),
        armour('turret.gunShield', taperOutline(turretW * 0.86, turretH * 0.66, 0.74), 0.10,
          [0, gunY, turretZ + turretL * 0.44], [-1.42, 0, 0], 'bareMetal', 'turret armour', { turret: true }),
        // Broad, ported Dominion brakes: square enough to read as heavy weapon
        // hardware, with a dark front face instead of a capped metal rod.
        greeble('muzzleBrake', 'taperedBox', [0.58, 0.48, L * 0.10],
          [W * 0.16, gunY, muzzleZ - L * 0.05], 'bareMetal', {
            turret: true, mirrorX: true, group: 'muzzles', faceSlots: { pz: 'grille' },
            shape: { topScaleX: 0.82, topScaleZ: 0.88, cornerCut: 0.08 },
          }),
      );
      break;
    }
    case 'prism':
      masses.push(
        primary('prismHousing', 'revolve', [W * 0.44, L * 0.46, W * 0.44], [0, gunY + 0.10, turretZ + turretL * 0.34], 'paintMed', {
          turret: true, rot: [HALF_PI, 0, 0], shape: { profile: TAPER_DRUM, segments: 14 },
        }),
        greeble('prismCrystal', 'cone', [W * 0.30, 0.42, W * 0.30], [0, gunY + 0.10, turretZ + turretL * 0.34 + L * 0.23], 'emissive', {
          turret: true, rot: [HALF_PI, 0, 0], group: 'turret armour', shape: { segments: 8, rTop: 0.25 },
        }),
      );
      break;
    case 'flak':
      masses.push(
        primary('flakBarrel', 'cylinder', [0.20, L * 0.50, 0.20], [W * 0.13, gunY + 0.16, turretZ + turretL * 0.26], 'bareMetal', {
          turret: true, mirrorX: true, rot: [1.16, 0, 0], shape: { segments: 10, rTop: 0.88 },
        }),
        greeble('flakCradle', 'taperedBox', [W * 0.52, 0.26, turretL * 0.34], [0, gunY + 0.10, turretZ + turretL * 0.20], 'paintSmall', {
          turret: true, group: 'turret armour', shape: { topScaleX: 0.80, topScaleZ: 0.88, shear: 0.06 },
        }),
      );
      break;
    case 'rocketRack':
      masses.push(
        // A hexagonal-plan launch box on a real elevation, not an axis-aligned
        // crate: the plan prism gives it six walls, none of them square-on.
        primary('rocketRack', 'planPrism', [W * 0.78, H * 0.26, L * 0.56], [0, gunY + 0.14, turretZ + turretL * 0.10], 'paintMed', {
          turret: true, rot: [-0.30, 0, 0], capSlot: 'grille',
          shape: {
            plan: [
              [W * 0.39, -L * 0.28], [W * 0.39, L * 0.20], [W * 0.24, L * 0.28],
              [-W * 0.24, L * 0.28], [-W * 0.39, L * 0.20], [-W * 0.39, -L * 0.28],
            ],
            topScaleX: 0.88, topScaleZ: 0.94,
          },
        }),
        greeble('railPair', 'extrude', [W * 0.16, 0.16, L * 0.58], [W * 0.26, gunY + 0.30, turretZ + turretL * 0.14], 'bareMetal', {
          turret: true, mirrorX: true, rot: [-0.30, 0, 0], group: 'turret armour',
          shape: {
            profile: ductSection(0.22),
            path: [[0, 0, -L * 0.29], [0, 0, 0], [0, 0, L * 0.29]],
            scale: [1.0, 0.94, 0.82], capStart: true, capEnd: true,
          },
        }),
      );
      break;
    default: {
      const barrelLength = L * 0.70;
      masses.push(
        // The visible tube now terminates at the same point the projectile and
        // muzzle flash use. Previously it stopped 1.3-1.4 m behind the socket,
        // which made both faction MBTs look snub-nosed from gameplay height.
        barrelMass('barrel', 0.42, barrelLength, [0, gunY, muzzleZ - barrelLength * 0.5], { turret: true }),
        // A real bore evacuator: the stepped sleeve is a major modern-tank cue
        // at exactly the screen scale where panel texture has disappeared.
        greeble('boreEvacuator', 'cylinder',
          [v2Style === 'dominion' ? 0.64 : 0.56, L * (v2Style === 'dominion' ? 0.16 : 0.14), v2Style === 'dominion' ? 0.64 : 0.56],
          [0, gunY, muzzleZ - L * 0.25], 'bareMetal', {
            turret: true, rot: [HALF_PI, 0, 0], group: 'muzzles',
            shape: { segments: v2Style === 'dominion' ? 12 : 14, rTop: 0.92, capChamfer: 0.035 },
          }),
      );
      if (v2Style === 'dominion') {
        masses.push(greeble('muzzleBrake', 'taperedBox', [0.76, 0.58, L * 0.11],
          [0, gunY, muzzleZ - L * 0.055], 'bareMetal', {
            turret: true, group: 'muzzles', faceSlots: { pz: 'grille' },
            shape: { topScaleX: 0.80, topScaleZ: 0.86, cornerCut: 0.10 },
          }));
      } else {
        masses.push(greeble('muzzleCollar', 'cone', [0.58, L * 0.08, 0.58],
          [0, gunY, muzzleZ - L * 0.04], 'bareMetal', {
            turret: true, rot: [HALF_PI, 0, 0], group: 'muzzles',
            shape: { segments: 14, rTop: 0.82, capChamfer: 0.028 },
          }));
      }
      break;
    }
  }

  /* -- 5. layered armour: the hi-tech surface read ------------------------ */
  masses.push(
    // The glacis: a trapezoid lying back 34 degrees over the bow.
    armour('hull.glacis', taperOutline(W * 0.92, L * 0.34, 0.72), 0.09,
      [0, hullY + hullH * 0.30, L * 0.30], [-0.60, 0, 0], 'paintMed', 'hull armour'),
    // Flank plates, splayed 12 degrees off the wall and standing proud of it.
    armour('hull.flankPlate', taperOutline(L * 0.52, hullH * 1.10, 0.80), 0.07,
      [W * 0.47, hullY + hullH * 0.06, -L * 0.04],
      [0, HALF_PI, HALF_PI - 0.21], 'paintMed', 'hull armour', { mirrorX: true }),
    // An engine-deck plate, dropped 4 degrees toward the stern.
    armour('hull.deckPlate', rectOutline(W * 0.62, L * 0.30), 0.07,
      [0, hullY + hullH * 0.52, -L * 0.28], [0.07, 0, 0], 'paintMed', 'hull armour'),
    // Turret cheeks, splayed off the lathe so the turret is not a pure solid.
    armour('turret.cheek', taperOutline(turretL * 0.46, turretH * 0.60, 0.74), 0.07,
      [turretW * 0.40, turretY + turretH * 0.04, turretZ - turretL * 0.02],
      [0, HALF_PI, HALF_PI - 0.16], 'paintMed', 'turret armour', { turret: true, mirrorX: true }),
  );
  if (o.gun !== 'prism' && o.gun !== 'rocketRack') {
    // The mantlet: the plate the gun comes through, stood almost vertical.
    masses.push(armour('turret.mantlet', taperOutline(turretW * 0.52, turretH * 0.86, 0.78), 0.11,
      [0, gunY, turretZ + turretL * 0.40], [-1.49, 0, 0], 'bareMetal', 'turret armour', { turret: true }));
  }
  if (o.heavy === true) {
    // A tier-3 belt: one more plate down each flank at a shallower angle, so
    // the hull reads as spaced armour rather than as one thicker wall.
    masses.push(armour('hull.beltPlate', taperOutline(L * 0.40, hullH * 0.72, 0.86), 0.08,
      [W * 0.50, trackH + hullH * 0.16, L * 0.22],
      [0, HALF_PI, HALF_PI - 0.34], 'paintSmall', 'hull armour', { mirrorX: true }));
  }

  /* -- 6. greebles -------------------------------------------------------- */
  masses.push(
    // The old generic exhaust/stowage kit is intentionally omitted: V2's
    // faction-specific fairings or power pack already carry this hierarchy.
    greebleRun('hull.spineRun', L * 0.44, 0.22, 0.15, [-W * 0.30, deckY + 0.04, -L * 0.06], 0x51 + o.hullNumber),
    greeble('cupola', 'revolve', [turretW * 0.30, H * 0.09, turretW * 0.30],
      [-turretW * 0.22, turretRoof + H * 0.045, turretZ - turretL * 0.16], 'hatch', {
        turret: true, group: 'cupola', shape: { profile: DOME_PROFILE, segments: 12 },
      }),
    greeble('aaMount', 'cylinder', [0.14, 0.72, 0.14],
      [turretW * 0.26, turretRoof + H * 0.040, turretZ - turretL * 0.06], 'bareMetal', {
        turret: true, rot: [HALF_PI - 0.10, 0.22, 0], group: 'aa mount', shape: { segments: 8 },
      }),
    greeble('turretBox', 'taperedBox', [turretW * 0.62, turretH * 0.34, turretL * 0.20],
      [0, turretY + turretH * 0.20, turretZ - turretL * 0.52], 'paintSmall', {
        turret: true, group: 'turret bustle', shape: { topScaleX: 0.84, topScaleZ: 0.86, shear: -0.06 },
      }),
    greeble('mast', 'cylinder', [0.07, H * 0.16, 0.07],
      [-turretW * 0.40, H - H * 0.08, turretZ - turretL * 0.34], 'bareMetal', {
        turret: true, group: 'mast', shape: { segments: 8 },
      }),
  );

  /* -- 7. team colour (R-T1: 8-14% of surface, flat panels only) ---------- */
  if (v2Style === 'dominion') {
    masses.push(
      slab('skirtBox', [0.09, hullH * 0.98, L * 0.405], [W * 0.52, hullY, L * 0.18], { mirrorX: true, k: TEAM_K.tank }),
      slab('skirtBoxRear', [0.09, hullH * 0.98, L * 0.365], [W * 0.52, hullY, -L * 0.22], { mirrorX: true, k: TEAM_K.tank }),
      slab('glacisBand', [W * 0.48, 0.07, L * 0.11], [0, deckY, L * 0.40], { k: TEAM_K.tank }),
    );
  } else {
    masses.push(
      slab('turretCheekBand', [0.07, turretH * 0.56, turretL * 0.56],
        [turretW * 0.5, turretY + turretH * 0.04, turretZ - turretL * 0.04], { turret: true, mirrorX: true , k: TEAM_K.tank }),
      slab('hullFlankBand', [0.07, hullH * 0.62, L * 0.50], [W * 0.49, hullY, -L * 0.06], { mirrorX: true , k: TEAM_K.tank }),
      slab('turretCap', [turretW * 0.34, 0.07, turretL * 0.30],
        [-turretW * 0.16, turretRoof, turretZ - turretL * 0.02], { turret: true , k: TEAM_K.tank }),
      slab('glacisBand', [W * 0.42, 0.07, L * 0.09], [0, deckY, L * 0.40], { k: TEAM_K.tank }),
    );
  }
  const insigniaZ = v2Style === 'dominion'
    ? turretZ - turretL * 0.22
    : turretZ - turretL * 0.16;
  masses.push(insignia([turretW * 0.30, 0.06, turretW * 0.30],
    [turretW * 0.20, turretRoof + 0.02, insigniaZ], { turret: true }));
  // R-T5 wants emissive at 1-3% of surface. The atlas masks 42% of each plate,
  // so the plates are sized against that, not against their own area.
  masses.push(
    glowPanel('rearLamp', [0.40, 0.28, 0.06], [W * 0.28, deckY - 0.08, -L * 0.5], { mirrorX: true }),
    glowPanel('deckStrip', [W * 0.62, 0.06, L * 0.17], [0, deckY + 0.02, -L * 0.40]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.Turret, pos: [0, turretY, turretZ] },
    { part: PartId.MuzzleA, pos: [o.gun === 'twinCannon' ? W * 0.16 : 0, gunY, muzzleZ], turret: true },
    { part: PartId.Exhaust, pos: [W * 0.34, deckY + 0.60, -L * 0.30] },
    { part: PartId.Antenna, pos: [-W * 0.40, H, -L * 0.30], turret: true },
  ];
  if (o.gun === 'twinCannon' || o.gun === 'flak') {
    sockets.push({ part: PartId.MuzzleB, pos: [-W * 0.16, gunY, muzzleZ], turret: true });
  }

  return {
    key: o.key,
    name: o.name,
    faction: o.faction,
    cls: 'vehicle',
    hullLength: L,
    turretPivot: [0, turretY, turretZ],
    masses,
    sockets,
    hullNumber: o.hullNumber,
  };
}

/* ==========================================================================
 * 6. TURRETLESS SUPPORT VEHICLES — harvester and dozer
 *
 * These have no turret, so the dominant mass is the SUPERSTRUCTURE (the ore
 * hopper / the cab-and-crane block) and it still has to sit at 0.60-0.70 H.
 * ========================================================================== */

interface SupportOpts {
  key: string;
  name: string;
  faction: UnitMassList['faction'];
  hullNumber: number;
  hullLength: number;
  hullWidth: number;
  height: number;
  brutalist: boolean;
  role: 'harvester' | 'dozer';
}

function support(o: SupportOpts): UnitMassList {
  const H = o.height, L = o.hullLength, W = o.hullWidth;
  const trackH = H * 0.30;
  const chassisH = H * 0.16;
  const chassisY = trackH + chassisH * 0.5;
  const deckY = trackH + chassisH;
  const bodyH = H * 0.52;
  const bodyY = H * 0.645;
  const cut = W * (o.brutalist ? 0.09 : 0.06);

  const masses: MassDef[] = [
    runningGear(W, trackH, L * 0.90, 6, { skirt: trackH * 0.36, rollers: 3 }),
    primary('chassis', 'taperedBox', [W, chassisH, L], [0, chassisY, 0], 'paintLarge', {
      shape: { topScaleX: 0.94, topScaleZ: 0.90, shear: -L * 0.02, cornerCut: W * 0.05 },
    }),
    // The dominant mass: the ore hopper, or the dozer's engine-and-cab block.
    // Both have a real batter — the dozer narrows toward the roof, the hopper
    // FLARES toward it because a hopper is a funnel — so neither has a vertical
    // wall anywhere on it.
    primary(o.role === 'harvester' ? 'hopper' : 'cabBlock', 'taperedBox',
      [W * 0.96, bodyH, L * 0.66], [0, bodyY, -L * 0.10], 'paintLarge',
      o.role === 'harvester'
        ? { shape: { topScaleX: 1.10, topScaleZ: 1.06, bottomScaleX: 0.84, bottomScaleZ: 0.88, cornerCut: cut } }
        : { shape: { topScaleX: 0.84, topScaleZ: 0.88, shear: -L * 0.03, cornerCut: cut } }),
  ];

  if (o.role === 'harvester') {
    masses.push(
      // The scoop: the second read, and the thing that says "harvester". A
      // trapezoidal plan with a wide mouth and a narrow throat.
      primary('scoop', 'planPrism', [W * 1.02, H * 0.26, L * 0.24], [0, deckY + H * 0.02, L * 0.42], 'paintMed', {
        capSlot: 'stripe',
        shape: {
          plan: [
            [W * 0.42, -L * 0.12], [W * 0.51, L * 0.12], [-W * 0.51, L * 0.12], [-W * 0.42, -L * 0.12],
          ],
          topScaleX: 1.06, topScaleZ: 1.02, shear: L * 0.04,
        },
      }),
      greeble('scoopTeeth', 'greebleStrip', [0.22, 0.14, W * 0.98], [0, deckY - H * 0.06, L * 0.53], 'bareMetal', {
        rot: [0, HALF_PI, 0], group: 'scoop teeth', shape: { density: 3.2, seed: 0x7EE7, fit: 'none' },
      }),
      greeble('scoopArm', 'cylinder', [0.20, L * 0.24, 0.20], [W * 0.40, deckY + H * 0.10, L * 0.30], 'bareMetal', {
        mirrorX: true, rot: [HALF_PI, 0, 0], group: 'scoop gear', shape: { segments: 10 },
      }),
      armour('hopperLid', taperOutline(W * 0.70, L * 0.44, 0.86), 0.14,
        [0, bodyY + bodyH * 0.5, -L * 0.10], undefined, 'hatch', 'hopper gear'),
      armour('conveyor', rectOutline(W * 0.34, L * 0.30), 0.18,
        [0, bodyY + bodyH * 0.30, L * 0.22], [-0.32, 0, 0], 'grille', 'hopper gear'),
    );
  } else {
    masses.push(
      // The blade: a plate on a real rake, which is what a dozer blade is.
      plateMass('blade', MassRole.Primary, taperOutline(W * 1.16, H * 0.34, 0.88), L * 0.11,
        [0, trackH * 0.66, L * 0.52], [-1.32, 0, 0], 'paintMed', { capSlot: 'stripe' }),
      greeble('bladeArm', 'cylinder', [0.22, L * 0.30, 0.22], [W * 0.42, trackH * 0.80, L * 0.34], 'bareMetal', {
        mirrorX: true, rot: [HALF_PI - 0.12, 0, 0], group: 'blade gear', shape: { segments: 10 },
      }),
      greeble('craneMast', 'cylinder', [0.30, H * 0.16, 0.30], [-W * 0.26, H - H * 0.08, -L * 0.20], 'bareMetal', {
        group: 'crane', shape: { segments: 10 },
      }),
      greeble('craneJib', 'extrude', [0.22, 0.20, L * 0.42], [-W * 0.26, H - H * 0.11, L * 0.02], 'bareMetal', {
        rot: [0.16, 0, 0], group: 'crane',
        shape: {
          profile: ductSection(0.26),
          path: [[0, 0, -L * 0.21], [0, 0, 0], [0, 0, L * 0.21]],
          scale: [1.0, 0.92, 0.72], capStart: true, capEnd: true,
        },
      }),
      armour('cabRoof', taperOutline(W * 0.62, L * 0.34, 0.84), 0.14,
        [0, bodyY + bodyH * 0.5, -L * 0.10], undefined, 'hatch', 'cab gear'),
    );
  }

  masses.push(
    ...(o.brutalist
      ? [
        // Dominion support hulls carry their machinery outside the armour:
        // pressure cans and furnace stacks make a refinery vehicle look built
        // by the same industry as the casting-yard roofline.
        greeble('pressureCan', 'revolve', [W * 0.22, H * 0.30, W * 0.22],
          [W * 0.34, deckY + H * 0.14, -L * 0.30], 'bareMetal', {
            mirrorX: true, group: 'power pack', shape: { profile: DRUM_PROFILE, segments: 12 },
          }),
        greeble('furnaceStack', 'cone', [0.28, H * 0.34, 0.28],
          [W * 0.38, deckY + H * 0.18, -L * 0.22], 'bareMetal', {
            mirrorX: true, group: 'power pack', shape: { segments: 10, rTop: 0.68 },
          }),
      ]
      : [
        // Coalition machinery is faired into two long shoulder shells. Their
        // taper repeats the Guardian rather than bolting generic boxes on top.
        greeble('serviceFairing', 'taperedBox', [W * 0.16, H * 0.34, L * 0.58],
          [W * 0.48, deckY + H * 0.12, -L * 0.08], 'paintMed', {
            mirrorX: true, group: 'service fairings',
            shape: { topScaleX: 0.52, topScaleZ: 0.78, shear: -L * 0.04, cornerCut: 0.12 },
          }),
        greeble('sensorSpine', 'taperedBox', [W * 0.12, H * 0.16, L * 0.34],
          [0, bodyY + bodyH * 0.46, -L * 0.12], 'bareMetal', {
            group: 'sensor spine', shape: { topScaleX: 0.44, topScaleZ: 0.66, shear: -0.08 },
          }),
      ]),
    greebleRun('chassis.serviceRun', L * 0.40, 0.24, 0.18, [-W * 0.32, deckY + 0.04, -L * 0.16], 0x33 + o.hullNumber),
    armour('cabGlass', taperOutline(W * 0.52, bodyH * 0.34, 0.88), 0.10,
      [0, bodyY + bodyH * 0.16, -L * 0.10 + L * 0.33], [HALF_PI - 0.16, 0, 0], 'glass', 'glass'),
    // The armour belt down the body flank, splayed off the batter.
    armour('body.flankPlate', taperOutline(L * 0.46, bodyH * 0.72, 0.82), 0.08,
      [W * 0.48, bodyY, -L * 0.10], [0, HALF_PI, HALF_PI - 0.24], 'paintMed', 'body armour', { mirrorX: true }),
  );

  masses.push(
    slab('bodyFlank', [0.07, bodyH * 0.46, L * 0.46], [W * 0.47, bodyY, -L * 0.10], { mirrorX: true , k: TEAM_K.support }),
    slab('bodyCap', [W * 0.38, 0.07, L * 0.24], [W * 0.10, bodyY + bodyH * 0.5, -L * 0.10], { k: TEAM_K.support }),
    slab('chassisBand', [0.07, chassisH * 0.56, L * 0.56], [W * 0.49, chassisY, 0], { mirrorX: true , k: TEAM_K.support }),
    slab('rearPlate', [W * 0.56, bodyH * 0.34, 0.07], [0, bodyY, -L * 0.10 - L * 0.33], { k: TEAM_K.support }),
  );
  masses.push(insignia([W * 0.26, 0.06, W * 0.26], [W * 0.22, bodyY + bodyH * 0.5 + 0.02, -L * 0.24]));
  masses.push(
    // R-T5 wants 0.5-3% and a support hull is enormous, so these are sized
    // against the hull they sit on rather than against a tank's.
    glowPanel('beacon', [0.52, 0.14, 0.52], [-W * 0.30, bodyY + bodyH * 0.5 + 0.14, -L * 0.28]),
    glowPanel('sideLamp', [0.06, 0.62, L * 0.30], [W * 0.50, deckY + 0.30, L * 0.12], { mirrorX: true }),
    glowPanel('workLamp', [W * 0.44, 0.06, L * 0.14], [0, deckY + 0.06, L * 0.16]),
  );

  const sockets: SocketSpec[] = [
    { part: PartId.Scoop, pos: [0, deckY, L * 0.52] },
    { part: PartId.Hopper, pos: [0, bodyY + bodyH * 0.5, -L * 0.10] },
    { part: PartId.Exhaust, pos: [W * 0.34, deckY + 0.60, -L * 0.30] },
    { part: PartId.DockEntry, pos: [0, deckY, -L * 0.5] },
  ];

  return {
    key: o.key, name: o.name, faction: o.faction, cls: 'vehicle',
    hullLength: L, masses, sockets, hullNumber: o.hullNumber,
  };
}

/* ==========================================================================
 * 7. THE SICKLE — a three-legged Soviet walker
 * ========================================================================== */

function sickle(): UnitMassList {
  const H = UNIT_LADDER.walkerHeightMeters;   // 4.4 m
  const W = 3.0;
  const bodyH = H * 0.34;
  const bodyY = H * 0.655;
  const legTop = bodyY - bodyH * 0.5;

  const masses: MassDef[] = [
    // Three legs: two forward-splayed, one aft. A mirrored pair plus a single.
    primary('legUpper', 'taperedBox', [0.42, legTop * 0.62, 0.52], [W * 0.30, legTop * 0.70, 0.55], 'paintMed', {
      mirrorX: true, rot: [-0.34, 0, 0.20],
      shape: { topScaleX: 1.24, topScaleZ: 1.30, bottomScaleX: 0.66, bottomScaleZ: 0.72 },
    }),
    primary('legLower', 'taperedBox', [0.34, legTop * 0.58, 0.42], [W * 0.42, legTop * 0.26, 1.12], 'paintSmall', {
      mirrorX: true, rot: [0.46, 0, 0.10],
      shape: { topScaleX: 1.32, topScaleZ: 1.24, bottomScaleX: 0.58, bottomScaleZ: 0.64 },
    }),
    // The body: bulbous, chamfered, oversized. The dominant mass. A convex hull
    // rather than an octagonal prism — the Sickle is an insect, not a bunker.
    primary('body', 'hull', [W * 0.92, bodyH, W * 0.86], [0, bodyY, 0], 'paintLarge', {
      shape: {
        points: [
          [0, 0.24, 0.50], [0.36, 0.30, 0.30], [-0.36, 0.30, 0.30],
          [0.50, 0.02, 0.04], [-0.50, 0.02, 0.04],
          [0.40, 0.40, -0.20], [-0.40, 0.40, -0.20],
          [0.36, -0.42, 0.18], [-0.36, -0.42, 0.18],
          [0.30, -0.40, -0.34], [-0.30, -0.40, -0.34],
          [0.26, 0.18, -0.50], [-0.26, 0.18, -0.50],
        ],
        chamfer: 0.07,
      },
    }),
    primary('cockpit', 'revolve', [W * 0.44, H * 0.16, W * 0.46], [0, bodyY + bodyH * 0.42, W * 0.20], 'paintMed', {
      shape: { profile: DOME_PROFILE, segments: 14 },
    }),
  ];

  masses.push(
    greeble('legRear', 'taperedBox', [0.42, legTop * 0.86, 0.52], [0, legTop * 0.46, -0.90], 'paintMed', {
      rot: [0.30, 0, 0], group: 'rear leg',
      shape: { topScaleX: 1.26, topScaleZ: 1.30, bottomScaleX: 0.64, bottomScaleZ: 0.70 },
    }),
    greeble('footPad', 'revolve', [0.62, 0.20, 0.62], [W * 0.48, 0.10, 1.55], 'bareMetal', {
      mirrorX: true, group: 'feet', shape: { profile: DRUM_PROFILE, segments: 10 },
    }),
    greeble('footRear', 'revolve', [0.62, 0.20, 0.62], [0, 0.10, -1.40], 'bareMetal', {
      group: 'feet', shape: { profile: DRUM_PROFILE, segments: 10 },
    }),
    greeble('hipRing', 'revolve', [W * 0.60, 0.26, W * 0.60], [0, legTop + 0.06, 0], 'bareMetal', {
      group: 'hip', shape: { profile: DRUM_PROFILE, segments: 12 },
    }),
    greeble('gunPod', 'extrude', [0.34, 0.34, 1.30], [W * 0.36, bodyY - 0.06, 0.62], 'bareMetal', {
      mirrorX: true, group: 'gun pods',
      shape: {
        profile: ductSection(0.46),
        path: [[0, 0, -0.65], [0, 0, 0.20], [0, 0, 0.65]],
        scale: [1.0, 0.92, 0.76], capStart: true, capEnd: true,
      },
    }),
    greeble('ammoDrum', 'revolve', [0.52, 0.44, 0.52], [W * 0.36, bodyY + 0.24, -0.10], 'paintSmall', {
      mirrorX: true, rot: [HALF_PI, 0, 0], group: 'ammo', shape: { profile: DRUM_PROFILE, segments: 12 },
    }),
    greeble('exhaustStack', 'cylinder', [0.24, 0.66, 0.24], [-W * 0.22, bodyY + bodyH * 0.5 + 0.30, -W * 0.24], 'bareMetal', {
      group: 'exhaust', shape: { segments: 10, rTop: 0.82 },
    }),
    greebleRun('backRun', W * 0.60, 0.20, 0.16, [0, bodyY - bodyH * 0.10, -W * 0.44], 0x8188, {
      rot: [0, HALF_PI, 0],
    }),
  );

  masses.push(
    slab('bodyBand', [0.08, bodyH * 0.62, W * 0.76], [W * 0.44, bodyY, 0], { mirrorX: true , k: TEAM_K.walker }),
    slab('shoulderCap', [W * 0.46, 0.08, W * 0.42], [0, bodyY + bodyH * 0.5, -W * 0.06], { k: TEAM_K.walker }),
    slab('cockpitBrow', [W * 0.42, 0.20, 0.08], [0, bodyY + bodyH * 0.42, W * 0.42], { k: TEAM_K.walker }),
    slab('hipBand', [0.50, 0.26, 0.62], [W * 0.30, legTop * 0.92, 0.48], { mirrorX: true , k: TEAM_K.walker }),
  );
  masses.push(insignia([0.42, 0.06, 0.42], [W * 0.16, bodyY + bodyH * 0.5 + 0.02, -W * 0.18]));
  masses.push(
    glowPanel('eye', [W * 0.34, 0.18, 0.06], [0, bodyY + bodyH * 0.30, W * 0.42]),
    glowPanel('ventGlow', [0.06, 0.30, W * 0.34], [W * 0.47, bodyY - bodyH * 0.26, -W * 0.10], { mirrorX: true }),
  );

  return {
    key: 'soviet_sickle',
    name: 'Sickle',
    faction: 'soviets',
    cls: 'walker',
    hullLength: 3.6,
    masses,
    sockets: [
      { part: PartId.MuzzleA, pos: [W * 0.36, bodyY - 0.06, 1.30] },
      { part: PartId.MuzzleB, pos: [-W * 0.36, bodyY - 0.06, 1.30] },
      { part: PartId.Exhaust, pos: [-W * 0.22, bodyY + bodyH * 0.5 + 0.60, -W * 0.24] },
    ],
    hullNumber: 8188,
  };
}

/* ==========================================================================
 * 8. NAVAL
 *
 * The validator exempts `naval` from the top-heavy band precisely because a
 * ship's dominant mass IS its hull, at the waterline.
 *
 * The hull is a `planPrism` on a real waterplane: a raked stem, a parallel
 * midbody, a transom stern — plus TUMBLEHOME, the inward slope of the topsides.
 * That last field is what takes a warship hull from 71% flat wall to zero.
 * ========================================================================== */

/** A ship's waterplane, in metres, in the same winding as `rectOutline`. */
function hullPlan(W: number, L: number, bowFine: number, transom: number): V2[] {
  return [
    [W * 0.50, -L * 0.30],
    [W * 0.48, L * 0.06],
    [W * bowFine, L * 0.34],
    [0, L * 0.50],
    [-W * bowFine, L * 0.34],
    [-W * 0.48, L * 0.06],
    [-W * 0.50, -L * 0.30],
    [-W * transom, -L * 0.50],
    [W * transom, -L * 0.50],
  ];
}

interface ShipOpts {
  key: string; name: string; faction: UnitMassList['faction']; hullNumber: number;
  length: number; beam: number; height: number; brutalist: boolean;
  /**
   * What the bow carries, which is the only thing that separates the four
   * hulls this factory builds.
   *
   * `'ramp'` IS NOT AN ARMAMENT AND THAT IS THE POINT. A landing ship's bow is
   * a door, so the branch that would have put a gun there puts a hazard-striped
   * leaf on hinges instead, moves the deckhouse right aft to open the well the
   * cargo stands in, and deletes the stern gun and the ram stem the other three
   * share. Reusing `'escort'` and calling it a lighter would have shipped a
   * gunboat silhouette on a rung whose whole job is to look unarmed — the same
   * defect as the Attack Dog drawing a Conscript, one file over.
   */
  armament: 'turret' | 'battery' | 'escort' | 'ramp';
}

function ship(o: ShipOpts): UnitMassList {
  const L = o.length, W = o.beam, H = o.height;
  const hullH = H * 0.34;
  const hullY = hullH * 0.5;
  const superH = H * 0.42;
  const superY = H * 0.655;
  const deckTop = hullH + H * 0.10;
  const fine = o.brutalist ? 0.34 : 0.28;
  const transom = o.brutalist ? 0.44 : 0.36;
  const lander = o.armament === 'ramp';
  // The deckhouse position is the whole difference between a warship's profile
  // and a landing ship's, so it is ONE number that everything hanging off the
  // superstructure — the bridge glass, both team bands, the bridge glow —
  // derives from rather than nine repetitions of `-L * 0.10`.
  const superZ = lander ? -L * 0.34 : -L * 0.10;
  const superL = lander ? L * 0.22 : L * 0.34;
  const mastZ = lander ? superZ : -L * 0.16;

  const masses: MassDef[] = [
    primary('hull', 'planPrism', [W, hullH, L], [0, hullY, 0], 'paintLarge', {
      capSlot: 'paintLarge',
      shape: {
        plan: hullPlan(W, L, fine, transom),
        // Tumblehome: the topsides slope INWARD, and the forefoot draws in below
        // the waterline. Every wall on the hull is now a canted plane.
        topScaleX: 0.86, topScaleZ: 1.0,
        bottomScaleX: 0.72, bottomScaleZ: 0.94,
      },
    }),
    // The weather deck: a plate on the hull's own plan, cambered 3 degrees.
    plateMass('deck', MassRole.Primary, hullPlan(W * 0.92, L * 0.90, fine, transom), H * 0.10,
      [0, hullH + H * 0.05, -L * 0.02], undefined, 'paintMed', { capSlot: 'paintLarge' }),
    primary('superstructure', 'taperedBox', [W * 0.72, superH, superL], [0, superY, superZ], 'paintLarge', {
      shape: o.brutalist
        ? { topScaleX: 0.78, topScaleZ: 0.84, shear: -L * 0.015, cornerCut: W * 0.09 }
        : { topScaleX: 0.70, topScaleZ: 0.78, shear: -L * 0.025, cornerCut: W * 0.06 },
    }),
    // Sized so the funnel crown IS the top of the silhouette.
    primary('funnelMast', 'revolve', [W * 0.26, H * 0.20, W * 0.26], [0, H - H * 0.10, mastZ], 'bareMetal', {
      shape: { profile: TAPER_DRUM, segments: 12 },
    }),
  ];

  if (lander) {
    masses.push(
      // THE RAMP IS A PRIMARY, not a greeble, because it is the shape a player
      // has to recognise from across the map to know this hull carries their
      // tanks. Raked up at the stem the way a bow door rides under way, cut
      // narrower at the lip so it reads as a door and not as a lid, and slotted
      // `stripe` — hazard chevrons are what a vehicle deck is painted with, and
      // it is the same slot `hoverTransport` puts on the same shape.
      plateMass('bowRamp', MassRole.Primary, taperOutline(W * 0.78, L * 0.30, 0.82), 0.18,
        [0, deckTop + H * 0.08, L * 0.36], [-0.46, 0, 0], 'stripe', { capSlot: 'stripe' }),
      greeble('rampHinge', 'cylinder', [0.26, W * 0.46, 0.26], [0, deckTop + H * 0.02, L * 0.22], 'bareMetal', {
        rot: [0, 0, HALF_PI], group: 'ramp gear', shape: { segments: 10 },
      }),
      // The well: a coaming down each side of the open vehicle deck, and the
      // winch that hauls the ramp shut at the head of it. Without the coaming
      // the deck is a flat plate and the hull reads as a barge with a lid.
      armour('wellCoaming', taperOutline(L * 0.50, H * 0.20, 0.90), 0.12,
        [W * 0.46, deckTop + H * 0.10, L * 0.04], [0, HALF_PI, HALF_PI - 0.14], 'paintMed', 'well', { mirrorX: true }),
      greeble('rampWinch', 'revolve', [0.52, W * 0.42, 0.52], [0, deckTop + H * 0.16, -L * 0.14], 'bareMetal', {
        rot: [0, 0, HALF_PI], group: 'well', shape: { profile: DRUM_PROFILE, segments: 10 },
      }),
      // Bollards, and they are here for a measured reason as much as a real
      // one. Deleting the stern gun and the ram stem took the only two bare
      // metal objects off the bow and the quarterdeck with them, and the hull
      // measured 4.6% metal against bible 5.4's 5-34% floor. A lighter's deck
      // furniture IS its metalwork; this is where a warship's guns went.
      greeble('bollard', 'cylinder', [0.28, 0.54, 0.28], [W * 0.42, deckTop + 0.27, L * 0.14], 'bareMetal', {
        mirrorX: true, group: 'deck fittings', shape: { segments: 8 },
      }),
    );
  } else if (o.armament === 'turret') {
    masses.push(
      greeble('foreTurret', 'revolve', [W * 0.50, H * 0.20, W * 0.54], [0, hullH + H * 0.19, L * 0.28], 'paintMed', {
        group: 'fore mount', shape: { profile: ALLIED_TURRET, segments: 12 },
      }),
      barrelMass('foreBarrel', 0.26, L * 0.20, [0, hullH + H * 0.21, L * 0.36], {
        role: MassRole.Greeble, group: 'fore mount',
      }),
      greeble('foreMuzzle', 'cone', [0.36, L * 0.06, 0.36], [0, hullH + H * 0.21, L * 0.43], 'bareMetal', {
        rot: [HALF_PI, 0, 0], group: 'fore mount', shape: { segments: 10, rTop: 0.72 },
      }),
    );
  } else if (o.armament === 'escort') {
    masses.push(
      greeble('foreTurret', 'revolve', [W * 0.44, H * 0.18, W * 0.48], [0, hullH + H * 0.18, L * 0.28], 'paintMed', {
        group: 'fore mount', shape: { profile: ALLIED_TURRET, segments: 12 },
      }),
      barrelMass('foreBarrel', 0.22, L * 0.22, [0, hullH + H * 0.20, L * 0.35], {
        role: MassRole.Greeble, group: 'fore mount',
      }),
      greeble('foreMuzzle', 'cone', [0.32, L * 0.06, 0.32], [0, hullH + H * 0.20, L * 0.43], 'bareMetal', {
        rot: [HALF_PI, 0, 0], group: 'fore mount', shape: { segments: 10, rTop: 0.72 },
      }),
      greeble('ciws', 'revolve', [W * 0.28, H * 0.15, W * 0.28], [0, deckTop + H * 0.08, -L * 0.34], 'bareMetal', {
        group: 'aft mount', shape: { profile: DOME_PROFILE, segments: 12 },
      }),
    );
  } else {
    masses.push(
      greeble('missileCell', 'planPrism', [W * 0.56, H * 0.16, L * 0.20], [0, hullH + H * 0.16, L * 0.26], 'grille', {
        group: 'vls', capSlot: 'grille',
        shape: {
          plan: [
            [W * 0.28, -L * 0.10], [W * 0.24, L * 0.10], [-W * 0.24, L * 0.10], [-W * 0.28, -L * 0.10],
          ],
          topScaleX: 0.92, topScaleZ: 0.96,
        },
      }),
      armour('cellLid', taperOutline(W * 0.58, L * 0.21, 0.88), 0.10,
        [0, hullH + H * 0.24, L * 0.26], undefined, 'stripe', 'vls'),
    );
  }

  masses.push(
    armour('bridgeGlass', taperOutline(W * 0.56, superH * 0.30, 0.88), 0.12,
      [0, superY + superH * 0.16, superZ + superL * 0.5], [HALF_PI - 0.20, 0, 0], 'glass', 'bridge'),
    greeble('radarDish', 'revolve', [W * 0.26, 0.16, W * 0.26], [0, H * 0.80, mastZ], 'bareMetal', {
      rot: [-0.5, 0, 0], group: 'radar', shape: { profile: DRUM_PROFILE, segments: 12 },
    }),
    greeble('lifeboat', 'revolve', [0.42, 1.40, 0.42], [W * 0.40, hullH + H * 0.14, -L * 0.24], 'paintSmall', {
      mirrorX: true, rot: [HALF_PI, 0, 0], group: 'boats', shape: { profile: CAPSULE_PROFILE, segments: 10 },
    }),
    greebleRun('deckRun', L * 0.70, 0.26, 0.20, [W * 0.34, deckTop + 0.06, -L * 0.02], 0x9A + o.hullNumber, { mirrorX: true }),
    // The armour belt: one long plate down each topside, raked with the
    // tumblehome so it reads as plating rather than as a painted stripe.
    armour('hull.belt', taperOutline(L * 0.70, hullH * 0.52, 0.78), 0.08,
      [W * 0.44, hullH * 0.62, -L * 0.02], [0, HALF_PI, HALF_PI - 0.26], 'paintMed', 'hull armour', { mirrorX: true }),
  );

  if (o.brutalist) {
    masses.push(
      // Soviet ships expose power generation and handling hardware. These sit
      // off-centre so even the plan silhouette feels industrial rather than a
      // mirrored aerospace hull with different paint.
      greeble('deckReactor', 'revolve', [W * 0.30, H * 0.26, W * 0.30],
        [-W * 0.24, deckTop + H * 0.14, -L * 0.22], 'bareMetal', {
          group: 'deck plant', shape: { profile: DRUM_PROFILE, segments: 12 },
        }),
      greeble('derrick', 'taperedBox', [0.22, H * 0.44, 0.22],
        [W * 0.28, deckTop + H * 0.22, -L * 0.18], 'bareMetal', {
          rot: [0, 0, -0.16], group: 'derrick',
          shape: { topScaleX: 0.52, topScaleZ: 0.52, shear: 0.10 },
        }),
      greeble('derrickJib', 'extrude', [0.18, 0.18, L * 0.26],
        [W * 0.28, deckTop + H * 0.42, -L * 0.08], 'bareMetal', {
          rot: [0.12, 0, 0], group: 'derrick',
          shape: {
            profile: ductSection(0.20),
            path: [[0, 0, -L * 0.13], [0, 0, 0], [0, 0, L * 0.13]],
            scale: [1.0, 0.86, 0.58], capStart: true, capEnd: true,
          },
        }),
    );
  } else {
    masses.push(
      // Allied bridges grow swept shoulder wings and a single integrated
      // sensor bar; the hardware is absorbed into the shell.
      armour('bridgeWing', taperOutline(W * 0.40, superL * 0.54, 0.40), 0.08,
        [W * 0.30, superY + superH * 0.18, superZ], [0, -0.18, 0.08],
        'paintMed', 'bridge wings', { mirrorX: true }),
      greeble('sensorBar', 'taperedBox', [W * 0.72, 0.18, 0.20],
        [0, H * 0.82, mastZ], 'bareMetal', {
          group: 'sensors', shape: { topScaleX: 0.82, topScaleZ: 0.52, cornerCut: 0.08 },
        }),
    );
  }

  // A lighter has neither of these and cannot: the stern gun belongs to a hull
  // that fights, and a ram stem is the one thing that physically cannot share a
  // bow with a door. Leaving them on was the fastest way to build the escort
  // silhouette this variant exists to avoid.
  if (!lander) {
    masses.push(
      greeble('aftGun', 'cylinder', [W * 0.30, H * 0.12, L * 0.10], [0, hullH + H * 0.16, -L * 0.38], 'bareMetal', {
        group: 'aft gun', shape: { segments: 10, rTop: 0.74 },
      }),
      // The stem: a cone, not a wedge box.
      greeble('bowRam', 'cone', [W * 0.30, L * 0.10, hullH * 0.60], [0, hullY, L * 0.50], 'bareMetal', {
        rot: [-HALF_PI, 0, 0], group: 'stem', shape: { segments: 10, rTop: 0.22 },
      }),
    );
  }

  // R-T1 is measured off the built mesh, so the same four panels measure a
  // different fraction of a different ship. A lighter is a third of a
  // deckhouse shorter and carries a wide open well where a warship carries a
  // gun, a stem and a stack — more plain surface, fewer objects — and the
  // shipped panels landed at 8.1%, a tenth of a point off R-T1's floor. Area
  // goes as k squared, so 1.18 buys 39%.
  const teamK = lander ? TEAM_K.ship * 1.18 : TEAM_K.ship;
  masses.push(
    slab('hullStripe', [0.08, hullH * 0.28, L * 0.70], [W * 0.45, hullH * 0.74, -L * 0.02], { mirrorX: true , k: teamK }),
    slab('superBand', [0.08, superH * 0.44, superL * 0.76], [W * 0.33, superY, superZ], { mirrorX: true , k: teamK }),
    slab('superCap', [W * 0.34, 0.08, superL * 0.53], [0, superY + superH * 0.5, superZ], { k: teamK }),
    slab('deckPatch', [W * 0.52, 0.08, L * 0.16], [0, deckTop, L * 0.10], { k: teamK }),
  );
  // Aft on a warship, where the deck is clear. On a lighter that patch of deck
  // is under the deckhouse, so it moves forward into the well instead.
  masses.push(insignia([W * 0.36, 0.06, W * 0.36], [0, deckTop, lander ? -L * 0.18 : -L * 0.30]));
  masses.push(
    glowPanel('navLight', [0.34, 0.30, 0.06], [W * 0.38, hullH + H * 0.20, L * 0.34], { mirrorX: true }),
    glowPanel('bridgeGlow', [W * 0.62, 0.26, 0.06], [0, superY + superH * 0.30, superZ + superL * 0.5]),
    glowPanel('deckRunway', [W * 0.30, 0.05, L * 0.36], [0, deckTop + 0.01, -L * 0.02]),
  );

  return {
    key: o.key, name: o.name, faction: o.faction, cls: 'naval',
    hullLength: L, masses, hullNumber: o.hullNumber,
    sockets: lander
      // A lighter has no muzzle to hang a flash on and a door where the bow
      // socket would be, so it publishes the two the transport publishes: the
      // point cargo walks through, and the stack.
      ? [
        { part: PartId.DockEntry, pos: [0, deckTop, L * 0.46] },
        { part: PartId.Door, pos: [0, deckTop, L * 0.40] },
        { part: PartId.Exhaust, pos: [0, superY + superH * 0.5 + H * 0.30, mastZ] },
      ]
      : [
        { part: PartId.MuzzleA, pos: [0, hullH + H * 0.21, L * 0.46] },
        { part: PartId.Exhaust, pos: [0, superY + superH * 0.5 + H * 0.30, mastZ] },
        { part: PartId.Dish, pos: [0, superY + superH * 0.5 + H * 0.30, mastZ] },
      ],
  };
}

/* ==========================================================================
 * 9. THE ATTACK SUBMARINE
 *
 * Audit item #1 by player visibility: it drew `soviet_dreadnought`, so every
 * Soviet naval game put three 16.8 m surface battleships on the map and called
 * them submarines.
 *
 * A submarine is the one hull in the game that is genuinely a body of
 * revolution, and it revolves about Z rather than about Y — so it is an
 * `extrude`: a 12-sided ring swept along the centreline and scaled per path
 * point into a teardrop with a blunt bow and a fine stern.
 * ========================================================================== */

function submarine(): UnitMassList {
  const L = 12.4, W = 2.9;
  const hullR = W * 0.5;
  const hullY = hullR * 0.90;                 // awash: the boat sits low
  const sailH = 1.05;
  const sailY = hullY + hullR * 0.54 + sailH * 0.5;

  const masses: MassDef[] = [
    // The pressure hull is authored as TWO swept sections rather than one.
    // Partly because a submarine really is a forward torpedo room and an after
    // machinery space, and partly because one 12.4 m mass would be 75% of the
    // silhouette on its own — twice R8's ceiling for a dominant feature.
    primary('foreHull', 'extrude', [W, W, L * 0.54], [0, hullY, L * 0.23], 'paintLarge', {
      shape: {
        profile: ring(hullR, 12),
        path: [
          [0, 0, -L * 0.27], [0, 0, -L * 0.10], [0, 0, L * 0.08],
          [0, 0, L * 0.20], [0, 0, L * 0.27],
        ],
        scale: [1.0, 1.0, 0.94, 0.66, 0.26],
        capStart: true, capEnd: true,
      },
    }),
    primary('aftHull', 'extrude', [W * 0.98, W * 0.98, L * 0.50], [0, hullY, -L * 0.25], 'paintLarge', {
      shape: {
        profile: ring(hullR, 12),
        path: [
          [0, 0, -L * 0.25], [0, 0, -L * 0.14], [0, 0, L * 0.02], [0, 0, L * 0.25],
        ],
        scale: [0.16, 0.62, 0.94, 1.0],
        capStart: true, capEnd: true,
      },
    }),
    // The sail. Sheared hard aft and tapered in both axes: a fin, not a box.
    primary('sail', 'taperedBox', [W * 0.44, sailH, L * 0.22], [0, sailY, L * 0.06], 'paintMed', {
      shape: { topScaleX: 0.56, topScaleZ: 0.72, shear: -L * 0.035, cornerCut: W * 0.06 },
    }),
    // The casing: the walkable deck plate that runs the length of the boat.
    plateMass('casing', MassRole.Primary, taperOutline(W * 0.64, L * 0.78, 0.34, 0.52), 0.16,
      [0, hullY + hullR * 0.82, -L * 0.02], undefined, 'paintMed', { capSlot: 'grille' }),
    // Cruciform stern planes, as one plate pair.
    plateMass('sternPlane', MassRole.Primary, taperOutline(W * 1.34, L * 0.14, 0.52), 0.14,
      [0, hullY, -L * 0.42], undefined, 'bareMetal'),
  ];

  masses.push(
    armour('sailPlane', taperOutline(W * 0.98, L * 0.09, 0.62), 0.12,
      [0, sailY + sailH * 0.06, L * 0.06], undefined, 'bareMetal', 'planes'),
    armour('rudder', taperOutline(W * 0.86, L * 0.13, 0.54), 0.14,
      [0, hullY + hullR * 0.34, -L * 0.44], [0, 0, HALF_PI], 'bareMetal', 'planes'),
    greeble('periscope', 'cylinder', [0.13, sailH * 0.62, 0.13], [-W * 0.09, sailY + sailH * 0.62, -L * 0.01], 'bareMetal', {
      group: 'masts', shape: { segments: 8 },
    }),
    greeble('snorkel', 'cylinder', [0.16, sailH * 0.44, 0.16], [W * 0.10, sailY + sailH * 0.52, -L * 0.03], 'bareMetal', {
      group: 'masts', shape: { segments: 8, rTop: 0.72 },
    }),
    greeble('sonarDome', 'revolve', [W * 0.52, W * 0.42, W * 0.52], [0, hullY, L * 0.44], 'paintSmall', {
      rot: [-HALF_PI, 0, 0], group: 'sonar', shape: { profile: DOME_PROFILE, segments: 12 },
    }),
    greeble('propShroud', 'cylinder', [W * 0.46, W * 0.32, W * 0.46], [0, hullY, -L * 0.49], 'bareMetal', {
      rot: [HALF_PI, 0, 0], group: 'screw', shape: { segments: 12, rTop: 0.86 },
    }),
    greebleRun('torpedoHatches', L * 0.30, 0.26, 0.16, [W * 0.26, hullY + hullR * 0.44, L * 0.18], 0x51B0, { mirrorX: true }),
    greebleRun('cleatRun', L * 0.40, 0.20, 0.14, [0, hullY + hullR * 0.90, -L * 0.24], 0x51B7),
  );

  masses.push(
    slab('sailBand', [0.06, sailH * 0.44, L * 0.14], [W * 0.19, sailY, L * 0.06], { mirrorX: true , k: TEAM_K.submarine }),
    slab('sailCap', [W * 0.22, 0.06, L * 0.12], [0, sailY + sailH * 0.5, L * 0.05], { k: TEAM_K.submarine }),
    slab('casingStripe', [W * 0.24, 0.06, L * 0.44], [0, hullY + hullR * 0.90, -L * 0.06], { k: TEAM_K.submarine }),
    slab('bowBand', [0.06, W * 0.44, L * 0.10], [W * 0.32, hullY + hullR * 0.30, L * 0.30], { mirrorX: true , k: TEAM_K.submarine }),
  );
  masses.push(insignia([W * 0.34, 0.05, W * 0.34], [0, sailY + sailH * 0.5 + 0.02, L * 0.02]));
  masses.push(
    glowPanel('sailLamp', [W * 0.38, 0.30, 0.05], [0, sailY + sailH * 0.18, L * 0.06 + L * 0.09]),
    glowPanel('sternGlow', [W * 0.46, 0.05, W * 0.34], [0, hullY + hullR * 0.66, -L * 0.40]),
    // A running-light strake down the casing. Under way on the surface a boat is
    // lit along its deck line, and it is what stops a low black hull vanishing.
    glowPanel('runningStrake', [0.05, 0.16, L * 0.40], [W * 0.26, hullY + hullR * 0.62, -L * 0.04], { mirrorX: true }),
  );

  return {
    key: 'soviet_sub',
    name: 'Attack Submarine',
    faction: 'soviets',
    cls: 'naval',
    hullLength: L,
    masses,
    hullNumber: 8188,
    sockets: [
      { part: PartId.MuzzleA, pos: [W * 0.22, hullY, L * 0.50] },
      { part: PartId.MuzzleB, pos: [-W * 0.22, hullY, L * 0.50] },
      { part: PartId.Dish, pos: [-W * 0.09, sailY + sailH * 0.95, -L * 0.01] },
      { part: PartId.Exhaust, pos: [0, hullY, -L * 0.52] },
    ],
  };
}

/* ==========================================================================
 * 10. THE HOVER TRANSPORT
 *
 * Audit item #5: it drew a harvester, scoop and all. A hovercraft is a flat load
 * deck on a fat inflated skirt with ducted fans aft, and the SKIRT is the read —
 * a rounded-rectangle prism that bulges past the deck on every side.
 * ========================================================================== */

/** A rounded-rectangle plan: the skirt's inflated footprint. */
function roundedPlan(W: number, L: number, c: number): V2[] {
  const out: V2[] = [];
  const rx = W * 0.5, rz = L * 0.5;
  const ix = rx * (1 - c), iz = rz * (1 - c);
  const corner = (cx: number, cz: number, a0: number): void => {
    for (let i = 0; i <= 3; i++) {
      const a = a0 + (i / 3) * HALF_PI;
      out.push([cx + Math.cos(a) * rx * c, cz + Math.sin(a) * rz * c]);
    }
  };
  corner(ix, -iz, -HALF_PI);
  corner(ix, iz, 0);
  corner(-ix, iz, HALF_PI);
  corner(-ix, -iz, Math.PI);
  return out;
}

function hoverTransport(faction: 'allies' | 'soviets', hullNumber: number): UnitMassList {
  const L = 9.6, W = 5.0, H = 3.4;
  const skirtH = H * 0.30;
  const skirtY = skirtH * 0.5;
  const deckY = skirtH + H * 0.04;
  const bodyH = H * 0.34;
  const bodyY = H * 0.655;
  const soviet = faction === 'soviets';

  const masses: MassDef[] = [
    // The skirt. Bulging: widest at mid-height, drawn in at top and bottom.
    // Painted rubber over a tread strake, not bare tread: an all-`tread` skirt
    // of this size measured the whole unit at 49.5% bare metal against bible
    // 5.4's 5-34%, because the skirt IS most of the hull.
    primary('skirt', 'planPrism', [W, skirtH, L], [0, skirtY, 0], 'paintMed', {
      capSlot: 'paintSmall',
      shape: {
        plan: roundedPlan(W, L, 0.34),
        topScaleX: 0.86, topScaleZ: 0.92, bottomScaleX: 0.80, bottomScaleZ: 0.88,
      },
    }),
    // The load deck: a plate, with the bow drawn in over the skirt.
    plateMass('deck', MassRole.Primary, taperOutline(W * 0.90, L * 0.86, 0.86), 0.24,
      [0, deckY, 0], undefined, 'paintLarge', { capSlot: 'paintMed' }),
    // The forward cabin: the dominant mass, up at 0.655 H where it belongs.
    primary('cabin', 'taperedBox', [W * 0.62, bodyH, L * 0.34], [0, bodyY, L * 0.16], 'paintLarge', {
      shape: soviet
        ? { topScaleX: 0.88, topScaleZ: 0.82, shear: -L * 0.01, cornerCut: W * 0.10 }
        : { topScaleX: 0.64, topScaleZ: 0.72, shear: -L * 0.06, cornerCut: W * 0.08 },
    }),
    // Exposed industrial ducts for the Soviets; swept shrouds for the Allies.
    soviet
      ? primary('fanDuct', 'cylinder', [W * 0.34, bodyH * 0.94, W * 0.34], [W * 0.26, bodyY - bodyH * 0.04, -L * 0.30], 'bareMetal', {
        mirrorX: true, shape: { segments: 12, rTop: 0.88 },
      })
      : primary('fanDuct', 'taperedBox', [W * 0.31, bodyH * 0.88, W * 0.38], [W * 0.27, bodyY - bodyH * 0.04, -L * 0.30], 'paintMed', {
        mirrorX: true, capSlot: 'grille',
        shape: { topScaleX: 0.62, topScaleZ: 0.76, shear: -0.12, cornerCut: W * 0.08 },
      }),
  ];

  masses.push(
    armour('fanBlade', taperOutline(W * 0.28, W * 0.07, 0.42), 0.10,
      [W * 0.26, bodyY + bodyH * 0.40, -L * 0.30], [0, 0.60, 0.16], 'bareMetal', 'fans', { mirrorX: true }),
    armour('bowRamp', taperOutline(W * 0.56, L * 0.20, 0.84), 0.16,
      [0, deckY + 0.10, L * 0.46], [-0.34, 0, 0], 'stripe', 'ramp'),
    armour('cabinGlass', taperOutline(W * 0.50, bodyH * 0.40, 0.86), 0.12,
      [0, bodyY + bodyH * 0.14, L * 0.16 + L * 0.15], [HALF_PI - 0.24, 0, 0], 'glass', 'glass'),
    greeble('bollard', 'cylinder', [0.20, 0.34, 0.20], [W * 0.38, deckY + 0.18, L * 0.24], 'bareMetal', {
      mirrorX: true, group: 'deck fittings', shape: { segments: 8 },
    }),
    armour('rudderFin', taperOutline(bodyH * 0.86, L * 0.16, 0.58), 0.14,
      [W * 0.44, bodyY, -L * 0.44], [0, 0, HALF_PI], 'paintMed', 'fins', { mirrorX: true }),
    // The tread band the skirt used to be made of, kept as one readable strake.
    armour('skirtStrake', taperOutline(L * 0.72, skirtH * 0.34, 0.86), 0.10,
      [W * 0.47, skirtY + skirtH * 0.06, 0], [0, HALF_PI, HALF_PI - 0.10], 'tread', 'strakes', { mirrorX: true }),
    greeble('liftIntake', 'revolve', [W * 0.22, 0.30, W * 0.22], [0, deckY + 0.20, -L * 0.06], 'grille', {
      group: 'intakes', shape: { profile: DRUM_PROFILE, segments: 12 },
    }),
    greebleRun('deckRun', L * 0.50, 0.26, 0.20, [W * 0.34, deckY + 0.16, -L * 0.10], 0x40 + hullNumber, { mirrorX: true }),
    greeble('mast', 'cylinder', [0.10, H * 0.20, 0.10], [-W * 0.22, H - H * 0.10, L * 0.06], 'bareMetal', {
      group: 'mast', shape: { segments: 8 },
    }),
  );

  if (soviet) {
    masses.push(
      greeble('exhaustCan', 'revolve', [0.52, H * 0.30, 0.52],
        [-W * 0.34, bodyY + H * 0.02, -L * 0.12], 'bareMetal', {
          group: 'power pack', shape: { profile: DRUM_PROFILE, segments: 12 },
        }),
      greeble('exhaustStack', 'cone', [0.24, H * 0.30, 0.24],
        [-W * 0.34, bodyY + H * 0.22, -L * 0.12], 'bareMetal', {
          group: 'power pack', shape: { segments: 10, rTop: 0.68 },
        }),
    );
  } else {
    masses.push(
      armour('cabinWing', taperOutline(W * 0.48, L * 0.16, 0.46), 0.08,
        [W * 0.30, bodyY + bodyH * 0.34, L * 0.10], [0, -0.14, 0.08],
        'paintMed', 'cabin wings', { mirrorX: true }),
      glowPanel('fanHalo', [W * 0.22, 0.06, W * 0.22],
        [W * 0.27, bodyY + bodyH * 0.40, -L * 0.30], { mirrorX: true }),
    );
  }

  masses.push(
    slab('skirtBand', [0.08, skirtH * 0.40, L * 0.56], [W * 0.46, skirtY + skirtH * 0.12, 0], { mirrorX: true , k: TEAM_K.transport }),
    slab('deckChevron', [W * 0.44, 0.07, L * 0.16], [0, deckY + 0.13, -L * 0.02], { k: TEAM_K.transport }),
    slab('cabinBand', [0.07, bodyH * 0.42, L * 0.26], [W * 0.30, bodyY, L * 0.16], { mirrorX: true , k: TEAM_K.transport }),
    slab('cabinCap', [W * 0.34, 0.07, L * 0.18], [0, bodyY + bodyH * 0.5, L * 0.16], { k: TEAM_K.transport }),
  );
  masses.push(insignia([W * 0.26, 0.05, W * 0.26], [0, deckY + 0.14, -L * 0.26]));
  masses.push(
    glowPanel('bowLamp', [W * 0.44, 0.26, 0.05], [0, bodyY - bodyH * 0.24, L * 0.16 + L * 0.16]),
    glowPanel('skirtGlow', [W * 0.62, 0.24, 0.05], [0, skirtH * 0.20, -L * 0.48]),
    // A hovercraft's lift fans are lit from underneath; this strip is what makes
    // it read as hovering rather than as a boat sitting in a hole.
    glowPanel('liftGlow', [W * 0.30, 0.06, L * 0.20], [0, 0.06, 0]),
  );

  return {
    key: soviet ? 'soviet_transport' : 'allied_transport',
    name: 'Hover Transport',
    faction,
    cls: 'naval',
    hullLength: L,
    masses,
    hullNumber,
    sockets: [
      { part: PartId.DockEntry, pos: [0, deckY, L * 0.50] },
      { part: PartId.Door, pos: [0, deckY, L * 0.46] },
      { part: PartId.Exhaust, pos: [W * 0.26, bodyY + bodyH * 0.5, -L * 0.30] },
    ],
  };
}

/* ==========================================================================
 * 11. AIRCRAFT
 *
 * The fuselage is a `hull` — a convex point cloud with every edge bevelled —
 * which is the primitive that exists precisely for blended bodies. The wings are
 * `plate`s with a trapezoidal outline, swept and given real dihedral, rather
 * than rotated boxes. Nothing on this model has a flat side.
 * ========================================================================== */

interface PlaneOpts {
  key: string; name: string; faction: UnitMassList['faction']; hullNumber: number;
  length: number; span: number; height: number;
  /** The Soviet Interceptor carries its engines in nacelles; the Petrel Bomber is blended. */
  nacelles: boolean;
}

function plane(o: PlaneOpts): UnitMassList {
  const L = o.length, S = o.span, H = o.height;
  const fuseH = H * 0.42;
  const fuseY = H * 0.655;
  const wingY = fuseY - fuseH * 0.18;

  const masses: MassDef[] = [
    primary('forwardFuselage', 'hull', [S * 0.20, fuseH, L * 0.56], [0, fuseY, L * 0.16], 'paintLarge', {
      shape: {
        // A blended forebody: chined flanks, a flat-ish belly, a raised spine.
        points: [
          [0, 0.10, 1.00], [0.34, 0.02, 0.52], [-0.34, 0.02, 0.52],
          [0.50, -0.10, -0.30], [-0.50, -0.10, -0.30],
          [0.44, 0.34, -0.34], [-0.44, 0.34, -0.34],
          [0.34, -0.44, -0.10], [-0.34, -0.44, -0.10],
          [0.40, 0.20, -1.00], [-0.40, 0.20, -1.00],
          [0.40, -0.34, -1.00], [-0.40, -0.34, -1.00],
        ],
        chamfer: 0.05,
      },
    }),
    primary('aftBoom', 'taperedBox', [S * 0.16, fuseH * 0.78, L * 0.48], [0, fuseY - fuseH * 0.04, -L * 0.26], 'paintMed', {
      shape: { topScaleX: 0.66, topScaleZ: 0.60, shear: -L * 0.05, cornerCut: S * 0.02 },
    }),
    plateMass('wing', MassRole.Primary, [
      [S * 0.21, -L * 0.16], [S * 0.21, L * 0.02],
      [-S * 0.21, L * 0.16], [-S * 0.21, -L * 0.06],
    ], H * 0.10, [S * 0.26, wingY, -L * 0.06], [0, -0.28, 0.10], 'paintLarge', {
      capSlot: 'paintLarge', mirrorX: true,
    }),
    // The airframes finally diverge at the tail as loudly as they do at the
    // engines. The Petrel keeps one integrated aerospace keel; the Soviet
    // interceptor carries two outward-canted fins above its exposed nacelles.
    o.nacelles
      ? primary('tailFin', 'taperedBox', [0.16, H * 0.27, L * 0.20],
        [S * 0.15, H - H * 0.145, -L * 0.40], 'paintMed', {
          mirrorX: true, rot: [0, 0, 0.18],
          shape: { topScaleX: 0.62, topScaleZ: 0.48, shear: -L * 0.05 },
        })
      : primary('tailFin', 'taperedBox', [0.16, H * 0.32, L * 0.22],
        [0, H - H * 0.16, -L * 0.40], 'paintMed', {
          shape: { topScaleX: 0.62, topScaleZ: 0.50, shear: -L * 0.05 },
        }),
  ];

  masses.push(
    // THE NOSE WAS ON BACKWARDS AND FLOATING, and nothing could have noticed:
    // these two models were built and validated on every boot and DRAWN BY
    // NOTHING until the Petrel Bomber and the Interceptor got def rows, so this is the
    // first time anyone has seen the result.
    //
    // Two separate errors in one line. `coneProfile` is radius 0.5 at local
    // y=0 tapering to `0.5 * rTop` at y=1, so the WIDE end is -Y and the tip is
    // +Y; `rot: [-HALF_PI, 0, 0]` maps local +Y onto world -Z, which pointed the
    // tip at the tail and presented the blunt 0.5-radius base to the airflow.
    // And at `z = L * 0.56` with a height of `L * 0.22` the cone spanned
    // 0.45L..0.67L while the fuselage hull ends at 0.44L — so it hung in front
    // of the aircraft with a visible gap, which is exactly what the first
    // screenshot of a flying Petrel Bomber showed.
    //
    // `+HALF_PI` points the tip forward. `z = L * 0.42` over `L * 0.20` spans
    // 0.32L..0.52L, which buries the base inside the hull's forward taper
    // (still full-width at 0.31L) and carries the radome past the tip.
    greeble('nose', 'cone', [S * 0.18, L * 0.20, fuseH * 0.92], [0, fuseY, L * 0.42], 'paintMed', {
      rot: [HALF_PI, 0, 0], group: 'nose', shape: { segments: 12, rTop: 0.22 },
    }),
    greeble('canopy', 'revolve', [S * 0.15, fuseH * 0.42, L * 0.24], [0, fuseY + fuseH * 0.42, L * 0.20], 'glass', {
      group: 'canopy', shape: { profile: DOME_PROFILE, segments: 12 },
    }),
    armour('tailPlane', taperOutline(S * 0.18, L * 0.14, 0.52), 0.10,
      [S * 0.11, fuseY + fuseH * 0.10, -L * 0.44], [0, -0.16, 0.06], 'paintSmall', 'tail planes', { mirrorX: true }),
    greeble('intake', 'taperedBox', [S * 0.10, fuseH * 0.42, L * 0.16], [S * 0.13, fuseY - fuseH * 0.10, L * 0.06], 'grille', {
      mirrorX: true, group: 'intakes', shape: { topScaleX: 0.8, topScaleZ: 0.86, shear: -0.12 },
    }),
    greeble('gearPod', 'hull', [S * 0.08, H * 0.12, L * 0.12], [S * 0.12, fuseY - fuseH * 0.5, -L * 0.02], 'paintTiny', {
      mirrorX: true, group: 'gear',
      shape: {
        points: [
          [0.4, 0.5, 0.6], [-0.4, 0.5, 0.6], [0.4, 0.5, -0.6], [-0.4, 0.5, -0.6],
          [0.28, -0.5, 0.34], [-0.28, -0.5, 0.34], [0.28, -0.5, -0.34], [-0.28, -0.5, -0.34],
        ],
        chamfer: 0.04,
      },
    }),
    greeble('pylon', 'taperedBox', [0.14, H * 0.10, L * 0.10], [S * 0.24, wingY - H * 0.07, -L * 0.04], 'bareMetal', {
      mirrorX: true, group: 'stores', shape: { topScaleX: 0.62, topScaleZ: 0.72 },
    }),
    greeble('ordnance', 'revolve', [0.26, L * 0.26, 0.26], [S * 0.24, wingY - H * 0.13, -L * 0.02], 'bareMetal', {
      mirrorX: true, rot: [HALF_PI, 0, 0], group: 'stores', shape: { profile: CAPSULE_PROFILE, segments: 10 },
    }),
    // The pod used to end near the muzzle socket without any readable weapon
    // mouth. A short cannon liner now overlaps the capsule and terminates on
    // the live socket exactly, so flashes originate at visible hardware.
    greeble('gunMuzzle', 'cylinder', [0.17, L * 0.14, 0.17],
      [S * 0.24, wingY - H * 0.13, L * 0.03], 'bareMetal', {
        mirrorX: true, rot: [HALF_PI, 0, 0], group: 'stores',
        shape: { segments: 10, rTop: 0.76, capChamfer: 0.025 },
      }),
    // The chine strake: one plate down each flank at the fuselage waterline.
    armour('fuse.chine', taperOutline(L * 0.44, 0.34, 0.42), 0.05,
      [S * 0.09, fuseY - fuseH * 0.06, L * 0.16], [0, HALF_PI, HALF_PI + 0.10],
      'paintMed', 'fuselage plating', { mirrorX: true }),
  );

  if (o.nacelles) {
    masses.push(
      greeble('nacelle', 'cylinder', [S * 0.13, L * 0.34, S * 0.13], [S * 0.17, fuseY - fuseH * 0.16, -L * 0.26], 'bareMetal', {
        mirrorX: true, rot: [HALF_PI, 0, 0], group: 'engines', shape: { segments: 12, rTop: 0.88 },
      }),
      greeble('nacelleNozzle', 'cylinder', [S * 0.15, L * 0.10, S * 0.15],
        [S * 0.17, fuseY - fuseH * 0.16, -L * 0.46], 'bareMetal', {
          mirrorX: true, rot: [HALF_PI, 0, 0], group: 'engines',
          shape: { segments: 12, rTop: 0.74, capChamfer: 0.04 },
        }),
    );
  } else {
    masses.push(
      greeble('exhaustRing', 'cylinder', [S * 0.14, 0.24, S * 0.14], [0, fuseY, -L * 0.52], 'bareMetal', {
        rot: [HALF_PI, 0, 0], group: 'engines', shape: { segments: 12 },
      }),
    );
  }

  masses.push(
    slab('wingBand', [S * 0.22, 0.07, L * 0.11], [S * 0.28, wingY + H * 0.05, -L * 0.06], { mirrorX: true , k: TEAM_K.plane }),
    slab('finFlash', [0.07, H * 0.18, L * 0.10], [0.06, H - H * 0.16, -L * 0.40], { mirrorX: true , k: TEAM_K.plane }),
    slab('spine', [S * 0.08, 0.07, L * 0.24], [0, fuseY + fuseH * 0.5, -L * 0.06], { k: TEAM_K.plane }),
  );
  masses.push(insignia([S * 0.13, 0.05, S * 0.13], [S * 0.28, wingY + H * 0.06, -L * 0.06]));
  masses.push(
    glowPanel('afterburner',
      o.nacelles ? [S * 0.13, 0.22, 0.06] : [S * 0.19, 0.26, 0.06],
      o.nacelles ? [S * 0.17, fuseY - fuseH * 0.16, -L * 0.515] : [0, fuseY, -L * 0.56],
      o.nacelles ? { mirrorX: true } : {}),
    glowPanel('wingTipLight', [0.10, 0.14, L * 0.26], [S * 0.44, wingY + H * 0.02, -L * 0.06], { mirrorX: true }),
    glowPanel('formationStrip', [S * 0.05, 0.05, L * 0.30], [S * 0.14, fuseY + fuseH * 0.44, L * 0.02], { mirrorX: true }),
  );

  return {
    key: o.key, name: o.name, faction: o.faction, cls: 'air',
    hullLength: L, masses, hullNumber: o.hullNumber,
    sockets: [
      { part: PartId.MuzzleA, pos: [S * 0.24, wingY - H * 0.13, L * 0.10] },
      { part: PartId.MuzzleB, pos: [-S * 0.24, wingY - H * 0.13, L * 0.10] },
      { part: PartId.Exhaust, pos: [0, fuseY, -L * 0.56] },
    ],
  };
}

/* ==========================================================================
 * 12. THE ROSTER
 * ========================================================================== */

export const UNIT_MASS_LISTS: readonly UnitMassList[] = [
  /* -- Allies ----------------------------------------------------------- */
  infantry({ key: 'allied_rifle', name: 'Peacekeeper', faction: 'allies', hullNumber: 4172, weapon: 'rifle', pack: 'radio', build: 'plated' }),
  // The Allied half of the anti-armour pair. `soviet_flak` below has carried the
  // launcher-and-drum loadout since the roster was written; this is the same two
  // option flips on the OTHER silhouette family, so the two armies' AT troopers
  // read as different soldiers rather than one mesh in two palettes — which is
  // exactly the R12 failure the header above this factory describes.
  infantry({ key: 'allied_javelin', name: 'Javelin', faction: 'allies', hullNumber: 4172, weapon: 'launcher', pack: 'drum', build: 'plated' }),
  infantry({ key: 'allied_engineer', name: 'Engineer', faction: 'allies', hullNumber: 4172, weapon: 'tool', pack: 'case', build: 'plated' }),
  infantry({ key: 'allied_marshal', name: 'Field Marshal', faction: 'allies', hullNumber: 4172, weapon: 'rifle', pack: 'radio', build: 'plated', officer: true }),

  tank({
    key: 'allied_guardian', name: 'Guardian Tank', faction: 'allies', hullNumber: 4172,
    hullLength: 6.6, hullWidth: 3.2, height: 2.50, brutalist: false, gun: 'cannon', wheels: 5,
    v2Style: 'precision',
  }),
  tank({
    key: 'allied_ifv', name: 'Sabre IFV', faction: 'allies', hullNumber: 4172,
    // 5, not 4: VISUAL_DNA S5 wants 5-7 road-wheel dots and the IFV was the one
    // unit in the roster below the floor. Its run is 4.47 m, so five 0.43 m
    // wheels sit 1.12 m apart with room to spare.
    hullLength: 5.4, hullWidth: 2.9, height: 2.45, brutalist: false, gun: 'twinCannon', wheels: 5,
  }),
  tank({
    key: 'allied_prism', name: 'Refractor Tank', faction: 'allies', hullNumber: 4172,
    hullLength: 6.4, hullWidth: 3.0, height: 2.60, brutalist: false, gun: 'prism', wheels: 5,
  }),
  support({
    key: 'allied_harvester', name: 'Chrono Miner', faction: 'allies', hullNumber: 4172,
    hullLength: 8.6, hullWidth: 4.0, height: 3.30, brutalist: false, role: 'harvester',
  }),
  support({
    key: 'allied_dozer', name: 'Construction Dozer', faction: 'allies', hullNumber: 4172,
    hullLength: 9.0, hullWidth: 4.4, height: 3.80, brutalist: false, role: 'dozer',
  }),
  ship({
    key: 'allied_destroyer', name: 'Aircraft Cruiser', faction: 'allies', hullNumber: 4172,
    length: 14.0, beam: 4.2, height: 4.4, brutalist: false, armament: 'turret',
  }),
  ship({
    key: 'allied_gunboat', name: 'Assault Destroyer', faction: 'allies', hullNumber: 4172,
    length: 9.6, beam: 3.1, height: 3.4, brutalist: false, armament: 'escort',
  }),
  hoverTransport('allies', 4172),
  plane({
    key: 'allied_vindicator', name: 'Petrel Bomber', faction: 'allies', hullNumber: 4172,
    length: 11.0, span: 12.0, height: 3.0, nacelles: false,
  }),
  // The two naval rungs added when every army got a full fleet. The recon hull
  // is the smallest thing afloat in the game on purpose — it is bought for its
  // sight radius, and a silhouette that reads as cheap is half of what stops a
  // player mistaking it for a warship and sending it into a fight.
  ship({
    key: 'allied_hydrofoil', name: 'Hydrofoil', faction: 'allies', hullNumber: 4172,
    length: 7.2, beam: 2.5, height: 2.4, brutalist: false, armament: 'turret',
  }),
  ship({
    key: 'allied_lighter', name: 'Landing Craft', faction: 'allies', hullNumber: 4172,
    length: 11.0, beam: 5.0, height: 3.0, brutalist: false, armament: 'ramp',
  }),
  infantry({
    key: 'allied_frogman', name: 'Frogman', faction: 'allies', hullNumber: 4172,
    weapon: 'rifle', pack: 'rebreather', build: 'plated',
  }),

  /* -- Soviets ---------------------------------------------------------- */
  infantry({ key: 'soviet_conscript', name: 'Conscript', faction: 'soviets', hullNumber: 8188, weapon: 'rifle', pack: 'radio', build: 'greatcoat' }),
  infantry({ key: 'soviet_flak', name: 'Flak Trooper', faction: 'soviets', hullNumber: 8188, weapon: 'launcher', pack: 'drum', build: 'greatcoat' }),
  // THE SOVIET ENGINEER, WHICH DID NOT EXIST. Reported as "the engineers among
  // factions have all the same skin", and that was literally true for these two
  // armies: `engineer` is ONE `Faction.Neutral` def that both of them build, and
  // `units.system.ts` bound it at `FACTION_ANY` to `allied_engineer` — so a
  // Soviet barracks turned out plated Allied technicians. (The Pact and the
  // Reclamation were never affected: they reach the role through their own
  // `mrdArtificer` / `rclTinker` defs in their own modules.)
  //
  // Same two option flips the anti-armour pair uses, on the other silhouette
  // family: greatcoat, cutting torch, gas bottle. See the `tool` and `case`
  // branches in `infantry()` — both fork on `coat` now, because a greatcoat
  // holding the Allied wrench would be one mesh in two palettes.
  infantry({ key: 'soviet_engineer', name: 'Combat Engineer', faction: 'soviets', hullNumber: 8188, weapon: 'tool', pack: 'case', build: 'greatcoat' }),
  infantry({ key: 'soviet_commissar', name: 'War Commissar', faction: 'soviets', hullNumber: 8188, weapon: 'rifle', pack: 'radio', build: 'greatcoat', officer: true }),
  attackDog(),

  tank({
    key: 'soviet_rhino', name: 'Anvil Heavy Tank', faction: 'soviets', hullNumber: 8188,
    hullLength: 7.0, hullWidth: 3.4, height: 2.60, brutalist: true, gun: 'cannon', wheels: 6,
    v2Style: 'dominion',
  }),
  tank({
    key: 'soviet_apocalypse', name: 'Sledge Tank', faction: 'soviets', hullNumber: 8188,
    hullLength: 8.6, hullWidth: 4.1, height: 3.20, brutalist: true, gun: 'twinCannon', wheels: 7, heavy: true,
  }),
  sickle(),
  tank({
    key: 'soviet_v4', name: 'V4 Rocket Launcher', faction: 'soviets', hullNumber: 8188,
    hullLength: 7.4, hullWidth: 3.3, height: 2.90, brutalist: true, gun: 'rocketRack', wheels: 5,
  }),
  support({
    key: 'soviet_harvester', name: 'Ore Collector', faction: 'soviets', hullNumber: 8188,
    hullLength: 8.6, hullWidth: 4.0, height: 3.30, brutalist: true, role: 'harvester',
  }),
  support({
    key: 'soviet_dozer', name: 'Sputnik Dozer', faction: 'soviets', hullNumber: 8188,
    hullLength: 9.0, hullWidth: 4.4, height: 3.80, brutalist: true, role: 'dozer',
  }),
  ship({
    key: 'soviet_dreadnought', name: 'Dreadnought', faction: 'soviets', hullNumber: 8188,
    length: 16.0, beam: 4.8, height: 4.8, brutalist: true, armament: 'battery',
  }),
  submarine(),
  hoverTransport('soviets', 8188),
  plane({
    key: 'soviet_mig', name: 'Interceptor', faction: 'soviets', hullNumber: 8188,
    length: 10.0, span: 10.5, height: 2.9, nacelles: true,
  }),
  ship({
    key: 'soviet_picket', name: 'Picket Boat', faction: 'soviets', hullNumber: 8188,
    length: 7.0, beam: 2.7, height: 2.5, brutalist: true, armament: 'turret',
  }),
  ship({
    key: 'soviet_lighter', name: 'Assault Barge', faction: 'soviets', hullNumber: 8188,
    length: 11.0, beam: 5.2, height: 3.0, brutalist: true, armament: 'ramp',
  }),
  infantry({
    key: 'soviet_diver', name: 'Naval Infantry', faction: 'soviets', hullNumber: 8188,
    weapon: 'rifle', pack: 'rebreather', build: 'greatcoat',
  }),
];

/** key -> mass list, for the model registry. */
export const UNIT_MASS_BY_KEY: ReadonlyMap<string, UnitMassList> =
  new Map(UNIT_MASS_LISTS.map((u) => [u.key, u]));

/** Every faction that has at least one unit, in atlas-build order. */
export const UNIT_FACTIONS: readonly UnitMassList['faction'][] = ['allies', 'soviets'];

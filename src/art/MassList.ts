/**
 * ============================================================================
 * VOLTMARCH — src/art/MassList.ts
 * ============================================================================
 * THE DECLARATIVE UNIT LANGUAGE, and the validator that rejects mush.
 *
 * Risk R8: "code-generated units drift toward either 40 tiny boxes (noise) or
 * 3 plain boxes (nothing)". The mitigation is not taste, it is arithmetic —
 * every unit is a list of `{ name, primitive, dimensions, anchor, slot }` and
 * `validateUnit` refuses to hand back a model that misses the bible's numbers.
 *
 * WHAT A MASS LIST IS
 * -------------------
 *   masses[]        3-6 PRIMARY masses (the silhouette) + 6-12 greebles
 *   teamSlabs       flat panel inserts, 8-14% of surface (R-T1/R-T2)
 *   one insignia    exactly one (R-T4)
 *   sockets[]       named local transforms: muzzles, exhausts, turret pivot
 *
 * COORDINATES (types.ts is normative and this file obeys it)
 * ----------------------------------------------------------
 *   1 unit = 1 metre. Y is up. Model origin is the GROUND-PLANE CENTRE of the
 *   footprint, +Z is forward. `anchor` is the mass CENTRE, so a 1.2 m tall box
 *   sitting on the ground has anchor.y = 0.6.
 *
 * THE PRIMITIVE SET
 * -----------------
 * The original three are still here and still valid — every existing mass list
 * keeps compiling and rendering exactly as it did:
 *   box    — a chamfered frustum-box. Slabs, wedges, glacis plates, skirts.
 *   lathe  — a revolved normalised profile at 12-16 segments.
 *   prism  — an extruded 2D plan with chamfered rims (the Soviet slab).
 *
 * Everything else comes from `Shapes.ts` and exists because the user's verdict
 * on the first roster was "all around too rectangular, like old-school 3D
 * models". Axis-aligned boxes are what that looks like. The new kinds —
 * `chamferBox`, `taperedBox`, `revolve`, `cylinder`, `cone`, `extrude`,
 * `plate`, `hull`, `greebleStrip`, `tracks` — are the vocabulary for chamfered,
 * tapered, wedge-cut, lathed, plate-layered hardware. See §1b.
 *
 * TWO RULES THAT ARE NOW STRUCTURAL RATHER THAN CULTURAL
 * ------------------------------------------------------
 *   1. DEFAULT CHAMFER ON EVERYTHING. `defaultChamfer` clamps into a band whose
 *      floor is above zero, so authoring a razor-edged box is impossible even
 *      by passing `chamfer: 0`.
 *   2. THE BOXINESS GATE. `boxiness()` measures how much of a unit's silhouette
 *      is an axis-aligned rectangle and `validateUnit` refuses anything past
 *      the ceiling. A regression to "three plain boxes" cannot ship.
 *
 * Nothing here imports THREE — `Shapes.ts` is imported for TYPES ONLY, which
 * erases at compile time. This file stays pure data + arithmetic so the
 * validator runs in a test with no GL context.
 * ============================================================================
 */

import { MIN_CHAMFER, UNIT_GEOMETRY, UNIT_LADDER, UNIT_VALIDATION } from '../core/config';
import type { PartId } from '../core/types';
import type { SlotName, UvRect } from './Greeble';
import { emitShape, fitMesh, shapeMesh } from './Shapes';
import type {
  BoxFace as ShapeBoxFace, FaceKind as ShapeFaceKind,
  ShapeSpec, V2 as ShapeV2, V3 as ShapeV3,
} from './Shapes';

/* ==========================================================================
 * 1. SHAPES
 * ========================================================================== */

/**
 * Every primitive a mass may be.
 *
 * The first three are the legacy set and are built by `UnitFactory`'s own
 * `buildBox` / `buildLathe` / `buildPrism`. The rest are lowered to a
 * `ShapeSpec` by `shapeSpecFor()` and built by `Shapes.shapeMesh()`.
 */
export type PrimitiveKind =
  | 'box' | 'lathe' | 'prism'
  | 'chamferBox' | 'taperedBox' | 'planPrism' | 'revolve' | 'cylinder' | 'cone'
  | 'extrude' | 'plate' | 'hull' | 'greebleStrip' | 'tracks';

/** The kinds `UnitFactory` still builds with its own three builders. */
export const LEGACY_PRIMITIVES: readonly PrimitiveKind[] = ['box', 'lathe', 'prism'];

/** The kinds that come out of `Shapes.ts`. */
export const SHAPE_PRIMITIVES: readonly PrimitiveKind[] = [
  'chamferBox', 'taperedBox', 'planPrism', 'revolve', 'cylinder', 'cone',
  'extrude', 'plate', 'hull', 'greebleStrip', 'tracks',
];

export function isShapePrimitive(k: PrimitiveKind): boolean {
  return SHAPE_PRIMITIVES.indexOf(k) >= 0;
}

/** Which revolved profile a `lathe` mass uses. */
export type LatheProfile = 'cyl' | 'cone' | 'sphere' | 'capsule' | 'dome' | 'disc';

/** The six faces of a box, named by their outward axis. */
export type BoxFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

/** The plan shapes a `prism` mass can extrude. */
export type PrismPlan = 'octagon' | 'hexagon' | 'cutBox' | 'wedge' | 'triangle';

/** How a mass counts toward the silhouette rules. */
export const enum MassRole {
  /** One of the 3-6 shapes a critic reads from 40 m away. */
  Primary = 0,
  /** One of the 6-12 discrete detail objects. Never sub-pixel. */
  Greeble = 1,
  /** A flat team-colour panel insert. Counted against R-T1's 8-14%. */
  TeamSlab = 2,
  /** The single insignia decal plate. Exactly one per unit (R-T4). */
  Insignia = 3,
  /** A masked emissive panel. 1-3% of surface (R-T5). */
  Emissive = 4,
}

export interface MassDef {
  /** Human name. Appears in validator errors, so make it specific. */
  name: string;
  primitive: PrimitiveKind;
  role: MassRole;
  /** Full extents in metres: [width(X), height(Y), length(Z)]. */
  size: readonly [number, number, number];
  /** Centre of the mass in model-local metres. */
  anchor: readonly [number, number, number];
  /** Euler XYZ in radians. Applied about the mass centre. */
  rot?: readonly [number, number, number];
  /** Atlas tile for the sides / the whole mass. */
  slot: SlotName;
  /** Per-face overrides. `box` only. */
  faceSlots?: Partial<Record<BoxFace, SlotName>>;
  /** Atlas tile for lathe/prism caps. Defaults to `slot`. */
  capSlot?: SlotName;
  /** Rides the turret transform instead of the hull. */
  turret?: boolean;
  /** Also emit a mirrored copy at -X. Tracks, wheels, wings, legs. */
  mirrorX?: boolean;
  /** Chamfer in metres. Defaults to the faction fraction of min(size). */
  chamfer?: number;
  /** `box`: [topScaleX, topScaleZ, topOffsetZ]. Makes wedges and skirts. */
  taper?: readonly [number, number, number];
  /** `lathe`: which profile. Default 'cyl'. */
  profile?: LatheProfile;
  /** `lathe`: radial segments. Default UNIT_GEOMETRY.cylSegments. */
  segments?: number;
  /** `lathe`: top radius as a fraction of bottom. 1 = straight. */
  topRadius?: number;
  /** `prism`: plan shape. Default 'octagon'. */
  plan?: PrismPlan;
  /** `prism`/`box`: corner cut as a fraction of width. Soviet slabs use 0.08. */
  cornerCut?: number;
  /**
   * Greebles that belong to ONE readable object share a group name and count
   * once against the 6-12 budget. A six-wheel road-wheel run is one greeble to
   * the eye, not six, and bible 5.3's budget is about things a critic can
   * point at from across the map.
   */
  group?: string;
  /**
   * Extra vertex-colour multiplier for this mass, 1 = untouched. Used to sink
   * a recessed mass a few percent darker so the eye reads depth without a
   * second material.
   */
  tint?: number;
  /**
   * Parameters for the `Shapes.ts` primitives. Ignored by `box`/`lathe`/`prism`.
   * `size` is always the authoritative bounding box — the built mesh is fitted
   * into it — so nothing here ever needs to repeat width/height/length.
   */
  shape?: MassShape;
  /**
   * ARMOUR PLATES LAYERED OVER THIS MASS. Positions are relative to the parent
   * mass CENTRE and inherit the parent's rotation.
   *
   * This is the single highest-value entry in the whole file: a hull that is one
   * tapered volume with three plates sitting proud of it at slightly different
   * angles reads as hi-tech armour, and the same hull with no plates reads as a
   * box, at a cost of ~60 triangles per plate.
   */
  plates?: readonly AttachedPlate[];
  /** Sub-greeble runs attached to this mass. One run = one greeble object. */
  greebles?: readonly AttachedGreeble[];
  /**
   * THIS MASS SWINGS WHEN THE UNIT WALKS.
   *
   * Infantry are one merged instanced mesh — there is no scene graph to hang a
   * hip joint off, and there must not be one, because 200 riflemen at 60 fps is
   * the budget. So the swing is a vertex-shader rotation, and this is how a
   * mass opts into it: the factory bakes `(sign, pivotY)` into a per-vertex
   * attribute over exactly the vertices this mass emitted.
   *
   *   limb    'leg' swings with the gait phase, 'arm' against it — the
   *           contralateral rhythm, which is most of what makes a walk read as
   *           a walk rather than as a shuffle.
   *   pivotY  model-local height of the joint. Rotation is about the X axis
   *           through this height, so a leg pivots at the hip and an arm at the
   *           shoulder rather than both swinging about the ground plane.
   *
   * A `mirrorX` mass gets OPPOSITE signs on its two copies automatically, which
   * is the whole trick: one declaration on `leg` animates both legs correctly.
   * Anything without this field is welded to the body, which is the right
   * default for a torso, a helmet, a backpack and every vehicle in the game.
   */
  gait?: GaitSpec;
}

/** See `MassDef.gait`. */
export interface GaitSpec {
  readonly limb: 'leg' | 'arm';
  readonly pivotY: number;
}

/* --------------------------------------------------------------------------
 * 1b. SHAPE PARAMETERS
 *
 * Deliberately ONE flat bag of optional fields rather than a discriminated
 * union: `primitive` is already the discriminator, and an author writing a mass
 * list should not have to repeat it. Which fields each primitive reads:
 *
 *   chamferBox    chamfer, chamferTop, chamferBottom, cornerCut
 *   taperedBox    ... plus topScaleX/Z, bottomScaleX/Z, shear
 *   planPrism     plan (required), chamferTop/Bottom, taper fields, shear
 *   revolve       profile (required), segments, twist, zScale
 *   cylinder      segments, capChamfer, rTop, twist, zScale
 *   cone          segments, capChamfer, rTop
 *   extrude       profile + path (both required), scale, twist, capStart/End
 *   plate         outline (required), thickness, bevel
 *   hull          points (required), chamfer
 *   greebleStrip  density, seed, and nothing else
 *   tracks        wheels, sprocketScale, returnRollers, skirtHeight, segments
 * -------------------------------------------------------------------------- */

export interface MassShape {
  /* -- box family ------------------------------------------------------- */
  chamfer?: number;
  chamferTop?: number;
  chamferBottom?: number;
  /** 45-degree cut on the four vertical corners, in metres. Octagonal plan. */
  cornerCut?: number;
  topScaleX?: number;
  topScaleZ?: number;
  bottomScaleX?: number;
  bottomScaleZ?: number;
  /** Metres the top face slides along +Z. THIS is the glacis / wedge prow. */
  shear?: number;

  /* -- revolved / swept -------------------------------------------------- */
  /** `revolve`: [radius, y] in metres. `extrude`: the swept cross-section. */
  profile?: readonly ShapeV2[];
  segments?: number;
  twist?: number;
  zScale?: number;
  /** `cylinder`/`cone`: top radius as a fraction of the bottom. */
  rTop?: number;
  capChamfer?: number;

  /* -- plans ------------------------------------------------------------- */
  /** `planPrism`: CCW-from-above plan in metres. */
  plan?: readonly ShapeV2[];
  /** `plate`: outline in the plate's local XZ plane. */
  outline?: readonly ShapeV2[];
  thickness?: number;
  bevel?: number;

  /* -- extrude ----------------------------------------------------------- */
  path?: readonly ShapeV3[];
  scale?: readonly number[];
  capStart?: boolean;
  capEnd?: boolean;

  /* -- hull -------------------------------------------------------------- */
  points?: readonly ShapeV3[];

  /* -- greebleStrip ------------------------------------------------------ */
  density?: number;
  seed?: number;

  /* -- tracks ------------------------------------------------------------ */
  wheels?: number;
  sprocketScale?: number;
  returnRollers?: number;
  skirtHeight?: number;

  /**
   * How the built mesh is fitted into `size`.
   *   'stretch'  (default) scale each axis independently to fill `size` exactly
   *   'uniform'  preserve the authored proportions, fit inside `size`
   *   'none'     use the mesh's own coordinates, centred on the anchor
   */
  fit?: 'stretch' | 'uniform' | 'none';
}

/* --------------------------------------------------------------------------
 * 1c. ATTACHMENTS — layered plates and sub-greeble
 * -------------------------------------------------------------------------- */

export interface AttachedPlate {
  /** Appears in validator errors. Defaults to `${parent}.plate${n}`. */
  name?: string;
  /** Outline in the plate's local XZ plane, CCW from above, metres. */
  outline?: readonly ShapeV2[];
  /** Shorthand for a rectangular plate: [width(X), length(Z)]. */
  rect?: readonly [number, number];
  /** Plate thickness along its local +Y. Default 8 cm. */
  thickness?: number;
  /** Rim bevel. Defaults to the automatic chamfer. */
  bevel?: number;
  /** Offset from the PARENT MASS CENTRE, in parent-local metres. */
  offset: readonly [number, number, number];
  /** Euler XYZ about the plate's own centre, applied before the parent's. */
  rot?: readonly [number, number, number];
  /** Defaults to the parent's slot. `teamSlab` makes it an R-T2 insert. */
  slot?: SlotName;
  /** Defaults to Greeble, or TeamSlab when `slot` is 'teamSlab'. */
  role?: MassRole;
  mirrorX?: boolean;
  /** Plates that read as one object share a group and cost one greeble slot. */
  group?: string;
  tint?: number;
}

export interface AttachedGreeble {
  name?: string;
  /** Run length along the strip's local +Z. */
  length: number;
  /** Strip width along local X. */
  width?: number;
  /** Tallest item along local +Y. */
  height?: number;
  /** Items per metre. 2-4 reads; above 6 is noise (bible 5.3). */
  density?: number;
  /** Deterministic. Defaults to a hash of the parent name. */
  seed?: number;
  offset: readonly [number, number, number];
  rot?: readonly [number, number, number];
  slot?: SlotName;
  mirrorX?: boolean;
  group?: string;
}

/** A named local transform the sim/anim can drive. */
export interface SocketSpec {
  part: PartId;
  /** Local metres from the model origin, or from the turret pivot if `turret`. */
  pos: readonly [number, number, number];
  yaw?: number;
  pitch?: number;
  /** Lives in turret-local space. */
  turret?: boolean;
}

/** Which validation band a unit is held to. */
export type UnitClass = 'vehicle' | 'infantry' | 'walker' | 'naval' | 'air';

export interface UnitMassList {
  /** Unique key. Also the ModelRegistry key other modules look up. */
  key: string;
  name: string;
  faction: 'allies' | 'soviets' | 'neutral';
  cls: UnitClass;
  /**
   * The scale-ladder anchor: hull long axis in metres. Bible 5.2 R-S1 wants a
   * MBT at 7 m and never below 0.3x a production structure's footprint.
   */
  hullLength: number;
  /** Hull-local yaw pivot of the turret. Omit for turretless units. */
  turretPivot?: readonly [number, number, number];
  masses: readonly MassDef[];
  sockets: readonly SocketSpec[];
  /** Four-digit stencil number. Deterministic per unit, never random. */
  hullNumber: number;
}

/* ==========================================================================
 * 2. PLAN POLYGONS
 *
 * All in unit space (-0.5..0.5 on both axes), scaled by size.x / size.z at
 * build time. Counter-clockwise seen from +Y.
 * ========================================================================== */

export type Plan2D = readonly (readonly [number, number])[];

function octagon(cut: number): Plan2D {
  const c = Math.min(0.49, Math.max(0.02, cut));
  return [
    [-0.5 + c, -0.5], [0.5 - c, -0.5], [0.5, -0.5 + c], [0.5, 0.5 - c],
    [0.5 - c, 0.5], [-0.5 + c, 0.5], [-0.5, 0.5 - c], [-0.5, -0.5 + c],
  ];
}

const HEXAGON: Plan2D = [
  [-0.25, -0.5], [0.25, -0.5], [0.5, 0], [0.25, 0.5], [-0.25, 0.5], [-0.5, 0],
];

/** A forward wedge: full width aft, tapering to a nose at +Z. */
const WEDGE: Plan2D = [
  [-0.5, -0.5], [0.5, -0.5], [0.30, 0.24], [0, 0.5], [-0.30, 0.24],
];

const TRIANGLE: Plan2D = [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]];

export function planPolygon(plan: PrismPlan, cornerCut: number): Plan2D {
  switch (plan) {
    case 'hexagon': return HEXAGON;
    case 'wedge': return WEDGE;
    case 'triangle': return TRIANGLE;
    case 'cutBox': return octagon(cornerCut > 0 ? cornerCut : 0.08);
    default: return octagon(cornerCut > 0 ? cornerCut : 0.20);
  }
}

/* ==========================================================================
 * 3. LATHE PROFILES
 *
 * A profile is a list of [radius, y] in UNIT space: radius 0..0.5 of the
 * mass's X extent, y 0..1 of its Y extent. Flat-shaded per band, which is what
 * gives the 12-16 facet silhouette scorecard #40 asks for.
 * ========================================================================== */

export type Profile2D = readonly (readonly [number, number])[];

/** Chamfered cylinder: the rim cuts are the bevel highlight on a barrel. */
function cylProfile(chamferY: number, topRadius: number): Profile2D {
  const c = Math.min(0.30, Math.max(0.01, chamferY));
  const rc = Math.min(0.30, c);
  return [
    [0, 0],
    [0.5 - rc, 0],
    [0.5, c],
    [0.5 * topRadius, 1 - c],
    [0.5 * topRadius - rc, 1],
    [0, 1],
  ];
}

function coneProfile(topRadius: number): Profile2D {
  return [[0, 0], [0.5, 0], [0.5 * topRadius, 1], [0, 1]];
}

function sphereProfile(rings: number): Profile2D {
  const out: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI;
    out.push([0.5 * Math.sin(t), 0.5 - 0.5 * Math.cos(t)]);
  }
  return out;
}

/** Half-dome: a hemisphere sitting on the ground plane of the mass. */
function domeProfile(rings: number): Profile2D {
  const out: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI * 0.5;
    out.push([0.5 * Math.cos(t), Math.sin(t)]);
  }
  out.unshift([0.5, 0]);
  return out;
}

/** Capsule: hemisphere cap, straight body, hemisphere cap. */
function capsuleProfile(rings: number): Profile2D {
  const out: [number, number][] = [];
  // Bottom cap occupies the first 25% of the height, top cap the last 25%.
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI * 0.5;
    out.push([0.5 * Math.sin(t), 0.25 - 0.25 * Math.cos(t)]);
  }
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI * 0.5;
    out.push([0.5 * Math.cos(t), 0.75 + 0.25 * Math.sin(t)]);
  }
  return out;
}

/** A flat disc — road wheels, drive sprockets, hatch caps. */
const DISC_PROFILE: Profile2D = [[0, 0], [0.46, 0], [0.5, 0.18], [0.5, 0.82], [0.46, 1], [0, 1]];

export function latheProfile(
  profile: LatheProfile, chamferY: number, topRadius: number, rings: number,
): Profile2D {
  switch (profile) {
    case 'cone': return coneProfile(topRadius);
    case 'sphere': return sphereProfile(rings);
    case 'dome': return domeProfile(Math.max(4, rings >> 1));
    case 'capsule': return capsuleProfile(Math.max(3, rings >> 2));
    case 'disc': return DISC_PROFILE;
    default: return cylProfile(chamferY, topRadius);
  }
}

/* ==========================================================================
 * 3b. LOWERING A MASS ONTO A SHAPE SPEC
 *
 * This is the whole bridge between the declarative language and `Shapes.ts`.
 * It is pure: it builds a plain-object spec and never touches THREE. The
 * consumer calls `Shapes.shapeMesh(spec)` and then `Shapes.fitMesh(mesh, size)`.
 * ========================================================================== */

/** Default plate thickness in metres when an attachment does not say. */
export const PLATE_THICKNESS = 0.08;

/**
 * Turn a mass into a `ShapeSpec`, or null if it is one of the three legacy
 * primitives that `UnitFactory` still builds itself.
 *
 * `chamfer` is the already-resolved metre value from `defaultChamfer`, so the
 * faction's chamfer language reaches every new primitive without `Shapes.ts`
 * having to know what a faction is.
 */
export function shapeSpecFor(m: MassDef, chamfer: number): ShapeSpec | null {
  const s = m.shape ?? {};
  const [w, h, d] = m.size;
  const c = s.chamfer ?? chamfer;

  switch (m.primitive) {
    case 'chamferBox':
      return {
        kind: 'chamferBox', w, h, d, chamfer: c,
        chamferTop: s.chamferTop, chamferBottom: s.chamferBottom, cornerCut: s.cornerCut,
      };
    case 'taperedBox':
      return {
        kind: 'taperedBox', w, h, d, chamfer: c,
        chamferTop: s.chamferTop, chamferBottom: s.chamferBottom, cornerCut: s.cornerCut,
        topScaleX: s.topScaleX, topScaleZ: s.topScaleZ,
        bottomScaleX: s.bottomScaleX, bottomScaleZ: s.bottomScaleZ,
        shear: s.shear,
      };
    case 'planPrism':
      return {
        kind: 'prism', plan: s.plan ?? [], h,
        chamferTop: s.chamferTop ?? c, chamferBottom: s.chamferBottom ?? c,
        topScaleX: s.topScaleX, topScaleZ: s.topScaleZ,
        bottomScaleX: s.bottomScaleX, bottomScaleZ: s.bottomScaleZ,
        shear: s.shear, uPerEdge: false,
      };
    case 'revolve':
      return {
        kind: 'lathe', profile: s.profile ?? [],
        segments: s.segments ?? UNIT_GEOMETRY.cylSegments,
        twist: s.twist, zScale: s.zScale,
      };
    case 'cylinder':
      return {
        kind: 'cylinder', r: Math.min(w, d) * 0.5, h,
        segments: s.segments ?? UNIT_GEOMETRY.cylSegments,
        capChamfer: s.capChamfer ?? c, rTop: s.rTop,
        zScale: s.zScale ?? (w > 1e-6 ? d / w : 1), twist: s.twist,
      };
    case 'cone':
      return {
        kind: 'cone', r: Math.min(w, d) * 0.5, h,
        segments: s.segments ?? 12, capChamfer: s.capChamfer ?? c,
        rTop: s.rTop ?? 0.25, zScale: s.zScale ?? (w > 1e-6 ? d / w : 1),
      };
    case 'extrude':
      return {
        kind: 'extrude', profile: s.profile ?? [], path: s.path ?? [],
        scale: s.scale, twist: s.twist,
        capStart: s.capStart, capEnd: s.capEnd,
      };
    case 'plate':
      return {
        kind: 'plate',
        outline: s.outline ?? rectOutline(w, d),
        thickness: s.thickness ?? h,
        bevel: s.bevel ?? c,
      };
    case 'hull':
      return { kind: 'hull', points: s.points ?? [], chamfer: c };
    case 'greebleStrip':
      return {
        kind: 'greebleStrip', length: d, width: w, height: h,
        density: s.density, seed: s.seed ?? hashName(m.name),
      };
    case 'tracks':
      return {
        kind: 'tracks', length: d, height: h, width: w,
        wheels: s.wheels, sprocketScale: s.sprocketScale,
        returnRollers: s.returnRollers, skirtHeight: s.skirtHeight,
        segments: s.segments,
      };
    default:
      return null;
  }
}

/** A centred rectangular plate outline, CCW from above. */
export function rectOutline(w: number, d: number): ShapeV2[] {
  const a = w * 0.5, b = d * 0.5;
  return [[a, -b], [a, b], [-a, b], [-a, -b]];
}

/**
 * A TRAPEZOIDAL plate outline — the shape almost every real armour plate is.
 * `frontScale` narrows the +Z end. This one call is the difference between a
 * plate that reads as armour and a plate that reads as a rectangle.
 */
export function taperOutline(w: number, d: number, frontScale: number, backScale = 1): ShapeV2[] {
  const a = w * 0.5, b = d * 0.5;
  return [
    [a * backScale, -b], [a * frontScale, b],
    [-a * frontScale, b], [-a * backScale, -b],
  ];
}

/** Deterministic 32-bit hash. Seeds a greeble run from its own name. */
function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* ==========================================================================
 * 3c. EXPANSION — attachments become first-class masses
 *
 * Plates and sub-greeble are authored as CHILDREN so a def reads as "a hull
 * with three plates on it" rather than as eleven unrelated anchors. Everything
 * downstream — the validator, the bounds, the silhouette raster, the factory —
 * only ever sees a flat `MassDef[]`, so nothing else has to learn about
 * nesting. `expandMasses` is idempotent and returns the SAME ARRAY when there
 * is nothing to expand, so it is free on every existing mass list.
 * ========================================================================== */

type Mat3 = readonly number[];

/** Euler XYZ (three's default order, R = Rz*Ry*Rx) to a row-major 3x3. */
export function eulerMatrix(r: readonly [number, number, number] | undefined): Mat3 {
  if (r === undefined || (r[0] === 0 && r[1] === 0 && r[2] === 0)) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const cx = Math.cos(r[0]), sx = Math.sin(r[0]);
  const cy = Math.cos(r[1]), sy = Math.sin(r[1]);
  const cz = Math.cos(r[2]), sz = Math.sin(r[2]);
  return [
    cy * cz, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

/** Inverse of `eulerMatrix`. Gimbal-lock safe. */
export function matrixEuler(m: Mat3): [number, number, number] {
  const sy = -m[6];
  if (Math.abs(sy) > 0.99999) {
    const y = sy > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    const x = sy > 0 ? Math.atan2(m[1], m[4]) : Math.atan2(-m[1], m[4]);
    return [x, y, 0];
  }
  return [Math.atan2(m[7], m[8]), Math.asin(sy), Math.atan2(m[3], m[0])];
}

function matMul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

function matApply(m: Mat3, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Bounds of a 2D outline: [width, length]. */
function outlineExtent(outline: readonly ShapeV2[]): [number, number] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of outline) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  if (!isFinite(minX)) return [0.1, 0.1];
  return [Math.max(1e-3, maxX - minX), Math.max(1e-3, maxZ - minZ)];
}

/**
 * Every key `MassDef` itself declares. Anything else on a mass belongs to a
 * SUBTYPE (`BuildingFactory.StructureMass` adds target/feature/anim), and a
 * plate bolted to a pad mass has to land in the pad geometry with the pad's
 * feature code or it will rise out of the ground on its own.
 */
const MASS_DEF_KEYS: ReadonlySet<string> = new Set([
  'name', 'primitive', 'role', 'size', 'anchor', 'rot', 'slot', 'faceSlots', 'capSlot',
  'turret', 'mirrorX', 'chamfer', 'taper', 'profile', 'segments', 'topRadius', 'plan',
  'cornerCut', 'group', 'tint', 'shape', 'plates', 'greebles',
]);

/** The subtype-only fields a child mass must inherit from its parent. */
function inheritedExtras(parent: MassDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(parent)) {
    if (!MASS_DEF_KEYS.has(k)) out[k] = (parent as unknown as Record<string, unknown>)[k];
  }
  return out;
}

/** Flatten one mass's attachments into standalone masses. */
function expandOne(parent: MassDef, out: MassDef[]): void {
  const pm = eulerMatrix(parent.rot as [number, number, number] | undefined);
  const extras = inheritedExtras(parent);

  const place = (
    offset: readonly [number, number, number],
    rot: readonly [number, number, number] | undefined,
  ): { anchor: [number, number, number]; rot: [number, number, number] } => {
    const local = matApply(pm, offset);
    const anchor: [number, number, number] = [
      parent.anchor[0] + local[0],
      parent.anchor[1] + local[1],
      parent.anchor[2] + local[2],
    ];
    return { anchor, rot: matrixEuler(matMul(pm, eulerMatrix(rot as [number, number, number] | undefined))) };
  };

  let n = 0;
  for (const p of parent.plates ?? []) {
    const outline = p.outline ?? rectOutline(p.rect?.[0] ?? 1, p.rect?.[1] ?? 1);
    const [ow, od] = outlineExtent(outline);
    const th = p.thickness ?? PLATE_THICKNESS;
    const { anchor, rot } = place(p.offset, p.rot);
    const slot = p.slot ?? parent.slot;
    out.push({
      ...extras,
      name: p.name ?? `${parent.name}.plate${n++}`,
      primitive: 'plate',
      role: p.role ?? (slot === 'teamSlab' ? MassRole.TeamSlab : MassRole.Greeble),
      size: [ow, th, od],
      anchor,
      rot,
      slot,
      capSlot: slot,
      turret: parent.turret,
      mirrorX: p.mirrorX ?? parent.mirrorX,
      chamfer: p.bevel,
      group: p.group ?? `${parent.name}.plates`,
      tint: p.tint ?? parent.tint,
      shape: { outline, thickness: th, bevel: p.bevel, fit: 'none' },
    });
  }

  let g = 0;
  for (const q of parent.greebles ?? []) {
    const { anchor, rot } = place(q.offset, q.rot);
    const name = q.name ?? `${parent.name}.greeble${g++}`;
    const width = q.width ?? Math.max(0.08, q.length * 0.07);
    const height = q.height ?? width * 0.7;
    out.push({
      ...extras,
      name,
      primitive: 'greebleStrip',
      role: MassRole.Greeble,
      size: [width, height, q.length],
      anchor,
      rot,
      slot: q.slot ?? 'bareMetal',
      turret: parent.turret,
      mirrorX: q.mirrorX ?? parent.mirrorX,
      group: q.group ?? name,
      shape: { density: q.density, seed: q.seed ?? hashName(name), fit: 'none' },
    });
  }
}

/**
 * Flatten every attachment in a mass array. Returns the input array untouched
 * when there is nothing to flatten, so this is free on legacy mass lists.
 */
export function expandMasses<T extends MassDef>(masses: readonly T[]): readonly T[] {
  let any = false;
  for (const m of masses) {
    if ((m.plates?.length ?? 0) > 0 || (m.greebles?.length ?? 0) > 0) { any = true; break; }
  }
  if (!any) return masses;
  const out: MassDef[] = [];
  for (const m of masses) {
    out.push(m);
    expandOne(m, out);
  }
  // Children carry the parent's subtype fields (see `inheritedExtras`), so the
  // flattened array is still a T[] — but only structurally, hence the cast.
  return out as T[];
}

/**
 * The flattened form of a unit. Every consumer — factory, validator, bounds —
 * should call this once and then forget attachments exist.
 */
export function expandUnit(list: UnitMassList): UnitMassList {
  const masses = expandMasses(list.masses);
  return masses === list.masses ? list : { ...list, masses };
}

/* ==========================================================================
 * 4. GEOMETRIC MEASUREMENT
 * ========================================================================== */

/** World-axis-aligned extents of one mass after its rotation. */
export function massExtents(m: MassDef): [number, number, number] {
  const [sx, sy, sz] = m.size;
  const r = m.rot;
  if (r === undefined || (r[0] === 0 && r[1] === 0 && r[2] === 0)) return [sx, sy, sz];
  // Rotate the half-extent box and take the absolute projection onto each axis.
  const cx = Math.cos(r[0]), sxr = Math.sin(r[0]);
  const cy = Math.cos(r[1]), syr = Math.sin(r[1]);
  const cz = Math.cos(r[2]), szr = Math.sin(r[2]);
  // R = Rz * Ry * Rx, three's default 'XYZ' euler order, written out in full so
  // nobody has to trust a clever shortcut.
  const e = [
    [cy * cz, cz * syr * sxr - szr * cx, cz * syr * cx + szr * sxr],
    [szr * cy, szr * syr * sxr + cz * cx, szr * syr * cx - cz * sxr],
    [-syr, cy * sxr, cy * cx],
  ];
  const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
  return [
    2 * (Math.abs(e[0][0]) * hx + Math.abs(e[0][1]) * hy + Math.abs(e[0][2]) * hz),
    2 * (Math.abs(e[1][0]) * hx + Math.abs(e[1][1]) * hy + Math.abs(e[1][2]) * hz),
    2 * (Math.abs(e[2][0]) * hx + Math.abs(e[2][1]) * hy + Math.abs(e[2][2]) * hz),
  ];
}

/**
 * Side-elevation projected area of a mass, in square metres.
 *
 * This is the proxy for "projected area" in bible 5.3. The real camera is at a
 * 39-degree pitch and a free yaw, so no single projection is correct for every
 * frame; the side elevation is the one that is stable under yaw and is the view
 * a silhouette is actually judged in.
 */
export function massProjectedArea(m: MassDef): number {
  const [, ey, ez] = massExtents(m);
  // Mirrored copies overlap exactly in side elevation, so they contribute once.
  return ey * ez * silhouetteFillOf(m);
}

/**
 * How much of a mass's own bounding rectangle its side elevation actually
 * fills. A box fills all of it; a cone fills half; a track run is mostly band.
 * These are the numbers `massProjectedArea` and the boxiness gate share.
 */
function silhouetteFillOf(m: MassDef): number {
  switch (m.primitive) {
    case 'lathe':
      return m.profile === 'sphere' || m.profile === 'dome' ? Math.PI / 4 : 0.94;
    case 'prism':
      return 0.90;
    case 'planPrism':
      return 0.86;
    case 'revolve':
    case 'cylinder':
      return 0.94;
    case 'cone':
      return 0.62;
    case 'extrude':
      return 0.80;
    case 'hull':
      return 0.85;
    case 'plate':
      return 0.92;
    case 'greebleStrip':
      return 0.45;
    case 'tracks':
      return 0.88;
    case 'taperedBox':
      return 0.90;
    default:
      return 1.0;
  }
}

/**
 * UNION side-elevation area, in square metres, by rasterising every mass into a
 * 192x192 grid over the unit's bounds.
 *
 * The naive metric — sum every mass's own area — over-counts wildly, because a
 * turret sitting on a hull double-counts the overlap and every greeble inflates
 * the denominator. Bible 5.3's "the dominant feature is 35-50% of projected
 * area" is a statement about the SILHOUETTE, so the silhouette is what gets
 * measured. It is a real rasterisation, not an estimate, and it runs once per
 * unit at build time.
 */
export function silhouetteArea(
  list: UnitMassList, min: readonly [number, number, number], max: readonly [number, number, number],
): number {
  const N = 192;
  const z0 = min[2], y0 = min[1];
  const dz = Math.max(1e-6, max[2] - z0), dy = Math.max(1e-6, max[1] - y0);
  const grid = new Uint8Array(N * N);
  for (const m of expandMasses(list.masses)) {
    const e = massExtents(m);
    const za = (m.anchor[2] - e[2] * 0.5 - z0) / dz, zb = (m.anchor[2] + e[2] * 0.5 - z0) / dz;
    const ya = (m.anchor[1] - e[1] * 0.5 - y0) / dy, yb = (m.anchor[1] + e[1] * 0.5 - y0) / dy;
    const ci0 = Math.max(0, Math.floor(za * N)), ci1 = Math.min(N, Math.ceil(zb * N));
    const ri0 = Math.max(0, Math.floor(ya * N)), ri1 = Math.min(N, Math.ceil(yb * N));
    for (let r = ri0; r < ri1; r++) for (let c = ci0; c < ci1; c++) grid[r * N + c] = 1;
  }
  let filled = 0;
  for (let i = 0; i < grid.length; i++) filled += grid[i];
  return (filled / (N * N)) * dz * dy;
}

/** Total unit bounds in metres, including mirrored copies. */
export function unitBounds(list: UnitMassList): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const m of expandMasses(list.masses)) {
    const e = massExtents(m);
    for (const sgn of m.mirrorX ? [1, -1] : [1]) {
      const c = [m.anchor[0] * sgn, m.anchor[1], m.anchor[2]];
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], c[a] - e[a] * 0.5);
        max[a] = Math.max(max[a], c[a] + e[a] * 0.5);
      }
    }
  }
  return { min, max };
}

/* ==========================================================================
 * 4b. THE BOXINESS GATE
 *
 * "Our models are too rectangular, like old-school 3D models." That verdict has
 * to become a number, or the next roster drifts straight back to it.
 *
 * TWO MEASUREMENTS, because either one alone is gameable:
 *
 *   axisFraction  the share of the primary masses' FLANK surface — everything
 *                 whose normal is more horizontal than vertical — that lies on
 *                 an axis-aligned plane. A raw box is 1.00; a chamfer barely
 *                 moves it, because the chamfer is a thin strip; a tapered or
 *                 sheared hull is 0.00 because its walls are no longer vertical
 *                 planes; a lathed turret is 0.00; an octagonal Soviet slab is
 *                 ~0.80 because half its plan is still four flat walls.
 *
 *                 DECKS ARE DELIBERATELY EXCLUDED. The first version of this
 *                 metric counted total surface and every vehicle scored ~0.80,
 *                 because a tank hull is mostly a big flat horizontal deck and
 *                 an equally big underside — and so is an RA3 tank. Nobody has
 *                 ever called a model boxy because its deck was flat. The
 *                 complaint is always about the SIDES.
 *
 *   rectFill      how much of its own bounding rectangle the unit's side
 *                 elevation fills. One box fills 1.00. A tank with proud tracks,
 *                 a sloped glacis and an oversized turret fills ~0.55.
 *
 * Neither is a moral judgement on its own: a naval hull SHOULD fill its
 * rectangle. It is the pair, weighted, that says "this silhouette is a
 * rectangle made of rectangles".
 *
 * Everything here is analytic — it reads the mass parameters, not a built mesh —
 * so the gate runs in a test with no GL context, and a def author gets the
 * number back before a single triangle exists.
 * ========================================================================== */

/**
 * The band. `warn` is where a critic starts calling a unit blocky; `reject` is
 * where it is indefensible — essentially a stack of unmodified boxes.
 *
 * NOTE FOR THE INTEGRATOR: these belong in `core/config.ts` next to
 * `UNIT_VALIDATION` (suggested key `UNIT_VALIDATION.boxiness`). They live here
 * only because config.ts is owned by another agent this round.
 */
export const BOXINESS = {
  /** Weight on the axis-aligned surface share. */
  axisWeight: 0.62,
  /** Weight on the silhouette rectangle fill. */
  rectWeight: 0.38,
  /*
   * THESE NUMBERS WERE A SAFETY NET STRUNG ABOVE THE CEILING.
   *
   * They were `warn: 0.68 / axisWarn: 0.85`, `reject: 0.86 / axisReject: 0.90`,
   * while the boxiest unit in the entire game measured 0.564 / 0.415. The gate
   * could not fire against anything that existed. That is why the Meridian
   * infantry passed CI at 0.305 / 0.173 — visibly the most rectangular troops in
   * the game, and a player reported them as exactly that — with every test green.
   *
   * A threshold nothing can reach does not measure quality, it certifies it.
   *
   * WARN and REJECT now do different jobs, deliberately:
   *
   *   REJECT is the catastrophe floor — "a regression to three plain boxes
   *   cannot ship", which is what §4b promises. `axisReject` is 0.85 so it
   *   states CLAUDE.md's rule EXACTLY ("rejects any model whose silhouette is
   *   more than ~85% axis-aligned rectangle") rather than approximately; it used
   *   to sit at 0.90, above the very number it was quoting.
   *
   *   WARN is the quality target, and it is a live CI gate rather than a console
   *   message: `faction3.spec.ts`, `faction4-art.spec.ts` and
   *   `unit-silhouette.spec.ts` all assert `stats.warnings` is EMPTY, so
   *   crossing it fails the build.
   *
   * Both are derived from the measured roster below, not chosen. The worst unit
   * in the game is 0.417 / 0.149, so `warn` sits ~0.08 above it on score and
   * ~0.10 on axis — enough room to author in, little enough that a real
   * regression trips it. Before this, a unit had to get 0.70 WORSE on the axis
   * metric before anything noticed.
   *
   * If you raise these, say why in the same commit. Raising a threshold to make
   * a red build green is how the old numbers got where they were.
   */
  /** Blended score above which a warning is printed — and CI fails. */
  warn: 0.50,
  /** Blended score above which `validateUnit` rejects the model outright. */
  reject: 0.70,
  /**
   * The axis sub-metric, applied directly so a unit cannot pass by being a very
   * flat rectangle that happens to score a low fill.
   */
  axisWarn: 0.25,
  /** CLAUDE.md's "~85% axis-aligned rectangle", stated exactly. */
  axisReject: 0.85,
} as const;

/**
 * Where the roster sits, measured, so the next author knows what "good" looks
 * like without running anything. Score, then the axis sub-metric:
 *
 * Measured across all 65 units in all four armies, by `npx vite-node
 * tools/boxscan.ts` — the command exists so this table can be regenerated
 * rather than remembered. Worst first:
 *
 *   allied_prism          0.417 / 0.118   <- the whole game's ceiling
 *   allied_harvester      0.409 / 0.149   <- the whole game's worst axis
 *   soviet_v4             0.407 / 0.132
 *   soviet_harvester      0.406 / 0.144
 *   soviet_apocalypse     0.390 / 0.130
 *   allied_guardian       0.389 / 0.132
 *   soviet_rhino          0.388 / 0.131
 *   allied_ifv            0.388 / 0.121
 *   allied_dozer          0.383 / 0.146
 *   soviet_dozer          0.380 / 0.142
 *   ------------------------------------ every other unit: axis EXACTLY 0.000
 *   meridian_zenith       0.339 / 0.000
 *   meridian_collector    0.310 / 0.000
 *   allied_vindicator     0.275 / 0.000   aircraft — every primary a tapered box
 *   reclaim_slaghurler    0.275 / 0.000
 *   allied_destroyer      0.241 / 0.000
 *   soviet_dreadnought    0.236 / 0.000
 *   meridian_hierarch     0.229 / 0.000
 *   soviet_sickle         0.223 / 0.000
 *   soviet_engineer       0.215 / 0.000   the Soviet half of the shared def
 *   allied_rifle          0.201 / 0.000
 *   allied_engineer       0.169 / 0.000
 *   reclaim_baron         0.162 / 0.000   the least boxy unit in the game
 *
 * THE PREVIOUS TABLE WAS STALE IN BOTH DIRECTIONS and had been for a long time.
 * It listed `soviet_v4 0.79 / 0.75 WARN`, `soviet_rhino 0.73 / 0.70 WARN` and
 * `soviet_harvester 0.69 / 0.62 WARN` — three units it said "a critic points at
 * first" — against real values of 0.407, 0.388 and 0.406, none of which warn or
 * ever did at the old thresholds. It also had `allied_destroyer 0.53 / 0.47`
 * against a real 0.241 / 0.000. Every number in it was wrong, and it is the
 * table a def author reads to learn what "good" looks like.
 *
 * Read the shape of the list, not just the numbers: after v1.29.0 the ONLY
 * axis-aligned flank surface left anywhere in the game is on ten Allied/Soviet
 * ground vehicles, at 0.118-0.149. Every infantryman, aircraft, ship, walker and
 * both newer armies measure exactly 0.000.
 *
 * THIS PARAGRAPH USED TO END "If you are looking for the next piece of art work,
 * it is the top ten rows." IT IS NOT ART WORK, and that sentence sent at least
 * one author down it before anyone measured. Those ten rows are the ten TRACKED
 * vehicles — the only tracked vehicles in the game, because the Pact hovers and
 * the Reclamation walks — and every one of them holds its whole axis-aligned
 * figure in ONE mass, its `track`, at a flat share of exactly 0.420 on all ten.
 * That 0.420 is `case 'tracks'` below. It does not read `size`, `wheels`,
 * `skirtHeight`, `sprocketScale`, `returnRollers` or `segments`, so no field an
 * author can write in `UnitDefs.ts` moves it by any amount.
 *
 * Their actual art is finished. All seventeen load-bearing `taperedBox` and
 * `planPrism` masses across the ten were re-checked on the BUILT MESH and every
 * one has zero dead-vertical flank, with ring separations of 5.7% to 23.6%;
 * `tests/unit-silhouette.spec.ts` asserts it per mass. There is nothing left on
 * them to taper.
 *
 * And the constant itself does not match the mesh it says it came from — 0.42
 * modelled against 0.78-0.82 measured, over a modelled area 1.5-2.1x short.
 * `tests/flank-model.spec.ts` runs that comparison and pins it. Fixing it is a
 * change to `massFlankSurface` and to `trackAssemblyMesh`, not to a mass list,
 * and it moves every number in the table above.
 *
 * Regenerate with `npx vite-node tools/boxscan.ts` rather than editing a number
 * here by hand. That tool is committed precisely because the table above rotted:
 * a list of measurements nobody can reproduce in one command is a list of
 * measurements that will be wrong again by the next release. Note what it cannot
 * tell you, though: it reports the model, and the model is what was wrong here.
 */

/** Cosine of the angle a normal may stray and still count as axis-aligned. */
const AXIS_COS = Math.cos(6 * Math.PI / 180);

/**
 * A mass's FLANK surface, in its own local frame, split three ways.
 *
 *   x  area of flat walls whose normal is the local +-X axis
 *   z  area of flat walls whose normal is the local +-Z axis
 *   other  every other horizontal-facing square metre: tapered walls, cut
 *          corners, lathe facets, hull bevels, chamfer strips
 *
 * Raw square metres, not fractions, so `boxiness` can weight several masses
 * against each other honestly. Vertical-facing surface (decks and undersides)
 * is not counted at all — see the section header for why.
 */
export interface FlankSurface { x: number; z: number; other: number; }

const ZERO_FLANK: FlankSurface = { x: 0, z: 0, other: 0 };

/**
 * Solve one mass's flank surface analytically.
 *
 * The box family is exact: four inset walls, four vertical chamfer strips, and
 * whatever the corner cut takes out of the walls. Taper and shear tilt the walls
 * they affect and those walls move wholesale into `other`, which is why
 * `taperedBox` scores so much better than `chamferBox` and why it is the default
 * hull primitive in the worked examples.
 */
export function massFlankSurface(m: MassDef, chamfer: number): FlankSurface {
  const [w, h, d] = m.size;
  const s = m.shape;

  switch (m.primitive) {
    case 'lathe':
    case 'revolve':
    case 'cylinder':
    case 'cone': {
      // A faceted revolve has no flat wall at all, at any segment count.
      const r = Math.min(w, d) * 0.5;
      return { x: 0, z: 0, other: 2 * Math.PI * r * Math.max(1e-4, h) };
    }

    case 'prism':
    case 'planPrism': {
      const plan = m.primitive === 'prism'
        ? planPolygon(m.plan ?? 'octagon', m.cornerCut ?? 0).map((p): ShapeV2 => [p[0] * w, p[1] * d])
        : (s?.plan ?? rectOutline(w, d));
      const wallH = Math.max(1e-4, h - chamfer * 2);
      const tapered = (s?.topScaleX ?? 1) !== 1 || (s?.topScaleZ ?? 1) !== 1
        || (s?.bottomScaleX ?? 1) !== 1 || (s?.bottomScaleZ ?? 1) !== 1 || (s?.shear ?? 0) !== 0;
      let x = 0, z = 0, other = 0;
      for (let i = 0; i < plan.length; i++) {
        const a = plan[i], b = plan[(i + 1) % plan.length];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-9) continue;
        const area = len * wallH;
        // Outward normal of a CCW-from-above edge is (dz, -dx). A cut corner
        // lands in `other`, which is exactly the point of cutting it.
        const nx = dz / len, nz = -dx / len;
        if (tapered) other += area;
        else if (Math.abs(nx) >= AXIS_COS) x += area;
        else if (Math.abs(nz) >= AXIS_COS) z += area;
        else other += area;
      }
      // The top and bottom rim chamfers are half horizontal-facing.
      let per = 0;
      for (let i = 0; i < plan.length; i++) {
        const a = plan[i], b = plan[(i + 1) % plan.length];
        per += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      other += per * chamfer * Math.SQRT2;
      return { x, z, other };
    }

    case 'plate': {
      // A plate's flank is its rim, and the rim is all bevel. Its VALUE is that
      // it is almost always mounted at an angle — the rotation term below is
      // where a layered plate actually earns its keep.
      const outline = s?.outline ?? rectOutline(w, d);
      let per = 0;
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i], b = outline[(i + 1) % outline.length];
        per += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      return { x: 0, z: 0, other: per * Math.max(1e-4, h) };
    }

    // Assemblies. The splits are measured off the built meshes with
    // `Shapes.axisAlignedFraction` restricted to horizontal-facing polygons,
    // not guessed: a track run really is ~38% flat wall (the band's two faces),
    // and the wheels, sprocket, idler, teeth and skirt are the rest.
    case 'hull': {
      const per = 2 * (Math.max(1e-4, w) + Math.max(1e-4, d));
      return { x: 0, z: 0, other: per * Math.max(1e-4, h) * 0.85 };
    }
    case 'extrude': {
      const per = Math.PI * (Math.max(1e-4, w) + Math.max(1e-4, h)) * 0.5;
      return { x: 0, z: 0, other: per * Math.max(1e-4, d) };
    }
    case 'greebleStrip': {
      const a = 2 * Math.max(1e-4, d) * Math.max(1e-4, h);
      return { x: a * 0.10, z: a * 0.06, other: a * 0.84 };
    }
    case 'tracks': {
      const band = 2 * Math.max(1e-4, d) * Math.max(1e-4, h);
      return { x: band * 0.38, z: band * 0.04, other: band * 0.58 };
    }

    default: {
      // box / chamferBox / taperedBox, solved exactly.
      const c = Math.min(chamfer, Math.min(w, h, d) * UNIT_GEOMETRY.chamferMaxFractionOfMin);
      const iw = Math.max(0, w - 2 * c), ih = Math.max(0, h - 2 * c), id = Math.max(0, d - 2 * c);
      const wallX = 2 * ih * id, wallZ = 2 * iw * ih;

      // Legacy `taper` is [topScaleX, topScaleZ, topOffsetZ]; the new `shape`
      // fields say the same thing more explicitly.
      const tsx = m.taper?.[0] ?? s?.topScaleX ?? 1;
      const tsz = m.taper?.[1] ?? s?.topScaleZ ?? 1;
      const toz = m.taper?.[2] ?? s?.shear ?? 0;
      const bsx = s?.bottomScaleX ?? 1;
      const bsz = s?.bottomScaleZ ?? 1;
      const xFlat = tsx === 1 && bsx === 1;
      const zFlat = tsz === 1 && bsz === 1 && toz === 0;

      // A corner cut takes a diagonal slice out of both wall pairs and turns it
      // into a fifth, sixth, seventh and eighth wall that face nothing.
      const cut = m.primitive === 'box' ? 0 : (s?.cornerCut ?? (Math.min(w, d) >= 0.60 ? c : 0));
      const cutLoss = cut > 0 ? Math.min(0.5, (cut * 2) / Math.max(1e-6, Math.min(w, d))) : 0;
      const cutArea = (wallX + wallZ) * cutLoss;
      // Four vertical chamfer strips plus the horizontal-facing half of the
      // eight rim strips.
      const strips = 4 * Math.SQRT2 * c * ih + 2 * Math.SQRT2 * c * (iw + id);

      return {
        x: xFlat ? wallX * (1 - cutLoss) : 0,
        z: zFlat ? wallZ * (1 - cutLoss) : 0,
        other: (xFlat ? 0 : wallX) + (zFlat ? 0 : wallZ) + cutArea + strips,
      };
    }
  }
}

/**
 * The share of one mass's flank surface that is a flat, world-axis-aligned wall.
 *
 * Rotation is applied here, and it is a real de-boxifier: a wall whose normal
 * ends up 12 degrees off the world axis is not a flat rectangle to the eye any
 * more. Rotating the mass about Y also SWAPS which local axis is flat, and this
 * handles that correctly rather than assuming.
 */
export function massAxisAlignedFraction(m: MassDef, chamfer: number): number {
  const a = massFlankSurface(m, chamfer);
  const total = a.x + a.z + a.other;
  if (!(total > 1e-9)) return 0;
  const rot = eulerMatrix(m.rot as [number, number, number] | undefined);
  // Column j of the row-major matrix is the world direction of local axis j. A
  // wall stays "flat and axis-aligned" only if its normal lands back on a world
  // axis AND that axis is horizontal — a wall tipped up to face the sky is a
  // roof, and roofs are not what makes a model look boxy.
  const flat = (j: number): boolean => {
    const v: [number, number, number] = [rot[j], rot[3 + j], rot[6 + j]];
    return Math.max(Math.abs(v[0]), Math.abs(v[2])) >= AXIS_COS;
  };
  return ((flat(0) ? a.x : 0) + (flat(2) ? a.z : 0)) / total;
}

export interface BoxinessReport {
  /** Area-weighted axis-aligned surface share over the primary masses. */
  axisFraction: number;
  /** Side-elevation silhouette fill of its own bounding rectangle. */
  rectFill: number;
  /** The combined score the gate is applied to. 1.0 is a plain box. */
  score: number;
  /** The primary mass contributing the most axis-aligned area. */
  worst: string;
  worstFraction: number;
}

/**
 * Measure a unit's boxiness. Pure arithmetic over the mass parameters — no
 * mesh, no GL, no texture.
 */
export function boxiness(list: UnitMassList, faction: UnitMassList['faction'] = list.faction): BoxinessReport {
  const masses = expandMasses(list.masses);
  let flat = 0, total = 0;
  let worst = '(none)', worstFraction = 0, worstArea = 0;
  for (const m of masses) {
    if (m.role !== MassRole.Primary) continue;
    const c = defaultChamfer(m, faction);
    const a = massFlankSurface(m, c);
    const t = a.x + a.z + a.other;
    if (!(t > 1e-9)) continue;
    // Mirrored pairs are two real walls, and two flat walls are twice as boxy
    // as one, so unlike the silhouette metrics this one does count both.
    const mult = m.mirrorX === true ? 2 : 1;
    const f = massAxisAlignedFraction(m, c);
    flat += f * t * mult;
    total += t * mult;
    if (f * t * mult > worstArea) { worstArea = f * t * mult; worst = m.name; worstFraction = f; }
  }
  const axisFraction = total > 1e-9 ? flat / total : 0;

  const bb = unitBounds(list);
  const rect = Math.max(1e-6, (bb.max[1] - bb.min[1]) * (bb.max[2] - bb.min[2]));
  const rectFill = Math.min(1, silhouetteArea(list, bb.min, bb.max) / rect);

  return {
    axisFraction,
    rectFill,
    score: axisFraction * BOXINESS.axisWeight + rectFill * BOXINESS.rectWeight,
    worst,
    worstFraction,
  };
}

/* ==========================================================================
 * 5. THE VALIDATOR — R8 and R12, enforced
 * ========================================================================== */

/** Surface area in square metres per atlas slot, measured off the built mesh. */
export type SlotAreas = Partial<Record<SlotName, number>>;

export interface MassStats {
  key: string;
  cls: UnitClass;
  primaryCount: number;
  greebleCount: number;
  /** Largest single mass as a fraction of total side-projected area. */
  dominantFraction: number;
  dominantName: string;
  /** Centre of the DOMINANT mass, as a fraction of unit height. */
  dominantCentreY: number;
  /** Area-weighted centroid over every mass. Diagnostic only — see config. */
  centroidY: number;
  /** Turret width over hull width. 0 when the unit has no turret. */
  turretWidthRatio: number;
  /** Fraction of total surface area painted in the team colour. */
  teamFraction: number;
  insigniaCount: number;
  /** Fraction of total surface area that actually emits. */
  emissiveFraction: number;
  paintFraction: number;
  bareMetalFraction: number;
  /** How much of the silhouette is an axis-aligned rectangle. See §4b. */
  boxiness: BoxinessReport;
  /** Metres: width, height, length. */
  bounds: [number, number, number];
  /** Total surface area in square metres. */
  surfaceArea: number;
  triangles: number;
  errors: string[];
  warnings: string[];
}

function band(v: number, lo: number, hi: number): boolean { return v >= lo && v <= hi; }
function pct(v: number): string { return `${(v * 100).toFixed(1)}%`; }

/**
 * The gate. `areas` comes from the built mesh (UnitFactory measures every
 * triangle), so team-colour coverage is a real surface measurement and not a
 * guess — which is exactly what R12's mitigation asks for.
 *
 * Errors are fatal in a dev build. Warnings are printed and shipped.
 */
export function validateUnit(
  list: UnitMassList,
  areas: SlotAreas,
  /** The same areas weighted by RTS-camera visibility. See `viewWeight`. */
  visible: SlotAreas,
  bounds: [number, number, number],
  triangles: number,
  emissiveTileCover: number,
): MassStats {
  const errors: string[] = [];
  const warnings: string[] = [];
  const V = UNIT_VALIDATION;

  // Attachments are first-class masses to everything below this line.
  list = expandUnit(list);

  /* -- silhouette (R8) --------------------------------------------------- */
  const primaries = list.masses.filter((m) => m.role === MassRole.Primary);
  const greebles = list.masses.filter((m) => m.role === MassRole.Greeble);
  // Repeated hardware (a road-wheel run) is ONE greeble object to the eye.
  const greebleObjects = new Set(greebles.map((m) => m.group ?? m.name)).size;

  if (!band(primaries.length, V.primaryMassMin, V.primaryMassMax)) {
    errors.push(
      `primary mass count ${primaries.length} outside ${V.primaryMassMin}-${V.primaryMassMax} ` +
      `(bible 5.3: 3-5 primary masses, never more than 6)`);
  }
  if (!band(greebleObjects, V.greebleMin, V.greebleMax)) {
    warnings.push(`greeble count ${greebleObjects} outside ${V.greebleMin}-${V.greebleMax}`);
  }

  const bb = unitBounds(list);
  const silhouette = Math.max(1e-6, silhouetteArea(list, bb.min, bb.max));
  let sumArea = 0;
  let dominant = primaries[0] ?? list.masses[0];
  let dominantArea = 0;
  let moment = 0;
  for (const m of list.masses) {
    const a = massProjectedArea(m);
    sumArea += a;
    moment += a * m.anchor[1];
    if (m.role === MassRole.Primary && a > dominantArea) { dominantArea = a; dominant = m; }
  }
  const height = Math.max(1e-6, bounds[1]);
  // Heights are measured from the unit's OWN floor, not from y=0: an aircraft
  // parked on its gear has a floor well above the ground plane.
  const floor = bb.min[1];
  const dominantFraction = Math.min(1, dominantArea / silhouette);
  const dominantCentreY = dominant ? (dominant.anchor[1] - floor) / height : 0;
  const centroidY = sumArea > 0 ? (moment / sumArea - floor) / height : 0;

  if (!band(dominantFraction, V.dominantFractionMin, V.dominantFractionMax)) {
    errors.push(
      `dominant mass "${dominant?.name}" is ${pct(dominantFraction)} of the silhouette, ` +
      `outside ${pct(V.dominantFractionMin)}-${pct(V.dominantFractionMax)}`);
  }
  // Bible 5.3's top-heavy rule is written about ground units ("superstructure
  // occupies the top 55-65%, chassis is a thin 35-45% base"). It does not
  // transfer: an aircraft's fuselage sits at the middle of its own silhouette
  // by definition, and a ship's dominant mass is its hull, at the waterline. So
  // `air` and `naval` are exempt from this one check and are held to the
  // dominant-fraction, mass-count, team-colour and insignia rules like
  // everything else.
  const topHeavyApplies = list.cls !== 'air' && list.cls !== 'naval';
  if (topHeavyApplies && !band(dominantCentreY, V.dominantCentreMin, V.dominantCentreMax)) {
    errors.push(
      `dominant mass centre sits at ${pct(dominantCentreY)} of height, outside ` +
      `${pct(V.dominantCentreMin)}-${pct(V.dominantCentreMax)} — the unit is not top-heavy`);
  }

  /* -- boxiness (the de-boxify gate, §4b) -------------------------------- */
  const box = boxiness(list);
  const REMEDY =
    'Fix a primary mass, not a greeble: taper it, shear its top face back into a glacis, ' +
    'cut its vertical corners, lathe it, or hull it — then layer plates over it for the surface read.';
  if (box.score > BOXINESS.reject || box.axisFraction > BOXINESS.axisReject) {
    errors.push(
      `boxiness ${pct(box.score)} / axis-aligned surface ${pct(box.axisFraction)} exceeds the ` +
      `${pct(BOXINESS.reject)} / ${pct(BOXINESS.axisReject)} ceiling ` +
      `(silhouette rectangle fill ${pct(box.rectFill)}). The flattest primary mass is "${box.worst}" ` +
      `at ${pct(box.worstFraction)}. ${REMEDY}`);
  } else if (box.score > BOXINESS.warn || box.axisFraction > BOXINESS.axisWarn) {
    warnings.push(
      `boxiness ${pct(box.score)} (axis ${pct(box.axisFraction)}, rect fill ${pct(box.rectFill)}) is above the ` +
      `${pct(BOXINESS.warn)} / ${pct(BOXINESS.axisWarn)} target; "${box.worst}" is the flattest primary mass`);
  }

  /* -- turret (bible 5.3: build turrets deliberately too big) ------------ */
  // Hull width includes mirrored pairs (a track set spans both sides); turret
  // width is the widest single turret-riding primary mass.
  let turretWidth = 0, hullWidth = 0;
  for (const m of list.masses) {
    if (m.role !== MassRole.Primary) continue;
    const ex = massExtents(m)[0];
    if (m.turret) {
      turretWidth = Math.max(turretWidth, m.mirrorX ? Math.abs(m.anchor[0]) * 2 + ex : ex);
    } else {
      hullWidth = Math.max(hullWidth, m.mirrorX ? Math.abs(m.anchor[0]) * 2 + ex : ex);
    }
  }
  const turretWidthRatio = turretWidth > 0 && hullWidth > 0 ? turretWidth / hullWidth : 0;
  if (list.turretPivot !== undefined) {
    if (turretWidth === 0) {
      errors.push('turretPivot is set but no primary mass is flagged turret:true');
    } else if (!band(turretWidthRatio, V.turretWidthMin, V.turretWidthMax)) {
      errors.push(
        `turret/hull width ${turretWidthRatio.toFixed(2)} outside ` +
        `${V.turretWidthMin}-${V.turretWidthMax} (a real MBT is 0.55; RA3 is not real)`);
    }
  }

  /* -- team colour (R12 / R-T1 / R-T4) ----------------------------------- */
  // `areas` is real triangle area off the built mesh, not an estimate. That is
  // what makes R12's "assert the resulting surface-area fraction" meaningful.
  let surfaceArea = 0;
  for (const k of Object.keys(areas) as SlotName[]) surfaceArea += areas[k] ?? 0;
  surfaceArea = Math.max(1e-6, surfaceArea);

  // Every SHARE below is measured in screen-projected area, because every rule
  // it enforces (R-T1, R-T5, bible 5.4's surface shares) is scored from a
  // screenshot. Raw surface area counts a track's hidden inboard wall and a
  // slab's back face, and under-weights the decks the camera actually sees.
  let visibleArea = 0;
  for (const k of Object.keys(visible) as SlotName[]) visibleArea += visible[k] ?? 0;
  visibleArea = Math.max(1e-6, visibleArea);

  const teamArea = visible.teamSlab ?? 0;
  const insigniaArea = visible.insignia ?? 0;
  const emissiveArea = (visible.emissive ?? 0) * emissiveTileCover;
  const paintArea =
    (visible.paintLarge ?? 0) + (visible.paintMed ?? 0) + (visible.paintSmall ?? 0) +
    (visible.paintTiny ?? 0) + (visible.hatch ?? 0) + (visible.vent ?? 0) +
    (visible.stencil ?? 0) + (visible.rivetPlate ?? 0);
  const metalArea = (visible.bareMetal ?? 0) + (visible.tread ?? 0) + (visible.grille ?? 0);

  const teamFraction = teamArea / visibleArea;
  const emissiveFraction = emissiveArea / visibleArea;
  const teamBand = (list.cls === 'infantry' || list.cls === 'walker')
    ? V.teamFractionInfantry : V.teamFractionVehicle;

  if (list.faction !== 'neutral' && !band(teamFraction, teamBand[0], teamBand[1])) {
    errors.push(
      `team colour is ${pct(teamFraction)} of surface, outside ${pct(teamBand[0])}-${pct(teamBand[1])} ` +
      `(R-T1). Team colour is flat slabs, never a hull tint.`);
  }

  const insigniaCount = list.masses.filter((m) => m.role === MassRole.Insignia).length;
  if (list.faction !== 'neutral' && insigniaCount !== V.insigniaCount) {
    errors.push(`${insigniaCount} insignia decals; R-T4 requires exactly ${V.insigniaCount}`);
  }
  if (insigniaArea > visibleArea * 0.05) {
    warnings.push(`insignia plate is ${pct(insigniaArea / visibleArea)} of the visible surface — R-T4 wants 8-14% of hull WIDTH, not area`);
  }

  if (emissiveArea > 0 && !band(emissiveFraction, V.emissiveFraction[0], V.emissiveFraction[1])) {
    warnings.push(
      `emissive is ${pct(emissiveFraction)} of surface, outside ` +
      `${pct(V.emissiveFraction[0])}-${pct(V.emissiveFraction[1])} (R-T5)`);
  }

  const paintFraction = paintArea / visibleArea;
  const bareMetalFraction = metalArea / visibleArea;
  if (!band(paintFraction, V.paintFraction[0], V.paintFraction[1])) {
    warnings.push(`painted hull is ${pct(paintFraction)} of surface, bible 5.4 wants ${pct(V.paintFraction[0])}-${pct(V.paintFraction[1])}`);
  }
  // Bible 5.4's 12-20% bare-metal share is a statement about VEHICLES (barrels,
  // tracks, rollers). A rifleman carries one rifle and correctly measures ~4%.
  if (list.cls !== 'infantry' && !band(bareMetalFraction, V.bareMetalFraction[0], V.bareMetalFraction[1])) {
    warnings.push(`bare metal is ${pct(bareMetalFraction)} of surface, bible 5.4 wants ${pct(V.bareMetalFraction[0])}-${pct(V.bareMetalFraction[1])}`);
  }

  /* -- the scale ladder (R-S1..R-S4) ------------------------------------- */
  if (list.cls === 'vehicle' || list.cls === 'naval') {
    // A War Factory is 3 cells = 12 m on its long axis; R-S1 wants >= 0.45x.
    const productionLongAxis = 12;
    if (list.hullLength < productionLongAxis * 0.45 && list.cls === 'vehicle') {
      warnings.push(
        `hull ${list.hullLength} m is ${(list.hullLength / productionLongAxis).toFixed(2)}x a ` +
        `production structure footprint; R-S1 wants >= 0.45 (units are deliberately oversized)`);
    }
  }
  if (list.cls === 'infantry') {
    const ratio = bounds[1] / UNIT_LADDER.mbtHullMeters;
    if (!band(ratio, 0.30, 0.38)) {
      errors.push(`infantry is ${ratio.toFixed(2)}x an MBT hull tall; R-S4 wants 0.30-0.38`);
    }
  }

  /* -- sockets ------------------------------------------------------------ */
  const seen = new Set<string>();
  for (const s of list.sockets) {
    const id = `${s.part}|${s.turret ? 't' : 'h'}|${s.pos.join(',')}`;
    if (seen.has(id)) warnings.push(`duplicate socket at part ${s.part}`);
    seen.add(id);
    if (s.turret && list.turretPivot === undefined) {
      errors.push(`socket ${s.part} is turret-space but the unit has no turretPivot`);
    }
  }

  return {
    key: list.key,
    cls: list.cls,
    primaryCount: primaries.length,
    greebleCount: greebleObjects,
    dominantFraction,
    dominantName: dominant?.name ?? '(none)',
    dominantCentreY,
    centroidY,
    turretWidthRatio,
    teamFraction,
    insigniaCount,
    emissiveFraction,
    paintFraction,
    bareMetalFraction,
    boxiness: box,
    bounds,
    surfaceArea,
    triangles,
    errors,
    warnings,
  };
}

/** One line per unit, for the boot report and the critic loop. */
export function formatStats(s: MassStats): string {
  return (
    `${s.key.padEnd(20)} masses ${s.primaryCount}+${s.greebleCount}  ` +
    `dom ${pct(s.dominantFraction)}@${pct(s.dominantCentreY)}  ` +
    `turret ${s.turretWidthRatio.toFixed(2)}  ` +
    `team ${pct(s.teamFraction)}  emis ${pct(s.emissiveFraction)}  ` +
    `boxy ${pct(s.boxiness.score)}  ` +
    `${s.bounds.map((b) => b.toFixed(1)).join('x')} m  ${s.triangles} tris`
  );
}

/**
 * Default chamfer for a mass, in metres. Solved from the bible's PIXEL figure
 * (2-4 px at 29.6 px/m) rather than its fraction figure — see UNIT_GEOMETRY.
 * Never zero: a raw 90-degree edge is scorecard #11, an automatic fail.
 */
export function defaultChamfer(m: MassDef, faction: UnitMassList['faction']): number {
  const min = Math.max(1e-4, Math.min(m.size[0], m.size[1], m.size[2]));
  const frac = faction === 'soviets'
    ? UNIT_GEOMETRY.chamferFractionSoviets
    : UNIT_GEOMETRY.chamferFractionAllies;

  // The band. `cap` stops a chamfer rounding a part into a pill; `floor` is the
  // reason a razor edge is unauthorable. On a part thinner than 2 x MIN_CHAMFER
  // the cap wins, which is correct — a 7 cm team slab gets a 2 cm cut, not a
  // 3.5 cm one that would eat the whole plate.
  const cap = min * UNIT_GEOMETRY.chamferMaxFractionOfMin;
  const floor = Math.min(cap, MIN_CHAMFER);

  // An explicit chamfer is a REQUEST, not a command: `chamfer: 0` still lands on
  // the floor. There is deliberately no way to ask for a hard 90-degree edge —
  // that is scorecard #11, an automatic fail, and it is the single most common
  // way a model regresses to looking like 1998.
  const want = m.shape?.chamfer ?? m.chamfer ?? Math.max(UNIT_GEOMETRY.chamferMinMeters, min * frac);
  return Math.min(cap, Math.max(floor, want));
}

/* ==========================================================================
 * 7. THE CONSUMER CONTRACT
 *
 * Two functions and one rule. A factory that wants to build the new primitives
 * needs nothing else from this file.
 * ========================================================================== */

/**
 * How the built mesh should be fitted into the mass's `size` box.
 *
 * THE RULE THAT MAKES EVERYTHING ELSE WORK: `MassDef.size` is the authoritative
 * axis-aligned bounding box of EVERY mass, whatever primitive it is. The factory
 * builds the shape in its own coordinates and then calls `Shapes.fitMesh(mesh,
 * size, mode)`. Because of that, `massExtents`, `unitBounds`, `silhouetteArea`
 * and every band in `validateUnit` keep working without ever learning what a
 * convex hull is — which is why adding eight primitives did not touch a line of
 * the R8/R12 arithmetic.
 *
 * 'none' is for masses whose geometry is already authored in real metres and
 * already centred on the anchor: attached plates and greeble strips.
 */
export function shapeFitMode(m: MassDef): 'stretch' | 'uniform' | 'none' {
  return m.shape?.fit ?? 'stretch';
}

/**
 * THE INTEGRATION, for whoever owns `UnitFactory` / `BuildingFactory`:
 *
 *   const spec = shapeSpecFor(m, chamfer);
 *   if (spec !== null) {
 *     const fit = shapeFitMode(m);
 *     const built = shapeMesh(spec);
 *     // 'none' means DO NOT FIT — see `emitMassShape` below, which is the real
 *     // call site this example describes.
 *     const mesh = fit === 'none' ? built : fitMesh(built, m.size, fit);
 *     emitShape(mesh, sink);           // sink.quad / sink.tri -> MeshBuilder
 *   } else {
 *     // the existing buildBox / buildLathe / buildPrism path, untouched
 *   }
 *
 * That `fit === 'none'` branch is not decoration. This example used to read
 * `fitMesh(shapeMesh(spec), m.size, shapeFitMode(m))`, which does not even
 * COMPILE — `shapeFitMode` returns `'stretch' | 'uniform' | 'none'` and
 * `fitMesh` takes only the first two — and which would have squashed every
 * fit-exempt mass to its declared `size`. An agent writing a test against this
 * block copied it faithfully and inherited both bugs; the type error survived
 * because `npm test` and `npm run build` both strip types and only
 * `npm run typecheck` looks.
 *
 * `slotFor` is the ONE decision the factory owns, and there is exactly one rule
 * it must not get wrong: a polygon whose `kind` is 'bevel' samples the atlas's
 * FLAT BEVEL PATCH (`atlas.bevelUv[slot]`), never the tile itself. That patch is
 * where scorecard #11's 2-4 px highlight comes from; sampling the tile instead
 * turns every chamfer into a smeared panel line. Otherwise:
 *
 *   'cap'     -> `faceSlots[face] ?? m.capSlot ?? m.slot`
 *   'side'    -> `faceSlots[face] ?? (m.slot === 'paintLarge' ? paintSlotForArea(area) : m.slot)`
 *   'detail'  -> `m.slot`, and never a paint-density lookup: sub-greeble is small
 *                by construction and a density lookup would send it to paintTiny
 *                even when it is bare metal.
 *
 * `emitMassShape` below IS that integration, written once so `UnitFactory` and
 * `BuildingFactory` cannot drift apart on the bevel rule.
 */

/**
 * The two methods both mesh accumulators already expose. Structural on purpose:
 * `UnitFactory.MeshBuilder` and `BuildingFactory.MeshAcc` are private classes in
 * their own files and neither needs to be exported to satisfy this.
 */
export interface ShapeEmitTarget {
  addQuad(
    p0: ShapeV3, p1: ShapeV3, p2: ShapeV3, p3: ShapeV3, n: ShapeV3,
    r: UvRect, slot: SlotName,
  ): void;
  addTri(
    p0: ShapeV3, p1: ShapeV3, p2: ShapeV3, n: ShapeV3, slot: SlotName,
    uv0: readonly [number, number], uv1: readonly [number, number], uv2: readonly [number, number],
  ): void;
}

/** The atlas surface `emitMassShape` needs — the tile rects and the bevel patches. */
export interface ShapeEmitAtlas {
  readonly uv: Readonly<Record<SlotName, UvRect>>;
  readonly bevelUv: Readonly<Record<SlotName, UvRect>>;
}

/** Interpolate inside a UV rect. Duplicated from the factories on purpose: two lines. */
function rectUv(r: UvRect, u: number, v: number): [number, number] {
  return [r.u0 + (r.u1 - r.u0) * u, r.v0 + (r.v1 - r.v0) * v];
}

/**
 * Build one `ShapeSpec` mass into an accumulator, with the slot rules above.
 *
 * `autoPaintSlot` is the factory's density lookup — `Greeble.paintSlotForArea`
 * for units, `BuildingFactory.structurePaintSlot` for structures — and
 * `autoSlot` names the slot that opts into it ('paintLarge' / 'paintMed').
 *
 * The caller has already set the accumulator's transform, tint and (for
 * structures) feature channel, exactly as it does for the legacy primitives.
 */
export function emitMassShape(
  target: ShapeEmitTarget,
  atlas: ShapeEmitAtlas,
  m: MassDef,
  spec: ShapeSpec,
  autoPaintSlot: (areaSqM: number) => SlotName,
  autoSlot: SlotName,
): void {
  const fit = shapeFitMode(m);
  const built = shapeMesh(spec);
  const mesh = fit === 'none' ? built : fitMesh(built, m.size, fit);

  const slotFor = (kind: ShapeFaceKind, face: ShapeBoxFace | undefined, area: number): SlotName => {
    if (kind === 'bevel') return m.slot;
    const override = face !== undefined ? m.faceSlots?.[face] : undefined;
    if (override !== undefined) return override;
    if (kind === 'cap') return m.capSlot ?? m.slot;
    if (kind === 'detail') return m.slot;
    return m.slot === autoSlot ? autoPaintSlot(area) : m.slot;
  };

  emitShape(mesh, {
    quad: (p0, p1, p2, p3, n, kind, face, _group, area) => {
      // A bevel polygon samples the FLAT bevel patch, never the tile: that
      // patch is where the 2-4 px specular highlight of scorecard #11 lives.
      const slot = slotFor(kind, face, area);
      target.addQuad(p0, p1, p2, p3, n, kind === 'bevel' ? atlas.bevelUv[slot] : atlas.uv[slot], slot);
    },
    tri: (p0, p1, p2, n, uv0, uv1, uv2, kind, face, _group, area) => {
      const slot = slotFor(kind, face, area);
      const r = kind === 'bevel' ? atlas.bevelUv[slot] : atlas.uv[slot];
      target.addTri(
        p0, p1, p2, n, slot,
        rectUv(r, uv0[0], uv0[1]), rectUv(r, uv1[0], uv1[1]), rectUv(r, uv2[0], uv2[1]),
      );
    },
  });
}

/* ==========================================================================
 * 8. WORKED EXAMPLES
 *
 * Three conversions of existing roster entries into the new language. They are
 * real, complete, drop-in mass lists — not sketches — and the measured
 * before/after is in each header. Copy them; do not admire them.
 * ========================================================================== */

/** Normalised turret profile: wide chamfered base, sloped shoulder, flat roof. */
export const TURRET_PROFILE: readonly ShapeV2[] = [
  [0, 0], [0.44, 0], [0.50, 0.10], [0.50, 0.44], [0.34, 0.90], [0.29, 1.0], [0, 1.0],
];

/** Normalised faceted dome: cockpits, radomes, Soviet pressure caps. */
export const DOME_PROFILE: readonly ShapeV2[] = [
  [0, 0], [0.50, 0], [0.48, 0.26], [0.42, 0.52], [0.31, 0.76], [0.17, 0.93], [0, 1.0],
];

/** Normalised capsule: hemisphere, straight body, hemisphere. */
export const CAPSULE_PROFILE: readonly ShapeV2[] = [
  [0, 0], [0.28, 0.06], [0.42, 0.16], [0.50, 0.30],
  [0.50, 0.70], [0.42, 0.84], [0.28, 0.94], [0, 1.0],
];

/**
 * WORKED EXAMPLE 1 — A TANK. The Allied Guardian, rebuilt.
 *
 * What actually changed, in order of how much it bought:
 *   1. the hull became a `taperedBox` with `shear` — the top plate slides 0.4 m
 *      aft, so the front wall becomes a real glacis instead of a vertical brick
 *      face, and `cornerCut` makes the plan octagonal;
 *   2. the turret became a `revolve` on TURRET_PROFILE at 14 segments — the
 *      single biggest drop, because a lathed turret has no flat sides at all;
 *   3. the flat track slab became a `tracks` assembly: a stadium-section band
 *      with ROUND ends, five road wheels, a toothed sprocket, an idler, two
 *      return rollers and a skirt plate;
 *   4. `plates` layered over the hull and turret at three different angles,
 *      which is what carries the hi-tech surface read at gameplay zoom;
 *   5. the barrel became an `extrude` with a real step behind the muzzle brake.
 */
export const EXAMPLE_TANK: UnitMassList = (() => {
  const H = 2.50, L = 6.6, W = 3.2;
  const trackH = H * UNIT_LADDER.chassisHeightFraction * 0.55;
  const trackW = W * 0.30;
  const trackX = W * 0.5 + W * UNIT_GEOMETRY.trackOutboardFraction - trackW * 0.5;
  const hullH = H * 0.215;
  const hullY = trackH + hullH * 0.5;
  const deckY = trackH + hullH;
  const turretH = H * 0.50;
  const turretY = H * 0.655;
  const turretW = W * 0.86;
  const turretL = L * 0.74;
  const turretRoof = turretY + turretH * 0.5;
  const gunY = turretY + turretH * 0.06;

  const masses: MassDef[] = [
    /* -- 1. running gear, not a slab ------------------------------------ */
    {
      name: 'track', primitive: 'tracks', role: MassRole.Primary,
      size: [trackW, trackH, L * 0.94], anchor: [trackX, trackH * 0.5, 0],
      slot: 'tread', capSlot: 'bareMetal', mirrorX: true, group: 'running gear',
      shape: { wheels: 5, returnRollers: 2, sprocketScale: 0.94, skirtHeight: trackH * 0.46 },
    },

    /* -- 2. hull: tapered, sheared into a glacis, octagonal in plan ------ */
    {
      name: 'hull', primitive: 'taperedBox', role: MassRole.Primary,
      size: [W, hullH, L], anchor: [0, hullY, 0], slot: 'paintLarge',
      shape: { topScaleX: 0.88, topScaleZ: 0.90, shear: -L * 0.06, cornerCut: W * 0.055 },
      plates: [
        // The glacis: a trapezoid lying back 34 degrees over the bow.
        {
          name: 'hull.glacis', outline: taperOutline(W * 0.92, L * 0.34, 0.72),
          thickness: 0.09, offset: [0, hullH * 0.30, L * 0.30], rot: [-0.60, 0, 0],
          slot: 'paintMed', group: 'hull armour',
        },
        // Two flank plates, splayed 12 degrees, sitting proud of the wall.
        {
          name: 'hull.flankPlate', outline: taperOutline(L * 0.52, hullH * 1.10, 0.80),
          thickness: 0.07, offset: [W * 0.47, hullH * 0.06, -L * 0.04],
          rot: [0, Math.PI * 0.5, Math.PI * 0.5 - 0.21], mirrorX: true,
          slot: 'paintMed', group: 'hull armour',
        },
        // A deck plate over the engine bay, dropped 4 degrees toward the stern.
        {
          name: 'hull.deckPlate', rect: [W * 0.62, L * 0.30],
          thickness: 0.07, offset: [0, hullH * 0.52, -L * 0.28], rot: [0.07, 0, 0],
          slot: 'paintMed', group: 'hull armour',
        },
      ],
      greebles: [
        {
          name: 'hull.spineRun', length: L * 0.44, width: 0.22, height: 0.15, density: 2,
          offset: [-W * 0.30, hullH * 0.52, -L * 0.06], slot: 'bareMetal',
        },
      ],
    },

    /* -- 3. turret: lathed, 14 facets, no flat sides at all -------------- */
    {
      name: 'turret', primitive: 'revolve', role: MassRole.Primary,
      size: [turretW, turretH, turretL], anchor: [0, turretY, -L * 0.04],
      slot: 'paintLarge', capSlot: 'paintLarge', turret: true,
      shape: { profile: TURRET_PROFILE, segments: 14 },
      plates: [
        // Mantlet: the plate the gun comes through, stood almost vertical.
        {
          name: 'turret.mantlet', outline: taperOutline(turretW * 0.52, turretH * 0.86, 0.78),
          thickness: 0.11, offset: [0, turretH * 0.02, turretL * 0.40], rot: [-1.49, 0, 0],
          slot: 'bareMetal', group: 'turret armour',
        },
        // Cheek plates, splayed off the lathe so the turret is not a pure solid.
        {
          name: 'turret.cheek', outline: taperOutline(turretL * 0.46, turretH * 0.60, 0.74),
          thickness: 0.07, offset: [turretW * 0.40, turretH * 0.04, -turretL * 0.02],
          rot: [0, Math.PI * 0.5, Math.PI * 0.5 - 0.16], mirrorX: true,
          slot: 'paintMed', group: 'turret armour',
        },
      ],
    },

    /* -- 4. barrel: an extrude with a real step behind the brake --------- */
    {
      name: 'barrel', primitive: 'extrude', role: MassRole.Primary,
      size: [0.42, 0.42, L * 0.70], anchor: [0, gunY, turretL * 0.34], slot: 'bareMetal',
      turret: true,
      shape: {
        // A 10-sided section swept straight forward, stepping out at the brake.
        profile: [
          [0.21, 0], [0.17, 0.12], [0.06, 0.20], [-0.06, 0.20], [-0.17, 0.12],
          [-0.21, 0], [-0.17, -0.12], [-0.06, -0.20], [0.06, -0.20], [0.17, -0.12],
        ],
        path: [[0, 0, -1.0], [0, 0, 0.42], [0, 0, 0.58], [0, 0, 1.0]],
        scale: [1.0, 0.92, 1.34, 1.16],
        capStart: true, capEnd: true,
      },
    },
  ];

  /* -- greeble kit ------------------------------------------------------- */
  masses.push(
    {
      name: 'exhaust', primitive: 'cylinder', role: MassRole.Greeble,
      size: [0.26, 0.62, 0.26], anchor: [W * 0.34, deckY + 0.28, -L * 0.30],
      slot: 'bareMetal', mirrorX: true, shape: { segments: 12, rTop: 0.86 },
    },
    {
      name: 'stowage', primitive: 'chamferBox', role: MassRole.Greeble,
      size: [W * 0.30, 0.26, L * 0.16], anchor: [-W * 0.30, deckY + 0.13, -L * 0.36],
      slot: 'paintSmall', mirrorX: true, group: 'stowage',
    },
    {
      name: 'headlamp', primitive: 'chamferBox', role: MassRole.Greeble,
      size: [0.30, 0.24, 0.18], anchor: [W * 0.32, deckY - 0.05, L * 0.44],
      slot: 'paintTiny', mirrorX: true, faceSlots: { pz: 'glass' },
    },
    {
      name: 'towHook', primitive: 'chamferBox', role: MassRole.Greeble,
      size: [0.20, 0.16, 0.34], anchor: [W * 0.22, deckY - 0.24, L * 0.48],
      slot: 'bareMetal', mirrorX: true,
    },
    {
      name: 'cupola', primitive: 'revolve', role: MassRole.Greeble,
      size: [turretW * 0.30, H * 0.09, turretW * 0.30],
      anchor: [-turretW * 0.22, turretRoof + H * 0.045, -turretL * 0.16],
      slot: 'hatch', turret: true, shape: { profile: DOME_PROFILE, segments: 12 },
    },
    {
      name: 'aaMount', primitive: 'chamferBox', role: MassRole.Greeble,
      size: [0.14, 0.13, 0.72], anchor: [turretW * 0.26, turretRoof + H * 0.040, -turretL * 0.06],
      slot: 'bareMetal', turret: true, rot: [-0.10, 0.22, 0],
    },
    {
      name: 'turretBox', primitive: 'taperedBox', role: MassRole.Greeble,
      size: [turretW * 0.62, turretH * 0.34, turretL * 0.20],
      anchor: [0, turretY + turretH * 0.20, -turretL * 0.52],
      slot: 'paintSmall', turret: true, shape: { topScaleX: 0.84, topScaleZ: 0.88 },
    },
    {
      name: 'mast', primitive: 'cylinder', role: MassRole.Greeble,
      size: [0.07, H * 0.16, 0.07], anchor: [-turretW * 0.40, H - H * 0.08, -turretL * 0.34],
      slot: 'bareMetal', turret: true, shape: { segments: 8 },
    },
  );

  /* -- team colour, insignia, emissive: unchanged from the original ------ */
  const slabOf = (
    name: string, size: readonly [number, number, number],
    anchor: readonly [number, number, number], turret?: boolean, mirrorX?: boolean,
  ): MassDef => ({
    name, primitive: 'chamferBox', role: MassRole.TeamSlab, size, anchor,
    slot: 'teamSlab', chamfer: 0.02,
    ...(turret === true ? { turret: true } : {}),
    ...(mirrorX === true ? { mirrorX: true } : {}),
  });
  masses.push(
    slabOf('turretCheekBand', [0.07, turretH * 0.56, turretL * 0.56],
      [turretW * 0.5, turretY + turretH * 0.04, -turretL * 0.04], true, true),
    slabOf('hullFlankBand', [0.07, hullH * 0.62, L * 0.50], [W * 0.49, hullY, -L * 0.06], false, true),
    slabOf('turretCap', [turretW * 0.34, 0.07, turretL * 0.30],
      [-turretW * 0.16, turretRoof, -turretL * 0.02], true),
    slabOf('glacisBand', [W * 0.42, 0.07, L * 0.09], [0, deckY, L * 0.40]),
    {
      name: 'insignia', primitive: 'chamferBox', role: MassRole.Insignia,
      size: [turretW * 0.30, 0.06, turretW * 0.30],
      anchor: [turretW * 0.20, turretRoof + 0.02, turretL * 0.18],
      slot: 'insignia', chamfer: 0.02, turret: true,
    },
    {
      name: 'rearLamp', primitive: 'chamferBox', role: MassRole.Emissive,
      size: [0.40, 0.28, 0.06], anchor: [W * 0.28, deckY - 0.08, -L * 0.5],
      slot: 'emissive', chamfer: 0.02, mirrorX: true,
    },
    {
      name: 'deckStrip', primitive: 'chamferBox', role: MassRole.Emissive,
      size: [W * 0.62, 0.06, L * 0.17], anchor: [0, deckY + 0.02, -L * 0.40],
      slot: 'emissive', chamfer: 0.02,
    },
  );

  return {
    key: 'example_tank',
    name: 'Guardian Tank (hi-tech)',
    faction: 'allies',
    cls: 'vehicle',
    hullLength: L,
    turretPivot: [0, turretY, -L * 0.04],
    masses,
    sockets: [],
    hullNumber: 4172,
  };
})();

/**
 * WORKED EXAMPLE 2 — AN AIRCRAFT. The Vindicator, rebuilt.
 *
 * The fuselage is a `hull` — a convex point cloud with every edge bevelled —
 * which is the primitive that exists precisely for blended bodies. The wings
 * are `plate`s with a trapezoidal outline, swept 16 degrees and given 6 degrees
 * of dihedral, rather than rotated boxes. Nothing on this model has a flat side
 * except the tail planes, and those are plates too.
 */
export const EXAMPLE_AIRCRAFT: UnitMassList = (() => {
  const L = 11.0, S = 12.0, H = 3.0;
  const fuseH = H * 0.42;
  const fuseY = H * 0.655;
  const wingY = fuseY - fuseH * 0.18;

  const masses: MassDef[] = [
    {
      name: 'forwardFuselage', primitive: 'hull', role: MassRole.Primary,
      size: [S * 0.20, fuseH, L * 0.56], anchor: [0, fuseY, L * 0.16], slot: 'paintLarge',
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
      plates: [
        {
          name: 'fuse.chine', outline: taperOutline(L * 0.44, 0.34, 0.42),
          thickness: 0.05, offset: [S * 0.09, -fuseH * 0.06, 0],
          rot: [0, Math.PI * 0.5, Math.PI * 0.5 + 0.10],
          mirrorX: true, slot: 'paintMed', group: 'fuselage plating',
        },
      ],
    },
    {
      name: 'aftBoom', primitive: 'taperedBox', role: MassRole.Primary,
      size: [S * 0.16, fuseH * 0.78, L * 0.48], anchor: [0, fuseY - fuseH * 0.04, -L * 0.26],
      slot: 'paintMed',
      shape: { topScaleX: 0.66, topScaleZ: 0.60, shear: -L * 0.05, cornerCut: S * 0.02 },
    },
    {
      name: 'wing', primitive: 'plate', role: MassRole.Primary,
      size: [S * 0.42, H * 0.10, L * 0.32], anchor: [S * 0.26, wingY, -L * 0.06],
      slot: 'paintLarge', mirrorX: true,
      rot: [0, -0.28, 0.10],
      shape: {
        outline: [
          [S * 0.21, -L * 0.16], [S * 0.21, L * 0.02],
          [-S * 0.21, L * 0.16], [-S * 0.21, -L * 0.06],
        ],
        thickness: H * 0.10, fit: 'none',
      },
    },
    {
      name: 'tailFin', primitive: 'taperedBox', role: MassRole.Primary,
      size: [0.14, H * 0.30, L * 0.20], anchor: [0, H - H * 0.15, -L * 0.40], slot: 'paintMed',
      shape: { topScaleX: 0.70, topScaleZ: 0.55, shear: -L * 0.04 },
    },
  ];

  masses.push(
    {
      name: 'nose', primitive: 'cone', role: MassRole.Greeble,
      size: [S * 0.18, L * 0.22, fuseH * 0.92], anchor: [0, fuseY, L * 0.56], slot: 'paintMed',
      rot: [-Math.PI * 0.5, 0, 0], shape: { segments: 12, rTop: 0.22 },
    },
    {
      name: 'canopy', primitive: 'revolve', role: MassRole.Greeble,
      size: [S * 0.15, fuseH * 0.42, L * 0.24], anchor: [0, fuseY + fuseH * 0.42, L * 0.20],
      slot: 'glass', shape: { profile: DOME_PROFILE, segments: 12 },
    },
    {
      name: 'tailPlane', primitive: 'plate', role: MassRole.Greeble,
      size: [S * 0.18, 0.10, L * 0.14], anchor: [S * 0.11, fuseY + fuseH * 0.10, -L * 0.44],
      slot: 'paintSmall', mirrorX: true, rot: [0, -0.16, 0.06],
    },
    {
      name: 'intake', primitive: 'taperedBox', role: MassRole.Greeble,
      size: [S * 0.10, fuseH * 0.42, L * 0.16], anchor: [S * 0.13, fuseY - fuseH * 0.10, L * 0.06],
      slot: 'grille', mirrorX: true, shape: { topScaleX: 0.8, topScaleZ: 0.86, shear: -0.12 },
    },
    {
      name: 'gearPod', primitive: 'hull', role: MassRole.Greeble,
      size: [S * 0.08, H * 0.12, L * 0.12], anchor: [S * 0.12, fuseY - fuseH * 0.5, -L * 0.02],
      slot: 'paintTiny', mirrorX: true,
      shape: {
        points: [
          [0.4, 0.5, 0.6], [-0.4, 0.5, 0.6], [0.4, 0.5, -0.6], [-0.4, 0.5, -0.6],
          [0.28, -0.5, 0.34], [-0.28, -0.5, 0.34], [0.28, -0.5, -0.34], [-0.28, -0.5, -0.34],
        ],
        chamfer: 0.04,
      },
    },
    {
      name: 'pylon', primitive: 'chamferBox', role: MassRole.Greeble,
      size: [0.14, H * 0.10, L * 0.10], anchor: [S * 0.24, wingY - H * 0.07, -L * 0.04],
      slot: 'bareMetal', mirrorX: true,
    },
    {
      name: 'ordnance', primitive: 'cylinder', role: MassRole.Greeble,
      size: [0.26, L * 0.26, 0.26], anchor: [S * 0.24, wingY - H * 0.13, -L * 0.02],
      slot: 'bareMetal', mirrorX: true, rot: [Math.PI * 0.5, 0, 0],
      shape: { segments: 10, rTop: 0.72 },
    },
    {
      name: 'exhaustRing', primitive: 'cylinder', role: MassRole.Greeble,
      size: [S * 0.14, 0.24, S * 0.14], anchor: [0, fuseY, -L * 0.52], slot: 'bareMetal',
      rot: [Math.PI * 0.5, 0, 0], shape: { segments: 12 },
    },
  );

  const slabOf = (
    name: string, size: readonly [number, number, number],
    anchor: readonly [number, number, number], mirrorX?: boolean,
  ): MassDef => ({
    name, primitive: 'plate', role: MassRole.TeamSlab, size, anchor,
    slot: 'teamSlab', chamfer: 0.02, ...(mirrorX === true ? { mirrorX: true } : {}),
  });
  masses.push(
    slabOf('wingBand', [S * 0.22, 0.07, L * 0.11], [S * 0.28, wingY + H * 0.05, -L * 0.06], true),
    slabOf('finFlash', [0.07, H * 0.18, L * 0.10], [0.06, H - H * 0.16, -L * 0.40], true),
    slabOf('spine', [S * 0.08, 0.07, L * 0.24], [0, fuseY + fuseH * 0.5, -L * 0.06]),
    {
      name: 'insignia', primitive: 'plate', role: MassRole.Insignia,
      size: [S * 0.13, 0.06, S * 0.13], anchor: [S * 0.28, wingY + H * 0.06, -L * 0.06],
      slot: 'insignia', chamfer: 0.02,
    },
    {
      name: 'afterburner', primitive: 'chamferBox', role: MassRole.Emissive,
      size: [S * 0.13, 0.18, 0.06], anchor: [0, fuseY, -L * 0.56], slot: 'emissive', chamfer: 0.02,
    },
    {
      name: 'wingTipLight', primitive: 'chamferBox', role: MassRole.Emissive,
      size: [0.10, 0.22, L * 0.20], anchor: [S * 0.44, wingY + H * 0.02, -L * 0.06],
      slot: 'emissive', chamfer: 0.02, mirrorX: true,
    },
  );

  return {
    key: 'example_aircraft',
    name: 'Vindicator (hi-tech)',
    faction: 'allies',
    cls: 'air',
    hullLength: L,
    masses,
    sockets: [],
    hullNumber: 4172,
  };
})();

/**
 * WORKED EXAMPLE 3 — A BUILDING. An Allied power-plant body.
 *
 * `StructureMass extends MassDef`, so every primitive, `shape`, `plates` and
 * `greebles` field is already available to `BuildingDefs.ts` with no change to
 * `BuildingFactory`'s language. This is a mass ARRAY rather than a
 * `StructureMassList` only because that type lives in `BuildingFactory.ts` and
 * importing it here would close an import cycle.
 *
 * It is bible 5.7 ALLIED 1-5 built out of the new primitives: a splayed skirt
 * (base 1.32x wider than the top, wall slope 21 degrees), an open hex crown
 * (`planPrism` on a real hexagon), the banding strips as layered `plates`, and
 * a tapered cooling stack as a `cone`.
 */
export const EXAMPLE_STRUCTURE: readonly MassDef[] = (() => {
  const W = 12, D = 12, H = 8;
  const baseH = H * 0.52;
  const crownH = H * 0.30;
  const hex: readonly ShapeV2[] = [
    [3.0, 0], [1.5, 2.6], [-1.5, 2.6], [-3.0, 0], [-1.5, -2.6], [1.5, -2.6],
  ];

  return [
    {
      name: 'base', primitive: 'taperedBox', role: MassRole.Primary,
      size: [W, baseH, D], anchor: [0, baseH * 0.5, 0], slot: 'paintLarge',
      shape: {
        // ALLIED-1: the base flares 1.32x wider than the top.
        topScaleX: 1 / 1.32, topScaleZ: 1 / 1.32,
        cornerCut: W * 0.08,
      },
      plates: [
        // ALLIED-5: three horizontal banding strips of alternating depth.
        {
          name: 'base.band0', rect: [W * 1.02, D * 1.02], thickness: 0.22,
          offset: [0, -baseH * 0.22, 0], slot: 'paintMed', group: 'banding',
        },
        {
          name: 'base.band1', rect: [W * 0.94, D * 0.94], thickness: 0.16,
          offset: [0, baseH * 0.04, 0], slot: 'paintMed', group: 'banding',
        },
        {
          name: 'base.band2', rect: [W * 0.86, D * 0.86], thickness: 0.20,
          offset: [0, baseH * 0.30, 0], slot: 'paintMed', group: 'banding',
        },
      ],
      greebles: [
        {
          name: 'base.conduitRun', length: D * 0.72, width: 0.34, height: 0.26, density: 2.5,
          offset: [W * 0.40, baseH * 0.16, 0], mirrorX: true, slot: 'bareMetal',
        },
      ],
    },
    {
      name: 'crown', primitive: 'planPrism', role: MassRole.Primary,
      size: [6.0, crownH, 5.2], anchor: [0, baseH + crownH * 0.5, 0],
      slot: 'paintLarge', capSlot: 'grille',
      // ALLIED-2: an open hex prism crown at 0.50x base width.
      shape: { plan: hex, topScaleX: 0.92, topScaleZ: 0.92 },
    },
    {
      name: 'coolingStack', primitive: 'cone', role: MassRole.Primary,
      size: [2.4, H * 0.34, 2.4], anchor: [W * 0.24, baseH + H * 0.17, -D * 0.24],
      slot: 'paintMed', shape: { segments: 14, rTop: 0.62 },
    },
    {
      name: 'ductBridge', primitive: 'extrude', role: MassRole.Greeble,
      size: [1.0, 1.0, 6.4], anchor: [-W * 0.20, baseH + 0.9, 0], slot: 'bareMetal',
      shape: {
        profile: [[0.36, 0], [0.18, 0.31], [-0.18, 0.31], [-0.36, 0], [-0.18, -0.31], [0.18, -0.31]],
        path: [[0, 0, -3.2], [0, 0.5, -1.0], [0, 0.5, 1.0], [0, 0, 3.2]],
        capStart: true, capEnd: true,
      },
    },
    {
      name: 'vessel', primitive: 'revolve', role: MassRole.Greeble,
      size: [2.0, 2.4, 2.0], anchor: [-W * 0.30, baseH + 1.2, D * 0.28], slot: 'paintSmall',
      shape: { profile: CAPSULE_PROFILE, segments: 12 },
    },
  ];
})();

/** Every worked example, for a test or a parade scenario to walk. */
export const SHAPE_EXAMPLES = {
  tank: EXAMPLE_TANK,
  aircraft: EXAMPLE_AIRCRAFT,
  structure: EXAMPLE_STRUCTURE,
} as const;

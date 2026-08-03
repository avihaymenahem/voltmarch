/**
 * ============================================================================
 * RED ALERT — src/art/MassList.ts
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
 * THREE PRIMITIVES, and that is deliberate:
 *   box    — a chamfered frustum-box. Covers slabs, wedges, glacis plates,
 *            splayed skirts and trapezoids via `taper`.
 *   lathe  — a revolved profile at 12-16 segments. Covers cylinders, barrels,
 *            domes, spheres, capsules and cones. Faceted on purpose (#40).
 *   prism  — an extruded 2D plan with chamfered rims. Covers the Soviet
 *            octagonal slab and any cut-corner hull plan.
 *
 * Nothing here imports THREE. This file is pure data + arithmetic so the
 * validator runs in a test with no GL context.
 * ============================================================================
 */

import { UNIT_GEOMETRY, UNIT_LADDER, UNIT_VALIDATION } from '../core/config';
import type { PartId } from '../core/types';
import type { SlotName } from './Greeble';

/* ==========================================================================
 * 1. SHAPES
 * ========================================================================== */

export type PrimitiveKind = 'box' | 'lathe' | 'prism';

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
  const shapeFactor =
    m.primitive === 'lathe'
      ? (m.profile === 'sphere' || m.profile === 'dome' ? Math.PI / 4 : 0.94)
      : m.primitive === 'prism' ? 0.90 : 1.0;
  return ey * ez * shapeFactor;
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
  for (const m of list.masses) {
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
  for (const m of list.masses) {
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
    `${s.bounds.map((b) => b.toFixed(1)).join('x')} m  ${s.triangles} tris`
  );
}

/**
 * Default chamfer for a mass, in metres. Solved from the bible's PIXEL figure
 * (2-4 px at 29.6 px/m) rather than its fraction figure — see UNIT_GEOMETRY.
 * Never zero: a raw 90-degree edge is scorecard #11, an automatic fail.
 */
export function defaultChamfer(m: MassDef, faction: UnitMassList['faction']): number {
  if (m.chamfer !== undefined) return m.chamfer;
  const min = Math.min(m.size[0], m.size[1], m.size[2]);
  const frac = faction === 'soviets'
    ? UNIT_GEOMETRY.chamferFractionSoviets
    : UNIT_GEOMETRY.chamferFractionAllies;
  return Math.min(
    min * UNIT_GEOMETRY.chamferMaxFractionOfMin,
    Math.max(UNIT_GEOMETRY.chamferMinMeters, min * frac),
  );
}

/**
 * ============================================================================
 * VOLTMARCH — src/art/BuildingFactory.ts
 * ============================================================================
 * FACTION ARCHITECTURE. Takes a `StructureMassList`, chamfers every convex
 * edge, UV-maps every face into a greeble atlas, bakes the ambient/cavity
 * gradient into vertex colour, splits the result into at most three merged
 * geometries (body / pad / turret), and refuses to hand back a structure that
 * misses the bible's numbers.
 *
 * WHY THIS IS NOT `UnitFactory.buildUnit`
 * ---------------------------------------
 * The two share a language and an atlas generator, and this file imports both
 * (`MassList.ts` for the primitives and the plan/profile maths, `Greeble.ts`
 * for the atlas, `UnitFactory.createUnitMaterial` for RULING #3). What it does
 * NOT share is the VALIDATOR. `validateUnit` enforces rules written about
 * vehicles — 3-6 primary masses, a dominant feature at 35-50% of the
 * silhouette, a centre of visual mass at 60-70% of height, 8-14% team colour.
 * A building is deliberately none of those things: bible 5.3's top-heavy rule
 * is about units, R-T1 gives a structure 5-8% team colour instead of a
 * vehicle's 8-14%, and a Construction Yard legitimately carries fifteen
 * readable masses. Running a Power Plant through `validateUnit` would reject
 * it, so structures get their own gate with its own bands
 * (`BUILDING_VALIDATION`).
 *
 * THE FOUR DECISIONS THAT MATTER
 * ------------------------------
 * 1. ONE STRUCTURE MATERIAL + ONE PAD MATERIAL PER FACTION. Four materials for
 *    all 22 structures. A batch costs one draw call per PART, so a Power Plant
 *    is 2 draws and a War Factory is 2 (its doors animate inside the body
 *    geometry rather than as a separate part) — the whole reason doors and
 *    radar dishes are shader-driven instead of bridge-driven.
 *
 * 2. ANIMATION IS A VERTEX ATTRIBUTE, NOT A SCENE GRAPH. Every vertex carries
 *    `aFeature = (code, riseHeight, animParam, phase)`. The code selects
 *    construction rise, a sliding bay door, a rotating dish, a lit window or a
 *    static pad; the per-instance `aState` (hpFrac, buildProgress, selected,
 *    seed) and one shared `uTime` uniform drive them. 200 animated structures
 *    cost zero CPU per frame.
 *
 * 3. THE FOUNDATION PAD IS REAL GEOMETRY WITH ITS OWN MATERIAL. Bible 5.4
 *    gives ground roughness 0.88 / env 0.35 / NO clearcoat, which is a
 *    different surface class from painted armour (0.52 + clearcoat 0.30). It
 *    is extruded DOWN by `BUILDING_PAD.skirtDepth` so it meets terrain on
 *    every legal site without per-instance re-meshing — see the note there.
 *
 * 4. BUILDINGS NEVER SAMPLE `paintLarge`. That tile is authored at vehicle
 *    scale; stretched over a 12 m wall its marks read as a tank panel
 *    pretending to be a building. Walls take `paintMed` — see
 *    `structurePaintSlot`.
 *
 * THE SURFACE, AFTER THE CLEAN-TEXTURE PASS
 * -----------------------------------------
 * Every wall in this file is now LARGE UNBROKEN FLAT PAINT with a few crisp
 * seams, because that is what `docs/surface-refs/ra3-structures.png` shows. The
 * two factions differ in construction, not in hue: `createStructureMaterial`
 * gives Allied ceramic a thick tight clear coat and a hot env, and Soviet
 * bolted plate a thin slack one, while `Greeble.ts` draws welded straps for one
 * and bolt rows for the other. And the R1 gate no longer measures Sobel edge
 * coverage — that metric rewarded noise, which is how the walls ended up
 * marbled — it measures drawn structure and caps speckle.
 *
 * ZERO GRIME on painted surfaces. Bible 5.5 allows rust on buildings, and only
 * on chimneys, pipes and scaffolding — those masses carry the `bareMetal` slot
 * whose atlas tile already reads as warm turned metal. Nothing here streaks
 * a wall.
 *
 * That paragraph described the intent correctly and NOTHING IMPLEMENTED IT.
 * One greeble generator dresses hulls and architecture both, its spec said
 * nothing about which, and so scorecard #22 — "no streaks, mud, rust or
 * scratches on any HULL", a rule about VEHICLES — was enforced here too and no
 * building in the game had any rust. `structureAtlasSpec` now overrides
 * `surfaceClass` to 'structure', which is the ONE field it must disagree with
 * `specForPalette` (the unit builder it spreads) about, and `rustPipework` in
 * `greeble-gen.ts` does the drawing. Still only `bareMetal`: `rivetPlate` is
 * the SOVIET WALL as well as the stack body, so rusting it would rust facades.
 * ============================================================================
 */

import * as THREE from 'three';

import {
  BUILDING_ANIM,
  BUILDING_GEOMETRY,
  BUILDING_GREEBLE,
  BUILDING_PAD,
  BUILDING_VALIDATION,
  CELL,
  MIN_CHAMFER,
  UNIT_GREEBLE,
  UNIT_MATERIAL,
  type UnitPalette,
} from '../core/config';
import { clamp01, hexToLinearRgb, lerp, smoothstep } from '../core/math';
import { applyShroudTint } from '../render/FogOfWar';
import { nodePath } from '../render/gpu-path';
import { PartId, type SocketDef } from '../core/types';
import {
  detailCoverage,
  edgeCoverage,
  greebles,
  GreebleFactory,
  SURFACE_BUDGET,
  type GreebleAtlas,
  type GreebleSpec,
  type SlotName,
  type UvRect,
} from './Greeble';
import {
  emitMassShape, expandMasses, latheProfile, massAxisAlignedFraction, massExtents,
  massFlankSurface, planPolygon, shapeSpecFor,
  MassRole, type MassDef,
} from './MassList';
import { createUnitMaterial, specForPalette, viewWeight } from './UnitFactory';
import { STRUCTURE_ANIM, STRUCTURE_ANIM_LINEAR } from './structure-anim';
import { applyStructureRim } from './structure-rim';

declare const __DEV__: boolean;
const DEV: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

export type StructureFaction = 'allies' | 'soviets';

/* ==========================================================================
 * 1. THE DECLARATIVE LANGUAGE
 * ========================================================================== */

/**
 * What a mass DOES at runtime. Baked into `aFeature.x` and read by the vertex
 * shader; see `structureShader` for the implementation of each.
 */
export const enum Feature {
  /** Rises out of the ground with `buildProgress`. The default. */
  Body = 0,
  /** Never rises and is never clipped: the foundation pad and its skirt. */
  Static = 1,
  /** Rises, then retracts DOWNWARD by `anim` metres when the bay opens. */
  Door = 2,
  /** Rises, then spins about the model's Y axis at `anim` rad/s. */
  Spinner = 3,
  /** Rises; its emissive goes to interior fire when the structure is burning. */
  Window = 4,
  /** Rises, then travels vertically by `anim` metres while healthy. */
  Piston = 5,
}

/** Which merged geometry a mass lands in. */
export type MassTarget = 'body' | 'pad' | 'turret';

export interface StructureMass extends MassDef {
  /** Default `Feature.Body`. */
  feature?: Feature;
  /** Door travel in metres, or spinner rate in rad/s. Ignored otherwise. */
  anim?: number;
  /** Default `'body'`. Pad masses get the ground material; turret masses slew. */
  target?: MassTarget;
}

export interface StructureSocket {
  part: PartId;
  /** Model-local metres. The model origin is the ground-plane footprint centre. */
  pos: readonly [number, number, number];
  yaw?: number;
  pitch?: number;
  /** Lives in turret-local space (a defence turret's muzzle). */
  turret?: boolean;
}

/**
 * Which validation bands a structure is held to. A Construction Yard, a Tesla
 * Coil and a 4 m wall panel are not the same kind of object and the numbers
 * that make one good make the next one impossible.
 */
export type StructureClass = 'structure' | 'defence' | 'wall';

export interface StructureMassList {
  /** Unique key. Also the library key other modules look up. */
  key: string;
  name: string;
  faction: StructureFaction;
  /** Default `'structure'`. */
  cls?: StructureClass;
  /** Footprint in CELLS. `CELL` is 4 m, so a 3x2 refinery is 12 x 8 m. */
  footprintW: number;
  footprintH: number;
  /**
   * Roofline in metres, from BUILDING_FOOTPRINTS. The validator holds the
   * built silhouette to this within `BUILDING_VALIDATION.heightTolerance`.
   */
  height: number;
  /** Hull-local yaw pivot of a defence turret. Omit for everything else. */
  turretPivot?: readonly [number, number, number];
  masses: readonly StructureMass[];
  sockets: readonly StructureSocket[];
}

/* ==========================================================================
 * 2. SLOT SELECTION
 * ========================================================================== */

/**
 * Pick a paint density by face area — the building variant of
 * `Greeble.paintSlotForArea`.
 *
 * `paintLarge` is DELIBERATELY unreachable, and the reason survives the surface
 * rewrite even though the old measurement that justified it does not. That tile
 * is authored as a VEHICLE glacis: three plates, two verticals, a stowage well,
 * a hatch and a louvre stack, all at a scale that suits a 7 m hull. Stretched
 * over a 12 m wall those marks come out enormous and read as a tank panel
 * pretending to be a building. `paintMed` — a frame, one authored course plus
 * whatever the panel-density knob buys, one vertical and one pocket — is the
 * facade plan, and the smaller tiles carry the greebles.
 */
export function structurePaintSlot(areaSqM: number): SlotName {
  if (areaSqM >= 3.0) return 'paintMed';
  if (areaSqM >= 0.5) return 'paintSmall';
  return 'paintTiny';
}

/**
 * Select one of the three authored slab plans for a structure's foundation.
 *
 * The faction still owns one atlas and one material; only the UV rectangle in
 * the already-merged pad geometry changes.  This is therefore deterministic
 * per content key, costs no texture, material, batch or draw call, and breaks
 * the "same paintMed tile under every building" repetition called out by the
 * visual audit.  Tiny trim retains its scale and non-paint markings are never
 * remapped.
 */
export function padSurfaceSlot(key: string, slot: SlotName): SlotName {
  const plans: readonly SlotName[] = ['paintLarge', 'paintMed', 'paintSmall'];
  const base = plans.indexOf(slot);
  if (base < 0) return slot;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Final avalanche matters here: content keys share long faction prefixes,
  // and raw FNV's low two bits gave several adjacent roster rows one variant.
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return plans[(base + (h >>> 0) % plans.length) % plans.length];
}

/** Chamfer for one mass, in metres. Never zero — scorecard #11. */
export function structureChamfer(m: MassDef, faction: StructureFaction): number {
  if (m.chamfer !== undefined) return Math.max(MIN_CHAMFER, m.chamfer);
  const min = Math.min(m.size[0], m.size[1], m.size[2]);
  const frac = faction === 'soviets'
    ? BUILDING_GEOMETRY.chamferFractionSoviets
    : BUILDING_GEOMETRY.chamferFractionAllies;
  return Math.min(
    min * BUILDING_GEOMETRY.chamferMaxFractionOfMin,
    Math.max(BUILDING_GEOMETRY.chamferMinMeters, min * frac),
  );
}

/* ==========================================================================
 * 3. THE MESH ACCUMULATOR
 *
 * Flat typed-array-backed builder. It owns the active transform so a primitive
 * emits local-space quads and never thinks about mirroring or winding, and it
 * owns the per-vertex `aFeature` channel so a primitive never thinks about
 * animation either.
 * ========================================================================== */

type V3 = readonly [number, number, number];

/**
 * THE BAKED OCCLUSION, and the reason it is here rather than in `config.ts`.
 *
 * `UNIT_GREEBLE.cavityVertexTint` is documented in config as "vertex-colour
 * darkening on undersides AND MASS SEAMS". Only the first half was ever built:
 * `tintFor` darkened a downward-facing normal and nothing else, so every one of
 * the ~40 masses bolted onto a structure met its host with no contact shadow at
 * all and read as a sticker rather than as hardware. The RA3 buildings in
 * `docs/surface-refs/` have a hard dark line under every box, every ladder and
 * every stack, and it is baked, not lit.
 *
 * BE HONEST ABOUT WHAT IT BOUGHT. On the twelve-structure A/B below this is
 * worth between -0.34 and +0.82 points of body Sobel per structure — it is
 * NEUTRAL on the metric, and it was added because the seam is visible in the
 * crops (the Allied Power Plant's cooling towers now sit into their roof
 * instead of floating on it) and because config.ts already said it was here.
 * Anyone who quotes it as a Sobel win is quoting something that was measured
 * and did not happen.
 *
 * Two terms, both free — they are values written into the `color` attribute
 * that already exists, so the geometry, the draw count and the shader are
 * untouched:
 *
 *   SEAM     each mass darkens toward its OWN underside over a short metric
 *            distance, so the joint where it meets whatever it stands on is a
 *            step in vertex colour. This is the missing half above.
 *   UNDER    unchanged — `cavityVertexTint` on a downward face.
 *
 *
 * THE THIRD TERM THAT WAS HERE, AND WHY IT IS NOT
 * -----------------------------------------------
 * A chamfer-rim EDGE LIGHT — every bevel facet not facing down multiplied by
 * 1.20 — was written, shipped into a measurement, and measured, and it lost.
 * The A/B is `tools/sobel.mjs --baseline` against a normal run over twelve
 * structures, three per army, back to back on one machine:
 *
 *     allied_power       body Sobel 53.5% -> 39.3%   (-14.2 points)
 *     allied_warfactory  body Sobel 51.2% -> 41.0%   (-10.2)
 *     meridian_conclave  body Sobel 39.7% -> 32.0%   ( -7.7)
 *     soviet_warfactory  body Sobel 60.2% -> 59.9%   ( -0.3)
 *     reclaim_foundry    body Sobel 53.5% -> 54.7%   ( +1.2)
 *
 * The crops say why immediately: the Allied Power Plant's walls come back
 * BRIGHTER and with their panel lines gone. Allied architecture is bone-white
 * under a 0.42 clearcoat at env 0.95 and it already sits near the top of the
 * range; the atlas ALSO pre-brightens the bevel patch by +22% V for exactly
 * this purpose. Multiplying that again by 1.20 pushes the rims past white,
 * the bloom threshold spreads the excess into a halo, and a faction whose
 * whole read is crisp seams on flat paint loses the seams.
 *
 * It was a double-count of a highlight the atlas already draws, and it is the
 * shape of mistake worth writing down: a term that helps the two dark armies a
 * little and destroys the two light ones is not a term that needs tuning, it is
 * a term that belonged in the texture and was already there.
 */
export const STRUCTURE_AO = {
  /**
   * Vertex tint at a mass's own footline.
   *
   * 0.80, not the 0.70 the first version used. The seam is a multiplicative
   * darkening, and a Sobel gradient in a darkened region is scaled by the same
   * factor — so contrast cost rises with depth, and on the light armies it is
   * paid on the brightest, most panel-lined surfaces in the game. 0.80 is a
   * visible contact shadow at half the contrast bill.
   */
  seamFloor: 0.80,
  /** Fade-out distance as a fraction of the mass's own height. */
  seamFraction: 0.34,
  /** ... capped here, so a 12 m tower is not dark for its first four metres. */
  seamMaxMeters: 0.85,
  /** ... and floored here, so a 60 mm conduit still gets a visible root. */
  seamMinMeters: 0.05,
} as const;

interface FeatureCtx {
  code: Feature;
  /** Metres this mass sinks at buildProgress 0. */
  rise: number;
  anim: number;
  phase: number;
}

class MeshAcc {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly feat: number[] = [];
  private readonly idx: number[] = [];

  /** Real triangle area per atlas slot, square metres. */
  readonly areaBySlot = new Map<SlotName, number>();
  /** The same area weighted by how much of it the RTS camera can ever see. */
  readonly visibleAreaBySlot = new Map<SlotName, number>();
  triangles = 0;

  private m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private t: V3 = [0, 0, 0];
  private mirror = 1;
  private height = 1;
  private massTint = 1;
  /** World Y of the current mass's own underside — the seam term's origin. */
  private footY = 0;
  /** Metres the seam term fades over. 0 disables it. */
  private seamDepth = 0;
  private fc: FeatureCtx = { code: Feature.Body, rise: 0, anim: 0, phase: 0 };

  setTransform(rot: V3 | undefined, anchor: V3, mirrorX: boolean): void {
    const [rx, ry, rz] = rot ?? [0, 0, 0];
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    // Rz * Ry * Rx — three's default 'XYZ' euler order, written out in full.
    this.m = [
      cy * cz, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
      sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
      -sy, cy * sx, cy * cx,
    ];
    this.mirror = mirrorX ? -1 : 1;
    this.t = [anchor[0] * this.mirror, anchor[1], anchor[2]];
  }

  setTint(height: number, massTint: number): void {
    this.height = height;
    this.massTint = massTint;
  }

  /**
   * Arm the seam term for one mass. `footY` is the world Y of its underside
   * AFTER any turret rebase, and `massHeight` its own Y extent — both already
   * known to the caller, which is why neither is recomputed here.
   */
  setMassAo(footY: number, massHeight: number): void {
    this.footY = footY;
    this.seamDepth = Math.min(
      STRUCTURE_AO.seamMaxMeters,
      Math.max(STRUCTURE_AO.seamMinMeters, massHeight * STRUCTURE_AO.seamFraction),
    );
  }

  setFeature(fc: FeatureCtx): void { this.fc = fc; }

  private readonly tmpP = [0, 0, 0];
  private readonly tmpN = [0, 0, 0];

  private xp(p: V3): void {
    const m = this.m;
    const x = m[0] * p[0] + m[1] * p[1] + m[2] * p[2];
    const y = m[3] * p[0] + m[4] * p[1] + m[5] * p[2];
    const z = m[6] * p[0] + m[7] * p[1] + m[8] * p[2];
    this.tmpP[0] = x * this.mirror + this.t[0];
    this.tmpP[1] = y + this.t[1];
    this.tmpP[2] = z + this.t[2];
  }

  private xn(n: V3): void {
    const m = this.m;
    // The rotation is orthonormal, so the inverse-transpose is itself.
    this.tmpN[0] = (m[0] * n[0] + m[1] * n[1] + m[2] * n[2]) * this.mirror;
    this.tmpN[1] = m[3] * n[0] + m[4] * n[1] + m[5] * n[2];
    this.tmpN[2] = m[6] * n[0] + m[7] * n[1] + m[8] * n[2];
  }

  /**
   * Vertex colour. Two baked effects, both bible 3.3:
   *   - an ambient ramp, so the foot of a wall is darker than its parapet.
   *     This is the baked half of "units without contact darkening float", and
   *     it matters more on a 12 m building than on a 7 m tank.
   *   - a facing term: downward faces lose ambient, upward faces gain the
   *     hemisphere fill. The cheap stand-in for baked crease AO on geometry
   *     (the atlas carries the per-panel half).
   */
  private tintFor(y: number, ny: number): number {
    const ambient = lerp(0.60, 1.0, smoothstep(0, this.height * 0.55, y));
    const facing = ny < -0.4 ? UNIT_GREEBLE.cavityVertexTint : ny > 0.5 ? 1.06 : 1.0;
    // The mass-seam half of `cavityVertexTint`'s contract — see `STRUCTURE_AO`.
    const seam = this.seamDepth > 0
      ? lerp(STRUCTURE_AO.seamFloor, 1, smoothstep(0, this.seamDepth, y - this.footY))
      : 1;
    return Math.min(2, Math.max(0, ambient * facing * seam * this.massTint));
  }

  private push(p: V3, n: V3, u: number, v: number): number {
    this.xp(p);
    this.xn(n);
    const i = this.pos.length / 3;
    this.pos.push(this.tmpP[0], this.tmpP[1], this.tmpP[2]);
    this.nrm.push(this.tmpN[0], this.tmpN[1], this.tmpN[2]);
    this.uv.push(u, v);
    const c = this.tintFor(this.tmpP[1], this.tmpN[1]);
    this.col.push(c, c, c);
    const f = this.fc;
    this.feat.push(f.code, f.rise, f.anim, f.phase);
    return i;
  }

  private area3(a: number, b: number, c: number): number {
    const p = this.pos;
    const ax = p[b * 3] - p[a * 3], ay = p[b * 3 + 1] - p[a * 3 + 1], az = p[b * 3 + 2] - p[a * 3 + 2];
    const bx = p[c * 3] - p[a * 3], by = p[c * 3 + 1] - p[a * 3 + 1], bz = p[c * 3 + 2] - p[a * 3 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    return 0.5 * Math.hypot(cx, cy, cz);
  }

  private tri(a: number, b: number, c: number, slot: SlotName, want: V3): void {
    const p = this.pos;
    const ax = p[b * 3] - p[a * 3], ay = p[b * 3 + 1] - p[a * 3 + 1], az = p[b * 3 + 2] - p[a * 3 + 2];
    const bx = p[c * 3] - p[a * 3], by = p[c * 3 + 1] - p[a * 3 + 1], bz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    this.xn(want);
    // Winding is DERIVED, never assumed: mirroring flips it and so does a
    // negative-determinant rotation, and deriving it means neither can bite.
    if (nx * this.tmpN[0] + ny * this.tmpN[1] + nz * this.tmpN[2] >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
    const area = this.area3(a, b, c);
    this.areaBySlot.set(slot, (this.areaBySlot.get(slot) ?? 0) + area);
    const w = viewWeight(this.tmpN[0], this.tmpN[1], this.tmpN[2]);
    this.visibleAreaBySlot.set(slot, (this.visibleAreaBySlot.get(slot) ?? 0) + area * w);
    this.triangles++;
  }

  addQuad(p0: V3, p1: V3, p2: V3, p3: V3, n: V3, r: UvRect, slot: SlotName): void {
    const a = this.push(p0, n, r.u0, r.v0);
    const b = this.push(p1, n, r.u1, r.v0);
    const c = this.push(p2, n, r.u1, r.v1);
    const d = this.push(p3, n, r.u0, r.v1);
    this.tri(a, b, c, slot, n);
    this.tri(a, c, d, slot, n);
  }

  addTri(
    p0: V3, p1: V3, p2: V3, n: V3, slot: SlotName,
    uv0: readonly [number, number], uv1: readonly [number, number], uv2: readonly [number, number],
  ): void {
    const a = this.push(p0, n, uv0[0], uv0[1]);
    const b = this.push(p1, n, uv1[0], uv1[1]);
    const c = this.push(p2, n, uv2[0], uv2[1]);
    this.tri(a, b, c, slot, n);
  }

  isEmpty(): boolean { return this.idx.length === 0; }

  toGeometry(name: string): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.name = name;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    // (featureCode, riseHeight, animParam, phase). The batcher copies every
    // attribute by reference into its private instance geometry, so this rides
    // along with position for free.
    g.setAttribute('aFeature', new THREE.Float32BufferAttribute(this.feat, 4));
    const verts = this.pos.length / 3;
    g.setIndex(verts > 65535
      ? new THREE.Uint32BufferAttribute(this.idx, 1)
      : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/* ==========================================================================
 * 4. PRIMITIVES
 * ========================================================================== */

function uvAt(r: UvRect, u: number, v: number): [number, number] {
  return [lerp(r.u0, r.u1, u), lerp(r.v0, r.v1, v)];
}

interface BuildCtx {
  acc: MeshAcc;
  uv: (slot: SlotName) => UvRect;
  bevel: (slot: SlotName) => UvRect;
}

const BOX_FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;
type BoxFaceName = typeof BOX_FACES[number];

function nrm(x: number, y: number, z: number): V3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * THE CHAMFERED FRUSTUM-BOX. Six inset face quads, twelve 45-degree edge
 * strips, eight corner triangles.
 *
 * A single-facet chamfer rather than a rounded fillet is deliberate: it
 * produces exactly one crisp specular band per edge, which is the 2-4 px
 * highlight scorecard #11 looks for, at a third of the triangles. `taper`
 * scales the top footprint and slides it in Z, which is how ALLIED-1's splayed
 * skirt (base 1.25-1.4x wider than the top, wall slope 18-25%) is made.
 */
function buildBox(
  ctx: BuildCtx, m: StructureMass, chamfer: number,
  slotOf: (face: BoxFaceName, area: number) => SlotName,
): void {
  const [sx, sy, sz] = m.size;
  const c = Math.min(chamfer, Math.min(sx, sy, sz) * BUILDING_GEOMETRY.chamferMaxFractionOfMin);
  const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
  const [tsx, tsz, toz] = m.taper ?? [1, 1, 0];

  const corner = (i: number, j: number, k: number): V3 => {
    const scaleX = j > 0 ? tsx : 1;
    const scaleZ = j > 0 ? tsz : 1;
    const offZ = j > 0 ? toz : 0;
    return [i * hx * scaleX, j * hy, k * hz * scaleZ + offZ];
  };
  const vX = (i: number, j: number, k: number): V3 => { const p = corner(i, j, k); return [p[0] - i * c, p[1], p[2]]; };
  const vY = (i: number, j: number, k: number): V3 => { const p = corner(i, j, k); return [p[0], p[1] - j * c, p[2]]; };
  const vZ = (i: number, j: number, k: number): V3 => { const p = corner(i, j, k); return [p[0], p[1], p[2] - k * c]; };

  const faceArea: Record<BoxFaceName, number> = {
    px: sy * sz, nx: sy * sz, py: sx * sz, ny: sx * sz, pz: sx * sy, nz: sx * sy,
  };
  const faceSlot = (f: BoxFaceName): SlotName => slotOf(f, faceArea[f]);
  const faceUv = (f: BoxFaceName): UvRect => ctx.uv(faceSlot(f));

  for (const i of [1, -1]) {
    const f: BoxFaceName = i > 0 ? 'px' : 'nx';
    ctx.acc.addQuad(vX(i, -1, -i), vX(i, -1, i), vX(i, 1, i), vX(i, 1, -i), nrm(i, 0, 0), faceUv(f), faceSlot(f));
  }
  for (const j of [1, -1]) {
    const f: BoxFaceName = j > 0 ? 'py' : 'ny';
    ctx.acc.addQuad(vY(-j, j, -1), vY(j, j, -1), vY(j, j, 1), vY(-j, j, 1), nrm(0, j, 0), faceUv(f), faceSlot(f));
  }
  for (const k of [1, -1]) {
    const f: BoxFaceName = k > 0 ? 'pz' : 'nz';
    ctx.acc.addQuad(vZ(-k, -1, k), vZ(k, -1, k), vZ(k, 1, k), vZ(-k, 1, k), nrm(0, 0, k), faceUv(f), faceSlot(f));
  }

  // The twelve edge chamfers, all sampling the tile's flat pre-brightened
  // bevel patch (+22% V, -15% S) so the band is a colour, not just a facet.
  const bevSlot = faceSlot('px');
  const bev = ctx.bevel(bevSlot);
  for (const i of [1, -1]) for (const j of [1, -1]) {
    ctx.acc.addQuad(vX(i, j, -1), vY(i, j, -1), vY(i, j, 1), vX(i, j, 1), nrm(i, j, 0), bev, bevSlot);
  }
  for (const i of [1, -1]) for (const k of [1, -1]) {
    ctx.acc.addQuad(vX(i, -1, k), vZ(i, -1, k), vZ(i, 1, k), vX(i, 1, k), nrm(i, 0, k), bev, bevSlot);
  }
  for (const j of [1, -1]) for (const k of [1, -1]) {
    ctx.acc.addQuad(vY(-1, j, k), vZ(-1, j, k), vZ(1, j, k), vY(1, j, k), nrm(0, j, k), bev, bevSlot);
  }
  for (const i of [1, -1]) for (const j of [1, -1]) for (const k of [1, -1]) {
    ctx.acc.addTri(
      vX(i, j, k), vY(i, j, k), vZ(i, j, k), nrm(i, j, k), bevSlot,
      uvAt(bev, 0, 0), uvAt(bev, 1, 0), uvAt(bev, 0.5, 1),
    );
  }
}

/**
 * THE LATHE. Stacks, pressure vessels, capsule corner rails, tesla coil rings,
 * cupolas, pipes.
 *
 * Faceted on purpose: scorecard #40 wants 12-16 visible facets on a stack or a
 * tank, never a smooth 32-segment tube. A profile band that is both short and
 * diagonal is recognised as a chamfer rim and takes the bevel patch, so a
 * stack's cap ring carries the same highlight a wall corner does.
 */
function buildLathe(
  ctx: BuildCtx, m: StructureMass, chamfer: number, sideSlot: SlotName, capSlot: SlotName,
): void {
  const [sx, sy, sz] = m.size;
  const segs = Math.max(6, m.segments ?? BUILDING_GEOMETRY.cylSegments);
  const rings = BUILDING_GEOMETRY.sphereRings;
  const prof = latheProfile(
    m.profile ?? 'cyl', clamp01(chamfer / Math.max(1e-6, sy)), m.topRadius ?? 1, rings,
  );

  let totalLen = 0;
  for (let i = 1; i < prof.length; i++) {
    totalLen += Math.hypot((prof[i][0] - prof[i - 1][0]) * sx, (prof[i][1] - prof[i - 1][1]) * sy);
  }
  if (totalLen < 1e-9) return;

  const at = (ri: number, yi: number, seg: number): V3 => {
    const a = (seg / segs) * Math.PI * 2;
    return [Math.cos(a) * ri * sx, (yi - 0.5) * sy, Math.sin(a) * ri * sz];
  };

  const sideUv = ctx.uv(sideSlot);
  const capUvRect = ctx.uv(capSlot);
  const bevUv = ctx.bevel(sideSlot);

  let vAccum = 0;
  for (let i = 1; i < prof.length; i++) {
    const [r0, y0] = prof[i - 1];
    const [r1, y1] = prof[i];
    const dr = (r1 - r0) * sx, dy = (y1 - y0) * sy;
    const bandLen = Math.hypot(dr, dy);
    if (bandLen < 1e-6) continue;
    const v0 = vAccum / totalLen;
    vAccum += bandLen;
    const v1 = vAccum / totalLen;

    const isBevel = bandLen < totalLen * 0.20 && Math.abs(dr) > 1e-4 && Math.abs(dy) > 1e-4;
    const rect = isBevel ? bevUv : sideUv;

    for (let s = 0; s < segs; s++) {
      const a0 = at(r0, y0, s), a1 = at(r0, y0, s + 1);
      const b0 = at(r1, y1, s), b1 = at(r1, y1, s + 1);
      const mid = ((s + 0.5) / segs) * Math.PI * 2;
      // Band normal: perpendicular to the profile segment, swept radially. A
      // flat disc band collapses this to +/-Y, so caps need no special case.
      const nr = dy, ny = -dr;
      const nl = Math.hypot(nr, ny) || 1;
      const n: V3 = [(Math.cos(mid) * nr) / nl, ny / nl, (Math.sin(mid) * nr) / nl];
      const ca = (t: number): [number, number] => uvAt(
        capUvRect,
        0.5 + Math.cos((t / segs) * Math.PI * 2) * 0.5,
        0.5 + Math.sin((t / segs) * Math.PI * 2) * 0.5,
      );

      if (r0 < 1e-5) {
        ctx.acc.addTri(a0, b0, b1, n, capSlot, uvAt(capUvRect, 0.5, 0.5), ca(s), ca(s + 1));
      } else if (r1 < 1e-5) {
        ctx.acc.addTri(b0, a1, a0, n, capSlot, uvAt(capUvRect, 0.5, 0.5), ca(s + 1), ca(s));
      } else {
        const u0 = lerp(rect.u0, rect.u1, s / segs);
        const u1 = lerp(rect.u0, rect.u1, (s + 1) / segs);
        const bandRect: UvRect = isBevel
          ? { u0, v0: rect.v0, u1, v1: rect.v1 }
          : { u0, v0: lerp(rect.v0, rect.v1, v0), u1, v1: lerp(rect.v0, rect.v1, v1) };
        ctx.acc.addQuad(a0, a1, b1, b0, n, bandRect, sideSlot);
      }
    }
  }
}

/**
 * THE PRISM. SOVIET-1's brutalist slab: "a box with 45-degree chamfers on
 * every vertical corner at 6-9% of box width, reads as octagonal in plan".
 * Also serves the Allied hex/oct crown (ALLIED-2).
 */
function buildPrism(
  ctx: BuildCtx, m: StructureMass, chamfer: number, sideSlot: SlotName, capSlot: SlotName,
): void {
  const [sx, sy, sz] = m.size;
  const plan = planPolygon(m.plan ?? 'octagon', m.cornerCut ?? 0);
  const c = Math.min(chamfer, sy * 0.4);
  const inset = Math.min(chamfer, Math.min(sx, sz) * 0.2);
  const hy = sy * 0.5;

  const pt = (i: number, shrink: number): readonly [number, number] => {
    const p = plan[i % plan.length];
    const px = p[0] * sx, pz = p[1] * sz;
    const l = Math.hypot(px, pz) || 1;
    return [px - (px / l) * shrink, pz - (pz / l) * shrink];
  };

  const sideUv = ctx.uv(sideSlot);
  const capUv = ctx.uv(capSlot);
  const bevUv = ctx.bevel(sideSlot);
  const n = plan.length;

  for (let i = 0; i < n; i++) {
    const a = pt(i, 0), b = pt(i + 1, 0);
    const ai = pt(i, inset), bi = pt(i + 1, inset);
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const nOut: V3 = [dz / l, 0, -dx / l];

    ctx.acc.addQuad(
      [a[0], -hy + c, a[1]], [b[0], -hy + c, b[1]],
      [b[0], hy - c, b[1]], [a[0], hy - c, a[1]],
      nOut, sideUv, sideSlot);

    const nUp: V3 = [nOut[0] * 0.7071, 0.7071, nOut[2] * 0.7071];
    const nDn: V3 = [nOut[0] * 0.7071, -0.7071, nOut[2] * 0.7071];
    ctx.acc.addQuad(
      [a[0], hy - c, a[1]], [b[0], hy - c, b[1]],
      [bi[0], hy, bi[1]], [ai[0], hy, ai[1]], nUp, bevUv, sideSlot);
    ctx.acc.addQuad(
      [ai[0], -hy, ai[1]], [bi[0], -hy, bi[1]],
      [b[0], -hy + c, b[1]], [a[0], -hy + c, a[1]], nDn, bevUv, sideSlot);
  }

  for (const [y, ny] of [[hy, 1], [-hy, -1]] as const) {
    for (let i = 0; i < n; i++) {
      const a = pt(i, inset), b = pt(i + 1, inset);
      ctx.acc.addTri(
        [0, y, 0], [a[0], y, a[1]], [b[0], y, b[1]], [0, ny, 0], capSlot,
        uvAt(capUv, 0.5, 0.5),
        uvAt(capUv, 0.5 + a[0] / sx, 0.5 + a[1] / sz),
        uvAt(capUv, 0.5 + b[0] / sx, 0.5 + b[1] / sz));
    }
  }
}

/* ==========================================================================
 * 5. THE MATERIALS
 *
 * R10 says a material is only ever constructed through the factory, so both of
 * these go through `createUnitMaterial` and then adjust. Bible 5.4's table has
 * FOUR surface classes and "Terrain / ground" is genuinely one of them
 * (roughness 0.88, env 0.35, no clearcoat) — a concrete apron with a car-paint
 * clear coat is wrong, and cloning the painted-armour preset onto it would be
 * the same mistake R10 warns about, pointed the other way.
 * ========================================================================== */

/** The one uniform every structure material shares. Ticked once per frame. */
export const buildingTime = { value: 0 };

const LIN = new Float32Array(3);
function lin(hex: string): string {
  hexToLinearRgb(hex, LIN);
  return `vec3(${LIN[0].toFixed(4)}, ${LIN[1].toFixed(4)}, ${LIN[2].toFixed(4)})`;
}
/**
 * The same emission, for a colour that has already been converted.
 *
 * `structure-anim.ts` converts the two animation colours once so the TSL port
 * reads the SAME floats rather than running `hexToLinearRgb` a second time. This
 * formats them exactly as `lin()` does, so the generated GLSL is unchanged.
 */
function linVec3(rgb: readonly [number, number, number]): string {
  return `vec3(${rgb[0].toFixed(4)}, ${rgb[1].toFixed(4)}, ${rgb[2].toFixed(4)})`;
}
function f(n: number): string { return n.toFixed(4); }

/* --------------------------------------------------------------------------
 * The vertex maths, written ONCE and injected into TWO programs.
 *
 * The colour pass and the shadow pass have to agree about where a structure IS,
 * or the frame shows a shadow of a building that is not there — which is
 * exactly what shipped until the depth material below existed. Two copies of
 * this arithmetic is the obvious way for them to drift apart again, so there is
 * one copy and each program decides only WHERE to inject it.
 *
 * `SOLVE` writes the four globals `PARS` declares; the colour program needs it
 * at `<beginnormal_vertex>` (the radar spin has to reach `objectNormal` before
 * `<defaultnormal_vertex>` consumes it), the depth program has no normals and
 * takes it at `<begin_vertex>`. `APPLY` then moves `transformed` identically in
 * both.
 * -------------------------------------------------------------------------- */

/** Uniforms, attributes and the four globals `SOLVE`/`APPLY` communicate through. */
const STRUCTURE_ANIM_PARS = `
        uniform float uTime;
        attribute vec4 aState;      // hpFrac, buildProgress, selected, seed
        attribute vec4 aFeature;    // code, riseHeight, animParam, phase
        varying float vRaClip;
        float raSpinC = 1.0;
        float raSpinS = 0.0;
        float raSink = 0.0;
        float raDoor = 0.0;
        float raLift = 0.0;`;

/** Solve sink / door / spin for this vertex. Touches nothing but the globals. */
const STRUCTURE_ANIM_SOLVE = `
        {
          float code = aFeature.x;
          float bp = clamp(aState.y, 0.0, 1.0);
          // A pad never rises; everything else sinks by its own model height.
          float rises = 1.0 - step(0.5, code) * step(code, 1.5);
          raSink = (1.0 - bp) * aFeature.y * rises;
          // Bay door: retracts DOWNWARD into the floor, where the same ground
          // cut that hides an unbuilt structure hides the leaf for free.
          float isDoor = step(1.5, code) * step(code, 2.5);
          float ph = fract(uTime / ${f(STRUCTURE_ANIM.doorPeriodSeconds)} + aState.w);
          float open = smoothstep(0.0, ${f(STRUCTURE_ANIM.doorRampFraction)}, ph) * smoothstep(${f(STRUCTURE_ANIM.doorCloseFraction)}, ${f(STRUCTURE_ANIM.doorOpenFraction)}, ph);
          raDoor = isDoor * aFeature.z * open;
          // Radar sweep: about the model Y axis, so a dish is authored on the
          // centre line. RA3's dome is a dish on a central tower; this is that.
          float isSpin = step(2.5, code) * step(code, 3.5);
          float ang = uTime * aFeature.z * isSpin;
          raSpinC = cos(ang);
          raSpinS = sin(ang);
          // Small healthy machinery: pressure valves, collector lenses and
          // gantry hooks travel in place. aFeature.w staggers every mass so a
          // whole base never breathes in lockstep.
          float isPiston = step(4.5, code) * step(code, 5.5);
          raLift = isPiston * aFeature.z * sin(
            uTime * ${f(STRUCTURE_ANIM.pistonRadians)} + aFeature.w * 6.28318
          );
        }`;

/** Move `transformed` and publish the ground cut. Identical in both programs. */
const STRUCTURE_ANIM_APPLY = `
        transformed.xz = mat2(raSpinC, raSpinS, -raSpinS, raSpinC) * transformed.xz;
        transformed.y += raLift - raSink - raDoor;
        // A static pad is never clipped (its skirt is BELOW the origin on
        // purpose); everything else is cut at the ground plane.
        vRaClip = (abs(aFeature.x - 1.0) < 0.5) ? 1.0 : transformed.y;`;

/** The ground cut itself. Goes after `<clipping_planes_fragment>` in both. */
const STRUCTURE_CLIP_FRAGMENT = `
        // Construction rise: the part of the structure still underground is
        // simply not there. This is what makes it grow out of its pad.
        if (vRaClip < 0.0) discard;`;

/**
 * THE ANIMATION SHADER. Everything a structure does at runtime lives here:
 * construction rise, bay doors, radar sweep, damage soot, interior fire,
 * selection pulse. All of it reads per-instance `aState` and per-vertex
 * `aFeature`, so an animated base is still one draw call per part and zero CPU.
 *
 * This is the COLOUR pass. `createStructureDepthMaterial` is its shadow-pass
 * twin and the two share `STRUCTURE_ANIM_*` above; a structure part-way through
 * construction used to cast its FINISHED silhouette, because three substitutes
 * its own `MeshDepthMaterial` for the shadow map and that material never ran
 * this `onBeforeCompile`.
 */
export function applyStructureRuntimeShader(
  mat: THREE.MeshPhysicalMaterial, surfaceClassMap: THREE.Texture, silhouetteRim: boolean,
): void {
  const S = STRUCTURE_ANIM;
  const SLIN = STRUCTURE_ANIM_LINEAR;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = buildingTime;
    shader.uniforms.uSurfaceClassMap = { value: surfaceClassMap };

    // THE SHROUD SELF-TINT, and specifically THE EDIT THAT PRESERVES REMEMBERED
    // BUILDINGS. This assignment overwrites the hook `createUnitMaterial`
    // installed, so structures would otherwise be the one thing the depth-tested
    // carpet no longer covers — a scouted Construction Yard would render at full
    // daylight inside the fog. Sampling here gives it FOG_EXPLORED_LEVEL, hence
    // exactly the FOG_EXPLORED_ALPHA tint the carpet used to lay over it.
    applyShroudTint(shader);
    if (silhouetteRim) applyStructureRim(shader);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${STRUCTURE_ANIM_PARS}
        attribute vec3 aTeamColor;  // LINEAR rgb
        varying vec4 vRaState;
        varying vec3 vRaTeam;`)
      // The spin has to reach `objectNormal` here, BEFORE
      // `<defaultnormal_vertex>` turns it into `transformedNormal` — which is
      // why the solve cannot simply live next to the `transformed` edit below.
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>${STRUCTURE_ANIM_SOLVE}
        objectNormal.xz = mat2(raSpinC, raSpinS, -raSpinS, raSpinC) * objectNormal.xz;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${STRUCTURE_ANIM_APPLY}
        vRaState = aState;
        vRaTeam = aTeamColor;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform sampler2D uSurfaceClassMap;
        varying vec4 vRaState;
        varying vec3 vRaTeam;
        varying float vRaClip;`)
      .replace('#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>${STRUCTURE_CLIP_FRAGMENT}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          // ORM alpha is the procedural surface-class mask: painted panels
          // keep the faction coat, exposed machinery and concrete lose it.
          material.clearcoat *= texture2D(uSurfaceClassMap, vMapUv).a;
        #endif`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // DAMAGE. Bible 8.8: a hurt structure soots, it does not recolour.
          float raHp = clamp(vRaState.x, 0.0, 1.0);
          float raDmg = 1.0 - smoothstep(${f(S.damageOnsetLo)}, ${f(S.damageOnset)}, raHp);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * ${f(S.sootMultiplier)}, raDmg);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float raHp = clamp(vRaState.x, 0.0, 1.0);
          float raBp = clamp(vRaState.y, 0.0, 1.0);
          // INTERIOR FIRE. The emissive map is already zero everywhere except
          // the window plates, so it doubles as the window mask and no extra
          // UV varying is needed.
          float raWin = clamp(max(totalEmissiveRadiance.r,
                             max(totalEmissiveRadiance.g, totalEmissiveRadiance.b)) * ${f(S.burnMaskGain)}, 0.0, 1.0);
          float raBurn = (1.0 - smoothstep(${f(S.burnOnsetLo)}, ${f(S.burnOnset)}, raHp)) * raWin;
          float raFlick = ${f(S.burnFlickerBase)} + ${f(S.burnFlickerAmp)} * sin(uTime * ${f(S.burnFlickerRadians)} + vRaState.w * ${f(S.burnFlickerSeedScale)});
          totalEmissiveRadiance = mix(totalEmissiveRadiance,
                                      ${linVec3(SLIN.burnColor)} * (${f(S.burnEmissiveGain)} * raFlick), raBurn);
          // THE BUILD BAND. A bright scan line riding the ground cut while the
          // structure rises, so construction reads at a glance.
          float raBand = (1.0 - smoothstep(0.0, ${f(S.riseBandMeters)}, vRaClip)) * (1.0 - raBp);
          totalEmissiveRadiance += ${linVec3(SLIN.riseBandColor)} * raBand * ${f(S.riseBandGain)};
          // SELECTION. Team colour, pulsed. Readability comes from accents,
          // never from raising the exposure (bible R5).
          float raPulse = ${f(S.selectPulseBase)} + ${f(S.selectPulseAmp)} * sin(uTime * ${f(S.selectPulseRadians)});
          totalEmissiveRadiance += vRaTeam * clamp(vRaState.z, 0.0, 1.0)
                                 * ${f(S.selectEmissive)} * raPulse;
        }`);
  };
  // Two materials whose only difference is a uniform still share one compiled
  // program; three keys the cache on the source of `onBeforeCompile`, and this
  // function is shared by every structure material in the game.
  // v2: the shroud self-tint changed the generated program. Without the bump
  // three serves the cached v1 and the injection is silently a no-op.
  // v3: the vertex injection moved into the shared `STRUCTURE_ANIM_*` snippets.
  // The maths is unchanged and the generated GLSL is equivalent, but the SOURCE
  // is not, and this key's whole job is to stop the cache serving a program
  // built from different source. Bump it whenever the string changes.
  // v4: the numbers moved into `./structure-anim.ts`, shared with the TSL port.
  // Every value is identical — `f()` prints them exactly as before — but the
  // tuning constants that used to be typed inline are now interpolated, so a
  // handful of literals gained trailing zeroes and the SOURCE changed again.
  // v5: structure bodies gained a geometry-normal silhouette lift. Pads keep a
  // separate key because they are ground and deliberately omit that branch.
  // v7: healthy machinery gained shader-driven vertical travel, including the
  // shared depth program so moving parts and their shadows remain one shape.
  mat.customProgramCacheKey = () => silhouetteRim
    ? 'ra3.structure.rim.v7'
    : 'ra3.structure.pad.v7';
  mat.needsUpdate = true;
}

/**
 * THE SHADOW-PASS TWIN OF `applyStructureRuntimeShader`, AND THE END OF A KNOWN LIMIT.
 *
 * three does not draw the shadow map with an object's own material: it
 * substitutes a shared `MeshDepthMaterial`, which never runs the colour
 * material's `onBeforeCompile`. So everything the structure vertex shader does
 * — the construction sink, the bay door, the radar spin — was invisible to the
 * shadow pass, and a structure part-way through its rise cast the silhouette of
 * a FINISHED building. At `buildProgress === 0` it was worse than a mismatch:
 * the colour pass discards every fragment (`RenderBridge.sunkStructures`
 * describes that state from the other side), so the frame showed a full, sharp
 * shadow of a building with nothing but a pad under it.
 *
 * `Object3D.customDepthMaterial` is the hook, and reaching the InstancedMesh
 * needed `BatchPartSpec.customDepthMaterial` — see `render/InstanceBatcher.ts`.
 * The precedent is `PropLibrary.createPropMaterial`, which does the same for the
 * wind sway.
 *
 * ONE MATERIAL FOR EVERY STRUCTURE IN THE GAME. It reads `aState` (the
 * batcher's per-instance channel) and `aFeature` (per-vertex, written by
 * `MeshAcc.toGeometry` and carried into the batcher's private geometry by
 * reference) and nothing else — no atlas, no palette, no coat — so all four
 * armies, bodies and turrets alike, share one program.
 *
 * PACKING IS LEFT AT THE `MeshDepthMaterial` DEFAULT, deliberately, and this is
 * where the prop precedent should NOT be copied. `PropLibrary` asks for
 * `RGBADepthPacking`; in three 0.185 a directional light's shadow map is a real
 * `DepthTexture` and the sampler reads the depth attachment, so the fragment
 * COLOUR is never looked at. Packing it costs a `packDepthToRGBA` per fragment
 * and buys nothing. `BasicDepthPacking` is also what three's own `_depthMaterial`
 * uses, so this stays byte-identical to the pass it replaces apart from the
 * vertex maths and the discard.
 */
export function createStructureDepthMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial();
  mat.name = 'ra3.structure.depth';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = buildingTime;
    shader.vertexShader = shader.vertexShader
      // The depth program has no `<beginnormal_vertex>` outside
      // `USE_DISPLACEMENTMAP` and needs no normals, so solve and apply land in
      // the same chunk. `<begin_vertex>` still runs before `<project_vertex>`,
      // which is the only ordering that matters.
      .replace('#include <common>', `#include <common>${STRUCTURE_ANIM_PARS}`)
      .replace('#include <begin_vertex>',
        `#include <begin_vertex>${STRUCTURE_ANIM_SOLVE}${STRUCTURE_ANIM_APPLY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vRaClip;`)
      .replace('#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>${STRUCTURE_CLIP_FRAGMENT}`);
  };
  // Without a key of its own three would serve this material the program it
  // compiled for its OWN stock depth material — same shader id, same
  // parameters — and the injection would silently do nothing. That is the
  // failure the colour material's key exists to prevent, one pass over.
  mat.customProgramCacheKey = () => 'ra3.structure.depth.v2';
  mat.needsUpdate = true;
  return mat;
}

/**
 * FOUR MATERIAL LANGUAGES, NOT TWO — AND NOT ONE BOOLEAN STANDING IN FOR ALL.
 *
 * Bible 5.7 gives the factions different CONSTRUCTION, and construction is a
 * material property before it is a colour one. This function used to select
 * that construction from `atlas.spec.plating`, which is derived from
 * `UnitPalette.rivets`, and for two factions that was exactly right:
 *
 *   GLAZE / Allied — white ceramic tile and chrome. A thick, tight clear coat
 *     over a light base, reflecting hard: RA3's Allied architecture looks
 *     glazed, and glaze is a clearcoat with a low roughness, not a lighter
 *     albedo. Env intensity is high because the chrome trim has to catch sky.
 *
 *   FIELD / Soviet — field-painted olive over bolted plate. A thin, slack
 *     coat: still painted (it is not raw metal and must never go chalk-matte),
 *     but the highlight is broad and dull and the sky barely registers.
 *
 * THE BUG THAT WAS IN HERE. `rivets` means "does the atlas draw bolt rows".
 * Both later factions answer no — the Pact builds in cut stone and the
 * Reclamation welds and torch-cuts — so both fell down the `'welded'` branch
 * and shipped wearing ALLIED CERAMIC GLAZE. A salvage army built out of
 * oxide-blackened scrap was rendering with a 0.42 clearcoat at 0.26 roughness
 * and env 0.95, which is a wet mirror finish; it is the single loudest reason
 * a Reclamation base reads as moulded plastic rather than as welded plate, and
 * it is visible as the broad smeared highlight across every large flat face in
 * the Reclamation crops `tools/sobel.mjs` writes. Three of the four armies had
 * one army's surface.
 *
 *   STONE / Pact — cut and polished masonry with jade inlay. Ceremonial, so
 *     not matte, but stone scatters: the coat stays thin and its roughness
 *     nearly doubles the Allied figure, and the sky reads on it without the
 *     mirror.
 *
 *   SCRAP / Reclamation — torch-cut plate, sprayed, never buffed. The thinnest
 *     coat of the four and the slackest, but env stays well above the Soviet
 *     figure ON PURPOSE and that is a deliberate call rather than an average:
 *     this is the darkest architecture in the game (#4E4956 against Allied
 *     bone) and sky fill is the only thing keeping its silhouette legible
 *     against terrain. Dropping env with the coat made it read as a hole.
 *
 * RULING #3's 0.30 @ 0.38 / env 0.80 stays the CENTRE of that spread; NO branch
 * is allowed to reach zero clearcoat, which is the failure R10 names.
 */
export type StructureCoat = 'glaze' | 'field' | 'stone' | 'scrap';

export const STRUCTURE_COATS: Readonly<Record<StructureCoat, {
  clearcoat: number; clearcoatRoughness: number; envMapIntensity: number;
}>> = {
  glaze: { clearcoat: 0.24, clearcoatRoughness: 0.42, envMapIntensity: 0.72 },
  field: { clearcoat: 0.12, clearcoatRoughness: 0.58, envMapIntensity: 0.56 },
  stone: { clearcoat: 0.10, clearcoatRoughness: 0.62, envMapIntensity: 0.58 },
  // Dark salvage needs more sky reflection than olive field plate or its open
  // frame collapses into one black shape at RTS distance. The broad, rough
  // highlight still reads as oxidised steel rather than clear-coated paint.
  scrap: { clearcoat: 0.07, clearcoatRoughness: 0.72, envMapIntensity: 0.68 },
};

/**
 * The coat a faction gets when its palette does not name one. This is the old
 * behaviour exactly, and it is the default so that `buildings.system.ts` — which
 * fills the shared Allied/Soviet library and is not this pass's file — keeps
 * the surfaces it has always had without being touched.
 */
export function defaultCoat(atlas: GreebleAtlas): StructureCoat {
  return atlas.spec.plating === 'welded' ? 'glaze' : 'field';
}

/**
 * The routers. See `UnitFactory.unitMaterialFor` — same shape, same reason.
 *
 * `structureDepthMaterialFor` returns NULL on the node path and that is the
 * whole of `STAGE_D_TSL_GAPS` #1 in one line: `object.customDepthMaterial` is
 * read in exactly one file in three 0.185 (`WebGLShadowMap.js`), and the node
 * renderer instead harvests `castShadowPositionNode` off the object's own
 * material — which `createStructureNodeMaterial` sets. Assigning a
 * `MeshDepthMaterial` there would be inert, and `MeshDepthMaterial` is not in
 * `StandardNodeLibrary` at all. See `docs/RENDER_FINDINGS.md` §7e.
 */
export function structureMaterialFor(
  atlas: GreebleAtlas, name: string, coat?: StructureCoat,
): THREE.Material {
  const np = nodePath();
  return np !== null
    ? np.createStructureMaterial(atlas, name, coat)
    : createStructureMaterial(atlas, name, coat);
}

export function padMaterialFor(atlas: GreebleAtlas, name: string): THREE.Material {
  const np = nodePath();
  return np !== null ? np.createPadMaterial(atlas, name) : createPadMaterial(atlas, name);
}

export function createStructureMaterial(
  atlas: GreebleAtlas, name: string, coat?: StructureCoat,
): THREE.MeshPhysicalMaterial {
  const mat = createUnitMaterial(atlas, name);
  const c = STRUCTURE_COATS[coat ?? defaultCoat(atlas)];
  mat.clearcoat = c.clearcoat;
  mat.clearcoatRoughness = c.clearcoatRoughness;
  mat.envMapIntensity = c.envMapIntensity;
  applyStructureRuntimeShader(mat, atlas.ormMap, true);
  return mat;
}

/**
 * Foundation pads. Bible 5.4's "Terrain / ground" class: roughness 0.88,
 * env 0.35, NO clearcoat. The ORM map still drives per-pixel roughness, so the
 * scalar stays 1.0 and the class shows up as the atlas's own authored values
 * plus these two overrides.
 */
export function createPadMaterial(atlas: GreebleAtlas, name: string): THREE.MeshPhysicalMaterial {
  const mat = createUnitMaterial(atlas, name);
  mat.clearcoat = 0;
  mat.clearcoatRoughness = 1;
  mat.envMapIntensity = 0.35;
  applyStructureRuntimeShader(mat, atlas.ormMap, false);
  return mat;
}

/* ==========================================================================
 * 6. THE MODEL
 * ========================================================================== */

export interface StructureStats {
  key: string;
  primaryCount: number;
  greebleCount: number;
  dominantFraction: number;
  dominantName: string;
  teamFraction: number;
  /** Structure + foundation share in the faction's chromatic colour family. */
  factionColourFraction: number;
  emissiveFraction: number;
  insigniaCount: number;
  /** Area-weighted DRAWN-DETAIL coverage over the atlas tiles this model
   *  actually samples. This is the R1 gate — see `validateStructure`. */
  detailCoverage: number;
  /** Area-weighted Sobel coverage over the same tiles. Reported, not gated. */
  edgeCoverage: number;
  /** Salt-and-pepper ratio of the atlas. Gated to ~0. */
  speckleRatio: number;
  /** "Is this a rectangle made of rectangles?" — see `structureBoxiness`. */
  boxiness: StructureBoxinessReport;
  /** Metres: width, height, length. */
  bounds: [number, number, number];
  /** The frozen roofline this was authored against. */
  targetHeight: number;
  surfaceArea: number;
  triangles: number;
  parts: number;
  errors: string[];
  warnings: string[];
}

export interface StructureModel {
  key: string;
  name: string;
  faction: StructureFaction;
  cls: StructureClass;
  /** Footprint in cells, so placement can validate without geometry. */
  footprintW: number;
  footprintH: number;
  /** Everything that does not slew and is not the pad. */
  body: THREE.BufferGeometry;
  /** The foundation slab. Null only for walls, which sit straight on terrain. */
  pad: THREE.BufferGeometry | null;
  /** A defence turret, or null. Origin is the turret pivot, +Z forward. */
  turret: THREE.BufferGeometry | null;
  turretPivot: [number, number, number];
  material: THREE.Material;
  padMaterial: THREE.Material;
  atlas: GreebleAtlas;
  sockets: SocketDef[];
  turretSockets: SocketDef[];
  bounds: [number, number, number];
  stats: StructureStats;
  /** A fresh Object3D, for the showcase rack and cameo baking. */
  prototype(): THREE.Object3D;
}

function bandOk(v: number, lo: number, hi: number): boolean { return v >= lo && v <= hi; }
function pct(v: number): string { return `${(v * 100).toFixed(1)}%`; }

/** Axis-aligned bounds over every mass, mirrored copies included. */
function massBounds(masses: readonly StructureMass[]): {
  min: [number, number, number]; max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const m of masses) {
    const e = massExtents(m);
    for (const sgn of m.mirrorX ? [1, -1] : [1]) {
      const c = [m.anchor[0] * sgn, m.anchor[1], m.anchor[2]];
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], c[a] - e[a] * 0.5);
        max[a] = Math.max(max[a], c[a] + e[a] * 0.5);
      }
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/**
 * UNION side-elevation area by rasterising every mass into a 192x192 grid.
 * Summing per-mass areas over-counts wildly — a crown sitting on a slab
 * double-counts the overlap and every greeble inflates the denominator — and
 * "the dominant feature is N% of projected area" is a statement about the
 * SILHOUETTE, so the silhouette is what gets measured.
 */
function silhouette(masses: readonly StructureMass[], min: V3, max: V3): number {
  const N = 192;
  const z0 = min[2], y0 = min[1];
  const dz = Math.max(1e-6, max[2] - z0), dy = Math.max(1e-6, max[1] - y0);
  const grid = new Uint8Array(N * N);
  for (const m of masses) {
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

/** Side-elevation projected area of one mass, square metres. */
function projectedArea(m: StructureMass): number {
  const [, ey, ez] = massExtents(m);
  const shape = m.primitive === 'lathe'
    ? (m.profile === 'sphere' || m.profile === 'dome' ? Math.PI / 4 : 0.94)
    : m.primitive === 'prism' ? 0.90 : 1.0;
  return ey * ez * shape;
}

/* --------------------------------------------------------------------------
 * 5b. THE BOXINESS GATE, FOR ARCHITECTURE
 *
 * `MassList.boxiness()` has existed since the de-boxify pass and is described
 * everywhere in this repo as the thing that "rejects any model whose silhouette
 * is more than ~85% axis-aligned rectangle". It takes a `UnitMassList`.
 * `validateUnit` calls it. `validateStructure` NEVER DID — so for the entire
 * life of the building roster the gate has been documented, believed in, and
 * inert on the half of the game that is made of the biggest flattest walls.
 * Three structures were over the unit reject line when this was first measured.
 *
 * It is reimplemented here rather than imported because the unit version takes
 * a `UnitMassList` and computes `unitBounds`/`silhouetteArea` off it, and
 * because a structure needs two things a vehicle does not:
 *
 *   - THE PAD IS EXCLUDED. It is a deliberately flat axis-aligned slab that
 *     every structure carries, it is ground rather than building, and including
 *     it would mean the metric mostly measured the foundation.
 *   - MIRRORED PAIRS COUNT TWICE, exactly as they do for a hull: two flat walls
 *     are twice as boxy as one.
 *
 * Everything else — the sub-metrics, the weights, the bands — is deliberately
 * the SAME arithmetic as `MassList.BOXINESS`, so a number here is comparable to
 * a number quoted for a hull and the two halves of the game can be judged on
 * one scale.
 * -------------------------------------------------------------------------- */

/** Where a structure is held. Wider than the unit band — see `STRUCTURE_BOXINESS`. */
export interface StructureBoxinessReport {
  /** Area-weighted axis-aligned flank-surface share over the primary masses. */
  axisFraction: number;
  /** Side-elevation silhouette fill of its own bounding rectangle. */
  rectFill: number;
  /** `axisFraction * 0.62 + rectFill * 0.38`. 1.0 is a plain box. */
  score: number;
  /** The primary mass contributing the most axis-aligned area. */
  worst: string;
  worstFraction: number;
}

/**
 * The band, per structure class.
 *
 * A WALL PANEL IS ALLOWED TO BE A WALL. A 4 m wall segment whose whole job is to
 * be a straight run of parapet cannot be de-boxified without stopping being a
 * wall, and RA3's are rectangles too — so walls get a much higher ceiling and
 * are held only against "did anyone chamfer it at all".
 *
 * `structure` and `defence` sit ABOVE the unit reject line (0.86) rather than
 * at it, and the reason is honest rather than convenient: a building is a
 * building, its dominant mass is legitimately a big volume, and the complaint
 * this metric encodes ("a rectangle made of rectangles") starts biting later on
 * architecture than on a tank. The warn line is where a critic starts pointing.
 *
 * THE COMPOSITE REJECT LINE WAS MEASURED, THEN MOVED. It started at 0.88 and a
 * deliberately bad input — three plain axis-aligned slabs stacked into a
 * wedding cake, `tests/building-shape.spec.ts` — scored 0.851 and passed it,
 * because a stepped silhouette only fills ~60% of its bounding rectangle and
 * `rectWeight` then holds the composite down however flat the walls are. Only
 * the `axisReject` half of the OR caught it. A line that a textbook failure
 * cannot reach is not a line, so it is 0.84: still 21 points clear of the
 * boxiest thing in the shipped roster (meridian_forgeyard at 0.632) and 12
 * clear of the warn, and now the wedding cake fails both halves.
 */
export const STRUCTURE_BOXINESS = {
  axisWeight: 0.62,
  rectWeight: 0.38,
  warn: { structure: 0.72, defence: 0.76, wall: 0.94 },
  reject: { structure: 0.84, defence: 0.86, wall: 0.99 },
  /** The brief's own number, applied to the axis sub-metric directly. */
  axisWarn: { structure: 0.72, defence: 0.78, wall: 0.96 },
  axisReject: { structure: 0.85, defence: 0.88, wall: 1.01 },
} as const;

/**
 * Measure a structure's boxiness. Pure arithmetic over the mass parameters —
 * no mesh, no GL, no texture — so a def author gets the number back before a
 * triangle exists, and a test can assert it with no renderer.
 */
export function structureBoxiness(list: StructureMassList): StructureBoxinessReport {
  const body = list.masses.filter((m) => (m.target ?? 'body') !== 'pad');
  let flat = 0, total = 0;
  let worst = '(none)', worstFraction = 0, worstArea = 0;
  for (const m of expandMasses(body)) {
    if (m.role !== MassRole.Primary) continue;
    const c = structureChamfer(m, list.faction);
    const a = massFlankSurface(m, c);
    const t = a.x + a.z + a.other;
    if (!(t > 1e-9)) continue;
    const mult = m.mirrorX === true ? 2 : 1;
    const f = massAxisAlignedFraction(m, c);
    flat += f * t * mult;
    total += t * mult;
    if (f * t * mult > worstArea) { worstArea = f * t * mult; worst = m.name; worstFraction = f; }
  }
  const axisFraction = total > 1e-9 ? flat / total : 0;

  const bb = massBounds(body.length > 0 ? body : list.masses);
  const rect = Math.max(1e-6, (bb.max[1] - bb.min[1]) * (bb.max[2] - bb.min[2]));
  const rectFill = Math.min(1, silhouette(body, bb.min, bb.max) / rect);

  return {
    axisFraction,
    rectFill,
    score: axisFraction * STRUCTURE_BOXINESS.axisWeight + rectFill * STRUCTURE_BOXINESS.rectWeight,
    worst,
    worstFraction,
  };
}

/**
 * THE GATE. Same philosophy as `validateUnit` — reject at build time, not in
 * review — with the bands a structure is actually held to.
 */
export function validateStructure(
  list: StructureMassList,
  visible: Map<SlotName, number>,
  padVisible: Map<SlotName, number>,
  raw: Map<SlotName, number>,
  bounds: [number, number, number],
  triangles: number,
  parts: number,
  atlas: GreebleAtlas,
  padAtlas: GreebleAtlas,
): StructureStats {
  const errors: string[] = [];
  const warnings: string[] = [];
  const V = BUILDING_VALIDATION;
  const cls: StructureClass = list.cls ?? 'structure';

  /* -- 5b: the de-boxify gate, which used to run on hulls only ------------ */
  const box = structureBoxiness(list);
  if (box.score > STRUCTURE_BOXINESS.reject[cls] || box.axisFraction > STRUCTURE_BOXINESS.axisReject[cls]) {
    errors.push(
      `boxiness ${pct(box.score)} / axis-aligned surface ${pct(box.axisFraction)} exceeds the ` +
      `${pct(STRUCTURE_BOXINESS.reject[cls])} / ${pct(STRUCTURE_BOXINESS.axisReject[cls])} ceiling ` +
      `for a ${cls} — "${box.worst}" is ${pct(box.worstFraction)} flat axis-aligned wall. ` +
      `Taper it, shear it, cut its corners or lathe it; a chamfer alone will not move this.`);
  } else if (box.score > STRUCTURE_BOXINESS.warn[cls] || box.axisFraction > STRUCTURE_BOXINESS.axisWarn[cls]) {
    warnings.push(
      `boxiness ${pct(box.score)} (axis ${pct(box.axisFraction)}, rect fill ${pct(box.rectFill)}) is above ` +
      `the ${pct(STRUCTURE_BOXINESS.warn[cls])} / ${pct(STRUCTURE_BOXINESS.axisWarn[cls])} target for a ` +
      `${cls}; "${box.worst}" is the flattest primary mass`);
  }

  const primaries = list.masses.filter((m) => m.role === MassRole.Primary);
  const greebles_ = list.masses.filter((m) => m.role === MassRole.Greeble);
  // Repeated hardware — a run of corner rails, a lattice bay — is ONE readable
  // object to the eye, and bible 5.3's budget is about things a critic can
  // point at from across the map.
  const greebleObjects = new Set(greebles_.map((m) => m.group ?? m.name)).size;

  if (!bandOk(primaries.length, V.primaryMassMin, V.primaryMassMax)) {
    errors.push(
      `primary mass count ${primaries.length} outside ${V.primaryMassMin}-${V.primaryMassMax}`);
  }
  const greebleMin = V.greebleMin[cls];
  if (!bandOk(greebleObjects, greebleMin, V.greebleMax)) {
    warnings.push(`greeble count ${greebleObjects} outside ${greebleMin}-${V.greebleMax} for a ${cls}`);
  }

  // The pad is scenery, not silhouette: including it would swamp the dominant
  // fraction of every structure with a flat slab. The turret is excluded from
  // the FOOTPRINT check further down for the opposite reason — a gun barrel
  // sweeping outside its own cells is what a gun barrel is for — but it counts
  // toward the outline like everything else.
  const body = list.masses.filter((m) => (m.target ?? 'body') !== 'pad');
  const fixed = body.filter((m) => (m.target ?? 'body') !== 'turret');
  const bb = massBounds(body);
  const sil = Math.max(1e-6, silhouette(body, bb.min, bb.max));
  let dominant = primaries[0] ?? list.masses[0];
  let dominantArea = 0;
  for (const m of body) {
    if (m.role !== MassRole.Primary) continue;
    const a = projectedArea(m);
    if (a > dominantArea) { dominantArea = a; dominant = m; }
  }
  const dominantFraction = Math.min(1, dominantArea / sil);
  const domBand = V.dominantFraction[cls];
  if (domBand !== null && !bandOk(dominantFraction, domBand[0], domBand[1])) {
    errors.push(
      `dominant mass "${dominant?.name}" is ${pct(dominantFraction)} of the silhouette, ` +
      `outside ${pct(domBand[0])}-${pct(domBand[1])} for a ${cls} — nothing else in the ` +
      `outline is doing any work`);
  }

  /* -- surface shares, in SCREEN-PROJECTED area -------------------------- */
  // Raw triangle area counts a slab's back face and a pad's underside and
  // under-weights the decks a 39-degree camera actually sees, and every rule
  // below (R-T1, R-T5, scorecard #21/#34) is scored from a screenshot.
  let visibleArea = 0;
  for (const a of visible.values()) visibleArea += a;
  visibleArea = Math.max(1e-6, visibleArea);
  let surfaceArea = 0;
  for (const a of raw.values()) surfaceArea += a;

  const teamFraction = (visible.get('teamSlab') ?? 0) / visibleArea;
  let factionColourArea = 0;
  for (const [slot, area] of visible) {
    factionColourArea += area * atlas.metrics.factionColourTileCover[slot];
  }
  let factionVisibleArea = visibleArea;
  for (const [slot, area] of padVisible) {
    factionVisibleArea += area;
    factionColourArea += area
      * padAtlas.metrics.factionColourTileCover[padSurfaceSlot(list.key, slot)];
  }
  const factionColourFraction = factionColourArea / Math.max(1e-6, factionVisibleArea);
  const emissiveFraction =
    ((visible.get('emissive') ?? 0) * atlas.metrics.emissiveTileCover) / visibleArea;

  const teamBand = V.teamFraction[cls];
  if (!bandOk(teamFraction, teamBand[0], teamBand[1])) {
    errors.push(
      `team colour is ${pct(teamFraction)} of surface, outside ` +
      `${pct(teamBand[0])}-${pct(teamBand[1])} for a ${cls} (R-T1 — and it is flat ` +
      `slabs, never a tint)`);
  }

  const insigniaCount = list.masses.filter((m) => m.role === MassRole.Insignia).length;
  if (cls === 'structure' && insigniaCount !== V.insigniaCount) {
    errors.push(`${insigniaCount} insignia decals; R-T4 requires exactly ${V.insigniaCount}`);
  } else if (cls !== 'structure' && insigniaCount !== 0) {
    errors.push(`a ${cls} carries ${insigniaCount} insignia decals; it should carry none`);
  }
  const emisBand = V.emissiveFraction[cls];
  if (emissiveFraction > 0 && !bandOk(emissiveFraction, emisBand[0], emisBand[1])) {
    warnings.push(
      `emissive is ${pct(emissiveFraction)} of surface, outside ` +
      `${pct(emisBand[0])}-${pct(emisBand[1])} for a ${cls} (R-T5)`);
  }

  /* -- R1, weighted by the tiles this model really samples ----------------
   *
   * The gate used to be Sobel coverage against `V.sobelFloor` (30%), and that
   * number is why the atlas generator grew a noise field in the first place:
   * the cheapest way to raise Sobel coverage is fbm, and 30% is more edge than
   * an RA3 building HAS. Look at `docs/surface-refs/ra3-structures.png` — the
   * walls are large unbroken slabs of flat colour with a few strong seams and
   * bright accent bands. Measured as Sobel that is a low number, and it is the
   * correct look.
   *
   * So the floor is on DRAWN structure — texels a painter actually put a seam,
   * a pocket edge, a louvre or a decal on — and there is a hard CEILING on
   * speckle, which is the failure the old gate was silently rewarding.
   */
  let detail = 0, cover = 0, coverWeight = 0;
  for (const [slot, area] of visible) {
    detail += detailCoverage(atlas.structure, atlas.size, slot) * area;
    cover += edgeCoverage(atlas.surface, slot) * area;
    coverWeight += area;
  }
  const detailFrac = coverWeight > 0 ? detail / coverWeight : 0;
  const coverage = coverWeight > 0 ? cover / coverWeight : 0;
  if (detailFrac < SURFACE_BUDGET.detailFloorStructure) {
    errors.push(
      `drawn-detail coverage ${pct(detailFrac)} is below the ` +
      `${pct(SURFACE_BUDGET.detailFloorStructure)} floor — this reads as untextured primitives (R1)`);
  }
  if (atlas.metrics.speckleRatio > SURFACE_BUDGET.speckleCeiling) {
    errors.push(
      `atlas speckle ratio ${pct(atlas.metrics.speckleRatio)} exceeds the ` +
      `${pct(SURFACE_BUDGET.speckleCeiling)} ceiling — there is per-pixel noise in the albedo or ` +
      `the height field, and an RA3 wall has none`);
  }
  if (coverage > 0.50) {
    warnings.push(
      `Sobel coverage ${pct(coverage)} is above 50% — bible 5.3 says a surface that busy reads ` +
      `as noise however it was drawn`);
  }

  /* -- the frozen dimension table ---------------------------------------- */
  const tol = V.heightTolerance;
  if (Math.abs(bounds[1] - list.height) > list.height * tol) {
    errors.push(
      `silhouette is ${bounds[1].toFixed(2)} m against a frozen roofline of ` +
      `${list.height.toFixed(2)} m (+/-${(tol * 100).toFixed(0)}%)`);
  }
  const wantW = list.footprintW * CELL, wantD = list.footprintH * CELL;
  // The pad legitimately overhangs the footprint (ALLIED-6 / SOVIET-7), so the
  // check is on the BODY, and it may not spill onto a neighbour's cells.
  const fb = massBounds(fixed.length > 0 ? fixed : body);
  const bodyW = fb.max[0] - fb.min[0], bodyD = fb.max[2] - fb.min[2];
  if (bodyW > wantW + 0.02 || bodyD > wantD + 0.02) {
    warnings.push(
      `body is ${bodyW.toFixed(2)}x${bodyD.toFixed(2)} m on a ` +
      `${wantW}x${wantD} m footprint — it overhangs its own cells`);
  }

  /* -- sockets ------------------------------------------------------------ */
  const seen = new Set<number>();
  for (const s of list.sockets) {
    // The bridge keeps ONE socket per PartId and warns on the rest, so a
    // duplicate here is a silent content bug unless it is caught now.
    if (seen.has(s.part)) errors.push(`duplicate socket for PartId ${s.part}`);
    seen.add(s.part);
    if (s.turret === true && list.turretPivot === undefined) {
      errors.push(`socket ${s.part} is turret-space but the structure has no turretPivot`);
    }
  }
  if (list.turretPivot !== undefined && !list.masses.some((m) => (m.target ?? 'body') === 'turret')) {
    errors.push('turretPivot is set but no mass targets the turret');
  }

  return {
    key: list.key,
    primaryCount: primaries.length,
    greebleCount: greebleObjects,
    dominantFraction,
    dominantName: dominant?.name ?? '(none)',
    teamFraction,
    factionColourFraction,
    emissiveFraction,
    insigniaCount,
    detailCoverage: detailFrac,
    edgeCoverage: coverage,
    speckleRatio: atlas.metrics.speckleRatio,
    boxiness: box,
    bounds,
    targetHeight: list.height,
    surfaceArea,
    triangles,
    parts,
    errors,
    warnings,
  };
}

/** One line per structure, for the boot report and the critic loop. */
export function formatStructureStats(s: StructureStats): string {
  return (
    `${s.key.padEnd(22)} ${s.primaryCount}+${s.greebleCount}  ` +
    `dom ${pct(s.dominantFraction)}  team ${pct(s.teamFraction)}  ` +
    `faction ${pct(s.factionColourFraction)}  ` +
    `emis ${pct(s.emissiveFraction)}  detail ${pct(s.detailCoverage)}  ` +
    `sobel ${pct(s.edgeCoverage)}  speckle ${pct(s.speckleRatio)}  ` +
    `boxy ${pct(s.boxiness.score)}/${pct(s.boxiness.axisFraction)}  ` +
    `${s.bounds.map((b) => b.toFixed(1)).join('x')} m  ${s.triangles} tris  ${s.parts} parts`
  );
}

/**
 * Assemble one structure. Throws in a dev build if the mass list violates the
 * bands — R8's "reject at build time, not in review", for architecture.
 */
export function buildStructure(
  list: StructureMassList,
  atlas: GreebleAtlas,
  padAtlas: GreebleAtlas,
  material: THREE.Material,
  padMaterial: THREE.Material,
): StructureModel {
  const bodyMasses = list.masses.filter((m) => (m.target ?? 'body') !== 'pad');
  const bb = massBounds(bodyMasses.length > 0 ? bodyMasses : list.masses);
  const bounds: [number, number, number] = [
    bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2],
  ];
  const height = Math.max(1e-6, bounds[1]);
  // How far a structure sinks at buildProgress 0: its whole silhouette plus a
  // margin, so nothing ever peeks above the pad before construction starts.
  const rise = bounds[1] + BUILDING_ANIM.riseMargin;

  const bodyAcc = new MeshAcc();
  const padAcc = new MeshAcc();
  const turretAcc = new MeshAcc();
  const pivot = (list.turretPivot ?? [0, 0, 0]) as V3;

  const ctxFor = (acc: MeshAcc, a: GreebleAtlas, varyPad = false): BuildCtx => ({
    acc,
    uv: (slot) => a.uv[varyPad ? padSurfaceSlot(list.key, slot) : slot],
    bevel: (slot) => a.bevelUv[varyPad ? padSurfaceSlot(list.key, slot) : slot],
  });

  let phase = 0;
  for (const m of expandMasses(list.masses)) {
    const target = m.target ?? 'body';
    const acc = target === 'pad' ? padAcc : target === 'turret' ? turretAcc : bodyAcc;
    const ctx = ctxFor(acc, target === 'pad' ? padAtlas : atlas, target === 'pad');
    const chamfer = structureChamfer(m, list.faction);
    const capSlot = m.capSlot ?? m.slot;

    // Turret geometry is authored in MODEL space and rebased onto the pivot,
    // so a def author never does the subtraction by hand.
    const anchor: V3 = target === 'turret'
      ? [m.anchor[0] - pivot[0], m.anchor[1] - pivot[1], m.anchor[2] - pivot[2]]
      : (m.anchor as V3);

    const feature = m.feature ?? (target === 'pad' ? Feature.Static : Feature.Body);
    // A turret is transformed by the bridge, not by us, so it must not carry a
    // rise offset — the bridge would rotate the sunk geometry about the ring.
    const massRise = target === 'turret' ? 0 : rise;
    phase = (phase + 0.37) % 1;

    // The mass's own Y extent, rotation included, and the world Y of its
    // underside. Mirroring is about X only, so both survive the mirror loop.
    const massH = massExtents(m)[1];
    const footY = anchor[1] - massH * 0.5;

    for (const mirror of m.mirrorX ? [false, true] : [false]) {
      acc.setTransform(m.rot as V3 | undefined, anchor, mirror);
      // The ambient ramp is always measured from the GROUND, so a turret piece
      // rebased onto its ring still darkens correctly toward its base.
      // Large architectural volumes sit one tonal step behind applied trim and
      // faction plates, the same broad-value hierarchy used by units. Pads are
      // ground surfaces and stay untouched; an authored tint always wins.
      const massTint = m.tint
        ?? (target !== 'pad' && m.role === MassRole.Primary
          ? BUILDING_GREEBLE.primaryMassTint
          : 1);
      acc.setTint(height, massTint);
      // The seam ramp is measured from THIS MASS's footline instead, which is
      // the whole point of it: a lamp hood eight metres up needs a contact
      // shadow where it meets the wall, and the ground ramp saturated at 55%
      // of the building's height and stopped saying anything about it.
      acc.setMassAo(footY, massH);
      acc.setFeature({ code: feature, rise: massRise, anim: m.anim ?? 0, phase });

      switch (m.primitive) {
        case 'lathe':
          buildLathe(ctx, m, chamfer, m.slot, capSlot);
          break;
        case 'prism':
          buildPrism(ctx, m, chamfer, m.slot, capSlot);
          break;
        default: {
          // The eleven Shapes.ts primitives. `shapeSpecFor` returns null only
          // for the legacy 'box', which falls through to `buildBox` unchanged.
          const spec = shapeSpecFor(m, chamfer);
          if (spec !== null) {
            emitMassShape(
              acc, target === 'pad' ? padAtlas : atlas, m, spec, structurePaintSlot, 'paintMed',
            );
            break;
          }
          buildBox(ctx, m, chamfer, (face, area) => {
            const override = m.faceSlots?.[face];
            if (override !== undefined) return override;
            // `paintMed` is the author's way of saying "auto by area"; a wall
            // face gets slab-scale panel runs, a 0.3 m sensor box gets a seam.
            if (m.slot === 'paintMed') return structurePaintSlot(area);
            return m.slot;
          });
          break;
        }
      }
    }
  }

  // The share metrics (R-T1 team colour, R-T5 emissive, scorecard #34 Sobel)
  // are measured over the STRUCTURE, not over its ground contact. A 13 x 13 m
  // pad is a third of a Construction Yard's projected area and would drag every
  // one of those fractions below its band while nothing about the building
  // itself had changed.
  const visible = new Map<SlotName, number>();
  const padVisible = new Map<SlotName, number>();
  const raw = new Map<SlotName, number>();
  for (const acc of [bodyAcc, turretAcc]) {
    for (const [s, a] of acc.visibleAreaBySlot) visible.set(s, (visible.get(s) ?? 0) + a);
  }
  for (const [s, a] of padAcc.visibleAreaBySlot) {
    padVisible.set(s, (padVisible.get(s) ?? 0) + a);
  }
  for (const acc of [bodyAcc, padAcc, turretAcc]) {
    for (const [s, a] of acc.areaBySlot) raw.set(s, (raw.get(s) ?? 0) + a);
  }

  const parts = 1 + (padAcc.isEmpty() ? 0 : 1) + (turretAcc.isEmpty() ? 0 : 1);
  const stats = validateStructure(
    list, visible, padVisible, raw, bounds,
    bodyAcc.triangles + padAcc.triangles + turretAcc.triangles,
    parts, atlas, padAtlas,
  );

  if (stats.errors.length > 0) {
    const msg = `[buildings] ${list.key} REJECTED:\n  - ${stats.errors.join('\n  - ')}`;
    if (DEV) throw new Error(msg);
    console.error(msg);
  }
  for (const w of stats.warnings) console.warn(`[buildings] ${list.key}: ${w}`);

  const body = bodyAcc.toGeometry(`${list.key}.body`);
  const pad = padAcc.isEmpty() ? null : padAcc.toGeometry(`${list.key}.pad`);
  const turret = turretAcc.isEmpty() ? null : turretAcc.toGeometry(`${list.key}.turret`);

  const toDefs = (turretSpace: boolean): SocketDef[] => list.sockets
    .filter((s) => (s.turret ?? false) === turretSpace)
    .map((s) => ({
      part: s.part,
      x: turretSpace ? s.pos[0] - pivot[0] : s.pos[0],
      y: turretSpace ? s.pos[1] - pivot[1] : s.pos[1],
      z: turretSpace ? s.pos[2] - pivot[2] : s.pos[2],
      yaw: s.yaw ?? 0,
      pitch: s.pitch ?? 0,
    }));

  return {
    key: list.key,
    name: list.name,
    faction: list.faction,
    cls: list.cls ?? 'structure',
    footprintW: list.footprintW,
    footprintH: list.footprintH,
    body,
    pad,
    turret,
    turretPivot: [pivot[0], pivot[1], pivot[2]],
    material,
    padMaterial,
    atlas,
    sockets: toDefs(false),
    turretSockets: toDefs(true),
    bounds,
    stats,
    prototype(): THREE.Object3D {
      const root = new THREE.Group();
      root.name = list.key;
      const b = new THREE.Mesh(body, material);
      b.castShadow = true; b.receiveShadow = true;
      root.add(b);
      if (pad !== null) {
        const p = new THREE.Mesh(pad, padMaterial);
        p.castShadow = false; p.receiveShadow = true;
        root.add(p);
      }
      if (turret !== null) {
        const t = new THREE.Mesh(turret, material);
        t.position.set(pivot[0], pivot[1], pivot[2]);
        t.castShadow = true; t.receiveShadow = true;
        root.add(t);
      }
      return root;
    },
  };
}

/* ==========================================================================
 * 7. THE LIBRARY
 *
 * The handoff surface. `buildings.system.ts` fills it and hands geometries to
 * RenderBridge; nothing here creates a scene object except the optional
 * showcase rack.
 * ========================================================================== */

export interface StructurePalettes {
  structure: UnitPalette;
  pad: UnitPalette;
  panelDensity: number;
  seed: number;
  padSeed: number;
  /**
   * The surface class this army's architecture is made of. Omit to keep the
   * `rivets`-derived default — see `createStructureMaterial`, and note that
   * omitting it is what gave two factions the wrong army's finish.
   */
  coat?: StructureCoat;
}

/**
 * The structure atlas spec for one palette.
 *
 * Exported and pure so `BuildingLibrary.prewarm` can ask for EXACTLY the atlas
 * `build` will later ask for. A prewarm that computes its spec independently is
 * a prewarm that silently misses — the cache is keyed on the full spec hash, so
 * one different field means the worker builds an atlas nobody wants and the
 * main thread builds the real one anyway, at full cost, with no error.
 */
export function structureAtlasSpec(
  key: string, p: StructurePalettes, atlasSize: number,
): GreebleSpec {
  return {
    ...specForPalette(key, p.structure, atlasSize, p.seed),
    // `specForPalette` is the UNIT spec builder and it answers 'hull'. That is
    // the one field architecture must disagree with it on: bible 5.5 puts rust
    // on a building's chimneys, pipes and scaffolding, and scorecard #22 —
    // which is about vehicles — used to be enforced here by default.
    surfaceClass: 'structure',
    panelDensity: p.panelDensity,
    rivetPitchPx: BUILDING_GREEBLE.rivetPitchPx,
  };
}

/** The pad atlas spec. Same contract as `structureAtlasSpec`. */
export function padAtlasSpec(
  key: string, p: StructurePalettes, atlasSize: number,
): GreebleSpec {
  const padSize = Math.max(128, Math.round(
    atlasSize * (BUILDING_GREEBLE.padAtlasSize / BUILDING_GREEBLE.atlasSize)));
  return {
    ...specForPalette(key, p.pad, padSize, p.padSeed),
    // A foundation is authored by the architecture atlas generator but obeys
    // the concrete surface row: high roughness and zero clearcoat. Keeping it
    // distinct stops a painted-wall retune from glazing the apron beneath it.
    surfaceClass: 'foundation',
    panelDensity: BUILDING_GREEBLE.padPanelDensity,
    rivetPitchPx: BUILDING_GREEBLE.padRivetPitchPx,
  };
}

export class BuildingLibrary {
  private readonly models = new Map<string, StructureModel>();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly atlases = new Map<string, GreebleAtlas>();
  private readonly factory: GreebleFactory;
  /**
   * The one shadow-pass program every structure shares. Built on first ask
   * rather than in the constructor, because `buildingLibrary` is constructed at
   * module load and a WebGL material allocated there would outlive a match that
   * never started.
   */
  private depth: THREE.MeshDepthMaterial | null = null;

  constructor(factory: GreebleFactory = greebles) { this.factory = factory; }

  /**
   * The shadow-pass material for every structure part that casts.
   *
   * One instance for the whole game: it reads only `aState` and `aFeature`, so
   * nothing about a faction, an atlas or a coat can change it. See
   * `createStructureDepthMaterial`.
   */
  depthMaterial(): THREE.Material | undefined {
    // NULL ON THE NODE PATH — see `structureMaterialFor` above. `undefined` and
    // not null, because `BatchPartSpec.customDepthMaterial` is optional and an
    // explicit null there would set `mesh.customDepthMaterial = null`, which
    // three treats as "no override" only by accident of falsiness.
    if (nodePath() !== null) return undefined;
    if (this.depth === null) this.depth = createStructureDepthMaterial();
    return this.depth;
  }

  /**
   * Build this library's atlases off the main thread, before `build` needs them.
   *
   * Call it with the same lists and palettes `build` will be called with; it
   * derives the identical specs (see `structureAtlasSpec`) and hands them to the
   * worker pool. Every result lands in the shared `GreebleFactory` cache, so the
   * `build` calls that follow are cache hits and stay fully synchronous — which
   * is what keeps the R1 gate, `validateStructure` and every `atlas.metrics`
   * read working exactly as they did.
   *
   * Returns the number of atlases that actually came back from a worker. Zero is
   * a normal answer — no workers on this platform — and means `build` will do
   * what it always did.
   */
  async prewarm(
    lists: readonly StructureMassList[],
    palettes: (faction: StructureMassList['faction']) => StructurePalettes,
    atlasSize: number,
  ): Promise<number> {
    const specs = new Map<string, GreebleSpec>();
    for (const list of lists) {
      const p = palettes(list.faction);
      const structKey = `${list.faction}.structure`;
      const padKey = `${list.faction}.pad`;
      if (!specs.has(structKey)) specs.set(structKey, structureAtlasSpec(structKey, p, atlasSize));
      if (!specs.has(padKey)) specs.set(padKey, padAtlasSpec(padKey, p, atlasSize));
    }
    return this.factory.prewarm([...specs.values()]);
  }

  /**
   * Build (or return) one structure. The atlas and both materials are shared
   * across every structure of the faction, which is the whole draw-call
   * argument: 22 structures cost 4 materials.
   */
  build(list: StructureMassList, p: StructurePalettes, atlasSize: number): StructureModel {
    const existing = this.models.get(list.key);
    if (existing !== undefined) return existing;

    const structKey = `${list.faction}.structure`;
    const padKey = `${list.faction}.pad`;

    let atlas = this.atlases.get(structKey);
    if (atlas === undefined) {
      atlas = this.factory.atlas(structureAtlasSpec(structKey, p, atlasSize));
      this.atlases.set(structKey, atlas);
    }
    let padAtlas = this.atlases.get(padKey);
    if (padAtlas === undefined) {
      padAtlas = this.factory.atlas(padAtlasSpec(padKey, p, atlasSize));
      this.atlases.set(padKey, padAtlas);
    }

    let material = this.materials.get(structKey);
    if (material === undefined) {
      material = structureMaterialFor(atlas, structKey, p.coat);
      this.materials.set(structKey, material);
    }
    let padMaterial = this.materials.get(padKey);
    if (padMaterial === undefined) {
      padMaterial = padMaterialFor(padAtlas, padKey);
      this.materials.set(padKey, padMaterial);
    }

    const model = buildStructure(list, atlas, padAtlas, material, padMaterial);
    this.models.set(list.key, model);
    return model;
  }

  get(key: string): StructureModel | undefined { return this.models.get(key); }
  has(key: string): boolean { return this.models.has(key); }
  keys(): string[] { return Array.from(this.models.keys()); }
  all(): StructureModel[] { return Array.from(this.models.values()); }
  count(): number { return this.models.size; }
  /** Distinct materials in play. Never more than 4. */
  materialCount(): number { return this.materials.size; }
  atlasList(): GreebleAtlas[] { return Array.from(this.atlases.values()); }

  /** Footprint in cells for a key, for placement validation. */
  footprint(key: string): { w: number; h: number } | undefined {
    const m = this.models.get(key);
    return m === undefined ? undefined : { w: m.footprintW, h: m.footprintH };
  }

  dispose(): void {
    for (const m of this.models.values()) {
      m.body.dispose();
      m.pad?.dispose();
      m.turret?.dispose();
    }
    for (const mat of this.materials.values()) mat.dispose();
    // Not in `materials` (wrong type, and it is not keyed on an atlas), so it
    // needs its own line — a leaked program per match is exactly the kind of
    // thing nobody notices until the fourth skirmish of a session.
    this.depth?.dispose();
    this.depth = null;
    this.models.clear();
    this.materials.clear();
    this.atlases.clear();
    this.factory.dispose();
  }
}

/** The shared library. `buildings.system.ts` fills it; the bridge reads it. */
export const buildingLibrary = new BuildingLibrary(new GreebleFactory());

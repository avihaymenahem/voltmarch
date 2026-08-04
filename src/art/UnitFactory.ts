/**
 * ============================================================================
 * VOLTMARCH — src/art/UnitFactory.ts
 * ============================================================================
 * THE ASSEMBLER. Takes a `UnitMassList`, chamfers every convex edge, UV-maps
 * every face into the greeble atlas, bakes the contact/cavity gradient into
 * vertex colour, merges the whole thing into ONE geometry per moving part, and
 * refuses to return a model that fails the R8/R12 numbers.
 *
 * THE THREE DECISIONS THAT MATTER
 * -------------------------------
 * 1. EVERY EDGE IS CHAMFERED, and the chamfer strip samples a dedicated
 *    pre-brightened patch in the atlas (base +22% value, -15% saturation, bible
 *    5.5). A hard `BoxGeometry` edge is scorecard #11, an automatic fail; a
 *    chamfer with no highlight is only half the fix, because the read comes
 *    from the BAND, not from the geometry.
 *
 * 2. ONE MATERIAL PER FACTION, NOT PER UNIT. All 18 units share 3 atlases, so
 *    a unit costs 1-2 draw calls (hull + turret) instead of 6. That is what
 *    keeps 200 units under the 130-draw-call ceiling. Roughness/metalness/AO
 *    all come out of one ORM texture, so paint (0.52) and bare metal (0.32,
 *    metalness 0.82) coexist in a single batch.
 *
 * 3. MATERIALS ARE ONLY EVER CONSTRUCTED HERE (R10). `MeshPhysicalMaterial`
 *    with clearcoat 0.30 @ clearcoatRoughness 0.38 over roughness 0.52 is
 *    RULING #3 and is not negotiable, and `envMapIntensity` is asserted
 *    non-zero because zeroing it kills the silhouette rim (scorecard #23).
 *
 * ZERO GRIME. Nothing in this file adds a streak, a mud splash, a rust bloom or
 * a scratch to a vehicle (scorecard #22). The only darkening is recesses and
 * the ambient gradient, which are bible 5.5's "cavity darkening is the ONLY
 * wear".
 * ============================================================================
 */

import * as THREE from 'three';
import {
  MIN_CHAMFER, UNIT_GEOMETRY, UNIT_GREEBLE, UNIT_MATERIAL, UNIT_VALIDATION,
  type UnitPalette,
} from '../core/config';
import { clamp01, lerp, smoothstep } from '../core/math';
import { PartId, type ModelBuild, type ModelPart, type SocketDef } from '../core/types';
import {
  paintSlotForArea, SURFACE_BUDGET,
  type GreebleAtlas, type GreebleSpec, type SlotName, type UvRect,
  GreebleFactory, greebles,
} from './Greeble';
import {
  defaultChamfer, emitMassShape, expandMasses, latheProfile, planPolygon, shapeSpecFor,
  unitBounds, validateUnit,
  MassRole, type MassDef, type MassStats, type SlotAreas, type UnitMassList,
} from './MassList';

declare const __DEV__: boolean;
const DEV: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

/* ==========================================================================
 * 1. THE MESH BUILDER
 *
 * A flat accumulator. It owns the active transform so a mass builder only ever
 * emits local-space quads and never has to think about mirroring or winding.
 * ========================================================================== */

type V3 = readonly [number, number, number];

/**
 * How much of a face the RTS camera can ever see, averaged over all yaws.
 *
 * Scorecard #21 ("8-14% of vehicle surface as flat slabs") is scored from a
 * SCREENSHOT, and at a 39-degree pitch a horizontal deck contributes
 * sin(39) = 0.63 of its area to the frame while a vertical flank contributes
 * only cos(39)/pi = 0.25 averaged over a free yaw. Measuring raw surface area
 * therefore lets a unit pass the validator at 13% and still read as half
 * team-coloured on screen — which is exactly what a first draft of this roster
 * did. So the fraction is measured in screen-projected area instead.
 *
 * Closed form for `mean_theta max(0, A + B cos theta)` with A = ny sin(p) and
 * B = |n_horizontal| cos(p).
 */
const VIEW_PITCH = 39 * Math.PI / 180;
const SIN_PITCH = Math.sin(VIEW_PITCH);
const COS_PITCH = Math.cos(VIEW_PITCH);

export function viewWeight(nx: number, ny: number, nz: number): number {
  const a = ny * SIN_PITCH;
  const b = Math.hypot(nx, nz) * COS_PITCH;
  if (b < 1e-9) return Math.max(0, a);
  if (a >= b) return a;
  if (a <= -b) return 0;
  const t0 = Math.acos(-a / b);
  return (a * t0 + b * Math.sin(t0)) / Math.PI;
}

/** Ambient gradient + facing term baked into vertex colour. */
interface TintContext {
  /** Total unit height in metres, for the ambient ramp. */
  height: number;
  /** Per-mass multiplier. */
  massTint: number;
}

class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];

  /** Real triangle area per atlas slot, in square metres. */
  readonly areaBySlot = new Map<SlotName, number>();
  /** Triangle area weighted by how much of it the RTS camera can ever see. */
  readonly visibleAreaBySlot = new Map<SlotName, number>();
  triangles = 0;

  /** Active 3x3 rotation, row-major, and translation. */
  private m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private t: V3 = [0, 0, 0];
  private mirror = 1;
  private tint: TintContext = { height: 1, massTint: 1 };

  setTransform(rot: V3 | undefined, anchor: V3, mirrorX: boolean): void {
    const [rx, ry, rz] = rot ?? [0, 0, 0];
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    // Rz * Ry * Rx, matching three's default 'XYZ' euler order.
    this.m = [
      cy * cz, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
      sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
      -sy, cy * sx, cy * cx,
    ];
    this.mirror = mirrorX ? -1 : 1;
    this.t = [anchor[0] * this.mirror, anchor[1], anchor[2]];
  }

  setTint(ctx: TintContext): void { this.tint = ctx; }

  private xp(p: V3, out: number[]): void {
    const m = this.m;
    const x = m[0] * p[0] + m[1] * p[1] + m[2] * p[2];
    const y = m[3] * p[0] + m[4] * p[1] + m[5] * p[2];
    const z = m[6] * p[0] + m[7] * p[1] + m[8] * p[2];
    out[0] = x * this.mirror + this.t[0];
    out[1] = y + this.t[1];
    out[2] = z + this.t[2];
  }

  private xn(n: V3, out: number[]): void {
    const m = this.m;
    // Rotation is orthonormal, so the inverse-transpose is the rotation itself.
    out[0] = (m[0] * n[0] + m[1] * n[1] + m[2] * n[2]) * this.mirror;
    out[1] = m[3] * n[0] + m[4] * n[1] + m[5] * n[2];
    out[2] = m[6] * n[0] + m[7] * n[1] + m[8] * n[2];
  }

  /**
   * Vertex colour. Two effects, both from bible 3.3:
   *   - an ambient ramp so the bottom of a unit is darker than its deck, which
   *     is the baked half of "units without contact darkening float";
   *   - a facing term: downward faces lose ambient, upward faces gain the
   *     hemisphere fill. This is the cheap stand-in for baked crease AO on the
   *     geometry itself (the atlas carries the per-panel half).
   */
  private tintFor(y: number, ny: number): number {
    const t = this.tint;
    const ambient = lerp(0.66, 1.0, smoothstep(0, t.height * 0.45, y));
    const facing = ny < -0.4 ? UNIT_GREEBLE.cavityVertexTint : ny > 0.5 ? 1.05 : 1.0;
    // Allowed above 1 — an upward deck genuinely gains hemisphere fill.
    return Math.min(2, Math.max(0, ambient * facing * t.massTint));
  }

  private readonly tmpP = [0, 0, 0];
  private readonly tmpN = [0, 0, 0];

  private push(p: V3, n: V3, u: number, v: number): number {
    this.xp(p, this.tmpP);
    this.xn(n, this.tmpN);
    const i = this.pos.length / 3;
    this.pos.push(this.tmpP[0], this.tmpP[1], this.tmpP[2]);
    this.nrm.push(this.tmpN[0], this.tmpN[1], this.tmpN[2]);
    this.uv.push(u, v);
    const c = this.tintFor(this.tmpP[1], this.tmpN[1]);
    this.col.push(c, c, c);
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
    this.xn(want, this.tmpN);
    // Winding is derived, never assumed. Mirroring flips it and so does a
    // negative-determinant rotation; deriving it means neither can bite.
    if (nx * this.tmpN[0] + ny * this.tmpN[1] + nz * this.tmpN[2] >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
    const area = this.area3(a, b, c);
    this.areaBySlot.set(slot, (this.areaBySlot.get(slot) ?? 0) + area);
    const w = viewWeight(this.tmpN[0], this.tmpN[1], this.tmpN[2]);
    this.visibleAreaBySlot.set(slot, (this.visibleAreaBySlot.get(slot) ?? 0) + area * w);
    this.triangles++;
  }

  /** Emit a quad p0-p1-p2-p3 with an outward normal and a UV rect. */
  addQuad(p0: V3, p1: V3, p2: V3, p3: V3, n: V3, r: UvRect, slot: SlotName): void {
    const a = this.push(p0, n, r.u0, r.v0);
    const b = this.push(p1, n, r.u1, r.v0);
    const c = this.push(p2, n, r.u1, r.v1);
    const d = this.push(p3, n, r.u0, r.v1);
    this.tri(a, b, c, slot, n);
    this.tri(a, c, d, slot, n);
  }

  /** Emit a triangle with explicit UVs (used for lathe/prism caps). */
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
    const verts = this.pos.length / 3;
    g.setIndex(verts > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/* ==========================================================================
 * 2. PRIMITIVE BUILDERS
 * ========================================================================== */

/** UV rect helper: interpolate inside a rect. */
function uvAt(r: UvRect, u: number, v: number): [number, number] {
  return [lerp(r.u0, r.u1, u), lerp(r.v0, r.v1, v)];
}

type SlotResolver = (slot: SlotName) => UvRect;

interface BuildCtx {
  mb: MeshBuilder;
  /** Sampled tile rect for a slot. */
  uv: SlotResolver;
  /** The pre-brightened bevel patch for a slot. */
  bevel: SlotResolver;
}

const BOX_FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;
type BoxFaceName = typeof BOX_FACES[number];

/**
 * THE CHAMFERED FRUSTUM-BOX.
 *
 * Six inset face quads, twelve 45-degree edge strips, eight corner triangles.
 * A single-facet chamfer (rather than a rounded 3-segment fillet) is
 * deliberate: it produces one crisp specular band per edge, which is exactly
 * the 2-4 px highlight scorecard #11 looks for, at a third of the triangles.
 *
 * `taper` scales the top footprint and slides it in Z, which is how every
 * wedge, glacis, splayed skirt and trapezoid in the roster is made.
 */
function buildBox(ctx: BuildCtx, m: MassDef, chamfer: number, slotOf: (face: BoxFaceName, area: number) => SlotName): void {
  const [sx, sy, sz] = m.size;
  const c = Math.min(chamfer, Math.min(sx, sy, sz) * UNIT_GEOMETRY.chamferMaxFractionOfMin);
  const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
  const [tsx, tsz, toz] = m.taper ?? [1, 1, 0];

  // Corner (i,j,k) with i,j,k in {-1,+1}: the un-chamfered vertex.
  const corner = (i: number, j: number, k: number): V3 => {
    const scaleX = j > 0 ? tsx : 1;
    const scaleZ = j > 0 ? tsz : 1;
    const offZ = j > 0 ? toz : 0;
    return [i * hx * scaleX, j * hy, k * hz * scaleZ + offZ];
  };
  // The three cut-back vertices at that corner, one per axis.
  const vX = (i: number, j: number, k: number): V3 => { const p = corner(i, j, k); return [p[0] - i * c, p[1], p[2]]; };
  const vY = (i: number, j: number, k: number): V3 => { const p = corner(i, j, k); return [p[0], p[1] - j * c, p[2]]; };
  const vZ = (i: number, j: number, k: number): V3 => { const p = corner(i, j, k); return [p[0], p[1], p[2] - k * c]; };

  const nrm = (x: number, y: number, z: number): V3 => {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };

  /* -- the six faces ----------------------------------------------------- */
  const faceArea: Record<BoxFaceName, number> = {
    px: sy * sz, nx: sy * sz, py: sx * sz, ny: sx * sz, pz: sx * sy, nz: sx * sy,
  };
  const faceSlot = (f: BoxFaceName): SlotName => slotOf(f, faceArea[f]);
  const faceUv = (f: BoxFaceName): UvRect => ctx.uv(faceSlot(f));

  // +X / -X
  for (const i of [1, -1]) {
    const n = nrm(i, 0, 0);
    const f: BoxFaceName = i > 0 ? 'px' : 'nx';
    ctx.mb.addQuad(vX(i, -1, -i), vX(i, -1, i), vX(i, 1, i), vX(i, 1, -i), n, faceUv(f), faceSlot(f));
  }
  // +Y / -Y
  for (const j of [1, -1]) {
    const n = nrm(0, j, 0);
    const f: BoxFaceName = j > 0 ? 'py' : 'ny';
    ctx.mb.addQuad(vY(-j, j, -1), vY(j, j, -1), vY(j, j, 1), vY(-j, j, 1), n, faceUv(f), faceSlot(f));
  }
  // +Z / -Z
  for (const k of [1, -1]) {
    const n = nrm(0, 0, k);
    const f: BoxFaceName = k > 0 ? 'pz' : 'nz';
    ctx.mb.addQuad(vZ(-k, -1, k), vZ(k, -1, k), vZ(k, 1, k), vZ(-k, 1, k), n, faceUv(f), faceSlot(f));
  }

  /* -- the twelve edge chamfers ------------------------------------------ */
  const bev = ctx.bevel(faceSlot('px'));
  const bevSlot = faceSlot('px');
  // X-Y edges (vary along Z).
  for (const i of [1, -1]) for (const j of [1, -1]) {
    ctx.mb.addQuad(vX(i, j, -1), vY(i, j, -1), vY(i, j, 1), vX(i, j, 1), nrm(i, j, 0), bev, bevSlot);
  }
  // X-Z edges (vary along Y).
  for (const i of [1, -1]) for (const k of [1, -1]) {
    ctx.mb.addQuad(vX(i, -1, k), vZ(i, -1, k), vZ(i, 1, k), vX(i, 1, k), nrm(i, 0, k), bev, bevSlot);
  }
  // Y-Z edges (vary along X).
  for (const j of [1, -1]) for (const k of [1, -1]) {
    ctx.mb.addQuad(vY(-1, j, k), vZ(-1, j, k), vZ(1, j, k), vY(1, j, k), nrm(0, j, k), bev, bevSlot);
  }

  /* -- the eight corners -------------------------------------------------- */
  for (const i of [1, -1]) for (const j of [1, -1]) for (const k of [1, -1]) {
    ctx.mb.addTri(
      vX(i, j, k), vY(i, j, k), vZ(i, j, k), nrm(i, j, k), bevSlot,
      uvAt(bev, 0, 0), uvAt(bev, 1, 0), uvAt(bev, 0.5, 1),
    );
  }
}

/**
 * THE LATHE. Barrels, rollers, domes, pressure vessels, road wheels.
 * Faceted on purpose: scorecard #40 wants 12-16 visible facets, never a smooth
 * 32-segment tube. Bands whose profile step is both short and diagonal are
 * recognised as chamfer rims and get the bevel patch, so a barrel's muzzle ring
 * carries the same highlight as a box edge.
 */
function buildLathe(ctx: BuildCtx, m: MassDef, chamfer: number, sideSlot: SlotName, capSlot: SlotName): void {
  const [sx, sy, sz] = m.size;
  const segs = Math.max(6, m.segments ?? UNIT_GEOMETRY.cylSegments);
  const rings = UNIT_GEOMETRY.sphereRings;
  const prof = latheProfile(m.profile ?? 'cyl', clamp01(chamfer / Math.max(1e-6, sy)), m.topRadius ?? 1, rings);

  // Total profile length, so "short" bands can be detected.
  let totalLen = 0;
  for (let i = 1; i < prof.length; i++) {
    totalLen += Math.hypot((prof[i][0] - prof[i - 1][0]) * sx, (prof[i][1] - prof[i - 1][1]) * sy);
  }

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

    // A short diagonal step is a chamfer rim, not a wall — a barrel's muzzle
    // ring gets the same bevel highlight a box edge does.
    const isBevel = bandLen < totalLen * 0.20 && Math.abs(dr) > 1e-4 && Math.abs(dy) > 1e-4;
    const rect = isBevel ? bevUv : sideUv;

    for (let s = 0; s < segs; s++) {
      const a0 = at(r0, y0, s), a1 = at(r0, y0, s + 1);
      const b0 = at(r1, y1, s), b1 = at(r1, y1, s + 1);
      const mid = (s + 0.5) / segs * Math.PI * 2;
      // Band normal: perpendicular to the profile segment, swept radially. A
      // flat disc band collapses this to +-Y, so caps need no special case.
      const nr = dy, ny = -dr;
      const nl = Math.hypot(nr, ny) || 1;
      const n: V3 = [Math.cos(mid) * nr / nl, ny / nl, Math.sin(mid) * nr / nl];
      const ca = (t: number): [number, number] => uvAt(
        capUvRect, 0.5 + Math.cos(t / segs * Math.PI * 2) * 0.5, 0.5 + Math.sin(t / segs * Math.PI * 2) * 0.5);

      if (r0 < 1e-5) {
        ctx.mb.addTri(a0, b0, b1, n, capSlot, uvAt(capUvRect, 0.5, 0.5), ca(s), ca(s + 1));
      } else if (r1 < 1e-5) {
        ctx.mb.addTri(b0, a1, a0, n, capSlot, uvAt(capUvRect, 0.5, 0.5), ca(s + 1), ca(s));
      } else {
        const u0 = lerp(rect.u0, rect.u1, s / segs);
        const u1 = lerp(rect.u0, rect.u1, (s + 1) / segs);
        const bandRect: UvRect = isBevel
          ? { u0, v0: rect.v0, u1, v1: rect.v1 }
          : { u0, v0: lerp(rect.v0, rect.v1, v0), u1, v1: lerp(rect.v0, rect.v1, v1) };
        ctx.mb.addQuad(a0, a1, b1, b0, n, bandRect, sideSlot);
      }
    }
  }
}

/**
 * THE PRISM. An extruded plan with chamfered rims. This is the Soviet
 * brutalist slab — "a box with 45-degree chamfers on every vertical corner at
 * 6-9% of box width, reads as octagonal in plan" (bible 5.7 SOVIET 1).
 */
function buildPrism(ctx: BuildCtx, m: MassDef, chamfer: number, sideSlot: SlotName, capSlot: SlotName): void {
  const [sx, sy, sz] = m.size;
  const plan = planPolygon(m.plan ?? 'octagon', m.cornerCut ?? 0);
  const c = Math.min(chamfer, sy * 0.4);
  const inset = Math.min(chamfer, Math.min(sx, sz) * 0.2);

  const hy = sy * 0.5;
  const pt = (i: number, shrink: number): readonly [number, number] => {
    const p = plan[i % plan.length];
    // Shrink toward the plan centre by `shrink` metres, approximately.
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
    // Outward normal of the wall segment (CCW plan => outward is (dz, -dx)).
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const nOut: V3 = [dz / l, 0, -dx / l];

    // Wall, inset vertically by the rim chamfer.
    ctx.mb.addQuad(
      [a[0], -hy + c, a[1]], [b[0], -hy + c, b[1]],
      [b[0], hy - c, b[1]], [a[0], hy - c, a[1]],
      nOut, sideUv, sideSlot);

    // Top and bottom rim chamfers.
    const nUp: V3 = [nOut[0] * 0.7071, 0.7071, nOut[2] * 0.7071];
    const nDn: V3 = [nOut[0] * 0.7071, -0.7071, nOut[2] * 0.7071];
    ctx.mb.addQuad(
      [a[0], hy - c, a[1]], [b[0], hy - c, b[1]],
      [bi[0], hy, bi[1]], [ai[0], hy, ai[1]], nUp, bevUv, sideSlot);
    ctx.mb.addQuad(
      [ai[0], -hy, ai[1]], [bi[0], -hy, bi[1]],
      [b[0], -hy + c, b[1]], [a[0], -hy + c, a[1]], nDn, bevUv, sideSlot);
  }

  // Caps as fans from the plan centre.
  for (const [y, ny] of [[hy, 1], [-hy, -1]] as const) {
    for (let i = 0; i < n; i++) {
      const a = pt(i, inset), b = pt(i + 1, inset);
      ctx.mb.addTri(
        [0, y, 0], [a[0], y, a[1]], [b[0], y, b[1]], [0, ny, 0], capSlot,
        uvAt(capUv, 0.5, 0.5),
        uvAt(capUv, 0.5 + (a[0] / sx), 0.5 + (a[1] / sz)),
        uvAt(capUv, 0.5 + (b[0] / sx), 0.5 + (b[1] / sz)));
    }
  }
}

/* ==========================================================================
 * 3. THE MATERIAL FACTORY (R10)
 * ========================================================================== */

/**
 * THE ONLY PLACE A UNIT MATERIAL IS CONSTRUCTED.
 *
 * RULING #3: roughness 0.52, metalness 0, clearcoat 0.30 @ 0.38, env 0.80.
 * A broad diffuse lobe under a weak tight clear coat — both measured on the
 * same white hull — is what makes RA3 armour read as painted plastic. Do not
 * "optimise" this to `MeshStandardMaterial` (that is literally risk R10) and do
 * not zero `envMapIntensity` while debugging (that is the other half of R10).
 *
 * The ORM map is AUTHORITATIVE for roughness and metalness, so the scalar
 * multipliers are 1.0 by design: the map carries 0.52 on paint and 0.32/0.82 on
 * bare metal, which is how one batch serves both surface classes.
 */
export function createUnitMaterial(atlas: GreebleAtlas, name: string): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    name,
    map: atlas.map,
    normalMap: atlas.normalMap,
    normalScale: new THREE.Vector2(UNIT_MATERIAL.normalScale, UNIT_MATERIAL.normalScale),
    // One texture, three channels: R = ao, G = roughness, B = metalness.
    aoMap: atlas.ormMap,
    roughnessMap: atlas.ormMap,
    metalnessMap: atlas.ormMap,
    roughness: 1.0,
    metalness: 1.0,
    // Emissive is a MASKED channel. Bible 8.1 wants tiny area and high value;
    // an unmasked 2.6 over a whole hull veils the frame to white.
    emissive: new THREE.Color(0xffffff),
    emissiveMap: atlas.emissiveMap,
    emissiveIntensity: UNIT_MATERIAL.emissiveIntensity,
    clearcoat: UNIT_MATERIAL.clearcoat,
    clearcoatRoughness: UNIT_MATERIAL.clearcoatRoughness,
    envMapIntensity: UNIT_MATERIAL.envMapIntensity,
    // Carries the baked ambient/cavity gradient and the contact darkening.
    vertexColors: true,
    dithering: true,
    side: THREE.FrontSide,
  });
  // aoMap multiplies INDIRECT light only, which is exactly bible 3.3's ruling
  // that crease AO must darken ambient and never the direct key.
  mat.aoMapIntensity = 1.0;

  if (DEV) {
    // RULING #3, asserted rather than commented. Each of these has been broken
    // once already by somebody "simplifying" the material.
    if (mat.envMapIntensity <= 0) {
      throw new Error('R10: envMapIntensity is 0 — units go matte and the silhouette rim dies');
    }
    if (!(mat as THREE.Material as { isMeshPhysicalMaterial?: boolean }).isMeshPhysicalMaterial) {
      throw new Error('R10/RULING #3: unit materials must be MeshPhysicalMaterial, not MeshStandardMaterial');
    }
    if (mat.clearcoat <= 0) {
      throw new Error(
        'RULING #3: clearcoat is 0 — the clear coat over a broad diffuse lobe IS the ' +
        'painted-plastic-toy read. Without it RA3 armour goes to matte plastic.');
    }
    if (mat.clearcoatRoughness <= 0 || mat.clearcoatRoughness >= 1) {
      throw new Error('RULING #3: clearcoatRoughness must be a tight-but-not-mirror 0.38');
    }
    // The ORM map is AUTHORITATIVE. A scalar below 1 would silently scale every
    // authored roughness in the atlas and there would be no way to see it.
    if (mat.roughness !== 1 || mat.metalness !== 1) {
      throw new Error('R10: roughness/metalness scalars must stay 1.0 — the ORM map is authoritative');
    }
  }
  return mat;
}

/* ==========================================================================
 * 4. THE MODEL
 * ========================================================================== */

export interface UnitModel {
  key: string;
  name: string;
  faction: UnitMassList['faction'];
  cls: UnitMassList['cls'];
  /** Everything that does not slew with the turret. */
  hull: THREE.BufferGeometry;
  /** Null for turretless units. Origin is the turret pivot, +Z forward. */
  turret: THREE.BufferGeometry | null;
  /** Hull-local pivot the turret geometry rotates about. */
  turretPivot: [number, number, number];
  /** Shared per faction-class. Never per unit. */
  material: THREE.MeshPhysicalMaterial;
  atlas: GreebleAtlas;
  /** Hull-space named transforms. */
  sockets: SocketDef[];
  /** Turret-space named transforms (muzzles). */
  turretSockets: SocketDef[];
  /** Width, height, length in metres. */
  bounds: [number, number, number];
  stats: MassStats;
  /** The types.ts registry shape, for whoever owns the ModelRegistry. */
  build: ModelBuild;
  /** A fresh Object3D: hull mesh with the turret parented at its pivot. */
  prototype(): THREE.Object3D;
}

function toSocketDefs(list: UnitMassList, turretSpace: boolean): SocketDef[] {
  const pivot = list.turretPivot ?? [0, 0, 0];
  return list.sockets
    .filter((s) => (s.turret ?? false) === turretSpace)
    .map((s) => ({
      part: s.part,
      x: turretSpace ? s.pos[0] - pivot[0] : s.pos[0],
      y: turretSpace ? s.pos[1] - pivot[1] : s.pos[1],
      z: turretSpace ? s.pos[2] - pivot[2] : s.pos[2],
      yaw: s.yaw ?? 0,
      pitch: s.pitch ?? 0,
    }));
}

/**
 * Assemble one unit. Throws in a dev build if the mass list violates R8 or R12
 * — "reject at build time, not in review".
 */
export function buildUnit(list: UnitMassList, atlas: GreebleAtlas, material: THREE.MeshPhysicalMaterial): UnitModel {
  const bb = unitBounds(list);
  const bounds: [number, number, number] = [
    bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2],
  ];
  const height = Math.max(1e-6, bounds[1]);

  const hullMb = new MeshBuilder();
  const turretMb = new MeshBuilder();
  const pivot = (list.turretPivot ?? [0, 0, 0]) as V3;

  const ctxFor = (mb: MeshBuilder): BuildCtx => ({
    mb,
    uv: (slot) => atlas.uv[slot],
    bevel: (slot) => atlas.bevelUv[slot],
  });

  for (const m of expandMasses(list.masses)) {
    const mb = m.turret ? turretMb : hullMb;
    const ctx = ctxFor(mb);
    const chamfer = Math.max(MIN_CHAMFER, defaultChamfer(m, list.faction));
    const capSlot = m.capSlot ?? m.slot;

    // Turret geometry is authored in HULL space and rebased onto the pivot, so
    // a def author never has to do the subtraction by hand.
    const anchor: V3 = m.turret
      ? [m.anchor[0] - pivot[0], m.anchor[1] - pivot[1], m.anchor[2] - pivot[2]]
      : (m.anchor as V3);

    for (const mirror of m.mirrorX ? [false, true] : [false]) {
      mb.setTransform(m.rot as V3 | undefined, anchor, mirror);
      // The ambient ramp is always measured from the GROUND, so a turret piece
      // rebased onto the pivot still darkens correctly toward the tracks.
      mb.setTint({ height, massTint: m.tint ?? 1 });

      switch (m.primitive) {
        case 'lathe':
          buildLathe(ctx, m, chamfer, m.slot, capSlot);
          break;
        case 'prism':
          buildPrism(ctx, m, chamfer, m.slot, capSlot);
          break;
        default: {
          // The eleven Shapes.ts primitives. `shapeSpecFor` returns null for
          // anything it does not own, which is only the legacy 'box', and that
          // falls through to `buildBox` exactly as before.
          const spec = shapeSpecFor(m, chamfer);
          if (spec !== null) {
            emitMassShape(mb, atlas, m, spec, paintSlotForArea, 'paintLarge');
            break;
          }
          buildBox(ctx, m, chamfer, (face, area) => {
            const override = m.faceSlots?.[face];
            if (override !== undefined) return override;
            // Auto paint density: a 7 m glacis gets 12 panel runs, a 0.3 m
            // sensor box gets one seam, and nothing is ever sub-pixel.
            if (m.slot === 'paintLarge') return paintSlotForArea(area);
            return m.slot;
          });
          break;
        }
      }
    }
  }

  const areas: SlotAreas = {};
  for (const [slot, a] of hullMb.areaBySlot) areas[slot] = (areas[slot] ?? 0) + a;
  for (const [slot, a] of turretMb.areaBySlot) areas[slot] = (areas[slot] ?? 0) + a;
  const visible: SlotAreas = {};
  for (const [slot, a] of hullMb.visibleAreaBySlot) visible[slot] = (visible[slot] ?? 0) + a;
  for (const [slot, a] of turretMb.visibleAreaBySlot) visible[slot] = (visible[slot] ?? 0) + a;

  const stats = validateUnit(
    list, areas, visible, bounds,
    hullMb.triangles + turretMb.triangles,
    atlas.metrics.emissiveTileCover,
  );
  // R1 — "units ship as untextured grey primitives" — gated on DRAWN structure,
  // not on Sobel coverage.
  //
  // The old gate was `paintEdgeCoverage < UNIT_VALIDATION.sobelFloor` (22%).
  // That is a noise detector wearing a detail detector's clothes: the cheapest
  // way to pass it is fbm, and passing it that way is exactly how the atlas
  // ended up covered in marbled blue-grey static. `paintDetailCoverage` counts
  // texels the painters actually drew a seam, a pocket edge or a decal on, so
  // there is no way to satisfy it except by drawing something.
  if (atlas.metrics.paintDetailCoverage < SURFACE_BUDGET.detailFloorUnit) {
    stats.errors.push(
      `atlas drawn-detail coverage ${(atlas.metrics.paintDetailCoverage * 100).toFixed(1)}% is below ` +
      `the ${(SURFACE_BUDGET.detailFloorUnit * 100).toFixed(1)}% floor — this reads as untextured ` +
      `primitives (R1)`);
  }
  // The other half of the gate, and the one the old atlas would have failed:
  // per-pixel speckle. White noise scores ~0.44 here and a crisp drawn line
  // scores 0, so anything above the ceiling is salt-and-pepper on the hull.
  if (atlas.metrics.speckleRatio > SURFACE_BUDGET.speckleCeiling) {
    stats.errors.push(
      `atlas speckle ratio ${(atlas.metrics.speckleRatio * 100).toFixed(2)}% exceeds the ` +
      `${(SURFACE_BUDGET.speckleCeiling * 100).toFixed(2)}% ceiling — there is per-pixel noise in ` +
      `the albedo or the height field, and RA3 surfaces have none`);
  }
  if (UNIT_VALIDATION.sobelTarget[1] > 0 && atlas.metrics.paintEdgeCoverage > 0.50) {
    stats.warnings.push(
      `atlas Sobel coverage ${(atlas.metrics.paintEdgeCoverage * 100).toFixed(1)}% is above 50% — ` +
      `bible 5.3 says a surface that busy reads as noise however it was drawn`);
  }

  if (stats.errors.length > 0) {
    const msg = `[units] ${list.key} REJECTED:\n  - ${stats.errors.join('\n  - ')}`;
    if (DEV) throw new Error(msg);
    console.error(msg);
  }
  for (const w of stats.warnings) console.warn(`[units] ${list.key}: ${w}`);

  const hull = hullMb.toGeometry(`${list.key}.hull`);
  const turret = turretMb.isEmpty() ? null : turretMb.toGeometry(`${list.key}.turret`);

  const sockets = toSocketDefs(list, false);
  const turretSockets = toSocketDefs(list, true);

  const parts: ModelPart[] = [
    { part: PartId.Root, materialKey: atlas.key, geometry: 0, x: 0, y: 0, z: 0, followsTurret: false },
  ];
  if (turret !== null) {
    parts.push({
      part: PartId.Turret, materialKey: atlas.key, geometry: 1,
      x: pivot[0], y: pivot[1], z: pivot[2], followsTurret: true,
    });
  }

  const build: ModelBuild = {
    key: list.key,
    parts,
    sockets: [...sockets, ...turretSockets],
    boundsX: bounds[0], boundsY: bounds[1], boundsZ: bounds[2],
    footprintW: 0, footprintH: 0,
    // Units are 2-3 k triangles; one LOD switch to a merged silhouette is
    // enough, and the bridge decides whether to use it.
    lodDistances: [90, 180],
  };

  return {
    key: list.key,
    name: list.name,
    faction: list.faction,
    cls: list.cls,
    hull,
    turret,
    turretPivot: [pivot[0], pivot[1], pivot[2]],
    material,
    atlas,
    sockets,
    turretSockets,
    bounds,
    stats,
    build,
    prototype(): THREE.Object3D {
      const root = new THREE.Mesh(hull, material);
      root.name = list.key;
      root.castShadow = true;
      root.receiveShadow = true;
      if (turret !== null) {
        const t = new THREE.Mesh(turret, material);
        t.name = `${list.key}.turret`;
        t.position.set(pivot[0], pivot[1], pivot[2]);
        t.castShadow = true;
        t.receiveShadow = true;
        root.add(t);
      }
      return root;
    },
  };
}

/* ==========================================================================
 * 5. THE LIBRARY
 *
 * The handoff surface. RenderBridge asks this for a geometry + material pair
 * per unit kind and builds its own InstancedMeshes; nothing here creates a
 * scene object except the optional parade in units.system.ts.
 * ========================================================================== */

/**
 * SURFACE LANGUAGE PER FACTION.
 *
 * `UnitPalette.rivets` is the one field in the palette that is about
 * CONSTRUCTION rather than colour, and bible 5.7 makes it the fault line
 * between the two architectures: Allied hardware is a welded, tiled, clear-
 * coated ceramic monocoque; Soviet hardware is bolted plate. So it selects the
 * whole drawing language in `Greeble.ts` — seam weight, groove depth, whether a
 * joint gets a proud strap or a bolt row — and the gloss that goes with it.
 *
 * Allied white ceramic is genuinely glossier than Soviet field-painted olive,
 * and that gloss difference is a big part of why the two factions read as
 * different materials in RA3 rather than as one material in two hues.
 */
const WELDED_SHEEN = 0.62;   // roughness 0.445 — clear-coated ceramic
const RIVETED_SHEEN = 0.42;  // roughness 0.553 — field-painted plate

/**
 * Build a greeble spec from a faction palette. ONE atlas per faction — every
 * field here is faction-level, never unit-level, or the spec hash would fork
 * and the whole shared-atlas argument would collapse into 18 atlases.
 */
export function specForPalette(key: string, p: UnitPalette, size: number, seed: number): GreebleSpec {
  return {
    plating: p.rivets ? 'riveted' : 'welded',
    sheen: p.rivets ? RIVETED_SHEEN : WELDED_SHEEN,
    key,
    size,
    seed,
    basePaint: p.base,
    paintShadow: p.shadow,
    teamColor: p.team,
    teamSecondary: p.teamSecondary,
    insignia: p.insignia,
    insigniaColor: p.insigniaColor,
    emissiveColor: p.emissive,
    bareMetal: p.bareMetal,
    trackLink: p.trackLink,
    glass: p.glass,
    stencil: p.stencil,
    hazard: p.hazard,
    rivets: p.rivets,
    rivetPitchPx: UNIT_GREEBLE.rivetPitchPx,
    panelDensity: 1.0,
    hullNumber: p.hullNumber,
  };
}

export class UnitLibrary {
  private readonly models = new Map<string, UnitModel>();
  private readonly materials = new Map<string, THREE.MeshPhysicalMaterial>();
  private readonly factory: GreebleFactory;

  constructor(factory: GreebleFactory = greebles) { this.factory = factory; }

  /**
   * Build (or return) the model for a mass list. The atlas and the material are
   * shared across every unit that asks for the same palette key, which is the
   * whole draw-call argument.
   */
  build(list: UnitMassList, palette: UnitPalette, atlasSize: number, seed: number): UnitModel {
    const existing = this.models.get(list.key);
    if (existing !== undefined) return existing;

    const atlasKey = `${list.faction}.unit`;
    const atlas = this.factory.atlas(specForPalette(atlasKey, palette, atlasSize, seed));

    let material = this.materials.get(atlas.key);
    if (material === undefined) {
      material = createUnitMaterial(atlas, atlasKey);
      this.materials.set(atlas.key, material);
    }

    const model = buildUnit(list, atlas, material);
    this.models.set(list.key, model);
    return model;
  }

  get(key: string): UnitModel | undefined { return this.models.get(key); }
  has(key: string): boolean { return this.models.has(key); }
  keys(): string[] { return Array.from(this.models.keys()); }
  all(): UnitModel[] { return Array.from(this.models.values()); }
  count(): number { return this.models.size; }

  /** Distinct materials in play. This IS the draw-call multiplier. */
  materialCount(): number { return this.materials.size; }

  dispose(): void {
    for (const m of this.models.values()) {
      m.hull.dispose();
      m.turret?.dispose();
    }
    for (const mat of this.materials.values()) mat.dispose();
    this.models.clear();
    this.materials.clear();
    this.factory.dispose();
  }
}

/** The shared library. `units.system.ts` fills it; RenderBridge reads it. */
export const unitLibrary = new UnitLibrary();

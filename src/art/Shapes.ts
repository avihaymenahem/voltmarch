/**
 * ============================================================================
 * src/art/Shapes.ts
 * ============================================================================
 * THE HI-TECH PRIMITIVE LIBRARY. The answer to "our models are too rectangular
 * like old-school 3D models".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `MassList` used to offer three shapes — box, lathe, prism — and every unit in
 * the roster was therefore a stack of axis-aligned boxes with a barrel on top.
 * Axis-aligned boxes are exactly what a 1998 model looks like. Real RA3 hardware
 * is *chunky but never boxy*: every convex edge is a real cut face, hulls taper
 * and shear toward the deck, turrets are lathed and faceted, and armour reads as
 * PLATES LAYERED OVER A CORE MASS rather than as one extruded rectangle.
 *
 * So this file ships the missing vocabulary. Eleven primitives, all deterministic,
 * all cheap enough to build ~50 models at load, all merging into one buffer.
 *
 * THE TWO OUTPUT FORMS, AND WHY THERE ARE TWO
 * -------------------------------------------
 * Every primitive exists twice:
 *
 *   chamferBox(p)      -> THREE.BufferGeometry     "give me a thing to render"
 *   chamferBoxMesh(p)  -> ShapeMesh                "give me tagged polygons"
 *
 * `ShapeMesh` is a plain-data polygon soup: every polygon carries its normal,
 * its own 0..1 UV, a `kind` (side / cap / bevel / detail) and an optional
 * `group` name. That is the form `UnitFactory` wants, because UnitFactory does
 * not want geometry — it wants to choose an ATLAS TILE per polygon (a bevel
 * strip samples the pre-brightened bevel patch, a deck samples paintLarge, a
 * track band samples tread) and to measure real triangle area per slot. A
 * `BufferGeometry` has thrown all of that away. See `emitShape` for the 15-line
 * adapter.
 *
 * CONVENTIONS — these are load-bearing, do not drift from them
 * ------------------------------------------------------------
 *   1 unit = 1 metre. Y is up. +Z is forward.
 *   Quad vertex order is (uv 0,0) (1,0) (1,1) (0,1). UnitFactory.addQuad maps a
 *     UvRect onto exactly that order, so a quad can be handed straight through.
 *   Winding is never assumed. Every polygon is emitted with an outward HINT and
 *     the builder flips the vertex order if the derived normal disagrees.
 *   PRIMITIVES ARE CENTRED ON THEIR OWN BOUNDING BOX, because `MassDef.anchor`
 *     is the mass CENTRE. The three exceptions are the ones where the author
 *     supplies absolute coordinates — `lathe`, `extrudeProfile`, `hullOf` —
 *     and `centerMesh()` / `fitMesh()` exist for those.
 *   Chamfer is a REAL CUT FACE, never a shading trick, and never zero:
 *     `autoChamfer()` is the floor and it is impossible to opt out of.
 *
 * DETERMINISM: no Math.random, no Date.now. `greebleStrip` takes an explicit
 * seed and uses core/math's Rng, so two runs produce byte-identical vertices.
 * ============================================================================
 */

import * as THREE from 'three';
import { UNIT_GEOMETRY } from '../core/config';
import { Rng, TAU } from '../core/math';

/* ==========================================================================
 * 1. TYPES
 * ========================================================================== */

export type V3 = readonly [number, number, number];
export type V2 = readonly [number, number];
export type UV = readonly [number, number];

/** The six faces of a box, named by their outward axis. Mirrors MassList. */
export type BoxFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

/**
 * What a polygon IS, for the consumer that has to pick a texture for it.
 *
 *   'side'   a wall. Takes the mass's own slot.
 *   'cap'    a deck / underside / end cap. Takes the mass's capSlot.
 *   'bevel'  a chamfer strip or corner. MUST sample the atlas's flat bevel
 *            patch — that is where scorecard #11's 2-4 px highlight comes from.
 *   'detail' sub-greeble hardware (bolts, louvres, rollers). Small, and never
 *            worth a paint-density tile of its own.
 */
export type FaceKind = 'side' | 'cap' | 'bevel' | 'detail';

/** One convex polygon: 3 or 4 vertices, CCW about `n`. */
export interface ShapePoly {
  readonly v: readonly V3[];
  /** Parallel to `v`. 0..1 inside whatever tile the consumer picks. */
  readonly uv: readonly UV[];
  readonly n: V3;
  readonly kind: FaceKind;
  /** Set only by box-like primitives, so `faceSlots` overrides still work. */
  readonly face?: BoxFace;
  /** Sub-part name: 'band', 'wheel', 'sprocket', 'skirt', 'bolt', 'louvre'... */
  readonly group?: string;
  /** Real area in square metres. */
  readonly area: number;
}

export interface ShapeMesh {
  readonly polys: readonly ShapePoly[];
  readonly min: V3;
  readonly max: V3;
  readonly triangles: number;
}

export const EMPTY_MESH: ShapeMesh = {
  polys: [], min: [0, 0, 0], max: [0, 0, 0], triangles: 0,
};

/* ==========================================================================
 * 2. SMALL VECTOR MATH (local, allocation-light, no THREE)
 * ========================================================================== */

function sub(a: V3, b: V3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a: V3): [number, number, number] {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function add3(a: V3, b: V3): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function mul3(a: V3, s: number): [number, number, number] { return [a[0] * s, a[1] * s, a[2] * s]; }

/** Newell normal of a polygon. Stable for near-degenerate fans. */
function newell(pts: readonly V3[]): [number, number, number] {
  let nx = 0, ny = 0, nz = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm([nx, ny, nz]);
}

/** Area of a planar polygon, in square metres. */
function polyArea(pts: readonly V3[]): number {
  let ax = 0, ay = 0, az = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const c = cross(pts[i], pts[(i + 1) % n]);
    ax += c[0]; ay += c[1]; az += c[2];
  }
  return 0.5 * Math.hypot(ax, ay, az);
}

/** An orthonormal basis whose Z is `n`. Deterministic choice of the seed axis. */
function basisFor(n: V3): [V3, V3] {
  const seed: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(seed, n));
  const v = cross(n, u);
  return [u, v];
}

/* ==========================================================================
 * 3. 2D CONVEX-POLYGON OFFSET
 *
 * Insetting a plan by a real distance is what turns a rim chamfer from a
 * shading trick into a cut face, and it is used by every extruded primitive
 * here. Offsetting each edge inward and re-intersecting is exact for a convex
 * polygon and degrades gracefully (parallel edges fall back to the normal).
 * ========================================================================== */

/**
 * Inset a CCW-from-above plan polygon by `d` metres.
 * Plan points are [x, z]. CCW means the outward normal of edge p->q is
 * (dz, -dx) — the same convention `buildPrism` uses.
 */
export function insetConvex(pts: readonly V2[], d: number): V2[] {
  const n = pts.length;
  if (n < 3 || d <= 1e-9) return pts.map((p) => [p[0], p[1]] as V2);
  const inward = (p: V2, q: V2): V2 => {
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dz / l * -1, dx / l];
  };
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const n0 = inward(prev, cur);
    const n1 = inward(cur, next);
    const c0 = n0[0] * prev[0] + n0[1] * prev[1] + d;
    const c1 = n1[0] * cur[0] + n1[1] * cur[1] + d;
    const det = n0[0] * n1[1] - n0[1] * n1[0];
    if (Math.abs(det) < 1e-9) {
      out.push([cur[0] + n0[0] * d, cur[1] + n0[1] * d]);
    } else {
      out.push([(c0 * n1[1] - c1 * n0[1]) / det, (n0[0] * c1 - n1[0] * c0) / det]);
    }
  }
  return out;
}

/** Signed area of a plan polygon. Positive for the CCW-from-above convention. */
export function planArea(pts: readonly V2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a * 0.5;
}

/**
 * The largest inset that leaves a plan with positive area, in metres. Every
 * chamfer in this file is clamped by this, so an over-eager chamfer can never
 * turn a mass inside out.
 */
export function maxInset(pts: readonly V2[]): number {
  // Fast path. The distance from the centroid to the nearest edge line is a
  // lower bound on the safe inset for a convex plan, and it is exact for a
  // regular one. Every chamfer in this file is far below it, so the bisection
  // below almost never runs — which matters, because `trackAssembly` builds a
  // hundred small prisms and this used to be the whole cost of a model.
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= pts.length; cz /= pts.length;
  let nearest = Infinity, far = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz);
    if (l > 1e-9) nearest = Math.min(nearest, Math.abs((cx - a[0]) * dz - (cz - a[1]) * dx) / l);
    far = Math.max(far, Math.hypot(a[0] - cx, a[1] - cz));
  }
  if (!isFinite(nearest)) return 0;
  return nearest * 0.98 > 0 ? Math.min(nearest * 0.98, far) : 0;
}

/* ==========================================================================
 * 4. THE BUILDER
 * ========================================================================== */

/**
 * Accumulates tagged polygons. Every `push` takes an OUTWARD HINT and the
 * builder reverses the vertex order if the derived normal disagrees — mirroring
 * a mass, or a negative-determinant transform, therefore cannot invert a face.
 */
export class ShapeBuilder {
  private readonly out: ShapePoly[] = [];

  /** Emit a polygon. `hint` only has to point roughly outward. */
  poly(
    pts: readonly V3[], uvs: readonly UV[], hint: V3, kind: FaceKind,
    face?: BoxFace, group?: string,
  ): void {
    if (pts.length < 3) return;
    const area = polyArea(pts);
    if (!(area > 1e-9)) return;
    let n = newell(pts);
    let v = pts;
    let u = uvs;
    if (dot(n, hint) < 0) {
      n = [-n[0], -n[1], -n[2]];
      v = pts.slice().reverse();
      u = uvs.slice().reverse();
    }
    this.out.push({ v, uv: u, n, kind, face, group, area });
  }

  /** A quad in (0,0) (1,0) (1,1) (0,1) UV order. */
  quad(
    p0: V3, p1: V3, p2: V3, p3: V3, hint: V3, kind: FaceKind,
    face?: BoxFace, group?: string,
    u0 = 0, u1 = 1, v0 = 0, v1 = 1,
  ): void {
    this.poly([p0, p1, p2, p3], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], hint, kind, face, group);
  }

  /** A triangle with explicit UVs. */
  tri(
    p0: V3, p1: V3, p2: V3, hint: V3, kind: FaceKind,
    uv0: UV = [0, 0], uv1: UV = [1, 0], uv2: UV = [0.5, 1],
    face?: BoxFace, group?: string,
  ): void {
    this.poly([p0, p1, p2], [uv0, uv1, uv2], hint, kind, face, group);
  }

  /**
   * A planar face of arbitrary vertex count, UV-projected onto its own plane
   * and normalised to its own bounds. Fanned into triangles by the consumer.
   */
  face(pts: readonly V3[], hint: V3, kind: FaceKind, face?: BoxFace, group?: string): void {
    if (pts.length < 3) return;
    const n = norm(hint);
    const [bu, bv] = basisFor(n);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    const raw: UV[] = pts.map((p) => {
      const u = dot(p, bu), v = dot(p, bv);
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
      return [u, v];
    });
    const du = Math.max(1e-6, maxU - minU), dv = Math.max(1e-6, maxV - minV);
    this.poly(pts, raw.map((p) => [(p[0] - minU) / du, (p[1] - minV) / dv] as UV), hint, kind, face, group);
  }

  /** Fold another mesh in, optionally transformed. */
  merge(mesh: ShapeMesh, x?: Xform): void {
    const m = x === undefined ? mesh : transformMesh(mesh, x);
    for (const p of m.polys) this.out.push(p);
  }

  /** Re-tag everything pushed so far. Used by the composite assemblies. */
  retag(group: string): void {
    for (let i = 0; i < this.out.length; i++) {
      if (this.out[i].group === undefined) {
        this.out[i] = { ...this.out[i], group };
      }
    }
  }

  build(): ShapeMesh {
    return finalize(this.out);
  }
}

function finalize(polys: readonly ShapePoly[]): ShapeMesh {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const p of polys) {
    triangles += p.v.length - 2;
    for (const v of p.v) {
      for (let a = 0; a < 3; a++) {
        if (v[a] < min[a]) min[a] = v[a];
        if (v[a] > max[a]) max[a] = v[a];
      }
    }
  }
  if (polys.length === 0) return EMPTY_MESH;
  return { polys, min, max, triangles };
}

/* ==========================================================================
 * 5. TRANSFORMS
 * ========================================================================== */

/** A 3x3 row-major linear part plus a translation. */
export interface Xform { readonly m: readonly number[]; readonly t: V3; }

export const IDENTITY: Xform = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

export function translation(x: number, y: number, z: number): Xform {
  return { m: IDENTITY.m, t: [x, y, z] };
}
export function rotationX(a: number): Xform {
  const c = Math.cos(a), s = Math.sin(a);
  return { m: [1, 0, 0, 0, c, -s, 0, s, c], t: [0, 0, 0] };
}
export function rotationY(a: number): Xform {
  const c = Math.cos(a), s = Math.sin(a);
  return { m: [c, 0, s, 0, 1, 0, -s, 0, c], t: [0, 0, 0] };
}
export function rotationZ(a: number): Xform {
  const c = Math.cos(a), s = Math.sin(a);
  return { m: [c, -s, 0, s, c, 0, 0, 0, 1], t: [0, 0, 0] };
}
export function scaling(sx: number, sy: number, sz: number): Xform {
  return { m: [sx, 0, 0, 0, sy, 0, 0, 0, sz], t: [0, 0, 0] };
}

/** `a` applied AFTER `b`. */
export function compose(a: Xform, b: Xform): Xform {
  const A = a.m, B = b.m;
  const m = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  const t: V3 = [
    A[0] * b.t[0] + A[1] * b.t[1] + A[2] * b.t[2] + a.t[0],
    A[3] * b.t[0] + A[4] * b.t[1] + A[5] * b.t[2] + a.t[1],
    A[6] * b.t[0] + A[7] * b.t[1] + A[8] * b.t[2] + a.t[2],
  ];
  return { m, t };
}

function det3(m: readonly number[]): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Inverse-transpose of the linear part, for normals under non-uniform scale. */
function normalMatrix(m: readonly number[]): number[] {
  const d = det3(m);
  if (Math.abs(d) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const inv = [
    (m[4] * m[8] - m[5] * m[7]) / d, (m[2] * m[7] - m[1] * m[8]) / d, (m[1] * m[5] - m[2] * m[4]) / d,
    (m[5] * m[6] - m[3] * m[8]) / d, (m[0] * m[8] - m[2] * m[6]) / d, (m[2] * m[3] - m[0] * m[5]) / d,
    (m[3] * m[7] - m[4] * m[6]) / d, (m[1] * m[6] - m[0] * m[7]) / d, (m[0] * m[4] - m[1] * m[3]) / d,
  ];
  // transpose
  return [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]];
}

export function transformMesh(mesh: ShapeMesh, x: Xform): ShapeMesh {
  const m = x.m, t = x.t;
  const nm = normalMatrix(m);
  const flip = det3(m) < 0;
  const polys: ShapePoly[] = [];
  for (const p of mesh.polys) {
    const v = p.v.map((q): V3 => [
      m[0] * q[0] + m[1] * q[1] + m[2] * q[2] + t[0],
      m[3] * q[0] + m[4] * q[1] + m[5] * q[2] + t[1],
      m[6] * q[0] + m[7] * q[1] + m[8] * q[2] + t[2],
    ]);
    const n = norm([
      nm[0] * p.n[0] + nm[1] * p.n[1] + nm[2] * p.n[2],
      nm[3] * p.n[0] + nm[4] * p.n[1] + nm[5] * p.n[2],
      nm[6] * p.n[0] + nm[7] * p.n[1] + nm[8] * p.n[2],
    ]);
    polys.push({
      v: flip ? v.slice().reverse() : v,
      uv: flip ? p.uv.slice().reverse() : p.uv,
      n, kind: p.kind, face: p.face, group: p.group,
      area: polyArea(v),
    });
  }
  return finalize(polys);
}

export function mergeMeshes(...meshes: readonly ShapeMesh[]): ShapeMesh {
  const polys: ShapePoly[] = [];
  for (const m of meshes) for (const p of m.polys) polys.push(p);
  return finalize(polys);
}

/** Translate so the mesh's bounding box is centred on the origin. */
export function centerMesh(mesh: ShapeMesh): ShapeMesh {
  if (mesh.polys.length === 0) return mesh;
  return transformMesh(mesh, translation(
    -(mesh.min[0] + mesh.max[0]) * 0.5,
    -(mesh.min[1] + mesh.max[1]) * 0.5,
    -(mesh.min[2] + mesh.max[2]) * 0.5,
  ));
}

/**
 * Scale a mesh so its bounding box becomes exactly `size`, and centre it.
 *
 * This is what lets a `MassDef` keep `size` as the authoritative AABB for every
 * primitive: the validator's extents, silhouette and bounds arithmetic never has
 * to learn what a convex hull is.
 */
export function fitMesh(mesh: ShapeMesh, size: V3, mode: 'stretch' | 'uniform' = 'stretch'): ShapeMesh {
  if (mesh.polys.length === 0) return mesh;
  const ex = Math.max(1e-6, mesh.max[0] - mesh.min[0]);
  const ey = Math.max(1e-6, mesh.max[1] - mesh.min[1]);
  const ez = Math.max(1e-6, mesh.max[2] - mesh.min[2]);
  let sx = size[0] / ex, sy = size[1] / ey, sz = size[2] / ez;
  if (mode === 'uniform') {
    const s = Math.min(sx, sy, sz);
    sx = s; sy = s; sz = s;
  }
  return centerMesh(transformMesh(centerMesh(mesh), scaling(sx, sy, sz)));
}

/* ==========================================================================
 * 6. CHAMFER POLICY
 * ========================================================================== */

/**
 * The default chamfer for a part, in metres.
 *
 * Solved from the bible's PIXEL figure, not its fraction figure: at the default
 * zoom a 7 m tank is 207 px wide, so scorecard #11's "2-4 px bevel" is
 * 0.07-0.14 m, and 1.5-3% of a 0.95 m plate would be 0.8 px — invisible.
 *
 * IT IS NEVER ZERO. A razor-edged box is an automatic fail, so there is
 * deliberately no way to ask for one.
 */
export const CHAMFER = {
  /** Fraction of the part's smallest dimension. */
  fraction: 0.085,
  /** Absolute floor in metres — one pixel on an infantryman's rifle. */
  minMeters: 0.022,
  /** Hard cap, so a chamfer can never round a part into a pill. */
  maxFractionOfMin: 0.30,
} as const;

/**
 * The default 45-degree cut on the four vertical corners.
 *
 * It doubles a box's wall count from four to eight, so it is only worth paying
 * for when the cut can actually be SEEN: at the RTS zoom (29.6 px/m) a cut below
 * ~2 px is invisible and costs the same triangles as one that reads. Below the
 * threshold the box stays four-walled — which is how a 0.2 m tow hook costs 28
 * triangles instead of 60 while a 3.4 m hull still reads octagonal from above.
 */
export const CORNER_CUT_MIN_PLAN = 0.60;

export function autoCornerCut(w: number, d: number, chamfer: number): number {
  return Math.min(Math.abs(w), Math.abs(d)) >= CORNER_CUT_MIN_PLAN ? chamfer : 0;
}

export function autoChamfer(w: number, h: number, d: number, requested?: number): number {
  const min = Math.max(1e-4, Math.min(Math.abs(w), Math.abs(h), Math.abs(d)));
  const cap = min * CHAMFER.maxFractionOfMin;
  if (requested !== undefined && requested > 0) return Math.min(requested, cap);
  return Math.min(cap, Math.max(CHAMFER.minMeters, min * CHAMFER.fraction));
}

/* ==========================================================================
 * 7. THE RING STACK — the engine behind every extruded primitive
 * ========================================================================== */

interface Ring {
  readonly pts: readonly V3[];
  /** Cumulative perimeter fraction per point, for continuous-U bands. */
  readonly u: readonly number[];
}

function ringFromPlan(plan: readonly V2[], y: number, dz: number): Ring {
  const pts: V3[] = plan.map((p) => [p[0], y, p[1] + dz]);
  const u: number[] = [0];
  let total = 0;
  for (let i = 1; i <= plan.length; i++) {
    const a = plan[i - 1], b = plan[i % plan.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    u.push(total);
  }
  const inv = 1 / Math.max(1e-6, total);
  return { pts, u: u.map((x) => x * inv) };
}

/**
 * Bridge two rings with a band of quads.
 * `uPerEdge` true gives every edge its own 0..1 (one box face = one full tile);
 * false runs U continuously round the perimeter (a lathe wraps its tile once).
 */
function band(
  b: ShapeBuilder, a: Ring, c: Ring,
  kinds: readonly FaceKind[] | FaceKind,
  faces: readonly (BoxFace | undefined)[] | undefined,
  group: string | undefined,
  uPerEdge: boolean, v0: number, v1: number,
): void {
  const n = a.pts.length;
  // Ring centroid, so the outward hint never depends on winding luck.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    cx += a.pts[i][0] + c.pts[i][0];
    cy += a.pts[i][1] + c.pts[i][1];
    cz += a.pts[i][2] + c.pts[i][2];
  }
  const centre: V3 = [cx / (2 * n), cy / (2 * n), cz / (2 * n)];

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p0 = a.pts[i], p1 = a.pts[j], p2 = c.pts[j], p3 = c.pts[i];
    const mid: V3 = [
      (p0[0] + p1[0] + p2[0] + p3[0]) * 0.25,
      (p0[1] + p1[1] + p2[1] + p3[1]) * 0.25,
      (p0[2] + p1[2] + p2[2] + p3[2]) * 0.25,
    ];
    const kind = typeof kinds === 'string' ? kinds : (kinds[i] ?? 'side');
    const face = faces?.[i];
    const u0 = uPerEdge ? 0 : a.u[i];
    const u1 = uPerEdge ? 1 : a.u[i + 1];
    b.quad(p0, p1, p2, p3, sub(mid, centre), kind, face, group, u0, u1, v0, v1);
  }
}

/** Fan-cap a ring. `up` is the outward direction of the cap. */
function cap(b: ShapeBuilder, r: Ring, up: V3, kind: FaceKind, face: BoxFace | undefined, group?: string): void {
  if (r.pts.length < 3) return;
  b.face(r.pts, up, kind, face, group);
}

/* ==========================================================================
 * 8. PLANS
 * ========================================================================== */

/**
 * A rectangle plan with its four vertical corners cut at 45 degrees.
 *
 * `cut > 0` is the single cheapest de-boxifier there is: it turns a square plan
 * into an octagon, which is bible 5.7's SOVIET-1 slab and is also what stops an
 * Allied hull reading as a brick from directly above.
 *
 * Returns the plan plus, per EDGE, which box face it is and whether it is a cut.
 */
export function rectPlan(w: number, d: number, cut: number): {
  plan: V2[]; faces: (BoxFace | undefined)[]; kinds: FaceKind[];
} {
  const a = w * 0.5, b = d * 0.5;
  const k = Math.max(0, Math.min(cut, Math.min(a, b) * 0.92));
  if (k <= 1e-6) {
    return {
      plan: [[a, -b], [a, b], [-a, b], [-a, -b]],
      faces: ['px', 'pz', 'nx', 'nz'],
      kinds: ['side', 'side', 'side', 'side'],
    };
  }
  return {
    plan: [
      [a, -b + k], [a, b - k], [a - k, b], [-a + k, b],
      [-a, b - k], [-a, -b + k], [-a + k, -b], [a - k, -b],
    ],
    faces: ['px', undefined, 'pz', undefined, 'nx', undefined, 'nz', undefined],
    kinds: ['side', 'bevel', 'side', 'bevel', 'side', 'bevel', 'side', 'bevel'],
  };
}

/** A regular n-gon plan of the given radii. Hex/oct crowns, silo pads. */
export function ngonPlan(rx: number, rz: number, sides: number, phase = 0): V2[] {
  const out: V2[] = [];
  const n = Math.max(3, sides | 0);
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    out.push([Math.cos(a) * rx, Math.sin(a) * rz]);
  }
  return out;
}

/**
 * A stadium (rounded-rectangle) plan: straight flanks, faceted round ends.
 * This is the track-band outline and the Allied splayed-skirt outline.
 */
export function stadiumPlan(length: number, height: number, endSegments = 6): V2[] {
  const r = height * 0.5;
  const straight = Math.max(0, length * 0.5 - r);
  const out: V2[] = [];
  const n = Math.max(2, endSegments | 0);
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI * 0.5 + (i / n) * Math.PI;
    out.push([straight + Math.cos(a) * r, Math.sin(a) * r]);
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * 0.5 + (i / n) * Math.PI;
    out.push([-straight + Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/* ==========================================================================
 * 9. PRIMITIVE: prismFromPlan — the shared extruded core
 * ========================================================================== */

export interface PrismParams {
  /** CCW-from-above plan in metres, centred on the origin. */
  plan: readonly V2[];
  /** Height along +Y. The result spans -h/2 .. +h/2. */
  h: number;
  chamferTop?: number;
  chamferBottom?: number;
  topScaleX?: number;
  topScaleZ?: number;
  bottomScaleX?: number;
  bottomScaleZ?: number;
  /** Metres the top plan slides along +Z. Glacis slopes and wedge prows. */
  shear?: number;
  /** Per-plan-edge box-face tags, for `faceSlots` overrides. */
  faces?: readonly (BoxFace | undefined)[];
  /** Per-plan-edge kinds. Cut corners should be 'bevel'. */
  kinds?: readonly FaceKind[];
  capKind?: FaceKind;
  group?: string;
  /** True for box-like plans (one edge = one full tile). */
  uPerEdge?: boolean;
  /** Skip the bottom cap — for parts that sit flush on another mass. */
  openBottom?: boolean;
}

/**
 * The workhorse. A four-ring stack:
 *
 *   r3   top cap, inset by chamferTop           <- a real cut face
 *   r2   top of the walls
 *   r1   bottom of the walls
 *   r0   bottom cap, inset by chamferBottom     <- a real cut face
 *
 * Every convex edge in the result is therefore a genuine chamfer band, and the
 * vertical edges are cut in PLAN (see `rectPlan`), which no amount of smooth
 * shading can fake.
 */
export function prismFromPlanMesh(p: PrismParams): ShapeMesh {
  const b = new ShapeBuilder();
  const plan = p.plan;
  if (plan.length < 3 || !(p.h > 0)) return EMPTY_MESH;

  const hy = p.h * 0.5;
  const shear = p.shear ?? 0;
  const tsx = p.topScaleX ?? 1, tsz = p.topScaleZ ?? 1;
  const bsx = p.bottomScaleX ?? 1, bsz = p.bottomScaleZ ?? 1;

  const topPlan = plan.map((q): V2 => [q[0] * tsx, q[1] * tsz]);
  const botPlan = plan.map((q): V2 => [q[0] * bsx, q[1] * bsz]);

  const cTop = Math.min(
    p.chamferTop ?? 0, hy * 0.9, maxInset(topPlan) * 0.9);
  const cBot = Math.min(
    p.chamferBottom ?? 0, (p.h - Math.max(0, cTop)) * 0.9, maxInset(botPlan) * 0.9);

  const uPerEdge = p.uPerEdge ?? true;
  const kinds = p.kinds ?? plan.map((): FaceKind => 'side');
  const capKind = p.capKind ?? 'cap';
  const bevelKinds = plan.map((): FaceKind => 'bevel');

  const r1 = ringFromPlan(botPlan, -hy + Math.max(0, cBot), 0);
  const r2 = ringFromPlan(topPlan, hy - Math.max(0, cTop), shear);

  // Walls.
  band(b, r1, r2, kinds, p.faces, p.group, uPerEdge, 0, 1);

  // Top rim chamfer + cap.
  if (cTop > 1e-5) {
    const r3 = ringFromPlan(insetConvex(topPlan, cTop), hy, shear);
    band(b, r2, r3, bevelKinds, undefined, p.group, uPerEdge, 0.94, 1);
    cap(b, r3, [0, 1, 0], capKind, 'py', p.group);
  } else {
    cap(b, r2, [0, 1, 0], capKind, 'py', p.group);
  }

  // Bottom rim chamfer + cap.
  if (!(p.openBottom ?? false)) {
    if (cBot > 1e-5) {
      const r0 = ringFromPlan(insetConvex(botPlan, cBot), -hy, 0);
      band(b, r0, r1, bevelKinds, undefined, p.group, uPerEdge, 0, 0.06);
      cap(b, r0, [0, -1, 0], capKind, 'ny', p.group);
    } else {
      cap(b, r1, [0, -1, 0], capKind, 'ny', p.group);
    }
  }
  return b.build();
}

/* ==========================================================================
 * 10. PRIMITIVE: chamferBox
 * ========================================================================== */

export interface ChamferBoxParams {
  w: number;
  h: number;
  d: number;
  /** Chamfer in metres. Omit and `autoChamfer` picks one — never zero. */
  chamfer?: number;
  chamferTop?: number;
  chamferBottom?: number;
  /** 45-degree cut on the four vertical corners. Defaults to `chamfer`. */
  cornerCut?: number;
  group?: string;
  openBottom?: boolean;
}

/**
 * THE WORKHORSE, and on its own it kills most of the boxiness in the roster.
 *
 * A box whose every convex edge is a REAL CUT FACE: four vertical corners cut in
 * plan (so it reads octagonal from above), a top rim chamfer, a bottom rim
 * chamfer, and six inset faces that still carry their `px`/`py`/`pz` tags so
 * per-face atlas slots keep working.
 *
 *   chamferBox({ w: 3.4, h: 0.95, d: 7.0 })            // a hull, auto chamfer
 *   chamferBox({ w: 2, h: 2, d: 2, chamfer: 0.28 })    // a heavy Soviet slab
 */
export function chamferBoxMesh(p: ChamferBoxParams): ShapeMesh {
  const c = autoChamfer(p.w, p.h, p.d, p.chamfer);
  const cut = Math.max(0, p.cornerCut ?? autoCornerCut(p.w, p.d, c));
  const { plan, faces, kinds } = rectPlan(p.w, p.d, cut);
  return prismFromPlanMesh({
    plan, h: p.h, faces, kinds,
    chamferTop: p.chamferTop ?? c,
    chamferBottom: p.chamferBottom ?? c,
    group: p.group,
    uPerEdge: true,
    openBottom: p.openBottom,
  });
}

/* ==========================================================================
 * 11. PRIMITIVE: taperedBox
 * ========================================================================== */

export interface TaperedBoxParams extends ChamferBoxParams {
  /** Top face width as a fraction of the bottom. < 1 narrows toward the deck. */
  topScaleX?: number;
  topScaleZ?: number;
  /** Bottom face scale. > 1 splays the skirt (bible 5.7 ALLIED-1). */
  bottomScaleX?: number;
  bottomScaleZ?: number;
  /** Metres the top face slides along +Z. THIS is the glacis / wedge prow. */
  shear?: number;
}

/**
 * A hull that narrows toward the deck, a glacis slope, a wedge prow, a splayed
 * Allied skirt. The `shear` is the important one: sliding the top face back
 * along +Z turns the front wall into a sloped plate, which is the single most
 * recognisable line on an RA3 tank.
 *
 *   taperedBox({ w: 3.4, h: 1.0, d: 7.0, topScaleX: 0.86, topScaleZ: 0.88,
 *                shear: -0.35 })                         // Guardian hull
 *   taperedBox({ w: 6, h: 3, d: 6, bottomScaleX: 1.32, bottomScaleZ: 1.32 })
 *                                                        // Allied splayed base
 */
export function taperedBoxMesh(p: TaperedBoxParams): ShapeMesh {
  const c = autoChamfer(p.w, p.h, p.d, p.chamfer);
  const cut = Math.max(0, p.cornerCut ?? autoCornerCut(p.w, p.d, c));
  const { plan, faces, kinds } = rectPlan(p.w, p.d, cut);
  return prismFromPlanMesh({
    plan, h: p.h, faces, kinds,
    chamferTop: p.chamferTop ?? c,
    chamferBottom: p.chamferBottom ?? c,
    topScaleX: p.topScaleX, topScaleZ: p.topScaleZ,
    bottomScaleX: p.bottomScaleX, bottomScaleZ: p.bottomScaleZ,
    shear: p.shear,
    group: p.group,
    uPerEdge: true,
    openBottom: p.openBottom,
  });
}

/* ==========================================================================
 * 12. PRIMITIVE: lathe
 * ========================================================================== */

export interface LatheParams {
  /** [radius, y] in METRES, bottom to top. Radius 0 collapses to a point. */
  profile: readonly V2[];
  /** Bible 5.5: 12-16, never 32. RA3 silhouettes are faceted on purpose. */
  segments?: number;
  /** Total radians of twist from the first ring to the last. */
  twist?: number;
  /** Squash the revolve on Z, for an oval turret. 1 = circular. */
  zScale?: number;
  group?: string;
}

/**
 * Revolved forms: turrets, domes, silos, nacelles, cooling towers, barrels.
 *
 * Bands whose profile step is short AND diagonal are auto-tagged 'bevel', so a
 * barrel's muzzle ring carries the same highlight strip a box edge does — the
 * consumer does not have to know which band was a chamfer.
 *
 *   lathe({ profile: turretProfile(1.5, 0.9), segments: 14 })
 *   lathe({ profile: [[0,0],[0.9,0],[0.9,2.4],[0.75,3.0],[0,3.0]], twist: 0.2 })
 */
export function latheMesh(p: LatheParams): ShapeMesh {
  const prof = p.profile;
  if (prof.length < 2) return EMPTY_MESH;
  const segs = Math.max(5, Math.round(p.segments ?? 14));
  const twist = p.twist ?? 0;
  const zs = p.zScale ?? 1;
  const b = new ShapeBuilder();

  let total = 0;
  for (let i = 1; i < prof.length; i++) {
    total += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]);
  }
  const inv = 1 / Math.max(1e-6, total);

  const yLo = prof[0][1], yHi = prof[prof.length - 1][1];
  const span = Math.max(1e-6, yHi - yLo);

  const ringAt = (r: number, y: number): Ring => {
    const t = (y - yLo) / span;
    const phase = twist * t;
    const pts: V3[] = [];
    const u: number[] = [];
    for (let s = 0; s < segs; s++) {
      const a = phase + (s / segs) * TAU;
      pts.push([Math.cos(a) * r, y, Math.sin(a) * r * zs]);
      u.push(s / segs);
    }
    u.push(1);
    return { pts, u };
  };

  let acc = 0;
  for (let i = 1; i < prof.length; i++) {
    const [r0, y0] = prof[i - 1];
    const [r1, y1] = prof[i];
    const dr = r1 - r0, dy = y1 - y0;
    const len = Math.hypot(dr, dy);
    if (len < 1e-7) continue;
    const v0 = acc * inv;
    acc += len;
    const v1 = acc * inv;

    // Short AND diagonal => this band is a chamfer rim, not a wall.
    const isBevel = len < total * 0.20 && Math.abs(dr) > 1e-4 && Math.abs(dy) > 1e-4;
    const kind: FaceKind = isBevel ? 'bevel' : 'side';

    if (r0 < 1e-6 && r1 < 1e-6) continue;
    if (r0 < 1e-6) {
      const ring = ringAt(r1, y1);
      cap(b, ring, [0, -1, 0], 'cap', 'ny', p.group);
      continue;
    }
    if (r1 < 1e-6) {
      const ring = ringAt(r0, y0);
      cap(b, ring, [0, 1, 0], 'cap', 'py', p.group);
      continue;
    }
    band(b, ringAt(r0, y0), ringAt(r1, y1), kind, undefined, p.group, false, v0, v1);
  }

  // Flat ends (a profile that starts or ends at a non-zero radius).
  if (prof[0][0] > 1e-6) cap(b, ringAt(prof[0][0], yLo), [0, -1, 0], 'cap', 'ny', p.group);
  const last = prof[prof.length - 1];
  if (last[0] > 1e-6) cap(b, ringAt(last[0], yHi), [0, 1, 0], 'cap', 'py', p.group);

  return b.build();
}

/* -- authored profiles ------------------------------------------------------ */

/** A chamfered cylinder profile. The rim cuts ARE the highlight on a barrel. */
export function cylinderProfile(r: number, h: number, chamfer?: number, rTop = 1): V2[] {
  const c = Math.min(autoChamfer(r * 2, h, r * 2, chamfer), Math.min(r, h) * 0.4);
  return [
    [0, 0], [r - c, 0], [r, c],
    [r * rTop, h - c], [r * rTop - c, h], [0, h],
  ];
}

/** A hemisphere sitting on the ground plane. Cockpits, radomes, Soviet domes. */
export function domeProfile(r: number, h: number, rings = 6): V2[] {
  const out: V2[] = [[0, 0], [r, 0]];
  for (let i = 1; i <= rings; i++) {
    const t = (i / rings) * Math.PI * 0.5;
    out.push([r * Math.cos(t), h * Math.sin(t)]);
  }
  return out;
}

/** Hemisphere cap, straight body, hemisphere cap. Ordnance, pressure vessels. */
export function capsuleProfile(r: number, h: number, rings = 4): V2[] {
  const cap = Math.min(r, h * 0.5);
  const out: V2[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI * 0.5;
    out.push([r * Math.sin(t), cap - cap * Math.cos(t)]);
  }
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI * 0.5;
    out.push([r * Math.cos(t), h - cap + cap * Math.sin(t)]);
  }
  return out;
}

/**
 * THE RA3 TURRET PROFILE, and the reason a lathed turret stops reading as a box:
 * a wide chamfered base ring, a sloped shoulder, a narrower flat roof. Faceted
 * at 12-16 segments this is the Hammer/Guardian silhouette.
 */
export function turretProfile(r: number, h: number, roofScale = 0.68): V2[] {
  const c = Math.min(r * 0.16, h * 0.22);
  return [
    [0, 0],
    [r - c * 0.7, 0],
    [r, c * 0.7],
    [r, h * 0.42],
    [r * roofScale, h - c],
    [r * roofScale - c * 0.7, h],
    [0, h],
  ];
}

/** A flat disc with chamfered rims. Road wheels, sprockets, hatch caps. */
export function discProfile(r: number, thickness: number): V2[] {
  const c = Math.min(r * 0.18, thickness * 0.34);
  return [
    [0, 0], [r - c, 0], [r, c],
    [r, thickness - c], [r - c, thickness], [0, thickness],
  ];
}

/* ==========================================================================
 * 13. PRIMITIVE: facetedCylinder / facetedCone
 * ========================================================================== */

export interface CylinderParams {
  r: number;
  h: number;
  segments?: number;
  /** Rim chamfer in metres. Auto if omitted. */
  capChamfer?: number;
  /** Top radius as a fraction of `r`. 1 = straight, < 1 = tapered stack. */
  rTop?: number;
  /** Squash on Z for an oval section. */
  zScale?: number;
  twist?: number;
  group?: string;
}

/** Centred on its own bounding box, axis +Y. */
export function facetedCylinderMesh(p: CylinderParams): ShapeMesh {
  const prof = cylinderProfile(p.r, p.h, p.capChamfer, p.rTop ?? 1);
  return centerMesh(latheMesh({
    profile: prof,
    segments: p.segments ?? 14,
    twist: p.twist,
    zScale: p.zScale,
    group: p.group,
  }));
}

export interface ConeParams extends CylinderParams {
  /** Top radius as a fraction of `r`. 0 = a point, 0.2 = a nose cone. */
  rTop?: number;
}

/** A truncated cone with chamfered rims. Nose cones, stacks, muzzle brakes. */
export function facetedConeMesh(p: ConeParams): ShapeMesh {
  const rTop = Math.max(0, p.rTop ?? 0.25);
  const c = Math.min(autoChamfer(p.r * 2, p.h, p.r * 2, p.capChamfer), Math.min(p.r, p.h) * 0.3);
  const rt = p.r * rTop;
  const prof: V2[] = rt <= 1e-5
    ? [[0, 0], [p.r - c, 0], [p.r, c], [0, p.h]]
    : [[0, 0], [p.r - c, 0], [p.r, c], [rt, p.h - c * 0.6], [Math.max(0, rt - c * 0.6), p.h], [0, p.h]];
  return centerMesh(latheMesh({
    profile: prof, segments: p.segments ?? 12, zScale: p.zScale, group: p.group,
  }));
}

/* ==========================================================================
 * 14. PRIMITIVE: extrudeProfile
 * ========================================================================== */

export interface ExtrudeParams {
  /** Cross-section outline, CCW, in the frame's (right, up) plane, metres. */
  profile: readonly V2[];
  /** Polyline the section is swept along. At least two points. */
  path: readonly V3[];
  /** Per-path-point section scale. Length must match `path` if given. */
  scale?: readonly number[];
  /** Radians of twist accumulated along the whole path. */
  twist?: number;
  capStart?: boolean;
  capEnd?: boolean;
  group?: string;
  /** Kind tag for the swept walls. Named `faceKind` so `ShapeSpec.kind` is free. */
  faceKind?: FaceKind;
}

/**
 * Sweep a 2D outline along a 3D path with parallel-transport frames.
 *
 * This is the primitive for angled plating runs, gantries, exhaust pipework, and
 * stepped barrels (constant path, varying `scale`).
 *
 *   extrudeProfile({
 *     profile: ngonPlan(0.19, 0.19, 10),
 *     path: [[0,0,0],[0,0,1.6],[0,0,2.0],[0,0,4.3]],
 *     scale: [1, 1, 1.28, 1.06],            // the step behind the muzzle brake
 *     capStart: true, capEnd: true,
 *   })
 */
export function extrudeProfileMesh(p: ExtrudeParams): ShapeMesh {
  const path = p.path;
  if (path.length < 2 || p.profile.length < 3) return EMPTY_MESH;
  const b = new ShapeBuilder();

  // Parallel transport: start with any frame perpendicular to the first tangent,
  // then rotate it minimally at each joint so the section never spins.
  const tangents: V3[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)];
    const c = path[Math.min(path.length - 1, i + 1)];
    const t = sub(c, a);
    tangents.push(Math.hypot(t[0], t[1], t[2]) < 1e-9 ? [0, 0, 1] : norm(t));
  }

  let [right] = basisFor(tangents[0]);
  let up = cross(tangents[0], right);
  const rings: Ring[] = [];
  let totalLen = 0;
  const lens: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    totalLen += Math.hypot(...sub(path[i], path[i - 1]) as [number, number, number]);
    lens.push(totalLen);
  }

  for (let i = 0; i < path.length; i++) {
    if (i > 0) {
      // Rotate the frame from tangent[i-1] to tangent[i] about their common perp.
      const t0 = tangents[i - 1], t1 = tangents[i];
      const axis = cross(t0, t1);
      const s = Math.hypot(axis[0], axis[1], axis[2]);
      if (s > 1e-7) {
        const ax = norm(axis);
        const ang = Math.atan2(s, dot(t0, t1));
        right = rotateAbout(right, ax, ang);
        up = rotateAbout(up, ax, ang);
      }
    }
    const tw = (p.twist ?? 0) * (totalLen > 1e-9 ? lens[i] / totalLen : 0);
    const rr = tw === 0 ? right : rotateAbout(right, tangents[i], tw);
    const uu = tw === 0 ? up : rotateAbout(up, tangents[i], tw);
    const sc = p.scale?.[i] ?? 1;
    const o = path[i];
    const pts: V3[] = p.profile.map((q): V3 => [
      o[0] + (rr[0] * q[0] + uu[0] * q[1]) * sc,
      o[1] + (rr[1] * q[0] + uu[1] * q[1]) * sc,
      o[2] + (rr[2] * q[0] + uu[2] * q[1]) * sc,
    ]);
    const u: number[] = [0];
    let per = 0;
    for (let k = 1; k <= pts.length; k++) {
      per += Math.hypot(...sub(pts[k % pts.length], pts[k - 1]) as [number, number, number]);
      u.push(per);
    }
    const invPer = 1 / Math.max(1e-6, per);
    rings.push({ pts, u: u.map((x) => x * invPer) });
  }

  const kind = p.faceKind ?? 'side';
  for (let i = 1; i < rings.length; i++) {
    const v0 = totalLen > 1e-9 ? lens[i - 1] / totalLen : 0;
    const v1 = totalLen > 1e-9 ? lens[i] / totalLen : 1;
    band(b, rings[i - 1], rings[i], kind, undefined, p.group, false, v0, v1);
  }
  if (p.capStart ?? true) cap(b, rings[0], mul3(tangents[0], -1), 'cap', undefined, p.group);
  if (p.capEnd ?? true) cap(b, rings[rings.length - 1], tangents[tangents.length - 1], 'cap', undefined, p.group);
  return b.build();
}

function rotateAbout(v: V3, axis: V3, angle: number): [number, number, number] {
  const c = Math.cos(angle), s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [
    v[0] * c + k[0] * s + axis[0] * d,
    v[1] * c + k[1] * s + axis[1] * d,
    v[2] * c + k[2] * s + axis[2] * d,
  ];
}

/* ==========================================================================
 * 15. PRIMITIVE: plate
 * ========================================================================== */

export interface PlateParams {
  /** Outline in the plate's local XZ plane, CCW from above, metres. */
  outline: readonly V2[];
  /** Plate thickness along local +Y. */
  thickness: number;
  /** Rim chamfer. Auto if omitted. */
  bevel?: number;
  group?: string;
}

/**
 * A THIN ANGLED ARMOUR PLATE, meant to be LAYERED OVER a core mass.
 *
 * This is the single most effective way to read as hi-tech rather than as a box:
 * a hull is one taperedBox, and then three or four plates sit proud of it at
 * slightly different angles with a dark gap underneath. That is what RA3 armour
 * actually is, and it costs ~60 triangles a plate.
 *
 *   plate({ outline: [[-1.4,-2.2],[1.4,-2.2],[1.1,2.4],[-1.1,2.4]],
 *           thickness: 0.10 })                       // a glacis plate
 */
export function plateMesh(p: PlateParams): ShapeMesh {
  if (p.outline.length < 3) return EMPTY_MESH;
  let ex = 0, ez = 0;
  for (const q of p.outline) { ex = Math.max(ex, Math.abs(q[0]) * 2); ez = Math.max(ez, Math.abs(q[1]) * 2); }
  const c = Math.min(
    autoChamfer(ex, p.thickness, ez, p.bevel),
    p.thickness * 0.42,
    maxInset(p.outline) * 0.8,
  );
  return prismFromPlanMesh({
    plan: p.outline,
    h: p.thickness,
    chamferTop: c,
    chamferBottom: c,
    kinds: p.outline.map((): FaceKind => 'bevel'),
    capKind: 'cap',
    group: p.group ?? 'plate',
    uPerEdge: false,
  });
}

/* ==========================================================================
 * 16. PRIMITIVE: hullOf — convex hull with real bevels
 * ========================================================================== */

export interface HullParams {
  chamfer?: number;
  group?: string;
}

/**
 * A CONVEX HULL of a point cloud, then every edge and vertex BEVELLED with real
 * cut faces. Organic-but-hard-edged pods, cockpits, blended fuselages, Empire
 * folded-plate noses — anything that should not be a stack of rectangles but
 * must still read as machined.
 *
 *   hullOf([[0,0,2.4],[0.9,0.5,0.6],[-0.9,0.5,0.6],[0.7,-0.3,-1.6],
 *           [-0.7,-0.3,-1.6],[0,0.9,-0.4]], { chamfer: 0.10 })
 */
export function hullOfMesh(points: readonly V3[], o: HullParams = {}): ShapeMesh {
  const faces = convexHullFaces(points);
  if (faces === null) {
    // Degenerate cloud (all coplanar / collinear). Fall back to its AABB, which
    // is always better than returning nothing.
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const p of points) for (let a = 0; a < 3; a++) {
      if (p[a] < min[a]) min[a] = p[a];
      if (p[a] > max[a]) max[a] = p[a];
    }
    const w = Math.max(0.01, max[0] - min[0]);
    const h = Math.max(0.01, max[1] - min[1]);
    const d = Math.max(0.01, max[2] - min[2]);
    return transformMesh(chamferBoxMesh({ w, h, d, chamfer: o.chamfer, group: o.group }),
      translation((min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5));
  }

  const { verts, polys } = faces;
  const b = new ShapeBuilder();

  let extent = 0;
  for (const v of verts) extent = Math.max(extent, Math.hypot(v[0], v[1], v[2]));
  const chamfer = Math.max(1e-4, o.chamfer ?? Math.max(CHAMFER.minMeters, extent * 0.08));

  // Per-face inset polygons, in the face's own plane.
  const normals: V3[] = polys.map((f) => newell(f.map((i) => verts[i])));
  const inset: V3[][] = polys.map((f, fi) => insetFace(f.map((i) => verts[i]), normals[fi], chamfer));

  for (let fi = 0; fi < polys.length; fi++) {
    const n = normals[fi];
    const kind: FaceKind = Math.abs(n[1]) > 0.72 ? 'cap' : 'side';
    b.face(inset[fi], n, kind, undefined, o.group);
  }

  // Edge bevels: bridge the two inset edges that came from the same hull edge.
  const edgeMap = new Map<string, { f: number; i: number }[]>();
  for (let fi = 0; fi < polys.length; fi++) {
    const f = polys[fi];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], c = f[(i + 1) % f.length];
      const key = a < c ? `${a}_${c}` : `${c}_${a}`;
      const list = edgeMap.get(key);
      if (list === undefined) edgeMap.set(key, [{ f: fi, i }]);
      else list.push({ f: fi, i });
    }
  }
  for (const list of edgeMap.values()) {
    if (list.length !== 2) continue;
    const [x, y] = list;
    const fx = polys[x.f], fy = polys[y.f];
    const ax = inset[x.f][x.i], bx = inset[x.f][(x.i + 1) % fx.length];
    const ay = inset[y.f][y.i], by = inset[y.f][(y.i + 1) % fy.length];
    // The neighbour traverses the shared edge in the opposite direction.
    const hint = norm(add3(normals[x.f], normals[y.f]));
    b.quad(ax, bx, ay, by, hint, 'bevel', undefined, o.group);
  }

  // Vertex bevels: the little corner facet where three or more edges meet.
  const vertFaces = new Map<number, { f: number; i: number }[]>();
  for (let fi = 0; fi < polys.length; fi++) {
    const f = polys[fi];
    for (let i = 0; i < f.length; i++) {
      const list = vertFaces.get(f[i]);
      if (list === undefined) vertFaces.set(f[i], [{ f: fi, i }]);
      else list.push({ f: fi, i });
    }
  }
  for (const [vi, list] of vertFaces) {
    if (list.length < 3) continue;
    let nx = 0, ny = 0, nz = 0;
    for (const e of list) { nx += normals[e.f][0]; ny += normals[e.f][1]; nz += normals[e.f][2]; }
    const n = norm([nx, ny, nz]);
    const [bu, bv] = basisFor(n);
    const origin = verts[vi];
    const ring = list
      .map((e) => inset[e.f][e.i])
      .map((q) => ({ q, a: Math.atan2(dot(sub(q, origin), bv), dot(sub(q, origin), bu)) }))
      .sort((p, q) => p.a - q.a)
      .map((e) => e.q);
    b.face(ring, n, 'bevel', undefined, o.group);
  }

  return b.build();
}

/** In-plane inset of a convex face polygon by `d` metres. */
function insetFace(pts: readonly V3[], n: V3, d: number): V3[] {
  const [bu, bv] = basisFor(n);
  const origin = pts[0];
  const flat: V2[] = pts.map((p) => {
    const r = sub(p, origin);
    return [dot(r, bu), dot(r, bv)];
  });
  // insetConvex expects the CCW-from-above sense; our basis is right-handed about
  // `n`, so a face CCW about `n` projects CCW here too.
  const area = planArea(flat);
  const src = area >= 0 ? flat : flat.slice().reverse();
  const room = maxInset(src);
  const inner = insetConvex(src, Math.min(d, room * 0.85));
  const outOrdered = area >= 0 ? inner : inner.slice().reverse();
  return outOrdered.map((q): V3 => [
    origin[0] + bu[0] * q[0] + bv[0] * q[1],
    origin[1] + bu[1] * q[0] + bv[1] * q[1],
    origin[2] + bu[2] * q[0] + bv[2] * q[1],
  ]);
}

/* -- convex hull ------------------------------------------------------------ */

interface HullFaces { verts: V3[]; polys: number[][]; }

/**
 * Incremental 3D convex hull, then coplanar triangles merged into polygons.
 * O(n^2) and deterministic. Point counts here are 6-30, so this is microseconds.
 * Returns null for a degenerate (coplanar or collinear) cloud.
 */
function convexHullFaces(points: readonly V3[]): HullFaces | null {
  const verts: V3[] = [];
  for (const p of points) {
    let dup = false;
    for (const q of verts) {
      if (Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7 && Math.abs(p[2] - q[2]) < 1e-7) {
        dup = true; break;
      }
    }
    if (!dup) verts.push([p[0], p[1], p[2]]);
  }
  if (verts.length < 4) return null;

  // Seed tetrahedron.
  let i0 = 0, i1 = 1;
  let best = -1;
  for (let a = 0; a < verts.length; a++) for (let c = a + 1; c < verts.length; c++) {
    const dd = Math.hypot(...sub(verts[c], verts[a]) as [number, number, number]);
    if (dd > best) { best = dd; i0 = a; i1 = c; }
  }
  if (best < 1e-7) return null;
  let i2 = -1; best = -1;
  for (let a = 0; a < verts.length; a++) {
    if (a === i0 || a === i1) continue;
    const area = Math.hypot(...cross(sub(verts[i1], verts[i0]), sub(verts[a], verts[i0])) as [number, number, number]);
    if (area > best) { best = area; i2 = a; }
  }
  if (i2 < 0 || best < 1e-9) return null;
  const nSeed = norm(cross(sub(verts[i1], verts[i0]), sub(verts[i2], verts[i0])));
  let i3 = -1; best = -1;
  for (let a = 0; a < verts.length; a++) {
    if (a === i0 || a === i1 || a === i2) continue;
    const h = Math.abs(dot(nSeed, sub(verts[a], verts[i0])));
    if (h > best) { best = h; i3 = a; }
  }
  if (i3 < 0 || best < 1e-7) return null;

  type Tri = [number, number, number];
  const tris: Tri[] = [];
  const pushTri = (a: number, b: number, c: number, inside: V3): void => {
    const n = cross(sub(verts[b], verts[a]), sub(verts[c], verts[a]));
    tris.push(dot(n, sub(inside, verts[a])) > 0 ? [a, c, b] : [a, b, c]);
  };
  const centroid: V3 = [
    (verts[i0][0] + verts[i1][0] + verts[i2][0] + verts[i3][0]) / 4,
    (verts[i0][1] + verts[i1][1] + verts[i2][1] + verts[i3][1]) / 4,
    (verts[i0][2] + verts[i1][2] + verts[i2][2] + verts[i3][2]) / 4,
  ];
  pushTri(i0, i1, i2, centroid);
  pushTri(i0, i1, i3, centroid);
  pushTri(i0, i2, i3, centroid);
  pushTri(i1, i2, i3, centroid);

  const seeded = new Set([i0, i1, i2, i3]);
  const eps = Math.max(1e-9, best * 1e-6);

  for (let vi = 0; vi < verts.length; vi++) {
    if (seeded.has(vi)) continue;
    const p = verts[vi];
    const visible: number[] = [];
    for (let t = 0; t < tris.length; t++) {
      const [a, b, c] = tris[t];
      const n = cross(sub(verts[b], verts[a]), sub(verts[c], verts[a]));
      if (dot(n, sub(p, verts[a])) > eps) visible.push(t);
    }
    if (visible.length === 0) continue;
    // Horizon = edges owned by exactly one visible triangle.
    const count = new Map<string, number>();
    const order = new Map<string, [number, number]>();
    for (const t of visible) {
      const [a, b, c] = tris[t];
      for (const [x, y] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        const key = x < y ? `${x}_${y}` : `${y}_${x}`;
        count.set(key, (count.get(key) ?? 0) + 1);
        if (!order.has(key)) order.set(key, [x, y]);
      }
    }
    const vis = new Set(visible);
    const kept: Tri[] = [];
    for (let t = 0; t < tris.length; t++) if (!vis.has(t)) kept.push(tris[t]);
    for (const [key, n] of count) {
      if (n !== 1) continue;
      const [x, y] = order.get(key)!;
      const nn = cross(sub(verts[y], verts[x]), sub(p, verts[x]));
      // Orient away from the hull interior. The seed tetrahedron's centroid is
      // inside the hull at the start and the hull only ever grows, so it stays
      // inside for every later point.
      kept.push(dot(nn, sub(centroid, verts[x])) > 0 ? [x, vi, y] : [x, y, vi]);
    }
    tris.length = 0;
    for (const t of kept) tris.push(t);
  }

  if (tris.length < 4) return null;

  /* -- merge coplanar triangles into polygons ---------------------------- */
  const triNormals = tris.map((t) => norm(cross(sub(verts[t[1]], verts[t[0]]), sub(verts[t[2]], verts[t[0]]))));
  const triOffset = tris.map((t, i) => dot(triNormals[i], verts[t[0]]));
  const group = new Int32Array(tris.length).fill(-1);
  const groups: number[][] = [];
  for (let t = 0; t < tris.length; t++) {
    if (group[t] >= 0) continue;
    const g = groups.length;
    const members: number[] = [];
    const stack = [t];
    group[t] = g;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      members.push(cur);
      for (let o = 0; o < tris.length; o++) {
        if (group[o] >= 0) continue;
        if (dot(triNormals[cur], triNormals[o]) < 0.9995) continue;
        if (Math.abs(triOffset[cur] - triOffset[o]) > 1e-5) continue;
        group[o] = g;
        stack.push(o);
      }
    }
    groups.push(members);
  }

  const polys: number[][] = [];
  for (const members of groups) {
    // Boundary edges: directed edges with no opposite twin inside the group.
    const dir = new Set<string>();
    for (const t of members) {
      const [a, b, c] = tris[t];
      dir.add(`${a}_${b}`); dir.add(`${b}_${c}`); dir.add(`${c}_${a}`);
    }
    const next = new Map<number, number>();
    for (const e of dir) {
      const [a, b] = e.split('_').map(Number);
      if (dir.has(`${b}_${a}`)) continue;
      next.set(a, b);
    }
    if (next.size < 3) continue;
    const start = next.keys().next().value as number;
    const loop: number[] = [start];
    let cur = next.get(start)!;
    let guard = 0;
    while (cur !== start && guard++ < 512) {
      loop.push(cur);
      const nx = next.get(cur);
      if (nx === undefined) break;
      cur = nx;
    }
    if (loop.length >= 3) polys.push(loop);
  }
  if (polys.length < 4) return null;
  return { verts, polys };
}

/* ==========================================================================
 * 17. PRIMITIVE: greebleStrip
 * ========================================================================== */

export interface GreebleStripParams {
  /** Run length along +Z. */
  length: number;
  /** Items per metre. 2-4 reads well; above 6 becomes noise (bible 5.3). */
  density?: number;
  seed: number;
  /** Strip width along X. */
  width?: number;
  /** Tallest item height along +Y. */
  height?: number;
  group?: string;
}

/**
 * A deterministic run of small mechanical hardware — louvre stacks, bolt rows,
 * pipe runs, junction boxes, cooling fins — for breaking up a long flat edge.
 *
 * Counts as ONE readable greeble object against bible 5.3's 6-12 budget, which
 * is why every polygon it emits is tagged 'detail' and carries a sub-group name.
 * Centred on its own bounding box, sitting with its base at the box's floor.
 *
 *   greebleStrip({ length: 4.2, density: 3, seed: 91, width: 0.34, height: 0.22 })
 */
export function greebleStripMesh(p: GreebleStripParams): ShapeMesh {
  const len = Math.max(0.05, p.length);
  const w = p.width ?? Math.max(0.08, len * 0.07);
  const h = p.height ?? w * 0.7;
  const density = Math.max(0.5, p.density ?? 2.2);
  const count = Math.max(1, Math.round(len * density));
  const rng = new Rng((p.seed | 0) ^ 0x5f37);
  const b = new ShapeBuilder();
  const pitch = len / count;

  // Every item here is deliberately CHEAP: `cornerCut: 0` keeps a box at four
  // walls (28 triangles instead of 60) and the cylinders run at 6 segments. A
  // 3 cm bolt's corner cut is a quarter of a pixel at gameplay zoom, so paying
  // for it is pure cost. A strip of 12 items lands at ~350 triangles.
  for (let i = 0; i < count; i++) {
    const z = -len * 0.5 + (i + 0.5) * pitch;
    const roll = rng.next();
    if (roll < 0.34) {
      // Louvre stack: three thin fins, the cheapest legible greeble there is.
      for (let f = 0; f < 3; f++) {
        const fh = h * 0.72;
        b.merge(chamferBoxMesh({ w: w * 0.92, h: fh * 0.26, d: pitch * 0.20, cornerCut: 0, group: 'louvre' }),
          compose(translation(0, fh * (0.22 + f * 0.30), z + (f - 1) * pitch * 0.22), rotationX(-0.22)));
      }
    } else if (roll < 0.58) {
      // Bolt pair.
      for (const sx of [-1, 1]) {
        b.merge(facetedCylinderMesh({ r: w * 0.16, h: h * 0.42, segments: 6, group: 'bolt' }),
          translation(sx * w * 0.28, h * 0.21, z));
      }
    } else if (roll < 0.80) {
      // Junction box.
      b.merge(chamferBoxMesh({ w: w * 0.78, h: h * 0.9, d: pitch * 0.62, cornerCut: 0, group: 'box' }),
        translation(0, h * 0.45, z));
    } else {
      // Pipe run with a collar: spans the slot, so it reads as continuous.
      b.merge(facetedCylinderMesh({ r: w * 0.19, h: pitch * 0.94, segments: 6, group: 'pipe' }),
        compose(translation(0, h * 0.34, z), rotationX(Math.PI * 0.5)));
      b.merge(facetedCylinderMesh({ r: w * 0.26, h: pitch * 0.16, segments: 6, group: 'collar' }),
        compose(translation(0, h * 0.34, z + pitch * 0.30), rotationX(Math.PI * 0.5)));
    }
  }
  const raw = b.build();
  if (raw.polys.length === 0) return EMPTY_MESH;
  // Re-tag every polygon 'detail' while keeping its sub-group name.
  const polys = raw.polys.map((q) => ({ ...q, kind: 'detail' as FaceKind }));
  return centerMesh(finalize(polys));
}

/* ==========================================================================
 * 18. PRIMITIVE: trackAssembly
 * ========================================================================== */

export interface TrackAssemblyParams {
  /** Ground-contact length along Z. */
  length: number;
  /** Overall height of the running gear. */
  height: number;
  /**
   * TOTAL X footprint of the assembly — band plus the proud hubs plus the
   * skirt, not the band alone. `UNIT_GEOMETRY.trackBandFraction` and its three
   * siblings divide it, and they sum to 1, so the built AABB comes out exactly
   * this wide and `fitMesh` scales X by 1.
   */
  width: number;
  /** Road wheels between the sprockets. VISUAL_DNA S5 wants 5-7 dots. */
  wheels?: number;
  /** Drive sprocket / idler radius as a fraction of height*0.5. */
  sprocketScale?: number;
  /** Small rollers carrying the return run along the top. */
  returnRollers?: number;
  /**
   * A skirt plate over the upper run. Set 0 to leave the gear exposed — but
   * note the skirt is the assembly's outboard edge, so without it the hub plane
   * becomes the edge, the built AABB comes out `trackSkirtGapFraction +
   * trackSkirtFraction` narrower than `width`, and `fitMesh` stretches X to
   * make up the difference. Nothing in the roster does this.
   */
  skirtHeight?: number;
  segments?: number;
}

/**
 * PROPER TRACKED RUNNING GEAR, instead of a flat slab on the side of a hull.
 *
 * A stadium-section track band (so the ends are ROUND, which is the thing a flat
 * slab gets wrong), road wheels standing PROUD OF THE BAND'S OUTBOARD FACE, a
 * toothed drive sprocket aft and an idler forward, return rollers along the top
 * run, and an optional skirt plate that clears the hub plane. Emitted centred,
 * with the ground contact at y = -h/2, so it drops straight into a `MassDef`
 * whose anchor is the mass centre.
 *
 * THE HUBS FACE THE CAMERA ON PURPOSE. They used to sit inboard of the band,
 * where the band, the hull deck and the far track sealed them in and their
 * visible area was exactly zero — see `UNIT_GEOMETRY.trackBandFraction` for the
 * measurements and for the two spec lines (VISUAL_DNA S5, scorecard C16 x2)
 * that a dotless track band fails. Each disc's flat face is a 'cap' polygon, so
 * it takes the mass's `capSlot` ('bareMetal'), and it sits against a band that
 * takes the mass's `slot` ('tread'). Bright dots, dark band, no extra draw call:
 * the whole assembly is still one merged mesh.
 *
 *   trackAssembly({ length: 6.6, height: 0.86, width: 0.86, wheels: 5 })
 */
export function trackAssemblyMesh(p: TrackAssemblyParams): ShapeMesh {
  const len = Math.max(0.2, p.length);
  const h = Math.max(0.08, p.height);
  // `w` is the assembly's whole X footprint; `bw` is the band inside it.
  const w = Math.max(0.05, p.width);
  const bw = w * UNIT_GEOMETRY.trackBandFraction;
  // The track is a primary silhouette, not background garnish. Six facets were
  // visible as a hexagon in close tactical shots; ten keeps the stadium ends
  // round while remaining far below a film-resolution tread assembly.
  const segs = Math.max(6, Math.round(p.segments ?? 10));
  const b = new ShapeBuilder();

  // The band: a stadium plan extruded along X. Built in plan space (x = Z,
  // z = Y) then rotated upright, so `stadiumPlan` can be reused verbatim.
  const bandPlan = stadiumPlan(len, h, segs);
  const bandMesh = prismFromPlanMesh({
    plan: bandPlan,
    h: bw,
    chamferTop: bw * 0.16,
    chamferBottom: bw * 0.16,
    kinds: bandPlan.map((): FaceKind => 'side'),
    capKind: 'side',
    group: 'band',
    uPerEdge: false,
  });
  // plan-space (x, z) -> world (z, y); extrusion axis y -> world x.
  b.merge(bandMesh, compose(rotationY(Math.PI * 0.5), rotationX(-Math.PI * 0.5)));

  const wheels = Math.max(2, Math.round(p.wheels ?? 5));
  const sprocketR = h * 0.5 * (p.sprocketScale ?? 0.92);
  const wheelR = h * 0.40;
  const wheelT = bw * 0.52;
  const sprocketT = wheelT * 1.15;
  // ONE HUB PLANE, outboard of the band, shared by every rotating part. A disc
  // lathed about +Y and turned by rotationZ(90 deg) occupies x in
  // [hub - thickness, hub], so `hub` IS the outward-facing disc face.
  const hub = bw * 0.5 + w * UNIT_GEOMETRY.trackHubProudFraction;

  // Road wheels, proud of the band's outer face, sitting on the ground line.
  // This row is VISUAL_DNA S5's "5-7 bright road-wheel dots"; it is the reason
  // the layout fractions exist.
  const run = len - sprocketR * 2.4;
  for (let i = 0; i < wheels; i++) {
    const t = wheels === 1 ? 0.5 : i / (wheels - 1);
    const z = -run * 0.5 + run * t;
    b.merge(latheMesh({ profile: discProfile(wheelR, wheelT), segments: 12, group: 'wheel' }),
      compose(translation(hub, -h * 0.5 + wheelR, z), rotationZ(Math.PI * 0.5)));
  }

  // Drive sprocket aft, idler forward — both larger, both toothed.
  const hubs: { z: number; group: string }[] = [
    { z: -len * 0.5 + sprocketR, group: 'sprocket' },
    { z: len * 0.5 - sprocketR, group: 'idler' },
  ];
  for (const end of hubs) {
    b.merge(latheMesh({ profile: discProfile(sprocketR, sprocketT), segments: 16, group: end.group }),
      compose(translation(hub, -h * 0.5 + sprocketR, end.z), rotationZ(Math.PI * 0.5)));
    const teeth = 8;
    // Centred on the sprocket's MID-plane, not on its outer face. Centring them
    // on the face let them stand 0.45 * wheelT proud of the sprocket; that was
    // invisible while the whole hub was buried, and would read as a mistake now
    // that the face is the thing the camera looks at.
    const toothX = hub - sprocketT * 0.5;
    for (let t = 0; t < teeth; t++) {
      const a = (t / teeth) * TAU;
      b.merge(
        chamferBoxMesh({ w: wheelT * 0.9, h: sprocketR * 0.22, d: sprocketR * 0.22, cornerCut: 0, group: 'tooth' }),
        compose(
          translation(
            toothX,
            -h * 0.5 + sprocketR + Math.sin(a) * sprocketR * 0.94,
            end.z + Math.cos(a) * sprocketR * 0.94),
          rotationX(-a)),
      );
    }
  }

  // Return rollers along the top run.
  const rollers = Math.max(0, Math.round(p.returnRollers ?? 2));
  for (let i = 0; i < rollers; i++) {
    const t = rollers === 1 ? 0.5 : i / (rollers - 1);
    const z = -run * 0.34 + run * 0.68 * t;
    b.merge(latheMesh({ profile: discProfile(h * 0.16, wheelT * 0.7), segments: 10, group: 'roller' }),
      compose(translation(hub, h * 0.5 - h * 0.20, z), rotationZ(Math.PI * 0.5)));
  }

  // Skirt: a proud angled plate over the upper run. It is what turns exposed
  // running gear into a finished vehicle instead of a kit model. It clears the
  // hub plane by `trackSkirtGapFraction` so the wheels never poke through it,
  // and it only covers the TOP of the run — the lower half of every wheel stays
  // out in the open, which is the half a top-down camera can see.
  const skirtT = w * UNIT_GEOMETRY.trackSkirtFraction;
  const skirtX = hub + w * UNIT_GEOMETRY.trackSkirtGapFraction + skirtT * 0.5;
  const skirtH = p.skirtHeight ?? h * 0.46;
  if (skirtH > 1e-3) {
    const sl = len * 0.92;
    b.merge(plateMesh({
      outline: [
        [-sl * 0.5, -skirtH * 0.5], [sl * 0.5 - skirtH * 0.35, -skirtH * 0.5],
        [sl * 0.5, skirtH * 0.5], [-sl * 0.5 + skirtH * 0.25, skirtH * 0.5],
      ],
      thickness: skirtT,
      group: 'skirt',
    }), compose(
      compose(translation(skirtX, h * 0.5 - skirtH * 0.52, 0), rotationY(Math.PI * 0.5)),
      rotationX(-Math.PI * 0.5)));
  }

  return centerMesh(b.build());
}

/* ==========================================================================
 * 19. THE DISPATCHER
 *
 * One tagged union, so `MassList` can carry "any Shapes primitive with its
 * parameters" as data and a consumer can build it without a switch of its own.
 * ========================================================================== */

export type ShapeSpec =
  | ({ kind: 'chamferBox' } & ChamferBoxParams)
  | ({ kind: 'taperedBox' } & TaperedBoxParams)
  | ({ kind: 'prism' } & PrismParams)
  | ({ kind: 'lathe' } & LatheParams)
  | ({ kind: 'cylinder' } & CylinderParams)
  | ({ kind: 'cone' } & ConeParams)
  | ({ kind: 'extrude' } & ExtrudeParams)
  | ({ kind: 'plate' } & PlateParams)
  | ({ kind: 'hull'; points: readonly V3[] } & HullParams)
  | ({ kind: 'greebleStrip' } & GreebleStripParams)
  | ({ kind: 'tracks' } & TrackAssemblyParams);

export type ShapeKind = ShapeSpec['kind'];

/** Every primitive name, for validation and for iteration in tests. */
export const SHAPE_KINDS: readonly ShapeKind[] = [
  'chamferBox', 'taperedBox', 'prism', 'lathe', 'cylinder', 'cone',
  'extrude', 'plate', 'hull', 'greebleStrip', 'tracks',
];

/** Build any primitive from its spec. */
export function shapeMesh(spec: ShapeSpec): ShapeMesh {
  switch (spec.kind) {
    case 'chamferBox': return chamferBoxMesh(spec);
    case 'taperedBox': return taperedBoxMesh(spec);
    case 'prism': return prismFromPlanMesh(spec);
    case 'lathe': return latheMesh(spec);
    case 'cylinder': return facetedCylinderMesh(spec);
    case 'cone': return facetedConeMesh(spec);
    case 'extrude': return extrudeProfileMesh(spec);
    case 'plate': return plateMesh(spec);
    case 'hull': return hullOfMesh(spec.points, spec);
    case 'greebleStrip': return greebleStripMesh(spec);
    case 'tracks': return trackAssemblyMesh(spec);
    default: return EMPTY_MESH;
  }
}

/* ==========================================================================
 * 20. THE CONSUMER SURFACES
 * ========================================================================== */

/**
 * The 15-line adapter `UnitFactory` needs.
 *
 * A sink is whatever already knows how to push a quad or a triangle with an
 * atlas rect. Quads arrive in (0,0) (1,0) (1,1) (0,1) order, which is exactly
 * `MeshBuilder.addQuad`'s UV corner order, so the rect can be handed straight
 * through. Polygons with more than four sides are fanned here so the sink never
 * sees one.
 */
export interface ShapeSink {
  quad(
    p0: V3, p1: V3, p2: V3, p3: V3, n: V3,
    kind: FaceKind, face: BoxFace | undefined, group: string | undefined, area: number,
  ): void;
  tri(
    p0: V3, p1: V3, p2: V3, n: V3, uv0: UV, uv1: UV, uv2: UV,
    kind: FaceKind, face: BoxFace | undefined, group: string | undefined, area: number,
  ): void;
}

export function emitShape(mesh: ShapeMesh, sink: ShapeSink): void {
  for (const p of mesh.polys) {
    if (p.v.length === 4) {
      sink.quad(p.v[0], p.v[1], p.v[2], p.v[3], p.n, p.kind, p.face, p.group, p.area);
    } else if (p.v.length === 3) {
      sink.tri(p.v[0], p.v[1], p.v[2], p.n, p.uv[0], p.uv[1], p.uv[2], p.kind, p.face, p.group, p.area);
    } else {
      // Fan an n-gon. Sub-areas are apportioned by triangle area so per-slot
      // surface measurement stays exact.
      for (let i = 1; i + 1 < p.v.length; i++) {
        const a = polyArea([p.v[0], p.v[i], p.v[i + 1]]);
        sink.tri(p.v[0], p.v[i], p.v[i + 1], p.n, p.uv[0], p.uv[i], p.uv[i + 1], p.kind, p.face, p.group, a);
      }
    }
  }
}

/** Total surface area of a mesh, in square metres. */
export function surfaceArea(mesh: ShapeMesh): number {
  let a = 0;
  for (const p of mesh.polys) a += p.area;
  return a;
}

/**
 * The fraction of a mesh's surface that lies on an AXIS-ALIGNED plane, within
 * 6 degrees. A raw `BoxGeometry` scores exactly 1.0; a properly chamfered,
 * tapered hull scores around 0.45. This is the measurement `MassList`'s
 * boxiness gate is built on, and it is why the gate cannot be gamed by
 * smooth-shading a box.
 */
export function axisAlignedFraction(mesh: ShapeMesh): number {
  const COS6 = Math.cos(6 * Math.PI / 180);
  let total = 0, axis = 0;
  for (const p of mesh.polys) {
    total += p.area;
    const m = Math.max(Math.abs(p.n[0]), Math.abs(p.n[1]), Math.abs(p.n[2]));
    if (m >= COS6) axis += p.area;
  }
  return total > 0 ? axis / total : 1;
}

/* ==========================================================================
 * 21. THREE INTEROP
 * ========================================================================== */

export interface GeometryOptions {
  /** Name for the BufferGeometry, so it shows up in the inspector. */
  name?: string;
  /** Remap every UV into this sub-rectangle of a texture. */
  uvRect?: { u0: number; v0: number; u1: number; v1: number };
}

/**
 * Flat-shaded `BufferGeometry` with position / normal / uv. Vertices are not
 * welded, deliberately: an RA3 chamfer reads because each facet has its own
 * normal, and welding them would smooth the whole point away.
 */
export function toGeometry(mesh: ShapeMesh, o: GeometryOptions = {}): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rect = o.uvRect;
  const mapU = (u: number): number => (rect === undefined ? u : rect.u0 + (rect.u1 - rect.u0) * u);
  const mapV = (v: number): number => (rect === undefined ? v : rect.v0 + (rect.v1 - rect.v0) * v);

  for (const p of mesh.polys) {
    const base = pos.length / 3;
    for (let i = 0; i < p.v.length; i++) {
      pos.push(p.v[i][0], p.v[i][1], p.v[i][2]);
      nrm.push(p.n[0], p.n[1], p.n[2]);
      uv.push(mapU(p.uv[i][0]), mapV(p.uv[i][1]));
    }
    for (let i = 1; i + 1 < p.v.length; i++) idx.push(base, base + i, base + i + 1);
  }

  const g = new THREE.BufferGeometry();
  g.name = o.name ?? 'shape';
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(pos.length / 3 > 65535
    ? new THREE.Uint32BufferAttribute(idx, 1)
    : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/* -- the BufferGeometry-returning façade the brief asks for ---------------- */

export function chamferBox(p: ChamferBoxParams): THREE.BufferGeometry {
  return toGeometry(chamferBoxMesh(p), { name: 'chamferBox' });
}
export function taperedBox(p: TaperedBoxParams): THREE.BufferGeometry {
  return toGeometry(taperedBoxMesh(p), { name: 'taperedBox' });
}
export function prismFromPlan(p: PrismParams): THREE.BufferGeometry {
  return toGeometry(prismFromPlanMesh(p), { name: 'prism' });
}
export function lathe(p: LatheParams): THREE.BufferGeometry {
  return toGeometry(latheMesh(p), { name: 'lathe' });
}
export function facetedCylinder(p: CylinderParams): THREE.BufferGeometry {
  return toGeometry(facetedCylinderMesh(p), { name: 'facetedCylinder' });
}
export function facetedCone(p: ConeParams): THREE.BufferGeometry {
  return toGeometry(facetedConeMesh(p), { name: 'facetedCone' });
}
export function extrudeProfile(p: ExtrudeParams): THREE.BufferGeometry {
  return toGeometry(extrudeProfileMesh(p), { name: 'extrudeProfile' });
}
export function plate(p: PlateParams): THREE.BufferGeometry {
  return toGeometry(plateMesh(p), { name: 'plate' });
}
export function hullOf(points: readonly V3[], o: HullParams = {}): THREE.BufferGeometry {
  return toGeometry(hullOfMesh(points, o), { name: 'hull' });
}
export function greebleStrip(p: GreebleStripParams): THREE.BufferGeometry {
  return toGeometry(greebleStripMesh(p), { name: 'greebleStrip' });
}
export function trackAssembly(p: TrackAssemblyParams): THREE.BufferGeometry {
  return toGeometry(trackAssemblyMesh(p), { name: 'trackAssembly' });
}
export function shapeGeometry(spec: ShapeSpec): THREE.BufferGeometry {
  return toGeometry(shapeMesh(spec), { name: spec.kind });
}

/**
 * ============================================================================
 * VOLTMARCH — src/art/Wrecks.ts
 * ============================================================================
 * DESTROYED-VEHICLE HULKS AND BUILDING RUBBLE.
 *
 * THE HOLE THIS FILLS
 * -------------------
 * `src/sim/Damage.ts#spawnWreck` allocates a `EntityKind.Wreck` entity with
 * `defId = -1` for EVERY vehicle that dies, and `entity-props.system.ts`
 * answered all of them with ONE hand-built 6.1 x 5.9 m tank hulk. A dead
 * Chrono Miner, a dead Construction Dozer and a dead 16.8 m Dreadnought all
 * left the same medium-tank carcass on the field, in the same near-black, for
 * both armies. The missing-model audit ranked it last by visibility only because
 * you have to kill something first.
 *
 * `Damage.ts#buildingDeath` has the matching hole from the other side: a dead
 * structure leaves a `DecalKind.Rubble` stamp on the ground and nothing else, so
 * a destroyed War Factory is a stain rather than a ruin.
 *
 * WHAT THIS MODULE IS
 * -------------------
 * Pure geometry. It owns no material, no registration and no lifetime: it hands
 * back `THREE.BufferGeometry` in the `PropMesh` vertex layout (position, normal,
 * colour, aSway, aEmit, aGloss), which is exactly what
 * `entity-props.system.ts`'s existing `EntityPropMaterial` already draws. See
 * §5 for the four calls that drive it.
 *
 * TWO RULES IT KEEPS
 * ------------------
 * 1. NOTHING IS AXIS-ALIGNED. A wreck is the one object in the game that has
 *    earned the right to be a pile, and a pile of world-aligned boxes is the
 *    exact "old-school 3D" read the roster was just rebuilt to escape. Every
 *    mass here goes through `slab()` or `drum()`, which take a full Euler
 *    orientation, and every one of them is tipped, rolled and yawed off axis.
 *
 * 2. IT IS DETERMINISTIC. Every scatter angle comes from a seeded `Rng` keyed on
 *    the wreck class and faction, so two runs produce byte-identical geometry
 *    and the screenshot harness can diff them. Nothing here ever runs inside
 *    `simTick`, but a wreck that reshuffled itself between boots would make the
 *    visual critic loop useless.
 *
 * COLOUR. Charred near-black with a rust cast, plus ONE surviving scrap of the
 * owner's team colour so a player can still read whose tank died. The bible's
 * "zero grime" rule is about live hardware; this is the one class of object that
 * is allowed to be burnt, and it is burnt with three flat authored values rather
 * than with noise.
 * ============================================================================
 */

import * as THREE from 'three';

import { RA3_UNIT_PALETTE } from '../core/config';
import { Rng } from '../core/math';
import { PropMesh, type PropPalette } from '../world/PropLibrary';

/* ==========================================================================
 * 1. VOCABULARY
 * ========================================================================== */

/** Which army's paint survives on the hulk. */
export type WreckFaction = 'allies' | 'soviets' | 'neutral';

/**
 * Hulk size classes. A wreck does not need to be the unit that died — it needs
 * to be the RIGHT SIZE, because a hulk that is half the footprint of the tank
 * that left it reads as a bug and one that is twice the footprint blocks a lane
 * the pathfinder thinks is clear.
 */
export type WreckClass = 'light' | 'medium' | 'heavy' | 'support' | 'naval';

/** Ruin size classes, by structure footprint. */
export type RubbleSize = 'small' | 'medium' | 'large';

/** Long-axis metres each hulk class is built to. */
export const WRECK_LENGTH: Readonly<Record<WreckClass, number>> = {
  light: 4.6,
  medium: 6.4,
  heavy: 8.2,
  support: 8.8,
  naval: 13.0,
};

/**
 * Pick a hulk class from the dead unit's hull length in metres.
 *
 * `Damage.ts` preserves `st.radius[i]` onto the wreck entity, so a caller that
 * wants the size to track the corpse can pass `radius * 2`.
 */
export function wreckClassFor(hullLengthMeters: number): WreckClass {
  if (hullLengthMeters >= 11.0) return 'naval';
  if (hullLengthMeters >= 8.2) return 'support';
  if (hullLengthMeters >= 7.0) return 'heavy';
  if (hullLengthMeters >= 5.6) return 'medium';
  return 'light';
}

/** Pick a ruin size from a structure footprint in cells (w * h). */
export function rubbleSizeFor(footprintCells: number): RubbleSize {
  if (footprintCells >= 6) return 'large';
  if (footprintCells >= 4) return 'medium';
  return 'small';
}

/** The key a built geometry is filed under in a `WreckSet`. */
export function wreckKey(faction: WreckFaction, cls: WreckClass): string {
  return `${faction}:${cls}`;
}

/** The key a built ruin is filed under in a `WreckSet`. */
export function rubbleKey(faction: WreckFaction, size: RubbleSize): string {
  return `${faction}:${size}`;
}

/* ==========================================================================
 * 2. ORIENTED PRIMITIVES
 *
 * `PropMesh.box` yaws and `PropMesh.cyl` stands on +Y. Neither can tip, and a
 * wreck is nothing BUT tipped mass — a hull that dropped nose-down, a turret
 * thrown thirty degrees off its ring, a track run that peeled off and fell over.
 * These two helpers take a full Euler XYZ and emit through `PropMesh.quad` /
 * `.tri`, which already handle winding from an outward reference direction.
 * ========================================================================== */

type V3 = readonly [number, number, number];
type Mat3 = readonly number[];

/** Euler XYZ (three's default order, R = Rz*Ry*Rx) as a row-major 3x3. */
function euler(rx: number, ry: number, rz: number): Mat3 {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cy * cz, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

function xf(m: Mat3, c: V3, x: number, y: number, z: number): [number, number, number] {
  return [
    c[0] + m[0] * x + m[1] * y + m[2] * z,
    c[1] + m[3] * x + m[4] * y + m[5] * z,
    c[2] + m[6] * x + m[7] * y + m[8] * z,
  ];
}

function dir(m: Mat3, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

/**
 * A chamfered slab at an arbitrary orientation: six inset faces, twelve bevel
 * strips in the highlight colour, eight corner triangles. The same construction
 * `PropMesh.box` uses, lifted onto a full rotation.
 */
function slab(mesh: PropMesh, c: V3, size: V3, rot: V3, chamfer: number): void {
  const hx = size[0] * 0.5, hy = size[1] * 0.5, hz = size[2] * 0.5;
  const k = Math.max(0, Math.min(chamfer, Math.min(hx, hy, hz) * 0.9));
  const ix = hx - k, iy = hy - k, iz = hz - k;
  const m = euler(rot[0], rot[1], rot[2]);

  const q = (
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    ox: number, oy: number, oz: number, bevel: boolean,
  ): void => {
    const A = xf(m, c, ax, ay, az), B = xf(m, c, bx, by, bz);
    const C = xf(m, c, cx, cy, cz), D = xf(m, c, dx, dy, dz);
    const N = dir(m, ox, oy, oz);
    mesh.quad(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], D[0], D[1], D[2], N[0], N[1], N[2], bevel);
  };

  for (let s = -1; s <= 1; s += 2) {
    q(s * hx, -iy, -iz, s * hx, iy, -iz, s * hx, iy, iz, s * hx, -iy, iz, s, 0, 0, false);
    q(-ix, s * hy, -iz, ix, s * hy, -iz, ix, s * hy, iz, -ix, s * hy, iz, 0, s, 0, false);
    q(-ix, -iy, s * hz, ix, -iy, s * hz, ix, iy, s * hz, -ix, iy, s * hz, 0, 0, s, false);
  }
  if (k <= 1e-5) return;

  for (let sy = -1; sy <= 1; sy += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      q(-ix, sy * hy, sz * iz, ix, sy * hy, sz * iz, ix, sy * iy, sz * hz, -ix, sy * iy, sz * hz, 0, sy, sz, true);
    }
  }
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      q(sx * hx, -iy, sz * iz, sx * hx, iy, sz * iz, sx * ix, iy, sz * hz, sx * ix, -iy, sz * hz, sx, 0, sz, true);
    }
    for (let sy = -1; sy <= 1; sy += 2) {
      q(sx * hx, sy * iy, -iz, sx * hx, sy * iy, iz, sx * ix, sy * hy, iz, sx * ix, sy * hy, -iz, sx, sy, 0, true);
    }
  }
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        const A = xf(m, c, sx * hx, sy * iy, sz * iz);
        const B = xf(m, c, sx * ix, sy * hy, sz * iz);
        const C = xf(m, c, sx * ix, sy * iy, sz * hz);
        const N = dir(m, sx, sy, sz);
        mesh.tri(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], N[0], N[1], N[2], true);
      }
    }
  }
}

/**
 * A faceted drum at an arbitrary orientation, with chamfered rims. Its axis runs
 * along the LOCAL +Y and it is centred on `c`, so a turret lying on its side is
 * one call with `rot.z = HALF_PI`.
 */
function drum(
  mesh: PropMesh, c: V3, rBottom: number, rTop: number, h: number,
  segs: number, chamfer: number, rot: V3, capBottom = true, capTop = true,
): void {
  const n = Math.max(3, Math.round(segs));
  const k = Math.max(0, Math.min(chamfer, Math.min(h * 0.4, Math.min(rBottom, rTop) * 0.7)));
  const m = euler(rot[0], rot[1], rot[2]);
  const y0 = -h * 0.5;

  const ry: number[] = [];
  const rr: number[] = [];
  const rb: boolean[] = [];
  if (k > 1e-5) {
    ry.push(y0, y0 + k, y0 + h - k, y0 + h);
    rr.push(Math.max(rBottom - k, 1e-3), rBottom, rTop, Math.max(rTop - k, 1e-3));
    rb.push(true, false, false, true);
  } else {
    ry.push(y0, y0 + h);
    rr.push(rBottom, rTop);
    rb.push(false, false);
  }

  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const mx = (c0 + c1) * 0.5, mz = (s0 + s1) * 0.5;
    for (let r = 0; r + 1 < ry.length; r++) {
      const bevel = rb[r] || rb[r + 1];
      const oy = (rr[r] - rr[r + 1]) / Math.max(Math.abs(ry[r + 1] - ry[r]), 1e-4);
      const A = xf(m, c, c0 * rr[r], ry[r], s0 * rr[r]);
      const B = xf(m, c, c1 * rr[r], ry[r], s1 * rr[r]);
      const C = xf(m, c, c1 * rr[r + 1], ry[r + 1], s1 * rr[r + 1]);
      const D = xf(m, c, c0 * rr[r + 1], ry[r + 1], s0 * rr[r + 1]);
      const N = dir(m, mx, oy * 0.5, mz);
      mesh.quad(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], D[0], D[1], D[2], N[0], N[1], N[2], bevel);
    }
  }

  const cap = (yy: number, rr2: number, sgn: number): void => {
    for (let i = 1; i + 1 < n; i++) {
      const a0 = 0, a1 = (i / n) * Math.PI * 2, a2 = ((i + 1) / n) * Math.PI * 2;
      const A = xf(m, c, Math.cos(a0) * rr2, yy, Math.sin(a0) * rr2);
      const B = xf(m, c, Math.cos(a1) * rr2, yy, Math.sin(a1) * rr2);
      const C = xf(m, c, Math.cos(a2) * rr2, yy, Math.sin(a2) * rr2);
      const N = dir(m, 0, sgn, 0);
      mesh.tri(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], N[0], N[1], N[2], false);
    }
  };
  if (capBottom) cap(ry[0], rr[0], -1);
  if (capTop) cap(ry[ry.length - 1], rr[rr.length - 1], 1);
}

/**
 * Aim a `drum`'s axis (its local +Y) along a HORIZONTAL heading, dipping the far
 * end by `dip` radians. Returns the Euler and the unit axis so a caller can
 * place something on the drum's end cap.
 *
 * Worth spelling out, because getting it wrong is invisible in code and obvious
 * on screen: the mass rotation order is `R = Rz*Ry*Rx`, so `Ry` cannot turn the
 * local +Y axis at all — it IS Ry's axis. Laying a turret over therefore has to
 * start with `rx = -PI/2`, which drops +Y onto -Z, and only THEN can `ry` swing
 * it round the compass. Reaching for `rz = PI/2` instead lays it onto -X and
 * pins it there, and adding `ry` to that just spins the drum about its own axis.
 */
function aimHorizontal(heading: number, dip: number): { rot: V3; axis: V3 } {
  const rot: V3 = [-HALF_PI + dip, -(heading + HALF_PI), 0];
  const cd = Math.cos(dip), sd = Math.sin(dip);
  return { rot, axis: [Math.cos(heading) * cd, sd, Math.sin(heading) * cd] };
}

/**
 * A torn plate: a four-cornered sheet with one corner pulled out of plane, so
 * the tear reads as a tear and not as a rectangle lying on the dirt.
 */
function tornPlate(
  mesh: PropMesh, c: V3, w: number, d: number, rot: V3, curl: number,
): void {
  const m = euler(rot[0], rot[1], rot[2]);
  const hw = w * 0.5, hd = d * 0.5;
  const corners: V3[] = [
    [hw, 0, -hd], [hw * 0.82, curl, hd], [-hw, curl * 0.35, hd * 0.86], [-hw * 0.92, 0, -hd],
  ];
  const p = corners.map((v) => xf(m, c, v[0], v[1], v[2]));
  const N = dir(m, 0, 1, 0);
  mesh.quad(
    p[0][0], p[0][1], p[0][2], p[1][0], p[1][1], p[1][2],
    p[2][0], p[2][1], p[2][2], p[3][0], p[3][1], p[3][2],
    N[0], N[1], N[2], false,
  );
  const B = dir(m, 0, -1, 0);
  mesh.quad(
    p[3][0], p[3][1], p[3][2], p[2][0], p[2][1], p[2][2],
    p[1][0], p[1][1], p[1][2], p[0][0], p[0][1], p[0][2],
    B[0], B[1], B[2], true,
  );
}

/* ==========================================================================
 * 3. THE BURNT PALETTE
 * ========================================================================== */

interface Burnt {
  /** The hull's surviving paint, cooked most of the way to black. */
  char: string;
  /** Deeper char for recesses, track runs and the underside. */
  deep: string;
  /** Torn metal shows its own colour: this is the edge highlight. */
  tear: string;
  /** Oxidised steel on everything that stayed hot. */
  rust: string;
  /** The one surviving scrap of the owner's colours. */
  team: string;
  /** Concrete, for building rubble. */
  concrete: string;
  /** Ember colour on the emissive faces. */
  ember: string;
}

/**
 * Faction char. The Allies burn pale — their hulls are cool grey-white, so a
 * dead one goes ash rather than soot — and the Soviets burn dark and rusty. Six
 * flat authored values per army, no noise, no gradient.
 */
function burntPalette(p: PropPalette, faction: WreckFaction): Burnt {
  const unit = RA3_UNIT_PALETTE[faction === 'neutral' ? 'neutral' : faction];
  const soviet = faction === 'soviets';
  return {
    char: soviet ? '#241C18' : '#2B2A29',
    deep: soviet ? '#141010' : '#181818',
    tear: soviet ? '#5A4438' : '#4E4E50',
    rust: p.rust,
    team: unit.team,
    concrete: p.concrete,
    ember: soviet ? '#FF6A22' : '#FF7A34',
  };
}

/* ==========================================================================
 * 4. THE HULKS
 * ========================================================================== */

const HALF_PI = Math.PI * 0.5;

/** Per-class proportions, all as fractions of `WRECK_LENGTH[cls]`. */
interface HulkSpec {
  /** Hull beam and depth. */
  beam: number;
  depth: number;
  /** Turret drum RADIUS as a fraction of length, or 0 for a turretless hulk. */
  turret: number;
  /** Track runs per side, and their height. */
  trackHeight: number;
  /** How far off its ring the turret was thrown, in metres. */
  throwDistance: number;
  /** Extra torn plates scattered clear. */
  debris: number;
  /** Barrel length, or 0 for none. */
  barrel: number;
}

const HULK: Readonly<Record<WreckClass, HulkSpec>> = {
  light:   { beam: 0.60, depth: 0.24, turret: 0.135, trackHeight: 0.17, throwDistance: 1.1, debris: 2, barrel: 0.36 },
  medium:  { beam: 0.56, depth: 0.23, turret: 0.145, trackHeight: 0.17, throwDistance: 1.5, debris: 3, barrel: 0.42 },
  heavy:   { beam: 0.54, depth: 0.25, turret: 0.155, trackHeight: 0.19, throwDistance: 1.8, debris: 4, barrel: 0.46 },
  support: { beam: 0.52, depth: 0.30, turret: 0.000, trackHeight: 0.17, throwDistance: 0.0, debris: 4, barrel: 0.00 },
  naval:   { beam: 0.34, depth: 0.26, turret: 0.100, trackHeight: 0.00, throwDistance: 1.3, debris: 5, barrel: 0.24 },
};

/** Stable per-(faction, class) seed. Same wreck every boot, on every machine. */
function hulkSeed(faction: WreckFaction, cls: WreckClass): number {
  const f = faction === 'allies' ? 0x41 : faction === 'soviets' ? 0x53 : 0x4e;
  const c = ['light', 'medium', 'heavy', 'support', 'naval'].indexOf(cls) + 1;
  return (0x57_52_00_00 ^ (f << 8) ^ (c * 0x9e37)) >>> 0;
}

/**
 * A burnt-out vehicle hulk.
 *
 * Six primary masses, and the whole design brief is "a critic must read 'a tank
 * died here' from 40 m in about four shapes":
 *
 *   1. the hull tub, dropped nose-down and rolled off level;
 *   2. one track run still on, one peeled off and lying beside it;
 *   3. the turret THROWN CLEAR and resting on its side — this is the single
 *      strongest cue and the reason a hulk never reads as a parked tank;
 *   4. the empty turret ring left in the deck, which is what makes (3) legible;
 *   5. the gun barrel, bent down into the dirt;
 *   6. torn plates and a wheel or two scattered on the ground.
 *
 * The fire and the smoke come from `EntityFlag.Burning`, which the VFX module
 * already watches for; the only light this geometry emits is a handful of ember
 * faces down inside the engine bay.
 */
export function buildVehicleWreck(
  p: PropPalette, faction: WreckFaction, cls: WreckClass,
): THREE.BufferGeometry {
  const b = burntPalette(p, faction);
  const spec = HULK[cls];
  const L = WRECK_LENGTH[cls];
  const W = L * spec.beam;
  const D = L * spec.depth;
  const rng = new Rng(hulkSeed(faction, cls));
  const m = new PropMesh();

  // Vertical AO: everything darkens toward the ground, which is what stops a
  // hulk floating the way an un-footed prop does.
  m.ao(0.52, 0, D * 2.6).gloss(0.12);

  /* -- 1. the hull tub --------------------------------------------------- */
  const tipX = -0.07 + rng.range(-0.025, 0.025);   // nose-down
  const roll = rng.range(-0.07, 0.07);
  const yaw = rng.range(-0.14, 0.14);
  const hullY = D * 0.62;
  m.color(b.char).bevel(b.tear);
  slab(m, [0, hullY, 0], [W, D, L * 0.86], [tipX, yaw, roll], D * 0.16);
  // A sheared-off glacis lying back over the bow, half torn away.
  m.color(b.deep).bevel(b.tear);
  slab(m, [0, hullY + D * 0.34, L * 0.30], [W * 0.80, D * 0.16, L * 0.24], [tipX - 0.52, yaw, roll * 0.6], D * 0.10);

  /* -- 2. running gear --------------------------------------------------- */
  if (spec.trackHeight > 0) {
    const th = L * spec.trackHeight;
    const tw = W * 0.26;
    const tx = W * 0.5 + tw * 0.16;
    // Port run: still on, sagging.
    m.color(b.deep).bevel(b.rust);
    slab(m, [tx, th * 0.48, -L * 0.02], [tw, th, L * 0.78], [tipX * 0.6, yaw, roll - 0.05], th * 0.24);
    // Starboard run: peeled off the sprocket and dropped on its side.
    slab(m, [-tx - tw * 0.9, th * 0.34, L * 0.06], [tw, th * 0.78, L * 0.62],
      [0.22, yaw + rng.range(-0.30, 0.30), HALF_PI * 0.82], th * 0.22);
    // Two road wheels off the run, lying flat.
    m.color(b.rust).bevel(b.tear);
    for (let i = 0; i < 2; i++) {
      const a = rng.range(0, Math.PI * 2);
      // Flat on the dirt: the axis stays near-vertical, so the wheel reads as a
      // wheel that fell off rather than one still standing in its station.
      drum(m, [
        Math.cos(a) * L * rng.range(0.26, 0.40),
        th * 0.20,
        Math.sin(a) * L * rng.range(0.26, 0.42),
      ], th * 0.44, th * 0.44, th * 0.34, 10, th * 0.06,
      [rng.range(-0.26, 0.26), rng.range(0, 3.1), rng.range(-0.26, 0.26)]);
    }
  } else {
    // A naval hulk has no tracks: it has a torn keel section instead.
    m.color(b.deep).bevel(b.rust);
    slab(m, [0, D * 0.14, -L * 0.22], [W * 1.12, D * 0.30, L * 0.34], [0.16, yaw, roll * 1.6], D * 0.12);
  }

  /* -- 3+4. the turret, thrown clear; the empty ring, left behind -------- */
  if (spec.turret > 0) {
    const r = L * spec.turret;
    const ringY = hullY + D * 0.46;
    // The ring: a shallow collar with nothing in it.
    m.color(b.deep).bevel(b.tear);
    drum(m, [0, ringY, -L * 0.04], r * 0.92, r * 0.86, D * 0.22, 12, D * 0.05, [tipX, yaw, roll], false, true);
    // The turret itself: on its side, off the hull, at a hard angle.
    const ta = rng.range(2.0, 2.6) * (rng.chance(0.5) ? 1 : -1);
    const tx = Math.cos(ta) * spec.throwDistance;
    const tz = Math.sin(ta) * spec.throwDistance - L * 0.10;
    // LYING ON ITS SIDE, not standing. This is the single strongest cue on the
    // whole hulk: a turret still upright reads as a parked tank.
    const lay = aimHorizontal(rng.range(0, Math.PI * 2), rng.range(-0.14, 0.14));
    const ty = r * 0.94;
    m.color(b.char).bevel(b.tear);
    drum(m, [tx, ty, tz], r, r * 0.80, r * 1.24, 12, r * 0.12, lay.rot);
    // Its hatch ring, still attached to the turret roof.
    m.color(b.rust).bevel(b.tear);
    drum(m, [tx + lay.axis[0] * r * 0.68, ty + lay.axis[1] * r * 0.68, tz + lay.axis[2] * r * 0.68],
      r * 0.34, r * 0.30, r * 0.16, 10, r * 0.04, lay.rot);

    /* -- 5. the barrel, bent into the dirt ------------------------------- */
    if (spec.barrel > 0) {
      const bl = L * spec.barrel;
      const ba = ta + rng.range(-0.5, 0.5);
      // Bent down into the dirt: a 10-degree dip over its own length.
      const aim = aimHorizontal(ba, -0.17);
      const bx = tx + aim.axis[0] * bl * 0.5;
      const by = r * 0.86 + aim.axis[1] * bl * 0.5;
      const bz = tz + aim.axis[2] * bl * 0.5;
      m.color(b.deep).bevel(b.tear);
      drum(m, [bx, by, bz], r * 0.22, r * 0.16, bl, 10, r * 0.04, aim.rot);
      // The muzzle brake, flared, on the end cap.
      m.color(b.rust).bevel(b.tear);
      drum(m, [bx + aim.axis[0] * bl * 0.54, by + aim.axis[1] * bl * 0.54, bz + aim.axis[2] * bl * 0.54],
        r * 0.26, r * 0.24, r * 0.26, 10, r * 0.05, aim.rot);
    }
  }

  /* -- 6. debris --------------------------------------------------------- */
  m.color(b.rust).bevel('#8A6440');
  for (let i = 0; i < spec.debris; i++) {
    const a = (i / spec.debris) * Math.PI * 2 + rng.range(-0.6, 0.6);
    const dist = L * rng.range(0.34, 0.52);
    tornPlate(m, [Math.cos(a) * dist, 0.07 + rng.range(0, 0.05), Math.sin(a) * dist],
      L * rng.range(0.13, 0.21), L * rng.range(0.09, 0.15),
      [rng.range(-0.18, 0.18), a + rng.range(-0.8, 0.8), rng.range(-0.16, 0.16)],
      L * rng.range(0.02, 0.05));
  }

  /* -- the one surviving scrap of team colour ---------------------------- */
  m.color(b.team).bevel(b.tear).gloss(0.25);
  slab(m, [W * 0.30, hullY + D * 0.10, -L * 0.24], [W * 0.30, D * 0.34, 0.07],
    [tipX, yaw + 0.10, roll], 0.03);

  /* -- embers, down inside the bay --------------------------------------- */
  m.color(b.ember).bevel(b.ember).emissive(0.62).gloss(0);
  slab(m, [0, hullY + D * 0.18, -L * 0.14], [W * 0.40, 0.07, L * 0.20], [tipX, yaw, roll], 0.02);
  slab(m, [-W * 0.16, hullY + D * 0.06, L * 0.20], [W * 0.20, 0.06, L * 0.10], [tipX, yaw + 0.4, roll], 0.02);
  m.emissive(0);

  return m.toGeometry(`wreck.${faction}.${cls}`);
}

/* ==========================================================================
 * 5. THE RUBBLE
 * ========================================================================== */

interface RubbleSpec {
  /** Footprint the ruin fills, in metres. */
  span: number;
  /** Standing wall stubs. */
  stubs: number;
  /** Fallen slabs. */
  slabs: number;
  /** Exposed rebar bundles. */
  rebar: number;
}

const RUBBLE: Readonly<Record<RubbleSize, RubbleSpec>> = {
  small:  { span: 3.4, stubs: 2, slabs: 5, rebar: 3 },
  medium: { span: 7.0, stubs: 3, slabs: 8, rebar: 5 },
  large:  { span: 10.6, stubs: 4, slabs: 12, rebar: 7 },
};

function rubbleSeed(faction: WreckFaction, size: RubbleSize): number {
  const f = faction === 'allies' ? 0x41 : faction === 'soviets' ? 0x53 : 0x4e;
  const c = ['small', 'medium', 'large'].indexOf(size) + 1;
  return (0x52_55_00_00 ^ (f << 8) ^ (c * 0x85eb)) >>> 0;
}

/**
 * The ruin a destroyed structure leaves.
 *
 * `Damage.ts#buildingDeath` currently stamps a `DecalKind.Rubble` decal and
 * releases the nav grid, so the site goes flat. A ruin needs THREE reads and
 * nothing else: broken wall stubs still standing at the corners, a heap of
 * collapsed floor slabs leaning against each other in the middle, and rebar
 * sticking out of the breaks. The heap is deliberately low — this is scenery a
 * unit walks past, and the cells underneath have already been released.
 *
 * Faction reads through the wall stub proportions, not through colour: an Allied
 * ruin breaks into thin panel sheets, a Soviet one into thick concrete blocks.
 */
export function buildBuildingRubble(
  p: PropPalette, faction: WreckFaction, size: RubbleSize,
): THREE.BufferGeometry {
  const b = burntPalette(p, faction);
  const spec = RUBBLE[size];
  const S = spec.span;
  const soviet = faction === 'soviets';
  const rng = new Rng(rubbleSeed(faction, size));
  const m = new PropMesh();
  m.ao(0.50, 0, S * 0.5).gloss(0.05);

  /* -- standing wall stubs ------------------------------------------------ */
  m.color(b.concrete).bevel(b.tear);
  for (let i = 0; i < spec.stubs; i++) {
    const a = (i / spec.stubs) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const dist = S * rng.range(0.30, 0.42);
    // A stub, not a wall: the ruin has to stay low enough that a unit walking
    // past it still reads as being in front of the site, not behind a building.
    const h = S * rng.range(0.15, 0.25);
    const t = soviet ? S * 0.10 : S * 0.055;
    slab(m, [Math.cos(a) * dist, h * 0.5, Math.sin(a) * dist],
      [S * rng.range(0.22, 0.36), h, t],
      [rng.range(-0.10, 0.10), a + rng.range(-0.4, 0.4), rng.range(-0.14, 0.14)],
      t * 0.30);
  }

  /* -- the collapsed heap ------------------------------------------------- */
  for (let i = 0; i < spec.slabs; i++) {
    const a = rng.range(0, Math.PI * 2);
    const dist = S * rng.range(0.02, 0.30);
    const w = S * rng.range(0.20, 0.38);
    const d = S * rng.range(0.14, 0.28);
    const t = soviet ? S * rng.range(0.05, 0.09) : S * rng.range(0.03, 0.055);
    // Leaning, never lying flat: a heap of level slabs reads as a car park.
    const lean = rng.range(0.22, 0.85) * (rng.chance(0.5) ? 1 : -1);
    m.color(i % 3 === 0 ? b.char : b.concrete).bevel(b.tear);
    slab(m, [Math.cos(a) * dist, t * 0.5 + Math.abs(Math.sin(lean)) * d * 0.42, Math.sin(a) * dist],
      [w, t, d], [lean, a, rng.range(-0.30, 0.30)], t * 0.34);
  }

  /* -- rebar -------------------------------------------------------------- */
  m.color(b.rust).bevel('#8A6440');
  for (let i = 0; i < spec.rebar; i++) {
    const a = rng.range(0, Math.PI * 2);
    const dist = S * rng.range(0.05, 0.34);
    const len = S * rng.range(0.14, 0.26);
    // Bent up out of the break at a shallow angle, not standing vertically.
    const aim = aimHorizontal(rng.range(0, Math.PI * 2), rng.range(0.5, 1.1));
    drum(m, [Math.cos(a) * dist, len * 0.30, Math.sin(a) * dist],
      S * 0.012, S * 0.010, len, 6, 0, aim.rot);
  }

  /* -- torn cladding sheets ----------------------------------------------- */
  m.color(b.deep).bevel(b.tear);
  for (let i = 0; i < spec.stubs + 1; i++) {
    const a = (i / (spec.stubs + 1)) * Math.PI * 2 + rng.range(-0.5, 0.5);
    const dist = S * rng.range(0.34, 0.50);
    tornPlate(m, [Math.cos(a) * dist, 0.08, Math.sin(a) * dist],
      S * rng.range(0.16, 0.26), S * rng.range(0.12, 0.20),
      [rng.range(-0.20, 0.20), a, rng.range(-0.18, 0.18)], S * 0.05);
  }

  /* -- one surviving scrap of the owner's colours -------------------------- */
  m.color(b.team).bevel(b.tear).gloss(0.20);
  slab(m, [S * 0.16, S * 0.10, -S * 0.20], [S * 0.20, S * 0.11, 0.10],
    [0.28, 0.7, -0.34], 0.03);

  /* -- embers ------------------------------------------------------------- */
  m.color(b.ember).bevel(b.ember).emissive(0.55).gloss(0);
  for (let i = 0; i < 2; i++) {
    const a = rng.range(0, Math.PI * 2);
    slab(m, [Math.cos(a) * S * 0.14, 0.06, Math.sin(a) * S * 0.14],
      [S * 0.12, 0.05, S * 0.09], [0, a, 0], 0.02);
  }
  m.emissive(0);

  return m.toGeometry(`rubble.${faction}.${size}`);
}

/* ==========================================================================
 * 6. THE SET
 * ========================================================================== */

export interface WreckSet {
  /** `${faction}:${class}` -> hulk geometry. See `wreckKey`. */
  readonly vehicles: ReadonlyMap<string, THREE.BufferGeometry>;
  /** `${faction}:${size}` -> ruin geometry. See `rubbleKey`. */
  readonly rubble: ReadonlyMap<string, THREE.BufferGeometry>;
  readonly triangles: number;
  /** Look a hulk up, falling back to the neutral hulk of the same class. */
  hulk(faction: WreckFaction, cls: WreckClass): THREE.BufferGeometry;
  /** Look a ruin up, falling back to the neutral ruin of the same size. */
  ruin(faction: WreckFaction, size: RubbleSize): THREE.BufferGeometry;
  dispose(): void;
}

const FACTIONS: readonly WreckFaction[] = ['allies', 'soviets', 'neutral'];
const CLASSES: readonly WreckClass[] = ['light', 'medium', 'heavy', 'support', 'naval'];
const SIZES: readonly RubbleSize[] = ['small', 'medium', 'large'];

/**
 * Build every hulk and every ruin: 3 factions x 5 classes + 3 factions x 3
 * sizes = 24 geometries, ~9 k triangles all in, built once at boot.
 *
 * That is 24 potential batches, but only the ones a match actually kills are
 * ever drawn — `InstanceBatcher` allocates on first instance, not on
 * registration — so the steady-state cost of the whole set in a game where
 * nothing has died yet is zero draw calls.
 *
 * Pass `only` to build a subset (the screenshot harness does).
 */
export function buildWreckSet(
  p: PropPalette,
  only?: { factions?: readonly WreckFaction[]; classes?: readonly WreckClass[]; sizes?: readonly RubbleSize[] },
): WreckSet {
  const factions = only?.factions ?? FACTIONS;
  const classes = only?.classes ?? CLASSES;
  const sizes = only?.sizes ?? SIZES;

  const vehicles = new Map<string, THREE.BufferGeometry>();
  const rubble = new Map<string, THREE.BufferGeometry>();
  let triangles = 0;

  const count = (g: THREE.BufferGeometry): void => {
    const idx = g.getIndex();
    triangles += (idx !== null ? idx.count : g.getAttribute('position').count) / 3;
  };

  for (const f of factions) {
    for (const c of classes) {
      const g = buildVehicleWreck(p, f, c);
      vehicles.set(wreckKey(f, c), g);
      count(g);
    }
    for (const s of sizes) {
      const g = buildBuildingRubble(p, f, s);
      rubble.set(rubbleKey(f, s), g);
      count(g);
    }
  }

  return {
    vehicles, rubble, triangles: Math.round(triangles),
    hulk(faction, cls) {
      const g = vehicles.get(wreckKey(faction, cls)) ?? vehicles.get(wreckKey('neutral', cls));
      if (g === undefined) throw new Error(`[wrecks] no hulk for ${faction}:${cls}`);
      return g;
    },
    ruin(faction, size) {
      const g = rubble.get(rubbleKey(faction, size)) ?? rubble.get(rubbleKey('neutral', size));
      if (g === undefined) throw new Error(`[wrecks] no ruin for ${faction}:${size}`);
      return g;
    },
    dispose(): void {
      for (const g of vehicles.values()) g.dispose();
      for (const g of rubble.values()) g.dispose();
      vehicles.clear();
      rubble.clear();
    },
  };
}

/**
 * DROP-IN REPLACEMENT for the local `buildWreck(palette)` in
 * `src/world/entity-props.system.ts`.
 *
 * That function is the one the audit found answering every vehicle death with a
 * single medium-tank carcass. Swapping the import keeps that behaviour byte-for-
 * byte compatible at the call site while upgrading the geometry; the real win is
 * registering the whole set — see the module header and `buildWreckSet`.
 */
export function buildWreck(p: PropPalette): THREE.BufferGeometry {
  return buildVehicleWreck(p, 'neutral', 'medium');
}

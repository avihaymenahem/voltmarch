/**
 * ============================================================================
 * VOLTMARCH — src/art/Greeble.ts
 * ============================================================================
 * THE GREEBLE FACTORY. Risk R1 ("units ship as untextured grey primitives")
 * is rated FATAL and this file is the whole mitigation. It is deliberately the
 * FIRST thing built in the unit module, before a single vertex exists.
 *
 * WHAT IT MAKES
 * -------------
 * One 512x512 ATLAS per faction-class, laid out as a 4x4 grid of 16 named
 * TILES. Every face of every unit UV-maps into exactly one tile. This is the
 * decision that makes the whole roster cost 4 textures per faction instead of
 * 4 per unit: 18 units share 3 atlases, so a 200-unit battle stays inside the
 * 130-draw-call budget and boot-time texture generation stays under a second.
 *
 *   row 3 |  stripe    stencil    grille     rivetPlate
 *   row 2 |  bareMetal tread      vent       hatch
 *   row 1 |  teamSlab  insignia   emissive   glass
 *   row 0 |  paintLarge paintMed  paintSmall paintTiny
 *           col 0      col 1      col 2      col 3
 *
 * ============================================================================
 * THE SURFACE LAW — read this before changing a single pixel
 * ============================================================================
 * RA3 is "clean painted plastic toys". Look at `docs/surface-refs/
 * ra3-units-road.png`: the Prism tank is LARGE UNBROKEN AREAS OF FLAT PAINT —
 * a yellow-olive base and bright saturated green team slabs — with a handful of
 * crisp dark panel lines and a few small clean mechanical details. Glossy
 * highlights on the upper surfaces. Zero grime, zero marbling, zero noise.
 *
 *   >>> IF PER-PIXEL NOISE IS VISIBLE AT GAMEPLAY ZOOM, IT IS WRONG. <<<
 *
 * WHAT THIS FILE USED TO DO, AND WHY IT LOOKED LIKE MOULD
 * -------------------------------------------------------
 * `fillBase` wrote a 3-octave `fbm2` "orange peel" into BOTH albedo (+-4.5%)
 * AND height (+-0.04), and `packNormal` Sobel'd that height at relief 2.6. The
 * albedo half was nearly invisible; the NORMAL half was the disaster. A
 * full-atlas field of 5-20 texel noise bumps, lit by a key light through a
 * clearcoat and reflecting a blue-grey sky, is exactly the blobby light
 * blue-grey marbling the user described as mould growing on the buildings. The
 * insignia inherited it too, which is why the Soviet star read as a red
 * splatter rather than a shape. Three further generators piled on:
 * `paintBareMetal` (4-octave fbm at 9x frequency into albedo AND height),
 * plus additive soft-edged strokes that fattened every crossing line into a
 * blob and a per-line spacing jitter that turned deliberate plating into
 * scribble.
 *
 * WHAT IT DOES NOW
 * ----------------
 *   - `fillBase` writes an EXACTLY FLAT colour. Height is exactly 0.5, so the
 *     normal map over a plate is exactly (0,0,1). Roughness is constant. There
 *     is no noise field anywhere in this file. Not one call to fbm2/simplex2.
 *   - every mark is a real path: `cline`/`crect`/`cdisc`/`cring`/`cpoly` are
 *     signed-distance rasterizers with an EXACT width and exactly one texel of
 *     anti-aliasing, and they MAX-composite instead of accumulating, so two
 *     crossing seams stay two crossing seams instead of becoming a blot.
 *   - panel layouts are deliberate geometry (`PLANS`): a frame, two or three
 *     full-width courses, one or two verticals, one recessed pocket. No walk,
 *     no jitter. Large flat areas between them are the POINT.
 *   - insignia come from `decalPolygons` — the same crisp vector paths the
 *     clean texture set uses — so the Soviet star is a five-point star and the
 *     Allied roundel is concentric circles, both with hard edges.
 *   - rivets are stamped into HEIGHT ONLY. They read as lit relief through the
 *     normal map instead of as a rash of pale dots painted into albedo.
 *   - normals come from `packNormalStructural`, which box-filters 1-texel
 *     spikes away and dead-bands sub-structural gradients to exactly zero.
 *   - two genuinely different material languages, chosen by `spec.plating`:
 *     WELDED (Allied — thin seams, proud banding strips, glossier ceramic, no
 *     rivets) and RIVETED (Soviet — heavier seams, deeper grooves, rivet rows
 *     on every course, matter paint). Not a hue swap.
 *
 * The geometric bevel highlight (scorecard #11) is NOT painted here — it is
 * baked into vertex colour on the chamfer ring by UnitFactory, which is both
 * cheaper and per-edge exact. Each tile therefore reserves a clean BEVEL PATCH
 * (bottom-left 10%) that painters must leave flat, so a chamfer strip samples
 * an unbroken colour.
 *
 * ZERO GRIME. No streaks, no mud, no rust, no scratched edges (scorecard #22).
 * The only darkening is cavity darkening, which is bible 5.5's ruling.
 *
 * DETERMINISM: seeded, pure, no DOM, no Math.random. Two runs produce
 * byte-identical atlases so the screenshot harness stays diffable.
 *
 * CACHING: `GreebleFactory.atlas()` hashes the entire spec. The same texture
 * is never generated twice.
 * ============================================================================
 */

import * as THREE from 'three';
import {
  createSurface, decalPolygons, packAlbedo, packNormalStructural, packOrm,
  type DecalPath, type Surface,
} from '../core/assets';
import { clamp01, hexToRgb, lerp, Rng, TAU } from '../core/math';
import { UNIT_GREEBLE, UNIT_MATERIAL } from '../core/config';

/* ==========================================================================
 * 1. THE ATLAS LAYOUT
 * ========================================================================== */

/** Every surface a unit face can be assigned to. One tile each. */
export type SlotName =
  | 'paintLarge' | 'paintMed' | 'paintSmall' | 'paintTiny'
  | 'teamSlab' | 'insignia' | 'emissive' | 'glass'
  | 'bareMetal' | 'tread' | 'vent' | 'hatch'
  | 'stripe' | 'stencil' | 'grille' | 'rivetPlate';

/** Atlas is ATLAS_COLS x ATLAS_COLS tiles. */
export const ATLAS_COLS = 4;

/** Tile grid position, column-major-read as [col, row] with row 0 at v = 0. */
const TILE_XY: Record<SlotName, readonly [number, number]> = {
  paintLarge: [0, 0], paintMed: [1, 0], paintSmall: [2, 0], paintTiny: [3, 0],
  teamSlab: [0, 1], insignia: [1, 1], emissive: [2, 1], glass: [3, 1],
  bareMetal: [0, 2], tread: [1, 2], vent: [2, 2], hatch: [3, 2],
  stripe: [0, 3], stencil: [1, 3], grille: [2, 3], rivetPlate: [3, 3],
};

/** Every slot name, for iteration. */
export const SLOT_NAMES: readonly SlotName[] = Object.keys(TILE_XY) as SlotName[];

/** The four paint densities in descending face-area order. */
export const PAINT_SLOTS: readonly SlotName[] = ['paintLarge', 'paintMed', 'paintSmall', 'paintTiny'];

/**
 * Pick a paint density by the face's world area, so a 7 m glacis gets its full
 * plating plan and a 0.3 m sensor box gets one seam. This is the rule that
 * keeps every greeble >= 3 px at gameplay zoom (bible 5.3, "nothing sub-pixel").
 */
export function paintSlotForArea(areaSqM: number): SlotName {
  if (areaSqM >= 3.0) return 'paintLarge';
  if (areaSqM >= 0.9) return 'paintMed';
  if (areaSqM >= 0.16) return 'paintSmall';
  return 'paintTiny';
}

/** A UV rectangle inside the atlas: u0, v0, u1, v1. */
export interface UvRect { u0: number; v0: number; u1: number; v1: number; }

/** Pixel rectangle inside the atlas. */
interface Rect { x: number; y: number; w: number; h: number; }

function tileRect(slot: SlotName, size: number): Rect {
  const t = size / ATLAS_COLS;
  const [c, r] = TILE_XY[slot];
  return { x: c * t, y: r * t, w: t, h: t };
}

/**
 * The sampled sub-rectangle of a tile. Inset so mip level 1-3 cannot pull a
 * neighbouring tile's pixels across the seam.
 */
export function slotUv(slot: SlotName, size: number): UvRect {
  const t = size / ATLAS_COLS;
  const inset = t * UNIT_GREEBLE.tileInsetFraction;
  const [c, r] = TILE_XY[slot];
  return {
    u0: (c * t + inset) / size,
    v0: (r * t + inset) / size,
    u1: ((c + 1) * t - inset) / size,
    v1: ((r + 1) * t - inset) / size,
  };
}

/**
 * The guaranteed-flat patch every tile reserves in its bottom-left corner.
 * Chamfer strips sample this, so a bevel highlight is an unbroken band of the
 * part's own colour instead of a smeared panel line.
 */
export function slotBevelUv(slot: SlotName, size: number): UvRect {
  const t = size / ATLAS_COLS;
  const inset = t * UNIT_GREEBLE.tileInsetFraction;
  const patch = t * UNIT_GREEBLE.bevelPatchFraction;
  const [c, r] = TILE_XY[slot];
  const x0 = c * t + inset, y0 = r * t + inset;
  return {
    u0: (x0 + patch * 0.2) / size,
    v0: (y0 + patch * 0.2) / size,
    u1: (x0 + patch * 0.8) / size,
    v1: (y0 + patch * 0.8) / size,
  };
}

/* ==========================================================================
 * 2. CRISP RECT-CLIPPED RASTERIZERS
 *
 * core/assets.ts ships the clean equivalents of these, but every one of them
 * WRAPS at the texture edge (they exist for seamless tiling surfaces). In an
 * atlas a wrapped stroke lands in a neighbouring tile, so this module carries
 * its own CLIPPED versions. Coordinates are TILE-LOCAL; the rect does the
 * offset.
 *
 * Two properties every one of them guarantees, and the old versions did not:
 *
 *   1. EXACT WIDTH, ONE TEXEL OF AA. Coverage comes from a signed distance:
 *      d <= -0.5 is solid, d >= +0.5 is empty, and the ramp between is one
 *      texel wide. A `width: 2` line covers exactly two texels. The old
 *      `rline` used a linear `1 - d/w` falloff over a disc of radius w, which
 *      made a "2 px" line a 5 px smear with no hard edge anywhere.
 *
 *   2. MAX COMPOSITE, NOT ACCUMULATE. Two crossing seams stay two crossing
 *      seams. The old `put` added and clamped, so every junction, every rivet
 *      that touched a groove and every corner of a rounded rect grew a bright
 *      or dark blob. Additive coverage is how drawn geometry turns into mush.
 * ========================================================================== */

/** Max-composite a coverage value at a tile-local texel. Clipped, never wraps. */
function put(cov: Float32Array, size: number, r: Rect, x: number, y: number, c: number): void {
  if (c <= 0 || x < 0 || y < 0 || x >= r.w || y >= r.h) return;
  const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
  if (c > cov[i]) cov[i] = c;
}

/** Coverage from a signed distance in texels. Exactly one texel of ramp. */
function cov1(d: number): number {
  return d <= -0.5 ? 1 : d >= 0.5 ? 0 : 0.5 - d;
}

/** Add signed relief into the height field at a tile-local texel. */
function addHeight(height: Float32Array, size: number, r: Rect, x: number, y: number, v: number): void {
  if (x < 0 || y < 0 || x >= r.w || y >= r.h) return;
  const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
  height[i] = clamp01(height[i] + v);
}

/** Zero one tile's worth of a scratch channel. */
function clearRect(data: Float32Array, size: number, r: Rect): void {
  for (let y = 0; y < r.h; y++) {
    const row = ((r.y + y) | 0) * size + r.x;
    data.fill(0, row, row + r.w);
  }
}

/**
 * Crisp line segment. `width` is in texels and is EXACT. Panel seams, louvre
 * slats, frame courses.
 */
function cline(
  cov: Float32Array, size: number, r: Rect,
  x0: number, y0: number, x1: number, y1: number, width: number,
): void {
  const hw = Math.max(0.5, width) * 0.5;
  const pad = Math.ceil(hw + 1);
  const bx0 = Math.max(0, Math.floor(Math.min(x0, x1)) - pad);
  const bx1 = Math.min(r.w - 1, Math.ceil(Math.max(x0, x1)) + pad);
  const by0 = Math.max(0, Math.floor(Math.min(y0, y1)) - pad);
  const by1 = Math.min(r.h - 1, Math.ceil(Math.max(y0, y1)) + pad);
  const ex = x1 - x0, ey = y1 - y0;
  const el = ex * ex + ey * ey;
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const wx = x - x0, wy = y - y0;
      const t = el < 1e-12 ? 0 : clamp01((wx * ex + wy * ey) / el);
      const d = Math.hypot(wx - ex * t, wy - ey * t) - hw;
      put(cov, size, r, x, y, cov1(d));
    }
  }
}

/** Crisp rectangle outline. Corners meet exactly — max-composite, no blobs. */
function crect(
  cov: Float32Array, size: number, r: Rect,
  x: number, y: number, w: number, h: number, width: number,
): void {
  cline(cov, size, r, x, y, x + w, y, width);
  cline(cov, size, r, x, y + h, x + w, y + h, width);
  cline(cov, size, r, x, y, x, y + h, width);
  cline(cov, size, r, x + w, y, x + w, y + h, width);
}

/** Crisp filled rectangle, one texel of AA on every edge. */
function cfill(
  cov: Float32Array, size: number, r: Rect,
  x: number, y: number, w: number, h: number,
): void {
  const cx = x + w * 0.5, cy = y + h * 0.5;
  const ex = Math.abs(w) * 0.5, ey = Math.abs(h) * 0.5;
  const bx0 = Math.max(0, Math.floor(cx - ex) - 1), bx1 = Math.min(r.w - 1, Math.ceil(cx + ex) + 1);
  const by0 = Math.max(0, Math.floor(cy - ey) - 1), by1 = Math.min(r.h - 1, Math.ceil(cy + ey) + 1);
  for (let py = by0; py <= by1; py++) {
    for (let px = bx0; px <= bx1; px++) {
      const dx = Math.abs(px - cx) - ex, dy = Math.abs(py - cy) - ey;
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
      const d = Math.min(Math.max(dx, dy), 0) + outside;
      put(cov, size, r, px, py, cov1(d));
    }
  }
}

/** Crisp filled disc. */
function cdisc(cov: Float32Array, size: number, r: Rect, cx: number, cy: number, rad: number): void {
  const bx0 = Math.max(0, Math.floor(cx - rad) - 1), bx1 = Math.min(r.w - 1, Math.ceil(cx + rad) + 1);
  const by0 = Math.max(0, Math.floor(cy - rad) - 1), by1 = Math.min(r.h - 1, Math.ceil(cy + rad) + 1);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) put(cov, size, r, x, y, cov1(Math.hypot(x - cx, y - cy) - rad));
  }
}

/** Crisp annulus of exact `width`. Hatch rims, retaining rings, bolt circles. */
function cring(
  cov: Float32Array, size: number, r: Rect,
  cx: number, cy: number, rad: number, width: number,
): void {
  const hw = Math.max(0.5, width) * 0.5;
  const out = rad + hw + 1;
  const bx0 = Math.max(0, Math.floor(cx - out)), bx1 = Math.min(r.w - 1, Math.ceil(cx + out));
  const by0 = Math.max(0, Math.floor(cy - out)), by1 = Math.min(r.h - 1, Math.ceil(cy + out));
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      put(cov, size, r, x, y, cov1(Math.abs(Math.hypot(x - cx, y - cy) - rad) - hw));
    }
  }
}

/** A closed polygon as flat tile-local texel pairs. */
type Poly = readonly number[];

/**
 * Crisp polygon fill or stroke, even-odd so holes are free. This is what makes
 * an insignia a SHAPE: hard edges, one texel of AA, and not one sample of it
 * comes from a noise field.
 */
function cpoly(
  cov: Float32Array, size: number, r: Rect,
  polys: readonly Poly[], mode: 'fill' | 'stroke' = 'fill', width = 2,
): void {
  const edges: number[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) {
    const n = (p.length / 2) | 0;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edges.push(p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]);
      if (p[i * 2] < minX) minX = p[i * 2];
      if (p[i * 2] > maxX) maxX = p[i * 2];
      if (p[i * 2 + 1] < minY) minY = p[i * 2 + 1];
      if (p[i * 2 + 1] > maxY) maxY = p[i * 2 + 1];
    }
  }
  const ne = (edges.length / 4) | 0;
  if (ne === 0) return;

  const hw = Math.max(0.5, width) * 0.5;
  const pad = Math.ceil((mode === 'stroke' ? hw : 0) + 2);
  const bx0 = Math.max(0, Math.floor(minX) - pad), bx1 = Math.min(r.w - 1, Math.ceil(maxX) + pad);
  const by0 = Math.max(0, Math.floor(minY) - pad), by1 = Math.min(r.h - 1, Math.ceil(maxY) + pad);

  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      let best = Infinity;
      let inside = false;
      for (let i = 0; i < ne; i++) {
        const ax = edges[i * 4], ay = edges[i * 4 + 1];
        const bx = edges[i * 4 + 2], by = edges[i * 4 + 3];
        const ex = bx - ax, ey = by - ay;
        const wx = x - ax, wy = y - ay;
        const el = ex * ex + ey * ey;
        const t = el < 1e-12 ? 0 : clamp01((wx * ex + wy * ey) / el);
        const dx = wx - ex * t, dy = wy - ey * t;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) best = d2;
        if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      }
      const d = inside ? -Math.sqrt(best) : Math.sqrt(best);
      put(cov, size, r, x, y, cov1(mode === 'fill' ? d : Math.abs(d) - hw));
    }
  }
}

/**
 * Stamp a rivet dome into the HEIGHT field, and nothing else.
 *
 * The old code painted rivets as +44% value discs in albedo, which at gameplay
 * zoom is a rash of pale dots — painted-on hardware, the single most obvious
 * procedural tell after noise. A dome in height is lit by the key through the
 * normal map: it catches on the sun side and shades on the other, which is what
 * a real rivet does and costs the same.
 */
function stampRivet(
  height: Float32Array, size: number, r: Rect, cx: number, cy: number, rad: number, amp: number,
): void {
  const bx0 = Math.max(0, Math.floor(cx - rad) - 1), bx1 = Math.min(r.w - 1, Math.ceil(cx + rad) + 1);
  const by0 = Math.max(0, Math.floor(cy - rad) - 1), by1 = Math.min(r.h - 1, Math.ceil(cy + rad) + 1);
  const inv = 1 / Math.max(1e-6, rad);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const t = Math.hypot(x - cx, y - cy) * inv;
      if (t >= 1) continue;
      // Spherical cap, not a cone: the shading gradient is what reads.
      addHeight(height, size, r, x, y, amp * Math.sqrt(1 - t * t));
    }
  }
}

/** 3x5 stencil digits. Hull numbers are one of RA3's most legible unit cues. */
const DIGITS: readonly (readonly number[])[] = [
  [0b111, 0b101, 0b101, 0b101, 0b111], // 0
  [0b010, 0b110, 0b010, 0b010, 0b111], // 1
  [0b111, 0b001, 0b111, 0b100, 0b111], // 2
  [0b111, 0b001, 0b111, 0b001, 0b111], // 3
  [0b101, 0b101, 0b111, 0b001, 0b001], // 4
  [0b111, 0b100, 0b111, 0b001, 0b111], // 5
  [0b111, 0b100, 0b111, 0b101, 0b111], // 6
  [0b111, 0b001, 0b010, 0b010, 0b010], // 7
  [0b111, 0b101, 0b111, 0b101, 0b111], // 8
  [0b111, 0b101, 0b111, 0b001, 0b111], // 9
];

function cdigit(
  cov: Float32Array, size: number, r: Rect,
  digit: number, x: number, y: number, px: number,
): void {
  const glyph = DIGITS[((digit % 10) + 10) % 10];
  for (let row = 0; row < 5; row++) {
    const bits = glyph[4 - row]; // row 0 of the glyph is the TOP; v grows upward
    for (let col = 0; col < 3; col++) {
      if ((bits >> (2 - col)) & 1) cfill(cov, size, r, x + col * px, y + row * px, px, px);
    }
  }
}

/**
 * Map a `decalPolygons` path (0..1 UV, y down) into tile-local texels centred
 * on (cx, cy) with half-extent `half`. The y flip is deliberate: a DataTexture's
 * row 0 is v = 0, i.e. the BOTTOM, so a "point up" shape authored in canvas
 * convention has to be mirrored to come out point up on the model.
 */
function placeDecal(path: DecalPath, cx: number, cy: number, half: number, glyph?: string): Poly[] {
  return decalPolygons(path, glyph).map((p) => {
    const out: number[] = [];
    for (let i = 0; i < p.length; i += 2) {
      out.push(cx + (p[i] - 0.5) * 2 * half, cy - (p[i + 1] - 0.5) * 2 * half);
    }
    return out;
  });
}

/** Regular polygon approximation of a circle, as a tile-local `Poly`. */
function discPoly(cx: number, cy: number, rad: number, segs = 48): Poly {
  const out: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * TAU;
    out.push(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  return out;
}

/* ==========================================================================
 * 3. THE SPEC
 * ========================================================================== */

/**
 * The surface language a faction's hardware is built in. NOT a hue swap — the
 * two branches draw different marks, at different weights, at different gloss.
 *
 *   'welded'  — Allied. White ceramic over a welded monocoque. Thin seams,
 *               PROUD banding strips rather than cut grooves, a glossier
 *               clear-coated finish, and never a rivet.
 *   'riveted' — Soviet. Olive over bolted plate. Heavier seams cut deeper,
 *               rivet rows down every course, a matter finish.
 */
export type Plating = 'welded' | 'riveted';

/**
 * Everything that changes a pixel in an atlas. Hashed into the cache key, so
 * two specs that differ anywhere produce two atlases and two that agree
 * everywhere produce one.
 */
export interface GreebleSpec {
  /** Stable name, e.g. 'allies.vehicle'. Part of the cache key. */
  key: string;
  size: number;
  seed: number;
  /** Non-team hull paint. NEVER a faction colour — see R12/R-T1. */
  basePaint: string;
  /** Colour a recess is driven toward. base x 0.32 with a hue shift. */
  paintShadow: string;
  /** The flat team slab colour. Only reachable through the teamSlab tile. */
  teamColor: string;
  /** Insignia field colour (Soviet red disc / Allied blue roundel). */
  teamSecondary: string;
  insignia: 'star' | 'eagle' | 'none';
  /** Insignia glyph colour (Soviet gold star / Allied white eagle). */
  insigniaColor: string;
  /** 1-3% of surface. Cyan for everyone except Soviets (bible R-T5). */
  emissiveColor: string;
  /** Desaturated warm grey-brown. NEVER blue steel (S <= 0.26). */
  bareMetal: string;
  trackLink: string;
  glass: string;
  /** Stencil paint. Never pure white. */
  stencil: string;
  /** Warning-stripe yellow. */
  hazard: string;
  /** Soviets rivet every seam; Allies never do. */
  rivets: boolean;
  rivetPitchPx: number;
  /** Which surface language the tiles are drawn in. */
  plating: Plating;
  /**
   * Paint gloss, 0 = matte primer .. 1 = wet lacquer. ROUGHNESS ONLY — it must
   * never become texture. RA3's painted-toy read is a clear coat over a broad
   * diffuse lobe, so this rides on top of RULING #3's clearcoat, it does not
   * replace it.
   */
  sheen: number;
  /**
   * Extra plating COURSES on the big paint tiles, expressed the way the old
   * panel-density knob was: 1.0 is the authored plan, higher adds evenly
   * spaced full-width courses. It can no longer add jitter or density noise —
   * there is none left to add.
   */
  panelDensity: number;
  /** Four-digit hull number stencilled on the stencil tile. */
  hullNumber: number;
}

/* ==========================================================================
 * 4. THE SURFACE BUDGET AND THE PAINTERS
 * ========================================================================== */

/**
 * The hard limits this file holds itself to. These are the numbers that make
 * the difference between "painted plastic toy" and "mouldy sandpaper".
 */
export const SURFACE_BUDGET = {
  /** Peak-to-peak albedo variation allowed inside one flat area. */
  albedoRipple: 0.025,
  /** Peak-to-peak roughness variation allowed inside one flat area. */
  roughnessRipple: 0.06,
  /** Shortest wavelength any continuous variation may have, in texels. */
  minFeatureTexels: 16,
  /**
   * Fraction of a tile that must carry DRAWN structure for it not to read as
   * an untextured primitive (R1). Deliberately low: a flat slab with a frame
   * and one course is a correct RA3 surface and must pass.
   */
  detailFloorUnit: 0.070,
  detailFloorStructure: 0.045,
  /**
   * Fraction of texels allowed to be a strict local extremum in BOTH axes.
   *
   * White noise scores ~0.44 and 5-texel fbm scores a few percent, so this
   * ceiling is 40x below the failure it exists to catch. The clean atlases
   * measure 0.14% (Allied, no rivets) to 0.23% (Soviet, bolted) — the residue
   * is rivet apexes and stroke-corner AA texels, which are drawn geometry and
   * cannot be removed without removing the geometry.
   */
  speckleCeiling: 0.010,
} as const;

/** Scratch masks, allocated once per atlas build (not per tile). */
interface Scratch {
  /** Cut seams: darken, sink, occlude. */
  groove: Float32Array;
  /** Proud edges catching the key: lift a little, rise a little. */
  lip: Float32Array;
  /** Broad recessed pockets and contact shadows: darken and occlude only. */
  shade: Float32Array;
  /** Reusable coverage buffer for decals and stencils. */
  mask: Float32Array;
  /**
   * The union of every mark every painter has made, over the whole atlas.
   * Never cleared between tiles — this is what `detailCoverage` measures, and
   * because only the drawing primitives write to it, a noise field cannot
   * contribute to the R1 gate even in principle.
   */
  structure: Float32Array;
}

const RGB_SHADOW = new Float32Array(3);
const RGB_TMP = new Float32Array(3);

function clearScratch(sc: Scratch, size: number, r: Rect): void {
  clearRect(sc.groove, size, r);
  clearRect(sc.lip, size, r);
  clearRect(sc.shade, size, r);
  clearRect(sc.mask, size, r);
}

/**
 * Roughness for a given sheen. 0 -> 0.78 matte primer, 1 -> 0.24 lacquer,
 * with RULING #3's 0.52 landing at sheen 0.48.
 */
export function sheenRoughness(sheen: number): number {
  return clamp01(0.78 - clamp01(sheen) * 0.54);
}

/**
 * Lay the base paint. FLAT. Exactly one colour, exactly one roughness, height
 * exactly 0.5 so `normalFromStructure` produces exactly (0, 0, 1) over the
 * whole plate.
 *
 * This is the single most important function in the file and it is four lines
 * of assignment. Everything the old version added here — the orange peel in
 * albedo, the peel in height, the peel in roughness — was the failure.
 */
function fillBase(
  s: Surface, r: Rect, hex: string,
  roughness: number, metalness: number, teamMask: number,
): void {
  hexToRgb(hex, RGB_TMP);
  const size = s.size;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
      const o = i * 3;
      s.albedo[o] = RGB_TMP[0];
      s.albedo[o + 1] = RGB_TMP[1];
      s.albedo[o + 2] = RGB_TMP[2];
      s.height[i] = 0.5;
      s.roughness[i] = roughness;
      s.metalness[i] = metalness;
      s.ao[i] = 1;
      s.alpha[i] = 1;
      s.teamMask[i] = teamMask;
      s.emissive[i] = 0;
    }
  }
}

/** Per-tile composite tuning, chosen by the faction's plating language. */
interface Weld {
  /** Seam width in texels. */
  seam: number;
  /** How deep a seam cuts into the height field. */
  grooveDepth: number;
  /** Rivet dome height. */
  rivetRelief: number;
  /** Rivet radius in texels. */
  rivetRadius: number;
}

function weldFor(spec: GreebleSpec, tileW: number): Weld {
  const base = tileW * UNIT_GREEBLE.panelLineWidthFraction;
  return spec.plating === 'riveted'
    ? { seam: Math.max(1.6, base * 1.20), grooveDepth: 0.34, rivetRelief: 0.11, rivetRadius: Math.max(1.8, tileW * 0.021) }
    : { seam: Math.max(1.2, base * 0.85), grooveDepth: 0.22, rivetRelief: 0.00, rivetRadius: 0 };
}

/**
 * Fold the scratch masks into the surface. THIS is where bible 5.5's cavity
 * ruling is implemented: recess albedo = base x 0.32 driven toward the shadow
 * tint, a faint lighter lip on the sun side of every groove, and the crease AO
 * that 3.3 says must be baked rather than screen-space.
 *
 * The lip gain is 0.16 (it was 0.34). At 0.34 with an additive rasterizer,
 * every seam grew a white halo that read as chalk. RA3's panel lines are dark
 * grooves in flat paint with barely a highlight; the highlight comes from the
 * chamfer geometry, not from the texture.
 */
function composite(s: Surface, sc: Scratch, r: Rect, shadowHex: string, w: Weld): void {
  hexToRgb(shadowHex, RGB_SHADOW);
  const size = s.size;
  const cav = UNIT_GREEBLE.cavityMultiplier;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
      const g = sc.groove[i], l = sc.lip[i], sh = sc.shade[i];
      if (g === 0 && l === 0 && sh === 0) continue;
      const o = i * 3;
      const dark = clamp01(g + sh * 0.55);
      for (let c = 0; c < 3; c++) {
        const base = s.albedo[o + c];
        const recess = lerp(base * cav, RGB_SHADOW[c] * 0.9, 0.35);
        let v = lerp(base, recess, dark);
        v = clamp01(v * (1 + l * 0.16));
        s.albedo[o + c] = v;
      }
      s.height[i] = clamp01(s.height[i] - g * w.grooveDepth - sh * w.grooveDepth * 0.30 + l * 0.030);
      s.ao[i] = clamp01(s.ao[i] - dark * 0.52);
      // Grooves are marginally rougher than the surrounding paint.
      s.roughness[i] = clamp01(s.roughness[i] + g * 0.05 - l * 0.02);
    }
  }
}

/**
 * Paint a coverage mask into albedo as a flat colour. The ONLY way a decal,
 * a stencil or an insignia glyph gets onto a tile: the mask owns the shape and
 * the colour is constant across it, so there is no fringe and nothing the
 * shape could inherit from underneath.
 */
function paintMask(s: Surface, sc: Scratch, r: Rect, hex: string, teamMask?: number): void {
  hexToRgb(hex, RGB_TMP);
  const size = s.size;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
      const m = sc.mask[i];
      if (m <= 0.002) continue;
      const o = i * 3;
      s.albedo[o] = lerp(s.albedo[o], RGB_TMP[0], m);
      s.albedo[o + 1] = lerp(s.albedo[o + 1], RGB_TMP[1], m);
      s.albedo[o + 2] = lerp(s.albedo[o + 2], RGB_TMP[2], m);
      if (teamMask !== undefined && m > 0.5) s.teamMask[i] = teamMask;
      // A decal is drawn structure too — it just lives in colour, not relief.
      if (m > sc.structure[i]) sc.structure[i] = m;
    }
  }
  clearRect(sc.mask, size, r);
}

/**
 * THE BEVEL HIGHLIGHT (bible 5.5, scorecard #11).
 *
 * "A hand-painted lighter band along the top edge of each bevel — base albedo
 * +22% V, -15% S." A greyscale vertex multiplier can raise value but can never
 * DESATURATE, so the highlight is baked here instead: each tile reserves a
 * patch painted in its own colour, pre-lifted and pre-desaturated, and every
 * chamfer strip in UnitFactory samples that patch.
 *
 * Lerping toward (V,V,V) by 0.15 scales HSV saturation by exactly 0.85, because
 * S = (V - min)/V and only `min` moves.
 */
function clearBevelPatch(s: Surface, r: Rect, hex: string, roughness: number): void {
  // MUST match slotBevelUv's origin: that samples from the tile's INSET corner,
  // so painting the patch at the tile's raw corner leaves half the sampled
  // window sitting on top of panel lines and the bevel band comes out striped.
  const off = Math.round(r.w * UNIT_GREEBLE.tileInsetFraction);
  const p = Math.round(r.w * UNIT_GREEBLE.bevelPatchFraction);
  hexToRgb(hex, RGB_TMP);
  const v = Math.max(RGB_TMP[0], RGB_TMP[1], RGB_TMP[2]);
  const gain = 1 + UNIT_GREEBLE.bevelValueGain;
  const desat = UNIT_GREEBLE.bevelSaturationLoss;
  const br = clamp01(lerp(RGB_TMP[0], v, desat) * gain);
  const bg = clamp01(lerp(RGB_TMP[1], v, desat) * gain);
  const bb = clamp01(lerp(RGB_TMP[2], v, desat) * gain);
  const size = s.size;
  for (let y = off; y < off + p; y++) {
    for (let x = off; x < off + p; x++) {
      const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
      const o = i * 3;
      s.albedo[o] = br; s.albedo[o + 1] = bg; s.albedo[o + 2] = bb;
      s.height[i] = 0.5;
      s.roughness[i] = roughness;
      s.ao[i] = 1;
      s.emissive[i] = 0;
    }
  }
}

/* ==========================================================================
 * 5. PLATING LAYOUTS — deliberate geometry, never a walk
 *
 * The old `panelLines` walked down the tile taking a random step between 5.5%
 * and 16% of the height, broke each run at a random fraction, and dropped
 * cross-cuts at random offsets. Twelve runs of that on a 128 px tile is a line
 * every five texels at wobbly spacing: line NOISE, which is the same failure
 * as pixel noise one octave down.
 *
 * A real vehicle's plating is a handful of big plates. So a plan is a handful
 * of numbers, authored once, in fractions of the tile: a frame, some full-width
 * courses, some verticals, and one or two recessed pockets. Two neighbouring
 * plates of flat paint separated by one crisp dark line is the entire effect.
 * ========================================================================== */

interface PlatePlan {
  /** Frame inset as a fraction of the tile. 0 = no frame. */
  frame: number;
  /** Full-width courses, as fractions of tile height. */
  hCuts: readonly number[];
  /** Verticals, as [x, y0, y1] fractions. */
  vCuts: readonly (readonly [number, number, number])[];
  /** Recessed pockets, as [x, y, w, h] fractions. */
  pockets: readonly (readonly [number, number, number, number])[];
  /** Rivet rows (riveted plating only) along these height fractions. */
  rivetRows: readonly number[];
}

/**
 * The four authored plans. Read them as elevations of a plate: `large` is a
 * glacis with three plates and a stowage box, `tiny` is a sensor housing that
 * gets a frame and nothing else.
 */
const PLANS: Record<'large' | 'med' | 'small' | 'tiny', PlatePlan> = {
  large: {
    frame: 0.055,
    hCuts: [0.33, 0.67],
    vCuts: [[0.42, 0.33, 1.0], [0.70, 0.0, 0.33]],
    pockets: [[0.10, 0.72, 0.26, 0.18], [0.60, 0.40, 0.30, 0.20]],
    rivetRows: [0.33, 0.67],
  },
  med: {
    frame: 0.065,
    hCuts: [0.46],
    vCuts: [[0.62, 0.46, 1.0]],
    pockets: [[0.12, 0.60, 0.30, 0.24]],
    rivetRows: [0.46],
  },
  small: {
    frame: 0.085,
    hCuts: [0.55],
    vCuts: [],
    pockets: [],
    rivetRows: [0.55],
  },
  tiny: {
    frame: 0.115,
    hCuts: [],
    vCuts: [],
    pockets: [],
    rivetRows: [],
  },
};

/**
 * The stencil tile's plate: a frame and nothing else. A course through the
 * middle of a hull number is the one place a correct panel line is wrong — it
 * reads as a crossed-out digit, which is worse than no plating at all.
 */
const STENCIL_PLAN: PlatePlan = { frame: 0.08, hCuts: [], vCuts: [], pockets: [], rivetRows: [] };

/**
 * Draw a plan. Everything here is a straight line at an authored position; the
 * only thing `rng` decides is which of two mirror variants a tile uses, so two
 * neighbouring plates are not identical without either of them being random.
 */
function drawPlan(
  s: Surface, sc: Scratch, r: Rect, plan: PlatePlan, w: Weld, spec: GreebleSpec,
  extraCourses: number, flip: boolean,
): void {
  const size = s.size;
  const W = r.w, H = r.h;
  const fx = plan.frame * W, fy = plan.frame * H;
  const ix = fx, iy = fy, iw = W - fx * 2, ih = H - fy * 2;
  const X = (u: number): number => (flip ? ix + iw * (1 - u) : ix + iw * u);

  // The frame. On welded plating it is a PROUD banding strip (a lip pair) —
  // Allied architecture is banded, not cut. On riveted plating it is a cut.
  if (plan.frame > 0) {
    crect(sc.groove, size, r, ix, iy, iw, ih, w.seam);
    if (spec.plating === 'welded') {
      crect(sc.lip, size, r, ix - w.seam - 1, iy - w.seam - 1, iw + w.seam * 2 + 2, ih + w.seam * 2 + 2, 1.2);
    }
  }

  // Courses. The authored ones plus any the panel-density knob asks for, always
  // at even spacing — a course is a floor line or a plate joint, not a scribble.
  const cuts: number[] = [...plan.hCuts];
  for (let e = 0; e < extraCourses; e++) {
    // Evenly spaced inside the frame, and skipped outright if it would land on
    // top of an authored course. Two courses 4% apart is a double line, which
    // is the line-noise failure this whole rewrite exists to remove.
    const y = 0.07 + ((e + 1) / (extraCourses + 1)) * 0.86;
    if (cuts.every((c) => Math.abs(c - y) > 0.085)) cuts.push(y);
  }
  cuts.sort((a, b) => a - b);
  for (const c of cuts) {
    const y = iy + ih * c;
    cline(sc.groove, size, r, ix, y, ix + iw, y, w.seam);
    // The plate ABOVE a joint sits proud of the one below: one crisp lit edge.
    cline(sc.lip, size, r, ix, y + w.seam * 0.5 + 0.6, ix + iw, y + w.seam * 0.5 + 0.6, 1.1);
  }

  for (const [vx, y0, y1] of plan.vCuts) {
    const x = X(vx);
    cline(sc.groove, size, r, x, iy + ih * y0, x, iy + ih * y1, w.seam);
  }

  // Recessed pockets: an access panel or a stowage well let into the plate. The
  // interior sinks and darkens as ONE flat step, so it reads as a pocket rather
  // than as a patch of texture.
  for (const [px, py, pw, ph] of plan.pockets) {
    const x = flip ? ix + iw * (1 - px - pw) : ix + iw * px;
    const y = iy + ih * py;
    const ww = iw * pw, hh = ih * ph;
    cfill(sc.shade, size, r, x + w.seam, y + w.seam, ww - w.seam * 2, hh - w.seam * 2);
    crect(sc.groove, size, r, x, y, ww, hh, w.seam);
  }

  // Rivets: riveted plating only, height field only, on the courses and down
  // the frame. Sparse and on a layout — never scattered.
  if (spec.plating === 'riveted' && w.rivetRelief > 0) {
    const pitch = Math.max(6, spec.rivetPitchPx);
    for (const row of plan.rivetRows) {
      const y = iy + ih * row - w.seam - w.rivetRadius - 1.2;
      for (let x = ix + pitch * 0.5; x < ix + iw; x += pitch) {
        stampRivet(s.height, size, r, x, y, w.rivetRadius, w.rivetRelief);
        cdisc(sc.shade, size, r, x, y - w.rivetRadius * 0.9, w.rivetRadius * 0.7);
      }
    }
    if (plan.frame > 0) {
      for (let y = iy + pitch * 0.5; y < iy + ih; y += pitch * 1.5) {
        for (const x of [ix + w.rivetRadius + 1.5, ix + iw - w.rivetRadius - 1.5]) {
          stampRivet(s.height, size, r, x, y, w.rivetRadius, w.rivetRelief);
        }
      }
    }
  }
}

/** A louvre stack. Cooling vents are the cheapest legible greeble there is. */
function louvres(
  sc: Scratch, size: number, r: Rect, x: number, y: number, ww: number, hh: number, count: number,
): void {
  const pitch = hh / count;
  const t = Math.max(1.6, pitch * 0.30);
  for (let i = 0; i < count; i++) {
    const ly = y + (i + 0.5) * pitch;
    cline(sc.groove, size, r, x, ly, x + ww, ly, t);
    cline(sc.lip, size, r, x, ly + t * 0.5 + 0.8, x + ww, ly + t * 0.5 + 0.8, 1.1);
  }
  crect(sc.groove, size, r, x - 2, y - 2, ww + 4, hh + 4, 1.6);
}

/** A bolted access hatch: rim groove, raised lid, bolt ring, grab handle. */
function accessHatch(
  s: Surface, sc: Scratch, r: Rect, cx: number, cy: number, rad: number, bolts: number, w: Weld,
): void {
  const size = s.size;
  cring(sc.groove, size, r, cx, cy, rad, Math.max(1.5, rad * 0.10));
  cring(sc.lip, size, r, cx, cy, rad * 0.90, 1.1);
  const br = Math.max(1.3, rad * 0.11);
  for (let i = 0; i < bolts; i++) {
    const a = (i / bolts) * TAU + 0.2;
    const bx = cx + Math.cos(a) * rad * 0.74, by = cy + Math.sin(a) * rad * 0.74;
    stampRivet(s.height, size, r, bx, by, br, Math.max(0.07, w.rivetRelief));
    cdisc(sc.shade, size, r, bx, by - br * 0.9, br * 0.7);
  }
  // Grab handle: a crisp bar with a contact shadow under it.
  cfill(sc.lip, size, r, cx - rad * 0.34, cy - 1, rad * 0.68, Math.max(1.6, rad * 0.10));
  cfill(sc.shade, size, r, cx - rad * 0.34, cy - 1 - Math.max(1.4, rad * 0.09), rad * 0.68, Math.max(1.2, rad * 0.07));
}

/* ==========================================================================
 * 6. TILE PAINTING — one function per slot
 * ========================================================================== */

type PlanKey = 'large' | 'med' | 'small' | 'tiny';

function paintTile(
  s: Surface, sc: Scratch, spec: GreebleSpec, slot: SlotName, planKey: PlanKey, salt: number,
): void {
  const r = tileRect(slot, s.size);
  const rng = new Rng(spec.seed + salt);
  clearScratch(sc, s.size, r);
  const rough = sheenRoughness(spec.sheen);
  fillBase(s, r, spec.basePaint, rough, UNIT_MATERIAL.paintMetalness, 1);

  const w = weldFor(spec, r.w);
  // The density knob buys COURSES, never density noise. 1.0 -> the authored
  // plan; a building at 3.4 gets two more floor lines on its facades.
  const extra = planKey === 'tiny'
    ? 0
    : Math.max(0, Math.min(3, Math.round((spec.panelDensity - 1) * 0.9)));
  drawPlan(s, sc, r, PLANS[planKey], w, spec, extra, rng.chance(0.5));

  // One piece of real hardware on the bigger plates. Deliberate, placed, and
  // the same every build for a given seed.
  if (planKey === 'large') {
    accessHatch(s, sc, r, r.w * 0.74, r.h * 0.20, r.w * 0.105, 8, w);
    louvres(sc, s.size, r, r.w * 0.10, r.h * 0.10, r.w * 0.24, r.h * 0.15, 4);
  } else if (planKey === 'med') {
    accessHatch(s, sc, r, r.w * 0.30, r.h * 0.24, r.w * 0.115, 6, w);
  }

  composite(s, sc, r, spec.paintShadow, w);
  clearBevelPatch(s, r, spec.basePaint, rough);
}

/**
 * TEAM SLAB. R-T2: a flat solid panel insert let into the hull — not a
 * gradient, not a tint, and above all not a mottled blotch. In the RA3
 * reference the team colour is a bright saturated green against a yellow-olive
 * base: HIGH CHROMA, CLEAN EDGES, UNBROKEN AREA.
 *
 * So this tile is 88% one flat colour. It gets a recessed border so it reads as
 * an inserted plate, one lit top lip, four corner bolts on riveted hardware,
 * and nothing else at all.
 */
function paintTeamSlab(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('teamSlab', s.size);
  clearScratch(sc, s.size, r);
  // Team slabs run a touch glossier than hull paint: they are the thing the eye
  // is meant to find, and gloss is how RA3 makes them pop without raising area.
  const rough = sheenRoughness(Math.min(1, spec.sheen + 0.12));
  fillBase(s, r, spec.teamColor, rough, UNIT_MATERIAL.paintMetalness, 1);

  const w = weldFor(spec, r.w);
  const inset = r.w * 0.06;
  crect(sc.groove, s.size, r, inset, inset, r.w - inset * 2, r.h - inset * 2, w.seam);
  cline(sc.lip, s.size, r, inset + 2, r.h - inset - w.seam - 1, r.w - inset - 2, r.h - inset - w.seam - 1, 1.2);
  if (spec.plating === 'riveted') {
    const rr = w.rivetRadius;
    for (const [x, y] of [
      [inset * 2.0, inset * 2.0], [r.w - inset * 2.0, inset * 2.0],
      [inset * 2.0, r.h - inset * 2.0], [r.w - inset * 2.0, r.h - inset * 2.0],
    ] as const) {
      stampRivet(s.height, s.size, r, x, y, rr, w.rivetRelief);
      cdisc(sc.shade, s.size, r, x, y - rr * 0.9, rr * 0.7);
    }
  }
  composite(s, sc, r, spec.paintShadow, w);
  clearBevelPatch(s, r, spec.teamColor, rough);
}

/**
 * INSIGNIA. Exactly one per unit (R-T4).
 *
 * This is the tile the user called "a red splatter rather than a star". It was
 * a splatter because the disc and the glyph were painted over a noise-modulated
 * base and then had a noise normal map laid over them. Now every mark is a
 * vector path: the Soviet emblem is a red disc, a thin dark keyline and a real
 * five-point star from `decalPolygons('star5')`; the Allied emblem is a proper
 * ROUNDEL — white outer ring, cobalt field, white ring, and a hard-edged eagle
 * wedge. Both sit on a flat plate with one crisp retaining ring.
 */
function paintInsignia(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('insignia', s.size);
  clearScratch(sc, s.size, r);
  const rough = sheenRoughness(spec.sheen);
  fillBase(s, r, spec.basePaint, rough, UNIT_MATERIAL.paintMetalness, 0);

  const w = weldFor(spec, r.w);
  const cx = r.w * 0.5, cy = r.h * 0.5;
  const field = r.w * 0.38;

  const fillPolys = (polys: readonly Poly[], hex: string) => {
    cpoly(sc.mask, s.size, r, polys, 'fill');
    paintMask(s, sc, r, hex);
  };
  const fillDisc = (rad: number, hex: string) => {
    cdisc(sc.mask, s.size, r, cx, cy, rad);
    paintMask(s, sc, r, hex);
  };
  const fillRing = (rad: number, width: number, hex: string) => {
    cring(sc.mask, s.size, r, cx, cy, rad, width);
    paintMask(s, sc, r, hex);
  };

  if (spec.insignia === 'star') {
    // Soviet: red disc, dark keyline, gold five-point star. Point up.
    fillDisc(field, spec.teamSecondary);
    fillRing(field, Math.max(1.4, r.w * 0.014), spec.paintShadow);
    fillPolys(placeDecal('star5', cx, cy, field * 0.82), spec.insigniaColor);
  } else if (spec.insignia === 'eagle') {
    // Allied roundel: white outer, cobalt field, white inner ring, eagle.
    fillDisc(field, spec.insigniaColor);
    fillDisc(field * 0.86, spec.teamSecondary);
    fillRing(field * 0.60, Math.max(1.6, r.w * 0.016), spec.insigniaColor);
    const ww = field * 0.86, hh = field * 0.46;
    // A stylised eagle: swept wings plus a wedge body, all straight edges so it
    // stays a shape at 12 px instead of dissolving into a smudge.
    fillPolys([
      [
        cx - ww, cy - hh * 0.18,
        cx - ww * 0.34, cy - hh * 0.02,
        cx - ww * 0.30, cy - hh * 0.44,
        cx, cy - hh * 0.22,
        cx + ww * 0.30, cy - hh * 0.44,
        cx + ww * 0.34, cy - hh * 0.02,
        cx + ww, cy - hh * 0.18,
        cx + ww * 0.40, cy + hh * 0.26,
        cx, cy + hh * 0.10,
        cx - ww * 0.40, cy + hh * 0.26,
      ],
      [cx - field * 0.15, cy + hh * 0.04, cx + field * 0.15, cy + hh * 0.04, cx, cy + field * 0.78],
    ], spec.insigniaColor);
  }

  // A crisp retaining ring so the decal sits in a plate, not floating on one.
  cring(sc.groove, s.size, r, cx, cy, field * 1.18, w.seam);
  composite(s, sc, r, spec.paintShadow, w);
  clearBevelPatch(s, r, spec.basePaint, rough);
}

/**
 * EMISSIVE. Bible 8.1 wants emissive AREA tiny and value high, and the
 * foundation's warning is explicit: 2.6 over a whole surface veils the frame.
 * So the tile is mostly dark bezel and the glowing rect covers
 * EMISSIVE_TILE_COVER of it; the unit-level fraction is that times the plate
 * area, which the validator holds to 1-3% of hull surface.
 */
const EMISSIVE_TILE_COVER = 0.42;

function paintEmissive(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('emissive', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, '#1A1E22', 0.62, 0.10, 0);

  const w = weldFor(spec, r.w);
  const pw = r.w * 0.80, ph = r.h * (EMISSIVE_TILE_COVER / 0.80);
  const px = (r.w - pw) * 0.5, py = (r.h - ph) * 0.5;

  cfill(sc.mask, s.size, r, px, py, pw, ph);
  hexToRgb(spec.emissiveColor, RGB_TMP);
  const size = s.size;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
      const m = sc.mask[i];
      if (m <= 0.002) continue;
      const o = i * 3;
      s.albedo[o] = lerp(s.albedo[o], RGB_TMP[0], m);
      s.albedo[o + 1] = lerp(s.albedo[o + 1], RGB_TMP[1], m);
      s.albedo[o + 2] = lerp(s.albedo[o + 2], RGB_TMP[2], m);
      s.emissive[i] = m;
      s.roughness[i] = 0.30;
      s.teamMask[i] = 0;
    }
  }
  clearRect(sc.mask, size, r);

  crect(sc.groove, size, r, px - 3, py - 3, pw + 6, ph + 6, Math.max(1.5, r.w * 0.018));
  composite(s, sc, r, '#0A0C0E', w);
  clearBevelPatch(s, r, '#1A1E22', 0.62);
}

/** GLASS. 1-3% of surface; roughness 0.10 comes from the ORM map. */
function paintGlass(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('glass', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, spec.glass, UNIT_MATERIAL.glassRoughness, 0, 0);
  const w = weldFor(spec, r.w);
  // Two crisp reflection bands so a canopy is never a flat dark rectangle.
  // Straight-edged, like a window reflecting a straight-edged sky, not smeared.
  cfill(sc.lip, s.size, r, r.w * 0.06, r.h * 0.66, r.w * 0.88, r.h * 0.055);
  cfill(sc.lip, s.size, r, r.w * 0.06, r.h * 0.42, r.w * 0.62, r.h * 0.030);
  crect(sc.groove, s.size, r, 3, 3, r.w - 6, r.h - 6, Math.max(1.8, r.w * 0.022));
  composite(s, sc, r, '#05080C', { ...w, grooveDepth: w.grooveDepth * 0.5 });
  clearBevelPatch(s, r, spec.glass, UNIT_MATERIAL.glassRoughness);
}

/**
 * BARE METAL. Barrels, rollers, pistons. Warm grey-brown at S <= 0.26 — bible
 * 5.4 is explicit that blue steel is wrong for RA3.
 *
 * The old version ran a 4-octave fbm at 9x frequency into albedo AND height,
 * which is why every barrel looked like it had been rolled in sand. A real
 * turned surface is ANISOTROPIC: the variation runs ALONG the axis and there
 * is essentially none across it. So this is four plane waves at integer
 * frequencies down the barrel — exactly periodic, so the tile has no seam —
 * with the effect almost entirely in roughness, where it belongs.
 */
const TURN_FREQ = [3, 5, 8, 13] as const;
const TURN_NORM = 1 / (1 + 1 / 2 + 1 / 3 + 1 / 4);

function turnedGrain(v: number, seed: number): number {
  let a = 0;
  for (let k = 0; k < TURN_FREQ.length; k++) {
    const ph = (((seed * (k * 7 + 11)) % 211) / 211) * TAU;
    a += Math.cos(v * TAU * TURN_FREQ[k] + ph) / (k + 1);
  }
  return a * TURN_NORM; // -1 .. 1
}

function paintBareMetal(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('bareMetal', s.size);
  clearScratch(sc, s.size, r);
  hexToRgb(spec.bareMetal, RGB_TMP);
  const size = s.size;
  const w = weldFor(spec, r.w);
  for (let y = 0; y < r.h; y++) {
    // One value per ROW: the grain runs along the barrel, so there is exactly
    // zero variation across it. That is what anisotropic means.
    const g = turnedGrain(y / r.h, spec.seed + 15);
    const va = 1 + g * SURFACE_BUDGET.albedoRipple;
    const vr = clamp01(UNIT_MATERIAL.bareMetalRoughness + g * SURFACE_BUDGET.roughnessRipple * 0.5);
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
      const o = i * 3;
      s.albedo[o] = clamp01(RGB_TMP[0] * va);
      s.albedo[o + 1] = clamp01(RGB_TMP[1] * va);
      s.albedo[o + 2] = clamp01(RGB_TMP[2] * va);
      s.height[i] = 0.5;
      s.roughness[i] = vr;
      s.metalness[i] = UNIT_MATERIAL.bareMetalMetalness;
      s.ao[i] = 1; s.alpha[i] = 1; s.teamMask[i] = 0; s.emissive[i] = 0;
    }
  }
  // Machined rings at an EVEN pitch: what makes a cylinder read as a BARREL and
  // not a tube. Evenly spaced, because a lathe is evenly spaced.
  const rings = 4;
  for (let n = 0; n < rings; n++) {
    const y = r.h * ((n + 0.5) / rings);
    cline(sc.groove, size, r, 0, y, r.w, y, Math.max(1.4, r.w * 0.014));
    cline(sc.lip, size, r, 0, y + 2, r.w, y + 2, 1.0);
  }
  composite(s, sc, r, '#241C14', w);
  clearBevelPatch(s, r, spec.bareMetal, UNIT_MATERIAL.bareMetalRoughness);
}

/** TREAD. Near-black chevron links (bible 5.4: #030607 -> #281A11). */
function paintTread(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('tread', s.size);
  clearScratch(sc, s.size, r);
  // Bible 5.4: track links run #030607 -> #281A11. The base is the dark end;
  // the chevron lip lifts the proud links toward the brown one.
  hexToRgb(spec.trackLink, RGB_TMP);
  const dark = `#${[0, 1, 2].map((c) => Math.round(RGB_TMP[c] * 255 * 0.34).toString(16).padStart(2, '0')).join('')}`;
  fillBase(s, r, dark, 0.90, 0.35, 0);
  const w = weldFor(spec, r.w);
  const links = 8;
  const pitch = r.h / links;
  for (let i = 0; i < links; i++) {
    const y = i * pitch;
    // Chevron block: two strokes meeting at the centreline.
    cline(sc.lip, s.size, r, r.w * 0.10, y + pitch * 0.20, r.w * 0.5, y + pitch * 0.64, pitch * 0.28);
    cline(sc.lip, s.size, r, r.w * 0.90, y + pitch * 0.20, r.w * 0.5, y + pitch * 0.64, pitch * 0.28);
    cline(sc.groove, s.size, r, 0, y, r.w, y, Math.max(1.6, pitch * 0.14));
    // Guide horn on the centre line.
    stampRivet(s.height, s.size, r, r.w * 0.5, y + pitch * 0.5, pitch * 0.18, 0.16);
  }
  composite(s, sc, r, '#020507', { ...w, grooveDepth: 0.42 });
  clearBevelPatch(s, r, spec.trackLink, 0.90);
}

/** VENT. A full tile of louvres for engine decks and radiator faces. */
function paintVent(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('vent', s.size);
  clearScratch(sc, s.size, r);
  const rough = clamp01(sheenRoughness(spec.sheen) + 0.06);
  fillBase(s, r, spec.basePaint, rough, 0.15, 0);
  const w = weldFor(spec, r.w);
  louvres(sc, s.size, r, r.w * 0.08, r.h * 0.12, r.w * 0.84, r.h * 0.76, 7);
  if (spec.plating === 'riveted') {
    for (let x = r.w * 0.12; x < r.w * 0.90; x += spec.rivetPitchPx * 1.4) {
      stampRivet(s.height, s.size, r, x, r.h * 0.055, w.rivetRadius, w.rivetRelief);
      stampRivet(s.height, s.size, r, x, r.h * 0.945, w.rivetRadius, w.rivetRelief);
    }
  }
  composite(s, sc, r, spec.paintShadow, { ...w, grooveDepth: w.grooveDepth * 1.25 });
  clearBevelPatch(s, r, spec.basePaint, rough);
}

/** HATCH. A whole tile given to one big bolted access panel. */
function paintHatch(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('hatch', s.size);
  clearScratch(sc, s.size, r);
  const rough = sheenRoughness(spec.sheen);
  fillBase(s, r, spec.basePaint, rough, UNIT_MATERIAL.paintMetalness, 1);
  const w = weldFor(spec, r.w);
  accessHatch(s, sc, r, r.w * 0.5, r.h * 0.5, r.w * 0.33, 10, w);
  crect(sc.groove, s.size, r, r.w * 0.07, r.h * 0.07, r.w * 0.86, r.h * 0.86, w.seam);
  composite(s, sc, r, spec.paintShadow, { ...w, grooveDepth: w.grooveDepth * 1.15 });
  clearBevelPatch(s, r, spec.basePaint, rough);
}

/**
 * STRIPE. 45-degree hazard chevrons — the one place a hard, high-contrast
 * repeating pattern is correct, because on a real ramp lip it IS a hard,
 * high-contrast repeating pattern. Drawn as filled bands, not sampled noise.
 */
function paintStripe(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('stripe', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, '#22242A', sheenRoughness(spec.sheen), 0, 0);
  const w = weldFor(spec, r.w);
  const band = r.w * 0.16;
  // Bands run at 45 degrees, drawn as thick diagonal strokes so their edges are
  // crisp and anti-aliased instead of stair-stepped. `band` is the stroke width
  // measured PERPENDICULAR to the band, so the period along x has to be
  // 2 * band * sqrt(2) for the painted and unpainted bands to come out equal.
  const period = band * 2 * Math.SQRT2;
  for (let c = -r.h; c < r.w + r.h; c += period) {
    cline(sc.mask, s.size, r, c, 0, c + r.h, r.h, band);
  }
  paintMask(s, sc, r, spec.hazard);
  crect(sc.groove, s.size, r, 2, 2, r.w - 4, r.h - 4, Math.max(1.4, r.w * 0.015));
  composite(s, sc, r, '#101216', w);
  clearBevelPatch(s, r, spec.hazard, sheenRoughness(spec.sheen));
}

/** STENCIL. Four-digit hull number plus a service caption bar. */
function paintStencil(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('stencil', s.size);
  clearScratch(sc, s.size, r);
  const rough = sheenRoughness(spec.sheen);
  fillBase(s, r, spec.basePaint, rough, UNIT_MATERIAL.paintMetalness, 1);
  const w = weldFor(spec, r.w);

  const px = Math.max(2, Math.round(r.w / 24));
  const digits = [
    Math.floor(spec.hullNumber / 1000) % 10,
    Math.floor(spec.hullNumber / 100) % 10,
    Math.floor(spec.hullNumber / 10) % 10,
    spec.hullNumber % 10,
  ];
  const glyphW = px * 4;
  const x0 = (r.w - glyphW * digits.length) * 0.5;
  const y0 = r.h * 0.42;
  for (let i = 0; i < digits.length; i++) cdigit(sc.mask, s.size, r, digits[i], x0 + i * glyphW, y0, px);
  // A caption bar under the number: dash-dot-dash, reads as stencilled text.
  for (let i = 0; i < 7; i++) {
    const bw = (i & 1) ? px : px * 2;
    cfill(sc.mask, s.size, r, x0 + i * px * 2.4, r.h * 0.24, bw, px);
  }
  paintMask(s, sc, r, spec.stencil, 0);

  drawPlan(s, sc, r, STENCIL_PLAN, w, spec, 0, false);
  composite(s, sc, r, spec.paintShadow, w);
  clearBevelPatch(s, r, spec.basePaint, rough);
}

/**
 * GRILLE. Intake mesh. Opened up from the old 7-texel pitch — at that spacing
 * a mesh is indistinguishable from noise once mip level 1 kicks in, which is
 * the same failure one octave down.
 */
function paintGrille(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('grille', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, '#2A2C30', 0.68, 0.55, 0);
  const w = weldFor(spec, r.w);
  const pitch = Math.max(SURFACE_BUDGET.minFeatureTexels * 0.6, r.w / 10);
  for (let y = pitch * 0.5; y < r.h; y += pitch) {
    cline(sc.groove, s.size, r, 0, y, r.w, y, 2.0);
    cline(sc.lip, s.size, r, 0, y + 1.8, r.w, y + 1.8, 1.0);
  }
  for (let x = pitch * 0.5; x < r.w; x += pitch) cline(sc.groove, s.size, r, x, 0, x, r.h, 2.0);
  crect(sc.groove, s.size, r, 2, 2, r.w - 4, r.h - 4, Math.max(1.8, r.w * 0.022));
  composite(s, sc, r, '#0C0E10', { ...w, grooveDepth: 0.44 });
  clearBevelPatch(s, r, '#2A2C30', 0.68);
}

/**
 * RIVET PLATE. Soviet bolted armour — and on Allied hardware, a welded splice
 * plate, because the Allies do not rivet anything (bible 5.7). This is the one
 * tile whose whole job is hardware, so it carries the densest legal layout.
 */
function paintRivetPlate(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('rivetPlate', s.size);
  clearScratch(sc, s.size, r);
  const rough = sheenRoughness(spec.sheen);
  fillBase(s, r, spec.basePaint, rough, UNIT_MATERIAL.paintMetalness, 1);
  const w = weldFor(spec, r.w);

  // Three big plates butted together, the joints running the long way.
  const seams = [0.34, 0.68];
  for (const t of seams) {
    const y = r.h * t;
    cline(sc.groove, s.size, r, 0, y, r.w, y, w.seam * 1.15);
    cline(sc.lip, s.size, r, 0, y + w.seam * 0.6 + 0.6, r.w, y + w.seam * 0.6 + 0.6, 1.2);
  }
  cline(sc.groove, s.size, r, r.w * 0.52, 0, r.w * 0.52, r.h * 0.34, w.seam * 1.15);

  if (spec.plating === 'riveted') {
    const pitch = Math.max(6, spec.rivetPitchPx);
    const rr = w.rivetRadius;
    for (const t of [0.34, 0.68]) {
      for (const off of [-1, 1]) {
        const y = r.h * t + off * (w.seam + rr + 1.4);
        for (let x = pitch * 0.5; x < r.w; x += pitch) {
          stampRivet(s.height, s.size, r, x, y, rr, w.rivetRelief);
          cdisc(sc.shade, s.size, r, x, y - rr * 0.9, rr * 0.7);
        }
      }
    }
  } else {
    // Welded splice: a proud strap over each joint instead of a bolt row.
    for (const t of seams) {
      const y = r.h * t;
      crect(sc.lip, s.size, r, r.w * 0.06, y - r.h * 0.045, r.w * 0.88, r.h * 0.09, 1.3);
    }
  }
  composite(s, sc, r, spec.paintShadow, w);
  clearBevelPatch(s, r, spec.basePaint, rough);
}

/* ==========================================================================
 * 7. METRICS — the build-time gate
 *
 * The OLD gate was Sobel edge coverage with a floor of 22% (units) / 30%
 * (buildings). That number is why this file grew a noise field: the cheapest
 * way to raise Sobel coverage is to add static, and the cheapest way to add
 * static is fbm. The metric rewarded exactly the thing that made the render
 * look amateur.
 *
 * So there are now TWO numbers and they pull in opposite directions:
 *
 *   detailCoverage — how much of a tile carries DRAWN structure. It is measured
 *     from the structure mask the painters themselves wrote, so noise cannot
 *     contribute to it at all. This is the real R1 gate.
 *
 *   speckleRatio — how much of a tile is salt-and-pepper, counted as texels
 *     that are a strict local extremum in BOTH axes. White noise scores ~0.44.
 *     A crisp drawn line scores 0, because a line continues along its length.
 *     This is the gate that would have caught the old atlas, and it is an
 *     ERROR, not a warning.
 *
 * `edgeCoverage` is kept because it is still a useful report, but nothing gates
 * on it any more.
 * ========================================================================== */

/**
 * Sobel |grad| > threshold coverage over an sRGB luminance image, restricted to
 * a slot's sampled sub-rect. Reported, never gated on — see above.
 */
export function edgeCoverage(s: Surface, slot?: SlotName, threshold = 25 / 255): number {
  const size = s.size;
  const r = slot ? tileRect(slot, size) : { x: 0, y: 0, w: size, h: size };
  const pad = slot ? Math.round(r.w * UNIT_GREEBLE.tileInsetFraction) + 1 : 1;
  const lum = (x: number, y: number): number => {
    const xi = Math.min(size - 1, Math.max(0, (r.x + x) | 0));
    const yi = Math.min(size - 1, Math.max(0, (r.y + y) | 0));
    const o = (yi * size + xi) * 3;
    return 0.2126 * s.albedo[o] + 0.7152 * s.albedo[o + 1] + 0.0722 * s.albedo[o + 2];
  };
  let hits = 0, total = 0;
  for (let y = pad; y < r.h - pad; y++) {
    for (let x = pad; x < r.w - pad; x++) {
      const gx =
        (lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1)) -
        (lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1));
      const gy =
        (lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1)) -
        (lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1));
      if (Math.hypot(gx, gy) > threshold) hits++;
      total++;
    }
  }
  return total === 0 ? 0 : hits / total;
}

/**
 * Fraction of a tile carrying drawn structure — a seam, a lip, a pocket edge,
 * a rivet, a decal. Measured from the painters' own accumulated mask, so a
 * noise field contributes exactly nothing to it.
 */
export function detailCoverage(structure: Float32Array, size: number, slot?: SlotName): number {
  const r = slot ? tileRect(slot, size) : { x: 0, y: 0, w: size, h: size };
  const pad = slot ? Math.round(r.w * UNIT_GREEBLE.tileInsetFraction) : 0;
  let hits = 0, total = 0;
  for (let y = pad; y < r.h - pad; y++) {
    for (let x = pad; x < r.w - pad; x++) {
      if (structure[((r.y + y) | 0) * size + ((r.x + x) | 0)] > 0.10) hits++;
      total++;
    }
  }
  return total === 0 ? 0 : hits / total;
}

/**
 * Fraction of texels that are a strict local extremum in BOTH axes — the
 * salt-and-pepper detector. Run over albedo luminance AND over the height
 * field, because a normal map made of noise is the failure that actually
 * shipped, and it is invisible in albedo.
 */
export function speckleRatio(s: Surface): number {
  const size = s.size;
  const n = size * size;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    // Height is weighted in: a flat albedo over a noisy height still speckles
    // once the key light hits the normal map.
    lum[i] = 0.2126 * s.albedo[o] + 0.7152 * s.albedo[o + 1] + 0.0722 * s.albedo[o + 2]
      + (s.height[i] - 0.5) * 2;
  }
  let hits = 0, total = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const c = lum[i];
      const l = lum[i - 1], r = lum[i + 1], u = lum[i - size], d = lum[i + size];
      const maxX = c > l && c > r, minX = c < l && c < r;
      const maxY = c > u && c > d, minY = c < u && c < d;
      if ((maxX && maxY) || (minX && minY)) hits++;
      total++;
    }
  }
  return total === 0 ? 0 : hits / total;
}

/* ==========================================================================
 * 8. PACKING + THE FACTORY
 * ========================================================================== */

/** RGB = emissiveColour x mask. `three` samples emissiveMap in RGB, not alpha. */
function packEmissive(s: Surface, hex: string): Uint8Array {
  hexToRgb(hex, RGB_TMP);
  const n = s.size * s.size;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const m = s.emissive[i];
    out[o] = Math.round(clamp01(RGB_TMP[0] * m) * 255);
    out[o + 1] = Math.round(clamp01(RGB_TMP[1] * m) * 255);
    out[o + 2] = Math.round(clamp01(RGB_TMP[2] * m) * 255);
    out[o + 3] = 255;
  }
  return out;
}

/** The generated set for one faction-class. */
export interface GreebleAtlas {
  key: string;
  size: number;
  spec: Readonly<GreebleSpec>;
  /** sRGB albedo, team mask in alpha. */
  map: THREE.DataTexture;
  /** Tangent-space XY + cavity in B + curvature in A. STRUCTURAL: a flat plate
   *  comes out exactly (0, 0, 1) with no ripple to catch a specular. */
  normalMap: THREE.DataTexture;
  /** AO / roughness / metalness + emissive mask in alpha. */
  ormMap: THREE.DataTexture;
  /** Pre-multiplied emissive colour. */
  emissiveMap: THREE.DataTexture;
  /** Retained for build-time measurement; not uploaded. */
  surface: Surface;
  /** Accumulated drawn-structure mask, for `detailCoverage`. Not uploaded. */
  structure: Float32Array;
  /** Sampled UV rect per slot. */
  uv: Record<SlotName, UvRect>;
  /** Flat patch per slot, sampled by chamfer strips. */
  bevelUv: Record<SlotName, UvRect>;
  metrics: {
    /** Drawn-structure coverage over the four paint tiles. THE R1 GATE. */
    paintDetailCoverage: number;
    /** Drawn-structure coverage over the whole atlas. */
    atlasDetailCoverage: number;
    /** Salt-and-pepper ratio over albedo + height. MUST be ~0. */
    speckleRatio: number;
    /** Legacy Sobel figures. Reported for the boot log; nothing gates on them. */
    paintEdgeCoverage: number;
    atlasEdgeCoverage: number;
    /** Fraction of the emissive tile that actually emits. */
    emissiveTileCover: number;
    generateMs: number;
  };
}

function specHash(spec: GreebleSpec): string {
  return [
    spec.key, spec.size, spec.seed, spec.basePaint, spec.paintShadow,
    spec.teamColor, spec.teamSecondary, spec.insignia, spec.insigniaColor,
    spec.emissiveColor, spec.bareMetal, spec.trackLink, spec.glass,
    spec.stencil, spec.hazard, spec.rivets ? 'r' : '-', spec.rivetPitchPx,
    spec.plating, spec.sheen, spec.panelDensity, spec.hullNumber,
  ].join('|');
}

function makeTexture(data: Uint8Array, size: number, srgb: boolean, name: string, aniso: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = name;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  // CLAMP, not repeat: this is an atlas. A repeating wrap would let a mip pull
  // the opposite edge of the sheet into a bevel strip.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

/**
 * THE ONLY WAY TO GET A GREEBLE ATLAS. Cached on the full spec hash, so the
 * same texture is never generated twice however many units ask for it.
 */
export class GreebleFactory {
  private readonly cache = new Map<string, GreebleAtlas>();
  /** Max anisotropic samples; clamped by the renderer at upload. */
  anisotropy = 8;
  generated = 0;
  hits = 0;

  atlas(spec: GreebleSpec): GreebleAtlas {
    const key = specHash(spec);
    const hit = this.cache.get(key);
    if (hit !== undefined) { this.hits++; return hit; }
    const built = this.build(key, spec);
    this.cache.set(key, built);
    this.generated++;
    return built;
  }

  private build(key: string, spec: GreebleSpec): GreebleAtlas {
    const t0 = Date.now();
    const size = spec.size;
    const s = createSurface(size);
    const n = size * size;
    // Every mark every painter makes is folded into `structure`, so
    // `detailCoverage` measures drawn geometry and can never be inflated by a
    // noise field. `record` runs after a painter and before the next clear.
    const structure = new Float32Array(n);
    const sc: Scratch = {
      groove: new Float32Array(n),
      lip: new Float32Array(n),
      shade: new Float32Array(n),
      mask: new Float32Array(n),
      structure,
    };
    const record = (r: Rect): void => {
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
          const v = Math.max(sc.groove[i], Math.max(sc.lip[i], sc.shade[i]));
          if (v > structure[i]) structure[i] = v;
        }
      }
    };

    // Four plate scales. `paintSlotForArea` picks between them by face area, so
    // a 7 m glacis gets the full plan and a 0.3 m sensor box gets a frame.
    const tiles: readonly (readonly [SlotName, PlanKey, number])[] = [
      ['paintLarge', 'large', 1], ['paintMed', 'med', 2],
      ['paintSmall', 'small', 3], ['paintTiny', 'tiny', 4],
    ];
    for (const [slot, plan, salt] of tiles) {
      paintTile(s, sc, spec, slot, plan, salt);
      record(tileRect(slot, size));
    }

    const others: readonly (readonly [SlotName, (a: Surface, b: Scratch, c: GreebleSpec) => void])[] = [
      ['teamSlab', paintTeamSlab], ['insignia', paintInsignia],
      ['emissive', paintEmissive], ['glass', paintGlass],
      ['bareMetal', paintBareMetal], ['tread', paintTread],
      ['vent', paintVent], ['hatch', paintHatch],
      ['stripe', paintStripe], ['stencil', paintStencil],
      ['grille', paintGrille], ['rivetPlate', paintRivetPlate],
    ];
    for (const [slot, painter] of others) {
      painter(s, sc, spec);
      record(tileRect(slot, size));
    }

    const relief = UNIT_GREEBLE.normalRelief;
    const map = makeTexture(packAlbedo(s), size, true, `${spec.key}.albedo`, this.anisotropy);
    // STRUCTURAL, not raw Sobel: a 1-texel spike is filtered out and a
    // sub-structural gradient dead-bands to exactly zero, so a flat plate is a
    // flat plate and cannot pick up a marbled specular.
    const normalMap = makeTexture(
      packNormalStructural(s, relief, UNIT_GREEBLE.cavityRadiusPx), size, false,
      `${spec.key}.normal`, this.anisotropy);
    const ormMap = makeTexture(packOrm(s), size, false, `${spec.key}.orm`, this.anisotropy);
    const emissiveMap = makeTexture(packEmissive(s, spec.emissiveColor), size, true, `${spec.key}.emissive`, 1);

    const uv = {} as Record<SlotName, UvRect>;
    const bevelUv = {} as Record<SlotName, UvRect>;
    for (const slot of SLOT_NAMES) {
      uv[slot] = slotUv(slot, size);
      bevelUv[slot] = slotBevelUv(slot, size);
    }

    let paintDetail = 0, paintEdge = 0;
    for (const slot of PAINT_SLOTS) {
      paintDetail += detailCoverage(structure, size, slot);
      paintEdge += edgeCoverage(s, slot);
    }
    paintDetail /= PAINT_SLOTS.length;
    paintEdge /= PAINT_SLOTS.length;

    let emissiveArea = 0;
    const er = tileRect('emissive', size);
    for (let y = 0; y < er.h; y++) {
      for (let x = 0; x < er.w; x++) emissiveArea += s.emissive[((er.y + y) | 0) * size + ((er.x + x) | 0)];
    }

    return {
      key,
      size,
      spec,
      map, normalMap, ormMap, emissiveMap,
      surface: s,
      structure,
      uv, bevelUv,
      metrics: {
        paintDetailCoverage: paintDetail,
        atlasDetailCoverage: detailCoverage(structure, size),
        speckleRatio: speckleRatio(s),
        paintEdgeCoverage: paintEdge,
        atlasEdgeCoverage: edgeCoverage(s),
        emissiveTileCover: emissiveArea / (er.w * er.h),
        generateMs: Date.now() - t0,
      },
    };
  }

  /** Everything built so far, for the boot report. */
  all(): GreebleAtlas[] { return Array.from(this.cache.values()); }

  dispose(): void {
    for (const a of this.cache.values()) {
      a.map.dispose(); a.normalMap.dispose(); a.ormMap.dispose(); a.emissiveMap.dispose();
    }
    this.cache.clear();
  }

  stats(): { atlases: number; generated: number; hits: number; megabytes: number } {
    let bytes = 0;
    for (const a of this.cache.values()) bytes += a.size * a.size * 4 * 4 * (4 / 3);
    return { atlases: this.cache.size, generated: this.generated, hits: this.hits, megabytes: bytes / (1024 * 1024) };
  }
}

/** The shared factory. One per process; tests may construct their own. */
export const greebles = new GreebleFactory();

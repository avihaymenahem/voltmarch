/**
 * ============================================================================
 * RED ALERT — src/art/Greeble.ts
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
 * WHY FOUR PAINT TILES. Bible 5.5 specifies panel lines as a fraction of *the
 * part's* short dimension (2%) and 6-14 runs per major hull face. That is a
 * RELATIVE spec, so one tile per face — not a tiled repeat — is the literally
 * correct mapping: a 7 m glacis and a 0.4 m sensor box both get panel lines
 * scaled to themselves. The four density variants exist so the factory can
 * pick by face area and never emit a sub-pixel greeble (bible 5.3).
 *
 * WHAT IS PAINTED, PER BIBLE 5.5
 * ------------------------------
 *   - panel lines: dark inset groove (1.5-3 px) + a 1 px lighter lip on the
 *     sun side, long runs along the long axis plus 2-4 cross-cuts, NEVER a
 *     uniform grid (spacing is walked with jitter).
 *   - cavity darkening: the ONLY wear. recess = base x 0.32, hue-shifted
 *     toward the shadow tint. Baked into albedo AND ao, never SSAO.
 *   - rivets (Soviets only): 3-5 px discs at 10-14 px pitch on ~60% of seams,
 *     drawn as a light dot with a dark under-shadow.
 *   - vents, hatches, grilles, warning stripes, hull stencil numerals.
 *   - ZERO grime. No streaks, no mud, no rust, no scratched edges (scorecard
 *     #22). Everything that reads as "wear" here is a recess, not dirt.
 *
 * The geometric bevel highlight (scorecard #11) is NOT painted here — it is
 * baked into vertex colour on the chamfer ring by UnitFactory, which is both
 * cheaper and per-edge exact. Each tile therefore reserves a clean BEVEL PATCH
 * (bottom-left 10%) that painters must leave flat, so a chamfer strip samples
 * an unbroken colour.
 *
 * DETERMINISM: seeded, pure, no DOM, no Math.random. Two runs produce
 * byte-identical atlases so the screenshot harness stays diffable.
 *
 * CACHING: `GreebleFactory.atlas()` hashes the entire spec. The same texture
 * is never generated twice.
 * ============================================================================
 */

import * as THREE from 'three';
import { createSurface, packAlbedo, packNormal, packOrm, type Surface } from '../core/assets';
import { clamp01, fbm2, hexToRgb, lerp, Rng, smoothstep, TAU } from '../core/math';
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
 * Pick a paint density by the face's world area, so a 7 m glacis gets 12 panel
 * runs and a 0.3 m sensor box gets one seam. This is the rule that keeps every
 * greeble >= 3 px at gameplay zoom (bible 5.3, "nothing sub-pixel").
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
 * 2. RECT-CLIPPED DRAWING PRIMITIVES
 *
 * core/assets.ts ships drawLine/drawDisc/drawDisc, but every one of them WRAPS
 * at the texture edge (they exist for seamless tiling surfaces). In an atlas a
 * wrapped stroke lands in a neighbouring tile, so this module carries its own
 * clipped equivalents. Coordinates are TILE-LOCAL; the rect does the offset.
 * ========================================================================== */

/** Accumulate `value` at a tile-local pixel, clipped and clamped to 0..1. */
function put(data: Float32Array, size: number, r: Rect, x: number, y: number, value: number): void {
  if (x < 0 || y < 0 || x >= r.w || y >= r.h) return;
  const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
  data[i] = clamp01(data[i] + value);
}

/** Soft-edged clipped line. Panel grooves, seams, louvre slats. */
function rline(
  data: Float32Array, size: number, r: Rect,
  x0: number, y0: number, x1: number, y1: number, width: number, value: number,
): void {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  const w = Math.max(0.5, width);
  const wi = Math.ceil(w);
  for (let s = 0; s <= len; s++) {
    const t = s / len;
    const px = Math.round(x0 + dx * t), py = Math.round(y0 + dy * t);
    for (let oy = -wi; oy <= wi; oy++) {
      for (let ox = -wi; ox <= wi; ox++) {
        const d = Math.hypot(ox, oy);
        if (d > w) continue;
        put(data, size, r, px + ox, py + oy, value * (1 - d / w));
      }
    }
  }
}

/** Soft clipped disc. Rivets, bolts, hatch centres. */
function rdisc(
  data: Float32Array, size: number, r: Rect,
  cx: number, cy: number, radius: number, value: number, softness = 0.4,
): void {
  const ri = Math.ceil(radius + 1);
  const cxi = Math.round(cx), cyi = Math.round(cy);
  for (let oy = -ri; oy <= ri; oy++) {
    for (let ox = -ri; ox <= ri; ox++) {
      const d = Math.hypot(ox, oy);
      if (d > radius) continue;
      put(data, size, r, cxi + ox, cyi + oy, value * smoothstep(radius, radius * (1 - softness), d));
    }
  }
}

/** Hard clipped filled rectangle. Panels, bezels, slabs. */
function rfill(
  data: Float32Array, size: number, r: Rect,
  x: number, y: number, w: number, h: number, value: number,
): void {
  const x0 = Math.round(x), y0 = Math.round(y);
  const x1 = Math.round(x + w), y1 = Math.round(y + h);
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) put(data, size, r, px, py, value);
}

/** Rounded-rect outline, used for emissive bezels and hatch rims. */
function rroundRect(
  data: Float32Array, size: number, r: Rect,
  x: number, y: number, w: number, h: number, radius: number, width: number, value: number,
): void {
  const rr = Math.min(radius, Math.min(w, h) * 0.5);
  rline(data, size, r, x + rr, y, x + w - rr, y, width, value);
  rline(data, size, r, x + rr, y + h, x + w - rr, y + h, width, value);
  rline(data, size, r, x, y + rr, x, y + h - rr, width, value);
  rline(data, size, r, x + w, y + rr, x + w, y + h - rr, width, value);
  for (const [cx, cy, a0] of [
    [x + rr, y + rr, Math.PI], [x + w - rr, y + rr, Math.PI * 1.5],
    [x + w - rr, y + h - rr, 0], [x + rr, y + h - rr, Math.PI * 0.5],
  ] as const) {
    const steps = Math.max(4, Math.ceil(rr));
    for (let s = 0; s < steps; s++) {
      const a = a0 + (s / steps) * Math.PI * 0.5;
      const b = a0 + ((s + 1) / steps) * Math.PI * 0.5;
      rline(data, size, r,
        cx + Math.cos(a) * rr, cy + Math.sin(a) * rr,
        cx + Math.cos(b) * rr, cy + Math.sin(b) * rr, width, value);
    }
  }
}

/** Scanline polygon fill. Insignia stars, eagles, chevrons. */
function rpoly(
  data: Float32Array, size: number, r: Rect,
  pts: readonly (readonly [number, number])[], value: number,
): void {
  if (pts.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(r.h - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    xs.length = 0;
    const sy = y + 0.5;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j], b = pts[i];
      if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
        xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.round(xs[k]), xb = Math.round(xs[k + 1]);
      for (let x = xa; x < xb; x++) put(data, size, r, x, y, value);
    }
  }
}

/** N-pointed star polygon, for the Soviet insignia. */
function starPoints(cx: number, cy: number, rOuter: number, rInner: number, points: number, rot: number) {
  const out: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * TAU;
    const rad = (i & 1) ? rInner : rOuter;
    out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  return out;
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

function rdigit(
  data: Float32Array, size: number, r: Rect,
  digit: number, x: number, y: number, px: number, value: number,
): void {
  const glyph = DIGITS[((digit % 10) + 10) % 10];
  for (let row = 0; row < 5; row++) {
    const bits = glyph[4 - row]; // row 0 of the glyph is the TOP; v grows upward
    for (let col = 0; col < 3; col++) {
      if ((bits >> (2 - col)) & 1) rfill(data, size, r, x + col * px, y + row * px, px, px, value);
    }
  }
}

/* ==========================================================================
 * 3. THE SPEC
 * ========================================================================== */

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
  /** Multiplies the panel-run count. 1.0 ships. */
  panelDensity: number;
  /** Four-digit hull number stencilled on the stencil tile. */
  hullNumber: number;
}

/* ==========================================================================
 * 4. THE PAINTERS
 *
 * Each fills one tile. They share a scratch band of channels so the composition
 * step (albedo/height/ao/roughness from groove + lip + rivet) lives in exactly
 * one place and every tile is guaranteed to agree about what a recess means.
 * ========================================================================== */

/** Scratch masks, allocated once per atlas build (not per tile). */
interface Scratch {
  groove: Float32Array;
  lip: Float32Array;
  rivet: Float32Array;
  shadow: Float32Array;
}

const RGB_BASE = new Float32Array(3);
const RGB_SHADOW = new Float32Array(3);
const RGB_TMP = new Float32Array(3);

/** Zero the scratch masks over one tile only — full clears would dominate cost. */
function clearScratch(sc: Scratch, size: number, r: Rect): void {
  for (let y = 0; y < r.h; y++) {
    const row = ((r.y + y) | 0) * size + r.x;
    sc.groove.fill(0, row, row + r.w);
    sc.lip.fill(0, row, row + r.w);
    sc.rivet.fill(0, row, row + r.w);
    sc.shadow.fill(0, row, row + r.w);
  }
}

/**
 * Lay the base paint: flat colour with a faint orange-peel so the plate is
 * never mathematically flat, plus the roughness/metalness the class needs.
 */
function fillBase(
  s: Surface, r: Rect, hex: string, seed: number,
  roughness: number, metalness: number, teamMask: number, peelAmount = 1,
): void {
  hexToRgb(hex, RGB_TMP);
  const size = s.size;
  const f = 6 / r.w;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
      const peel = fbm2(x * f, y * f, 3, 2, 0.5, seed) * 0.5 + 0.5;
      const v = 1 + (peel - 0.5) * 0.09 * peelAmount;
      const o = i * 3;
      s.albedo[o] = clamp01(RGB_TMP[0] * v);
      s.albedo[o + 1] = clamp01(RGB_TMP[1] * v);
      s.albedo[o + 2] = clamp01(RGB_TMP[2] * v);
      s.height[i] = 0.56 + peel * 0.04;
      s.roughness[i] = clamp01(roughness + (peel - 0.5) * 0.05);
      s.metalness[i] = metalness;
      s.ao[i] = 1;
      s.alpha[i] = 1;
      s.teamMask[i] = teamMask;
      s.emissive[i] = 0;
    }
  }
}

/**
 * Fold the scratch masks into the surface. THIS is where bible 5.5's cavity
 * ruling is implemented: recess albedo = base x 0.32 driven toward the shadow
 * tint, a 1 px lighter lip on the sun side of every groove, and the crease AO
 * that 3.3 says must be baked rather than screen-space.
 */
function composite(s: Surface, sc: Scratch, r: Rect, shadowHex: string, reliefScale = 1): void {
  hexToRgb(shadowHex, RGB_SHADOW);
  const size = s.size;
  const cav = UNIT_GREEBLE.cavityMultiplier;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) | 0) * size + ((r.x + x) | 0);
      const g = sc.groove[i], l = sc.lip[i], rv = sc.rivet[i], sh = sc.shadow[i];
      if (g === 0 && l === 0 && rv === 0 && sh === 0) continue;
      const o = i * 3;
      // Cavity: darken toward the shadow tint, never toward pure black.
      const dark = clamp01(g * 0.92 + sh * 0.55);
      for (let c = 0; c < 3; c++) {
        const base = s.albedo[o + c];
        const recess = lerp(base * cav, RGB_SHADOW[c] * 0.9, 0.35);
        let v = lerp(base, recess, dark);
        // Sun-side lip and rivet dome catch the key: +22% value.
        v = clamp01(v * (1 + l * 0.34 + rv * 0.44));
        s.albedo[o + c] = v;
      }
      s.height[i] = clamp01(s.height[i] - g * 0.30 * reliefScale + l * 0.06 + rv * 0.24 * reliefScale);
      s.ao[i] = clamp01(s.ao[i] - dark * 0.55);
      // Grooves are marginally rougher than the surrounding paint.
      s.roughness[i] = clamp01(s.roughness[i] + g * 0.06 - l * 0.03);
    }
  }
}

/**
 * THE BEVEL HIGHLIGHT (bible 5.5, scorecard #11).
 *
 * "A hand-painted lighter band along the top edge of each bevel — base albedo
 * +22% V, -15% S." A greyscale vertex multiplier can raise value but can never
 * DESATURATE, so the highlight is baked here instead: each tile reserves a
 * patch painted in its own colour, pre-lifted and pre-desaturated, and every
 * chamfer strip in UnitFactory samples that patch. The band is therefore
 * exactly the bible's colour on team slabs, on olive paint and on bare metal
 * alike, with no per-part shader work.
 *
 * Lerping toward (V,V,V) by 0.15 scales HSV saturation by exactly 0.85, because
 * S = (V - min)/V and only `min` moves.
 */
function clearBevelPatch(s: Surface, r: Rect, hex: string): void {
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
      s.height[i] = 0.56;
      s.ao[i] = 1;
      s.emissive[i] = 0;
    }
  }
}

/**
 * Panel-line field. Long parallel runs along the tile's long axis plus 2-4
 * cross-cuts. The spacing is WALKED with jitter rather than stepped, because a
 * uniform grid is the single loudest procedural tell (bible 5.5).
 */
function panelLines(
  sc: Scratch, size: number, r: Rect, rng: Rng, runs: number, crossCuts: number, width: number,
): void {
  const lip = Math.max(1, width * 0.5);
  // Long runs.
  let y = r.h * rng.range(0.05, 0.14);
  for (let n = 0; n < runs && y < r.h * 0.96; n++) {
    // Runs are broken: RA3 panels are plates, not full-width scores.
    const x0 = rng.chance(0.42) ? r.w * rng.range(0.0, 0.28) : 0;
    const x1 = rng.chance(0.42) ? r.w * rng.range(0.66, 1.0) : r.w;
    rline(sc.groove, size, r, x0, y, x1, y, width, 0.95);
    rline(sc.lip, size, r, x0, y + width + 0.5, x1, y + width + 0.5, lip, 0.85);
    y += r.h * rng.range(0.055, 0.16);
  }
  // Cross-cuts.
  for (let n = 0; n < crossCuts; n++) {
    const x = r.w * ((n + rng.range(0.25, 0.75)) / crossCuts);
    const ya = r.h * rng.range(0.0, 0.25);
    const yb = r.h * rng.range(0.75, 1.0);
    rline(sc.groove, size, r, x, ya, x, yb, width, 0.95);
    rline(sc.lip, size, r, x + width + 0.5, ya, x + width + 0.5, yb, lip, 0.7);
  }
}

/** Rivet rows along the horizontal seams. Soviet signature (bible: Soviet 6). */
function rivetRows(
  sc: Scratch, size: number, r: Rect, rng: Rng, rows: number, pitch: number, radius: number,
): void {
  for (let n = 0; n < rows; n++) {
    const y = r.h * ((n + 0.5) / rows) + rng.range(-2, 2);
    // ~60% of visible edges carry rivets, per the measured reference.
    if (rng.chance(0.4)) continue;
    for (let x = pitch * 0.5; x < r.w; x += pitch) {
      const jx = x + rng.range(-0.6, 0.6);
      rdisc(sc.rivet, size, r, jx, y, radius, 1.0);
      // The dark under-shadow is what makes a rivet read as proud, not printed.
      rdisc(sc.shadow, size, r, jx, y - radius * 0.95, radius * 0.85, 0.75);
    }
  }
}

/** A recessed access hatch: rim groove, raised lid, bolt ring, grab handle. */
function hatch(sc: Scratch, size: number, r: Rect, cx: number, cy: number, rad: number, bolts: number): void {
  const steps = 28;
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * TAU, b = ((s + 1) / steps) * TAU;
    rline(sc.groove, size, r,
      cx + Math.cos(a) * rad, cy + Math.sin(a) * rad,
      cx + Math.cos(b) * rad, cy + Math.sin(b) * rad, Math.max(1.2, rad * 0.09), 0.95);
    rline(sc.lip, size, r,
      cx + Math.cos(a) * rad * 0.9, cy + Math.sin(a) * rad * 0.9,
      cx + Math.cos(b) * rad * 0.9, cy + Math.sin(b) * rad * 0.9, Math.max(1, rad * 0.05), 0.7);
  }
  for (let i = 0; i < bolts; i++) {
    const a = (i / bolts) * TAU + 0.2;
    rdisc(sc.rivet, size, r, cx + Math.cos(a) * rad * 0.74, cy + Math.sin(a) * rad * 0.74, Math.max(1.2, rad * 0.11), 0.9);
  }
  rline(sc.rivet, size, r, cx - rad * 0.34, cy, cx + rad * 0.34, cy, Math.max(1, rad * 0.08), 0.8);
  rline(sc.shadow, size, r, cx - rad * 0.34, cy - rad * 0.14, cx + rad * 0.34, cy - rad * 0.14, Math.max(1, rad * 0.07), 0.6);
}

/** Louvre stack. Cooling vents are the cheapest legible greeble there is. */
function louvres(sc: Scratch, size: number, r: Rect, x: number, y: number, w: number, h: number, count: number): void {
  const pitch = h / count;
  const t = Math.max(1.4, pitch * 0.34);
  for (let i = 0; i < count; i++) {
    const ly = y + (i + 0.5) * pitch;
    rline(sc.groove, size, r, x, ly, x + w, ly, t, 1.0);
    rline(sc.lip, size, r, x, ly + t + 0.5, x + w, ly + t + 0.5, Math.max(1, t * 0.4), 0.9);
  }
  rroundRect(sc.groove, size, r, x - 2, y - 2, w + 4, h + 4, 3, 1.4, 0.8);
}

/* ==========================================================================
 * 5. TILE PAINTING — one function per slot
 * ========================================================================== */

function paintTile(
  s: Surface, sc: Scratch, spec: GreebleSpec, slot: SlotName, density: number, salt: number,
): void {
  const r = tileRect(slot, s.size);
  const rng = new Rng(spec.seed + salt);
  clearScratch(sc, s.size, r);
  fillBase(s, r, spec.basePaint, spec.seed + salt, UNIT_MATERIAL.paintRoughness, 0, 1);

  const width = Math.max(1.2, r.w * UNIT_GREEBLE.panelLineWidthFraction);
  const runs = Math.max(1, Math.round(density * spec.panelDensity));
  const cross = Math.max(1, Math.round(density * 0.28));
  panelLines(sc, s.size, r, rng, runs, cross, width);

  if (density >= 8) {
    hatch(sc, s.size, r, r.w * rng.range(0.62, 0.78), r.h * rng.range(0.60, 0.76), r.w * 0.11, 8);
    louvres(sc, s.size, r, r.w * 0.10, r.h * 0.62, r.w * 0.26, r.h * 0.24, 5);
    // A pair of stand-off blisters: 3D-reading greebles at zero geometry cost.
    rdisc(sc.rivet, s.size, r, r.w * 0.30, r.h * 0.24, r.w * 0.045, 0.85, 0.55);
    rdisc(sc.rivet, s.size, r, r.w * 0.40, r.h * 0.24, r.w * 0.045, 0.85, 0.55);
  } else if (density >= 5) {
    hatch(sc, s.size, r, r.w * rng.range(0.60, 0.76), r.h * rng.range(0.24, 0.40), r.w * 0.13, 6);
  }

  if (spec.rivets && density >= 4) {
    rivetRows(sc, s.size, r, rng, Math.max(2, Math.round(density * 0.4)), spec.rivetPitchPx, Math.max(1.7, r.w * 0.020));
  }

  composite(s, sc, r, spec.paintShadow);
  clearBevelPatch(s, r, spec.basePaint);
}

/**
 * TEAM SLAB. R-T2: a flat solid panel insert let into the hull — not a
 * gradient, not a tint. It gets a recessed border so it reads as an inserted
 * plate, one bright top lip, and nothing else. teamMask = 1 across the tile so
 * a future per-instance tint shader can drive it, but the colour is already
 * correct with no shader at all.
 */
function paintTeamSlab(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('teamSlab', s.size);
  clearScratch(sc, s.size, r);
  // R-T2: a flat solid panel insert. Orange-peel is cut to a fifth so the slab
  // reads as painted sheet, not as a mottled camo blotch.
  fillBase(s, r, spec.teamColor, spec.seed + 11, UNIT_MATERIAL.paintRoughness, 0, 1, 0.20);
  const inset = r.w * 0.06;
  rroundRect(sc.groove, s.size, r, inset, inset, r.w - inset * 2, r.h - inset * 2, r.w * 0.06,
    Math.max(1.4, r.w * 0.018), 1.0);
  rline(sc.lip, s.size, r, inset + 2, r.h - inset - 2.5, r.w - inset - 2, r.h - inset - 2.5,
    Math.max(1, r.w * 0.012), 0.9);
  if (spec.rivets) {
    const rr = Math.max(1.4, r.w * 0.017);
    for (const [x, y] of [
      [inset * 1.9, inset * 1.9], [r.w - inset * 1.9, inset * 1.9],
      [inset * 1.9, r.h - inset * 1.9], [r.w - inset * 1.9, r.h - inset * 1.9],
    ] as const) {
      rdisc(sc.rivet, s.size, r, x, y, rr, 0.9);
      rdisc(sc.shadow, s.size, r, x, y - rr, rr * 0.8, 0.5);
    }
  }
  composite(s, sc, r, spec.paintShadow);
  clearBevelPatch(s, r, spec.teamColor);
}

/** INSIGNIA. Exactly one per unit (R-T4); the factory enforces the count. */
function paintInsignia(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('insignia', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, spec.basePaint, spec.seed + 12, UNIT_MATERIAL.paintRoughness, 0, 0, 0.35);

  const cx = r.w * 0.5, cy = r.h * 0.5;
  const field = r.w * 0.40;

  // The insignia is painted directly into albedo — it is a decal, not relief.
  const paintShape = (pts: readonly (readonly [number, number])[], hex: string) => {
    const mask = sc.rivet; // reuse a scratch channel as a coverage mask
    mask.fill(0, r.y * s.size, (r.y + r.h) * s.size);
    rpoly(mask, s.size, r, pts, 1);
    hexToRgb(hex, RGB_TMP);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = ((r.y + y) | 0) * s.size + ((r.x + x) | 0);
        const m = mask[i];
        if (m <= 0.001) continue;
        const o = i * 3;
        s.albedo[o] = lerp(s.albedo[o], RGB_TMP[0], m);
        s.albedo[o + 1] = lerp(s.albedo[o + 1], RGB_TMP[1], m);
        s.albedo[o + 2] = lerp(s.albedo[o + 2], RGB_TMP[2], m);
      }
    }
    mask.fill(0, r.y * s.size, (r.y + r.h) * s.size);
  };

  const disc = (radius: number, hex: string) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * TAU;
      pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
    paintShape(pts, hex);
  };

  if (spec.insignia === 'star') {
    disc(field, spec.teamSecondary);
    paintShape(starPoints(cx, cy, field * 0.82, field * 0.34, 5, -Math.PI * 0.5), spec.insigniaColor);
  } else if (spec.insignia === 'eagle') {
    disc(field, spec.teamSecondary);
    // A stylised eagle: swept wings + a wedge body. Reads at 12 px.
    const w = field * 0.92, h = field * 0.62;
    paintShape([
      [cx - w, cy + h * 0.30], [cx - w * 0.30, cy + h * 0.10], [cx, cy + h * 0.42],
      [cx + w * 0.30, cy + h * 0.10], [cx + w, cy + h * 0.30],
      [cx + w * 0.34, cy - h * 0.12], [cx, cy - h * 0.02],
      [cx - w * 0.34, cy - h * 0.12],
    ], spec.insigniaColor);
    paintShape([
      [cx - field * 0.16, cy + h * 0.16], [cx + field * 0.16, cy + h * 0.16],
      [cx, cy - field * 0.80],
    ], spec.insigniaColor);
  }

  // A recessed retaining ring so the decal sits in a plate, not floating.
  const steps = 40;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU, b = ((i + 1) / steps) * TAU;
    rline(sc.groove, s.size, r,
      cx + Math.cos(a) * field * 1.16, cy + Math.sin(a) * field * 1.16,
      cx + Math.cos(b) * field * 1.16, cy + Math.sin(b) * field * 1.16,
      Math.max(1.2, r.w * 0.016), 0.9);
  }
  composite(s, sc, r, spec.paintShadow);
  clearBevelPatch(s, r, spec.basePaint);
}

/**
 * EMISSIVE. Bible 8.1 wants emissive AREA tiny and value high, and the
 * foundation's warning is explicit: 2.6 over a whole surface veils the frame.
 * So the tile is mostly dark bezel and the glowing rounded rect covers
 * EMISSIVE_TILE_COVER of it; the unit-level fraction is that times the plate
 * area, which the validator holds to 1-3% of hull surface.
 */
const EMISSIVE_TILE_COVER = 0.42;

function paintEmissive(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('emissive', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, '#1A1E22', spec.seed + 13, 0.62, 0.1, 0, 0.25);

  hexToRgb(spec.emissiveColor, RGB_TMP);
  // Panel geometry chosen so the lit area is EMISSIVE_TILE_COVER of the tile.
  const pw = r.w * 0.80, ph = r.h * (EMISSIVE_TILE_COVER / 0.80);
  const px = (r.w - pw) * 0.5, py = (r.h - ph) * 0.5;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) | 0) * s.size + ((r.x + x) | 0);
      const inside =
        smoothstep(px - 1.5, px + 1.5, x) * smoothstep(px + pw + 1.5, px + pw - 1.5, x) *
        smoothstep(py - 1.5, py + 1.5, y) * smoothstep(py + ph + 1.5, py + ph - 1.5, y);
      if (inside <= 0.002) continue;
      const o = i * 3;
      s.albedo[o] = lerp(s.albedo[o], RGB_TMP[0], inside);
      s.albedo[o + 1] = lerp(s.albedo[o + 1], RGB_TMP[1], inside);
      s.albedo[o + 2] = lerp(s.albedo[o + 2], RGB_TMP[2], inside);
      s.emissive[i] = inside;
      s.roughness[i] = 0.30;
      s.teamMask[i] = 0;
    }
  }
  rroundRect(sc.groove, s.size, r, px - 3, py - 3, pw + 6, ph + 6, 4, Math.max(1.4, r.w * 0.02), 1.0);
  composite(s, sc, r, '#0A0C0E');
  clearBevelPatch(s, r, '#1A1E22');
}

/** GLASS. 1-3% of surface; roughness 0.10 comes from the ORM map. */
function paintGlass(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('glass', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, spec.glass, spec.seed + 14, UNIT_MATERIAL.glassRoughness, 0, 0);
  // Two soft reflection bands so a canopy is never a flat dark rectangle.
  for (const [y, a] of [[0.68, 0.55], [0.44, 0.28]] as const) {
    rline(sc.lip, s.size, r, r.w * 0.06, r.h * y, r.w * 0.94, r.h * (y + 0.04), r.h * 0.045, a);
  }
  rroundRect(sc.groove, s.size, r, 3, 3, r.w - 6, r.h - 6, r.w * 0.10, Math.max(1.6, r.w * 0.024), 1.0);
  composite(s, sc, r, '#05080C', 0.5);
  clearBevelPatch(s, r, spec.glass);
}

/**
 * BARE METAL. Barrels, rollers, pistons. Warm grey-brown at S <= 0.26 — bible
 * 5.4 is explicit that blue steel is wrong for RA3.
 */
function paintBareMetal(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('bareMetal', s.size);
  clearScratch(sc, s.size, r);
  hexToRgb(spec.bareMetal, RGB_TMP);
  const f = 9 / r.w;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) | 0) * s.size + ((r.x + x) | 0);
      // Stretched along X so it reads as turned metal rather than grey noise.
      const grain = fbm2(x * f * 0.2, y * f * 9, 4, 2, 0.55, spec.seed + 15);
      const v = 0.86 + grain * 0.22;
      const o = i * 3;
      s.albedo[o] = clamp01(RGB_TMP[0] * v);
      s.albedo[o + 1] = clamp01(RGB_TMP[1] * v);
      s.albedo[o + 2] = clamp01(RGB_TMP[2] * v);
      s.height[i] = 0.5 + grain * 0.08;
      s.roughness[i] = clamp01(UNIT_MATERIAL.bareMetalRoughness + grain * 0.10);
      s.metalness[i] = UNIT_MATERIAL.bareMetalMetalness;
      s.ao[i] = 1; s.alpha[i] = 1; s.teamMask[i] = 0; s.emissive[i] = 0;
    }
  }
  // Machined rings: what makes a cylinder read as a BARREL and not a tube.
  const rng = new Rng(spec.seed + 15);
  for (let n = 0; n < 5; n++) {
    const y = r.h * ((n + rng.range(0.2, 0.8)) / 5);
    rline(sc.groove, s.size, r, 0, y, r.w, y, Math.max(1.2, r.w * 0.016), 0.9);
    rline(sc.lip, s.size, r, 0, y + 2, r.w, y + 2, 1, 0.8);
  }
  composite(s, sc, r, '#241C14');
  clearBevelPatch(s, r, spec.bareMetal);
}

/** TREAD. Near-black chevron links (bible 5.4: #030607 -> #281A11). */
function paintTread(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('tread', s.size);
  clearScratch(sc, s.size, r);
  // Bible 5.4: track links run #030607 -> #281A11. The base is the dark end;
  // the chevron lip lifts the proud links toward the brown one.
  hexToRgb(spec.trackLink, RGB_TMP);
  const dark = `#${[0, 1, 2].map((c) => Math.round(RGB_TMP[c] * 255 * 0.34).toString(16).padStart(2, '0')).join('')}`;
  fillBase(s, r, dark, spec.seed + 16, 0.90, 0.35, 0, 0.4);
  const links = 9;
  const pitch = r.h / links;
  for (let i = 0; i < links; i++) {
    const y = i * pitch;
    // Chevron block: two strokes meeting at the centreline.
    rline(sc.lip, s.size, r, r.w * 0.10, y + pitch * 0.18, r.w * 0.5, y + pitch * 0.62, pitch * 0.17, 0.9);
    rline(sc.lip, s.size, r, r.w * 0.90, y + pitch * 0.18, r.w * 0.5, y + pitch * 0.62, pitch * 0.17, 0.9);
    rline(sc.groove, s.size, r, 0, y, r.w, y, Math.max(1.4, pitch * 0.13), 1.0);
  }
  // Guide horns down the centre.
  for (let i = 0; i < links; i++) rdisc(sc.rivet, s.size, r, r.w * 0.5, i * pitch + pitch * 0.5, pitch * 0.16, 0.8);
  composite(s, sc, r, '#020507', 1.4);
  clearBevelPatch(s, r, spec.trackLink);
}

/** VENT. A full tile of louvres for engine decks and radiator faces. */
function paintVent(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('vent', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, spec.basePaint, spec.seed + 17, UNIT_MATERIAL.paintRoughness + 0.06, 0.15, 0);
  louvres(sc, s.size, r, r.w * 0.08, r.h * 0.10, r.w * 0.84, r.h * 0.80, 9);
  if (spec.rivets) {
    const rr = Math.max(1.3, r.w * 0.015);
    for (let x = r.w * 0.10; x < r.w * 0.92; x += spec.rivetPitchPx) {
      rdisc(sc.rivet, s.size, r, x, r.h * 0.055, rr, 0.85);
      rdisc(sc.rivet, s.size, r, x, r.h * 0.945, rr, 0.85);
    }
  }
  composite(s, sc, r, spec.paintShadow, 1.3);
  clearBevelPatch(s, r, spec.basePaint);
}

/** HATCH. A whole tile given to one big bolted access panel. */
function paintHatch(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('hatch', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, spec.basePaint, spec.seed + 18, UNIT_MATERIAL.paintRoughness, 0, 1);
  hatch(sc, s.size, r, r.w * 0.5, r.h * 0.5, r.w * 0.34, 10);
  rroundRect(sc.groove, s.size, r, r.w * 0.06, r.h * 0.06, r.w * 0.88, r.h * 0.88, r.w * 0.08,
    Math.max(1.3, r.w * 0.016), 0.85);
  composite(s, sc, r, spec.paintShadow, 1.2);
  clearBevelPatch(s, r, spec.basePaint);
}

/** STRIPE. 45-degree hazard chevrons. Used sparingly, on ramps and lips. */
function paintStripe(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('stripe', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, '#22242A', spec.seed + 19, UNIT_MATERIAL.paintRoughness, 0, 0);
  hexToRgb(spec.hazard, RGB_TMP);
  const band = r.w * 0.16;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) | 0) * s.size + ((r.x + x) | 0);
      const t = ((x + y) % (band * 2)) / (band * 2);
      const on = t < 0.5 ? 1 : 0;
      if (!on) continue;
      const o = i * 3;
      s.albedo[o] = RGB_TMP[0]; s.albedo[o + 1] = RGB_TMP[1]; s.albedo[o + 2] = RGB_TMP[2];
    }
  }
  rroundRect(sc.groove, s.size, r, 2, 2, r.w - 4, r.h - 4, 3, Math.max(1.2, r.w * 0.015), 0.9);
  composite(s, sc, r, '#101216');
  clearBevelPatch(s, r, spec.hazard);
}

/** STENCIL. Four-digit hull number plus a service caption bar. */
function paintStencil(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('stencil', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, spec.basePaint, spec.seed + 20, UNIT_MATERIAL.paintRoughness, 0, 1);

  const mask = sc.rivet;
  const px = Math.max(2, Math.round(r.w / 26));
  const digits = [
    Math.floor(spec.hullNumber / 1000) % 10,
    Math.floor(spec.hullNumber / 100) % 10,
    Math.floor(spec.hullNumber / 10) % 10,
    spec.hullNumber % 10,
  ];
  const glyphW = px * 4;
  const x0 = (r.w - glyphW * digits.length) * 0.5;
  const y0 = r.h * 0.52;
  for (let i = 0; i < digits.length; i++) rdigit(mask, s.size, r, digits[i], x0 + i * glyphW, y0, px, 1);
  // A caption bar under the number: dash-dot-dash, reads as stencilled text.
  for (let i = 0; i < 7; i++) {
    const w = (i & 1) ? px : px * 2;
    rfill(mask, s.size, r, x0 + i * px * 2.4, r.h * 0.30, w, px, 1);
  }

  hexToRgb(spec.stencil, RGB_TMP);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) | 0) * s.size + ((r.x + x) | 0);
      const m = mask[i];
      if (m <= 0.001) continue;
      const o = i * 3;
      s.albedo[o] = lerp(s.albedo[o], RGB_TMP[0], m);
      s.albedo[o + 1] = lerp(s.albedo[o + 1], RGB_TMP[1], m);
      s.albedo[o + 2] = lerp(s.albedo[o + 2], RGB_TMP[2], m);
      s.teamMask[i] = 0;
    }
  }
  mask.fill(0, r.y * s.size, (r.y + r.h) * s.size);

  const rng = new Rng(spec.seed + 20);
  panelLines(sc, s.size, r, rng, 3, 1, Math.max(1.2, r.w * UNIT_GREEBLE.panelLineWidthFraction));
  composite(s, sc, r, spec.paintShadow);
  clearBevelPatch(s, r, spec.basePaint);
}

/** GRILLE. Fine intake mesh. The highest-frequency tile in the atlas. */
function paintGrille(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('grille', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, '#2A2C30', spec.seed + 21, 0.68, 0.55, 0);
  const pitch = Math.max(4, r.w / 18);
  for (let y = pitch * 0.5; y < r.h; y += pitch) rline(sc.groove, s.size, r, 0, y, r.w, y, 1.5, 0.95);
  for (let x = pitch * 0.5; x < r.w; x += pitch) rline(sc.groove, s.size, r, x, 0, x, r.h, 1.5, 0.95);
  for (let y = pitch * 0.5; y < r.h; y += pitch) rline(sc.lip, s.size, r, 0, y + 1.6, r.w, y + 1.6, 0.9, 0.8);
  rroundRect(sc.groove, s.size, r, 2, 2, r.w - 4, r.h - 4, 3, Math.max(1.6, r.w * 0.022), 1.0);
  composite(s, sc, r, '#0C0E10', 1.5);
  clearBevelPatch(s, r, '#2A2C30');
}

/** RIVET PLATE. Soviet bolted armour: dense rows, few panel runs. */
function paintRivetPlate(s: Surface, sc: Scratch, spec: GreebleSpec): void {
  const r = tileRect('rivetPlate', s.size);
  clearScratch(sc, s.size, r);
  fillBase(s, r, spec.basePaint, spec.seed + 22, UNIT_MATERIAL.paintRoughness, 0, 1);
  const rng = new Rng(spec.seed + 22);
  panelLines(sc, s.size, r, rng, 3, 2, Math.max(1.3, r.w * UNIT_GREEBLE.panelLineWidthFraction));
  const rr = Math.max(1.8, r.w * 0.021);
  const pitch = spec.rivetPitchPx;
  for (let y = pitch * 0.6; y < r.h; y += pitch * 1.35) {
    for (let x = pitch * 0.6; x < r.w; x += pitch) {
      rdisc(sc.rivet, s.size, r, x, y, rr, 1.0);
      rdisc(sc.shadow, s.size, r, x, y - rr * 0.95, rr * 0.9, 0.75);
    }
  }
  composite(s, sc, r, spec.paintShadow);
  clearBevelPatch(s, r, spec.basePaint);
}

/* ==========================================================================
 * 6. METRICS — the build-time gate (scorecard #34)
 * ========================================================================== */

/**
 * Sobel |grad| > threshold coverage over an sRGB luminance image, restricted to
 * a slot's sampled sub-rect. Scorecard #34 wants 28-36% on units and treats
 * anything below 22% as "untextured primitives". This is the texture-space
 * proxy the factory gates on; the render-space check is the harness's job.
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

/* ==========================================================================
 * 7. PACKING + THE FACTORY
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
  /** Tangent-space XY + cavity in B + curvature in A. */
  normalMap: THREE.DataTexture;
  /** AO / roughness / metalness + emissive mask in alpha. */
  ormMap: THREE.DataTexture;
  /** Pre-multiplied emissive colour. */
  emissiveMap: THREE.DataTexture;
  /** Retained for build-time measurement; not uploaded. */
  surface: Surface;
  /** Sampled UV rect per slot. */
  uv: Record<SlotName, UvRect>;
  /** Flat patch per slot, sampled by chamfer strips. */
  bevelUv: Record<SlotName, UvRect>;
  metrics: {
    /** Sobel coverage over the four paint tiles, area-weighted equally. */
    paintEdgeCoverage: number;
    /** Sobel coverage over the whole atlas. */
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
    spec.panelDensity, spec.hullNumber,
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
    const sc: Scratch = {
      groove: new Float32Array(n),
      lip: new Float32Array(n),
      rivet: new Float32Array(n),
      shadow: new Float32Array(n),
    };

    // Four paint densities. The counts are the bible's "6-14 runs per major
    // hull face", scaled down for progressively smaller parts.
    paintTile(s, sc, spec, 'paintLarge', 12, 1);
    paintTile(s, sc, spec, 'paintMed', 7, 2);
    paintTile(s, sc, spec, 'paintSmall', 4, 3);
    paintTile(s, sc, spec, 'paintTiny', 2, 4);

    paintTeamSlab(s, sc, spec);
    paintInsignia(s, sc, spec);
    paintEmissive(s, sc, spec);
    paintGlass(s, sc, spec);
    paintBareMetal(s, sc, spec);
    paintTread(s, sc, spec);
    paintVent(s, sc, spec);
    paintHatch(s, sc, spec);
    paintStripe(s, sc, spec);
    paintStencil(s, sc, spec);
    paintGrille(s, sc, spec);
    paintRivetPlate(s, sc, spec);

    const relief = UNIT_GREEBLE.normalRelief;
    const map = makeTexture(packAlbedo(s), size, true, `${spec.key}.albedo`, this.anisotropy);
    const normalMap = makeTexture(packNormal(s, relief, UNIT_GREEBLE.cavityRadiusPx), size, false, `${spec.key}.normal`, this.anisotropy);
    const ormMap = makeTexture(packOrm(s), size, false, `${spec.key}.orm`, this.anisotropy);
    const emissiveMap = makeTexture(packEmissive(s, spec.emissiveColor), size, true, `${spec.key}.emissive`, 1);

    const uv = {} as Record<SlotName, UvRect>;
    const bevelUv = {} as Record<SlotName, UvRect>;
    for (const slot of SLOT_NAMES) {
      uv[slot] = slotUv(slot, size);
      bevelUv[slot] = slotBevelUv(slot, size);
    }

    let paintCoverage = 0;
    for (const slot of PAINT_SLOTS) paintCoverage += edgeCoverage(s, slot);
    paintCoverage /= PAINT_SLOTS.length;

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
      uv, bevelUv,
      metrics: {
        paintEdgeCoverage: paintCoverage,
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

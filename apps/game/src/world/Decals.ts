/**
 * ============================================================================
 * VOLTMARCH — src/world/Decals.ts
 * ============================================================================
 * POOLED, TERRAIN-CONFORMING GROUND DECALS.
 *
 * Tread marks, scorch, craters, oil, manholes, lamp pools and the print a track
 * leaves where it flattened somebody. Bible §8.10 puts
 * tread marks at the top of the "ground FX" list and it is right to: a tracked
 * unit that crosses a field and leaves nothing behind reads as a sprite gliding
 * over a photograph. Tread marks are the cheapest thing in the whole renderer
 * that makes the ground feel like a surface units are actually ON.
 *
 * THE THREE DECISIONS THAT SHAPE THIS FILE
 * ----------------------------------------
 * 1. **One mesh, one draw call, forever.** Every decal in the game is a slot in
 *    a single pre-allocated BufferGeometry. A slot owns (DECAL_GRID+1)^2
 *    vertices and DECAL_GRID^2*2 triangles. Spawning writes into typed arrays that already
 *    exist and marks a contiguous byte range dirty; nothing is ever allocated,
 *    no object is ever created, and the pool recycles oldest-first when it
 *    fills. At DECAL_POOL = 512 that is 36.9k triangles for the entire
 *    ground-detail layer.
 *
 * 2. **Conformed on the CPU at spawn, not in the vertex shader.** The obvious
 *    alternative is to upload the heightfield as a float texture and displace
 *    in the vertex shader. It is prettier on paper and worse in practice: it
 *    needs OES_texture_float_linear, it cannot be unit-tested without a GL
 *    context, and it costs a texture fetch per vertex per frame forever. A
 *    decal is 49 vertices and it moves exactly once — at spawn. Those
 *    `heightAt` calls are cheap, and the result is a plain static mesh.
 *
 * 3. **Multiply blending, not alpha blending.** Bible §8.10 is explicit that a
 *    tread mark "multiplies the ground by 0.72" rather than painting a flat
 *    brown over it. That one choice is why our tread marks stay correct in sun
 *    AND in shadow, on grass AND on tarmac, without a single per-surface
 *    variant: the decal darkens whatever is underneath by a ratio instead of
 *    replacing it with a colour that was authored for one lighting condition.
 *    Because the main pass is HDR, a tint ABOVE 1.0 brightens — which is how
 *    the daylight lamp pool of bible §6.3 is expressed with the same pipeline.
 *
 * FADE
 * ----
 * Age is evaluated in the fragment shader from a per-vertex spawn stamp and a
 * per-vertex lifetime, so a decal ages with zero CPU cost. A `life` of 0 means
 * permanent (manholes and authored road wear). Combat soot fades instead of
 * turning a fought-over base into a permanently black patch.
 * ============================================================================
 */

import * as THREE from 'three';
import { nodePath } from '../render/gpu-path';
import {
  DECAL_ATLAS_SIZE, DECAL_DARKEN_FLOOR, DECAL_GRID, DECAL_LIFT, DECAL_POOL,
  DECAL_SWEEP_PER_FRAME, GROUND_OVERLAY_DEPTH_BIAS_FACTOR,
  GROUND_OVERLAY_DEPTH_BIAS_UNITS,
  CRATER_DARKEN, CRATER_HALF_SIZE, LIGHT_POOL_HALF_SIZE, MANHOLE_HALF_SIZE,
  MAP_SIZE, OIL_DARKEN, OIL_HALF_SIZE, SCORCH_DARKEN, SCORCH_HALF_SIZE,
  SQUISH_DARKEN, SQUISH_HALF_SIZE, SQUISH_LIFE_SECONDS,
  TREAD_DARKEN, TREAD_HALF_LENGTH, TREAD_HALF_WIDTH, TREAD_LIFE_SECONDS,
  TREAD_PAVING_FALLOFF, TYRE_DARKEN, TYRE_HALF_WIDTH,
} from '../core/config';
import { clamp, clamp01, fbm2, smoothstep } from '../core/math';
import { applyShroudFactor } from '../render/FogOfWar';
import { LAYERS, RENDER_ORDER } from '../render/scene';

/* ==========================================================================
 * 1. KINDS AND THE ATLAS LAYOUT
 * ========================================================================== */

/**
 * Decal archetypes. The value IS the atlas tile index, so the fragment shader
 * needs no lookup table — it derives (col,row) from the number directly.
 */
export const enum DecalKind {
  /** Tracked-vehicle tread strip. Laid by movement, fades over 35 s. */
  Tread = 0,
  /** Wheeled-vehicle tyre mark. Fainter and narrower than a tread. */
  Tyre = 1,
  /** Explosion soot. Long-lived, then fades. */
  Scorch = 2,
  /** Impact crater: dark bowl with a brighter ejecta ring. */
  Crater = 3,
  /** Oil stain. Near depots and junctions. */
  Oil = 4,
  /** Soft dust smudge, for landing/skid puffs settling. */
  Dust = 5,
  /** Manhole cover. Road furniture, permanent. */
  Manhole = 6,
  /** Street-lamp light pool — the one decal that BRIGHTENS. */
  LightPool = 7,
  /** Meandering tarmac crack. Road wear. */
  Crack = 8,
  /** Resurfacing patch: a blotch +/-12% luminance. Road wear. */
  Patch = 9,
  /**
   * The mark a track leaves where it flattened somebody. Laid by `src/sim/Crush.ts`
   * through `world.vfx.decal`, oriented to the CRUSHER's heading.
   *
   * The verb shipped before the mark did: `unitsCrushed` moved, `FxKind.CrushSquish`
   * fired, `SFX.crush` played, and the ground was untouched — `core/types.ts` has
   * had a `DecalKind.Squish` since it was written and this enum had no counterpart,
   * so `vfx.system.ts` dropped every one of them on the floor.
   */
  Squish = 10,
  /** Oxide runoff and tracked-in iron around industrial structures. */
  Rust = 11,
  /** Broad service grime: old soil, soot and traffic gathered at a footprint. */
  Grime = 12,
  /** A readable 2-5 m mass of fallen leaves beneath temperate canopies. */
  LeafLitter = 13,
  /** Broad gravel and broken-stone scatter around rocks, ore and yard edges. */
  Gravel = 14,
  /** A few large paper scraps around civic and roadside activity. */
  PaperLitter = 15,
}

/** Atlas tiles per row/column. 4x4 = 16 slots, all used. */
const ATLAS_COLS = 4;
const ATLAS_TILE = DECAL_ATLAS_SIZE / ATLAS_COLS;

/** Vertices along one edge of a decal patch. */
const VERTS_PER_SIDE = DECAL_GRID + 1;
/** Vertices per decal slot. */
const VERTS_PER_DECAL = VERTS_PER_SIDE * VERTS_PER_SIDE;
/** Indices per decal slot. */
const INDICES_PER_DECAL = DECAL_GRID * DECAL_GRID * 6;

/**
 * Default multiply tint per kind, in LINEAR rgb. 1.0 is "leave the ground
 * alone"; below darkens, above brightens (valid because the main pass is HDR).
 */
const KIND_TINT: readonly (readonly [number, number, number])[] = [
  [TREAD_DARKEN, TREAD_DARKEN * 0.985, TREAD_DARKEN * 0.95],   // Tread — a hair warm
  [TYRE_DARKEN, TYRE_DARKEN * 0.99, TYRE_DARKEN * 0.97],       // Tyre
  [SCORCH_DARKEN * 0.92, SCORCH_DARKEN * 0.86, SCORCH_DARKEN * 0.80], // Scorch — soot is warm-black
  [CRATER_DARKEN, CRATER_DARKEN * 0.94, CRATER_DARKEN * 0.88], // Crater
  [OIL_DARKEN * 0.90, OIL_DARKEN * 0.92, OIL_DARKEN],          // Oil — cool
  [0.86, 0.85, 0.82],                                          // Dust
  [0.58, 0.58, 0.60],                                          // Manhole
  [1.30, 1.20, 0.94],                                          // LightPool — #E8D089, above 1
  // Crack and Patch are ROAD WEAR, and RA3's roads are clean. Both used to be
  // strong enough to read as damage — a 58%-dark crack is a gash, and the eye
  // reads a scatter of gashes on tarmac as noise, which is the exact failure
  // this pass exists to remove. A crack is a thin dark line you notice only
  // when you look for it; a patch is a barely-there change of tone.
  [0.66, 0.66, 0.68],                                          // Crack
  [0.94, 0.94, 0.95],                                          // Patch
  // Squish — pressed earth, a touch warm. NOT a red one: the only hues on this
  // ground are the ones already in the dirt, and `tools/metrics.mjs` scores hue
  // leakage. A crush mark is a dark stain, not a puddle.
  [SQUISH_DARKEN, SQUISH_DARKEN * 0.90, SQUISH_DARKEN * 0.86], // Squish
  [0.78, 0.48, 0.26],                                          // Rust — oxidised iron
  [0.67, 0.65, 0.58],                                          // Grime — old earth/soot
  [0.92, 0.55, 0.18],                                          // LeafLitter — dry ochre/brown
  [1.16, 1.10, 0.96],                                          // Gravel — sunlit broken stone
  [1.38, 1.32, 1.12],                                          // PaperLitter — faded off-white
];

/** Default lifetime in seconds. 0 = permanent. */
const KIND_LIFE: readonly number[] = [
  TREAD_LIFE_SECONDS, TREAD_LIFE_SECONDS * 0.8, 150, 240, 180, 14, 0, 0, 0, 0,
  SQUISH_LIFE_SECONDS, 0, 0, 0, 0, 0,
];

/* ==========================================================================
 * 2. THE PROCEDURAL ATLAS
 *
 * Painted into a plain Uint8Array — no canvas, no DOM, so it generates
 * identically in a browser, in a worker and in a vitest run. RGB carries the
 * multiply factor at half scale (0.5 == neutral 1.0, so the byte range covers
 * factors 0..2) and A carries coverage.
 *
 * THE NOISE RULE
 * --------------
 * A tile is 128 texels and a decal is 1-6 m across, so at the RTS camera one
 * texel is a fraction of a pixel. Anything in here with a period of a few
 * texels can therefore only ever resolve as static — which is precisely what
 * the first version of this atlas did: `value2` grit on the treads, `value2`
 * speck on the scorch, `value2` dots for crater ejecta, `value2` grain inside
 * the resurfacing patches, and four-to-five octave fbm warps whose top octaves
 * landed at two-texel wavelengths.
 *
 * Every one of those is gone. What is left is:
 *
 *   - CRISP GEOMETRY  — cleat bars, tyre ribs, manhole ticks, ejecta rays, the
 *                       drag streaks off a crush print, drawn as exact functions
 *                       and smoothed over a fraction of their own period so they
 *                       cannot alias;
 *   - SOFT FALLOFF    — the radial windows that make a mark a mark;
 *   - OUTLINE WARP    — two octaves of fbm applied to the RADIUS, so a burn or
 *                       a slick has an irregular silhouette while its interior
 *                       stays perfectly smooth.
 *
 * If per-pixel noise is visible at gameplay zoom it is wrong, and on a decal
 * the whole tile is only a couple of hundred pixels — so the bar is high.
 * ========================================================================== */

/** Two pixels of transparent margin so bilinear filtering cannot bleed tiles. */
const TILE_INSET = 2 / ATLAS_TILE;

function buildDecalAtlas(): THREE.DataTexture {
  const N = DECAL_ATLAS_SIZE;
  const data = new Uint8Array(N * N * 4);

  /** Write one texel of a tile. `f` is the multiply factor, `a` the coverage. */
  const put = (
    tile: number, lx: number, ly: number,
    fr: number, fg: number, fb: number, a: number,
  ): void => {
    const ox = (tile % ATLAS_COLS) * ATLAS_TILE;
    const oy = ((tile / ATLAS_COLS) | 0) * ATLAS_TILE;
    const o = ((oy + ly) * N + ox + lx) * 4;
    data[o] = clamp(Math.round(fr * 127.5), 0, 255);
    data[o + 1] = clamp(Math.round(fg * 127.5), 0, 255);
    data[o + 2] = clamp(Math.round(fb * 127.5), 0, 255);
    data[o + 3] = clamp(Math.round(a * 255), 0, 255);
  };

  const T = ATLAS_TILE;
  const inv = 1 / (T - 1);
  const oval = (
    x: number, y: number, cx: number, cy: number, rx: number, ry: number,
  ): number => 1 - smoothstep(0.72, 1.0, Math.hypot((x - cx) / rx, (y - cy) / ry));
  const scrap = (
    x: number, y: number, cx: number, cy: number,
    halfW: number, halfH: number, yaw: number,
  ): number => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const dx = x - cx, dy = y - cy;
    const bx = Math.abs(dx * c + dy * s) / halfW;
    const by = Math.abs(-dx * s + dy * c) / halfH;
    return 1 - smoothstep(0.82, 1.0, Math.max(bx, by));
  };

  for (let ly = 0; ly < T; ly++) {
    const v = ly * inv;
    for (let lx = 0; lx < T; lx++) {
      const u = lx * inv;
      // Signed centred coordinates, -1..1.
      const sx = u * 2 - 1;
      const sy = v * 2 - 1;
      const r = Math.hypot(sx, sy);
      // 2 px of guaranteed-empty margin on every tile.
      const margin = (lx < 2 || ly < 2 || lx >= T - 2 || ly >= T - 2) ? 0 : 1;

      /* -- 0: TREAD ----------------------------------------------------- */
      {
        // A tread mark is a FAINT DARKENING carrying a repeating cleat
        // pattern. It is not a scar and it is not noise: every term below is a
        // smooth or a crisp geometric function of the tile coordinates, and
        // the old per-texel `grit` term is gone. At 0.84 x 3.2 m and a 40
        // degree camera a tile texel is well under a pixel, so anything with a
        // per-texel period could only ever have resolved as static.
        const along = 1 - Math.abs(sy);
        const across = 1 - smoothstep(0.55, 1.0, Math.abs(sx));
        // Cleats, bent into the V a real track shoe leaves: the bar phase is
        // advanced by 0.18 of a period from the centre of the strip to its
        // edge. The bar edges get a fifth of a period of smoothing so that a
        // hard square wave cannot alias into a moire at distance.
        const phase = (v * 9 + Math.abs(sx) * 0.18) % 1;
        const cleat = 0.68 + 0.32
          * (smoothstep(0.0, 0.10, phase) - smoothstep(0.48, 0.58, phase));
        const a = clamp01(along * 1.35) * across * cleat * margin;
        // The rim of the track (thrown soil) is a touch lighter than the core.
        const rim = smoothstep(0.42, 0.78, Math.abs(sx)) * 0.22;
        put(DecalKind.Tread, lx, ly, 0.5 + rim, 0.5 + rim * 0.9, 0.5 + rim * 0.7, a);
      }

      /* -- 1: TYRE ------------------------------------------------------ */
      {
        const along = 1 - Math.abs(sy);
        const across = 1 - smoothstep(0.30, 0.95, Math.abs(sx));
        const phase = (u * 5) % 1;
        const tread = 0.82 + 0.18
          * (smoothstep(0.0, 0.12, phase) - smoothstep(0.44, 0.56, phase));
        put(DecalKind.Tyre, lx, ly, 0.5, 0.5, 0.5, clamp01(along * 1.3) * across * tread * margin);
      }

      /* -- 2: SCORCH ---------------------------------------------------- */
      {
        // Bible §8.10: 55% centre opacity feathering to 0 over the outer 35%,
        // with a faint lighter ring at 80% radius (ash, not soot).
        //
        // The fbm here is a DOMAIN WARP of the radius — it makes the outline
        // irregular and never touches the interior value. Two octaves at 2.4
        // puts the finest wobble at roughly 27 texels, so the silhouette is
        // lumpy at the scale of the whole mark rather than fizzing at the
        // scale of the texel. The old five-octave version plus a `speck` term
        // resolved to per-pixel salt over the entire burn.
        const warp = fbm2(u * 2.4, v * 2.4, 2, 2, 0.5, 401) * 0.26;
        const rr = clamp01(r + warp);
        const core = 1 - smoothstep(0.42, 1.0, rr);
        const ring = Math.exp(-((rr - 0.80) * (rr - 0.80)) / 0.006) * 0.35;
        const a = clamp01(core * 0.94 + ring * 0.5) * margin;
        // Ash ring reads lighter than the soot core.
        const f = 0.5 + ring * 0.34;
        put(DecalKind.Scorch, lx, ly, f, f * 0.98, f * 0.96, a);
      }

      /* -- 3: CRATER ---------------------------------------------------- */
      {
        const warp = fbm2(u * 2.8, v * 2.8, 2, 2, 0.5, 907) * 0.20;
        const rr = clamp01(r + warp);
        const bowl = 1 - smoothstep(0.10, 0.62, rr);
        const lip = Math.exp(-((rr - 0.66) * (rr - 0.66)) / 0.010);
        // Ejecta as ELEVEN RADIAL RAYS, not as a field of random dots. Thrown
        // material leaves streaks pointing away from the impact, and a smooth
        // angular function gives exactly that while staying band-limited: the
        // finest feature is a 1/11th-turn lobe, which is 30-odd texels wide
        // even at the tile edge.
        const ang = Math.atan2(sy, sx);
        const rays = 0.5 + 0.5 * Math.cos(ang * 11 + Math.cos(ang * 3) * 1.7);
        const ejecta = smoothstep(0.95, 0.66, rr) * rays * 0.55;
        const a = clamp01(bowl * 0.95 + lip * 0.7 + ejecta * 0.45) * margin;
        // Bowl darkens hard, the lip catches the sun and brightens slightly.
        const f = 0.5 - bowl * 0.16 + lip * 0.28;
        put(DecalKind.Crater, lx, ly, f, f * 0.97, f * 0.93, a);
      }

      /* -- 4: OIL ------------------------------------------------------- */
      {
        // Bible §6.3: 2-5 m ellipses at alpha 0.35. Irregular, not a disc —
        // and irregular means a WARPED OUTLINE, two octaves of it, not a
        // five-octave field that speckles the whole slick.
        const warp = fbm2(u * 2.2 + 3, v * 2.2, 2, 2, 0.5, 1301) * 0.38;
        const rr = clamp01(r * (0.86 + Math.abs(sx) * 0.22) + warp);
        const a = clamp01(1 - smoothstep(0.34, 0.92, rr)) * 0.9 * margin;
        // A slick is darker in the middle and has a faint bright fringe.
        const sheen = Math.exp(-((rr - 0.58) * (rr - 0.58)) / 0.012) * 0.30;
        put(DecalKind.Oil, lx, ly, 0.5 + sheen * 0.6, 0.5 + sheen * 0.4, 0.5 + sheen * 0.2, a);
      }

      /* -- 5: DUST ------------------------------------------------------ */
      {
        const warp = fbm2(u * 2.4, v * 2.4, 2, 2, 0.5, 77) * 0.28;
        const a = clamp01(1 - smoothstep(0.20, 0.98, clamp01(r + warp))) * 0.75 * margin;
        put(DecalKind.Dust, lx, ly, 0.5, 0.5, 0.5, a);
      }

      /* -- 6: MANHOLE --------------------------------------------------- */
      {
        const disc = 1 - smoothstep(0.80, 0.90, r);
        const rim = Math.exp(-((r - 0.83) * (r - 0.83)) / 0.0016) * 0.9;
        // 16 radial ticks so it reads as cast iron rather than a dark dot.
        const ang = Math.atan2(sy, sx);
        const tick = (((ang / Math.PI * 8) % 1 + 1) % 1) < 0.5 ? 1 : 0;
        const ticks = disc * smoothstep(0.30, 0.72, r) * tick * 0.35;
        const a = clamp01(disc * 0.92 + rim * 0.5) * margin;
        const f = 0.5 - ticks * 0.10 + rim * 0.18;
        put(DecalKind.Manhole, lx, ly, f, f, f * 1.02, a);
      }

      /* -- 7: LIGHT POOL ------------------------------------------------ */
      {
        // Bible §6.3: 6-8 m ellipse, #E8D089, alpha 0.25 — even in daylight.
        const a = clamp01(1 - smoothstep(0.0, 1.0, r)) * 0.55 * margin;
        put(DecalKind.LightPool, lx, ly, 0.5, 0.5, 0.5, a * a);
      }

      /* -- 8: CRACK ----------------------------------------------------- */
      {
        // Bible §6.3: cracks 0.03-0.08 m wide, meandering, +/-25 deg jitter.
        //
        // `wob` is the crack's PATH, a 1-D function of v, so cutting its top
        // octaves is the difference between a crack that meanders and one that
        // is serrated. Three octaves at 2.2 puts the finest kink at roughly 15
        // texels of travel, which is a wander; the old 7.7 x 3-octave term
        // kinked every two texels, which is a saw blade.
        const wob = fbm2(v * 2.2, 0.5, 3, 2, 0.55, 613) * 0.42;
        const wob2 = fbm2(v * 4.0, 2.5, 2, 2, 0.5, 811) * 0.10;
        const d = Math.abs(sx - wob - wob2);
        const branch = Math.abs(sx * 0.55 + 0.35 - wob * 1.6) * (v > 0.45 ? 1 : 4);
        const core = (1 - smoothstep(0.02, 0.075, d)) + (1 - smoothstep(0.02, 0.06, branch)) * 0.6;
        const taper = 1 - smoothstep(0.72, 1.0, Math.abs(sy));
        put(DecalKind.Crack, lx, ly, 0.5, 0.5, 0.5, clamp01(core) * taper * margin);
      }

      /* -- 9: PATCH ----------------------------------------------------- */
      {
        // Bible §6.3: resurfacing blotches 1.5-4.0 m at +/-12% luminance.
        // A patch is a FLAT area of slightly different tone with an irregular
        // outline — the `grain` term that used to sit inside it was per-texel
        // noise painted straight onto the road.
        const warp = fbm2(u * 2.0, v * 2.0, 2, 2, 0.5, 229) * 0.32;
        const a = clamp01(1 - smoothstep(0.42, 0.92, clamp01(r + warp))) * 0.85 * margin;
        put(DecalKind.Patch, lx, ly, 0.5, 0.5, 0.5, a);
      }

      /* -- 10: SQUISH ---------------------------------------------------- */
      {
        // WHAT THIS TILE HAS TO SAY: a track went over this spot, and what was
        // under it is now part of the ground. Every term is a drawn shape —
        // there is no noise field anywhere in here, and the one fbm call warps
        // the OUTLINE RADIUS exactly as Scorch and Oil do, two octaves at 2.1,
        // which puts the finest wobble around 30 texels. The interior is smooth
        // and the detail is geometry.
        //
        // The tile is authored with +v as the DIRECTION OF TRAVEL, and
        // `Crush.runDown` passes the crusher's yaw, so the mark lands aligned
        // with the tracks that made it and reads as one event with the tread
        // strips either side of it rather than as a blob dropped on the floor.
        const warp = fbm2(u * 2.1, v * 2.1, 2, 2, 0.5, 1777) * 0.24;
        // Longer than it is wide: a track presses a strip, not a disc.
        const rr = clamp01(Math.hypot(sx / 0.54, sy / 0.88) + warp);
        const pressed = 1 - smoothstep(0.52, 1.0, rr);
        // THE CLEAT RHYTHM, lifted term-for-term from the Tread tile (period 9,
        // phase advanced 0.18 across the strip, a fifth of a period of edge
        // smoothing so a square wave cannot moire at distance). Sharing it is
        // the point: the mark carries the same shoe pattern as the strips that
        // lead into it.
        const phase = (v * 9 + Math.abs(sx) * 0.18) % 1;
        const cleat = 0.70 + 0.30
          * (smoothstep(0.0, 0.10, phase) - smoothstep(0.48, 0.58, phase));
        // Two drag streaks flicking off the far end, in the travel direction.
        // Crisp tapered lines at ±0.30, ~0.08 of a tile wide — a handful of
        // pixels at gameplay zoom, which is a streak; any finer would be grit.
        const dStreak = Math.min(Math.abs(sx - 0.30), Math.abs(sx + 0.30));
        const streak = (1 - smoothstep(0.028, 0.105, dStreak))
          * smoothstep(0.40, 0.60, sy) * (1 - smoothstep(0.62, 0.99, sy));
        const a = clamp01(pressed * cleat * 0.95 + streak * 0.45) * margin;
        // The centre is where the weight went: darker there, with a faint
        // brighter fringe of soil pushed out to the edge of the print.
        const core = 1 - smoothstep(0.0, 0.46, rr);
        const fringe = Math.exp(-((rr - 0.88) * (rr - 0.88)) / 0.010) * 0.34;
        const f = 0.5 - core * 0.12 + fringe * 0.18;
        put(DecalKind.Squish, lx, ly, f, f * 0.99, f * 0.97, a);
      }

      /* -- 11: RUST RUNOFF ---------------------------------------------- */
      {
        // One pooled ground mark can imply years of weathering without adding
        // a second material to every building. The upper lobe collects beside
        // the wall and three tapered runs pull away from it. Every feature is
        // deliberately broad: at RTS distance this reads as oxidised runoff,
        // not orange pixel noise.
        const warp = fbm2(u * 2.0 + 7, v * 2.0, 2, 2, 0.5, 2111) * 0.20;
        const poolR = Math.hypot(sx / 0.82, (sy - 0.34) / 0.58) + warp;
        const pool = 1 - smoothstep(0.48, 1.0, poolR);
        const tailWindow = smoothstep(0.48, 0.12, sy) * smoothstep(-1.0, -0.28, sy);
        const runA = 1 - smoothstep(0.055, 0.18, Math.abs(sx + 0.34 + sy * 0.08));
        const runB = 1 - smoothstep(0.045, 0.15, Math.abs(sx - 0.02 - sy * 0.05));
        const runC = 1 - smoothstep(0.050, 0.17, Math.abs(sx - 0.39 + sy * 0.10));
        const runs = Math.max(runA * 0.72, runB, runC * 0.62) * tailWindow;
        const a = clamp01(pool * 0.88 + runs * 0.58) * margin;
        put(DecalKind.Rust, lx, ly, 0.5, 0.5, 0.5, a);
      }

      /* -- 12: SERVICE GRIME -------------------------------------------- */
      {
        // A low, asymmetric smear for loading aprons and the dead ground near
        // machinery. Two-octave outline warp only; the interior stays smooth
        // so the mark adds history and material variation rather than static.
        const warp = fbm2(u * 1.9, v * 1.9 + 4, 2, 2, 0.5, 2477) * 0.27;
        const rr = Math.hypot((sx + sy * 0.14) / 0.96, sy / 0.64) + warp;
        const body = 1 - smoothstep(0.34, 1.0, rr);
        const dragged = (1 - smoothstep(0.10, 0.46, Math.abs(sx + 0.42)))
          * (1 - smoothstep(0.15, 0.96, Math.abs(sy))) * 0.34;
        const a = clamp01(body * 0.78 + dragged) * margin;
        put(DecalKind.Grime, lx, ly, 0.5, 0.5, 0.5, a);
      }

      /* -- 13: LEAF LITTER ---------------------------------------------- */
      {
        // Nine broad leaf-shaped lobes form one 2-5 m readable mass. This is
        // deliberately not a carpet of alpha-card specks: every member is
        // large enough to survive normal RTS zoom, while the soft under-bed
        // binds them into one authored patch beneath a canopy.
        const bed = 1 - smoothstep(0.48, 1.0, Math.hypot(sx / 0.94, sy / 0.72));
        const leaves = Math.max(
          oval(sx, sy, -0.55, -0.18, 0.20, 0.10),
          oval(sx, sy, -0.24, 0.34, 0.18, 0.09),
          oval(sx, sy, 0.05, -0.42, 0.22, 0.11),
          oval(sx, sy, 0.34, 0.16, 0.19, 0.10),
          oval(sx, sy, 0.58, -0.25, 0.17, 0.09),
          oval(sx, sy, -0.42, 0.52, 0.15, 0.08),
          oval(sx, sy, 0.18, 0.55, 0.16, 0.08),
          oval(sx, sy, -0.05, 0.06, 0.24, 0.12),
          oval(sx, sy, 0.52, 0.48, 0.13, 0.07),
        );
        // The earlier 22% under-bed became an obvious translucent oval when
        // the pile was made readable. Keep only enough contact tone to bind
        // the leaves; the lobes themselves must own the silhouette.
        const a = clamp01(bed * 0.06 + leaves * 0.92) * margin;
        // A broad left-to-right value change gives the pile two colour masses
        // without introducing texture-frequency noise.
        const warm = clamp01(0.5 + sx * 0.28 - sy * 0.12);
        put(DecalKind.LeafLitter, lx, ly, 0.43 + warm * 0.13, 0.40 + warm * 0.08, 0.34, a);
      }

      /* -- 14: GRAVEL ---------------------------------------------------- */
      {
        // Eleven stones, each a broad asymmetric oval with a faint common
        // dust bed. At gameplay distance they read as a broken-stone cluster,
        // not as procedural salt-and-pepper noise.
        const bed = 1 - smoothstep(0.52, 1.0, Math.hypot(sx / 0.98, sy / 0.76));
        const stones = Math.max(
          oval(sx, sy, -0.62, -0.35, 0.21, 0.14),
          oval(sx, sy, -0.31, -0.04, 0.16, 0.11),
          oval(sx, sy, -0.50, 0.43, 0.18, 0.12),
          oval(sx, sy, -0.10, -0.50, 0.15, 0.10),
          oval(sx, sy, 0.02, 0.20, 0.22, 0.14),
          oval(sx, sy, 0.30, -0.23, 0.17, 0.12),
          oval(sx, sy, 0.55, 0.05, 0.20, 0.13),
          oval(sx, sy, 0.66, 0.48, 0.13, 0.09),
          oval(sx, sy, 0.23, 0.55, 0.16, 0.10),
          oval(sx, sy, -0.22, 0.62, 0.12, 0.08),
          oval(sx, sy, 0.47, -0.58, 0.11, 0.08),
        );
        const a = clamp01(bed * 0.05 + stones * 0.94) * margin;
        const lift = stones * (0.06 + clamp01(sx * 0.5 + 0.5) * 0.08);
        put(DecalKind.Gravel, lx, ly, 0.46 + lift, 0.46 + lift * 0.96, 0.45 + lift * 0.88, a);
      }

      /* -- 15: PAPER LITTER --------------------------------------------- */
      {
        // Six deliberately oversized scraps. Paper is a civic/roadside cue,
        // so it must remain countable and sparse instead of becoming white
        // screen-space flecks across the battlefield.
        const papers = Math.max(
          scrap(sx, sy, -0.58, -0.35, 0.17, 0.09, 0.28),
          scrap(sx, sy, -0.22, 0.30, 0.13, 0.08, -0.42),
          scrap(sx, sy, 0.12, -0.12, 0.16, 0.10, 0.18),
          scrap(sx, sy, 0.48, 0.34, 0.14, 0.08, 0.55),
          scrap(sx, sy, 0.60, -0.48, 0.12, 0.07, -0.22),
          scrap(sx, sy, -0.46, 0.62, 0.11, 0.07, 0.62),
        );
        // A faint dirt halo prevents the bright papers looking pasted on.
        const halo = (1 - smoothstep(0.54, 1.0, Math.hypot(sx / 0.96, sy / 0.82))) * 0.03;
        const a = clamp01(papers * 0.96 + halo) * margin;
        const paperTone = 0.54 + clamp01((sx - sy) * 0.35 + 0.5) * 0.08;
        put(DecalKind.PaperLitter, lx, ly, paperTone, paperTone * 0.98, paperTone * 0.88, a);
      }
    }
  }

  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'decal.atlas';
  // NOT sRGB: RGB here is a multiply factor, not a colour, so it must not be
  // decoded. The tint that IS a colour is per-decal and uploaded linear.
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/* ==========================================================================
 * 3. THE SHADER
 * ========================================================================== */

const DECAL_VERT = /* glsl */ `
attribute vec2  aUv;
attribute vec4  aParams;   // tile, spawnTime, life (0 = permanent), strength
attribute vec3  aTint;     // LINEAR multiply tint

varying vec2 vUv;
varying vec4 vParams;
varying vec3 vTint;

void main() {
  vUv = aUv;
  vParams = aParams;
  vTint = aTint;
  #include <begin_vertex>
  #include <project_vertex>
}
`;

const DECAL_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uAtlas;
uniform float uTime;
uniform float uCols;
/** Hard floor on the darkening factor. No decal may take the ground below it. */
uniform float uFloor;

varying vec2 vUv;
varying vec4 vParams;
varying vec3 vTint;

void main() {
  float life = vParams.z;
  float age  = max(uTime - vParams.y, 0.0);
  // life <= 0 means permanent (reserved for authored ambient marks).
  // Otherwise hold full strength to 55% of life, then ramp out. A linear fade
  // from t=0 makes fresh tracks look weak, which is the wrong read entirely.
  float fade = life <= 0.0 ? 1.0 : 1.0 - smoothstep(life * 0.55, life, age);
  if (fade <= 0.002) discard;

  // Clamp inside the tile so bilinear filtering can never sample a neighbour.
  vec2 t = clamp(vUv, ${TILE_INSET.toFixed(6)}, ${(1 - TILE_INSET).toFixed(6)});
  float col = mod(vParams.x, uCols);
  float row = floor(vParams.x / uCols);
  vec4 s = texture2D(uAtlas, (vec2(col, row) + t) / uCols);

  float a = s.a * vParams.w * fade;
  // RGB is a multiply factor stored at half scale, so 0.5 decodes to 1.0.
  vec3 factor = vTint * (s.rgb * 2.0);
  // Blend toward "leave the ground alone" by coverage, then never emit a
  // factor below the floor. The blend func is (DST_COLOR, ZERO), so what we
  // emit here multiplies the lit frame — and the floor is what stops a single
  // scorch from taking a square metre of terrain to black.
  gl_FragColor = vec4(max(mix(vec3(1.0), factor, a), vec3(uFloor)), 1.0);
  #include <tonemapping_fragment>
}
`;

/* ==========================================================================
 * 4. THE FIELD
 * ========================================================================== */

export interface DecalFieldOptions {
  scene: THREE.Scene;
  /** Ground sampler. Defaults to a flat y=0 plane. */
  heightAt?: (x: number, z: number) => number;
  /** Slots in the pool. Defaults to DECAL_POOL. */
  capacity?: number;
}

/** What `stats()` reports, for the F3 overlay and the boot log. */
export interface DecalStats {
  capacity: number;
  live: number;
  spawned: number;
  evicted: number;
  triangles: number;
}

export class DecalField {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.Material;
  /** Advances the fade clock. One call per frame, either backend. */
  private readonly setMaterialTime: (t: number) => void;
  private readonly atlas: THREE.DataTexture;
  private readonly scene: THREE.Scene;
  private readonly heightAt: (x: number, z: number) => number;

  /* -- the pool arrays (all pre-allocated, never grown) ------------------- */
  private readonly position: Float32Array;
  private readonly uvArr: Float32Array;
  private readonly params: Float32Array;
  private readonly tint: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;
  private readonly paramAttr: THREE.BufferAttribute;
  private readonly tintAttr: THREE.BufferAttribute;

  /** Wall time a slot was stamped, and its lifetime. Mirrors the attributes. */
  private readonly slotSpawn: Float32Array;
  private readonly slotLife: Float32Array;
  /** 1 while a slot holds a visible decal. */
  private readonly slotUsed: Uint8Array;

  /** Ring head — the next slot to claim. */
  private head = 0;
  private live = 0;
  private sweepCursor = 0;

  /** Dirty vertex range, in VERTICES. -1 means clean. */
  private dirtyLo = -1;
  private dirtyHi = -1;

  /** Reused update-range records. Pushing these allocates nothing. */
  private readonly ranges: { start: number; count: number }[] = [
    { start: 0, count: 0 }, { start: 0, count: 0 },
    { start: 0, count: 0 }, { start: 0, count: 0 },
  ];

  /** The field's own clock, advanced by `frame`. Decoupled from the sim. */
  private clock = 0;

  private spawnedTotal = 0;
  private evictedTotal = 0;

  constructor(options: DecalFieldOptions) {
    this.scene = options.scene;
    this.capacity = options.capacity ?? DECAL_POOL;
    this.heightAt = options.heightAt ?? (() => 0);

    const verts = this.capacity * VERTS_PER_DECAL;
    this.position = new Float32Array(verts * 3);
    this.uvArr = new Float32Array(verts * 2);
    this.params = new Float32Array(verts * 4);
    this.tint = new Float32Array(verts * 3);
    this.slotSpawn = new Float32Array(this.capacity);
    this.slotLife = new Float32Array(this.capacity);
    this.slotUsed = new Uint8Array(this.capacity);

    // The UV grid is identical for every slot and never changes, so fill it
    // once here and never touch it again.
    for (let s = 0; s < this.capacity; s++) {
      const base = s * VERTS_PER_DECAL;
      for (let iz = 0; iz < VERTS_PER_SIDE; iz++) {
        for (let ix = 0; ix < VERTS_PER_SIDE; ix++) {
          const v = (base + iz * VERTS_PER_SIDE + ix) * 2;
          this.uvArr[v] = ix / DECAL_GRID;
          this.uvArr[v + 1] = iz / DECAL_GRID;
        }
      }
    }

    // Index buffer: also fixed forever. A dead slot is collapsed to a point,
    // which turns its triangles degenerate and costs zero fragments.
    const indices = new Uint16Array(this.capacity * INDICES_PER_DECAL);
    let w = 0;
    for (let s = 0; s < this.capacity; s++) {
      const base = s * VERTS_PER_DECAL;
      for (let iz = 0; iz < DECAL_GRID; iz++) {
        for (let ix = 0; ix < DECAL_GRID; ix++) {
          const a = base + iz * VERTS_PER_SIDE + ix;
          const b = a + 1;
          const c = a + VERTS_PER_SIDE;
          const d = c + 1;
          indices[w++] = a; indices[w++] = c; indices[w++] = b;
          indices[w++] = b; indices[w++] = c; indices[w++] = d;
        }
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.position, 3);
    this.uvAttr = new THREE.BufferAttribute(this.uvArr, 2);
    this.paramAttr = new THREE.BufferAttribute(this.params, 4);
    this.tintAttr = new THREE.BufferAttribute(this.tint, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.paramAttr.setUsage(THREE.DynamicDrawUsage);
    this.tintAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aUv', this.uvAttr);
    this.geometry.setAttribute('aParams', this.paramAttr);
    this.geometry.setAttribute('aTint', this.tintAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    // The field spans the whole map; a computed sphere would be recomputed on
    // every spawn for no benefit, so pin it to the map bound once.
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(MAP_SIZE * 0.5, 4, MAP_SIZE * 0.5), MAP_SIZE * 0.75,
    );

    this.atlas = buildDecalAtlas();

    /*
     * `ShaderMaterial` IS NOT IN `StandardNodeLibrary`, and this one blends
     * `(DstColor, Zero)` — so under `WebGPURenderer` a bare `NodeMaterial`
     * would paint every scorch, crater and tread mark solid black.
     * `render/ground-overlay-nodes.ts` is the twin.
     */
    const np = nodePath();
    const glsl = np !== null ? null : new THREE.ShaderMaterial({
      name: 'GroundDecals',
      uniforms: {
        uAtlas: { value: this.atlas },
        uTime: { value: 0 },
        uCols: { value: ATLAS_COLS },
        uFloor: { value: DECAL_DARKEN_FLOOR },
      },
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
      toneMapped: false,
      fog: false,
      /*
       * MULTIPLY. src is a factor, dst is the lit frame — which is why the
       * factor must stay a FACTOR and the blend must stay a multiply: MIN would
       * clamp bright ground and dark ground to the same absolute value and
       * throw away the shading underneath the mark.
       *
       * What bounds it is `uFloor` in the fragment shader, so a single decal
       * can never take the ground below `DECAL_DARKEN_FLOOR` of its albedo.
       * Overlapping decals still compound (that is what a multiply is), which
       * is why the floor is set well above the raw SCORCH_DARKEN.
       *
       * Alpha is left alone so a decal can never punch a hole in a target that
       * carries coverage.
       */
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      // The decal lies close to the ground it is conformed to. The physical
      // lift clears terrain/roads; polygon offset is the remaining raster-depth
      // guard at grazing angles.
      polygonOffset: true,
      polygonOffsetFactor: GROUND_OVERLAY_DEPTH_BIAS_FACTOR,
      polygonOffsetUnits: GROUND_OVERLAY_DEPTH_BIAS_UNITS,
    });

    if (glsl !== null) {
      // Decals sit above the depth-tested shroud carpet. Their multiply factor
      // must become a no-op in fog or bright lamp pools punch visible holes.
      glsl.onBeforeCompile = (shader) => { applyShroudFactor(shader); };
      glsl.customProgramCacheKey = () => 'vm.decals.shroud-factor.v1';
      this.material = glsl;
      this.setMaterialTime = (t) => { glsl.uniforms.uTime.value = t; };
    } else {
      const set = np!.createDecalMaterial(this.atlas, ATLAS_COLS, TILE_INSET);
      this.material = set.material;
      this.setMaterialTime = (t) => set.setTime(t);
    }

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'GroundDecals';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = RENDER_ORDER.DECALS;
    this.mesh.layers.set(LAYERS.DEFAULT);
    this.scene.add(this.mesh);
  }

  /* ======================================================================
   * SPAWNING
   * ====================================================================== */

  /**
   * Stamp a decal. Returns the slot it landed in.
   *
   * Allocates NOTHING: every write lands in an array that already exists, and
   * a full pool recycles its oldest slot rather than growing. `life` of 0 is
   * permanent; a negative `tintR` means "use this kind's default tint".
   */
  spawn(
    kind: DecalKind, x: number, z: number,
    halfX: number, halfZ: number, yaw: number,
    life = -1, strength = 1,
    tintR = -1, tintG = 0, tintB = 0,
  ): number {
    const slot = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.slotUsed[slot] !== 0) this.evictedTotal++;
    else this.live++;
    this.slotUsed[slot] = 1;
    this.spawnedTotal++;

    const k = kind as number;
    const lifeSeconds = life >= 0 ? life : (KIND_LIFE[k] ?? 0);
    const t = KIND_TINT[k] ?? KIND_TINT[0];
    const tr = tintR >= 0 ? tintR : t[0];
    const tg = tintR >= 0 ? tintG : t[1];
    const tb = tintR >= 0 ? tintB : t[2];

    this.slotSpawn[slot] = this.clock;
    this.slotLife[slot] = lifeSeconds;

    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const base = slot * VERTS_PER_DECAL;

    for (let iz = 0; iz < VERTS_PER_SIDE; iz++) {
      // Local -halfZ..+halfZ along the decal's own forward axis.
      const lz = (iz / DECAL_GRID - 0.5) * 2 * halfZ;
      for (let ix = 0; ix < VERTS_PER_SIDE; ix++) {
        const lx = (ix / DECAL_GRID - 0.5) * 2 * halfX;
        const vi = base + iz * VERTS_PER_SIDE + ix;
        // yaw 0 faces +Z, matching the engine-wide convention in types.ts.
        const wx = x + lx * cos + lz * sin;
        const wz = z - lx * sin + lz * cos;
        const p = vi * 3;
        this.position[p] = wx;
        this.position[p + 1] = this.heightAt(wx, wz) + DECAL_LIFT;
        this.position[p + 2] = wz;
        const q = vi * 4;
        this.params[q] = k;
        this.params[q + 1] = this.clock;
        this.params[q + 2] = lifeSeconds;
        this.params[q + 3] = strength;
        const c = vi * 3;
        this.tint[c] = tr;
        this.tint[c + 1] = tg;
        this.tint[c + 2] = tb;
      }
    }

    this.markDirty(base, base + VERTS_PER_DECAL);
    return slot;
  }

  /**
   * Lay one pair of tread strips for a tracked vehicle at (x,z) facing `yaw`.
   * This is THE signature RA3 ground detail (bible §8.10) and the reason the
   * whole module exists.
   *
   * `gauge` is the distance between the two tracks; `paving` drops the strength
   * to TREAD_PAVING_FALLOFF because tarmac does not scar the way soil does.
   */
  layTread(x: number, z: number, yaw: number, gauge: number, paving = false, wheeled = false): void {
    const kind = wheeled ? DecalKind.Tyre : DecalKind.Tread;
    const halfW = wheeled ? TYRE_HALF_WIDTH : TREAD_HALF_WIDTH;
    const strength = paving ? TREAD_PAVING_FALLOFF : 1;
    const half = gauge * 0.5;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // Offset perpendicular to the heading. yaw 0 faces +Z, so the right-hand
    // side is +X: (cos, -sin) rotated the same way the vertices are.
    const ox = half * cos;
    const oz = -half * sin;
    this.spawn(kind, x + ox, z + oz, halfW, TREAD_HALF_LENGTH, yaw, -1, strength);
    this.spawn(kind, x - ox, z - oz, halfW, TREAD_HALF_LENGTH, yaw, -1, strength);
  }

  /** Explosion soot. Long-lived, then shader-faded and reclaimed. */
  scorch(x: number, z: number, radius = SCORCH_HALF_SIZE, yaw = 0, strength = 1): number {
    // Bible §8.10: aspect 1.7:1, so the minor axis is 1/1.7 of the major.
    return this.spawn(DecalKind.Scorch, x, z, radius / 1.7, radius, yaw, -1, strength);
  }

  /** Impact crater: dark bowl plus a brighter ejecta ring. */
  crater(x: number, z: number, radius = CRATER_HALF_SIZE, yaw = 0, strength = 1): number {
    return this.spawn(DecalKind.Crater, x, z, radius, radius, yaw, 0, strength);
  }

  /** Oil stain. Bible §6.3 puts these near depots at alpha 0.35. */
  oil(x: number, z: number, radius = OIL_HALF_SIZE, yaw = 0, strength = 0.7): number {
    return this.spawn(DecalKind.Oil, x, z, radius * 1.45, radius, yaw, 0, strength);
  }

  /** Road furniture. One per ~25 m of carriageway (bible §6.3). */
  manhole(x: number, z: number, yaw = 0): number {
    return this.spawn(DecalKind.Manhole, x, z, MANHOLE_HALF_SIZE, MANHOLE_HALF_SIZE, yaw, 0, 1);
  }

  /** Daylight lamp pool. The one decal whose tint is above 1.0. */
  lightPool(x: number, z: number, radius = LIGHT_POOL_HALF_SIZE, strength = 0.25): number {
    return this.spawn(DecalKind.LightPool, x, z, radius, radius * 1.25, 0, 0, strength);
  }

  /* ======================================================================
   * PER-FRAME
   * ====================================================================== */

  /**
   * Advance the field clock and flush any dirty vertices.
   *
   * Zero allocation: the update-range records are owned by this instance and
   * pushed by reference, and the amortised sweep touches a bounded number of
   * slots per frame instead of scanning the whole pool.
   */
  frame(dt: number): void {
    this.clock += dt;
    this.setMaterialTime(this.clock);

    // Collapse expired slots so their triangles go degenerate and stop
    // rasterising. Bounded work: DECAL_SWEEP_PER_FRAME slots, round robin.
    const n = Math.min(DECAL_SWEEP_PER_FRAME, this.capacity);
    for (let i = 0; i < n; i++) {
      const slot = this.sweepCursor;
      this.sweepCursor = (this.sweepCursor + 1) % this.capacity;
      if (this.slotUsed[slot] === 0) continue;
      const life = this.slotLife[slot];
      if (life <= 0) continue;
      if (this.clock - this.slotSpawn[slot] <= life) continue;
      this.collapse(slot);
    }

    this.flush();
  }

  /** Retire every decal. Used between matches and by the screenshot harness. */
  clear(): void {
    for (let s = 0; s < this.capacity; s++) if (this.slotUsed[s] !== 0) this.collapse(s);
    this.head = 0;
    this.sweepCursor = 0;
    this.flush();
  }

  stats(): DecalStats {
    return {
      capacity: this.capacity,
      live: this.live,
      spawned: this.spawnedTotal,
      evicted: this.evictedTotal,
      triangles: this.live * (INDICES_PER_DECAL / 3),
    };
  }

  get liveCount(): number { return this.live; }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.atlas.dispose();
  }

  /* ======================================================================
   * INTERNALS
   * ====================================================================== */

  /** Squash one slot onto a point, making all of its triangles degenerate. */
  private collapse(slot: number): void {
    const base = slot * VERTS_PER_DECAL;
    const p0 = base * 3;
    const x = this.position[p0];
    const y = this.position[p0 + 1];
    const z = this.position[p0 + 2];
    for (let i = 0; i < VERTS_PER_DECAL; i++) {
      const p = (base + i) * 3;
      this.position[p] = x;
      this.position[p + 1] = y;
      this.position[p + 2] = z;
    }
    this.slotUsed[slot] = 0;
    if (this.live > 0) this.live--;
    this.markDirty(base, base + VERTS_PER_DECAL);
  }

  private markDirty(lo: number, hi: number): void {
    if (this.dirtyLo < 0) { this.dirtyLo = lo; this.dirtyHi = hi; return; }
    if (lo < this.dirtyLo) this.dirtyLo = lo;
    if (hi > this.dirtyHi) this.dirtyHi = hi;
  }

  /**
   * Upload the dirty span. The ring buffer means writes are contiguous except
   * on the wrap frame, where the merged span is at worst the whole buffer —
   * once every `capacity` spawns. Not worth a second range to avoid.
   */
  private flush(): void {
    if (this.dirtyLo < 0) return;
    const lo = this.dirtyLo;
    const count = this.dirtyHi - lo;
    this.dirtyLo = -1;
    this.dirtyHi = -1;

    this.setRange(this.posAttr, 0, lo * 3, count * 3);
    this.setRange(this.paramAttr, 1, lo * 4, count * 4);
    this.setRange(this.tintAttr, 2, lo * 3, count * 3);
  }

  private setRange(attr: THREE.BufferAttribute, slot: number, start: number, count: number): void {
    const r = this.ranges[slot];
    r.start = start;
    r.count = count;
    attr.updateRanges.length = 0;
    attr.updateRanges.push(r);
    attr.needsUpdate = true;
  }
}

/* ==========================================================================
 * 5. THE MODULE-LEVEL ACCESSOR
 *
 * VFX, combat and roads all want to drop a decal and none of them should have
 * to own the field or thread it through their constructor. Same shape as
 * `getTerrain()` / `renderBridge()` so there is one idiom in the codebase.
 * ========================================================================== */

let active: DecalField | null = null;
let tracks: DecalField | null = null;

/**
 * Publish the STATIC field: permanent marks — scorch, craters, oil, manholes,
 * road wear. roads.system.ts owns the lifetime.
 *
 * Why two fields at all: a 200-unit tank charge lays roughly 1400 tread stamps
 * a second. Sharing one ring buffer would evict every manhole and every
 * scorch mark inside half a second, so the permanent marks get their own pool
 * with their own eviction pressure and the treads get a fast churning ring.
 * The cost of the split is exactly one extra draw call.
 */
export function setActiveDecals(field: DecalField | null): void {
  active = field;
}

/** Publish the TRANSIENT field: tread marks, tyre marks, settling dust. */
export function setActiveTrackDecals(field: DecalField | null): void {
  tracks = field;
}

/** The static field, or null before `world.roads` has initialised. */
export function groundDecals(): DecalField | null {
  return active;
}

/** The tread/tyre field, or null before `world.roads` has initialised. */
export function trackDecals(): DecalField | null {
  return tracks;
}

/** Lay one pair of tread strips. Safe before init. */
export function layTread(
  x: number, z: number, yaw: number, gauge: number, paving = false, wheeled = false,
): void {
  tracks?.layTread(x, z, yaw, gauge, paving, wheeled);
}

/**
 * Drop a decal from anywhere, safely. A no-op before init instead of a throw —
 * a weapon that fires on the first frame must not crash the boot.
 */
export function layDecal(
  kind: DecalKind, x: number, z: number, radius: number, yaw = 0, strength = 1,
): void {
  active?.spawn(kind, x, z, radius, radius, yaw, -1, strength);
}

/**
 * Compose the ground left by a collapsed structure.
 *
 * The ballistic debris and smoke are short-lived VFX, while the Wreck entity
 * carries the large ruin silhouette. This fills the scale between them with
 * one fading dust mass and one permanent, low-strength disturbed-ground
 * mark. Physical rubble is carried by the Wreck geometry; gravel-shaped atlas
 * lobes were removed after live QA showed them as a ring of dark dots.
 * Everything stays in the existing static decal pool and therefore in
 * its single colour draw; a base being levelled cannot grow a new object or
 * material batch per building.
 */
export function layRubbleStory(x: number, z: number, radius: number, yaw = 0): void {
  const field = active;
  if (field === null) return;
  const r = Math.max(0.25, radius);
  field.spawn(DecalKind.Dust, x, z, r * 0.72, r * 0.95, yaw, 18, 0.38);
  field.spawn(DecalKind.Grime, x, z, r * 0.62, r * 0.78, yaw + 0.31, 0, 0.28);
}

/** Convenience for the damage system: scorch a patch of ground. */
export function layScorch(x: number, z: number, radius: number, yaw = 0): void {
  active?.scorch(x, z, radius, yaw);
}

/** Convenience for the projectile system: crater an impact point. */
export function layCrater(x: number, z: number, radius: number, yaw = 0): void {
  active?.crater(x, z, radius, yaw);
}

/**
 * Pool geometry constants, exported so a test can assert the triangle budget
 * without reaching into the class.
 */
export const DECAL_LAYOUT = {
  atlasCols: ATLAS_COLS,
  atlasTile: ATLAS_TILE,
  vertsPerDecal: VERTS_PER_DECAL,
  indicesPerDecal: INDICES_PER_DECAL,
} as const;

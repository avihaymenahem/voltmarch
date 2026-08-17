/**
 * ============================================================================
 * VOLTMARCH — src/world/road-markings.ts
 * ============================================================================
 * THE ROAD SURFACE LAW, IN ONE TABLE, READ BY BOTH ROAD MATERIALS.
 *
 * `Roads.ts` owns the shipping WebGL pair — three `MeshStandardMaterial`s with
 * one `onBeforeCompile` each — and `RoadNodeMaterial.ts` is their TSL twin.
 * They paint the same asphalt and must agree about every stripe width, every
 * dash period and every anti-aliasing constant, or the network reads one way on
 * WebGL and another on WebGPU. That is the "two grade baselines" risk in §4.5 of
 * `docs/WEBGPU_MIGRATION_PLAN.md`, and roads are the surface it would cost the
 * most: `docs/RENDER_FINDINGS.md` measures this generator at 3.80% edge density
 * against terrain's 0.96-1.59%, so it is the one thing in the frame already
 * inside the look bible's detail band.
 *
 * THE NUMBERS WERE LITERALS INSIDE THREE GLSL TEMPLATE STRINGS, which is a fine
 * home for a value with exactly one reader and a poor one for a value with two.
 * Every scalar below was transcribed out of `ROAD_MARKING_GLSL`,
 * `KERB_PAINT_GLSL` and `PAVEMENT_GLSL` as they stood at v2.13.0, and
 * `tests/road-node-material.spec.ts` §2 writes them out A SECOND TIME by hand.
 * That duplication is the point: every other assertion compares one path against
 * the other or against this table, so a value that drifted during the move would
 * drift on BOTH sides at once and every one of them would still pass.
 *
 * WHAT IS NOT HERE. Anything already in `config.ts` — lane width, kerb height,
 * the crosswalk and stop-bar geometry, the paint colours — stays there and both
 * shaders read it from there. This file holds only what was born inside a shader
 * string.
 * ============================================================================
 */

import { ROAD_COLORS, ROAD_ROUGHNESS, ROAD_SLAB_JOINT, ROAD_SLAB_METRES } from '../core/config';
import { linearColorTriple, materialTextureSet, textures, type TextureRequest } from '../core/assets';
import { RepeatWrapping } from 'three';
import type * as THREE from 'three';

/* ==========================================================================
 * 1. THE THREE SURFACES
 * ========================================================================== */

/** The three road parts, in the order `RoadNetwork.buildMeshes` builds them. */
export type RoadSurfaceKind = 'carriageway' | 'kerb' | 'pavement';

export const ROAD_SURFACE_KINDS: readonly RoadSurfaceKind[] = ['carriageway', 'kerb', 'pavement'];

/**
 * The vec4 attribute each surface carries, and the geometry name it rides on.
 *
 * THREE NAMES FOR ONE VARYING. The GLSL reads all three into `vRoad`, so the
 * three fragment snippets can be written against a single declaration; the node
 * path does exactly the same with one `varyingProperty( 'vec4', 'vRoad' )`. The
 * attribute names differ so a mesh cannot be drawn with the wrong material and
 * silently read a neighbouring surface's channel packing.
 */
export const ROAD_ATTRIBUTE_NAMES: Readonly<Record<RoadSurfaceKind, string>> = {
  carriageway: 'aRoad',
  kerb: 'aKerb',
  pavement: 'aPave',
};

/** Material names, so both paths mount meshes under the same labels. */
export const ROAD_MATERIAL_NAMES: Readonly<Record<RoadSurfaceKind, string>> = {
  carriageway: 'RoadAsphalt',
  kerb: 'RoadKerb',
  pavement: 'RoadPavement',
};

/**
 * Metres per repeat of each generated surface texture, and its texel edge.
 *
 * These live here rather than in config because they are chosen TOGETHER with
 * the generator parameters below: 4.8 m across 512 texels puts a 1.2 m slab on
 * exactly 128 texels and four whole slabs in the tile, which is the difference
 * between paving that tiles seamlessly and paving whose joints step at every
 * repeat. Asphalt and kerb are near-uniform colour fields, so their tile is
 * sized for cheap generation rather than for feature alignment.
 */
export const SURFACE_TILE_METRES = { asphalt: 6.0, kerb: 2.0, pavement: 4.8 } as const;
export const SURFACE_TEXELS = { asphalt: 256, kerb: 128, pavement: 512 } as const;

/** Metres to pavement texels. 1.2 m lands on exactly 128; 0.03 m on 3.2. */
export function paveTexels(metres: number): number {
  return (metres / SURFACE_TILE_METRES.pavement) * SURFACE_TEXELS.pavement;
}

/**
 * The clean-set palette, read off `docs/surface-refs/`.
 *
 * `ROAD_COLORS` still owns every PAINT colour (lane white, centre yellow, kerb
 * red) because those are correct. What it cannot own is the surface base tones:
 * its asphalt `#46464A` is a mid neutral grey that was authored to be seen
 * through a heavy speckle overlay, and with the speckle gone it reads as
 * concrete. RA3's carriageway is a dark, slightly warm near-black.
 *
 * THE PAVEMENT MOVED, and it is measured. It was `#cbc0ae` — V 0.80, S 0.14 —
 * a pale beige, and pavement is the largest single desaturated mass on the map
 * AND it fills the far field, where the camera's grazing angle stacks a sky
 * sheen on top of it. That combination owned scorecard #12 (far minus near
 * saturation), which was failing on nine of the twelve critique shots at −0.06
 * to −0.30 against a −0.05 floor: a near-white far field is exactly the "haze"
 * the check exists to catch, whether or not any fog is enabled.
 *
 * The replacement is a cool concrete: V 0.80 -> 0.55 and S 0.14 -> 0.19, and
 * the hue moves to a blue-grey, which is both what RA3's sidewalks actually are
 * and the same cool shadow language `TONE_NOON.shadowTint` carries. The kerb
 * stays one step lighter than the pavement so the step still catches the sun.
 */
export const SURFACE_COLOURS = {
  // Every one of these carries real chroma, and that is the point. Road surface
  // is the largest man-made mass on the map and it runs through the FAR field
  // of most frames, so a near-neutral carriageway is measured directly by
  // scorecard #12 as haze. The old set was asphalt S 0.09, pavement S 0.11 and
  // kerb S 0.11 — three big grey planes. These are the same values with the
  // grey axis traded for a cool blue, which is what RA3's tarmac actually is.
  asphalt: '#242a33',
  kerb: '#7e8aa2',
  pavement: '#697488',
  pavementJoint: '#4c5568',
} as const;

/**
 * The three texture requests, verbatim from `RoadNetwork.buildMeshes`.
 *
 * SHARED RATHER THAN COPIED, and that buys more than tidiness: `textures.get`
 * caches by request, so the GLSL material and its node twin hold THE SAME
 * `DataTexture` objects. A compare harness standing both up side by side is
 * therefore measuring the two shaders and not two rolls of the generator.
 */
export function roadSurfaceRequest(kind: RoadSurfaceKind): TextureRequest {
  switch (kind) {
    case 'carriageway':
      // A near-solid dark grey-brown with a perfectly flat height field — every
      // scrap of interest on this surface is painted on top of it by the marking
      // shader, exactly as in the RA3 reference.
      //
      // `wear` here buys two broad out-of-phase drifts at half and a fifth of
      // the tile — a 2% value change across six metres. It reads as a road that
      // has been resurfaced in patches, and it is physically incapable of
      // becoming texture: `budgetedNoise` clamps frequency as well as amplitude,
      // so there is no value of this that produces speckle.
      return {
        kind: 'asphalt', size: SURFACE_TEXELS.asphalt, seed: 0x2a11,
        colour: SURFACE_COLOURS.asphalt, wear: 0.6, roughness: ROAD_ROUGHNESS.asphalt,
      };
    case 'kerb':
      // Smooth pale extruded stone: no slab pattern at all, because a kerb is
      // 0.28 m wide and any pattern on it is sub-pixel noise at this camera. The
      // reads that matter are the geometry's own shadow, the bevel highlight in
      // the kerb shader and the red corner paint.
      return {
        kind: 'flatPaint', size: SURFACE_TEXELS.kerb, seed: 0x51c3,
        colour: SURFACE_COLOURS.kerb, wear: 0.35, roughness: ROAD_ROUGHNESS.kerb,
      };
    case 'pavement':
      // Real rectangular slabs at bible §6.1's 1.2 m with a 0.03 m joint, each
      // slab face FLAT and offset from its neighbours by a couple of percent.
      // That offset is cell-constant, which is why it survives mip filtering —
      // per-pixel speckle does not, and turns to crawling static at exactly the
      // distance an RTS camera sits.
      return {
        kind: 'paving', size: SURFACE_TEXELS.pavement, seed: 0x7b09,
        colour: SURFACE_COLOURS.pavement, jointColour: SURFACE_COLOURS.pavementJoint,
        slabW: paveTexels(ROAD_SLAB_METRES), slabH: paveTexels(ROAD_SLAB_METRES),
        jointWidth: paveTexels(ROAD_SLAB_JOINT), variation: 0.03, bond: 0,
        wear: 0.4, roughness: ROAD_ROUGHNESS.pavement,
      };
  }
}

export interface RoadSurfaceTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** Occlusion / roughness / metalness, packed. Bound as BOTH aoMap and roughnessMap. */
  ormMap: THREE.Texture;
}

/**
 * Build one surface's three maps and set the wrapping both paths need.
 *
 * Note what is NOT here: `t.repeat.set( 1 / tileMetres, ... )`. The mesh
 * builders already divide their UVs by the tile size, so the old code applied
 * the repeat TWICE and every surface was tiling at the square of its intended
 * period. Tiling lives in exactly one place — the UV — which is also what lets
 * the pavement tile in road-local metres instead of world XZ.
 */
export function roadSurfaceTextures(
  kind: RoadSurfaceKind, anisotropy: number,
): RoadSurfaceTextures {
  const set = materialTextureSet(textures, { ...roadSurfaceRequest(kind), anisotropy });
  for (const t of [set.map, set.normalMap, set.ormMap]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(1, 1);
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
  }
  return set;
}

/**
 * Lane arrows, painted on the approach to every junction mouth.
 *
 * Rasterized by the `decal` generator from real polygon paths, so the arrow has
 * hard edges and one texel of antialiasing — it is a DRAWN SHAPE, never a
 * noise-modulated blob. Both paths are authored tip-toward-v=0 and (for the
 * turn) head-toward-+u, which is what lets the shader place them by
 * `distance to the junction` and `distance from the centre line` without ever
 * needing to know which way traffic runs.
 */
export function arrowMask(path: 'arrowStraight' | 'arrowTurn'): THREE.DataTexture {
  return textures.get({
    kind: 'decal', channel: 'mask', tiling: false,
    size: 128, colour: ROAD_COLORS.laneLine, path, amount: 1,
  });
}

/* ==========================================================================
 * 2. WHERE A LANE ARROW SITS
 * ========================================================================== */

/**
 * In metres from the junction mouth: tip at `near`, tail at `far`. It starts
 * past the stop bar (which ends at 9.6 m) so paint never overlaps paint, and it
 * is 5.4 x 2.3 m — a real road arrow, drawn at bible §6.1's 2-3x oversize so it
 * survives the RTS camera.
 *
 * `span` and `width` are DERIVED and are the numbers the shaders actually
 * divide by. The GLSL interpolated them at three decimal places
 * (`(ROAD_ARROW_FAR - ROAD_ARROW_NEAR).toFixed(3)`), so they are rounded here to
 * the same precision — a shader that divides by 5.400000000000001 is a
 * different program from one that divides by 5.400, and the whole point of this
 * file is that the two paths cannot differ.
 */
export const ROAD_ARROW = {
  near: 11.0,
  far: 16.4,
  halfWidth: 1.15,
  /** `far - near`, at the GLSL's three decimal places. */
  span: 5.400,
  /** `halfWidth * 2`, ditto. */
  width: 2.300,
} as const;

/* ==========================================================================
 * 3. EVERY SCALAR THAT WAS BORN INSIDE A SHADER STRING
 * ========================================================================== */

/**
 * THE MARKING CONSTANTS.
 *
 * Grouped by the block of the shipping GLSL each one came from, in that
 * shader's own order, so the two files read side by side. Nothing here is
 * derived from anything else in this object — every entry is a literal that was
 * typed into a template string.
 */
export const ROAD_MARKS = {
  /* --- anti-aliasing, shared by every stripe -----------------------------
   * `aa = fwidth( x ) * gain + floor`. At the RTS distance a 0.12 m line is
   * under two pixels, so without it the centre line strobes and reads as
   * shimmer rather than as paint. The floor is what keeps a line visible on a
   * surface whose derivative has collapsed to nothing at a grazing angle.
   */
  aaGain: 0.6,
  aaFloor: 0.004,

  /* --- wheel paths: two 0.8 m bands per lane, +18% L (bible §6.1) --------
   * Kept because RA3 does show them, but at well under half the old strength:
   * this is a BROAD, smooth value change across a whole lane, and the moment it
   * reads as "texture" rather than as "polish" it is wrong.
   */
  wheelLo: 0.28,
  wheelHi: 0.46,
  wheelInner: 0.85,
  wheelOuter: 2.55,
  wheelMix: 0.34,

  /* --- centre line: double solid yellow, 0.12 stripe / 0.12 gap ---------- */
  lineHalf: 0.06,
  centreOffset: 0.12,

  /* --- lane dividers: white dashes 3.0 m on / 2.8 m off ------------------
   * A 4-lane carriageway has exactly one divider each side of the centre, at
   * |u| = one lane width.
   */
  dashPeriod: 5.8,
  dashOn: 3.0,
  /** Lane count at or above which a divider is drawn at all. */
  dividerLanes: 4.0,

  /* --- edge line: solid white 0.15 m, inset 0.25 m from the kerb --------- */
  edgeHalf: 0.075,
  edgeInset: 0.325,

  /* --- crosswalk zebra --------------------------------------------------
   * The gate is a cheap early-out around the band; it is WIDER than the band by
   * `gate` metres at each end so the `smoothstep` ramps are never clipped.
   * Bars run ALONG the direction of travel and repeat across the road at
   * `ROAD_CROSSWALK_PERIOD` (bible §6.3 wants 0.45-0.60 for bar and gap alike).
   */
  crosswalkGate: 0.4,
  /**
   * Added before the `mod` that repeats the zebra across the carriageway.
   *
   * `u` is SIGNED metres from the centre line, so it is negative on half the
   * road, and the bias is what puts the dividend of `mod` firmly positive.
   * 1024 m is four times the map edge.
   *
   * IT IS NOT WHAT MAKES THE TSL PORT SAFE, and the first draft of this comment
   * claimed it was. TSL's `mod` is the `%` operator in the graph, and `%` on
   * floats in WGSL IS a truncated remainder — but three does not emit it.
   * `WGSLNodeBuilder.js:83` declares
   *
   *     fn tsl_mod_float( x : f32, y : f32 ) -> f32 { return x - y * floor( x / y ); }
   *
   * which is GLSL's floored `mod`, exactly, and the generated WGSL calls that
   * helper. Verified by reading the emitted source, not by reading the docs.
   * The bias therefore keeps the meaning it always had — it is a positive
   * dividend for a shader that reasons in distances — and carries no portability
   * weight. Removing it would still be wrong, and now for one reason instead of
   * two.
   */
  crosswalkBias: 1024.0,
  /** Keep the bars off the very edge so they do not touch the kerb. */
  zebraInsetLo: 0.55,
  zebraInsetHi: 0.30,

  /* --- stop bar --------------------------------------------------------- */
  stopInsetLo: 0.45,
  stopInsetHi: 0.25,

  /* --- how hard paint covers the surface under it ------------------------ */
  markMix: 0.92,
  /**
   * Paint is smoother than the surface it sits on. Without this the markings
   * take the same broad lobe as the aggregate and stop reading as paint at a
   * grazing angle. The GLSL lerps `roughnessFactor` toward this immediately
   * after `<roughnessmap_fragment>`; the node path is `roughnessNode`.
   */
  paintRoughness: 0.52,

  /* --- kerb -------------------------------------------------------------
   * Bible §6.3: red paint covers the vertical face PLUS 0.08 m of the top, and
   * runs 6-12 m along a corner arc. Yellow dashes sit on the TOP face only.
   * Both offsets are measured from `ROAD_KERB_HEIGHT`.
   */
  kerbRedLo: 0.075,
  kerbRedHi: 0.095,
  kerbRedMix: 0.94,
  kerbDashPeriod: 1.35,
  kerbDashOn: 0.90,
  kerbTopEps: 0.005,
  kerbYellowMix: 0.92,
  /**
   * The convex top edge carries a bevel highlight. Scorecard #11 grades this on
   * units, but a razor-sharp kerb edge is the same tell at half the size.
   */
  kerbBevel: 0.035,
  kerbBevelGain: 0.22,

  /* --- pavement ---------------------------------------------------------
   * Bible §6.2(a): a 0.3 m soldier course, 12% darker, along the outer edge.
   * The slab joints themselves are NOT a shader feature — the pavement UV is
   * (along, across) in metres, so the `paving` generator's real 1.2 m slab grid
   * follows the road round a bend with joints that mip-filter properly.
   */
  soldierLo: 0.80,
  soldierHi: 0.94,
  soldierDarken: 0.12,
} as const;

/* ==========================================================================
 * 4. THE PAINT COLOURS, IN LINEAR SPACE
 * ========================================================================== */

/**
 * `ROAD_COLORS` in scene-linear RGB, which is the space both shaders blend in.
 *
 * Computed once at module load rather than per material: `linearColorTriple`
 * allocates, and the GLSL path already had a rule against calling it per frame.
 * Both paths seed their uniforms from this, so a palette edit reaches the two of
 * them or neither.
 */
export const ROAD_MARK_LINEAR = {
  centre: linearColorTriple(ROAD_COLORS.centreLine),
  paint: linearColorTriple(ROAD_COLORS.laneLine),
  wheelPath: linearColorTriple(ROAD_COLORS.wheelPath),
  kerbRed: linearColorTriple(ROAD_COLORS.kerbRed),
  kerbYellow: linearColorTriple(ROAD_COLORS.kerbYellow),
} as const;

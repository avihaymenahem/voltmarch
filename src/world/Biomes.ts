/**
 * ============================================================================
 * RED ALERT — src/world/Biomes.ts
 * ============================================================================
 * BIOME PRESETS: the palette and the landform recipe for one map style.
 *
 * Everything a scenario needs to say "this is a desert map" lives here as
 * data. `Terrain.setBiome('desert')` re-runs the heightfield, re-classifies
 * every cell and re-tints the splat material from one of these records.
 *
 * WHY THE COLOURS ARE WHAT THEY ARE
 * ---------------------------------
 * Every albedo below is an AUTHORED value copied out of RA3_LOOK_BIBLE §6.1,
 * not a colour sampled off a screenshot. Sampled values already carry the sun,
 * the hemisphere fill and the ACES shoulder baked in; feeding those back
 * through our own lighting double-counts and produces the washed-out
 * grey-green that §14/R2 calls the fatal failure mode.
 *
 * THE ONE RULE NOBODY MAY BREAK
 * -----------------------------
 * **Grass hue is 60-70 degrees.** `#5E6418` is hue 66. Hue 100-120 (emerald,
 * `#4CAF50`, the Three.js default green) is scorecard #9, weight 3, automatic
 * fail, and it is the single most recognisable amateur tell in the genre.
 * Every "ground" layer below is checked against that band.
 *
 * SIX SURFACE SLOTS, FIXED FOREVER
 * --------------------------------
 * The splat shader hard-codes six layers because six is what fits in two RGBA
 * control textures with two spare channels. The SEMANTICS of a slot are fixed
 * (slot 0 is always "the dominant natural ground of this biome"); only the
 * colour and the tiling scale change per biome. That is what lets one shader
 * and one control texture serve all four biomes.
 * ============================================================================
 */

import type { TextureKind } from '../core/assets';

/* ==========================================================================
 * 1. SURFACE SLOTS
 * ========================================================================== */

/**
 * The six splat layers, in the order the shader expects them.
 *
 * Slots 4 and 5 (Concrete / Paving) are generated EMPTY. They exist so the
 * roads module and the building-pad module can stamp into them through
 * `Terrain.stampSurface()` without needing their own geometry pass — a road
 * that is part of the terrain splat costs zero extra draw calls and cannot
 * z-fight, which a decal-quad road can and does.
 */
export const enum SurfaceId {
  /** Grass / steppe / snow — whatever this biome's dominant ground is. */
  Ground = 0,
  /** Bare earth. Patches, cliff aprons, ramp tracks, worn areas. */
  Dirt = 1,
  /** Sand. Shorelines and low ground. */
  Sand = 2,
  /** Exposed rock. Steep slopes and scree. */
  Rock = 3,
  /** Poured concrete. Stamped by building pads. */
  Concrete = 4,
  /** Cobble / paver / asphalt. Stamped by roads. */
  Paving = 5,
}

/** Number of splat layers. Frozen — the shader unrolls over exactly this many. */
export const SURFACE_COUNT = 6;

/** Human-readable slot names, indexed by SurfaceId. For debug overlays. */
export const SURFACE_NAMES: readonly string[] = [
  'ground', 'dirt', 'sand', 'rock', 'concrete', 'paving',
];

/** One splat layer's look. */
export interface SurfaceLayerDef {
  /** What this slot is called in THIS biome ('grass', 'snow', 'steppe'...). */
  readonly label: string;
  /** Authored lit albedo, '#RRGGBB'. Bible §6.1. */
  readonly albedo: string;
  /** The darker tone the generator blends toward. Blotches and shade. */
  readonly shade: string;
  /** Third tone: pebbles, clumps, tufts. Breaks the two-colour lerp look. */
  readonly accent: string;
  /** PBR roughness for this layer. Terrain is never below 0.6. */
  readonly roughness: number;
  /**
   * Metres per texture repeat. Bible §6.1: texture features are deliberately
   * OVERSIZED 2-3x real world, because a "correct" 0.15 m cobble is grey mush
   * at RTS distance. Keep these generous.
   */
  readonly tileMetres: number;
  /** Which generator in core/assets.ts builds it. */
  readonly gen: TextureKind;
  /** Feature scale handed to the generator (higher = smaller features). */
  readonly genScale: number;
  /** Deterministic per-layer seed. */
  readonly seed: number;
}

/**
 * The cliff face look. Bible §6.4 defines exactly two archetypes and we
 * support both from one shader:
 *
 *  - **Cliff B, natural rock** — 78-88 degree face, vertical striation at
 *    lambda 0.4-0.5 m, and an OVERHUNG SOIL/GRASS LIP at the top. That lip is
 *    the whole trick: a bare cliff top edge reads as a cut polygon.
 *  - **Cliff A, retaining wall** — brick courses plus a grey concrete coping
 *    cap running the full top edge. The cap is what makes the wall read.
 *
 * `courseMetres > 0` selects the retaining-wall reading.
 */
export interface CliffLookDef {
  /** Mid rock tone. */
  readonly base: string;
  /** Deep striation / shade tone. */
  readonly shade: string;
  /** Sun-caught striation edge. */
  readonly highlight: string;
  /** Colour of the cap or lip at the top of the face. */
  readonly capColor: string;
  /** Thickness of that cap in metres (0.3-0.8 natural, 0.5-0.6 concrete). */
  readonly capMetres: number;
  /** Striation wavelength in metres. Bible: 0.4-0.5 for natural rock. */
  readonly striationMetres: number;
  /** Horizontal course height in metres. 0 = natural rock, no courses. */
  readonly courseMetres: number;
  /** Normal-perturbation strength standing in for the +/-0.25 m relief. */
  readonly relief: number;
  readonly roughness: number;
  /** Metres of dark scree skirt at the foot of the face. */
  readonly skirtMetres: number;
}

/* ==========================================================================
 * 2. THE BIOME RECORD
 * ========================================================================== */

export interface BiomeDef {
  readonly key: BiomeName;
  readonly name: string;

  /* -- landform ---------------------------------------------------------- */

  /**
   * Number of DISCRETE terraces above the base level. Bible §6.4: 2-4 tiers
   * per map, step 4-8 m, and never a smooth Perlin hill (scorecard #35).
   */
  readonly tierCount: number;
  /** Metres of vertical rise per terrace. */
  readonly stepHeight: number;
  /** Height of tier 0 in metres. Must sit clear of WATER_LEVEL. */
  readonly baseHeight: number;
  /** Metres per feature of the plateau-shaping noise. Big = few, wide tiers. */
  readonly plateauMetres: number;
  /**
   * 0..1 — how strongly the terrace potential is dragged upward toward the map
   * edge. This is a PLAYABILITY device as much as a look one: it guarantees
   * the centre of the map is one contiguous low plateau (so 200 units can
   * actually reach each other) and puts the rocky massifs around the rim,
   * which is exactly how RA3's own maps are composed.
   */
  readonly edgeBias: number;
  /** Metres of gentle swell laid over the flat terraces. Bible: 0.4-0.8. */
  readonly swellAmplitude: number;
  /** Wavelength of that swell in metres. Bible: 15-30. */
  readonly swellMetres: number;
  /** Metres of horizontal run the terrace transition occupies. 1.2 => ~79deg. */
  readonly cliffWidth: number;
  /** Metres the lowest ground is pushed below tier 0 to make water. 0 = dry. */
  readonly basinDepth: number;
  /** Fraction of the potential range that becomes basin. */
  readonly basinThreshold: number;

  /* -- surface classification -------------------------------------------- */

  /** Slope (radians) at which rock starts showing through the ground layer. */
  readonly rockSlope: number;
  /** Metres above the waterline that still read as beach. 0 = no shoreline. */
  readonly sandBandMetres: number;
  /** 0..1 coverage of inland sand/gravel drifts, independent of any water. */
  readonly sandPatchAmount: number;
  /** Metres per dirt patch blob. */
  readonly dirtPatchMetres: number;
  /** 0..1 coverage of those patches. */
  readonly dirtPatchAmount: number;
  /** 0..1 extra dirt applied to the highest tier (dry, wind-scoured tops). */
  readonly dirtAltitude: number;

  /* -- material ---------------------------------------------------------- */

  /** Metres per repeat of the macro breakup layer. Bible: 25-40 m soil macro. */
  readonly macroMetres: number;
  /** 0..1 luminance swing of that macro layer. */
  readonly macroStrength: number;
  /** Colour the macro layer pulls toward at its dark end. */
  readonly macroTint: string;
  /** Metres per repeat of the mask-warp noise. */
  readonly warpMetres: number;
  /** Metres of boundary displacement. Bible §6.2(b): +/-0.6 m. */
  readonly warpAmplitude: number;
  /** 0..1 per-CELL luminance jitter. The classic tiled-terrain tell, on purpose. */
  readonly cellJitter: number;

  readonly layers: readonly SurfaceLayerDef[];
  readonly cliff: CliffLookDef;
}

export type BiomeName = 'temperate' | 'desert' | 'snow' | 'urban';

/* ==========================================================================
 * 3. THE PRESETS
 * ========================================================================== */

/**
 * TEMPERATE — the shipping default.
 *
 * Grass `#5E6418` is hue 66, saturation 0.79, value 0.39. Bible scorecard #9
 * wants hue 55-75 / S 0.78-0.90 / V 0.30-0.55, and this lands in the middle of
 * all three bands. It looks alarmingly dark and yellow in a colour picker.
 * That is correct: VISUAL_DNA measures the reference grass at luma 63 of 255.
 */
const TEMPERATE: BiomeDef = {
  key: 'temperate',
  name: 'Temperate',

  tierCount: 3,
  stepHeight: 6.0,
  baseHeight: 2.8,
  plateauMetres: 155,
  edgeBias: 0.52,
  swellAmplitude: 0.62,
  swellMetres: 23,
  cliffWidth: 1.2,
  basinDepth: 3.6,
  basinThreshold: 0.11,

  rockSlope: 0.30,
  sandBandMetres: 1.5,
  sandPatchAmount: 0.10,
  dirtPatchMetres: 17,
  dirtPatchAmount: 0.22,
  dirtAltitude: 0.20,

  macroMetres: 34,
  macroStrength: 0.20,
  macroTint: '#4A4A22',
  warpMetres: 7.5,
  warpAmplitude: 0.62,
  cellJitter: 0.045,

  layers: [
    // 0 Ground — lush grass. THE hue-locked layer.
    { label: 'grass',    albedo: '#5E6418', shade: '#2C3309', accent: '#6C7C1C',
      roughness: 0.95, tileMetres: 8.0, gen: 'ground', genScale: 5.0, seed: 1101 },
    // 1 Dirt — bare earth, 0.25 m grain / 3 m clump.
    { label: 'dirt',     albedo: '#9C7B52', shade: '#6A5334', accent: '#B39472',
      roughness: 0.92, tileMetres: 5.5, gen: 'ground', genScale: 6.0, seed: 1102 },
    // 2 Sand — shoreline.
    { label: 'sand',     albedo: '#C4A878', shade: '#9A8253', accent: '#DAC59A',
      roughness: 0.90, tileMetres: 6.5, gen: 'ground', genScale: 4.0, seed: 1103 },
    // 3 Rock — dry rock, striation lambda 0.5.
    { label: 'rock',     albedo: '#7A7258', shade: '#4A4536', accent: '#968D72',
      roughness: 0.85, tileMetres: 7.0, gen: 'ground', genScale: 7.5, seed: 1104 },
    // 4 Concrete — slab 1.2 m, joint 0.03 m.
    { label: 'concrete', albedo: '#9A968C', shade: '#6C6960', accent: '#B2AFA4',
      roughness: 0.70, tileMetres: 4.8, gen: 'concrete', genScale: 4.0, seed: 1105 },
    // 5 Paving — cobble sett 0.8 m. Oversized on purpose (bible §6.1).
    { label: 'cobble',   albedo: '#B7ADA2', shade: '#6B6058', accent: '#D6CFC6',
      roughness: 0.68, tileMetres: 3.2, gen: 'ground', genScale: 4.5, seed: 1106 },
  ],

  cliff: {
    base: '#7A7258', shade: '#463F30', highlight: '#9E9578',
    capColor: '#5E6418', capMetres: 0.75,
    striationMetres: 0.46, courseMetres: 0, relief: 0.55,
    roughness: 0.85, skirtMetres: 1.3,
  },
};

/**
 * DESERT — hue locked to 41 degrees +/- 2 (VISUAL_DNA §1.5.1).
 *
 * The whole biome is ONE hue; only lightness and saturation move, and
 * saturation RISES as lightness falls. Spreading desert across hue 25-55 is
 * the thing that makes procedural sand look like mud.
 */
const DESERT: BiomeDef = {
  key: 'desert',
  name: 'Arid',

  tierCount: 3,
  stepHeight: 6.5,
  baseHeight: 3.4,
  plateauMetres: 172,
  edgeBias: 0.48,
  swellAmplitude: 0.72,
  swellMetres: 27,
  cliffWidth: 1.1,
  basinDepth: 0,
  basinThreshold: 0,

  rockSlope: 0.26,
  sandBandMetres: 0,
  sandPatchAmount: 0.24,
  dirtPatchMetres: 24,
  dirtPatchAmount: 0.34,
  dirtAltitude: 0.18,

  macroMetres: 38,
  macroStrength: 0.22,
  macroTint: '#5A4820',
  warpMetres: 8.5,
  warpAmplitude: 0.7,
  cellJitter: 0.05,

  layers: [
    { label: 'steppe',   albedo: '#8A7A44', shade: '#584D26', accent: '#A6975C',
      roughness: 0.95, tileMetres: 9.0, gen: 'ground', genScale: 4.5, seed: 2101 },
    { label: 'hardpan',  albedo: '#A98A5E', shade: '#70573A', accent: '#C0A47C',
      roughness: 0.92, tileMetres: 6.0, gen: 'ground', genScale: 6.5, seed: 2102 },
    { label: 'sand',     albedo: '#C4A878', shade: '#9C8455', accent: '#DCC79C',
      roughness: 0.90, tileMetres: 7.5, gen: 'ground', genScale: 3.2, seed: 2103 },
    { label: 'outcrop',  albedo: '#8B7048', shade: '#54432A', accent: '#AA8C5E',
      roughness: 0.85, tileMetres: 7.0, gen: 'ground', genScale: 8.0, seed: 2104 },
    { label: 'pad',      albedo: '#8C8462', shade: '#605A42', accent: '#A69E7C',
      roughness: 0.72, tileMetres: 5.0, gen: 'concrete', genScale: 3.6, seed: 2105 },
    { label: 'gravel',   albedo: '#A89A78', shade: '#6E6450', accent: '#C2B694',
      roughness: 0.88, tileMetres: 3.0, gen: 'ground', genScale: 9.0, seed: 2106 },
  ],

  cliff: {
    base: '#8B7048', shade: '#4E402A', highlight: '#B39868',
    capColor: '#8A7A44', capMetres: 0.6,
    striationMetres: 0.50, courseMetres: 0, relief: 0.62,
    roughness: 0.85, skirtMetres: 1.6,
  },
};

/**
 * SNOW — bible §6.1: snow is `#C4BAB2`, a WARM grey, NOT white.
 *
 * Pure white snow blows past the p99 highlight target on its own and turns the
 * frame median well above the 0.26-0.40 band (scorecard #4 and #6, both weight
 * 3). Overcast-snow measures mean saturation 0.169, so this is the one preset
 * where low saturation is correct.
 */
const SNOW: BiomeDef = {
  key: 'snow',
  name: 'Snowbound',

  tierCount: 3,
  stepHeight: 5.5,
  baseHeight: 3.0,
  plateauMetres: 148,
  edgeBias: 0.56,
  swellAmplitude: 0.55,
  swellMetres: 21,
  cliffWidth: 1.25,
  basinDepth: 3.2,
  basinThreshold: 0.13,

  rockSlope: 0.24,
  sandBandMetres: 1.2,
  sandPatchAmount: 0.06,
  dirtPatchMetres: 20,
  dirtPatchAmount: 0.14,
  dirtAltitude: 0.24,

  macroMetres: 30,
  macroStrength: 0.16,
  macroTint: '#6E7A84',
  warpMetres: 9.0,
  warpAmplitude: 0.75,
  cellJitter: 0.035,

  layers: [
    { label: 'snow',     albedo: '#C4BAB2', shade: '#8E8B8E', accent: '#E2E6E6',
      roughness: 0.60, tileMetres: 10.0, gen: 'ground', genScale: 2.6, seed: 3101 },
    { label: 'earth',    albedo: '#9F8C6F', shade: '#645544', accent: '#B39459',
      roughness: 0.90, tileMetres: 5.5, gen: 'ground', genScale: 6.0, seed: 3102 },
    { label: 'ice',      albedo: '#AFC0C8', shade: '#7C8E9A', accent: '#D2E0E4',
      roughness: 0.42, tileMetres: 8.0, gen: 'ground', genScale: 3.0, seed: 3103 },
    { label: 'rock',     albedo: '#5F665F', shade: '#343B36', accent: '#828A84',
      roughness: 0.85, tileMetres: 6.5, gen: 'ground', genScale: 8.0, seed: 3104 },
    { label: 'concrete', albedo: '#9A968C', shade: '#6C6960', accent: '#B2AFA4',
      roughness: 0.70, tileMetres: 4.8, gen: 'concrete', genScale: 4.0, seed: 3105 },
    { label: 'paving',   albedo: '#B7ADA2', shade: '#6B6058', accent: '#D6CFC6',
      roughness: 0.68, tileMetres: 3.2, gen: 'ground', genScale: 4.5, seed: 3106 },
  ],

  cliff: {
    base: '#5F665F', shade: '#2E3430', highlight: '#8B9490',
    capColor: '#C4BAB2', capMetres: 0.95,
    striationMetres: 0.44, courseMetres: 0, relief: 0.5,
    roughness: 0.82, skirtMetres: 1.1,
  },
};

/**
 * URBAN — the built-up preset. Fewer, lower tiers, and every terrace face is a
 * BRICK RETAINING WALL with a grey concrete coping cap instead of natural
 * rock. Bible §6.4 Cliff A: `#8E5A34` brick, 0.22 m courses, cap `#B8B0A6`
 * 0.5-0.6 m thick running the full top edge.
 */
const URBAN: BiomeDef = {
  key: 'urban',
  name: 'Urban',

  tierCount: 2,
  stepHeight: 5.0,
  baseHeight: 3.0,
  plateauMetres: 172,
  edgeBias: 0.50,
  swellAmplitude: 0.35,
  swellMetres: 19,
  cliffWidth: 1.05,
  basinDepth: 0,
  basinThreshold: 0,

  rockSlope: 0.34,
  sandBandMetres: 0,
  sandPatchAmount: 0.09,
  dirtPatchMetres: 16,
  dirtPatchAmount: 0.18,
  dirtAltitude: 0.14,

  macroMetres: 28,
  macroStrength: 0.18,
  macroTint: '#4E4A3E',
  warpMetres: 6.5,
  warpAmplitude: 0.5,
  cellJitter: 0.055,

  layers: [
    { label: 'grass',    albedo: '#5E6418', shade: '#2C3309', accent: '#6C7C1C',
      roughness: 0.95, tileMetres: 7.0, gen: 'ground', genScale: 5.0, seed: 4101 },
    { label: 'dirt',     albedo: '#9C7B52', shade: '#6A5334', accent: '#B39472',
      roughness: 0.92, tileMetres: 5.0, gen: 'ground', genScale: 6.0, seed: 4102 },
    { label: 'gravel',   albedo: '#A89A78', shade: '#6E6450', accent: '#C2B694',
      roughness: 0.88, tileMetres: 3.0, gen: 'ground', genScale: 9.0, seed: 4103 },
    { label: 'brick',    albedo: '#8E5A34', shade: '#5A3720', accent: '#A87450',
      roughness: 0.80, tileMetres: 4.0, gen: 'concrete', genScale: 7.0, seed: 4104 },
    { label: 'concrete', albedo: '#9A968C', shade: '#6C6960', accent: '#B2AFA4',
      roughness: 0.70, tileMetres: 4.8, gen: 'concrete', genScale: 4.0, seed: 4105 },
    { label: 'cobble',   albedo: '#B7ADA2', shade: '#6B6058', accent: '#D6CFC6',
      roughness: 0.68, tileMetres: 3.2, gen: 'ground', genScale: 4.5, seed: 4106 },
  ],

  cliff: {
    base: '#8E5A34', shade: '#4E2E1A', highlight: '#A87450',
    capColor: '#B8B0A6', capMetres: 0.55,
    striationMetres: 0.36, courseMetres: 0.22, relief: 0.40,
    roughness: 0.80, skirtMetres: 0.8,
  },
};

/** Every preset, by key. */
export const BIOMES: Record<BiomeName, BiomeDef> = {
  temperate: TEMPERATE,
  desert: DESERT,
  snow: SNOW,
  urban: URBAN,
};

/** Every valid biome name, for menus and the debug console. */
export const BIOME_NAMES: readonly BiomeName[] = ['temperate', 'desert', 'snow', 'urban'];

/**
 * Look a biome up by name. An unknown name falls back to temperate with a
 * warning rather than throwing: a scenario with a typo'd biome should still
 * produce a playable, screenshot-able map.
 */
export function getBiome(name: string): BiomeDef {
  const b = (BIOMES as Record<string, BiomeDef | undefined>)[name];
  if (b !== undefined) return b;
  console.warn(`[terrain] unknown biome "${name}" — falling back to temperate`);
  return TEMPERATE;
}

/** True if `name` names a real preset. */
export function isBiomeName(name: string): name is BiomeName {
  return Object.prototype.hasOwnProperty.call(BIOMES, name);
}

/**
 * ============================================================================
 * RED ALERT — src/core/config.ts
 * ============================================================================
 * THE ART DIRECTION BIBLE + EVERY TUNABLE NUMBER IN THE GAME.
 *
 * THIS IS THE FILE A VISUAL CRITIC EDITS. Nothing else.
 *
 * Rules:
 *   - LITERALS ONLY. No functions, no logic, no computed values that depend on
 *     runtime state. (A handful of `derived` constants are computed from other
 *     constants in this same file — those are marked and are pure arithmetic.)
 *   - Type-only imports. This file must never create an import cycle.
 *   - Every value carries a comment naming what it VISUALLY controls, so a
 *     non-programmer can retune the whole game's mood from here.
 *
 * If a critic note conflicts with a number in this file, THE NUMBER CHANGES —
 * not a material file. That is the entire point of this layer.
 * ============================================================================
 */

import type {
  ArtDirection, FactionLook, SurfaceLook, SurfaceArchetype,
  DeepPartial, QualityTier,
} from './types';

/* ==========================================================================
 * 1. SIMULATION TIMING
 * ========================================================================== */

/** Simulation ticks per second. Sim is decoupled from render. */
export const SIM_HZ = 30;
/** Fixed timestep in seconds. Derived. NEVER pass a variable dt to a sim system. */
export const SIM_DT = 1 / SIM_HZ;
/**
 * Max sim steps per rendered frame. On a hitch we drop simulated time rather
 * than spiral into a death loop where catching up causes the next hitch.
 */
export const MAX_SUBSTEPS = 5;
/** Largest real dt we will ever accumulate, in seconds (tab-switch guard). */
export const MAX_FRAME_DT = 0.25;
/** Selectable game speeds. Applied to the accumulator only, never to SIM_DT. */
export const GAME_SPEEDS = [0.5, 1.0, 1.5, 2.0] as const;
export const DEFAULT_SPEED_INDEX = 1;

/* ==========================================================================
 * 2. WORLD SCALE — THE ANTI-SCALE-DRIFT CONTRACT
 *
 * 1 world unit = 1 metre. Everything below is metres unless it says "cells".
 * A 2 m cell makes a 3x3 Construction Yard 6 m wide — narrower than a tank.
 * 4 m cells put buildings at credible RA2 proportions. Do not change CELL.
 * ========================================================================== */

/** Metres per grid cell. FROZEN. */
export const CELL = 4;
/** Map is MAP_CELLS x MAP_CELLS cells. */
export const MAP_CELLS = 128;
/** Map edge length in metres. Derived: 512 m. */
export const MAP_SIZE = CELL * MAP_CELLS;
/** Total cells. Derived: 16384. */
export const MAP_CELL_COUNT = MAP_CELLS * MAP_CELLS;

/** Entity capacity. Allocated once at boot, never grows. */
export const MAX_ENTITIES = 4096;
/** Projectiles live in their OWN store — they are not entities. */
export const MAX_PROJECTILES = 2048;
/** Max simultaneous players (2 human slots + 6 AI). */
export const MAX_PLAYERS = 8;
/** Max entities in one selection. */
export const MAX_SELECTION = 100;
/** Ctrl+0..9. */
export const CONTROL_GROUP_COUNT = 10;
/** The four sidebar tabs in display order. Drives per-player queue creation. */
export const BUILD_TAB_ORDER = [0, 1, 2, 3] as const;

/** Spatial hash cell size in metres. Bigger than CELL: ~2 units per bucket. */
export const SPATIAL_CELL = 8;
/** Spatial grid dimension. Derived: 64. */
export const SPATIAL_DIM = Math.ceil(MAP_SIZE / SPATIAL_CELL);
/** Largest number of results any single spatial query may return. */
export const MAX_QUERY_RESULTS = 256;

/** Terrain height range in metres — plateaus, not mountains. */
export const TERRAIN_MIN_HEIGHT = 0;
export const TERRAIN_MAX_HEIGHT = 24;
/** Water surface height. Anything below this is water. */
export const WATER_LEVEL = 2.0;
/** Slope (radians) above which terrain becomes a cliff: impassable, unbuildable. */
export const CLIFF_SLOPE = 0.62;
/** Slope above which vehicles are slowed but can still climb. */
export const ROUGH_SLOPE = 0.28;

/**
 * FROZEN CANONICAL DIMENSIONS (metres, +/-10% tolerance, asserted by the
 * ModelRegistry at boot). This table is the only defence against
 * "the infantry look like ants" and "the tanks look like toys".
 */
export const UNIT_DIMENSIONS = {
  //                     length  width  height   turret ring Y
  infantry:      { l: 0.52, w: 0.52, h: 1.75, turretY: 0 },
  attackDog:     { l: 1.10, w: 0.40, h: 0.70, turretY: 0 },
  lightTank:     { l: 6.20, w: 3.10, h: 2.25, turretY: 1.50 },  // Grizzly
  heavyTank:     { l: 7.00, w: 3.40, h: 2.50, turretY: 1.62 },  // Rhino
  apocalypse:    { l: 8.20, w: 3.90, h: 2.90, turretY: 1.85 },
  ifv:           { l: 5.40, w: 2.80, h: 2.20, turretY: 1.55 },
  prismTank:     { l: 6.40, w: 3.00, h: 2.40, turretY: 1.55 },
  harvester:     { l: 8.60, w: 4.00, h: 3.30, turretY: 0 },
  mcv:           { l: 9.00, w: 4.40, h: 3.80, turretY: 0 },
} as const;

/** One building storey in metres. Every structure height is a multiple-ish. */
export const STOREY = 3.2;

/** FROZEN building footprints (cells) and heights (metres). */
export const BUILDING_DIMENSIONS = {
  conYard:     { w: 3, h: 3, height: 11.0 },  // crane arm roofline
  refinery:    { w: 3, h: 2, height: 9.0 },   // dock canopy + silo drum
  warFactory:  { w: 3, h: 2, height: 8.5 },   // roll-up door + gantry
  barracks:    { w: 2, h: 2, height: 6.4 },
  powerPlant:  { w: 2, h: 2, height: 9.0 },   // twin stacks
  radar:       { w: 2, h: 2, height: 12.0 },  // tallest non-defense silhouette
  battleLab:   { w: 2, h: 2, height: 8.0 },
  oreSilo:     { w: 1, h: 1, height: 5.0 },
  pillbox:     { w: 1, h: 1, height: 2.2 },
  teslaCoil:   { w: 1, h: 1, height: 9.0 },
  prismTower:  { w: 1, h: 1, height: 8.0 },
  flameTower:  { w: 1, h: 1, height: 5.5 },
  wall:        { w: 1, h: 1, height: 2.0 },
} as const;

/* ==========================================================================
 * 3. CAMERA
 *
 * The pitch is FIXED. A fixed pitch is why the shadow cascades can be fitted
 * cheaply and correctly, and why every model only has to read from one angle.
 * ========================================================================== */

export const CAMERA = {
  /** Degrees below horizontal. 52 is the RA2 "angled near-top-down" read. */
  pitchDeg: 52,
  /** Vertical field of view in degrees. Narrow keeps the perspective honest. */
  fovDeg: 36,
  /** Closest dolly distance in metres. */
  minDistance: 30,
  /** Furthest dolly distance in metres. */
  maxDistance: 140,
  /**
   * Default distance. At 55 m a 2.25 m tank reads ~68 px tall at 1080p —
   * that is the resolution the silhouette test is run at.
   */
  defaultDistance: 55,
  /** Metres/sec of WASD pan at the default zoom (scales with distance). */
  panSpeed: 48,
  /** Screen-edge band in pixels that triggers edge panning. */
  edgePanPixels: 8,
  /** Edge pan speed multiplier relative to keyboard pan. */
  edgePanScale: 1.0,
  /** Fraction of the remaining distance consumed per wheel notch. */
  zoomStep: 0.12,
  /** Critically-damped spring half-life in seconds for pan/zoom smoothing. */
  smoothing: 0.08,
  /** Radians/sec of Q/E yaw rotation. */
  yawSpeed: 1.4,
  /** Near/far planes. Tight near plane keeps depth precision for SSAO. */
  near: 1.0,
  far: 900,
  /** Metres of margin outside the map the camera may pan to. */
  panMargin: 24,
} as const;

/* ==========================================================================
 * 4. ART DIRECTION — SUN, SKY, ATMOSPHERE
 * ========================================================================== */

const SUN_NOON = {
  /** Compass degrees. Governs which side of every building is lit. */
  azimuthDeg: 312,
  /** Degrees above horizon. Low = long dramatic shadows; high = flat. */
  elevationDeg: 38,
  /** ~5200 K warm daylight. The single biggest driver of "what time is it". */
  color: '#FFE7C4',
  /** Direct sun strength in the HDR buffer, pre-tonemap. */
  intensity: 3.1,
  /** Shadows are TINTED, not black — black shadows read as holes. */
  shadowColor: '#2A3550',
  /** Poisson PCF radius in shadow texels. Higher = softer, mushier contact. */
  shadowSoftness: 2.2,
  shadowBias: -0.0005,
  shadowNormalBias: 0.02,
  /** How dark shadows go. 1.0 = fully black. */
  shadowIntensity: 0.92,
  /** Near cascade covers 90 m; far covers 320 m. Texel-snapped so shadows
   *  do not crawl when the camera pans. */
  cascadeNear: 90,
  cascadeFar: 320,
  cascadeResolution: 2048,
};

const ATMOSPHERE_NOON = {
  /** Sky-coloured ambient from above. Fills the shadow side of everything. */
  hemiSky: '#8FB6E8',
  hemiSkyIntensity: 0.55,
  /** Warm bounce from the ground. Stops undersides going dead grey. */
  hemiGround: '#6A5A48',
  hemiGroundIntensity: 0.35,
  /** Procedural sky dome ramp. */
  skyZenith: '#3E6FA8',
  skyHorizon: '#C6D4DE',
  skyGround: '#6E6252',
  /** Angular size of the sun disk in degrees. */
  sunDiskDeg: 0.6,
  /** Width of the bright haze band above the horizon, in degrees. */
  hazeWidthDeg: 8,
  /** Height fog — the depth cue that stops the map reading as a flat table. */
  fogColor: '#B8C6D6',
  fogDensity: 0.0075,
  /** Fog thins with altitude at this rate per metre. */
  fogHeightFalloff: 0.045,
  /** Metres before fog starts accumulating. */
  fogStart: 60,
  /** Blend of distant geometry toward sky colour. */
  aerialPerspective: 0.35,
  /** Image-based lighting strength, regenerated from the sky on art change. */
  envIntensity: 0.85,
};

/* ==========================================================================
 * 5. TONEMAP AND GRADE
 *
 * ALL of this happens in GradePass, AFTER bloom. The renderer itself is set to
 * NoToneMapping. Bloom must threshold in HDR before tonemapping or the
 * threshold means nothing.
 * ========================================================================== */

const TONE_NOON = {
  /** 'agx' has the best highlight rolloff for bright emissives on dark armour. */
  mode: 'agx',
  /** Master exposure. The first knob to turn for "the image is muddy". */
  exposure: 1.05,
  contrast: 1.06,
  saturation: 1.04,
  /** Shadows desaturate slightly — a filmic trick that reads as "graded". */
  shadowSaturation: 0.88,
  /** 3-way colour balance: cool shadows, neutral mids, warm highlights. */
  shadowTint: '#1B2A44',
  midTint: '#8C8578',
  highlightTint: '#FFEBC8',
  /** Lift raises the black point (never crush to pure black). */
  lift: '#0A1220',
  /** Gain tints the white point. */
  gain: '#FFF4E2',
  /** Corner darkening. Focuses the eye on the centre of the battle. */
  vignette: 0.28,
  vignetteSoftness: 0.55,
  /** Film grain. Subtle — it hides banding in the fog gradient. */
  grain: 0.018,
  grainSize: 1.4,
  /** Lens colour fringing at the edges. Tiny amounts read as "a real lens". */
  chromaticAberration: 0.0012,
  /** Post-sharpen. Recovers the crispness SMAA costs. */
  sharpen: 0.22,
  /** Edge length of the baked colour LUT (32^3 = one texture fetch). */
  lutSize: 32,
};

const BLOOM_NOON = {
  /**
   * HDR threshold, PRE-tonemap. At 1.25 only genuine emissives bloom.
   * Lower this and white concrete starts hazing, which is the classic
   * "everything looks like a mobile game" failure.
   */
  threshold: 1.25,
  strength: 0.55,
  radius: 0.70,
  mips: 5,
  /** Extra gain applied to pixels flagged emissive by the material. */
  emissiveBoost: 1.6,
  /** Procedural smudge mask modulating the bloom. */
  lensDirt: 0.12,
};

const AO_NOON = {
  enabled: true,
  samples: 12,
  /** World-space radius in metres. Sized to a tank track, not a room. */
  radius: 1.6,
  intensity: 0.85,
  power: 1.6,
  /** Half-res + bilateral upsample. AMBIENT ONLY — must never darken direct sun. */
  halfRes: true,
};

const OUTLINE_NOON = {
  widthPx: 1.6,
  /** Aquamarine selection rim — reads on both blue and red armour. */
  selected: '#7FFFD4',
  hovered: '#FFFFFF',
  hoveredAlpha: 0.5,
  enemy: '#FF5A4A',
  ally: '#4ADE80',
};

/* ==========================================================================
 * 6. FACTION PALETTES
 *
 * The mechanism that makes 20 independently-authored models read as two armies.
 * Team colour is a per-INSTANCE attribute, never a batch key — one batch covers
 * both armies.
 * ========================================================================== */

/** ALLIES — clean steel, cold light, chamfered. No visible rivets. */
const ALLIES_LOOK: FactionLook = {
  armorBase: '#4A5F73',
  armorSecondary: '#5F7386',
  /** The team tint. Also the HUD accent and the minimap blip. */
  team: '#2F6FD0',
  accentStripe: '#E8EEF2',
  /** Cool cyan panel glow. */
  emissivePanel: '#6FD8FF',
  emissiveIntensity: 2.4,
  glass: '#17324A',
  concrete: '#B9BCB6',
  trimMetal: '#8E9AA3',
  /** Colour exposed where paint has worn off edges. */
  bareMetal: '#6E6A66',
  rust: '#6B4A32',
  tracer: '#8FD2FF',
  explosionTint: '#FFD9A0',
  hudAccent: '#3A86E0',
  camo: ['#4A5F73', '#3C4E5E', '#61748A'],
  /** Metres per camo blob. Tighter than Soviet = reads as "engineered". */
  camoScale: 2.2,
  /** 0 = fully chamfered/aero. */
  silhouetteBias: 0.0,
  useRivets: false,
  rivetSpacing: 0,
  /** Generous chamfer catches specular — 80% of perceived material quality. */
  chamfer: 0.045,
};

/** SOVIETS — rust, heat, slab. Rivet rings on every seam. */
const SOVIETS_LOOK: FactionLook = {
  armorBase: '#5A4038',
  armorSecondary: '#6E4A3A',
  team: '#C0271E',
  accentStripe: '#E8C24A',
  /** Hot orange furnace glow. */
  emissivePanel: '#FF7A2A',
  emissiveIntensity: 2.8,
  glass: '#1E1A16',
  concrete: '#8C857A',
  trimMetal: '#7A6A5C',
  bareMetal: '#6E6A66',
  rust: '#7A3B1E',
  tracer: '#FFB04A',
  explosionTint: '#FF9040',
  hudAccent: '#C0271E',
  camo: ['#5A4038', '#4A3226', '#6B5240'],
  /** Looser blobs = reads as "field-applied". */
  camoScale: 3.4,
  /** 1 = fully slab/brutalist. */
  silhouetteBias: 1.0,
  useRivets: true,
  /** Rivet rings every 0.35 m along every major seam. */
  rivetSpacing: 0.35,
  /** Minimum bevel only — but NEVER zero. A raw 90° edge reads as plastic. */
  chamfer: 0.02,
};

/** NEUTRAL / GAIA — ore, rock, foliage, wrecks. */
const NEUTRAL_LOOK: FactionLook = {
  armorBase: '#7C7468',
  armorSecondary: '#6A6358',
  team: '#C8C4B8',
  accentStripe: '#9A9488',
  /** Ore crystal glow. */
  emissivePanel: '#FFC64A',
  emissiveIntensity: 0.9,
  glass: '#2A2A28',
  concrete: '#9A968C',
  trimMetal: '#7C7468',
  bareMetal: '#6E6A66',
  rust: '#6A4028',
  tracer: '#FFFFFF',
  explosionTint: '#FFC090',
  hudAccent: '#8A939C',
  camo: ['#7C7468', '#4E5F3A', '#6A6358'],
  camoScale: 3.0,
  silhouetteBias: 0.5,
  useRivets: false,
  rivetSpacing: 0,
  chamfer: 0.03,
};

/** Ore crystal colour. Referenced by both terrain and HUD. */
export const ORE_CRYSTAL_COLOR = '#FFC64A';
/** Neutral rock. */
export const ROCK_COLOR = '#7C7468';
/** Neutral foliage. */
export const FOLIAGE_COLOR = '#4E5F3A';

/* ==========================================================================
 * 7. SURFACE ARCHETYPES — falsifiable PBR ranges
 *
 * Painted steel is a DIELECTRIC over metal. metalness is never 1.0 on armour.
 * "Reads as a plastic toy" is almost always a missing bevel plus missing edge
 * wear, and both are tuned right here.
 * ========================================================================== */

const S = (
  roughnessMin: number, roughnessMax: number, roughnessVariance: number,
  metalness: number, edgeWear: number, grime: number,
  clearcoat: number, rust: number, sheen: number,
): SurfaceLook => ({
  roughnessMin, roughnessMax, roughnessVariance, metalness,
  edgeWear, grime, clearcoat, rust, sheen,
});

const SURFACES: Record<SurfaceArchetype, SurfaceLook> = {
  /** THE most critic-sensitive surface in the game. */
  vehicleArmor:      S(0.52, 0.72, 0.10, 0.15, 0.35, 0.30, 0.25, 0.10, 0.00),
  /** Dark rubber/steel, UV scrolled by treadPhase. Heavy dust accumulation. */
  vehicleTread:      S(0.85, 0.95, 0.04, 0.35, 0.15, 0.45, 0.00, 0.05, 0.00),
  /** No transmission — far too expensive at RTS counts. */
  vehicleGlass:      S(0.08, 0.08, 0.00, 0.00, 0.05, 0.10, 1.00, 0.00, 0.00),
  /** Downward grime streaks from every top edge: cheapest realism trick here. */
  buildingConcrete:  S(0.80, 0.92, 0.06, 0.00, 0.10, 0.45, 0.00, 0.05, 0.00),
  buildingPanel:     S(0.45, 0.62, 0.08, 0.25, 0.28, 0.35, 0.10, 0.15, 0.00),
  /** Bottom-up reveal with a hot emissive scan band. */
  construction:      S(0.60, 0.75, 0.05, 0.20, 0.20, 0.20, 0.00, 0.00, 0.00),
  /** Cloth is NEVER metallic. */
  infantryCloth:     S(0.88, 0.96, 0.04, 0.00, 0.10, 0.35, 0.00, 0.00, 0.25),
  terrainDirt:       S(0.93, 0.93, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  terrainGrass:      S(0.90, 0.90, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.10),
  terrainRock:       S(0.82, 0.82, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  /** Slightly wet-looking. Puddles at 0.12. */
  terrainRoad:       S(0.72, 0.72, 0.00, 0.00, 0.00, 0.20, 0.00, 0.00, 0.00),
  /** Emissive scales with remaining ore amount. */
  oreCrystal:        S(0.22, 0.22, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  water:             S(0.06, 0.06, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  wreck:             S(0.88, 0.88, 0.06, 0.20, 0.45, 0.60, 0.00, 0.55, 0.00),
  debris:            S(0.88, 0.88, 0.06, 0.20, 0.30, 0.50, 0.00, 0.40, 0.00),
  foliage:           S(0.85, 0.92, 0.05, 0.00, 0.00, 0.10, 0.00, 0.00, 0.20),
  overlay:           S(1.00, 1.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  particle:          S(1.00, 1.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
  decal:             S(0.90, 0.90, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
};

/** Soot colour burned into damaged armour. */
export const DAMAGE_SOOT_COLOR = '#14100C';
/** Ember emissive on burning wrecks. */
export const EMBER_EMISSIVE_COLOR = '#FF5A18';
/** Panel gap width in metres — Allies only. */
export const PANEL_GAP = 0.015;
/** Absolute minimum chamfer on ANY edge in the game. Never zero. */
export const MIN_CHAMFER = 0.02;

/* ==========================================================================
 * 8. VFX LOOK
 * ========================================================================== */

const VFX_NOON = {
  /**
   * Fire gradient sampled by normalized particle life. The last stop being
   * near-black soot is what stops explosions reading as an orange blob.
   */
  fireGradient: [
    [0.00, '#FFF4C8'],  // white-hot core
    [0.12, '#FFC24A'],  // yellow
    [0.35, '#FF6A18'],  // orange
    [0.65, '#8C2A0E'],  // dark red
    [1.00, '#231A16'],  // soot
  ] as readonly (readonly [number, string])[],
  smokeColor: '#5A5450',
  smokeOpacity: 0.55,
  /** Metres/sec the plume climbs. */
  smokeRise: 2.4,
  /** Lateral spread factor. */
  smokeSpread: 0.9,
  /** Dust is sampled from terrain albedo so it matches the ground it came from. */
  dustOpacity: 0.40,
  muzzleColor: '#FFE9B0',
  /** Muzzle flash lifetime in ms. Short and hot. */
  muzzleMs: 90,
  muzzleSize: 0.9,
  teslaCore: '#FFFFFF',
  teslaArc: '#9BE0FF',
  /** Midpoint-displacement jitter. Too high reads as a scribble. */
  teslaJitter: 0.35,
  teslaBranches: 3,
  prismCore: '#B8F0FF',
  prismHalo: '#3A86E0',
  sparkColor: '#FFC24A',
  emberColor: '#FF5A18',
  shockwaveStrength: 0.6,
  scorchColor: '#171310',
  scorchOpacity: 0.62,
  /** Tread mark darkness. Cures "tanks glide with no weight". */
  treadOpacity: 0.30,
  /** Seconds before a decal has fully faded. */
  decalFadeSec: 45,
  screenShake: 0.55,
};

/* ==========================================================================
 * 9. TERRAIN / WATER / SHROUD LOOK
 * ========================================================================== */

const TERRAIN_NOON = {
  grass: '#5A6B44',
  dirt: '#7A6A52',
  rock: '#7C7468',
  sand: '#A99878',
  road: '#4E4B48',
  cliff: '#6E6558',
  /** Metres per repeat of the detail normal. Small = crisp close up. */
  detailScale: 2.0,
  /** Metres per repeat of the macro breakup noise. Large = no visible tiling. */
  macroScale: 96,
  /** Wet puddle coverage on roads. */
  puddles: 0.12,
};

const WATER_NOON = {
  shallow: '#3E6E62',
  deep: '#123038',
  /** Higher = the water only goes reflective at grazing angles. */
  fresnelPower: 4.2,
  foamColor: '#E4F0EE',
  /** Metres of foam band at the shoreline. */
  foamWidth: 1.8,
  waveSpeed: 0.06,
  waveScale: 6.0,
  roughness: 0.06,
};

const SHROUD_NOON = {
  /** Explored-but-not-visible terrain is TINTED, so fog reads as memory. */
  exploredTint: '#3A4250',
  exploredDesat: 0.65,
  /** Never-explored area. Near black, but not pure black. */
  unexploredColor: '#05070A',
  /** Metres of soft ramp at the shroud edge. */
  edgeSoftness: 6.0,
  /** Slow cloud noise so the edge never looks like a checkerboard. */
  noiseScale: 40,
  noiseSpeed: 0.012,
};

/* ==========================================================================
 * 10. HUD LOOK — chunky industrial metal and rivets
 * ========================================================================== */

const HUD_NOON = {
  metalDark: '#1B1F24',
  metalMid: '#2E353C',
  metalLight: '#4A545E',
  bevelLight: '#6B7681',
  bevelDark: '#12161A',
  rivet: '#8A939C',
  /** Phosphor green-cyan for the minimap and readouts. */
  screenGlow: '#7FD8C0',
  scanline: 0.10,
  textPrimary: '#DCE4EA',
  textDim: '#7C8792',
  danger: '#E03A2A',
  warn: '#E0A72A',
  ok: '#4ADE80',
  cornerRadiusPx: 3,
  rivetSpacingPx: 22,
  panelNoise: 0.06,
  /** Condensed and industrial. NEVER a default UI font. */
  fontStack: "'Rajdhani','Oswald','Arial Narrow',sans-serif",
};

/** Sidebar width in CSS pixels. The iconic right-hand vertical shell. */
export const SIDEBAR_WIDTH_PX = 232;
/** Minimap canvas size in CSS pixels. */
export const MINIMAP_SIZE_PX = 216;
/** Build cameo tile size in CSS pixels. */
export const CAMEO_SIZE_PX = 60;
/** HUD text refresh rate — 15 Hz is imperceptible and saves layout thrash. */
export const HUD_TEXT_HZ = 15;
/** Minimap redraw rate. */
export const MINIMAP_HZ = 20;

/* ==========================================================================
 * 11. THE ASSEMBLED ART DIRECTION
 *
 * `DEFAULT_ART` is the single instance every material, pass and generator
 * reads. ArtStore holds the live copy; a critic can mutate it at runtime and
 * every ArtAware listener re-applies its uniforms.
 * ========================================================================== */

export const DEFAULT_ART: ArtDirection = {
  sun: { ...SUN_NOON },
  atmosphere: { ...ATMOSPHERE_NOON },
  tone: { ...TONE_NOON },
  bloom: { ...BLOOM_NOON },
  ao: { ...AO_NOON },
  outline: { ...OUTLINE_NOON },
  vfx: { ...VFX_NOON },
  terrain: { ...TERRAIN_NOON },
  water: { ...WATER_NOON },
  shroud: { ...SHROUD_NOON },
  hud: { ...HUD_NOON },
  surfaces: SURFACES,
  factions: {
    neutral: NEUTRAL_LOOK,
    allies: ALLIES_LOOK,
    soviets: SOVIETS_LOOK,
  },
};

/** Convenience alias so non-art code can grab a faction's colours directly. */
export const FACTION_PALETTE = DEFAULT_ART.factions;

/* ==========================================================================
 * 12. MOODS — whole-game A/B in 90 seconds via ?art=<mood>
 * ========================================================================== */

export const MOODS: Record<string, DeepPartial<ArtDirection>> = {
  /** The shipping look. */
  noon: {},

  /** Long shadows, warm rim light, orange haze. The screenshot mood. */
  dusk: {
    sun: {
      elevationDeg: 12, azimuthDeg: 288,
      color: '#FF9E5A', intensity: 3.6, shadowColor: '#2A2038',
    },
    atmosphere: {
      fogColor: '#E0A878', fogDensity: 0.0115,
      skyZenith: '#2A4A78', skyHorizon: '#F0B080', hemiSky: '#9A86C8',
      hemiGround: '#7A5838',
    },
    tone: { exposure: 1.15, shadowTint: '#241A38', highlightTint: '#FFD0A0' },
  },

  /** Emissives carry the whole image. Bloom threshold drops so panels glow. */
  night: {
    sun: {
      elevationDeg: -6, color: '#7C9CD8', intensity: 0.8,
      shadowColor: '#0A1020', shadowIntensity: 0.6,
    },
    atmosphere: {
      fogColor: '#14203A', fogDensity: 0.014,
      skyZenith: '#060C1A', skyHorizon: '#1A2A44', skyGround: '#0A0E14',
      hemiSky: '#2A3A5E', hemiSkyIntensity: 0.35,
      hemiGround: '#181410', hemiGroundIntensity: 0.20,
      envIntensity: 0.45,
    },
    bloom: { threshold: 0.85, strength: 0.72, emissiveBoost: 2.4 },
    tone: { exposure: 1.20, shadowSaturation: 0.75 },
  },

  /** Flat, soft, desaturated. The "is the lighting carrying this?" control. */
  overcast: {
    sun: { intensity: 1.4, shadowSoftness: 6.0, shadowIntensity: 0.55, color: '#E8ECF0' },
    atmosphere: {
      fogColor: '#C8CED6', fogDensity: 0.010,
      skyZenith: '#8A98A8', skyHorizon: '#D8DEE4',
      hemiSkyIntensity: 0.85, envIntensity: 1.0,
    },
    tone: { saturation: 0.86, contrast: 1.02 },
  },

  /** Heavy dust haze. Kills long sightlines, makes the midfield read closer. */
  dust: {
    sun: { color: '#FFD8A0', intensity: 2.6 },
    atmosphere: {
      fogColor: '#C8A878', fogDensity: 0.022, fogStart: 30,
      skyHorizon: '#D8BC94', aerialPerspective: 0.55,
    },
    tone: { saturation: 0.94 },
  },
};

/* ==========================================================================
 * 13. RENDER QUALITY TIERS
 *
 * The governor drops resolutionScale BEFORE it drops particles. A slightly
 * softer image photographs better than a battlefield with no smoke.
 * ========================================================================== */

export interface QualitySettings {
  resolutionScale: number;
  shadowResolution: number;
  shadowCascades: number;
  ssao: boolean;
  bloom: boolean;
  godRays: boolean;
  heatHaze: boolean;
  /** 'smaa' | 'fxaa' | 'none'. */
  antialias: string;
  maxParticles: number;
  maxDecals: number;
  maxDynamicLights: number;
  waterReflections: boolean;
  /** Metres at which units drop to their lowest LOD. */
  lodBias: number;
  anisotropy: number;
  /** Edge length of generated albedo textures. */
  textureSize: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = {
  0 /* Low */: {
    resolutionScale: 0.72, shadowResolution: 1024, shadowCascades: 1,
    ssao: false, bloom: true, godRays: false, heatHaze: false,
    antialias: 'fxaa', maxParticles: 1200, maxDecals: 128, maxDynamicLights: 2,
    waterReflections: false, lodBias: 0.6, anisotropy: 1, textureSize: 256,
  },
  1 /* Medium */: {
    resolutionScale: 0.85, shadowResolution: 1536, shadowCascades: 2,
    ssao: true, bloom: true, godRays: false, heatHaze: false,
    antialias: 'smaa', maxParticles: 3000, maxDecals: 256, maxDynamicLights: 4,
    waterReflections: false, lodBias: 0.85, anisotropy: 4, textureSize: 512,
  },
  2 /* High */: {
    resolutionScale: 1.0, shadowResolution: 2048, shadowCascades: 2,
    ssao: true, bloom: true, godRays: true, heatHaze: true,
    antialias: 'smaa', maxParticles: 6000, maxDecals: 512, maxDynamicLights: 8,
    waterReflections: true, lodBias: 1.0, anisotropy: 8, textureSize: 512,
  },
  3 /* Ultra */: {
    resolutionScale: 1.0, shadowResolution: 2048, shadowCascades: 2,
    ssao: true, bloom: true, godRays: true, heatHaze: true,
    antialias: 'smaa', maxParticles: 10000, maxDecals: 768, maxDynamicLights: 8,
    waterReflections: true, lodBias: 1.4, anisotropy: 16, textureSize: 1024,
  },
};

export const DEFAULT_QUALITY_TIER = 2 as QualityTier;

/** Governor: drop a tier if the rolling average frame time exceeds this (ms). */
export const GOVERNOR_DROP_MS = 21.0;
/** Governor: consider raising quality below this (ms). */
export const GOVERNOR_RAISE_MS = 12.5;
/** Frames of rolling average before the governor acts. */
export const GOVERNOR_WINDOW = 90;
/** Lower bound on resolutionScale. Below this the image is unacceptable. */
export const MIN_RESOLUTION_SCALE = 0.6;

/* ==========================================================================
 * 14. RENDER ORDER BANDS
 *
 * No module ever writes a raw renderOrder integer — it picks a band.
 * ========================================================================== */

export const RENDER_ORDER = {
  terrain: 0,
  decals: 100,
  opaque: 200,
  water: 300,
  particles: 1000,
  trails: 1100,
  overlay: 2000,
  shroud: 3000,
} as const;

/** Camera/mesh layer bits. */
export const LAYERS = {
  default: 0,
  terrain: 1,
  units: 2,
  effects: 3,
  overlay: 4,
  /** Rendered only into the reflection RT. */
  reflection: 5,
  /** Excluded from shadow casting. */
  noShadow: 6,
} as const;

/* ==========================================================================
 * 15. PERFORMANCE CONTRACT
 * ========================================================================== */

/** Hard target: 60 fps with 200+ active units. */
export const TARGET_FPS = 60;
/** Draw call ceiling. Exceeding this means a batch key is wrong. */
export const MAX_DRAW_CALLS = 130;
/** Cells a flow field may expand per tick, across ALL fields. */
export const FLOWFIELD_BUDGET_CELLS = 8000;
/** Goal positions quantize to this many cells, so a selection shares a field. */
export const FLOWFIELD_GOAL_BUCKET = 4;
/** LRU capacity for cached flow fields. */
export const FLOWFIELD_CACHE_SIZE = 24;
/** Fraction of units that re-run target acquisition per tick (1/8 = 12.5%). */
export const TARGETING_SLICE = 8;
/** Vision is stamped every Nth tick. */
export const VISION_TICK_INTERVAL = 3;
/** Ore summary grid rebuild interval in ticks. */
export const ORE_SCORING_INTERVAL = 30;
/** Max neighbours considered for unit separation. */
export const SEPARATION_NEIGHBOURS = 8;
/** Overlap relaxation iterations per movement tick. */
export const RELAX_ITERATIONS = 2;
/** Max relaxation push per iteration, as a fraction of the unit radius. */
export const RELAX_MAX_PUSH = 0.35;
/** Relaxation damping. */
export const RELAX_DAMPING = 0.5;

/* ==========================================================================
 * 16. BALANCE GLOBALS
 *
 * Content lives in the data/ tables. These are the cross-cutting multipliers
 * that tune the FEEL of the economy and the fight.
 * ========================================================================== */

/** Starting credits. */
export const START_CREDITS = 10000;
/** Credits a refinery adds to the storage cap. */
export const REFINERY_STORAGE = 2000;
/** Credits an ore silo adds. */
export const SILO_STORAGE = 1500;
/** Base storage with no refinery (so you can bank a little before one exists). */
export const BASE_STORAGE = 1000;

/** Credits per ore unit. */
export const ORE_VALUE = 1.0;
/** Ore units in a full harvester load. */
export const HARVESTER_CAPACITY = 700;
/** Ore units scooped per second while parked on a cell. */
export const HARVEST_RATE = 140;
/** Seconds a full harvester spends unloading. Credits stream in over this. */
export const UNLOAD_SECONDS = 2.2;
/** Target round-trip time in seconds. Used to sanity-check ore field placement. */
export const HARVESTER_TARGET_ROUNDTRIP = 32;
/** Ore units a cell regrows per second (0 disables regrowth). */
export const ORE_REGROW_RATE = 0.6;
/** Max ore a single cell can hold. */
export const ORE_CELL_MAX = 900;

/** Build speed multiplier when power is fully satisfied. */
export const POWER_FULL_MUL = 1.0;
/** Build speed multiplier at total blackout. Never zero — that is a soft lock. */
export const POWER_BLACKOUT_MUL = 0.25;
/** Max queue depth per tab. */
export const MAX_QUEUE_DEPTH = 9;
/** Speed bonus per additional factory servicing a tab, additive. */
export const FACTORY_SPEED_BONUS = 0.35;
/** Cap on the multi-factory bonus. */
export const FACTORY_SPEED_CAP = 2.0;
/** Fraction of the build cost returned when selling a structure. */
export const SELL_REFUND = 0.5;
/** HP per second restored by structure repair. */
export const REPAIR_RATE = 30;
/** Credits per HP repaired. */
export const REPAIR_COST_PER_HP = 0.25;
/** Metres from a Construction Yard within which you may build. */
export const BUILD_RADIUS = 56;
/** Seconds a structure takes to visually rise (independent of build time). */
export const CONSTRUCTION_RISE_SECONDS = 2.0;

/** Kills required for veterancy ranks 1 and 2. */
export const VETERANCY_KILLS = [3, 6] as const;
/** Damage multiplier per rank (index 0 = rookie). */
export const VETERANCY_DAMAGE = [1.0, 1.15, 1.35] as const;
/** Max-HP multiplier per rank. */
export const VETERANCY_HP = [1.0, 1.10, 1.25] as const;

/** Seconds a wreck burns before it is removed. */
export const WRECK_LIFETIME = 22;
/** Damage per second taken while Burning. */
export const BURN_DPS = 4;
/** HP fraction below which a unit starts smoking. */
export const SMOKE_HP_THRESHOLD = 0.5;
/** HP fraction below which a unit catches fire. */
export const BURN_HP_THRESHOLD = 0.25;
/** Minimum seconds between "base under attack" EVA lines. */
export const UNDER_ATTACK_COOLDOWN = 20;
/** Seconds a unit remembers who last shot it (for retaliation). */
export const RETALIATE_MEMORY = 4;
/** Metres a Guard-stance unit will chase before returning. */
export const GUARD_LEASH = 18;

/** Vision regrowth delay in seconds after a unit leaves a cell. */
export const VISION_REGROW_DELAY = 2.0;

/* ==========================================================================
 * 17. AI TUNING
 * ========================================================================== */

/** Per-difficulty: [reactionSec, apmCap, waveSizeMul, expansionAggression]. */
export const AI_DIFFICULTY = [
  { name: 'Easy',   reactionSec: 2.4, apmCap: 40,  waveSizeMul: 0.6, aggression: 0.4, resourceBonus: 1.0 },
  { name: 'Normal', reactionSec: 1.2, apmCap: 90,  waveSizeMul: 1.0, aggression: 0.7, resourceBonus: 1.0 },
  { name: 'Hard',   reactionSec: 0.6, apmCap: 160, waveSizeMul: 1.4, aggression: 1.0, resourceBonus: 1.15 },
  { name: 'Brutal', reactionSec: 0.3, apmCap: 260, waveSizeMul: 1.8, aggression: 1.3, resourceBonus: 1.35 },
] as const;

/** Personalities bias the strategy scoring, not the rules. */
export const AI_PERSONALITY = [
  { name: 'Turtle', economy: 1.1, army: 0.7, tech: 1.2, defense: 1.6, push: 0.5 },
  { name: 'Rusher', economy: 0.7, army: 1.5, tech: 0.6, defense: 0.5, push: 1.6 },
  { name: 'Boomer', economy: 1.5, army: 0.9, tech: 1.3, defense: 0.9, push: 0.8 },
] as const;

/** AI squad size range. */
export const AI_SQUAD_MIN = 6;
export const AI_SQUAD_MAX = 10;
/** Brain re-evaluation rates in Hz. */
export const AI_STRATEGY_HZ = 1;
export const AI_PRODUCTION_HZ = 2;
export const AI_SQUAD_HZ = 5;

/* ==========================================================================
 * 18. INPUT
 * ========================================================================== */

/** Pixels of mouse travel before a click becomes a drag-box. */
export const DRAG_THRESHOLD_PX = 5;
/** Milliseconds within which two clicks count as a double-click. */
export const DOUBLE_CLICK_MS = 300;
/** Metres of radius used for a single-click entity pick. */
export const PICK_RADIUS = 1.6;
/** Seconds the selection bracket pulses after an order is issued. */
export const ORDER_PULSE_SECONDS = 0.35;

/* ==========================================================================
 * 19. DEBUG / HARNESS
 * ========================================================================== */

/** Fixed render size for ?shot= screenshots, so they are diffable run to run. */
export const SHOT_WIDTH = 1920;
export const SHOT_HEIGHT = 1080;
/** Seed used whenever no ?seed= is supplied. */
export const DEFAULT_SEED = 0x5eed1234;
/** Seconds the determinism soak simulates. */
export const SOAK_MINUTES = 20;

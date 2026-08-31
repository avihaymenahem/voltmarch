/**
 * Domain-owned config slice: water surface, shore and wake presentation.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 21. WATER — THE HERO SURFACE
 *
 * Bible §7 + RULING #7 + R7. Water is ABSORPTION + REFRACTED SEABED + FOAM +
 * TIGHT GLINT. It is not a mirror, and the single number that protects the
 * whole look is `WATER_SSR.mixMax`: the moment a reflection term climbs past
 * 0.10 the open-water median jumps over L=115, foam stops popping and every
 * naval map reads as a mobile game.
 *
 * Distances are metres. 1 TL (tank length) = 7 m; every figure the bible
 * quotes in TL is converted here ONCE so no shader ever multiplies by 7.
 * Pixel figures are quoted at 2560x1440 default zoom, where the camera
 * resolves 29.6 px per metre (207 px per 7 m, bible §15 camera targets).
 * ========================================================================== */

/** 1 tank length. The bible's unit of length for waves, foam and wakes. */
export const TANK_LENGTH_METRES = 7;
/**
 * One authored depth stop of the absorption ramp. `t` is normalised depth,
 * 0 at the waterline and 1 at `WATER_LOOK.rampDepthMetres`.
 */
export interface WaterRampStop {
  readonly t: number;
  readonly hex: string;
}

export interface WaterPalette {
  readonly name: string;
  /** Bible §7 depth ramp, waterline -> deep. Resampled to 8 even stops. */
  readonly ramp: readonly WaterRampStop[];
  /** Per-metre extinction. Red dies first — this is what makes water read wet. */
  readonly absorb: readonly [number, number, number];
  /** Seabed albedo just under the waterline (the biome's own silt/sand). */
  readonly seabed: string;
  /** Open-water foam. Takes the key colour (bible §7). */
  readonly foam: string;
  /** Shoreline churn: core, mid, and the local lightening of the water there. */
  readonly shoreFoam: string;
  readonly shoreMid: string;
  readonly shoreWater: string;
  /**
   * What the <=0.10 grazing term reflects. This is the LAND — cliff shade —
   * never a sky. A sky value here is exactly the failure R7 describes.
   */
  readonly reflect: string;
}

/** Bible §7 tropical. The hero palette; refs/ra3steam_00.jpg is this water. */
const WATER_TROPICAL: WaterPalette = {
  name: 'tropical',
  ramp: [
    { t: 0.00, hex: '#3E7A6E' },
    { t: 0.25, hex: '#1D4A44' },
    { t: 0.50, hex: '#12332E' },
    { t: 0.80, hex: '#0B2921' },
    { t: 0.92, hex: '#041F1A' },
    { t: 1.00, hex: '#00120E' },
  ],
  absorb: [0.62, 0.28, 0.20],
  seabed: '#757A55',
  foam: '#F1F1E9',
  shoreFoam: '#B8CEDA',
  shoreMid: '#7A96A6',
  shoreWater: '#3A5A66',
  reflect: '#4A4438',
};

/** Bible §7 "Japan coast" — the temperate/greenish-grey sea. */
const WATER_TEMPERATE: WaterPalette = {
  name: 'temperate',
  ramp: [
    { t: 0.00, hex: '#5E8A92' },
    { t: 0.28, hex: '#4C6A75' },
    { t: 0.55, hex: '#265461' },
    { t: 0.80, hex: '#1C3D4E' },
    { t: 1.00, hex: '#0A2032' },
  ],
  absorb: [0.58, 0.30, 0.24],
  seabed: '#6B6B4C',
  foam: '#E8DCC8',
  shoreFoam: '#B8CEDA',
  shoreMid: '#7A96A6',
  shoreWater: '#3A5A66',
  reflect: '#4E4A3C',
};

/** VISUAL_DNA §1.5.4 arctic — the only genuinely blue water in the game. */
const WATER_ARCTIC: WaterPalette = {
  name: 'arctic',
  ramp: [
    { t: 0.00, hex: '#4E7CA8' },
    { t: 0.30, hex: '#254262' },
    { t: 0.62, hex: '#06305F' },
    { t: 0.85, hex: '#0A2340' },
    { t: 1.00, hex: '#06182A' },
  ],
  absorb: [0.70, 0.34, 0.16],
  seabed: '#5E6672',
  foam: '#FFFFFF',
  shoreFoam: '#C5D7F7',
  shoreMid: '#98BFF4',
  shoreWater: '#3F6C96',
  reflect: '#3E4A56',
};

/** VISUAL_DNA §1.5.4 temperate ocean — the desaturated harbour/urban water. */
const WATER_HARBOUR: WaterPalette = {
  name: 'harbour',
  ramp: [
    { t: 0.00, hex: '#4A5464' },
    { t: 0.30, hex: '#313949' },
    { t: 0.62, hex: '#283142' },
    { t: 0.86, hex: '#20222C' },
    { t: 1.00, hex: '#1B1A20' },
  ],
  absorb: [0.55, 0.38, 0.32],
  seabed: '#55564A',
  foam: '#E4E6E2',
  shoreFoam: '#AEBAC4',
  shoreMid: '#75828E',
  shoreWater: '#3C4652',
  reflect: '#3A3A34',
};

/** Bible §7 night. Selected by the `moonlit` mood, not by biome. */
const WATER_NIGHT: WaterPalette = {
  name: 'night',
  ramp: [
    { t: 0.00, hex: '#1D3676' },
    { t: 0.34, hex: '#0B3660' },
    { t: 0.70, hex: '#13224B' },
    { t: 1.00, hex: '#001A42' },
  ],
  absorb: [0.66, 0.32, 0.18],
  seabed: '#3A4058',
  foam: '#B3AFFB',
  shoreFoam: '#B3AFFB',
  shoreMid: '#6E76B8',
  shoreWater: '#22335E',
  reflect: '#232840',
};

export const WATER_PALETTES: Record<string, WaterPalette> = {
  tropical: WATER_TROPICAL,
  temperate: WATER_TEMPERATE,
  arctic: WATER_ARCTIC,
  harbour: WATER_HARBOUR,
  night: WATER_NIGHT,
};

/** BiomeName -> palette key. Desert has no basin, but a scenario may add one. */
export const WATER_PALETTE_BY_BIOME: Record<string, string> = {
  temperate: 'temperate',
  desert: 'tropical',
  snow: 'arctic',
  urban: 'harbour',
};

export const WATER_LOOK = {
  /**
   * Depth at which the ramp reaches its last stop. Bible §7: p10 by 2.4 TL.
   * A procedural basin is often much shallower than that, so Water.ts scales
   * this DOWN to the map's own p97 depth (never below `rampDepthMin`) and
   * scales `absorb` by the same factor. Without that a 1.6 m lake renders as
   * one flat waterline tone and the whole absorption trick is invisible.
   */
  rampDepthMetres: 2.4 * TANK_LENGTH_METRES,
  rampDepthMin: 2.6,
  /** Ramp stops handed to the shader. Even spacing keeps the lookup branchless. */
  rampStops: 8,
  /** Seabed is completely invisible past this (bible: 2 TL). */
  seabedFadeMetres: 2.0 * TANK_LENGTH_METRES,
  /** Metres per seabed blob. Bible: 0.8-4 TL soft low-contrast masses. */
  seabedBlobMetres: 18,
  /** Luminance swing of those blobs. Bible: 18-25 L units of 255 => ~0.09. */
  seabedContrast: 0.34,
  /** Refraction wobble in metres. Bible: ~6-10 px at 1080p. */
  refractionMetres: 0.38,
  /**
   * Multiplies the whole lit result. The ramp hexes were sampled off graded
   * RA3 frames, so they are close to FINAL pixel values. The former 1.40/1.28
   * gains lifted the broad water body enough that pale ships disappeared into
   * it in ordinary play. 0.98, paired with view-ray absorption, produces the
   * requested darker sea while keeping every daylight palette inside the
   * measured band. Raise this only against a fresh probe reading —
   * never to make the water "pop", which is bible R5.
   */
  outputGain: 0.98,
  /** How much the sun's diffuse term modulates the body colour. Water is not chalk. */
  sunDiffuse: 0.30,
  /** How much the hemisphere fill modulates it. */
  fillDiffuse: 0.55,
  /**
   * The same two terms for FOAM, which is lit separately because it is a
   * different material — rough, white, and sitting on top of the water.
   *
   * These were hard-coded 0.80 / 0.85 in the fragment shader and were the
   * single biggest reason the naval fixture rendered at 210/255. Against the
   * body's 0.30 sun coefficient, 0.80 lit foam 2.67x harder, and with a
   * near-white albedo under an HDR sun of ~(3.1, 2.8, 2.3) every foam pixel
   * blew through AgX and then bloomed over its neighbours. COVERAGE was never
   * the problem — measured 7.2%, inside scorecard #26's 4-8% band. Brightness
   * was, and no probe was looking at brightness.
   *
   * Tune these against `probeOpenWaterLuminance`, which models foam now, and
   * re-shoot 08-naval-water. Do not raise them to make the sea "sparkle".
   */
  foamSunDiffuse: 0.22,
  foamFillDiffuse: 0.34,
  /**
   * Foam reveals some body colour instead of replacing it with opaque chalk.
   * Coverage and filament topology stay unchanged; this controls only optical
   * density, making the crest field read as aerated water rather than paint.
   */
  foamOpacity: 0.48,
  /** Scorecard #25 acceptance band, mean sRGB luminance of open water, 0-255. */
  luminanceBand: [45, 115] as [number, number],
} as const;

/**
 * Three wave bands, bible §7. Band A displaces geometry and drives the foam
 * crest; bands B and C are normal-map only. Without band C the specular reads
 * as plastic, which is why the micro tile is deliberately ~3 px on screen.
 */
export const WATER_WAVES = {
  /** Band A swell: lambda 1.2-2.5 TL, amp +/-0.02 TL, 0.10 TL/s. */
  swellMetres: 1.80 * TANK_LENGTH_METRES,
  swellMetres2: 1.27 * TANK_LENGTH_METRES,
  swellAmplitude: 0.02 * TANK_LENGTH_METRES,
  swellSpeed: 0.10 * TANK_LENGTH_METRES,
  /** Crest sharpening exponent — pow(|sin|, 0.6). Sine crests read as jelly. */
  swellSharpness: 0.6,
  /** Direction of the primary swell, degrees clockwise from +X. */
  swellHeadingDeg: 24,
  swellHeadingDeg2: 71,

  /** Band B chop: lambda 0.10-0.22 TL of visible crinkle, 0.35 TL/s. */
  chopTileMetres: 8.0,
  chopSpeed: 0.35 * TANK_LENGTH_METRES,
  chopStrength: 0.70,

  /** Band C micro-detail: 2-4 px, normal only, 0.9 TL/s. */
  microTileMetres: 1.05,
  microSpeed: 0.9 * TANK_LENGTH_METRES,
  microStrength: 0.48,

  /** The three sampling rotations (bible: 0/47/113 degrees). */
  rotationDeg: [0, 47, 113] as [number, number, number],

  /**
   * 0 = glass calm, 1 = choppy. Drives the crinkle amplitude AND the foam
   * threshold. The realistic pass targets only 1.5-4.5% open-water foam in a
   * calm render, leaving dense white water to wakes, storms and the shoreline.
   */
  seaState: 0.16,
} as const;

/**
 * Foam is FILIGREE, not blobs (scorecard #26). It comes from a noise-warped
 * ridge field baked to a texture, thresholded against the crest height —
 * never from a soft alpha sprite.
 */
export const WATER_FOAM = {
  /**
   * Metres per repeat of the lace texture. The bake puts ~4.4 ridge cells in a
   * tile, so 12 m spaces the filaments 2.7 m apart; at 6% coverage that is a
   * 2.4 px filament on a 2560x1440 frame — the middle of scorecard #26's
   * 1.5-4 px band. 512 texels over 12 m is 43 texels/m, so a filament is ~3.5
   * texels wide and survives bilinear filtering instead of shimmering.
   */
  laceTileMetres: 12.5,
  /** Second, coarser rotated lookup that breaks the 12 m repeat. */
  laceDetailMetres: 27.0,
  laceDetailMix: 0.35,
  /**
   * Bible §7 writes this as `smoothstep(0.62, 0.78, fbm + crest*1.6)`. The
   * shape is kept; the three numbers are solved for OUR inputs, which differ in
   * two ways: the lace is a rank-transformed gaussian at sigma 0.15 rather than
   * a raw fbm, and the crest term is normalised to +/-1 rather than left in
   * tank lengths. Solved by bisection against the scorecard #26 targets;
   * `probeFoam()` in WaterMaterial.ts is that same maths, and
   * tests/water.spec.ts asserts it.
   *
   * The ramp is NARROWER than the bible's 0.16. At 0.16 on a sigma-0.15 field
   * most foam pixels sit at a partial alpha, and a rendered frame reads as a
   * soft grey wash at the correct "coverage" — the blob failure #26 is about,
   * arrived at from the other direction. 0.09 puts the same coverage into
   * crisp-edged filaments. Verified by rendering, not by arithmetic.
   */
  thresholdLo: 0.748,
  thresholdHi: 0.838,
  crestGain: 0.324,
  /** Threshold drop at seaState 1 — storms open substantially more foam. */
  choppyBias: 0.06,
  /**
   * Mip compensation: a filament field averages toward its mean under
   * minification, so without a small threshold drop with distance the far half
   * of the frame loses its foam.
   *
   * THIS ONCE LIVED AS A BARE LITERAL INSIDE THE UNIFORM SETUP, and `probeFoam` — the
   * function that certifies coverage against scorecard #26 — did not model it
   * at all. So the probe measured the near field and passed, while the shader
   * ran a lower threshold everywhere else. It is a config constant
   * now precisely so both sides read the same number.
   */
  distanceBias: 0.012,
  /** Metres/second the lace drifts across the swell. */
  scrollSpeed: 0.22,
  /** Target coverage bands from scorecard #26, for the boot-time probe. */
  coverageCalm: [0.015, 0.045] as [number, number],
  coverageChoppy: [0.08, 0.13] as [number, number],
} as const;

/**
 * The permanent churned band along 100% of the land/water contact
 * (scorecard #27). Derived from an exact euclidean distance transform of the
 * terrain's land mask, so "100% of the contact" is structural, not hopeful.
 *
 * WIDTH: the bible quotes "40-80 px (0.42-0.84 TL)". Those two disagree by 2x
 * at the measured 29.6 px/m — 0.42 TL is 87 px. Scorecard #27 is scored in
 * PIXELS off a 2560x1440 frame, so the pixel figure wins: 2.0 m is 59 px,
 * the middle of the band.
 */
export const WATER_SHORE = {
  bandMetres: 2.0,
  /** Coverage inside the band. Bible: ~45%, i.e. much denser than open foam. */
  coverage: 0.45,
  /** Pulse +/-25% at 0.45 Hz. */
  pulseHz: 0.45,
  pulseAmount: 0.25,
  /** UV scrolls landward at 0.08 TL/s. */
  scrollSpeed: 0.08 * TANK_LENGTH_METRES,
  /** Local lightening of the water fades out by 0.35 TL of depth. */
  lightenDepthMetres: 0.35 * TANK_LENGTH_METRES,
  /** Metres of shore distance encoded in the field texture. */
  encodeMetres: 12,
} as const;

/** Bible §7 glint: GGX 0.045-0.07, anisotropy 1.6x along the light azimuth. */
export const WATER_GLINT = {
  roughness: 0.055,
  anisotropy: 1.6,
  /** Multiplies the sun colour. >1 so cores clip to white through the bloom. */
  intensity: 3.4,
  /** Foam is rough and bright; it must not carry the mirror lobe. */
  foamRoughness: 0.62,
} as const;

/**
 * RULING #7, hard-coded ceiling. `mixMax` is clamped in the material factory,
 * not just documented, because this is the single number R7 is about.
 */
export const WATER_SSR = {
  mixMax: 0.10,
  mix: 0.07,
  fresnelPower: 5.0,
  /** Metres offshore over which the grazing term fades to zero. */
  shoreFalloffMetres: 26,
} as const;

/**
 * Wakes go into a world-space foam accumulation buffer, not particle ribbons
 * (bible §7, and "beat RA3" item 10). One R8 texture over the play area,
 * splatted per ship and decayed on a fixed clock.
 */
export const WATER_WAKE = {
  /** Texels across the map. 512 => 1 m/texel over a 512 m map. */
  resolution: 512,
  /** Seconds for a splat to halve. Tuned so an arm is gone by ~4.5 s. */
  halfLifeSec: 1.5,
  /** Decay+upload clock. 30 Hz is imperceptible and halves the CPU cost. */
  decayHz: 30,
  /** Stern churn: 1.3x hull width, 1.4-1.8 hull lengths. */
  sternWidthMul: 1.3,
  sternLengthMul: 1.6,
  /** Kelvin V arms at +/-19 degrees, extending 3.5-5 hull lengths. */
  armAngleDeg: 19,
  armLengthMul: 4.2,
  /** Arms are DISCRETE DASHES, not a continuous line. */
  armDashMetres: 1.7,
  armGapMetres: 1.1,
  armWidthMetres: 0.9,
  /**
   * Per-splat amplitude. A ship at 10 m/s calling addWake once per sim tick
   * lays a splat every 33 cm, so consecutive stern discs overlap almost
   * completely — at a per-call amplitude near 1 the buffer saturates in two
   * ticks and the track renders as a solid white slug. 0.22 reaches a steady
   * state around 0.7 against the decay, which is where the shader's
   * smoothstep(0.06, 0.55) wants it.
   */
  splatGain: 0.22,
  /** Hull length assumed when a caller does not pass one. */
  defaultHullMetres: 12,
  /** Splats accepted per decay tick. Cheap insurance against a runaway caller. */
  maxSplatsPerTick: 96,
  /** How strongly the wake buffer opens the foam threshold. */
  foamGain: 1.15,
} as const;

/** Field texture: depth, shore distance and seabed blobs over the whole map. */
export const WATER_FIELD = {
  /** Texels across the map. 512 => exactly one texel per terrain grid sample. */
  resolution: 512,
  /** Metres of depth (and of land height) the signed channel encodes. */
  encodeMetres: 16,
} as const;

/** Water surface mesh. One draw per 128 m chunk, land quads never emitted. */
export const WATER_MESH = {
  /** Metres between water vertices. 2 m gives ~6 samples per swell wavelength. */
  gridMetres: 2.0,
  /** Chunk edge in metres. 4x4 chunks over the map. */
  chunkMetres: 128,
  /** Metres of margin around a water cell that still gets geometry. */
  marginMetres: 4.0,
  /** Bounding-sphere padding for the vertical swell. */
  boundsPadding: 1.0,
} as const;

/** Procedural texture sizes for the water shader's three canvases. */
export const WATER_TEXTURE_SIZE = 512;
/** Seed for every water texture, so a re-boot is byte-identical. */
export const WATER_SEED = 0x5ea1ce;

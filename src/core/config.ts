/**
 * ============================================================================
 * VOLTMARCH — src/core/config.ts
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
  /**
   * Screen-edge band in pixels that triggers edge panning. **ZERO = OFF, and
   * off is the shipping default.**
   *
   * Edge scrolling is the single most-complained-about control scheme on a
   * laptop: the pointer is a trackpad, the cursor drifts to an edge every time
   * the player reaches for the sidebar or the tactical map, and the camera
   * runs away on its own. It is still available — Options > Controls turns it
   * back on and `SettingsScreen` writes `RENDER_CONFIG.camera.edgePanPixels`
   * directly — but nobody has to discover the toggle to stop it happening.
   *
   * `src/input/Input.ts#edgeDirection` reads THIS constant (not the live
   * render config) to decide whether to paint the eight scroll-arrow cursors,
   * so zero here also removes the affordance for a feature that is off.
   */
  edgePanPixels: 0,
  /** Edge pan speed multiplier relative to keyboard pan. */
  edgePanScale: 1.0,
  /**
   * MULTIPLIER applied to the dolly distance per wheel notch. >1 pulls back.
   *
   * This was 0.12 and documented as "fraction of the remaining distance", but
   * `CameraRig.zoomBy` has always computed `distance * pow(zoomStep, notches)`
   * and `ArtBridge.cameraPatch()` pushes this number straight into
   * `RENDER_CONFIG.camera.zoomStep` at boot. 0.12 therefore multiplied the
   * distance by 0.12 on a single notch — every wheel event slammed the camera
   * onto `minDistance` or `maxDistance` with nothing in between. 1.14 is ~13%
   * per notch, which is nine notches across the whole 30..140 m range.
   */
  zoomStep: 1.14,
  /** Critically-damped spring half-life in seconds for pan/zoom smoothing. */
  smoothing: 0.08,
  /**
   * DEGREES/sec of Q/E yaw rotation.
   *
   * Also previously wrong in the same way as `zoomStep`: this was 1.4 and
   * commented "radians/sec", but the rig does `degToRad(cfg.yawSpeed)` on the
   * value ArtBridge copies here, so Q/E turned at 1.4 deg/s — a full circle in
   * four minutes, which reads as "the rotate keys do nothing".
   */
  yawSpeed: 80,
  /** Near/far planes. Tight near plane keeps depth precision for SSAO. */
  near: 1.0,
  far: 900,
  /** Metres of margin outside the map the camera may pan to. */
  panMargin: 24,
} as const;

/* --------------------------------------------------------------------------
 * 3b. CAMERA NAVIGATION — the pointer/trackpad control scheme
 *
 * `CAMERA` above is the RIG (where the camera is and how it moves). This block
 * is the INPUT SCHEME (how a human asks it to move). It lives in core/config
 * for the same reason everything else does — one place to retune feel — and
 * `src/render/camera.ts` seeds `DEFAULT_NAVIGATION` from it.
 *
 * The whole block exists because the game is played on laptops. A MacBook has
 * no wheel and no middle button: the only pointing device is a trackpad that
 * emits `wheel` events for a two-finger swipe and `wheel` events with
 * `ctrlKey: true` for a pinch. Binding `wheel` to zoom — which is what a
 * desktop RTS does — turns the most natural pan gesture on the machine into a
 * zoom, and leaves pinch doing nothing at all.
 * -------------------------------------------------------------------------- */

export const CAMERA_NAV = {
  /* -- wheel / trackpad --------------------------------------------------- */

  /**
   * Multiplier on a two-finger trackpad pan. 1.0 is "the ground tracks the
   * fingers": one CSS pixel of scroll moves the ground one CSS pixel.
   */
  trackpadPanSensitivity: 1.0,
  /** Multiplier on a real mouse wheel's zoom notches. */
  wheelZoomSensitivity: 1.0,
  /**
   * Notches of zoom per unit of `deltaY` on a macOS pinch (`wheel` with
   * `ctrlKey`). Pinch deltas are an order of magnitude smaller than a wheel
   * notch — a slow pinch emits 1-3 per event against a wheel's 100 — so this
   * is deliberately ~30x the plain-wheel scale.
   */
  pinchZoomSensitivity: 0.035,
  /** Hard clamp on notches applied by any single wheel event. */
  maxNotchesPerEvent: 3,

  /* -- trackpad detection -------------------------------------------------
   * See `classifyWheelEvent` in src/render/camera.ts for how these combine.
   * The heuristic is a running score, not a per-event verdict, because a
   * trackpad fling and a wheel notch can look identical for one event.
   * ---------------------------------------------------------------------- */

  /** Milliseconds between wheel events below which the stream reads as a
   *  trackpad. Wheel detents arrive ~120 ms apart even from a fast scroller. */
  streakGapMs: 60,
  /** Milliseconds above which an event is an ISOLATED notch — mouse evidence. */
  isolatedGapMs: 250,
  /** |deltaY| at or above which a pixel-mode event is a coarse wheel detent. */
  coarseDeltaPx: 50,
  /** |deltaY| below which a pixel-mode event is a fine trackpad sample. */
  fineDeltaPx: 10,
  /** Score (−1 mouse .. +1 trackpad) that must be crossed to flip the verdict. */
  deviceFlipScore: 0.25,
  /** How much of each event's evidence folds into the running score. */
  deviceScoreBlend: 0.5,

  /* -- drag pan ------------------------------------------------------------ */

  /**
   * Pixels a RIGHT-drag must travel before it becomes a camera pan instead of
   * an order. Deliberately above `DRAG_THRESHOLD_PX` (5): a right-click that
   * wobbles must still issue the order the player asked for.
   */
  dragPanThresholdPx: 8,

  /* -- momentum ------------------------------------------------------------ */

  /** Inertia on/off by default. */
  momentum: true,
  /**
   * Exponential decay rate of the coast, per second. 6.0 is an e-fold every
   * 167 ms: the camera carries about a third of a second past your fingers and
   * settles, rather than sliding like ice or stopping dead.
   */
  momentumDamping: 6.0,
  /** Metres/sec below which the coast is snapped to zero. */
  momentumMinSpeed: 0.35,
  /** Metres/sec the coast may never exceed, whatever the fling. */
  momentumMaxSpeed: 420,
  /** Rate the velocity estimator tracks live input, per second. */
  momentumTrackRate: 30,

  /* -- keyboard ------------------------------------------------------------ */

  /**
   * Rate the WASD/arrow pan ramps to full speed, per second. 9.0 reaches 90%
   * in ~0.26 s — enough that a tap nudges and a hold sprints, which is what
   * "smooth acceleration" has to mean for a key that is either down or up.
   */
  keyAccelRate: 9.0,

  /* -- edge pan (only reachable when the player turns it on) --------------- */

  /**
   * Milliseconds of pointer stillness after which a parked cursor stops edge
   * panning. Classic edge scroll runs forever while the pointer rests in the
   * band; that is exactly the failure mode on a laptop, where the cursor ends
   * up at an edge because the player let go of the trackpad. Edge panning now
   * has to be RE-ARMED by pointer movement.
   */
  edgeIdleMs: 600,
  /**
   * Milliseconds an inward movement keeps edge panning armed. A movement whose
   * component points at the edge you are sitting on re-arms; drifting parallel
   * to it, or away from it, does not.
   */
  edgeIntentMs: 900,
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
  /**
   * Direct sun strength in the HDR buffer, pre-tonemap.
   *
   * Nudged up from 3.1, and only because the ambient fill below was cut by
   * roughly half at the same time: a lit surface ends up close to where it was,
   * a SHADOWED surface ends up much darker, and that widening is the whole of
   * scorecard #6's contrast complaint. Pushing this on its own is bible risk R5
   * and was measured doing exactly what R5 predicts — at 4.2 with the same fill
   * cut, 18% of `01-establishing-base` clipped to paper white and the frame
   * median luminance ran 0.515 against RA3's 0.342.
   */
  intensity: 3.4,
  /** Shadows are TINTED, not black — black shadows read as holes. */
  shadowColor: '#2A3550',
  /** Poisson PCF radius in shadow texels. Higher = softer, mushier contact. */
  shadowSoftness: 2.2,
  shadowBias: -0.0005,
  shadowNormalBias: 0.02,
  /**
   * How dark shadows go. 1.0 = fully black.
   *
   * Eased from 0.92. Together with the ambient fill this is what sets the
   * bible's §13 #7 lit/shadow ratio; at 0.92 the shadow term was removing so
   * much of the key that the ambient could not put the ratio back inside the
   * 0.20-0.26 band without washing the lit side out too.
   */
  shadowIntensity: 0.80,
  /** Near cascade covers 90 m; far covers 320 m. Texel-snapped so shadows
   *  do not crawl when the camera pans. */
  cascadeNear: 90,
  cascadeFar: 320,
  cascadeResolution: 2048,
};

const ATMOSPHERE_NOON = {
  /**
   * Sky-coloured ambient from above. Fills the shadow side of everything.
   *
   * THIS VALUE WAS THE BLUE-GREY "MOULD" CAST, and the diagnosis is worth
   * keeping because two agents got it wrong before it was proved:
   *
   *   - It is NOT the GTAO denoiser. GTAO on vs off is pixel-identical.
   *   - It is NOT the post chain. `setPostEnabled(false)` keeps the blotches.
   *   - Setting `normalMap = null` scene-wide removes them completely.
   *
   * So the blotches are normal-map RESPONSE, and the amplifier is right here.
   * The old '#8FB6E8' is linear r0.27 : g0.46 : b0.80 — a 3x blue-over-red
   * fill. A HemisphereLight weights by `normal.y * 0.5 + 0.5`, so every texel
   * a normal map tilts away from straight up got a dose of saturated blue that
   * scaled with the tilt. On a surface whose height field is per-pixel noise
   * that paints a blue mould over the whole frame.
   *
   * The replacement is a warm near-neutral (linear r0.66 : g0.63 : b0.56).
   * Ambient fill now changes only the VALUE of a tilted texel, never its hue.
   *
   * The bible's blue shadow tint (§13 #7, lit/shadow per-channel ratio
   * 0.20-0.26 / 0.29-0.35 / 0.46-0.56) is NOT lost: it comes from the shadow
   * term instead — `TONE_NOON.shadowTint` is a luma-normalised '#16294A' and
   * applies to the low end of the luminance range, i.e. to pixels that are
   * actually in shadow, rather than to every tilted texel in the frame.
   */
  hemiSky: '#D6CFC0',
  /**
   * Held near the original 0.55, and that is the point worth recording: the
   * blue-grey mould cast was the fill's COLOUR, not its strength.
   *
   * Cutting this to 0.26 alongside the recolour did make the frame contrastier
   * and it also broke the bible outright. Measured on `03-terrain-closeup`, the
   * shadowed grass came back at a 0.030 / 0.069 / 0.162 per-channel ratio of
   * the lit grass, against §13 #7's required 0.20-0.26 / 0.29-0.35 /
   * 0.46-0.56. Shadows that dark are not "contrasty", they are holes — the
   * exact failure the bible calls out for `shadowColor` in the first place, and
   * the reason RA3's own shadows stay fully readable.
   *
   * Contrast belongs to the grade (GRADE_PIVOT / GRADE_WHITE in post.ts), which
   * can widen the histogram without emptying the shadow end of it.
   */
  hemiSkyIntensity: 0.60,
  /** Warm bounce from the ground. Stops undersides going dead grey. */
  hemiGround: '#7A6248',
  hemiGroundIntensity: 0.34,
  /**
   * Procedural sky dome ramp. Deepened and saturated: the old pair was a
   * near-white '#C6D4DE' horizon (S 0.13) under a muddy zenith, which is both
   * the washed-out sky RA3 never has AND — via the env probe baked from this
   * very dome — a grey IBL smeared over every reflective surface in the game.
   */
  skyZenith: '#1F5FB4',
  skyHorizon: '#93BEE4',
  skyGround: '#6E6252',
  /** Angular size of the sun disk in degrees. */
  sunDiskDeg: 0.6,
  /** Width of the bright haze band above the horizon, in degrees. */
  hazeWidthDeg: 8,
  /** Height fog colour. Only reachable when `fogDensity > 0` (see below). */
  fogColor: '#B8C6D6',
  /**
   * ZERO ON A DAYLIGHT MAP. Bible §1 standing rulings ban fog outright at noon,
   * and scorecard #12 (far-field saturation >= near-field minus 0.05) is the
   * automated form of that ban. Measured: with fog at 0.0075 the far field ran
   * 0.08-0.35 LESS saturated than the near field on 10 of 12 shots, because a
   * '#B8C6D6' haze lerped toward a near-white horizon is a desaturation ramp
   * painted over the back half of the map.
   *
   * `ArtBridge.fogEndFromDensity()` maps 0 to a 4000 m fog end, i.e. no
   * measurable extinction inside the 900 m far plane. Dusk and dust keep their
   * fog: those are not daylight maps and #12 is judged on the noon look.
   */
  fogDensity: 0.0,
  /** Fog thins with altitude at this rate per metre. */
  fogHeightFalloff: 0.045,
  /** Metres before fog starts accumulating. */
  fogStart: 140,
  /**
   * Blend of distant geometry toward sky colour. Zero for the same reason as
   * `fogDensity`: aerial perspective IS the desaturation #12 measures.
   */
  aerialPerspective: 0.0,
  /**
   * Image-based lighting strength, regenerated from the sky on art change.
   * Trimmed with the hemisphere — the env probe is the other omnidirectional
   * fill — but NOT below ~0.6, because the env probe is also where the
   * specular highlight on every hull comes from and scorecard #6 needs those.
   *
   * The second reason it came down: scorecard #12. With the fog gone, the
   * remaining far-minus-near saturation deficit is a GRAZING ANGLE effect, not
   * a haze. The camera pitch is fixed at 52 degrees but the frustum is 36
   * degrees tall, so the top of the frame views the ground at 34 degrees off
   * horizontal and the bottom at 70 — and the environment specular Fresnel at
   * 34 degrees is several times what it is at 70. Distant ground therefore gets
   * a sheet of sky reflection laid over it: measurably brighter (q0 luma 0.571
   * vs q3 0.447) and measurably less saturated. Every point of env intensity is
   * a point of that sheet.
   *
   * It is only trimmed, not cut: the probe is also half of what lights a
   * shadowed surface (see `hemiSkyIntensity`) and all of what puts a silhouette
   * rim on a hull (scorecard #23).
   */
  envIntensity: 0.76,
};

/* ==========================================================================
 * 5. TONEMAP AND GRADE
 *
 * ALL of this happens in GradePass, AFTER bloom. The renderer itself is set to
 * NoToneMapping. Bloom must threshold in HDR before tonemapping or the
 * threshold means nothing.
 * ========================================================================== */

const TONE_NOON = {
  /**
   * 'aces', not 'agx'.
   *
   * AgX is a beautiful curve and it is the wrong curve for this game. Its
   * entire design goal is to desaturate on the way up so that no channel ever
   * clips — which is precisely the two things the RA3 side-by-side fails on.
   * Measured against 14 real RA3 frames: mean HSV saturation 0.317 vs RA3's
   * 0.527, and p99 luminance 0.61-0.89 vs RA3's 0.96, on every single shot.
   *
   * ACES (Narkowicz fit) keeps chroma through the mids, reaches its shoulder
   * about 3 stops earlier, and is what the 2008-era RTS grade actually looks
   * like. Emissives still roll off; they just roll off hot instead of pastel.
   */
  mode: 'aces',
  /**
   * Master exposure. NOT the knob for "the image is muddy" — bible risk R5 is
   * explicitly about reaching for this one. It scales blacks, mids and
   * highlights by the same factor, so it can only move the whole histogram;
   * `contrast` below is what widens it.
   */
  exposure: 0.90,
  /**
   * GAMMA contrast about scene-linear 0.18 (see GRADE_PIVOT in post.ts). 1.0 is
   * a no-op, higher steepens. Because the pivot is a gamma and not an offset,
   * black stays black and mid-grey stays put — all of the extra range lands in
   * the highlights, where scorecard #6 needs it.
   */
  contrast: 1.32,
  /**
   * Chroma gain. This alone can never CREATE saturation (a neutral grey has no
   * hue to amplify) — the accent masses in §6 and §20 do that — but with ACES
   * carrying chroma through the mids there is now something here to amplify.
   */
  saturation: 1.02,
  /** Shadows desaturate slightly — a filmic trick that reads as "graded". */
  shadowSaturation: 0.94,
  /**
   * 3-way colour balance: cool shadows, neutral mids, warm highlights.
   *
   * `shadowTint` now carries the WHOLE of the bible's blue shadow requirement
   * (§13 #7), because the hemisphere fill that used to smear blue over every
   * tilted texel is gone. It is luma-normalised in GradePass, so it re-tints
   * the dark end of the range without changing its brightness.
   */
  /*
   * '#16294A' was too blue and it failed twice over. Luma-normalised it is a
   * (0.29, 1.02, 2.85) multiplier — nearly 10x more blue than red — and the
   * grade applies it by LUMINANCE, so it lands on everything dark, not only on
   * things in shadow. Measured consequences:
   *
   *   - §13 #7 overshot in one direction and undershot in the other: the
   *     lit/shadow ratio came back 0.167 / 0.272 / 0.531 against the required
   *     0.20-0.26 / 0.29-0.35 / 0.46-0.56. Too blue AND too dark in red.
   *   - Scorecard #9. A 79-degree olive leaf, darkened into the shadow band and
   *     then multiplied by that tint, rotates past 100 degrees and lands in the
   *     "amateur emerald" window. 4-5% of the pixels in every tree-heavy shot
   *     were shadowed foliage that had been tinted into failing.
   *
   * '#203D5F' normalised to (0.32, 1.05, 2.54) — 8.1x blue over red instead of
   * 9.9x — and it was still nowhere near enough. Measured after that change,
   * `04-units-parade` still leaked 2.7% into the emerald window and
   * `07-soviet-base` 3.2%, with the leaking pixels sampled at (25,53,15):
   * source `#495018` is a 76-degree olive with R/G 0.81, and it arrived on
   * screen with R/G 0.47 at hue 104. No albedo hue is far enough from emerald
   * to survive a 0.32x multiplier on red — pushing the foliage source below 72
   * degrees would turn it brown before it stopped rotating. The tint was the
   * cause, not the palette.
   *
   * '#4F5667' normalises to (0.81, 1.01, 1.47): blue-over-red 1.8x. That is
   * still an unmistakably cool shadow — the bible's blue shadow is a HUE, not
   * an eight-fold channel imbalance — and it is what finally stops dark
   * saturated greens rotating into the 100-120 window. It also moves §13 #7's
   * lit/shadow ratio the way the previous note said it needed to go: the
   * complaint there was "too dark in RED", and this returns 2.5x of it.
   */
  shadowTint: '#4F5667',
  midTint: '#8C8578',
  highlightTint: '#FFF0D2',
  /**
   * Lift raises the black point. Dropped further toward zero: RA3's own p1
   * luminance measures 0.023 and the scorecard's black-point band tops out at
   * 0.25, so there is a great deal of room below us and none above.
   */
  lift: '#06090F',
  /** Gain tints the white point. */
  gain: '#FFF6E8',
  /**
   * Corner darkening. Eased from 0.28: a heavy vignette pulls the four corner
   * boxes down and the corners are mostly far-field ground, which reads as the
   * aerial haze scorecard #12 just banned.
   */
  vignette: 0.20,
  vignetteSoftness: 0.62,
  /**
   * OFF. Both of these are on the bible's §1 standing ban list and on
   * CLAUDE.md's, and they shipped anyway — see `docs/SPEC_DRIFT_AUDIT.md`
   * finding 8. `tools/metrics.mjs` could not catch it: check #36 carries
   * `w: 0`, and there is no grain metric at all, so the scorecard could not
   * fail by construction.
   *
   * The old note here claimed the grain hid banding in the sky gradient. It
   * was paying for that with a defect on every other pixel:
   *
   *   - It is SCREEN space and mid-weighted, so it lands identically on sky,
   *     concrete, hulls and the HUD. That is video noise, not surface texture,
   *     and it is the opposite of what the ground actually needed — a uniform
   *     overlay FLATTENS real surface variation by adding the same energy
   *     everywhere. Run `tools/crop-surfaces.mjs` before and after and look:
   *     the "grain" the lawn appeared to have was entirely this pass, and the
   *     lawn's real variation now comes from the terrain tiles instead
   *     (`src/world/TerrainMaterial.ts` section 3B-bis).
   *   - `floor(uTime * 24.0)` reseeds it on a 24 Hz clock, so two captures of
   *     an otherwise frozen frame are not identical. The screenshot harness
   *     compares frames for a living.
   *   - CA costs two extra full-screen texture fetches per pixel in the grade
   *     pass, on a build that is GPU-bound at 100% load.
   *
   * Both are read through `if (u > 0.0001)` in GradePass, so zero here removes
   * the work as well as the look. `grainSize` is left at its value: it is inert
   * while `grain` is 0 and it is the parameter someone would need if a dither
   * is ever wanted — and if sky banding does reappear, the fix is a dither in
   * the sky gradient itself, not a full-screen noise pass over the whole frame.
   */
  grain: 0,
  grainSize: 1.4,
  chromaticAberration: 0,
  /**
   * Post-sharpen, applied in HDR before the tonemap. Raised: scorecard #34
   * measures Sobel |grad| > 25 coverage and RA3 runs 0.66-0.79 against our
   * 0.22-0.40. Geometry detail is other agents' work, but an unsharp mask on
   * the detail that IS there is free contrast at the pixel level.
   */
  sharpen: 0.40,
  /** Edge length of the baked colour LUT (32^3 = one texture fetch). */
  lutSize: 32,
};

const BLOOM_NOON = {
  /**
   * HDR threshold, PRE-tonemap.
   *
   * Eased from 1.25 to 1.05. The old value was set to protect against white
   * concrete hazing the frame — the classic "everything looks like a mobile
   * game" failure — but measurement showed the opposite problem: NOTHING in a
   * noon frame ever exceeded 1.25, so the bloom pass was a no-op outside a
   * tesla arc and scorecard #6 had no clipped pixel anywhere to find. 1.05 is
   * still above sunlit white paint (~0.95 scene-linear at the new sun
   * intensity) and below a specular glint, which is exactly the band we want
   * blooming. Do not take it under 1.0.
   */
  threshold: 1.20,
  strength: 0.42,
  radius: 0.70,
  mips: 5,
  /** Extra gain applied to pixels flagged emissive by the material. */
  emissiveBoost: 1.35,
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
 *
 * ------------------------------------------------------------------------
 * CHROMA BUDGET (scorecard #5, weight 3) — read this before neutralising a
 * colour "because it is only concrete".
 *
 * Our mean HSV saturation measured 0.317 against RA3's 0.527, and the largest
 * single reason was not the accents, it was the FIELDS: `concrete #B9BCB6`
 * (S 0.03), `glass #17324A` on one faction and `#2A2A28` on another (S 0.05),
 * pads at `#1E2024` (S 0.10). Those are the surfaces that cover the most
 * pixels, and every one of them was a neutral grey.
 *
 * HSV saturation is INDEPENDENT OF VALUE: a near-black slate blue reads
 * S 0.54 while a near-black grey reads S 0.10, and they photograph as the same
 * darkness. That is the whole trick, and it is exactly what RA3's own frames
 * do — look at refs/ra3steam_02.jpg, where the pavement is nearly black and
 * still unmistakably blue. So every neutral below has been pushed off the grey
 * axis toward the hue its material already implies (cool for Allied ceramic
 * and steel, warm ochre for Soviet concrete and rust) with its VALUE held.
 *
 * What has deliberately NOT changed: `tone.saturation` is a multiply, and a
 * multiply cannot create chroma that is not there — it can only make the greys
 * muddier while the accents scream. Chroma is authored here.
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
  glass: '#0F2E60',
  concrete: '#B2BAC4',
  trimMetal: '#8493A6',
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
  glass: '#241C10',
  concrete: '#8C8064',
  trimMetal: '#7A6448',
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
  glass: '#2A2A18',
  concrete: '#9A9078',
  trimMetal: '#7C7258',
  bareMetal: '#6E6A66',
  rust: '#6A4028',
  tracer: '#FFFFFF',
  explosionTint: '#FFC090',
  hudAccent: '#8A939C',
  camo: ['#7C7468', '#5A5F3A', '#6A6358'],
  camoScale: 3.0,
  silhouetteBias: 0.5,
  useRivets: false,
  rivetSpacing: 0,
  chamfer: 0.03,
};

/**
 * MERIDIAN PACT — bone ceramic, jade team slabs, gold emissives.
 *
 * Authored by the faction agent in src/data/Defs.ts and moved here so the
 * palette tables have exactly one home; `Defs.ts` re-exports it as
 * `MERIDIAN_LOOK` so the art modules that already import it keep working.
 * It moves on all three axes away from the other two armies: warm hull (not
 * cool grey, not olive), the third primary as the team colour (jade against
 * cobalt and crimson), and gold accents rather than cyan or furnace orange.
 */
const MERIDIAN_LOOK: FactionLook = {
  armorBase: '#C9BFA6',
  armorSecondary: '#A79C82',
  /** The team tint. Also the HUD accent and the minimap blip. */
  team: '#0FA98C',
  accentStripe: '#F2E4C4',
  /** Gold collector glow — never cyan, never furnace orange. */
  emissivePanel: '#FFC24A',
  emissiveIntensity: 2.5,
  glass: '#1E3A38',
  concrete: '#C0B69C',
  trimMetal: '#8A806C',
  bareMetal: '#6E6A66',
  rust: '#7A5A32',
  tracer: '#FFD98A',
  explosionTint: '#FFCE7A',
  hudAccent: '#12B58F',
  camo: ['#C9BFA6', '#B0A488', '#8E9C7A'],
  /** Between Allied 2.2 and Soviet 3.4: engineered, but panelled not tiled. */
  camoScale: 2.8,
  /** Neither chamfered-aero nor slab: corbelled ceramic sits in the middle. */
  silhouetteBias: 0.35,
  useRivets: false,
  rivetSpacing: 0,
  chamfer: 0.038,
};

/**
 * THE RECLAMATION — oxide graphite hulls, arc-violet team plate, amber hazard.
 *
 * The fourth army has to be separable from three that already own the obvious
 * quadrants, and colour is the LEAST of the three axes it moves on (the other
 * two are in `src/art/Faction4*.ts`: exposed frame-and-cladding, and no turret
 * on anything the faction fields). Even so, every channel here is measured
 * against the other three rather than picked:
 *
 *   TEAM HUE. Cobalt sits at 215 degrees, crimson at 3, jade at 168. The
 *   largest hole left in the wheel that is not the 100-120 "amateur emerald"
 *   window scorecard #9 fails on is 270-320. `#A32BD8` is 287 degrees: 72 from
 *   crimson, 72 from cobalt, 119 from jade. That 72-degree MINIMUM separation
 *   is the best any candidate hue scores, and it is the number that matters —
 *   the nearest rival, not the average.
 *
 *   VALUE. The Allies are cool light, the Soviets mid olive, the Pact warm
 *   bone. All three hulls sit at V 0.55-0.82. `armorBase` here is V 0.27: the
 *   Reclamation is the only army that reads as a DARK silhouette, which is what
 *   separates it in a 40-unit blob at a glance even before hue registers.
 *
 *   ACCENT. Cyan, furnace orange and gold are taken, so the emissive is
 *   arc-violet — and the second accent is HAZARD AMBER, deliberately warm
 *   against a cold hull. No other army runs a warm/cool split; it is what makes
 *   a scrap frame read as machinery rather than as a shadow.
 */
const RECLAIM_LOOK: FactionLook = {
  /** Oxide graphite. The only dark hull in the game. */
  armorBase: '#3D3A44',
  armorSecondary: '#524E5C',
  /** The team tint. Also the HUD accent and the minimap blip. */
  team: '#A32BD8',
  /** Hazard amber, the warm half of the split. Never violet. */
  accentStripe: '#E8B33C',
  /** Exposed arc conduit. Not cyan, not furnace orange, not gold. */
  emissivePanel: '#E27BFF',
  emissiveIntensity: 2.7,
  glass: '#2A1E34',
  /** Poured slag. Dark, and violet rather than grey — see the CHROMA BUDGET. */
  concrete: '#6E6878',
  trimMetal: '#6A6270',
  bareMetal: '#6E6A66',
  /** Real rust: this army is welded out of other people's wrecks. */
  rust: '#7A4A34',
  tracer: '#E27BFF',
  explosionTint: '#E0A8FF',
  hudAccent: '#B93FE0',
  camo: ['#3D3A44', '#2C2A34', '#57505F'],
  /** Loosest in the game — cladding is cut from whatever was to hand. */
  camoScale: 3.8,
  /** Slab-leaning, but the read comes from open frame rather than from mass. */
  silhouetteBias: 0.75,
  /** Welded, not bolted. The Soviets own the rivet ring and keep it. */
  useRivets: false,
  rivetSpacing: 0,
  /** Crude cut plate: the heaviest bevel in the game after the Allied 0.045. */
  chamfer: 0.030,
};

/** Ore crystal colour. Referenced by both terrain and HUD. */
export const ORE_CRYSTAL_COLOR = '#FFC64A';
/** Neutral rock. */
export const ROCK_COLOR = '#7C7468';
/** Neutral foliage. */
export const FOLIAGE_COLOR = '#5A5F3A';

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
  /** Warm, dust-laden smoke. A neutral grey plume (S 0.07) was dragging the
   *  whole combat shot's mean saturation under the scorecard #5 floor. */
  /* Dark, warm and dust-laden. Was '#5A5450' — a neutral mid grey that both
   * dragged the combat frame's mean saturation under the scorecard #5 floor
   * (0.29 against 0.42) and, at 0.55 opacity over a large plume, pulled its
   * median luminance up to 0.59 against RA3's 0.34. RA3's own smoke is much
   * darker than a first guess: it reads as a silhouette, not as a cloud. */
  smokeColor: '#3E362A',
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
  scorchColor: '#1A1206',
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
  grass: '#666B44',
  dirt: '#7A6A52',
  rock: '#7C7468',
  sand: '#A99878',
  // Cool, not neutral — matches SURFACE_COLOURS.asphalt in src/world/Roads.ts.
  // A near-grey road splat is a large low-chroma mass in the far field and
  // scorecard #12 reads that as haze.
  road: '#3F464F',
  cliff: '#6E6558',
  /** Metres per repeat of the detail normal. Small = crisp close up. */
  detailScale: 2.0,
  /** Metres per repeat of the macro breakup noise. Large = no visible tiling. */
  macroScale: 96,
  /** Wet puddle coverage on roads. */
  puddles: 0.12,
};

const WATER_NOON = {
  shallow: '#2E7C6C',
  deep: '#0A2E44',
  /**
   * Higher = the water only goes reflective at grazing angles.
   *
   * Raised from 4.2. At 4.2 the surface was handing back sky over most of its
   * visible area, so the naval shot measured mean saturation 0.39 (scorecard #5
   * floor is 0.42) and the worst far-minus-near saturation in the set: sky
   * reflection has no chroma of its own and it covers the far field first.
   * 5.4 keeps the grazing sheen that sells water and lets the body colour —
   * which IS saturated, deliberately — carry the near and mid field.
   */
  fresnelPower: 5.4,
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
  // DECLARATION ORDER IS `Faction` ORDER. `ui/Chrome.paletteKeyFor` resolves a
  // faction's accent through `Object.keys(FACTION_PALETTE)[faction]`, so a row
  // inserted rather than appended silently hands one army another's HUD.
  factions: {
    neutral: NEUTRAL_LOOK,
    allies: ALLIES_LOOK,
    soviets: SOVIETS_LOOK,
    meridian: MERIDIAN_LOOK,
    reclaim: RECLAIM_LOOK,
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

  /**
   * Long shadows, warm rim light, orange haze. The screenshot mood.
   *
   * The haze is deliberately thin. Dusk is the one daylight mood the bible lets
   * carry atmosphere, but scorecard #12 is measured on `11-dusk-mood` like
   * every other shot, and at the old 0.0115 the far field came back 0.064 less
   * saturated than the near field. A WARM haze at a quarter of the density
   * still reads as evening air and costs ~0.01 of the delta.
   */
  dusk: {
    sun: {
      elevationDeg: 12, azimuthDeg: 288,
      color: '#FF9E5A', intensity: 4.4, shadowColor: '#2A2038',
    },
    atmosphere: {
      fogColor: '#E8A05C', fogDensity: 0.0060, fogStart: 120,
      aerialPerspective: 0.10,
      skyZenith: '#2A4A78', skyHorizon: '#F0A868',
      /** Warm, not lilac: a saturated fill re-creates the mould cast at dusk. */
      hemiSky: '#C8A88C', hemiSkyIntensity: 0.24,
      hemiGround: '#7A5838', hemiGroundIntensity: 0.16,
    },
    tone: { exposure: 1.06, shadowTint: '#241A38', highlightTint: '#FFD8A8' },
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
      /** Night is the one mood where a cool fill is CORRECT: the light source
       *  genuinely is a blue sky. Kept dim so it tints without smearing. */
      hemiSky: '#2A3A5E', hemiSkyIntensity: 0.30,
      hemiGround: '#181410', hemiGroundIntensity: 0.14,
      envIntensity: 0.42,
    },
    bloom: { threshold: 0.85, strength: 0.72, emissiveBoost: 2.4 },
    tone: { exposure: 1.12, contrast: 1.28, shadowSaturation: 0.80 },
  },

  /** Flat, soft, desaturated. The "is the lighting carrying this?" control. */
  overcast: {
    sun: { intensity: 2.2, shadowSoftness: 6.0, shadowIntensity: 0.55, color: '#E8ECF0' },
    atmosphere: {
      fogColor: '#C8CED6', fogDensity: 0.006, fogStart: 110,
      skyZenith: '#8A98A8', skyHorizon: '#D8DEE4',
      hemiSky: '#D8D8D4', hemiSkyIntensity: 0.62, envIntensity: 0.9,
      aerialPerspective: 0.15,
    },
    tone: { saturation: 1.02, contrast: 1.16 },
  },

  /** Heavy dust haze. Kills long sightlines, makes the midfield read closer. */
  dust: {
    sun: { color: '#FFD8A0', intensity: 3.4 },
    atmosphere: {
      fogColor: '#D0A870', fogDensity: 0.014, fogStart: 40,
      skyHorizon: '#D8BC94', aerialPerspective: 0.35,
      hemiSky: '#D8C4A4', hemiSkyIntensity: 0.30,
    },
    tone: { saturation: 1.10 },
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

/* ==========================================================================
 * 20. TERRAIN (owned by src/world/Terrain.ts)
 *
 * Landform SHAPE numbers, not colours — the palettes live in
 * src/world/Biomes.ts because they are per-biome and this file is per-game.
 * ========================================================================== */

/**
 * Metres between heightfield samples. This is the number that decides whether
 * a terrace face reads as a CLIFF or as a ramp: a 6 m step crossing one 1 m
 * sample is an 80.5 degree face, which lands inside the bible's 78-88 degree
 * band. At 2 m it drops to 71 degrees and starts reading as a hill.
 */
export const TERRAIN_GRID = 1.0;
/**
 * Chunk edge in metres. 64 gives 8x8 chunks.
 *
 * A draw-call/culling trade. Terrain is ONE material (see TerrainMaterial.ts),
 * so a chunk is one draw in the main pass and one in the shadow pass; 64 m is
 * small enough that the frustum rejects most of them at the default 86 m of
 * visible ground, and only chunks that actually hold a terrace face are
 * submitted to the shadow map at all.
 */
export const TERRAIN_CHUNK_METRES = 64;
/** Splat control texels per build cell. 2 => 2 m/texel => 2-4 m blend width. */
export const TERRAIN_SPLAT_PER_CELL = 2;
/** Edge length of each generated splat layer albedo. */
export const TERRAIN_LAYER_TEXTURE_SIZE = 256;
/** Default landform seed. Overridden per scenario. */
export const TERRAIN_SEED = 0x7e44a1;
/** Biome used when a scenario does not name one. */
export const TERRAIN_DEFAULT_BIOME = 'temperate';

/** Half-width in metres of a carved connectivity ramp. */
export const TERRAIN_RAMP_HALF_WIDTH = 7;
/** Metres of that ramp that stay perfectly flat before the edges tie in. */
export const TERRAIN_RAMP_CORE_WIDTH = 3.5;
/** Max rise/run of a carved ramp. Must stay under tan(ROUGH_SLOPE). */
export const TERRAIN_RAMP_MAX_GRADE = 0.24;
/** A stranded passable region smaller than this many cells is left stranded. */
export const TERRAIN_MIN_REGION_CELLS = 28;
/**
 * Longest ramp the carver may cut, in metres. Without a cap the wide-search
 * fallback happily bulldozes an 80 m trench across open grass to reach a shelf
 * nobody needed — the cure is worse than the stranding.
 */
export const TERRAIN_RAMP_MAX_LENGTH = 52;
/** Longest link the carver will consider, in CELLS. */
export const TERRAIN_RAMP_MAX_LINK_CELLS = 13;
/** Hard cap on carved ramps, so a pathological seed cannot melt the map. */
export const TERRAIN_MAX_RAMPS = 30;
/** Cells of impassable border, so nothing walks off the edge of the world. */
export const TERRAIN_BORDER_CELLS = 2;
/**
 * Metres of height difference a GROUND vertex normal may see across one grid
 * step. Clamping this stops a 6 m terrace face from tilting the shading of the
 * flat plateau beside it; the face gets its own normal from the cliff shader.
 */
export const TERRAIN_GROUND_NORMAL_CLAMP = 0.85;
/** Max metres of height spread inside a cell for it to count as buildable. */
export const TERRAIN_BUILD_FLATNESS = 1.1;

/* --------------------------------------------------------------------------
 * 20a. START AREAS — the reserved spawn plateaus
 *
 * A procedural map that drops an army into a 9-cell pit it cannot drive out of
 * is broken, and no amount of ramp-carving economy fixes it, because the ramp
 * carver is DESIGNED to ignore pockets that small (TERRAIN_MIN_REGION_CELLS).
 * Real RTS generators do not leave start positions to chance: they RESERVE
 * them. Before relief is classified, every start location is levelled to a
 * buildable shelf of a guaranteed radius, its edge graded back into the natural
 * landform, and the connectivity carver is then told that the minimum-region
 * economy rule does not apply inside that radius.
 *
 * The numbers below are the contract:
 *
 *   r <= TERRAIN_START_GUARD_RADIUS   flat, dry, buildable, and joined to the
 *                                     map's main passable region. Verified
 *                                     inside the generator, not hoped for.
 *   r <= TERRAIN_START_FLAT_RADIUS    levelled core (the guard radius plus one
 *                                     cell of slack, because `cellSlope` is a
 *                                     MAX over the cell's grid samples and so
 *                                     reaches CELL metres past the cell).
 *   beyond                            a graded apron at TERRAIN_START_APRON_GRADE
 *                                     until the natural relief is close enough
 *                                     to resume untouched.
 * -------------------------------------------------------------------------- */

/**
 * Start locations, as fractions of MAP_SIZE on each axis.
 *
 * One entry today because every scenario centres on the middle of the map, but
 * the generator is written for N of them — skirmish wants four or six, and the
 * guarantee has to hold for each of them independently. `TerrainOptions.starts`
 * overrides this with explicit world positions.
 */
export const TERRAIN_START_POSITIONS: readonly (readonly [number, number])[] = [
  [0.5, 0.5],
];
/**
 * Metres around a start location that are GUARANTEED flat, dry, buildable and
 * connected to the main region. Scenarios drop their opening army inside 48 m,
 * so this carries a comfortable margin over the measured spawn footprint.
 */
export const TERRAIN_START_GUARD_RADIUS = 54;
/**
 * Metres of dead-level core. Must exceed the guard radius by at least CELL:
 * a cell's slope is the MAX over its grid samples, so the last guarded cell
 * samples the terrain one cell further out than its own centre.
 */
export const TERRAIN_START_FLAT_RADIUS = 58;
/**
 * Metres the levelled rim wanders outward, so the shelf reads as a natural
 * basin and not as a stamped disc. Outward only — the guarantee must never
 * shrink. The wobble's own gradient is kept under ~0.14 (a 14 m swing over a
 * ~300 m noise wavelength) so it cannot push the apron past ROUGH_SLOPE.
 */
export const TERRAIN_START_EDGE_WOBBLE = 14;
/** Metres per feature of that rim wobble. */
export const TERRAIN_START_WOBBLE_METRES = 300;
/**
 * Rise/run of the apron that ties the shelf back into the landform. Under
 * tan(ROUGH_SLOPE) with the rim wobble's gradient added in, so the apron is
 * always passable and never even classifies as rough.
 */
export const TERRAIN_START_APRON_GRADE = 0.22;
/**
 * Metres of residual swell left on the levelled core. A perfectly flat disc
 * reads as a billiard table from the game camera; this is the same gentle
 * swell the rest of the map carries, at a fraction of the amplitude, and it is
 * small enough to stay inside TERRAIN_BUILD_FLATNESS.
 */
export const TERRAIN_START_SWELL = 0.30;
/**
 * Metres the start plateau must sit above WATER_LEVEL. A base that spawns in
 * ankle-deep water is a base whose cells are classified as water and therefore
 * impassable to everything that is not a hovercraft.
 */
export const TERRAIN_START_DRY_MARGIN = 1.2;
/**
 * Ramps the start-area verification pass may cut ON TOP of TERRAIN_MAX_RAMPS.
 * The global cap exists so a pathological seed cannot melt the map; the start
 * guarantee is not something a budget is allowed to cancel, so it gets its own.
 */
export const TERRAIN_START_MAX_RAMPS = 12;
/** Verify-and-escalate rounds the generator runs on the start areas. */
export const TERRAIN_START_ENFORCE_PASSES = 6;
/**
 * A passable region smaller than this, unreachable from the main landmass and
 * outside every start guarantee, is SCENERY: it gets marked impassable so the
 * pathfinder never offers it as a destination.
 *
 * This is the other half of the min-region economy rule. Leaving a 6-cell ledge
 * stranded is fine; leaving it flagged as valid ground is not, because a
 * "move here" order onto it can never complete and the AI will keep re-issuing
 * it. Regions at or above this size are left alone — those are real mesas and
 * islands that a transport or a hovercraft may legitimately reach.
 */
export const TERRAIN_PRUNE_REGION_CELLS = 28;

/* -- 20a2. THE DECLARED SEA ------------------------------------------------
 * WHY THIS EXISTS, AND WHAT WAS BROKEN WITHOUT IT
 * ----------------------------------------------
 * `MAP_PRESETS` carries a `water` fraction per preset (`coast` 0.45), and
 * `ScenarioSpec` carries a `ShoreSpec` that `buildNaval` fills in. Neither
 * reached the heightfield. `world/terrain.system.ts` picks its biome from
 * `?biome=` or `TERRAIN_DEFAULT_BIOME` and never consults the scenario at all,
 * and `BiomeName` has no `coast` member to consult even if it did. So the
 * naval fixture asked for a 45%-water coastal map, was handed `temperate`
 * (basin threshold 0.11, a few scattered 2 m puddles), and — because
 * `TERRAIN_START_POSITIONS` reserves a guaranteed-DRY 58 m shelf at exactly
 * (0.5, 0.5) — was handed dry land at the one spot it frames. `08-naval-water`
 * photographed ships on grass for its entire life.
 *
 * This is the missing half of the contract `src/game/Scenarios.ts` already
 * documents: "The terrain/ore/shore half is DATA ... the terrain module owns
 * it." A scenario declares a shoreline; the generator carves it.
 *
 * A HALF-PLANE, NOT A COASTLINE FUNCTION. One straight line with a low
 * frequency wobble is what `ShoreSpec` has always described, it is what an RTS
 * naval map actually is, and it keeps the whole feature to a distance test
 * inside the existing heightfield loop. Nothing about it is a special case
 * downstream: the sea is ordinary sub-WATER_LEVEL terrain, so `waterGrid`,
 * the sand splat band, `Water.ts` and the minimap all pick it up for free.
 * ------------------------------------------------------------------------ */

/**
 * A sea a scenario asks the generator to carve, in WORLD metres.
 *
 * Water is the half-plane `(p - origin) . normal > 0`. This is deliberately
 * the same geometry `ScenarioSpec.shore` publishes — the two must agree, and
 * `buildScenario` warns when they do not — but it is delivered EARLIER, on
 * `plannedScenario()`, because terrain generates long before any scenario has
 * built. See `src/world/sea.system.ts` for the hand-off.
 */
export interface SeaSpec {
  /** A point on the waterline. */
  readonly x: number;
  readonly z: number;
  /** Unit normal pointing OUT TO SEA. */
  readonly normalX: number;
  readonly normalZ: number;
  /** Metres of beach / shallow band either side of the line. */
  readonly bandWidth: number;
  /**
   * Metres the bed drops below WATER_LEVEL in open water.
   *
   * Capped in practice by the heightfield floor: `buildHeightfield` clamps to
   * `TERRAIN_MIN_HEIGHT` (0), so with WATER_LEVEL at 2.0 no map anywhere in
   * this game can be deeper than 2.0 m. That is not a problem the water module
   * needs solving — `Water.fitRamp` fits the absorption ramp to the basin that
   * was actually generated for exactly this reason — but it is why asking for
   * more than ~2 m here buys nothing.
   */
  readonly depth: number;
  /** Metres offshore over which the bed reaches `depth`. */
  readonly shelfMetres: number;
  /** Metres the waterline wanders either way, so the coast is not a ruler. */
  readonly wavinessMetres: number;
  /** Metres per feature of that wander. */
  readonly wavelengthMetres: number;
}

/**
 * Rise/run of the coastal cone the land is clamped into as it approaches the
 * waterline.
 *
 * Same device as `TERRAIN_START_APRON_GRADE` and chosen the same way: a CLAMP,
 * not a blend. A lerp toward sea level scales a 6 m terrace face down but
 * leaves it a face; a clamp deletes the face where it exceeds the cone and
 * leaves the terrain untouched where it does not, so the coast reads as a
 * landform meeting the sea rather than as a stamped wedge.
 *
 * 0.26 is under `tan(ROUGH_SLOPE)` (0.288), so the beach never even classifies
 * as rough ground, and it bounds the cone's reach: tier-1 ground at 8.8 m stops
 * being clamped 26 m inland, and nothing on the map is affected past
 * (TERRAIN_MAX_HEIGHT - WATER_LEVEL) / 0.26 ~ 85 m from the waterline.
 */
export const TERRAIN_SEA_BEACH_GRADE = 0.26;

/**
 * Metres of dry land a reserved start shelf must keep between itself and the
 * waterline.
 *
 * A start area is GUARANTEED flat, dry and buildable, and it is levelled to at
 * least `WATER_LEVEL + TERRAIN_START_DRY_MARGIN`. Put one on top of a declared
 * sea and the guarantee wins: the sea gets filled in. So on a map with a sea,
 * start points slide along `-normal` until their whole flat radius is inland.
 * `Terrain.carveSea` re-asserts the bed afterwards regardless, because the
 * shelf's apron wobble can still reach past this margin on an unlucky seed.
 */
export const TERRAIN_SEA_START_CLEARANCE = 10;

/* -- 20b. MAJOR-REGION GUARANTEE -------------------------------------------
 * The start guarantee above fixes "my army is in a pit". This fixes the other
 * half of the same family: "a quarter of the map is a plateau nothing can
 * drive onto".
 *
 * Measured over 200 biome/seed combinations, three produced a single stranded
 * region of 1357, 2031 and 4159 cells — up to 38% of all passable ground —
 * sitting one terrace step above the main landmass with a cliff between them.
 * Every one of those boundaries was 100% cliff and 0% water, and the gap to
 * the main region was under two cells. `ensureConnectivity` queues regions
 * that big (they clear TERRAIN_MIN_REGION_CELLS comfortably) but `linkRegion`
 * could not land a corridor inside TERRAIN_RAMP_MAX_LENGTH, so they were
 * silently abandoned. A map like that is not a lost ledge: the AI can never
 * reach a player who expands onto it, and ore inside it is unharvestable.
 * ------------------------------------------------------------------------ */

/**
 * The share of durable passable ground the main region must hold before the
 * major-region pass stops carving.
 *
 * Expressed as the invariant itself rather than as a cell count, so the rule is
 * self-limiting: it carves the biggest stranded plateau, re-measures, and stops
 * the moment the map is healthy. A map that is already one piece costs nothing.
 * "Durable" excludes regions below TERRAIN_PRUNE_REGION_CELLS, which are about
 * to be demoted to scenery and so must not drag the ratio down.
 *
 * 0.97 sits above the 0.9 the reachability spec demands, so a seed has to
 * regress substantially before the test notices.
 */
export const TERRAIN_MAIN_REGION_SHARE = 0.97;
/**
 * Ramps the major-region pass may cut, on top of every other budget. Small:
 * each one is a deliberate, measured cut at the single worst split on the map,
 * and the loop stops as soon as TERRAIN_MAIN_REGION_SHARE is met.
 */
export const TERRAIN_MAJOR_MAX_RAMPS = 6;
/** Verify-and-escalate rounds for the major-region guarantee. */
export const TERRAIN_MAJOR_ENFORCE_PASSES = 6;
/**
 * Corridor width for a FORCED cut, replacing TERRAIN_RAMP_HALF_WIDTH /
 * TERRAIN_RAMP_CORE_WIDTH when the length cap is lifted.
 *
 * `cellSlope` is the MAXIMUM slope anywhere in a cell, so a cell is passable
 * only if the whole 4 m of it is gentle. The ordinary corridor has a 7 m flat
 * core feathering to nothing over the next 3.5 m, which leaves barely one clean
 * cell down the middle — and on a measured seed (desert/802294) that meant a
 * corridor was cut, reported as cut, and still classified as cliff end to end,
 * so an 18%-of-the-map plateau stayed unreachable through the entire ramp
 * budget.
 *
 * A forced cut is already the escalation path and already accepts being visible,
 * so it gets a core wide enough to guarantee two clean cells. Ordinary ramps are
 * untouched: they are the ones that shape the look of every map.
 */
export const TERRAIN_RAMP_FORCED_HALF_WIDTH = 12;
export const TERRAIN_RAMP_FORCED_CORE_WIDTH = 8;

/* ==========================================================================
 * 20. UNIT ART — RA3 CONFORMANCE BLOCK              (appended by src/art/**)
 *
 * Sections 1-19 above are the foundation's numbers and are never reordered or
 * edited. This block is APPENDED and holds the numbers that RA3_LOOK_BIBLE.md
 * makes normative for UNIT MODELS specifically. Where a value here disagrees
 * with a section above, the bible wins for units and only for units:
 *
 *   - SOVIETS_LOOK.armorBase is '#5A4038' (a brown). The bible's ruling
 *     "Soviets are olive-green #646B33, not grey" is scorecard item #10 at
 *     weight 3, and RA3_SOVIET below carries the olive. Buildings and VFX may
 *     keep using FACTION_PALETTE; unit hulls use this.
 *   - UNIT_DIMENSIONS.infantry.h is 1.75 m. Bible R-S4 puts infantry at
 *     0.30-0.38 x a 7 m MBT hull, i.e. 2.1-2.7 m. UNIT_LADDER uses 2.2 m.
 *     A 1.75 m soldier next to a 7 m tank is 0.25 and reads as ants.
 * ========================================================================== */

/**
 * The RA3 unit palette. One entry per faction-class of hull.
 *
 * `base` is the NON-TEAM paint and must never be a faction colour: R12 says
 * `material.color = factionColour` is the failure mode that blurs the armies,
 * and the fix is 8-14% flat team slabs over an olive/grey/white base.
 */
export interface UnitPalette {
  /** Hull paint. Never a team colour. */
  base: string;
  /** Colour a recess is driven toward. */
  shadow: string;
  /** The flat slab colour. Reachable ONLY through the teamSlab surface. */
  team: string;
  /** Insignia field (the disc behind the glyph). */
  teamSecondary: string;
  /** Which glyph the single insignia decal carries (R-T4). */
  insignia: 'star' | 'eagle' | 'none';
  /** Insignia glyph colour. */
  insigniaColor: string;
  /** Deterministic hull-number stencil. Shared by the faction's whole atlas. */
  hullNumber: number;
  /** Emissive accents: cyan for everyone but the Soviets (bible R-T5). */
  emissive: string;
  /** Warm grey-brown. S <= 0.26. Never blue steel. */
  bareMetal: string;
  trackLink: string;
  glass: string;
  /** Stencil paint. Never pure white. */
  stencil: string;
  hazard: string;
  /** Soviets rivet every seam; Allies never do (bible 5.7). */
  rivets: boolean;
}

/**
 * ALLIES — cool grey-white hull, electric blue slabs, white eagle.
 *
 * `base` and `shadow` were '#B9BCC4' / '#33363E', both S 0.04-0.18, i.e. grey
 * with a rumour of blue. They are the largest field on the model. Pushed onto
 * a real cool axis (S 0.14 / 0.38) at the same value, which is what makes the
 * hull read as painted white-blue ceramic instead of primer. See the CHROMA
 * BUDGET note in §6.
 */
export const RA3_ALLIES: UnitPalette = {
  base: '#AFBACC',
  shadow: '#28303F',
  team: '#2A2ED0',
  teamSecondary: '#1C169A',
  insignia: 'eagle',
  insigniaColor: '#F2F5FA',
  hullNumber: 4172,
  emissive: '#8DD9CD',
  bareMetal: '#61503A',
  trackLink: '#281A11',
  /** Deep cobalt canopy — a named RA3 accent mass, not a dark grey. */
  glass: '#0F2E60',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: false,
};

/**
 * SOVIETS — OLIVE hull (scorecard #10), red slabs, gold star on red.
 *
 * `base` moved '#646B33' -> '#67702C'. Same colour to the eye — still the
 * bible's olive-green, still scorecard #10 — but two measured problems fixed:
 *
 *   1. HUE. '#646B33' sits at 95 degrees. Scorecard #9 fails any frame with
 *      more than 2% of pixels in the 100-120 "amateur emerald" window, and a
 *      95-degree olive under a cool ambient walks straight into it: the Soviet
 *      base shot measured 8.8% leak. '#67702C' is 86 degrees — the same
 *      distance from emerald that the temperate grass layer deliberately keeps.
 *   2. CHROMA. S 0.52 -> 0.61, on the single biggest field on a Soviet hull.
 */
export const RA3_SOVIETS: UnitPalette = {
  base: '#67702C',
  shadow: '#282C10',
  team: '#E01418',
  teamSecondary: '#D51512',
  insignia: 'star',
  insigniaColor: '#E4C300',
  hullNumber: 8188,
  /** The one faction whose accents are orange furnace, not cyan. */
  emissive: '#FF7A1E',
  bareMetal: '#61503A',
  trackLink: '#281A11',
  glass: '#241C10',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: true,
};

/** NEUTRAL / civilian — warm off-white, no team colour, no insignia. */
export const RA3_NEUTRAL: UnitPalette = {
  base: '#9A9074',
  shadow: '#332E22',
  team: '#C8C4B8',
  teamSecondary: '#8A8478',
  insignia: 'none',
  insigniaColor: '#D8D2C8',
  hullNumber: 1063,
  emissive: '#FFC64A',
  bareMetal: '#61503A',
  trackLink: '#281A11',
  glass: '#2A2A28',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: false,
};

export const RA3_UNIT_PALETTE = {
  neutral: RA3_NEUTRAL,
  allies: RA3_ALLIES,
  soviets: RA3_SOVIETS,
} as const;

/**
 * RULING #3 — the single most important material decision in the project.
 * A broad diffuse lobe under a weak tight clear coat is what makes RA3 armour
 * read as painted plastic rather than as matte plastic or as car paint.
 * R10: these are consumed ONLY through the factory in src/art/UnitFactory.ts.
 * `envMapIntensity` is never 0 — that kills the silhouette rim (scorecard #23).
 */
export const UNIT_MATERIAL = {
  /** Painted hull. 60-75% of a unit's surface. */
  paintRoughness: 0.52,
  paintMetalness: 0.0,
  clearcoat: 0.30,
  clearcoatRoughness: 0.38,
  envMapIntensity: 0.80,
  /** Barrels, tracks, rollers. 12-20% of surface. */
  bareMetalRoughness: 0.32,
  bareMetalMetalness: 0.82,
  bareMetalEnv: 0.95,
  /** Canopies. 1-3% of surface. */
  glassRoughness: 0.10,
  glassClearcoat: 0.60,
  glassEnv: 1.00,
  /** Emissive gain. Small MASKED panels only — 2.6 over a whole surface veils
   *  the frame to white, which is the failure the foundation warns about. */
  emissiveIntensity: 2.2,
  /**
   * Normal map XY gain.
   *
   * Halved from 0.85. That number was tuned when the greeble height field was
   * largely per-pixel noise and the gain was doing the work of making the noise
   * visible. The height field is now structural — panel seams, rivet rings,
   * grilles — and at 0.85 those read as embossed rubber: every seam throws a
   * lit lip and a dark trough two or three times deeper than the 1-2 mm of real
   * relief they stand for. 0.45 keeps the seam, loses the puffiness, and halves
   * the amplitude of the ambient-fill tint on tilted texels.
   */
  normalScale: 0.45,
} as const;

/** Canvas-greeble tuning. Every number here changes pixels in the atlas. */
export const UNIT_GREEBLE = {
  /** Atlas edge in px at High/Ultra. Low/Medium halve it. */
  atlasSize: 512,
  /** UV inset per tile, as a fraction of the tile edge. Stops mip bleed. */
  tileInsetFraction: 0.0625,
  /** The clean square each tile reserves for chamfer strips to sample. */
  bevelPatchFraction: 0.10,
  /** Panel-line width as a fraction of the tile edge (~2 px at 128). */
  panelLineWidthFraction: 0.016,
  /** Rivet pitch in atlas px. Bible: 10-14 px at reference scale. */
  rivetPitchPx: 12,
  /** Height relief passed to normalFromHeight. */
  normalRelief: 2.6,
  /** Cavity neighbourhood radius in px. */
  cavityRadiusPx: 3,
  /** Recess albedo multiplier. Bible 5.5: 0.28-0.38, the ONLY wear allowed. */
  cavityMultiplier: 0.32,
  /** Painted bevel highlight: +22% value, -15% saturation (bible 5.5). */
  bevelValueGain: 0.22,
  bevelSaturationLoss: 0.15,
  /** Vertex-colour darkening on undersides and mass seams. */
  cavityVertexTint: 0.74,
} as const;

/**
 * GEOMETRY LANGUAGE. Bible 5.5: "Every convex edge gets a chamfer of 1.5-3% of
 * the part's smallest dimension." A hard BoxGeometry edge is scorecard #11, an
 * automatic fail. `MIN_CHAMFER` above (0.02 m) is the absolute floor.
 */
export const UNIT_GEOMETRY = {
  /**
   * Chamfer as a fraction of a part's smallest dimension.
   *
   * The bible states this twice and the two statements disagree: 5.5 says
   * "1.5-3% of the part's smallest dimension" AND "2-4 px on screen". At the
   * default zoom a 7 m tank is 207 px wide (bible 2), i.e. 29.6 px/m, so 2-4 px
   * is 0.068-0.135 m. A 0.95 m thick hull plate at 3% would give 0.028 m =
   * 0.8 px, which is invisible and fails scorecard #11. The PIXEL figure is the
   * one a critic can actually see, so these fractions are solved from it and
   * the floor/cap keep small greebles and huge plates sane.
   */
  chamferFractionAllies: 0.100,
  chamferFractionSoviets: 0.075,
  /** Absolute floor in metres — 1 px on an infantryman. Never zero. */
  chamferMinMeters: 0.035,
  /** Hard clamp so a chamfer can never round the part into a pill. */
  chamferMaxFractionOfMin: 0.30,
  /** Bible 5.5: cylinders 12-16 radial segments, never 32. Spheres 16x12. */
  cylSegments: 14,
  sphereSegments: 16,
  sphereRings: 12,
  /** Tracks protrude 8-14% of hull width outboard, 18-25% of unit height. */
  trackOutboardFraction: 0.11,
  trackHeightFraction: 0.22,
} as const;

/**
 * R8 — REJECT AT BUILD TIME, NOT IN REVIEW.
 *
 * Note on `dominantCentreY`: the bible pairs "the dominant feature is 35-50% of
 * projected area" with "centre of visual mass at 60-70% of unit height". Those
 * are one rule — it is the DOMINANT MASS whose centre must sit at 0.60-0.70.
 * (An area-weighted centroid over every mass cannot exceed ~0.5 for anything
 * that touches the ground; a uniform box scores exactly 0.50.) The area-
 * weighted centroid is still measured and reported as `centroidY`.
 */
export const UNIT_VALIDATION = {
  primaryMassMin: 3,
  primaryMassMax: 6,
  greebleMin: 6,
  greebleMax: 12,
  dominantFractionMin: 0.35,
  dominantFractionMax: 0.50,
  dominantCentreMin: 0.60,
  dominantCentreMax: 0.70,
  turretWidthMin: 0.75,
  turretWidthMax: 0.95,
  /** R-T1: team colour as a fraction of surface area. */
  teamFractionVehicle: [0.08, 0.14] as readonly [number, number],
  teamFractionInfantry: [0.20, 0.28] as readonly [number, number],
  /** R-T4: exactly one insignia decal per unit. */
  insigniaCount: 1,
  /**
   * R-T5: emissive accents occupy 1-3% of surface.
   *
   * Measured against TOTAL triangle area, which includes faces that are never
   * visible (a slab's back, a box's underside, the inboard wall of a track), so
   * the same unit reads roughly 1.6x higher against visible area alone. The
   * floor is set at 0.5% for that reason. Under-shooting is the safe direction:
   * an unmasked emissive at 2.6 veils the whole frame to white.
   */
  emissiveFraction: [0.005, 0.03] as readonly [number, number],
  /** Scorecard #34: below this the unit reads as an untextured primitive. */
  sobelFloor: 0.22,
  sobelTarget: [0.28, 0.36] as readonly [number, number],
  /** Bible 5.4 surface shares, measured in SCREEN-PROJECTED area. */
  paintFraction: [0.50, 0.80] as readonly [number, number],
  /** Barrels, tracks, rollers, intake grilles. Bible 5.4 says 12-20%; the band
   *  is widened at the bottom because infantry legitimately carry almost none. */
  bareMetalFraction: [0.05, 0.34] as readonly [number, number],
} as const;

/**
 * THE SCALE LADDER (bible 5.2). 1 unit = 1 m and MBT hull = 7 m is law; every
 * number here is derived from it. Units are DELIBERATELY oversized — a tank
 * hull is >= 0.45x a production structure's footprint long axis (a War Factory
 * is 3 cells = 12 m, so 7/12 = 0.58).
 */
export const UNIT_LADDER = {
  /** The reference length. Everything else is a ratio of this. */
  mbtHullMeters: 7.0,
  /** R-S4: infantry stand 0.30-0.38x the MBT hull. 2.2 / 7.0 = 0.314. */
  infantryHeightMeters: 2.2,
  infantryWidthMeters: 0.78,
  /** Walkers stand taller than infantry but below a tank's length. */
  walkerHeightMeters: 4.4,
  /** Vehicle silhouette height as a fraction of hull length. */
  vehicleHeightFraction: 0.36,
  /** Superstructure occupies the TOP 55-65%; chassis is a thin 35-45% base. */
  chassisHeightFraction: 0.40,
  /** Turret ring diameter over hull width (bible: build turrets too big). */
  /** Measured against the OVER-TRACKS width, which is what a critic sees.
   *  1.02 of the hull box lands at ~0.84 over tracks — the RA3 read where a
   *  Hammer's turret is visually as wide as its hull. */
  turretWidthOverHull: 1.02,
} as const;

/* ==========================================================================
 * 20. SCENARIOS AND MAP PRESETS
 *
 * `?shot=<name>` picks a scenario (src/game/Scenarios.ts); `?map=<preset>`
 * picks the biome it is built on. The scenario router resolves both, publishes
 * the result as `activeScenario()`, and the terrain / ore / scatter modules
 * shape the world from the knobs below rather than inventing their own.
 * ========================================================================== */

/** Scenario used when no `?shot=` flag is present. */
export const SCENARIO_DEFAULT = 'skirmish';
/** Map preset used when neither `?map=` nor the scenario names one. */
export const MAP_PRESET_DEFAULT = 'temperate';

/**
 * One biome. Every field is a 0..1 weight unless noted — the terrain module
 * decides what a "0.55 relief" heightfield looks like, but two presets with the
 * same number must produce the same amount of it.
 */
export interface MapPreset {
  /** Human name, for the loading line and the debug overlay. */
  readonly name: string;
  /** Advisory `?art=` mood. NOT auto-applied — `?art=` always wins. */
  readonly mood: string;
  /** Heightfield amplitude as a fraction of TERRAIN_MAX_HEIGHT. */
  readonly relief: number;
  /** How much of the relief is expressed as impassable cliff faces. */
  readonly cliffs: number;
  /** Fraction of the map below WATER_LEVEL. 0 = landlocked. */
  readonly water: number;
  /** Prop/vegetation density multiplier over the bible's 260/ha wilderness base. */
  readonly scatter: number;
  /** Road, kerb and hardstanding coverage. 0 = wilderness, 1 = city block. */
  readonly urban: number;
  /** Ore units per cell at a field's centre, as a fraction of ORE_CELL_MAX. */
  readonly oreRichness: number;
  /** Scatter prop keys, richest first. The scatter module weights them 3:2:1... */
  readonly props: readonly string[];
}

export const MAP_PRESETS: Record<string, MapPreset> = {
  /** The shipping biome: yellow-green grass, low plateaus, scattered woodland. */
  temperate: {
    name: 'Temperate Valley', mood: 'noon',
    relief: 0.42, cliffs: 0.35, water: 0.0, scatter: 1.0, urban: 0.25,
    oreRichness: 0.85, props: ['tree', 'bush', 'rock', 'pine'],
  },
  /**
   * The bible's calibration preset. Bare, hot, high contrast, long shadows.
   *
   * `scatter` raised 0.55 -> 0.85. "Bare" was being taken literally and this is
   * the preset `07-soviet-base` shoots on — the one shot that trips the 25x25 m
   * ship-blocking rule (bible §6.6 / scorecard #15). The texture overhaul that
   * removed per-pixel ground noise also removed the "texture variation" half of
   * what that rule accepts as adornment, so bare ground now has to be adorned
   * with actual props or not at all. 0.85 still reads as sparse desert against
   * tropical's 1.45; it just is not empty.
   */
  arid: {
    name: 'Airbase Flats', mood: 'noon',
    relief: 0.28, cliffs: 0.55, water: 0.0, scatter: 0.85, urban: 0.45,
    oreRichness: 1.0, props: ['rock', 'boulder', 'bush', 'barrel'],
  },
  /** Dense canopy, wet ground, the highest prop count in the game. */
  tropical: {
    name: 'Coral Shore', mood: 'noon',
    relief: 0.36, cliffs: 0.30, water: 0.22, scatter: 1.45, urban: 0.15,
    oreRichness: 0.75, props: ['tree', 'bush', 'pine', 'rock'],
  },
  /** Warm grey snow — saturation drops by half for this preset only (bible §10). */
  snow: {
    name: 'Frozen Sector', mood: 'overcast',
    relief: 0.50, cliffs: 0.40, water: 0.05, scatter: 0.70, urban: 0.20,
    oreRichness: 0.90, props: ['pine', 'rock', 'boulder'],
  },
  /** Naval: one shoreline running through the map, land on one side. */
  coast: {
    name: 'Contested Strait', mood: 'noon',
    relief: 0.30, cliffs: 0.45, water: 0.45, scatter: 0.85, urban: 0.30,
    oreRichness: 0.80, props: ['rock', 'bush', 'tree', 'boulder'],
  },
  /** Roads, kerbs, crosswalks, container stacks. The terrain-detail fixture. */
  urban: {
    name: 'Industrial Grid', mood: 'noon',
    relief: 0.14, cliffs: 0.10, water: 0.0, scatter: 0.60, urban: 0.95,
    oreRichness: 0.70, props: ['barrel', 'crate', 'bush', 'rock'],
  },
};

/**
 * Scenario prop scatter. The full 260/ha wilderness carpet belongs to the
 * instanced scatter system; these are the ENTITY props (crushable, blocking,
 * shadow-casting) the scenario itself places inside the photographed area.
 */
export const SCENARIO_SCATTER = {
  /** Metres around the subject that a scenario dresses with entity props. */
  framedRadius: 80,
  /** Hard cap so a fixture can never eat the entity budget a blob shot needs. */
  maxProps: 200,
  /** Minimum metres between two scattered props. Below this they read as one blob. */
  minSpacing: 3.2,
} as const;

/** Naval hulls, metres. Same contract as UNIT_DIMENSIONS. */
export const NAVAL_UNIT_DIMENSIONS = {
  //                    length  width  height  turret ring Y
  gunboat:     { l: 9.0,  w: 3.4, h: 2.6, turretY: 1.40 },
  destroyer:   { l: 14.0, w: 4.2, h: 3.4, turretY: 1.90 },
  submarine:   { l: 12.0, w: 3.2, h: 1.8, turretY: 0 },
  dreadnought: { l: 18.0, w: 5.6, h: 4.2, turretY: 2.40 },
  transport:   { l: 13.0, w: 6.0, h: 2.4, turretY: 0 },
} as const;

/** Naval structures. Footprint in CELLS, height in metres. */
export const NAVAL_BUILDING_DIMENSIONS = {
  navalYard: { w: 3, h: 3, height: 7.5 },
  subPen:    { w: 3, h: 3, height: 6.0 },
} as const;

/* ==========================================================================
 * 20. RENDER BRIDGE / INSTANCE BATCHER
 *
 * The sim->render seam. One InstancedMesh per (geometry, material) pair; team
 * colour is a per-INSTANCE attribute so one batch covers both armies.
 * ========================================================================== */

/**
 * Instances a fresh batch is born with. Small, because most models only ever
 * hold a handful of entities (one Construction Yard, four Radar Domes) and 40
 * batches x 4096 slots would be 40 MB of matrices for nothing.
 */
export const INSTANCE_BATCH_INITIAL_CAPACITY = 32;
/** Geometric growth factor. Never allocate per spawn. */
export const INSTANCE_BATCH_GROWTH = 2;
/** Hard ceiling per batch. A batch can never need more slots than entity slots. */
export const INSTANCE_BATCH_MAX_CAPACITY = MAX_ENTITIES;

/**
 * Metres of headroom added to every batch's bounding sphere. Covers a model
 * whose art is taller than its registered geometry bounds (turret raised,
 * recoil, construction rise) so frustum culling never pops a visible unit.
 */
export const INSTANCE_BOUNDS_PADDING = 4.0;

/**
 * Placeholder look for a kind whose art module has not landed yet. Deliberately
 * a hazard-striped box, not a grey box: an unfinished model must read as a GAP
 * in a screenshot, never as a finished asset that happens to be plain.
 */
export const PLACEHOLDER_HAZARD_COLOR = '#E0A72A';
/** How dark the team colour goes on a placeholder body. */
export const PLACEHOLDER_BODY_MUL = 0.55;
/** Metres per hazard stripe on a placeholder. */
export const PLACEHOLDER_STRIPE_METRES = 0.9;
/** Emissive gain applied to a SELECTED placeholder so selection still reads. */
export const PLACEHOLDER_SELECT_EMISSIVE = 0.7;
/** Minimum Y scale of a placeholder building at buildProgress 0. */
export const PLACEHOLDER_MIN_RISE = 0.08;

/* ==========================================================================
 * 21. COMBAT — TARGETING, WEAPONS, PROJECTILES, DAMAGE, DEATH
 *
 * Appended by the combat module. Individual weapon stats are CONTENT and live
 * in the weapon table (src/sim/Combat.ts until src/data ships one); these are
 * the cross-cutting numbers that decide how the FIGHT feels — how sticky a
 * target is, how hard a shell arcs, how long a hulk burns.
 * ========================================================================== */

/** Targeting: acquisition, scoring and persistence. */
export const COMBAT_TARGETING = {
  /**
   * Multiplier on weapon range used when SCANNING for a new target. Slightly
   * over 1 so a unit starts slewing its turret a beat before the enemy walks
   * into range — that anticipation is most of what makes a defence read as alert.
   */
  acquireRangeMul: 1.08,
  /**
   * Multiplier on weapon range at which an EXISTING target is dropped. Strictly
   * larger than acquireRangeMul: without this hysteresis band a unit sitting on
   * the range boundary flickers between "acquire" and "lose" every tick.
   */
  leashRangeMul: 1.28,
  /** Score multiplier for the target already held. THE anti-twitch constant. */
  stickiness: 1.35,
  /** Score multiplier for whoever last damaged us (within RETALIATE_MEMORY). */
  retaliation: 1.5,
  /** Score multiplier for anything that can shoot back. Guns before trucks. */
  armedTarget: 1.6,
  /** Score multiplier for a non-defensive structure. Buildings are last. */
  softBuilding: 0.55,
  /** Score multiplier for a defensive structure. */
  defenceBuilding: 1.3,
  /** Score multiplier for a harvester — hurting the economy is worth a detour. */
  harvester: 1.15,
  /** Score multiplier for a target already below `woundedFrac` health. */
  wounded: 1.25,
  woundedFrac: 0.4,
  /** Score multiplier when our warhead barely scratches their armour. */
  ineffective: 0.35,
  /** Armour multiplier at or below which `ineffective` applies. */
  ineffectiveBelow: 0.35,
  /** Distance falloff softness: score is divided by (this + d/range). */
  distanceSoftness: 0.35,
  /** Candidates examined per acquisition scan. Bounds the worst case. */
  maxCandidates: 96,
  /** Metres between height samples on the line-of-sight walk. */
  losStepMetres: 4.0,
  /** Metres of terrain rise above the sight line that counts as blocked. */
  losClearance: 0.9,
} as const;

/** Weapons: the firing cycle, turret traverse and recoil. */
export const COMBAT_WEAPONS = {
  /** Degrees of bearing error tolerated before a turret will fire. */
  aimToleranceDeg: 5.0,
  /** Degrees of bearing error tolerated by a HULL-mounted (turretless) weapon. */
  hullArcDeg: 14.0,
  /** Fallback turret slew, rad/s, when neither entity nor weapon states one. */
  defaultTurretTurnRate: 2.2,
  /** Max barrel elevation, degrees. Ballistic solutions clamp to this. */
  maxElevationDeg: 62,
  /** Min barrel depression, degrees. */
  minElevationDeg: -12,
  /** m/s below which a `requiresStop` weapon considers itself stationary. */
  stoppedSpeed: 0.45,
  /** Metres the barrel kicks back on a shot, scaled by damage/60. */
  recoilMetres: 0.34,
  /** Exponential recoil recovery rate, per second. */
  recoilLambda: 9.0,
  /** Rate-of-fire multiplier per veterancy rank (index 0 = rookie). */
  vetCooldownMul: [1.0, 0.9, 0.8] as readonly number[],
  /** Muzzle height as a fraction of the entity's collision radius, for units. */
  muzzleHeightMul: 0.62,
  /** Absolute muzzle-height floor in metres (infantry shoulder). */
  muzzleHeightMin: 1.15,
  /** Muzzle height for a structure, as a fraction of its footprint width. */
  buildingMuzzleHeightMul: 0.85,
  /** Metres forward of the entity centre the muzzle sits, per unit of radius. */
  muzzleForwardMul: 0.95,
  /** Aim point height on a target, as a fraction of its estimated height. */
  aimHeightFrac: 0.55,
  /** Metres of extra chain-lightning reach from each tesla victim. */
  teslaChainRange: 9.0,
  /** Damage retained by each successive tesla chain link. */
  teslaChainFalloff: 0.6,
} as const;

/** Projectiles: the pooled MAX_PROJECTILES-slot store. */
export const COMBAT_PROJECTILES = {
  /** Gravity for ballistic shells, m/s^2. Above 9.81: RA3 arcs are punchy. */
  gravity: 22.0,
  /** Seconds any projectile may live before it self-destructs. */
  maxLifeSeconds: 9.0,
  /** Default homing turn rate for rockets, degrees/second. */
  rocketTurnRateDeg: 170,
  /** Metres a rocket flies straight before homing engages (reads as a launch). */
  rocketArmMetres: 3.5,
  /** Metres of travel between trail FX beads. Bible 8.6 wants a bead chain. */
  trailBeadMetres: 2.4,
  /** Estimated target height as a multiple of collision radius, swept test. */
  hitHeightMul: 1.7,
  /** Estimated structure height as a multiple of footprint width, metres. */
  buildingHeightMul: 1.15,
  /** Metres added to a target's hit radius so grazing shots still connect. */
  hitRadiusPad: 0.35,
  /** Speed of a Flame projectile, m/s, and how long its tongue lives. */
  flameSpeed: 26,
  flameLifeSeconds: 0.55,
  /** Metres a shell may sink below terrain before the ground impact resolves. */
  groundBias: 0.15,
} as const;

/** Damage, splash, death and the wreckage that outlives it. */
export const COMBAT_DAMAGE = {
  /** Fraction of splash damage an ALLIED or own-team victim takes. */
  friendlyFireMul: 0.5,
  /**
   * Exponent on the splash falloff curve. 1.0 is linear; 1.6 concentrates the
   * damage near the crater, which is what stops one artillery shell deleting a
   * loose formation.
   */
  splashExponent: 1.6,
  /** Max victims one splash event may touch. */
  maxSplashVictims: 64,
  /** Minimum raw damage that leaves a scorch decal. */
  scorchMinDamage: 45,
  /** Metres of scorch per metre of splash radius. */
  scorchSizeMul: 1.9,
  /** Camera shake per metre of explosion scale, 0..1. */
  shakePerScale: 0.09,
  /** Seconds a destroyed vehicle's hulk persists. */
  wreckSeconds: 26,
  /** Seconds a hulk actively burns before it only smokes. */
  wreckBurnSeconds: 10,
  /** Seconds between smoke puffs from a burning wreck. */
  wreckSmokeInterval: 0.45,
  /** Seconds between damage smoke puffs from a damaged (not dead) unit. */
  damageSmokeInterval: 0.6,
  /** Structure death: number of secondary cook-off blasts. */
  cookOffCount: 5,
  /** Seconds between cook-off blasts. */
  cookOffInterval: 0.25,
  /** Scale of a cook-off blast relative to the main structure blast. */
  cookOffScale: 0.32,
  /** Capacity of the delayed-FX ring. Bounds cook-off chains. */
  scheduledFxCapacity: 96,
  /** Fireball radius in metres for a dead unit (bible 8.2: 2.2 TL). */
  unitBlastMetres: 2.2,
  /** Fireball radius in metres for a dead structure (bible 8.2: 4.5-6 TL). */
  buildingBlastMetres: 5.2,
} as const;

/**
 * THE ARMOUR MATRIX — [WarheadClass][ArmorClass], 7 x 6.
 *
 * This table IS the counter-triangle of the game. Rows are warheads
 * (SmallArms, AutoCannon, ArmorPiercing, HighExplosive, Rocket, Tesla, Prism);
 * columns are armours (Infantry, Light, Medium, Heavy, Concrete, Wood).
 *
 * Read the shape, not the individual numbers: small arms shred flesh and bounce
 * off tanks; AP is the answer to armour and wastes itself on infantry; HE is
 * the building-killer that still has real anti-infantry splash; rockets are the
 * generalist that costs you nothing against heavies; tesla deletes infantry
 * outright; prism ignores most armour scaling, which is exactly why it is
 * expensive and slow.
 *
 * A data module that ships a real `DefTables.armorMatrix` replaces this at boot
 * through `setArmorMatrix()`.
 */
export const ARMOR_MATRIX: readonly (readonly number[])[] = [
  /* SmallArms     */ [1.00, 0.55, 0.28, 0.10, 0.18, 0.60],
  /* AutoCannon    */ [0.80, 1.00, 0.65, 0.35, 0.35, 0.80],
  /* ArmorPiercing */ [0.35, 0.85, 1.00, 1.00, 0.55, 0.75],
  /* HighExplosive */ [0.90, 0.80, 0.65, 0.50, 1.00, 1.00],
  /* Rocket        */ [0.55, 0.95, 0.90, 0.95, 0.90, 0.85],
  /* Tesla         */ [1.60, 0.95, 0.85, 0.90, 0.60, 0.70],
  /* Prism         */ [1.10, 0.95, 0.95, 0.90, 0.80, 0.90],
];

/* ==========================================================================
 * 21. ECONOMY — ORE, HARVESTING, POWER          (appended by src/sim/**)
 *
 * Section 16 above holds the headline balance numbers (START_CREDITS,
 * HARVEST_RATE, ORE_CELL_MAX, POWER_*). Those are NOT duplicated here. What
 * follows is the machinery that turns them into a loop: how a field is shaped,
 * how a cell regrows, how a harvester decides, and how a power deficit picks
 * which structures go dark.
 *
 * The one rule that governs every number below: the loop must be LEGIBLE from
 * a screenshot. A player has to be able to look at one frame and read "that
 * patch is nearly mined out", "that harvester is full", "the tesla coils are
 * dark". Anything that only shows up in a spreadsheet is tuned for feel, not
 * for realism.
 * ========================================================================== */

/* -- ore field shape ------------------------------------------------------ */

/**
 * A cell holding less than this many ore units is rounded down to bare ground.
 * Without the floor a field never stops existing: it decays into a 200-cell
 * halo holding 0.4 units each, which renders as a full-size patch that pays
 * nothing. The visible edge of a field must be the same thing as its economic
 * edge.
 */
export const ORE_CELL_MIN = 14;
/**
 * Per-cell richness jitter, +/- this fraction. A field with a smooth radial
 * falloff reads as an airbrushed circle; real RA ore is blotchy, and the
 * blotches are what make a half-mined field look chewed rather than shrunk.
 */
export const ORE_CELL_JITTER = 0.34;
/**
 * Exponent on the radial falloff from a field's node. 1.0 is a linear cone;
 * above 1 the field holds its richness out toward the rim and then drops
 * quickly, which keeps the mineable AREA large (harvesters spread out) while
 * still giving the node a visible bright core.
 */
export const ORE_FIELD_FALLOFF = 1.55;
/** Ore units per cell at a field centre when a scenario does not say. */
export const ORE_FIELD_DEFAULT_RICHNESS = ORE_CELL_MAX * 0.85;
/**
 * Density buckets a renderer should quantise `OreField.densityAt` into. Four
 * steps is enough that a draining patch visibly loses crystals three times
 * before it disappears, and few enough that the crystal instancer can keep one
 * batch per step.
 */
export const ORE_DENSITY_STEPS = 4;

/* -- regrowth ------------------------------------------------------------- */

/**
 * Ticks between regrowth passes. Every field is processed on the same pass;
 * a field is only a few hundred cells, so 2 Hz costs nothing and the growth
 * still reads as continuous because ORE_REGROW_RATE is slow.
 */
export const ORE_REGROW_INTERVAL = 15;
/**
 * A cell may only regrow once the cell BETWEEN it and the field's node holds
 * at least this fraction of its own capacity. That is what makes regrowth
 * spread outward from the node instead of the whole patch fading back in at
 * once — mine the near edge and it grows back first, strip the field to the
 * rim and it takes a long walk back out.
 */
export const ORE_REGROW_SPREAD = 0.3;
/**
 * The node cell itself regrows this much faster than the rest of the field.
 * The node is the only cell with no upstream neighbour, so without a bonus it
 * is the bottleneck for the entire patch.
 */
export const ORE_REGROW_NODE_BONUS = 3.0;

/* -- harvester decisions -------------------------------------------------- */

/**
 * Seconds a harvester's claim on an ore cell survives without being refreshed.
 * Long enough that a harvester crossing the map keeps its cell; short enough
 * that a claim held by a harvester that just died frees up before anyone
 * notices. The claim grid is deliberately time-based rather than handle-based
 * so it cannot leak — nothing has to remember to release it.
 */
export const ORE_CLAIM_TTL = 4.0;
/** Furthest a harvester will look for ore, in CELLS (40 * 4 m = 160 m). */
export const ORE_SEARCH_CELLS = 40;
/**
 * Metres ON TOP OF the harvester's own hull radius at which it starts scooping.
 *
 * Expressed as a slack rather than an absolute for one specific reason: the nav
 * layer parks a unit as soon as it is within `radius + NAV_ARRIVE_SLACK` of its
 * order point and then releases the flow field. If the economy's arrival test
 * were tighter than nav's, a harvester would be parked by nav three metres
 * short and would sit there forever waiting to reach a cell it was never going
 * to be driven any closer to. This slack is comfortably larger than
 * NAV_ARRIVE_SLACK, and it must stay that way.
 */
export const HARVEST_ARRIVE_RADIUS = 2.2;
/** Same, for the dock point. Also larger than NAV_ARRIVE_SLACK, and for the same reason. */
export const HARVESTER_DOCK_RADIUS = 2.6;
/**
 * Metres the dock point sits in FRONT of a refinery's footprint edge when the
 * def table carries no explicit dockOffset. Half a harvester length plus a
 * little, so the hull overlaps the apron rather than floating off it.
 */
export const HARVESTER_DOCK_STANDOFF = 3.4;
/** Metres behind the dock a second harvester waits while the first unloads. */
export const HARVESTER_QUEUE_GAP = 9.0;
/**
 * Seconds of no measurable progress toward its destination before a harvester
 * gives up on the current plan and re-scores. Covers a cell that became
 * unreachable, a refinery walled in by its owner, and a nav field that never
 * arrives.
 */
export const HARVESTER_STUCK_SECONDS = 4.0;
/** Ticks between OreSparkle FX pushes from one scooping harvester. */
export const HARVEST_FX_INTERVAL = 6;
/**
 * Ore units below which a cell is not worth claiming as a destination. A
 * harvester that drives 90 m for 3 units of ore looks broken.
 */
export const ORE_MIN_CLAIM = 25;

/* -- power ---------------------------------------------------------------- */

/**
 * Ticks between full power recomputes. The scan is also forced immediately on
 * any building completing, dying, being sold or changing hands, so this
 * interval only covers construction progress crossing 1.0.
 */
export const POWER_RECOMPUTE_INTERVAL = 5;
/**
 * Shed priority classes, lowest goes dark first. A deficit darkens structures
 * whose combined draw covers the shortfall — it never reduces the draw itself,
 * because a grid that heals by switching things off removes the entire reason
 * to build another power plant.
 */
export const POWER_SHED_ORDER = {
  defence: 0,
  radar: 1,
  tech: 2,
  factory: 3,
  refinery: 4,
  /** Never shed. A Construction Yard going dark is an unrecoverable state. */
  never: 99,
} as const;
/** Minimum seconds between "low power" EVA lines for one player. */
export const POWER_EVA_COOLDOWN = 25;

/* -- credits -------------------------------------------------------------- */

/**
 * The real base storage cap, and a deliberate correction to section 16.
 *
 * BASE_STORAGE is 1000 and START_CREDITS is 10000. Those two numbers were
 * authored independently and they collide head-on: taken literally, every
 * player begins the match nine thousand credits OVER their cap, so the very
 * first harvester load is 100% wasted, EVA calls for silos in the first ninety
 * seconds, and a Construction Yard that is destroyed and rebuilt vaporises the
 * player's bank. That is not a balance choice anybody made; it is two constants
 * that never met.
 *
 * Resolved in the only direction that cannot produce a bug report: the cap may
 * never be lower than the money the game hands you at the start. Silos and
 * refineries still matter — they raise the ceiling above 10 000, which is
 * exactly the point at which a player is rich enough for storage to be a real
 * decision — but nothing you were GIVEN can ever be confiscated by a cap.
 *
 * If the balance pass later wants overflow pressure earlier, the lever is
 * START_CREDITS in section 16, not this line.
 */
export const STORAGE_BASE = BASE_STORAGE > START_CREDITS ? BASE_STORAGE : START_CREDITS;

/** Minimum seconds between "silos needed" EVA lines for one player. */
export const SILO_EVA_COOLDOWN = 20;
/** Minimum seconds between "insufficient funds" EVA lines for one player. */
export const FUNDS_EVA_COOLDOWN = 4;
/** Ticks in the income-rate measurement window (30 ticks = 1 second). */
export const INCOME_WINDOW_TICKS = 30;
/**
 * EMA weight applied to each new income sample. 0.35 settles in about three
 * seconds — fast enough that killing a harvester shows on the HUD, slow enough
 * that the number does not flicker between unload pulses.
 */
export const INCOME_SMOOTHING = 0.35;
/**
 * Credits per second the HUD's rolling counter travels toward the true
 * balance. A big deposit should visibly SPIN rather than snap; RA's ticking
 * credit counter is half the reason banking a load feels good.
 */
export const CREDITS_TICKER_RATE = 1400;
/** Below this many credits the ticker snaps instead of rolling. */
export const CREDITS_TICKER_SNAP = 2;

/* ==========================================================================
 * 20. AI BRAIN (owned by src/sim/AI.ts + src/sim/AIStrategy.ts)
 *
 * Section 17 already holds the per-difficulty and per-personality tables that
 * the whole game agrees on. Everything here is the BRAIN's own tuning: the
 * cadences its layers run at, the thresholds its decisions compare against,
 * and the sizes of its fixed memory buffers.
 *
 * A note on difficulty, because it is the one place an RTS AI is usually
 * dishonest: NOTHING in this block gives the AI information a player could not
 * have. `AI_DIFFICULTY[].resourceBonus` in section 17 is an ECONOMIC handicap
 * and is published for the economy module to honour; the brain itself never
 * writes credits and never bypasses `IVision`. What actually differs per
 * difficulty here is reaction latency, action rate, and how well the AI PICKS
 * its army — see AI_SKILL below.
 * ========================================================================== */

/**
 * Per-difficulty knobs that only the brain cares about. Index-aligned with
 * `AI_DIFFICULTY` in section 17, so `AI_SKILL[p.aiDifficulty]` is always valid
 * for the same index that indexes the shared table.
 *
 * `composition` is the honest skill axis: at 0 the AI rolls its army from a
 * flat distribution (it builds whatever, in whatever proportion); at 1 it
 * weights every choice by how well that unit answers the threat mix it has
 * actually SEEN. Same information, better use of it.
 *
 * `creditFloor` is the reverse handicap — credits an Easy AI leaves sitting
 * idle instead of converting into army. A human beginner does exactly this.
 */
export const AI_SKILL = [
  { composition: 0.15, creditFloor: 1400, techBias: 0.6, scoutDelayMul: 2.2, discipline: 0.35, maxDefense: 3 },
  { composition: 0.55, creditFloor: 600,  techBias: 1.0, scoutDelayMul: 1.0, discipline: 0.65, maxDefense: 6 },
  { composition: 0.85, creditFloor: 250,  techBias: 1.2, scoutDelayMul: 0.7, discipline: 0.85, maxDefense: 8 },
  { composition: 1.00, creditFloor: 0,    techBias: 1.4, scoutDelayMul: 0.5, discipline: 1.00, maxDefense: 10 },
] as const;

/**
 * How many own entities one brain will track. A player fielding more than this
 * has already won; the roster simply stops growing rather than reallocating.
 */
export const AI_ROSTER_CAP = 1024;

/** Layer cadences in TICKS. Derived from the Hz knobs in section 17. */
export const AI_CADENCE = {
  /** Rebuild the owned-entity census + the visible-enemy sweep. */
  census: Math.round(SIM_HZ / AI_STRATEGY_HZ),
  /** Harvester babysitting, power projection, expansion checks. */
  economy: Math.round(SIM_HZ / AI_PRODUCTION_HZ),
  /** Queue decisions and structure placement. */
  build: Math.round(SIM_HZ / AI_PRODUCTION_HZ),
  /** Squad assembly, target selection, retreat checks. */
  squad: Math.round(SIM_HZ / AI_SQUAD_HZ),
  /** Scout dispatch and waypoint advance. */
  scout: SIM_HZ * 3,
} as const;

/** Economy layer. */
export const AI_ECONOMY = {
  /** Harvesters the AI wants per completed refinery. */
  harvestersPerRefinery: 3,
  /** Hard cap regardless of refinery count — past this they queue at the dock. */
  maxHarvesters: 9,
  /** Refineries the AI will build before it stops expanding its economy. */
  maxRefineries: 3,
  /** Cells outward that a harvester searches for ore before it is "starved". */
  oreSearchCells: 42,
  /** Cells outward the EXPANSION check searches, to find a second field. */
  expandSearchCells: 110,
  /** Power surplus the AI tries to stay above, in power units. */
  powerHeadroom: 40,
  /** Below this surplus a power plant pre-empts everything except a refinery. */
  powerPanic: 5,
  /** Seconds since last hit under which a harvester is considered under fire. */
  harvesterThreatSec: 3.0,
  /** HP fraction below which a harvester runs home instead of finishing its load. */
  harvesterFleeHp: 0.55,
  /** Credits above which a silo is worth building (fraction of storage cap). */
  siloFillFraction: 0.85,
} as const;

/** Build layer. */
export const AI_BUILD = {
  /** Items the AI keeps queued per tab. Deeper just hides money in the queue. */
  desiredQueueDepth: 2,
  /**
   * Ticks after which an unacknowledged ProductionStart is assumed lost and may
   * be re-issued. Without this the AI deadlocks forever against a production
   * module that is not present yet (the boot state of this repo).
   */
  requestTimeoutTicks: 300,
  /** Rings of cells the placement search sweeps outward from its anchor. */
  placementRings: 16,
  /** Cells of clear ground required around a new structure's footprint. */
  placementGapCells: 1,
  /** Ticks with no incoming damage before the AI considers teching up "safe". */
  techSafeTicks: 450,
  /** Anti-air structures the AI will build once it has seen an aircraft. */
  maxAntiAir: 4,
  /**
   * Metres above the terrain surface at which an entity is classified as
   * AIRBORNE. There is no `EntityKind.Air` and no `Locomotor.Fly` in the
   * contract layer, so altitude is the only signal available — and it is the
   * correct one: anything hovering 6 m up needs an answer this AI does not have
   * on the ground.
   */
  airAltitudeMetres: 6.0,
} as const;

/** Military layer. */
export const AI_MILITARY = {
  /** Fraction of the army held back to answer base attacks. */
  reserveFraction: 0.3,
  /** Reserve floor — a base with nothing at home dies to two scouts. */
  reserveMin: 2,
  /** Ticks the AI regroups after a beating before it will attack again. */
  regroupTicks: 300,
  /** Strike group is beaten once it has lost this fraction of its start size. */
  retreatLossFrac: 0.45,
  /** ...or once its mean HP falls below this. */
  retreatHpFrac: 0.4,
  /** Ticks between re-issuing the attack-move so the group re-converges. */
  reissueTicks: 45,
  /** Metres from the objective at which the group counts as "arrived". */
  arriveRadius: 16,
  /** Metres around a base structure that count as "the base" for defence. */
  defendRadius: 64,
  /** Threat units decayed per second in the coarse threat grid. */
  threatDecayPerSec: 0.5,
  /**
   * "My base is being hit" decays far slower than the threat grid, because it
   * is a MEMORY, not an observation: one raid should keep the AI defensive for
   * about as long as `UNDER_ATTACK_COOLDOWN`. It must also outlast the slowest
   * reaction time in AI_DIFFICULTY (2.4 s), or an Easy AI can never respond to
   * an attack at all — its evidence expires before it is allowed to act on it.
   */
  pressureDecayPerSec: 0.06,
  /** Ticks a remembered enemy structure survives without being re-sighted. */
  memoryTicks: 3600,
  /** Wave threshold grows by this much each time a wave is wiped out. */
  waveEscalation: 2,
  /** Metres ahead of the base, toward the enemy, that the strike group masses. */
  rallyOffset: 34,
} as const;

/** Scouting layer. */
export const AI_SCOUT = {
  /** Ticks before the first scout is dispatched (scaled by AI_SKILL.scoutDelayMul). */
  firstScoutTick: 240,
  /** Ticks between scouting sweeps once the first one is done. */
  repeatTicks: 1200,
  /** Metres from a waypoint at which the scout advances to the next one. */
  arriveRadius: 20,
} as const;

/** Fixed memory sizes. Allocated once per brain, never grown. */
export const AI_MEMORY = {
  /** Remembered enemy structures. Beyond this the oldest is evicted. */
  structureSlots: 96,
  /** Coarse threat grid resolution — MAP_CELLS must divide by this. */
  threatDiv: 8,
} as const;

/** Threat classes the composition scorer reasons about. */
export const AI_THREAT_CLASS_COUNT = 5;

/* ==========================================================================
 * 21. HUD — the Red Alert sidebar
 *
 * Every number here is a DESIGN pixel measured against a 168 x 768 sidebar
 * (VISUAL_DNA §2.2). Nothing in src/ui/** may hardcode a pixel; the CSS is
 * written as `calc(N * var(--ra-d))` where `--ra-d` is one design pixel at the
 * current uiScale, so the whole HUD is resolution-independent by construction.
 *
 * The vertical stack is a budget, not a suggestion: the header (cap + credits +
 * top pair + radar + arc + tabs) is 229 design px and the bottom cap is 41, so
 * the cameo grid gets whatever is left, floored to a whole 50 px row.
 * ========================================================================== */

/** Sidebar width in design px. RA2 shipped 168 and it divides cleanly by 4/8/12. */
export const HUD_DESIGN_WIDTH = 168;
/** Design height the vertical stack in VISUAL_DNA §2.2 was measured against. */
export const HUD_DESIGN_HEIGHT = 768;

/**
 * uiScale = clamp(floor(screenH / 720 * 4) / 4, 1, 4).
 * Quarter steps, integer-snapped, so a 1 design px bevel hairline never lands
 * on a fractional device pixel — a bilinear-smeared bevel is an instant fail.
 */
export const HUD_UI_SCALE_MIN = 1.0;
export const HUD_UI_SCALE_MAX = 4.0;
/** Screen height that maps to uiScale 1.0. */
export const HUD_UI_SCALE_BASE_HEIGHT = 720;
/** Scale quantum. 4 = quarter steps. */
export const HUD_UI_SCALE_STEPS = 4;

/** Vertical stack, design px. Keys match the VISUAL_DNA §2.2 rows. */
export const HUD_STACK = {
  topCap: 4,
  credits: 12,
  creditsGap: 3,
  topPair: 20,
  radarBezelTop: 9,
  radar: 110,
  radarBezelBottom: 13,
  actionArc: 26,
  tabStrip: 31,
  /** Everything above the cameo grid. */
  header: 229,
  bottomBand: 7,
  bottomCap: 24,
  bottomPlinth: 10,
  /** bottomBand + bottomCap + bottomPlinth. */
  footer: 41,
} as const;

/** Cameo grid geometry, design px (VISUAL_DNA §2.8). */
export const HUD_GRID = {
  columns: 2,
  /** 5:4 art. Not square — a square cameo grid is the #2 HUD fail. */
  artW: 60,
  artH: 48,
  /** Column pitch (art 60 + 4 gap). */
  pitchX: 64,
  /** Row pitch (art 48 + 2 gap). */
  pitchY: 50,
  /** Left gutter holding the power bar. */
  gutterLeft: 21,
  /** Right gutter holding the piston-dome rail. */
  gutterRight: 23,
  /** Never let the grid dominate at 4K. */
  maxRows: 12,
  minRows: 4,
} as const;

/** Radar panel, design px (VISUAL_DNA §2.5). */
export const HUD_RADAR = {
  fieldW: 142,
  fieldH: 110,
  /** The map bitmap is fitted to HEIGHT and letterboxed — keep the letterbox. */
  ledCount: 3,
  ledSize: 5,
  /** Seconds a minimap attack ping ring lives. */
  pingSeconds: 0.4,
  /** Rings alive at once before the oldest is recycled. */
  pingPool: 8,
} as const;

/**
 * Command bar, design px (VISUAL_DNA §2.12).
 *
 * HEIGHT IS 23, NOT THE 28 OF DECISION D13. The two specs collide here and the
 * look bible wins (CLAUDE.md): §9 caps the whole HUD at 12-16% of the frame,
 * and the sidebar alone is 13.125% at every resolution from 1080 up (168
 * design px x uiScale, by §2.1's own table). That leaves 2.875% of the frame
 * for a bar spanning 86.9% of the width, i.e. at most 3.31% of screen height —
 * 23 design px, not 28. At 28 the HUD measures 16.50% and busts the ceiling at
 * every resolution; at 23 it measures 15.90%. The 20 x 16 icons still fit in
 * the 19 px field between the white and dark-red rules.
 * `tests/hud.spec.ts` asserts the resulting share at four resolutions.
 */
export const HUD_COMMAND_BAR = {
  height: 23,
  iconW: 20,
  iconH: 16,
  /** Left-aligned; the right two thirds stay empty black. */
  firstIconCx: 104,
  iconPitch: 52,
  iconCount: 6,
  endCapW: 48,
} as const;

/** In-world overlay, design px unless noted (VISUAL_DNA §2.11). */
export const HUD_OVERLAY = {
  /** Health bar for a vehicle. Buildings scale with footprint. */
  barW: 34,
  barH: 4,
  /** Design px above the entity's projected top edge. */
  barLift: 10,
  /** 1-on/1-off vertical hatch period. */
  hatchPeriod: 2,
  /** Control-group badge plate. */
  badgeW: 12,
  badgeH: 14,
  /** Veterancy chevron (NEW — flagged as our addition, VISUAL_DNA D10). */
  chevronW: 8,
  chevronH: 10,
  /** Ground selection ellipse opacity. Never a filled disc, never a bracket. */
  ellipseAlpha: 0.35,
  /** Seconds a health bar stays up after the last damage tick. */
  damageBarSeconds: 4.0,
  /** Seconds a floating damage/credit number lives. */
  floaterSeconds: 1.1,
  /** Design px a floater rises over its life. */
  floaterRise: 26,
  /** Simultaneous floaters. Pooled; never allocated in the frame loop. */
  floaterPool: 48,
} as const;

/** Interaction timings in milliseconds (VISUAL_DNA §2.13). */
export const HUD_INTERACTION = {
  hoverFadeMs: 80,
  pressMs: 40,
  tooltipDelayMs: 220,
  tooltipMaxPx: 280,
  /** Queue badge punch-in. */
  badgePunchMs: 120,
  /** Credits tally: 12% of the remaining delta per frame, min 3. */
  creditsTallyRate: 0.12,
  creditsTallyMin: 3,
  /** Delta flyout above the credits readout. */
  creditsFlyoutMs: 600,
} as const;

/** Live cameo render budget (VISUAL_DNA §2.8 / I10). */
export const HUD_CAMEO = {
  /** Cameos re-rendered per frame at most. Everything else is cached. */
  perFrameBudget: 2,
  /** Hover turntable, degrees per second. */
  turntableDegPerSec: 12,
  /** Hover re-render rate. */
  hoverHz: 30,
  /** Supersample factor for the offscreen render target. */
  supersample: 2,
  /**
   * Subject fills this fraction of the BINDING axis (spec says 70-85%).
   * Measured against the footprint diagonal, not the bounding sphere — see the
   * fitting note in Cameos.ts.
   */
  subjectFill: 0.86,
  /** Three-quarter view: yaw/pitch of the cameo camera in degrees. */
  yawDeg: -34,
  pitchDeg: 24,
} as const;

/** Power bar (VISUAL_DNA §2.10). Tri-banded, bottom-anchored. */
export const HUD_POWER = {
  widthAllies: 12,
  widthSoviets: 14,
  /** 1 px bright line + 2 px dark. */
  hatchPitch: 3,
  /** Headroom shown above `produced` so a full bar is never ambiguous. */
  headroom: 1.35,
  /** Yellow transition band as a fraction of the bar. Vanishes near total draw. */
  yellowBand: 0.06,
  /** Brownout pulse rate in Hz. */
  pulseHz: 1.5,
} as const;

/** Superweapon countdown rows (VISUAL_DNA §2.12). */
export const HUD_SUPERWEAPON = {
  rowH: 18,
  rowGap: 2,
  /** Design px of clearance between the box and the sidebar. */
  sidebarClearance: 3,
  /** Ready-state flash rate in Hz. */
  flashHz: 1.0,
  maxRows: 4,
} as const;

/**
 * Faction HUD material sets. This is a FULL MATERIAL SWAP, never a hue rotate
 * (VISUAL_DNA §2.15, non-negotiable #5). Allied is cool violet-grey chrome over
 * a blue lens; Soviet is brass over brushed silver with red glyphs.
 *
 * The chrome highlight is `#BBBCD0` — cool violet-grey. Neutral white reads as
 * plastic and warm reads as gold; that violet cast is what makes it gunmetal.
 */
export interface HudFactionSkin {
  /** 3-zone bevel: specular -> body ramp -> black terminator. */
  bevelHi: string;
  metalHi: string;
  metalMid: string;
  metalLo: string;
  bevelLo: string;
  /** Interactive lens/plate gradient, top to bottom. */
  lens: readonly [string, string, string, string];
  lensRimHi: string;
  lensRimLo: string;
  /** Glyph colour cut into the lens. */
  glyph: string;
  glyphHi: string;
  /** Selected-tab plate and accents. */
  accent: string;
  accentHi: string;
  /** Credits digits and other numerals. */
  numerals: string;
  /** Radar frame + viewport rect. */
  radarFrame: string;
  /** Own / enemy / neutral minimap blips. */
  blipOwn: string;
  blipEnemy: string;
  blipNeutral: string;
  /** Wells are black and flat; nothing is mid-grey flat. */
  wellCredits: string;
  wellCameo: string;
  /** Power bar greens. */
  powerHi: string;
  powerMid: string;
  powerLo: string;
  /** "Ready" overlay. */
  readyFill: string;
  readyText: string;
  /** Command-bar glow-line icons. */
  commandIcon: string;
  commandIconHi: string;
  /** Bottom-cap emblem tint. */
  emblem: string;
}

export const HUD_SKIN_ALLIES: HudFactionSkin = {
  bevelHi: '#BBBCD0',
  metalHi: '#AAACBE',
  metalMid: '#6B6977',
  metalLo: '#3B3A43',
  bevelLo: '#07060B',
  lens: ['#7ED8FC', '#3B90F7', '#2265FB', '#050E58'],
  lensRimHi: '#95EDFF',
  lensRimLo: '#00001C',
  glyph: '#0D20A7',
  glyphHi: '#89E5FF',
  accent: '#8DFAFF',
  accentHi: '#C8FFFF',
  numerals: '#B0CCEA',
  radarFrame: '#C2C9BD',
  blipOwn: '#5A8FD0',
  blipEnemy: '#E8534F',
  blipNeutral: '#E8E8E8',
  wellCredits: '#10111A',
  wellCameo: '#080808',
  powerHi: '#B8FBB2',
  powerMid: '#4CA84C',
  powerLo: '#276316',
  readyFill: '#052A44',
  readyText: '#A9CFED',
  commandIcon: '#85CDF9',
  commandIconHi: '#DFFFFF',
  emblem: '#D0CEDF',
};

export const HUD_SKIN_SOVIETS: HudFactionSkin = {
  bevelHi: '#F0E39A',
  metalHi: '#CDCADB',
  metalMid: '#8A8B92',
  metalLo: '#4A4438',
  bevelLo: '#0B0906',
  lens: ['#CDCADB', '#B7B0BD', '#8A8B92', '#2A2620'],
  lensRimHi: '#F2DDA9',
  lensRimLo: '#1A1408',
  glyph: '#B31B18',
  glyphHi: '#E08A70',
  accent: '#FCEB1F',
  accentHi: '#FFF7A8',
  numerals: '#F1DB75',
  radarFrame: '#FDFAB9',
  blipOwn: '#E8534F',
  blipEnemy: '#5A8FD0',
  blipNeutral: '#E8E8E8',
  wellCredits: '#181818',
  wellCameo: '#0A0A0A',
  powerHi: '#6CE36E',
  powerMid: '#3D993B',
  powerLo: '#0B4A08',
  readyFill: '#1A1602',
  readyText: '#E9ED63',
  commandIcon: '#E7C86E',
  commandIconHi: '#FFF0C4',
  emblem: '#DED48F',
};

/**
 * Disabled/charging cameo tint: warm khaki sepia, hue 45-50, sat 0.30-0.45,
 * value +8%. Blues disappear entirely. The NAME LABEL is exempt (I13).
 */
export const HUD_DISABLED_TINT = {
  hueDeg: 47,
  saturation: 0.38,
  valueLift: 0.08,
} as const;

/** Minimap terrain colours by SurfaceId, heavily downsampled (VISUAL_DNA §2.5). */
export const HUD_MINIMAP_SURFACE = [
  '#4F5622', // Ground
  '#6A5A38', // Dirt
  '#8E7A4C', // Sand
  '#5E5A52', // Rock
  '#4A4A4A', // Concrete
  '#3E3E42', // Paving
] as const;
/** Water and ore on the radar. Ore is one of the few things allowed to be bright. */
export const HUD_MINIMAP_WATER = '#16304A';
export const HUD_MINIMAP_ORE = '#C8A83C';
/** Unexplored shroud on the radar is pure black — never a grey wash. */
export const HUD_MINIMAP_SHROUD = '#000000';

/* ==========================================================================
 * 20. INPUT, SELECTION AND ORDER FEEDBACK      (owned by src/input/**)
 *
 * The feel numbers. An RTS is judged in its first thirty seconds on whether a
 * click lands where the eye expected and whether an order visibly *happened*.
 * Everything here is measured in CSS pixels, metres or seconds — never in
 * frames, because the whole input layer is frame-rate independent.
 * ========================================================================== */

/** Pixels of travel before a HELD button starts painting a marquee. */
export const MARQUEE_MIN_PX = 6;
/** Pixels of slop between two clicks that still count as a double-click. */
export const DOUBLE_CLICK_SLOP_PX = 6;
/** Milliseconds within which two taps of the same digit centre the camera. */
export const GROUP_DOUBLE_TAP_MS = 380;
/**
 * Screen-pixel radius around the cursor searched for an entity before falling
 * back to the ground-plane hit. This is what makes clicking a tall Tesla Coil
 * feel right: its ground footprint is 4 m away from the pixels you aimed at.
 */
export const PICK_SCREEN_RADIUS_PX = 26;
/** Extra metres added to an entity's own radius when picking. Forgiving, not sloppy. */
export const PICK_WORLD_SLOP = 0.9;
/** Waypoints a single unit may hold from shift-queuing. */
export const MAX_WAYPOINTS = 8;
/** Metres from its order point at which a unit is considered arrived. */
export const ARRIVE_RADIUS = 2.6;

/* -- order feedback (world-space, drawn at RenderPhase.Overlay) ----------- */

/** Simultaneous order markers. Older ones are recycled oldest-first. */
export const ORDER_MARKER_POOL = 48;
/** Seconds an order marker lives. Short: it is a confirmation, not decoration. */
export const ORDER_MARKER_SECONDS = 0.9;
/** Metres of radius the marker ring settles at. */
export const ORDER_MARKER_RADIUS = 2.2;
/** The marker punches out to this multiple of its radius before settling. */
export const ORDER_MARKER_POP = 1.85;
/** Metres the marker floats above the ground so it never z-fights terrain. */
export const OVERLAY_LIFT = 0.16;
/** Move / rally / attack marker colours. Accents SCREAM (bible §0.1). */
export const ORDER_MOVE_COLOR = '#38F08A';
export const ORDER_ATTACK_COLOR = '#FF3B24';
export const ORDER_SPECIAL_COLOR = '#FFC64A';

/* -- marquee (the fallback DOM rectangle) ---------------------------------
 * The HUD's world-overlay canvas draws the marquee whenever it is mounted; the
 * input module only falls back to a DOM rectangle when it is not. These three
 * style it. There are deliberately NO selection-bracket constants here:
 * src/ui/Overlay.ts owns the selection affordance (VISUAL_DNA non-negotiable
 * #9 — "selection is the health bar appearing").
 * ------------------------------------------------------------------------ */

/** Marquee stroke, fill and glow. RA3 HUD language: thin, bright, cyan-green. */
export const MARQUEE_STROKE = 'rgba(127,216,192,0.95)';
export const MARQUEE_FILL = 'rgba(127,216,192,0.10)';
export const MARQUEE_GLOW = 'rgba(127,216,192,0.35)';

/* ==========================================================================
 * 20. AUDIO  (owner: audio module — VISUAL_DNA.md §3)
 *
 * Everything here is fully synthesized in the browser: zero audio files, no
 * network fetch, no decodeAudioData. One-shots are BAKED into AudioBuffers at
 * load through OfflineAudioContext; loops stay as live graphs because they need
 * continuous modulation.
 *
 * The numbers below are the ones a mix critic touches. Recipe internals (filter
 * centres, envelope shapes, oscillator ratios) live next to the recipe in
 * src/audio/Weapons.ts — they are composition, not configuration.
 * ========================================================================== */

/** Spec §3.1. Filter frequencies are rate-independent, so another rate is fine. */
export const AUDIO_SAMPLE_RATE = 48_000;

/**
 * Master output gain AFTER the limiter and the soft clip. 0.891 = -1.0 dBFS,
 * the ceiling the whole mix is authored against (§3.7).
 */
export const AUDIO_MASTER_GAIN = 0.891;

/**
 * Bus trim in dB, applied to the FIRST gain of each strip. The five user
 * sliders multiply into the same node with `gain = (v/100)^2.2`.
 * Voice sits ABOVE unity on purpose: EVA has to win, always.
 */
export const AUDIO_BUS_DB = {
  music: -9,
  sfx: 0,
  voice: 2,
  ui: -4,
  ambience: -14,
} as const;

/** §3.7 master. Ratio 20 with a 0 knee is a limiter, not a compressor. */
export const AUDIO_LIMITER = {
  threshold: -6,
  knee: 0,
  ratio: 20,
  attack: 0.003,
  release: 0.25,
} as const;

/** `y = tanh(kx)/tanh(k)` soft clip after the limiter, 4096 pt, 4x oversample. */
export const AUDIO_SOFTCLIP_K = 1.6;
export const AUDIO_SOFTCLIP_POINTS = 4096;

/**
 * Hard voice budget (§3.1): 64 one-shots total, and a per-category cap so a
 * tank line cannot starve the explosion that kills it. When a category is full
 * the oldest lowest-gain instance is ramped out over AUDIO_STEAL_RAMP_MS.
 */
export const AUDIO_MAX_ONESHOTS = 64;
export const AUDIO_MAX_LOOPS = 24;
export const AUDIO_VOICE_CAPS = {
  gunfire: 16,
  explosion: 8,
  tesla: 6,
  rocket: 10,
  engine: 8,
  footstep: 6,
  ui: 4,
  voice: 2,
  misc: 10,
} as const;
export const AUDIO_STEAL_RAMP_MS = 12;

/** Pre-cull: never allocate a node whose computed final gain is below this. */
export const AUDIO_CULL_DB = -42;

/**
 * Crowd summation (§3.1). Six of the same id inside 90 ms collapse to one
 * louder, wider instance smeared over three taps — this is what stops 28 Kirovs
 * or 40 rifles turning the mix to mush.
 */
export const AUDIO_CROWD = {
  windowSec: 0.09,
  threshold: 6,
  /** gain x (1 + boost * ln n) */
  boost: 0.42,
  smearMs: [0, 18, 41] as readonly number[],
} as const;

/**
 * Distance model (§3.7). `d` is measured in TILES: one tile is one nav cell,
 * i.e. CELL metres. `z` is the zoom factor, 1.0 at the default camera dolly.
 */
export const AUDIO_DISTANCE = {
  /** Metres per audio "tile". Keeps the spec numbers usable verbatim. */
  tileMetres: CELL,
  /** g = 1 / (1 + (d*z / refTiles)^2)  ->  -6 dB at 18 tiles. */
  refTiles: 18,
  /** fc = clamp(18000 / (1 + d*z/lpRefTiles), lpMinHz, 18000). */
  lpRefTiles: 24,
  lpMinHz: 900,
  lpMaxHz: 18_000,
  /** fhp = clamp(20 + d*z*hpPerTile, 20, hpMaxHz). Thins distant events. */
  hpPerTile: 1.4,
  hpMinHz: 20,
  hpMaxHz: 220,
  /** Reverb send ramps from near to far over sendFarTiles. */
  sendNearDb: -24,
  sendFarDb: -10,
  sendFarTiles: 40,
  /** pan = clamp(screenOffset * panScale, -panClamp, +panClamp). Never +-1. */
  panScale: 0.85,
  panClamp: 0.95,
  /** Upper 30% of the playfield reads as "further away": +2 dB of send. */
  upperSendBoostDb: 2,
  upperFrac: 0.3,
  /** Moving sources are re-aimed at 20 Hz with a 50 ms smoothing constant. */
  updateHz: 20,
  smoothSec: 0.05,
  /** Wide shots feel atmospheric, not punchy. */
  wideZoom: 2.2,
  wideSfxTrimDb: -3,
  wideAmbBoostDb: 2,
} as const;

/** §3.7 reverb table. One convolver live at a time, crossfaded over 2 s. */
export const AUDIO_REVERB = {
  desert: { rt60: 1.10, preDelayMs: 12, taps: [9, 17, 31], dampHz: 5500, returnDb: -22 },
  temperate: { rt60: 1.25, preDelayMs: 13, taps: [10, 18, 33], dampHz: 6000, returnDb: -21 },
  snow: { rt60: 0.60, preDelayMs: 8, taps: [7, 13], dampHz: 3500, returnDb: -26 },
  urban: { rt60: 1.90, preDelayMs: 18, taps: [11, 19, 29, 41], dampHz: 7000, returnDb: -16 },
  water: { rt60: 1.40, preDelayMs: 14, taps: [13, 23, 37], dampHz: 6000, returnDb: -20 },
} as const;
export const AUDIO_REVERB_CROSSFADE_SEC = 2.0;

/**
 * Ducking (§3.7). All multiplicative and stacked: `duckGain = product(active)`,
 * computed in ONE reducer per bus. Two systems must never write competing ramps
 * to one AudioParam.
 */
export const AUDIO_DUCK = {
  evaMusicDb: -11, evaSfxDb: -5, evaAmbDb: -6,
  evaAttackMs: 60, evaReleaseMs: 450,
  barkMusicDb: -4, barkSfxDb: -2,
  barkAttackMs: 40, barkReleaseMs: 250,
  boomSfxDb: -9, boomMusicDb: -3,
  boomAttackMs: 12, boomHoldMs: 400, boomReleaseMs: 700,
  nukeDb: -14, nukeAttackMs: 30, nukeHoldMs: 2200, nukeReleaseMs: 1200,
  pauseMs: 200, blurMs: 400,
  /** Seconds of window-blur before the context is suspended outright. */
  blurSuspendSec: 2,
} as const;

/** §3.2 EVA. Tier B (procedural formant synth) is the default and the aesthetic. */
export const AUDIO_EVA = {
  /** Baseline F0 in Hz. Female mid-alto, near-monotone. */
  f0: 190,
  /** Terminal fall in Hz applied linearly over the last `terminalFallMs`. */
  terminalFallHz: 22,
  terminalFallMs: 180,
  /** Per-syllable jitter around the baseline. */
  syllableJitterHz: 4,
  /** Second glottal saw, +7 cents at -9 dB. Stops it reading as a bare synth. */
  detuneCents: 7,
  detuneDb: -9,
  /** Radio chain (shared with barks; barks override drive and band). */
  highpassHz: 380,
  lowpassHz: 2900,
  presenceHz: 1750, presenceDb: 6.5, presenceQ: 1.3,
  deboxHz: 620, deboxDb: -4, deboxQ: 1.0,
  drive: 7.5,
  compThreshold: -22, compKnee: 3, compRatio: 8, compAttack: 0.004, compRelease: 0.09,
  slapMs: 34, slapFeedback: 0.12, slapWetDb: -18,
  microVerbMs: 180, microVerbWetDb: -24,
  /** Squelch. */
  preRollMs: 130, postRollMs: 60,
  dropoutChance: 0.18,
  /** Per-phoneme envelope and inter-token gaps. */
  attackMs: 8, releaseMs: 12, wordGapMs: 70, commaGapMs: 180,
  /** Queue depth, excluding the line currently speaking. */
  queueDepth: 3,
  /** Minimum silence between two lines, whatever the priority. */
  floorMs: 350,
  /** Session dampening applied to P3/P4 cooldowns only. */
  dampenAfter: [5, 10] as readonly number[],
  dampenMul: [1.5, 2.2] as readonly number[],
  dampenCap: 3.0,
} as const;

/** §3.3 barks. Louder in the mids, tighter band, harder drive. */
export const AUDIO_BARK = {
  highpassHz: 420,
  lowpassHz: 2500,
  drive: 11,
  preRollMs: 60,
  /** Per-unit and global cooldowns. Only ONE bark voice ever exists. */
  unitCooldownSec: 0.9,
  globalCooldownSec: 0.4,
  reselectCooldownSec: 2.5,
} as const;

/** §3.6 music. */
export const AUDIO_MUSIC = {
  bpm: 122,
  stepsPerBar: 16,
  barsPerSection: 8,
  sections: 4,
  /** Lookahead scheduler: tick every `tickMs`, schedule `horizonSec` ahead. */
  tickMs: 25,
  horizonSec: 0.12,
  /** E natural minor, E1 root. */
  rootHz: 41.203,
  /** Layer thresholds on the smoothed heat H_s. */
  layerUp: [0.10, 0.28, 0.52, 0.78] as readonly number[],
  /** Hysteresis so a layer cannot chatter at a boundary. */
  layerHysteresis: 0.04,
  layerDb: [-16, -12, -10, -8, -7] as readonly number[],
  /** Equal-power crossfade length, in bars. */
  fadeBars: 1,
  /** Combat heat smoothing per 250 ms tick — fast up, slow down. */
  riseK: 0.12,
  fallK: 0.04,
  heatTickMs: 250,
  /** Heat inputs (§3.6). */
  damageRef: 900,
  damageWindowSec: 4,
  nearUnitRef: 12,
  nearUnitTiles: 30,
  firingRef: 10,
  weights: [0.55, 0.30, 0.15] as readonly number[],
} as const;

/** §3.5 ambience. */
export const AUDIO_AMBIENCE = {
  /** Voss-McCartney pink noise source length, in seconds. */
  pinkSeconds: 10,
  crossfadeMs: 400,
  wind: {
    desert: { db: -30, lpMinHz: 380, lpMaxHz: 900, gustSec: [18, 40] as readonly number[] },
    temperate: { db: -28, lpMinHz: 340, lpMaxHz: 820, gustSec: [16, 34] as readonly number[] },
    snow: { db: -24, lpMinHz: 300, lpMaxHz: 700, gustSec: [20, 45] as readonly number[] },
    urban: { db: -34, lpMinHz: 250, lpMaxHz: 550, gustSec: [24, 50] as readonly number[] },
  },
  /** Base hum level by powered-plant count; index 0 is one plant. */
  humDb: [-34, -31, -29, -27.5, -26.5, -26] as readonly number[],
  humSagCents: -80,
  humSagSec: 3,
  humFadeSec: 4,
  /** Metres from the nearest owned structure past which the hum fades out. */
  humRangeMetres: 160,
} as const;

/** Screenshot harness: `?shot=` must be dead silent, and must never resume. */
export const AUDIO_MUTE_IN_SHOT_MODE = true;

/* ==========================================================================
 * 21. PRODUCTION, BUILD QUEUES AND STRUCTURE PLACEMENT
 *
 * The build loop the player lives in. Everything here is a FEEL number: how
 * long a stalled queue waits before it admits it is broke, how heavy a placed
 * structure lands, how far a fresh tank drives before it stops. They are
 * separated from the balance globals in section 16 (cost, buildTime, refund)
 * because those are what a designer tunes and these are what a *director*
 * tunes.
 * ========================================================================== */

export const PRODUCTION = {
  /**
   * Seconds a head item may crawl on partial payment before it flips to the
   * flashing ON HOLD state. Without a grace window a harvester unloading in
   * 40-credit dribbles would strobe the cameo once per tick.
   */
  fundsHoldGraceSeconds: 0.6,
  /** Minimum seconds between two "Insufficient funds" EVA lines per player. */
  evaInsufficientFundsSeconds: 6.0,
  /** Sim ticks between `production:progress` emits. 2 = 15 Hz = HUD_TEXT_HZ. */
  progressEventInterval: 2,
  /** Exponential-decay rate of the ticking credits readout. Higher = snappier. */
  creditsDisplayLambda: 9.0,
  /**
   * HP a structure has the instant it is planted, as a fraction of maxHp. It
   * ramps to 1.0 with buildProgress, so a rush that catches a half-built
   * refinery actually gets rewarded for it.
   */
  buildingStartHpFrac: 0.25,
  /** Metres past the footprint edge a produced unit is placed. */
  exitClearanceMetres: 1.2,
  /** Metres past the exit point the default (never-moved) rally flag sits. */
  rallyForwardMetres: 7.0,
  /** Rings of the spiral search for a free egress cell before giving up. */
  egressSearchRings: 5,
  /** Metres of clearance a fresh unit needs from anything already standing. */
  egressClearanceMetres: 1.15,
  /** Seconds a finished-but-blocked unit waits before it re-tries the exit. */
  egressRetrySeconds: 0.25,
} as const;

export const PLACEMENT = {
  /**
   * Metres from any OTHER completed friendly structure that new construction is
   * allowed. A Construction Yard uses the much larger BUILD_RADIUS instead —
   * that pair is what makes a base creep outward one structure at a time
   * instead of teleporting across the map.
   */
  adjacencyRadius: 20,
  /**
   * Splat layer stamped under a finished structure — `SurfaceId.Concrete` in
   * world/Biomes.ts. Every RA3 reference frame plants its structures on a
   * poured pad with a painted border (refs/ra3steam_07.jpg), and stamping the
   * terrain splat buys that for ZERO extra draw calls and no z-fighting.
   */
  padSurface: 4,
  /** Splat weight of the pad. Below 1 so the biome still reads through it. */
  padWeight: 0.85,
  /** Cells of pad painted beyond the footprint edge. */
  padMarginCells: 1,

  /**
   * Alpha of the translucent ghost volume. Low on purpose: the volume is
   * double-sided, so front and back walls stack to roughly twice this, and the
   * per-cell validity carpet has to read THROUGH it. Measured on a 3x2 War
   * Factory ghost at 62 m — at 0.30 the carpet disappeared entirely.
   */
  ghostOpacity: 0.17,
  /** Alpha of the ghost's edge wire — the part that actually reads at 39°. */
  ghostEdgeOpacity: 0.85,
  /** Metres the per-cell validity quads float above the ground. */
  cellLift: 0.16,
  /** Metres shaved off each side of a validity quad so the grid lines show. */
  cellInset: 0.22,
  /** Alpha of a validity quad. This is the part the player actually reads. */
  cellOpacity: 0.58,
  /** Largest footprint the overlay can draw, in cells per side. */
  maxFootprintCells: 6,

  /**
   * The chevron on the ghost's FRONT edge, which is the only thing that changes
   * on screen when a square footprint is rotated. Sized in cells along the
   * direction it points; clamped to just over half the footprint's depth so a
   * 1x1 wall does not get a marker bigger than the wall.
   */
  facingSize: 0.8,
  /** Metres the facing chevron floats above the ground. Above `cellLift`, so
   *  it reads on top of the validity carpet rather than fighting it. */
  facingLift: 0.22,
  /** Alpha of the facing chevron. Higher than the carpet: it is a pointer, and
   *  a pointer that has to be looked for is not one. */
  facingOpacity: 0.92,

  /** Cell is legal. HudLook.ok. */
  validColor: '#4ADE80',
  /** Cell is illegal. HudLook.danger. */
  invalidColor: '#E03A2A',
  /** Ghost volume tint while the whole footprint is legal. */
  ghostColor: '#7FD8C0',
} as const;

/* ==========================================================================
 * 21. FACTION ARCHITECTURE  (src/art/Building*.ts)
 *
 * APPENDED, never reordered. Bible 5.7 is the law this section encodes:
 * ALLIED = rounded, splayed, cool grey-white ceramic + electric blue, glass,
 * chrome; SOVIET = brutalist chamfered slab, OLIVE #646B33 (scorecard #10,
 * weight 3), riveted plate, capsule corner rails, tapered stacks, bulbous
 * pressure vessels, yellow lattice.
 *
 * Buildings carry ~1.4x a unit's detail density (bible 5.3: units 28-36%,
 * buildings 40-46% Sobel), 5-8% team colour instead of a vehicle's 8-14%
 * (R-T1), and a REAL foundation pad rather than a decal.
 * ========================================================================== */

/**
 * Structure paint. Same shape as `UnitPalette` so one greeble factory serves
 * both, but the values are architectural, not vehicular.
 */
export const RA3_ALLIED_STRUCTURE: UnitPalette = {
  /** White ceramic tile. Lighter than a hull: buildings catch the key. */
  base: '#BCC6D6',
  shadow: '#28303F',
  /** Cobalt trim. R-T2: flat slab inserts, never a tint. */
  team: '#2A2ED0',
  teamSecondary: '#1C169A',
  insignia: 'eagle',
  insigniaColor: '#F2F5FA',
  hullNumber: 1949,
  emissive: '#8DD9CD',
  /** Chrome, read as a warm grey so it never goes blue steel (bible 5.4). */
  bareMetal: '#7E7458',
  trackLink: '#222A38',
  glass: '#0F2E60',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  /** Allied architecture is welded and tiled. No rivets, ever. */
  rivets: false,
};

/** SOVIET structures. Olive over concrete, riveted, industrial. */
export const RA3_SOVIET_STRUCTURE: UnitPalette = {
  base: '#67702C',
  shadow: '#282C10',
  team: '#E01418',
  teamSecondary: '#D51512',
  insignia: 'star',
  insigniaColor: '#E4C300',
  hullNumber: 1917,
  /** The one faction whose accents are orange furnace, not cyan (R-T5). */
  emissive: '#FF7A1E',
  bareMetal: '#61503A',
  trackLink: '#281A11',
  glass: '#241C10',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: true,
};

/**
 * FOUNDATION PADS. Bible 5.7 ALLIED-6 ("flat near-black charcoal slab") and
 * SOVIET-7 ("raised grated steel deck plus a concrete apron with a red star").
 * A separate atlas because the pad is a separate material: ground is roughness
 * 0.88 / env 0.35 with NO clearcoat, and painted armour is 0.52 + clearcoat.
 *
 * The pads are the cheapest chroma in the whole game and were being wasted.
 * Every structure sits on one, so they cover a large, contiguous share of any
 * base shot — and they were pure neutral ('#1E2024' at S 0.10, '#8A867A' at
 * S 0.09). Value is unchanged: the Allied slab is still near-black and the
 * Soviet deck is still mid grey-brown. Only the hue axis moved — Allied to
 * slate blue (S 0.54), Soviet to warm ochre steel (S 0.30) — which is exactly
 * the near-black-but-unmistakably-blue pavement in refs/ra3steam_02.jpg.
 */
export const RA3_ALLIED_PAD: UnitPalette = {
  base: '#172231',
  shadow: '#070C14',
  team: '#2A2ED0',
  teamSecondary: '#0F1726',
  insignia: 'eagle',
  insigniaColor: '#6E7C8A',
  hullNumber: 1949,
  emissive: '#8DD9CD',
  bareMetal: '#68727E',
  trackLink: '#0D141F',
  /** Deep cobalt canopy — a named RA3 accent mass, not a dark grey. */
  glass: '#0F2E60',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: false,
};

export const RA3_SOVIET_PAD: UnitPalette = {
  /** Grated steel deck. */
  base: '#8A8060',
  shadow: '#2E2A18',
  team: '#D02E1C',
  /** The apron the star decal is painted onto. */
  teamSecondary: '#B4A87E',
  insignia: 'star',
  /** Bible SOVIET-7 names this colour explicitly. */
  insigniaColor: '#D02E1C',
  hullNumber: 1917,
  emissive: '#FF7A1E',
  bareMetal: '#807656',
  trackLink: '#2A2414',
  glass: '#1E1A16',
  stencil: '#D8D2C8',
  hazard: '#E5CB43',
  rivets: true,
};

export const RA3_STRUCTURE_PALETTE = {
  allies: RA3_ALLIED_STRUCTURE,
  soviets: RA3_SOVIET_STRUCTURE,
} as const;

export const RA3_PAD_PALETTE = {
  allies: RA3_ALLIED_PAD,
  soviets: RA3_SOVIET_PAD,
} as const;

/**
 * Greeble tuning for STRUCTURES.
 *
 * `panelDensity` multiplies the greeble factory's panel-run count. Units ship
 * at 1.0 and measure 29-32% Sobel; scorecard #34 wants 40-46% on buildings,
 * i.e. ~1.4x the edge energy. These two numbers are the measured solution --
 * the Allied figure is higher because Allied architecture carries no rivets
 * and has to reach the band on panel lines and banding strips alone.
 */
export const BUILDING_GREEBLE = {
  /** Structure atlas edge in px at High/Ultra. */
  atlasSize: 512,
  /** The pad atlas is half-size: it is four tiles of flat concrete. */
  padAtlasSize: 256,
  /**
   * MEASURED, not guessed. Sweeping the greeble factory over 1.0..5.0 and
   * running its own Sobel probe gives, on the paintMed tile a wall actually
   * samples: allies 31.1% at 1.0 -> 41.5% at 3.4; soviets 35.9% at 1.0 ->
   * 45.3% at 2.6. Both land inside scorecard #34's 40-46%. Allies need the
   * higher figure because Allied architecture carries no rivets and has to
   * reach the band on panel lines and banding strips alone.
   */
  panelDensityAllies: 3.4,
  panelDensitySoviets: 2.6,
  /** Concrete is jointed, not panelled: a slab tile wants far fewer runs. */
  padPanelDensity: 1.0,
  /** Rivet pitch in atlas px. Bible SOVIET-6: 10-14 px at reference scale. */
  rivetPitchPx: 11,
  /** Deck bolts are sparser than hull rivets. */
  padRivetPitchPx: 14,
  /** Deterministic per-faction generator seeds. Atlases stay diffable. */
  seedAllies: 0x41_2b,
  seedSoviets: 0x50_2b,
  seedPadAllies: 0x41_9d,
  seedPadSoviets: 0x50_9d,
} as const;

/**
 * GEOMETRY LANGUAGE for structures. Every number is bible 5.7.
 */
export const BUILDING_GEOMETRY = {
  /**
   * Chamfer as a fraction of a mass's smallest dimension. Buildings are ~4x a
   * unit's size, so the unit fractions (10% / 7.5%) would round a 6 m slab into
   * a pillow. These land the same 2-4 px on-screen band scorecard #11 measures.
   */
  chamferFractionAllies: 0.055,
  chamferFractionSoviets: 0.040,
  /** Absolute floor in metres. Never zero -- a razor edge is an automatic fail. */
  chamferMinMeters: 0.06,
  chamferMaxFractionOfMin: 0.28,
  /** Bible 5.5 / scorecard #40: stacks and tanks are 12-16 facets, never 32. */
  cylSegments: 14,
  /** A fat capsule corner rail reads at 16; it is the most-looked-at cylinder. */
  railSegments: 16,
  sphereRings: 12,

  /* -- ALLIED 1..6 -------------------------------------------------------- */
  /** Base flares 1.25-1.4x wider than the top. */
  alliedSkirtFlare: 1.30,
  /** Open-topped crown: 0.45-0.55x base width, 0.30x total height. */
  alliedCrownWidth: 0.50,
  alliedCrownHeight: 0.30,
  /** 3-5 banding strips of alternating depth (+/-3%). */
  alliedBandCount: 4,
  alliedBandDepth: 0.03,

  /* -- SOVIET 1..7 -------------------------------------------------------- */
  /** 45-degree chamfers on every vertical corner at 6-9% of box width. */
  sovietCornerCut: 0.075,
  /** Fat capsule corner rails, 10-14% of wall height. */
  sovietRailDiameter: 0.12,
  /** Stacks: 8-12% of building width, 35-55% of height above the roof. */
  sovietStackDiameter: 0.10,
  sovietStackRise: 0.45,
  /** Top radius 0.85x base, two red bands. */
  sovietStackTaper: 0.85,
  /** Bulbous pressure vessels, 0.20-0.30x building width. */
  sovietVesselRadius: 0.24,
  /** Yellow lattice: X-braced squares, tube diameter and brace pitch, metres. */
  latticeTube: 0.22,
  latticePitch: 1.9,
  /** Catwalk railings carry three horizontal rails. */
  railingRails: 3,
} as const;

/** Bible 5.7 ground-contact rules, in fractions of the building footprint. */
export const BUILDING_PAD = {
  /** ALLIED-6: extends 8-12% beyond the footprint. */
  alliedOverhang: 0.10,
  /** ALLIED-6: thickness 2-3% of building height. */
  alliedThickness: 0.025,
  /** SOVIET-7: 10-15% beyond, 4-6% of height thick. */
  sovietOverhang: 0.13,
  sovietThickness: 0.05,
  /**
   * How far the pad skirt is extruded DOWN below the model origin, in metres.
   *
   * The bridge instances one shared geometry at the entity position, so a pad
   * cannot be re-meshed per site. A skirt instead guarantees contact: terrain's
   * `isBuildable` only passes cells inside TERRAIN_BUILD_FLATNESS, and the
   * playable swell is +/-0.4-0.8 m over 15-30 m (bible 6.4), so 1.5 m of skirt
   * buries the joint on every legal site with margin. Verified at boot against
   * the live heightfield -- see buildings.system.ts.
   */
  skirtDepth: 1.5,
  /** Metres the pad top sits above the model origin, so it never z-fights. */
  lift: 0.04,
} as const;

/**
 * R8 FOR STRUCTURES. Same idea as UNIT_VALIDATION, different bands, and split
 * three ways because a Construction Yard, a Tesla Coil and a 4 m wall panel
 * are not the same kind of object.
 *
 * ON `dominantFraction`. The unit band (35-50% of the silhouette) is
 * UNSATISFIABLE for architecture and measurement says so: the main slab of
 * every structure in the roster measures 62-96% of its own side elevation,
 * because that is what a building IS. Brutalism is a dominant slab. What R8 is
 * really guarding against here is "three plain boxes", so the check that
 * carries meaning is that SOMETHING other than the biggest block owns a
 * readable slice of the outline — hence a ceiling, not a window. Walls are
 * exempt outright: a wall panel is one slab and pretending otherwise would
 * force decoration onto a piece that is repeated eighty times down a perimeter.
 */
export const BUILDING_VALIDATION = {
  primaryMassMin: 3,
  primaryMassMax: 9,
  /** Discrete readable greeble OBJECTS, by class. A wall panel repeated eighty
   *  times down a perimeter does not want a production structure's clutter. */
  greebleMin: { structure: 8, defence: 5, wall: 3 },
  greebleMax: 26,
  dominantFraction: {
    structure: [0.20, 0.88] as readonly [number, number],
    defence: [0.20, 0.94] as readonly [number, number],
    /** A wall panel is a slab by definition. Not measured. */
    wall: null,
  },
  /**
   * R-T1: team colour as a fraction of SCREEN-PROJECTED surface.
   *
   * 4-10% brackets the bible's 5-8% for a real building. Defences get the
   * wider band deliberately: R-T1's figure is written about a 12 m production
   * structure, and 6% of a 4 m sentry drum is a panel the size of a dinner
   * plate that vanishes at RTS distance. Every RA3 reference frame shows
   * defences banded far more strongly than the base behind them.
   */
  teamFraction: {
    structure: [0.04, 0.10] as readonly [number, number],
    defence: [0.06, 0.18] as readonly [number, number],
    wall: [0.015, 0.10] as readonly [number, number],
  },
  /** R-T4: one insignia per structure. Defences and walls carry none. */
  insigniaCount: 1,
  /**
   * R-T5: emissive windows. Buildings run hotter than units because they have
   * lit interiors. A defence has no interior to light — a sentry drum carries
   * two lamps and correctly measures 0.2% — so it gets its own floor rather
   * than being decorated up to a band written about office blocks.
   */
  emissiveFraction: {
    structure: [0.006, 0.045] as readonly [number, number],
    defence: [0.001, 0.030] as readonly [number, number],
    wall: [0.0005, 0.020] as readonly [number, number],
  },
  /** Scorecard #34: 40-46% on buildings; below the floor it reads untextured. */
  sobelFloor: 0.30,
  sobelTarget: [0.38, 0.47] as readonly [number, number],
  /** Silhouette height must land within this of BUILDING_DIMENSIONS.height. */
  heightTolerance: 0.12,
} as const;

/**
 * ANIMATION. Every one of these is driven per-instance in the vertex/fragment
 * shader off `aState` (hpFrac, buildProgress, selected, seed) plus one shared
 * `uTime` uniform, so an animated base still costs one draw call per part.
 */
export const BUILDING_ANIM = {
  /** Extra metres a structure sinks below its pad at buildProgress 0. */
  riseMargin: 0.6,
  /** Emissive colour of the scan band at the construction cut line. */
  riseBandColor: '#9DFEF5',
  /** Metres of the glowing band that rides the ground cut while building. */
  riseBandMeters: 0.55,
  /** Seconds for one production-bay door cycle. */
  doorPeriodSeconds: 9.0,
  /** Fraction of the cycle the door spends fully open. */
  doorOpenFraction: 0.30,
  /** Radians/second a radar dish sweeps. RA3 dishes are slow and deliberate. */
  dishRadiansPerSecond: 0.55,
  /** Health below which the structure starts sooting. */
  damageOnset: 0.66,
  /** Health below which interior fire shows through the windows. */
  burnOnset: 0.33,
  /** Bible 8.8: damaged structures glow #FFB01E through their windows. */
  burnColor: '#FFB01E',
  /** Flicker rate of that interior fire, Hz. */
  burnFlickerHz: 11,
  /** Soot multiplier applied to albedo at zero health. */
  sootMultiplier: 0.44,
  /** Emissive gain the selection pulse adds, in team colour. */
  selectEmissive: 0.35,
  /** Selection pulse rate, Hz. */
  selectPulseHz: 1.4,
} as const;

/**
 * FROZEN STRUCTURE FOOTPRINTS in cells, exposed so placement can validate
 * without importing geometry. Everything here that also appears in
 * BUILDING_DIMENSIONS agrees with it exactly; the rest are new defences.
 */
export const BUILDING_FOOTPRINTS: Readonly<Record<string, { w: number; h: number; height: number }>> = {
  conYard: { w: 3, h: 3, height: 11.0 },
  powerPlant: { w: 2, h: 2, height: 9.0 },
  barracks: { w: 2, h: 2, height: 6.4 },
  refinery: { w: 3, h: 2, height: 9.0 },
  warFactory: { w: 3, h: 2, height: 8.5 },
  radar: { w: 2, h: 2, height: 12.0 },
  techCentre: { w: 2, h: 2, height: 8.0 },
  oreSilo: { w: 1, h: 1, height: 5.0 },
  pillbox: { w: 1, h: 1, height: 2.2 },
  aaTurret: { w: 1, h: 1, height: 7.0 },
  sentryGun: { w: 1, h: 1, height: 3.4 },
  teslaCoil: { w: 1, h: 1, height: 9.0 },
  wall: { w: 1, h: 1, height: 2.0 },
  gate: { w: 1, h: 1, height: 3.6 },
};

/**
 * The main slab of a production structure is DELIBERATELY shorter than its
 * roofline: bible R-S2 wants a tank at 0.50-0.62x a production structure's
 * silhouette, and BUILDING_DIMENSIONS heights are rooflines that include
 * stacks, masts and gantries (bible SOVIET-3 puts stacks 35-55% ABOVE the
 * roof). This is the fraction of the frozen height the massive body occupies.
 */
export const BUILDING_BODY_FRACTION = 0.56;

/* ==========================================================================
 * 22. FOG OF WAR AND VISION   (owned by src/sim/Vision.ts + src/render/FogOfWar.ts)
 *
 * Three cell states, one grid, one 128x128 R8 texture. Section 15 already owns
 * the two numbers the rest of the game agrees on — `VISION_TICK_INTERVAL` (the
 * stamp cadence) and `VISION_REGROW_DELAY` (how long a cell stays lit after the
 * unit that lit it walks away). Everything below is this module's own.
 *
 * The one rule behind every number here: **advancing vision must ANIMATE, never
 * pop.** The grid is a 10 Hz integer thing; the screen is a 60 Hz continuous
 * thing. The bridge between them is a per-cell smoothed scalar (§ FOG_REVEAL /
 * FOG_CONCEAL below), which is also what makes the shroud edge readable as a
 * soft frontier rather than as a staircase of 4 m squares.
 * ========================================================================== */

/** Fog on by default. `?fog=off` and a scenario's `revealMap` both override. */
export const FOG_ENABLED_DEFAULT = true;
/**
 * `?shot=` implies fog OFF unless `?fog=on` is also present. The screenshot
 * harness photographs ART; a black frame is not a critique of the art, it is a
 * critique of the fog, and every `?shot=` scenario already declares `revealMap`.
 */
export const FOG_REVEAL_IN_SHOT_MODE = true;

/* -- the grid -------------------------------------------------------------- */

/**
 * Seconds a newly-revealed cell takes to reach full brightness, and seconds a
 * cell takes to fade back to remembered. VISUAL_DNA I7 asks for a 250 ms reveal
 * fade; concealment is slower so a passing scout leaves a trail that closes
 * behind it instead of snapping shut on its back bumper.
 */
export const FOG_REVEAL_SECONDS = 0.25;
export const FOG_CONCEAL_SECONDS = 0.55;
/**
 * The smoothed scalar a cell holds when it is explored but not visible. The
 * shader reads [0, this] as "unexplored -> remembered" and [this, 1] as
 * "remembered -> clear", so one channel carries both ramps.
 */
export const FOG_EXPLORED_LEVEL = 0.5;

/**
 * Sight radius in metres for an entity whose def table has not landed yet
 * (`store.sight` is 0 at spawn until production or a scenario fills it in).
 * Indexed by EntityKind. A structure sees further than the infantryman standing
 * beside it — that is what makes a base feel like it holds ground.
 */
export const FOG_DEFAULT_SIGHT = [
  0,    // None
  9,    // Infantry
  11,   // Vehicle
  15,   // Building
  0,    // Wreck
  0,    // Prop
  0,    // Crate
] as const;
/** Floor on any non-zero sight radius, metres. Below ~2 cells fog flickers. */
export const FOG_MIN_SIGHT = 6.0;
/**
 * Global multiplier on every sight radius. The single knob for "the map feels
 * claustrophobic" / "fog does nothing". Never bake this into a def table.
 */
export const FOG_SIGHT_SCALE = 1.0;
/** Metres a structure adds to its own sight, on top of FOG_SIGHT_SCALE. */
export const FOG_STRUCTURE_SIGHT_BONUS = 3.0;
/** Metres of vision granted around the whole map when a scenario reveals it. */
export const FOG_SPAWN_REVEAL_RADIUS = 26.0;

/* -- cloak and detection --------------------------------------------------- */

/**
 * A powered Radar Dome (`EntityFlag.IsRadar`) doubles as a cloak detector at
 * this multiple of its sight radius. No def field carries "detector", so this
 * is the one default the module infers rather than being told; anything else
 * opts in explicitly through `Vision.setDetector(id, metres)`.
 */
export const FOG_RADAR_DETECT_MUL = 1.6;
/** Seconds a cloaked unit stays exposed after it fires or takes damage. */
export const FOG_CLOAK_REVEAL_SECONDS = 3.0;
/** Detectors tracked at once. Past this the newest are ignored, never allocated. */
export const FOG_MAX_DETECTORS = 64;

/* -- the shroud overlay ---------------------------------------------------- */

/**
 * Ground samples per CELL along each axis in the shroud carpet. 1 gives a
 * 129x129 vertex grid (33k triangles, ONE draw call) which is plenty: the fog
 * value itself is bilinear-filtered in the fragment shader, so this grid only
 * has to follow the terrain SILHOUETTE, not the fog gradient.
 */
export const FOG_MESH_SAMPLES_PER_CELL = 1;
/** Metres the carpet floats above the surface it samples. Cosmetic only. */
export const FOG_MESH_LIFT = 0.12;
/**
 * Alpha of the shroud over explored-but-not-visible ground. The colour is
 * `ArtDirection.shroud.exploredTint`, blended in LINEAR space before the grade,
 * which is why this is well below the "looks right in Photoshop" value.
 */
export const FOG_EXPLORED_ALPHA = 0.62;
/** Alpha over never-explored ground. 1.0 — unexplored is opaque, always. */
export const FOG_UNEXPLORED_ALPHA = 1.0;
/**
 * Amplitude of the domain warp applied to the fog lookup, as a fraction of one
 * texel. Breaks the 4 m grid into an organic frontier without costing a blur.
 * VISUAL_DNA §1.10 wants a dithered edge, never a hard cut and never a pure
 * gradient; this plus FOG_DITHER is that edge.
 */
export const FOG_EDGE_WARP = 1.25;
/** Ordered-dither amplitude at the shroud edge, in fog-value units. */
export const FOG_DITHER = 0.10;

/**
 * Max texture uploads per second. The smoothing runs every frame in a
 * Float32Array; only the byte view is re-uploaded, and only while something is
 * actually animating. 16 KB at 30 Hz is 0.5 MB/s — free.
 */
export const FOG_UPLOAD_HZ = 30;

/* ==========================================================================
 * 22. VFX — PARTICLES, BEAMS, EXPLOSIONS, SCENE-LIGHT INJECTION
 *
 * Transcribed from RA3_LOOK_BIBLE §8 and §14 R6. Two conventions run through
 * the whole block and are worth stating once:
 *
 *  - TL = 1 tank length = 7 m. Sizes the bible quotes in TL are stored in
 *    METRES here, already multiplied out, so no consumer has to remember.
 *  - PIXEL figures are quoted at 2560x1440 and are stored UNSCALED. The beam
 *    shader converts them with `2*tan(fov/2)/1440 * viewDepth`, which is
 *    independent of the actual render height — so a "3 px core" is exactly
 *    3 px when the critic screenshots at 1440p, and holds its apparent size
 *    at any other resolution instead of shrinking.
 * ========================================================================== */

/** Reference frame height every px figure in this section is quoted at. */
export const VFX_PX_REFERENCE_HEIGHT = 1440;

/* ---- pools -------------------------------------------------------------- */

/**
 * PointLights permanently resident in the scene (bible §8.9 wants 8–12).
 * They are added ONCE at boot and animated to intensity 0 when idle: adding or
 * removing a light changes `numPointLights` and recompiles every shader in the
 * scene, which is a 200 ms hitch in the middle of a firefight.
 */
export const VFX_LIGHT_POOL = 12;

/**
 * PointLight falloff exponent. Physically correct is 2.0, but RA3's measured
 * wash is far wider than inverse-square — pavement 300 px from a beam still
 * reads `#4560A3`. 1.35 reproduces that reach without a 10x intensity that
 * would blow the core out. Scorecard #28 is scored against this number.
 */
export const VFX_LIGHT_DECAY = 1.28;

/**
 * Global multiplier on every VFX light. **Measured, not guessed, and it is the
 * one number to retune when the grade lands.**
 *
 * Driven at the bible's authored candela this renderer injects NO wash at all:
 * a bare `THREE.PointLight(0xffb05a, 28, 49, 1.28)` four metres above a blast
 * moves the surrounding ground by a MEDIAN OF ZERO luminance units. Two
 * measured sweeps at 1052x595 on a real GPU decided this number.
 *
 * (a) Scorecard #28 — median dL over the 100-200 px (1440p-equivalent) annulus
 *     around ONE 2.2 TL explosion, and (b) the whole-frame mean luminance with
 *     TWO explosions up at once, against a base frame mean of 84.8:
 *
 *       scale    #28 dL      2-blast frame mean    clipped px
 *        x3       37.0            110.2               0%
 *        x4       40.0            116.0               0%
 *        x5   ->  ~40             ~118                0%
 *        x8       41.7            129.5               0%
 *        x12      45.5            148.4               0.01%
 *        x24      64.6            185.1               1.50%   <- whiteout
 *
 * x24 passes #28 with the most margin and is WRONG: two explosions more than
 * double the frame mean and the image goes to white paste, which is bible §14
 * R5 ("someone fixed the darkness") arriving from the other direction. x5
 * clears the >=35 L bar with room and keeps a two-blast frame at +39%, which
 * reads as a violent flash instead of a blown exposure.
 *
 * The response is this non-linear because AgX at exposure 1.05 compresses the
 * highlights hard, and the frame currently sits ~1.5-2x above the bible's
 * median-0.317 target (independently reported by the terrain module). Fix the
 * grade to ACES @ 0.92 and re-derive this against the SAME two measurements
 * rather than by eye — the light will do more work on a darker frame, so this
 * number should come down, not up.
 *
 * The per-source values in VFX_LIGHTS stay at the bible's authored numbers on
 * purpose: their RATIOS are the art direction (an explosion is 2.3x a muzzle
 * flash) and only the shared exposure factor is in question here.
 */
export const VFX_LIGHT_INTENSITY_SCALE = 5.0;

/**
 * Bible §8.9, verbatim except where noted. `range` in metres (the bible's
 * TL x 7).
 *
 * THE EXPLOSION ROW IS THE ONE DEVIATION, and it is deliberate. The bible's
 * 28 cd / 49 m, through `VFX_LIGHT_INTENSITY_SCALE`, is 140 effective candela
 * reaching 49 metres — and the combat fixture frames about 60 metres of ground,
 * so a single tank death relit the ENTIRE visible world. Measured against an
 * identical explosion-free frame, one 2.2 TL death lifted the median of every
 * pixel it did not set on fire by +11.5 L and pushed 58% of the frame over a
 * +12 L threshold. That wash is the effect doing its job (scorecard #28 exists
 * precisely so effects light the world) but its REACH was the whole shot, which
 * is the "the flash blocks the screen" complaint arriving by a second route.
 *
 * 20 cd / 40 m keeps the near-field wash the scorecard measures — that annulus
 * is 3-6 m from the blast, where the falloff has barely started — and pulls the
 * far field in so the corners of the frame stop flaring. Re-measure both
 * numbers together if this is ever retuned; peak alone will not do it.
 */
/**
 * How far a ONE-SHOT light's claim may be merged into an existing light of the
 * same kind, and how much brighter the merged result may get. See
 * `LightPool.spawn`.
 *
 * THE MEASUREMENT. `claimSlot` took the first free slot with no notion of
 * locality, so twelve muzzle flashes inside a squad's footprint became twelve
 * resident PointLights at the same place and three's light loop SUMMED them.
 * Measured at n=20 co-located unit deaths (`tools/flash-stack.mjs`), the light
 * pile on its own took the frame area over L=0.95 from 12.4% to 62.6% — x3.0 —
 * on top of what the additive quads were doing. It is bounded only by the pool
 * size, which is not a brightness policy, it is an accident.
 *
 * Merging rather than dropping is what makes this "one bright flash" instead of
 * "the 13th flash does not light anything": the incumbent is brightened towards
 * a ceiling and its envelope refreshed, so a squad's ground wash is ONE wash
 * that stays lit while they fire.
 *
 * It also frees slots, which the GPU pass measured at 2.57 ms per resident light
 * per frame at 1440p — so fewer, merged lights is the same direction as
 * `VFX_LIGHT_POOL_BY_TIER`, not a trade against it.
 */
export const VFX_LIGHT_MERGE_CEIL = 1.9;

export const VFX_LIGHTS = {
  explosion:   { color: '#FFB05A', peak: 20, range: 40.0, riseMs:  40, holdMs:  60, fallMs: 400, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 7.0 },
  muzzle:      { color: '#FFD28A', peak: 12, range: 17.5, riseMs:  10, holdMs:  10, fallMs:  70, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 7.0 },
  teslaImpact: { color: '#5A82FF', peak: 14, range: 24.5, riseMs:  30, holdMs:  40, fallMs: 130, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 5.0 },
  beam:        { color: '#6FA8FF', peak:  9, range: 42.0, riseMs:  60, holdMs:   0, fallMs: 180, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 0 },
  /**
   * The sustained light a TESLA ARC carries while it is up.
   *
   * The bible's table has no row for this: "beam midpoint 9" describes a
   * continuous prism/laser beam and "tesla impact 14" describes the hit, but a
   * live arc is a third thing and is the brightest object in any RA3 frame
   * containing one. It is set in the EXPLOSION's energy class, not the beam's,
   * for two reasons: an arc is on screen for a second rather than 100 ms, and
   * measured on this renderer everything below ~500 effective candela sits
   * under the AgX knee and injects no visible wash at all (peak 12 measured a
   * median dL of +0.8 over the scorecard's annulus; 26 measures +30 and change).
   * `prism` is raised for the same reason and by the same measurement.
   *
   * The small flicker is the arc re-rolling its own path every 50 ms, carried
   * into the light so the ground wash crackles with it instead of sitting flat.
   */
  teslaArc:    { color: '#6FA8FF', peak: 26, range: 46.0, riseMs:  50, holdMs:   0, fallMs: 200, flickerHz: 13, flickerAmp: 0.16, mergeRadius: 0 },
  /**
   * `mergeRadius` 9 is wider than the others on purpose: burning wrecks are a
   * CLUSTER by nature — a destroyed formation is six hulls inside ten metres,
   * each re-claiming a light every ~650 ms — and this row is the one that pins
   * the whole pool if it is left alone. One flickering ember wash over the
   * wreckage is also what the reference frames show.
   */
  burning:     { color: '#FF7A28', peak:  4, range: 17.5, riseMs: 200, holdMs:   0, fallMs: 600, flickerHz: 7,  flickerAmp: 0.30, mergeRadius: 9.0 },
  prism:       { color: '#A7F5F9', peak: 22, range: 42.0, riseMs:  60, holdMs:   0, fallMs: 180, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 0 },
  impact:      { color: '#FFE0A0', peak:  6, range: 12.0, riseMs:  10, holdMs:  10, fallMs:  90, flickerHz: 0,  flickerAmp: 0.00, mergeRadius: 4.0 },
} as const;

/**
 * THE GLARE BUDGET — how much ADDITIVE light one patch of ground may emit at
 * once. Consumed by `src/vfx/FlashBudget.ts`; read its header for the
 * measurement and the arithmetic.
 *
 * WHY IT IS HERE AND NOT A DIMMER ON A SPRITE. Explosion and muzzle-flash
 * brightness has been reported four times. Every previous pass lowered a single
 * sprite's gain — `flashIntensity` 7.0 -> 3.5, `billowIntensity` 4.2 -> 2.1, the
 * muzzle core 9.0 -> 4.0 — and every one of those measured correctly, because
 * each was measured on ONE effect. The additive layer SUMS and nothing bounded
 * the sum: measured at 1280x720 on the 48 m combat framing, 20 unit deaths
 * inside a 4 m radius put 65.9% of the frame over L=0.95 against 14.5% for one,
 * and ablation attributes x8.9 of that growth to the additive quads and x3.0 to
 * the point-light pile.
 *
 * The first effect in a locality is charged nothing and therefore attenuated
 * not at all, so a single explosion is unchanged. Only the crowd pays.
 */
export const VFX_GLARE = {
  /**
   * Radius in metres inside which two effects share one budget.
   *
   * 7.0 is a unit-death fireball's own visible radius (the billow shell plus a
   * billow's `billowSize1TL`), which is the distance at which two detonations
   * genuinely overlap on screen rather than merely being near each other. Wider
   * than this and explosions that read as separate events start dimming each
   * other; much narrower and a squad's flashes each get a private budget, which
   * is the bug.
   */
  radiusM: 7.0,
  /**
   * Ceiling on a locality's load, in unit-death-explosion equivalents.
   *
   * This is the answer to "how many simultaneous explosions may a single patch
   * of ground look like". 2.4 reads as one violent event with real depth; the
   * 20th detonation in the same spot therefore emits about a tenth of what the
   * first did instead of a full second copy.
   */
  ceiling: 2.4,
  /**
   * Curve shape. >1 keeps the response flat while the budget is nearly empty —
   * two tanks dying together must not read as one death and one fizzle — and
   * then collapses as the locality fills. At 2.0 the second unit death emits
   * 83% and the fourth 12%.
   */
  exponent: 2.0,
  /**
   * Floor on the multiplier, and therefore the MARGINAL cost of one more
   * detonation once a locality is saturated: 6% of what the first one cost,
   * instead of 100%.
   *
   * It is not zero, so no detonation is ever emitted as literally nothing and no
   * downstream consumer has to cope with a zero gain. It is small, because the
   * total load past the ceiling grows as `ceiling + floor x N` — the one part of
   * this that is linear in N rather than bounded, so it is the number that
   * decides how the extreme tail behaves. At 0.06, twenty co-located deaths
   * emit ~3.3 deaths' worth and a hundred emit ~8, against 20 and 100 before.
   */
  floor: 0.06,
  /**
   * Half-life of a locality's load.
   *
   * 750 ms is `VFX_EXPLOSION.billowLifeMs` exactly, and that is the point: the
   * budget comes back at the rate the fire that spent it actually burns out. A
   * shorter constant lets a sustained firefight re-blow the frame between
   * volleys; a longer one keeps suppressing after the ground has gone dark.
   */
  halfLifeMs: 750,
  /** Below this the locality is retired and its slot recycled. */
  retireLoad: 0.02,
  /**
   * Cost per effect, in unit-death-explosion equivalents. An explosion's cost is
   * additionally multiplied by k^2 (its size relative to a unit death), because
   * the same billow count spread over a k-times-wider fireball covers k^2 the
   * pixels — the same reason `billowIntensityFalloff` exists.
   *
   * The ratios are not guesses, they are the effects' additive gain x quad area,
   * normalised: a heavy muzzle flash's star and core come to roughly a fortieth
   * of a unit-death fireball's total emitted energy, but its energy lands on a
   * few square metres rather than thirty-five, so what matters for blowing a
   * pixel out is its SURFACE brightness — hence 0.50 rather than 0.02. Twenty
   * guns firing into one locality then emit about five flashes' worth of glare
   * instead of twenty, while a squad in sustained fire settles at ~0.6 gain
   * (charge 8/s against a 750 ms half-life) rather than being switched off.
   */
  cost: {
    explosion: 1.00,
    muzzle: 0.50,
    impact: 0.22,
    spark: 0.22,
  },
} as const;

/**
 * Live particle budget. Bible §8.10 asks for ~2500 at a 20-unit battle; these
 * three pools sum to 2720 and are allocated once, at boot, as flat typed
 * arrays. Overflow DROPS the newest emission rather than growing.
 */
export const VFX_MAX_ADDITIVE = 1200;
export const VFX_MAX_LIT = 1300;
export const VFX_MAX_DEBRIS = 220;

/**
 * The lit layer gets the LARGER share, which is counter-intuitive until you
 * count a real battle: additive effects are violent and SHORT (a fireball is
 * gone in 750 ms, a muzzle flash in 90), while smoke and dust are slow and
 * long. Thirty moving vehicles laying two tread puffs every 150 ms at a 2.8 s
 * lifetime is ~1100 live dust sprites on its own — measured in-engine at a
 * 106-entity battle, where the original 700-slot lit pool dropped 16 000
 * emissions in under a minute while the additive pool sat nearly empty.
 */

/**
 * Above this fill fraction the lit pool stops accepting the LOW-VALUE
 * emissions — tread dust and damage wisps — so an explosion's plume can still
 * get slots during a big fight. Without it the cheapest, most frequent effect
 * in the game starves the most important one.
 */
export const VFX_LIT_PRESSURE_CUTOFF = 0.82;

/** Simultaneous tesla bolts, continuous beams and in-flight tracers. */
export const VFX_MAX_BOLTS = 24;
export const VFX_MAX_BEAMS = 24;
export const VFX_MAX_TRACERS = 320;

/**
 * Vertex ceiling of the shared screen-width ribbon buffer (tesla + beams +
 * tracers all draw out of it). A tesla bolt costs ~450 verts, a beam ~24,
 * a tracer 4.
 */
export const VFX_RIBBON_VERTS = 32768;

/** Sprite atlas: 4x4 tiles. 512 gives 128 px tiles, plenty at RTS scale. */
export const VFX_ATLAS_SIZE = 512;
export const VFX_ATLAS_COLS = 4;
/** Colour-ramp LUT: one 128-texel row per ramp. */
export const VFX_RAMP_WIDTH = 128;

/* ---- the ramps (bible §8.2 / §8.3 / §8.4 / §8.5 / §8.6 / §8.7) ---------- */

/** One ramp stop: [position 0..1, sRGB hex, alpha 0..1]. */
export type VfxRampStop = readonly [number, string, number];

/**
 * Row order IS the shader's ramp index — append only, never reorder.
 *
 * The fireball ramp holds `#FFFAFF` all the way to 0.52 because scorecard #14
 * measures the brightest 40% of the fireball at L>245 and the bible states the
 * white core occupies 50–55% of the RADIUS. The remaining stops are the bible's
 * list remapped into 0.52..1.00.
 */
export const VFX_RAMPS: readonly { readonly name: string; readonly stops: readonly VfxRampStop[] }[] = [
  { name: 'fireball', stops: [
    [0.00, '#FFFAFF', 1.00], [0.52, '#FFFAFF', 1.00], [0.68, '#FFFFAF', 1.00],
    [0.75, '#FEF5B0', 0.98], [0.81, '#FDC578', 0.95], [0.87, '#FF9350', 0.88],
    [0.92, '#FE8149', 0.74], [0.96, '#DB6D2E', 0.46], [1.00, '#B5501C', 0.00],
  ] },
  { name: 'flash', stops: [
    [0.00, '#FFFFFF', 1.00], [0.55, '#FFFDF4', 0.92], [0.80, '#FFF3C0', 0.42], [1.00, '#FFC940', 0.00],
  ] },
  { name: 'smokeDark', stops: [
    [0.00, '#1A1A1A', 0.90], [0.30, '#2A2622', 0.80], [0.70, '#3A3632', 0.45], [1.00, '#4A4A4A', 0.00],
  ] },
  { name: 'dust', stops: [
    [0.00, '#C6C6C0', 0.55], [0.35, '#CFCFC9', 0.42], [0.75, '#D8D8D2', 0.16], [1.00, '#D8D8D2', 0.00],
  ] },
  { name: 'ember', stops: [
    [0.00, '#FFF4C8', 1.00], [0.28, '#FFC24A', 1.00], [0.62, '#FF6A18', 0.80], [1.00, '#8C2A0E', 0.00],
  ] },
  { name: 'spark', stops: [
    [0.00, '#FFF8D8', 1.00], [0.45, '#F6E9B0', 0.85], [0.80, '#D8B860', 0.40], [1.00, '#8C6A20', 0.00],
  ] },
  { name: 'tesla', stops: [
    [0.00, '#FFFFFF', 1.00], [0.08, '#E8F0FF', 1.00], [0.18, '#A8C4FF', 0.95],
    [0.32, '#6E8CFF', 0.82], [0.55, '#3F5FE8', 0.55], [0.80, '#1326B3', 0.22], [1.00, '#0A1450', 0.00],
  ] },
  { name: 'prism', stops: [
    [0.00, '#FFFFFF', 1.00], [0.10, '#F1FEF5', 1.00], [0.26, '#A7F5F9', 0.92],
    [0.44, '#A2D2FF', 0.72], [0.62, '#81B3FC', 0.48], [0.82, '#6597DE', 0.22], [1.00, '#547BC0', 0.00],
  ] },
  { name: 'shockwave', stops: [
    [0.00, '#FFE8C0', 1.00], [0.55, '#FFD49A', 0.75], [1.00, '#FFB060', 0.00],
  ] },
  { name: 'vapour', stops: [
    [0.00, '#E4E8EC', 0.85], [0.55, '#D2D7DC', 0.55], [1.00, '#C0C6CC', 0.00],
  ] },
  { name: 'rocketFlame', stops: [
    [0.00, '#FFE9B0', 1.00], [0.22, '#FFAE3A', 1.00], [0.70, '#FF7C10', 0.60], [1.00, '#8C3208', 0.00],
  ] },
  { name: 'rocketSmoke', stops: [
    [0.00, '#6A6560', 0.70], [0.45, '#7A756E', 0.48], [1.00, '#8A857E', 0.00],
  ] },
  { name: 'muzzle', stops: [
    [0.00, '#FFFFFF', 1.00], [0.22, '#FFF3C0', 1.00], [0.58, '#FFC940', 0.85], [1.00, '#E8871E', 0.00],
  ] },
  { name: 'tracerWarm', stops: [
    [0.00, '#FFFFFF', 1.00], [0.16, '#FFD26A', 1.00], [0.55, '#FF9A2E', 0.80], [1.00, '#E8781C', 0.00],
  ] },
  { name: 'tracerCold', stops: [
    [0.00, '#FFFFFF', 1.00], [0.22, '#C8E4FF', 1.00], [0.62, '#6FA8FF', 0.75], [1.00, '#3F6FD8', 0.00],
  ] },
  { name: 'splash', stops: [
    [0.00, '#FFFFFF', 0.95], [0.25, '#E4F0EE', 0.80], [0.70, '#9FC0BC', 0.40], [1.00, '#5E8A86', 0.00],
  ] },
] as const;

/** Ramp row indices — import these, never a literal. */
export const VFX_RAMP = {
  fireball: 0, flash: 1, smokeDark: 2, dust: 3, ember: 4, spark: 5,
  tesla: 6, prism: 7, shockwave: 8, vapour: 9, rocketFlame: 10, rocketSmoke: 11,
  muzzle: 12, tracerWarm: 13, tracerCold: 14, splash: 15,
} as const;

/** Sprite atlas tile indices (row-major in a 4x4 grid). */
export const VFX_TILE = {
  soft: 0, billow: 1, streak: 2, ring: 3,
  star: 4, filigree: 5, core: 6, chunk: 7,
  spark: 8, lobe: 9, bead: 10, shock: 11,
  emberDot: 12, kite: 13, flare: 14, puffAlt: 15,
} as const;

/* ---- explosions (bible §8.2) -------------------------------------------- */

/**
 * ============================================================================
 * THE DETONATION BLOOM BUDGET — read this before raising any number below.
 * ============================================================================
 *
 * "The flashes when something explodes are HUGE, completely block the screen."
 * Reported TWICE. The first pass shrank the flash disc and left every gain
 * untouched, which is why it came back. What follows is the second pass, and
 * the multiplier block that used to shadow this one (`GLOW` at the top of
 * src/vfx/Explosions.ts) is now folded in here — one place for these knobs.
 *
 * WHAT WAS MEASURED. One 2.2 TL unit death, 47.8 m from the camera, captured
 * at 2560x1440 through the `?shot=battle` fixture with the VFX clock frozen and
 * differenced against the identical frame with no explosion in it:
 *
 *                            blown-white core        area of the WHOLE frame
 *                            (equiv. circle, %W)     at sRGB L>245
 *      unit death   @ 90 ms        26.9 %                 10.1 %
 *      structure    @ 60 ms        42.3 %                 25.0 %
 *
 * A quarter of the frame is a featureless white plate for a building, a tenth
 * for a tank. That is not a flash with a halo, and the user is describing it
 * accurately.
 *
 * THE MECHANISM, AND WHY SIZE ALONE NEVER FIXED IT. The bloom pass haloes
 * whatever it is handed above its 0.85 threshold. A 7.0-linear source is ~8x
 * over that threshold, so the above-threshold region is not the sprite's bright
 * middle — it is essentially the sprite's whole visible disc, and 8-14 of them
 * blend ADDITIVELY on top of each other. Shrinking the quads while leaving the
 * gain at 7.0 just makes a slightly smaller solid plate. **The area above the
 * bloom threshold is the quantity that matters, and it is driven by gain at
 * least as much as by size.**
 *
 * SO BOTH LEVERS MOVED, ROUGHLY BY HALF, WHICH IS WHAT WAS ASKED FOR. The
 * numbers below are the bible's authored figures times the correction, baked in
 * rather than multiplied at the call site; each one carries its bible value in
 * the comment so nothing is lost.
 *
 * WHAT MUST NOT BE LOST — SCORECARD #14. "The brightest 40% of a fireball is
 * L>245, channel spread <30." Halving a 7.0-linear source still leaves it ~4x
 * over the tonemapper's clip point, so the white-hot core survives; it was
 * re-measured after the change, not assumed. What shrinks is the AREA above
 * threshold, never the peak. If you ever need to make an explosion read hotter,
 * raise the ramp, not these gains.
 * ============================================================================
 */
export const VFX_EXPLOSION = {
  /** Fireball diameter in metres per "size 1.0". Unit death is 2.2 TL. */
  unitDeathTL: 2.2,
  structureDeathTL: 5.0,
  smallTL: 1.2,

  /* -- the flash disc ---------------------------------------------------- */

  /**
   * Flash disc diameter in TL, start -> end. Peak 40 ms, gone by 140 ms.
   *
   * Bible §8.2 authors 1.8 -> 3.2 TL. 3.2 TL is 22.4 m, which at a normal RTS
   * zoom is over a third of the frame's width — as a flat additive plate that
   * is a bloom source the size of the shot. The first pass took it to 1.9 TL
   * and it was still reported as screen-filling; halving again lands at 0.96 TL
   * (6.7 m), which is a bright point ON the fireball rather than a lid over it.
   * The start size is held near the same ratio so the disc still SNAPS open —
   * the 40 ms onset is the whole character of the effect.
   */
  flashSize0TL: 0.70, flashSize1TL: 0.96, flashLifeMs: 140,
  /**
   * HDR gain of the flash core, in scene-linear.
   *
   * **This is the number the first pass missed.** 7.0 against a 0.85 bloom
   * threshold puts the disc ~8x over it across its entire surface. 3.5 is still
   * ~4x over — the core clips to pure white exactly as before (scorecard #14 is
   * re-measured, not assumed) — but the skirt now falls under threshold within
   * a fraction of the radius instead of feeding the mip chain as a solid disc.
   */
  flashIntensity: 3.5,
  /**
   * How far the flash ramp is stretched across the disc's RADIUS.
   *
   * The disc is emitted with `radial = 1`, so the ramp sweeps across the sprite
   * rather than across its lifetime: a hot centre with a fast falloff instead
   * of a uniform plate. Above 1.0 for the same reason `billowRadialSpan` is —
   * the core tile's alpha is already fading at the quad edge, so a 1.0 span
   * parks the ramp's transparent tail in invisible pixels and the disc reads as
   * a flat white plate again.
   */
  flashRadialSpan: 1.12,

  /**
   * The SEPARATE flash a structure death gets on top of its fireball, in TL.
   *
   * Bible §8.2 asks for 8 TL. That is 56 metres of flat white — wider than the
   * visible ground in the combat fixture. Same halving as the unit flash leaves
   * 2.24 TL (15.7 m), which still reads as "something much bigger just died"
   * next to the unit death's 0.96 TL.
   */
  structureFlashSize0TL: 0.84, structureFlashSize1TL: 2.24,
  /** The structure flash runs a little longer and a little softer than the unit one. */
  structureFlashLifeMul: 1.30, structureFlashIntensityMul: 0.80,

  /**
   * How far the RADIAL fireball ramp is stretched across the sprite quad.
   *
   * `radial = 1` sweeps the ramp from t=0 at the sprite centre to t=`this` at
   * the quad's edge. It must be >1, and the reason is easy to miss: the billow
   * TILE only covers about 86% of its quad and its alpha is already fading by
   * then, so a 1.0 span parks the ramp's saturated `#B5501C` fringe in fully
   * transparent pixels. The fireball then renders as an all-white haze with no
   * orange in it at all — the exact opposite failure to the one scorecard #14
   * guards against, and it looks like fog.
   *
   * 1.18 puts the ramp's `#FFFAFF` -> colour transition (t=0.52) at 45% of the
   * quad, which is ~52% of the VISIBLE billow radius: the bible's "white core
   * occupies 50-55% of the fireball radius", measured where it can be seen.
   */
  billowRadialSpan: 1.18,

  /* -- the fireball ------------------------------------------------------ */

  /** Fireball: 8-14 billows, dead at 750 ms, rotating +/-35 deg/s. */
  billowMin: 8, billowMax: 14,
  /**
   * Diameter of ONE billow in TL, start -> end.
   *
   * Bible §8.2 gives 0.9 -> 2.6 TL, but 2.6 TL is its figure for the WHOLE
   * fireball of a unit death (2.2 TL) with headroom — it was being applied to
   * every one of the 8-14 billows individually. Work the ensemble out: the
   * billows are born on a `billowShellTL` shell and drift ~2 m outward against
   * drag 2.6 over their 750 ms life, so at 1.0 TL each the envelope comes out
   * at about 2.5 TL, which is the bible's fireball plus its sparse outliers.
   * The RADIAL ramp fractions are untouched, so scorecard #14 is unaffected —
   * a billow is the same picture, smaller.
   */
  billowSize0TL: 0.34, billowSize1TL: 1.00, billowLifeMs: 750,
  billowSpinDegPerSec: 35,
  /**
   * HDR gain of one billow, in scene-linear — halved from the authored 4.2.
   *
   * 8-14 of these blend ADDITIVELY, so the gain that matters where they overlap
   * is several times this. At 4.2 the sum in the middle of the fireball was so
   * far over the 0.85 bloom threshold that every billow's ENTIRE disc was above
   * it and the ensemble read as one solid white plate — 10% of the whole frame
   * for a single tank. At 2.1 the core still clips to white (that is what the
   * fireball ramp's `#FFFAFF`-to-t=0.52 hold is for) while the fringes fall
   * back under threshold and the individual billows become visible again.
   */
  billowIntensity: 2.1,
  /**
   * Exponent by which the per-billow gain is walked BACK as the fireball grows.
   * Applied as `gain * k^-this` for `k > 1` only, where `k` is the fireball's
   * size relative to a unit death.
   *
   * This is not a fudge, it is compensation for a real property of additive
   * blending. The same 8-14 billows are spread over a fireball that is `k`
   * times wider, so a view ray through the middle of it crosses roughly the
   * same number of sprites but each one covers `k^2` the pixels — the fireball
   * gets brighter per pixel as it gets bigger, on top of getting bigger. That
   * is why the 5.0 TL structure death stayed a featureless white plate (channel
   * spread 0.0 across its whole disc, measured) at a gain that left the 2.2 TL
   * unit death reading correctly.
   *
   * 0.5 takes the structure death's k=2.27 to a 0.66 multiplier. Small
   * explosions (cook-offs, k<1) are deliberately NOT boosted the other way:
   * they have fewer layers to stack and pushing their gain up would walk
   * straight back into the budget this pass exists to hold.
   */
  billowIntensityFalloff: 0.5,
  /** Outward speed of the billow shell, metres/sec at size 1. */
  billowSpread: 8.5,
  /**
   * Radius in TL of the shell the billows are born on, at size 1.0.
   *
   * ADDITIVE BLENDING IS WHY THIS EXISTS. Twelve billows born within half a
   * metre of each other are twelve sprites stacked on the same pixels: they sum
   * to something the tonemapper returns pure white for, and the fireball
   * renders as a featureless pale haze with no billow structure and no orange
   * anywhere. Measured, twice. Spread them onto a real shell and each one reads
   * as its own white-cored, orange-fringed mass, which is what "8-14 billows"
   * is asking for in the first place.
   *
   * IT IS AN ABSOLUTE LENGTH ON PURPOSE. It used to be a fraction of
   * `billowSize0TL`, which coupled it to the billow's own size — so shrinking
   * the billows collapsed the shell too and re-stacked them at the origin,
   * undoing the fix while looking like a size change. 0.50 TL preserves the
   * 3.5 m shell the fraction produced against the bible's original 0.9 TL.
   */
  billowShellTL: 0.50,

  /* -- shockwave, plume, debris, embers ---------------------------------- */

  /** Shockwave: 0.4 -> 4.5 TL, starts at 30 ms, dead at 420 ms, scaleY 0.12. */
  shockSize0TL: 0.4, shockSize1TL: 4.5, shockDelayMs: 30, shockLifeMs: 420,
  shockFlatten: 0.12,
  /**
   * Shockwave ring gain. Halved with everything else: this is a 4.5 TL (31 m)
   * ring lying flat on the ground, so at 3.0 linear it was a second full-width
   * bloom source arriving 30 ms after the flash.
   */
  shockIntensity: 1.7,

  /** Smoke plume: 14-22 puffs, onset 120 ms, dead at 5.5 s. */
  puffMin: 14, puffMax: 22,
  /**
   * Diameter of ONE puff in TL, start -> end.
   *
   * Same error as the billows, and the reason `05-combat` was a white sheet
   * even after the shading was fixed: `plumeEnvelopeTL` (the bible's figure for
   * the whole column) was being applied to each of 14-22 puffs, giving 28-metre
   * near-opaque smoke balls. The combat fixture frames from 48 m, where the
   * visible ground is about 31 m tall — ONE puff covered the frame and one
   * death emits twenty of them. With the puffs' own spread and rise, 2.0 TL
   * each still builds a plume whose envelope is the authored 4 TL.
   */
  puffSize0TL: 0.27, puffSize1TL: 2.00, puffLifeMs: 5500, puffDelayMs: 120,
  /** Bible §8.7's figure for the WHOLE plume. Documentation and the test's reference. */
  plumeEnvelopeTL: 4.0,
  puffRise: 2.4,
  /**
   * Plume opacity, base -> top, replacing a flat 0.92.
   *
   * Bible §8.7 runs a column from 0.85 at the base to 0.15 at the top and the
   * plume already computes that fraction — it just was not using it. Twenty
   * stacked puffs at an effective 0.83 alpha are a solid wall: the wreck that
   * produced the plume is not visible through its own smoke, which is not what
   * an RA3 frame does.
   */
  puffAlphaBase: 0.72, puffAlphaTop: 0.20,

  /** Debris: 12-20 chunks, 0.05-0.14 TL, 55 deg cone, 5-9 TL/s, g 22 TL/s^2. */
  debrisMin: 12, debrisMax: 20,
  debrisSize0TL: 0.05, debrisSize1TL: 0.14,
  debrisConeDeg: 55, debrisSpeedTL: [5, 9] as const,
  debrisGravityTL: 22, debrisTumbleDegPerSec: 720, debrisLifeMs: 1600,

  /**
   * Embers: 30-60, 0.02-0.04 TL, 1.9 s, additive, flicker 18 Hz.
   *
   * These are pinpricks, so their own area above the bloom threshold is
   * negligible — but sixty of them at 3.4 linear is sixty little bloom seeds
   * scattered through the frame right where the eye is already recovering from
   * the flash. 2.4 keeps them clearly incandescent.
   */
  emberMin: 30, emberMax: 60,
  emberSize0TL: 0.02, emberSize1TL: 0.04, emberLifeMs: 1900,
  emberFlickerHz: 18, emberSpeedTL: [2.5, 6.5] as const, emberIntensity: 2.4,

  /** Scorch decal: 1.6-2.4 TL major axis, 1.7:1 aspect, permanent. */
  scorchMinTL: 1.6, scorchMaxTL: 2.4, scorchAspect: 1.7,

  /**
   * The brief hot flash on a ground/concrete impact — even a dirt hit is a
   * detonation. Diameters in metres at `scale = 1`, gain in scene-linear.
   *
   * These were literals at the call site and they were on the same 7.0-class
   * budget as the death flash, which is wrong by a whole order of importance: a
   * firefight lands dozens of impacts per second and each one was seeding the
   * bloom chain. Halved with everything else.
   */
  impactFlashSize0M: 0.8, impactFlashSize1M: 1.5,
  impactFlashIntensity: 1.7, impactFlashLifeMs: 110,

  /** Structure death: the separate flash above, then 3-6 cook-offs at 250 ms. */
  cookOffMin: 3, cookOffMax: 6, cookOffIntervalMs: 250, cookOffTL: 1.2,

  /** Camera trauma pushed into CameraRig.addShake per TL of fireball. */
  shakePerTL: 0.10,
} as const;

/* ---- tesla (bible §8.3) ------------------------------------------------- */

export const VFX_TESLA = {
  /** Path: 8-14 segments, lateral jitter +/-(0.06 * length), 3 displacement levels. */
  segMin: 8, segMax: 14,
  jitterFrac: 0.06, displaceLevels: 3, roughness: 0.55,

  /** 3-5 overlapping independently jittered copies of the main path. */
  strokeMin: 3, strokeMax: 5,

  /** Branching. Scorecard #30 wants >=4 branches AND >=1 closed loop per bolt. */
  branchMin: 4, branchMax: 8,
  branchChance: 0.35, branchLenFrac: [0.25, 0.50] as const,
  branchRejoinChance: 0.30,
  branchPoints: 4,

  /** Widths in px at 1440p. Core <=3 px at L>=248 is scorecard #30. */
  coreWidthPx: 2.6, sheathWidthPx: 11.0, glowWidthPx: 46.0,
  /** Cross-section falloff exponents: near-flat core, soft glow. */
  coreFalloff: 0.35, sheathFalloff: 1.05, glowFalloff: 2.1,
  /**
   * Where each layer samples the tesla ramp (0 = white core, 1 = #0A1450).
   *
   * The sheath sits at 0.42, not the 0.24 a naive reading of the ramp suggests.
   * #A8C4FF at 0.18 is only 0.40 red in linear, and multiplying it by an HDR
   * gain to make it glow pushes red past 1.0 too — so the "blue sheath" tone
   * maps to WHITE and the whole bolt comes out as a plain white scribble.
   * Measured in-engine and corrected: sampling at 0.42 keeps red near 0.09
   * while blue stays at 0.85, which is what actually reads as the saturated
   * `#1326B3`-class sheath the bible asks for within 8 px of the core.
   */
  coreRampT: 0.02, sheathRampT: 0.42, glowRampT: 0.66,
  /** HDR gain. The core must clip to pure white through the tonemapper. */
  coreIntensity: 5.6, sheathIntensity: 2.4, glowIntensity: 3.0,
  /**
   * How much of its authored SHEATH each extra jittered trunk copy draws.
   * The extra copies deliberately carry NO core: five 2.6 px white filaments
   * scattered over the jitter radius merge into one ~10 px white bar, and
   * scorecard #30 measures "core <=3 px at L>=248". One filament, many sheaths.
   *
   * Bible §8.3 wants 3-5 overlapping paths, but additive blending means five
   * copies of a 5.6-gain core sum to 28 and the entire bolt clips to a fat
   * white bar. The extra copies exist to vary the silhouette, not to multiply
   * the brightness, so they draw dim and only the primary path is authored at
   * full strength.
   */
  copyDim: 0.42,

  /** Re-roll the whole path every 50 ms; total beam 0.9-1.4 s. */
  rerollMs: 50, defaultDurationMs: 1100,

  /** Impact starburst: r 35-45 px ball for 180 ms + 14-20 radial spikes. */
  burstRadiusPx: [35, 45] as const, burstLifeMs: 180, burstIntensity: 5.5,
  spikeMin: 14, spikeMax: 20,
  spikeWidthPx: [2, 4] as const, spikeLenPx: [60, 140] as const,
  spikeLifeMs: 220, spikeLongCount: 4, spikeLongMul: 2.0,
} as const;

/* ---- beams (bible §8.4) ------------------------------------------------- */

export const VFX_BEAM = {
  prism: {
    corePx: 3.5, innerPx: 33, outerPx: 64,
    coreT: 0.01, innerT: 0.26, outerT: 0.62,
    coreI: 6.0, innerI: 2.4, outerI: 0.85,
    coreFall: 0.30, innerFall: 1.2, outerFall: 2.3,
    openMs: 60, closeMs: 180, defaultMs: 1500,
    /** Width breathing +/-8% at 11 Hz, taper 100% -> 88% along the beam. */
    breatheAmp: 0.08, breatheHz: 11, taper: 0.88,
    ramp: 7,
  },
  cryo: {
    corePx: 6.0, innerPx: 14, outerPx: 28,
    coreT: 0.03, innerT: 0.30, outerT: 0.70,
    coreI: 4.5, innerI: 2.0, outerI: 0.8,
    coreFall: 0.35, innerFall: 1.3, outerFall: 2.4,
    openMs: 90, closeMs: 220, defaultMs: 1500,
    breatheAmp: 0.0, breatheHz: 0, taper: 1.0,
    ramp: 7,
  },
  designator: {
    corePx: 3.0, innerPx: 10, outerPx: 22,
    coreT: 0.00, innerT: 0.20, outerT: 0.55,
    coreI: 3.6, innerI: 1.6, outerI: 0.7,
    coreFall: 0.30, innerFall: 1.2, outerFall: 2.2,
    openMs: 80, closeMs: 200, defaultMs: 2000,
    breatheAmp: 0.05, breatheHz: 6, taper: 1.0,
    ramp: 7,
  },
} as const;

/* ---- guns (bible §8.5) -------------------------------------------------- */

/**
 * Muzzle-flash sizes in METRES, not the bible's px. Scorecard #29 asks for
 * ">= 4x barrel diameter"; a 0.30 m MBT barrel therefore needs >= 1.2 m and the
 * measured RA3 frames put a heavy flash at roughly 40-50% of a 7 m hull, which
 * is where these land. Deliberately huge — "do not shrink the muzzle flashes".
 */
export const VFX_GUNS = {
  /**
   * Muzzle flashes, small / medium / heavy.
   *
   * The SIZES are the bible's and are staying: scorecard #29 measures a heavy
   * flash at >= 4x a 0.30 m barrel and these shapes are the silhouette of the
   * effect. The GAINS came down with the explosion budget (5.0/5.6/6.4 ->
   * 2.8/3.1/3.6). A firefight fires several of these per second per unit, and
   * against a 0.85 bloom threshold a 6.4-linear source haloes across its whole
   * quad — twenty guns firing was a second, continuous screen-wide bloom feed
   * underneath the explosions this pass was called in to fix.
   */
  flash: [
    { lenM: 1.20, widM: 0.62, lifeMs:  70, intensity: 2.8, tile: 4 },  // small: 4-point star
    { lenM: 2.00, widM: 1.40, lifeMs:  90, intensity: 3.1, tile: 13 }, // medium: kite
    { lenM: 3.00, widM: 1.75, lifeMs: 110, intensity: 3.6, tile: 4 },  // heavy: big star
  ] as const,
  /** Scale curve: 0 -> 1.0 at 15 ms -> 0.85 -> 0. */
  flashPeakMs: 15, flashSustain: 0.85,
  /**
   * White-hot core disc riding inside the flash, as a fraction of its length.
   *
   * 9.0 was the single hottest emissive in the game — hotter than the death
   * flash it sits next to — for a 1 m disc that fires many times a second. 4.0
   * still clips to white through the tonemapper; it just stops dragging a halo
   * the size of the turret with it. It is the top of the budget the
   * `detonation bloom budget` suite enforces, which is where it belongs: this
   * is the hottest thing a normal frame contains.
   */
  flashCoreFrac: 0.38, flashCoreIntensity: 4.0,
  /** Barrel smoke ribbon: #8A8078 at alpha 0.25 for the first 30% of flight. */
  barrelSmokeAlpha: 0.25,

  /**
   * MG tracer: tapered lozenge 25-65 px x 2.5-4 px, ratio ~14:1.
   *
   * Gain cut with the rest of the budget (4.0 -> 2.6). A tracer is thin, so its
   * own bloom footprint is small — but there are up to 320 of them live at once
   * and their halos merge into a haze over the engagement.
   */
  tracerLenPx: [25, 65] as const, tracerWidthPx: [2.5, 4.0] as const,
  tracerHeadWidthMul: 1.35, tracerIntensity: 2.6,
  /** Cannon tracer: 95-130 px x 7-9 px head, tapering over the last 40%. */
  cannonLenPx: [95, 130] as const, cannonWidthPx: [7, 9] as const,
  cannonIntensity: 3.0,
  /** Travel speed in metres/sec (bible: ~14 TL/s for the main gun). */
  tracerSpeed: 190, cannonSpeed: 98,
  /** Only ~1 in 3 MG rounds is visible. */
  tracerVisibleFrac: 0.34,

  /** Armour impact: 30-45 straight streaks, 140 deg upward-biased fan. */
  sparkMin: 30, sparkMax: 45,
  sparkLenPx: [60, 180] as const, sparkWidthPx: 2,
  sparkFanDeg: 140, sparkLifeMs: 420, sparkSpeed: [9, 26] as const,
  sparkGravity: 14, sparkIntensity: 2.4,
  /**
   * Plus a small white flash disc for 60 ms — the bible's 20 px, at the gain
   * class the rest of this pass settled on (6.0 -> 3.0). It is emitted RADIAL
   * for the same reason the death flash is: a flat high-gain disc, however
   * small, is a disc-shaped bloom source rather than a point one.
   */
  sparkFlashPx: 20, sparkFlashMs: 60, sparkFlashIntensity: 3.0,
} as const;

/* ---- trails (bible §8.6) ------------------------------------------------ */

/**
 * BEAD CHAINS, never ribbons. Scorecard #31 scans a trail and demands >= 6
 * luminance oscillations of >= 25 L, which only discrete puffs produce.
 * Spacings are in METRES (the bible's "every 14-20 px of travel" at the
 * measured 0.036 m/px of a default-zoom 1440p frame).
 */
export const VFX_TRAIL = {
  coldSpacingM: 0.62, coldSize0: 0.20, coldSize1: 0.52, coldLifeMs: 2600, coldAlpha: 0.85,
  hotSpacingM: 0.52,
  hotFlameSize0: 0.36, hotFlameSize1: 0.95, hotFlameLifeMs: 380, hotFlameIntensity: 3.2,
  hotSmokeSize0: 0.50, hotSmokeSize1: 1.75, hotSmokeLifeMs: 3200, hotSmokeAlpha: 0.62,
  /** Cap on beads laid by one call, so a teleporting projectile cannot spam. */
  maxBeadsPerCall: 12,
} as const;

/* ---- smoke and damage states (bible §8.7 / §8.8) ------------------------ */

export const VFX_SMOKE = {
  /** Bible §8.7 shading pair. Lit smoke = mix(dark, lit, dot(N,L)*0.5+0.5). */
  shadeDark: '#14120F', shadeLit: '#8A857E', rimLit: '#B8B2A6',
  tintGain: 0.62, shadeGain: 0.82, rimGain: 0.30,

  /** A column is 8-14 discrete lobes rising 1.9-2.7 TL, widening >= 3x. */
  lobeMin: 8, lobeMax: 14,
  columnRiseTL: [1.9, 2.7] as const,
  /** Base radius -> top radius. The >= 3x widening is an acceptance test. */
  baseRadiusM: 0.75, topRadiusM: 2.65,
  opacityBase: 0.85, opacityTop: 0.15,
  lobeLifeMs: 4200,

  /** Damage states. Health fraction -> puff interval in ms. */
  wispThreshold: 0.65, wispIntervalMs: 600, wispAlpha: 0.35, wispRiseTL: 0.9,
  burnThreshold: 0.32, burnIntervalMs: 220,
  /** 2-4 flame tongues on the hull, 0.21-0.37 TL tall, flicker 12 Hz. */
  tongueMin: 2, tongueMax: 4, tongueTL: [0.21, 0.37] as const, tongueFlickerHz: 12,
  /** Entities re-scanned per frame for damage FX (round-robin slice). */
  damageScanSlice: 6,
} as const;

/* ---- ground FX (bible §8.10) -------------------------------------------- */

export const VFX_GROUND = {
  dustColor: '#C6C6C0', dustDry: '#B8A484', dustSnow: '#E8ECF0',
  dustAlpha: [0.40, 0.55] as const,
  dustSize0: 0.36, dustSize1: 1.15, dustLifeMs: 2800,
  /** One puff per track every 0.15 s while moving. */
  treadIntervalMs: 150,
  /** On paving: alpha 0.18 and 60% radius. */
  pavingAlphaMul: 0.42, pavingRadiusMul: 0.60,
} as const;

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
/** Pixels per metre at 2560x1440, default zoom. Converts px specs to metres. */
export const PIXELS_PER_METRE_1440 = 207 / 7;

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
   * RA3 frames, so they are close to FINAL pixel values, and pushing them back
   * through exposure + AgX would otherwise land them well under the scorecard
   * #25 floor. Solved by sweeping `probeOpenWaterLuminance` across all five
   * palettes: at 1.40 the darkest (night) reads 48 and the brightest
   * (temperate) 88, so every palette clears 45-115 with margin while the water
   * stays firmly on the DARK side of the band. Raise this only against a fresh
   * probe reading — never to make the water "pop", which is bible R5.
   */
  outputGain: 1.40,
  /** How much the sun's diffuse term modulates the body colour. Water is not chalk. */
  sunDiffuse: 0.30,
  /** How much the hemisphere fill modulates it. */
  fillDiffuse: 0.55,
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
  chopStrength: 0.62,

  /** Band C micro-detail: 2-4 px, normal only, 0.9 TL/s. */
  microTileMetres: 1.05,
  microSpeed: 0.9 * TANK_LENGTH_METRES,
  microStrength: 0.34,

  /** The three sampling rotations (bible: 0/47/113 degrees). */
  rotationDeg: [0, 47, 113] as [number, number, number],

  /**
   * 0 = glass calm, 1 = choppy. Drives the crinkle amplitude AND the foam
   * threshold. Measured at ~7% open-water foam coverage in a real 1280x720
   * render, inside scorecard #26's calm band with room for wakes and the
   * shoreline band on top. RA3's open water is calmer than memory suggests —
   * the foam you remember is mostly wake and coastline, not sea state.
   */
  seaState: 0.28,
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
  laceTileMetres: 12.0,
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
  thresholdLo: 0.7135,
  thresholdHi: 0.8035,
  crestGain: 0.324,
  /** Threshold drop at seaState 1 — this is what takes 4-8% calm to 12-16% choppy. */
  choppyBias: 0.06,
  /** Metres/second the lace drifts across the swell. */
  scrollSpeed: 0.22,
  /** Target coverage bands from scorecard #26, for the boot-time probe. */
  coverageCalm: [0.04, 0.08] as [number, number],
  coverageChoppy: [0.12, 0.16] as [number, number],
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

/* ==========================================================================
 * 20. ROADS, KERBS AND GROUND DECALS      (appended by src/world/Roads.ts,
 *                                          src/world/Decals.ts)
 *
 * Bible §6.3 is unusually specific about roads because roads are the single
 * most recognisable "this is Red Alert 3" ground read after the grass hue.
 * Every number below is quoted from it; where I had to choose, the comment
 * says why. Metres and radians throughout, 1 unit = 1 metre.
 * ========================================================================== */

/** Lane width. Bible §6.3: 3.2-3.5 m. 2-lane = 6.8, 4-lane = 13.6. */
export const ROAD_LANE_WIDTH = 3.4;
/** Lanes on an arterial. 4 x 3.4 = 13.6 m carriageway. */
export const ROAD_ARTERIAL_LANES = 4;
/** Lanes on a side street. 2 x 3.4 = 6.8 m carriageway. */
export const ROAD_STREET_LANES = 2;

/**
 * Kerb vertical face height. Bible §6.2: 0.15-0.20 m, and it is REAL GEOMETRY
 * that casts a real shadow — scorecard #33 fails a painted stripe explicitly.
 */
export const ROAD_KERB_HEIGHT = 0.17;
/** Kerb top face width. Bible §6.2: 0.28 m. */
export const ROAD_KERB_TOP = 0.28;
/** Pavement (sidewalk) width outboard of the kerb top. */
export const ROAD_PAVEMENT_WIDTH = 3.2;
/** Metres of pavement outer edge that skirts down to meet the ground. */
export const ROAD_PAVEMENT_SKIRT = 0.45;

/**
 * Junction corner radius band. Scorecard #32 states 4-8 m and it is checked
 * from a screenshot, so the generator measures every arc it emits and warns
 * if one lands outside.
 */
export const ROAD_CORNER_RADIUS_MIN = 4.0;
export const ROAD_CORNER_RADIUS_MAX = 8.0;
/**
 * Radius band for a BEND in the open run of a road (as opposed to a junction
 * corner). Bible §6.3: "every road is a spline with 15-40 m radius bends".
 */
export const ROAD_BEND_RADIUS_MIN = 15;
export const ROAD_BEND_RADIUS_MAX = 40;
/**
 * Minimum degrees a road leg must sit off the world X and Z axes. Scorecard
 * #32's first clause is "no axis-aligned straight road" and a procedural grid
 * defaults to violating it in the most obvious possible way.
 */
export const ROAD_MIN_AXIS_DEGREES = 8;

/** Arc length between ribbon cross-sections. Drives tri count and smoothness. */
export const ROAD_SAMPLE_METRES = 2.0;
/**
 * Metres the road surface floats above the heightfield. The terrain grid is
 * 1 m and roads only run on ground under ROAD_MAX_SLOPE, so 6 cm clears the
 * worst interpolation error with room to spare while staying invisible at a
 * 39-degree camera.
 */
export const ROAD_SURFACE_LIFT = 0.06;

/** Nodes per axis in the generator lattice. 4 => ~102 m blocks on a 512 m map. */
export const ROAD_LATTICE_N = 4;
/** Lattice jitter as a fraction of spacing. This is what kills the grid read. */
export const ROAD_LATTICE_JITTER = 0.30;
/** Probability a legal non-arterial lattice edge survives into the network. */
export const ROAD_STREET_KEEP = 0.84;
/** Steepest rise/run a road will follow. Above this the route is rejected. */
export const ROAD_MAX_SLOPE = 0.14;
/** Fraction of an edge's samples that may be illegal before it is rejected. */
export const ROAD_EDGE_TOLERANCE = 0.06;

/** Metres per road-mask texel. 2 m matches the terrain splat resolution. */
export const ROAD_MASK_METRES = 2;
/**
 * Movement cost written into `Terrain.costGrid` for a carriageway cell.
 * COST_UNIT is 100, so 72 is a 1.39x speed-up along roads — enough that the
 * flow field prefers them without making off-road travel feel broken.
 */
export const ROAD_MOVE_COST = 72;

/** Zebra crossing: metres from the junction mouth where the bars start. */
export const ROAD_CROSSWALK_START = 3.2;
/** Zebra crossing depth along the road. Bible: bars 0.45-0.60 wide + same gap. */
export const ROAD_CROSSWALK_DEPTH = 4.6;
/** Zebra bar period across the road (bar + gap). */
export const ROAD_CROSSWALK_PERIOD = 1.10;
/** Stop bar width. Bible §6.3: 0.3 m, 1.5 m before the crossing. */
export const ROAD_STOPBAR_WIDTH = 0.30;
export const ROAD_STOPBAR_GAP = 1.5;
/** Metres of kerb top carrying yellow dashes either side of a crossing. */
export const ROAD_KERB_YELLOW_RUN = 7.0;
/** Metres of tangent leg either side of a corner arc that also gets red paint. */
export const ROAD_KERB_RED_RUN = 2.5;

/** Manhole decals: bible §6.3 wants roughly one per 25 m of road. */
export const ROAD_MANHOLE_INTERVAL = 26;
/** Oil-stain decals dropped near junctions, per junction. */
export const ROAD_OIL_PER_JUNCTION = 2;

/**
 * RA3's road palette, authored from bible §6.1/§6.3 — NOT sampled off a
 * screenshot, because a sampled value already carries the sun and the ACES
 * shoulder and feeding it back through our own lighting double-counts.
 * White road paint is #D8D2C8 and never #FFFFFF (§6.1, last line).
 */
export const ROAD_COLORS = {
  asphalt:        '#46464A',
  asphaltShade:   '#33333A',
  asphaltAggr:    '#5A5A60',
  /** Wheel path, +18% L per bible §6.1. */
  wheelPath:      '#57575C',
  centreLine:     '#C9A227',
  laneLine:       '#D8D2C8',
  edgeLine:       '#D8D2C8',
  crosswalk:      '#D8D2C8',
  kerb:           '#C0BAB0',
  kerbShade:      '#8E8880',
  kerbRed:        '#B8382C',
  kerbYellow:     '#E0B12A',
  pavement:       '#9A968C',
  pavementShade:  '#7C786F',
  pavementJoint:  '#6B6058',
} as const;

/** Roughness per road part. Bible §6.1: asphalt 0.75, concrete/sidewalk 0.70. */
export const ROAD_ROUGHNESS = { asphalt: 0.75, kerb: 0.65, pavement: 0.70 } as const;

/**
 * Metres per repeat of the generated asphalt / concrete detail textures.
 *
 * These are SMALL on purpose. Bible §6.1 oversizes ground features 2-3x, but
 * "oversized" means a 0.8 m cobble, not a 2 m one — the first pass ran a 6 m
 * repeat of a generator whose base mottling has a ~1/3-texture period, which
 * put 2 m blobs on the carriageway and read as bubble wrap rather than tarmac.
 * Asphalt aggregate is 0.02 m and the patches that sit over it are painted by
 * the decal layer, not by the tiling texture.
 */
export const ROAD_TEXTURE_METRES = { asphalt: 3.0, kerb: 1.6, pavement: 3.2 } as const;
/** Generator feature density per repeat. Higher = smaller features. */
export const ROAD_TEXTURE_SCALE = { asphalt: 13, kerb: 10, pavement: 9 } as const;
/**
 * Normal-map strength. Tarmac is FLAT — the relief here is aggregate at a
 * couple of millimetres, and anything stronger turns a 39-degree camera's
 * grazing highlights into a boiling mess.
 */
export const ROAD_NORMAL_SCALE = 0.32;
/** Edge length of those generated textures. */
export const ROAD_TEXTURE_SIZE = 256;

/** Sidewalk slab size, bible §6.1: 1.2 x 1.2 m with a 0.03 m joint. */
export const ROAD_SLAB_METRES = 1.2;
export const ROAD_SLAB_JOINT = 0.03;

/* ---------------------------------------------------------------- decals -- */

/**
 * Fixed decal pool. Every decal is a slot in ONE shared BufferGeometry, so
 * this is also the whole decal draw budget: 1 draw call, always.
 * 512 x 18 triangles = 9.2k tris, which is 3% of what the terrain spends.
 */
export const DECAL_POOL = 512;
/**
 * Quads per side of a decal patch. 3 => 4x4 vertices => 18 triangles. The
 * heightfield is 1 m and decals are 1.5-6 m, so 3 subdivisions conforms a
 * decal to the ground to well under a centimetre.
 */
export const DECAL_GRID = 3;
/** Metres a decal floats above the heightfield. Under the road lift, on purpose. */
export const DECAL_LIFT = 0.035;
/** Edge length of the procedural decal atlas (4x4 tiles). */
export const DECAL_ATLAS_SIZE = 512;
/** Slots swept per frame looking for expired decals to collapse. */
export const DECAL_SWEEP_PER_FRAME = 24;

/** Tread marks. Bible §8.10: two strips at track gauge, ground x0.72, fade 35 s. */
export const TREAD_LIFE_SECONDS = 35;
export const TREAD_DARKEN = 0.72;
/** Metres of travel between successive tread stamps. */
export const TREAD_INTERVAL_METRES = 2.2;
/** Track gauge as a fraction of the unit's collision radius. */
export const TREAD_GAUGE_FRACTION = 1.15;
/** Half-length of one tread stamp along the direction of travel. */
export const TREAD_HALF_LENGTH = 1.6;
/** Half-width of one tread strip. Bible: 6-8 px at 1440p ~= 0.35 m. */
export const TREAD_HALF_WIDTH = 0.42;
/** Wheeled units lay a fainter, narrower mark. */
export const TYRE_DARKEN = 0.86;
export const TYRE_HALF_WIDTH = 0.24;
/** On paving, bible §8.10 drops tread alpha to ~0.4 of the dirt value. */
export const TREAD_PAVING_FALLOFF = 0.45;

/**
 * FLOOR on how dark ONE ground decal may make the ground.
 *
 * The decal field is multiply-blended, so overlapping marks compound: five
 * tread stamps from a column running the same lane used to composite as
 * 0.72^5 = 0.19 and four scorches as 0.34^4 = 0.013. Clamping each decal's
 * emitted factor here bounds a single mark and, because the clamp is well
 * above the raw SCORCH_DARKEN of 0.34, it also lifts the exponent base for the
 * overlapping case: 0.45^4 is 0.041 rather than 0.013.
 *
 * Burnt ground in RA3 is dark BROWN, not a hole in the map.
 */
export const DECAL_DARKEN_FLOOR = 0.45;

/** Scorch. Bible §8.10: 1.6-2.4 TL major axis, 1.7:1 aspect, PERMANENT. */
export const SCORCH_HALF_SIZE = 7.0;
export const SCORCH_DARKEN = 0.34;
/** Craters read as a dark bowl with a brighter ejecta ring. */
export const CRATER_HALF_SIZE = 3.2;
export const CRATER_DARKEN = 0.42;
/** Oil stains: 2-5 m ellipses at alpha 0.35 near depots (bible §6.3). */
export const OIL_HALF_SIZE = 1.9;
export const OIL_DARKEN = 0.55;
/** Manhole covers, 0.7 m across. */
export const MANHOLE_HALF_SIZE = 0.42;
/**
 * Street-lamp light pool: bible §6.3 wants a 6-8 m ellipse at alpha 0.25 even
 * in daylight. It is the one decal that BRIGHTENS, which the multiply pipeline
 * expresses as a tint above 1.0 (valid because the main pass is HDR).
 */
export const LIGHT_POOL_HALF_SIZE = 3.6;

/* ==========================================================================
 * 20. PATHFINDING, STEERING AND MOVEMENT   (owned by src/sim/**)
 *
 * The flow-field budget, the cost model, the boids weights and the six chassis
 * turn models. These are FEEL numbers: a critic who says "the tanks look like
 * they are on ice" or "the column shoves itself apart" is reading exactly this
 * block, and every one of them is safe to retune in isolation.
 *
 * The cost arrays are indexed by `MoveClass` (src/sim/Flowfield.ts):
 *   0 foot, 1 track, 2 wheel, 3 hover, 4 naval, 5 air.
 * ========================================================================== */

/**
 * Road-cell cost multiplier per move class. Below 1.0 makes a road ATTRACTIVE
 * to the flow field, which is the whole reason to have roads in an RTS: it is
 * what makes convoys spontaneously form up on them instead of cutting across
 * the grass. Wheels care most, infantry barely at all, hovercraft and ships
 * not at all.
 */
export const NAV_COST_ROAD = [0.88, 0.78, 0.58, 1.0, 1.0, 1.0] as const;

/**
 * Rough-ground cost multiplier per move class, applied wherever terrain
 * already classified a cell as rough (slope past ROUGH_SLOPE). Tracks shrug it
 * off; wheels are punished hard, which is what separates an IFV from a Grizzly
 * on a hillside.
 */
export const NAV_COST_ROUGH = [1.25, 1.45, 2.05, 1.0, 1.0, 1.0] as const;

/** Carved connectivity ramps are slightly cheap so units prefer them to a scramble. */
export const NAV_COST_RAMP = 0.92;

/**
 * Multiplier applied to any cell orthogonally adjacent to an impassable one.
 * Pure shortest paths glue themselves to obstacle corners; one cheap dilation
 * pass buys about a metre of clearance and stops a column scraping the side of
 * a Construction Yard. 1.0 disables the pass entirely.
 */
export const NAV_COST_WALL_HUG = 1.35;

/**
 * MINIMUM CORRIDOR WIDTH, IN CELLS, THAT A CLASS IS ALLOWED TO BE ROUTED DOWN.
 *
 * The cost field carves out building footprints and nothing else, so two
 * structures a single cell apart leave what the planner reads as a perfectly
 * legal corridor. One cell is 4 m. The widest ground hull in the game is the
 * harvester at `hullRadius(8.6 x 4.0)` = 3.87 m of RADIUS — 7.74 m across, very
 * nearly two cells — so that corridor is a slot the vehicle does not fit
 * through, entered at speed, with a separation force pushing off each wall.
 * Real RTS nav grids bake a clearance margin into the footprint for exactly
 * this reason; this is that margin, expressed as the narrowest free span a cell
 * may sit in and still be routable.
 *
 * 2 for everything with a vehicle-sized hull (Track, Wheel, and Hover — the
 * Meridian's entire army is Hover and its collector is harvester-sized). 1 for
 * Foot, because infantry are ~1 m across and threading a doorway is something
 * they SHOULD do; 1 for Naval, because the narrow thing on water is a strait
 * and closing straits changes maps; 1 for Air, which ignores the grid.
 *
 * Indexed by `MoveClass`. A value of 1 disables the rule for that class.
 *
 * Blocking narrow cells can never disconnect the map: `Flowfield.rebuildCost`
 * restores any narrow run that is the only join between two otherwise separate
 * regions. See its §clearance for the proof.
 */
export const NAV_MIN_CORRIDOR_CELLS = [1, 2, 2, 2, 1, 1] as const;

/** Concurrent in-flight field expansions. Each carries ~80 KB of working state. */
export const NAV_FIELD_EXPANDERS = 4;
/** Smallest per-expander share of the tick budget, so nobody starves. */
export const NAV_MIN_EXPANDER_BUDGET = 256;
/** Ring radius, in cells, for "nearest cell I can actually stand on". */
export const NAV_SNAP_SEARCH_CELLS = 14;

/** Metres of slack beyond a unit's own radius that counts as "arrived". */
export const NAV_ARRIVE_SLACK = 1.1;
/** Metres out from the goal where a unit begins braking. */
export const NAV_SLOWDOWN_RADIUS = 7.0;
/** Floor on the arrival ramp, as a fraction of max speed. Zero would stall. */
export const NAV_MIN_APPROACH_SPEED = 0.22;

/**
 * Metres within which a unit tests for a clear straight line and, if it finds
 * one, abandons the flow field. This is string-pulling, and it is what removes
 * the last of the 8-way grid stair-stepping on open ground.
 */
export const NAV_DIRECT_RANGE = 26;
/** Ticks between direct-path probes for one unit (round-robin sliced). */
export const NAV_DIRECT_RECHECK_TICKS = 6;
/** Ticks between "is my field still alive" checks for one unit. */
export const NAV_REPATH_TICKS = 30;

/** Consecutive near-stationary ticks under a move order before we intervene. */
export const NAV_STUCK_TICKS = 24;
/** Below this fraction of max speed a unit counts as not moving. */
export const NAV_STUCK_SPEED_FRAC = 0.16;
/** Stuck this close to the goal: call it arrived rather than grind. */
export const NAV_STUCK_GIVEUP_RADIUS = 5.5;
/** Sideways shoves before a stuck unit simply gives up and parks. */
export const NAV_STUCK_MAX_NUDGES = 3;

/* -- the wedge watchdog ---------------------------------------------------
 *
 * `NAV_STUCK_*` above watches the SPEEDOMETER and the progress watchdog in
 * Steering.ts watches DISTANCE TO GOAL. Neither of them answers the question a
 * player actually asks — "has this thing physically moved at all in the last
 * ten seconds?" — and that is the failure that gets reported, because it is the
 * only one that is visible from the top of the map.
 *
 * So this ladder measures RAW DISPLACEMENT and nothing else, and it applies to
 * every mover, not just harvesters. It is a safety net: if it fires often, the
 * clearance rule above is not doing its job and THAT is the bug to fix.
 * ------------------------------------------------------------------------- */

/** Ticks between displacement samples for one unit. 60 = 2 s at 30 Hz. */
export const NAV_WEDGE_SAMPLE_TICKS = 60;
/** Metres of travel inside one sample window that still counts as moving. */
export const NAV_WEDGE_METRES = 1.0;
/** Consecutive barren windows before the ladder steps. 3 = 6 s of no movement. */
export const NAV_WEDGE_STRIKES = 3;
/** Rungs spent nudging before the unit is displaced outright. */
export const NAV_WEDGE_MAX_NUDGES = 2;
/**
 * Ring radius, in cells, for the last-resort displacement. 6 cells is 24 m —
 * far enough to clear any single structure's footprint plus its neighbour,
 * short enough that the unit visibly shuffles rather than teleporting.
 */
export const NAV_WEDGE_SEARCH_CELLS = 6;

/** Formation slot spacing, as a multiple of the group's mean unit radius. */
export const NAV_FORMATION_SPACING = 2.6;
/** Hard cap on a formation slot offset, metres. */
export const NAV_FORMATION_MAX_OFFSET = 30;
/** Two order points closer than this (metres) count as the same group order. */
export const NAV_FORMATION_GOAL_EPS = 0.6;

/* -- what happened to NAV_FORMATION_ENGAGE_RADIUS -------------------------
 *
 * There used to be a fourth number here: "metres from the goal at which a unit
 * leaves the shared field and drives to its own slot", 22 m. It was deleted on
 * 2026-08-06 because it never described anything.
 *
 * `SteeringSolver` gated its target point on it. `NavAssigner` — the arrival
 * test, the give-up test, the progress watchdog, the direct-path probe — did
 * not, and applied the slot unconditionally. So the two halves of nav disagreed
 * about where each unit was going, permanently, by up to the slot offset. Worse,
 * NAV_FORMATION_MAX_OFFSET is 30 and the radius was 22, so a legal formation
 * slot could be FARTHER from the goal than the radius that switched it on: the
 * unit closed to 21 m, retargeted 30 m sideways, retreated past 22 m, retargeted
 * back, and hunted across the boundary until the give-up ladder parked it. That
 * was measured, not reasoned: a 28 m slot left a lone vehicle oscillating
 * between 15 m and 24 m of its order point and then parked 23.5 m short of it.
 *
 * The radius bought nothing even when it worked. Outside it, with a live flow
 * field, the target point feeds only the arrival ramp (7 m) and the near-goal
 * bearing fold-in (8 m) — both of which are inside any plausible radius — while
 * the DIRECTION comes from `nav.sample()`, which never looked at the slot at
 * all. One field per group is a property of how the field is requested (from
 * `goalX/goalZ`, never the slot), not of this gate. The gate's only real effect
 * was the disagreement it created.
 *
 * The target point is now `agentTarget()` in sim/Steering.ts, unconditional, and
 * both phases call it. There is nothing left to tune.
 * ------------------------------------------------------------------------- */

/** Weight of the flow-field term in the steering blend. The baseline is 1.0. */
export const STEER_FLOW_WEIGHT = 1.0;
/** Weight of the summed separation push. */
export const STEER_SEPARATION_WEIGHT = 1.15;
/** Neighbour search radius, as a multiple of the steering unit's own radius. */
export const STEER_SEPARATION_RANGE_MUL = 2.4;
/** Extra push away from a neighbour that is stopped — go around, do not shove. */
export const STEER_STATIC_PUSH_MUL = 1.8;

/** Weight of the obstacle-avoidance sidestep. */
export const STEER_AVOID_WEIGHT = 1.4;
/** Metres ahead of the hull the avoidance probe looks. */
export const STEER_AVOID_LOOKAHEAD = 3.2;
/** Metres out to each side the flank probes sit. */
export const STEER_AVOID_SIDE = 2.4;

/**
 * cos of the half-angle of the "directly ahead of me" cone used by the queue
 * brake. cos(38 degrees). Wider and units brake for traffic beside them.
 */
export const STEER_QUEUE_COS = 0.788;
/** Queue-brake trigger distance, as a multiple of the summed radii. */
export const STEER_QUEUE_RANGE_MUL = 2.2;
/** How hard the gap to the unit ahead converts into speed. m/s per metre. */
export const STEER_QUEUE_BRAKE = 1.6;

/* -- the head-on deadlock, and the two numbers that end it -----------------
 *
 * THE BUG, MEASURED. Order two vehicles past each other on open ground and
 * they meet nose to nose, decay to a dead stop over about four seconds, and
 * never move again. Reproduced in `tests/clash.spec.ts` at 12 seeds out of 12
 * before the fix; the trace is an exponential speed decay with the gap pinned
 * at exactly `radius(a) + radius(b)`.
 *
 * TWO FAULTS COMPOUND, AND NEITHER IS SUFFICIENT ON ITS OWN:
 *
 *   1. THE QUEUE BRAKE HAD NO FLOOR. It sets my desired speed to the speed of
 *      whoever is in front of me, plus `(gap - contact) * STEER_QUEUE_BRAKE`.
 *      Relaxation holds the gap a hair BELOW contact, so that term is
 *      negative, and for two units facing each other the recurrence is
 *      `v <- v' - eps` on both sides at once. That is a contraction with the
 *      fixed point 0. Both stop. Forever.
 *
 *   2. NOTHING PRODUCED A LATERAL COMPONENT. Head-on, the separation push is
 *      exactly anti-parallel to the travel direction, so the blend stays on
 *      one axis and neither unit ever tries to go AROUND. Obstacle avoidance
 *      cannot help — it probes the terrain grid, and another unit is not in it.
 *
 * Fixing only the floor gives two units grinding at a crawl forever; fixing
 * only the sidestep gives two units sidestepping at zero speed, which is the
 * same picture. Both, together, make them pass.
 * ------------------------------------------------------------------------- */

/**
 * Floor on what the queue brake may ask for, as a fraction of max speed.
 *
 * A brake that can command zero is a brake that can deadlock: a stopped unit
 * has no velocity to steer, so it cannot use the sidestep below to get out of
 * its own jam. This floor never overrides ARRIVAL damping (which legitimately
 * goes to NAV_MIN_APPROACH_SPEED and then parks) — only the brake.
 */
export const STEER_QUEUE_MIN_FRAC = 0.30;

/**
 * How anti-parallel two headings must be before the neighbour counts as
 * ONCOMING rather than as traffic to queue behind. cos(110 degrees) ~ -0.34,
 * so the test is `heading . myDirection < -0.34`.
 */
export const STEER_PASS_COS = 0.34;

/**
 * A neighbour slower than this fraction of MY max speed is standing in the
 * way, not leading a queue. Drive around it rather than inheriting its speed.
 */
export const STEER_PASS_STALL_FRAC = 0.25;

/**
 * Weight of the sidestep that resolves a head-on meeting.
 *
 * The direction is always the steering unit's OWN right, and that is the whole
 * trick: two units facing each other have opposite right-hand vectors, so
 * "both keep right" is a tie-break that needs no shared state, no RNG and no
 * id comparison — and it is the one rule that cannot mirror. (An id-parity
 * tie-break WOULD mirror: `i` steps to its right and `j` to its left, which
 * for opposed headings is the same world direction, and they stay locked.)
 */
export const STEER_PASS_WEIGHT = 1.25;

/* -- the unwedge shove, and why it is a steering term and not a goal offset -
 *
 * Both "shove a stuck unit sideways" remedies — the speed watchdog's nudge and
 * rungs 1..N of the wedge ladder — used to work by ADDING METRES TO THE
 * FORMATION SLOT. Two things were wrong with that, and the second one is fatal
 * to the idea rather than to the implementation:
 *
 *   1. `SteeringSolver` only applied the slot inside NAV_FORMATION_ENGAGE_RADIUS
 *      (see the note where that constant used to live), so the shove did
 *      nothing at all to a unit more than 22 m from its order point. Measured
 *      by perturbing `slotZ` by SIXTY METRES on a unit 237 m out with a live
 *      field: the commanded yaw and velocity came back bit-identical.
 *
 *   2. Even with that fixed, a goal offset cannot shove anything. Moving the
 *      target point 5 m sideways at 60 m of range turns the unit by 4.8
 *      degrees, and at 120 m by 2.4. The shove has to clear a 7.7 m hull. An
 *      offset applied at the far end of a long lever is not a shove, it is a
 *      rounding error — and while a flow field is being followed the direction
 *      comes from `nav.sample()` and ignores the target point entirely, so at
 *      range it is not even that.
 *
 * So the shove is now what it always described itself as: a LATERAL STEERING
 * TERM, blended in beside separation, avoidance and the head-on sidestep, in
 * every branch and at every distance, held for as long as the detector that
 * asked for it takes to look again. The slot went back to meaning only what its
 * name says.
 *
 * NAV_NUDGE_METRES (2.6) and NAV_WEDGE_NUDGE_METRES (5.0) were deleted with the
 * mechanism they parameterised. Metres are not a parameter of a steering term,
 * and both numbers had only ever been measured against a shove that did nothing.
 */

/**
 * Weight of the unwedge shove in the steering blend.
 *
 * Sized against the terms it has to beat, not picked. The blend it joins is a
 * unit-length travel direction plus separation at 1.15 and avoidance at 1.4, and
 * a wedged unit is by definition one where those already sum to something that
 * is not working. 1.9 makes the shove the single largest term, so the resulting
 * direction is dominated by it while it lasts, without erasing the flow field —
 * a unit shoved perpendicular to a wall it is grinding on still drifts along the
 * wall rather than straight off it, which is what walks it out of an alcove
 * instead of pinning it in the corner.
 */
export const STEER_NUDGE_WEIGHT = 1.9;

/** Braking is this much stronger than acceleration. Tanks stop faster than they start. */
export const MOVE_DECEL_MUL = 1.9;

/**
 * Heading error (radians) past which a TRACKED chassis stops and rotates on
 * the spot. 40 degrees. This one number is most of what makes a tracked
 * vehicle read as tracked rather than as a hovering box.
 */
export const MOVE_TURN_IN_PLACE_ANGLE = 0.70;
/** Fraction of speed a tracked chassis loses at the in-place threshold. */
export const MOVE_TRACK_CORNER_BRAKE = 0.55;

/** Floor on a wheeled chassis' steering authority at a standstill. */
export const MOVE_WHEEL_MIN_TURN_FRAC = 0.18;
/** Fraction of speed a wheeled chassis loses in a full reversal. */
export const MOVE_WHEEL_CORNER_BRAKE = 0.45;

/** Infantry turn this much faster than their nominal rate — a free pivot. */
export const MOVE_FOOT_TURN_MUL = 2.8;

/** Hovercraft turn briskly... */
export const MOVE_HOVER_TURN_MUL = 1.5;
/** ...and slide: 0 = travels strictly along the hull, 1 = pure strafing. */
export const MOVE_HOVER_DRIFT = 0.55;

/** Ships turn slowly. */
export const MOVE_NAVAL_TURN_MUL = 0.55;
/** Radians a ship heels out of a hard turn. */
export const MOVE_NAVAL_HEEL = 0.09;
/** Radians of idle bob amplitude, and its frequency in Hz. */
export const MOVE_NAVAL_BOB = 0.028;
export const MOVE_NAVAL_BOB_HZ = 0.21;

/** Aircraft turn rate multiplier and the bank angle at a full-rate turn. */
export const MOVE_AIR_TURN_MUL = 0.9;
export const MOVE_AIR_BANK = 0.55;

/** Exponential approach rate for body pitch/roll. Higher = snappier. */
export const MOVE_TILT_LAMBDA = 9.0;
/**
 * Hard cap on body pitch/roll, radians. 26 degrees. Terrain can legally reach
 * CLIFF_SLOPE (35.5 degrees) and a hull tilted that far intersects the ground
 * at its corners.
 */
export const MOVE_MAX_TILT = 0.46;

/** Metres of travel between tread-mark decal stamps. */
export const MOVE_TREAD_SPACING = 1.6;
/** Metres of travel between dust puffs. */
export const MOVE_DUST_METRES = 1.1;
/** Metres of travel between wake segments. */
export const MOVE_WAKE_METRES = 2.2;
/** Below this speed (m/s) a unit emits no ground FX at all. */
export const MOVE_MIN_FX_SPEED = 0.35;
/** Track gauge as a fraction of the unit radius (per side). */
export const MOVE_TREAD_GAUGE_FRAC = 0.72;

/** Metres an aircraft cruises above the heightfield. */
export const AIR_CRUISE_ALTITUDE = 22;
/** Exponential approach rate for that altitude when the ground changes. */
export const AIR_CLIMB_LAMBDA = 1.6;

/* ==========================================================================
 * 20. PROP SCATTER — THE ANTI-EMPTINESS BLOCK        (appended by src/world/**)
 *
 * Bible §14 R3 is rated FATAL and it is exactly this file's numbers:
 *
 *   "Terrain is a big empty plane. Prop scatter is always the last system
 *    written and the first cut. RA3's city reference carries 106 discrete props
 *    on 1.3 hectares; a procedural remake ships 8 rocks."
 *
 * RULING #9 sets the targets: city >= 75/ha, wilderness >= 260/ha. Bible §6.6
 * refines the city figure to >= 105/ha for a plaza and adds the ship-blocking
 * rule (scorecard #15, weight 3): no contiguous walkable region larger than
 * 25 m x 25 m may carry zero props, zero decals and zero texture variation.
 * `Scatter.validateCoverage()` is the automated gate for that rule.
 * ========================================================================== */

/**
 * Culling granularity. Props are bucketed into 32 m chunks and the visible set
 * is recomputed only when the camera's chunk footprint actually changes, so a
 * static camera costs zero per frame and a panning one costs one memcpy of the
 * visible instances. One InstancedMesh per prop type spans the whole 512 m map,
 * so without this every frame would upload ~7000 instances to draw ~200.
 */
export const SCATTER_CHUNK_METRES = 32;

/** Default scatter seed. `?scatterseed=` overrides; the scenario seed wins over both. */
export const SCATTER_SEED = 0x5ca77e;

/**
 * Density targets, props per hectare of ADORNABLE ground (water, cliff, road
 * and base footprints are excluded from the denominator as well as from the
 * placement). Bible §6.6's table, at our targets rather than RA3's measurements.
 */
export const SCATTER_DENSITY = {
  /** Bible §6.6 "City / plaza" — RA3 measured ~80/ha, our target 105/ha. */
  cityPerHectare: 105,
  /** Bible §6.6 "Wilderness / island" — RA3 ~230/ha, ruling #9 target 260/ha. */
  wildernessPerHectare: 260,
  /**
   * The floor `MapPreset.scatter` may not scale below. RULING #9 states the
   * minimum as "city >= 75/ha" and it is a RULING, not a suggestion — a preset
   * asking for scatter 0.6 on an urban map is asking for a mood, not for
   * permission to ship an empty plane.
   */
  hardFloorPerHectare: 95,
  /**
   * Grass tufts are the cheapest possible adornment and they are what actually
   * carries a wilderness map to 260/ha. Capped as a fraction of the total so a
   * map can never be "dense" purely by hiding under a lawn.
   */
  maxGrassFraction: 0.46,
  /** Fraction of the budget spent on clustered vegetation vs. scattered singles. */
  clusterFraction: 0.72,
} as const;

/**
 * Per-instance jitter. Bible §6.5 makes this MANDATORY and scorecard #39 checks
 * it: "without hue/value jitter a forest reads as a repeated stamp".
 */
export const SCATTER_JITTER = {
  scaleMin: 0.80,
  scaleMax: 1.25,
  /** Degrees of hue rotation, +/-. */
  hueDeg: 8,
  /** Fractional value spread, +/-. */
  value: 0.18,
  /** Fractional saturation spread, +/-. */
  saturation: 0.12,
  /** Degrees of tilt off vertical, +/-. Yaw is always free 0..360. */
  tiltDeg: 4,
} as const;

/**
 * Clustering. Bible §6.5: "3-9 trees per clump, 4-8 m spacing inside, 20-50 m
 * between clumps. Street rows are regular at 8-12 m pitch, 1.5-2.5 m off the
 * kerb, +/-0.4 m jitter." A uniform Poisson disc is the instant prototype tell.
 */
export const SCATTER_CLUSTER = {
  /** Metres between two clump centres of the same family. */
  betweenClumpsMin: 20,
  betweenClumpsMax: 50,
  /** Street-furniture pitch along a kerb, metres. */
  streetPitchMin: 8,
  streetPitchMax: 12,
  /** Metres a street prop stands back from the kerb line. */
  kerbOffsetMin: 1.5,
  kerbOffsetMax: 2.5,
  /** Positional jitter applied to a street prop, metres. */
  streetJitter: 0.4,
  /** Rejection attempts per member before a clump gives up. */
  attemptsPerMember: 8,
} as const;

/**
 * The 25x25 m ship-blocking rule (bible §6.6, scorecard #15) as an automated
 * gate. `Scatter.validateCoverage()` rasterises adornment at `gridMetres` and
 * reports every fully-unadorned walkable square of `patchMetres`.
 */
export const SCATTER_COVERAGE = {
  /** The rule's own number. A patch strictly larger than this fails. */
  patchMetres: 25,
  /** Rasterisation cell. 2 m over a 512 m map is a 256^2 grid — 64 KB. */
  gridMetres: 2,
  /** Bible §6.6: "target >= 55% of visible ground adorned". */
  targetAdorned: 0.58,
  /**
   * Fill passes generate() runs to close offending patches.
   *
   * Raised from 6. The texture overhaul removed the per-pixel noise that used
   * to count as "texture variation" on bare ground (measured flat-area std-dev
   * on roads fell 5.36 -> 1.77), so ground that was always empty is now VISIBLY
   * empty and `07-soviet-base` started tripping the 25x25 m ship-blocking rule.
   * Six passes were not enough to close the last patch; ten are, with the
   * per-patch count raised too so a single pass can actually fill a 625 m^2
   * square rather than dropping three props in a corner of it.
   */
  fillPasses: 10,
  /** Props placed per offending patch during a fill pass. */
  fillPerPatch: 5,
} as const;

/**
 * Vertex-animated foliage. Bible §6.5: "canopy vertex-shader sine on world XZ,
 * amplitude 0.15 m at 0.25 Hz, per-instance phase; grass tufts 0.06 m at
 * 0.6 Hz. Near-zero cost and its absence reads instantly as static."
 *
 * ONE frequency drives both bands (the amplitude is per-vertex, the frequency
 * is a uniform) because a second frequency would need a second attribute and a
 * second program, and 0.25 vs 0.6 Hz is not a scorecard item.
 */
export const SCATTER_WIND = {
  hz: 0.25,
  canopyAmplitude: 0.15,
  grassAmplitude: 0.06,
} as const;

/** Hard budgets. These exist so scatter can never be the reason a frame drops. */
export const SCATTER_LIMITS = {
  /** Absolute prop ceiling for the whole map. 26.2 ha x 260/ha = ~6800. */
  maxProps: 9000,
  /**
   * Maximum simultaneously-live prop types, i.e. InstancedMeshes. Each costs
   * one colour draw + one shadow draw, and MAX_DRAW_CALLS is 130 with terrain
   * already spending ~34. Types past this cap are dropped lowest-count first.
   */
  maxTypes: 22,
  /**
   * Metres the visible chunk box is grown by, so a prop just outside the
   * frustum still casts its shadow into it. Bible §3.2 puts the sun at 33
   * degrees elevation, so the tallest prop in the roster — a 12.3 m water
   * tower — throws about 19 m. 20 m covers the roster with nothing to spare,
   * which is the point: this margin is multiplied by the whole chunk grid.
   */
  shadowMarginMetres: 20,
} as const;

/**
 * Prop surfaces. Vegetation and stone are NOT painted armour: bible §5.4
 * reserves clearcoat 0.30 for hulls, and a waxy leaf reads as plastic. What
 * props do keep is a live `envMapIntensity` — scorecard #23's silhouette rim is
 * as important on a lamp post as it is on a tank.
 */
export const PROP_MATERIAL = {
  roughness: 0.86,
  metalness: 0.0,
  clearcoat: 0.06,
  clearcoatRoughness: 0.55,
  envMapIntensity: 0.55,
  /** Painted bevel highlight, bible 5.5: base albedo +22% V, -15% S. */
  bevelValueGain: 0.22,
  bevelSaturationLoss: 0.15,
} as const;

/**
 * Emissive gain for lamp heads and signal lenses. Lower than UNIT_MATERIAL's
 * 2.2 because a street lamp is a 0.3 m^2 panel repeated 40 times across a
 * frame, and bible §4.4's bloom threshold is 0.82 — 40 blown lamps would veil
 * the whole plaza, which is the exact failure R5 warns about.
 */
export const PROP_EMISSIVE_GAIN = 1.6;

/**
 * The decal pool is split in two so a tank charge cannot evict the road's
 * manholes and the battlefield's scorch marks. Two fields, two draw calls,
 * two eviction policies: the static field holds permanent marks laid once,
 * the track field is a fast ring the treads churn through.
 */
export const DECAL_POOL_STATIC = 384;
export const DECAL_POOL_TRACKS = 640;

/**
 * Road routing. Terrain is authored as discrete terraces (bible §6.4), so a
 * 100 m straight run between two lattice nodes crosses a cliff face far more
 * often than not — the first version of the road generator rejected 21 of 24
 * candidate edges and produced an empty map. Roads are routed with A* over the
 * build grid instead, and these are its knobs.
 */
/**
 * Metres of legal ground kept between a road and the map rim.
 *
 * MUST clear `TERRAIN_BORDER_CELLS * CELL` (8 m) with a cell to spare: terrain
 * makes the outermost two cells impassable, so a border node at 4 m sits on
 * ground no road can legally occupy — which silently killed every arterial and
 * left a third of all seeds with no roads at all.
 */
export const ROAD_MAP_MARGIN = 14;
/**
 * Douglas-Peucker tolerance applied to the A* cell path, in metres. Large on
 * purpose: the point is to collapse the grid's 45/90-degree staircase back
 * into the two or three real turns it stands for, because feeding a staircase
 * into the ribbon builds exactly the axis-aligned road scorecard #32 fails.
 */
export const ROAD_ROUTE_SIMPLIFY = 9;
/** Shortest leg that gets a decorative bend inserted into it, in metres. */
export const ROAD_BEND_MIN_LEG = 14;
/**
 * A straight run at least this long counts as "a straight road" for scorecard
 * #32. Shorter segments are pieces of an arc and pass through every heading.
 */
export const ROAD_STRAIGHT_RUN_METRES = 14;

/**
 * Minimum spacing between road waypoints before the fillet pass, in metres.
 * A fillet radius is capped by the shorter of its two legs, so waypoints
 * closer than this can only host a kink.
 */
export const ROAD_WAYPOINT_SPACING = 13;

/**
 * VFX PointLights per quality tier [Low, Medium, High, Ultra].
 *
 * Two sources disagree and both are honoured rather than one overriding the
 * other. `QUALITY_PRESETS[t].maxDynamicLights` is 2/4/8/8; bible §8.9 asks for
 * a pool of 8–12 and scorecard #28 (the ground wash) is judged at High. So Low
 * and Medium take the foundation's numbers exactly — that is where the extra
 * per-pixel light loop actually costs frames — and High/Ultra take the bible's
 * band, which is where the frame is critiqued.
 *
 * Every light in the pool is resident in the scene for the whole match, so this
 * number is baked into `NUM_POINT_LIGHTS` in every shader. Changing it at
 * runtime would recompile the world.
 *
 * WHAT A RESIDENT POINT LIGHT ACTUALLY COSTS
 * ------------------------------------------
 * Measured, in a live match at a fixed 2560x1440 drawing buffer on the
 * reporter's AMD Renoir iGPU, with GPU timer queries and the post chain off so
 * the number is the scene pass alone:
 *
 *     4 resident point lights   29.5 ms
 *     2 resident point lights   25.0 ms
 *     0 resident point lights   19.2 ms
 *
 * **2.57 ms per light per frame at 1440p, whether or not it is emitting.**
 * Three of the four in that capture had intensity exactly 0. The whole scene
 * pass with every light removed is 13.9 ms and with a `MeshBasicMaterial`
 * override it is 2.3 ms — so the frame is not geometry, not draw calls and not
 * overdraw, it is the per-fragment light loop, and each pool slot is 15% of a
 * 60 fps budget on this class of GPU.
 *
 * The residency itself is still right (see above: toggling recompiles), and
 * §8.9's 8–12 band still governs High and Ultra, which is where the scorecard
 * is judged. What changed is Low and Medium, the tiers the existing policy
 * already assigns to "where the extra per-pixel light loop actually costs
 * frames": Medium 4 -> 2 and Low 2 -> 1. One explosion still claims a light at
 * every tier, so scorecard #28 — the ground wash around a SINGLE blast — is
 * measuring the same thing it always did; what a Medium machine loses is the
 * third and fourth SIMULTANEOUS wash.
 */
export const VFX_LIGHT_POOL_BY_TIER: readonly number[] = [1, 2, 10, 12];

/**
 * Two junction arms closer than this in heading are treated as ONE.
 *
 * A* routes two different lattice edges through the same terrain gap often
 * enough that a junction ends up with two arms pointing the same way; their
 * mouths overlap, the pad boundary stops being monotonic about the node, and
 * the triangle fan emits inverted faces that render as holes.
 */
export const ROAD_ARM_MERGE_RADIANS = 0.32;

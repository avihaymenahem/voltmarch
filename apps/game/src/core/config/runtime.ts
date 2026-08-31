/**
 * Domain-owned config slice: simulation timing, world scale and canonical dimensions.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

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
export const GAME_SPEEDS = [0.5, 1.0, 1.5, 2.0, 2.5] as const;
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
/**
 * The sidebar tabs in display order. Drives per-player queue creation.
 *
 * MUST STAY THE SAME LENGTH AS `BUILD_TAB_COUNT` in core/types.ts. It is spelt
 * out rather than derived because config may not import types (types imports
 * nothing, config imports nothing, and the one-way edge is what keeps both
 * loadable from a node test); `tests/production.spec.ts` asserts the two agree.
 * Slot 4 is `BuildTab.Powers`, whose queue is real — a power is bought through
 * the ordinary drip-paid queue like everything else.
 */
export const BUILD_TAB_ORDER = [0, 1, 2, 3, 4] as const;

/** Spatial hash cell size in metres. Bigger than CELL: ~2 units per bucket. */
export const SPATIAL_CELL = 8;
/** Spatial grid dimension. Derived: 64. */
export const SPATIAL_DIM = Math.ceil(MAP_SIZE / SPATIAL_CELL);
/** Largest number of results any single spatial query may return. */
export const MAX_QUERY_RESULTS = 256;

/**
 * Terrain height range in metres — plateaus, not mountains.
 *
 * `TERRAIN_MIN_HEIGHT` HAS NO CODE READERS and never had any. The real floor is
 * a literal `0` inside `Terrain.buildHeightfield`. Three separate comments —
 * here, in `SeaSpec.depth` and in `NAVAL_SEA` — asserted that this constant was
 * the floor, and all three were describing a constant nothing consumed. It is
 * kept as documentation of the LAND floor; do not assume changing it does
 * anything.
 */
export const TERRAIN_MIN_HEIGHT = 0;
export const TERRAIN_MAX_HEIGHT = 24;
/**
 * How far the SEABED may sit below y=0. Sea cells only — `Terrain.carveSea` is
 * gated on `seaDistance > 0`, so this can never lower land.
 *
 * WHY THIS EXISTS. With the floor pinned at 0 and `WATER_LEVEL` at 2.0, no
 * water anywhere in the game could exceed 2.0 m deep. `Water.fitRamp` then
 * always clamped to `rampDepthMin` (2.6 m) against a 16.8 m design target, so
 * the absorption gradient — the entire point of the water shader — had only
 * ever run in its shallow fallback. Worse, at 2 m of depth `exp(-depth*absorb)`
 * stays near 1, so the "sea" was mostly sunlit SEABED read through a nearly
 * transparent sheet. That is what made the naval fixture a warm white glare.
 *
 * -6 is chosen, not arbitrary: the shadow cascade is fitted by intersecting the
 * view frustum with the y=0 plane and then padded by a fixed 12 m
 * (`render/scene.ts` `fitShadow`), so a bed at -6 stays inside the ortho box
 * with margin. Around -12 the pad is exhausted and the seabed at the frustum
 * edge would fall out of the shadow map. Do not deepen this without re-checking
 * that pad.
 */
export const TERRAIN_SEA_FLOOR = -6;
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
  lightTank:     { l: 6.20, w: 3.10, h: 2.25, turretY: 1.50 },  // Warden
  heavyTank:     { l: 7.00, w: 3.40, h: 2.50, turretY: 1.62 },  // Anvil
  apocalypse:    { l: 8.20, w: 3.90, h: 2.90, turretY: 1.85 },
  ifv:           { l: 5.40, w: 2.80, h: 2.20, turretY: 1.55 },
  prismTank:     { l: 6.40, w: 3.00, h: 2.40, turretY: 1.55 },
  harvester:     { l: 8.60, w: 4.00, h: 3.30, turretY: 0 },
  mcv:           { l: 9.00, w: 4.40, h: 3.80, turretY: 0 },
} as const;

/* ==========================================================================
 * INFANTRY LEGIBILITY — a minimum SCREEN size, because the table above only
 * defends a minimum WORLD size
 *
 * `UNIT_DIMENSIONS` says it is "the only defence against 'the infantry look
 * like ants'", and against the art it is: nothing may author a rifleman at
 * half a metre. It cannot defend the thing a player actually complains about,
 * which is how many PIXELS the rifleman gets, because that is a function of
 * the camera and the drawing buffer and neither is in this table.
 *
 * MEASURED, over a real fogged match, by rendering each frame twice — batches
 * shown and batches hidden — and counting the pixels each enemy unit actually
 * contributes above a 10/255 contrast threshold:
 *
 *     camera  55 m   infantry 118 px   (min 0, max 377)
 *     camera  90 m   infantry  74 px   vs a vehicle's 2959 — 40x
 *     camera 140 m   infantry  57 px   vs a vehicle's 1853 — 32x
 *
 * `min 0` at every distance: some enemy infantry contribute NO pixels that
 * differ from the background inside their own bounding box. Three separate
 * reports, two audits that answered the wrong question correctly, and the
 * renderer was never at fault — the units are drawn, every frame, at a size
 * nobody can see.
 *
 * THE FIX IS WHAT RA3 DOES: hold a floor on apparent size and let the model
 * grow as the camera pulls back. It is self-limiting in the way that matters —
 * `scaleFor` returns exactly 1 until the floor is threatened, so nothing
 * changes at the zoom where infantry are already legible, and a change that
 * only fires when it is needed cannot make the close-in view worse.
 *
 * IT IS COMPUTED AGAINST DRAWING-BUFFER PIXELS, NOT CSS PIXELS. Adaptive
 * resolution was rendering a 1280x720 viewport at 704x396 and cutting infantry
 * pixels by another two thirds; measuring the real buffer means that
 * compounding is answered by the same mechanism instead of needing its own.
 * ========================================================================== */
export const INFANTRY_LEGIBILITY = {
  /**
   * Floor on a rifleman's height in CSS pixels — apparent size, the thing
   * "I cannot see them" actually means.
   *
   * MEASURED through the live camera matrix at 1366x768, projecting the real
   * `UNIT_DIMENSIONS` boxes:
   *
   *      camera    infantry (h x w)    Warden (h x w)
   *       30 m      70.4 x 29.6         235.7 x 286.6
   *       55 m      37.4 x 15.9         129.2 x 152.5    <- the default zoom
   *       90 m      21.7 x  9.6          81.5 x  92.2
   *      140 m      13.1 x  6.2          53.5 x  58.8    <- max zoom out
   *
   * 37 is chosen off the 55 m row deliberately: `CAMERA.defaultDistance` is
   * 55, the model clears 37 there on its own, and so the shipping look at the
   * zoom most play happens at is EXACTLY unchanged. Everything past that is
   * the correction, and by 90 m it is 1.7x.
   *
   * WIDTH is what actually binds — 9.6 px of rifleman against 92 px of tank is
   * a 36x area difference, and almost all of it is that a hull is 6.2 m long
   * and a man is 0.52 m across. The floor is stated in height only because
   * pixels-per-metre is the same on both axes (the aspect term cancels), so
   * one number moves both; 37 px of height is 11 px of width, which is about
   * where two riflemen abreast stop being one smudge.
   */
  minCssPixels: 37,
  /**
   * Floor on the same height in DRAWING-BUFFER pixels — sample count, which is
   * a different failure from apparent size and needs its own number.
   *
   * Adaptive resolution was rendering a 1280x720 viewport at 704x396. That
   * does not make the soldier smaller on screen, it makes him blurrier — and
   * past a point it makes him VANISH, which is the `min 0` in the report: some
   * enemy infantry contributed zero pixels differing from the background by
   * more than 10/255 inside their own bounding box. Too few samples to survive
   * the upscale and the contrast threshold.
   *
   * 26 rather than 37 because this is not asking the man to be big, only to be
   * sampled. At `pixelRatio` 1 with no resolution drop it never binds — the
   * CSS floor is always the larger of the two — so it costs nothing on a
   * healthy machine and only speaks up when the GPU has started cutting.
   */
  minBufferPixels: 26,
  /**
   * Ceiling on the multiplier, and it is set against the roster rather than by
   * eye: 1.75 m x 1.9 is 3.3 m, which is exactly as tall as a Harvester and
   * still under an MCV's 3.8. A rifleman may out-top a tank — RA2 and RA3 both
   * let him, and the eye reads size within a class rather than across one —
   * but he may not out-top everything on the map.
   */
  maxScale: 1.9,
} as const;

/**
 * How much to grow an infantry model so it clears both floors, or 1.
 *
 * Pure. One scalar per FRAME, applied to every infantryman — not per entity.
 * Per-entity distance would be marginally more accurate and visibly worse:
 * soldiers at the top of the screen would be bigger than the ones at the
 * bottom, and the whole formation would swim as the camera panned.
 *
 * TWO FLOORS, AND THE LARGER WINS, because there are two distinct ways a
 * rifleman becomes unreadable and one lever cannot answer both. See the
 * constants above; the short version is that CSS pixels are how BIG he is and
 * buffer pixels are how WELL SAMPLED he is, and a 4K display fixes the second
 * without touching the first.
 */
export function infantryLegibilityScale(
  cameraDistance: number,
  fovYDegrees: number,
  bufferHeightPx: number,
  cssHeightPx: number,
): number {
  if (!(cameraDistance > 0) || !(fovYDegrees > 0)) return 1;
  // Height in pixels of an `h`-metre object at `d` metres under a perspective
  // camera: h * viewportH / (2 d tan(fov/2)). The aspect term cancels, so the
  // same expression gives the width from the model's width.
  const perMetre = 1 / (2 * cameraDistance * Math.tan((fovYDegrees * Math.PI) / 360));
  const h = UNIT_DIMENSIONS.infantry.h;

  let want = 1;
  if (bufferHeightPx > 0) {
    const px = h * bufferHeightPx * perMetre;
    if (px > 0) want = Math.max(want, INFANTRY_LEGIBILITY.minBufferPixels / px);
  }
  if (cssHeightPx > 0) {
    const px = h * cssHeightPx * perMetre;
    if (px > 0) want = Math.max(want, INFANTRY_LEGIBILITY.minCssPixels / px);
  }
  if (!Number.isFinite(want) || want <= 1) return 1;
  return Math.min(INFANTRY_LEGIBILITY.maxScale, want);
}

/** One building storey in metres. Every structure height is a multiple-ish. */
export const STOREY = 3.2;

/**
 * Road- and prop-free apron around an automatically generated opening base.
 * The structural layouts fit inside 46 m; one extra build cell keeps kerbs,
 * trees and rocks out of the lanes a player reads as part of the compound.
 */
export const AUTO_BASE_APRON_RADIUS = 52;

/** Dolly distance used by the slowly orbiting title-screen battlefield. */
export const TITLE_BACKDROP_CAMERA_DISTANCE = 104;

/**
 * Tall-prop clearance around the non-playable title-screen base. Grass and
 * other low ground cover may remain inside it; trees, rocks and yard props
 * frame the compound instead of occupying its lanes.
 */
export const TITLE_BACKDROP_SCATTER_CLEAR_RADIUS = 44;

/**
 * Prop-free core around an MCV opening.
 *
 * An undeployed opening is not an automatically generated base. Reusing the
 * 52 m compound apron above erased more than 8,400 m² of dressing around a
 * single vehicle and left the entire first camera frame as an empty lawn.
 * Eighteen metres keeps tree crowns off the deployer and leaves one readable
 * build-cell buffer around its future 3x3 yard, while the per-unit exclusions
 * in `world/scatter.system.ts` preserve the infantry and armour egress lane.
 * Scatter is non-blocking and structure placement fells it, so the surrounding
 * ring remains buildable even though it no longer looks sterile.
 */
export const MCV_START_SCATTER_CLEAR_RADIUS = 18;

/** FROZEN building footprints (cells) and heights (metres). */
export const BUILDING_DIMENSIONS = {
  conYard:     { w: 3, h: 3, height: 11.0 },  // crane arm roofline
  refinery:    { w: 3, h: 2, height: 9.0 },   // dock canopy + silo drum
  warFactory:  { w: 3, h: 2, height: 8.5 },   // roll-up door + gantry
  barracks:    { w: 2, h: 2, height: 6.4 },
  powerPlant:  { w: 2, h: 2, height: 9.0 },   // twin stacks
  radar:       { w: 2, h: 2, height: 12.0 },  // tallest silhouette until the silo
  battleLab:   { w: 2, h: 2, height: 8.0 },
  // THE COMMAND POST, one shape for all four armies (Command Post, Pharos,
  // Signal Rig). MUST MATCH `BUILDING_FOOTPRINTS.commandPost` EXACTLY — the art
  // resolves through `fp()`, which reads that table first, while the def's
  // `dim:` reads this one.
  //
  // 2x2 like the tech building, 10.5 m tall rather than 8.0, and the extra two
  // and a half metres are the point: the two structures cost about the same and
  // sit at the same tier, so the only thing telling an opponent which one you
  // built is the roofline. A mast is also what the building IS — a transmitter
  // — so the silhouette is honest rather than decorated. Still under the Radar
  // Dome's 12.0, which has to stay the tallest thing in a base that has one.
  commandPost: { w: 2, h: 2, height: 10.5 },
  // THE SUPERWEAPON PAD, one shape for all six of them (Nuclear Silo, Ironclad
  // Field, Displacement Ring, Weather Control, Heliograph, Stormworks).
  //
  // Bigger than the Construction Yard's plan and taller than the Radar Dome
  // deliberately: this is the only structure in the game that decides a match
  // on its own, and an opponent has to be able to read that it exists from the
  // far side of the map before the countdown finishes. 3x3 is also a real
  // placement cost — the same footprint the yard needs — which is the price of
  // the button being a base commitment rather than a purchase.
  //
  // Both art tables resolve this: `Faction3/4Buildings.fp()` reads
  // BUILDING_DIMENSIONS directly and `BuildingDefs.fp()` falls through to it
  // via `EXTRA_DIMENSIONS`, so unlike `gate` and `repairDepot` there is no
  // second copy in `BUILDING_FOOTPRINTS` that could drift out of step.
  superweapon: { w: 3, h: 3, height: 13.0 },
  // A gantry over an open pad. Low on purpose — only the Ore Silo (5.0) and
  // the Barracks (6.4) sit under it — because the thing the player needs to
  // see is the deck they are driving onto, and a tall shed would hide the
  // vehicle parked under it from a fixed 38-degree camera. Not lower than
  // this: the shells only reach `bodyFraction * height` on their own and the
  // validator's height band is +/-12%, so an authored roofline has to leave
  // the furniture somewhere to go.
  repairDepot: { w: 2, h: 2, height: 6.5 },
  oreSilo:     { w: 1, h: 1, height: 5.0 },
  pillbox:     { w: 1, h: 1, height: 2.2 },
  teslaCoil:   { w: 1, h: 1, height: 9.0 },
  prismTower:  { w: 1, h: 1, height: 8.0 },
  flameTower:  { w: 1, h: 1, height: 5.5 },
  wall:        { w: 1, h: 1, height: 2.0 },
  // MUST MATCH `BUILDING_FOOTPRINTS.gate` EXACTLY. The art resolves its
  // footprint through `fp()`, which reads BUILDING_FOOTPRINTS first, while the
  // def's `dim:` reads this table — so a disagreement here gives the sim one
  // roofline and the model another. Same 1x1 cell as the wall it interrupts,
  // because a gate that did not line up with a wall run would be unbuildable in
  // the only place anyone wants one.
  gate:        { w: 1, h: 1, height: 3.6 },
} as const;

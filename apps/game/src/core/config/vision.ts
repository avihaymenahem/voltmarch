/**
 * Domain-owned config slice: fog-of-war and vision presentation.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

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
 * 129x129 vertex grid (33k triangles, ONE draw call) — one vertex every 4 m.
 *
 * **THIS SAID "1 IS PLENTY" AND GAVE A REASON THAT IS WRONG FOR TERRACED
 * GROUND.** The reason was: *"the fog value itself is bilinear-filtered in the
 * fragment shader, so this grid only has to follow the terrain SILHOUETTE, not
 * the fog gradient."* Both halves are true and the conclusion does not follow.
 * Following the silhouette is exactly what a 4 m grid cannot do over a terrace,
 * which is a near-vertical step inside one span: the carpet interpolates
 * LINEARLY across it and cuts a diagonal ramp through the face, so on the high
 * side the carpet sits BELOW the ground, the depth test lets the terrain win,
 * and never-explored high ground renders at full daylight.
 *
 * Measured through the real generator at 0.5 m over the whole map
 * (`tests/fog-drape.spec.ts`): **5.0-7.0% of every map had terrain standing
 * above the carpet, by up to 6.59 m**, on all four biomes — it is not urban-
 * specific, and urban was the mildest of the four.
 *
 * **RAISING THIS NUMBER IS NOT THE FIX AND WAS MEASURED NOT TO BE.** No finite
 * grid follows a discontinuity. Point-sampled, on `soviets.07.right-of-entry`:
 *
 * ```
 *   spc=1  step 4.0 m   6.064% over, worst 4.930 m       32 768 tris
 *   spc=2  step 2.0 m   3.181% over, worst 4.153 m      131 072 tris
 *   spc=4  step 1.0 m   1.002% over, worst 0.813 m      524 288 tris
 *   spc=8  step 0.5 m   0.000% over, worst 0.015 m    2 097 152 tris
 * ```
 *
 * Sixty-four times the triangles to buy a residual, against a CONSERVATIVE
 * drape which is exactly 0.000% / 0.000 m at this value. So the fix is in
 * `FogOfWar.ts#drapeConservative` — the carpet takes the local MAXIMUM of the
 * ground over each vertex's footprint instead of its point value — and this
 * constant stays 1. See that function's header for the guarantee and its cost.
 */
export const FOG_MESH_SAMPLES_PER_CELL = 1;
/**
 * Metres the carpet floats above the surface it samples.
 *
 * NOT cosmetic-only any more, and the old comment saying so was written when
 * the carpet drew with `depthTest: false` and could not lose to the ground.
 * It depth-tests now, so this is the z-fight margin over flat ground — the one
 * place the conservative drape lands exactly ON the terrain.
 */
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

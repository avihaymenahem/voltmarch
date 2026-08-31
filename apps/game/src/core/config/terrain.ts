/**
 * Domain-owned config slice: terrain generation and sea contracts.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

import { CELL } from './runtime';

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

/**
 * Fraction of a chunk's triangles that must be steeper than `CLIFF_SLOPE`
 * before the chunk is submitted to the shadow map.
 *
 * WAS A BARE `0.04` INSIDE `Terrain.buildMeshes` and is a named export now
 * because a SECOND decision reads it: `buildTerrainChunks` refuses to decimate
 * a chunk that would cast, so a chunk can never throw a shadow from triangles
 * its index buffer no longer contains. Two literals in two files is exactly how
 * those two decisions would drift apart. `chunkCastsShadow` in
 * `src/world/terrain-gen.ts` is the one predicate both sides call.
 */
export const TERRAIN_SHADOW_CLIFF_FRACTION = 0.04;

/**
 * Metres of height error the half-resolution terrain index may introduce
 * before a chunk is kept at full resolution.
 *
 * WHAT IT MEASURES. Decimating drops every odd-indexed heightfield sample
 * inside a chunk; the drawn surface then runs straight between the samples that
 * survive. The error is the largest gap between a dropped sample and the coarse
 * edge (or cell diagonal) it used to sit on, and it is measured directly rather
 * than inferred from a slope — `buildTerrainChunks` computes it for every
 * chunk on every generation.
 *
 * WHY 0.15. Two independent ceilings, and this sits under both:
 *
 *  1. **The swell.** `RA3_LOOK_BIBLE` §6.4 authors playable ground as flat to
 *     within 0.4-0.8 m of swell over 15-30 m. A decimation error at 0.4 would
 *     be the whole of the smallest authored swell, i.e. the LOD would be
 *     rewriting the landform rather than approximating it.
 *  2. **Everything standing on the ground.** Props, structures and units are
 *     placed at `terrain.heightAt`, which reads the HEIGHTFIELD — not the
 *     drawn mesh. So the error is also the distance a tank's tracks may float
 *     above, or sink below, the ground it is drawn on. 0.15 m is under the
 *     ride height of every hull in the game and well inside the contact
 *     shadow that hides the join.
 *
 * MEASURED, and it is very nearly not the binding gate at all: over the ten
 * shipped battlefields plus the four `?shot=` seas, the set of chunks passing
 * `error <= 0.15` and the set with zero cliff triangles agree to within four
 * chunks on one map. Raising it to 0.4 admits chunks that DO hold a terrace
 * face, which is the point at which the two gates stop agreeing and the second
 * one starts mattering.
 */
export const TERRAIN_LOD_MAX_ERROR = 0.15;

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
 *
 * ...AND THAT IS STRUCTURALLY INCAPABLE OF AN ARCHIPELAGO, which is what
 * `SeaIsland` below is for. A half-plane has exactly one land region and one
 * water region, so no amount of tuning makes it four islands: the shape is the
 * limit, not the numbers.
 *
 * THE GENERALISATION IS A SIGNED DISTANCE FIELD, AND THE HALF-PLANE IS ITS
 * FIRST PRIMITIVE. Every `seaDistance` in the generator answers one question —
 * "signed metres seaward of the nearest coast" — and a half-plane answers it
 * with `(p - origin) . normal`. An ellipse answers it with its own signed
 * distance. LAND IS THE UNION of whatever primitives are declared, and the
 * signed distance of a union is the MINIMUM of its members', so an archipelago
 * is `min` over four ellipses and needs no second code path: the beach cone,
 * the shelf ramp, the coastal wander, the splat band and `waterGrid` all read
 * the same number they always did.
 *
 * IT STAYS PLAIN SERIALISABLE DATA, which is a hard constraint rather than a
 * preference — `src/world/terrain-gen.ts` runs inside a Web Worker and this
 * struct crosses by `structuredClone`. So the primitives are numbers in arrays,
 * never callbacks, and `isTerrainJob` in `core/workers/protocol.ts` validates
 * every one of them on the way in.
 *
 * AXIS-ALIGNED ELLIPSES, DELIBERATELY. A rotation would need `Math.cos` /
 * `Math.sin` in the heightfield loop, and neither is exactly specified by
 * ECMA-262 — two engines may disagree in the last bit. Terrain is generated
 * independently on both machines of a lockstep match, so a 1-ULP difference in
 * a coastline is a desync. `Math.sqrt` IS correctly rounded and is all the
 * ellipse distance below needs.
 * ------------------------------------------------------------------------ */

/**
 * One island: an axis-aligned ellipse of LAND, in world metres.
 *
 * `radiusX`/`radiusZ` are semi-axes, so the inscribed circle of an island is
 * `min(radiusX, radiusZ)` — and that minimum, not the area, is what has to
 * clear the start-shelf budget in `TerrainFields.resolveStarts`. An island
 * whose short axis is under
 * `TERRAIN_START_FLAT_RADIUS + TERRAIN_START_EDGE_WOBBLE + bandWidth +
 * wavinessMetres + TERRAIN_SEA_START_CLEARANCE` cannot hold a base without the
 * levelled shelf spilling into the sea, whatever its long axis is.
 */
export interface SeaIsland {
  /** Centre, world metres. */
  readonly x: number;
  readonly z: number;
  /** Semi-axis along X, metres. Must be > 0. */
  readonly radiusX: number;
  /** Semi-axis along Z, metres. Must be > 0. */
  readonly radiusZ: number;
}

/**
 * A shoal: an axis-aligned ellipse of SHALLOWS. Raises the bed toward the
 * surface without ever breaking it.
 *
 * Not a fifth island and not decoration. `Water.fitRamp` fits the absorption
 * gradient to the basin that was actually generated, so a 0.7 m bar inside a
 * 7 m sea is a different COLOUR, not a different mesh — the one place this
 * engine can express a reef without a second material or a reflection (which
 * `docs/RA3_LOOK_BIBLE.md` bans outright). It is navigable throughout: a cell
 * is water at `height < WATER_LEVEL` and a shoal is clamped to stay under it by
 * `TERRAIN_SEA_SHOAL_MIN_DEPTH`.
 */
export interface SeaShoal {
  readonly x: number;
  readonly z: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  /** Metres of water left over the bar at its shallowest point. */
  readonly depth: number;
}

/**
 * A sea a scenario asks the generator to carve, in WORLD metres.
 *
 * Water is the half-plane `(p - origin) . normal > 0`. This is deliberately
 * the same geometry `ScenarioSpec.shore` publishes — the two must agree, and
 * `buildScenario` warns when they do not — but it is delivered EARLIER, on
 * `plannedScenario()`, because terrain generates long before any scenario has
 * built. See `src/world/sea.system.ts` for the hand-off.
 *
 * ...UNLESS `islands` IS NON-EMPTY, and that is the one discriminator in this
 * struct. An archipelago's land is EXACTLY the union of its islands and the
 * half-plane is not applied at all — `x`, `z` and the normal stay required
 * (they are what `isTerrainJob` validates and what an archipelago publishes as
 * its nominal `ShoreSpec` axis) but they no longer carve anything. The
 * alternative was a `kind` tag that could disagree with the array beside it;
 * "the list of islands is the list of islands" cannot.
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
  /**
   * Land masses, when this sea is an ARCHIPELAGO rather than a coast.
   *
   * Absent or empty is the half-plane every shipped sea uses today, and the
   * generator runs the identical arithmetic it always has for it. Non-empty
   * REPLACES the half-plane: land is the union of these ellipses and nothing
   * else, so the map has one land region per island and the water between them
   * is one connected sea.
   */
  readonly islands?: readonly SeaIsland[];
  /**
   * Shallows raised out of the bed. Applied only where the water field is
   * already seaward of the coast, so a shoal can never dry a beach.
   */
  readonly shoals?: readonly SeaShoal[];
  /**
   * Rise/run of this coast's beach cone. Omitted means `TERRAIN_SEA_BEACH_GRADE`.
   *
   * A per-sea lever because "how steep is the beach" is a property of the
   * COASTLINE, not of the engine: an archipelago whose every shore is a landing
   * beach wants a gentler cone than a fjord. The default is the one that makes
   * a beach buildable (see `TERRAIN_SEA_BEACH_GRADE`), so a map that says
   * nothing gets a dockable coast.
   *
   * These three arrived in the same wave and compose deliberately: `islands`
   * decides WHERE the coast is, `beachGrade` decides how it meets the water.
   * An archipelago is the case that wants both — every one of its shores is a
   * landing beach, and it had zero legal dock sites before the grade moved.
   */
  readonly beachGrade?: number;
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
 * THIS WAS 0.26 AND THE BEACH WAS NEVER BUILDABLE ON, WHICH IS NOT A DETAIL —
 * it is the difference between a coast and a wall you can sail past.
 *
 * The old number was justified against the wrong threshold. 0.26 is under
 * `tan(ROUGH_SLOPE)` (0.288), so the beach never classifies as ROUGH; but
 * `computeDerived` writes `buildGrid` at `maxSlope < ROUGH_SLOPE * 0.62`, i.e.
 * 0.1736 rad, i.e. a grade of 0.1753. `atan(0.26)` is 0.2543 rad. So every
 * square metre of every beach cone in the game failed the build test by 46%,
 * and a Naval Yard could only ever be founded where natural ground happened to
 * be flat NEAR the water rather than on the shore itself. Measured on the two
 * shipped sea maps at their pinned seeds, only 10-23% of coastal ground was
 * buildable and one of them offered 81 dock sites along a 400 m coastline.
 *
 * 0.12 is the fix, and the margin under 0.1753 is deliberate rather than "just
 * under": `seaDistance` adds an fbm wobble of `wavinessMetres` on a
 * `wavelengthMetres` feature and the cone's height inherits that gradient, so
 * the realised slope on a wobbling coast runs well above `atan(grade)`.
 *
 * MEASURED on both shipped seas at their pinned seeds — ground within 40 m of
 * the waterline that `isBuildable`, and the count of foundable 3x3 dock sites
 * (`tests/naval-shore.spec.ts` runs the same sweep):
 *
 *     grade   contested-strait        coral-shore
 *     0.26    16.4% buildable, 178     10.3% buildable,  81
 *     0.16    17.6% buildable,  37     23.1% buildable,  41
 *     0.14    35.5% buildable,  90     41.0% buildable, 149
 *     0.12    57.4% buildable, 263     54.0% buildable, 389
 *     0.10    72.8% buildable, 492     54.9% buildable, 431
 *
 * The dip at 0.16 is the honest shape of this curve and the reason "a bit
 * gentler" was never going to work: a cone that is still too steep to build on
 * CLAMPS ground that used to be naturally flat, so it destroys dock sites
 * before it starts creating them. Nothing between 0.26 and ~0.14 is an
 * improvement on doing nothing.
 *
 * ONE CONE WAS NOT ENOUGH, AND THE SECOND ONE IS WHY THIS IS AN IMPROVEMENT
 * RATHER THAN A TRADE. A single gentle cone reaches
 * `(TERRAIN_MAX_HEIGHT - WATER_LEVEL) / grade` inland — 85 m at 0.26 but 161 m
 * at 0.12, which is a third of the map erased into one smooth ramp. So the
 * profile is now PIECEWISE: `TERRAIN_SEA_BEACH_RUN` metres of this grade, then
 * `TERRAIN_SEA_BLUFF_GRADE` behind it. The beach is wide and flat where a dock
 * goes; the landform comes back immediately behind it. Measured bite of the
 * whole profile — furthest inland cell whose height is still sitting on the
 * cone — is 72 m and 62 m on the two maps, against 74 m and 74 m for the old
 * single 0.26 cone. So the coast got FLATTER and the map got LESS eroded at the
 * same time.
 */
export const TERRAIN_SEA_BEACH_GRADE = 0.12;

/**
 * Metres of `TERRAIN_SEA_BEACH_GRADE` beach inland of the waterline, before the
 * profile hands over to `TERRAIN_SEA_BLUFF_GRADE`.
 *
 * 40 m is three cells more than a Naval Yard footprint plus its egress spiral,
 * so the whole "found a dock and sail out of it" transaction fits inside the
 * flat band with room to turn. Wider buys nothing a dock needs and costs
 * landform; narrower and the yard hangs off the back of the beach onto the
 * bluff, which is exactly the state this replaced.
 */
export const TERRAIN_SEA_BEACH_RUN = 40;

/**
 * Rise/run of the cone behind the beach.
 *
 * Steeper than the old single cone on purpose. This is a CEILING, so a steep
 * value clamps LESS ground, not more: past the beach the map is supposed to be
 * the map again, and every metre the old 0.26 cone spent climbing back to
 * `TERRAIN_MAX_HEIGHT` was a terrace face it had deleted on the way.
 *
 * `atan(0.45)` is 0.42 rad — above `ROUGH_SLOPE` (0.28) and well under
 * `CLIFF_SLOPE` (0.62), so a bluff carved by this is rough ground a tank pays
 * to cross and never an impassable wall. Total profile reach is
 * `RUN + (TERRAIN_MAX_HEIGHT - WATER_LEVEL - RUN * BEACH) / BLUFF` ~ 78 m,
 * against ~85 m for the single 0.26 cone it replaces.
 */
export const TERRAIN_SEA_BLUFF_GRADE = 0.45;

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

/**
 * Metres of water a shoal must leave over itself.
 *
 * A shoal that dries is a fifth island: it splits the sea, it grows a beach
 * cone, `waterGrid` clears there and the nav grid stops routing a hull across
 * something the eye reads as shallows. So the lift is CLAMPED rather than
 * trusted to the authored `depth`, and this is the clamp. 0.35 m sits under
 * WATER_LEVEL by enough that no coastal wander can lift a bar out.
 */
export const TERRAIN_SEA_SHOAL_MIN_DEPTH = 0.35;

/**
 * Passable cells a start's own region must hold on an ARCHIPELAGO before the
 * generator stops calling it stranded.
 *
 * On every other map the start guarantee is "joined to the MAIN region", and
 * that is right: a shelf outside it is a pit. On an island map it is exactly
 * wrong — three of four starts are water-separated BY DESIGN, and
 * `enforceStartAreas` would answer a correct map by BFS-ing a corridor through
 * the sea and raising a causeway across it (`linkRegionForced` leaves `dryOnly`
 * off there deliberately, because for a pit a causeway beats an immobile army).
 *
 * DERIVED FROM THE GUARANTEE ITSELF rather than picked: it is the cell count of
 * the guarded disc, so the rule reads "an island start is satisfied when its
 * region is at least as large as the guarantee that was made about it". A
 * genuine pit is orders of magnitude smaller and still escalates.
 */
export const TERRAIN_ISLAND_MIN_CELLS = Math.ceil(
  Math.PI * (TERRAIN_START_GUARD_RADIUS / CELL) * (TERRAIN_START_GUARD_RADIUS / CELL),
);

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

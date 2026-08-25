/**
 * ============================================================================
 * VOLTMARCH — src/world/terrain-gen.ts
 * ============================================================================
 * THE HEIGHTFIELD AND THE NAV GRIDS, WITH NO RENDERER ANYWHERE NEAR THEM.
 *
 * This file was `Terrain.ts` until the generator moved off the main thread. It
 * is now the half of that module a Web Worker can run: every array, every pass
 * of the generation pipeline, and the whole query API. `Terrain.ts` is what is
 * left — a subclass that adds a scene, two splat textures and the chunk meshes.
 *
 * NOTHING HERE MAY IMPORT THREE, AND NOTHING HERE MAY IMPORT `src/render/**` OR
 * `src/game/**`. Vite emits the worker's import graph as its own chunk, so a
 * stray `three` import would put ~700 kB of renderer in a worker that draws
 * nothing — the same rule `src/core/surfaces.ts` and `src/art/greeble-gen.ts`
 * live under, and `tests/world-workers.spec.ts` walks this graph and fails on a
 * violation rather than leaving it to a reviewer.
 *
 * WHY A BASE CLASS AND NOT A PURE FUNCTION. `greeble-gen.ts` could be a
 * function because an atlas is data that is produced once and then owned by the
 * texture. A terrain is not: eight modules query it for the whole match
 * (`heightAt`, `isPassable`, `raycastGround`, `stampSurface`), and those queries
 * read the same arrays the generator writes. Splitting them would have meant
 * either a second copy of every array or twenty delegating methods on
 * `Terrain`. Inheritance keeps `this.height` meaning one thing in both files.
 *
 * THE WORKER CONTRACT IS `generateTerrainFields` + `adopt`. The worker builds a
 * `TerrainFields`, generates, and posts `snapshot()` back as transferable typed
 * arrays; the main thread's `Terrain` calls `adopt()` instead of `generate()`
 * and is byte-identical by construction — there is one implementation of every
 * pass and both paths run it. `tests/world-workers.spec.ts` measures that claim
 * rather than assuming it.
 *
 * Eight other modules read this file's query API and nothing else about it, so
 * the API is the contract and the rest is implementation. It implements
 * `ITerrain` from core/types.ts and installs itself as `world.terrain`.
 *
 * THE SHAPE DECISION (this is the whole module in one paragraph)
 * -------------------------------------------------------------
 * RA3 terrain is ARCHITECTURALLY AUTHORED, not eroded. Bible §6.4: playable
 * ground is essentially flat (+/-0.4-0.8 m of swell over 15-30 m), and every
 * piece of meaningful relief is a DISCRETE TERRACE 4-8 m tall with 2-4 tiers
 * per map. Scorecard #35 fails smooth Perlin hills explicitly. So the
 * generator does not produce a height — it produces a TIER POTENTIAL, hard
 * quantises it, and lays the gentle swell on top. The quantisation width is
 * adapted to the local gradient so the resulting face is ~1.2 m of horizontal
 * run whatever the potential's slope, which at a 6 m step is a 79 degree wall:
 * inside the bible's 78-88 degree band, every time, everywhere on the map.
 *
 * WHY THE MAP EDGE IS HIGH
 * ------------------------
 * The tier potential is blended toward 1.0 at the map rim (`BiomeDef.edgeBias`).
 * That is a look decision AND a playability decision: it guarantees the middle
 * of the map is one contiguous low plateau — 200 units can always reach each
 * other — and it puts the rocky massifs around the border, which is how RA3's
 * own maps are composed. Interior mesas still appear from the noise; anything
 * they strand is reconnected by the ramp carver below.
 *
 * THE RAMP CARVER
 * ---------------
 * A procedural terrain that quietly cuts the map into islands is a silent,
 * total failure for pathfinding, the AI and the economy. So after the
 * heightfield is built we label connected passable regions, and for every
 * stranded region above `TERRAIN_MIN_REGION_CELLS` we cut an explicit ramp at
 * a legal grade between it and the main landmass. Bible §6.4 allows exactly
 * this ("no ramps except explicit built ones") and the carved corridors are
 * marked as dirt track in the splat so they read as authored.
 *
 * RESERVED START AREAS — AND WHY THE CARVER ALONE WAS NOT ENOUGH
 * -------------------------------------------------------------
 * The carver's economy rules (skip regions under 28 cells, give up past a
 * 13-cell link or a 52 m ramp, stop at 30 ramps) are all defensible for a ledge
 * on a distant hillside. They were a BUG under an army: a real match spawned
 * tanks into a valley pocket they could never leave, and 33 of 40 biome/seed
 * combinations put stranded pockets inside the 48 m the scenarios spawn into.
 * Every one of those pockets was smaller than 28 cells, i.e. skipped on purpose.
 *
 * The fix is the one every shipped RTS map uses: start positions are RESERVED,
 * not rolled. `levelStartAreas()` runs between the heightfield and the
 * classification pass and levels each start location into a shelf — a dead-flat
 * core out to `TERRAIN_START_FLAT_RADIUS` carrying only a residual swell, then
 * an apron that clamps the natural height into a `TERRAIN_START_APRON_GRADE`
 * cone until the landform is close enough to resume untouched. The clamp is
 * what makes it read as a natural basin rather than a stamped disc: the apron
 * binds at a different distance in every direction, and the rim itself wanders
 * outward on a long-wavelength noise.
 *
 * Then three guarantees are enforced rather than assumed:
 *
 *  1. `ensureConnectivity` does not apply the minimum-region skip to any region
 *     holding a guarded start cell, and such regions draw on their own ramp
 *     budget so the global cap cannot cancel the guarantee.
 *  2. `enforceStartAreas` re-labels the grid AFTER the carver and escalates on
 *     anything still stranded inside a guard radius: a wider bounded link, then
 *     a forced BFS-shortest corridor with the length cap lifted, then as a last
 *     resort raising the pocket to its own rim so the trap stops existing.
 *  3. `prunePockets` marks every remaining tiny unreachable region impassable,
 *     OUTSIDE the start areas only. A 6-cell ledge no unit can reach is scenery;
 *     leaving it flagged passable only produces "move here" orders that can
 *     never complete.
 *
 * PERFORMANCE SHAPE
 * -----------------
 * 8x8 chunks of 64 m at a 1 m grid, 8192 triangles each, ONE material (the
 * ground/cliff split is a per-triangle branch inside the shader, not a second
 * draw — see TerrainMaterial.ts). Chunks with no real relief are kept out of
 * the shadow map entirely, and since v2.11 they also get a SECOND index buffer
 * at half resolution — 2424 triangles over the same vertices, chosen here and
 * drawn by `Terrain.buildMeshes` without a runtime switch. See
 * `buildChunkLodIndex`, which is where the T-junction cracks are excluded.
 *
 * **BE HONEST ABOUT WHAT THAT IS WORTH.** The gate is measured, not hoped at:
 * across the ten shipped battlefields and the four `?shot=` seas, between 4 and
 * 23 of the 64 chunks qualify, and on the landform ten of the thirteen capture
 * fixtures stand on it is FOUR. The generator's own edge bias raises the map
 * rim and its terrace quantiser is what produces relief in the middle, so a
 * genuinely flat 64 m square is rare by construction. The remaining headroom is
 * not in a better threshold — it is in decimating PER COARSE CELL rather than
 * per chunk, which the fan stitch in `buildChunkLodIndex` would already
 * support, at the cost of a variable index length the wire guard can no longer
 * check exactly.
 *
 * Nothing here allocates after `generate()` returns — every query path writes
 * into a caller-supplied array.
 * ============================================================================
 */

import {
  CELL, CLIFF_SLOPE, MAP_CELLS, MAP_CELL_COUNT, MAP_SIZE, ROUGH_SLOPE,
  TERRAIN_BORDER_CELLS, TERRAIN_BUILD_FLATNESS, TERRAIN_CHUNK_METRES,
  TERRAIN_GRID, TERRAIN_GROUND_NORMAL_CLAMP,
  TERRAIN_MAIN_REGION_SHARE, TERRAIN_MAJOR_ENFORCE_PASSES, TERRAIN_MAJOR_MAX_RAMPS,
  TERRAIN_MAX_HEIGHT, TERRAIN_MAX_RAMPS, TERRAIN_MIN_REGION_CELLS,
  TERRAIN_PRUNE_REGION_CELLS, TERRAIN_RAMP_CORE_WIDTH, TERRAIN_RAMP_HALF_WIDTH,
  TERRAIN_RAMP_FORCED_CORE_WIDTH, TERRAIN_RAMP_FORCED_HALF_WIDTH,
  TERRAIN_RAMP_MAX_GRADE, TERRAIN_RAMP_MAX_LENGTH, TERRAIN_RAMP_MAX_LINK_CELLS,
  TERRAIN_ISLAND_MIN_CELLS, TERRAIN_LOD_MAX_ERROR, TERRAIN_SHADOW_CLIFF_FRACTION,
  TERRAIN_SEA_BEACH_GRADE, TERRAIN_SEA_BEACH_RUN, TERRAIN_SEA_BLUFF_GRADE,
  TERRAIN_SEA_FLOOR, TERRAIN_SEA_SHOAL_MIN_DEPTH,
  TERRAIN_SEA_START_CLEARANCE,
  TERRAIN_SPLAT_PER_CELL, TERRAIN_START_APRON_GRADE, TERRAIN_START_DRY_MARGIN,
  TERRAIN_START_EDGE_WOBBLE, TERRAIN_START_ENFORCE_PASSES,
  TERRAIN_START_FLAT_RADIUS, TERRAIN_START_GUARD_RADIUS,
  TERRAIN_START_MAX_RAMPS, TERRAIN_START_POSITIONS, TERRAIN_START_SWELL,
  TERRAIN_START_WOBBLE_METRES, WATER_LEVEL,
  type SeaIsland, type SeaShoal, type SeaSpec,
} from '../core/config';
import { Locomotor, type EntityId, type ITerrain } from '../core/types';
import { clamp, clamp01, fbm2, isInMap, lerp, simplex2, smoothstep } from '../core/math';
import { SurfaceId, getBiome, type BiomeDef, type BiomeName } from './Biomes';

/* ==========================================================================
 * 1. DERIVED LAYOUT CONSTANTS
 * ========================================================================== */

/** Metres between heightfield samples. */
export const GRID = TERRAIN_GRID;
export const INV_GRID = 1 / GRID;
/** Heightfield quads along one axis (512). */
export const GRID_N = Math.round(MAP_SIZE / GRID);
/** Heightfield samples along one axis (513). */
export const GRID_STRIDE = GRID_N + 1;
/** Total heightfield samples. */
export const GRID_COUNT = GRID_STRIDE * GRID_STRIDE;
/** Chunks along one axis (8). */
export const CHUNK_N = Math.round(MAP_SIZE / TERRAIN_CHUNK_METRES);
/** Heightfield quads along one chunk edge (64). */
export const CHUNK_QUADS = Math.round(TERRAIN_CHUNK_METRES / GRID);
/** Chunk meshes in a map (64). */
export const TERRAIN_CHUNKS = CHUNK_N * CHUNK_N;
/** Vertices in one chunk mesh (65 * 65). */
export const CHUNK_VERTS = (CHUNK_QUADS + 1) * (CHUNK_QUADS + 1);
/** Index entries in one chunk mesh. */
export const CHUNK_INDICES = CHUNK_QUADS * CHUNK_QUADS * 6;
/** Coarse quads along one chunk edge in the half-resolution index (32). */
export const CHUNK_LOD_QUADS = CHUNK_QUADS >> 1;
/**
 * Index entries in one chunk's HALF-RESOLUTION mesh, and the arithmetic is the
 * whole of the crack strategy — see `buildChunkLodIndex`.
 *
 * A coarse cell is 2x2 fine quads. The ones that do not touch the chunk edge
 * are two triangles. The ones that DO keep the fine vertex in the middle of
 * every edge they share with a neighbouring chunk, so they are fanned from the
 * cell's own centre sample: five triangles along an edge, six in a corner.
 * 2424 triangles against the full mesh's 8192, i.e. 70.4% fewer.
 */
export const CHUNK_LOD_INDICES = (
  (CHUNK_LOD_QUADS - 2) * (CHUNK_LOD_QUADS - 2) * 2
  + 4 * (CHUNK_LOD_QUADS - 2) * 5
  + 4 * 6
) * 3;
/** Splat control texels along one axis (256). */
export const SPLAT_N = MAP_CELLS * TERRAIN_SPLAT_PER_CELL;
/** Bytes in one splat control texture. The wire guard checks against this. */
export const SPLAT_BYTES = SPLAT_N * SPLAT_N * 4;
/** Metres per splat texel (2). */
const SPLAT_METRES = MAP_SIZE / SPLAT_N;
/**
 * Buckets in `TerrainFields.patchQuantile`'s histogram of a patch noise field.
 *
 * 4096 over a [0,1] field is a raw quantile error of 2.4e-4, against a
 * smoothstep halo of 0.07 that spans 287 of them. Deliberately a power of two
 * so `(v * bins) | 0` is exact.
 */
const PATCH_QUANTILE_BINS = 4096;
/** Heightfield samples per build cell (4). */
const SAMPLES_PER_CELL = Math.round(CELL / GRID);
/** Face-normal Y below which a triangle is a cliff, not ground. */
export const CLIFF_NY = Math.cos(CLIFF_SLOPE);

/* ==========================================================================
 * 1b. THE ELLIPSE DISTANCE, WHICH IS THE WHOLE OF THE ISLAND GEOMETRY
 * ========================================================================== */

/**
 * Signed metres from `(x, z)` to the boundary of an axis-aligned ellipse.
 * Negative inside, positive outside. EXACT for a circle, first-order for an
 * ellipse.
 *
 * WHY NOT THE EXACT ELLIPSE DISTANCE. It has no closed form — every accurate
 * implementation is a Newton iteration, which is both slower per sample (this
 * runs 263 k times per island per generation) and a determinism liability,
 * since an iteration count that depends on a convergence test can differ under
 * a different rounding.
 *
 * WHAT THIS IS INSTEAD. `q` is the normalised radius: 1 exactly on the
 * boundary, whatever the eccentricity. Dividing `q - 1` by the magnitude of its
 * own gradient converts that dimensionless excess into metres — the standard
 * first-order (Sampson) distance. For `radiusX === radiusZ` it reduces
 * ALGEBRAICALLY to `|p - c| - r`, i.e. it is not an approximation at all for
 * the circle case, and at the eccentricities an island is authored at (well
 * under 2:1) the error is a fraction of a metre against a coastline that
 * deliberately wanders by 8.
 *
 * The error direction is also the safe one: it under-reports distance near the
 * flat side of an ellipse, so a start-shelf budget checked against it is
 * conservative rather than optimistic.
 *
 * Only `+ - * /` and `Math.sqrt`, all of which ECMA-262 pins exactly. See the
 * note above `SeaIsland` for why that matters.
 */
function ellipseDistance(
  x: number, z: number, cx: number, cz: number, rx: number, rz: number,
): number {
  const dx = x - cx;
  const dz = z - cz;
  const a = dx / rx;
  const b = dz / rz;
  const q = Math.sqrt(a * a + b * b);
  // Dead centre: the gradient is undefined and the answer is the inscribed
  // radius. Reached by `resolveStarts`, which asks about the island's own
  // centre on every archipelago.
  if (q < 1e-9) return -(rx < rz ? rx : rz);
  const gx = a / rx;
  const gz = b / rz;
  return ((q - 1) * q) / Math.sqrt(gx * gx + gz * gz);
}

/**
 * Signed metres to the nearest island coast, negative on land.
 *
 * The union of solids is the MINIMUM of their signed distances — that identity
 * is the entire reason an archipelago needs no code of its own downstream.
 */
function islandDistance(x: number, z: number, islands: readonly SeaIsland[]): number {
  let best = Infinity;
  for (let i = 0; i < islands.length; i++) {
    const isl = islands[i];
    const d = ellipseDistance(x, z, isl.x, isl.z, isl.radiusX, isl.radiusZ);
    if (d < best) best = d;
  }
  return best;
}

/** True when this spec carves an archipelago rather than a coast. */
function hasIslands(sea: SeaSpec | null): sea is SeaSpec & { islands: readonly SeaIsland[] } {
  return sea !== null && sea.islands !== undefined && sea.islands.length > 0;
}

/** True when this spec raises any shallows. */
function hasShoals(sea: SeaSpec | null): sea is SeaSpec & { shoals: readonly SeaShoal[] } {
  return sea !== null && sea.shoals !== undefined && sea.shoals.length > 0;
}

/**
 * Scratch for `seaGradient`. Module-level and reused: `resolveStarts` is not a
 * hot path, but this file's rule is that no query path allocates, and a
 * two-element output array per start is exactly the shape that rule exists for.
 */
const SEA_DIR = new Float64Array(2);

/**
 * Passability bitmask, one bit per `Locomotor`. Exposed raw as
 * `Terrain.passGrid` so the pathfinder can read a Uint8Array directly instead
 * of paying a virtual call 16384 times per flow field.
 */
export const PASS_FOOT = 1 << Locomotor.Foot;
export const PASS_TRACK = 1 << Locomotor.Track;
export const PASS_WHEEL = 1 << Locomotor.Wheel;
export const PASS_HOVER = 1 << Locomotor.Hover;
export const PASS_STATIC = 1 << Locomotor.Static;
/** Everything that drives or walks on dry land. */
export const PASS_GROUND = PASS_FOOT | PASS_TRACK | PASS_WHEEL;

/** `costGrid` is fixed point: 100 == 1.0x movement cost. */
export const COST_UNIT = 100;
/** Cost written for a cell nothing can enter. */
export const COST_BLOCKED = 255;

/* ==========================================================================
 * 2. TERRAIN
 * ========================================================================== */

/**
 * Everything the generator needs, and nothing a renderer would add.
 *
 * This is the exact payload the worker job carries, so every field has to
 * survive `structuredClone`: numbers, strings, plain objects and arrays only.
 * `Terrain.ts` extends it with `scene` and `anisotropy`, which do not.
 */
export interface TerrainGenOptions {
  /** Landform seed. Same seed + same biome => byte-identical map. */
  seed: number;
  biome: BiomeName | string;
  /**
   * World-space start locations to reserve a levelled, connected shelf around.
   * Omit and the generator uses `TERRAIN_START_POSITIONS`. Skirmish will pass
   * its own set once there is more than one player start.
   */
  starts?: readonly StartPoint[];
  /**
   * A sea to carve, in world metres. `null` (or omitted) is a landlocked map.
   *
   * `Terrain.ts` fills this in from the `setPlannedSea()` channel when its
   * caller does not name one; down here it is always explicit, because a worker
   * has no module-level channel to read.
   */
  sea?: SeaSpec | null;
}

/**
 * The bytes `generate()` produces. Everything a `Terrain` needs in order to
 * skip generation entirely and go straight to building meshes.
 *
 * Every array is the generator's OWN array, handed over rather than copied —
 * `terrainFieldTransfers` lists the buffers for `postMessage`. On the main
 * thread `adopt()` copies them in, because the live arrays are `readonly` class
 * fields that eight other modules already hold references to.
 */
export interface TerrainFieldData {
  /** Identifies the inputs these fields were generated from. See `terrainGenKey`. */
  readonly key: string;
  readonly height: Float32Array;
  readonly slope: Float32Array;
  readonly wallUp: Float32Array;
  readonly wallTop: Float32Array;
  readonly cellHeight: Float32Array;
  readonly cellSlope: Float32Array;
  readonly surface: Uint8Array;
  readonly passGrid: Uint8Array;
  readonly costGrid: Uint8Array;
  readonly buildGrid: Uint8Array;
  readonly waterGrid: Uint8Array;
  readonly rampGrid: Uint8Array;
  readonly startMask: Uint8Array;
  readonly splatA: Uint8Array;
  readonly splatB: Uint8Array;
  readonly shelves: readonly StartArea[];
  readonly report: StartAreaReport;
  readonly rampsCarved: number;
  /** Vertex attributes for the 8x8 chunk meshes. See `buildTerrainChunks`. */
  readonly chunks: readonly TerrainChunkData[];
  /** Wall-clock milliseconds the generation itself took, measured where it ran. */
  readonly generateMs: number;
}

/**
 * One chunk mesh's attributes, as raw arrays.
 *
 * THIS IS HALF THE COST OF A TERRAIN, and it was the half that stayed on the
 * main thread the first time round: with generation moved to a worker,
 * `world.terrain`'s init still stopped the boot for ~330 ms, and all of it was
 * here. 64 chunks of 65x65 vertices is 270 k positions, 270 k normals and
 * 524 k triangles fed through a steepness test.
 *
 * None of that needs a renderer — it is arithmetic over the heightfield — so it
 * runs in the worker too and `Terrain.buildMeshes` is reduced to wrapping these
 * arrays in `BufferGeometry`, which is the only part that genuinely needs THREE.
 */
export interface TerrainChunkData {
  readonly cx: number;
  readonly cz: number;
  /** xyz per vertex, chunk-local. */
  readonly position: Float32Array;
  /** xyz per vertex, from the CLAMPED gradient — see `buildTerrainChunks`. */
  readonly normal: Float32Array;
  /** `aUp` attribute: metres above the foot of the local terrace face, 0..1. */
  readonly up: Float32Array;
  /** `aTop` attribute: metres below the lip of the local terrace face, 0..1. */
  readonly top: Float32Array;
  readonly index: Uint16Array;
  /**
   * A SECOND index over the SAME vertices at half resolution, or null when this
   * chunk holds enough relief that decimating it would show.
   *
   * `Terrain.buildMeshes` draws this one when it exists. The vertex buffer is
   * untouched either way — nothing is re-derived, nothing is uploaded twice,
   * and the choice is made once at generation time. See `buildChunkLodIndex`
   * for why it cannot crack against a full-resolution neighbour, and
   * `TERRAIN_LOD_MAX_ERROR` for what "enough relief" is measured as.
   */
  readonly lodIndex: Uint16Array | null;
  /** Triangles steeper than `CLIFF_SLOPE`. Decides whether the chunk casts. */
  readonly cliffTris: number;
  /**
   * Metres of height error the half-resolution index would introduce, measured
   * over every sample it drops. Reported whether or not the chunk qualified, so
   * the decision is auditable from a field set rather than only reproducible.
   */
  readonly lodError: number;
}

/** A world position the generator must guarantee an army can spawn on. */
export interface StartPoint {
  readonly x: number;
  readonly z: number;
}

/** One reserved start location and the radius its guarantee covers. */
export interface StartArea extends StartPoint {
  /** Metres of flat, dry, buildable, main-region-connected ground. */
  readonly radius: number;
  /** The elevation the shelf was levelled to, in metres. */
  readonly height: number;
}

/** What the start-area guarantee had to do this generation. For the boot log. */
export interface StartAreaReport {
  /** Start locations reserved. */
  areas: number;
  /** Ramps the carver cut specifically to reach a start region. */
  startRamps: number;
  /** Forced (length-cap lifted) corridors the escalation had to cut. */
  forcedRamps: number;
  /** Pockets raised to their own rim because no corridor could reach them. */
  filled: number;
  /** Cells demoted to scenery because nothing could ever reach them. */
  pruned: number;
  /** Guarded cells STILL not joined to the main region. Must be 0. */
  stranded: number;
  /** Corridors cut to reclaim a large stranded plateau. */
  majorRamps: number;
  /**
   * Large stranded regions the major pass could NOT reclaim — almost always an
   * island, where refusing is the correct answer. Not a failure on its own.
   */
  majorSkipped: number;
}

export class TerrainFields implements ITerrain {
  /* -- heightfield (grid resolution, GRID_STRIDE^2) ---------------------- */

  /** Metres above y=0 at each grid sample. */
  readonly height = new Float32Array(GRID_COUNT);
  /** Slope in radians at each grid sample, from the RAW (unclamped) gradient. */
  readonly slope = new Float32Array(GRID_COUNT);
  /**
   * Metres above the foot of the local terrace face, divided by the step
   * height and clamped to 0..1. Feeds the cliff shader's scree skirt.
   */
  readonly wallUp = new Float32Array(GRID_COUNT);
  /**
   * Metres below the lip of the local terrace face, same normalisation. Feeds
   * the coping cap and the overhang shadow.
   */
  readonly wallTop = new Float32Array(GRID_COUNT);

  /* -- per build cell (MAP_CELLS^2) -------------------------------------- */

  /** Height at the cell centre. */
  readonly cellHeight = new Float32Array(MAP_CELL_COUNT);
  /** MAX slope anywhere in the cell — a cell holding a wall is never passable. */
  readonly cellSlope = new Float32Array(MAP_CELL_COUNT);
  /** Dominant `SurfaceId`. */
  readonly surface = new Uint8Array(MAP_CELL_COUNT);
  /** Locomotor bitmask. THE array the pathfinder reads. */
  readonly passGrid = new Uint8Array(MAP_CELL_COUNT);
  /** Movement cost, `COST_UNIT` == 1.0x, `COST_BLOCKED` == impassable. */
  readonly costGrid = new Uint8Array(MAP_CELL_COUNT);
  /** 1 where a structure may be founded (before occupancy). */
  readonly buildGrid = new Uint8Array(MAP_CELL_COUNT);
  /** 1 where the cell centre is below WATER_LEVEL. */
  readonly waterGrid = new Uint8Array(MAP_CELL_COUNT);
  /** 1 where the connectivity carver cut a ramp. */
  readonly rampGrid = new Uint8Array(MAP_CELL_COUNT);

  /** EntityId of the structure standing on a cell, or 0. */
  private readonly occupant = new Int32Array(MAP_CELL_COUNT);
  private version = 0;

  /* -- splat control ------------------------------------------------------ */

  /** RGBA = weights of layers 0..3 (ground, dirt, sand, rock). */
  protected readonly splatA = new Uint8Array(SPLAT_N * SPLAT_N * 4);
  /** RG = weights of layers 4..5 (concrete, paving). */
  protected readonly splatB = new Uint8Array(SPLAT_N * SPLAT_N * 4);

  /* -- state -------------------------------------------------------------- */

  protected seed: number;
  protected biomeDef: BiomeDef;
  private rampsCarved = 0;

  /** The sea this map carries, or null for a landlocked map. */
  private sea: SeaSpec | null = null;
  /**
   * The start locations as REQUESTED, before any sea pushed them inland.
   * Kept so `setSea` can re-resolve them without the caller re-stating them.
   */
  protected startRequest: readonly StartPoint[] | undefined = undefined;
  /** Start locations this terrain will reserve, in world metres. */
  private readonly startPoints: StartPoint[] = [];
  /** The reserved shelves, filled in by `levelStartAreas`. */
  private readonly startShelves: StartArea[] = [];
  /** 1 where a cell centre sits inside some start guarantee radius. */
  private readonly startMask = new Uint8Array(MAP_CELL_COUNT);
  /** What the guarantee cost this generation. */
  private readonly report: StartAreaReport = {
    areas: 0, startRamps: 0, forcedRamps: 0, filled: 0, pruned: 0, stranded: 0,
    majorRamps: 0, majorSkipped: 0,
  };

  /** Scratch reused by the region labeller. Never escapes. */
  private readonly regionId = new Int32Array(MAP_CELL_COUNT);
  private readonly regionStack = new Int32Array(MAP_CELL_COUNT);
  /** Scratch for the escalation BFS: step count and originating main-region cell. */
  private readonly bfsDist = new Int32Array(MAP_CELL_COUNT);
  private readonly bfsFrom = new Int32Array(MAP_CELL_COUNT);
  private readonly bfsQueue = new Int32Array(MAP_CELL_COUNT);
  /** Region ids that hold a guarded start cell but are not the main region. */
  private readonly strandedStarts: number[] = [];
  /** Scratch for the potential field during generation. */
  private readonly potential = new Float32Array(GRID_COUNT);
  /** Scratch for the separable min/max window that measures terrace faces. */
  private readonly windowLo = new Float32Array(GRID_COUNT);
  private readonly windowHi = new Float32Array(GRID_COUNT);

  /**
   * DELIBERATELY DOES NOT GENERATE.
   *
   * `Terrain`'s constructor has to build its materials and splat textures before
   * anything can be drawn with them, and `buildMeshes()` runs at the end of
   * `generate()`. So the base sets up state only, and whoever constructed it
   * decides between `generate()` and `adopt()` — which is exactly the fork the
   * worker path needs.
   */
  constructor(options: TerrainGenOptions) {
    this.seed = options.seed | 0;
    this.biomeDef = getBiome(options.biome);
    // BEFORE setStarts: a sea moves the start points, so it has to be known
    // before they are resolved.
    this.sea = options.sea ?? null;
    this.setStarts(options.starts);
  }

  /** The active biome record. */
  get biome(): BiomeDef {
    return this.biomeDef;
  }

  /** The active biome key, for scenario save/load and the debug overlay. */
  get biomeKey(): BiomeName {
    return this.biomeDef.key;
  }

  /* ======================================================================
   * 3. GENERATION
   * ====================================================================== */

  /**
   * Rebuild everything from `seed` + `biome`. Deterministic and pure: two
   * calls with the same inputs produce byte-identical grids, which is what
   * makes the screenshot harness diffable.
   */
  generate(): void {
    this.rampsCarved = 0;
    this.report.startRamps = 0;
    this.report.forcedRamps = 0;
    this.report.filled = 0;
    this.report.pruned = 0;
    this.report.stranded = 0;
    this.report.majorRamps = 0;
    this.report.majorSkipped = 0;
    this.report.areas = this.startPoints.length;

    this.buildStartMask();
    this.buildPotential();
    this.buildHeightfield();
    // Before classification, so `computeDerived` sees the levelled shelf and
    // never marks a start cell as cliff, water or unbuildable in the first
    // place. Reserving after the fact would mean re-deriving everything twice.
    this.levelStartAreas();
    // The shelf's apron is a two-sided clamp and can raise ground. Re-assert
    // the bed before anything is classified, or a rim wobble dries the coast.
    // No-op on a landlocked map.
    this.carveSea();
    this.computeDerived();
    this.ensureConnectivity();
    this.carveSea();
    this.computeDerived();
    // Trust nothing: measure the guarantee and escalate until it holds.
    this.enforceStartAreas();
    // Then the same treatment for the map as a whole. Must run BEFORE
    // prunePockets, because pruning is the last word on passGrid and any
    // computeDerived after it would rebuild the grid and undo it.
    this.ensureMajorRegions();
    this.prunePockets();
    this.buildSplat();
    this.buildMeshes();
    this.logStartAreas();
  }

  /**
   * Chunk attributes handed over by a worker, waiting for `buildMeshes` to wrap
   * them. Null means "derive them from the heightfield here".
   */
  protected adoptedChunks: readonly TerrainChunkData[] | null = null;

  /**
   * The renderer's half of `generate()`. A no-op down here and overridden by
   * `Terrain`, which is what makes the pipeline above runnable in a worker
   * without a single `if (typeof THREE)` in it.
   */
  protected buildMeshes(): void {
    // Nothing to draw without a renderer, but the adopted set must still be
    // released — holding ~12 MB of attribute arrays alive on a headless
    // instance would be a leak nobody would ever look for.
    this.adoptedChunks = null;
  }

  /**
   * Upload the splat control textures. Same shape as `buildMeshes`: a no-op in
   * the generator, real work in `Terrain`. It is public because the road and
   * building-pad modules call it after a batch of `stampSurface`.
   */
  commitSplat(): void { /* no textures without a renderer */ }

  /** Push a biome change into the materials. Overridden by `Terrain`. */
  protected applyBiomeToMaterials(_biome: BiomeDef): void { /* no materials here */ }

  /**
   * Everything `generate()` produced, as the generator's OWN arrays.
   *
   * The arrays are handed over, not copied: the caller is a worker that is about
   * to transfer them and then be reused for the next job, so a copy here would
   * be pure cost. Nothing may call this and then keep using the instance.
   */
  snapshot(
    key: string, chunks: readonly TerrainChunkData[], generateMs: number,
  ): TerrainFieldData {
    return {
      key,
      chunks,
      height: this.height,
      slope: this.slope,
      wallUp: this.wallUp,
      wallTop: this.wallTop,
      cellHeight: this.cellHeight,
      cellSlope: this.cellSlope,
      surface: this.surface,
      passGrid: this.passGrid,
      costGrid: this.costGrid,
      buildGrid: this.buildGrid,
      waterGrid: this.waterGrid,
      rampGrid: this.rampGrid,
      startMask: this.startMask,
      splatA: this.splatA,
      splatB: this.splatB,
      shelves: this.startShelves.map((s) => ({ ...s })),
      report: { ...this.report },
      rampsCarved: this.rampsCarved,
      generateMs,
    };
  }

  /**
   * Take a generated field set instead of generating one, then finish exactly
   * as `generate()` does — meshes, then the start-area log.
   *
   * COPIES rather than adopts the buffers. `height`, `passGrid` and the rest are
   * `readonly` fields that `Movement`, `Flowfield`, `Roads` and `Scatter` hold
   * direct references to; swapping the reference would leave every one of them
   * reading a dead array. Six MB of `set()` is about a millisecond, against the
   * ~600 the generation would have cost.
   */
  adopt(data: TerrainFieldData): void {
    // Consumed by `buildMeshes` below and cleared there, so a later
    // `setBiome()` re-derives rather than re-drawing a stale set.
    this.adoptedChunks = data.chunks;
    this.height.set(data.height);
    this.slope.set(data.slope);
    this.wallUp.set(data.wallUp);
    this.wallTop.set(data.wallTop);
    this.cellHeight.set(data.cellHeight);
    this.cellSlope.set(data.cellSlope);
    this.surface.set(data.surface);
    this.passGrid.set(data.passGrid);
    this.costGrid.set(data.costGrid);
    this.buildGrid.set(data.buildGrid);
    this.waterGrid.set(data.waterGrid);
    this.rampGrid.set(data.rampGrid);
    this.startMask.set(data.startMask);
    this.splatA.set(data.splatA);
    this.splatB.set(data.splatB);

    this.startShelves.length = 0;
    for (const s of data.shelves) this.startShelves.push({ ...s });
    Object.assign(this.report, data.report);
    this.rampsCarved = data.rampsCarved;

    this.buildMeshes();
    this.commitSplat();
    this.logStartAreas();
  }

  /**
   * Replace the start locations to reserve. Takes effect on the next
   * `generate()`; the constructor calls it before its own generate.
   */
  setStarts(starts: readonly StartPoint[] | undefined): void {
    this.startRequest = starts;
    this.resolveStarts();
  }

  /**
   * Turn the requested start locations into the ones that will actually be
   * reserved, pushing any that sit on (or too near) the declared sea inland.
   *
   * A start area is guaranteed FLAT, DRY and BUILDABLE and is levelled to at
   * least `WATER_LEVEL + TERRAIN_START_DRY_MARGIN`. Leave one over water and
   * the guarantee wins — `levelStartAreas` simply fills the sea in. That is
   * exactly what drowned `08-naval-water`: `TERRAIN_START_POSITIONS` reserves
   * one shelf at the map centre, which is the one spot every fixture frames.
   *
   * Sliding along `-normal` rather than searching keeps this deterministic and
   * keeps the shelf on the map's own diagonal, which is where the authored
   * balance put it.
   *
   * ON AN ARCHIPELAGO the same rule reads the same field and gets a different
   * answer for free: the signed distance is to the nearest island coast and the
   * slide is along that island's inward radial, so a start pushes toward its own
   * centre. A start authored AT the centre is already maximally inland and the
   * push is zero, which is the layout the archipelago actually ships — the check
   * still runs, because an island too small for the guarantee must move the
   * shelf rather than silently drown it.
   */
  private resolveStarts(): void {
    this.startPoints.length = 0;
    const raw: StartPoint[] = [];
    const starts = this.startRequest;
    if (starts !== undefined && starts.length > 0) {
      for (let i = 0; i < starts.length; i++) {
        raw.push({ x: clamp(starts[i].x, 0, MAP_SIZE), z: clamp(starts[i].z, 0, MAP_SIZE) });
      }
    } else {
      for (let i = 0; i < TERRAIN_START_POSITIONS.length; i++) {
        const f = TERRAIN_START_POSITIONS[i];
        raw.push({ x: f[0] * MAP_SIZE, z: f[1] * MAP_SIZE });
      }
    }

    const sea = this.sea;
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      if (sea === null) {
        this.startPoints.push(p);
        continue;
      }
      // How far inland the whole flat radius has to sit. `wavinessMetres` is
      // included because the waterline wanders that far toward the land.
      const want = -(TERRAIN_START_FLAT_RADIUS + TERRAIN_START_EDGE_WOBBLE
        + sea.bandWidth + sea.wavinessMetres + TERRAIN_SEA_START_CLEARANCE);
      // The RAW field, without the coastal wander — `wavinessMetres` is already
      // in the budget above, which is the same trade stated once instead of
      // sampled twice.
      const islands = sea.islands;
      const d = islands !== undefined && islands.length > 0
        ? islandDistance(p.x, p.z, islands)
        : (p.x - sea.x) * sea.normalX + (p.z - sea.z) * sea.normalZ;
      if (d <= want) {
        this.startPoints.push(p);
        continue;
      }
      const push = d - want;
      this.seaGradient(p.x, p.z, sea, SEA_DIR);
      this.startPoints.push({
        x: clamp(p.x - SEA_DIR[0] * push, 0, MAP_SIZE),
        z: clamp(p.z - SEA_DIR[1] * push, 0, MAP_SIZE),
      });
    }
    this.startShelves.length = 0;
  }

  /**
   * Declare (or clear) the sea and rebuild. Not a per-frame call — this is a
   * full regeneration, same cost as `setBiome`.
   */
  setSea(sea: SeaSpec | null): void {
    this.sea = sea;
    this.resolveStarts();
    this.rampGrid.fill(0);
    this.generate();
  }

  /** The sea this map carries, or null when it is landlocked. */
  get seaSpec(): SeaSpec | null {
    return this.sea;
  }

  /**
   * True when this map's land is a set of islands rather than one continent.
   *
   * Read by exactly the two passes that would otherwise "repair" an archipelago
   * into a continent. Both are inert on every map that does not declare
   * islands, which is every map shipped today.
   */
  private get archipelago(): boolean {
    return hasIslands(this.sea);
  }

  /**
   * True when a start's own region is a legitimate ISLAND rather than a pit.
   *
   * The start guarantee is "joined to the main region" everywhere else, and it
   * has to be — a shelf outside it is a trap. On an island map that same test
   * indicts three correct starts out of four, and the escalation behind it is
   * not a warning: `enforceStartAreas` reaches `linkRegionForced` with `dryOnly`
   * OFF, which BFSes through water and raises a causeway, and behind that
   * `fillRegion`, which would flatten a whole island to its rim. So the test is
   * widened rather than the escalation weakened.
   */
  private islandStartSatisfied(regionCells: number): boolean {
    return this.archipelago && regionCells >= TERRAIN_ISLAND_MIN_CELLS;
  }

  /**
   * Signed metres seaward of the declared waterline, with the coastal wander
   * already applied. Negative inland. `+Infinity` would be wrong for a
   * landlocked map, so callers must check `seaSpec` first; this returns
   * -Infinity there, which reads as "as far inland as it is possible to be".
   */
  private seaDistance(x: number, z: number, sea: SeaSpec): number {
    const wob = sea.wavinessMetres > 0
      ? fbm2(x / sea.wavelengthMetres, z / sea.wavelengthMetres, 3, 2.0, 0.5, this.seed + 4409)
        * sea.wavinessMetres
      : 0;
    // The islands REPLACE the half-plane rather than clipping it — see the note
    // on `SeaSpec.islands`. The same wander is added to either, which is what
    // keeps an island's coast from reading as an ellipse stencil for exactly the
    // reason a straight one read as a clipping plane.
    const islands = sea.islands;
    if (islands !== undefined && islands.length > 0) {
      return islandDistance(x, z, islands) + wob;
    }
    return (x - sea.x) * sea.normalX + (z - sea.z) * sea.normalZ + wob;
  }

  /**
   * Seaward unit direction at a point, written into `out` as [x, z].
   *
   * The gradient of `seaDistance`, which for a half-plane IS the normal — the
   * existing arithmetic, not a generalisation of it — and for an archipelago is
   * the outward radial of whichever island is nearest. `resolveStarts` slides a
   * shelf along the negative of this, so an island start moves toward its own
   * centre instead of along a normal that means nothing to it.
   *
   * Falls back to the declared normal when the point is dead centre of an
   * island, where the gradient does not exist. A start there is already as far
   * inland as that island can put it, so the push it feeds is zero anyway.
   */
  private seaGradient(x: number, z: number, sea: SeaSpec, out: Float64Array): void {
    out[0] = sea.normalX;
    out[1] = sea.normalZ;
    const islands = sea.islands;
    if (islands === undefined || islands.length === 0) return;

    let best = Infinity;
    let hit: SeaIsland | null = null;
    for (let i = 0; i < islands.length; i++) {
      const isl = islands[i];
      const d = ellipseDistance(x, z, isl.x, isl.z, isl.radiusX, isl.radiusZ);
      if (d < best) { best = d; hit = isl; }
    }
    if (hit === null) return;
    const gx = (x - hit.x) / (hit.radiusX * hit.radiusX);
    const gz = (z - hit.z) / (hit.radiusZ * hit.radiusZ);
    const len = Math.sqrt(gx * gx + gz * gz);
    if (!(len > 1e-9)) return;
    out[0] = gx / len;
    out[1] = gz / len;
  }

  /**
   * The highest the ground is allowed to be at a given distance offshore.
   *
   * Seaward it is the bed: WATER_LEVEL falling to `WATER_LEVEL - depth` over
   * `shelfMetres`, smoothstepped so the absorption gradient has a real ramp to
   * read rather than a step.
   *
   * Landward it is TWO cones, not one, and the break is the whole point. The
   * first `TERRAIN_SEA_BEACH_RUN` metres rise at this coast's `beachGrade`
   * (default `TERRAIN_SEA_BEACH_GRADE`), which is gentle enough that
   * `computeDerived` marks the beach BUILDABLE — that is what a Naval Yard
   * stands on. Behind it the ceiling turns up to `TERRAIN_SEA_BLUFF_GRADE` and
   * stops eating the landform: a ceiling that climbs faster clamps less. See
   * `TERRAIN_SEA_BEACH_GRADE` for the measurements both numbers were chosen on.
   *
   * Continuous at the break by construction (both branches are the same
   * value at `-d === run`), so there is no step for the normals to catch.
   */
  private seaCeiling(d: number, sea: SeaSpec): number {
    if (d <= 0) {
      const inland = -d;
      const beach = Math.min(inland, TERRAIN_SEA_BEACH_RUN);
      const bluff = inland - beach;
      return WATER_LEVEL
        + beach * (sea.beachGrade ?? TERRAIN_SEA_BEACH_GRADE)
        + bluff * TERRAIN_SEA_BLUFF_GRADE;
    }
    const t = clamp01(d / sea.shelfMetres);
    return WATER_LEVEL - sea.depth * (t * t * (3 - 2 * t));
  }

  /**
   * `seaCeiling` with the shoals applied. THE ONLY ceiling any caller uses, so
   * `buildHeightfield` and `carveSea` cannot disagree about where the bed is.
   *
   * They did, in the first draft of this, and the failure is worth recording:
   * `carveSea` runs after `levelStartAreas` and only ever LOWERS a declared sea
   * cell, so a shoal raised by `buildHeightfield` and unknown to `carveSea` was
   * cut straight back out. The reef existed for exactly one pass.
   *
   * A shoal LERPS the bed toward its own bar depth and is then clamped under
   * WATER_LEVEL, so it raises and never deepens, and never dries. Gated on
   * `d > 0` because on the land side the ceiling is the beach cone: lifting
   * that would be lowering a hillside into the sea.
   */
  private seaCeilingAt(x: number, z: number, d: number, sea: SeaSpec): number {
    const base = this.seaCeiling(d, sea);
    const shoals = sea.shoals;
    if (d <= 0 || shoals === undefined || shoals.length === 0) return base;

    let top = base;
    for (let i = 0; i < shoals.length; i++) {
      const s = shoals[i];
      const a = (x - s.x) / s.radiusX;
      const b = (z - s.z) / s.radiusZ;
      const q = Math.sqrt(a * a + b * b);
      if (q >= 1) continue;
      // Smoothstepped from the rim inward, so a bar tapers into the deep water
      // rather than standing on a lip the absorption ramp would read as a step.
      const t = 1 - q;
      const f = t * t * (3 - 2 * t);
      const lifted = base + (WATER_LEVEL - s.depth - base) * f;
      if (lifted > top) top = lifted;
    }
    const cap = WATER_LEVEL - TERRAIN_SEA_SHOAL_MIN_DEPTH;
    return top > cap ? cap : top;
  }

  /**
   * Re-assert the bed on the SEA SIDE ONLY.
   *
   * `buildHeightfield` already applies the full profile, so on a quiet seed
   * this changes nothing. It exists because `levelStartAreas` runs afterwards
   * and its apron is a two-sided clamp — it can RAISE ground that sits below
   * the cone — so an unlucky rim wobble could still dry a strip of coast. This
   * pass can only ever lower ground that the scenario declared to be sea, so it
   * cannot fight any land-side guarantee.
   */
  private carveSea(): void {
    const sea = this.sea;
    if (sea === null) return;
    const h = this.height;
    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const z = gz * GRID;
      const row = gz * GRID_STRIDE;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        const x = gx * GRID;
        const d = this.seaDistance(x, z, sea);
        if (d <= 0) continue;
        const ceil = this.seaCeilingAt(x, z, d, sea);
        const i = row + gx;
        // TERRAIN_SEA_FLOOR, not 0. This pass is the LAST word on sea cells and
        // is gated on `d > 0` above, so a negative floor here can only ever
        // deepen water the scenario explicitly declared — it cannot touch land,
        // and it cannot fight the start-area guarantee that runs before it.
        if (h[i] > ceil) h[i] = clamp(ceil, TERRAIN_SEA_FLOOR, TERRAIN_MAX_HEIGHT);
      }
    }
  }

  /**
   * The reserved start shelves, in world metres. Scenarios and skirmish setup
   * read this instead of assuming the middle of the map is standable.
   */
  startLocations(): readonly StartArea[] {
    return this.startShelves;
  }

  /** What the start-area guarantee cost this generation. */
  startReport(): Readonly<StartAreaReport> {
    return this.report;
  }

  /**
   * Map health, for the boot log and the F3 overlay. `reachable` is the
   * fraction of PASSABLE ground that the largest connected region holds — if
   * that is not 1.0 after generation, something is stranded and the AI will
   * eventually walk into it.
   */
  stats(): {
    passable: number; buildable: number; water: number; reachable: number;
    ramps: number; scenery: number; startsStranded: number; regions: number;
  } {
    let pass = 0;
    let build = 0;
    let water = 0;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      if ((this.passGrid[i] & PASS_TRACK) !== 0) pass++;
      if (this.buildGrid[i] !== 0) build++;
      if (this.waterGrid[i] !== 0) water++;
    }
    const sizes: number[] = [];
    const regions = this.labelRegions(sizes);
    let largest = 0;
    for (let k = 1; k <= regions; k++) if (sizes[k] > largest) largest = sizes[k];
    return {
      passable: pass / MAP_CELL_COUNT,
      buildable: build / MAP_CELL_COUNT,
      water: water / MAP_CELL_COUNT,
      reachable: pass > 0 ? largest / pass : 0,
      ramps: this.rampsCarved,
      scenery: this.report.pruned,
      startsStranded: this.report.stranded,
      // The count nobody printed. `reachable` stayed above 99% on every map
      // affected by the reported bug because a fraction hides a hundred small
      // holes; the region COUNT does not.
      regions,
    };
  }

  /**
   * The tier potential: a domain-warped fbm blended toward 1.0 at the rim,
   * normalised so the full 0..tierCount range is always used whatever the
   * seed. Domain warping matters here for the same reason it matters in camo:
   * a raw fbm contour reads as "a noise function", a warped one reads as
   * "a landform".
   */
  private buildPotential(): void {
    const b = this.biomeDef;
    const p = this.potential;
    const inv = 1 / b.plateauMetres;
    const s = this.seed;

    let lo = Infinity;
    let hi = -Infinity;

    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const z = gz * GRID;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        const x = gx * GRID;
        const wx = x * inv + simplex2(x * inv * 2.1, z * inv * 2.1, s + 31) * 0.34;
        const wz = z * inv + simplex2(x * inv * 2.1 + 4.7, z * inv * 2.1 - 2.3, s + 57) * 0.34;
        // The fine term does nothing to the plateaus (it is 3% of a tier) and
        // everything to the ISOLINE: without it the tier boundary is a smooth
        // curve and the 1 m grid renders it as a regular 45 degree staircase,
        // which reads as a grid artefact. VISUAL_DNA §1.6: cliffs are jagged,
        // with a silhouette break every 8-20 px. This is that jaggedness.
        const n = fbm2(wx, wz, 4, 2.0, 0.5, s)
          + fbm2(x * 0.075, z * 0.075, 2, 2.0, 0.5, s + 601) * 0.020;
        p[gz * GRID_STRIDE + gx] = n;
        if (n < lo) lo = n;
        if (n > hi) hi = n;
      }
    }

    const span = hi - lo < 1e-6 ? 1 : hi - lo;
    const half = MAP_SIZE * 0.5;
    const invHalf = 1 / half;

    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const z = gz * GRID;
      const dz = Math.abs(z - half) * invHalf;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        const i = gz * GRID_STRIDE + gx;
        const x = gx * GRID;
        const dx = Math.abs(x - half) * invHalf;
        // Chebyshev radius: a square rim, so the raised border follows the map
        // edge instead of bulging into a circular arena.
        const r = dx > dz ? dx : dz;
        const edge = smoothstep(0.50, 0.99, r);
        const base = (p[i] - lo) / span;
        p[i] = clamp01(base * (1 - b.edgeBias) + edge * b.edgeBias);
      }
    }
  }

  /**
   * Quantise the potential into terraces and lay the swell on top.
   *
   * The transition width is adapted per sample: `w` is half the fraction of a
   * tier that the smoothstep spans, and dividing by the local gradient turns
   * that into a CONSTANT horizontal run in metres. Without this, a shallow
   * part of the potential produces a 20 m ramp and a steep part produces a
   * 1-sample staircase, and the map reads as noise instead of architecture.
   */
  private buildHeightfield(): void {
    const b = this.biomeDef;
    const p = this.potential;
    const h = this.height;
    const s = this.seed;
    const sea = this.sea;
    const invSwell = 1 / b.swellMetres;
    const tiers = b.tierCount;
    const halfGrad = 1 / (2 * GRID);

    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const z = gz * GRID;
      const zm = gz > 0 ? gz - 1 : 0;
      const zp = gz < GRID_N ? gz + 1 : GRID_N;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        const i = gz * GRID_STRIDE + gx;
        const x = gx * GRID;
        const xm = gx > 0 ? gx - 1 : 0;
        const xp = gx < GRID_N ? gx + 1 : GRID_N;

        const t = p[i] * tiers;
        const gtx = (p[gz * GRID_STRIDE + xp] - p[gz * GRID_STRIDE + xm]) * tiers * halfGrad;
        const gtz = (p[zp * GRID_STRIDE + gx] - p[zm * GRID_STRIDE + gx]) * tiers * halfGrad;
        const grad = Math.sqrt(gtx * gtx + gtz * gtz);

        // Half-width of the smoothstep in TIER units, chosen so the face
        // occupies `cliffWidth` metres of horizontal run.
        //
        // The LOWER bound has to stay near zero. Clamping it up (0.02 looks
        // harmless) widens the transition wherever the potential is shallow,
        // and a shallow potential is exactly where the tier threshold spends
        // the most ground — the result is 10 m brick ramps instead of walls.
        // The upper bound only ever makes a face steeper, so it is safe.
        const w = clamp(b.cliffWidth * grad * 0.5, 0.001, 0.48);
        const floorT = Math.floor(t);
        const frac = t - floorT;
        const tierF = floorT + smoothstep(0.5 - w, 0.5 + w, frac);

        const swell = fbm2(x * invSwell, z * invSwell, 3, 2.0, 0.5, s + 907) * b.swellAmplitude;

        let y = b.baseHeight + tierF * b.stepHeight + swell;

        // Basins. Only the lowest sliver of the potential is carved, and only
        // in biomes that have water at all.
        if (b.basinDepth > 0) {
          y -= smoothstep(b.basinThreshold, 0, p[i]) * b.basinDepth;
        }

        // The declared sea. A CLAMP into the coastal cone, never a blend —
        // see TERRAIN_SEA_BEACH_GRADE for why that distinction is the whole
        // difference between a coast and a stamped wedge. Gated on `sea`, so a
        // landlocked map runs the identical arithmetic it always has.
        if (sea !== null) {
          const ceil = this.seaCeilingAt(x, z, this.seaDistance(x, z, sea), sea);
          if (y > ceil) y = ceil;
        }

        h[i] = clamp(y, 0, TERRAIN_MAX_HEIGHT);
      }
    }
  }

  /* ======================================================================
   * 3b. RESERVED START AREAS
   * ====================================================================== */

  /** Mark every cell whose centre falls inside a start guarantee radius. */
  private buildStartMask(): void {
    this.startMask.fill(0);
    const r = TERRAIN_START_GUARD_RADIUS;
    const r2 = r * r;
    for (let k = 0; k < this.startPoints.length; k++) {
      const p = this.startPoints[k];
      const cLo = Math.max(0, Math.floor((p.x - r) / CELL));
      const cHi = Math.min(MAP_CELLS - 1, Math.ceil((p.x + r) / CELL));
      const zLo = Math.max(0, Math.floor((p.z - r) / CELL));
      const zHi = Math.min(MAP_CELLS - 1, Math.ceil((p.z + r) / CELL));
      for (let cz = zLo; cz <= zHi; cz++) {
        const dz = (cz + 0.5) * CELL - p.z;
        for (let cx = cLo; cx <= cHi; cx++) {
          const dx = (cx + 0.5) * CELL - p.x;
          if (dx * dx + dz * dz <= r2) this.startMask[cz * MAP_CELLS + cx] = 1;
        }
      }
    }
  }

  /**
   * Level every start location into a shelf the moment the raw heightfield
   * exists, before anything is classified.
   *
   * The elevation is snapped to the nearest TERRACE rather than set to the
   * local mean, so the shelf sits on the same quantised ladder as the rest of
   * the map and reads as one of its plateaus instead of a cut. It is then held
   * clear of WATER_LEVEL, because a base whose cells classify as water is
   * impassable to everything without a skirt.
   */
  private levelStartAreas(): void {
    const b = this.biomeDef;
    const h = this.height;
    this.startShelves.length = 0;

    for (let k = 0; k < this.startPoints.length; k++) {
      const p = this.startPoints[k];

      // --- which terrace does this start naturally sit on? ------------------
      const r = TERRAIN_START_FLAT_RADIUS;
      const r2 = r * r;
      const gLo = Math.max(0, Math.floor((p.x - r) * INV_GRID));
      const gHi = Math.min(GRID_N, Math.ceil((p.x + r) * INV_GRID));
      const gzLo = Math.max(0, Math.floor((p.z - r) * INV_GRID));
      const gzHi = Math.min(GRID_N, Math.ceil((p.z + r) * INV_GRID));
      let sum = 0;
      let n = 0;
      for (let gz = gzLo; gz <= gzHi; gz++) {
        const dz = gz * GRID - p.z;
        const row = gz * GRID_STRIDE;
        for (let gx = gLo; gx <= gHi; gx++) {
          const dx = gx * GRID - p.x;
          if (dx * dx + dz * dz > r2) continue;
          sum += h[row + gx];
          n++;
        }
      }
      const mean = n > 0 ? sum / n : b.baseHeight;
      /*
       * WHICH TERRACE, AND WHY AN ISLAND HAS NO CHOICE ABOUT IT.
       *
       * On a continent the shelf takes the terrace the ground already sits on,
       * which is what stops a reserved start reading as a plateau stamped onto
       * a valley. An ISLAND cannot afford that, and the arithmetic is short:
       *
       *   `flattenDisc` levels TERRAIN_START_FLAT_RADIUS (58 m) and wobbles its
       *   rim TERRAIN_START_EDGE_WOBBLE (14 m) further, so on the 98 m islands
       *   `ARCHIPELAGO_SEA` carves there are ~26 m of coast left to get from
       *   the shelf back down to WATER_LEVEL. `computeDerived` calls a cell
       *   buildable only when its height spread over a +/-3 m window is under
       *   TERRAIN_BUILD_FLATNESS (1.1 m) — about a 0.13 grade — so 26 m buys
       *   3.4 m of fall and a shelf above ~5.4 m makes the ENTIRE coast
       *   unbuildable.
       *
       * Tier 1 is 9.9 m on desert, 8.8 m on temperate, 9.5 m on snow. Every one
       * of them is over that line, and the mean height at all four island
       * centres lands on tier 1 for every seed tried — 48 of them, spread 9.7
       * to 10.1 m. This is not a bad roll; it is the shape of the map.
       *
       * WHAT IT COST, MEASURED. `hasNavigableWater` requires 8 wet cells within
       * PRODUCTION.shoreSearchCells (6 cells, 24 m) of a naval yard's 3x3
       * footprint. With buildable ground stopping ~34 m short of the waterline,
       * the count of legal yard sites on the whole map was ZERO, against 237 on
       * `contested-strait`. Naval yards, pens, slipways, drydocks, nine hulls
       * and the transport — every amphibious verb the game owns — were
       * unreachable content on the one map that exists to need them.
       *
       * So an island shelf takes tier 0 and the dry margin decides the rest.
       * The guarantee itself is untouched: it is still levelled, still dry,
       * still `TERRAIN_START_FLAT_RADIUS` across, still 100% buildable. It is
       * only lower, which is the one property an island actually needs.
       *
       * GATED ON `archipelago`, so no continent and neither half-plane sea map
       * sees this line. `tests/archipelago.spec.ts` measures the coast that
       * results rather than trusting it.
       */
      const tier = this.archipelago
        ? 0
        : clamp(Math.round((mean - b.baseHeight) / b.stepHeight), 0, b.tierCount);
      const level = Math.max(
        b.baseHeight + tier * b.stepHeight,
        WATER_LEVEL + TERRAIN_START_DRY_MARGIN,
      );

      this.flattenDisc(
        p.x, p.z, TERRAIN_START_FLAT_RADIUS, level,
        TERRAIN_START_EDGE_WOBBLE, TERRAIN_START_SWELL,
      );

      this.startShelves.push({
        x: p.x, z: p.z, radius: TERRAIN_START_GUARD_RADIUS, height: level,
      });
    }
  }

  /**
   * Level a disc to `level` and grade the surround back into the landform.
   *
   * Inside the core the height IS the level (plus a residual swell, because a
   * dead-flat disc reads as a plate from the game camera). Outside it, the
   * natural height is CLAMPED into a cone of `TERRAIN_START_APRON_GRADE` rather
   * than blended toward the level — and that distinction is the whole trick.
   *
   * A lerp toward the level scales a 6 m terrace face down but leaves it a
   * face: at 80% blended it is still a 1.2 m step across one grid sample, i.e.
   * a 50 degree wall the nav grid still calls a cliff. A clamp REMOVES the face
   * outright wherever it exceeds the cone and leaves the terrain completely
   * untouched wherever it does not, so the shelf ends at a different distance
   * in every direction and never draws a circle on the map.
   *
   * The rim itself wanders outward on a long-wavelength noise. Outward only —
   * the guarantee is a floor, never a ceiling — and at a gradient (~0.14) that
   * cannot push the apron's effective grade past ROUGH_SLOPE.
   */
  private flattenDisc(
    px: number, pz: number, coreRadius: number, level: number,
    wobble: number, swellAmplitude: number,
  ): void {
    const b = this.biomeDef;
    const h = this.height;
    const s = this.seed;
    const g = TERRAIN_START_APRON_GRADE;
    const invSwell = 1 / b.swellMetres;
    const invWobble = 1 / TERRAIN_START_WOBBLE_METRES;
    // Past this distance the cone is wider than the map's entire relief, so the
    // clamp provably cannot bind and there is nothing to compute.
    const reach = coreRadius + wobble + TERRAIN_MAX_HEIGHT / g + GRID;

    const gxLo = Math.max(0, Math.floor((px - reach) * INV_GRID));
    const gxHi = Math.min(GRID_N, Math.ceil((px + reach) * INV_GRID));
    const gzLo = Math.max(0, Math.floor((pz - reach) * INV_GRID));
    const gzHi = Math.min(GRID_N, Math.ceil((pz + reach) * INV_GRID));

    for (let gz = gzLo; gz <= gzHi; gz++) {
      const z = gz * GRID;
      const dz = z - pz;
      const row = gz * GRID_STRIDE;
      for (let gx = gxLo; gx <= gxHi; gx++) {
        const x = gx * GRID;
        const dx = x - px;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > reach) continue;

        const rim = wobble > 0
          ? coreRadius + clamp01(fbm2(x * invWobble, z * invWobble, 2, 2.0, 0.5, s + 1723) * 0.5 + 0.5) * wobble
          : coreRadius;
        const base = swellAmplitude > 0
          ? level + fbm2(x * invSwell, z * invSwell, 3, 2.0, 0.5, s + 907) * swellAmplitude
          : level;

        const i = row + gx;
        if (d <= rim) {
          h[i] = clamp(base, 0, TERRAIN_MAX_HEIGHT);
          continue;
        }
        const a = (d - rim) * g;
        h[i] = clamp(clamp(h[i], base - a, base + a), 0, TERRAIN_MAX_HEIGHT);
      }
    }
  }

  /**
   * Slope, terrace fraction, and every per-cell grid. Called twice: once
   * before the ramp carver and once after, because carving changes heights.
   */
  private computeDerived(): void {
    const b = this.biomeDef;
    const h = this.height;
    const sl = this.slope;
    const halfGrad = 1 / (2 * GRID);

    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const zm = (gz > 0 ? gz - 1 : 0) * GRID_STRIDE;
      const zp = (gz < GRID_N ? gz + 1 : GRID_N) * GRID_STRIDE;
      const row = gz * GRID_STRIDE;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        const i = row + gx;
        const xm = gx > 0 ? gx - 1 : 0;
        const xp = gx < GRID_N ? gx + 1 : GRID_N;
        const dx = (h[row + xp] - h[row + xm]) * halfGrad;
        const dz = (h[zp + gx] - h[zm + gx]) * halfGrad;
        sl[i] = Math.atan(Math.sqrt(dx * dx + dz * dz));
      }
    }

    this.measureWalls();

    for (let cz = 0; cz < MAP_CELLS; cz++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const ci = cz * MAP_CELLS + cx;
        const g0x = cx * SAMPLES_PER_CELL;
        const g0z = cz * SAMPLES_PER_CELL;

        let maxSlope = 0;
        let minH = Infinity;
        let maxH = -Infinity;
        for (let dz = 0; dz <= SAMPLES_PER_CELL; dz++) {
          const row = (g0z + dz) * GRID_STRIDE;
          for (let dx = 0; dx <= SAMPLES_PER_CELL; dx++) {
            const gi = row + g0x + dx;
            const sv = sl[gi];
            if (sv > maxSlope) maxSlope = sv;
            const hv = h[gi];
            if (hv < minH) minH = hv;
            if (hv > maxH) maxH = hv;
          }
        }

        const centre = h[(g0z + (SAMPLES_PER_CELL >> 1)) * GRID_STRIDE + g0x + (SAMPLES_PER_CELL >> 1)];
        this.cellHeight[ci] = centre;
        this.cellSlope[ci] = maxSlope;

        const isWater = centre < WATER_LEVEL ? 1 : 0;
        const isCliff = maxSlope >= CLIFF_SLOPE;
        const isRough = maxSlope >= ROUGH_SLOPE;
        this.waterGrid[ci] = isWater;

        const border =
          cx < TERRAIN_BORDER_CELLS || cz < TERRAIN_BORDER_CELLS ||
          cx >= MAP_CELLS - TERRAIN_BORDER_CELLS || cz >= MAP_CELLS - TERRAIN_BORDER_CELLS;

        let pass = 0;
        if (!isCliff && !border) {
          // Hover crosses water; nothing crosses a cliff.
          pass = PASS_HOVER;
          if (isWater === 0) pass |= PASS_GROUND;
        }
        this.passGrid[ci] = pass;

        this.costGrid[ci] =
          pass === 0 ? COST_BLOCKED
            : isWater ? COST_BLOCKED
              : isRough ? Math.round(COST_UNIT * 1.55)
                : COST_UNIT;

        this.buildGrid[ci] =
          !border && !isCliff && isWater === 0 &&
          maxSlope < ROUGH_SLOPE * 0.62 &&
          maxH - minH < TERRAIN_BUILD_FLATNESS
            ? 1 : 0;
      }
    }
  }

  /**
   * Measure where every sample sits inside its local terrace face, by taking
   * the min and max height over a +/-3 m window.
   *
   * The obvious cheaper answer — `fract((h - base) / stepHeight)` — is wrong,
   * and wrong in a way that is invisible until you look at a render: the swell
   * noise puts a plateau at 12.4 m or 11.6 m with equal probability, so the
   * fraction wraps between 0.07 and 0.93 along a single cliff top and the
   * coping cap breaks into disconnected slabs. Measuring the geometry instead
   * of inferring it costs one separable window pass and always agrees with
   * what is actually on screen.
   */
  private measureWalls(): void {
    const h = this.height;
    const lo = this.windowLo;
    const hi = this.windowHi;
    const R = 3;

    // Horizontal pass into the scratch pair.
    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const row = gz * GRID_STRIDE;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        let mn = Infinity;
        let mx = -Infinity;
        const x0 = gx - R < 0 ? 0 : gx - R;
        const x1 = gx + R > GRID_N ? GRID_N : gx + R;
        for (let x = x0; x <= x1; x++) {
          const v = h[row + x];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        lo[row + gx] = mn;
        hi[row + gx] = mx;
      }
    }

    // Vertical pass, straight into the output attributes.
    const invStep = 1 / this.biomeDef.stepHeight;
    for (let gz = 0; gz < GRID_STRIDE; gz++) {
      const z0 = gz - R < 0 ? 0 : gz - R;
      const z1 = gz + R > GRID_N ? GRID_N : gz + R;
      const row = gz * GRID_STRIDE;
      for (let gx = 0; gx < GRID_STRIDE; gx++) {
        let mn = Infinity;
        let mx = -Infinity;
        for (let z = z0; z <= z1; z++) {
          const i = z * GRID_STRIDE + gx;
          const a = lo[i];
          const c = hi[i];
          if (a < mn) mn = a;
          if (c > mx) mx = c;
        }
        const i = row + gx;
        const v = h[i];
        this.wallUp[i] = clamp01((v - mn) * invStep);
        this.wallTop[i] = clamp01((mx - v) * invStep);
      }
    }
  }

  /* ======================================================================
   * 4. CONNECTIVITY — the ramp carver
   * ====================================================================== */

  /**
   * Label 4-connected regions of cells a tracked vehicle can enter. Returns
   * the number of regions; `regionId` holds 0 for impassable and 1..n
   * otherwise, and `sizes[k]` is the area of region k.
   */
  private labelRegions(sizes: number[]): number {
    const id = this.regionId;
    const stack = this.regionStack;
    const pass = this.passGrid;
    id.fill(0);
    sizes.length = 1;
    sizes[0] = 0;

    let next = 0;
    for (let start = 0; start < MAP_CELL_COUNT; start++) {
      if (id[start] !== 0) continue;
      if ((pass[start] & PASS_TRACK) === 0) continue;

      next++;
      let area = 0;
      let sp = 0;
      stack[sp++] = start;
      id[start] = next;

      while (sp > 0) {
        const c = stack[--sp];
        area++;
        const cx = c % MAP_CELLS;
        const cz = (c / MAP_CELLS) | 0;

        if (cx > 0) {
          const n = c - 1;
          if (id[n] === 0 && (pass[n] & PASS_TRACK) !== 0) { id[n] = next; stack[sp++] = n; }
        }
        if (cx < MAP_CELLS - 1) {
          const n = c + 1;
          if (id[n] === 0 && (pass[n] & PASS_TRACK) !== 0) { id[n] = next; stack[sp++] = n; }
        }
        if (cz > 0) {
          const n = c - MAP_CELLS;
          if (id[n] === 0 && (pass[n] & PASS_TRACK) !== 0) { id[n] = next; stack[sp++] = n; }
        }
        if (cz < MAP_CELLS - 1) {
          const n = c + MAP_CELLS;
          if (id[n] === 0 && (pass[n] & PASS_TRACK) !== 0) { id[n] = next; stack[sp++] = n; }
        }
      }
      sizes[next] = area;
    }
    return next;
  }

  /**
   * Mark, in `out`, which region ids hold at least one guarded start cell.
   * `out[k]` is 1 for such a region and 0 otherwise; index 0 is unused.
   */
  private markStartRegions(regions: number, out: Uint8Array): void {
    out.fill(0, 0, regions + 1);
    if (this.startPoints.length === 0) return;
    const id = this.regionId;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      if (this.startMask[i] === 0) continue;
      const r = id[i];
      if (r !== 0) out[r] = 1;
    }
  }

  /**
   * Guarantee that every worthwhile piece of ground is reachable from the main
   * landmass. Runs up to six passes because carving one ramp can merge two
   * regions and change which one is largest.
   *
   * `TERRAIN_MIN_REGION_CELLS` is the economy rule that stops the carver
   * bulldozing an 80 m trench to reach a 9-cell ledge. It does NOT apply to a
   * region holding start ground: there, the pocket is worth any ramp, because
   * it is where an army is about to be standing. Those links also draw on
   * `TERRAIN_START_MAX_RAMPS` rather than the global budget, so a map that
   * spent all thirty ramps on its hillsides still gets its start areas joined.
   */
  private ensureConnectivity(): void {
    const sizes: number[] = [];
    const order: number[] = [];
    const isStart = new Uint8Array(MAP_CELL_COUNT + 1);
    let carved = 0;
    let startCarved = 0;

    for (let pass = 0; pass < 6; pass++) {
      if (carved >= TERRAIN_MAX_RAMPS && startCarved >= TERRAIN_START_MAX_RAMPS) return;
      const regions = this.labelRegions(sizes);
      if (regions <= 1) return;

      let main = 1;
      for (let k = 2; k <= regions; k++) if (sizes[k] > sizes[main]) main = k;
      this.markStartRegions(regions, isStart);

      // Biggest stranded region first. Each carve merges regions, so spending
      // the ramp budget on the largest ones recovers the most ground per cut,
      // and a merge often drags several small neighbours along with it. Start
      // regions jump the queue whatever their size.
      order.length = 0;
      for (let k = 1; k <= regions; k++) {
        if (k === main) continue;
        if (isStart[k] !== 0 || sizes[k] >= TERRAIN_MIN_REGION_CELLS) order.push(k);
      }
      order.sort((a, b) => {
        if (isStart[a] !== isStart[b]) return isStart[b] - isStart[a];
        return sizes[b] - sizes[a];
      });
      if (order.length === 0) return;

      let carvedThisPass = 0;
      for (let i = 0; i < order.length; i++) {
        const k = order[i];
        const start = isStart[k] !== 0;
        if (start ? startCarved >= TERRAIN_START_MAX_RAMPS : carved >= TERRAIN_MAX_RAMPS) continue;
        if (!this.linkRegion(k, main)) continue;
        if (start) { startCarved++; this.report.startRamps++; } else carved++;
        carvedThisPass++;
        this.rampsCarved++;
      }
      if (carvedThisPass === 0) return;
      this.computeDerived();
    }
  }

  /**
   * Verify the start guarantee and escalate until it holds.
   *
   * This is the step the module was missing. Everything above is best-effort:
   * the carver has budgets, length caps and search windows, and every one of
   * them can legitimately decline. So after it has run, MEASURE — flood-fill
   * the grid the pathfinder will actually read and ask whether any guarded cell
   * ended up outside the main region. If one did, escalate in order of damage:
   *
   *   1. the ordinary bounded link (cheap, and usually all that is left);
   *   2. a BFS-shortest corridor with the length cap lifted — a long dirt track
   *      is ugly, an army that cannot move is fatal;
   *   3. raise the pocket to its own rim so the trap stops existing. A filled
   *      pit is strictly better than a pit with tanks in it.
   */
  private enforceStartAreas(): void {
    if (this.startPoints.length === 0) return;
    const sizes: number[] = [];
    const isStart = new Uint8Array(MAP_CELL_COUNT + 1);

    for (let pass = 0; pass < TERRAIN_START_ENFORCE_PASSES; pass++) {
      const regions = this.labelRegions(sizes);
      if (regions <= 1) { this.report.stranded = 0; return; }

      let main = 1;
      for (let k = 2; k <= regions; k++) if (sizes[k] > sizes[main]) main = k;
      this.markStartRegions(regions, isStart);

      this.strandedStarts.length = 0;
      for (let k = 1; k <= regions; k++) {
        if (k === main || isStart[k] === 0) continue;
        // An island start is not stranded, it is an island. Escalating here is
        // what would causeway the sea shut. See `islandStartSatisfied`.
        if (this.islandStartSatisfied(sizes[k])) continue;
        this.strandedStarts.push(k);
      }
      if (this.strandedStarts.length === 0) { this.report.stranded = 0; return; }
      // Biggest first: merging the largest pocket often absorbs its neighbours.
      this.strandedStarts.sort((a, b) => sizes[b] - sizes[a]);

      let changed = false;
      for (let i = 0; i < this.strandedStarts.length; i++) {
        const k = this.strandedStarts[i];
        if (this.linkRegion(k, main)) {
          this.rampsCarved++;
          this.report.startRamps++;
          changed = true;
          continue;
        }
        if (this.linkRegionForced(k, main)) {
          this.rampsCarved++;
          this.report.forcedRamps++;
          changed = true;
          continue;
        }
        if (this.fillRegion(k)) {
          this.report.filled++;
          changed = true;
        }
      }
      if (!changed) break;
      this.computeDerived();
    }

    // Final measurement. Anything left here is a genuine generator failure and
    // is reported rather than papered over.
    const regions = this.labelRegions(sizes);
    let main = 1;
    for (let k = 2; k <= regions; k++) if (sizes[k] > sizes[main]) main = k;
    let stranded = 0;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      if (this.startMask[i] === 0) continue;
      const r = this.regionId[i];
      if (r === 0 || r === main) continue;
      if (this.islandStartSatisfied(sizes[r])) continue;
      stranded++;
    }
    this.report.stranded = stranded;
  }

  /**
   * Reclaim large stranded regions — the other half of the connectivity bug.
   *
   * `enforceStartAreas` guarantees the ground an army SPAWNS on. This
   * guarantees the ground it can later drive to. Measured across 200
   * biome/seed combinations, three maps ended generation with a single
   * stranded plateau holding 12%, 18% and 38% of all passable ground: big
   * enough to clear `TERRAIN_MIN_REGION_CELLS` and therefore genuinely queued
   * by `ensureConnectivity`, but with no corridor that fits inside
   * `TERRAIN_RAMP_MAX_LENGTH`, so the carver gave up and nothing checked.
   *
   * The rule is written as the invariant rather than as a size threshold: cut
   * the single worst split, re-measure, and stop as soon as the main region
   * holds `TERRAIN_MAIN_REGION_SHARE` of the ground that will still be passable
   * after pruning. A map that is already one piece does no work at all.
   *
   * ISLANDS ARE LEFT ALONE, and that is the point of the dry-only BFS: on the
   * three measured maps every stranded boundary was 100% cliff and 0% water, so
   * a land corridor is the right answer. On a naval map it is emphatically not
   * — dropping a causeway across a lake to reach an island would destroy the
   * map this pass exists to protect. If no dry corridor exists the region is
   * water-separated by definition, and hovercraft and transports already reach
   * it.
   */
  private ensureMajorRegions(): void {
    const sizes: number[] = [];
    const order: number[] = [];
    /** Cells the main region held at the end of the previous pass. */
    let prevMain = -1;
    /** Consecutive passes that carved without growing the main region. */
    let stalls = 0;

    for (let pass = 0; pass < TERRAIN_MAJOR_ENFORCE_PASSES; pass++) {
      if (this.report.majorRamps >= TERRAIN_MAJOR_MAX_RAMPS) return;

      const regions = this.labelRegions(sizes);
      if (regions <= 1) return;
      let main = 1;
      for (let k = 2; k <= regions; k++) if (sizes[k] > sizes[main]) main = k;

      // Ground that survives `prunePockets`. Counting the doomed scraps would
      // depress the ratio and buy ramps for cells that are about to stop
      // existing.
      let durable = 0;
      for (let k = 1; k <= regions; k++) {
        if (k === main || sizes[k] >= TERRAIN_PRUNE_REGION_CELLS) durable += sizes[k];
      }
      if (durable === 0) return;
      if (sizes[main] / durable >= TERRAIN_MAIN_REGION_SHARE) return;

      /* -- did the last carve actually breach? --------------------------------
       * `carveRamp` reports whether it MODIFIED the heightfield, not whether it
       * CONNECTED anything, and those differ: the corridor is feathered, so a
       * cut that only grazes the cliff still returns true. Trusting it meant
       * one measured seed (desert/802294) spent its entire ramp budget on
       * bounded links that never breached, and never reached the escalation.
       *
       * So the progress test is the main region's own size. No growth means the
       * pretty bounded ramp is not working here, and the next attempt goes
       * straight to the forced corridor. Two stalled passes in a row means even
       * that is not landing, and continuing would just scar the map.
       * -------------------------------------------------------------------- */
      const stalled = prevMain >= 0 && sizes[main] <= prevMain;
      if (stalled && ++stalls >= 2) {
        // Count only the regions that will still be passable after pruning —
        // reporting every 3-cell scrap as "abandoned" would bury the one number
        // that matters under noise.
        let abandoned = 0;
        for (let k = 1; k <= regions; k++) {
          if (k !== main && sizes[k] >= TERRAIN_PRUNE_REGION_CELLS) abandoned++;
        }
        this.report.majorSkipped = abandoned;
        return;
      }
      if (!stalled) stalls = 0;
      prevMain = sizes[main];

      // Largest survivor first: one carve at the worst split moves the ratio
      // further than several at the margins.
      order.length = 0;
      for (let k = 1; k <= regions; k++) {
        if (k !== main && sizes[k] >= TERRAIN_PRUNE_REGION_CELLS) order.push(k);
      }
      if (order.length === 0) return;
      order.sort((a, b) => sizes[b] - sizes[a]);

      let cut = false;
      for (let i = 0; i < order.length; i++) {
        const k = order[i];
        // The bounded link is the nicer cut, so it goes first — but only while
        // it is still earning its place. Once a pass has stalled, go straight
        // to the true-nearest corridor with the length cap lifted, restricted
        // to dry ground so an island is refused rather than causewayed.
        // `linkRegion` is the only causeway risk that can SURVIVE generation:
        // it does not test water, and this pass runs after the last `carveSea`,
        // so a corridor it raises across a strait is never cut back out.
        // Everywhere else the ordering saves us. On an archipelago the bounded
        // link is therefore skipped outright and only the dry-only BFS is
        // offered, which refuses an island by construction.
        const ok = stalled || this.archipelago
          ? this.linkRegionForced(k, main, true)
          : (this.linkRegion(k, main) || this.linkRegionForced(k, main, true));
        if (ok) {
          this.rampsCarved++;
          this.report.majorRamps++;
          cut = true;
          break;
        }
      }
      if (!cut) {
        // Nothing left that a dry corridor can reach: islands, or faces no
        // legal grade climbs. Recorded once, at the point we stop trying, so
        // the count is regions-abandoned and not attempts-made.
        this.report.majorSkipped = order.length;
        return;
      }
      this.computeDerived();
    }
  }

  /**
   * Demote every tiny unreachable region to scenery.
   *
   * A 6-cell ledge the carver deliberately skipped is not a bug; a 6-cell ledge
   * still flagged PASSABLE is, because the pathfinder will happily accept it as
   * the destination of a move order that can never complete, and the AI will
   * re-issue that order forever. Clearing the ground bits makes it what it
   * actually is: terrain you look at.
   *
   * Regions at or above `TERRAIN_PRUNE_REGION_CELLS` are left alone — those are
   * real mesas and islands, and a hover or a transport may legitimately want
   * them. The hover bit is never cleared for the same reason: a hovercraft that
   * can cross the water to a ledge is not stranded on it.
   */
  private prunePockets(): void {
    const sizes: number[] = [];
    const regions = this.labelRegions(sizes);
    if (regions <= 1) return;
    let main = 1;
    for (let k = 2; k <= regions; k++) if (sizes[k] > sizes[main]) main = k;

    let pruned = 0;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      const r = this.regionId[i];
      if (r === 0 || r === main) continue;
      if (sizes[r] >= TERRAIN_PRUNE_REGION_CELLS) continue;
      // Never inside a guarantee: a hole in the base area is the bug, not the
      // fix. If one survives to here it is reported by `enforceStartAreas`.
      if (this.startMask[i] !== 0) continue;
      this.passGrid[i] &= ~PASS_GROUND;
      this.costGrid[i] = COST_BLOCKED;
      this.buildGrid[i] = 0;
      pruned++;
    }
    this.report.pruned = pruned;
  }

  /** One line at boot, but only when the guarantee actually cost something. */
  private logStartAreas(): void {
    const r = this.report;
    if (r.stranded > 0) {
      console.warn(
        `[terrain] START GUARANTEE UNMET — ${r.stranded} guarded cell(s) still cut off ` +
        `(seed ${this.seed}, biome ${this.biomeDef.key})`,
      );
      return;
    }
    if (r.startRamps === 0 && r.forcedRamps === 0 && r.filled === 0 && r.majorRamps === 0) return;
    console.info(
      `[terrain] start areas: ${r.areas} reserved, ${r.startRamps} link ramp(s), ` +
      `${r.forcedRamps} forced corridor(s), ${r.filled} pocket(s) filled, ` +
      `${r.majorRamps} plateau corridor(s), ${r.pruned} cell(s) demoted to scenery`,
    );
  }

  /**
   * Find the shortest hop between `from` and `to` and cut a ramp across it.
   * The search is a bounded window scan rather than a full BFS: a stranded
   * mesa is always within a handful of cells of the plateau below it, and an
   * unbounded search would happily connect two corners of the map with a
   * 400 m trench.
   */
  private linkRegion(from: number, to: number): boolean {
    const id = this.regionId;
    let bestD = Infinity;
    let bestA = -1;
    let bestB = -1;

    // Two attempts: a tight window first so a mesa links to the plateau
    // directly under it, then one bounded pass wider. Beyond
    // TERRAIN_RAMP_MAX_LINK_CELLS the region is left stranded on purpose —
    // cutting a 100 m trench across open ground to reach a ledge does more
    // damage to the map than the ledge is worth.
    for (const RANGE of [8, TERRAIN_RAMP_MAX_LINK_CELLS]) {
      for (let c = 0; c < MAP_CELL_COUNT; c++) {
        if (id[c] !== from) continue;
        const cx = c % MAP_CELLS;
        const cz = (c / MAP_CELLS) | 0;

        for (let dz = -RANGE; dz <= RANGE; dz++) {
          const nz = cz + dz;
          if (nz < 0 || nz >= MAP_CELLS) continue;
          for (let dx = -RANGE; dx <= RANGE; dx++) {
            const nx = cx + dx;
            if (nx < 0 || nx >= MAP_CELLS) continue;
            if (id[nz * MAP_CELLS + nx] !== to) continue;
            const d = dx * dx + dz * dz;
            if (d < bestD) {
              bestD = d;
              bestA = c;
              bestB = nz * MAP_CELLS + nx;
            }
          }
        }
      }
      if (bestA >= 0) break;
    }

    if (bestA < 0 || bestB < 0) return false;

    return this.carveRamp(
      ((bestB % MAP_CELLS) + 0.5) * CELL, (((bestB / MAP_CELLS) | 0) + 0.5) * CELL,
      ((bestA % MAP_CELLS) + 0.5) * CELL, (((bestA / MAP_CELLS) | 0) + 0.5) * CELL,
      false,
    );
  }

  /**
   * The escalation link: find the genuinely shortest hop between two regions
   * anywhere on the map and cut it with the length cap lifted.
   *
   * `linkRegion`'s windowed scan is O(cells x range^2) and so has to stay
   * bounded; this is a single multi-source BFS seeded from every cell of `to`,
   * which is O(cells) and finds the true nearest pair. The start-area
   * guarantee reaches it because "the corridor is 90 m long and shows" beats
   * "the player's army cannot move".
   *
   * `dryOnly` refuses to expand through water. The major-region pass sets it so
   * a stranded ISLAND is reported unreachable instead of being joined to the
   * mainland by a causeway — `carveRamp` interpolates height along the corridor
   * and would happily raise a lake bed into a land bridge, which is a far worse
   * map than the one it set out to repair. The start guarantee leaves it off:
   * there, a causeway is still better than an army that cannot move, and
   * `fillRegion` is waiting behind it either way.
   */
  private linkRegionForced(from: number, to: number, dryOnly = false): boolean {
    const id = this.regionId;
    const dist = this.bfsDist;
    const src = this.bfsFrom;
    const q = this.bfsQueue;
    const water = this.waterGrid;

    dist.fill(-1);
    let tail = 0;
    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      if (id[i] !== to) continue;
      dist[i] = 0;
      src[i] = i;
      q[tail++] = i;
    }
    if (tail === 0) return false;

    let found = -1;
    for (let head = 0; head < tail; head++) {
      const c = q[head];
      if (id[c] === from) { found = c; break; }
      const cx = c % MAP_CELLS;
      const cz = (c / MAP_CELLS) | 0;
      const d = dist[c] + 1;
      const from0 = src[c];
      // Inlined four ways rather than through a helper: the helper would have
      // to close over `c` and `d` and so be reallocated for every one of the
      // ~16k nodes this walks.
      let n = 0;
      if (cx > 0) {
        n = c - 1;
        if (dist[n] < 0) {
          dist[n] = d; src[n] = from0;
          // A wet cell is marked visited but never expanded, so a dry-only
          // search cannot route through it. Marking rather than skipping stops
          // the frontier re-testing it from every neighbour.
          if (!dryOnly || water[n] === 0) q[tail++] = n;
        }
      }
      if (cx < MAP_CELLS - 1) {
        n = c + 1;
        if (dist[n] < 0) {
          dist[n] = d; src[n] = from0;
          if (!dryOnly || water[n] === 0) q[tail++] = n;
        }
      }
      if (cz > 0) {
        n = c - MAP_CELLS;
        if (dist[n] < 0) {
          dist[n] = d; src[n] = from0;
          if (!dryOnly || water[n] === 0) q[tail++] = n;
        }
      }
      if (cz < MAP_CELLS - 1) {
        n = c + MAP_CELLS;
        if (dist[n] < 0) {
          dist[n] = d; src[n] = from0;
          if (!dryOnly || water[n] === 0) q[tail++] = n;
        }
      }
    }
    if (found < 0) return false;

    const anchor = src[found];
    return this.carveRamp(
      ((anchor % MAP_CELLS) + 0.5) * CELL, (((anchor / MAP_CELLS) | 0) + 0.5) * CELL,
      ((found % MAP_CELLS) + 0.5) * CELL, (((found / MAP_CELLS) | 0) + 0.5) * CELL,
      true,
    );
  }

  /**
   * Last resort: raise a pocket until it is no longer a pocket.
   *
   * Reached only when no corridor at any grade can join a stranded start region
   * to the map — a pit whose rim is higher than the ramp budget can climb, or
   * one hemmed in on every side. Filling it to the rim (and grading the
   * surround with the same cone the start shelf uses, so the fill ties in
   * rather than leaving a mesa) removes the trap entirely. Losing 20 cells of
   * relief costs the map nothing; leaving a hole an army falls into costs the
   * match.
   */
  private fillRegion(region: number): boolean {
    const id = this.regionId;
    let minX = MAP_CELLS;
    let maxX = -1;
    let minZ = MAP_CELLS;
    let maxZ = -1;
    let rim = -Infinity;
    let cells = 0;

    for (let i = 0; i < MAP_CELL_COUNT; i++) {
      if (id[i] !== region) continue;
      const cx = i % MAP_CELLS;
      const cz = (i / MAP_CELLS) | 0;
      cells++;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cz < minZ) minZ = cz;
      if (cz > maxZ) maxZ = cz;
      if (cx > 0 && id[i - 1] !== region) rim = Math.max(rim, this.cellHeight[i - 1]);
      if (cx < MAP_CELLS - 1 && id[i + 1] !== region) rim = Math.max(rim, this.cellHeight[i + 1]);
      if (cz > 0 && id[i - MAP_CELLS] !== region) rim = Math.max(rim, this.cellHeight[i - MAP_CELLS]);
      if (cz < MAP_CELLS - 1 && id[i + MAP_CELLS] !== region) rim = Math.max(rim, this.cellHeight[i + MAP_CELLS]);
    }
    if (cells === 0 || rim === -Infinity) return false;

    const cxm = (minX + maxX + 1) * 0.5 * CELL;
    const czm = (minZ + maxZ + 1) * 0.5 * CELL;
    const core = Math.max(CELL, Math.max(maxX - minX + 1, maxZ - minZ + 1) * 0.5 * CELL + CELL);
    this.flattenDisc(
      cxm, czm, core,
      clamp(rim, WATER_LEVEL + TERRAIN_START_DRY_MARGIN, TERRAIN_MAX_HEIGHT),
      0, TERRAIN_START_SWELL * 0.5,
    );
    return true;
  }

  /**
   * Cut a straight, legally graded corridor from (ax,az) on the main landmass
   * to (bx,bz) on the stranded one. The corridor is lengthened until its grade
   * is under `TERRAIN_RAMP_MAX_GRADE`, which is under ROUGH_SLOPE, so the
   * result is passable but still costs a vehicle time to climb.
   *
   * `force` lifts the length cap. Only the start-area guarantee sets it: the
   * cap exists so the carver does not bulldoze the map for a ledge nobody
   * needed, and that trade stops applying the moment the ledge is a spawn.
   *
   * Returns whether the heightfield was actually modified. The callers count
   * ramps and decide whether to escalate on that answer, so "I declined" and
   * "I cut it" must not look the same — that is how a rescue pass ends up
   * looping six times over a pocket it never touched.
   */
  private carveRamp(ax: number, az: number, bx: number, bz: number, force: boolean): boolean {
    let dx = bx - ax;
    let dz = bz - az;
    let len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-3) {
      dx = 1; dz = 0; len = 1;
    }
    const ux = dx / len;
    const uz = dz / len;

    const PAD = 6;
    let x0 = ax - ux * PAD;
    let z0 = az - uz * PAD;
    let x1 = bx + ux * PAD;
    let z1 = bz + uz * PAD;

    // Two relaxation passes: extending the ends changes the endpoint heights,
    // which changes the length the grade requires.
    for (let iter = 0; iter < 2; iter++) {
      x0 = clamp(x0, 2, MAP_SIZE - 2); z0 = clamp(z0, 2, MAP_SIZE - 2);
      x1 = clamp(x1, 2, MAP_SIZE - 2); z1 = clamp(z1, 2, MAP_SIZE - 2);
      const h0 = this.heightAt(x0, z0);
      const h1 = this.heightAt(x1, z1);
      const l = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
      const need = Math.abs(h1 - h0) / TERRAIN_RAMP_MAX_GRADE;
      // Too tall to bridge at a legal grade inside the length budget. Abandon
      // rather than flatten half a plateau to get there — unless the far end is
      // a start area, in which case half a plateau is the cheaper loss.
      if (need > (force ? MAP_SIZE : TERRAIN_RAMP_MAX_LENGTH)) return false;
      if (l >= need) break;
      const extra = (need - l) * 0.5;
      x0 -= ux * extra; z0 -= uz * extra;
      x1 += ux * extra; z1 += uz * extra;
    }
    x0 = clamp(x0, 2, MAP_SIZE - 2); z0 = clamp(z0, 2, MAP_SIZE - 2);
    x1 = clamp(x1, 2, MAP_SIZE - 2); z1 = clamp(z1, 2, MAP_SIZE - 2);

    const h0 = this.heightAt(x0, z0);
    const h1 = this.heightAt(x1, z1);
    const rx = x1 - x0;
    const rz = z1 - z0;
    const rl = Math.sqrt(rx * rx + rz * rz);
    if (rl < 1e-3) return false;
    const invRl2 = 1 / (rl * rl);
    let cut = false;

    // A forced corridor is widened so that whole CELLS land inside its flat
    // core. `cellSlope` is the max over the cell, so a corridor narrower than
    // the cell grid can be cut perfectly and still classify as cliff.
    const hw = force ? TERRAIN_RAMP_FORCED_HALF_WIDTH : TERRAIN_RAMP_HALF_WIDTH;
    const core = force ? TERRAIN_RAMP_FORCED_CORE_WIDTH : TERRAIN_RAMP_CORE_WIDTH;
    const gxLo = Math.max(0, Math.floor((Math.min(x0, x1) - hw) * INV_GRID));
    const gxHi = Math.min(GRID_N, Math.ceil((Math.max(x0, x1) + hw) * INV_GRID));
    const gzLo = Math.max(0, Math.floor((Math.min(z0, z1) - hw) * INV_GRID));
    const gzHi = Math.min(GRID_N, Math.ceil((Math.max(z0, z1) + hw) * INV_GRID));

    for (let gz = gzLo; gz <= gzHi; gz++) {
      const pz = gz * GRID;
      for (let gx = gxLo; gx <= gxHi; gx++) {
        const px = gx * GRID;
        let t = ((px - x0) * rx + (pz - z0) * rz) * invRl2;
        if (t < 0 || t > 1) continue;
        const cxp = x0 + rx * t;
        const czp = z0 + rz * t;
        const ddx = px - cxp;
        const ddz = pz - czp;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d > hw) continue;

        // 1 inside the flat core, feathering to 0 at the corridor edge so the
        // cut ties into the plateau instead of leaving a floating shelf.
        const w = smoothstep(hw, core, d);
        const i = gz * GRID_STRIDE + gx;
        this.height[i] = clamp(lerp(this.height[i], h0 + (h1 - h0) * t, w), 0, TERRAIN_MAX_HEIGHT);
        cut = true;

        // Only the flat core of the corridor reads as a worn dirt track; the
        // feathered edges keep whatever surface they had.
        if (w > 0.8) {
          const cx = (px / CELL) | 0;
          const cz = (pz / CELL) | 0;
          if (isInMap(cx, cz)) this.rampGrid[cz * MAP_CELLS + cx] = 1;
        }
      }
    }
    return cut;
  }

  /* ======================================================================
   * 5. SPLAT CLASSIFICATION
   * ====================================================================== */

  /**
   * The value of a patch field that exactly `amount` of the map lies above.
   *
   * `1 - amount` IS NOT THAT VALUE, and it was used as though it were for the
   * whole life of this file. It is the right threshold only for a field that is
   * UNIFORM on [0,1], and a 3-octave normalised simplex fbm is Gaussian.
   * Measured over the real 256x256 splat grid, all four biomes, three seeds:
   * p05 0.265 · p50 0.500 · p95 0.734 · sigma 0.143. So the temperate dirt gate
   * at 0.78 sat above the 96th percentile and the sand gate at 0.90 past the
   * 99.99th, and the biome's declared coverage was off by up to 200x:
   *
   * ```
   *                  declared    patch term painted   texels w>0.5
   *   temperate dirt    22%          2.21-2.28%        1.81-1.88%
   *   temperate sand    10%          0.05%             0.01%
   *   urban     dirt    18%          0.76-0.81%        0.53-0.60%
   *   snow      dirt    14%          0.20-0.24%        0.10-0.12%
   *   desert    dirt    34%         15.38-15.89%      14.98-15.51%
   * ```
   *
   * Desert is the trap: `1 - 0.34` = 0.66 happens to land near the real 66th
   * percentile of a Gaussian centred on 0.5, so the one biome anybody would
   * spot-check looked broadly right while the other three did not.
   *
   * So measure the field instead of assuming its shape. One histogram pass over
   * the same 65 536 texel centres the classifier samples, then read the
   * quantile back off the cumulative from the top, stepping linearly inside the
   * bucket the edge lands in. Per biome, per seed, per wavelength — which is
   * what makes `dirtPatchAmount`'s docstring true for a biome nobody has
   * written yet and for any `?mapseed=`.
   *
   * DETERMINISM. This is terrain, so it is generated independently on both
   * clients of a lockstep match and must agree to the last bit. A fixed-bucket
   * histogram over a fixed sample set uses only `+ - * /` and a truncation,
   * exactly like `fbm2` itself — ECMA-262 pins those. A sort would be equally
   * exact but costs 65 536 log 65 536 comparisons and half a megabyte; a
   * Newton/bisection root-find on the CDF would NOT be safe, because its step
   * count depends on a convergence test, which is the same reason
   * `ellipseDistance` refuses one.
   *
   * COST. One extra 65 536-sample fbm pass per patch field per terrain build —
   * two per map, ~1-2 ms, at boot, on the worker `buildSplat` already runs on.
   * Nothing per frame and nothing per tick.
   *
   * 4096 buckets puts the raw quantile error at 2.4e-4, and the linear step
   * inside the landing bucket takes the delivered coverage to within 0.05
   * percentage points of `amount` — against a smoothstep halo of 0.07, which is
   * 287 buckets wide. Sharpening this further would be measuring nothing.
   */
  private patchQuantile(inv: number, salt: number, amount: number): number {
    // A gate above every sample (nothing passes) and below every sample (all of
    // it does). Both are outside the field's real range, so the smoothstep
    // still resolves to a hard 0 or 1 across its whole halo.
    if (amount <= 0) return 2;
    if (amount >= 1) return -1;

    const bins = PATCH_QUANTILE_BINS;
    const hist = new Int32Array(bins);
    const seed = this.seed + salt;
    for (let tz = 0; tz < SPLAT_N; tz++) {
      const z = (tz + 0.5) * SPLAT_METRES;
      for (let tx = 0; tx < SPLAT_N; tx++) {
        const x = (tx + 0.5) * SPLAT_METRES;
        const v = fbm2(x * inv, z * inv, 3, 2.0, 0.5, seed) * 0.5 + 0.5;
        // simplex is nominally in [-1,1] but not guaranteed to the bit, and a
        // future octave count could widen it. Clamping the INDEX rather than
        // the value keeps the tail samples counted where they belong.
        let bin = (v * bins) | 0;
        if (bin < 0) bin = 0; else if (bin >= bins) bin = bins - 1;
        hist[bin]!++;
      }
    }

    // Walk down from the top until `want` samples have been passed. Whatever
    // bucket that lands in holds the edge; assume the bucket's samples are
    // spread evenly across it and take the matching fraction of its width.
    let want = amount * (SPLAT_N * SPLAT_N);
    for (let bin = bins - 1; bin >= 0; bin--) {
      const c = hist[bin]!;
      if (c >= want) {
        const frac = c > 0 ? want / c : 0;
        return (bin + 1 - frac) / bins;
      }
      want -= c;
    }
    return 0;
  }

  /**
   * Paint the six-layer control texture and derive the per-cell dominant
   * surface from it.
   *
   * The layers resolve as a PRIORITY STACK rather than a normalised blend:
   * rock wins over sand wins over dirt wins over ground, each consuming what
   * the one above it left. That is how real ground works (a rock outcrop is
   * not 40% grass) and it keeps the sum at exactly 1 without a normalise pass.
   */
  private buildSplat(): void {
    const b = this.biomeDef;
    const s = this.seed;
    const A = this.splatA;
    const B = this.splatB;
    const invDirt = 1 / b.dirtPatchMetres;
    const invSand = 1 / (b.dirtPatchMetres * 1.7);
    const totalRise = Math.max(1e-3, b.tierCount * b.stepHeight);

    // The thresholds, MEASURED off the two fields rather than assumed from
    // their declared coverage. See `patchQuantile` for why `1 - amount` was
    // wrong and by how much. Hoisted: both were loop-invariant constants being
    // recomputed 65 536 times, and the quantile pass must not be.
    const dEdge = this.patchQuantile(invDirt, 13, b.dirtPatchAmount);
    const sEdge = b.sandPatchAmount > 0 ? this.patchQuantile(invSand, 211, b.sandPatchAmount) : 2;

    for (let tz = 0; tz < SPLAT_N; tz++) {
      const z = (tz + 0.5) * SPLAT_METRES;
      const cz = clamp((z / CELL) | 0, 0, MAP_CELLS - 1);
      for (let tx = 0; tx < SPLAT_N; tx++) {
        const x = (tx + 0.5) * SPLAT_METRES;
        const cx = clamp((x / CELL) | 0, 0, MAP_CELLS - 1);
        const ci = cz * MAP_CELLS + cx;

        const h = this.heightAt(x, z);
        const slope = this.slopeAt(x, z);
        const neighbourSlope = this.cellSlope[ci];

        // Rock: steep faces, plus a scree apron wherever the neighbourhood is
        // steep even if this exact texel is flat.
        let rock = smoothstep(b.rockSlope, CLIFF_SLOPE * 0.92, slope);
        rock = Math.max(rock, smoothstep(b.rockSlope * 1.15, CLIFF_SLOPE, neighbourSlope) * 0.34);

        // Sand: shoreline band plus inland drifts.
        //
        // The threshold windows below are DELIBERATELY narrow (+/-0.07 on a
        // 0..1 noise). A wide window turns every boundary into a 30 m gradient,
        // which is the "airbrushed procedural terrain" look; the bible wants a
        // 1.5-4 m blend, and the shader's mask warp supplies the raggedness.
        let sand = 0;
        if (b.sandBandMetres > 0) {
          sand = smoothstep(WATER_LEVEL + b.sandBandMetres, WATER_LEVEL - 0.8, h);
        }
        if (b.sandPatchAmount > 0) {
          const n = fbm2(x * invSand, z * invSand, 3, 2.0, 0.5, s + 211) * 0.5 + 0.5;
          sand = Math.max(sand, smoothstep(sEdge - 0.08, sEdge + 0.08, n));
        }

        // Dirt: blobby patches, drier with altitude, guaranteed on ramps.
        const patch = fbm2(x * invDirt, z * invDirt, 3, 2.0, 0.5, s + 13) * 0.5 + 0.5;
        let dirt = smoothstep(dEdge - 0.07, dEdge + 0.07, patch);
        dirt = clamp01(dirt + clamp01((h - b.baseHeight) / totalRise) * b.dirtAltitude);
        dirt = clamp01(dirt + smoothstep(b.rockSlope * 0.5, b.rockSlope, neighbourSlope) * 0.38);
        if (this.rampGrid[ci] !== 0) dirt = Math.max(dirt, 0.85);

        let remain = 1;
        const wRock = remain * rock; remain -= wRock;
        const wSand = remain * sand; remain -= wSand;
        const wDirt = remain * dirt; remain -= wDirt;
        const wGround = remain;

        const o = (tz * SPLAT_N + tx) * 4;
        A[o] = (wGround * 255) | 0;
        A[o + 1] = (wDirt * 255) | 0;
        A[o + 2] = (wSand * 255) | 0;
        A[o + 3] = (wRock * 255) | 0;
        B[o] = 0;
        B[o + 1] = 0;
        B[o + 2] = 0;
        B[o + 3] = 255;
      }
    }

    this.rebuildSurfaceGrid();
    this.commitSplat();
  }

  /** Recompute the per-cell dominant surface from the control texture. */
  private rebuildSurfaceGrid(): void {
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const tx = cx * TERRAIN_SPLAT_PER_CELL + (TERRAIN_SPLAT_PER_CELL >> 1);
        const tz = cz * TERRAIN_SPLAT_PER_CELL + (TERRAIN_SPLAT_PER_CELL >> 1);
        const o = (tz * SPLAT_N + tx) * 4;
        let best = 0;
        let bestW = this.splatA[o];
        for (let k = 1; k < 4; k++) {
          if (this.splatA[o + k] > bestW) { bestW = this.splatA[o + k]; best = k; }
        }
        for (let k = 0; k < 2; k++) {
          if (this.splatB[o + k] > bestW) { bestW = this.splatB[o + k]; best = 4 + k; }
        }
        this.surface[cz * MAP_CELLS + cx] = best;
      }
    }
  }

  /**
   * Paint one layer into one build cell, rescaling the others so the weights
   * still sum to 1. This is the hook the road and building-pad modules use to
   * lay concrete and cobble without adding geometry — a surface that is part
   * of the terrain splat costs zero draw calls and cannot z-fight.
   *
   * Call `commitSplat()` once after a batch of stamps.
   */
  stampSurface(cx: number, cz: number, layer: SurfaceId, weight: number): void {
    if (!isInMap(cx, cz)) return;
    const w = clamp01(weight);
    const keep = 1 - w;
    const t0x = cx * TERRAIN_SPLAT_PER_CELL;
    const t0z = cz * TERRAIN_SPLAT_PER_CELL;

    for (let dz = 0; dz < TERRAIN_SPLAT_PER_CELL; dz++) {
      for (let dx = 0; dx < TERRAIN_SPLAT_PER_CELL; dx++) {
        const o = ((t0z + dz) * SPLAT_N + t0x + dx) * 4;
        for (let k = 0; k < 4; k++) this.splatA[o + k] = (this.splatA[o + k] * keep) | 0;
        for (let k = 0; k < 2; k++) this.splatB[o + k] = (this.splatB[o + k] * keep) | 0;
        const v = (w * 255) | 0;
        if (layer < 4) this.splatA[o + layer] = v;
        else this.splatB[o + (layer - 4)] = v;
      }
    }
    this.surface[cz * MAP_CELLS + cx] = layer;
  }

  /* ======================================================================
   * 7. QUERY API — the surface eight other modules depend on
   * ====================================================================== */

  /** Bilinear ground height in metres. Clamped to the map at the edges. */
  heightAt(x: number, z: number): number {
    return heightAtGrid(this.height, x, z);
  }

  /** Geometric ground normal, written into `out` as [nx, ny, nz]. */
  normalAt(x: number, z: number, out: Float32Array): Float32Array {
    const dx = (this.heightAt(x + GRID, z) - this.heightAt(x - GRID, z)) / (2 * GRID);
    const dz = (this.heightAt(x, z + GRID) - this.heightAt(x, z - GRID)) / (2 * GRID);
    const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
    out[0] = -dx * inv;
    out[1] = inv;
    out[2] = -dz * inv;
    return out;
  }

  /** Slope in radians, bilinear. 0 is flat. */
  slopeAt(x: number, z: number): number {
    let gx = x * INV_GRID;
    let gz = z * INV_GRID;
    if (!(gx > 0)) gx = 0; else if (gx > GRID_N) gx = GRID_N;
    if (!(gz > 0)) gz = 0; else if (gz > GRID_N) gz = GRID_N;
    let x0 = gx | 0; if (x0 >= GRID_N) x0 = GRID_N - 1;
    let z0 = gz | 0; if (z0 >= GRID_N) z0 = GRID_N - 1;
    const fx = gx - x0;
    const fz = gz - z0;
    const s = this.slope;
    const r0 = z0 * GRID_STRIDE + x0;
    const r1 = r0 + GRID_STRIDE;
    const top = s[r0] + (s[r0 + 1] - s[r0]) * fx;
    const bot = s[r1] + (s[r1 + 1] - s[r1]) * fx;
    return top + (bot - top) * fz;
  }

  /** True if `loco` may enter the cell. Occupied cells are never passable. */
  isPassable(cx: number, cz: number, loco: Locomotor): boolean {
    if (!isInMap(cx, cz)) return false;
    const i = cz * MAP_CELLS + cx;
    if (this.occupant[i] !== 0) return false;
    return (this.passGrid[i] & (1 << loco)) !== 0;
  }

  /** Movement cost multiplier for a cell. `COST_BLOCKED` means impassable. */
  moveCostAt(cx: number, cz: number): number {
    if (!isInMap(cx, cz)) return COST_BLOCKED;
    return this.costGrid[cz * MAP_CELLS + cx];
  }

  /** True if a structure may be founded here: flat, dry, on-map and unoccupied. */
  isBuildable(cx: number, cz: number): boolean {
    if (!isInMap(cx, cz)) return false;
    const i = cz * MAP_CELLS + cx;
    return this.buildGrid[i] !== 0 && this.occupant[i] === 0;
  }

  isOccupied(cx: number, cz: number): boolean {
    return isInMap(cx, cz) && this.occupant[cz * MAP_CELLS + cx] !== 0;
  }

  markOccupied(cx: number, cz: number, w: number, h: number, id: EntityId): void {
    for (let z = cz; z < cz + h; z++) {
      for (let x = cx; x < cx + w; x++) {
        if (isInMap(x, z)) this.occupant[z * MAP_CELLS + x] = id as number;
      }
    }
    this.version++;
  }

  clearOccupied(cx: number, cz: number, w: number, h: number): void {
    for (let z = cz; z < cz + h; z++) {
      for (let x = cx; x < cx + w; x++) {
        if (isInMap(x, z)) this.occupant[z * MAP_CELLS + x] = 0;
      }
    }
    this.version++;
  }

  occupancyVersion(): number {
    return this.version;
  }

  isWater(cx: number, cz: number): boolean {
    return isInMap(cx, cz) && this.waterGrid[cz * MAP_CELLS + cx] !== 0;
  }

  /** True if the cell is steep enough to be a terrace face. */
  isCliff(cx: number, cz: number): boolean {
    return isInMap(cx, cz) && this.cellSlope[cz * MAP_CELLS + cx] >= CLIFF_SLOPE;
  }

  /** The dominant surface layer at a world position. */
  surfaceAt(x: number, z: number): SurfaceId {
    const cx = (x / CELL) | 0;
    const cz = (z / CELL) | 0;
    if (!isInMap(cx, cz)) return SurfaceId.Ground;
    return this.surface[cz * MAP_CELLS + cx] as SurfaceId;
  }

  /**
   * All six splat weights at a world position, written into `out` (length 6).
   * The dust and decal modules use this to tint an effect with the ground it
   * came off, which is the cheapest possible way to stop VFX reading as
   * sprites pasted on top of the scene (bible §14/R6).
   */
  surfaceWeightsAt(x: number, z: number, out: Float32Array): Float32Array {
    const tx = clamp((x / SPLAT_METRES) | 0, 0, SPLAT_N - 1);
    const tz = clamp((z / SPLAT_METRES) | 0, 0, SPLAT_N - 1);
    const o = (tz * SPLAT_N + tx) * 4;
    out[0] = this.splatA[o] / 255;
    out[1] = this.splatA[o + 1] / 255;
    out[2] = this.splatA[o + 2] / 255;
    out[3] = this.splatA[o + 3] / 255;
    out[4] = this.splatB[o] / 255;
    out[5] = this.splatB[o + 1] / 255;
    return out;
  }

  /**
   * Intersect a ray with the heightfield. Writes [x,y,z] into `out`.
   *
   * Sphere-traced rather than DDA-marched: the step is the vertical clearance
   * scaled down, so a cursor ray from 50 m up resolves in a dozen iterations
   * instead of 500, and it degrades gracefully to a fine march near the
   * surface where precision matters.
   */
  raycastGround(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    out: Float32Array,
  ): boolean {
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < 1e-9) return false;
    const nx = dx / dl;
    const ny = dy / dl;
    const nz = dz / dl;

    // Clip to the map's XZ slab so a ray parallel to the ground terminates.
    let tMin = 0;
    let tMax = MAP_SIZE * 3;
    if (!slabClip(ox, nx, 0, MAP_SIZE)) return false;
    tMin = Math.max(tMin, SLAB[0]);
    tMax = Math.min(tMax, SLAB[1]);
    if (!slabClip(oz, nz, 0, MAP_SIZE)) return false;
    tMin = Math.max(tMin, SLAB[0]);
    tMax = Math.min(tMax, SLAB[1]);
    if (tMin > tMax) return false;

    let t = tMin;
    let px = ox + nx * t;
    let py = oy + ny * t;
    let pz = oz + nz * t;
    let prevT = t;
    let prevGap = py - this.heightAt(px, pz);

    if (prevGap <= 0) {
      out[0] = px; out[1] = py; out[2] = pz;
      return true;
    }

    for (let i = 0; i < 512 && t < tMax; i++) {
      const step = clamp(prevGap * 0.7, GRID * 0.5, 12);
      t = Math.min(t + step, tMax);
      px = ox + nx * t;
      py = oy + ny * t;
      pz = oz + nz * t;
      const gap = py - this.heightAt(px, pz);

      if (gap <= 0) {
        // Bisect the bracketing interval for a sub-centimetre hit point.
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) * 0.5;
          const mx = ox + nx * mid;
          const my = oy + ny * mid;
          const mz = oz + nz * mid;
          if (my - this.heightAt(mx, mz) > 0) lo = mid; else hi = mid;
        }
        out[0] = ox + nx * hi;
        out[1] = oy + ny * hi;
        out[2] = oz + nz * hi;
        return true;
      }
      prevT = t;
      prevGap = gap;
      if (t >= tMax) break;
    }
    return false;
  }

  /** Alias of `raycastGround` — the name most callers reach for first. */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    out: Float32Array,
  ): boolean {
    return this.raycastGround(ox, oy, oz, dx, dy, dz, out);
  }

  /* ======================================================================
   * 8. LIFECYCLE
   * ====================================================================== */

  /**
   * Switch biome. Rebuilds the heightfield, the grids, the splat and the
   * chunk meshes; the material programs are untouched, so this costs one
   * generation pass and no shader compile.
   */
  setBiome(name: BiomeName | string): void {
    const next = getBiome(name);
    if (next.key === this.biomeDef.key) return;
    this.biomeDef = next;
    this.rampGrid.fill(0);
    this.applyBiomeToMaterials(next);
    this.generate();
  }

  /** Re-roll the landform with a new seed, keeping the biome. */
  setSeed(seed: number): void {
    this.seed = seed | 0;
    this.rampGrid.fill(0);
    this.generate();
  }
}

/* ==========================================================================
 * 9. MODULE-PRIVATE HELPERS
 * ========================================================================== */

/**
 * Bilinear ground height over a raw heightfield. Clamped to the map at the
 * edges.
 *
 * A FREE FUNCTION, not just a method, because the water bake needs exactly this
 * arithmetic and cannot have a `Terrain` — it runs in a worker holding nothing
 * but the height array. `TerrainFields.heightAt` is one call into here, so
 * there is a single implementation and "the worker sampled the bed the same way
 * the main thread would have" is true by construction rather than by review.
 */
export function heightAtGrid(h: Float32Array, x: number, z: number): number {
  let gx = x * INV_GRID;
  let gz = z * INV_GRID;
  if (!(gx > 0)) gx = 0; else if (gx > GRID_N) gx = GRID_N;
  if (!(gz > 0)) gz = 0; else if (gz > GRID_N) gz = GRID_N;
  let x0 = gx | 0; if (x0 >= GRID_N) x0 = GRID_N - 1;
  let z0 = gz | 0; if (z0 >= GRID_N) z0 = GRID_N - 1;
  const fx = gx - x0;
  const fz = gz - z0;
  const r0 = z0 * GRID_STRIDE + x0;
  const r1 = r0 + GRID_STRIDE;
  const top = h[r0] + (h[r0 + 1] - h[r0]) * fx;
  const bot = h[r1] + (h[r1 + 1] - h[r1]) * fx;
  return top + (bot - top) * fz;
}

/** Ray/slab clip result, module scratch. `raycastGround` allocates nothing. */
const SLAB = new Float32Array(2);

/** Clip a ray against one axis slab. Writes [tNear, tFar] into SLAB. */
function slabClip(origin: number, dir: number, lo: number, hi: number): boolean {
  if (Math.abs(dir) < 1e-9) {
    if (origin < lo || origin > hi) return false;
    SLAB[0] = -1e9;
    SLAB[1] = 1e9;
    return true;
  }
  let t0 = (lo - origin) / dir;
  let t1 = (hi - origin) / dir;
  if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
  SLAB[0] = t0;
  SLAB[1] = t1;
  return t1 >= 0;
}

/* ==========================================================================
 * 10. THE WORKER ENTRY
 *
 * Two functions and a key. `runTerrainJob` in `src/core/workers/protocol.ts` is
 * the only caller of `generateTerrainFields`, and `world-warm.ts` is the only
 * caller of `terrainGenKey`.
 * ========================================================================== */

/**
 * A stable identity for one set of generation inputs.
 *
 * The prewarm and the eventual `new Terrain(...)` are written in two different
 * files and reached through two different code paths, so "these are the same
 * map" cannot be an assumption. It is this string, compared exactly. A miss is
 * not an error — it means the prewarmed fields are for a different map and the
 * caller generates its own, which is the behaviour that shipped before any of
 * this existed.
 *
 * `JSON.stringify` on an object literal is order-stable in every engine we run
 * on because the key order is the source order, and both callers build the
 * object through this one function.
 */
export function terrainGenKey(options: TerrainGenOptions): string {
  const sea = options.sea ?? null;
  return JSON.stringify({
    seed: options.seed | 0,
    biome: getBiome(options.biome).key,
    starts: options.starts === undefined
      ? null
      : options.starts.map((p) => [p.x, p.z]),
    sea: sea === null ? null : [
      sea.x, sea.z, sea.normalX, sea.normalZ, sea.depth, sea.shelfMetres,
      sea.bandWidth, sea.wavinessMetres, sea.wavelengthMetres,
    ],
    /*
     * APPENDED AS SEPARATE KEYS, and `undefined` when absent so `JSON.stringify`
     * DROPS them. Two islands' worth of numbers spliced into the `sea` array
     * would have been tidier to read and would have changed the key of every
     * map that has no islands, which is all of them — and a changed key is a
     * prewarm miss, i.e. a boot that silently regenerates the terrain on the
     * main thread. Same reason `starts` is its own key.
     */
    islands: hasIslands(sea)
      ? sea.islands.map((i) => [i.x, i.z, i.radiusX, i.radiusZ])
      : undefined,
    shoals: hasShoals(sea)
      ? sea.shoals.map((s) => [s.x, s.z, s.radiusX, s.radiusZ, s.depth])
      : undefined,
  });
}

/**
 * Vertex attributes for all 64 chunk meshes, from a finished heightfield.
 *
 * Two things here are load-bearing and were load-bearing when this lived inside
 * `Terrain.buildMeshes`:
 *
 *  1. **Vertex normals use a CLAMPED gradient.** A 6 m terrace face beside a
 *     flat plateau would otherwise drag the plateau's normals down and put a
 *     soft shading ramp along every cliff top. Clamping the per-step delta to
 *     `TERRAIN_GROUND_NORMAL_CLAMP` keeps the plateau flat; the face gets its
 *     real normal back from screen-space derivatives inside the cliff shader.
 *  2. **Steep triangles are COUNTED.** One index list feeds one material and
 *     the shader picks its shading model per triangle, but a chunk whose steep
 *     triangles cover under ~4% of its area has nothing a 38-degree sun could
 *     throw far enough to notice, and is kept out of the shadow map entirely.
 *  3. **A flat chunk gets a SECOND, half-resolution index.** Same vertices,
 *     same normals, same attributes — 2424 triangles instead of 8192. See
 *     `buildChunkLodIndex` and `chunkLodError`.
 *
 * The ONE implementation, called from the worker and from `Terrain.buildMeshes`
 * alike, so an adopted mesh and a locally derived one are the same vertices.
 */
export function buildTerrainChunks(
  height: Float32Array, wallUp: Float32Array, wallTop: Float32Array,
): TerrainChunkData[] {
  const S = CHUNK_QUADS;
  const vn = (S + 1) * (S + 1);
  const clampD = TERRAIN_GROUND_NORMAL_CLAMP;
  const out: TerrainChunkData[] = [];

  for (let cz = 0; cz < CHUNK_N; cz++) {
    for (let cx = 0; cx < CHUNK_N; cx++) {
      const g0x = Math.round((cx * TERRAIN_CHUNK_METRES) * INV_GRID);
      const g0z = Math.round((cz * TERRAIN_CHUNK_METRES) * INV_GRID);

      const position = new Float32Array(vn * 3);
      const normal = new Float32Array(vn * 3);
      const up = new Float32Array(vn);
      const top = new Float32Array(vn);

      for (let vz = 0; vz <= S; vz++) {
        const gz = g0z + vz;
        const row = gz * GRID_STRIDE;
        const zm = (gz > 0 ? gz - 1 : 0) * GRID_STRIDE;
        const zp = (gz < GRID_N ? gz + 1 : GRID_N) * GRID_STRIDE;
        for (let vx = 0; vx <= S; vx++) {
          const gx = g0x + vx;
          const v = vz * (S + 1) + vx;
          const gi = row + gx;
          const xm = gx > 0 ? gx - 1 : 0;
          const xp = gx < GRID_N ? gx + 1 : GRID_N;

          position[v * 3] = vx * GRID;
          position[v * 3 + 1] = height[gi];
          position[v * 3 + 2] = vz * GRID;

          const dx = clamp(height[row + xp] - height[row + xm], -clampD * 2, clampD * 2);
          const dz = clamp(height[zp + gx] - height[zm + gx], -clampD * 2, clampD * 2);
          const nx = -dx / (2 * GRID);
          const nz = -dz / (2 * GRID);
          const inv = 1 / Math.sqrt(nx * nx + nz * nz + 1);
          normal[v * 3] = nx * inv;
          normal[v * 3 + 1] = inv;
          normal[v * 3 + 2] = nz * inv;

          up[v] = wallUp[gi];
          top[v] = wallTop[gi];
        }
      }

      const index = new Uint16Array(S * S * 6);
      let w = 0;
      let cliffTris = 0;
      for (let vz = 0; vz < S; vz++) {
        for (let vx = 0; vx < S; vx++) {
          const a = vz * (S + 1) + vx;
          const b = a + (S + 1);
          const c = a + 1;
          const d = b + 1;
          index[w] = a; index[w + 1] = b; index[w + 2] = c;
          index[w + 3] = c; index[w + 4] = b; index[w + 5] = d;
          w += 6;
          if (isCliffTri(position, a, b, c)) cliffTris++;
          if (isCliffTri(position, c, b, d)) cliffTris++;
        }
      }

      /*
       * THE LOD GATE — two clauses, and both are necessary.
       *
       *  `cliffTris === 0` is the relief metric this file already computed for
       *  the shadow decision, and using it here is what keeps the two from
       *  disagreeing: `chunkCastsShadow` needs 4% of the chunk's triangles to
       *  be steep, so a chunk that decimates is two orders of magnitude clear
       *  of casting. A chunk can never throw a shadow from geometry its index
       *  buffer no longer holds. `tests/terrain-lod.spec.ts` pins that.
       *
       *  `lodError` is what decimation actually breaks, measured rather than
       *  inferred. The two gates very nearly select the same chunks (see
       *  `TERRAIN_LOD_MAX_ERROR`), which is the reassuring result rather than a
       *  reason to drop one: they are different questions and they agree.
       */
      const lodError = chunkLodError(height, g0x, g0z);
      const lodIndex = cliffTris === 0 && lodError <= TERRAIN_LOD_MAX_ERROR
        ? buildChunkLodIndex()
        : null;

      out.push({ cx, cz, position, normal, up, top, index, lodIndex, cliffTris, lodError });
    }
  }
  return out;
}

/**
 * True when a chunk holding this many steep triangles is submitted to the
 * shadow map.
 *
 * ONE PREDICATE, TWO CALLERS, and that is the entire reason it is a function:
 * `Terrain.buildMeshes` sets `castShadow` from it, and `buildTerrainChunks`
 * refuses to decimate anything it returns true for. Those two have to agree —
 * a chunk that casts from triangles it no longer draws is a shadow with no
 * object — and as two bare `0.04` literals in two files they eventually would
 * not.
 */
export function chunkCastsShadow(cliffTris: number): boolean {
  return cliffTris >= CHUNK_QUADS * CHUNK_QUADS * 2 * TERRAIN_SHADOW_CLIFF_FRACTION;
}

/**
 * Metres of height error `buildChunkLodIndex` would introduce on this chunk.
 *
 * Every heightfield sample the coarse index drops lands on exactly one coarse
 * primitive — an edge between two surviving samples, or a cell's own diagonal —
 * and the drawn surface runs straight along it. So the error at that sample is
 * its distance from the midpoint of the two ends, and the chunk's error is the
 * largest of those. Nothing here is a heuristic: it is the exact vertical gap
 * between the two meshes at every point where they can differ.
 *
 * WHAT IS SKIPPED, AND WHY EACH ONE IS RIGHT:
 *
 *  - Even/even samples SURVIVE — they are the coarse corners.
 *  - The chunk PERIMETER survives in full, at fine resolution. That is the
 *    crack strategy; see `buildChunkLodIndex`.
 *  - The centre of a chunk-edge cell survives, because it is that cell's fan
 *    apex. `vx === 1 || vx === S - 1 || vz === 1 || vz === S - 1` is exactly
 *    the set of odd/odd samples that are a fan apex.
 *
 * Only `+`, `-`, `*` and comparison, all of which ECMA-262 pins exactly, so two
 * engines cannot select a different LOD for the same map.
 */
function chunkLodError(height: Float32Array, g0x: number, g0z: number): number {
  const S = CHUNK_QUADS;
  let max = 0;
  for (let vz = 1; vz < S; vz++) {
    const row = (g0z + vz) * GRID_STRIDE + g0x;
    const oz = vz & 1;
    for (let vx = 1; vx < S; vx++) {
      const ox = vx & 1;
      if (ox === 0 && oz === 0) continue;
      if (ox === 1 && oz === 1
        && (vx === 1 || vx === S - 1 || vz === 1 || vz === S - 1)) continue;

      let a: number;
      let b: number;
      if (ox === 1 && oz === 1) {
        // The cell centre sits on the b-c diagonal the two-triangle split cuts.
        a = height[(g0z + vz + 1) * GRID_STRIDE + g0x + vx - 1];
        b = height[(g0z + vz - 1) * GRID_STRIDE + g0x + vx + 1];
      } else if (ox === 1) {
        a = height[row + vx - 1];
        b = height[row + vx + 1];
      } else {
        a = height[(g0z + vz - 1) * GRID_STRIDE + g0x + vx];
        b = height[(g0z + vz + 1) * GRID_STRIDE + g0x + vx];
      }
      const e = Math.abs(height[row + vx] - (a + b) * 0.5);
      if (e > max) max = e;
    }
  }
  return max;
}

/**
 * The half-resolution index for one chunk.
 *
 * THE PROBLEM THIS SOLVES IS T-JUNCTION CRACKS, and it is the only part of a
 * terrain LOD that is hard. Drop every second sample from a chunk and its
 * shared edge with a full-resolution neighbour now runs straight between two
 * samples 2 m apart, while the neighbour's edge still bends through the sample
 * in the middle. The two surfaces meet at the corners and part company between
 * them, and the gap is a hole you can see the sky through.
 *
 * THE STRATEGY: KEEP THE BOUNDARY AT FULL RESOLUTION. Every one of the 65
 * samples along each chunk edge is still a triangle corner here, so the coarse
 * chunk's boundary polyline is IDENTICAL to a fine neighbour's, vertex for
 * vertex, and a crack is not merely unlikely but arithmetically impossible.
 * The cost is one ring of stitched cells: 624 triangles of the 2424, against
 * 1800 for the 900 interior cells that decimate freely.
 *
 * It was chosen over the two alternatives for reasons that are about this
 * codebase rather than about taste:
 *
 *  - **"Only decimate where all four neighbours also decimate"** makes the LOD
 *    of one chunk depend on its neighbours', which is a second pass and a
 *    tie-break rule, and on the measured seeds the qualifying chunks are
 *    scattered rather than clustered — so it would have cancelled most of the
 *    already-small saving. It also still cracks at the outside of the
 *    qualifying blob unless the blob's rim is stitched, i.e. it needs this
 *    machinery anyway.
 *  - **Skirts** hide the crack behind a downward flange instead of removing it.
 *    They cost geometry (the thing being saved), they need a depth to guess at,
 *    and on a map whose whole grade depends on a ground-bounce fill they put an
 *    unlit vertical face at every chunk seam. Worse, the artefact survives — it
 *    just moves from "sky through the ground" to "a seam of wrong shading" —
 *    and `tools/metrics.mjs` cannot see either one. A fix a frame-wide metric
 *    cannot check has to be structural.
 *
 * THE STITCH. A coarse cell is 2x2 fine quads with corners `a` (-x,-z), `b`
 * (-x,+z), `c` (+x,-z), `d` (+x,+z), matching the full mesh's own winding. An
 * interior cell is `a,b,c` + `c,b,d`, the coarse twin of the fine quad. A cell
 * on the chunk edge instead walks its perimeter — `a`, `b`, `d`, `c` with the
 * fine mid-edge sample spliced into every side that IS a chunk edge — and fans
 * it from the cell's own centre sample. The apex is the centre rather than an
 * opposite corner because the centre is a real sample that is never collinear
 * with any perimeter segment: fanning from a corner would emit a triangle whose
 * three vertices lie on one straight line in plan, i.e. a sliver with no area
 * and an undefined normal.
 *
 * ONE TOPOLOGY FOR EVERY CHUNK — the index depends only on `CHUNK_QUADS`, never
 * on the heights — so `CHUNK_LOD_INDICES` is exact and the wire guard can check
 * a length rather than a range.
 */
function buildChunkLodIndex(): Uint16Array {
  const S = CHUNK_QUADS;
  const CN = CHUNK_LOD_QUADS;
  const stride = S + 1;
  const out = new Uint16Array(CHUNK_LOD_INDICES);
  // Perimeter scratch: 4 corners plus at most 4 spliced mid-edge samples.
  const ring = new Int32Array(8);
  let w = 0;

  for (let cj = 0; cj < CN; cj++) {
    const z0 = cj * 2;
    const z1 = z0 + 1;
    const z2 = z0 + 2;
    for (let ci = 0; ci < CN; ci++) {
      const x0 = ci * 2;
      const x1 = x0 + 1;
      const x2 = x0 + 2;

      const a = z0 * stride + x0;
      const b = z2 * stride + x0;
      const c = z0 * stride + x2;
      const d = z2 * stride + x2;

      const west = ci === 0;
      const east = ci === CN - 1;
      const south = cj === 0;
      const north = cj === CN - 1;

      if (!west && !east && !south && !north) {
        out[w] = a; out[w + 1] = b; out[w + 2] = c;
        out[w + 3] = c; out[w + 4] = b; out[w + 5] = d;
        w += 6;
        continue;
      }

      // a -> b along the west side, b -> d along the north, d -> c along the
      // east, c -> a along the south. Same circulation as the two-triangle
      // split above, so both kinds of cell face the same way.
      let n = 0;
      ring[n++] = a;
      if (west) ring[n++] = z1 * stride + x0;
      ring[n++] = b;
      if (north) ring[n++] = z2 * stride + x1;
      ring[n++] = d;
      if (east) ring[n++] = z1 * stride + x2;
      ring[n++] = c;
      if (south) ring[n++] = z0 * stride + x1;

      const apex = z1 * stride + x1;
      for (let k = 0; k < n; k++) {
        out[w] = apex;
        out[w + 1] = ring[k];
        out[w + 2] = ring[k + 1 === n ? 0 : k + 1];
        w += 3;
      }
    }
  }
  return out;
}

/**
 * True if a triangle is steeper than `CLIFF_SLOPE`. The same threshold the nav
 * grid and the shader use, so "a face a unit cannot climb" and "a face that
 * renders as rock" are the same set of triangles by construction.
 */
function isCliffTri(pos: Float32Array, a: number, b: number, c: number): boolean {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
  const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return len > 1e-9 && Math.abs(ny) / len < CLIFF_NY;
}

/**
 * Generate one terrain, off the main thread or on it. Pure, synchronous, and
 * the ONLY implementation — `Terrain` runs the identical `generate()` through
 * the identical class, which is what makes the byte-identity claim a fact about
 * the code rather than a hope about two copies of it.
 *
 * `Date.now` rather than `performance.now`: this runs inside a worker as well
 * as on the main thread, and the number is a log line, never a sim input.
 */
export function generateTerrainFields(options: TerrainGenOptions): TerrainFieldData {
  const t0 = Date.now();
  const fields = new TerrainFields(options);
  fields.generate();
  const chunks = buildTerrainChunks(fields.height, fields.wallUp, fields.wallTop);
  return fields.snapshot(terrainGenKey(options), chunks, Date.now() - t0);
}

/**
 * The buffers a field set owns, for `postMessage`'s transfer list.
 *
 * ~6 MB of typed array per map. Structured-cloning that back would spend
 * main-thread time copying, which is most of what the worker was started to
 * avoid. Duplicates are filtered because transferring one buffer twice is a
 * hard `DataCloneError` — these are all distinct today, and a future
 * `subarray` view would not be.
 */
export function terrainFieldTransfers(data: TerrainFieldData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const arrays: (Float32Array | Uint8Array | Uint16Array)[] = [
    data.height, data.slope, data.wallUp, data.wallTop,
    data.cellHeight, data.cellSlope, data.surface, data.passGrid,
    data.costGrid, data.buildGrid, data.waterGrid, data.rampGrid,
    data.startMask, data.splatA, data.splatB,
  ];
  for (const c of data.chunks) {
    arrays.push(c.position, c.normal, c.up, c.top, c.index);
    // Null on most chunks, and pushing it conditionally is the point: an
    // `undefined` in the transfer list is a hard `DataCloneError`, not a skip.
    if (c.lodIndex !== null) arrays.push(c.lodIndex);
  }
  for (const a of arrays) {
    const buf = a.buffer;
    if (buf instanceof ArrayBuffer && !out.includes(buf)) out.push(buf);
  }
  return out;
}

/**
 * ============================================================================
 * VOLTMARCH — src/core/workers/protocol.ts
 * ============================================================================
 * THE WIRE FORMAT BETWEEN THE MAIN THREAD AND THE WORKER.
 *
 * Everything crossing `postMessage` is defined here, together with the
 * functions that actually do the work — `runTextureJob`, `runGreebleJob`,
 * `runTerrainJob`, `runWaterJob`. The worker entry (`textureWorker.ts`) is a
 * nine-line shim over `runJob`, which means every job body is reachable from a
 * Node test with no `Worker` in sight. That matters: the suite runs
 * `environment: 'node'`, so anything that only exists inside a real worker is
 * code nothing can gate.
 *
 * TWO RULES THIS FILE EXISTS TO KEEP
 * ----------------------------------
 * 1. EVERY FIELD MUST SURVIVE STRUCTURED CLONE. Plain objects, numbers,
 *    strings, arrays and typed arrays only. No class instances, no functions,
 *    no `THREE.*`. `TextureRequest.path` may be a list of polygons, which is
 *    arrays of numbers — that clones.
 * 2. ONE GENERATOR RUN PER JOB. A job names a request and a LIST of channels,
 *    because a material wants albedo + normal + orm off a single surface. A
 *    job per channel would triple the generator cost to buy nothing.
 *
 * Nothing here imports THREE, and nothing here may. The whole point of the
 * `surfaces.ts`, `greeble-gen.ts`, `terrain-gen.ts` and `water-gen.ts` splits
 * is that the worker chunk does not carry a renderer.
 * ============================================================================
 */

import {
  generateSurface, packChannel, resolveParams, usesStructuralNormal,
  type Channel, type TextureRequest,
} from '../surfaces';
import {
  generateGreebleAtlas, greebleTransfers,
  type GreebleAtlasData, type GreebleSpec,
} from '../../art/greeble-gen';
import { MAP_CELL_COUNT } from '../config';
import {
  CHUNK_INDICES, CHUNK_LOD_INDICES, CHUNK_N, CHUNK_VERTS, GRID_COUNT, SPLAT_BYTES,
  TERRAIN_CHUNKS,
  generateTerrainFields, heightAtGrid, terrainFieldTransfers,
  type TerrainFieldData, type TerrainGenOptions,
} from '../../world/terrain-gen';
import {
  FIELD_BYTES, FIELD_TEXELS, bakeWaterFields, waterFieldTransfers,
  type WaterFieldData,
} from '../../world/water-gen';
import {
  MACRO_N, WARP_N, generateTerrainTextures, terrainTextureTransfers,
  type TerrainTextureData,
} from '../../world/terrain-texture-gen';
import {
  generateWaterTextures, waterTextureTransfers, type WaterTextureData,
} from '../../world/water-texture-gen';
import { BIOMES, SURFACE_COUNT, isBiomeName } from '../../world/Biomes';

/* ==========================================================================
 * MESSAGES
 * ========================================================================== */

/** Main thread -> worker. One generator run, one or more packings. */
export interface TextureJob {
  /** Correlates the reply. Unique per pool, monotonic. */
  readonly id: number;
  /**
   * What to generate. `channel` on the request itself is IGNORED — `channels`
   * below is authoritative, so one job can serve a whole material.
   */
  readonly request: TextureRequest;
  /** Which packings to produce, in the order the reply will carry them. */
  readonly channels: readonly Channel[];
}

/** One packed channel coming back. */
export interface TextureLayer {
  readonly channel: Channel;
  /** RGBA bytes, length size*size*4. Transferred, not copied. */
  readonly data: Uint8Array;
  readonly size: number;
  /** True when these bytes are sRGB-encoded colour (albedo and mask). */
  readonly srgb: boolean;
}

/** Worker -> main thread, the good case. */
export interface TextureJobDone {
  readonly kind: 'texture:done';
  readonly id: number;
  /** One entry per requested channel, in request order. */
  readonly layers: readonly TextureLayer[];
}

/**
 * Worker -> main thread, the bad case. A generator throwing must NOT take the
 * worker down: the main thread needs a reply it can act on so it can generate
 * that one texture itself and carry on.
 */
export interface TextureJobFailed {
  readonly kind: 'texture:failed';
  readonly id: number;
  readonly reason: string;
}

export type TextureReply = TextureJobDone | TextureJobFailed;

/* ==========================================================================
 * GREEBLE JOBS — the second job kind
 *
 * A greeble atlas is not a texture job wearing a hat: it produces FOUR byte
 * packings plus a `Surface` of eight float fields plus a structure mask plus
 * six measured scalars, all off one generator run. Forcing it through
 * `TextureJob`'s one-request/many-channels shape would have meant either five
 * generator runs or a `channels` list that lies about what comes back.
 *
 * So it is a separate kind on the same wire, and `isJob` below dispatches on
 * it. The pool, the worker shim and the transfer accounting are shared; only
 * the payload differs.
 * ========================================================================== */

export interface GreebleJob {
  readonly kind: 'greeble';
  readonly id: number;
  readonly spec: GreebleSpec;
}

export interface GreebleJobDone {
  readonly kind: 'greeble:done';
  readonly id: number;
  readonly data: GreebleAtlasData;
}

export interface GreebleJobFailed {
  readonly kind: 'greeble:failed';
  readonly id: number;
  readonly reason: string;
}

export type GreebleReply = GreebleJobDone | GreebleJobFailed;

/* ==========================================================================
 * WORLD JOBS — terrain and water, the third and fourth kinds
 *
 * These are not textures wearing a hat either. A terrain job produces fifteen
 * typed arrays, a start-shelf list and a report; a water job produces four
 * arrays and four measured scalars, and it needs the TERRAIN'S HEIGHTFIELD as
 * an input, which no other job kind has.
 *
 * WHY WATER TAKES THE HEIGHT ARRAY AND NOT A TERRAIN. `Water` bakes against a
 * `bedHeight(x, z)` function, and a function does not cross `postMessage`. So
 * the job carries the heightfield and `runWaterJob` rebuilds the bed with
 * `heightAtGrid` — which is the exact function `Terrain.heightAt` calls. Not an
 * equivalent one; the same one.
 *
 * WHY THE HEIGHT IS COPIED INTO THE JOB RATHER THAN TRANSFERRED. The main
 * thread is about to build a terrain out of that array. Transferring it would
 * detach it and leave the map with an empty heightfield — the kind of bug that
 * renders as a flat black plane and reports no error at all.
 * ========================================================================== */

export interface TerrainJob {
  readonly kind: 'terrain';
  readonly id: number;
  readonly options: TerrainGenOptions;
}

export interface TerrainJobDone {
  readonly kind: 'terrain:done';
  readonly id: number;
  readonly data: TerrainFieldData;
}

export interface TerrainJobFailed {
  readonly kind: 'terrain:failed';
  readonly id: number;
  readonly reason: string;
}

export type TerrainReply = TerrainJobDone | TerrainJobFailed;

export interface WaterJob {
  readonly kind: 'water';
  readonly id: number;
  /** Stamped onto the reply so the main thread can prove what it is adopting. */
  readonly key: string;
  /** The bed: a terrain heightfield, `GRID_COUNT` samples. Copied, not transferred. */
  readonly height: Float32Array;
  /** Still-water surface height, metres. */
  readonly level: number;
  /** Seabed noise seed. */
  readonly seed: number;
}

export interface WaterJobDone {
  readonly kind: 'water:done';
  readonly id: number;
  readonly data: WaterFieldData;
}

export interface WaterJobFailed {
  readonly kind: 'water:failed';
  readonly id: number;
  readonly reason: string;
}

export type WaterReply = WaterJobDone | WaterJobFailed;

/* ==========================================================================
 * WORLD TEXTURE JOBS — the fifth and sixth kinds
 *
 * The TILES the terrain and water materials sample, as opposed to the FIELDS
 * the two world jobs above produce. They are a separate pair rather than an
 * extra channel on the terrain and water jobs, and the reason is scheduling
 * rather than tidiness:
 *
 *   a terrain FIELD set is a generation of this map — seed, biome, start
 *   layout, shoreline — and a water FIELD set is a bake over the heightfield
 *   that generation produced, so water cannot start until terrain finishes.
 *
 *   a terrain TEXTURE set depends on `(biome, layerTextureSize, seed)` and a
 *   water TEXTURE set on `(textureSize, seed)`. Neither reads a heightfield,
 *   so neither has to wait for anything.
 *
 * Folding them into the existing jobs would have chained ~420 ms of tile
 * generation behind a ~560 ms heightfield for no reason, and chained the water
 * tiles behind both. As separate kinds they are dispatched at the same instant
 * and the pool spreads them over two workers. See `world-warm.ts`.
 *
 * THE BIOME CROSSES AS A KEY, NOT A RECORD. `BiomeDef` is a large nested object
 * and structured-cloning it per job would be pointless when both sides already
 * have `BIOMES` compiled in — `Biomes.ts` imports nothing at all, so the worker
 * carries it for free. The job names a biome and `runTerrainTexJob` looks it
 * up, which also means an unknown name is refused by the guard rather than
 * producing a set of undefined layers.
 * ========================================================================== */

export interface TerrainTexJob {
  readonly kind: 'terrainTex';
  readonly id: number;
  /** A key into `BIOMES`. Validated before use. */
  readonly biome: string;
  /** Edge length of each layer albedo. */
  readonly size: number;
  /** Drives the warp and macro tiles; the layers take their own per-layer seeds. */
  readonly seed: number;
}

export interface TerrainTexJobDone {
  readonly kind: 'terrainTex:done';
  readonly id: number;
  readonly data: TerrainTextureData;
}

export interface TerrainTexJobFailed {
  readonly kind: 'terrainTex:failed';
  readonly id: number;
  readonly reason: string;
}

export type TerrainTexReply = TerrainTexJobDone | TerrainTexJobFailed;

export interface WaterTexJob {
  readonly kind: 'waterTex';
  readonly id: number;
  /** Edge length of the lace tile; the slope map is half this. */
  readonly size: number;
  readonly seed: number;
}

export interface WaterTexJobDone {
  readonly kind: 'waterTex:done';
  readonly id: number;
  readonly data: WaterTextureData;
}

export interface WaterTexJobFailed {
  readonly kind: 'waterTex:failed';
  readonly id: number;
  readonly reason: string;
}

export type WaterTexReply = WaterTexJobDone | WaterTexJobFailed;

/** Everything the worker may be sent. */
export type WorkerJob =
  TextureJob | GreebleJob | TerrainJob | WaterJob | TerrainTexJob | WaterTexJob;
/** Everything the worker may send back. */
export type WorkerReply =
  TextureReply | GreebleReply | TerrainReply | WaterReply | TerrainTexReply | WaterTexReply;

/* ==========================================================================
 * VALIDATION
 *
 * `MessageEvent.data` is `unknown` and must be treated as such. These are real
 * type guards rather than casts — a malformed message is a bug we want to see
 * as a clean fallback, not as a `TypeError` three frames later.
 * ========================================================================== */

const CHANNELS: ReadonlySet<string> = new Set(['albedo', 'normal', 'orm', 'mask']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** True when `v` is a well-formed job. Used by the worker on every message. */
export function isTextureJob(v: unknown): v is TextureJob {
  if (!isRecord(v)) return false;
  // A texture job is the ONE kind with no top-level discriminator — its
  // discriminator is nested at `request.kind` and it predates there being a
  // second job. So the test is "carries no top-level kind", which stays correct
  // as kinds are added rather than needing a line per new kind.
  if (v.kind !== undefined) return false;
  if (typeof v.id !== 'number') return false;
  if (!isRecord(v.request) || typeof v.request.kind !== 'string') return false;
  if (!Array.isArray(v.channels) || v.channels.length === 0) return false;
  return v.channels.every((c: unknown) => typeof c === 'string' && CHANNELS.has(c));
}

/**
 * True when `v` is a well-formed greeble job.
 *
 * `size` is checked because it decides eight `Float32Array(size²)` allocations
 * inside the generator, and a malformed message reaching that unchecked is an
 * out-of-memory kill of the worker rather than a rejected message. 2048 is well
 * past anything the art uses (512) and far short of anything dangerous.
 */
export function isGreebleJob(v: unknown): v is GreebleJob {
  if (!isRecord(v)) return false;
  if (v.kind !== 'greeble') return false;
  if (typeof v.id !== 'number') return false;
  if (!isRecord(v.spec)) return false;
  const size = v.spec.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 4 || size > 2048) return false;
  return typeof v.spec.key === 'string';
}

/** True when `v` is a well-formed reply. Used by the pool on every message. */
export function isTextureReply(v: unknown): v is TextureReply {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'number') return false;
  if (v.kind === 'texture:failed') return typeof v.reason === 'string';
  if (v.kind !== 'texture:done') return false;
  if (!Array.isArray(v.layers)) return false;
  return v.layers.every((l: unknown) =>
    isRecord(l)
    && typeof l.channel === 'string' && CHANNELS.has(l.channel)
    && typeof l.size === 'number'
    && typeof l.srgb === 'boolean'
    && l.data instanceof Uint8Array);
}

/**
 * True when `v` is a well-formed greeble reply.
 *
 * Every array is checked for TYPE, because these come back as transferred
 * buffers and are then handed straight to `THREE.DataTexture` and to the R1
 * gate's coverage maths. A `data.structure` that arrived as a plain object
 * would surface as a silently-wrong coverage number rather than as an error,
 * and a wrong number that passes a gate is worse than a missing one.
 */
export function isGreebleReply(v: unknown): v is GreebleReply {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'number') return false;
  if (v.kind === 'greeble:failed') return typeof v.reason === 'string';
  if (v.kind !== 'greeble:done') return false;
  const d = v.data;
  if (!isRecord(d)) return false;
  if (typeof d.key !== 'string' || typeof d.size !== 'number') return false;
  if (!isRecord(d.spec) || !isRecord(d.metrics)) return false;
  if (!(d.structure instanceof Float32Array)) return false;
  for (const k of ['albedo', 'normal', 'orm', 'emissive'] as const) {
    if (!(d[k] instanceof Uint8Array)) return false;
  }
  const s = d.surface;
  if (!isRecord(s)) return false;
  for (const k of ['albedo', 'height', 'roughness', 'metalness', 'ao', 'alpha',
    'teamMask', 'emissive'] as const) {
    if (!(s[k] instanceof Float32Array)) return false;
  }
  return true;
}

/* -- world guards ---------------------------------------------------------
 *
 * These are longer than the two above and deliberately so. A terrain field set
 * is what the PATHFINDER, the placement rules and the AI read for the whole
 * match: a `passGrid` that arrived one byte short, or as a plain object, or as
 * an `Int8Array`, would not throw — it would produce a map with a silently
 * wrong edge, and the failure would surface as "the AI walks into the sea"
 * three minutes later. So every array is checked for TYPE and for LENGTH, and
 * the scalars are checked for finiteness.
 * ---------------------------------------------------------------------- */

/** Every field a `SeaSpec` must carry, all finite numbers. */
const SEA_FIELDS = [
  'x', 'z', 'normalX', 'normalZ', 'depth', 'shelfMetres', 'bandWidth',
  'wavinessMetres', 'wavelengthMetres',
] as const;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * An array of ellipse primitives — `SeaSpec.islands` or `SeaSpec.shoals`.
 *
 * BOTH RADII MUST BE POSITIVE, and that is the check that matters rather than
 * the finiteness one: `ellipseDistance` divides by each radius twice, so a zero
 * gives an Infinity that propagates through `min` into the heightfield as NaN
 * — the exact "NaN into a black frame" failure CLAUDE.md records, arriving over
 * a message port where nothing is looking.
 */
function isEllipseList(v: unknown, extra: readonly string[]): boolean {
  if (!Array.isArray(v)) return false;
  for (const e of v as unknown[]) {
    if (!isRecord(e)) return false;
    if (!isFiniteNumber(e.x) || !isFiniteNumber(e.z)) return false;
    if (!isFiniteNumber(e.radiusX) || !isFiniteNumber(e.radiusZ)) return false;
    if ((e.radiusX as number) <= 0 || (e.radiusZ as number) <= 0) return false;
    for (const k of extra) if (!isFiniteNumber(e[k])) return false;
  }
  return true;
}

/** A `Uint8Array` of exactly `n` bytes. */
function isBytes(v: unknown, n: number): boolean {
  return v instanceof Uint8Array && v.length === n;
}

/** A `Float32Array` of exactly `n` samples. */
function isFloats(v: unknown, n: number): boolean {
  return v instanceof Float32Array && v.length === n;
}

/** True when `v` is a well-formed terrain job. */
export function isTerrainJob(v: unknown): v is TerrainJob {
  if (!isRecord(v)) return false;
  if (v.kind !== 'terrain') return false;
  if (typeof v.id !== 'number') return false;
  if (!isRecord(v.options)) return false;
  const o = v.options;
  // `seed` decides every noise call in the generator and is `| 0`-ed on the way
  // in, so a non-finite one would silently produce a NaN heightfield.
  if (!isFiniteNumber(o.seed)) return false;
  if (typeof o.biome !== 'string') return false;
  if (o.starts !== undefined) {
    if (!Array.isArray(o.starts)) return false;
    // Every start point flattens a disc and drives a connectivity guarantee. A
    // NaN here is a levelled shelf at NaN metres, i.e. a hole in the map.
    for (const p of o.starts as unknown[]) {
      if (!isRecord(p) || !isFiniteNumber(p.x) || !isFiniteNumber(p.z)) return false;
    }
  }
  if (o.sea !== undefined && o.sea !== null) {
    if (!isRecord(o.sea)) return false;
    for (const k of SEA_FIELDS) {
      if (!isFiniteNumber(o.sea[k])) return false;
    }
    // A zero-length shoreline normal divides by itself in `seaDistance`.
    const nx = o.sea.normalX as number;
    const nz = o.sea.normalZ as number;
    if (nx * nx + nz * nz < 1e-9) return false;
    if ((o.sea.shelfMetres as number) <= 0) return false;
    // Optional, and absent on every half-plane sea. Present means the land is
    // these ellipses and nothing else, so a malformed entry is not a cosmetic
    // defect — it is a map with no land on it.
    if (o.sea.islands !== undefined && !isEllipseList(o.sea.islands, [])) return false;
    if (o.sea.shoals !== undefined && !isEllipseList(o.sea.shoals, ['depth'])) return false;
    // OPTIONAL, so absent is legal and anything present must be usable.
    // `seaCeiling` multiplies the beach cone by it: a zero or negative grade is
    // a coast that never rises out of the water, which floods the map from the
    // waterline inward, and a NaN is that same flood with no number to find.
    if (o.sea.beachGrade !== undefined) {
      if (!isFiniteNumber(o.sea.beachGrade) || o.sea.beachGrade <= 0) return false;
    }
  }
  return true;
}

/** True when `v` is a well-formed water job. */
export function isWaterJob(v: unknown): v is WaterJob {
  if (!isRecord(v)) return false;
  if (v.kind !== 'water') return false;
  if (typeof v.id !== 'number') return false;
  if (typeof v.key !== 'string') return false;
  // The bed. A short array would read past its end as `undefined -> NaN` and
  // the whole depth field would come back NaN, which packs to a uniform grey
  // and renders as a map-wide lake.
  if (!isFloats(v.height, GRID_COUNT)) return false;
  if (!isFiniteNumber(v.level)) return false;
  return isFiniteNumber(v.seed);
}

/** True when `v` is a well-formed terrain reply. */
export function isTerrainReply(v: unknown): v is TerrainReply {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'number') return false;
  if (v.kind === 'terrain:failed') return typeof v.reason === 'string';
  if (v.kind !== 'terrain:done') return false;
  const d = v.data;
  if (!isRecord(d)) return false;
  if (typeof d.key !== 'string') return false;
  if (!isFiniteNumber(d.rampsCarved) || !isFiniteNumber(d.generateMs)) return false;

  for (const k of ['height', 'slope', 'wallUp', 'wallTop'] as const) {
    if (!isFloats(d[k], GRID_COUNT)) return false;
  }
  for (const k of ['cellHeight', 'cellSlope'] as const) {
    if (!isFloats(d[k], MAP_CELL_COUNT)) return false;
  }
  for (const k of ['surface', 'passGrid', 'costGrid', 'buildGrid', 'waterGrid',
    'rampGrid', 'startMask'] as const) {
    if (!isBytes(d[k], MAP_CELL_COUNT)) return false;
  }
  for (const k of ['splatA', 'splatB'] as const) {
    if (!isBytes(d[k], SPLAT_BYTES)) return false;
  }

  if (!Array.isArray(d.shelves)) return false;
  for (const s of d.shelves as unknown[]) {
    if (!isRecord(s)) return false;
    if (!isFiniteNumber(s.x) || !isFiniteNumber(s.z)) return false;
    if (!isFiniteNumber(s.radius) || !isFiniteNumber(s.height)) return false;
  }

  if (!isRecord(d.report)) return false;
  for (const k of ['areas', 'startRamps', 'forcedRamps', 'filled', 'pruned',
    'stranded', 'majorRamps', 'majorSkipped'] as const) {
    if (!isFiniteNumber(d.report[k])) return false;
  }

  /*
   * The chunk attributes go straight into `THREE.BufferAttribute` with an
   * itemSize this code asserts rather than derives, so a short `position` is
   * not an exception — it is a draw call reading past the end of a GPU buffer.
   * Every length is checked, and the chunk COUNT is checked too: a set with
   * 63 chunks would render a map with a hole in it and report nothing.
   */
  if (!Array.isArray(d.chunks) || d.chunks.length !== TERRAIN_CHUNKS) return false;
  for (const c of d.chunks as unknown[]) {
    if (!isRecord(c)) return false;
    if (!Number.isInteger(c.cx) || !Number.isInteger(c.cz)) return false;
    if ((c.cx as number) < 0 || (c.cx as number) >= CHUNK_N) return false;
    if ((c.cz as number) < 0 || (c.cz as number) >= CHUNK_N) return false;
    if (!isFloats(c.position, CHUNK_VERTS * 3)) return false;
    if (!isFloats(c.normal, CHUNK_VERTS * 3)) return false;
    if (!isFloats(c.up, CHUNK_VERTS) || !isFloats(c.top, CHUNK_VERTS)) return false;
    if (!(c.index instanceof Uint16Array) || c.index.length !== CHUNK_INDICES) return false;
    /*
     * `lodIndex` is null on most chunks and NULL IS THE ONLY LEGAL ABSENCE —
     * `undefined` is refused, because a field set built by an older worker
     * would carry it and `c.lodIndex ?? c.index` would then silently draw the
     * full mesh while every length check above still passed. The topology is
     * fixed (see `CHUNK_LOD_INDICES`), so this is an exact length, not a range.
     */
    if (c.lodIndex !== null
      && !(c.lodIndex instanceof Uint16Array && c.lodIndex.length === CHUNK_LOD_INDICES)) {
      return false;
    }
    if (!Number.isInteger(c.cliffTris) || (c.cliffTris as number) < 0) return false;
    if (!isFiniteNumber(c.lodError) || (c.lodError as number) < 0) return false;
  }
  return true;
}

/** True when `v` is a well-formed water reply. */
export function isWaterReply(v: unknown): v is WaterReply {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'number') return false;
  if (v.kind === 'water:failed') return typeof v.reason === 'string';
  if (v.kind !== 'water:done') return false;
  const d = v.data;
  if (!isRecord(d)) return false;
  if (typeof d.key !== 'string') return false;
  if (!isFloats(d.depth, FIELD_TEXELS) || !isFloats(d.shore, FIELD_TEXELS)) return false;
  if (!isBytes(d.waterCells, MAP_CELL_COUNT)) return false;
  if (!isBytes(d.field, FIELD_BYTES)) return false;
  for (const k of ['coverage', 'maxDepth', 'rampDepth', 'shorelineMetres', 'bakeMs'] as const) {
    if (!isFiniteNumber(d[k])) return false;
  }
  // `rampDepth` divides the absorption term in the shader. Zero is a division
  // by zero on the GPU, which reads as a black sea rather than as an error.
  return (d.rampDepth as number) > 0;
}

/* -- world texture guards -------------------------------------------------
 *
 * `size` is checked hard on both jobs, because it decides the allocation. A
 * terrain set at the declared 256 is 3 MB of albedo + response layers; the same job with a
 * malformed `size` of 60000 is an out-of-memory kill of the worker, which the
 * pool reads as "the worker is broken" and which costs the whole boot its
 * offload. 2048 is well past anything the art uses (256 and 512) and far short
 * of anything dangerous. Powers of two are not required by the generators, but
 * a non-integer size would produce a buffer length the reply guard then
 * rejects, so it is refused here where the error is still legible.
 * ---------------------------------------------------------------------- */

function isSaneTextureSize(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 4 && v <= 2048;
}

/** True when `v` is a well-formed terrain texture job. */
export function isTerrainTexJob(v: unknown): v is TerrainTexJob {
  if (!isRecord(v)) return false;
  if (v.kind !== 'terrainTex') return false;
  if (typeof v.id !== 'number') return false;
  // An unknown biome would index `BIOMES` to `undefined` and the generator
  // would read `.layers` off it — a TypeError inside the worker, which is a
  // reply the pool never gets rather than a job it can fall back from.
  if (typeof v.biome !== 'string' || !isBiomeName(v.biome)) return false;
  if (!isSaneTextureSize(v.size)) return false;
  return isFiniteNumber(v.seed);
}

/** True when `v` is a well-formed water texture job. */
export function isWaterTexJob(v: unknown): v is WaterTexJob {
  if (!isRecord(v)) return false;
  if (v.kind !== 'waterTex') return false;
  if (typeof v.id !== 'number') return false;
  if (!isSaneTextureSize(v.size)) return false;
  return isFiniteNumber(v.seed);
}

/**
 * True when `v` is a well-formed terrain texture reply.
 *
 * Every LENGTH is checked against the dimensions the reply itself declares,
 * because these four buffers go straight into `DataArrayTexture` and
 * `DataTexture` with dimensions this code asserts rather than derives. A
 * `layers` buffer one byte short is not an exception — it is a GPU upload
 * reading past the end of an allocation, and this repo already has the story
 * about what a bad texture upload looks like: every pixel dead while the
 * counters cheerfully report a full frame.
 */
export function isTerrainTexReply(v: unknown): v is TerrainTexReply {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'number') return false;
  if (v.kind === 'terrainTex:failed') return typeof v.reason === 'string';
  if (v.kind !== 'terrainTex:done') return false;
  const d = v.data;
  if (!isRecord(d)) return false;
  if (typeof d.key !== 'string') return false;
  if (!isFiniteNumber(d.generateMs)) return false;
  if (!isSaneTextureSize(d.layerSize)) return false;
  const size = d.layerSize;
  if (!isBytes(d.layers, size * size * 4 * SURFACE_COUNT)) return false;
  if (!isBytes(d.responses, size * size * 4 * SURFACE_COUNT)) return false;
  if (!isBytes(d.warp, WARP_N * WARP_N * 4)) return false;
  return isBytes(d.macro, MACRO_N * MACRO_N * 4);
}

/** True when `v` is a well-formed water texture reply. */
export function isWaterTexReply(v: unknown): v is WaterTexReply {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'number') return false;
  if (v.kind === 'waterTex:failed') return typeof v.reason === 'string';
  if (v.kind !== 'waterTex:done') return false;
  const d = v.data;
  if (!isRecord(d)) return false;
  if (typeof d.key !== 'string') return false;
  if (!isFiniteNumber(d.generateMs)) return false;
  if (!isSaneTextureSize(d.waveSize) || !isSaneTextureSize(d.laceSize)) return false;
  const w = d.waveSize;
  const l = d.laceSize;
  // RGBA for the slope map, single-channel R8 for the lace.
  if (!isBytes(d.waves, w * w * 4)) return false;
  return isBytes(d.lace, l * l);
}

/** Any reply shape this build understands. */
export function isWorkerReply(v: unknown): v is WorkerReply {
  return isTextureReply(v) || isGreebleReply(v) || isTerrainReply(v) || isWaterReply(v)
    || isTerrainTexReply(v) || isWaterTexReply(v);
}

/**
 * The buffers a reply owns, for `postMessage`'s transfer list. Transferring
 * rather than copying is the whole reason this is worth doing at 512²: a
 * pavement material is 3 MB of bytes, and a structured-clone copy of that is
 * main-thread time we just spent a worker to avoid.
 */
export function replyTransfers(reply: WorkerReply): ArrayBuffer[] {
  if (reply.kind === 'greeble:done') return greebleTransfers(reply.data);
  if (reply.kind === 'terrain:done') return terrainFieldTransfers(reply.data);
  if (reply.kind === 'water:done') return waterFieldTransfers(reply.data);
  if (reply.kind === 'terrainTex:done') return terrainTextureTransfers(reply.data);
  if (reply.kind === 'waterTex:done') return waterTextureTransfers(reply.data);
  if (reply.kind !== 'texture:done') return [];
  const out: ArrayBuffer[] = [];
  for (const layer of reply.layers) {
    const buf = layer.data.buffer;
    // A pack always allocates a fresh array, so these are never shared — but
    // transferring the same buffer twice is a hard DataCloneError, so check.
    if (buf instanceof ArrayBuffer && !out.includes(buf)) out.push(buf);
  }
  return out;
}

/* ==========================================================================
 * THE WORK
 * ========================================================================== */

/**
 * Generate one job. Pure, synchronous, and identical to what the main thread
 * would have done — it calls the same `generateSurface` / `packChannel` pair
 * that `TextureFactory` calls, because there is only one implementation.
 *
 * NEVER THROWS. A generator that blows up returns a `texture:failed` reply and
 * the worker stays alive for the next job. A worker that dies mid-boot would
 * take the loading curtain with it.
 */
export function runTextureJob(job: TextureJob): TextureReply {
  try {
    const p = resolveParams(job.request);
    // ONE generator run for every channel in the job.
    const surface = generateSurface(job.request.kind, p);
    const structural = usesStructuralNormal(job.request);
    const layers: TextureLayer[] = [];
    for (const channel of job.channels) {
      const packed = packChannel(surface, channel, structural, p.relief);
      layers.push({ channel, data: packed.data, size: packed.size, srgb: packed.srgb });
    }
    return { kind: 'texture:done', id: job.id, layers };
  } catch (err: unknown) {
    return {
      kind: 'texture:failed',
      id: job.id,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Generate one greeble atlas. Same contract as `runTextureJob`: pure,
 * synchronous, identical to what the main thread would have produced, and it
 * NEVER THROWS.
 *
 * The timing is taken here rather than on the main thread because this is the
 * only place that knows how long the generator actually ran — a main-thread
 * measurement would be dominated by however long the job sat in the queue.
 */
export function runGreebleJob(job: GreebleJob): GreebleReply {
  try {
    const t0 = Date.now();
    const data = generateGreebleAtlas(job.spec, 0);
    return {
      kind: 'greeble:done',
      id: job.id,
      data: { ...data, metrics: { ...data.metrics, generateMs: Date.now() - t0 } },
    };
  } catch (err: unknown) {
    return {
      kind: 'greeble:failed',
      id: job.id,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Generate one terrain. Same contract as the two above: pure, synchronous,
 * identical to what the main thread would have produced, and it NEVER THROWS.
 *
 * There is only one implementation — `Terrain` extends the same
 * `TerrainFields` class and runs the same `generate()` — so "the worker's map
 * is the map" is a property of the code rather than of two copies staying in
 * step. `tests/world-workers.spec.ts` measures it byte for byte anyway.
 */
export function runTerrainJob(job: TerrainJob): TerrainReply {
  try {
    return { kind: 'terrain:done', id: job.id, data: generateTerrainFields(job.options) };
  } catch (err: unknown) {
    return {
      kind: 'terrain:failed',
      id: job.id,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Bake one water field set over a heightfield.
 *
 * `heightAtGrid` is the bed, and it is the SAME function `Terrain.heightAt`
 * delegates to — see `src/world/terrain-gen.ts`. That is the whole reason the
 * job carries a raw array instead of anything cleverer.
 */
export function runWaterJob(job: WaterJob): WaterReply {
  try {
    const height = job.height;
    const data = bakeWaterFields({
      bedHeight: (x: number, z: number) => heightAtGrid(height, x, z),
      level: job.level,
      seed: job.seed,
    }, job.key);
    return { kind: 'water:done', id: job.id, data };
  } catch (err: unknown) {
    return {
      kind: 'water:failed',
      id: job.id,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Dispatch any job kind. The worker shim is this call and nothing else.
 *
 * Dispatches on the type GUARDS rather than on a `kind` field, because
 * `TextureJob` has no top-level `kind` — its discriminator is nested at
 * `request.kind`, and it predates there being a second job. Adding one now
 * would be a wire-format change for no gain when the guards already exist and
 * are the thing the worker has to run on every message anyway. Texture is
 * LAST because its guard is the one defined as "carries no top-level kind".
 */
export function runJob(job: WorkerJob): WorkerReply {
  if (isGreebleJob(job)) return runGreebleJob(job);
  if (isTerrainJob(job)) return runTerrainJob(job);
  if (isWaterJob(job)) return runWaterJob(job);
  if (isTerrainTexJob(job)) return runTerrainTexJob(job);
  if (isWaterTexJob(job)) return runWaterTexJob(job);
  return runTextureJob(job);
}

/**
 * Generate one terrain texture set. Same contract as every job above: pure,
 * synchronous, identical to what the main thread would have produced, and it
 * NEVER THROWS.
 *
 * `isTerrainTexJob` has already established that `job.biome` is a real biome
 * name, so the lookup cannot miss. There is only one implementation —
 * `createTerrainMaterials` calls `generateTerrainTextures`'s three constituent
 * functions when it has no prewarm — so "the worker's ground is the ground" is
 * a property of the code rather than of two copies staying in step.
 */
export function runTerrainTexJob(job: TerrainTexJob): TerrainTexReply {
  try {
    const biome = BIOMES[job.biome as keyof typeof BIOMES];
    return {
      kind: 'terrainTex:done',
      id: job.id,
      data: generateTerrainTextures(biome, job.size, job.seed),
    };
  } catch (err: unknown) {
    return {
      kind: 'terrainTex:failed',
      id: job.id,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Generate one water texture set. Same contract. */
export function runWaterTexJob(job: WaterTexJob): WaterTexReply {
  try {
    return {
      kind: 'waterTex:done',
      id: job.id,
      data: generateWaterTextures(job.size, job.seed),
    };
  } catch (err: unknown) {
    return {
      kind: 'waterTex:failed',
      id: job.id,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

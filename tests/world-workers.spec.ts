/**
 * ============================================================================
 * tests/world-workers.spec.ts — TERRAIN AND WATER OFF THE MAIN THREAD
 * ============================================================================
 * Boot-time generation moved into a Web Worker. That is only worth anything if
 * three claims hold, and none of them is self-evident:
 *
 *   1. THE BYTES ARE THE SAME. The heightfield, the nav grids, the splat, the
 *      chunk vertices and the water field a worker produces must be identical,
 *      byte for byte, to the ones this repo has always produced inline. This is
 *      not cosmetic: `docs` calls deterministic lockstep multiplayer the reason
 *      determinism is a hard rule, and lockstep means two machines must agree
 *      on the world. If one of them adopted a worker's map and the other
 *      generated its own, a single differing float in `passGrid` is a desync
 *      with no findable cause. Measured here, array by array, byte by byte.
 *
 *   2. THE GAME STILL BOOTS WHEN THE WORKER DOES NOT. No `Worker` in Node, none
 *      under a locked-down CSP, none on a browser too old for module workers —
 *      and a worker that ACCEPTS a job and never answers would hold the loading
 *      curtain up forever. Every one of those routes has to end in a correct
 *      map generated on this thread.
 *
 *   3. A MALFORMED MESSAGE IS REFUSED, NOT DRAWN. A `passGrid` that arrived one
 *      byte short would not throw. It would produce a map with a silently wrong
 *      edge, and the symptom would be "the AI walks into the sea" three minutes
 *      into a match. So the guards are tested against the specific corruptions
 *      that would otherwise be invisible.
 *
 * WHY THIS RUNS AT ALL IN `environment: 'node'`
 * ---------------------------------------------
 * The worker's whole job body is `runTerrainJob` / `runWaterJob` in
 * `protocol.ts`, and the pool takes its `spawn` function as an argument. So the
 * message shape, the job, the correlation, the timeout and the disable cascade
 * all run here against a fake worker driven by the REAL `structuredClone`. The
 * only line no Node test can reach is `new Worker(...)` in `spawn.ts`.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { MAP_CELL_COUNT, MAP_SIZE, WATER_LEVEL, WATER_SEED, type SeaSpec } from '../src/core/config';
import {
  CHUNK_INDICES, CHUNK_VERTS, GRID_COUNT, SPLAT_BYTES, TERRAIN_CHUNKS,
  TerrainFields, buildTerrainChunks, heightAtGrid, terrainFieldTransfers, terrainGenKey,
  type TerrainFieldData, type TerrainGenOptions,
} from '../src/world/terrain-gen';
import {
  FIELD_BYTES, FIELD_TEXELS, bakeWaterFields, waterFieldTransfers, waterGenKey,
  type WaterFieldData,
} from '../src/world/water-gen';
import {
  isTerrainJob, isTerrainReply, isTextureJob, isWaterJob, isWaterReply,
  replyTransfers, runJob, runTerrainJob, runWaterJob,
  type TerrainJob, type WaterJob,
} from '../src/core/workers/protocol';
import { TexturePool, type WorkerLike } from '../src/core/workers/TexturePool';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const SEA: SeaSpec = {
  x: MAP_SIZE * 0.5, z: MAP_SIZE * 0.5,
  normalX: -Math.SQRT1_2, normalZ: -Math.SQRT1_2,
  depth: 8, shelfMetres: 34, bandWidth: 6,
  wavinessMetres: 5, wavelengthMetres: 90,
};

/**
 * Three maps that exercise different halves of the generator: a landlocked one
 * with the default starts, one with an explicit multi-start layout, and one
 * with a declared shoreline (which is the only path that runs `carveSea`,
 * `resolveStarts`' inland push and the water bake over anything but dry land).
 */
const CASES: ReadonlyArray<readonly [string, TerrainGenOptions]> = [
  ['temperate, landlocked', { seed: 7, biome: 'temperate' }],
  ['desert, three starts', {
    seed: 31,
    biome: 'desert',
    starts: [
      { x: MAP_SIZE * 0.5, z: MAP_SIZE * 0.5 },
      { x: MAP_SIZE * 0.5 - 68, z: MAP_SIZE * 0.5 - 68 },
      { x: MAP_SIZE * 0.5 + 68, z: MAP_SIZE * 0.5 + 68 },
    ],
  }],
  ['temperate, with a sea', { seed: 13, biome: 'temperate', sea: SEA }],
];

/** Every typed-array field of a terrain set, so nothing is compared by omission. */
const TERRAIN_ARRAYS = [
  'height', 'slope', 'wallUp', 'wallTop', 'cellHeight', 'cellSlope',
  'surface', 'passGrid', 'costGrid', 'buildGrid', 'waterGrid', 'rampGrid',
  'startMask', 'splatA', 'splatB',
] as const;

function bytesOf(a: Float32Array | Uint8Array | Uint16Array): Buffer {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength);
}

/**
 * The main thread's path: the exact class `Terrain` extends, run inline.
 *
 * MEMOISED, and not as a micro-optimisation. A generation is ~0.4 s in Node and
 * this file wants three dozen of them; unmemoised it costs 20 s of CPU, and
 * `vitest` runs spec files in parallel, so that load lands on top of
 * `reachability.spec.ts` — whose slowest case already sits within two seconds
 * of its 120 s timeout. Measured: this file at 22 s tipped it into a timeout in
 * a full run while passing on its own.
 *
 * The memo is by `terrainGenKey`, which is the same identity the prewarm uses,
 * so two callers asking for "the same map" is exactly what it means elsewhere.
 * The two tests that exist to prove the generator carries no state between runs
 * deliberately do NOT go through here.
 */
const inlineCache = new Map<string, TerrainFields>();

function generateInline(options: TerrainGenOptions): TerrainFields {
  const key = terrainGenKey(options);
  const hit = inlineCache.get(key);
  if (hit !== undefined) return hit;
  const f = new TerrainFields(options);
  f.generate();
  inlineCache.set(key, f);
  return f;
}

/** The worker's path, memoised on the same key and for the same reason. */
const workerCache = new Map<string, TerrainFieldData>();

function generateViaWorker(options: TerrainGenOptions): TerrainFieldData {
  const key = terrainGenKey(options);
  const hit = workerCache.get(key);
  if (hit !== undefined) return hit;
  const reply = runTerrainJob({ kind: 'terrain', id: 1, options });
  if (reply.kind !== 'terrain:done') throw new Error(`worker failed: ${reply.reason}`);
  workerCache.set(key, reply.data);
  return reply.data;
}

/** A water bake over a memoised bed. Same argument as above. */
const bakeCache = new Map<string, WaterFieldData>();

function bakeInline(options: TerrainGenOptions, key: string): WaterFieldData {
  const hit = bakeCache.get(key);
  if (hit !== undefined) return hit;
  const terrain = generateInline(options);
  const baked = bakeWaterFields({
    bedHeight: (x, z) => terrain.heightAt(x, z), level: WATER_LEVEL, seed: WATER_SEED,
  }, key);
  bakeCache.set(key, baked);
  return baked;
}

/* ==========================================================================
 * 1. THE HEADLINE: THE BYTES ARE THE SAME
 * ========================================================================== */

describe('terrain: worker and main thread produce identical bytes', () => {
  it('agrees byte for byte on every grid, for every map', () => {
    for (const [name, options] of CASES) {
      // The worker's job body, run as the worker runs it.
      const data = generateViaWorker(options);
      // The main thread's path: `Terrain` extends `TerrainFields` and calls
      // exactly this `generate()`.
      const inline = generateInline(options);

      for (const k of TERRAIN_ARRAYS) {
        expect(
          bytesOf(data[k]).equals(bytesOf(inline[k])),
          `${name}: ${k} differs between the worker and the main thread`,
        ).toBe(true);
      }
    }
  });

  it('agrees on the derived scalars and the start-area report', () => {
    for (const [name, options] of CASES) {
      const data = generateViaWorker(options);
      const inline = generateInline(options);

      expect(data.report, name).toEqual(inline.startReport());
      expect(data.shelves, name).toEqual(inline.startLocations());
      expect(data.rampsCarved, name).toBe(inline.stats().ramps);
      expect(data.key, name).toBe(terrainGenKey(options));
    }
  });

  it('agrees on every chunk vertex, normal and index', () => {
    for (const [name, options] of CASES) {
      const data = generateViaWorker(options);
      const inline = generateInline(options);
      // What `Terrain.buildMeshes` computes when it has no adopted set.
      const local = buildTerrainChunks(inline.height, inline.wallUp, inline.wallTop);

      expect(data.chunks.length, name).toBe(local.length);
      for (let i = 0; i < local.length; i++) {
        const a = data.chunks[i];
        const b = local[i];
        expect(a.cx, `${name} chunk ${i} cx`).toBe(b.cx);
        expect(a.cz, `${name} chunk ${i} cz`).toBe(b.cz);
        expect(a.cliffTris, `${name} chunk ${i} cliffTris`).toBe(b.cliffTris);
        for (const k of ['position', 'normal', 'up', 'top', 'index'] as const) {
          expect(
            bytesOf(a[k]).equals(bytesOf(b[k])),
            `${name}: chunk ${b.cx},${b.cz} ${k} differs`,
          ).toBe(true);
        }
      }
    }
  });

  /**
   * The claim that actually protects lockstep: a set that has crossed
   * `structuredClone` in both directions, exactly as `postMessage` does, is
   * still the same map. A generator that leaned on a shared module-level
   * scratch buffer, or on anything not clonable, fails here and only here.
   */
  it('survives a real structured clone in both directions', () => {
    const options = CASES[2][1];
    const job: TerrainJob = structuredClone({ kind: 'terrain', id: 9, options });
    expect(isTerrainJob(job)).toBe(true);
    const reply = structuredClone(runJob(job));
    expect(isTerrainReply(reply)).toBe(true);
    if (reply.kind !== 'terrain:done') throw new Error('cloned reply lost its kind');

    const inline = generateInline(options);
    for (const k of TERRAIN_ARRAYS) {
      expect(bytesOf(reply.data[k]).equals(bytesOf(inline[k])), `${k} differs after clone`).toBe(true);
    }
  });

  /**
   * Two jobs in the same worker, back to back, NOT memoised. The generator
   * holds scratch arrays (`potential`, `windowLo/Hi`, the BFS queues); if any of
   * them leaked between runs, the second map would differ from the same map
   * generated first — and a cache would hide exactly that.
   */
  it('does not depend on what the worker generated before it', () => {
    const first = runTerrainJob({ kind: 'terrain', id: 1, options: CASES[0][1] });
    const second = runTerrainJob({ kind: 'terrain', id: 2, options: CASES[2][1] });
    expect(first.kind).toBe('terrain:done');
    if (second.kind !== 'terrain:done') throw new Error('second job failed');

    const alone = generateInline(CASES[2][1]);
    for (const k of TERRAIN_ARRAYS) {
      expect(
        bytesOf(second.data[k]).equals(bytesOf(alone[k])),
        `${k} depends on the previous job`,
      ).toBe(true);
    }
  });
});

describe('water: worker and main thread produce identical bytes', () => {
  /**
   * The bed is the seam. On the main thread `Water` bakes against
   * `terrain.heightAt`; in the worker it bakes against `heightAtGrid` closed
   * over a transferred array. `Terrain.heightAt` is one call into that same
   * function, so this test is checking that the seam did not grow a second
   * implementation.
   */
  it('bakes the same field from a Terrain and from a raw heightfield', () => {
    for (const [name, options] of CASES) {
      const terrain = generateInline(options);
      const key = waterGenKey(terrainGenKey(options), WATER_LEVEL, WATER_SEED);

      // Main thread: the bed is the live terrain's own query method.
      const inline = bakeInline(options, key);

      // Worker: the bed is a copy of the height array on the wire.
      const job: WaterJob = {
        kind: 'water', id: 1, key,
        height: Float32Array.from(terrain.height),
        level: WATER_LEVEL, seed: WATER_SEED,
      };
      const reply = runWaterJob(job);
      expect(reply.kind, `${name} failed in the worker`).toBe('water:done');
      if (reply.kind !== 'water:done') continue;

      for (const k of ['depth', 'shore', 'waterCells', 'field'] as const) {
        expect(
          bytesOf(reply.data[k]).equals(bytesOf(inline[k])),
          `${name}: water ${k} differs between the worker and the main thread`,
        ).toBe(true);
      }
      expect(reply.data.coverage, name).toBe(inline.coverage);
      expect(reply.data.maxDepth, name).toBe(inline.maxDepth);
      expect(reply.data.rampDepth, name).toBe(inline.rampDepth);
      expect(reply.data.shorelineMetres, name).toBe(inline.shorelineMetres);
      expect(reply.data.key, name).toBe(key);
    }
  });

  it('survives a real structured clone in both directions', () => {
    const options = CASES[2][1];
    const terrain = generateInline(options);
    const key = waterGenKey(terrainGenKey(options), WATER_LEVEL, WATER_SEED);
    const job: WaterJob = structuredClone({
      kind: 'water', id: 4, key,
      height: Float32Array.from(terrain.height),
      level: WATER_LEVEL, seed: WATER_SEED,
    });
    expect(isWaterJob(job)).toBe(true);
    const reply = structuredClone(runJob(job));
    expect(isWaterReply(reply)).toBe(true);
    if (reply.kind !== 'water:done') throw new Error('cloned reply lost its kind');

    const inline = bakeInline(options, key);
    expect(bytesOf(reply.data.depth).equals(bytesOf(inline.depth))).toBe(true);
    expect(bytesOf(reply.data.field).equals(bytesOf(inline.field))).toBe(true);
  });

  /**
   * NOT memoised, on purpose. The EDT scratch is module-level and shared
   * between bakes; a leak between runs is exactly what this measures, and a
   * cache would hide it.
   */
  it('does not depend on the bake that ran before it', () => {
    const a = generateInline(CASES[0][1]);
    const b = generateInline(CASES[2][1]);
    const bed = (t: TerrainFields) => ({
      bedHeight: (x: number, z: number) => t.heightAt(x, z),
      level: WATER_LEVEL,
      seed: WATER_SEED,
    });
    bakeWaterFields(bed(a));
    const second = bakeWaterFields(bed(b));
    const alone = bakeWaterFields(bed(b));
    expect(bytesOf(second.shore).equals(bytesOf(alone.shore))).toBe(true);
    expect(bytesOf(second.depth).equals(bytesOf(alone.depth))).toBe(true);
  });

  it('samples the bed exactly as Terrain.heightAt does', () => {
    const t = generateInline(CASES[1][1]);
    // Includes both ends and past them, because the clamp at the map edge is
    // where two implementations of a bilinear sample normally diverge.
    for (const p of [-5, 0, 0.5, 1, 123.25, MAP_SIZE * 0.5, MAP_SIZE - 0.001, MAP_SIZE, MAP_SIZE + 9]) {
      expect(heightAtGrid(t.height, p, p)).toBe(t.heightAt(p, p));
      expect(heightAtGrid(t.height, p, 40.75)).toBe(t.heightAt(p, 40.75));
    }
  });
});

/* ==========================================================================
 * 2. THE KEY — what stops a prewarm being adopted onto the wrong map
 * ========================================================================== */

describe('terrainGenKey', () => {
  it('is stable for the same inputs and different for every field that matters', () => {
    const base: TerrainGenOptions = { seed: 5, biome: 'temperate', sea: SEA };
    expect(terrainGenKey(base)).toBe(terrainGenKey({ ...base }));

    expect(terrainGenKey({ ...base, seed: 6 })).not.toBe(terrainGenKey(base));
    expect(terrainGenKey({ ...base, biome: 'desert' })).not.toBe(terrainGenKey(base));
    expect(terrainGenKey({ ...base, sea: null })).not.toBe(terrainGenKey(base));
    expect(terrainGenKey({ ...base, sea: { ...SEA, depth: 9 } })).not.toBe(terrainGenKey(base));
    expect(terrainGenKey({ ...base, starts: [{ x: 1, z: 2 }] })).not.toBe(terrainGenKey(base));
    expect(terrainGenKey({ ...base, starts: [{ x: 1, z: 3 }] }))
      .not.toBe(terrainGenKey({ ...base, starts: [{ x: 1, z: 2 }] }));
  });

  it('resolves a biome alias to the same key as its canonical name', () => {
    // `getBiome` accepts a string and falls back; two spellings of one biome
    // must not produce two keys, or the prewarm would miss for no reason.
    expect(terrainGenKey({ seed: 1, biome: 'temperate' }))
      .toBe(terrainGenKey({ seed: 1, biome: 'Temperate' }));
  });

  it('distinguishes a water key by level and by seed', () => {
    const t = terrainGenKey({ seed: 1, biome: 'temperate' });
    expect(waterGenKey(t, 1, 2)).toBe(waterGenKey(t, 1, 2));
    expect(waterGenKey(t, 1, 2)).not.toBe(waterGenKey(t, 1.5, 2));
    expect(waterGenKey(t, 1, 2)).not.toBe(waterGenKey(t, 1, 3));
    expect(waterGenKey(t, 1, 2)).not.toBe(waterGenKey(`${t}x`, 1, 2));
  });
});

/* ==========================================================================
 * 3. THE GUARDS — a malformed message is refused, not drawn
 * ========================================================================== */

describe('isTerrainJob', () => {
  const good: TerrainJob = { kind: 'terrain', id: 1, options: { seed: 3, biome: 'temperate' } };

  it('accepts a well-formed job', () => {
    expect(isTerrainJob(good)).toBe(true);
    expect(isTerrainJob({ ...good, options: { ...good.options, sea: SEA } })).toBe(true);
    expect(isTerrainJob({
      ...good, options: { ...good.options, starts: [{ x: 1, z: 2 }] },
    })).toBe(true);
  });

  it('refuses anything that is not one', () => {
    expect(isTerrainJob(null)).toBe(false);
    expect(isTerrainJob(42)).toBe(false);
    expect(isTerrainJob({ kind: 'greeble', id: 1, spec: { key: 'a', size: 8 } })).toBe(false);
    expect(isTerrainJob({ ...good, kind: 'water' })).toBe(false);
    expect(isTerrainJob({ ...good, id: '1' })).toBe(false);
    expect(isTerrainJob({ kind: 'terrain', id: 1 })).toBe(false);
  });

  it('refuses a seed or a start that would produce a NaN heightfield', () => {
    expect(isTerrainJob({ ...good, options: { seed: NaN, biome: 'temperate' } })).toBe(false);
    expect(isTerrainJob({ ...good, options: { seed: Infinity, biome: 'temperate' } })).toBe(false);
    expect(isTerrainJob({ ...good, options: { seed: 1, biome: 3 } })).toBe(false);
    expect(isTerrainJob({
      ...good, options: { ...good.options, starts: [{ x: NaN, z: 0 }] },
    })).toBe(false);
    expect(isTerrainJob({
      ...good, options: { ...good.options, starts: [{ x: 0 }] },
    })).toBe(false);
    expect(isTerrainJob({ ...good, options: { ...good.options, starts: 'centre' } })).toBe(false);
  });

  it('refuses a sea that would divide by zero or carve nothing', () => {
    for (const k of ['x', 'z', 'normalX', 'normalZ', 'depth', 'shelfMetres',
      'bandWidth', 'wavinessMetres', 'wavelengthMetres'] as const) {
      expect(
        isTerrainJob({ ...good, options: { ...good.options, sea: { ...SEA, [k]: NaN } } }),
        `sea.${k} = NaN was accepted`,
      ).toBe(false);
      expect(
        isTerrainJob({ ...good, options: { ...good.options, sea: { ...SEA, [k]: undefined } } }),
        `sea.${k} missing was accepted`,
      ).toBe(false);
    }
    // A zero-length normal: `seaDistance` projects onto it.
    expect(isTerrainJob({
      ...good, options: { ...good.options, sea: { ...SEA, normalX: 0, normalZ: 0 } },
    })).toBe(false);
    // `seaCeiling` divides by the shelf.
    expect(isTerrainJob({
      ...good, options: { ...good.options, sea: { ...SEA, shelfMetres: 0 } },
    })).toBe(false);
  });

  it('does not mistake a texture job for one, or one for a texture job', () => {
    expect(isTextureJob(good)).toBe(false);
    expect(isTerrainJob({ id: 1, request: { kind: 'noise' }, channels: ['albedo'] })).toBe(false);
  });
});

describe('isWaterJob', () => {
  const good: WaterJob = {
    kind: 'water', id: 1, key: 'k',
    height: new Float32Array(GRID_COUNT), level: 1, seed: 2,
  };

  it('accepts a well-formed job', () => {
    expect(isWaterJob(good)).toBe(true);
  });

  it('refuses a bed of the wrong length or the wrong type', () => {
    // A short bed reads past its end as `undefined -> NaN`, and the whole depth
    // field comes back NaN — which packs to a uniform grey and renders as a
    // map-wide lake rather than as an error.
    expect(isWaterJob({ ...good, height: new Float32Array(GRID_COUNT - 1) })).toBe(false);
    expect(isWaterJob({ ...good, height: new Float32Array(GRID_COUNT + 1) })).toBe(false);
    expect(isWaterJob({ ...good, height: new Float64Array(GRID_COUNT) })).toBe(false);
    expect(isWaterJob({ ...good, height: Array.from({ length: GRID_COUNT }, () => 0) })).toBe(false);
    expect(isWaterJob({ ...good, height: undefined })).toBe(false);
  });

  it('refuses non-finite settings and a missing key', () => {
    expect(isWaterJob({ ...good, level: NaN })).toBe(false);
    expect(isWaterJob({ ...good, seed: Infinity })).toBe(false);
    expect(isWaterJob({ ...good, key: 7 })).toBe(false);
    expect(isWaterJob({ ...good, kind: 'terrain' })).toBe(false);
  });
});

describe('isTerrainReply', () => {
  /** A shallow copy of one memoised reply, so a corruption cannot leak. */
  function fresh(): Record<string, unknown> {
    return { kind: 'terrain:done', id: 1, data: { ...generateViaWorker(CASES[0][1]) } };
  }

  it('accepts a real reply and a failure', () => {
    expect(isTerrainReply(fresh())).toBe(true);
    expect(isTerrainReply({ kind: 'terrain:failed', id: 1, reason: 'boom' })).toBe(true);
    expect(isTerrainReply({ kind: 'terrain:failed', id: 1 })).toBe(false);
  });

  it('refuses a grid of the wrong length, wrong type or missing', () => {
    for (const k of TERRAIN_ARRAYS) {
      const short = fresh();
      const data = short.data as Record<string, unknown>;
      const original = data[k] as Float32Array | Uint8Array;
      data[k] = original.subarray(0, original.length - 1);
      expect(isTerrainReply(short), `${k} one short was accepted`).toBe(false);

      const wrongType = fresh();
      (wrongType.data as Record<string, unknown>)[k] = Array.from(original.subarray(0, 4));
      expect(isTerrainReply(wrongType), `${k} as a plain array was accepted`).toBe(false);

      const missing = fresh();
      delete (missing.data as Record<string, unknown>)[k];
      expect(isTerrainReply(missing), `${k} missing was accepted`).toBe(false);
    }
  });

  it('refuses a Uint8 grid handed over as a signed array', () => {
    // `Int8Array` has the right byte length and the wrong interpretation: every
    // cost above 127 would come back negative and `COST_BLOCKED` would read as
    // -1. A `byteLength` check alone would pass this.
    const v = fresh();
    (v.data as Record<string, unknown>).passGrid = new Int8Array(MAP_CELL_COUNT);
    expect(isTerrainReply(v)).toBe(false);
  });

  it('refuses a chunk set with the wrong count or a short attribute', () => {
    const missingChunk = fresh();
    const data = missingChunk.data as Record<string, unknown>;
    data.chunks = (data.chunks as unknown[]).slice(1);
    expect(isTerrainReply(missingChunk)).toBe(false);

    for (const [k, len] of [
      ['position', CHUNK_VERTS * 3], ['normal', CHUNK_VERTS * 3],
      ['up', CHUNK_VERTS], ['top', CHUNK_VERTS],
    ] as const) {
      const v = fresh();
      const chunks = ((v.data as Record<string, unknown>).chunks as unknown[]).slice();
      chunks[3] = { ...(chunks[3] as object), [k]: new Float32Array(len - 3) };
      (v.data as Record<string, unknown>).chunks = chunks;
      expect(isTerrainReply(v), `short chunk ${k} was accepted`).toBe(false);
    }

    const badIndex = fresh();
    const chunks = ((badIndex.data as Record<string, unknown>).chunks as unknown[]).slice();
    chunks[0] = { ...(chunks[0] as object), index: new Uint32Array(CHUNK_INDICES) };
    (badIndex.data as Record<string, unknown>).chunks = chunks;
    expect(isTerrainReply(badIndex)).toBe(false);
  });

  it('refuses a broken report or shelf list', () => {
    const noReport = fresh();
    delete (noReport.data as Record<string, unknown>).report;
    expect(isTerrainReply(noReport)).toBe(false);

    const badShelf = fresh();
    (badShelf.data as Record<string, unknown>).shelves = [{ x: 1, z: 2, radius: 3 }];
    expect(isTerrainReply(badShelf)).toBe(false);

    const badStranded = fresh();
    const report = { ...((fresh().data as Record<string, unknown>).report as object), stranded: 'no' };
    (badStranded.data as Record<string, unknown>).report = report;
    expect(isTerrainReply(badStranded)).toBe(false);
  });

  it('refuses replies that are not replies at all', () => {
    expect(isTerrainReply(null)).toBe(false);
    expect(isTerrainReply({ kind: 'terrain:done', id: 1 })).toBe(false);
    expect(isTerrainReply({ kind: 'water:done', id: 1, data: {} })).toBe(false);
  });
});

describe('isWaterReply', () => {
  const clone = (): Record<string, unknown> => ({
    kind: 'water:done',
    id: 1,
    data: { ...bakeInline(CASES[2][1], waterGenKey(terrainGenKey(CASES[2][1]), WATER_LEVEL, WATER_SEED)) },
  });

  it('accepts a real reply and a failure', () => {
    expect(isWaterReply(clone())).toBe(true);
    expect(isWaterReply({ kind: 'water:failed', id: 1, reason: 'boom' })).toBe(true);
  });

  it('refuses a field of the wrong length or type', () => {
    for (const [k, len, ctor] of [
      ['depth', FIELD_TEXELS, Float32Array],
      ['shore', FIELD_TEXELS, Float32Array],
      ['waterCells', MAP_CELL_COUNT, Uint8Array],
      ['field', FIELD_BYTES, Uint8Array],
    ] as const) {
      const short = clone();
      (short.data as Record<string, unknown>)[k] = new ctor(len - 1);
      expect(isWaterReply(short), `short ${k} was accepted`).toBe(false);

      const missing = clone();
      delete (missing.data as Record<string, unknown>)[k];
      expect(isWaterReply(missing), `missing ${k} was accepted`).toBe(false);
    }
    const wrongType = clone();
    (wrongType.data as Record<string, unknown>).depth = new Float64Array(FIELD_TEXELS);
    expect(isWaterReply(wrongType)).toBe(false);
  });

  it('refuses a zero ramp depth', () => {
    // The shader divides the absorption term by this. Zero is a division by
    // zero on the GPU, which renders as a black sea rather than as an error.
    const v = clone();
    (v.data as Record<string, unknown>).rampDepth = 0;
    expect(isWaterReply(v)).toBe(false);
    const nan = clone();
    (nan.data as Record<string, unknown>).coverage = NaN;
    expect(isWaterReply(nan)).toBe(false);
  });
});

/* ==========================================================================
 * 4. TRANSFERS
 * ========================================================================== */

describe('transfer lists', () => {
  it('lists every buffer a terrain reply owns, exactly once', () => {
    const data = generateViaWorker(CASES[0][1]);
    const list = terrainFieldTransfers(data);
    // 15 grids + 5 arrays per chunk.
    expect(list.length).toBe(15 + TERRAIN_CHUNKS * 5);
    expect(new Set(list).size).toBe(list.length);
    expect(replyTransfers({ kind: 'terrain:done', id: 1, data })).toEqual(list);
  });

  it('lists every buffer a water reply owns, exactly once', () => {
    const data = bakeInline(CASES[2][1], 'k');
    const list = waterFieldTransfers(data);
    expect(list.length).toBe(4);
    expect(new Set(list).size).toBe(4);
    expect(replyTransfers({ kind: 'water:done', id: 1, data })).toEqual(list);
  });

  it('does NOT list the bed the job arrived with', () => {
    // The main thread is about to build the live map out of that array.
    // Transferring it back would detach it and leave a flat black world.
    const t = generateInline(CASES[0][1]);
    const bed = Float32Array.from(t.height);
    const reply = runWaterJob({
      kind: 'water', id: 1, key: 'k', height: bed, level: WATER_LEVEL, seed: WATER_SEED,
    });
    expect(replyTransfers(reply)).not.toContain(bed.buffer);
  });
});

/* ==========================================================================
 * 5. THE POOL — every failure ends in a null, never in a broken world
 * ========================================================================== */

type Behaviour =
  | { mode: 'work' }
  | { mode: 'reject' }
  | { mode: 'silent' }
  | { mode: 'error'; reason: string }
  | { mode: 'garbage' }
  /** Answer with a reply whose grids are corrupt. */
  | { mode: 'corrupt' };

/**
 * A worker that is fake in exactly one respect: it runs on this thread.
 * Messages cross the real `structuredClone` in both directions.
 */
function makeFakeWorker(behaviour: Behaviour): WorkerLike & { terminated: () => boolean } {
  let onMessage: (data: unknown) => void = () => {};
  let onError: (reason: string) => void = () => {};
  let dead = false;

  return {
    terminated: () => dead,
    setHandlers(m, e) { onMessage = m; onError = e; },
    terminate() { dead = true; },
    postMessage(message: unknown): void {
      const delivered: unknown = structuredClone(message);
      queueMicrotask(() => {
        if (dead) return;
        if (behaviour.mode === 'silent') return;
        if (behaviour.mode === 'error') { onError(behaviour.reason); return; }
        if (behaviour.mode === 'garbage') { onMessage({ kind: 'terrain:done', id: 1 }); return; }
        if (!isTerrainJob(delivered) && !isWaterJob(delivered)) { onError('malformed job'); return; }
        if (behaviour.mode === 'reject') {
          onMessage({
            kind: isTerrainJob(delivered) ? 'terrain:failed' : 'water:failed',
            id: (delivered as { id: number }).id,
            reason: 'generator exploded',
          });
          return;
        }
        const reply = runJob(delivered);
        if (behaviour.mode === 'corrupt' && reply.kind === 'terrain:done') {
          onMessage(structuredClone({
            ...reply,
            data: { ...reply.data, passGrid: new Uint8Array(MAP_CELL_COUNT - 1) },
          }));
          return;
        }
        onMessage(structuredClone(reply));
      });
    },
  };
}

function poolWith(behaviour: Behaviour, timeoutMs = 50): {
  pool: TexturePool; workers: ReturnType<typeof makeFakeWorker>[];
} {
  const workers: ReturnType<typeof makeFakeWorker>[] = [];
  const pool = new TexturePool({
    spawn: () => { const w = makeFakeWorker(behaviour); workers.push(w); return w; },
    size: 1,
    timeoutMs,
  });
  return { pool, workers };
}

describe('the pool never breaks the world', () => {
  const options: TerrainGenOptions = { seed: 4, biome: 'temperate' };

  it('returns fields that match the main thread when the worker works', async () => {
    const { pool } = poolWith({ mode: 'work' });
    const data = await pool.submitTerrain(options);
    expect(data).not.toBeNull();
    const inline = generateInline(options);
    expect(bytesOf(data!.height).equals(bytesOf(inline.height))).toBe(true);
    expect(data!.key).toBe(terrainGenKey(options));
    pool.dispose();
  });

  it('resolves null — never rejects — when there is no Worker at all', async () => {
    const pool = new TexturePool({ spawn: () => null, size: 1, timeoutMs: 50 });
    await expect(pool.submitTerrain(options)).resolves.toBeNull();
    await expect(pool.submitWater('k', new Float32Array(GRID_COUNT), 1, 2)).resolves.toBeNull();
    expect(pool.enabled).toBe(false);
  });

  it('resolves null when the spawn throws', async () => {
    const pool = new TexturePool({
      spawn: () => { throw new Error('CSP says no'); }, size: 1, timeoutMs: 50,
    });
    await expect(pool.submitTerrain(options)).resolves.toBeNull();
    expect(pool.reason).toContain('CSP says no');
  });

  it('resolves null when the generator throws inside the worker', async () => {
    const { pool } = poolWith({ mode: 'reject' });
    await expect(pool.submitTerrain(options)).resolves.toBeNull();
    pool.dispose();
  });

  it('resolves null and disables the pool when the worker never answers', async () => {
    const { pool, workers } = poolWith({ mode: 'silent' }, 20);
    await expect(pool.submitTerrain(options)).resolves.toBeNull();
    expect(pool.enabled).toBe(false);
    expect(workers[0].terminated()).toBe(true);
    pool.dispose();
  });

  it('resolves null when the worker script fails to load', async () => {
    const { pool } = poolWith({ mode: 'error', reason: '404' });
    await expect(pool.submitTerrain(options)).resolves.toBeNull();
    expect(pool.reason).toBe('404');
  });

  it('refuses a corrupt reply rather than adopting it', async () => {
    // The whole reason the reply guard checks lengths: this set would render a
    // map whose passability is wrong at the last row, and nothing would throw.
    const { pool } = poolWith({ mode: 'corrupt' });
    await expect(pool.submitTerrain(options)).resolves.toBeNull();
    expect(pool.enabled).toBe(false);
    pool.dispose();
  });

  it('refuses a reply this build does not understand', async () => {
    const { pool } = poolWith({ mode: 'garbage' });
    await expect(pool.submitTerrain(options)).resolves.toBeNull();
    expect(pool.enabled).toBe(false);
    pool.dispose();
  });

  it('does not hand a terrain result to a water request', async () => {
    // One shared correlation map serves four job kinds. A crossed id must
    // resolve as `null` — "bake it yourself" — never as the wrong shape.
    const { pool } = poolWith({ mode: 'work' });
    const terrain = await pool.submitTerrain(options);
    expect(terrain).not.toBeNull();
    const water = await pool.submitWater(
      'k', Float32Array.from(terrain!.height), WATER_LEVEL, WATER_SEED,
    );
    expect(water).not.toBeNull();
    expect(water!.depth).toBeInstanceOf(Float32Array);
    expect((water as unknown as { height?: unknown }).height).toBeUndefined();
    pool.dispose();
  });

  it('settles once both jobs have landed', async () => {
    const { pool } = poolWith({ mode: 'work' });
    const t = pool.submitTerrain(options);
    await pool.settle();
    expect(pool.inFlight).toBe(0);
    await t;
    pool.dispose();
  });
});

/* ==========================================================================
 * 6. THE WORKER CHUNK CARRIES NO RENDERER
 *
 * Vite emits `textureWorker.ts` and its whole import graph as a separate chunk.
 * A single `import * as THREE` anywhere in that graph puts ~700 kB of renderer
 * in a worker that draws nothing — and it would not fail anything, it would just
 * be slower for ever. So the graph is walked.
 * ========================================================================== */

describe('the world generators stay out of the renderer', () => {
  const SRC = resolve(__dirname, '..', 'src');
  const BANNED = [/from ['"]three['"]/, /from ['"].*\/render\//, /from ['"].*\/game\//];

  /** Resolve a relative import to a real file on disk. */
  function resolveImport(fromFile: string, spec: string): string | null {
    if (!spec.startsWith('.')) return null;
    const base = resolve(dirname(fromFile), spec);
    for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
      try { readFileSync(candidate); return candidate; } catch { /* next */ }
    }
    return null;
  }

  function walk(entry: string, seen = new Set<string>()): string[] {
    if (seen.has(entry)) return [];
    seen.add(entry);
    const text = readFileSync(entry, 'utf8');
    for (const re of BANNED) {
      expect(re.test(text), `${entry} imports something the worker must not carry (${re})`)
        .toBe(false);
    }
    const out = [entry];
    for (const m of text.matchAll(/from ['"]([^'"]+)['"]/g)) {
      const next = resolveImport(entry, m[1]);
      if (next !== null) out.push(...walk(next, seen));
    }
    return out;
  }

  it('has a worker import graph with no THREE, no render/, no game/', () => {
    const files = walk(join(SRC, 'core', 'workers', 'textureWorker.ts'));
    // The two generators must actually be in there, or this test is checking a
    // graph that no longer contains the thing it is guarding.
    expect(files.some((f) => f.endsWith(`world${'\\'}terrain-gen.ts`) || f.endsWith('world/terrain-gen.ts')))
      .toBe(true);
    expect(files.some((f) => f.endsWith(`world${'\\'}water-gen.ts`) || f.endsWith('world/water-gen.ts')))
      .toBe(true);
  });

  it('keeps the plan module — which does import game/ — out of that graph', () => {
    const files = walk(join(SRC, 'core', 'workers', 'textureWorker.ts'));
    expect(files.some((f) => f.includes('terrain-plan'))).toBe(false);
  });
});

/* ==========================================================================
 * 7. THE SHAPE OF A FIELD SET
 * ========================================================================== */

describe('field set shape', () => {
  it('is exactly the size the guards check for', () => {
    const data: TerrainFieldData = generateViaWorker(CASES[0][1]);
    expect(data.height.length).toBe(GRID_COUNT);
    expect(data.passGrid.length).toBe(MAP_CELL_COUNT);
    expect(data.splatA.length).toBe(SPLAT_BYTES);
    expect(data.chunks.length).toBe(TERRAIN_CHUNKS);
    expect(data.chunks[0].position.length).toBe(CHUNK_VERTS * 3);
    expect(data.chunks[0].index.length).toBe(CHUNK_INDICES);
    expect(data.generateMs).toBeGreaterThanOrEqual(0);

    // Through `heightAtGrid` rather than a `Terrain`, which is the worker's
    // own path — so this also pins the shape the guard checks on that side.
    const water: WaterFieldData = bakeWaterFields({
      bedHeight: (x, z) => heightAtGrid(data.height, x, z),
      level: WATER_LEVEL, seed: WATER_SEED,
    });
    expect(water.depth.length).toBe(FIELD_TEXELS);
    expect(water.field.length).toBe(FIELD_BYTES);
    expect(water.waterCells.length).toBe(MAP_CELL_COUNT);
  });
});

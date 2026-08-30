/**
 * ============================================================================
 * VOLTMARCH — src/core/workers/world-warm.ts
 * ============================================================================
 * THE BOOT-TIME PREWARM FOR TERRAIN AND WATER.
 *
 * Measured on the `naval` fixture before this landed: `world.terrain`'s init
 * stopped the main thread for 629 ms and `world.water`'s for another 258, back
 * to back, with the loading curtain frozen for both. Meanwhile `art.buildings`,
 * `art.faction3`, `art.faction4` and `art.units` — which run FIRST, at
 * `Phase.Command` order 0 — had already spent ~2.6 s on this same thread. The
 * two never overlapped, because there was nothing to overlap them with.
 *
 * There is now. `Bootstrap.bootstrap()` calls `prepareWorldWorkers()` before it
 * constructs the renderer or starts `registry.init()`. So the terrain job is
 * dispatched before the art systems start building models, and by the time
 * `world.terrain` asks for its fields they are usually already there. Doing it
 * at the bootstrap boundary also re-arms the pool for every in-page match.
 *
 * WATER IS CHAINED, NOT PARALLEL, and it has to be: the bake resamples the
 * terrain's finished heightfield, so it cannot start until the terrain job is
 * done. Chaining it the instant the terrain reply lands — rather than waiting
 * for `world.water`'s init at order 60 — is what buys the overlap.
 *
 * A SMALL DEDICATED POOL, NOT THE TEXTURE POOL. The texture pool has up to four workers and
 * a queue full of atlases at exactly this moment. A 600 ms terrain job dropped
 * into that round robin would sit behind them, or park one of them for the
 * whole boot and starve the atlases. The world pool is capped at two because
 * terrain fields and terrain tiles can overlap; the water field remains chained
 * behind terrain because it needs the finished heightfield.
 *
 * EVERY FAILURE ENDS IN THE OLD BEHAVIOUR. No `Worker`, a script that will not
 * load, a job that timed out, a reply this build does not understand, a key
 * that does not match the map being built: all of them produce a `null`, and a
 * `null` means "generate it on the main thread", which is what these two
 * modules did before any of this existed. `TexturePool` owns that cascade and
 * this file adds nothing to it.
 *
 * A/B SWITCHES: `?terrainworkers=off` and `?waterworkers=off`, in the same
 * style as `?greebleworkers=off`. Water off leaves terrain on. Terrain off
 * necessarily takes water with it, because the water prewarm has no bed to bake
 * over until the terrain exists — that is stated in the log rather than left
 * for someone to rediscover.
 * ============================================================================
 */

import {
  TERRAIN_LAYER_TEXTURE_SIZE, WATER_LEVEL, WATER_SEED, WATER_TEXTURE_SIZE,
} from '../config';
import { TexturePool } from './TexturePool';
import { spawnTextureWorker } from './spawn';
import { plannedTerrainInput } from '../../world/terrain-plan';
import { terrainGenKey, type TerrainFieldData } from '../../world/terrain-gen';
import { waterGenKey, type WaterFieldData } from '../../world/water-gen';
import {
  terrainTextureKey, type TerrainTextureData,
} from '../../world/terrain-texture-gen';
import { waterTextureKey, type WaterTextureData } from '../../world/water-texture-gen';

/* -------------------------------------------------------------------------- */

function flagOff(name: string): boolean {
  return typeof location !== 'undefined' && location.search.includes(`${name}=off`);
}

/**
 * The pool. One worker, created lazily on the first submit exactly as the
 * texture pool is, and disposed once both prewarms have landed.
 *
 * `timeoutMs` is generous on purpose. This is a hang detector, not a budget: a
 * terrain generation is ~600 ms on the machine this was measured on and a cold
 * worker start on a slow phone can add a lot on top, and the cost of firing
 * early is a boot that is slower than doing nothing at all.
 */
let pool: TexturePool | null = null;

let terrainPromise: Promise<TerrainFieldData | null> | null = null;
let waterPromise: Promise<WaterFieldData | null> | null = null;
let terrainTexPromise: Promise<TerrainTextureData | null> | null = null;
let waterTexPromise: Promise<WaterTextureData | null> | null = null;
/** Invalidates continuations from a prewarm superseded by a newer world boot. */
let generation = 0;

/** What actually happened, for the one line the system prints at init. */
const report = {
  installed: false,
  terrainOff: false,
  waterOff: false,
  /** Milliseconds the worker itself spent, as measured inside the worker. */
  terrainMs: 0,
  waterMs: 0,
  terrainTexMs: 0,
  waterTexMs: 0,
  terrainAdopted: false,
  waterAdopted: false,
  terrainTexAdopted: false,
  waterTexAdopted: false,
  reason: '',
};

/** For the boot log. Never used to make a decision. */
export function worldWarmReport(): Readonly<typeof report> {
  return report;
}

/**
 * Dispatch the terrain job, and chain the water job onto its reply.
 *
 * Safe to call before anything else has booted: `TexturePool` brings its worker
 * up lazily on the first submit and answers `null` for everything if it cannot.
 * Calling twice is a no-op — the promises are the cache.
 */
export function installWorldWorkers(): void {
  if (report.installed) return;
  report.installed = true;
  const ownGeneration = generation;

  report.terrainOff = flagOff('terrainworkers');
  report.waterOff = flagOff('waterworkers');

  if (report.terrainOff) {
    console.info(
      '[world] terrain worker offload disabled by ?terrainworkers=off '
      + '(water follows: its bake needs a finished heightfield)',
    );
    return;
  }

  /*
   * TWO WORKERS, NOT ONE, AND THE ARITHMETIC IS THE WHOLE ARGUMENT.
   *
   * This was a single worker while there were only two jobs and they were
   * strictly sequential — the water bake needs the terrain's finished
   * heightfield, so a second worker would have had nothing to do. The two TILE
   * jobs broke that: they read no heightfield at all, so they are ready to run
   * at the same instant the terrain job is.
   *
   * Measured on `08-naval-water`, the four jobs are roughly terrain 560 ms,
   * terrain tiles 420, water tiles 260, water bake 75. On one worker that is
   * ~1315 ms of strictly serial work; on two the longest chain is ~820, against
   * the ~2.6 s the art systems spend on the MAIN thread before `world.terrain`'s
   * init runs at all. Either fits, which is exactly why this is capped at two
   * rather than raised further — the art pool already takes up to four workers
   * for its atlases, and a world pool that grew to match would be competing
   * with the work it exists to hide behind.
   *
   * Capped by hardware as well as by the constant: on a two-core machine a
   * second world worker is a second thread contending for the same core, and
   * `defaultPoolSize`'s "leave a core for the thread that is trying to boot a
   * game" applies here for the same reason.
   */
  const cores = typeof navigator !== 'undefined'
    && typeof navigator.hardwareConcurrency === 'number'
    ? navigator.hardwareConcurrency
    : 4;
  const size = Math.max(1, Math.min(2, cores - 2));

  pool = new TexturePool({
    spawn: spawnTextureWorker,
    size,
    timeoutMs: 20_000,
    onDisabled: (reason) => {
      report.reason = reason;
    },
  });

  const input = plannedTerrainInput();
  const tKey = terrainGenKey(input);

  terrainPromise = pool.submitTerrain(input).then((data) => {
    if (ownGeneration !== generation) return null;
    if (data !== null) report.terrainMs = data.generateMs;
    return data;
  });

  /*
   * THE TILE JOBS ARE SUBMITTED HERE, not chained onto anything.
   *
   * `TexturePool` hands jobs out round robin, so with two workers the terrain
   * generation and the terrain tiles start together on separate threads and the
   * water tiles queue behind whichever finishes first. The water BAKE still
   * chains off the terrain reply below, because it genuinely cannot start
   * earlier.
   *
   * `?terrainworkers=off` has already returned above and takes these with it,
   * which is the honest behaviour: that flag means "do the world on the main
   * thread" and a boot that offloaded the tiles but not the heightfield would
   * measure neither path.
   */
  terrainTexPromise = pool.submitTerrainTextures(
    input.biome, TERRAIN_LAYER_TEXTURE_SIZE, input.seed,
  ).then((data) => {
    if (ownGeneration !== generation) return null;
    if (data !== null) report.terrainTexMs = data.generateMs;
    return data;
  });

  /*
   * The water TILES do not depend on the bed, so unlike the bake they are
   * dispatched immediately — but they DO follow `?waterworkers=off`, so that
   * the flag still means "no water offload of any kind" rather than half of one.
   */
  waterTexPromise = report.waterOff
    ? Promise.resolve(null)
    : pool.submitWaterTextures(WATER_TEXTURE_SIZE, WATER_SEED).then((data) => {
      if (ownGeneration !== generation) return null;
      if (data !== null) report.waterTexMs = data.generateMs;
      return data;
    });

  waterPromise = terrainPromise.then((terrain) => {
    if (ownGeneration !== generation) return null;
    // No terrain means no bed. Not an error — the terrain will be generated on
    // the main thread and the water will be baked there too, which is the
    // behaviour that shipped before this file existed.
    if (terrain === null || report.waterOff || pool === null) {
      if (report.waterOff) {
        console.info('[world] water worker offload disabled by ?waterworkers=off');
      }
      return null;
    }
    /*
     * THE HEIGHT IS COPIED, NOT TRANSFERRED. `terrain.height` is the array the
     * main thread is about to build the live map out of; handing it over would
     * detach it and leave a flat black world with no error anywhere. Structured
     * clone of 1 MB is a fraction of a millisecond and it is not optional.
     */
    return pool.submitWater(
      waterGenKey(tKey, WATER_LEVEL, WATER_SEED), terrain.height, WATER_LEVEL, WATER_SEED,
    ).then((data) => {
      if (ownGeneration !== generation) return null;
      if (data !== null) report.waterMs = data.bakeMs;
      return data;
    });
  });
}

/**
 * Start one correctly keyed prewarm for the world `bootstrap()` is about to
 * build.
 *
 * The engine module is cached for the page lifetime while the shell can build
 * many matches. A module-scope prewarm therefore serves only the first boot;
 * every later map sees an old key and falls back to synchronous generation.
 * Re-arm at the actual bootstrap boundary instead. Incrementing the generation
 * before disposal also makes already-resolved promise continuations from the
 * old pool harmless: they may run, but they cannot publish bytes or timings
 * into the new boot.
 */
export function prepareWorldWorkers(): void {
  generation++;
  disposeWorldWorkers();
  terrainPromise = null;
  waterPromise = null;
  terrainTexPromise = null;
  waterTexPromise = null;
  Object.assign(report, {
    installed: false,
    terrainOff: false,
    waterOff: false,
    terrainMs: 0,
    waterMs: 0,
    terrainTexMs: 0,
    waterTexMs: 0,
    terrainAdopted: false,
    waterAdopted: false,
    terrainTexAdopted: false,
    waterTexAdopted: false,
    reason: '',
  });
  installWorldWorkers();
}

/**
 * The prewarmed terrain fields, or null.
 *
 * Awaited by `world.terrain`'s init. It resolves immediately once the job has
 * landed, which on every machine measured so far it has — the art systems ahead
 * of it in the init order take longer than the generation does.
 */
export function prewarmedTerrain(): Promise<TerrainFieldData | null> {
  if (terrainPromise === null) return Promise.resolve(null);
  return terrainPromise;
}

/** The prewarmed water fields, or null. Awaited by `world.water`'s init. */
export function prewarmedWater(): Promise<WaterFieldData | null> {
  if (waterPromise === null) return Promise.resolve(null);
  return waterPromise;
}

/** The key a prewarmed water set must carry to be adopted. */
export function prewarmedWaterKey(): string {
  return waterGenKey(terrainGenKey(plannedTerrainInput()), WATER_LEVEL, WATER_SEED);
}

/**
 * The prewarmed terrain TILES, or null. Awaited by `world.terrain`'s init
 * alongside the fields.
 *
 * Awaiting both is one wait, not two: they were dispatched together and
 * `Promise.all` resolves when the slower lands, which is the honest figure for
 * "how long the boot stopped here".
 */
export function prewarmedTerrainTextures(): Promise<TerrainTextureData | null> {
  if (terrainTexPromise === null) return Promise.resolve(null);
  return terrainTexPromise;
}

/** The prewarmed water TILES, or null. Awaited by `world.water`'s init. */
export function prewarmedWaterTextures(): Promise<WaterTextureData | null> {
  if (waterTexPromise === null) return Promise.resolve(null);
  return waterTexPromise;
}

/** The key a prewarmed terrain tile set must carry to be adopted. */
export function prewarmedTerrainTextureKey(): string {
  const input = plannedTerrainInput();
  return terrainTextureKey(input.biome, TERRAIN_LAYER_TEXTURE_SIZE, input.seed);
}

/** The key a prewarmed water tile set must carry to be adopted. */
export function prewarmedWaterTextureKey(): string {
  return waterTextureKey(WATER_TEXTURE_SIZE, WATER_SEED);
}

/** Record that a caller actually used a prewarmed set. For the boot log only. */
export function notePrewarmAdopted(
  which: 'terrain' | 'water' | 'terrainTex' | 'waterTex', adopted: boolean,
): void {
  if (which === 'terrain') report.terrainAdopted = adopted;
  else if (which === 'water') report.waterAdopted = adopted;
  else if (which === 'terrainTex') report.terrainTexAdopted = adopted;
  else report.waterTexAdopted = adopted;
}

/**
 * Shut the world worker down.
 *
 * Called once both prewarms have been collected. Holding a worker open for the
 * whole match to serve two jobs that only ever happen at boot is a thread and
 * ~50 MB of heap for nothing — and a biome swap from the console rebuilds on
 * the main thread by design, because a mid-match pop-in three frames later is
 * worse than a 600 ms hitch the player asked for.
 */
export function disposeWorldWorkers(): void {
  pool?.dispose();
  pool = null;
}

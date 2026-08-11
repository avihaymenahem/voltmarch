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
 * There is now. `installWorldWorkers()` is called from the module scope of
 * `src/world/world-warm.system.ts`, which the system glob imports before
 * `registry.init()` runs a single module. So the terrain job is dispatched at
 * roughly the same moment the art systems start building models, and by the
 * time `world.terrain` asks for its fields they are usually already there.
 *
 * WATER IS CHAINED, NOT PARALLEL, and it has to be: the bake resamples the
 * terrain's finished heightfield, so it cannot start until the terrain job is
 * done. Chaining it the instant the terrain reply lands — rather than waiting
 * for `world.water`'s init at order 60 — is what buys the overlap.
 *
 * ONE WORKER, NOT THE TEXTURE POOL. The texture pool has up to four workers and
 * a queue full of atlases at exactly this moment. A 600 ms terrain job dropped
 * into that round robin would sit behind them, or park one of them for the
 * whole boot and starve the atlases. A dedicated single worker keeps the two
 * kinds of work from fighting, and the two prewarms are strictly sequential
 * anyway, so a second world worker would have nothing to do.
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

import { WATER_LEVEL, WATER_SEED } from '../config';
import { TexturePool } from './TexturePool';
import { spawnTextureWorker } from './spawn';
import { plannedTerrainInput } from '../../world/terrain-plan';
import { terrainGenKey, type TerrainFieldData } from '../../world/terrain-gen';
import { waterGenKey, type WaterFieldData } from '../../world/water-gen';

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

/** What actually happened, for the one line the system prints at init. */
const report = {
  installed: false,
  terrainOff: false,
  waterOff: false,
  /** Milliseconds the worker itself spent, as measured inside the worker. */
  terrainMs: 0,
  waterMs: 0,
  terrainAdopted: false,
  waterAdopted: false,
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

  report.terrainOff = flagOff('terrainworkers');
  report.waterOff = flagOff('waterworkers');

  if (report.terrainOff) {
    console.info(
      '[world] terrain worker offload disabled by ?terrainworkers=off '
      + '(water follows: its bake needs a finished heightfield)',
    );
    return;
  }

  pool = new TexturePool({
    spawn: spawnTextureWorker,
    size: 1,
    timeoutMs: 20_000,
    onDisabled: (reason) => {
      report.reason = reason;
    },
  });

  const input = plannedTerrainInput();
  const tKey = terrainGenKey(input);

  terrainPromise = pool.submitTerrain(input).then((data) => {
    if (data !== null) report.terrainMs = data.generateMs;
    return data;
  });

  waterPromise = terrainPromise.then((terrain) => {
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
      if (data !== null) report.waterMs = data.bakeMs;
      return data;
    });
  });
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

/** Record that a caller actually used a prewarmed set. For the boot log only. */
export function notePrewarmAdopted(which: 'terrain' | 'water', adopted: boolean): void {
  if (which === 'terrain') report.terrainAdopted = adopted;
  else report.waterAdopted = adopted;
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

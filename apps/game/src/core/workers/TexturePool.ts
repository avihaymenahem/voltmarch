/**
 * ============================================================================
 * VOLTMARCH — src/core/workers/TexturePool.ts
 * ============================================================================
 * THE CLIENT SIDE OF THE WORKER. A small round-robin pool with one governing
 * rule:
 *
 *   THE POOL MAY NEVER BE THE REASON THE GAME FAILS TO BOOT.
 *
 * Everything in here is arranged around that. `submit` never rejects and never
 * throws; it resolves with `null`, which means "I could not do this, generate
 * it yourself". Every failure mode — no `Worker` in the platform, a constructor
 * that throws, a script that 404s, a generator that blows up, a worker that
 * simply never answers — funnels into `disable()`, which terminates the pool,
 * resolves every outstanding request with `null`, and stays off for good. The
 * caller's fallback path is the synchronous generator that shipped before any
 * of this existed, so "the pool is off" is exactly the old behaviour.
 *
 * A HANG IS THE ONE FAILURE WORTH SPELLING OUT. A worker that errors is easy:
 * the error event fires and we fall back in a millisecond. A worker that
 * accepts a job and never replies would hold the loading curtain up forever,
 * which is strictly worse than never having started it. Hence `timeoutMs` on
 * every single job, and hence a timeout being treated as fatal to the whole
 * pool rather than to the one job: a worker that missed a deadline once has
 * given us no reason to trust the next one.
 *
 * WHY `spawn` IS INJECTED. The test suite runs `environment: 'node'`. There is
 * no `Worker` there, so a pool that constructed its own could only ever be
 * tested by not testing it. Taking a spawn function means the whole pool —
 * round-robin, correlation, timeout, the disable cascade — runs against a fake
 * worker in Node, and `./spawn.ts` is the only file in the project that names
 * the real one.
 *
 * IT IS STILL CALLED `TexturePool`, and it now serves six job kinds: textures,
 * greeble atlases, terrain and water fields, and the terrain and water TILES.
 * The name is the one every caller and spec already imports and renaming it
 * would be a large diff for no behaviour; what matters is that there is ONE
 * disable cascade rather than six copies of it. Two INSTANCES exist —
 * `src/core/assets.ts` owns the art pool (up to four workers) and
 * `./world-warm.ts` owns a small pool for the four boot-time world jobs, so a
 * 500 ms terrain generation cannot park an atlas.
 * ============================================================================
 */

import type { Channel, TextureRequest } from '../surfaces';
import { logDiagnostic } from '../diagnostic-log';
import {
  isWorkerReply,
  type GreebleJob, type TerrainJob, type TerrainTexJob, type TextureJob,
  type TextureLayer, type WaterJob, type WaterTexJob,
} from './protocol';
import type { GreebleAtlasData, GreebleSpec } from '../../art/greeble-gen';
import type { TerrainFieldData, TerrainGenOptions } from '../../world/terrain-gen';
import type { WaterFieldData } from '../../world/water-gen';
import type { TerrainTextureData } from '../../world/terrain-texture-gen';
import type { WaterTextureData } from '../../world/water-texture-gen';
import type { IrradianceFieldData } from '../../world/irradiance-field';

/* ==========================================================================
 * THE WORKER SEAM
 * ========================================================================== */

/**
 * The slice of `Worker` this pool uses.
 *
 * Handlers are installed through one method rather than as assignable
 * properties so a fake needs no `MessageEvent` and no DOM types at all —
 * `./spawn.ts` adapts the real `Worker` onto this, and that adapter is the
 * only place the two vocabularies meet.
 */
export interface WorkerLike {
  /** `transfer` lists buffers to hand over rather than copy. */
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  terminate(): void;
  /**
   * @param onMessage  raw `event.data`, still `unknown` — the pool validates.
   * @param onError    any worker-level failure, already reduced to a string.
   */
  setHandlers(onMessage: (data: unknown) => void, onError: (reason: string) => void): void;
}

/** Returns a worker, or null when the platform cannot provide one. */
export type SpawnWorker = () => WorkerLike | null;

export interface TexturePoolOptions {
  /** How to make a worker. Never called until the first job is submitted. */
  readonly spawn: SpawnWorker;
  /** Hard cap on workers. Defaults to hardware concurrency minus one, max 4. */
  readonly size?: number;
  /**
   * Per-job deadline. Generous on purpose: a 512² pavement is ~175 ms of real
   * work on the machine this was measured on, and a cold worker start on a
   * slow phone can add a lot on top. This is a hang detector, not a
   * performance budget.
   */
  readonly timeoutMs?: number;
  /** Called once, with the reason, the first time the pool gives up. */
  readonly onDisabled?: (reason: string) => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_WORKERS = 4;

/** Workers worth starting for texture work on this machine. */
function defaultPoolSize(): number {
  const cores = typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
    ? navigator.hardwareConcurrency
    : 4;
  // Leave a core for the thread that is trying to boot a game.
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
}

/**
 * What a completed job hands back. One union rather than two pending maps,
 * because everything else about a job — the id, the deadline, the round-robin,
 * the give-up-and-fall-back rule — is identical for both kinds, and two maps
 * would mean two places to remember to clear a timer.
 *
 * The submit methods narrow it; see the resolve closures there.
 */
type JobResult =
  readonly TextureLayer[] | GreebleAtlasData | TerrainFieldData | WaterFieldData
  | TerrainTextureData | WaterTextureData | TerrainWarmData | null;

/** One terrain job owns both payloads so no live terrain array is cloned. */
export interface TerrainWarmData {
  readonly terrain: TerrainFieldData;
  readonly irradiance: IrradianceFieldData | null;
}

interface Pending {
  readonly resolve: (result: JobResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Narrow a job result to an atlas.
 *
 * `!Array.isArray(r)` does NOT do this: `Array.isArray` cannot narrow a
 * `readonly T[]` out of a union, so the negative branch keeps the layer array
 * in and the assignment fails. Discriminating on a property an array does not
 * have is both correct and cheaper than a structural check — arrays carry
 * `length`, never `size`.
 */
function isAtlasResult(r: JobResult): r is GreebleAtlasData {
  return r !== null && typeof (r as { size?: unknown }).size === 'number';
}

/**
 * Narrow a job result to a terrain field set.
 *
 * Same discipline as `isAtlasResult`, on a property nothing else in the union
 * carries. A crossed reply id resolving a terrain request with an ATLAS would
 * otherwise hand `Terrain.adopt` an object with no `passGrid`, and the map
 * would come up with nothing passable — which reads as a pathfinding bug, five
 * files away from the cause.
 */
function isTerrainResult(r: JobResult): r is TerrainWarmData {
  return r !== null
    && (r as { terrain?: { height?: unknown } }).terrain?.height instanceof Float32Array
    && ((r as { irradiance?: unknown }).irradiance === null
      || (r as { irradiance?: { rgba?: unknown } }).irradiance?.rgba instanceof Float32Array);
}

/** Narrow a job result to a water field set. */
function isWaterResult(r: JobResult): r is WaterFieldData {
  return r !== null && (r as { depth?: unknown }).depth instanceof Float32Array;
}

/** Narrow a job result to packed channel layers. */
function isLayerResult(r: JobResult): r is readonly TextureLayer[] {
  return r !== null && typeof (r as { length?: unknown }).length === 'number';
}

/**
 * Narrow a job result to a terrain texture set.
 *
 * Same discipline as the four above, on a property nothing else in the union
 * carries. `layers` is a `Uint8Array` here and an ARRAY on a texture reply, so
 * the `instanceof` is doing real work rather than decorating a truthiness test
 * — `isLayerResult` would happily claim a `Uint8Array` too, which is why every
 * one of these is a positive test on a distinct property rather than a chain of
 * exclusions. That distinction is what stopped being true the last time a job
 * kind was added.
 */
function isTerrainTexResult(r: JobResult): r is TerrainTextureData {
  return r !== null && (r as { layers?: unknown }).layers instanceof Uint8Array;
}

/** Narrow a job result to a water texture set. */
function isWaterTexResult(r: JobResult): r is WaterTextureData {
  return r !== null && (r as { waves?: unknown }).waves instanceof Uint8Array;
}

/* ==========================================================================
 * THE POOL
 * ========================================================================== */

export class TexturePool {
  private readonly spawn: SpawnWorker;
  private readonly size: number;
  private readonly timeoutMs: number;
  private readonly onDisabled: ((reason: string) => void) | undefined;

  private readonly workers: WorkerLike[] = [];
  private readonly pending = new Map<number, Pending>();
  private idle: (() => void)[] = [];

  private nextId = 1;
  private cursor = 0;
  private started = false;
  private off = false;
  private disabledReason = '';

  constructor(options: TexturePoolOptions) {
    this.spawn = options.spawn;
    this.size = Math.max(1, options.size ?? defaultPoolSize());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onDisabled = options.onDisabled;
  }

  /** False once the pool has given up. Never returns to true. */
  get enabled(): boolean {
    return !this.off;
  }

  /** Why the pool gave up, or '' while it has not. */
  get reason(): string {
    return this.disabledReason;
  }

  /** Jobs submitted and not yet answered. */
  get inFlight(): number {
    return this.pending.size;
  }

  /** Workers actually running. Zero until the first submit. */
  get workerCount(): number {
    return this.workers.length;
  }

  /**
   * Queue one generator run and one packing per channel.
   *
   * Resolves with the packed layers, or with `null` when the pool could not
   * serve it — a `null` is not an error, it is an instruction to the caller to
   * generate the texture on the calling thread instead. This method never
   * rejects.
   */
  submit(request: TextureRequest, channels: readonly Channel[]): Promise<readonly TextureLayer[] | null> {
    if (this.off || channels.length === 0) return Promise.resolve(null);
    if (!this.start()) return Promise.resolve(null);

    const id = this.nextId++;
    const worker = this.workers[this.cursor];
    this.cursor = (this.cursor + 1) % this.workers.length;

    return new Promise<readonly TextureLayer[] | null>((resolve) => {
      const timer = setTimeout(() => {
        // A worker that stopped answering has already cost us more than it can
        // now save. Kill the pool, not just the job.
        this.disable(`job ${id} (${request.kind}) exceeded ${this.timeoutMs} ms`);
      }, this.timeoutMs);
      // Narrow on the way out: a texture job can only be answered by layers.
      // Anything else is a reply that got crossed with another job's id, and
      // the honest answer to that is `null` — generate it here — rather than
      // handing a greeble atlas to a caller expecting channel packings.
      //
      // POSITIVE test, not a list of exclusions. This used to read "not an
      // atlas and not null", which was correct while those were the only two
      // other shapes and quietly stopped being correct the moment terrain and
      // water joined the union. `Array.isArray` cannot narrow a `readonly T[]`
      // out of a union, so the check is on `length` — the one property the
      // layer array has and no field set does.
      this.pending.set(id, {
        resolve: (r) => { resolve(isLayerResult(r) ? r : null); },
        timer,
      });

      const job: TextureJob = { id, request, channels };
      try {
        worker.postMessage(job);
      } catch (err: unknown) {
        // A request that will not structured-clone. That is a bug in the
        // request, not in the worker, but the effect is the same: fall back.
        this.disable(err instanceof Error ? err.message : String(err));
      }
    });
  }

  /**
   * Queue one greeble atlas.
   *
   * Same contract as `submit`: resolves with `null` rather than rejecting when
   * the pool cannot serve it, and `null` means "build it on the calling thread
   * instead". `GreebleFactory.prewarm` is the only caller, and it treats a null
   * as "this one stays a main-thread build", which is exactly what used to
   * happen for all of them.
   */
  submitGreeble(spec: GreebleSpec): Promise<GreebleAtlasData | null> {
    if (this.off) return Promise.resolve(null);
    if (!this.start()) return Promise.resolve(null);

    const id = this.nextId++;
    const worker = this.workers[this.cursor];
    this.cursor = (this.cursor + 1) % this.workers.length;

    return new Promise<GreebleAtlasData | null>((resolve) => {
      const timer = setTimeout(() => {
        this.disable(`greeble job ${id} (${spec.key}) exceeded ${this.timeoutMs} ms`);
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (r) => { resolve(isAtlasResult(r) ? r : null); },
        timer,
      });

      const job: GreebleJob = { kind: 'greeble', id, spec };
      try {
        worker.postMessage(job);
      } catch (err: unknown) {
        this.disable(err instanceof Error ? err.message : String(err));
      }
    });
  }

  /**
   * Queue one terrain generation.
   *
   * Same contract as `submit`: resolves with `null` rather than rejecting, and
   * a `null` means "generate it on the calling thread". `world-warm.ts` is the
   * only caller and `Terrain` re-checks the key before adopting anything, so a
   * result that arrives late, crossed or for a different map is refused twice.
   */
  submitTerrain(
    options: TerrainGenOptions, irradiance = true,
  ): Promise<TerrainWarmData | null> {
    if (this.off) return Promise.resolve(null);
    if (!this.start()) return Promise.resolve(null);

    const id = this.nextId++;
    const worker = this.workers[this.cursor];
    this.cursor = (this.cursor + 1) % this.workers.length;

    return new Promise<TerrainWarmData | null>((resolve) => {
      const timer = setTimeout(() => {
        this.disable(`terrain job ${id} exceeded ${this.timeoutMs} ms`);
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (r) => { resolve(isTerrainResult(r) ? r : null); },
        timer,
      });

      const job: TerrainJob = { kind: 'terrain', id, options, irradiance };
      try {
        worker.postMessage(job);
      } catch (err: unknown) {
        this.disable(err instanceof Error ? err.message : String(err));
      }
    });
  }

  /**
   * Queue one water bake over a heightfield.
   *
   * `height` is COPIED by structured clone, not transferred — see the header of
   * the world job block in `protocol.ts`. It is the array the live terrain is
   * about to be built from, and transferring it would detach it.
   */
  submitWater(
    key: string, height: Float32Array, level: number, seed: number,
  ): Promise<WaterFieldData | null> {
    if (this.off) return Promise.resolve(null);
    if (!this.start()) return Promise.resolve(null);

    const id = this.nextId++;
    const worker = this.workers[this.cursor];
    this.cursor = (this.cursor + 1) % this.workers.length;

    return new Promise<WaterFieldData | null>((resolve) => {
      const timer = setTimeout(() => {
        this.disable(`water job ${id} exceeded ${this.timeoutMs} ms`);
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (r) => { resolve(isWaterResult(r) ? r : null); },
        timer,
      });

      const job: WaterJob = { kind: 'water', id, key, height, level, seed };
      try {
        worker.postMessage(job);
      } catch (err: unknown) {
        this.disable(err instanceof Error ? err.message : String(err));
      }
    });
  }

  /**
   * Queue one terrain TILE set — the six layer albedos plus the warp and macro
   * supports.
   *
   * Independent of `submitTerrain` and dispatched alongside it rather than
   * after: these tiles are a function of `(biome, size, seed)` and read no
   * heightfield, so chaining them behind a generation would cost ~420 ms of
   * boot for nothing. Same contract as every other submit — resolves with
   * `null` rather than rejecting, and a `null` means "build them on the calling
   * thread", which is what `createTerrainMaterials` does when its key misses.
   */
  submitTerrainTextures(
    biome: string, size: number, seed: number,
  ): Promise<TerrainTextureData | null> {
    if (this.off) return Promise.resolve(null);
    if (!this.start()) return Promise.resolve(null);

    const id = this.nextId++;
    const worker = this.workers[this.cursor];
    this.cursor = (this.cursor + 1) % this.workers.length;

    return new Promise<TerrainTextureData | null>((resolve) => {
      const timer = setTimeout(() => {
        this.disable(`terrain texture job ${id} (${biome}) exceeded ${this.timeoutMs} ms`);
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (r) => { resolve(isTerrainTexResult(r) ? r : null); },
        timer,
      });

      const job: TerrainTexJob = { kind: 'terrainTex', id, biome, size, seed };
      try {
        worker.postMessage(job);
      } catch (err: unknown) {
        this.disable(err instanceof Error ? err.message : String(err));
      }
    });
  }

  /** Queue one water TILE set — the wave-slope map and the foam lace. */
  submitWaterTextures(size: number, seed: number): Promise<WaterTextureData | null> {
    if (this.off) return Promise.resolve(null);
    if (!this.start()) return Promise.resolve(null);

    const id = this.nextId++;
    const worker = this.workers[this.cursor];
    this.cursor = (this.cursor + 1) % this.workers.length;

    return new Promise<WaterTextureData | null>((resolve) => {
      const timer = setTimeout(() => {
        this.disable(`water texture job ${id} exceeded ${this.timeoutMs} ms`);
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (r) => { resolve(isWaterTexResult(r) ? r : null); },
        timer,
      });

      const job: WaterTexJob = { kind: 'waterTex', id, size, seed };
      try {
        worker.postMessage(job);
      } catch (err: unknown) {
        this.disable(err instanceof Error ? err.message : String(err));
      }
    });
  }

  /**
   * Resolves once nothing is in flight. Boot awaits this before dropping the
   * loading curtain, so no placeholder pixels are ever on screen.
   *
   * Resolves immediately when the pool is idle or disabled, and — because
   * every job carries a deadline that disables the pool — it cannot wait
   * longer than `timeoutMs` past the last submission.
   */
  settle(): Promise<void> {
    if (this.pending.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => { this.idle.push(resolve); });
  }

  /** Terminate everything. Outstanding jobs resolve with `null`. */
  dispose(): void {
    this.disable('disposed');
  }

  /* -- internals --------------------------------------------------------- */

  /** Lazily bring workers up. Returns false if none could be started. */
  private start(): boolean {
    if (this.started) return this.workers.length > 0;
    this.started = true;
    for (let i = 0; i < this.size; i++) {
      let worker: WorkerLike | null = null;
      try {
        worker = this.spawn();
      } catch (err: unknown) {
        worker = null;
        if (i === 0) this.disabledReason = err instanceof Error ? err.message : String(err);
      }
      if (worker === null) break;
      worker.setHandlers(
        (data: unknown) => { this.onMessage(data); },
        (reason: string) => { this.disable(reason); },
      );
      this.workers.push(worker);
    }
    if (this.workers.length === 0) {
      this.disable(this.disabledReason || 'no worker available on this platform');
      return false;
    }
    return true;
  }

  private onMessage(data: unknown): void {
    if (!isWorkerReply(data)) {
      this.disable('worker sent a message this build does not understand');
      return;
    }
    const entry = this.pending.get(data.id);
    // A reply for a job we already gave up on. Nothing to do; not an error.
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    this.pending.delete(data.id);
    entry.resolve(
      data.kind === 'texture:done' ? data.layers
        : data.kind === 'greeble:done' ? data.data
          : data.kind === 'terrain:done' ? { terrain: data.data, irradiance: data.irradiance }
            : data.kind === 'water:done' ? data.data
              : data.kind === 'terrainTex:done' ? data.data
                : data.kind === 'waterTex:done' ? data.data
                  : null,
    );
    this.drain();
  }

  /**
   * Give up, once and for all. Terminates every worker, releases every waiter
   * with `null`, and latches off so nothing tries again this session.
   */
  private disable(reason: string): void {
    if (this.off) return;
    this.off = true;
    this.disabledReason = reason;
    if (reason !== 'disposed') {
      logDiagnostic('warn', 'worker', 'pool-disabled', 'Worker pool disabled; falling back to the main thread', {
        reason,
        workers: this.workers.length,
        pending: this.pending.size,
      });
    }
    for (const w of this.workers) {
      try { w.terminate(); } catch { /* already gone; nothing to salvage */ }
    }
    this.workers.length = 0;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(null);
    }
    this.pending.clear();
    this.drain();
    this.onDisabled?.(reason);
  }

  /** Release `settle()` waiters once the queue has emptied. */
  private drain(): void {
    if (this.pending.size > 0) return;
    const waiting = this.idle;
    this.idle = [];
    for (const resolve of waiting) resolve();
  }
}

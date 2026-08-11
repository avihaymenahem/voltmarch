/**
 * ============================================================================
 * VOLTMARCH — src/core/workers/TexturePool.ts
 * ============================================================================
 * THE CLIENT SIDE OF THE TEXTURE WORKER. A small round-robin pool with one
 * governing rule:
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
 * ============================================================================
 */

import type { Channel, TextureRequest } from '../surfaces';
import {
  isWorkerReply, type GreebleJob, type TextureJob, type TextureLayer,
} from './protocol';
import type { GreebleAtlasData, GreebleSpec } from '../../art/greeble-gen';

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
type JobResult = readonly TextureLayer[] | GreebleAtlasData | null;

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
      this.pending.set(id, {
        resolve: (r) => { resolve(isAtlasResult(r) || r === null ? null : r); },
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

/**
 * ============================================================================
 * VOLTMARCH — src/core/workers/protocol.ts
 * ============================================================================
 * THE WIRE FORMAT BETWEEN THE MAIN THREAD AND THE TEXTURE WORKER.
 *
 * Everything crossing `postMessage` is defined here, together with the ONE
 * function that actually does the work — `runTextureJob`. The worker entry
 * (`textureWorker.ts`) is a nine-line shim over it, which means the whole job
 * body is reachable from a Node test with no `Worker` in sight. That matters:
 * the suite runs `environment: 'node'`, so anything that only exists inside a
 * real worker is code nothing can gate.
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
 * `surfaces.ts` split is that the worker chunk does not carry a renderer.
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

/** Everything the worker may be sent. */
export type WorkerJob = TextureJob | GreebleJob;
/** Everything the worker may send back. */
export type WorkerReply = TextureReply | GreebleReply;

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
  if (v.kind === 'greeble') return false;
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

/** Either reply shape. */
export function isWorkerReply(v: unknown): v is WorkerReply {
  return isTextureReply(v) || isGreebleReply(v);
}

/**
 * The buffers a reply owns, for `postMessage`'s transfer list. Transferring
 * rather than copying is the whole reason this is worth doing at 512²: a
 * pavement material is 3 MB of bytes, and a structured-clone copy of that is
 * main-thread time we just spent a worker to avoid.
 */
export function replyTransfers(reply: WorkerReply): ArrayBuffer[] {
  if (reply.kind === 'greeble:done') return greebleTransfers(reply.data);
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
 * Dispatch either job kind. The worker shim is this call and nothing else.
 *
 * Dispatches on the type GUARD rather than on a `kind` field, because
 * `TextureJob` has no top-level `kind` — its discriminator is nested at
 * `request.kind`, and it predates there being a second job. Adding one now
 * would be a wire-format change for no gain when a guard already exists and is
 * the thing the worker has to run on every message anyway.
 */
export function runJob(job: WorkerJob): WorkerReply {
  return isGreebleJob(job) ? runGreebleJob(job) : runTextureJob(job);
}

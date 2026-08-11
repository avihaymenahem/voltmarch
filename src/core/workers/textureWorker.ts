/**
 * ============================================================================
 * VOLTMARCH — src/core/workers/textureWorker.ts
 * ============================================================================
 * THE TEXTURE WORKER ENTRY. The first Web Worker in this project.
 *
 * Deliberately almost empty. All of the logic lives in `./protocol.ts`, which
 * a Node test can import and drive directly — the suite runs
 * `environment: 'node'` and has no `Worker`, so any logic that lived HERE
 * would be logic nothing could gate. This file is the shim, and a shim is all
 * it is allowed to be.
 *
 * WHAT IT MAY IMPORT
 * ------------------
 * `./protocol` -> `../surfaces` -> `../math`, plus `../../art/greeble-gen` and
 * `../../world/{terrain,water}-gen` -> the same two. That is the entire graph,
 * and it contains no THREE and no DOM. Importing `../assets` here would drag
 * ~700 kB of Three.js into the worker chunk to build zero renderers with it;
 * the `surfaces.ts` split exists precisely so that cannot happen by accident,
 * and `greeble-gen.ts`, `terrain-gen.ts` and `water-gen.ts` were split out of
 * their THREE-carrying modules for the identical reason.
 * `tests/texture-workers.spec.ts` and `tests/world-workers.spec.ts` walk this
 * graph and fail on a stray import.
 *
 * FOUR JOB KINDS
 * --------------
 * Textures (one generator run, N channel packings), greeble atlases (one run,
 * four packings plus the float fields the R1 gate re-measures), terrain (the
 * heightfield, the nav grids, the splat and 64 chunks of vertices) and water
 * (the depth/shore fields and the packed field texture). They are separate
 * shapes on one wire; `runJob` dispatches.
 *
 * They do NOT all share one pool. Textures and greeble do — there are only ever
 * a handful of workers and both kinds land at boot, competing for them. The two
 * world jobs get their own single worker, because a 500 ms terrain generation
 * dropped into the atlas round robin would either sit behind the atlases or
 * park one of the four for the whole boot. See `world-warm.ts`.
 *
 * WHY THE BUFFERS ARE TRANSFERRED
 * -------------------------------
 * A 512² material is three RGBA maps — about 3 MB. Structured-cloning that
 * back would spend main-thread time copying, which is the cost we started a
 * worker to avoid. `replyTransfers` hands the buffers over instead, so the
 * reply costs a pointer.
 * ============================================================================
 */

import {
  isGreebleJob, isTerrainJob, isTextureJob, isWaterJob, replyTransfers, runJob,
} from './protocol';

/**
 * Narrow the global to the worker scope.
 *
 * `tsconfig.json` loads BOTH the `DOM` and `WebWorker` libs (the game needs
 * DOM, this file needs the worker globals), so the ambient `self` resolves to
 * `Window`. A module-scoped `declare` shadows it with the truth, which is the
 * same trick `Bootstrap.ts` uses for `__DEV__` — and it costs no cast and no
 * `@ts-ignore`.
 */
declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent): void => {
  const job: unknown = event.data;
  if (!isTextureJob(job) && !isGreebleJob(job) && !isTerrainJob(job) && !isWaterJob(job)) {
    // Not our message shape. Say so rather than throwing: an unhandled throw
    // in a worker fires `onerror` on the main thread, and the pool reads that
    // as "the worker is broken" and disables itself for the rest of the boot.
    console.warn('[textureWorker] ignoring malformed message', job);
    return;
  }
  const reply = runJob(job);
  self.postMessage(reply, { transfer: replyTransfers(reply) });
};

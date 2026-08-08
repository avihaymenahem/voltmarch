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
 * `./protocol` -> `../surfaces` -> `../math`. That is the entire graph, and it
 * contains no THREE and no DOM. Importing `../assets` here would drag ~700 kB
 * of Three.js into the worker chunk to build zero renderers with it; the
 * `surfaces.ts` split exists precisely so that cannot happen by accident.
 *
 * WHY THE BUFFERS ARE TRANSFERRED
 * -------------------------------
 * A 512² material is three RGBA maps — about 3 MB. Structured-cloning that
 * back would spend main-thread time copying, which is the cost we started a
 * worker to avoid. `replyTransfers` hands the buffers over instead, so the
 * reply costs a pointer.
 * ============================================================================
 */

import { isTextureJob, replyTransfers, runTextureJob } from './protocol';

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
  if (!isTextureJob(job)) {
    // Not our message shape. Say so rather than throwing: an unhandled throw
    // in a worker fires `onerror` on the main thread, and the pool reads that
    // as "the worker is broken" and disables itself for the rest of the boot.
    console.warn('[textureWorker] ignoring malformed message', job);
    return;
  }
  const reply = runTextureJob(job);
  self.postMessage(reply, { transfer: replyTransfers(reply) });
};

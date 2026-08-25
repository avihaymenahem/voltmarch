/**
 * ============================================================================
 * VOLTMARCH — src/core/workers/spawn.ts
 * ============================================================================
 * THE ONLY FILE IN THIS PROJECT THAT SAYS `new Worker`.
 *
 * It is separate from `TexturePool.ts` for two reasons, and both of them are
 * load-bearing:
 *
 * 1. TESTABILITY. The suite runs `environment: 'node'`, where `Worker` does
 *    not exist. The pool takes its spawn function as an argument, so every
 *    line of pool logic runs in Node against a fake. This file is the thin
 *    platform-specific edge that a Node test legitimately cannot reach, and it
 *    is kept small enough that "cannot reach it" costs nothing.
 *
 * 2. BUNDLING. `new Worker(new URL('./textureWorker.ts', import.meta.url),
 *    { type: 'module' })` is the exact spelling Vite recognises. It emits
 *    `textureWorker.ts` and its import graph as a separate chunk — which is
 *    why that graph must not touch THREE, and why `surfaces.ts` was split out
 *    of `assets.ts`. `vite.config.ts` sets `worker: { format: 'es' }`, so the
 *    chunk is a real ES module and its imports are not inlined.
 *
 * FAILURE IS A RETURN VALUE, NOT AN EXCEPTION. Old browsers reject module
 * workers, a locked-down CSP can refuse the blob, a sandboxed iframe has no
 * worker at all. All of those come back as `null`, the pool disables itself,
 * and the game generates its textures on the main thread exactly as it did
 * before any of this landed.
 * ============================================================================
 */

import type { WorkerLike } from './TexturePool';

/**
 * Start one texture worker, or return null if this platform will not have one.
 *
 * The returned object adapts `Worker`'s event vocabulary onto `WorkerLike`, so
 * `MessageEvent` and `ErrorEvent` stop here and the pool never sees a DOM type.
 */
export function spawnTextureWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;

  let worker: Worker;
  try {
    worker = new Worker(new URL('./textureWorker.ts', import.meta.url), {
      type: 'module',
      name: 'voltmarch:textures',
    });
  } catch (err: unknown) {
    console.warn('[textures] worker unavailable, generating on the main thread', err);
    return null;
  }

  return {
    postMessage(message: unknown, transfer?: ArrayBuffer[]): void {
      if (transfer !== undefined && transfer.length > 0) worker.postMessage(message, transfer);
      else worker.postMessage(message);
    },
    terminate(): void {
      worker.terminate();
    },
    setHandlers(
      onMessage: (data: unknown) => void,
      onError: (reason: string) => void,
    ): void {
      worker.onmessage = (event: MessageEvent): void => { onMessage(event.data); };
      // Fires for a script that failed to load AND for an uncaught throw
      // inside the worker. Either way the worker is not trustworthy.
      worker.onerror = (event: ErrorEvent): void => {
        onError(event.message || 'texture worker failed to start');
      };
      // A reply that would not deserialize. Rare, but silent if unhandled.
      worker.onmessageerror = (): void => {
        onError('texture worker sent a message that could not be deserialized');
      };
    },
  };
}

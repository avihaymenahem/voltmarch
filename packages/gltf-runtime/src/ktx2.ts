import type * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export interface Ktx2LoaderPoolOptions {
  transcoderPath?: string;
  workerLimit: number;
}

export interface Ktx2LoaderPool {
  /** Acquire the one loader configured for this renderer/device lifecycle. */
  acquire(renderer: unknown): KTX2Loader;
  /** Release one acquisition. The final release terminates the worker pool. */
  release(): void;
  /** Force deterministic teardown, primarily for app/HMR disposal. */
  dispose(): void;
}

/**
 * Own one bounded KTX2 transcoder worker pool for one app runtime.
 *
 * Support detection belongs to the first live acquisition. Overlapping world
 * generations may briefly present a replacement renderer before the stale
 * generation releases, so the loader remains shared until the final release.
 * Callers must fully dispose the pool before changing backend/device class.
 */
export function createKtx2LoaderPool(options: Ktx2LoaderPoolOptions): Ktx2LoaderPool {
  if (!Number.isInteger(options.workerLimit) || options.workerLimit < 1) {
    throw new RangeError('KTX2 workerLimit must be a positive integer.');
  }

  let loader: KTX2Loader | null = null;
  let consumers = 0;

  const dispose = (): void => {
    consumers = 0;
    loader?.dispose();
    loader = null;
  };

  return {
    acquire(renderer: unknown): KTX2Loader {
      if (loader !== null) {
        consumers++;
        return loader;
      }

      const candidate = new KTX2Loader().setWorkerLimit(options.workerLimit);
      if (options.transcoderPath !== undefined && options.transcoderPath !== '') {
        candidate.setTranscoderPath(options.transcoderPath);
      }
      try {
        candidate.detectSupport(renderer as THREE.WebGLRenderer);
      } catch (error) {
        candidate.dispose();
        throw error;
      }

      loader = candidate;
      consumers = 1;
      return candidate;
    },

    release(): void {
      if (consumers === 0) return;
      consumers--;
      if (consumers === 0) dispose();
    },

    dispose,
  };
}

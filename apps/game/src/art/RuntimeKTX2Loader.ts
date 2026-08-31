import { createKtx2LoaderPool } from '@voltmarch/gltf-runtime/ktx2';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { beginBootSpan, bootAssetLabel } from '../core/boot-telemetry';

declare const __BASIS_TRANSCODER_PATH__: string;

const pool = createKtx2LoaderPool({
  transcoderPath: __BASIS_TRANSCODER_PATH__,
  workerLimit: 2,
});
let instrumentedLoader: KTX2Loader | null = null;

/** One transcoder worker pool shared by imported buildings and vehicles. */
export function acquireRuntimeKTX2Loader(renderer: unknown): KTX2Loader {
  const loader = pool.acquire(renderer);
  if (instrumentedLoader === loader) return loader;

  const load = loader.load.bind(loader);
  loader.load = (url, onLoad, onProgress, onError) => {
    const finish = beginBootSpan('texture', 'ktx2-ready', { asset: bootAssetLabel(url) });
    try {
      return load(
        url,
        (texture) => {
          finish();
          onLoad?.(texture);
        },
        onProgress,
        (error) => {
          finish('error');
          onError?.(error);
        },
      );
    } catch (err) {
      finish('error');
      throw err;
    }
  };
  instrumentedLoader = loader;
  return loader;
}

export function releaseRuntimeKTX2Loader(): void {
  pool.release();
}

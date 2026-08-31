import type * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { beginBootSpan, bootAssetLabel } from '../core/boot-telemetry';

declare const __BASIS_TRANSCODER_PATH__: string;

let loader: KTX2Loader | null = null;
let consumers = 0;

/** One transcoder worker pool shared by imported buildings and vehicles. */
export function acquireRuntimeKTX2Loader(renderer: unknown): KTX2Loader {
  consumers++;
  if (loader !== null) return loader;

  const candidate = new KTX2Loader().setWorkerLimit(2);
  const load = candidate.load.bind(candidate);
  candidate.load = (url, onLoad, onProgress, onError) => {
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
  if (__BASIS_TRANSCODER_PATH__ !== '') {
    candidate.setTranscoderPath(__BASIS_TRANSCODER_PATH__);
  }
  try {
    candidate.detectSupport(renderer as unknown as THREE.WebGLRenderer);
  } catch (error) {
    candidate.dispose();
    consumers = Math.max(0, consumers - 1);
    throw error;
  }
  loader = candidate;
  return loader;
}

export function releaseRuntimeKTX2Loader(): void {
  consumers = Math.max(0, consumers - 1);
  if (consumers !== 0 || loader === null) return;
  loader.dispose();
  loader = null;
}

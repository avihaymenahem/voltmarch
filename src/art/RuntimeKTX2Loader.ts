import type * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

let loader: KTX2Loader | null = null;
let consumers = 0;

/** One transcoder worker pool shared by imported buildings and vehicles. */
export function acquireRuntimeKTX2Loader(renderer: unknown): KTX2Loader {
  consumers++;
  if (loader !== null) return loader;

  loader = new KTX2Loader().setWorkerLimit(2);
  if (import.meta.env.DEV) {
    loader.setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/');
  }
  loader.detectSupport(renderer as unknown as THREE.WebGLRenderer);
  return loader;
}

export function releaseRuntimeKTX2Loader(): void {
  consumers = Math.max(0, consumers - 1);
  if (consumers !== 0 || loader === null) return;
  loader.dispose();
  loader = null;
}

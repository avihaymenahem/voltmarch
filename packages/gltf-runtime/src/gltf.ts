import type { LoadingManager } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export interface GltfLoaderOptions {
  manager?: LoadingManager;
  ktx2Loader?: KTX2Loader;
}

/**
 * Create a Three GLTF loader with VOLTMARCH's one runtime decode policy.
 *
 * Asset URLs, fallback selection, scene conditioning and telemetry remain
 * caller-owned. Keeping those policies out of this package lets Game and Asset
 * Lab share the exact decoder without sharing mutable loaded scenes.
 */
export function createGltfLoader(options: GltfLoaderOptions = {}): GLTFLoader {
  const loader = new GLTFLoader(options.manager).setMeshoptDecoder(MeshoptDecoder);
  if (options.ktx2Loader !== undefined) loader.setKTX2Loader(options.ktx2Loader);
  return loader;
}

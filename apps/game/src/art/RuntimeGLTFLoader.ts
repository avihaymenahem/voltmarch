import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beginBootSpan, bootAssetLabel } from '../core/boot-telemetry';

/**
 * Runtime GLB loader with the geometry decoder installed before any request.
 *
 * Meshopt's decoder contains a compact WebAssembly kernel and exposes a
 * JavaScript fallback. Keeping the registration in one factory prevents an
 * imported family from working in Asset Lab but failing in the packaged game
 * when EXT_meshopt_compression first reaches that family.
 */
export function createRuntimeGLTFLoader(): GLTFLoader {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const loadAsync = loader.loadAsync.bind(loader);
  loader.loadAsync = async (url, onProgress) => {
    const finish = beginBootSpan('gltf', 'load-parse-decode', { asset: bootAssetLabel(url) });
    try {
      const gltf = await loadAsync(url, onProgress);
      finish();
      return gltf;
    } catch (err) {
      finish('error');
      throw err;
    }
  };
  return loader;
}

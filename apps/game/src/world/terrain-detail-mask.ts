import * as THREE from 'three';
import terrainDetailUrl from '../assets/terrain/universal-terrain-mask-4k.png?url';

/** World-space size of one repeat of the supplied tileable terrain artwork. */
export const TERRAIN_DETAIL_TILE_METRES = 72;

/** Full peak-to-peak luminance modulation. The texture therefore moves albedo by at most +/-22%. */
export const TERRAIN_DETAIL_STRENGTH = 0.44;

/** Small material response so the mask reads as surface structure, not a transparent picture. */
export const TERRAIN_DETAIL_ROUGHNESS = 0.07;

/** Asphalt stays quieter than soil so lane paint remains the road's strongest read. */
export const ROAD_DETAIL_STRENGTH = 0.24;
export const ROAD_DETAIL_ROUGHNESS = 0.42;

/** Pale paving can carry slightly more value variation without swallowing its slab joints. */
export const PAVEMENT_DETAIL_STRENGTH = 0.30;
export const PAVEMENT_DETAIL_ROUGHNESS = 0.30;

let sharedMask: THREE.Texture | null = null;

/**
 * Load the project-owner-supplied terrain detail mask.
 *
 * The real image is browser-only. Shader compilation tests run in plain Node,
 * where a neutral stand-in preserves the sampler shape without needing a DOM.
 */
export function createTerrainDetailMask(): THREE.Texture {
  // Terrain and the road network are separate material families, but this is
  // one authored image and one GPU allocation. It intentionally survives a
  // match teardown so a rematch does not decode and upload 4096² pixels again.
  if (sharedMask !== null) return sharedMask;

  let mask: THREE.Texture;
  if (typeof Image === 'undefined') {
    mask = new THREE.DataTexture(
      new Uint8Array([128, 128, 128, 255]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    mask.needsUpdate = true;
  } else {
    // TextureLoader leaves `texture.image` null until the request completes.
    // WebGPU's texture validation reads `image.complete` while compiling the
    // deferred title world, so that transient null crashes a cold boot before
    // the local image has decoded. Attach the Image synchronously instead;
    // `complete === false` is a valid pending source and the same Texture is
    // uploaded once its pixels arrive.
    const image = new Image();
    image.decoding = 'async';
    mask = new THREE.Texture(image);
    image.addEventListener('load', () => { mask.needsUpdate = true; }, { once: true });
    image.src = terrainDetailUrl;
  }

  mask.name = 'terrain.detail.universal';
  mask.colorSpace = THREE.NoColorSpace;
  mask.wrapS = THREE.RepeatWrapping;
  mask.wrapT = THREE.RepeatWrapping;
  mask.magFilter = THREE.LinearFilter;
  mask.minFilter = THREE.LinearMipmapLinearFilter;
  mask.generateMipmaps = true;
  sharedMask = mask;
  return mask;
}

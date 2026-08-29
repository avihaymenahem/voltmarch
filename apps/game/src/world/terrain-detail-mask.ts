import * as THREE from 'three';
import terrainDetailUrl from '../../../../packages/assets/game/terrain/universal-terrain-mask-4k.png?url';

/** World-space size of one repeat of the supplied tileable terrain artwork. */
export const TERRAIN_DETAIL_TILE_METRES = 72;

/**
 * Full peak-to-peak ground luminance modulation. This is a strength, not an
 * opacity, so the requested 5% reduction is relative: 0.44 * 0.95 = 0.418.
 * Road and pavement passes have independent settings below and are unchanged.
 */
export const TERRAIN_DETAIL_STRENGTH = 0.418;

/** Small material response so the mask reads as surface structure, not a transparent picture. */
export const TERRAIN_DETAIL_ROUGHNESS = 0.07;

/** Asphalt stays quieter than soil so lane paint remains the road's strongest read. */
export const ROAD_DETAIL_STRENGTH = 0.24;
export const ROAD_DETAIL_ROUGHNESS = 0.42;

/** Pale paving can carry slightly more value variation without swallowing its slab joints. */
export const PAVEMENT_DETAIL_STRENGTH = 0.30;
export const PAVEMENT_DETAIL_ROUGHNESS = 0.30;

let sharedMask: THREE.Texture | null = null;
let browserLoad: Promise<THREE.Texture> | null = null;

function configure(mask: THREE.Texture): THREE.Texture {
  mask.name = 'terrain.detail.universal';
  mask.colorSpace = THREE.NoColorSpace;
  mask.wrapS = THREE.RepeatWrapping;
  mask.wrapT = THREE.RepeatWrapping;
  mask.magFilter = THREE.LinearFilter;
  mask.minFilter = THREE.LinearMipmapLinearFilter;
  mask.generateMipmaps = true;
  return mask;
}

/**
 * Resolve only after the real browser image is decoded and attached.
 *
 * WebGPU compiles the sampler against the source that exists when the terrain
 * node graph is built. Replacing the neutral 1x1 source after that point can
 * leave the compiled material sampling the placeholder indefinitely. Terrain
 * init therefore awaits this barrier before it constructs either renderer's
 * material set.
 */
export function preloadTerrainDetailMask(): Promise<THREE.Texture> {
  if (typeof Image === 'undefined') return Promise.resolve(createTerrainDetailMask());
  if (browserLoad !== null) return browserLoad;

  const mask = createTerrainDetailMask();
  browserLoad = new Promise<THREE.Texture>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => {
      mask.image = image;
      mask.needsUpdate = true;
      resolve(mask);
    }, { once: true });
    image.addEventListener('error', () => {
      reject(new Error(`Terrain detail mask failed to load: ${terrainDetailUrl}`));
    }, { once: true });
    image.src = terrainDetailUrl;
  });
  return browserLoad;
}

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
  } else {
    // A pending HTMLImageElement is NOT an uploadable WebGPU texture. If the
    // first terrain pipeline compiles before the 4K PNG finishes decoding,
    // Three creates the sampler binding but no GPUTexture; bind-group creation
    // then dereferences `texture.mipLevelCount` on undefined and aborts the
    // whole match. Seed the same Texture with a real 1x1 canvas, which WebGPU
    // can allocate synchronously, and replace its source after the PNG loads.
    const placeholder = document.createElement('canvas');
    placeholder.width = 1;
    placeholder.height = 1;
    const placeholderContext = placeholder.getContext('2d');
    if (placeholderContext !== null) {
      placeholderContext.fillStyle = 'rgb(128, 128, 128)';
      placeholderContext.fillRect(0, 0, 1, 1);
    }
    mask = new THREE.Texture(placeholder);

  }

  configure(mask);
  // Upload the neutral stand-in immediately. The real browser image bumps the
  // version again from its load handler; Node's DataTexture uses this upload.
  mask.needsUpdate = true;
  sharedMask = mask;
  return mask;
}

/** Runtime loader and conditioning gate for authored environment families. */

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { linearColorTriple } from '../core/assets';
import { beginBootSpan, bootAssetLabel } from '../core/boot-telemetry';
import { createRuntimeGLTFLoader } from '../art/RuntimeGLTFLoader';
import { removeStaleTangentAttribute } from '../art/geometry-attributes';
import {
  acquireRuntimeKTX2Loader, releaseRuntimeKTX2Loader,
} from '../art/RuntimeKTX2Loader';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { applyShroudTint } from '../render/FogOfWar';
import { nodePath } from '../render/gpu-path';
import {
  ENVIRONMENT_ASSET_KEYS, environmentAssetManifest,
} from './EnvironmentAssetCatalog';
import type { EnvironmentGeometryFamily } from './FoliageEngine';
import { propDef, propPalette, type PropDef, type PropGeometry } from './PropLibrary';
import type { BiomeName } from './Biomes';
import { PROP_WIND } from './prop-wind';

const loader = createRuntimeGLTFLoader();
let foliageKtx2Loader: KTX2Loader | null = null;
let foliageKtx2Leases = 0;
const textureLoader = new THREE.TextureLoader();
const loadTextureAsync = textureLoader.loadAsync.bind(textureLoader);
textureLoader.loadAsync = async (url, onProgress) => {
  const finish = beginBootSpan('texture', 'image-source-ready', { asset: bootAssetLabel(url) });
  try {
    const texture = await loadTextureAsync(url, onProgress);
    finish();
    return texture;
  } catch (err) {
    finish('error');
    throw err;
  }
};
export const FOLIAGE_ALPHA_TEST = 0.85;
type EnvironmentMaterial = THREE.Material;

export interface EnvironmentKTX2Lease {
  readonly loader: KTX2Loader;
  release(): void;
}

/**
 * Borrow the process-wide two-worker transcoder pool for one foliage promotion.
 *
 * Every overlapping world generation owns a distinct lease even though all of
 * them share one loader. An old generation can therefore finish and release
 * without clearing the pointer or terminating workers under its replacement.
 */
export function acquireEnvironmentKTX2Loader(renderer: unknown): EnvironmentKTX2Lease {
  const acquired = acquireRuntimeKTX2Loader(renderer);
  if (foliageKtx2Loader !== null && foliageKtx2Loader !== acquired) {
    releaseRuntimeKTX2Loader();
    throw new Error('[foliage] runtime KTX2 loader changed while a lease was active');
  }
  foliageKtx2Loader = acquired;
  foliageKtx2Leases++;
  let active = true;
  return {
    loader: acquired,
    release(): void {
      if (!active) return;
      active = false;
      foliageKtx2Leases = Math.max(0, foliageKtx2Leases - 1);
      releaseRuntimeKTX2Loader();
      if (foliageKtx2Leases === 0) foliageKtx2Loader = null;
    },
  };
}

/**
 * Authored environment surfaces still stand above the depth-tested shroud
 * carpet, exactly like the procedural prop material. Build them through the
 * backend's shroud-aware standard material instead of handing a stock PBR
 * material to Scatter, or imported foliage remains visible in unexplored fog.
 */
export function createEnvironmentMaterial(
  params: THREE.MeshStandardMaterialParameters,
  wind = false,
): EnvironmentMaterial {
  const np = nodePath();
  if (np !== null) {
    if (!wind) return np.createShroudTintedStandard(params);
    const set = np.createEnvironmentPropMaterials(params);
    set.material.userData.vmFoliageSetTime = set.setTime;
    return set.material;
  }

  const material = new THREE.MeshStandardMaterial(params);
  if (!wind) {
    material.onBeforeCompile = (shader) => { applyShroudTint(shader); };
    material.customProgramCacheKey = () => 'vm.environment-pbr.shroud.v1';
    return material;
  }
  const uTime = { value: 0 };
  const uFreq = { value: PROP_WIND.radiansPerSecond };
  const windPars = 'attribute float aSway;\nuniform float uWindTime;\nuniform float uWindFreq;';
  const windBody = /* glsl */`
  {
    #ifdef USE_INSTANCING
      float swayPhase = instanceMatrix[3].x * ${PROP_WIND.phaseX}
        + instanceMatrix[3].z * ${PROP_WIND.phaseZ};
    #else
      float swayPhase = 0.0;
    #endif
    float w = uWindTime * uWindFreq + swayPhase;
    float sx = sin(w) * ${PROP_WIND.harmonicA}
      + sin(w * ${PROP_WIND.xRateB} + swayPhase * ${PROP_WIND.xPhaseB}) * ${PROP_WIND.harmonicB};
    float sz = cos(w * ${PROP_WIND.zRateA} + swayPhase * ${PROP_WIND.zPhaseA}) * ${PROP_WIND.harmonicA}
      + cos(w * ${PROP_WIND.zRateB}) * ${PROP_WIND.harmonicB};
    transformed.x += sx * aSway;
    transformed.z += sz * aSway * ${PROP_WIND.zAmplitude};
  }`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uTime;
    shader.uniforms.uWindFreq = uFreq;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${windPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${windBody}`);
    applyShroudTint(shader);
  };
  material.customProgramCacheKey = () => 'vm.environment-pbr.shroud-wind.v1';
  material.userData.vmFoliageSetTime = (time: number): void => { uTime.value = time; };
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.name = `${material.name}.depth`;
  depthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uTime;
    shader.uniforms.uWindFreq = uFreq;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${windPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${windBody}`);
  };
  depthMaterial.customProgramCacheKey = () => 'vm.environment-pbr.depth-wind.v1';
  material.userData.vmFoliageDepthMaterial = depthMaterial;
  return material;
}
const PROP_SURFACE_DELIVERY_MODULES = import.meta.glob<string>(
  '../../../../packages/assets/game/environment/prop-surface/**/*.glb',
  { eager: true, query: '?url', import: 'default' },
);
const PROP_SURFACE_DELIVERY_URLS = Object.fromEntries(
  Object.entries(PROP_SURFACE_DELIVERY_MODULES).map(([file, url]) => [
    file.split('/prop-surface/')[1], url,
  ]),
);
const DELIVERY_URLS: Readonly<Record<string, string>> = Object.freeze({
  'temperate-broadleaf-v1.glb': new URL(
    '../../../../packages/assets/game/environment/foliage/temperate-broadleaf-v1.glb',
    import.meta.url,
  ).href,
  'derived/temperate-broadleaf-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/foliage/derived/temperate-broadleaf-v1.lod1.glb',
    import.meta.url,
  ).href,
  'derived/temperate-broadleaf-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/foliage/derived/temperate-broadleaf-v1.lod2.glb',
    import.meta.url,
  ).href,
  'derived/temperate-broadleaf-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/foliage/derived/temperate-broadleaf-v1.shadow.glb',
    import.meta.url,
  ).href,
  'bush-v1.glb': new URL(
    '../../../../packages/assets/game/environment/shrub/bush-v1.glb',
    import.meta.url,
  ).href,
  'derived/bush-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/shrub/derived/bush-v1.lod1.glb',
    import.meta.url,
  ).href,
  'derived/bush-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/shrub/derived/bush-v1.lod2.glb',
    import.meta.url,
  ).href,
  'derived/bush-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/shrub/derived/bush-v1.shadow.glb',
    import.meta.url,
  ).href,
  'hedge-v1.glb': new URL(
    '../../../../packages/assets/game/environment/shrub/hedge-v1.glb',
    import.meta.url,
  ).href,
  'derived/hedge-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/shrub/derived/hedge-v1.lod1.glb',
    import.meta.url,
  ).href,
  'derived/hedge-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/shrub/derived/hedge-v1.lod2.glb',
    import.meta.url,
  ).href,
  'derived/hedge-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/shrub/derived/hedge-v1.shadow.glb',
    import.meta.url,
  ).href,
  'boulder-v1.glb': new URL(
    '../../../../packages/assets/game/environment/mineral/boulder-v1.glb',
    import.meta.url,
  ).href,
  'derived/boulder-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/mineral/derived/boulder-v1.lod1.glb',
    import.meta.url,
  ).href,
  'derived/boulder-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/mineral/derived/boulder-v1.lod2.glb',
    import.meta.url,
  ).href,
  'derived/boulder-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/mineral/derived/boulder-v1.shadow.glb',
    import.meta.url,
  ).href,
  'rock-cluster-v1.glb': new URL(
    '../../../../packages/assets/game/environment/mineral/rock-cluster-v1.glb',
    import.meta.url,
  ).href,
  'derived/rock-cluster-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/mineral/derived/rock-cluster-v1.lod1.glb',
    import.meta.url,
  ).href,
  'derived/rock-cluster-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/mineral/derived/rock-cluster-v1.lod2.glb',
    import.meta.url,
  ).href,
  'derived/rock-cluster-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/mineral/derived/rock-cluster-v1.shadow.glb',
    import.meta.url,
  ).href,
  'crate-stack-v1.glb': new URL(
    '../../../../packages/assets/game/environment/box-prop/crate-stack-v1.glb',
    import.meta.url,
  ).href,
  'derived/crate-stack-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/box-prop/derived/crate-stack-v1.lod1.glb',
    import.meta.url,
  ).href,
  'derived/crate-stack-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/box-prop/derived/crate-stack-v1.lod2.glb',
    import.meta.url,
  ).href,
  'derived/crate-stack-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/box-prop/derived/crate-stack-v1.shadow.glb',
    import.meta.url,
  ).href,
  'flower-bed-v1.glb': new URL(
    '../../../../packages/assets/game/environment/box-prop/flower-bed-v1.glb',
    import.meta.url,
  ).href,
  'derived/flower-bed-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/box-prop/derived/flower-bed-v1.lod1.glb',
    import.meta.url,
  ).href,
  'derived/flower-bed-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/box-prop/derived/flower-bed-v1.lod2.glb',
    import.meta.url,
  ).href,
  'derived/flower-bed-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/box-prop/derived/flower-bed-v1.shadow.glb',
    import.meta.url,
  ).href,
  'tree-autumn-v1.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/tree-autumn-v1.glb', import.meta.url,
  ).href,
  'derived/tree-autumn-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/tree-autumn-v1.lod1.glb', import.meta.url,
  ).href,
  'derived/tree-autumn-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/tree-autumn-v1.lod2.glb', import.meta.url,
  ).href,
  'derived/tree-autumn-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/tree-autumn-v1.shadow.glb', import.meta.url,
  ).href,
  'conifer-v1.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/conifer-v1.glb', import.meta.url,
  ).href,
  'derived/conifer-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/conifer-v1.lod1.glb', import.meta.url,
  ).href,
  'derived/conifer-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/conifer-v1.lod2.glb', import.meta.url,
  ).href,
  'derived/conifer-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/conifer-v1.shadow.glb', import.meta.url,
  ).href,
  'palm-v1.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/palm-v1.glb', import.meta.url,
  ).href,
  'derived/palm-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/palm-v1.lod1.glb', import.meta.url,
  ).href,
  'derived/palm-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/palm-v1.lod2.glb', import.meta.url,
  ).href,
  'derived/palm-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/palm-v1.shadow.glb', import.meta.url,
  ).href,
  'grass-tuft-v1.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/grass-tuft-v1.glb', import.meta.url,
  ).href,
  'derived/grass-tuft-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/grass-tuft-v1.lod1.glb', import.meta.url,
  ).href,
  'derived/grass-tuft-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/grass-tuft-v1.lod2.glb', import.meta.url,
  ).href,
  'derived/grass-tuft-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/grass-tuft-v1.shadow.glb', import.meta.url,
  ).href,
  'grass-tuft-green-v1.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/grass-tuft-green-v1.glb', import.meta.url,
  ).href,
  'derived/grass-tuft-green-v1.lod1.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/grass-tuft-green-v1.lod1.glb', import.meta.url,
  ).href,
  'derived/grass-tuft-green-v1.lod2.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/grass-tuft-green-v1.lod2.glb', import.meta.url,
  ).href,
  'derived/grass-tuft-green-v1.shadow.glb': new URL(
    '../../../../packages/assets/game/environment/extended-foliage/derived/grass-tuft-green-v1.shadow.glb', import.meta.url,
  ).href,
  ...PROP_SURFACE_DELIVERY_URLS,
});
const MINERAL_TEXTURE_URLS = Object.freeze({
  base: new URL(
    '../../../../packages/assets/game/environment/mineral/material/mineral-rock-v1.base.jpg',
    import.meta.url,
  ).href,
  normal: new URL(
    '../../../../packages/assets/game/environment/mineral/material/mineral-rock-v1.normal.jpg',
    import.meta.url,
  ).href,
  mr: new URL(
    '../../../../packages/assets/game/environment/mineral/material/mineral-rock-v1.mr.jpg',
    import.meta.url,
  ).href,
});
const SHRUB_TEXTURE_URLS = Object.freeze({
  base: new URL(
    '../../../../packages/assets/game/environment/shrub/material/temperate-shrub-v1.base.webp',
    import.meta.url,
  ).href,
  normal: new URL(
    '../../../../packages/assets/game/environment/shrub/material/temperate-shrub-v1.normal.jpg',
    import.meta.url,
  ).href,
  mr: new URL(
    '../../../../packages/assets/game/environment/shrub/material/temperate-shrub-v1.mr.jpg',
    import.meta.url,
  ).href,
});
const BOX_PROP_TEXTURE_URLS = Object.freeze({
  base: new URL(
    '../../../../packages/assets/game/environment/box-prop/material/box-prop-v1.base.webp',
    import.meta.url,
  ).href,
  normal: new URL(
    '../../../../packages/assets/game/environment/box-prop/material/box-prop-v1.normal.jpg',
    import.meta.url,
  ).href,
  mr: new URL(
    '../../../../packages/assets/game/environment/box-prop/material/box-prop-v1.mr.jpg',
    import.meta.url,
  ).href,
});
const EXTENDED_FOLIAGE_TEXTURE_URLS = Object.freeze({
  base: new URL(
    '../../../../packages/assets/game/environment/extended-foliage/material/extended-foliage-v1.base.ktx2',
    import.meta.url,
  ).href,
  normal: new URL(
    '../../../../packages/assets/game/environment/extended-foliage/material/extended-foliage-v1.normal.ktx2',
    import.meta.url,
  ).href,
  mr: new URL(
    '../../../../packages/assets/game/environment/extended-foliage/material/extended-foliage-v1.mr.ktx2',
    import.meta.url,
  ).href,
});
const PROP_SURFACE_TEXTURE_URLS = Object.freeze({
  base: new URL(
    '../../../../packages/assets/game/environment/prop-surface/material/prop-surface-v1.base.webp',
    import.meta.url,
  ).href,
  normal: new URL(
    '../../../../packages/assets/game/environment/prop-surface/material/prop-surface-v1.normal.jpg',
    import.meta.url,
  ).href,
  mr: new URL(
    '../../../../packages/assets/game/environment/prop-surface/material/prop-surface-v1.mr.jpg',
    import.meta.url,
  ).href,
});

function createMineralMaterial(): Promise<EnvironmentMaterial> {
  return Promise.all([
    textureLoader.loadAsync(MINERAL_TEXTURE_URLS.base),
    textureLoader.loadAsync(MINERAL_TEXTURE_URLS.normal),
    textureLoader.loadAsync(MINERAL_TEXTURE_URLS.mr),
  ]).then(([base, normal, mr]) => {
    base.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    mr.colorSpace = THREE.NoColorSpace;
    for (const texture of [base, normal, mr]) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1.55, 1.35);
      texture.anisotropy = 4;
      texture.needsUpdate = true;
    }
    const material = createEnvironmentMaterial({
      name: 'foliage.mineral-rock-v1.pbr',
      color: 0xffffff,
      map: base,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.68, 0.68),
      roughness: 1,
      roughnessMap: mr,
      metalness: 0,
      metalnessMap: mr,
      vertexColors: true,
      side: THREE.FrontSide,
      dithering: true,
      envMapIntensity: 0.48,
    });
    return material;
  });
}

function createShrubMaterial(): Promise<EnvironmentMaterial> {
  return Promise.all([
    textureLoader.loadAsync(SHRUB_TEXTURE_URLS.base),
    textureLoader.loadAsync(SHRUB_TEXTURE_URLS.normal),
    textureLoader.loadAsync(SHRUB_TEXTURE_URLS.mr),
  ]).then(([base, normal, mr]) => {
    base.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    mr.colorSpace = THREE.NoColorSpace;
    for (const texture of [base, normal, mr]) {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
    }
    return createEnvironmentMaterial({
      name: 'foliage.temperate-shrub-v1.pbr',
      color: 0xffffff,
      map: base,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 1,
      roughnessMap: mr,
      metalness: 0,
      metalnessMap: mr,
      vertexColors: true,
      alphaTest: FOLIAGE_ALPHA_TEST,
      transparent: false,
      alphaToCoverage: false,
      side: THREE.DoubleSide,
      dithering: true,
      envMapIntensity: 0.28,
    }, true);
  });
}

function createBoxPropMaterial(): Promise<EnvironmentMaterial> {
  return Promise.all([
    textureLoader.loadAsync(BOX_PROP_TEXTURE_URLS.base),
    textureLoader.loadAsync(BOX_PROP_TEXTURE_URLS.normal),
    textureLoader.loadAsync(BOX_PROP_TEXTURE_URLS.mr),
  ]).then(([base, normal, mr]) => {
    base.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    mr.colorSpace = THREE.NoColorSpace;
    for (const texture of [base, normal, mr]) {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
    }
    return createEnvironmentMaterial({
      name: 'foliage.box-prop-v1.pbr',
      color: 0xffffff,
      map: base,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.58, 0.58),
      roughness: 1,
      roughnessMap: mr,
      metalness: 0.82,
      metalnessMap: mr,
      vertexColors: true,
      alphaTest: FOLIAGE_ALPHA_TEST,
      transparent: false,
      alphaToCoverage: false,
      side: THREE.FrontSide,
      dithering: true,
      envMapIntensity: 0.34,
    });
  });
}

/** Atomic atlas barrier: either every map is ready or every partial map is retired. */
export async function settleEnvironmentAtlas(
  loads: readonly Promise<THREE.CompressedTexture>[],
): Promise<readonly THREE.CompressedTexture[]> {
  const settled = await Promise.allSettled(loads);
  const failed = settled.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') {
    for (const result of settled) {
      if (result.status === 'fulfilled') result.value.dispose();
    }
    throw failed.reason;
  }
  return settled.map((result) => {
    if (result.status !== 'fulfilled') throw new Error('[foliage] unreachable atlas state');
    return result.value;
  });
}

function createExtendedFoliageMaterial(): Promise<EnvironmentMaterial> {
  if (foliageKtx2Loader === null) {
    return Promise.reject(new Error('[foliage] KTX2 loader was not acquired before family boot'));
  }
  const atlasLoader = foliageKtx2Loader;
  return settleEnvironmentAtlas([
    atlasLoader.loadAsync(EXTENDED_FOLIAGE_TEXTURE_URLS.base),
    atlasLoader.loadAsync(EXTENDED_FOLIAGE_TEXTURE_URLS.normal),
    atlasLoader.loadAsync(EXTENDED_FOLIAGE_TEXTURE_URLS.mr),
  ]).then(([base, normal, mr]) => {
    base.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    mr.colorSpace = THREE.NoColorSpace;
    for (const texture of [base, normal, mr]) {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
    }
    return createEnvironmentMaterial({
      name: 'foliage.extended-foliage-v1.pbr',
      color: 0xffffff,
      map: base,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.58, 0.58),
      roughness: 1,
      roughnessMap: mr,
      metalness: 0,
      metalnessMap: mr,
      vertexColors: true,
      alphaTest: FOLIAGE_ALPHA_TEST,
      transparent: false,
      alphaToCoverage: false,
      side: THREE.DoubleSide,
      dithering: true,
      envMapIntensity: 0.28,
    }, true);
  });
}

function createPropSurfaceMaterial(): Promise<EnvironmentMaterial> {
  return Promise.all([
    textureLoader.loadAsync(PROP_SURFACE_TEXTURE_URLS.base),
    textureLoader.loadAsync(PROP_SURFACE_TEXTURE_URLS.normal),
    textureLoader.loadAsync(PROP_SURFACE_TEXTURE_URLS.mr),
  ]).then(([base, normal, mr]) => {
    base.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    mr.colorSpace = THREE.NoColorSpace;
    for (const texture of [base, normal, mr]) {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
    }
    return createEnvironmentMaterial({
      name: 'foliage.prop-surface-v1.pbr',
      color: 0xffffff,
      map: base,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.44, 0.44),
      roughness: 1,
      roughnessMap: mr,
      metalness: 0.88,
      metalnessMap: mr,
      vertexColors: true,
      side: THREE.FrontSide,
      dithering: true,
      envMapIntensity: 0.38,
    });
  });
}

function deliveryUrl(file: string): string {
  const url = DELIVERY_URLS[file];
  if (url === undefined) throw new Error(`[foliage] no bundled URL for ${file}`);
  return url;
}

function floatAttribute(
  geometry: THREE.BufferGeometry,
  name: string,
  itemSize: number,
): THREE.BufferAttribute | undefined {
  const current = geometry.getAttribute(name);
  if (current === undefined) return undefined;
  if (current instanceof THREE.BufferAttribute
    && current.array instanceof Float32Array
    && current.itemSize === itemSize) return current;
  const values = new Float32Array(current.count * itemSize);
  for (let row = 0; row < current.count; row++) {
    for (let column = 0; column < itemSize; column++) {
      values[row * itemSize + column] = current.getComponent(row, column);
    }
  }
  const result = new THREE.BufferAttribute(values, itemSize);
  geometry.setAttribute(name, result);
  return result;
}

/**
 * Canonicalise an authored environment primitive for WebGPU submission.
 *
 * Instanced props add three runtime vertex buffers (`instanceMatrix`,
 * `instanceColor`, and `aSwayPhase`). Imported textured geometry already owns
 * position, normal, UV, and colour buffers, so keeping `aSway` and `aSurface`
 * separate would require nine buffers and exceed WebGPU's guaranteed limit of
 * eight. They are independent shader attributes but share one interleaved
 * float3 buffer here, preserving their values while spending one slot.
 */
export function addEnvironmentRuntimeAttributes(
  geometry: THREE.BufferGeometry,
  wind: boolean,
): void {
  const position = floatAttribute(geometry, 'position', 3);
  if (position === undefined) throw new Error('[foliage] imported geometry has no positions');
  if (floatAttribute(geometry, 'normal', 3) === undefined) geometry.computeVertexNormals();
  floatAttribute(geometry, 'uv', 2);
  // Three derives the normal-map tangent frame from derivatives when this is
  // absent. The embedded broadleaf tangent is therefore redundant, and after
  // world-space conditioning it is also the one extra vertex buffer that
  // would push that family beyond WebGPU's hardware limit.
  removeStaleTangentAttribute(geometry);

  if (geometry.getAttribute('color') === undefined) {
    const colours = new Float32Array(position.count * 3);
    colours.fill(1);
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  } else {
    floatAttribute(geometry, 'color', 3);
  }

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box === null) throw new Error('[foliage] imported geometry has no bounds');
  const height = Math.max(0.001, box.max.y - box.min.y);
  const runtime = new THREE.InterleavedBuffer(new Float32Array(position.count * 3), 3);
  for (let i = 0; i < position.count; i++) {
    const relativeHeight = (position.getY(i) - box.min.y) / height;
    // Keep the trunk rooted. The authored PBR LOD currently uses an ordinary
    // MeshStandardMaterial, but retaining the attribute makes the family
    // immediately compatible with the shared wind shader derivatives.
    runtime.array[i * 3] = wind ? THREE.MathUtils.smoothstep(relativeHeight, 0.18, 0.72) : 0;
    runtime.array[i * 3 + 2] = 0.9;
  }
  geometry.setAttribute('aSway', new THREE.InterleavedBufferAttribute(runtime, 1, 0));
  geometry.setAttribute('aSurface', new THREE.InterleavedBufferAttribute(runtime, 2, 1));
}

function tintRockGeometry(
  geometry: THREE.BufferGeometry,
  biome: BiomeName,
  relative: boolean,
): void {
  const colour = geometry.getAttribute('color');
  if (colour === undefined) throw new Error('[foliage] mineral delivery has no COLOR_0 scalar');
  let base = linearColorTriple(propPalette(biome).rock);
  if (relative) {
    base = relativeTint(base, 0.92);
  }
  for (let i = 0; i < colour.count; i++) {
    const value = (colour.getX(i) + colour.getY(i) + colour.getZ(i)) / 3;
    colour.setXYZ(i, base[0] * value, base[1] * value, base[2] * value);
  }
  colour.needsUpdate = true;
}

function relativeTint(base: [number, number, number], target: number): [number, number, number] {
  const luminance = base[0] * 0.2126 + base[1] * 0.7152 + base[2] * 0.0722;
  const scale = target / Math.max(luminance, 0.001);
  return base.map((channel) => THREE.MathUtils.clamp(channel * scale, 0.74, 1.08)) as [
    number, number, number,
  ];
}

function tintShrubGeometry(
  geometry: THREE.BufferGeometry,
  def: PropDef,
  biome: BiomeName,
  relative: boolean,
): void {
  const colour = geometry.getAttribute('color');
  if (colour === undefined) throw new Error('[foliage] shrub delivery has no COLOR_0 scalar');
  const palette = propPalette(biome);
  let base = linearColorTriple(def.key === 'hedge' ? palette.hedge : palette.shrub);
  if (relative) base = relativeTint(base, 0.94);
  for (let i = 0; i < colour.count; i++) {
    const value = (colour.getX(i) + colour.getY(i) + colour.getZ(i)) / 3;
    colour.setXYZ(i, base[0] * value, base[1] * value, base[2] * value);
  }
  colour.needsUpdate = true;
}

function pbrMaterial(source: THREE.Material, key: string): EnvironmentMaterial {
  if (!(source instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`[foliage] PBR LOD0 expected MeshStandardMaterial, got ${source.type}`);
  }
  const material = createEnvironmentMaterial({
    name: `foliage.${key}.pbr`,
    color: source.color,
    map: source.map,
    normalMap: source.normalMap,
    normalMapType: source.normalMapType,
    normalScale: new THREE.Vector2(0.82, 0.82),
    roughness: Math.max(0.78, source.roughness),
    roughnessMap: source.roughnessMap,
    metalness: source.metalness,
    metalnessMap: source.metalnessMap,
    aoMap: source.aoMap,
    aoMapIntensity: source.aoMapIntensity,
    emissive: source.emissive,
    emissiveIntensity: source.emissiveIntensity,
    emissiveMap: source.emissiveMap,
    alphaMap: source.alphaMap,
    vertexColors: source.vertexColors,
    transparent: false,
    alphaTest: FOLIAGE_ALPHA_TEST,
    alphaToCoverage: false,
    side: THREE.FrontSide,
    dithering: true,
    envMapIntensity: 0.55,
  }, true);
  for (const texture of [
    source.map, source.normalMap, source.metalnessMap, source.roughnessMap,
  ]) {
    if (texture === null) continue;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
  }
  return material;
}

async function loadDelivery(
  def: PropDef,
  file: string,
  name: string,
  authoredMaterial: 'embedded' | 'mineral' | 'shrub' | 'box-prop' | 'extended-foliage' | 'prop-surface' | undefined,
  biome: BiomeName,
  mineralMaterial: EnvironmentMaterial | undefined,
  shrubMaterial: EnvironmentMaterial | undefined,
  boxPropMaterial: EnvironmentMaterial | undefined,
  extendedFoliageMaterial: EnvironmentMaterial | undefined,
  propSurfaceMaterial: EnvironmentMaterial | undefined,
): Promise<PropGeometry> {
  const gltf = await loader.loadAsync(deliveryUrl(file));
  const finishConditioning = beginBootSpan('conditioning', 'environment-asset', { asset: file });
  let conditioningStatus: 'ok' | 'error' = 'error';
  try {
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
  const mesh = meshes[0];
  if (meshes.length !== 1 || mesh === undefined || Array.isArray(mesh.material)) {
    throw new Error(`[foliage] ${name} expected one mesh/material, got ${meshes.length}`);
  }
  let geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  if (geometry.getIndex() === null) {
    // GLTFLoader preserves quantized/interleaved storage for geometry-only
    // derivatives. BufferGeometryUtils.mergeVertices writes attributes while
    // welding and requires ordinary writable BufferAttributes.
    for (const [attributeName, attribute] of Object.entries(geometry.attributes)) {
      floatAttribute(geometry, attributeName, attribute.itemSize);
    }
    const unindexed = geometry;
    geometry = mergeVertices(unindexed, 1e-5);
    unindexed.dispose();
  }
  geometry.name = `foliage.${def.key}.${name}`;
  addEnvironmentRuntimeAttributes(
    geometry,
    def.family === 'canopy' || def.family === 'shrub' || def.family === 'grass',
  );
  if (def.family === 'rock') tintRockGeometry(geometry, biome, authoredMaterial === 'mineral');
  if (def.family === 'shrub') tintShrubGeometry(
    geometry,
    def,
    biome,
    authoredMaterial === 'shrub',
  );
  if (geometry.getIndex() === null) throw new Error(`[foliage] ${name} could not be indexed`);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const box = geometry.boundingBox!;
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(
    Math.hypot(box.min.x - centre.x, box.min.z - centre.z),
    Math.hypot(box.max.x - centre.x, box.max.z - centre.z),
  );
  const result: PropGeometry = {
    def,
    geometry,
    material: authoredMaterial === 'embedded'
      ? pbrMaterial(mesh.material, def.key)
      : authoredMaterial === 'mineral'
        ? mineralMaterial
        : authoredMaterial === 'shrub'
          ? shrubMaterial
          : authoredMaterial === 'box-prop'
            ? boxPropMaterial
            : authoredMaterial === 'extended-foliage'
              ? extendedFoliageMaterial
              : authoredMaterial === 'prop-surface'
                ? propSurfaceMaterial
          : undefined,
    triangles: geometry.getIndex()!.count / 3,
    boundRadius: radius,
    boundHeight: Math.max(0.5, size.y),
    boundSphereRadius: geometry.boundingSphere?.radius ?? Math.hypot(radius, size.y * 0.5),
  };
  conditioningStatus = 'ok';
  return result;
  } finally {
    finishConditioning(conditioningStatus);
  }
}

function disposeDelivery(
  delivery: PropGeometry,
  preservedMaterial?: THREE.Material,
): void {
  delivery.geometry.dispose();
  const material = delivery.material;
  if (material === undefined || material === preservedMaterial) return;
  disposeMaterial(material);
}

function disposeMaterial(material: THREE.Material): void {
  // Family PBR materials and maps are shared across independent prop keys;
  // the successful FoliageEngine registration owns their final disposal.
  if ('map' in material) {
    const textured = material as EnvironmentMaterial & {
      map?: THREE.Texture | null;
      normalMap?: THREE.Texture | null;
      metalnessMap?: THREE.Texture | null;
      roughnessMap?: THREE.Texture | null;
    };
    const textures = new Set([
      textured.map, textured.normalMap, textured.metalnessMap, textured.roughnessMap,
    ]);
    for (const texture of textures) texture?.dispose();
  }
  material.dispose();
}

async function loadFamily(
  key: string,
  biome: BiomeName,
  mineralMaterial?: EnvironmentMaterial,
  shrubMaterial?: EnvironmentMaterial,
  boxPropMaterial?: EnvironmentMaterial,
  extendedFoliageMaterial?: EnvironmentMaterial,
  propSurfaceMaterial?: EnvironmentMaterial,
): Promise<EnvironmentGeometryFamily | undefined> {
  const manifest = environmentAssetManifest(key);
  const def = propDef(key);
  if (manifest?.deliveries === undefined || def === undefined) return undefined;
  const files = manifest.deliveries;
  const shrubVisibleMaterial: 'shrub' | undefined = def.family === 'shrub' ? 'shrub' : undefined;
  const boxPropVisibleMaterial: 'box-prop' | undefined = manifest.materialFamily === 'box-prop-v1-pbr'
    ? 'box-prop'
    : undefined;
  const extendedFoliageVisibleMaterial: 'extended-foliage' | undefined =
    manifest.materialFamily === 'extended-foliage-v1-pbr' ? 'extended-foliage' : undefined;
  const propSurfaceVisibleMaterial: 'prop-surface' | undefined =
    manifest.materialFamily === 'prop-surface-v1-pbr' ? 'prop-surface' : undefined;
  const visibleMaterial = shrubVisibleMaterial ?? boxPropVisibleMaterial
    ?? extendedFoliageVisibleMaterial ?? propSurfaceVisibleMaterial;
  const mineralVisibleMaterial: 'mineral' | undefined = manifest.materialFamily === 'mineral-rock-v1-pbr'
    ? 'mineral'
    : undefined;
  const lod0Material: 'embedded' | 'mineral' | 'shrub' | 'box-prop' | 'extended-foliage' | 'prop-surface' | undefined = key === 'tree'
    ? 'embedded'
    : mineralVisibleMaterial ?? visibleMaterial;
  const settled = await Promise.allSettled([
    loadDelivery(
      def, files.lod0, 'lod0', lod0Material, biome,
      mineralMaterial, shrubMaterial, boxPropMaterial, extendedFoliageMaterial, propSurfaceMaterial,
    ),
    loadDelivery(
      def, files.lod1, 'lod1', visibleMaterial, biome,
      mineralMaterial, shrubMaterial, boxPropMaterial, extendedFoliageMaterial, propSurfaceMaterial,
    ),
    loadDelivery(
      def, files.lod2, 'lod2', visibleMaterial, biome,
      mineralMaterial, shrubMaterial, boxPropMaterial, extendedFoliageMaterial, propSurfaceMaterial,
    ),
    loadDelivery(
      def, files.shadow, 'shadow', undefined, biome,
      mineralMaterial, shrubMaterial, boxPropMaterial, extendedFoliageMaterial, propSurfaceMaterial,
    ),
  ]);
  const available = settled.map((result) => (
    result.status === 'fulfilled' ? result.value : undefined
  ));
  if (available.slice(0, 3).every((delivery) => delivery === undefined)) {
    const preservedMaterial = mineralMaterial ?? shrubMaterial ?? boxPropMaterial
      ?? extendedFoliageMaterial ?? propSurfaceMaterial;
    for (const delivery of available) {
      if (delivery !== undefined) disposeDelivery(delivery, preservedMaterial);
    }
    const reasons = settled
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => String(result.reason));
    throw new Error(`[foliage] ${key} has no loadable visible delivery: ${reasons.join('; ')}`);
  }

  type VisibleDelivery = 'lod0' | 'lod1' | 'lod2';
  type AnyDelivery = VisibleDelivery | 'shadow';
  const names: readonly AnyDelivery[] = ['lod0', 'lod1', 'lod2', 'shadow'];
  const choose = (preference: readonly number[]): { geometry: PropGeometry; source: AnyDelivery } => {
    for (const index of preference) {
      const geometry = available[index];
      if (geometry !== undefined) return { geometry, source: names[index] };
    }
    throw new Error(`[foliage] ${key} has no usable packaged delivery`);
  };
  // Prefer the requested rung, then a cheaper rung, then the nearest more
  // expensive rung. The shadow proxy similarly falls toward the cheapest
  // visible delivery instead of removing the complete family.
  const lod0 = choose([0, 1, 2]);
  const lod1 = choose([1, 2, 0]);
  const lod2 = choose([2, 1, 0]);
  const shadow = choose([3, 2, 1, 0]);
  const degraded = settled.some((result) => result.status === 'rejected');
  if (degraded) {
    console.warn(
      `[foliage] ${key} degraded packaged family: `
      + `lod0=${lod0.source}, lod1=${lod1.source}, lod2=${lod2.source}, shadow=${shadow.source}`,
    );
  }
  return {
    lod0: lod0.geometry,
    lod1: lod1.geometry,
    lod2: lod2.geometry,
    shadow: shadow.geometry,
    emergency: lod2.geometry,
    deliverySources: degraded ? {
      lod0: lod0.source as VisibleDelivery,
      lod1: lod1.source as VisibleDelivery,
      lod2: lod2.source as VisibleDelivery,
      shadow: shadow.source,
      emergency: lod2.source as VisibleDelivery,
    } : undefined,
  };
}

/** Dispose a load that completed after its owning world was torn down. */
export function disposeImportedFoliage(
  families: ReadonlyMap<string, EnvironmentGeometryFamily>,
): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const family of families.values()) {
    for (const delivery of [
      family.lod0, family.lod1, family.lod2, family.shadow, family.emergency,
    ]) {
      if (!geometries.has(delivery.geometry)) {
        delivery.geometry.dispose();
        geometries.add(delivery.geometry);
      }
      if (delivery.material !== undefined && !materials.has(delivery.material)) {
        disposeMaterial(delivery.material);
        materials.add(delivery.material);
      }
    }
  }
}

async function disposeResolvedMaterial(
  promise: Promise<EnvironmentMaterial> | undefined,
): Promise<void> {
  if (promise === undefined) return;
  try {
    disposeMaterial(await promise);
  } catch {
    // A rejected shared promise owns no material. Its per-family warning is the
    // useful diagnostic; cleanup must not reject and abandon loaded siblings.
  }
}

/** Load each promoted family atomically; one missing prop never removes siblings. */
export async function loadImportedFoliage(
  biome: BiomeName,
): Promise<ReadonlyMap<string, EnvironmentGeometryFamily>> {
  const families = new Map<string, EnvironmentGeometryFamily>();
  let mineralMaterialPromise: Promise<EnvironmentMaterial> | undefined;
  let shrubMaterialPromise: Promise<EnvironmentMaterial> | undefined;
  let boxPropMaterialPromise: Promise<EnvironmentMaterial> | undefined;
  let extendedFoliageMaterialPromise: Promise<EnvironmentMaterial> | undefined;
  let propSurfaceMaterialPromise: Promise<EnvironmentMaterial> | undefined;
  for (const key of ENVIRONMENT_ASSET_KEYS) {
    try {
      const manifest = environmentAssetManifest(key);
      const mineralMaterial = manifest?.materialFamily === 'mineral-rock-v1-pbr'
        ? await (mineralMaterialPromise ??= createMineralMaterial())
        : undefined;
      const shrubMaterial = manifest?.family === 'shrub'
        ? await (shrubMaterialPromise ??= createShrubMaterial())
        : undefined;
      const boxPropMaterial = manifest?.materialFamily === 'box-prop-v1-pbr'
        ? await (boxPropMaterialPromise ??= createBoxPropMaterial())
        : undefined;
      const extendedFoliageMaterial = manifest?.materialFamily === 'extended-foliage-v1-pbr'
        ? await (extendedFoliageMaterialPromise ??= createExtendedFoliageMaterial())
        : undefined;
      const propSurfaceMaterial = manifest?.materialFamily === 'prop-surface-v1-pbr'
        ? await (propSurfaceMaterialPromise ??= createPropSurfaceMaterial())
        : undefined;
      const family = await loadFamily(
        key, biome, mineralMaterial, shrubMaterial, boxPropMaterial, extendedFoliageMaterial,
        propSurfaceMaterial,
      );
      if (family !== undefined) families.set(key, family);
    } catch (error) {
      console.warn(`[foliage] ${key} family unavailable; preserving procedural fallback`, error);
    }
  }
  if (![...families.values()].some((family) => (
    environmentAssetManifest(family.lod0.def.key)?.materialFamily === 'mineral-rock-v1-pbr'
  ))
    && mineralMaterialPromise !== undefined) {
    await disposeResolvedMaterial(mineralMaterialPromise);
  }
  if (![...families.values()].some((family) => family.lod0.def.family === 'shrub')
    && shrubMaterialPromise !== undefined) {
    await disposeResolvedMaterial(shrubMaterialPromise);
  }
  if (![...families.values()].some((family) => (
    environmentAssetManifest(family.lod0.def.key)?.materialFamily === 'box-prop-v1-pbr'
  )) && boxPropMaterialPromise !== undefined) {
    await disposeResolvedMaterial(boxPropMaterialPromise);
  }
  if (![...families.values()].some((family) => (
    environmentAssetManifest(family.lod0.def.key)?.materialFamily === 'extended-foliage-v1-pbr'
  )) && extendedFoliageMaterialPromise !== undefined) {
    await disposeResolvedMaterial(extendedFoliageMaterialPromise);
  }
  if (![...families.values()].some((family) => (
    environmentAssetManifest(family.lod0.def.key)?.materialFamily === 'prop-surface-v1-pbr'
  )) && propSurfaceMaterialPromise !== undefined) {
    await disposeResolvedMaterial(propSurfaceMaterialPromise);
  }
  return families;
}

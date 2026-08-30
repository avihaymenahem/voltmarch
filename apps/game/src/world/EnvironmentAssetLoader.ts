/** Runtime loader and conditioning gate for authored environment families. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { linearColorTriple } from '../core/assets';
import { applyShroudTint } from '../render/FogOfWar';
import { nodePath } from '../render/gpu-path';
import {
  ENVIRONMENT_ASSET_KEYS, environmentAssetManifest,
} from './EnvironmentAssetCatalog';
import type { EnvironmentGeometryFamily } from './FoliageEngine';
import { propDef, propPalette, type PropDef, type PropGeometry } from './PropLibrary';
import type { BiomeName } from './Biomes';

const loader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
export const FOLIAGE_ALPHA_TEST = 0.85;
type EnvironmentMaterial = THREE.Material;

/**
 * Authored environment surfaces still stand above the depth-tested shroud
 * carpet, exactly like the procedural prop material. Build them through the
 * backend's shroud-aware standard material instead of handing a stock PBR
 * material to Scatter, or imported foliage remains visible in unexplored fog.
 */
export function createEnvironmentMaterial(
  params: THREE.MeshStandardMaterialParameters,
): EnvironmentMaterial {
  const np = nodePath();
  if (np !== null) return np.createShroudTintedStandard(params);

  const material = new THREE.MeshStandardMaterial(params);
  material.onBeforeCompile = (shader) => { applyShroudTint(shader); };
  material.customProgramCacheKey = () => 'vm.environment-pbr.shroud.v1';
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
    '../../../../packages/assets/game/environment/extended-foliage/material/extended-foliage-v1.base.webp',
    import.meta.url,
  ).href,
  normal: new URL(
    '../../../../packages/assets/game/environment/extended-foliage/material/extended-foliage-v1.normal.jpg',
    import.meta.url,
  ).href,
  mr: new URL(
    '../../../../packages/assets/game/environment/extended-foliage/material/extended-foliage-v1.mr.jpg',
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
    });
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

function createExtendedFoliageMaterial(): Promise<EnvironmentMaterial> {
  return Promise.all([
    textureLoader.loadAsync(EXTENDED_FOLIAGE_TEXTURE_URLS.base),
    textureLoader.loadAsync(EXTENDED_FOLIAGE_TEXTURE_URLS.normal),
    textureLoader.loadAsync(EXTENDED_FOLIAGE_TEXTURE_URLS.mr),
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
    });
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

function addRuntimeAttributes(geometry: THREE.BufferGeometry): void {
  const position = floatAttribute(geometry, 'position', 3);
  if (position === undefined) throw new Error('[foliage] imported geometry has no positions');
  if (floatAttribute(geometry, 'normal', 3) === undefined) geometry.computeVertexNormals();
  floatAttribute(geometry, 'uv', 2);

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
  const sway = new Float32Array(position.count);
  const surface = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const relativeHeight = (position.getY(i) - box.min.y) / height;
    // Keep the trunk rooted. The authored PBR LOD currently uses an ordinary
    // MeshStandardMaterial, but retaining the attribute makes the family
    // immediately compatible with the shared wind shader derivatives.
    sway[i] = THREE.MathUtils.smoothstep(relativeHeight, 0.18, 0.72);
    surface[i * 2 + 1] = 0.9;
  }
  geometry.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  geometry.setAttribute('aSurface', new THREE.BufferAttribute(surface, 2));
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
  });
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
  addRuntimeAttributes(geometry);
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
  return {
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
  const failed = settled.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') {
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      disposeDelivery(
        result.value,
        mineralMaterial ?? shrubMaterial ?? boxPropMaterial ?? extendedFoliageMaterial
          ?? propSurfaceMaterial,
      );
    }
    throw failed.reason;
  }
  const [lod0, lod1, lod2, shadow] = settled.map((result) => {
    if (result.status !== 'fulfilled') throw new Error('[foliage] unreachable load state');
    return result.value;
  });
  return { lod0, lod1, lod2, shadow, emergency: lod2 };
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
    const unusedMaterial = await mineralMaterialPromise;
    disposeMaterial(unusedMaterial);
  }
  if (![...families.values()].some((family) => family.lod0.def.family === 'shrub')
    && shrubMaterialPromise !== undefined) {
    const unusedMaterial = await shrubMaterialPromise;
    disposeMaterial(unusedMaterial);
  }
  if (![...families.values()].some((family) => (
    environmentAssetManifest(family.lod0.def.key)?.materialFamily === 'box-prop-v1-pbr'
  )) && boxPropMaterialPromise !== undefined) {
    const unusedMaterial = await boxPropMaterialPromise;
    disposeMaterial(unusedMaterial);
  }
  if (![...families.values()].some((family) => (
    environmentAssetManifest(family.lod0.def.key)?.materialFamily === 'extended-foliage-v1-pbr'
  )) && extendedFoliageMaterialPromise !== undefined) {
    const unusedMaterial = await extendedFoliageMaterialPromise;
    disposeMaterial(unusedMaterial);
  }
  if (![...families.values()].some((family) => (
    environmentAssetManifest(family.lod0.def.key)?.materialFamily === 'prop-surface-v1-pbr'
  )) && propSurfaceMaterialPromise !== undefined) {
    const unusedMaterial = await propSurfaceMaterialPromise;
    disposeMaterial(unusedMaterial);
  }
  return families;
}

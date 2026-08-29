/**
 * Runtime conditioning for the approved Meshy vehicle hulk.
 *
 * The authored asset replaces only conventional Allied/Soviet light, medium
 * and heavy tank wrecks. Support hulls, ships, Meridian hovercraft and
 * Reclamation machines retain their class/faction-specific procedural art.
 * The procedural roster is also the load/error fallback for this deferred GLB.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { WRECK_LENGTH, type WreckClass } from '../core/wrecks';
import { applyShroudTint } from '../render/FogOfWar';
import type { KindMesh } from '../render/RenderBridge';
import {
  promoteGeometryAttributeToFloat32,
  removeStaleTangentAttribute,
} from './geometry-attributes';

export type ImportedWreckFaction = 'allies' | 'soviets' | 'neutral';
export const IMPORTED_WRECK_CLASSES = ['light', 'medium', 'heavy'] as const;

const SOURCE_URL = new URL('../../../../packages/assets/game/wrecks/vehicle-wreck.glb', import.meta.url).href;
const BEAM: Readonly<Record<(typeof IMPORTED_WRECK_CLASSES)[number], number>> = {
  light: 0.60,
  medium: 0.56,
  heavy: 0.54,
};

const loader = new GLTFLoader();

export interface ImportedWreckSet {
  hulk(faction: ImportedWreckFaction, cls: (typeof IMPORTED_WRECK_CLASSES)[number]): KindMesh;
  readonly triangles: number;
  dispose(): void;
}

function sourceGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const geometry = mesh.geometry.clone();
  promoteGeometryAttributeToFloat32(geometry, 'position');
  promoteGeometryAttributeToFloat32(geometry, 'normal');
  promoteGeometryAttributeToFloat32(geometry, 'uv');
  removeStaleTangentAttribute(geometry);
  geometry.applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();
  return geometry;
}

function fittedGeometry(
  source: THREE.BufferGeometry,
  cls: (typeof IMPORTED_WRECK_CLASSES)[number],
): THREE.BufferGeometry {
  const geometry = source.clone();
  const box = geometry.boundingBox?.clone();
  if (box === undefined || box === null) throw new Error('Meshy wreck source has no bounds');
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
    throw new Error(`Meshy wreck source has invalid bounds ${size.toArray().join('x')}`);
  }

  const length = WRECK_LENGTH[cls];
  const width = length * BEAM[cls];
  const height = length * (cls === 'heavy' ? 0.24 : 0.22);
  // Meshy authored the vehicle down source -X. Fit that long axis, rebase the
  // cut running gear to y=0, then rotate -X into VOLTMARCH model-forward +Z.
  geometry.translate(-centre.x, -box.min.y, -centre.z);
  geometry.scale(length / size.x, height / size.y, width / size.z);
  geometry.rotateY(Math.PI * 0.5);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = `wreck.imported.${cls}`;
  return geometry;
}

function wreckMaterial(
  source: THREE.Material,
  faction: ImportedWreckFaction,
): THREE.MeshPhysicalMaterial {
  if (!(source instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`Meshy wreck expected MeshStandardMaterial, received ${source.type}`);
  }
  const tint = faction === 'allies'
    ? new THREE.Color(0.86, 0.90, 0.96)
    : faction === 'soviets'
      ? new THREE.Color(0.78, 0.67, 0.58)
      : new THREE.Color(0.78, 0.78, 0.76);
  const material = new THREE.MeshPhysicalMaterial({
    color: source.color.clone().multiply(tint),
    map: source.map,
    metalness: 0.68,
    metalnessMap: source.metalnessMap,
    roughness: 1.18,
    roughnessMap: source.roughnessMap,
    normalMap: source.normalMap,
    normalScale: new THREE.Vector2(1.08, 1.08),
    envMapIntensity: 0.42,
    clearcoat: 0,
    alphaMap: source.alphaMap,
    alphaTest: source.alphaTest,
    opacity: source.opacity,
    transparent: source.transparent,
    vertexColors: source.vertexColors,
    dithering: true,
    side: THREE.DoubleSide,
  });
  material.name = `wreck.imported.${faction}.pbr`;
  for (const texture of [
    material.map, material.normalMap, material.metalnessMap, material.roughnessMap,
  ]) {
    if (texture === null) continue;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }
  material.onBeforeCompile = (shader) => { applyShroudTint(shader); };
  material.customProgramCacheKey = () => 'vm.imported-wreck.shroud.v1';
  return material;
}

/** Load and fit the shared hulk; the caller keeps procedural registrations until this resolves. */
export async function loadImportedWreckSet(): Promise<ImportedWreckSet> {
  const gltf = await loader.loadAsync(SOURCE_URL);
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
  if (meshes.length !== 1 || Array.isArray(meshes[0].material)) {
    throw new Error(`Meshy wreck expected one mesh/material, received ${meshes.length}`);
  }

  const raw = sourceGeometry(meshes[0]);
  const geometries = new Map<(typeof IMPORTED_WRECK_CLASSES)[number], THREE.BufferGeometry>();
  for (const cls of IMPORTED_WRECK_CLASSES) geometries.set(cls, fittedGeometry(raw, cls));
  raw.dispose();

  const materials = new Map<ImportedWreckFaction, THREE.MeshPhysicalMaterial>();
  for (const faction of ['allies', 'soviets', 'neutral'] as const) {
    materials.set(faction, wreckMaterial(meshes[0].material, faction));
  }
  const models = new Map<string, KindMesh>();
  for (const faction of ['allies', 'soviets', 'neutral'] as const) {
    for (const cls of IMPORTED_WRECK_CLASSES) {
      models.set(`${faction}:${cls}`, {
        geometry: geometries.get(cls)!,
        material: materials.get(faction)!,
        castShadow: true,
        receiveShadow: true,
      });
    }
  }
  const position = geometries.get('medium')!.getAttribute('position');
  const index = geometries.get('medium')!.getIndex();
  const triangles = Math.round((index?.count ?? position.count) / 3);

  return {
    triangles,
    hulk(faction, cls) {
      const model = models.get(`${faction}:${cls}`);
      if (model === undefined) throw new Error(`No imported wreck for ${faction}:${cls}`);
      return model;
    },
    dispose() {
      for (const geometry of geometries.values()) geometry.dispose();
      for (const material of materials.values()) material.dispose();
      const textures = new Set<THREE.Texture>();
      for (const material of materials.values()) {
        for (const texture of [
          material.map, material.normalMap, material.metalnessMap, material.roughnessMap,
        ]) if (texture !== null) textures.add(texture);
      }
      for (const texture of textures) texture.dispose();
      geometries.clear();
      materials.clear();
      models.clear();
    },
  };
}

/** Compile-time proof that unsupported classes cannot accidentally use the tank hulk. */
const _wreckClassCoverage: readonly WreckClass[] = IMPORTED_WRECK_CLASSES;
void _wreckClassCoverage;

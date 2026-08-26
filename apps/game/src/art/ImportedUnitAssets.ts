/**
 * Runtime conditioning for approved imported unit assets.
 *
 * Generated source files never enter RenderBridge directly. This module owns
 * their coordinate contract, moving-part split, shared PBR material, KTX2
 * setup, conservative LODs and procedural fallback boundary.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import {
  mergeGeometries, toCreasedNormals,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { ctx } from '../game/context';
import { PartId } from '../core/types';
import { applyShroudTint } from '../render/FogOfWar';
import type { KindMesh, KindMeshPart, SocketSpec } from '../render/RenderBridge';
import type { UnitModel } from './UnitFactory';
import { applyUnitRim } from './unit-rim';
import { acquireRuntimeKTX2Loader, releaseRuntimeKTX2Loader } from './RuntimeKTX2Loader';
import {
  promoteGeometryAttributeToFloat32,
  removeStaleTangentAttribute,
} from './geometry-attributes';

interface ImportedUnitLodSpec {
  url: string;
  minDistance: number;
}

export interface ImportedUnitSpec {
  key: string;
  label: string;
  url: string;
  lods?: readonly ImportedUnitLodSpec[];
  /** Geometry-only proxy used by the shadow pass instead of visible LOD0. */
  shadowUrl?: string;
  hullName: string;
  turretName?: string;
  /** Source-space centre of the authored yaw ring. */
  sourceTurretPivot?: readonly [number, number, number];
  /** Horizontal articulation cut; used to seal the generated open underside. */
  sourceTurretCutY?: number;
  /** Gameplay envelope, excluding the gun overhang. */
  target: readonly [width: number, height: number, hullLength: number];
  yawDeg?: number;
  /** Asset-local exposure compensation for generated base-colour atlases. */
  baseColorGain?: number;
  /** Asset-local response tuning; generated PBR families do not share one bake. */
  roughnessGain?: number;
  normalScale?: number;
  envMapIntensity?: number;
  emissiveIntensity?: number;
}

export const IMPORTED_UNIT_SPECS: readonly ImportedUnitSpec[] = [
  {
    key: 'allied_harvester',
    label: 'Allied Chrono Miner',
    url: new URL('../assets/units/allies/compressed/chrono-miner.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../assets/units/allies/derived/chrono-miner.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../assets/units/allies/derived/chrono-miner.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../assets/units/allies/derived/chrono-miner.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [4.0, 3.3, 8.6],
    yawDeg: 90,
    baseColorGain: 1.06,
    roughnessGain: 1.18,
    normalScale: 1.14,
    envMapIntensity: 0.58,
    emissiveIntensity: 0.008,
  },
  {
    key: 'meridian_collector',
    label: 'Meridian Sun Collector',
    url: new URL('../assets/units/meridian/compressed/sun-collector.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../assets/units/meridian/derived/sun-collector.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../assets/units/meridian/derived/sun-collector.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../assets/units/meridian/derived/sun-collector.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [3.9, 3.25, 8.4],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.20,
    normalScale: 1.16,
    envMapIntensity: 0.56,
    emissiveIntensity: 0.012,
  },
  {
    key: 'reclaim_scrapper',
    label: 'Reclamation Scrapjaw',
    url: new URL('../assets/units/reclamation/compressed/scrapjaw.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../assets/units/reclamation/derived/scrapjaw.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../assets/units/reclamation/derived/scrapjaw.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../assets/units/reclamation/derived/scrapjaw.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [4.0, 3.35, 8.6],
    yawDeg: 90,
    // Keep the graphite chassis readable without bleaching its violet,
    // mismatched-steel and raw-jaw material blocks beneath battlefield light.
    baseColorGain: 1.24,
    roughnessGain: 1.22,
    normalScale: 1.16,
    envMapIntensity: 0.52,
    emissiveIntensity: 0.015,
  },
  {
    key: 'soviet_rhino',
    label: 'Soviet Anvil Heavy Tank',
    url: new URL('../assets/units/soviets/compressed/anvil-heavy-tank.glb', import.meta.url).href,
    hullName: 'Hull',
    turretName: 'Turret',
    // V2 is split and sealed offline. Keep the authored ring centre instead of
    // adding the old runtime cap, which would overlap the new collar.
    sourceTurretPivot: [0.1416566, 0.09, 0.0002384],
    target: [3.4, 2.6, 7.0],
    // Meshy's multi-view reconstruction points its barrel down source -X.
    // +90 maps that to VOLTMARCH's model-forward +Z convention.
    yawDeg: 90,
    baseColorGain: 1,
    roughnessGain: 1.15,
    normalScale: 1.12,
    envMapIntensity: 0.60,
    emissiveIntensity: 0.012,
  },
  {
    key: 'soviet_apocalypse',
    label: 'Soviet Sledge Superheavy Tank',
    url: new URL('../assets/units/soviets/compressed/sledge-tank.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../assets/units/soviets/derived/sledge-tank.lod1.glb', import.meta.url).href,
        minDistance: 52,
      },
    ],
    hullName: 'Hull',
    turretName: 'Turret',
    // V3's single connected reconstruction is split at the measured collar
    // valley. The long source axis is X and the twin guns point toward -X.
    sourceTurretPivot: [0.30, 0.13, 0],
    sourceTurretCutY: 0.13,
    target: [4.1, 3.2, 8.6],
    yawDeg: 90,
    // This atlas is about 11% darker than the approved Anvil family material.
    // Match the faction baseline locally instead of lifting the whole scene.
    baseColorGain: 1.14,
  },
  {
    key: 'soviet_harvester',
    label: 'Soviet Ore Collector',
    url: new URL('../assets/units/soviets/compressed/ore-collector.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../assets/units/soviets/derived/ore-collector.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../assets/units/soviets/derived/ore-collector.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../assets/units/soviets/derived/ore-collector.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [4.0, 3.3, 8.6],
    // The approved collector faces source -X; rotate that intake toward the
    // engine's +Z model-forward convention.
    yawDeg: 90,
    // Preserve its dark Dominion iron while keeping the olive/red material
    // blocks legible beneath the battlefield key light.
    baseColorGain: 1.10,
    roughnessGain: 1.20,
    normalScale: 1.18,
    envMapIntensity: 0.56,
    emissiveIntensity: 0.014,
  },
];

const loader = new GLTFLoader();
let ktx2Loader: KTX2Loader | null = null;
const runtimeMaterials = new Set<THREE.Material>();
const runtimeTextures = new Set<THREE.Texture>();
let importedShadowOnlyMaterial: THREE.MeshBasicMaterial | null = null;

function configureTextureLoader(): void {
  if (ktx2Loader !== null) return;
  const { handle } = ctx();
  const renderer = handle.node ?? handle.webgl;
  if (renderer === null) throw new Error('KTX2 support detection requires an initialized renderer');

  const textureLoader = acquireRuntimeKTX2Loader(renderer);
  loader.setKTX2Loader(textureLoader);
  ktx2Loader = textureLoader;
}

function optimizationEnabled(): boolean {
  if (typeof location === 'undefined') return true;
  return new URLSearchParams(location.search).get('assetopt') !== 'off';
}

function importedUnitMaterial(source: THREE.Material, spec: ImportedUnitSpec): THREE.MeshPhysicalMaterial {
  if (!(source instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`${spec.label}: expected MeshStandardMaterial, received ${source.type}`);
  }

  const textured = source.map !== null;
  const material = new THREE.MeshPhysicalMaterial({
    color: textured ? source.color : new THREE.Color(0x596044),
    map: source.map,
    metalness: textured ? 0.72 : 0.16,
    metalnessMap: source.metalnessMap,
    // Meshy's packed map averages roughly 0.52 roughness. That is a polished
    // showroom coat in our bright battlefield environment, not Soviet armour.
    roughness: textured ? (spec.roughnessGain ?? 1.34) : 0.88,
    roughnessMap: source.roughnessMap,
    normalMap: source.normalMap,
    normalScale: new THREE.Vector2(
      textured ? (spec.normalScale ?? 1.62) : 1,
      textured ? (spec.normalScale ?? 1.62) : 1,
    ),
    emissiveMap: textured ? source.map : null,
    emissive: textured
      ? new THREE.Color().setRGB(0.08, 0.075, 0.05)
      : new THREE.Color(0x000000),
    emissiveIntensity: textured ? (spec.emissiveIntensity ?? 0.035) : 0,
    clearcoat: textured ? 0.035 : 0,
    clearcoatRoughness: 0.82,
    envMapIntensity: textured ? (spec.envMapIntensity ?? 0.72) : 0.55,
    alphaMap: source.alphaMap,
    alphaTest: source.alphaTest,
    opacity: source.opacity,
    transparent: source.transparent,
    vertexColors: source.vertexColors,
    dithering: true,
    side: THREE.FrontSide,
  });
  material.name = `${spec.key}.imported.pbr`;
  // Meshy's studio preview is brighter than the battlefield key. A small
  // family-local radiance lift preserves olive/red separation without moving
  // the global grade or clipping brass hardware.
  if (textured) material.color.multiplyScalar(spec.baseColorGain ?? 1.025);

  for (const texture of [
    material.map, material.normalMap, material.metalnessMap, material.roughnessMap,
  ]) {
    if (texture === null) continue;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    runtimeTextures.add(texture);
  }

  material.onBeforeCompile = (shader) => {
    applyUnitRim(shader);
    applyShroudTint(shader);
  };
  material.customProgramCacheKey = () => 'vm.imported-unit.rim.shroud.v1';
  runtimeMaterials.add(material);
  return material;
}

/** Keep a proxy traversable for shadows while making its colour pass inert. */
function shadowOnlyMaterial(): THREE.MeshBasicMaterial {
  if (importedShadowOnlyMaterial !== null) return importedShadowOnlyMaterial;
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  material.name = 'imported_unit.shadow_only';
  material.colorWrite = false;
  material.depthWrite = false;
  material.depthTest = false;
  material.toneMapped = false;
  material.fog = false;
  importedShadowOnlyMaterial = material;
  runtimeMaterials.add(material);
  return material;
}

function promotePositions(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  if (position instanceof THREE.BufferAttribute && position.array instanceof Float32Array) return;
  const values = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const offset = i * 3;
    values[offset] = position.getX(i);
    values[offset + 1] = position.getY(i);
    values[offset + 2] = position.getZ(i);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(values, 3));
}

function meshesByName(scene: THREE.Object3D, label: string): Map<string, THREE.Mesh> {
  scene.updateMatrixWorld(true);
  const result = new Map<string, THREE.Mesh>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const key = object.name.toLowerCase();
    if (result.has(key)) throw new Error(`${label}: duplicate mesh name ${object.name}`);
    result.set(key, object);
  });
  return result;
}

function sourceGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  let geometry = mesh.geometry.clone();
  promotePositions(geometry);
  geometry.applyMatrix4(mesh.matrixWorld);
  // Generated vertex normals soften armour panels across genuinely hard
  // silhouette breaks. Rebuild only those >30 degree transitions; shallow
  // cast curves remain smooth while glacis, skirt and turret plates read crisp.
  const original = geometry;
  geometry = toCreasedNormals(geometry, THREE.MathUtils.degToRad(30));
  original.dispose();
  // Meshopt/KTX2 GLBs commonly retain normalized integer UVs. Runtime helper
  // geometry uses Float32 UVs, so normalize the authored set before any sealed
  // articulation plates are merged into it.
  promoteGeometryAttributeToFloat32(geometry, 'uv');
  // Creased normals invalidate Meshy's old tangent frame. Three derives a
  // correct tangent basis from derivatives when the attribute is absent.
  removeStaleTangentAttribute(geometry);
  geometry.computeBoundingBox();
  return geometry;
}

interface UnitFit {
  sourcePivot: THREE.Vector3;
  targetPivot: THREE.Vector3;
  scale: THREE.Vector3;
  yaw: number;
}

function fitGeometry(geometry: THREE.BufferGeometry, fit: UnitFit, turret: boolean): THREE.BufferGeometry {
  geometry.translate(-fit.sourcePivot.x, -fit.sourcePivot.y, -fit.sourcePivot.z);
  geometry.scale(fit.scale.x, fit.scale.y, fit.scale.z);
  geometry.rotateY(fit.yaw);
  if (!turret) geometry.translate(fit.targetPivot.x, fit.targetPivot.y, fit.targetPivot.z);
  // A turret stays authored around its ring. RenderBridge adds targetPivot as
  // the part offset, so leaving it at local origin avoids an orbital yaw.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Seal Meshy's open articulation cut with one low faceted armour plate.
 *
 * The cap is merged into the turret primitive, so the fix adds zero draw calls.
 * Its constant UV samples an approved olive armour texel from the shared atlas;
 * the interface is normally hidden by the ring, but can no longer reveal the
 * sky or ground when the upper turret yaws away from its generated rest pose.
 */
function sealTurretInterface(
  geometry: THREE.BufferGeometry,
  spec: ImportedUnitSpec,
  fit: UnitFit,
): THREE.BufferGeometry {
  if (spec.sourceTurretCutY === undefined) return geometry;
  const cutY = (spec.sourceTurretCutY - fit.sourcePivot.y) * fit.scale.y;
  const cap = new THREE.CylinderGeometry(1, 1, 0.065, 16, 1, false);
  cap.scale(spec.target[0] * 0.40, 1, spec.target[2] * 0.265);
  cap.translate(0, cutY - 0.025, 0);
  const uv = cap.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, 0.40234375, 0.95703125);
  }
  uv.needsUpdate = true;
  // toCreasedNormals() deliberately returns a non-indexed shell. Keep the
  // small cap in the same representation or BufferGeometryUtils rejects the
  // merge and the whole imported vehicle falls back to its procedural model.
  const compatibleCap = geometry.index === null && cap.index !== null
    ? cap.toNonIndexed()
    : cap;
  const merged = mergeGeometries([geometry, compatibleCap], false);
  if (compatibleCap !== cap) compatibleCap.dispose();
  cap.dispose();
  if (merged === null) throw new Error(`${spec.label}: failed to seal turret articulation cut`);
  geometry.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Load one approved articulated vehicle; callers retain their procedural mesh on failure. */
export async function loadImportedUnitOverride(
  model: UnitModel,
  spec: ImportedUnitSpec,
): Promise<KindMesh> {
  configureTextureLoader();
  const lodSpecs = optimizationEnabled() ? spec.lods ?? [] : [];
  const shadowUrl = optimizationEnabled() ? spec.shadowUrl : undefined;
  const loaded = await Promise.all([
    loader.loadAsync(spec.url),
    ...lodSpecs.map((lod) => loader.loadAsync(lod.url)),
    ...(shadowUrl === undefined ? [] : [loader.loadAsync(shadowUrl)]),
  ]);

  const primary = meshesByName(loaded[0].scene, spec.label);
  const hullSource = primary.get(spec.hullName.toLowerCase());
  const turretSource = spec.turretName === undefined
    ? undefined
    : primary.get(spec.turretName.toLowerCase());
  if (hullSource === undefined || (spec.turretName !== undefined && turretSource === undefined)) {
    throw new Error(
      `${spec.label}: expected ${spec.hullName}/${spec.turretName ?? 'no turret'}, received `
      + `${[...primary.values()].map((mesh) => mesh.name).join(', ')}`,
    );
  }
  if (Array.isArray(hullSource.material)) {
    throw new Error(`${spec.label}: hull must use one shared material`);
  }

  const rawHull = sourceGeometry(hullSource);
  const rawTurret = turretSource === undefined ? undefined : sourceGeometry(turretSource);
  const hullBounds = rawHull.boundingBox?.clone();
  const fullBounds = hullBounds?.clone();
  if (fullBounds !== undefined && rawTurret?.boundingBox !== undefined && rawTurret.boundingBox !== null) {
    fullBounds.union(rawTurret.boundingBox);
  }
  if (hullBounds === undefined || fullBounds === undefined) {
    throw new Error(`${spec.label}: source has no bounds`);
  }
  const hullSize = hullBounds.getSize(new THREE.Vector3());
  const fullSize = fullBounds.getSize(new THREE.Vector3());
  if (hullSize.x <= 0 || hullSize.z <= 0 || fullSize.y <= 0) {
    throw new Error(`${spec.label}: invalid source bounds`);
  }

  const sourcePivot = new THREE.Vector3(...(spec.sourceTurretPivot ?? [
    hullBounds.getCenter(new THREE.Vector3()).x,
    fullBounds.min.y,
    hullBounds.getCenter(new THREE.Vector3()).z,
  ]));
  const targetPivot = new THREE.Vector3(...model.turretPivot);
  const fit: UnitFit = {
    sourcePivot,
    targetPivot,
    // Source X is the hull's long axis and source Z is its width. The yaw below
    // exchanges them after the exact gameplay dimensions have been applied.
    scale: new THREE.Vector3(
      spec.target[2] / hullSize.x,
      spec.target[1] / fullSize.y,
      spec.target[0] / hullSize.z,
    ),
    yaw: THREE.MathUtils.degToRad(spec.yawDeg ?? 0),
  };

  const geometry = fitGeometry(rawHull, fit, false);
  geometry.name = `${spec.key}.imported.hull`;
  const turretGeometry = rawTurret === undefined
    ? undefined
    : sealTurretInterface(fitGeometry(rawTurret, fit, true), spec, fit);
  if (turretGeometry !== undefined) turretGeometry.name = `${spec.key}.imported.turret`;

  const hullLods: { geometry: THREE.BufferGeometry; minDistance: number }[] = [];
  const turretLods: { geometry: THREE.BufferGeometry; minDistance: number }[] = [];
  lodSpecs.forEach((lod, index) => {
    const sceneMeshes = meshesByName(loaded[index + 1].scene, `${spec.label} LOD${index + 1}`);
    const lodHull = sceneMeshes.get(spec.hullName.toLowerCase());
    const lodTurret = spec.turretName === undefined
      ? undefined
      : sceneMeshes.get(spec.turretName.toLowerCase());
    if (lodHull === undefined || (spec.turretName !== undefined && lodTurret === undefined)) {
      throw new Error(`${spec.label}: LOD${index + 1} lost its articulated mesh names`);
    }
    const hullGeometry = fitGeometry(sourceGeometry(lodHull), fit, false);
    hullGeometry.name = `${spec.key}.imported.hull.lod${index + 1}`;
    hullLods.push({ geometry: hullGeometry, minDistance: lod.minDistance });
    if (lodTurret !== undefined) {
      const partGeometry = sealTurretInterface(
        fitGeometry(sourceGeometry(lodTurret), fit, true), spec, fit,
      );
      partGeometry.name = `${spec.key}.imported.turret.lod${index + 1}`;
      turretLods.push({ geometry: partGeometry, minDistance: lod.minDistance });
    }
  });

  let shadowGeometry: THREE.BufferGeometry | undefined;
  if (shadowUrl !== undefined) {
    const shadowMeshes = meshesByName(
      loaded[1 + lodSpecs.length].scene, `${spec.label} shadow proxy`,
    );
    const shadowSource = [...shadowMeshes.values()][0];
    if (shadowSource === undefined || shadowMeshes.size !== 1) {
      throw new Error(`${spec.label}: shadow proxy must contain exactly one mesh`);
    }
    shadowGeometry = fitGeometry(sourceGeometry(shadowSource), fit, false);
    shadowGeometry.name = `${spec.key}.imported.shadow`;
  }

  const material = importedUnitMaterial(hullSource.material, spec);
  const parts: KindMeshPart[] = [];
  if (turretGeometry !== undefined) {
    parts.push({
      geometry: turretGeometry,
      lods: turretLods,
      material,
      x: targetPivot.x,
      y: targetPivot.y,
      z: targetPivot.z,
      followsTurret: true,
      part: PartId.Turret,
      castShadow: true,
      receiveShadow: true,
    });
  }
  if (shadowGeometry !== undefined) {
    parts.push({
      geometry: shadowGeometry,
      material: shadowOnlyMaterial(),
      castShadow: true,
      receiveShadow: false,
      aoOccluder: false,
    });
  }

  // Sockets stay procedural: the imported shell is fitted to that exact
  // gameplay envelope and therefore inherits proven muzzle/exhaust positions.
  const sockets: SocketSpec[] = model.sockets.map((socket) => ({
    part: socket.part,
    x: socket.x,
    y: socket.y,
    z: socket.z,
    yaw: socket.yaw,
    pitch: socket.pitch,
    followsTurret: false,
  }));
  for (const socket of model.turretSockets) {
    sockets.push({
      part: socket.part,
      x: socket.x + targetPivot.x,
      y: socket.y + targetPivot.y,
      z: socket.z + targetPivot.z,
      yaw: socket.yaw,
      pitch: socket.pitch,
      followsTurret: true,
      pivotY: targetPivot.y,
    });
  }

  return {
    geometry,
    lods: hullLods,
    material,
    parts: parts.length > 0 ? parts : undefined,
    sockets,
    turretPivotY: targetPivot.y,
    castShadow: shadowGeometry === undefined,
    receiveShadow: true,
  };
}

export function disposeImportedUnitAssets(): void {
  for (const material of runtimeMaterials) material.dispose();
  for (const texture of runtimeTextures) texture.dispose();
  runtimeMaterials.clear();
  runtimeTextures.clear();
  if (ktx2Loader !== null) releaseRuntimeKTX2Loader();
  ktx2Loader = null;
  importedShadowOnlyMaterial = null;
}

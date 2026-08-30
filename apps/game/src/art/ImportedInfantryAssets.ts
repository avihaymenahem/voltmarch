/**
 * Twelve authored infantry bodies, twenty gameplay roles, zero live skeletons.
 *
 * Each faction loads its shared line body and unique commander body in an
 * authored gait stance; aquatic troops may add one equipment-heavy body. Each
 * rig is sampled once while the loading curtain is
 * up, then discarded. The
 * resulting ordinary BufferGeometry is shared by that faction's line,
 * specialist and engineer KindMeshes; role identity comes from the <=200-tri
 * code-native parts in @voltmarch/assets. RenderBridge therefore sees and
 * counts the real GLB triangles while InstanceBatcher retains one batch per
 * role and the existing aGait shader remains the only per-frame animation.
 */

import * as THREE from 'three';
import {
  createInfantryPackGeometry,
  createInfantryWeaponGeometry,
} from '@voltmarch/assets/runtime/infantry-attachments.mjs';

import { PartId } from '../core/types';
import { beginBootSpan } from '../core/boot-telemetry';
import type { KindMesh, KindMeshPart, SocketSpec } from '../render/RenderBridge';
import type { UnitModel } from './UnitFactory';
import { importedAnimatedUnitMaterial, type ImportedUnitSpec } from './ImportedUnitAssets';
import { createRuntimeGLTFLoader } from './RuntimeGLTFLoader';
import {
  promoteGeometryAttributeToFloat32,
  removeStaleTangentAttribute,
} from './geometry-attributes';

export interface ImportedInfantryRole {
  modelKey: string;
  weapon: string;
  pack?: string;
}

export interface ImportedInfantryFamily {
  key: string;
  label: string;
  url: string;
  clipUrl: string;
  roles: readonly ImportedInfantryRole[];
  poseTime: number;
  /** Derive the cheap gait mask from the authored skin, keeping capes rigid. */
  skinGait?: boolean;
  baseColorGain?: number;
  roughnessGain?: number;
  normalScale?: number;
  envMapIntensity?: number;
}

export const IMPORTED_INFANTRY_FAMILIES: readonly ImportedInfantryFamily[] = [
  {
    key: 'allied_peacekeeper', label: 'Allied Peacekeeper', poseTime: 0.12,
    url: new URL('../../../../packages/assets/game/units/allies/infantry-poc/peacekeeper-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/allies/infantry-poc/peacekeeper-run-shoot.glb', import.meta.url).href,
    roles: [
      { modelKey: 'allied_rifle', weapon: 'bullpup' },
      { modelKey: 'allied_javelin', weapon: 'launcher', pack: 'missile-pack' },
      { modelKey: 'allied_engineer', weapon: 'wrench', pack: 'toolcase' },
    ],
    baseColorGain: 1.08, roughnessGain: 1.10, normalScale: 1.08, envMapIntensity: 0.56,
  },
  {
    key: 'soviet_conscript', label: 'Soviet Conscript', poseTime: 0.12,
    url: new URL('../../../../packages/assets/game/units/soviets/infantry-poc/conscript-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/soviets/infantry-poc/conscript-run-shoot.glb', import.meta.url).href,
    roles: [
      { modelKey: 'soviet_conscript', weapon: 'rifle' },
      { modelKey: 'soviet_flak', weapon: 'flak', pack: 'drum' },
      { modelKey: 'soviet_engineer', weapon: 'cutter', pack: 'gas-bottle' },
    ],
    baseColorGain: 1.10, roughnessGain: 1.16, normalScale: 1.10, envMapIntensity: 0.52,
  },
  {
    key: 'soviet_naval_infantry', label: 'Soviet Naval Infantry', poseTime: 0.12,
    skinGait: true,
    url: new URL('../../../../packages/assets/game/units/soviets/naval-infantry/naval-infantry-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/soviets/naval-infantry/naval-infantry-walk.glb', import.meta.url).href,
    roles: [{ modelKey: 'soviet_diver', weapon: 'rifle' }],
    baseColorGain: 1.08, roughnessGain: 1.18, normalScale: 1.10, envMapIntensity: 0.50,
  },
  {
    key: 'allied_frogman', label: 'Allied Frogman', poseTime: 0.12,
    skinGait: true,
    url: new URL('../../../../packages/assets/game/units/allies/frogman/frogman-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/allies/frogman/frogman-walk.glb', import.meta.url).href,
    roles: [{ modelKey: 'allied_frogman', weapon: 'bullpup' }],
    baseColorGain: 1.06, roughnessGain: 1.14, normalScale: 1.10, envMapIntensity: 0.54,
  },
  {
    key: 'meridian_wayfarer', label: 'Meridian Wayfarer', poseTime: 0.12,
    url: new URL('../../../../packages/assets/game/units/meridian/infantry-poc/wayfarer-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/meridian/infantry-poc/wayfarer-run-shoot.glb', import.meta.url).href,
    roles: [
      { modelKey: 'meridian_wayfarer', weapon: 'carbine' },
      { modelKey: 'meridian_lancer', weapon: 'lance', pack: 'cells' },
      { modelKey: 'meridian_artificer', weapon: 'calibrator', pack: 'instrument-case' },
    ],
    baseColorGain: 1.10, roughnessGain: 1.08, normalScale: 1.08, envMapIntensity: 0.58,
  },
  {
    key: 'meridian_tidewalker', label: 'Meridian Tidewalker', poseTime: 0.12,
    skinGait: true,
    url: new URL('../../../../packages/assets/game/units/meridian/tidewalker/tidewalker-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/meridian/tidewalker/tidewalker-walk.glb', import.meta.url).href,
    roles: [{ modelKey: 'meridian_tidewalker', weapon: 'carbine' }],
    baseColorGain: 1.06, roughnessGain: 1.12, normalScale: 1.10, envMapIntensity: 0.56,
  },
  {
    key: 'reclaim_picker', label: 'Reclamation Scrap Picker', poseTime: 0.12,
    url: new URL('../../../../packages/assets/game/units/reclamation/infantry-poc/scrap-picker-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/reclamation/infantry-poc/scrap-picker-run-shoot.glb', import.meta.url).href,
    roles: [
      { modelKey: 'reclaim_picker', weapon: 'prod' },
      { modelKey: 'reclaim_slagger', weapon: 'satchel', pack: 'hopper' },
      { modelKey: 'reclaim_tinker', weapon: 'salvage-tool', pack: 'tool-roll' },
    ],
    baseColorGain: 1.12, roughnessGain: 1.18, normalScale: 1.10, envMapIntensity: 0.50,
  },
  {
    key: 'reclaim_dredger', label: 'Reclamation Dredger', poseTime: 0.12,
    skinGait: true,
    url: new URL('../../../../packages/assets/game/units/reclamation/dredger/dredger-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/reclamation/dredger/dredger-walk.glb', import.meta.url).href,
    roles: [{ modelKey: 'reclaim_dredger', weapon: 'prod' }],
    baseColorGain: 1.12, roughnessGain: 1.18, normalScale: 1.10, envMapIntensity: 0.48,
  },
  {
    key: 'allied_marshal', label: 'Allied Field Marshal', poseTime: 0.12, skinGait: true,
    url: new URL('../../../../packages/assets/game/units/allies/commanders/field-marshal-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/allies/commanders/field-marshal-walk.glb', import.meta.url).href,
    roles: [{ modelKey: 'allied_marshal', weapon: 'bullpup' }],
    baseColorGain: 1.04, roughnessGain: 1.08, normalScale: 1.08, envMapIntensity: 0.56,
  },
  {
    key: 'soviet_commissar', label: 'Soviet War Commissar', poseTime: 0.12, skinGait: true,
    url: new URL('../../../../packages/assets/game/units/soviets/commanders/war-commissar-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/soviets/commanders/war-commissar-walk.glb', import.meta.url).href,
    roles: [{ modelKey: 'soviet_commissar', weapon: 'rifle' }],
    baseColorGain: 1.06, roughnessGain: 1.18, normalScale: 1.10, envMapIntensity: 0.48,
  },
  {
    key: 'meridian_hierarch', label: 'Meridian Hierarch', poseTime: 0.12, skinGait: true,
    url: new URL('../../../../packages/assets/game/units/meridian/commanders/hierarch-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/meridian/commanders/hierarch-walk.glb', import.meta.url).href,
    roles: [{ modelKey: 'meridian_hierarch', weapon: 'lance' }],
    baseColorGain: 1.05, roughnessGain: 1.08, normalScale: 1.08, envMapIntensity: 0.56,
  },
  {
    key: 'reclaim_baron', label: 'Reclamation Scrap Baron', poseTime: 0.12, skinGait: true,
    url: new URL('../../../../packages/assets/game/units/reclamation/commanders/scrap-baron-lod0.glb', import.meta.url).href,
    clipUrl: new URL('../../../../packages/assets/game/units/reclamation/commanders/scrap-baron-walk.glb', import.meta.url).href,
    roles: [{ modelKey: 'reclaim_baron', weapon: 'prod' }],
    baseColorGain: 1.08, roughnessGain: 1.18, normalScale: 1.12, envMapIntensity: 0.46,
  },
] as const;

const loader = createRuntimeGLTFLoader();
const runtimeGeometries = new Set<THREE.BufferGeometry>();

function oneSkinnedMesh(root: THREE.Object3D, label: string): THREE.SkinnedMesh {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((object) => { if (object instanceof THREE.SkinnedMesh) meshes.push(object); });
  if (meshes.length !== 1) throw new Error(`${label}: expected one SkinnedMesh, received ${meshes.length}`);
  return meshes[0];
}

function bakePose(
  root: THREE.Object3D,
  mesh: THREE.SkinnedMesh,
  animations: readonly THREE.AnimationClip[],
  time: number,
  preserveSkin: boolean,
): THREE.BufferGeometry {
  const clip = animations[0];
  if (clip === undefined) throw new Error('authored infantry pose has no animation clip');
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip).reset().play();
  action.setLoop(THREE.LoopOnce, 1);
  mixer.setTime(Math.min(Math.max(time, 0), Math.max(clip.duration - 1e-4, 0)));
  root.updateMatrixWorld(true);
  mesh.skeleton.update();

  let geometry = mesh.geometry.clone();
  const source = mesh.geometry.getAttribute('position');
  const baked = new Float32Array(source.count * 3);
  const vertex = new THREE.Vector3();
  for (let i = 0; i < source.count; i++) {
    vertex.fromBufferAttribute(source, i);
    mesh.applyBoneTransform(i, vertex).applyMatrix4(mesh.matrixWorld);
    baked[i * 3] = vertex.x;
    baked[i * 3 + 1] = vertex.y;
    baked[i * 3 + 2] = vertex.z;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(baked, 3));
  if (!preserveSkin) {
    geometry.deleteAttribute('skinIndex');
    geometry.deleteAttribute('skinWeight');
  }
  geometry.deleteAttribute('tangent');
  // UV seams and authored hard edges already split the indexed vertices. A
  // normal rebuild on that topology follows the baked stance without the
  // 2-3x vertex explosion that converting the whole soldier to a non-indexed
  // creased shell would cause.
  geometry.computeVertexNormals();
  promoteGeometryAttributeToFloat32(geometry, 'uv');
  removeStaleTangentAttribute(geometry);
  action.stop();
  mixer.uncacheRoot(root);
  return geometry;
}

function fitAndTagHumanoid(
  geometry: THREE.BufferGeometry,
  height: number,
  boneNames?: readonly string[],
): void {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (bounds === null) throw new Error('authored infantry pose has no bounds');
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = height / Math.max(size.y, 1e-6);
  geometry.translate(-center.x, -bounds.min.y, -center.z);
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();

  const position = geometry.getAttribute('position');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const gait = new Float32Array(position.count * 2);
  const hipY = height * 0.415;
  const shoulderY = height * 0.77;
  const legSide = height * 0.030;
  const armSide = height * 0.145;
  let positive = 0;
  let negative = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    let sign = 0;
    let pivot = 0;
    if (boneNames !== undefined && skinIndex !== undefined && skinWeight !== undefined) {
      let legWeight = 0;
      let armWeight = 0;
      const indices = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
      const weights = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
      for (let component = 0; component < 4; component++) {
        const name = (boneNames[indices[component]] ?? '').toLowerCase();
        const weight = weights[component];
        if (/left(?:toe|foot|leg|upleg)/.test(name)) legWeight += weight;
        else if (/right(?:toe|foot|leg|upleg)/.test(name)) legWeight -= weight;
        else if (/left(?:hand|forearm|arm|shoulder)/.test(name)) armWeight -= weight;
        else if (/right(?:hand|forearm|arm|shoulder)/.test(name)) armWeight += weight;
      }
      if (Math.abs(legWeight) >= 0.35) {
        sign = Math.sign(legWeight);
        pivot = hipY;
      } else if (Math.abs(armWeight) >= 0.35) {
        sign = Math.sign(armWeight);
        pivot = shoulderY;
      }
    } else if (y <= height * 0.46 && Math.abs(x) >= legSide) {
      sign = x >= 0 ? 1 : -1;
      pivot = hipY;
    } else if (y >= height * 0.43 && y <= height * 0.88 && Math.abs(x) >= armSide) {
      sign = x >= 0 ? -1 : 1;
      pivot = shoulderY;
    }
    gait[i * 2] = sign;
    gait[i * 2 + 1] = pivot;
    if (sign > 0) positive++; else if (sign < 0) negative++;
  }
  if (positive === 0 || negative === 0) throw new Error('authored infantry gait did not resolve both sides');
  geometry.setAttribute('aGait', new THREE.BufferAttribute(gait, 2));
  geometry.deleteAttribute('skinIndex');
  geometry.deleteAttribute('skinWeight');
  geometry.computeBoundingSphere();
}

function tagRigidGait(geometry: THREE.BufferGeometry, sign: number, pivotY: number): void {
  const position = geometry.getAttribute('position');
  const gait = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    gait[i * 2] = sign;
    gait[i * 2 + 1] = pivotY;
  }
  geometry.setAttribute('aGait', new THREE.BufferAttribute(gait, 2));
}

function socketsOf(model: UnitModel): SocketSpec[] {
  return model.sockets.map((socket) => ({
    part: socket.part, x: socket.x, y: socket.y, z: socket.z,
    yaw: socket.yaw, pitch: socket.pitch, followsTurret: false,
  }));
}

function roleParts(role: ImportedInfantryRole, material: THREE.Material, height: number): KindMeshPart[] {
  const parts: KindMeshPart[] = [];
  const weapon = createInfantryWeaponGeometry(role.weapon);
  weapon.rotateY(Math.PI);
  weapon.translate(0.31, height * 0.57, 0.26);
  tagRigidGait(weapon, -1, height * 0.77);
  weapon.name = `${role.modelKey}.weapon.${role.weapon}`;
  runtimeGeometries.add(weapon);
  parts.push({ geometry: weapon, material, castShadow: true, receiveShadow: true, part: PartId.Root });
  if (role.pack !== undefined) {
    const pack = createInfantryPackGeometry(role.pack);
    // Shared lab packs are authored around +0.3 Z; battlefield forward is +Z,
    // so shift that absolute authoring frame onto the upper back at -0.3 Z.
    pack.translate(0, 0, -0.60);
    tagRigidGait(pack, 0, 0);
    pack.name = `${role.modelKey}.pack.${role.pack}`;
    runtimeGeometries.add(pack);
    parts.push({ geometry: pack, material, castShadow: true, receiveShadow: true, part: PartId.Root });
  }
  return parts;
}

export async function loadImportedInfantryFamily(
  family: ImportedInfantryFamily,
  modelFor: (key: string) => UnitModel | undefined,
): Promise<ReadonlyMap<string, KindMesh>> {
  const fallback = modelFor(family.roles[0].modelKey);
  if (fallback === undefined) throw new Error(`${family.label}: missing procedural fallback`);
  const [gltf, clipGltf] = await Promise.all([
    loader.loadAsync(family.url),
    loader.loadAsync(family.clipUrl),
  ]);
  const finishConditioning = beginBootSpan('conditioning', 'infantry-family', { asset: family.key });
  let conditioningStatus: 'ok' | 'error' = 'error';
  try {
  const source = oneSkinnedMesh(gltf.scene, family.label);
  if (Array.isArray(source.material) || !(source.material instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`${family.label}: body must use one MeshStandardMaterial`);
  }
  const body = bakePose(gltf.scene, source, clipGltf.animations, family.poseTime, family.skinGait === true);
  fitAndTagHumanoid(
    body,
    fallback.bounds[1],
    family.skinGait === true ? source.skeleton.bones.map((bone) => bone.name) : undefined,
  );
  body.name = `${family.key}.imported.body`;
  runtimeGeometries.add(body);

  const materialSpec: ImportedUnitSpec = {
    key: family.key,
    label: family.label,
    url: family.url,
    hullName: source.name,
    target: fallback.bounds,
    gait: 'humanoid',
    baseColorGain: family.baseColorGain,
    roughnessGain: family.roughnessGain,
    normalScale: family.normalScale,
    envMapIntensity: family.envMapIntensity,
  };
  const material = importedAnimatedUnitMaterial(source.material, materialSpec);
  const result = new Map<string, KindMesh>();
  for (const role of family.roles) {
    const model = modelFor(role.modelKey);
    if (model === undefined) throw new Error(`${family.label}: missing ${role.modelKey} fallback`);
    result.set(role.modelKey, {
      geometry: body,
      material,
      parts: roleParts(role, material, model.bounds[1]),
      sockets: socketsOf(model),
      castShadow: true,
      receiveShadow: true,
    });
  }
  conditioningStatus = 'ok';
  return result;
  } finally {
    finishConditioning(conditioningStatus);
  }
}

export function disposeImportedInfantryAssets(): void {
  for (const geometry of runtimeGeometries) geometry.dispose();
  runtimeGeometries.clear();
}

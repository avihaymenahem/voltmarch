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
import { unitMaterialFor, type UnitModel } from './UnitFactory';
import type { UnitMaterialTextures } from '../render/gpu-path';
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
  /** Generated vehicles use X; upright character sources conventionally use Z. */
  sourceLongAxis?: 'x' | 'z';
  /** Cheap per-vertex animation path; never allocates a skeleton or mixer. */
  gait?: 'quadruped' | 'humanoid';
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
    url: new URL('../../../../packages/assets/game/units/allies/compressed/chrono-miner.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/allies/derived/chrono-miner.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../../../../packages/assets/game/units/allies/derived/chrono-miner.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/allies/derived/chrono-miner.shadow.glb', import.meta.url,
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
    url: new URL('../../../../packages/assets/game/units/meridian/compressed/sun-collector.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/meridian/derived/sun-collector.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../../../../packages/assets/game/units/meridian/derived/sun-collector.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/meridian/derived/sun-collector.shadow.glb', import.meta.url,
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
    url: new URL('../../../../packages/assets/game/units/reclamation/compressed/scrapjaw.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/reclamation/derived/scrapjaw.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../../../../packages/assets/game/units/reclamation/derived/scrapjaw.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/reclamation/derived/scrapjaw.shadow.glb', import.meta.url,
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
    url: new URL('../../../../packages/assets/game/units/soviets/compressed/anvil-heavy-tank.glb', import.meta.url).href,
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
    url: new URL('../../../../packages/assets/game/units/soviets/compressed/sledge-tank.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/soviets/derived/sledge-tank.lod1.glb', import.meta.url).href,
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
    key: 'soviet_sickle',
    label: 'Soviet Sickle',
    url: new URL('../../../../packages/assets/game/units/soviets/compressed/sickle.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/soviets/derived/sickle.lod1.glb', import.meta.url).href,
        minDistance: 42,
      },
      {
        url: new URL('../../../../packages/assets/game/units/soviets/derived/sickle.lod2.glb', import.meta.url).href,
        minDistance: 70,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/soviets/derived/sickle.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [3.6, 4.4, 3.6],
    yawDeg: 90,
    baseColorGain: 1.08,
    roughnessGain: 1.18,
    normalScale: 1.12,
    envMapIntensity: 0.54,
    emissiveIntensity: 0.010,
  },
  {
    key: 'soviet_v4',
    label: 'Soviet V4 Rocket Launcher',
    url: new URL('../../../../packages/assets/game/units/soviets/compressed/v4-rocket-launcher.glb', import.meta.url).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/soviets/derived/v4-rocket-launcher.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    turretName: 'Launcher',
    sourceTurretPivot: [0.595115, -0.05, 0.000434],
    target: [3.3, 2.9, 7.4],
    yawDeg: 90,
    baseColorGain: 1.08,
    roughnessGain: 1.18,
    normalScale: 1.12,
    envMapIntensity: 0.54,
    emissiveIntensity: 0.010,
  },
  {
    key: 'soviet_harvester',
    label: 'Soviet Ore Collector',
    url: new URL('../../../../packages/assets/game/units/soviets/compressed/ore-collector.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/soviets/derived/ore-collector.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../../../../packages/assets/game/units/soviets/derived/ore-collector.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/soviets/derived/ore-collector.shadow.glb', import.meta.url,
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
  {
    key: 'allied_dozer',
    label: 'Allied Construction Dozer',
    url: new URL('../../../../packages/assets/game/units/allies/compressed/construction-dozer.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/allies/derived/construction-dozer.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../../../../packages/assets/game/units/allies/derived/construction-dozer.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/allies/derived/construction-dozer.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [4.4, 3.8, 9.0],
    yawDeg: 90,
    baseColorGain: 1.06,
    roughnessGain: 1.20,
    normalScale: 1.14,
    envMapIntensity: 0.56,
    emissiveIntensity: 0.010,
  },
  {
    key: 'allied_vindicator',
    label: 'Allied Petrel Bomber',
    url: new URL('../../../../packages/assets/game/units/allies/compressed/petrel-bomber.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/allies/derived/petrel-bomber.lod1.glb', import.meta.url).href,
        minDistance: 52,
      },
      {
        url: new URL('../../../../packages/assets/game/units/allies/derived/petrel-bomber.lod2.glb', import.meta.url).href,
        minDistance: 84,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/allies/derived/petrel-bomber.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [12.0, 3.0, 11.0],
    yawDeg: 90,
    baseColorGain: 1.06,
    roughnessGain: 1.16,
    normalScale: 1.12,
    envMapIntensity: 0.60,
    emissiveIntensity: 0.010,
  },
  {
    key: 'soviet_dozer',
    label: 'Soviet Sputnik Dozer',
    url: new URL('../../../../packages/assets/game/units/soviets/compressed/sputnik-dozer.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/soviets/derived/sputnik-dozer.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../../../../packages/assets/game/units/soviets/derived/sputnik-dozer.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/soviets/derived/sputnik-dozer.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [4.4, 3.8, 9.0],
    // The claw keeps its corrected source-local orientation and connected
    // mount. Rotate the complete vehicle together onto its gameplay forward.
    yawDeg: -90,
    baseColorGain: 1.10,
    roughnessGain: 1.22,
    normalScale: 1.16,
    envMapIntensity: 0.54,
    emissiveIntensity: 0.010,
  },
  {
    key: 'soviet_mig',
    label: 'Soviet Interceptor',
    url: new URL('../../../../packages/assets/game/units/soviets/compressed/interceptor.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/soviets/derived/interceptor.lod1.glb', import.meta.url).href,
        minDistance: 52,
      },
      {
        url: new URL('../../../../packages/assets/game/units/soviets/derived/interceptor.lod2.glb', import.meta.url).href,
        minDistance: 84,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/soviets/derived/interceptor.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [10.5, 2.9, 10.0],
    yawDeg: 90,
    baseColorGain: 1.08,
    roughnessGain: 1.18,
    normalScale: 1.14,
    envMapIntensity: 0.58,
    emissiveIntensity: 0.010,
  },
  {
    key: 'soviet_dog',
    label: 'Soviet Attack Dog',
    url: new URL('../../../../packages/assets/game/units/soviets/compressed/attack-dog.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/soviets/derived/attack-dog.lod1.glb', import.meta.url).href,
        minDistance: 38,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/soviets/derived/attack-dog.shadow.glb', import.meta.url,
    ).href,
    hullName: 'mesh_node',
    target: [0.72, 1.36, 1.70],
    sourceLongAxis: 'z',
    gait: 'quadruped',
    baseColorGain: 1.08,
    roughnessGain: 1.18,
    normalScale: 1.08,
    envMapIntensity: 0.48,
    emissiveIntensity: 0,
  },
  {
    key: 'meridian_carryall',
    label: 'Meridian Pactworks Carryall',
    url: new URL('../../../../packages/assets/game/units/meridian/compressed/pactworks-carryall.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/meridian/derived/pactworks-carryall.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../../../../packages/assets/game/units/meridian/derived/pactworks-carryall.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/meridian/derived/pactworks-carryall.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [4.4, 3.8, 9.0],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.20,
    normalScale: 1.16,
    envMapIntensity: 0.56,
    emissiveIntensity: 0.012,
  },
  {
    key: 'meridian_kestrel',
    label: 'Meridian Kestrel Gunship',
    url: new URL('../../../../packages/assets/game/units/meridian/compressed/kestrel-gunship.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/meridian/derived/kestrel-gunship.lod1.glb', import.meta.url).href,
        minDistance: 52,
      },
      {
        url: new URL('../../../../packages/assets/game/units/meridian/derived/kestrel-gunship.lod2.glb', import.meta.url).href,
        minDistance: 84,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/meridian/derived/kestrel-gunship.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [11.0, 2.9, 10.5],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.16,
    normalScale: 1.14,
    envMapIntensity: 0.60,
    emissiveIntensity: 0.012,
  },
  {
    key: 'reclaim_crawler',
    label: 'Reclamation Yardcrawler',
    url: new URL('../../../../packages/assets/game/units/reclamation/compressed/yardcrawler.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/reclamation/derived/yardcrawler.lod1.glb', import.meta.url).href,
        minDistance: 46,
      },
      {
        url: new URL('../../../../packages/assets/game/units/reclamation/derived/yardcrawler.lod2.glb', import.meta.url).href,
        minDistance: 76,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/reclamation/derived/yardcrawler.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [4.4, 3.85, 9.0],
    yawDeg: 90,
    baseColorGain: 1.20,
    roughnessGain: 1.22,
    normalScale: 1.16,
    envMapIntensity: 0.52,
    emissiveIntensity: 0.012,
  },
  {
    key: 'reclaim_hornet',
    label: 'Reclamation Swarmhornet',
    url: new URL('../../../../packages/assets/game/units/reclamation/compressed/swarmhornet.glb', import.meta.url).href,
    lods: [
      {
        url: new URL('../../../../packages/assets/game/units/reclamation/derived/swarmhornet.lod1.glb', import.meta.url).href,
        minDistance: 52,
      },
      {
        url: new URL('../../../../packages/assets/game/units/reclamation/derived/swarmhornet.lod2.glb', import.meta.url).href,
        minDistance: 84,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/reclamation/derived/swarmhornet.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [10.6, 2.9, 10.0],
    // The approved V2 reconstruction faces source -X; rotate its nose to the
    // engine's +Z model-forward convention.
    yawDeg: 90,
    baseColorGain: 1.12,
    roughnessGain: 1.24,
    normalScale: 1.14,
    envMapIntensity: 0.50,
    emissiveIntensity: 0.008,
  },
  {
    key: 'allied_hydrofoil',
    label: 'Allied Hydrofoil',
    url: new URL(
      '../../../../packages/assets/game/units/allies/compressed/hydrofoil.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/allies/derived/hydrofoil.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    turretName: 'Turret',
    sourceTurretPivot: [0.108816, 0.17, -0.000091],
    target: [3.2, 2.8, 9.0],
    yawDeg: 90,
    baseColorGain: 1.06,
    roughnessGain: 1.18,
    normalScale: 1.14,
    envMapIntensity: 0.58,
  },
  {
    key: 'soviet_picket',
    label: 'Soviet Picket Boat',
    url: new URL(
      '../../../../packages/assets/game/units/soviets/compressed/picket-boat.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/soviets/derived/picket-boat.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    turretName: 'Turret',
    sourceTurretPivot: [-0.163565, 0.18, 0.001278],
    target: [3.3, 2.9, 9.0],
    yawDeg: 90,
    baseColorGain: 1.08,
    roughnessGain: 1.22,
    normalScale: 1.16,
    envMapIntensity: 0.54,
  },
  {
    key: 'meridian_cutter',
    label: 'Meridian Sun Cutter',
    url: new URL(
      '../../../../packages/assets/game/units/meridian/compressed/sun-cutter.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/meridian/derived/sun-cutter.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    turretName: 'Turret',
    sourceTurretPivot: [-0.115869, 0.16, 0.000162],
    target: [3.3, 2.8, 9.2],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.20,
    normalScale: 1.14,
    envMapIntensity: 0.56,
  },
  {
    key: 'reclaim_skimmer',
    label: 'Reclamation Scrap Skimmer',
    url: new URL(
      '../../../../packages/assets/game/units/reclamation/compressed/scrap-skimmer.glb', import.meta.url,
    ).href,
    lods: [
      {
        url: new URL(
          '../../../../packages/assets/game/units/reclamation/derived/scrap-skimmer.lod1.glb', import.meta.url,
        ).href,
        minDistance: 52,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/reclamation/derived/scrap-skimmer.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [3.4, 2.8, 9.0],
    yawDeg: 90,
    baseColorGain: 1.18,
    roughnessGain: 1.24,
    normalScale: 1.14,
    envMapIntensity: 0.50,
  },
  {
    key: 'allied_gunboat',
    label: 'Allied Assault Destroyer',
    url: new URL(
      '../../../../packages/assets/game/units/allies/compressed/assault-destroyer.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/allies/derived/assault-destroyer.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    turretName: 'Turret',
    sourceTurretPivot: [0.230447, 0.19, 0.000166],
    // Matches the escort rung's authored/simulation envelope. Do not shrink
    // this independently: the old 9.6 m target made it read as a speedboat
    // between the 7.2 m Hydrofoil and 14 m Aircraft Cruiser.
    target: [4.0, 3.8, 12.0],
    yawDeg: 90,
    baseColorGain: 1.06,
    roughnessGain: 1.18,
    normalScale: 1.14,
    envMapIntensity: 0.58,
  },
  {
    key: 'soviet_sub',
    label: 'Soviet Attack Submarine',
    url: new URL(
      '../../../../packages/assets/game/units/soviets/compressed/attack-submarine.glb', import.meta.url,
    ).href,
    lods: [
      {
        url: new URL(
          '../../../../packages/assets/game/units/soviets/derived/attack-submarine.lod1.glb', import.meta.url,
        ).href,
        minDistance: 52,
      },
      {
        url: new URL(
          '../../../../packages/assets/game/units/soviets/derived/attack-submarine.lod2.glb', import.meta.url,
        ).href,
        minDistance: 84,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/soviets/derived/attack-submarine.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [2.9, 2.5, 12.4],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.24,
    normalScale: 1.16,
    envMapIntensity: 0.50,
  },
  {
    key: 'meridian_corvette',
    label: 'Meridian Kite Corvette',
    url: new URL(
      '../../../../packages/assets/game/units/meridian/compressed/kite-corvette.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/meridian/derived/kite-corvette.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    turretName: 'Turret',
    sourceTurretPivot: [0.203624, 0.19, 0.000135],
    target: [3.6, 3.0, 10.0],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.18,
    normalScale: 1.14,
    envMapIntensity: 0.58,
  },
  {
    key: 'reclaim_scow',
    label: 'Reclamation Slag Scow',
    url: new URL(
      '../../../../packages/assets/game/units/reclamation/compressed/slag-scow.glb', import.meta.url,
    ).href,
    lods: [
      {
        url: new URL(
          '../../../../packages/assets/game/units/reclamation/derived/slag-scow.lod1.glb', import.meta.url,
        ).href,
        minDistance: 52,
      },
      {
        url: new URL(
          '../../../../packages/assets/game/units/reclamation/derived/slag-scow.lod2.glb', import.meta.url,
        ).href,
        minDistance: 84,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/reclamation/derived/slag-scow.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [3.8, 3.0, 10.0],
    yawDeg: 90,
    baseColorGain: 1.20,
    roughnessGain: 1.26,
    normalScale: 1.14,
    envMapIntensity: 0.48,
  },
  {
    key: 'allied_destroyer',
    label: 'Allied Aircraft Cruiser',
    url: new URL(
      '../../../../packages/assets/game/units/allies/compressed/aircraft-cruiser.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/allies/derived/aircraft-cruiser.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    turretName: 'Turret',
    sourceTurretPivot: [-0.69, -0.15, 0],
    target: [4.2, 4.4, 14.0],
    yawDeg: 90,
    baseColorGain: 1.06,
    roughnessGain: 1.18,
    normalScale: 1.14,
    envMapIntensity: 0.58,
  },
  {
    key: 'soviet_dreadnought',
    label: 'Soviet Dreadnought',
    url: new URL(
      '../../../../packages/assets/game/units/soviets/compressed/dreadnought.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/soviets/derived/dreadnought.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    turretName: 'Turret',
    sourceTurretPivot: [-0.36, -0.14, 0],
    target: [4.8, 4.8, 16.0],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.24,
    normalScale: 1.16,
    envMapIntensity: 0.50,
  },
  {
    key: 'meridian_monitor',
    label: 'Meridian Sunmonitor',
    url: new URL(
      '../../../../packages/assets/game/units/meridian/compressed/sunmonitor.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/meridian/derived/sunmonitor.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    turretName: 'Turret',
    sourceTurretPivot: [-0.90, -0.50, 0],
    target: [4.6, 4.4, 15.0],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.20,
    normalScale: 1.14,
    envMapIntensity: 0.56,
  },
  {
    key: 'reclaim_hulk',
    label: 'Reclamation Reclaimed Hulk',
    url: new URL(
      '../../../../packages/assets/game/units/reclamation/compressed/reclaimed-hulk.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/reclamation/derived/reclaimed-hulk.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    turretName: 'Turret',
    sourceTurretPivot: [-0.42, -0.03, -0.02],
    target: [4.8, 4.4, 15.0],
    yawDeg: 90,
    baseColorGain: 1.20,
    roughnessGain: 1.26,
    normalScale: 1.14,
    envMapIntensity: 0.48,
  },
  {
    key: 'soviet_transport',
    label: 'Soviet Hover Transport',
    url: new URL(
      '../../../../packages/assets/game/units/soviets/compressed/hover-transport.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/soviets/derived/hover-transport.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [5.0, 3.4, 9.6],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.24,
    normalScale: 1.16,
    envMapIntensity: 0.50,
  },
  {
    key: 'soviet_lighter',
    label: 'Soviet Assault Barge',
    url: new URL(
      '../../../../packages/assets/game/units/soviets/compressed/assault-barge.glb', import.meta.url,
    ).href,
    lods: [
      {
        url: new URL(
          '../../../../packages/assets/game/units/soviets/derived/assault-barge.lod1.glb', import.meta.url,
        ).href,
        minDistance: 52,
      },
      {
        url: new URL(
          '../../../../packages/assets/game/units/soviets/derived/assault-barge.lod2.glb', import.meta.url,
        ).href,
        minDistance: 84,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/soviets/derived/assault-barge.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [5.2, 3.0, 11.0],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.24,
    normalScale: 1.16,
    envMapIntensity: 0.50,
  },
  {
    key: 'allied_transport',
    label: 'Allied Hover Transport',
    url: new URL(
      '../../../../packages/assets/game/units/allies/compressed/hover-transport.glb', import.meta.url,
    ).href,
    lods: [
      {
        url: new URL(
          '../../../../packages/assets/game/units/allies/derived/hover-transport.lod1.glb', import.meta.url,
        ).href,
        minDistance: 48,
      },
      {
        url: new URL(
          '../../../../packages/assets/game/units/allies/derived/hover-transport.lod2.glb', import.meta.url,
        ).href,
        minDistance: 78,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/allies/derived/hover-transport.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [5.0, 3.4, 9.6],
    yawDeg: 90,
    baseColorGain: 1.06,
    roughnessGain: 1.18,
    normalScale: 1.14,
    envMapIntensity: 0.58,
  },
  {
    key: 'allied_lighter',
    label: 'Allied Landing Craft',
    url: new URL(
      '../../../../packages/assets/game/units/allies/compressed/landing-craft.glb', import.meta.url,
    ).href,
    lods: [
      {
        url: new URL(
          '../../../../packages/assets/game/units/allies/derived/landing-craft.lod1.glb', import.meta.url,
        ).href,
        minDistance: 52,
      },
      {
        url: new URL(
          '../../../../packages/assets/game/units/allies/derived/landing-craft.lod2.glb', import.meta.url,
        ).href,
        minDistance: 84,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/allies/derived/landing-craft.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [5.0, 3.0, 11.0],
    yawDeg: 90,
    baseColorGain: 1.06,
    roughnessGain: 1.18,
    normalScale: 1.14,
    envMapIntensity: 0.58,
  },
  {
    key: 'meridian_lighter',
    label: 'Meridian Sun Lighter',
    url: new URL(
      '../../../../packages/assets/game/units/meridian/compressed/sun-lighter.glb', import.meta.url,
    ).href,
    lods: [
      {
        url: new URL(
          '../../../../packages/assets/game/units/meridian/derived/sun-lighter.lod1.glb', import.meta.url,
        ).href,
        minDistance: 52,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/meridian/derived/sun-lighter.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [5.0, 3.0, 11.2],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.20,
    normalScale: 1.14,
    envMapIntensity: 0.56,
  },
  {
    key: 'meridian_argosy',
    label: 'Meridian Argosy',
    url: new URL(
      '../../../../packages/assets/game/units/meridian/compressed/argosy.glb', import.meta.url,
    ).href,
    lods: [
      {
        url: new URL(
          '../../../../packages/assets/game/units/meridian/derived/argosy.lod1.glb', import.meta.url,
        ).href,
        minDistance: 56,
      },
    ],
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/meridian/derived/argosy.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [6.0, 3.6, 13.2],
    yawDeg: 90,
    baseColorGain: 1.10,
    roughnessGain: 1.20,
    normalScale: 1.14,
    envMapIntensity: 0.56,
  },
  {
    key: 'reclaim_hauler',
    label: 'Reclamation Slag Hauler',
    url: new URL(
      '../../../../packages/assets/game/units/reclamation/compressed/slag-hauler.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/units/reclamation/derived/slag-hauler.shadow.glb', import.meta.url,
    ).href,
    hullName: 'Hull',
    target: [6.2, 3.6, 13.0],
    yawDeg: 90,
    baseColorGain: 1.20,
    roughnessGain: 1.26,
    normalScale: 1.14,
    envMapIntensity: 0.48,
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

type ImportedAnimatedMaterial = THREE.Material & {
  color: THREE.Color;
  normalScale: THREE.Vector2;
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
  emissiveIntensity: number;
  emissiveMap: THREE.Texture | null;
  aoMap: THREE.Texture | null;
  vertexColors: boolean;
};

export function importedAnimatedUnitMaterial(
  source: THREE.MeshStandardMaterial, spec: ImportedUnitSpec,
): THREE.Material {
  if (source.map === null || source.normalMap === null) {
    throw new Error(`${spec.label}: animated import requires base-colour and normal textures`);
  }
  const ormMap = source.roughnessMap ?? source.metalnessMap;
  if (ormMap === null) throw new Error(`${spec.label}: animated import requires a packed MR texture`);
  const textures: UnitMaterialTextures = {
    map: source.map,
    normalMap: source.normalMap,
    ormMap,
    // The dog has no emissive surface. This slot is removed immediately after
    // construction; using an existing texture avoids a one-off allocation.
    emissiveMap: source.map,
  };
  const material = unitMaterialFor(textures, `${spec.key}.imported.gait`) as ImportedAnimatedMaterial;
  material.color.copy(source.color).multiplyScalar(spec.baseColorGain ?? 1);
  material.normalScale.setScalar(spec.normalScale ?? 1);
  material.roughness = spec.roughnessGain ?? 1;
  material.metalness = 1;
  material.clearcoat = 0.02;
  material.clearcoatRoughness = 0.88;
  material.envMapIntensity = spec.envMapIntensity ?? 0.5;
  material.emissiveMap = null;
  material.emissiveIntensity = 0;
  // Meshy's metallic/roughness image has no authored AO channel or UV1.
  material.aoMap = null;
  material.vertexColors = false;
  for (const texture of [source.map, source.normalMap, ormMap]) {
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    runtimeTextures.add(texture);
  }
  runtimeMaterials.add(material);
  return material;
}

function importedUnitMaterial(source: THREE.Material, spec: ImportedUnitSpec): THREE.Material {
  if (!(source instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`${spec.label}: expected MeshStandardMaterial, received ${source.type}`);
  }
  if (spec.gait !== undefined) return importedAnimatedUnitMaterial(source, spec);

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

/**
 * Mark only the four lower limbs for a diagonal quadruped trot.
 *
 * Each leg rotates around its own fore/hind joint in model space. The body,
 * armour, panniers, head and tail retain zero weights and therefore remain in
 * the approved rest silhouette. This is two tiny attributes on the existing
 * instanced mesh, not four bones per dog or one mixer per entity.
 */
export function tagQuadrupedGait(geometry: THREE.BufferGeometry): void {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const position = geometry.getAttribute('position');
  if (bounds === null || position === undefined) throw new Error('quadruped geometry has no bounds');
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const legTop = bounds.min.y + size.y * 0.58;
  const pivotY = bounds.min.y + size.y * 0.56;
  const gait = new Float32Array(position.count * 2);
  let positive = 0;
  let negative = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) - center.x;
    const y = position.getY(i);
    const z = position.getZ(i) - center.z;
    const isLeg = y <= legTop
      && Math.abs(x) >= size.x * 0.12
      && Math.abs(z) >= size.z * 0.16;
    if (!isLeg) continue;
    const side = x >= 0 ? 1 : -1;
    const end = z >= 0 ? 1 : -1;
    const sign = side === end ? 1 : -1;
    // Magnitude 2 = +Z pair, 3 = -Z pair. The shared shader decodes the local
    // joint without adding a vertex attribute (and therefore without forking
    // the WebGPU pipeline layout used by unit previews and secondary passes).
    gait[i * 2] = sign * (end > 0 ? 2 : 3);
    gait[i * 2 + 1] = pivotY;
    if (sign > 0) positive++; else negative++;
  }
  if (positive === 0 || negative === 0) {
    throw new Error('quadruped gait could not resolve all four legs');
  }
  geometry.setAttribute('aGait', new THREE.BufferAttribute(gait, 2));
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

function sceneMeshes(scene: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
}

/**
 * Resolve one authored glTF node to its runtime primitive meshes.
 *
 * GLTFLoader represents a node with multiple material primitives as a Group
 * carrying the authored name and child meshes suffixed `_1`, `_2`, ... . The
 * asset contract belongs to the named node, not those loader-generated child
 * names. Treating only exact Mesh names as authored parts made the two-material
 * Meridian Argosy fall back even though its source node is correctly `Hull`.
 */
export function resolveImportedPartMeshes(
  scene: THREE.Object3D,
  partName: string,
  label: string,
): readonly THREE.Mesh[] {
  scene.updateMatrixWorld(true);
  const matches: THREE.Object3D[] = [];
  const key = partName.toLowerCase();
  scene.traverse((object) => {
    if (object.name.toLowerCase() === key) matches.push(object);
  });
  if (matches.length !== 1) {
    const available = sceneMeshes(scene).map((mesh) => mesh.name).join(', ');
    throw new Error(
      `${label}: expected one ${partName} node, received ${matches.length}; meshes: ${available}`,
    );
  }
  const meshes = sceneMeshes(matches[0]);
  if (meshes.length === 0) throw new Error(`${label}: ${partName} node contains no mesh primitives`);
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material)) {
      throw new Error(`${label}: ${partName} primitive ${mesh.name} must use one material`);
    }
  }
  return meshes;
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

function sourcePartGeometry(meshes: readonly THREE.Mesh[], label: string): THREE.BufferGeometry {
  const geometries = meshes.map((mesh) => sourceGeometry(mesh));
  if (geometries.length === 1) return geometries[0];
  const merged = mergeGeometries(geometries, true);
  for (const geometry of geometries) geometry.dispose();
  if (merged === null) throw new Error(`${label}: material primitives could not be merged`);
  merged.computeBoundingBox();
  return merged;
}

function primitiveMaterialNames(meshes: readonly THREE.Mesh[]): string[] {
  return meshes.map((mesh) => {
    if (Array.isArray(mesh.material)) throw new Error(`${mesh.name}: material array is unsupported`);
    return mesh.material.name;
  });
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
 * Reject an imported hull whose post-fit footprint no longer matches gameplay.
 *
 * This is intentionally measured after every source transform, non-uniform
 * scale and yaw has been applied. A plausible `target` literal is not enough:
 * a changed source axis or node transform can otherwise publish a visually
 * microscopic shell while selection and collision continue using metre-scale
 * values from the simulation.
 */
export function assertImportedHorizontalEnvelope(
  geometry: THREE.BufferGeometry,
  target: ImportedUnitSpec['target'],
  label: string,
): void {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (bounds === null) throw new Error(`${label}: fitted hull has no bounds`);
  const size = bounds.getSize(new THREE.Vector3());
  const widthError = Math.abs(size.x - target[0]) / target[0];
  const lengthError = Math.abs(size.z - target[2]) / target[2];
  if (widthError > 0.035 || lengthError > 0.035) {
    throw new Error(
      `${label}: fitted hull footprint ${size.x.toFixed(2)} x ${size.z.toFixed(2)} m `
      + `does not match ${target[0].toFixed(2)} x ${target[2].toFixed(2)} m target`,
    );
  }
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

  const hullSources = resolveImportedPartMeshes(loaded[0].scene, spec.hullName, spec.label);
  const turretSources = spec.turretName === undefined
    ? undefined
    : resolveImportedPartMeshes(loaded[0].scene, spec.turretName, spec.label);

  const rawHull = sourcePartGeometry(hullSources, `${spec.label} hull`);
  const rawTurret = turretSources === undefined
    ? undefined
    : sourcePartGeometry(turretSources, `${spec.label} turret`);
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
    // Vehicles reconstruct lengthwise on X; upright character sources use Z.
    // Fit before yaw so each family lands in the exact gameplay envelope.
    scale: spec.sourceLongAxis === 'z'
      ? new THREE.Vector3(
        spec.target[0] / hullSize.x,
        spec.target[1] / fullSize.y,
        spec.target[2] / hullSize.z,
      )
      : new THREE.Vector3(
        spec.target[2] / hullSize.x,
        spec.target[1] / fullSize.y,
        spec.target[0] / hullSize.z,
      ),
    yaw: THREE.MathUtils.degToRad(spec.yawDeg ?? 0),
  };

  const geometry = fitGeometry(rawHull, fit, false);
  assertImportedHorizontalEnvelope(geometry, spec.target, spec.label);
  if (spec.gait === 'quadruped') tagQuadrupedGait(geometry);
  geometry.name = `${spec.key}.imported.hull`;
  const turretGeometry = rawTurret === undefined
    ? undefined
    : sealTurretInterface(fitGeometry(rawTurret, fit, true), spec, fit);
  if (turretGeometry !== undefined) turretGeometry.name = `${spec.key}.imported.turret`;

  const hullLods: { geometry: THREE.BufferGeometry; minDistance: number }[] = [];
  const turretLods: { geometry: THREE.BufferGeometry; minDistance: number }[] = [];
  lodSpecs.forEach((lod, index) => {
    const lodLabel = `${spec.label} LOD${index + 1}`;
    const lodHullSources = resolveImportedPartMeshes(
      loaded[index + 1].scene, spec.hullName, lodLabel,
    );
    const lodTurretSources = spec.turretName === undefined
      ? undefined
      : resolveImportedPartMeshes(loaded[index + 1].scene, spec.turretName, lodLabel);
    if (
      primitiveMaterialNames(lodHullSources).join('\0')
      !== primitiveMaterialNames(hullSources).join('\0')
    ) {
      throw new Error(`${lodLabel}: hull material primitives differ from LOD0`);
    }
    if (
      lodTurretSources !== undefined
      && turretSources !== undefined
      && primitiveMaterialNames(lodTurretSources).join('\0')
        !== primitiveMaterialNames(turretSources).join('\0')
    ) {
      throw new Error(`${lodLabel}: turret material primitives differ from LOD0`);
    }
    const hullGeometry = fitGeometry(sourcePartGeometry(lodHullSources, `${lodLabel} hull`), fit, false);
    if (spec.gait === 'quadruped') tagQuadrupedGait(hullGeometry);
    hullGeometry.name = `${spec.key}.imported.hull.lod${index + 1}`;
    hullLods.push({ geometry: hullGeometry, minDistance: lod.minDistance });
    if (lodTurretSources !== undefined) {
      const partGeometry = sealTurretInterface(
        fitGeometry(sourcePartGeometry(lodTurretSources, `${lodLabel} turret`), fit, true), spec, fit,
      );
      partGeometry.name = `${spec.key}.imported.turret.lod${index + 1}`;
      turretLods.push({ geometry: partGeometry, minDistance: lod.minDistance });
    }
  });

  let shadowGeometry: THREE.BufferGeometry | undefined;
  if (shadowUrl !== undefined) {
    const shadowMeshes = sceneMeshes(loaded[1 + lodSpecs.length].scene);
    const shadowSource = shadowMeshes[0];
    if (shadowSource === undefined || shadowMeshes.length !== 1) {
      throw new Error(`${spec.label}: shadow proxy must contain exactly one mesh`);
    }
    shadowGeometry = fitGeometry(sourceGeometry(shadowSource), fit, false);
    shadowGeometry.name = `${spec.key}.imported.shadow`;
  }

  const runtimeMaterialBySource = new Map<THREE.Material, THREE.Material>();
  const materialForSource = (source: THREE.Material): THREE.Material => {
    const existing = runtimeMaterialBySource.get(source);
    if (existing !== undefined) return existing;
    const material = importedUnitMaterial(source, spec);
    runtimeMaterialBySource.set(source, material);
    return material;
  };
  const materials = hullSources.map((mesh) => {
    if (Array.isArray(mesh.material)) throw new Error(`${mesh.name}: material array is unsupported`);
    return materialForSource(mesh.material);
  });
  const material: THREE.Material | THREE.Material[] = materials.length === 1 ? materials[0] : materials;
  const turretMaterials = turretSources?.map((mesh) => {
    if (Array.isArray(mesh.material)) throw new Error(`${mesh.name}: material array is unsupported`);
    return materialForSource(mesh.material);
  });
  const turretMaterial: THREE.Material | THREE.Material[] = turretMaterials === undefined
    ? material
    : turretMaterials.length === 1 ? turretMaterials[0] : turretMaterials;
  const parts: KindMeshPart[] = [];
  if (turretGeometry !== undefined) {
    parts.push({
      geometry: turretGeometry,
      lods: turretLods,
      material: turretMaterial,
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
      shadowOnly: true,
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

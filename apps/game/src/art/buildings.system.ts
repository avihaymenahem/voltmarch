/**
 * ============================================================================
 * VOLTMARCH — src/art/buildings.system.ts
 * ============================================================================
 * The plugin entry point for the building-art module.
 *
 * WHAT IT DOES AT BOOT
 *   1. Picks an atlas size from the quality tier.
 *   2. Generates two greeble atlases per faction — architecture and ground —
 *      for four materials total, shared by all 24 structures.
 *   3. Builds every mass list, validating each against BUILDING_VALIDATION and
 *      REJECTING anything that misses.
 *   4. Measures the live heightfield to prove the foundation pads' skirt is
 *      deep enough to meet terrain on every buildable cell.
 *   5. Publishes them on `buildingLibrary` and hands them to RenderBridge.
 *      On an MCV opening, only Construction Yard GLBs block first reveal; the
 *      remaining authored overrides stream into RenderBridge after boot.
 *   6. Prints the scorecard line for every structure, so the critic loop gets
 *      numbers instead of opinions.
 *
 * WHAT IT DOES EVERY FRAME
 *   One line: `buildingTime.value = r.time`. That single shared uniform drives
 *   construction rise, bay doors, radar sweeps, damage flicker and the
 *   selection pulse across every structure on the map, because all of them are
 *   per-instance shader effects reading `aState` and `aFeature`. There is no
 *   per-entity animation state anywhere in this module.
 *
 * HANDING OFF TO RenderBridge
 * ---------------------------
 * Two passes, the same shape `units.system.ts` uses:
 *
 *   a. a DEFAULT per Faction at defId -1, so a building spawned before the
 *      content tables exist gets real art instead of a hazard box;
 *   b. an EXACT registration per content key once `resolveDefBinding()` has a
 *      def table, so a Barracks stops borrowing the Construction Yard's shell.
 *
 * Until (b) has a table to bind against, every structure of an army draws its
 * Construction Yard. That is loud, deliberate, and reported at boot — the
 * alternative is silently guessing, and the fix is one data module away.
 * ============================================================================
 */

import * as THREE from 'three';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { defineSystem } from '../core/loop';
import { mapConcurrent } from '../core/async-pool';
import { beginBootSpan } from '../core/boot-telemetry';
import {
  liveAssetStreamingEnabled,
  scheduleBattlefieldWork,
  waitForBattlefieldIdle,
} from '../core/battlefield-ready';
import {
  BUILDING_GREEBLE,
  BUILDING_PAD,
  CELL,
  MAP_CELLS,
  MAP_SIZE,
  QUALITY_PRESETS,
  RA3_PAD_PALETTE,
  RA3_STRUCTURE_PALETTE,
} from '../core/config';
import { EntityKind, Faction, RenderPhase, type QualityTier, type RenderContext } from '../core/types';
import { ctx } from '../game/context';
import { plannedScenario, resolveDefBinding } from '../game/Scenarios';
import { requestedBackend } from '../render/backend';
import {
  FACTION_ANY,
  registerKindMesh,
  type KindMesh,
  type SocketSpec,
} from '../render/RenderBridge';
import { STRUCTURE_MASS_LISTS } from './BuildingDefs';
import { acquireRuntimeKTX2Loader, releaseRuntimeKTX2Loader } from './RuntimeKTX2Loader';
import { createRuntimeGLTFLoader } from './RuntimeGLTFLoader';
import {
  promoteGeometryAttributeToFloat32,
  removeStaleTangentAttribute,
} from './geometry-attributes';
import {
  ARMY_ORDER, GAIA_SLOT, builtBy, type PerArmy,
} from './faction-models';
import {
  buildingLibrary,
  buildingTime,
  formatStructureStats,
  applyStructureRuntimeShader,
  type StructureFaction,
  type StructureModel,
} from './BuildingFactory';
import { STRUCTURE_FEATURE } from './structure-anim';
import { isArtFactionPlanned } from './boot-plan';
import {
  contentClosureEpoch, declareArtAssetFamily, markArtAssetFamilyFallbackReady,
  markArtAssetFamilyReady, markContentProviderReady,
  requestArtAssetFamily,
} from '../core/content-closure';
import { buildingProviderBindingsReady } from './provider-readiness';

interface BuildingGlobal { __vmBuildings?: unknown; }

function originalFactionForModel(key: string): Faction {
  return key.startsWith('soviet_')
    ? Faction.Soviets
    : key.startsWith('allied_')
      ? Faction.Allies
      : Faction.Neutral;
}

/**
 * Content key -> one model PER ARMY, for the keys whose def is faction-neutral.
 * The content vocabulary belongs to `src/game/Scenarios.ts`, so this is the one
 * place the two namespaces meet.
 *
 * IT WAS `readonly [string, string]`, AND THE MISSING TWO SLOTS WERE A VISIBLE
 * BUG. `resolve()` is keyed on (kind, FACTION, defId), and this table registered
 * at Allies / Soviets / Neutral only. So a Pact-owned Construction Yard — which
 * can only arise by CAPTURE, since the Pact builds `mrdConclave` and never this
 * def — missed (Building, Meridian, defId), missed (Building, ANY, defId), and
 * fell through to (Building, Meridian, -1), which `Faction3Buildings.ts` binds
 * to `meridian_chapterhouse`. A captured Construction Yard redrew as a
 * Chapterhouse on the battlefield while its sidebar portrait stayed Allied.
 *
 * `builtBy` is shared with `src/ui/Cameos.ts` precisely so those two cannot
 * disagree again — it was defined privately there, widened to four slots for
 * the engineer-skins fix, and this table was left at two. The decision it
 * encodes (both newer armies take the ALLIED model, because a captured Allied
 * Refinery is still an Allied Refinery) is argued at its definition, along with
 * the limit that resolution never sees who BUILT the thing.
 */
export const SHARED_KEYS: Readonly<Record<string, PerArmy<string>>> = {
  conyard: builtBy('allied_conyard', 'soviet_conyard'),
  powerPlant: builtBy('allied_power', 'soviet_power'),
  barracks: builtBy('allied_barracks', 'soviet_barracks'),
  refinery: builtBy('allied_refinery', 'soviet_refinery'),
  warFactory: builtBy('allied_warfactory', 'soviet_warfactory'),
  radar: builtBy('allied_radar', 'soviet_radar'),
  battleLab: builtBy('allied_tech', 'soviet_tech'),
  commandPost: builtBy('allied_commandpost', 'soviet_commandpost'),
  oreSilo: builtBy('allied_silo', 'soviet_silo'),
  repairDepot: builtBy('allied_depot', 'soviet_depot'),
  wall: builtBy('allied_wall', 'soviet_wall'),
  gate: builtBy('allied_gate', 'soviet_gate'),
};

/** Content keys whose def already picks a side. Registered at FACTION_ANY. */
export const FACTION_KEYS: Readonly<Record<string, string>> = {
  alliedAirbase: 'allied_airbase',
  sovietAviationWorks: 'soviet_airbase',
  pillbox: 'allied_pillbox',
  // Real slewing crystal head, not the AA mount it stood in for.
  prismTower: 'allied_prismtower',
  teslaCoil: 'soviet_tesla',
  // Turretless with four radial nozzles: `Defs.flameTower` never sets
  // `hasTurret`, so nothing on it may slew.
  flameTower: 'soviet_flametower',
  // Single-faction in Defs.ts, so these are FACTION_ANY like the defences —
  // and they now have their own art instead of borrowing a Construction Yard.
  navalYard: 'allied_navalyard',
  subPen: 'soviet_subpen',
  // Freed from stand-in duty by the two rows above; these are the def rows the
  // models agent asked for and they now exist in Defs.ts.
  aaTurret: 'allied_aa',
  sentryGun: 'soviet_sentry',
  // The superweapons. Single-faction defs, so FACTION_ANY like the defences.
  // Without these four lines the structures build and place and then draw
  // their army's barracks — the `DEFAULT_KEY` failure this file's own header
  // describes, which is silent and looks like a content bug in Defs.ts.
  chronosphere: 'allied_chrono',
  weatherControl: 'allied_weather',
  nuclearSilo: 'soviet_nuke',
  ironCurtain: 'soviet_curtain',

  // THE CIVILIAN BLOCK, and FACTION_ANY is the load-bearing part.
  //
  // These are the only structures in the game that legitimately change owner
  // mid-match without changing what they are: an engineer takes a derrick, a
  // squad garrisons a hospital and hands it back on the way out. `resolve()`
  // is keyed on (kind, FACTION, defId), so a `SHARED_KEYS`-shaped registration
  // would REDRAW a captured hospital as its new owner's architecture the
  // instant `store.faction` changed — a civilian block that becomes an Allied
  // one and then a Soviet one as the deed passes. FACTION_ANY is what makes
  // the model a property of the building rather than of whoever holds it.
  //
  // It also means the model does not repaint at all on capture, which is
  // correct here and is NOT a limitation of this registration: structure team
  // slabs come out of the per-faction greeble atlas and never read
  // `aTeamColor`. Three ownership tells were checked in a running match and
  // survive: the minimap blip turns from neutral grey to the holder's accent
  // (`src/ui/Minimap.ts`), the structure starts feeding its new owner's
  // vision, and `Capture.captureBuilding` fires a `BuildComplete` burst on the
  // spot. See `src/art/BuildingDefs.ts` §4b.
  civOilDerrick: 'civ_derrick',
  civHospital: 'civ_hospital',
  civApartments: 'civ_apartments',
  civOreMine: 'civ_mine',
};

/**
 * What a faction falls back to when the defId is unknown.
 *
 * The BARRACKS, deliberately, and it is worth saying why. Until a data module
 * publishes a `DefTables`, every structure the scenario spawns carries defId
 * -1, so the bridge resolves all of them to this one model and an entire base
 * is eight copies of it. The barracks is the least damaging choice available:
 * its 2x2 footprint is the modal structure size (only the Construction Yard,
 * Refinery and War Factory are bigger, and the defences and walls are 1x1), and
 * it is the plainest silhouette in the roster — no crane, no dish, no stacks —
 * so a base of them reads as a base rather than as eight Construction Yards,
 * which is what an obviously-repeated landmark building looks like.
 *
 * Every content key already has its real model in the tables above; the moment
 * `resolveDefBinding()` returns a table this fallback stops being reachable.
 */
const DEFAULT_KEY: Readonly<Record<StructureFaction, string>> = {
  allies: 'allied_barracks',
  soviets: 'soviet_barracks',
};

/* ==========================================================================
 * BRIDGE SHAPE
 * ========================================================================== */

/**
 * Translate a built structure into the bridge's shape.
 *
 * The pad is a separate PART because it carries a separate material (bible
 * 5.4's ground class), and the turret is a separate part because the bridge
 * slews it. Doors and radar dishes are NOT parts — they animate inside the
 * body geometry off `aFeature`, which is what keeps a War Factory at two draw
 * calls instead of four.
 */
function toKindMesh(m: StructureModel): KindMesh {
  // ONE depth material for the whole roster. Every part whose vertex shader
  // sinks it below the pad while it builds must carry it, or the shadow map
  // keeps drawing the finished silhouette of a structure that is not there yet.
  const depth = buildingLibrary.depthMaterial();
  const sockets: SocketSpec[] = m.sockets.map((s) => ({
    part: s.part, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, followsTurret: false,
  }));
  for (const s of m.turretSockets) {
    sockets.push({
      part: s.part,
      x: s.x + m.turretPivot[0], y: s.y + m.turretPivot[1], z: s.z + m.turretPivot[2],
      yaw: s.yaw, pitch: s.pitch, followsTurret: true, pivotY: m.turretPivot[1],
    });
  }

  const parts: NonNullable<KindMesh['parts']>[number][] = [];
  if (m.pad !== null) {
    parts.push({
      geometry: m.pad,
      material: m.padMaterial,
      // A pad is 40 mm of slab on the ground. Casting a shadow from it buys
      // nothing and costs a shadow-map draw per structure on screen — and for
      // the same reason it is not an AMBIENT OCCLUDER either: GTAO's normal
      // prepass took it (opaque, depth-writing, on the BUILDINGS layer) and
      // read four centimetres of slab as a wall standing on the ground, which
      // is the failure `render/post.ts#aoOccluder` already documents for the
      // decal sheet. -10 draws on `01-establishing-base`, one per pad-bearing
      // MODEL on screen, because batches are keyed per (model, part).
      castShadow: false,
      aoOccluder: false,
      receiveShadow: true,
    });
  }
  if (m.turret !== null) {
    parts.push({
      geometry: m.turret,
      material: m.material,
      x: m.turretPivot[0], y: m.turretPivot[1], z: m.turretPivot[2],
      followsTurret: true,
      castShadow: true,
      customDepthMaterial: depth,
      receiveShadow: true,
    });
  }

  return {
    geometry: m.body,
    material: m.material,
    parts: parts.length > 0 ? parts : undefined,
    sockets,
    turretPivotY: m.turretPivot[1],
    castShadow: true,
    customDepthMaterial: depth,
    receiveShadow: true,
  };
}

export interface ImportedStructureStyle {
  color: readonly [number, number, number];
  metalness: number;
  roughness: number;
  normalScale: number;
  ambient: readonly [number, number, number];
  ambientIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
  /**
   * Meshy often bakes studio-preview gloss into the packed roughness channel.
   * Disable it for hard-surface families whose panels must read as dry plate.
   */
  useRoughnessMap?: boolean;
}

export interface ImportedStructureSpec {
  key: string;
  label: string;
  url: string;
  /** Geometry-only caster derived from the approved LOD0. Omitted for moving assemblies. */
  shadowUrl?: string;
  /** Whole-family camera-distance LODs. Only visually validated candidates belong here. */
  lods?: readonly { url: string; minDistance: number }[];
  widthScale: number;
  depthScale: number;
  heightScale: number;
  yawDeg?: number;
  /** Optional hard-surface rebuild applied to derived colour LODs only. */
  lodCreaseAngle?: number;
  creaseAngle?: number;
  /**
   * Pull a coarse height-field caster inside the visible shell. The proxy is
   * deliberately conservative in silhouette, so fitting it to the exact LOD0
   * bounds can make its cell tops self-shadow bright sloped roofs.
   */
  shadowInset?: number;
  liftFoundation?: boolean;
  sourceBounds?: {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  };
  proceduralParts?: 'all' | 'foundation-only' | 'none';
  movingTurret?: {
    bodyName: string;
    turretName: string;
    sourcePivotY: number;
    /** Fractions of fitted width, height and depth, measured from ground/centre. */
    muzzle: readonly [number, number, number];
  };
  foundation?: 'soviet-conyard-plinth';
  accessory?: 'soviet-barracks-door' | 'soviet-radar-array';
  style: ImportedStructureStyle;
}

const IMPORTED_SOVIET_STRUCTURES: readonly ImportedStructureSpec[] = [
  {
    key: 'soviet_conyard',
    label: 'Soviet Construction Yard',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/construction-yard-surface-v2.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/construction-yard-surface-v2.shadow.glb', import.meta.url).href,
    widthScale: 0.92,
    depthScale: 0.90,
    heightScale: 0.86,
    creaseAngle: 38,
    proceduralParts: 'none',
    foundation: 'soviet-conyard-plinth',
    style: {
      color: [0.82, 0.88, 0.66],
      metalness: 0.10,
      roughness: 0.50,
      normalScale: 1.80,
      ambient: [0.30, 0.28, 0.10],
      ambientIntensity: 0.08,
      clearcoat: 0.08,
      clearcoatRoughness: 0.62,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'soviet_warfactory',
    label: 'Soviet War Factory',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/war-factory.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/war-factory.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/war-factory.lod1.glb', import.meta.url).href, minDistance: 78 },
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/war-factory.lod2.glb', import.meta.url).href, minDistance: 112 },
    ],
    widthScale: 0.94,
    depthScale: 0.90,
    heightScale: 0.90,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [0.82, 0.88, 0.66],
      metalness: 0.24,
      roughness: 0.68,
      normalScale: 1.35,
      ambient: [0.30, 0.28, 0.10],
      ambientIntensity: 0.08,
      clearcoat: 0.08,
      clearcoatRoughness: 0.62,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'soviet_barracks',
    label: 'Soviet Barracks',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/barracks.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/barracks.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/barracks.lod1.glb', import.meta.url).href, minDistance: 86 },
    ],
    widthScale: 0.92,
    depthScale: 0.92,
    heightScale: 0.90,
    creaseAngle: 38,
    proceduralParts: 'none',
    accessory: 'soviet-barracks-door',
    style: {
      color: [0.82, 0.88, 0.66],
      metalness: 0.24,
      roughness: 0.68,
      normalScale: 1.35,
      ambient: [0.30, 0.28, 0.10],
      ambientIntensity: 0.08,
      clearcoat: 0.08,
      clearcoatRoughness: 0.62,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'soviet_refinery',
    label: 'Soviet Ore Refinery',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/ore-refinery.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/ore-refinery.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/ore-refinery.lod1.glb', import.meta.url).href, minDistance: 78 },
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/ore-refinery.lod2.glb', import.meta.url).href, minDistance: 112 },
    ],
    widthScale: 0.94,
    depthScale: 0.90,
    heightScale: 0.92,
    yawDeg: 90,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [0.82, 0.88, 0.66],
      metalness: 0.24,
      roughness: 0.68,
      normalScale: 1.35,
      ambient: [0.30, 0.28, 0.10],
      ambientIntensity: 0.08,
      clearcoat: 0.08,
      clearcoatRoughness: 0.62,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'soviet_radar',
    label: 'Soviet Radar Tower',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/radar-tower.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/radar-tower.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/radar-tower.lod1.glb', import.meta.url).href, minDistance: 86 },
    ],
    widthScale: 0.92,
    depthScale: 0.92,
    heightScale: 0.78,
    creaseAngle: 38,
    proceduralParts: 'none',
    accessory: 'soviet-radar-array',
    style: {
      color: [0.82, 0.88, 0.66],
      metalness: 0.24,
      roughness: 0.68,
      normalScale: 1.35,
      ambient: [0.30, 0.28, 0.10],
      ambientIntensity: 0.08,
      clearcoat: 0.08,
      clearcoatRoughness: 0.62,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'soviet_tech',
    label: 'Soviet Proving Ground',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/proving-ground.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/proving-ground.shadow.glb', import.meta.url).href,
    widthScale: 0.92,
    depthScale: 0.92,
    heightScale: 0.94,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [0.92, 0.96, 0.78],
      metalness: 0.23,
      roughness: 0.69,
      normalScale: 1.34,
      ambient: [0.36, 0.34, 0.15],
      ambientIntensity: 0.12,
      clearcoat: 0.07,
      clearcoatRoughness: 0.66,
      envMapIntensity: 1.10,
    },
  },
  {
    key: 'soviet_commandpost',
    label: 'Soviet Command Bunker',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/command-bunker.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/command-bunker.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/command-bunker.lod1.glb', import.meta.url).href, minDistance: 86 },
    ],
    widthScale: 0.92,
    depthScale: 0.92,
    heightScale: 0.94,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [0.90, 0.94, 0.76],
      metalness: 0.23,
      roughness: 0.70,
      normalScale: 1.32,
      ambient: [0.34, 0.32, 0.14],
      ambientIntensity: 0.11,
      clearcoat: 0.06,
      clearcoatRoughness: 0.68,
      envMapIntensity: 1.08,
    },
  },
  {
    key: 'soviet_depot',
    label: 'Soviet Repair Depot',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/repair-depot.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/repair-depot.shadow.glb', import.meta.url).href,
    widthScale: 0.92,
    depthScale: 0.92,
    heightScale: 0.94,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [0.92, 0.96, 0.78],
      metalness: 0.23,
      roughness: 0.69,
      normalScale: 1.32,
      ambient: [0.36, 0.34, 0.15],
      ambientIntensity: 0.12,
      clearcoat: 0.07,
      clearcoatRoughness: 0.66,
      envMapIntensity: 1.10,
    },
  },
  {
    key: 'soviet_subpen',
    label: 'Soviet Naval Pen',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/naval-pen.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/naval-pen.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/naval-pen.lod1.glb', import.meta.url).href, minDistance: 86 },
    ],
    widthScale: 0.94,
    depthScale: 0.94,
    heightScale: 0.94,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [0.92, 0.96, 0.78],
      metalness: 0.23,
      roughness: 0.69,
      normalScale: 1.32,
      ambient: [0.36, 0.34, 0.15],
      ambientIntensity: 0.12,
      clearcoat: 0.07,
      clearcoatRoughness: 0.66,
      envMapIntensity: 1.10,
    },
  },
  {
    key: 'soviet_nuke',
    label: 'Soviet Nuclear Missile Silo',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/nuclear-silo.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/nuclear-silo.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/nuclear-silo.lod1.glb', import.meta.url).href, minDistance: 86 },
    ],
    widthScale: 0.94,
    depthScale: 0.94,
    heightScale: 0.94,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [0.94, 0.98, 0.80],
      metalness: 0.23,
      roughness: 0.68,
      normalScale: 1.32,
      ambient: [0.38, 0.36, 0.16],
      ambientIntensity: 0.12,
      clearcoat: 0.07,
      clearcoatRoughness: 0.65,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'soviet_curtain',
    label: 'Soviet Ironclad Field',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/ironclad-field.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/ironclad-field.shadow.glb', import.meta.url).href,
    widthScale: 0.94,
    depthScale: 0.94,
    heightScale: 0.94,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [0.94, 0.98, 0.80],
      metalness: 0.23,
      roughness: 0.68,
      normalScale: 1.32,
      ambient: [0.38, 0.36, 0.16],
      ambientIntensity: 0.12,
      clearcoat: 0.07,
      clearcoatRoughness: 0.65,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'soviet_silo',
    label: 'Soviet Ore Silo',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/ore-silo.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/ore-silo.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/ore-silo.lod1.glb', import.meta.url).href, minDistance: 86 },
    ],
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.90,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [0.82, 0.88, 0.66],
      metalness: 0.24,
      roughness: 0.68,
      normalScale: 1.35,
      ambient: [0.30, 0.28, 0.10],
      ambientIntensity: 0.08,
      clearcoat: 0.08,
      clearcoatRoughness: 0.62,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'soviet_power',
    label: 'Soviet Tesla Reactor',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/tesla-reactor.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/tesla-reactor.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/tesla-reactor.lod1.glb', import.meta.url).href, minDistance: 82 },
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/tesla-reactor.lod2.glb', import.meta.url).href, minDistance: 116 },
    ],
    widthScale: 0.92,
    depthScale: 0.70,
    heightScale: 0.92,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [1.08, 1.10, 0.92],
      metalness: 0.24,
      roughness: 0.68,
      normalScale: 1.35,
      ambient: [0.38, 0.40, 0.20],
      ambientIntensity: 0.13,
      clearcoat: 0.08,
      clearcoatRoughness: 0.62,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'soviet_flametower',
    label: 'Soviet Flame Tower',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/flame-tower.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/flame-tower.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/soviets/derived/flame-tower.lod1.glb', import.meta.url).href, minDistance: 94 },
    ],
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.94,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [0.92, 0.96, 0.78],
      metalness: 0.22,
      roughness: 0.70,
      normalScale: 1.30,
      ambient: [0.36, 0.32, 0.14],
      ambientIntensity: 0.12,
      clearcoat: 0.06,
      clearcoatRoughness: 0.68,
      envMapIntensity: 1.08,
    },
  },
  {
    key: 'soviet_sentry',
    label: 'Soviet Sentry Gun',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/sentry-gun.glb', import.meta.url).href,
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.94,
    yawDeg: 90,
    creaseAngle: 38,
    proceduralParts: 'none',
    movingTurret: {
      bodyName: 'body',
      turretName: 'turret',
      sourcePivotY: -0.035,
      muzzle: [0, 0.66, 0.50],
    },
    style: {
      color: [0.90, 0.94, 0.76],
      metalness: 0.24,
      roughness: 0.68,
      normalScale: 1.32,
      ambient: [0.34, 0.30, 0.12],
      ambientIntensity: 0.11,
      clearcoat: 0.07,
      clearcoatRoughness: 0.66,
      envMapIntensity: 1.10,
    },
  },
  {
    key: 'soviet_tesla',
    label: 'Soviet Tesla Coil',
    url: new URL('../../../../packages/assets/game/buildings/soviets/compressed/tesla-coil.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/soviets/derived/tesla-coil.shadow.glb', import.meta.url).href,
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.96,
    creaseAngle: 38,
    proceduralParts: 'none',
    style: {
      color: [0.98, 1.02, 0.84],
      metalness: 0.25,
      roughness: 0.66,
      normalScale: 1.34,
      ambient: [0.36, 0.34, 0.16],
      ambientIntensity: 0.12,
      clearcoat: 0.07,
      clearcoatRoughness: 0.64,
      envMapIntensity: 1.12,
    },
  },
];

/**
 * First Allied production wave. These are complete visual replacements: the
 * procedural models remain load-failure fallbacks and socket authorities, but
 * none of their visible shell is mixed into the imported body.
 */
const IMPORTED_ALLIED_STRUCTURES: readonly ImportedStructureSpec[] = [
  {
    key: 'allied_conyard',
    label: 'Allied Construction Yard',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/construction-yard.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/construction-yard.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/allies/derived/construction-yard.lod1.glb', import.meta.url).href, minDistance: 78 },
    ],
    widthScale: 0.92,
    depthScale: 0.92,
    heightScale: 0.94,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.90, 0.94, 1.00],
      metalness: 0.14,
      roughness: 0.56,
      normalScale: 1.28,
      ambient: [0.16, 0.24, 0.38],
      ambientIntensity: 0.08,
      clearcoat: 0.12,
      clearcoatRoughness: 0.48,
      envMapIntensity: 1.08,
    },
  },
  {
    key: 'allied_power',
    label: 'Allied Power Plant',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/power-plant.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/power-plant.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/allies/derived/power-plant.lod1.glb', import.meta.url).href, minDistance: 86 },
    ],
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.94,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.90, 0.94, 1.00],
      metalness: 0.18,
      roughness: 0.54,
      normalScale: 1.25,
      ambient: [0.14, 0.26, 0.42],
      ambientIntensity: 0.09,
      clearcoat: 0.14,
      clearcoatRoughness: 0.46,
      envMapIntensity: 1.10,
    },
  },
  {
    key: 'allied_barracks',
    label: 'Allied Barracks',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/barracks.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/barracks.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/allies/derived/barracks.lod1.glb', import.meta.url).href, minDistance: 86 },
      { url: new URL('../../../../packages/assets/game/buildings/allies/derived/barracks.lod2.glb', import.meta.url).href, minDistance: 116 },
    ],
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.92,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.92, 0.96, 1.00],
      metalness: 0.12,
      roughness: 0.60,
      normalScale: 1.30,
      ambient: [0.16, 0.24, 0.38],
      ambientIntensity: 0.08,
      clearcoat: 0.10,
      clearcoatRoughness: 0.52,
      envMapIntensity: 1.06,
    },
  },
  {
    key: 'allied_refinery',
    label: 'Allied Ore Refinery',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/ore-refinery.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/ore-refinery.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/allies/derived/ore-refinery.lod1.glb', import.meta.url).href, minDistance: 78 },
    ],
    widthScale: 0.94,
    depthScale: 0.90,
    heightScale: 0.94,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.90, 0.94, 1.00],
      metalness: 0.17,
      roughness: 0.57,
      normalScale: 1.28,
      ambient: [0.14, 0.25, 0.40],
      ambientIntensity: 0.09,
      clearcoat: 0.12,
      clearcoatRoughness: 0.48,
      envMapIntensity: 1.08,
    },
  },
  {
    key: 'allied_warfactory',
    label: 'Allied War Factory',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/war-factory.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/war-factory.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/allies/derived/war-factory.lod1.glb', import.meta.url).href, minDistance: 78 },
    ],
    widthScale: 0.94,
    depthScale: 0.92,
    heightScale: 0.94,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.90, 0.94, 1.00],
      metalness: 0.18,
      roughness: 0.55,
      normalScale: 1.28,
      ambient: [0.14, 0.25, 0.40],
      ambientIntensity: 0.09,
      clearcoat: 0.13,
      clearcoatRoughness: 0.46,
      envMapIntensity: 1.10,
    },
  },
  {
    key: 'allied_radar',
    label: 'Allied Radar Dome',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/radar-dome.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/radar-dome.shadow.glb', import.meta.url).href,
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.94,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.92, 0.96, 1.00],
      metalness: 0.16,
      roughness: 0.55,
      normalScale: 1.26,
      ambient: [0.14, 0.25, 0.40],
      ambientIntensity: 0.09,
      clearcoat: 0.13,
      clearcoatRoughness: 0.47,
      envMapIntensity: 1.08,
    },
  },
  {
    key: 'allied_tech',
    label: 'Allied Tech Centre',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/tech-centre.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/tech-centre.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/allies/derived/tech-centre.lod1.glb', import.meta.url).href, minDistance: 90 },
    ],
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.94,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.92, 0.96, 1.00],
      metalness: 0.18,
      roughness: 0.53,
      normalScale: 1.28,
      ambient: [0.13, 0.27, 0.44],
      ambientIntensity: 0.10,
      clearcoat: 0.14,
      clearcoatRoughness: 0.45,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'allied_commandpost',
    label: 'Allied Command Post',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/command-post.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/command-post.shadow.glb', import.meta.url).href,
    widthScale: 0.88,
    depthScale: 0.88,
    heightScale: 0.94,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.92, 0.96, 1.00],
      metalness: 0.16,
      roughness: 0.57,
      normalScale: 1.24,
      ambient: [0.14, 0.25, 0.40],
      ambientIntensity: 0.09,
      clearcoat: 0.12,
      clearcoatRoughness: 0.49,
      envMapIntensity: 1.08,
    },
  },
  {
    key: 'allied_depot',
    label: 'Allied Repair Depot',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/repair-depot.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/repair-depot.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/allies/derived/repair-depot.lod1.glb', import.meta.url).href, minDistance: 88 },
    ],
    widthScale: 0.94,
    depthScale: 0.92,
    heightScale: 0.92,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.90, 0.95, 1.00],
      metalness: 0.19,
      roughness: 0.58,
      normalScale: 1.30,
      ambient: [0.13, 0.24, 0.39],
      ambientIntensity: 0.09,
      clearcoat: 0.11,
      clearcoatRoughness: 0.50,
      envMapIntensity: 1.08,
    },
  },
  {
    key: 'allied_navalyard',
    label: 'Allied Naval Yard',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/naval-yard.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/naval-yard.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/allies/derived/naval-yard.lod1.glb', import.meta.url).href, minDistance: 82 },
    ],
    widthScale: 0.95,
    depthScale: 0.95,
    heightScale: 0.92,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.90, 0.95, 1.00],
      metalness: 0.20,
      roughness: 0.58,
      normalScale: 1.30,
      ambient: [0.12, 0.24, 0.39],
      ambientIntensity: 0.09,
      clearcoat: 0.11,
      clearcoatRoughness: 0.50,
      envMapIntensity: 1.08,
    },
  },
  {
    key: 'allied_chrono',
    label: 'Allied Displacement Ring',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/displacement-ring.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/displacement-ring.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/allies/derived/displacement-ring.lod1.glb', import.meta.url).href, minDistance: 86 },
    ],
    widthScale: 0.94,
    depthScale: 0.94,
    heightScale: 0.96,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.91, 0.96, 1.00],
      metalness: 0.19,
      roughness: 0.52,
      normalScale: 1.28,
      ambient: [0.13, 0.28, 0.46],
      ambientIntensity: 0.10,
      clearcoat: 0.14,
      clearcoatRoughness: 0.44,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'allied_weather',
    label: 'Allied Weather Control Device',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/weather-device.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/weather-device.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/allies/derived/weather-device.lod1.glb', import.meta.url).href, minDistance: 86 },
    ],
    widthScale: 0.94,
    depthScale: 0.94,
    heightScale: 0.96,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.91, 0.96, 1.00],
      metalness: 0.18,
      roughness: 0.54,
      normalScale: 1.28,
      ambient: [0.13, 0.27, 0.45],
      ambientIntensity: 0.10,
      clearcoat: 0.14,
      clearcoatRoughness: 0.46,
      envMapIntensity: 1.12,
    },
  },
  {
    key: 'allied_silo',
    label: 'Allied Ore Silo',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/ore-silo.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/ore-silo.shadow.glb', import.meta.url).href,
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.94,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.90, 0.95, 1.00],
      metalness: 0.16,
      roughness: 0.57,
      normalScale: 1.24,
      ambient: [0.13, 0.26, 0.43],
      ambientIntensity: 0.09,
      clearcoat: 0.12,
      clearcoatRoughness: 0.48,
      envMapIntensity: 1.08,
    },
  },
  {
    key: 'allied_pillbox',
    label: 'Allied Pillbox',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/pillbox.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/allies/derived/pillbox.shadow.glb', import.meta.url).href,
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.94,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    style: {
      color: [0.92, 0.96, 1.00],
      metalness: 0.16,
      roughness: 0.61,
      normalScale: 1.30,
      ambient: [0.14, 0.25, 0.40],
      ambientIntensity: 0.09,
      clearcoat: 0.09,
      clearcoatRoughness: 0.54,
      envMapIntensity: 1.06,
    },
  },
  {
    key: 'allied_aa',
    label: 'Allied AA Battery',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/aa-battery.glb', import.meta.url).href,
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.94,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    movingTurret: {
      bodyName: 'body',
      turretName: 'turret',
      sourcePivotY: -0.14,
      muzzle: [0, 0.74, 0.50],
    },
    style: {
      color: [0.92, 0.96, 1.00],
      metalness: 0.19,
      roughness: 0.58,
      normalScale: 1.30,
      ambient: [0.13, 0.26, 0.42],
      ambientIntensity: 0.09,
      clearcoat: 0.10,
      clearcoatRoughness: 0.51,
      envMapIntensity: 1.08,
    },
  },
  {
    key: 'allied_prismtower',
    label: 'Allied Refractor Tower',
    url: new URL('../../../../packages/assets/game/buildings/allies/compressed/refractor-tower.glb', import.meta.url).href,
    widthScale: 0.88,
    depthScale: 0.88,
    heightScale: 0.97,
    creaseAngle: 42,
    shadowInset: 0.90,
    proceduralParts: 'none',
    movingTurret: {
      bodyName: 'body',
      turretName: 'head',
      sourcePivotY: 0.43,
      muzzle: [0, 0.98, 0],
    },
    style: {
      color: [0.92, 0.97, 1.00],
      metalness: 0.18,
      roughness: 0.56,
      normalScale: 1.32,
      ambient: [0.12, 0.29, 0.48],
      ambientIntensity: 0.10,
      clearcoat: 0.11,
      clearcoatRoughness: 0.49,
      envMapIntensity: 1.10,
    },
  },
  {
    key: 'allied_airbase',
    label: 'Allied Strategic Airbase',
    url: new URL(
      '../../../../packages/assets/game/buildings/allies/compressed/strategic-airbase.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/buildings/allies/derived/strategic-airbase.shadow.glb', import.meta.url,
    ).href,
    lods: [
      {
        url: new URL(
          '../../../../packages/assets/game/buildings/allies/derived/strategic-airbase.lod1.glb', import.meta.url,
        ).href,
        minDistance: 86,
      },
    ],
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.72,
    creaseAngle: 42,
    lodCreaseAngle: 44,
    shadowInset: 0.94,
    proceduralParts: 'none',
    style: {
      color: [0.94, 0.97, 1.00],
      metalness: 0.16,
      roughness: 0.58,
      normalScale: 1.28,
      ambient: [0.13, 0.27, 0.46],
      ambientIntensity: 0.10,
      clearcoat: 0.12,
      clearcoatRoughness: 0.50,
      envMapIntensity: 1.10,
    },
  },
  {
    key: 'soviet_airbase',
    label: 'Soviet Heavy Aviation Works',
    url: new URL(
      '../../../../packages/assets/game/buildings/soviets/compressed/heavy-aviation-works.glb', import.meta.url,
    ).href,
    shadowUrl: new URL(
      '../../../../packages/assets/game/buildings/soviets/derived/heavy-aviation-works.shadow.glb', import.meta.url,
    ).href,
    lods: [
      {
        url: new URL(
          '../../../../packages/assets/game/buildings/soviets/derived/heavy-aviation-works.lod1.glb', import.meta.url,
        ).href,
        minDistance: 86,
      },
      {
        url: new URL(
          '../../../../packages/assets/game/buildings/soviets/derived/heavy-aviation-works.lod2.glb', import.meta.url,
        ).href,
        minDistance: 126,
      },
    ],
    widthScale: 0.90,
    depthScale: 0.90,
    heightScale: 0.68,
    creaseAngle: 42,
    lodCreaseAngle: 44,
    shadowInset: 0.94,
    proceduralParts: 'none',
    style: {
      // Meshy's natural atlas is intentionally gunmetal-dark. Lift its diffuse
      // response to the established Soviet olive range so the four bays stay
      // readable at RTS distance without flattening the red service accents.
      color: [0.78, 0.80, 0.68],
      metalness: 0.24,
      roughness: 0.68,
      normalScale: 1.30,
      ambient: [0.26, 0.23, 0.14],
      ambientIntensity: 0.10,
      clearcoat: 0.04,
      clearcoatRoughness: 0.72,
      envMapIntensity: 0.82,
    },
  },
];

/**
 * Capturable civic infrastructure keeps one neutral visual identity after its
 * owner changes. These assets intentionally live in the shared building system
 * and register through FACTION_ANY; putting them in an army module would make a
 * hospital repaint itself when an engineer takes it.
 */
const IMPORTED_CIVILIAN_STRUCTURES: readonly ImportedStructureSpec[] = [
  {
    key: 'civ_derrick',
    label: 'Civilian Oil Derrick',
    url: new URL('../../../../packages/assets/game/buildings/civilian/compressed/oil-derrick.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/civilian/derived/oil-derrick.shadow.glb', import.meta.url).href,
    widthScale: 0.94,
    depthScale: 0.94,
    heightScale: 0.98,
    creaseAngle: 40,
    shadowInset: 0.92,
    proceduralParts: 'none',
    style: {
      color: [0.88, 0.82, 0.72],
      metalness: 0.18,
      roughness: 0.76,
      normalScale: 1.24,
      ambient: [0.16, 0.13, 0.08],
      ambientIntensity: 0.07,
      clearcoat: 0.02,
      clearcoatRoughness: 0.88,
      envMapIntensity: 0.72,
    },
  },
  {
    key: 'civ_hospital',
    label: 'Civilian Hospital',
    url: new URL('../../../../packages/assets/game/buildings/civilian/compressed/hospital.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/civilian/derived/hospital.shadow.glb', import.meta.url).href,
    widthScale: 0.95,
    depthScale: 0.93,
    heightScale: 0.96,
    creaseAngle: 38,
    shadowInset: 0.94,
    proceduralParts: 'none',
    style: {
      color: [0.92, 0.84, 0.76],
      metalness: 0.03,
      roughness: 0.84,
      normalScale: 1.16,
      ambient: [0.10, 0.14, 0.15],
      ambientIntensity: 0.06,
      clearcoat: 0.01,
      clearcoatRoughness: 0.92,
      envMapIntensity: 0.62,
    },
  },
  {
    key: 'civ_apartments',
    label: 'Civilian Apartment Block',
    url: new URL('../../../../packages/assets/game/buildings/civilian/compressed/apartment-block.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/civilian/derived/apartment-block.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/civilian/derived/apartment-block.lod1.glb', import.meta.url).href, minDistance: 94 },
    ],
    widthScale: 0.94,
    depthScale: 0.94,
    heightScale: 0.96,
    creaseAngle: 40,
    lodCreaseAngle: 42,
    shadowInset: 0.94,
    proceduralParts: 'none',
    style: {
      color: [0.95, 0.91, 0.84],
      metalness: 0.03,
      roughness: 0.82,
      normalScale: 1.20,
      ambient: [0.14, 0.12, 0.10],
      ambientIntensity: 0.06,
      clearcoat: 0.01,
      clearcoatRoughness: 0.92,
      envMapIntensity: 0.62,
    },
  },
  {
    key: 'civ_mine',
    label: 'Civilian Ore Mine',
    url: new URL('../../../../packages/assets/game/buildings/civilian/compressed/ore-mine.glb', import.meta.url).href,
    shadowUrl: new URL('../../../../packages/assets/game/buildings/civilian/derived/ore-mine.shadow.glb', import.meta.url).href,
    lods: [
      { url: new URL('../../../../packages/assets/game/buildings/civilian/derived/ore-mine.lod1.glb', import.meta.url).href, minDistance: 94 },
    ],
    widthScale: 0.94,
    depthScale: 0.92,
    heightScale: 0.96,
    creaseAngle: 40,
    lodCreaseAngle: 42,
    shadowInset: 0.94,
    proceduralParts: 'none',
    style: {
      color: [0.90, 0.82, 0.72],
      metalness: 0.18,
      roughness: 0.76,
      normalScale: 1.18,
      ambient: [0.16, 0.11, 0.08],
      ambientIntensity: 0.06,
      clearcoat: 0.01,
      clearcoatRoughness: 0.92,
      envMapIntensity: 0.65,
    },
  },
];

const IMPORTED_STRUCTURES: readonly ImportedStructureSpec[] = [
  ...IMPORTED_SOVIET_STRUCTURES,
  ...IMPORTED_ALLIED_STRUCTURES,
  ...IMPORTED_CIVILIAN_STRUCTURES,
];

/** Dock structures cannot be placed when the scenario declares no sea. */
const SEA_ONLY_STRUCTURE_KEYS: ReadonlySet<string> = new Set([
  'allied_navalyard',
  'soviet_subpen',
]);

let importedSurfaceMask: THREE.DataTexture | null = null;
let importedShadowOnlyMaterial: THREE.MeshBasicMaterial | null = null;
const importedRuntimeMaterials = new Set<THREE.Material>();
const importedRuntimeTextures = new Set<THREE.Texture>();
const importedStructureLoader = createRuntimeGLTFLoader();
let importedKTX2Loader: KTX2Loader | null = null;
let importedAssetEpoch = 0;
let cancelDeferredWork: (() => void) | null = null;
/** Per-family linear radiance compensation; deliberately not a global grade change. */
const IMPORTED_STRUCTURE_EXPOSURE = 1.10;

export function configureImportedStructureTextureLoader(): void {
  if (importedKTX2Loader !== null) return;
  const { handle } = ctx();
  const renderer = handle.node ?? handle.webgl;
  if (renderer === null) throw new Error('KTX2 support detection requires an initialized renderer');
  const loader = acquireRuntimeKTX2Loader(renderer);
  // KTX2Loader branches at runtime on `isWebGPURenderer`. The structural node
  // renderer type intentionally does not import three/webgpu into this bundle,
  // so the cast bridges types only; both real renderer families are accepted by
  // Three's detectSupport implementation. WebGPU was initialized before
  // bootstrap in main.ts, which is the loader's required ordering.
  importedStructureLoader.setKTX2Loader(loader);
  importedKTX2Loader = loader;
}

/** Dev/benchmark escape hatch; shipping and ordinary dev sessions default on. */
function importedOptimizationEnabled(): boolean {
  if (typeof location === 'undefined') return true;
  return new URLSearchParams(location.search).get('assetopt') !== 'off';
}

/** White means the imported coat may keep its full clearcoat response. */
function surfaceMask(): THREE.DataTexture {
  if (importedSurfaceMask !== null) return importedSurfaceMask;
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.name = 'imported_structure.surfaceMask';
  texture.needsUpdate = true;
  importedSurfaceMask = texture;
  return texture;
}

/**
 * A proxy has to stay visible to both renderers' scene traversal so it reaches
 * their shadow path. Camera layers failed here because WebGL tests the MAIN
 * camera's layers while WebGPU renders the shadow camera as a real pass. The
 * renderer seams now skip `shadowOnly` batches outside a shadow pass; this
 * inert material remains the safe fallback if either seam is unavailable.
 */
function shadowOnlyMaterial(): THREE.MeshBasicMaterial {
  if (importedShadowOnlyMaterial !== null) return importedShadowOnlyMaterial;
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  material.name = 'imported_structure.shadow_only';
  material.colorWrite = false;
  material.depthWrite = false;
  material.depthTest = false;
  material.toneMapped = false;
  material.fog = false;
  importedShadowOnlyMaterial = material;
  importedRuntimeMaterials.add(material);
  return material;
}

function importedStructureMaterial(
  source: THREE.Material,
  spec: ImportedStructureSpec,
): THREE.MeshPhysicalMaterial {
  if (!(source instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`expected MeshStandardMaterial, received ${source.type}`);
  }
  const material = new THREE.MeshPhysicalMaterial({
    color: source.color,
    map: source.map,
    metalness: source.metalness,
    metalnessMap: source.metalnessMap,
    roughness: source.roughness,
    roughnessMap: spec.style.useRoughnessMap === false ? null : source.roughnessMap,
    normalMap: source.normalMap,
    normalScale: source.normalScale,
    aoMap: source.aoMap,
    aoMapIntensity: source.aoMapIntensity,
    emissive: source.emissive,
    emissiveMap: source.emissiveMap,
    emissiveIntensity: source.emissiveIntensity,
    alphaMap: source.alphaMap,
    alphaTest: source.alphaTest,
    opacity: source.opacity,
    transparent: source.transparent,
    side: source.side,
    vertexColors: source.vertexColors,
    flatShading: source.flatShading,
  });
  material.name = `${spec.key}.meshy.pbr`;
  // Meshy's preview uses a bright studio HDRI; its GLB arrives with metallic
  // and roughness factors both at 1.0. In our low Soviet sun that combination
  // kills diffuse colour and flattens the weak baked normal map. Treat the shell
  // as painted armour, retain the authored per-pixel maps, and mix a restrained
  // albedo-fed ambient term back in so olive/red/brass remain faction-readable
  // on the unlit side. Reusing `map` costs no additional texture allocation.
  material.color.setRGB(...spec.style.color).multiplyScalar(IMPORTED_STRUCTURE_EXPOSURE);
  material.metalness = spec.style.metalness;
  material.roughness = spec.style.roughness;
  material.normalScale.setScalar(spec.style.normalScale);
  material.emissiveMap = source.map;
  material.emissive.setRGB(...spec.style.ambient);
  material.emissiveIntensity = spec.style.ambientIntensity * IMPORTED_STRUCTURE_EXPOSURE;
  material.clearcoat = spec.style.clearcoat;
  material.clearcoatRoughness = spec.style.clearcoatRoughness;
  material.envMapIntensity = spec.style.envMapIntensity * IMPORTED_STRUCTURE_EXPOSURE;
  for (const texture of [
    material.map, material.normalMap, material.metalnessMap, material.roughnessMap,
  ]) {
    if (texture === null) continue;
    importedRuntimeTextures.add(texture);
    // The RTS camera views almost every wall and roof obliquely. One-sample
    // filtering was throwing away the 4K detail long before resolution did.
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }
  // Meshy exports this opaque shell as double-sided. Its normals are complete,
  // so drawing backfaces only burns fill rate (especially in the pipe cluster)
  // and makes the dark interior surfaces bleed through at grazing angles.
  material.side = THREE.FrontSide;
  // Geometry-recovery probes legitimately have no UV texture. The runtime
  // shader samples vMapUv for its surface mask, so only install it when the
  // GLB actually publishes a base map.
  if (material.map !== null) applyStructureRuntimeShader(material, surfaceMask(), true);
  importedRuntimeMaterials.add(material);
  return material;
}

function importedFoundationMaterial(
  source: THREE.Material | THREE.Material[],
  spec: ImportedStructureSpec,
): THREE.Material | THREE.Material[] {
  if (Array.isArray(source) || spec.liftFoundation !== true) return source;
  const webgpu = requestedBackend(window.location.search) === 'webgpu';
  const material = new THREE.MeshStandardMaterial({
    // Keep the authored pad grid, Soviet star and warning plate, but lift its
    // near-black atlas with a renderer-neutral diffuse factor instead of an
    // emissive term (whose WebGL and WebGPU ports intentionally differ).
    color: webgpu
      ? new THREE.Color('#30342b')
      : new THREE.Color().setRGB(2.25, 2.18, 1.90),
    // WebGPU's standard-material node adapter currently drops this generated
    // pad atlas but still multiplies its HDR coat, producing a white bloom
    // card. Use the restrained neutral slab on that path; WebGL keeps the atlas.
    map: !webgpu && source instanceof THREE.MeshStandardMaterial ? source.map : null,
    roughness: 0.94,
    metalness: 0.03,
  });
  material.name = `${spec.key}.foundation`;
  material.needsUpdate = true;
  importedRuntimeMaterials.add(material);
  return material;
}

function addStructureFeature(geometry: THREE.BufferGeometry, sinkDepth: number): void {
  const positions = geometry.getAttribute('position');
  const features = new Float32Array(positions.count * 4);
  for (let i = 0; i < positions.count; i++) features[i * 4 + 1] = sinkDepth;
  geometry.setAttribute('aFeature', new THREE.BufferAttribute(features, 4));
}

/**
 * Copy only triangles carrying one procedural feature into a compact geometry.
 *
 * The radar fallback and imported replacement deliberately share the authored
 * scan frame, but not the old shell. Extracting by the shader feature code is
 * more robust than mass names: it preserves the exact atlas UVs, normals,
 * construction-rise distance and spin rate that both render backends consume.
 */
function extractStructureFeatureGeometry(
  source: THREE.BufferGeometry,
  featureCode: number,
): THREE.BufferGeometry {
  const expanded = source.index === null ? source.clone() : source.toNonIndexed();
  const feature = expanded.getAttribute('aFeature');
  if (feature === undefined) throw new Error('structure geometry has no aFeature channel');
  const attributes = Object.entries(expanded.attributes).filter(
    (entry): entry is [string, THREE.BufferAttribute] => entry[1] instanceof THREE.BufferAttribute,
  );
  const values = new Map<string, number[]>();
  for (const [name] of attributes) values.set(name, []);

  for (let tri = 0; tri + 2 < feature.count; tri += 3) {
    if (
      Math.round(feature.getX(tri)) !== featureCode
      || Math.round(feature.getX(tri + 1)) !== featureCode
      || Math.round(feature.getX(tri + 2)) !== featureCode
    ) continue;
    for (let vertex = tri; vertex < tri + 3; vertex++) {
      for (const [name, attribute] of attributes) {
        const target = values.get(name);
        if (target === undefined) continue;
        for (let component = 0; component < attribute.itemSize; component++) {
          target.push(attribute.array[vertex * attribute.itemSize + component] as number);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of attributes) {
    const data = values.get(name);
    if (data === undefined || data.length === 0) continue;
    geometry.setAttribute(
      name,
      new THREE.Float32BufferAttribute(data, attribute.itemSize, attribute.normalized),
    );
  }
  const positions = geometry.getAttribute('position');
  if (positions === undefined || positions.count === 0) {
    expanded.dispose();
    throw new Error(`structure geometry contains no feature ${featureCode} triangles`);
  }
  geometry.name = `structure.feature.${featureCode}`;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  expanded.dispose();
  return geometry;
}

/**
 * A dedicated 32-triangle v3 plinth supplies a dark contact band without
 * restoring the old Construction Yard pad, star, body, crane or accessories.
 * It is deliberately almost flush with the authored shell and uses one quiet,
 * backend-neutral material.
 */
function sovietConyardPlinth(targetWidth: number, targetDepth: number): THREE.BufferGeometry {
  const halfWidth = targetWidth * 0.518;
  const halfDepth = targetDepth * 0.518;
  const corner = Math.min(halfWidth, halfDepth) * 0.075;
  const height = 0.18;
  const ring: readonly (readonly [number, number])[] = [
    [-halfWidth + corner, -halfDepth],
    [halfWidth - corner, -halfDepth],
    [halfWidth, -halfDepth + corner],
    [halfWidth, halfDepth - corner],
    [halfWidth - corner, halfDepth],
    [-halfWidth + corner, halfDepth],
    [-halfWidth, halfDepth - corner],
    [-halfWidth, -halfDepth + corner],
  ];
  const positions: number[] = [];
  for (const y of [-height, 0]) {
    for (const [x, z] of ring) positions.push(x, y, z);
  }
  positions.push(0, 0, 0, 0, -height, 0);
  const topCentre = 16;
  const bottomCentre = 17;
  const indices: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    indices.push(topCentre, next + 8, i + 8);
    indices.push(bottomCentre, i, next);
    indices.push(i, i + 8, next);
    indices.push(next, i + 8, next + 8);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = 'soviet_conyard.v3.foundation_plinth';
  return geometry;
}

function sovietConyardPlinthMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3d4235'),
    metalness: 0.05,
    roughness: 0.96,
  });
  material.name = 'soviet_conyard.v3.foundation_plinth';
  importedRuntimeMaterials.add(material);
  return material;
}

/**
 * Load one approved Meshy structure as an instanced body while retaining the
 * procedural foundation, sockets, construction shader and shadow pass.
 */
export async function loadImportedStructureOverride(
  model: StructureModel,
  spec: ImportedStructureSpec,
  depthMaterial: THREE.Material | undefined = buildingLibrary.depthMaterial(),
  progressive = false,
): Promise<KindMesh> {
  const optimize = importedOptimizationEnabled();
  const lodSpecs = optimize ? spec.lods ?? [] : [];
  const shadowUrl = optimize ? spec.shadowUrl : undefined;
  const urls = [
    spec.url,
    ...lodSpecs.map((lod) => lod.url),
    ...(shadowUrl === undefined ? [] : [shadowUrl]),
  ];
  const loaded: Awaited<ReturnType<typeof importedStructureLoader.loadAsync>>[] = [];
  if (progressive) {
    for (const url of urls) {
      await waitForBattlefieldIdle();
      loaded.push(await importedStructureLoader.loadAsync(url));
    }
    await waitForBattlefieldIdle();
  } else {
    loaded.push(...await Promise.all(urls.map((url) => importedStructureLoader.loadAsync(url))));
  }
  const finishConditioning = beginBootSpan('conditioning', 'structure-family', { asset: spec.key });
  let conditioningStatus: 'ok' | 'error' = 'error';
  try {
  const gltf = loaded[0];
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  const findMesh = (name: string): THREE.Mesh | undefined => meshes.find(
    (mesh) => mesh.name.toLowerCase() === name.toLowerCase(),
  );
  const source = spec.movingTurret === undefined ? meshes[0] : findMesh(spec.movingTurret.bodyName);
  const turretSource = spec.movingTurret === undefined
    ? undefined
    : findMesh(spec.movingTurret.turretName);
  const expectedMeshes = spec.movingTurret === undefined ? 1 : 2;
  if (meshes.length !== expectedMeshes || source === undefined || (
    spec.movingTurret !== undefined && turretSource === undefined
  )) {
    throw new Error(
      `expected ${expectedMeshes} Meshy mesh${expectedMeshes === 1 ? '' : 'es'}, received `
      + `${meshes.length} (${meshes.map((mesh) => mesh.name).join(', ')})`,
    );
  }
  if (Array.isArray(source.material)) {
    throw new Error(`expected one Meshy material, received ${source.material.length}`);
  }
  if (turretSource !== undefined && Array.isArray(turretSource.material)) {
    throw new Error(`expected one turret material, received ${turretSource.material.length}`);
  }

  const prepareSourceGeometry = (
    mesh: THREE.Mesh,
    creaseAngle: number | null = spec.creaseAngle ?? null,
  ): THREE.BufferGeometry => {
    let result = mesh.geometry.clone();
    const position = result.getAttribute('position');
    // KHR_mesh_quantization stores positions as normalized integers and puts
    // their dequantizing scale/offset on the node. BufferGeometry.applyMatrix4
    // writes back into the same attribute type; doing that to Int16 clamps the
    // expanded world coordinates to [-1, 1] and shrinks every LOD into a speck.
    // Promote before baking matrixWorld.
    if (!(position instanceof THREE.BufferAttribute && position.array instanceof Float32Array)) {
      const values = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        const offset = i * 3;
        values[offset] = position.getX(i);
        values[offset + 1] = position.getY(i);
        values[offset + 2] = position.getZ(i);
      }
      result.setAttribute('position', new THREE.BufferAttribute(values, 3));
    }
    // WebGPU's node pipeline declares normals and textured UV inputs as float
    // vectors even when GLTFLoader retained normalized integer accessors.
    // Keeping the compact accessor binds a buffer smaller than that declared
    // layout. UVs used to invalidate the command buffer outright; quantized
    // LOD normals survived validation on some adapters but decoded as a nearly
    // black shell when the batch swapped away from its float-normal LOD0.
    promoteGeometryAttributeToFloat32(result, 'normal');
    promoteGeometryAttributeToFloat32(result, 'uv');
    result.applyMatrix4(mesh.matrixWorld);
    if (spec.yawDeg !== undefined) result.rotateY(THREE.MathUtils.degToRad(spec.yawDeg));
    if (creaseAngle !== null) {
      const original = result;
      result = toCreasedNormals(result, THREE.MathUtils.degToRad(creaseAngle));
      original.dispose();
    }
    // Creasing replaces the vertex normals, so the source tangent basis no
    // longer describes this geometry. Generated GLBs also commonly encode it
    // as normalized Int16; Three's WebGPU node pipeline declares tangent as a
    // float4 and would bind a half-sized buffer. Derivative tangents from the
    // final normals/UVs are both correct and renderer-neutral.
    removeStaleTangentAttribute(result);
    result.computeBoundingBox();
    return result;
  };

  let geometry = prepareSourceGeometry(source);
  const turretGeometry = turretSource === undefined ? undefined : prepareSourceGeometry(turretSource);
  const box = geometry.boundingBox?.clone();
  if (box !== undefined && turretGeometry?.boundingBox !== null && turretGeometry?.boundingBox !== undefined) {
    box.union(turretGeometry.boundingBox);
  }
  if (box === undefined) throw new Error('Meshy geometry has no bounds');
  const fitBox = spec.sourceBounds === undefined
    ? box
    : new THREE.Box3(
      new THREE.Vector3(...spec.sourceBounds.min),
      new THREE.Vector3(...spec.sourceBounds.max),
    );
  const size = fitBox.getSize(new THREE.Vector3());
  const centre = fitBox.getCenter(new THREE.Vector3());
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
    throw new Error(`Meshy geometry has invalid size ${size.toArray().join('x')}`);
  }

  // Preserve the generated proportions while fitting the exact gameplay
  // footprint, then lift it enough to read over tanks.
  const targetWidth = model.footprintW * CELL * spec.widthScale;
  const targetDepth = model.footprintH * CELL * spec.depthScale;
  const targetHeight = model.stats.targetHeight * spec.heightScale;
  // Imported materials still carry the WebGL animation injection. On WebGPU
  // that hook is deliberately inert, so RenderBridge performs the identical
  // below-ground rise in the instance matrix instead. This avoids minting a
  // second physical-node pipeline for every imported PBR material at boot.
  const cpuConstructionRise = requestedBackend(window.location.search) === 'webgpu'
    ? targetHeight
    : undefined;

  const fitDerivedGeometry = (
    scene: THREE.Object3D,
    label: string,
    crease: boolean,
  ): THREE.BufferGeometry => {
    scene.updateMatrixWorld(true);
    const derivedMeshes: THREE.Mesh[] = [];
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) derivedMeshes.push(object);
    });
    if (derivedMeshes.length !== 1) {
      throw new Error(`${label} expected one geometry-only mesh, received ${derivedMeshes.length}`);
    }
    const result = prepareSourceGeometry(
      derivedMeshes[0],
      crease ? spec.lodCreaseAngle ?? spec.creaseAngle ?? null : null,
    );
    result.translate(-centre.x, -fitBox.min.y, -centre.z);
    result.scale(targetWidth / size.x, targetHeight / size.y, targetDepth / size.z);
    result.name = `${spec.key}.${label}`;
    result.computeBoundingBox();
    result.computeBoundingSphere();
    addStructureFeature(result, targetHeight);
    return result;
  };

  geometry.translate(-centre.x, -fitBox.min.y, -centre.z);
  geometry.scale(targetWidth / size.x, targetHeight / size.y, targetDepth / size.z);
  geometry.name = `${spec.key}.meshy.body`;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // Imported geometry has no procedural feature channel. Feature code zero is
  // a static body; Y is the distance it must sink while construction is at 0%.
  addStructureFeature(geometry, targetHeight);

  const lods: { geometry: THREE.BufferGeometry; minDistance: number }[] = [];
  for (let index = 0; index < lodSpecs.length; index++) {
    if (progressive) await waitForBattlefieldIdle();
    lods.push({
      geometry: fitDerivedGeometry(loaded[index + 1].scene, `lod${index + 1}`, true),
      minDistance: lodSpecs[index].minDistance,
    });
  }
  if (progressive && shadowUrl !== undefined) await waitForBattlefieldIdle();
  const shadowGeometry = shadowUrl === undefined
    ? undefined
    : fitDerivedGeometry(loaded[1 + lodSpecs.length].scene, 'shadow_proxy', false);
  if (shadowGeometry !== undefined && spec.shadowInset !== undefined) {
    shadowGeometry.scale(spec.shadowInset, spec.shadowInset, spec.shadowInset);
    shadowGeometry.computeBoundingBox();
    shadowGeometry.computeBoundingSphere();
  }

  let importedTurretPivotY: number | undefined;
  if (turretGeometry !== undefined && spec.movingTurret !== undefined) {
    turretGeometry.translate(-centre.x, -fitBox.min.y, -centre.z);
    turretGeometry.scale(targetWidth / size.x, targetHeight / size.y, targetDepth / size.z);
    importedTurretPivotY = (spec.movingTurret.sourcePivotY - fitBox.min.y) * targetHeight / size.y;
    addStructureFeature(turretGeometry, targetHeight);
    turretGeometry.translate(0, -importedTurretPivotY, 0);
    turretGeometry.name = `${spec.key}.meshy.turret`;
    turretGeometry.computeBoundingBox();
    turretGeometry.computeBoundingSphere();
  }

  const procedural = toKindMesh(model);
  const retainedProceduralParts = spec.proceduralParts === 'none'
    ? []
    : spec.proceduralParts === 'foundation-only'
      ? procedural.parts?.filter((part) => part.geometry === model.pad)
      : procedural.parts;
  const proceduralParts = retainedProceduralParts?.map((part) => (
    // Generated pad geometries intentionally have no stable name. Identity is
    // the reliable discriminator; the old name check silently left the near-
    // black procedural atlas beneath imported buildings and read as a void.
    part.geometry === model.pad
      ? { ...part, material: importedFoundationMaterial(part.material, spec) }
      : part
  )) ?? [];
  const material = importedStructureMaterial(source.material, spec);
  if (turretGeometry !== undefined && importedTurretPivotY !== undefined) {
    proceduralParts.push({
      geometry: turretGeometry,
      material,
      y: importedTurretPivotY,
      followsTurret: true,
      constructionRise: cpuConstructionRise,
      castShadow: true,
      customDepthMaterial: depthMaterial,
      receiveShadow: true,
    });
  }
  if (spec.foundation === 'soviet-conyard-plinth') {
    proceduralParts.push({
      geometry: sovietConyardPlinth(targetWidth, targetDepth),
      material: sovietConyardPlinthMaterial(),
      castShadow: false,
      receiveShadow: true,
    });
  }
  if (shadowGeometry !== undefined) {
    proceduralParts.push({
      geometry: shadowGeometry,
      material: shadowOnlyMaterial(),
      constructionRise: cpuConstructionRise,
      castShadow: true,
      customDepthMaterial: depthMaterial,
      receiveShadow: false,
      aoOccluder: false,
      shadowOnly: true,
    });
  }
  if (spec.accessory === 'soviet-radar-array') {
    const array = extractStructureFeatureGeometry(model.body, STRUCTURE_FEATURE.spin);
    array.name = 'soviet_radar.scan_array';
    proceduralParts.push({
      geometry: array,
      material: model.material,
      castShadow: true,
      customDepthMaterial: depthMaterial,
      receiveShadow: true,
    });
  }
  if (spec.accessory === 'soviet-barracks-door') {
    const door = extractStructureFeatureGeometry(model.body, STRUCTURE_FEATURE.door);
    door.name = 'soviet_barracks.sliding_door';
    proceduralParts.push({
      geometry: door,
      material: model.material,
      castShadow: true,
      customDepthMaterial: depthMaterial,
      receiveShadow: true,
    });
  }
  const sockets = spec.movingTurret === undefined
    ? procedural.sockets
    : procedural.sockets?.map((socket) => socket.followsTurret === true
      ? {
        ...socket,
        x: spec.movingTurret!.muzzle[0] * targetWidth,
        y: spec.movingTurret!.muzzle[1] * targetHeight,
        z: spec.movingTurret!.muzzle[2] * targetDepth,
        pivotY: importedTurretPivotY,
      }
      : socket);
  const result: KindMesh = {
    ...procedural,
    geometry,
    lods,
    material,
    constructionRise: cpuConstructionRise,
    castShadow: shadowGeometry === undefined,
    parts: proceduralParts,
    sockets,
    turretPivotY: importedTurretPivotY ?? procedural.turretPivotY,
  };
  conditioningStatus = 'ok';
  return result;
  } finally {
    finishConditioning(conditioningStatus);
  }
}

/** 256 on Low, 512 everywhere else. */
function atlasSizeFor(tier: QualityTier): number {
  const preset = QUALITY_PRESETS[tier] ?? QUALITY_PRESETS[2];
  return Math.min(BUILDING_GREEBLE.atlasSize, Math.max(256, preset.textureSize));
}

/**
 * Imported GLBs spend most of their wait in independent fetch/decode work.
 * Three-at-a-time was chosen before the roster grew past thirty structures and
 * leaves modern desktop cores idle for several waves. Six is the measured
 * ceiling here: broad enough to overlap KTX2/mesh decode, still small enough
 * not to turn a laptop boot into a memory spike. Unknown and low-core clients
 * keep the original conservative width.
 */
function importedStructureConcurrency(): number {
  if (typeof navigator === 'undefined') return 3;
  return (navigator.hardwareConcurrency || 4) >= 8 ? 6 : 3;
}

function palettesFor(faction: StructureFaction) {
  return {
    structure: RA3_STRUCTURE_PALETTE[faction],
    pad: RA3_PAD_PALETTE[faction],
    panelDensity: faction === 'allies'
      ? BUILDING_GREEBLE.panelDensityAllies
      : BUILDING_GREEBLE.panelDensitySoviets,
    seed: faction === 'allies' ? BUILDING_GREEBLE.seedAllies : BUILDING_GREEBLE.seedSoviets,
    padSeed: faction === 'allies' ? BUILDING_GREEBLE.seedPadAllies : BUILDING_GREEBLE.seedPadSoviets,
  };
}

/* ==========================================================================
 * PAD / TERRAIN CONTACT
 * ========================================================================== */

/**
 * Prove the pad skirt is deep enough.
 *
 * A structure is instanced from ONE shared geometry at ONE world Y, so the pad
 * cannot be re-meshed to the ground under it. Instead it is extruded down by
 * `BUILDING_PAD.skirtDepth`, and this measures whether that is actually enough:
 * for every buildable cell it takes the worst height difference across a 3x3
 * cell footprint (12 m, the largest structure in the roster) and reports the
 * maximum. If the answer ever exceeds the skirt, structures on the worst sites
 * would show daylight under one corner — so it is measured, not assumed.
 */
function measurePadContact(terrain: {
  heightAt(x: number, z: number): number;
  isBuildable(cx: number, cz: number): boolean;
}): { worst: number; sampled: number; over: number } {
  const half = 1; // cells either side: a 3x3 footprint
  let worst = 0;
  let sampled = 0;
  let over = 0;
  // Stride 2: 12 m footprints overlap heavily, and this runs at boot.
  for (let cz = half; cz < MAP_CELLS - half; cz += 2) {
    for (let cx = half; cx < MAP_CELLS - half; cx += 2) {
      if (!terrain.isBuildable(cx, cz)) continue;
      const centre = terrain.heightAt((cx + 0.5) * CELL, (cz + 0.5) * CELL);
      let drop = 0;
      for (let dz = -half; dz <= half; dz++) {
        for (let dx = -half; dx <= half; dx++) {
          const h = terrain.heightAt((cx + dx + 0.5) * CELL, (cz + dz + 0.5) * CELL);
          const d = centre - h;
          if (d > drop) drop = d;
        }
      }
      sampled++;
      if (drop > worst) worst = drop;
      if (drop > BUILDING_PAD.skirtDepth) over++;
    }
  }
  return { worst, sampled, over };
}

/* ==========================================================================
 * SHOWCASE
 * ========================================================================== */

function paradeRequested(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).has('parade');
}

/**
 * A deterministic display rack: every structure, one per slot, on a grid
 * pitched at 1.35x the widest. Exists so a visual critic can score silhouette,
 * bevel, team-colour coverage and greeble density from one screenshot without
 * a running match.
 */
function buildParade(scene: THREE.Scene, models: StructureModel[]): THREE.Group {
  const root = new THREE.Group();
  root.name = 'buildingParade';

  let pitch = 0;
  for (const m of models) pitch = Math.max(pitch, m.bounds[0], m.bounds[2]);
  pitch *= 1.35;

  const cols = 6;
  const cx = MAP_SIZE * 0.5, cz = MAP_SIZE * 0.5;
  models.forEach((m, i) => {
    const col = i % cols, row = (i / cols) | 0;
    const obj = m.prototype();
    obj.position.set(
      cx + (col - (cols - 1) * 0.5) * pitch,
      0,
      cz + (row - 1.5) * pitch,
    );
    root.add(obj);
  });

  scene.add(root);
  return root;
}

let paradeRoot: THREE.Group | null = null;

/* ==========================================================================
 * THE SYSTEM
 * ========================================================================== */

export default defineSystem({
  id: 'art.buildings',
  initGroup: 'faction-art',
  renderPhase: RenderPhase.BuildingAnim,
  order: 0,

  async init(): Promise<void> {
    const { sceneRig, loop, world, debug } = ctx();
    const closureEpoch = contentClosureEpoch();
    configureImportedStructureTextureLoader();
    const size = atlasSizeFor(loop.quality);
    const t0 = Date.now();

    // ATLASES FIRST, OFF-THREAD, BEFORE A SINGLE MODEL IS BUILT.
    //
    // The four structure/pad atlases cost ~960 ms of unbroken main-thread time
    // (allies.structure 421, allies.pad 166, soviets.structure 310, soviets.pad
    // 61 — from the boot log), and the loading curtain cannot animate through
    // any of it. This hands all four to the worker pool at once, so they build
    // in parallel on other threads while this one waits.
    //
    // `build` below is UNCHANGED and still fully synchronous: every atlas it
    // asks for is now a cache hit. That is what keeps the R1 gate, the
    // `validateStructure` speckle check and every `atlas.metrics` read working
    // exactly as before — deferring the data would have meant unpicking all of
    // them, and a validation that runs "later, probably" is not a validation.
    //
    // Zero back means no workers on this platform. `build` then generates them
    // inline, at exactly the old cost, which is the only failure mode this has.
    const warmed = await buildingLibrary.prewarm(STRUCTURE_MASS_LISTS, palettesFor, size);

    const built: StructureModel[] = [];
    const failed: string[] = [];
    for (const list of STRUCTURE_MASS_LISTS) {
      try {
        built.push(buildingLibrary.build(list, palettesFor(list.faction), size));
      } catch (err) {
        // One bad mass list must not take the whole roster down with it.
        failed.push(`${list.key}: ${String(err)}`);
      }
    }

    const g = globalThis as unknown as BuildingGlobal;
    g.__vmBuildings = buildingLibrary;

    /* -- hand off to RenderBridge ------------------------------------------ */
    const importedMeshes = new Map<string, KindMesh>();
    // The title backdrop is the game's front window, not a reduced art mode.
    // Load the same authored structures there as in a match so a player never
    // sees the retired procedural family while deciding whether to play.
    const plannedSea = plannedScenario().sea !== null;
    const importedSpecs = IMPORTED_STRUCTURES.filter((spec) => {
      if (!plannedSea && SEA_ONLY_STRUCTURE_KEYS.has(spec.key)) return false;
      return spec.key.startsWith('allied_')
        ? isArtFactionPlanned(Faction.Allies)
        : spec.key.startsWith('soviet_')
          ? isArtFactionPlanned(Faction.Soviets)
          : true;
    });
    const importedDependencies = new Map(importedSpecs.map((spec) => [
      spec.key,
      declareArtAssetFamily({
        domain: 'building',
        faction: originalFactionForModel(spec.key),
        key: spec.key,
        owner: 'art.buildings:structure',
        fallback: 'validated procedural structure with construction shader',
      }),
    ]));
    for (const spec of importedSpecs) {
      if (buildingLibrary.get(spec.key) !== undefined) {
        markArtAssetFamilyFallbackReady(importedDependencies.get(spec.key) ?? [], closureEpoch);
      }
    }
    const loadSpecs = (
      specs: readonly ImportedStructureSpec[],
      progressive = false,
    ) => mapConcurrent(
      specs,
      progressive ? 1 : importedStructureConcurrency(),
      async (spec) => {
        if (progressive) await waitForBattlefieldIdle();
        const dependencyKeys = importedDependencies.get(spec.key) ?? [];
        requestArtAssetFamily(dependencyKeys, 'art.buildings:structure', closureEpoch);
        const model = buildingLibrary.get(spec.key);
        if (model === undefined) return null;
        try {
          const result = [spec.key, await loadImportedStructureOverride(
            model, spec, undefined, progressive,
          )] as const;
          markArtAssetFamilyReady(dependencyKeys, closureEpoch);
          return result;
        } catch (error) {
          // An optional art asset must never make the match unbootable. The
          // validated procedural structure remains the exact fallback.
          console.warn(`[buildings] Meshy ${spec.label} unavailable: ${String(error)}`);
          return null;
        }
      },
    );

    /*
     * An MCV opening has no structures in its first frame. Parsing all 36 current
     * authored GLBs before revealing that frame cost 3.6-3.9 seconds on the
     * desktop cold path. Keep each army's Construction Yard critical (the MCV
     * can deploy immediately), then stream the rest after the match is live.
     * RegisterKindMesh's versioned rebinding upgrades any procedural fallback
     * that appeared in the meantime on the next render frame.
     */
    const fastMcvBoot = plannedScenario().start === 'mcv'
      && !paradeRequested()
      && liveAssetStreamingEnabled();
    const immediateSpecs = fastMcvBoot
      ? importedSpecs.filter((spec) => spec.key.endsWith('_conyard'))
      : importedSpecs;
    const deferredSpecs = fastMcvBoot
      ? importedSpecs.filter((spec) => !spec.key.endsWith('_conyard'))
      : [];
    const importedResults = await loadSpecs(immediateSpecs);
    for (const result of importedResults) {
      if (result !== null) importedMeshes.set(result[0], result[1]);
    }
    debug.setCounter('importedBuildings', importedMeshes.size);
    debug.setCounter('plannedImportedBuildings', importedSpecs.length);
    debug.setCounter('importedAssetOpt', importedOptimizationEnabled() ? 1 : 0);
    debug.setCounter('importedKTX2', importedKTX2Loader === null ? 0 : 1);

    // One KindMesh per model, cached: handing the SAME object to two factions
    // is how the bridge knows they can share one batch.
    const meshes = new Map<string, KindMesh>();
    const meshFor = (key: string): KindMesh | null => {
      const imported = importedMeshes.get(key);
      if (imported !== undefined) return imported;
      const model = buildingLibrary.get(key);
      if (model === undefined) return null;
      let mesh = meshes.get(key);
      if (mesh === undefined) { mesh = toKindMesh(model); meshes.set(key, mesh); }
      return mesh;
    };

    const registrations: Array<{
      faction: Faction | typeof FACTION_ANY;
      key: string;
      defId: number;
    }> = [];
    let registered = 0;
    const register = (faction: Faction | typeof FACTION_ANY, key: string, defId: number): void => {
      const mesh = meshFor(key);
      if (mesh === null) return;
      registerKindMesh(EntityKind.Building, faction, mesh, defId);
      registrations.push({ faction, key, defId });
      registered++;
    };

    // (a) per-faction defaults. Without these every structure spawned before a
    //     def table exists draws the bridge's hazard box.
    register(Faction.Allies, DEFAULT_KEY.allies, -1);
    register(Faction.Soviets, DEFAULT_KEY.soviets, -1);
    // Neutral structures borrow Allied architecture. A third atlas for civilian
    // paint would cost 4 textures and a material for buildings nobody fights
    // over; the cobalt slabs are the price, and they are the smaller error
    // against a hazard-striped box.
    register(Faction.Neutral, DEFAULT_KEY.allies, -1);

    // (b) exact per-def registrations, the moment a def table exists.
    const binding = await resolveDefBinding();
    let bound = 0;
    for (const [contentKey, models] of Object.entries(SHARED_KEYS)) {
      const defId = binding.buildingId[contentKey];
      if (defId === undefined || defId < 0) continue;
      // Every army in ARMY_ORDER, not just the two that BUILD these — the other
      // two reach them by capture, and an unregistered (kind, faction, defId)
      // falls through to that faction's (kind, faction, -1) default, which is a
      // Chapterhouse for the Pact and a Foundry for the Reclamation. Driven off
      // ARMY_ORDER rather than four named lines so a fifth army cannot be
      // forgotten here while `PerArmy` forces the table above to grow.
      for (let i = 0; i < ARMY_ORDER.length; i++) register(ARMY_ORDER[i], models[i], defId);
      // Gaia holds no shared structure it did not inherit; it takes the Allied
      // architecture for the same reason the (kind, Neutral, -1) default does.
      register(Faction.Neutral, models[GAIA_SLOT], defId);
      bound++;
    }
    for (const [contentKey, modelKey] of Object.entries(FACTION_KEYS)) {
      const defId = binding.buildingId[contentKey];
      if (defId === undefined || defId < 0) continue;
      // FACTION_ANY: the content key already decides the army, and registering
      // per faction here would mask the (kind, faction, -1) defaults.
      register(FACTION_ANY, modelKey, defId);
      bound++;
    }

    if (deferredSpecs.length > 0) {
      const epoch = ++importedAssetEpoch;
      cancelDeferredWork = scheduleBattlefieldWork(10, async () => {
        cancelDeferredWork = null;
        const results = await loadSpecs(deferredSpecs, true);
        if (epoch !== importedAssetEpoch) return;
        let loaded = importedMeshes.size;
        for (const result of results) {
          if (result === null) continue;
          const [key, mesh] = result;
          importedMeshes.set(key, mesh);
          loaded++;
          for (const registration of registrations) {
            if (registration.key !== key) continue;
            registerKindMesh(
              EntityKind.Building,
              registration.faction,
              mesh,
              registration.defId,
              true,
            );
          }
        }
        debug.setCounter('importedBuildings', loaded);
        console.info(
          `[buildings] streamed ${results.filter((r) => r !== null).length} authored models`,
        );
      });
    }

    /* -- prove the pads meet the ground ------------------------------------ */
    let padLine = '[buildings] pad contact: no terrain to measure against';
    const terrain = world.terrain;
    if (terrain !== null && terrain !== undefined) {
      const c = measurePadContact(terrain);
      padLine =
        `[buildings] pad contact: worst 12 m relief on a buildable cell is ` +
        `${c.worst.toFixed(2)} m against a ${BUILDING_PAD.skirtDepth.toFixed(2)} m skirt ` +
        `(${c.sampled} sites sampled, ${c.over} over)`;
      if (c.over > 0) {
        console.warn(
          `[buildings] ${c.over} buildable sites have more relief than the pad skirt can ` +
          `bury; raise BUILDING_PAD.skirtDepth to at least ${(c.worst + 0.3).toFixed(2)} m`);
      }
    }

    /* -- the report the critic loop reads ---------------------------------- */
    let tris = 0, parts = 0;
    for (const m of built) { tris += m.stats.triangles; parts += m.stats.parts; }
    console.info(
      `%c[buildings]%c ${built.length}/${STRUCTURE_MASS_LISTS.length} structures, ` +
      `${buildingLibrary.materialCount()} materials, ${tris} tris, ${parts} draw calls if every ` +
      `structure is on screen at once, ${registered} bridge registrations, atlas ${size}px, ` +
      // `warmed` is printed even when it is 0, because 0 is the interesting
      // number: it means the worker offload did not happen and this line's
      // total is ~960 ms larger than it should be. A silent fallback that looks
      // identical to a working one is how an optimisation quietly stops
      // existing — the exact defect docs/SPEC_DRIFT_AUDIT.md catalogues.
      `${warmed} atlas(es) off-thread, ${Date.now() - t0} ms`,
      'color:#fd7', 'color:inherit',
    );
    for (const m of built) console.info(`[buildings] ${formatStructureStats(m.stats)}`);
    for (const a of buildingLibrary.atlasList()) {
      console.info(
        `[buildings] atlas ${a.spec.key}: Sobel ${(a.metrics.paintEdgeCoverage * 100).toFixed(1)}% ` +
        `over the paint tiles, gen ${a.metrics.generateMs} ms`);
    }
    console.info(padLine);
    if (bound === 0) {
      console.warn(
        '[buildings] no building def table resolved, so every structure carries defId -1 and ' +
        'each army draws its Construction Yard for everything. Publishing a DefTables from ' +
        'src/data/** binds all 24 models on the next boot with no change here.');
    }
    for (const f of failed) console.error(`[buildings] REJECTED ${f}`);

    debug.counters.structModels = built.length;
    debug.counters.structDraws = parts;

    const proceduralRosterReady = (faction: Faction): boolean => (
      buildingProviderBindingsReady(binding.tables, faction)
      && STRUCTURE_MASS_LISTS.filter((list) => (
        list.faction === (faction === Faction.Allies ? 'allies' : 'soviets')
      ))
        .every((list) => buildingLibrary.get(list.key) !== undefined)
    );
    if (isArtFactionPlanned(Faction.Allies) && proceduralRosterReady(Faction.Allies)) {
      markContentProviderReady('art-building/1', closureEpoch);
    }
    if (isArtFactionPlanned(Faction.Soviets) && proceduralRosterReady(Faction.Soviets)) {
      markContentProviderReady('art-building/2', closureEpoch);
    }

    if (paradeRequested()) paradeRoot = buildParade(sceneRig.scene, built);
  },

  /**
   * The entire per-frame cost of every animated structure on the map.
   *
   * Construction rise, bay doors, radar sweep, damage soot, interior fire and
   * the selection pulse are all per-instance shader effects driven by this one
   * uniform plus `aState`, which the bridge already writes. Adding a structure
   * to the map adds nothing here.
   */
  frame(r: RenderContext): void {
    buildingTime.value = r.time;
  },

  dispose(): void {
    importedAssetEpoch++;
    cancelDeferredWork?.();
    cancelDeferredWork = null;
    if (paradeRoot !== null) {
      paradeRoot.removeFromParent();
      paradeRoot = null;
    }
    const g = globalThis as unknown as BuildingGlobal;
    delete g.__vmBuildings;
    for (const material of importedRuntimeMaterials) material.dispose();
    importedRuntimeMaterials.clear();
    for (const texture of importedRuntimeTextures) texture.dispose();
    importedRuntimeTextures.clear();
    importedSurfaceMask?.dispose();
    importedSurfaceMask = null;
    importedShadowOnlyMaterial = null;
    if (importedKTX2Loader !== null) releaseRuntimeKTX2Loader();
    importedKTX2Loader = null;
    buildingLibrary.dispose();
  },
});

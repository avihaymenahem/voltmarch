/**
 * ============================================================================
 * VOLTMARCH — src/world/entity-props.system.ts
 * ============================================================================
 * ART FOR SCENARIO-SPAWNED PROPS, CRATES AND WRECKS.
 *
 * THE HOLE THIS FILLS
 * -------------------
 * There are two completely separate populations of scenery in this game and
 * only one of them had art:
 *
 *   1. `src/world/Scatter.ts` — thousands of INSTANCED, non-entity props. It
 *      owns its own meshes and draws them itself. Trees, kerbside cars, grass.
 *      These were always fine.
 *   2. `ScenarioBuilder.spawnProp/spawnWreck` — a few dozen REAL ENTITIES: the
 *      ones that block navigation, get crushed, catch fire and cast a shadow a
 *      unit can hide in. `RenderBridge` draws these, and no module ever
 *      registered a mesh for `EntityKind.Prop`, `.Crate` or `.Wreck` — so every
 *      one of them drew the bridge's yellow hazard-striped placeholder box.
 *      They are all over `shots/01-establishing-base.png`.
 *
 * Nobody owned this seam because it sits exactly between three modules: the
 * scenario spawns them, the prop library can draw them, and the bridge needs
 * the registration. So it is here, in the integration layer.
 *
 * HOW IT BINDS
 * ------------
 * `Scenarios.PROP_DEF_ID` gives every prop content key a stable `defId` in its
 * own 1000+ namespace (see the comment on `PROP_DEF_BASE` for why it is not
 * simply 0..7). We register one `KindMesh` per key at that id. `EntityKind`
 * comes from `FALLBACK_PROPS` so a crate registers as a Crate and a hulk as a
 * Wreck, which is what the bridge keys on first.
 *
 * Wreck ids live in `core/wrecks.ts`: five hull classes and three ruin sizes,
 * each resolved by faction. `defId = -1` remains only as a compatibility
 * fallback for old saves and authored scenarios that predate those ids.
 *
 * COST
 * ----
 * Forty deterministic wreck geometries are prepared at boot: five factions by
 * five hull classes plus five factions by three ruin sizes. Registration is
 * cheap: the bridge allocates a batch only when that exact corpse appears, so
 * an untouched map pays zero wreck draw calls. The set uses the same prop
 * material program as scenery; authored gloss/emissive masks in `aSurface` survive the
 * integration seam, while wreck vertices keep `aSway = 0`. Entity trees share
 * the shader and therefore sway exactly like their scattered twins.
 * ============================================================================
 */

import * as THREE from 'three';
import { nodePath } from '../render/gpu-path';

import { defineSystem } from '../core/loop';
import { EntityKind, Faction, Phase, RenderPhase, type RenderContext } from '../core/types';
import {
  BUILDING_RUBBLE_DEF, RUBBLE_SIZES, VEHICLE_WRECK_DEF, WRECK_CLASSES,
} from '../core/wrecks';
import { ctx } from '../game/context';
import { FALLBACK_PROPS, PROP_DEF_ID } from '../game/Scenarios';
import {
  FACTION_ANY, prewarmKindMesh, registerKindMesh, type KindMesh,
} from '../render/RenderBridge';
import type { PropMaterialSetLike } from '../render/gpu-path';
import { createPropMaterial, PropLibrary, propPalette } from './PropLibrary';
import { buildWreckSet, type WreckFaction, type WreckSet } from '../art/Wrecks';
import {
  IMPORTED_WRECK_CLASSES, loadImportedWreckSet,
  type ImportedWreckSet,
} from '../art/ImportedWreckAssets';
import { isBiomeName, type BiomeName } from './Biomes';
import { getTerrain } from './Terrain';
import type { EnvironmentGeometryFamily } from './FoliageEngine';
import { isArtFactionPlanned } from '../art/boot-plan';
import {
  contentClosureEpoch, declareArtAssetFamily, markArtAssetFamilyFallbackReady,
  markArtAssetFamilyReady, markContentProviderReady,
  requestArtAssetFamily,
} from '../core/content-closure';

/* ==========================================================================
 * CONTENT KEY -> PROP LIBRARY ARCHETYPE
 *
 * Left column: `Scenarios.FALLBACK_PROPS`. Right: `PropLibrary.PROP_DEFS`.
 * A key absent from the right column is built locally below.
 * ========================================================================== */
const LIBRARY_KEY: Readonly<Record<string, string>> = {
  tree: 'tree',
  pine: 'conifer',
  bush: 'bush',
  rock: 'rockCluster',
  boulder: 'boulder',
  barrel: 'barrel',
  crate: 'crateStack',
};

/**
 * The biome the scatter carpet is using, read off the live `Terrain` exactly as
 * `src/world/scatter.system.ts` does, so a scenario boulder and a scattered
 * boulder are never two different greys. Falls back to temperate if terrain has
 * not built yet, which can only happen if the phase ordering below changes.
 */
function activeBiome(): BiomeName {
  const key = getTerrain()?.biomeKey;
  return typeof key === 'string' && isBiomeName(key) ? key : 'temperate';
}

/* ============================================================================
 * MODULE
 * ========================================================================== */

let materials: PropMaterialSetLike | null = null;
let library: PropLibrary | null = null;
let wreckSet: WreckSet | null = null;
let importedWreckSet: ImportedWreckSet | null = null;
let importedWreckEpoch = 0;
let neutralPropDependencyKeys: readonly string[] = [];
let neutralPropDependencyEpoch = 0;

/**
 * Rebind scenario/pickup entities to Scatter's already-loaded asset families.
 * Geometry and materials remain owned by FoliageEngine; these bridge entries
 * add no texture allocation and procedural registrations stay underneath as
 * the synchronous failure fallback.
 */
export function installImportedEntityProps(
  families: ReadonlyMap<string, EnvironmentGeometryFamily>,
): number {
  let registrations = 0;
  for (const [fallbackKey, assetKey] of Object.entries(LIBRARY_KEY)) {
    const family = families.get(assetKey);
    const fallback = FALLBACK_PROPS[fallbackKey];
    const defId = PROP_DEF_ID[fallbackKey];
    const material = family?.lod0.material ?? materials?.material;
    if (family === undefined || fallback === undefined || defId === undefined || material === undefined) {
      continue;
    }
    const mesh: KindMesh = {
      geometry: family.lod0.geometry,
      material,
      castShadow: true,
      receiveShadow: true,
      customDepthMaterial: material.userData.vmFoliageDepthMaterial instanceof THREE.Material
        ? material.userData.vmFoliageDepthMaterial
        : undefined,
    };
    registerKindMesh(fallback.kind, FACTION_ANY, mesh, defId, true);
    registrations++;
    if (fallbackKey === 'crate') {
      registerKindMesh(fallback.kind, FACTION_ANY, mesh, -1, true);
      registrations++;
    }
  }
  ctx().debug.counters.entityPropImportedModels = registrations;
  return registrations;
}

/**
 * Build the immediate entity-prop fallback before the authored catalogue is
 * ready (and retain it for `?foliage=procedural` or load failure). Imported
 * registration replaces the bridge entries atomically; this library stays
 * owned until system teardown so no in-flight entity can reference disposal.
 */
export function installProceduralEntityProps(): number {
  if (materials === null) return 0;
  neutralPropDependencyEpoch = contentClosureEpoch();
  neutralPropDependencyKeys = declareArtAssetFamily({
    domain: 'neutral-prop', key: 'scenario-props', owner: 'art.entityProps',
    fallback: 'procedural biome prop library',
  });
  const biome = activeBiome();
  library ??= new PropLibrary({
    biome,
    seed: 0x5EED_1A,
    keys: Object.values(LIBRARY_KEY),
  });

  let registrations = 0;
  for (const [fallbackKey, assetKey] of Object.entries(LIBRARY_KEY)) {
    const fallback = FALLBACK_PROPS[fallbackKey];
    const defId = PROP_DEF_ID[fallbackKey];
    const geometry = library.get(assetKey);
    if (fallback === undefined || defId === undefined || geometry === undefined) continue;
    const mesh: KindMesh = {
      geometry: geometry.geometry,
      material: materials.material,
      castShadow: true,
      receiveShadow: true,
      customDepthMaterial: materials.depthMaterial ?? undefined,
    };
    registerKindMesh(fallback.kind, FACTION_ANY, mesh, defId, true);
    registrations++;
    if (fallbackKey === 'crate') {
      registerKindMesh(fallback.kind, FACTION_ANY, mesh, -1, true);
      registrations++;
    }
  }
  ctx().debug.counters.entityPropProceduralModels = registrations;
  console.info(
    `[props] ${registrations} lazy procedural entity-prop fallback(s) ready `
    + `(${library.count} archetypes, ${library.totalTriangles} triangles)`,
  );
  const expectedRegistrations = Object.keys(LIBRARY_KEY).length
    + (Object.hasOwn(LIBRARY_KEY, 'crate') ? 1 : 0);
  if (registrations === expectedRegistrations) {
    markArtAssetFamilyFallbackReady(neutralPropDependencyKeys, neutralPropDependencyEpoch);
    markContentProviderReady('neutral-props', neutralPropDependencyEpoch);
  }
  return registrations;
}

export default defineSystem({
  id: 'art.entityProps',
  // Phase.Command / order 45: after `world.terrain` (40) publishes the biome,
  // and long before `game.scenario` (Phase.Cleanup) spawns anything. The bridge
  // rebinds live entities off the placeholder anyway, so this is belt-and-
  // braces rather than load-bearing.
  phase: Phase.Command,
  order: 45,
  renderPhase: RenderPhase.Bridge,

  init(): void {
    const { debug } = ctx();
    const closureEpoch = contentClosureEpoch();
    const assetEpoch = ++importedWreckEpoch;
    const biome = activeBiome();
    const palette = propPalette(biome);

    // One parameter object, two constructors — see the same note in
    // `ore.system.ts`.
    const np = nodePath();
    materials = np !== null ? np.createPropMaterials() : createPropMaterial();
    materials.material.name = 'EntityPropMaterial';

    // Neutral remains the def-id fallback for scenery-authored wrecks. Vehicle
    // deaths bind more specifically by EntityStore faction below.
    wreckSet = buildWreckSet(palette);

    const trackedWreckFactions = [
      Faction.Allies, Faction.Soviets, Faction.Meridian, Faction.Reclaim, Faction.Neutral,
    ].filter((faction) => faction === Faction.Neutral || isArtFactionPlanned(faction));
    const wreckDependencies = new Map(trackedWreckFactions.map((faction) => [
      faction,
      declareArtAssetFamily({
        domain: 'wreck', faction, key: 'vehicle-and-rubble-classes', owner: 'art.entityProps',
        fallback: 'procedural faction wreck and rubble set',
      }),
    ]));
    let registered = 0;

    const register = (
      key: string, geometry: THREE.BufferGeometry, defId: number,
      faction: Faction | typeof FACTION_ANY = FACTION_ANY,
    ): void => {
      const fb = FALLBACK_PROPS[key];
      if (fb === undefined) return;
      const mesh: KindMesh = {
        geometry,
        material: materials!.material,
        castShadow: true,
        receiveShadow: true,
        customDepthMaterial: materials!.depthMaterial ?? undefined,
      };
      registerKindMesh(fb.kind, faction, mesh, defId);
      registered++;
    };

    const wreckFactions: readonly (readonly [Faction, WreckFaction])[] = [
      [Faction.Allies, 'allies'],
      [Faction.Soviets, 'soviets'],
      [Faction.Meridian, 'meridian'],
      [Faction.Reclaim, 'reclaim'],
    ];
    for (const [faction, artFaction] of wreckFactions) {
      for (const cls of WRECK_CLASSES) {
        register('wreck', wreckSet.hulk(artFaction, cls), VEHICLE_WRECK_DEF[cls], faction);
      }
      for (const size of RUBBLE_SIZES) {
        register('wreck', wreckSet.ruin(artFaction, size), BUILDING_RUBBLE_DEF[size], faction);
      }
    }
    // Unknown/neutral owners still get the right size, and scenario-authored
    // legacy wrecks keep their medium fallback.
    for (const cls of WRECK_CLASSES) {
      register('wreck', wreckSet.hulk('neutral', cls), VEHICLE_WRECK_DEF[cls]);
    }
    for (const size of RUBBLE_SIZES) {
      register('wreck', wreckSet.ruin('neutral', size), BUILDING_RUBBLE_DEF[size]);
    }

    const wreckDefId = PROP_DEF_ID.wreck;
    if (wreckDefId !== undefined) {
      const neutral = wreckSet.hulk('neutral', 'medium');
      register('wreck', neutral, wreckDefId);
      // AND at -1 for pre-classification saves and legacy authored content.
      register('wreck', neutral, -1);
    }

    debug.counters.entityPropModels = registered;
    const expectedWreckRegistrations = wreckFactions.length
      * (WRECK_CLASSES.length + RUBBLE_SIZES.length)
      + WRECK_CLASSES.length + RUBBLE_SIZES.length + 2;
    if (registered === expectedWreckRegistrations) {
      for (const keys of wreckDependencies.values()) {
        markArtAssetFamilyFallbackReady(keys, closureEpoch);
      }
      markContentProviderReady('art-wrecks', closureEpoch);
    }
    console.info(
      `%c[props]%c ${registered} wreck registration(s) on the ${biome} palette ` +
      `(${wreckSet.triangles} wreck tris; model props await imported catalogue)`,
      'color:#9c7', 'color:inherit',
    );

    // Load the authored conventional tank hulk after the match is already
    // interactive. Procedural class/faction wrecks stay registered until this
    // resolves and remain the permanent fallback on any asset failure.
    const authoredWreckDependencies = [
      ...(wreckDependencies.get(Faction.Allies) ?? []),
      ...(wreckDependencies.get(Faction.Soviets) ?? []),
      ...(wreckDependencies.get(Faction.Neutral) ?? []),
    ];
    requestArtAssetFamily(
      authoredWreckDependencies, 'art.entityProps:authored-wreck', closureEpoch,
    );
    void loadImportedWreckSet().then(async (imported) => {
      if (assetEpoch !== importedWreckEpoch) {
        imported.dispose();
        return;
      }
      importedWreckSet = imported;
      markArtAssetFamilyReady(authoredWreckDependencies, closureEpoch);
      const { cameraRig, handle } = ctx();
      const renderer = handle.node ?? handle.webgl;
      const warmed = new Set<KindMesh>();
      const warm = async (mesh: KindMesh): Promise<boolean> => {
        if (renderer === null) return false;
        if (warmed.has(mesh)) return true;
        const ok = await prewarmKindMesh(
          EntityKind.Wreck, mesh, renderer, cameraRig.camera,
        );
        if (ok) warmed.add(mesh);
        return ok;
      };
      let overrides = 0;
      for (const cls of IMPORTED_WRECK_CLASSES) {
        const allies = imported.hulk('allies', cls);
        const soviets = imported.hulk('soviets', cls);
        const neutral = imported.hulk('neutral', cls);
        if (!(await warm(allies)) || !(await warm(soviets)) || !(await warm(neutral))) {
          continue;
        }
        registerKindMesh(
          EntityKind.Wreck, Faction.Allies,
          allies, VEHICLE_WRECK_DEF[cls], true,
        );
        registerKindMesh(
          EntityKind.Wreck, Faction.Soviets,
          soviets, VEHICLE_WRECK_DEF[cls], true,
        );
        // Neutral/legacy conventional wrecks use the same hulk. Exact
        // Meridian/Reclaim registrations above still win over this wildcard.
        registerKindMesh(
          EntityKind.Wreck, FACTION_ANY,
          neutral, VEHICLE_WRECK_DEF[cls], true,
        );
        overrides += 3;
      }
      debug.counters.entityPropImportedWreckModels = overrides;
      console.info(
        `[props] ${overrides} authored tank-wreck override(s) ready `
        + `(${imported.triangles} tris each; procedural fallback retained)`,
      );
    }).catch((error: unknown) => {
      if (assetEpoch !== importedWreckEpoch) return;
      debug.counters.entityPropImportedWreckModels = 0;
      console.warn('[props] authored tank wreck unavailable; keeping procedural wrecks', error);
    });
  },

  frame(r: RenderContext): void {
    // Wrecks have aSway=0, but entity trees share this material and retain the
    // same wind/emissive/gloss language as their scattered twins.
    materials?.setTime(r.time);
  },

  dispose(): void {
    importedWreckEpoch++;
    importedWreckSet?.dispose();
    importedWreckSet = null;
    // The bridge's own `clearKindMeshes()` drops the registrations; these are
    // the GPU objects nobody else holds a reference to.
    wreckSet?.dispose();
    wreckSet = null;
    library?.dispose();
    library = null;
    materials?.dispose();
    materials = null;
    neutralPropDependencyKeys = [];
    neutralPropDependencyEpoch = 0;
  },
});

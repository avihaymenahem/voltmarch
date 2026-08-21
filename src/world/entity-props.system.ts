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
 * material program as scenery; authored `aGloss` and `aEmit` now survive the
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
import { FACTION_ANY, registerKindMesh, type KindMesh } from '../render/RenderBridge';
import type { PropMaterialSetLike } from '../render/gpu-path';
import { createPropMaterial, PropLibrary, propPalette } from './PropLibrary';
import { buildWreckSet, type WreckFaction, type WreckSet } from '../art/Wrecks';
import { isBiomeName, type BiomeName } from './Biomes';
import { getTerrain } from './Terrain';

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
    const biome = activeBiome();
    const palette = propPalette(biome);

    // Only the archetypes a scenario can actually ask for. `PropLibrary` bakes
    // everything it is given, and baking 28 to use 7 is 20 ms of nothing.
    const wanted = Object.values(LIBRARY_KEY);
    library = new PropLibrary({ biome, seed: 0x5EED_1A, keys: wanted });

    // One parameter object, two constructors — see the same note in
    // `ore.system.ts`.
    const np = nodePath();
    materials = np !== null ? np.createPropMaterials() : createPropMaterial();
    materials.material.name = 'EntityPropMaterial';

    // Neutral remains the def-id fallback for scenery-authored wrecks. Vehicle
    // deaths bind more specifically by EntityStore faction below.
    wreckSet = buildWreckSet(palette);

    let registered = 0;
    const missing: string[] = [];

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

    for (const key of Object.keys(FALLBACK_PROPS)) {
      const defId = PROP_DEF_ID[key];
      if (defId === undefined) continue;

      if (key === 'wreck') {
        const neutral = wreckSet.hulk('neutral', 'medium');
        register(key, neutral, defId);
        // AND at -1 for pre-classification saves and legacy authored content.
        register(key, neutral, -1);
        continue;
      }

      const libKey = LIBRARY_KEY[key];
      const geo = libKey === undefined ? undefined : library.get(libKey);
      if (geo === undefined) { missing.push(`${key} (wanted "${libKey}")`); continue; }
      register(key, geo.geometry, defId);
      // Crates have exactly one archetype and nothing else spawns them, but a
      // crate dropped by a future pickup system would carry -1; cover it.
      if (FALLBACK_PROPS[key].kind === EntityKind.Crate) register(key, geo.geometry, -1);
    }

    debug.counters.entityPropModels = registered;
    console.info(
      `%c[props]%c ${registered} entity-prop registration(s) on the ${biome} palette ` +
      `(${library.count} library archetypes, ${library.totalTriangles} prop tris, ` +
      `${wreckSet.triangles} wreck tris)`,
      'color:#9c7', 'color:inherit',
    );
    for (const m of missing) {
      console.warn(`[props] no PropLibrary archetype for ${m} — it will draw the hazard box`);
    }
  },

  frame(r: RenderContext): void {
    // Wrecks have aSway=0, but entity trees share this material and retain the
    // same wind/emissive/gloss language as their scattered twins.
    materials?.setTime(r.time);
  },

  dispose(): void {
    // The bridge's own `clearKindMeshes()` drops the registrations; these are
    // the GPU objects nobody else holds a reference to.
    wreckSet?.dispose();
    wreckSet = null;
    library?.dispose();
    library = null;
    materials?.dispose();
    materials = null;
  },
});

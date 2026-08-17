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
 * Wrecks are ALSO registered at `defId = -1`, because `sim/Damage.ts#spawnWreck`
 * allocates the hulk a dead vehicle leaves behind with no def at all. Without
 * that second registration, every kill in the `battle` shot would leave a
 * hazard box on the field.
 *
 * COST
 * ----
 * One `MeshStandardMaterial` and eight small geometries — 8 batches, at most 8
 * extra draw calls, and only for the keys a scenario actually uses. The
 * geometries come from `PropLibrary`, so a scenario boulder is the same object
 * as a scattered boulder and the frame reads as one world rather than two.
 *
 * The material is NOT `createPropMaterial()`. That one carries the wind shader,
 * whose `aSway` attribute is authored per-vertex for a canopy standing still on
 * the ground; an InstancedMesh of them is fine, but the entity population is
 * tens of objects, not thousands, and paying for a second shader program and a
 * per-frame uniform to make a boulder that cannot sway "sway" is not a trade
 * worth making. Flat vertex colours, one program, shared with nothing.
 * ============================================================================
 */

import * as THREE from 'three';
import { nodePath } from '../render/gpu-path';

import { defineSystem } from '../core/loop';
import { EntityKind, Phase } from '../core/types';
import { ctx } from '../game/context';
import { FALLBACK_PROPS, PROP_DEF_ID } from '../game/Scenarios';
import { applyShroudTint } from '../render/FogOfWar';
import { FACTION_ANY, registerKindMesh, type KindMesh } from '../render/RenderBridge';
import { PropLibrary, PropMesh, propPalette, type PropPalette } from './PropLibrary';
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

/* ==========================================================================
 * THE ONE MODEL THE LIBRARY DOES NOT HAVE
 * ========================================================================== */

/**
 * A burnt-out vehicle hulk.
 *
 * `PropLibrary` has no wreck: it dresses a landscape, and a landscape has no
 * dead tanks in it. This is a deliberately COARSE read — at RTS range a hulk
 * has to say "a tank died here" in about four masses and one silhouette break.
 * Chassis, canted turret drum, a barrel pointing at the dirt, and two torn
 * plates thrown clear. Near-black with a rust cast; the fire and smoke come
 * from `EntityFlag.Burning`, which the VFX module already watches for.
 */
function buildWreck(p: PropPalette): THREE.BufferGeometry {
  const m = new PropMesh();
  const charred = '#241F1C';
  const scorched = '#15120F';

  // Hull, sitting low and slightly nose-down like something that dropped.
  m.color(charred).bevel('#3A322C').ao(0.55, 0, 2.6);
  m.box(0, 0.75, 0, 3.1, 1.3, 5.9, 0.22, 0.0);
  // Track skirts, blacker than the hull so the mass reads as two tiers.
  m.color(scorched).bevel('#2C2622');
  m.box(-1.55, 0.5, 0, 0.7, 0.9, 5.4, 0.14, 0.0);
  m.box(1.55, 0.5, 0, 0.7, 0.9, 5.4, 0.14, 0.0);
  // Turret, blown 35 degrees off its ring and tipped back.
  m.color(charred).bevel('#463A32');
  m.cyl(0.15, 1.65, -0.3, 1.35, 1.1, 0.95, 10, 0.14, true, true, 0.6);
  // Barrel, pointing down and out of the frame of the turret it came from.
  m.color(scorched).bevel('#3A322C');
  m.box(1.45, 1.35, -1.55, 0.34, 0.34, 2.9, 0.08, 0.6);
  // Two plates thrown clear. Rust, not char: torn metal shows its own colour.
  m.color(p.rust).bevel('#8A6440');
  m.box(-2.4, 0.12, 1.9, 1.5, 0.16, 1.1, 0.05, 0.9);
  m.box(2.1, 0.1, -2.2, 1.2, 0.14, 0.9, 0.05, -0.5);

  return m.toGeometry('prop.wreck');
}

/* ==========================================================================
 * MODULE
 * ========================================================================== */

let material: THREE.Material | null = null;
let library: PropLibrary | null = null;
let ownedGeometry: THREE.BufferGeometry | null = null;

export default defineSystem({
  id: 'art.entityProps',
  // Phase.Command / order 45: after `world.terrain` (40) publishes the biome,
  // and long before `game.scenario` (Phase.Cleanup) spawns anything. The bridge
  // rebinds live entities off the placeholder anyway, so this is belt-and-
  // braces rather than load-bearing.
  phase: Phase.Command,
  order: 45,

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
    const propParams: THREE.MeshStandardMaterialParameters = {
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.0,
    };
    const np = nodePath();
    if (np !== null) {
      material = np.createShroudTintedStandard(propParams);
      material.name = 'EntityPropMaterial';
    } else {
      const glsl = new THREE.MeshStandardMaterial(propParams);
      glsl.name = 'EntityPropMaterial';
      // Props and wrecks are `isStaticKind`, i.e. drawn from MEMORY inside
      // explored territory — the same category as buildings. Without the
      // self-tint a remembered wreck would sit at full daylight in the fog.
      glsl.onBeforeCompile = (shader) => { applyShroudTint(shader); };
      glsl.customProgramCacheKey = () => 'vm.entityprop.shroud.v1';
      material = glsl;
    }

    ownedGeometry = buildWreck(palette);

    let registered = 0;
    const missing: string[] = [];

    const register = (key: string, geometry: THREE.BufferGeometry, defId: number): void => {
      const fb = FALLBACK_PROPS[key];
      if (fb === undefined) return;
      const mesh: KindMesh = {
        geometry,
        material: material as THREE.Material,
        castShadow: true,
        receiveShadow: true,
      };
      registerKindMesh(fb.kind, FACTION_ANY, mesh, defId);
      registered++;
    };

    for (const key of Object.keys(FALLBACK_PROPS)) {
      const defId = PROP_DEF_ID[key];
      if (defId === undefined) continue;

      if (key === 'wreck') {
        register(key, ownedGeometry, defId);
        // AND at -1: `sim/Damage.ts#spawnWreck` allocates with no def, so every
        // battlefield kill would otherwise leave a hazard box behind.
        register(key, ownedGeometry, -1);
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
      `(${library.count} library archetypes, ${library.totalTriangles} tris)`,
      'color:#9c7', 'color:inherit',
    );
    for (const m of missing) {
      console.warn(`[props] no PropLibrary archetype for ${m} — it will draw the hazard box`);
    }
  },

  dispose(): void {
    // The bridge's own `clearKindMeshes()` drops the registrations; these are
    // the GPU objects nobody else holds a reference to.
    ownedGeometry?.dispose();
    ownedGeometry = null;
    library?.dispose();
    library = null;
    material?.dispose();
    material = null;
  },
});

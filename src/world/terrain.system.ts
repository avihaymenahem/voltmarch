/**
 * ============================================================================
 * VOLTMARCH — src/world/terrain.system.ts
 * ============================================================================
 * The registration shim. All of the work is in Terrain.ts; this file exists to
 * build one, hand it to everybody who needs it, and take the scaffolding down.
 *
 * WHAT IT WIRES
 * -------------
 *  1. `world.terrain` — the `ITerrain` port. Every sim module (combat,
 *     movement, production, harvesting) reaches the ground through this and
 *     never imports Terrain.ts.
 *  2. `cameraRig.setGroundHeightFn` — so the camera focus rides the real
 *     surface instead of the y=0 plane. Without it, panning onto a 20 m mesa
 *     drives the camera through the rock.
 *  3. `setActiveTerrain` — the module-level accessor for the handful of
 *     callers (pathfinding, roads, props, VFX) that need the terrain-specific
 *     extras the port does not carry.
 *  4. Removes the placeholder scenario. `PlaceholderScene.ts` says in its own
 *     header that TerrainModule deletes its ground; the grid helper and the
 *     512 m plane would otherwise z-fight the real surface everywhere the map
 *     is near y=0.
 *
 * ORDER
 * -----
 * `order: 40` inside `Phase.Command` puts this init after the placeholder
 * scenario (which registers first, at order 0, so it can be torn down) and
 * before every other gameplay module, which all sit at order >= 100 or in a
 * later phase. Terrain must exist before anything asks where the ground is.
 *
 * NO `frame()` ON PURPOSE
 * -----------------------
 * The chunks are static meshes with correct bounding spheres, so three.js
 * frustum-culls them for free. A per-frame hook here would be pure overhead
 * and one more place to accidentally allocate.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import { TERRAIN_DEFAULT_BIOME, TERRAIN_SEED } from '../core/config';
import { ctx } from '../game/context';
import { Terrain, getTerrain, setActiveTerrain } from './Terrain';
import { BIOME_NAMES, isBiomeName, type BiomeName } from './Biomes';

/** Read `?biome=desert` so a critic can A/B all four presets from the URL. */
function biomeFromUrl(): BiomeName {
  if (typeof location === 'undefined') return TERRAIN_DEFAULT_BIOME as BiomeName;
  const q = new URLSearchParams(location.search).get('biome');
  if (q !== null && isBiomeName(q)) return q;
  if (q !== null) {
    console.warn(`[terrain] ?biome=${q} is not one of ${BIOME_NAMES.join(', ')}`);
  }
  return TERRAIN_DEFAULT_BIOME as BiomeName;
}

/** Read `?mapseed=` so a bad landform roll can be reproduced or skipped. */
function seedFromUrl(fallback: number): number {
  if (typeof location === 'undefined') return fallback;
  const q = new URLSearchParams(location.search).get('mapseed');
  if (q === null) return fallback;
  const n = Number(q);
  return Number.isFinite(n) ? n | 0 : fallback;
}

let terrain: Terrain | null = null;

export default defineSystem({
  id: 'world.terrain',
  phase: Phase.Command,
  order: 40,

  init(): void {
    const { world, sceneRig, cameraRig, registry, handle } = ctx();

    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

    terrain = new Terrain({
      scene: sceneRig.scene,
      seed: seedFromUrl(TERRAIN_SEED),
      biome: biomeFromUrl(),
      anisotropy: handle.renderer.capabilities.getMaxAnisotropy(),
    });

    setActiveTerrain(terrain);
    world.terrain = terrain;

    // The camera focus point must ride the surface. Bound to the instance
    // method, not the class, so a later `setBiome` keeps working.
    cameraRig.setGroundHeightFn((x, z) => (terrain ? terrain.heightAt(x, z) : 0));

    // Take the scaffolding down. `setPlaceholderGroundVisible(false)` handles
    // the 512 m plane createScene() publishes; removing the placeholder
    // scenario handles its grid helper and gray boxes. Both are no-ops if
    // another module got there first.
    sceneRig.setPlaceholderGroundVisible(false);
    registry.remove('game.placeholderScene');

    const ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    const s = terrain.stats();
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    console.info(
      `%c[terrain]%c ${terrain.biome.name} — ${terrain.triangleCount() | 0} tris in ${ms | 0} ms · ` +
        `${pct(s.passable)} passable (${pct(s.reachable)} of it reachable), ` +
        `${pct(s.buildable)} buildable, ${pct(s.water)} water, ${s.ramps} ramp(s) carved`,
      'color:#7fd', 'color:inherit',
    );
    // A few percent is expected and wanted: pockets under
    // TERRAIN_MIN_REGION_CELLS are decorative ledges nobody should be able to
    // drive onto. Past 5% something real is cut off and the AI will eventually
    // order a squad into it.
    if (s.reachable < 0.95) {
      console.warn(
        `[terrain] ${pct(1 - s.reachable)} of passable ground is stranded off the main ` +
          'landmass. Raise TERRAIN_MAX_RAMPS or lower TERRAIN_MIN_REGION_CELLS in core/config.ts.',
      );
    }
  },

  dispose(): void {
    if (terrain === null) return;
    terrain.dispose();
    if (getTerrain() === terrain) setActiveTerrain(null);
    terrain = null;
  },
});

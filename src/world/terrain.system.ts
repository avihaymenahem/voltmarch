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
 *
 * ORDER
 * -----
 * `order: 40` inside `Phase.Command` puts this init after the scenario
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
import { MAP_SIZE, TERRAIN_DEFAULT_BIOME, TERRAIN_SEED } from '../core/config';
import { ctx } from '../game/context';
import { SKIRMISH_START_OFFSETS } from '../game/Scenarios';
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
      /*
       * RESERVE A SHELF WHERE THE ARMIES ACTUALLY LAND.
       *
       * This option existed and nothing ever passed it, so the generator fell
       * back to `TERRAIN_START_POSITIONS` — a single entry at the map centre.
       * `levelStartAreas()` then flattened, ramped and pocket-filled a perfect
       * 100%-buildable disc 96.5 m from either army, against a guard radius of
       * 54. Both armies stood on ungraded ground, measured at 60-74% buildable
       * with about a third of openings under 60%, while config.ts promised
       * "verified inside the generator, not hoped for".
       *
       * THE CENTRE STAYS, and is listed first. Every `?shot=` fixture builds on
       * the map centre; dropping it would put twelve graded frames on ungraded
       * ground and their structures would relocate via `connectedGround`,
       * moving the shots more than the terrain change itself.
       *
       * The three discs OVERLAP — starts are 96.5 m out and
       * TERRAIN_START_FLAT_RADIUS is 58, so 58 + 58 > 96.5 — which is why this
       * was deferred once as an unverified risk of steps at the seams.
       * `levelStartAreas` mutates the heightfield as it goes, so each disc sees
       * the previous one's flattening and they self-stabilise;
       * `tests/start-shelves.spec.ts` measures the seam directly across four
       * biomes and three seeds rather than trusting that.
       */
      starts: [
        { x: MAP_SIZE * 0.5, z: MAP_SIZE * 0.5 },
        ...SKIRMISH_START_OFFSETS.map((o) => ({
          x: MAP_SIZE * 0.5 + o.dx,
          z: MAP_SIZE * 0.5 + o.dz,
        })),
      ],
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

    const ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    const s = terrain.stats();
    const start = terrain.startReport();
    const areas = terrain.startLocations();
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    console.info(
      `%c[terrain]%c ${terrain.biome.name} — ${terrain.triangleCount() | 0} tris in ${ms | 0} ms · ` +
        `${pct(s.passable)} passable (${pct(s.reachable)} of it reachable), ` +
        `${pct(s.buildable)} buildable, ${pct(s.water)} water, ${s.ramps} ramp(s) carved, ` +
        `${s.regions} region(s), ${s.scenery} cell(s) demoted to scenery`,
      'color:#7fd', 'color:inherit',
    );

    /* -- the spawn guarantee ------------------------------------------------
     * The reported bug ("tanks spawned inside a valley and cant get out") was
     * invisible in the line above, because the map was never cut in half — it
     * was peppered with small pits and the army landed in one. `reachable`
     * stayed above 99% throughout. So the guarantee gets its own line, and the
     * number that matters is `stranded`, which must be 0.
     * -------------------------------------------------------------------- */
    if (start.stranded > 0) {
      console.error(
        `%c[terrain]%c SPAWN GUARANTEE UNMET — ${start.stranded} reserved start cell(s) are not ` +
          'joined to the main landmass. Units placed there will not be able to leave.',
        'color:#f66', 'color:inherit',
      );
    } else if (areas.length > 0) {
      const cost = start.forcedRamps > 0 || start.filled > 0
        ? ` (${start.startRamps} ramp(s), ${start.forcedRamps} forced corridor(s), ${start.filled} pit(s) filled)`
        : start.startRamps > 0 ? ` (${start.startRamps} ramp(s))` : '';
      console.info(
        `%c[terrain]%c spawn guarantee OK — ${areas.length} start area(s) levelled and connected${cost}`,
        'color:#7fd', 'color:inherit',
      );
    }

    // A few percent is expected and wanted: pockets at or above
    // TERRAIN_PRUNE_REGION_CELLS are real mesas and islands a transport may
    // legitimately want, so they keep their passable bits. Past 5% something
    // large is cut off and the AI will eventually order a squad into it.
    if (s.reachable < 0.95) {
      console.warn(
        `[terrain] ${pct(1 - s.reachable)} of passable ground is stranded off the main ` +
          `landmass across ${s.regions} region(s). ensureMajorRegions() carves until the main ` +
          'region holds TERRAIN_MAIN_REGION_SHARE, so getting here means it either ran out of ' +
          `budget (TERRAIN_MAJOR_MAX_RAMPS) or gave up on ${start.majorSkipped} region(s) that ` +
          'no dry corridor can reach — normally islands, which is the correct answer.',
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

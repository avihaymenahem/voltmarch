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
import { ctx } from '../game/context';
import { notePrewarmAdopted, prewarmedTerrain } from '../core/workers/world-warm';
import { Terrain, getTerrain, setActiveTerrain } from './Terrain';
import { plannedTerrainInput } from './terrain-plan';

let terrain: Terrain | null = null;

export default defineSystem({
  id: 'world.terrain',
  phase: Phase.Command,
  order: 40,

  /**
   * ASYNC, AND THE AWAIT IS THE WHOLE POINT.
   *
   * `src/world/world-warm.system.ts` dispatched this map to a worker at
   * module-discovery time, i.e. before `art.buildings` and friends spent ~2.6 s
   * on this thread. So by the time this init runs, the fields are usually
   * already sitting there and the await resolves in a microtask.
   *
   * When they are not — no `Worker`, `?terrainworkers=off`, a job that timed
   * out, a key that does not match — `prewarmedTerrain()` resolves with `null`
   * and `Terrain` generates on this thread exactly as it always did. The boot
   * cannot be slower than it was by more than one job deadline, and
   * `SystemRegistry.init` awaits each module in order, so nothing downstream
   * sees a half-built world either way.
   */
  async init(): Promise<void> {
    const { world, sceneRig, cameraRig, registry, handle } = ctx();

    /*
     * THE CLOCK STARTS BEFORE THE AWAIT, DELIBERATELY.
     *
     * The number this line reports is "how long the boot stopped here", and
     * time spent waiting on a worker stops the boot just as thoroughly as time
     * spent generating. Starting it after the await would report a triumphant
     * 40 ms for a boot that had just sat still for 600, which is the kind of
     * measurement this repo has been burned by before.
     */
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

    const input = plannedTerrainInput();
    const fields = await prewarmedTerrain();

    terrain = new Terrain({
      ...input,
      scene: sceneRig.scene,
      anisotropy: handle.renderer.capabilities.getMaxAnisotropy(),
      fields,
    });
    notePrewarmAdopted('terrain', fields !== null && fields.key === terrain.genKey);

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
    const source = fields !== null && fields.key === terrain.genKey
      ? ` (adopted from a worker, ${fields.generateMs | 0} ms off-thread)`
      : '';
    console.info(
      `%c[terrain]%c ${terrain.biome.name} — ${terrain.triangleCount() | 0} tris in ${ms | 0} ms${source} · ` +
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

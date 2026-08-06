/**
 * ============================================================================
 * VOLTMARCH — src/world/sea.system.ts
 * ============================================================================
 * THE ONE LINE THAT WAS MISSING: hand the scenario's declared shoreline to the
 * terrain generator, before the terrain generates.
 *
 * WHAT WAS BROKEN
 * ---------------
 * `src/game/Scenarios.ts` says, at the top of the file: "The entity half is
 * applied here. The terrain/ore/shore half is DATA: this module never touches
 * the heightfield, because the terrain module owns it." The ore half of that
 * contract is wired (`sim/economy.system.ts` reads `activeScenario().ore`).
 * The SHORE half never was. `ShoreSpec` was published and had zero consumers,
 * `MAP_PRESETS.coast.water` (0.45) was read by nothing, and `BiomeName` has no
 * `coast` member for `Terrain` to have used even if it had asked.
 *
 * So the `naval` fixture generated `temperate` terrain — plus a guaranteed-dry
 * 58 m start shelf at the map centre, which is the exact point the shot frames
 * — and `08-naval-water`, captioned "water as a hero element", photographed a
 * fleet sitting on grass. For its entire life.
 *
 * WHY A WHOLE SYSTEM FOR ONE ASSIGNMENT
 * -------------------------------------
 * Because the ORDER is the load-bearing part, and only a system can state it.
 *
 *   game.scenario      Phase.Cleanup,  order 10 000   (LAST — it needs terrain)
 *   world.terrain      Phase.Command,  order 40
 *   world.sea          Phase.Command,  order 20       <- here
 *
 * `activeScenario()` is therefore unavailable when terrain generates, which is
 * why this reads `plannedScenario()` instead — the URL-derived half of the
 * router, memoised, safe to call from any phase, and already used this way by
 * `world/scatter.system.ts`. And it is a separate file rather than three lines
 * inside `terrain.system.ts` because that file is a registration shim that
 * deliberately knows nothing about scenarios, and because
 * `src/world/Terrain.ts` cannot import from `src/game/` (Scenarios.ts already
 * imports `getTerrain` from it — the cycle would be real).
 *
 * NO `simTick`, NO `frame()`. This runs once, at init, and its only effect is
 * a module-level assignment that the next `Terrain` constructor reads.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import { plannedScenario } from '../game/Scenarios';
import { setPlannedSea } from './Terrain';

export default defineSystem({
  id: 'world.sea',
  phase: Phase.Command,
  // Before `world.terrain` (40). Nothing else in Phase.Command runs this
  // early, and terrain reads the value in its constructor, so anything at or
  // after 40 is too late — silently: the map would simply come out landlocked
  // again, which is the failure mode this file exists to end.
  order: 20,

  init(): void {
    const sea = plannedScenario().sea;
    setPlannedSea(sea);
    if (sea === null) return;
    console.info(
      `%c[sea]%c shoreline through (${sea.x.toFixed(0)}, ${sea.z.toFixed(0)}) ` +
        `normal (${sea.normalX.toFixed(2)}, ${sea.normalZ.toFixed(2)}), ` +
        `${sea.depth.toFixed(1)} m deep over ${sea.shelfMetres} m of shelf ` +
        `— handed to the terrain generator`,
      'color:#7cf', 'color:inherit',
    );
  },

  /**
   * Clear the channel between matches. A stale sea would carve a coast into
   * the next scenario's map, which is the same class of bug as a stale biome:
   * silent, and only visible in a screenshot.
   */
  dispose(): void {
    setPlannedSea(null);
  },
});

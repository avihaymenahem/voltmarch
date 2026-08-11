/**
 * ============================================================================
 * VOLTMARCH — src/world/world-warm.system.ts
 * ============================================================================
 * THE ONE LINE THAT STARTS THE WORLD GENERATION BEFORE THE GAME DOES.
 *
 * Everything happens at MODULE SCOPE, and that is the whole point. `src/game/
 * Systems.ts` globs `**\/*.system.ts` eagerly, so this file is imported before
 * `registry.init()` runs a single module — which is the only window in which
 * dispatching the terrain job buys anything. Doing it inside `init()` would put
 * it after `art.buildings`, `art.faction3`, `art.faction4` and `art.units`
 * (all `Phase.Command` order 0), which is exactly the ~2.6 s of main-thread
 * work the generation is supposed to hide behind.
 *
 * `texture-warm.system.ts` uses the identical trick for the same reason, and
 * says so in its own header.
 *
 * THE `init()` ONLY REPORTS, AND IT RUNS LAST. `Phase.Cleanup` at a very high
 * order puts it after `world.terrain` (Command 40) and `world.water`
 * (Command 60) have both collected their fields, which is the earliest moment
 * the numbers it prints are true. An early `init()` would print two zeroes and
 * read as "the worker did nothing". It also disposes the world worker there,
 * because both jobs are boot-only and a thread held open for the whole match to
 * serve nothing is a thread wasted.
 *
 * WHY THIS LIVES IN `src/world/` AND NOT `src/core/workers/`. It has to read
 * `plannedScenario()` for the shoreline, and `src/core/**` must not import
 * `src/game/**`. `world-warm.ts` next door to the texture pool holds the pool
 * and the promises; this file holds the one call that needs the game layer.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import {
  disposeWorldWorkers, installWorldWorkers, worldWarmReport,
} from '../core/workers/world-warm';

/**
 * MODULE SCOPE ON PURPOSE — see the header. This is a `postMessage` and two
 * promises; no `ctx()`, no GL, no scene.
 */
installWorldWorkers();

/**
 * After every world module, and one below `core.textureWarm`'s
 * `Number.MAX_SAFE_INTEGER` so the texture summary is still the last word.
 */
const NEARLY_LAST = Number.MAX_SAFE_INTEGER - 1;

export default defineSystem({
  id: 'world.warm',
  phase: Phase.Cleanup,
  order: NEARLY_LAST,

  init(): void {
    const r = worldWarmReport();
    disposeWorldWorkers();
    if (r.terrainOff && r.waterOff) return;

    const parts: string[] = [];
    parts.push(r.terrainAdopted
      ? `terrain ${r.terrainMs | 0} ms off-thread`
      : `terrain on the main thread${r.terrainOff ? ' (?terrainworkers=off)' : ''}`);
    parts.push(r.waterAdopted
      ? `water ${r.waterMs | 0} ms off-thread`
      : `water on the main thread${r.waterOff ? ' (?waterworkers=off)' : ''}`);

    console.info(
      `%c[world]%c ${parts.join(', ')}`
      + `${r.reason !== '' ? ` (worker off: ${r.reason})` : ''}`,
      'color:#9cf', 'color:inherit',
    );
  },
});

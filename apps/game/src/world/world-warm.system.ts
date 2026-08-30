/**
 * ============================================================================
 * VOLTMARCH — src/world/world-warm.system.ts
 * ============================================================================
 * THE REPORT AND CLEANUP HALF OF WORLD WORKER PREWARM.
 *
 * `Bootstrap.bootstrap()` starts a fresh prewarm before it constructs the
 * renderer or calls `registry.init()`. That is the only lifetime that works:
 * system modules are evaluated once, while the shell builds many worlds in one
 * page. A module-scope call served the first world and left every later match
 * holding stale keys, so they regenerated on the main thread. It also made the
 * title menu's read-only code prefetch start a throwaway terrain job.
 *
 * `texture-warm.system.ts` follows the same per-bootstrap lifetime for its own
 * pool; its header records why neither pool may return to module scope.
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
  disposeWorldWorkers, worldWarmReport,
} from '../core/workers/world-warm';

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

    /*
     * ORDER MATTERS HERE, and not for readability.
     *
     * `tools/boot-profile.mjs` scrapes this line with
     * `/\[world\][^\n]*?terrain (\d+) ms[^\n]*?water (\d+) ms/`, so the FIELD
     * figures have to come first and in that sequence or the profiler silently
     * reports the tile numbers as the generation numbers. The tile entries are
     * worded `terrain tiles N ms` / `water tiles N ms` precisely so neither can
     * satisfy that pattern — `terrain (\d+)` will not match `terrain tiles`.
     *
     * Two numbers per subsystem rather than a sum, because they answer
     * different questions: the field figure is what a heightfield change moves,
     * the tile figure is what a biome or palette change moves, and adding them
     * would hide either one regressing behind the other improving.
     */
    const parts: string[] = [];
    parts.push(r.terrainAdopted
      ? `terrain ${r.terrainMs | 0} ms off-thread`
      : `terrain on the main thread${r.terrainOff ? ' (?terrainworkers=off)' : ''}`);
    parts.push(r.waterAdopted
      ? `water ${r.waterMs | 0} ms off-thread`
      : `water on the main thread${r.waterOff ? ' (?waterworkers=off)' : ''}`);
    parts.push(r.terrainTexAdopted
      ? `terrain tiles ${r.terrainTexMs | 0} ms off-thread`
      : 'terrain tiles on the main thread');
    parts.push(r.waterTexAdopted
      ? `water tiles ${r.waterTexMs | 0} ms off-thread`
      : `water tiles on the main thread${r.waterOff ? ' (?waterworkers=off)' : ''}`);

    console.info(
      `%c[world]%c ${parts.join(', ')}`
      + `${r.reason !== '' ? ` (worker off: ${r.reason})` : ''}`,
      'color:#9cf', 'color:inherit',
    );
  },
});

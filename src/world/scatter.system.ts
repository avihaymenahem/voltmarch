/**
 * ============================================================================
 * VOLTMARCH — src/world/scatter.system.ts
 * ============================================================================
 * The registration shim for prop scatter. All of the work is in Scatter.ts and
 * PropLibrary.ts; this file exists to build one Scatter, feed it the masks the
 * rest of the boot has produced, and drive its per-frame chunk cull.
 *
 * ORDER — WHY THIS INITS LAST
 * ---------------------------
 * `Phase.Cleanup, order 20000` puts this init after EVERYTHING, and in
 * particular after `game.scenario` (Phase.Cleanup, order 10000). That is
 * deliberate and it is the whole reason the masks work:
 *
 *   - terrain (Phase.Command, order 40) has generated the heightfield, the
 *     pass/water/surface grids and the splat, so `legal()` has real answers;
 *   - the scenario has spawned its bases, so `terrain.isOccupied()` already
 *     covers every structure footprint and `activeScenario()` can tell us
 *     where the ore fields, the shore and the photographed box are;
 *   - unit art has registered its models, so nothing else is going to move.
 *
 * A scatter system that runs early has to guess. This one does not have to.
 *
 * FRAME WORK
 * ----------
 * `RenderPhase.Terrain, order 50` — right after the terrain chunks, well
 * before `RenderPhase.Bridge`. The frame hook does two things: advance the
 * wind clock, and re-cull the 32 m chunk grid. On a still camera the cull
 * short-circuits on a 256-byte compare and nothing is uploaded.
 *
 * URL FLAGS (all optional, all for the critic loop)
 * -------------------------------------------------
 *   ?scatter=off          disable the module entirely
 *   ?scatterdensity=1.6   multiply the density budget
 *   ?scatterseed=1234     reseed placement without touching the terrain seed
 *   ?scatterwind=off      freeze the foliage (for pixel-diffing screenshots)
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase, RenderPhase, EntityKind, EntityFlag, type RenderContext } from '../core/types';
import { MAX_DRAW_CALLS, SCATTER_SEED } from '../core/config';
import { ctx } from '../game/context';
import { activeScenario, plannedScenario } from '../game/Scenarios';
import { getTerrain } from './Terrain';
import { Scatter, getScatter, setActiveScatter } from './Scatter';

declare const globalThis: { __vmScatter?: Scatter } & typeof window;

let scatter: Scatter | null = null;
/** Frozen shots get a fixed wind phase so two captures are pixel-identical. */
let frozenWind = false;

function flag(name: string): string | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get(name);
}

function numFlag(name: string, fallback: number): number {
  const q = flag(name);
  if (q === null) return fallback;
  const n = Number(q);
  return Number.isFinite(n) ? n : fallback;
}

export default defineSystem({
  id: 'world.scatter',
  phase: Phase.Cleanup,
  order: 20000,
  renderPhase: RenderPhase.Terrain,

  init(): void {
    if (flag('scatter') === 'off') {
      console.info('%c[scatter]%c disabled by ?scatter=off', 'color:#7fd', 'color:inherit');
      return;
    }

    const { world, sceneRig, debug } = ctx();
    const terrain = getTerrain();
    if (terrain === null) {
      // Terrain owns the heightfield, the surface splat and the pass grid.
      // Without it every mask would be a guess, and a guessed mask puts trees
      // in the river. Degrade to no props rather than to wrong props.
      console.warn('[scatter] no Terrain — props skipped. Is src/world/terrain.system.ts registered?');
      return;
    }

    const plan = plannedScenario();
    const spec = activeScenario();

    scatter = new Scatter({
      scene: sceneRig.scene,
      terrain,
      biome: terrain.biomeKey,
      seed: numFlag('scatterseed', (plan.seed ^ SCATTER_SEED) >>> 0) >>> 0,
      urban: plan.preset.urban,
      densityScale: plan.preset.scatter * numFlag('scatterdensity', 1),
      preferred: plan.preset.props,
      focus: spec !== null ? spec.framed : null,
      focusBoost: 0.35,
    });

    /* -- masks ------------------------------------------------------------ *
     * `terrain.isOccupied()` already covers structure footprints, so these
     * exclusions are about CLEARANCE, not collision: a base needs room to
     * deploy into, a harvester needs a clear run to the ore, and the build
     * ghost must not be sitting in a hedge.                                  */

    const store = world.store;
    for (let n = 0; n < store.count; n++) {
      const i = store.alive[n];
      if ((store.flags[i] & EntityFlag.Alive) === 0) continue;
      const kind = store.kind[i];
      if (kind === EntityKind.Building) {
        // Bible R-S5: buildings are 3x3 to 6x6 cells. Clear a generous apron so
        // the structure reads against ground, and so a scatter prop never
        // blocks the vehicle exit.
        scatter.addExclusion(store.posX[i], store.posZ[i], Math.max(store.radius[i], 6) + 7);
      } else if (kind === EntityKind.Vehicle || kind === EntityKind.Infantry) {
        scatter.addExclusion(store.posX[i], store.posZ[i], store.radius[i] + 2.5);
      }
    }

    if (spec !== null) {
      for (let i = 0; i < spec.ore.length; i++) {
        const o = spec.ore[i];
        scatter.addExclusion(o.x, o.z, o.radius + 4);
      }
      const pl = spec.placement;
      if (pl !== null) {
        scatter.addExclusionRect(
          pl.cx * 4 - 6, pl.cz * 4 - 6,
          (pl.cx + pl.footprintW) * 4 + 6, (pl.cz + pl.footprintH) * 4 + 6,
        );
      }
    }

    scatter.generate();
    setActiveScatter(scatter);
    globalThis.__vmScatter = scatter;
    frozenWind = flag('scatterwind') === 'off' || (spec !== null && spec.frozen);

    const s = scatter.stats();
    const report = scatter.lastReport;
    console.info(
      `%c[scatter]%c ${terrain.biome.name} — ${s.props} props of ${s.types} types ` +
      `(${s.propsPerHectare.toFixed(0)}/ha over ${(report?.walkableHectares ?? 0).toFixed(1)} ha), ` +
      `${scatter.library.totalTriangles} tris in the library, ` +
      `${(scatter.library.buildMs | 0)} ms to bake + ${(s.generateMs | 0)} ms to place`,
      'color:#7fd', 'color:inherit',
    );
    console.info(
      `%c[scatter]%c adornment ${(s.adornedFraction * 100).toFixed(0)}% ` +
      `(bible §6.6 wants >=55%), ${s.emptyPatches} unadorned patch(es) over 25 m ` +
      '(scorecard #15 wants 0)',
      'color:#7fd', 'color:inherit',
    );

    // Scorecard #15 is weight 3. Say so loudly rather than shipping a plane.
    if (report !== null && !report.passes) {
      console.warn(
        `[scatter] SHIP-BLOCKING RULE FAILED: ${report.emptyPatches.length} walkable patch(es) ` +
        'larger than 25x25 m carry no prop, no decal and no texture variation ' +
        '(bible §6.6 / scorecard #15). Raise SCATTER_COVERAGE.fillPasses or ' +
        'MAP_PRESETS[...].scatter in core/config.ts.',
      );
    }
    if (report !== null && report.adornedFraction < 0.55) {
      console.warn(
        `[scatter] ground adornment is ${(report.adornedFraction * 100).toFixed(0)}%, ` +
        'below the 55% floor in bible §6.6. Terrain surface variation counts toward ' +
        'this too — a single-layer splat puts the whole burden on props.',
      );
    }
    if (s.types * 2 > MAX_DRAW_CALLS * 0.4) {
      console.warn(
        `[scatter] ${s.types} prop types = up to ${s.types * 2} draw calls (colour + shadow) ` +
        `of the ${MAX_DRAW_CALLS} budget. Lower SCATTER_LIMITS.maxTypes if the frame is tight.`,
      );
    }

    debug.setCounter('props', s.props);
    debug.setCounter('propTypes', s.types);
  },

  frame(r: RenderContext): void {
    if (scatter === null) return;
    const { cameraRig, debug } = ctx();
    scatter.update(cameraRig.camera, frozenWind ? 12.34 : r.time);
    debug.setCounter('propsDrawn', scatter.visibleInstances);
    debug.setCounter('propChunks', scatter.visibleChunks);
  },

  dispose(): void {
    if (scatter === null) return;
    scatter.dispose();
    if (getScatter() === scatter) setActiveScatter(null);
    delete globalThis.__vmScatter;
    scatter = null;
  },
});

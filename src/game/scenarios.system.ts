/**
 * ============================================================================
 * VOLTMARCH — src/game/scenarios.system.ts
 * ============================================================================
 * THE SCENARIO SYSTEM — reads the boot flags, builds the fixture, poses the
 * camera, and publishes the spec every other module reads.
 *
 * WHY IT INITS LAST
 * -----------------
 * `phase: Phase.Cleanup` with a very high `order` puts this module at the END
 * of the registry's init sweep (`SystemRegistry.init` sorts by phase, then
 * order, then registration sequence). That matters three times over:
 *
 *   - Terrain must have replaced `world.terrain` before a single building calls
 *     `heightAt` or `markOccupied`, or every structure sits at y = 0 on a
 *     heightfield that has hills in it.
 *   - The def tables and the ModelRegistry must exist before the first spawn,
 *     so entities carry real `defId`s and the bridge draws real meshes.
 *   - `settleTicks` runs the whole simulation forward, which requires every
 *     other system to be alive.
 *
 * WHY IT PRE-ADVANCES THE SIM
 * ---------------------------
 * `?shot=` boots paused (see Bootstrap.start), and `tools/shoot.mjs`'s
 * `advance` only sleeps wall-clock time — with the loop paused that advances
 * nothing. So the "in motion" fixtures (battle, economy, naval) step the sim
 * here instead, through `loop.runHeadless(n)`. Deterministic, instant, and
 * identical on a slow CI box and a fast workstation, which the wall-clock path
 * is not.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase, RenderPhase } from '../core/types';
import type { RenderContext } from '../core/types';
import { DEFAULT_SEED } from '../core/config';
import { DEG2RAD } from '../core/math';
import { ctx } from './context';
import {
  buildScenario,
  clearScenario,
  resolveDefBinding,
  resolveScenarioName,
  type DefBinding,
  type ScenarioSpec,
} from './Scenarios';

/** The stub module Bootstrap registers before discovery runs. */

/* -------------------------------------------------------------------------- */
/* Boot flags                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Read a URL flag. Returns null outside a browser (unit tests, workers) so this
 * module is importable from a node context without touching `location`.
 */
function flag(name: string): string | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get(name);
  return v === null || v === '' ? null : v;
}

function seedFlag(): number {
  const raw = flag('seed');
  if (raw === null) return DEFAULT_SEED;
  const n = Number(raw);
  // A NaN seed would silently make every "deterministic" fixture random.
  return Number.isFinite(n) ? Math.trunc(n) : DEFAULT_SEED;
}

/* -------------------------------------------------------------------------- */

let spec: ScenarioSpec | null = null;

export default defineSystem({
  id: 'game.scenario',
  // Last init, and last of anything that shares Cleanup.
  phase: Phase.Cleanup,
  order: 10_000,
  // A render phase is declared only so the one-shot camera pose can happen on
  // frame 0, after every render module has published its own state.
  renderPhase: RenderPhase.Overlay,

  async init(): Promise<void> {
    const { world, cameraRig, loop, debug, registry } = ctx();

    const name = resolveScenarioName(flag('shot'));
    const seed = seedFlag();

    // A def table may or may not exist yet; either way we get a binding.
    let defs: DefBinding | undefined;
    try {
      defs = await resolveDefBinding();
    } catch (err) {
      console.warn('[scenario] def discovery failed, using fallback content', err);
    }

    spec = buildScenario(world, name, seed, { map: flag('map'), defs });

    console.info(
      `%c[scenario]%c ${spec.name} on ${spec.map} (seed ${spec.seed}) — ` +
        `${spec.entityCount} entities, ${spec.ore.length} ore fields. ${spec.summary}`,
      'color:#7fd', 'color:inherit',
    );

    // Frame the composition. `tools/shoot.mjs` re-poses x/z/distance afterwards
    // through `__VM.focusOn`, but the YAW set here survives — and a yaw of
    // exactly 0 is the "flat axis-aligned table" failure the bible calls out as
    // identity property 3.
    cameraRig.setPose({
      x: spec.camera.x,
      z: spec.camera.z,
      distance: spec.camera.distance,
      yaw: spec.camera.yawDeg * DEG2RAD,
      immediate: true,
    });

    // Run the world forward so "mid-action" fixtures are actually mid-action.
    // Guarded: a sim system that throws must cost us motion, not the frame.
    if (spec.settleTicks > 0) {
      try {
        loop.runHeadless(spec.settleTicks);
        world.spatial.rebuild();
      } catch (err) {
        console.error(`[scenario] settle of ${spec.settleTicks} ticks failed`, err);
      }
    }

    // Publish for the console and for the shot report.
    debug.setCounter('scenarioEntities', spec.entityCount);
    debug.api.registerHook('scenario', () => spec);
  },

  /**
   * The camera rig damps toward its target every frame, and other modules may
   * install a ground-height function after our init ran — which pulls the focus
   * vertically for a frame or two. Re-assert the pose for the first handful of
   * frames so a screenshot taken immediately after `ready()` is framed exactly
   * as authored, then stop touching it so the player can move the camera.
   */
  frame(r: RenderContext): void {
    if (spec === null || r.frame > 4) return;
    const { cameraRig } = ctx();
    cameraRig.setPose({
      x: spec.camera.x,
      z: spec.camera.z,
      distance: spec.camera.distance,
      yaw: spec.camera.yawDeg * DEG2RAD,
      immediate: true,
    });
  },

  dispose(): void {
    spec = null;
    clearScenario();
  },
});

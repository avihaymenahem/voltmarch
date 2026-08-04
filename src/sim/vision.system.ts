/**
 * ============================================================================
 * VOLTMARCH — src/sim/vision.system.ts
 * ============================================================================
 * Owns the lifetime of the vision grid (`src/sim/Vision.ts`) and the shroud
 * overlay (`src/render/FogOfWar.ts`), and wires both into the frame.
 *
 * TWO PHASES, ONE MODULE
 * ----------------------
 *   `Phase.Vision` (1300)          — stamp the grid every VISION_TICK_INTERVAL
 *                                    ticks. Deterministic, viewer-independent.
 *   `RenderPhase.FowUpload` (20)   — smooth the grid into the DataTexture and
 *                                    mask the entities the local player cannot
 *                                    see. Runs BEFORE `RenderPhase.Bridge`
 *                                    (30), which is the whole point: the
 *                                    instancer must see the mask in the same
 *                                    frame it was computed, never a frame late.
 *
 * THE BORROWED FLAG — READ THIS BEFORE CHANGING ANYTHING HERE
 * -----------------------------------------------------------
 * `RenderBridge` skips any entity carrying `EntityFlag.Cloaked`. That flag is
 * the only lever this module has over what gets instanced, and it lives in the
 * simulation's `flags` column — which is shared, deterministic state that must
 * NOT depend on who happens to be looking at the screen.
 *
 * So the flag is BORROWED, not taken. `applyRenderMask(localPlayer)` sets it at
 * `RenderPhase.FowUpload` and records every bit it flipped; a companion system
 * registered at `RenderPhase.Present` (900) puts every one of them back before
 * the frame ends. Because `GameLoop.onFrame` runs all fixed sim steps BEFORE it
 * runs the frame systems, the simulation never observes a single borrowed bit.
 * Determinism is intact and multiplayer stays possible.
 *
 * The companion is registered programmatically rather than shipped as a second
 * `*.system.ts` file so the pair can never be separated by a glob, a file
 * rename, or an agent deleting "the one that does nothing".
 *
 * TURNING FOG OFF
 * ---------------
 * The screenshot harness photographs ART. A black rectangle is not a critique
 * of the art. Resolution order, highest wins:
 *   1. `?fog=on` / `?fog=off`   — explicit, latches immediately
 *   2. `?shot=` present         — every fixture is unfogged (FOG_REVEAL_IN_SHOT_MODE)
 *   3. `activeScenario().frozen`— a posed photograph, shot flag or not
 *   4. `FOG_ENABLED_DEFAULT`
 *
 * A NOTE ON `ScenarioSpec.revealMap`, because it is NOT rule 2
 * ------------------------------------------------------------
 * `src/game/Scenarios.ts` hard-codes `revealMap: true` for every scenario it
 * publishes, including the plain `skirmish` boot with no `?shot=` flag at all
 * ("every fixture is a photograph of a composition"). Honouring it literally
 * would mean the fog of war never runs in this game, which cannot be what it
 * means. So `revealMap` is treated as an ADDITIONAL reveal — it can turn fog
 * off, never on — and it is only consulted for a scenario that is `frozen` or
 * booted through `?shot=`. If the scenario module ever starts publishing a
 * per-scenario value, delete `frozen` from the condition and this comment.
 * ============================================================================
 */

import { defineSystem, everyNth } from '../core/loop';
import { Phase, RenderPhase } from '../core/types';
import type { PlayerId, RenderContext, SimContext, SystemModule } from '../core/types';
import { VISION_TICK_INTERVAL, FOG_ENABLED_DEFAULT, FOG_REVEAL_IN_SHOT_MODE } from '../core/config';
import { ctx } from '../game/context';
import { activeScenario } from '../game/Scenarios';

import { Vision } from './Vision';
import { FogOfWar } from '../render/FogOfWar';

/* -------------------------------------------------------------------------- */
/* Flag resolution                                                             */
/* -------------------------------------------------------------------------- */

const UNMASK_ID = 'sim.vision.unmask';

function query(name: string): string | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get(name);
}

/** `?fog=off|0|false` / `?fog=on|1|true`. Anything else is ignored loudly. */
function fogFromUrl(): boolean | null {
  const q = query('fog');
  if (q === null) return null;
  const v = q.toLowerCase();
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false;
  if (v === 'on' || v === '1' || v === 'true' || v === 'yes') return true;
  console.warn(`[fow] ?fog=${q} is not on/off — ignoring`);
  return null;
}

function readShotMode(): boolean {
  const q = query('shot');
  return q !== null && q !== '';
}

/* -------------------------------------------------------------------------- */

let vision: Vision | null = null;
let fog: FogOfWar | null = null;

/** Set once the enabled state can no longer change. */
let latched = false;
/** True after the very first stamp+snap, so frame one is never a black plate. */
let primed = false;
/**
 * The URL's answers, read ONCE at init. `resolveEnabled` runs every frame until
 * it latches, and `new URLSearchParams(...)` in the frame loop would be an
 * allocation per frame for no reason at all.
 */
let urlOverride: boolean | null = null;
let shotMode = false;

/**
 * Decide whether fog runs. Cheap, and called until it latches: the scenario
 * module inits LAST (`Phase.Cleanup`, order 10000), so `activeScenario()` is
 * still null while this module is initialising and its `revealMap` can only be
 * read once the sim is actually running.
 */
function resolveEnabled(): boolean {
  if (urlOverride !== null) { latched = true; return urlOverride; }
  if (shotMode && FOG_REVEAL_IN_SHOT_MODE) { latched = true; return false; }

  const spec = activeScenario();
  if (spec === null) return FOG_ENABLED_DEFAULT;  // scenario has not built yet
  latched = true;
  // A frozen scenario is a posed photograph; shrouding half of it would be
  // photographing the shroud. See the header note on `revealMap`.
  if (spec.frozen && spec.revealMap) return false;
  return FOG_ENABLED_DEFAULT;
}

/** Push the resolved state into both halves. Idempotent. */
function applyEnabled(): void {
  const v = vision;
  const f = fog;
  if (v === null || f === null) return;
  const want = resolveEnabled();
  if (want === v.enabled && want === f.enabled) return;
  v.setEnabled(want);
  f.setEnabled(want);
  // A toggle must never fade the whole board in over half a second.
  f.snapTo(v.gridFor(ctx().world.localPlayer));
}

/**
 * The other half of the borrowed flag, and its safety net.
 *
 * `frame` at `RenderPhase.Present` (900) is the normal return path: every
 * render module — bridge, anim, vfx, overlay, hud — has had its look at the
 * mask by then, and the actual `renderer.render()` happens later still, in
 * Bootstrap's `hooks.render`, off the instance data the bridge already wrote.
 *
 * `simTick` at `Phase.Command` with a hugely negative order is the safety net.
 * `SystemRegistry.runFrame` has no try/catch, so ONE unrelated module throwing
 * from a later render phase would strand the borrowed bits in the simulation.
 * Clearing again before the very first sim system of the next tick makes that
 * failure mode cost nothing. Both calls are idempotent.
 */
const unmaskSystem: SystemModule = {
  id: UNMASK_ID,
  renderPhase: RenderPhase.Present,
  phase: Phase.Command,
  order: -1_000_000,
  frame(): void {
    vision?.clearRenderMask();
  },
  simTick(): void {
    vision?.clearRenderMask();
  },
};

/* -------------------------------------------------------------------------- */

export default defineSystem({
  id: 'sim.vision',
  phase: Phase.Vision,
  renderPhase: RenderPhase.FowUpload,
  order: 0,

  init(): void {
    const { world, sceneRig, registry } = ctx();

    urlOverride = fogFromUrl();
    shotMode = readShotMode();

    vision = new Vision(world, FOG_ENABLED_DEFAULT);
    world.vision = vision;

    // Terrain owns `Phase.Command` order 40 and therefore initialised long
    // before this; sampling the port rather than importing Terrain.ts keeps the
    // render layer from depending on the world layer's implementation.
    fog = new FogOfWar({
      scene: sceneRig.scene,
      heightAt: (x, z) => world.terrain.heightAt(x, z),
    });

    registry.add(unmaskSystem);

    applyEnabled();
  },

  /**
   * Deterministic half. Cloak state every tick (it gates targeting, so it must
   * be exact); the grid every VISION_TICK_INTERVAL ticks.
   */
  simTick(s: SimContext): void {
    const v = vision;
    if (v === null) return;

    if (!latched) applyEnabled();

    v.tickCloak();
    if (!v.enabled) return;
    if (!everyNth(s.tick, VISION_TICK_INTERVAL)) return;

    const changed = v.update();
    if (changed === 0) return;

    const bus = ctx().channels.events;
    const payload = bus.payload('vision:changed');
    const players = ctx().world.players;
    for (let p = 0; p < players.length; p++) {
      if ((changed & (1 << p)) === 0) continue;
      payload.player = p as PlayerId;
      bus.emitPooled('vision:changed');
    }
  },

  /**
   * Render half, at `RenderPhase.FowUpload` (20) — before the bridge instances
   * anything and before any overlay reads a flag.
   */
  frame(r: RenderContext): void {
    const v = vision;
    const f = fog;
    if (v === null || f === null) return;

    if (!latched) applyEnabled();

    const { world, debug } = ctx();
    const viewer = world.localPlayer;

    if (!v.enabled) {
      // Nothing masked, nothing drawn. Counters still reported so the F3
      // overlay shows "fog: off" rather than stale numbers.
      v.clearRenderMask();
      debug.counters.fogMasked = 0;
      debug.counters.fogVisible = 0;
      debug.counters.fogExplored = 0;
      return;
    }

    if (!primed) {
      // The scenario may have built the whole board without running a single
      // sim tick (`settleTicks: 0`, which every frozen fixture uses). Stamp
      // once and snap, so frame one shows the real shroud instead of fading
      // the entire map in from black.
      primed = true;
      v.update();
      f.snapTo(v.gridFor(viewer));
    }

    v.applyRenderMask(viewer);
    f.update(v.gridFor(viewer), v.version[viewer as number], r.dt, r.time);

    const st = v.stats(viewer);
    debug.counters.fogVisible = st.visible;
    debug.counters.fogExplored = st.explored;
    debug.counters.fogMasked = st.masked;
    debug.counters.fogSources = st.sources;
  },

  dispose(): void {
    vision?.clearRenderMask();
    fog?.dispose();
    vision?.dispose();
    // Guarded: `registry.dispose()` clears everything itself, and removing an
    // id that is already gone is a documented no-op.
    try { ctx().registry.remove(UNMASK_ID); } catch { /* context already torn down */ }
    vision = null;
    fog = null;
    latched = false;
    primed = false;
    urlOverride = null;
    shotMode = false;
  },
});

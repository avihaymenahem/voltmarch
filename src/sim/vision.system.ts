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
 * THE FLAG THIS MODULE NO LONGER BORROWS — READ BEFORE CHANGING ANYTHING HERE
 * ---------------------------------------------------------------------------
 * This module used to hide entities by SETTING `EntityFlag.Cloaked` on them at
 * `RenderPhase.FowUpload` and having a companion system at `RenderPhase.Present`
 * (900) put every borrowed bit back before the frame ended. The reasoning was
 * sound as far as it went — `GameLoop.onFrame` runs all fixed sim steps before
 * any frame system, so the simulation never observed a borrowed bit — but the
 * cost of ONE missed restore was catastrophic and permanent, because that flag
 * is also read by `Targeting` (do not acquire), `Combat` (do not fire) and
 * `Selection` (cannot be clicked), and `Vision.clearRenderMask` restored by slot
 * index with no generation check. A skipped restore plus a recycled slot wrote a
 * dead unit's bit onto a live one, and `tickCloak` will not clear a `Cloaked`
 * bit it has no `setCloaked` reason for. The result was a unit that was
 * invisible, unclickable and immune to fire for the rest of the match: "something
 * came into my base, I could not see it, and my army would not shoot it."
 *
 * `Vision.computeRenderMask(viewer)` replaces it. It writes render-owned state
 * and no simulation column whatsoever, `RenderBridge.visibility` reads it, and
 * there is no restore step to miss — see §2.6 of Vision.ts for why a pass-id
 * mask cannot latch. DO NOT reintroduce a flag borrow here, however careful the
 * pairing looks; the reason this one failed is that a `try/finally` around a
 * frame is not the failure it was protecting against.
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
import type { PlayerId, RenderContext, SimContext } from '../core/types';
import { VISION_TICK_INTERVAL, FOG_ENABLED_DEFAULT, FOG_REVEAL_IN_SHOT_MODE } from '../core/config';
import { ctx } from '../game/context';
import { activeScenario } from '../game/Scenarios';

import { Vision } from './Vision';
import { FogOfWar } from '../render/FogOfWar';
import { renderBridge } from '../render/RenderBridge';

/* -------------------------------------------------------------------------- */
/* Flag resolution                                                             */
/* -------------------------------------------------------------------------- */

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
 * Publish the mask to the bridge. Cheap enough to re-check every frame, and
 * doing it there rather than once in `init()` is deliberate: the bridge is
 * rebuilt on a match restart, and an `init()`-time wire-up would leave the new
 * bridge with no mask and the whole map revealed. One reference compare per
 * frame buys immunity to every ordering question this could otherwise raise.
 */
function publishMask(v: Vision | null): void {
  const b = renderBridge();
  if (b === null) return;
  if (b.visibility !== v) b.visibility = v;
}

/* -------------------------------------------------------------------------- */

export default defineSystem({
  id: 'sim.vision',
  phase: Phase.Vision,
  renderPhase: RenderPhase.FowUpload,
  order: 0,

  init(): void {
    const { world, sceneRig } = ctx();

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

    publishMask(vision);
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
   * Render half, at `RenderPhase.FowUpload` (20) — before `RenderPhase.Bridge`
   * (30) instances anything, so the mask the bridge reads was computed from this
   * frame's positions and never a frame late.
   */
  frame(r: RenderContext): void {
    const v = vision;
    const f = fog;
    if (v === null || f === null) return;

    if (!latched) applyEnabled();

    const { world, debug } = ctx();
    const viewer = world.localPlayer;
    publishMask(v);

    if (!v.enabled) {
      // Fog off still runs the mask, for two reasons: a cloaked ENEMY is hidden
      // by a cloak and not by a shroud, and — more importantly — a mask that
      // simply stops being recomputed would leave its last pass id current and
      // whatever it hid hidden forever. Recomputing is what makes it stateless.
      v.computeRenderMask(viewer);
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

    v.computeRenderMask(viewer);
    f.update(v.gridFor(viewer), v.version[viewer as number], r.dt, r.time);

    const st = v.stats(viewer);
    debug.counters.fogVisible = st.visible;
    debug.counters.fogExplored = st.explored;
    debug.counters.fogMasked = st.masked;
    debug.counters.fogSources = st.sources;
  },

  dispose(): void {
    // Detach BEFORE invalidating, so no frame can read a mask belonging to a
    // module that no longer exists. Either order is safe — an invalidated mask
    // hides nothing — but this one is safe for a reason a reader can check.
    const b = renderBridge();
    if (b !== null && b.visibility === vision) b.visibility = null;
    fog?.dispose();
    vision?.dispose();
    vision = null;
    fog = null;
    latched = false;
    primed = false;
    urlOverride = null;
    shotMode = false;
  },
});

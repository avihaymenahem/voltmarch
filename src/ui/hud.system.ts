/**
 * ============================================================================
 * src/ui/hud.system.ts — THE HUD'S REGISTRATION
 * ============================================================================
 * Discovered by glob from `src/game/Systems.ts`; this file is the entire wiring
 * step. Nothing else in the tree names the HUD.
 *
 * PHASE
 * -----
 * `frame` at RenderPhase.Hud (80) — after Overlay (70), before Present (900).
 * The HUD has NO `simTick` any more: the stand-in production ticker it used to
 * run is gone, because `src/sim/Production.ts` is a real module now and the HUD
 * reads its snapshot instead of maintaining a shadow copy of the queues.
 *
 * MOUNT POINT
 * -----------
 * `GameContext` does not carry `hudRoot` — Bootstrap keeps it private and only
 * exposes it through `debug.api.setUiVisible`, which toggles its visibility for
 * the screenshot harness. So the HUD mounts into `#hud-root` by id, exactly as
 * `src/main.ts` resolves it. That element is `position: fixed; inset: 0;
 * pointer-events: none`, so only the controls that opt back in are hit-tested
 * and the world keeps every pixel the docks do not cover.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { RenderPhase, type RenderContext } from '../core/types';
import { ctx } from '../game/context';
import type { CameraRig } from '../render/camera';

import { Hud } from './Hud';
import type { HudSoundCue } from './Sidebar';

/** Live instance, for `dispose` and for the console handle. */
let hud: Hud | null = null;
/** What `init` handed the rig, so `dispose` hands back exactly that. */
let wheelSurface: { rig: CameraRig; mount: HTMLElement } | null = null;

declare global {
  // eslint-disable-next-line no-var
  var __vmHud: Hud | undefined;
}

export default defineSystem({
  id: 'ui.hud',
  renderPhase: RenderPhase.Hud,
  order: 100,

  async init(): Promise<void> {
    const { world, channels, cameraRig, handle, registry, debug } = ctx();

    const mount = document.getElementById('hud-root');
    if (mount === null) {
      console.warn('[hud] #hud-root is missing; the HUD will not mount');
      return;
    }

    /*
     * THE HUD WAS A WHEEL DEAD ZONE — ~20-26% OF A MacBook VIEWPORT.
     *
     * `#hud-root` is `pointer-events: none`, but `.vm-hud .vm-panel` sets
     * `pointer-events: auto` and that is the generic class on every panel. A
     * wheel over one therefore has a target outside the canvas, so the camera
     * rig's `ownsEvent` filter refused it; and `#hud-root` is a SIBLING of
     * `#app > canvas`, so `InputManager`'s canvas listener was not on the
     * propagation path either. Neither handler ran. Measured live in Chromium:
     * 25.95% of 1440x900, 23.79% of 1280x700, 21.24% of 1440x789, 19.91% of
     * 1512x850 — one pointer position in five, on every platform.
     *
     * The registration lives HERE rather than in `camera.ts` because this is
     * the module that owns that root; the rig hard-coding `#hud-root` would be
     * the render layer reaching into the UI layer for one string.
     * `CameraRig.ownsWheel` still declines anything with a genuinely scrollable
     * ancestor, which is what keeps `.vm-grid` (the cameo list) and
     * `.vm-sel-cards` scrolling.
     */
    cameraRig.addWheelSurface(mount);
    wheelSurface = { rig: cameraRig, mount };

    hud = new Hud({
      mount,
      world,
      channels,
      cameraRig,
      handle,
      // Sibling detection is a one-shot read at boot: it decides whether the
      // HUD or the input module owns the order-confirmation ring.
      simSystemIds: registry.simOrder(),
    });

    await hud.init();

    // Content-key labels let the fallback roster check prerequisites without
    // def tables. Optional, and silently skipped when the scenario module is
    // not present.
    try {
      const scenarios = await import('../game/Scenarios');
      hud.setEntityKeyResolver(scenarios.entityKeyOf);
    } catch {
      /* Prerequisites fall back to "no structures owned", which is correct-ish
         for an empty world and self-corrects the moment defs land. */
    }

    /*
     * Close the UI-audio seam.
     *
     * The HUD publishes four abstract cues and refuses to invent a sound for
     * them; the audio module bakes `ui.hover/click/tab/error` and refuses to
     * reach into the HUD. Neither would ever have called the other. The
     * translation table is three lines and belongs here, in the wiring layer.
     *
     * `playUi` is imported lazily and the whole thing is optional: a boot with
     * `?audio=off`, or in a browser with no WebAudio, must still get a HUD.
     */
    try {
      const { playUi } = await import('../audio/AudioEngine');
      const CUE_SOUND: Readonly<Record<HudSoundCue, string>> = {
        hover: 'ui.hover',
        click: 'ui.click',
        tab: 'ui.tab',
        error: 'ui.error',
      };
      hud.setSoundHook((cue) => { playUi(CUE_SOUND[cue]); });
    } catch {
      /* No audio module, or it failed to boot. The HUD stays silent. */
    }

    globalThis.__vmHud = hud;

    debug.counters.hudShare = Math.round(hud.hudFrameShare() * 1000) / 10;
    console.info(
      `[hud] bottom bar mounted — ${hud.sidebar.slotCount} build slots, ` +
      `chrome occupies ${(hud.hudFrameShare() * 100).toFixed(1)}% of the frame`,
    );
  },

  frame(r: RenderContext): void {
    if (hud === null) return;
    /*
     * Keep the build-slot cameos on the world's environment map.
     *
     * Pushed from here rather than at init because the PMREM bake finishes
     * AFTER the HUD mounts, and an art-mood change re-bakes it — so a one-shot
     * read at boot would leave the cameos permanently unlit, which is the exact
     * symptom: black silhouettes. `setCameoEnvironment` early-outs on an
     * unchanged texture, so this is an identity compare per frame and nothing
     * more.
     */
    hud.sidebar.setCameoEnvironment(ctx().sceneRig.environment);
    hud.frame(r.dt);
  },

  dispose(): void {
    // Hand the wheel back before the DOM goes: a rig that outlived this module
    // would keep claiming events for a root nothing renders into any more.
    // Held from `init` rather than re-resolved, so dispose cannot depend on the
    // context still being live or on the element still being in the document.
    wheelSurface?.rig.removeWheelSurface(wheelSurface.mount);
    wheelSurface = null;
    hud?.dispose();
    hud = null;
    globalThis.__vmHud = undefined;
  },
});

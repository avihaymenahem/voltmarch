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

import { Hud } from './Hud';
import type { HudSoundCue } from './Sidebar';

/** Live instance, for `dispose` and for the console handle. */
let hud: Hud | null = null;

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
    hud.frame(r.dt);
  },

  dispose(): void {
    hud?.dispose();
    hud = null;
    globalThis.__vmHud = undefined;
  },
});

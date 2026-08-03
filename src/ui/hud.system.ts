/**
 * ============================================================================
 * RED ALERT — src/ui/hud.system.ts
 * ============================================================================
 * The HUD's registration. Discovered by glob from `src/game/Systems.ts`; this
 * file is the entire wiring step.
 *
 * PHASES
 *   simTick  : Phase.Production (200) — only the stand-in production ticker,
 *              which self-disables when a real production module exists. It
 *              sits in that phase rather than a later one so a real module and
 *              this one can never both be advancing a queue in the same tick.
 *   frame    : RenderPhase.Hud (80) — after Overlay (70), before Present (900).
 *              The cameo renderer borrows the main WebGL renderer here, which
 *              is safe because every `frame()` hook runs strictly before
 *              Bootstrap's `present()`.
 *
 * MOUNT POINT
 * -----------
 * `GameContext` does not carry `hudRoot` — Bootstrap keeps it private and only
 * exposes it through `debug.api.setUiVisible`, which toggles its visibility for
 * the screenshot harness. So the HUD mounts into `#hud-root` by id, exactly as
 * `src/main.ts` resolves it. That element is `position: fixed; inset: 0;
 * pointer-events: none`, so only the controls that opt back in are hit-tested
 * and the world keeps every pixel the sidebar does not cover.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase, RenderPhase, type RenderContext, type SimContext } from '../core/types';
import { ctx } from '../game/context';

import { Hud } from './Hud';
import type { HudSoundCue } from './Sidebar';

/** Live instance, for `dispose` and for the console handle. */
let hud: Hud | null = null;

declare global {
  // eslint-disable-next-line no-var
  var __raHud: Hud | undefined;
}

export default defineSystem({
  id: 'ui.hud',
  phase: Phase.Production,
  renderPhase: RenderPhase.Hud,
  order: 100,

  async init(): Promise<void> {
    const { world, channels, cameraRig, handle, sceneRig, registry, debug } = ctx();

    const mount = document.getElementById('hud-root');
    if (mount === null) {
      console.warn('[hud] #hud-root is missing; the HUD will not mount');
      return;
    }

    // The theatre drives the cameo backdrops. `plannedScenario()` is documented
    // as safe from any module's init at any phase and needs no world state, but
    // the HUD must still boot if the scenario module is absent entirely.
    let theatre: string | null = null;
    try {
      const scenarios = await import('../game/Scenarios');
      theatre = scenarios.plannedScenario().map;
    } catch {
      theatre = null;
    }

    hud = new Hud({
      mount,
      world,
      channels,
      cameraRig,
      handle,
      sceneRig,
      // Detecting a real production module is a one-shot read at boot; see the
      // note on Hud.localProduction for why it is never re-evaluated.
      simSystemIds: registry.simOrder(),
      theatre,
    });

    await hud.init();

    // Content-key labels let the fallback catalogue check prerequisites without
    // def tables. Optional, and silently skipped when the scenario module is
    // not present.
    try {
      const scenarios = await import('../game/Scenarios');
      hud.setEntityKeyResolver(scenarios.entityKeyOf);
    } catch {
      /* prerequisites fall back to "no structures owned", which is correct-ish
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

    globalThis.__raHud = hud;

    debug.counters.hudScale = Math.round(hud.hudFrameShare() * 1000) / 10;
    console.info(
      `[hud] sidebar mounted — ${hud.sidebar.slotCount} cameo slots, ` +
      `HUD occupies ${(hud.hudFrameShare() * 100).toFixed(1)}% of the frame (target 12-16%)`,
    );
  },

  simTick(s: SimContext): void {
    hud?.simTick(s);
  },

  frame(r: RenderContext): void {
    if (hud === null) return;
    hud.frame(r.dt);
    const { debug } = ctx();
    debug.counters.hudCameos = hud.cameos.totalRenders;
  },

  dispose(): void {
    hud?.dispose();
    hud = null;
    globalThis.__raHud = undefined;
  },
});

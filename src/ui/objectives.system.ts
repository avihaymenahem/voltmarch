/**
 * ============================================================================
 * src/ui/objectives.system.ts — THE OBJECTIVE PANEL'S REGISTRATION
 * ============================================================================
 * Discovered by glob from `src/game/Systems.ts`; this file is the entire wiring
 * step, and it exists for the same reason `src/ui/hud.system.ts` does: a module
 * joins the game by EXISTING, and no agent edits another agent's file to
 * register one.
 *
 * PHASE
 * -----
 * `frame` at RenderPhase.Hud (80), order 200 — immediately after `ui.hud` at
 * order 100, so the panel is created into a HUD root that already exists and
 * inherits the `--vm-u` design unit and the faction accent the HUD publishes on
 * it. There is no `simTick`: mission tracking is presentation-side by design
 * (see the determinism boundary in `docs/MISSIONS_DESIGN.md`) and this module
 * only reads.
 *
 * MOUNT POINT
 * -----------
 * Into `.vm-hud` when the HUD has built it, so the panel scales with `--vm-u`
 * and is hidden by `__VM.setUiVisible(false)` along with everything else. If
 * the HUD is absent it falls back to `#hud-root`, which `src/main.ts` resolves
 * and which is `position: fixed; inset: 0; pointer-events: none`.
 *
 * TWO THINGS MOUNT HERE, NOT ONE
 * ------------------------------
 * The corner panel, and the centre-screen completion beat. The beat is a
 * separate full-frame layer with a separate lifetime, and it is mounted from
 * HERE rather than from the HUD for two reasons: `src/ui/Hud.ts` belongs to
 * another workflow and must not be edited, and an overlay whose only trigger is
 * a progression event has no business living inside the HUD's own object graph
 * anyway. `ObjectivesPanel` reports completions through `onComplete`; this file
 * is the only thing that knows both objects exist.
 *
 * IT MOUNTS NOTHING WITHOUT A REASON
 * ----------------------------------
 * `ObjectivesPanel` starts hidden and stays hidden until a progression handle
 * publishes at least one active objective, and `ObjectiveBanner` starts hidden
 * and only ever unhides for a completion that happened after the panel was
 * already watching. A `?shot=` boot never loads the shell, never loads the
 * profile store and therefore never publishes one, so all twelve scenario
 * captures are byte-for-byte unaffected by this module. That is the whole
 * reason the panel probes for the handle instead of being handed one.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { RenderPhase, type RenderContext } from '../core/types';

import { ObjectiveBanner } from './ObjectiveBanner';
import {
  MAX_VISIBLE_OBJECTIVES,
  ObjectivesPanel,
  objectivesFrameShareOf,
  objectivesPanelHeightUnits,
} from './Objectives';

let panel: ObjectivesPanel | null = null;
let banner: ObjectiveBanner | null = null;

declare global {
  // eslint-disable-next-line no-var
  var __vmObjectives: ObjectivesPanel | undefined;
  // eslint-disable-next-line no-var
  var __vmObjectiveBanner: ObjectiveBanner | undefined;
}

/** The HUD root if it exists, else the raw mount, else null. */
function resolveMount(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const hud = document.querySelector<HTMLElement>('.vm-hud');
  if (hud !== null) return hud;
  return document.getElementById('hud-root');
}

/** `1.23%` — the modelled share of a 720p frame for a fold and a row count. */
function share(rows: number, view: 'collapsed' | 'summary' | 'expanded'): string {
  const pct = objectivesFrameShareOf(objectivesPanelHeightUnits(view, rows), 1280, 720) * 100;
  return `${pct.toFixed(2)}%`;
}

export default defineSystem({
  id: 'ui.objectives',
  renderPhase: RenderPhase.Hud,
  order: 200,

  init(): void {
    // A second instance would double every row and fight the first for the
    // corner. If something already published one, this module stands down.
    if (globalThis.__vmObjectives !== undefined) return;

    const mount = resolveMount();
    if (mount === null) {
      console.info('[objectives] no HUD root; the objective panel will not mount');
      return;
    }

    const beat = new ObjectiveBanner({ mount });
    banner = beat;
    globalThis.__vmObjectiveBanner = beat;

    panel = new ObjectivesPanel({
      mount,
      onComplete: (done) => { beat.announce(done); },
    });
    globalThis.__vmObjectives = panel;

    console.info(
      `[objectives] panel mounted — fold "${panel.fold}", summary cap ` +
      `${MAX_VISIBLE_OBJECTIVES} rows, frame share collapsed ` +
      `${share(1, 'collapsed')} / summary ${share(MAX_VISIBLE_OBJECTIVES, 'summary')} / ` +
      `expanded@6 ${share(6, 'expanded')}; ` +
      `${panel.active ? 'objectives live' : 'idle until a progression handle publishes one'}`,
    );
    console.info(
      '[objectives] completion beat mounted — inert full-frame layer, ' +
      'emits "vm:objective-complete" for the audio hook',
    );
  },

  frame(r: RenderContext): void {
    panel?.frame(r.dt);
    banner?.frame(r.dt);
  },

  dispose(): void {
    if (globalThis.__vmObjectives === panel) globalThis.__vmObjectives = undefined;
    if (globalThis.__vmObjectiveBanner === banner) globalThis.__vmObjectiveBanner = undefined;
    panel?.dispose();
    banner?.dispose();
    panel = null;
    banner = null;
  },
});

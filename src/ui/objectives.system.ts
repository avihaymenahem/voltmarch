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
 * IT MOUNTS NOTHING WITHOUT A REASON
 * ----------------------------------
 * `ObjectivesPanel` starts hidden and stays hidden until a progression handle
 * publishes at least one active objective. A `?shot=` boot never loads the
 * shell, never loads the profile store and therefore never publishes one, so
 * all twelve scenario captures are byte-for-byte unaffected by this module.
 * That is the whole reason the panel probes for the handle instead of being
 * handed one.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { RenderPhase, type RenderContext } from '../core/types';

import { ObjectivesPanel } from './Objectives';

let panel: ObjectivesPanel | null = null;

declare global {
  // eslint-disable-next-line no-var
  var __vmObjectives: ObjectivesPanel | undefined;
}

/** The HUD root if it exists, else the raw mount, else null. */
function resolveMount(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const hud = document.querySelector<HTMLElement>('.vm-hud');
  if (hud !== null) return hud;
  return document.getElementById('hud-root');
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

    panel = new ObjectivesPanel({ mount });
    globalThis.__vmObjectives = panel;
    console.info(
      `[objectives] panel mounted — cap 3 rows, ` +
      `${panel.active ? 'objectives live' : 'idle until a progression handle publishes one'}`,
    );
  },

  frame(r: RenderContext): void {
    panel?.frame(r.dt);
  },

  dispose(): void {
    if (globalThis.__vmObjectives === panel) globalThis.__vmObjectives = undefined;
    panel?.dispose();
    panel = null;
  },
});

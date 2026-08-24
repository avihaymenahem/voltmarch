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
import type { ActiveObjective, ProgressionView } from './Objectives';
import { campaignSession } from '../campaign/session';

let panel: ObjectivesPanel | null = null;
let banner: ObjectiveBanner | null = null;
/** Whether the panel is currently reading the campaign rather than the profile. */
let injected = false;

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

/**
 * The campaign's objectives, shaped as the five members `readProgression`
 * duck-types for.
 *
 * Returns null when no operation is armed, so the panel falls back to
 * `readProgression()` exactly as it always did and a skirmish is unchanged.
 *
 * `campaignSession()` comes from `src/campaign/session.ts`, which imports
 * nothing — this module is a `*.system.ts` and therefore in the entry chunk, so
 * reaching for anything heavier here would drag the Director and the whole
 * operation table in front of every player's first paint.
 *
 * EXPORTED FOR THE SPEC AND FOR NOTHING ELSE. `frame()` below is its only
 * production caller. What a test needs to reach is the SHAPE this hands the
 * panel — a booted page is the only other place that is visible, and the
 * `0 / 1` this used to produce survived precisely because nobody could see it
 * from a test.
 */
export function campaignObjectiveView(): ProgressionView | null {
  const session = campaignSession();
  if (session === null) return null;

  // `target: 1` and a 0/1 value, because a campaign objective is a FLAG rather
  // than a counter: there is no "3 of 25" to report.
  //
  // `flag: true` IS THAT FACT, CARRIED FROM THE SIDE THAT KNOWS IT. It is set
  // unconditionally because it is true by CONSTRUCTION rather than by row:
  // `ObjectiveDef` in `src/campaign/types.ts` declares id, kind, title, credits
  // and hidden, and there is no count anywhere in the campaign vocabulary for
  // an objective to carry. Nothing on `ObjectiveRow` already answered it —
  // `kind` is `'primary' | 'secondary'`, which is how much an objective
  // MATTERS, and both halves are flags — so adding a parallel always-true field
  // to `ObjectiveRow` would buy nothing and give the fact two homes.
  //
  // Until this landed the panel drew "0 / 1" under every objective: a progress
  // bar for something with no progress, and the first thing a player saw in
  // every operation. IT NEVER DREW "1 / 1", and the brief that asked for this
  // change said it did — `objectiveReadout` returns "DONE" on `complete` before
  // it ever looks at the fraction, and a campaign row's `value` and its
  // `complete` are the same `status === 'complete'` test, so "1 / 1" is
  // unreachable. `Objectives.ts#objectiveReadout` reads the flag; a provider
  // that omits it renders exactly as it always did.
  const rows = (): ActiveObjective[] => session.rows()
    .filter((r) => r.status !== 'hidden')
    .map((r) => {
      const credits = r.credits !== undefined && r.credits > 0 ? r.credits : 0;
      const importance = r.kind === 'primary' ? 'Primary objective' : 'Bonus objective';
      return {
        id: r.id,
        scope: 'match' as const,
        title: r.title,
        description: credits > 0
          ? `${importance} · +${credits.toLocaleString('en-US')} credits`
          : importance,
        category: 'tactics' as const,
        target: 1,
        reward: credits > 0 ? [{ kind: 'credits' as const, amount: credits }] : [],
        creditRewardPaid: credits > 0,
        flag: true,
        progress: {
          id: r.id,
          value: r.status === 'complete' ? 1 : 0,
          target: 1,
          complete: r.status === 'complete',
          claimedAt: null,
        },
      };
    });

  return {
    // An EMPTY profile, not a fake one. This view owns no profile — the real
    // one is still on `__vmProgression` and still correct; the panel simply
    // never reads this member.
    profile: () => ({ version: 0, unlocked: [], missions: [] }),
    catalogue: () => [],
    activeObjectives: rows,
    drainPending: () => [],
    isUnlocked: () => false,
    // NOT a real subscription. The panel re-reads `activeObjectives()` on its
    // own sample cadence, and a campaign objective changes a handful of times
    // per operation — a push channel here would be a second mechanism doing
    // what the poll already does.
    subscribe: () => () => { /* nothing to unsubscribe */ },
    resetProfile: () => { /* a campaign view owns no profile */ },
    exportProfile: () => '',
    importProfile: () => false,
  };
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

    /*
     * A CAMPAIGN OPERATION PUBLISHES ITS OWN OBJECTIVES, BY INJECTION.
     *
     * `suppressProgression` means the profile handle has NOTHING to say during
     * an operation — `activeObjectives()` is empty by design — so without this
     * the panel is blank for the whole match and the player is told nothing
     * about what they are meant to do.
     *
     * INJECTED, NEVER SWAPPED ONTO `globalThis.__vmProgression`. That singleton
     * is the progression system's, and the pause menu's Missions board and
     * `EndScreen.drainPending()` both read it — writing a campaign view over it
     * would give one global two owners and make the end screen drain a source
     * that has no rewards. `ObjectivesPanel` has taken an injected
     * `progression` since it was written; it simply had no second caller until
     * now.
     *
     * IT IS RESOLVED ON THE FIRST FRAME, NOT AT INIT, AND A FIRST ATTEMPT GOT
     * THAT WRONG. `Shell.startOperation` does arm the operation before
     * `bootstrap()` — but `campaignSession()` reads the LIVE slot, which
     * `campaign.system.ts#init` fills by adopting the armed one, and the
     * registry does not promise which module's `init` runs first. Measured, it
     * is this one: the panel was built with a null view and stayed blank for
     * the whole operation. Verified on a booted page, which is the only place
     * that ordering is visible at all.
     */
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
    // Once, on the frame the campaign first appears — and once more when it
    // goes away, so the panel falls back to the profile for the next skirmish.
    const session = campaignSession();
    const armed = session !== null;
    if (panel !== null) {
      panel.setCampaignContext(
        session?.op.title ?? null,
        session?.op.id.split('.', 1)[0] ?? null,
      );
    }
    if (panel !== null && armed !== injected) {
      injected = armed;
      panel.setProgression(armed ? campaignObjectiveView() : null);
    }
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

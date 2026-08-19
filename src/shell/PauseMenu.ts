/**
 * ============================================================================
 * src/shell/PauseMenu.ts — Escape, mid-match
 * ============================================================================
 * A status line, the current objectives, and the shortest list of choices that
 * still covers what a paused player wants. Deliberately the smallest screen in
 * the product: a pause menu is a thing you pass through, and every extra control
 * on it is a control the player has to read before getting back to the match.
 *
 * The sim is already stopped by the time this mounts — `Shell.pause()` calls
 * `GameHandle.setPaused(true)` first — so the frame behind the glass is a
 * frozen battlefield, not a running one. Rendering continues, which is why the
 * blur behind the panel is live rather than a screenshot.
 *
 * RESTART REROLLS THE SEED
 * ------------------------
 * `Shell.restartMatch()` passes `seed: 0`, which `startMatch` reads as "roll a
 * fresh one". Restarting an unwinnable position into the identical unwinnable
 * position is not a feature. A player who wants the same battle types the seed
 * into the lobby, where it is explicit.
 *
 * OVERLAYS, NOT EXTRA SHELL STATES
 * --------------------------------
 * Both Help and Missions mount into this screen's own layer and HIDE the pause
 * card behind them. Two reasons that beats adding a `ShellState` for each:
 *
 *   - the shell's `FocusRing` skips anything with no layout box, so hiding the
 *     pause card takes its buttons out of the ring for free and keyboard
 *     navigation lands inside the overlay without either side enumerating the
 *     other;
 *   - Escape then has exactly one meaning per layer — close the overlay, or
 *     resume — resolved by `onBack` here rather than by a state transition.
 *
 * Both overlays satisfy the same three-member shape (`root`, `dispose`,
 * `onKeyDown`), so this file holds one overlay slot rather than one field per
 * panel, and a third panel is a button and nothing else.
 *
 * WHY THE OBJECTIVES ARE REPEATED HERE
 * ------------------------------------
 * They are already on the HUD. But `Shell.pause()` HIDES the HUD, and "what was
 * I supposed to be doing" is — with "what does this key do again" — one of the
 * two questions a paused player actually has. Reading it costs one line each and
 * the block is absent entirely when nothing is active.
 *
 * AND IT IS THE FULL LIST
 * -----------------------
 * Uncapped, unlike the HUD panel. The HUD panel is capped at three rows because
 * it shares the frame with a battle and with a 12-16% interface budget; this
 * screen is modal, over a frozen sim, and competes with nothing. Making this the
 * authoritative list is what lets the in-match panel stay a summary, and it is
 * the cheaper half of "let the player see ALL objectives" — no new state, no new
 * affordance, one deleted `slice`.
 * ============================================================================
 */

import { HelpPanel } from './Help';
import { MissionsPanel } from './Missions';
import { SavePanel } from './LoadGame';
import { DIFFICULTIES, SPEEDS, mapById } from './settings-store';
import { campaignObjectiveView } from '../ui/objectives.system';
import { readProgression, type ActiveObjective } from '../ui/Objectives';
import {
  button,
  el,
  icon,
  panel,
  playableFactions,
  type Screen,
  type Shell,
} from './Shell';

/** `m:ss` for anything under an hour, `h:mm:ss` past it. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** The three members this screen needs from a hosted panel. */
interface Overlay {
  readonly root: HTMLElement;
  dispose(): void;
  onKeyDown(e: KeyboardEvent): boolean;
}

/**
 * The objectives active right now, or an empty list.
 *
 * Exported because the end screen wants the same read and the same total
 * absence of assumptions about the progression module being present.
 */
export function currentObjectives(): readonly ActiveObjective[] {
  /*
   * THE CAMPAIGN VIEW OUTRANKS THE PROFILE, AND IT DID NOT UNTIL 2026-08-19.
   *
   * `readProgression()` answers with `__vmProgression` — the SKIRMISH mission
   * tracker — so during a campaign operation the pause menu listed the
   * player's skirmish mission chain under the heading "Objectives". That is
   * the wrong answer to the one question this block exists for: its own
   * comment names it as *"what was I supposed to be doing"*, and the operation
   * is what they were supposed to be doing. The profile is also DEAF for the
   * duration (`suppressProgression`), so every row it offered was a row that
   * could not move while the player read it.
   *
   * `campaignObjectiveView` is the same provider the in-match panel has always
   * used — `objectives.system.ts` injects it on the frame an operation
   * appears — so the two surfaces now answer from one source rather than from
   * two that agree by accident. It returns null when no operation is armed, so
   * a skirmish is bit-identical.
   *
   * `EndScreen` also calls this, and is unaffected: it suppresses this block
   * outright for a campaign result and draws `campaignObjectiveList` from the
   * published result instead. `completedObjectiveCount` calls it too, which
   * means the autosave scheduler's event trigger now fires on a campaign
   * objective completing rather than never firing at all — a strict
   * improvement, and the reason that function's doc mentions the degraded
   * case.
   */
  const campaign = campaignObjectiveView();
  const p = campaign ?? readProgression();
  if (p === null) return [];
  try {
    return p.activeObjectives();
  } catch {
    return [];
  }
}

/** `12 / 25`, or a tick word once complete. */
export function objectiveLine(o: ActiveObjective): string {
  if (o.progress.complete) return 'Complete';
  if (o.progress.target <= 1) return 'Pending';
  const value = Math.max(0, Math.min(o.progress.target, Math.floor(o.progress.value)));
  return `${value} / ${o.progress.target}`;
}

export class PauseMenuScreen implements Screen {
  readonly id = 'paused';
  private host: HTMLElement | null = null;
  private clock: HTMLElement | null = null;
  private timer = 0;

  /** The pause panel itself, hidden while an overlay is up. */
  private card: HTMLElement | null = null;
  private overlay: Overlay | null = null;

  constructor(private readonly shell: Shell) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-pause', 'is-modal');

    const p = panel('vm-pause-panel');
    this.card = p;

    const head = el('div', 'vm-pause-head');
    head.appendChild(el('p', 'vm-subtitle', 'Paused'));
    const setup = this.shell.getSetup();
    head.appendChild(el('h2', 'vm-h2', mapById(setup.map).name));
    p.appendChild(head);

    const stats = el('div', 'vm-pause-stats');
    const clock = el('span', 'vm-num', formatClock(this.shell.matchSeconds()));
    this.clock = clock;
    const clockWrap = el('span');
    clockWrap.appendChild(icon('clock', 13));
    clockWrap.appendChild(clock);
    clockWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
    stats.appendChild(clockWrap);

    const faction = playableFactions().find((f) => f.key === setup.playerFaction);
    stats.appendChild(el('span', undefined, faction?.name ?? '—'));
    stats.appendChild(el('span', undefined, `${DIFFICULTIES[setup.difficulty]} · ${SPEEDS[setup.speed].toFixed(1)}×`));
    p.appendChild(stats);

    const objectives = this.buildObjectives();
    if (objectives !== null) p.appendChild(objectives);

    const nav = el('nav', 'vm-pause-nav');
    nav.setAttribute('aria-label', 'Pause menu');
    nav.appendChild(button('Resume', {
      iconName: 'play',
      variant: 'primary',
      hint: 'Esc',
      onClick: () => this.shell.resume(),
    }));
    // Directly under Resume, because "save and stop playing" is the second
    // thing a paused player wants after "keep playing", and because a save
    // entry the player has to hunt for is a save entry they never use.
    //
    // ABSENT, NOT DISABLED, when there is nothing to save — a build without
    // `src/save/**`, or a tutorial run, which forces its own map and seed and
    // would restore a battlefield without the lesson. The same reasoning the
    // title screen applies to Load: a control that cannot do anything is worse
    // than no control, and unlike the title screen there is no useful sentence
    // to put under it here.
    if (this.shell.canSave()) {
      nav.appendChild(button('Save Game', {
        iconName: 'folder',
        onClick: () => this.openSave(),
      }));
    }
    nav.appendChild(button('Missions', {
      iconName: 'trophy',
      onClick: () => this.openMissions(),
    }));
    nav.appendChild(button('Controls', {
      iconName: 'keyboard',
      onClick: () => this.openHelp(),
    }));
    nav.appendChild(button('Settings', {
      iconName: 'sliders',
      onClick: () => this.shell.openSettings('paused'),
    }));
    nav.appendChild(button('Restart Battle', {
      iconName: 'refresh',
      onClick: () => { void this.shell.restartMatch(); },
    }));
    nav.appendChild(button('Quit To Menu', {
      iconName: 'power',
      variant: 'danger',
      onClick: () => { void this.shell.quitToMenu(); },
    }));
    p.appendChild(nav);

    host.appendChild(p);

    // The clock keeps ticking visually only if the sim does; it does not, so
    // this exists purely to catch the case where something else resumed it.
    this.timer = window.setInterval(() => {
      if (this.clock !== null) this.clock.textContent = formatClock(this.shell.matchSeconds());
    }, 500);
  }

  unmount(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.clock = null;
    this.closeOverlay();
    this.card = null;
    this.host?.classList.remove('vm-pause', 'is-modal');
    this.host = null;
  }

  onBack(): boolean {
    if (this.overlay !== null) {
      this.closeOverlay();
      return true;
    }
    this.shell.resume();
    return true;
  }

  /** An open overlay claims Page Up / Page Down / Home / End. */
  onKeyDown(e: KeyboardEvent): boolean {
    return this.overlay !== null && this.overlay.onKeyDown(e);
  }

  /* -------------------------------------------------------------------- */

  /**
   * The objectives block, or null when there is nothing to show.
   *
   * A snapshot, not a subscription: the simulation is frozen behind this panel,
   * so nothing can advance while it is open, and a live binding here would be a
   * listener that exists solely to never fire.
   */
  private buildObjectives(): HTMLElement | null {
    const active = currentObjectives();
    if (active.length === 0) return null;

    const wrap = el('div', 'vm-pause-obj');
    wrap.appendChild(el('p', 'vm-subtitle', 'Objectives'));

    // EVERY objective, with no cap.
    //
    // This block used to truncate at four and print "+N more", which mirrored
    // the HUD panel's cap. Mirroring it was the mistake: the HUD panel is
    // capped because it competes with the battlefield for a 12-16% interface
    // budget, and NONE of that is true here. The sim is frozen, the screen is
    // modal, and "what was I supposed to be doing" is one of the two questions
    // a paused player actually has. So this is the authoritative full list —
    // which is what makes it safe for the in-match panel to stay a summary.
    // `objectives.css` puts a scroll guard on the block for the pathological
    // case of a very short window and a very long mission chain.
    for (const o of active) {
      const row = el('div', `vm-pause-obj-row${o.progress.complete ? ' is-done' : ''}`);
      const name = el('span', 'vm-pause-obj-name', o.title);
      name.title = o.description;
      row.appendChild(name);
      row.appendChild(el('span', 'vm-pause-obj-value vm-num', objectiveLine(o)));
      wrap.appendChild(row);
    }
    return wrap;
  }

  private openHelp(): void {
    this.openOverlay(new HelpPanel({
      settings: this.shell.settings,
      onClose: () => this.closeOverlay(),
      // Straight to the rebind rows. Leaving the options screen returns to a
      // fresh pause menu, so Help closes behind it rather than being restored
      // over a screen that no longer exists.
      onRebind: () => {
        this.closeOverlay();
        this.shell.openSettings('paused');
      },
    }));
  }

  private openMissions(): void {
    this.openOverlay(new MissionsPanel({ onClose: () => this.closeOverlay() }));
  }

  /**
   * The manual-save panel, hosted the same way Help and Missions are.
   *
   * It satisfies the same three-member `Overlay` shape, so this screen still
   * holds ONE overlay slot rather than one field per panel — which is the whole
   * reason that shape exists. Closing it lands back on the pause card with the
   * sim still frozen, exactly as the other two do.
   */
  private openSave(): void {
    this.openOverlay(new SavePanel({
      shell: this.shell,
      onClose: () => this.closeOverlay(),
    }));
  }

  private openOverlay(next: Overlay): void {
    const host = this.host;
    if (host === null) return;
    this.closeOverlay();

    // The pause card is hidden rather than removed: `FocusRing.refresh` drops
    // anything with no layout box, so this is also what moves the keyboard into
    // the overlay without either screen enumerating the other's controls.
    if (this.card !== null) this.card.hidden = true;

    this.overlay = next;
    host.appendChild(next.root);
    // The shell refreshes the ring on its own schedule; focusing the first
    // control of the new layer on the next frame is what makes it keyboard-
    // reachable the instant it opens.
    requestAnimationFrame(() => {
      next.root.querySelector<HTMLElement>('[data-vm-focus]')?.focus();
    });
  }

  private closeOverlay(): void {
    const open = this.overlay;
    if (open === null) return;
    open.dispose();
    open.root.remove();
    this.overlay = null;
    if (this.card !== null) this.card.hidden = false;
  }
}

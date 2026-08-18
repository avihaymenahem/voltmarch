/**
 * ============================================================================
 * src/shell/EndScreen.ts — victory, defeat, and what you earned for it
 * ============================================================================
 * The results screen reads `PlayerState.stats`, which the sim already keeps:
 * `sim/Production.ts` counts what was built, `sim/Damage.ts` counts what was
 * killed and lost, and `sim/Economy.ts` counts ore mined and credits spent.
 * Nothing here asks the simulation for a number it was not already tracking —
 * `peakArmyValue` is the one field in `PlayerStats` nobody writes yet, so it is
 * not displayed rather than displayed as a zero.
 *
 * The verdict itself arrives from `Shell`, which either polls the entity store
 * (see `Shell.pollOutcome`) or is told by a future victory module through
 * `Shell.endMatch()`. This screen never decides who won.
 *
 * THE REWARD REVEAL
 * -----------------
 * `docs/MISSIONS_DESIGN.md`, trap 3: "an unlock the player does not notice is
 * not a reward." So earned rewards are not a line in the scoreboard. They are
 * the first thing under the verdict, one card each, revealed on a stagger with
 * a NEW badge, and they name what the thing DOES rather than only what it is
 * called.
 *
 * `ProgressionView.drainPending()` is destructive — it returns everything
 * earned since the last call and forgets it. That is drained EXACTLY ONCE, in
 * this class's constructor, and cached on the instance. `Screen.mount()` can be
 * called again for the same screen object (the shell re-mounts a screen when a
 * sub-screen closes over it) and a second drain would return an empty list,
 * silently eating the player's unlocks on the second paint. This is the single
 * most breakable line in the file; do not move it into `mount`.
 *
 * WHAT ELSE IS ON HERE, AND WHY
 * -----------------------------
 *   Objectives     the match objectives and whether they landed. Factual.
 *   Missions       profile missions that finished and have not been claimed.
 *   Next up        the nearest unfinished missions, with their rewards named.
 *                  This is the hook: the end screen is the exact moment a
 *                  player decides whether to press Rematch, and "you are 18 of
 *                  25 kills from a Prism Tank" is the argument for it.
 *
 * Every one of those blocks is absent — not empty, absent — when the
 * progression handle is missing or has nothing to say, so a build without the
 * progression module renders exactly the screen it rendered before.
 * ============================================================================
 */

import type { PlayerStats } from '../core/types';
import { DIFFICULTIES } from './settings-store';
import { formatClock, currentObjectives, objectiveLine } from './PauseMenu';
import { MissionsPanel, humaniseId, rewardCopy } from './Missions';
import {
  readProgression,
  type ActiveObjective,
  type CatalogueEntry,
  type Reward,
} from '../ui/Objectives';
import {
  button,
  el,
  icon,
  panel,
  type Screen,
  type Shell,
} from './Shell';

export interface MatchResult {
  won: boolean;
  /** Simulated seconds. The number the player experienced. */
  durationSec: number;
  /** Wall-clock seconds, which differs whenever game speed is not 1×. */
  wallSec: number;
  stats: PlayerStats;
  credits: number;
  factionName: string;
  /**
   * EVERY hostile army, joined with ` · `. One name in a duel.
   *
   * It was `world.players[1]?.name`, which is the second seat and not "the
   * opponent" — in a four-way that chip named one of three and silently dropped
   * the others. `Shell.buildResult` now filters the table by hostility, so this
   * is the answer to "who was I fighting" rather than "who was seated next".
   */
  opponentName: string;
  mapName: string;
  difficulty: number;
  speed: number;
  /**
   * Present only when a campaign operation produced this result.
   *
   * WITHOUT IT THE SCREEN LIES BY DEFAULT. The skirmish copy is "Every hostile
   * force on <map> has been destroyed" — which is a true sentence about a
   * skirmish and a FALSE one about an operation won by destroying a single
   * survey tap. It was on screen exactly once, in a screenshot, and that is
   * how it was caught.
   *
   * `reason` is an OBJECTIVE ID, never free prose, so a loss can name which
   * objective ended it and the screen resolves the id to that objective's own
   * title. A string nobody can resolve is a string nobody can translate or
   * test.
   */
  campaign?: CampaignResult;
}

export interface CampaignResult {
  readonly operationId: string;
  readonly title: string;
  readonly chapterTitle: string;
  /**
   * The next operation in this chapter, or null at the end of one.
   *
   * RESOLVED WHEN THE OPERATION WAS ARMED, not here. The table is behind a lazy
   * import and this screen is built inside a frame; the shell cannot await a
   * chunk while assembling a result.
   */
  readonly nextOperationId: string | null;
  /** 0 none, 1 bronze, 2 silver, 3 gold. */
  readonly medal: number;
  /** The objective id a loss names, or ''. */
  readonly reason: string;
  readonly objectives: readonly {
    readonly id: string;
    readonly title: string;
    readonly kind: 'primary' | 'secondary';
    readonly status: 'hidden' | 'active' | 'complete' | 'failed';
  }[];
}

/* -- the campaign verdict --------------------------------------------------
 *
 * Two small renderers rather than branches inside `mount`. The end screen is
 * already the most-crowded file in the shell and its header calls the reward
 * drain "the single most breakable line"; adding a second conditional limb to
 * that method is how it gets worse.                                          */

/** One sentence naming the operation, and — on a loss — which objective ended it. */
function campaignLine(c: CampaignResult, won: boolean): string {
  const where = `${c.chapterTitle} · ${c.title}`;
  if (won) {
    const bonus = c.objectives.filter((o) => o.kind === 'secondary');
    const kept = bonus.filter((o) => o.status === 'complete').length;
    if (bonus.length === 0) return `${where}. Objective complete.`;
    return `${where}. Objective complete, ${kept} of ${bonus.length} bonus objectives met.`;
  }
  // THE REASON IS AN ID AND IS RESOLVED HERE. A loss that says "you failed" is
  // a loss the player cannot learn anything from.
  const failed = c.objectives.find((o) => o.id === c.reason)
    ?? c.objectives.find((o) => o.status === 'failed' && o.kind === 'primary');
  return failed === undefined
    ? `${where}. The operation could not be completed.`
    : `${where}. ${failed.title} — not achieved.`;
}

/** Every objective and how it ended. Hidden ones stay hidden; they never fired. */
function campaignObjectiveList(c: CampaignResult): HTMLElement {
  const wrap = el('div', 'vm-camp-result');
  for (const o of c.objectives) {
    if (o.status === 'hidden') continue;
    const line = el('div', `vm-camp-result-row is-${o.status}`);
    line.appendChild(el('span', 'vm-camp-result-mark',
      o.status === 'complete' ? '✓' : o.status === 'failed' ? '✕' : '·'));
    line.appendChild(el('span', 'vm-camp-result-text', o.title));
    if (o.kind === 'secondary') line.appendChild(el('span', 'vm-camp-result-tag', 'Bonus'));
    wrap.appendChild(line);
  }
  return wrap;
}

interface StatCell {
  label: string;
  value: string;
  accent?: boolean;
}

/** The scoreboard, derived from what the sim actually tracks. */
export function resultCells(r: MatchResult): StatCell[] {
  const s = r.stats;
  const kd = s.unitsLost > 0 ? (s.unitsKilled / s.unitsLost).toFixed(2) : String(s.unitsKilled);
  return [
    { label: 'Duration', value: formatClock(r.durationSec), accent: true },
    { label: 'Units Built', value: s.unitsBuilt.toLocaleString() },
    { label: 'Units Lost', value: s.unitsLost.toLocaleString() },
    { label: 'Units Killed', value: s.unitsKilled.toLocaleString(), accent: true },
    { label: 'Kill / Loss', value: kd },
    { label: 'Structures Built', value: s.buildingsBuilt.toLocaleString() },
    { label: 'Structures Lost', value: s.buildingsLost.toLocaleString() },
    { label: 'Structures Razed', value: s.buildingsKilled.toLocaleString() },
    { label: 'Ore Harvested', value: Math.round(s.oreMined).toLocaleString() },
    // THE SECOND HALF OF THE FIRST ROW. "Ore Harvested" is what came out of the
    // ground; this is the part of it that hit a full silo and evaporated. Ore
    // you mined and could not keep used to be invisible everywhere in the
    // product — the end screen credited it in full, the sidebar flashed red for
    // one tick, and the ore missions (which now count MINED ore, see
    // `MissionTracker`) never mentioned it. A player who parks at their cap is
    // owed the number, because it is the whole argument for building a silo.
    { label: 'Ore Wasted', value: Math.round(s.oreWasted).toLocaleString() },
    { label: 'Credits Spent', value: Math.round(s.creditsSpent).toLocaleString() },
    { label: 'Credits Left', value: Math.round(r.credits).toLocaleString() },
  ];
}

/* ==========================================================================
 * PROGRESSION SELECTORS — pure, and therefore tested
 * ========================================================================== */

/** Missions that finished and whose reward has not been acknowledged yet. */
export function advancedMissions(catalogue: readonly CatalogueEntry[]): CatalogueEntry[] {
  return catalogue.filter((e) => e.progress.complete && e.progress.claimedAt === null);
}

/**
 * The nearest unfinished, reachable missions.
 *
 * Sorted by how close they are, then by the smaller target, so the list a
 * player reads on the end screen is genuinely the cheapest next thing rather
 * than whatever happened to be first in the table. Locked missions are excluded:
 * telling someone they are 90% of the way through a mission they cannot start
 * is worse than telling them nothing.
 */
export function nextUpMissions(catalogue: readonly CatalogueEntry[], limit = 3): CatalogueEntry[] {
  const open = catalogue.filter((e) => !e.progress.complete && !e.locked);
  const frac = (e: CatalogueEntry): number => {
    const target = e.progress.target > 0 ? e.progress.target : 1;
    const f = e.progress.value / target;
    return f < 0 ? 0 : f > 1 ? 1 : f;
  };
  open.sort((a, b) => {
    const d = frac(b) - frac(a);
    if (d !== 0) return d;
    return a.progress.target - b.progress.target;
  });
  return open.slice(0, Math.max(0, limit));
}

/** `18 / 25 · Prism Tank` — progress and what it buys, in one line. */
export function nextUpLine(e: CatalogueEntry): string {
  const target = e.progress.target > 1 ? e.progress.target : 1;
  const value = Math.max(0, Math.min(target, Math.floor(e.progress.value)));
  const reward = e.reward.length > 0 ? rewardCopy(e.reward[0]).name : '';
  const count = `${value.toLocaleString('en-US')} / ${target.toLocaleString('en-US')}`;
  return reward === '' ? count : `${count} · ${reward}`;
}

/* ==========================================================================
 * THE SCREEN
 * ========================================================================== */

export class EndScreen implements Screen {
  readonly id = 'ended';
  private host: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private missions: MissionsPanel | null = null;

  /**
   * Drained ONCE, here. See the header — draining in `mount` loses every
   * unlock the second time the screen is painted.
   */
  private readonly earned: readonly Reward[];
  private readonly objectives: readonly ActiveObjective[];
  private readonly catalogue: readonly CatalogueEntry[];

  constructor(
    private readonly shell: Shell,
    private readonly result: MatchResult,
  ) {
    this.objectives = currentObjectives();

    const p = readProgression();
    let earned: readonly Reward[] = [];
    let catalogue: readonly CatalogueEntry[] = [];
    if (p !== null) {
      try {
        earned = p.drainPending();
      } catch {
        earned = [];
      }
      try {
        catalogue = p.catalogue();
      } catch {
        catalogue = [];
      }
    }
    this.earned = earned;
    this.catalogue = catalogue;
  }

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-end', 'is-modal');

    const r = this.result;
    const p = panel('vm-end-panel');
    this.card = p;

    /* -- verdict ---------------------------------------------------------- */
    const head = el('div', 'vm-end-head');
    const badge = el('div', 'vm-load-meta');
    badge.style.justifyContent = 'flex-start';

    const chip = el('div', 'vm-chip');
    chip.appendChild(icon(r.won ? 'trophy' : 'skull', 14));
    chip.appendChild(el('span', undefined, r.mapName));
    badge.appendChild(chip);

    const oppChip = el('div', 'vm-chip');
    oppChip.appendChild(icon('cpu', 14));
    oppChip.appendChild(el('span', undefined, `${r.opponentName} · ${DIFFICULTIES[r.difficulty] ?? '—'}`));
    // The chip is one line in a flex meta row, and three army names is more than
    // that line has. The full list goes on the tooltip so nothing is lost if the
    // text is clipped; the names themselves stay visible for the common case.
    oppChip.title = `Opponents: ${r.opponentName}`;
    badge.appendChild(oppChip);

    const speedChip = el('div', 'vm-chip');
    speedChip.appendChild(icon('gauge', 14));
    speedChip.appendChild(el('span', undefined, `${r.speed.toFixed(1)}× · ${formatClock(r.wallSec)} real`));
    badge.appendChild(speedChip);

    head.appendChild(badge);
    const c = r.campaign;
    const verdict = el('h1', `vm-verdict ${r.won ? 'is-win' : 'is-loss'}`,
      c !== undefined ? (r.won ? 'Operation Complete' : 'Operation Failed')
        : (r.won ? 'Victory' : 'Defeat'));
    head.appendChild(verdict);

    // AN OPERATION SAYS WHAT HAPPENED TO IT, NOT WHAT HAPPENED TO THE MAP. The
    // skirmish sentence below is true of a skirmish and false of an operation
    // won by destroying one survey tap while the enemy base still stands.
    head.appendChild(el('p', 'vm-body', c === undefined
      ? (r.won
        ? `Every hostile force on ${r.mapName} has been destroyed. ${r.factionName} holds the field.`
        : `${r.factionName} has no units and no structures remaining on ${r.mapName}.`)
      : campaignLine(c, r.won)));

    if (c !== undefined) head.appendChild(campaignObjectiveList(c));
    p.appendChild(head);

    /* -- the reward reveal, above everything it was earned by --------------
     *
     * THIS IS THE ONLY PART THAT CAN GROW WITHOUT BOUND, so it is the only
     * part that scrolls. The reveal list is one card per reward earned, and a
     * long match that closes several mission chains at once produces twenty or
     * more. Reported as "endscreen too huge, cant see it all".
     *
     * It was worse than "too tall". Every child here was a direct child of the
     * panel, the panel had a width and NO height limit, and `.vm-screen` is a
     * fixed `inset: 0` flex box that does not scroll. So the overflow had
     * nowhere to go: the scoreboard slid under the bottom edge and `vm-page-foot`
     * — Rematch, New Skirmish, MAIN MENU — went off screen entirely, with no
     * scrollbar to reach it. The end screen could become a room with no door.
     *
     * So head, scoreboard and actions are pinned, and only this middle band
     * scrolls. `.vm-page-panel` / `.vm-page-body` already establish exactly
     * this idiom in shell.css; this is that pattern, not a new one.
     */
    const reveal = this.buildReveal();
    const progress = this.buildProgress();
    if (reveal !== null || progress !== null) {
      const body = el('div', 'vm-end-body');
      if (reveal !== null) body.appendChild(reveal);
      if (progress !== null) body.appendChild(progress);
      p.appendChild(body);
    }

    /* -- scoreboard -------------------------------------------------------- */
    const grid = el('div', 'vm-stats');
    for (const cell of resultCells(r)) {
      const box = el('div', `vm-stat${cell.accent === true ? ' is-accent' : ''}`);
      box.appendChild(el('div', 'vm-stat-label', cell.label));
      box.appendChild(el('div', 'vm-stat-value vm-num', cell.value));
      grid.appendChild(box);
    }
    p.appendChild(grid);

    /* -- actions ----------------------------------------------------------- */
    const foot = el('div', 'vm-page-foot');

    // AN OPERATION OFFERS RETRY, NOT REMATCH, AND THAT IS NOT A WORDING
    // CHANGE. `restartMatch` re-launches the SKIRMISH the lobby holds; an
    // operation has to go back through `startOperation` so its plan, layout,
    // roster and outcome policy are re-armed before the world is built.
    // Pressing Rematch after an operation would drop the player into an
    // ordinary skirmish on the operation's ground with no objectives — the
    // exact silent substitution `Playback.ts#detachPlayback` documents.
    //
    // Retry is also the most-pressed button in any campaign, so it leads.
    if (c !== undefined) {
      // NEXT OPERATION LEADS ON A WIN, RETRY LEADS ON A LOSS, and the primary
      // styling follows the same rule. An end screen whose only forward button
      // is Main Menu makes a nine-operation chapter feel like nine separate
      // skirmishes — and Retry is the most-pressed button in any campaign, so
      // it never leaves the row, it just stops being the emphasis.
      const next = r.won ? c.nextOperationId : null;
      if (next !== null) {
        foot.appendChild(button('Next Operation', {
          iconName: 'swords',
          variant: 'primary',
          onClick: () => { void this.shell.startOperation(next); },
        }));
      }
      foot.appendChild(button('Retry', {
        iconName: 'refresh',
        variant: r.won || next !== null ? 'default' : 'primary',
        onClick: () => { void this.shell.retryOperation(); },
      }));
      foot.appendChild(button('Campaign', {
        iconName: 'flag',
        onClick: () => { void this.shell.quitToMenu().then(() => this.shell.openCampaign()); },
      }));
    } else {
      foot.appendChild(button('Rematch', {
        iconName: 'refresh',
        onClick: () => { void this.shell.restartMatch(); },
      }));
      if (this.catalogue.length > 0) {
        foot.appendChild(button('Missions', {
          iconName: 'trophy',
          onClick: () => this.openMissions(),
        }));
      }
    }
    foot.appendChild(el('div', 'vm-spacer'));
    if (c === undefined) {
      foot.appendChild(button('New Skirmish', {
        iconName: 'swords',
        onClick: () => { void this.shell.quitToMenu().then(() => this.shell.openSetup()); },
      }));
    }
    foot.appendChild(button('Main Menu', {
      iconName: 'power',
      variant: 'primary',
      onClick: () => { void this.shell.quitToMenu(); },
    }));
    p.appendChild(foot);

    host.appendChild(p);
  }

  unmount(): void {
    this.closeMissions();
    this.card = null;
    this.host?.classList.remove('vm-end', 'is-modal');
    this.host = null;
  }

  onBack(): boolean {
    if (this.missions !== null) {
      this.closeMissions();
      return true;
    }
    void this.shell.quitToMenu();
    return true;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    return this.missions !== null && this.missions.onKeyDown(e);
  }

  /* -------------------------------------------------------------------- */
  /* the reveal                                                            */
  /* -------------------------------------------------------------------- */

  /**
   * The reward band, or null when nothing was earned.
   *
   * The stagger is an `animation-delay` per card and nothing else — no timers,
   * no sequencing code, and therefore nothing to leak if the player hits Main
   * Menu a third of a second in. 220 ms apart with a 160 ms lead-in puts four
   * unlocks on screen inside a second, which is a beat rather than a cutscene.
   * `prefers-reduced-motion` collapses all of it through the global rule at the
   * foot of shell.css; the cards are still there, they just arrive at once.
   */
  private buildReveal(): HTMLElement | null {
    if (this.earned.length === 0) return null;

    const wrap = el('section', 'vm-reveal');
    const head = el('div', 'vm-reveal-head');
    head.appendChild(icon('trophy', 16));
    head.appendChild(el('h3', 'vm-h3', this.earned.length === 1 ? 'Reward Earned' : 'Rewards Earned'));
    wrap.appendChild(head);

    const list = el('div', 'vm-reveal-list');
    for (let i = 0; i < this.earned.length; i++) {
      const copy = rewardCopy(this.earned[i]);
      const cardEl = el('div', 'vm-reveal-card');
      cardEl.style.animationDelay = `${160 + i * 220}ms`;

      const glyph = el('div', 'vm-reveal-icon');
      glyph.appendChild(icon(copy.iconName, 22));
      cardEl.appendChild(glyph);

      const text = el('div', 'vm-reveal-text');
      text.appendChild(el('span', 'vm-reveal-kind', copy.kind));
      text.appendChild(el('span', 'vm-reveal-name', copy.name));
      text.appendChild(el('span', 'vm-reveal-effect', copy.effect));
      cardEl.appendChild(text);

      cardEl.appendChild(el('span', 'vm-reveal-new', 'New'));
      list.appendChild(cardEl);
    }
    wrap.appendChild(list);
    return wrap;
  }

  /**
   * Objectives, finished missions and what is next — or null when the
   * progression module has nothing to say about any of them.
   */
  private buildProgress(): HTMLElement | null {
    // A CAMPAIGN OPERATION FEEDS NONE OF THIS, SO IT MUST NOT SHOW ANY OF IT.
    // `suppressProgression` means no objective advanced, no chain moved and no
    // reward was earned — so a "Next Up" panel here would be advertising
    // progress toward things the operation is DESIGNED never to advance. It
    // read as a bug on the first screenshot and it would read as one to a
    // player. The operation's own objective list sits in the header instead.
    if (this.result.campaign !== undefined) return null;
    const advanced = advancedMissions(this.catalogue);
    const next = nextUpMissions(this.catalogue);
    if (this.objectives.length === 0 && advanced.length === 0 && next.length === 0) return null;

    const wrap = el('section', 'vm-endprog');

    if (this.objectives.length > 0) {
      let done = 0;
      for (const o of this.objectives) if (o.progress.complete) done++;
      wrap.appendChild(this.progressBlock(
        'Objectives',
        `${done} of ${this.objectives.length} completed`,
        this.objectives.map((o) => ({
          title: o.title,
          detail: objectiveLine(o),
          good: o.progress.complete,
        })),
      ));
    }

    if (advanced.length > 0) {
      wrap.appendChild(this.progressBlock(
        'Missions Advanced',
        `${advanced.length} finished`,
        advanced.map((e) => ({
          title: e.title,
          detail: e.reward.length > 0 ? rewardCopy(e.reward[0]).name : humaniseId(e.id),
          good: true,
        })),
      ));
    }

    if (next.length > 0) {
      // Stacked, because `nextUpLine` is a count AND a reward name — the two
      // together are longer than a third of the panel and a single-line row
      // ellipsised the mission title down to "Pr...".
      wrap.appendChild(this.progressBlock(
        'Next Up',
        'Closest to complete',
        next.map((e) => ({ title: e.title, detail: nextUpLine(e), good: false })),
        true,
      ));
    }

    return wrap;
  }

  private progressBlock(
    title: string,
    note: string,
    rows: readonly { title: string; detail: string; good: boolean }[],
    stacked = false,
  ): HTMLElement {
    const block = el('div', `vm-endprog-block${stacked ? ' is-stacked' : ''}`);
    const head = el('div', 'vm-endprog-head');
    head.appendChild(el('h4', 'vm-endprog-title', title));
    head.appendChild(el('span', 'vm-endprog-note', note));
    block.appendChild(head);

    for (const r of rows) {
      const row = el('div', `vm-endprog-row${r.good ? ' is-good' : ''}`);
      if (r.good) row.appendChild(icon('check', 13));
      row.appendChild(el('span', 'vm-endprog-name', r.title));
      row.appendChild(el('span', 'vm-endprog-detail vm-num', r.detail));
      block.appendChild(row);
    }
    return block;
  }

  /* -------------------------------------------------------------------- */
  /* the missions overlay                                                  */
  /* -------------------------------------------------------------------- */

  private openMissions(): void {
    const host = this.host;
    if (host === null || this.missions !== null) return;
    // Same trick the pause menu uses: hiding the card takes its buttons out of
    // the shell's focus ring, so the keyboard lands inside the overlay.
    if (this.card !== null) this.card.hidden = true;

    const missions = new MissionsPanel({ onClose: () => this.closeMissions() });
    this.missions = missions;
    host.appendChild(missions.root);
    requestAnimationFrame(() => {
      missions.root.querySelector<HTMLElement>('[data-vm-focus]')?.focus();
    });
  }

  private closeMissions(): void {
    const open = this.missions;
    if (open === null) return;
    open.dispose();
    open.root.remove();
    this.missions = null;
    if (this.card !== null) this.card.hidden = false;
  }
}

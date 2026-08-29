/**
 * ============================================================================
 * VOLTMARCH — src/shell/Campaign.ts
 * ============================================================================
 * THE CAMPAIGN SCREEN AND THE BRIEFING, AND THE REASON THEY ARE ONE FILE.
 *
 * Four chapter cards, an operation list under whichever is chosen, and a
 * briefing that ends in Deploy. They share a lazily-imported operation table,
 * a completion lookup and a medal renderer, and splitting them would mean two
 * modules each holding half of that and agreeing about the other half.
 *
 * ============================================================================
 * IT IMPORTS THE CAMPAIGN LAZILY, LIKE THE MANUAL DOES
 * ============================================================================
 * `Shell.ts` reaches this file through the shell chunk, and this file reaches
 * the operation table through ONE `await import('../campaign/campaign-install')`
 * — the same boundary `Shell.startOperation` uses and the same one
 * `Manual.ts#loadManual` established for the wiki corpus. A player who opens
 * the main menu and never touches Campaign fetches none of it.
 *
 * The promise is memoised and **a rejection is not cached**: a failed fetch on
 * a bad connection must not permanently disable the screen for the session.
 * That is `loadManual`'s rule, copied deliberately.
 *
 * ============================================================================
 * ALL FOUR CHAPTERS OPEN FROM FIRST LAUNCH
 * ============================================================================
 * `docs/MISSIONS_DESIGN.md` says every faction is available from the start and
 * that the call "is not up for re-litigation". The recommended play order —
 * Soviets, Allies, Pact, Reclamation — is A LINE OF COPY on the screen, not a
 * gate, and it is the order the chapter list is already in.
 *
 * What IS gated is the operation: `requires` is a graph edge validated at
 * import, and an operation whose prerequisites are unfinished renders locked
 * with the reason on it rather than being hidden. A row a player cannot see is
 * a row they cannot plan toward.
 *
 * ============================================================================
 * ONE CHAPTER'S OPERATIONS AT A TIME, WHICH IS WHAT THE HEADER ALWAYS SAID
 * ============================================================================
 * "Four chapter cards, an operation list under whichever is chosen" is the
 * first line of this file and it was never true: `mount` rendered every
 * chapter EXPANDED, so twenty operations stacked into a scroll in which
 * nineteen rows read "Locked — complete X", and the panel was clipped at the
 * bottom at 1600x1000. The description was of the screen somebody meant to
 * build.
 *
 * THE SELECTION IS NOT PERSISTED AND IT IS NOT THE FIRST CARD.
 * `landingChapter` opens on the first chapter with an unfinished operation,
 * which is where the player actually is: chapter one on a fresh profile, and
 * the Timetable for somebody halfway through it. Defaulting to index 0 would
 * make every returning player's first act be a click, and storing the last
 * selection would make it a click they cannot predict. A derived answer needs
 * neither a migration nor a normaliser.
 *
 * A LOCKED ROW IS SHORTER AND LIGHTER, NOT HIDDEN. Locked rows are the
 * majority of the screen and they were the same height as a playable one. They
 * are one line now — number, title, and the reason, which the paragraph above
 * argues must stay — with the medal and the par kept so the column reads
 * continuously, and the Brief button replaced by a padlock because a button
 * that refuses every press is the tallest thing on a row that cannot be
 * pressed.
 * ========================================================================== */

import { el, button, chooser, focusable, icon, pageFrame, panel } from './Shell';
import type { Screen, Shell } from './Shell';
import {
  campaignBriefing,
  campaignMedalStandard,
  campaignTheme,
  preloadCampaignPortraits,
} from './CampaignPresentation';
import { unlockAllActive } from './unlockall.system';
import { DIFFICULTIES } from './settings-store';

/* ==========================================================================
 * 1. THE LAZY TABLE
 *
 * Structural types rather than imports of `src/campaign/types.ts`, so the
 * shell chunk carries no static edge into the campaign at all. The shapes are
 * declared here and the compiler checks each side against its own copy — the
 * `SaveContext` / `ServiceContext` arrangement, for the same reason.
 * ========================================================================== */

/**
 * One authored objective, as the briefing needs to see it.
 *
 * **`hidden` IS ON THIS TYPE BECAUSE THE BRIEFING HAS TO FILTER ON IT.** It was
 * missing, and `BriefingScreen`'s own header had forbidden listing a hidden
 * objective since the file was written — so the guard was prose the compiler
 * could not have let anyone write, and `reclamation.01.held-paper` shipped its
 * hidden secondary on screen before the player had pressed anything. A
 * structural type that omits a field does not merely fail to READ it: it makes
 * the rule that needs it unexpressible.
 *
 * It mirrors the fields `BriefingScreen` consumes from `ObjectiveDef` in
 * `src/campaign/types.ts`. `credits` is deliberately present now: a visible
 * optional objective must disclose the payout it already grants, while the
 * `hidden` filter below keeps both its title and reward off the briefing.
 * Both sides are checked against their own copy; keep the two in step.
 */
interface ObjectiveView {
  readonly id: string;
  readonly kind: 'primary' | 'secondary';
  readonly title: string;
  /** Optional in-operation payout, granted once when this objective completes. */
  readonly credits?: number;
  /** Hidden until a `setObjective` effect reveals it, IN THE MATCH. */
  readonly hidden?: boolean;
}

interface OperationView {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly beat: string;
  readonly parSec: number;
  readonly requires: readonly string[];
  readonly map: {
    readonly opening: 'base' | 'force' | 'mcv';
    readonly credits: number;
  };
  readonly roster: {
    readonly player: readonly string[];
  };
  readonly objectives: readonly ObjectiveView[];
}

interface ChapterView {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly operations: readonly OperationView[];
}

interface CampaignModule {
  readonly CAMPAIGNS: readonly ChapterView[];
}

const CHAPTER_COMMAND: Readonly<Record<string, string>> = {
  soviets: 'Directorate campaign',
  allies: 'Continental command',
  pact: 'Meridian conclave',
  reclamation: 'Salvage houses',
};

let pending: Promise<CampaignModule> | null = null;

/** The operation table, fetched once. A rejection is NOT cached — see the header. */
export function loadCampaign(): Promise<CampaignModule> {
  if (pending === null) {
    pending = import('../campaign/campaign-install')
      .then((m) => m as unknown as CampaignModule)
      .catch((err: unknown) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}

/* ==========================================================================
 * 2. PROGRESS
 *
 * Read off the profile through the same duck-typed handle the objectives panel
 * uses. **A missing handle means NOTHING IS COMPLETE, never everything** — the
 * failure direction matters: the first opens the campaign at operation one,
 * which is where a player with no profile should be; the second would open all
 * 37 and spoil three campaigns.
 * ========================================================================== */

/**
 * A ROW IS A NUMBER. The store writes `Record<string, number>` and the first
 * draft of this file declared `{ medal?: number }` — so `(3)?.medal` was
 * `undefined`, the `?? 1` beneath it turned every completed operation into
 * bronze, and gold was unreachable. Two shapes for one datum, authored on
 * either side of a boundary neither compiler crossed.
 */
interface ProfileProbe {
  profile(): { campaign?: Readonly<Record<string, number>> };
}

function completionOf(): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const g = globalThis as { __vmProgression?: unknown };
  const p = g.__vmProgression as Partial<ProfileProbe> | undefined;
  if (p === undefined || typeof p.profile !== 'function') return out;
  try {
    const rows = p.profile().campaign ?? {};
    for (const [id, medal] of Object.entries(rows)) {
      if (typeof medal === 'number' && medal > 0) out.set(id, medal);
    }
  } catch {
    // A profile that throws is a profile with nothing in it, as far as this
    // screen is concerned. It must not take the campaign down with it.
    return out;
  }
  return out;
}

/** Bronze / silver / gold as pips. Never a number — a medal is a shape. */
function medalPips(medal: number): HTMLElement {
  const wrap = el('span', 'vm-camp-medal');
  wrap.setAttribute('aria-label', MEDAL_NAME[medal] ?? 'not completed');
  for (let i = 1; i <= 3; i++) {
    const pip = el('span', 'vm-camp-pip');
    if (i <= medal) pip.classList.add('is-on');
    wrap.appendChild(pip);
  }
  return wrap;
}

const MEDAL_NAME: Readonly<Record<number, string>> = {
  0: 'not completed', 1: 'bronze', 2: 'silver', 3: 'gold',
};

/** `780` -> `13 min`. Par is authored in seconds and shown in minutes. */
function parLabel(sec: number): string {
  return `${Math.round(sec / 60)} min`;
}

/**
 * The chapter the screen should open on.
 *
 * THE FIRST ONE WITH AN OPERATION THAT IS NOT DONE — which is chapter one on a
 * fresh profile and the chapter in progress for everybody else. Deliberately
 * derived rather than stored: a persisted selection is a second piece of state
 * that can disagree with the profile (a chapter finished on another machine,
 * an operation renamed) and it needs a migration the moment the table grows.
 *
 * **THE FALLBACK IS THE FIRST CHAPTER, AND IT IS ONLY REACHED BY A PLAYER WHO
 * HAS FINISHED EVERYTHING.** There is no better answer for a completed
 * campaign — every chapter is equally "where they are" — and the first is the
 * one the recommended-order line at the top of the screen points at. `null`
 * only for an empty table, which `mount` already handles with its own copy.
 *
 * Exported so the rule has one home and can be asserted without a DOM;
 * `mount` below is its only production caller. That is `briefingObjectives`'
 * arrangement, for its stated reason.
 */
export function landingChapter(
  // NARROWER THAN `ChapterView` ON PURPOSE: the rule reads two ids and nothing
  // else, and a parameter that demanded the whole view would force every
  // caller — including a test naming the cases — to author a `beat`, a
  // `parSec` and an objective list that the function cannot look at.
  chapters: readonly {
    readonly id: string;
    readonly operations: readonly { readonly id: string }[];
  }[],
  done: ReadonlyMap<string, number>,
): string | null {
  for (const ch of chapters) {
    if (ch.operations.some((o) => !done.has(o.id))) return ch.id;
  }
  return chapters[0]?.id ?? null;
}

/* ==========================================================================
 * 3. THE CHAPTER SCREEN
 * ========================================================================== */

export class CampaignScreen implements Screen {
  readonly id = 'campaign';

  private host: HTMLElement | null = null;
  private disposed = false;

  /** Every chapter card, in table order, so a selection repaints no card. */
  private cards: { readonly id: string; readonly node: HTMLElement }[] = [];
  /** The one container the selection actually swaps. */
  private opsHost: HTMLElement | null = null;
  private chapters: readonly ChapterView[] = [];
  private done: ReadonlyMap<string, number> = new Map();
  private selected: string | null = null;

  constructor(private readonly shell: Shell) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page');
    // The first portrait is needed on Briefing, before Deploy. Begin decoding
    // the small cast as soon as Campaign is chosen; the loader is idempotent
    // and Shell.startOperation repeats it only for direct/deep-link launches.
    preloadCampaignPortraits();
    const { root, body } = pageFrame('Campaign', () => { this.shell.showMenu(); });
    root.classList.add('vm-operation-panel', 'vm-campaign-page');
    host.appendChild(root);

    const note = el('p', 'vm-camp-note');
    const noteCopy = el('span', 'vm-camp-note-copy');
    noteCopy.append(
      'Four campaigns, open from the start. ',
      el('strong', undefined, 'Soviets first'),
      ' is the recommended order — it is the only one nothing else spoils, and it is the order the '
      + 'factions are easiest to learn in.',
    );
    note.appendChild(noteCopy);
    const overall = el('span', 'vm-camp-overall', 'Loading campaign record…');
    note.appendChild(overall);
    body.appendChild(note);

    const list = el('div', 'vm-camp-chapters');
    body.appendChild(list);
    list.appendChild(el('p', 'vm-camp-loading', 'Loading operations…'));

    void loadCampaign().then((m) => {
      if (this.disposed) return;
      list.replaceChildren();
      this.chapters = m.CAMPAIGNS;
      this.done = completionOf();
      if (this.chapters.length === 0) {
        list.appendChild(el('p', 'vm-camp-loading', 'No operations have been authored yet.'));
        return;
      }

      const operationIds = new Set(this.chapters.flatMap((chapter) => (
        chapter.operations.map((operation) => operation.id)
      )));
      const completed = [...this.done.keys()].filter((id) => operationIds.has(id)).length;
      const gold = [...this.done.entries()].filter(([id, medal]) => (
        operationIds.has(id) && medal >= 3
      )).length;
      const overallCopy = el('span', 'vm-camp-overall-copy',
        `${completed} / ${operationIds.size} complete${gold > 0 ? ` · ${gold} gold` : ''}`);
      const overallTrack = el('span', 'vm-camp-overall-track');
      const overallFill = el('span', 'vm-camp-overall-fill');
      overallFill.style.setProperty('--vm-camp-overall-progress',
        `${Math.round((completed / operationIds.size) * 100)}%`);
      overallTrack.appendChild(overallFill);
      // Clear the loading copy before replacing its children. Browsers do
      // this as part of replaceChildren; spelling it out also keeps the tiny
      // DOM harness honest about the transition from loading to progress.
      overall.textContent = '';
      overall.replaceChildren(overallCopy, overallTrack);
      overall.setAttribute('role', 'progressbar');
      overall.setAttribute('aria-label', 'Overall campaign completion');
      overall.setAttribute('aria-valuemin', '0');
      overall.setAttribute('aria-valuemax', String(operationIds.size));
      overall.setAttribute('aria-valuenow', String(completed));

      const cards = el('div', 'vm-camp-cards');
      this.cards = [];
      for (let i = 0; i < this.chapters.length; i++) {
        const ch = this.chapters[i];
        const node = this.chapterCard(ch, i);
        this.cards.push({ id: ch.id, node });
        cards.appendChild(node);
      }
      list.appendChild(cards);

      this.opsHost = el('div', 'vm-camp-ops-host');
      list.appendChild(this.opsHost);
      this.select(landingChapter(this.chapters, this.done), true);
    }).catch((err: unknown) => {
      if (this.disposed) return;
      list.replaceChildren();
      // NAMED, not swallowed. A screen that says "Loading…" forever is the
      // failure a player reports as "the campaign button is broken".
      list.appendChild(el('p', 'vm-camp-loading',
        'The campaign could not be loaded. Check the connection and try again.'));
      console.error('[campaign] the operation table failed to load', err);
    });
  }

  /**
   * Show one chapter's operations and mark its card pressed.
   *
   * **THE CARDS ARE MUTATED, NOT REBUILT, AND THAT IS ABOUT FOCUS.** Rebuilding
   * the row would destroy the very card the player just activated, dropping
   * `document.activeElement` back to `<body>` and throwing a keyboard or
   * gamepad player to the top of the ring. Only `opsHost` is replaced, and
   * nothing in it is focused at the moment of the swap.
   */
  private select(id: string | null, revealCurrent = false): void {
    // Pressing the card that is already open rebuilds nothing. Cheap, and it
    // keeps a repeated press from swapping the list out from under a pointer.
    if (this.selected === id && this.opsHost !== null) return;
    this.selected = id;
    for (const c of this.cards) {
      c.node.setAttribute('aria-pressed', c.id === id ? 'true' : 'false');
    }
    const host = this.opsHost;
    if (host === null) return;
    host.replaceChildren();
    const ch = this.chapters.find((c) => c.id === id);
    if (ch === undefined) return;
    host.setAttribute('aria-label', ch.title);
    const card = panel('vm-camp-chapter');
    const theme = campaignTheme(ch.id);
    if (theme !== null) card.classList.add(`is-${theme}`);

    const complete = ch.operations.filter((o) => this.done.has(o.id)).length;
    const chapterComplete = complete === ch.operations.length;
    const current = ch.operations.find((op) => {
      if (this.done.has(op.id)) return false;
      return unlockAllActive() || op.requires.every((required) => this.done.has(required));
    });
    const head = el('div', 'vm-camp-chapter-head');
    const identity = el('div', 'vm-camp-chapter-identity');
    identity.appendChild(el('span', 'vm-camp-chapter-command',
      CHAPTER_COMMAND[ch.id] ?? 'Campaign command'));
    identity.appendChild(el('h2', 'vm-camp-chapter-title', ch.title));
    head.appendChild(identity);

    // Keep the operation deck connected to the person who will brief the
    // next deployment. A finished chapter falls back to its finale commander,
    // so revisiting a completed campaign never leaves an empty identity well.
    const commandOp = current ?? ch.operations[ch.operations.length - 1];
    if (commandOp !== undefined) {
      const presentation = campaignBriefing(commandOp.id);
      if (presentation !== null && presentation.commander.portrait !== '') {
        const commander = el('div', 'vm-camp-chapter-commander');
        const portrait = document.createElement('img');
        portrait.className = 'vm-camp-chapter-commander-portrait';
        portrait.setAttribute('src', presentation.commander.portrait);
        portrait.setAttribute('alt', '');
        portrait.setAttribute('aria-hidden', 'true');
        portrait.setAttribute('decoding', 'async');
        portrait.setAttribute('draggable', 'false');
        commander.appendChild(portrait);
        const copy = el('span', 'vm-camp-chapter-commander-copy');
        copy.appendChild(el('span', 'vm-camp-chapter-commander-label',
          chapterComplete ? 'Final command' : 'Next briefing'));
        copy.appendChild(el('strong', 'vm-camp-chapter-commander-name',
          presentation.commander.name));
        commander.appendChild(copy);
        head.appendChild(commander);
      }
    }

    const status = el('div', 'vm-camp-chapter-status');
    if (chapterComplete) status.appendChild(el('strong', 'vm-camp-chapter-complete', 'Campaign complete'));
    status.appendChild(el('span', 'vm-camp-chapter-count',
      `${complete} / ${ch.operations.length} complete`));
    head.appendChild(status);

    // COMPLETED REPLAYS CAN PUSH THE CURRENT ROW BELOW A SHORT DESKTOP FOLD.
    // The dossier already names the next commander in its pinned header, so
    // put the matching forward action there as well. The authored row remains
    // in sequence below (and still owns medal/lock detail); this is a stable
    // continuation route, not a second representation of progression.
    if (current !== undefined) {
      const continueButton = button('Continue', {
        iconName: 'swords',
        hint: current.title,
        variant: 'primary',
        onClick: () => { this.shell.openBriefing(current.id); },
      });
      continueButton.classList.add('vm-camp-chapter-continue');
      head.appendChild(continueButton);
    }
    card.appendChild(head);
    card.appendChild(el('p', 'vm-camp-chapter-blurb', ch.blurb));

    let currentRow: HTMLElement | null = null;
    const ops = el('div', 'vm-camp-ops');
    for (const op of ch.operations) {
      const row = this.operationRow(ch, op, this.done, op.id === current?.id);
      if (op.id === current?.id) currentRow = row;
      ops.appendChild(row);
    }
    card.appendChild(ops);
    host.appendChild(card);
    // On initial entry, bring the actionable row into the nearest visible
    // edge. A manual chapter press leaves scroll ownership with the player.
    if (revealCurrent && currentRow !== null && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (!this.disposed) currentRow?.scrollIntoView({ block: 'nearest' });
      });
    }
  }

  /**
   * One chapter, as a card in the top row.
   *
   * THE MEDAL SUMMARY IS A GOLD COUNT AND IT IS THE ONLY ONE THE SCREEN CAN
   * HONESTLY DRAW. `done` holds a medal tier per operation and nothing
   * aggregates them; a chapter-level pip strip would have to invent a meaning
   * for "the chapter's medal" (best? worst? mean?), and three of those three
   * answers are wrong for somebody. A count of golds is a fact, it is omitted
   * entirely when it is zero — a fresh profile's cards carry no dead chrome —
   * and `x / y` beside it is the progress figure that was already computed.
   */
  private chapterCard(ch: ChapterView, index: number): HTMLElement {
    const card = el('button', 'vm-card vm-camp-card');
    // Stable product semantics for accessibility, visual QA and future gamepad
    // automation. The authored id survives copy and ordering changes; the
    // visible title deliberately remains the player-facing label.
    card.setAttribute('data-chapter-id', ch.id);
    const theme = campaignTheme(ch.id);
    if (theme !== null) card.classList.add(`is-${theme}`);
    card.type = 'button';
    card.id = `vm-camp-card-${index}`;
    card.setAttribute('aria-pressed', 'false');
    card.appendChild(el('div', 'vm-card-stripe'));

    // The chapter selector is the player's first faction read. Reuse the
    // opening operation's authored commander rather than adding a second
    // chapter-art registry that can drift away from the briefing dossier.
    const opening = ch.operations[0];
    const command = opening === undefined ? null : campaignBriefing(opening.id);
    if (command !== null && command.commander.portrait !== '') {
      const portrait = document.createElement('img');
      portrait.className = 'vm-camp-card-portrait';
      portrait.setAttribute('src', command.commander.portrait);
      portrait.setAttribute('alt', '');
      portrait.setAttribute('aria-hidden', 'true');
      portrait.setAttribute('decoding', 'async');
      portrait.setAttribute('draggable', 'false');
      card.appendChild(portrait);
    }

    card.appendChild(el('div', 'vm-card-name', ch.title));
    card.appendChild(el('div', 'vm-camp-card-command',
      CHAPTER_COMMAND[ch.id] ?? 'Campaign command'));
    card.appendChild(el('div', 'vm-card-blurb', ch.blurb));

    const complete = ch.operations.filter((o) => this.done.has(o.id)).length;
    const chapterComplete = complete === ch.operations.length;
    if (chapterComplete) card.classList.add('is-complete');
    const progress = el('div', 'vm-camp-card-progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', `${ch.title} campaign completion`);
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', String(ch.operations.length));
    progress.setAttribute('aria-valuenow', String(complete));
    const fill = el('span', 'vm-camp-card-progress-fill');
    fill.style.setProperty('--vm-camp-progress',
      `${Math.round((complete / ch.operations.length) * 100)}%`);
    progress.appendChild(fill);
    card.appendChild(progress);

    const foot = el('div', 'vm-camp-card-foot');
    foot.appendChild(el('span', 'vm-camp-chapter-count',
      `${complete} / ${ch.operations.length}`));
    const gold = ch.operations.filter((o) => (this.done.get(o.id) ?? 0) >= 3).length;
    if (gold > 0) foot.appendChild(el('span', 'vm-camp-card-gold', `${gold} gold`));
    if (chapterComplete) foot.appendChild(el('span', 'vm-camp-card-complete', 'Complete'));
    card.appendChild(foot);

    focusable(card);
    card.addEventListener('click', () => { this.select(ch.id); });
    return card;
  }

  private operationRow(
    ch: ChapterView,
    op: OperationView,
    done: ReadonlyMap<string, number>,
    isCurrent: boolean,
  ): HTMLElement {
    const missing = op.requires.filter((id) => !done.has(id));
    // Unlock Everything is an availability override, not campaign progress.
    // Keep `done` untouched so chapter counts, medal pips and the landing
    // chapter continue to describe what the player actually earned. Turning
    // the setting off therefore restores the authored prerequisite graph
    // immediately instead of leaving fake completion rows in the profile.
    const locked = !unlockAllActive() && missing.length > 0;

    const rowEl = el('div', 'vm-camp-op');
    rowEl.setAttribute('data-operation-id', op.id);
    if (locked) rowEl.classList.add('is-locked');
    if (isCurrent) {
      rowEl.classList.add('is-current');
      rowEl.setAttribute('aria-current', 'step');
    }

    const num = el('span', 'vm-camp-op-index', String(op.index).padStart(2, '0'));
    rowEl.appendChild(num);

    const text = el('div', 'vm-camp-op-text');
    const titleLine = el('div', 'vm-camp-op-title-line');
    titleLine.appendChild(el('span', 'vm-camp-op-title', op.title));
    if (isCurrent) titleLine.appendChild(el('span', 'vm-camp-op-current', 'Next operation'));
    text.appendChild(titleLine);
    // LOCKED SAYS WHY. "Complete <the previous operation>" is a sentence a
    // player can act on; a padlock is not. It goes in its OWN class on a
    // locked row, because that row is laid out as one line and the beat's
    // block/ellipsis rules are the wrong ones for it.
    if (locked) {
      text.appendChild(el('span', 'vm-camp-op-lock',
        `Locked — complete ${missing.map((id) => titleOf(ch, id)).join(' and ')}`));
    } else {
      text.appendChild(el('span', 'vm-camp-op-beat', op.beat));
    }
    /*
     * THE BEAT IS FLAVOUR AND THE PRIMARY IS THE TASK, AND A ROW NEEDS BOTH.
     *
     * Reported as "the small title is barely explainable", and the beat was
     * already on the row — measured un-truncated at every width from 1100 to
     * 1440, so this was never a clipping bug. The beat is doing the job it was
     * authored for: `reclamation.01.held-paper`'s is "The yards are already
     * yours. Nobody has read the paperwork." That is a situation, not an
     * assignment, and a player scanning nine rows cannot tell from it what any
     * of them will ask them to DO.
     *
     * The primary objective already says exactly that, in authored prose that
     * `validateCampaign` checks and `campaign-maps.spec.ts` builds — "Destroy
     * the Allied survey tap". So this costs no new content and cannot drift
     * from the operation, which a second hand-written summary field would.
     *
     * `briefingObjectives` rather than `objectives[0]`: it puts primaries
     * first AND drops hidden rows. A primary cannot be hidden today, so the
     * filter is belt-and-braces — but this row must never be the one screen
     * that leaks a hidden objective, which is the defect the briefing shipped
     * with and that function exists to close.
     */
    if (!locked) {
      const primary = briefingObjectives(op.objectives).find((o) => o.kind === 'primary');
      if (primary !== undefined) {
        text.appendChild(el('span', 'vm-camp-op-task', primary.title));
      }
    }
    rowEl.appendChild(text);

    rowEl.appendChild(el('span', 'vm-camp-op-par', parLabel(op.parSec)));
    rowEl.appendChild(medalPips(done.get(op.id) ?? 0));

    /*
     * A PADLOCK RATHER THAN A DISABLED BUTTON, ON LOCKED ROWS ONLY.
     *
     * The button was the tallest element on a row nobody can press — 34px of
     * chrome plus the row's padding, on nineteen of twenty rows for a player
     * who has just arrived. It carried no information the reason line does not
     * already carry, and `setButtonEnabled` had already taken it out of the
     * focus ring, so nothing about keyboard reach changes.
     *
     * The cell is kept and given a floor width so the par and the medals stay
     * in one column down the list — the grid is per-row, not a subgrid, and
     * these tracks line up only because their contents are the same size.
     */
    if (locked) {
      const cell = el('span', 'vm-camp-op-lockcell');
      cell.appendChild(icon('lock', 16));
      rowEl.appendChild(cell);
      return rowEl;
    }
    rowEl.appendChild(button(done.has(op.id) ? 'Replay' : 'Brief', {
      variant: 'primary',
      onClick: () => { this.shell.openBriefing(op.id); },
    }));
    return rowEl;
  }

  unmount(): void {
    this.disposed = true;
    this.host?.classList.remove('vm-page');
    this.host = null;
    // Dropped rather than kept: the screen is rebuilt on the next visit, and
    // holding detached nodes on a live instance is how a listener outlives the
    // tree it was attached to.
    this.opsHost = null;
    this.cards = [];
  }

  onBack(): boolean {
    this.shell.showMenu();
    return true;
  }
}

function titleOf(ch: ChapterView, id: string): string {
  return ch.operations.find((o) => o.id === id)?.title ?? id;
}

/* ==========================================================================
 * 4. THE BRIEFING
 *
 * One operation: what it is, what it wants, and Deploy.
 *
 * THE OBJECTIVE LIST HERE IS THE AUTHORED ONE, NOT THE LIVE ONE — there is no
 * match yet, so nothing has a status. It shows every objective the operation
 * declares EXCEPT the hidden ones: a briefing that listed one would be the
 * operation spoiling its own turn before the player has pressed anything.
 *
 * **THAT SENTENCE WAS HERE FIRST AND THE CODE DID NOT DO IT.** `OperationView`
 * declared `{ id; kind; title }`, so `render` filtered on `kind` alone and
 * `reclamation.01.held-paper` briefed all three of its objectives — the hidden
 * secondary among them, which names the transformer, the mechanism and the
 * whole discovery the operation is built around. `briefingObjectives` is the
 * rule as code; see its own note for why the row is OMITTED rather than
 * replaced by a placeholder.
 * ========================================================================== */

/**
 * The objectives a briefing may show: everything the operation declares that
 * is not hidden, primaries first and authored order within each kind.
 *
 * ── A HIDDEN ROW IS OMITTED, NOT STUBBED, AND THE REST OF THE PRODUCT DECIDED
 * ── THAT ALREADY ──────────────────────────────────────────────────────────
 * The obvious alternative is a placeholder — "Bonus: undisclosed" — which
 * admits something is there without saying what. It is refused because the two
 * other screens that list these rows both OMIT, and three screens telling one
 * story is worth more than any of them being individually clever:
 *
 *   - the in-match panel (`campaign-install.ts#rows`, and again in
 *     `ui/objectives.system.ts`) drops any objective at status `'hidden'`, so
 *     a placeholder here would announce a bonus that the player then cannot
 *     find anywhere for the first several minutes of the match;
 *   - the results screen (`EndScreen.ts#campaignObjectiveList`) drops it too —
 *     "Hidden ones stay hidden; they never fired" — so one never revealed is
 *     never mentioned at all, and a briefing that had counted it would be the
 *     only screen claiming it existed.
 *
 * It also costs the operation the thing it is for. `01-held-paper`'s header
 * argues its hidden secondary is a shipped rule most players never meet, worth
 * a medal *because it is discovered*; a row saying "there is a secret here"
 * turns the discovery into a search. The medal arithmetic is unaffected either
 * way — silver already wants every bonus the operation DECLARES, revealed or
 * not — so nothing is being hidden from the player that they are graded on
 * without warning.
 *
 * Exported so the rule has one home and can be asserted without a DOM;
 * `render` below is its only production caller.
 */
export function briefingObjectives(
  objectives: readonly ObjectiveView[],
): readonly ObjectiveView[] {
  const out: ObjectiveView[] = [];
  for (const kind of ['primary', 'secondary'] as const) {
    for (const o of objectives) {
      if (o.kind !== kind) continue;
      // `hidden !== true`, never `!o.hidden`: the field is optional and an
      // author who writes nothing means shown.
      if (o.hidden === true) continue;
      out.push(o);
    }
  }
  return out;
}

/** The authored opening translated into player-facing deployment language. */
export function campaignDeploymentLabel(opening: OperationView['map']['opening']): string {
  if (opening === 'force') return 'Fixed task force';
  if (opening === 'mcv') return 'Mobile construction';
  return 'Established base';
}

/** Campaign credits are shared by every active seat, but this row briefs the player's reserve. */
export function campaignReserveLabel(credits: number): string {
  if (!Number.isFinite(credits) || credits <= 0) return 'No reserve';
  return `${Math.round(credits).toLocaleString('en-US')} cr`;
}

const CAMPAIGN_AUTHORIZATION_LABELS: Readonly<Record<string, string>> = {
  'struct.defence.specialist': 'Specialist defence',
  'struct.superweapon.solarlance': 'Solar Lance',
  'struct.superweapon.strategic': 'Strategic superweapon',
  'struct.support': 'Support structures',
  'struct.tech': 'Tech tier',
  'unit.raider': 'Raider units',
};

/** Player-side additions to the day-one catalogue, never a claim about every unit on the field. */
export function campaignAuthorizationLabel(ids: readonly string[]): string {
  if (ids.length === 0) return 'Standard issue only';
  return ids.map((id) => {
    const authored = CAMPAIGN_AUTHORIZATION_LABELS[id];
    if (authored !== undefined) return authored;
    const words = id.replace(/^(?:struct|unit)\./, '').replace(/[._-]+/g, ' ').trim();
    return words === '' ? 'Special issue' : words.charAt(0).toUpperCase() + words.slice(1);
  }).join(' · ');
}

export class BriefingScreen implements Screen {
  readonly id = 'briefing';

  private host: HTMLElement | null = null;
  private disposed = false;

  constructor(private readonly shell: Shell, private readonly operationId: string) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page');
    // Defensive for harnesses or future routes that open a briefing without
    // first mounting CampaignScreen. Normal navigation already warmed these.
    preloadCampaignPortraits();
    const { root, body, foot } = pageFrame('Briefing', () => { this.shell.openCampaign(); });
    root.classList.add('vm-operation-panel', 'vm-camp-brief-page');
    host.appendChild(root);
    body.appendChild(el('p', 'vm-camp-loading', 'Loading…'));

    void loadCampaign().then((m) => {
      if (this.disposed) return;
      const found = findOperation(m, this.operationId);
      body.replaceChildren();
      if (found === null) {
        body.appendChild(el('p', 'vm-camp-loading',
          `No operation '${this.operationId}'. It may have been renamed.`));
        return;
      }
      const { chapter, op } = found;
      const theme = campaignTheme(op.id);
      if (theme !== null) root.classList.add(`is-${theme}`);
      body.appendChild(this.render(chapter, op));

      const grade = el('div', 'vm-camp-difficulty');
      const gradeCopy = el('div', 'vm-camp-difficulty-copy');
      gradeCopy.appendChild(el('span', 'vm-camp-difficulty-label', 'Combat grade'));
      gradeCopy.appendChild(el('span', 'vm-camp-difficulty-note', 'Sets enemy pressure and medal grading'));
      grade.appendChild(gradeCopy);
      grade.appendChild(chooser(
        DIFFICULTIES.map((label, value) => ({ label, value })),
        this.shell.campaignDifficulty(),
        (value) => { this.shell.setCampaignDifficulty(value); },
      ));
      foot.appendChild(grade);

      const deploy = button('Deploy', {
        variant: 'primary',
        iconName: 'swords',
        hint: parLabel(op.parSec),
        onClick: () => { void this.shell.startOperation(op.id); },
      });
      foot.appendChild(deploy);
    }).catch((err: unknown) => {
      if (this.disposed) return;
      body.replaceChildren();
      body.appendChild(el('p', 'vm-camp-loading', 'The briefing could not be loaded.'));
      console.error('[campaign] briefing load failed', err);
    });
  }

  private render(chapter: ChapterView, op: OperationView): HTMLElement {
    const wrap = el('div', 'vm-camp-brief');
    const theme = campaignTheme(op.id);
    if (theme !== null) wrap.classList.add(`is-${theme}`);
    const visibleObjectives = briefingObjectives(op.objectives);
    const primary = visibleObjectives.find((o) => o.kind === 'primary');
    const presentation = campaignBriefing(op.id, primary?.title);
    const grid = el('div', 'vm-camp-brief-grid');
    const copy = el('div', 'vm-camp-brief-copy');
    copy.appendChild(el('span', 'vm-camp-brief-chapter', chapter.title));
    copy.appendChild(el('h3', 'vm-camp-brief-title',
      `${String(op.index).padStart(2, '0')} · ${op.title}`));
    const bestMedal = completionOf().get(op.id) ?? 0;
    if (bestMedal > 0) {
      const record = el('div', 'vm-camp-brief-record');
      record.appendChild(icon('trophy', 13));
      record.appendChild(el('span', 'vm-camp-brief-record-label', 'Best award'));
      record.appendChild(el('strong', 'vm-camp-brief-record-value',
        campaignMedalStandard(bestMedal).label));
      copy.appendChild(record);
    }
    copy.appendChild(el('p', 'vm-camp-brief-beat', op.beat));

    const objectives = el('div', 'vm-camp-brief-objectives');
    objectives.appendChild(el('h4', 'vm-camp-brief-h4', 'Objectives'));
    for (const o of visibleObjectives) {
      const line = el('div', `vm-camp-brief-obj is-${o.kind}`);
      line.appendChild(el('span', 'vm-camp-brief-tag', o.kind === 'primary' ? 'Primary' : 'Bonus'));
      line.appendChild(el('span', 'vm-camp-brief-obj-text', o.title));
      if (o.kind === 'secondary' && o.credits !== undefined && o.credits > 0) {
        line.appendChild(el('span', 'vm-camp-brief-obj-reward', `+${o.credits.toLocaleString('en-US')} cr`));
      }
      objectives.appendChild(line);
    }
    copy.appendChild(objectives);

    if (presentation !== null) {
      const intel = el('div', 'vm-camp-brief-intel');
      for (const [key, value] of [
        ['Theatre', presentation.theatre],
        ['Opposition', presentation.opposition],
        ['Deployment', campaignDeploymentLabel(op.map.opening)],
        ['Starting reserve', campaignReserveLabel(op.map.credits)],
        ['Field catalogue', campaignAuthorizationLabel(op.roster.player)],
        ['Par window', parLabel(op.parSec)],
      ] as const) {
        const item = el('div', 'vm-camp-brief-intel-item');
        item.appendChild(el('span', 'vm-camp-brief-intel-key', key));
        item.appendChild(el('strong', 'vm-camp-brief-intel-value', value));
        intel.appendChild(item);
      }
      copy.appendChild(intel);

      const standards = el('section', 'vm-camp-medal-standards');
      standards.setAttribute('aria-label', 'Campaign medal standards');
      standards.appendChild(el('span', 'vm-camp-medal-standards-kicker', 'Award standard'));
      for (let tier = 1; tier <= 3; tier++) {
        const standard = campaignMedalStandard(tier);
        const item = el('div', `vm-camp-medal-standard is-tier-${tier}`);
        item.appendChild(el('strong', 'vm-camp-medal-standard-label', standard.label));
        item.appendChild(el('span', 'vm-camp-medal-standard-rule', standard.requirement));
        standards.appendChild(item);
      }
      copy.appendChild(standards);

      const command = el('aside', 'vm-camp-command');
      const portrait = document.createElement('img');
      portrait.className = 'vm-camp-command-portrait';
      portrait.setAttribute('src', presentation.commander.portrait);
      portrait.setAttribute('alt', `${presentation.commander.name}, ${presentation.commander.role}`);
      portrait.setAttribute('decoding', 'async');
      command.appendChild(portrait);
      command.appendChild(el('span', 'vm-camp-command-scan'));
      const channel = el('span', 'vm-camp-command-channel', presentation.channel);
      command.appendChild(channel);
      const identity = el('div', 'vm-camp-command-identity');
      identity.appendChild(el('strong', 'vm-camp-command-name', presentation.commander.name));
      identity.appendChild(el('span', 'vm-camp-command-role', presentation.commander.role));
      command.appendChild(identity);
      command.appendChild(el('blockquote', 'vm-camp-command-directive', presentation.directive));
      grid.appendChild(copy);
      grid.appendChild(command);
      wrap.classList.add('has-command');
    } else {
      grid.appendChild(copy);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  unmount(): void {
    this.disposed = true;
    this.host?.classList.remove('vm-page');
    this.host = null;
  }

  onBack(): boolean {
    this.shell.openCampaign();
    return true;
  }
}

function findOperation(
  m: CampaignModule, id: string,
): { chapter: ChapterView; op: OperationView } | null {
  for (const chapter of m.CAMPAIGNS) {
    const op = chapter.operations.find((o) => o.id === id);
    if (op !== undefined) return { chapter, op };
  }
  return null;
}

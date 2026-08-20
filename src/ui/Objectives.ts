/**
 * ============================================================================
 * src/ui/Objectives.ts — THE IN-MATCH OBJECTIVE PANEL
 * ============================================================================
 * Top-right of the HUD: the objectives active in THIS match, with live
 * progress, a completion beat, and a three-state fold. Everything else the
 * progression system knows lives on the missions screen; this panel answers
 * exactly one question — "what am I being asked to do right now" — and is
 * ruthless about answering nothing else.
 *
 * WHY IT IS A SEAM AND NOT AN IMPORT
 * ----------------------------------
 * The progression module is built by a different agent in parallel. Rather than
 * import `src/progression/types.ts` — which may not exist when this compiles,
 * and whose module graph would be dragged into the `?shot=` boot — the frozen
 * contract is restated here as a STRUCTURAL interface and reached through
 * `globalThis.__vmProgression`, exactly as `src/ui/Hud.ts` reaches the
 * production service and as `src/input` reaches the settings store.
 *
 * The consequence is the important part: **with the handle absent this file
 * renders nothing at all.** `tools/shoot.mjs` boots with `?shot=` and never
 * loads the shell or the profile store, and all twelve scenario captures have
 * to look exactly as they did before this module existed. A panel that painted
 * an empty box, or a "no objectives" placeholder, would have changed twelve
 * measured frames for zero information.
 *
 * SPACE IS A BUDGET, NOT A PREFERENCE
 * -----------------------------------
 * Look-bible §9 / scorecard §38 want the whole interface at 12-16% of the frame
 * with the centre and lower-left third clear. `objectivesPanelHeightUnits()`
 * below is the layout arithmetic in code rather than in a comment, and against
 * a 1280x720 frame at 158u wide it reads:
 *
 *   hidden (no objectives)                 0u    0.00%
 *   collapsed                             21u    0.36%
 *   summary, one objective                50u    0.86%
 *   summary, two                          79u    1.35%
 *   summary, three (the cap)             108u    1.85%
 *   expanded, six                        195u    3.34%
 *
 * Those figures went UP on 2026-08-05: the description moved out of the native
 * `title` tooltip and onto the row, at the player's request — "i hate it when
 * we need to hover to see description". That is +12u per row, so the summary
 * fold cost 1.23% before and costs 1.85% now. It is a real price and it is
 * recorded here rather than absorbed quietly. If the panel has to give the
 * space back, the lever is `MAX_VISIBLE_OBJECTIVES`: at the cap of 2 the
 * summary fold is 79u / 1.35%, and the `+N` chip already makes the rest
 * reachable in one click.
 *
 * The panel's cost is the whole of what this file controls. The INTERFACE total
 * is that plus whatever the HUD costs, and the second number is not this file's
 * to quote: `Hud.hudFrameShare()` measured 15.83% in Chromium at 1280x720 while
 * this was written, against the 15.1% an earlier revision of this comment
 * assumed. It is also flat across all three folds, which is the useful fact —
 * the HUD's figure does NOT include this panel, so the two genuinely add. At
 * 15.83% even the collapsed panel puts the interface over §38's 16% ceiling,
 * which means the ceiling is a HUD problem and not a fold problem, and no
 * choice available in this file fixes it. Re-measure rather than trusting the
 * 15.83%: `src/ui/Hud.ts` was being rewritten by another workflow at the time.
 *
 * THE THIRD STATE, AND WHY THE CAP DID NOT MOVE
 * ---------------------------------------------
 * Objective spam is the named risk in `docs/MISSIONS_DESIGN.md` and the cap of
 * three is the cure. What was broken was not the cap: it was that the overflow
 * line CONSUMED one of the three row slots, so a match with four objectives
 * showed two of them and a "+2 more" that led nowhere. The player had no way to
 * read the rest without quitting to the pause menu.
 *
 * Two changes, and the cap is untouched by both:
 *
 *   1. The overflow moved INTO THE HEADER, as a `+N` chip beside the count. The
 *      summary state is therefore three objectives plus the overflow figure in
 *      exactly the 72u that used to buy two objectives plus the overflow
 *      figure. Strictly more information, identical frame cost.
 *   2. That chip is a BUTTON, and it opens the third state: the full list. So
 *      the fold is collapsed / summary / expanded, driven by the two controls
 *      in the header, and persisted the way the collapse toggle already was.
 *
 * The expanded state costs 0.59 of a point more than the summary state at six
 * objectives (2.11% against 1.23%). That is stated rather than buried, and it is
 * defensible for exactly one reason: it is transient and user-invoked. The
 * player pressed a button to read something and will press it again, or
 * collapse the panel, or simply stop looking. A DEFAULT that cost 2.11% would
 * be much harder to argue for, which is why the default is still three rows and
 * why raising the cap was the wrong answer to "let me see all of them".
 *
 * The pause menu (`src/shell/PauseMenu.ts`) carries the authoritative full list
 * and no longer truncates it at four either — the sim is frozen behind it and
 * nothing there is competing for frame budget.
 *
 * THE COMPLETION BEAT
 * -------------------
 * A row that ticks over is held on screen for `COMPLETE_HOLD_SECONDS` with a
 * one-shot flash, and it OUTRANKS incomplete rows for that window — otherwise
 * the objective you just finished is the one that vanishes before you look at
 * it, which is the worst possible reward for completing it.
 *
 * That flash is not enough on its own, because during a fight nobody is looking
 * at this corner. `onComplete` fires once per objective with everything that
 * became complete in the same sample, and `src/ui/ObjectiveBanner.ts` turns it
 * into a centre-screen card. Two rules make that safe to wire up:
 *
 *   - the FIRST sample that sees any objectives only SEEDS `doneAt`; it never
 *     announces. Otherwise reloading into a match mid-way, or a handle that
 *     publishes late, would fire a banner for work finished minutes ago;
 *   - `announced` is never cleared. `doneAt` deliberately re-arms when a
 *     counter falls back below target (a streak broken, a structure lost) so
 *     the ROW flashes again, but the centre-screen card fires at most once per
 *     objective id per match. A banner that can repeat is a banner the player
 *     learns to ignore.
 * ============================================================================
 */

import { el, svgEl } from './Chrome';
import { makeIcon } from './icons';
import { persistentStorage } from '../platform/storage';

import './objectives.css';

/* ==========================================================================
 * SECTION 1 — THE PROGRESSION SEAM
 *
 * A structural restatement of the frozen contract in `src/progression/types.ts`
 * (owned by the progression-core agent). It is deliberately structural: an
 * object satisfying the real interface satisfies this one, and this file
 * compiles, ships and runs whether or not that module ever lands.
 * ========================================================================== */

export type MissionScope = 'profile' | 'match';
export type MissionCategory = 'combat' | 'economy' | 'construction' | 'tactics' | 'mastery';

export type Reward =
  | { kind: 'unlock'; unlockId: string }
  | { kind: 'credits'; amount: number }
  | { kind: 'map'; mapId: string }
  | { kind: 'cosmetic'; cosmeticId: string };

export interface MissionDef {
  id: string;
  scope: MissionScope;
  title: string;
  description: string;
  category: MissionCategory;
  target: number;
  reward: Reward[];
  /** Mission ids. This is how chains form. */
  requires?: string[];
  /** `Faction` enum value, for faction-specific chains. */
  faction?: number;
  difficulty?: 1 | 2 | 3;
  /**
   * TRUE when this objective is DONE-OR-NOT rather than a count, so the row
   * must not draw a counter. A campaign operation's objectives are all of this
   * shape — "Destroy the Allied survey tap" has no "3 of 25" to report.
   *
   * OPTIONAL AND FALSY BY DEFAULT, WHICH IS THE WHOLE SAFETY ARGUMENT. Every
   * skirmish mission row in `src/data/Missions.ts` is a counter and the count
   * IS the point ("destroy 60 enemy vehicles"); a provider that has never heard
   * of this field keeps the rendering it has always had, member for member.
   * That is also what keeps this interface a structural RESTATEMENT of
   * `src/progression/types.ts` rather than a second contract — the same reason
   * `unlockSource?` below is optional.
   *
   * IT IS NOT `target === 1`, AND THAT DISTINCTION IS THE FIX. Reading the
   * target is a heuristic that is wrong in both directions: a campaign
   * objective is a flag whatever its target reads, and a skirmish mission that
   * legitimately counts to one of something ("build a Proving Ground") is a counter
   * and would be silently relabelled. `src/shell/PauseMenu.ts` still infers it
   * from `target <= 1`; that is the sibling screen and outside this change.
   *
   * NO EXISTING FIELD ANSWERED THIS. `ObjectiveDef.kind` in
   * `src/campaign/types.ts` is `'primary' | 'secondary'` — how much the
   * objective MATTERS, not whether it counts, and both halves are flags.
   * `category` is thematic and `scope` says where progress is banked.
   */
  flag?: boolean;
}

export interface MissionProgress {
  id: string;
  value: number;
  target: number;
  complete: boolean;
  claimedAt: number | null;
}

/** A mission with live progress merged in — what `activeObjectives()` yields. */
export type ActiveObjective = MissionDef & { progress: MissionProgress };

/** The same, plus the gate state — what `catalogue()` yields. */
export type CatalogueEntry = ActiveObjective & { locked: boolean };

export interface ProfileView {
  version: number;
  unlocked: readonly string[];
  missions: readonly MissionProgress[];
}

/**
 * WHERE AN UNLOCK COMES FROM. What the build palette needs in order to stop
 * saying "complete a mission" and start saying WHICH.
 *
 * A player hovered a locked Proving Ground, read "Locked — complete a mission", and
 * asked whether they were supposed to guess. They were: `LOCKED_REASON` in
 * `src/progression/UnlockGate.ts` is one constant with no mission in it, and
 * the palette printed it verbatim. The data to do better has always existed —
 * the def carries `unlockedBy`, and exactly one mission grants each id — but
 * nothing joined the two.
 */
export interface UnlockSource {
  /** The mission's stable id. Not shown; lets a caller deep-link the screen. */
  readonly missionId: string;
  /** 'Strip Mine'. The name the missions screen shows. */
  readonly title: string;
  /** 'Mine 70,000 credits of ore'. What the player has to actually do. */
  readonly objective: string;
}

/** What the UI reads. Never mutate what this returns. */
export interface ProgressionView {
  profile(): ProfileView;
  catalogue(): readonly CatalogueEntry[];
  activeObjectives(): readonly ActiveObjective[];
  drainPending(): readonly Reward[];
  isUnlocked(unlockId: string): boolean;
  subscribe(fn: () => void): () => void;
  resetProfile(): void;
  exportProfile(): string;
  importProfile(json: string): boolean;
  /**
   * The mission that grants `unlockId`, or null when nothing does.
   *
   * OPTIONAL, and deliberately so. It is owned by `src/progression/**`, which
   * is a different module's file; this interface is a structural RESTATEMENT of
   * that handle (see `readProgression` below), so declaring the member required
   * would make every existing handle fail to typecheck against it and would
   * make `readProgression`'s probe reject a live progression layer that simply
   * predates the lookup.
   *
   * Absent, the palette falls back to the generic sentence it printed before —
   * which is the same "an absent handle is a supported configuration" rule the
   * whole of this seam is built on.
   */
  unlockSource?(unlockId: string): UnlockSource | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __vmProgression: ProgressionView | undefined;
}

/**
 * The live progression handle, or null.
 *
 * Duck-typed rather than instanceof-checked for the same reason the HUD
 * duck-types the settings store: the two modules must not share a class, and a
 * half-built handle published by a module still initialising is a real state
 * this has to survive. Every member the UI actually calls is verified, so a
 * `true` from here means the panel can run without a single defensive check at
 * the call sites.
 */
export function readProgression(): ProgressionView | null {
  const g = globalThis as { __vmProgression?: unknown };
  const p = g.__vmProgression;
  if (typeof p !== 'object' || p === null) return null;
  const v = p as Partial<ProgressionView>;
  if (typeof v.activeObjectives !== 'function') return null;
  if (typeof v.catalogue !== 'function') return null;
  if (typeof v.profile !== 'function') return null;
  if (typeof v.subscribe !== 'function') return null;
  if (typeof v.drainPending !== 'function') return null;
  return p as ProgressionView;
}

/* ==========================================================================
 * SECTION 2 — SELECTION POLICY (pure, and therefore testable)
 * ========================================================================== */

/** Hard cap on rows in the SUMMARY state. The cure for "objective spam". */
export const MAX_VISIBLE_OBJECTIVES = 3;

/**
 * Hard cap on rows in the EXPANDED state.
 *
 * Not a design constraint — a fuse. A match is authored with a handful of
 * objectives, and twelve rows is already 233u, a third of a 720p frame. Past
 * that the list would reach the build dock and the panel would stop being a
 * panel, so it counts instead.
 */
export const MAX_EXPANDED_OBJECTIVES = 12;

/** Seconds a freshly completed objective is held at the top of the panel. */
export const COMPLETE_HOLD_SECONDS = 10;

/* -- layout arithmetic, in code so the header comment cannot go stale ----- */

/** Panel width in design units. Mirrors `.vm-objectives` in hud.css. */
export const PANEL_WIDTH_UNITS = 158;
/**
 * Padding on each of the four sides.
 *
 * RAISED 4 -> 9 ON 2026-08-06. The reporter, on the shipped build: "objectives
 * is dense in a level i can barely understand it." It was 4u of padding with 2u
 * gaps throughout, and those numbers existed to hit the frame budget in the
 * header above rather than because anyone judged them readable. The budget's
 * authority has also lapsed — it derives from the RA3 reference frames the
 * project has since abandoned. Legibility wins; the cost is stated below and
 * still asserted, just against an honest number.
 */
const PAD_UNITS = 9;
/** The header row. */
const HEAD_UNITS = 16;
/** Header-to-list gap, and the gap between two rows. */
const GAP_UNITS = 5;
/**
 * The inline description under each title: a 1u margin and an 11u line box.
 *
 * `objectives.css` states that height literally rather than deriving it from
 * `line-height`, so this constant and the stylesheet cannot drift apart. The
 * panel's frame cost is a budgeted number pinned by a test, not something to be
 * discovered from type metrics at runtime.
 */
const DESC_UNITS = 12;
/**
 * One objective row: an 11u title line, the 12u description, a 3u gap and a
 * 2u bar.
 *
 * Every objective authored in `src/data/Missions.ts` — all 49 — carries a
 * description, so the description is modelled as always present. A row without
 * one is 12u SHORTER than this says, which is the safe direction for a budget
 * to be wrong in.
 */
const ROW_UNITS = 19 + DESC_UNITS;

/** The three folds the panel can be in. Persisted across matches. */
export type ObjectivesView = 'collapsed' | 'summary' | 'expanded';

/**
 * Height of the panel in design units, for a fold and a row count.
 *
 * This is the same arithmetic as `objectives.css` plus the `.vm-objectives`
 * block in hud.css, restated in TypeScript because the frame budget is a claim
 * this project makes out loud and a claim that only exists in a comment is one
 * nobody can fail. `tests/objectives-ux.spec.ts` pins every reading in the file
 * header against it.
 */
export function objectivesPanelHeightUnits(view: ObjectivesView, rows: number): number {
  const n = Math.max(0, Math.floor(rows));
  if (n === 0) return 0;
  const shell = PAD_UNITS + HEAD_UNITS + PAD_UNITS;
  if (view === 'collapsed') return shell;
  return shell + GAP_UNITS + n * ROW_UNITS + (n - 1) * GAP_UNITS;
}

/** Fraction of a frame a panel of `heightUnits` occupies at `uiScale` 1. */
export function objectivesFrameShareOf(
  heightUnits: number,
  frameW: number,
  frameH: number,
): number {
  if (frameW <= 0 || frameH <= 0) return 0;
  return (PANEL_WIDTH_UNITS * heightUnits) / (frameW * frameH);
}

/** Progress as a 0..1 fraction, total for any target including a zero one. */
export function objectiveFraction(p: MissionProgress): number {
  if (p.complete) return 1;
  const target = p.target > 0 ? p.target : 1;
  const f = p.value / target;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * `12 / 25`, or `DONE` once it is complete.
 *
 * `flag` is `MissionDef.flag` — a done-or-not objective, which renders an EMPTY
 * readout until it is done. There is no honest counter to print for one: `0 / 1`
 * is a progress bar for something that has no progress, and it was the first
 * thing a player saw in every campaign operation. The row still carries the
 * title, the tick and the bar, so the state is on screen; only the fake
 * fraction is gone, and `DONE` still lands on completion for both shapes.
 *
 * DEFAULTS FALSE, so every existing caller — and every skirmish objective —
 * gets exactly the string it got before, `0 / 1` for a target of 1 included.
 */
export function objectiveReadout(p: MissionProgress, flag = false): string {
  if (p.complete) return 'DONE';
  if (flag) return '';
  if (p.target <= 1) return '0 / 1';
  const value = Math.max(0, Math.min(p.target, Math.floor(p.value)));
  return `${value} / ${p.target}`;
}

/**
 * Which objectives get a row, in display order.
 *
 * Recently-completed first — they own the beat and must not be pushed off by
 * whatever became active in the same instant — then incomplete in the order the
 * provider gave them, which is the authored order. Anything past the cap is the
 * caller's overflow count.
 *
 * `doneAt` maps objective id -> the panel clock reading when it completed;
 * entries older than `COMPLETE_HOLD_SECONDS` stop outranking anything and drop
 * to the bottom of the list, so a match that finishes six objectives does not
 * end up showing six ticks and no live work.
 *
 * @param now Panel clock, in seconds. Not a wall clock — see the system module.
 */
export function selectVisibleObjectives(
  active: readonly ActiveObjective[],
  doneAt: ReadonlyMap<string, number>,
  now: number,
  max: number = MAX_VISIBLE_OBJECTIVES,
): { rows: ActiveObjective[]; overflow: number } {
  const fresh: ActiveObjective[] = [];
  const live: ActiveObjective[] = [];
  const stale: ActiveObjective[] = [];

  for (const o of active) {
    if (!o.progress.complete) {
      live.push(o);
      continue;
    }
    const at = doneAt.get(o.id);
    if (at !== undefined && now - at <= COMPLETE_HOLD_SECONDS) fresh.push(o);
    else stale.push(o);
  }

  const ordered = [...fresh, ...live, ...stale];
  const limit = max < 0 ? 0 : max;
  return {
    rows: ordered.slice(0, limit),
    overflow: Math.max(0, ordered.length - limit),
  };
}

/**
 * A cheap change key for the visible set.
 *
 * The panel rebuilds its rows only when this moves, so a match in which nothing
 * advances costs one string comparison per sample and zero DOM work.
 */
export function objectiveSignature(rows: readonly ActiveObjective[], overflow: number): string {
  let out = `${overflow}`;
  for (const o of rows) {
    out += `|${o.id}:${Math.floor(o.progress.value)}/${o.progress.target}:${o.progress.complete ? 1 : 0}`;
  }
  return out;
}

/* ==========================================================================
 * SECTION 3 — FOLD STATE
 *
 * Persisted, because a player who folds this away means it, and a panel that
 * unfolded itself every match would be worse than no toggle at all. It is one
 * key of its own rather than a field in the settings store: the store is in the
 * lazily-loaded shell chunk and the HUD is not allowed to depend on the shell
 * existing.
 * ========================================================================== */

/** The tri-state key. */
export const OBJECTIVES_VIEW_KEY = 'vm.objectives.view';
/**
 * The boolean this replaced. Read once, on a profile that predates the third
 * state, so a player who folded the panel away last week still finds it folded
 * away. Never written.
 */
export const OBJECTIVES_LEGACY_COLLAPSE_KEY = 'vm.objectives.collapsed';

function isView(value: unknown): value is ObjectivesView {
  return value === 'collapsed' || value === 'summary' || value === 'expanded';
}

export function readStoredView(): ObjectivesView {
  try {
    const store = persistentStorage();
    const raw = store.getItem(OBJECTIVES_VIEW_KEY);
    if (isView(raw)) return raw;
    if (store?.getItem(OBJECTIVES_LEGACY_COLLAPSE_KEY) === '1') return 'collapsed';
  } catch {
    /* Private mode, or a storage quota. The default is the right default. */
  }
  return 'summary';
}

export function writeStoredView(view: ObjectivesView): void {
  try {
    persistentStorage().setItem(OBJECTIVES_VIEW_KEY, view);
  } catch {
    /* The fold still works this session; it just will not survive a reload. */
  }
}

/**
 * The header caret's transition: collapsed <-> whichever open fold was last in
 * use. A caret that always reopened into `summary` would silently undo a player
 * who chose the full list, every time they folded the panel to look at the map.
 */
export function toggleCollapseView(
  view: ObjectivesView,
  lastOpen: 'summary' | 'expanded',
): ObjectivesView {
  return view === 'collapsed' ? lastOpen : 'collapsed';
}

/** The `+N` chip's transition: into the full list, and back out of it. */
export function toggleExpandView(view: ObjectivesView): ObjectivesView {
  return view === 'expanded' ? 'summary' : 'expanded';
}

/* ==========================================================================
 * SECTION 4 — THE PANEL
 * ========================================================================== */

/** One pooled row. Rebuilt in place; the list is never re-created. */
interface Row {
  root: HTMLElement;
  name: HTMLElement;
  /**
   * The objective's description, rendered INLINE under the title.
   *
   * It used to live only in `root.title` — a native browser tooltip. That is
   * information you can only get by hovering, during a match, while something
   * is shooting at you. An objective the player cannot read without stopping to
   * point at it may as well not have a description.
   */
  desc: HTMLElement;
  value: HTMLElement;
  fill: HTMLElement;
  tick: SVGSVGElement;
  /** The id currently rendered, so a flash fires once per completion. */
  id: string;
  complete: boolean;
}

export interface ObjectivesOptions {
  /** Where the panel lives. The HUD root, in practice. */
  mount: HTMLElement;
  /** Injected for tests; production reads `globalThis.__vmProgression`. */
  progression?: ProgressionView | null;
  /**
   * Fired once per objective, with everything that completed in the same
   * sample. `ui/objectives.system.ts` turns it into the centre-screen beat.
   */
  onComplete?: (done: readonly ActiveObjective[]) => void;
}

export class ObjectivesPanel {
  readonly root: HTMLElement;

  private readonly list: HTMLElement;
  private readonly head: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly title: HTMLElement;
  private readonly count: HTMLElement;
  private readonly caret: SVGSVGElement;
  private readonly all: HTMLButtonElement;
  private readonly rows: Row[] = [];

  private progression: ProgressionView | null;
  private readonly onComplete: ((done: readonly ActiveObjective[]) => void) | null;
  private unsubscribe: (() => void) | null = null;

  /** Panel clock. Advanced by `frame(dt)`; never a wall clock. */
  private clock = 0;
  /** Seconds until the next poll. Belt to the subscription's braces. */
  private pollIn = 0;
  /** Seconds until the next re-probe for a late-publishing handle. */
  private probeIn = 0;
  private dirty = true;
  private signature = '';
  private view: ObjectivesView = readStoredView();
  private lastOpen: 'summary' | 'expanded' = this.view === 'collapsed' ? 'summary' : this.view;
  private disposed = false;

  /** Panel-clock reading at which each objective completed. */
  private readonly doneAt = new Map<string, number>();
  /** Ids the centre-screen beat has already fired for. Never cleared. */
  private readonly announced = new Set<string>();
  /** False until the first sample carrying any objectives has been absorbed. */
  private seeded = false;

  /** How many objectives the summary fold is hiding. Drives the `+N` chip. */
  private hidden = 0;
  /** True while the full list is actually on screen. */
  private showingAll = false;
  /** Rows on screen right now, for `objectivesFrameShare`'s sibling readout. */
  private visibleRows = 0;

  /** Measured, for the frame-share log. Zero while the panel is empty. */
  private lastArea = 0;

  constructor(options: ObjectivesOptions) {
    this.progression = options.progression ?? readProgression();
    this.onComplete = options.onComplete ?? null;

    this.root = el('div', 'vm-panel vm-objectives', options.mount);
    this.root.dataset.notch = 'diag-rev';
    el('i', 'vm-panel-edge', this.root);
    this.root.hidden = true;

    /* -- header -------------------------------------------------------- *
     * A group, not a control. It used to BE the collapse button, but the
     * third state needs a second click target and a button inside a button
     * is invalid HTML that browsers resolve by dropping one of them.        */
    this.head = el('div', 'vm-obj-head', this.root);
    this.head.setAttribute('role', 'group');
    this.head.setAttribute('aria-label', 'Objectives');

    this.toggle = el('button', 'vm-obj-toggle', this.head);
    this.toggle.type = 'button';
    this.title = el('span', 'vm-obj-title', this.toggle);
    this.title.textContent = 'Objectives';
    this.count = el('span', 'vm-obj-count vm-num', this.toggle);
    this.caret = caretIcon();
    this.toggle.appendChild(this.caret);
    this.toggle.addEventListener('click', () => {
      this.setView(toggleCollapseView(this.view, this.lastOpen));
    });

    this.all = el('button', 'vm-obj-all', this.head);
    this.all.type = 'button';
    this.all.hidden = true;
    this.all.addEventListener('click', () => {
      this.setView(toggleExpandView(this.view));
    });

    /* -- rows ---------------------------------------------------------- *
     * The pool starts at the summary cap and grows on demand, once, the
     * first time the player opens the full list.                           */
    this.list = el('div', 'vm-obj-list', this.root);
    this.list.id = `vm-obj-list-${nextListId()}`;
    this.toggle.setAttribute('aria-controls', this.list.id);
    this.all.setAttribute('aria-controls', this.list.id);
    this.ensureRows(MAX_VISIBLE_OBJECTIVES);

    this.applyView();
    this.bind();
    this.sync();
  }

  /* -------------------------------------------------------------------- */
  /* public surface                                                        */
  /* -------------------------------------------------------------------- */

  /**
   * Advance the panel.
   *
   * Sampling is event-driven through `subscribe`, with a 0.5 s poll behind it so
   * a provider that forgets to notify still produces a live panel rather than a
   * frozen one. Neither path allocates unless the visible set actually moved.
   */
  frame(dt: number): void {
    if (this.disposed) return;
    this.clock += dt;

    if (this.progression === null) {
      this.probeIn -= dt;
      if (this.probeIn > 0) return;
      this.probeIn = 1;
      const found = readProgression();
      if (found === null) return;
      this.progression = found;
      this.bind();
      this.dirty = true;
    }

    this.pollIn -= dt;
    if (this.pollIn <= 0) {
      this.pollIn = 0.5;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.sync();
  }

  /** Fraction of the frame the panel occupies. 0 when it is not showing. */
  objectivesFrameShare(): number {
    if (this.root.hidden) return 0;
    const w = globalThis.innerWidth || 0;
    const h = globalThis.innerHeight || 0;
    if (w <= 0 || h <= 0) return 0;
    return this.lastArea / (w * h);
  }

  /**
   * The same figure derived from the layout arithmetic instead of from a
   * `getBoundingClientRect`. Reported alongside the measured one so a drift
   * between the stylesheet and `objectivesPanelHeightUnits` is visible in the
   * console rather than discovered by a critic.
   */
  objectivesFrameShareModelled(frameW = 1280, frameH = 720): number {
    if (this.root.hidden) return 0;
    return objectivesFrameShareOf(
      objectivesPanelHeightUnits(this.view, this.visibleRows),
      frameW,
      frameH,
    );
  }

  /** True while there is something worth showing. */
  get active(): boolean {
    return !this.root.hidden;
  }

  /** The current fold. */
  get fold(): ObjectivesView {
    return this.view;
  }

  /** Rows on screen. 0 when collapsed or hidden. */
  get rowCount(): number {
    return this.view === 'collapsed' || this.root.hidden ? 0 : this.visibleRows;
  }

  /** How many objectives the summary fold is hiding. */
  get hiddenCount(): number {
    return this.hidden;
  }

  setView(value: ObjectivesView): void {
    if (this.view === value) return;
    this.view = value;
    if (value !== 'collapsed') this.lastOpen = value;
    writeStoredView(value);
    this.applyView();
    // The fold changes which rows exist, and the signature guard would
    // otherwise short-circuit the rebuild that has to follow it.
    this.signature = '';
    this.sync();
  }

  /** Back-compatible boolean face of the fold. */
  setCollapsed(value: boolean): void {
    this.setView(value ? 'collapsed' : this.lastOpen);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.progression = null;
    this.doneAt.clear();
    this.announced.clear();
    this.root.remove();
  }

  /* -------------------------------------------------------------------- */
  /* internals                                                             */
  /* -------------------------------------------------------------------- */

  /**
   * Replace the source this panel reads.
   *
   * FOR THE CAMPAIGN, AND IT EXISTS BECAUSE THE CONSTRUCTOR IS TOO EARLY.
   * `ui.objectives` and `game.campaign` are separate system modules and the
   * registry does not promise which one's `init()` runs first — measured, it is
   * this one, so `campaignSession()` is still null when the panel is built and
   * an injected view resolved there is always null. The first frame is the
   * earliest moment both halves exist.
   *
   * `null` restores the probe, so the panel falls back to `__vmProgression`
   * exactly as it always did when an operation ends.
   */
  setProgression(next: ProgressionView | null): void {
    if (this.progression === next) return;
    this.progression = next ?? readProgression();
    // `bind()` drops the previous subscription itself, so there is exactly one
    // place that owns that lifetime and this cannot leak a second listener.
    this.bind();
    this.dirty = true;
  }

  private bind(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const p = this.progression;
    if (p === null) return;
    try {
      this.unsubscribe = p.subscribe(() => { this.dirty = true; });
    } catch {
      /* A provider whose subscribe throws still gets polled. */
    }
  }

  /** Grow the row pool to `n`. Never shrinks — rows are hidden, not destroyed. */
  private ensureRows(n: number): void {
    while (this.rows.length < n) this.rows.push(this.makeRow());
  }

  private makeRow(): Row {
    const root = el('div', 'vm-obj', this.list);
    const top = el('div', 'vm-obj-top', root);
    const name = el('span', 'vm-obj-name', top);
    // `hidden` is an HTMLElement property; an SVG element does not have one, so
    // the tick is shown and hidden by a class the stylesheet owns.
    const tick = makeIcon('ready', 'vm-icon vm-obj-tick');
    top.appendChild(tick);
    const value = el('span', 'vm-obj-value vm-num', top);
    // Under the title, above the progress bar: the description belongs between
    // "what is this" and "how far along am I".
    const desc = el('span', 'vm-obj-desc', root);
    const bar = el('div', 'vm-obj-bar', root);
    const fill = el('i', 'vm-obj-fill', bar);
    root.hidden = true;
    return { root, name, desc, value, fill, tick, id: '', complete: false };
  }

  private applyView(): void {
    const collapsed = this.view === 'collapsed';
    this.root.classList.toggle('is-collapsed', collapsed);
    this.root.classList.toggle('is-expanded', this.showingAll);
    this.toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    this.caret.style.transform = collapsed ? 'rotate(-90deg)' : '';
    this.toggle.title = collapsed ? 'Show objectives' : 'Hide objectives';
    this.renderChip();
  }

  /**
   * The `+N` / `Less` chip.
   *
   * Absent entirely when nothing is hidden — a control that would do nothing is
   * a control the player has to read and then discard, which is exactly the
   * noise the cap exists to prevent.
   */
  private renderChip(): void {
    const expandable = this.hidden > 0 || this.showingAll;
    this.all.hidden = !expandable;
    if (!expandable) return;
    this.all.textContent = this.showingAll ? 'Less' : `+${this.hidden}`;
    this.all.setAttribute('aria-expanded', this.showingAll ? 'true' : 'false');
    this.all.title = this.showingAll
      ? 'Show the first three objectives only'
      : `Show all objectives (${this.hidden} hidden)`;
  }

  /** Read the provider and reconcile the DOM. The only place that writes rows. */
  private sync(): void {
    const p = this.progression;
    let active: readonly ActiveObjective[] = EMPTY;
    if (p !== null) {
      try {
        active = p.activeObjectives();
      } catch {
        active = EMPTY;
      }
    }

    // Stamp completions the moment they are first observed, so the hold window
    // starts when the player could have seen it, not when the sim decided it.
    const fresh: ActiveObjective[] = [];
    for (const o of active) {
      if (o.progress.complete) {
        if (!this.doneAt.has(o.id)) {
          this.doneAt.set(o.id, this.clock);
          if (this.seeded && !this.announced.has(o.id)) fresh.push(o);
          this.announced.add(o.id);
        }
      } else if (this.doneAt.has(o.id)) {
        // A counter that went back below target — a streak broken, a structure
        // lost. Re-arm the ROW flash, but not the centre-screen beat: see the
        // file header on why `announced` is never cleared.
        this.doneAt.delete(o.id);
      }
    }
    if (!this.seeded && active.length > 0) this.seeded = true;
    if (fresh.length > 0 && this.onComplete !== null) {
      try {
        this.onComplete(fresh);
      } catch (err) {
        // A broken beat must never take the panel down with it.
        console.warn('[objectives] completion handler threw', err);
      }
    }

    // The summary fold shows three; the expanded fold shows everything up to
    // the fuse. `hidden` is what the header chip counts, and it is a property
    // of the OBJECTIVE SET rather than of the current fold, so the chip does
    // not disappear the moment the player opens the list.
    this.hidden = Math.max(0, active.length - MAX_VISIBLE_OBJECTIVES);
    this.showingAll = this.view === 'expanded' && this.hidden > 0;
    const max = this.showingAll ? MAX_EXPANDED_OBJECTIVES : MAX_VISIBLE_OBJECTIVES;

    const { rows, overflow } = selectVisibleObjectives(active, this.doneAt, this.clock, max);
    const signature = `${this.view}|${this.showingAll ? 1 : 0}|${objectiveSignature(rows, overflow)}`;
    const empty = rows.length === 0;

    if (this.root.hidden !== empty) {
      this.root.hidden = empty;
      this.measure();
    }
    if (empty) {
      this.signature = '';
      this.visibleRows = 0;
      this.hidden = 0;
      this.showingAll = false;
      this.renderChip();
      return;
    }
    if (signature === this.signature) return;
    this.signature = signature;

    this.root.classList.toggle('is-expanded', this.showingAll);
    this.renderChip();

    let done = 0;
    for (const o of active) if (o.progress.complete) done++;
    this.count.textContent = `${done}/${active.length}`;

    this.ensureRows(rows.length);
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      const o = rows[i];
      if (o === undefined) {
        row.root.hidden = true;
        row.id = '';
        continue;
      }
      this.fillRow(row, o);
    }
    this.visibleRows = rows.length;
    this.measure();
  }

  private fillRow(row: Row, o: ActiveObjective): void {
    const complete = o.progress.complete;
    const changed = row.id !== o.id;

    row.root.hidden = false;
    // The tooltip stays as the overflow path only: the inline line is clamped
    // to two lines, so a long description is still readable on hover. It is a
    // fallback now, not the only way to read this.
    row.root.title = o.description;
    if (changed) {
      row.name.textContent = o.title;
      row.desc.textContent = o.description;
      // An objective with no description must not leave an empty line behind
      // it, which would make the rows different heights for no visible reason.
      row.desc.hidden = o.description.length === 0;
      row.id = o.id;
      row.complete = false;
      row.root.classList.remove('is-flash');
    }

    // A flag objective reads empty until it is done, and the cell is HIDDEN
    // rather than merely blanked: `.vm-obj-top` is a flex row with a 4u gap, so
    // an empty span still spends a gap it has nothing to separate. Never empty
    // for a counter, so a skirmish row is untouched by both lines.
    const readout = objectiveReadout(o.progress, o.flag === true);
    row.value.textContent = readout;
    row.value.hidden = readout === '';
    row.fill.style.width = `${(objectiveFraction(o.progress) * 100).toFixed(1)}%`;
    row.root.classList.toggle('is-done', complete);
    row.tick.classList.toggle('is-on', complete);

    // The beat: one flash, on the transition only. Restarting a CSS animation
    // needs the class off, a reflow read, and the class back on — without the
    // read the browser coalesces both writes and nothing plays.
    if (complete && !row.complete) {
      row.root.classList.remove('is-flash');
      void row.root.offsetWidth;
      row.root.classList.add('is-flash');
    }
    row.complete = complete;
  }

  /** One layout read, only when the visible set changed shape. */
  private measure(): void {
    if (this.root.hidden) {
      this.lastArea = 0;
      return;
    }
    const r = this.root.getBoundingClientRect();
    this.lastArea = r.width * r.height;
  }
}

const EMPTY: readonly ActiveObjective[] = [];

/** Unique ids for `aria-controls`, so two panels can never collide. */
let listSeq = 0;
function nextListId(): number {
  listSeq += 1;
  return listSeq;
}

/** The collapse caret. `src/ui/icons.ts` has no chevron and does not need one. */
function caretIcon(): SVGSVGElement {
  const svg = svgEl('svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'vm-icon vm-obj-caret');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = svgEl('path', svg);
  path.setAttribute('d', 'M6 9.5 12 15.5 18 9.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.7');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  return svg;
}

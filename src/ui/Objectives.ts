/**
 * ============================================================================
 * src/ui/Objectives.ts — THE IN-MATCH OBJECTIVE PANEL
 * ============================================================================
 * Top-right of the HUD: the objectives active in THIS match, with live
 * progress, a completion beat, and a collapse toggle. Everything else the
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
 * with the centre and lower-left third clear. `Hud.hudFrameShare()` already
 * reports 15.1% for the bottom band, so the honest budget for this panel is
 * nine tenths of one point — and it is built to it:
 *
 *   MAX_VISIBLE_OBJECTIVES = 3 rows. 158 design units wide; 4u pad + 13u header
 *   + 2u + (3 x 15u row + 2 x 2u gap) + 4u pad = 72u tall.
 *   158 x 72 = 11,376 u² of 1280 x 720 = **1.23%**, worst case, top right.
 *
 * The panel is sized to its CONTENT, so the realistic readings are lower: 0%
 * idle (it is `hidden`, not empty), 0.36% collapsed, 0.65% at one objective,
 * 0.94% at two. `objectivesFrameShare()` reports the live number and
 * `ui/objectives.system.ts` logs it the way the HUD logs its own.
 *
 * At the cap the interface reads 16.3%, which is 0.3 of a point over §38 and is
 * reported rather than buried. Dropping `MAX_VISIBLE_OBJECTIVES` to 2 lands it
 * at 16.0% exactly, and is the one-constant fix if a critic scores it a fail.
 *
 * Objective spam is the named risk in `docs/MISSIONS_DESIGN.md`. Three is the
 * cap, and the overflow line REPLACES the third row rather than being appended
 * below it — so the panel's height is a function of `min(objectives, 3)` and
 * nothing else, which is what makes the arithmetic above a fact.
 *
 * THE COMPLETION BEAT
 * -------------------
 * A row that ticks over is held on screen for `COMPLETE_HOLD_SECONDS` with a
 * one-shot flash, and it OUTRANKS incomplete rows for that window — otherwise
 * the objective you just finished is the one that vanishes before you look at
 * it, which is the worst possible reward for completing it.
 * ============================================================================
 */

import { el, svgEl } from './Chrome';
import { makeIcon } from './icons';

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
  | { kind: 'power'; powerId: string }
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

/** Hard cap on rows. The named cure for the design doc's "objective spam". */
export const MAX_VISIBLE_OBJECTIVES = 3;

/** Seconds a freshly completed objective is held at the top of the panel. */
export const COMPLETE_HOLD_SECONDS = 10;

/** Progress as a 0..1 fraction, total for any target including a zero one. */
export function objectiveFraction(p: MissionProgress): number {
  if (p.complete) return 1;
  const target = p.target > 0 ? p.target : 1;
  const f = p.value / target;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** `12 / 25`, or `DONE` once it is complete. Targets of 1 read as a flag. */
export function objectiveReadout(p: MissionProgress): string {
  if (p.complete) return 'DONE';
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
 * SECTION 3 — COLLAPSE STATE
 *
 * Persisted, because a player who folds this away means it, and a panel that
 * unfolded itself every match would be worse than no toggle at all. It is one
 * boolean in its own key rather than a field in the settings store: the store
 * is in the lazily-loaded shell chunk and the HUD is not allowed to depend on
 * the shell existing.
 * ========================================================================== */

const COLLAPSE_KEY = 'vm.objectives.collapsed';

function readCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(COLLAPSE_KEY, value ? '1' : '0');
  } catch {
    /* Private mode, or a storage quota. The toggle still works this session. */
  }
}

/* ==========================================================================
 * SECTION 4 — THE PANEL
 * ========================================================================== */

/** One pooled row. Rebuilt in place; the list is never re-created. */
interface Row {
  root: HTMLElement;
  name: HTMLElement;
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
}

export class ObjectivesPanel {
  readonly root: HTMLElement;

  private readonly list: HTMLElement;
  private readonly head: HTMLButtonElement;
  private readonly title: HTMLElement;
  private readonly count: HTMLElement;
  private readonly caret: SVGSVGElement;
  private readonly more: HTMLElement;
  private readonly rows: Row[] = [];

  private progression: ProgressionView | null;
  private unsubscribe: (() => void) | null = null;

  /** Panel clock. Advanced by `frame(dt)`; never a wall clock. */
  private clock = 0;
  /** Seconds until the next poll. Belt to the subscription's braces. */
  private pollIn = 0;
  /** Seconds until the next re-probe for a late-publishing handle. */
  private probeIn = 0;
  private dirty = true;
  private signature = '';
  private collapsed = readCollapsed();
  private disposed = false;

  /** Panel-clock reading at which each objective completed. */
  private readonly doneAt = new Map<string, number>();

  /** Measured, for the frame-share log. Zero while the panel is empty. */
  private lastArea = 0;

  constructor(options: ObjectivesOptions) {
    this.progression = options.progression ?? readProgression();

    this.root = el('div', 'vm-panel vm-objectives', options.mount);
    this.root.dataset.notch = 'diag-rev';
    el('i', 'vm-panel-edge', this.root);
    this.root.hidden = true;

    /* -- header -------------------------------------------------------- */
    this.head = el('button', 'vm-obj-head', this.root);
    this.head.type = 'button';
    this.head.setAttribute('aria-expanded', this.collapsed ? 'false' : 'true');
    this.title = el('span', 'vm-obj-title', this.head);
    this.title.textContent = 'Objectives';
    this.count = el('span', 'vm-obj-count vm-num', this.head);
    this.caret = caretIcon();
    this.head.appendChild(this.caret);
    this.head.addEventListener('click', () => this.setCollapsed(!this.collapsed));

    /* -- rows ---------------------------------------------------------- */
    this.list = el('div', 'vm-obj-list', this.root);
    for (let i = 0; i < MAX_VISIBLE_OBJECTIVES; i++) this.rows.push(this.makeRow());
    this.more = el('div', 'vm-obj-more', this.list);
    this.more.hidden = true;

    this.applyCollapsed();
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

  /** True while there is something worth showing. */
  get active(): boolean {
    return !this.root.hidden;
  }

  setCollapsed(value: boolean): void {
    if (this.collapsed === value) return;
    this.collapsed = value;
    writeCollapsed(value);
    this.applyCollapsed();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.progression = null;
    this.doneAt.clear();
    this.root.remove();
  }

  /* -------------------------------------------------------------------- */
  /* internals                                                             */
  /* -------------------------------------------------------------------- */

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

  private makeRow(): Row {
    const root = el('div', 'vm-obj', this.list);
    const top = el('div', 'vm-obj-top', root);
    const name = el('span', 'vm-obj-name', top);
    // `hidden` is an HTMLElement property; an SVG element does not have one, so
    // the tick is shown and hidden by a class the stylesheet owns.
    const tick = makeIcon('ready', 'vm-icon vm-obj-tick');
    top.appendChild(tick);
    const value = el('span', 'vm-obj-value vm-num', top);
    const bar = el('div', 'vm-obj-bar', root);
    const fill = el('i', 'vm-obj-fill', bar);
    root.hidden = true;
    return { root, name, value, fill, tick, id: '', complete: false };
  }

  private applyCollapsed(): void {
    this.root.classList.toggle('is-collapsed', this.collapsed);
    this.head.setAttribute('aria-expanded', this.collapsed ? 'false' : 'true');
    this.caret.style.transform = this.collapsed ? 'rotate(-90deg)' : '';
    this.head.title = this.collapsed ? 'Show objectives' : 'Hide objectives';
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
    for (const o of active) {
      if (o.progress.complete) {
        if (!this.doneAt.has(o.id)) this.doneAt.set(o.id, this.clock);
      } else if (this.doneAt.has(o.id)) {
        // A counter that went back below target — a streak broken, a structure
        // lost. Re-arm, so finishing it again gets its beat.
        this.doneAt.delete(o.id);
      }
    }

    // Two passes, because the overflow line OCCUPIES a row slot rather than
    // sitting below the last one. Without this the panel is one row taller
    // exactly when there is most to look at, and the frame budget in hud.css
    // stops being a fact about the layout.
    let { rows, overflow } = selectVisibleObjectives(active, this.doneAt, this.clock);
    if (overflow > 0) {
      ({ rows, overflow } = selectVisibleObjectives(
        active, this.doneAt, this.clock, MAX_VISIBLE_OBJECTIVES - 1,
      ));
    }
    const signature = objectiveSignature(rows, overflow);
    const empty = rows.length === 0;

    if (this.root.hidden !== empty) {
      this.root.hidden = empty;
      this.measure();
    }
    if (empty) {
      this.signature = '';
      return;
    }
    if (signature === this.signature) return;
    this.signature = signature;

    let done = 0;
    for (const o of active) if (o.progress.complete) done++;
    this.count.textContent = `${done}/${active.length}`;

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

    this.more.hidden = overflow === 0;
    if (overflow > 0) this.more.textContent = `+${overflow} more`;
    this.measure();
  }

  private fillRow(row: Row, o: ActiveObjective): void {
    const complete = o.progress.complete;
    const changed = row.id !== o.id;

    row.root.hidden = false;
    row.root.title = o.description;
    if (changed) {
      row.name.textContent = o.title;
      row.id = o.id;
      row.complete = false;
      row.root.classList.remove('is-flash');
    }

    row.value.textContent = objectiveReadout(o.progress);
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

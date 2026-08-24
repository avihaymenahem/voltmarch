/**
 * ============================================================================
 * src/ui/ObjectiveBanner.ts — THE CENTRE-SCREEN SUCCESS BEAT
 * ============================================================================
 * Finishing an objective used to be a 900 ms wash on a 15u row in the top-right
 * corner. During a fight the player is not looking at the top-right corner, so
 * the single most rewarding thing that happens outside combat was routinely
 * missed entirely. This is the amplifier: one card, centre column, upper third,
 * for a little under three seconds.
 *
 * WHY THIS IS NOT A TOAST
 * -----------------------
 * `Chrome.ToastStack` already exists and already coalesces, and it was the
 * obvious thing to extend. Two reasons it is the wrong home:
 *
 *   1. A toast is deliberately peripheral. Top-left, 11 px, next to "low power"
 *      and "construction complete" — the chips you learn to read with the edge
 *      of your eye. Putting the completion there would fix nothing, because
 *      "the player is not looking at that corner" is the entire bug.
 *   2. The live `ToastStack` belongs to `Hud`, which this workflow does not own
 *      and must not edit. Reaching it would mean a global handle into another
 *      agent's object graph for a single call.
 *
 * So it is a distinct overlay with a distinct lifetime, mounted by
 * `ui/objectives.system.ts`, which owns it end to end.
 *
 * IT CANNOT EAT A CLICK
 * ---------------------
 * The layer spans the whole frame. Every element in it is `pointer-events:
 * none` and NOTHING in it is interactive — no button, no link, no tabindex, no
 * listener. `assertBannerIsInert()` is exported so the test suite can prove
 * that by walking the built tree rather than by trusting this paragraph. A
 * full-frame div that swallows a right-click mid-battle is a catastrophic bug
 * and a trivially easy one to ship, which is why it is asserted rather than
 * reviewed.
 *
 * IT DOES NOT QUEUE
 * -----------------
 * There is exactly one card, ever. Two objectives finishing in the same sample
 * arrive in one `announce()` call and produce one card with two names. A second
 * `announce()` inside `BANNER_MERGE_WINDOW` merges into the live card WITHOUT
 * touching its clock, so the worst case for "two objectives, half a second
 * apart" is still one card and still ~2.9 s total — not two cards, and not a
 * stall. Later than that, the new announcement REPLACES the card. Nothing is
 * ever buffered for later.
 *
 * THE AUDIO LINE IS AN EVENT, NOT A CALL
 * --------------------------------------
 * `src/audio/**` is owned by another workflow. Rather than reach into it, every
 * beat dispatches `vm:objective-complete` on `globalThis` with the ids and
 * titles (see `ObjectiveCompleteDetail`). The audio hook is one `addEventListener`
 * away and needs no edit here.
 * ============================================================================
 */

import { el } from './Chrome';
import { makeIcon } from './icons';
import type { ActiveObjective, Reward } from './Objectives';

import './objectives.css';

/* ==========================================================================
 * SECTION 1 — TIMING
 *
 * Numbers, not feelings: the brief is "short and non-blocking", so the whole
 * beat is under three seconds and the hold is the only part a player has time
 * to consciously read.
 * ========================================================================== */

/** Seconds of lead-in. Matches the reward-reveal card in shell.css. */
export const BANNER_ENTER = 0.34;
/** Seconds fully opaque. Long enough to read two lines, short enough to ignore. */
export const BANNER_HOLD = 2.10;
/** Seconds of fade-out. */
export const BANNER_EXIT = 0.46;
/** Total life of one beat. */
export const BANNER_LIFE = BANNER_ENTER + BANNER_HOLD + BANNER_EXIT;

/**
 * Seconds within which a second completion merges into the live card instead of
 * replacing it. A merge does NOT extend the card's life — that is the whole
 * point, and it is what stops "two objectives in one second" turning into a
 * four-second stall.
 */
export const BANNER_MERGE_WINDOW = 1.20;

/** Names printed before the card starts counting instead of listing. */
export const BANNER_MAX_NAMES = 3;

/* ==========================================================================
 * SECTION 2 — COPY (pure, and therefore testable)
 * ========================================================================== */

/** `vm:objective-complete`. The audio hook's subscription point. */
export const OBJECTIVE_COMPLETE_EVENT = 'vm:objective-complete';

export interface ObjectiveCompleteDetail {
  /** Mission ids that completed in this beat. Never empty. */
  readonly ids: readonly string[];
  /** Their titles, in the same order. */
  readonly titles: readonly string[];
  /** `ids.length`. Present so a listener does not have to reach into an array. */
  readonly count: number;
  /** True when more than one objective completed in the same sample. */
  readonly coalesced: boolean;
}

/**
 * Dispatch the completion event.
 *
 * Separate from the banner so the event still fires on a frame where the layer
 * is hidden by a media query, and so a test can assert the payload without
 * building any DOM.
 */
export function emitObjectiveComplete(done: readonly ActiveObjective[]): ObjectiveCompleteDetail | null {
  if (done.length === 0) return null;
  const detail: ObjectiveCompleteDetail = {
    ids: done.map((o) => o.id),
    titles: done.map((o) => o.title),
    count: done.length,
    coalesced: done.length > 1,
  };
  const target = globalThis as { dispatchEvent?: (e: Event) => boolean };
  if (typeof CustomEvent === 'function' && typeof target.dispatchEvent === 'function') {
    target.dispatchEvent(new CustomEvent(OBJECTIVE_COMPLETE_EVENT, { detail }));
  }
  return detail;
}

/** `oreBaron` / `ore-baron` / `ore_baron` -> `Ore Baron`. */
export function humaniseRewardId(id: string): string {
  const spaced = id
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (spaced === '') return '';
  return spaced
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * One line naming what the completion paid out, or `''`.
 *
 * `src/shell/Missions.ts` has richer copy for exactly this, and it is NOT
 * imported: it lives in the lazily-loaded shell chunk, and the rule this whole
 * corner of the HUD is built on is that the HUD never depends on the shell
 * existing. Only the single-line form is restated, and only for the first
 * reward — a card that lists three payouts is a card nobody finishes reading.
 */
export function rewardSummary(
  rewards: readonly Reward[] | undefined,
  creditRewardPaid = false,
): string {
  if (rewards === undefined || rewards.length === 0) return '';
  // Match-objective credit rewards are authored metadata with no economy
  // consumer. Do not advertise them. Campaign objectives opt in because their
  // runtime grants the bounty before the completion reaches this banner.
  const visible = creditRewardPaid ? rewards : rewards.filter((r) => r.kind !== 'credits');
  if (visible.length === 0) return '';
  const r = visible[0];
  const extra = visible.length > 1 ? ` +${visible.length - 1} more` : '';
  switch (r.kind) {
    case 'credits': return `+${Math.max(0, Math.floor(r.amount))} credits${extra}`;
    case 'unlock': return `${humaniseRewardId(r.unlockId)} unlocked${extra}`;
    case 'map': return `Map: ${humaniseRewardId(r.mapId)}${extra}`;
    case 'cosmetic': return `${humaniseRewardId(r.cosmeticId)} unlocked${extra}`;
    default: return '';
  }
}

/** `OBJECTIVE COMPLETE` for one, plural past that. */
export function bannerKicker(count: number): string {
  return count > 1 ? 'Objectives Complete' : 'Objective Complete';
}

/**
 * The lines the card prints for a set of completions.
 *
 * Up to `BANNER_MAX_NAMES` titles, then a count. Pure, so "six objectives
 * finished at once does not produce a six-line card in the middle of the
 * screen" is a test rather than a hope.
 */
export function bannerLines(done: readonly ActiveObjective[]): string[] {
  const lines: string[] = [];
  const shown = Math.min(done.length, BANNER_MAX_NAMES);
  for (let i = 0; i < shown; i++) lines.push(done[i].title);
  if (done.length > shown) lines.push(`+${done.length - shown} more`);
  return lines;
}

/**
 * Merge an incoming set into the live one, preserving order and dropping ids
 * already on the card. Returns a NEW array; the inputs are not mutated.
 */
export function mergeCompletions(
  live: readonly ActiveObjective[],
  incoming: readonly ActiveObjective[],
): ActiveObjective[] {
  const out = [...live];
  const seen = new Set(out.map((o) => o.id));
  for (const o of incoming) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}

/* ==========================================================================
 * SECTION 3 — INERTNESS, ASSERTED
 * ========================================================================== */

/** Tags that can take a click or a focus even with no listener attached. */
const INTERACTIVE_TAGS = new Set([
  'A', 'AREA', 'BUTTON', 'DETAILS', 'EMBED', 'IFRAME', 'INPUT', 'LABEL',
  'OBJECT', 'SELECT', 'SUMMARY', 'TEXTAREA',
]);

/**
 * Walk a subtree and return every reason it could capture a pointer.
 *
 * Empty means inert. Used by `tests/objectives-ux.spec.ts`; exported rather
 * than kept private because a claim about pointer capture that only the author
 * ever checked is a claim, not a guarantee.
 */
export function bannerInertnessFaults(root: Element): string[] {
  const faults: string[] = [];
  const walk = (node: Element): void => {
    const tag = node.tagName.toUpperCase();
    if (INTERACTIVE_TAGS.has(tag)) faults.push(`interactive element <${tag.toLowerCase()}>`);
    if (node.hasAttribute('tabindex')) faults.push(`tabindex on <${tag.toLowerCase()}>`);
    if (node.hasAttribute('onclick')) faults.push(`onclick on <${tag.toLowerCase()}>`);
    const style = (node as HTMLElement).style as CSSStyleDeclaration | undefined;
    const pe = style?.pointerEvents;
    if (pe !== undefined && pe !== '' && pe !== 'none') {
      faults.push(`inline pointer-events:${pe} on <${tag.toLowerCase()}>`);
    }
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) walk(kids[i]);
  };
  walk(root);
  return faults;
}

/* ==========================================================================
 * SECTION 4 — THE BANNER
 * ========================================================================== */

export interface ObjectiveBannerOptions {
  /** Where the layer lives. The HUD root, in practice. */
  mount: HTMLElement;
  /**
   * Dispatch `vm:objective-complete` alongside the visual beat. Default true;
   * tests turn it off so a suite run does not spray events at a shared global.
   */
  emitEvent?: boolean;
}

export class ObjectiveBanner {
  readonly root: HTMLElement;

  private readonly card: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly names: HTMLElement;
  private readonly sub: HTMLElement;
  /** Pooled name lines. Grown to `BANNER_MAX_NAMES + 1` and never past it. */
  private readonly nameRows: HTMLElement[] = [];

  private readonly emitEvent: boolean;

  /** The completions currently on the card. Empty while idle. */
  private shown: ActiveObjective[] = [];
  /** Seconds since the current beat started. */
  private age = 0;
  private live = false;
  private exiting = false;
  private disposed = false;

  constructor(options: ObjectiveBannerOptions) {
    this.emitEvent = options.emitEvent ?? true;

    this.root = el('div', 'vm-objdone-layer', options.mount);
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;

    const slot = el('div', 'vm-objdone-slot', this.root);
    this.card = el('div', 'vm-objdone', slot);

    const mark = el('span', 'vm-objdone-mark', this.card);
    mark.appendChild(makeIcon('ready', 'vm-icon'));

    const body = el('div', 'vm-objdone-body', this.card);
    this.kicker = el('span', 'vm-objdone-kicker', body);
    this.names = el('div', 'vm-objdone-names', body);
    this.sub = el('span', 'vm-objdone-sub', body);
    this.sub.hidden = true;
  }

  /* -------------------------------------------------------------------- */
  /* public surface                                                        */
  /* -------------------------------------------------------------------- */

  /** True while a card is on screen. */
  get active(): boolean { return this.live; }

  /** Seconds into the current beat. 0 while idle. */
  get elapsed(): number { return this.live ? this.age : 0; }

  /** Ids currently named by the card, for tests and for `__VM`. */
  get shownIds(): readonly string[] { return this.shown.map((o) => o.id); }

  /**
   * Raise the beat.
   *
   * Merges into the live card when it is young enough, replaces it when it is
   * not, and never queues. Ignores an empty list, which is what lets the caller
   * hand it whatever `sync()` observed without a guard at the call site.
   */
  announce(done: readonly ActiveObjective[]): void {
    if (this.disposed || done.length === 0) return;

    if (this.emitEvent) emitObjectiveComplete(done);

    const mergeable = this.live && !this.exiting && this.age < BANNER_MERGE_WINDOW;
    if (mergeable) {
      const merged = mergeCompletions(this.shown, done);
      // Nothing new — the beat is already saying this.
      if (merged.length === this.shown.length) return;
      this.shown = merged;
      this.paint();
      return;
    }

    this.shown = [...done];
    this.age = 0;
    this.live = true;
    this.exiting = false;
    this.root.hidden = false;
    this.paint();

    // Restarting a CSS animation needs the class off, a layout read, and the
    // class back on; without the read the browser coalesces both writes and the
    // lead-in never plays. Same trick as the row flash in Objectives.ts.
    this.card.classList.remove('is-enter', 'is-exit');
    void this.card.offsetWidth;
    this.card.classList.add('is-enter');
  }

  /** Advance the beat. Called once per rendered frame. */
  frame(dt: number): void {
    if (!this.live || this.disposed) return;
    this.age += dt;

    if (!this.exiting && this.age >= BANNER_ENTER + BANNER_HOLD) {
      this.exiting = true;
      this.card.classList.remove('is-enter');
      this.card.classList.add('is-exit');
    }
    if (this.age >= BANNER_LIFE) this.clear();
  }

  /** Take the card down immediately. */
  clear(): void {
    this.live = false;
    this.exiting = false;
    this.age = 0;
    this.shown = [];
    this.card.classList.remove('is-enter', 'is-exit');
    this.root.hidden = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.root.remove();
  }

  /* -------------------------------------------------------------------- */
  /* internals                                                             */
  /* -------------------------------------------------------------------- */

  /** Write the current completion set onto the card. Allocates nothing new. */
  private paint(): void {
    this.kicker.textContent = bannerKicker(this.shown.length);

    const lines = bannerLines(this.shown);
    while (this.nameRows.length < lines.length) {
      this.nameRows.push(el('div', 'vm-objdone-name', this.names));
    }
    for (let i = 0; i < this.nameRows.length; i++) {
      const row = this.nameRows[i];
      const text = lines[i];
      if (text === undefined) {
        row.hidden = true;
        continue;
      }
      row.hidden = false;
      row.textContent = text;
    }

    // The reward line is only honest for a single completion: two objectives
    // paying out different things cannot share one line, and picking one of
    // them to print would be worse than printing neither.
    const sub = this.shown.length === 1
      ? rewardSummary(this.shown[0].reward, this.shown[0].creditRewardPaid === true)
      : '';
    this.sub.textContent = sub;
    this.sub.hidden = sub === '';
  }
}

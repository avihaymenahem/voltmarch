/**
 * ============================================================================
 * src/shell/Missions.ts — the missions screen
 * ============================================================================
 * The screen that has to make a player want the next thing.
 *
 * `docs/MISSIONS_DESIGN.md` is blunt about it: "the deliverable is not add
 * missions — missions are only the delivery mechanism. The actual design is the
 * unlock curve." A screen that lists tasks and ticks them off implements the
 * delivery mechanism and none of the design. So every card here leads with the
 * REWARD — what it is, what kind of thing it is, and what having it actually
 * changes — and the progress bar is the supporting detail rather than the
 * subject.
 *
 * CHAINS, NOT A CHECKLIST
 * -----------------------
 * `MissionDef.requires` is the only structure the data carries, and it is
 * enough: within a category, a mission with no in-category prerequisite is a
 * chain root and everything that (transitively) requires it hangs off it in
 * breadth order. `buildChains` is pure and covered by tests, because a cycle or
 * a dangling id in the mission table must produce a rendered screen with a
 * visible complaint rather than an infinite loop in the front end.
 *
 * A prerequisite in ANOTHER category is not dropped — it becomes an "after X"
 * note on the card. Silently hiding a gate is how a player ends up staring at a
 * locked row with no idea what to do about it.
 *
 * WHERE IT LIVES
 * --------------
 * `MissionsPanel` is a plain DOM component in the exact shape of `HelpPanel`
 * (`root`, `dispose()`, `onKeyDown()`), so any screen that already has a layer
 * can host it without the shell growing a state:
 *
 *   PauseMenu.ts   hides its own card and mounts this over the frozen frame
 *   EndScreen.ts   same, straight off the reward reveal
 *
 * `MissionsScreen` wraps it as a `Screen` for a host that DOES want a full
 * screen — the title menu, which this agent does not own. See the report.
 *
 * DEGRADING IS THE DEFAULT, NOT THE EDGE CASE
 * -------------------------------------------
 * The progression handle is read from `globalThis.__vmProgression` and may be
 * absent: a `?shot=` boot never publishes one. With no handle the screen
 * renders an honest empty state. Profile file management lives in Settings.
 * ============================================================================
 */

import {
  readProgression,
  type CatalogueEntry,
  type MissionCategory,
  type MissionProgress,
  type ProgressionView,
  type Reward,
} from '../ui/Objectives';

import {
  button,
  el,
  focusable,
  icon,
  pageFrame,
  type Screen,
  type Shell,
} from './Shell';

/* ==========================================================================
 * 1. CATEGORIES
 *
 * The five in the frozen contract, in the order a player meets them. Each
 * carries the sentence that says what the category is FOR, because "Tactics"
 * on its own is a word, not a promise.
 * ========================================================================== */

export interface CategoryDef {
  readonly id: MissionCategory;
  readonly label: string;
  readonly blurb: string;
  readonly iconName: string;
}

export const MISSION_CATEGORIES: readonly CategoryDef[] = [
  {
    id: 'combat',
    label: 'Combat',
    blurb: 'Kills, trades and field control. The chains that open specialist hardware.',
    iconName: 'swords',
  },
  {
    id: 'economy',
    label: 'Economy',
    blurb: 'Ore, banking and expansion. Pays out in maps and in credits you keep.',
    iconName: 'coins',
  },
  {
    id: 'construction',
    label: 'Construction',
    blurb: 'Base building and tech. Where the advanced structures and defences come from.',
    iconName: 'power',
  },
  {
    id: 'tactics',
    label: 'Tactics',
    blurb: 'How you win, not whether. Capture, timing and force preservation.',
    iconName: 'target',
  },
  {
    id: 'mastery',
    label: 'Mastery',
    blurb: 'The long chains. Superweapons and commander powers sit at the end of these.',
    iconName: 'trophy',
  },
];

/* ==========================================================================
 * 2. REWARDS — the part that has to sell
 * ========================================================================== */

export interface RewardCopy {
  /** What kind of thing this is. Uppercase, four to eighteen characters. */
  kind: string;
  /** The thing itself, humanised from its id. */
  name: string;
  /** What having it actually changes. One clause, present tense. */
  effect: string;
  iconName: string;
}

/**
 * `sentry-gun` / `sentry_gun` / `sentryGun` -> `Sentry Gun`.
 *
 * The contract hands the UI ids and nothing else, so this is the whole of what
 * can honestly be said about an unlock's name. It is deliberately not a lookup
 * table: a table here would go stale the first time the progression agent added
 * a row, and a screen that prints a wrong unlock name is worse than one that
 * prints a plain one.
 *
 * THE EXAMPLE IS A KEY NOBODY RENAMED, AND THAT IS THE POINT. `prismTank`
 * humanises to "Prism Tank" while the unit is called the Refractor Tank: the
 * transform reads the KEY, and the 2026-08-19 rename deliberately moved no key.
 * Illustrating it with a renamed row would teach the wrong lesson twice over.
 */
export function humaniseId(id: string): string {
  const spaced = id
    .replace(/[_\-.:]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (spaced === '') return 'Unknown';
  return spaced
    .split(/\s+/)
    .map((w) => (w.length <= 2 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * Namespace tokens that a reward id leads with and a player must never read.
 *
 * The authored ids are `unit.raider`, `struct.defence.specialist`,
 * `power.orbital-scan`, `map.frozen-sector`, `cosmetic.insignia.warlord`. Every
 * one of those leading tokens is ALREADY on screen as the reward's kind label,
 * so printing it again gives "Unlock / Unit Raider" — the word "Unit" doing no
 * work at all and the eye reading it before the name.
 *
 * Only the FIRST token goes, and only when it is in this set. `cosmetic.decal.
 * grid` becomes "Decal Grid" rather than "Grid", because the second token is
 * genuinely part of the name.
 */
const ID_NAMESPACES: ReadonlySet<string> = new Set([
  'unit', 'units', 'struct', 'structs', 'structure', 'structures', 'building',
  'buildings', 'power', 'powers', 'map', 'maps', 'cosmetic', 'cosmetics',
]);

/** `unit.raider` -> `Raider`. Falls back to the whole id when it is bare. */
export function unlockLabel(id: string): string {
  const cut = id.indexOf('.');
  if (cut > 0 && ID_NAMESPACES.has(id.slice(0, cut).toLowerCase())) {
    const rest = id.slice(cut + 1);
    if (rest.replace(/[_\-.:]+/g, '').trim() !== '') return humaniseId(rest);
  }
  return humaniseId(id);
}

/** Thousands-separated, for a credit reward. */
function credits(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('en-US');
}

/** Everything the screen can truthfully say about one reward. */
export function rewardCopy(r: Reward): RewardCopy {
  switch (r.kind) {
    case 'unlock':
      return {
        kind: 'Unlock',
        name: unlockLabel(r.unlockId),
        effect: 'Buildable from the sidebar in every future match.',
        iconName: 'target',
      };
    case 'credits':
      return {
        kind: 'Bounty',
        name: `${credits(r.amount)} Credits`,
        effect: 'Paid into the match that completes it.',
        iconName: 'coins',
      };
    case 'map':
      return {
        kind: 'Battlefield',
        name: unlockLabel(r.mapId),
        effect: 'Selectable in the skirmish lobby.',
        iconName: 'map',
      };
    /* Cosmetics are collection rewards, not combat modifiers. Profile.ts
     * derives its gallery from the typed rewards, joins ownership through
     * profile.unlocked, and keeps the object plus its awarding mission visible
     * after the one-frame banner has gone. */
    case 'cosmetic':
      return {
        kind: r.cosmeticId.includes('.decal.') ? 'Field Decal' : 'Insignia',
        name: unlockLabel(r.cosmeticId),
        effect: 'Added permanently to your Service Record honours collection.',
        iconName: 'flag',
      };
    default:
      return { kind: 'Reward', name: 'Unknown', effect: '', iconName: 'info' };
  }
}

/**
 * Maps and cosmetics carry a generic ownership reward plus a typed twin. The
 * generic row feeds persistence/gating; the typed row feeds presentation.
 * Showing both produces two cards for one award and makes a decal claim it is
 * "buildable from the sidebar", so exact twins collapse to the typed row.
 */
export function presentableRewards(rewards: readonly Reward[]): Reward[] {
  const typed = new Set<string>();
  for (const reward of rewards) {
    if (reward.kind === 'map') typed.add(reward.mapId);
    else if (reward.kind === 'cosmetic') typed.add(reward.cosmeticId);
  }
  return rewards.filter((reward) => reward.kind !== 'unlock' || !typed.has(reward.unlockId));
}

/* ==========================================================================
 * 3. CHAINS — pure, and therefore tested
 * ========================================================================== */

export interface ChainNode {
  entry: CatalogueEntry;
  /** 0 for a chain root; one more than its in-category prerequisite. */
  depth: number;
  /** In-category prerequisite titles, for the "after X" note. */
  after: string[];
  /** Prerequisites that live outside this category or outside the table. */
  foreign: string[];
}

export type Chain = ChainNode[];

/**
 * Group one category's missions into chains.
 *
 * Breadth-first from every root, which gives the reading order a player expects
 * (do this, then these two, then that) and — the reason it is BFS and not a
 * recursive walk — cannot blow the stack or loop forever on a mission table
 * that accidentally contains a cycle. A cycle simply leaves its members
 * unreachable from any root; they are emitted afterwards as their own chain so
 * that a data bug is VISIBLE on the screen rather than silently swallowing
 * content.
 */
export function buildChains(entries: readonly CatalogueEntry[]): Chain[] {
  const byId = new Map<string, CatalogueEntry>();
  for (const e of entries) byId.set(e.id, e);

  const titleOf = (id: string): string => byId.get(id)?.title ?? humaniseId(id);
  const inCategory = (id: string): boolean => byId.has(id);

  /** id -> the ids that require it. */
  const children = new Map<string, string[]>();
  const roots: CatalogueEntry[] = [];

  for (const e of entries) {
    const parents = (e.requires ?? []).filter(inCategory);
    if (parents.length === 0) {
      roots.push(e);
      continue;
    }
    for (const p of parents) {
      const list = children.get(p);
      if (list === undefined) children.set(p, [e.id]);
      else list.push(e.id);
    }
  }

  const seen = new Set<string>();
  const chains: Chain[] = [];

  const emit = (start: CatalogueEntry): void => {
    const chain: Chain = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: start.id, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (seen.has(id)) continue;
      const entry = byId.get(id);
      if (entry === undefined) continue;
      seen.add(id);

      const requires = entry.requires ?? [];
      chain.push({
        entry,
        depth,
        after: requires.filter(inCategory).map(titleOf),
        foreign: requires.filter((r) => !inCategory(r)).map(titleOf),
      });

      for (const kid of children.get(id) ?? []) {
        if (!seen.has(kid)) queue.push({ id: kid, depth: depth + 1 });
      }
    }
    if (chain.length > 0) chains.push(chain);
  };

  for (const r of roots) emit(r);
  // Anything a cycle made unreachable. Never silently dropped.
  for (const e of entries) if (!seen.has(e.id)) emit(e);

  return chains;
}

/* ==========================================================================
 * 4. STATE COPY
 * ========================================================================== */

export type MissionState = 'locked' | 'active' | 'complete';

export function missionState(entry: CatalogueEntry): MissionState {
  if (entry.progress.complete) return 'complete';
  return entry.locked ? 'locked' : 'active';
}

/** Progress as 0..1. Shared with the objective panel's policy, restated for the
 *  shell so this file has no runtime dependency on `src/ui`. */
function fractionOf(p: MissionProgress): number {
  if (p.complete) return 1;
  const target = p.target > 0 ? p.target : 1;
  const f = p.value / target;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

function readoutOf(p: MissionProgress): string {
  if (p.complete) return 'Complete';
  if (p.target <= 1) return 'Not started';
  const value = Math.max(0, Math.min(p.target, Math.floor(p.value)));
  return `${value.toLocaleString('en-US')} / ${p.target.toLocaleString('en-US')}`;
}

/** The one-line summary the header carries. */
export function summarise(entries: readonly CatalogueEntry[], unlocked: number): string {
  let done = 0;
  for (const e of entries) if (e.progress.complete) done++;
  if (entries.length === 0) return 'No missions authored yet';
  return `${done} of ${entries.length} complete · ${unlocked} unlock${unlocked === 1 ? '' : 's'} earned`;
}

/* ==========================================================================
 * 5. THE PANEL
 * ========================================================================== */

export interface MissionsPanelOptions {
  /** Back / Escape / the Close button. */
  onClose: () => void;
  /** Injected by tests; production reads `globalThis.__vmProgression`. */
  progression?: ProgressionView | null;
}

export class MissionsPanel {
  readonly root: HTMLElement;

  private readonly body: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly sections = new Map<string, HTMLElement>();
  private readonly progression: ProgressionView | null;
  private unsubscribe: (() => void) | null = null;

  constructor(options: MissionsPanelOptions) {
    this.progression = options.progression ?? readProgression();

    this.root = el('div', 'vm-missions');
    const frame = pageFrame('Missions', options.onClose);
    frame.root.classList.add('vm-missions-panel');

    this.summary = el('span', 'vm-missions-summary', '');
    frame.head.appendChild(this.summary);

    /* -- jump rail ------------------------------------------------------ */
    const rail = el('nav', 'vm-missions-rail');
    rail.setAttribute('aria-label', 'Jump to a category');
    for (const cat of MISSION_CATEGORIES) rail.appendChild(this.railButton(cat));
    frame.root.insertBefore(rail, frame.body);

    this.body = frame.body;
    this.body.classList.add('vm-missions-body');

    /* -- foot ----------------------------------------------------------- */
    frame.foot.appendChild(button('Close', { variant: 'primary', onClick: options.onClose }));

    this.root.appendChild(frame.root);
    this.render();

    if (this.progression !== null) {
      try {
        this.unsubscribe = this.progression.subscribe(() => this.render());
      } catch {
        /* A provider whose subscribe throws still renders once, correctly. */
      }
    }
  }

  /** Drop the subscription. The host removes DOM. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Page-scroll keys only. Up/Down and Enter belong to the shell's focus ring,
   * and a screen this tall needs a way down that is not forty presses.
   */
  onKeyDown(e: KeyboardEvent): boolean {
    const page = Math.max(120, this.body.clientHeight - 60);
    switch (e.code) {
      case 'PageDown': this.body.scrollTop += page; return true;
      case 'PageUp': this.body.scrollTop -= page; return true;
      case 'Home': this.body.scrollTop = 0; return true;
      case 'End': this.body.scrollTop = this.body.scrollHeight; return true;
      default: return false;
    }
  }

  /* -------------------------------------------------------------------- */
  /* rendering                                                             */
  /* -------------------------------------------------------------------- */

  private railButton(cat: CategoryDef): HTMLElement {
    const b = el('button', 'vm-missions-jump');
    b.type = 'button';
    b.appendChild(icon(cat.iconName, 14));
    b.appendChild(el('span', undefined, cat.label));
    focusable(b);
    b.addEventListener('click', () => {
      const section = this.sections.get(cat.id);
      if (section === undefined) return;
      // Offset arithmetic rather than `scrollIntoView`, which on some browsers
      // also scrolls the shell layer this panel is mounted into.
      this.body.scrollTop = section.offsetTop - this.body.offsetTop;
    });
    return b;
  }

  private render(): void {
    this.body.replaceChildren();
    this.sections.clear();

    const p = this.progression;
    if (p === null) {
      this.summary.textContent = 'Progression offline';
      this.body.appendChild(this.emptyState(
        'Progression is not running',
        'Missions track from the event bus while a match is live. Start a skirmish and ' +
        'this screen fills in. If it stays empty the profile store failed to load — your ' +
        'saved progress is untouched either way.',
      ));
      return;
    }

    let entries: readonly CatalogueEntry[] = [];
    let unlocked: readonly string[] = [];
    try {
      entries = p.catalogue();
      unlocked = p.profile().unlocked;
    } catch (err) {
      this.summary.textContent = 'Profile unreadable';
      this.body.appendChild(this.emptyState(
        'The profile could not be read',
        `${String(err)}. Import a profile below, or reset — a reset produces a fresh ` +
        'profile rather than leaving a broken one in place.',
      ));
      return;
    }

    this.summary.textContent = summarise(entries, unlocked.length);

    if (unlocked.length > 0) this.body.appendChild(this.earnedStrip(unlocked));

    if (entries.length === 0) {
      this.body.appendChild(this.emptyState(
        'No missions authored yet',
        'The mission table is empty. Every unlock is therefore available from the start, ' +
        'which is the correct behaviour for a profile that has nothing to earn.',
      ));
      return;
    }

    for (const cat of MISSION_CATEGORIES) {
      const mine = entries.filter((e) => e.category === cat.id);
      if (mine.length === 0) continue;
      this.body.appendChild(this.renderCategory(cat, mine));
    }
  }

  /** What the player already has. Concrete, above the fold, and never a count. */
  private earnedStrip(unlocked: readonly string[]): HTMLElement {
    const wrap = el('section', 'vm-missions-earned');
    wrap.appendChild(el('h3', 'vm-h3', 'Earned'));
    const chips = el('div', 'vm-missions-chips');
    for (const id of unlocked) {
      const chip = el('div', 'vm-chip');
      chip.appendChild(icon('check', 13));
      chip.appendChild(el('span', undefined, unlockLabel(id)));
      chips.appendChild(chip);
    }
    wrap.appendChild(chips);
    return wrap;
  }

  private renderCategory(cat: CategoryDef, entries: readonly CatalogueEntry[]): HTMLElement {
    const section = el('section', 'vm-missions-section');
    const head = el('div', 'vm-missions-cat');
    head.appendChild(icon(cat.iconName, 16));
    head.appendChild(el('h3', 'vm-h3', cat.label));
    section.appendChild(head);
    section.appendChild(el('p', 'vm-body vm-missions-blurb', cat.blurb));

    for (const chain of buildChains(entries)) {
      const list = el('div', 'vm-chain');
      for (const node of chain) list.appendChild(this.renderMission(node));
      section.appendChild(list);
    }

    this.sections.set(cat.id, section);
    return section;
  }

  private renderMission(node: ChainNode): HTMLElement {
    const { entry } = node;
    const state = missionState(entry);

    const card = el('article', `vm-mission is-${state}`);
    // Depth is a data attribute, not an inline margin: the rail that draws the
    // chain is a pseudo-element and needs the indent in one place only.
    card.dataset.depth = String(Math.min(3, node.depth));

    /* -- head ------------------------------------------------------------ */
    const head = el('div', 'vm-mission-head');
    head.appendChild(el('h4', 'vm-mission-title', entry.title));

    if (entry.difficulty !== undefined) {
      const pips = el('div', 'vm-mission-diff');
      pips.title = `Difficulty ${entry.difficulty} of 3`;
      for (let i = 1; i <= 3; i++) {
        const pip = el('i', 'vm-mission-pip');
        if (i <= entry.difficulty) pip.classList.add('is-on');
        pips.appendChild(pip);
      }
      head.appendChild(pips);
    }

    if (entry.scope === 'match') {
      head.appendChild(el('span', 'vm-mission-scope', 'In match'));
    }
    head.appendChild(el('span', `vm-mission-state is-${state}`, STATE_LABEL[state]));
    card.appendChild(head);

    card.appendChild(el('p', 'vm-mission-desc', entry.description));

    /* -- gate ------------------------------------------------------------ */
    const gates = [...node.after, ...node.foreign];
    if (state === 'locked' && gates.length > 0) {
      const gate = el('p', 'vm-mission-gate');
      gate.appendChild(icon('info', 13));
      gate.appendChild(el('span', undefined, `Complete ${gates.join(' and ')} first`));
      card.appendChild(gate);
    } else if (gates.length > 0) {
      card.appendChild(el('p', 'vm-mission-after', `Follows ${gates.join(' · ')}`));
    }

    /* -- track ----------------------------------------------------------- */
    const track = el('div', 'vm-mission-track');
    const bar = el('div', 'vm-mission-bar');
    const fill = el('i', 'vm-mission-fill');
    fill.style.width = `${(fractionOf(entry.progress) * 100).toFixed(1)}%`;
    bar.appendChild(fill);
    track.appendChild(bar);
    track.appendChild(el('span', 'vm-mission-value vm-num', readoutOf(entry.progress)));
    card.appendChild(track);

    /* -- rewards --------------------------------------------------------- */
    if (entry.reward.length > 0) {
      const rewards = el('div', 'vm-mission-rewards');
      for (const r of presentableRewards(entry.reward)) {
        rewards.appendChild(rewardCard(r, state === 'complete'));
      }
      card.appendChild(rewards);
    }

    return card;
  }

  private emptyState(title: string, detail: string): HTMLElement {
    const box = el('div', 'vm-missions-empty');
    box.appendChild(el('h3', 'vm-h3', title));
    box.appendChild(el('p', 'vm-body', detail));
    return box;
  }

}

const STATE_LABEL: Readonly<Record<MissionState, string>> = {
  locked: 'Locked',
  active: 'In progress',
  complete: 'Complete',
};

/** One reward, as its own object rather than a line of text. */
function rewardCard(r: Reward, earned: boolean): HTMLElement {
  const copy = rewardCopy(r);
  const box = el('div', `vm-reward${earned ? ' is-earned' : ''}`);
  const glyph = el('div', 'vm-reward-icon');
  glyph.appendChild(icon(copy.iconName, 18));
  box.appendChild(glyph);

  const text = el('div', 'vm-reward-text');
  text.appendChild(el('span', 'vm-reward-kind', copy.kind));
  text.appendChild(el('span', 'vm-reward-name', copy.name));
  if (copy.effect !== '') text.appendChild(el('span', 'vm-reward-effect', copy.effect));
  box.appendChild(text);

  if (earned) {
    const tick = el('span', 'vm-reward-tick');
    tick.appendChild(icon('check', 14));
    box.appendChild(tick);
  }
  return box;
}

/* ==========================================================================
 * 6. THE SCREEN WRAPPER
 *
 * For a host that wants a whole shell state rather than an overlay — the title
 * menu. `MainMenu.ts` is owned by another agent; adding an entry there is three
 * lines and the signature is documented in this module's report.
 * ========================================================================== */

export class MissionsScreen implements Screen {
  readonly id = 'missions';
  private host: HTMLElement | null = null;
  private panel: MissionsPanel | null = null;

  /**
   * @param shell Used only for the default back action.
   * @param onClose Overrides where Back goes. Defaults to the title screen.
   */
  constructor(
    private readonly shell: Shell,
    private readonly onClose?: () => void,
  ) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page', 'is-modal');
    this.panel = new MissionsPanel({ onClose: () => this.close() });
    host.appendChild(this.panel.root);
  }

  unmount(): void {
    this.panel?.dispose();
    this.panel = null;
    this.host?.classList.remove('vm-page', 'is-modal');
    this.host = null;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    return this.panel !== null && this.panel.onKeyDown(e);
  }

  onBack(): boolean {
    this.close();
    return true;
  }

  private close(): void {
    if (this.onClose !== undefined) this.onClose();
    else this.shell.showMenu();
  }
}

/**
 * ============================================================================
 * src/shell/Missions.ts — the missions screen
 * ============================================================================
 * A bounded catalogue: five compact rows and one complete mission dossier.
 * Categories and filters change results, not the scroll position. Chains keep
 * authored order; prerequisites resolve against the whole catalogue. Provider
 * notifications preserve selection, focus and local scroll offsets. No polling,
 * game boot, simulation work or generated assets are needed.
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
 * screen — including the renderer-free title route.
 *
 * DEGRADING IS THE DEFAULT, NOT THE EDGE CASE
 * -------------------------------------------
 * The progression handle is read from `globalThis.__vmProgression` and may be
 * absent: a `?shot=` boot never publishes one. The full-screen title route
 * lazily attaches the same read-only profile provider as Service Record;
 * injected panels and screenshot harnesses can still render an honest empty
 * state. Profile file management lives in Settings.
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
    blurb: 'Ore, banking and expansion. Unlocks battlefields and records your milestones.',
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
    blurb: 'Faction victories and career milestones. Earn honours and specialist superweapons.',
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
        kind: 'Objective',
        name: 'Completion recorded',
        effect: 'No credit payout is currently attached to this objective.',
        iconName: 'target',
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
 *
 * Credit values on match objectives are deliberately filtered here. They are
 * retained in the authored table for a future deterministic payout design,
 * but no live economy consumes them today, so no generic reward surface may
 * present them as money the player earned.
 */
export function presentableRewards(rewards: readonly Reward[]): Reward[] {
  const typed = new Set<string>();
  for (const reward of rewards) {
    if (reward.kind === 'map') typed.add(reward.mapId);
    else if (reward.kind === 'cosmetic') typed.add(reward.cosmeticId);
  }
  return rewards.filter((reward) => reward.kind !== 'credits'
    && (reward.kind !== 'unlock' || !typed.has(reward.unlockId)));
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

export const MISSION_PAGE_SIZE = 5;

export interface MissionFilters {
  category: MissionCategory | 'all';
  scope: 'all' | 'profile' | 'match';
  state: MissionState | 'all';
}

/** Pure selection policy shared by refreshes, filters, pagination and tests. */
export function missionBrowserView(
  entries: readonly CatalogueEntry[],
  filters: MissionFilters,
  selectedId: string | null = null,
  requestedPage?: number,
): {
  filtered: CatalogueEntry[];
  visible: CatalogueEntry[];
  selected: CatalogueEntry | null;
  page: number;
  pages: number;
} {
  const ordered = MISSION_CATEGORIES.flatMap(cat =>
    buildChains(entries.filter(entry => entry.category === cat.id)).flatMap(chain => chain.map(node => node.entry)),
  );
  const filtered = ordered.filter(entry =>
    (filters.category === 'all' || entry.category === filters.category) &&
    (filters.scope === 'all' || entry.scope === filters.scope) &&
    (filters.state === 'all' || missionState(entry) === filters.state),
  );
  let selected = filtered.find(entry => entry.id === selectedId)
    ?? filtered.find(entry => missionState(entry) === 'active') ?? filtered[0] ?? null;
  const pages = Math.max(1, Math.ceil(filtered.length / MISSION_PAGE_SIZE));
  const preferredPage = requestedPage ?? (selected === null ? 0 : Math.floor(filtered.indexOf(selected) / MISSION_PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, Number.isFinite(preferredPage) ? Math.floor(preferredPage) : 0));
  const visible = filtered.slice(page * MISSION_PAGE_SIZE, (page + 1) * MISSION_PAGE_SIZE);
  if (selected !== null && !visible.includes(selected)) selected = visible[0] ?? null;
  return { filtered, visible, selected, page, pages };
}

/* ==========================================================================
 * 5. THE PANEL
 * ========================================================================== */

export interface MissionsPanelOptions {
  /** Shared Back button / Escape. */
  onClose: () => void;
  /** Injected by tests; production reads `globalThis.__vmProgression`. */
  progression?: ProgressionView | null;
}

export class MissionsPanel {
  readonly root: HTMLElement;

  private readonly body: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly announcement: HTMLElement;
  private readonly categoryButtons = new Map<MissionFilters['category'], HTMLButtonElement>();
  private readonly scopeSelect: HTMLSelectElement;
  private readonly stateSelect: HTMLSelectElement;
  private readonly filters: MissionFilters = { category: 'all', scope: 'all', state: 'all' };
  private selectedId: string | null = null;
  private view: ReturnType<typeof missionBrowserView> | null = null;
  private reading = false;
  private backToList: HTMLButtonElement | null = null;
  private progression: ProgressionView | null;
  private unsubscribe: (() => void) | null = null;

  constructor(options: MissionsPanelOptions) {
    this.progression = options.progression !== undefined ? options.progression : readProgression();

    this.root = el('div', 'vm-missions');
    const frame = pageFrame('Missions', options.onClose);
    frame.root.classList.add('vm-missions-panel');

    this.summary = el('span', 'vm-missions-summary', '');
    frame.head.appendChild(this.summary);

    const rail = el('nav', 'vm-missions-rail');
    rail.setAttribute('aria-label', 'Mission categories');
    rail.appendChild(this.categoryButton('all', 'All missions'));
    for (const cat of MISSION_CATEGORIES) rail.appendChild(this.categoryButton(cat.id, cat.label, cat.iconName));
    frame.root.insertBefore(rail, frame.body);

    const filters = el('div', 'vm-missions-filters');
    this.scopeSelect = this.filterSelect('Scope', [['all', 'All scopes'], ['profile', 'Career'], ['match', 'This match']], value => {
      this.filters.scope = value as MissionFilters['scope'];
      this.reading = false;
      this.render();
    });
    this.stateSelect = this.filterSelect('Status', [['all', 'All statuses'], ['active', 'In progress'], ['locked', 'Locked'], ['complete', 'Complete']], value => {
      this.filters.state = value as MissionFilters['state'];
      this.reading = false;
      this.render();
    });
    for (const select of [this.scopeSelect, this.stateSelect]) {
      const label = el('label', 'vm-missions-filter');
      label.append(el('span', undefined, select.getAttribute('aria-label')!), select);
      filters.appendChild(label);
    }
    frame.root.insertBefore(filters, frame.body);

    this.body = frame.body;
    this.body.classList.add('vm-missions-body');

    // One exit (the shared Back button), with a quiet status announcement.
    this.announcement = el('span', 'vm-missions-announcement');
    this.announcement.setAttribute('role', 'status');
    this.announcement.setAttribute('aria-atomic', 'true');
    frame.foot.appendChild(this.announcement);

    this.root.appendChild(frame.root);
    this.render();

    this.subscribeToProgression();
  }

  /** Attach a title-screen reader after the first frame without rebuilding the panel. */
  setProgression(progression: ProgressionView): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.progression = progression;
    this.render();
    this.subscribeToProgression();
  }

  hasProgression(): boolean {
    return this.progression !== null;
  }

  private subscribeToProgression(): void {
    if (this.progression === null) return;
    try {
      this.unsubscribe = this.progression.subscribe(() => this.render());
    } catch {
      /* A provider whose subscribe throws still renders once, correctly. */
    }
  }

  /** Drop the subscription. The host removes DOM. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** List navigation is scoped; text inputs and native pickers keep their keys. */
  onKeyDown(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.vm-mission-row') || !this.view?.filtered.length) return false;
    switch (e.code) {
      case 'PageDown': this.render(this.view.page + 1); break;
      case 'PageUp': this.render(this.view.page - 1); break;
      case 'Home': this.selectedId = this.view.filtered[0].id; this.render(); break;
      case 'End': this.selectedId = this.view.filtered[this.view.filtered.length - 1].id; this.render(); break;
      default: return false;
    }
    this.focusSelectedRow();
    return true;
  }

  /* -------------------------------------------------------------------- */
  /* rendering                                                             */
  /* -------------------------------------------------------------------- */

  private categoryButton(id: MissionFilters['category'], label: string, iconName?: string): HTMLButtonElement {
    const b = el('button', 'vm-missions-jump');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(id === this.filters.category));
    if (iconName) b.appendChild(icon(iconName, 14));
    b.append(el('span', undefined, label), el('span', 'vm-missions-count', '0'));
    focusable(b);
    b.addEventListener('click', () => {
      this.filters.category = id;
      this.reading = false;
      this.render();
    });
    this.categoryButtons.set(id, b);
    return b;
  }

  private filterSelect(label: string, choices: readonly (readonly [string, string])[], change: (value: string) => void): HTMLSelectElement {
    const select = el('select', 'vm-missions-select');
    select.setAttribute('aria-label', label);
    for (const [value, text] of choices) {
      const option = el('option', undefined, text);
      option.value = value;
      select.appendChild(option);
    }
    focusable(select);
    select.addEventListener('change', () => change(select.value));
    return select;
  }

  private focusSelectedRow(): void {
    const row = Array.from(this.body.querySelectorAll<HTMLElement>('.vm-mission-row'))
      .find(node => node.dataset.missionId === this.selectedId);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }

  private render(requestedPage?: number): void {
    const active = document.activeElement as HTMLElement | null;
    const ownedFocus = active !== null && this.body.contains(active);
    const focusKey = ownedFocus ? active.dataset.missionFocus : undefined;
    const oldSelection = this.view?.selected?.id;
    const oldFirstRow = this.view?.visible[0]?.id;
    const listScroll = this.body.querySelector('.vm-mission-list')?.scrollTop ?? 0;
    const detailScroll = this.body.querySelector('.vm-mission-detail')?.scrollTop ?? 0;
    this.renderContent(requestedPage);
    const list = this.body.querySelector('.vm-mission-list');
    if (list) list.scrollTop = oldFirstRow === this.view?.visible[0]?.id ? listScroll : 0;
    const detail = this.body.querySelector('.vm-mission-detail');
    if (detail && oldSelection === this.selectedId) detail.scrollTop = detailScroll;
    if (ownedFocus) {
      const replacement = Array.from(this.body.querySelectorAll<HTMLElement>('[data-mission-focus]'))
        .find(node => node.dataset.missionFocus === focusKey && !node.hasAttribute('disabled') && node.offsetParent !== null);
      if (replacement) replacement.focus({ preventScroll: true });
      else if (this.reading && this.backToList?.offsetParent != null) this.backToList.focus({ preventScroll: true });
      else if (this.view?.selected) this.focusSelectedRow();
      else this.scopeSelect.focus({ preventScroll: true });
    }
  }

  private renderContent(requestedPage?: number): void {
    this.body.replaceChildren();
    this.view = null;
    this.backToList = null;

    const p = this.progression;
    if (p === null) {
      this.summary.textContent = 'Progression offline';
      this.announcement.textContent = 'Progression unavailable';
      this.body.appendChild(this.emptyState(
        'Progression is not running',
        'The saved profile is still loading or unavailable. Reopen Missions to retry. ' +
        'Your saved progress has not been changed.',
      ));
      return;
    }

    let entries: readonly CatalogueEntry[] = [];
    let unlocked: readonly string[] = [];
    try {
      entries = p.catalogue();
      unlocked = p.profile().unlocked;
    } catch {
      this.summary.textContent = 'Profile unreadable';
      this.announcement.textContent = 'Profile unreadable';
      this.body.appendChild(this.emptyState(
        'The profile could not be read',
        'Reopen Missions to retry, or use profile management in Settings to restore a backup. ' +
        'Your saved progress has not been changed.',
      ));
      return;
    }

    this.summary.textContent = summarise(entries, unlocked.length);

    for (const [id, b] of this.categoryButtons) {
      b.setAttribute('aria-pressed', String(id === this.filters.category));
      b.querySelector('.vm-missions-count')!.textContent = String(id === 'all' ? entries.length : entries.filter(e => e.category === id).length);
    }

    if (entries.length === 0) {
      this.announcement.textContent = 'No missions authored yet';
      this.body.appendChild(this.emptyState(
        'No missions authored yet',
        'There are no missions in this catalogue. Your saved progress has not been changed.',
      ));
      return;
    }

    const view = missionBrowserView(entries, this.filters, this.selectedId, requestedPage);
    this.view = view;
    this.selectedId = view.selected?.id ?? null;
    this.body.classList.toggle('is-reading', this.reading && view.selected !== null);
    if (view.selected === null) {
      const empty = this.emptyState('No matching missions', 'Try another category, scope or status. No missions have been removed.');
      empty.appendChild(button('Show all missions', { onClick: () => {
        this.filters.category = this.filters.scope = this.filters.state = 'all';
        this.scopeSelect.value = this.stateSelect.value = 'all';
        this.reading = false;
        this.render();
      } }));
      this.body.appendChild(empty);
      this.announcement.textContent = 'No matching missions';
      return;
    }

    const results = el('section', 'vm-mission-results');
    results.setAttribute('aria-label', 'Mission results');
    const list = el('ul', 'vm-mission-list');
    for (const entry of view.visible) {
      const item = el('li');
      const row = el('button', 'vm-mission-row');
      row.type = 'button';
      row.dataset.missionId = entry.id;
      row.dataset.missionFocus = `row:${entry.id}`;
      row.setAttribute('aria-pressed', String(entry.id === this.selectedId));
      focusable(row);
      row.append(el('strong', 'vm-mission-row-title', entry.title),
        el('span', `vm-mission-row-state is-${missionState(entry)}`, STATE_LABEL[missionState(entry)]));
      const rewards = presentableRewards(entry.reward);
      const teaser = rewards.length ? rewardCopy(rewards[0]).name + (rewards.length > 1 ? ` +${rewards.length - 1}` : '')
        : entry.scope === 'match' ? 'Match objective' : 'Career objective';
      row.append(el('span', 'vm-mission-row-reward', teaser),
        el('span', 'vm-mission-row-progress vm-num', readoutOf(entry.progress)));
      row.addEventListener('click', () => {
        this.selectedId = entry.id;
        this.reading = true;
        this.render();
        if (this.backToList?.offsetParent != null) this.backToList.focus({ preventScroll: true });
      });
      item.appendChild(row);
      list.appendChild(item);
    }
    results.appendChild(list);
    const pager = el('nav', 'vm-missions-pager');
    pager.setAttribute('aria-label', 'Mission pages');
    for (const [label, delta, disabled] of [['Previous', -1, view.page === 0], ['Next', 1, view.page === view.pages - 1]] as const) {
      const b = button(label, { disabled, onClick: () => this.render(view.page + delta) });
      b.dataset.missionFocus = label;
      if (delta === 1) pager.appendChild(el('span', 'vm-missions-page-count vm-num', `${view.page * MISSION_PAGE_SIZE + 1}–${view.page * MISSION_PAGE_SIZE + view.visible.length} / ${view.filtered.length}`));
      pager.appendChild(b);
    }
    results.appendChild(pager);

    const detail = el('section', 'vm-mission-detail');
    detail.setAttribute('aria-label', 'Selected mission details');
    detail.dataset.missionFocus = 'detail';
    focusable(detail);
    this.backToList = button('Back to list', { onClick: () => {
      this.reading = false;
      this.render();
      this.focusSelectedRow();
    } });
    this.backToList.classList.add('vm-missions-list-back');
    this.backToList.dataset.missionFocus = 'list-back';
    detail.appendChild(this.backToList);
    detail.appendChild(el('p', 'vm-mission-detail-kicker', `${MISSION_CATEGORIES.find(cat => cat.id === view.selected!.category)?.label ?? ''} / ${view.selected.scope === 'match' ? 'This match' : 'Career'}`));
    const gates = (view.selected.requires ?? []).map(id => entries.find(entry => entry.id === id)?.title ?? humaniseId(id));
    detail.appendChild(this.renderMission({ entry: view.selected, depth: 0, after: gates, foreign: [] }));
    this.body.append(results, detail);
    const message = `${view.selected.title} selected · Page ${view.page + 1} of ${view.pages}`;
    if (this.announcement.textContent !== message) this.announcement.textContent = message;
  }

  private renderMission(node: ChainNode): HTMLElement {
    const { entry } = node;
    const state = missionState(entry);

    const card = el('article', `vm-mission is-${state}`);

    /* -- head ------------------------------------------------------------ */
    const head = el('div', 'vm-mission-head');
    head.appendChild(el('h3', 'vm-mission-title', entry.title));

    if (entry.difficulty !== undefined) {
      const pips = el('div', 'vm-mission-diff', `Difficulty ${entry.difficulty} / 3`);
      pips.title = `Difficulty ${entry.difficulty} of 3`;
      for (let i = 1; i <= 3; i++) {
        const pip = el('i', 'vm-mission-pip');
        if (i <= entry.difficulty) pip.classList.add('is-on');
        pips.appendChild(pip);
      }
      head.appendChild(pips);
    }

    head.appendChild(el('span', `vm-mission-state is-${state}`, STATE_LABEL[state]));
    card.appendChild(head);

    card.appendChild(el('p', 'vm-mission-desc', entry.description));
    card.appendChild(el('p', 'vm-mission-scope-note', entry.scope === 'match'
      ? 'Progress resets each match. Outside a match, this is an objective preview.'
      : 'Career progress is saved across matches.'));

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
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', `${entry.title} progress`);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.round(fractionOf(entry.progress) * 100)));
    bar.setAttribute('aria-valuetext', readoutOf(entry.progress));
    const fill = el('i', 'vm-mission-fill');
    fill.style.width = `${(fractionOf(entry.progress) * 100).toFixed(1)}%`;
    bar.appendChild(fill);
    track.appendChild(bar);
    track.appendChild(el('span', 'vm-mission-value vm-num', readoutOf(entry.progress)));
    card.appendChild(track);

    /* -- rewards --------------------------------------------------------- */
    const visibleRewards = presentableRewards(entry.reward);
    if (visibleRewards.length > 0) {
      card.appendChild(el('h4', 'vm-h3 vm-mission-rewards-heading', state === 'complete' ? 'Rewards earned' : 'Rewards'));
      const rewards = el('div', 'vm-mission-rewards');
      for (const r of visibleRewards) {
        rewards.appendChild(rewardCard(r, state === 'complete'));
      }
      card.appendChild(rewards);
    } else {
      card.appendChild(el('p', 'vm-mission-scope-note', 'No permanent unlock reward. Completion is recorded for this objective.'));
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
  private profileReader: { dispose(): void } | null = null;

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
    if (!this.panel.hasProgression()) void this.loadProfileReader();
  }

  unmount(): void {
    this.panel?.dispose();
    this.panel = null;
    this.profileReader?.dispose();
    this.profileReader = null;
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

  /** Read the local record on demand without booting the battlefield. */
  private async loadProfileReader(): Promise<void> {
    try {
      const { ProfileReader } = await import('./profile-reader');
      const reader = new ProfileReader();
      if (this.panel === null) {
        reader.dispose();
        return;
      }
      this.profileReader = reader;
      this.panel.setProgression(reader);
    } catch {
      // Keep the honest offline state already rendered by MissionsPanel.
    }
  }
}

/**
 * ============================================================================
 * src/shell/Profile.ts — the persistent player-facing Service Record
 * ============================================================================
 * MissionTracker has always kept a lifetime record and the mission catalogue
 * has always paid insignia and decals. This is the surface that makes both
 * systems visible: career numbers are read from ProfileView, while the honours
 * collection is derived from the authored rewards instead of being copied into
 * a second catalogue that can drift.
 *
 * Cosmetics remain battle-neutral. Their value is collection and recognition,
 * not a simulation modifier, and every earned item is shown with the mission
 * that awarded it. A locked item names its requirement and live progress.
 * ============================================================================
 */

import {
  readProgression,
  type CatalogueEntry,
  type ProfileView,
  type ProgressionView,
} from '../ui/Objectives';
import {
  button,
  el,
  focusable,
  icon,
  pageFrame,
  playableFactions,
  type FactionOption,
  type Screen,
  type Shell,
} from './Shell';
import { humaniseId } from './Missions';
import { cosmeticKind, cosmeticMark, type CosmeticKind } from './CosmeticMarks';
import { COMMANDER_NAME_MAX, normalizeCommanderName } from '../net/protocol';
import { CAMPAIGN_OPERATION_COUNT } from './CampaignPresentation';

export type { CosmeticKind } from './CosmeticMarks';

export interface CosmeticAward {
  readonly id: string;
  readonly kind: CosmeticKind;
  readonly name: string;
  readonly earned: boolean;
  readonly missionId: string;
  readonly missionTitle: string;
  readonly missionDescription: string;
  readonly value: number;
  readonly target: number;
  readonly complete: boolean;
  readonly claimedAt: number | null;
}

export interface CareerRecord {
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly winRate: number;
  readonly missionsComplete: number;
  readonly missionsTotal: number;
  readonly operationsComplete: number;
  readonly goldOperations: number;
  readonly honoursEarned: number;
  readonly honoursTotal: number;
}

const safeCount = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

/** The player-facing part after `cosmetic.insignia.` / `cosmetic.decal.`. */
export function cosmeticName(id: string): string {
  const parts = id.split('.');
  return humaniseId(parts.length >= 3 ? parts.slice(2).join('.') : id);
}

/**
 * Derive the collection from rewards, not UNLOCKS. This guarantees the page
 * shows exactly the cosmetics a player can earn in this build and no dead ids.
 */
export function cosmeticCollection(
  catalogue: readonly CatalogueEntry[],
  unlocked: readonly string[],
): CosmeticAward[] {
  const owned = new Set(unlocked);
  const seen = new Set<string>();
  const out: CosmeticAward[] = [];

  for (const mission of catalogue) {
    for (const reward of mission.reward) {
      if (reward.kind !== 'cosmetic' || seen.has(reward.cosmeticId)) continue;
      const id = reward.cosmeticId;
      const kind = cosmeticKind(id);
      if (kind === null) continue;
      seen.add(id);
      out.push({
        id,
        kind,
        name: cosmeticName(id),
        earned: owned.has(id),
        missionId: mission.id,
        missionTitle: mission.title,
        missionDescription: mission.description,
        value: safeCount(mission.progress.value),
        target: Math.max(1, safeCount(mission.progress.target)),
        complete: mission.progress.complete,
        claimedAt: mission.progress.claimedAt,
      });
    }
  }
  return out;
}

/** One total, defensive rendering model over the persisted profile. */
export function careerRecord(
  profile: ProfileView,
  catalogue: readonly CatalogueEntry[],
  collection: readonly CosmeticAward[] = cosmeticCollection(catalogue, profile.unlocked),
): CareerRecord {
  const stats = profile.stats;
  const matches = safeCount(stats?.matchesPlayed);
  const wins = safeCount(stats?.wins);
  const losses = safeCount(stats?.losses);
  const profileMissions = catalogue.filter((m) => m.scope === 'profile');
  const campaign = profile.campaign ?? {};
  const medals = Object.values(campaign).filter((v) => typeof v === 'number' && v > 0);
  return {
    matches,
    wins,
    losses,
    currentStreak: safeCount(stats?.currentStreak),
    bestStreak: safeCount(stats?.bestStreak),
    winRate: matches > 0 ? Math.min(100, (wins / matches) * 100) : 0,
    missionsComplete: profileMissions.filter((m) => m.progress.complete).length,
    missionsTotal: profileMissions.length,
    operationsComplete: medals.length,
    goldOperations: medals.filter((m) => m >= 3).length,
    honoursEarned: collection.filter((c) => c.earned).length,
    honoursTotal: collection.length,
  };
}

/** Wins by each live playable faction; additions to the faction table appear automatically. */
export function factionCareerRows(
  profile: ProfileView,
  factions: readonly FactionOption[],
): Array<FactionOption & { readonly wins: number }> {
  const byFaction = profile.stats?.winsByFaction ?? {};
  return factions.map((f) => ({ ...f, wins: safeCount(byFaction[String(f.id)]) }));
}

function dateLabel(epoch: number | undefined): string {
  if (typeof epoch !== 'number' || !Number.isFinite(epoch) || epoch <= 0) return 'New record';
  try {
    return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: '2-digit' })
      .format(new Date(epoch));
  } catch {
    return 'Service date unavailable';
  }
}

export type ProfileMissionFilter = 'all' | 'active' | 'complete';

export function profileMissionRows(catalogue: readonly CatalogueEntry[], filter: ProfileMissionFilter): CatalogueEntry[] {
  return catalogue.filter((mission) => mission.scope === 'profile'
    && (filter === 'all' || (filter === 'complete' ? mission.progress.complete : !mission.progress.complete && !mission.locked)))
    .sort((left, right) => Number(left.progress.complete) - Number(right.progress.complete)
      || Number(left.locked) - Number(right.locked))
    .slice(0, 6);
}

function progressLabel(award: CosmeticAward): string {
  if (award.earned) return 'Earned';
  if (award.complete) return 'Awaiting debrief';
  return `${Math.min(award.target, award.value).toLocaleString('en-US')} / ${award.target.toLocaleString('en-US')}`;
}

function progressFraction(award: CosmeticAward): number {
  if (award.earned || award.complete) return 1;
  return Math.max(0, Math.min(1, award.value / award.target));
}

function statCard(label: string, value: string, detail: string, iconName: string): HTMLElement {
  const card = el('article', 'vm-profile-stat');
  const head = el('div', 'vm-profile-stat-head');
  head.appendChild(icon(iconName, 14));
  head.appendChild(el('span', undefined, label));
  card.appendChild(head);
  card.appendChild(el('strong', 'vm-profile-stat-value vm-num', value));
  card.appendChild(el('span', 'vm-profile-stat-detail', detail));
  return card;
}

export const HONOURS_PAGE_SIZE = 6;
export type HonourFilter = 'all' | 'earned' | 'locked';

export function honoursBrowserView(
  collection: readonly CosmeticAward[],
  kind: CosmeticKind | 'all' = 'all',
  filter: HonourFilter = 'all',
  selectedId: string | null = null,
  requestedPage?: number,
): { filtered: CosmeticAward[]; visible: CosmeticAward[]; selected: CosmeticAward | null; page: number; pages: number } {
  const filtered = collection.filter(award => (kind === 'all' || award.kind === kind)
    && (filter === 'all' || award.earned === (filter === 'earned')));
  let selected = filtered.find(award => award.id === selectedId) ?? filtered[0] ?? null;
  const pages = Math.max(1, Math.ceil(filtered.length / HONOURS_PAGE_SIZE));
  const preferred = requestedPage ?? (selected === null ? 0 : Math.floor(filtered.indexOf(selected) / HONOURS_PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, Number.isFinite(preferred) ? Math.floor(preferred) : 0));
  const visible = filtered.slice(page * HONOURS_PAGE_SIZE, (page + 1) * HONOURS_PAGE_SIZE);
  if (selected !== null && !visible.includes(selected)) selected = visible[0] ?? null;
  return { filtered, visible, selected, page, pages };
}

type RecordSection = 'overview' | 'honours' | 'identity';

export class ProfileScreen implements Screen {
  readonly id = 'profile';
  private host: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private identityNotice = '';
  private identityEditor: HTMLFormElement | null = null;
  private progression: ProgressionView | null;
  private profileReader: { dispose(): void } | null = null;
  private loadingProfile = false;
  private profileLoadError: unknown = null;
  private section: RecordSection = 'overview';
  private readonly sectionButtons = new Map<RecordSection, HTMLButtonElement>();
  private announcement: HTMLElement | null = null;
  private tools: HTMLElement | null = null;
  private kindSelect: HTMLSelectElement | null = null;
  private earnedSelect: HTMLSelectElement | null = null;
  private honourKind: CosmeticKind | 'all' = 'all';
  private honourFilter: HonourFilter = 'all';
  private selectedAward: string | null = null;
  private honourView: ReturnType<typeof honoursBrowserView> | null = null;
  private readingAward = false;
  private backToHonours: HTMLButtonElement | null = null;

  constructor(private readonly shell: Shell, progression?: ProgressionView | null) {
    this.progression = progression !== undefined ? progression : readProgression();
  }

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page', 'is-modal', 'vm-profile-page');
    const frame = pageFrame('Service Record', () => this.close());
    frame.root.classList.add('vm-profile-panel');
    frame.root.classList.add('vm-record-panel');
    frame.head.appendChild(el('span', 'vm-profile-head-code', 'CAREER // LOCAL PROFILE'));
    const navigation = el('nav', 'vm-record-sections');
    navigation.setAttribute('aria-label', 'Service Record sections');
    for (const [id, label] of [['overview', 'Overview'], ['honours', 'Honours'], ['identity', 'Identity']] as const) {
      const item = button(label, { onClick: () => this.openSection(id) });
      item.setAttribute('aria-pressed', String(id === this.section));
      this.sectionButtons.set(id, item);
      navigation.appendChild(item);
    }
    frame.root.insertBefore(navigation, frame.body);
    this.tools = el('div', 'vm-record-tools');
    this.kindSelect = this.filterSelect('Award type', [['all', 'All types'], ['insignia', 'Insignia'], ['decal', 'Field decals']], value => {
      this.honourKind = value as CosmeticKind | 'all';
      this.readingAward = false;
      this.render();
    });
    this.earnedSelect = this.filterSelect('Ownership', [['all', 'All honours'], ['earned', 'Earned'], ['locked', 'Not earned']], value => {
      this.honourFilter = value as HonourFilter;
      this.readingAward = false;
      this.render();
    });
    for (const select of [this.kindSelect, this.earnedSelect]) {
      const label = el('label', 'vm-record-filter');
      label.append(el('span', undefined, select.getAttribute('aria-label')!), select);
      this.tools.appendChild(label);
    }
    frame.root.insertBefore(this.tools, frame.body);
    frame.body.classList.add('vm-record-body');
    this.body = frame.body;
    this.identityEditor = this.buildIdentityEditor();
    this.announcement = el('span', 'vm-record-announcement');
    this.announcement.setAttribute('role', 'status');
    this.announcement.setAttribute('aria-atomic', 'true');
    frame.foot.appendChild(this.announcement);
    host.appendChild(frame.root);
    this.loadingProfile = this.progression === null;
    this.render();
    if (this.progression !== null) this.subscribeToProgression(this.progression);
    else void this.loadProfileReader();
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.profileReader?.dispose();
    this.profileReader = null;
    this.identityEditor = null;
    this.body = null;
    this.tools = null;
    this.announcement = null;
    this.sectionButtons.clear();
    this.host?.classList.remove('vm-page', 'is-modal', 'vm-profile-page');
    this.host = null;
  }

  onBack(): boolean { this.close(); return true; }

  // Native scrolling and caret/picker keys belong to the focused control.
  onKeyDown(_event: KeyboardEvent): boolean { return false; }

  private close(): void { this.shell.showMenu(); }

  private openSection(section: RecordSection): void {
    this.section = section;
    this.readingAward = false;
    if (this.body) this.body.scrollTop = 0;
    this.render();
    this.sectionButtons.get(section)?.focus({ preventScroll: true });
  }

  private filterSelect(label: string, choices: readonly (readonly [string, string])[], change: (value: string) => void): HTMLSelectElement {
    const select = el('select', 'vm-record-select');
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

  private subscribeToProgression(progression: ProgressionView): void {
    try { this.unsubscribe = progression.subscribe(() => this.render()); } catch { /* read once */ }
  }

  /** Renderer-free profile loading; late results cannot remount a closed screen. */
  private async loadProfileReader(): Promise<void> {
    try {
      const { ProfileReader } = await import('./profile-reader');
      const reader = new ProfileReader();
      if (this.body === null) { reader.dispose(); return; }
      this.profileReader = reader;
      this.progression = reader;
      this.loadingProfile = false;
      this.subscribeToProgression(reader);
      this.render();
    } catch (err) {
      this.loadingProfile = false;
      this.profileLoadError = err;
      this.render();
    }
  }

  private commanderName(): string {
    return normalizeCommanderName(this.shell.settings.get().gameplay.commanderName) ?? 'Commander';
  }

  /** Kept as one DOM instance across notifications and section switches. */
  private buildIdentityEditor(): HTMLFormElement {
    const editor = el('form', 'vm-profile-editor');
    editor.setAttribute('aria-label', 'Commander identity');
    const copy = el('div', 'vm-profile-editor-copy');
    const label = el('label', 'vm-profile-editor-label', 'Commander identity');
    label.htmlFor = 'vm-profile-commander-name';
    copy.append(label, el('p', 'vm-profile-editor-note',
      'Your local callsign is shared by multiplayer, chat, results, replays and this service record. It is not an online account.'));
    editor.appendChild(copy);
    const field = el('div', 'vm-profile-editor-field');
    const nameInput = el('input', 'vm-profile-name-input');
    nameInput.id = 'vm-profile-commander-name';
    nameInput.type = 'text';
    nameInput.maxLength = COMMANDER_NAME_MAX;
    nameInput.autocomplete = 'off';
    nameInput.spellcheck = false;
    nameInput.value = this.commanderName();
    nameInput.dataset.recordFocus = 'commander-name';
    nameInput.setAttribute('aria-describedby', 'vm-profile-identity-status');
    focusable(nameInput);
    field.appendChild(nameInput);
    const status = el('p', 'vm-profile-editor-status', this.identityNotice);
    status.id = 'vm-profile-identity-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const commitIdentity = (): void => {
      const next = normalizeCommanderName(nameInput.value);
      nameInput.classList.toggle('is-invalid', next === null);
      nameInput.setAttribute('aria-invalid', String(next === null));
      if (next === null) {
        this.identityNotice = 'Enter a visible callsign up to ' + COMMANDER_NAME_MAX + ' characters.';
        status.textContent = this.identityNotice;
        nameInput.focus();
        return;
      }
      nameInput.value = next;
      this.shell.settings.patch({ gameplay: { commanderName: next } });
      this.identityNotice = 'Commander identity updated.';
      status.textContent = this.identityNotice;
      this.render();
    };
    const save = button('Update Identity', { iconName: 'check', variant: 'primary', onClick: commitIdentity });
    save.dataset.recordFocus = 'save-identity';
    field.appendChild(save);
    editor.append(field, status);
    editor.addEventListener('submit', event => { event.preventDefault(); commitIdentity(); });
    return editor;
  }

  private portrait(): HTMLImageElement {
    const image = el('img', 'vm-record-portrait');
    image.src = import.meta.env.BASE_URL + 'campaign/portraits/nael.webp';
    image.alt = 'Commander portrait';
    return image;
  }

  private buildIdentity(): HTMLElement {
    const section = el('section', 'vm-record-identity');
    section.setAttribute('aria-label', 'Identity');
    const preview = el('div', 'vm-record-identity-preview');
    preview.append(this.portrait(), el('h3', 'vm-record-callsign', this.commanderName()));
    section.append(preview, this.identityEditor!);
    return section;
  }

  private unavailable(title: string, detail: string): HTMLElement {
    const section = el('section', 'vm-record-unavailable');
    section.append(el('h3', 'vm-h3', title), el('p', 'vm-body', detail),
      el('p', 'vm-body', 'Career totals and honours are unavailable. Your saved record has not been changed.'));
    section.appendChild(button('Edit identity', { onClick: () => this.openSection('identity') }));
    return section;
  }

  private announce(message: string): void {
    if (this.announcement && this.announcement.textContent !== message) this.announcement.textContent = message;
  }

  private focusAward(): void {
    const row = Array.from(this.body?.querySelectorAll<HTMLElement>('.vm-record-award') ?? [])
      .find(item => item.dataset.awardId === this.selectedAward);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }

  private render(requestedPage?: number): void {
    const body = this.body;
    if (body === null) return;
    const active = document.activeElement as HTMLElement | null;
    const ownedFocus = active !== null && body.contains(active);
    const key = ownedFocus ? active.dataset.recordFocus : undefined;
    const input = ownedFocus && active.tagName === 'INPUT' ? active as HTMLInputElement : null;
    const selectionStart = input?.selectionStart ?? null;
    const selectionEnd = input?.selectionEnd ?? null;
    const scroll = body.scrollTop;
    const oldFirst = this.honourView?.visible[0]?.id;
    const oldSelected = this.honourView?.selected?.id;
    const listScroll = body.querySelector('.vm-record-award-list')?.scrollTop ?? 0;
    const detailScroll = body.querySelector('.vm-record-award-detail')?.scrollTop ?? 0;
    this.renderContent(requestedPage);
    body.scrollTop = scroll;
    const list = body.querySelector('.vm-record-award-list');
    if (list) list.scrollTop = oldFirst === this.honourView?.visible[0]?.id ? listScroll : 0;
    const detail = body.querySelector('.vm-record-award-detail');
    if (detail && oldSelected === this.selectedAward) detail.scrollTop = detailScroll;
    if (ownedFocus) {
      const replacement = Array.from(body.querySelectorAll<HTMLElement>('[data-record-focus]'))
        .find(node => node.dataset.recordFocus === key && !node.hasAttribute('disabled') && node.offsetParent !== null);
      if (replacement) {
        replacement.focus({ preventScroll: true });
        if (replacement === input && selectionStart !== null && selectionEnd !== null) input.setSelectionRange(selectionStart, selectionEnd);
      } else if (this.readingAward && this.backToHonours?.offsetParent != null) this.backToHonours.focus({ preventScroll: true });
      else if (this.section === 'honours' && this.honourView?.selected) this.focusAward();
      else this.sectionButtons.get(this.section)?.focus({ preventScroll: true });
    }
  }

  private renderContent(requestedPage?: number): void {
    const body = this.body!;
    body.replaceChildren();
    body.className = 'vm-page-body vm-record-body is-' + this.section;
    this.backToHonours = null;
    this.honourView = null;
    this.tools!.hidden = this.section !== 'honours';
    for (const [id, item] of this.sectionButtons) item.setAttribute('aria-pressed', String(id === this.section));
    if (this.section === 'identity') {
      body.appendChild(this.buildIdentity());
      this.announce('Identity · Callsign used across the game');
      return;
    }
    if (this.progression === null) {
      const unreadable = this.profileLoadError !== null;
      const title = unreadable ? 'Service record unreadable' : this.loadingProfile ? 'Loading service record' : 'Service record offline';
      body.appendChild(this.unavailable(title, unreadable
        ? 'Reopen Service Record to retry, or restore a profile backup in Settings.'
        : 'Reading your local profile does not start the battlefield.'));
      this.announce(title);
      return;
    }
    let profile: ProfileView;
    let catalogue: readonly CatalogueEntry[];
    try { profile = this.progression.profile(); catalogue = this.progression.catalogue(); }
    catch {
      body.appendChild(this.unavailable('Service record unreadable', 'Reopen Service Record to retry, or restore a profile backup in Settings.'));
      this.announce('Service record unreadable');
      return;
    }
    const collection = cosmeticCollection(catalogue, profile.unlocked);
    if (this.section === 'overview') {
      body.appendChild(this.buildOverview(profile, catalogue, collection));
      this.announce('Overview · Lifetime record');
    } else {
      this.buildHonours(collection, requestedPage);
    }
  }

  private buildOverview(profile: ProfileView, catalogue: readonly CatalogueEntry[], collection: readonly CosmeticAward[]): HTMLElement {
    const overview = el('section', 'vm-record-overview');
    overview.setAttribute('aria-label', 'Overview');
    const identity = el('div', 'vm-record-summary');
    const copy = el('div');
    copy.append(el('h3', 'vm-record-callsign', this.commanderName()),
      el('p', 'vm-body', 'Local profile · Service record opened ' + dateLabel(profile.createdAt)));
    identity.append(this.portrait(), copy);
    overview.appendChild(identity);
    const career = careerRecord(profile, catalogue, collection);
    const stats = el('div', 'vm-record-stats');
    stats.append(
      statCard('Matches', career.matches.toLocaleString('en-US'), career.wins + ' victories · ' + career.losses + ' defeats', 'swords'),
      statCard('Win rate', career.winRate.toFixed(1) + '%', career.matches > 0 ? 'Lifetime skirmish record' : 'Complete a skirmish to establish', 'target'),
      statCard('Current streak', career.currentStreak.toLocaleString('en-US'), 'Best ' + career.bestStreak.toLocaleString('en-US'), 'clock'),
      statCard('Missions', career.missionsComplete + ' / ' + career.missionsTotal, 'Career chains completed', 'trophy'),
      statCard('Operations', career.operationsComplete + ' / ' + CAMPAIGN_OPERATION_COUNT, career.goldOperations + ' gold-grade', 'flag'),
      statCard('Honours', career.honoursEarned + ' / ' + career.honoursTotal, 'Insignia and field decals', 'trophy'),
    );
    overview.appendChild(stats);
    const factions = el('section', 'vm-record-factions');
    factions.setAttribute('aria-label', 'Faction record');
    factions.appendChild(el('h3', 'vm-h3', 'Faction record'));
    const grid = el('div', 'vm-record-faction-grid');
    for (const faction of factionCareerRows(profile, playableFactions())) {
      const item = el('article', 'vm-record-faction');
      item.style.setProperty('--vm-faction', faction.color);
      item.append(el('strong', undefined, faction.name),
        el('span', 'vm-num', faction.wins + (faction.wins === 1 ? ' victory' : ' victories')));
      grid.appendChild(item);
    }
    factions.appendChild(grid);
    overview.appendChild(factions);
    const actions = el('div', 'vm-record-actions');
    actions.append(button('View Missions', { onClick: () => this.shell.openMissions('profile') }),
      button('View Operations', { onClick: () => this.shell.openCampaign() }));
    overview.appendChild(actions);
    return overview;
  }

  private buildHonours(collection: readonly CosmeticAward[], requestedPage?: number): void {
    const view = honoursBrowserView(collection, this.honourKind, this.honourFilter, this.selectedAward, requestedPage);
    this.honourView = view;
    this.selectedAward = view.selected?.id ?? null;
    const body = this.body!;
    body.classList.toggle('is-reading', this.readingAward && view.selected !== null);
    if (view.selected === null) {
      const empty = el('section', 'vm-record-unavailable');
      empty.append(el('h3', 'vm-h3', collection.length === 0 ? 'No honours authored yet' : 'No matching honours'),
        el('p', 'vm-body', collection.length === 0 ? 'No insignia or field decals exist in this catalogue.' : 'Try another award type or ownership filter.'));
      if (collection.length > 0) empty.appendChild(button('Show all honours', { onClick: () => {
        this.honourKind = this.honourFilter = 'all';
        this.kindSelect!.value = this.earnedSelect!.value = 'all';
        this.readingAward = false;
        this.render();
      } }));
      body.appendChild(empty);
      this.announce(collection.length === 0 ? 'No honours authored yet' : 'No matching honours');
      return;
    }
    const results = el('section', 'vm-record-award-results');
    results.setAttribute('aria-label', 'Honours collection');
    const list = el('ul', 'vm-record-award-list');
    for (const award of view.visible) {
      const item = el('li');
      const card = el('button', 'vm-record-award');
      card.type = 'button';
      card.dataset.awardId = award.id;
      card.dataset.recordFocus = 'award:' + award.id;
      card.setAttribute('aria-pressed', String(award.id === this.selectedAward));
      focusable(card);
      card.append(cosmeticMark(award.id, award.kind, 40), el('strong', undefined, award.name),
        el('span', undefined, award.earned ? 'Earned' : award.complete ? 'Awaiting debrief' : 'Not earned'));
      card.addEventListener('click', () => {
        this.selectedAward = award.id;
        this.readingAward = true;
        this.render();
        if (this.backToHonours?.offsetParent != null) this.backToHonours.focus({ preventScroll: true });
      });
      item.appendChild(card);
      list.appendChild(item);
    }
    results.appendChild(list);
    const pager = el('nav', 'vm-record-pager');
    pager.setAttribute('aria-label', 'Honour pages');
    for (const [label, delta, disabled] of [['Previous', -1, view.page === 0], ['Next', 1, view.page === view.pages - 1]] as const) {
      if (delta === 1) pager.appendChild(el('span', 'vm-num',
        (view.page * HONOURS_PAGE_SIZE + 1) + '–' + (view.page * HONOURS_PAGE_SIZE + view.visible.length) + ' / ' + view.filtered.length));
      const item = button(label, { disabled, onClick: () => this.render(view.page + delta) });
      item.dataset.recordFocus = label;
      pager.appendChild(item);
    }
    results.appendChild(pager);
    const detail = el('section', 'vm-record-award-detail');
    detail.setAttribute('aria-label', 'Selected honour details');
    detail.dataset.recordFocus = 'award-detail';
    focusable(detail);
    this.backToHonours = button('Back to honours', { onClick: () => {
      this.readingAward = false;
      this.render();
      this.focusAward();
    } });
    this.backToHonours.classList.add('vm-record-list-back');
    this.backToHonours.dataset.recordFocus = 'honours-back';
    detail.appendChild(this.backToHonours);
    const award = view.selected;
    const hero = el('div', 'vm-record-award-hero');
    const title = el('div');
    title.append(el('p', 'vm-record-kicker', award.kind === 'insignia' ? 'Command insignia' : 'Field decal'),
      el('h3', 'vm-record-award-name', award.name));
    hero.append(cosmeticMark(award.id, award.kind, 64), title);
    detail.append(hero, el('p', 'vm-record-award-status', award.earned ? 'Earned' : award.complete ? 'Awaiting debrief' : 'Not earned'),
      el('h4', 'vm-h3', award.missionTitle), el('p', 'vm-body', award.missionDescription));
    const progress = el('div', 'vm-record-progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', award.name + ' progress');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-valuenow', String(Math.round(progressFraction(award) * 100)));
    progress.setAttribute('aria-valuetext', progressLabel(award));
    const fill = el('i');
    fill.style.width = (progressFraction(award) * 100) + '%';
    progress.appendChild(fill);
    detail.append(progress, el('p', 'vm-record-award-count vm-num', progressLabel(award)),
      el('p', 'vm-body', 'Cosmetic only. Honours do not change combat strength.'));
    if (award.earned && award.claimedAt !== null && award.claimedAt > 0) {
      detail.appendChild(el('p', 'vm-body', 'Awarded ' + dateLabel(award.claimedAt)));
    }
    const missions = button('View Missions', { onClick: () => this.shell.openMissions('profile') });
    missions.dataset.recordFocus = 'view-missions';
    detail.appendChild(missions);
    body.append(results, detail);
    this.announce(award.name + ' selected · Page ' + (view.page + 1) + ' of ' + view.pages);
  }
}

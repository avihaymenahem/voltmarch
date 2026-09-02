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
  collection = cosmeticCollection(catalogue, profile.unlocked),
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

function profileFact(label: string, value: string): HTMLElement {
  const row = el('div', 'vm-profile-fact');
  row.appendChild(el('span', undefined, label));
  row.appendChild(el('strong', undefined, value));
  return row;
}

function profileChannel(label: string, detail: string): HTMLElement {
  const row = el('div', 'vm-profile-channel-row');
  row.appendChild(el('span', 'vm-profile-channel-dot'));
  row.appendChild(el('span', undefined, label));
  row.appendChild(el('strong', undefined, detail));
  return row;
}

function profileProgress(label: string, value: string, fraction: number, tone = 'cyan'): HTMLElement {
  const row = el('div', 'vm-profile-progress-row');
  const head = el('div', 'vm-profile-progress-head');
  head.appendChild(el('span', undefined, label));
  head.appendChild(el('strong', 'vm-num', value));
  row.appendChild(head);
  const rail = el('i', `vm-profile-progress-rail is-${tone}`);
  const fill = el('i', 'vm-profile-progress-fill');
  fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  rail.appendChild(fill);
  row.appendChild(rail);
  return row;
}

function profileMissionCard(mission: CatalogueEntry): HTMLElement {
  const card = el('article', `vm-profile-mission ${mission.locked ? 'is-locked' : 'is-active'}`);
  const previewByCategory: Record<CatalogueEntry['category'], string> = {
    combat: 'industrial-grid',
    economy: 'temperate-valley',
    construction: 'airbase-flats',
    tactics: 'frozen-sector',
    mastery: 'contested-strait',
  };
  const preview = el('div', 'vm-profile-mission-preview');
  preview.style.backgroundImage = `url("${import.meta.env.BASE_URL}maps/previews/${previewByCategory[mission.category]}.webp")`;
  preview.setAttribute('aria-hidden', 'true');
  card.appendChild(preview);
  const marker = el('div', 'vm-profile-mission-marker');
  marker.appendChild(icon(mission.progress.complete ? 'check' : mission.locked ? 'lock' : 'target', 16));
  card.appendChild(marker);
  const head = el('div', 'vm-profile-mission-head');
  head.appendChild(el('strong', 'vm-profile-mission-title', mission.title));
  head.appendChild(el('span', 'vm-profile-mission-state', mission.progress.complete ? 'Complete' : mission.locked ? 'Locked' : 'In progress'));
  card.appendChild(head);
  card.appendChild(el('p', 'vm-profile-mission-description', mission.description));
  if (mission.locked) {
    card.appendChild(el('span', 'vm-profile-mission-gate', 'Prerequisite mission required'));
  } else {
    const progress = el('div', 'vm-profile-mission-progress');
    const rail = el('i', 'vm-profile-mission-rail');
    const fill = el('i', 'vm-profile-mission-fill');
    const target = Math.max(1, mission.progress.target);
    fill.style.width = `${Math.min(100, Math.max(0, mission.progress.value / target * 100)).toFixed(1)}%`;
    rail.appendChild(fill);
    progress.appendChild(rail);
    progress.appendChild(el(
      'span',
      'vm-profile-mission-count vm-num',
      `${Math.floor(Math.min(target, mission.progress.value)).toLocaleString('en-US')} / ${target.toLocaleString('en-US')}`,
    ));
    card.appendChild(progress);
  }
  return card;
}


function awardCard(award: CosmeticAward, index: number): HTMLElement {
  const card = el('article', `vm-profile-award ${award.earned ? 'is-earned' : 'is-locked'}`);
  card.title = award.earned
    ? `${award.name} — earned from ${award.missionTitle}`
    : `${award.name} — ${award.missionDescription}`;
  const visual = el('div', 'vm-profile-award-visual');
  visual.appendChild(cosmeticMark(award.id, award.kind));
  visual.appendChild(el('span', 'vm-profile-award-index vm-num', String(index + 1).padStart(2, '0')));
  card.appendChild(visual);
  card.appendChild(el('strong', 'vm-profile-award-name', award.name));
  card.appendChild(el('span', 'vm-profile-award-source', award.missionTitle));
  const progress = el('div', 'vm-profile-award-progress');
  const rail = el('i', 'vm-profile-award-rail');
  const fill = el('i', 'vm-profile-award-fill');
  fill.style.width = `${(progressFraction(award) * 100).toFixed(1)}%`;
  rail.appendChild(fill);
  progress.appendChild(rail);
  progress.appendChild(el('span', undefined, progressLabel(award)));
  card.appendChild(progress);
  return card;
}

export class ProfileScreen implements Screen {
  readonly id = 'profile';
  private host: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private identityNotice = '';
  private progression: ProgressionView | null;
  private profileReader: { dispose(): void } | null = null;
  private loadingProfile = false;
  private profileLoadError: unknown = null;

  constructor(private readonly shell: Shell, progression?: ProgressionView | null) {
    this.progression = progression ?? readProgression();
  }

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page', 'is-modal', 'vm-profile-page', 'vm-profile-reference-page');
    const frame = pageFrame('Service Record', () => this.close());
    frame.root.classList.add('vm-profile-panel');
    frame.root.classList.add('vm-profile-reference-panel');
    frame.head.appendChild(el('span', 'vm-profile-head-code', 'CAREER // LOCAL PROFILE'));
    frame.body.classList.add('vm-profile-body');
    this.body = frame.body;

    frame.foot.appendChild(button('Missions', {
      iconName: 'trophy',
      onClick: () => this.shell.openMissions('profile'),
    }));
    frame.foot.appendChild(button('Close', { variant: 'primary', onClick: () => this.close() }));
    host.appendChild(frame.root);
    this.render();

    if (this.progression !== null) {
      this.subscribeToProgression(this.progression);
    } else {
      this.loadingProfile = true;
      void this.loadProfileReader();
    }
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.profileReader?.dispose();
    this.profileReader = null;
    this.body = null;
    this.host?.classList.remove('vm-page', 'is-modal', 'vm-profile-page', 'vm-profile-reference-page');
    this.host = null;
  }

  onBack(): boolean {
    this.close();
    return true;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    const body = this.body;
    if (body === null) return false;
    const page = Math.max(120, body.clientHeight - 60);
    if (e.code === 'PageDown') { body.scrollTop += page; return true; }
    if (e.code === 'PageUp') { body.scrollTop -= page; return true; }
    if (e.code === 'Home') { body.scrollTop = 0; return true; }
    if (e.code === 'End') { body.scrollTop = body.scrollHeight; return true; }
    return false;
  }

  private close(): void {
    this.shell.showMenu();
  }

  /** Attach one reader and keep its lifetime tied to this modal. */
  private subscribeToProgression(progression: ProgressionView): void {
    try { this.unsubscribe = progression.subscribe(() => this.render()); } catch { /* read once */ }
  }

  /** Load profile data on demand without booting the battlefield engine. */
  private async loadProfileReader(): Promise<void> {
    try {
      const { ProfileReader } = await import('./profile-reader');
      const reader = new ProfileReader();
      if (this.body === null) {
        reader.dispose();
        return;
      }
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

  /** One editor over the same settings field consumed by lobby and records. */
  private buildIdentityEditor(): HTMLFormElement {
    const commanderName = normalizeCommanderName(this.shell.settings.get().gameplay.commanderName)
      ?? 'Commander';
    const editor = el('form', 'vm-profile-editor');
    editor.setAttribute('aria-label', 'Commander identity');
    const editorCopy = el('div', 'vm-profile-editor-copy');
    const label = el('label', 'vm-profile-editor-label', 'Commander identity');
    label.htmlFor = 'vm-profile-commander-name';
    editorCopy.appendChild(label);
    editorCopy.appendChild(el(
      'p',
      'vm-profile-editor-note',
      'Your local callsign is used in multiplayer, chat, results, replays and this service record.',
    ));
    editor.appendChild(editorCopy);

    const field = el('div', 'vm-profile-editor-field');
    const nameInput = el('input', 'vm-profile-name-input');
    nameInput.id = 'vm-profile-commander-name';
    nameInput.type = 'text';
    nameInput.maxLength = COMMANDER_NAME_MAX;
    nameInput.autocomplete = 'off';
    nameInput.spellcheck = false;
    nameInput.value = commanderName;
    nameInput.setAttribute('aria-describedby', 'vm-profile-identity-status');
    focusable(nameInput);
    field.appendChild(nameInput);

    const commitIdentity = (): void => {
      const next = normalizeCommanderName(nameInput.value);
      const invalid = next === null;
      nameInput.classList.toggle('is-invalid', invalid);
      nameInput.setAttribute('aria-invalid', invalid ? 'true' : 'false');
      if (next === null) {
        this.identityNotice = `Enter a visible callsign up to ${COMMANDER_NAME_MAX} characters.`;
        const live = editor.querySelector<HTMLElement>('#vm-profile-identity-status');
        if (live !== null) live.textContent = this.identityNotice;
        nameInput.focus();
        return;
      }
      this.shell.settings.patch({ gameplay: { commanderName: next } });
      this.identityNotice = 'Commander identity updated.';
      this.render();
    };

    field.appendChild(button('Update Identity', {
      iconName: 'check',
      variant: 'primary',
      onClick: commitIdentity,
    }));
    editor.appendChild(field);
    const status = el('p', 'vm-profile-editor-status', this.identityNotice);
    status.id = 'vm-profile-identity-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    editor.appendChild(status);
    editor.addEventListener('submit', (event) => {
      event.preventDefault();
      commitIdentity();
    });
    return editor;
  }

  /** Truthful dossier shell for sessions where progression cannot be read. */
  private buildUnavailableDossier(title: string, detail: string, warning = false): HTMLElement {
    const commanderName = normalizeCommanderName(this.shell.settings.get().gameplay.commanderName)
      ?? 'Commander';
    const dossier = el('section', 'vm-profile-offline-dossier');

    const plate = el('div', 'vm-profile-offline-plate');
    const crest = el('div', 'vm-profile-offline-crest');
    crest.appendChild(icon('crest', 52));
    plate.appendChild(crest);
    plate.appendChild(el('span', 'vm-profile-kicker', 'LOCAL COMMAND IDENTITY'));
    plate.appendChild(el('strong', 'vm-profile-offline-name', commanderName.toLocaleUpperCase()));
    plate.appendChild(el('span', 'vm-profile-offline-clearance', 'IDENTITY CHANNEL ACTIVE'));

    const status = el('div', `vm-profile-offline-status${warning ? ' is-warning' : ''}`);
    status.appendChild(icon(warning ? 'warning' : 'info', 28));
    status.appendChild(el('span', 'vm-profile-offline-code', warning ? 'RECORD // READ ERROR' : 'RECORD // OFFLINE'));
    status.appendChild(el('h3', 'vm-h3', title));
    status.appendChild(el('p', 'vm-body', detail));
    status.appendChild(el('p', 'vm-profile-offline-truth', 'No career totals or honours are shown while the record channel is unavailable.'));

    dossier.appendChild(plate);
    dossier.appendChild(status);
    return dossier;
  }

  private render(): void {
    const body = this.body;
    if (body === null) return;
    body.replaceChildren();
    // Identity remains editable even if progression is temporarily offline;
    // it belongs to settings, not to the mission tracker lifecycle.
    const identityEditor = this.buildIdentityEditor();
    identityEditor.classList.add('vm-profile-identity-editor');
    const progression = this.progression;
    if (progression === null) {
      const identityColumn = el('section', 'vm-profile-identity-column');
      identityColumn.appendChild(identityEditor);
      if (this.loadingProfile) {
        identityColumn.appendChild(this.buildUnavailableDossier(
          'Loading service record',
          'Reading your local profile. The battlefield is not being started.',
        ));
        body.appendChild(identityColumn);
        return;
      }
      if (this.profileLoadError !== null) {
        identityColumn.appendChild(this.buildUnavailableDossier(
          'Service record unreadable',
          String(this.profileLoadError),
          true,
        ));
        body.appendChild(identityColumn);
        return;
      }
      identityColumn.appendChild(this.buildUnavailableDossier(
        'Service record offline',
        'Progression is not available in this session. Your stored profile has not been changed.',
      ));
      body.appendChild(identityColumn);
      return;
    }

    let profile: ProfileView;
    let catalogue: readonly CatalogueEntry[];
    try {
      profile = progression.profile();
      catalogue = progression.catalogue();
    } catch (err) {
      body.appendChild(this.buildUnavailableDossier('Service record unreadable', String(err), true));
      return;
    }

    const collection = cosmeticCollection(catalogue, profile.unlocked);
    const career = careerRecord(profile, catalogue, collection);
    const earned = collection.filter((a) => a.earned);
    const featured = earned.at(-1) ?? collection[0];
    const factionRows = factionCareerRows(profile, playableFactions());
    const maxWins = Math.max(1, ...factionRows.map((f) => f.wins));

    const dossier = el('section', 'vm-profile-dossier');
    const commanderName = normalizeCommanderName(this.shell.settings.get().gameplay.commanderName)
      ?? 'Commander';
    const identity = el('div', 'vm-profile-identity');
    const portraitFrame = el('div', 'vm-profile-portrait-frame');
    const portrait = document.createElement('img');
    portrait.src = `${import.meta.env.BASE_URL}campaign/portraits/nael.webp`;
    portrait.alt = 'Commander portrait';
    portrait.loading = 'eager';
    portraitFrame.appendChild(portrait);
    const crest = el('div', `vm-profile-crest${earned.length === 0 ? ' is-empty' : ''}`);
    if (featured !== undefined) crest.appendChild(cosmeticMark(featured.id, featured.kind, 104));
    portraitFrame.appendChild(crest);
    identity.appendChild(portraitFrame);
    const copy = el('div', 'vm-profile-identity-copy');
    copy.appendChild(el('span', 'vm-profile-kicker', 'LOCAL COMMAND IDENTITY'));
    copy.appendChild(el('h3', 'vm-profile-callsign', commanderName.toLocaleUpperCase()));
    copy.appendChild(el('p', 'vm-profile-service', `Service record opened ${dateLabel(profile.createdAt)}`));
    const chips = el('div', 'vm-profile-chips');
    chips.appendChild(el('span', 'vm-chip', `${career.honoursEarned} honours`));
    chips.appendChild(el('span', 'vm-chip', `${career.operationsComplete} operations`));
    chips.appendChild(el('span', 'vm-chip', `${career.winRate.toFixed(0)}% win rate`));
    copy.appendChild(chips);
    identity.appendChild(copy);
    dossier.appendChild(identity);

    const facts = el('div', 'vm-profile-identity-facts');
    facts.appendChild(profileFact('Status', 'Active duty'));
    facts.appendChild(profileFact('Rank', 'Commander'));
    facts.appendChild(profileFact('Record', 'Local profile'));
    facts.appendChild(profileFact('D.O.S.', dateLabel(profile.createdAt)));
    dossier.appendChild(facts);

    const channels = el('div', 'vm-profile-identity-channels');
    channels.appendChild(el('span', 'vm-profile-subhead', 'IDENTITY CHANNELS'));
    channels.appendChild(profileChannel('Multiplayer', 'SHARED'));
    channels.appendChild(profileChannel('Chat and results', 'SHARED'));
    channels.appendChild(profileChannel('Replays', 'SHARED'));
    dossier.appendChild(channels);

    const ribbons = el('div', 'vm-profile-ribbons');
    const recent = earned.slice(-4).reverse();
    ribbons.appendChild(el('span', 'vm-profile-ribbons-label', recent.length > 0 ? 'Displayed honours' : 'No honours earned yet'));
    for (const award of recent) {
      const mark = el('div', 'vm-profile-ribbon');
      mark.title = award.name;
      mark.appendChild(cosmeticMark(award.id, award.kind, 46));
      ribbons.appendChild(mark);
    }
    dossier.appendChild(ribbons);

    const identityColumn = el('section', 'vm-profile-identity-column');
    identityColumn.appendChild(dossier);
    identityColumn.appendChild(identityEditor);
    body.appendChild(identityColumn);

    const stats = el('div', 'vm-profile-stats vm-profile-career-summary');
    stats.appendChild(statCard('Matches', career.matches.toLocaleString('en-US'), `${career.wins} victories · ${career.losses} defeats`, 'swords'));
    stats.appendChild(statCard('Win rate', `${career.winRate.toFixed(1)}%`, career.matches > 0 ? 'Lifetime skirmish record' : 'Complete a skirmish to establish', 'target'));
    stats.appendChild(statCard('Current streak', career.currentStreak.toLocaleString('en-US'), `Best ${career.bestStreak.toLocaleString('en-US')}`, 'clock'));
    stats.appendChild(statCard('Missions', `${career.missionsComplete} / ${career.missionsTotal}`, 'Profile chains completed', 'trophy'));
    stats.appendChild(statCard('Operations', career.operationsComplete.toLocaleString('en-US'), `${career.goldOperations} gold-grade`, 'flag'));
    stats.appendChild(statCard('Honours', `${career.honoursEarned} / ${career.honoursTotal}`, 'Insignia and field decals', 'trophy'));

    const careerBoard = el('section', 'vm-profile-career-board');
    careerBoard.appendChild(stats);
    const performance = el('section', 'vm-profile-performance');
    performance.appendChild(el('span', 'vm-profile-subhead', 'COMBAT PERFORMANCE'));
    performance.appendChild(profileProgress('Victory rate', `${career.winRate.toFixed(1)}%`, career.winRate / 100, 'violet'));
    performance.appendChild(profileProgress('Current streak', `${career.currentStreak} wins`, career.bestStreak > 0 ? career.currentStreak / career.bestStreak : 0, 'cyan'));
    performance.appendChild(profileProgress('Best streak', `${career.bestStreak} wins`, career.bestStreak > 0 ? 1 : 0, 'amber'));
    careerBoard.appendChild(performance);

    const careerProgression = el('section', 'vm-profile-progression');
    careerProgression.appendChild(el('span', 'vm-profile-subhead', 'CAREER PROGRESSION'));
    careerProgression.appendChild(profileProgress('Profile chains', `${career.missionsComplete} / ${career.missionsTotal}`, career.missionsTotal > 0 ? career.missionsComplete / career.missionsTotal : 0, 'violet'));
    careerProgression.appendChild(profileProgress('Operations cleared', `${career.operationsComplete} / ${CAMPAIGN_OPERATION_COUNT}`, Math.min(1, career.operationsComplete / CAMPAIGN_OPERATION_COUNT), 'cyan'));
    careerProgression.appendChild(profileProgress('Honours recovered', `${career.honoursEarned} / ${career.honoursTotal}`, career.honoursTotal > 0 ? career.honoursEarned / career.honoursTotal : 0, 'amber'));
    careerBoard.appendChild(careerProgression);

    const specializations = el('section', 'vm-profile-specializations');
    specializations.appendChild(el('span', 'vm-profile-subhead', 'COMMAND SPECIALIZATIONS'));
    const specializationGrid = el('div', 'vm-profile-specialization-grid');
    factionRows.forEach((faction) => {
      const item = el('article', 'vm-profile-specialization');
      item.style.setProperty('--vm-faction', faction.color);
      item.appendChild(el('i', 'vm-profile-specialization-stripe'));
      item.appendChild(el('strong', undefined, faction.name));
      item.appendChild(el('span', undefined, `${faction.wins} victories credited`));
      specializationGrid.appendChild(item);
    });
    specializations.appendChild(specializationGrid);
    careerBoard.appendChild(specializations);
    body.appendChild(careerBoard);

    const missionPanel = el('section', 'vm-profile-mission-panel');
    const missionHead = el('div', 'vm-profile-section-head');
    missionHead.appendChild(el('span', 'vm-profile-section-index', '03'));
    const missionTitle = el('div');
    missionTitle.appendChild(el('h3', 'vm-h3', 'Missions'));
    missionTitle.appendChild(el('p', 'vm-body', `${career.missionsComplete} of ${career.missionsTotal} profile chains complete.`));
    missionHead.appendChild(missionTitle);
    missionPanel.appendChild(missionHead);
    const missionFilters = el('div', 'vm-profile-mission-filters');
    missionFilters.setAttribute('aria-label', 'Filter profile missions');
    const missionList = el('div', 'vm-profile-mission-list');
    const renderMissions = (filter: ProfileMissionFilter): void => {
      const rows = profileMissionRows(catalogue, filter);
      missionList.replaceChildren();
      if (rows.length === 0) {
        missionList.appendChild(el('p', 'vm-profile-mission-empty', filter === 'complete'
          ? 'No profile missions completed yet.' : 'No missions in this category. Explore the full catalogue below.'));
      }
      rows.forEach((mission) => missionList.appendChild(profileMissionCard(mission)));
      for (const item of missionFilters.querySelectorAll<HTMLButtonElement>('button')) {
        const active = item.dataset.filter === filter;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      }
    };
    for (const [filter, label] of [['all', 'All'], ['active', 'Active'], ['complete', 'Complete']] as const) {
      const item = el('button', undefined, label);
      item.type = 'button';
      item.dataset.filter = filter;
      focusable(item);
      item.addEventListener('click', () => renderMissions(filter));
      missionFilters.appendChild(item);
    }
    missionPanel.appendChild(missionFilters);
    missionPanel.appendChild(missionList);
    renderMissions('all');
    missionPanel.appendChild(button('View all missions', {
      iconName: 'chevronRight', onClick: () => this.shell.openMissions('profile'),
    }));
    body.appendChild(missionPanel);

    const factionSection = el('section', 'vm-profile-section vm-profile-faction-record');
    const factionHead = el('div', 'vm-profile-section-head');
    factionHead.appendChild(el('span', 'vm-profile-section-index', '01'));
    const factionTitle = el('div');
    factionTitle.appendChild(el('h3', 'vm-h3', 'Faction record'));
    factionTitle.appendChild(el('p', 'vm-body', 'Victories credited to each command doctrine.'));
    factionHead.appendChild(factionTitle);
    factionSection.appendChild(factionHead);
    const factionGrid = el('div', 'vm-profile-factions');
    for (const faction of factionRows) {
      const card = el('article', 'vm-profile-faction');
      card.style.setProperty('--vm-faction', faction.color);
      card.appendChild(el('i', 'vm-profile-faction-stripe'));
      card.appendChild(el('strong', 'vm-profile-faction-name', faction.name));
      card.appendChild(el('span', 'vm-profile-faction-wins vm-num', `${faction.wins} win${faction.wins === 1 ? '' : 's'}`));
      const rail = el('i', 'vm-profile-faction-rail');
      const fill = el('i', 'vm-profile-faction-fill');
      fill.style.width = `${(faction.wins / maxWins * 100).toFixed(1)}%`;
      rail.appendChild(fill);
      card.appendChild(rail);
      factionGrid.appendChild(card);
    }
    factionSection.appendChild(factionGrid);
    body.appendChild(factionSection);

    const honourSection = el('section', 'vm-profile-section vm-profile-honours-record');
    const honourHead = el('div', 'vm-profile-section-head');
    honourHead.appendChild(el('span', 'vm-profile-section-index', '02'));
    const honourTitle = el('div');
    honourTitle.appendChild(el('h3', 'vm-h3', 'Honours collection'));
    honourTitle.appendChild(el('p', 'vm-body', `${career.honoursEarned} of ${career.honoursTotal} recovered. Every award names the mission that pays it.`));
    honourHead.appendChild(honourTitle);
    honourSection.appendChild(honourHead);

    for (const kind of ['insignia', 'decal'] as const) {
      const awards = collection.filter((a) => a.kind === kind);
      if (awards.length === 0) continue;
      const groupHead = el('div', 'vm-profile-group-head');
      groupHead.appendChild(el('span', 'vm-profile-group-title', kind === 'insignia' ? 'Command insignia' : 'Field decals'));
      groupHead.appendChild(el('span', 'vm-profile-group-count vm-num', `${awards.filter((a) => a.earned).length} / ${awards.length}`));
      honourSection.appendChild(groupHead);
      const grid = el('div', 'vm-profile-awards');
      awards.forEach((award, i) => grid.appendChild(awardCard(award, i)));
      honourSection.appendChild(grid);
    }
     body.appendChild(honourSection);

    const clearance = el('section', 'vm-profile-clearance-record');
    clearance.appendChild(el('span', 'vm-profile-subhead', 'CLEARANCE LEVEL'));
    clearance.appendChild(el('strong', 'vm-profile-clearance-level', 'LOCAL'));
    clearance.appendChild(el('span', 'vm-profile-clearance-status', 'ACCESS GRANTED'));
    clearance.appendChild(el('i', 'vm-profile-clearance-rule'));
    clearance.appendChild(el('span', 'vm-profile-clearance-code', 'PROFILE CHANNEL // VERIFIED'));
    body.appendChild(clearance);
  }
}

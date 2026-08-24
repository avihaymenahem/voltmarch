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
  icon,
  pageFrame,
  playableFactions,
  type FactionOption,
  type Screen,
  type Shell,
} from './Shell';
import { humaniseId } from './Missions';
import { cosmeticKind, cosmeticMark, type CosmeticKind } from './CosmeticMarks';

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
  private readonly progression: ProgressionView | null;

  constructor(private readonly shell: Shell, progression?: ProgressionView | null) {
    this.progression = progression ?? readProgression();
  }

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page', 'is-modal', 'vm-profile-page');
    const frame = pageFrame('Service Record', () => this.close());
    frame.root.classList.add('vm-profile-panel');
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
      try { this.unsubscribe = this.progression.subscribe(() => this.render()); } catch { /* read once */ }
    }
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.body = null;
    this.host?.classList.remove('vm-page', 'is-modal', 'vm-profile-page');
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

  private render(): void {
    const body = this.body;
    if (body === null) return;
    body.replaceChildren();
    const progression = this.progression;
    if (progression === null) {
      const empty = el('div', 'vm-profile-empty');
      empty.appendChild(icon('info', 24));
      empty.appendChild(el('h3', 'vm-h3', 'Service record offline'));
      empty.appendChild(el('p', 'vm-body', 'Progression is not available in this session. Your stored profile has not been changed.'));
      body.appendChild(empty);
      return;
    }

    let profile: ProfileView;
    let catalogue: readonly CatalogueEntry[];
    try {
      profile = progression.profile();
      catalogue = progression.catalogue();
    } catch (err) {
      const empty = el('div', 'vm-profile-empty');
      empty.appendChild(icon('warning', 24));
      empty.appendChild(el('h3', 'vm-h3', 'Service record unreadable'));
      empty.appendChild(el('p', 'vm-body', String(err)));
      body.appendChild(empty);
      return;
    }

    const collection = cosmeticCollection(catalogue, profile.unlocked);
    const career = careerRecord(profile, catalogue, collection);
    const earned = collection.filter((a) => a.earned);
    const featured = earned.at(-1) ?? collection[0];

    const dossier = el('section', 'vm-profile-dossier');
    const identity = el('div', 'vm-profile-identity');
    const crest = el('div', `vm-profile-crest${earned.length === 0 ? ' is-empty' : ''}`);
    if (featured !== undefined) crest.appendChild(cosmeticMark(featured.id, featured.kind, 104));
    identity.appendChild(crest);
    const copy = el('div', 'vm-profile-identity-copy');
    copy.appendChild(el('span', 'vm-profile-kicker', 'VOLTMARCH COMMAND AUTHORITY'));
    copy.appendChild(el('h3', 'vm-profile-callsign', 'COMMANDER'));
    copy.appendChild(el('p', 'vm-profile-service', `Service record opened ${dateLabel(profile.createdAt)}`));
    const chips = el('div', 'vm-profile-chips');
    chips.appendChild(el('span', 'vm-chip', `${career.honoursEarned} honours`));
    chips.appendChild(el('span', 'vm-chip', `${career.operationsComplete} operations`));
    chips.appendChild(el('span', 'vm-chip', `${career.winRate.toFixed(0)}% win rate`));
    copy.appendChild(chips);
    identity.appendChild(copy);
    dossier.appendChild(identity);

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
    body.appendChild(dossier);

    const stats = el('section', 'vm-profile-stats');
    stats.appendChild(statCard('Matches', career.matches.toLocaleString('en-US'), `${career.wins} victories · ${career.losses} defeats`, 'swords'));
    stats.appendChild(statCard('Win rate', `${career.winRate.toFixed(1)}%`, career.matches > 0 ? 'Lifetime skirmish record' : 'Complete a skirmish to establish', 'target'));
    stats.appendChild(statCard('Current streak', career.currentStreak.toLocaleString('en-US'), `Best ${career.bestStreak.toLocaleString('en-US')}`, 'bolt'));
    stats.appendChild(statCard('Missions', `${career.missionsComplete} / ${career.missionsTotal}`, 'Profile chains completed', 'trophy'));
    stats.appendChild(statCard('Operations', career.operationsComplete.toLocaleString('en-US'), `${career.goldOperations} gold-grade`, 'flag'));
    stats.appendChild(statCard('Honours', `${career.honoursEarned} / ${career.honoursTotal}`, 'Insignia and field decals', 'crest'));
    body.appendChild(stats);

    const factionSection = el('section', 'vm-profile-section');
    const factionHead = el('div', 'vm-profile-section-head');
    factionHead.appendChild(el('span', 'vm-profile-section-index', '01'));
    const factionTitle = el('div');
    factionTitle.appendChild(el('h3', 'vm-h3', 'Faction record'));
    factionTitle.appendChild(el('p', 'vm-body', 'Victories credited to each command doctrine.'));
    factionHead.appendChild(factionTitle);
    factionSection.appendChild(factionHead);
    const factionGrid = el('div', 'vm-profile-factions');
    const factionRows = factionCareerRows(profile, playableFactions());
    const maxWins = Math.max(1, ...factionRows.map((f) => f.wins));
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

    const honourSection = el('section', 'vm-profile-section');
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
  }
}

/**
 * ============================================================================
 * src/shell/EndScreen.ts — victory and defeat
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
 * ============================================================================
 */

import type { PlayerStats } from '../core/types';
import { DIFFICULTIES } from './settings-store';
import { formatClock } from './PauseMenu';
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
  opponentName: string;
  mapName: string;
  difficulty: number;
  speed: number;
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
    { label: 'Credits Spent', value: Math.round(s.creditsSpent).toLocaleString() },
    { label: 'Credits Left', value: Math.round(r.credits).toLocaleString() },
  ];
}

export class EndScreen implements Screen {
  readonly id = 'ended';
  private host: HTMLElement | null = null;

  constructor(
    private readonly shell: Shell,
    private readonly result: MatchResult,
  ) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-end', 'is-modal');

    const r = this.result;
    const p = panel('vm-end-panel');

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
    badge.appendChild(oppChip);

    const speedChip = el('div', 'vm-chip');
    speedChip.appendChild(icon('gauge', 14));
    speedChip.appendChild(el('span', undefined, `${r.speed.toFixed(1)}× · ${formatClock(r.wallSec)} real`));
    badge.appendChild(speedChip);

    head.appendChild(badge);
    const verdict = el('h1', `vm-verdict ${r.won ? 'is-win' : 'is-loss'}`, r.won ? 'Victory' : 'Defeat');
    head.appendChild(verdict);
    head.appendChild(el('p', 'vm-body', r.won
      ? `Every hostile force on ${r.mapName} has been destroyed. ${r.factionName} holds the field.`
      : `${r.factionName} has no units and no structures remaining on ${r.mapName}.`));
    p.appendChild(head);

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
    foot.appendChild(button('Rematch', {
      iconName: 'refresh',
      onClick: () => { void this.shell.restartMatch(); },
    }));
    foot.appendChild(el('div', 'vm-spacer'));
    foot.appendChild(button('New Skirmish', {
      iconName: 'swords',
      onClick: () => { void this.shell.quitToMenu().then(() => this.shell.openSetup()); },
    }));
    foot.appendChild(button('Main Menu', {
      iconName: 'power',
      variant: 'primary',
      onClick: () => { void this.shell.quitToMenu(); },
    }));
    p.appendChild(foot);

    host.appendChild(p);
  }

  unmount(): void {
    this.host?.classList.remove('vm-end', 'is-modal');
    this.host = null;
  }

  onBack(): boolean {
    void this.shell.quitToMenu();
    return true;
  }
}

/**
 * ============================================================================
 * src/shell/PauseMenu.ts — Escape, mid-match
 * ============================================================================
 * Four choices and a status line. Deliberately the smallest screen in the
 * product: a pause menu is a thing you pass through, and every extra control
 * on it is a control the player has to read before getting back to the match.
 *
 * The sim is already stopped by the time this mounts — `Shell.pause()` calls
 * `GameHandle.setPaused(true)` first — so the frame behind the glass is a
 * frozen battlefield, not a running one. Rendering continues, which is why the
 * blur behind the panel is live rather than a screenshot.
 *
 * RESTART REROLLS THE SEED
 * ------------------------
 * `Shell.restartMatch()` passes `seed: 0`, which `startMatch` reads as "roll a
 * fresh one". Restarting an unwinnable position into the identical unwinnable
 * position is not a feature. A player who wants the same battle types the seed
 * into the lobby, where it is explicit.
 * ============================================================================
 */

import { DIFFICULTIES, SPEEDS, mapById } from './settings-store';
import {
  button,
  el,
  icon,
  panel,
  playableFactions,
  type Screen,
  type Shell,
} from './Shell';

/** `m:ss` for anything under an hour, `h:mm:ss` past it. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export class PauseMenuScreen implements Screen {
  readonly id = 'paused';
  private host: HTMLElement | null = null;
  private clock: HTMLElement | null = null;
  private timer = 0;

  constructor(private readonly shell: Shell) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-pause', 'is-modal');

    const p = panel('vm-pause-panel');

    const head = el('div', 'vm-pause-head');
    head.appendChild(el('p', 'vm-subtitle', 'Paused'));
    const setup = this.shell.getSetup();
    head.appendChild(el('h2', 'vm-h2', mapById(setup.map).name));
    p.appendChild(head);

    const stats = el('div', 'vm-pause-stats');
    const clock = el('span', 'vm-num', formatClock(this.shell.matchSeconds()));
    this.clock = clock;
    const clockWrap = el('span');
    clockWrap.appendChild(icon('clock', 13));
    clockWrap.appendChild(clock);
    clockWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
    stats.appendChild(clockWrap);

    const faction = playableFactions().find((f) => f.key === setup.playerFaction);
    stats.appendChild(el('span', undefined, faction?.name ?? '—'));
    stats.appendChild(el('span', undefined, `${DIFFICULTIES[setup.difficulty]} · ${SPEEDS[setup.speed].toFixed(1)}×`));
    p.appendChild(stats);

    const nav = el('nav', 'vm-pause-nav');
    nav.setAttribute('aria-label', 'Pause menu');
    nav.appendChild(button('Resume', {
      iconName: 'play',
      variant: 'primary',
      hint: 'Esc',
      onClick: () => this.shell.resume(),
    }));
    nav.appendChild(button('Options', {
      iconName: 'sliders',
      onClick: () => this.shell.openSettings('paused'),
    }));
    nav.appendChild(button('Restart Battle', {
      iconName: 'refresh',
      onClick: () => { void this.shell.restartMatch(); },
    }));
    nav.appendChild(button('Quit To Menu', {
      iconName: 'power',
      variant: 'danger',
      onClick: () => { void this.shell.quitToMenu(); },
    }));
    p.appendChild(nav);

    host.appendChild(p);

    // The clock keeps ticking visually only if the sim does; it does not, so
    // this exists purely to catch the case where something else resumed it.
    this.timer = window.setInterval(() => {
      if (this.clock !== null) this.clock.textContent = formatClock(this.shell.matchSeconds());
    }, 500);
  }

  unmount(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.clock = null;
    this.host?.classList.remove('vm-pause', 'is-modal');
    this.host = null;
  }

  onBack(): boolean {
    this.shell.resume();
    return true;
  }
}

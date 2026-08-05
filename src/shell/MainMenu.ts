/**
 * ============================================================================
 * src/shell/MainMenu.ts — the title screen and the credits
 * ============================================================================
 * The menu is a left-hand column over a LIVE battlefield: `Shell` boots a real
 * match behind it with the AI switched off and slowly orbits the camera around
 * a base. Nothing here paints a background — the background is the game.
 *
 * The only two visual jobs this file has are (a) guaranteeing the title reads
 * against whatever the renderer happens to be showing, which is the job of the
 * `.vm-menu::before` wash rather than of a panel, and (b) keeping the button
 * column narrow enough that the battlefield is still the subject of the frame.
 *
 * "LOAD" IS DISABLED WHEN, AND ONLY WHEN, THERE IS NOTHING TO LOAD
 * ----------------------------------------------------------------
 * This entry used to be unconditionally disabled with the hint "No saves",
 * because there was no save system at all. There is one now, and the RULE that
 * justified the old state is the same rule that decides the new one: a button
 * that opens an empty list is worse than a button that tells the truth. So it
 * is enabled exactly when `saveSlots()` is non-empty, it counts them in the
 * hint, and with no saves — or in a build with `src/save/**` removed, or under
 * the `?shot=` harness where no save service is published — it goes back to
 * saying "No saves" and refusing the click.
 *
 * The count is read ONCE, at mount. That is correct rather than lazy: the
 * title screen is re-mounted by `Shell.showMenu()` on every route back to it,
 * including the one out of the load screen, so a deleted last slot disables
 * the button by the time the player can see it.
 * ============================================================================
 */

import { MAPS } from './settings-store';
import { saveSlots } from './LoadGame';
import {
  button,
  el,
  icon,
  pageFrame,
  playableFactions,
  type Screen,
  type Shell,
} from './Shell';
import { readProgression } from './progression-link';
import { tutorialMenuHint, tutorialUntouched } from './Tutorial';

/* ==========================================================================
 * MAIN MENU
 * ========================================================================== */

/**
 * The hint under the Missions button: "3 / 20" earned.
 *
 * Empty string when there is no progression handle, which collapses the hint
 * row rather than printing "0 / 0" — the `?shot=` harness and any build with
 * `src/progression/**` removed get a plain button, not a broken counter.
 */
function missionsHint(): string {
  const p = readProgression();
  if (p === null) return '';
  try {
    const rows = p.catalogue().filter((m) => m.scope === 'profile');
    if (rows.length === 0) return '';
    const done = rows.reduce((n, m) => n + (m.progress.complete ? 1 : 0), 0);
    return `${done} / ${rows.length}`;
  } catch {
    return '';
  }
}

/**
 * The hint under Load Game.
 *
 * "No saves" is preserved VERBATIM for the empty case — it is the sentence the
 * old unconditional-disable shipped, and it is still the truthful one.
 */
export function loadHint(count: number): string {
  if (count <= 0) return 'No saves';
  return count === 1 ? '1 save' : `${count} saves`;
}

export class MainMenuScreen implements Screen {
  readonly id = 'menu';
  private host: HTMLElement | null = null;

  constructor(private readonly shell: Shell) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-menu');

    const inner = el('div', 'vm-menu-inner');

    /* -- brand ------------------------------------------------------------ */
    const brand = el('div', 'vm-menu-brand');
    const title = el('h1', 'vm-title');
    // The supplied lockup rather than a CSS re-creation of it, so the menu, the
    // boot curtain and the favicon are all literally the same artwork.
    const logo = document.createElement('img');
    logo.className = 'vm-logo';
    // BASE_URL, not a leading slash: vite is configured with `base: './'` so the
    // build can be served from a subpath, and an absolute path would 404 there.
    logo.src = `${import.meta.env.BASE_URL}brand/logo-720.png`;
    logo.alt = 'Voltmarch';
    logo.width = 720;
    logo.height = 333;
    title.appendChild(logo);
    brand.appendChild(title);
    const rule = el('hr', 'vm-rule is-accent');
    brand.appendChild(rule);
    brand.appendChild(el('p', 'vm-subtitle', 'Tactical Combat Simulation'));
    inner.appendChild(brand);

    /* -- nav -------------------------------------------------------------- */
    const nav = el('nav', 'vm-menu-nav');
    nav.setAttribute('aria-label', 'Main menu');

    // FIRST, and accented until it has been opened once.
    //
    // A tutorial buried under Skirmish is a tutorial nobody finds, and the
    // whole point of the item is the player who has never played an RTS. Once
    // they have been through it the accent moves back to Skirmish, so a
    // returning player is not shouted at by a screen they have finished with.
    const fresh = tutorialUntouched();
    nav.appendChild(button('Tutorial', {
      iconName: 'info',
      hint: tutorialMenuHint(),
      variant: fresh ? 'primary' : 'default',
      onClick: () => { void this.shell.startTutorial(); },
    }));

    nav.appendChild(button('Skirmish', {
      iconName: 'swords',
      hint: 'vs AI',
      variant: fresh ? 'default' : 'primary',
      onClick: () => this.shell.openSetup(),
    }));

    // Directly under Skirmish, because the missions board is where a player
    // finds out that a Prism Tank exists and what it costs them to get one.
    // Buried under Options it would be a screen most players never open, and
    // the whole progression layer would then be an invisible restriction
    // instead of a visible reward.
    nav.appendChild(button('Missions', {
      iconName: 'trophy',
      hint: missionsHint(),
      onClick: () => this.shell.openMissions('menu'),
    }));

    const saves = saveSlots().length;
    nav.appendChild(button('Load Game', {
      iconName: 'folder',
      hint: loadHint(saves),
      disabled: saves === 0,
      onClick: () => this.shell.openLoadGame(),
    }));

    nav.appendChild(button('Options', {
      iconName: 'sliders',
      onClick: () => this.shell.openSettings('menu'),
    }));

    nav.appendChild(button('Credits', {
      iconName: 'info',
      onClick: () => this.shell.openCredits(),
    }));

    nav.appendChild(button('Quit', {
      iconName: 'power',
      variant: 'danger',
      onClick: () => this.quit(),
    }));

    inner.appendChild(nav);
    host.appendChild(inner);

    /* -- footer chips ----------------------------------------------------- */
    const foot = el('div', 'vm-menu-foot');

    const left = el('div', 'vm-load-meta');
    const factions = el('div', 'vm-chip');
    factions.appendChild(icon('flag', 14));
    factions.appendChild(el('span', undefined, `${playableFactions().length} Factions`));
    left.appendChild(factions);

    const maps = el('div', 'vm-chip');
    maps.appendChild(icon('map', 14));
    maps.appendChild(el('span', undefined, `${MAPS.length} Battlefields`));
    left.appendChild(maps);

    foot.appendChild(left);
    foot.appendChild(el('span', undefined, 'Build 1.0 · WebGL2'));
    host.appendChild(foot);
  }

  unmount(): void {
    this.host?.classList.remove('vm-menu');
    this.host = null;
  }

  onBack(): boolean {
    // Nothing above the title screen. Swallow it so Escape never dead-ends in
    // a state where the shell would try to "go back" out of the product.
    return true;
  }

  /**
   * A browser tab cannot reliably be closed by script unless the script opened
   * it. Try, and if we are still here a moment later, say so instead of
   * pretending the button did nothing.
   */
  private quit(): void {
    const host = this.host;
    if (host === null) return;
    window.close();
    window.setTimeout(() => {
      if (this.host !== host) return;
      const notice = el('div', 'vm-chip');
      notice.style.cssText = 'position:absolute;left:50%;bottom:64px;transform:translateX(-50%);pointer-events:auto;';
      notice.appendChild(icon('info', 14));
      notice.appendChild(el('span', undefined, 'Close the browser tab to quit'));
      host.appendChild(notice);
      window.setTimeout(() => notice.remove(), 4000);
    }, 250);
  }
}

/* ==========================================================================
 * CREDITS
 * ========================================================================== */

interface CreditGroup {
  readonly title: string;
  readonly lines: readonly string[];
}

const CREDITS: readonly CreditGroup[] = [
  {
    title: 'Engine',
    lines: [
      'Fixed-timestep simulation at 30 Hz',
      'Deterministic seeded RNG, replayable from a seed',
      'Structure-of-arrays entity store, 4096 slots',
      'Flow-field pathing with budgeted expansion',
      'Instanced render bridge under 130 draw calls',
    ],
  },
  {
    title: 'Art',
    lines: [
      'Every mesh generated procedurally from code',
      'Every texture baked at boot in a worker',
      'Every sound synthesised at boot with WebAudio',
      'No downloaded assets, anywhere in the product',
    ],
  },
  {
    title: 'Built With',
    lines: [
      'three.js r185',
      'TypeScript 5 · Vite 7 · Vitest',
      'WebGL2 · WebAudio · Gamepad API',
    ],
  },
  {
    title: 'Inspired By',
    lines: [
      'The golden age of base-building real-time strategy',
      'Readable silhouettes, honest feedback, no hidden math',
    ],
  },
];

export class CreditsScreen implements Screen {
  readonly id = 'credits';
  private host: HTMLElement | null = null;

  constructor(private readonly shell: Shell) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page');

    const frame = pageFrame('Credits', () => this.shell.showMenu());
    const wrap = el('div', 'vm-credits');

    for (const group of CREDITS) {
      const g = el('div', 'vm-credits-group');
      g.appendChild(el('h3', 'vm-h3', group.title));
      const list = el('ul', 'vm-credits-list');
      for (const line of group.lines) list.appendChild(el('li', undefined, line));
      g.appendChild(list);
      wrap.appendChild(g);
    }

    frame.body.appendChild(wrap);
    frame.foot.appendChild(el('div', 'vm-spacer'));
    frame.foot.appendChild(button('Back', {
      variant: 'primary',
      onClick: () => this.shell.showMenu(),
    }));

    host.appendChild(frame.root);
  }

  unmount(): void {
    this.host?.classList.remove('vm-page');
    this.host = null;
  }

  onBack(): boolean {
    this.shell.showMenu();
    return true;
  }
}

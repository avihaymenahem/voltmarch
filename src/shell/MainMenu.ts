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
 * "LOAD" IS DISABLED, NOT FAKE
 * ----------------------------
 * There is no save system in this build. The entry is present, disabled, and
 * says why. A button that opens an empty list is worse than a button that
 * tells the truth.
 * ============================================================================
 */

import { MAPS } from './settings-store';
import {
  button,
  el,
  icon,
  pageFrame,
  playableFactions,
  type Screen,
  type Shell,
} from './Shell';

/* ==========================================================================
 * MAIN MENU
 * ========================================================================== */

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

    nav.appendChild(button('Skirmish', {
      iconName: 'swords',
      hint: 'vs AI',
      onClick: () => this.shell.openSetup(),
    }));

    nav.appendChild(button('Load Game', {
      iconName: 'folder',
      hint: 'No saves',
      disabled: true,
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

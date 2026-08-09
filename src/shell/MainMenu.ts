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

/** Injected by vite's `define` from package.json. See `vite.config.ts`. */
declare const __APP_VERSION__: string;

import { MAPS } from './settings-store';
import { saveSlots } from './LoadGame';
import {
  button,
  el,
  icon,
  pageFrame,
  playableFactions,
  setButtonEnabled,
  type Screen,
  type Shell,
} from './Shell';
import { readProgression } from './progression-link';
import { probeRelay, relayKnownReachable, unavailableReason } from './net-link';
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

/**
 * The Multiplayer hint, for each of the four states it can be in.
 *
 * `reason` non-empty means the build has no usable relay ADDRESS — nothing a
 * probe could change. Otherwise `known` is the probe's verdict: null while it
 * is still in flight, then true or false.
 */
function hintFor(reason: string, known: boolean | null): string {
  if (reason !== '') return reason;
  if (known === null) return 'checking…';
  return known ? '1v1 online' : 'match server is not answering';
}

export class MainMenuScreen implements Screen {
  readonly id = 'menu';
  private host: HTMLElement | null = null;
  /** The Multiplayer entry, so an in-flight probe can find it — or not. */
  private mpButton: HTMLButtonElement | null = null;

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

    // Directly under Skirmish, because the two are the same verb pointed at a
    // different opponent.
    //
    // OFFERED ONLY WHEN THE RELAY ANSWERS. A configured URL is not a running
    // server, and an entry that leads to a lobby spinning on "Connecting…" is
    // worse than no entry — so this starts disabled, asks the relay, and enables
    // itself only on a real `welcome`.
    //
    // DISABLED RATHER THAN HIDDEN, because a missing menu entry is
    // indistinguishable from a feature that does not exist. The hint carries the
    // reason: no server configured, wrong scheme, or simply not answering.
    nav.appendChild(this.multiplayerButton());

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
    // DERIVED, not written. This read "Build 1.0" while the product shipped
    // 1.4.0 — the same rot as the credits line above it, on the same screen.
    // `__APP_VERSION__` comes from package.json through vite's `define`
    // (see `vite.config.ts`), so there is one version number and the footer
    // cannot fall behind it again. `typeof` is the one operator safe on an
    // undeclared identifier, for a bare vitest run where the define never ran.
    const build = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
    foot.appendChild(el('span', undefined, `Build ${build} · WebGL2`));
    host.appendChild(foot);
  }

  unmount(): void {
    this.host?.classList.remove('vm-menu');
    this.host = null;
    // The probe outlives the screen; its callback must not touch a dead button.
    this.mpButton = null;
  }

  onBack(): boolean {
    // Nothing above the title screen. Swallow it so Escape never dead-ends in
    // a state where the shell would try to "go back" out of the product.
    return true;
  }

  /**
   * The Multiplayer entry, which enables itself only once the relay answers.
   *
   * Built disabled and updated in place, because the menu is assembled
   * synchronously and the probe is a round trip. Rebuilding the nav when it
   * resolves would move every button under the cursor a second after the menu
   * appeared; writing into this one does not move anything.
   *
   * A CACHED VERDICT SKIPS THE "CHECKING" STATE ENTIRELY. Coming back to the
   * menu from a match should not flash a disabled button for a second — see
   * `relayKnownReachable`.
   */
  private multiplayerButton(): HTMLButtonElement {
    const reason = unavailableReason();
    const known = reason === '' ? relayKnownReachable() : false;

    const b = button('Multiplayer', {
      iconName: 'swords',
      hint: hintFor(reason, known),
      disabled: known !== true,
      onClick: () => this.shell.openMultiplayer(),
    });
    this.mpButton = b;
    if (reason !== '' || known !== null) return b;

    void probeRelay().then((ok) => {
      // The screen may be gone by now — the player is faster than the network.
      if (this.mpButton !== b) return;
      // `setButtonEnabled`, not `b.disabled = ...`: re-enabling by hand leaves
      // the button at `tabIndex = -1`, reachable by mouse and invisible to the
      // keyboard.
      setButtonEnabled(b, ok);
      // `.vm-btn-hint` is the only mutable part; rebuilding the button would
      // drop focus and the focus ring's record of it.
      const hint = b.querySelector('.vm-btn-hint');
      if (hint !== null) hint.textContent = hintFor('', ok);
    });
    return b;
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

export interface CreditGroup {
  readonly title: string;
  readonly lines: readonly string[];
}

/**
 * Exported so `tests/credits-truthful.spec.ts` can check the asset claim against
 * what is actually on disk.
 *
 * A credits screen is a set of assertions about the product, and one of them —
 * "No downloaded assets, anywhere in the product" — quietly stopped being true
 * the day the UI typeface was self-hosted. Nothing caught it, because nothing
 * was checking. It is checked now.
 */
export const CREDITS: readonly CreditGroup[] = [
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
    /*
     * THE LAST LINE HERE USED TO READ "No downloaded assets, anywhere in the
     * product", AND IT STOPPED BEING TRUE on 2026-08-05 when the UI text face
     * was self-hosted. It is corrected rather than deleted: a credits screen
     * that overstates is worse than one that states an exception, and the
     * exception is the interesting part. `README.md` and `CLAUDE.md` both carry
     * the same caveat — if a second downloaded asset is ever added, all three
     * change in the same commit.
     */
    title: 'Art',
    lines: [
      'Every mesh generated procedurally from code',
      'Every texture baked at boot in a worker',
      'Ambience and the adaptive music score synthesised at boot',
      'No downloaded models or world textures',
    ],
  },
  {
    /*
     * THE THINGS THAT ARE NOT GENERATED. All shipped deliberately, and the
     * first two were once contradicted by a credits line claiming there were
     * none. Keep this group in step with `README.md`, `CLAUDE.md` and
     * `public/audio/README.md`; `tests/credits-truthful.spec.ts` checks it
     * against what is actually in `public/`.
     *
     * 61 recorded takes across 20 families now cover the interface, the
     * impacts, and every conventional weapon and explosion. The synthesised
     * bank measured in band and still read as a synth patch; recordings carry
     * micro-detail no oscillator recipe reproduces.
     *
     * The Art group above no longer says "weapons synthesised", because they
     * are not. What IS still generated is listed there instead — and Tesla,
     * Prism and several impacts are on that list BY MEASUREMENT, having been
     * tried with recordings that scored worse. See `public/audio/README.md`.
     */
    title: 'Shipped Assets',
    lines: [
      'Rajdhani — the UI typeface, SIL Open Font License 1.1',
      'The wordmark and app icons, from a supplied logo',
      'Interface, impact and unit voices by Kenney (kenney.nl) — CC0',
      'Weapons, explosions and effects — CC0 sound libraries',
      'Warfork by Team Forbidden — CC0',
      'EVA rendered with Piper, LibriVox voice — public domain',
      'Nothing else: no meshes, no world textures',
    ],
  },
  {
    /*
     * THE ONE ATTRIBUTION OBLIGATION IN THE PRODUCT.
     *
     * Everything else shipped here is CC0 or public domain and is credited as a
     * courtesy. These three are CC-BY 4.0, where the credit is a LICENCE TERM —
     * omit it and the licence does not grant the use. The wording is what
     * incompetech's own attribution generator emits, including the `http` URL,
     * which is theirs and not a typo.
     *
     * The licensor waives the modification notice ("no need to mention if you
     * cut and splice"), but CC-BY 4.0 3(a)(1)(B) asks for one in the general
     * case and a courtesy is not a licence amendment, so the trim is stated.
     */
    title: 'Music — Kevin MacLeod (incompetech.com)',
    lines: [
      '"Colossus" · "Industrial Revolution" · "Clash Defiant"',
      'Licensed under Creative Commons: By Attribution 4.0 License',
      'http://creativecommons.org/licenses/by/4.0/',
      'Trimmed and looped for adaptive playback',
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

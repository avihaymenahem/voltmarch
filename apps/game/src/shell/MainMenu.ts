/**
 * ============================================================================
 * src/shell/MainMenu.ts — the title screen and the credits
 * ============================================================================
 * The opening menu is a left-hand column over the supplied title key art.
 * It never boots a decorative battlefield and has no internal-page header or
 * icon rail. Play choices and secondary actions belong to this screen.
 *
 * The only two visual jobs this file has are (a) guaranteeing the title reads
 * against the key art, which is the job of the
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
import { CAMPAIGN_OPERATION_COUNT, CAMPAIGN_OPERATION_IDS } from './CampaignPresentation';
import {
  button,
  el,
  focusable,
  icon,
  pageFrame,
  playableFactions,
  setButtonEnabled,
  type Screen,
  type Shell,
} from './Shell';
import { readProgression } from './progression-link';
import { probeRelay, relayKnownReachable, unavailableReason } from './net-link';
import { tutorialCompleted, tutorialMenuHint, tutorialUntouched } from './Tutorial';
import { requestedBackend, type LiveBackend } from '../render/backend';
import { audio } from '../audio/AudioEngine';
import { MusicControl } from './MusicControl';
import { desktopBridge } from '../platform/desktop';
import { normalizeCommanderName } from '../net/protocol';

export const DISCORD_SUPPORT_URL = 'https://discord.gg/pvJGJyafU3';

/** Open a trusted community destination without giving it a handle to the game. */
function openCommunityLink(url: string): void {
  const a = el('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
}

/* ==========================================================================
 * MAIN MENU
 * ========================================================================== */

/** Return-player campaign progress, without pulling the authored table into the title chunk. */
export function campaignHint(
  profile?: { readonly campaign?: Readonly<Record<string, number>> } | null,
): string {
  let source = profile;
  if (source === undefined) {
    try { source = readProgression()?.profile() ?? null; } catch { source = null; }
  }
  if (source == null) return `${CAMPAIGN_OPERATION_COUNT} operations`;
  const rows = source.campaign ?? {};
  const done = CAMPAIGN_OPERATION_IDS.reduce(
    (count, id) => count + (typeof rows[id] === 'number' && rows[id] > 0 ? 1 : 0),
    0,
  );
  return `${done} / ${CAMPAIGN_OPERATION_COUNT} complete`;
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
  return known ? 'duel + co-op online' : 'match server is not answering';
}

/**
 * The title menu does not start a battlefield, so there is no live
 * renderer to inspect on first paint. In that state the requested backend
 * is the truthful answer; once a renderer exists its live backend wins.
 */
export function menuBackendLabel(live: LiveBackend | undefined, search: string): string {
  const backend = live ?? requestedBackend(search);
  return backend === 'webgpu'
    ? 'WebGPU'
    : backend === 'webgl2-fallback' ? 'WebGPU → WebGL2' : 'WebGL2';
}

export class MainMenuScreen implements Screen {
  readonly id = 'menu';
  private host: HTMLElement | null = null;
  /** The Multiplayer entry, so an in-flight probe can find it — or not. */
  private mpButton: HTMLButtonElement | null = null;
  private musicControl: MusicControl | null = null;

  constructor(private readonly shell: Shell) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-menu');
    // Initial audio boot already chooses this cue; subsequent mounts restore it
    // after a match or a manual selection made in the pause menu.
    audio()?.playMenuMusic();

    const inner = el('div', 'vm-menu-inner');

    /* -- compact utility bar --------------------------------------------- */
    // Keep identity and infrequent routes available without making them
    // compete with the play choices.  The title screen should read as a
    // battlefield first and a menu second, not as a dashboard of equal boxes.
    const top = el('header', 'vm-cinematic-topbar');
    const identity = focusable(el('button', 'vm-cinematic-identity'));
    identity.type = 'button';
    identity.setAttribute('aria-label', 'Open Service Record');
    identity.addEventListener('click', () => this.shell.openProfile());
    identity.appendChild(icon('trophy', 20));
    const identityCopy = el('span', 'vm-cinematic-identity-copy');
    identityCopy.appendChild(el('span', 'vm-cinematic-overline', 'SERVICE RECORD'));
    const commanderName = normalizeCommanderName(this.shell.settings.get().gameplay.commanderName)
      ?? 'Commander';
    identityCopy.appendChild(el('strong', 'vm-cinematic-callsign', commanderName.toLocaleUpperCase()));
    identity.appendChild(identityCopy);
    top.appendChild(identity);

    const topActions = el('nav', 'vm-cinematic-top-actions');
    topActions.setAttribute('aria-label', 'System menu');
    const topAction = (control: HTMLButtonElement): HTMLButtonElement => {
      control.classList.add('vm-cinematic-top-action');
      return control;
    };
    topActions.appendChild(topAction(button('Settings', {
      iconName: 'sliders',
      onClick: () => this.shell.openSettings('menu'),
    })));
    const desktop = desktopBridge();
    if (desktop !== null) {
      topActions.appendChild(topAction(button('Quit', {
        iconName: 'power',
        variant: 'danger',
        onClick: () => this.shell.openQuitConfirmation(),
      })));
    }
    host.appendChild(top);

    /* -- brand ------------------------------------------------------------ */
    const brand = el('div', 'vm-menu-brand vm-cinematic-brand');
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
    brand.appendChild(el('p', 'vm-subtitle', 'Forge Armies. Command the Front.'));
    inner.appendChild(brand);

    /* -- play field ------------------------------------------------------- */
    const play = el('main', 'vm-cinematic-play');
    const playHeading = el('div', 'vm-cinematic-heading');
    playHeading.appendChild(el('h2', 'vm-cinematic-title', 'Choose your front'));
    play.appendChild(playHeading);

    const nav = el('nav', 'vm-menu-nav vm-cinematic-modes');
    nav.setAttribute('aria-label', 'Main menu');

    const operationButton = (
      control: HTMLButtonElement,
      kind: 'feature' | 'standard' | 'online',
    ): HTMLButtonElement => {
      control.classList.add('vm-cinematic-mode', `is-${kind}`);
      control.appendChild(icon('chevronRight', 18));
      return control;
    };

    // FIRST, and accented until it has been opened once.
    //
    // A tutorial buried under Skirmish is a tutorial nobody finds, and the
    // whole point of the item is the player who has never played an RTS. Once
    // they have been through it the accent moves back to Skirmish, so a
    // returning player is not shouted at by a screen they have finished with.
    const fresh = tutorialUntouched();
    if (!tutorialCompleted()) {
      nav.appendChild(operationButton(button('Tutorial', {
        iconName: 'info',
        hint: tutorialMenuHint(),
        variant: fresh ? 'primary' : 'default',
        onClick: () => this.shell.openTutorialConfirmation(),
      }), fresh ? 'feature' : 'standard'));
    }

    // ABOVE SKIRMISH, DELIBERATELY. The campaign is the authored content and
    // the skirmish is the sandbox; a title screen whose first playable row is
    // the sandbox tells a new player which one the game is about, and it would
    // be telling them the wrong thing.
    nav.appendChild(operationButton(button('Campaign', {
      iconName: 'flag',
      hint: campaignHint(),
      onClick: () => this.shell.openCampaign(),
    }), tutorialCompleted() ? 'feature' : 'standard'));

    nav.appendChild(operationButton(button('Skirmish', {
      iconName: 'swords',
      hint: 'Custom battle against AI',
      variant: fresh ? 'default' : 'primary',
      onClick: () => this.shell.openSetup(),
    }), !fresh && !tutorialCompleted() ? 'feature' : 'standard'));

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
    const multiplayer = operationButton(this.multiplayerButton(), 'online');
    nav.appendChild(multiplayer);
    play.appendChild(nav);

    const secondary = el('div', 'vm-cinematic-secondary');
    const saves = saveSlots().length;
    topActions.insertBefore(topAction(button('Load Game', {
      iconName: 'folder',
      hint: loadHint(saves),
      disabled: saves === 0,
      onClick: () => this.shell.openLoadGame(),
    })), topActions.firstChild);

    // NEVER DISABLED, unlike Load Game, and the difference is real rather than
    // an inconsistency: the load screen can only offer what is in this
    // browser's storage, while this one can always open a file somebody sent.
    // The hint says whether there is also a match from this session to watch.
    topActions.appendChild(topAction(button('Replays', {
      iconName: 'monitor',
      hint: this.shell.latestReplay() === null ? 'Open a recording' : 'Last match ready',
      onClick: () => this.shell.openReplays(),
    })));
    secondary.appendChild(topActions);
    play.appendChild(secondary);
    inner.appendChild(play);
    host.appendChild(inner);

    /* -- community corner ------------------------------------------------ */
    // These live on the battlefield side of the composition rather than in
    // the command spine: support and announcements are always available, but
    // neither competes with the choice of what to play.
    const community = el('nav', 'vm-menu-corner-actions');
    community.setAttribute('aria-label', 'Community and announcements');
    community.appendChild(button('Support', {
      iconName: 'info',
      onClick: () => openCommunityLink(DISCORD_SUPPORT_URL),
    }));
    community.appendChild(button('News & Events', {
      iconName: 'refresh',
      onClick: () => this.shell.openSettings('menu', 'updates'),
    }));
    top.appendChild(community);

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
    // Read the renderer handle, not the query flag. The footer was hardcoded
    // to WebGL2 and therefore lied in the desktop WebGPU build even after the
    // backend assertion proved WebGPU was live.
    // Partial shell fakes used by menu-only tests legitimately have no live
    // game. Treat that exactly like a shell still waiting for its background
    // scene rather than making the footer a new mount requirement.
    const backend = (this.shell as Partial<Shell>).getGame?.()?.ctx.handle.backend;
    const search = typeof location === 'undefined' ? '' : location.search;
    const backendLabel = menuBackendLabel(backend, search);
    left.appendChild(el('span', 'vm-menu-build', `Build ${build} · ${backendLabel}`));
    this.musicControl = new MusicControl('menu');
    foot.appendChild(this.musicControl.root);
    host.appendChild(foot);
  }

  unmount(): void {
    this.musicControl?.dispose();
    this.musicControl = null;
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

}

/* ==========================================================================
 * CREDITS
 * ========================================================================== */

export interface CreditGroup {
  readonly title: string;
  readonly summary: string;
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
    summary: 'Deterministic strategy technology built for large, readable battles.',
    lines: [
      'Fixed-timestep simulation at 30 Hz',
      'Deterministic seeded RNG, replayable from a seed',
      'Structure-of-arrays entity store, 4096 slots',
      'Flow-field pathing with budgeted expansion',
      'Instanced render bridge, geometry batched by material',
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
    summary: 'A hybrid procedural and authored pipeline tuned for RTS-scale silhouettes.',
    lines: [
      'Procedural unit and structure roster with runtime fallbacks',
      'Selected faction structures and resource vehicles generated with Meshy and optimized locally',
      'Procedural world textures plus budgeted imported-asset PBR maps',
      'Ambience synthesised at boot',
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
     * 697 Ogg files ship: effects, faction/unit barks, EVA lines, and four
     * original music tracks. Counted off the disk, not remembered — this comment said "61
     * takes across 20 families" for three releases after the bank tripled.
     * The synthesised bank measured in band and still read as a synth patch;
     * recordings carry micro-detail no oscillator recipe reproduces.
     *
     * The Art group above no longer says "weapons synthesised", because they
     * are not — and as of this commit it no longer says the MUSIC is either.
     * `TrackMusic` is the default score and `ApplicationAudio.ts` constructs it
     * before the battlefield: one streamed original cue, randomly selected per match
     * and looped, with the procedural `MusicDirector` kept only as its fallback.
     * Ambience is the only thing in the default soundscape still synthesised. See
     * `public/audio/README.md`.
     */
    title: 'Shipped Assets',
    summary: 'Attribution and provenance for the third-party and commissioned work in the build.',
    lines: [
      'Rajdhani — the UI typeface, SIL Open Font License 1.1',
      'The wordmark and app icons, from a supplied logo',
      'The loading screen key art, a supplied illustration',
      'Campaign command portraits — original AI-assisted artwork',
      'Skirmish map preview terrain — original ImageGen-authored artwork with live tactical overlays',
      'Command Deck HUD chrome — original ImageGen-authored component plates with live interface content',
      'Universal terrain detail mask — original project-owner-supplied grayscale artwork',
      'Faction structures, selected units and vehicle wreckage — original Meshy AI models for VOLTMARCH',
      'Interface, impact and unit voices by Kenney (kenney.nl) — CC0',
      'Original faction unit voice packs generated with ElevenLabs',
      'Weapons, explosions and effects — CC0 sound libraries',
      'Warfork by Team Forbidden — CC0',
      'EVA rendered with Piper, LibriVox voice — public domain',
      'Original VOLTMARCH soundtrack — user-supplied masters',
      'World textures otherwise remain procedural or belong to conditioned model PBR sets',
    ],
  },
  {
    title: 'Original Soundtrack',
    summary: 'Four original tracks prepared as level-matched, seamless battlefield loops.',
    lines: [
      '"Silent Horizon" · "Disciplined Ostinato" · "Echoes of the Siege" · "Endless Warfront"',
      'Created for VOLTMARCH from user-supplied Suno Pro masters',
      '© 2026 Avihay Menahem · All rights reserved',
      'Prepared as level-matched seamless loops for streamed playback',
    ],
  },
  {
    title: 'Built With',
    summary: 'The open web technology underneath the simulation and interface.',
    lines: [
      'three.js r185',
      'TypeScript 5 · Vite 7 · Vitest',
      'WebGL2 · WebAudio · Gamepad API',
    ],
  },
  {
    title: 'Inspired By',
    summary: 'The design values that guide every command, silhouette and feedback loop.',
    lines: [
      'The golden age of base-building real-time strategy',
      'Readable silhouettes, honest feedback, no hidden math',
    ],
  },
];

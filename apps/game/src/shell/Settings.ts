/**
 * ============================================================================
 * src/shell/Settings.ts — the options screen AND the only place settings are
 * turned into engine state
 * ============================================================================
 * Two halves, deliberately in one file:
 *
 *   `applySettings()` — the translation layer. Player-facing values in, live
 *   engine calls out: `configureRender` for anything in RENDER_CONFIG,
 *   `RendererHandle` for the things it owns exclusively, `PostChain` for the
 *   pass toggles, and the AudioEngine's bus strips for the mixer. It takes the
 *   list of changed paths so dragging a volume slider does not re-push the
 *   entire graphics config sixty times a second.
 *
 *   `SettingsScreen` — eight grouped categories over that translation. Every control writes
 *   through `SettingsStore.patch()`, which normalises, persists and notifies;
 *   the shell's subscription then calls `applySettings` with the diff. There is
 *   no "Apply" button and no pending state, because there is no way for the UI
 *   and the engine to be out of step: the store is the single source of truth
 *   and the screen only ever reads it back.
 *
 * WHAT IS NOT WIRED, AND WHY IT IS STILL HERE
 * -------------------------------------------
 * `tooltips`, `damageNumbers` and `screenShake` have no consumer
 * in the engine yet — the HUD and VFX modules that will read them are being
 * written in parallel. They are persisted and published on
 * `window.__vmSettings` (see Shell) precisely so those modules can subscribe
 * without this file having to import them. They are NOT fake: the value is
 * real, stored and observable; only the reader is missing.
 *
 * `subtitles` and `tips` are deliberately NOT on that list. Voice captions are
 * consumed by `Hud.voiceSubtitle`; tips arrived WITH their consumer —
 * `src/sim/tips.system.ts`, in the same commit — because four dead rows is a
 * pattern and five is a habit. If a later row joins this section without a
 * reader, add it above, not below.
 * ============================================================================
 */

import {
  RENDER_CONFIG,
  applyQualityTier,
  configureRender,
  coreQualityTierOf,
  detectQualityTier,
  isPanelBlurActive,
  panelBlurUrlOverride,
  setPanelBlurMode,
  type RenderQualityTier,
} from '../render/renderer';
import { adaptiveLiveScale, setAdaptiveResolution } from '../render/adaptive-res.system';
import { CREDITS } from './MainMenu';
import { targetMsForCap } from '../render/HardwareCalibration';
import { audio, configureAudioMixer } from '../audio/AudioEngine';
import { CAMERA_NAV } from '../core/config';
import { diagnosticSnapshot } from '../core/diagnostic-log';
import type { GameHandle } from '../game/Bootstrap';
import type { QualityTier } from '../core/types';

import {
  ACTIONS,
  ACTION_CATEGORIES,
  buildHotkeyConflicts,
  type ActionDef,
} from '../input/ActionCatalogue';

import {
  chordLabel,
  conflictingIds,
  defaultSettings,
  FPS_CAPS,
  isBindableCode,
  touched,
  type Chord,
  type PanelBlurChoice,
  type PointerDeviceChoice,
  type TrackpadScrollChoice,
  type UnitResponseChoice,
  type Settings,
  type ShadowChoice,
} from './settings-store';

import { HelpPanel } from './Help';
import { ManualView } from './Manual';
import {
  activeAdapterLabel,
  BRIDGE_VERSION,
  desktopBridge,
  type DesktopDisplayPatch,
  type DesktopDisplayState,
  type DesktopUpdateState,
} from '../platform/desktop';

import {
  buildDiagnostics,
  formatDiagnostics,
  redactBootFlags,
  viabilityLines,
  type DiagnosticsMatch,
  type DiagnosticsRenderer,
} from './Diagnostics';
import { mapById } from './settings-store';
import { plannedScenario } from '../game/Scenarios';
import { buildVersion } from '../game/replay.system';
import { production } from '../sim/Production';
import {
  setSessionUnlockAll,
  unlockAllActive,
  unlockAllFromBootFlag,
} from './unlockall.system';
import { readProgression } from '../ui/Objectives';
import { restoreTutorialMenuItem, tutorialCompleted, tutorialMenuHint } from './Tutorial';
import {
  OFFLINE_COMMAND_FEED,
  commandFeedDate,
  loadCommandFeed,
  type CommandFeed,
} from './CommandFeed';

import {
  button,
  chooser,
  el,
  focusable,
  icon,
  pageFrame,
  row as shellRow,
  setAdjust,
  slider,
  toggle,
  type Screen,
  type Shell,
  type ShellState,
} from './Shell';

/* ==========================================================================
 * 1. APPLY
 * ========================================================================== */

const SHADOW_MAP_SIZE: Record<ShadowChoice, number> = {
  low: 1024,
  medium: 1536,
  high: 2048,
  ultra: 4096,
};

/** Apply interface-only accessibility preferences to every current UI root. */
export function applyAccessibilitySettings(settings: Settings): void {
  const p = settings.gameplay;
  const html = document.documentElement;
  html.style.setProperty('--vm-text-scale', String(p.textScale));
  html.classList.toggle('vm-high-contrast', p.highContrast);
  html.classList.toggle('vm-reduced-motion', p.reducedMotion);
  for (const root of document.querySelectorAll<HTMLElement>('.vm-shell, .vm-hud')) {
    root.classList.toggle('vm-high-contrast', p.highContrast);
    root.classList.toggle('vm-reduced-motion', p.reducedMotion);
  }
}

/**
 * Push settings into the running engine.
 *
 * `changed` is the dotted-path list from `SettingsStore.patch`. Omit it to
 * apply everything, which is what a fresh boot does.
 */
export function applySettings(
  settings: Settings,
  game: GameHandle | null,
  changed?: readonly string[],
): void {
  const all = changed === undefined;
  const want = (prefix: string): boolean => all || touched(changed, prefix);

  if (want('gameplay.textScale') || want('gameplay.highContrast') || want('gameplay.reducedMotion')) {
    applyAccessibilitySettings(settings);
  }

  /* -- graphics ---------------------------------------------------------- */

  if (want('graphics.tier')) {
    const tier: RenderQualityTier =
      settings.graphics.tier === 'auto' ? detectQualityTier() : settings.graphics.tier;
    applyQualityTier(tier);
    if (game !== null) game.ctx.loop.quality = coreQualityTierOf(tier) as QualityTier;
    // A tier preset overwrites resolution scale and the pass toggles, so the
    // player's explicit choices are re-asserted on top of it below.
  }

  if (game !== null && (all || touched(changed, 'graphics.tier') || touched(changed, 'graphics.resolutionScale'))) {
    game.ctx.handle.setResolutionScale(settings.graphics.resolutionScale);
    // The adaptive controller watches the handle and treats any scale it did
    // not itself command as a deliberate choice, re-arming its ceiling. That is
    // what makes this slider stick above the tier default — before it, setting
    // 150% was reverted within seconds and permanently re-clamped.
  }

  if (all || touched(changed, 'graphics.adaptiveResolution')) {
    setAdaptiveResolution(settings.graphics.adaptiveResolution);
  }

  if (want('graphics.shadows')) {
    // Stage this before renderer creation as well as applying it live. Otherwise
    // a shadows-off player compiles every shadow pipeline during boot and only
    // disables the pass after the loading curtain has already paid for it.
    configureRender({ renderer: { shadows: { enabled: settings.graphics.shadows } } });
    if (game !== null) game.ctx.handle.setShadowsEnabled(settings.graphics.shadows);
  }

  if (want('graphics.shadowQuality')) {
    configureRender({
      renderer: { shadows: { mapSize: SHADOW_MAP_SIZE[settings.graphics.shadowQuality] } },
    });
  }

  if (all || touched(changed, 'graphics.tier') || touched(changed, 'graphics.ao') ||
      touched(changed, 'graphics.bloom') || touched(changed, 'graphics.smaa') ||
      touched(changed, 'graphics.msaa') ||
      touched(changed, 'graphics.filmGrain')) {
    const g = settings.graphics;
    configureRender({
      post: {
        ao: { enabled: g.ao },
        bloom: { enabled: g.bloom },
        smaa: { enabled: g.smaa },
        // Takes effect without a restart. A sample count cannot be changed on a
        // live target: the legacy chain allocates/frees its one scene target,
        // while the WebGPU chain rebuilds its graph because `PassNode` bakes
        // `samples` into that graph. `postGraphSignature` MUST carry this value;
        // omitting it once left the toggle on while the live target stayed 0x.
        msaaSamples: g.msaa ? 4 : 0,
        // The former film-grain arm is now vignette-only. Full-frame grain
        // aliases into horizontal rows on high-DPI canvases, so both arms keep
        // it at zero. Saved settings therefore cannot reintroduce the defect.
        grade: g.filmGrain
          ? { grain: 0, vignette: 0.28, chromaticAberration: 0 }
          : { grain: 0, vignette: 0.12, chromaticAberration: 0 },
      },
    });
  }

  if (want('graphics.postFx')) {
    // The node post graph is constructed during bootstrap. Persist the desired
    // state first so the cold path never builds defaults and then recompiles a
    // different graph during Shell's hidden settle frames.
    configureRender({ post: { enabled: settings.graphics.postFx } });
    if (game !== null) game.ctx.post.setEnabled(settings.graphics.postFx);
  }

  // Deliberately NOT guarded on `game !== null`: the gate is a class on
  // `<html>` and has to be right on the title screen, where no renderer exists.
  // `?blur=` wins when present — it is the only way to A/B the macOS artefact on
  // the affected machine, and a persisted choice must not silently disarm it.
  if (want('graphics.panelBlur') && panelBlurUrlOverride() === null) {
    setPanelBlurMode(settings.graphics.panelBlur);
  }

  if (want('graphics.fov') || want('graphics.minZoom') || want('graphics.maxZoom')) {
    configureRender({
      camera: {
        fov: settings.graphics.fov,
        gameplayMinDistance: settings.graphics.minZoom,
        maxDistance: settings.graphics.maxZoom,
      },
    });
  }

  /* -- audio -------------------------------------------------------------- */

  if (want('audio')) {
    // This also stages the mix before the first AudioEngine exists. The audio
    // system applies it as it publishes its facade, before menu music begins.
    configureAudioMixer(settings.audio);
    const liveAudio = audio();
    liveAudio?.setAnnouncerEnabled(settings.audio.announcer);
    liveAudio?.setBarkMode(
      settings.audio.unitResponses === 'selection' ? 'reduced' : settings.audio.unitResponses,
    );
  }

  /* -- gameplay ----------------------------------------------------------- */

  if (want('gameplay')) {
    const p = settings.gameplay;
    configureRender({
      camera: {
        // The rig reads `edgePanPixels <= 0` as "edge scrolling off", so the
        // toggle and the speed are one config write, not two code paths.
        edgePanPixels: p.edgeScroll ? EDGE_SCROLL_BAND_PX : 0,
        edgePanSpeed: p.edgeScrollSpeed,
        panSpeed: p.panSpeed,
        zoomToCursor: p.zoomToCursor,
      },
    });

    // The navigation scheme is NOT in RENDER_CONFIG: `RENDER_CONFIG.camera` is
    // where the camera is and how it damps, and this is how a human asks it to
    // move. It lives on the rig, which is the thing that reads it.
    if (game !== null) {
      game.ctx.cameraRig.setNavigation({
        pointerDevice: p.pointerDevice,
        trackpadScroll: p.trackpadScroll,
        // One "pan sensitivity" slider drives every pan surface, because a
        // player who finds the trackpad too fast finds the drag too fast too.
        trackpadPanSensitivity: p.panSensitivity,
        dragPanSensitivity: p.panSensitivity,
        wheelZoomSensitivity: p.zoomSensitivity,
        // Two constants, one slider, same shape as the pinch row below it.
        // `trackpadZoomSensitivity` is DERIVED rather than measured — nobody
        // here has a Mac — so the slider has to reach it: a player can correct
        // a 3x error at 0.25-3x without waiting for a build.
        trackpadZoomSensitivity: CAMERA_NAV.trackpadZoomSensitivity * p.zoomSensitivity,
        pinchZoomSensitivity: CAMERA_NAV.pinchZoomSensitivity * p.zoomSensitivity,
        invertPanX: p.invertPanX,
        invertPanY: p.invertPanY,
        invertZoom: p.invertZoom,
        invertDragPan: !p.dragPanNatural,
        momentum: p.cameraMomentum,
      });
    }
  }
}

/**
 * Edge-scroll hot zone in CSS pixels, applied only when the player has turned
 * edge scrolling back on. `CAMERA.edgePanPixels` in core/config is 0 — the
 * shipping default is off — so this is the value the toggle restores.
 */
const EDGE_SCROLL_BAND_PX = 10;

/** Read the engine's current pipeline tier back, for the "auto" readout. */
export function activeTierName(): string {
  return RENDER_CONFIG.quality.toUpperCase();
}

/**
 * Help text for the Panel Blur row, reporting the EFFECTIVE state.
 *
 * The mode is not the answer: `Auto` reads as "on" to a player, and on a Mac it
 * resolves to off. A chooser that says `Auto` next to visibly unblurred panels
 * looks broken, so the row says which way it landed and why.
 */
export function panelBlurHint(mode: PanelBlurChoice): string {
  const base =
    'Frosted glass behind HUD and menu panels. Auto turns it off on Mac, where ' +
    'it can flash black over the battlefield. Off is safe everywhere.';
  const url = panelBlurUrlOverride();
  if (url !== null) return `${base} Overridden by ?blur=${url} on this URL.`;
  if (mode !== 'auto') return base;
  return isPanelBlurActive()
    ? `${base} On for this display.`
    : `${base} Off on this display.`;
}

/** Keep ordinary one-line guidance visible; fold explanations that dominate a settings row. */
export const SETTINGS_NOTE_COLLAPSE_CHARS = 96;

export function shouldCollapseSettingsNote(note: string): boolean {
  return note.trim().length > SETTINGS_NOTE_COLLAPSE_CHARS;
}

let settingsNoteId = 0;

/** Settings-only row wrapper: long guidance is available on demand instead of always expanded. */
function row(label: string, control: HTMLElement, note?: string): HTMLDivElement {
  const result = shellRow(label, control, note);
  if (note === undefined || !shouldCollapseSettingsNote(note)) return result;

  const labelNode = result.querySelector<HTMLElement>('.vm-row-label');
  const noteNode = result.querySelector<HTMLElement>('.vm-row-note');
  if (labelNode === null || noteNode === null) return result;

  const id = `vm-settings-note-${++settingsNoteId}`;
  noteNode.id = id;
  noteNode.hidden = true;

  const details = el('button', 'vm-row-details', 'Details');
  details.type = 'button';
  details.setAttribute('aria-controls', id);
  details.setAttribute('aria-expanded', 'false');
  details.setAttribute('aria-label', `Show details for ${label}`);
  focusable(details);
  details.addEventListener('click', () => {
    const expanded = details.getAttribute('aria-expanded') === 'true';
    details.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    details.setAttribute('aria-label', `${expanded ? 'Show' : 'Hide'} details for ${label}`);
    noteNode.hidden = expanded;
    result.classList.toggle('is-details-open', !expanded);
  });
  labelNode.appendChild(details);
  result.classList.add('has-collapsible-note');
  return result;
}

/* ==========================================================================
 * 2. SCREEN
 * ========================================================================== */

/*
 * THE MANUAL IS A TAB, NOT A SECOND OVERLAY.
 *
 * `HelpPanel` — the "All Commands" button in the footer — already exists and is
 * untouched by this. It is a KEYBIND REFERENCE: it resolves every action in
 * `ActionCatalogue.ts` against the live store and marks the rows a player has
 * rebound. That is a live view of this machine's configuration, and folding
 * 345 KiB of prose into it would bury the one screen that answers "which key did
 * I put Attack Move on".
 *
 * The manual is the other thing: seventeen static pages about the GAME rather
 * than about this installation of it. A tab is also what was asked for — "a
 * dedicated help section in settings" — and it inherits the whole options
 * screen for free: reachable from the title menu and from a paused match, one
 * Escape from either.
 *
 * `folder` is the icon because the icon set has no book and this file may not
 * grow one — `ICON_PATHS` lives in `Shell.ts`. An unknown name silently falls
 * back to `info`, which the footer button already uses, so naming a real one
 * is the difference between two distinct glyphs and two identical ones.
 */
/*
 * THE SIXTH TAB SHIPS TO EVERYBODY, AND IT IS NOT CALLED "DEVELOPER".
 *
 * Asked for as a "Developer tab … to allow exporting game state", after a match
 * that would not end. Two decisions were made about it deliberately and both
 * are the author's:
 *
 *   IT IS ALWAYS VISIBLE. No boot flag, no hidden gesture, no gate. The bugs
 *   this exists for are hit while PLAYING — most often on the packaged desktop
 *   build, where there is no address bar to add a flag to and no source to edit
 *   — so a tool that needs a rebuild to reach is a tool nobody has at the
 *   moment they need it. The cost of that decision is that a non-technical
 *   player will open it by accident, which is why the copy on this tab reads as
 *   a status page rather than a console: it says what is happening, it names
 *   what the export does and does not contain, and nothing on it can change the
 *   match.
 *
 *   IT IS CALLED "DIAGNOSTICS", because that describes what is on the screen
 *   rather than who it is for, and "Developer" tells a player the tab is not
 *   for them — which stopped being true the moment it shipped to them.
 *
 * THE NAME COLLIDED WITH A SECTION INSIDE GRAPHICS, and the collision was
 * resolved by MOVING that section's single row (Performance Overlay) here
 * rather than by renaming anything. Every "tell me what is happening" control
 * now lives in one place, and Graphics loses a section that existed to hold one
 * toggle. The setting itself does NOT move: it is still `graphics.perfOverlay`,
 * so there is no migration and no persisted-shape change — and it is on
 * `settings-store.ts#CALIBRATION_EXEMPT`, so relocating its row cannot retire
 * anybody's one-time hardware calibration.
 *
 * `gauge` is the icon: a readout, which is what the tab is. `ICON_PATHS` lives
 * in `Shell.ts` and an unknown name silently degrades to `info`, so naming a
 * real one is the difference between six distinct glyphs and five.
 */
export type TabId = 'graphics' | 'audio' | 'gameplay' | 'controls' | 'updates'
  | 'manual' | 'credits' | 'diagnostics';
type TabGroup = 'configure' | 'reference';

interface SettingsTab {
  readonly id: TabId;
  readonly label: string;
  readonly hint: string;
  readonly icon: string;
  readonly group: TabGroup;
}

const TAB_GROUP_LABEL: Readonly<Record<TabGroup, string>> = {
  configure: 'Configuration',
  reference: 'Reference & Support',
};

const TABS: readonly SettingsTab[] = [
  { id: 'graphics', label: 'Graphics', hint: 'Display & quality', icon: 'monitor', group: 'configure' },
  { id: 'audio', label: 'Audio', hint: 'Mixer & playback', icon: 'volume', group: 'configure' },
  { id: 'gameplay', label: 'Gameplay', hint: 'Interface & profile', icon: 'target', group: 'configure' },
  { id: 'controls', label: 'Controls', hint: 'Camera & bindings', icon: 'keyboard', group: 'configure' },
  { id: 'updates', label: 'Updates', hint: 'Version & releases', icon: 'refresh', group: 'reference' },
  { id: 'diagnostics', label: 'Diagnostics', hint: 'Live system report', icon: 'gauge', group: 'reference' },
  { id: 'manual', label: 'Manual', hint: 'Field reference', icon: 'folder', group: 'reference' },
  { id: 'credits', label: 'Credits', hint: 'Licences & attribution', icon: 'info', group: 'reference' },
];

/* -- diagnostics helpers ---------------------------------------------------- *
 * Module scope rather than methods: none of them touch the screen, and keeping
 * them out of the class is what makes it obvious at a glance that the tab reads
 * and never writes.
 * -------------------------------------------------------------------------- */

/**
 * How much of the export the preview shows.
 *
 * The full document can run to hundreds of kilobytes with the entity list on,
 * and putting all of it into a live `<textarea>` costs a layout the options
 * screen does not need to pay. The preview says what it cut and how much is
 * really there, so it can never read as the whole thing.
 */
const DIAG_PREVIEW_CHARS = 8000;

const GITHUB_RELEASES_URL = 'https://github.com/avihaymenahem/voltmarch/releases';
const GITHUB_LATEST_RELEASE_URL = `${GITHUB_RELEASES_URL}/latest`;

/**
 * Open a trusted project URL without allowing it to retain a handle to the game.
 * Electron denies the new window and hands HTTPS links to the system browser;
 * browsers follow the same anchor normally.
 */
function openProjectLink(url: string): void {
  const a = el('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
}

/**
 * The seed the terrain was actually generated from, or 0.
 *
 * DUCK-TYPED, exactly as `game/replay.system.ts#terrainSeed` is and for the
 * reason written there: `src/core/**` is frozen infrastructure and a report's
 * need for an identity number is not a reason to widen `ITerrain`, which every
 * null object and every test double would then have to satisfy. 0 means "this
 * terrain does not carry one", and the caller falls back to the battlefield's
 * pinned seed rather than printing a zero as if it were the answer.
 */
function terrainSeedOf(world: { terrain: unknown }): number {
  const t = world.terrain as Partial<{ seed: number }>;
  return typeof t.seed === 'number' ? t.seed : 0;
}

/** A paragraph of explanation above a group of rows. */
function diagNote(text: string): HTMLElement {
  return el('p', 'vm-diag-note', text);
}

/** A read-only value for the right-hand column of a `row()`. */
function diagValue(text: string): HTMLElement {
  return el('div', 'vm-diag-value', text);
}

/** `2026-08-18-1432`. Local time, because it is a filename for a human. */
function diagStamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export class SettingsScreen implements Screen {
  readonly id = 'settings';

  private tab: TabId;
  private body: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  /**
   * Desktop window state, or null on the web and until the first fetch lands.
   *
   * `renderGraphics` is synchronous and the bridge is not, so the section is
   * simply absent for the one frame before the promise resolves, and the
   * resolve re-renders the tab. That is preferable to a placeholder row: the
   * fetch is a single IPC round trip on a local socket, so the gap is
   * invisible, whereas a "Loading…" row that failed to resolve would be a
   * permanent piece of furniture.
   */
  private desktop: DesktopDisplayState | null = null;
  /**
   * The primary monitor's refresh rate, or null in a browser / before it lands.
   *
   * PRIMARY, NOT THE ONE THE WINDOW IS ON. `vm:display-frequency` answers
   * `screen.getPrimaryDisplay().displayFrequency`, so a player whose game is on
   * a second monitor is told about the first one. It is used only to ANNOTATE
   * the frame-rate row — never to change a setting — so the failure mode is a
   * note that reads oddly on a mismatched multi-monitor rig rather than a
   * picture solved for the wrong panel. Fixing it properly means putting `hz`
   * on each `DesktopDisplayInfo`, which is a bridge-version bump.
   */
  private displayHz: number | null = null;
  /**
   * The adapter the GPU process ACTUALLY got, or null in a browser.
   *
   * READ BACK, NEVER INFERRED FROM THE SWITCH. `--force_high_performance_gpu`
   * is a HINT: `desktop/src/main.ts` records that its effect site is conjoined
   * with `&& system_device_id_high_perf`, and `RENDER_FINDINGS.md` §7g measured
   * Windows ignoring the same request from a browser outright. So the only
   * honest way to answer "did it work" is to ask which adapter is active.
   *
   * Nor is the WebGL renderer string a substitute — it names whichever chip
   * WebGL got, which on a hybrid laptop is not necessarily the one Chromium's
   * GPU process is on. `app.getGPUInfo('complete')` is the process's own view.
   */
  private gpuActive: string | null = null;
  /** Latest updater state retained by the Electron main process. */
  private desktopUpdate: DesktopUpdateState | null = null;
  private updateUnsubscribe: (() => void) | null = null;
  /** The options frame itself, hidden while the help overlay is up. */
  private frameRoot: HTMLElement | null = null;
  private help: HelpPanel | null = null;
  /** The wiki reader, alive only while its tab is the one showing. */
  private manual: ManualView | null = null;
  /**
   * The manual page the reader was last on.
   *
   * `renderTab` tears the tab's DOM down and builds it again, so without this
   * a trip to Audio and back would dump somebody out of Strategy.md and onto
   * the front page. It is per-screen rather than persisted: reopening Options
   * in a later session starting at the top of the manual is the right default.
   */
  private manualPage: string | null = null;
  /** Restore Defaults, kept so the Manual tab can hide it. */
  private resetButton: HTMLButtonElement | null = null;
  /** Command reference belongs to Controls, not every settings category. */
  private helpButton: HTMLButtonElement | null = null;
  /** Keybind id currently waiting for a chord, or null. */
  private listening: string | null = null;
  private listeningButton: HTMLButtonElement | null = null;

  /* -- diagnostics ------------------------------------------------------- */

  /**
   * Whether the export carries the per-entity list.
   *
   * PER-SCREEN, NOT PERSISTED. It is a property of one export rather than a
   * preference — the summary is the tier you paste into a message and the full
   * list is the tier you attach to a file — and persisting it would silently
   * make somebody's next casual export a megabyte long.
   */
  private diagFull = false;
  /** The exact text the Copy and Save buttons will hand over. */
  private diagText = '';
  /** The one-line result of the last Copy or Save, or ''. */
  private diagStatus: HTMLElement | null = null;
  /** Profile file picker, rebuilt with the Gameplay tab. */
  private profileFileInput: HTMLInputElement | null = null;
  /** Status for profile import/export/reset. */
  private profileStatus: HTMLElement | null = null;
  private profileResetTimer = 0;
  private profileResetArmed = false;
  private profileResetButton: HTMLButtonElement | null = null;
  /** Bundled immediately, replaced by the website feed only after validation. */
  private commandFeed: CommandFeed = OFFLINE_COMMAND_FEED;
  private commandFeedState: 'idle' | 'loading' | 'live' | 'offline' = 'idle';

  constructor(
    private readonly shell: Shell,
    private readonly returnTo: ShellState,
    initialTab: TabId = 'graphics',
  ) {
    this.tab = initialTab;
  }

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page');
    if (this.returnTo !== 'menu') host.classList.add('is-modal');

    const frame = pageFrame('Settings', () => this.leave());
    frame.root.classList.add('vm-settings-panel');
    frame.body.id = 'vm-settings-body';

    const tabs = el('nav', 'vm-tabs vm-settings-nav');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Settings categories');
    let group: TabGroup | null = null;
    for (const t of TABS) {
      if (t.group !== group) {
        group = t.group;
        tabs.appendChild(el('span', 'vm-settings-nav-group', TAB_GROUP_LABEL[group]));
      }
      const b = el('button', 'vm-tab');
      b.type = 'button';
      b.id = `vm-settings-tab-${t.id}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', frame.body.id);
      b.setAttribute('aria-selected', t.id === this.tab ? 'true' : 'false');
      b.appendChild(icon(t.icon, 16));
      const copy = el('span', 'vm-settings-tab-copy');
      copy.appendChild(el('span', 'vm-settings-tab-label', t.label));
      copy.appendChild(el('span', 'vm-settings-tab-hint', t.hint));
      b.appendChild(copy);
      focusable(b);
      b.addEventListener('click', () => this.selectTab(t.id, tabs));
      tabs.appendChild(b);
    }
    frame.body.setAttribute('aria-labelledby', `vm-settings-tab-${this.tab}`);
    // Desktop uses this as a grouped left rail. Narrow windows restyle the same
    // semantic tablist as a horizontal strip, without rebuilding the screen.
    frame.root.insertBefore(tabs, frame.body);

    this.body = frame.body;
    if (this.tab === 'updates') this.ensureCommandFeed();
    this.renderTab();
    this.refreshDesktop();
    const desktop = desktopBridge();
    if (desktop !== null) {
      this.updateUnsubscribe = desktop.onUpdateState((state) => {
        const previous = this.desktopUpdate;
        this.desktopUpdate = state;
        // Download progress can arrive many times per second. Five-percent
        // display buckets keep Updates responsive without rebuilding the
        // complete page for every network packet.
        const progressBucket = Math.floor((state.progress ?? 0) / 5);
        const previousBucket = Math.floor((previous?.progress ?? 0) / 5);
        if (this.tab === 'updates'
          && (previous?.status !== state.status || progressBucket !== previousBucket)) {
          this.renderTab();
        }
      });
      void desktop.updateState().then((state) => {
        this.desktopUpdate = state;
        if (this.tab === 'updates') this.renderTab();
      }).catch(() => { /* The Check Now button is the visible retry path. */ });
    }

    const reset = button('Restore Defaults', {
      iconName: 'restore',
      onClick: () => {
        // The Manual tab stores nothing, so there is nothing to restore and its
        // button is hidden. The guard is here anyway because `button()` attaches
        // its handler unconditionally — see the block in `Shell.ts#button`.
        const tab = this.tab;
        if (tab === 'manual' || tab === 'credits' || tab === 'updates') return;
        /*
         * DIAGNOSTICS OWNS EXACTLY ONE PERSISTED ROW — `graphics.perfOverlay`.
         * `reset()` takes a SECTION, and the section this tab's row lives in is
         * Graphics, so passing the tab id through would either be a type error
         * or (worse, if it were coerced) would wipe every picture setting the
         * player has from a tab they came to in order to read a number.
         */
        if (tab === 'diagnostics') {
          this.shell.settings.patch({
            graphics: { perfOverlay: defaultSettings().graphics.perfOverlay },
          });
          // Restore Defaults is the obvious place a
          // player looks for the way out of Unlock Everything, and leaving the
          // one control that changes what the game DOES untouched by the button
          // labelled "put it back" would be the wrong surprise. A no-op when
          // `?unlockall` is on the URL, which the row already says. The stored
          // preference is removed by the same call.
          setSessionUnlockAll(false);
          this.diagFull = false;
          this.renderTab();
          return;
        }
        this.shell.settings.reset(tab === 'controls' ? 'controls' : tab);
        // The Controls tab shows two different stores: the keybinds, which live
        // in `controls`, and the camera scheme, which lives in `gameplay`
        // because that is the section the engine already applies. Restoring
        // only half of a visible page is the kind of thing that reads as a bug.
        if (tab === 'controls') {
          const d = defaultSettings().gameplay;
          this.shell.settings.patch({
            gameplay: {
              edgeScroll: d.edgeScroll,
              edgeScrollSpeed: d.edgeScrollSpeed,
              panSpeed: d.panSpeed,
              zoomToCursor: d.zoomToCursor,
              pointerDevice: d.pointerDevice,
              panSensitivity: d.panSensitivity,
              zoomSensitivity: d.zoomSensitivity,
              invertPanX: d.invertPanX,
              invertPanY: d.invertPanY,
              invertZoom: d.invertZoom,
              dragPanNatural: d.dragPanNatural,
              cameraMomentum: d.cameraMomentum,
            },
          });
        }
        this.renderTab();
      },
    });
    this.resetButton = reset;
    this.syncFoot();
    frame.foot.appendChild(reset);
    const help = button('All Commands', {
      iconName: 'info',
      onClick: () => this.openHelp(),
    });
    this.helpButton = help;
    frame.foot.appendChild(help);
    this.syncFoot();
    frame.foot.appendChild(el('div', 'vm-spacer'));
    frame.foot.appendChild(button('Done', { variant: 'primary', onClick: () => this.leave() }));

    this.frameRoot = frame.root;
    host.appendChild(frame.root);
  }

  unmount(): void {
    this.updateUnsubscribe?.();
    this.updateUnsubscribe = null;
    this.closeHelp();
    this.manual?.dispose();
    this.manual = null;
    this.resetButton = null;
    this.frameRoot = null;
    this.diagStatus = null;
    this.diagText = '';
    this.host?.classList.remove('vm-page', 'is-modal');
    this.host = null;
    this.body = null;
    this.listening = null;
  }

  onBack(): boolean {
    if (this.help !== null) {
      this.closeHelp();
      return true;
    }
    if (this.listening !== null) {
      this.stopListening();
      return true;
    }
    this.leave();
    return true;
  }

  /** While rebinding, the screen owns the whole keyboard. */
  onKeyDown(e: KeyboardEvent): boolean {
    if (this.help !== null) return this.help.onKeyDown(e);
    // Page Up / Page Down / Home / End scroll the manual, the same four keys
    // and the same reason as `HelpPanel`: the shell's ring owns Up and Down, and
    // a 45 kB page needs a way down that is not forty arrow presses. Escape is
    // deliberately NOT claimed — `onBack` still leaves the options screen.
    if (this.manual !== null && this.manual.onKeyDown(e)) return true;
    if (this.listening === null) return false;
    if (e.code === 'Escape') {
      this.stopListening();
      return true;
    }
    if (e.code === 'Backspace' || e.code === 'Delete') {
      this.commitBinding(this.listening, { code: '', ctrl: false, shift: false, alt: false });
      return true;
    }
    if (!isBindableCode(e.code)) return true;
    this.commitBinding(this.listening, {
      code: e.code,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
    });
    return true;
  }

  /* -------------------------------------------------------------------- */

  private leave(): void {
    this.disarmProfileReset();
    // Returning to a paused match re-opens the pause menu over the same frozen
    // frame; returning to the title screen must NOT re-boot the backdrop that
    // is already rendering behind us.
    if (this.returnTo === 'paused') this.shell.pause();
    else this.shell.showMenu();
  }

  private selectTab(id: TabId, tabs: HTMLElement): void {
    this.tab = id;
    const buttons = tabs.querySelectorAll<HTMLElement>('.vm-tab');
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-selected', TABS[i].id === id ? 'true' : 'false');
    }
    this.body?.setAttribute('aria-labelledby', `vm-settings-tab-${id}`);
    if (this.body !== null) this.body.scrollTop = 0;
    if (id === 'updates') this.ensureCommandFeed();
    this.renderTab();
  }

  private renderTab(): void {
    const body = this.body;
    if (body === null) return;
    // A reset confirmation belongs to the DOM that owns its armed button. If
    // the player changes tabs, cancel it before that button is detached.
    this.disarmProfileReset();
    // The manual holds a load promise and a subtree; leaving the tab drops both
    // rather than leaving a detached view listening for a chunk to arrive.
    this.manual?.dispose();
    this.manual = null;
    // The status line belongs to the DOM that is about to be discarded; a
    // pending clipboard promise resolving into a detached node would write into
    // nothing and look like the copy having silently failed.
    this.diagStatus = null;
    this.profileFileInput = null;
    this.profileStatus = null;
    this.profileResetButton = null;
    body.replaceChildren();
    // The manual is its own two-pane scroller sized to the frame, so the frame
    // must not also scroll. Every other tab is a plain flow and does.
    body.classList.toggle('is-manual', this.tab === 'manual');
    this.syncFoot();
    switch (this.tab) {
      case 'graphics': this.renderGraphics(body); break;
      case 'audio': this.renderAudio(body); break;
      case 'gameplay': this.renderGameplay(body); break;
      case 'controls': this.renderControls(body); break;
      case 'updates': this.renderUpdates(body); break;
      case 'manual': this.renderManual(body); break;
      case 'credits': this.renderCredits(body); break;
      case 'diagnostics': this.renderDiagnostics(body); break;
      default: break;
    }
    this.layoutSections(body);
    // Rebuilding a tab used to cut instantly from one dense control matrix to
    // another. Restart a transform/opacity-only content beat after the new DOM
    // is complete; reduced-motion suppresses it in CSS and Shell.show skips
    // the route animation entirely under the same preference.
    body.classList.remove('is-tab-entering');
    void body.offsetWidth;
    body.classList.add('is-tab-entering');
  }

  /**
   * Two real vertical stacks, not CSS multi-column flow. Multi-column may
   * fragment one tall control section halfway through a row, which is fatal to
   * a settings form. Moving whole sections keeps every instrument well intact
   * while letting the shorter stack continue independently.
   */
  private layoutSections(body: HTMLElement): void {
    if (this.tab === 'manual' || this.tab === 'credits') return;
    const sections = Array.from(body.children)
      .filter((node) => (node as HTMLElement).classList.contains('vm-section')) as HTMLElement[];
    if (sections.length < 2) return;

    const columns = el('div', 'vm-settings-columns');
    const left = el('div', 'vm-settings-column is-left');
    const right = el('div', 'vm-settings-column is-right');
    columns.appendChild(left);
    columns.appendChild(right);
    body.insertBefore(columns, sections[0]);
    sections.forEach((section, index) => (index % 2 === 0 ? left : right).appendChild(section));
  }

  /** Footer buttons that are not offered on every tab. */
  private syncFoot(): void {
    // Reference-only tabs store nothing, so none has anything to restore.
    if (this.resetButton !== null) {
      this.resetButton.hidden = this.tab === 'manual'
        || this.tab === 'credits'
        || this.tab === 'updates';
    }
    if (this.helpButton !== null) this.helpButton.hidden = this.tab !== 'controls';
  }

  /* -- manual -------------------------------------------------------------- *
   * The whole wiki, from `wiki/*.md`, behind one dynamic import. `Manual.ts`
   * and `manual-corpus.ts` carry the argument for the split; the short version
   * is that 345 KiB of prose must not sit in the chunk every player downloads.
   * ------------------------------------------------------------------------ */

  /**
   * The credits, as a tab rather than a top-level screen.
   *
   * MOVED OFF THE MAIN MENU BECAUSE THE MENU GREW. It was ten entries; Campaign
   * and Replays both landed there this month, and Credits is the one nobody
   * opens twice. The data remains the same truthful `CREDITS` table, presented
   * here as a production ledger so authorship and provenance are scannable.
   *
   * `CREDITS` STAYS IN `MainMenu.ts` DELIBERATELY. It is the data, not the
   * screen, and `tests/credits-truthful.spec.ts` imports it from there to check
   * every line against what is actually in `public/`. Moving the table to chase
   * the view would have made that spec's import a lie about where the credits
   * live, for no gain — this file already imports plenty from its siblings.
   */
  private renderCredits(body: HTMLElement): void {
    const wrap = el('div', 'vm-credits');
    const intro = el('header', 'vm-credits-intro');
    const introCopy = el('div', 'vm-credits-intro-copy');
    introCopy.appendChild(el('span', 'vm-credits-kicker', 'VOLTMARCH // PRODUCTION LEDGER'));
    introCopy.appendChild(el('h3', 'vm-credits-title', 'Built by systems, shaped by people.'));
    introCopy.appendChild(el(
      'p',
      'vm-credits-lede',
      'Technology, original work and licensed sources are separated below so every contribution is clear.',
    ));
    intro.appendChild(introCopy);
    const tally = el('div', 'vm-credits-tally');
    tally.appendChild(el('strong', 'vm-num', String(CREDITS.length).padStart(2, '0')));
    tally.appendChild(el('span', undefined, 'credit groups'));
    intro.appendChild(tally);
    wrap.appendChild(intro);

    const grid = el('div', 'vm-credits-grid');
    CREDITS.forEach((group, index) => {
      const g = el('article', 'vm-credits-group');
      const head = el('header', 'vm-credits-group-head');
      head.appendChild(el('span', 'vm-credits-index vm-num', String(index + 1).padStart(2, '0')));
      const heading = el('div');
      heading.appendChild(el('h3', 'vm-h3', group.title));
      heading.appendChild(el('p', 'vm-credits-summary', group.summary));
      head.appendChild(heading);
      g.appendChild(head);
      const list = el('ul', 'vm-credits-list');
      for (const line of group.lines) list.appendChild(el('li', undefined, line));
      g.appendChild(list);
      grid.appendChild(g);
    });
    wrap.appendChild(grid);
    body.appendChild(wrap);
  }

  private renderManual(body: HTMLElement): void {
    const view = new ManualView({
      startPage: this.manualPage,
      onPage: (slug) => { this.manualPage = slug; },
    });
    this.manual = view;
    body.appendChild(view.root);
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const s = el('div', 'vm-section');
    s.appendChild(el('h3', 'vm-h3', title));
    parent.appendChild(s);
    return s;
  }

  /* -- updates ------------------------------------------------------------- *
   * Release management used to be buried at the top of Diagnostics. That made
   * a normal player wade into a developer report to answer the ordinary
   * question "am I current?". This tab is deliberately read-only: installer
   * actions go through Electron's updater bridge, while browser builds link to
   * the same public GitHub release history.
   * ------------------------------------------------------------------------ */

  private renderUpdates(body: HTMLElement): void {
    const transmission = this.section(body, 'News & Events');
    const status = this.commandFeedState === 'live'
      ? 'Live command feed'
      : this.commandFeedState === 'loading'
        ? 'Checking live command feed…'
        : 'Offline bulletin';
    transmission.appendChild(el('p', 'vm-command-feed-status', status));

    for (const item of this.commandFeed.items) {
      const card = el('article', `vm-command-feed-item is-${item.kind}`);
      const head = el('header', 'vm-command-feed-head');
      head.appendChild(el('span', 'vm-command-feed-kind', item.kind));
      head.appendChild(el('time', 'vm-command-feed-date', commandFeedDate(item.date)));
      card.appendChild(head);
      card.appendChild(el('h4', 'vm-command-feed-title', item.title));
      card.appendChild(el('p', 'vm-command-feed-summary', item.summary));
      if (item.url !== undefined && item.actionLabel !== undefined) {
        card.appendChild(button(item.actionLabel, {
          iconName: 'chevronRight',
          onClick: () => openProjectLink(item.url ?? ''),
        }));
      }
      transmission.appendChild(card);
    }

    if (!this.commandFeed.items.some((item) => item.kind === 'event')) {
      const quiet = el('div', 'vm-command-feed-empty');
      quiet.appendChild(icon('clock', 18));
      const copy = el('span');
      copy.appendChild(el('strong', undefined, 'No active field event'));
      copy.appendChild(el('small', undefined, 'Playtests and limited-time operations will appear here.'));
      quiet.appendChild(copy);
      transmission.appendChild(quiet);
    }

    const updateBridge = desktopBridge();
    const state = this.desktopUpdate;
    const release = this.section(body, 'Release Channel');

    if (updateBridge === null) {
      release.appendChild(row('Current Version', diagValue(buildVersion())));
      release.appendChild(row('Edition', diagValue('Web browser')));
      release.appendChild(row('Status', diagValue('Updates arrive with each deployment')));
      release.appendChild(diagNote(
        'The browser edition does not install local packages. Reload the game to use the newest '
        + 'deployed build, or open GitHub below to review downloadable desktop releases.',
      ));
    } else if (state === null) {
      release.appendChild(row('Current Version', diagValue(buildVersion())));
      release.appendChild(row('Status', diagValue('Reading release channel…')));
      release.appendChild(diagNote(
        'VOLTMARCH is contacting the desktop update service. You can leave this tab while it checks.',
      ));
    } else {
      const mode = state.mode === 'installed'
        ? 'Installed desktop'
        : state.mode === 'portable'
          ? 'Portable desktop'
          : 'Development build';
      release.appendChild(row('Current Version', diagValue(state.currentVersion)));
      if (state.availableVersion !== null && state.availableVersion.length > 0) {
        release.appendChild(row('Available Version', diagValue(state.availableVersion)));
      }
      release.appendChild(row('Edition', diagValue(mode)));
      release.appendChild(row('Status', diagValue(
        state.status === 'downloading'
          ? `${state.message} ${Math.round(state.progress ?? 0)}%`
          : state.message,
      )));

      if (state.mode === 'portable') {
        release.appendChild(diagNote(
          'Portable Windows builds cannot safely replace themselves while running. VOLTMARCH '
          + 'still detects releases and opens the exact download page for manual replacement.',
        ));
      } else if (state.mode === 'installed') {
        release.appendChild(diagNote(
          'Checks run shortly after launch and every four hours. Updates never interrupt a battle: '
          + 'download and restart happen only when you request them.',
        ));
      } else {
        release.appendChild(diagNote(
          'Automatic release checks are disabled in development builds. Packaged installer and '
          + 'portable builds use the public GitHub release channel.',
        ));
      }

      const actions = el('div', 'vm-diag-actions vm-update-actions');
      actions.appendChild(button('Check Now', {
        iconName: 'refresh',
        disabled: state.mode === 'development'
          || state.status === 'checking'
          || state.status === 'downloading'
          || state.status === 'downloaded',
        onClick: () => {
          void updateBridge.checkForUpdates().then((next) => {
            this.desktopUpdate = next;
            this.renderTab();
          });
        },
      }));
      if (state.status === 'available') {
        actions.appendChild(button(
          state.canAutoInstall ? 'Download Update' : 'Open Download Page',
          {
            variant: 'primary',
            iconName: 'folder',
            onClick: () => {
              if (state.canAutoInstall) {
                void updateBridge.downloadUpdate().then((next) => {
                  this.desktopUpdate = next;
                  this.renderTab();
                });
              } else {
                void updateBridge.openUpdatePage();
              }
            },
          },
        ));
      }
      if (state.status === 'downloaded') {
        actions.appendChild(button('Restart & Update', {
          variant: 'primary',
          iconName: 'restore',
          onClick: () => updateBridge.installUpdate(),
        }));
      }
      release.appendChild(actions);

      if (state.releaseNotes.trim().length > 0) {
        const notes = this.section(body, 'What’s New');
        notes.appendChild(el('div', 'vm-update-notes', state.releaseNotes));
      }
    }

    const links = this.section(body, 'GitHub Releases');
    links.appendChild(diagNote(
      'Release notes, Windows installers, portable executables and previous versions live in the '
      + 'public VOLTMARCH release archive.',
    ));
    const linkActions = el('div', 'vm-diag-actions vm-update-actions');
    linkActions.appendChild(button('Latest Release', {
      iconName: 'folder',
      variant: 'primary',
      onClick: () => openProjectLink(GITHUB_LATEST_RELEASE_URL),
    }));
    linkActions.appendChild(button('All Releases', {
      iconName: 'folder',
      onClick: () => openProjectLink(GITHUB_RELEASES_URL),
    }));
    links.appendChild(linkActions);
  }

  /** Start one bounded request only when the Updates route is actually opened. */
  private ensureCommandFeed(): void {
    if (this.commandFeedState !== 'idle') return;
    this.commandFeedState = 'loading';
    void loadCommandFeed().then(({ feed, source }) => {
      this.commandFeed = feed;
      this.commandFeedState = source;
      if (this.body !== null && this.tab === 'updates') this.renderTab();
    });
  }

  /* -- diagnostics --------------------------------------------------------- *
   * The report itself is `src/shell/Diagnostics.ts`, which is DOM-free and
   * pure so that a test can build a real world and assert on the real output.
   * Everything here is the rendering of it, plus the two ways it leaves the
   * app.
   *
   * NOTHING ON THIS TAB WRITES TO THE MATCH. The readout is a read over the
   * entity store, the export is a read over the entity store, and the one
   * control that persists anything is the Performance Overlay toggle, which
   * writes a settings row. That has to stay true: this screen is reachable
   * over a LIVE PvP match, where a stray write would be a desync with no
   * findable cause.
   * ------------------------------------------------------------------------ */

  /**
   * Assemble the report for the CURRENT state of the app.
   *
   * Called on every render of the tab, so the preview and the buttons can
   * never disagree about what would be copied — the text is built once here
   * and both read `this.diagText`.
   */
  private diagnosticsText(): string {
    const game = this.shell.getGame();
    const settings = this.shell.settings.get();
    const g = settings.graphics;
    const bridge = desktopBridge();

    let renderer: DiagnosticsRenderer | null = null;
    if (game !== null) {
      const h = game.ctx.handle;
      // `frameInfo()`, NEVER `renderer.info`: under the node renderer
      // `info.render.calls` is a monotonic count of `render()` invocations
      // since page load and `info.programs` is undefined. This is the only
      // read that means the same thing on both backends.
      const info = h.frameInfo();
      const a = h.capabilities.adapter;
      renderer = {
        backend: h.backend,
        gpu: h.capabilities.gpu,
        // The adapter and the GPU string can disagree, and when they do the
        // disagreement is the finding — see `DiagnosticsRenderer.adapter`.
        adapter: a === null ? null : `${a.vendor} ${a.architecture} ${a.description}`.trim(),
        drawCalls: info.drawCalls,
        triangles: info.triangles,
      };
    }

    let match: DiagnosticsMatch | null = null;
    if (game !== null) {
      const world = game.ctx.world;
      const loop = game.ctx.loop;
      const setup = this.shell.getSetup();
      const choice = mapById(setup.map);
      // `plannedScenario()` is memoised from the URL the running match booted
      // with and `Shell.bootGame` resets it before every launch, so reading it
      // here reports what the ENGINE parsed rather than what the lobby meant.
      // Only ever called with a live game for that reason.
      const plan = plannedScenario();
      match = {
        world,
        kind: this.shell.isBackdrop() ? 'backdrop' : 'match',
        simTick: loop.tick,
        simSeconds: loop.simTime,
        paused: loop.paused,
        speed: loop.speed,
        // THE TERRAIN ROLL, read off the terrain itself. Duck-typed exactly as
        // `game/replay.system.ts#terrainSeed` does it and for the same reason:
        // `src/core/**` is frozen and a report's need for an identity number is
        // not a reason to widen `ITerrain` for every null object and test
        // double. A terrain with no seed falls back to the battlefield's pinned
        // one, which is what generated it on every ordinary boot.
        mapSeed: terrainSeedOf(world) || choice.mapSeed,
        // THE SCENARIO ROLL. A different number, and conflating the two is the
        // documented defect that made a v1 replay reproduce the hills only.
        simSeed: plan.seed,
        mapId: setup.map,
        mapName: choice.name,
        mapPreset: plan.map,
        biome: choice.biome,
        opening: plan.start,
        scenario: plan.name,
        defs: production()?.bindingTables ?? null,
      };
    }

    return formatDiagnostics(buildDiagnostics({
      env: {
        buildVersion: buildVersion(),
        generatedAt: new Date().toISOString(),
        shellState: this.shell.getState(),
        platform: bridge === null ? 'web' : 'desktop',
        bridgeVersion: bridge === null ? null : BRIDGE_VERSION,
        userAgent: navigator.userAgent,
        page: `${location.origin}${location.pathname}`,
        bootFlags: redactBootFlags(location.search),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio,
        },
        unlockAll: unlockAllActive(),
        renderer,
        graphics: {
          tier: g.tier === 'auto' ? `auto (${activeTierName().toLowerCase()})` : g.tier,
          resolutionScale: g.resolutionScale,
          adaptiveResolution: g.adaptiveResolution,
          calibrated: g.calibrated,
          shadows: g.shadows,
          ao: g.ao,
          bloom: g.bloom,
          msaa: g.msaa,
          perfOverlay: g.perfOverlay,
        },
      },
      match,
      includeEntities: this.diagFull,
      recentEvents: diagnosticSnapshot(200),
    }));
  }

  private renderDiagnostics(body: HTMLElement): void {
    const game = this.shell.getGame();
    this.diagText = this.diagnosticsText();

    /* -- what the game currently thinks ---------------------------------- */

    const live = this.section(body, 'Match State');
    if (game === null) {
      /*
       * THE EMPTY STATE IS THE ONE MOST PEOPLE WILL SEE, because the title
       * screen is where you go when you are not mid-crisis. It must not be a
       * blank panel: it says what is missing, what is still in the export, and
       * what to do to get the rest. A player who exports from here still gets a
       * complete build/GPU/settings report, which is exactly what a graphics or
       * boot complaint needs.
       */
      live.appendChild(diagNote(
        'No match is running, so there is nothing to survey. The export below still carries the '
        + 'build, the graphics settings and the GPU actually in use — which is what a rendering '
        + 'or start-up report needs. For anything about units, buildings or how a match ended, '
        + 'open this tab from inside the game (Escape -> Settings).',
      ));
      const next = this.shell.getSetup();
      const choice = mapById(next.map);
      live.appendChild(row('Next Match', diagValue(
        `${choice.name} · ${choice.biome} · ${next.opponents.length + 1} armies`,
      )));
      live.appendChild(row('Terrain Seed', diagValue(
        `${choice.mapSeed} — the map seed. The simulation seed is rolled at launch.`,
      )));
    } else {
      const world = game.ctx.world;
      live.appendChild(diagNote(
        'One line per player, from describeViability() — the same function the boot log prints '
        + 'and the export carries. "held" is units inside a building or a transport: alive and '
        + 'yours, but neither drawn nor targetable, so they do not count as an army. A match that '
        + 'will not end usually shows a player with contest 0 and held above 0.',
      ));
      const lines = el('pre', 'vm-diag-lines');
      lines.textContent = viabilityLines(world).join('\n');
      live.appendChild(lines);
      live.appendChild(row('Sim Tick', diagValue(
        `${game.ctx.loop.tick} (${game.ctx.loop.simTime.toFixed(1)} s${game.ctx.loop.paused ? ', paused' : ''})`,
      )));
    }

    /* -- the overlay, moved here from Graphics --------------------------- */

    const overlay = this.section(body, 'On-Screen Readouts');
    const gfx = this.shell.settings.get().graphics;
    overlay.appendChild(row(
      'Performance Overlay',
      toggle(gfx.perfOverlay, (v) => {
        this.shell.settings.patch({ graphics: { perfOverlay: v } });
      }),
      // The help text is the whole reason the row exists. A player who turns
      // this on because the game feels heavy is owed the one sentence that
      // stops them trusting a green 60: on a vsync-capped display the frame
      // time is the MONITOR's number, not the game's, and only a GPU timer
      // query tells the two apart. There is no `applySettings` branch for it —
      // `src/ui/perf.system.ts` subscribes to the store directly.
      'Top-left readout: frame time and its p95, the sim/render CPU split, draw '
      + 'calls against the 130 budget, and whether a 60 fps reading has real '
      + 'headroom or is only vsync capping a saturated GPU. It will say "headroom '
      + 'unknown" rather than guess when the browser withholds GPU timing.',
    ));

    /* -- progression ----------------------------------------------------- *
     * The one control on this tab that changes what the game DOES. It is here
     * rather than in Gameplay deliberately: it is not a difficulty preference,
     * it is a diagnostic — "show me the content that is gated" — and it belongs
     * next to the readouts for the same reason `?unlockall` belongs next to
     * `?seed=` rather than in the lobby.                                      */

    const prog = this.section(body, 'Progression');
    const bootFlag = unlockAllFromBootFlag();
    const unlockRow = row(
      'Unlock Everything',
      toggle(unlockAllActive(), (v) => {
        setSessionUnlockAll(v);
        this.renderTab();
      }),
      /*
       * THREE THINGS IN THE HELP TEXT, AND ALL THREE ARE LOAD-BEARING.
       *
       *   1. IT PERSISTS. The player explicitly asked for the setting to survive
       *      a desktop restart; the toggle is the visible authority for it.
       *   2. THE AI DOES NOT NEED IT. Progression gates the commander only;
       *      computer opponents retain their complete faction roster.
       *   3. NOTHING IS EARNED. The gate only changes what `isUnlocked`
       *      ANSWERS; it never writes the profile. That is what makes it safe
       *      to ship to everyone, and it is the sentence that stops it reading
       *      as a cheat menu.
       */
      bootFlag
        ? 'Forced on by the ?unlockall boot flag on this URL — the toggle cannot turn it off. '
          + 'Reload without the flag to get your real progression back.'
        : 'Turns off every progression gate and saves that preference for future launches. '
          + 'Nothing is earned or written into your progression profile. '
          + 'Computer opponents already retain their complete faction roster; this changes only '
          + 'what you can build and which campaign operations you can launch.',
    );
    prog.appendChild(unlockRow);
    if (bootFlag) {
      // The boot flag wins and the toggle cannot clear it, so the control is
      // shown in its true state and made inert rather than lying about which
      // way it can be moved.
      const control = unlockRow.querySelector<HTMLElement>('.vm-toggle');
      control?.setAttribute('aria-disabled', 'true');
    }

    /* -- the export ------------------------------------------------------ */

    const exp = this.section(body, 'Export');
    exp.appendChild(diagNote(
      'A plain-text snapshot of what the game believes right now: the build, the seeds, every '
      + 'player and what the match-outcome rule makes of them. Nothing in it identifies you — no '
      + 'profile, no saves, no file paths, and a multiplayer relay address is replaced with '
      + '"(set)". It is safe to paste into a bug report.',
    ));
    exp.appendChild(row(
      'Include Every Entity',
      toggle(this.diagFull, (v) => { this.diagFull = v; this.renderTab(); }),
      'Adds one line per living unit, building and prop: owner, type, position, health, order '
      + 'and its flags DECODED TO NAMES. Much larger, and the tier to attach as a file rather '
      + 'than paste. Leave it off unless the question is about one specific thing on the map.',
    ));

    const status = el('p', 'vm-diag-status');
    this.diagStatus = status;
    this.sayDiag(`${this.diagText.length.toLocaleString('en-US')} characters ready.`);

    const actions = el('div', 'vm-diag-actions');
    actions.appendChild(button('Copy To Clipboard', {
      variant: 'primary', iconName: 'check', onClick: () => this.copyDiagnostics(),
    }));
    actions.appendChild(button('Save To File', {
      iconName: 'folder', onClick: () => this.saveDiagnostics(),
    }));
    actions.appendChild(button('Refresh', {
      iconName: 'refresh', onClick: () => this.renderTab(),
    }));
    exp.appendChild(actions);
    exp.appendChild(status);

    /*
     * THE PREVIEW SHOWS THE SAME DOCUMENT THE BUTTONS COPY, truncated only for
     * the DOM's sake and only with the truncation stated. A preview that showed
     * a different tier from the one being copied would make the screen lie
     * about its own output, which in a diagnostic is the worst available bug.
     *
     * A `<textarea readonly>` and not a `<pre>`: it takes focus, so Ctrl+A then
     * Ctrl+C works by hand. That is the guaranteed route out on any platform
     * where the clipboard API is unavailable or refused.
     */
    const preview = el('textarea', 'vm-diag-preview');
    preview.readOnly = true;
    preview.spellcheck = false;
    preview.value = this.diagText.length > DIAG_PREVIEW_CHARS
      ? `${this.diagText.slice(0, DIAG_PREVIEW_CHARS)}\n\n… preview stops here. `
        + `Copy and Save carry all ${this.diagText.length.toLocaleString('en-US')} characters.`
      : this.diagText;
    /*
     * DELIBERATELY NOT `focusable()`, which is the one place this tab departs
     * from the house pattern. `Shell.onKeyDown` returns early for ArrowUp and
     * ArrowDown whenever the focused element is a TEXTAREA — correctly, so the
     * caret can move — and the focus ring moves on exactly those two keys. A
     * ring stop inside a textarea is therefore a stop a gamepad cannot leave.
     * The element is natively tabbable and clickable either way, so a keyboard
     * or mouse user loses nothing, and the ring-reachable route to the same
     * text is the Copy button directly above it.
     */
    exp.appendChild(preview);
  }

  private sayDiag(text: string, bad = false): void {
    const node = this.diagStatus;
    if (node === null) return;
    node.textContent = text;
    node.classList.toggle('is-bad', bad);
  }

  /**
   * The reliable route out.
   *
   * `navigator.clipboard` is `[SecureContext]`-gated, and the desktop shell
   * registers `app://` with `secure: true` precisely so gated APIs work there.
   * It can still be refused (an insecure origin, a permission policy), and the
   * failure branch does not leave the player stuck: the preview below is a
   * focusable textarea holding the same text.
   */
  private copyDiagnostics(): void {
    const text = this.diagText;
    const clip = (navigator as Partial<Navigator>).clipboard;
    if (clip === undefined) {
      this.sayDiag(
        'This browser will not open the clipboard from a page. Click into the text below, '
        + 'press Ctrl+A then Ctrl+C — or use Save To File.', true,
      );
      return;
    }
    void clip.writeText(text).then(
      () => this.sayDiag(`Copied ${text.length.toLocaleString('en-US')} characters.`),
      (err: unknown) => this.sayDiag(
        `Copy was refused (${String(err)}). Click into the text below, press Ctrl+A then Ctrl+C.`,
        true,
      ),
    );
  }

  /** The nicer route out, where it works. Same idiom as the profile export. */
  private saveDiagnostics(): void {
    try {
      const text = this.diagText;
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a');
      a.href = url;
      a.download = `voltmarch-diagnostics-${diagStamp()}.json`;
      // Detached on purpose: a synthetic click on an unattached anchor
      // downloads in every browser the game supports and cannot disturb layout
      // or the focus ring for the frame it exists.
      a.click();
      // One task later, so the navigation has taken the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      this.sayDiag(`Saved ${text.length.toLocaleString('en-US')} characters to your downloads.`);
    } catch (err) {
      this.sayDiag(`Save failed (${String(err)}). Use Copy To Clipboard instead.`, true);
    }
  }

  /* -- display (desktop only) -------------------------------------------- */

  /**
   * Fetch the window state from the Electron main process.
   *
   * A no-op in a browser, and a failure leaves `this.desktop` null — which is
   * the same state as "not desktop", so the section is simply absent rather
   * than half-drawn. There is no error surface here on purpose: an options
   * screen is not the place to report that an IPC channel is down, and the
   * game is entirely playable without this section.
   */
  private refreshDesktop(): void {
    const bridge = desktopBridge();
    if (bridge === null) return;
    void bridge
      .displayState()
      .then((state) => this.adoptDesktop(state))
      .catch(() => undefined);
    void bridge
      .gpuInfo('complete')
      .then((info) => {
        const label = activeAdapterLabel(info);
        if (label === null) return;
        this.gpuActive = label;
        if (this.body !== null && this.tab === 'graphics') this.renderTab();
      })
      .catch(() => undefined);
    void bridge
      .displayFrequency()
      .then((hz) => {
        if (!Number.isFinite(hz) || hz <= 0) return;
        this.displayHz = Math.round(hz);
        if (this.body !== null && this.tab === 'graphics') this.renderTab();
      })
      .catch(() => undefined);
  }

  private patchDesktop(patch: DesktopDisplayPatch): void {
    const bridge = desktopBridge();
    if (bridge === null) return;
    // The reply is the AUTHORITY, not the patch: choosing a smaller monitor can
    // invalidate the current window size, and main returns the corrected state.
    void bridge
      .setDisplayState(patch)
      .then((state) => this.adoptDesktop(state))
      .catch(() => undefined);
  }

  private adoptDesktop(state: DesktopDisplayState): void {
    this.desktop = state;
    // Only re-render if the screen is still mounted and still on this tab —
    // these resolve asynchronously and the player may have left either.
    if (this.body !== null && this.tab === 'graphics') this.renderTab();
  }

  private renderDisplay(body: HTMLElement): void {
    const d = this.desktop;
    if (d === null) return;
    const sec = this.section(body, 'Display');

    sec.appendChild(row(
      'Window Mode',
      chooser(
        [
          { value: 'fullscreen' as const, label: 'Fullscreen' },
          { value: 'windowed' as const, label: 'Windowed' },
        ],
        d.mode,
        (v) => this.patchDesktop({ mode: v }),
      ),
      /*
       * IT SAYS BORDERLESS BECAUSE IT IS BORDERLESS. Chromium has no
       * mode-setting path, so this cannot be exclusive fullscreen however it
       * is labelled — and a menu offering both "Fullscreen" and "Borderless"
       * would be two names for one behaviour. Stating it is the honest
       * version, and borderless is what most players want anyway.
       */
      'Borderless — Chromium has no exclusive fullscreen mode, so this alt-tabs '
      + 'instantly. Changes the pixel count your calibration solved for.',
    ));

    if (d.mode === 'windowed' && d.sizes.length > 1) {
      sec.appendChild(row(
        'Window Size',
        chooser(
          d.sizes.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w} × ${h}` })),
          `${d.width}x${d.height}`,
          (v) => {
            const [w, h] = v.split('x');
            if (w === undefined || h === undefined) return;
            this.patchDesktop({ width: Number(w), height: Number(h) });
          },
        ),
        'Only sizes that fit the chosen monitor, minus its taskbar, are offered.',
      ));
    }

    // One monitor needs no chooser, and an "Automatic" row on a single-display
    // machine is a control with nothing to control.
    if (d.displays.length > 1) {
      sec.appendChild(row(
        'Monitor',
        chooser(
          [
            { value: -1, label: 'Automatic' },
            ...d.displays.map((m) => ({ value: m.index, label: m.label })),
          ],
          d.displayIndex,
          (v) => this.patchDesktop({ displayIndex: v }),
        ),
        'Automatic restores the last safe window position. A first launch or '
        + 'a disconnected monitor starts centred on the primary display.',
      ));
    }

    /*
     * ALWAYS ON TOP — and the help text is deliberately not a sales pitch.
     *
     * Reported as *"when electron game is opened, the game window should be at
     * always on top mode? because now when i select it on taskbar and another
     * software opened, it exists in the back"*. This does fix that. It is also
     * the heaviest possible fix for it: the window then cannot be covered by
     * ANYTHING, ever — no browser, no chat window, no other app's file dialog —
     * so it trades an intermittent annoyance for a permanent one, and a player
     * has to be able to make that trade knowingly.
     *
     * IT IS ALSO PROBABLY A WORKAROUND RATHER THAN THE DIAGNOSIS.
     * `desktop/src/display.ts` records the likely cause as borderless-fullscreen
     * z-order on Windows — `setFullScreen(true)` is a borderless window sized to
     * the monitor, there being no exclusive mode in Chromium — which is a
     * different bug that this setting hides. Default OFF for both reasons.
     *
     * It applies immediately, like Window Mode and Monitor and unlike the two
     * switch-backed rows below, which is why it is grouped up here.
     */
    sec.appendChild(row(
      'Always On Top',
      toggle(d.alwaysOnTop, (v) => this.patchDesktop({ alwaysOnTop: v })),
      'Keeps the window in front of every other application. Off by default: it '
      + 'stops the game being pushed behind other windows, but nothing can ever '
      + 'cover it afterwards — including dialogs from other apps. Applies immediately.',
    ));

    sec.appendChild(row(
      'Lock Mouse To Window',
      toggle(d.lockPointer, (v) => this.patchDesktop({ lockPointer: v })),
      'Confines the pointer during live desktop gameplay. It releases for pause, '
      + 'menus, Alt+Tab and focus changes, then resumes after the next battlefield click.',
    ));

    sec.appendChild(row(
      'Graphics Processor',
      chooser(
        [
          { value: true, label: 'High Performance' },
          { value: false, label: 'System Default' },
        ],
        d.forceHighPerformanceGpu,
        (v) => this.patchDesktop({ forceHighPerformanceGpu: v }),
      ),
      // THE RESULT, NOT THE REQUEST. This setting used to report itself only
      // through a `console.log` in the main process — a refusal nobody reads,
      // for a switch that is a hint the platform may ignore. The adapter is
      // read back and stated here instead.
      'Forces the discrete GPU. This is the reason the desktop build exists — '
      + 'Windows ignores the same request from a browser. Takes effect on restart.'
      + (this.gpuActive !== null ? ` Running on ${this.gpuActive}.` : ''),
    ));

    sec.appendChild(row(
      'Unlock Frame Rate',
      toggle(d.unlockFrameRate, (v) => this.patchDesktop({ unlockFrameRate: v })),
      /*
       * The measured cost, stated. `desktop/src/flags.ts` carries the long
       * form: disabling vsync removes the vsync-flat case by construction, so
       * HardwareCalibration's not-fill-rate-bound guard stops firing and a
       * machine that was fine starts having its resolution cut — permanently,
       * because `graphics.calibrated` is sticky.
       */
      'Renders past your display\'s refresh rate. Off by default: it also stops '
      + 'Hardware Calibration recognising a healthy frame, so re-calibrate after. '
      + 'Takes effect on restart.',
    ));

    if (d.relaunchPending) {
      sec.appendChild(row(
        'Restart Required',
        button('Relaunch Now', {
          variant: 'primary',
          iconName: 'restore',
          onClick: () => desktopBridge()?.relaunch(),
        }),
        'Chromium takes its graphics settings at launch, so the changes above are '
        + 'saved but not yet in force.',
      ));
    }
  }

  /* -- graphics ---------------------------------------------------------- */

  private renderGraphics(body: HTMLElement): void {
    const g = this.shell.settings.get().graphics;
    /*
     * TOUCHING ANY ROW ON THIS TAB RETIRES THE ONE-TIME CALIBRATION, and that
     * is enforced by `SettingsStore.patch` rather than here — see the block
     * above `retiresCalibration`. So this helper stays exactly what it was, and
     * the next row somebody adds inherits the rule instead of having to
     * remember it.
     */
    const set = (patch: Partial<typeof g>): void => {
      this.shell.settings.patch({ graphics: patch });
    };

    // Desktop only, and first: it is the most physical thing on the tab, and
    // window size is upstream of every pixel-count decision below it.
    this.renderDisplay(body);

    const presets = this.section(body, 'Presets');
    presets.appendChild(row(
      'Quality Preset',
      chooser(
        [
          { value: 'auto' as const, label: `Auto (${activeTierName()})` },
          { value: 'low' as const, label: 'Low' },
          { value: 'medium' as const, label: 'Medium' },
          { value: 'high' as const, label: 'High' },
          { value: 'ultra' as const, label: 'Ultra' },
        ],
        g.tier,
        (v) => { set({ tier: v }); this.renderTab(); },
      ),
      'Sets shadows, post and resolution together.',
    ));
    /*
     * THE SLIDER USED TO LIE.
     *
     * It renders `settings.graphics.resolutionScale` straight out of the
     * persisted store, but the adaptive controller writes through
     * `handle.setResolutionScale` and never writes back. So on a GPU-bound
     * machine this row said "100%" while the renderer had walked down to 55%
     * and was upscaling — and the only surface anywhere that told the truth was
     * `stats().resolution` behind the perf overlay, which is off by default.
     *
     * A player looking at "100%" and seeing a soft, stair-stepped image
     * concludes the antialiasing is broken. That is exactly what was reported.
     */
    const liveScale = adaptiveLiveScale();
    const drifted = liveScale !== null && Math.abs(liveScale - g.resolutionScale) > 0.01;
    presets.appendChild(row(
      'Resolution Scale',
      slider({
        min: 0.5, max: 2, step: 0.05, value: g.resolutionScale,
        format: (v) => `${Math.round(v * 100)}%`,
        onChange: (v) => { set({ resolutionScale: v }); this.renderTab(); },
      }),
      drifted
        ? `Renders below native and upscales. Rendering at ${Math.round((liveScale ?? 1) * 100)}% `
          + 'right now — Adaptive Resolution lowered it to hold the frame rate.'
        : 'Renders below native and upscales. The cheapest frame you will ever buy.',
    ));
    /*
     * FRAME RATE TARGET — WHAT THE CALIBRATION SOLVES FOR, AND NOTHING ELSE.
     *
     * IT DOES NOT LIMIT FRAMES. There is no frame limiter in this project: the
     * render loop is in `src/core/`, which is frozen infrastructure, and adding
     * one there is a separate feature with its own interaction to think about
     * (a capped frame time is a FLAT frame time, which is exactly what
     * `CALIBRATION.flatSlopeMs` reads as "not fill-rate bound" — a limiter
     * switched on during a probe would poison the fit it is measured by). The
     * copy below therefore says "solves for" and never "caps".
     *
     * WHY 60 IS THE DEFAULT ON A 144 Hz PANEL, measured rather than assumed:
     * `targetMsForCap`'s header has the table. The short version is that on
     * §9's own machine every target above 60 lands on the resolution floor with
     * ambient occlusion switched off — because 5.86 ms of fixed cost is already
     * 84% of a 144 Hz frame — while on a machine fast enough to reach 144 the
     * answer clamps to the ceiling and is identical to 60's. Inert where it
     * would help, destructive where it would not. So it is opt-in.
     */
    const hz = this.displayHz;
    presets.appendChild(row(
      'Frame Rate Target',
      chooser(
        FPS_CAPS.map((v) => ({
          value: v,
          label: v === 0
            ? '60 fps (default)'
            : hz !== null && v > hz ? `${v} fps (above your display)` : `${v} fps`,
        })),
        g.fpsCap,
        (v) => { set({ fpsCap: v }); this.renderTab(); },
      ),
      'What Hardware Calibration solves the resolution for. It does not limit frames. '
      + (hz !== null ? `Your primary display runs at ${hz} Hz. ` : '')
      + 'Raising it trades sharpness for frame rate, and on most machines it reaches '
      + 'the resolution floor without reaching the target — so changing it re-runs the '
      + 'calibration.',
    ));
    const targetFps = Math.round(1000 / targetMsForCap(g.fpsCap));
    /*
     * ONE-TIME CALIBRATION, AND THE ROW HAS TO SAY WHICH STATE IT IS IN.
     *
     * "Calibrate" next to no other information is a button nobody presses,
     * because it does not say whether it has ever run or what it would change.
     * The note carries the last decision and its reason — see
     * `describeCalibration` — so pressing it is an informed thing to do.
     */
    presets.appendChild(row(
      'Hardware Calibration',
      button(g.calibrated ? 'Calibrate Again' : 'Calibrate Now', {
        iconName: 'monitor',
        onClick: () => {
          // Through the shell, NOT through `set`, and not through `patch`
          // either. Writing `calibrated: false` on a profile where it is
          // ALREADY false produces an empty diff, `patch` returns early, no
          // listener fires and the button does nothing — which is precisely
          // the state a first-time player pressing it is in.
          this.shell.recalibrate();
          this.renderTab();
        },
      }),
      g.calibrated
        // THE FPS IN THIS SENTENCE IS READ FROM THE SETTING, NOT TYPED. It said
        // "60 fps" in both branches, which became false the moment `fpsCap`
        // gained a reader — a row describing a measurement it no longer
        // performs is the exact defect `docs/SPEC_DRIFT_AUDIT.md` catalogues.
        ? `Measures your GPU for a few seconds during a battle and solves for the `
          + `resolution that holds ${targetFps} fps. Already done — press to measure again.`
        : `Measures your GPU for a few seconds at the start of your next battle and `
          + `solves for the resolution that holds ${targetFps} fps. Runs once.`,
    ));
    presets.appendChild(row(
      'Adaptive Resolution',
      toggle(g.adaptiveResolution, (v) => { set({ adaptiveResolution: v }); this.renderTab(); }),
      'Off by default. Keeps trading sharpness for frame rate for the whole '
      + 'match, down to 55% of native, instead of settling on one measured '
      + 'value. Off holds the scale exactly where you set it.',
    ));

    const light = this.section(body, 'Lighting');
    light.appendChild(row('Shadows', toggle(g.shadows, (v) => set({ shadows: v }))));
    light.appendChild(row(
      'Shadow Detail',
      chooser(
        [
          { value: 'low' as const, label: 'Low' },
          { value: 'medium' as const, label: 'Medium' },
          { value: 'high' as const, label: 'High' },
          { value: 'ultra' as const, label: 'Ultra' },
        ],
        g.shadowQuality,
        (v) => set({ shadowQuality: v }),
      ),
      'Cascade resolution. Ultra is 4096 per cascade.',
    ));
    light.appendChild(row(
      'Ambient Occlusion',
      toggle(g.ao, (v) => set({ ao: v })),
      'Contact shadow in cavities and under hulls.',
    ));

    const post = this.section(body, 'Post Processing');
    post.appendChild(row(
      'Post Chain',
      toggle(g.postFx, (v) => set({ postFx: v })),
      'Master switch. Off falls back to renderer tonemapping.',
    ));
    post.appendChild(row('Bloom', toggle(g.bloom, (v) => set({ bloom: v }))));
    post.appendChild(row('Antialiasing (SMAA)', toggle(g.smaa, (v) => set({ smaa: v }))));
    post.appendChild(row(
      'Edge Antialiasing (4x MSAA)',
      toggle(g.msaa, (v) => set({ msaa: v })),
      'Fixes thin pipes and panel lines breaking into dashes. SMAA cannot — it '
      + 'only reworks edges that were drawn. Costly on integrated graphics: '
      + 'switch it on and watch your frame counter.',
    ));
    post.appendChild(row(
      'Cinematic Vignette',
      toggle(g.filmGrain, (v) => set({ filmGrain: v })),
      'Darkens the frame edges without adding screen-space grain or chromatic aberration.',
    ));
    post.appendChild(row(
      'Panel Blur',
      chooser(
        [
          { value: 'auto' as const, label: 'Auto' },
          { value: 'on' as const, label: 'On' },
          { value: 'off' as const, label: 'Off' },
        ],
        g.panelBlur,
        (v: PanelBlurChoice) => { set({ panelBlur: v }); this.renderTab(); },
      ),
      panelBlurHint(g.panelBlur),
    ));

    const cam = this.section(body, 'Camera');
    cam.appendChild(row(
      'Field Of View',
      slider({
        min: 24, max: 60, step: 1, value: g.fov,
        format: (v) => `${Math.round(v)}°`,
        onChange: (v) => set({ fov: v }),
      }),
    ));
    cam.appendChild(row(
      'Closest Zoom',
      slider({
        min: 36, max: 60, step: 1, value: g.minZoom,
        format: (v) => `${Math.round(v)} m`,
        onChange: (v) => set({ minZoom: v }),
      }),
    ));
    cam.appendChild(row(
      'Furthest Zoom',
      slider({
        min: 60, max: 240, step: 2, value: g.maxZoom,
        format: (v) => `${Math.round(v)} m`,
        onChange: (v) => set({ maxZoom: v }),
      }),
    ));

    /*
     * THE `Diagnostics` SECTION THAT USED TO END THIS TAB HAS MOVED, whole, to
     * the Diagnostics TAB — see `renderDiagnostics` and the block above `TabId`.
     * It held one row (Performance Overlay), and a section that exists to hold
     * one toggle is a section that wants to be somewhere else. The setting is
     * unchanged and still lives at `graphics.perfOverlay`.
     */
  }

  /* -- audio ------------------------------------------------------------- */

  private renderAudio(body: HTMLElement): void {
    const a = this.shell.settings.get().audio;
    const set = (patch: Partial<typeof a>): void => {
      this.shell.settings.patch({ audio: patch });
    };
    const pct = (v: number): string => `${Math.round(v)}%`;

    const mix = this.section(body, 'Mixer');
    mix.appendChild(row('Mute All', toggle(a.muted, (v) => set({ muted: v }))));
    mix.appendChild(row('Master', slider({
      min: 0, max: 100, step: 1, value: a.master, format: pct,
      onChange: (v) => set({ master: v }),
    })));
    mix.appendChild(row('Music', slider({
      min: 0, max: 100, step: 1, value: a.music, format: pct,
      onChange: (v) => set({ music: v }),
    })));
    mix.appendChild(row('Effects', slider({
      min: 0, max: 100, step: 1, value: a.sfx, format: pct,
      onChange: (v) => set({ sfx: v }),
    })));
    mix.appendChild(row('Voice & EVA', slider({
      min: 0, max: 100, step: 1, value: a.voice, format: pct,
      onChange: (v) => set({ voice: v }),
    })));
    mix.appendChild(row('Interface', slider({
      min: 0, max: 100, step: 1, value: a.ui, format: pct,
      onChange: (v) => set({ ui: v }),
    })));
    mix.appendChild(row('Ambience', slider({
      min: 0, max: 100, step: 1, value: a.ambience, format: pct,
      onChange: (v) => set({ ambience: v }),
    })));

    const voices = this.section(body, 'Voices');
    voices.appendChild(row(
      'Strategic Announcer',
      toggle(a.announcer, (v) => set({ announcer: v })),
      'Controls EVA alerts without muting unit responses.',
    ));
    const responseOptions: readonly { value: UnitResponseChoice; label: string }[] = [
      { value: 'on', label: 'Full' },
      { value: 'selection', label: 'Selection Only' },
      { value: 'off', label: 'Off' },
    ];
    voices.appendChild(row(
      'Unit Responses',
      chooser(responseOptions, a.unitResponses, (v) => set({ unitResponses: v })),
      'Selection Only keeps confirmation on selection and silences order chatter.',
    ));

    const note = el('p', 'vm-body vm-settings-note');
    note.textContent = audio()?.engine == null
      ? 'No audio device is attached to this session. Levels are saved and will apply on the next match.'
      : 'Levels and voice preferences apply immediately. Music streams; effects and voices decode on demand.';
    body.appendChild(note);
  }

  /* -- gameplay ---------------------------------------------------------- */

  private renderGameplay(body: HTMLElement): void {
    const p = this.shell.settings.get().gameplay;
    const set = (patch: Partial<typeof p>): void => {
      this.shell.settings.patch({ gameplay: patch });
    };

    const training = this.section(body, 'Training');
    const trainingStatus = tutorialCompleted() ? 'Complete' : tutorialMenuHint();
    training.appendChild(row(
      'Field School',
      button(tutorialCompleted() ? 'Restore Tutorial' : 'Tutorial Available', {
        iconName: 'restore',
        disabled: !tutorialCompleted(),
        onClick: () => {
          restoreTutorialMenuItem();
          this.renderTab();
        },
      }),
      tutorialCompleted()
        ? 'Completed training is hidden from the title screen. Restore it here whenever you want a replay.'
        : `Title-screen training status: ${trainingStatus}.`,
    ));

    const accessibility = this.section(body, 'Accessibility');
    accessibility.appendChild(row('Text Size', slider({
      min: 0.9, max: 1.5, step: 0.05, value: p.textScale,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => set({ textScale: v }),
    }), 'Scales text throughout menus, the tactical HUD, tutorials and notifications.'));
    accessibility.appendChild(row(
      'High Contrast',
      toggle(p.highContrast, (v) => set({ highContrast: v })),
      'Brightens secondary text and strengthens panel edges without replacing faction colours.',
    ));
    accessibility.appendChild(row(
      'Reduce Interface Motion',
      toggle(p.reducedMotion, (v) => set({ reducedMotion: v })),
      'Suppresses non-essential menu and HUD animation. Camera movement and combat remain unchanged.',
    ));

    // Camera and navigation live on the CONTROLS tab, not here — that is where
    // a player goes looking for "why does my trackpad zoom instead of pan".

    const hud = this.section(body, 'Interface');
    hud.appendChild(row('Tooltips', toggle(p.tooltips, (v) => set({ tooltips: v }))));
    hud.appendChild(row(
      'Floating Damage Numbers',
      toggle(p.damageNumbers, (v) => set({ damageNumbers: v })),
    ));
    hud.appendChild(row(
      'Voice Subtitles',
      toggle(p.subtitles, (v) => set({ subtitles: v })),
      'Captions both strategic announcements and unit responses.',
    ));
    // UNLIKE THE THREE ROWS ABOVE, THIS ONE IS READ. `src/sim/tips.system.ts`
    // pulls it off `window.__vmSettings` and shows nothing when it is off; see
    // the header note, which lists the rows that are still waiting for a
    // consumer and no longer lists this one.
    hud.appendChild(row('Battlefield Tips', toggle(p.tips, (v) => set({ tips: v }))));
    hud.appendChild(row('Screen Shake', slider({
      min: 0, max: 2, step: 0.1, value: p.screenShake,
      format: (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`),
      onChange: (v) => set({ screenShake: v }),
    })));

    this.renderProfileManagement(body);
  }

  /** Profile files belong in Options, beside the preferences they protect. */
  private renderProfileManagement(body: HTMLElement): void {
    const section = this.section(body, 'Profile');
    const profile = readProgression();
    if (profile === null) {
      section.appendChild(el('p', 'vm-body', 'Profile management is unavailable in this session.'));
      this.renderGameFiles(section);
      return;
    }

    section.appendChild(el(
      'p',
      'vm-body',
      'Export a portable backup, restore one, or erase your progression. Desktop profiles are '
        + 'stored directly in the app data folder; browser data is not imported automatically.',
    ));

    const input = el('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.className = 'vm-sr';
    input.addEventListener('change', () => { void this.onProfileFileChosen(); });
    section.appendChild(input);
    this.profileFileInput = input;

    const actions = el('div', 'vm-diag-actions');
    actions.appendChild(button('Export Profile', {
      variant: 'primary', iconName: 'folder', onClick: () => this.exportProfile(),
    }));
    actions.appendChild(button('Import Profile', {
      iconName: 'restore', onClick: () => this.profileFileInput?.click(),
    }));
    const reset = button('Reset Progress', {
      iconName: 'refresh', variant: 'danger', onClick: () => this.onProfileResetClicked(),
    });
    actions.appendChild(reset);
    this.profileResetButton = reset;
    section.appendChild(actions);

    const status = el('p', 'vm-diag-status', 'No profile operation has been performed.');
    this.profileStatus = status;
    section.appendChild(status);
    this.renderGameFiles(section);
  }

  /** Native saves/settings live with profile management, never graphics quality. */
  private renderGameFiles(section: HTMLElement): void {
    if (desktopBridge() === null) return;
    section.appendChild(row(
      'Game Files',
      button('Open Folder', {
        iconName: 'info',
        onClick: () => void desktopBridge()?.revealUserData(),
      }),
      'Native profile, settings and save files stored under Electron userData.',
    ));
  }

  private sayProfile(text: string, bad = false): void {
    const status = this.profileStatus;
    if (status === null) return;
    status.textContent = text;
    status.classList.toggle('is-bad', bad);
  }

  private exportProfile(): void {
    const profile = readProgression();
    if (profile === null) return;
    try {
      const json = profile.exportProfile();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = el('a');
      anchor.href = url;
      anchor.download = `voltmarch-profile-${diagStamp()}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      this.sayProfile(`Exported ${json.length.toLocaleString('en-US')} bytes.`);
    } catch (err) {
      this.sayProfile(`Export failed: ${String(err)}`, true);
    }
  }

  private async onProfileFileChosen(): Promise<void> {
    const input = this.profileFileInput;
    const profile = readProgression();
    if (input === null || profile === null) return;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    try {
      const ok = profile.importProfile(await file.text());
      this.sayProfile(
        ok ? `Imported ${file.name}.` : `${file.name} is not a Voltmarch profile. Nothing changed.`,
        !ok,
      );
    } catch (err) {
      this.sayProfile(`Import failed: ${String(err)}. Nothing changed.`, true);
    }
  }

  private onProfileResetClicked(): void {
    const profile = readProgression();
    const reset = this.profileResetButton;
    if (profile === null || reset === null) return;
    if (!this.profileResetArmed) {
      this.profileResetArmed = true;
      const label = reset.querySelector('.vm-btn-label');
      if (label !== null) label.textContent = 'Confirm — erase all';
      reset.classList.add('is-armed');
      this.sayProfile('Erases every unlock, medal and counter. Export first.', true);
      this.profileResetTimer = window.setTimeout(() => {
        this.disarmProfileReset();
        this.sayProfile('Reset cancelled — nothing changed.');
      }, 4000);
      return;
    }
    this.disarmProfileReset();
    try {
      profile.resetProfile();
      this.sayProfile('Profile reset. Everything is available to earn again.');
    } catch (err) {
      this.sayProfile(`Reset failed: ${String(err)}`, true);
    }
  }

  private disarmProfileReset(): void {
    if (this.profileResetTimer !== 0) {
      window.clearTimeout(this.profileResetTimer);
      this.profileResetTimer = 0;
    }
    this.profileResetArmed = false;
    const reset = this.profileResetButton;
    if (reset === null) return;
    const label = reset.querySelector('.vm-btn-label');
    if (label !== null) label.textContent = 'Reset Progress';
    reset.classList.remove('is-armed');
  }

  /* -- controls ---------------------------------------------------------- *
   * EVERY ROW HERE COMES FROM `src/input/ActionCatalogue.ts`.
   *
   * This used to walk `KEYBINDS` from the settings store, which meant the
   * options screen and the engine each described the scheme in their own words.
   * The catalogue is now the one description; the store still owns persistence
   * and normalisation, and `tests/action-catalogue.spec.ts` asserts the two
   * agree on ids, defaults and surfaces. Adding an action to the catalogue adds
   * a row here with no edit to this file.
   *
   * A `fixed` action gets a row too, as a flat chip rather than a button. F3
   * was previously offered as rebindable and was not — the debug layer reads
   * the key code directly — and camera bookmarks are the same fixed contract.
   * A rebind button that does nothing is the same class of lie as a help screen
   * that shows the defaults.
   * ----------------------------------------------------------------------- */

  private renderControls(body: HTMLElement): void {
    this.renderNavigation(body);

    const bindings = this.shell.settings.get().controls.bindings;
    const conflicts = conflictingIds(bindings);

    for (const category of ACTION_CATEGORIES) {
      const rows = ACTIONS.filter((a) => a.category === category.id && isKeyboardRow(a));
      if (rows.length === 0) continue;
      const section = this.section(body, category.label);
      for (const def of rows) {
        section.appendChild(
          def.binding === 'fixed'
            ? row(def.label, fixedChip(def), 'Fixed — the engine reads this key code directly.')
            : row(def.label, this.bindButton(def, bindings, conflicts), noteFor(def)),
        );
      }
    }

    // The build keyboard is FIXED, so `findConflicts` — which only compares
    // rebindable rows against each other — cannot see a rebind landing on one of
    // its letters. This is the screen where that damage gets done, so it is the
    // screen that has to report it. The rebind is allowed to stand; the note
    // says what it cost.
    const stolen = buildHotkeyConflicts(bindings);
    if (stolen.length > 0) {
      const note = el('div', 'vm-conflict-note');
      note.textContent =
        `${stolen.length} build key${stolen.length === 1 ? '' : 's'} taken — ` +
        `${stolen.map((s) => `${s.label} by ${s.takenBy.label}`).join(', ')}. ` +
        'The order keeps the key; the sidebar cameo it used to build no longer answers to it.';
      body.insertBefore(note, body.firstChild);
    }

    if (conflicts.size > 0) {
      const note = el('div', 'vm-conflict-note');
      note.textContent = `${conflicts.size} conflicting binding${conflicts.size === 1 ? '' : 's'} — the highlighted commands share a key on the same surface.`;
      body.insertBefore(note, body.firstChild);
    }

    const help = el('p', 'vm-body vm-settings-note');
    help.textContent =
      'Select a command, then press the key or chord. Backspace clears a binding, Escape cancels. ' +
      'Camera and order keys are separate surfaces: sharing a key between them is intentional and is not flagged. ' +
      'During a match Escape opens the pause menu; click empty ground to clear a selection.';
    body.appendChild(help);
  }

  private bindButton(
    def: ActionDef,
    bindings: Record<string, Chord>,
    conflicts: ReadonlySet<string>,
  ): HTMLButtonElement {
    const b = el('button', 'vm-bind');
    b.type = 'button';
    b.textContent = chordLabel(bindings[def.id]);
    b.dataset.bind = def.id;
    if (conflicts.has(def.id)) b.classList.add('is-conflict');
    focusable(b);
    b.addEventListener('click', () => this.startListening(def.id, b));
    setAdjust(b, () => this.startListening(def.id, b));
    return b;
  }

  /* -- the full reference ------------------------------------------------- *
   * The Controls tab lists what can be REBOUND. Help lists what can be DONE,
   * including the sixty-odd pointer and trackpad gestures that have no key at
   * all. Opening it from here is also what makes it reachable from the title
   * screen, since Options is, and that costs the shell no new state.
   * ----------------------------------------------------------------------- */

  private openHelp(): void {
    const host = this.host;
    if (host === null || this.help !== null) return;
    this.stopListening();
    if (this.frameRoot !== null) this.frameRoot.hidden = true;

    const help = new HelpPanel({
      settings: this.shell.settings,
      onClose: () => this.closeHelp(),
    });
    this.help = help;
    host.appendChild(help.root);
    requestAnimationFrame(() => {
      help.root.querySelector<HTMLElement>('[data-vm-focus]')?.focus();
    });
  }

  private closeHelp(): void {
    if (this.help === null) return;
    this.help.dispose();
    this.help.root.remove();
    this.help = null;
    if (this.frameRoot !== null) this.frameRoot.hidden = false;
  }

  /* -- camera navigation -------------------------------------------------- *
   * The half of "controls" that is not a keybind. It leads the tab because it
   * is the half people actually need: the keys have always worked, and the
   * pointer scheme is what sends players to the options screen.
   * ----------------------------------------------------------------------- */

  private renderNavigation(body: HTMLElement): void {
    const p = this.shell.settings.get().gameplay;
    const set = (patch: Partial<typeof p>): void => {
      this.shell.settings.patch({ gameplay: patch });
    };
    const mult = (v: number): string => `${Math.round(v * 100)}%`;

    const how = el('p', 'vm-body vm-settings-note');
    how.textContent =
      'Trackpad: two fingers zoom, Shift + two fingers pans, pinch zooms. ' +
      'Mouse: the wheel zooms toward the cursor. ' +
      'Drag to pan with the middle button or with Space held. ' +
      'Right-click stays reserved for orders. H centres on your base.';
    body.appendChild(how);

    const nav = this.section(body, 'Pointer & Camera');

    nav.appendChild(row(
      'Pointing Device',
      chooser(
        [
          { value: 'auto' as const, label: 'Auto' },
          { value: 'trackpad' as const, label: 'Trackpad' },
          { value: 'mouse' as const, label: 'Mouse' },
        ],
        p.pointerDevice,
        (v: PointerDeviceChoice) => set({ pointerDevice: v }),
      ),
      'Auto reads the shape of the scroll events. With Trackpad Scroll set to Zoom ' +
      'both kinds dolly, so this changes little; set to Pan and it decides whether a ' +
      'plain scroll pans or zooms.',
    ));

    nav.appendChild(row(
      'Trackpad Scroll',
      chooser(
        [
          { value: 'zoom' as const, label: 'Zoom' },
          { value: 'pan' as const, label: 'Pan' },
        ],
        p.trackpadScroll,
        (v: TrackpadScrollChoice) => set({ trackpadScroll: v }),
      ),
      'Two fingers dolly the camera, as the mouse wheel does. Set to Pan for the ' +
      'macOS maps convention — pinch, Ctrl + scroll and Alt + scroll still zoom either way.',
    ));

    nav.appendChild(row(
      'Pan Sensitivity',
      slider({
        min: 0.25, max: 3, step: 0.05, value: p.panSensitivity,
        format: mult,
        onChange: (v) => set({ panSensitivity: v }),
      }),
      'Trackpad swipe and drag pan. 100% means the ground tracks your fingers exactly.',
    ));
    nav.appendChild(row(
      'Zoom Sensitivity',
      slider({
        min: 0.25, max: 3, step: 0.05, value: p.zoomSensitivity,
        format: mult,
        onChange: (v) => set({ zoomSensitivity: v }),
      }),
      'Wheel notches, two-finger scroll and pinch.',
    ));
    nav.appendChild(row(
      'Zoom To Cursor',
      slider({
        min: 0, max: 1, step: 0.05, value: p.zoomToCursor,
        format: (v) => `${Math.round(v * 100)}%`,
        onChange: (v) => set({ zoomToCursor: v }),
      }),
      'How strongly a zoom pulls the point under the cursor toward the centre.',
    ));
    nav.appendChild(row(
      'Keyboard Pan Speed',
      slider({
        min: 10, max: 120, step: 2, value: p.panSpeed,
        format: (v) => `${Math.round(v)} m/s`,
        onChange: (v) => set({ panSpeed: v }),
      }),
      'Arrow keys and WASD, at the default zoom. Speed scales as you pull back.',
    ));
    nav.appendChild(row(
      'Pan Momentum',
      toggle(p.cameraMomentum, (v) => set({ cameraMomentum: v })),
      'The camera carries a little inertia and settles instead of stopping dead.',
    ));
    nav.appendChild(row(
      'Drag Grabs The World',
      toggle(p.dragPanNatural, (v) => set({ dragPanNatural: v })),
      'On, the ground follows your cursor. Off, the camera does.',
    ));

    const inv = this.section(body, 'Invert');
    inv.appendChild(row('Invert Pan — Horizontal', toggle(p.invertPanX, (v) => set({ invertPanX: v }))));
    inv.appendChild(row('Invert Pan — Vertical', toggle(p.invertPanY, (v) => set({ invertPanY: v }))));
    inv.appendChild(row(
      'Invert Zoom',
      toggle(p.invertZoom, (v) => set({ invertZoom: v })),
      'For anyone whose scroll direction is already reversed by the operating system.',
    ));

    const edge = this.section(body, 'Edge Scrolling');
    edge.appendChild(row(
      'Edge Scrolling',
      toggle(p.edgeScroll, (v) => { set({ edgeScroll: v }); this.renderTab(); }),
      'Off by default. When on, the camera only scrolls while the pointer is MOVING ' +
      'into the edge — a cursor parked there does nothing.',
    ));
    if (p.edgeScroll) {
      edge.appendChild(row('Edge Scroll Speed', slider({
        min: 10, max: 120, step: 2, value: p.edgeScrollSpeed,
        format: (v) => `${Math.round(v)} m/s`,
        onChange: (v) => set({ edgeScrollSpeed: v }),
      })));
    }

    /* Panel Blur lives on the GRAPHICS tab, in Post Processing. It was offered
     * as an interface preference, but it is a compositing setting — it sits with
     * the other things a player turns off when the picture misbehaves, next to
     * Film Grain, and it is stored on `graphics` for the same reason. */
  }

  private startListening(id: string, node: HTMLButtonElement): void {
    this.stopListening();
    this.listening = id;
    this.listeningButton = node;
    node.classList.add('is-listening');
    node.textContent = 'PRESS A KEY';
  }

  private stopListening(): void {
    if (this.listeningButton !== null && this.listening !== null) {
      const current = this.shell.settings.get().controls.bindings[this.listening];
      this.listeningButton.classList.remove('is-listening');
      this.listeningButton.textContent = chordLabel(current);
    }
    this.listening = null;
    this.listeningButton = null;
  }

  private commitBinding(id: string, chord: Chord): void {
    const next = { ...this.shell.settings.get().controls.bindings, [id]: chord };
    this.shell.settings.patch({ controls: { bindings: next } });
    this.stopListening();
    // Re-render so both sides of a new conflict light up, not just this row.
    this.renderTab();
    const restored = this.body?.querySelector<HTMLElement>(`[data-bind="${id}"]`);
    restored?.focus();
  }
}

/* ==========================================================================
 * 3. CATALOGUE ROW HELPERS
 * ========================================================================== */

/**
 * True for an action the Controls tab should list.
 *
 * Pointer gestures belong on the help screen, and so do the fixed rows no
 * single chord can express — the control-group digits are "Ctrl + 0-9", which
 * is a sentence, not a binding.
 */
function isKeyboardRow(a: ActionDef): boolean {
  if (a.binding === 'rebindable') return true;
  return a.binding === 'fixed' && a.fixedChips === undefined && a.defaultChord !== null;
}

/** A hard-coded key, rendered in the bind language but not interactive. */
function fixedChip(a: ActionDef): HTMLElement {
  const node = el('span', 'vm-bind');
  node.style.opacity = '0.62';
  node.style.cursor = 'default';
  node.textContent = chordLabel(a.defaultChord ?? undefined);
  return node;
}

/** The row note, when there is something the player needs to know. */
function noteFor(a: ActionDef): string | undefined {
  return a.live === false ? 'Reserved — not yet read by the engine.' : undefined;
}

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
 *   `SettingsScreen` — four tabs over that translation. Every control writes
 *   through `SettingsStore.patch()`, which normalises, persists and notifies;
 *   the shell's subscription then calls `applySettings` with the diff. There is
 *   no "Apply" button and no pending state, because there is no way for the UI
 *   and the engine to be out of step: the store is the single source of truth
 *   and the screen only ever reads it back.
 *
 * WHAT IS NOT WIRED, AND WHY IT IS STILL HERE
 * -------------------------------------------
 * `tooltips`, `damageNumbers`, `subtitles` and `screenShake` have no consumer
 * in the engine yet — the HUD and VFX modules that will read them are being
 * written in parallel. They are persisted and published on
 * `window.__vmSettings` (see Shell) precisely so those modules can subscribe
 * without this file having to import them. They are NOT fake: the value is
 * real, stored and observable; only the reader is missing.
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
import { audio } from '../audio/AudioEngine';
import { CAMERA_NAV } from '../core/config';
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
  isBindableCode,
  touched,
  type Chord,
  type PanelBlurChoice,
  type PointerDeviceChoice,
  type Settings,
  type ShadowChoice,
} from './settings-store';

import { HelpPanel } from './Help';

import {
  button,
  chooser,
  el,
  focusable,
  icon,
  pageFrame,
  row,
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

/** Audio bus name -> the settings field that drives it. */
const AUDIO_BUSES = ['music', 'sfx', 'voice', 'ui', 'ambience'] as const;

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
  }

  if (game !== null && want('graphics.shadows')) {
    game.ctx.handle.setShadowsEnabled(settings.graphics.shadows);
  }

  if (want('graphics.shadowQuality')) {
    configureRender({
      renderer: { shadows: { mapSize: SHADOW_MAP_SIZE[settings.graphics.shadowQuality] } },
    });
  }

  if (all || touched(changed, 'graphics.tier') || touched(changed, 'graphics.ao') ||
      touched(changed, 'graphics.bloom') || touched(changed, 'graphics.smaa') ||
      touched(changed, 'graphics.filmGrain')) {
    const g = settings.graphics;
    configureRender({
      post: {
        ao: { enabled: g.ao },
        bloom: { enabled: g.bloom },
        smaa: { enabled: g.smaa },
        // Grain and chromatic aberration are 0 in BOTH arms, permanently. They
        // are on CLAUDE.md's explicit ban list, and these two literals are what
        // kept them alive: `core/config.ts` sets both to 0, and this block
        // overrode it on every settings apply — including the `all` apply at
        // boot — because `filmGrain` defaults to true. See the note at
        // `render/renderer.ts#grade`. The toggle now varies vignette only,
        // which is not banned and is the half of it worth keeping.
        grade: g.filmGrain
          ? { grain: 0, vignette: 0.28, chromaticAberration: 0 }
          : { grain: 0, vignette: 0.12, chromaticAberration: 0 },
      },
    });
  }

  if (game !== null && want('graphics.postFx')) {
    game.ctx.post.setEnabled(settings.graphics.postFx);
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
        minDistance: settings.graphics.minZoom,
        maxDistance: settings.graphics.maxZoom,
      },
    });
  }

  /* -- audio -------------------------------------------------------------- */

  if (want('audio')) {
    const engine = audio()?.engine ?? null;
    if (engine !== null) {
      engine.setMasterVolume(settings.audio.muted ? 0 : settings.audio.master);
      for (const bus of AUDIO_BUSES) engine.setBusVolume(bus, settings.audio[bus]);
    }
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
        // One "pan sensitivity" slider drives every pan surface, because a
        // player who finds the trackpad too fast finds the drag too fast too.
        trackpadPanSensitivity: p.panSensitivity,
        dragPanSensitivity: p.panSensitivity,
        wheelZoomSensitivity: p.zoomSensitivity,
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

/* ==========================================================================
 * 2. SCREEN
 * ========================================================================== */

type TabId = 'graphics' | 'audio' | 'gameplay' | 'controls';

const TABS: ReadonlyArray<{ id: TabId; label: string; icon: string }> = [
  { id: 'graphics', label: 'Graphics', icon: 'monitor' },
  { id: 'audio', label: 'Audio', icon: 'volume' },
  { id: 'gameplay', label: 'Gameplay', icon: 'target' },
  { id: 'controls', label: 'Controls', icon: 'keyboard' },
];

export class SettingsScreen implements Screen {
  readonly id = 'settings';

  private tab: TabId = 'graphics';
  private body: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  /** The options frame itself, hidden while the help overlay is up. */
  private frameRoot: HTMLElement | null = null;
  private help: HelpPanel | null = null;
  /** Keybind id currently waiting for a chord, or null. */
  private listening: string | null = null;
  private listeningButton: HTMLButtonElement | null = null;

  constructor(
    private readonly shell: Shell,
    private readonly returnTo: ShellState,
  ) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('vm-page');
    if (this.returnTo !== 'menu') host.classList.add('is-modal');

    const frame = pageFrame('Options', () => this.leave());

    const tabs = el('div', 'vm-tabs');
    for (const t of TABS) {
      const b = el('button', 'vm-tab');
      b.type = 'button';
      b.setAttribute('aria-selected', t.id === this.tab ? 'true' : 'false');
      b.appendChild(icon(t.icon, 16));
      b.appendChild(el('span', undefined, t.label));
      focusable(b);
      b.addEventListener('click', () => this.selectTab(t.id, tabs));
      tabs.appendChild(b);
    }
    // The tab strip is its own band between the title bar and the scrolling
    // body, so it never scrolls away from the content it selects.
    frame.root.insertBefore(tabs, frame.body);

    this.body = frame.body;
    this.renderTab();

    const reset = button('Restore Defaults', {
      iconName: 'restore',
      onClick: () => {
        this.shell.settings.reset(this.tab === 'controls' ? 'controls' : this.tab);
        // The Controls tab shows two different stores: the keybinds, which live
        // in `controls`, and the camera scheme, which lives in `gameplay`
        // because that is the section the engine already applies. Restoring
        // only half of a visible page is the kind of thing that reads as a bug.
        if (this.tab === 'controls') {
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
    frame.foot.appendChild(reset);
    frame.foot.appendChild(button('All Commands', {
      iconName: 'info',
      onClick: () => this.openHelp(),
    }));
    frame.foot.appendChild(el('div', 'vm-spacer'));
    frame.foot.appendChild(button('Done', { variant: 'primary', onClick: () => this.leave() }));

    this.frameRoot = frame.root;
    host.appendChild(frame.root);
  }

  unmount(): void {
    this.closeHelp();
    this.frameRoot = null;
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
    this.renderTab();
  }

  private renderTab(): void {
    const body = this.body;
    if (body === null) return;
    body.replaceChildren();
    switch (this.tab) {
      case 'graphics': this.renderGraphics(body); break;
      case 'audio': this.renderAudio(body); break;
      case 'gameplay': this.renderGameplay(body); break;
      case 'controls': this.renderControls(body); break;
      default: break;
    }
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const s = el('div', 'vm-section');
    s.appendChild(el('h3', 'vm-h3', title));
    parent.appendChild(s);
    return s;
  }

  /* -- graphics ---------------------------------------------------------- */

  private renderGraphics(body: HTMLElement): void {
    const g = this.shell.settings.get().graphics;
    const set = (patch: Partial<typeof g>): void => {
      this.shell.settings.patch({ graphics: patch });
    };

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
    presets.appendChild(row(
      'Resolution Scale',
      slider({
        min: 0.5, max: 2, step: 0.05, value: g.resolutionScale,
        format: (v) => `${Math.round(v * 100)}%`,
        onChange: (v) => set({ resolutionScale: v }),
      }),
      'Renders below native and upscales. The cheapest frame you will ever buy.',
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
    // Label and blurb both had to change with the grade above: this row said
    // "Film Grain & Vignette" / "Grain, vignette and chromatic aberration", and
    // two thirds of that is now deliberately never applied. A control that
    // names an effect it does not produce is the defect docs/SPEC_DRIFT_AUDIT.md
    // exists to catalogue. The stored key stays `filmGrain` — renaming it would
    // need a settings-schema migration for no player-visible gain.
    post.appendChild(row(
      'Vignette',
      toggle(g.filmGrain, (v) => set({ filmGrain: v })),
      'Darkens the frame edges. Strong or subtle.',
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
        min: 12, max: 60, step: 1, value: g.minZoom,
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

    /* -- diagnostics ----------------------------------------------------- *
     * One row, and its help text is the whole reason the feature exists. A
     * player who turns this on because the game feels heavy is owed the one
     * sentence that stops them trusting a green 60: on a vsync-capped display
     * the frame time is the MONITOR's number, not the game's, and only a GPU
     * timer query can tell the two apart. The overlay says which of those it
     * has; the row says why that matters before they open it.
     *
     * There is no `applySettings` branch for this. `src/ui/perf.system.ts`
     * subscribes to the store directly — see the field comment in
     * settings-store.ts — so the toggle takes effect on the next frame with no
     * translation layer in between.                                          */

    const diag = this.section(body, 'Diagnostics');
    diag.appendChild(row(
      'Performance Overlay',
      toggle(g.perfOverlay, (v) => set({ perfOverlay: v })),
      'Top-left readout: frame time and its p95, the sim/render CPU split, draw ' +
      'calls against the 130 budget, and whether a 60 fps reading has real ' +
      'headroom or is only vsync capping a saturated GPU. It will say "headroom ' +
      'unknown" rather than guess when the browser withholds GPU timing.',
    ));
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

    const note = el('p', 'vm-body');
    note.style.padding = '4px 18px 16px';
    note.textContent = audio()?.engine == null
      ? 'No audio device is attached to this session. Levels are saved and will apply on the next match.'
      : 'Levels apply immediately. Every sound in the game is synthesised at boot — nothing is streamed.';
    body.appendChild(note);
  }

  /* -- gameplay ---------------------------------------------------------- */

  private renderGameplay(body: HTMLElement): void {
    const p = this.shell.settings.get().gameplay;
    const set = (patch: Partial<typeof p>): void => {
      this.shell.settings.patch({ gameplay: patch });
    };

    // Camera and navigation live on the CONTROLS tab, not here — that is where
    // a player goes looking for "why does my trackpad zoom instead of pan".

    const hud = this.section(body, 'Interface');
    hud.appendChild(row('Tooltips', toggle(p.tooltips, (v) => set({ tooltips: v }))));
    hud.appendChild(row(
      'Floating Damage Numbers',
      toggle(p.damageNumbers, (v) => set({ damageNumbers: v })),
    ));
    hud.appendChild(row('EVA Subtitles', toggle(p.subtitles, (v) => set({ subtitles: v }))));
    hud.appendChild(row('Screen Shake', slider({
      min: 0, max: 2, step: 0.1, value: p.screenShake,
      format: (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`),
      onChange: (v) => set({ screenShake: v }),
    })));
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
   * was previously offered as rebindable and was not — the debug layer reads the
   * key code directly — and a rebind button that does nothing is the same class
   * of lie as a help screen that shows the defaults.
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

    const help = el('p', 'vm-body');
    help.style.padding = '6px 18px 18px';
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

    const how = el('p', 'vm-body');
    how.style.padding = '2px 18px 10px';
    how.textContent =
      'Trackpad: two fingers pan, pinch zooms. Mouse: the wheel zooms toward the cursor. ' +
      'Drag to pan with the middle button, with Space held, or with the right button — a right-click ' +
      'that does not move is still an order. H centres on your base.';
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
      'Auto reads the shape of the scroll events. Force one if a two-finger swipe ' +
      'zooms instead of panning, or a wheel notch pans instead of zooming.',
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
      'Wheel notches and pinch.',
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

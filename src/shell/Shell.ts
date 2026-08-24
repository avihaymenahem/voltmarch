/**
 * ============================================================================
 * src/shell/Shell.ts — the front end and the game state machine
 * ============================================================================
 * `main.ts` hands control here and this file owns everything that is not a
 * match: the title screen, the skirmish lobby, the options, the pause menu and
 * the results screen — plus the lifecycle that turns one into another.
 *
 *      boot -> menu -> setup -> loading -> playing -> paused -> ended -> menu
 *                ^                            |         |         |
 *                +----------------------------+---------+---------+
 *
 * WHY THE MENU RUNS A REAL MATCH BEHIND IT
 * ----------------------------------------
 * The title screen boots the engine exactly like a match does, with the AI off
 * and the camera slowly orbiting a base. It is a live 3D battlefield, not a
 * pre-rendered plate, so the menu always shows the game as it actually looks
 * right now — including whatever the art agents landed this morning. It also
 * means the expensive half of `startMatch` (shader compile, texture bake) has
 * already been paid for once by the time the player presses Start.
 *
 * WHY A MATCH IS A FULL RE-BOOTSTRAP
 * ----------------------------------
 * Several engine modules read their configuration straight off the URL at
 * `init()` — `world/terrain.system.ts` takes `?biome=`/`?mapseed=`,
 * `game/Scenarios.ts` takes `?map=`/`?seed=`, `sim/ai.system.ts` takes `?ai=`.
 * Rather than reach into six modules owned by six other agents, the shell
 * writes the query string with `history.replaceState` and then disposes and
 * re-bootstraps. `GameHandle.dispose()` already tears the whole tree down, so
 * this is the cheap, honest path and it exercises the same code as a cold boot.
 *
 * THE `?shot=` CONTRACT IS SACRED
 * -------------------------------
 * `tools/shoot.mjs` boots with `?shot=<name>` and must land in the posed
 * scenario with NOTHING in front of it. `main.ts` checks for that before it
 * ever constructs a Shell, so none of this code — not even the stylesheet's
 * side effects — is on that path. `?skipmenu=1` is the same escape hatch for a
 * human who wants to land straight in a match.
 *
 * THIS FILE ALSO OWNS THE SHARED DOM KIT
 * --------------------------------------
 * `el`, `icon`, `button`, `row`, `toggle`, `slider`, `chooser` and the focus
 * ring are exported here and imported by the five screen modules. They are
 * FUNCTION DECLARATIONS on purpose: Shell imports the screens and the screens
 * import the kit, which is a module cycle, and only hoisted declarations are
 * guaranteed to be initialised when the other half of a cycle evaluates.
 * ============================================================================
 */

import './shell.css';

import { bootstrap, type BootOptions, type GameHandle } from '../game/Bootstrap';
import { prepareRenderer } from '../render/renderer';
import { resetScenarioPlan, setPlannedArmies } from '../game/Scenarios';
import { applyTeams, isHostileSeat } from '../game/Teams';
import { resetTerrainPlan } from '../world/terrain-plan';
import { DEFAULT_ART, GAME_SPEEDS } from '../core/config';
import { EntityKind, Faction, type PlayerId } from '../core/types';
import { DEF_TABLES } from '../data/Defs';

import {
  MAPS,
  SettingsStore,
  armyCount,
  buildMatchQuery,
  chordEquals,
  codeLabel,
  cloneSetup,
  defaultSetup,
  defaultTeamFor,
  effectiveOpponents,
  mapById,
  normalizeSetup,
  rollSeed,
  teamsOf,
  touched,
  type Chord,
  type GraphicsSettings,
  type MatchSetup,
  type OpponentSetup,
  type Settings,
} from './settings-store';
import { BriefingScreen, CampaignScreen } from './Campaign';
import type { CampaignResult } from './EndScreen';

/*
 * The loading tip's key resolution. `actionKeyRow` is the tutorial's helper and
 * `src/shell/tutorial-steps.ts` is already in the ENTRY chunk (it holds the
 * classifier `tutorial.system.ts` reads), so this edge costs the entry bundle
 * nothing — and the tip prose itself stays here, in the lazy shell chunk, where
 * it has always been.
 */
import { actionKeyRow } from './tutorial-steps';
import { isApplePlatform, type StoredBindings } from '../input/ActionCatalogue';

import { eva as sayEva } from '../audio/AudioEngine';
import {
  campaignBriefing,
  campaignSpeaker,
  campaignTheme,
  preloadCampaignPortraits,
  type CampaignSpeakerPresentation,
  type CampaignTheme,
} from './CampaignPresentation';
import { armCalibration, disarmCalibration } from '../render/calibration.system';
import { targetMsForCap } from '../render/HardwareCalibration';
import { describeCalibration, type CalibrationResult } from '../render/HardwareCalibration';

import { applySettings, SettingsScreen } from './Settings';
import { MainMenuScreen } from './MainMenu';
import { SkirmishSetupScreen } from './SkirmishSetup';
import { MultiplayerSetup } from './MultiplayerSetup';
import {
  ReplayBar, ReplaysScreen, replayBuildWarning, replayMap, currentPlayback,
} from './Replays';
import type { ReplayFile } from '../game/Replay';
import { preparePlayback } from '../game/Playback';
import { currentReplay } from '../game/replay.system';
import { suppressUnlockGate } from '../progression/UnlockGate';
import { suppressProgression } from '../progression/suppress';
import { outcomePolicy, seatIgnored } from '../campaign/policy';

/**
 * The subset of `OperationDef.map` this file needs.
 *
 * DECLARED STRUCTURALLY RATHER THAN IMPORTED, so `Shell.ts` does not reach
 * into `src/campaign/types.ts` for a shape it only reads four fields of. The
 * same reason `save.system.ts` and `LoadGame.ts` each declare their own copy of
 * `SaveContext`: two files that can be edited independently, each checked
 * against its own copy, and `tests/campaign-gate.spec.ts` compares the two.
 */
/** One objective row the campaign publishes. Structural, same reason as above. */
interface CampaignObjectiveRow {
  readonly id: string;
  readonly title: string;
  readonly kind: 'primary' | 'secondary';
  readonly status: 'hidden' | 'active' | 'complete' | 'failed';
  readonly credits?: number;
}

interface OperationBoot {
  readonly preset: string;
  readonly biome: string;
  readonly mapSeed: number;
  readonly simSeed: number;
  readonly armies: number;
  readonly credits: number;
}
import type { MatchStart, Session } from '../net/Session';
import { PauseMenuScreen, currentObjectives } from './PauseMenu';
import { EndScreen, type MatchResult } from './EndScreen';
import { MissionsScreen } from './Missions';
import { TutorialDirector, tutorialSetup } from './Tutorial';
import {
  AutosaveScheduler,
  LoadGameScreen,
  autosaveLabel,
  errorText,
  saveService,
  unwrap,
  type AutosaveSample,
  type SaveContext,
  type SaveSlotMeta,
} from './LoadGame';
import * as progression from './progression-link';
import { DesktopUpdatePrompt } from './DesktopUpdatePrompt';

/* ==========================================================================
 * 1. THE STATE MACHINE
 * ========================================================================== */

export type ShellState =
  | 'boot'
  | 'menu'
  | 'setup'
  | 'settings'
  | 'credits'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  /** The missions and unlocks board. Reachable from the menu and from pause. */
  | 'missions'
  /** The save-slot list. Reachable from the title screen only. */
  | 'load'
  /** The recordings list. Reachable from the title screen only. */
  | 'replays'
  /**
   * The campaign's chapter and operation list.
   *
   * NEITHER OF THESE IS IN `MID_MATCH_STATES`, AND THAT IS A CLAIM ABOUT
   * REACHABILITY RATHER THAN A PREFERENCE. `game/outcome.system.ts` treats any
   * transition into `'playing'` from a state NOT on that list as a NEW MATCH
   * and emits `match:started`. Both of these are reachable from the title
   * screen only — there is no route from `'playing'` to either and back — so
   * adding them would mean a mid-match round trip could not re-arm the
   * campaign's own start triggers, which is a bug in the other direction.
   *
   * **If an in-match briefing log is ever built, it MUST go on that list.**
   * `match-lifecycle.spec.ts` drives every current mid-match route through the
   * real outcome watcher; add the new route there rather than source-reading
   * this array. `campaign-gate.spec.ts` separately pins the operation latches.
   */
  | 'campaign'
  /** One operation's briefing. Reachable from `'campaign'` only. */
  | 'briefing';

/** One full-bleed layer of the front end. */
export interface Screen {
  readonly id: string;
  /** Build the DOM into `host`. Called once per presentation. */
  mount(host: HTMLElement): void;
  /** Tear down listeners. The host element is removed by the shell. */
  unmount(): void;
  /** Return true to swallow the key. Called before the shell's own handling. */
  onKeyDown?(e: KeyboardEvent): boolean;
  /** Called when the player presses Escape / gamepad B. Return true if handled. */
  onBack?(): boolean;
}

/** A playable side, resolved from the def tables at runtime. */
export interface FactionOption {
  readonly key: string;
  readonly name: string;
  readonly id: Faction;
  /** Team colour from the art bible, for the card stripe. */
  readonly color: string;
  readonly blurb: string;
}

/* ==========================================================================
 * 2. DOM KIT
 *
 * Small, hoisted, dependency-free. Every interactive element carries
 * `data-vm-focus` so one focus ring can drive keyboard AND gamepad without any
 * screen having to enumerate its own controls.
 * ========================================================================== */

/**
 * Take the page fullscreen when a match starts. Best effort, never throws.
 *
 * Four ways this legitimately does nothing, all of them silent on purpose:
 *   - the screenshot harness (`?shot=`), where a fullscreen transition would
 *     resize the buffer mid-capture and every fixture would stop being diffable;
 *   - vitest, where there is no `document` at all;
 *   - a browser that refuses because the transient user activation from the
 *     click has already been spent — which is why the caller invokes this
 *     BEFORE its first await;
 *   - the user is already fullscreen, or pressed Escape and does not want to be.
 *
 * The rejected promise MUST be swallowed. An unhandled rejection here would
 * surface as a console error on a perfectly normal "player declined" path.
 */
export function goFullscreen(): void {
  if (typeof document === 'undefined') return;
  if (new URLSearchParams(location.search).has('shot')) return;
  if (document.fullscreenElement !== null) return;
  const root = document.documentElement;
  if (typeof root.requestFullscreen !== 'function') return;
  void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* declined */ });
}

const ADJUSTERS = new WeakMap<HTMLElement, (dir: number) => void>();

/** Register a left/right handler for an element (slider, chooser, toggle). */
export function setAdjust(el: HTMLElement, fn: (dir: number) => void): void {
  ADJUSTERS.set(el, fn);
}

export function getAdjust(el: HTMLElement): ((dir: number) => void) | undefined {
  return ADJUSTERS.get(el);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Mark an element as reachable by the focus ring. */
export function focusable<T extends HTMLElement>(node: T): T {
  node.setAttribute('data-vm-focus', '');
  if (!node.hasAttribute('tabindex')) node.tabIndex = 0;
  return node;
}

/* -- icons ------------------------------------------------------------------
 * A 24 grid at 1.7 stroke, round caps, `currentColor`. Authored as path data
 * so there is no sprite sheet, no font and no network request — an icon is a
 * dozen bytes of geometry in the same bundle as the code that draws it.
 * -------------------------------------------------------------------------- */

const ICON_PATHS: Readonly<Record<string, string>> = {
  play: 'M8 5.5 19 12 8 18.5Z',
  swords: 'M4 4h3l9.5 9.5M20 4h-3L7.5 13.5M4 20l4.5-4.5M20 20l-4.5-4.5M14 18l2 2 4-4-2-2',
  folder: 'M3 6.5h6l2 2.5h10V19H3Z',
  sliders: 'M4 7h10M18 7h2M4 12h4M12 12h8M4 17h13M21 17h-1M14 5v4M8 10v4M17 15v4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 7.6v.1',
  power: 'M12 3.5v8M17.5 6.8a8 8 0 1 1-11 0',
  back: 'M15 5 8 12l7 7',
  chevronLeft: 'M14 6 9 12l5 6',
  chevronRight: 'M10 6l5 6-5 6',
  map: 'M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20ZM9 4v13.5M15 6.5V20',
  flag: 'M6 21V4h11l-2 3.5L17 11H6',
  cpu: 'M8 8h8v8H8ZM4.5 10.5h3M4.5 13.5h3M16.5 10.5h3M16.5 13.5h3M10.5 4.5v3M13.5 4.5v3M10.5 16.5v3M13.5 16.5v3',
  coins: 'M12 8.5c4 0 7-1 7-2.2S16 4 12 4 5 5 5 6.3s3 2.2 7 2.2ZM5 6.3v11.4C5 19 8 20 12 20s7-1 7-2.3V6.3M5 12c0 1.3 3 2.3 7 2.3s7-1 7-2.3',
  gauge: 'M4.5 18.5a9 9 0 1 1 15 0M12 12l4-3.5',
  seed: 'M12 20c-4 0-7-3-7-7 5 0 7 2 7 7ZM12 20c0-6 3-9 8-9 0 5-3 9-8 9ZM12 20v-6',
  monitor: 'M3.5 5h17v11h-17ZM9 20h6M12 16v4',
  volume: 'M5 9.5h3.5L13 5.5v13L8.5 14.5H5ZM16.5 9a4.2 4.2 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM12 2v3M12 19v3M2 12h3M19 12h3',
  keyboard: 'M3 6.5h18v11H3ZM6.5 10h.1M10 10h.1M13.5 10h.1M17 10h.1M6.5 14h11',
  check: 'M5 12.5 10 17 19 7',
  cross: 'M6 6l12 12M18 6 6 18',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0ZM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9.5 20h5M12 14v6',
  skull: 'M12 3c4.4 0 7.5 3 7.5 7 0 2.4-1 3.7-2 4.6V18H6.5v-3.4c-1-.9-2-2.2-2-4.6 0-4 3.1-7 7.5-7ZM9.5 11a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8ZM14.5 11a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8ZM9.5 18v3M14.5 18v3M12 21v-3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5.2l3.4 2',
  lock: 'M5.5 10.5h13V20h-13ZM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3M12 14v2.5',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5',
  restore: 'M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4 5v4h4',
};

/** Inline SVG icon. `size` is a CSS px edge; the grid is always 24. */
export function icon(name: keyof typeof ICON_PATHS | string, size = 18): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'vm-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICON_PATHS[name] ?? ICON_PATHS.info);
  svg.appendChild(p);
  return svg;
}

export interface ButtonOptions {
  iconName?: string;
  hint?: string;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  onClick?: () => void;
}

export function button(label: string, options: ButtonOptions = {}): HTMLButtonElement {
  const b = el('button', 'vm-btn');
  b.type = 'button';
  if (options.variant === 'primary') b.classList.add('is-primary');
  if (options.variant === 'danger') b.classList.add('is-danger');
  if (options.iconName !== undefined) b.appendChild(icon(options.iconName));
  b.appendChild(el('span', 'vm-btn-label', label));
  if (options.hint !== undefined) b.appendChild(el('span', 'vm-btn-hint', options.hint));
  // THE HANDLER IS ATTACHED UNCONDITIONALLY, and it did not used to be.
  //
  // It lived on the enabled branch, so a button created disabled never got one
  // — and stayed inert forever even after something re-enabled it. Every
  // disabled button in the product until now was disabled PERMANENTLY (Load
  // Game with no saves), so nothing ever noticed. The Multiplayer entry is the
  // first that starts disabled and enables itself when the relay answers, and
  // it came up enabled, correctly labelled, and completely dead to the touch.
  //
  // THE `disabled` CHECK IS INSIDE THE LISTENER, NOT AROUND IT. A real browser
  // does not dispatch `click` on a disabled button, so the guard looks
  // redundant — and the first version of this leaned on exactly that and broke
  // `savegame-ux.spec.ts`, which drives a DOM stub that does not model the
  // suppression. Depending on a subtlety a test double does not implement is
  // depending on a subtlety; checking the flag costs nothing and is true
  // everywhere.
  const onClick = options.onClick;
  if (onClick !== undefined) {
    b.addEventListener('click', () => { if (!b.disabled) onClick(); });
  }
  setButtonEnabled(b, options.disabled !== true);
  return b;
}

/**
 * Enable or disable a button built by `button()`, focus ring included.
 *
 * `focusable()` only assigns a tabindex when the element has none, so flipping
 * `disabled` by hand leaves a re-enabled button at `tabIndex = -1` — reachable
 * by mouse and invisible to the keyboard. This is the one place that knows to
 * do both.
 */
export function setButtonEnabled(b: HTMLButtonElement, on: boolean): void {
  b.disabled = !on;
  if (on) {
    b.removeAttribute('tabindex');
    focusable(b);
  } else {
    b.removeAttribute('data-vm-focus');
    b.tabIndex = -1;
  }
}

/** A label/control pair. Returns the row so a caller can mark it focused. */
export function row(label: string, control: HTMLElement, note?: string): HTMLDivElement {
  const r = el('div', 'vm-row');
  const l = el('div', 'vm-row-label', label);
  if (note !== undefined) l.appendChild(el('span', 'vm-row-note', note));
  const c = el('div', 'vm-row-control');
  c.appendChild(control);
  r.appendChild(l);
  r.appendChild(c);
  return r;
}

export function toggle(value: boolean, onChange: (v: boolean) => void): HTMLButtonElement {
  const t = el('button', 'vm-toggle');
  t.type = 'button';
  t.setAttribute('role', 'switch');
  t.setAttribute('aria-checked', value ? 'true' : 'false');
  focusable(t);
  const set = (v: boolean): void => {
    t.setAttribute('aria-checked', v ? 'true' : 'false');
    onChange(v);
  };
  t.addEventListener('click', () => set(t.getAttribute('aria-checked') !== 'true'));
  setAdjust(t, (dir) => set(dir > 0));
  return t;
}

export interface SliderOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export function slider(options: SliderOptions): HTMLDivElement {
  const wrap = el('div', 'vm-row-control');
  const box = el('div', 'vm-slider');
  const input = el('input');
  input.type = 'range';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  input.value = String(options.value);
  const readout = el('span', 'vm-value');
  const fmt = options.format ?? ((v: number) => String(Math.round(v)));
  readout.textContent = fmt(options.value);

  const commit = (): void => {
    const v = Number(input.value);
    readout.textContent = fmt(v);
    options.onChange(v);
  };
  input.addEventListener('input', commit);
  focusable(input);
  setAdjust(input, (dir) => {
    input.value = String(Number(input.value) + dir * options.step);
    commit();
  });

  box.appendChild(input);
  wrap.appendChild(box);
  wrap.appendChild(readout);
  return wrap;
}

export interface ChooserOption<T> {
  value: T;
  label: string;
}

/**
 * A `‹ VALUE ›` cycler. Chosen over a `<select>` because a native dropdown
 * cannot be styled to the panel language, cannot be driven by a gamepad, and
 * opens an OS-level popup over a fullscreen canvas.
 */
export function chooser<T>(
  options: readonly ChooserOption<T>[],
  value: T,
  onChange: (v: T, index: number) => void,
): HTMLDivElement {
  const wrap = el('div', 'vm-chooser');
  let index = Math.max(0, options.findIndex((o) => o.value === value));

  const prev = el('button', 'vm-chooser-step');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Previous');
  prev.appendChild(icon('chevronLeft', 16));

  const readout = el('div', 'vm-chooser-value', options[index]?.label ?? '—');
  focusable(readout);
  readout.setAttribute('role', 'listbox');

  const next = el('button', 'vm-chooser-step');
  next.type = 'button';
  next.setAttribute('aria-label', 'Next');
  next.appendChild(icon('chevronRight', 16));

  const step = (dir: number): void => {
    if (options.length === 0) return;
    index = (index + dir + options.length) % options.length;
    readout.textContent = options[index].label;
    onChange(options[index].value, index);
  };

  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  readout.addEventListener('click', () => step(1));
  setAdjust(readout, step);

  wrap.appendChild(prev);
  wrap.appendChild(readout);
  wrap.appendChild(next);
  return wrap;
}

/** A notched glass panel. */
export function panel(className = ''): HTMLDivElement {
  return el('div', `vm-panel ${className}`.trim());
}

/** Page scaffold: head (title + back), scrolling body, footer for actions. */
export function pageFrame(
  title: string,
  onBack: () => void,
): { root: HTMLDivElement; head: HTMLDivElement; body: HTMLDivElement; foot: HTMLDivElement } {
  const root = panel('vm-page-panel');
  const head = el('div', 'vm-page-head');
  const back = button('Back', { iconName: 'back', onClick: onBack });
  back.classList.add('is-icon');
  head.appendChild(back);
  head.appendChild(el('h2', 'vm-h2', title));
  const body = el('div', 'vm-page-body');
  const foot = el('div', 'vm-page-foot');
  root.appendChild(head);
  root.appendChild(body);
  root.appendChild(foot);
  return { root, head, body, foot };
}

/* ==========================================================================
 * 3. FOCUS RING
 *
 * Keyboard and gamepad reach every control through this. Up/Down walk the
 * focusables in DOM order; Left/Right adjust the focused control if it
 * registered an adjuster, and otherwise walk too, so a d-pad never gets stuck.
 * ========================================================================== */

export class FocusRing {
  private items: HTMLElement[] = [];
  private index = -1;

  constructor(private readonly root: HTMLElement) {}

  refresh(): void {
    const found = this.root.querySelectorAll<HTMLElement>('[data-vm-focus]');
    this.items = [];
    for (let i = 0; i < found.length; i++) {
      const node = found[i];
      if (node.hasAttribute('disabled')) continue;
      if (node.offsetParent === null && node.getClientRects().length === 0) continue;
      this.items.push(node);
    }
    if (this.index >= this.items.length) this.index = this.items.length - 1;
  }

  get current(): HTMLElement | null {
    return this.index >= 0 ? (this.items[this.index] ?? null) : null;
  }

  focusFirst(): void {
    this.refresh();
    if (this.items.length === 0) return;
    this.index = 0;
    this.apply();
  }

  /** Focus a specific element if it is in the ring. */
  focusOn(node: HTMLElement): void {
    this.refresh();
    const i = this.items.indexOf(node);
    if (i < 0) return;
    this.index = i;
    this.apply();
  }

  move(delta: number): void {
    this.refresh();
    if (this.items.length === 0) return;
    // Adopt the browser's idea of focus first, so tabbing and arrowing agree.
    const active = document.activeElement as HTMLElement | null;
    const known = active === null ? -1 : this.items.indexOf(active);
    if (known >= 0) this.index = known;
    this.index = (this.index + delta + this.items.length) % this.items.length;
    this.apply();
  }

  private apply(): void {
    for (const node of this.items) {
      node.classList.remove('is-focus');
      node.closest('.vm-row')?.classList.remove('is-focus');
    }
    const node = this.items[this.index];
    if (node === undefined) return;
    node.classList.add('is-focus');
    node.closest('.vm-row')?.classList.add('is-focus');
    node.focus({ preventScroll: false });
  }

  /** Left/right on the focused control. True when something consumed it. */
  adjust(dir: number): boolean {
    const node = this.current ?? (document.activeElement as HTMLElement | null);
    if (node === null) return false;
    const fn = getAdjust(node);
    if (fn === undefined) return false;
    fn(dir);
    return true;
  }

  activate(): boolean {
    const node = this.current ?? (document.activeElement as HTMLElement | null);
    if (node === null) return false;
    node.click();
    return true;
  }
}

/* ==========================================================================
 * 4. GAMEPAD
 *
 * Polled, not evented — the Gamepad API has no state-change events for axes.
 * Only polled while a menu is open, so a match never pays for it, and the
 * poll is throttled to the repeat rate rather than run every frame.
 * ========================================================================== */

class GamepadNav {
  private lastMove = 0;
  private buttons = 0;

  /** @returns true when it produced input this poll. */
  poll(now: number, ring: FocusRing, onBack: () => void): boolean {
    const nav = navigator as Navigator & { getGamepads?: () => Array<Gamepad | null> };
    if (typeof nav.getGamepads !== 'function') return false;
    const pads = nav.getGamepads();
    let acted = false;

    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (pad === null || !pad.connected) continue;

      const ax = pad.axes.length > 0 ? pad.axes[0] : 0;
      const ay = pad.axes.length > 1 ? pad.axes[1] : 0;
      const up = (pad.buttons[12]?.pressed ?? false) || ay < -0.55;
      const down = (pad.buttons[13]?.pressed ?? false) || ay > 0.55;
      const left = (pad.buttons[14]?.pressed ?? false) || ax < -0.55;
      const rightPressed = (pad.buttons[15]?.pressed ?? false) || ax > 0.55;

      // 380 ms to the first repeat, 110 ms after — the same feel as a
      // console menu, and slow enough that a noisy stick cannot run away.
      const held = up || down || left || rightPressed;
      if (held && now - this.lastMove > (this.lastMove === 0 ? 0 : 140)) {
        if (up) ring.move(-1);
        else if (down) ring.move(1);
        else if (left) { if (!ring.adjust(-1)) ring.move(-1); }
        else if (rightPressed) { if (!ring.adjust(1)) ring.move(1); }
        this.lastMove = now;
        acted = true;
      } else if (!held) {
        this.lastMove = 0;
      }

      const a = pad.buttons[0]?.pressed ?? false;
      const b = pad.buttons[1]?.pressed ?? false;
      const mask = (a ? 1 : 0) | (b ? 2 : 0);
      const pressed = mask & ~this.buttons;
      this.buttons = mask;
      if ((pressed & 1) !== 0) { ring.activate(); acted = true; }
      if ((pressed & 2) !== 0) { onBack(); acted = true; }
    }
    return acted;
  }
}

/* ==========================================================================
 * 5. FACTIONS
 * ========================================================================== */

/**
 * The playable sides, read from the def tables at runtime rather than
 * hard-coded, so the third faction being added in parallel appears in the
 * lobby the moment it is published.
 */
export function playableFactions(): FactionOption[] {
  const out: FactionOption[] = [];
  const blurbs: Record<string, string> = {
    allies: 'Precision, mobility and beam tech. Fewer, better units.',
    soviets: 'Armour and volume. Slower, heavier, hits like a building.',
    meridian: 'Nothing the Pact fields touches the ground. Solar tech, hovering hulls.',
    reclaim: 'Welded out of other people’s wrecks. Open frames, chained arcs, no turrets.',
  };
  // Keyed by the faction's OWN key first, then its `paletteKey`. Both resolve
  // for all three armies now that `DEFAULT_ART.factions.meridian` exists; the
  // fallback chain is what let this card show a real colour before it did, and
  // it is what a fourth army will land on.
  const looks = DEFAULT_ART.factions as unknown as Record<string, { team: string } | undefined>;
  for (const f of DEF_TABLES.factions) {
    if (f.id === Faction.Neutral) continue;
    const look = looks[f.key] ?? looks[f.paletteKey] ?? DEFAULT_ART.factions.neutral;
    out.push({
      key: f.key,
      name: f.name,
      id: f.id,
      color: look.team,
      blurb: blurbs[f.key] ?? `${f.startLoadout.length} starting units, ${f.defaultBuildOrder.length}-step build order.`,
    });
  }
  return out;
}

function factionByKey(key: string): FactionOption | undefined {
  return playableFactions().find((f) => f.key === key);
}

/* ==========================================================================
 * 6. SHELL
 * ========================================================================== */

export interface ShellOptions {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  menuRoot: HTMLElement;
  debugRoot: HTMLElement;
  /** Boot straight into a match, skipping the title screen. */
  skipMenu?: boolean;
  /** `?campaign=` — boot straight into one operation. See `start()`. */
  campaign?: string | null;
  /** Status text sink — the pre-module curtain in index.html. */
  status?: (text: string) => void;
  /** Called once the first real frame is on screen. */
  onReady?: () => void;
  /** Fatal failure sink. */
  onError?: (title: string, detail: unknown) => void;
}

/* ==========================================================================
 * 6a. LOADING-SCREEN TIPS
 *
 * NO TIP SPELLS A KEY, AND NO TIP CONTAINS A DIGIT. Both rules are mechanical
 * (`tests/loading-tips.spec.ts`) because both were broken here for the whole
 * life of the file — `docs/SPEC_DRIFT_AUDIT.md` #27.
 *
 * THE KEY RULE. Three of the ten strings hard-coded a REBINDABLE key: "Q and E
 * rotate the camera", "Attack-move (A)…". `cam.rotateLeft`, `cam.rotateRight`
 * and `ord.attackMove` are all `binding: 'rebindable'`, so a player who moved
 * them was told the wrong key by their own loading screen — the exact failure
 * `src/input/ActionCatalogue.ts`'s header exists to end, on a surface shown
 * before every single match. A fourth named `Ctrl` for the control groups,
 * which is `fixed` and cannot lie by rebinding; it is routed anyway, because a
 * lint with a carve-out for "the fixed ones are fine" is a lint whose next
 * reader has to re-derive which ones those are.
 *
 * So a tip's prose never names a key. `{some.action.id}` is a placeholder
 * resolved AT DRAW TIME through `actionKeyRow` — the tutorial's helper, the
 * same one `src/shell/Help.ts` renders its rows from, against the bindings the
 * player has right now. Rebind Rotate Left and the next loading screen says so.
 *
 * WHY A TEMPLATE STRING RATHER THAN A STRUCTURED ROW. `TutorialStep` carries
 * `body` plus a parallel `actions: string[]`, because a tutorial step draws its
 * keys as CAPS in a separate strip. A tip has one line and the key belongs mid
 * sentence, so the id can sit where the key goes — which also removes the one
 * failure mode the parallel array has, prose and array disagreeing about how
 * many keys there are. `tipActionIds` recovers the ids for the test.
 *
 * THE DIGIT RULE is `tests/build-descriptions.spec.ts` §4's, applied to the
 * same class of copy: *"a figure retyped here is a second copy nothing
 * compares"*. It binds the AUTHORED text only. A substituted key label may well
 * contain digits — `sel.groupSet` renders `CTRL + 0 – 9` — and that is the
 * point, because those digits come out of the catalogue rather than out of
 * somebody's memory of it.
 * ========================================================================== */

/**
 * `{action.id}` — one live key name, resolved when the tip is drawn.
 *
 * Module-level and global on purpose, and safe for both readers: `replace`
 * resets `lastIndex` when it finishes, and `matchAll` runs against an internal
 * clone. Nothing else may `exec` it.
 */
const TIP_KEY = /\{([a-z][A-Za-z0-9.]*)\}/g;

/** Loading-screen copy. Real advice, not lorem. See the block above. */
export const TIPS: readonly string[] = [
  'Harvesters are your entire economy. Escort them, and rebuild them first.',
  'A war factory with two refineries out-produces two war factories with one.',
  'Right-click cancels a build placement without losing the structure.',
  '{sel.groupSet} stores a control group. Double-tap {sel.groupCentre} to jump the camera to it.',
  'Tesla and prism defences go dark in a brownout. Build the power plant first.',
  '{cam.rotateLeft} and {cam.rotateRight} rotate the camera. '
    + 'The silhouette of a base reads differently from every angle.',
  'Engineers capture. One engineer into an enemy war factory is worth a tank column.',
  'Attack-move ({ord.attackMove}) makes a column engage on the way '
    + 'instead of driving past the fight.',
  'Sell a damaged structure before it dies — you keep half the cost.',
  'Heavy armour shrugs off small arms. Bring cannons to a tank fight.',
];

/** Every catalogue action id a tip defers to, in the order it names them. */
export function tipActionIds(text: string): string[] {
  return [...text.matchAll(TIP_KEY)].map((m) => m[1]);
}

/**
 * One tip, with every `{action.id}` replaced by the key the player has now.
 *
 * An id the catalogue does not know renders as the same em dash `actionKeyRow`
 * uses for "no key at all", never as the raw id and never as a throw: this runs
 * while the match boots, and a loading screen that can crash is worse than one
 * that is briefly vague. The test is what makes it unreachable in shipped copy.
 */
export function resolveTip(
  text: string,
  bindings: StoredBindings,
  mac: boolean,
  labelFor: (code: string) => string,
): string {
  return text.replace(TIP_KEY, (_whole, id: string) => {
    const row = actionKeyRow(id, bindings, mac, labelFor);
    if (row === null) return '—';
    return row.chips.map((c) => c.text).join(' ');
  });
}

export class Shell {
  readonly settings: SettingsStore;

  private state: ShellState = 'boot';
  private readonly root: HTMLDivElement;
  private readonly host: HTMLDivElement;
  private readonly updatePrompt: DesktopUpdatePrompt;
  private screen: Screen | null = null;
  private ring: FocusRing;
  private readonly pad = new GamepadNav();

  private game: GameHandle | null = null;
  /** True while the running game is the title-screen backdrop, not a match. */
  private backdrop = false;
  /**
   * The beginner tutorial's director while a tutorial run is live.
   *
   * Owned here rather than by a screen because it outlives every screen: it is
   * constructed before the match boots, feeds off the engine through
   * `src/shell/tutorial.system.ts` for the whole match, and is torn down by
   * whichever path returns the player to the title.
   */
  private tutorial: TutorialDirector | null = null;

  private setup: MatchSetup;
  private result: MatchResult | null = null;

  /**
   * The live multiplayer match, or null in every single-player mode.
   *
   * Its presence is what switches `applySetupToWorld`, `applySimPostBoot` and
   * `setPaused` onto their PvP behaviour — one field rather than a flag threaded
   * through each of them, so there is exactly one thing to check and exactly one
   * place to clear.
   */
  private pvp: { session: Session; info: MatchStart } | null = null;
  /**
   * The bank every PvP match starts on, on both clients.
   *
   * A CONSTANT, NOT A LOBBY ROW. Starting credits are a per-client preference,
   * and two players who had chosen different ones started a "fair" match with
   * different money — a divergence on tick zero that no amount of relay
   * validation could have caught, because neither client is wrong.
   */
  private static readonly PVP_CREDITS = 10000;
  private netNotice: HTMLElement | null = null;
  private netNoticeTimer = 0;

  /* -- replays ------------------------------------------------------------
   * `replay` is to playback what `pvp` is to multiplayer: ONE field whose
   * presence switches `applySetupToWorld`, `applySimPostBoot`, `bootGame` and
   * the outcome poll onto their watching behaviour, so there is exactly one
   * thing to check and exactly one place to clear.
   * -------------------------------------------------------------------- */

  /** The recording driving the running match, or null in every ordinary game. */
  private replay: { file: ReplayFile; bar: ReplayBar | null } | null = null;
  /**
   * The recording of the last match this session, kept across the teardown.
   *
   * Taken in `endMatch` and `quitToMenu` — the two ways a match ends — because
   * the engine that holds the recorder is disposed moments later and the
   * player has not been asked yet whether they want it. A snapshot, so holding
   * it costs the arrays and nothing live.
   */
  private lastReplay: ReplayFile | null = null;
  /** 5 Hz accumulator for the replay bar's repaint. */
  private replayAccum = 0;
  /** True once the bar has been told the recording ran out. */
  private replayComplete = false;
  /**
   * The VIEWER's pause, as distinct from the shell's.
   *
   * Kept separately because three other things already pause the loop — the
   * pause menu, a hidden tab, the end of the recording — and each of them
   * un-pauses when it is done. Without a record of what the viewer asked for,
   * opening the pause menu over a deliberately-paused replay and closing it
   * again would start the recording playing.
   */
  private replayPaused = false;

  /**
   * The armed campaign operation, or null.
   *
   * SHAPED LIKE `this.replay` AND `this.pvp`, and read by exactly the same
   * guards — a campaign operation is a third kind of match that is not an
   * ordinary skirmish, and every place that already asks "is this an ordinary
   * launch" has to know about it. The def is held rather than only the id
   * because `bootGame` needs its map before anything is loaded, and
   * `endMatch` needs its objectives after everything is torn down.
   */
  private operation: {
    id: string;
    title: string;
    chapterTitle: string;
    /** The next operation in this chapter, or null at the end of one. */
    nextId: string | null;
    /** Resolved beside nextId so the synchronous result screen can name it. */
    nextTitle: string | null;
    map: OperationBoot;
  } | null = null;

  /**
   * Monotonic, so no two dialogue chips can coalesce. See `playCampaignBeat`.
   *
   * Deliberately NOT reset between matches: it is an identity counter, not a
   * count of anything, and a reset is the one thing that could make two beats
   * collide again.
   */
  private campaignBeatSeq = 0;

  /** The finished operation, pushed by `campaign.system.ts` before `endMatch`. */
  private campaignResult: CampaignResult | null = null;

  /** The last objective rows the campaign published. Read by the end screen. */

  private rafHandle = 0;
  private lastFrameMs = 0;
  private outcomeAccum = 0;
  private matchStartMs = 0;
  private disposed = false;
  private busy = false;
  /** Set once the cold-boot fallback has fired, so it can never loop. */
  private hardLaunched = false;

  /* -- autosave ----------------------------------------------------------
   * The POLICY is `AutosaveScheduler` (src/shell/LoadGame.ts) and it reads no
   * clock; everything it needs arrives in `autosaveSample`, which is a REUSED
   * object so the 2 Hz poll allocates nothing. The scheduler is driven from
   * `tick`, on the render side, which is what keeps `Date.now()` out of
   * `simTick` while still letting the SIM TICK COUNTER be the schedule.
   * -------------------------------------------------------------------- */
  private readonly autosave = new AutosaveScheduler();
  private readonly autosaveSample: AutosaveSample = {
    tick: 0, catchingUp: false, paused: false, canSave: false, objectivesComplete: 0,
  };
  private autosaveAccum = 0;
  /** True while a save is in flight, so the poll cannot start a second one. */
  private saving = false;
  /** Wall milliseconds the last snapshot took, for the perf report. 0 = none. */
  private lastSaveMs = 0;
  /** Bytes the last snapshot occupied. 0 = none written this session. */
  private lastSaveBytes = 0;
  /**
   * The seed the running match was actually built with.
   *
   * `startMatch` rolls one when `setup.seed` is 0, and until now that number
   * was thrown away the moment `bootGame` had used it. A save cannot reproduce
   * a match without it — the map, the ore fields and the scatter all come out
   * of it — so it is retained here.
   */
  private activeSeed = 0;
  private toastNode: HTMLElement | null = null;
  private toastTimer = 0;

  constructor(private readonly options: ShellOptions) {
    this.settings = new SettingsStore(undefined, playableFactions().map((f) => f.key));
    // `cloneSetup`, not a spread: `MatchSetup.opponents` is an array, and a
    // shallow copy would leave the shell and the store editing one of them.
    this.setup = cloneSetup(this.settings.setup());

    this.root = el('div', 'vm-shell');
    this.host = el('div', 'vm-shell-host');
    this.host.style.cssText = 'position:absolute;inset:0;';
    this.root.appendChild(this.host);
    options.menuRoot.appendChild(this.root);
    this.updatePrompt = new DesktopUpdatePrompt(options.menuRoot);
    this.ring = new FocusRing(this.host);

    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('resize', this.onResize, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.settings.subscribe(this.onSettingsChanged);

    // Panel blur is a class on `<html>`, not an engine setting, and the title
    // screen is painted long before a match exists. Apply THAT ONE path now —
    // passing an explicit change list keeps every other branch of
    // `applySettings` (which wants a live game) out of the constructor. Without
    // this a player who turns the blur off sees it come back on every cold boot,
    // right up until they launch a match.
    applySettings(this.settings.get(), null, ['graphics.panelBlur']);

    this.rafHandle = requestAnimationFrame(this.tick);
  }

  /* ---------------------------------------------------------------------- */
  /* Public surface — this is what other modules drive                      */
  /* ---------------------------------------------------------------------- */

  /** Current state of the machine. */
  getState(): ShellState {
    return this.state;
  }

  /** The live engine handle — a match OR the title backdrop — or null. */
  getGame(): GameHandle | null {
    return this.game;
  }

  /** True while the running engine is the title backdrop rather than a match. */
  isBackdrop(): boolean {
    return this.backdrop;
  }

  /** The configuration the next (or current) match runs with. */
  getSetup(): Readonly<MatchSetup> {
    return this.setup;
  }

  /** Difficulty the next campaign operation will use and grade medals against. */
  campaignDifficulty(): number {
    return this.setup.difficulty;
  }

  /**
   * The campaign identity behind the running match, if there is one.
   *
   * A copy rather than the private operation object: pause UI needs the
   * authored title and chapter, but must never gain a path to mutate the boot
   * plan or next-operation link while the simulation is frozen behind it.
   */
  currentCampaignOperation(): Readonly<{
    id: string;
    title: string;
    chapterTitle: string;
  }> | null {
    const operation = this.operation;
    if (operation === null) return null;
    return {
      id: operation.id,
      title: operation.title,
      chapterTitle: operation.chapterTitle,
    };
  }

  /**
   * Set the campaign grade explicitly from the briefing.
   *
   * Mirror it across the stored opponent rows as well as the legacy singular
   * field: `effectiveOpponents` deliberately lets those two representations
   * reassert one another, so persisting only one would make the choice appear
   * to revert when the skirmish lobby next opens.
   */
  setCampaignDifficulty(value: number): void {
    const difficulty = Math.max(0, Math.min(3, Math.round(value)));
    const next = cloneSetup(this.setup);
    next.difficulty = difficulty;
    for (const opponent of next.opponents) opponent.difficulty = difficulty;
    this.setup = this.settings.setSetup(next, playableFactions().map((f) => f.key));
  }

  /**
   * The seed the RUNNING match was booted with. 0 before the first launch.
   *
   * NOT `getSetup().seed`, and the difference matters: the lobby stores 0 to
   * mean "roll a fresh one", so the setup's value is a request and this one is
   * the answer. `saveContext` already depends on that distinction — a save
   * taken with the lobby's 0 would restore onto different terrain — and
   * `game/outcome.system.ts` needs the same fact for `EvMatchStarted.seed`.
   */
  getSeed(): number {
    return this.activeSeed;
  }

  /** Boot the front end. Resolves once something is on screen. */
  async start(): Promise<void> {
    // `?campaign=<chapter>.<NN>.<slug>` — straight into an operation.
    //
    // HANDED TO THE SHELL, NOT TO `options` FOR `bootstrap()`, and that is not
    // a style choice: `?tier=` is the shipped example of the other way round —
    // parsed in `main.ts`, put on the boot options, never handed to the shell,
    // and therefore harness-only for its entire life while the documented flag
    // list implied otherwise.
    //
    // It is also deliberately NOT in `MANAGED_FLAGS`. `buildMatchQuery` deletes
    // every managed key on every boot, so a flag listed there would erase
    // itself on the first `history.replaceState` and the operation would vanish
    // one frame after it loaded.
    const operation = this.options.campaign ?? null;
    if (operation !== null && operation !== '') {
      await this.startOperation(operation);
      return;
    }
    if (this.options.skipMenu === true) {
      await this.startMatch(this.setup);
      return;
    }
    await this.openMenu(true);
  }

  /**
   * Launch the match the relay has just paired.
   *
   * FOUR THINGS DIFFER FROM A SKIRMISH, and each one is a way two clients could
   * otherwise end up simulating different games:
   *
   * 1. THE UNLOCK GATE IS REMOVED. `Scenarios.ts` consults `isBuildable` when it
   *    spawns the starting army (lines 2048 and 2155), and the gate answers from
   *    the LOCAL profile. A veteran and a fresh account would build different
   *    armies on tick zero and desync before either player moved. Competitive
   *    play should be ungated anyway, so the correct fix and the necessary one
   *    are the same fix.
   * 2. SEED AND MAP COME FROM THE RELAY, never from the local lobby.
   * 3. SPEED IS PINNED TO 1x AND PAUSE IS DISABLED — see `applySimPostBoot` and
   *    `setPaused`. Neither can desync (a tick is a tick whenever it runs) but
   *    both are meaningless when the other player is not waiting for you.
   * 4. LOCKSTEP IS ATTACHED ONLY AFTER THE WORLD EXISTS. The step gate reads
   *    `loop.tick`, so there has to be a loop before the gate can be installed.
   */
  async startMultiplayerMatch(session: Session, info: MatchStart): Promise<void> {
    if (this.busy || this.disposed) return;
    const map = mapById(info.map);

    this.pvp = { session, info };
    session.attach({
      onOver: (_reason, winnerSlot, message) => { this.endMultiplayer(winnerSlot, message); },
      onPeerLost: (graceMs) => { this.setNetNotice(`Opponent disconnected — ${Math.round(graceMs / 1000)}s`); },
      onNotice: (message) => { this.setNetNotice(message); },
    });

    // A skirmish setup is still what boots the world; it is the CHANNEL, not
    // the authority. Every field the two clients must agree on is overwritten
    // from `info` here or in `seatPvpPlayers`.
    const setup: MatchSetup = {
      ...this.setup,
      map: map.id,
      seed: info.seed,
      speed: 1,
      difficulty: 0,
      personality: -1,
      // ONE ENTRY, AND IT IS NOT AN OPPONENT — the relay pairs two HUMANS and
      // `seatPvpPlayers` overwrites both slots from `info`. It is stated here so
      // a four-way skirmish left in the lobby cannot leak an army count into a
      // PvP boot, where the two clients would then disagree about the table.
      // `defaultTeamFor(0)`: the two humans are enemies, and `seatPvpPlayers`
      // never reaches the team writer in any case.
      opponents: [{ faction: this.setup.aiFaction, difficulty: 0, personality: -1, team: defaultTeamFor(0) }],
    };

    // SUPPRESSED, NOT CLEARED. `setUnlockGate(null)` here does nothing: the
    // boot that follows runs `progression.system`'s init, which installs a gate
    // built from THIS browser's profile — so a veteran and a fresh account
    // would build different starting armies and diverge before tick 1. The
    // suppression is a flag `isBuildable` honours regardless of what is
    // installed, so nothing during the boot can undo it.
    suppressUnlockGate(true);

    // THE OPENING IS FORCED. `startCondition` (pre-built base vs construction
    // vehicle) is persisted per client in its own localStorage key and is NOT
    // part of `MatchSetup`, so two players with different settings would build
    // two different worlds from the same seed. It is not on the wire either, so
    // there is nothing to agree on — both clients take the MCV opening, which
    // is the real game. Forced through `?start=`, which `chooseStart` in
    // Scenarios.ts documents as the only channel that outranks a stored
    // preference — the same channel the tutorial uses for the same reason.

    // ARMED BEFORE THE BOOT. The step gate must exist for tick 1 — the tick
    // that opens turn 0 — or that turn never sends its frame and both clients
    // wait forever for one neither produced. Attaching after `startMatch`
    // returned froze every match at around tick 7.
    session.startLockstep(info);

    await this.startMatch(setup, { persist: false });

    if (this.game === null) { this.pvp = null; suppressUnlockGate(false); return; }
  }

  /**
   * The relay says the match is over. Show it through the ordinary end screen.
   *
   * `winnerSlot` of -1 means nobody won — a desync, a shutdown, a timeout. That
   * is reported as a loss for scoring purposes and the banner carries the real
   * reason, because there is no "the match was voided" result and inventing one
   * would mean touching every consumer of `MatchResult` for an outcome that
   * should be vanishingly rare.
   */
  private endMultiplayer(winnerSlot: number, message: string): void {
    const pvp = this.pvp;
    this.pvp = null;
    this.setNetNotice(message);
    if (pvp === null || this.result !== null) return;
    this.endMatch({ won: winnerSlot === pvp.info.slot });
  }

  /**
   * A one-line banner over the HUD for anything the network needs to say:
   * an opponent disconnecting, a grace countdown, a desync, a refusal.
   *
   * `textContent`, never markup — and the string is always one of this build's
   * own, never one the relay supplied. See the header of `src/net/Session.ts`.
   */
  private setNetNotice(message: string): void {
    let node = this.netNotice;
    if (node === null) {
      node = el('div', 'vm-net-notice');
      this.options.hudRoot.appendChild(node);
      this.netNotice = node;
    }
    node.textContent = message;
    node.classList.add('is-on');
    if (this.netNoticeTimer !== 0) clearTimeout(this.netNoticeTimer);
    this.netNoticeTimer = setTimeout(() => {
      this.netNotice?.classList.remove('is-on');
    }, 6000) as unknown as number;
  }

  /* ---------------------------------------------------------------------- */
  /* Replays                                                                */
  /* ---------------------------------------------------------------------- */

  /** Open the recordings list. */
  openReplays(): void {
    this.show(new ReplaysScreen(this), 'replays');
  }

  /** The recording of the last match this session, or null. */
  latestReplay(): ReplayFile | null {
    return this.lastReplay;
  }

  /** True while the running match is a recording being watched. */
  isReplay(): boolean {
    return this.replay !== null;
  }

  /**
   * Boot the match a recording describes and let the recording drive it.
   *
   * SIX THINGS DIFFER FROM A SKIRMISH, and five of them are ways the world
   * would otherwise be built differently from the one that was recorded.
   *
   * 1. THE UNLOCK GATE IS SUPPRESSED, for exactly the reason multiplayer
   *    suppresses it and with exactly the same failure if it is not.
   *    `Scenarios.ts` asks `isBuildable` while it spawns the STARTING ARMY, and
   *    the gate answers from the LOCAL PROFILE — so a replay recorded by a
   *    veteran and watched on a fresh account starts with different units on
   *    the field and has already diverged before tick one. It is suppressed
   *    rather than cleared for the reason `UnlockGate` documents: the boot
   *    reinstalls a gate built from this browser's profile halfway through, so
   *    clearing it beforehand does nothing.
   * 2. EVERY BOOT FLAG COMES FROM THE HEADER, never from the local lobby: the
   *    sim seed, the map preset, the biome, the landform roll, and the opening.
   *    That last one is the same trap as the gate — `?start=` is a stored
   *    per-client PREFERENCE, so a viewer who last played a pre-built-base
   *    skirmish would watch an MCV recording start with a base.
   * 3. THE SLOTS ARE SEATED FROM THE HEADER — factions, difficulty,
   *    personality, and the bank each side opened on.
   * 4. EVERY SLOT IS `isHuman`, which is the entire AI shutdown, and it is the
   *    same one-line mechanism PvP uses. The recording ALREADY CONTAINS the
   *    AI's commands — the brain issues them through `channels.command` like
   *    everybody else, so the recorder taps them — and a brain running here as
   *    well would issue a second copy of every one of them.
   * 5. PLAYBACK IS ARMED BEFORE THE BOOT. `preparePlayback` has to be called
   *    before `bootstrap()` for the same reason `prepareSession` does: systems
   *    cannot be handed anything until `startMatch` returns, and by then the
   *    loop has run.
   * 6. And the cosmetic one: it starts at 1x, and the bar owns the speed from
   *    there. Speed scales the ACCUMULATOR and never `SIM_DT`, so a viewer can
   *    move it freely without changing a single thing the simulation does.
   */
  async startReplay(file: ReplayFile): Promise<void> {
    if (this.busy || this.disposed) throw new Error('The shell is busy.');
    const header = file.header;

    this.clearReplay();
    this.replay = { file, bar: null };
    this.replayComplete = false;
    suppressUnlockGate(true);
    // The profile is deaf for the duration. The carve-out in `startMatch`
    // below was ALREADY THERE and already defeated: `MissionTracker` opens a
    // match off the `match:started` bus event one frame later, so watching a
    // recording of a win has been banking `wins` and `currentStreak` for as
    // long as replays have existed. See `progression/suppress.ts`.
    suppressProgression(true);
    preparePlayback(file);

    // A CAMPAIGN RECORDING NEEDS ITS OPERATION ARMED BEFORE THE BOOT, because an
    // operation's effects are NOT in the command stream — the Director spawns,
    // pays and reveals inside `simTick` and re-runs under playback. Without this
    // the layout never builds, no tag is stamped, no trigger fires, and the
    // viewer watches an ordinary skirmish on the recording's seed: exactly the
    // silent substitution `Playback.ts#detachPlayback` documents, by a second
    // route.
    const recordedOp = header.campaign?.operation ?? '';
    if (recordedOp !== '') {
      const install = await import('../campaign/campaign-install');
      const op = install.armOperation(recordedOp, this.setup.difficulty);
      if (op === null) {
        this.clearReplay();
        throw new Error(
          `This recording is campaign operation "${recordedOp}", which this build does not have.`,
        );
      }
      // `this.operation` and not just the arming: `bootGame` reads it for
      // `applyCampaignQuery`, and `activeOperationId()` is what the probe prints.
      this.operation = {
        id: op.id,
        title: op.title,
        chapterTitle: install.chapterOf(op)?.title ?? op.chapter,
        // A replay or a restored save has nowhere onward to offer.
        nextId: null,
        nextTitle: null,
        map: op.map,
      };
    }

    // A skirmish setup is still what boots the world; it is the CHANNEL, not
    // the authority. `bootGame` overwrites every flag that matters straight
    // from the header — see `applyReplayQuery` — and `seatReplayPlayers`
    // overwrites the player table. What is left here is what the pause menu and
    // the results header read to LABEL the match.
    const names = playableFactions();
    const keyOf = (faction: number | undefined): string | undefined =>
      names.find((f) => (f.id as number) === faction)?.key;
    const watched = header.players[header.localPlayer];
    // EVERY other army, not just the first. The setup is only a label here —
    // `seatReplayPlayers` overwrites the table from the header regardless — but
    // the pause menu, the results header and `armyCount` all read it, and a
    // four-way recording described as a duel is a lie on three screens.
    const others: OpponentSetup[] = header.players
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i !== header.localPlayer && p.faction !== (Faction.Neutral as number))
      .map(({ p }, i) => ({
        faction: keyOf(p.faction) ?? this.setup.aiFaction,
        difficulty: p.aiDifficulty,
        personality: -1,
        // The recording's OWN alliances are restored from the header by
        // `seatReplayPlayers`, which runs instead of the team writer — this
        // list exists to make `armyCount` and the results screen honest, so it
        // carries the free-for-all default rather than a second opinion.
        team: defaultTeamFor(i),
      }));
    const other = others[0];

    const setup: MatchSetup = {
      ...this.setup,
      map: replayMap(header).id,
      seed: header.simSeed >>> 0,
      speed: 1,
      difficulty: other?.difficulty ?? this.setup.difficulty,
      personality: -1,
      playerFaction: keyOf(watched?.faction) ?? this.setup.playerFaction,
      aiFaction: other?.faction ?? this.setup.aiFaction,
      opponents: others.length > 0 ? others : cloneSetup(this.setup).opponents,
    };

    await this.startMatch(setup, { persist: false });

    if (this.state !== 'playing' || this.game === null) {
      this.clearReplay();
      throw new Error('The match this recording was made in could not be started.');
    }

    const bar = new ReplayBar({
      setReplayPaused: (paused) => {
        this.replayPaused = paused;
        this.game?.setPaused(paused);
      },
      setReplaySpeed: (index) => { this.game?.ctx.loop.setSpeed(index); },
      exitReplay: () => { void this.quitToMenu(); },
    }, file, replayBuildWarning(file));
    this.root.appendChild(bar.root);
    this.replay.bar = bar;
    this.replayAccum = 0;
  }

  /**
   * Drop playback state and put the unlock gate back.
   *
   * Called on every exit from a replay AND on the way into `startReplay`, so a
   * viewer who opens a second recording without going through the menu cannot
   * leave the first one's player feeding the new world.
   */
  /**
   * Launch a campaign operation.
   *
   * ARM, THEN BOOT, AND THE ORDER IS THE WHOLE THING. `armOperation` installs
   * the scenario plan, the layout, the roster and the outcome policy, and every
   * one of them has to be in place before `startMatch` builds a world:
   *
   *   - the plan, because the generator reserves one levelled shelf per seat
   *     and reads that number before anything stands on it;
   *   - the layout, because `PLANS.campaign.build` runs inside `bootstrap()`;
   *   - the roster, because `Scenarios.ts` calls `isBuildable` WHILE SPAWNING
   *     THE STARTING ARMY, and installing it afterwards hands the layout this
   *     browser's profile instead of the operation's authored content — the
   *     tick-zero desync CLAUDE.md documents twice;
   *   - the policy, because `pollOutcome` starts asking at ten seconds of sim
   *     time and a scripted insertion holds nothing long before that.
   *
   * The import is the ONLY one in the product that reaches
   * `src/campaign/campaign-install`, and it is what keeps the Director, the
   * operation table and every word of prose out of the entry chunk.
   */
  async startOperation(operationId: string): Promise<void> {
    if (this.busy || this.disposed) return;

    // Whatever was armed before, gone first. Arming twice without this leaves
    // the previous operation's roster in force over the new one's world.
    await this.abandonOperation();

    const install = await import('../campaign/campaign-install');
    const op = install.armOperation(operationId, this.setup.difficulty);
    if (op === null) {
      this.fail('Operation Not Found', new Error(`No campaign operation '${operationId}'.`));
      return;
    }
    // Campaign worlds have a long deterministic boot. Spend that time fetching
    // the 640px cast so an opening transmission never fades in over a blank
    // portrait slot; ordinary skirmishes never call this and pay nothing.
    preloadCampaignPortraits();
    // RESOLVED ONCE, HERE, BECAUSE `buildResult` RUNS INSIDE A FRAME. The
    // chapter title and the next operation both live in the lazily-imported
    // table, and the end screen cannot await a chunk while it is being built.
    const chapter = install.chapterOf(op);
    const nextOperation = chapter?.operations.find((o) => o.index === op.index + 1) ?? null;
    this.operation = {
      id: op.id,
      title: op.title,
      chapterTitle: chapter?.title ?? op.chapter,
      // THE NEXT OPERATION IN THIS CHAPTER, or null at the end of one. Offered
      // on a win so the campaign has somewhere to go — an end screen whose only
      // forward button is "Main Menu" makes a nine-operation chapter feel like
      // nine separate skirmishes.
      nextId: nextOperation?.id ?? null,
      nextTitle: nextOperation?.title ?? null,
      map: op.map,
    };
    this.campaignResult = null;
    // THE PROFILE IS DEAF FOR THE DURATION. A scripted operation's kill count
    // is AUTHORED, so paying the profile chains at authored rates is a farm —
    // and `struct.defence.aa` arriving before `unit.air` is an ordering
    // accident of the mission curve that a campaign could otherwise invert.
    suppressProgression(true);

    const keys = playableFactions();
    const keyOf = (faction: number): string | undefined =>
      keys.find((f) => (f.id as number) === faction)?.key;

    // THE LOBBY MAP ID HAS TO MOVE TOO, AND FORGETTING IT WAS VISIBLE ON THE
    // FIRST SCREENSHOT: the victory panel read "Every hostile force on
    // Temperate Valley has been destroyed" over an operation fought on arid
    // ground. `bootGame`'s query override fixes what the GENERATOR builds;
    // `setup.map` is what every LABEL reads — the pause menu, the results
    // header, the save row and `buildResult`.
    //
    // Matched by preset rather than named, because an operation declares a
    // `MAP_PRESETS` key and the lobby row is a different vocabulary. No match
    // is survivable: the labels fall back to the lobby's last map, which is
    // wrong-looking rather than broken, and `campaign-maps.spec.ts` would have
    // to grow a rule the day an operation ships on a preset no lobby row uses.
    const lobbyRow = MAPS.find((m) => m.preset === op.map.preset);
    const setup: MatchSetup = {
      ...this.setup,
      map: lobbyRow?.id ?? this.setup.map,
      seed: op.map.simSeed,
      speed: 1,
      personality: -1,
      startingCredits: op.map.credits,
      playerFaction: keyOf(op.faction as number) ?? this.setup.playerFaction,
      /*
       * THE ENEMY IS AUTHORED TOO, AND `aiFaction` HAS TO MOVE WITH IT.
       *
       * Both of these lines read `op.foe`. Setting only `opponents` would have
       * looked right and changed nothing on the two-army operations, which is
       * all five of them: `applySetupToWorld` seats through
       * `effectiveOpponents`, whose whole documented job is re-asserting the
       * singular `aiFaction`/`difficulty`/`personality` mirror ONTO ENTRY 0
       * because "when they disagree the SINGULAR fields win". Seat 1 would
       * have gone on taking the lobby's army with the array saying otherwise.
       *
       * Before this, `soviets.02.common-standard` — whose dialogue names the
       * enemy "Allied" four times and whose relief waves spawn literal
       * `grizzly`/`javelin` — was fought against whatever the player last
       * selected on the skirmish screen. `difficulty` is deliberately still the
       * lobby's: that is the player's choice about how hard the match is, and
       * `armOperation` is already handed it for the medal.
       */
      aiFaction: keyOf(op.foe as number) ?? this.setup.aiFaction,
      // ONE OPPONENT PER EXTRA SEAT. `armyCount(setup)` is what `bootGame`
      // hands `setPlannedArmies` and what `saveContext` records, so a
      // four-seat operation whose setup says two would level ground for two —
      // the defect `SaveContext.armies` exists to close, reintroduced through
      // a different door.
      opponents: Array.from({ length: Math.max(1, op.map.armies - 1) }, (_, i) => ({
        faction: keyOf(op.foe as number) ?? this.setup.aiFaction,
        difficulty: this.setup.difficulty,
        personality: -1,
        // NO TEAM, DELIBERATELY. Every shipped operation is two armies, so this
        // is one seat and the question does not arise; an operation that grows
        // a third should declare its own alliances next to `foe`, not inherit
        // whatever the skirmish lobby was last left holding.
        team: defaultTeamFor(i),
      })),
    };

    await this.startMatch(setup, { persist: false });
    if (this.state !== 'playing' || this.game === null) {
      await this.abandonOperation();
      throw new Error('The operation could not be started.');
    }
  }

  /**
   * Clear every latch an operation set.
   *
   * CALLED ON WIN, LOSS, RETRY, ABANDON AND QUIT. A latch with no clearing
   * branch is a permanent behaviour change wearing a temporary name, and
   * `suppressUnlockGate` leaked exactly once and left every later skirmish
   * ungated. `startMatch` clears `suppressProgression` for any ordinary launch
   * as a second line of defence; this is the first.
   *
   * The import is `await`ed rather than held, so abandoning without ever having
   * started one costs nothing and fetches nothing.
   */
  async abandonOperation(): Promise<void> {
    if (this.operation === null) return;
    this.operation = null;
    suppressProgression(false);
    const install = await import('../campaign/campaign-install');
    install.disarmOperation();
  }

  /** The finished operation. Pushed immediately before `endMatch`; see there. */
  publishCampaignResult(result: {
    operationId: string;
    medal: number;
    reason: string;
    objectives: readonly CampaignObjectiveRow[];
  }): void {
    const op = this.operation;
    if (op === null || op.id !== result.operationId) return;
    this.campaignResult = {
      operationId: op.id,
      title: op.title,
      chapterTitle: op.chapterTitle,
      nextOperationId: op.nextId,
      nextOperationTitle: op.nextTitle,
      medal: result.medal,
      reason: result.reason,
      objectives: result.objectives,
    };
    // THE ONLY PLACE AN OPERATION IS RECORDED, and it is here rather than in
    // `endMatch` because this is where the medal arrives — `campaign.system.ts`
    // grades it against the difficulty the match was actually played at, and a
    // caller that recomputed it would need a second copy of `medalFor`.
    //
    // No outcome branch: medal 0 (a loss) writes nothing and returns false.
    // Monotonic: replaying on Easy cannot take a gold away.
    progression.recordCampaignOperation(op.id, result.medal);
  }

  /** The difficulty a medal is graded against. Read by `campaign.system.ts`. */
  matchDifficulty(): number {
    return this.setup.difficulty;
  }

  /** What the campaign wants shown: dialogue, EVA announcements and directed camera beats. */
  playCampaignBeat(event: {
    kind: string;
    speaker?: string;
    text?: string;
    line?: string;
    at?: { readonly x: number; readonly z: number };
  }): void {
    /*
     * THIS METHOD IS THE ONLY CONSUMER OF `PresentationEvent`, AND IT HANDLED
     * ONE OF THE THREE KINDS THAT ARE PRODUCED.
     *
     * `EffectSink` pushes exactly three — `dialogue`, `eva` and `camera`
     * (`runtime.ts`, the three `present.push` calls). `campaign.system.ts`
     * drains all of them and hands every one here. Until 2026-08-19 the body
     * below was an `if` on `dialogue` alone, under a doc comment that said
     * "Dialogue and EVA for now", so **every scripted announcer line and every
     * scripted camera move in all thirteen shipped operations was authored,
     * validated by `validateCampaign`, evaluated by the Director, buffered,
     * drained — and dropped on this line.** `validate.ts` even refuses an
     * `eva` naming a line that is not a key of `EVA_LINES`, on the stated
     * grounds that "the announcer would say nothing"; the announcer was saying
     * nothing regardless of the name.
     *
     * Nothing could have noticed. The effects are silent by nature, the sim
     * half is provably correct, `npm run shots` never boots an operation, and
     * a dropped beat leaves no trace in any log. **A switch with a `default`
     * that throws is the fix for the NEXT one** — the whole union is handled
     * here now, and `tests/campaign-presentation.spec.ts` compares the kinds
     * `runtime.ts` pushes against the kinds this body names, in both
     * directions, so adding a fourth breaks a test rather than going quiet.
     */
    switch (event.kind) {
      case 'dialogue': {
        if (event.text === undefined) return;
        // The HUD owns the surface and the shell owns the presentation lookup.
        // Keep the seam structural: a headless campaign has no HUD, and a build
        // with an older HUD still receives the line through the toast fallback.
        const g = globalThis as unknown as {
          __vmHud?: {
            campaignDialogue?: (message: {
              speaker: string; role: string; portrait: string; monogram: string;
              theme: 'allies' | 'neutral' | 'pact' | 'reclamation' | 'soviets'; text: string;
            }) => void;
            toast?: (...a: unknown[]) => void;
          };
        };
        /*
         * A UNIQUE KEY PER LINE, AND KEYING ON THE SPEAKER DESTROYED TEXT.
         *
         * `ToastStack.push` coalesces on `key` within `TOAST_MERGE` (6 s) and
         * OVERWRITES the detail node — correct for its designed use, which is a
         * repeat of one event ("Unit lost", x3). Its own doc says to pass
         * "whatever makes two of them the same thing". **Two different lines of
         * dialogue are not the same thing**, and this passed
         * `campaign-${speaker}`, so a speaker with two lines inside six seconds
         * had the FIRST ONE SILENTLY REPLACED by the second and an "x2" badge
         * put on it. Nearly every shipped operation opens with two or three
         * lines from one voice on adjacent ticks, so most of them were losing
         * their opening sentence — found by an adversarial verifier reading
         * `Chrome.ts`, because the surviving line looks perfectly correct.
         *
         * The dedicated campaign surface now queues authored lines and keeps a
         * capped transmission log. The monotonic key remains for the headless
         * and older-HUD fallback, where dialogue still lands in ToastStack and
         * therefore still needs protection from coalescing.
         *
         * It lives on the shell rather than in `Chrome.ts` because the merge
         * rule is right for every other toast caller.
         */
        this.campaignBeatSeq++;
        const speaker = campaignSpeaker(event.speaker ?? 'Transmission');
        if (g.__vmHud?.campaignDialogue !== undefined) {
          g.__vmHud.campaignDialogue({
            speaker: event.speaker ?? speaker.name,
            role: speaker.role,
            portrait: speaker.portrait,
            monogram: speaker.monogram,
            theme: speaker.theme,
            text: event.text,
          });
        } else {
          g.__vmHud?.toast?.(
            'info',
            `campaign-${event.speaker ?? 'line'}-${this.campaignBeatSeq}`,
            event.speaker ?? '',
            event.text,
          );
        }
        return;
      }
      case 'eva': {
        if (event.line === undefined) return;
        /*
         * THE FREE FUNCTION, NOT `world.audio.eva`. The port on the world
         * takes a `PlayerId` and filters to the local one, because the sim
         * calls it for whoever the event belongs to. A campaign beat is
         * addressed to the person at the keyboard by construction — there is
         * no other seat to mistake it for — so the extra argument would be a
         * player id invented to satisfy a filter that has nothing to filter.
         *
         * It is a no-op before the audio module boots (`facade` is null), and
         * `Eva.say` returns false on an unknown id rather than throwing, so
         * this is silent in a headless harness and in a muted profile alike.
         */
        sayEva(event.line);
        return;
      }
      case 'camera': {
        if (event.at === undefined) return;
        /*
         * SMOOTH, NOT IMMEDIATE. `setFocus`'s third argument snaps, and a snap
         * is right for "centre on my base" off a hotkey and wrong for a
         * scripted beat — the player has to be able to tell that the camera
         * moved rather than that the map cut. The rig's own easing is what
         * makes a `cameraMove` read as direction instead of teleportation.
         */
        this.game?.ctx.cameraRig.setFocus(event.at.x, event.at.z);
        return;
      }
      default:
        // Deliberately silent rather than throwing: `PresentationEvent.kind`
        // also declares `objectives` and `ended`, which nothing pushes today
        // and which reach the shell by their own dedicated methods. Throwing
        // here would turn a future producer into a crash mid-match; the spec
        // named above turns it into a red build instead.
        return;
    }
  }

  /** The chapter list. */
  openCampaign(): void {
    this.show(new CampaignScreen(this), 'campaign');
  }

  /** One operation's briefing. */
  openBriefing(operationId: string): void {
    this.show(new BriefingScreen(this, operationId), 'briefing');
  }

  /**
   * Re-launch the operation that just ended, from the briefing.
   *
   * RETRY IS THE MOST-PRESSED BUTTON IN ANY CAMPAIGN and it must not cost a
   * lobby round trip. `startOperation` disarms first, so this is safe to call
   * from the end screen with an operation still armed.
   */
  async retryOperation(): Promise<void> {
    const id = this.operation?.id ?? null;
    if (id === null) return;
    await this.startOperation(id);
  }

  /** The operation that is running, or null. Read by the end screen. */
  activeOperationId(): string | null {
    return this.operation?.id ?? null;
  }

  private clearReplay(): void {
    const bar = this.replay?.bar ?? null;
    bar?.dispose();
    this.replay = null;
    this.replayComplete = false;
    this.replayPaused = false;
    preparePlayback(null);
    suppressUnlockGate(false);
    suppressProgression(false);
    // THE OPERATION A CAMPAIGN REPLAY ARMED IS A LATCH LIKE THE OTHER TWO.
    // Left standing, the next skirmish boots with the operation's roster,
    // layout and outcome policy in force — and `suppressUnlockGate` leaked
    // exactly once already, which is why this is not left to `startMatch`.
    if (this.operation !== null) void this.abandonOperation();
  }

  /**
   * Keep the recording of the match that is ending.
   *
   * The engine that owns the recorder is disposed seconds later by whatever
   * happens next, and until then nobody has asked the player whether they want
   * it. So it is taken unconditionally and offered on the Replays screen —
   * which is the same reasoning `replay.system.ts` gives for recording every
   * match in the first place: the one thing a player never has when they want a
   * replay is foresight.
   *
   * NOT taken for the title backdrop (not a match) or during playback (it would
   * replace the recording being watched with a re-recording of itself).
   */
  private captureReplay(): void {
    if (this.game === null || this.backdrop || this.replay !== null) return;
    try {
      const file = currentReplay();
      if (file !== null && file.commands.length + file.checks.length > 0) {
        this.lastReplay = file;
      }
    } catch (err) {
      // A build with the replay system removed, or a match torn down under us.
      // Losing the recording is not a reason to fail the thing that was
      // actually happening.
      console.warn('[shell] the match recording could not be kept', err);
    }
  }

  /**
   * Rewrite the boot flags a recording has to reproduce.
   *
   * WRITTEN OVER `buildMatchQuery`'s OUTPUT rather than instead of it. That
   * function derives map, biome and landform from a `MapChoice`, which is a
   * lobby concept a recording does not have — it has the four flags the ENGINE
   * modules actually parse, recorded as they were parsed. So the lobby builds
   * a plausible query and this replaces the parts that must be exact.
   */
  /**
   * Force the boot flags an operation declares, exactly as a replay does.
   *
   * `buildMatchQuery` derives `map`/`biome`/`mapseed` from a `MapChoice` — a
   * LOBBY row, which an operation is not. The campaign names a `MAP_PRESETS`
   * key directly, so its flags are written over the top here, on the same line
   * of `bootGame` the replay and tutorial overrides live on.
   *
   * `start` is deliberately NOT set: the opening reaches the generator through
   * `setPlannedOperation`, which both start-forcing sites in `Scenarios.ts`
   * read. Writing `?start=` as well would be a second channel saying the same
   * thing, and the two would eventually disagree.
   */
  private applyCampaignQuery(query: URLSearchParams, boot: OperationBoot): void {
    query.set('map', boot.preset);
    query.set('biome', boot.biome);
    query.set('mapseed', String(boot.mapSeed | 0));
    query.set('seed', String(boot.simSeed >>> 0));
  }

  private applyReplayQuery(query: URLSearchParams, header: ReplayFile['header']): void {
    if (header.mapPreset !== '') query.set('map', header.mapPreset);
    if (header.biome !== '') query.set('biome', header.biome);
    if (header.art !== '') query.set('art', header.art);
    query.set('mapseed', String(header.mapSeed | 0));
    query.set('seed', String(header.simSeed >>> 0));
    // The opening. `?start=` is the only channel that outranks the stored
    // per-client preference — see `chooseStart` in game/Scenarios.ts — and it
    // is outranked in turn only by `?ai=off`, which a replay boot never sets.
    if (header.start !== '') query.set('start', header.start);
  }

  /**
   * Tear the current match down and launch a new one.
   *
   * `persist` is the lobby's default: the configuration the player just chose
   * becomes the one the next launch starts from. The tutorial passes false —
   * it forces its own map, difficulty and seed, and writing those over the
   * lobby's settings would silently reset a player's skirmish preferences as
   * the price of opening a help screen.
   */
  async startMatch(setup: MatchSetup, options: { persist?: boolean } = {}): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    // The gate is suppressed by PvP and by playback, and only those two know
    // when it should come back. Anything else launching a match is by
    // definition an ordinary one, so this is the single place that restores it
    // — without it, one replay left every later skirmish ungated.
    if (this.pvp === null && this.replay === null) suppressUnlockGate(false);
    // Progression's latch restores on the same condition and for the same
    // reason — PvP and playback are the two routes that set one, and an
    // ordinary launch is the one place that can know it is ordinary. PvP never
    // sets this one, so in practice this clears after a replay and after an
    // operation; it is written against the same predicate so the two latches
    // cannot drift apart.
    // A CAMPAIGN OPERATION IS THE THIRD ROUTE THAT SETS IT, AND OMITTING IT
    // HERE UNDID THE LATCH ON THE LINE AFTER IT WAS SET.
    //
    // `startOperation` sets `suppressProgression(true)` and then calls this
    // method, which is the ordinary-launch restore point — and with `pvp` and
    // `replay` both null for a campaign, the condition was true and cleared it
    // immediately. `beginMatch` then ran, the profile counted a scripted
    // operation's authored kills and ore, and the end screen showed a "Rewards
    // Earned" panel with four unlocks in it. Found by LOOKING AT THE SCREEN of
    // a real boot; every test agreed with the broken build, because
    // `inMatch()` reads false after `endMatch` whether the match was
    // suppressed or merely finished.
    if (this.pvp === null && this.replay === null && this.operation === null) {
      suppressProgression(false);
    }
    // BEFORE the first await, deliberately. `requestFullscreen` needs transient
    // user activation, and every await between the click and the call spends
    // more of that window — `bootGame` below is seconds of shader compilation.
    goFullscreen();
    try {
      const keys = playableFactions().map((f) => f.key);
      this.setup = options.persist === false
        ? normalizeSetup(setup, keys)
        : this.settings.setSetup(setup, keys);
      const seed = this.setup.seed === 0 ? rollSeed() : this.setup.seed;
      this.activeSeed = seed;
      const map = mapById(this.setup.map);

      /*
       * AN OPERATION NAMES ITSELF HERE. THE BATTLEFIELD DOES NOT.
       *
       * `startOperation` sets `setup.map` to the lobby row whose PRESET matches
       * the operation's, deliberately, so that every label reading `setup.map`
       * at least describes the right ground — its own comment says so. But the
       * label is still a skirmish battlefield's name, and a player who just
       * clicked "First Tap" on the briefing screen was shown a curtain reading
       * AIRBASE FLATS. Observed on a real boot; nothing in the suite looks at
       * this string.
       *
       * `this.operation` is written before `startMatch` is called on all three
       * paths that arm one (launch, replay, restored save), so this is a plain
       * read rather than an ordering assumption — and it carries the chapter,
       * which lets the curtain use the same two-level heading the briefing
       * screen does. The kicker gives up the word "Loading"; the bar and
       * "Initialising" underneath it already say that, twice.
       */
      const curtain = curtainLabels(this.operation, map.name);
      const operationBrief = this.operation === null ? null : campaignBriefing(this.operation.id);
      const operationTheme = this.operation === null ? null : campaignTheme(this.operation.id);
      const loadingCommand = operationBrief === null || operationTheme === null ? null : {
        commander: operationBrief.commander,
        directive: operationBrief.directive,
        theme: operationTheme,
      };

      this.show(
        new LoadingScreen(
          curtain.heading,
          factionByKey(this.setup.playerFaction)?.name ?? '',
          this.settings.get().controls.bindings,
          curtain.kicker,
          loadingCommand,
        ),
        'loading',
      );
      // Two frames so the loading screen is actually painted before the boot
      // blocks the main thread on shader compilation.
      await nextFrames(2);

      await this.bootGame(seed, false);
      this.verifyArmies();
      this.matchStartMs = performance.now();
      this.outcomeAccum = 0;
      this.autosaveAccum = 0;
      // A new match is a new schedule. The rotation cursor deliberately does
      // NOT reset — see `AutosaveScheduler.reset` — so restarting twice does
      // not keep overwriting the same slot.
      this.autosave.reset(0);
      this.result = null;

      // Open the mission board. AFTER the boot, deliberately: the world is what
      // decides which player slot the human occupies and which faction id that
      // slot ended up with, and a tracker told the lobby's intent instead would
      // credit an Allied objective to a Soviet match on any scenario that seats
      // the human anywhere but slot 0.
      //
      // NOT FOR A REPLAY. Watching a recording is not playing a match: it must
      // not count towards "play 10 skirmishes", must not complete an objective
      // a second time, and must not hand out a reward the player already
      // earned when they actually played it. `beginMatch` is what starts all
      // three, so a replay simply never opens the board.
      const world = this.game?.ctx.world;
      if (world !== undefined && this.replay === null) {
        const local = world.localPlayer as number;
        progression.beginMatch({
          seed,
          localPlayer: local,
          faction: world.player(world.localPlayer).faction as number,
          difficulty: this.setup.difficulty,
        });
      }

      this.setHudVisible(true);
      this.show(null, 'playing');
      // LAST, and only ever on a profile that has never been calibrated. The
      // measurement needs a live renderer drawing a real scene, which is true
      // from exactly here onwards.
      this.maybeCalibrate();
    } catch (err) {
      // An in-page rebuild is the fast path, not the only path. If disposing
      // and re-bootstrapping onto the same canvas fails for any reason, fall
      // back to a cold boot at the same URL — the player gets a loading screen
      // instead of a dead menu. Guarded against looping: a boot that ALREADY
      // came in through `?skipmenu=1` reports the error instead of reloading.
      if (this.options.skipMenu !== true && !this.hardLaunched) {
        console.error('[shell] in-page match boot failed — falling back to a cold boot', err);
        this.hardLaunch();
        return;
      }
      this.fail('Match Failed To Start', err);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Did every army the lobby seated actually get something to play with?
   *
   * A TRIPWIRE, NOT A FIX, and it exists because the failure it catches is
   * silent and fatal. This shell seats the armies; `src/game/Scenarios.ts` gives
   * them their opening (a base, or a construction vehicle and an escort). Those
   * are two halves of one contract with nothing forcing them to agree, and if
   * the scenario builds fewer openings than there are armies, the extras start
   * with NOTHING — which the outcome rules read as "already beaten", so the
   * match ends in an unearned victory about eighteen seconds in, with no error
   * anywhere and a player who has no idea why.
   *
   * It warns rather than refusing for the same reason the scenario module never
   * throws: a playable-but-wrong match is something a bug report can describe,
   * and a dead menu is not.
   */
  private verifyArmies(): void {
    const game = this.game;
    if (game === null) return;
    const world = game.ctx.world;
    const alive = countLivingAssets(game);
    const empty = world.players.filter(
      (p) => p.faction !== Faction.Neutral && (alive.get(p.id as number) ?? 0) === 0,
    );
    if (empty.length === 0) return;
    console.error(
      `[shell] ${empty.length} seated army/armies opened with no units and no buildings — `
      + empty.map((p) => `p${p.id as number} "${p.name}"`).join(', ')
      + '. The scenario built fewer openings than the lobby seated armies; the match will '
      + 'resolve as soon as the beaten grace expires. See Shell.verifyArmies.',
    );
  }

  /**
   * Restart the current match with a fresh seed.
   *
   * A TUTORIAL RUN RESTARTS AS A TUTORIAL RUN. The pause menu's Restart Battle
   * is reachable from a tutorial, and routing it through the plain path would
   * have broken the feature twice over: `seed: 0` rolls a NEW seed, so a
   * first-time player would get terrain the steps were not written against; and
   * nothing would call `beginObserving` on the second boot, leaving a live
   * director attached to a match with its card hidden and no lesson running.
   * `startTutorial` does both correctly, and re-reads the stored progress so
   * the restart resumes where a replay would.
   */
  async restartMatch(): Promise<void> {
    if (this.tutorial !== null) {
      await this.startTutorial();
      return;
    }
    // A REPLAY RESTARTS AS A REPLAY, from the top. Routing it through the plain
    // path would roll a fresh seed and boot an ordinary skirmish out of a
    // button labelled "Restart Battle" on a screen that says Replay.
    const watching = this.replay;
    if (watching !== null) {
      await this.startReplay(watching.file);
      return;
    }
    await this.startMatch({ ...this.setup, seed: 0 });
  }

  /**
   * Launch the beginner tutorial: a real match with a director watching it.
   *
   * THREE THINGS ARE FORCED AND EACH ONE COSTS SOMETHING, so they are all
   * stated here rather than buried in `tutorialSetup`:
   *
   *   - A FIXED SEED and the starter map, so the terrain a step describes is
   *     the terrain the player has. `MapChoice.mapSeed` already pins the
   *     landscape; `TUTORIAL_SEED` pins the sim.
   *   - `?start=mcv`, written onto the query in `bootGame`. The tutorial's
   *     third step is "deploy the construction vehicle", which does not exist
   *     in a pre-built-base opening, and `?start=` on the URL is the only
   *     channel that outranks whatever the lobby last chose.
   *   - THE OPPONENT STAYS AWAKE, on Easy and Turtle. This is the compromise
   *     worth knowing about: `Scenarios.chooseStart` treats `?ai=off` as an
   *     unconditional request for a pre-built base — rule 1 of four, above
   *     `?start=` — so a tutorial with the AI switched off would have no MCV
   *     to deploy. The least aggressive live opponent available is therefore
   *     what ships. See the module report for the `?ai=idle` flag that would
   *     let this be both.
   */
  async startTutorial(): Promise<void> {
    if (this.busy || this.disposed) return;

    this.tutorial?.dispose();
    const director = new TutorialDirector({
      settings: this.settings,
      // Both endings land in the same place: the title screen. `quitToMenu`
      // rather than `showMenu`, because a tutorial run is a real match and
      // abandoning it must not count as one played.
      onEnded: () => { void this.quitToMenu(); },
    });
    director.publish();
    this.tutorial = director;

    await this.startMatch(tutorialSetup(this.setup), { persist: false });

    // Only now does the director start believing what it sees. `bootGame`
    // finishes by jumping the camera onto the player's base, and a director
    // observing through that jump would credit the player with the whole
    // camera lesson before they had touched anything.
    if (this.state === 'playing' && this.tutorial === director) {
      director.beginObserving();
    } else if (this.tutorial === director) {
      // The boot failed and `startMatch` has already taken its own recovery
      // path. Do not leave a published director feeding nothing.
      director.dispose();
      this.tutorial = null;
    }
  }

  /** True while a tutorial run is live. */
  isTutorial(): boolean {
    return this.tutorial !== null;
  }

  /**
   * Open the pause menu. No-op unless a match is running.
   *
   * `settings` is a legal source as well as `playing`: the options screen
   * opened from a paused match returns here, and at that moment the state is
   * `settings` even though the match underneath is still frozen.
   */
  pause(): void {
    if (this.game === null || this.backdrop) return;
    // `missions` joins `settings` for the same reason: it is a sub-screen the
    // pause menu can route to, and closing it has to land back on the pause
    // menu rather than on a blank layer over a frozen match.
    if (this.state !== 'playing' && this.state !== 'settings' && this.state !== 'missions') return;

    // THE MENU OPENS; THE SIMULATION DOES NOT STOP. There is no such thing as
    // pausing a lockstep match from one side — the other player is still
    // playing, and their frames still have to be executed or this client falls
    // behind and stalls the pair. So a PvP pause is a menu over a running game,
    // and the camera stays live so the player can still see what is happening
    // to them while they decide whether to quit.
    if (this.pvp !== null) {
      this.show(new PauseMenuScreen(this), 'paused');
      return;
    }

    this.game.setPaused(true);
    // Freeze the camera too. A pause menu you can pan the battlefield behind
    // is a pause menu that reads as a bug.
    this.game.ctx.cameraRig.setInputEnabled(false);
    this.setHudVisible(false);
    this.show(new PauseMenuScreen(this), 'paused');
  }

  /** Close the pause menu and hand control back to the match. */
  resume(): void {
    if (this.state !== 'paused' || this.game === null) return;
    this.show(null, 'playing');
    this.setHudVisible(true);
    // In PvP neither of these was ever turned off — see `pause`.
    if (this.pvp !== null) return;
    this.game.ctx.cameraRig.setInputEnabled(true);
    // A replay the viewer had stopped — or one that has run out — stays
    // stopped. Closing a menu is not a request to start it.
    this.game.setPaused(this.replay !== null && this.replayPaused);
  }

  togglePause(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  /**
   * Finish the match and show the results.
   *
   * Public so a real victory module can call it from a `match:ended` handler
   * instead of racing the shell's own poll.
   */
  /**
   * Show the end screen.
   *
   * A caller may hand over a FULL `MatchResult`, or just `{ won }` — every
   * other field is read off the live world by `buildResult`, which is what the
   * shell's own outcome poll uses. A victory module should not have to
   * assemble ten fields (and a partially filled object used to throw inside
   * `resultCells`, which is a poor contract for a public API).
   */
  endMatch(result: Partial<MatchResult> & { won: boolean }): void {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    // A RECORDING HAS NO RESULT. Nobody won anything by watching, and the end
    // screen's first act is to drain the pending-reward queue — so a replay
    // that ran to a wipe-out would hand the viewer the medals a second time.
    // `pollOutcome` already skips playback; this is the guard for anyone else
    // who calls the public method.
    if (this.replay !== null) return;
    this.captureReplay();
    const base: MatchResult = this.game === null
      ? {
        won: result.won, durationSec: 0, wallSec: 0,
        stats: { ...Shell.EMPTY_STATS }, credits: 0,
        factionName: factionByKey(this.setup.playerFaction)?.name ?? '',
        opponentName: factionByKey(this.setup.aiFaction)?.name ?? 'Opponent',
        mapName: mapById(this.setup.map).name,
        difficulty: this.setup.difficulty,
        // NO WORLD TO READ, so no per-seat truth to publish. `opponentChips`
        // falls back to the singular pair above rather than dropping the chip.
        opponents: [],
        speed: GAME_SPEEDS[this.setup.speed] ?? 1,
      }
      : this.buildResult(result.won);
    const full: MatchResult = { ...base, ...result };
    this.result = full;

    // ORDER IS LOAD-BEARING. `endMatch` is what latches the win, completes the
    // last objectives and pushes their rewards onto the pending queue; the end
    // screen drains that queue exactly once, in its constructor. Constructing
    // the screen first would show an empty reward reveal for rewards the player
    // earned in the final second of the match, and the rewards would then be
    // orphaned until the next launch picked them up as "unrevealed".
    progression.endMatch({ won: full.won, durationSec: full.durationSec });
    progression.flushProfile();

    this.game?.setPaused(true);
    this.setHudVisible(false);
    this.show(new EndScreen(this, full), 'ended');
  }

  /** Drop the current match and return to the title screen. */
  async quitToMenu(): Promise<void> {
    if (this.busy) return;
    // Tell the relay BEFORE tearing anything down. A client that simply stops
    // answering makes its opponent sit through the full grace period staring at
    // a countdown; leaving cleanly ends it for them at once.
    if (this.pvp !== null) {
      this.pvp.session.leave();
      this.pvp = null;
    }
    // Before the teardown, and in this order: keep the recording of the match
    // being abandoned, then drop any recording that was driving it. The first
    // is a no-op during playback and the second is a no-op outside it.
    this.captureReplay();
    this.clearReplay();
    this.busy = true;
    try {
      // Abandon, not end. The player gets to keep every profile mission they
      // advanced on the way — those write through the moment they complete —
      // but the match objectives are dropped and nothing counts as played, so
      // quitting is never a way to farm a "play 10 matches" row.
      progression.abandonMatch();
      progression.flushProfile();
      await this.openMenu(false);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Return to the title screen WITHOUT touching what is rendering.
   *
   * This is the "back out of a sub-screen" path. `quitToMenu` is the "abandon
   * the match" path — they look the same to the player and are entirely
   * different to the engine.
   */
  showMenu(): void {
    void this.openMenu(false, true);
  }

  /** Open the skirmish lobby. */
  openSetup(): void {
    this.show(new SkirmishSetupScreen(this), 'setup');
  }

  /** Open the multiplayer lobby. Shares the `setup` state — same place in the flow. */
  openMultiplayer(): void {
    this.show(new MultiplayerSetup(this), 'setup');
  }

  /** Open the options. `returnTo` is where Back goes. */
  openSettings(returnTo: ShellState = 'menu'): void {
    this.show(new SettingsScreen(this, returnTo), 'settings');
  }


  /**
   * Open the missions and unlocks board.
   *
   * Reachable from the title screen and from the pause menu, and it renders
   * with no progression handle at all, so the route is safe under the
   * `?shot=` harness. Profile file management lives in Settings.
   */
  openMissions(returnTo: ShellState = 'menu'): void {
    this.show(new MissionsScreen(this, () => {
      if (returnTo === 'paused') this.pause();
      else this.showMenu();
    }), 'missions');
  }

  /* ---------------------------------------------------------------------- */
  /* Saved games                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Open the save-slot list.
   *
   * `MainMenu` only offers this when `saveSlots()` is non-empty, so the screen
   * is never entered empty — but it renders an empty state anyway, because a
   * player can delete the last slot without leaving it.
   */
  openLoadGame(): void {
    this.show(new LoadGameScreen(this), 'load');
  }

  /**
   * Everything a restore has to reproduce before the snapshot goes over it.
   *
   * Null when there is no live match, which is also what makes it the honest
   * "can I save right now" test for the pause menu.
   */
  saveContext(): SaveContext | null {
    if (this.game === null || this.backdrop) return null;
    // A replay is not a position to come back to — restoring one would give the
    // player a live match seeded from somebody else's recording, with the
    // playback that made it meaningful nowhere in the snapshot.
    if (this.replay !== null) return null;
    return {
      mapId: this.setup.map,
      playerFaction: this.setup.playerFaction,
      aiFaction: this.setup.aiFaction,
      difficulty: this.setup.difficulty,
      speed: this.setup.speed,
      seed: this.activeSeed,
      // The number `bootGame` handed `setPlannedArmies`, so a restore can plan
      // the same ground. Read off the setup rather than off `world.players`,
      // for the same reason `bootGame` does: the player table includes the
      // Neutral slot a skirmish always seats.
      armies: armyCount(this.setup),
      // Absent for a skirmish. `contextOf` treats absent and empty alike, and
      // `requireMatchingWorld` only compares when both sides name one.
      campaignOperationId: this.operation?.id,
    };
  }

  /**
   * True when a manual save would actually do something.
   *
   * FALSE DURING THE TUTORIAL, deliberately. A tutorial run forces its own map,
   * seed and opening (`?start=mcv` on the URL) and is driven by a director that
   * lives outside the world entirely; a snapshot of it would restore the
   * battlefield without the lesson, which is a broken save rather than a
   * missing one.
   */
  canSave(): boolean {
    if (this.saveContext() === null) return false;
    if (this.tutorial !== null) return false;
    const svc = saveService();
    if (svc === null) return false;
    try {
      return svc.canSave();
    } catch {
      return false;
    }
  }

  /**
   * Write a named save. Rejects — the caller SHOWS the message.
   *
   * `slotId` overwrites an existing slot; omit it for a fresh one. The
   * thumbnail is requested here and only here: a manual save happens from the
   * pause menu, where the sim is already frozen, so the GPU->CPU readback costs
   * a player nothing. Autosave asks for no thumbnail at all — see the header of
   * `LoadGame.ts`.
   */
  async saveGame(label: string, slotId?: string): Promise<SaveSlotMeta> {
    const svc = saveService();
    const context = this.saveContext();
    if (svc === null) throw new Error('The save system is not available in this build.');
    if (context === null) throw new Error('There is no match to save.');
    if (this.tutorial !== null) throw new Error('A tutorial run cannot be saved.');
    if (this.saving) throw new Error('A save is already in progress.');

    this.saving = true;
    const started = performance.now();
    try {
      // `unwrap` is what makes a refusal-by-value fail loudly. Without it a
      // store that returns `{ok:false, reason}` instead of rejecting would have
      // the panel print "Saved" over a save that never happened.
      const meta = unwrap(await svc.save({
        kind: 'manual',
        label,
        context,
        slotId,
        thumbnail: true,
      }));
      this.lastSaveMs = performance.now() - started;
      this.lastSaveBytes = meta.bytes;
      return meta;
    } finally {
      this.saving = false;
    }
  }

  /**
   * Restore a slot: boot the match it was taken in, then replace the world.
   *
   * TWO PHASES, AND IT CANNOT BE ONE. Several engine modules read their
   * configuration straight off the URL at `init()` — the terrain takes
   * `?biome=`/`?mapseed=`, the scenario takes `?map=`/`?seed=` — so the map a
   * save was taken on can only be reproduced by a full re-bootstrap. The
   * snapshot then goes over the top of that world.
   *
   * `persist: false` on the boot is load-bearing: restoring a save from three
   * weeks ago must not silently rewrite the lobby the player last configured.
   *
   * PROGRESSION IS UNTOUCHED. Unlocks and mission completion are a separate
   * persistent profile with its own storage key, and this path writes nothing
   * to it — `startMatch` calls `progression.beginMatch`, which BEGINS tracking
   * a match and cannot rewind a profile.
   */
  async loadGame(slot: SaveSlotMeta): Promise<void> {
    const svc = saveService();
    if (svc === null) throw new Error('The save system is not available in this build.');

    const c = slot.context;
    // ARM BEFORE THE BOOT, for the four reasons `campaign-install.ts`'s header
    // gives — the scenario plan, the layout, the roster and the outcome policy
    // are all read during `bootstrap()`. Skipping it does not merely lose the
    // objectives: the world is generated as a plain skirmish and
    // `restoreSnapshot` then refuses with `world-mismatch` AFTER paying for a
    // whole terrain generation.
    const operationId = c.campaignOperationId ?? '';
    if (operationId !== '') {
      const install = await import('../campaign/campaign-install');
      const op = install.armOperation(operationId, c.difficulty);
      if (op === null) {
        throw new Error(
          `This save is campaign operation "${operationId}", which this build no longer has.`,
        );
      }
      this.operation = {
        id: op.id,
        title: op.title,
        chapterTitle: install.chapterOf(op)?.title ?? op.chapter,
        // A replay or a restored save has nowhere onward to offer.
        nextId: null,
        nextTitle: null,
        map: op.map,
      };
      suppressProgression(true);
    }
    await this.startMatch({
      ...this.setup,
      map: c.mapId,
      playerFaction: c.playerFaction,
      aiFaction: c.aiFaction,
      difficulty: c.difficulty,
      speed: c.speed,
      seed: c.seed,
      // BOOT WITH THE SEAT COUNT THE SAVE WAS TAKEN AT.
      //
      // THIS USED TO BOOT AS A DUEL WHATEVER THE LOBBY HELD, and the argument
      // for it was half right in a way that hid a real defect. It is true that
      // `restoreSnapshot` calls `world.reset()` and re-seats the whole PLAYER
      // TABLE from the blob, so the opponent list here is only a label. It is
      // false for the GROUND: terrain, roads and scatter are regenerated rather
      // than stored, and `bootGame` reserves one levelled shelf per army in the
      // setup that booted. So a four-way save came back with its bases on a
      // heightfield levelled for two — and `requireMatchingWorld` could not see
      // it, because scenario, map and seed all matched.
      //
      // The same comment also claimed growing `SaveContext` "would invalidate
      // every slot already on disk". It does not: `SaveSlotInfo.extra` is
      // explicitly opaque and `extraOf` now falls back FIELD BY FIELD, so a row
      // written before this degrades to two armies — which is exactly what it
      // already booted as — instead of failing. That sentence was stronger than
      // the code required and it is the reason this went unfixed.
      //
      // `startReplay` is the model and has always done this correctly: it
      // rebuilds `opponents` from every non-Neutral slot in the header,
      // precisely so `armyCount` answers the recording's number.
      opponents: Array.from(
        { length: Math.max(1, c.armies - 1) },
        // The saved world's own `allyMask` is restored per player by
        // `SaveGame`, on top of whatever this boot seated, so the teams a save
        // was taken in survive without `SaveContext` growing a field.
        (_, i) => ({
          faction: c.aiFaction, difficulty: c.difficulty, personality: -1, team: defaultTeamFor(i),
        }),
      ),
    }, { persist: false });

    if (this.state !== 'playing' || this.game === null) {
      throw new Error('The match this save was taken in could not be started.');
    }

    unwrap(await svc.load(slot.id));
    // Restoring moved the tick counter to wherever the snapshot was taken.
    // Re-baselining here is what stops the very next poll from deciding an
    // autosave is forty minutes overdue and firing one immediately.
    this.autosave.reset(this.game.ctx.loop.tick);
    this.autosaveAccum = 0;
  }

  /**
   * Wall milliseconds and bytes of the most recent snapshot this session.
   *
   * Exposed because "the match must not stutter" is a claim that has to be
   * checkable from the console rather than asserted in a comment.
   */
  saveCost(): { readonly ms: number; readonly bytes: number } {
    return { ms: this.lastSaveMs, bytes: this.lastSaveBytes };
  }

  /**
   * Back out of whatever screen is open.
   *
   * Every screen that has a meaningful "back" implements `onBack` and answers
   * for itself — Settings knows whether it was opened from the menu or from
   * the pause menu, and only it can know that. This switch is the fallback for
   * screens that do not.
   */
  back(): void {
    if (this.screen?.onBack?.() === true) return;
    switch (this.state) {
      case 'setup':
      case 'credits':
      case 'settings':
      case 'missions':
      case 'load':
      case 'replays':
        this.showMenu();
        break;
      case 'paused':
        this.resume();
        break;
      case 'playing':
        this.pause();
        break;
      default:
        break;
    }
  }

  /** The last-played configuration, for the lobby's initial values. */
  latestResult(): MatchResult | null {
    return this.result;
  }

  /** Seconds of simulated time elapsed in the running match. */
  matchSeconds(): number {
    return this.game === null ? 0 : this.game.ctx.loop.simTime;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafHandle);
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.screen?.unmount();
    this.screen = null;
    this.tutorial?.dispose();
    this.tutorial = null;
    this.clearReplay();
    if (this.toastTimer !== 0) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = 0;
    }
    this.toastNode = null;
    this.updatePrompt.dispose();
    this.root.remove();
    if (this.game !== null) this.disposeGame(this.game);
    this.game = null;
    if (window.__vmShell === this) delete window.__vmShell;
    if (window.__vmSettings === this.settings) delete window.__vmSettings;
  }

  /* ---------------------------------------------------------------------- */
  /* Screen plumbing                                                        */
  /* ---------------------------------------------------------------------- */

  /** Swap the visible screen. `null` clears it (the match owns the viewport). */
  private show(next: Screen | null, state: ShellState): void {
    this.screen?.unmount();
    this.host.replaceChildren();
    this.screen = next;
    this.state = state;
    this.updatePrompt.onShellState(state);

    if (next !== null) {
      const layer = el('div', 'vm-screen');
      this.host.appendChild(layer);
      next.mount(layer);
      this.ring = new FocusRing(layer);
      // Focus after layout so `offsetParent` is meaningful to the ring.
      requestAnimationFrame(() => {
        if (this.screen === next) this.ring.focusFirst();
      });
    }
    this.root.style.pointerEvents = next === null ? 'none' : '';
    // The replay strip lives on the shell root rather than in a screen, so it
    // survives every transition and has to be told when one covers it. A pause
    // menu over a replay must not have a second row of controls showing
    // through it.
    this.replay?.bar?.setVisible(next === null);
  }

  private setHudVisible(visible: boolean): void {
    this.options.hudRoot.style.visibility = visible ? '' : 'hidden';
  }

  /* ---------------------------------------------------------------------- */
  /* Match lifecycle                                                        */
  /* ---------------------------------------------------------------------- */

  /** Go to the title screen, booting the backdrop match if needed. */
  private async openMenu(firstBoot: boolean, keepBackdrop = false): Promise<void> {
    // The single funnel back to the title, and therefore the single place a
    // tutorial run ends. Done FIRST: the backdrop boot below re-runs
    // `registry.init()`, and a director still published at that moment would
    // be handed the title screen's own match to teach over.
    this.tutorial?.dispose();
    this.tutorial = null;

    this.setHudVisible(false);

    if (!keepBackdrop || this.game === null) {
      this.show(new LoadingScreen('Voltmarch', '', this.settings.get().controls.bindings), 'loading');
      if (!firstBoot) await nextFrames(2);
      try {
        await this.bootGame(rollSeed(), true);
      } catch (err) {
        // A backdrop that fails to boot must not block the menu — the player
        // can still reach settings and start a match over a black screen.
        console.error('[shell] title backdrop failed to boot', err);
      }
    }

    this.show(new MainMenuScreen(this), 'menu');
    this.options.onReady?.();
  }

  /**
   * Tear a running engine down.
   *
   * The system registry is disposed FIRST, deliberately, while `ctx()` is
   * still valid. `GameHandle.dispose()` calls `setGameContext(null)` as its
   * very first statement and only then calls `registry.dispose()`, so any
   * module that reaches for `ctx()` in its own `dispose()` — `sim.features`
   * does, to unregister its five sub-systems — throws, aborts the teardown
   * loop, and leaves the renderer, the post chain and the scene alive on a
   * canvas the next boot is about to claim. Running the registry down here
   * makes the second call inside `dispose()` a no-op (it clears its own list)
   * and the whole sequence completes. See the module report: the real fix is
   * ordering inside Bootstrap, which this agent does not own.
   */
  private disposeGame(game: GameHandle): void {
    try {
      game.ctx.registry.dispose();
    } catch (err) {
      console.error('[shell] a system threw during teardown', err);
    }
    game.dispose();
  }

  /**
   * Reload the page straight into the configured match. The escape hatch for
   * a failed in-page rebuild, and the only code path in the shell that
   * navigates.
   */
  private hardLaunch(): void {
    this.hardLaunched = true;
    const query = buildMatchQuery(
      this.setup,
      this.settings.get(),
      location.search,
      this.setup.seed === 0 ? rollSeed() : this.setup.seed,
    );
    query.delete('shot');
    query.set('skipmenu', '1');
    location.assign(`${location.pathname}?${query.toString()}`);
  }

  /**
   * Dispose whatever is running and bootstrap a fresh engine with the current
   * setup. `backdrop` boots the calm title-screen variant: AI off, camera on
   * rails, HUD hidden.
   */
  private async bootGame(seed: number, backdrop: boolean): Promise<void> {
    this.status(backdrop ? 'Preparing theatre' : 'Building world');

    if (this.game !== null) this.disposeGame(this.game);
    this.game = null;
    this.backdrop = backdrop;

    const settings = this.settings.get();
    const query = buildMatchQuery(this.setup, settings, location.search, seed);
    if (backdrop) {
      query.set('ai', 'off');
      // The menu needs an immediate moving battlefield, not the entire authored
      // architecture catalogue decoded behind an opaque UI. art.buildings uses
      // this private marker to retain the procedural fallback family here.
      query.set('title', '1');
    } else {
      query.delete('title');
    }
    // The tutorial teaches deploying the MCV, so it cannot inherit a lobby that
    // last asked for a pre-built base. `?start=` is the only channel that
    // outranks `setPlannedStart` — see `chooseStart` in game/Scenarios.ts.
    if (!backdrop && this.tutorial !== null) query.set('start', 'mcv');
    // PvP for the same reason, and more sharply: a persisted per-client opening
    // means two players build DIFFERENT WORLDS from the same seed.
    if (!backdrop && this.pvp !== null) query.set('start', 'mcv');
    // Playback is the third case of the same rule and the strictest: every flag
    // the world is built from comes off the recording, including the opening.
    if (!backdrop && this.replay !== null) this.applyReplayQuery(query, this.replay.file.header);
    // A campaign operation is the fourth case of the same rule: the operation
    // declares the ground and the lobby has no say in it.
    if (!backdrop && this.operation !== null) this.applyCampaignQuery(query, this.operation.map);
    // `shot` is the screenshot harness's flag and must never appear here.
    query.delete('shot');
    query.delete('skipmenu');
    history.replaceState(null, '', `${location.pathname}?${query.toString()}`);

    /*
     * THE QUERY IS ONLY NOW TRUE, SO THE TWO PER-BOOT MEMOS THAT READ IT HAVE
     * TO BE DROPPED HERE.
     *
     * `plannedScenario()` and `plannedTerrainInput()` both cache the first
     * answer they give, and both are asked long before this line —
     * `world-warm.system.ts` calls `installWorldWorkers()` at MODULE SCOPE,
     * which calls `plannedTerrainInput()` during import, while the query still
     * holds whatever the page was opened with rather than what the lobby chose.
     *
     * THE BUG THAT WAS, measured on a real match: `MAP_SEAS` is keyed on the
     * map PRESET and reached only through `plannedScenario().sea`, so a stale
     * `?map=` left `sea: null` in the cached terrain input. Booting "Contested
     * Strait" — whose blurb is "A shoreline through the middle. Naval yards
     * earn their cost here" — produced a map the terrain module itself reported
     * as `0% water, 1 region(s)`, against the 24.3% the same generator produces
     * when handed the same preset directly. Both sea maps shipped DRY: four
     * naval structures, nine hulls and two unlock chains were unreachable
     * content in every match anyone actually played. `tests/naval-maps.spec.ts`
     * could not see it because it builds `Terrain` directly and never boots.
     *
     * `resetTerrainPlan()` already existed and was documented "Test seam.
     * Nothing in the game calls this" — that was the defect, stated.
     *
     * `?shot=` fixtures are untouched: they never come through `bootGame`, and
     * they carry their sea on `plan.sea` rather than through `?map=`.
     *
     * Cost when it changes nothing: none. Cost when it does: the prewarm's
     * dispatched job stops matching `terrainGenKey`, `prewarmedTerrain()`
     * resolves `null` by its own documented contract, and the map generates on
     * the main thread — the slow path, which is the right trade against
     * generating the wrong map quickly.
     */
    resetScenarioPlan();
    resetTerrainPlan();

    /*
     * HOW MANY ARMIES THE GROUND IS BUILT FOR — and until this line, NOTHING
     * IN THE PRODUCT EVER SAID.
     *
     * `setPlannedArmies` shipped with its whole contract written out ("THIS IS
     * THE CHANNEL THE TERRAIN READS") and exactly one reference in the repo:
     * its own definition. `plannedArmyOverride()` therefore returned `null` on
     * every boot, `planScenario` clamped to `SKIRMISH_ARMIES_DEFAULT`, and the
     * consequences ran the whole depth of the boot:
     *
     *   `terrain-plan.plannedTerrainInput` reserved TWO levelled start shelves
     *   `PLANS.skirmish.build` called `startSpots(cx, cz, 2, sea)`
     *   `Shell.applySetupToWorld` seated FOUR players regardless
     *
     * So three of the six shipped maps declare `players: 4`, the lobby offers
     * the fourth seat, and armies three and four opened with no units, no
     * buildings and no shelf — measured as `p2 assets=0  p3 assets=0`, an
     * unearned victory about eight seconds in. `verifyArmies()` below is the
     * tripwire written for exactly this, and it fired correctly into a console
     * nobody reads.
     *
     * `tests/archipelago.spec.ts` could not catch it: it passes `{ armies: 4 }`
     * EXPLICITLY, the only caller in the repo that does, so it proved four
     * bases on four islands while stepping straight over the channel a player
     * goes through. A test can be entirely right about the thing it tests and
     * still leave the feature disconnected.
     *
     * HERE AND NOT IN THE LOBBY. The count has to be standing before
     * `bootstrap()` runs, because `world-warm` asks `plannedTerrainInput()` at
     * MODULE SCOPE to prewarm the generator; and it has to be after the two
     * resets above, because those are what let the plan be re-derived at all —
     * the plan is memoised and does not move once read. This is the only line
     * in the boot where both are true.
     *
     * `armyCount(this.setup)` is right for all three launch paths without a
     * branch: the lobby writes `opponents` through `withArmyCount`, PvP seats
     * its lobby the same way, and `startReplay` rebuilds `opponents` from the
     * recording's header before it boots.
     *
     * THE BACKDROP IS THE ONE EXCEPTION. The title screen boots a real world
     * with the AI off purely to have something moving behind the menu, and it
     * inherits whatever the lobby last held — so a player who set up a 4-Way
     * and backed out would have the menu quietly generate and simulate four
     * bases to look at one. Two is what that scene has always been.
     */
    setPlannedArmies(backdrop ? null : armyCount(this.setup));

    const boot: BootOptions = {
      canvas: this.options.canvas,
      hudRoot: this.options.hudRoot,
      menuRoot: this.options.menuRoot,
      debugRoot: this.options.debugRoot,
      shot: null,
      map: query.get('map'),
      art: query.get('art'),
      tier: settings.graphics.tier === 'auto' ? null : settings.graphics.tier,
      seed,
    };

    /*
     * THE DEVICE, BEFORE THE ENGINE. See `main.ts#bootHarness` and
     * `render/renderer.ts#prepareRenderer`: `WebGPURenderer` cannot be
     * constructed synchronously and `bootstrap()` is. It is idempotent per
     * canvas and a no-op on the WebGL path, so every launch route can await it
     * unconditionally — and it is BEFORE `bootstrap`, so the synchronous window
     * between `bootstrap()` and `applySetupToWorld` below is untouched.
     */
    await prepareRenderer(this.options.canvas);

    const game = bootstrap(boot);
    this.game = game;

    // MUST be synchronous: `registry.init()` has already started and runs its
    // continuations in microtasks, so this is the last moment before the
    // scenario module reads the player table and builds the bases.
    this.applySetupToWorld(game, backdrop);

    this.status('Compiling shaders');
    await game.ready;

    /*
     * SIM-VISIBLE STATE LANDS BEFORE THE LOOP STARTS. This was a live
     * determinism bug, not a theoretical one.
     *
     * All of `applyPostBoot` used to run after `await nextFrames(6)` — SIX
     * RENDER FRAMES — so the tick on which the starting bank arrived depended
     * on how long six requestAnimationFrame callbacks took: measured between
     * roughly 3 and 18 ticks. TWO RUNS OF THE SAME SEED ON THE SAME MACHINE
     * ALREADY DIVERGED, because the AI's first spend decision reads a bank that
     * appeared at a different tick each time.
     *
     * The wait is real and stays — `game.scenario` re-asserts its authored
     * camera pose on every frame up to frame 4, so a pose set earlier is
     * silently overwritten. But that is the CAMERA, which is presentation and
     * cannot affect the simulation. Splitting the two is the whole fix: the
     * bank and the game speed are written here, at tick 0, every time.
     */
    this.applySimPostBoot(game, backdrop);
    game.start();

    this.status('Deploying');
    applySettings(this.settings.get(), game);

    await nextFrames(6);
    this.applyCameraPostBoot(game, backdrop);
  }

  /**
   * Push the lobby's choices into the freshly-built world.
   *
   * `ScenarioBuilder` resolves its scripted bases by SLOT rather than by
   * faction, and remaps each base's content to the owner's army, so writing the
   * chosen factions onto the player table is the whole of the lobby — and a
   * mirror match is legal, which is why the AI's faction is no longer refused
   * when it matches the human's.
   *
   * THIS IS WHERE ARMIES THREE AND FOUR COME FROM, AND IT IS THE ONLY PLACE.
   * `Bootstrap.ts` seats exactly two players — one local human, one opponent —
   * and always has; that pair, not `MAX_PLAYERS` (8) and not any array in the
   * sim, is what capped this game at a duel. Everything downstream of the
   * player table was already N-safe: `AiDirector.rebuild` builds one brain per
   * non-human player, `ScenarioBuilder.armySlot(i)` walks the table by index,
   * `world.allyMask` defaults to self-only (so a free-for-all is the DEFAULT
   * diplomacy and needs no code at all), and both outcome polls already loop
   * every hostile. So the fix is to seat the armies the lobby asked for, here,
   * in the one synchronous window between `bootstrap()` returning and the
   * scenario module reading the table.
   *
   * `addPlayer` is the only mutation, and it only ever ADDS: `startMatch`
   * disposes the engine and re-bootstraps, so every boot begins at exactly two
   * seats. There is no path that has to remove one.
   */
  private applySetupToWorld(game: GameHandle, backdrop: boolean): void {
    const world = game.ctx.world;
    if (world.players.length < 2) return;

    if (this.pvp !== null) { this.seatPvpPlayers(game); return; }
    if (this.replay !== null) { this.seatReplayPlayers(game); return; }

    const player = factionByKey(this.setup.playerFaction);
    const human = world.players[0];
    if (player !== undefined) human.faction = player.id;
    human.name = backdrop ? 'Observer' : 'Commander';

    /*
     * THE BACKDROP IS ALWAYS A DUEL. The title screen orbits a live match, and
     * it runs with `?ai=off` so nothing in it is playing — four idle bases
     * behind the menu buys nothing and costs the boot a second of shader work
     * on a screen the player is trying to get past.
     */
    // Through `effectiveOpponents`, not straight off the field: `loadGame`,
    // `startTutorial` and the PvP path all hand `startMatch` a hand-built
    // literal, and the singular mirror fields are the half those write.
    const armies = effectiveOpponents(this.setup);
    const wanted = backdrop ? 1 : armies.length;

    for (let i = 0; i < wanted; i++) {
      const spec = armies[i] ?? armies[0];
      const enemy = factionByKey(spec.faction);
      const slot = i + 1;
      // Slot 1 already exists (Bootstrap seeded it); 2 and up are new. Seating
      // by index rather than pushing blindly keeps this idempotent, which
      // matters because a failed boot can re-enter it on the retry path.
      const id = slot < world.players.length
        ? world.players[slot].id
        : world.addPlayer(enemy?.id ?? Faction.Soviets, 'Opponent', false, false);
      const p = world.player(id);
      if (enemy !== undefined) p.faction = enemy.id;
      // NUMBERED WHEN THERE IS MORE THAN ONE. "Soviet AI" is the right label for
      // the only opponent and an ambiguous one for three, and this name is what
      // the minimap legend, the end screen and the console all read back.
      p.name = wanted > 1
        ? `${enemy?.name ?? 'Opponent'} AI ${i + 1}`
        : `${enemy?.name ?? 'Opponent'} AI`;
      p.isHuman = false;
      p.isLocal = false;
      p.aiDifficulty = spec.difficulty;
      if (spec.personality >= 0) p.aiPersonality = spec.personality;
    }

    /*
     * AND THEN, ONCE, THE DIPLOMACY — THE ONLY WRITER `allyMask` HAS EVER HAD.
     *
     * It goes here because this is where seats exist and nowhere else is: the
     * table is complete on the line above, the scenario has not read it yet,
     * and the mask is sim state that `Checksum.hashPlayers` covers, so it must
     * be standing before tick zero rather than arriving from a menu later.
     *
     * NOT FOR THE BACKDROP. The title screen is always a duel and always
     * `?ai=off`, and a lobby left holding a 2v2 would otherwise put the menu's
     * one opponent on the observer's own team — two armies with nothing to do,
     * which is what the block above spends a paragraph refusing.
     *
     * The PvP and replay paths returned above and neither reaches this: PvP
     * seats exactly two humans who are always enemies, and a replay restores
     * the mask the recording carried, which outranks any lobby.
     */
    if (!backdrop) applyTeams(world, teamsOf(this.setup));

    if (wanted > 1) {
      console.info(
        `[shell] seated ${wanted + 1} armies: `
        + world.players.map(
          (p) => `p${p.id as number} ${p.name} ally=0b${(p.allyMask >>> 0).toString(2)}`,
        ).join(', '),
      );
    }
  }

  /**
   * Seat a PvP match: same world on both clients, different local slot.
   *
   * THREE THINGS HERE ARE LOAD-BEARING AND ONE OF THEM IS NOT OBVIOUS.
   *
   * 1. FACTIONS COME FROM THE RELAY, per slot, identically on both clients.
   *    Neither lobby's local preference is consulted — `this.setup` describes
   *    what THIS player asked for, and the other client asked for something
   *    else.
   *
   * 2. BOTH SLOTS ARE `isHuman`. That is the entire AI shutdown:
   *    `ai.system.ts:165` skips any player where `isHuman || isLocal`, so no
   *    brain is ever built. An AI running on both clients would issue commands
   *    locally on each and desync on the first decision it made.
   *
   * 3. `localPlayer` MOVES, and it is the only asymmetry in the whole world.
   *    Bootstrap pins it to slot 0; client B has to look through slot 1's eyes.
   *    Nothing the checksum hashes depends on it — `hashPlayers` covers credits,
   *    power, storage, defeat, ally mask and queues, and not `isLocal` — so the
   *    two worlds stay identical while the two SCREENS differ.
   */
  private seatPvpPlayers(game: GameHandle): void {
    const pvp = this.pvp;
    if (pvp === null) return;
    const world = game.ctx.world;

    // BOUNDED BY THE RELAY'S OWN SLOT LIST, not by a literal 2. `MatchStart`
    // carries one faction per seated slot and `Session` refuses a frame with
    // fewer than two, so this is the same two slots it has always been for
    // every match the lobby can currently pair — stated as "the slots the relay
    // named" so the number lives in one place instead of two. Nothing else in
    // `src/net/**` is touched by four-army support: the wire already permits 8
    // (`WIRE_LIMITS.maxPlayers`), `validateCommand` is unchanged, and the client
    // still TRIPWIRES rather than filters.
    const seats = Math.min(world.players.length, pvp.info.factions.length);
    for (let slot = 0; slot < seats; slot++) {
      const p = world.players[slot];
      const faction = pvp.info.factions[slot];
      if (faction !== undefined) p.faction = faction as Faction;
      p.isHuman = true;
      p.isLocal = slot === pvp.info.slot;
      // NO PLAYER-SUPPLIED NAMES ANYWHERE IN PVP — see the header of
      // MultiplayerSetup.ts. A name is a string one player controls and the
      // other player's browser renders.
      p.name = slot === pvp.info.slot ? 'You' : 'Opponent';
      p.aiDifficulty = 0;
      p.aiPersonality = 0;
    }
    world.localPlayer = pvp.info.slot as PlayerId;
  }

  /**
   * Seat the world from a recording's header.
   *
   * FOUR THINGS ARE LOAD-BEARING AND THE SECOND ONE IS THE WHOLE FEATURE.
   *
   * 1. FACTIONS COME FROM THE HEADER, per slot. The lobby's choice is not
   *    consulted at all: a recording is a specific match, and the sides in it
   *    are not a preference.
   *
   * 2. EVERY SEATED SLOT IS `isHuman`, and that is the AI shutdown —
   *    `ai.system.ts:165` builds no brain for a human slot. The recording
   *    ALREADY HOLDS the AI's commands, because the brain issues them through
   *    the same bus the player does and the recorder taps the drain. A brain
   *    running here as well would issue a second, near-identical copy of every
   *    decision, and the two streams would fight over the same units.
   *
   * 3. THE NEUTRAL SLOT IS SKIPPED. Gaia owns the rocks, the trees and the
   *    wrecks, is created by `ScenarioBuilder.gaia` during the boot, and is
   *    already excluded from the brain list by faction. Seating it as a human
   *    would be a lie about the world with no effect except to make this
   *    function's contract untrue.
   *
   * 4. THE WORLD IS GROWN TO FIT THE RECORDING. `Bootstrap` seats two, and a
   *    four-way recording has four armies plus Gaia — so without this the third
   *    and fourth armies would not exist, the playback would feed their commands
   *    to nobody, and the checkpoint compare would diverge on the first tick
   *    either of them did anything. Only the LEADING non-Neutral run is seated,
   *    for the reason in (3): Gaia is the last entry in every recorded table
   *    because the scenario creates it during the boot, and it is that getter's
   *    creation path that wires the mutual ally masks. Seating a Neutral slot
   *    here would make it find one already there and wire nothing.
   *
   * `localPlayer` is presentation only — the camera and which side of the fog
   * the viewer is on. `Checksum.hashPlayers` does not hash it, which is exactly
   * why one recording of a PvP match is watchable from either seat.
   */
  private seatReplayPlayers(game: GameHandle): void {
    const file = this.replay?.file;
    if (file === undefined) return;
    const header = file.header;
    const world = game.ctx.world;
    const names = playableFactions();

    // Point 4 in the header: grow to the recording, stopping at Gaia.
    while (world.players.length < header.players.length) {
      const rec = header.players[world.players.length];
      if (rec === undefined || rec.faction === (Faction.Neutral as number)) break;
      world.addPlayer(rec.faction as Faction, 'Opponent', false, false);
    }

    const n = Math.min(world.players.length, header.players.length);
    for (let slot = 0; slot < n; slot++) {
      const rec = header.players[slot];
      if (rec === undefined) continue;
      if (rec.faction === (Faction.Neutral as number)) continue;
      const p = world.players[slot];
      p.faction = rec.faction as Faction;
      p.isHuman = true;
      p.isLocal = slot === header.localPlayer;
      p.aiDifficulty = rec.aiDifficulty;
      p.aiPersonality = rec.aiPersonality;
      /*
       * THE RECORDING'S DIPLOMACY, NOT THIS BROWSER'S LOBBY. `allyMask` is sim
       * state — `Checksum.hashPlayers` covers it and `Targeting` reads it every
       * tick — so a 2v2 replayed with the free-for-all mask a fresh boot seats
       * has both teams open fire on their own allies and diverges inside a
       * second. `|=` rather than `=`: Gaia's bit is written by the scenario in
       * both directions and this must not take it back off.
       *
       * ABSENT ON EVERY FILE RECORDED BEFORE TEAMS EXISTED, and that absence is
       * a FACT rather than a gap — those matches really were free-for-alls, and
       * the default mask already says so. `REPLAY_FORMAT_VERSION` therefore
       * does not move; see `ReplaySlot.allyMask` for what that costs.
       */
      if (rec.allyMask !== undefined) p.allyMask |= rec.allyMask;
      // NAMED BY THEIR ARMY, not "You" and "Opponent". A replay has no you.
      p.name = names.find((f) => (f.id as number) === rec.faction)?.name ?? `Slot ${slot + 1}`;
    }

    const local = Math.max(0, Math.min(world.players.length - 1, header.localPlayer));
    world.localPlayer = local as PlayerId;
  }

  /** Everything that can only be done once the world is fully built. */
  /**
   * Everything post-boot that the SIMULATION can see. Runs on tick 0, before
   * the loop starts, so it lands on the same tick in every run of a seed.
   *
   * See the note at the call site: this used to be one function with the camera
   * work and ran six RENDER frames late, which put the starting bank anywhere
   * between tick 3 and tick 18.
   */
  private applySimPostBoot(game: GameHandle, backdrop: boolean): void {
    const { world, loop } = game.ctx;

    // PVP IS PINNED TO 1x. Game speed scales the ACCUMULATOR, so it cannot
    // desync — a tick is a tick whenever it runs — but a player at 2x simply
    // arrives at the next turn boundary sooner and waits there for the other
    // one. It is not an advantage, it is not a bug, and it is not worth the
    // confusion of appearing to do something.
    // PLAYBACK ALSO STARTS AT 1x, and for a friendlier reason: speed scales the
    // accumulator and cannot touch the simulation, so the bar owns it from
    // here and a viewer may move it whenever they like.
    loop.setSpeed(backdrop || this.pvp !== null || this.replay !== null ? 1 : this.setup.speed);

    // THE RECORDED OPENING BANK, PER SLOT, and it has to be here rather than in
    // `seatReplayPlayers`: that runs before the scenario exists, and the
    // scenario sets its own bank on the way past. This is the last write before
    // tick 1, which is where the recorder read the number it stored.
    if (!backdrop && this.replay !== null) {
      const slots = this.replay.file.header.players;
      const n = Math.min(world.players.length, slots.length);
      for (let slot = 0; slot < n; slot++) {
        const rec = slots[slot];
        if (rec !== undefined) world.players[slot].credits = rec.credits;
      }
      return;
    }

    if (!backdrop) {
      // Applied AFTER the scenario, which sets its own bank so a posed
      // screenshot does not read as a test fixture — but BEFORE the first tick,
      // which is what makes it reproducible.
      //
      // PVP IGNORES THE LOCAL LOBBY AND SEEDS BY SLOT. Two things were wrong
      // here at once. `this.setup.startingCredits` is a per-client preference,
      // so two players who had chosen different banks started a "fair" match
      // with different money. And the second write targeted `players[1]`
      // unconditionally while the first targeted `localPlayer` — so on the
      // client seated as slot 1, slot 1 was paid twice and slot 0 never at all,
      // which is a divergence on tick zero.
      //
      // EVERY ARMY, NOT THE FIRST TWO. The `slot < 2` this replaces was the
      // last place a third army would have silently opened on whatever the
      // scenario happened to leave it — which in an MCV start is nothing, so
      // armies three and four would have been unable to place their first
      // building. Gaia is skipped by faction rather than by index: it is
      // created by the scenario and lands at the END of the table, so an index
      // bound would have been a second thing to keep in step.
      const bank = this.pvp !== null ? Shell.PVP_CREDITS : this.setup.startingCredits;
      for (let slot = 0; slot < world.players.length; slot++) {
        const p = world.players[slot];
        if (p.faction === Faction.Neutral) continue;
        p.credits = bank;
      }
    }
  }

  /**
   * Everything post-boot that only the CAMERA can see. Runs after the six-frame
   * wait, which is what it needed the wait for.
   */
  private applyCameraPostBoot(game: GameHandle, backdrop: boolean): void {
    const { world, cameraRig } = game.ctx;

    // Frame the local player's own base. The skirmish scenario points the
    // camera at the Allied corner unconditionally; if the player picked the
    // other side that is someone else's base.
    const home = findHome(game, world.localPlayer);
    if (home !== null) {
      cameraRig.setPose({
        x: home.x,
        z: home.z,
        // The backdrop pulls right out: at match distance the orbit sweeps the
        // camera through the buildings it is orbiting, and the menu column
        // covers the left third of whatever is on screen.
        distance: backdrop ? 104 : 72,
        immediate: true,
      });
    }

    cameraRig.setInputEnabled(!backdrop);
    if (backdrop) cameraRig.setEnabled(true);
  }

  /* ---------------------------------------------------------------------- */
  /* Frame                                                                  */
  /* ---------------------------------------------------------------------- */

  private readonly tick = (nowMs: number): void => {
    if (this.disposed) return;
    this.rafHandle = requestAnimationFrame(this.tick);

    const dt = this.lastFrameMs === 0 ? 0.016 : Math.min(0.1, (nowMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = nowMs;

    if (this.backdrop && this.game !== null) this.orbitBackdrop(dt);
    if (this.screen !== null) this.pad.poll(nowMs, this.ring, () => this.back());
    if (this.state === 'playing') {
      // A REPLAY IS NOT A MATCH BEING PLAYED, and neither of the two polls
      // below is right for one. The outcome poll would call `endMatch` — which
      // scores a result and drains the reward queue — the moment the recorded
      // loser was wiped out; the autosave poll would write a snapshot of
      // somebody else's game into the player's slots.
      if (this.replay !== null) this.pollReplay(dt);
      else {
        this.pollOutcome(dt);
        this.pollAutosave(dt);
      }
    }
  };

  /**
   * Repaint the replay strip, and stop the world when the recording runs out.
   *
   * 5 Hz. `playbackReport()` allocates one small object, and the numbers in it
   * move at most once per tick — polling it per frame would be sixty reads a
   * second of a value that changes thirty times, for a strip whose smallest
   * element is a four-pixel bar.
   *
   * PAUSING AT THE END IS THE HONEST BEHAVIOUR. Past the recording's last tick
   * there is nothing left to re-issue and no checkpoint left to check, so the
   * simulation would keep running — two AI-less armies standing still — and
   * every frame of it would be a match that never happened being presented as
   * one that did.
   */
  private pollReplay(dt: number): void {
    const watching = this.replay;
    const bar = watching?.bar;
    if (watching === null || bar === undefined || bar === null) return;

    this.replayAccum += dt;
    if (this.replayAccum < 0.2) return;
    this.replayAccum = 0;

    const report = currentPlayback();
    bar.update(report);

    if (report.complete && !this.replayComplete) {
      this.replayComplete = true;
      this.replayPaused = true;
      this.game?.setPaused(true);
      bar.setPaused(true);
    }
  }

  /** Slow cinematic orbit around whatever the title screen is looking at. */
  private orbitBackdrop(dt: number): void {
    const rig = this.game!.ctx.cameraRig;
    // 1.4 deg/s: a full revolution in just over four minutes, which reads as
    // "alive" without ever looking like a turntable render.
    rig.setYaw(rig.targetYaw + dt * 0.0244);
  }

  /**
   * Victory / defeat, evaluated on the RENDER side at 2 Hz.
   *
   * Deliberately NOT a sim system: nothing in `src/sim/**` publishes an
   * outcome yet, and adding one from here would put a second writer on state
   * this module does not own. This reads the entity store and nothing else, so
   * it cannot desync anything, and a real victory module can take over simply
   * by calling `shell.endMatch()` — the poll defers to whoever gets there first.
   */
  private pollOutcome(dt: number): void {
    const game = this.game;
    if (game === null) return;
    this.outcomeAccum += dt;
    if (this.outcomeAccum < 0.5) return;
    this.outcomeAccum = 0;

    // Ten seconds of grace: production, deployment and the first harvester run
    // all happen inside it, and an empty world for one frame during boot must
    // never read as a defeat.
    if (game.ctx.loop.simTime < 10) return;

    // THE OPERATION DECIDES WHAT MAY END IT. A skirmish answers with both rules
    // on, which is byte-for-byte what this method always did; a campaign
    // operation defaults to NEITHER, because every one of the four shipped
    // failures below is reachable against a scripted match — a hold won at
    // minute three, a defeat at t+10 s for an insertion that has not landed, a
    // seat whose forces arrive at minute three handing an instant victory, and
    // a defecting militia counted hostile forever. See `campaign/policy.ts`.
    const policy = outcomePolicy();
    if (!policy.annihilationWin && !policy.assetLossDefeat) return;

    const world = game.ctx.world;
    const local = world.localPlayer;
    const alive = countLivingAssets(game);

    if ((alive.get(local as number) ?? 0) > 0) {
      if (!policy.annihilationWin) return;
      let enemiesLeft = 0;
      for (const p of world.players) {
        // ONE DEFINITION OF ENEMY, shared with `outcome.system.ts`. On a team
        // this is what makes the win condition "the other side", rather than
        // "every other seat" — and an ally who is wiped out ends nothing.
        if (!isHostileSeat(world, local, p)) continue;
        // A seat an operation declared invisible decides nothing — that is how
        // a scripted third party or a militia about to defect stops counting
        // as an enemy who must be killed.
        if (seatIgnored(p.id as number)) continue;
        if ((alive.get(p.id as number) ?? 0) > 0) enemiesLeft++;
      }
      if (enemiesLeft === 0) this.endMatch(this.buildResult(true));
      return;
    }
    if (!policy.assetLossDefeat) return;
    this.endMatch(this.buildResult(false));
  }

  /**
   * Autosave, evaluated on the RENDER side at 2 Hz against the SIM TICK COUNTER.
   *
   * WHY 2 Hz AND NOT EVERY FRAME. `AutosaveScheduler.evaluate` is idempotent
   * for a given tick, so the two produce the same saves; polling at 2 Hz just
   * means the objective read (`currentObjectives`, which allocates a small
   * array inside the progression layer) happens twice a second instead of a
   * hundred and twenty times. The worst-case lateness this introduces is half a
   * second on a three-minute schedule.
   *
   * WHY IT IS NOT A SYSTEM. A `*.system.ts` would put it inside `simTick`,
   * where `Date.now()` is banned — and the save's own metadata needs a real
   * timestamp. Reading the tick counter from outside the sim gets the tick-based
   * schedule the determinism rule demands AND a legal wall clock for the index.
   */
  private pollAutosave(dt: number): void {
    const game = this.game;
    if (game === null || this.backdrop) return;
    // A tutorial run is not a match worth restoring. See `Shell.canSave`.
    if (this.tutorial !== null) return;
    if (this.saving) return;

    this.autosaveAccum += dt;
    if (this.autosaveAccum < 0.5) return;
    this.autosaveAccum = 0;

    const svc = saveService();
    if (svc === null) return;

    const loop = game.ctx.loop;
    const s = this.autosaveSample;
    s.tick = loop.tick;
    // `lastSteps > 1` means the loop ran catch-up steps: the machine is already
    // behind this frame, and a snapshot on top of that is how one hitch becomes
    // two. The scheduler defers, with a deadline.
    s.catchingUp = loop.lastSteps > 1;
    s.paused = loop.paused;
    try {
      s.canSave = svc.canSave();
    } catch {
      s.canSave = false;
    }
    s.objectivesComplete = completedObjectiveCount();

    const decision = this.autosave.evaluate(s);
    if (decision.act !== 'save') return;

    const context = this.saveContext();
    if (context === null) return;

    const tick = s.tick;
    const label = autosaveLabel(decision.trigger, loop.simTime);
    this.saving = true;
    const started = performance.now();
    svc.save({
      kind: 'auto',
      label,
      context,
      slotId: decision.slotId,
      // NO THUMBNAIL. A canvas readback mid-match is exactly the hitch this
      // whole deferral mechanism exists to avoid — see the LoadGame.ts header.
      thumbnail: false,
    }).then((result) => {
      // A refusal is a value here, not a throw — see `unwrap`. It must land in
      // the rejection path or a store that is out of quota would toast
      // "Autosaved" forever while writing nothing.
      const meta = unwrap(result);
      this.saving = false;
      this.lastSaveMs = performance.now() - started;
      this.lastSaveBytes = meta.bytes;
      this.autosave.committed(tick);
      this.toast(`Autosaved · ${formatSlotName(decision.slotId)}`, false);
    }).catch((err: unknown) => {
      this.saving = false;
      // A save that fails must SAY so. Silence here is indistinguishable from
      // a working autosave, and the player finds out at the worst moment.
      this.autosave.failed(tick);
      console.error('[shell] autosave failed', err);
      this.toast(`Autosave failed — ${errorText(err)}`, true);
    });
  }

  /**
   * A transient line over the live match. Never interactive, never focusable,
   * and `pointer-events: none` in CSS so it cannot eat a click during a fight.
   */
  private toast(text: string, bad: boolean): void {
    if (this.disposed) return;
    if (this.toastTimer !== 0) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = 0;
    }
    let node = this.toastNode;
    if (node === null) {
      node = el('div', 'vm-save-toast');
      this.root.appendChild(node);
      this.toastNode = node;
    }
    node.replaceChildren();
    node.appendChild(icon(bad ? 'info' : 'check', 14));
    node.appendChild(el('span', undefined, text));
    node.classList.toggle('is-bad', bad);
    // Two frames before the class lands, or the transition never runs — the
    // element was created and shown in the same style recalculation.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.toastNode?.classList.add('is-in');
    }));
    this.toastTimer = window.setTimeout(() => {
      this.toastNode?.classList.remove('is-in');
      this.toastTimer = window.setTimeout(() => {
        this.toastNode?.remove();
        this.toastNode = null;
        this.toastTimer = 0;
      }, 260);
    }, bad ? 6000 : 2600);
  }

  /**
   * What `endMatch` falls back to when there is no live game to read — only
   * reachable if a caller ends a match the shell never built.
   */
  private static readonly EMPTY_STATS = {
    unitsBuilt: 0, unitsLost: 0, unitsKilled: 0,
    buildingsBuilt: 0, buildingsLost: 0, buildingsKilled: 0,
    oreMined: 0, oreWasted: 0, creditsSpent: 0, peakArmyValue: 0,
  };

  private buildResult(won: boolean): MatchResult {
    const game = this.game!;
    const world = game.ctx.world;
    const p = world.player(world.localPlayer);
    // EVERY hostile army, not `players[1]`. In a four-way the end screen's one
    // opponent chip was naming whoever happened to be seated second and silently
    // omitting the other two. Neutral is skipped (Gaia is in this table) and so
    // is anyone allied to the local player, so the chip reads "who was I
    // fighting" rather than "who else was on the map".
    //
    // ONE FILTER, TWO FIELDS. `opponentName` and `opponents` are the same set in
    // the same order — derived here rather than in two expressions, because a
    // name list and a difficulty list that disagreed about which seats they
    // covered would put the wrong setting under the right name.
    const hostiles = world.players.filter((o) => isHostileSeat(world, world.localPlayer, o));
    return {
      won,
      durationSec: game.ctx.loop.simTime,
      wallSec: (performance.now() - this.matchStartMs) / 1000,
      stats: { ...p.stats },
      credits: Math.round(p.credits),
      factionName: factionByKey(this.setup.playerFaction)?.name ?? p.name,
      opponentName: hostiles.map((o) => o.name).join(' · ') || 'Opponent',
      mapName: mapById(this.setup.map).name,
      difficulty: this.setup.difficulty,
      // `aiDifficulty` off the WORLD, not `setup.difficulty`: that column is
      // what the brain actually read, `?ai=` rewrites it after the lobby has had
      // its say, and a loaded save restores it from the blob.
      opponents: hostiles.map((o) => ({
        name: o.name, difficulty: o.aiDifficulty, isHuman: o.isHuman,
      })),
      speed: GAME_SPEEDS[this.setup.speed] ?? 1,
      // Present only for an operation, and ONLY when the campaign actually
      // published one. A campaign match that ended some other way — quit,
      // abandoned — gets the skirmish copy, which is at least not a false
      // claim about objectives nobody resolved.
      campaign: this.campaignResult ?? undefined,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Global input                                                           */
  /* ---------------------------------------------------------------------- */

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.disposed) return;
    const target = e.target as HTMLElement | null;
    const typing =
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    /**
     * A TEXT field, specifically — narrower than `typing`, which is true for a
     * `<input type="range">` slider too.
     *
     * The ring's Left/Right handling ends in `preventDefault`, so without this
     * the caret in the save panel's name field could not be moved and Home/End
     * would do nothing. It is deliberately NOT widened to `typing`: the options
     * screen's sliders ARE inputs, and they rely on the ring's adjuster for
     * gamepad support.
     */
    const editingText =
      target !== null &&
      (target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text'));

    if (this.screen?.onKeyDown?.(e) === true) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // The pause chord is a real, rebindable binding. Escape by default.
    if (!typing && this.state === 'playing' && matchesChord(e, this.settings.get().controls.bindings['sys.menu'])) {
      e.preventDefault();
      e.stopPropagation();
      this.pause();
      return;
    }

    if (this.screen === null) return;

    switch (e.code) {
      case 'ArrowDown':
        if (editingText) return;
        this.ring.move(1);
        break;
      case 'ArrowUp':
        if (editingText) return;
        this.ring.move(-1);
        break;
      case 'ArrowRight':
        if (editingText) return;
        if (!this.ring.adjust(1)) this.ring.move(1);
        break;
      case 'ArrowLeft':
        if (editingText) return;
        if (!this.ring.adjust(-1)) this.ring.move(-1);
        break;
      case 'Enter':
      case 'NumpadEnter':
        if (typing) return;
        if (!this.ring.activate()) return;
        break;
      case 'Escape':
        this.back();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  private readonly onResize = (): void => {
    // The renderer measures itself; this only re-fits the ring, whose
    // visibility test depends on layout.
    this.ring.refresh();
  };

  private readonly onVisibility = (): void => {
    // A hidden tab must not burn a frame budget on a menu backdrop either.
    // EXCEPT IN PVP: the opponent keeps playing whether this tab is visible or
    // not, so pausing here would stall the pair and eventually forfeit the
    // match for tabbing away. The browser throttles background rAF anyway,
    // which lockstep survives — it stalls and catches up, it never skips.
    if (this.state === 'playing' && this.pvp === null) {
      // `|| replayPaused` so returning to the tab does not restart a replay the
      // viewer had deliberately stopped.
      this.game?.setPaused(document.hidden || (this.replay !== null && this.replayPaused));
    }
    // Hidden is the last event a mobile browser reliably fires before it kills
    // the page, and the profile store batches its writes. Flush here or a
    // mission completed in the final minute of a match is simply gone.
    if (document.hidden) progression.flushProfile();
  };

  private readonly onSettingsChanged = (settings: Settings, changed: readonly string[]): void => {
    if (this.game === null) return;

    /*
     * `graphics.calibrated` IS THE WHOLE PROTOCOL, in both directions.
     *
     *   true  — somebody decided. `SettingsStore.patch` writes it alongside any
     *           picture-affecting graphics row, so moving one mid-probe cancels
     *           the calibration and `disarmCalibration` puts the scale it was
     *           probing at back where it found it. `commitCalibration` also
     *           writes it, and the render system has already disarmed itself by
     *           then, so a successful run does not cancel itself here.
     *   false — the player asked for one: "Calibrate Now", or Reset Graphics.
     *
     * CANCELLING RUNS BEFORE `applySettings`, deliberately: the cancelling
     * change is very often a move of the Resolution Scale slider, and putting
     * the probe's entry value back AFTER pushing the player's new one would
     * leave the slider reading one number and the renderer doing another.
     * `disarmCalibration` is also guarded against that from its own side, so
     * this ordering is belt to its braces rather than the only thing holding.
     */
    const flag = touched(changed, 'graphics.calibrated');
    if (flag && settings.graphics.calibrated) disarmCalibration();

    applySettings(settings, this.game, changed);

    if (flag && !settings.graphics.calibrated) this.maybeCalibrate();
  };

  /**
   * "Calibrate Now" — the player asking for a measurement they already had, or
   * asking for the pending one to start immediately.
   *
   * TWO STEPS, AND BOTH ARE NEEDED. The patch is what makes it survive a page
   * reload for a profile that had already been calibrated; the direct call is
   * what makes the button do something for a profile where the flag was ALREADY
   * false, in which case the patch is an empty diff that fires no listener.
   * `maybeCalibrate` is idempotent — `armCalibration` refuses a second arm — so
   * the two overlapping is harmless.
   */
  recalibrate(): void {
    this.settings.patch({ graphics: { calibrated: false } });
    this.maybeCalibrate();
  }

  /**
   * Run the one-time hardware calibration, if this profile has never had one.
   *
   * The refusal is the feature: `graphics.calibrated` is true for every profile
   * that has ever stored settings and for every profile whose owner has touched
   * a Graphics row, so this is a no-op for everyone except a genuinely fresh
   * player and anyone who has explicitly asked again.
   */
  private maybeCalibrate(): void {
    if (this.game === null || this.disposed) return;
    if (this.settings.get().graphics.calibrated) return;
    // THE TARGET IS THE PLAYER'S, NOT THE PANEL'S. `targetMsForCap` carries the
    // measurement: a 144 Hz target is inert on hardware that could reach it and
    // floors the picture on hardware that cannot, so `fpsCap` is opt-in and 0
    // resolves to 60.
    armCalibration(
      (result) => { this.commitCalibration(result); },
      targetMsForCap(this.settings.get().graphics.fpsCap),
    );
  }

  /**
   * Persist what the calibration measured.
   *
   * Written through `SettingsStore.patch` like any other change, so the result
   * is an ordinary set of player settings from the moment it lands — editable,
   * diffed, and applied by the same `applySettings` a slider goes through.
   * There is no second, privileged copy of these numbers anywhere.
   *
   * `ao` and `shadowQuality` carry their unchanged defaults except in the one
   * case the controller sheds them (see `HardwareCalibration#finish`), so
   * `diffSettings` normally reports only `calibrated` and `resolutionScale`.
   */
  private commitCalibration(result: CalibrationResult): void {
    if (this.disposed) return;
    const patch: Partial<GraphicsSettings> = {
      calibrated: true,
      resolutionScale: result.resolutionScale,
      ao: result.ao,
      shadowQuality: result.shadowQuality,
    };
    this.settings.patch({ graphics: patch });
    console.info(`[shell] ${describeCalibration(result)}`);
  }

  private status(text: string): void {
    this.options.status?.(text);
    const node = this.host.querySelector<HTMLElement>('.vm-load-status');
    if (node !== null) node.textContent = text;
  }

  private fail(title: string, detail: unknown): void {
    console.error(`[shell] ${title}`, detail);
    this.options.onError?.(title, detail);
  }
}

/* ==========================================================================
 * 7. LOADING SCREEN
 *
 * Small enough to live here rather than in its own module: it has no controls,
 * no state and no focus ring.
 * ========================================================================== */

export class LoadingScreen implements Screen {
  readonly id = 'loading';
  private root: HTMLElement | null = null;

  /**
   * `bindings` is REQUIRED and has no default, for `startPointsFor`'s reason:
   * a defaulted `{}` resolves every tip against the DEFAULT chords, which is
   * precisely the lie this screen shipped for its whole life, and it would do
   * it silently at whichever call site forgot to pass one. Required makes the
   * compiler name them instead — both are in `Shell` and both hold the store.
   */
  constructor(
    private readonly mapName: string,
    private readonly factionName: string,
    private readonly bindings: StoredBindings,
    /**
     * The kicker above the heading. 'Loading' for a skirmish; the CHAPTER for
     * a campaign operation, so the curtain reads the way the briefing screen
     * it was launched from does.
     *
     * Defaulted rather than required, unlike `bindings` above — the default is
     * the string the screen has always shown, so a call site that forgets it
     * gets the old behaviour rather than a silent lie. `bindings` had no safe
     * default and that is why it has none.
     */
    private readonly kicker: string = 'Loading',
    /** Campaign continuity card. Null keeps the skirmish curtain unchanged. */
    private readonly command: {
      readonly commander: CampaignSpeakerPresentation;
      readonly directive: string;
      readonly theme: CampaignTheme;
    } | null = null,
  ) {}

  mount(host: HTMLElement): void {
    host.classList.add('vm-load');
    this.root = host;

    const inner = el('div', 'vm-load-inner');
    inner.appendChild(el('p', 'vm-subtitle', this.kicker));
    inner.appendChild(el('h1', 'vm-h2', this.mapName));

    if (this.command !== null) {
      host.classList.add('vm-load-campaign', `is-${this.command.theme}`);
      const card = el('section', 'vm-load-command');
      card.setAttribute('aria-label', 'Operation command');
      const portrait = document.createElement('img');
      portrait.className = 'vm-load-command-portrait';
      portrait.src = this.command.commander.portrait;
      portrait.alt = `${this.command.commander.name}, ${this.command.commander.role}`;
      portrait.decoding = 'async';
      card.appendChild(portrait);
      const copy = el('div', 'vm-load-command-copy');
      copy.appendChild(el('span', 'vm-load-command-kicker', 'Operation command'));
      const identity = el('div', 'vm-load-command-identity');
      identity.appendChild(el('strong', 'vm-load-command-name', this.command.commander.name));
      identity.appendChild(el('span', 'vm-load-command-role', this.command.commander.role));
      copy.appendChild(identity);
      copy.appendChild(el('p', 'vm-load-command-directive', this.command.directive));
      card.appendChild(copy);
      inner.appendChild(card);
    }

    const meta = el('div', 'vm-load-meta');
    if (this.factionName !== '') {
      const chip = el('div', 'vm-chip');
      chip.appendChild(icon('flag', 14));
      chip.appendChild(el('span', undefined, this.factionName));
      meta.appendChild(chip);
    }
    inner.appendChild(meta);

    inner.appendChild(el('div', 'vm-load-bar'));
    inner.appendChild(el('div', 'vm-load-status', 'Initialising'));
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    inner.appendChild(
      el('p', 'vm-load-tip', resolveTip(tip, this.bindings, isApplePlatform(), codeLabel)),
    );

    host.appendChild(inner);
  }

  unmount(): void {
    this.root?.classList.remove('vm-load');
    this.root?.classList.remove(
      'vm-load-campaign', 'is-allies', 'is-pact', 'is-reclamation', 'is-soviets',
    );
    this.root = null;
  }
}

/* ==========================================================================
 * 8. HELPERS
 * ========================================================================== */

/**
 * What the loading curtain says, derived rather than chosen at the call site.
 *
 * Exported and pure for `topRowFit`'s reason: the decision is worth a test and
 * the screen it feeds needs a DOM, which this suite does not have.
 *
 * `operation` is `Shell.operation`, and it is written before `startMatch` runs
 * on all three paths that arm one — launching from the briefing, opening a
 * replay of one, and restoring a save of one — so a null here really does mean
 * "not a campaign" rather than "not yet".
 */
export function curtainLabels(
  operation: { title: string; chapterTitle: string } | null,
  mapName: string,
): { kicker: string; heading: string } {
  if (operation === null) return { kicker: 'Loading', heading: mapName };
  return { kicker: operation.chapterTitle, heading: operation.title };
}

/** True when a keyboard event matches a stored chord exactly. */
export function matchesChord(e: KeyboardEvent, c: Chord | undefined): boolean {
  if (c === undefined || c.code === '') return false;
  return chordEquals(
    { code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey },
    c,
  );
}

/** Resolve after `n` presented frames. */
export function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let left = Math.max(1, n);
    const step = (): void => {
      left--;
      if (left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * Buildings + units alive per player index.
 *
 * Reads the store's dense per-kind lists directly rather than
 * `PlayerState.entityCount`, which is incremented on spawn and never
 * decremented on death and would report a wiped-out player as alive forever.
 */
function countLivingAssets(game: GameHandle): Map<number, number> {
  const s = game.ctx.world.store;
  const out = new Map<number, number>();
  const kinds = [EntityKind.Building, EntityKind.Vehicle, EntityKind.Infantry];
  for (const kind of kinds) {
    const list = s.byKind[kind];
    const n = s.byKindCount[kind];
    for (let i = 0; i < n; i++) {
      const slot = list[i];
      const owner = s.owner[slot];
      out.set(owner, (out.get(owner) ?? 0) + 1);
    }
  }
  return out;
}

/** The player's construction yard, or their first building, or null. */
function findHome(game: GameHandle, player: PlayerId): { x: number; z: number } | null {
  const s = game.ctx.world.store;
  const list = s.byKind[EntityKind.Building];
  const n = s.byKindCount[EntityKind.Building];
  let fallback: { x: number; z: number } | null = null;
  for (let i = 0; i < n; i++) {
    const slot = list[i];
    if (s.owner[slot] !== (player as number)) continue;
    const here = { x: s.posX[slot], z: s.posZ[slot] };
    // The largest footprint on the field is the construction yard.
    if (s.footprintW[slot] >= 3 && s.footprintH[slot] >= 3) return here;
    fallback ??= here;
  }
  return fallback;
}

/**
 * How many active objectives report complete.
 *
 * The autosave scheduler's event trigger is a RISE in this number. Total:
 * with no progression layer it is always 0, which degrades the trigger to
 * "never fires" and leaves the interval doing all the work.
 */
export function completedObjectiveCount(): number {
  let n = 0;
  for (const o of currentObjectives()) if (o.progress.complete) n++;
  return n;
}

/** `auto.1` -> `Slot 2`. The toast says which slot, so rotation is visible. */
export function formatSlotName(slotId: string): string {
  const m = /^auto\.(\d+)$/.exec(slotId);
  return m === null ? slotId : `Slot ${Number(m[1]) + 1}`;
}

/** The stock configuration, for a boot that never sees the lobby. */
export function bootSetup(): MatchSetup {
  return defaultSetup();
}

/** The battlefield roster, for the lobby and for tests. */
export function mapChoices(): typeof MAPS {
  return MAPS;
}

/* ==========================================================================
 * 9. GLOBAL HANDLE
 *
 * Two objects on `window`, for the same reason `window.__VM` exists: the HUD,
 * the input module and a console are all legitimate drivers of this state and
 * none of them should have to import the shell to reach it.
 *
 *   __vmShell    — the state machine (pause, quit, endMatch, getState)
 *   __vmSettings — the live settings store (get, patch, subscribe)
 * ========================================================================== */

declare global {
  interface Window {
    __vmShell?: Shell;
    __vmSettings?: SettingsStore;
  }
}

export function publishShell(shell: Shell): void {
  window.__vmShell = shell;
  window.__vmSettings = shell.settings;
}

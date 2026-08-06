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
import { DEFAULT_ART, GAME_SPEEDS } from '../core/config';
import { EntityKind, Faction, type PlayerId } from '../core/types';
import { DEF_TABLES } from '../data/Defs';

import {
  MAPS,
  SettingsStore,
  buildMatchQuery,
  chordEquals,
  defaultSetup,
  mapById,
  normalizeSetup,
  rollSeed,
  type Chord,
  type MatchSetup,
  type Settings,
} from './settings-store';

import { applySettings, SettingsScreen } from './Settings';
import { CreditsScreen, MainMenuScreen } from './MainMenu';
import { SkirmishSetupScreen } from './SkirmishSetup';
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
  | 'load';

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
  if (options.disabled === true) {
    b.disabled = true;
    b.tabIndex = -1;
  } else {
    focusable(b);
    if (options.onClick !== undefined) b.addEventListener('click', options.onClick);
  }
  return b;
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
  /** Status text sink — the pre-module curtain in index.html. */
  status?: (text: string) => void;
  /** Called once the first real frame is on screen. */
  onReady?: () => void;
  /** Fatal failure sink. */
  onError?: (title: string, detail: unknown) => void;
}

/** Loading-screen copy. Real advice, not lorem. */
const TIPS: readonly string[] = [
  'Harvesters are your entire economy. Escort them, and rebuild them first.',
  'A war factory with two refineries out-produces two war factories with one.',
  'Right-click cancels a build placement without losing the structure.',
  'Ctrl+number stores a control group. Double-tap the number to jump the camera to it.',
  'Tesla and prism defences go dark in a brownout. Build the power plant first.',
  'Q and E rotate the camera. The silhouette of a base reads differently from every angle.',
  'Engineers capture. One engineer into an enemy war factory is worth a tank column.',
  'Attack-move (A) makes a column engage on the way instead of driving past the fight.',
  'Sell a damaged structure before it dies — you keep half the cost.',
  'Heavy armour shrugs off small arms. Bring cannons to a tank fight.',
];

export class Shell {
  readonly settings: SettingsStore;

  private state: ShellState = 'boot';
  private readonly root: HTMLDivElement;
  private readonly host: HTMLDivElement;
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
    this.setup = { ...this.settings.setup() };

    this.root = el('div', 'vm-shell');
    this.host = el('div', 'vm-shell-host');
    this.host.style.cssText = 'position:absolute;inset:0;';
    this.root.appendChild(this.host);
    options.menuRoot.appendChild(this.root);
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
    if (this.options.skipMenu === true) {
      await this.startMatch(this.setup);
      return;
    }
    await this.openMenu(true);
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

      this.show(new LoadingScreen(map.name, factionByKey(this.setup.playerFaction)?.name ?? ''), 'loading');
      // Two frames so the loading screen is actually painted before the boot
      // blocks the main thread on shader compilation.
      await nextFrames(2);

      await this.bootGame(seed, false);
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
      const world = this.game?.ctx.world;
      if (world !== undefined) {
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
    this.game.ctx.cameraRig.setInputEnabled(true);
    this.game.setPaused(false);
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
    const base: MatchResult = this.game === null
      ? {
        won: result.won, durationSec: 0, wallSec: 0,
        stats: { ...Shell.EMPTY_STATS }, credits: 0,
        factionName: factionByKey(this.setup.playerFaction)?.name ?? '',
        opponentName: factionByKey(this.setup.aiFaction)?.name ?? 'Opponent',
        mapName: mapById(this.setup.map).name,
        difficulty: this.setup.difficulty,
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

  /** Open the options. `returnTo` is where Back goes. */
  openSettings(returnTo: ShellState = 'menu'): void {
    this.show(new SettingsScreen(this, returnTo), 'settings');
  }

  openCredits(): void {
    this.show(new CreditsScreen(this), 'credits');
  }

  /**
   * Open the missions and unlocks board.
   *
   * Reachable from the title screen and from the pause menu, and it renders
   * with no progression handle at all (an empty board with the export/import
   * footer), so the route is safe under the `?shot=` harness.
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
    return {
      mapId: this.setup.map,
      playerFaction: this.setup.playerFaction,
      aiFaction: this.setup.aiFaction,
      difficulty: this.setup.difficulty,
      speed: this.setup.speed,
      seed: this.activeSeed,
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
    await this.startMatch({
      ...this.setup,
      map: c.mapId,
      playerFaction: c.playerFaction,
      aiFaction: c.aiFaction,
      difficulty: c.difficulty,
      speed: c.speed,
      seed: c.seed,
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
    if (this.toastTimer !== 0) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = 0;
    }
    this.toastNode = null;
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
      this.show(new LoadingScreen('Voltmarch', ''), 'loading');
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
    if (backdrop) query.set('ai', 'off');
    // The tutorial teaches deploying the MCV, so it cannot inherit a lobby that
    // last asked for a pre-built base. `?start=` is the only channel that
    // outranks `setPlannedStart` — see `chooseStart` in game/Scenarios.ts.
    if (!backdrop && this.tutorial !== null) query.set('start', 'mcv');
    // `shot` is the screenshot harness's flag and must never appear here.
    query.delete('shot');
    query.delete('skipmenu');
    history.replaceState(null, '', `${location.pathname}?${query.toString()}`);

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

    const game = bootstrap(boot);
    this.game = game;

    // MUST be synchronous: `registry.init()` has already started and runs its
    // continuations in microtasks, so this is the last moment before the
    // scenario module reads the player table and builds the bases.
    this.applySetupToWorld(game, backdrop);

    this.status('Compiling shaders');
    await game.ready;
    game.start();

    this.status('Deploying');
    applySettings(this.settings.get(), game);

    // `game.scenario` re-asserts its authored camera pose on every frame up to
    // frame 4, so that a screenshot taken immediately after `ready()` is framed
    // exactly as composed. Ours has to land AFTER that window or it is silently
    // overwritten — which is why this waits instead of posing straight away.
    await nextFrames(6);
    this.applyPostBoot(game, backdrop);
  }

  /**
   * Push the lobby's choices into the freshly-built world.
   *
   * `ScenarioBuilder` now resolves its two scripted bases by SLOT rather than
   * by faction, and remaps each base's content to the owner's army, so writing
   * the chosen factions onto players 0 and 1 is the whole of the lobby — and a
   * mirror match is legal, which is why the AI's faction is no longer refused
   * when it matches the human's.
   */
  private applySetupToWorld(game: GameHandle, backdrop: boolean): void {
    const world = game.ctx.world;
    if (world.players.length < 2) return;

    const player = factionByKey(this.setup.playerFaction);
    const enemy = factionByKey(this.setup.aiFaction);

    const human = world.players[0];
    const ai = world.players[1];

    if (player !== undefined) human.faction = player.id;
    if (enemy !== undefined) ai.faction = enemy.id;

    human.name = backdrop ? 'Observer' : 'Commander';
    ai.name = `${enemy?.name ?? 'Opponent'} AI`;
    ai.aiDifficulty = this.setup.difficulty;
    if (this.setup.personality >= 0) ai.aiPersonality = this.setup.personality;
  }

  /** Everything that can only be done once the world is fully built. */
  private applyPostBoot(game: GameHandle, backdrop: boolean): void {
    const { world, loop, cameraRig } = game.ctx;

    loop.setSpeed(backdrop ? 1 : this.setup.speed);

    if (!backdrop) {
      // Starting credits are applied AFTER the scenario, which sets its own
      // bank so a posed screenshot does not read as a test fixture.
      const p = world.player(world.localPlayer);
      p.credits = this.setup.startingCredits;
      const other = world.players[1];
      if (other !== undefined) other.credits = this.setup.startingCredits;
    }

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
      this.pollOutcome(dt);
      this.pollAutosave(dt);
    }
  };

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

    const world = game.ctx.world;
    const local = world.localPlayer;
    const alive = countLivingAssets(game);

    if ((alive.get(local as number) ?? 0) > 0) {
      let enemiesLeft = 0;
      for (const p of world.players) {
        if (p.faction === Faction.Neutral) continue;
        if (world.areAllied(local, p.id)) continue;
        if ((alive.get(p.id as number) ?? 0) > 0) enemiesLeft++;
      }
      if (enemiesLeft === 0) this.endMatch(this.buildResult(true));
      return;
    }
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
    oreMined: 0, creditsSpent: 0, peakArmyValue: 0,
  };

  private buildResult(won: boolean): MatchResult {
    const game = this.game!;
    const world = game.ctx.world;
    const p = world.player(world.localPlayer);
    return {
      won,
      durationSec: game.ctx.loop.simTime,
      wallSec: (performance.now() - this.matchStartMs) / 1000,
      stats: { ...p.stats },
      credits: Math.round(p.credits),
      factionName: factionByKey(this.setup.playerFaction)?.name ?? p.name,
      opponentName: world.players[1]?.name ?? 'Opponent',
      mapName: mapById(this.setup.map).name,
      difficulty: this.setup.difficulty,
      speed: GAME_SPEEDS[this.setup.speed] ?? 1,
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
    if (this.state === 'playing') this.game?.setPaused(document.hidden);
    // Hidden is the last event a mobile browser reliably fires before it kills
    // the page, and the profile store batches its writes. Flush here or a
    // mission completed in the final minute of a match is simply gone.
    if (document.hidden) progression.flushProfile();
  };

  private readonly onSettingsChanged = (settings: Settings, changed: readonly string[]): void => {
    if (this.game === null) return;
    applySettings(settings, this.game, changed);
  };

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

  constructor(private readonly mapName: string, private readonly factionName: string) {}

  mount(host: HTMLElement): void {
    host.classList.add('vm-load');
    this.root = host;

    const inner = el('div', 'vm-load-inner');
    inner.appendChild(el('p', 'vm-subtitle', 'Loading'));
    inner.appendChild(el('h1', 'vm-h2', this.mapName));

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
    inner.appendChild(el('p', 'vm-load-tip', TIPS[Math.floor(Math.random() * TIPS.length)]));

    host.appendChild(inner);
  }

  unmount(): void {
    this.root?.classList.remove('vm-load');
    this.root = null;
  }
}

/* ==========================================================================
 * 8. HELPERS
 * ========================================================================== */

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

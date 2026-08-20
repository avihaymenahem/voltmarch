/**
 * ============================================================================
 * src/shell/settings-store.ts — the persisted player preferences
 * ============================================================================
 * THE ONLY FILE IN THE SHELL WITH NO DOM AND NO ENGINE IMPORTS.
 *
 * Everything here is data plus pure functions over that data, for three
 * reasons:
 *
 *   1. It is unit-testable under `environment: 'node'`, which is what the rest
 *      of the suite runs under. `tests/shell.spec.ts` exercises the migration,
 *      the clamping, the keybind conflict detector and the match-query builder
 *      without a browser.
 *   2. The store must survive a settings file written by an OLDER build. A
 *      value that is missing, the wrong type, out of range, or a key that no
 *      longer exists must degrade to the default — never to a crash on the
 *      title screen, which is the single worst place in a game to crash.
 *   3. Applying the settings (pushing them into RENDER_CONFIG, the audio buses
 *      and the camera rig) is a SEPARATE concern and lives in `Settings.ts`.
 *      This file decides what the numbers are; that one decides what they do.
 *
 * STORAGE
 * -------
 * `localStorage` under one key, one JSON blob, with a `version` field. Storage
 * is injected (`StorageLike`) so tests pass a Map-backed stub and a browser
 * with storage disabled (private mode, embedded webview) degrades to an
 * in-memory store instead of throwing on first write.
 * ============================================================================
 */

import { persistentStorage } from '../platform/storage';

/* ==========================================================================
 * 1. SHAPES
 * ========================================================================== */

/** Pipeline fidelity bucket. `auto` re-runs the renderer's own detection. */
export type QualityChoice = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

/** Shadow map resolution bucket. `off` is expressed by `shadows: false`. */
export type ShadowChoice = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Frosted-glass HUD/menu panels.
 *
 * Structurally identical to `PanelBlurMode` in `src/render/renderer.ts`, and
 * deliberately re-declared rather than imported: this file has no engine
 * imports (see the header), and the renderer's copy is the one the policy is
 * written against. `Settings.ts` is the only place the two meet.
 */
export type PanelBlurChoice = 'auto' | 'on' | 'off';

export interface GraphicsSettings {
  /** Pipeline preset. Individual toggles below are applied ON TOP of it. */
  tier: QualityChoice;
  /** Multiplies the clamped device pixel ratio. 0.5 .. 2.0. */
  resolutionScale: number;
  /**
   * Let the renderer drop resolution below `resolutionScale` to hold 60 fps.
   *
   * **DEFAULT FALSE SINCE v2.14.0**, and the reason is the whole shape of
   * `calibrated` below. Reported: *"i want the adaptive resolution to be off by
   * default. instead, set the graphic options that match the best for user for
   * the first time and thats it"*.
   *
   * It stays available and it is a good controller — it is the largest single
   * performance lever this renderer has, and the one-way ratchet that used to
   * stop it ever restoring is fixed. But it is a PERMANENT NEGOTIATION with the
   * frame: on a GPU-bound machine it walks to its 0.55 floor within about half
   * a minute and upscales, which is indistinguishable from broken antialiasing
   * to anyone who does not know it is happening. That was reported too, and it
   * is why the Resolution Scale row had to grow a paragraph explaining why the
   * slider said 100% while the renderer was at 55%.
   *
   * The first-run calibration replaces it with a decision taken ONCE, from a
   * real measurement, that the player then owns.
   */
  adaptiveResolution: boolean;
  /**
   * Has this profile had its one-time hardware calibration?
   *
   * FALSE ON A FRESH PROFILE ONLY. `src/render/HardwareCalibration.ts` measures
   * two probe windows at two known pixel counts on the first battle, fits
   * `docs/RENDER_FINDINGS.md` §9's line, solves for the resolution scale that
   * meets 60 fps, writes it here and sets this true. It never runs again.
   *
   * THREE PROPERTIES THIS FIELD EXISTS TO GUARANTEE:
   *
   *   1. **A returning player is never recalibrated.** A settings blob written
   *      by an older build has no `calibrated` key, and `normalizeSettings`
   *      defaults a MISSING key to `true` for exactly that case — their
   *      graphics are already whatever they live with, and raising a setting
   *      somebody lowered is the failure this whole feature has to avoid.
   *      `defaultSettings()` (a profile with no stored blob at all) is the only
   *      thing that produces `false`.
   *   2. **Touching a Graphics row retires the calibration.** Every control on
   *      that tab writes `calibrated: true` alongside its own value, so a
   *      manual choice permanently wins — including one made before the first
   *      battle has even started.
   *   3. **The player can ask for it again.** "Calibrate Now" in Settings, and
   *      Reset Graphics, both put this back to `false`. Nothing else does.
   */
  calibrated: boolean;
  shadows: boolean;
  shadowQuality: ShadowChoice;
  /** Screen-space ambient occlusion. */
  ao: boolean;
  bloom: boolean;
  /** Master switch for the whole post chain (grade, SMAA, AO, bloom). */
  postFx: boolean;
  /** Subpixel morphological AA. */
  smaa: boolean;
  /**
   * 4x MSAA on the post chain's SCENE target. OFF by default, and deliberately
   * not tied to the quality tier.
   *
   * SMAA above is morphological: it reworks the finished image, so it can only
   * smooth an edge that was RASTERISED. A 1 px pipe or panel stripe whose
   * centre falls between pixel centres is absent from the image entirely, and
   * that is what makes thin greeble read as broken dashed lines. MSAA is the
   * only thing in this pipeline that can fix it, because it is the only thing
   * that samples COVERAGE.
   *
   * It is off because it is expensive in a way tier selection cannot predict.
   * The cost is memory bandwidth, and an integrated GPU sharing system memory
   * pays several times what a discrete card pays for the identical setting —
   * measured, this cost one reporter 7-8 fps of ~22 at `high`. Anyone whose
   * machine can afford it can switch it on and watch their own frame counter,
   * which is a better judge than a capability guess made at boot.
   */
  msaa: boolean;
  /**
   * Vignette strength — strong (0.28) when on, subtle (0.12) when off.
   *
   * This said "Film grain, vignette, chromatic aberration — the 'cinematic'
   * layer", and it drove all three. Grain and chromatic aberration are on
   * CLAUDE.md's explicit ban list and are now pinned to 0 in both arms of
   * `Settings.ts#applySettings`; only the vignette still moves. The KEY keeps
   * its old name so a stored profile still loads — renaming it would need a
   * schema migration for no player-visible gain.
   */
  filmGrain: boolean;
  /**
   * Frosted-glass HUD/menu panels. `auto` disables it on macOS/iOS, where
   * compositing a `backdrop-filter` over the WebGL canvas drops black frames.
   * Purely a CSS gate — nothing in the render pipeline reads it.
   */
  panelBlur: PanelBlurChoice;
  /**
   * The top-left performance overlay (`src/ui/PerfHud.ts`).
   *
   * OFF by default and stored on `graphics` rather than `gameplay` because it
   * is a diagnostic for the picture, not an interface preference: it sits with
   * Resolution Scale and the post toggles, which are the other rows a player
   * touches when the frame rate misbehaves. `src/ui/perf.system.ts` subscribes
   * to this store rather than being pushed by `applySettings` — the HUD chunk
   * must not depend on the shell existing.
   */
  perfOverlay: boolean;
  /** Vertical field of view in degrees. 28 .. 52. */
  fov: number;
  /** Camera dolly limits in metres. */
  minZoom: number;
  maxZoom: number;
  /** 0 = present every frame (vsync). Otherwise frames per second. */
  fpsCap: number;
}

export interface AudioSettings {
  /** All 0..100. The engine applies a perceptual 2.2 curve on top. */
  master: number;
  music: number;
  sfx: number;
  voice: number;
  ui: number;
  ambience: number;
  muted: boolean;
}

/**
 * Which pointing device the camera should assume.
 *
 * `auto` runs the wheel-event heuristic in `src/render/camera.ts`. The two
 * explicit values exist because that heuristic has one genuine blind spot — a
 * mouse wheel on macOS, where the OS applies scroll acceleration and the
 * browser reports small deltas indistinguishable from a slow trackpad swipe —
 * and a player stuck in the wrong mode has no working camera at all.
 */
export type PointerDeviceChoice = 'auto' | 'mouse' | 'trackpad';

/**
 * What a plain two-finger trackpad scroll does. **`'zoom'` is the default.**
 *
 * The camera shipped with `'pan'` — the macOS maps convention, two fingers move
 * the document and only a pinch scales it. Reported by a Mac player as
 * *"cant zoom or scroll on z"*: an RTS is not a map, scroll-to-zoom is close to
 * universal in the genre, and the product offered no way to get it. `'pan'` is
 * kept rather than deleted because the convention is real; neither value can
 * take a gesture away, since Shift + two fingers and a sideways swipe pan in
 * both, and pinch / Ctrl / Alt zoom in both.
 */
export type TrackpadScrollChoice = 'zoom' | 'pan';

export interface GameplaySettings {
  /**
   * Screen-edge panning. **Off by default.** See `CAMERA.edgePanPixels` in
   * core/config for why: on a laptop the cursor reaches an edge every time the
   * player touches the HUD, and the camera runs away on its own.
   */
  edgeScroll: boolean;
  /** Metres/second at the default dolly. 10 .. 120. */
  edgeScrollSpeed: number;
  /** Keyboard/drag pan speed, metres/second at the default dolly. */
  panSpeed: number;
  /** 0 = wheel zooms to the screen centre, 1 = fully to the cursor. */
  zoomToCursor: number;

  /* -- pointer / trackpad navigation ------------------------------------- */

  pointerDevice: PointerDeviceChoice;
  /**
   * Two-finger trackpad scroll: dolly (default) or pan. See
   * `TrackpadScrollChoice`. No `SETTINGS_VERSION` bump — this row has never
   * existed on disk, so "fill in the default" reaches every stored blob, which
   * is exactly the case the version gate is NOT for.
   */
  trackpadScroll: TrackpadScrollChoice;
  /** Multiplier on trackpad two-finger pan and drag pan. 0.25 .. 3. */
  panSensitivity: number;
  /** Multiplier on wheel dolly and pinch zoom. 0.25 .. 3. */
  zoomSensitivity: number;
  invertPanX: boolean;
  invertPanY: boolean;
  invertZoom: boolean;
  /**
   * true = a drag GRABS the world, so the ground follows the cursor.
   * false = the camera follows the cursor instead.
   */
  dragPanNatural: boolean;
  /** Pan carries inertia and settles instead of stopping dead. */
  cameraMomentum: boolean;

  tooltips: boolean;
  damageNumbers: boolean;
  screenShake: number;
  /** Show the EVA/announcer subtitle line. */
  subtitles: boolean;
  /**
   * Situational in-match tips.
   *
   * ON by default, and READ — `src/sim/tips.system.ts` is its consumer and
   * landed in the same commit as this row, deliberately: four rows on this
   * interface are persisted, normalised and consumed by nobody, and a fifth
   * would be indistinguishable from them. See `TIPS_BUILD_SPEC.md` §6.
   *
   * No `SETTINGS_VERSION` bump. `normalizeSettings` is total over any input,
   * so a blob written before this row existed comes back with the default.
   * The reader is written so that even the un-normalised absence is OFF rather
   * than defaulted on; the reason is in its own header.
   */
  tips: boolean;
}

/** One physical chord. `code` is a `KeyboardEvent.code`, never a `key`. */
export interface Chord {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/**
 * Which keyboard "surface" a binding lives on. Two bindings only conflict when
 * their scopes overlap — the camera's pan-left and the order layer's
 * attack-move genuinely share `KeyA` today and that is not a bug.
 */
export type BindScope = 'global' | 'camera' | 'command';

export interface KeybindDef {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly scope: BindScope;
  readonly def: Chord;
  /** True when the engine does not read this binding yet (see the header). */
  readonly advisory?: boolean;
}

export interface ControlsSettings {
  /** id -> chord. Ids not in KEYBINDS are dropped on load. */
  bindings: Record<string, Chord>;
}

export interface Settings {
  version: number;
  graphics: GraphicsSettings;
  audio: AudioSettings;
  gameplay: GameplaySettings;
  controls: ControlsSettings;
}

/**
 * Bumped only when a migration cannot be expressed as "fill in the default".
 *
 * v2: the camera pan rows moved from WASD to the arrow keys. A stored v1 blob
 * has WASD written into it explicitly, so "fill in the default" cannot reach it
 * — and leaving it would hand every existing player the A/S order collision the
 * new defaults exist to avoid. See `migrateBindings`.
 *
 * v3: `adaptiveResolution` defaults to false. Same shape as v2 — every stored
 * blob has `true` written into it explicitly, because that was the old default,
 * so filling in the new default cannot reach one. See `migrateAdaptive`.
 */
export const SETTINGS_VERSION = 3;

/** The v1 camera pan defaults, kept only so the v2 migration can recognise them. */
const V1_PAN_DEFAULTS: Readonly<Record<string, string>> = {
  'cam.panUp': 'KeyW',
  'cam.panDown': 'KeyS',
  'cam.panLeft': 'KeyA',
  'cam.panRight': 'KeyD',
};

export const SETTINGS_STORAGE_KEY = 'voltmarch.settings.v1';
export const SETUP_STORAGE_KEY = 'voltmarch.setup.v1';

/* ==========================================================================
 * 2. KEYBINDS
 *
 * The defaults are a transcription of what the engine ACTUALLY does today —
 * `src/render/camera.ts` for the camera surface and `src/input/input.system.ts`
 * for the order surface. They are listed here so the player can see the whole
 * control scheme in one place and rebind it.
 *
 * The eight `ord.*` / `cam.home` rows are LIVE: `input.system.ts` resolves
 * every order hotkey against `window.__vmSettings` and re-resolves on every
 * store change, so rebinding one of them here rebinds the game on the next
 * keystroke. `advisory` marks the rows that are still display-only.
 * ========================================================================== */

function chord(code: string, mods?: { ctrl?: boolean; shift?: boolean; alt?: boolean }): Chord {
  return {
    code,
    ctrl: mods?.ctrl === true,
    shift: mods?.shift === true,
    alt: mods?.alt === true,
  };
}

export const KEYBINDS: readonly KeybindDef[] = [
  /* -- camera --------------------------------------------------------------
   * The pan rows default to the ARROW keys, not WASD.
   *
   * They said WASD for a long time and the engine has always panned on arrows,
   * so the four most prominent rows on the Controls tab described a control
   * scheme that did not exist. Two ways to end that; this is the one that does
   * not arm a collision. `ord.attackMove` is KeyA and `ord.stop` is KeyS, and
   * `findConflicts` deliberately does not flag camera-vs-order overlap — so
   * defaulting pan to WASD would make every tap of A both pan the camera and
   * arm attack-move. Arrows collide with nothing.
   *
   * `input.system.ts` resolves these rows live, so a player who wants WASD gets
   * a working WASD by rebinding — and the arrow keys keep panning regardless.  */
  { id: 'cam.panUp', label: 'Pan Forward', category: 'Camera', scope: 'camera', def: chord('ArrowUp') },
  { id: 'cam.panDown', label: 'Pan Back', category: 'Camera', scope: 'camera', def: chord('ArrowDown') },
  { id: 'cam.panLeft', label: 'Pan Left', category: 'Camera', scope: 'camera', def: chord('ArrowLeft') },
  { id: 'cam.panRight', label: 'Pan Right', category: 'Camera', scope: 'camera', def: chord('ArrowRight') },
  { id: 'cam.rotateLeft', label: 'Rotate Left', category: 'Camera', scope: 'camera', def: chord('KeyQ') },
  { id: 'cam.rotateRight', label: 'Rotate Right', category: 'Camera', scope: 'camera', def: chord('KeyE') },
  /* No `advisory`. These are polled live by `input.system.ts` exactly as the
   * pan and rotate rows above are, and `tests/action-catalogue.spec.ts` checks
   * `a.live === false` against `k.advisory === true` in BOTH directions — so a
   * stray flag here is a red test rather than a row that lies. No
   * `SETTINGS_VERSION` bump either: a blob written before these rows existed
   * has no entry for them, and `normalizeSettings` fills in the default, which
   * is the whole distinction the version gate exists to draw. */
  { id: 'cam.zoomIn', label: 'Zoom In', category: 'Camera', scope: 'camera', def: chord('Equal') },
  { id: 'cam.zoomOut', label: 'Zoom Out', category: 'Camera', scope: 'camera', def: chord('Minus') },
  { id: 'cam.home', label: 'Centre On Base', category: 'Camera', scope: 'command', def: chord('KeyH') },

  /* -- orders ------------------------------------------------------------- */
  { id: 'ord.attackMove', label: 'Attack Move', category: 'Orders', scope: 'command', def: chord('KeyA') },
  { id: 'ord.stop', label: 'Stop', category: 'Orders', scope: 'command', def: chord('KeyS') },
  { id: 'ord.guard', label: 'Guard', category: 'Orders', scope: 'command', def: chord('KeyG') },
  { id: 'ord.scatter', label: 'Scatter', category: 'Orders', scope: 'command', def: chord('KeyX') },
  { id: 'ord.deploy', label: 'Deploy', category: 'Orders', scope: 'command', def: chord('KeyD') },
  { id: 'ord.forceAttack', label: 'Force Fire', category: 'Orders', scope: 'command', def: chord('KeyF') },
  { id: 'ord.rally', label: 'Set Rally Point', category: 'Orders', scope: 'command', def: chord('KeyY') },
  { id: 'ord.stance', label: 'Cycle Stance', category: 'Orders', scope: 'command', def: chord('KeyZ') },
  // Shift+F: every unmodified letter is already taken, and F is Force Fire,
  // which is the nearest neighbour in meaning. See `ord.ability` in
  // `src/input/ActionCatalogue.ts`, which this row has to agree with — the
  // catalogue owns the default and this owns whether it can be rebound.
  { id: 'ord.ability', label: 'Commander Ability', category: 'Orders', scope: 'command', def: chord('KeyF', { shift: true }) },

  /* -- selection ---------------------------------------------------------- *
   * "Clear Selection" is deliberately NOT listed. The engine hard-codes it to
   * Escape, and the shell claims Escape in the capture phase for the pause
   * menu, so the engine never sees that key during a match. Listing a command
   * the player cannot actually reach is worse than not listing it — clicking
   * empty ground is the reachable way to deselect.
   *
   * `sel.allArmy` IS reachable, but it is resolved ahead of the binding table
   * in `input.system.ts` because Ctrl+A shares its code with Attack Move.      */
  { id: 'sel.allArmy', label: 'Select All Army', category: 'Selection', scope: 'command', def: chord('KeyA', { ctrl: true }) },

  /* -- system ------------------------------------------------------------- */
  { id: 'sys.menu', label: 'Pause Menu', category: 'System', scope: 'global', def: chord('Escape') },
  { id: 'sys.speed', label: 'Cycle Game Speed', category: 'System', scope: 'global', def: chord('Backslash'), advisory: true },
  { id: 'sys.perf', label: 'Performance Overlay', category: 'System', scope: 'global', def: chord('F3') },
  { id: 'sys.screenshot', label: 'Save Screenshot', category: 'System', scope: 'global', def: chord('F12'), advisory: true },
];

const KEYBIND_BY_ID = new Map<string, KeybindDef>(KEYBINDS.map((k) => [k.id, k]));

export function keybindDef(id: string): KeybindDef | undefined {
  return KEYBIND_BY_ID.get(id);
}

/** Category names in display order, derived from KEYBINDS so they cannot drift. */
export function keybindCategories(): string[] {
  const out: string[] = [];
  for (const k of KEYBINDS) if (!out.includes(k.category)) out.push(k.category);
  return out;
}

/* -- chord helpers ---------------------------------------------------------- */

export function chordEquals(a: Chord | undefined, b: Chord | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a.code === b.code && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt;
}

/** Codes we refuse to bind: they are the browser's, not ours. */
const RESERVED_CODES = new Set(['F5', 'F11', 'Tab', 'MetaLeft', 'MetaRight', 'ContextMenu']);

export function isBindableCode(code: string): boolean {
  if (code === '' || RESERVED_CODES.has(code)) return false;
  // A bare modifier is never a binding on its own.
  return !/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(code);
}

/**
 * Human label for a `KeyboardEvent.code`. Deliberately table-driven rather than
 * `event.key`: `key` is layout-dependent and would print "ц" on a Cyrillic
 * keyboard for the same physical W the game actually binds.
 */
export function codeLabel(code: string): string {
  if (code === '') return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return `${code.slice(5)} Arrow`;
  const named: Record<string, string> = {
    Space: 'Space', Escape: 'Esc', Enter: 'Enter', Backspace: 'Backspace',
    Backslash: '\\', Slash: '/', Comma: ',', Period: '.', Semicolon: ';',
    Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=',
    Backquote: '`', CapsLock: 'Caps', Delete: 'Del', Insert: 'Ins',
    Home: 'Home', End: 'End', PageUp: 'Pg Up', PageDown: 'Pg Dn', Tab: 'Tab',
  };
  return named[code] ?? code;
}

/** Full printable label for a chord, e.g. `CTRL + A`. */
export function chordLabel(c: Chord | undefined): string {
  if (c === undefined || c.code === '') return 'UNBOUND';
  const parts: string[] = [];
  if (c.ctrl) parts.push('CTRL');
  if (c.shift) parts.push('SHIFT');
  if (c.alt) parts.push('ALT');
  parts.push(codeLabel(c.code));
  return parts.join(' + ');
}

/** True when two scopes share a keyboard surface. */
function scopesOverlap(a: BindScope, b: BindScope): boolean {
  return a === 'global' || b === 'global' || a === b;
}

export interface BindConflict {
  a: string;
  b: string;
  chord: Chord;
}

/**
 * Every pair of bindings that would fire together. Reported as pairs rather
 * than as a boolean so the Settings screen can mark BOTH rows red and name the
 * other command, which is the difference between "that is taken" and "taken by
 * what?".
 */
export function findConflicts(bindings: Record<string, Chord>): BindConflict[] {
  const out: BindConflict[] = [];
  for (let i = 0; i < KEYBINDS.length; i++) {
    const da = KEYBINDS[i];
    const ca = bindings[da.id];
    if (ca === undefined || ca.code === '') continue;
    for (let j = i + 1; j < KEYBINDS.length; j++) {
      const db = KEYBINDS[j];
      const cb = bindings[db.id];
      if (cb === undefined || cb.code === '') continue;
      if (!scopesOverlap(da.scope, db.scope)) continue;
      if (chordEquals(ca, cb)) out.push({ a: da.id, b: db.id, chord: ca });
    }
  }
  return out;
}

/** Ids involved in at least one conflict — the set the UI paints red. */
export function conflictingIds(bindings: Record<string, Chord>): Set<string> {
  const set = new Set<string>();
  for (const c of findConflicts(bindings)) {
    set.add(c.a);
    set.add(c.b);
  }
  return set;
}

/** The stock control scheme. A fresh object every call; callers mutate it. */
export function defaultBindings(): Record<string, Chord> {
  const out: Record<string, Chord> = {};
  for (const k of KEYBINDS) out[k.id] = { ...k.def };
  return out;
}

/* ==========================================================================
 * 3. DEFAULTS
 * ========================================================================== */

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    graphics: {
      tier: 'auto',
      resolutionScale: 1.0,
      // Off. The one-time calibration below replaces it — see the field docs.
      adaptiveResolution: false,
      calibrated: false,
      shadows: true,
      shadowQuality: 'high',
      ao: true,
      bloom: true,
      postFx: true,
      smaa: true,
      msaa: false,
      filmGrain: true,
      panelBlur: 'auto',
      perfOverlay: false,
      fov: 36,
      minZoom: 30,
      maxZoom: 140,
      fpsCap: 0,
    },
    audio: {
      master: 80,
      music: 65,
      sfx: 85,
      voice: 90,
      ui: 70,
      ambience: 60,
      muted: false,
    },
    gameplay: {
      edgeScroll: false,
      edgeScrollSpeed: 46,
      panSpeed: 42,
      zoomToCursor: 0.75,
      pointerDevice: 'auto',
      trackpadScroll: 'zoom',
      panSensitivity: 1.0,
      zoomSensitivity: 1.0,
      invertPanX: false,
      invertPanY: false,
      invertZoom: false,
      dragPanNatural: true,
      cameraMomentum: true,
      tooltips: true,
      damageNumbers: false,
      screenShake: 1.0,
      subtitles: true,
      tips: true,
    },
    controls: { bindings: defaultBindings() },
  };
}

/* ==========================================================================
 * 4. NORMALISATION
 *
 * Every value that comes back out of storage goes through here. The rule is
 * absolute: this function returns a complete, in-range `Settings` for ANY
 * input, including `null`, a string, an array, or an object written by a build
 * that does not exist yet.
 * ========================================================================== */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const QUALITY_CHOICES: readonly QualityChoice[] = ['auto', 'low', 'medium', 'high', 'ultra'];
const SHADOW_CHOICES: readonly ShadowChoice[] = ['low', 'medium', 'high', 'ultra'];
export const POINTER_DEVICE_CHOICES: readonly PointerDeviceChoice[] = ['auto', 'mouse', 'trackpad'];
export const TRACKPAD_SCROLL_CHOICES: readonly TrackpadScrollChoice[] = ['zoom', 'pan'];
export const PANEL_BLUR_CHOICES: readonly PanelBlurChoice[] = ['auto', 'on', 'off'];

/** Frame caps offered in the UI. 0 is "vsync / uncapped". */
export const FPS_CAPS: readonly number[] = [0, 30, 60, 90, 120, 144, 240];

function normalizeChord(v: unknown, fallback: Chord): Chord {
  if (!isRecord(v)) return { ...fallback };
  const code = typeof v.code === 'string' ? v.code : '';
  // An empty code is a legitimate "unbound"; anything unbindable is not.
  if (code !== '' && !isBindableCode(code)) return { ...fallback };
  return {
    code,
    ctrl: bool(v.ctrl, false),
    shift: bool(v.shift, false),
    alt: bool(v.alt, false),
  };
}

/**
 * Version-gated binding fixes, applied in place after normalisation.
 *
 * v1 -> v2 moves camera pan off WASD, but ONLY where the player never touched
 * it. A stored `KeyW` that is the untouched v1 default and a stored `KeyW` the
 * player chose are the same bytes, so the tie is broken in the player's favour:
 * a blob whose four pan rows are exactly the v1 set is treated as untouched;
 * change any one of them and the whole group is left alone.
 */
function migrateBindings(bindings: Record<string, Chord>, version: number): void {
  if (version >= 2 || version === 0) return;

  const ids = Object.keys(V1_PAN_DEFAULTS);
  const untouched = ids.every((id) => {
    const c = bindings[id];
    return c !== undefined && c.code === V1_PAN_DEFAULTS[id] && !c.ctrl && !c.shift && !c.alt;
  });
  if (!untouched) return;

  for (const id of ids) {
    const def = keybindDef(id);
    if (def !== undefined) bindings[id] = { ...def.def };
  }
}

/**
 * v3: `adaptiveResolution` off by default.
 *
 * SAME SHAPE AS `migrateBindings` AND WITH THE SAME HONEST LIMIT. A stored blob
 * carries `adaptiveResolution: true` whether the player chose it or inherited it
 * as the old default, and nothing distinguishes the two — so this reads `true`
 * on a pre-v3 blob as "untouched old default" and takes it off. Somebody who
 * genuinely liked it flips one toggle once; the alternative is that the new
 * default reaches nobody who has ever played the game, which is not a default.
 *
 * An explicit `false` is already the new value and is left exactly as it is.
 *
 * `version === 0` is skipped for the same reason `migrateBindings` skips it: a
 * blob with no readable version is not a v1 or v2 blob, it is something else.
 */
function migrateAdaptive(raw: unknown, version: number, fallback: boolean): boolean {
  if (version > 0 && version < 3 && raw === true) return false;
  return bool(raw, fallback);
}

/** Total, defensive, order-independent. See the section header. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isRecord(raw)) return d;

  /*
   * A STORED BLOB MEANS THIS PROFILE HAS ALREADY PLAYED, and that is the only
   * evidence available for `graphics.calibrated` below. A blob written before
   * calibration existed has no such key; defaulting it to `false` would put
   * every returning player through a calibration that could raise a setting
   * they had deliberately lowered. `defaultSettings()` — the no-blob path
   * above — is the one route to `false`.
   */
  const hasStoredGraphics = isRecord(raw.graphics);
  const g = isRecord(raw.graphics) ? raw.graphics : {};
  const storedVersion = num(raw.version, 0, 1e6, 0);
  const a = isRecord(raw.audio) ? raw.audio : {};
  const p = isRecord(raw.gameplay) ? raw.gameplay : {};
  const c = isRecord(raw.controls) ? raw.controls : {};
  const rawBinds = isRecord(c.bindings) ? c.bindings : {};

  const bindings: Record<string, Chord> = {};
  for (const k of KEYBINDS) bindings[k.id] = normalizeChord(rawBinds[k.id], k.def);
  migrateBindings(bindings, storedVersion);

  const minZoom = num(g.minZoom, 8, 260, d.graphics.minZoom);
  const maxZoom = num(g.maxZoom, 8, 400, d.graphics.maxZoom);

  return {
    version: SETTINGS_VERSION,
    graphics: {
      tier: oneOf(g.tier, QUALITY_CHOICES, d.graphics.tier),
      resolutionScale: num(g.resolutionScale, 0.5, 2.0, d.graphics.resolutionScale),
      adaptiveResolution: migrateAdaptive(g.adaptiveResolution, storedVersion, d.graphics.adaptiveResolution),
      calibrated: bool(g.calibrated, hasStoredGraphics),
      shadows: bool(g.shadows, d.graphics.shadows),
      shadowQuality: oneOf(g.shadowQuality, SHADOW_CHOICES, d.graphics.shadowQuality),
      ao: bool(g.ao, d.graphics.ao),
      bloom: bool(g.bloom, d.graphics.bloom),
      postFx: bool(g.postFx, d.graphics.postFx),
      smaa: bool(g.smaa, d.graphics.smaa),
      msaa: bool(g.msaa, d.graphics.msaa),
      filmGrain: bool(g.filmGrain, d.graphics.filmGrain),
      panelBlur: oneOf(g.panelBlur, PANEL_BLUR_CHOICES, d.graphics.panelBlur),
      perfOverlay: bool(g.perfOverlay, d.graphics.perfOverlay),
      fov: num(g.fov, 24, 60, d.graphics.fov),
      minZoom: Math.min(minZoom, maxZoom - 4),
      maxZoom: Math.max(maxZoom, minZoom + 4),
      fpsCap: FPS_CAPS.includes(num(g.fpsCap, 0, 240, 0)) ? num(g.fpsCap, 0, 240, 0) : d.graphics.fpsCap,
    },
    audio: {
      master: num(a.master, 0, 100, d.audio.master),
      music: num(a.music, 0, 100, d.audio.music),
      sfx: num(a.sfx, 0, 100, d.audio.sfx),
      voice: num(a.voice, 0, 100, d.audio.voice),
      ui: num(a.ui, 0, 100, d.audio.ui),
      ambience: num(a.ambience, 0, 100, d.audio.ambience),
      muted: bool(a.muted, d.audio.muted),
    },
    gameplay: {
      edgeScroll: bool(p.edgeScroll, d.gameplay.edgeScroll),
      edgeScrollSpeed: num(p.edgeScrollSpeed, 10, 120, d.gameplay.edgeScrollSpeed),
      panSpeed: num(p.panSpeed, 10, 120, d.gameplay.panSpeed),
      zoomToCursor: num(p.zoomToCursor, 0, 1, d.gameplay.zoomToCursor),
      pointerDevice: oneOf(p.pointerDevice, POINTER_DEVICE_CHOICES, d.gameplay.pointerDevice),
      trackpadScroll: oneOf(p.trackpadScroll, TRACKPAD_SCROLL_CHOICES, d.gameplay.trackpadScroll),
      panSensitivity: num(p.panSensitivity, 0.25, 3, d.gameplay.panSensitivity),
      zoomSensitivity: num(p.zoomSensitivity, 0.25, 3, d.gameplay.zoomSensitivity),
      invertPanX: bool(p.invertPanX, d.gameplay.invertPanX),
      invertPanY: bool(p.invertPanY, d.gameplay.invertPanY),
      invertZoom: bool(p.invertZoom, d.gameplay.invertZoom),
      dragPanNatural: bool(p.dragPanNatural, d.gameplay.dragPanNatural),
      cameraMomentum: bool(p.cameraMomentum, d.gameplay.cameraMomentum),
      tooltips: bool(p.tooltips, d.gameplay.tooltips),
      damageNumbers: bool(p.damageNumbers, d.gameplay.damageNumbers),
      screenShake: num(p.screenShake, 0, 2, d.gameplay.screenShake),
      subtitles: bool(p.subtitles, d.gameplay.subtitles),
      tips: bool(p.tips, d.gameplay.tips),
    },
    controls: { bindings },
  };
}

/* ==========================================================================
 * 5. MATCH SETUP
 *
 * The skirmish screen's output. It is persisted separately from the settings
 * because it is "what I last played", not "how I like the game", and the two
 * have completely different reset semantics.
 * ========================================================================== */

/** One selectable battlefield. Terrain reads `biome`, scatter/ore read `preset`. */
export interface MapChoice {
  readonly id: string;
  readonly name: string;
  /** `?biome=` — one of src/world/Biomes.ts BIOME_NAMES. */
  readonly biome: 'temperate' | 'desert' | 'snow' | 'urban';
  /** `?map=` — one of core/config MAP_PRESETS. Drives ore, props, mood. */
  readonly preset: string;
  /** `?mapseed=` — the landform roll. Fixed per map so a map IS a map. */
  readonly mapSeed: number;
  /** Advisory `?art=` mood. */
  readonly mood: string;
  readonly blurb: string;
  /**
   * The MOST armies this battlefield can seat, 2 or 4.
   *
   * It said "always 2 in this build" and it was true: every entry declared 2,
   * `MatchSetup` carried one opponent, and nothing anywhere read the field. It
   * is now the number the lobby offers and the number `normalizeSetup` clamps
   * the army list to, so a map that says 2 CANNOT be launched as a four-way.
   *
   * WHY SOME AND NOT ALL. Two armies open on the authored diagonal
   * (`SKIRMISH_START_OFFSETS`); three or more fan around the map centre on the
   * same ellipse, with no reserved terrain shelf. That fan is fine on ground
   * with no strong axis to it and wrong on ground that has one — `frozen-sector`
   * is cliffs that channel every push into one lane, and both water maps put a
   * shoreline through the middle, which is a two-sided shape by construction. So
   * the open maps take four and the authored-for-two maps keep their number,
   * rather than every map claiming a layout it does not have.
   */
  readonly players: number;
}

export const MAPS: readonly MapChoice[] = [
  {
    id: 'temperate-valley', name: 'Temperate Valley', biome: 'temperate', preset: 'temperate',
    mapSeed: 0x7e44a1, mood: 'noon', players: 4,
    blurb: 'Low plateaus, scattered woodland, three ore fields on the diagonal.',
  },
  {
    id: 'airbase-flats', name: 'Airbase Flats', biome: 'desert', preset: 'arid',
    mapSeed: 0x3ba9f1, mood: 'noon', players: 4,
    blurb: 'Bare, hot and open. Long sightlines, nowhere to hide armour.',
  },
  {
    id: 'frozen-sector', name: 'Frozen Sector', biome: 'snow', preset: 'snow',
    mapSeed: 0x51c0de, mood: 'overcast', players: 2,
    blurb: 'High relief under flat grey light. Cliffs channel every push.',
  },
  {
    id: 'industrial-grid', name: 'Industrial Grid', biome: 'urban', preset: 'urban',
    mapSeed: 0x1d0c17, mood: 'dusk', players: 4,
    blurb: 'Roads, kerbs and container stacks. Almost no relief, all cover.',
  },
  {
    id: 'contested-strait', name: 'Contested Strait', biome: 'temperate', preset: 'coast',
    mapSeed: 0x0cea11, mood: 'noon', players: 2,
    blurb: 'A shoreline through the middle. Naval yards earn their cost here.',
  },
  {
    id: 'coral-shore', name: 'Coral Shore', biome: 'temperate', preset: 'tropical',
    mapSeed: 0xc0aa11, mood: 'noon', players: 2,
    blurb: 'Dense canopy and wet ground. The highest prop count in the game.',
  },
  /*
   * THE FOUR-ARMY ISLAND MAP, and the one entry where every field is
   * load-bearing rather than descriptive.
   *
   * `preset: 'atoll'` is what reaches `MAP_SEAS` and carves four islands
   * instead of a half-plane; `biome: 'temperate'` is argued in `MAP_PRESETS`,
   * where it beat `desert` on two FATAL scorecard checks. `players: 4` is not a
   * claim about the ground — `startPointsFor` reads the island list and answers
   * with one start per island, so the number and the terrain come from the same
   * array and cannot drift.
   *
   * `mapSeed` reads as ATOLL in hex, in the spirit of `0x0cea11` and
   * `0xc0aa11`. It must stay unique: `Replays.replayMap` identifies a
   * recording's battlefield by seed first.
   *
   * A STARTER, deliberately, and it is the only map in the roster that ships
   * open without being one of the two originals. Everything the naval arm
   * exists for is unreachable on a landlocked map, and the two seas that do
   * exist are both behind mission gates — so on a fresh profile the entire
   * naval and amphibious layer was content nobody could see. See
   * `STARTER_MAPS` in `src/shell/SkirmishSetup.ts`.
   */
  {
    id: 'sunder-atoll', name: 'Sunder Atoll', biome: 'temperate', preset: 'atoll',
    mapSeed: 0xa7011, mood: 'noon', players: 4,
    blurb: 'Four islands, no land route. Every crossing is by sea or not at all.',
  },

  /*
   * THREE PRESET-CLONES USED TO SIT HERE, AND THE ROSTER IS SEVEN AGAIN.
   *
   * `saltpan-reach` (arid, 2p, dusk), `foundry-line` (urban, 2p, noon) and
   * `glacier-shelf` (snow, 4p, overcast) were added in v2.6.0 as payloads: the
   * commander powers had stopped being a mission reward, five missions were
   * left paying nothing, and a map unlock is read by `mapAvailable` in
   * `src/shell/SkirmishSetup.ts`, so three new rows here closed three of the
   * five holes.
   *
   * They were removed because the argument that justified them is the argument
   * against them. Each reused an existing `MAP_PRESET` VERBATIM — arid, urban
   * and snow — which was written down as a virtue ("a preset is a balance
   * surface, so inventing three would be three new things to tune"). What that
   * buys is three rows whose seven balance numbers (relief, cliffs, water,
   * scatter, urban, oreRichness, props) are identical to a map already in the
   * list. `mapSeed` rerolls the landform and `players`/`mood` change the framing,
   * but a player picking Saltpan Reach over Airbase Flats was choosing a
   * different roll of the same battlefield, and the lobby sold it as a reward.
   *
   * WHAT IT COST, so nobody re-adds them to fix it: each was the SOLE reward of
   * one mission, and there is no ungated content left to repay those three. See
   * the retirement block inside `UNLOCKS` in `src/data/Missions.ts` for the
   * survey — the short version is that the def catalogue has no four-army,
   * off-opening-path family left that is not naval.
   */
];

export function mapById(id: string): MapChoice {
  for (const m of MAPS) if (m.id === id) return m;
  return MAPS[0];
}

/**
 * The most armies any battlefield in the roster offers.
 *
 * DERIVED, not declared. `MAX_PLAYERS` in core/config is 8 and every
 * `MAX_PLAYERS`-sized array in the sim is already that wide, so the engine is
 * not what caps a skirmish — the map list is. Reading the cap back off `MAPS`
 * means adding a six-army map is one line in one table and the lobby, the
 * clamps and the tests all follow.
 */
export const MAX_ARMIES: number = MAPS.reduce((n, m) => Math.max(n, m.players), 2);

/** AI difficulty names, mirroring core/config AI_DIFFICULTY order. */
export const DIFFICULTIES: readonly string[] = ['Easy', 'Normal', 'Hard', 'Brutal'];
/** AI personality names, mirroring core/config AI_PERSONALITY order. */
export const PERSONALITIES: readonly string[] = ['Turtle', 'Rusher', 'Boomer'];
/** Game speed multipliers, mirroring core/config GAME_SPEEDS. */
export const SPEEDS: readonly number[] = [0.5, 1.0, 1.5, 2.0];
/** Starting bank options. */
export const CREDIT_OPTIONS: readonly number[] = [2000, 5000, 10000, 20000, 50000];

/**
 * One AI army. There are one, two or three of these in a match.
 *
 * A SEPARATE SHAPE RATHER THAN THREE PARALLEL ARRAYS, because the three fields
 * only mean anything together: an army is a side, a difficulty and a
 * personality, and a lobby that could get them out of step by one index would
 * hand the player a Brutal Turtle they configured as an Easy Rusher.
 */
export interface OpponentSetup {
  /** FactionDef.key. */
  faction: string;
  /** Index into DIFFICULTIES. */
  difficulty: number;
  /** Index into PERSONALITIES, or -1 for "let the AI choose". */
  personality: number;
  /**
   * WHICH SIDE OF THE WAR THIS ARMY IS ON. Armies sharing a number are allied;
   * every other number is an enemy. `TEAM_PLAYER` (1) is the human's team, so
   * `team: 1` means "fights alongside me" and anything else means "fights me".
   *
   * A NUMBER PER ARMY, NOT A MODE ENUM. A `'ffa' | '2v2' | '1v3'` field
   * enumerates PARTITIONS, and it cannot say the one thing a lobby has to say —
   * WHICH opponent is the ally — nor survive the Sides row moving from four
   * armies to three, where half its members stop meaning anything. A number per
   * army IS a partition, is total at every seat count, and cannot get out of
   * index-step with the army it describes: exactly the argument this interface
   * already makes for being one shape rather than three parallel arrays.
   *
   * THERE IS DELIBERATELY NO `playerTeam` ON `MatchSetup`. The human's team is
   * a LABEL, not a fact — every partition of the armies can be relabelled so
   * the human's part is 1 — so a second field would carry no information and
   * would only have to agree with this one, which is how two fields come to
   * disagree. `teamsOf` is the one derivation and it seats the human at
   * `TEAM_PLAYER` by construction.
   *
   * A STORED BLOB FROM ANY OLDER BUILD HAS NO `team` AND THAT IS A FACT, not a
   * gap: every match that build could describe was a free-for-all, which is
   * what `normalizeOpponent`'s default reproduces exactly. No schema version
   * moves for this — a blob written HERE carries a key an older build ignores,
   * and that build then reads the free-for-all it is able to play.
   */
  team: number;
}

/**
 * The human's team. Opponents carrying it are allies; everything else is an
 * enemy. `1` rather than `0` so that "no team set" (a `0` off a hand-written
 * literal or a corrupt blob) clamps UP into a real team rather than silently
 * meaning "allied with the player".
 */
export const TEAM_PLAYER = 1;

/**
 * The free-for-all team for opponent `index`: every army on its own side.
 *
 * `index + 2` — never `TEAM_PLAYER` — so the default the migration, the
 * default setup and `withArmyCount` all reach for is the diplomacy this game
 * has always had. `PlayerState.allyMask` defaults to self-only, so a setup
 * built entirely out of these values makes the team writer a no-op.
 */
export function defaultTeamFor(index: number): number {
  return index + 2;
}

/**
 * The lobby's output.
 *
 * `opponents` IS THE TRUTH; `aiFaction`, `difficulty` and `personality` ARE A
 * MIRROR OF `opponents[0]`, maintained by `normalizeSetup` and by nothing else.
 *
 * That redundancy is deliberate and is the whole backward-compatibility story.
 * Six things outside this file read the singular fields and none of them has any
 * business growing an array: the save index context (`save.system.ts`
 * `ServiceContext`, which is written into every slot and must stay key-stable),
 * the load screen's slot rows, the end screen's opponent chip, `?ai=` / `?aip=`
 * on the boot URL, and two tests. Keeping the pair in step costs four lines here
 * and means a `voltmarch.setup.v1` blob written by any older build still loads,
 * still round-trips, and still describes the same match — while a blob written
 * by THIS build carries the full army list in a field an older build ignores.
 */
export interface MatchSetup {
  /** FactionDef.key of the human player. */
  playerFaction: string;
  /** MIRROR of `opponents[0].faction`. See the interface note. */
  aiFaction: string;
  /** MapChoice.id. */
  map: string;
  /** MIRROR of `opponents[0].difficulty`. */
  difficulty: number;
  /** MIRROR of `opponents[0].personality`. */
  personality: number;
  startingCredits: number;
  /** Index into SPEEDS. */
  speed: number;
  /** Sim RNG seed. 0 means "roll a fresh one at launch". */
  seed: number;
  /**
   * Every AI army, in seat order. Length 1 for a 1v1, 3 for a four-way.
   *
   * Never empty: a skirmish with no opponent is a sandbox, which is a different
   * feature with a different screen. Clamped to `mapById(map).players - 1`, so
   * the army list and the battlefield can never disagree.
   */
  opponents: OpponentSetup[];
}

/** Armies on the field, the human included. Always `opponents.length + 1`. */
export function armyCount(setup: MatchSetup): number {
  return setup.opponents.length + 1;
}

/**
 * The army list with the mirror re-asserted on entry 0.
 *
 * READ THROUGH THIS, NEVER STRAIGHT OFF `opponents`, anywhere the setup may not
 * have come from `normalizeSetup`. The singular `aiFaction` / `difficulty` /
 * `personality` fields are documented as a mirror of `opponents[0]`, and
 * `normalizeSetup` is what maintains that — but `{ ...defaultSetup(),
 * personality: 1 }` is a perfectly reasonable thing for a caller (or a test) to
 * write, and it moves one half of the pair. When they disagree the SINGULAR
 * fields win, because they are the half an older build, a save row and a
 * hand-written literal can all reach.
 */
export function effectiveOpponents(setup: MatchSetup): OpponentSetup[] {
  const list = setup.opponents.length > 0
    ? setup.opponents
    : [{
      faction: setup.aiFaction,
      difficulty: setup.difficulty,
      personality: setup.personality,
      team: defaultTeamFor(0),
    }];
  return list.map((o, i) => (i === 0
    // `team` IS NOT PART OF THE MIRROR AND MUST SURVIVE THIS. The three
    // singular fields are re-asserted because six things outside this file can
    // reach them; NOTHING outside can reach a team, so rebuilding entry 0 from
    // scratch here would silently drop the human's only ally on every launch —
    // the campaign's `foe` defect exactly, which was "setting `opponents` alone
    // fixes nothing" arriving from the other direction.
    ? {
      faction: setup.aiFaction,
      difficulty: setup.difficulty,
      personality: setup.personality,
      team: o.team,
    }
    : { ...o }));
}

/* --------------------------------------------------------------------------
 * TEAMS
 *
 * The partition, seat-ordered, and the two questions asked about it. Pure and
 * engine-free on purpose: the WRITER that turns this into `PlayerState`
 * `allyMask` bits lives in `src/game/Teams.ts`, because it needs a `World` and
 * this file must stay importable by a test with no engine in it.
 * ------------------------------------------------------------------------ */

/**
 * Every seat's team in seat order: index 0 is the human, index `i + 1` is
 * opponent `i` — the same order `Shell.applySetupToWorld` seats the table in.
 *
 * Read through `effectiveOpponents`, never straight off the field, for the
 * reason that function documents.
 */
export function teamsOf(setup: MatchSetup): number[] {
  return [TEAM_PLAYER, ...effectiveOpponents(setup).map((o) => o.team)];
}

/**
 * Is there anybody left to fight?
 *
 * A table with ONE team is not a hard match, it is a match that cannot end:
 * `outcome.system.ts` requires `hostiles > 0` before it will declare a victory
 * and the local player is never their own enemy, so nothing would ever resolve
 * it. The lobby's option lists refuse to offer that state and `normalizeSetup`
 * repairs it if it arrives from disk, so it is unreachable in two independent
 * ways rather than one.
 */
export function teamsPlayable(teams: readonly number[]): boolean {
  return teams.some((t) => t !== teams[0]);
}

/** `Your Team`, `Team B`, `Team C`… — the lobby's name for one team number. */
export function teamLabel(team: number): string {
  if (team === TEAM_PLAYER) return 'Your Team';
  // 2 -> B, 3 -> C, 4 -> D. Clamped so a value off a corrupt blob still names
  // something rather than rendering a control character.
  const n = Math.max(2, Math.min(26, Math.round(team)));
  return `Team ${String.fromCharCode(64 + n)}`;
}

/**
 * The shape of the match as a player says it out loud: `1 v 1`, `2 v 2`,
 * `1 v 3`, `1 v 1 v 1 v 1`.
 *
 * The human's team is ALWAYS first, because the number a player looks for is
 * their own. The rest follow in team-number order, which is stable under a
 * repaint and does not reorder itself when an opponent's difficulty changes.
 */
export function describeTeams(setup: MatchSetup): string {
  const teams = teamsOf(setup);
  const size = new Map<number, number>();
  for (const t of teams) size.set(t, (size.get(t) ?? 0) + 1);
  const mine = size.get(TEAM_PLAYER) ?? 1;
  const others = [...size.entries()]
    .filter(([t]) => t !== TEAM_PLAYER)
    .sort((a, b) => a[0] - b[0])
    .map(([, n]) => n);
  return [mine, ...others].join(' v ');
}

/* --------------------------------------------------------------------------
 * DESCRIBING THE OPPOSITION
 *
 * ONE CHIP FOR N ARMIES IS A LIE, and the end screen told it. It printed
 * `MatchSetup.difficulty` — the mirror of opponent ONE — next to a name string
 * that listed every hostile army, so a four-way against Easy, Normal and Brutal
 * announced whichever setting happened to be seated first as though it were the
 * table's. Nothing on the screen gave it away.
 *
 * WHY THIS LIVES HERE AND NOT IN `EndScreen.ts`. It is a pure formatting rule
 * over `DIFFICULTIES`, which this file owns — and this file is the one shell
 * module that imports nothing from the engine and nothing from the document, so
 * a test can reach it. `src/shell/EndScreen.ts` transitively pulls `Shell.ts`
 * and therefore three, the renderer and the whole engine; MEASURED, importing
 * it into a vitest file takes over two minutes to transform and times out. A
 * "pure, and therefore tested" selector that no test can import is neither.
 * ------------------------------------------------------------------------ */

/** One hostile army, as a results screen needs to describe it. */
export interface OpponentSummary {
  /** `PlayerState.name` — "Soviet AI 2" in a four-way, "Soviet AI" in a duel. */
  readonly name: string;
  /** Index into `DIFFICULTIES`. Not read when `isHuman`. */
  readonly difficulty: number;
  /**
   * A PvP seat. It has no difficulty, and printing one for it would be the same
   * class of falsehood this shape exists to end.
   */
  readonly isHuman: boolean;
}

/** What one chip says, and what its `title` says when hovered. */
export interface OpponentChip {
  readonly text: string;
  readonly title: string;
}

/** `Brutal`, or `Human` for a PvP seat, which has no difficulty at all. */
export function controllerLabel(o: OpponentSummary): string {
  return o.isHuman ? 'Human' : (DIFFICULTIES[o.difficulty] ?? '—');
}

/**
 * The opponent chips: ONE when every seat played at the same setting, one PER
 * SEAT when they did not.
 *
 * The collapsed form is unchanged down to the separator, so a 1v1 end screen is
 * exactly the one that shipped — this is a fix, not a redesign, and a duel has
 * one answer to give. A mixed table grows a chip each; `.vm-load-meta` is
 * `flex-wrap: wrap`, so a fourth chip wraps rather than clipping. Either way
 * the FULL per-seat list is on the tooltip, so folding never loses the detail.
 *
 * `fallbackName` / `fallbackDifficulty` are used only when `opponents` is empty
 * — `Shell.endMatch` can build a result with no live world to read, and a
 * results screen that silently stops naming the opponent is worse than one that
 * names them coarsely.
 */
export function opponentChips(
  opponents: readonly OpponentSummary[], fallbackName: string, fallbackDifficulty: number,
): OpponentChip[] {
  if (opponents.length === 0) {
    const label = DIFFICULTIES[fallbackDifficulty] ?? '—';
    return [{ text: `${fallbackName} · ${label}`, title: `Opponents: ${fallbackName}` }];
  }

  const labels = opponents.map(controllerLabel);
  const full = opponents.map((o, i) => `${o.name} · ${labels[i]}`).join('\n');

  if (labels.every((l) => l === labels[0])) {
    // The chip is one line in a flex meta row and three army names is more than
    // that line has, so the names stay visible for the common case and the full
    // list goes on the tooltip where nothing is lost if the text is clipped.
    return [{
      text: `${opponents.map((o) => o.name).join(' · ')} · ${labels[0]}`,
      title: `Opponents:\n${full}`,
    }];
  }
  return opponents.map((o, i) => ({
    text: `${o.name} · ${labels[i]}`,
    title: `Opponents:\n${full}`,
  }));
}

/**
 * A deep-enough copy: `opponents` and its entries are fresh objects.
 *
 * `{ ...setup }` is a trap here and was a real one — `Shell` and
 * `SkirmishSetupScreen` both spread the stored setup into a working copy, and a
 * shallow spread leaves both copies pointing at ONE opponents array, so editing
 * the lobby's copy edited the persisted one before Start Battle was pressed.
 */
export function cloneSetup(setup: MatchSetup): MatchSetup {
  return { ...setup, opponents: setup.opponents.map((o) => ({ ...o })) };
}

export function defaultSetup(): MatchSetup {
  return {
    playerFaction: 'allies',
    aiFaction: 'soviets',
    map: MAPS[0].id,
    difficulty: 1,
    personality: -1,
    startingCredits: 10000,
    speed: 1,
    seed: 0,
    opponents: [{ faction: 'soviets', difficulty: 1, personality: -1, team: defaultTeamFor(0) }],
  };
}

/**
 * Grow or shrink the army list to `count` TOTAL armies, keeping what is there.
 *
 * Growing fills from the factions nobody has taken yet, so the natural
 * four-way is four different sides — which is also what keeps every army a
 * different colour in the 3D world, since `RenderBridge` keys the team tint off
 * `Faction` and not off the player slot. Shrinking drops from the end, so
 * flicking 4 -> 2 -> 4 gets the same third and fourth army back.
 */
export function withArmyCount(
  setup: MatchSetup, count: number, factionKeys: readonly string[],
): MatchSetup {
  const next = cloneSetup(setup);
  const want = Math.max(1, Math.round(count) - 1);
  const keys = factionKeys.length > 0 ? factionKeys : [setup.playerFaction, setup.aiFaction];
  while (next.opponents.length > want) next.opponents.pop();
  while (next.opponents.length < want) {
    const taken = new Set<string>([next.playerFaction, ...next.opponents.map((o) => o.faction)]);
    const free = keys.find((k) => !taken.has(k)) ?? keys[next.opponents.length % keys.length];
    next.opponents.push({
      faction: free,
      // Inherit the difficulty the player already chose rather than resetting
      // to Normal: somebody who set Brutal meant it for the whole table.
      difficulty: next.opponents[0]?.difficulty ?? setup.difficulty,
      personality: -1,
      // A NEW SEAT ARRIVES ON ITS OWN SIDE, never on the human's. Growing the
      // table is a request for another OPPONENT — the row is called Sides — and
      // an army that silently joined your team would be a free ally nobody
      // asked for. Shrinking can still leave the survivors on one team, which
      // is why `normalizeSetup` and the lobby's `reconcile` both re-check.
      team: defaultTeamFor(next.opponents.length),
    });
  }
  return next;
}

/** One opponent entry, clamped. Falls back to `d` field by field. */
function normalizeOpponent(
  raw: unknown, keys: readonly string[], d: OpponentSetup,
): OpponentSetup {
  const r = isRecord(raw) ? raw : {};
  return {
    faction: typeof r.faction === 'string' && keys.includes(r.faction) ? r.faction : d.faction,
    difficulty: Math.round(num(r.difficulty, 0, DIFFICULTIES.length - 1, d.difficulty)),
    personality: Math.round(num(r.personality, -1, PERSONALITIES.length - 1, d.personality)),
    // Clamped to a real team, never dropped: `TEAM_PLAYER` is the floor so a
    // stored `0` reads as "on my team" rather than as a fourth diplomacy state,
    // and `MAX_ARMIES` is the ceiling because a partition of N armies never
    // needs more than N labels.
    team: Math.round(num(r.team, TEAM_PLAYER, MAX_ARMIES, d.team)),
  };
}

/** Same contract as `normalizeSettings`: total, clamping, never throws. */
export function normalizeSetup(raw: unknown, factionKeys: readonly string[]): MatchSetup {
  const d = defaultSetup();
  const r = isRecord(raw) ? raw : {};
  const keys = factionKeys.length > 0 ? factionKeys : [d.playerFaction, d.aiFaction];

  const player = typeof r.playerFaction === 'string' && keys.includes(r.playerFaction)
    ? r.playerFaction
    : (keys.includes(d.playerFaction) ? d.playerFaction : keys[0]);

  const ai = typeof r.aiFaction === 'string' && keys.includes(r.aiFaction)
    ? r.aiFaction
    : (keys.includes(d.aiFaction) ? d.aiFaction : keys[keys.length - 1]);

  /*
   * THERE IS NO ANTI-MIRROR RULE, AND DELETING IT WAS THE FIX RATHER THAN
   * EXTENDING IT. Two lines here used to move `aiFaction` off the player's own
   * side, under the reason "a mirror match would hand both scripted bases to
   * one player". That reason was real and it is FIXED, in the layer that owned
   * it: `ScenarioBuilder.allies` / `.soviets` resolve by SLOT rather than by
   * searching the player table for a faction, and `ScenarioBuilder.keyFor`
   * remaps a layout's content keys per owner. Both carry the mirror match in
   * their headers as the defect they were written for.
   *
   * It could not survive the four-army lobby in any case. It was WRONG — a
   * player who picks Soviets against Soviets has asked for a legitimate match,
   * and silently launching them against somebody else is the lobby lying about
   * what it is about to boot. And it was INCOHERENT — it only ever looked at
   * `opponents[0]`, so seats 2 and 3 could already mirror the player and each
   * other through `normalizeOpponent`, and with four seats over four factions
   * a general no-repeat rule is not satisfiable at all. `Chrome.hostileColor`
   * already states the consequence as settled: blip colours are keyed on the
   * SEAT precisely "because two armies may pick the same side (mirror matches
   * are legal), so an accent is not a unique key for an army".
   *
   * Variety is still the DEFAULT everywhere it is a free choice rather than a
   * stated one — `withArmyCount` fills new seats from the untaken factions and
   * the lobby's Randomise rolls the opponent out of the other sides. Neither
   * overrides a choice the player made.
   */

  const map = mapById(typeof r.map === 'string' ? r.map : d.map);
  const difficulty = Math.round(num(r.difficulty, 0, DIFFICULTIES.length - 1, d.difficulty));
  const personality = Math.round(num(r.personality, -1, PERSONALITIES.length - 1, d.personality));

  /*
   * THE ARMY LIST, IN THREE STEPS, AND THE FIRST ONE IS THE MIGRATION.
   *
   * A stored blob from any build before this one has no `opponents` at all, so
   * the singular fields ARE the list — one opponent, exactly the match that was
   * saved. A blob from this build has both, and the array wins for entries 1 and
   * up while entry 0 is re-derived from the singular fields, which the anti-
   * mirror rule above has already had its say on. Anything else lets the two
   * representations disagree and makes "which one is real" a question.
   */
  const rawList = Array.isArray(r.opponents) ? r.opponents : [];
  // Entry 0's TEAM comes off the array even though its other three fields come
  // off the singular mirror: there is no singular `team` and there must not be
  // one, so the array is the only place it can have been written. A blob with
  // no `opponents` at all reaches `defaultTeamFor(0)`, which is the free-for-all
  // that blob described.
  const firstRaw = isRecord(rawList[0]) ? rawList[0] : {};
  const opponents: OpponentSetup[] = [{
    faction: ai,
    difficulty,
    personality,
    team: Math.round(num(firstRaw.team, TEAM_PLAYER, MAX_ARMIES, defaultTeamFor(0))),
  }];
  // A map's seat count is a hard ceiling, not a preference: a stored four-way on
  // a battlefield with two authored starts must come back as the two-army match
  // the ground can actually hold.
  const maxOpponents = Math.max(1, Math.min(MAX_ARMIES, map.players) - 1);
  for (let i = 1; i < rawList.length && opponents.length < maxOpponents; i++) {
    opponents.push(normalizeOpponent(rawList[i], keys, {
      faction: keys[i % keys.length],
      difficulty,
      personality: -1,
      team: defaultTeamFor(i),
    }));
  }

  /*
   * A MATCH WITH NO ENEMY IS NOT A MATCH, AND THE ONLY HONEST REPAIR IS THE
   * FREE-FOR-ALL.
   *
   * Every opponent on `TEAM_PLAYER` leaves the local player with no hostile
   * seat at all, and `outcome.system.ts` guards its victory on `hostiles > 0` —
   * so that table can never be won and (short of being wiped out) never lost.
   * It is unreachable from the lobby, whose option lists refuse to offer the
   * last enemy a place on your team, so it can only arrive from a hand-edited
   * blob or a seat count that shrank underneath a stored alliance.
   *
   * The whole partition is reset rather than one seat moved, because there is
   * no way to know WHICH army the player meant to fight, and inventing one
   * would launch a match nobody set up. The free-for-all is the state every
   * build before teams produced, so a repaired setup is at worst the match the
   * player would have got a version ago.
   */
  if (!teamsPlayable([TEAM_PLAYER, ...opponents.map((o) => o.team)])) {
    for (let i = 0; i < opponents.length; i++) opponents[i].team = defaultTeamFor(i);
  }

  return {
    playerFaction: player,
    aiFaction: ai,
    map: map.id,
    difficulty,
    personality,
    startingCredits: Math.round(num(r.startingCredits, 0, 200000, d.startingCredits)),
    speed: Math.round(num(r.speed, 0, SPEEDS.length - 1, d.speed)),
    seed: Math.round(num(r.seed, 0, 0xffffffff, d.seed)),
    opponents,
  };
}

/* ==========================================================================
 * 6. BOOT FLAGS
 *
 * Several engine modules read the URL directly and were written before a menu
 * existed: `world/terrain.system.ts` takes `?biome=` and `?mapseed=`,
 * `game/Scenarios.ts` takes `?map=` and `?seed=`, `sim/ai.system.ts` takes
 * `?ai=` and `?aip=`, `game/Bootstrap.ts` takes `?art=` and `?tier=`. Rather
 * than reach into six modules this file writes the query string those modules
 * already read, and the Shell pushes it with `history.replaceState` before it
 * boots. One translation, in one function, that a test can assert on.
 * ========================================================================== */

/** Query keys this shell owns. Everything else on the URL is preserved. */
export const MANAGED_FLAGS: readonly string[] = [
  'map', 'biome', 'mapseed', 'seed', 'ai', 'aip', 'art', 'tier',
];

/** The value every entry shares, or null when they differ. */
function unanimous<T>(items: readonly T[], read: (item: T) => number): number | null {
  if (items.length === 0) return null;
  const first = read(items[0]);
  for (let i = 1; i < items.length; i++) if (read(items[i]) !== first) return null;
  return first;
}

/**
 * Merge a match setup into an existing query string.
 *
 * `shot` is deliberately never written: `?shot=` is the screenshot harness's
 * contract and a menu-launched match must never look like a posed fixture.
 *
 * `ai` AND `aip` ARE ONLY WRITTEN WHEN THE WHOLE TABLE AGREES, which is always
 * true of a 1v1 and is why the query for one is byte-identical to before. They
 * have to be, because `sim/ai.system.ts#init` applies them to EVERY non-human
 * player — one value, no slot — and it runs after `Shell.applySetupToWorld` has
 * already written each army's own difficulty onto its own `PlayerState`. So a
 * four-way with a Brutal and two Easies would come out three Brutals. Omitting
 * the flag leaves `wantDiff` at -1, which is the documented "keep what is
 * there", and what is there is per-army and correct.
 */
export function buildMatchQuery(
  setup: MatchSetup,
  settings: Settings,
  base: string | URLSearchParams = '',
  seedOverride?: number,
): URLSearchParams {
  const q = typeof base === 'string' ? new URLSearchParams(base) : new URLSearchParams(base);
  for (const k of MANAGED_FLAGS) q.delete(k);

  const map = mapById(setup.map);
  q.set('map', map.preset);
  q.set('biome', map.biome);
  q.set('mapseed', String(map.mapSeed | 0));
  q.set('seed', String((seedOverride ?? setup.seed) >>> 0));
  q.set('art', map.mood);

  const armies = effectiveOpponents(setup);
  const diff = unanimous(armies, (o) => o.difficulty);
  if (diff !== null) q.set('ai', DIFFICULTIES[diff]?.toLowerCase() ?? 'normal');
  const pers = unanimous(armies, (o) => o.personality);
  if (pers !== null && pers >= 0) q.set('aip', PERSONALITIES[pers].toLowerCase());
  if (settings.graphics.tier !== 'auto') q.set('tier', settings.graphics.tier);
  return q;
}

/** A non-zero 32-bit seed. `rand` is injected so tests stay deterministic. */
export function rollSeed(rand: () => number = Math.random): number {
  return ((rand() * 0xffffffff) >>> 0) || 1;
}

/* ==========================================================================
 * 7. THE STORE
 * ========================================================================== */

/** The two platform-storage methods this file uses, and nothing else. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Used when the platform has no storage, or forbids it. */
export function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
  };
}

/**
 * Native userData storage in Electron, browser storage on the web, memory
 * otherwise. The old export name remains for compatibility.
 *
 * The write probe is not paranoia: Safari in private mode exposes
 * `localStorage` and throws `QuotaExceededError` on the first `setItem`, and
 * an embedded webview can expose it and throw `SecurityError` on read.
 */
export function browserStorage(): StorageLike {
  try {
    return persistentStorage();
  } catch {
    return memoryStorage();
  }
}

export type SettingsListener = (settings: Readonly<Settings>, changed: readonly string[]) => void;

/** Deep partial, one level per settings section. */
export type SettingsPatch = {
  graphics?: Partial<GraphicsSettings>;
  audio?: Partial<AudioSettings>;
  gameplay?: Partial<GameplaySettings>;
  controls?: Partial<ControlsSettings>;
};

/**
 * Live settings plus persistence plus change notification.
 *
 * `patch()` returns the dotted paths that actually changed, in the same style
 * as `configureRender`, so a listener can apply exactly the thing that moved
 * instead of re-pushing the entire graphics config on every slider frame.
 */
export class SettingsStore {
  private state: Settings;
  private setupState: MatchSetup;
  private readonly listeners: SettingsListener[] = [];

  constructor(
    private readonly storage: StorageLike = browserStorage(),
    /** Faction keys that a persisted setup is allowed to name. */
    factionKeys: readonly string[] = ['allies', 'soviets'],
  ) {
    this.state = normalizeSettings(this.read(SETTINGS_STORAGE_KEY));
    this.setupState = normalizeSetup(this.read(SETUP_STORAGE_KEY), factionKeys);
  }

  private read(key: string): unknown {
    try {
      const raw = this.storage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      // Corrupt JSON is exactly as recoverable as no JSON.
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      /* Full disk, private mode, or a webview with storage off. Not fatal. */
    }
  }

  /** The live settings. Treat as immutable — mutate through `patch`. */
  get(): Readonly<Settings> {
    return this.state;
  }

  /** The last-used skirmish configuration. */
  setup(): Readonly<MatchSetup> {
    return this.setupState;
  }

  setSetup(next: MatchSetup, factionKeys: readonly string[] = ['allies', 'soviets']): MatchSetup {
    this.setupState = normalizeSetup(next, factionKeys);
    this.write(SETUP_STORAGE_KEY, this.setupState);
    return this.setupState;
  }

  /**
   * Merge a patch, persist, and notify. Values are re-normalised, so a slider
   * that hands over `NaN` clamps instead of poisoning the config.
   */
  patch(patch: SettingsPatch): readonly string[] {
    let next = normalizeSettings({
      ...this.state,
      graphics: { ...this.state.graphics, ...(patch.graphics ?? {}) },
      audio: { ...this.state.audio, ...(patch.audio ?? {}) },
      gameplay: { ...this.state.gameplay, ...(patch.gameplay ?? {}) },
      controls: {
        bindings: { ...this.state.controls.bindings, ...(patch.controls?.bindings ?? {}) },
      },
    });
    let changed = diffSettings(this.state, next);
    if (changed.length === 0) return changed;

    /*
     * A MANUAL GRAPHICS CHANGE RETIRES THE ONE-TIME CALIBRATION, and this is
     * the only place that can be true for every control at once.
     *
     * It was first written into the Settings screen's own `set()` helper, which
     * worked and was the wrong place twice over: it is invisible to any test
     * that does not build a DOM, and the next graphics row somebody adds
     * through a different path silently opts out of it. Here it is a property
     * of the STORE — the thing that already decides what the numbers are — so a
     * player's choice wins whether it came from the options screen, a hotkey,
     * or something that does not exist yet.
     *
     * `graphics.calibrated` itself is excluded, which is what lets "Calibrate
     * Now" put the flag back to false without instantly re-retiring it. And
     * `reset()` deliberately does NOT go through here: resetting Graphics to
     * defaults is a player asking the game to choose again, not a choice.
     */
    if (!next.graphics.calibrated && retiresCalibration(changed)) {
      next = normalizeSettings({ ...next, graphics: { ...next.graphics, calibrated: true } });
      changed = diffSettings(this.state, next);
    }

    this.state = next;
    this.write(SETTINGS_STORAGE_KEY, next);
    this.emit(changed);
    return changed;
  }

  /** Restore one section, or everything when `section` is omitted. */
  reset(section?: keyof Omit<Settings, 'version'>): readonly string[] {
    const d = defaultSettings();
    const next = section === undefined
      ? d
      : normalizeSettings({ ...this.state, [section]: d[section] });
    const changed = diffSettings(this.state, next);
    this.state = next;
    this.write(SETTINGS_STORAGE_KEY, next);
    if (changed.length > 0) this.emit(changed);
    return changed;
  }

  subscribe(fn: SettingsListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(changed: readonly string[]): void {
    for (let i = 0; i < this.listeners.length; i++) {
      try {
        this.listeners[i](this.state, changed);
      } catch (err) {
        console.error('[shell] settings listener threw', err);
      }
    }
  }
}

/**
 * Graphics rows that do NOT count as a decision about the picture.
 *
 * THE DEFAULT DIRECTION IS DELIBERATE: anything not on this list retires the
 * calibration, so a row added later inherits the conservative behaviour — it
 * leaves the player's choice alone — rather than the one that could overwrite
 * something somebody set.
 *
 *   `calibrated` — bookkeeping. Including it would mean "Calibrate Now", whose
 *       whole job is to put the flag back to false, instantly setting it true.
 *   `panelBlur` — a class on `<html>`. Nothing in the render pipeline reads it.
 *   `perfOverlay` — a diagnostic. Opening the frame-time readout is how a
 *       player INVESTIGATES performance; it is not a decision about it.
 *   `fov` / `minZoom` / `maxZoom` — the camera. They change what is on screen,
 *       not what a pixel costs.
 * `fpsCap` USED TO BE ON THIS LIST AND HAD TO COME OFF THE DAY IT GAINED A
 * READER. Its exemption was justified in writing — *"it has ZERO readers
 * anywhere in `src/`... it cannot affect anything, including the frame"* — and
 * that justification was true, load-bearing, and silently expired the moment
 * `Shell.maybeCalibrate` started passing `targetMsForCap(fpsCap)` as the
 * calibration's frame-time target. Left here it would have been the worst kind
 * of bug: choosing 120 fps would retire nothing, so the stored calibration —
 * solved for 60 — would stand, and the setting would appear to do nothing.
 *
 * **An exemption argued from "nothing reads it" is an exemption with an expiry
 * date.** There is no mechanism that can notice one expiring, which is why the
 * reasoning is preserved above rather than deleted with the entry.
 */
const CALIBRATION_EXEMPT: readonly string[] = [
  'graphics.calibrated',
  'graphics.panelBlur',
  'graphics.perfOverlay',
  'graphics.fov',
  'graphics.minZoom',
  'graphics.maxZoom',
];

/**
 * Did this change touch a graphics row that is a decision about the picture?
 *
 * If so, the one-time calibration is over: a manual choice wins permanently and
 * nothing may measure over the top of it.
 */
export function retiresCalibration(changed: readonly string[]): boolean {
  for (let i = 0; i < changed.length; i++) {
    const p = changed[i];
    if (p.startsWith('graphics.') && !CALIBRATION_EXEMPT.includes(p)) return true;
  }
  return false;
}

/** Dotted paths whose value differs between two settings objects. */
export function diffSettings(a: Settings, b: Settings): string[] {
  const changed: string[] = [];
  const sections: Array<keyof Omit<Settings, 'version'>> = ['graphics', 'audio', 'gameplay'];
  for (const s of sections) {
    const av = a[s] as unknown as Record<string, unknown>;
    const bv = b[s] as unknown as Record<string, unknown>;
    for (const k of Object.keys(bv)) {
      if (av[k] !== bv[k]) changed.push(`${s}.${k}`);
    }
  }
  for (const k of Object.keys(b.controls.bindings)) {
    if (!chordEquals(a.controls.bindings[k], b.controls.bindings[k])) {
      changed.push(`controls.${k}`);
    }
  }
  return changed;
}

/** True if any changed path starts with `prefix`. Mirrors renderer#touched. */
export function touched(changed: readonly string[], prefix: string): boolean {
  for (let i = 0; i < changed.length; i++) {
    const p = changed[i];
    if (p === prefix || p.startsWith(prefix + '.')) return true;
  }
  return false;
}

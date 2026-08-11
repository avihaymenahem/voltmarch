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
   * New, and it should have existed from the start: `setAdaptiveResolution` in
   * `render/adaptive-res.system.ts` had ZERO callers anywhere in `src/`,
   * `tools/` or `tests/`, so dynamic scaling was permanently on with no way to
   * turn it off. On a GPU-bound machine it walks to its 0.55 floor within about
   * half a minute and upscales, which is indistinguishable from broken
   * antialiasing to anyone who does not know it is happening.
   *
   * Default true: it is the largest performance lever this renderer has, and
   * for most players holding 60 fps is worth more than the sharpness. But it is
   * a trade, and a trade the player is entitled to decline.
   */
  adaptiveResolution: boolean;
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
 */
export const SETTINGS_VERSION = 2;

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
      adaptiveResolution: true,
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

/** Total, defensive, order-independent. See the section header. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isRecord(raw)) return d;

  const g = isRecord(raw.graphics) ? raw.graphics : {};
  const a = isRecord(raw.audio) ? raw.audio : {};
  const p = isRecord(raw.gameplay) ? raw.gameplay : {};
  const c = isRecord(raw.controls) ? raw.controls : {};
  const rawBinds = isRecord(c.bindings) ? c.bindings : {};

  const bindings: Record<string, Chord> = {};
  for (const k of KEYBINDS) bindings[k.id] = normalizeChord(rawBinds[k.id], k.def);
  migrateBindings(bindings, num(raw.version, 0, 1e6, 0));

  const minZoom = num(g.minZoom, 8, 260, d.graphics.minZoom);
  const maxZoom = num(g.maxZoom, 8, 400, d.graphics.maxZoom);

  return {
    version: SETTINGS_VERSION,
    graphics: {
      tier: oneOf(g.tier, QUALITY_CHOICES, d.graphics.tier),
      resolutionScale: num(g.resolutionScale, 0.5, 2.0, d.graphics.resolutionScale),
      adaptiveResolution: bool(g.adaptiveResolution, d.graphics.adaptiveResolution),
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
  /** Players the layout is authored for. Always 2 in this build. */
  readonly players: number;
}

export const MAPS: readonly MapChoice[] = [
  {
    id: 'temperate-valley', name: 'Temperate Valley', biome: 'temperate', preset: 'temperate',
    mapSeed: 0x7e44a1, mood: 'noon', players: 2,
    blurb: 'Low plateaus, scattered woodland, three ore fields on the diagonal.',
  },
  {
    id: 'airbase-flats', name: 'Airbase Flats', biome: 'desert', preset: 'arid',
    mapSeed: 0x3ba9f1, mood: 'noon', players: 2,
    blurb: 'Bare, hot and open. Long sightlines, nowhere to hide armour.',
  },
  {
    id: 'frozen-sector', name: 'Frozen Sector', biome: 'snow', preset: 'snow',
    mapSeed: 0x51c0de, mood: 'overcast', players: 2,
    blurb: 'High relief under flat grey light. Cliffs channel every push.',
  },
  {
    id: 'industrial-grid', name: 'Industrial Grid', biome: 'urban', preset: 'urban',
    mapSeed: 0x1d0c17, mood: 'dusk', players: 2,
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
];

export function mapById(id: string): MapChoice {
  for (const m of MAPS) if (m.id === id) return m;
  return MAPS[0];
}

/** AI difficulty names, mirroring core/config AI_DIFFICULTY order. */
export const DIFFICULTIES: readonly string[] = ['Easy', 'Normal', 'Hard', 'Brutal'];
/** AI personality names, mirroring core/config AI_PERSONALITY order. */
export const PERSONALITIES: readonly string[] = ['Turtle', 'Rusher', 'Boomer'];
/** Game speed multipliers, mirroring core/config GAME_SPEEDS. */
export const SPEEDS: readonly number[] = [0.5, 1.0, 1.5, 2.0];
/** Starting bank options. */
export const CREDIT_OPTIONS: readonly number[] = [2000, 5000, 10000, 20000, 50000];

export interface MatchSetup {
  /** FactionDef.key of the human player. */
  playerFaction: string;
  /** FactionDef.key of the opponent. Never equal to `playerFaction`. */
  aiFaction: string;
  /** MapChoice.id. */
  map: string;
  /** Index into DIFFICULTIES. */
  difficulty: number;
  /** Index into PERSONALITIES, or -1 for "let the AI choose". */
  personality: number;
  startingCredits: number;
  /** Index into SPEEDS. */
  speed: number;
  /** Sim RNG seed. 0 means "roll a fresh one at launch". */
  seed: number;
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
  };
}

/** Same contract as `normalizeSettings`: total, clamping, never throws. */
export function normalizeSetup(raw: unknown, factionKeys: readonly string[]): MatchSetup {
  const d = defaultSetup();
  const r = isRecord(raw) ? raw : {};
  const keys = factionKeys.length > 0 ? factionKeys : [d.playerFaction, d.aiFaction];

  let player = typeof r.playerFaction === 'string' && keys.includes(r.playerFaction)
    ? r.playerFaction
    : (keys.includes(d.playerFaction) ? d.playerFaction : keys[0]);

  let ai = typeof r.aiFaction === 'string' && keys.includes(r.aiFaction)
    ? r.aiFaction
    : (keys.includes(d.aiFaction) ? d.aiFaction : keys[keys.length - 1]);

  // A mirror match would hand both scripted bases to one player — see the
  // module report. The opponent always ends up on a different side.
  if (ai === player) ai = keys.find((k) => k !== player) ?? ai;
  if (ai === player) player = keys[0];

  return {
    playerFaction: player,
    aiFaction: ai,
    map: mapById(typeof r.map === 'string' ? r.map : d.map).id,
    difficulty: Math.round(num(r.difficulty, 0, DIFFICULTIES.length - 1, d.difficulty)),
    personality: Math.round(num(r.personality, -1, PERSONALITIES.length - 1, d.personality)),
    startingCredits: Math.round(num(r.startingCredits, 0, 200000, d.startingCredits)),
    speed: Math.round(num(r.speed, 0, SPEEDS.length - 1, d.speed)),
    seed: Math.round(num(r.seed, 0, 0xffffffff, d.seed)),
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

/**
 * Merge a match setup into an existing query string.
 *
 * `shot` is deliberately never written: `?shot=` is the screenshot harness's
 * contract and a menu-launched match must never look like a posed fixture.
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
  q.set('ai', DIFFICULTIES[setup.difficulty]?.toLowerCase() ?? 'normal');
  if (setup.personality >= 0) q.set('aip', PERSONALITIES[setup.personality].toLowerCase());
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

/** The two localStorage methods this file uses, and nothing else. */
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
 * `localStorage` where it exists and is writable, memory otherwise.
 *
 * The write probe is not paranoia: Safari in private mode exposes
 * `localStorage` and throws `QuotaExceededError` on the first `setItem`, and
 * an embedded webview can expose it and throw `SecurityError` on read.
 */
export function browserStorage(): StorageLike {
  try {
    const ls = globalThis.localStorage;
    if (ls === undefined || ls === null) return memoryStorage();
    const probe = '__vm_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
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
    const next = normalizeSettings({
      ...this.state,
      graphics: { ...this.state.graphics, ...(patch.graphics ?? {}) },
      audio: { ...this.state.audio, ...(patch.audio ?? {}) },
      gameplay: { ...this.state.gameplay, ...(patch.gameplay ?? {}) },
      controls: {
        bindings: { ...this.state.controls.bindings, ...(patch.controls?.bindings ?? {}) },
      },
    });
    const changed = diffSettings(this.state, next);
    if (changed.length === 0) return changed;
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

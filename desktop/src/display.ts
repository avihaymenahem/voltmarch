/**
 * ============================================================================
 * VOLTMARCH desktop — src/display.ts
 * ============================================================================
 * WINDOW MODE, WINDOW SIZE AND WHICH MONITOR. No electron import, so the whole
 * policy is visible to `npm test` without a binary — the same rule as
 * `flags.ts`, and for the same reason (the Electron plan §7).
 *
 * ----------------------------------------------------------------------------
 * THERE ARE TWO WINDOW MODES, NOT THREE, AND THAT IS A PLATFORM FACT.
 * ----------------------------------------------------------------------------
 * The industry-standard menu offers Fullscreen / Borderless Windowed /
 * Windowed, where "Fullscreen" means EXCLUSIVE fullscreen: the app takes the
 * display, sets the mode on the driver, and gets its own flip chain.
 *
 * Chromium cannot do that. There is no mode-setting path in the compositor, and
 * `BrowserWindow.setFullScreen(true)` on Windows produces a borderless window
 * sized to the monitor. So "Fullscreen" and "Borderless Windowed" would be two
 * labels for one behaviour, and shipping both would be a menu that lies about
 * what the second one buys.
 *
 * Two options, and the UI says which one it is. The thing exclusive fullscreen
 * is usually wanted for — lower latency — is also the thing borderless is
 * usually preferred for these days, because it alt-tabs instantly instead of
 * dropping the display mode.
 * ============================================================================
 */

export type WindowMode = 'windowed' | 'fullscreen';

/** A monitor, flattened from electron's `Display` so this file imports nothing. */
export interface DisplayInfo {
  readonly id: number;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /** Usable area — the monitor minus the taskbar. */
  readonly workWidth: number;
  readonly workHeight: number;
  readonly workX: number;
  readonly workY: number;
  readonly primary: boolean;
}

export interface DisplayPrefs {
  mode: WindowMode;
  /** Windowed size. Ignored in fullscreen, but REMEMBERED — see normalise. */
  width: number;
  height: number;
  /**
   * Which monitor, as an index into the list the main process reports.
   *
   * An INDEX and not electron's `Display.id`, deliberately. Those ids are not
   * stable across a reboot or a cable swap on Windows, so a stored id resolves
   * to nothing on the next launch and the window silently opens on the primary
   * with no way to tell that from a deliberate choice. -1 means "wherever the
   * OS puts it", which is the honest default and what a fresh profile gets.
   */
  displayIndex: number;
  /**
   * Keep the window above every other application.
   *
   * DEFAULT OFF, AND IT SHOULD STAY OFF. Reported as the game sitting behind
   * another app after being selected from the taskbar, with always-on-top
   * offered as the fix. It IS a fix for that, and it is a heavy one: an
   * always-on-top window cannot be covered by anything, ever — no browser, no
   * chat window, no file dialog from another app — which trades an occasional
   * annoyance for a permanent one. So it is offered as a choice rather than
   * imposed.
   *
   * The underlying cause is most likely BORDERLESS FULLSCREEN Z-ORDER on
   * Windows: `setFullScreen(true)` produces a borderless window sized to the
   * monitor (there is no exclusive mode in Chromium), and those are known to
   * lose their place in the stack on activation. If the report only happens in
   * Fullscreen and never in Windowed, that is the confirmation — and then this
   * toggle is the workaround rather than the diagnosis.
   */
  alwaysOnTop: boolean;
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  mode: 'windowed',
  width: 1600,
  height: 900,
  displayIndex: -1,
  alwaysOnTop: false,
};

/**
 * The window sizes offered, largest last.
 *
 * A fixed 16:9 ladder rather than every mode the monitor reports: this is a
 * WINDOW, not a display mode, so the list is about how much of the desktop the
 * game should occupy. `sizesFor` filters it to what actually fits.
 */
export const WINDOW_SIZES: ReadonlyArray<readonly [number, number]> = [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
];

/**
 * Below this the HUD sidebar and the build grid start overlapping the
 * viewport. It is a floor on the WINDOW, not on the render resolution —
 * `graphics.resolutionScale` is the lever for pixel count.
 */
export const MIN_WINDOW_W = 1024;
export const MIN_WINDOW_H = 640;

/**
 * Normalise an untrusted blob — a hand-edited JSON file — into prefs.
 *
 * Never throws, for the same reason `normaliseSettings` never throws: this is
 * read before a window exists, so an exception is a silent failure to launch.
 *
 * The windowed size is kept even while `mode` is 'fullscreen'. Dropping it
 * would mean leaving fullscreen always lands on the default size rather than
 * the window the player last sized for themselves.
 */
export function normaliseDisplay(raw: unknown): DisplayPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN;
    return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
  };
  return {
    mode: o.mode === 'fullscreen' ? 'fullscreen' : 'windowed',
    width: int(o.width, MIN_WINDOW_W, 16384, DEFAULT_DISPLAY.width),
    height: int(o.height, MIN_WINDOW_H, 16384, DEFAULT_DISPLAY.height),
    // -1 is meaningful, so the floor is -1 rather than 0.
    displayIndex: int(o.displayIndex, -1, 63, DEFAULT_DISPLAY.displayIndex),
    alwaysOnTop: typeof o.alwaysOnTop === 'boolean' ? o.alwaysOnTop : DEFAULT_DISPLAY.alwaysOnTop,
  };
}

/** The chosen monitor, or null for "wherever the OS puts it". */
export function targetDisplay(
  prefs: DisplayPrefs,
  displays: readonly DisplayInfo[],
): DisplayInfo | null {
  if (prefs.displayIndex < 0 || prefs.displayIndex >= displays.length) return null;
  return displays[prefs.displayIndex] ?? null;
}

/**
 * Which sizes fit on a given monitor.
 *
 * Filtered against the WORK AREA, not the raw bounds: a 1080p monitor with a
 * taskbar has about 1040 usable rows, so offering 1920x1080 there produces a
 * window whose bottom edge — the command bar — is behind the taskbar.
 *
 * Always returns at least one entry. A display smaller than every rung is
 * possible (a 1024x600 netbook panel, a scaled-down virtual display), and an
 * empty chooser is worse than one honest option.
 */
export function sizesFor(display: DisplayInfo | null): ReadonlyArray<readonly [number, number]> {
  if (display === null) return WINDOW_SIZES;
  const fits = WINDOW_SIZES.filter(([w, h]) => w <= display.workWidth && h <= display.workHeight);
  if (fits.length > 0) return fits;
  return [[
    Math.max(MIN_WINDOW_W, display.workWidth),
    Math.max(MIN_WINDOW_H, display.workHeight),
  ]] as const;
}

/**
 * Where to put a windowed window: the requested size, centred on the target
 * monitor, clamped to its work area.
 *
 * Returns null when there is no target — that is the "leave it alone" case, and
 * it must stay distinct from "centre it on the primary", because the OS already
 * restores a sensible position and overriding it on every launch is worse.
 */
export function windowBounds(
  prefs: DisplayPrefs,
  display: DisplayInfo | null,
): { x: number; y: number; width: number; height: number } | null {
  if (display === null) return null;
  const width = Math.max(MIN_WINDOW_W, Math.min(prefs.width, display.workWidth));
  const height = Math.max(MIN_WINDOW_H, Math.min(prefs.height, display.workHeight));
  return {
    x: Math.round(display.workX + (display.workWidth - width) / 2),
    y: Math.round(display.workY + (display.workHeight - height) / 2),
    width,
    height,
  };
}

/* -------------------------------------------------------------------------- *
 * THE WIRE SHAPES
 *
 * What crosses the IPC boundary, mirrored by `src/platform/desktop.ts` on the
 * game's side. They are DECLARED TWICE ON PURPOSE — the game may not import
 * from `desktop/`, and `tests/desktop-shell.spec.ts` asserts the two
 * declarations still describe the same object rather than letting an import
 * paper over the boundary.
 * -------------------------------------------------------------------------- */

/** One monitor, as the options screen needs it — labels pre-formatted here. */
export interface DisplayInfoDto {
  readonly index: number;
  readonly label: string;
  readonly primary: boolean;
}

/** Everything the Display section renders from, in one round trip. */
export interface DisplayState {
  readonly mode: WindowMode;
  readonly width: number;
  readonly height: number;
  readonly displayIndex: number;
  readonly alwaysOnTop: boolean;
  readonly displays: readonly DisplayInfoDto[];
  readonly sizes: ReadonlyArray<readonly [number, number]>;
  readonly forceHighPerformanceGpu: boolean;
  readonly unlockFrameRate: boolean;
  /** A switch-backed setting differs from what this process launched with. */
  readonly relaunchPending: boolean;
}

export interface DisplayPatch {
  readonly mode?: WindowMode;
  readonly width?: number;
  readonly height?: number;
  readonly displayIndex?: number;
  readonly alwaysOnTop?: boolean;
  readonly forceHighPerformanceGpu?: boolean;
  readonly unlockFrameRate?: boolean;
}

/**
 * Fold an untrusted patch from the renderer into prefs.
 *
 * The renderer is our own code, but it is also the least trusted process in
 * the app — it is the one running the page — so a patch is normalised exactly
 * as a hand-edited file is. `normaliseDisplay` already does every clamp, so
 * this only has to decide which keys are present.
 */
export function applyPatch(prefs: DisplayPrefs, patch: DisplayPatch): DisplayPrefs {
  return normaliseDisplay({
    mode: patch.mode ?? prefs.mode,
    width: patch.width ?? prefs.width,
    height: patch.height ?? prefs.height,
    displayIndex: patch.displayIndex ?? prefs.displayIndex,
    alwaysOnTop: patch.alwaysOnTop ?? prefs.alwaysOnTop,
  });
}

/**
 * A short human label for a monitor: "1  2560x1440  (primary)".
 *
 * Electron's own `Display.label` is empty on plenty of Windows configurations,
 * so it is a suffix rather than the name. A chooser row reading "" for two of
 * three monitors is unusable.
 */
export function displayLabel(d: DisplayInfo, index: number): string {
  const parts = [`${index + 1}`, `${d.width}x${d.height}`];
  if (d.primary) parts.push('(primary)');
  else if (d.label.trim() !== '') parts.push(`(${d.label.trim()})`);
  return parts.join('  ');
}

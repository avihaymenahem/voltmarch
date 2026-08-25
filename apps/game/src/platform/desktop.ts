/**
 * ============================================================================
 * src/platform/desktop.ts — the game's half of the Electron bridge
 * ============================================================================
 * THIS FILE IS THE ONE THE PRELOAD HAS BEEN NAMING SINCE IT WAS WRITTEN.
 * `desktop/src/preload.ts` documents "the accessor in `src/platform/desktop.ts`
 * tests it by equality" as though this existed; it did not, and nothing in the
 * renderer consumed the bridge at all — `contextBridge` was exposing seven
 * methods to nobody. That is exactly the class of claim
 * `docs/SPEC_DRIFT_AUDIT.md` catalogues, and it was in a file added the day
 * before. Written now because the Display settings need it.
 *
 * ----------------------------------------------------------------------------
 * IT IMPORTS NOTHING AND IT MUST STAY THAT WAY.
 * ----------------------------------------------------------------------------
 * This is game code. It cannot import from `desktop/` — `tests/desktop-shell.spec.ts`
 * enforces that boundary in the other direction and the same reasoning applies
 * here: the web build must not gain a byte because a desktop target exists.
 * So the shapes below are declared, not shared, and
 * `tests/desktop-shell.spec.ts` asserts they still match the shell's own types.
 * A duplicated interface that a test compares is honest; an import across the
 * boundary is not.
 *
 * ----------------------------------------------------------------------------
 * `bridge` IS A VERSION, AND THE CHECK IS EQUALITY.
 * ----------------------------------------------------------------------------
 * A packaged app is one binary containing one preload and one bundle, so they
 * normally move together — but an installer that half-fails, a portable exe run
 * against an unpacked `dist/`, or a `desktop:build` that did not re-run leaves
 * them mismatched. Equality means that degrades to WEB BEHAVIOUR: no Display
 * section, no relaunch button, everything else exactly as the browser build.
 * The alternative — `>= 1` — would let a v1 preload reach `displayState()` and
 * throw `is not a function` inside the options screen.
 *
 * Same discipline as `REPLAY_FORMAT_VERSION` refusing a v1 file.
 * ============================================================================
 */

/**
 * 1 -> 2 when display methods landed; 2 -> 3 when `alwaysOnTop` joined;
 * 3 -> 4 added minimize; 4 -> 5 added native state and binary-save storage;
 * 5 -> 6 added the release-update state machine.
 *
 * BUMP THIS whenever a method is added, removed or CHANGES SHAPE, and bump the
 * matching literal in `desktop/src/preload.ts`. They are checked against each
 * other by `tests/desktop-shell.spec.ts` — but note what that check can and
 * cannot see: it compares the two LITERALS, so leaving both at 2 across a shape
 * change is consistent and passes. That is exactly what happened when
 * `alwaysOnTop` was added, and it was caught by a reader rather than by the
 * gate.
 *
 * The hazard is narrow but real, and it is why the rule says SHAPE and not just
 * methods: a v2 preload from an older packaged build, paired with a bundle that
 * expects `alwaysOnTop`, hands back `undefined` and the toggle silently renders
 * as off. Equality makes that degrade to web behaviour instead — no Display
 * section at all, which is visibly wrong rather than quietly wrong.
 */
export const BRIDGE_VERSION = 6;

export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface DesktopUpdateState {
  readonly mode: 'installed' | 'portable' | 'development';
  readonly status: DesktopUpdateStatus;
  readonly currentVersion: string;
  readonly availableVersion: string | null;
  readonly progress: number | null;
  readonly releaseNotes: string;
  readonly releaseUrl: string;
  readonly message: string;
  readonly canAutoInstall: boolean;
}

export type WindowMode = 'windowed' | 'fullscreen';

/** One monitor, as the options screen needs it. */
export interface DesktopDisplayInfo {
  readonly index: number;
  /** Pre-formatted by the main process — electron's own label is often empty. */
  readonly label: string;
  readonly primary: boolean;
}

/** Everything the Display section renders from, in one round trip. */
export interface DesktopDisplayState {
  readonly mode: WindowMode;
  readonly width: number;
  readonly height: number;
  readonly displayIndex: number;
  /** Keep the window above every other app. Default OFF — see `display.ts`. */
  readonly alwaysOnTop: boolean;
  readonly displays: readonly DesktopDisplayInfo[];
  /** Window sizes that fit the chosen monitor, from `sizesFor`. */
  readonly sizes: ReadonlyArray<readonly [number, number]>;
  readonly forceHighPerformanceGpu: boolean;
  readonly unlockFrameRate: boolean;
  /**
   * A switch-backed setting has been changed since launch and is not in force.
   *
   * Computed in the main process by comparing what is persisted against what
   * the process actually launched with, because that is the only place that
   * knows the second one. Chromium switches are appended before
   * `app.whenReady()`, so nothing the player toggles here can take effect
   * until the app restarts — and a settings row that silently does nothing
   * until some unstated future moment is the defect this flag exists to
   * surface.
   */
  readonly relaunchPending: boolean;
}

export interface DesktopDisplayPatch {
  readonly mode?: WindowMode;
  readonly width?: number;
  readonly height?: number;
  readonly displayIndex?: number;
  readonly alwaysOnTop?: boolean;
  readonly forceHighPerformanceGpu?: boolean;
  readonly unlockFrameRate?: boolean;
}

/**
 * PCI vendor ids, which are stable and public.
 *
 * Not a lookup table of GPU MODELS — that is the trap `HardwareCalibration`'s
 * header warns about, a list that goes stale on hardware that did not exist
 * when it was written. A vendor id is assigned once and never reused, so this
 * is a fact rather than a guess, and anything unknown falls through to the
 * hex, which is still more use to a player than nothing.
 */
const GPU_VENDORS: Readonly<Record<number, string>> = {
  0x1002: 'AMD',
  0x106b: 'Apple',
  0x10de: 'NVIDIA',
  0x13b5: 'ARM',
  0x5143: 'Qualcomm',
  0x8086: 'Intel',
};

/**
 * Which adapter the GPU process is actually on, from `app.getGPUInfo('complete')`.
 *
 * Pure, defensive, and typed against `unknown` on purpose: this crosses an IPC
 * boundary, the shape is Chromium's rather than ours, and it has no stability
 * guarantee across Electron majors. A shape we do not recognise returns null
 * and the caller says nothing, which is the same state as "not desktop" — the
 * row simply omits the sentence rather than printing `undefined`.
 *
 * `active` is the field that matters. A hybrid laptop reports BOTH adapters
 * with one marked active, so counting devices or taking the first would answer
 * a different question — and the question here is the one a `console.log`
 * was answering to nobody: which chip did the switch actually get us.
 */
export function activeAdapterLabel(info: unknown): string | null {
  if (typeof info !== 'object' || info === null) return null;
  const devices = (info as { gpuDevice?: unknown }).gpuDevice;
  if (!Array.isArray(devices)) return null;

  for (const d of devices) {
    if (typeof d !== 'object' || d === null) continue;
    const row = d as { vendorId?: unknown; deviceId?: unknown; active?: unknown };
    if (row.active !== true) continue;
    const vendor = typeof row.vendorId === 'number' ? row.vendorId : -1;
    const device = typeof row.deviceId === 'number' ? row.deviceId : -1;
    if (vendor < 0) return null;
    const name = GPU_VENDORS[vendor] ?? `vendor 0x${vendor.toString(16)}`;
    // The device id disambiguates two cards from one vendor, which is exactly
    // the case somebody checking this setting is in.
    return device >= 0 ? `${name} (device 0x${device.toString(16)})` : name;
  }
  // Devices listed but none active: a real state on a headless or software
  // rasteriser boot, and NOT the same as an unparseable reply.
  return null;
}

/** The object `contextBridge.exposeInMainWorld('voltmarch', ...)` installs. */
export interface DesktopBridge {
  readonly bridge: number;
  readonly platform: string;
  appVersion(): Promise<string>;
  gpuInfo(kind?: 'basic' | 'complete'): Promise<unknown>;
  displayFrequency(): Promise<number>;
  quit(): void;
  setFullscreen(on: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  /**
   * Send the window to the taskbar.
   *
   * **REPORTED AS "I don't have a way to minimize the game in desktop mode at
   * all", AND IT WAS EXACTLY TRUE.** The window ships frameless-by-fullscreen —
   * Chromium has no mode-setting path, so `setFullScreen(true)` is a borderless
   * window sized to the monitor — and `Menu.setApplicationMenu(null)` removes
   * the only other chrome. So in fullscreen there is no titlebar button, no
   * menu, and no accelerator: the player's only exits were Alt+Tab, which
   * switches away without minimising, and Options -> Graphics -> Display, which
   * they have to already know about.
   *
   * `void`, not `Promise<void>`, and it rides `ipcRenderer.send` rather than
   * `invoke` for `quit`'s reason: there is no answer worth awaiting, and a
   * promise the caller must handle is a promise a caller will forget.
   */
  minimize(): void;
  revealUserData(): Promise<void>;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
  storageRemove(key: string): void;
  saveWrite(slot: string, bytes: Uint8Array): Promise<void>;
  saveRead(slot: string): Promise<Uint8Array | null>;
  saveRemove(slot: string): Promise<void>;
  displayState(): Promise<DesktopDisplayState>;
  setDisplayState(patch: DesktopDisplayPatch): Promise<DesktopDisplayState>;
  relaunch(): void;
  updateState(): Promise<DesktopUpdateState>;
  checkForUpdates(): Promise<DesktopUpdateState>;
  downloadUpdate(): Promise<DesktopUpdateState>;
  openUpdatePage(): Promise<void>;
  installUpdate(): void;
  onUpdateState(listener: (state: DesktopUpdateState) => void): () => void;
}

/**
 * The bridge, or null in a browser.
 *
 * Called on every access rather than cached at module scope: this module is
 * imported by the shell, and a module-level read would run at import time,
 * which for a lazily-loaded chunk is not a moment with any defined relationship
 * to preload injection. The check is three property reads; it is not worth
 * memoising and being wrong about.
 */
export function desktopBridge(): DesktopBridge | null {
  const host = globalThis as { voltmarch?: unknown };
  const candidate = host.voltmarch;
  if (typeof candidate !== 'object' || candidate === null) return null;
  if ((candidate as { bridge?: unknown }).bridge !== BRIDGE_VERSION) return null;
  return candidate as DesktopBridge;
}

/** True when running inside the Electron shell with a matching preload. */
export function isDesktop(): boolean {
  return desktopBridge() !== null;
}

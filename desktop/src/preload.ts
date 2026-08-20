/**
 * ============================================================================
 * VOLTMARCH desktop — src/preload.ts
 * ============================================================================
 * THE ONLY BRIDGE BETWEEN THE GAME AND THE OPERATING SYSTEM.
 *
 * Built to COMMONJS, not ESM, and that is not a style choice. Electron's own
 * docs: "Sandboxed preload scripts are run as plain JavaScript without an ESM
 * context." The widely-copied `.mjs` + `import` sample applies to UNSANDBOXED
 * preloads only, and `sandbox: true` is kept — so `import` here is a syntax
 * error at load time. `build.mjs` emits this as CJS for that reason.
 *
 * `bridge: 5` is a VERSION, not a boolean, and the accessor in
 * `src/platform/desktop.ts` tests it by equality. An older packaged preload
 * running against a newer bundle therefore degrades to WEB BEHAVIOUR rather
 * than calling a method that does not exist — the same discipline as
 * `REPLAY_FORMAT_VERSION` refusing a v1 file.
 *
 * That accessor did NOT EXIST when this comment first described it, and
 * nothing in the renderer read the bridge at all: seven methods exposed to
 * nobody, behind a paragraph asserting a consumer. It exists now, and
 * `tests/desktop-shell.spec.ts` checks the two version literals against each
 * other so the next bump cannot land on one side only.
 *
 * BUMP THE VERSION WHENEVER THIS OBJECT CHANGES SHAPE — 1 -> 2 was the display
 * methods below, 2 -> 3 was `alwaysOnTop` joining the display state and patch.
 * SHAPE, not just methods: the gate compares the two literals, so leaving both
 * behind on a field addition is consistent and passes.
 *
 * Never expose `ipcRenderer` itself. Electron's docs warn it "will result in an
 * empty object" and is a security risk.
 * ============================================================================
 */

import { contextBridge, ipcRenderer } from 'electron';

import type { DisplayPatch, DisplayState } from './display';

interface SyncReply<T = undefined> { ok: boolean; value?: T; error?: string }

function sync<T>(channel: string, ...args: unknown[]): T {
  const reply = ipcRenderer.sendSync(channel, ...args) as SyncReply<T>;
  if (reply?.ok !== true) throw new Error(reply?.error ?? 'Desktop storage failed.');
  return reply.value as T;
}

contextBridge.exposeInMainWorld(
  'voltmarch',
  Object.freeze({
    bridge: 5,
    platform: process.platform,

    appVersion: (): Promise<string> => ipcRenderer.invoke('vm:version'),

    /** Which adapter Chromium actually gave us — the enforcement proof. */
    gpuInfo: (kind: 'basic' | 'complete' = 'basic'): Promise<unknown> =>
      ipcRenderer.invoke('vm:gpu-info', kind),

    /** Refresh rate of the display the window is on. No web equivalent. */
    displayFrequency: (): Promise<number> => ipcRenderer.invoke('vm:display-frequency'),

    quit: (): void => ipcRenderer.send('vm:quit'),
    setFullscreen: (on: boolean): Promise<void> => ipcRenderer.invoke('vm:fullscreen', on === true),
    isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('vm:is-fullscreen'),
    // `send`, not `invoke` — see the game-side declaration for why there is
    // nothing to await. The main process decides whether leaving fullscreen
    // first is necessary; the renderer must not have to know.
    minimize: (): void => ipcRenderer.send('vm:minimize'),

    /** Open the folder replays and screenshots are written to. */
    revealUserData: (): Promise<void> => ipcRenderer.invoke('vm:reveal-user-data'),

    /** Native userData storage. Synchronous because existing stores hydrate at construction. */
    storageGet: (key: string): string | null => sync<string | null>('vm:storage-get', key),
    storageSet: (key: string, value: string): void => { sync('vm:storage-set', key, value); },
    storageRemove: (key: string): void => { sync('vm:storage-remove', key); },

    /** Binary snapshots live as files, never IndexedDB values. */
    saveWrite: (slot: string, bytes: Uint8Array): Promise<void> =>
      ipcRenderer.invoke('vm:save-write', slot, bytes),
    saveRead: (slot: string): Promise<Uint8Array | null> => ipcRenderer.invoke('vm:save-read', slot),
    saveRemove: (slot: string): Promise<void> => ipcRenderer.invoke('vm:save-remove', slot),

    /*
     * WINDOW MODE, SIZE, MONITOR AND THE TWO SWITCH-BACKED SETTINGS.
     *
     * One getter and one patcher rather than a method per row: the options
     * screen renders the whole Display section from a single object, and the
     * monitor list has to arrive with it — the set of sizes offered DEPENDS on
     * which monitor is selected, so two independent calls could disagree.
     * `setDisplayState` returns the new state for the same reason: after a
     * monitor change the size list may have shrunk under the current choice.
     */
    displayState: (): Promise<DisplayState> => ipcRenderer.invoke('vm:display-state'),
    setDisplayState: (patch: DisplayPatch): Promise<DisplayState> =>
      ipcRenderer.invoke('vm:display-set', patch),

    /**
     * Restart the app, preserving argv.
     *
     * The only way a Chromium switch can start applying: they are appended
     * before `app.whenReady()`, so the GPU process took its command line at
     * launch and a late append is a silent no-op.
     */
    relaunch: (): void => ipcRenderer.send('vm:relaunch'),
  }),
);

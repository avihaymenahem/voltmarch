/**
 * VOLTMARCH desktop update controller.
 *
 * Installed NSIS builds use electron-updater and the latest.yml published with
 * every GitHub release. Portable builds cannot replace the executable they are
 * running from, so they perform the same version check and offer the release
 * page instead. Development never contacts GitHub automatically.
 */
import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';

import {
  isNewerVersion,
  releaseNotesText,
  type DesktopUpdateMode,
  type DesktopUpdateState,
} from './update-state';

const RELEASE_URL = 'https://github.com/avihaymenahem/voltmarch/releases/latest';
const RELEASE_API = 'https://api.github.com/repos/avihaymenahem/voltmarch/releases/latest';
const AUTO_CHECK_DELAY_MS = 20_000;
const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let installed = false;
let checking: Promise<DesktopUpdateState> | null = null;
let periodic: ReturnType<typeof setInterval> | null = null;
let lastPublishedDownloadPercent = -1;

function updateMode(): DesktopUpdateMode {
  if (!app.isPackaged) return 'development';
  return process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'installed';
}

let state: DesktopUpdateState = {
  mode: updateMode(),
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: null,
  releaseNotes: '',
  releaseUrl: RELEASE_URL,
  message: app.isPackaged ? 'Updates have not been checked yet.' : 'Update checks are disabled in development.',
  canAutoInstall: updateMode() === 'installed',
};

function snapshot(): DesktopUpdateState {
  return { ...state };
}

function publish(next: Partial<DesktopUpdateState>): DesktopUpdateState {
  state = { ...state, ...next };
  const value = snapshot();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('vm:update-state', value);
  return value;
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Never pass tokens, request headers or a full provider dump into renderer UI.
  return text.split('\n')[0]!.slice(0, 240) || 'The update service did not answer.';
}

function wireInstalledUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    publish({ status: 'checking', progress: null, message: 'Checking GitHub Releases…' });
  });
  autoUpdater.on('update-not-available', () => {
    publish({
      status: 'up-to-date', availableVersion: null, progress: null,
      releaseNotes: '', message: `VOLTMARCH ${app.getVersion()} is current.`,
    });
  });
  autoUpdater.on('update-available', (info) => {
    lastPublishedDownloadPercent = -1;
    publish({
      status: 'available', availableVersion: info.version, progress: null,
      releaseNotes: releaseNotesText(info.releaseNotes),
      message: `VOLTMARCH ${info.version} is ready to download.`,
    });
  });
  autoUpdater.on('download-progress', (info) => {
    const percent = Math.max(0, Math.min(100, Math.round(info.percent)));
    if (percent === lastPublishedDownloadPercent) return;
    lastPublishedDownloadPercent = percent;
    publish({
      status: 'downloading', progress: percent,
      message: `Downloading ${percent}%`,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    lastPublishedDownloadPercent = 100;
    publish({
      status: 'downloaded', availableVersion: info.version, progress: 100,
      releaseNotes: releaseNotesText(info.releaseNotes) || state.releaseNotes,
      message: 'Update downloaded. Restart when you are ready.',
    });
  });
  autoUpdater.on('error', (error) => {
    lastPublishedDownloadPercent = -1;
    publish({ status: 'error', progress: null, message: messageOf(error) });
  });
}

async function checkPortable(): Promise<DesktopUpdateState> {
  const response = await net.fetch(RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `VOLTMARCH/${app.getVersion()}` },
  });
  if (!response.ok) throw new Error(`GitHub Releases answered HTTP ${response.status}.`);
  const raw: unknown = await response.json();
  if (typeof raw !== 'object' || raw === null) throw new Error('GitHub returned an invalid release record.');
  const release = raw as { tag_name?: unknown; body?: unknown; html_url?: unknown };
  const tag = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : '';
  const url = typeof release.html_url === 'string' && /^https:\/\//.test(release.html_url)
    ? release.html_url
    : RELEASE_URL;
  if (isNewerVersion(tag, app.getVersion())) {
    return publish({
      status: 'available', availableVersion: tag, progress: null,
      releaseNotes: releaseNotesText(release.body), releaseUrl: url,
      message: `VOLTMARCH ${tag} is available. Open the release to replace this portable build.`,
    });
  }
  return publish({
    status: 'up-to-date', availableVersion: null, progress: null,
    releaseNotes: '', releaseUrl: url, message: `VOLTMARCH ${app.getVersion()} is current.`,
  });
}

export function desktopUpdateState(): DesktopUpdateState {
  return snapshot();
}

export function checkForDesktopUpdate(): Promise<DesktopUpdateState> {
  if (checking !== null) return checking;
  if (state.mode === 'development') return Promise.resolve(snapshot());
  checking = (async () => {
    publish({ status: 'checking', progress: null, message: 'Checking GitHub Releases…' });
    try {
      if (state.mode === 'portable') return await checkPortable();
      const result = await autoUpdater.checkForUpdates();
      if (result === null && state.status === 'checking') {
        return publish({ status: 'error', message: 'The update provider is unavailable.' });
      }
      return snapshot();
    } catch (error) {
      return publish({ status: 'error', progress: null, message: messageOf(error) });
    } finally {
      checking = null;
    }
  })();
  return checking;
}

async function downloadDesktopUpdate(): Promise<DesktopUpdateState> {
  if (state.mode !== 'installed' || state.status !== 'available') return snapshot();
  lastPublishedDownloadPercent = 0;
  publish({ status: 'downloading', progress: 0, message: 'Preparing update download…' });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    publish({ status: 'error', progress: null, message: messageOf(error) });
  }
  return snapshot();
}

function installDesktopUpdate(): void {
  if (state.mode !== 'installed' || state.status !== 'downloaded') return;
  autoUpdater.quitAndInstall(false, true);
}

export function installDesktopUpdater(): void {
  if (installed) return;
  installed = true;
  if (state.mode === 'installed') wireInstalledUpdater();

  ipcMain.handle('vm:update-state', () => snapshot());
  ipcMain.handle('vm:update-check', () => checkForDesktopUpdate());
  ipcMain.handle('vm:update-download', () => downloadDesktopUpdate());
  ipcMain.handle('vm:update-open', () => shell.openExternal(state.releaseUrl || RELEASE_URL));
  ipcMain.on('vm:update-install', () => installDesktopUpdate());

  if (state.mode === 'development') return;
  const first = setTimeout(() => { void checkForDesktopUpdate(); }, AUTO_CHECK_DELAY_MS);
  first.unref();
  periodic = setInterval(() => { void checkForDesktopUpdate(); }, AUTO_CHECK_INTERVAL_MS);
  periodic.unref();
  app.once('before-quit', () => {
    if (periodic !== null) clearInterval(periodic);
    periodic = null;
  });
}

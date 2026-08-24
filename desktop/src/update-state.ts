/** Renderer-safe state emitted by the desktop update controller. */
export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type DesktopUpdateMode = 'installed' | 'portable' | 'development';

export interface DesktopUpdateState {
  readonly mode: DesktopUpdateMode;
  readonly status: DesktopUpdateStatus;
  readonly currentVersion: string;
  readonly availableVersion: string | null;
  readonly progress: number | null;
  readonly releaseNotes: string;
  readonly releaseUrl: string;
  readonly message: string;
  readonly canAutoInstall: boolean;
}

/** Strict numeric release comparison; prerelease tags deliberately do not win stable checks. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (raw: string): number[] | null => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
    return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const next = parse(candidate);
  const now = parse(current);
  if (next === null || now === null) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== now[i]) return next[i]! > now[i]!;
  }
  return false;
}

/** Release notes cross an external trust boundary and are always rendered as plain text. */
export function releaseNotesText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\r/g, '').trim().slice(0, 2400);
  if (!Array.isArray(value)) return '';
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (typeof entry !== 'object' || entry === null) return '';
      const note = (entry as { note?: unknown }).note;
      return typeof note === 'string' ? note : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .replace(/\r/g, '')
    .trim()
    .slice(0, 2400);
}

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

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower in named) return named[lower]!;
    const radix = lower.startsWith('#x') ? 16 : 10;
    const digits = lower.slice(radix === 16 ? 2 : 1);
    const point = Number.parseInt(digits, radix);
    if (!Number.isFinite(point) || point < 0 || point > 0x10ffff) return match;
    return String.fromCodePoint(point);
  });
}

/**
 * Release notes cross an external trust boundary and are always rendered as
 * plain text. electron-updater may supply GitHub's generated notes as HTML,
 * while the portable release endpoint supplies Markdown, so normalise both
 * formats before they ever reach the renderer.
 */
export function releaseNotesText(value: unknown): string {
  const source = typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (typeof entry !== 'object' || entry === null) return '';
      const note = (entry as { note?: unknown }).note;
      return typeof note === 'string' ? note : '';
    })
    .filter(Boolean)
    .join('\n\n')
      : '';

  return decodeHtmlEntities(source
    .replace(/\r/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<\/(?:address|article|blockquote|div|h[1-6]|li|ol|p|pre|section|table|tr|ul)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1'))
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2400);
}

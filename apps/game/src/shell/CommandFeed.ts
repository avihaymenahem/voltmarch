/**
 * Small, remote-first news feed for the title screen's News & Events route.
 *
 * The canonical live document is hosted by voltmarch.com so an event can be
 * announced without rebuilding an installed desktop client. The bundled row
 * is an offline floor, not a second live authority: it ensures the surface is
 * still useful on a disconnected machine and is replaced as soon as a valid
 * remote document arrives.
 *
 * Every field crosses an external trust boundary. Consumers render it only
 * through `textContent`, while this module bounds its shape, length, count and
 * outbound URLs before anything reaches the DOM.
 */

export type CommandFeedKind = 'update' | 'event';

export interface CommandFeedItem {
  readonly id: string;
  readonly kind: CommandFeedKind;
  readonly title: string;
  readonly summary: string;
  /** ISO calendar date, shown in the player's locale. */
  readonly date: string;
  readonly actionLabel?: string;
  readonly url?: string;
}

export interface CommandFeed {
  readonly version: 1;
  readonly updatedAt: string;
  readonly items: readonly CommandFeedItem[];
}

export interface LoadedCommandFeed {
  readonly feed: CommandFeed;
  readonly source: 'live' | 'offline';
}

export const COMMAND_FEED_URL = 'https://voltmarch.com/news.json';

export const OFFLINE_COMMAND_FEED: CommandFeed = {
  version: 1,
  updatedAt: '2026-09-02T19:00:00Z',
  items: [
    {
      id: 'update-3-16-2',
      kind: 'update',
      title: 'VOLTMARCH 3.16.2 is live',
      summary: 'Menus share a consistent command frame with working navigation and no duplicate '
        + 'destinations. The cinematic title screen returns, Service Record is clearer, and city foliage coverage is repaired.',
      date: '2026-09-02',
      actionLabel: 'Read release notes',
      url: 'https://github.com/avihaymenahem/voltmarch/releases/tag/v3.16.2',
    },
  ],
};

const SAFE_LINKS = [
  'https://voltmarch.com/',
  'https://github.com/avihaymenahem/voltmarch/',
  'https://discord.gg/',
] as const;

function textField(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean.length > 0 && clean.length <= max ? clean : null;
}

function safeDate(value: unknown): string | null {
  const date = textField(value, 10);
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const stamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(stamp) ? date : null;
}

function safeUrl(value: unknown): string | null {
  const url = textField(value, 300);
  if (url === null || !SAFE_LINKS.some((prefix) => url.startsWith(prefix))) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Validate and normalize one network response. Invalid rows are refused. */
export function parseCommandFeed(value: unknown): CommandFeed | null {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as { version?: unknown; updatedAt?: unknown; items?: unknown };
  if (source.version !== 1 || typeof source.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(source.updatedAt)) || !Array.isArray(source.items)
    || source.items.length > 12) return null;

  const items: CommandFeedItem[] = [];
  const ids = new Set<string>();
  for (const raw of source.items) {
    if (typeof raw !== 'object' || raw === null) return null;
    const row = raw as Record<string, unknown>;
    const id = textField(row.id, 64);
    const title = textField(row.title, 90);
    const summary = textField(row.summary, 320);
    const date = safeDate(row.date);
    const kind = row.kind === 'update' || row.kind === 'event' ? row.kind : null;
    if (id === null || !/^[a-z0-9][a-z0-9-]*$/.test(id) || ids.has(id)
      || title === null || summary === null || date === null || kind === null) return null;

    ids.add(id);
    if (row.actionLabel === undefined && row.url === undefined) {
      items.push({ id, kind, title, summary, date });
      continue;
    }
    const actionLabel = textField(row.actionLabel, 40);
    const url = safeUrl(row.url);
    if (actionLabel === null || url === null) return null;
    items.push({ id, kind, title, summary, date, actionLabel, url });
  }

  return { version: 1, updatedAt: source.updatedAt, items };
}

/** Fetch once when the player opens Updates; fail closed to the bundled row. */
export async function loadCommandFeed(
  fetcher: typeof fetch = fetch,
): Promise<LoadedCommandFeed> {
  try {
    const response = await fetcher(COMMAND_FEED_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return { feed: OFFLINE_COMMAND_FEED, source: 'offline' };
    const parsed = parseCommandFeed(await response.json());
    if (parsed !== null) return { feed: parsed, source: 'live' };
  } catch {
    // Offline play and captive portals are ordinary states, not errors.
  }
  return { feed: OFFLINE_COMMAND_FEED, source: 'offline' };
}

export function commandFeedDate(date: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

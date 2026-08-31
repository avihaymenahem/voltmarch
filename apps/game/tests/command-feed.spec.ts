import { describe, expect, it, vi } from 'vitest';

import {
  COMMAND_FEED_URL,
  OFFLINE_COMMAND_FEED,
  commandFeedDate,
  loadCommandFeed,
  parseCommandFeed,
} from '../src/shell/CommandFeed';

const LIVE = {
  version: 1,
  updatedAt: '2026-09-01T12:00:00Z',
  items: [{
    id: 'playtest-one',
    kind: 'event',
    title: 'Open Playtest',
    summary: 'Two hours of coordinated multiplayer testing.',
    date: '2026-09-03',
    actionLabel: 'Join Discord',
    url: 'https://discord.gg/pvJGJyafU3',
  }],
} as const;

describe('title command feed', () => {
  it('accepts a bounded update/event document', () => {
    expect(parseCommandFeed(LIVE)).toEqual(LIVE);
  });

  it('rejects unsafe links, duplicate ids and overlong external copy', () => {
    expect(parseCommandFeed({
      ...LIVE,
      items: [{ ...LIVE.items[0], url: 'https://example.test/phish' }],
    })).toBeNull();
    expect(parseCommandFeed({ ...LIVE, items: [LIVE.items[0], LIVE.items[0]] })).toBeNull();
    expect(parseCommandFeed({
      ...LIVE,
      items: [{ ...LIVE.items[0], summary: 'x'.repeat(321) }],
    })).toBeNull();
  });

  it('uses a valid live response and asks only the canonical endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(LIVE), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(loadCommandFeed(fetcher)).resolves.toEqual({ feed: LIVE, source: 'live' });
    expect(fetcher).toHaveBeenCalledWith(COMMAND_FEED_URL, expect.objectContaining({ cache: 'no-store' }));
  });

  it('falls back cleanly when the player is offline or the document is invalid', async () => {
    const offline = vi.fn(async () => { throw new TypeError('offline'); });
    await expect(loadCommandFeed(offline)).resolves.toEqual({
      feed: OFFLINE_COMMAND_FEED,
      source: 'offline',
    });

    const invalid = vi.fn(async () => new Response('{"version": 99}', { status: 200 }));
    await expect(loadCommandFeed(invalid)).resolves.toEqual({
      feed: OFFLINE_COMMAND_FEED,
      source: 'offline',
    });
  });

  it('formats calendar dates without local-time drift', () => {
    expect(commandFeedDate('2026-08-30', 'en-US')).toBe('Aug 30, 2026');
  });
});

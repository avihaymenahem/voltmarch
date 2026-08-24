import { describe, expect, it, vi } from 'vitest';

import {
  discordPayload,
  normaliseRelease,
  postRelease,
  releaseLog,
  validateWebhookUrl,
} from '../tools/post-discord-release.mjs';

const release = normaliseRelease({
  name: 'VOLTMARCH 3.4.0',
  tagName: 'v3.4.0',
  url: 'https://github.com/avihaymenahem/voltmarch/releases/tag/v3.4.0',
  publishedAt: '2026-08-24T12:00:00Z',
  body: '## Highlights\n\n- Sharper command interface\n- @everyone cannot ping',
});

describe('Discord release announcements', () => {
  it('accepts only Discord HTTPS webhook endpoints without leaking the token', () => {
    expect(validateWebhookUrl('https://discord.com/api/webhooks/123/secret'))
      .toBe('https://discord.com/api/webhooks/123/secret?wait=true');
    expect(() => validateWebhookUrl('http://discord.com/api/webhooks/123/secret')).toThrow();
    expect(() => validateWebhookUrl('https://example.com/api/webhooks/123/secret')).toThrow();
  });

  it('builds a safe release card and preserves the complete log separately', () => {
    const payload = discordPayload(release);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0].title).toBe('VOLTMARCH 3.4.0 is live');
    expect(payload.embeds[0].description).toContain('@everyone cannot ping');
    expect(releaseLog(release)).toContain(release.body);
    expect(releaseLog(release)).toContain(release.url);
  });

  it('caps the visible excerpt but attaches the unabridged generated notes', () => {
    const long = normaliseRelease({ ...release, body: `## Full log\n\n${'change '.repeat(1200)}` });
    expect(discordPayload(long).embeds[0].description.length).toBeLessThanOrEqual(3800);
    expect(releaseLog(long)).toContain(long.body);
  });

  it('posts multipart data with confirmation enabled', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"id":"message"}', { status: 200 }));
    await postRelease('https://discord.com/api/webhooks/123/secret', release, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toContain('wait=true');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  discordPayload,
  normaliseDeployment,
  normaliseRelease,
  postRelease,
  releaseLog,
  validateWebhookUrl,
} from '../../../tools/post-discord-release.mjs';

const release = normaliseRelease({
  name: 'VOLTMARCH 3.4.0',
  tagName: 'v3.4.0',
  url: 'https://github.com/avihaymenahem/voltmarch/releases/tag/v3.4.0',
  publishedAt: '2026-08-24T12:00:00Z',
  body: '## Highlights\n\n- Sharper command interface\n- @everyone cannot ping',
  assets: [
    { name: 'VOLTMARCH-Setup-3.4.0.exe' },
    { name: 'VOLTMARCH-Setup-3.4.0.exe.blockmap' },
    { name: 'VOLTMARCH-3.4.0-portable.exe' },
    { name: 'latest.yml' },
  ],
});

const deployment = normaliseDeployment({
  targets: ['desktop', 'relay', 'web'],
  sha: '0123456789abcdef0123456789abcdef01234567',
}, release);

describe('Discord release announcements', () => {
  it('accepts only Discord HTTPS webhook endpoints without leaking the token', () => {
    expect(validateWebhookUrl('https://discord.com/api/webhooks/123/secret'))
      .toBe('https://discord.com/api/webhooks/123/secret?wait=true');
    expect(() => validateWebhookUrl('http://discord.com/api/webhooks/123/secret')).toThrow();
    expect(() => validateWebhookUrl('https://example.com/api/webhooks/123/secret')).toThrow();
  });

  it('builds a safe release card and preserves the complete log separately', () => {
    const payload = discordPayload(release, deployment);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0].title).toBe('VOLTMARCH 3.4.0 deployed');
    expect(payload.embeds[0].description).toContain('@everyone cannot ping');
    expect(payload.embeds[0].fields.find((field) => field.name === 'DEPLOYED')?.value)
      .toContain('Browser game');
    expect(releaseLog(release, deployment)).toContain(release.body);
    expect(releaseLog(release, deployment)).toContain(release.url);
    expect(releaseLog(release, deployment)).toContain(deployment.sha);
  });

  it('caps the visible excerpt but attaches the unabridged generated notes', () => {
    const long = normaliseRelease({ ...release, body: `## Full log\n\n${'change '.repeat(1200)}` });
    expect(discordPayload(long, deployment).embeds[0].description.length).toBeLessThanOrEqual(3800);
    expect(releaseLog(long, deployment)).toContain(long.body);
  });

  it('refuses to claim a desktop deployment without the complete updater artifact set', () => {
    const incomplete = normaliseRelease({ ...release, assets: [{ name: 'latest.yml' }] });
    expect(() => normaliseDeployment({
      targets: 'desktop,relay',
      sha: deployment.sha,
    }, incomplete)).toThrow(/desktop release is incomplete/);
  });

  it('names surfaces omitted from this exact deployment', () => {
    const partial = normaliseDeployment({ targets: 'desktop,relay', sha: deployment.sha }, release);
    const field = discordPayload(release, partial).embeds[0].fields
      .find((candidate) => candidate.name === 'NOT IN THIS DEPLOY');
    expect(field?.value).toBe('Browser game');
  });

  it('posts multipart data with confirmation enabled', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"id":"message"}', { status: 200 }));
    await postRelease('https://discord.com/api/webhooks/123/secret', release, deployment, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toContain('wait=true');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('announces only after relay verification and resolves the exact deployed surfaces', () => {
    const desktopWorkflow = readFileSync('.github/workflows/desktop.yml', 'utf8');
    const relayWorkflow = readFileSync('.github/workflows/deploy-relay.yml', 'utf8');

    expect(desktopWorkflow).not.toContain('post-discord-release.mjs');
    expect(relayWorkflow).toContain('needs: deploy');
    expect(relayWorkflow).toContain('Wait for the complete Windows release');
    expect(relayWorkflow).toContain('gh run list --workflow deploy.yml --commit "$GITHUB_SHA"');
    expect(relayWorkflow).toContain('VM_DEPLOYED_TARGETS: ${{ steps.surfaces.outputs.targets }}');
    expect(relayWorkflow).toContain('VM_DEPLOYED_SHA: ${{ github.sha }}');
    expect(relayWorkflow.indexOf('Verify public Cloudflare route'))
      .toBeLessThan(relayWorkflow.indexOf('Announce verified deployment on Discord'));
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  cloudflareAnalyticsEligible,
  installCloudflareAnalytics,
  validCloudflareAnalyticsToken,
} from '../src/platform/cloudflare-analytics';

describe('Cloudflare Web Analytics boundary', () => {
  it('accepts the public domain and rejects desktop, dev and lookalike hosts', () => {
    expect(cloudflareAnalyticsEligible({ protocol: 'https:', hostname: 'voltmarch.com' })).toBe(true);
    expect(cloudflareAnalyticsEligible({ protocol: 'app:', hostname: 'voltmarch' })).toBe(false);
    expect(cloudflareAnalyticsEligible({ protocol: 'http:', hostname: 'localhost' })).toBe(false);
    expect(cloudflareAnalyticsEligible({ protocol: 'https:', hostname: 'voltmarch.com.example' })).toBe(false);
    expect(cloudflareAnalyticsEligible({ protocol: 'https:', hostname: 'avihaymenahem.github.io' })).toBe(false);
  });

  it('does not emit a request without a plausible public site token', () => {
    expect(validCloudflareAnalyticsToken('')).toBe(false);
    expect(validCloudflareAnalyticsToken('%VITE_CF_WEB_ANALYTICS_TOKEN%')).toBe(false);
    expect(validCloudflareAnalyticsToken('a'.repeat(32))).toBe(true);
  });

  it('installs Cloudflare\'s official module tag once and renders the token as data', () => {
    const appendChild = vi.fn();
    const script = { id: '', type: '', src: '', dataset: {} as Record<string, string> };
    const root = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => script),
      head: { appendChild },
      documentElement: { appendChild },
    } as unknown as Document;
    const token = '0123456789abcdef0123456789abcdef';

    expect(installCloudflareAnalytics(
      token,
      { protocol: 'https:', hostname: 'voltmarch.com' },
      root,
    )).toBe(true);
    expect(script).toMatchObject({
      id: 'vm-cloudflare-web-analytics',
      type: 'module',
      src: 'https://static.cloudflareinsights.com/beacon.min.js',
      dataset: { cfBeacon: JSON.stringify({ token }) },
    });
    expect(appendChild).toHaveBeenCalledWith(script);
  });
});

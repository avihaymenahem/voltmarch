/** Cloudflare Web Analytics, isolated from desktop/dev and the screenshot harness. */
const BEACON_SOURCE = 'https://static.cloudflareinsights.com/beacon.min.js';
const BEACON_ID = 'vm-cloudflare-web-analytics';

/** The beacon token is public, but malformed values should never create a request. */
export function validCloudflareAnalyticsToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(token);
}

/** Only the public HTTPS domain may report. app://, localhost and GitHub previews stay silent. */
export function cloudflareAnalyticsEligible(url: Pick<Location, 'protocol' | 'hostname'>): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (host === 'voltmarch.com' || host.endsWith('.voltmarch.com'));
}

/**
 * Install Cloudflare's official module beacon once.
 *
 * This is deliberately runtime-injected instead of a literal tag in
 * index.html: the exact same Vite output is also packaged behind app:// by
 * Electron, and desktop sessions must not be reported as website visitors.
 */
export function installCloudflareAnalytics(
  token = import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN?.trim() ?? '',
  url: Pick<Location, 'protocol' | 'hostname'> = window.location,
  root: Document = document,
): boolean {
  if (!validCloudflareAnalyticsToken(token) || !cloudflareAnalyticsEligible(url)) return false;
  if (root.getElementById(BEACON_ID) !== null) return false;

  const script = root.createElement('script');
  script.id = BEACON_ID;
  script.type = 'module';
  script.src = BEACON_SOURCE;
  script.dataset.cfBeacon = JSON.stringify({ token });
  (root.head ?? root.documentElement).appendChild(script);
  return true;
}

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, 'public');
const target = join(root, 'dist');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

const analyticsToken = process.env.CF_WEB_ANALYTICS_TOKEN?.trim() ?? '';
if (analyticsToken && !/^[a-f0-9]{32}$/iu.test(analyticsToken)) {
  throw new Error('CF_WEB_ANALYTICS_TOKEN must be a 32-character hexadecimal site token');
}
const analyticsTag = analyticsToken
  ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${analyticsToken}"}'></script>`
  : '';
for (const page of ['index.html', 'privacy.html']) {
  const path = join(target, page);
  const html = readFileSync(path, 'utf8');
  if (!html.includes('<!-- CF_WEB_ANALYTICS -->')) {
    throw new Error(`${page} is missing its Cloudflare analytics placeholder`);
  }
  writeFileSync(path, html.replace('<!-- CF_WEB_ANALYTICS -->', analyticsTag));
}
console.log(`Built launch site: ${target}`);
console.log(`Cloudflare Web Analytics: ${analyticsToken ? 'enabled' : 'disabled'}`);

/**
 * Capture a MENU screen from the built game.
 *
 * `npm run shots` poses `?shot=` fixtures, which skip the menu entirely — so
 * nothing in this repo can photograph the lobby, the campaign screen or the
 * options. Every menu defect so far has been found by a human looking at one.
 *
 *   node menu-shot.mjs <outDir> [screen ...]
 *
 * Screens: main, skirmish, campaign, missions, settings
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/Administrator/projects/voltmarch';
const OUT = process.argv[2] ?? 'menu-shots';
const WANT = process.argv.slice(3);
const SCREENS = WANT.length > 0 ? WANT : ['main', 'skirmish', 'campaign'];

if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('dist/index.html missing — run npm run build first');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// A plain static server on an ephemeral port. `vite preview --strictPort` on a
// fixed port is what let the shot harness photograph another worktree's build.
const SERVE = `
const http = require('http'), fs = require('fs'), p = require('path');
const root = ${JSON.stringify(path.join(ROOT, 'dist'))};
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.png':'image/png', '.webp':'image/webp', '.ogg':'audio/ogg', '.json':'application/json',
  '.woff2':'font/woff2', '.svg':'image/svg+xml' };
const srv = http.createServer((rq, rs) => {
  let f = p.join(root, decodeURIComponent(rq.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = p.join(root, 'index.html');
  rs.setHeader('Content-Type', mime[p.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(rs);
});
srv.listen(0, '127.0.0.1', () => { console.log('PORT ' + srv.address().port); });
`;

const server = spawn(process.execPath, ['-e', SERVE], { stdio: ['ignore', 'pipe', 'inherit'] });

const port = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('server did not start')), 10000);
  server.stdout.on('data', (d) => {
    buf += String(d);
    const m = buf.match(/PORT (\d+)/);
    if (m) { clearTimeout(t); resolve(Number(m[1])); }
  });
});
const origin = `http://127.0.0.1:${port}`;
console.log('serving', origin);

const browser = await chromium.launch({
  // Same args as `tools/shoot.mjs`: headless Chromium hands back a black canvas
  // rather than failing loudly with no GPU backend, and the boot curtain never
  // drops without one.
  args: [
    '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 160)); });

/** Load the menu and wait for the boot curtain to actually drop. */
async function boot() {
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  // The curtain is a real element and it is what hides the menu. Waiting on a
  // timeout instead photographs "COMPILING SHADERS", which is what the first
  // run of this tool produced.
  await page.waitForFunction(() => {
    const c = document.querySelector('#boot, .vm-boot, .vm-curtain, [data-boot]');
    if (c !== null && c.isConnected) {
      const s = getComputedStyle(c);
      if (s.display !== 'none' && s.opacity !== '0' && s.visibility !== 'hidden') return false;
    }
    return document.querySelectorAll('button, .vm-btn').length > 2;
  }, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
await boot();

/**
 * Click a top-level menu entry by its visible text.
 *
 * DOM-side rather than a Playwright locator: the menu rows are not `<button>`
 * and the labels are uppercased by CSS, so a tag-scoped `:has-text` matched
 * nothing on the first run and the tool reported "could not reach skirmish"
 * while the row was plainly on screen.
 */
async function open(labels) {
  return page.evaluate((want) => {
    const norm = (t) => (t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const all = [...document.querySelectorAll('button, a, [role="button"], [tabindex], .vm-btn, div, li')];
    for (const label of want) {
      const l = label.toLowerCase();
      const hit = all.find((e) => {
        if (e.getClientRects().length === 0) return false;
        const own = norm([...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
        return own === l || (norm(e.textContent).startsWith(l) && norm(e.textContent).length < l.length + 40);
      });
      if (hit !== undefined) { hit.click(); return true; }
    }
    // Nothing matched: report what WAS on screen. A router that fails
    // silently sends you looking at the wrong file.
    const seen = all.filter((e) => e.getClientRects().length > 0)
      .map((e) => norm(e.textContent)).filter((t) => t.length > 0 && t.length < 40);
    return { failed: [...new Set(seen)].slice(0, 40) };
  }, labels);
}

async function home() { await boot(); }

const ROUTES = {
  main: async () => true,
  skirmish: async () => open(['Skirmish', 'New Match', 'Play']),
  campaign: async () => open(['Campaign']),
  missions: async () => open(['Missions']),
  settings: async () => open(['Options', 'Settings']),
};

for (const name of SCREENS) {
  await home();
  const go = ROUTES[name];
  if (go === undefined) { console.log('unknown screen', name); continue; }
  const ok = await go();
  if (ok !== true) {
    // STILL PHOTOGRAPH IT. A router that fails and leaves nothing to look at
    // sends you reading source instead of the screen.
    await page.screenshot({ path: path.join(OUT, `${name}-FAILED.png`) });
    console.log(`could not reach ${name} (wrote ${name}-FAILED.png)`);
    console.log('  saw:', JSON.stringify(ok?.failed ?? ok).slice(0, 500));
    continue;
  }
  await page.waitForTimeout(1200);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const h = await page.evaluate(() => document.body.scrollHeight);
  console.log(`${name}  ->  ${file}   bodyScrollHeight=${h}`);
}

await browser.close();
server.kill();

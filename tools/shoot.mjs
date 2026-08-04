/**
 * Visual critique harness.
 *
 * Boots the built game in headless Chromium, poses each shot through the
 * `window.__VM` handle from src/render/debug.ts, and writes deterministic PNGs
 * for the critic agents to read side by side against refs/ra3steam_*.jpg.
 *
 *   node tools/shoot.mjs                 # every shot
 *   node tools/shoot.mjs hud combat      # only shots whose name matches
 *   node tools/shoot.mjs --headed        # watch it happen
 *
 * Output: shots/<name>.png + shots/_report.json
 *
 * Captured at 2560x1440 because docs/RA3_LOOK_BIBLE.md §13 quotes its pass
 * criteria in pixels at that resolution ("penumbra 1.2-2.5 px at 1440p").
 * Shooting at any other size silently invalidates a third of the scorecard.
 *
 * Scene *content* comes from the `?shot=` boot flag, which src/game/Bootstrap.ts
 * routes to a scenario builder. Camera, mood and timing are driven here through
 * __VM so a critic's note ("too close, I can't judge the base silhouette") is a
 * one-line change in this file rather than a rebuild.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'shots');
const PORT = 4317;
const BASE = `http://localhost:${PORT}/`;

/** The bible quotes its pixel tolerances at 1440p. Do not change without re-deriving §13. */
const VIEWPORT = { width: 2560, height: 1440 };

/**
 * World coordinates run 0..MAP_SIZE, so (0,0) is the map CORNER, not the
 * centre — mirrors MAP_SIZE / 2 in src/core/config.ts (CELL 4 * MAP_CELLS 128).
 * Every `?shot=` scenario must build its subject here.
 */
const MAP_CENTER = 256;

/*
 * A shot is data, not code: `flags` picks the scenario, `pose` is an ordered
 * list of __VM calls, `settle` is how many frames to let the frame stabilise
 * (shader compiles, LOD, particle steady-state) before the shutter.
 */
const SHOTS = [
  {
    name: '01-establishing-base',
    caption: 'Wide Allied base. The money shot — silhouette, prop density, ground adornment.',
    flags: { shot: 'allied-base', seed: 7 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 62], ['setUiVisible', false]],
  },
  {
    name: '02-hud-full',
    caption: 'Full frame with the sidebar HUD. Direct comparison against the RA2/RA3 sidebar refs.',
    flags: { shot: 'allied-base', seed: 7 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 55], ['setUiVisible', true]],
  },
  {
    name: '03-terrain-closeup',
    caption: 'Ground detail: surface frequency, scatter, roads, kerbs, crosswalks, tread marks.',
    flags: { shot: 'terrain-showcase', seed: 3 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 30], ['setUiVisible', false]],
  },
  {
    name: '04-units-parade',
    caption: 'Unit lineup at readable range — silhouette law, bevels, team-colour slabs, greeble.',
    flags: { shot: 'unit-parade', seed: 1 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 38], ['setUiVisible', false]],
  },
  {
    name: '05-combat',
    caption: 'Mid-battle: muzzle flash, tracers, tesla, explosions, smoke, wrecks, scene light wash.',
    flags: { shot: 'battle', seed: 11 },
    // MEASURED, both ways. 66 m / 2.5 s was tried to clear the tree canopy and
    // catch a live fireball: p99 luminance did not move off 0.77 and the wider
    // frame let the dust plume push median luminance to 0.52, failing a second
    // check. 48 m / 4 s is the better of the two and is kept. The residual —
    // no highlight anywhere in the frame — is the plume, not the framing.
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 48], ['setUiVisible', false]],
    advance: 4.0,
  },
  {
    name: '06-economy',
    caption: 'Ore field, harvester, refinery — the economic loop in motion.',
    flags: { shot: 'economy', seed: 5 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 42], ['setUiVisible', false]],
    advance: 6.0,
  },
  {
    name: '07-soviet-base',
    caption: 'Soviet base. Olive-green + riveted plate vs Allied chrome — faction material language.',
    flags: { shot: 'soviet-base', seed: 9 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 62], ['setUiVisible', false]],
  },
  {
    name: '08-naval-water',
    caption: 'Water as a hero element: absorption gradient, foam filigree, wakes, shoreline band.',
    flags: { shot: 'naval', seed: 13 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 55], ['setUiVisible', false]],
    advance: 3.0,
  },
  {
    name: '09-placement',
    caption: 'Building placement: the ghost, the grid, valid/invalid cells, the range ring.',
    flags: { shot: 'placement', seed: 7 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 36], ['setUiVisible', true]],
  },
  {
    name: '10-selection',
    caption: 'Selected units: rings, health bars, move-order feedback, veterancy.',
    flags: { shot: 'selection', seed: 1 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 34], ['setUiVisible', true]],
  },
  {
    name: '11-dusk-mood',
    caption: 'Lighting range: the same base under the dusk preset. Grade must hold, not wash out.',
    flags: { shot: 'allied-base', seed: 7, art: 'dusk' },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 62], ['setUiVisible', false]],
  },
  {
    name: '12-blob-readability',
    caption: '40+ units massed. Scorecard #.. readability under load — do units stay legible?',
    flags: { shot: 'blob', seed: 4 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 50], ['setUiVisible', false]],
  },
];

/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const headed = argv.includes('--headed');
const wanted = argv.filter((a) => !a.startsWith('--'));
const shots = wanted.length ? SHOTS.filter((s) => wanted.some((w) => s.name.includes(w))) : SHOTS;

if (!shots.length) {
  console.error(`No shots matched ${JSON.stringify(wanted)}.\nKnown: ${SHOTS.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

/*
 * Concurrency.
 *
 * This used to `rmSync(shots/)` on entry. With more than one agent working in
 * the repo that is actively destructive: a second run wipes the first run's
 * output mid-measurement, and `tools/metrics.mjs` then scores whatever survived
 * and reports a confident grade over a partial set. That produced several wrong
 * numbers before anyone noticed.
 *
 * So: take a lock, and capture into a staging directory that is swapped into
 * place only once every shot has been taken. A reader either sees the previous
 * complete set or the new complete set, never a half-written one.
 */
const LOCK = join(OUT, '.lock');
mkdirSync(OUT, { recursive: true });

if (existsSync(LOCK)) {
  const age = Date.now() - Number(readFileSync(LOCK, 'utf8').split('\n')[1] ?? 0);
  if (age < 30 * 60_000) {
    console.error(
      `Another capture is running (lock is ${Math.round(age / 1000)}s old).\n` +
        `If that is stale, delete ${LOCK} and retry.`,
    );
    process.exit(3);
  }
  console.warn('Stale lock found (over 30 min old) — taking it over.');
}
writeFileSync(LOCK, `pid ${process.pid}\n${Date.now()}\n`);

const STAGE = join(ROOT, '.shots-staging');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

const releaseLock = () => { try { rmSync(LOCK, { force: true }); } catch {} };
process.on('exit', releaseLock);

const run = (cmd, args) =>
  spawn(cmd, args, { cwd: ROOT, shell: process.platform === 'win32', stdio: 'pipe' });

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

console.log('> building...');
await new Promise((resolve, reject) => {
  const b = run('npm', ['run', 'build']);
  let out = '';
  b.stdout.on('data', (d) => (out += d));
  b.stderr.on('data', (d) => (out += d));
  b.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`build failed:\n${out.slice(-4000)}`))));
});

console.log('> serving...');
const server = run('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort']);
const cleanup = () => { try { server.kill(); } catch {} };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

if (!(await waitForServer(BASE))) { cleanup(); throw new Error(`preview never came up on ${BASE}`); }

// Real GPU first. Headless Chromium will hand back a black canvas rather than
// fail loudly if no backend is available, which would silently poison every
// critique, so we assert the context afterwards.
const browser = await chromium.launch({
  headless: !headed,
  args: [
    '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
  ],
});

const report = { viewport: VIEWPORT, webgl: null, shots: [] };

for (const shot of shots) {
  process.stdout.write(`> ${shot.name} ... `);
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  /*
   * Playwright's 30 s default is not enough for this page and the failure is
   * silent-ish: `page.goto` or `page.screenshot` times out, the shot is marked
   * FAILED, and a critic scores a black `*.FAILED.png` as if it were the game.
   * Two boots in a row failed that way on a box running other builds.
   *
   * The budget is real work, not a hang: a 1.9 MB bundle, then 24 unit models,
   * 28 structures and 23 Meridian models generated procedurally, then a 512 px
   * greeble atlas per faction, then terrain, roads and scatter — at 2560x1440
   * with a first-frame shader compile for every material. 120 s is the honest
   * ceiling for that on a loaded machine; a genuine hang still fails, just
   * later.
   */
  page.setDefaultTimeout(120_000);
  page.setDefaultNavigationTimeout(120_000);
  const messages = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') messages.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message}`));

  try {
    const qs = new URLSearchParams(Object.entries(shot.flags).map(([k, v]) => [k, String(v)]));
    await page.goto(`${BASE}?${qs}`, { waitUntil: 'load' });

    await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 60_000 });
    await page.evaluate(() => window.__VM.ready());

    if (!report.webgl) {
      report.webgl = await page.evaluate(() => {
        const gl = window.__VM.renderer.getContext();
        const d = gl.getExtension('WEBGL_debug_renderer_info');
        return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'masked';
      });
      console.log(`\n  webgl: ${report.webgl}\n  ${shot.name} ... `);
    }

    // Apply the pose as data — no eval, and an unknown method is a loud failure
    // rather than a silently mis-framed shot that a critic then scores.
    const missing = await page.evaluate((cmds) => {
      const RA = window.__VM;
      const absent = [];
      for (const [method, ...args] of cmds) {
        if (typeof RA[method] !== 'function') { absent.push(method); continue; }
        RA[method](...args);
      }
      return absent;
    }, shot.pose);
    if (missing.length) throw new Error(`__VM is missing: ${missing.join(', ')}`);

    if (shot.advance) {
      await page.evaluate((s) => new Promise((r) => setTimeout(r, s * 1000)), shot.advance);
    }
    await page.evaluate(() => window.__VM.waitFrames(10));

    await page.screenshot({ path: join(STAGE, `${shot.name}.png`), animations: 'disabled' });
    report.shots.push({ name: shot.name, caption: shot.caption, flags: shot.flags, ok: true, messages });
    console.log(`ok${messages.length ? ` (${messages.length} console msgs)` : ''}`);
  } catch (err) {
    report.shots.push({ name: shot.name, caption: shot.caption, ok: false, error: String(err).split('\n')[0], messages });
    console.log(`FAILED - ${String(err).split('\n')[0]}`);
    await page.screenshot({ path: join(STAGE, `${shot.name}.FAILED.png`) }).catch(() => {});
  } finally {
    await page.close();
  }
}

writeFileSync(join(STAGE, '_report.json'), JSON.stringify(report, null, 2));

// Swap staging into place. A reader sees the previous complete set until this
// point, then the new complete set — never a partially-captured directory.
for (const f of readdirSync(OUT)) {
  if (f !== '.lock') rmSync(join(OUT, f), { recursive: true, force: true });
}
for (const f of readdirSync(STAGE)) renameSync(join(STAGE, f), join(OUT, f));
rmSync(STAGE, { recursive: true, force: true });
await browser.close();
cleanup();

const failed = report.shots.filter((s) => !s.ok);
console.log(`\n${report.shots.length - failed.length}/${report.shots.length} captured -> shots/`);
if (failed.length) {
  console.log(`failed: ${failed.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

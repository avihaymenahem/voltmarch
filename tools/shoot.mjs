/**
 * Visual critique harness.
 *
 * Boots the built game in headless Chromium, poses each shot through the
 * `window.__RA` handle from src/render/debug.ts, and writes deterministic PNGs
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
 * __RA so a critic's note ("too close, I can't judge the base silhouette") is a
 * one-line change in this file rather than a rebuild.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
 * list of __RA calls, `settle` is how many frames to let the frame stabilise
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

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

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
  const messages = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') messages.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message}`));

  try {
    const qs = new URLSearchParams(Object.entries(shot.flags).map(([k, v]) => [k, String(v)]));
    await page.goto(`${BASE}?${qs}`, { waitUntil: 'load' });

    await page.waitForFunction(() => typeof window.__RA?.ready === 'function', null, { timeout: 60_000 });
    await page.evaluate(() => window.__RA.ready());

    if (!report.webgl) {
      report.webgl = await page.evaluate(() => {
        const gl = window.__RA.renderer.getContext();
        const d = gl.getExtension('WEBGL_debug_renderer_info');
        return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'masked';
      });
      console.log(`\n  webgl: ${report.webgl}\n  ${shot.name} ... `);
    }

    // Apply the pose as data — no eval, and an unknown method is a loud failure
    // rather than a silently mis-framed shot that a critic then scores.
    const missing = await page.evaluate((cmds) => {
      const RA = window.__RA;
      const absent = [];
      for (const [method, ...args] of cmds) {
        if (typeof RA[method] !== 'function') { absent.push(method); continue; }
        RA[method](...args);
      }
      return absent;
    }, shot.pose);
    if (missing.length) throw new Error(`__RA is missing: ${missing.join(', ')}`);

    if (shot.advance) {
      await page.evaluate((s) => new Promise((r) => setTimeout(r, s * 1000)), shot.advance);
    }
    await page.evaluate(() => window.__RA.waitFrames(10));

    await page.screenshot({ path: join(OUT, `${shot.name}.png`), animations: 'disabled' });
    report.shots.push({ name: shot.name, caption: shot.caption, flags: shot.flags, ok: true, messages });
    console.log(`ok${messages.length ? ` (${messages.length} console msgs)` : ''}`);
  } catch (err) {
    report.shots.push({ name: shot.name, caption: shot.caption, ok: false, error: String(err).split('\n')[0], messages });
    console.log(`FAILED - ${String(err).split('\n')[0]}`);
    await page.screenshot({ path: join(OUT, `${shot.name}.FAILED.png`) }).catch(() => {});
  } finally {
    await page.close();
  }
}

writeFileSync(join(OUT, '_report.json'), JSON.stringify(report, null, 2));
await browser.close();
cleanup();

const failed = report.shots.filter((s) => !s.ok);
console.log(`\n${report.shots.length - failed.length}/${report.shots.length} captured -> shots/`);
if (failed.length) {
  console.log(`failed: ${failed.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

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
 *   node tools/shoot.mjs --no-build      # serve the EXISTING dist/, do not rebuild
 *
 * `--no-build` exists for one job: measuring run-to-run variance. Two captures
 * are only a measurement of the HARNESS if they ran the same bytes, and with
 * several agents in the repo `npm run build` between two runs can quietly pick
 * up somebody else's edit. It is recorded in `_report.json` as `built: false`,
 * because a stale dist/ scored as if it were current is the other way to get a
 * confident wrong number.
 *
 * Output: shots/<name>.png + shots/_report.json
 *
 * Captured at 2560x1440 because docs/RA3_LOOK_BIBLE.md §13 quotes its pass
 * criteria in pixels at that resolution ("penumbra 1.2-2.5 px at 1440p").
 * Shooting at any other size silently invalidates a third of the scorecard.
 *
 * That sentence was WRONG for the whole life of this file. The viewport was
 * 1440p; the DRAWING BUFFER was not. Nothing put the renderer in fixed-size
 * mode, so it kept the quality tier's `resolutionScale` and rendered 2304x1296,
 * which the compositor upscaled. Measured at the shutter, not inferred. It is
 * now pinned by a `setSize` pose step and ASSERTED before the shutter, and the
 * buffer that was actually photographed is recorded in `_report.json`.
 *
 * ============================================================================
 * A CAPTURE IS REPRODUCIBLE, AND THAT IS TESTED BY RUNNING IT TWICE
 * ============================================================================
 * Two runs of one build produce BYTE-IDENTICAL PNGs for the nine fixtures that
 * do not show the HUD, on an idle machine and under 14 saturated CPU threads.
 * Before the work in this file and in `GameLoop.captureClock` /
 * `advanceFrames`, ZERO of twelve matched and the worst graded-metric drift was
 * 0.0146 — larger than most real art changes, and invisible whenever the
 * machine was quiet enough to check.
 *
 * THE KNOWN RESIDUAL, stated so nobody re-derives it: `02-hud-full` is
 * bistable, and `09-placement` / `10-selection` occasionally are. The whole
 * difference is 141 pixels on ONE ROW (y = 71, x 885..1093), by at most 2/255 —
 * the antialiased bottom edge of the HUD power meter, whose height is a
 * fractional `calc()` that lands on either side of a subpixel boundary
 * depending on when the DOM last relaid out. It is DOM layout rounding, not the
 * game's render: every graded metric is identical to four decimals across it,
 * and nothing outside that row moves. Fixing it means chasing `--vm-u` through
 * `hud.css`, which is worth doing only if the HUD ever needs to be graded.
 *
 * If you change anything here, prove it the same way:
 *
 *     npm run build
 *     node tools/shoot.mjs --no-build && sha256sum shots/*.png > /tmp/a
 *     node tools/shoot.mjs --no-build && sha256sum shots/*.png > /tmp/b
 *     diff /tmp/a /tmp/b
 *
 * A diff outside that one row means the harness has stopped being an
 * instrument, and it will not announce itself: it still produces twelve
 * confident images.
 *
 * Scene *content* comes from the `?shot=` boot flag, which src/game/Bootstrap.ts
 * routes to a scenario builder. Camera, mood and timing are driven here through
 * __VM so a critic's note ("too close, I can't judge the base silhouette") is a
 * one-line change in this file rather than a rebuild.
 *
 * ============================================================================
 * THE CAMERA IS PART OF THE INSTRUMENT
 * ============================================================================
 * The grade these images feed is a measurement of the ART. It stops being one
 * the moment the CAMERA differs between runs, and nothing downstream can tell
 * the two apart — a pitch that moved two degrees and a lighting change look the
 * same in a luminance histogram.
 *
 * Pitch used to be safe without anyone guarding it, because `CameraRig` derived
 * it from the dolly distance and there was no second writer. Pitch is becoming
 * player-controlled. So every shot now DECLARES its `camera` block, the pose is
 * asserted against the live rig immediately before the shutter, and a mismatch
 * FAILS THE SHOT — same treatment the boot curtain gets, and for the same
 * reason: a run that quietly photographed the wrong thing has already been
 * shipped from this file once, and the six points it cost were attributed to an
 * art change for two days.
 *
 * The declared `pitchDeg` values are the pitch each fixture ALREADY renders at,
 * so adding the guard moved no pixels. They are the rig's zoom curve at the
 * shot's dolly:
 *
 *     t   = clamp((distance - 30) / (140 - 30), 0, 1)
 *     deg = 46 + 12 * t * t * (3 - 2t)
 *
 * `tests/shot-camera.spec.ts` re-derives every one of them from the live
 * `RENDER_CONFIG` and from a real `CameraRig`, so if the camera config ever
 * changes, the table goes red in `npm test` rather than silently moving a grade.
 * ============================================================================
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

/**
 * The fixed simulation rate, mirroring `SIM_HZ` in src/core/config.ts.
 *
 * Duplicated rather than imported because this file drives a BUILT bundle over
 * HTTP and never imports the source. It is corroborated against the live game
 * at capture time (see the preflight in the shot loop), so a config change that
 * invalidates it fails the run instead of silently advancing the wrong amount.
 */
const SIM_HZ = 30;

/*
 * A shot is data, not code: `flags` picks the scenario, `pose` is an ordered
 * list of __VM calls, `settle` is how many frames to let the frame stabilise
 * (shader compiles, LOD, particle steady-state) before the shutter.
 *
 * `camera` is the CANONICAL POSE — the frame the scorecard is calibrated
 * against. It is mandatory (see `preflight` below), it is applied after `pose`,
 * and it is asserted against the live rig before the shutter opens. `distance`
 * must agree with the `focusOn` step; the preflight refuses if it does not,
 * because two numbers meaning the same thing that disagree is how the framing
 * drifts without anybody editing the framing.
 *
 * ============================================================================
 * `advance`: SECONDS OF PRESENTATION, AND WHY EVERY SHOT GETS 10
 * ============================================================================
 * `?shot=` boots PAUSED. All simulated motion in a fixture comes from the
 * scenario's own `settleTicks`, which `src/game/scenarios.system.ts` runs with
 * `loop.runHeadless` — ticks with no frames between them. So every effect those
 * ticks emitted (a four-second battle is 1776 queued records) arrives in ONE
 * frame, all at age zero: a wall of dust and fireballs that hides the map.
 *
 * `advance` is how long the fixture then lets that pile play out. It never was
 * simulation time and still is not.
 *
 * The old values — 4.0 / 6.0 / 3.0 — were a `setTimeout` in wall clock, and
 * they were not even the amount of ageing the frame received: the pile started
 * ageing at the first rendered frame, which is several seconds of boot before
 * the sleep began. The fixtures were being aged by BOOT DURATION, which is why
 * a slow machine photographed a different frame from a fast one.
 *
 * So the settle curve was measured directly, by advancing one page in steps and
 * reading the pools at each. Mean frame luminance:
 *
 *     t (s)     0     1     2     3     4     6     8    12    16    24    32
 *     battle  .602  .510  .521    —   .549  .359  .314  .306  .310  .307  .309
 *     naval   .605  .432  .456  .461  .466  .404  .389  .388  .391    —   .386
 *     economy .415    —   .415    —   .415  .415  .415  .415  .415  .415    —
 *
 * Every fixture is on a PLATEAU by 8 s and stays there out to 32 s; the lit
 * (smoke) pool goes 1300 -> 370 on battle over the same span and then holds.
 * 10.0 s puts all three on the flat, which is the property a regression
 * detector wants: the exact value stops mattering, so nothing about the frame
 * is a function of the number chosen here.
 *
 * EVERY shot gets it, not just the three that used to declare one, because the
 * effect pools are not the only thing in a frame that eases. `02-hud-full` was
 * the last fixture that would not reproduce, and the whole difference was four
 * pixels of the credits readout: `RollingCounter.step` in `src/ui/Chrome.ts`
 * floors its per-frame movement at `creditsTallyMin`, so it advances even on a
 * frame worth no time, and the number of frames a boot takes is not fixed. Ten
 * seconds is far more than the counter needs to reach its target and stop, and
 * an easing that has finished cannot be photographed mid-way.
 * ============================================================================
 */

/**
 * Presentation seconds every fixture is advanced by before the shutter, unless
 * it overrides `advance`. See the block above.
 */
const SETTLE_SECONDS = 10.0;
const SHOTS = [
  {
    name: '01-establishing-base',
    caption: 'Wide Allied base. The money shot — silhouette, prop density, ground adornment.',
    flags: { shot: 'allied-base', seed: 7 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 62], ['setUiVisible', false]],
    camera: { distance: 62, pitchDeg: 48.4558 },
  },
  {
    name: '02-hud-full',
    caption: 'Full frame with the sidebar HUD. Direct comparison against the RA2/RA3 sidebar refs.',
    flags: { shot: 'allied-base', seed: 7 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 55], ['setUiVisible', true]],
    // The only shot that re-dollies away from its scenario's declared distance
    // (allied-base authors for 62 m), so it is also the only one whose
    // canonical pitch differs from the one src/game/scenarios.system.ts pins.
    camera: { distance: 55, pitchDeg: 47.5778 },
  },
  {
    name: '03-terrain-closeup',
    caption: 'Ground detail: surface frequency, scatter, roads, kerbs, crosswalks, tread marks.',
    flags: { shot: 'terrain-showcase', seed: 3 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 30], ['setUiVisible', false]],
    // 30 m is the zoom floor, so this is pitchAtMinDistance exactly.
    camera: { distance: 30, pitchDeg: 46.0 },
  },
  {
    name: '04-units-parade',
    caption: 'Unit lineup at readable range — silhouette law, bevels, team-colour slabs, greeble.',
    flags: { shot: 'unit-parade', seed: 1 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 38], ['setUiVisible', false]],
    camera: { distance: 38, pitchDeg: 46.1812 },
  },
  {
    name: '05-combat',
    caption: 'Mid-battle: muzzle flash, tracers, tesla, explosions, smoke, wrecks, scene light wash.',
    flags: { shot: 'battle', seed: 11 },
    // MEASURED, both ways. 66 m was tried to clear the tree canopy and catch a
    // live fireball: p99 luminance did not move off 0.77 and the wider frame
    // let the dust plume push median luminance to 0.52, failing a second check.
    // 48 m is the better of the two and is kept.
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 48], ['setUiVisible', false]],
    camera: { distance: 48, pitchDeg: 46.8588 },
  },
  {
    name: '06-economy',
    caption: 'Ore field, harvester, refinery — the economic loop in motion.',
    flags: { shot: 'economy', seed: 5 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 42], ['setUiVisible', false]],
    camera: { distance: 42, pitchDeg: 46.3973 },
  },
  {
    name: '07-soviet-base',
    caption: 'Soviet base. Olive-green + riveted plate vs Allied chrome — faction material language.',
    flags: { shot: 'soviet-base', seed: 9 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 62], ['setUiVisible', false]],
    camera: { distance: 62, pitchDeg: 48.4558 },
  },
  {
    name: '08-naval-water',
    caption: 'Water as a hero element: absorption gradient, foam filigree, wakes, shoreline band.',
    flags: { shot: 'naval', seed: 13 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 55], ['setUiVisible', false]],
    camera: { distance: 55, pitchDeg: 47.5778 },
  },
  {
    name: '09-placement',
    caption: 'Building placement: the ghost, the grid, valid/invalid cells, the range ring.',
    flags: { shot: 'placement', seed: 7 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 36], ['setUiVisible', true]],
    camera: { distance: 36, pitchDeg: 46.1032 },
  },
  {
    name: '10-selection',
    caption: 'Selected units: rings, health bars, move-order feedback, veterancy.',
    flags: { shot: 'selection', seed: 1 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 34], ['setUiVisible', true]],
    camera: { distance: 34, pitchDeg: 46.0464 },
  },
  {
    name: '11-dusk-mood',
    caption: 'Lighting range: the same base under the dusk preset. Grade must hold, not wash out.',
    flags: { shot: 'allied-base', seed: 7, art: 'dusk' },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 62], ['setUiVisible', false]],
    camera: { distance: 62, pitchDeg: 48.4558 },
  },
  {
    name: '12-blob-readability',
    caption: '40+ units massed. Scorecard #.. readability under load — do units stay legible?',
    flags: { shot: 'blob', seed: 4 },
    pose: [['focusOn', MAP_CENTER, MAP_CENTER, 50], ['setUiVisible', false]],
    camera: { distance: 50, pitchDeg: 47.0458 },
  },
];

/*
 * The pose tolerance, in degrees and metres.
 *
 * 0.05 deg is roughly a pixel of horizon travel at 1440p and 62 m, and it is
 * three orders of magnitude above the rounding in the four-decimal table above.
 * Wide enough never to fire on arithmetic; far too tight for any pitch a human
 * would have chosen with a keyboard.
 */
const POSE_TOLERANCE = { angleDeg: 0.05, metres: 0.05 };

/*
 * PREFLIGHT — run before the build, because a table that cannot produce a valid
 * run should cost zero minutes rather than a full capture.
 *
 * This is the same shape as `tools/metrics.mjs --expect N`: state the contract,
 * check it, and refuse. The two failures this catches are (a) a shot added
 * without a canonical camera, which would be photographed at whatever pose it
 * inherited, and (b) a `focusOn` distance edited without its `pitchDeg`, which
 * is how a "one-line reframing" silently changes the pitch as well.
 */
function preflight(list) {
  const problems = [];
  for (const s of list) {
    const cam = s.camera;
    if (cam === undefined) {
      problems.push(`${s.name}: no \`camera\` block. Every fixture must declare its canonical pose.`);
      continue;
    }
    if (!Number.isFinite(cam.distance) || !Number.isFinite(cam.pitchDeg)) {
      problems.push(`${s.name}: camera.distance and camera.pitchDeg must both be finite numbers.`);
      continue;
    }
    const focus = (s.pose ?? []).find((step) => step[0] === 'focusOn');
    if (focus === undefined) {
      problems.push(`${s.name}: no focusOn step, so camera.distance cannot be corroborated.`);
      continue;
    }
    const posed = focus[3];
    if (Math.abs(posed - cam.distance) > POSE_TOLERANCE.metres) {
      problems.push(
        `${s.name}: focusOn dollies to ${posed} m but camera.distance says ${cam.distance} m. ` +
          'Re-derive camera.pitchDeg for the distance you actually want.',
      );
    }
  }
  return problems;
}

const preflightProblems = preflight(SHOTS);
if (preflightProblems.length) {
  console.error(
    'Refusing to capture — the shot table does not declare a complete canonical camera:\n  ' +
      preflightProblems.join('\n  ') +
      '\n\nThe grade is only a measurement of the art if every fixture is shot from the\n' +
      'same camera every run. See the header of this file.',
  );
  process.exit(4);
}

/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const headed = argv.includes('--headed');
const noBuild = argv.includes('--no-build');
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

if (noBuild) {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('--no-build was given but dist/index.html does not exist. Build once first.');
    process.exit(5);
  }
  console.log('> NOT building — serving the existing dist/ (--no-build)');
} else {
  console.log('> building...');
  await new Promise((resolve, reject) => {
    const b = run('npm', ['run', 'build']);
    let out = '';
    b.stdout.on('data', (d) => (out += d));
    b.stderr.on('data', (d) => (out += d));
    b.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`build failed:\n${out.slice(-4000)}`))));
  });
}

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

const report = {
  viewport: VIEWPORT,
  poseTolerance: POSE_TOLERANCE,
  built: !noBuild,
  webgl: null,
  shots: [],
};

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

    /*
     * `__VM.ready()` resolving is NOT the same as the game being on screen.
     * It resolved while the boot curtain still read "COMPILING SHADERS", and
     * `10-selection` and `12-blob-readability` were both silently captured as
     * photographs of the loading screen — identical metrics on two different
     * scenarios was the only tell. The harness cheerfully reported "12/12".
     *
     * So wait for the thing that actually matters: the curtain retracted, and
     * the renderer drawing real content. Scenario build time grew with the
     * content, which is why this only started biting now.
     */
    await page.waitForFunction(
      () => {
        const curtain = document.getElementById('loading');
        if (curtain !== null && curtain.hidden !== true) return false;
        const stats = window.__VM?.stats?.();
        return stats !== undefined && stats.drawCalls > 8;
      },
      null,
      { timeout: 180_000 },
    );

    /*
     * KILL EVERY CSS TRANSITION AND ANIMATION FOR THE CAPTURE.
     *
     * `GameLoop.captureClock` freezes the clock the GAME renders on. It has no
     * authority over the one the BROWSER animates the DOM on, and the HUD uses
     * it: `hud.css` puts `transition: background-color 120ms linear` on every
     * `.vm-power-seg`, so a segment that lit shortly before the shutter is
     * photographed part-way through its fade. That was the last thing standing
     * between this harness and byte-identical output — `02-hud-full` moved
     * about 150 subpixels by 1/255, intermittently, in the power meter.
     *
     * Playwright's `animations: 'disabled'` is supposed to cover this and does
     * not reliably: it settles animations at screenshot time, which is a race
     * against a transition that started on the frame before. Removing them
     * outright cannot race. The end state is also the honest one to photograph:
     * a fixture is a still, and a transition caught half-way is a number nobody
     * chose.
     */
    await page.addStyleTag({
      content: '*,*::before,*::after{transition:none!important;animation:none!important;}',
    });

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
    //
    // The canonical pitch is applied LAST and as an ordinary pose step, so it
    // inherits that same "unknown method is fatal" treatment: a build of the
    // game without `setCameraPitchDeg` on __VM must not quietly fall back to
    // capturing at whatever pitch the rig felt like.
    /*
     * PIN THE DRAWING BUFFER FIRST.
     * ============================
     * `setSize` puts the renderer in fixed-size mode: one drawing-buffer pixel
     * per requested pixel, device pixel ratio forced to 1, and — the part that
     * matters here — `RendererHandle.isFixedSize` true, which is the flag
     * `src/render/adaptive-res.system.ts` already checks before it steers,
     * with the comment "a fixed-size render is a screenshot".
     *
     * Nothing ever set it. So dynamic resolution WAS steering during every
     * capture this repo has ever taken, and it had settled at scale 0.9:
     * measured at the shutter, the drawing buffer was 2304x1296 upscaled to
     * 2560x1440. Two things follow. Every pixel figure in
     * docs/RA3_LOOK_BIBLE.md §13 — "penumbra 1.2-2.5 px at 1440p", the Sobel
     * edge-density band — has been measured on a resampled 1296p frame. And
     * because the controller needs a rolling window of frames to decide,
     * WHERE it had got to depended on how many frames the boot happened to
     * take, which is a whole-frame resample varying run to run: it is why
     * ~15% of subpixels moved between two captures of even a frozen fixture.
     *
     * First step in the list, so a build without `setSize` on __VM fails the
     * shot loudly rather than quietly photographing an upscale.
     */
    const steps = [
      ['setSize', VIEWPORT.width, VIEWPORT.height],
      ...shot.pose,
      ['setCameraPitchDeg', shot.camera.pitchDeg],
    ];
    const missing = await page.evaluate((cmds) => {
      const RA = window.__VM;
      const absent = [];
      for (const [method, ...args] of cmds) {
        if (typeof RA[method] !== 'function') { absent.push(method); continue; }
        RA[method](...args);
      }
      return absent;
    }, steps);
    if (missing.length) throw new Error(`__VM is missing: ${missing.join(', ')}`);

    /*
     * ADVANCE BY TICKS, NOT BY WALL CLOCK.
     * ====================================
     * This used to be `setTimeout(shot.advance * 1000)` — sleep for four real
     * seconds and photograph whatever the machine happened to have reached.
     * Two consequences, both measured:
     *
     *   1. VFX age by `r.dt * 1000` per RENDERED FRAME (`vfx.system.ts`), so a
     *      fireball's age at the shutter is a function of frame rate. So do
     *      road decals, the fog reveal, camera shake decay, and the shared
     *      `uTime` that drives every radar sweep, bay door and selection pulse
     *      in `buildings.system.ts`.
     *   2. The sleep did not advance the SIMULATION at all. `?shot=` boots
     *      paused, so the accumulator never moved; the motion in the "in
     *      motion" fixtures comes entirely from `settleTicks` at scenario init.
     *      Four seconds of sleep bought nothing but four seconds of ageing.
     *
     * The result was not confined to the three shots with an `advance`. Two
     * captures of one build, on an idle machine, produced ZERO byte-identical
     * frames out of twelve, and the worst graded-metric drift was on
     * `10-selection` — a frozen fixture with no advance at all — where
     * `vividPixelFrac` moved 0.0146 because the selection pulse was
     * photographed at a different phase.
     *
     * TWO CHANGES FIXED IT, AND BOTH ARE IN THE GAME, NOT HERE:
     *
     *   - `GameLoop.captureClock` (on under `?shot=`) makes an organic rAF
     *     frame worth EXACTLY ZERO time. The unknown number of frames between
     *     boot and the shutter then cannot move anything.
     *   - `GameLoop.advanceTicks(n)` moves time in whole simulation steps, with
     *     one complete system frame per tick at exactly SIM_DT. Spawn and age
     *     are the same loop, so they cannot drift apart.
     *
     * Interleaving from THIS side was tried first and measured WORSE — pausing
     * and issuing one `step(1)` + one `__vmVfx.advance(SIM_DT)` per rAF took
     * `05-combat` p99 luminance from 0.0014 to 0.0870 between runs, because
     * which rendered frame consumed which advance still varied. A harness
     * cannot fix a lockstep problem it is not inside.
     *
     * `advance` STILL MEANS WHAT IT ALWAYS MEANT: presentation seconds, not
     * simulated ones. The sleep never advanced the sim, and neither does
     * `advanceFrames`, so the world in every fixture is the same world
     * `settleTicks` built — the same entities, in the same places, at the same
     * health. Only the clock the effects age on has changed.
     *
     * Advancing the SIMULATION here as well was tried, and rejected on the
     * image: `05-combat` with 120 live ticks on top of its 120 settle ticks is
     * an opaque white sheet of tread dust and cook-off smoke with the tanks
     * barely visible through it. Deterministic, and worthless as a measurement
     * of anything else in the frame. `__VM.advanceTicks(n)` exists for a
     * fixture authored around live motion; none of these twelve is.
     */
    {
      const seconds = shot.advance ?? SETTLE_SECONDS;
      const liveHz = await page.evaluate(() => window.__VM.hooks?.simHz?.() ?? null);
      if (liveHz !== SIM_HZ) {
        throw new Error(
          `this file advances at ${SIM_HZ} Hz but the game reports ${liveHz}. ` +
            'Re-derive SIM_HZ here from src/core/config.ts — every `advance` in the ' +
            'shot table is seconds and would otherwise be silently mis-converted.',
        );
      }
      const frames = Math.round(seconds * SIM_HZ);
      const advanced = await page.evaluate((n) => {
        if (typeof window.__VM.advanceFrames !== 'function') return false;
        window.__VM.advanceFrames(n);
        return true;
      }, frames);
      if (!advanced) {
        throw new Error(
          '__VM.advanceFrames is absent on this build. Refusing to fall back to a ' +
            'wall-clock sleep: that is the defect this fixture was moved off.',
        );
      }
    }
    // Settle frames. Under `?shot=` these are worth zero time by construction
    // (GameLoop.captureClock), so they can only let the driver, the compositor
    // and any pending texture upload catch up — never age the frame.
    await page.evaluate(() => window.__VM.waitFrames(10));

    // Belt and braces: a visible curtain here means the wait above was fooled,
    // and a curtain screenshot scored as a game frame is worse than no shot.
    const curtainUp = await page.evaluate(() => {
      const c = document.getElementById('loading');
      return c !== null && c.hidden !== true;
    });
    if (curtainUp) throw new Error('boot curtain still visible at shutter — refusing to photograph the loading screen');

    /*
     * THE POSE GUARD. Same standing as the curtain check above: a failure here
     * fails the shot and, through the exit code at the bottom, the run.
     *
     * Three separate things are asserted, because they fail three ways:
     *
     *   1. The page published `__VM.hooks.canonicalPose()`. Absent means the
     *      scenario system never posed the camera, so nothing pinned anything.
     *   2. That report says `enforced`. `?shot=` is what pins the pitch; if the
     *      flag did not reach the scenario system, a persisted or live player
     *      pitch is free to be in the frame.
     *   3. The rig REPORTS the pose this file asked for. Not "we called the
     *      setter" — read it back. A setter that silently did nothing is the
     *      failure mode an assumption cannot see.
     *
     * Plus a fourth: the product shell must not have booted. `?shot=` deliberately
     * never imports src/shell/**, which is the only thing in the game that reads
     * persisted settings out of localStorage. If `window.__vmSettings` exists on
     * this path, that isolation is gone and player state is reaching the capture.
     */
    const verdict = await page.evaluate((cam) => {
      const RA = window.__VM;
      const hook = RA.hooks?.canonicalPose;
      const canonical = typeof hook === 'function' ? hook() : null;
      const shellLoaded = window.__vmSettings !== undefined;
      /*
       * THE DRAWING BUFFER. `src/render/adaptive-res.system.ts` reclaims frame
       * time by rendering below the requested resolution and letting the
       * compositor scale the result up. It refuses to steer a fixed-size
       * render because "a fixed-size render is a screenshot" — but this
       * harness never asked for one, so it WAS steering during captures, and
       * how far it had got depended on how many frames the machine rendered.
       * Recorded and asserted rather than assumed: a 0.9-scale capture scored
       * as if it were 1:1 is a resample of the entire frame.
       */
      const buffer = {
        size: RA.stats().resolution,
        pixelRatio: RA.stats().pixelRatio,
        scale: RA.rendererHandle.resolutionScale,
        fixed: RA.rendererHandle.isFixedSize,
        // Recorded because it is NOT pinned. No `?tier=` is passed, so
        // `detectQualityTier()` picks one from the GPU, and the tier decides
        // the shadow map size and whether AO runs at half resolution. Two
        // machines therefore grade two different pipelines. Reproducible on one
        // machine, which is what a regression detector needs; not comparable
        // across machines, which is worth knowing before anyone quotes a score
        // from a different box.
        tier: RA.stats().quality,
        post: RA.stats().post,
      };
      /*
       * The two matrices that actually decide where every pixel lands, at full
       * precision. The `camera` block below records the POSE — five numbers
       * rounded for a human — and a pose can agree to four decimals while the
       * matrix it produces does not. When a capture moves and nobody can say
       * whether the camera was involved, this is the answer, and it is a
       * `diff` rather than an argument.
       */
      RA.camera.updateMatrixWorld(true);
      const matrices = {
        world: Array.from(RA.camera.matrixWorld.elements),
        projection: Array.from(RA.camera.projectionMatrix.elements),
      };
      if (canonical === null || canonical === undefined) {
        return { canonical: null, shellLoaded, buffer, matrices, check: null };
      }
      const check = RA.assertCameraPose(
        {
          yawDeg: canonical.expected.yawDeg,
          pitchDeg: cam.pitchDeg,
          distance: cam.distance,
        },
        cam.tolerance,
      );
      return { canonical, shellLoaded, buffer, matrices, check };
    }, { ...shot.camera, tolerance: POSE_TOLERANCE });

    const wantBuffer = `${VIEWPORT.width}x${VIEWPORT.height}`;
    if (verdict.buffer.size !== wantBuffer) {
      throw new Error(
        `the drawing buffer is ${verdict.buffer.size}, not ${wantBuffer} ` +
          `(resolutionScale ${verdict.buffer.scale}, pixelRatio ${verdict.buffer.pixelRatio}). ` +
          'Every pixel tolerance in docs/RA3_LOOK_BIBLE.md §13 is quoted at 1440p and an ' +
          'upscaled capture silently invalidates all of them.',
      );
    }

    if (verdict.shellLoaded) {
      throw new Error(
        'the product shell booted on a ?shot= page — persisted player settings can reach ' +
          'this capture. Refusing: the grade would not be comparable.',
      );
    }
    if (verdict.canonical === null) {
      throw new Error(
        '__VM.hooks.canonicalPose() is absent — the scenario system did not pose or verify ' +
          'the camera, so nothing guarantees this frame is the canonical one.',
      );
    }
    if (!verdict.canonical.enforced) {
      throw new Error(
        `scenario '${verdict.canonical.scenario}' did not pin its pitch (enforced=false). ` +
          'The ?shot= flag is what makes a boot a fixture; without it the camera carries ' +
          'whatever pitch the player last chose.',
      );
    }
    if (!verdict.canonical.ok) {
      throw new Error(`scenario pose rejected — ${verdict.canonical.summary}`);
    }
    if (!verdict.check.ok) {
      throw new Error(`camera is not at the canonical pose — ${verdict.check.summary}`);
    }

    await page.screenshot({ path: join(STAGE, `${shot.name}.png`), animations: 'disabled' });
    report.shots.push({
      name: shot.name,
      caption: shot.caption,
      flags: shot.flags,
      // The pose that was actually photographed, recorded so a later argument
      // about "did the camera move?" is answered from the report, not re-run.
      camera: {
        declared: shot.camera,
        measured: verdict.check.actual,
        scenarioYawDeg: verdict.canonical.expected.yawDeg,
      },
      buffer: verdict.buffer,
      matrices: verdict.matrices,
      ok: true,
      messages,
    });
    console.log(
      `ok  pitch ${verdict.check.actual.pitchDeg.toFixed(2)}deg` +
        `${messages.length ? ` (${messages.length} console msgs)` : ''}`,
    );
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

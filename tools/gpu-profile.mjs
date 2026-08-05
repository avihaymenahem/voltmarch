/**
 * VOLTMARCH — tools/gpu-profile.mjs
 * =============================================================================
 * FRAME ATTRIBUTION. Where does the millisecond go?
 *
 *   node tools/gpu-profile.mjs                 # attribution + ablation
 *   node tools/gpu-profile.mjs --scene battle  # a different fixture
 *   node tools/gpu-profile.mjs --match         # a live match, not a fixture
 *   node tools/gpu-profile.mjs --size 2560x1440
 *   node tools/gpu-profile.mjs --blocks 4 --frames 40 --warmup 25
 *   node tools/gpu-profile.mjs --no-build      # reuse dist/
 *   node tools/gpu-profile.mjs --json shots/_gpu.json
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS, AND THE FOUR CLOCKS IT REFUSES TO BELIEVE
 * ---------------------------------------------------------------------------
 * The performance work that preceded it was steered by numbers that were not
 * measurements: a "baseline" median of 16.6 ms (that is vsync, to four
 * significant figures) and ablations that came out SLOWER than the un-ablated
 * build (that is shader recompilation, not steady state).
 *
 * Both failures are structural, so both are structurally excluded. All four
 * candidate clocks were measured against this page, on the reporter's own GPU,
 * rendering the identical frame:
 *
 *      rAF interval, vsync disabled     3.2 ms   renderer process runs ahead
 *      gl.finish() loop                 4.2 ms   Chrome's command buffer
 *                                                returns before the GPU has
 *                                                retired any of the work
 *      gl.readPixels(1px) loop         85.6 ms   a real round trip
 *      fenceSync + clientWaitSync     108.8 ms   real, and pessimistic
 *      EXT_disjoint_timer_query        67.5 ms   pure GPU, authoritative
 *
 * Two of those five are off by more than 20x. `gl.finish()` in particular is
 * the obvious instrument and it is worse than useless — it reports 4 ms for a
 * frame that took 67. So:
 *
 *   * WALL TIME is bounded by a 1-pixel `readPixels` after every frame. That
 *     serialises CPU and GPU, so it slightly over-reports a pipelined frame; it
 *     is stable, and it is an upper bound, which is the honest direction.
 *   * GPU TIME comes from `EXT_disjoint_timer_query_webgl2` and is the headline
 *     number. Per-pass attribution wraps each composer pass's own `render()`.
 *     TIME_ELAPSED queries may not nest, so whole-frame, per-pass and
 *     shadow-map probes are three separate runs.
 *   * EVERY CONFIGURATION IS WARMED. After a pass toggle the chain is driven
 *     for `--warmup` frames that are thrown away, and only then sampled.
 *   * CONFIGURATIONS ARE VISITED `--blocks` TIMES in A/B/A/B order and the
 *     reported figure is the MIN OF THE PER-BLOCK MEDIANS. Other agents run
 *     builds on this machine; min-of-blocks is the estimator a competing
 *     process can only push upward.
 *   * THE GAME'S OWN rAF LOOP IS STOPPED for the duration. A background frame
 *     landing mid-measurement is GPU contention with the thing being measured.
 *   * THE SIZE IS PINNED WITH `__VM.setSize`, the renderer's fixed-size path:
 *     one drawing-buffer pixel per requested pixel, `resolutionScale` bypassed,
 *     and `AdaptiveResolution` inert (it refuses to steer while
 *     `handle.isFixedSize`). "Scale 1.0" here means 2560x1440 real pixels and
 *     nothing can quietly rescue it.
 * ---------------------------------------------------------------------------
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4339;
const BASE = `http://localhost:${PORT}/`;

/* -------------------------------------------------------------------------- */
/* args                                                                       */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);

const SCENE = flag('scene', 'allied-base');
const MATCH = has('match');
const SIZE = flag('size', '2560x1440');
const [SIZE_W, SIZE_H] = SIZE.split('x').map((n) => parseInt(n, 10));
const BLOCKS = parseInt(flag('blocks', '4'), 10);
const FRAMES = parseInt(flag('frames', '40'), 10);
const WARMUP = parseInt(flag('warmup', '25'), 10);
const HEADED = has('headed');
const NO_BUILD = has('no-build');
const ONLY_TOTAL = has('total-only');
const SWEEP = has('sweep');
const JSON_OUT = flag('json', null);

/**
 * Render scales visited by `--sweep`, as a fraction of the requested size.
 *
 * The frame is very nearly linear in pixel count on this class of GPU, so the
 * scale at which GPU time crosses 16.67 ms is the honest answer to "does it hit
 * 60 fps" — measured, rather than extrapolated from one point.
 */
const SWEEP_SCALES = [1.0, 0.9, 0.8, 0.7, 0.6, 0.55];

/**
 * Configurations visited in every block. `passes` is applied through
 * `__VM.setPass`, `shadows` through the renderer handle. Everything not named
 * is restored to the shipped arrangement first, so configs never compose.
 */
const ALL_CONFIGS = [
  { id: 'all-on', passes: {}, shadows: null },
  // The AO resolution is live-switchable, so the before/after for the single
  // largest change is an A/B inside ONE process, alternating, rather than two
  // runs of two builds on a machine other agents are also using.
  { id: 'ao-fullres', passes: {}, shadows: null, aoHalfRes: false },
  { id: 'ao-off', passes: { ao: false }, shadows: null },
  { id: 'bloom-off', passes: { bloom: false }, shadows: null },
  { id: 'smaa-off', passes: { smaa: false }, shadows: null },
  { id: 'grade-off', passes: { grade: false }, shadows: null },
  { id: 'post-off', passes: { ao: false, bloom: false, grade: false, smaa: false }, shadows: null },
  { id: 'shadows-off', passes: {}, shadows: false },
];
const CONFIGS = ONLY_TOTAL ? [ALL_CONFIGS[0]] : ALL_CONFIGS;

/* -------------------------------------------------------------------------- */
/* server                                                                     */
/* -------------------------------------------------------------------------- */

function run(cmd, args) {
  return spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
}

async function waitForServer(url, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* in-page instrument                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Runs inside the game page. Touches no game source — it wraps live objects and
 * restores them.
 */
const INSTRUMENT = () => {
  const vm = window.__VM;
  const gl = vm.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');

  /** Undo functions for whatever probe is currently installed. */
  let installed = null;
  /** 'frame' | 'pass' — TIME_ELAPSED queries cannot nest, so only one at once. */
  let mode = 'frame';
  /** name -> ms samples. */
  const buckets = new Map();
  let pending = [];
  let active = false;

  function beginQuery(name) {
    if (!ext || !active) return null;
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    return { name, q };
  }

  function endQuery(rec) {
    if (rec === null) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    pending.push(rec);
  }

  function drainQueries() {
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    const keep = [];
    for (const rec of pending) {
      if (!gl.getQueryParameter(rec.q, gl.QUERY_RESULT_AVAILABLE)) {
        keep.push(rec);
        continue;
      }
      // A disjoint means the GPU was preempted and every outstanding result is
      // garbage. Dropping them is correct; silently keeping them is how a
      // profile ends up recommending the wrong change.
      if (!disjoint) {
        const ns = gl.getQueryParameter(rec.q, gl.QUERY_RESULT);
        let arr = buckets.get(rec.name);
        if (arr === undefined) {
          arr = [];
          buckets.set(rec.name, arr);
        }
        arr.push(ns / 1e6);
      }
      gl.deleteQuery(rec.q);
    }
    pending = keep;
  }

  /* ---- probes ----------------------------------------------------------- */

  function removeProbes() {
    if (installed === null) return;
    for (const fn of installed) fn();
    installed = null;
    mode = 'frame';
  }

  /** Wrap every live composer pass. */
  function installPassProbes() {
    removeProbes();
    const composer = vm.post?.composer;
    if (!composer) return [];
    const undo = [];
    const names = [];
    const seen = new Map();
    for (const p of composer.passes) {
      const base = p.constructor.name.replace(/^_+/, '').replace(/Pass$/, '') || 'Pass';
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const name = n === 1 ? base : `${base}#${n}`;
      names.push(name);
      const orig = p.render;
      p.render = function profiled(...args) {
        const rec = beginQuery(name);
        try {
          return orig.apply(this, args);
        } finally {
          endQuery(rec);
        }
      };
      undo.push(() => {
        p.render = orig;
      });
    }
    installed = undo;
    mode = 'pass';
    return names;
  }

  /**
   * Shadow-map cost, on its own run.
   *
   * `WebGLShadowMap.render` is called from inside `renderer.render`, which is
   * inside the RenderPass — and TIME_ELAPSED queries may not nest. So this is a
   * separate mode and the shadow number is a SUBSET of the Render pass number,
   * not another row to add up.
   */
  function installShadowProbe() {
    removeProbes();
    const sm = vm.renderer.shadowMap;
    const orig = sm.render;
    sm.render = function profiled(...args) {
      const rec = beginQuery('ShadowMap');
      try {
        return orig.apply(this, args);
      } finally {
        endQuery(rec);
      }
    };
    installed = [() => { sm.render = orig; }];
    mode = 'pass';
  }

  /* ---- the loop --------------------------------------------------------- */

  const syncPixel = new Uint8Array(4);
  /** The only cheap primitive measured to actually block on this driver. */
  function syncGpu() {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel);
  }

  function warm(n) {
    for (let i = 0; i < n; i++) vm.hooks.renderFrame();
    syncGpu();
    drainQueries();
  }

  /**
   * Render `n` frames. Returns wall ms per frame; GPU ms lands in the 'Frame'
   * bucket when nothing else is holding the query.
   */
  function timeFrames(n) {
    const wall = new Array(n);
    syncGpu();
    for (let i = 0; i < n; i++) {
      const rec = mode === 'frame' ? beginQuery('Frame') : null;
      const t0 = performance.now();
      vm.hooks.renderFrame();
      if (rec !== null) endQuery(rec);
      syncGpu();
      wall[i] = performance.now() - t0;
    }
    drainQueries();
    return wall;
  }

  /* ---- background loop -------------------------------------------------- */

  /**
   * Starve the game's own rAF loop.
   *
   * `GameLoop.start` re-arms from inside its callback via the LIVE global, so
   * replacing `requestAnimationFrame` with a no-op stops it after the frame in
   * flight. A background frame landing mid-measurement is GPU contention with
   * the thing being measured, and it is worth several milliseconds here.
   *
   * The loop does not come back — `start()` early-returns while `running` — so
   * this is one-way for the session, which is exactly what a profiling page
   * wants. Do all `waitFrames`/`ready` work BEFORE calling it.
   */
  const realRaf = window.requestAnimationFrame.bind(window);
  function stopBackgroundLoop() {
    window.requestAnimationFrame = () => 0;
  }
  function restoreRaf() {
    window.requestAnimationFrame = realRaf;
  }

  window.__vmProf = {
    hasTimerQuery: !!ext,
    warm,
    timeFrames,
    installPassProbes,
    installShadowProbe,
    removeProbes,
    stopBackgroundLoop,
    restoreRaf,
    startQueries() {
      active = true;
      buckets.clear();
    },
    stopQueries() {
      active = false;
      syncGpu();
      drainQueries();
    },
    resetBuckets() {
      buckets.clear();
    },
    queryResults() {
      drainQueries();
      const out = {};
      for (const [k, v] of buckets) out[k] = v.slice();
      return out;
    },
    snapshot() {
      const s = vm.stats();
      const ao = vm.post?.passes?.ao;
      return {
        draws: s.drawCalls,
        tris: s.triangles,
        programs: s.programs,
        res: s.resolution,
        post: s.post,
        ao: ao ? `${ao.width}x${ao.height}` : 'none',
      };
    },
    setPass(id, on) { vm.setPass(id, on); },
    setShadows(on) { vm.rendererHandle.setShadowsEnabled(on); },
    /** Live-resize the AO chain. Goes through the same config path the game does. */
    setAoHalfRes(on) { vm.configure({ post: { ao: { halfRes: on } } }); },
    aoSize() {
      const ao = vm.post?.passes?.ao;
      return ao ? `${ao.width}x${ao.height}` : 'none';
    },
  };
  return { timerQuery: !!ext };
};

/* -------------------------------------------------------------------------- */
/* statistics                                                                 */
/* -------------------------------------------------------------------------- */

const median = (a) => {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) * 0.5;
};
const pct = (a, p) => {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/* -------------------------------------------------------------------------- */
/* driver                                                                     */
/* -------------------------------------------------------------------------- */

async function applyConfig(page, cfg) {
  await page.evaluate((c) => {
    const p = window.__vmProf;
    for (const id of ['ao', 'bloom', 'grade', 'smaa']) p.setPass(id, true);
    p.setShadows(true);
    p.setAoHalfRes(c.aoHalfRes === undefined ? true : c.aoHalfRes);
    for (const [id, on] of Object.entries(c.passes)) p.setPass(id, on);
    if (c.shadows !== null) p.setShadows(c.shadows);
  }, cfg);
}

async function measureConfig(page, cfg, frames, warmup) {
  await applyConfig(page, cfg);
  // The whole methodology in one line: a pass toggle calls `rebuild()`, which
  // recompiles programs and reallocates ping-pong targets. Timing the frames
  // right after that measures the shader compiler.
  await page.evaluate((n) => window.__vmProf.warm(n), warmup);
  await page.evaluate(() => window.__vmProf.resetBuckets());
  const wall = await page.evaluate((n) => window.__vmProf.timeFrames(n), frames);
  const gpu = await page.evaluate(() => window.__vmProf.queryResults());
  const snap = await page.evaluate(() => window.__vmProf.snapshot());
  return { wall, gpu: gpu.Frame ?? [], snap };
}

async function boot(browser, url) {
  const page = await browser.newPage({
    viewport: { width: SIZE_W, height: SIZE_H },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(240_000);
  page.setDefaultNavigationTimeout(240_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 180_000 });
  await page.evaluate(() => window.__VM.ready());
  await page.waitForFunction(
    () => {
      const curtain = document.getElementById('loading');
      if (curtain !== null && curtain.hidden !== true) return false;
      const s = window.__VM?.stats?.();
      return s !== undefined && s.drawCalls > 8;
    },
    null,
    { timeout: 300_000 },
  );
  return { page, errors };
}

/* -------------------------------------------------------------------------- */

let server = null;
if (!NO_BUILD) {
  console.log('> building...');
  await new Promise((resolve, reject) => {
    const b = run('npm', ['run', 'build']);
    b.on('close', (c) => (c === 0 ? resolve() : reject(new Error('build failed'))));
  });
}

if (!(await waitForServer(BASE, 1500))) {
  console.log('> serving...');
  server = run('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort']);
}
const cleanup = () => {
  try {
    server?.kill();
  } catch {
    /* already gone */
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});
if (!(await waitForServer(BASE))) {
  cleanup();
  throw new Error(`preview never came up on ${BASE}`);
}

const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    '--use-angle=default',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-device-scale-factor=1',
  ],
});

const url = MATCH ? `${BASE}?skipmenu=1&start=base&seed=7` : `${BASE}?shot=${SCENE}&seed=7`;

const report = {
  url,
  size: { width: SIZE_W, height: SIZE_H },
  blocks: BLOCKS,
  frames: FRAMES,
  warmup: WARMUP,
  gpu: null,
  timerQuery: false,
  base: null,
  configs: {},
  passes: {},
  shadow: null,
  sweep: null,
};

try {
  console.log(`> booting ${url} at ${SIZE_W}x${SIZE_H} ...`);
  const { page, errors } = await boot(browser, url);

  report.gpu = await page.evaluate(() => {
    const gl = window.__VM.renderer.getContext();
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'masked';
  });
  console.log(`  gpu: ${report.gpu}`);

  await page.evaluate(([w, h]) => window.__VM.setSize(w, h), [SIZE_W, SIZE_H]);
  await page.evaluate(() => window.__VM.setUiVisible(false));
  await page.evaluate(() => window.__VM.pause());
  await page.evaluate(() => window.__VM.waitFrames(6));

  const inst = await page.evaluate(INSTRUMENT);
  report.timerQuery = inst.timerQuery;
  console.log(`  EXT_disjoint_timer_query_webgl2: ${inst.timerQuery ? 'available' : 'NOT AVAILABLE'}`);

  // Everything that needs rAF is done. Starve the loop.
  await page.evaluate(() => window.__vmProf.stopBackgroundLoop());
  await page.evaluate(() => window.__vmProf.startQueries());

  const res = await page.evaluate(() => window.__vmProf.snapshot());
  report.base = res;
  console.log(`  drawing buffer ${res.res} · ${res.draws} draws · ${res.tris.toLocaleString()} tris · ${res.post}`);

  /* ---- 1. blocked ablation ---------------------------------------------- */
  for (const c of CONFIGS) report.configs[c.id] = { wallBlocks: [], gpuBlocks: [], p95: [], snap: null };

  for (let b = 0; b < BLOCKS; b++) {
    process.stdout.write(`> block ${b + 1}/${BLOCKS}  `);
    for (const c of CONFIGS) {
      const { wall, gpu, snap } = await measureConfig(page, c, FRAMES, WARMUP);
      const rec = report.configs[c.id];
      rec.wallBlocks.push(median(wall));
      rec.gpuBlocks.push(median(gpu));
      rec.p95.push(pct(wall, 95));
      rec.snap = snap;
      process.stdout.write(`${c.id}=${fmt(median(gpu), 1)} `);
    }
    process.stdout.write('\n');
  }

  /* ---- 1b. resolution sweep --------------------------------------------- */
  if (SWEEP) {
    report.sweep = [];
    await applyConfig(page, ALL_CONFIGS[0]);
    for (const s of SWEEP_SCALES) {
      const w = Math.round(SIZE_W * s);
      const h = Math.round(SIZE_H * s);
      await page.evaluate(([pw, ph]) => window.__VM.setSize(pw, ph), [w, h]);
      // A resize reallocates every target in the chain. Warm before sampling.
      await page.evaluate((n) => window.__vmProf.warm(n), WARMUP);
      const gpuBlocks = [];
      const wallBlocks = [];
      for (let b = 0; b < BLOCKS; b++) {
        await page.evaluate(() => window.__vmProf.resetBuckets());
        const wall = await page.evaluate((n) => window.__vmProf.timeFrames(n), FRAMES);
        const gpu = await page.evaluate(() => window.__vmProf.queryResults());
        gpuBlocks.push(median(gpu.Frame ?? []));
        wallBlocks.push(median(wall));
      }
      const gpuMs = Math.min(...gpuBlocks);
      report.sweep.push({ scale: s, width: w, height: h, gpuMs, wallMs: Math.min(...wallBlocks) });
      console.log(`  scale ${s.toFixed(2)}  ${w}x${h}  ${fmt(gpuMs)} ms  ${fmt(1000 / gpuMs, 1)} fps`);
    }
    await page.evaluate(([w, h]) => window.__VM.setSize(w, h), [SIZE_W, SIZE_H]);
    await page.evaluate((n) => window.__vmProf.warm(n), WARMUP);
  }

  /* ---- 2. per-pass GPU attribution -------------------------------------- */
  if (inst.timerQuery) {
    await applyConfig(page, ALL_CONFIGS[0]);
    await page.evaluate((n) => window.__vmProf.warm(n), WARMUP);
    await page.evaluate(() => window.__vmProf.installPassProbes());
    await page.evaluate((n) => window.__vmProf.warm(n), 12);
    await page.evaluate(() => window.__vmProf.resetBuckets());
    await page.evaluate((n) => window.__vmProf.timeFrames(n), FRAMES * 2);
    const raw = await page.evaluate(() => {
      const r = window.__vmProf.queryResults();
      window.__vmProf.removeProbes();
      return r;
    });
    for (const [k, v] of Object.entries(raw)) {
      report.passes[k] = { median: median(v), p95: pct(v, 95), n: v.length };
    }

    await page.evaluate(() => window.__vmProf.installShadowProbe());
    await page.evaluate((n) => window.__vmProf.warm(n), 12);
    await page.evaluate(() => window.__vmProf.resetBuckets());
    await page.evaluate((n) => window.__vmProf.timeFrames(n), FRAMES * 2);
    const shadowRaw = await page.evaluate(() => {
      const r = window.__vmProf.queryResults();
      window.__vmProf.removeProbes();
      return r;
    });
    const sm = shadowRaw.ShadowMap ?? [];
    report.shadow = sm.length ? { median: median(sm), p95: pct(sm, 95), n: sm.length } : null;
  }

  if (errors.length) console.log('  page errors:', errors.slice(0, 4));
  await page.close();
} finally {
  await browser.close();
  cleanup();
}

/* -------------------------------------------------------------------------- */
/* report                                                                     */
/* -------------------------------------------------------------------------- */

console.log('\n============================================================');
console.log(`FRAME ATTRIBUTION — ${report.gpu}`);
console.log(`${SIZE_W}x${SIZE_H} fixed drawing buffer · ${MATCH ? 'live match' : `?shot=${SCENE}`}`);
console.log(`${BLOCKS} blocks x ${FRAMES} frames · ${WARMUP} warm-up frames discarded per config`);
console.log('GPU ms = EXT_disjoint_timer_query. wall ms = readPixels-bounded.');
console.log('============================================================\n');

const gpuOf = (id) => Math.min(...report.configs[id].gpuBlocks);
const baseGpu = gpuOf('all-on');
const baseWall = Math.min(...report.configs['all-on'].wallBlocks);

console.log('ABLATION  (min of per-block medians — contention can only push these UP)');
console.log('  config          GPU ms   spread   wall ms      p95    saves    draws   AO size');
for (const c of CONFIGS) {
  const r = report.configs[c.id];
  const g = Math.min(...r.gpuBlocks);
  const spread = Math.max(...r.gpuBlocks) - g;
  const w = Math.min(...r.wallBlocks);
  console.log(
    `  ${c.id.padEnd(14)} ${fmt(g).padStart(7)} ${('±' + fmt(spread)).padStart(8)} ${fmt(w).padStart(9)} ` +
      `${fmt(Math.min(...r.p95)).padStart(8)} ${fmt(baseGpu - g).padStart(8)} ${String(r.snap?.draws ?? '—').padStart(8)}` +
      `   ${r.snap?.ao ?? '—'}`,
  );
}

if (Object.keys(report.passes).length) {
  console.log('\nPER-PASS GPU TIME  (composer passes, timer-query wrapped)');
  console.log('  pass                med ms      p95    share');
  const total = Object.values(report.passes).reduce((s, p) => s + p.median, 0);
  for (const [name, p] of Object.entries(report.passes).sort((a, b) => b[1].median - a[1].median)) {
    console.log(
      `  ${name.padEnd(18)} ${fmt(p.median).padStart(7)} ${fmt(p.p95).padStart(8)} ` +
        `${fmt((p.median / total) * 100, 1).padStart(7)}%`,
    );
  }
  console.log(`  ${'TOTAL'.padEnd(18)} ${fmt(total).padStart(7)}`);
  if (report.shadow) {
    console.log(`\n  shadow map (a SUBSET of Render): ${fmt(report.shadow.median)} ms med, ${fmt(report.shadow.p95)} p95`);
  }
}

if (report.sweep) {
  console.log('\nRESOLUTION SWEEP  (the honest answer to "does it hit 60")');
  console.log('  scale   pixels        GPU ms      fps');
  for (const r of report.sweep) {
    console.log(
      `  ${r.scale.toFixed(2)}   ${`${r.width}x${r.height}`.padEnd(12)} ${fmt(r.gpuMs).padStart(7)} ${fmt(1000 / r.gpuMs, 1).padStart(8)}`,
    );
  }
  // Linear interpolation in PIXEL COUNT, which is what the frame scales with.
  const pts = report.sweep.map((r) => ({ px: r.scale * r.scale, ms: r.gpuMs }));
  let crossing = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if ((a.ms - 16.67) * (b.ms - 16.67) <= 0) {
      const t = (16.67 - a.ms) / (b.ms - a.ms);
      crossing = Math.sqrt(a.px + t * (b.px - a.px));
      break;
    }
  }
  console.log(
    crossing === null
      ? '  60 fps is NOT reached anywhere in the swept range.'
      : `  60 fps at render scale ${crossing.toFixed(3)} (${Math.round(SIZE_W * crossing)}x${Math.round(SIZE_H * crossing)}).`,
  );
}

console.log(`\nGPU ${fmt(baseGpu)} ms = ${fmt(baseGpu / 16.67, 2)}x the 60 fps budget → ${fmt(1000 / baseGpu, 1)} fps`);
console.log(`wall ${fmt(baseWall)} ms (readPixels-serialised upper bound) → ${fmt(1000 / baseWall, 1)} fps`);

if (JSON_OUT) {
  mkdirSync(dirname(join(ROOT, JSON_OUT)), { recursive: true });
  writeFileSync(join(ROOT, JSON_OUT), JSON.stringify(report, null, 2));
  console.log(`\nwrote ${JSON_OUT}`);
}

process.exit(0);

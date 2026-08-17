/**
 * VOLTMARCH — tools/gpu-profile.mjs
 * =============================================================================
 * FRAME ATTRIBUTION. Where does the millisecond go?
 *
 *   node tools/gpu-profile.mjs                 # attribution + ablation
 *   node tools/gpu-profile.mjs --scene battle  # a different fixture
 *   node tools/gpu-profile.mjs --match         # a live match, not a fixture
 *   node tools/gpu-profile.mjs --match --armies 4 --map industrial-grid --sim 600
 *   node tools/gpu-profile.mjs --size 2560x1440
 *   node tools/gpu-profile.mjs --blocks 4 --frames 40 --warmup 25
 *   node tools/gpu-profile.mjs --sweep         # the fill-rate slope
 *   node tools/gpu-profile.mjs --no-build      # reuse dist/
 *   node tools/gpu-profile.mjs --json shots/_gpu.json
 *
 * ---------------------------------------------------------------------------
 * THREE CLOCKS, BECAUSE "IS THIS CPU-BOUND" NEEDS ALL THREE
 * ---------------------------------------------------------------------------
 * `docs/WEBGPU_MIGRATION_PLAN.md` §1 turns on one comparison: WebGPU's headline
 * win is cheaper draw SUBMISSION, which is CPU work, so it can only help a frame
 * whose CPU side is the long pole. Answering that needs three numbers that this
 * tool used to report one and a half of:
 *
 *   frameMs   wall clock between rAF callbacks, sim running, nothing starved.
 *             What the player experiences. Pinned to the display cadence
 *             whenever there is headroom, which is why it cannot be read alone —
 *             see the header of `src/ui/PerfHud.ts`.
 *   cpuMs     JavaScript time inside one complete frame: every frame system plus
 *             the draw submission, and NOTHING waiting on the GPU. Identical in
 *             definition to `src/render/debug.ts`'s `cpuMs`, and cross-checked
 *             against it (`stats().cpuMs`) on every run.
 *   gpuMs     EXT_disjoint_timer_query_webgl2. Pure GPU execution.
 *
 * `cpuMs` and `gpuMs` OVERLAP — a pipelined frame runs both at once — so they do
 * not sum to `frameMs` and are not presented as if they did. The decision is
 * which of the two is larger, and by how much.
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
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS THIS TOOL GOT WRONG UNTIL 2026-08-17, ALL SILENT
 * ---------------------------------------------------------------------------
 * Every one of them printed a confident number. None of them threw.
 *
 * 1. THE PER-PASS TABLE WAS UNREADABLE IN A PRODUCTION BUILD. Pass names came
 *    from `p.constructor.name`, and `vite build` minifies class names, so the
 *    breakdown read `uae 69.5% · cl 11.7% · Og 8.3% · zV 3.5% · fae 7.0%` — five
 *    rows nobody can map to a pass, in the ONE build configuration this tool
 *    ever runs against. Passes are identified by IDENTITY against
 *    `__VM.post.passes` now, which is a `Record<PassId, Pass>` and cannot be
 *    minified away; the constructor name is kept only as a fallback label for a
 *    composer entry that is not one of the five.
 *
 * 2. THE SHADOW NUMBER WAS STRUCTURALLY ZERO. `WebGLShadowMap.render` is entered
 *    **22 times per frame**, not once: every `FullScreenQuad` in every composer
 *    pass calls `WebGLRenderer.render`, and that calls `shadowMap.render` with
 *    an empty `shadowsArray`, which early-outs on its `lights.length === 0`
 *    guard. So 21 of 22 samples bracketed no GPU work at all, and both the
 *    median AND the p95 of that population are 0.00 — which is exactly what it
 *    reported, next to an ablation showing shadows costing real time and 52 real
 *    draw calls. Measured on `?shot=allied-base`: 22 invocations, 1 with lights,
 *    52 draws inside that one. The probe now opens a query on the invocation
 *    that has lights and on no other.
 *
 * 3. THE READINESS GATE PASSED ON AN EMPTY WORLD. `boot()` waited for
 *    `stats().drawCalls > 8`. A `?shot=` page whose scenario has not run yet
 *    draws **23** — two colour draws and twenty-one post quads — so the gate was
 *    satisfied by a world containing no base, no units and nothing casting a
 *    shadow, and the profile would have been of the post chain over an empty
 *    field. Reproduced: pausing right after `ready()` gives
 *    `{shadow: 0, colour: 2, ao: 0, post: 21}`; waiting properly gives
 *    `{shadow: 52, colour: 74, ao: 0, post: 21}`. The gate is on
 *    `drawCallsByPass.colour` now, which is the only one of the five numbers
 *    that is about the CONTENT.
 * ---------------------------------------------------------------------------
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { build, serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** A hint. The origin actually used is read off our own child — see the block
 *  above the spawn in `tools/lib/serve.mjs`. */
const PORT_HINT = 4339;

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

/* -- live-match shape (`--match` only) ------------------------------------- */

/**
 * Armies seated, human included. The heaviest content this game has is not a
 * fixture: the biggest `?shot=` scene is `blob` at 66 units, and CLAUDE.md's
 * performance rule is written about **200+**. Only a real match gets there, and
 * only a four-army one gets there quickly.
 */
const ARMIES = Math.max(2, Math.min(4, parseInt(flag('armies', '4'), 10)));
/** A `MAPS[].id` from `src/shell/settings-store.ts`. Must offer `ARMIES` seats. */
const MAP_ID = flag('map', 'industrial-grid');
/** Index into `DIFFICULTIES`: 0 Easy, 1 Normal, 2 Hard, 3 Brutal. */
const DIFFICULTY = parseInt(flag('ai', '3'), 10);
/**
 * Index into `PERSONALITIES`: 0 Turtle, 1 Rusher, 2 Boomer. -1 lets the brain
 * pick. Boomer is the one that MASSES, and massing is the whole point of a
 * load measurement — see the note above the peak print.
 */
const PERSONALITY = parseInt(flag('aip', '-1'), 10);
/** Starting bank. One of `CREDIT_OPTIONS`; 50000 is the roster's ceiling. */
const CREDITS = parseInt(flag('credits', '20000'), 10);
/** Seconds of SIMULATED time to run before profiling. 30 Hz, stepped headless. */
const SIM_SECONDS = parseInt(flag('sim', '600'), 10);
/**
 * Stop stepping early once this many units are on the field. 0 disables, and
 * `--sim` is then the only bound. Reported either way — a target that was not
 * reached must not be quoted as though it were.
 */
const UNIT_TARGET = parseInt(flag('units', '200'), 10);
/** Milliseconds of FREE-RUNNING rAF sampled for the wall-clock `frameMs`. */
const LIVE_MS = parseInt(flag('live', '4000'), 10);

const FACTION_KEYS = ['allies', 'soviets', 'meridian', 'reclaim'];

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

/*
 * NO ADOPTION. This block was
 *
 *     if (!(await waitForServer(BASE, 1500))) server = run("npx", [...]);
 *
 * which reads "reuse whatever is already there, it saves a boot" and means
 * "profile whatever is already there". Two ways it went wrong, and neither
 * leaves a mark in the report: on a busy machine the 1500 ms probe times out
 * against a LIVE neighbour, so the tool starts its own vite, that vite dies on
 * --strictPort with nobody reading the exit code, and the GPU timings below are
 * then taken off the neighbour; and when the probe works as intended it adopts
 * the neighbour deliberately. A GPU profile is a number per frame with no
 * provenance in it, so a run against another worktree's bundle is a plausible
 * table of milliseconds for a build nobody chose.
 */

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

    /*
     * NAME BY IDENTITY, NOT BY `constructor.name`.
     *
     * This tool only ever runs against `vite build` output, and esbuild renames
     * classes, so the constructor route produced `uae`, `cl`, `Og`, `zV`, `fae`
     * — a per-pass GPU table in which no row can be attributed to a pass. The
     * `PassId` keys of `__VM.post.passes` are string literals in the source and
     * survive minification untouched, so the pass OBJECT is looked up in that
     * record and the key it is filed under is its name.
     */
    const idOf = new Map();
    const registry = vm.post?.passes;
    if (registry) for (const id of Object.keys(registry)) idOf.set(registry[id], id);

    for (const p of composer.passes) {
      // The fallback still carries the minified name rather than 'Pass', so an
      // unregistered composer entry is at least distinguishable from its
      // neighbours and obviously not one of the five.
      const base = idOf.get(p)
        ?? `unregistered(${p.constructor.name.replace(/^_+/, '').replace(/Pass$/, '') || '?'})`;
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
   *
   * `lights.length > 0` IS THE WHOLE PROBE, and without it this reported 0.00.
   * Every `FullScreenQuad` in every composer pass goes through
   * `WebGLRenderer.render`, which calls `shadowMap.render` unconditionally — 22
   * invocations per frame on the shipped chain, of which ONE carries the
   * directional light and draws the 52 casters, and 21 return at three's own
   * `if ( lights.length === 0 ) return;`. Opening a query around all 22 makes
   * 95% of the samples an empty bracket, and the median and p95 of that
   * population are both exactly zero. See defect 2 in this file's header.
   *
   * `shadowInvocations` / `shadowWorking` are carried out so the caller can
   * assert the ratio rather than trust this comment.
   */
  let shadowInvocations = 0;
  let shadowWorking = 0;

  function installShadowProbe() {
    removeProbes();
    shadowInvocations = 0;
    shadowWorking = 0;
    const sm = vm.renderer.shadowMap;
    const orig = sm.render;
    sm.render = function profiled(lights, scene, camera) {
      shadowInvocations++;
      if (lights.length === 0) return orig.call(this, lights, scene, camera);
      shadowWorking++;
      const rec = beginQuery('ShadowMap');
      try {
        return orig.call(this, lights, scene, camera);
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
   * Render `n` frames. Returns per-frame wall ms AND cpu ms; GPU ms lands in
   * the 'Frame' bucket when nothing else is holding the query.
   *
   * THE TWO STOPWATCHES BRACKET DIFFERENT THINGS, and the gap between them is
   * the answer to the question this tool exists for:
   *
   *   cpu   t0 -> right after `renderFrame` returns. Every frame system and
   *         every draw SUBMISSION, with nothing waiting on the GPU. This is
   *         `src/render/debug.ts`'s `cpuMs` measured from outside, and
   *         `statsCpuMs()` below reads the engine's own copy as a cross-check.
   *   wall  t0 -> after `syncGpu()`, i.e. with the CPU parked until the GPU has
   *         retired the frame. Serialised, so it over-reports a pipelined frame;
   *         that is the honest direction for an upper bound.
   *
   * `endQuery` is issued before the CPU mark because it is one GL call and must
   * bracket the frame's commands and nothing else; the microsecond it costs
   * lands in `cpu`, where it is invisible against a millisecond-scale number.
   */
  function timeFrames(n) {
    const wall = new Array(n);
    const cpu = new Array(n);
    const engineCpu = new Array(n);
    syncGpu();
    for (let i = 0; i < n; i++) {
      const rec = mode === 'frame' ? beginQuery('Frame') : null;
      const t0 = performance.now();
      vm.hooks.renderFrame();
      if (rec !== null) endQuery(rec);
      const t1 = performance.now();
      syncGpu();
      wall[i] = performance.now() - t0;
      cpu[i] = t1 - t0;
      // PAIRED, and read outside the window above so it cannot pollute it. The
      // engine's own figure for the frame just drawn; the gap between the two
      // is `GameLoop.renderPass`'s `registry.runFrame` — see `engineCpu` in the
      // report, and the block about it in this file's header.
      engineCpu[i] = vm.stats().cpuMs;
    }
    drainQueries();
    return { wall, cpu, engineCpu };
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

  /* ---- the free-running clock ------------------------------------------- */

  /**
   * Watch the game run itself for `ms` and report what a PLAYER would be
   * getting: rAF-to-rAF `frameMs`, the engine's own `cpuMs`, one sim tick's
   * `simMs`, and the load the frame was carrying.
   *
   * MUST RUN BEFORE `stopBackgroundLoop`, and it is the only measurement here
   * that does. Everything else in this file deliberately starves the loop and
   * drives `renderFrame` by hand, which is what makes those numbers stable and
   * also what makes them incapable of answering "what frame rate is this". A
   * hand-driven frame has no vsync, no sim, and no competition.
   *
   * Pre-allocated rings, because the sampler runs inside the frame loop it is
   * measuring and an allocating observer shows up in its own reading.
   * `stats()` itself allocates (it copies the counters), so its cost lands in
   * `frameMs` — but NOT in `cpuMs`, which `debug.endFrame()` closes before this
   * callback is reached.
   */
  function sampleLive(ms, cap) {
    return new Promise((resolve) => {
      const n = Math.max(1, cap | 0);
      const frameMs = new Float64Array(n);
      const cpuMs = new Float64Array(n);
      const simMs = new Float64Array(n);
      const drawCalls = new Float64Array(n);
      const units = new Float64Array(n);
      const entities = new Float64Array(n);
      let i = 0;
      const t0 = performance.now();
      const tick = () => {
        const s = vm.stats();
        if (i < n) {
          frameMs[i] = s.frameMs;
          cpuMs[i] = s.cpuMs;
          simMs[i] = s.counters.simMs;
          drawCalls[i] = s.drawCalls;
          units[i] = s.counters.units;
          entities[i] = s.counters.entities;
          i++;
        }
        if (performance.now() - t0 < ms && i < n) realRaf(tick);
        else {
          resolve({
            frameMs: Array.from(frameMs.subarray(0, i)),
            cpuMs: Array.from(cpuMs.subarray(0, i)),
            simMs: Array.from(simMs.subarray(0, i)),
            drawCalls: Array.from(drawCalls.subarray(0, i)),
            units: Array.from(units.subarray(0, i)),
            entities: Array.from(entities.subarray(0, i)),
          });
        }
      };
      realRaf(tick);
    });
  }

  window.__vmProf = {
    hasTimerQuery: !!ext,
    warm,
    timeFrames,
    sampleLive,
    installPassProbes,
    installShadowProbe,
    removeProbes,
    stopBackgroundLoop,
    restoreRaf,
    /** How many of the shadow probe's invocations actually carried a light. */
    shadowProbeRatio() {
      return { invocations: shadowInvocations, working: shadowWorking };
    },
    /** The engine's own CPU figure, for cross-checking this file's stopwatch. */
    statsCpuMs() {
      return vm.stats().cpuMs;
    },
    /** What the frame is carrying. `units` is DRAWN units, not world population. */
    load() {
      const s = vm.stats();
      return {
        entities: s.counters.entities,
        units: s.counters.units,
        buildings: s.counters.buildings,
        particles: s.counters.particles,
        draws: s.drawCalls,
        byPass: s.drawCallsByPass,
        tris: s.triangles,
      };
    },
    /**
     * Run the SIM forward without drawing, in chunks, stopping early once
     * `target` units are drawn. `__VM.step` is `GameLoop.runHeadless` — the same
     * fixed 30 Hz step the real loop takes, with no renderer in the way — so ten
     * simulated minutes cost seconds and stay bit-identical to a match played
     * out in real time. One frame is rendered per chunk because `counters.units`
     * is written by the RENDER bridge and is stale until something draws.
     */
    rampUnits(totalTicks, chunkTicks, target) {
      let done = 0;
      let peak = 0;
      let peakTick = 0;
      const trace = [];
      while (done < totalTicks) {
        const n = Math.min(chunkTicks, totalTicks - done);
        vm.step(n);
        done += n;
        vm.hooks.renderFrame();
        const u = vm.stats().counters.units;
        trace.push([done, u]);
        if (u > peak) { peak = u; peakTick = done; }
        if (target > 0 && u >= target) break;
      }
      return { ticks: done, peak, peakTick, trace, load: window.__vmProf.load() };
    },
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
  const timed = await page.evaluate((n) => window.__vmProf.timeFrames(n), frames);
  const gpu = await page.evaluate(() => window.__vmProf.queryResults());
  const snap = await page.evaluate(() => window.__vmProf.snapshot());
  return {
    wall: timed.wall, cpu: timed.cpu, engineCpu: timed.engineCpu, gpu: gpu.Frame ?? [], snap,
  };
}

/**
 * Seat the match the profile wants, by writing the lobby's own storage keys
 * before the shell ever reads them.
 *
 * There is no `?armies=` boot flag and there should not be one: `?skipmenu=1`
 * launches `this.setup`, which the lobby persists, so the supported way to
 * choose a four-army game from outside the product is to write what the lobby
 * would have written. Same route `tools/playtest.mjs` takes.
 *
 * THE SEEDING LOAD IS A `?shot=` PAGE, deliberately. `main.ts` routes that to
 * `bootstrap()` and never imports the shell, so nothing on it can write
 * `voltmarch.setup.v1` back over what we just put there between the two
 * navigations. A product-path page could.
 */
async function seedLiveSetup(page, base) {
  await page.goto(`${base}?shot=allied-base`, { waitUntil: 'commit' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('voltmarch.setup.v1', JSON.stringify({
      playerFaction: s.keys[0],
      aiFaction: s.keys[1],
      map: s.map,
      difficulty: s.difficulty,
      personality: s.personality,
      startingCredits: s.credits,
      speed: 1,
      seed: 7,
      opponents: s.keys.slice(1, s.armies).map((k) => ({
        faction: k, difficulty: s.difficulty, personality: s.personality,
      })),
    }));
    localStorage.setItem('voltmarch.setup.start.v1', JSON.stringify('base'));
  }, {
    keys: FACTION_KEYS,
    map: MAP_ID,
    difficulty: DIFFICULTY,
    armies: ARMIES,
    personality: PERSONALITY,
    credits: CREDITS,
  });
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

  if (MATCH) await seedLiveSetup(page, BASE);

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 180_000 });
  await page.evaluate(() => window.__VM.ready());
  /*
   * A CONTENT GATE, NOT A LIVENESS GATE. This was `drawCalls > 8`, which an
   * EMPTY WORLD passes: a `?shot=` page whose scenario has not run yet draws 23
   * — two colour and twenty-one post quads — so the tool would have profiled the
   * post chain over a bare field and said nothing. `drawCallsByPass.colour` is
   * the only one of the five that counts CONTENT, and 30 is comfortably above
   * the 2 an empty world produces and comfortably below the 54-77 every real
   * scene reports. See defect 3 in this file's header.
   */
  await page.waitForFunction(
    () => {
      const curtain = document.getElementById('loading');
      if (curtain !== null && curtain.hidden !== true) return false;
      const s = window.__VM?.stats?.();
      return s !== undefined && s.drawCallsByPass.colour > 30;
    },
    null,
    { timeout: 300_000 },
  );
  return { page, errors };
}

/* -------------------------------------------------------------------------- */

if (!NO_BUILD) {
  await build(ROOT, { log: console.log });
}

console.log('> serving...');
const server = await serve({
  root: ROOT, mode: 'preview', portHint: PORT_HINT, log: console.log,
});
const BASE = server.origin;
const cleanup = () => server.stop();

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

/*
 * `?fog=off` ON THE LIVE MATCH, and it is a load decision rather than a
 * convenience. `counters.units` is DRAWN units — `RenderBridge.visibleUnits` —
 * and in a fogged four-army game the local human sees their own army and
 * whatever they have scouted, which is a fraction of what is on the field. The
 * question here is what the renderer costs at 200+ units, so every unit has to
 * reach a drawable slot. `src/sim/vision.system.ts` documents this flag as
 * exactly that escape hatch.
 */
const url = MATCH
  ? `${BASE}?skipmenu=1&start=base&seed=7&fog=off`
  : `${BASE}?shot=${SCENE}&seed=7`;

const report = {
  url,
  size: { width: SIZE_W, height: SIZE_H },
  blocks: BLOCKS,
  frames: FRAMES,
  warmup: WARMUP,
  match: MATCH
    ? {
      armies: ARMIES, map: MAP_ID, difficulty: DIFFICULTY, personality: PERSONALITY,
      credits: CREDITS, simSeconds: SIM_SECONDS, unitTarget: UNIT_TARGET,
    }
    : null,
  gpu: null,
  timerQuery: false,
  base: null,
  load: null,
  live: null,
  configs: {},
  passes: {},
  shadow: null,
  shadowProbe: null,
  sweep: null,
};

try {
  console.log(`> booting ${url} at ${SIZE_W}x${SIZE_H} ...`);
  server.assertAlive('the profile');
  const { page, errors } = await boot(browser, url);

  report.gpu = await page.evaluate(() => {
    const gl = window.__VM.renderer.getContext();
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'masked';
  });
  console.log(`  gpu: ${report.gpu}`);

  await page.evaluate(([w, h]) => window.__VM.setSize(w, h), [SIZE_W, SIZE_H]);
  await page.evaluate(() => window.__VM.setUiVisible(false));

  /*
   * REFUSE TO PROFILE A BUFFER THAT IS NOT THE SIZE WE ASKED FOR.
   *
   * `AdaptiveResolution` is inert while `handle.isFixedSize`
   * (`adaptive-res.system.ts` returns on that flag before it samples anything),
   * which is the whole reason `__VM.setSize` is the pinning route. But that is a
   * property of another module, asserted here rather than assumed: a controller
   * quietly shrinking the drawing buffer mid-run would leave every millisecond
   * in this report describing a resolution nobody chose, and `ms/Mpx` would look
   * fine while the Mpx moved. Cheap, and it converts a silent corruption into a
   * loud stop.
   */
  const pinned = await page.evaluate(() => ({
    fixed: window.__VM.rendererHandle.isFixedSize,
    res: window.__VM.stats().resolution,
    scale: window.__VM.rendererHandle.resolutionScale,
  }));
  if (!pinned.fixed || pinned.res !== `${SIZE_W}x${SIZE_H}`) {
    throw new Error(
      `refusing to profile: asked for ${SIZE_W}x${SIZE_H}, renderer reports ${pinned.res} `
      + `(isFixedSize ${pinned.fixed}, resolutionScale ${pinned.scale}). `
      + 'An adaptive-resolution controller steering during a profile makes every '
      + 'millisecond below a statement about an unknown pixel count.',
    );
  }
  console.log(`  size pinned: ${pinned.res}, isFixedSize ${pinned.fixed}`);

  const inst = await page.evaluate(INSTRUMENT);
  report.timerQuery = inst.timerQuery;
  console.log(`  EXT_disjoint_timer_query_webgl2: ${inst.timerQuery ? 'available' : 'NOT AVAILABLE'}`);

  /* ---- 0a. build the load ------------------------------------------------ */
  /*
   * ORDER MATTERS HERE AND IT COST A RUN TO GET RIGHT. `__VM.pause()` freezes
   * the SIM, and on a `?shot=` page the scenario is built by a system that runs
   * on the first sim tick — so pausing too early leaves a world with nothing in
   * it. `boot()`'s colour-draw gate is what proves the world exists before we
   * touch the clock; the pause below happens after both that gate and the
   * unit ramp.
   */
  if (MATCH) {
    await page.evaluate(() => window.__VM.pause());
    const ramp = await page.evaluate(
      ([ticks, chunk, target]) => window.__vmProf.rampUnits(ticks, chunk, target),
      [SIM_SECONDS * 30, 300, UNIT_TARGET],
    );
    report.ramp = {
      ticks: ramp.ticks,
      simSeconds: ramp.ticks / 30,
      peakUnits: ramp.peak,
      peakSimMinutes: ramp.peakTick / 30 / 60,
      trace: ramp.trace,
      ...ramp.load,
    };
    console.log(
      `  ramped ${(ramp.ticks / 30 / 60).toFixed(1)} sim-minutes -> `
      + `${ramp.load.units} drawn units, ${ramp.load.entities} entities, ${ramp.load.draws} draws`,
    );
    /*
     * THE PEAK, ALWAYS PRINTED, AND IT IS NOT A CURIOSITY.
     *
     * Four Brutal armies do not accumulate — they annihilate. A 25-minute run on
     * `glacier-shelf` peaked at 114 drawn units around minute five and was down
     * to 70 by the end, so a profile taken at the tick the ramp happened to stop
     * on can be quoted as "at N units" while N is a third of what the match ever
     * held. Print both and let the reader see the difference.
     */
    console.log(`  peak was ${ramp.peak} drawn units at ${(ramp.peakTick / 30 / 60).toFixed(1)} sim-minutes`);
    if (UNIT_TARGET > 0 && ramp.load.units < UNIT_TARGET) {
      console.log(
        `  NOTE: unit target ${UNIT_TARGET} NOT reached — every number below is at `
        + `${ramp.load.units} units, and must be quoted that way.`,
      );
    }
    await page.evaluate(() => window.__VM.resume());
  }

  /* ---- 0b. the free-running clock, before anything is starved ------------- */
  /*
   * This is the only measurement taken with the game running itself, and it is
   * the only one that can answer "what frame rate is this". Everything after it
   * stops the rAF loop on purpose.
   */
  const live = await page.evaluate(
    ([ms, cap]) => window.__vmProf.sampleLive(ms, cap),
    [LIVE_MS, 2000],
  );
  report.live = {
    n: live.frameMs.length,
    frameMs: { median: median(live.frameMs), p95: pct(live.frameMs, 95) },
    cpuMs: { median: median(live.cpuMs), p95: pct(live.cpuMs, 95) },
    simMs: { median: median(live.simMs), p95: pct(live.simMs, 95) },
    drawCalls: median(live.drawCalls),
    units: median(live.units),
    entities: median(live.entities),
  };

  await page.evaluate(() => window.__VM.pause());
  await page.evaluate(() => window.__VM.waitFrames(6));

  // Everything that needs rAF is done. Starve the loop.
  await page.evaluate(() => window.__vmProf.stopBackgroundLoop());
  await page.evaluate(() => window.__vmProf.startQueries());

  const res = await page.evaluate(() => window.__vmProf.snapshot());
  report.base = res;
  report.load = await page.evaluate(() => window.__vmProf.load());
  console.log(`  drawing buffer ${res.res} · ${res.draws} draws · ${res.tris.toLocaleString()} tris · ${res.post}`);

  /* ---- 1. blocked ablation ---------------------------------------------- */
  for (const c of CONFIGS) {
    report.configs[c.id] = {
      wallBlocks: [], cpuBlocks: [], engineCpuBlocks: [], gpuBlocks: [], p95: [], snap: null,
    };
  }

  for (let b = 0; b < BLOCKS; b++) {
    process.stdout.write(`> block ${b + 1}/${BLOCKS}  `);
    for (const c of CONFIGS) {
      const { wall, cpu, engineCpu, gpu, snap } = await measureConfig(page, c, FRAMES, WARMUP);
      const rec = report.configs[c.id];
      rec.wallBlocks.push(median(wall));
      rec.cpuBlocks.push(median(cpu));
      rec.engineCpuBlocks.push(median(engineCpu));
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
      const cpuBlocks = [];
      for (let b = 0; b < BLOCKS; b++) {
        await page.evaluate(() => window.__vmProf.resetBuckets());
        const timed = await page.evaluate((n) => window.__vmProf.timeFrames(n), FRAMES);
        const gpu = await page.evaluate(() => window.__vmProf.queryResults());
        gpuBlocks.push(median(gpu.Frame ?? []));
        wallBlocks.push(median(timed.wall));
        cpuBlocks.push(median(timed.cpu));
      }
      const gpuMs = Math.min(...gpuBlocks);
      const cpuMs = Math.min(...cpuBlocks);
      report.sweep.push({
        scale: s, width: w, height: h, gpuMs, cpuMs, wallMs: Math.min(...wallBlocks),
      });
      console.log(
        `  scale ${s.toFixed(2)}  ${w}x${h}  gpu ${fmt(gpuMs)} ms  cpu ${fmt(cpuMs)} ms  ${fmt(1000 / gpuMs, 1)} fps`,
      );
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
    /*
     * THE PROBE'S OWN RATIO, REPORTED. `working` should be exactly one per
     * frame and `invocations` about twenty-two; if `working` ever equals
     * `invocations` the empty-bracket filter has stopped doing anything and the
     * shadow median is back to being a statement about full-screen quads.
     */
    report.shadowProbe = await page.evaluate(() => window.__vmProf.shadowProbeRatio());
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
const baseCpu = Math.min(...report.configs['all-on'].cpuBlocks);

if (report.load) {
  const l = report.load;
  console.log('WHAT THE FRAME IS CARRYING');
  console.log(
    `  ${l.units} drawn units · ${l.buildings} buildings · ${l.entities} entities · `
    + `${l.particles} particles`,
  );
  console.log(
    `  draws ${l.draws} = ${l.byPass.colour} colour + ${l.byPass.shadow} shadow + `
    + `${l.byPass.ao} ao + ${l.byPass.post} post · ${l.tris.toLocaleString()} tris`,
  );
  if (report.ramp) {
    console.log(`  reached after ${(report.ramp.simSeconds / 60).toFixed(1)} simulated minutes`);
  }
  console.log('');
}

/* ---- the three clocks, which is the whole point ---------------------------
 * `cpuMs` and `gpuMs` OVERLAP in a pipelined frame, so they are not summed and
 * the table does not imply they can be. What decides the WebGPU question is
 * which is larger: WebGPU buys cheaper draw submission, which is the `cpuMs`
 * column and nothing else on this page. */
console.log('THREE CLOCKS');
if (report.live) {
  const v = report.live;
  console.log(`  frameMs   ${fmt(v.frameMs.median).padStart(7)} med  ${fmt(v.frameMs.p95).padStart(7)} p95   free-running rAF, sim live, ${fmt(1000 / v.frameMs.median, 1)} fps`);
  console.log(`  cpuMs     ${fmt(v.cpuMs.median).padStart(7)} med  ${fmt(v.cpuMs.p95).padStart(7)} p95   engine's own stats(), same frames`);
  console.log(`  simMs     ${fmt(v.simMs.median).padStart(7)} med  ${fmt(v.simMs.p95).padStart(7)} p95   one 30 Hz tick, inside cpuMs`);
}
console.log(`  cpuMs     ${fmt(baseCpu).padStart(7)} med                   hand-driven frame, sim paused (render CPU only)`);
console.log(`  gpuMs     ${fmt(baseGpu).padStart(7)} med                   EXT_disjoint_timer_query, same frames`);

/*
 * THE CROSS-CHECK THAT IS ALSO A FINDING.
 *
 * `stats().cpuMs` is measured from `debug.beginFrame` to `debug.endFrame`, and
 * `GameLoop.renderPass` calls `registry.runFrame(rc)` BEFORE `hooks.render`,
 * which is where `beginFrame` lives. So every render-side frame system — the
 * RenderBridge instance uploads, VFX, the ore instancer, the fog blit, the HUD —
 * runs OUTSIDE the engine's own CPU window. This file's stopwatch brackets the
 * whole of `captureFrame`, so the difference between the two IS that block.
 *
 * Paired per frame rather than sampled once, because a single reading of each
 * could differ for any reason at all.
 */
const baseEngineCpu = median(report.configs['all-on'].engineCpuBlocks);
console.log(
  `  cross-check: stats().cpuMs ${fmt(baseEngineCpu)} ms vs whole-frame ${fmt(baseCpu)} ms — the `
  + `${fmt(baseCpu - baseEngineCpu)} ms gap is registry.runFrame, which the engine's own counter excludes`,
);
console.log(`  gpu/cpu ratio ${fmt(baseGpu / baseCpu, 2)}x`);
console.log('');

console.log('ABLATION  (min of per-block medians — contention can only push these UP)');
console.log('  config          GPU ms   spread   cpu ms   wall ms      p95    saves    draws   AO size');
for (const c of CONFIGS) {
  const r = report.configs[c.id];
  const g = Math.min(...r.gpuBlocks);
  const spread = Math.max(...r.gpuBlocks) - g;
  const w = Math.min(...r.wallBlocks);
  const cp = Math.min(...r.cpuBlocks);
  console.log(
    `  ${c.id.padEnd(14)} ${fmt(g).padStart(7)} ${('±' + fmt(spread)).padStart(8)} ${fmt(cp).padStart(8)} ${fmt(w).padStart(9)} ` +
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
    const p = report.shadowProbe;
    console.log(
      `\n  shadow map (a SUBSET of render): ${fmt(report.shadow.median)} ms med, `
      + `${fmt(report.shadow.p95)} p95`
      + (p ? `  [${p.working} of ${p.invocations} invocations carried a light]` : ''),
    );
  }
}

if (report.sweep) {
  console.log('\nRESOLUTION SWEEP  (the honest answer to "does it hit 60")');
  console.log('  scale   pixels        GPU ms      fps    cpu ms   ms/Mpx');
  for (const r of report.sweep) {
    const mpx = (r.width * r.height) / 1e6;
    console.log(
      `  ${r.scale.toFixed(2)}   ${`${r.width}x${r.height}`.padEnd(12)} ${fmt(r.gpuMs).padStart(7)} ` +
        `${fmt(1000 / r.gpuMs, 1).padStart(8)} ${fmt(r.cpuMs).padStart(9)} ${fmt(r.gpuMs / mpx).padStart(8)}`,
    );
  }
  /*
   * THE FILL-RATE DISCRIMINATOR, and it needs no timer query at all.
   *
   * A frame whose cost scales with PIXEL COUNT is fill-rate bound. A frame whose
   * cost barely moves as the buffer shrinks is not — its work is per-object or
   * per-vertex or on the CPU, and no amount of resolution scaling will save it.
   * Regressing GPU ms against megapixels over the swept range gives both halves
   * of that: the slope in ms per megapixel, and the INTERCEPT, which is the
   * resolution-independent residue.
   */
  const n = report.sweep.length;
  const xs = report.sweep.map((r) => (r.width * r.height) / 1e6);
  const ys = report.sweep.map((r) => r.gpuMs);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = (sxy * sxy) / (sxx * syy);
  const fillShare = (slope * xs[0]) / ys[0];
  console.log(
    `\n  GPU ms = ${fmt(intercept)} + ${fmt(slope)} x Mpx   (r2 ${fmt(r2, 3)})`,
  );
  console.log(
    `  At full size that is ${fmt(fillShare * 100, 1)}% pixel-proportional and `
    + `${fmt((1 - fillShare) * 100, 1)}% resolution-independent.`,
  );
  report.fillRate = { slopeMsPerMpx: slope, interceptMs: intercept, r2, fillShareAtFullSize: fillShare };

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

/* -------------------------------------------------------------------------- */
/* the decision                                                               */
/* -------------------------------------------------------------------------- */

/*
 * `docs/WEBGPU_MIGRATION_PLAN.md` §1's table, resolved against what was just
 * measured. Printed rather than left to a reader, because three of its four rows
 * say the migration does not help and the difference between them is a ratio
 * nobody should have to compute by eye.
 *
 * The thresholds: 1.5x is "dominates" — enough that halving the smaller side
 * could not close it. Post-vs-colour is decided on the per-pass table, where
 * `render` is the colour pass (the shadow map is inside it) and everything else
 * in the composer is the post chain.
 */
const RATIO = 1.5;
let verdict;
if (baseCpu >= baseGpu * RATIO) {
  verdict = ['CPU-BOUND', "WebGPU's draw-submission win is real. §2 is still free and still first."];
} else if (baseGpu >= baseCpu * RATIO) {
  const postMs = Object.entries(report.passes)
    .filter(([k]) => k !== 'render')
    .reduce((s, [, p]) => s + p.median, 0);
  const colourMs = report.passes.render?.median ?? NaN;
  verdict = Number.isFinite(colourMs) && postMs > colourMs
    ? ['FILL-RATE BOUND (post chain dominant)', 'WebGPU changes nothing. Fix resolution scale, pass count and overdraw.']
    : ['SHADER / OVERDRAW BOUND (colour pass dominant)', 'WebGPU changes nothing. Fix materials, overdraw and what the colour pass is asked to shade.'];
} else {
  verdict = ['NEITHER DOMINATES', 'No submission bottleneck to relieve; the migration is a maintenance decision.'];
}
report.verdict = { row: verdict[0], meaning: verdict[1], cpuMs: baseCpu, gpuMs: baseGpu };
console.log(`\nWEBGPU PHASE 0 VERDICT: ${verdict[0]}`);
console.log(`  ${verdict[1]}`);

if (JSON_OUT) {
  mkdirSync(dirname(join(ROOT, JSON_OUT)), { recursive: true });
  writeFileSync(join(ROOT, JSON_OUT), JSON.stringify(report, null, 2));
  console.log(`\nwrote ${JSON_OUT}`);
}

process.exit(0);

/**
 * ============================================================================
 * BOOT PROFILER — where the loading curtain's seconds actually go.
 * ============================================================================
 * Boots the BUILT game in headless Chromium exactly as `tools/shoot.mjs` does,
 * then reads the opt-in, bounded telemetry snapshot through the existing
 * `__VM.hooks` diagnostics seam. Normal play does not enable the recorder.
 *
 *   node tools/boot-profile.mjs                       # build, then profile
 *   node tools/boot-profile.mjs --no-build            # profile the existing dist/
 *   node tools/boot-profile.mjs --runs 5              # more samples
 *   node tools/boot-profile.mjs --shot 00-mcv-four-army
 *   node tools/boot-profile.mjs --linger 20000          # observe deferred work
 *   node tools/boot-profile.mjs --shot 08-naval-water # a different fixture
 *   node tools/boot-profile.mjs --flags "terrainworkers=off,waterworkers=off"
 *
 * WHY THE MEDIAN AND NOT THE MEAN. A cold first boot pays for the module graph,
 * the shader compile and the worker script fetch, and those are real but they
 * are not what a terrain change moves. Every figure below is the median of
 * `--runs` boots in ONE browser (separate pages), with the first boot reported
 * separately as `cold`.
 *
 * WHAT THE NUMBERS MEAN, precisely, because the whole point is comparing two
 * of these:
 *
 *   terrain   wall clock inside `world.terrain`'s init — the `[terrain] ... in
 *             N ms` line. With the worker path on, this INCLUDES any time spent
 *             waiting for the worker, which is the honest figure: it is how long
 *             the boot actually stopped there.
 *   water     the same, for `world.water`.
 *   ready     navigation start to `__VM.ready()` resolving, i.e. the whole boot.
 *
 * A worker offload that moves `terrain` down while leaving `ready` where it was
 * has moved work, not saved time, and this tool is arranged so that shows up.
 * ============================================================================
 */

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * A HINT, shared with four other tools until `serve()` made the number stop
 * mattering. Every millisecond this file reports is a property of the bundle it
 * booted, so a neighbour's `dist/` answering on 4319 does not produce an error
 * here — it produces a boot profile of somebody else's build, in the right
 * shape, with plausible numbers.
 */
const PORT_HINT = 4319;

const argv = process.argv.slice(2);
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}
const noBuild = argv.includes('--no-build');
/** Echo the whole boot log, timestamped from navigation start. */
const verbose = argv.includes('--verbose');
/** Skip the genuinely-fresh-profile calibration so gameplay hitches can be isolated. */
const calibrated = argv.includes('--calibrated');
const RUNS = Number(opt('runs', '3'));
const SHOT = opt('shot', '08-naval-water');
const EXTRA = opt('flags', '');
const OUT = opt('out', '');
const RAW_OUT = opt('raw-out', '');
const compactOutput = argv.includes('--compact');
const LINGER = Number(opt('linger', '0'));
// WebGPU is the product default. Only the temporary explicit legacy override
// should launch the non-native harness path; an absent `gpu` query must still
// exercise the same renderer players now receive.
const nativeWebGpu = !EXTRA.split(',').some((pair) => pair.trim() === 'gpu=webgl');

/** The fixtures worth profiling, and the boot flags each one needs. */
const FIXTURES = {
  '02-base-two-army': {
    shot: null,
    seed: 7,
    skipmenu: '1',
    start: 'base',
    setup: {
      playerFaction: 'allies',
      aiFaction: 'soviets',
      map: 'temperate-valley',
      difficulty: 1,
      personality: -1,
      startingCredits: 10_000,
      speed: 1,
      seed: 7,
      weather: true,
      opponents: [
        { faction: 'soviets', difficulty: 1, personality: -1, team: 2 },
      ],
    },
  },
  '00-mcv-four-army': {
    shot: null,
    seed: 7,
    skipmenu: '1',
    start: 'mcv',
    setup: {
      playerFaction: 'allies',
      aiFaction: 'soviets',
      map: 'temperate-valley',
      difficulty: 1,
      personality: -1,
      startingCredits: 10_000,
      speed: 1,
      seed: 7,
      weather: true,
      opponents: [
        { faction: 'soviets', difficulty: 1, personality: -1, team: 2 },
        { faction: 'meridian', difficulty: 1, personality: -1, team: 3 },
        { faction: 'reclaim', difficulty: 1, personality: -1, team: 4 },
      ],
    },
  },
  '01-establishing-base': { shot: 'allied-base', seed: 7 },
  '03-terrain-closeup': { shot: 'terrain-showcase', seed: 3 },
  // The one map with a declared sea, so the only one where water does real work.
  '08-naval-water': { shot: 'naval', seed: 13 },
  // Phase 2-4 graphics baseline: the real product map, not a showcase scene.
  // Keep this setup byte-for-byte aligned with tools/realism-baseline.mjs so
  // visual gains can be charged against the boot curtain on the same content.
  '14-industrial-grid-realism': {
    shot: null,
    seed: 7,
    skipmenu: '1',
    start: 'base',
    setup: {
      playerFaction: 'allies',
      aiFaction: 'soviets',
      map: 'industrial-grid',
      difficulty: 1,
      personality: -1,
      startingCredits: 10_000,
      speed: 1,
      seed: 7,
      weather: false,
      opponents: [
        { faction: 'soviets', difficulty: 1, personality: -1, team: 2 },
      ],
    },
  },
};

const flags = FIXTURES[SHOT];
if (flags === undefined) {
  console.error(`unknown --shot ${SHOT}. Known: ${Object.keys(FIXTURES).join(', ')}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */

if (!noBuild) {
  console.log('> building...');
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (r.status !== 0) throw new Error('build failed');
} else if (!existsSync(join(ROOT, 'apps/game/dist', 'index.html'))) {
  console.error('--no-build was given but dist/index.html does not exist.');
  process.exit(1);
}

console.log('> serving...');
const server = await serve({
  root: ROOT, mode: 'preview', portHint: PORT_HINT, log: console.log,
});
const BASE = server.origin;
const cleanup = () => server.stop();

const browser = await chromium.launch({
  headless: true,
  // Playwright's bundled Chromium cannot load Dawn's DXIL dependency on this
  // Windows host. System Chrome is the same path used by gpu-boot-probe and is
  // required for a real WebGPU boot measurement instead of an instant device
  // creation failure.
  ...(nativeWebGpu ? { channel: 'chrome' } : {}),
  args: [
    '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
    ...(nativeWebGpu ? [] : ['--enable-unsafe-swiftshader']),
    '--disable-gpu-sandbox',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
  ],
});

/* -------------------------------------------------------------------------- */
/* The lines this reads out of the boot log.                                  */
/* -------------------------------------------------------------------------- */

/** `... 34567 tris in 1234 ms · ...` and `... tris in 1234 ms` alike. */
const PATTERNS = [
  ['battlefield', /\[boot\] battlefield (\d+) ms/],
  ['systems', /\[boot\][^\n]*?systems (\d+) ms/],
  ['presentation', /\[boot\][^\n]*?presentation (\d+) ms/],
  ['shaders', /\[boot\][^\n]*?shaders (\d+) ms/],
  ['terrain', /\[terrain\][^\n]*? in (\d+) ms/],
  ['water', /\[water\][^\n]*?in (\d+) ms/],
  ['terrainGen', /\[terrain\][^\n]*?generated in (\d+) ms/],
  ['waterBake', /\[water\][^\n]*?baked in (\d+) ms/],
  ['worldWorker', /\[world\][^\n]*?terrain (\d+) ms[^\n]*?water (\d+) ms/],
];

const qs = new URLSearchParams();
qs.set('bootprofile', '1');
for (const [k, v] of Object.entries(flags)) {
  if (k === 'setup' || v === null || v === undefined) continue;
  qs.set(k, String(v));
}
for (const pair of EXTRA.split(',')) {
  if (pair.trim() === '') continue;
  const [k, v = ''] = pair.split('=');
  qs.set(k, v);
}

const samples = [];
for (let run = 0; run < RUNS; run++) {
  // Per run, not once: the median below is taken over several boots and a
  // server that died between two of them would silently mix two bundles.
  server.assertAlive(`run ${run + 1}`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  if (calibrated) {
    await page.addInitScript(() => {
      localStorage.setItem('voltmarch.settings.v1', JSON.stringify({
        graphics: { calibrated: true },
      }));
    });
  }
  if (flags.setup !== undefined) {
    await page.addInitScript((setup) => {
      localStorage.setItem('voltmarch.setup.v1', JSON.stringify(setup));
    }, flags.setup);
  }
  const lines = [];
  const t0 = Date.now();
  page.on('console', (m) => {
    lines.push(m.text());
    if (verbose) console.log(`    +${Date.now() - t0} ${m.text()}`);
  });
  page.on('pageerror', (e) => { lines.push(`[pageerror] ${String(e)}`); });

  await page.goto(`${BASE}?${qs.toString()}`, { waitUntil: 'load' });
  /*
   * THE CURTAIN, NOT `__VM.ready()`.
   *
   * `__VM` is published at RENDER boot — the log line says so — which is before
   * `registry.init()` has run a single module. Waiting on it reports ~430 ms for
   * a boot that has not yet generated a heightfield, and the profile comes back
   * with no terrain line at all because the page was closed while the generator
   * was still running. `main.ts` dismisses the curtain after `game.ready` and
   * two presented frames, so this is the moment the player sees the map.
   */
  await page.waitForFunction(
    () => document.getElementById('loading')?.classList.contains('is-hidden') === true,
    null, { timeout: 120_000 },
  );
  const ready = Date.now() - t0;
  // Ready is the fade start. Wait for the existing transition timer only so
  // the exported mark set also contains the curtain-dismiss end boundary.
  await page.waitForFunction(
    () => document.getElementById('loading')?.hidden === true,
    // The fade itself is 1.2 s, but a native WebGPU calibration probe can
    // occupy the main thread immediately after reveal. That delayed the timer
    // past the old 2 s harness deadline on otherwise successful 30 s boots.
    // This wait is outside the measured `ready` boundary; extra headroom only
    // prevents evidence collection from discarding a valid sample.
    null, { timeout: 10_000 },
  );
  /*
   * A CHECKSUM OF WHAT IS ACTUALLY ON SCREEN.
   *
   * `tests/world-workers.spec.ts` proves the worker and the main thread agree
   * byte for byte, but it proves it in Node against the generator classes. This
   * reaches into the LIVE scene in a real browser and hashes the terrain chunk
   * geometry the renderer is drawing plus the water field texture the shader is
   * sampling. Run it once with the workers on and once with `?terrainworkers=
   * off&waterworkers=off` and the two numbers must match exactly — which is the
   * end-to-end form of the claim, adoption path and all.
   *
   * FNV-1a over the raw bytes: order-sensitive, cheap, and it does not care what
   * the values mean.
   */
  const checksum = await page.evaluate(() => {
    const fnv = (bytes) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h;
    };
    const scene = window.__VM?.scene;
    if (!scene) return null;
    const parts = [];
    scene.traverse((o) => {
      if (typeof o.name === 'string' &&
          (o.name.startsWith('terrain.chunk.') || o.name.startsWith('terrain.batch.'))) parts.push(o);
    });
    parts.sort((a, b) => (a.name < b.name ? -1 : 1));
    let h = 0x811c9dc5;
    const mix = (v) => { h = Math.imul(h ^ v, 0x01000193) >>> 0; };
    for (const m of parts) {
      const g = m.geometry;
      for (const key of ['position', 'normal', 'aUp', 'aTop']) {
        const attr = g.getAttribute(key);
        if (!attr) continue;
        mix(fnv(new Uint8Array(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength)));
      }
      const idx = g.getIndex();
      if (idx) mix(fnv(new Uint8Array(idx.array.buffer, idx.array.byteOffset, idx.array.byteLength)));
      mix(m.castShadow ? 1 : 0);
      if (m.isBatchedMesh === true) {
        const matrix = m.matrix.clone();
        for (let i = 0; i < m.instanceCount; i++) {
          m.getMatrixAt(i, matrix);
          mix(fnv(new Uint8Array(new Float32Array(matrix.elements).buffer)));
        }
      }
    }
    const w = window.__vmWater;
    let water = 0;
    if (w && w.depth) {
      water = fnv(new Uint8Array(w.depth.buffer, w.depth.byteOffset, w.depth.byteLength));
      water = Math.imul(water ^ fnv(new Uint8Array(
        w.shore.buffer, w.shore.byteOffset, w.shore.byteLength,
      )), 0x01000193) >>> 0;
      water = Math.imul(water ^ fnv(w.waterCells), 0x01000193) >>> 0;
    }
    const chunks = parts.reduce(
      (total, part) => total + (part.isBatchedMesh === true ? part.instanceCount : 1),
      0,
    );
    return { chunks, terrain: h, water };
  });

  // A rolling FPS headline hides one dropped frame in hundreds. Begin only
  // AFTER the synchronous checksum above: an instrument that records its own
  // scene traversal as a gameplay hitch poisons the comparison it exists for.
  await page.evaluate(() => {
    const probe = { gaps: [], longTasks: [], handle: 0, last: performance.now(), observer: null };
    const frame = (now) => {
      const gap = now - probe.last;
      if (gap >= 50) probe.gaps.push(gap);
      probe.last = now;
      probe.handle = requestAnimationFrame(frame);
    };
    probe.handle = requestAnimationFrame(frame);
    if (typeof PerformanceObserver === 'function') {
      try {
        probe.observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            probe.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        });
        probe.observer.observe({ entryTypes: ['longtask'] });
      } catch { /* Long Task timing is optional; raw rAF gaps remain authoritative. */ }
    }
    window.__vmHitchProbe = probe;
    window.__VM?.hooks?.perfStart?.();
  });

  if (LINGER > 0) await page.waitForTimeout(LINGER);

  const hitches = await page.evaluate(() => {
    const probe = window.__vmHitchProbe;
    if (!probe) return null;
    cancelAnimationFrame(probe.handle);
    probe.observer?.disconnect();
    const gaps = [...probe.gaps].sort((a, b) => b - a);
    const longTasks = [...probe.longTasks].sort((a, b) => b.duration - a.duration);
    delete window.__vmHitchProbe;
    return {
      framesOver50Ms: gaps.length,
      worstFrameGapMs: gaps[0] ?? 0,
      topFrameGapsMs: gaps.slice(0, 8),
      longTasks: longTasks.length,
      worstLongTaskMs: longTasks[0]?.duration ?? 0,
      topLongTasks: longTasks.slice(0, 8),
      peakSystems: (window.__VM?.hooks?.perfSystems?.() ?? []).slice(0, 12),
    };
  });

  // Capture after the optional linger. Deferred GLTF/KTX2/conditioning spans
  // are the reason linger exists; an earlier snapshot silently discarded them.
  const instrumentation = await page.evaluate(() => ({
    boot: window.__VM?.hooks?.bootReport?.() ?? null,
    backend: window.__VM?.rendererHandle?.backend ?? null,
    userAgent: navigator.userAgent,
  }));
  if (instrumentation.boot?.enabled !== true) {
    throw new Error('built game did not publish enabled boot telemetry through __VM.hooks.bootReport');
  }

  const text = lines.join('\n');
  const stableFrame = instrumentation.boot.marks.find(
    (mark) => mark.category === 'app' && mark.name === 'first-stable-frame',
  );
  const bootRun = instrumentation.boot.runs.at(-1) ?? null;
  const s = {
    run,
    ready: stableFrame?.atMs ?? ready,
    harnessReady: ready,
    checksum,
    hitches,
    environment: {
      backend: instrumentation.backend,
      userAgent: instrumentation.userAgent,
      cacheState: run === 0
        ? 'first-page-in-fresh-browser-process'
        : 'fresh-page-with-browser-process-and-http-cache-reused',
      engineStateReused: false,
      bootRun: bootRun?.context ?? null,
      fixture: {
        name: SHOT,
        scenario: flags.setup?.map ?? flags.shot ?? 'default',
        factions: flags.setup === undefined
          ? 'fixture-authored'
          : [
              flags.setup.playerFaction,
              ...flags.setup.opponents.map((opponent) => opponent.faction),
            ].join(','),
        seatedArmies: flags.setup === undefined ? null : flags.setup.opponents.length + 1,
      },
    },
    boot: instrumentation.boot,
  };
  for (const [key, re] of PATTERNS) {
    const m = re.exec(text);
    if (m === null) continue;
    s[key] = Number(m[1]);
    if (m[2] !== undefined) s[`${key}2`] = Number(m[2]);
  }
  s.landlocked = /landlocked/.test(text);
  samples.push(s);
  const sum = checksum === null
    ? ''
    : `, world ${checksum.chunks} chunks ${checksum.terrain.toString(16)}/${checksum.water.toString(16)}`;
  const hitchSummary = hitches === null
    ? ''
    : `, hitches ${hitches.framesOver50Ms} (worst ${hitches.worstFrameGapMs.toFixed(1)} ms)`;
  console.log(`  run ${run + 1}/${RUNS}: ready ${s.ready.toFixed(1)} ms, terrain ${s.terrain ?? '-'} ms, water ${s.water ?? '-'} ms${sum}${hitchSummary}`);
  await page.close();
}

await browser.close();
cleanup();

/* -------------------------------------------------------------------------- */

function median(values) {
  const v = values.filter((n) => typeof n === 'number').sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v.length % 2 === 1 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
}

function percentileNearest(values, percentile) {
  const sorted = values.filter((n) => typeof n === 'number').sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
}

function spanTotals(sample) {
  const result = {};
  for (const span of sample.boot?.spans ?? []) {
    const key = `${span.category}.${span.name}`;
    result[key] = (result[key] ?? 0) + span.durationMs;
  }
  return result;
}

function resourceTotals(sample) {
  const result = { count: 0, transferBytes: 0, decodedBytes: 0, byProtocol: {} };
  for (const resource of sample.boot?.resources ?? []) {
    result.count++;
    result.transferBytes += resource.transferSize;
    result.decodedBytes += resource.decodedBodySize;
    result.byProtocol[resource.protocol] = (result.byProtocol[resource.protocol] ?? 0) + 1;
  }
  return result;
}

function compactSample(sample) {
  return {
    run: sample.run,
    ready: sample.ready,
    harnessReady: sample.harnessReady,
    checksum: sample.checksum,
    hitches: sample.hitches,
    environment: sample.environment,
    phasesMs: spanTotals(sample),
    resources: resourceTotals(sample),
    marks: (sample.boot?.marks ?? []).filter((mark) => mark.category === 'app'),
    truncated: sample.boot?.truncated ?? null,
  };
}

// Pages 2+ reuse the browser process and HTTP cache, but NOT page-owned decoded
// assets, Three resources, renderer/device state or VOLTMARCH pipeline maps.
// Call this state cache-warm, never engine-warm.
const cacheWarm = samples.slice(1);
const keys = [
  'ready', 'battlefield', 'systems', 'presentation', 'shaders',
  'terrain', 'water', 'terrainGen', 'waterBake', 'worldWorker', 'worldWorker2',
];
const summary = {
  schema: 3,
  shot: SHOT,
  flags: qs.toString(),
  runs: RUNS,
  firstPage: samples[0],
  checksum: samples[0].checksum,
  cacheWarmMedian: {},
  cacheWarmP95: {},
  cacheWarmMedianSpanTotalsMs: {},
  cacheWarmMedianResources: {},
  samples,
};
for (const k of keys) {
  const m = median(cacheWarm.map((s) => s[k]));
  if (m !== null) summary.cacheWarmMedian[k] = m;
  const p95 = percentileNearest(cacheWarm.map((s) => s[k]), 0.95);
  if (p95 !== null) summary.cacheWarmP95[k] = p95;
}
const spanKeys = [...new Set(cacheWarm.flatMap((sample) => Object.keys(spanTotals(sample))))].sort();
for (const key of spanKeys) {
  summary.cacheWarmMedianSpanTotalsMs[key] = median(
    cacheWarm.map((sample) => spanTotals(sample)[key] ?? 0),
  );
}
for (const key of ['count', 'transferBytes', 'decodedBytes']) {
  summary.cacheWarmMedianResources[key] = median(
    cacheWarm.map((sample) => resourceTotals(sample)[key]),
  );
}

console.log(`\n${SHOT}  (?${qs.toString()})`);
if (summary.checksum !== null && summary.checksum !== undefined) {
  const c = summary.checksum;
  console.log(`  world checksum   ${c.chunks} chunks, terrain ${c.terrain.toString(16)}, water ${c.water.toString(16)}`);
  const drift = samples.filter((s) => s.checksum !== null
    && (s.checksum.terrain !== c.terrain || s.checksum.water !== c.water));
  if (drift.length > 0) {
    console.log(`  !! ${drift.length} run(s) produced a DIFFERENT world from the same flags`);
  }
}
console.log(`  first page       ${samples[0].ready} ms`);
for (const [k, v] of Object.entries(summary.cacheWarmMedian)) {
  console.log(`  ${k.padEnd(16)} ${v} ms   (cache-warm fresh-page median of ${cacheWarm.length})`);
}
if (OUT !== '') {
  const outputPath = resolve(ROOT, OUT);
  mkdirSync(dirname(outputPath), { recursive: true });
  const output = compactOutput
    ? {
        ...summary,
        compact: true,
        firstPage: compactSample(samples[0]),
        samples: samples.map(compactSample),
      }
    : summary;
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`\n-> ${OUT}`);
}
if (RAW_OUT !== '') {
  const rawOutputPath = resolve(ROOT, RAW_OUT);
  mkdirSync(dirname(rawOutputPath), { recursive: true });
  writeFileSync(rawOutputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`-> ${RAW_OUT} (raw)`);
}

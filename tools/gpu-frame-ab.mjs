/**
 * ============================================================================
 * VOLTMARCH — tools/gpu-frame-ab.mjs
 * ============================================================================
 * END-TO-END FRAME TIME, THE REAL GAME, BOTH BACKENDS, ONE RUN.
 *
 *   node tools/gpu-frame-ab.mjs [--scene allied-base] [--size 2560x1440]
 *                               [--frames 60] [--blocks 5] [--no-build]
 *                               [--backend webgpu] [--aa traa|taau] [--taau-scale .75]
 *                               [--capture .codex-artifacts/frame]
 *   node tools/gpu-frame-ab.mjs --match --units 200 --sim 900
 *
 * Every performance number this migration has is either a SYNTHETIC scene
 * (`RENDER_FINDINGS.md` §7b — 70 stock materials, no post chain, no game) or a
 * WEBGL-ONLY profile (§9 — `tools/gpu-profile.mjs`, whose whole instrument is
 * `EXT_disjoint_timer_query_webgl2` and per-`Pass` ablation). Neither can answer
 * "is the shipped game faster or slower on WebGPU", which is the question that
 * was actually asked. This file answers exactly that and nothing else.
 *
 * ── THE CLOCK, AND WHY IT IS NOT THE ONE `gpu-profile.mjs` USES ──────────────
 * That file's headline is a GPU timer query. **There is no cross-backend
 * equivalent**: `EXT_disjoint_timer_query_webgl2` is a WebGL extension, WebGPU's
 * counterpart is `timestamp-query` (which Chrome gates behind a flag and three
 * surfaces only as `info.render.timestamp`), and a comparison whose two arms are
 * measured by two different instruments is not a comparison. Its 1-pixel
 * `readPixels` bound is WebGL-only for the same reason — the node `Renderer`
 * publishes only `readRenderTargetPixelsAsync`.
 *
 * So this measures WALL TIME PER FRAME over a block, with ONE GPU FLUSH at the
 * end of the block, and the flush is what makes it honest: `canvas.toDataURL()`
 * forces the drawing buffer to be read back on both backends, so the GPU cannot
 * still be a block behind when the stopwatch stops. Amortised over 60 frames a
 * single readback is under 2% of the total, and it is the SAME 2% in both arms.
 *
 * `stats().cpuMs` and `stats().frameMs` are reported beside it, unchanged, and
 * `cpuMs` still under-reports by ~24% for the reason §9 records — it starts at
 * `hooks.render`, after `registry.runFrame()`. That bias is also identical in
 * both arms.
 *
 * ── WHAT MAKES IT A MEASUREMENT AND NOT A VIBE ──────────────────────────────
 *   * ONE BROWSER PER ARM, closed before the next opens. The machine has form
 *     for falling over under two.
 *   * THE GAME'S OWN rAF LOOP IS STOPPED. Frames are driven synchronously by
 *     `__VM.advanceFrames`, so nothing lands mid-measurement.
 *   * WARMUP FRAMES ARE THROWN AWAY. A first frame is a shader compile; three
 *     of this project's five worst measurements were a compile mistaken for a
 *     regression.
 *   * BLOCKS. Each block reports elapsed wall time / submitted frames; the
 *     summary keeps both the minimum and the median of those block averages.
 *     Another process on this box can only push a block upward.
 *   * THE SIZE IS PINNED WITH `__VM.setSize` — one drawing-buffer pixel per
 *     requested pixel, `resolutionScale` bypassed, `AdaptiveResolution` inert.
 *   * THE LIVE BACKEND IS READ AND ASSERTED. A `webgl2-fallback` arm is a
 *     third renderer and is refused, not labelled.
 * ============================================================================
 */

import { chromium } from 'playwright';
import { build, serve } from './lib/serve.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const SCENE = flag('scene', 'allied-base');
const SEED = Number(flag('seed', '7'));
const [W, H] = flag('size', '2560x1440').split('x').map(Number);
const FRAMES = Number(flag('frames', '60'));
const BLOCKS = Number(flag('blocks', '5'));
const WARMUP = Number(flag('warmup', '30'));
/** Presentation seconds fed before the first measurement, as `shoot.mjs` does. */
const SETTLE = Number(flag('settle', '4'));
const JSON_OUT = flag('json', '');
const CAPTURE = flag('capture', '');
const DISTANCE = Number(flag('distance', '62'));
const FOCUS_TREE = argv.includes('--focus-tree');
const CAPTURE_DISTANCES = flag('capture-distances', '')
  .split(',').filter(Boolean).map(Number);
if (!Number.isFinite(DISTANCE) || DISTANCE <= 0
  || CAPTURE_DISTANCES.some((distance) => !Number.isFinite(distance) || distance <= 0)) {
  throw new Error('--distance and --capture-distances must contain positive metre values');
}
const noBuild = argv.includes('--no-build');
const MATCH = argv.includes('--match');
const ARMIES = Math.max(2, Math.min(4, Number(flag('armies', '4'))));
const MAP_ID = flag('map', 'industrial-grid');
const DIFFICULTY = Number(flag('ai', '3'));
const PERSONALITY = Number(flag('aip', '2'));
const CREDITS = Number(flag('credits', '50000'));
const SIM_SECONDS = Number(flag('sim', '900'));
const UNIT_TARGET = Number(flag('units', '200'));
const RENDER_CULL = flag('render-cull', 'on') !== 'off';
const SHADOW_PROXY = flag('shadow-proxy', 'filtered');
const SCATTER_BATCH = flag('scatter-batch', 'instanced');
const SCATTER_SHADOW = flag('scatter-shadow', 'filtered');
const SHADOW_CADENCE = flag('shadow-cadence', 'adaptive');
const FOLIAGE = flag('foliage', '');
const FOLIAGE_COMPUTE = flag('foliage-compute', '');
const FOLIAGE_COMPUTE_AUDIT = argv.includes('--foliage-compute-audit');
const CAMERA_PATH = flag('camera-path', 'static').toLowerCase();
const GPU_TIMESTAMPS = argv.includes('--gpu-timestamps');
const GPU_PASSES = argv.includes('--gpu-passes');
const POST_REUSE = flag('post-reuse', 'on').toLowerCase();
const BASE_WEAR = flag('base-wear', 'context').toLowerCase();
const ART = flag('art', '');
const BACKEND = flag('backend', 'both');
const AA = flag('aa', '').toLowerCase();
const TAAU_SCALE = flag('taau-scale', '');
const BACKENDS = BACKEND === 'both' ? ['webgl', 'webgpu'] : [BACKEND];
if (BACKENDS.some((gpu) => gpu !== 'webgl' && gpu !== 'webgpu')) {
  throw new Error(`--backend must be webgl, webgpu or both; received "${BACKEND}"`);
}
if (AA && BACKENDS.some((gpu) => gpu !== 'webgpu')) {
  throw new Error('--aa is a WebGPU experiment; pair it with --backend webgpu');
}
if (!['adaptive', 'legacy', 'half'].includes(SHADOW_CADENCE)) {
  throw new Error(`--shadow-cadence must be adaptive, legacy or half; received "${SHADOW_CADENCE}"`);
}
if (!['filtered', 'legacy'].includes(SCATTER_SHADOW)) {
  throw new Error(`--scatter-shadow must be filtered or legacy; received "${SCATTER_SHADOW}"`);
}
if (!['', 'cpu', 'gpu'].includes(FOLIAGE_COMPUTE)) {
  throw new Error(`--foliage-compute must be cpu or gpu; received "${FOLIAGE_COMPUTE}"`);
}
if (!['static', 'pan', 'band-churn'].includes(CAMERA_PATH)) {
  throw new Error(`--camera-path must be static, pan or band-churn; received "${CAMERA_PATH}"`);
}
if (!['on', 'legacy'].includes(POST_REUSE)) {
  throw new Error(`--post-reuse must be on or legacy; received "${POST_REUSE}"`);
}
if (!['context', 'legacy', 'off'].includes(BASE_WEAR)) {
  throw new Error(`--base-wear must be context, legacy or off; received "${BASE_WEAR}"`);
}
if (GPU_PASSES && GPU_TIMESTAMPS) {
  throw new Error('--gpu-passes and --gpu-timestamps both resolve Three\'s render query pool; choose one');
}
const FACTION_KEYS = ['allies', 'soviets', 'meridian', 'reclaim'];
const GIT_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

function workingTreeEvidence() {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: ROOT, encoding: 'utf8',
  }).trim().split(/\r?\n/).filter(Boolean);
  const hash = createHash('sha256');
  hash.update(execFileSync('git', ['diff', '--binary', 'HEAD', '--', '.'], { cwd: ROOT }));
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: ROOT,
  }).toString('utf8').split('\0').filter(Boolean).sort();
  for (const path of untracked) {
    hash.update(path);
    hash.update(readFileSync(join(ROOT, path)));
  }
  return { dirty: status.length > 0, status, sha256: hash.digest('hex') };
}

function builtCodeFingerprint() {
  const dist = join(ROOT, 'apps', 'game', 'dist');
  if (!existsSync(dist)) return null;
  const files = ['index.html'];
  const assets = join(dist, 'assets');
  if (existsSync(assets)) {
    for (const file of readdirSync(assets)) {
      if (/\.(?:js|css)$/.test(file)) files.push(join('assets', file));
    }
  }
  files.sort();
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(path);
    hash.update(readFileSync(join(dist, path)));
  }
  return hash.digest('hex');
}

if (!noBuild) await build(ROOT, { log: console.log });
const server = await serve({ root: ROOT, mode: 'preview', portHint: 4373, log: console.log });

async function seedLiveSetup(page) {
  await page.goto(`${server.origin}?shot=allied-base`, { waitUntil: 'commit' });
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
      seed: s.seed,
      opponents: s.keys.slice(1, s.armies).map((faction) => ({
        faction,
        difficulty: s.difficulty,
        personality: s.personality,
      })),
    }));
    localStorage.setItem('voltmarch.setup.start.v1', JSON.stringify('base'));
  }, {
    keys: FACTION_KEYS, armies: ARMIES, map: MAP_ID, difficulty: DIFFICULTY,
    personality: PERSONALITY, credits: CREDITS, seed: SEED,
  });
}

/** One arm: launch, boot, measure, close. Returns the numbers or throws. */
async function measure(gpu) {
  const browser = await chromium.launch({
    headless: true,
    // The bundled Chromium cannot create a WebGPU device on this machine —
    // Dawn / dxil.dll / Windows error 87. See docs/RENDER_FINDINGS.md 7c.
    ...(gpu === 'webgpu' ? { channel: 'chrome' } : {}),
    args: [
      '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio',
      '--force-device-scale-factor=1',
      // Free-running: at 2560x1440 this frame is well over 16.7 ms on both
      // arms, so a vsync-locked clock would report the refresh interval and
      // nothing else. That is measurement error #1 in `PostConfig.msaaSamples`.
      '--disable-frame-rate-limit', '--disable-gpu-vsync',
    ],
  });

  try {
    const page = await browser.newPage({
      // Captures are promotion evidence, so present one CSS pixel per requested
      // render pixel. Non-capture benchmarks retain the small control viewport;
      // `__VM.setSize` below still pins their drawing buffers exactly.
      viewport: CAPTURE ? { width: W, height: H } : { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(180_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));

    if (MATCH) await seedLiveSetup(page);
    const qs = MATCH
      ? new URLSearchParams({ skipmenu: '1', start: 'base', seed: String(SEED), fog: 'off', tier: 'high' })
      : new URLSearchParams({ shot: SCENE, tier: 'high', seed: String(SEED) });
    if (gpu === 'webgpu') qs.set('gpu', 'webgpu');
    if (AA) qs.set('aa', AA);
    if (TAAU_SCALE) qs.set('taauScale', TAAU_SCALE);
    if (!RENDER_CULL) qs.set('rendercull', 'off');
    if (SHADOW_PROXY === 'legacy') qs.set('shadowproxy', 'legacy');
    if (SCATTER_BATCH === 'legacy') qs.set('scatterbatch', 'legacy');
    if (SCATTER_SHADOW === 'legacy') qs.set('scattershadow', 'legacy');
    if (SHADOW_CADENCE !== 'adaptive') qs.set('shadowcadence', SHADOW_CADENCE);
    if (FOLIAGE) qs.set('foliage', FOLIAGE);
    if (FOLIAGE_COMPUTE) qs.set('foliagecompute', FOLIAGE_COMPUTE);
    if (ART) qs.set('art', ART);
    if (POST_REUSE === 'legacy') qs.set('postreuse', 'legacy');
    if (BASE_WEAR !== 'context') qs.set('basewear', BASE_WEAR);
    await page.goto(`${server.origin}?${qs}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 120_000 });
    await page.evaluate(() => window.__VM.ready());
    /*
     * WAIT FOR THE CURTAIN, NOT JUST FOR `ready()`.
     *
     * `__VM.ready()` resolves when `registry.init()` has; the SCENARIO — and
     * therefore every entity, every structure and the terrain mesh — is seeded
     * afterwards, by `main.ts` calling `game.start()` and running the boot
     * paint. Measuring at `ready()` measured an empty scene: 23 draw calls, 1
     * entity, 11 189 triangles against the 149 / 865 353 a real fixture has.
     * `tools/shoot.mjs` waits on `#loading` for exactly this reason and calls
     * a visible curtain at the shutter a refusal.
     */
    await page.waitForFunction(() => {
      const c = document.getElementById('loading');
      return c === null || c.hidden === true;
    }, null, { timeout: 120_000 });
    if (FOLIAGE && FOLIAGE !== 'procedural') {
      // Imported presentation deliberately does not hold the loading curtain.
      // An A/B that starts timing the immediate fallback is mislabeled, so the
      // diagnostic harness waits for the generation-guarded resource handoff.
      await page.waitForFunction(() => (
        (window.__VM?.stats().counters.importedFoliageFamilies ?? 0) > 0
      ), null, { timeout: 120_000 });
    }

    const backend = await page.evaluate(() => window.__VM.rendererHandle.backend);
    if (backend !== gpu) {
      throw new Error(
        `asked for '${gpu}', live backend is '${backend}'. A WebGL2 fallback is a THIRD ` +
        'renderer (node materials over WebGL2) and its frame time is not this arm\'s.',
      );
    }

    const result = await page.evaluate(async (opts) => {
      const vm = window.__VM;
      vm.setUiVisible(false);
      vm.pause();
      vm.setSize(opts.w, opts.h);
      vm.focusOn(256, 256, opts.distance);
      let ramp = null;
      if (opts.match) {
        let done = 0;
        let peak = 0;
        let peakTick = 0;
        const totalTicks = opts.simSeconds * 30;
        const trace = [];
        while (done < totalTicks) {
          const n = Math.min(300, totalTicks - done);
          vm.step(n);
          done += n;
          vm.hooks.renderFrame();
          const units = vm.stats().counters.units;
          trace.push([done, units]);
          if (units > peak) { peak = units; peakTick = done; }
          if (opts.unitTarget > 0 && units >= opts.unitTarget) break;
        }
        ramp = { ticks: done, peak, peakTick, trace };
      }
      // Presentation seconds, deterministically, so the world is built and the
      // scatter/roads/terrain are resident before anything is timed.
      await vm.advanceFrames(Math.round(opts.settle * 60));

      const flush = () => vm.screenshot();
      let cameraFrame = 0;
      let lastComputeDispatches = globalThis.__vmScatter?.computeController?.dispatches ?? 0;
      const foliageCompactionMs = [];
      const foliageUploadBytes = [];
      const presentFrames = (count, collectFoliage = false) => {
        // `advanceFrames(n)` advances n presentation steps but deliberately
        // draws only the last one. That is ideal for fixture settling and was
        // disastrously wrong for timing: the old harness divided one draw plus
        // one readback by n. Drive one step per call so every timed frame is
        // actually submitted.
        for (let i = 0; i < count; i++) {
          if (opts.cameraPath === 'pan') {
            // 30 m out-and-back triangle wave at exactly 0.5 m per frame.
            // This crosses 8 m LOD bands and 32 m chunk edges deterministically.
            const phase = cameraFrame % 120;
            const offset = (phase <= 60 ? phase : 120 - phase) * 0.5 - 15;
            vm.focusOn(256 + offset, 256, opts.distance);
          } else if (opts.cameraPath === 'band-churn') {
            // Diagnostic only: force the 8 m CPU cadence boundary each frame.
            vm.focusOn(cameraFrame % 2 === 0 ? 255.9 : 256.1, 256, opts.distance);
          }
          cameraFrame++;
          vm.advanceFrames(1);
          if (collectFoliage) {
            const scatter = globalThis.__vmScatter;
            const dispatches = scatter?.computeController?.dispatches ?? 0;
            const gpuEvent = scatter?.computeMode === 'gpu' && dispatches > lastComputeDispatches;
            const cpuEvent = scatter?.computeMode !== 'gpu' && (scatter?.uploadBytes ?? 0) > 0;
            // Keep both arms at the same scope. The pilot still pays Scatter's
            // CPU compaction/upload cost for the 30 non-owned families, so its
            // event is that residual work plus the compute submission.
            const eventMs = scatter?.computeMode === 'gpu'
              ? (scatter.computeSubmitMs ?? 0) + (scatter.uploadMs ?? 0)
              : scatter?.uploadMs;
            if ((gpuEvent || cpuEvent) && typeof eventMs === 'number') {
              foliageCompactionMs.push(eventMs);
              foliageUploadBytes.push(scatter?.uploadBytes ?? 0);
            }
            lastComputeDispatches = dispatches;
          } else {
            lastComputeDispatches = globalThis.__vmScatter?.computeController?.dispatches ?? 0;
          }
        }
      };

      // Warmup — thrown away. A first frame through a new pipeline is a shader
      // compile, not a frame.
      presentFrames(opts.warmup);
      await flush();

      // Four isolated frames expose the cadence structurally. `half` should
      // alternate between a full shadow pass and no shadow pass even though
      // the deterministic harness advances presentation at 30 Hz.
      const cadenceSamples = [];
      for (let i = 0; i < 4; i++) {
        presentFrames(1);
        // Read synchronously. Yielding here lets the paused screenshot loop
        // inject a dt=0 capture frame, which intentionally forces shadows and
        // hides the deterministic alternation we are trying to prove.
        cadenceSamples.push({ ...vm.rendererHandle.shadowScheduleStats });
      }

      const wall = [];
      const gpuStats = [];
      const gpuPassSamples = [];
      const shadowUpdates = [];
      for (let b = 0; b < opts.blocks; b++) {
        const beforeUpdates = vm.rendererHandle.shadowScheduleStats.updates;
        const t0 = performance.now();
        presentFrames(opts.frames, true);
        shadowUpdates.push(vm.rendererHandle.shadowScheduleStats.updates - beforeUpdates);
        /*
         * STATS BEFORE THE FLUSH. `screenshot()` RENDERS ITS OWN FRAME — that
         * is the whole point of it, so a capture can never read a cleared
         * buffer — and under the node renderer that frame is the pipeline's
         * final full-screen triangle and nothing else, so reading afterwards
         * reported `drawCalls: 1, triangles: 1` for a scene with 151 entities.
         */
        const s = vm.stats();
        await flush();
        const t1 = performance.now();
        wall.push((t1 - t0) / opts.frames);
        gpuStats.push({ frameMs: s.frameMs, cpuMs: s.cpuMs, drawCalls: s.drawCalls, triangles: s.triangles });
      }

      /*
       * Per-pass timestamps need an ordinary complete frame as their newest
       * context. `flush()` deliberately calls vm.screenshot(), whose capture
       * frame can contain only the final full-screen pipeline triangle; reading
       * the timer after it reports grade alone. Reset the timer cadence, submit
       * groups of fifteen real frames, yield for Three's async map, and copy the
       * snapshot before any screenshot/capture work can replace it.
       */
      if (opts.gpuPasses) {
        // Keep timestamp writes entirely out of the wall-time blocks above.
        // Visibility keeps perf.system from deactivating the timer each frame;
        // the harness already hides the UI root, so this paints no panel.
        globalThis.__vmPerf?.setVisible(true);
        let revision = globalThis.__vmPerf?.timer?.passSnapshot?.revision ?? -1;
        /*
         * Enabling timestamp writes changes the command stream and the first
         * resolved snapshot can be either the pre-enable capture frame or a
         * cold instrumented frame. Prime one complete group and discard it so
         * neither case enters the reported distribution.
         */
        presentFrames(30);
        {
          const deadline = performance.now() + 5_000;
          let nextRevision = revision;
          while (nextRevision <= revision && performance.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            nextRevision = globalThis.__vmPerf?.timer?.passSnapshot?.revision ?? revision;
          }
          if (nextRevision <= revision) {
            throw new Error('WebGPU pass timer did not publish its priming snapshot');
          }
          revision = nextRevision;
        }
        for (let sampleIndex = 0; sampleIndex < 5; sampleIndex++) {
          presentFrames(15);
          let nextRevision = revision;
          const deadline = performance.now() + 5_000;
          while (nextRevision <= revision && performance.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            nextRevision = globalThis.__vmPerf?.timer?.passSnapshot?.revision ?? revision;
          }
          if (nextRevision <= revision) {
            throw new Error('WebGPU pass timer did not publish a fresh snapshot after 15 frames');
          }
          revision = nextRevision;
          gpuPassSamples.push({ revision, ...vm.stats().gpuPasses });
        }
        globalThis.__vmPerf?.setVisible(false);
      }

      /*
       * THE CONTENT FINGERPRINT IS READ THE WAY `tools/shoot.mjs` READS IT:
       * `advanceFrames` then `waitFrames`, then `stats()`. Reading straight
       * after `advanceFrames` returned `drawCalls: 1, triangles: 1` on the node
       * path — the pipeline's final full-screen triangle and nothing else —
       * while the shot harness reported 158 / 865 406 for the same fixture.
       */
      await vm.advanceFrames(2);
      await vm.waitFrames(3);
      const s = vm.stats();
      const scatterStats = globalThis.__vmScatter?.stats?.() ?? null;
      let foliageComputeAudit = null;
      if (opts.foliageComputeAudit) {
        const samples = [];
        for (const distance of [24, 62, 116, 62, 24]) {
          vm.focusOn(256, 256, distance);
          vm.advanceFrames(2);
          const audit = await globalThis.__vmScatter?.foliageComputeAudit?.() ?? null;
          samples.push(audit === null ? { distance, available: false } : {
            distance,
            available: true,
            matchesCpuReference: audit.matchesCpuReference,
            duplicateIds: audit.duplicateIds,
            invalidIds: audit.invalidIds,
            gpuVisible: audit.gpu.visibleInstances,
            gpuLods: [audit.gpu.visibleLod0, audit.gpu.visibleLod1, audit.gpu.visibleLod2],
            gpuTriangles: audit.gpu.visibleTriangles,
            gpuShadowTriangles: audit.gpu.visibleShadowTriangles,
            commandCounts: audit.gpu.commands.map((command) => ({
              key: command.key, pass: command.pass, count: command.instanceCount,
            })),
          });
        }
        const scatter = globalThis.__vmScatter;
        let clearing = null;
        const target = scatter?.placements?.find((placement) => (
          placement.alive === true && placement.slot >= 0
          && scatter.types?.[placement.slot]?.computeOwned === true
          && scatter.chunkVisible?.[placement.chunk] !== 0
        ));
        if (scatter !== undefined && target !== undefined) {
          const before = scatter.stats();
          const fingerprint = scatter.placementFingerprint;
          const removed = scatter.clearFootprint(
            target.x - 0.001, target.z - 0.001, target.x + 0.001, target.z + 0.001, 0,
          );
          vm.advanceFrames(2);
          const afterAudit = await scatter.foliageComputeAudit();
          const after = scatter.stats();
          clearing = {
            removed,
            liveDelta: before.props - after.props,
            fingerprintUnchanged: scatter.placementFingerprint === fingerprint,
            storageBytesUnchanged: before.computeStorageBytes === after.computeStorageBytes,
            initialUploadBytesUnchanged:
              before.computeInitialUploadBytes === after.computeInitialUploadBytes,
            matchesCpuReference: afterAudit?.matchesCpuReference ?? false,
            duplicateIds: afterAudit?.duplicateIds ?? -1,
            invalidIds: afterAudit?.invalidIds ?? -1,
          };
        }
        foliageComputeAudit = {
          approachRecede: [24, 62, 116, 62, 24],
          allMatch: samples.every((sample) => sample.available && sample.matchesCpuReference),
          samples,
          clearing,
        };
      }
      let gpuTimestamps = null;
      if (opts.gpuTimestamps && vm.rendererHandle.backend === 'webgpu') {
        const renderer = vm.rendererHandle.node;
        try {
          renderer.backend.trackTimestamp = true;
          presentFrames(4);
          await flush();
          const renderMs = await renderer.resolveTimestampsAsync('render');
          const computeMs = await renderer.resolveTimestampsAsync('compute');
          gpuTimestamps = {
            renderMs: Number.isFinite(renderMs) ? renderMs : null,
            computeMs: Number.isFinite(computeMs) ? computeMs : null,
            combinedMs: Number.isFinite(renderMs) && Number.isFinite(computeMs)
              ? renderMs + computeMs : null,
          };
        } catch (error) {
          gpuTimestamps = { error: String(error) };
        } finally {
          renderer.backend.trackTimestamp = false;
        }
      }
      const shadowOnly = [];
      const drawableRows = [];
      let drawableCount = 0;
      let estimatedColourDraws = 0;
      let estimatedTriangles = 0;
      vm.scene.traverse((object) => {
        if (object.userData?.vmShadowOnly !== true) return;
        shadowOnly.push({
          name: object.name,
          instances: typeof object.count === 'number' ? object.count : 1,
          visible: object.visible,
        });
      });
      vm.scene.traverse((object) => {
        if (object.isMesh !== true || object.geometry == null) return;
        let cursor = object;
        let visible = true;
        while (cursor != null) {
          if (cursor.visible === false) { visible = false; break; }
          cursor = cursor.parent;
        }
        const instances = typeof object.count === 'number' ? object.count : 1;
        if (!visible || instances <= 0) return;
        const groups = Array.isArray(object.material)
          ? Math.max(1, object.geometry.groups?.length ?? 0)
          : 1;
        const vertices = object.geometry.index?.count
          ?? object.geometry.getAttribute?.('position')?.count
          ?? 0;
        const triangles = Math.floor(vertices / 3) * instances;
        drawableCount++;
        estimatedColourDraws += groups;
        estimatedTriangles += triangles * groups;
        drawableRows.push({
          name: object.name || object.type,
          draws: groups,
          multiDraws: typeof object._multiDrawCount === 'number' ? object._multiDrawCount : null,
          batchInstances: Array.isArray(object._instanceInfo) ? object._instanceInfo.length : null,
          triangles,
          instances,
          castShadow: object.castShadow === true,
          shadowOnly: object.userData?.vmShadowOnly === true,
        });
      });
      drawableRows.sort((a, b) => b.draws - a.draws || b.triangles - a.triangles);
      const batchedRows = drawableRows
        .filter((row) => row.multiDraws !== null)
        .sort((a, b) => (b.multiDraws ?? 0) - (a.multiDraws ?? 0));
      const median = (a) => {
        const v = [...a].sort((x, y) => x - y);
        return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
      };
      const percentile = (a, p) => {
        if (a.length === 0) return 0;
        const v = [...a].sort((x, y) => x - y);
        return v[Math.min(v.length - 1, Math.ceil(v.length * p) - 1)];
      };
      const gpuPasses = {};
      for (const id of ['total', 'shadow', 'scene', 'water', 'particles', 'ao', 'gi', 'bloom', 'grade', 'smaa', 'ui']) {
        const values = gpuPassSamples.map((sample) => sample[id])
          .filter((value) => Number.isFinite(value));
        gpuPasses[id] = values.length > 0 ? median(values) : null;
      }
      return {
        backend: vm.rendererHandle.backend,
        gpu: vm.rendererHandle.capabilities.gpu,
        resolution: s.resolution,
        drawCalls: s.drawCalls,
        drawCallsByPass: s.drawCallsByPass,
        triangles: s.triangles,
        trianglesByPass: s.trianglesByPass,
        programs: s.programs,
        entities: s.counters.entities,
        units: s.counters.units,
        foliage: {
          instances: s.counters.propsDrawn ?? 0,
          chunks: s.counters.propChunks ?? 0,
          lod0: s.counters.propLod0 ?? 0,
          lod1: s.counters.propLod1 ?? 0,
          lod2: s.counters.propLod2 ?? 0,
          colourTriangles: s.counters.propTriangles ?? 0,
          shadowTriangles: s.counters.propShadowTriangles ?? 0,
          colourDraws: s.counters.propColourDraws ?? 0,
          shadowDraws: s.counters.propShadowDraws ?? 0,
          uploadKB: s.counters.propUploadKB ?? 0,
          cullMs: s.counters.propCullMs ?? 0,
          uploadMs: s.counters.propUploadMs ?? 0,
          compute: scatterStats === null ? null : {
            mode: scatterStats.computeMode,
            sourceInstances: scatterStats.computeSourceInstances,
            storageBytes: scatterStats.computeStorageBytes,
            initialUploadBytes: scatterStats.computeInitialUploadBytes,
            dispatches: scatterStats.computeDispatches,
            submitMs: scatterStats.computeSubmitMs,
          },
          audit: foliageComputeAudit,
          compactionEvents: {
            count: foliageCompactionMs.length,
            p50Ms: percentile(foliageCompactionMs, 0.5),
            p95Ms: percentile(foliageCompactionMs, 0.95),
            maxMs: percentile(foliageCompactionMs, 1),
            cpuUploadBytesP95: percentile(foliageUploadBytes, 0.95),
          },
        },
        cameraPath: opts.cameraPath,
        structureWear: globalThis.__vmStructureWear ?? null,
        gpuTimestamps,
        gpuPasses,
        gpuPassSamples,
        cadenceSamples,
        shadowUpdates,
        shadowOnly,
        drawables: {
          objects: drawableCount,
          estimatedColourDraws,
          estimatedTriangles,
          batched: batchedRows,
          top: drawableRows.slice(0, 40),
        },
        ramp,
        wallPerFrameBlocks: wall,
        wallPerFrameMs: Math.min(...wall),
        wallMedianMs: median(wall),
        cpuMs: median(gpuStats.map((g) => g.cpuMs)),
        statsFrameMs: median(gpuStats.map((g) => g.frameMs)),
      };
    }, {
      w: W, h: H, frames: FRAMES, blocks: BLOCKS, warmup: WARMUP, settle: SETTLE,
      match: MATCH, simSeconds: SIM_SECONDS, unitTarget: UNIT_TARGET, distance: DISTANCE,
      cameraPath: CAMERA_PATH, gpuTimestamps: GPU_TIMESTAMPS,
      gpuPasses: GPU_PASSES,
      foliageComputeAudit: FOLIAGE_COMPUTE_AUDIT,
    });
    const source = workingTreeEvidence();
    result.evidence = {
      commit: GIT_COMMIT,
      sourceDirty: source.dirty,
      sourceStatus: source.status,
      sourceFingerprintSha256: source.sha256,
      builtCodeFingerprintSha256: builtCodeFingerprint(),
      browser: browser.version(),
      scene: SCENE,
      seed: SEED,
      requestedBackend: gpu,
      postReuse: POST_REUSE,
      postReuseApplied: gpu === 'webgpu',
      baseWear: BASE_WEAR,
      command: process.argv.slice(2),
    };
    if (CAPTURE) {
      // Texture workers complete on wall time, while the deterministic frame
      // driver above can advance several seconds of presentation almost
      // instantly. Give both A/B arms the same real-time completion window and
      // then submit a fresh frame so the capture never compares a placeholder
      // terrain texture in one arm with a resident texture in the other.
      await page.waitForTimeout(15_000);
      const distances = CAPTURE_DISTANCES.length > 0 ? CAPTURE_DISTANCES : [null];
      for (const distance of distances) {
        await page.evaluate(async ({ captureDistance, focusTree }) => {
          let focusX = 256;
          let focusZ = 256;
          if (focusTree) {
            // `Scatter`'s TS-private columns remain ordinary fields in the
            // debug build. Pick the live broadleaf nearest map centre so this
            // framing works on both InstancedMesh and WebGPU BatchedMesh paths.
            const scatter = globalThis.__vmScatter;
            const tree = scatter?.types?.find((type) => type.def.key === 'tree');
            let bestDistance = Number.POSITIVE_INFINITY;
            for (const placement of scatter?.placements ?? []) {
              if (!placement.alive || placement.defIndex !== tree?.defIndex) continue;
              const dx = placement.x - 256;
              const dz = placement.z - 256;
              const distance = dx * dx + dz * dz;
              if (distance >= bestDistance) continue;
              bestDistance = distance;
              focusX = placement.x;
              focusZ = placement.z;
            }
            if (!Number.isFinite(bestDistance)) {
              throw new Error('--focus-tree found no live broadleaf placement');
            }
          }
          if (captureDistance !== null) window.__VM.focusOn(focusX, focusZ, captureDistance);
          await window.__VM.advanceFrames(2);
          await window.__VM.waitFrames(3);
        }, { captureDistance: distance, focusTree: FOCUS_TREE });
        const rung = distance === null ? '' : `.d${distance}`;
        await page.screenshot({ path: join(ROOT, `${CAPTURE}${rung}.${gpu}.png`) });
      }
    }
    return result;
  } finally {
    await browser.close();
  }
}

const out = {};
try {
  for (const gpu of BACKENDS) {
    console.log(`\n> ${gpu} ...`);
    out[gpu] = await measure(gpu);
    console.log(JSON.stringify(out[gpu], null, 2));
  }
} finally {
  server.stop();
}

const a = out.webgl;
const b = out.webgpu;
console.log('\n=== END-TO-END, THE REAL GAME =========================================');
const sample = a ?? b;
console.log(`${MATCH ? `live ${ARMIES}-army match` : `scene ${SCENE}`} seed ${SEED} · ${sample.resolution} · ${FRAMES} frames x ${BLOCKS} blocks`);
console.log(`camera instance culling: ${RENDER_CULL ? 'on' : 'off'}`);
console.log(`shadow cadence: ${SHADOW_CADENCE}`);
console.log(`scatter shadows: ${SCATTER_SHADOW}`);
console.log(`camera distance: ${DISTANCE} m`);
console.log(`camera path: ${CAMERA_PATH}`);
if (FOLIAGE) console.log(`foliage presentation: ${FOLIAGE}`);
if (FOLIAGE_COMPUTE) console.log(`foliage compute: ${FOLIAGE_COMPUTE}`);
if (ART) console.log(`art preset: ${ART}`);
console.log(`post HDR input reuse: ${POST_REUSE}`);
if (MATCH) {
  console.log(`load: ${sample.units} drawn units · peak ${sample.ramp?.peak ?? sample.units} · ${(sample.ramp?.ticks ?? 0) / 30}s simulated`);
  if (UNIT_TARGET > 0 && sample.units < UNIT_TARGET) {
    console.log(`NOTE: target ${UNIT_TARGET} not reached; results are at ${sample.units} drawn units.`);
  }
}
if (a !== undefined && b !== undefined) {
console.log(`${''.padEnd(22)}${'webgl'.padStart(12)}${'webgpu'.padStart(12)}${'ratio'.padStart(10)}`);
const row = (label, x, y, unit = 'ms') => {
  const r = x > 0 ? (y / x).toFixed(3) : 'n/a';
  console.log(`${label.padEnd(22)}${(x.toFixed(2) + unit).padStart(12)}${(y.toFixed(2) + unit).padStart(12)}${r.padStart(10)}`);
};
row('wall / frame (min)', a.wallPerFrameMs, b.wallPerFrameMs);
row('wall / frame (median)', a.wallMedianMs, b.wallMedianMs);
row('stats cpuMs', a.cpuMs, b.cpuMs);
console.log(`${'draw calls'.padEnd(22)}${String(a.drawCalls).padStart(12)}${String(b.drawCalls).padStart(12)}`);
console.log(`${'triangles'.padEnd(22)}${String(a.triangles).padStart(12)}${String(b.triangles).padStart(12)}`);
console.log(`${'programs'.padEnd(22)}${String(a.programs).padStart(12)}${String(b.programs).padStart(12)}`);
console.log(`${'entities'.padEnd(22)}${String(a.entities).padStart(12)}${String(b.entities).padStart(12)}`);
} else {
  console.log(JSON.stringify(sample, null, 2));
}
console.log('wall = advanceFrames block / frame count, GPU flushed once per block.');

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));
  console.log(`> wrote ${JSON_OUT}`);
}

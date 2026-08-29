/**
 * ============================================================================
 * VOLTMARCH — tools/gpu-frame-ab.mjs
 * ============================================================================
 * END-TO-END FRAME TIME, THE REAL GAME, BOTH BACKENDS, ONE RUN.
 *
 *   node tools/gpu-frame-ab.mjs [--scene allied-base] [--size 2560x1440]
 *                               [--frames 60] [--blocks 5] [--no-build]
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
 *   * BLOCKS, AND THE REPORTED FIGURE IS THE MIN OF THE PER-BLOCK MEDIANS.
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
import { writeFileSync } from 'node:fs';

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
const BACKEND = flag('backend', 'both');
const BACKENDS = BACKEND === 'both' ? ['webgl', 'webgpu'] : [BACKEND];
if (BACKENDS.some((gpu) => gpu !== 'webgl' && gpu !== 'webgpu')) {
  throw new Error(`--backend must be webgl, webgpu or both; received "${BACKEND}"`);
}
if (!['adaptive', 'legacy', 'half'].includes(SHADOW_CADENCE)) {
  throw new Error(`--shadow-cadence must be adaptive, legacy or half; received "${SHADOW_CADENCE}"`);
}
if (!['filtered', 'legacy'].includes(SCATTER_SHADOW)) {
  throw new Error(`--scatter-shadow must be filtered or legacy; received "${SCATTER_SHADOW}"`);
}
const FACTION_KEYS = ['allies', 'soviets', 'meridian', 'reclaim'];

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
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(180_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));

    if (MATCH) await seedLiveSetup(page);
    const qs = MATCH
      ? new URLSearchParams({ skipmenu: '1', start: 'base', seed: String(SEED), fog: 'off', tier: 'high' })
      : new URLSearchParams({ shot: SCENE, tier: 'high', seed: String(SEED) });
    if (gpu === 'webgpu') qs.set('gpu', 'webgpu');
    if (!RENDER_CULL) qs.set('rendercull', 'off');
    if (SHADOW_PROXY === 'legacy') qs.set('shadowproxy', 'legacy');
    if (SCATTER_BATCH === 'legacy') qs.set('scatterbatch', 'legacy');
    if (SCATTER_SHADOW === 'legacy') qs.set('scattershadow', 'legacy');
    if (SHADOW_CADENCE !== 'adaptive') qs.set('shadowcadence', SHADOW_CADENCE);
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
      vm.focusOn(256, 256, 62);
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
      const presentFrames = (count) => {
        // `advanceFrames(n)` advances n presentation steps but deliberately
        // draws only the last one. That is ideal for fixture settling and was
        // disastrously wrong for timing: the old harness divided one draw plus
        // one readback by n. Drive one step per call so every timed frame is
        // actually submitted.
        for (let i = 0; i < count; i++) vm.advanceFrames(1);
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
      const shadowUpdates = [];
      for (let b = 0; b < opts.blocks; b++) {
        const beforeUpdates = vm.rendererHandle.shadowScheduleStats.updates;
        const t0 = performance.now();
        presentFrames(opts.frames);
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
       * THE CONTENT FINGERPRINT IS READ THE WAY `tools/shoot.mjs` READS IT:
       * `advanceFrames` then `waitFrames`, then `stats()`. Reading straight
       * after `advanceFrames` returned `drawCalls: 1, triangles: 1` on the node
       * path — the pipeline's final full-screen triangle and nothing else —
       * while the shot harness reported 158 / 865 406 for the same fixture.
       */
      await vm.advanceFrames(2);
      await vm.waitFrames(3);
      const s = vm.stats();
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
      match: MATCH, simSeconds: SIM_SECONDS, unitTarget: UNIT_TARGET,
    });
    if (CAPTURE) {
      // Texture workers complete on wall time, while the deterministic frame
      // driver above can advance several seconds of presentation almost
      // instantly. Give both A/B arms the same real-time completion window and
      // then submit a fresh frame so the capture never compares a placeholder
      // terrain texture in one arm with a resident texture in the other.
      await page.waitForTimeout(15_000);
      await page.evaluate(async () => {
        await window.__VM.advanceFrames(2);
        await window.__VM.waitFrames(3);
      });
      await page.screenshot({ path: join(ROOT, `${CAPTURE}.${gpu}.png`) });
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

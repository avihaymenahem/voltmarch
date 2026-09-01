/**
 * Phase 2-4 realism acceptance harness.
 *
 * Captures the shipping Industrial Grid skirmish at authored day, dusk and
 * night points, then pans the camera without advancing the simulation.  The
 * resulting report is the common baseline for indirect light, environmental
 * composition and contextual-material work.
 *
 *   node tools/realism-baseline.mjs
 *   node tools/realism-baseline.mjs --no-build
 *   node tools/realism-baseline.mjs --baseline=<old-report.json>
 *
 * `dayphase` is an existing critic-only presentation override.  It changes no
 * product feature and, unlike advancing an eight-minute match, lets all three
 * captures reach the exact same simulation tick and checksum.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const argv = process.argv.slice(2);
const value = (name, fallback = '') => {
  const prefix = `--${name}=`;
  return argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};

const GPU = value('gpu', 'webgpu').toLowerCase();
if (GPU !== 'webgl' && GPU !== 'webgpu') throw new Error(`--gpu must be webgl or webgpu, got ${GPU}`);
const NO_BUILD = argv.includes('--no-build');
const HEADED = argv.includes('--headed');
const TARGET_TICK = Number(value('tick', '120'));
if (!Number.isInteger(TARGET_TICK) || TARGET_TICK < 1) throw new Error('--tick must be a positive integer');
const OUT_DIR = resolve(ROOT, value('out', '.codex-artifacts/realism-baseline'));
const BASELINE_PATH = value('baseline');

const VIEWPORT = Object.freeze({ width: 2560, height: 1440 });
const TIER = 'medium';
const PHASES = Object.freeze(['day', 'dusk', 'night']);
// WebGpuTimer resolves one native timestamp batch every 15 rendered frames.
// Space samples beyond that cadence so p95 is built from independent resolves
// rather than counting the same retained snapshot fifteen times.
const GPU_SAMPLE_BLOCKS = 12;
const GPU_SAMPLE_SPACING_FRAMES = 16;
const PAN_METRES = 40;

/** Shipping and rollout gates, kept beside the evidence that evaluates them. */
const THRESHOLDS = Object.freeze({
  colourDrawCallsMax: 130,
  programGrowthAfterWarmupMax: 0,
  simulationHashChangesMax: 0,
  cameraPanGpuP95RatioMax: 1.15,
  bootRegressionPercentMax: 10,
  bootRegressionFloorMs: 250,
  totalGpuRegressionPercentMax: 10,
});

const SETUP = Object.freeze({
  playerFaction: 'allies',
  aiFaction: 'soviets',
  map: 'industrial-grid',
  difficulty: 1,
  personality: -1,
  startingCredits: 10_000,
  speed: 1,
  seed: 7,
  weather: false,
  opponents: [{ faction: 'soviets', difficulty: 1, personality: -1, team: 2 }],
});

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
}

function summarizeGpu(samples) {
  const ids = [...new Set(samples.flatMap((sample) => Object.keys(sample.gpuPasses ?? {})))].sort();
  const passes = {};
  for (const id of ids) {
    const values = samples.map((sample) => sample.gpuPasses?.[id]).filter(Number.isFinite);
    passes[id] = {
      samples: values.length,
      medianMs: quantile(values, 0.5),
      p95Ms: quantile(values, 0.95),
    };
  }
  const totals = samples.map((sample) => {
    const direct = sample.gpuPasses?.total;
    if (Number.isFinite(direct)) return direct;
    // Older timing snapshots may not publish an explicit total. Sum only
    // timed active passes; null means disabled/unavailable, not zero work.
    const values = Object.entries(sample.gpuPasses ?? {})
      .filter(([id, milliseconds]) => id !== 'total' && Number.isFinite(milliseconds))
      .map(([, milliseconds]) => milliseconds);
    return values.length > 0 ? values.reduce((sum, milliseconds) => sum + milliseconds, 0) : null;
  }).filter(Number.isFinite);
  return {
    available: totals.length >= Math.ceil(samples.length * 0.5),
    samples: totals.length,
    totalMedianMs: quantile(totals, 0.5),
    totalP95Ms: quantile(totals, 0.95),
    passes,
  };
}

function stableFrameMs(phase) {
  return phase.boot?.marks?.find((mark) => mark.category === 'app'
    && mark.name === 'first-stable-frame')?.atMs ?? null;
}

function compareAgainst(report, baseline) {
  const checks = [];
  for (const phase of PHASES) {
    const next = report.phases.find((entry) => entry.phase === phase);
    const old = baseline.phases?.find((entry) => entry.phase === phase);
    if (!next || !old) {
      checks.push({ id: `${phase}.comparable`, pass: false, detail: 'phase missing from one report' });
      continue;
    }
    const nextBoot = stableFrameMs(next);
    const oldBoot = stableFrameMs(old);
    if (Number.isFinite(nextBoot) && Number.isFinite(oldBoot)) {
      const allowance = Math.max(
        THRESHOLDS.bootRegressionFloorMs,
        oldBoot * THRESHOLDS.bootRegressionPercentMax / 100,
      );
      checks.push({
        id: `${phase}.boot`,
        pass: nextBoot - oldBoot <= allowance,
        actualDeltaMs: nextBoot - oldBoot,
        allowedDeltaMs: allowance,
      });
    }
    const nextGpu = next.center.gpu.totalP95Ms;
    const oldGpu = old.center?.gpu?.totalP95Ms;
    if (Number.isFinite(nextGpu) && Number.isFinite(oldGpu) && oldGpu > 0) {
      const changePercent = (nextGpu / oldGpu - 1) * 100;
      checks.push({
        id: `${phase}.gpu`,
        pass: changePercent <= THRESHOLDS.totalGpuRegressionPercentMax,
        actualChangePercent: changePercent,
        allowedChangePercent: THRESHOLDS.totalGpuRegressionPercentMax,
      });
    }
  }
  return checks;
}

if (!NO_BUILD) {
  await build(ROOT, { log: console.log });
} else if (!existsSync(join(ROOT, 'apps/game/dist/index.html'))) {
  throw new Error('--no-build was given but apps/game/dist/index.html does not exist');
}

mkdirSync(OUT_DIR, { recursive: true });
const server = await serve({ root: ROOT, mode: 'preview', portHint: 4392, log: console.log });
let browser;

try {
  browser = await chromium.launch({
    headless: !HEADED,
    ...(GPU === 'webgpu' ? { channel: 'chrome' } : {}),
    args: [
      '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
      ...(GPU === 'webgl' ? ['--enable-unsafe-swiftshader'] : []),
      '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio',
      '--force-device-scale-factor=1',
    ],
  });

  const phases = [];
  for (const phase of PHASES) {
    server.assertAlive(phase);
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    page.setDefaultTimeout(180_000);
    const messages = [];
    page.on('console', (message) => messages.push(`[${message.type()}] ${message.text()}`));
    page.on('pageerror', (error) => messages.push(`[pageerror] ${error.stack ?? error.message}`));
    await page.addInitScript((setup) => {
      localStorage.setItem('voltmarch.setup.v1', JSON.stringify(setup));
      localStorage.setItem('voltmarch.settings.v1', JSON.stringify({ graphics: { calibrated: true } }));
    }, SETUP);

    const query = new URLSearchParams({
      bootprofile: '1', skipmenu: '1', start: 'base', seed: String(SETUP.seed),
      // `gpupasses` is the existing read-only diagnostics control that arms
      // the native timer. Reading `__VM.stats().gpuPasses` without it leaves
      // every value null even when timestamp-query is supported.
      tier: TIER, dayphase: phase, gpupasses: '1',
    });
    // WebGPU is the no-query product renderer. Keep only the temporary legacy
    // comparison explicit so normal evidence exercises the player boot path.
    if (GPU === 'webgl') query.set('gpu', 'webgl');
    await page.goto(`${server.origin}?${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('is-hidden'),
      null, { timeout: 120_000 });

    const prepared = await page.evaluate(async ({ targetTick, viewport }) => {
      const vm = window.__VM;
      if (!vm) throw new Error('window.__VM is unavailable');
      vm.pause();
      vm.setUiVisible(false);
      vm.setSize(viewport.width, viewport.height);
      const replay = globalThis.__vmReplay;
      if (!replay?.stats) throw new Error('__vmReplay.stats is unavailable');
      const before = replay.stats();
      if (before.tick > targetTick) {
        throw new Error(`boot reached tick ${before.tick}, beyond target tick ${targetTick}`);
      }
      if (before.tick < targetTick) vm.step(targetTick - before.tick);
      vm.advanceFrames(1);
      await vm.waitFrames(8);
      const scenario = vm.hooks.scenario?.();
      const camera = scenario?.camera ?? { x: 256, z: 256, distance: 62 };
      vm.focusOn(camera.x, camera.z, camera.distance);
      await vm.waitFrames(8);
      return {
        backend: vm.rendererHandle.backend,
        scenario: scenario === null || scenario === undefined ? null : {
          name: scenario.name, map: scenario.map, seed: scenario.seed, camera,
        },
        phase: globalThis.__vmTimeOfDayHud ? { ...globalThis.__vmTimeOfDayHud } : null,
        checksum: replay.stats(),
        boot: vm.hooks.bootReport?.() ?? null,
      };
    }, { targetTick: TARGET_TICK, viewport: VIEWPORT });

    if (prepared.backend !== GPU) throw new Error(`${phase}: requested ${GPU}, got ${prepared.backend}`);
    if (prepared.phase?.phase !== phase) {
      throw new Error(`${phase}: live time-of-day is ${prepared.phase?.phase ?? 'unavailable'}`);
    }
    if (prepared.checksum.tick !== TARGET_TICK) {
      throw new Error(`${phase}: target tick ${TARGET_TICK}, got ${prepared.checksum.tick}`);
    }

    const evidence = await page.evaluate(async ({ sampleBlocks, sampleSpacingFrames, panMetres }) => {
      const vm = window.__VM;
      const replay = globalThis.__vmReplay;
      const scenario = vm.hooks.scenario?.();
      const camera = scenario?.camera ?? { x: 256, z: 256, distance: 62 };
      const sample = async () => {
        const out = [];
        for (let i = 0; i < sampleBlocks; i++) {
          await vm.waitFrames(sampleSpacingFrames);
          out.push(vm.stats());
        }
        return out;
      };

      // Visit both poses once before measuring so lazy pipelines are outside
      // the program-growth gate.
      vm.focusOn(camera.x + panMetres, camera.z, camera.distance);
      await vm.waitFrames(8);
      vm.focusOn(camera.x, camera.z, camera.distance);
      await vm.waitFrames(8);
      const warmPrograms = vm.stats().programs;

      const centerSamples = await sample();
      const centerImage = await vm.screenshot();
      const centerHash = replay.stats();
      vm.focusOn(camera.x + panMetres, camera.z, camera.distance);
      await vm.waitFrames(8);
      const panSamples = await sample();
      const panImage = await vm.screenshot();
      const panHash = replay.stats();
      vm.focusOn(camera.x, camera.z, camera.distance);
      await vm.waitFrames(8);
      const returned = vm.stats();
      const returnedHash = replay.stats();
      return {
        warmPrograms,
        centerSamples,
        panSamples,
        returned,
        checksums: { center: centerHash, pan: panHash, returned: returnedHash },
        images: { center: centerImage, pan: panImage },
      };
    }, {
      sampleBlocks: GPU_SAMPLE_BLOCKS,
      sampleSpacingFrames: GPU_SAMPLE_SPACING_FRAMES,
      panMetres: PAN_METRES,
    });

    for (const pose of ['center', 'pan']) {
      const bytes = Buffer.from(evidence.images[pose].split(',')[1], 'base64');
      writeFileSync(join(OUT_DIR, `${phase}-${pose}.png`), bytes);
    }
    const frameOf = (samples) => {
      const last = samples.at(-1);
      return {
        gpu: summarizeGpu(samples),
        drawCalls: last.drawCalls,
        drawCallsByPass: last.drawCallsByPass,
        triangles: last.triangles,
        programs: last.programs,
        geometries: last.geometries,
        textures: last.textures,
        textureMB: last.textureMB,
      };
    };
    phases.push({
      phase,
      backend: prepared.backend,
      scenario: prepared.scenario,
      timeOfDay: prepared.phase,
      checksum: prepared.checksum,
      checksumsAfterCameraMotion: evidence.checksums,
      boot: prepared.boot,
      center: frameOf(evidence.centerSamples),
      pan: frameOf(evidence.panSamples),
      returned: {
        programs: evidence.returned.programs,
        drawCallsByPass: evidence.returned.drawCallsByPass,
      },
      warmPrograms: evidence.warmPrograms,
      messages,
    });
    await page.close();
    console.log(`  ${phase}: checksum ${prepared.checksum.hash}, `
      + `colour ${phases.at(-1).center.drawCallsByPass.colour}, `
      + `GPU p95 ${phases.at(-1).center.gpu.totalP95Ms ?? 'unavailable'} ms`);
  }

  const report = {
    schema: 1,
    capturedAt: new Date().toISOString(),
    build: { version: VERSION, built: !NO_BUILD },
    fixture: { map: 'industrial-grid', preset: 'urban', seed: SETUP.seed, targetTick: TARGET_TICK },
    renderer: { backend: GPU, tier: TIER, viewport: VIEWPORT },
    thresholds: THRESHOLDS,
    phases,
    checks: [],
  };

  const canonicalHash = phases[0].checksum.hash;
  for (const phase of phases) {
    const hashes = [
      phase.checksum.hash,
      phase.checksumsAfterCameraMotion.center.hash,
      phase.checksumsAfterCameraMotion.pan.hash,
      phase.checksumsAfterCameraMotion.returned.hash,
    ];
    report.checks.push({
      id: `${phase.phase}.simulation-invariance`,
      pass: hashes.every((hash) => hash === canonicalHash),
      hashes,
    });
    report.checks.push({
      id: `${phase.phase}.colour-draw-budget`,
      pass: phase.center.drawCallsByPass.colour <= THRESHOLDS.colourDrawCallsMax
        && phase.pan.drawCallsByPass.colour <= THRESHOLDS.colourDrawCallsMax,
      actual: Math.max(phase.center.drawCallsByPass.colour, phase.pan.drawCallsByPass.colour),
      limit: THRESHOLDS.colourDrawCallsMax,
    });
    const growth = phase.returned.programs - phase.warmPrograms;
    report.checks.push({
      id: `${phase.phase}.program-stability`,
      pass: growth <= THRESHOLDS.programGrowthAfterWarmupMax,
      actualGrowth: growth,
      limit: THRESHOLDS.programGrowthAfterWarmupMax,
    });
    const centerP95 = phase.center.gpu.totalP95Ms;
    const panP95 = phase.pan.gpu.totalP95Ms;
    report.checks.push({
      id: `${phase.phase}.gpu-timing-available`,
      pass: phase.center.gpu.available && phase.pan.gpu.available,
      detail: phase.center.gpu.available && phase.pan.gpu.available
        ? 'timestamp samples available'
        : 'inconclusive: no reliable timestamp-query sample',
    });
    if (Number.isFinite(centerP95) && Number.isFinite(panP95) && centerP95 > 0) {
      report.checks.push({
        id: `${phase.phase}.pan-gpu-stability`,
        pass: panP95 / centerP95 <= THRESHOLDS.cameraPanGpuP95RatioMax,
        actualRatio: panP95 / centerP95,
        limit: THRESHOLDS.cameraPanGpuP95RatioMax,
      });
    }
  }

  if (BASELINE_PATH) {
    const baseline = JSON.parse(readFileSync(resolve(ROOT, BASELINE_PATH), 'utf8'));
    report.comparison = {
      baseline: BASELINE_PATH,
      checks: compareAgainst(report, baseline),
    };
    report.checks.push(...report.comparison.checks);
  }

  report.pass = report.checks.every((check) => check.pass);
  const reportPath = join(OUT_DIR, 'report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.pass ? 'PASS' : 'INCONCLUSIVE/FAIL'} -> ${reportPath}`);
  if (!report.pass) process.exitCode = 2;
} finally {
  await browser?.close();
  server.stop();
}

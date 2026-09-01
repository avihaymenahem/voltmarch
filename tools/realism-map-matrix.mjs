/**
 * Seven-map WebGPU realism acceptance capture.
 *
 *   node tools/realism-map-matrix.mjs
 *   node tools/realism-map-matrix.mjs --no-build
 *   node tools/realism-map-matrix.mjs --map=frozen-sector --no-build
 *
 * Every cell boots the ordinary WebGPU product renderer. The only URL
 * controls are existing critic/diagnostic controls: deterministic start,
 * authored phase/weather selection, boot reporting and read-only counters.
 * There is no product feature gate for irradiance, wear, surface response or
 * semantic composition.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, serve } from './lib/serve.mjs';
import { REALISM_MAP_CELLS, REALISM_MAP_THRESHOLDS } from './lib/realism-map-matrix.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const argv = process.argv.slice(2);
const value = (name, fallback = '') => {
  const prefix = `--${name}=`;
  return argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const NO_BUILD = argv.includes('--no-build');
const HEADED = argv.includes('--headed');
const ONLY_MAP = value('map');
const TARGET_TICK = Number(value('tick', '120'));
const OUT_DIR = resolve(ROOT, value('out', '.codex-artifacts/realism-map-matrix'));
const VIEWPORT = Object.freeze({ width: 1920, height: 1080 });
const PAN_METRES = 40;

if (!Number.isInteger(TARGET_TICK) || TARGET_TICK < 1) throw new Error('--tick must be a positive integer');
const cells = ONLY_MAP === ''
  ? REALISM_MAP_CELLS
  : REALISM_MAP_CELLS.filter((cell) => cell.id === ONLY_MAP);
if (cells.length === 0) throw new Error(`--map must name a shipped map, got ${ONLY_MAP}`);

const baseSetup = Object.freeze({
  playerFaction: 'allies', aiFaction: 'soviets', difficulty: 1, personality: -1,
  startingCredits: 10_000, speed: 1, seed: 7, weather: false,
  opponents: [{ faction: 'soviets', difficulty: 1, personality: -1, team: 2 }],
});

if (!NO_BUILD) {
  await build(ROOT, { log: console.log });
} else if (!existsSync(join(ROOT, 'apps/game/dist/index.html'))) {
  throw new Error('--no-build was given but apps/game/dist/index.html does not exist');
}

mkdirSync(OUT_DIR, { recursive: true });
const server = await serve({ root: ROOT, mode: 'preview', portHint: 4394, log: console.log });
let browser;

try {
  browser = await chromium.launch({
    headless: !HEADED,
    channel: 'chrome',
    args: [
      '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio',
      '--force-device-scale-factor=1',
    ],
  });

  const results = [];
  for (const cell of cells) {
    server.assertAlive(cell.id);
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    page.setDefaultTimeout(180_000);
    const messages = [];
    page.on('console', (message) => messages.push(`[${message.type()}] ${message.text()}`));
    page.on('pageerror', (error) => messages.push(`[pageerror] ${error.stack ?? error.message}`));
    await page.addInitScript(({ setup, map, weather }) => {
      // The shell owns the shipping `weather` query. It preserves the critic's
      // light/heavy selection only when the corresponding lobby toggle is on.
      localStorage.setItem('voltmarch.setup.v1', JSON.stringify({
        ...setup, map, weather: weather !== 'off',
      }));
      localStorage.setItem('voltmarch.settings.v1', JSON.stringify({ graphics: { calibrated: true } }));
    }, { setup: baseSetup, map: cell.id, weather: cell.weather });

    const query = new URLSearchParams({
      bootprofile: '1', skipmenu: '1', start: 'base', seed: String(baseSetup.seed),
      tier: 'medium', gpupasses: '1', weather: cell.weather,
    });
    if (cell.dayPhase !== null) query.set('dayphase', cell.dayPhase);
    await page.goto(`${server.origin}?${query}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.getElementById('loading')?.classList.contains('is-hidden'),
      null,
      { timeout: 150_000 },
    );

    const evidence = await page.evaluate(async ({ targetTick, viewport, panMetres }) => {
      const vm = window.__VM;
      const replay = globalThis.__vmReplay;
      if (!vm || !replay?.stats) throw new Error('acceptance diagnostics are unavailable');
      vm.pause();
      vm.setUiVisible(false);
      vm.setSize(viewport.width, viewport.height);
      const before = replay.stats();
      if (before.tick > targetTick) throw new Error(`boot reached tick ${before.tick}, beyond ${targetTick}`);
      if (before.tick < targetTick) vm.step(targetTick - before.tick);
      vm.advanceFrames(1);
      await vm.waitFrames(8);
      const scenario = vm.hooks.scenario?.();
      const camera = scenario?.camera ?? { x: 256, z: 256, distance: 62 };
      vm.focusOn(camera.x, camera.z, camera.distance);
      await vm.waitFrames(8);
      vm.focusOn(camera.x + panMetres, camera.z, camera.distance);
      await vm.waitFrames(8);
      vm.focusOn(camera.x, camera.z, camera.distance);
      await vm.waitFrames(8);
      const warmPrograms = vm.stats().programs;
      const centerHash = replay.stats();
      const center = vm.stats();
      const image = await vm.screenshot();
      vm.focusOn(camera.x + panMetres, camera.z, camera.distance);
      await vm.waitFrames(8);
      const panHash = replay.stats();
      const pan = vm.stats();
      vm.focusOn(camera.x, camera.z, camera.distance);
      await vm.waitFrames(8);
      const returnedHash = replay.stats();
      const returned = vm.stats();
      return {
        backend: vm.rendererHandle.backend,
        scenario: scenario === null || scenario === undefined ? null : {
          name: scenario.name, map: scenario.map, seed: scenario.seed,
        },
        weather: globalThis.__vmWeatherHud ? { ...globalThis.__vmWeatherHud } : null,
        timeOfDay: globalThis.__vmTimeOfDayHud ? { ...globalThis.__vmTimeOfDayHud } : null,
        structureWear: globalThis.__vmStructureWear ? { ...globalThis.__vmStructureWear } : null,
        semanticContexts: globalThis.__vmSemanticContexts ? { ...globalThis.__vmSemanticContexts } : null,
        boot: vm.hooks.bootReport?.() ?? null,
        stats: {
          warmPrograms,
          center: {
            programs: center.programs, drawCallsByPass: center.drawCallsByPass,
            counters: center.counters,
          },
          pan: { programs: pan.programs, drawCallsByPass: pan.drawCallsByPass },
          returned: { programs: returned.programs, drawCallsByPass: returned.drawCallsByPass },
        },
        checksums: { center: centerHash, pan: panHash, returned: returnedHash },
        image,
      };
    }, { targetTick: TARGET_TICK, viewport: VIEWPORT, panMetres: PAN_METRES });

    const screenshot = Buffer.from(evidence.image.split(',')[1], 'base64');
    writeFileSync(join(OUT_DIR, `${cell.id}.png`), screenshot);
    delete evidence.image;

    const hashes = Object.values(evidence.checksums).map((checksum) => checksum.hash);
    const colourCalls = Math.max(
      evidence.stats.center.drawCallsByPass.colour,
      evidence.stats.pan.drawCallsByPass.colour,
    );
    const programGrowth = evidence.stats.returned.programs - evidence.stats.warmPrograms;
    const counters = evidence.stats.center.counters;
    const checks = [
      { id: 'backend-webgpu', pass: evidence.backend === 'webgpu', actual: evidence.backend },
      {
        id: 'simulation-invariance',
        pass: evidence.checksums.center.tick === TARGET_TICK
          && hashes.every((hash) => hash === hashes[0]),
        hashes,
      },
      {
        id: 'irradiance-field-installed',
        pass: counters.irradianceFieldPixels >= REALISM_MAP_THRESHOLDS.irradianceFieldPixelsMin,
        actual: counters.irradianceFieldPixels ?? 0,
        minimum: REALISM_MAP_THRESHOLDS.irradianceFieldPixelsMin,
        worker: counters.irradianceFieldWorker ?? 0,
      },
      {
        id: 'contextual-structure-wear',
        pass: evidence.structureWear?.mode === 'context'
          && evidence.structureWear.spawned >= REALISM_MAP_THRESHOLDS.structureWearMarksMin
          && evidence.structureWear.fingerprint !== 0,
        actual: evidence.structureWear,
      },
      {
        id: 'weather-cell',
        pass: evidence.weather?.precipitation === cell.precipitation,
        expected: cell.precipitation,
        actual: evidence.weather?.precipitation ?? null,
      },
      {
        id: 'colour-draw-budget',
        pass: colourCalls <= REALISM_MAP_THRESHOLDS.colourDrawCallsMax,
        actual: colourCalls,
        limit: REALISM_MAP_THRESHOLDS.colourDrawCallsMax,
      },
      {
        id: 'program-stability',
        pass: programGrowth <= REALISM_MAP_THRESHOLDS.programGrowthAfterWarmupMax,
        actualGrowth: programGrowth,
        limit: REALISM_MAP_THRESHOLDS.programGrowthAfterWarmupMax,
      },
    ];
    checks.push({
      id: 'semantic-context-and-light',
      pass: evidence.semanticContexts?.active === true
        && evidence.semanticContexts.grammar === cell.preset
        && evidence.semanticContexts.grammarFingerprint !== 0
        && evidence.semanticContexts.spawned > 0
        && evidence.semanticContexts.fingerprint !== 0
        && evidence.semanticContexts.lights > 0
        && evidence.semanticContexts.lightFingerprint !== 0,
      expectedGrammar: cell.preset,
      actual: evidence.semanticContexts,
    });

    results.push({
      cell, evidence, checks,
      pass: checks.every((check) => check.pass),
      messages,
    });
    await page.close();
    console.log(
      `  ${cell.id}: ${results.at(-1).pass ? 'PASS' : 'FAIL'} hash ${hashes[0]}, `
      + `irradiance ${counters.irradianceFieldPixels ?? 0}px, wear ${evidence.structureWear?.spawned ?? 0}, `
      + `contexts ${evidence.semanticContexts?.spawned ?? 0}`,
    );
  }

  const report = {
    schema: 1,
    capturedAt: new Date().toISOString(),
    build: { version: VERSION, built: !NO_BUILD },
    renderer: { backend: 'webgpu', tier: 'medium', viewport: VIEWPORT },
    targetTick: TARGET_TICK,
    thresholds: REALISM_MAP_THRESHOLDS,
    results,
    pass: results.every((result) => result.pass),
  };
  const reportPath = join(OUT_DIR, 'report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.pass ? 'PASS' : 'FAIL'} -> ${reportPath}`);
  if (!report.pass) process.exitCode = 2;
} finally {
  await browser?.close();
  server.stop();
}

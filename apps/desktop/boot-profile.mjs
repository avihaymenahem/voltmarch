#!/usr/bin/env node

/** Repeatable production-app:// boot capture in a real Electron process. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};
const runs = Number(option('runs', '5'));
const out = path.resolve(root, option('out', 'artifacts/perf/boot-baseline-electron-webgpu.json'));
const rawOutArg = option('raw-out', '');
const rawOut = rawOutArg === '' ? '' : path.resolve(root, rawOutArg);
const noBuild = argv.includes('--no-build');
const FIXTURE = Object.freeze({
  gpu: 'webgpu',
  map: 'temperate-valley',
  seed: 7,
  mapSeed: 0x7e44a1,
  start: 'base',
});
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');

if (!noBuild) {
  const gameBuild = spawnSync('npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (gameBuild.status !== 0) throw new Error('game renderer build failed');
  const desktopBuild = spawnSync('npm', ['--workspace', '@voltmarch/desktop', 'run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (desktopBuild.status !== 0) throw new Error('desktop build failed');
}

const gameDist = path.join(root, 'apps', 'game', 'dist');
if (!existsSync(path.join(gameDist, 'index.html'))) {
  throw new Error('apps/game/dist is missing; run without --no-build to create the renderer');
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(target) : [target];
    })
    .sort((a, b) => a.localeCompare(b));
}

function rendererFingerprint() {
  const hash = createHash('sha256');
  for (const file of filesBelow(gameDist)) {
    const relative = path.relative(gameDist, file).replaceAll('\\', '/');
    const size = statSync(file).size;
    hash.update(`${relative}\0${size}\0`);
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function gitOutput(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

const buildIdentity = {
  gitHead: gitOutput(['rev-parse', 'HEAD']),
  workingTreeDirty: (gitOutput(['status', '--porcelain']) ?? '') !== '',
  gameDistSha256: rendererFingerprint(),
};

const rootRequire = createRequire(path.join(root, 'package.json'));
const deskRequire = createRequire(path.join(here, 'package.json'));
const { _electron: electron } = rootRequire('playwright');
const electronExe = deskRequire('electron');
const samples = [];

for (let run = 0; run < runs; run++) {
  const profile = mkdtempSync(path.join(tmpdir(), 'voltmarch-boot-profile-'));
  const started = Date.now();
  const app = await electron.launch({
    args: [
      '.',
      `--user-data-dir=${profile}`,
      '--vm-bootprofile=1',
      '--vm-skipmenu=1',
      `--vm-gpu=${FIXTURE.gpu}`,
      `--vm-map=${FIXTURE.map}`,
      `--vm-seed=${FIXTURE.seed}`,
      `--vm-start=${FIXTURE.start}`,
    ],
    cwd: here,
    executablePath: electronExe,
    env: { ...process.env, VM_DESKTOP_USER_DATA: profile },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(
      () => document.getElementById('loading')?.hidden === true,
      null,
      { timeout: 120_000 },
    );
    const processCurtainHiddenMs = Date.now() - started;
    // Let the task that published the true hidden boundary fully settle before export.
    await page.waitForTimeout(50);
    const observation = await page.evaluate(() => ({
      boot: window.__VM?.hooks?.bootReport?.() ?? null,
      backend: window.__VM?.rendererHandle?.backend ?? null,
      userAgent: navigator.userAgent,
      url: location.href,
    }));
    if (observation.boot?.enabled !== true) throw new Error('desktop boot telemetry is not enabled');
    const context = observation.boot.runs.at(-1)?.context;
    const observedQuery = new URL(observation.url).searchParams;
    if (
      observation.backend !== FIXTURE.gpu
      || context?.scenario !== FIXTURE.map
      || context.seed !== FIXTURE.seed
      || observedQuery.get('mapseed') !== String(FIXTURE.mapSeed)
      || observedQuery.get('start') !== FIXTURE.start
    ) {
      throw new Error(`desktop boot fixture drifted: ${JSON.stringify({ context, url: observation.url })}`);
    }
    const stable = observation.boot.marks.find(
      (mark) => mark.category === 'app' && mark.name === 'first-stable-frame',
    );
    if (stable === undefined) throw new Error('desktop boot has no first-stable-frame mark');
    const rendererReadyMs = stable.atMs;
    samples.push({
      run,
      rendererReadyMs,
      processCurtainHiddenMs,
      environment: {
        runtime: 'electron-app-protocol',
        processState: 'fresh-electron-process-and-profile',
        backend: observation.backend,
        userAgent: observation.userAgent,
        bootRun: observation.boot.runs.at(-1)?.context ?? null,
      },
      boot: observation.boot,
    });
    console.log(
      `  run ${run + 1}/${runs}: renderer ${rendererReadyMs.toFixed(1)} ms, `
      + `process ${processCurtainHiddenMs.toFixed(1)} ms (${observation.backend})`,
    );
  } finally {
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function spanTotals(sample) {
  const totals = {};
  for (const span of sample.boot.spans) {
    const key = `${span.category}.${span.name}`;
    totals[key] = (totals[key] ?? 0) + span.durationMs;
  }
  return totals;
}

function resourceTotals(sample) {
  return sample.boot.resources.reduce((totals, resource) => ({
    count: totals.count + 1,
    transferBytes: totals.transferBytes + resource.transferSize,
    decodedBytes: totals.decodedBytes + resource.decodedBodySize,
    protocolOpenTimingCount: totals.protocolOpenTimingCount
      + (resource.serverTiming.some((timing) => timing.name === 'vm_protocol_open') ? 1 : 0),
  }), { count: 0, transferBytes: 0, decodedBytes: 0, protocolOpenTimingCount: 0 });
}

function compactSample(sample) {
  return {
    run: sample.run,
    rendererReadyMs: sample.rendererReadyMs,
    processCurtainHiddenMs: sample.processCurtainHiddenMs,
    environment: sample.environment,
    phasesMs: spanTotals(sample),
    resources: resourceTotals(sample),
    marks: sample.boot.marks.filter((mark) => mark.category === 'app'),
    truncated: sample.boot.truncated,
  };
}

const report = {
  schema: 1,
  runtime: 'electron-app-protocol',
  state: 'fresh-electron-process-and-profile',
  runs,
  fixture: {
    ...FIXTURE,
    process: 'fresh-electron-process-and-profile-per-sample',
  },
  buildIdentity,
  rendererReadyMedianMs: median(samples.map((sample) => sample.rendererReadyMs)),
  rendererReadyP95Ms: p95(samples.map((sample) => sample.rendererReadyMs)),
  processCurtainHiddenMedianMs: median(samples.map((sample) => sample.processCurtainHiddenMs)),
  processCurtainHiddenP95Ms: p95(samples.map((sample) => sample.processCurtainHiddenMs)),
  samples: samples.map(compactSample),
};
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
if (rawOut !== '') {
  mkdirSync(path.dirname(rawOut), { recursive: true });
  writeFileSync(rawOut, `${JSON.stringify({ ...report, samples }, null, 2)}\n`);
}
console.log(`-> ${path.relative(root, out)}`);

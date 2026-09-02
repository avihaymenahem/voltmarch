#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { root, buildPoc, hash } from './build.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const rounds = Number(option('--rounds', '6'));
const jobs = Number(option('--jobs', '3'));
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 12 || !Number.isInteger(jobs) || jobs < 2 || jobs > 20) throw new Error('Require 1..12 rounds and 2..20 jobs');
const base = path.join(root, '.turbo/asset-prep-poc');
await mkdir(base, { recursive: true });
const runDir = await mkdtemp(path.join(base, 'run-'));
console.log(`POC evidence: ${runDir}`);
const build = path.join(runDir, 'build');
const provenance = await buildPoc(build);
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const electron = require('electron');
const trials = [];
const orders = [['main', 'worker', 'utility'], ['utility', 'worker', 'main'], ['worker', 'main', 'utility'], ['utility', 'main', 'worker'], ['main', 'utility', 'worker'], ['worker', 'utility', 'main']];
for (let round = 0; round < rounds; round++) {
  for (const arm of orders[round % orders.length]) {
    const cell = path.join(runDir, `${round}-${arm}`);
    await mkdir(path.join(cell, 'profile'), { recursive: true });
    const config = { root, build, inputs: provenance.inputs, arm, jobs, profile: path.join(cell, 'profile'), result: path.join(cell, 'result.json'), captureDir: cell };
    const configPath = path.join(cell, 'config.json');
    await writeFile(configPath, JSON.stringify(config));
    const status = await new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(electron, [path.join(build, 'main.cjs'), `--poc-config=${configPath}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const watchdog = setTimeout(() => { child.kill(); reject(new Error('Electron cell deadline exceeded')); }, 150_000);
      child.stdout.on('data', b => process.stdout.write(b));
      child.stderr.on('data', b => process.stderr.write(b));
      child.on('error', reject);
      child.on('exit', code => { clearTimeout(watchdog); resolve(code); });
    });
    const result = JSON.parse(await readFile(config.result, 'utf8'));
    if (status !== 0 || result.error || result.failures.length) throw new Error(`Failed ${round}/${arm}: ${JSON.stringify(result)}`);
    trials.push({ round, ...result });
    await writeFile(path.join(runDir, 'partial.json'), JSON.stringify(trials, null, 2));
  }
}
const reference = JSON.stringify(trials[0].samples[0].fingerprint);
for (const trial of trials) {
  if (JSON.stringify(trial.adapter) !== JSON.stringify(trials[0].adapter)) throw new Error('GPU adapter drift');
  for (const s of trial.samples) if (JSON.stringify(s.fingerprint) !== reference) throw new Error('Cross-arm geometry parity failed');
}
const captures = {};
for (const name of ['lod0', 'lod1', 'lod2', 'shadow']) {
  let referencePixels;
  const hashes = [];
  for (const trial of trials) {
    const filename = path.join(runDir, `${trial.round}-${trial.arm}`, `${trial.arm}-${name}.png`);
    const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== 1280 || info.height !== 720) throw new Error('Capture viewport mismatch');
    if (referencePixels && !referencePixels.equals(data)) throw new Error(`Pixel parity failed: ${trial.round}/${trial.arm}/${name}`);
    referencePixels = data;
    hashes.push(hash(data));
  }
  captures[name] = { width: 1280, height: 720, samples: hashes.length, allPixelsExact: true, rgbaSha256: hashes[0] };
}
const percentile = (numbers, fraction) => [...numbers].sort((a, b) => a - b)[Math.max(0, Math.ceil(numbers.length * fraction) - 1)];
const summarize = values => ({ p50: percentile(values, 0.5), p95: percentile(values, 0.95), min: Math.min(...values), max: Math.max(...values) });
const summary = {};
for (const arm of ['main', 'worker', 'utility']) {
  summary[arm] = {};
  for (const state of ['fresh-helper-and-process', 'reused-helper-fresh-assets']) {
    const rows = trials.filter(t => t.arm === arm).flatMap(t => t.samples).filter(s => s.state === state);
    const metrics = {};
    for (const key of ['helperStartupMs', 'loadMs', 'snapshotMs', 'computeMs', 'conditioningMs', 'roundTripMs', 'hydrateMs', 'geometryReadyMs', 'renderMs', 'firstRenderMs']) metrics[key] = summarize(rows.map(s => s[key]));
    metrics.maxFrameGapMs = summarize(rows.map(s => Math.max(0, ...s.scheduling.frameGaps)));
    metrics.maxTimerGapMs = summarize(rows.map(s => Math.max(0, ...s.scheduling.timerGaps)));
    metrics.frameGapMs = summarize(rows.flatMap(s => s.scheduling.frameGaps));
    metrics.peakWorkingSetMiB = summarize(rows.map(s => s.memoryAfter.peakSummedWorkingSetKiB / 1024));
    metrics.disposedWorkingSetMiB = summarize(rows.map(s => s.memoryDisposed.summedWorkingSetKiB / 1024));
    summary[arm][state] = { samples: rows.length, metrics, longTasks: rows.reduce((n, s) => n + s.scheduling.longTasks.length, 0), gapsOver50ms: rows.reduce((n, s) => n + s.scheduling.frameGaps.filter(v => v > 50).length, 0), gapsOver100ms: rows.reduce((n, s) => n + s.scheduling.frameGaps.filter(v => v > 100).length, 0) };
  }
}
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
const report = { schema: 1, measuredAt: new Date().toISOString(), scope: 'Isolated real-Electron WebGPU family benchmark; conditioning placement only, not game boot or production material readiness', gitHead: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '', host: { platform: process.platform, release: os.release(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() }, provenance, rounds, jobs, runDir, coldPolicy: 'Fresh Electron/userData per arm/round; OS file and driver caches uncontrolled. Reused helper but freshly parsed assets and fresh KTX2 pool per subsequent job.', memoryCaveat: '50 ms samples of summed process working sets may double-count shared pages and miss peaks. Post-dispose observations can still retain JS references and helper heaps; not leak/soak evidence.', transferPolicy: { worker: 'Owned input snapshot and transferable buffers in both directions', utility: 'Owned input snapshot plus structured-clone typed-array copies in BOTH directions; native endpoints transfer ports only' }, parity: { allGeometryExact: true, fingerprintSha256: hash(reference), captures }, summary, trials };
await writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: path.join(runDir, 'report.json'), summary }, null, 2));

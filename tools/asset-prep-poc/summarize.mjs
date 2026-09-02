#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './build.mjs';

// Retain all sample timings and per-job stall maxima without bulky repeated geometry/OS rows.
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node tools/asset-prep-poc/summarize.mjs <report.json> <compact.json>');
const report = JSON.parse(await readFile(input, 'utf8'));
if (report.trials.length !== report.rounds * 3 || !report.parity.allGeometryExact) throw new Error('Incomplete or failed benchmark');
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
const samples = report.trials.flatMap(t => t.samples.map(s => {
  const { scheduling, memoryBefore, memoryAfter, memoryDisposed, fingerprint, auxiliaryMemory, ...timings } = s;
  return {
    round: t.round, arm: t.arm, ...timings,
    frameGaps: { count: scheduling.frameGaps.length, p50: percentile(scheduling.frameGaps, 0.5), p95: percentile(scheduling.frameGaps, 0.95), max: Math.max(...scheduling.frameGaps), over50ms: scheduling.frameGaps.filter(v => v > 50).length, over100ms: scheduling.frameGaps.filter(v => v > 100).length },
    timerGaps: { max: Math.max(...scheduling.timerGaps) },
    longTasks: scheduling.longTasks,
    memory: { beforeSummedWorkingSetMiB: memoryBefore.summedWorkingSetKiB / 1024, peakSummedWorkingSetMiB: memoryAfter.peakSummedWorkingSetKiB / 1024, afterSummedWorkingSetMiB: memoryAfter.summedWorkingSetKiB / 1024, postDisposeSummedWorkingSetMiB: memoryDisposed.summedWorkingSetKiB / 1024, auxiliary: auxiliaryMemory },
  };
}));
const paired = [];
for (let round = 0; round < report.rounds; round++) {
  for (const state of ['fresh-helper-and-process', 'reused-helper-fresh-assets']) {
    const median = (arm, key) => percentile(samples.filter(s => s.round === round && s.arm === arm && s.state === state).map(s => s[key]), 0.5);
    for (const arm of ['worker', 'utility']) {
      const differences = {};
      for (const key of ['conditioningMs', 'geometryReadyMs', 'firstRenderMs']) {
        const controlMs = median('main', key);
        const candidateMs = median(arm, key);
        differences[key] = { controlMs, candidateMs, deltaMs: candidateMs - controlMs, improvementPercent: (controlMs - candidateMs) / controlMs * 100 };
      }
      paired.push({ round, state, arm, differences });
    }
  }
}
const { trials, ...metadata } = report;
const compact = { ...metadata, runDir: path.relative(root, report.runDir).replaceAll('\\', '/'), rawReport: path.relative(root, path.resolve(input)).replaceAll('\\', '/'), samplePercentilePolicy: 'Nearest rank. With n=6 cold/n=12 reused, p95 is the observed maximum, not a population estimate. Per-round reused comparisons use the lower median of the two reused jobs.', adapter: trials[0].adapter, versions: trials[0].versions, geometryFingerprint: trials[0].samples[0].fingerprint, allRunsSuccessful: trials.every(t => !t.error && !t.failures.length && !t.gpuErrors.length), samples, paired };
await mkdir(path.dirname(path.resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify(compact, null, 2));
console.log(`Saved ${samples.length} samples and ${paired.length} matched comparisons to ${path.resolve(output)}`);

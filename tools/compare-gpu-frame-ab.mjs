#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const [, , baselinePath, candidatePath] = process.argv;
if (!baselinePath || !candidatePath) {
  throw new Error('usage: node tools/compare-gpu-frame-ab.mjs <baseline.json> <candidate.json>');
}

const readReports = (paths) => paths.split(',').map((path) => (
  JSON.parse(readFileSync(path.trim(), 'utf8'))
));
const baselines = readReports(baselinePath);
const candidates = readReports(candidatePath);
const RESAMPLES = 200_000;
const SEED = 0x5ca77e;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) * 0.5
    : sorted[mid];
}

function compareBlocks(before, after) {
  if (before.length !== after.length || before.length < 5) {
    throw new Error('A/B reports need equal block counts of at least five');
  }
  let state = SEED;
  const random = () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const deltas = new Float64Array(RESAMPLES);
  for (let sample = 0; sample < RESAMPLES; sample++) {
    const beforeSample = [];
    const afterSample = [];
    for (let i = 0; i < before.length; i++) {
      beforeSample.push(before[Math.floor(random() * before.length)]);
      afterSample.push(after[Math.floor(random() * after.length)]);
    }
    deltas[sample] = (median(afterSample) / median(beforeSample) - 1) * 100;
  }
  deltas.sort();
  const beforeMedian = median(before);
  const afterMedian = median(after);
  return {
    blocks: before.length,
    baselineMedianMs: beforeMedian,
    candidateMedianMs: afterMedian,
    deltaPercent: (afterMedian / beforeMedian - 1) * 100,
    bootstrap: {
      seed: `0x${SEED.toString(16)}`,
      resamples: RESAMPLES,
      confidence: 0.95,
      intervalPercent: [
        deltas[Math.floor(RESAMPLES * 0.025)],
        deltas[Math.floor(RESAMPLES * 0.975)],
      ],
    },
  };
}

const result = {};
for (const backend of ['webgl', 'webgpu']) {
  const before = baselines.flatMap((report) => report[backend]?.wallPerFrameBlocks ?? []);
  const after = candidates.flatMap((report) => report[backend]?.wallPerFrameBlocks ?? []);
  if (before.length === 0 && after.length === 0) continue;
  result[backend] = compareBlocks(before, after);
}
if (Object.keys(result).length === 0) throw new Error('reports share no WebGL/WebGPU block arrays');
console.log(JSON.stringify(result, null, 2));

/**
 * ============================================================================
 * VOLTMARCH — tools/bloom-hdr-ab/profile.mjs
 * ============================================================================
 * WHAT A PASS DID, BINNED BY THE EDGE STRENGTH IT FOUND.
 *
 *   node tools/bloom-hdr-ab/profile.mjs tools/bloom-hdr-ab/out <fixture> smaa
 *   node tools/bloom-hdr-ab/profile.mjs tools/bloom-hdr-ab/out <fixture> ao
 *
 * Reads PNGs `tools/bloom-hdr-ab.mjs` already captured — no GPU, no browser.
 *
 * WHY BINNING IS THE WHOLE INSTRUMENT. A whole-frame mean cannot tell
 * antialiasing from a blur, and it cannot tell a pass that ran from a pass that
 * returned its input, because the dither floor moves ~1/255 everywhere either
 * way. Binned by the pre-pass |laplacian| the two are unmistakable: real
 * edge-directed AA leaves the flat bins at the noise floor and moves the top
 * bin by ten levels, while an inert pass moves every bin by the same ~1.
 *
 * That is what found the SMAA defect in `RENDER_FINDINGS.md` §7g: the WebGL arm
 * read 1.0 / 1.0 / 1.0 / 1.0 / 1.0 / 0.99 across the six bins, which is a flat
 * line and not an effect.
 * ============================================================================
 */

import sharp from 'sharp';
import path from 'node:path';

const DIR = process.argv[2];
const FIX = process.argv[3] ?? '03-terrain-closeup';
const L = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function load(file) {
  const { data, info } = await sharp(path.join(DIR, file)).raw().ensureAlpha()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const y = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) y[p] = L(data[i], data[i + 1], data[i + 2]);
  return { y, w, h, data };
}

function lapField(im) {
  const { y, w, h } = im;
  const out = new Float32Array(w * h);
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const p = j * w + i;
      out[p] = Math.abs(4 * y[p] - y[p - 1] - y[p + 1] - y[p - w] - y[p + w]);
    }
  }
  return out;
}

/** Where does a pass change pixels? Binned by pre-pass |laplacian|. */
async function profile(arm, before0, after0) {
  const before = await load(`${FIX}--${arm}--${before0}.png`);
  const after = await load(`${FIX}--${arm}--${after0}.png`);
  const lap = lapField(before);
  const lapA = lapField(after);
  const bins = [0, 2, 5, 10, 20, 40, 1e9];
  const n = bins.length - 1;
  const count = new Float64Array(n);
  const changed = new Float64Array(n);
  const absDelta = new Float64Array(n);
  const lapBefore = new Float64Array(n);
  const lapAfter = new Float64Array(n);
  for (let p = 0; p < lap.length; p++) {
    let b = 0;
    while (b < n - 1 && lap[p] >= bins[b + 1]) b++;
    count[b]++;
    const d = Math.abs(after.y[p] - before.y[p]);
    if (d > 0.5) changed[b]++;
    absDelta[b] += d;
    lapBefore[b] += lap[p];
    lapAfter[b] += lapA[p];
  }
  console.log(`\n  ${arm}: ${before0} -> ${after0}, binned by pre-pass |laplacian|`);
  console.log('    bin          %frame   %changed  mean|dY|  lap before -> after');
  for (let b = 0; b < n; b++) {
    if (count[b] === 0) continue;
    console.log(
      `    ${String(bins[b]).padStart(3)}..${String(bins[b + 1] === 1e9 ? 'inf' : bins[b + 1]).padEnd(4)} ` +
      `${((count[b] / lap.length) * 100).toFixed(2).padStart(7)}% ` +
      `${((changed[b] / count[b]) * 100).toFixed(2).padStart(9)}% ` +
      `${(absDelta[b] / count[b]).toFixed(3).padStart(9)}   ` +
      `${(lapBefore[b] / count[b]).toFixed(2)} -> ${(lapAfter[b] / count[b]).toFixed(2)}`,
    );
  }
}

/** Per-channel signed mean of `after - before`. A chromatic AO term shows here. */
async function channels(arm, before0, after0) {
  const a = await load(`${FIX}--${arm}--${before0}.png`);
  const b = await load(`${FIX}--${arm}--${after0}.png`);
  const s = [0, 0, 0];
  const n = a.data.length / 4;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) s[c] += b.data[i + c] - a.data[i + c];
  }
  console.log(`  ${arm.padEnd(7)} dR ${(s[0] / n).toFixed(3).padStart(8)}  dG ${(s[1] / n).toFixed(3).padStart(8)}  dB ${(s[2] / n).toFixed(3).padStart(8)}`);
}

const MODE = process.argv[4] ?? 'smaa';
if (MODE === 'smaa') {
  await profile('webgl', 'grade-only', 'grade-smaa');
  await profile('webgpu', 'grade-only', 'grade-smaa');
} else if (MODE === 'ao') {
  await profile('webgl', 'grade-only', 'ao-grade');
  await profile('webgpu', 'grade-only', 'ao-grade');
  console.log('\n  AO per-channel signed mean (ao-grade - grade-only), /255');
  await channels('webgl', 'grade-only', 'ao-grade');
  await channels('webgpu', 'grade-only', 'ao-grade');
}

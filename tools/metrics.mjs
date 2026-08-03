/**
 * Grade probe — turns the measurable half of the RA3 scorecard into numbers.
 *
 *   node tools/metrics.mjs shots/*.png            # measure our renders
 *   node tools/metrics.mjs --baseline refs/ra3steam_*.jpg
 *   node tools/metrics.mjs --compare shots/01-establishing-base.png
 *
 * Why this exists: docs/RA3_LOOK_BIBLE.md §14 R2 predicts the single most likely
 * failure — the scene drifts bright, flat and grey-green ("generic mobile RTS")
 * while everyone insists it looks fine. Opinions cannot catch that; a median
 * luminance of 0.48 against a target of 0.317 catches it instantly.
 *
 * So the visual critics get both: the reference image side by side AND the
 * delta on every metric the bible put a number on.
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// RA_ROOT lets the probe run from a scratch copy while the repo is busy.
const ROOT = process.env.RA_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'docs', 'grade-baseline.json');

/*
 * Targets from docs/RA3_LOOK_BIBLE.md §13.
 *
 * IMPORTANT — measurement frame. The bible quotes luminance in *perceptual*
 * (sRGB/gamma) space: "median frame luminance 0.317". Measured in *linear*
 * space the same frames read 0.104, because 0.317 sRGB == 0.084 linear. The
 * bible's own §0.1 says never to mix the two frames, so every luminance metric
 * here is sRGB-encoded to match the numbers it is checked against.
 *
 * `baselineKey` marks metrics where the observed RA3 distribution is a better
 * target than the asserted one, and the band is widened to the reference spread
 * at runtime. Two cases matter:
 *   - edgeCoverage: the bible's 28-46% is measured on unit/building crops; a
 *     whole-frame RA3 render measures 0.47-0.87. Not comparable, so we take the
 *     observed whole-frame band.
 *   - vignetteRatio: the references span 0.25-1.42 because they are marketing
 *     shots with wildly different composition. Too content-dependent to gate on.
 */
const TARGETS = {
  medianLuminance:   { range: [0.26, 0.40], w: 3, check: 4,  label: 'Frame median luminance (sRGB)', baselineKey: true },
  meanSaturation:    { range: [0.42, 0.80], w: 3, check: 5,  label: 'Mean HSV saturation' },
  vividPixelFrac:    { range: [0.35, 1.00], w: 3, check: 5,  label: 'Fraction S>0.35 & V>0.25' },
  p1Luminance:       { range: [0.00, 0.25], w: 3, check: 6,  label: 'p1 luminance, blacks not lifted (sRGB)' },
  p99Luminance:      { range: [0.90, 1.00], w: 3, check: 6,  label: 'p99 luminance, highlights reach (sRGB)' },
  greenHueLeak:      { range: [0.00, 0.02], w: 3, check: 9,  label: 'Fraction at hue 100-120 (amateur emerald green)' },
  farNearSatDelta:   { range: [-0.05, 1.0], w: 3, check: 12, label: 'Far minus near saturation (no fog/haze)' },
  edgeCoverage:      { range: [0.20, 0.46], w: 2, check: 34, label: 'Sobel |grad|>25 coverage (detail density)', baselineKey: true },
  satLumMonotonic:   { range: [1, 1],       w: 2, check: 20, label: 'Saturation falls as luminance rises (ACES shoulder)' },
  vignetteRatio:     { range: [0.00, 2.00], w: 0, check: 37, label: 'Corner/centre luminance (informational only)' },
  chromaticAber:     { range: [0.00, 1.00], w: 0, check: 36, label: 'R/B edge misregistration (informational only)' },
};

/** Widen a target to the observed RA3 spread when the reference disagrees with the asserted band. */
function resolveRange(key, target, baseline) {
  if (!target.baselineKey || !baseline?.metrics?.[key]) return target.range;
  const b = baseline.metrics[key];
  // p25..p75 of the references, padded by half the interquartile spread.
  const pad = Math.max((b.p75 - b.p25) * 0.5, 0.02);
  return [Math.max(0, b.p25 - pad), b.p75 + pad];
}

/* ------------------------------------------------------------------ */

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

async function measure(file) {
  const img = sharp(file).removeAlpha();
  const { width: W, height: H } = await img.metadata();
  const buf = await img.raw().toBuffer();

  const n = W * H;
  const lum = new Float32Array(n);
  const sat = new Float32Array(n);
  const val = new Float32Array(n);

  let satSum = 0, vivid = 0, greenLeak = 0;
  // Top 25% of frame = far field, bottom 25% = near field (§13 #12).
  let farSat = 0, farN = 0, nearSat = 0, nearN = 0;
  const farCut = H * 0.25, nearCut = H * 0.75;

  // 8 luminance buckets for the saturation-vs-luminance curve (§13 #20).
  const bucketSat = new Float64Array(8), bucketN = new Float64Array(8);

  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const R = buf[p], G = buf[p + 1], B = buf[p + 2];
    // sRGB-encoded luminance — the frame the bible's numbers are quoted in.
    const L = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
    const [h, s, v] = rgbToHsv(R / 255, G / 255, B / 255);

    lum[i] = L; sat[i] = s; val[i] = v;
    satSum += s;
    if (s > 0.35 && v > 0.25) vivid++;
    // The #1 amateur tell: grass that is emerald instead of RA3's yellow-olive.
    if (h >= 100 && h <= 120 && s > 0.25 && v > 0.15) greenLeak++;

    const y = (i / W) | 0;
    if (y < farCut) { farSat += s; farN++; }
    else if (y > nearCut) { nearSat += s; nearN++; }

    const b = Math.min(7, (L * 8) | 0);
    bucketSat[b] += s; bucketN[b]++;
  }

  const sorted = Float32Array.from(lum).sort();
  const pct = (q) => sorted[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];

  // Sobel edge coverage — proxy for greeble/detail density.
  let edges = 0;
  const gray = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 3) gray[i] = (buf[p] * 0.299 + buf[p + 1] * 0.587 + buf[p + 2] * 0.114) | 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1] + gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1];
      const gy = -gray[i - W - 1] - 2 * gray[i - W] - gray[i - W + 1] + gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1];
      if (Math.hypot(gx, gy) > 25) edges++;
    }
  }

  // Vignette: mean luminance of the four corner boxes vs the centre box.
  const boxMean = (x0, y0, x1, y1) => {
    let s = 0, c = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += lum[y * W + x]; c++; }
    return s / c;
  };
  const bw = (W * 0.12) | 0, bh = (H * 0.12) | 0;
  const corners = (boxMean(0, 0, bw, bh) + boxMean(W - bw, 0, W, bh) + boxMean(0, H - bh, bw, H) + boxMean(W - bw, H - bh, W, H)) / 4;
  const centre = boxMean((W / 2 - bw / 2) | 0, (H / 2 - bh / 2) | 0, (W / 2 + bw / 2) | 0, (H / 2 + bh / 2) | 0);

  // Saturation should fall as luminance rises (ACES shoulder desaturates highlights).
  const curve = Array.from({ length: 8 }, (_, i) => (bucketN[i] > n * 0.002 ? bucketSat[i] / bucketN[i] : null));
  const populated = curve.filter((v) => v !== null);
  const monotonic = populated.length < 3 ? 1 : (populated[populated.length - 1] < populated[0] ? 1 : 0);

  // Chromatic aberration: mean |R-B| along strong edges in the corner regions.
  let caSum = 0, caN = 0;
  for (let y = 1; y < H - 1; y += 3) {
    for (let x = 1; x < W - 1; x += 3) {
      const inCorner = (x < W * 0.15 || x > W * 0.85) && (y < H * 0.15 || y > H * 0.85);
      if (!inCorner) continue;
      const i = y * W + x;
      if (Math.abs(gray[i + 1] - gray[i - 1]) < 40) continue;
      const p = i * 3;
      const rEdge = buf[p + 3] - buf[p - 3];
      const bEdge = buf[p + 5] - buf[p - 1];
      caSum += Math.abs(rEdge - bEdge) / 255; caN++;
    }
  }

  return {
    file: basename(file), width: W, height: H,
    medianLuminance: pct(0.5),
    p1Luminance: pct(0.01),
    p99Luminance: pct(0.99),
    meanSaturation: satSum / n,
    vividPixelFrac: vivid / n,
    greenHueLeak: greenLeak / n,
    farNearSatDelta: (farSat / Math.max(1, farN)) - (nearSat / Math.max(1, nearN)),
    edgeCoverage: edges / n,
    vignetteRatio: corners / centre,
    satLumMonotonic: monotonic,
    chromaticAber: caN ? (caSum / caN) * 3 : 0,
    satCurve: curve,
  };
}

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const mode = args[0]?.startsWith('--') ? args.shift().slice(2) : 'score';
const files = args.filter((f) => existsSync(f));

if (!files.length) {
  console.error('No readable files given.');
  process.exit(1);
}

const rows = [];
for (const f of files) rows.push(await measure(f));

if (mode === 'baseline') {
  // Establish what RA3 itself measures, so "the target" is observed, not asserted.
  const keys = Object.keys(TARGETS).filter((k) => k !== 'satLumMonotonic');
  const agg = {};
  for (const k of keys) {
    const vs = rows.map((r) => r[k]).sort((a, b) => a - b);
    agg[k] = {
      min: vs[0],
      p25: vs[Math.floor(vs.length * 0.25)],
      median: vs[Math.floor(vs.length * 0.5)],
      p75: vs[Math.floor(vs.length * 0.75)],
      max: vs[vs.length - 1],
      mean: vs.reduce((a, b) => a + b, 0) / vs.length,
    };
  }
  writeFileSync(BASELINE_PATH, JSON.stringify({ sampleCount: rows.length, files: rows.map((r) => r.file), metrics: agg }, null, 2));
  console.log(`RA3 baseline from ${rows.length} reference frames → docs/grade-baseline.json\n`);
  for (const k of keys) {
    console.log(`  ${k.padEnd(18)} median ${agg[k].median.toFixed(4)}   range ${agg[k].min.toFixed(4)} … ${agg[k].max.toFixed(4)}`);
  }
  process.exit(0);
}

/* Score mode: grade each render against the bible, and against RA3 if measured. */
const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null;

let totalWeight = 0, lostWeight = 0;
const failures = [];

for (const r of rows) {
  console.log(`\n=== ${r.file}  (${r.width}x${r.height}) ===`);
  for (const [key, t] of Object.entries(TARGETS)) {
    const v = r[key];
    const [lo, hi] = resolveRange(key, t, baseline);
    const pass = v >= lo && v <= hi;
    totalWeight += t.w;
    if (!pass && t.w > 0) {
      lostWeight += t.w;
      failures.push({ file: r.file, key, value: v, range: [lo, hi], weight: t.w, check: t.check, label: t.label });
    }
    const ra3 = baseline?.metrics?.[key] ? `  RA3=${baseline.metrics[key].median.toFixed(3)}` : '';
    const verdict = t.w === 0 ? 'info' : pass ? 'PASS' : 'FAIL';
    console.log(`  ${verdict} w${t.w}  #${String(t.check).padStart(2)} ${t.label.padEnd(50)} ${v.toFixed(4)}  target ${lo.toFixed(3)}…${hi.toFixed(3)}${ra3}`);
  }
}

const score = totalWeight ? (1 - lostWeight / totalWeight) : 0;
console.log(`\nWeighted grade score: ${(score * 100).toFixed(1)}%  (${failures.length} failing checks)`);

if (failures.some((f) => f.weight === 3)) {
  console.log('\nFATAL failures (weight 3) — these alone sink the side-by-side:');
  for (const f of failures.filter((x) => x.weight === 3)) {
    console.log(`  ${f.file}  #${f.check} ${f.label}: ${f.value.toFixed(4)} outside ${f.range[0]}…${f.range[1]}`);
  }
}

writeFileSync(join(ROOT, 'shots', '_metrics.json'), JSON.stringify({ score, rows, failures }, null, 2));

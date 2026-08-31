/**
 * Exact RGB screenshot comparison for renderer A/B promotion gates.
 *
 *   node tools/image-diff.mjs candidate.png control.png [--json out.json]
 *
 * Deltas are reported in 8-bit channel values. `meanRgbDelta` averages all
 * three RGB channels; percentiles use the largest channel delta per pixel so a
 * one-channel regression cannot disappear inside the mean.
 */
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const jsonIndex = argv.indexOf('--json');
const outputPath = jsonIndex >= 0 ? argv[jsonIndex + 1] : undefined;
const files = argv.filter((value, index) => index !== jsonIndex && index !== jsonIndex + 1);
if (files.length !== 2 || (jsonIndex >= 0 && outputPath === undefined)) {
  throw new Error('usage: node tools/image-diff.mjs <candidate.png> <control.png> [--json <out.json>]');
}

const [candidate, control] = await Promise.all(files.map((file) => (
  sharp(file).raw().ensureAlpha().toBuffer({ resolveWithObject: true })
)));
if (candidate.info.width !== control.info.width || candidate.info.height !== control.info.height) {
  throw new Error(
    `image size mismatch: ${candidate.info.width}x${candidate.info.height} versus `
    + `${control.info.width}x${control.info.height}`,
  );
}

const pixels = candidate.info.width * candidate.info.height;
const maxChannelByPixel = new Uint8Array(pixels);
let changedPixels = 0;
let strongPixels = 0;
let rgbDeltaSum = 0;
let maxDelta = 0;
for (let pixel = 0, offset = 0; pixel < pixels; pixel++, offset += 4) {
  const dr = Math.abs(candidate.data[offset] - control.data[offset]);
  const dg = Math.abs(candidate.data[offset + 1] - control.data[offset + 1]);
  const db = Math.abs(candidate.data[offset + 2] - control.data[offset + 2]);
  const largest = Math.max(dr, dg, db);
  maxChannelByPixel[pixel] = largest;
  rgbDeltaSum += dr + dg + db;
  if (largest > 0) changedPixels++;
  if (largest > 8) strongPixels++;
  if (largest > maxDelta) maxDelta = largest;
}
maxChannelByPixel.sort();
const percentile = (fraction) => maxChannelByPixel[
  Math.min(pixels - 1, Math.max(0, Math.round(fraction * (pixels - 1))))
];
const result = {
  candidate: files[0],
  control: files[1],
  resolution: `${candidate.info.width}x${candidate.info.height}`,
  pixels,
  changedPixelFraction: changedPixels / pixels,
  strongPixelFraction: strongPixels / pixels,
  meanRgbDelta: rgbDeltaSum / (pixels * 3),
  p95MaxChannelDelta: percentile(0.95),
  p99MaxChannelDelta: percentile(0.99),
  maxChannelDelta: maxDelta,
};

const encoded = `${JSON.stringify(result, null, 2)}\n`;
process.stdout.write(encoded);
if (outputPath !== undefined) await writeFile(outputPath, encoded);

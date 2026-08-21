// Extracts fixed surface-inspection crops from shots/ and writes them to
// docs/surface-refs/after-*.png, upscaled 2x with nearest-neighbour so that
// per-texel noise is preserved rather than blurred away by the resampler.
//
//   node tools/crop-surfaces.mjs
//
// Crop geometry matches the pre-overhaul reference framing:
// a 620x420 window from a 2560x1440 shot, doubled to 1240x840.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 620;
const H = 420;

/** @type {{ name: string, shot: string, left: number, top: number }[]} */
const CROPS = [
  { name: 'after-road-sidewalk', shot: '03-terrain-closeup', left: 1150, top: 40 },
  { name: 'after-unit-tank', shot: '03-terrain-closeup', left: 430, top: 390 },
  { name: 'after-allied-building', shot: '01-establishing-base', left: 1080, top: 300 },
  { name: 'after-soviet-building', shot: '07-soviet-base', left: 1080, top: 160 },
  { name: 'after-soviet-tank', shot: '07-soviet-base', left: 1090, top: 720 },
];

for (const c of CROPS) {
  const src = join(ROOT, 'shots', `${c.shot}.png`);
  const dst = join(ROOT, 'docs', 'surface-refs', `${c.name}.png`);
  await sharp(src)
    .extract({ left: c.left, top: c.top, width: W, height: H })
    .resize({ width: W * 2, height: H * 2, kernel: 'nearest' })
    .png()
    .toFile(dst);
  console.log(`${c.name}  <- ${c.shot} @ ${c.left},${c.top}`);
}

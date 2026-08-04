import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const SRC = 'C:/Users/avihay/OneDrive/Desktop/logo.png';
const OUT = 'C:/Users/avihay/projects/RedAlert/public/brand';
mkdirSync(OUT, { recursive: true });

// Trim the transparent padding so layout can position the artwork, not the canvas.
const trimmed = await sharp(SRC).trim({ threshold: 1 }).toBuffer();
const tm = await sharp(trimmed).metadata();
console.log(`trimmed: ${tm.width}x${tm.height} (from 1536x1024)`);

const jobs = [
  ['logo-full.png', 1400],
  ['logo-720.png', 720],
  ['logo-360.png', 360],
];
for (const [name, w] of jobs) {
  const info = await sharp(trimmed).resize({ width: w, withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: false }).toFile(`${OUT}/${name}`);
  console.log(`${name}  ${info.width}x${info.height}  ${Math.round(info.size/1024)}kb`);
}

// The wordmark is unreadable below ~200px, so the app icon needs the emblem alone:
// the central bolt + wing cluster, cropped square from the upper-middle of the art.
const cx = Math.round(tm.width * 0.5);
const emblemW = Math.round(tm.width * 0.30);
const emblemH = Math.round(tm.height * 0.62);
const emblem = await sharp(trimmed)
  .extract({ left: cx - (emblemW >> 1), top: 0, width: emblemW, height: emblemH })
  .trim({ threshold: 1 }).toBuffer();
const em = await sharp(emblem).metadata();
const side = Math.max(em.width, em.height);
const square = await sharp({ create: { width: side, height: side, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
  .composite([{ input: emblem, gravity: 'center' }]).png().toBuffer();
console.log(`emblem: ${em.width}x${em.height} -> square ${side}`);

for (const s of [512, 180, 64, 32]) {
  const info = await sharp(square).resize(s, s).png({ compressionLevel: 9 }).toFile(`${OUT}/mark-${s}.png`);
  console.log(`mark-${s}.png  ${Math.round(info.size/1024)}kb`);
}

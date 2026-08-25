/**
 * tools/splash.mjs — derive the shipped boot splash from one supplied illustration.
 *
 *   node tools/splash.mjs                        # tools/brand-source/splash-source.png
 *   node tools/splash.mjs path/to/other.png      # re-derive from a replacement
 *
 * A SIBLING OF `brand.mjs`, NOT A BRANCH OF IT. Both write into `public/brand/`, and
 * `public/brand/README.md` says nothing may be put there by hand — but they read
 * DIFFERENT sources: `brand.mjs` derives the wordmark and every app icon from the logo
 * lockup, and this derives the loading curtain's backdrop from the key art. Folding the
 * second source into the first script would mean one `process.argv[2]` selecting between
 * two unrelated pipelines, which is how a tool grows a mode nobody remembers.
 *
 * WHY WEBP AND NOT PNG. Everything else in `public/brand/` is a logo — flat colour, hard
 * edges, alpha — which is what PNG is for. This is a photographic illustration, and PNG
 * is the wrong codec for one: the supplied file is 2.83 MB. It is the FIRST thing the
 * page paints and it sits in front of the player while the 2.7 MB bundle parses, so its
 * weight is not amortised by anything. WebP q78 lands it around a tenth of that with no
 * artefact visible at the sizes it is displayed. There is no PNG fallback and none is
 * needed — WebP has been in every shipping browser since Safari 14 (2020), and the game
 * requires WebGL2, which is a strictly narrower gate.
 *
 * WHY NO UPSCALE. The source is 1672x941. `withoutEnlargement` keeps 1600 as a real
 * downsample; asking for 1920 would invent pixels and cost bytes to store the invention.
 * CSS `object-fit: cover` handles a larger viewport, and a slight upscale of a soft
 * illustration behind a vignette is invisible — a resampled JPEG-artefact field is not.
 */
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2]
  ? resolve(process.argv[2])
  : join(ROOT, 'tools', 'brand-source', 'splash-source.png');
const OUT = join(ROOT, 'apps/game/public', 'brand');

if (!existsSync(SRC)) {
  console.error(`no source image at ${SRC}`);
  console.error('pass one as the first argument, or restore tools/brand-source/splash-source.png');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const meta = await sharp(SRC).metadata();
console.log(`source: ${SRC}  ${meta.width}x${meta.height}`);

/*
 * Two widths, chosen from what the curtain actually does with them rather than
 * from a ladder:
 *
 *   splash-1600  the backdrop. `cover` on a 1440p display upscales it 1.2x, which
 *                is under the threshold where resampling is visible on artwork.
 *   splash-640   the LOW-QUALITY IMAGE PLACEHOLDER. It is ~20 kB, so it arrives in
 *                one packet on any connection and paints while the full frame is
 *                still in flight — the curtain is on screen for a second or two, and
 *                a splash that appears after the thing it was covering is pointless.
 *                Blurred by CSS, never shown sharp.
 */
const jobs = [
  ['splash-1600.webp', 1600, 78],
  ['splash-640.webp', 640, 62],
];

for (const [name, width, quality] of jobs) {
  const info = await sharp(SRC)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality, effort: 6 })
    .toFile(`${OUT}/${name}`);
  console.log(`${name}  ${info.width}x${info.height}  ${Math.round(info.size / 1024)}kb`);
}

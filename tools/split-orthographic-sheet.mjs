import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

const [, , inputArg, outputArg, ...extraArgs] = process.argv;
if (inputArg === undefined) {
  throw new Error(
    'usage: node tools/split-orthographic-sheet.mjs <sheet.png> [output-dir] '
    + '[--layout horizontal|grid] [--gutter pixels]',
  );
}

const layoutIndex = extraArgs.indexOf('--layout');
const layout = layoutIndex >= 0 ? extraArgs[layoutIndex + 1] : 'horizontal';
if (layout !== 'horizontal' && layout !== 'grid') {
  throw new Error(`unsupported layout: ${layout}`);
}
const gutterIndex = extraArgs.indexOf('--gutter');
const gutter = gutterIndex >= 0 ? Number(extraArgs[gutterIndex + 1]) : 0;
if (!Number.isInteger(gutter) || gutter < 0) {
  throw new Error(`gutter must be a non-negative integer: ${gutter}`);
}

const input = resolve(inputArg);
const output = resolve(outputArg ?? dirname(input));
const metadata = await sharp(input).metadata();
if (metadata.width === undefined || metadata.height === undefined) {
  throw new Error(`could not read image dimensions from ${input}`);
}

const names = ['front', 'right', 'back', 'left'];
await mkdir(output, { recursive: true });

for (let index = 0; index < names.length; index++) {
  const columns = layout === 'grid' ? 2 : 4;
  const rows = layout === 'grid' ? 2 : 1;
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = Math.round((metadata.width * column) / columns) + gutter;
  const right = Math.round((metadata.width * (column + 1)) / columns) - gutter;
  const top = Math.round((metadata.height * row) / rows) + gutter;
  const bottom = Math.round((metadata.height * (row + 1)) / rows) - gutter;
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) {
    throw new Error(`gutter ${gutter} consumes panel ${index + 1}: ${width}x${height}`);
  }
  const destination = join(output, `${names[index]}.png`);
  await sharp(input)
    .extract({ left, top, width, height })
    .png()
    .toFile(destination);
  console.log(`${names[index]}: ${width}x${height} -> ${destination}`);
}

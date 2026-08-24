import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const [, , conceptArg, outputArg] = process.argv;
if (conceptArg === undefined || outputArg === undefined) {
  throw new Error(
    'usage: node tools/create-meshy-multiview-payload.mjs <concept-dir> <output.json>',
  );
}

const conceptDir = resolve(conceptArg);
const output = resolve(outputArg);
const views = ['front', 'right', 'back', 'left'];

function mimeFor(file) {
  const extension = extname(file).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  throw new Error(`unsupported concept image extension: ${extension}`);
}

const imageUrls = await Promise.all(views.map(async (view) => {
  const file = join(conceptDir, `${view}.png`);
  const bytes = await readFile(file);
  return `data:${mimeFor(file)};base64,${bytes.toString('base64')}`;
}));

const payload = {
  image_urls: imageUrls,
  ai_model: 'latest',
  should_texture: false,
  should_remesh: false,
  multi_view_thumbnails: true,
  target_formats: ['glb'],
};

await writeFile(output, `${JSON.stringify(payload)}\n`, 'utf8');
console.log(`${views.length} orthographic views -> ${output}`);

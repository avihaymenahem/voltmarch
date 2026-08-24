import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const [, , taskId, referenceArg, outputArg] = process.argv;
if (taskId === undefined || referenceArg === undefined || outputArg === undefined) {
  throw new Error(
    'usage: node tools/create-meshy-retexture-payload.mjs <input-task-id> <reference.png> <output.json>',
  );
}

const reference = resolve(referenceArg);
const extension = extname(reference).toLowerCase();
const mime = extension === '.png'
  ? 'image/png'
  : extension === '.jpg' || extension === '.jpeg'
    ? 'image/jpeg'
    : undefined;
if (mime === undefined) throw new Error(`unsupported texture reference: ${extension}`);

const bytes = await readFile(reference);
const payload = {
  input_task_id: taskId,
  image_style_url: `data:${mime};base64,${bytes.toString('base64')}`,
  enable_pbr: true,
  remove_lighting: true,
  target_formats: ['glb'],
};

await writeFile(resolve(outputArg), `${JSON.stringify(payload)}\n`, 'utf8');
console.log(`${reference} -> ${resolve(outputArg)}`);

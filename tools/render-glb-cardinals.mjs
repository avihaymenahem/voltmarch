#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const originalMaterial = args.includes('--material=original');
const positional = args.filter((arg) => arg !== '--material=original');
const [modelArg, outputArg, baseUrlArg = 'http://localhost:5173'] = positional;
if (!modelArg || !outputArg) {
  throw new Error('usage: node tools/render-glb-cardinals.mjs <model.glb> <output.png> [base-url]');
}

const root = path.resolve(import.meta.dirname, '..');
const model = path.resolve(modelArg);
const output = path.resolve(outputArg);
const relative = path.relative(root, model).split(path.sep).join('/');
if (relative.startsWith('../') || path.isAbsolute(relative)) {
  throw new Error(`model must be inside the workspace: ${model}`);
}

await fs.access(model);
await fs.mkdir(path.dirname(output), { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
  const messages = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => messages.push(`pageerror: ${error.stack ?? error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) messages.push(`http ${response.status()}: ${response.url()}`);
  });
  const url = new URL('/tools/glb-cardinals.html', baseUrlArg);
  url.searchParams.set('model', `/${relative}`);
  if (originalMaterial) url.searchParams.set('material', 'original');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  try {
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 15_000 });
  } catch (error) {
    await page.screenshot({ path: output }).catch(() => undefined);
    throw new Error(`cardinal page did not become ready: ${messages.join('\n')}`, { cause: error });
  }
  await page.screenshot({ path: output });
  console.log(`${relative} -> ${output}`);
} finally {
  await browser.close();
}

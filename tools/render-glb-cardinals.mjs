#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const originalMaterial = args.includes('--material=original');
const topdown = args.includes('--mode=top');
const articulation = args.includes('--mode=articulation');
const pivotArg = args.find((arg) => arg.startsWith('--pivot='));
const turretArg = args.find((arg) => arg.startsWith('--turret='));
const positional = args.filter((arg) => arg !== '--material=original'
  && arg !== '--mode=top' && arg !== '--mode=articulation'
  && arg !== pivotArg && arg !== turretArg);
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
  if (topdown) url.searchParams.set('mode', 'top');
  if (articulation) {
    if (pivotArg === undefined) throw new Error('--mode=articulation requires --pivot=x,y,z');
    url.searchParams.set('mode', 'articulation');
    url.searchParams.set('pivot', pivotArg.slice('--pivot='.length));
    if (turretArg !== undefined) url.searchParams.set('turret', turretArg.slice('--turret='.length));
  }
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  try {
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 120_000 });
  } catch (error) {
    await page.screenshot({ path: output }).catch(() => undefined);
    throw new Error(`cardinal page did not become ready: ${messages.join('\n')}`, { cause: error });
  }
  await page.screenshot({ path: output });
  console.log(`${relative} -> ${output}`);
} finally {
  await browser.close();
}

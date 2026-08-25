/**
 * The boot-time procedural texture cost, before and after the worker.
 *
 *   npx vite-node tools/bench-textures.mts
 *
 * Generates exactly the set `Roads.ts` and `TerrainMaterial.ts` ask for during
 * boot, three ways:
 *
 *   1. SYNCHRONOUS      what `TextureFactory` does with no worker pool — the
 *                       path that shipped before workers, and still the path
 *                       every failure falls back to.
 *   2. MAIN-THREAD COST what remains on the main thread once a worker does the
 *                       generating: the placeholder fill on the way out and the
 *                       memcpy of the returned bytes on the way back.
 *   3. OFF-THREAD       the same generation split across N real OS threads, so
 *                       the wall-clock the worker path is bounded by is a
 *                       measured number and not an estimate.
 *
 * (3) uses `node:worker_threads` rather than a browser, driving the SAME
 * `runTextureJob` the real worker runs — it bundles `protocol.ts` with esbuild
 * and runs that. It measures the generation code on real threads; it does not
 * measure a browser's worker startup, and it is not a boot-time measurement.
 */
import { Worker } from 'node:worker_threads';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { TextureFactory, type AnyGenParams, type Channel, type TextureKind } from '../apps/game/src/core/assets';
import { generateTextureBytes, placeholderBytes } from '../apps/game/src/core/surfaces';
import { runTextureJob, type TextureJob } from '../apps/game/src/core/workers/protocol';

interface Case {
  name: string;
  kind: TextureKind;
  params: AnyGenParams;
  channels: Channel[];
  /**
   * Whether THIS slice actually offloads it.
   *
   * Everything reaching the worker goes through `TextureFactory.textureSet` —
   * which is what `materialTextureSet` and `get` call. The terrain layers do
   * NOT: `TerrainMaterial.buildLayerArrayTexture` calls `textures.surface()`
   * and packs the float channels into a `DataArrayTexture` itself, so there is
   * nothing for a worker to hand back without changing that consumer. Marked
   * rather than omitted, so this tool cannot quietly overstate the win.
   */
  offloaded: boolean;
}

const PBR: Channel[] = ['albedo', 'normal', 'orm'];

/** The real boot set, transcribed from the two call sites. */
const CASES: Case[] = [
  { name: 'RoadAsphalt', kind: 'asphalt', params: { size: 256, seed: 0x2a11, colour: '#2c2926', wear: 0.6 }, channels: PBR, offloaded: true },
  { name: 'RoadKerb', kind: 'flatPaint', params: { size: 128, seed: 0x51c3, colour: '#cbc0ae', wear: 0.35 }, channels: PBR, offloaded: true },
  { name: 'RoadPavement', kind: 'paving', params: { size: 512, seed: 0x7b09, colour: '#cbc0ae', slabW: 128, slabH: 128, jointWidth: 3.2, variation: 0.03, wear: 0.4 }, channels: PBR, offloaded: true },
  { name: 'ArrowStraight', kind: 'decal', params: { size: 128, path: 'arrowStraight' }, channels: ['mask'], offloaded: true },
  { name: 'ArrowTurn', kind: 'decal', params: { size: 128, path: 'arrowTurn' }, channels: ['mask'], offloaded: true },
  ...Array.from({ length: 6 }, (_, i): Case => ({
    name: `TerrainLayer${i}`,
    kind: i % 2 === 0 ? 'paving' : 'cobblestone',
    params: { size: 256, seed: 100 + i, colour: '#8d8272', stoneSize: 32, slabW: 32, slabH: 32, wear: 0.3 },
    channels: ['albedo'],
    offloaded: false,
  })),
];

const ms = (v: number): string => `${v.toFixed(1)} ms`;

/* -- 1. synchronous ------------------------------------------------------- */

const factory = new TextureFactory();
let sync = 0, syncOffloadable = 0;
console.log('SYNCHRONOUS (main thread does everything) — the path before this change');
for (const c of CASES) {
  const t0 = performance.now();
  const s = factory.surface(c.kind, c.params);
  for (const ch of c.channels) generateTextureBytes({ kind: c.kind, ...c.params, channel: ch }, s);
  const dt = performance.now() - t0;
  sync += dt;
  if (c.offloaded) syncOffloadable += dt;
  console.log(`  ${c.name.padEnd(16)} ${String(c.params.size).padStart(4)}²  ${ms(dt).padStart(9)}`
    + `  ${c.offloaded ? 'worker' : 'stays on the main thread'}`);
}
console.log(`  ${'TOTAL'.padEnd(16)}       ${ms(sync).padStart(9)}`);
console.log(`  ${'of which offloaded by this slice'}  ${ms(syncOffloadable)}\n`);

/* -- 2. what the main thread still pays with a worker --------------------- */

const OFF = CASES.filter((c) => c.offloaded);
const generated = OFF.map((c) => c.channels.map(
  (ch) => generateTextureBytes({ kind: c.kind, ...c.params, channel: ch }).data));

let residual = 0;
for (let i = 0; i < OFF.length; i++) {
  const c = OFF[i];
  const t0 = performance.now();
  for (let j = 0; j < c.channels.length; j++) {
    const slot = placeholderBytes({ kind: c.kind, ...c.params, channel: c.channels[j] });
    slot.data.set(generated[i][j]);          // the adopt memcpy
  }
  residual += performance.now() - t0;
}
console.log('MAIN-THREAD COST OF THE OFFLOADED SET (placeholder fill + adopt memcpy)');
console.log(`  ${'TOTAL'.padEnd(16)}       ${ms(residual).padStart(9)}`);
console.log(`  ${ms(syncOffloadable)} of main-thread work becomes ${ms(residual)}`
  + ` — ${ms(syncOffloadable - residual)} removed`);
console.log(`  boot-set main-thread total: ${ms(sync)} -> ${ms(sync - syncOffloadable + residual)}\n`);

/* -- 3. the same work on real threads ------------------------------------- */

const JOBS: TextureJob[] = OFF.map((c, i) => ({
  id: i, request: { kind: c.kind, ...c.params }, channels: c.channels,
}));

const dir = await mkdtemp(join(tmpdir(), 'vm-bench-'));
const entry = join(dir, 'worker.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('../apps/game/src/core/workers/protocol.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', outfile: entry,
  footer: {
    js: `
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (jobs) => {
  for (const job of jobs) runTextureJob(job);
  parentPort.postMessage('done');
});`,
  },
});

async function runOn(threads: number): Promise<number> {
  // Round-robin, exactly as TexturePool assigns.
  const buckets: TextureJob[][] = Array.from({ length: threads }, () => []);
  JOBS.forEach((j, i) => buckets[i % threads].push(j));
  const workers = buckets.map(() => new Worker(entry));
  // Pay worker startup before the clock starts: this measures the generation,
  // and a browser's module-worker startup is a different (and unmeasured) cost.
  await Promise.all(workers.map((w) => new Promise<void>((res) => { w.once('online', () => res()); })));

  const t0 = performance.now();
  await Promise.all(workers.map((w, i) => new Promise<void>((res) => {
    w.once('message', () => res());
    w.postMessage(buckets[i]);
  })));
  const dt = performance.now() - t0;
  await Promise.all(workers.map((w) => w.terminate()));
  return dt;
}

console.log('OFF-THREAD WALL CLOCK for the offloaded set (node:worker_threads, same runTextureJob)');
console.log('  best of 3; 1 thread is the fair baseline for the others');
for (const n of [1, 2, 3, 4]) {
  const runs = [await runOn(n), await runOn(n), await runOn(n)];
  console.log(`  ${String(n).padStart(2)} thread(s)   ${ms(Math.min(...runs)).padStart(9)}`);
}
await rm(dir, { recursive: true, force: true });

// Keep the tree-shaker honest about the import above.
void runTextureJob;

/**
 * ============================================================================
 * BOOT PROFILER — where the loading curtain's seconds actually go.
 * ============================================================================
 * Boots the BUILT game in headless Chromium exactly as `tools/shoot.mjs` does,
 * then reads the numbers the boot log already prints and the ones `__VM` can be
 * asked for. Nothing here instruments the game: every figure below is a line
 * the game emits on its own, so a profile run and a normal run measure the same
 * code.
 *
 *   node tools/boot-profile.mjs                       # build, then profile
 *   node tools/boot-profile.mjs --no-build            # profile the existing dist/
 *   node tools/boot-profile.mjs --runs 5              # more samples
 *   node tools/boot-profile.mjs --shot 08-naval-water # a different fixture
 *   node tools/boot-profile.mjs --flags "terrainworkers=off,waterworkers=off"
 *
 * WHY THE MEDIAN AND NOT THE MEAN. A cold first boot pays for the module graph,
 * the shader compile and the worker script fetch, and those are real but they
 * are not what a terrain change moves. Every figure below is the median of
 * `--runs` boots in ONE browser (separate pages), with the first boot reported
 * separately as `cold`.
 *
 * WHAT THE NUMBERS MEAN, precisely, because the whole point is comparing two
 * of these:
 *
 *   terrain   wall clock inside `world.terrain`'s init — the `[terrain] ... in
 *             N ms` line. With the worker path on, this INCLUDES any time spent
 *             waiting for the worker, which is the honest figure: it is how long
 *             the boot actually stopped there.
 *   water     the same, for `world.water`.
 *   ready     navigation start to `__VM.ready()` resolving, i.e. the whole boot.
 *
 * A worker offload that moves `terrain` down while leaving `ready` where it was
 * has moved work, not saved time, and this tool is arranged so that shows up.
 * ============================================================================
 */

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * A HINT, shared with four other tools until `serve()` made the number stop
 * mattering. Every millisecond this file reports is a property of the bundle it
 * booted, so a neighbour's `dist/` answering on 4319 does not produce an error
 * here — it produces a boot profile of somebody else's build, in the right
 * shape, with plausible numbers.
 */
const PORT_HINT = 4319;

const argv = process.argv.slice(2);
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}
const noBuild = argv.includes('--no-build');
/** Echo the whole boot log, timestamped from navigation start. */
const verbose = argv.includes('--verbose');
const RUNS = Number(opt('runs', '3'));
const SHOT = opt('shot', '08-naval-water');
const EXTRA = opt('flags', '');
const OUT = opt('out', '');

/** The fixtures worth profiling, and the boot flags each one needs. */
const FIXTURES = {
  '01-establishing-base': { shot: 'allied-base', seed: 7 },
  '03-terrain-closeup': { shot: 'terrain-showcase', seed: 3 },
  // The one map with a declared sea, so the only one where water does real work.
  '08-naval-water': { shot: 'naval', seed: 13 },
};

const flags = FIXTURES[SHOT];
if (flags === undefined) {
  console.error(`unknown --shot ${SHOT}. Known: ${Object.keys(FIXTURES).join(', ')}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */

if (!noBuild) {
  console.log('> building...');
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (r.status !== 0) throw new Error('build failed');
} else if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('--no-build was given but dist/index.html does not exist.');
  process.exit(1);
}

console.log('> serving...');
const server = await serve({
  root: ROOT, mode: 'preview', portHint: PORT_HINT, log: console.log,
});
const BASE = server.origin;
const cleanup = () => server.stop();

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
  ],
});

/* -------------------------------------------------------------------------- */
/* The lines this reads out of the boot log.                                  */
/* -------------------------------------------------------------------------- */

/** `... 34567 tris in 1234 ms · ...` and `... tris in 1234 ms` alike. */
const PATTERNS = [
  ['terrain', /\[terrain\][^\n]*? in (\d+) ms/],
  ['water', /\[water\][^\n]*?in (\d+) ms/],
  ['terrainGen', /\[terrain\][^\n]*?generated in (\d+) ms/],
  ['waterBake', /\[water\][^\n]*?baked in (\d+) ms/],
  ['worldWorker', /\[world\][^\n]*?terrain (\d+) ms[^\n]*?water (\d+) ms/],
];

const qs = new URLSearchParams();
for (const [k, v] of Object.entries(flags)) qs.set(k, String(v));
for (const pair of EXTRA.split(',')) {
  if (pair.trim() === '') continue;
  const [k, v = ''] = pair.split('=');
  qs.set(k, v);
}

const samples = [];
for (let run = 0; run < RUNS; run++) {
  // Per run, not once: the median below is taken over several boots and a
  // server that died between two of them would silently mix two bundles.
  server.assertAlive(`run ${run + 1}`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const lines = [];
  const t0 = Date.now();
  page.on('console', (m) => {
    lines.push(m.text());
    if (verbose) console.log(`    +${Date.now() - t0} ${m.text()}`);
  });
  page.on('pageerror', (e) => { lines.push(`[pageerror] ${String(e)}`); });

  await page.goto(`${BASE}?${qs.toString()}`, { waitUntil: 'load' });
  /*
   * THE CURTAIN, NOT `__VM.ready()`.
   *
   * `__VM` is published at RENDER boot — the log line says so — which is before
   * `registry.init()` has run a single module. Waiting on it reports ~430 ms for
   * a boot that has not yet generated a heightfield, and the profile comes back
   * with no terrain line at all because the page was closed while the generator
   * was still running. `main.ts` dismisses the curtain after `game.ready` and
   * two presented frames, so this is the moment the player sees the map.
   */
  await page.waitForFunction(
    () => document.getElementById('loading')?.classList.contains('is-hidden') === true,
    null, { timeout: 120_000 },
  );
  const ready = Date.now() - t0;

  /*
   * A CHECKSUM OF WHAT IS ACTUALLY ON SCREEN.
   *
   * `tests/world-workers.spec.ts` proves the worker and the main thread agree
   * byte for byte, but it proves it in Node against the generator classes. This
   * reaches into the LIVE scene in a real browser and hashes the terrain chunk
   * geometry the renderer is drawing plus the water field texture the shader is
   * sampling. Run it once with the workers on and once with `?terrainworkers=
   * off&waterworkers=off` and the two numbers must match exactly — which is the
   * end-to-end form of the claim, adoption path and all.
   *
   * FNV-1a over the raw bytes: order-sensitive, cheap, and it does not care what
   * the values mean.
   */
  const checksum = await page.evaluate(() => {
    const fnv = (bytes) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h;
    };
    const scene = window.__VM?.scene;
    if (!scene) return null;
    const parts = [];
    scene.traverse((o) => {
      if (typeof o.name === 'string' && o.name.startsWith('terrain.chunk.')) parts.push(o);
    });
    parts.sort((a, b) => (a.name < b.name ? -1 : 1));
    let h = 0x811c9dc5;
    const mix = (v) => { h = Math.imul(h ^ v, 0x01000193) >>> 0; };
    for (const m of parts) {
      const g = m.geometry;
      for (const key of ['position', 'normal', 'aUp', 'aTop']) {
        const attr = g.getAttribute(key);
        if (!attr) continue;
        mix(fnv(new Uint8Array(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength)));
      }
      const idx = g.getIndex();
      if (idx) mix(fnv(new Uint8Array(idx.array.buffer, idx.array.byteOffset, idx.array.byteLength)));
      mix(m.castShadow ? 1 : 0);
    }
    const w = window.__vmWater;
    let water = 0;
    if (w && w.depth) {
      water = fnv(new Uint8Array(w.depth.buffer, w.depth.byteOffset, w.depth.byteLength));
      water = Math.imul(water ^ fnv(new Uint8Array(
        w.shore.buffer, w.shore.byteOffset, w.shore.byteLength,
      )), 0x01000193) >>> 0;
      water = Math.imul(water ^ fnv(w.waterCells), 0x01000193) >>> 0;
    }
    return { chunks: parts.length, terrain: h, water };
  });

  const text = lines.join('\n');
  const s = { run, ready, checksum };
  for (const [key, re] of PATTERNS) {
    const m = re.exec(text);
    if (m === null) continue;
    s[key] = Number(m[1]);
    if (m[2] !== undefined) s[`${key}2`] = Number(m[2]);
  }
  s.landlocked = /landlocked/.test(text);
  samples.push(s);
  const sum = checksum === null
    ? ''
    : `, world ${checksum.chunks} chunks ${checksum.terrain.toString(16)}/${checksum.water.toString(16)}`;
  console.log(`  run ${run + 1}/${RUNS}: ready ${ready} ms, terrain ${s.terrain ?? '-'} ms, water ${s.water ?? '-'} ms${sum}`);
  await page.close();
}

await browser.close();
cleanup();

/* -------------------------------------------------------------------------- */

function median(values) {
  const v = values.filter((n) => typeof n === 'number').sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v.length % 2 === 1 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
}

const warm = samples.slice(1).length > 0 ? samples.slice(1) : samples;
const keys = ['ready', 'terrain', 'water', 'terrainGen', 'waterBake', 'worldWorker', 'worldWorker2'];
const summary = {
  shot: SHOT,
  flags: qs.toString(),
  runs: RUNS,
  cold: samples[0],
  checksum: samples[0].checksum,
  median: {},
};
for (const k of keys) {
  const m = median(warm.map((s) => s[k]));
  if (m !== null) summary.median[k] = m;
}

console.log(`\n${SHOT}  (?${qs.toString()})`);
if (summary.checksum !== null && summary.checksum !== undefined) {
  const c = summary.checksum;
  console.log(`  world checksum   ${c.chunks} chunks, terrain ${c.terrain.toString(16)}, water ${c.water.toString(16)}`);
  const drift = samples.filter((s) => s.checksum !== null
    && (s.checksum.terrain !== c.terrain || s.checksum.water !== c.water));
  if (drift.length > 0) {
    console.log(`  !! ${drift.length} run(s) produced a DIFFERENT world from the same flags`);
  }
}
console.log(`  cold boot        ${samples[0].ready} ms`);
for (const [k, v] of Object.entries(summary.median)) {
  console.log(`  ${k.padEnd(16)} ${v} ms   (median of ${warm.length})`);
}
if (OUT !== '') {
  writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n-> ${OUT}`);
}

/**
 * FLASH-STACK PROBE — is N co-located flashes N times as bright as one?
 *
 *   node tools/flash-stack.mjs --tag before
 *   node tools/flash-stack.mjs --tag after
 *
 * WHY THIS EXISTS. Explosion / muzzle-flash brightness has been reported four
 * times and "fixed" twice. Both fixes dimmed a SINGLE sprite, which is why they
 * measured correctly in isolation and failed in a firefight: the additive
 * sprite layer and the point-light pool both SUM, and nothing bounded the sum.
 * A one-explosion screenshot cannot see that, so it is not evidence. This
 * probe fires 1, 5 and 20 flashes into the SAME few square metres, steps the
 * VFX clock by an exact amount (`__vmVfx.timeScale(0)` + `advance(ms)`), and
 * reports peak / mean luminance and blown-pixel area at each count.
 *
 * The number that matters is the RATIO, printed as `xN` against the 1-flash
 * case. Linear growth is the stacking bug. Flat growth is the fix.
 *
 * Deliberately NOT part of `npm run shots`: it drives the VFX pools directly
 * rather than photographing a scenario, so it is a bug probe, not a fixture.
 * Uses ONE Chromium, sequentially.
 */

import { chromium } from 'playwright';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4319;
const BASE = `http://localhost:${PORT}/`;

const argv = process.argv.slice(2);
const headed = argv.includes('--headed');
const tagIdx = argv.indexOf('--tag');
const TAG = tagIdx >= 0 ? argv[tagIdx + 1] : 'run';

/*
 * 1280x720, not 1440p. Every metric here is a luminance distribution over the
 * frame, which is resolution independent; the capture is 8x cheaper and the
 * whole sweep is 24 renders. The scorecard is still measured at 1440p by
 * `npm run shots`, which this does not replace.
 */
const VIEWPORT = { width: 1280, height: 720 };
const OUT = join(ROOT, '.flash-stack', TAG);

/** Counts to compare. 1 must stay beautiful; 20 must not be 20x. */
const COUNTS = [1, 5, 20];

/**
 * Millisecond checkpoints, cumulative. The metric reported per case is the MAX
 * over the sweep, because "how bright does it get" is the complaint, and a
 * fireball's peak is 40-100 ms in while a muzzle flash is gone by 90.
 */
const EXPLOSION_STEPS = [12, 28, 40, 70, 110, 180, 280, 400];
const MUZZLE_STEPS = [6, 10, 14, 25, 45];

/**
 * `--ablate` mode: n=20 explosions at their measured peak, with the two summing
 * layers switched off one at a time. This is what says whether the whiteout is
 * the additive quad pile, the point-light pile, or both — and a fix aimed at
 * only one of them would leave the other to produce a fifth bug report.
 */
const ABLATE = argv.includes('--ablate');

const run = (cmd, args) =>
  spawn(cmd, args, { cwd: ROOT, shell: process.platform === 'win32', stdio: 'pipe' });

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Luminance distribution of one PNG buffer, in sRGB — the bible's frame. */
async function measure(buf) {
  const img = sharp(buf).removeAlpha();
  const { width: W, height: H } = await img.metadata();
  const raw = await img.raw().toBuffer();
  const n = W * H;
  const lum = new Float32Array(n);
  let sum = 0, over50 = 0, over75 = 0, over95 = 0, over99 = 0;
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const L = (0.2126 * raw[p] + 0.7152 * raw[p + 1] + 0.0722 * raw[p + 2]) / 255;
    lum[i] = L;
    sum += L;
    if (L > 0.50) over50++;
    if (L > 0.75) over75++;
    if (L > 0.95) over95++;
    if (L > 0.99) over99++;
  }
  const sorted = Float32Array.from(lum).sort();
  const pct = (q) => sorted[Math.min(n - 1, Math.round(q * (n - 1)))];
  return {
    mean: sum / n,
    median: pct(0.5),
    p99: pct(0.99),
    p999: pct(0.999),
    max: sorted[n - 1],
    fracOver50: over50 / n,
    fracOver75: over75 / n,
    fracOver95: over95 / n,
    fracOver99: over99 / n,
  };
}

/* ------------------------------------------------------------------ */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log('> building...');
await new Promise((resolve, reject) => {
  const b = run('npm', ['run', 'build']);
  let out = '';
  b.stdout.on('data', (d) => (out += d));
  b.stderr.on('data', (d) => (out += d));
  b.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`build failed:\n${out.slice(-4000)}`))));
});

console.log('> serving...');
const server = run('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort']);
const cleanup = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!(await waitForServer(BASE))) { cleanup(); throw new Error(`preview never came up on ${BASE}`); }

const browser = await chromium.launch({
  headless: !headed,
  args: [
    '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
  ],
});

const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
page.setDefaultTimeout(180_000);
page.setDefaultNavigationTimeout(180_000);
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

const results = { tag: TAG, viewport: VIEWPORT, webgl: null, cases: [] };

try {
  // unit-parade, not battle: full-health units emit no damage smoke, so the
  // baseline frame is static and every luminance delta is the flashes alone.
  await page.goto(`${BASE}?shot=unit-parade&seed=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 60_000 });
  await page.evaluate(() => window.__VM.ready());
  await page.waitForFunction(
    () => {
      const curtain = document.getElementById('loading');
      if (curtain !== null && curtain.hidden !== true) return false;
      const s = window.__VM?.stats?.();
      return s !== undefined && s.drawCalls > 8;
    },
    null,
    { timeout: 180_000 },
  );

  results.webgl = await page.evaluate(() => {
    const gl = window.__VM.renderer.getContext();
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'masked';
  });
  console.log(`  webgl: ${results.webgl}`);

  // 48 m is the 05-combat framing — the fixture this bug is reported against.
  await page.evaluate(() => {
    window.__VM.focusOn(256, 256, 48);
    window.__VM.setUiVisible(false);
  });
  await page.evaluate(() => window.__VM.waitFrames(6));

  const ok = await page.evaluate(() => typeof window.__vmVfx?.explode === 'function');
  if (!ok) throw new Error('__vmVfx is absent — the vfx system did not install its harness handle');

  /** Baseline: the same frame with no effects at all. */
  const baseShot = await page.evaluate(async () => {
    window.__vmVfx.clear();
    window.__vmVfx.timeScale(0);
    return window.__VM.screenshot();
  });
  const baseBuf = Buffer.from(baseShot.split(',')[1], 'base64');
  writeFileSync(join(OUT, 'baseline.png'), baseBuf);
  results.baseline = await measure(baseBuf);
  console.log(`  baseline: mean ${results.baseline.mean.toFixed(4)}  p99 ${results.baseline.p99.toFixed(4)}`);

  if (ABLATE) {
    // Layer masks: [additive quads, point lights].
    const masks = [
      ['all-on', true, true],
      ['no-additive', false, true],
      ['no-lights', true, false],
      ['neither', false, false],
    ];
    for (const count of [1, 20]) {
      for (const [label, additive, lights] of masks) {
        const url = await page.evaluate(
          async ({ count, additive, lights }) => {
            const V = window.__vmVfx;
            const RA = window.__VM;
            V.clear();
            V.timeScale(0);
            const f = RA.rig.focus;
            for (let i = 0; i < count; i++) {
              const a = i * 2.39996323;
              const r = count === 1 ? 0 : 4 * Math.sqrt(i / count);
              V.explode(f.x + Math.cos(a) * r, f.y + 1.2, f.z + Math.sin(a) * r, 2.2, 'unit');
            }
            V.advance(180);
            // See the note in the sweep below: the advance is consumed by a real
            // loop frame, never by screenshot()'s renderOnce.
            await RA.waitFrames(3);
            const add = RA.scene.getObjectByName('VfxAdditive');
            if (add) add.visible = additive;
            const pool = RA.scene.getObjectByName('VfxLightPool');
            // `visible = false` on the GROUP drops every light from the light
            // list and recompiles — fine for a one-off measurement, and it is
            // the only way to take the light term to exactly zero.
            if (pool) pool.visible = lights;
            const shot = await RA.screenshot();
            if (add) add.visible = true;
            if (pool) pool.visible = true;
            return shot;
          },
          { count, additive, lights },
        );
        const buf = Buffer.from(url.split(',')[1], 'base64');
        writeFileSync(join(OUT, `ablate-${String(count).padStart(2, '0')}-${label}.png`), buf);
        const m = await measure(buf);
        results.cases.push({ effect: 'ablate', count, label, ...m });
        console.log(
          `  ablate n=${String(count).padStart(2)} ${label.padEnd(12)}  ` +
          `mean ${m.mean.toFixed(4)}  >0.95 ${(m.fracOver95 * 100).toFixed(3)}%  ` +
          `>0.75 ${(m.fracOver75 * 100).toFixed(3)}%`,
        );
      }
    }
  }

  for (const effect of ['explosion', 'muzzle']) {
    const steps = effect === 'explosion' ? EXPLOSION_STEPS : MUZZLE_STEPS;
    for (const count of COUNTS) {
      const frames = [];
      let prev = 0;
      for (const t of steps) {
        const dt = t - prev;
        prev = t;
        const url = await page.evaluate(
          async ({ effect, count, dt, first }) => {
            const V = window.__vmVfx;
            const RA = window.__VM;
            if (first) {
              V.clear();
              V.timeScale(0);
              // Ground point at the centre of frame, from the camera rig's own
              // focus — no terrain sampler is exposed on __VM.
              const f = RA.rig.focus;
              // A deterministic spiral inside a ~4 m radius: "co-located in a
              // small area", which is what a squad firing at one target is.
              for (let i = 0; i < count; i++) {
                const a = i * 2.39996323;                 // golden angle
                const r = count === 1 ? 0 : 4 * Math.sqrt(i / count);
                const x = f.x + Math.cos(a) * r;
                const z = f.z + Math.sin(a) * r;
                if (effect === 'explosion') V.explode(x, f.y + 1.2, z, 2.2, 'unit');
                else V.muzzle(x, f.y + 1.6, z, Math.cos(a), 0.08, Math.sin(a), 2);
              }
            }
            V.advance(dt);
            /*
             * THE STEP THAT MADE THE FIRST RUN OF THIS PROBE MEASURE NOTHING.
             *
             * `__VM.screenshot()` calls `hooks.renderFrame`, which is
             * Bootstrap's `renderOnce` — it presents the scene but does NOT run
             * `registry.runFrame`, so the VFX system's `frame()` never executes
             * inside it and the queued `advance()` is still queued. The capture
             * was therefore always one checkpoint stale, and a single big
             * advance measured the frame BEFORE the explosion existed.
             *
             * So yield to the real loop: rAF frames are where `frame()` runs.
             * With `timeScale(0)` the extra frames step every pool by 0 ms, so
             * waiting cannot age anything past the checkpoint.
             */
            await RA.waitFrames(3);
            return RA.screenshot();
          },
          { effect, count, dt, first: t === steps[0] },
        );
        const buf = Buffer.from(url.split(',')[1], 'base64');
        writeFileSync(join(OUT, `${effect}-${String(count).padStart(2, '0')}-t${t}.png`), buf);
        const m = await measure(buf);
        m.tMs = t;
        frames.push(m);
      }
      // The case's number is the worst frame in the sweep on each axis.
      const worst = (k) => Math.max(...frames.map((f) => f[k]));
      const peakFrame = frames.reduce((a, b) => (b.fracOver95 > a.fracOver95 ? b : a));
      const c = {
        effect, count,
        peakAtMs: peakFrame.tMs,
        mean: worst('mean'),
        p99: worst('p99'),
        p999: worst('p999'),
        max: worst('max'),
        fracOver50: worst('fracOver50'),
        fracOver75: worst('fracOver75'),
        fracOver95: worst('fracOver95'),
        fracOver99: worst('fracOver99'),
        frames,
      };
      results.cases.push(c);
      console.log(
        `  ${effect.padEnd(9)} n=${String(count).padStart(2)}  ` +
        `mean ${c.mean.toFixed(4)}  p99 ${c.p99.toFixed(4)}  ` +
        `>0.95 ${(c.fracOver95 * 100).toFixed(3)}%  >0.75 ${(c.fracOver75 * 100).toFixed(3)}%  ` +
        `(peak at ${c.peakAtMs} ms)`,
      );
    }
  }
} finally {
  await page.close();
  await browser.close();
  cleanup();
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 2));

/* ---- the ratio table: the only thing that answers the question ---- */
console.log('\n=== growth against the 1-flash case ===');
for (const effect of ['explosion', 'muzzle']) {
  const one = results.cases.find((c) => c.effect === effect && c.count === 1);
  console.log(`\n  ${effect}`);
  for (const c of results.cases.filter((x) => x.effect === effect)) {
    const r = (k) => {
      const d = one[k] - results.baseline[k];
      const v = c[k] - results.baseline[k];
      return Math.abs(d) < 1e-6 ? '  n/a' : `x${(v / d).toFixed(2)}`;
    };
    console.log(
      `    n=${String(c.count).padStart(2)}  ` +
      `mean ${r('mean').padStart(7)}   ` +
      `area>0.95 ${r('fracOver95').padStart(7)}   ` +
      `area>0.75 ${r('fracOver75').padStart(7)}   ` +
      `area>0.50 ${r('fracOver50').padStart(7)}`,
    );
  }
}
console.log(`\nwrote ${join(OUT, 'report.json')}`);

/**
 * ============================================================================
 * VOLTMARCH — tools/bloom-hdr-ab.mjs
 * ============================================================================
 * WHERE DOES THE HALO GO? A LADDER, NOT A SCORECARD.
 *
 *   node tools/bloom-hdr-ab.mjs [--size 1280x720] [--no-build]
 *                               [--shots 03-terrain-closeup,01-establishing-base]
 *
 * `RENDER_FINDINGS.md` §7f left ONE weight-3 failure open: the node path's
 * bloom halo is systematically weaker, and the parameters were already proved
 * identical field by field, so "the difference is in the HDR reaching it" was
 * the standing hypothesis. This tool is the instrument that separates the two
 * halves, and it does it on the REAL GAME rather than on a synthetic quad,
 * because the thing under suspicion is the scene.
 *
 * ── THE LADDER, AND WHY EACH RUNG IS SHAPED THIS WAY ────────────────────────
 * Four captures per fixture per arm, all at the same pose, same size, same
 * settle:
 *
 *   scene       post OFF. The renderer's own tonemap draws the raw scene.
 *   scene-dim   post OFF at exposure/4. AgX is monotonic but COMPRESSIVE at the
 *               top, so two different HDR values above ~1 land within a byte of
 *               each other at normal exposure. Dropping exposure slides the
 *               highlights down into the steep part of the curve, which is the
 *               only way to see an HDR difference through an 8-bit canvas
 *               without a float readback. This rung is the whole reason the
 *               tool can answer "is the HDR the same" at all.
 *   nobloom     the shipped chain with ONLY the bloom pass off.
 *   full        the shipped chain.
 *
 * `full` minus `nobloom`, per arm, IS the halo — measured rather than inferred
 * from a whole-frame percentile. Comparing that difference across the two arms
 * is the measurement §7f wanted; comparing `scene` and `scene-dim` across the
 * two arms is what says whether the input to the pass was ever the same.
 *
 * GRADE STAYS ON IN `nobloom` AND `full` ON PURPOSE. Turning it off flips
 * `PostGraph.needsOutputColorTransform`, which moves WHO does the sRGB encode
 * on the node arm and not on the WebGL one — an arm-asymmetric change, i.e.
 * exactly the confound this tool exists to avoid.
 *
 * ── GPU FRUGALITY IS A HARD CONSTRAINT HERE ─────────────────────────────────
 * The host has reset its GPU driver twice on the WebGPU path. 1280x720 by
 * default, one browser at a time closed before the next opens, no 1440p, and
 * `npm run shots` is not run at all. The defect is a systematic ratio, so it
 * reproduces small.
 *
 * ── THE BACKEND IS ASSERTED, NEVER ASSUMED ──────────────────────────────────
 * `channel: 'chrome'` for the WebGPU arm (§7c: the bundled Chromium cannot load
 * `dxil.dll` here and falls back to WebGL2 while still reporting
 * `navigator.gpu`), and `__VM.rendererHandle.backend` is read and compared. A
 * `webgl2-fallback` arm is a THIRD renderer and is refused, not labelled. The
 * adapter string is recorded too, because every WebGPU number this project has
 * was taken on an integrated part and the machine now resolves a discrete one.
 * ============================================================================
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

import { build, serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'bloom-hdr-ab', 'out');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const [W, H] = flag('size', '1280x720').split('x').map(Number);
const SETTLE = Number(flag('settle', '10'));
const noBuild = argv.includes('--no-build');

/** Poses copied verbatim from `tools/shoot.mjs`'s SHOTS table. */
const FIXTURES = {
  '03-terrain-closeup': { flags: { shot: 'terrain-showcase', seed: 3 }, focus: [256, 256, 30] },
  '01-establishing-base': { flags: { shot: 'allied-base', seed: 7 }, focus: [256, 256, 62] },
  '11-dusk-mood': { flags: { shot: 'allied-base', seed: 7, art: 'dusk' }, focus: [256, 256, 62] },
};
const WANT = flag('shots', '03-terrain-closeup,01-establishing-base').split(',');

/**
 * The rungs, expressed as a PASS SET rather than as `setPostEnabled`.
 *
 * `setPostEnabled(false)` IS NOT ARM-SYMMETRIC AND CANNOT BE USED HERE.
 * `post.ts`'s WebGL chain falls back to `renderer.render(scene, camera)` when
 * it is inactive; `createNodeBackedPostChain.render` calls `chain.render()`
 * unconditionally, so on the node arm the whole graph still draws — and
 * `applyToneMapping` has meanwhile switched the RENDERER back to AgX while the
 * grade is still in the graph doing AgX itself. One arm would have been
 * measuring a scene and the other a double-tonemapped graph.
 *
 * Emptying the pass list instead leaves both arms in the same shape: exactly
 * one scene draw, tonemapped and sRGB-encoded exactly once, by the renderer on
 * WebGL and by `RenderPipeline.outputColorTransform` on the node path.
 */
const RUNGS = [
  { id: 'scene', passes: { ao: false, bloom: false, grade: false, smaa: false }, exposure: null },
  { id: 'scene-dim', passes: { ao: false, bloom: false, grade: false, smaa: false }, exposure: 0.25 },
  { id: 'nobloom', passes: { ao: true, bloom: false, grade: true, smaa: true }, exposure: null },
  { id: 'full', passes: { ao: true, bloom: true, grade: true, smaa: true }, exposure: null },
];

/* ------------------------------------------------------------------ */
/* Image statistics                                                    */
/* ------------------------------------------------------------------ */

/** Rec.709 luma over sRGB bytes — the same quantity §7f quotes as "luminance". */
function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function raw(buf) {
  return sharp(buf).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
}

function statsOf(px) {
  const hist = new Float64Array(256);
  let sum = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    const y = luma(px[i], px[i + 1], px[i + 2]);
    sum += y;
    hist[Math.min(255, Math.round(y))]++;
  }
  let acc = 0;
  let p99 = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * 0.99) { p99 = v; break; }
  }
  let blown = 0;
  for (let v = 250; v < 256; v++) blown += hist[v];
  return { mean: sum / n / 255, p99: p99 / 255, blown: blown / n };
}

/**
 * `b - a` over luma, restricted to pixels where the halo can live.
 *
 * `addedMean` is the mean of the POSITIVE part over the whole frame — the
 * energy the bloom put back — and `addedPx` is what fraction of the frame it
 * touched at all. A halo that is present but weaker shows as a smaller
 * `addedMean` at a similar `addedPx`; a halo that is missing shows as both
 * collapsing.
 */
function deltaOf(a, b) {
  let added = 0;
  let touched = 0;
  let maxAdd = 0;
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const d = luma(b[i], b[i + 1], b[i + 2]) - luma(a[i], a[i + 1], a[i + 2]);
    if (d > 0) { added += d; touched++; if (d > maxAdd) maxAdd = d; }
  }
  return { addedMean: added / n / 255, addedPx: touched / n, maxAdd: maxAdd / 255 };
}

/** Cross-arm comparison of two captures of the same rung. */
function crossArm(a, b) {
  let changed = 0;
  let maxDelta = 0;
  let signed = 0;
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(
      Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]),
    );
    if (d > 0) changed++;
    if (d > maxDelta) maxDelta = d;
    signed += luma(b[i], b[i + 1], b[i + 2]) - luma(a[i], a[i + 1], a[i + 2]);
  }
  return { changed: changed / n, maxDelta, meanSigned: signed / n / 255 };
}

/* ------------------------------------------------------------------ */
/* One arm                                                             */
/* ------------------------------------------------------------------ */

async function runArm(server, gpu, fixtures) {
  const browser = await chromium.launch({
    headless: true,
    ...(gpu === 'webgpu' ? { channel: 'chrome' } : {}),
    args: [
      '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio',
      '--force-device-scale-factor=1',
    ],
  });

  const out = {};
  try {
    for (const name of fixtures) {
      const fx = FIXTURES[name];
      if (fx === undefined) throw new Error(`unknown fixture ${name}`);

      const page = await browser.newPage({
        viewport: { width: W, height: H }, deviceScaleFactor: 1,
      });
      page.setDefaultTimeout(180_000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e.message)));

      const qs = new URLSearchParams({ ...fx.flags, tier: 'high' });
      if (gpu === 'webgpu') qs.set('gpu', 'webgpu');
      await page.goto(`${server.origin}?${qs}`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null,
        { timeout: 120_000 });
      await page.evaluate(() => window.__VM.ready());
      // The curtain, not `ready()` — see `tools/gpu-frame-ab.mjs`.
      await page.waitForFunction(() => {
        const c = document.getElementById('loading');
        return c === null || c.hidden === true;
      }, null, { timeout: 120_000 });

      const backend = await page.evaluate(() => window.__VM.rendererHandle.backend);
      if (backend !== gpu) {
        throw new Error(
          `asked for '${gpu}', live backend is '${backend}'. A WebGL2 fallback is a THIRD ` +
          'renderer and its pixels are not this arm\'s.',
        );
      }
      const adapter = await page.evaluate(async () => {
        if (navigator.gpu === undefined) return null;
        try {
          const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
          const i = a === null ? null : await a.info;
          return i === null ? null : { vendor: i.vendor, architecture: i.architecture };
        } catch { return null; }
      });

      await page.evaluate(async (o) => {
        const vm = window.__VM;
        vm.setUiVisible(false);
        vm.pause();
        vm.setSize(o.w, o.h);
        vm.focusOn(o.fx[0], o.fx[1], o.fx[2]);
        await vm.advanceFrames(Math.round(o.settle * 60));
      }, { w: W, h: H, fx: fx.focus, settle: SETTLE });

      const baseExposure = await page.evaluate(() => window.__VM.config.renderer.exposure);

      const shots = {};
      const chains = {};
      for (const rung of RUNGS) {
        const got = await page.evaluate(async (o) => {
          const vm = window.__VM;
          /*
           * ORDER MATTERS. Every pass toggle re-applies the tone-mapping mode,
           * and `setToneMappingMode` overwrites `toneMappingExposure` from
           * `cfg.exposure` — so the exposure write has to land AFTER the mode
           * settles, or the dim rung silently renders at the stock 1.05 like
           * every other one.
           */
          for (const [id, on] of Object.entries(o.passes)) vm.setPass(id, on);
          vm.setExposure(o.exposure === null ? o.base : o.base * o.exposure);
          await vm.advanceFrames(4);
          await vm.waitFrames(2);
          return {
            url: await vm.screenshot({ mime: 'image/png' }),
            /*
             * READ BACK WHICH PASSES ACTUALLY RAN. The reason this line exists
             * is the defect noted on `RUNGS`: a toggle that silently does
             * nothing is exactly the failure this whole file is chasing, and a
             * probe with no such check would have reported it as a finding
             * about the image.
             */
            chain: vm.stats().post,
          };
        }, { ...rung, base: baseExposure });
        shots[rung.id] = Buffer.from(got.url.split(',')[1], 'base64');
        chains[rung.id] = got.chain;
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `${name}--${gpu}--${rung.id}.png`), shots[rung.id]);
      }

      out[name] = { shots, chains, backend, adapter, errors };
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Drive                                                               */
/* ------------------------------------------------------------------ */

if (!noBuild) await build(ROOT, { log: console.log });
const server = await serve({ root: ROOT, mode: 'preview', portHint: 4381, log: console.log });

let code = 0;
try {
  const arms = {};
  for (const gpu of ['webgl', 'webgpu']) {
    console.log(`\n== arm ${gpu} ==`);
    arms[gpu] = await runArm(server, gpu, WANT);
    console.log(`   backend ok, ${WANT.length} fixture(s)`);
  }

  const report = { size: `${W}x${H}`, settle: SETTLE, when: new Date().toISOString(), fixtures: {} };

  for (const name of WANT) {
    const entry = {
      adapter: arms.webgpu[name].adapter,
      chains: { webgl: arms.webgl[name].chains, webgpu: arms.webgpu[name].chains },
      errors: { webgl: arms.webgl[name].errors, webgpu: arms.webgpu[name].errors },
      rungs: {}, halo: {}, cross: {},
    };
    const px = {};
    for (const gpu of ['webgl', 'webgpu']) {
      px[gpu] = {};
      for (const rung of RUNGS) {
        px[gpu][rung.id] = (await raw(arms[gpu][name].shots[rung.id])).data;
      }
    }
    for (const rung of RUNGS) {
      entry.rungs[rung.id] = {
        webgl: statsOf(px.webgl[rung.id]),
        webgpu: statsOf(px.webgpu[rung.id]),
      };
      entry.cross[rung.id] = crossArm(px.webgl[rung.id], px.webgpu[rung.id]);
    }
    entry.halo.webgl = deltaOf(px.webgl.nobloom, px.webgl.full);
    entry.halo.webgpu = deltaOf(px.webgpu.nobloom, px.webgpu.full);
    report.fixtures[name] = entry;
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(report, null, 2));

  const pc = (v) => `${(v * 100).toFixed(3)}%`;
  for (const [name, e] of Object.entries(report.fixtures)) {
    console.log(`\n### ${name}   adapter ${JSON.stringify(e.adapter)}`);
    console.log('  pass list as the page reported it');
    for (const rung of RUNGS) {
      console.log(
        `    ${rung.id.padEnd(11)} webgl=${String(e.chains.webgl[rung.id]).padEnd(28)} ` +
        `webgpu=${e.chains.webgpu[rung.id]}`,
      );
    }
    console.log('  rung        arm     mean     p99      >=250');
    for (const rung of RUNGS) {
      for (const gpu of ['webgl', 'webgpu']) {
        const s = e.rungs[rung.id][gpu];
        console.log(
          `  ${rung.id.padEnd(11)} ${gpu.padEnd(7)} ${s.mean.toFixed(4)}   ` +
          `${s.p99.toFixed(4)}   ${pc(s.blown)}`,
        );
      }
    }
    console.log('  cross-arm (webgpu - webgl), same rung');
    for (const rung of RUNGS) {
      const c = e.cross[rung.id];
      console.log(
        `    ${rung.id.padEnd(11)} ${pc(c.changed)} of px, max delta ${c.maxDelta}, ` +
        `mean signed ${(c.meanSigned * 255).toFixed(3)}/255`,
      );
    }
    console.log('  halo = full - nobloom');
    for (const gpu of ['webgl', 'webgpu']) {
      const h = e.halo[gpu];
      console.log(
        `    ${gpu.padEnd(7)} addedMean ${(h.addedMean * 255).toFixed(4)}/255  ` +
        `over ${pc(h.addedPx)} of px, peak +${(h.maxAdd * 255).toFixed(1)}`,
      );
    }
    const r = e.halo.webgpu.addedMean / e.halo.webgl.addedMean;
    console.log(`    ratio webgpu/webgl = ${r.toFixed(4)}`);
  }
  console.log(`\nwrote ${OUT}`);
} catch (err) {
  console.error(err);
  code = 1;
} finally {
  server.stop();
}
process.exit(code);

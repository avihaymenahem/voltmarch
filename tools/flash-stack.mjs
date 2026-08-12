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
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * A HINT — see `tools/lib/serve.mjs`. Four other tools hard-coded this same
 * 4319, which is why the refusal that used to live at the bottom of this file
 * ("something is already serving, kill it") fired on a sibling as often as on a
 * leak, and told the reader to kill a process that was doing its job.
 */
const PORT_HINT = 4319;

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
 * `--ablate` mode: n=1 and n=20 explosions at their measured peak, with each
 * contributing layer switched off in turn.
 *
 * IT USED TO KNOW ABOUT ONLY TWO LAYERS — the additive quads and the point
 * lights — and it warned that "a fix aimed at only one of them would leave the
 * other to produce a fifth bug report". The fifth report arrived anyway,
 * because of two defects in this function rather than in the renderer:
 *
 *   1. `getObjectByName('VfxAdditive')` ALWAYS RETURNED NULL. That string is a
 *      MATERIAL name (src/vfx/Particles.ts:1245); `getObjectByName` searches
 *      Object3D names. So the additive arm never disabled anything, and its
 *      "removing every additive quad costs 0.25pp" was a measurement of nothing.
 *   2. `VfxLitSmoke` — the fireball billows, and the largest bright area in the
 *      frame — was not in the list at all, so no arm could ever see it.
 *
 * Both are fixed. The mask list is now material-name driven and every case
 * reports how many meshes it actually hid, so a silent no-op cannot pose as
 * "that layer does not matter" again.
 */
const ABLATE = argv.includes('--ablate');

/** Luminance distribution of one PNG buffer, in sRGB — the bible's frame. */
async function measure(buf) {
  const img = sharp(buf).removeAlpha();
  const { width: W, height: H } = await img.metadata();
  const raw = await img.raw().toBuffer();
  const n = W * H;
  const lum = new Float32Array(n);
  let sum = 0, over50 = 0, over75 = 0, over95 = 0, over99 = 0, blue = 0;
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const L = (0.2126 * raw[p] + 0.7152 * raw[p + 1] + 0.0722 * raw[p + 2]) / 255;
    lum[i] = L;
    sum += L;
    if (L > 0.50) over50++;
    if (L > 0.75) over75++;
    if (L > 0.95) over95++;
    if (L > 0.99) over99++;
    // BLUE GLARE. Every luminance percentile above is colour-blind, and the
    // report is not: "The Blue explosion still tooooo huge". A daylight
    // battlefield has no blue-dominant bright pixels of its own — the ground is
    // warm, the sky is not in frame at this pitch — so a lifted count here is
    // an arc or a beam and nothing else. The 12/255 margin is wide enough that
    // neutral white (which the fireball core is) never qualifies.
    //
    // The BASELINE frame already reads ~6.5% here, and that is correct rather
    // than a flaw in the metric: the grade's shadow tint is a HemisphereLight
    // sky term, so lit ground in shadow genuinely is blue-dominant. Only the
    // DELTA against baseline is the signal.
    if (L > 0.50 && raw[p + 2] > raw[p] + 12) blue++;
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
    fracBlue: blue / n,
  };
}

/* ------------------------------------------------------------------ */

/**
 * THE ARC SWEEP — the measurement this instrument was missing.
 *
 * `src/core/config.ts` says so in the VFX_LIGHTS block, verbatim:
 *
 *     tools/flash-stack.mjs never caught this because it only ever calls
 *     `V.explode()` — it has no tesla or prism case at all, so the brightest
 *     row in this table has never been measured by the instrument built to
 *     police it.
 *
 * `teslaArc` was cut 26 -> 6.5 and `prism` 22 -> 5.5 on a SCREENSHOT rather
 * than on a number, because there was no number to be had. Both are still the
 * only blue emitters in the game, and the report came back.
 *
 * Two arms per effect, because a light and a ribbon fail differently and the
 * fix for one is not the fix for the other:
 *
 *   lights-off    the point-light wash alone, by difference
 *   ribbons-off   the additive ribbon quads alone, by difference
 *
 * Reported against `fracBlue` as well as `fracOver95`: a wide soft wash and a
 * small hot core can carry identical blown-white area and look nothing alike,
 * and "huge" is a statement about the first one.
 */
async function arcSweep(page, results) {
  const RIBBONS = ['VfxBeamOverlay', 'VfxRibbonDepth'];
  /*
   * THE SPRITE LAYER BELONGS IN HERE TOO, and leaving it out made the first
   * `impact` run unreadable: its `no-ribbons` arm reported `hit 2/0` — two
   * meshes matched, ZERO of them actually drawing — because the starburst is
   * emitted through `emitAdditive`, the PARTICLE pool, not through a ribbon
   * batch. Its `everything-off` then sat at +0.73pp instead of on the baseline,
   * i.e. the arm list did not account for the effect it was measuring.
   *
   * A control that does not reach the baseline is the tell that the mask list
   * is incomplete. It is the same lesson as the `STILL DREW` column: an arm
   * that suppresses nothing reads exactly like a layer that costs nothing.
   */
  const SPRITES = ['VfxAdditive', 'VfxLitSmoke', 'VfxDebris'];
  const arms = [
    ['all-on', [], true],
    ['no-lights', [], false],
    ['no-ribbons', RIBBONS, true],
    ['no-sprites', SPRITES, true],
    ['everything-off', [...RIBBONS, ...SPRITES], false],
  ];
  for (const effect of ['tesla', 'prism', 'impact']) {
    for (const count of [1, 4]) {
      for (const [label, suppress, lights] of arms) {
        const url = await page.evaluate(
          async ({ effect, count, suppress, lights }) => {
            const V = window.__vmVfx;
            const RA = window.__VM;
            V.clear();
            V.timeScale(0);
            const f = RA.rig.focus;
            for (let i = 0; i < count; i++) {
              const a = i * 2.39996323;
              const r = count === 1 ? 0 : 6 * Math.sqrt(i / count);
              const x = f.x + Math.cos(a) * r;
              const z = f.z + Math.sin(a) * r;
              // A 9 m arc from a coil head to a target hull, which is the
              // geometry a Tesla Coil or a Prism Tower actually produces.
              if (effect === 'tesla') V.tesla(x, f.y + 5.5, z, x + 9, f.y + 1.4, z, 900);
              else if (effect === 'prism') V.beam(x, f.y + 5.5, z, x + 9, f.y + 1.4, z, 'prism');
              // THE STARBURST ALONE. A Tesla Coil firing produces the bolt AND
              // this, and only the bolt had ever been measured — which is why
              // "tesla tower flash is HUGE HUGE HUGE" survived a pass that cut
              // the arc by 59%.
              else V.teslaImpact(x + 9, f.y + 1.4, z, 1);
            }
            // Arcs are SUSTAINED — the config note calls a live arc "the
            // brightest object in any RA3 frame containing one" and says it is
            // up for about a second. 120 ms is inside the hold, so this
            // photographs the arc at full strength rather than mid-decay.
            // 120 ms sits inside a sustained arc's hold. The starburst lives
            // 180 ms total and peaks early, so it is photographed at 60.
            V.advance(effect === 'impact' ? 60 : 120);
            await RA.waitFrames(3);

            // SUPPRESSING A RIBBON BATCH TOOK THREE TRIES, and the first two
            // both produced a confident "this layer costs nothing":
            //
            //   `mesh.visible = false`  — undone before it was measured.
            //     `RibbonBatch.end()` assigns `mesh.visible = quads > 0` on
            //     every upload, and `RA.screenshot()` renders through the
            //     system registry (task #46), so the frame being captured is
            //     the frame that puts the layer back.
            //   `material.opacity = 0` / black  — read by nobody. These are
            //     ShaderMaterials with a hand-written fragment stage that
            //     samples the ramp LUT; `opacity` and `color` are inherited
            //     properties its shader never mentions.
            //
            // `material.visible` is checked by the renderer when it builds the
            // render list, and `end()` never touches it. The tell for both
            // failures was `prism no-ribbons` reading BYTE-IDENTICAL to
            // `all-on` while still reporting a hit — the same shape as the
            // `VfxAdditive` defect this probe already had once.
            const hit = [];
            RA.scene.traverse((o) => {
              const m = o.material;
              if (!m) return;
              const names = Array.isArray(m) ? m.map((x) => x.name) : [m.name];
              if (names.some((n) => suppress.includes(n))) hit.push(o);
            });
            const restore = [];
            for (const o of hit) {
              for (const mm of (Array.isArray(o.material) ? o.material : [o.material])) {
                restore.push([mm, mm.visible]);
                mm.visible = false;
              }
            }
            const pool = RA.scene.getObjectByName('VfxLightPool');
            if (pool) pool.visible = lights;

            const shot = await RA.screenshot();
            // Drawn AFTER the shot: proof the arc was actually on screen. An
            // arm that photographs an empty frame reports a clean -0.0pp and
            // reads exactly like "this layer costs nothing".
            const drew = hit.filter((o) => o.visible).length;
            for (const [mm, vis] of restore) mm.visible = vis;
            if (pool) pool.visible = true;
            return {
              shot, suppressed: hit.length, drew,
              poolFound: pool !== undefined && pool !== null,
            };
          },
          { effect, count, suppress, lights },
        );
        const buf = Buffer.from(url.shot.split(',')[1], 'base64');
        writeFileSync(join(OUT, `arc-${effect}-${String(count).padStart(2, '0')}-${label}.png`), buf);
        const m = await measure(buf);
        results.cases.push({
          effect: `arc-${effect}`, count, label,
          suppressed: url.suppressed, poolFound: url.poolFound, ...m,
        });
        const vsBase = (m.fracOver95 - results.baseline.fracOver95) * 100;
        const blueBase = (m.fracBlue - results.baseline.fracBlue) * 100;
        console.log(
          `  ${effect.padEnd(6)} n=${count} ${label.padEnd(15)}  ` +
          `>0.95 ${(m.fracOver95 * 100).toFixed(3)}% (base ${vsBase >= 0 ? '+' : ''}${vsBase.toFixed(3)}pp)  ` +
          `BLUE ${(m.fracBlue * 100).toFixed(3)}% (base ${blueBase >= 0 ? '+' : ''}${blueBase.toFixed(3)}pp)  ` +
          `[hit ${url.suppressed}/${url.drew} mesh drawn, pool ${url.poolFound ? 'found' : 'MISSING'}]`,
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log('> building...');
await build(ROOT, { log: () => {} });

/*
 * MEASURE OUR OWN BUILD, AND PROVE IT RATHER THAN REFUSING ON A GUESS.
 *
 * This block used to be: probe the fixed port, and if anything answers, throw
 * "that is almost certainly a leaked preview — kill it". Two things wrong with
 * that, and the second is the expensive one. The probe aborted after 1500 ms,
 * so a busy machine read a LIVE neighbour as an empty port and the tool went on
 * to measure it; and even when the probe worked, four sibling tools also used
 * 4319, so the advice to kill whatever holds it was as likely to be aimed at a
 * colleague's running capture as at a leak.
 *
 * `serve()` steps off a busy port onto one the OS says is free and then
 * byte-compares what that origin serves against the `dist/` just built here. A
 * before/after comparison taken off a stale or foreign server reads exactly
 * like "the change had no effect", which is the single most expensive wrong
 * answer this tool can give.
 */
console.log('> serving...');
const server = await serve({
  root: ROOT, mode: 'preview', portHint: PORT_HINT, log: console.log,
});
const BASE = server.origin;
const cleanup = () => server.stop();

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
  server.assertAlive('the flash sweep');
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
    /** Camera position of the first arm; every later arm is reported against it. */
    let basePose = null;
    // Layer masks: [label, suppressed material names, point lights on].
    //
    // `VfxLitSmoke` was NOT in the original list, and that omission is why four
    // fixes missed. The additive quads and the light pool were the only two
    // things anyone could switch off, so "it is not those" kept turning into
    // "it must be the additive quads after all". The fireball billows are lit
    // smoke, not additive, and nothing here could see them.
    /*
     * [label, suppressed material names, point lights on, mode].
     *
     * `mode` is the third defect this probe has had, and the one that made the
     * previous run uninterpretable: HIDING a layer answers two questions at
     * once and cannot tell them apart. Every arm read BRIGHTER with a bright
     * layer switched off, which is only paradoxical if you assume `visible =
     * false` measures "how much light does this layer add". It does not — it
     * measures that MINUS "how much brighter stuff does this layer cover up",
     * and an alpha-blended fireball billow sitting over ground the point
     * lights have blown out is mostly the second thing.
     *
     *   'hide'   the layer is not drawn at all      (emission - occlusion)
     *   'black'  the layer is drawn, at zero gain   (occlusion alone)
     *
     * The difference between the two is the layer's own emission, isolated.
     */
    const masks = [
      ['all-on', [], true, 'hide'],
      ['no-additive', ['VfxAdditive'], true, 'hide'],
      ['no-litsmoke', ['VfxLitSmoke'], true, 'hide'],
      ['no-debris', ['VfxDebris'], true, 'hide'],
      ['no-lights', [], false, 'hide'],
      ['sprites-off', ['VfxAdditive', 'VfxLitSmoke', 'VfxDebris'], true, 'hide'],
      ['everything-off', ['VfxAdditive', 'VfxLitSmoke', 'VfxDebris'], false, 'hide'],
      // The same three layers, DRAWN but black. Compare each against its
      // 'hide' twin: if 'black' is darker, the layer was covering something
      // brighter than itself and the curtain is doing real work.
      ['black-additive', ['VfxAdditive'], true, 'black'],
      ['black-litsmoke', ['VfxLitSmoke'], true, 'black'],
      ['black-sprites', ['VfxAdditive', 'VfxLitSmoke', 'VfxDebris'], true, 'black'],
      /*
       * THE DECAL ARM — the leading hypothesis for the residue that survives
       * hiding every VFX mesh.
       *
       * `GroundDecals` is a separate system with its own mesh and material, so
       * it is invisible both to a "what became visible during the burst" scan
       * and to every VFX material-name mask. The timing fits: the arms
       * photograph at 180 ms, by which point the flash is gone and the fireball
       * is fading, yet the residue is at its largest.
       *
       * PREDICTION, recorded before the run so it cannot be rationalised after:
       * this should measure ~0. The decal material blends DstColor x Zero
       * (src/world/Decals.ts:582) — a MULTIPLY — so a decal can only ever
       * darken the ground and cannot add a blown-white pixel. If it measures
       * large, that assumption is wrong and worth knowing; if it measures zero,
       * the hypothesis is dead and the `drew` column above is the answer.
       */
      ['no-decals', ['GroundDecals'], true, 'hide'],
      ['no-decals-no-sprites', ['GroundDecals', 'VfxAdditive', 'VfxLitSmoke', 'VfxDebris'], true, 'hide'],
      ['nothing-at-all', ['GroundDecals', 'VfxAdditive', 'VfxLitSmoke', 'VfxDebris'], false, 'hide'],
    ];
    /*
     * THE CONTROL THIS PROBE NEVER HAD, and the reason its last run could not
     * be read. `count: 0` runs the IDENTICAL path — clear, timeScale, the
     * spawn loop with nothing in it, advance, waitFrames, mask, screenshot —
     * and spawns no explosion. If it reads at the baseline, the path is clean
     * and every gap above baseline is a real explosion artefact. If it does
     * not, the arms are measuring the harness and no tuning decision taken
     * from them means anything.
     *
     * The previous run reported `everything-off` at 21.164% against a 5.983%
     * baseline and had no way to tell those two readings apart.
     */
    for (const count of [0, 1, 20]) {
      for (const [label, suppress, lights, mode] of masks) {
        if (count === 0 && label !== 'all-on' && label !== 'everything-off') continue;
        const url = await page.evaluate(
          async ({ count, suppress, lights, mode }) => {
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
            // 'VfxAdditive' IS A MATERIAL NAME (src/vfx/Particles.ts:1245),
            // not an Object3D name. `getObjectByName` only searches Object3D
            // names, so the original `getObjectByName('VfxAdditive')` returned
            // null on every run and THIS ARM OF THE ABLATION NEVER DISABLED
            // ANYTHING. It reported ~0.25pp for "remove every additive quad",
            // and at n=1 it read BRIGHTER with the layer supposedly off, which
            // is the tell. Match on the material instead.
            const hit = [];
            RA.scene.traverse((o) => {
              const m = o.material;
              if (!m || !o.visible) return;
              const names = Array.isArray(m) ? m.map((x) => x.name) : [m.name];
              if (names.some((n) => suppress.includes(n))) hit.push(o);
            });

            // 'black' keeps the draw and its depth behaviour and takes the
            // OUTPUT to zero, which is the only way to separate a layer's own
            // emission from the brighter thing it is standing in front of.
            // `colorWrite = false` would not do it: that skips the colour write
            // entirely and leaves whatever is behind, which is the same answer
            // as hiding. Additive-blended black contributes exactly nothing and
            // still writes depth if the material already did.
            /*
             * `o.visible = false` IS NOT RELIABLE HERE, and this is the fourth
             * defect this probe has had.
             *
             * `ParticleSystem` reassigns `mesh.visible = liveCount > 0` on every
             * upload (src/vfx/Particles.ts:994 and :1174), exactly as
             * `RibbonBatch.end()` does — and `RA.screenshot()` renders through
             * the system registry (task #46), so the frame being captured is a
             * frame that can put the layer straight back. The arc sweep below
             * hit this and produced a confident "this layer costs nothing"
             * twice before it was caught.
             *
             * `material.visible` is checked by the renderer when it builds the
             * render list and NOTHING in the vfx system touches it. `drew`,
             * reported per arm, is the proof: it counts how many of the meshes
             * this arm claims to have suppressed were still being drawn at the
             * shutter. A non-zero `drew` means the arm measured nothing.
             */
            const restore = [];
            for (const o of hit) {
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              for (const mm of mats) {
                restore.push([mm, mm.visible, mm.opacity, mm.color ? mm.color.clone() : null]);
                if (mode === 'black') {
                  // Kept for VfxDebris, whose MeshStandardMaterial does read
                  // both. For the two ShaderMaterials it is a no-op and the
                  // 'hide' twin is the meaningful measurement — see the note
                  // in the mask table above.
                  mm.opacity = 0;
                  if (mm.color) mm.color.setRGB(0, 0, 0);
                } else {
                  mm.visible = false;
                }
              }
              o.visible = false;
            }

            const pool = RA.scene.getObjectByName('VfxLightPool');
            // A MISSING POOL IS THE DEFECT-1 SHAPE ALL OVER AGAIN: the original
            // `getObjectByName('VfxAdditive')` returned null on every run and
            // the arm silently measured nothing. Report it rather than `if
            // (pool)`, so "lights make no difference" can never be a typo.
            if (pool) pool.visible = lights;
            const shot = await RA.screenshot();

            /*
             * THE CAMERA POSE AT THE MOMENT OF CAPTURE.
             *
             * Every arm that spawns explosions sits ~15pp over baseline no
             * matter which layers are drawn, and the n=0 control lands on the
             * baseline exactly. A constant offset that does not care what is
             * being rendered is not a rendering term — it is the FRAMING.
             *
             * `explode()` kicks the camera, and `timeScale(0)` is the reason
             * that matters here: with the VFX clock stopped the shake impulse
             * is applied and then never decays, so the camera is displaced for
             * the entire arm. The probe would be photographing a different
             * piece of a very bright parade ground and calling the difference
             * "explosion brightness".
             */
            const c = RA.camera;
            const pose = [
              +c.position.x.toFixed(3), +c.position.y.toFixed(3), +c.position.z.toFixed(3),
              +c.rotation.x.toFixed(5), +c.rotation.y.toFixed(5), +c.rotation.z.toFixed(5),
            ];

            // Counted BEFORE restoring: how many meshes this arm claims to
            // have suppressed were still on screen when the shutter opened.
            // Anything but 0 invalidates the arm.
            const drew = hit.filter((o) => {
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              return o.visible && mats.some((m) => m.visible);
            }).length;
            for (const o of hit) o.visible = true;
            for (const [mm, vis, op, col] of restore) {
              mm.visible = vis;
              mm.opacity = op;
              if (col && mm.color) mm.color.copy(col);
            }
            if (pool) pool.visible = true;
            return {
              shot, pose, suppressed: hit.length, drew,
              poolFound: pool !== undefined && pool !== null,
            };
          },
          { count, suppress, lights, mode },
        );
        const buf = Buffer.from(url.shot.split(',')[1], 'base64');
        writeFileSync(join(OUT, `ablate-${String(count).padStart(2, '0')}-${label}.png`), buf);
        const m = await measure(buf);
        results.cases.push({
          effect: 'ablate', count, label, mode,
          suppressed: url.suppressed, poolFound: url.poolFound, pose: url.pose, ...m,
        });
        if (basePose === null) basePose = url.pose;
        const drift = Math.hypot(...url.pose.slice(0, 3).map((v, i) => v - basePose[i]));
        const vsBase = (m.fracOver95 - results.baseline.fracOver95) * 100;
        console.log(
          `  ablate n=${String(count).padStart(2)} ${label.padEnd(15)}  ` +
          `mean ${m.mean.toFixed(4)}  >0.95 ${(m.fracOver95 * 100).toFixed(3)}%  ` +
          `(base ${vsBase >= 0 ? '+' : ''}${vsBase.toFixed(3)}pp)  ` +
          `>0.75 ${(m.fracOver75 * 100).toFixed(3)}%  ` +
          `[hit ${url.suppressed}, STILL DREW ${url.drew}, ` +
          `pool ${url.poolFound ? 'found' : 'MISSING'}, cam ${drift.toFixed(3)} m]`,
        );
      }
    }
  }

  if (ABLATE) await arcSweep(page, results);

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
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
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

/*
 * EXIT, RATHER THAN HOPING THE EVENT LOOP DRAINS.
 *
 * The report is on disk and the server is dead by the time this runs, so there
 * is nothing left worth waiting for — but a playwright browser or a piped
 * child stdio handle can keep the loop alive indefinitely, and a probe that
 * finishes its work and then hangs looks identical to a probe that froze
 * halfway. It cost a run to tell those apart once already.
 */
cleanup();
process.exit(0);

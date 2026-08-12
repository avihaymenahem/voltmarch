/**
 * PER-BUILDING SOBEL PROBE — the bible's #34 measured on the thing it is about.
 *
 *   node tools/sobel.mjs                        # every structure, four factions
 *   node tools/sobel.mjs meridian reclaim       # only keys matching a filter
 *   node tools/sobel.mjs --tag before           # label the run
 *   node tools/sobel.mjs --compare before after # delta table, no browser
 *   node tools/sobel.mjs --crops                # also write the PNG crops
 *   node tools/sobel.mjs --baseline --tag before  # with this pass undone
 *
 * Output: shots-sobel/<tag>.json, and shots-sobel/<tag>/<key>.png with --crops.
 *
 *
 * WHY THIS EXISTS, AND WHAT IT FIXES ABOUT THE NUMBER EVERYONE QUOTES
 * ------------------------------------------------------------------
 * `docs/RA3_LOOK_BIBLE.md` §13 #34 asks for "Sobel |grad|>25 coverage 28-36% on
 * units, 40-46% on buildings", and `tools/metrics.mjs` says in its own header
 * that this band "is measured on unit/building CROPS" — not on a whole frame,
 * which is why it is scored there against the observed RA3 spread instead.
 *
 * Nothing in the repo measured a crop. What DOES get quoted as "the building
 * Sobel number" is `StructureStats.edgeCoverage`, and that is a completely
 * different quantity: it is the Sobel coverage of the ATLAS TILES a model
 * samples, area-weighted, with no geometry, no silhouette, no lighting and no
 * shadow in it at all. The two are not comparable and must never be compared:
 *
 *   - the atlas number can only be raised by drawing more marks on the texture,
 *     which is exactly the pressure that grew a noise field the last time a
 *     Sobel floor was a gate (see `Greeble.ts` §7 and `BuildingFactory.ts` R1);
 *   - the CROP number moves with silhouette, chamfer, taper, plate layering and
 *     self-shadowing — the things a shape pass actually changes.
 *
 * So this tool measures the crop, and it is the only number in the repo that
 * belongs next to the bible's 40-46%.
 *
 *
 * HOW IT ISOLATES ONE BUILDING
 * ----------------------------
 * A studio render, not a match: the page boots the real game (real materials,
 * real sun, real post chain), then everything in the scene except lights and the
 * probe group is hidden and `__VM.setStudio(true)` flattens the background. One
 * structure is added at a time, framed at a distance proportional to its own
 * size so a 4 m wall and a 14 m yard are measured at the same apparent scale,
 * and the crop is the model's own screen-space bounding box.
 *
 * Two numbers come back per structure:
 *
 *   crop  Sobel coverage over the whole bounding-box crop. Background is flat,
 *         so this is "edge per unit of screen the building occupies" — the
 *         figure directly comparable to a crop taken out of an RA3 screenshot.
 *   body  the same hits restricted to the building's own pixels. Immune to how
 *         much empty air the bounding box happens to contain, which makes it
 *         the better metric for a BEFORE/AFTER delta on one structure.
 *
 * It reaches the four rosters by dynamic `import()` against the VITE DEV SERVER,
 * not the production bundle: two of the four factions publish no global handle,
 * and dev keeps every module addressable by source path. That is also why this
 * runs `vite` rather than `vite preview`.
 *
 * TRAP, and it cost a run: `__VM.ready()` resolving is not the same as the game
 * being on screen — `tools/shoot.mjs` documents the same thing. Wait for the
 * boot curtain to retract as well, or the first structure is photographed
 * against the loading screen and scores like a building made of text.
 */

import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/*
 * NOT `shots/sobel`, and this cost a completed 52-structure baseline.
 *
 * `tools/shoot.mjs` captures into a staging directory and then swaps it into
 * place with `for (const f of readdirSync(OUT)) rmSync(f)` — every entry in
 * `shots/` except its own lock file. That is correct for its own twelve PNGs
 * and catastrophic for anything else living there: another agent ran
 * `npm run shots` while this tool's output sat in `shots/sobel/`, and the
 * before-set went with it mid-session. Sibling directory, no shared parent.
 */
const OUT = join(ROOT, 'shots-sobel');
/**
 * A HINT — and the fifth tool to hard-code 4319, which is what made the number
 * worthless. `serve()` walks off a busy port onto one the OS says is free and
 * proves what it lands on; see the header of `tools/lib/serve.mjs`.
 */
const PORT_HINT = 4319;

/** The bible quotes its pixel tolerances at 1440p; so does every other probe here. */
const VIEWPORT = { width: 2560, height: 1440 };

/** Sobel |grad| threshold, on 0-255 luma. The bible's number, not a knob. */
const THRESHOLD = 25;

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  argv.splice(i, v !== undefined && !v.startsWith('--') ? 2 : 1);
  return v !== undefined && !v.startsWith('--') ? v : '';
};
const compare = flag('compare');
const wantCrops = flag('crops') !== null;
const headed = flag('headed') !== null;
/*
 * `--baseline` UNDOES THIS PASS IN THE PAGE, and it is the A/B procedure for it.
 *
 * `BuildingFactory.STRUCTURE_AO` holds the seam and edge terms that write into
 * the vertex-colour attribute. They cost no geometry, so a before/after on them
 * cannot be taken by counting anything — it has to be photographed. Reverting
 * the source between two runs would work and is what the first attempt did;
 * this is the same measurement without a window in which the checked-out file
 * says something its author does not mean.
 *
 * `as const` is a TypeScript assertion and nothing else: at runtime the export
 * is an ordinary object and its fields are writable. Set before the first
 * `lib.build`, which is what `INSTALL` guarantees.
 */
const baseline = flag('baseline') !== null;
const tag = flag('tag') ?? 'run';
const filters = argv.filter((a) => !a.startsWith('--'));

/* ==========================================================================
 * Sobel
 * ========================================================================== */

/**
 * Coverage over a raw RGB buffer, optionally restricted to a mask.
 * Luma weights match `tools/metrics.mjs` exactly so the two agree on what an
 * edge is.
 */
function sobel(buf, W, H, mask) {
  const n = W * H;
  const gray = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    gray[i] = (buf[p] * 0.299 + buf[p + 1] * 0.587 + buf[p + 2] * 0.114) | 0;
  }
  let hits = 0, total = 0, maskHits = 0, maskTotal = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1]
        + gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1];
      const gy = -gray[i - W - 1] - 2 * gray[i - W] - gray[i - W + 1]
        + gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1];
      const edge = Math.hypot(gx, gy) > THRESHOLD;
      total++;
      if (edge) hits++;
      if (mask !== undefined && mask[i] === 1) {
        maskTotal++;
        if (edge) maskHits++;
      }
    }
  }
  return {
    crop: total ? hits / total : 0,
    body: maskTotal ? maskHits / maskTotal : 0,
    cropPx: total,
    bodyPx: maskTotal,
  };
}

/* ==========================================================================
 * --compare: two saved runs, no browser
 * ========================================================================== */

if (compare !== null) {
  const other = argv[argv.length - 1] ?? 'run';
  const load = (t) => JSON.parse(readFileSync(join(OUT, `${t}.json`), 'utf8'));
  const a = load(compare), b = load(other);
  const byKey = new Map(b.rows.map((r) => [r.key, r]));
  console.log(`\n${compare} -> ${other}\n`);
  console.log(
    `${'structure'.padEnd(24)} ${'crop%'.padStart(7)} ${'->'.padStart(3)} ${'crop%'.padStart(7)}` +
    ` ${'d'.padStart(7)}   ${'body%'.padStart(7)} ${'->'.padStart(3)} ${'body%'.padStart(7)} ${'d'.padStart(7)}` +
    `   ${'tris'.padStart(6)} ${'d'.padStart(6)}`);
  let dc = 0, db = 0, dt = 0, n = 0;
  let skipped = 0;
  for (const r of a.rows) {
    const s = byKey.get(r.key);
    if (s === undefined) continue;
    // A suspect row on EITHER side poisons the delta, so neither is quoted.
    // Derived from `fill` as well as read from the flag, so a JSON written
    // before the flag existed is still filtered.
    const bad = (x) => x.suspect === true || x.fill > 0.95;
    if (bad(r) || bad(s)) { skipped++; continue; }
    n++;
    dc += s.crop - r.crop; db += s.body - r.body; dt += s.triangles - r.triangles;
    console.log(
      `${r.key.padEnd(24)} ${(r.crop * 100).toFixed(2).padStart(7)} ${'->'.padStart(3)} ` +
      `${(s.crop * 100).toFixed(2).padStart(7)} ${((s.crop - r.crop) * 100).toFixed(2).padStart(7)}   ` +
      `${(r.body * 100).toFixed(2).padStart(7)} ${'->'.padStart(3)} ${(s.body * 100).toFixed(2).padStart(7)} ` +
      `${((s.body - r.body) * 100).toFixed(2).padStart(7)}   ` +
      `${String(s.triangles).padStart(6)} ${String(s.triangles - r.triangles).padStart(6)}`);
  }
  console.log(
    `\nmean delta over ${n}: crop ${((dc / n) * 100).toFixed(2)} pts, ` +
    `body ${((db / n) * 100).toFixed(2)} pts, triangles ${dt >= 0 ? '+' : ''}${dt}` +
    (skipped > 0 ? `  (${skipped} suspect rows excluded)` : ''));
  process.exit(0);
}

/* ==========================================================================
 * The in-page probe
 * ========================================================================== */

/**
 * Everything below the `page.evaluate` boundary. Written as one function
 * because the page has no bundler for us — it is `import()` against dev.
 */
const INSTALL = async (opts) => {
  const VM = window.__VM;
  const THREE = VM.THREE;

  const [defs, factory, greeble, f3, f4, config] = await Promise.all([
    import('/src/art/BuildingDefs.ts'),
    import('/src/art/BuildingFactory.ts'),
    import('/src/art/Greeble.ts'),
    import('/src/art/Faction3Buildings.ts'),
    import('/src/art/Faction4Buildings.ts'),
    import('/src/core/config.ts'),
  ]);

  /*
   * `--baseline`: undo everything the shape pass changed, before a single model
   * is built. Two halves, and both have to be here rather than in the source,
   * because neither costs a triangle and a photograph is the only way to see
   * either of them.
   */
  const baseline = opts.baseline === true;
  if (baseline) {
    factory.STRUCTURE_AO.seamFloor = 1;
    factory.STRUCTURE_AO.edgeGain = 1;
  }

  /*
   * PRIVATE LIBRARIES, AND THE PREVIOUS VERSION OF THIS TOOL DID NOT HAVE THEM.
   *
   * `BuildingLibrary.build` is memoised on `list.key`, and the game has already
   * built all four rosters by the time the boot curtain retracts — so calling
   * `factory.buildingLibrary.build(...)` here returned the BOOT model and threw
   * away the palettes this file so carefully assembles. That was harmless while
   * the palettes matched. It stops being harmless the moment the tool wants to
   * measure an alternative: `--baseline` would have mutated `STRUCTURE_AO`
   * after every vertex colour had already been written, and reported a delta of
   * zero with total confidence.
   *
   * A fresh `BuildingLibrary` on a fresh `GreebleFactory` per run costs four
   * atlas bakes and makes the measurement a function of this file's inputs
   * alone. It also means the run cannot perturb the running game's materials.
   *
   * THREE of them, not one: `BuildingLibrary` keys its atlases and materials on
   * `${list.faction}`, and both later factions declare `'soviets'` for the
   * chamfer fraction. One shared library would hand the Pact and the
   * Reclamation the Soviet atlas and the Soviet material, which is precisely
   * why `Faction3Buildings.ts` and `Faction4Buildings.ts` each own a private
   * one in the game.
   */
  const shared = new factory.BuildingLibrary(new greeble.GreebleFactory());
  const mLib = new factory.BuildingLibrary(new greeble.GreebleFactory());
  const rLib = new factory.BuildingLibrary(new greeble.GreebleFactory());
  const coat = (c) => (baseline ? undefined : c);

  const rosters = [
    ...defs.STRUCTURE_MASS_LISTS.map((l) => ({
      list: l,
      lib: shared,
      army: l.faction,
      p: {
        structure: config.RA3_STRUCTURE_PALETTE[l.faction],
        pad: config.RA3_PAD_PALETTE[l.faction],
        panelDensity: l.faction === 'allies'
          ? config.BUILDING_GREEBLE.panelDensityAllies
          : config.BUILDING_GREEBLE.panelDensitySoviets,
        seed: l.faction === 'allies' ? 0x51 : 0x52,
        padSeed: l.faction === 'allies' ? 0x71 : 0x72,
        // Allies and Soviets name no coat: their surfaces are the ones the
        // `rivets` default was always right about, and this pass left them be.
      },
    })),
    ...f3.MERIDIAN_STRUCTURE_MASS_LISTS.map((l) => ({
      list: l, lib: mLib, army: 'meridian',
      p: {
        structure: f3.MERIDIAN_STRUCTURE_PALETTE, pad: f3.MERIDIAN_PAD_PALETTE,
        panelDensity: 2.4, seed: 0x4d_2b, padSeed: 0x4d_9d, coat: coat('stone'),
      },
    })),
    ...f4.RECLAIM_STRUCTURE_MASS_LISTS.map((l) => ({
      list: l, lib: rLib, army: 'reclaim',
      p: {
        structure: f4.RECLAIM_STRUCTURE_PALETTE, pad: f4.RECLAIM_PAD_PALETTE,
        panelDensity: 3.0, seed: 0x52_43, padSeed: 0x52_9d, coat: coat('scrap'),
      },
    })),
  ];

  // The studio: flat background, and nothing visible but lights and our rack.
  VM.setUiVisible(false);
  VM.setStudio(true);
  VM.pause();
  const group = new THREE.Group();
  group.name = 'sobelProbe';
  VM.scene.add(group);
  const hidden = [];
  for (const child of VM.scene.children) {
    if (child === group || child.isLight === true) continue;
    if (child.visible === false) continue;
    child.visible = false;
    hidden.push(child);
  }

  const SPOT = new THREE.Vector3(256, 0, 256);

  window.__sobel = {
    keys: rosters.map((r) => ({ key: r.list.key, army: r.army, cls: r.list.cls ?? 'structure' })),

    /**
     * Put one structure on the rack and frame it.
     *
     * NOT `model.prototype()`, and this is the single most important line in
     * the file. Every structure's vertex shader sinks the body by its whole
     * silhouette height unless the per-INSTANCE `aState.y` (buildProgress) says
     * otherwise, and a plain `THREE.Mesh` supplies no instanced attributes at
     * all — so a generic attribute defaults to (0,0,0,1), buildProgress reads 0,
     * and the building renders underground with only its `Feature.Static` pad
     * left above the surface. The first run of this tool measured pads for
     * fourteen structures and reported 0 px for both walls, which have no pad.
     *
     * (The same trap sits in `buildings.system.ts`'s `?parade` rack, which uses
     * `prototype()` directly and has therefore been photographing foundations.
     * That file is not mine to edit this round — see the report.)
     *
     * So the geometry is CLONED and given a per-vertex `aState` of
     * (hp 1, buildProgress 1, selected 0, seed 0). Cloning matters: the shared
     * geometry is handed to the render bridge's batcher by reference, and
     * writing an `aState` attribute onto it would collide with the instanced
     * one the batcher installs.
     */
    show(key) {
      group.clear();
      const entry = rosters.find((r) => r.list.key === key);
      const model = entry.lib.build(entry.list, entry.p, config.BUILDING_GREEBLE.atlasSize);

      const finished = (geo, mat) => {
        const g = geo.clone();
        const n = g.getAttribute('position').count;
        const st = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { st[i * 4] = 1; st[i * 4 + 1] = 1; }
        g.setAttribute('aState', new THREE.BufferAttribute(st, 4));
        const mesh = new THREE.Mesh(g, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
      };

      const root = new THREE.Group();
      root.add(finished(model.body, model.material));
      if (model.pad !== null) root.add(finished(model.pad, model.padMaterial));
      if (model.turret !== null) {
        const t = finished(model.turret, model.material);
        t.position.set(model.turretPivot[0], model.turretPivot[1], model.turretPivot[2]);
        root.add(t);
      }
      root.position.copy(SPOT);
      group.add(root);

      const size = Math.max(model.bounds[0], model.bounds[1], model.bounds[2]);
      // Normalised framing: every structure is measured at the same apparent
      // scale, so a 4 m wall is not scored against a 14 m yard's pixel budget.
      VM.focusOn(SPOT.x, SPOT.z + model.bounds[1] * 0.34, size * 3.6);
      return { triangles: model.stats.triangles, parts: model.stats.parts, bounds: model.bounds };
    },

    /**
     * Screen-space AABB of the rack, padded, in CSS pixels — the frame
     * `page.screenshot({ clip })` works in. Using the drawing-buffer size here
     * instead would silently mis-crop the moment resolution scaling is not 1.
     */
    box() {
      const cam = VM.camera;
      cam.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(group);
      const w = window.innerWidth, h = window.innerHeight;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const v = new THREE.Vector3();
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
        v.project(cam);
        const px = (v.x * 0.5 + 0.5) * w, py = (-v.y * 0.5 + 0.5) * h;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px);
        y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      const pad = 8;
      const cx = Math.max(0, Math.floor(x0 - pad)), cy = Math.max(0, Math.floor(y0 - pad));
      return {
        x: cx, y: cy,
        width: Math.min(w, Math.ceil(x1 + pad)) - cx,
        height: Math.min(h, Math.ceil(y1 + pad)) - cy,
        // True when the model ran off the edge of the frame: the crop is then a
        // partial building and the number is not comparable to the others.
        clipped: x0 < 0 || y0 < 0 || x1 > w || y1 > h,
      };
    },

    /** Empty the rack, so the next capture is the background alone. */
    clear() { group.clear(); },

    restore() {
      for (const c of hidden) c.visible = true;
      VM.setStudio(false);
      group.removeFromParent();
    },
  };
  return window.__sobel.keys;
};

/* ==========================================================================
 * Driver
 * ========================================================================== */

mkdirSync(OUT, { recursive: true });
if (wantCrops) mkdirSync(join(OUT, tag), { recursive: true });

/*
 * A PRIVATE DEP CACHE, and it is not paranoia.
 *
 * Vite's optimiser cache lives in `node_modules/.vite`, keyed on the resolved
 * dep set. Another dev server running from the same checkout — and on this
 * project there usually is one — invalidates it, at which point THIS server
 * re-optimises and hard-reloads the page. Sharing the cache produced an endless
 * reload loop that ate four boot attempts and never got to a single structure.
 *
 * The config is generated into the OS temp directory rather than committed, so
 * this tool adds no file to the repo. It is a MINIMAL restatement of the four
 * things `vite.config.ts` sets that the game will not boot without — the `@`
 * alias, `__DEV__`, the ES worker format and the esbuild target — plus a
 * private `cacheDir`. Re-exporting the real config was tried and cannot work:
 * vite hands the config to esbuild, which treats an absolute `file://` import
 * as external, and node then refuses the `.ts` extension.
 *
 * If the game ever stops booting under this tool, check here first: something
 * was added to `vite.config.ts` that the game needs and this does not have.
 */
const cfgPath = join(tmpdir(), `vm-sobel-${process.pid}.config.mjs`);
writeFileSync(cfgPath, [
  `export default {`,
  `  root: ${JSON.stringify(ROOT)},`,
  `  base: './',`,
  `  cacheDir: ${JSON.stringify(join(tmpdir(), 'vm-sobel-depcache'))},`,
  `  resolve: { alias: { '@': ${JSON.stringify(join(ROOT, 'src'))} } },`,
  `  define: { __DEV__: 'true' },`,
  `  worker: { format: 'es' },`,
  `  esbuild: { target: 'es2022' },`,
  `};`,
].join('\n'));

/*
 * THE IDENTITY CHECK HERE IS THE WEAKER OF THE TWO, AND IT SAYS SO.
 *
 * A preview tool can byte-compare the `index.html` it is served against the
 * `dist/` on disk, which is conclusive. This runs the DEV server, and a dev
 * server transforms everything it serves, so there is no file to compare. What
 * `serve({ mode: 'dev' })` does instead is ask the origin for
 * `/@fs/<this root>/package.json?raw` and compare THOSE bytes: vite answers an
 * absolute path only if it is inside its own `fs.allow`, which defaults to the
 * workspace root it was started with, so a server rooted at another worktree
 * falls through to the SPA fallback and fails the compare.
 *
 * WHAT THAT PROVES: the answering server is rooted at this tree. WHAT IT DOES
 * NOT: anything about the module graph it has cached — a leaked dev server from
 * an EARLIER run of this same checkout passes it while serving stale
 * transforms. Reading the port off our own child is what rules that one out,
 * and it is the reason the check is worth having rather than the reason it is
 * sufficient.
 */
console.log('> serving (dev, so /src/** stays importable) ...');
const server = await serve({
  root: ROOT,
  mode: 'dev',
  portHint: PORT_HINT,
  viteArgs: ['--config', cfgPath],
  log: console.log,
});
const BASE = server.origin;
const cleanup = () => server.stop();
/*
 * vite's own last words, which `serve()` keeps for the same reason this file
 * used to: with `stdio: 'pipe'` and nobody reading, the OS buffer fills, the
 * child blocks on its next write — vite is chatty in dev, every optimised dep
 * and every HMR event — and the next `page.goto` gets ERR_CONNECTION_REFUSED
 * with no explanation. Two runs died that way.
 */
const serverTail = () => server.tail();

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
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message.slice(0, 200)));

/*
 * THE DEP-OPTIMISER RELOAD, and it killed two runs of this tool before it was
 * understood. Vite dev discovers a bare import it has not pre-bundled, bundles
 * it, and then HARD-RELOADS the page — which destroys the execution context
 * underneath whatever `page.evaluate` is in flight, with the deeply unhelpful
 * message "Execution context was destroyed, most likely because of a
 * navigation". It fires on the first load, and again on the second, because the
 * scenario pulls in modules the first URL never touched.
 *
 * `vite preview` would not have this problem, but a production bundle cannot be
 * asked for `/src/art/Faction4Buildings.ts`, and reaching the two factions that
 * publish no global handle is the entire reason this runs against dev.
 *
 * So: boot, and retry the boot when the context dies. By the third attempt the
 * optimiser has nothing left to discover.
 */
const boot = async () => {
  server.assertAlive('the structure sweep');
  await page.goto(`${BASE}?shot=terrain-showcase&seed=3&fog=off`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 120_000 });
  await page.evaluate(() => window.__VM.ready());
  // The curtain trap from tools/shoot.mjs, verbatim in intent.
  await page.waitForFunction(() => {
    const curtain = document.getElementById('loading');
    if (curtain !== null && curtain.hidden !== true) return false;
    const s = window.__VM?.stats?.();
    return s !== undefined && s.drawCalls > 8;
  }, null, { timeout: 240_000 });
};
for (let attempt = 1; ; attempt++) {
  try { await boot(); break; } catch (err) {
    if (attempt >= 4 || !/context was destroyed|Target closed|Timeout|CONNECTION_REFUSED/i.test(String(err))) {
      console.error(`vite said:
${serverTail()}`);
      throw err;
    }
    console.log(`  (vite reloaded the page under us; re-booting, attempt ${attempt + 1})`);
    await page.waitForTimeout(3000);
  }
}

const webgl = await page.evaluate(() => {
  const gl = window.__VM.renderer.getContext();
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'masked';
});
console.log(`  webgl: ${webgl}`);

let keys = await page.evaluate(INSTALL, { baseline });
if (filters.length > 0) keys = keys.filter((k) => filters.some((f) => k.key.includes(f) || k.army === f));
console.log(`> ${keys.length} structures\n`);

/*
 * THE OPTIMISER RELOAD FIRES A SECOND TIME, INSIDE THE MEASUREMENT LOOP.
 *
 * The boot retry above only covers the boot. `INSTALL` is where the four
 * roster modules are first `import()`ed, so it is where vite discovers the last
 * batch of bare deps — and the hard reload it schedules can land several
 * seconds later, i.e. on structure four, not on `INSTALL` itself. A whole
 * 52-structure run died that way with the same unhelpful "Execution context was
 * destroyed" the boot loop already knew about.
 *
 * Recovery is: re-boot, re-install, retry the structure. `show()` is a pure
 * function of the key — it clears the rack first — so replaying one structure
 * after a reload produces the same measurement it would have produced without,
 * and no row is silently dropped.
 */
/*
 * The reload does not always announce itself as a destroyed context. If it
 * lands BETWEEN two `page.evaluate` calls the context is perfectly healthy —
 * it is simply a fresh one, `window.__sobel` was never installed on it, and
 * playwright reports "Cannot read properties of undefined (reading 'show')".
 * Same cause, same cure, so the predicate has to know both faces of it.
 */
const RELOADED = /context was destroyed|Execution context|Target closed|__sobel|reading '(show|box|clear)'/i;

/**
 * Re-boot and re-install, retrying the RE-BOOT itself.
 *
 * Vite does not schedule one reload, it schedules a burst of them — an editor
 * saving three files is three HMR rounds — so the boot that recovers from the
 * first can be destroyed by the second. An earlier version put the boot inside
 * the catch block with no guard of its own, and the second reload took the
 * whole 52-structure run down at structure 28 with the same message it had
 * just recovered from.
 */
async function reinstall() {
  for (let i = 1; i <= 5; i++) {
    try {
      await page.waitForTimeout(2500 * i);
      await boot();
      await page.evaluate(INSTALL, { baseline });
      return;
    } catch (err) {
      if (i === 5) throw err;
    }
  }
}

async function withRecovery(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (err) {
      if (attempt >= 4 || !RELOADED.test(String(err))) throw err;
      console.log(`  (page reloaded under ${label}; re-installing, attempt ${attempt + 1})`);
      await reinstall();
    }
  }
}

/** Playwright's screenshot occasionally times out on a busy GPU. Retry, twice. */
async function shoot(clip) {
  for (let i = 0; ; i++) {
    try { return await page.screenshot({ clip, animations: 'disabled', timeout: 60_000 }); }
    catch (err) {
      if (i >= 2) throw err;
      await page.waitForTimeout(1500);
    }
  }
}

const rows = [];
for (const k of keys) {
  const shot = await withRecovery(k.key, async () => {
    const info = await page.evaluate((key) => window.__sobel.show(key), k.key);
    await page.evaluate(() => window.__VM.waitFrames(5));
    const box = await page.evaluate(() => window.__sobel.box());
    if (box.width < 16 || box.height < 16) return { info, box, withPng: null, withoutPng: null };
    const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
    const withPng = await shoot(clip);
    await page.evaluate(() => window.__sobel.clear());
    await page.evaluate(() => window.__VM.waitFrames(4));
    const withoutPng = await shoot(clip);
    return { info, box, withPng, withoutPng };
  });
  const { info, box, withPng, withoutPng } = shot;
  if (withPng === null) { console.log(`  ${k.key}: off screen, skipped`); continue; }
  if (box.clipped) console.log(`  WARNING ${k.key}: framing ran off the viewport, crop is partial`);

  const a = await sharp(withPng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(withoutPng).removeAlpha().raw().toBuffer();
  const W = a.info.width, H = a.info.height;

  // The building's own pixels: whatever the model changed, dilated by one so a
  // silhouette edge against the background counts as the building's edge.
  const raw = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 3) {
    const d = Math.abs(a.data[p] - b[p]) + Math.abs(a.data[p + 1] - b[p + 1]) + Math.abs(a.data[p + 2] - b[p + 2]);
    raw[i] = d > 12 ? 1 : 0;
  }
  const mask = new Uint8Array(W * H);
  let mx0 = W, my0 = H, mx1 = -1, my1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (raw[y * W + x] === 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          mask[ny * W + nx] = 1;
          if (nx < mx0) mx0 = nx;
          if (nx > mx1) mx1 = nx;
          if (ny < my0) my0 = ny;
          if (ny > my1) my1 = ny;
        }
      }
    }
  }
  if (mx1 < 0) { console.log(`  ${k.key}: rendered nothing, skipped`); continue; }

  /*
   * TIGHTEN THE CROP TO WHAT THE BUILDING ACTUALLY COVERS.
   *
   * The projected model AABB is a poor crop: a foundation pad is much wider
   * than the structure standing on it, and the eight projected corners of a box
   * that is 14 m tall bound a great deal of empty sky. Measured against the
   * loose AABB the whole roster scored 6-19% and the number was reporting
   * FRAMING, not detail. The mask's own bounding box, padded, is the crop a
   * human would draw around the building.
   */
  const pad = 6;
  const cx = Math.max(0, mx0 - pad), cy = Math.max(0, my0 - pad);
  const cw = Math.min(W, mx1 + pad + 1) - cx, ch = Math.min(H, my1 + pad + 1) - cy;
  const tight = Buffer.allocUnsafe(cw * ch * 3);
  const tightMask = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const src = ((cy + y) * W + (cx + x)) * 3, dst = (y * cw + x) * 3;
      tight[dst] = a.data[src]; tight[dst + 1] = a.data[src + 1]; tight[dst + 2] = a.data[src + 2];
      tightMask[y * cw + x] = mask[(cy + y) * W + (cx + x)];
    }
  }

  const m = sobel(tight, cw, ch, tightMask);
  /*
   * A FILL OF ~100% IS NOT A DENSE BUILDING, IT IS A BROKEN CAPTURE.
   *
   * The mask is the difference between the with-model and without-model shots.
   * If a page reload lands between the two, the second shot is of a DIFFERENT
   * scene and every pixel differs, so the mask covers the crop, `body` collapses
   * onto `crop`, and the row looks like a plausible number. One run reported
   * soviet_power at 18.8/18.9 with 99% fill against its true 28.8/58.1 that way.
   * No structure legitimately fills its own tight crop past ~85%.
   */
  const fill = m.bodyPx / Math.max(1, m.cropPx);
  const suspect = fill > 0.95;
  if (suspect) {
    console.log(`  WARNING ${k.key}: mask filled ${(fill * 100).toFixed(0)}% of the crop — ` +
      `the empty capture was not empty. Row marked suspect and skipped by --compare.`);
  }
  rows.push({
    key: k.key, army: k.army, cls: k.cls,
    crop: m.crop, body: m.body, cropPx: m.cropPx, bodyPx: m.bodyPx,
    fill, suspect,
    triangles: info.triangles, parts: info.parts, bounds: info.bounds,
  });
  if (wantCrops) {
    await sharp(tight, { raw: { width: cw, height: ch, channels: 3 } })
      .png().toFile(join(OUT, tag, `${k.key}.png`));
  }
  console.log(
    `  ${k.key.padEnd(24)} crop ${(m.crop * 100).toFixed(2)}%  body ${(m.body * 100).toFixed(2)}%  ` +
    `(${cw}x${ch}, ${(m.bodyPx / m.cropPx * 100).toFixed(0)}% filled, ${info.triangles} tris)`);
}

await page.evaluate(() => window.__sobel.restore());
await browser.close();
cleanup();

const byArmy = new Map();
for (const r of rows) {
  const g = byArmy.get(r.army) ?? [];
  g.push(r);
  byArmy.set(r.army, g);
}
console.log('\n=== per army (structures only; walls and defences listed apart) ===');
for (const [army, g] of byArmy) {
  const main = g.filter((r) => r.cls === 'structure');
  const rest = g.filter((r) => r.cls !== 'structure');
  const band = (set, f) => set.length === 0 ? 'n/a'
    : `${(Math.min(...set.map(f)) * 100).toFixed(1)}-${(Math.max(...set.map(f)) * 100).toFixed(1)}%`;
  console.log(
    `${army.padEnd(9)} structures crop ${band(main, (r) => r.crop).padEnd(14)} body ${band(main, (r) => r.body).padEnd(14)}` +
    ` | defence+wall crop ${band(rest, (r) => r.crop)}`);
}
const tris = rows.reduce((s, r) => s + r.triangles, 0);
const parts = rows.reduce((s, r) => s + r.parts, 0);
console.log(`\ntotal ${tris} triangles, ${parts} draw calls over ${rows.length} structures`);
console.log(`bible §13 #34 wants 40-46% on a building crop.`);

writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({
  tag, viewport: VIEWPORT, threshold: THRESHOLD, webgl, when: new Date().toISOString(),
  totals: { triangles: tris, parts, structures: rows.length },
  problems: problems.slice(0, 20), rows,
}, null, 2));
console.log(`-> shots-sobel/${tag}.json`);
if (problems.length > 0) console.log(`(${problems.length} console errors; first: ${problems[0]})`);

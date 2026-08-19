/**
 * ============================================================================
 * CAMEO AUDIT — what does the build grid actually show?
 * ============================================================================
 *
 *   node tools/cameo-audit.mjs                # the numbers
 *   node tools/cameo-audit.mjs --sheet        # ...and a contact sheet PNG
 *   node tools/cameo-audit.mjs --headed       # watch it happen
 *   node tools/cameo-audit.mjs --json out.json
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/ui/Cameos.ts` renders a cameo from the real game mesh into a cached
 * render target, and falls back to a hand-drawn 2D silhouette when a def key
 * does not resolve to a model. Its header said most keys would not resolve
 * "until every art module lands". Nobody had ever measured which, or how many,
 * and the honest answer turned out to be neither of the two anybody guessed:
 *
 *   - the art HAS landed — every def key in the game has a real model built at
 *     boot, in all four armies;
 *   - and the model path had a 0 % hit rate, because `setModelProvider()` had
 *     no call sites at all. The provider defaulted to `() => null`.
 *
 * A percentage is the only thing that could have distinguished "the art is
 * missing" from "the wiring is missing", and they need opposite fixes. So this
 * tool reports the percentage, per army, with the failing keys named.
 *
 * IT BOOTS THE REAL GAME. Resolution depends on what the art systems actually
 * built at `init()`, which no static analysis can tell you: a mass list that
 * fails `MassList` validation is REJECTED and logged, and its key then silently
 * resolves to nothing. That has happened before. So the libraries are queried
 * live, in a browser, after boot.
 *
 * TWO TRAPS, both of which produced wrong numbers while this was being written
 * ---------------------------------------------------------------------------
 *  1. **Boot flag.** `?skipmenu=1` is not enough on its own — `Shell.bootGame`
 *     writes the lobby's starting bank after `await nextFrames(6)`, and the
 *     art systems' `init()` is async and awaits `resolveDefBinding()`. Query a
 *     library before those land and EVERY key misses, which reads exactly like
 *     the bug being measured. So this waits on the libraries reporting a
 *     non-zero model count, not on `ready()`.
 *  2. **Dev server, not preview.** The probe imports `/src/data/Defs.ts` and
 *     `/src/ui/Cameos.ts` by source path to enumerate defs without reaching
 *     into private state. `vite preview` serves the built bundle and those
 *     paths 404 — the probe then throws inside `page.evaluate` and the run dies
 *     with a message about `DEF_TABLES` rather than about the server. Use
 *     `vite` (dev).
 *
 * WHAT IT MEASURES
 * ----------------
 *  A. Coverage: for every (def, army) pair a sidebar can show, does the cameo
 *     resolve to a real model prototype? Reported per army with the misses
 *     named and each miss classified (no mapping / mapped but not built).
 *  B. The BEFORE number, reproduced rather than remembered: the same sweep run
 *     against `() => null`, which is what the module shipped with.
 *  C. Glyph collisions: how many defs share an `iconForBuildable` glyph today.
 *     That is the user-visible complaint ("a flask for Proving Ground") expressed
 *     as a number.
 *  D. Cost: milliseconds for a full tab switch — bind N cells, drain the render
 *     queue at `HUD_CAMEO.perFrameBudget` per frame — on both paths.
 * ============================================================================
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * A HINT — and the note that used to sit here was the clearest statement in the
 * repo of a problem it then failed to solve. It read: "deliberately an odd port,
 * because several harnesses here reuse a server they find already listening, so
 * the port you expected is regularly somebody else's `vite preview`", and then
 * this file went on to do exactly the same thing —
 * `if (!(await waitForServer(BASE, 1500))) start one` — with a number one digit
 * further from the collision. Picking an odd port is not a mechanism; it is a
 * hope that nobody else picks it, and `tools/wedge.mjs` and
 * `tools/order-probe.mjs` are the pair that shows how that ends.
 *
 * Adoption is gone. `serve()` starts the dev server, reads the origin off our
 * own child, and proves the tree it is rooted at.
 */
const PORT_HINT = 4392;

const HEADED = process.argv.includes('--headed');
const SHEET = process.argv.includes('--sheet');
const JSON_AT = (() => {
  const i = process.argv.indexOf('--json');
  return i > 0 ? process.argv[i + 1] : null;
})();

/* -------------------------------------------------------------------------- */
/* server                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Prove we are talking to `vite` and not `vite preview`.
 *
 * A preview server answers `/src/art/UnitFactory.ts` with the SPA fallback —
 * `index.html`, status 200. The probe then imports it, gets HTML, and the run
 * dies with "Failed to fetch dynamically imported module", which reads like a
 * missing file rather than like the wrong server. This asserts the difference
 * up front, because trap 2 in the header cost a run before it was written down.
 *
 * It is a check on the server's MODE and not on its identity — `serve()` does
 * identity, and the two are separate questions. This one survives the move
 * because it names the exact capability the probe below depends on: `/src/**`
 * addressable by source path. `assertServesSource` would also fail against a
 * preview server, but it would report it as the wrong TREE, which is the wrong
 * thing to go looking for.
 */
async function assertDevServer(base) {
  const res = await fetch(`${base}src/art/UnitFactory.ts`);
  const body = await res.text();
  if (body.trimStart().startsWith('<!doctype') || body.includes('<html')) {
    throw new Error(
      `${base} is serving the SPA fallback for /src/**.ts, so it is a PREVIEW server, ` +
      'not a dev server, and the probe below imports modules by source path.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* in-page probe — everything below the fold runs inside the game page         */
/* -------------------------------------------------------------------------- */

/**
 * Enumerate every (def, army) pair a sidebar can show and resolve each one.
 *
 * The roster comes from `ProductionCatalog.roster(faction, tab)`, which is the
 * function the sidebar itself calls — so this counts exactly the cells a player
 * can see, not every row in the def table. `engineer` is one def and two cells,
 * because both original armies field it, and it has to resolve for both.
 */
const PROBE = async () => {
  const cameos = await import('/src/ui/Cameos.ts');
  const icons = await import('/src/ui/icons.ts');
  const types = await import('/src/core/types.ts');
  const defs = await import('/src/data/Defs.ts');

  const prod = globalThis.__vmProduction;
  if (!prod) throw new Error('no __vmProduction — the sim never booted');

  const ARMIES = [
    { id: types.Faction.Allies, name: 'allies' },
    { id: types.Faction.Soviets, name: 'soviets' },
    { id: types.Faction.Meridian, name: 'meridian' },
    { id: types.Faction.Reclaim, name: 'reclaim' },
  ];
  const TABS = [0, 1, 2, 3];

  const provider = cameos.createCameoModelProvider();
  // The module's shipped default, reproduced rather than remembered. Running
  // the same sweep through it is what turns "it was 0 %" from a claim about
  // source code into a measurement.
  const shipped = () => null;

  /* -- sweep A: every row of the def table, not just the buildable ones ---
   *
   * The roster below is what a player SEES, and it is the number that matters
   * for the HUD. But a def that is only a prereq or an MCV deploy target — the
   * Construction Yard is both — never appears in a roster, and a Construction
   * Yard cameo is still drawn on the selection card. So the def table is swept
   * too, and a miss here is a miss even if no sidebar cell would show it.
   */
  const defRows = [];
  const armyOf = (f) => ARMIES.find((a) => a.id === f) ?? null;
  for (const [table, isBuilding] of [[defs.DEF_TABLES.units, false], [defs.DEF_TABLES.buildings, true]]) {
    for (const def of table) {
      // A Neutral def is fielded by both original armies and must resolve for
      // each; anything else resolves for its own army only.
      const armies = def.faction === types.Faction.Neutral
        ? [types.Faction.Allies, types.Faction.Soviets]
        : [def.faction];
      for (const f of armies) {
        const modelKey = cameos.cameoModelKey(def.key, f, isBuilding);
        defRows.push({
          army: armyOf(f)?.name ?? `faction${f}`,
          key: def.key,
          isBuilding,
          modelKey,
          resolved: provider(def.key, f) !== null,
          shippedResolved: shipped() !== null,
        });
      }
    }
  }

  /* -- sweep B: every cell a sidebar can show ---------------------------- */
  const rows = [];
  for (const army of ARMIES) {
    for (const tab of TABS) {
      const roster = prod.catalog.roster(army.id, tab);
      for (const entry of roster) {
        const isBuilding = entry.kind === 0; // BuildKind.Building
        const modelKey = cameos.cameoModelKey(entry.key, army.id, isBuilding);
        const resolved = provider(entry.key, army.id) !== null;

        // Classify a miss so the fix is obvious from the report alone.
        let cause = '';
        if (!resolved) {
          if (modelKey === null) cause = 'no content-key -> model-key mapping';
          else cause = `mapped to "${modelKey}" but that model was never built`;
        }

        rows.push({
          army: army.name,
          tab,
          key: entry.key,
          name: entry.name,
          isBuilding,
          modelKey,
          resolved,
          shippedResolved: shipped() !== null,
          cause,
          icon: icons.iconForBuildable(entry.key, entry.name, tab, isBuilding),
        });
      }
    }
  }

  /* -- glyph collisions, per army ---------------------------------------- */
  const glyphs = {};
  for (const army of ARMIES) {
    const byIcon = {};
    for (const r of rows) {
      if (r.army !== army.name) continue;
      (byIcon[r.icon] ??= []).push(r.key);
    }
    const shared = Object.entries(byIcon).filter(([, keys]) => keys.length > 1);
    glyphs[army.name] = {
      cells: rows.filter((r) => r.army === army.name).length,
      distinctGlyphs: Object.keys(byIcon).length,
      sharedGlyphs: Object.fromEntries(shared),
      cellsSharingAGlyph: shared.reduce((n, [, keys]) => n + keys.length, 0),
    };
  }

  return { rows, defRows, glyphs };
};

/**
 * Cost of a full tab switch, both paths.
 *
 * A tab switch dirties every visible cell at once. `frame()` spends at most
 * `HUD_CAMEO.perFrameBudget` renders per call, so the honest number is the
 * total wall-clock time to drain that queue, plus the worst single frame — the
 * hitch a player would actually feel.
 *
 * `readRenderTargetPixels` is a synchronous GPU readback, so `performance.now()`
 * around `frame()` measures real GPU time here rather than just queue-submit
 * time. That is the reason this is measured in the page and not inferred.
 */
const COST_PROBE = async (cells) => {
  const cameos = await import('/src/ui/Cameos.ts');
  const config = await import('/src/core/config.ts');
  const types = await import('/src/core/types.ts');

  const VM = globalThis.__VM;
  const prod = globalThis.__vmProduction;
  const roster = [
    ...prod.catalog.roster(types.Faction.Allies, 0),
    ...prod.catalog.roster(types.Faction.Allies, 3),
  ].slice(0, cells);

  const subjects = roster.map((e) => ({
    key: e.key,
    name: e.name,
    faction: types.Faction.Allies,
    tab: e.tab,
    isBuilding: e.kind === 0,
    footprintW: e.footprintW ?? 0,
    footprintH: e.footprintH ?? 0,
  }));

  const measure = (useModels) => {
    const r = new cameos.CameoRenderer(VM.renderer);
    if (!useModels) r.setModelProvider(() => null);
    const canvases = subjects.map(() => {
      const c = document.createElement('canvas');
      c.width = config.HUD_GRID.artW * 2;
      c.height = config.HUD_GRID.artH * 2;
      return c;
    });
    // Warm: shader compile and render-target allocation are one-time costs that
    // belong to boot, not to the tab switch being measured.
    subjects.forEach((s, i) => r.bind(canvases[i], s));
    let t = 0;
    while (r.totalRenders < subjects.length && t < 400) r.frame(t++ * 0.016, 0.016);

    // Now the real measurement: dirty everything, drain, time each frame.
    r.invalidateAll();
    const frames = [];
    const t0 = performance.now();
    let n = 0;
    while (n < 400) {
      const f0 = performance.now();
      r.frame((t + n) * 0.016, 0.016);
      const f1 = performance.now();
      if (r.rendersThisFrame === 0) break;
      frames.push(f1 - f0);
      n++;
    }
    const total = performance.now() - t0;
    const out = {
      cells: subjects.length,
      frames: frames.length,
      totalMs: +total.toFixed(2),
      worstFrameMs: +Math.max(0, ...frames).toFixed(2),
      msPerCameo: +(total / Math.max(1, subjects.length)).toFixed(3),
      meshHits: r.meshHits,
      fallbacks: r.fallbacks,
    };
    r.dispose();
    return out;
  };

  return {
    perFrameBudget: config.HUD_CAMEO.perFrameBudget,
    shipped2d: measure(false),
    models: measure(true),
  };
};

/**
 * Render every cameo of one army into one PNG, so the grid can be LOOKED at
 * beside `docs/refs/target-hud.png`. Numbers cannot tell you whether a cameo is
 * framed well; this is the half of the audit that a person reads.
 */
const SHEET_PROBE = async (armyName) => {
  const cameos = await import('/src/ui/Cameos.ts');
  const config = await import('/src/core/config.ts');
  const types = await import('/src/core/types.ts');

  const faction = types.Faction[armyName];
  const prod = globalThis.__vmProduction;
  const roster = [0, 1, 2, 3].flatMap((t) => prod.catalog.roster(faction, t));

  const SCALE = 4;
  const CW = config.HUD_GRID.artW * SCALE;
  const CH = config.HUD_GRID.artH * SCALE;
  const COLS = 8;
  const ROWS = Math.ceil(roster.length / COLS);
  const LABEL = 16;

  const r = new cameos.CameoRenderer(globalThis.__VM.renderer);
  const cells = roster.map((e) => {
    const c = document.createElement('canvas');
    c.width = CW;
    c.height = CH;
    r.bind(c, {
      key: e.key,
      name: e.name,
      faction,
      tab: e.tab,
      isBuilding: e.kind === 0,
      footprintW: e.footprintW ?? 0,
      footprintH: e.footprintH ?? 0,
    });
    return c;
  });
  let t = 0;
  while (r.totalRenders < roster.length && t < 2000) r.frame(t++ * 0.016, 0.016);

  const sheet = document.createElement('canvas');
  sheet.width = COLS * CW;
  sheet.height = ROWS * (CH + LABEL);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  cells.forEach((c, i) => {
    const x = (i % COLS) * CW;
    const y = ((i / COLS) | 0) * (CH + LABEL);
    ctx.drawImage(c, x, y);
    ctx.fillStyle = '#cfe4ff';
    ctx.font = '11px monospace';
    ctx.fillText(roster[i].key.slice(0, 22), x + 4, y + CH + 12);
  });

  const out = { png: sheet.toDataURL('image/png'), meshHits: r.meshHits, fallbacks: r.fallbacks };
  r.dispose();
  return out;
};

/* -------------------------------------------------------------------------- */
/* driver                                                                     */
/* -------------------------------------------------------------------------- */

/*
 * The tree kill that used to be explained here is in `tools/lib/serve.mjs` now,
 * along with the reason: on Windows `spawn(..., { shell: true })` gives a
 * `cmd.exe` whose child is the real vite, `child.kill()` reaps only the shell,
 * and the orphan keeps the port — so the NEXT run's `waitForServer` succeeded
 * against a server holding a stale module graph and the probe died with "Failed
 * to fetch dynamically imported module". That cost a run. vite is spawned as one
 * direct node process now, so there is no shell to reap in the first place.
 */
const server = await serve({
  root: ROOT, mode: 'dev', portHint: PORT_HINT, log: console.log,
});
const BASE = server.origin;
const cleanup = () => server.stop();
try {
  await assertDevServer(BASE);
} catch (err) {
  cleanup();
  throw err;
}

const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
  ],
});

const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240_000);
page.setDefaultNavigationTimeout(240_000);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 240)));

/**
 * A `process.env` shim, and it is not this tool's business.
 *
 * `src/world/Roads.ts:1271` currently reads
 *
 *     if (process.env.VM_NO_ROAD_CUT !== '1') this.buildCover(); // TEMP A/B
 *
 * `process` does not exist in a browser, so world generation throws
 * `[boot] system init failed ReferenceError: process is not defined` and the
 * boot sequence stops BEFORE `sim.production` registers `__vmProduction`. The
 * whole audit then times out waiting for a catalog that will never appear.
 *
 * That line belongs to another workflow and is not ours to fix, so this is a
 * harness-side shim and nothing more: it defines `process.env` if and only if
 * the page has no `process` at all. The day the A/B toggle is removed this
 * becomes a no-op, and it can go with it.
 */
await page.addInitScript(() => {
  if (typeof globalThis.process === 'undefined') globalThis.process = { env: {} };
});

/**
 * Cut the Vite HMR socket.
 *
 * This runs against the DEV server (it has to — the probe imports `/src/**` by
 * source path, which `vite preview` does not serve). Dev means an HMR client,
 * and this repo is worked on by several agents at once: any one of them saving
 * a file mid-run sends `full-reload`, the page navigates, and the audit dies
 * with "Execution context was destroyed, most likely because of a navigation"
 * — a message that says nothing about the actual cause. That happened once.
 *
 * The socket never connecting is a state Vite's client already handles (it
 * retries quietly), and no reload can arrive over a socket that does not exist.
 */
await page.addInitScript(() => {
  const Native = globalThis.WebSocket;
  class DeafSocket {
    readyState = 3;
    addEventListener() { /* nothing ever arrives */ }
    removeEventListener() { /* nothing to remove */ }
    send() { /* into the void */ }
    close() { /* already shut */ }
  }
  globalThis.WebSocket = function (url, protocols) {
    const wanted = Array.isArray(protocols) ? protocols : protocols === undefined ? [] : [protocols];
    if (wanted.includes('vite-hmr')) return new DeafSocket();
    return new Native(url, protocols);
  };
  globalThis.WebSocket.prototype = Native.prototype;
});

console.log('> booting the game...');
server.assertAlive('the audit');
await page.goto(`${BASE}?blank=1`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('voltmarch.setup.v1', JSON.stringify({
    playerFaction: 'allies', aiFaction: 'soviets', map: 'temperate',
    difficulty: 2, personality: -1, startingCredits: 10000, speed: 1, seed: 7,
  }));
  localStorage.setItem('voltmarch.setup.start.v1', JSON.stringify('mcv'));
});
await page.goto(`${BASE}?skipmenu=1&start=mcv&seed=7`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 180_000 });
await page.evaluate(() => window.__VM.ready());
await page.waitForFunction(() => globalThis.__vmProduction?.catalog !== undefined, null, { timeout: 180_000 });

// Trap 1: wait for the ART, not for the sim. Every art system's `init()` awaits
// `resolveDefBinding()`, so the libraries are empty for several frames after
// `ready()` resolves and every key would miss.
await page.waitForFunction(async () => {
  const u = await import('/src/art/UnitFactory.ts');
  const b = await import('/src/art/BuildingFactory.ts');
  const m = await import('/src/art/Faction3Buildings.ts');
  const r = await import('/src/art/Faction4Buildings.ts');
  return u.unitLibrary.get('allied_rifle') !== undefined
    && b.buildingLibrary.get('allied_conyard') !== undefined
    && m.meridianBuildingLibrary.get('meridian_conclave') !== undefined
    && r.reclaimBuildingLibrary.get('reclaim_foundry') !== undefined;
}, null, { timeout: 180_000 });
await page.evaluate(() => window.__VM.pause());

console.log('> auditing...');
const audit = await page.evaluate(PROBE);
const cost = await page.evaluate(COST_PROBE, 20);

/* -------------------------------------------------------------------------- */
/* report                                                                     */
/* -------------------------------------------------------------------------- */

const ARMY_ORDER = ['allies', 'soviets', 'meridian', 'reclaim'];
const line = (s = '') => console.log(s);

line();
line('==================== CAMEO AUDIT ====================');
line();

line('--- EVERY DEF IN THE GAME (all 4 armies, buildable or not) ----');
{
  const total = audit.defRows.length;
  const ok = audit.defRows.filter((r) => r.resolved).length;
  const was = audit.defRows.filter((r) => r.shippedResolved).length;
  for (const army of ARMY_ORDER) {
    const rows = audit.defRows.filter((r) => r.army === army);
    const good = rows.filter((r) => r.resolved).length;
    line(
      `${army.padEnd(9)} defs ${String(rows.length).padStart(3)}   ` +
      `shipped   0.0%   now ${(((good) / rows.length) * 100).toFixed(1).padStart(5)}%`,
    );
    for (const r of rows.filter((x) => !x.resolved)) {
      line(`            MISS ${r.key.padEnd(18)} model=${r.modelKey ?? '(unmapped)'}`);
    }
  }
  line(
    `TOTAL      defs ${total}   shipped ${((was / total) * 100).toFixed(1)}%   ` +
    `now ${((ok / total) * 100).toFixed(1)}%`,
  );
}

line();
line('--- WHAT A SIDEBAR CAN SHOW (ProductionCatalog.roster) --------');
let totalCells = 0;
let totalResolved = 0;
let totalShipped = 0;
for (const army of ARMY_ORDER) {
  const rows = audit.rows.filter((r) => r.army === army);
  const ok = rows.filter((r) => r.resolved).length;
  const was = rows.filter((r) => r.shippedResolved).length;
  totalCells += rows.length;
  totalResolved += ok;
  totalShipped += was;
  const pct = (n) => rows.length === 0 ? '—' : `${((n / rows.length) * 100).toFixed(1)}%`;
  line(
    `${army.padEnd(9)} cells ${String(rows.length).padStart(3)}   ` +
    `shipped ${pct(was).padStart(6)}   now ${pct(ok).padStart(6)}   ` +
    `fallback now ${pct(rows.length - ok).padStart(6)}`,
  );
  for (const r of rows.filter((x) => !x.resolved)) {
    line(`            MISS ${r.key.padEnd(18)} ${r.cause}`);
  }
}
line();
line(
  `TOTAL      cells ${totalCells}   shipped ` +
  `${((totalShipped / totalCells) * 100).toFixed(1)}%   now ` +
  `${((totalResolved / totalCells) * 100).toFixed(1)}%`,
);

line();
line('--- WHAT THE LIVE HUD DRAWS TODAY (SVG glyphs, src/ui/icons.ts) ---');
for (const army of ARMY_ORDER) {
  const g = audit.glyphs[army];
  line(
    `${army.padEnd(9)} ${String(g.cells).padStart(3)} cells -> ${String(g.distinctGlyphs).padStart(2)} distinct glyphs; ` +
    `${g.cellsSharingAGlyph} cells share a glyph with another cell`,
  );
  for (const [icon, keys] of Object.entries(g.sharedGlyphs)) {
    line(`            "${icon}" <- ${keys.join(', ')}`);
  }
}

line();
line('--- COST OF ONE FULL TAB SWITCH -------------------------------');
line(`perFrameBudget = ${cost.perFrameBudget} renders/frame`);
for (const [label, m] of [['2D fallback (shipped path)', cost.shipped2d], ['model render (now)', cost.models]]) {
  line(
    `${label.padEnd(28)} ${String(m.cells).padStart(2)} cells over ${String(m.frames).padStart(2)} frames  ` +
    `total ${String(m.totalMs).padStart(8)} ms  worst frame ${String(m.worstFrameMs).padStart(7)} ms  ` +
    `${m.msPerCameo} ms/cameo  (mesh ${m.meshHits} / fallback ${m.fallbacks})`,
  );
}

if (consoleErrors.length > 0) {
  line();
  line('--- CONSOLE ERRORS --------------------------------------------');
  for (const e of consoleErrors.slice(0, 12)) line(`  ${e}`);
}

if (SHEET) {
  mkdirSync(join(ROOT, 'shots'), { recursive: true });
  for (const army of ARMY_ORDER) {
    const name = army[0].toUpperCase() + army.slice(1);
    const s = await page.evaluate(SHEET_PROBE, name);
    const file = join(ROOT, 'shots', `cameo-sheet-${army}.png`);
    writeFileSync(file, Buffer.from(s.png.split(',')[1], 'base64'));
    line(`sheet: ${file}  (mesh ${s.meshHits} / fallback ${s.fallbacks})`);
  }
}

if (JSON_AT) {
  writeFileSync(JSON_AT, JSON.stringify({ audit, cost, consoleErrors }, null, 2));
  line(`json: ${JSON_AT}`);
}

await browser.close();
cleanup();
process.exit(0);

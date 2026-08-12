/**
 * PLAYTEST HARNESS — does the game actually play?
 *
 *   node tools/playtest.mjs ai              # AI from an MCV, every faction
 *   node tools/playtest.mjs ai soviets      # ...just one
 *   node tools/playtest.mjs human allies    # the scripted opening, as a player
 *   node tools/playtest.mjs determinism     # same seed twice, compared
 *
 * WHY THIS EXISTS, AND WHY `npm test` DOES NOT COVER IT
 * ----------------------------------------------------
 * The unit tests assert that each part obeys its contract. They cannot answer
 * "is there a match here", and the failure that matters most is exactly the one
 * they cannot see: an opponent that boots, renders at full frame rate, reports
 * a correct HUD, and never does anything. Nothing errors. You find out because
 * nobody attacked you.
 *
 * It caught a real one. Under the MCV opening, three of the four factions'
 * AIs deployed, built a refinery, and then flatlined at 0-1600 credits for the
 * rest of the match — no harvester, no income, forever. Every gate was green.
 *
 * HOW IT DRIVES THE GAME
 * ----------------------
 * Through `channels.commands` and `ProductionService`'s public methods — the
 * same door the mouse and the AI use. Nothing here writes an EntityStore column.
 *
 * `__VM.pause()` + `__VM.step(n)` is `GameLoop.runHeadless`: the identical fixed
 * 30 Hz step, run synchronously with no renderer in the way, so seven minutes of
 * match take seconds and stay bit-identical to seven minutes played live.
 *
 * TWO BOOT RACES TO KNOW ABOUT, because both look like determinism failures:
 *   1. `Shell.bootGame` writes the lobby's starting bank only after
 *      `await nextFrames(6)`. Freeze the SIM first and let those frames land
 *      while it is frozen, or the bank is reset under a match already running.
 *   2. Between `ready()` and the first `step()` the loop runs at wall-clock
 *      speed, so two runs start from different ticks. Same fix.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './lib/serve.mjs';

/** A hint — the origin is read back off our own child. See `tools/lib/serve.mjs`. */
const PORT_HINT = 4331;
const MODE = process.argv[2] ?? 'ai';
const HEADED = process.argv.includes('--headed');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* -------------------------------------------------------------------------- */
/* in-page probe: everything below runs inside the game page                   */
/* -------------------------------------------------------------------------- */

const PROBE = () => {
  const g = globalThis;
  const prod = g.__vmProduction;
  const w = prod.world;
  const st = w.store;
  const out = { tick: w.tick, players: [] };
  for (const p of w.players) {
    if (p.name === 'Gaia') continue;
    const b = {};
    const u = {};
    let units = 0; let buildings = 0; let mcv = 0; let harv = 0;
    const HARVESTERS = /^(harvester|mrdCollector|rclScrapper)$/;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== p.id) continue;
      let k = '?';
      try { const e = prod.entryOf(st.handleOf(i)); k = e ? e.key : '?'; } catch {}
      if (st.kind[i] === 3) { buildings++; b[k] = (b[k] ?? 0) + 1; }
      else {
        units++;
        u[k] = (u[k] ?? 0) + 1;
        if (/^(mcv|mrdCarryall|rclCrawler)$/.test(k)) mcv++;
        if (HARVESTERS.test(k)) harv++;
      }
    }
    out.players.push({
      id: p.id, name: p.name, faction: p.faction, credits: Math.round(p.credits),
      power: p.powerProduced + '/' + p.powerConsumed, units, buildings, mcv, harv, b, u,
    });
  }
  out.deploy = g.__vmDeploy ? { ...g.__vmDeploy.counters } : null;
  const ai = g.__VM.hooks.ai ? g.__VM.hooks.ai() : [];
  out.ai = ai.map((x) => ({
    p: x.player, posture: x.posture, mcvs: x.mcvs, deploy: x.deploy,
    army: x.armySize, harv: x.harvesterSize, refineries: x.refineryCount, wave: x.wave,
  }));
  return out;
};

/* -------------------------------------------------------------------------- */

const ONLY = process.argv[3];
const FACTIONS = ONLY ? [ONLY] : ['allies', 'soviets', 'meridian', 'reclaim'];

async function boot(browser, { player, ai, seed, start = 'mcv', credits = 10000, difficulty = 2 }) {
  // Per boot: `determinism` mode boots twice and compares, and a server that
  // died between the two would put the halves of that comparison on different
  // bundles.
  server.assertAlive(`the ${player} boot`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180_000);
  page.setDefaultNavigationTimeout(180_000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 300)));

  // Seed localStorage before the app boots.
  await page.goto(BASE + '?blank=1', { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('voltmarch.setup.v1', JSON.stringify({
      playerFaction: s.player, aiFaction: s.ai, map: 'temperate',
      difficulty: s.difficulty, personality: -1, startingCredits: s.credits, speed: 1, seed: s.seed,
    }));
    localStorage.setItem('voltmarch.setup.start.v1', JSON.stringify(s.start));
  }, { player, ai, seed, start, credits, difficulty });

  await page.goto(`${BASE}?skipmenu=1&start=${start}&seed=${seed}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 120_000 });
  await page.evaluate(() => window.__VM.ready());
  await page.waitForFunction(() => globalThis.__vmProduction?.world?.players?.length > 1, null, { timeout: 120_000 });
  // Freeze the SIM, THEN let the shell finish. `Shell.bootGame` writes the
  // lobby's starting bank only after `await nextFrames(6)`, and those are
  // RENDER frames, which keep arriving while the loop is paused — so the bank
  // still lands, it just lands without the sim having run on ahead of it.
  // Pausing later instead means two runs start from different ticks and the
  // bank is reset under a match already in progress: both read as
  // nondeterminism and neither is.
  await page.evaluate(() => window.__VM.pause());
  await page.waitForFunction(
    (c) => globalThis.__vmProduction.world.players[0].credits === c,
    credits, { timeout: 60_000 },
  );
  await page.evaluate(() => window.__VM.setUiVisible(true));
  const tick0 = await page.evaluate(() => globalThis.__vmProduction.world.tick);
  return { page, errors, tick0 };
}

/**
 * Run the sim forward `simSeconds` of game time.
 *
 * `__VM.pause()` + `__VM.step(n)` is `GameLoop.runHeadless` — the SAME fixed
 * 30 Hz step the real loop takes, run synchronously with no renderer in the
 * way. That is what makes a 7-minute match take seconds and stay bit-identical
 * to a match played in real time.
 */
async function advance(page, simSeconds) {
  const total = Math.round(simSeconds * 30);
  const CHUNK = 300;
  for (let done = 0; done < total; done += CHUNK) {
    await page.evaluate((n) => window.__VM.step(n), Math.min(CHUNK, total - done));
  }
}

/* ============================== MODE: ai ================================== */

async function modeAi(browser) {
  const rows = [];
  for (const f of FACTIONS) {
    const human = f === 'allies' ? 'soviets' : 'allies';
    process.stdout.write(`\n=== AI as ${f} (human ${human}) ===\n`);
    const { page, errors } = await boot(browser, { player: human, ai: f, seed: 7 });
    const marks = [];
    for (const t of [45, 120, 240, 420]) {
      await advance(page, t - (marks.length ? marks[marks.length - 1].at : 0));
      const s = await page.evaluate(PROBE);
      s.at = t;
      marks.push(s);
      const p = s.players.find((x) => !x.name.includes('Commander'));
      console.log(`  t+${t}s  ai: ${p.buildings} bld ${p.units} unit ${p.harv} harv  cr ${p.credits}  pw ${p.power}  ` +
        `deploy=${JSON.stringify(s.deploy)}  ${JSON.stringify(s.ai[0] ?? {})}`);
      console.log(`         bld: ${JSON.stringify(p.b)}`);
      console.log(`         unt: ${JSON.stringify(p.u)}`);
    }
    rows.push({ faction: f, marks, errors: errors.slice(0, 6) });
    if (errors.length) console.log('  console errors:', errors.slice(0, 4));
    await page.close();
  }
  console.log('\n===== SUMMARY =====');
  for (const r of rows) {
    const last = r.marks[r.marks.length - 1];
    const p = last.players.find((x) => !x.name.includes('Commander'));
    const deployed = last.deploy.deployed;
    console.log(`${r.faction.padEnd(9)} deployed=${deployed} refused=${last.deploy.refused} ` +
      `buildings=${p.buildings} units=${p.units} harvesters=${p.harv} credits=${p.credits} ` +
      `posture=${last.ai[0]?.posture} army=${last.ai[0]?.army} wave=${last.ai[0]?.wave}`);
  }
}

/* ============================ MODE: human ================================= */

/** The scripted opening, driven through the player's own command channel. */
const HUMAN_SCRIPT = async (page, log) => {
  const step = async (label, fn, arg) => {
    const r = await page.evaluate(fn, arg);
    log.push(`${label}: ${JSON.stringify(r)}`);
    console.log(`  ${label}: ${JSON.stringify(r)}`);
    return r;
  };

  // 1. Deploy the MCV — exactly what input.system.ts issueDeploy() writes.
  await step('deploy-order', () => {
    const prod = globalThis.__vmProduction;
    const w = prod.world; const st = w.store;
    // The scenario hands the local player their construction vehicle already
    // selected, which is exactly what a human sees when the camera lands.
    const sel = w.selection;
    let id = sel.count > 0 ? sel.ids[0] : -1;
    let i = id >= 0 ? st.index(id) : -1;
    if (i < 0) {
      let best = -1;
      for (let a = 0; a < st.aliveCount; a++) {
        const k = st.alive[a];
        if (st.owner[k] !== w.localPlayer || st.kind[k] === 3) continue;
        if (best < 0 || st.maxHp[k] > st.maxHp[best]) best = k;
      }
      i = best; id = i >= 0 ? st.handleOf(i) : -1;
    }
    if (i < 0) return { error: 'no unit to deploy' };
    prod.channels.commands.issueOrder(w.localPlayer, 8, [id], 1, st.posX[i], st.posZ[i], id, false);
    return { selected: sel.count, hp: st.maxHp[i], x: Math.round(st.posX[i]), z: Math.round(st.posZ[i]) };
  });
  return null;
};

async function modeHuman(browser, faction = 'allies') {
  const { page, errors } = await boot(browser, { player: faction, ai: 'soviets', seed: 7 });
  const log = [];
  console.log(`\n=== human opening as ${faction} ===`);
  console.log('  t0: ' + JSON.stringify((await page.evaluate(PROBE)).players[0]));
  await HUMAN_SCRIPT(page, log);
  await advance(page, 4);
  console.log('  after deploy: ' + JSON.stringify((await page.evaluate(PROBE)).players[0]));

  // Now build the opening: power -> refinery -> barracks -> war factory.
  const order = await page.evaluate(() => {
    const prod = globalThis.__vmProduction;
    const w = prod.world;
    const f = w.players[w.localPlayer].faction;
    return prod.catalog.roster(f, 0)
      .map((e) => ({ key: e.key, publicId: e.publicId, defId: e.defId, cost: e.cost, tab: e.tab, role: e.role, fw: e.footprintW, fh: e.footprintH }));
  });
  console.log('  buildable structures: ' + order.map((o) => o.key).join(', '));

  for (const want of ['power', 'refinery', 'barracks', 'factory']) {
    const res = await buildOne(page, want);
    console.log(`  build ${want}: ${JSON.stringify(res)}`);
    if (res.error) break;
  }

  await advance(page, 60);
  const mid = await page.evaluate(PROBE);
  console.log('  t+~90s: ' + JSON.stringify(mid.players[0]));

  // Produce units from every factory we have.
  const q = await page.evaluate(() => {
    const prod = globalThis.__vmProduction; const w = prod.world; const p = w.localPlayer;
    const f = w.players[p].faction;
    const picks = [];
    for (const e of [...prod.catalog.roster(f, 2), ...prod.catalog.roster(f, 3)]) {
      const a = prod.availability(p, e.publicId, { ok: false, reason: '' });
      if (!a.ok) continue;
      prod.channels.commands.issueProductionStart(p, e.tab, e.publicId, 1);
      picks.push(e.key);
      if (picks.length >= 4) break;
    }
    return picks;
  });
  console.log('  queued units: ' + JSON.stringify(q));
  await advance(page, 120);
  const end = await page.evaluate(PROBE);
  console.log('  t+~210s: ' + JSON.stringify(end.players[0]));
  console.log('  deploy counters: ' + JSON.stringify(end.deploy));
  if (errors.length) console.log('  console errors: ' + JSON.stringify(errors.slice(0, 6)));
  await page.close();
}

/** Queue + place one structure by role hint, as the sidebar would. */
/** Queue + place one structure, exactly as the sidebar does. */
async function buildOne(page, hint) {
  const started = await page.evaluate((h) => {
    const prod = globalThis.__vmProduction; const w = prod.world; const p = w.localPlayer;
    const f = w.players[p].faction;
    const RX = {
      power: /power|solar|furnace/i, refinery: /refinery|cistern|sorter/i,
      barracks: /barracks|chapterhouse|rookery/i, factory: /warFactory|forgeyard|breakerYard/i,
    };
    // `roster` is what the sidebar shows this army, faction filtering included.
    for (const e of prod.catalog.roster(f, 0)) {
      if (!RX[h].test(e.key)) continue;
      const a = prod.availability(p, e.publicId, { ok: false, reason: '' });
      if (!a.ok) return { key: e.key, blocked: a.reason };
      prod.channels.commands.issueProductionStart(p, e.tab, e.publicId, 1);
      return { key: e.key, publicId: e.publicId, tab: e.tab, cost: e.cost };
    }
    return { error: 'no ' + h + ' in catalog' };
  }, hint);
  if (started.error || started.blocked) return started;

  // Build it. The queue is on a fixed timestep, so stepping is the whole wait.
  let ready = false;
  for (let n = 0; n < 30 && !ready; n++) {
    await advance(page, 3);
    ready = await page.evaluate(() => {
      const prod = globalThis.__vmProduction; const w = prod.world;
      return prod.pendingStructure(w.localPlayer) !== null;
    });
  }
  if (!ready) return { ...started, error: 'never finished building' };

  // Place it: spiral out from the yard, one cell per attempt, stepping the sim
  // between tries because a PlaceBuilding is an intent the service applies on
  // its own tick. The refusals here are the refusals the player's ghost shows.
  const anchor = await page.evaluate(() => {
    const prod = globalThis.__vmProduction; const w = prod.world;
    const p = w.localPlayer; const st = w.store;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== p || st.kind[i] !== 3) continue;
      const e = prod.entryOf(st.handleOf(i));
      if (e && e.producesTabs.length > 0 && e.buildRadius > 0) return { cx: st.cellX[i], cz: st.cellZ[i] };
    }
    return null;
  });
  if (anchor === null) return { ...started, error: 'no construction yard to build from' };

  let placed = null;
  outer:
  for (let r = 3; r < 18 && placed === null; r++) {
    for (let a = 0; a < 20; a++) {
      const ang = (a / 20) * Math.PI * 2;
      const cx = Math.round(anchor.cx + Math.cos(ang) * r);
      const cz = Math.round(anchor.cz + Math.sin(ang) * r);
      const ok = await page.evaluate((c) => {
        const prod = globalThis.__vmProduction; const p = prod.world.localPlayer;
        prod.placeBuilding(p, c.id, c.cx, c.cz);
        return true;
      }, { id: started.publicId, cx, cz });
      void ok;
      await advance(page, 0.2);
      const done = await page.evaluate(() => {
        const prod = globalThis.__vmProduction;
        return prod.pendingStructure(prod.world.localPlayer) === null;
      });
      if (done) { placed = { cx, cz, r }; break outer; }
    }
  }
  if (placed === null) return { ...started, error: 'the ghost refused every cell within 18 of the yard' };

  // Let it rise.
  await advance(page, 12);
  const standing = await page.evaluate((s) => {
    const prod = globalThis.__vmProduction; const w = prod.world; const st = w.store;
    let n = 0;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== w.localPlayer || st.kind[i] !== 3) continue;
      if (prod.entryOf(st.handleOf(i))?.key === s.key) n++;
    }
    return n;
  }, started);
  return { ...started, ...placed, standing };
}

/* ========================= MODE: determinism ============================== */

async function modeDeterminism(browser) {
  const runs = [];
  for (let n = 0; n < 2; n++) {
    const { page, tick0 } = await boot(browser, { player: 'allies', ai: 'soviets', seed: 4242, difficulty: 2, start: process.argv[3] ?? 'mcv' });
    await advance(page, 300 - tick0 / 30);
    const s = await page.evaluate(PROBE);
    s.tick0 = tick0;
    runs.push(s);
    console.log(`  run ${n}: booted at tick ${tick0}, ended at tick ${s.tick}`);
    await page.close();
  }
  const norm = (s) => JSON.stringify(s.players.map((p) => ({ ...p, credits: Math.round(p.credits) }))) + JSON.stringify(s.deploy);
  console.log('run A:', norm(runs[0]));
  console.log('run B:', norm(runs[1]));
  console.log(norm(runs[0]) === norm(runs[1]) ? 'DETERMINISTIC (identical world at t+300s)' : 'DIVERGED');
}

/* -------------------------------------------------------------------------- */

/*
 * ALWAYS OUR OWN SERVER — the `alreadyUp` shortcut is deleted, not disabled.
 *
 * It was `const alreadyUp = await waitForServer(BASE, 1500); if (!alreadyUp)
 * start one`, and the saving it bought was one vite boot. What it cost is the
 * `determinism` mode below: two runs are booted and their worlds compared, and
 * if the port belongs to a neighbouring worktree then BOTH runs come off that
 * build and the verdict "DETERMINISTIC (identical world at t+300s)" is a true
 * statement about somebody else's simulation. A 1500 ms probe on a busy machine
 * also misreads a live server as an absent one, at which point our own vite
 * dies on --strictPort and nobody reads the exit code.
 *
 * `serve()` walks off a busy port instead of sharing it, so two agents can run
 * `playtest` at once — which is the case the shortcut was really trying to
 * serve, and served wrongly.
 */
const server = await serve({
  root: ROOT, mode: 'preview', portHint: PORT_HINT, log: console.log,
});
const BASE = server.origin;
const cleanup = () => server.stop();

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1'],
});

try {
  if (MODE === 'ai') await modeAi(browser);
  else if (MODE === 'human') await modeHuman(browser, process.argv[3] ?? 'allies');
  else if (MODE === 'determinism') await modeDeterminism(browser);
  else console.log('unknown mode');
} finally {
  await browser.close();
  cleanup();
}
process.exit(0);

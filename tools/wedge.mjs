/**
 * WEDGE HARNESS — can a unit get permanently stuck between two buildings?
 *
 *   node tools/wedge.mjs alley      # directed: a wall with one 1-cell gap
 *   node tools/wedge.mjs soak       # 10 min AI-vs-AI, count wedged units
 *
 * WHY A SECOND HARNESS AND NOT A MODE IN playtest.mjs
 * ---------------------------------------------------
 * playtest.mjs asks "is there a match here". This asks a physical question:
 * does the nav grid ever route a unit into a gap its hull cannot fit through.
 * It shares playtest's boot (freeze the sim BEFORE the shell writes the lobby
 * bank; step through `__VM.step`, never wall-clock) and nothing else.
 *
 * THE MEASUREMENT
 * ---------------
 * A unit is WEDGED when, over a window of `WINDOW_S` seconds, its position
 * moved less than `MOVE_EPS` metres total while it held a goal-seeking state
 * the whole time. That is deliberately stricter than "speed is zero": a unit
 * grinding into a wall at full throttle, or oscillating half a metre between
 * two separation pushes, both read as wedged and both are the bug.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = 4351;
const BASE = `http://localhost:${PORT}/`;
const MODE = process.argv[2] ?? 'alley';
const HEADED = process.argv.includes('--headed');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Seconds of no meaningful movement that counts as wedged. */
const WINDOW_S = 12;
/** Metres of total travel inside that window that still counts as moving. */
const MOVE_EPS = 1.5;

function run(cmd, args) {
  return spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
}
async function waitForServer(url, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* boot — identical contract to playtest.mjs, see its header for the two races */
/* -------------------------------------------------------------------------- */

async function boot(browser, { player, ai, seed, start = 'mcv', credits = 60000, difficulty = 2 }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180_000);
  page.setDefaultNavigationTimeout(180_000);
  const errors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t.slice(0, 300));
    else if (t.startsWith('[nav]')) errors.push('WARN ' + t.slice(0, 220));
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 300)));

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
  await page.waitForFunction(
    () => globalThis.__vmProduction?.world?.players?.length > 1, null, { timeout: 120_000 },
  );
  await page.evaluate(() => window.__VM.pause());
  await page.waitForFunction(
    (c) => globalThis.__vmProduction.world.players[0].credits === c, credits, { timeout: 60_000 },
  );
  return { page, errors };
}

async function advance(page, simSeconds) {
  const total = Math.round(simSeconds * 30);
  const CHUNK = 300;
  for (let done = 0; done < total; done += CHUNK) {
    await page.evaluate((n) => window.__VM.step(n), Math.min(CHUNK, total - done));
  }
}

/* -------------------------------------------------------------------------- */
/* in-page probes                                                              */
/* -------------------------------------------------------------------------- */

/** Every mobile unit: handle, position, radius, state, order, field. */
const SAMPLE = () => {
  const w = globalThis.__vmProduction.world;
  const st = w.store;
  const rows = [];
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    const k = st.kind[i];
    if (k !== 1 && k !== 2) continue;
    rows.push({
      id: st.handleOf(i), o: st.owner[i], x: st.posX[i], z: st.posZ[i],
      r: st.radius[i], s: st.state[i], sp: st.speed[i], k: st.kind[i],
      tgt: st.targetId[i], ox: st.orderX[i], oz: st.orderZ[i], f: st.navField[i],
    });
  }
  return { tick: w.tick, rows };
};

/**
 * The two numbers the brief asks for, side by side.
 *
 *   nav.narrow / nav.narrowRestored  — the PREVENTION. Cells the clearance rule
 *                                      is holding closed, and cells it had to
 *                                      hand back because they were the only way
 *                                      through.
 *   watchdog.*                       — the RECOVERY. If `displaced` is climbing
 *                                      while a match runs, prevention is not
 *                                      working and the net is carrying it.
 */
const COUNTERS = () => {
  const g = globalThis.__vmNav;
  const s = g?.stats ? g.stats() : null;
  return {
    nav: s === null || s === undefined ? null : {
      fields: s.fields, unreachable: s.unreachable,
      narrow: s.narrow, narrowRestored: s.narrowRestored, rebuilds: s.rebuilds,
    },
    watchdog: g?.agents?.watchdog ? { ...g.agents.watchdog() } : null,
    // Economy health, so a fix that unsticks units by breaking the harvester
    // loop cannot look like a win.
    eco: globalThis.__vmProduction.world.players.filter((p) => p.name !== 'Gaia').map((p) => {
      const st = globalThis.__vmProduction.world.store;
      let harv = 0;
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.owner[i] === p.id && st.cargoMax[i] > 0 && st.kind[i] === 2) harv++;
      }
      return { p: p.id, cr: Math.round(p.credits), harv };
    }),
  };
};

/** Describe the neighbourhood of a world position: cost cells and buildings. */
const DESCRIBE = (arg) => {
  const g = globalThis.__vmNav;
  const w = globalThis.__vmProduction.world;
  const st = w.store;
  const CELL = 4;
  const MAP_CELLS = 128;
  // The PHYSICAL grid — what a hull can actually stand in. `g.cost(2)` is the
  // ROUTING grid and now carries the clearance demotion, so measuring the
  // corridor with it would report the fix rather than the world.
  const cost = g.nav.hardGridFor(2);   // MoveClass.Wheel — the Scrapjaw's class
  const route = g.cost(2);
  const ccx = Math.floor(arg.x / CELL);
  const ccz = Math.floor(arg.z / CELL);
  const grid = [];
  for (let dz = -5; dz <= 5; dz++) {
    let line = '';
    for (let dx = -5; dx <= 5; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) { line += '?'; continue; }
      const i = cz * MAP_CELLS + cx;
      // '#' physically blocked, 'x' open ground the clearance rule closed to
      // routing, '.' ordinary open ground, '@' the cell being described.
      line += cost[i] >= 255 ? '#'
        : dx === 0 && dz === 0 ? '@'
          : route[i] >= 255 ? 'x' : '.';
    }
    grid.push(line);
  }
  const near = [];
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if (st.kind[i] !== 3) continue;
    const dx = st.posX[i] - arg.x, dz = st.posZ[i] - arg.z;
    if (dx * dx + dz * dz > 400) continue;
    near.push({
      cx: st.cellX[i], cz: st.cellZ[i], fw: st.footprintW[i], fh: st.footprintH[i],
      x: Math.round(st.posX[i] * 10) / 10, z: Math.round(st.posZ[i] * 10) / 10,
    });
  }
  // Free corridor width through the unit's own cell, in metres. This is the
  // number the hull has to fit inside, and the whole diagnosis turns on it.
  const open = (cx, cz) => cx >= 0 && cz >= 0 && cx < MAP_CELLS && cz < MAP_CELLS
    && cost[cz * MAP_CELLS + cx] < 255;
  let runX = 1, runZ = 1;
  for (let d = 1; d < 12 && open(ccx + d, ccz); d++) runX++;
  for (let d = 1; d < 12 && open(ccx - d, ccz); d++) runX++;
  for (let d = 1; d < 12 && open(ccx, ccz + d); d++) runZ++;
  for (let d = 1; d < 12 && open(ccx, ccz - d); d++) runZ++;
  return { cell: [ccx, ccz], grid, near, widthX: runX * CELL, widthZ: runZ * CELL };
};

/* -------------------------------------------------------------------------- */
/* wedge tracking across samples                                               */
/* -------------------------------------------------------------------------- */

/** UnitState values that mean "this unit is trying to get somewhere". */
const SEEKING = new Set([1, 2, 5, 7, 11, 12, 14]);

class WedgeTracker {
  constructor() { this.prev = new Map(); this.hits = new Map(); }

  /** Feed one sample taken `dt` seconds after the previous one. */
  feed(rows, dt) {
    const now = new Map();
    for (const r of rows) {
      const p = this.prev.get(r.id);
      const seeking = SEEKING.has(r.s);
      if (p === undefined || !seeking || !p.seeking) {
        now.set(r.id, { x: r.x, z: r.z, seeking, held: 0, travel: 0, row: r });
        continue;
      }
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      const travel = p.travel + d;
      const held = p.held + dt;
      if (travel > MOVE_EPS) {
        now.set(r.id, { x: r.x, z: r.z, seeking, held: 0, travel: 0, row: r });
      } else {
        now.set(r.id, { x: p.x, z: p.z, seeking, held, travel, row: r });
        if (held >= WINDOW_S) {
          const rec = this.hits.get(r.id) ?? { id: r.id, worst: 0, row: r };
          if (held > rec.worst) { rec.worst = held; rec.row = r; }
          this.hits.set(r.id, rec);
        }
      }
    }
    this.prev = now;
  }

  report() { return [...this.hits.values()].sort((a, b) => b.worst - a.worst); }
}

/* ============================== MODE: alley =============================== */

/** Queue + place one structure at an exact cell. Returns what happened. */
async function buildAt(page, keyRx, cx, cz, strict = true) {
  const started = await page.evaluate((h) => {
    const prod = globalThis.__vmProduction; const w = prod.world; const p = w.localPlayer;
    const f = w.players[p].faction;
    const rx = new RegExp(h, 'i');
    for (const e of prod.catalog.roster(f, 0).concat(prod.catalog.roster(f, 1))) {
      if (!rx.test(e.key)) continue;
      const a = prod.availability(p, e.publicId, { ok: false, reason: '' });
      if (!a.ok) return { key: e.key, blocked: a.reason };
      prod.channels.commands.issueProductionStart(p, e.tab, e.publicId, 1);
      return { key: e.key, publicId: e.publicId, fw: e.footprintW, fh: e.footprintH };
    }
    return { error: 'no ' + h + ' in catalog' };
  }, keyRx);
  if (started.error || started.blocked) return started;

  let ready = false;
  for (let n = 0; n < 40 && !ready; n++) {
    await advance(page, 2);
    ready = await page.evaluate(
      () => globalThis.__vmProduction.pendingStructure(globalThis.__vmProduction.world.localPlayer) !== null,
    );
  }
  if (!ready) return { ...started, error: 'never finished building' };

  // Strict placement wants the exact cell (the wall geometry is the point);
  // the base buildings only care that they exist, so those spiral outward.
  const tries = strict ? [[0, 0]] : spiral(6);
  let at = null;
  for (const [ox, oz] of tries) {
    await page.evaluate((c) => {
      const prod = globalThis.__vmProduction;
      prod.placeBuilding(prod.world.localPlayer, c.id, c.cx, c.cz);
    }, { id: started.publicId, cx: cx + ox, cz: cz + oz });
    await advance(page, 0.4);
    const placed = await page.evaluate(
      () => globalThis.__vmProduction.pendingStructure(globalThis.__vmProduction.world.localPlayer) === null,
    );
    if (placed) { at = { cx: cx + ox, cz: cz + oz }; break; }
  }
  if (at === null) return { ...started, cx, cz, error: 'ghost refused the cell' };

  // Let it rise: prereq checks read buildProgress, so a structure that has been
  // PLACED but not FINISHED still blocks everything downstream of it. Matched
  // by footprint rect, not by `cellX` — `cellX` is the CENTRE cell of a 2x2.
  for (let n = 0; n < 40; n++) {
    const done = await page.evaluate((c) => {
      const w = globalThis.__vmProduction.world; const st = w.store;
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.kind[i] !== 3) continue;
        if (st.cellX[i] < c.cx || st.cellX[i] >= c.cx + c.fw) continue;
        if (st.cellZ[i] < c.cz || st.cellZ[i] >= c.cz + c.fh) continue;
        return st.buildProgress[i] >= 1;
      }
      return false;
    }, { cx: at.cx, cz: at.cz, fw: started.fw, fh: started.fh });
    if (done) return { ...started, ...at, placed: true, built: true };
    await advance(page, 2);
  }
  return { ...started, ...at, placed: true, built: false };
}

/** Cell offsets in rings of growing radius, nearest first. */
function spiral(maxR) {
  const out = [[0, 0]];
  for (let r = 1; r <= maxR; r++) {
    for (let d = -r; d <= r; d++) { out.push([d, -r]); out.push([d, r]); }
    for (let d = -r + 1; d <= r - 1; d++) { out.push([-r, d]); out.push([r, d]); }
  }
  return out;
}

async function modeAlley(browser) {
  const { page, errors } = await boot(browser, { player: 'reclaim', ai: 'soviets', seed: 11 });
  const log = (...a) => console.log(...a);

  // 1. Deploy the crawler into a Foundry.
  await page.evaluate(() => {
    const prod = globalThis.__vmProduction; const w = prod.world; const st = w.store;
    let best = -1;
    for (let a = 0; a < st.aliveCount; a++) {
      const k = st.alive[a];
      if (st.owner[k] !== w.localPlayer || st.kind[k] === 3) continue;
      if (best < 0 || st.maxHp[k] > st.maxHp[best]) best = k;
    }
    if (best < 0) return;
    prod.channels.commands.issueOrder(
      w.localPlayer, 8, [st.handleOf(best)], 1, st.posX[best], st.posZ[best], st.handleOf(best), false,
    );
  });
  await advance(page, 6);

  const yard = await page.evaluate(() => {
    const prod = globalThis.__vmProduction; const w = prod.world; const st = w.store;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== w.localPlayer || st.kind[i] !== 3) continue;
      const e = prod.entryOf(st.handleOf(i));
      if (e && e.buildRadius > 0) return { cx: st.cellX[i], cz: st.cellZ[i], x: st.posX[i], z: st.posZ[i] };
    }
    return null;
  });
  log('  foundry at cell', yard);
  if (yard === null) { await page.close(); throw new Error('no foundry'); }

  // 2. Power -> refinery (ships a Scrapjaw) -> rookery (unlocks barricades).
  for (const [rx, dx, dz] of [['furnace|power', -6, -6], ['sorter|refinery', 6, -6], ['rookery|barracks', -6, 6]]) {
    const r = await buildAt(page, rx, yard.cx + dx, yard.cz + dz, false);
    log(`  build ${rx}:`, JSON.stringify(r));
  }
  await advance(page, 10);

  const harv = await page.evaluate(() => {
    const prod = globalThis.__vmProduction; const w = prod.world; const st = w.store;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== w.localPlayer) continue;
      if (st.kind[i] !== 2 || st.cargoMax[i] <= 0) continue;
      return {
        id: st.handleOf(i), r: st.radius[i],
        x: st.posX[i], z: st.posZ[i], cx: st.cellX[i], cz: st.cellZ[i],
      };
    }
    return null;
  });
  log('  scrapjaw:', JSON.stringify(harv));
  if (harv === null) { await page.close(); throw new Error('no harvester spawned'); }
  log(`  >>> hull radius ${harv.r.toFixed(2)} m — needs ${(harv.r * 2).toFixed(2)} m of free width; one cell is 4 m`);

  // 3. Let the Scrapjaw pick an ore patch, then wall off the route it is
  //    already driving, leaving EXACTLY ONE one-cell gap. Barricades are 1x1,
  //    so the geometry is exact rather than inferred, and the harvester's own
  //    FSM keeps re-issuing the haul — the user's case, not a scripted one.
  await advance(page, 20);
  const route = await page.evaluate((hid) => {
    const w = globalThis.__vmProduction.world; const st = w.store;
    const i = st.index(hid);
    if (i < 0) return null;
    return { x: st.posX[i], z: st.posZ[i], ox: st.orderX[i], oz: st.orderZ[i], s: st.state[i] };
  }, harv.id);
  log('  route:', JSON.stringify(route));

  const refi = await page.evaluate(() => {
    const prod = globalThis.__vmProduction; const w = prod.world; const st = w.store;
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== w.localPlayer || st.kind[i] !== 3) continue;
      if (st.cargoMax[i] > 0 || (prod.entryOf(st.handleOf(i))?.key ?? '').match(/sorter|refinery/i)) {
        return { x: st.posX[i], z: st.posZ[i] };
      }
    }
    return null;
  });
  log('  refinery:', JSON.stringify(refi));

  // Wall perpendicular to refinery -> ore, planted at the midpoint.
  let ax = route.ox - refi.x, az = route.oz - refi.z;
  const al = Math.hypot(ax, az) || 1;
  ax /= al; az /= al;
  const midX = refi.x + ax * Math.min(al * 0.5, 34);
  const midZ = refi.z + az * Math.min(al * 0.5, 34);
  const px = -az, pz = ax;                       // perpendicular, unit length
  const gapCx = Math.floor(midX / 4);
  const gapCz = Math.floor(midZ / 4);

  const built = [];
  for (let d = 1; d <= 7; d++) {
    for (const sgn of [1, -1]) {
      const cx = Math.round(gapCx + px * d * sgn);
      const cz = Math.round(gapCz + pz * d * sgn);
      if (cx === gapCx && cz === gapCz) continue;
      const r = await buildAt(page, 'barricade|wall', cx, cz);
      built.push(r.placed === true ? 1 : 0);
    }
  }
  log(`  wall: ${built.reduce((a, b) => a + b, 0)}/${built.length} segments standing, ` +
      `gap at cell ${gapCx},${gapCz}`);
  await advance(page, 6);

  const shape = await page.evaluate(DESCRIBE, { x: (gapCx + 0.5) * 4, z: (gapCz + 0.5) * 4 });
  log('  cost grid around the gap (# blocked, @ gap centre):');
  for (const l of shape.grid) log('    ' + l);

  // 4. Now just let the economy run. Every haul has to thread that gap.
  const tracker = new WedgeTracker();
  let last = (await page.evaluate(SAMPLE)).rows;
  tracker.feed(last, 0);
  for (let t = 0; t < 180; t++) {
    await advance(page, 1);
    const s = await page.evaluate(SAMPLE);
    tracker.feed(s.rows, 1);
    last = s.rows;
    if ((t + 1) % 30 === 0) {
      const me = last.find((r) => r.id === harv.id);
      log(`  t+${t + 1}s scrapjaw ${me ? me.x.toFixed(1) + ',' + me.z.toFixed(1) : 'dead'} ` +
          `state=${me?.s} speed=${me?.sp?.toFixed(2)} field=${me?.f}`);
    }
  }
  const hits = tracker.report();
  log(`  WEDGED UNITS: ${hits.length}`);
  for (const h of hits.slice(0, 8)) {
    log(`    id ${h.id} stationary ${h.worst}s at ${h.row.x.toFixed(1)},${h.row.z.toFixed(1)} ` +
        `state=${h.row.s} speed=${h.row.sp.toFixed(2)} field=${h.row.f}`);
    const d = await page.evaluate(DESCRIBE, { x: h.row.x, z: h.row.z });
    log(`      corridor through its cell: ${d.widthX} m in X, ${d.widthZ} m in Z ` +
        `(hull needs ${(h.row.r * 2).toFixed(2)} m)`);
    for (const l of d.grid) log('      ' + l);
    log('      buildings within 20 m: ' + JSON.stringify(d.near));
  }
  const c = await page.evaluate(COUNTERS);
  log('  counters:', JSON.stringify(c));
  if (errors.length) log('  console errors:', errors.slice(0, 4));
  await page.close();
}

/* =============================== MODE: soak ============================== */

async function modeSoak(browser) {
  const minutes = Number(process.argv[3] ?? 10);
  const { page, errors } = await boot(browser, { player: 'reclaim', ai: 'reclaim', seed: 7, credits: 12000 });
  console.log(`\n=== soak: ${minutes} min, reclaim vs reclaim ===`);
  // Deploy so the human side also builds a base the AI's units drive through.
  await page.evaluate(() => {
    const prod = globalThis.__vmProduction; const w = prod.world; const st = w.store;
    let best = -1;
    for (let a = 0; a < st.aliveCount; a++) {
      const k = st.alive[a];
      if (st.owner[k] !== w.localPlayer || st.kind[k] === 3) continue;
      if (best < 0 || st.maxHp[k] > st.maxHp[best]) best = k;
    }
    if (best >= 0) {
      prod.channels.commands.issueOrder(
        w.localPlayer, 8, [st.handleOf(best)], 1, st.posX[best], st.posZ[best], st.handleOf(best), false,
      );
    }
  });

  const tracker = new WedgeTracker();
  const steps = minutes * 60;
  for (let t = 0; t < steps; t++) {
    await advance(page, 1);
    const s = await page.evaluate(SAMPLE);
    tracker.feed(s.rows, 1);
    if ((t + 1) % 60 === 0) {
      const c = await page.evaluate(COUNTERS);
      console.log(`  t+${(t + 1) / 60}min  units=${s.rows.length}  wedged=${tracker.report().length}  ` +
        `${JSON.stringify(c)}`);
    }
  }
  const hits = tracker.report();
  console.log(`\n  WEDGED UNITS OVER ${minutes} MIN: ${hits.length}`);
  for (const h of hits.slice(0, 12)) {
    console.log(`    id ${h.id} owner ${h.row.o} stationary ${h.worst}s at ` +
      `${h.row.x.toFixed(1)},${h.row.z.toFixed(1)} kind=${h.row.k} state=${h.row.s} ` +
      `target=${h.row.tgt} speed=${h.row.sp.toFixed(2)} field=${h.row.f}`);
    const d = await page.evaluate(DESCRIBE, { x: h.row.x, z: h.row.z });
    console.log(`      corridor: ${d.widthX} m in X, ${d.widthZ} m in Z ` +
      `(hull needs ${(h.row.r * 2).toFixed(2)} m)`);
    for (const l of d.grid) console.log('      ' + l);
  }
  const c = await page.evaluate(COUNTERS);
  console.log('  final counters:', JSON.stringify(c));
  if (errors.length) console.log('  console errors:', errors.slice(0, 4));
  await page.close();
}

/* -------------------------------------------------------------------------- */

let server = null;
const alreadyUp = await waitForServer(BASE, 1500);
if (!alreadyUp) server = run('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort']);
const cleanup = () => { try { server?.kill(); } catch { /* already gone */ } };
process.on('exit', cleanup);
if (!(await waitForServer(BASE))) { cleanup(); throw new Error('preview never came up'); }

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1'],
});

try {
  if (MODE === 'alley') await modeAlley(browser);
  else if (MODE === 'soak') await modeSoak(browser);
  else console.log('unknown mode: ' + MODE);
} finally {
  await browser.close();
  cleanup();
}
process.exit(0);

/**
 * ORDER PROBE — does a right-click actually move the units?
 *
 * Drives the REAL input path: playwright mouse events on the canvas, the real
 * marquee, the real right-click. Two phases:
 *
 *   stepped  — sim frozen between clicks, so the measurement is not a race
 *   live     — loop running at wall clock, clicks as fast as a player can
 *
 *   node tools/order-probe.mjs [--headed] [--clicks=20]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PROBE_PORT ?? 4351);
const BASE = `http://localhost:${PORT}/`;
const ROOT = process.env.PROBE_ROOT
  ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const HEADED = process.argv.includes('--headed');
const CLICKS = Number((process.argv.find((a) => a.startsWith('--clicks=')) ?? '--clicks=20').slice(9));

function run(cmd, args) {
  return spawn(cmd, args, { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
}
async function waitForServer(url, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/* ---------------------------------------------------------------- in-page -- */

const UNITS = () => {
  const w = globalThis.__vmProduction.world;
  const st = w.store;
  const out = [];
  for (let a = 0; a < st.aliveCount; a++) {
    const i = st.alive[a];
    if (st.owner[i] !== w.localPlayer) continue;
    if (st.kind[i] === 3) continue;
    if ((st.flags[i] & 512) === 0) continue; // CanMove
    out.push({
      id: st.handleOf(i), i, kind: st.kind[i], loco: st.locomotor[i],
      stance: st.stance[i], state: st.state[i], order: st.orderKind[i],
      x: +st.posX[i].toFixed(2), z: +st.posZ[i].toFixed(2),
      ox: +st.orderX[i].toFixed(2), oz: +st.orderZ[i].toFixed(2),
      gx: +st.guardX[i].toFixed(2), gz: +st.guardZ[i].toFixed(2),
      field: st.navField[i], sel: (st.flags[i] & 4) !== 0,
    });
  }
  return out;
};

const BUS = () => {
  const c = globalThis.__vmProduction.channels.commands;
  return { pending: c.pending, dropped: c.droppedCommands, tick: globalThis.__vmProduction.world.tick };
};

const SEL = () => globalThis.__vmProduction.world.selection.count;

/* ------------------------------------------------------------------ boot -- */

async function boot(browser, { player = 'allies', ai = 'soviets', seed = 7, start = 'base', credits = 20000 } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 300)));

  await page.goto(BASE + '?blank=1', { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('voltmarch.setup.v1', JSON.stringify({
      playerFaction: s.player, aiFaction: s.ai, map: 'temperate',
      difficulty: 2, personality: -1, startingCredits: s.credits, speed: 1, seed: s.seed,
    }));
    localStorage.setItem('voltmarch.setup.start.v1', JSON.stringify(s.start));
  }, { player, ai, seed, start, credits });

  await page.goto(`${BASE}?skipmenu=1&start=${start}&seed=${seed}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 120_000 });
  await page.evaluate(() => window.__VM.ready());
  await page.waitForFunction(() => globalThis.__vmProduction?.world?.players?.length > 1, null, { timeout: 120_000 });
  await page.evaluate(() => window.__VM.pause());
  await page.waitForFunction((c) => globalThis.__vmProduction.world.players[0].credits === c, credits, { timeout: 60_000 });
  await page.evaluate(() => window.__VM.setUiVisible(true));
  await page.evaluate(() => {
    globalThis.__orders = [];
    globalThis.__vmProduction.channels.events.on('order:issued', (p) => {
      globalThis.__orders.push({ order: p.order, count: p.count, x: +p.x.toFixed(1), z: +p.z.toFixed(1) });
    });
  });
  return { page, errors };
}

const step = (page, n) => page.evaluate((k) => window.__VM.step(k), n);
const frames = (page, n) => page.evaluate((k) => window.__VM.advanceFrames(k), n);

/** A screen point that is (a) on the canvas and (b) over real ground. */
async function canvasPoint(page, px, py) {
  return page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    const tag = el === null ? 'null' : `${el.tagName}.${(el.className || '-').toString().slice(0, 24)}`;
    return { tag };
  }, [Math.round(px), Math.round(py)]);
}

/* ------------------------------------------------------------------ main -- */

(async () => {
  const server = run('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort']);
  process.on('exit', () => server.kill());
  if (!await waitForServer(BASE)) { console.error('server never came up'); process.exit(1); }

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const { page, errors } = await boot(browser, {});
  await step(page, 60);

  const units = await page.evaluate(UNITS);
  console.log(`units at t0: ${units.length}  kinds=${JSON.stringify(units.map((u) => `${u.kind}/${u.loco}`))}`);
  if (units.length === 0) { console.log('no mobile units'); await browser.close(); server.kill(); return; }

  const cx = units.reduce((a, u) => a + u.x, 0) / units.length;
  const cz = units.reduce((a, u) => a + u.z, 0) / units.length;
  await page.evaluate(([x, z]) => window.__VM.focusOn(x, z), [cx, cz]);
  await frames(page, 6);

  await page.mouse.move(200, 120);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(1000, 560, { steps: 12 });
  await page.mouse.up({ button: 'left' });
  await frames(page, 2);
  console.log(`selected: ${await page.evaluate(SEL)}`);

  // Screen points known to be over the battlefield canvas, cycled.
  const PTS = [[330, 190], [620, 200], [880, 300], [260, 430], [700, 470], [520, 300],
    [400, 520], [820, 180], [300, 260], [660, 380]];
  for (const [px, py] of PTS) {
    const c = await canvasPoint(page, px, py);
    if (c.tag !== 'CANVAS.-') console.log(`  WARNING point ${px},${py} is over ${c.tag}`);
  }

  async function phase(name, { live, betweenTicks, delayMs }) {
    console.log(`\n=== ${name} ===`);
    if (live) await page.evaluate(() => window.__VM.resume());
    let fails = 0;
    for (let k = 0; k < CLICKS; k++) {
      const [px, py] = PTS[k % PTS.length];
      const before = await page.evaluate(UNITS);
      await page.evaluate(() => { globalThis.__orders.length = 0; });
      await page.mouse.move(px, py, { steps: 3 });
      await page.mouse.click(px, py, { button: 'right' });
      const emitted = await page.evaluate(() => globalThis.__orders.slice());
      if (live) await new Promise((r) => setTimeout(r, delayMs));
      else await step(page, betweenTicks);
      const after = await page.evaluate(UNITS);
      const bus = await page.evaluate(BUS);
      const sel = await page.evaluate(SEL);
      let retarget = 0;
      for (const u of after) {
        const b = before.find((q) => q.id === u.id);
        if (b && Math.hypot(u.ox - b.ox, u.oz - b.oz) > 0.6) retarget++;
      }
      const ok = emitted.length > 0;
      if (!ok) fails++;
      console.log(`  ${k}: pt(${px},${py}) sel=${sel} emitted=${emitted.length ? JSON.stringify(emitted[0]) : 'NONE'} ` +
        `retargeted=${retarget}/${after.length} pending=${bus.pending} dropped=${bus.dropped}`);
    }
    console.log(`  ${name}: ${fails}/${CLICKS} clicks produced no order at all`);
    if (live) await page.evaluate(() => window.__VM.pause());
  }

  await phase('stepped, 20 ticks between', { live: false, betweenTicks: 20 });
  await phase('stepped, 2 ticks between', { live: false, betweenTicks: 2 });
  await phase('live, 150 ms between', { live: true, delayMs: 150 });

  /* ---- aircraft ---------------------------------------------------------- */
  console.log('\n=== aircraft ===');
  const spawned = await page.evaluate(([x, z]) => {
    const prod = globalThis.__vmProduction;
    const w = prod.world;
    const p = w.players[w.localPlayer];
    const f = p.faction;
    let entry = null;
    for (let tab = 0; tab < 6 && entry === null; tab++) {
      for (const e of prod.catalog.roster(f, tab)) {
        if (/vindicator|mig|kestrel|hornet/i.test(e.key)) { entry = e; break; }
      }
    }
    if (entry === null) return { error: 'no aircraft in roster' };
    const ids = [];
    for (let k = 0; k < 4; k++) {
      const id = prod.spawnUnit(p, entry, x + k * 6 - 9, z - 14, 0);
      if (id !== 0) ids.push(id);
    }
    const st = w.store;
    return {
      key: entry.key,
      units: ids.map((id) => {
        const i = st.index(id);
        return { id, loco: st.locomotor[i], kind: st.kind[i], y: +st.posY[i].toFixed(1), state: st.state[i] };
      }),
    };
  }, [cx, cz]);
  console.log('spawned: ' + JSON.stringify(spawned));

  const AIR = () => {
    const w = globalThis.__vmProduction.world; const st = w.store;
    const out = [];
    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      if (st.owner[i] !== w.localPlayer || st.locomotor[i] !== 5) continue;
      out.push({ id: st.handleOf(i), y: +st.posY[i].toFixed(2), flags: st.flags[i],
        canMove: (st.flags[i] & 512) !== 0, sel: (st.flags[i] & 4) !== 0,
        state: st.state[i], order: st.orderKind[i], field: st.navField[i],
        x: +st.posX[i].toFixed(2), z: +st.posZ[i].toFixed(2),
        ox: +st.orderX[i].toFixed(2), oz: +st.orderZ[i].toFixed(2) });
    }
    return out;
  };

  if (!spawned.error) {
    console.log('air now: ' + JSON.stringify(await page.evaluate(AIR)));
    await step(page, 30);
    console.log('air after 30 ticks: ' + JSON.stringify(await page.evaluate(AIR)));

    // Put the camera on the flight and marquee-select it, exactly as a player would.
    const ax = await page.evaluate(() => {
      const w = globalThis.__vmProduction.world; const st = w.store;
      let sx = 0, sz = 0, n = 0;
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.owner[i] !== w.localPlayer || st.locomotor[i] !== 5) continue;
        sx += st.posX[i]; sz += st.posZ[i]; n++;
      }
      return n === 0 ? null : [sx / n, sz / n];
    });
    if (ax === null) { console.log('no aircraft survived'); }
    else {
      await page.evaluate(([x, z]) => window.__VM.focusOn(x, z), ax);
      await frames(page, 6);

      // WHERE THE GAME DRAWS THEM, ASKED OF THE GAME.
      //
      // An earlier version of this did the projection itself out of
      // `camera.matrixWorldInverse` and `projectionMatrix`, and it was wrong by
      // about 80 px vertically — it ignored the canvas rect that
      // `CameraRig.worldToScreen` adds and the lift `pickEntity` aims at. The
      // harness then clicked empty sky and reported that aircraft could not be
      // selected, which was true for a completely different reason. An
      // instrument that recomputes what it is measuring will eventually
      // disagree with it; ask the rig.
      const proj = await page.evaluate(() => {
        const w = globalThis.__vmProduction.world; const st = w.store;
        const rig = window.__VM.rig; const T = window.__VM.THREE;
        const at = (x, y, z) => {
          const p = new T.Vector2();
          rig.worldToScreen(new T.Vector3(x, y, z), p);
          return [Math.round(p.x), Math.round(p.y)];
        };
        const out = [];
        for (let a = 0; a < st.aliveCount; a++) {
          const i = st.alive[a];
          if (st.owner[i] !== w.localPlayer || st.locomotor[i] !== 5) continue;
          const hit = new T.Vector3();
          const sprite = at(st.posX[i], st.posY[i] + st.radius[i] * 0.9, st.posZ[i]);
          rig.screenToGround(sprite[0], sprite[1], hit);
          out.push({ id: st.handleOf(i), air: sprite, ground: at(st.posX[i], 0, st.posZ[i]),
            // The whole defect in one number: how far the terrain under the
            // hull's pixels is from the hull, against pickEntity's 11.6 m query.
            groundOffsetM: +Math.hypot(hit.x - st.posX[i], hit.z - st.posZ[i]).toFixed(1) });
        }
        return out;
      });
      console.log('aircraft screen positions: ' + JSON.stringify(proj));

      // Marquee that definitely covers where they are drawn.
      const xs = proj.map((q) => q.air[0]); const ys = proj.map((q) => q.air[1]);
      const bx0 = Math.max(4, Math.min(...xs) - 60), bx1 = Math.min(1000, Math.max(...xs) + 60);
      const by0 = Math.max(4, Math.min(...ys) - 60), by1 = Math.min(700, Math.max(...ys) + 60);
      await page.mouse.move(bx0, by0);
      await page.mouse.down({ button: 'left' });
      await page.mouse.move(bx1, by1, { steps: 10 });
      await page.mouse.up({ button: 'left' });
      await frames(page, 2);
      let airSel = await page.evaluate(AIR);
      console.log(`marquee(${bx0},${by0}..${bx1},${by1}) -> selected ${await page.evaluate(SEL)} (air: ${airSel.filter((u) => u.sel).length}/${airSel.length})`);

      // And a plain left-click straight on one.
      await page.mouse.click(proj[0].air[0], proj[0].air[1], { button: 'left' });
      await frames(page, 2);
      airSel = await page.evaluate(AIR);
      console.log(`click on aircraft sprite -> selected ${await page.evaluate(SEL)} (air: ${airSel.filter((u) => u.sel).length}/${airSel.length})`);
      if (airSel.filter((u) => u.sel).length === 0) {
        await page.mouse.click(proj[0].ground[0], proj[0].ground[1], { button: 'left' });
        await frames(page, 2);
        airSel = await page.evaluate(AIR);
        console.log(`click on aircraft GROUND point -> selected ${await page.evaluate(SEL)} (air: ${airSel.filter((u) => u.sel).length}/${airSel.length})`);
      }

      for (let k = 0; k < 6; k++) {
        const [px, py] = PTS[k % PTS.length];
        const before = await page.evaluate(AIR);
        await page.evaluate(() => { globalThis.__orders.length = 0; });
        await page.mouse.move(px, py, { steps: 3 });
        await page.mouse.click(px, py, { button: 'right' });
        const emitted = await page.evaluate(() => globalThis.__orders.slice());
        await step(page, 30);
        const after = await page.evaluate(AIR);
        let moved = 0;
        for (const u of after) {
          const b = before.find((q) => q.id === u.id);
          if (b && Math.hypot(u.x - b.x, u.z - b.z) > 0.6) moved++;
        }
        console.log(`  air click ${k}: emitted=${emitted.length ? JSON.stringify(emitted[0]) : 'NONE'} moved=${moved}/${after.length} ` +
          after.slice(0, 3).map((u) => `s${u.state}o${u.order}f${u.field}@${u.x},${u.z}->${u.ox},${u.oz}`).join(' | '));
      }
    }
  }

  if (errors.length) console.log('console errors:', errors.slice(0, 8));
  await browser.close();
  server.kill();
})();

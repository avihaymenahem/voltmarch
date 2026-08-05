/**
 * ============================================================================
 * TUTORIAL PLAYTHROUGH — can a new player actually finish it?
 * ============================================================================
 *
 *   node tools/tutorial-playthrough.mjs            # headless, full run
 *   node tools/tutorial-playthrough.mjs --headed   # watch it play
 *
 * WHY THIS EXISTS AND WHY `npm test` DOES NOT COVER IT
 * ----------------------------------------------------
 * `tests/tutorial.spec.ts` proves the RULES: every named binding resolves
 * through `ActionCatalogue`, every step completes from the signal it claims to
 * watch and from no other. What it cannot prove is that those signals ever
 * ARRIVE — that `selection:changed` really fires when a player clicks a tank,
 * that `building:completed` really carries something the classifier calls a
 * refinery, that the camera probe really sees the rig the mouse drags. A
 * tutorial whose completion conditions are all correct and never fire is a
 * tutorial that traps the player on step one, and every unit test in the repo
 * would still be green.
 *
 * So this drives the SHIPPED BUILD through a real browser: it clicks Tutorial
 * on the title screen, then plays the fourteen steps with the mouse and the
 * keyboard — arrow keys to pan, the wheel to zoom, a click to select, a
 * marquee to take the group, a right-click to move, the bound attack-move key,
 * the bound deploy key, real sidebar cameos, real ground clicks to place — and
 * asserts after each one that the director advanced to the step it should have.
 *
 * WHAT IS *NOT* MOUSE-DRIVEN, STATED PLAINLY
 * ------------------------------------------
 * Structure placement falls back to `ProductionService.placeBuilding` when a
 * spiral of real ground clicks cannot find a legal cell, and the run prints
 * which path each placement took (`click` or `api`). That fallback is the same
 * door `tools/playtest.mjs` uses and it is still the player's own command path
 * — it just skips the ghost. Everything else in the run is genuine input.
 *
 * THE TWO BOOT TRAPS FROM `tools/playtest.mjs` APPLY HERE TOO
 * ----------------------------------------------------------
 * The sim is frozen only AFTER the director says it has started observing,
 * which is after `Shell.startMatch` has resolved and `applyPostBoot` has
 * written the bank and posed the camera. Freezing earlier resets the bank under
 * a running match; freezing later lets minutes of sim run at wall-clock speed
 * while the harness is still clicking.
 *
 * EXIT CODE
 * ---------
 * 0 only when the fourteenth step was acknowledged, the shell returned to the
 * title screen and `vm.tutorial.v1` reads back `done: true`.
 * ============================================================================
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = 4332;
const BASE = `http://localhost:${PORT}/`;
const HEADED = process.argv.includes('--headed');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* -------------------------------------------------------------------------- */
/* server                                                                      */
/* -------------------------------------------------------------------------- */

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
/* in-page helpers — installed before any page script runs                     */
/* -------------------------------------------------------------------------- */

const HELPERS = () => {
  const g = globalThis;
  const tp = {
    /* -- world reads ---------------------------------------------------- */
    world() { return g.__vmProduction.world; },
    prod() { return g.__vmProduction; },
    local() { return tp.world().localPlayer; },

    /** Every live index the local player owns. */
    mine(kind) {
      const w = tp.world(); const st = w.store; const out = [];
      for (let a = 0; a < st.aliveCount; a++) {
        const i = st.alive[a];
        if (st.owner[i] !== w.localPlayer) continue;
        if (kind === 'unit' && st.kind[i] === 3) continue;
        if (kind === 'building' && st.kind[i] !== 3) continue;
        out.push(i);
      }
      return out;
    },

    keyOf(i) {
      try { return tp.prod().entryOf(tp.world().store.handleOf(i))?.key ?? '?'; } catch { return '?'; }
    },

    /** Centroid of everything the player owns — what `cam.home` centres on. */
    home() {
      const w = tp.world(); const st = w.store;
      const b = tp.mine('building');
      for (const i of b) {
        const e = tp.prod().entryOf(st.handleOf(i));
        if (e && e.buildRadius > 0) return { x: st.posX[i], z: st.posZ[i] };
      }
      const all = tp.mine('any');
      if (all.length === 0) return { x: 0, z: 0 };
      let sx = 0; let sz = 0;
      for (const i of all) { sx += st.posX[i]; sz += st.posZ[i]; }
      return { x: sx / all.length, z: sz / all.length };
    },

    /* -- projection ----------------------------------------------------- */
    canvas() { return g.__VM.renderer.domElement; },

    /** World point -> CSS pixel, or null when it is behind the camera. */
    screen(x, y, z) {
      const THREE = g.__VM.THREE;
      const v = new THREE.Vector3(x, y, z).project(g.__VM.camera);
      if (v.z > 1) return null;
      const r = tp.canvas().getBoundingClientRect();
      return {
        x: r.left + (v.x * 0.5 + 0.5) * r.width,
        y: r.top + (-v.y * 0.5 + 0.5) * r.height,
        ndc: { x: v.x, y: v.y },
      };
    },

    /** True when a click at this pixel reaches the battlefield, not the HUD. */
    free(p) {
      if (p === null) return false;
      const r = tp.canvas().getBoundingClientRect();
      if (p.x < r.left + 8 || p.x > r.right - 8) return false;
      if (p.y < r.top + 8 || p.y > r.bottom - 8) return false;
      return document.elementFromPoint(p.x, p.y) === tp.canvas();
    },

    /** Screen point of one owned entity, aimed slightly above its origin. */
    pointOf(i) {
      const st = tp.world().store;
      return tp.screen(st.posX[i], st.posY[i] + 1.2, st.posZ[i]);
    },

    /** The first unit of the local player matching a key pattern. */
    unitLike(rx) {
      const re = new RegExp(rx, 'i');
      for (const i of tp.mine('unit')) if (re.test(tp.keyOf(i))) return i;
      return -1;
    },

    buildingLike(rx) {
      const re = new RegExp(rx, 'i');
      for (const i of tp.mine('building')) if (re.test(tp.keyOf(i))) return i;
      return -1;
    },

    /** Screen bounding box of every owned unit, for a marquee. */
    unitsBox() {
      const pts = [];
      for (const i of tp.mine('unit')) {
        const p = tp.pointOf(i);
        if (tp.free(p)) pts.push(p);
      }
      if (pts.length < 2) return null;
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      return { minX: minX - 26, minY: minY - 26, maxX: maxX + 26, maxY: maxY + 26, n: pts.length };
    },

    /**
     * A clickable patch of bare ground, spiralling out from a world anchor.
     * Returns the pixel and the world point it stands for.
     */
    ground(ax, ay, az, from, to) {
      for (let r = from; r <= to; r += 4) {
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          const wx = ax + Math.cos(ang) * r;
          const wz = az + Math.sin(ang) * r;
          const p = tp.screen(wx, ay, wz);
          if (tp.free(p)) return { x: p.x, y: p.y, wx, wz, r };
        }
      }
      return null;
    },

    /* -- HUD reads ------------------------------------------------------ */
    cameos(tab) {
      const s = tp.prod().snapshot;
      return (s.cameos[tab] ?? []).map((c) => ({
        key: c.key, name: c.name, available: c.available, ready: c.ready,
        queued: c.queued, progress: c.progress, reason: c.reason,
      }));
    },

    /** Index of the first cameo on a tab whose key matches, or -1. */
    slotFor(tab, rx) {
      const re = new RegExp(rx, 'i');
      const list = tp.cameos(tab);
      for (let i = 0; i < list.length; i++) if (re.test(list[i].key)) return i;
      return -1;
    },

    slotRect(i) {
      const slots = document.querySelectorAll('.vm-dock-build .vm-slot');
      const n = slots[i];
      if (!n || n.hidden) return null;
      const r = n.getBoundingClientRect();
      if (r.width <= 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },

    tabRect(i) {
      const tabs = document.querySelectorAll('.vm-dock-build .vm-tab');
      const n = tabs[i];
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },

    pending() { return tp.prod().pendingStructure(tp.local()) !== null; },

    /* -- the director --------------------------------------------------- */
    step() { return g.__vmTutorial ? g.__vmTutorial.currentStepId : '(none)'; },
    facts() { return g.__vmTutorial ? g.__vmTutorial.snapshot() : null; },

    /** The tutorial card's own buttons, by their label. */
    cardButton(text) {
      for (const b of document.querySelectorAll('.vt-card .vt-btn')) {
        if ((b.textContent ?? '').trim().toLowerCase() === text.toLowerCase()) {
          const r = b.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: b.textContent };
        }
      }
      return null;
    },

    /** What the card is showing right now — title, goals and key caps. */
    card() {
      const root = document.querySelector('.vt-card');
      if (root === null) return null;
      return {
        eyebrow: root.querySelector('.vt-eyebrow')?.textContent ?? '',
        title: root.querySelector('.vt-title')?.textContent ?? '',
        goals: [...root.querySelectorAll('.vt-goal')].map((n) => ({
          label: n.textContent ?? '', done: n.classList.contains('is-done'),
        })),
        keys: [...root.querySelectorAll('.vt-keyrow')].map((n) => ({
          name: n.querySelector('.vt-keyrow-name')?.textContent ?? '',
          caps: [...n.querySelectorAll('.vt-cap')].map((c) => c.textContent ?? ''),
        })),
        spotVisible: document.querySelector('.vt-spot')?.hidden === false,
      };
    },

    /** Where the spotlight ring is, so the harness can prove it landed. */
    spot() {
      const n = document.querySelector('.vt-spot');
      if (n === null || n.hidden) return null;
      const r = n.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    },
  };
  g.__tp = tp;
};

/* -------------------------------------------------------------------------- */
/* driving primitives                                                          */
/* -------------------------------------------------------------------------- */

const frames = (page, n) => page.evaluate((k) => window.__VM.waitFrames(k), n);
const sim = async (page, seconds) => {
  const total = Math.round(seconds * 30);
  for (let done = 0; done < total; done += 300) {
    await page.evaluate((n) => window.__VM.step(n), Math.min(300, total - done));
  }
  // One real frame, so the director sees the facts the steps just produced.
  await frames(page, 2);
};
const stepId = (page) => page.evaluate(() => window.__tp.step());
const facts = (page) => page.evaluate(() => window.__tp.facts());

async function hold(page, code, ms) {
  await page.keyboard.down(code);
  await page.waitForTimeout(ms);
  await page.keyboard.up(code);
  await frames(page, 4);
}

/** Wait until the director is on `want`, or fail loudly with why. */
async function expectStep(page, want, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await stepId(page) === want) return;
    await frames(page, 4);
  }
  const f = await facts(page);
  const card = await page.evaluate(() => window.__tp.card());
  throw new Error(
    `${label}: expected step "${want}", stuck on "${await stepId(page)}"\n` +
    `  facts: ${JSON.stringify(f)}\n  card: ${JSON.stringify(card)}`,
  );
}

const log = (...a) => console.log(...a);

/* -------------------------------------------------------------------------- */
/* the run                                                                     */
/* -------------------------------------------------------------------------- */

async function playthrough(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') { errors.push(m.text().slice(0, 240)); log(`  [page error] ${m.text().slice(0, 220)}`); }
    else if (m.text().startsWith('[tutorial]')) log(`  [page] ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 240)));
  await page.addInitScript(HELPERS);

  /* -- 1. a clean profile, then the real title screen -------------------- */
  await page.goto(BASE + '?blank=1', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('voltmarch.setup.v1', JSON.stringify({
      playerFaction: 'allies', aiFaction: 'soviets', map: 'temperate',
      difficulty: 2, personality: -1, startingCredits: 5000, speed: 1, seed: 0,
    }));
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('.vm-menu-nav') !== null, null, { timeout: 180_000 });

  /* -- 2. the entry point a first-time player has to find ---------------- */
  const menu = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.vm-menu-nav .vm-btn')].map((b, i) => ({
      i, label: b.querySelector('.vm-btn-label')?.textContent ?? b.textContent ?? '',
      hint: b.querySelector('.vm-btn-hint')?.textContent ?? '',
      primary: b.classList.contains('is-primary'),
      disabled: b.hasAttribute('disabled'),
    }));
    return rows;
  });
  log('title screen:');
  for (const r of menu) log(`  ${r.i}. ${r.label.trim().padEnd(12)} ${r.hint.trim().padEnd(14)} ${r.primary ? '(accented)' : ''}`);
  const tut = menu.find((r) => /tutorial/i.test(r.label));
  if (tut === undefined) throw new Error('no Tutorial entry on the title screen');
  if (tut.i !== 0) throw new Error(`Tutorial is entry ${tut.i}, not the first`);
  if (!tut.primary) throw new Error('Tutorial is not accented for a first-time player');
  if (!/start here/i.test(tut.hint)) throw new Error(`Tutorial hint reads "${tut.hint}"`);

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.vm-menu-nav .vm-btn')]
      .find((n) => /tutorial/i.test(n.textContent ?? ''));
    b.click();
  });

  /* -- 3. the match, then freeze the sim --------------------------------- */
  // Wait for the WHOLE opening to have settled, not for the first global to
  // appear: `startTutorial` publishes the director BEFORE `startMatch` disposes
  // the title backdrop, so a wait on `__vmTutorial` alone lands in the window
  // where the backdrop's `__vmProduction` has been deleted and the match's has
  // not been published yet. The layer un-hides only in `beginObserving`, which
  // is the last thing `startTutorial` does.
  await page.waitForFunction(() => {
    const shell = window.__vmShell;
    const layer = document.querySelector('.vt-layer');
    return shell !== undefined && shell.getState() === 'playing'
      && globalThis.__vmProduction !== undefined
      && globalThis.__vmProduction.world.players.length > 1
      && layer !== null && layer.hidden === false
      && window.__tp.step() === 'camera.move';
  }, null, { timeout: 180_000 });
  await page.evaluate(() => window.__VM.pause());
  await frames(page, 4);

  const opening = await page.evaluate(() => ({
    units: window.__tp.mine('unit').map((i) => window.__tp.keyOf(i)),
    buildings: window.__tp.mine('building').map((i) => window.__tp.keyOf(i)),
    credits: Math.round(window.__tp.world().players[window.__tp.local()].credits),
    map: new URLSearchParams(location.search).get('map'),
    seed: new URLSearchParams(location.search).get('seed'),
    start: new URLSearchParams(location.search).get('start'),
    card: window.__tp.card(),
  }));
  log(`\nmatch: map=${opening.map} seed=${opening.seed} start=${opening.start} credits=${opening.credits}`);
  log(`  player owns: ${JSON.stringify(opening.units)} ${JSON.stringify(opening.buildings)}`);
  log(`  card: "${opening.card.title}"  keys: ${opening.card.keys.map((k) => `${k.name}[${k.caps.join(' ')}]`).join(' ')}`);

  const seen = ['camera.move'];
  const mark = async (label) => {
    const id = await stepId(page);
    if (seen[seen.length - 1] !== id) seen.push(id);
    const card = await page.evaluate(() => window.__tp.card());
    const spot = await page.evaluate(() => window.__tp.spot());
    log(`  -> ${label} :: now "${id}" — "${card?.title ?? ''}"${spot ? ` spotlight ${spot.w}x${spot.h} @${spot.x},${spot.y}` : ''}`);
  };

  /* ====================================================================== */
  /* STEP 1 — camera: pan and zoom with the bound keys and the wheel        */
  /* ====================================================================== */
  log('\n[1] camera.move');
  await hold(page, 'ArrowRight', 900);
  await hold(page, 'ArrowDown', 700);
  const mid = await page.evaluate(() => {
    const r = window.__tp.canvas().getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.4 };
  });
  await page.mouse.move(mid.x, mid.y);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -240); await frames(page, 6); }
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 240); await frames(page, 6); }
  await expectStep(page, 'camera.home', 'camera.move');
  await mark('panned with the arrow keys and zoomed with the wheel');

  /* ====================================================================== */
  /* STEP 2 — leave the base and come back with the bound home key          */
  /* ====================================================================== */
  log('[2] camera.home');
  await hold(page, 'ArrowRight', 2600);
  await hold(page, 'ArrowUp', 1400);
  await page.keyboard.press('KeyH');
  await frames(page, 30);
  await expectStep(page, 'select.one', 'camera.home');
  await mark('travelled away and pressed the bound Centre On Base key');

  /* ====================================================================== */
  /* STEP 3 — select one unit with a click                                  */
  /* ====================================================================== */
  log('[3] select.one');
  await page.keyboard.press('KeyH');
  await frames(page, 30);
  // Clear first, with a click on bare ground.
  //
  // NOT harness convenience: the scenario hands the player their construction
  // vehicle ALREADY SELECTED, and `Selection.select` returns early without
  // emitting when a Replace-click lands on the one entity already selected
  // (src/input/Selection.ts:349). So a player who clicks the pre-selected MCV
  // — the most obvious thing to click — produces no event and the step does not
  // tick. Clicking bare ground first is what a real player ends up doing, and
  // it is also the shape of the request in the report.
  const bare = await page.evaluate(() => {
    const h = window.__tp.home();
    const st = window.__tp.world().store;
    const i = window.__tp.mine('unit')[0];
    return window.__tp.ground(h.x, st.posY[i], h.z, 26, 60);
  });
  if (bare !== null) { await page.mouse.click(bare.x, bare.y); await frames(page, 3); }
  const one = await page.evaluate(() => {
    const i = window.__tp.mine('unit')[0];
    const p = window.__tp.pointOf(i);
    return window.__tp.free(p) ? { x: p.x, y: p.y, key: window.__tp.keyOf(i) } : null;
  });
  if (one === null) throw new Error('no own unit visible on screen to click');
  await page.mouse.click(one.x, one.y);
  await frames(page, 4);
  const selCount = await page.evaluate(() => window.__tp.world().selection.count);
  log(`      clicked ${one.key} at ${Math.round(one.x)},${Math.round(one.y)} — selection=${selCount}`);
  await expectStep(page, 'select.group', 'select.one');
  await mark('clicked a unit');

  /* ====================================================================== */
  /* STEP 4 — marquee the whole group                                       */
  /* ====================================================================== */
  log('[4] select.group');
  const box = await page.evaluate(() => window.__tp.unitsBox());
  if (box === null) throw new Error('fewer than two units visible to box-select');
  await page.mouse.move(box.minX, box.minY);
  await page.mouse.down();
  await page.mouse.move((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, { steps: 6 });
  await page.mouse.move(box.maxX, box.maxY, { steps: 6 });
  await page.mouse.up();
  await frames(page, 4);
  const groupCount = await page.evaluate(() => window.__tp.world().selection.count);
  log(`      marquee over ${box.n} units — selection=${groupCount}`);
  await expectStep(page, 'order.move', 'select.group');
  await mark('dragged a marquee');

  /* ====================================================================== */
  /* STEP 5 — a move order with the contextual right-click                  */
  /* ====================================================================== */
  log('[5] order.move');
  const dest = await page.evaluate(() => {
    const h = window.__tp.home();
    const st = window.__tp.world().store;
    const i = window.__tp.mine('unit')[0];
    return window.__tp.ground(h.x, st.posY[i], h.z, 18, 46);
  });
  if (dest === null) throw new Error('no clickable ground for a move order');
  await page.mouse.click(dest.x, dest.y, { button: 'right' });
  await sim(page, 1.5);
  await expectStep(page, 'order.attackMove', 'order.move');
  await mark(`right-clicked ground at ${Math.round(dest.wx)},${Math.round(dest.wz)}`);

  /* ====================================================================== */
  /* STEP 6 — attack move, on whatever key it is bound to                   */
  /* ====================================================================== */
  log('[6] order.attackMove');
  const amKey = await page.evaluate(() => {
    const s = window.__vmSettings.get().controls.bindings['ord.attackMove'];
    return s === undefined ? 'KeyA' : s.code;
  });
  await page.keyboard.press(amKey);
  await frames(page, 3);
  const amDest = await page.evaluate(() => {
    const h = window.__tp.home();
    const st = window.__tp.world().store;
    const i = window.__tp.mine('unit')[0];
    return window.__tp.ground(h.x, st.posY[i], h.z, 22, 50);
  });
  if (amDest === null) throw new Error('no clickable ground for an attack-move');
  await page.mouse.click(amDest.x, amDest.y);
  await sim(page, 1.5);
  await expectStep(page, 'build.deploy', 'order.attackMove');
  await mark(`armed ${amKey} and clicked a destination`);

  /* ====================================================================== */
  /* STEP 7 — deploy the MCV with the bound deploy key                      */
  /* ====================================================================== */
  log('[7] build.deploy');
  const dKey = await page.evaluate(() => {
    const s = window.__vmSettings.get().controls.bindings['ord.deploy'];
    return s === undefined ? 'KeyD' : s.code;
  });
  // Take everything with a marquee and press the bound deploy key: the input
  // module distils the construction vehicles out of the selection itself, and
  // scenario-spawned units carry no production catalog index, so "the unit
  // whose key is mcv" is not a question this harness can ask from outside.
  let deployed = false;
  for (let attempt = 0; attempt < 3 && !deployed; attempt++) {
    await page.keyboard.press('KeyH');
    await frames(page, 24);
    const all = await page.evaluate(() => window.__tp.unitsBox());
    if (all === null) throw new Error('no units visible to select for the deploy lesson');
    await page.mouse.move(all.minX, all.minY);
    await page.mouse.down();
    await page.mouse.move(all.maxX, all.maxY, { steps: 8 });
    await page.mouse.up();
    await frames(page, 4);
    await page.keyboard.press(dKey);
    await sim(page, 10);
    deployed = await stepId(page) === 'build.power';
    if (!deployed) {
      // "Cannot deploy here" — nudge the column onto open ground and retry,
      // which is exactly the recovery the step's own prose describes.
      const spot = await page.evaluate(() => {
        const h = window.__tp.home();
        const st = window.__tp.world().store;
        const i = window.__tp.mine('unit')[0];
        return window.__tp.ground(h.x, st.posY[i], h.z, 20, 44);
      });
      if (spot !== null) { await page.mouse.click(spot.x, spot.y, { button: 'right' }); await sim(page, 8); }
    }
  }
  await expectStep(page, 'build.power', 'build.deploy');
  await mark(`selected the column and pressed ${dKey}`);

  /* ====================================================================== */
  /* STEPS 8, 9, 11 — the build chain, through the real sidebar             */
  /* ====================================================================== */
  const build = async (label, tab, rx, nextStep) => {
    log(`[${label}`);
    const t = await page.evaluate((i) => window.__tp.tabRect(i), tab);
    if (t !== null) { await page.mouse.click(t.x, t.y); await frames(page, 3); }

    const slot = await page.evaluate(([tb, r]) => {
      const i = window.__tp.slotFor(tb, r);
      if (i < 0) return { error: `no cameo matching ${r} on tab ${tb}: ` + JSON.stringify(window.__tp.cameos(tb).map((c) => c.key)) };
      const rect = window.__tp.slotRect(i);
      const c = window.__tp.cameos(tb)[i];
      return rect === null ? { error: `slot ${i} has no box` } : { i, x: rect.x, y: rect.y, key: c.key, available: c.available, reason: c.reason };
    }, [tab, rx]);
    if (slot.error !== undefined) throw new Error(slot.error);
    if (!slot.available) throw new Error(`${slot.key} is not buildable: ${slot.reason}`);
    await page.mouse.click(slot.x, slot.y);
    log(`      clicked cameo ${slot.key} (slot ${slot.i})`);

    // Let the queue run. The sim is frozen, so stepping IS the wait.
    let ready = false;
    for (let n = 0; n < 40 && !ready; n++) {
      await sim(page, 2);
      ready = await page.evaluate(() => window.__tp.pending());
    }
    if (!ready) throw new Error(`${slot.key} never finished building`);

    // Place it: real ground clicks first, spiralling out from the yard.
    const anchor = await page.evaluate(() => {
      const st = window.__tp.world().store;
      const i = window.__tp.mine('building').find((k) => {
        const e = window.__tp.prod().entryOf(st.handleOf(k));
        return e !== null && e.buildRadius > 0;
      });
      return i === undefined ? null : { x: st.posX[i], y: st.posY[i], z: st.posZ[i] };
    });
    if (anchor === null) throw new Error('no construction yard to build from');

    let how = 'click';
    let placed = false;
    for (let r = 10; r <= 34 && !placed; r += 4) {
      const spots = await page.evaluate(([a, rad]) => {
        const out = [];
        for (let k = 0; k < 12; k++) {
          const ang = (k / 12) * Math.PI * 2;
          const wx = a.x + Math.cos(ang) * rad;
          const wz = a.z + Math.sin(ang) * rad;
          const p = window.__tp.screen(wx, a.y, wz);
          if (window.__tp.free(p)) out.push({ x: p.x, y: p.y, wx, wz });
        }
        return out;
      }, [anchor, r]);
      for (const s of spots) {
        await page.mouse.move(s.x, s.y);
        await frames(page, 3);
        await page.mouse.click(s.x, s.y);
        await sim(page, 0.5);
        if (!(await page.evaluate(() => window.__tp.pending()))) { placed = true; break; }
      }
    }
    if (!placed) {
      how = 'api';
      const done = await page.evaluate(() => {
        const prod = window.__tp.prod(); const p = window.__tp.local();
        const st = window.__tp.world().store;
        const yard = window.__tp.mine('building').find((k) => {
          const e = prod.entryOf(st.handleOf(k));
          return e !== null && e.buildRadius > 0;
        });
        const cx = st.cellX[yard]; const cz = st.cellZ[yard];
        const id = prod.pendingStructure(p);
        for (let r = 3; r < 16; r++) {
          for (let a = 0; a < 24; a++) {
            const ang = (a / 24) * Math.PI * 2;
            prod.placeBuilding(p, id, Math.round(cx + Math.cos(ang) * r), Math.round(cz + Math.sin(ang) * r));
            if (prod.pendingStructure(p) === null) return true;
          }
        }
        return false;
      });
      if (!done) throw new Error(`${slot.key}: every cell refused the footprint`);
      await sim(page, 1);
    }

    for (let n = 0; n < 30; n++) {
      if (await stepId(page) === nextStep) break;
      await sim(page, 2);
    }
    await expectStep(page, nextStep, label);
    await mark(`placed ${slot.key} by ${how}`);
    return slot.key;
  };

  await build('8] build.power', 0, 'power|solar|furnace', 'build.refinery');
  await build('9] build.refinery', 0, 'refinery|cistern|sorter', 'economy.harvest');

  /* ====================================================================== */
  /* STEP 10 — a full harvest cycle, watched rather than driven             */
  /* ====================================================================== */
  log('[10] economy.harvest');
  let banked = false;
  for (let n = 0; n < 40 && !banked; n++) {
    await sim(page, 5);
    banked = await stepId(page) === 'build.factory';
  }
  const f10 = await facts(page);
  log(`      harvest deposits observed: ${f10.harvestDeposits}`);
  await expectStep(page, 'build.factory', 'economy.harvest');
  await mark('a harvester load landed');

  await build('11] build.factory', 0, 'barracks|chapterhouse|rookery|warFactory|forgeyard|breakerYard', 'build.produce');

  /* ====================================================================== */
  /* STEP 12 — produce a unit from the tab the new factory feeds            */
  /* ====================================================================== */
  log('[12] build.produce');
  const queued = await page.evaluate(async () => {
    for (const tab of [2, 3]) {
      const list = window.__tp.cameos(tab);
      for (let i = 0; i < list.length; i++) {
        if (!list[i].available) continue;
        return { tab, i, key: list[i].key };
      }
    }
    return null;
  });
  if (queued === null) throw new Error('no unit is buildable after the factory finished');
  const qTab = await page.evaluate((t) => window.__tp.tabRect(t), queued.tab);
  await page.mouse.click(qTab.x, qTab.y);
  await frames(page, 3);
  const qSlot = await page.evaluate((i) => window.__tp.slotRect(i), queued.i);
  await page.mouse.click(qSlot.x, qSlot.y);
  log(`      clicked cameo ${queued.key} on tab ${queued.tab}`);
  for (let n = 0; n < 30; n++) {
    if (await stepId(page) === 'build.rally') break;
    await sim(page, 2);
  }
  await expectStep(page, 'build.rally', 'build.produce');
  await mark(`produced ${queued.key}`);

  /* ====================================================================== */
  /* STEP 13 — move a factory's rally flag                                  */
  /* ====================================================================== */
  log('[13] build.rally');
  const fac = await page.evaluate(() => {
    const st = window.__tp.world().store;
    const i = window.__tp.mine('building').find((k) => {
      const e = window.__tp.prod().entryOf(st.handleOf(k));
      return e !== null && e.producesTabs.some((t) => t === 2 || t === 3);
    });
    if (i === undefined) return null;
    const p = window.__tp.pointOf(i);
    return window.__tp.free(p)
      ? { x: p.x, y: p.y, key: window.__tp.keyOf(i), wx: st.posX[i], wy: st.posY[i], wz: st.posZ[i] }
      : { offscreen: true };
  });
  if (fac === null || fac.offscreen === true) {
    // Bring it on screen the way a player would, then look again.
    await page.keyboard.press('KeyH');
    await frames(page, 30);
  }
  const fac2 = await page.evaluate(() => {
    const st = window.__tp.world().store;
    const i = window.__tp.mine('building').find((k) => {
      const e = window.__tp.prod().entryOf(st.handleOf(k));
      return e !== null && e.producesTabs.some((t) => t === 2 || t === 3);
    });
    if (i === undefined) return null;
    const p = window.__tp.pointOf(i);
    return window.__tp.free(p)
      ? { x: p.x, y: p.y, key: window.__tp.keyOf(i), wx: st.posX[i], wy: st.posY[i], wz: st.posZ[i] }
      : null;
  });
  if (fac2 === null) throw new Error('the unit factory is not clickable on screen');
  await page.mouse.click(fac2.x, fac2.y);
  await frames(page, 4);
  const rallyKey = await page.evaluate(() => {
    const s = window.__vmSettings.get().controls.bindings['ord.rally'];
    return s === undefined ? 'KeyY' : s.code;
  });
  await page.keyboard.press(rallyKey);
  await frames(page, 3);
  const flag = await page.evaluate((a) => window.__tp.ground(a.wx, a.wy, a.wz, 14, 40), fac2);
  if (flag === null) throw new Error('no clickable ground for a rally flag');
  await page.mouse.click(flag.x, flag.y);
  await sim(page, 1.5);
  await expectStep(page, 'match.victory', 'build.rally');
  await mark(`selected ${fac2.key}, armed ${rallyKey} and moved the flag`);

  /* ====================================================================== */
  /* STEP 14 — the one completion the player asserts                        */
  /* ====================================================================== */
  log('[14] match.victory');
  const finish = await page.evaluate(() => window.__tp.cardButton('Finish'));
  if (finish === null) throw new Error('the last step does not offer a Finish button');
  await page.mouse.click(finish.x, finish.y);
  await page.waitForFunction(() => document.querySelector('.vm-menu-nav') !== null, null, { timeout: 60_000 });

  /* -- the record, and the menu that reads it ---------------------------- */
  const after = await page.evaluate(() => ({
    stored: localStorage.getItem('vm.tutorial.v1'),
    menu: [...document.querySelectorAll('.vm-menu-nav .vm-btn')].map((b) => ({
      label: (b.querySelector('.vm-btn-label')?.textContent ?? '').trim(),
      hint: (b.querySelector('.vm-btn-hint')?.textContent ?? '').trim(),
      primary: b.classList.contains('is-primary'),
    })),
    cardGone: document.querySelector('.vt-card') === null,
  }));
  const record = JSON.parse(after.stored ?? 'null');
  log(`\nstored progress: ${after.stored}`);
  log(`title screen after: ${after.menu.map((m) => `${m.label}[${m.hint}]${m.primary ? '*' : ''}`).join('  ')}`);
  if (record === null || record.done !== true) throw new Error('the run did not record itself as done');
  if (record.completed.length !== 14) throw new Error(`recorded ${record.completed.length} completed steps, wanted 14`);
  if (!after.cardGone) throw new Error('the coach card survived the end of the run');
  const tutRow = after.menu.find((m) => /tutorial/i.test(m.label));
  if (tutRow?.hint !== 'Complete') throw new Error(`menu hint after the run reads "${tutRow?.hint}"`);
  const skirmish = after.menu.find((m) => /skirmish/i.test(m.label));
  if (skirmish?.primary !== true) throw new Error('the accent did not move to Skirmish');

  log(`\nsteps visited in order: ${seen.join(' -> ')}`);

  /* ====================================================================== */
  /* PHASE 2 — resume, and the way out                                      */
  /*                                                                        */
  /* The stored record now says every step is done, so a replay must skip   */
  /* the input drill and pick up at the first lesson that needs a world —   */
  /* `resumeIndex` in tutorial-steps.ts. And the End button must return the */
  /* player to the title screen from anywhere, with the director gone.      */
  /* ====================================================================== */
  log('\n[resume] opening the tutorial again on a completed record');
  await page.evaluate(() => {
    [...document.querySelectorAll('.vm-menu-nav .vm-btn')]
      .find((n) => /tutorial/i.test(n.textContent ?? '')).click();
  });
  await page.waitForFunction(() => {
    const l = document.querySelector('.vt-layer');
    return window.__vmShell?.getState() === 'playing' && globalThis.__vmProduction !== undefined
      && l !== null && l.hidden === false;
  }, null, { timeout: 180_000 });
  await page.evaluate(() => window.__VM.pause());
  await frames(page, 4);
  const resumed = await page.evaluate(() => ({ step: window.__tp.step(), card: window.__tp.card() }));
  log(`  resumed at "${resumed.step}" — "${resumed.card.title}" (${resumed.card.eyebrow})`);
  if (resumed.step !== 'build.deploy') {
    throw new Error(`a completed record resumed at "${resumed.step}", wanted "build.deploy"`);
  }

  log('[resume] ending it early with the card\'s own End button');
  const end = await page.evaluate(() => window.__tp.cardButton('End'));
  if (end === null) throw new Error('the card offers no way out');
  await page.mouse.click(end.x, end.y);
  await page.waitForFunction(() => document.querySelector('.vm-menu-nav') !== null, null, { timeout: 60_000 });
  const clean = await page.evaluate(() => ({
    director: globalThis.__vmTutorial === undefined,
    card: document.querySelector('.vt-card') === null,
    state: window.__vmShell.getState(),
  }));
  log(`  back at "${clean.state}" — director released: ${clean.director}, card removed: ${clean.card}`);
  if (!clean.director) throw new Error('the director outlived the run on globalThis');
  if (!clean.card) throw new Error('the coach card outlived the run in the DOM');

  if (errors.length > 0) log(`console errors (${errors.length}): ${JSON.stringify(errors.slice(0, 6), null, 1)}`);
  await page.close();
  return { seen, record, errors };
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

let code = 0;
try {
  const out = await playthrough(browser);
  log(`\nPLAYTHROUGH OK — ${out.record.completed.length}/14 steps, ${out.errors.length} console errors`);
} catch (err) {
  console.error('\nPLAYTHROUGH FAILED:', err instanceof Error ? err.message : err);
  code = 1;
} finally {
  await browser.close();
  cleanup();
}
process.exit(code);

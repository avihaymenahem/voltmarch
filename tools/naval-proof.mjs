/**
 * ============================================================================
 * tools/naval-proof.mjs — DOES A HULL THE YARD BUILT COME OUT AS A SHIP?
 * ============================================================================
 * `npm test` can prove that `Production.spawnUnit` calls `setMoveClass` and
 * that `findEgressSpot` returns a wet cell. It cannot prove the thing those two
 * lines exist for, which is that a warship LOOKS like a warship: riding on the
 * water plane rather than on sand, heeling out of its turns, bobbing, and
 * dragging a wake. This repo has shipped features that passed their tests and
 * rendered nothing, and the whole character of this defect was that every test
 * and every number said the navy was fine.
 *
 * So this drives the real game, through the real production queue, and reports
 * BOTH the frame and the numbers behind it.
 *
 *   node tools/naval-proof.mjs               build, capture, write shots/naval-proof-*
 *   node tools/naval-proof.mjs --no-build    reuse dist/
 *   node tools/naval-proof.mjs --tag before  name the output arm
 *
 * WHAT IT DOES, and every step of it is a thing a player does:
 *
 *   1. Boots `?shot=naval`, the fixture that already has an Allied Naval Yard
 *      standing on a real shoreline with 5600 credits behind it.
 *   2. Calls `__vmProduction.enqueue(...)` for a Assault Destroyer. That is the
 *      ordinary production path — pay, build, egress — not a spawn.
 *   3. Advances the SIMULATION in whole ticks (`__VM.advanceTicks`), which is
 *      the only deterministic way to move a capture, and watches the hull.
 *   4. Records, per tick: world position, the cell under it, whether that cell
 *      is water, ride height against WATER_LEVEL, hull roll and pitch.
 *   5. Photographs the yard and its new ship.
 *
 * WHAT THE TWO ARMS LOOK LIKE, measured:
 *
 *   before  the hull egresses at the factory door, ON LAND. `moveClassAt`
 *           latches Hover off that cell for the life of the slot: ride height
 *           is terrain height, roll and pitch come from the ground normal, and
 *           `MOVE_NAVAL_HEEL` / `MOVE_NAVAL_BOB` / `addWake` never run.
 *   after   the hull egresses onto water, is declared Naval at spawn, rides at
 *           WATER_LEVEL exactly, and its roll trace is the bob.
 *
 * Run it once per arm and diff the JSON. The `rideDelta` and `rollRange` rows
 * are the ones that carry the argument.
 * ============================================================================
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build, serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'shots');
/**
 * A HINT. This read "deliberately NOT tools/shoot.mjs's 4317: the two must be
 * runnable at once", which was true of shoot.mjs and false of everything else —
 * `flash-stack`, `boot-profile`, `desync-probe` and `sobel` all sat on 4319 as
 * well, so the tool this one was most likely to collide with was itself.
 * `serve()` walks off a busy port and proves the origin it lands on.
 */
const PORT_HINT = 4319;
const VIEWPORT = { width: 1920, height: 1080 };

/** `?shot=naval` anchors on the map centre; `buildNaval` puts the yard here. */
const YARD = { x: 256 + 14, z: 256 + 8 };
/** Close enough that a 9 m hull is a subject rather than a speck. */
const DISTANCE = 44;
/** Must match `WATER_LEVEL` in src/core/config.ts. Asserted against the page. */
const WATER_LEVEL = 2.0;
/** Sim ticks to run after the order. 14 s build time at 30 Hz, plus the sail. */
const TICKS = 30 * 26;

const argv = process.argv.slice(2);
const noBuild = argv.includes('--no-build');
const tagIx = argv.indexOf('--tag');
const TAG = tagIx >= 0 ? argv[tagIx + 1] : 'after';

mkdirSync(OUT, { recursive: true });

if (!noBuild) {
  await build(ROOT, { log: console.log });
} else if (!existsSync(join(ROOT, 'apps/game/dist', 'index.html'))) {
  console.error('--no-build was given but dist/index.html does not exist.');
  process.exit(5);
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

const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
page.setDefaultTimeout(180_000);
page.setDefaultNavigationTimeout(180_000);
const problems = [];
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

let report = null;
try {
  server.assertAlive('the naval capture');
  await page.goto(`${BASE}?shot=naval&seed=13&tier=medium&fog=off`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 60_000 });
  await page.evaluate(() => window.__VM.ready());
  await page.waitForFunction(() => {
    const curtain = document.getElementById('loading');
    if (curtain !== null && curtain.hidden !== true) return false;
    const stats = window.__VM?.stats?.();
    return stats !== undefined && stats.drawCalls > 8;
  }, null, { timeout: 240_000 });
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none!important;animation:none!important;}',
  });

  await page.evaluate(([w, h, x, z, d]) => {
    window.__VM.setSize(w, h);
    window.__VM.setUiVisible(false);
    window.__VM.focusOn(x, z, d);
    window.__VM.setCameraPitchDeg(window.__VM.canonicalPitchDeg(d));
  }, [VIEWPORT.width, VIEWPORT.height, YARD.x, YARD.z, DISTANCE]);

  /*
   * ORDER ONE, THEN WATCH IT.
   *
   * `__vmProduction` is the live `ProductionService` (src/sim/production.system.ts
   * publishes it for exactly this kind of driving). `enqueue` is the same entry
   * point a sidebar click reaches, so the hull that comes out came out the way
   * a player's does — through `tryEgress` and `findEgressSpot`.
   */
  report = await page.evaluate(async ({ ticks, waterLevel }) => {
    const svc = window.__vmProduction;
    if (svc === undefined) throw new Error('__vmProduction is absent — is this a ?shot= boot?');
    const world = svc.world;
    const store = world.store;

    // The Allied slot: the one that owns the yard in `buildNaval`.
    let owner = -1;
    for (let a = 0; a < store.aliveCount; a++) {
      const i = store.alive[a];
      // EntityKind.Building. A literal because this file is plain JS and
      // `core/types.ts` is a `const enum` that never reaches the bundle.
      if (store.kind[i] !== 3) continue;
      const e = svc.catalog.resolve(store.defId[i], true);
      if (e !== null && e.key === 'navalYard') { owner = store.owner[i]; break; }
    }
    if (owner < 0) throw new Error('no naval yard in the scene');

    const entry = svc.catalog.byKey('gunboat');
    const avail = svc.availability(owner, entry.publicId);
    if (!avail.ok) throw new Error(`cannot build a gunboat here: ${avail.reason}`);

    const before = new Set();
    for (let a = 0; a < store.aliveCount; a++) {
      const i = store.alive[a];
      if (store.defId[i] === entry.defId) before.add(store.handleOf(i));
    }

    svc.enqueue(owner, entry.publicId);

    const trace = [];
    let hull = -1;
    for (let t = 0; t < ticks; t++) {
      window.__VM.advanceTicks(1);
      if (hull < 0) {
        for (let a = 0; a < store.aliveCount; a++) {
          const i = store.alive[a];
          if (store.defId[i] !== entry.defId) continue;
          const id = store.handleOf(i);
          if (before.has(id)) continue;
          hull = id;
          break;
        }
        if (hull < 0) continue;
      }
      const i = store.index(hull);
      if (i < 0) break;
      const x = store.posX[i];
      const z = store.posZ[i];
      const cx = Math.floor(x / 4);
      const cz = Math.floor(z / 4);
      trace.push({
        tick: t,
        x: +x.toFixed(3),
        z: +z.toFixed(3),
        y: +store.posY[i].toFixed(4),
        onWater: world.terrain.isWater(cx, cz),
        ground: +world.terrain.heightAt(x, z).toFixed(4),
        roll: +store.hullRoll[i].toFixed(5),
        pitch: +store.hullPitch[i].toFixed(5),
        yaw: +store.yaw[i].toFixed(4),
        speed: +store.speed[i].toFixed(3),
      });
    }
    if (hull < 0) throw new Error('the yard never produced a hull');

    const first = trace[0];
    const rolls = trace.map((r) => r.roll);
    const pitches = trace.map((r) => r.pitch);
    const rideDeltas = trace.map((r) => +(r.y - waterLevel).toFixed(4));
    return {
      egress: {
        x: first.x, z: first.z, y: first.y,
        onWater: first.onWater,
        groundHere: first.ground,
      },
      ticksObserved: trace.length,
      wetTicks: trace.filter((r) => r.onWater).length,
      /** How far the hull's ride height sits from the water plane. 0 = afloat. */
      rideDeltaMax: Math.max(...rideDeltas.map(Math.abs)),
      rollRange: +(Math.max(...rolls) - Math.min(...rolls)).toFixed(5),
      pitchRange: +(Math.max(...pitches) - Math.min(...pitches)).toFixed(5),
      trace: trace.filter((_, k) => k % 15 === 0),
    };
  }, { ticks: TICKS, waterLevel: WATER_LEVEL });

  await page.evaluate(() => window.__VM.waitFrames(6));
  const shot = join(OUT, `naval-proof-${TAG}.png`);
  await page.screenshot({ path: shot, animations: 'disabled' });
  writeFileSync(join(OUT, `naval-proof-${TAG}.json`), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\n  arm            ${TAG}`);
  console.log(`  egress cell    ${report.egress.x.toFixed(1)}, ${report.egress.z.toFixed(1)}`);
  console.log(`  ON WATER       ${report.egress.onWater}`);
  console.log(`  ground there   ${report.egress.groundHere.toFixed(2)} m (water plane ${WATER_LEVEL})`);
  console.log(`  wet ticks      ${report.wetTicks}/${report.ticksObserved}`);
  console.log(`  ride delta max ${report.rideDeltaMax.toFixed(4)} m off the water plane`);
  console.log(`  roll range     ${report.rollRange.toFixed(4)} rad`);
  console.log(`  pitch range    ${report.pitchRange.toFixed(4)} rad`);
  console.log(`\n  -> ${shot}`);
} finally {
  await browser.close();
  cleanup();
}

if (problems.length) {
  console.warn(`\npage problems:\n  ${problems.join('\n  ')}`);
}

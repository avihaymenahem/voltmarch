/**
 * ============================================================================
 * tools/replay-probe.mjs — does a replay actually replay?
 * ============================================================================
 *   node tools/replay-probe.mjs              # build, then probe
 *   node tools/replay-probe.mjs --no-build   # probe the existing dist/
 *   node tools/replay-probe.mjs --headed     # watch it happen
 *
 * `npm test` proves the recorder, the file format and the playback plumbing
 * against a stand-in simulation. It cannot prove the only thing that matters —
 * that THIS engine, booted from a recorded header, produces the world that was
 * recorded. That needs the real terrain generator, the real scenario builder,
 * the real AI and the real 30 Hz loop, which means a browser.
 *
 * So this boots the built game twice: once to play a skirmish and record it,
 * once to watch that recording, and compares the simulation checksum at a list
 * of ABSOLUTE sim ticks.
 *
 * ── WHY ABSOLUTE TICKS, AND NOT "N TICKS AFTER I PRESSED GO" ───────────────
 *
 * Both runs are paused and stepped with `__VM.advanceTicks`, but the tick they
 * are paused AT is whatever the boot happened to reach on a real clock —
 * measured between 41 and 46 on this machine. Sampling "150 ticks later" then
 * compares tick 192 against tick 191, which differ for a completely
 * uninteresting reason and look exactly like a desync. The first version of
 * this probe reported a divergence that was entirely its own.
 *
 * ── THE NEGATIVE CONTROL IS NOT OPTIONAL ───────────────────────────────────
 *
 * A matching hash proves the two runs agree. It does NOT prove the RECORDING
 * is what made them agree — the AI is deterministic from the same seed, so a
 * playback that fed the world nothing at all would also match, and would also
 * be a completely broken feature. That is not hypothetical: it is exactly what
 * this repository shipped for one build, because the outgoing match's
 * `dispose()` cleared the file the incoming one had just been armed with.
 *
 * So phase B deletes ONE command from the recording and replays it. If the
 * result still matches, the recording is decoration and the run FAILS.
 * ============================================================================
 */

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A HINT, and the reason it can only ever be one.
 *
 * This was `const PORT = 4321` plus a `waitForServer` that asked whether
 * ANYTHING answered there. Nothing checked whose build it was, so a leaked
 * preview — or a neighbouring worktree's, since a TCP port is machine-wide and
 * every checkout of this repo runs this same tool — would have been recorded
 * from and replayed against without a word.
 *
 * That is fatal here specifically. Phase A asserts that two runs produce the
 * same checksums and phase C asserts that a CORRUPTED recording does not. Both
 * are claims about ONE ENGINE agreeing with itself; both are satisfied just as
 * happily by a stranger's engine agreeing with itself, and the run then prints
 * REPLAY PROBE PASSED about a build nobody looked at. The negative control does
 * not help — it is equally deterministic on somebody else's bundle.
 *
 * `serve()` reads the port back off our own child and byte-compares the served
 * `index.html` against this checkout's `dist/`, so 4321 is where we ASK to
 * listen and the origin below is where we were actually heard.
 */
const PORT_HINT = 4321;

const args = process.argv.slice(2);
const HEADED = args.includes('--headed');
const BUILD = !args.includes('--no-build');

/**
 * The sim ticks the two runs are compared at. 1800 is a full minute at 30 Hz,
 * which on the default lobby is long enough for the opening build order, the
 * first harvester runs and the AI's first production decisions — i.e. long
 * enough that a stale RNG stream or a missing command cannot hide.
 */
const MARKS = [200, 400, 600, 800, 1000, 1400, 1800];
const SEED = 987654321;

/* -------------------------------------------------------------------------- */

if (BUILD) {
  const built = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT, shell: process.platform === 'win32', stdio: 'inherit',
  });
  if (built.status !== 0) throw new Error('npm run build failed');
}

const server = await serve({
  root: ROOT, mode: 'preview', portHint: PORT_HINT, log: console.log,
});
const BASE = server.origin;
const cleanup = () => server.stop();

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

const hex = (n) => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

/** Pause, step to each absolute tick, and fingerprint there. */
const walk = (marks) => page.evaluate((ms) => {
  window.__vmShell.getGame().setPaused(true);
  const out = [];
  for (const target of ms) {
    const at = window.__vmReplay.stats().tick;
    if (target > at) window.__VM.advanceTicks(target - at);
    const s = window.__vmReplay.stats();
    out.push({ tick: s.tick, hash: s.hash >>> 0, commands: s.commands, checks: s.checks });
  }
  return out;
}, marks);

const untilPlaying = () => page.waitForFunction(
  () => window.__vmShell?.getState?.() === 'playing', null, { timeout: 120_000 },
);

/* -- phase A: record ------------------------------------------------------- */

console.log(`\n=== RECORD  ?skipmenu=1&seed=${SEED} ===`);
// The only navigation in the run — phases B and C re-arm the shell in the page
// that this one loads — so one liveness check covers all three.
server.assertAlive('the recording phase');
await page.goto(`${BASE}?skipmenu=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 120_000 });
await page.evaluate(() => window.__VM.ready());
await untilPlaying();
await page.evaluate(() => window.__VM.waitFrames(6));

const recMarks = await walk(MARKS);
const rec = await page.evaluate(() => {
  const json = window.__vmReplay.save();
  window.sessionStorage.setItem('vmReplayProbe', json);
  const p = JSON.parse(json);
  return { header: p.header, commands: p.commands.length, checks: p.checks.length, bytes: json.length };
});

console.log(`  seed ${rec.header.simSeed}  map ${rec.header.mapPreset}/${rec.header.biome}`
  + `  landform ${rec.header.mapSeed}  opening ${rec.header.start}`);
console.log(`  ${rec.commands} commands, ${rec.checks} checkpoints, ${rec.bytes} bytes`);
for (const m of recMarks) console.log(`    tick ${String(m.tick).padStart(5)}  ${hex(m.hash)}`);

/* -- phase B: replay ------------------------------------------------------- */

console.log('\n=== REPLAY ===');
await page.evaluate(async () => {
  await window.__vmShell.startReplay(JSON.parse(window.sessionStorage.getItem('vmReplayProbe')));
});
await untilPlaying();
await page.evaluate(() => window.__VM.waitFrames(6));

const playMarks = await walk(MARKS);
for (const m of playMarks) console.log(`    tick ${String(m.tick).padStart(5)}  ${hex(m.hash)}`);
// The strip repaints from the shell's 5 Hz rAF poll and `advanceTicks` ran the
// whole minute synchronously, so waiting for the repaint is the difference
// between reading the verdict and reading the boot.
await page.waitForFunction(
  () => (document.querySelector('.vm-replay-sync')?.textContent ?? '').startsWith('Complete'),
  null, { timeout: 15_000 },
).catch(() => { /* printed as-is below */ });
const bar = await page.evaluate(() => {
  const t = (s) => document.querySelector(s)?.textContent ?? '(absent)';
  return { sync: t('.vm-replay-sync'), clock: t('.vm-replay-clock') };
});
console.log(`  bar: "${bar.sync}"  ${bar.clock}`);

let ok = true;
for (let i = 0; i < recMarks.length; i++) {
  const a = recMarks[i];
  const b = playMarks[i];
  const same = b !== undefined && a.tick === b.tick && a.hash === b.hash;
  if (!same) {
    ok = false;
    console.log(`  DIFFER at tick ${a.tick}: recorded ${hex(a.hash)}, replay ${b ? hex(b.hash) : '(none)'}`);
  }
}
console.log(ok ? '  A: PASS — every sampled tick agrees.' : '  A: FAIL — the replay diverged.');

/* -- phase C: the negative control ----------------------------------------- */

console.log('\n=== NEGATIVE CONTROL: one command deleted ===');
const cut = await page.evaluate(async () => {
  const file = JSON.parse(window.sessionStorage.getItem('vmReplayProbe'));
  const i = Math.max(0, file.commands.findIndex((c) => c.tick > 200) - 1);
  const removed = file.commands.splice(i, 1)[0];
  await window.__vmShell.startReplay(file);
  return removed?.tick ?? null;
});
await untilPlaying();
await page.evaluate(() => window.__VM.waitFrames(6));
const cutMarks = await walk(MARKS);
// WAIT FOR THE REPAINT, do not sleep and hope. The strip is repainted from the
// shell's rAF poll at 5 Hz, and `advanceTicks` runs the whole simulation
// SYNCHRONOUSLY — so the moment `walk` returns, the bar is still showing
// whatever it last saw during the live boot. A fixed sleep reported the stale
// text often enough to fail a run that had actually detected the divergence.
await page.waitForFunction(
  () => (document.querySelector('.vm-replay-sync')?.textContent ?? '').startsWith('Diverged'),
  null, { timeout: 15_000 },
).catch(() => { /* reported below rather than thrown */ });
const cutBar = await page.evaluate(() => ({
  sync: document.querySelector('.vm-replay-sync')?.textContent ?? '(absent)',
  note: document.querySelector('.vm-replay-note')?.textContent ?? '',
}));

const last = cutMarks[cutMarks.length - 1];
const changed = last.hash !== recMarks[recMarks.length - 1].hash;
const reported = cutBar.sync.startsWith('Diverged');
console.log(`  removed the command at tick ${cut}`);
console.log(`  tick ${last.tick}: ${hex(last.hash)} vs recorded ${hex(recMarks[recMarks.length - 1].hash)}`);
console.log(`  bar: "${cutBar.sync}"`);
if (cutBar.note !== '') console.log(`  note: ${cutBar.note}`);
const controlOk = changed && reported;
console.log(controlOk
  ? '  B: PASS — the recording is what drives the match, and a broken one says so.'
  : '  B: FAIL — a corrupted recording played back clean. Phase A proves nothing.');

await browser.close();
cleanup();
console.log(`\n${ok && controlOk ? 'REPLAY PROBE PASSED' : 'REPLAY PROBE FAILED'}\n`);
process.exit(ok && controlOk ? 0 : 1);

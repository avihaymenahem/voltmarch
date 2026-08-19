/**
 * ============================================================================
 * tools/replay-probe.mjs — does a replay actually replay?
 * ============================================================================
 *   node tools/replay-probe.mjs                # build, then probe
 *   node tools/replay-probe.mjs --no-build     # probe the existing dist/
 *   node tools/replay-probe.mjs --no-campaign  # skirmish arm only (see below)
 *   node tools/replay-probe.mjs --headed       # watch it happen
 *
 * `npm test` proves the recorder, the file format and the playback plumbing
 * against a stand-in simulation. It cannot prove the only thing that matters —
 * that THIS engine, booted from a recorded header, produces the world that was
 * recorded. That needs the real terrain generator, the real scenario builder,
 * the real AI and the real 30 Hz loop, which means a browser.
 *
 * So this boots the built game and plays each match twice: once to record it,
 * once to watch that recording, comparing the simulation checksum at a list of
 * ABSOLUTE sim ticks. It does that for a SKIRMISH (phases A–C) and then for a
 * CAMPAIGN OPERATION (phases D–F), which are different proofs — see below.
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
 * So phases C and F delete ONE command from the recording and replay it. If the
 * result still matches, the recording is decoration and the run FAILS.
 *
 * ── WHY THE CAMPAIGN ARM IS A DIFFERENT PROOF, AND WHY IT IS SLOW ──────────
 *
 * A CAMPAIGN OPERATION'S EFFECTS ARE NOT IN THE COMMAND STREAM. The Director
 * spawns reinforcements, pays a secondary's bounty and reveals ground inside
 * `simTick` through `EffectSink` — never through `channels.commands`, because a
 * wire-legal spawn command would travel to the relay, whose contract is "stamps
 * identity; the simulation enforces authority", and the simulation has no
 * authority test that would refuse a PvP client conjuring an army. So the file
 * carries the operation's NAME (`ReplayHeader.campaign`) and the DIRECTOR
 * RE-RUNS under playback — the same trade the format already makes for the
 * heightfield, which is absent while `mapSeed` is present.
 *
 * Nothing in `npm test` can check that, and neither can phases A–C: a skirmish
 * has no Director. What checks it is a mark taken PAST the first authored
 * effect that writes the world. On `soviets.01.first-tap` that is the relief
 * column at `minutes(5)` — SIM TICK 9000 — so `CAMPAIGN_MARKS` brackets it at
 * 8940 and 9120, and the `alive` column printed beside each hash is where four
 * Wardens visibly arrive. **A campaign arm that stopped at tick 1800 would
 * prove the operation was ARMED and nothing whatever about the Director**, and
 * would pass against a playback in which the Director never ran.
 *
 * That costs ~9k stepped ticks per run against 1800 for the skirmish, three
 * runs deep. `--no-campaign` exists for when you are iterating on the skirmish
 * half and know it; do not reach for it to make a red run green.
 *
 * ── PHASE D NAVIGATES, AND THE OTHER PHASES DO NOT ─────────────────────────
 *
 * Phases B and C re-arm the shell inside the page phase A loaded, which is why
 * one liveness check covered all three. The campaign arm CANNOT: `Shell.replay`
 * is still set after phase C (only `clearReplay` drops it, and that runs from
 * `startReplay` and `quitToMenu`), and `startOperation` does not clear it — so
 * calling it in the same page would seat the previous recording's players into
 * the operation's world through `applySetupToWorld` and feed it the previous
 * recording's commands. A fresh `page.goto` is the honest reset.
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
 * That is fatal here specifically. The record/replay phases assert that two
 * runs produce the same checksums and the control phases assert that a
 * CORRUPTED recording does not. Both are claims about ONE ENGINE agreeing with
 * itself; both are satisfied just as happily by a stranger's engine agreeing
 * with itself, and the run then prints REPLAY PROBE PASSED about a build nobody
 * looked at. The negative control does not help — it is equally deterministic
 * on somebody else's bundle.
 *
 * `serve()` reads the port back off our own child and byte-compares the served
 * `index.html` against this checkout's `dist/`, so 4321 is where we ASK to
 * listen and the origin below is where we were actually heard.
 */
const PORT_HINT = 4321;

const args = process.argv.slice(2);
const HEADED = args.includes('--headed');
const BUILD = !args.includes('--no-build');
const CAMPAIGN = !args.includes('--no-campaign');

/**
 * The sim ticks the two skirmish runs are compared at. 1800 is a full minute at
 * 30 Hz, which on the default lobby is long enough for the opening build order,
 * the first harvester runs and the AI's first production decisions — i.e. long
 * enough that a stale RNG stream or a missing command cannot hide.
 */
const MARKS = [200, 400, 600, 800, 1000, 1400, 1800];
const SEED = 987654321;

/**
 * The operation the campaign arm is measured on, and the ticks that matter.
 *
 * `soviets.01.first-tap` declares its own `mapSeed`, `simSeed`, preset, biome,
 * opening and bank, so the boot takes NO seed flag — the operation is the
 * whole boot argument, which is itself part of what phases D–F check.
 *
 * 8940 and 9120 BRACKET `minutes(5)` = tick 9000, where `t.relief` fires:
 * four Wardens for seat 1 through `spawnUnits`, followed by an `orderTagged`
 * attack-move. The spawn touches no bus and therefore appears in NO recording;
 * it exists on the replay only if the Director re-ran. The `orderTagged` DOES
 * cross the bus, at Cleanup 9000, so it is drained and recorded on tick 9001 —
 * and on playback the harvest at `Phase.Command` order 1 throws the re-derived
 * copy away before the recorded one is fed. Once, either way.
 */
const OPERATION = 'soviets.01.first-tap';
const CAMPAIGN_MARKS = [200, 1800, 5400, 8940, 9120];
/**
 * The tick the Director's relief order is RECORDED at, which is the tick after
 * it fires. `t.relief` runs at `Phase.Cleanup` 9000 of tick 9000; that order
 * lands on the bus after the tick's only drain, so it is drained — and
 * therefore stamped — on 9001. Trap 4 of `Replay.ts`: the recorder stores the
 * APPLY tick, never the issue tick.
 */
const RELIEF_RECORDED_TICK = 9001;

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

/**
 * Pause, step to each absolute tick, and fingerprint there.
 *
 * `alive` is the store's live entity count, and it is here because the campaign
 * arm needs a number a HUMAN can read across the relief wave. A hash says
 * "different"; `alive 61 -> 65` says four hulls arrived, which is the sentence
 * the campaign arm exists to be able to write.
 */
const walk = (marks) => page.evaluate((ms) => {
  window.__vmShell.getGame().setPaused(true);
  const out = [];
  for (const target of ms) {
    const at = window.__vmReplay.stats().tick;
    if (target > at) window.__VM.advanceTicks(target - at);
    const s = window.__vmReplay.stats();
    out.push({
      tick: s.tick,
      hash: s.hash >>> 0,
      commands: s.commands,
      checks: s.checks,
      alive: window.__vmShell.getGame()?.ctx.world.store.aliveCount ?? -1,
    });
  }
  return out;
}, marks);

const untilPlaying = () => page.waitForFunction(
  () => window.__vmShell?.getState?.() === 'playing', null, { timeout: 120_000 },
);

const settle = async () => {
  await untilPlaying();
  await page.evaluate(() => window.__VM.waitFrames(6));
};

const show = (rows) => {
  for (const m of rows) {
    console.log(`    tick ${String(m.tick).padStart(5)}  ${hex(m.hash)}  alive ${m.alive}`);
  }
};

/** Every sampled tick agrees between a recording run and its playback. */
const compare = (recMarks, playMarks) => {
  let ok = true;
  for (let i = 0; i < recMarks.length; i++) {
    const a = recMarks[i];
    const b = playMarks[i];
    if (b !== undefined && a.tick === b.tick && a.hash === b.hash) continue;
    ok = false;
    console.log(`  DIFFER at tick ${a.tick}: recorded ${hex(a.hash)}, replay ${b ? hex(b.hash) : '(none)'}`
      + `${b && a.alive !== b.alive ? `  (alive ${a.alive} vs ${b.alive})` : ''}`);
  }
  return ok;
};

/**
 * Wait for the replay strip to repaint, then read it.
 *
 * DO NOT SLEEP AND HOPE. The strip is repainted from the shell's rAF poll at
 * 5 Hz and `advanceTicks` runs the whole simulation SYNCHRONOUSLY — so the
 * moment `walk` returns, the bar is still showing whatever it last saw during
 * the live boot. A fixed sleep reported the stale text often enough to fail a
 * run that had actually detected the divergence.
 */
const readBar = async (prefix) => {
  await page.waitForFunction(
    (want) => (document.querySelector('.vm-replay-sync')?.textContent ?? '').startsWith(want),
    prefix, { timeout: 15_000 },
  ).catch(() => { /* printed as-is by the caller */ });
  return page.evaluate(() => ({
    sync: document.querySelector('.vm-replay-sync')?.textContent ?? '(absent)',
    clock: document.querySelector('.vm-replay-clock')?.textContent ?? '',
    note: document.querySelector('.vm-replay-note')?.textContent ?? '',
  }));
};

/** Stash the recording under `key` and describe it. */
const takeRecording = (key) => page.evaluate((k) => {
  const json = window.__vmReplay.save();
  window.sessionStorage.setItem(k, json);
  const p = JSON.parse(json);
  return {
    header: p.header, commands: p.commands.length, checks: p.checks.length, bytes: json.length,
  };
}, key);

/**
 * Re-arm the shell on a stashed recording, optionally cutting one command.
 *
 * `cut` is `null`, or `{ tick, pick }` where `pick` is `'before'` (the last
 * command at or before `tick`) or `'after'` (the first command at or after it).
 * THE CUT IS AIMED RATHER THAN RANDOM — it has to land inside the window the
 * marks sample, or a real divergence would be invisible and the control would
 * report a pass it did not earn.
 */
const startStoredReplay = (key, cut) => page.evaluate(async ([k, c]) => {
  const file = JSON.parse(window.sessionStorage.getItem(k));
  let removed = null;
  if (c !== null && file.commands.length > 0) {
    let i = c.pick === 'after'
      ? file.commands.findIndex((cmd) => cmd.tick >= c.tick)
      : file.commands.findIndex((cmd) => cmd.tick > c.tick) - 1;
    // Not found either way: take the last command, so a control that could not
    // aim still cuts something rather than silently cutting nothing and
    // reporting "played back clean".
    if (i < 0) i = file.commands.length - 1;
    const gone = file.commands.splice(i, 1)[0];
    removed = { tick: gone.tick, player: gone.player, kind: gone.kind, order: gone.order };
  }
  await window.__vmShell.startReplay(file);
  return {
    removed,
    operation: window.__vmShell.activeOperationId?.() ?? null,
  };
}, [key, cut ?? null]);

/* ==========================================================================
 * PHASES A–C: A SKIRMISH
 * ========================================================================== */

console.log(`\n=== A: RECORD  ?skipmenu=1&seed=${SEED} ===`);
server.assertAlive('the skirmish recording phase');
await page.goto(`${BASE}?skipmenu=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 120_000 });
await page.evaluate(() => window.__VM.ready());
await settle();

const recMarks = await walk(MARKS);
const rec = await takeRecording('vmReplayProbe');

console.log(`  seed ${rec.header.simSeed}  map ${rec.header.mapPreset}/${rec.header.biome}`
  + `  landform ${rec.header.mapSeed}  opening ${rec.header.start}`);
console.log(`  ${rec.commands} commands, ${rec.checks} checkpoints, ${rec.bytes} bytes`);
show(recMarks);

// A SKIRMISH MUST NOT CLAIM TO BE AN OPERATION. `campaign` is absent from a
// skirmish header, and its absence is what makes every pre-campaign v2 file on
// disk a statement of fact rather than a default — see `ReplayHeader.campaign`.
const skirmishClean = rec.header.campaign === undefined;
if (!skirmishClean) {
  console.log(`  SKIRMISH HEADER NAMES AN OPERATION: ${JSON.stringify(rec.header.campaign)}`);
}

console.log('\n=== B: REPLAY ===');
await startStoredReplay('vmReplayProbe', null);
await settle();

const playMarks = await walk(MARKS);
show(playMarks);
const barB = await readBar('Complete');
console.log(`  bar: "${barB.sync}"  ${barB.clock}`);

const okB = compare(recMarks, playMarks) && skirmishClean;
console.log(okB ? '  B: PASS — every sampled tick agrees.' : '  B: FAIL — the replay diverged.');

console.log('\n=== C: NEGATIVE CONTROL: one command deleted ===');
const cutC = await startStoredReplay('vmReplayProbe', { tick: 200, pick: 'before' });
await settle();
const cutMarks = await walk(MARKS);
const barC = await readBar('Diverged');

const lastRec = recMarks[recMarks.length - 1];
const lastCut = cutMarks[cutMarks.length - 1];
console.log(`  removed the command at tick ${cutC.removed?.tick ?? '(none)'}`
  + `  (player ${cutC.removed?.player ?? '?'}, kind ${cutC.removed?.kind ?? '?'})`);
console.log(`  tick ${lastCut.tick}: ${hex(lastCut.hash)} vs recorded ${hex(lastRec.hash)}`);
console.log(`  bar: "${barC.sync}"`);
if (barC.note !== '') console.log(`  note: ${barC.note}`);
const okC = lastCut.hash !== lastRec.hash && barC.sync.startsWith('Diverged');
console.log(okC
  ? '  C: PASS — the recording is what drives the match, and a broken one says so.'
  : '  C: FAIL — a corrupted recording played back clean. Phase B proves nothing.');

/* ==========================================================================
 * PHASES D–F: A CAMPAIGN OPERATION
 * ========================================================================== */

let okD = true;
let okE = true;
let okF = true;

if (!CAMPAIGN) {
  console.log('\n=== D-F: SKIPPED (--no-campaign) ===');
  console.log('  The Director is unproven. Phases A-C cannot see it: a skirmish has none.');
} else {
  console.log(`\n=== D: CAMPAIGN RECORD  ?campaign=${OPERATION} ===`);
  // A FRESH PAGE, NOT A RE-ARM. See the header: `Shell.replay` survives phase C
  // and `startOperation` does not clear it, so an in-page launch would seat the
  // skirmish recording's players into the operation's world.
  server.assertAlive('the campaign recording phase');
  await page.goto(`${BASE}?campaign=${OPERATION}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 120_000 });
  await page.evaluate(() => window.__VM.ready());
  await settle();

  const armed = await page.evaluate(() => window.__vmShell.activeOperationId?.() ?? null);
  console.log(`  armed operation: ${armed ?? '(none)'}`);

  const opRecMarks = await walk(CAMPAIGN_MARKS);
  const opRec = await takeRecording('vmCampaignProbe');
  const recordedOp = opRec.header.campaign?.operation ?? null;

  console.log(`  header campaign: ${JSON.stringify(opRec.header.campaign ?? null)}`);
  console.log(`  seed ${opRec.header.simSeed}  map ${opRec.header.mapPreset}/${opRec.header.biome}`
    + `  landform ${opRec.header.mapSeed}  opening ${opRec.header.start}`);
  console.log(`  ${opRec.commands} commands, ${opRec.checks} checkpoints, ${opRec.bytes} bytes`);
  show(opRecMarks);

  const before = opRecMarks[opRecMarks.length - 2];
  const after = opRecMarks[opRecMarks.length - 1];
  const arrived = after.alive - before.alive;
  console.log(`  across the relief wave (${before.tick} -> ${after.tick}): alive ${arrived >= 0 ? '+' : ''}${arrived}`);
  if (arrived < 4) {
    console.log('  WARNING: fewer than the four Wardens `t.relief` spawns appeared. Combat losses');
    console.log('  in the same window can mask them, but if this is 0 the Director may not have run');
    console.log('  at all — in which case phase E proves only that the LAYOUT reproduces.');
  }

  okD = recordedOp === OPERATION;
  if (!okD) {
    console.log(`  D: FAIL — the header says ${recordedOp ?? '(no campaign)'}, not ${OPERATION}.`);
    console.log('  `ReplayRecorder.captureStart` takes the operation on the first sim tick from');
    console.log('  `campaignSession()`; a null there means nothing was armed for this boot.');
  } else {
    console.log('  D: PASS — the recording names the operation it was played in.');
  }

  console.log('\n=== E: CAMPAIGN REPLAY ===');
  const started = await startStoredReplay('vmCampaignProbe', null);
  await settle();
  console.log(`  operation armed for playback: ${started.operation ?? '(none)'}`);

  const opPlayMarks = await walk(CAMPAIGN_MARKS);
  show(opPlayMarks);
  const barE = await readBar('Complete');
  console.log(`  bar: "${barE.sync}"  ${barE.clock}`);

  okE = compare(opRecMarks, opPlayMarks);
  if (!okE && started.operation === null) {
    console.log('  DIAGNOSIS: no operation was armed for the playback boot. A campaign recording');
    console.log('  replays only if `Shell.startReplay` reads `header.campaign` and calls');
    console.log('  `armOperation` BEFORE `startMatch` — the effects are not in the command');
    console.log('  stream, so without it the Director never runs and the layout never builds.');
  }
  console.log(okE
    ? '  E: PASS — the Director re-ran, and every sampled tick agrees.'
    : '  E: FAIL — the operation did not reproduce.');

  console.log('\n=== F: CAMPAIGN NEGATIVE CONTROL: one command deleted ===');
  // CUT INSIDE THE RELIEF WINDOW, and print what was taken. The FIRST command
  // recorded at or after 9001 is often the Director's own attack-move for the
  // column — the sharpest form of this control, because the Director RE-DERIVES
  // that order on playback and the harvest throws the re-derived copy away, so
  // with the recorded copy gone the column never receives it. It is not
  // guaranteed to be that command; the AI issues at the same ticks. The claim
  // does not depend on which one it is — ANY cut command must diverge, or the
  // file is decoration — but the line below says which, so a reader can tell.
  const cutF = await startStoredReplay('vmCampaignProbe', { tick: RELIEF_RECORDED_TICK, pick: 'after' });
  await settle();
  const opCutMarks = await walk(CAMPAIGN_MARKS);
  const barF = await readBar('Diverged');

  const lastOpRec = opRecMarks[opRecMarks.length - 1];
  const lastOpCut = opCutMarks[opCutMarks.length - 1];
  console.log(`  removed the command at tick ${cutF.removed?.tick ?? '(none)'}`
    + `  (player ${cutF.removed?.player ?? '?'}, kind ${cutF.removed?.kind ?? '?'},`
    + ` order ${cutF.removed?.order ?? '?'})`);
  console.log(`  tick ${lastOpCut.tick}: ${hex(lastOpCut.hash)} vs recorded ${hex(lastOpRec.hash)}`);
  console.log(`  bar: "${barF.sync}"`);
  if (barF.note !== '') console.log(`  note: ${barF.note}`);
  okF = lastOpCut.hash !== lastOpRec.hash && barF.sync.startsWith('Diverged');
  console.log(okF
    ? '  F: PASS — the recorded stream drives the operation, not the re-derivation.'
    : '  F: FAIL — a corrupted campaign recording played back clean. Phase E proves nothing.');
}

await browser.close();
cleanup();

const passed = okB && okC && okD && okE && okF;
console.log(`\n${passed ? 'REPLAY PROBE PASSED' : 'REPLAY PROBE FAILED'}\n`);
process.exit(passed ? 0 : 1);

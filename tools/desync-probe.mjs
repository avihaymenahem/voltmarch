/**
 * ============================================================================
 * tools/desync-probe.mjs — is this simulation the same simulation everywhere?
 * ============================================================================
 * Deterministic lockstep multiplayer is a bet: that two machines running the
 * same code over the same commands produce bit-identical worlds. This tool is
 * the only honest way to hold that bet up to the light BEFORE a relay exists.
 *
 *   node tools/desync-probe.mjs            # the math probe (default)
 *   node tools/desync-probe.mjs --sim      # + a full game hash trace
 *   node tools/desync-probe.mjs --engines=chromium,firefox
 *   node tools/desync-probe.mjs --json out.json
 *
 * ── WHY TWO PROBES, AND WHY THE SMALL ONE IS THE IMPORTANT ONE ─────────────
 *
 * `src/game/Checksum.ts` quantises every float to 1e-3 before hashing, and its
 * header says exactly why: ECMA-262 does not specify `Math.sin`, `cos`,
 * `atan2`, `exp`, `pow`, `log` or `acos` to bit precision, so two engines may
 * legitimately differ in the last ulp and be the same simulation in every sense
 * a player cares about.
 *
 * THAT REASONING IS CORRECT FOR REPLAY AND INSUFFICIENT FOR MULTIPLAYER.
 * Quantising hides a small divergence from DETECTION; it does nothing to stop
 * one from COMPOUNDING. A unit whose heading differs by one ulp takes the same
 * turn for a thousand ticks and then, one day, rounds onto the other side of a
 * pathfinding cell boundary — and from that tick the two machines are playing
 * different games. The checksum will eventually scream, but by then the cause
 * is a thousand ticks upstream and invisible.
 *
 * So probe 1 asks the narrow question directly: over the input ranges the sim
 * actually uses, do the unspecified functions return IDENTICAL BITS on every
 * engine? No quantisation, no tolerance, no renderer, no build. It is the
 * decisive measurement and it runs in about a second.
 *
 * Probe 2 (`--sim`) boots the real game in each engine and traces
 * `__vmReplay.stats().hash` over several thousand ticks of AI play. It is the
 * end-to-end confirmation, and it is OPTIONAL because it needs WebGL2 — which
 * headless Firefox and WebKit do not reliably provide. A tool whose default
 * path can fail for reasons unrelated to the question it asks is a tool people
 * stop believing.
 *
 * ── WHAT A FAILURE MEANS ───────────────────────────────────────────────────
 *
 * A divergence here does NOT mean multiplayer is impossible. It means the
 * offending call sites — `Movement.ts` has 13, `Steering.ts` 4 — must move to
 * deterministic implementations in `src/core/math.ts` before a relay is worth
 * writing. Finding that out now costs a day. Finding it out after the server
 * ships costs the feature.
 *
 * `Math.sqrt` is deliberately included even though IEEE-754 REQUIRES it to be
 * correctly rounded and it therefore cannot differ. It is the control: if the
 * probe ever reports sqrt diverging, the probe is broken, not the engine.
 * ============================================================================
 */

import { chromium, firefox, webkit } from 'playwright';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build, serve } from './lib/serve.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * THE RECORDED BASELINE, AND WHY IT IS NOT A CONVENIENCE.
 *
 * Requiring all three engines in one process makes this tool unrunnable on any
 * machine that is missing one — which, on the machine this was written on, is
 * every machine: Firefox and WebKit are present on disk and refuse to launch.
 * A determinism probe nobody can run is worth exactly nothing, and "we could
 * not check" would have been indistinguishable from "we checked and it passed"
 * by the time anyone read the commit.
 *
 * So a run RECORDS its per-engine hashes here, and every later run compares
 * against every engine already on file as well as the ones running right now.
 * One person on Windows records chromium; another on macOS runs webkit and the
 * comparison happens anyway, across two machines and two weeks. The reference
 * is committed for exactly that reason.
 *
 * A recorded hash is only comparable to a run of THE SAME probe: `CASES` is
 * versioned, and a run whose case set differs from the file's refuses to
 * compare rather than reporting a divergence that is really just an edit.
 */
const REFERENCE_PATH = join(ROOT, 'tools', 'desync-reference.json');

/**
 * Bump when `CASES` changes — different inputs, different hashes, and a stale
 * reference would otherwise report every function as diverging.
 */
const PROBE_VERSION = 1;

/**
 * WHERE THE PREVIEW IS ASKED TO LISTEN, AND WHY THAT IS ONLY A REQUEST HERE.
 *
 * This said "distinct from tools/shoot.mjs (4317) so the two can run
 * concurrently", and it was distinct from 4317 and shared with FOUR OTHER
 * TOOLS: `flash-stack`, `boot-profile`, `naval-proof` and `sobel` all hard-coded
 * 4319 too, two of them with the same reassuring comment. A number chosen to
 * avoid one collision cannot avoid the next one, and the collision it could not
 * avoid at all is the second worktree running THIS tool.
 *
 * That matters more here than almost anywhere else in `tools/`. The entire
 * output of this file is a COMPARISON: hashes from engine A held against hashes
 * from engine B and against a committed baseline. Serve one of those engines
 * from a neighbour's `dist/` and the probe reports a divergence that does not
 * exist — or, if the neighbour happens to be an OLDER build of a fix, hides one
 * that does. Either way the answer looks exactly like a real finding, and the
 * finding is what this tool exists to produce.
 *
 * So `serve()` reads the port back off our own child and byte-compares the
 * served `index.html` against this checkout's `dist/`. 4319 is a hint; a busy
 * one is walked off, not asserted.
 */
const PORT_HINT = 4319;

const ENGINES = { chromium, firefox, webkit };

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 1);
};

const runSim = has('--sim');
const noBuild = has('--no-build');
const jsonOut = valueOf('--json', null);
const seed = Number(valueOf('--seed', '20260809')) | 0;
/** Sim ticks between hash samples. 30 matches REPLAY_CHECKSUM_INTERVAL. */
const SAMPLE_TICKS = Number(valueOf('--interval', '30')) | 0;
/** Total sim ticks to trace. 3000 is 100 seconds of match at 30 Hz. */
const SIM_TICKS = Number(valueOf('--ticks', '3000')) | 0;

const wanted = valueOf('--engines', 'chromium,firefox,webkit')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

for (const name of wanted) {
  if (!(name in ENGINES)) {
    console.error(`unknown engine "${name}" — expected one or more of: ${Object.keys(ENGINES).join(', ')}`);
    process.exit(2);
  }
}

/* ==========================================================================
 * PROBE 1 — THE MATH PROBE
 *
 * Runs entirely inside `page.evaluate`. The function below is stringified by
 * Playwright and executed in the page, so it must be self-contained: no
 * closures over module scope, no imports.
 * ========================================================================== */

/**
 * Sample every unspecified `Math` function over the ranges `src/sim/**` uses
 * and fold the RAW BITS of every result into an integer hash.
 *
 * Two decisions carry the whole probe:
 *
 * 1. THE INPUTS ARE GENERATED, NOT LISTED. A hard-coded table would test
 *    whatever inputs the author happened to think of. This reimplements the
 *    game's own `Rng` (src/core/math.ts) — pure `imul`/xor/shift, so it is
 *    bit-identical on every engine by construction — and draws the same
 *    hundreds of thousands of inputs everywhere.
 *
 * 2. THE COMPARISON IS ON BITS, NOT VALUES. `a === b` is true for two doubles
 *    that differ by nothing, but so is `Math.abs(a-b) < 1e-12`, and that is the
 *    trap: a one-ulp difference IS the failure being hunted. Each result is
 *    written into a Float64Array and read back as two uint32s, so the hash
 *    changes if any bit of any result changes.
 */
function mathProbeBody(sampleCount) {
  /* -- the game's Rng, inline. Integer-only: cannot differ between engines. -- */
  let rngState = 0x9e3779b9;
  const next = () => {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* -- FNV-1a over 32-bit words, same mixer as src/game/Checksum.ts --------- */
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET = 0x811c9dc5;
  const mix = (h, word) => Math.imul((h ^ (word | 0)) >>> 0, FNV_PRIME) >>> 0;

  /* -- raw bit access ------------------------------------------------------- */
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);

  /**
   * Fold one double's exact bit pattern into `h`.
   *
   * NaN is normalised to a fixed sentinel first. Real NaNs carry a payload that
   * engines are free to choose differently, and a NaN produced identically by
   * two engines would otherwise hash differently and report a false divergence.
   * (`acos` out of domain and `log` of a negative both produce one legitimately.)
   */
  const foldBits = (h, v) => {
    if (Number.isNaN(v)) return mix(h, 0x7f5ada15);
    f64[0] = v;
    return mix(mix(h, u32[0]), u32[1]);
  };

  /*
   * The call sites these ranges are drawn from:
   *   sin/cos    — Movement.ts heading integration, Steering.ts separation
   *   atan2      — Movement.ts desired yaw, Combat.ts turret traverse
   *   exp        — Damage.ts falloff, Economy.ts decay curves
   *   pow        — Armor.ts damage scaling, AIStrategy.ts weighting
   *   log/acos   — Harvesting.ts scoring, Combat.ts arc tests
   *   hypot/sqrt — distance everywhere (sqrt is the control; it cannot differ)
   */
  const CASES = [
    { name: 'sin', arity: 1, lo: -8, hi: 8, fn: (a) => Math.sin(a) },
    { name: 'cos', arity: 1, lo: -8, hi: 8, fn: (a) => Math.cos(a) },
    // Yaw accumulates without being wrapped in some paths, so large arguments
    // are real: argument reduction is exactly where sin/cos implementations
    // historically disagree.
    { name: 'sin.big', arity: 1, lo: -100000, hi: 100000, fn: (a) => Math.sin(a) },
    { name: 'cos.big', arity: 1, lo: -100000, hi: 100000, fn: (a) => Math.cos(a) },
    { name: 'tan', arity: 1, lo: -1.5, hi: 1.5, fn: (a) => Math.tan(a) },
    { name: 'atan2', arity: 2, lo: -512, hi: 512, fn: (a, b) => Math.atan2(a, b) },
    { name: 'exp', arity: 1, lo: -12, hi: 4, fn: (a) => Math.exp(a) },
    { name: 'pow', arity: 2, lo: 0, hi: 8, fn: (a, b) => Math.pow(a, b) },
    { name: 'log', arity: 1, lo: 0.0001, hi: 4096, fn: (a) => Math.log(a) },
    { name: 'acos', arity: 1, lo: -1, hi: 1, fn: (a) => Math.acos(a) },
    { name: 'asin', arity: 1, lo: -1, hi: 1, fn: (a) => Math.asin(a) },
    { name: 'hypot', arity: 2, lo: -512, hi: 512, fn: (a, b) => Math.hypot(a, b) },
    // The control. IEEE-754 requires correct rounding; if this ever differs,
    // the probe is wrong, not the engine.
    { name: 'sqrt', arity: 1, lo: 0, hi: 262144, fn: (a) => Math.sqrt(a) },
  ];

  const out = {};
  for (const c of CASES) {
    // Reseed per case so each hash is independent of the ones before it — a
    // single divergence then names ONE function instead of poisoning the rest.
    rngState = 0x9e3779b9;
    let h = FNV_OFFSET;
    let firstBad = null;
    for (let i = 0; i < sampleCount; i++) {
      const a = c.lo + next() * (c.hi - c.lo);
      const b = c.arity === 2 ? c.lo + next() * (c.hi - c.lo) : 0;
      const v = c.arity === 2 ? c.fn(a, b) : c.fn(a);
      h = foldBits(h, v);
      // Keep one representative sample so a divergence report can show real
      // numbers rather than only two disagreeing hashes.
      if (i === 0) firstBad = { a, b, v };
    }
    out[c.name] = { hash: h >>> 0, sample: firstBad };
  }
  return {
    cases: out,
    ua: navigator.userAgent,
  };
}

/* ==========================================================================
 * PROBE 2 — THE SIM PROBE
 * ========================================================================== */

/**
 * Boot the real game, pause it, and step the simulation in fixed slices,
 * recording the whole-sim hash at each one.
 *
 * `?skipmenu=1` lands straight in a match with the AI on slot 1, so the command
 * stream is the AI's and is generated deterministically from `?seed=`. Nothing
 * has to be injected: if two engines agree on this trace they agree on
 * Movement, Steering, Targeting, Weapons, Damage, Production and Economy at
 * once, driven by a real opponent rather than a scripted one.
 */
async function traceSim(page, ticks, interval) {
  return page.evaluate(
    async ([total, step]) => {
      const vm = window.__VM;
      const replay = window.__vmReplay;
      if (vm === undefined) throw new Error('__VM was never installed');
      if (replay === undefined) throw new Error('__vmReplay was never installed');
      vm.pause();
      const trace = [];
      for (let done = 0; done < total; done += step) {
        vm.step(step);
        const s = replay.stats();
        trace.push({ tick: s.tick, hash: s.hash >>> 0, commands: s.commands });
      }
      return trace;
    },
    [ticks, interval],
  );
}

/* ==========================================================================
 * SERVING (only needed by probe 2)
 * ========================================================================== */

async function startPreview() {
  if (!noBuild) {
    await build(ROOT, { log: console.log });
  } else if (!existsSync(join(ROOT, 'apps/game/dist', 'index.html'))) {
    throw new Error('--no-build was given but dist/index.html does not exist.');
  }

  console.log('> serving...');
  return serve({ root: ROOT, mode: 'preview', portHint: PORT_HINT, log: console.log });
}

/* ==========================================================================
 * COMPARISON
 * ========================================================================== */

/** ANSI, but only when stdout is a TTY — a redirected log stays readable. */
const colour = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m` }
  : { red: (s) => s, green: (s) => s, dim: (s) => s };

const hex = (n) => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

/** Load the committed baseline, or an empty one. */
function loadReference() {
  if (!existsSync(REFERENCE_PATH)) return { probeVersion: PROBE_VERSION, engines: {} };
  try {
    const parsed = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8'));
    if (parsed.probeVersion !== PROBE_VERSION) {
      console.log(colour.dim(
        `  (baseline is probe v${parsed.probeVersion}, this is v${PROBE_VERSION} — ignoring it)`,
      ));
      return { probeVersion: PROBE_VERSION, engines: {} };
    }
    return parsed;
  } catch {
    console.log(colour.dim('  (baseline is unreadable — ignoring it)'));
    return { probeVersion: PROBE_VERSION, engines: {} };
  }
}

/**
 * Compare every engine — those measured in THIS run and those recorded in the
 * committed baseline — against one reference column.
 *
 * The reference is whichever column comes first, purely because something has
 * to be, and that is stated rather than implied: a divergence means "these two
 * engines disagree", not "that engine is wrong".
 *
 * A recorded engine that also ran live is compared to ITSELF first. That check
 * is not ceremony — it catches an engine UPDATE changing a result, which is the
 * same defect as two engines disagreeing and is otherwise invisible because
 * only one column is on screen.
 */
function compareMath(live, baseline) {
  const columns = {};
  const source = {};
  for (const [name, rec] of Object.entries(baseline.engines)) {
    columns[`${name}*`] = rec.cases;
    source[`${name}*`] = `baseline (${rec.version ?? 'unknown build'})`;
  }
  for (const [name, res] of Object.entries(live)) {
    columns[name] = res.cases;
    source[name] = res.ua;
  }

  const names = Object.keys(columns);
  const reference = names[0];
  const caseNames = Object.keys(columns[reference]);
  const rows = [];
  let failures = 0;

  for (const caseName of caseNames) {
    const refHash = columns[reference][caseName]?.hash;
    const row = { case: caseName, agree: true, cells: {} };
    for (const name of names) {
      const got = columns[name][caseName];
      row.cells[name] = got === undefined ? null : got.hash;
      if (got === undefined || got.hash !== refHash) { row.agree = false; }
    }
    if (!row.agree) failures++;
    rows.push(row);
  }

  /* -- drift: the same engine, recorded and live, must still agree ---------- */
  const drift = [];
  for (const name of Object.keys(live)) {
    const rec = baseline.engines[name];
    if (rec === undefined) continue;
    for (const caseName of caseNames) {
      const before = rec.cases[caseName]?.hash;
      const now = live[name].cases[caseName]?.hash;
      if (before !== undefined && now !== undefined && before !== now) {
        drift.push({ engine: name, case: caseName, was: hex(before), now: hex(now) });
      }
    }
  }

  return { names, reference, rows, failures, drift, source };
}

function compareTraces(traces, reference) {
  const ref = traces[reference];
  const problems = [];
  for (const engine of Object.keys(traces)) {
    if (engine === reference) continue;
    const other = traces[engine];
    const n = Math.min(ref.length, other.length);
    let firstBad = null;
    for (let i = 0; i < n; i++) {
      if (ref[i].hash !== other[i].hash || ref[i].tick !== other[i].tick) {
        firstBad = {
          tick: ref[i].tick,
          [reference]: { hash: hex(ref[i].hash), commands: ref[i].commands },
          [engine]: { hash: hex(other[i].hash), commands: other[i].commands },
        };
        break;
      }
    }
    problems.push({ engine, samples: n, firstBad });
  }
  return problems;
}

/* ==========================================================================
 * MAIN
 * ========================================================================== */

const report = { seed, engines: wanted, math: null, sim: null };
let server = null;
let exitCode = 0;

try {
  /* -- probe 1 ------------------------------------------------------------ */
  console.log(`> math probe across ${wanted.join(', ')}`);
  const mathResults = {};
  for (const name of wanted) {
    const browser = await ENGINES[name].launch();
    try {
      const page = await browser.newPage();
      // about:blank is enough — this probe touches nothing but `Math`.
      mathResults[name] = await page.evaluate(mathProbeBody, 200_000);
      console.log(`  ${name.padEnd(9)} ${colour.dim(mathResults[name].ua.slice(0, 72))}`);
    } finally {
      await browser.close();
    }
  }

  const baseline = loadReference();
  const { names, reference, rows, failures, drift, source } = compareMath(mathResults, baseline);
  report.math = { reference, columns: names, rows, failures, drift };

  console.log('');
  const width = Math.max(...rows.map((r) => r.case.length), 8);
  const colW = 12;
  console.log(`  ${'function'.padEnd(width)}  ${names.map((e) => e.padEnd(colW)).join('')}`);
  for (const r of rows) {
    const cells = names
      .map((e) => (r.cells[e] === null ? '—' : hex(r.cells[e])).padEnd(colW))
      .join('');
    const mark = r.agree ? colour.green('ok') : colour.red('DIVERGES');
    console.log(`  ${r.case.padEnd(width)}  ${cells} ${mark}`);
  }
  console.log('');
  console.log(colour.dim(`  * = recorded baseline, not measured in this run`));
  for (const n of names) console.log(colour.dim(`    ${n.padEnd(12)} ${String(source[n]).slice(0, 64)}`));
  console.log('');

  for (const d of drift) {
    exitCode = 1;
    console.log(colour.red(
      `  DRIFT: ${d.engine} used to return ${d.was} for ${d.case}, now returns ${d.now}.`,
    ));
    console.log('  The engine itself changed. Every client on the old build desyncs against');
    console.log('  every client on the new one — this is a forced-update event, not a bug.');
  }

  if (names.length < 2) {
    console.log(colour.dim('  only one column — recorded, but nothing to compare against yet.'));
    console.log(colour.dim('  Run this on a machine with another engine to complete the check.'));
  } else if (failures > 0) {
    exitCode = 1;
    console.log(colour.red(`  ${failures} function(s) disagree.`));
    console.log('  Lockstep across these engines is NOT safe until the offending call');
    console.log('  sites move to deterministic implementations in src/core/math.ts.');
  } else {
    console.log(colour.green(
      `  every sampled function agrees bit-for-bit across ${names.length} engines.`,
    ));
  }

  /* -- record ------------------------------------------------------------
   * A NEW engine is recorded automatically. A DRIFTED one is NOT, and that
   * asymmetry is the whole point: writing the new hashes over the old ones
   * would report the drift exactly once and then quietly adopt it, so the
   * second run — and every run after — would show agreement. An instrument
   * that erases its own finding is worse than no instrument, because the
   * finding was already believed.
   *
   * `--record` is the deliberate override, for when the drift is understood
   * and the new value is the one to keep.
   * ---------------------------------------------------------------------- */
  const drifted = new Set(drift.map((d) => d.engine));
  const added = [];
  for (const [name, res] of Object.entries(mathResults)) {
    if (drifted.has(name) && !has('--record')) continue;
    if (baseline.engines[name] !== undefined && !drifted.has(name)) continue;
    baseline.engines[name] = { version: res.ua, cases: res.cases };
    added.push(name);
  }
  if (added.length > 0) {
    baseline.probeVersion = PROBE_VERSION;
    writeFileSync(REFERENCE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(colour.dim(`  baseline: recorded ${added.join(', ')}`));
  }
  if (drifted.size > 0 && !has('--record')) {
    console.log(colour.dim('  baseline NOT overwritten — re-run with --record once the drift is understood.'));
  }

  /* -- probe 2 ------------------------------------------------------------ */
  if (runSim) {
    console.log('');
    console.log(`> sim probe — ${SIM_TICKS} ticks, sampling every ${SAMPLE_TICKS}`);
    server = await startPreview();
    const traces = {};
    const skipped = [];

    for (const name of wanted) {
      const browser = await ENGINES[name].launch();
      try {
        const page = await browser.newPage();
        // OUR server, still alive, before every engine's page. An engine traced
        // off a stranger's build is a column in the comparison table and there
        // is nothing in the table to say it came from somewhere else.
        server.assertAlive(`the ${name} trace`);
        const url = `${server.origin}?skipmenu=1&seed=${seed}&fog=off`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__VM !== undefined, null, { timeout: 60_000 });
        await page.evaluate(() => window.__VM.ready());
        await page.waitForFunction(() => window.__vmReplay !== undefined, null, { timeout: 60_000 });
        traces[name] = await traceSim(page, SIM_TICKS, SAMPLE_TICKS);
        console.log(`  ${name.padEnd(9)} ${traces[name].length} samples`);
      } catch (err) {
        // A missing WebGL2 context is an engine limitation, not a determinism
        // result, and must never be reported as one.
        skipped.push({ engine: name, why: String(err).split('\n')[0] });
        console.log(`  ${name.padEnd(9)} ${colour.dim('skipped — ' + String(err).split('\n')[0].slice(0, 60))}`);
      } finally {
        await browser.close();
      }
    }

    const traced = Object.keys(traces);
    if (traced.length < 2) {
      console.log(colour.dim('  fewer than two engines produced a trace — nothing to compare.'));
      report.sim = { skipped, problems: [], compared: traced };
    } else {
      const problems = compareTraces(traces, traced[0]);
      report.sim = { skipped, problems, compared: traced, reference: traced[0] };
      let simFail = false;
      for (const p of problems) {
        if (p.firstBad === null) {
          console.log(`  ${colour.green('ok')} ${traced[0]} vs ${p.engine} — ${p.samples} samples identical`);
        } else {
          simFail = true;
          console.log(`  ${colour.red('DIVERGES')} ${traced[0]} vs ${p.engine} at tick ${p.firstBad.tick}`);
          console.log(`      ${JSON.stringify(p.firstBad)}`);
        }
      }
      if (simFail) exitCode = 1;
    }
  }
} finally {
  server?.stop();
}

if (jsonOut !== null) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(`\n> wrote ${jsonOut}`);
}

process.exit(exitCode);

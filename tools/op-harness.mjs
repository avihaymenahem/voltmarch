/**
 * ============================================================================
 * tools/op-harness.mjs — can an operation be finished at all, and when
 * ============================================================================
 *   node tools/op-harness.mjs                      # build, then every operation
 *   node tools/op-harness.mjs --op=soviets.01.first-tap
 *   node tools/op-harness.mjs --no-build           # drive the existing dist/
 *   node tools/op-harness.mjs --headed             # watch it happen
 *   node tools/op-harness.mjs --minutes=25         # override the sim budget
 *   node tools/op-harness.mjs --no-ai-player       # leave seat 0 unattended
 *
 * ############################################################################
 * # WHAT THIS MEASURES IS NOT A PAR TIME. IT IS NOT A QA NUMBER. IT IS NOT   #
 * # EVEN AN ESTIMATE OF ONE. DO NOT QUOTE ANY FIGURE BELOW AS "HOW LONG THE  #
 * # OPERATION TAKES".                                                        #
 * ############################################################################
 *
 * `OperationDef.parSec` is authored — the campaign's 37 rows sum to a claim of
 * ~10.7 hours and NOBODY HAS EVER TIMED A VOLTMARCH OPERATION, because until
 * this week none existed. This tool does not fix that. What it fixes is the
 * cheaper and more urgent question underneath it: **does the operation resolve
 * at all**, and if so, at which tick, on which trigger, with which objectives
 * standing.
 *
 * ── WHO IS PLAYING, AND WHY THAT IS THE WHOLE CAVEAT ───────────────────────
 *
 * Nobody. A campaign seats the player at slot 0 and nothing drives it, so an
 * unattended operation whose primary is "destroy the survey tap" would sit
 * there until the enemy razed the player's base — which measures the LOSS path
 * and says nothing whatever about winnability.
 *
 * So by default this hands slot 0 to the ordinary skirmish brain (see
 * `handOverSeatZero`). That brain has never read an objective. It does not know
 * what a tap is, cannot be told to protect a derrick, and has no concept of a
 * secondary. It builds a base, masses an army and attack-moves at whoever is
 * nearest; the operation resolves when that blind advance HAPPENS to satisfy an
 * authored trigger. Three consequences, and all three are the reason the banner
 * above is shouting:
 *
 *   1. **It is not a floor and it is not a ceiling on a human's time.** A human
 *      who has read the briefing drives at the objective and is faster; a human
 *      is also better at every fight along the way. The two errors point in
 *      opposite directions and neither is bounded. One number, one non-player.
 *
 *      **MEASURED, ONCE, AND THE GAP IS THE SIZE OF THE WHOLE CAVEAT.** On
 *      2026-08-19 the author played `soviets.01.first-tap` to a win in
 *      **11:00** against an authored par of 13:00 — 0.846x. This harness LOST
 *      the same operation at **15:09.7** with the tap untouched at 99.3%
 *      health. Same operation, same ground: a human took 73% of the harness's
 *      clock and won where it could not finish at all. That is one point, on
 *      the shortest operation, by the person who built the game — a floor on
 *      play time rather than a median. **Do not read a harness figure as a
 *      play time; do not read that play time as a harness bug.** The number
 *      the harness produced is what a blind advance costs, and it is the
 *      number this file is honest about producing.
 *   2. **A secondary the brain does not know about is scored anyway**, so the
 *      MEDAL printed here is the medal a player who ignored the briefing would
 *      earn. On `soviets.01.first-tap` the brain has no reason on earth to
 *      leave the town's derricks standing.
 *   3. **Flipping `isHuman` moves slot 0 onto the operation's `roster.ai`
 *      list**, because `UnlockGate.rosterAllows` picks the list by that flag.
 *      Where an operation's two roster lists differ — which is the whole point
 *      of having two — the brain is playing a DIFFERENT TECH TREE from the one
 *      the player gets. The run prints a warning when they differ; believe it.
 *
 * What survives all of that, and is worth the run:
 *
 *   - **completability.** A resolution is proof the authored win path is
 *     reachable from the authored starting position on the authored ground.
 *   - **the operation that can never end.** `validateCampaign` refuses one with
 *     no authored win path AND no authored lose path. It cannot refuse one
 *     whose win path is unreachable because the layout put the objective behind
 *     water, or because the trigger names a tag on the wrong seat. That is a
 *     match a player discovers at minute fourteen of nineteen, and it is
 *     exactly what a NO RESOLUTION row here is telling you.
 *   - **the trigger timeline.** Every dialogue line, EVA cue and objective
 *     transition is stamped with the tick it fired on. A relief wave that never
 *     lands, a secondary that fails in the first ten seconds, an `endOperation`
 *     that fires twice — all of them are visible in that log and in nothing
 *     else the project owns.
 *
 * ── HOW IT DRIVES THE WORLD ───────────────────────────────────────────────
 *
 * `__VM.advanceTicks` in bounded slices, with the loop PAUSED so the harness is
 * the only clock in the process. That is also what "maximum sim speed" actually
 * means here: `setTimeScale` scales the real loop's accumulator, and the real
 * loop is not running.
 *
 * **PAUSING IS NOT SUFFICIENT FOR A REPEATABLE RUN, AND THIS FILE ONCE CLAIMED
 * IT WAS.** The paragraph here used to read "two runs of one build land on the
 * same tick". They did not: the live rAF loop reaches a different tick before
 * the pause on every run, the handover is performed on whatever tick that is,
 * and a brain born two ticks apart makes different decisions forever after.
 * Measured at 743 ticks of spread on a single trigger — see `HANDOVER_TICK` in
 * `runOperation`, which pins the tick the world is taken over on and is what
 * makes the claim true rather than intended.
 *
 * `advanceTicks` and not `__VM.step`, and the difference is load-bearing rather
 * than cosmetic. `step` is `runHeadless` — simulation only, no frames — and
 * **the campaign's outcome is published from a FRAME**: `campaign.system.ts`
 * writes `OperationState.outcome` at `Phase.Cleanup` 9000 and then, at
 * `RenderPhase.Hud` 9000, pushes the medal and calls `Shell.endMatch`. Under
 * `step` the sim would resolve and the shell would never hear about it, so the
 * harness would run its whole budget past an operation that had already been
 * won. `advanceTicks` runs one complete system frame per tick, which is also
 * why a slice costs what it costs.
 *
 * ── WHAT IT READS, AND WHY IT WRAPS RATHER THAN INSPECTS ──────────────────
 *
 * `Shell.result` and `Shell.campaignResult` are private and the session lives
 * behind the lazy `campaign-install` chunk, so there is nothing to inspect. The
 * harness therefore wraps the four methods the game itself publishes THROUGH —
 * `endMatch`, `publishCampaignResult`, `publishCampaignObjectives`,
 * `playCampaignBeat` — and records what passes. It reads the game's own words
 * rather than a second derivation of them, which is the only version that
 * cannot drift from what a player is shown.
 *
 * The wrappers are own properties on the shell instance and shadow the
 * prototype; `campaign.system.ts` reaches them through a duck-typed
 * `globalThis.__vmShell` and its `typeof s.endMatch === 'function'` guard is
 * satisfied by an own property exactly as it is by a prototype method.
 *
 * ── THE PORT IS A HINT ────────────────────────────────────────────────────
 *
 * A TCP port is machine-wide and this repo is normally worked in several
 * worktrees at once, so 4325 is where we ASK to listen. `tools/lib/serve.mjs`
 * reads the port back off our own child and byte-compares the served
 * `index.html` against this checkout's `dist/`, and the ladder walks to a free
 * port when the hint is taken. Without that a run would happily drive a
 * NEIGHBOUR'S build and report its resolution tick as this one's — and for this
 * tool the damage would be quiet, because a plausible number is exactly what a
 * stranger's campaign chunk produces.
 * ============================================================================
 */

import { chromium } from 'playwright';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve, build } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** See the header: a hint, never an assertion. */
const PORT_HINT = 4325;

/* ==========================================================================
 * ARGUMENTS
 * ========================================================================== */

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const valueOf = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 1);
};

const HEADED = has('--headed');
const BUILD = !has('--no-build');
const DRIVE_AI = !has('--no-ai-player');
const ONLY = valueOf('--op');
const MINUTES = valueOf('--minutes') === null ? null : Number(valueOf('--minutes'));
const SLICE = valueOf('--slice') === null ? 150 : Math.max(1, Number(valueOf('--slice')) | 0);

if (MINUTES !== null && !(MINUTES > 0)) throw new Error(`--minutes=${valueOf('--minutes')} is not a positive number.`);

/**
 * The fixed step, duplicated from `src/campaign/types.ts#TICKS_PER_SECOND`.
 *
 * A duplicate nobody checks is a duplicate that drifts, so it is checked:
 * `__VM.simHz()` is published for precisely this and the run refuses to report
 * a single second if the two disagree. Every clock in this file — the budget,
 * the slice, the resolution time, the par ratio — is this number times a tick
 * count, so a silent drift would make all four wrong together and none of them
 * look wrong.
 */
const TICKS_PER_SECOND = 30;

/**
 * How long a slice of `advanceTicks` runs before the harness reads the world
 * back. 150 ticks is five seconds of match time.
 *
 * IT IS A SAMPLING RATE AS WELL AS A RESPONSIVENESS KNOB. Peak entity count is
 * read at slice boundaries — `__VM.onFrame` fires from the renderer's own
 * `beginFrame`, which `advanceTicks` reaches only on the last tick of each
 * call, so there is no cheaper per-tick hook to use — and every extra slice
 * costs one full-resolution present. `--slice=` moves both together and the
 * report states which rate the peak was taken at rather than implying a true
 * maximum.
 */

/* ==========================================================================
 * FORMATTING
 * ========================================================================== */

const mmss = (sec) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

/**
 * Sim seconds of OPERATION time for an absolute sim tick.
 *
 * `Session.simTick` stamps `OperationState.startTick` on its first call and the
 * campaign system runs from `init()`, so a fresh `?campaign=` boot starts the
 * operation clock on sim tick 1 — every `elapsed` in an operation file is
 * measured from there.
 *
 * MEASURED, NOT REASONED, AND IT SETTLES AN OFF-BY-ONE. `Director.ts` evaluates
 * `elapsed` as `tick - startTick >= ticks`, so with `startTick` 1 a trigger
 * authored at `minutes(5)` = 9000 fires on TICK 9001, not 9000. Both of
 * `soviets.01.first-tap`'s timed triggers confirm it on a real run —
 * `seconds(4)` landed on tick 121 and `minutes(5)` on tick 9001 — and
 * `tools/replay-probe.mjs`'s header says `t.relief` "runs at Phase.Cleanup 9000
 * of tick 9000". Its control still lands (it cuts the first command at or after
 * 9001 and the order is really stamped at 9002), but the tick in that comment
 * is one low. Subtracting the 1 here is what keeps a reader from having to
 * rediscover any of that to compare a report line with an operation file.
 */
const opSeconds = (tick) => (tick - 1) / TICKS_PER_SECOND;

/* ==========================================================================
 * THE OPERATION TABLE
 * ========================================================================== */

/**
 * The built campaign chunk, found on disk rather than guessed at over HTTP.
 *
 * `CAMPAIGNS` is not on any global — `src/campaign/index.ts` is reachable only
 * through the one `await import('./campaign-install')` that `Shell` and
 * `shell/Campaign.ts` make, which is the whole point of the bundle boundary
 * `campaign.system.ts` is built around. Importing that chunk BY URL from the
 * page gives the same module instance the shell gets, cached by the module map,
 * with no second execution and no new global to maintain in `src/`.
 *
 * ONE MATCH OR NONE. A rollup naming change would otherwise turn "the table is
 * empty" into "no operations exist", which is a silent green run over a
 * campaign nobody measured.
 */
/**
 * WHICH BUILD DID THIS RUN ACTUALLY DRIVE?
 *
 * Rollup content-hashes every chunk filename, so the entry and campaign chunk
 * names ARE a fingerprint of the bundle — no hashing needed here.
 *
 * THIS EXISTS BECAUSE TWO RUNS OF `soviets.01.first-tap` DISAGREED. One
 * reported NO RESOLUTION in 39 minutes; the next, driven with `--no-build`,
 * resolved as a loss at 15:09.7. That reads exactly like harness
 * non-determinism, which would falsify this file's own claim that "two runs of
 * one build land on the same tick" — and it is nothing of the sort. A `npm run
 * build` had landed in between, so the two runs drove DIFFERENT BUNDLES and
 * were never comparable. Nothing in the output said so.
 *
 * That is `tools/shoot.mjs`'s defect in a second costume: it photographed
 * another worktree's build and printed `12/12 captured`, and the fix there was
 * to record the origin and byte-compare what was served. Same lesson, cheaper
 * instrument — print what you drove, so "did these two runs measure the same
 * thing" is answerable from the output instead of from memory.
 */
function buildFingerprint() {
  const campaign = campaignChunkPath().replace('assets/', '');
  let entry = '(no index.html)';
  try {
    const html = readFileSync(join(ROOT, 'apps/game/dist', 'index.html'), 'utf8');
    const m = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html);
    if (m !== null) entry = m[1];
  } catch { /* reported as the placeholder above */ }
  return { entry, campaign };
}

function campaignChunkPath() {
  const dir = join(ROOT, 'apps/game/dist', 'assets');
  const hits = readdirSync(dir).filter((f) => /^campaign-install-.*\.js$/.test(f));
  if (hits.length !== 1) {
    throw new Error(
      `expected exactly one dist/assets/campaign-install-*.js, found ${hits.length}`
      + `${hits.length > 0 ? `: ${hits.join(', ')}` : ''}.\n`
      + 'That chunk is where `CAMPAIGNS` lives. If rollup renamed it, fix the pattern here — do '
      + 'not fall back to scanning every chunk, because importing an arbitrary one to see what '
      + 'falls out is how a harness ends up measuring a module it did not mean to load.',
    );
  }
  return `assets/${hits[0]}`;
}

/**
 * Operation MODULES on disk, so a stale `dist/` cannot quietly shrink the run.
 *
 * `serve()` proves the origin is serving THIS checkout's `dist/`. It says
 * nothing about whether that `dist/` is this checkout's SOURCE — and the gap
 * is not hypothetical here, it is the normal state of `--no-build` on a tree
 * somebody is authoring operations in. The failure is silent and shaped exactly
 * like a pass: the table comes back with the operations that existed at build
 * time, every one of them resolves, the summary is green, and the operation
 * added an hour ago was never booted.
 *
 * `src/campaign/index.ts` globs `./operations/**\/*.ts` and throws on any module
 * without a default export, so every file under there IS an operation and a
 * count is a sound comparison without parsing a line of TypeScript.
 */
function operationModulesOnDisk() {
  const root = join(ROOT, 'src', 'campaign', 'operations');
  if (!existsSync(root)) return [];
  const out = [];
  for (const chapter of readdirSync(root, { withFileTypes: true })) {
    if (!chapter.isDirectory()) continue;
    for (const f of readdirSync(join(root, chapter.name))) {
      if (f.endsWith('.ts')) out.push(`${chapter.name}/${f}`);
    }
  }
  return out.sort();
}

async function readOperationTable(page, base) {
  const url = `${base}${campaignChunkPath()}`;
  // `domcontentloaded`, not `load`: the module graph is served over HTTP and is
  // importable the moment a document exists. Waiting for the title screen's own
  // boot would cost seconds for a table read that touches none of it.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  return page.evaluate(async (chunk) => {
    const m = await import(chunk);
    if (!Array.isArray(m.CAMPAIGNS)) {
      throw new Error(`${chunk} exports no CAMPAIGNS array — that is not the campaign chunk.`);
    }
    return m.CAMPAIGNS.map((c) => ({
      id: c.id,
      title: c.title,
      operations: c.operations.map((o) => ({
        id: o.id,
        index: o.index,
        title: o.title,
        primaryType: o.primaryType,
        archetype: o.archetype,
        parSec: o.parSec,
        map: {
          preset: o.map.preset, biome: o.map.biome, armies: o.map.armies,
          opening: o.map.opening, credits: o.map.credits,
        },
        rosterPlayer: [...o.roster.player],
        rosterAi: [...o.roster.ai],
        objectives: o.objectives.map((ob) => ({ id: ob.id, kind: ob.kind, title: ob.title })),
        /*
         * CAN A BRAIN THAT HAS NEVER READ AN OBJECTIVE EVEN ATTEMPT THIS WIN?
         *
         * Computed here, inside the page, because the trigger table lives in
         * the campaign chunk and is deliberately not projected out.
         *
         * Two condition kinds require a DECISION rather than a fight, and no
         * amount of attack-moving produces either:
         *
         *   `unitsInArea`      — walk this particular squad to this particular
         *                        patch of ground. The brain goes where enemies
         *                        are; it reaches an area only by coincidence.
         *   `structureCaptured` — needs an engineer, and the AI owns none: its
         *                        def has weight 0 and `buildUnits` filters
         *                        `weight <= 0`, which CLAUDE.md records as a
         *                        standing gap (task #27).
         *
         * Everything else falls out of attrition or the clock — `entityDead`,
         * `entityHpBelow` and `ownerCount` are what an army walking at a base
         * produces, and `elapsedSinceArmed` is a HOLD over other conditions, so
         * it inherits their reachability rather than blocking it.
         *
         * WITHOUT THIS, A `NO RESOLUTION` ROW IS AMBIGUOUS IN THE ONE WAY THAT
         * MATTERS: it reads identically whether the win path is unreachable on
         * the ground (a real defect, and the thing this tool exists to catch)
         * or simply not the sort of thing this driver can attempt (expected,
         * and no evidence of anything). Measured on chapter one, two of the
         * three non-resolutions were the second kind.
         */
        winPath: (() => {
          const BLIND = new Set(['unitsInArea', 'structureCaptured']);
          const leaves = (c, out) => {
            if (c === null || c === undefined) return out;
            if (c.on === 'all' || c.on === 'any') {
              for (const k of c.of) leaves(k, out);
            } else if (c.on === 'not') {
              leaves(c.of, out);
            } else {
              out.add(c.on);
            }
            return out;
          };
          const paths = [];
          for (const t of o.triggers) {
            const wins = t.then.some(
              (e) => e.do === 'endOperation' && e.result === 'win',
            );
            if (!wins) continue;
            const kinds = [...leaves(t.when, new Set())].sort();
            paths.push({ id: t.id, kinds, blind: !kinds.some((k) => BLIND.has(k)) });
          }
          return { paths, blindWinnable: paths.some((p) => p.blind) };
        })(),
        outcome: {
          annihilationWin: o.outcome.annihilationWin,
          assetLossDefeat: o.outcome.assetLossDefeat,
        },
      })),
    }));
  }, url);
}

/* ==========================================================================
 * THE PAGE SIDE
 * ========================================================================== */

/**
 * Wrap every method the campaign publishes through, and record what passes.
 *
 * Installed the instant the shell reports `'playing'` and before a single tick
 * is stepped by the harness, so the only window it cannot see is the handful of
 * ticks the live loop took between the boot and here — reported as `tick0` on
 * every row, because an operation that resolved inside it would be a real and
 * very loud finding rather than an artefact.
 */
const INSTALL_PROBE = () => {
  const shell = window.__vmShell;
  const rec = {
    beats: [], rows: [], rowLog: [], result: null, ended: null, doubleEnd: 0,
  };
  window.__vmOp = rec;

  const tickNow = () => shell.getGame()?.ctx.loop.tick ?? -1;
  const own = (name) => (typeof shell[name] === 'function' ? shell[name].bind(shell) : null);

  const origEnd = own('endMatch');
  const origResult = own('publishCampaignResult');
  const origRows = own('publishCampaignObjectives');
  const origBeat = own('playCampaignBeat');

  shell.endMatch = (result) => {
    const at = tickNow();
    const from = shell.getState();
    const out = origEnd(result);
    // ONLY IF IT TOOK. `endMatch` returns early when the shell is not playing
    // or paused and when a replay is open, so recording before the call would
    // stamp a resolution the game refused. A second one is counted rather than
    // dropped: two `endOperation` effects on one tick is an authoring fault the
    // trigger table can express and nothing else in the project would report.
    if (shell.getState() !== 'ended') return out;
    if (rec.ended === null) {
      rec.ended = { tick: at, won: result.won === true, reason: result.reason ?? '', from };
    } else {
      rec.doubleEnd++;
    }
    return out;
  };

  shell.publishCampaignResult = (r) => {
    rec.result = {
      tick: tickNow(),
      operationId: r.operationId,
      medal: r.medal,
      reason: r.reason ?? '',
      objectives: (r.objectives ?? []).map((o) => ({ id: o.id, kind: o.kind, status: o.status })),
    };
    return origResult(r);
  };

  shell.publishCampaignObjectives = (rows) => {
    rec.rows = rows.map((o) => ({ id: o.id, kind: o.kind, status: o.status, title: o.title }));
    rec.rowLog.push({ tick: tickNow(), state: rec.rows.map((o) => `${o.id}=${o.status}`).join(' ') });
    return origRows(rows);
  };

  if (origBeat !== null) {
    shell.playCampaignBeat = (e) => {
      rec.beats.push({
        tick: tickNow(),
        kind: e.kind ?? '?',
        speaker: e.speaker ?? '',
        text: (e.text ?? e.line ?? '').slice(0, 160),
      });
      return origBeat(e);
    };
  }

  // `__VM.hooks.simHz`, NOT `__VM.simHz`. It is a HOOK the host registers in
  // `Bootstrap.ts`, not a method on the handle, and `tools/shoot.mjs` reads it
  // the same way — CLAUDE.md's "Debugging" list names it flatly enough to send
  // you to the wrong one.
  return { tick0: tickNow(), simHz: window.__VM.hooks?.simHz?.() ?? null, state: shell.getState() };
};

/**
 * Hand slot 0 to the skirmish brain.
 *
 * `AiDirector.rebuild` skips any player that is `isHuman || isLocal`, and it is
 * called from `ai.system.ts` on ONE condition: `world.players.length` differing
 * from what it saw last tick. There is no other entry point — the director is
 * not on a global, only its read-only `snapshot()` is, through `__VM.hooks.ai`.
 * So the flags are flipped and then a Neutral ghost is seated to move the count,
 * which makes the next tick rebuild the brain list with slot 0 in it.
 *
 * THE GHOST STAYS. Removing it would move the count a second time and rebuild
 * again for no gain; leaving it costs one Neutral seat owning nothing, which is
 * the shape `ScenarioBuilder.gaia` already puts in every match and which every
 * consumer in the tree — `AiDirector.rebuild`, `Viability`, `Shell.pollOutcome`,
 * `buildResult`'s opponent chip — skips by name. It is printed on every run so
 * it is never an invisible passenger.
 *
 * `aiDifficulty` is forced to Normal because the flip makes slot 0 eligible for
 * `AI_DIFFICULTY[].resourceBonus`, which `ai.system.ts` hands to `Economy` on
 * every rebuild. Normal is 1.0, so the player's seat keeps exactly the income a
 * player's seat has. Any other rung would quietly re-scale the economy of the
 * side being measured.
 *
 * THE RETURN VALUE IS THE FALSIFIER AND THE CALLER MUST LOOK AT IT. If no brain
 * for player 0 appears, every number after this point is a measurement of an
 * unattended seat wearing the label of a played one — the vacuous metric this
 * repo has already published three times.
 */
const HAND_OVER_SEAT_ZERO = () => {
  const world = window.__vmShell.getGame().ctx.world;
  const p0 = world.players[0];
  const before = { isHuman: p0.isHuman, isLocal: p0.isLocal, difficulty: p0.aiDifficulty };
  p0.isHuman = false;
  p0.isLocal = false;
  p0.aiDifficulty = 1;
  const n = world.players.length;
  // Faction.Neutral is 0. A `const enum` is erased from the bundle, so there is
  // nothing to import here and the literal is the only form available; Gaia is
  // seated the same way, and `rebuild` skips Neutral explicitly.
  world.addPlayer(0, 'Harness Ghost', false, false);
  return { before, seated: world.players.length === n + 1, players: world.players.length };
};

/**
 * Every tag the operation stamped, with what is left of it.
 *
 * READ OFF THE GAME'S OWN `TagRegistry`, not off a second walk of the store.
 * `campaign-install.ts` exports `armedSession()`, whose `tags` satisfies
 * `CampaignTagSet` — and `snapshot(store, localOf)` already prunes to LIVE,
 * non-`PendingDestroy` handles, which is exactly the set every `entityDead` and
 * `entityHpBelow` condition is evaluated against. Handing it `localOf = id => id`
 * turns the save codec's index map into an identity and gives back the raw
 * handles. The alternative — scanning the store for the defs the layout placed
 * — would be a second definition of "which entity is the tap", and a report
 * that disagreed with the trigger table would be worse than no report.
 *
 * THIS IS THE LINE THAT MAKES A `NO RESOLUTION` ROW ACTIONABLE. "The operation
 * did not end in 39 minutes" is a complaint. "The tap is alive at 100% of its
 * health after 39 minutes, having never been shot, while the seat that owns it
 * has been ground from 142 units to 49" is a diagnosis, and it names the
 * mechanism rather than the symptom.
 */
const TAG_CENSUS = (chunk) => import(chunk).then((m) => {
  const s = m.armedSession?.() ?? null;
  if (s === null || s.tags === undefined) return null;
  const store = window.__vmShell.getGame().ctx.world.store;
  const rows = s.tags.snapshot(store, (id) => id);
  return rows.map((r) => {
    let weakest = -1;
    const owners = [];
    for (const id of r.ids) {
      const i = store.index(id);
      const frac = store.maxHp[i] > 0 ? store.hp[i] / store.maxHp[i] : -1;
      if (weakest < 0 || frac < weakest) weakest = frac;
      if (!owners.includes(store.owner[i])) owners.push(store.owner[i]);
    }
    return { tag: r.tag, alive: r.ids.length, weakest, owners };
  });
});

/**
 * What the world looks like right now. One round trip, allocations included.
 *
 * `store.aliveCount` IS NOT AN ARMY COUNT AND MUST NOT BE PRINTED AS ONE. It is
 * every live entity in the store, and on an arid map most of them belong to
 * Gaia — rocks, scatter, wrecks — so the first version of this report opened at
 * 237 "entities" before either side had built anything. The number that answers
 * "how heavy did this operation get", which is the number `spawnUnits` cares
 * about when it runs out of entity budget, is the whole store; the number that
 * answers "is anyone fighting" is the per-seat split. Both are here, and the
 * report says which is which.
 */
const SAMPLE = () => {
  const game = window.__vmShell.getGame();
  const world = game.ctx.world;
  const st = world.store;
  const owned = new Array(world.players.length).fill(0);
  for (let a = 0; a < st.aliveCount; a++) owned[st.owner[st.alive[a]]]++;
  // Faction.Neutral is 0 — Gaia and the harness ghost. Excluded so the figure
  // is "entities belonging to somebody who is playing".
  let playing = 0;
  for (let i = 0; i < world.players.length; i++) if (world.players[i].faction !== 0) playing += owned[i];
  return {
    tick: game.ctx.loop.tick,
    alive: st.aliveCount,
    owned,
    playing,
    credits: Math.round(world.players[0].credits),
    state: window.__vmShell.getState(),
    ended: window.__vmOp.ended,
  };
};

/* ==========================================================================
 * ONE OPERATION
 * ========================================================================== */

async function runOperation(page, server, base, op, { errors, faults }, chunkUrl) {
  const budgetSec = (MINUTES !== null ? MINUTES : Math.max(20, Math.ceil(op.parSec / 60) * 3)) * 60;
  const budgetTicks = Math.round(budgetSec * TICKS_PER_SECOND);

  console.log(`\n=== ${op.id} — ${op.title} ===`);
  console.log(`  ${op.primaryType}/${op.archetype}   ${op.map.armies} armies on `
    + `${op.map.preset}/${op.map.biome}   opening ${op.map.opening}   bank ${op.map.credits}`);
  console.log(`  authored par ${op.parSec} s (${mmss(op.parSec)})   budget ${mmss(budgetSec)} of sim `
    + `(${budgetTicks} ticks, slice ${SLICE})`);
  console.log(`  outcome policy: annihilationWin ${op.outcome.annihilationWin}, `
    + `assetLossDefeat ${op.outcome.assetLossDefeat}`);

  // A FRESH DOCUMENT PER OPERATION, never a re-arm in the page the last one
  // used. `Shell.startOperation` disarms first and would probably survive it,
  // but the shell also holds `lastReplay`, a campaign result, a suppressed
  // progression latch and a settings blob written by the previous operation's
  // hardware calibration. `replay-probe.mjs` learned the same lesson the
  // expensive way between its phases C and D; a `goto` is the honest reset.
  server.assertAlive(`operation ${op.id}`);
  const wall0 = Date.now();
  await page.goto(`${base}?campaign=${op.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__VM?.ready === 'function', null, { timeout: 180_000 });
  await page.evaluate(() => window.__VM.ready());
  await page.waitForFunction(
    () => window.__vmShell?.getState?.() === 'playing', null, { timeout: 180_000 },
  );

  const armed = await page.evaluate(() => window.__vmShell.activeOperationId?.() ?? null);
  if (armed !== op.id) {
    console.log(`  ARMED ${armed ?? '(nothing)'} — expected ${op.id}. `
      + '`?campaign=` is parsed in main.ts and handed to the shell; a null here means '
      + '`startOperation` refused the id or the flag never reached it.');
    return { op, resolved: false, fault: 'not-armed', wallSec: (Date.now() - wall0) / 1000 };
  }

  // FREEZE FIRST, THEN LET THE SHELL FINISH. `Shell.bootGame` writes the bank
  // after `await nextFrames(6)`, and those are RENDER frames, which keep
  // arriving while the loop is paused — so the bank still lands, it just lands
  // without the simulation having run on ahead of it. Pausing later instead
  // means two runs start from different ticks and the bank is reset under a
  // match already in progress; both read as nondeterminism and neither is.
  // `tools/playtest.mjs` records the same pair of traps.
  await page.evaluate(() => window.__vmShell.getGame().setPaused(true));
  await page.evaluate(() => window.__VM.waitFrames(12));

  const probe = await page.evaluate(INSTALL_PROBE);
  if (probe.simHz !== TICKS_PER_SECOND) {
    throw new Error(
      `__VM.hooks.simHz() reports ${probe.simHz} and this file assumes ${TICKS_PER_SECOND}. Every `
      + 'clock in the report is a tick count times that number, so they would all be wrong together '
      + 'and none of them would look wrong. A null means the host registered no simHz hook, which '
      + 'is the same problem with a different cause. Fix TICKS_PER_SECOND here, or the hook there.',
    );
  }
  console.log(`  took the clock at sim tick ${probe.tick0} `
    + `(${mmss(opSeconds(probe.tick0))} of operation time ran on the live loop before this)`);

  /*
   * ADVANCE TO A FIXED TICK BEFORE ANYTHING ELSE TOUCHES THE WORLD, AND THIS IS
   * NOT TIDINESS — IT IS THE DIFFERENCE BETWEEN A REPEATABLE RUN AND A COIN.
   *
   * `probe.tick0` is however many ticks the live rAF loop got through between
   * `?campaign=` and the pause: a wall-clock quantity, 35 on one run of this
   * file and 37 on the next. The ticks themselves are harmless — a fixed step
   * is a fixed step whoever drives it, so the world at the pause is identical
   * either way. What is NOT harmless is that the handover below happens ON that
   * tick. `world.addPlayer` makes `ai.system.ts` rebuild the brain list, the
   * new brain for seat 0 is constructed there, and `AiBrain` is slow-ticked and
   * phase-offset from where it starts — so a two-tick difference in WHEN it is
   * born moves every decision it makes for the rest of the match.
   *
   * MEASURED 2026-08-19, twice, same build (dist byte-identical before and
   * after), same command, `--minutes=5` on `soviets.01.first-tap`:
   *
   *     tick0 35  ->  t.derricksLost tick 6807 (3:46.9), seats [54/133] at 5:01
   *     tick0 37  ->  t.derricksLost tick 7550 (4:11.6), seats [54/142] at 5:01
   *
   * 743 ticks apart on one trigger. An earlier version of this file claimed in
   * its own header that "two runs of one build land on the same tick"; they did
   * not, and a marginal operation would have resolved on some runs and reported
   * NO RESOLUTION on others with nothing on screen to say which had happened.
   *
   * REFUSE RATHER THAN CATCH UP. If the boot was slow enough to pass the pin,
   * advancing is no longer available and quietly running from wherever we
   * landed is the defect this block exists to remove.
   */
  const HANDOVER_TICK = 120;
  if (probe.tick0 > HANDOVER_TICK) {
    throw new Error(
      `the live loop reached tick ${probe.tick0} before the harness could pause it, past the `
      + `${HANDOVER_TICK}-tick pin. Every run would be measured from a different tick and would `
      + 'not be comparable with any other. Raise HANDOVER_TICK — it costs only a fixed prefix of '
      + 'unattended sim — or find out what made the boot that slow.',
    );
  }
  await page.evaluate(
    (t) => { window.__VM.advanceTicks(t - window.__vmShell.getGame().ctx.loop.tick); },
    HANDOVER_TICK,
  );

  let handover = null;
  if (DRIVE_AI) {
    handover = await page.evaluate(HAND_OVER_SEAT_ZERO);
    if (!handover.seated) {
      throw new Error('could not seat the ghost player — `world.addPlayer` returned without growing '
        + 'the table, which means MAX_PLAYERS is full. The AI rebuild cannot be triggered.');
    }
    // Two ticks: one for `ai.system.ts` to notice the count moved and rebuild,
    // one for the new brain to publish an intent to `__VM.hooks.ai`.
    await page.evaluate(() => window.__VM.advanceTicks(2));
    const brains = await page.evaluate(() => (window.__VM.hooks.ai?.() ?? []).map((x) => x.player));
    if (!brains.includes(0)) {
      throw new Error(
        `seat 0 was flipped to non-human but no brain answers for it — __VM.hooks.ai() reports `
        + `[${brains.join(', ')}]. Everything after this would be a measurement of an UNATTENDED `
        + 'seat printed under the word "AI". Refusing to run it. Either `AiDirector.rebuild` no '
        + 'longer keys off `world.players.length`, or the ai system is off (`?ai=off`).',
      );
    }
    console.log(`  seat 0 handed to a Normal skirmish brain; brains now [${brains.join(', ')}], `
      + `${handover.players} seats incl. one Neutral ghost`);
    if (op.rosterPlayer.join('|') !== op.rosterAi.join('|')) {
      console.log('  WARNING: this operation\'s player and AI rosters DIFFER, so the flip above put '
        + 'slot 0 on the AI list.');
      console.log(`           player [${op.rosterPlayer.join(', ') || '—'}]  `
        + `ai [${op.rosterAi.join(', ') || '—'}] — the brain is playing a different tech tree `
        + 'from the one a player gets, and this run says nothing about the player\'s.');
    }
  } else {
    console.log('  seat 0 LEFT UNATTENDED (--no-ai-player). Nothing plays the player. Only the '
      + 'authored LOSS path can resolve.');
  }

  /* -- the drive ---------------------------------------------------------- */

  let peakAlive = 0;
  let peakPlaying = 0;
  let last = await page.evaluate(SAMPLE);
  const startTick = last.tick;
  let nextReport = 0;

  while (last.ended === null && last.tick - startTick < budgetTicks) {
    await page.evaluate((n) => window.__VM.advanceTicks(n), SLICE);
    last = await page.evaluate(SAMPLE);
    peakAlive = Math.max(peakAlive, last.alive);
    peakPlaying = Math.max(peakPlaying, last.playing);
    const sec = opSeconds(last.tick);
    if (sec >= nextReport) {
      nextReport = Math.floor(sec / 60) * 60 + 60;
      console.log(`    sim ${rpad(mmss(sec), 7)}  tick ${rpad(last.tick, 6)}  `
        + `store ${rpad(last.alive, 4)}  seats [${last.owned.join('/')}]  `
        + `seat0 cr ${rpad(last.credits, 6)}`);
    }
    // A page that died mid-drive would otherwise loop to the budget and report
    // "no resolution", which is the wrong finding attached to the right run.
    if (last.state !== 'playing' && last.ended === null) {
      console.log(`    shell left 'playing' for '${last.state}' with no endMatch recorded.`);
      break;
    }
  }

  const rec = await page.evaluate(() => window.__vmOp);
  const census = await page.evaluate(TAG_CENSUS, chunkUrl);
  const wallSec = (Date.now() - wall0) / 1000;

  const showCensus = () => {
    if (census === null) {
      console.log('  tags: no armed session answered — `armedSession()` was null, so the operation '
        + 'was disarmed before this read.');
      return;
    }
    console.log('  tags at the end, from the operation\'s own TagRegistry');
    for (const t of census) {
      console.log(`    ${pad(t.tag, 12)} ${rpad(t.alive, 3)} alive   `
        + `weakest ${t.weakest < 0 ? '—' : `${(t.weakest * 100).toFixed(1)}%`}   `
        + `owned by seat(s) [${t.owners.join(', ') || '—'}]`);
    }
  };

  /**
   * ON BOTH EXIT PATHS, AND THE ONE IT WAS MISSING FROM WAS THE ONE THAT NEEDS
   * IT. This lived below the resolved branch's `return`, so a run that ended in
   * `NO RESOLUTION` — the row whose whole job is to say WHY an operation did
   * not finish — printed no error tally at all.
   */
  const showProblems = () => {
    if (faults.length > 0) {
      console.log(`  ${faults.length} console error/warning(s) from the page, `
        + `${new Set(faults).size} distinct. A '[campaign] … spawn' line here means a wave `
        + 'arrived short or empty, which is an authoring fault and not a harness one.');
    }
    if (errors.length > 0) console.log(`  ${errors.length} page error(s), first: ${errors[0]}`);
  };

  /* -- the report --------------------------------------------------------- */

  if (rec.ended === null) {
    console.log(`\n  NO RESOLUTION in ${mmss(opSeconds(last.tick))} of operation time.`);
    const wp = op.winPath ?? { paths: [], blindWinnable: true };
    for (const p of wp.paths) {
      console.log(`    win path ${p.id}: ${p.kinds.join(' + ') || '(none)'}`
        + `  — ${p.blind ? 'attrition can reach this' : 'NEEDS A DECIDING PLAYER'}`);
    }
    if (wp.blindWinnable) {
      console.log('  THAT IS THE FINDING, not a harness failure: an authored win path is the sort');
      console.log('  an army walking at the enemy can satisfy, and 39 minutes of it did not. The');
      console.log('  lose path did not fire either. Check that the objective is on the seat the');
      console.log('  trigger names, that the layout put it where a ground army can reach, and that');
      console.log('  nothing else has to happen first.');
    } else {
      console.log('  EXPECTED, AND NOT EVIDENCE OF ANYTHING. Every authored win path here needs a');
      console.log('  deciding player — a squad walked somewhere, or a structure captured — and this');
      console.log('  driver is the skirmish brain, which has never read an objective and owns no');
      console.log('  engineer. It cannot ATTEMPT this win, so failing to reach it says nothing about');
      console.log('  the ground. What the run still proves is below: the timeline fired, and the tags');
      console.log('  are alive on the seats the triggers name.');
    }
    showCensus();
    printTimeline(rec);
    showProblems();
    return {
      op, resolved: false, fault: 'no-resolution', tick: last.tick, peakAlive, peakPlaying,
      wallSec, rows: rec.rows,
    };
  }

  const resSec = opSeconds(rec.ended.tick);
  const ratio = resSec / op.parSec;
  console.log(`\n  RESOLVED  ${rec.ended.won ? 'WIN ' : 'LOSS'}  at sim tick ${rec.ended.tick}`
    + `  =  ${mmss(resSec)} of operation time   (harness wall clock ${mmss(wallSec)})`);
  if (rec.ended.reason !== '') console.log(`  loss names objective '${rec.ended.reason}'`);
  if (rec.doubleEnd > 0) {
    console.log(`  ${rec.doubleEnd} FURTHER endMatch call(s) after the first — an operation that `
      + 'ends twice is an authoring fault.');
  }

  const rows = rec.result?.objectives ?? rec.rows;
  for (const o of rows) console.log(`    ${pad(o.kind, 10)} ${pad(o.id, 14)} ${o.status}`);
  if (rec.result === null) {
    console.log('    (no campaign result was published — the match was ended by a SHIPPED outcome '
      + 'rule, not by an');
    console.log('     `endOperation` effect, so there is no medal and the rows above are the last '
      + 'ones the panel saw.)');
  } else {
    const NAMES = ['none', 'bronze', 'silver', 'gold'];
    console.log(`    medal ${rec.result.medal} (${NAMES[rec.result.medal] ?? '?'})`);
  }
  console.log(`    peak ${peakAlive} entities in the store, ${peakPlaying} of them owned by a `
    + `playing seat, sampled every ${SLICE} ticks (${(SLICE / TICKS_PER_SECOND).toFixed(1)} s)`);
  // A RATIO AGAINST PAR IS ONLY MEANINGFUL FOR A WIN, and the first version of
  // this printed "1.58x the authored par" underneath the word LOSS on a real
  // run. `parSec` is how long COMPLETING the operation should take; the time at
  // which somebody else finished you off is not a slower version of that, it is
  // a different quantity, and putting the two on one line is precisely the
  // misreading the rest of this file exists to prevent.
  if (rec.ended.won) {
    console.log(`    ${ratio.toFixed(2)}x the authored par — ${Math.round(resSec)} s measured `
      + `against ${op.parSec} s authored.`);
    console.log('    READ THAT RATIO AS "how long a brain that never read the briefing took", and '
      + 'as nothing else.');
  } else {
    console.log(`    NO RATIO. ${op.parSec} s of par is how long WINNING should take; this run did `
      + 'not win, so there is nothing to compare.');
  }
  showCensus();
  printTimeline(rec);
  showProblems();

  return {
    op, resolved: true, won: rec.ended.won, tick: rec.ended.tick, sec: resSec, ratio,
    medal: rec.result?.medal ?? null, rows, peakAlive, peakPlaying, wallSec,
    doubleEnd: rec.doubleEnd,
  };
}

/**
 * Every authored beat and every objective transition, with the tick it landed
 * on.
 *
 * This is the half of the output that survives the caveat in the header intact.
 * The resolution time is one non-player's number; a relief wave that never
 * fires, a secondary failed inside the first ten seconds, or a `dialogue` line
 * that arrives after the operation has already ended are facts about the
 * TRIGGER TABLE, and they are true whoever is holding the mouse.
 */
function printTimeline(rec) {
  if (rec.beats.length === 0 && rec.rowLog.length <= 1) return;
  console.log('  timeline');
  const lines = [];
  for (const b of rec.beats) {
    lines.push({
      tick: b.tick,
      text: `${pad(b.kind, 10)} ${b.speaker !== '' ? `${b.speaker}: ` : ''}${b.text}`,
    });
  }
  // The first row publication is the panel's initial state rather than a
  // transition, so it is dropped: printing it makes every operation look as
  // though something happened on tick one.
  for (let i = 1; i < rec.rowLog.length; i++) {
    lines.push({ tick: rec.rowLog[i].tick, text: `${pad('objectives', 10)} ${rec.rowLog[i].state}` });
  }
  lines.sort((a, b) => a.tick - b.tick);
  for (const l of lines) {
    console.log(`    ${rpad(mmss(opSeconds(l.tick)), 7)}  tick ${rpad(l.tick, 6)}  ${l.text}`);
  }
}

/* ==========================================================================
 * THE RUN
 * ========================================================================== */

const CAVEAT = [
  '############################################################################',
  '#  NOT A PAR TIME. NOT A QA NUMBER. NOT AN ESTIMATE OF ONE.                #',
  '#                                                                          #',
  '#  Nobody plays the operation here. Slot 0 is handed to the ordinary       #',
  '#  skirmish brain, which has never read an objective, does not know what   #',
  '#  it is being asked to destroy, and cannot be told to protect anything.   #',
  '#  It builds a base and attacks whoever is nearest; the operation resolves #',
  '#  when that blind advance happens to satisfy an authored trigger.         #',
  '#                                                                          #',
  '#  So the time below is neither a floor nor a ceiling on a human\'s: an     #',
  '#  informed player drives straight at the objective and is faster, and is  #',
  '#  also better at every fight on the way. Two errors, opposite signs,      #',
  '#  neither bounded.                                                        #',
  '#                                                                          #',
  '#  What it DOES prove: the operation is completable at all from the        #',
  '#  authored start on the authored ground, and the trigger timeline is      #',
  '#  real. A NO RESOLUTION row is a finding about the operation, not about   #',
  '#  this tool.                                                              #',
  '############################################################################',
].join('\n');

if (BUILD) await build(ROOT, { log: console.log });

const server = await serve({ root: ROOT, mode: 'preview', portHint: PORT_HINT, log: console.log });
const BASE = server.origin;

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// SMALL ON PURPOSE. `advanceTicks` presents once per slice and the harness reads
// no pixels at all, so every one of those presents is pure cost. It is also the
// reason this tool can say nothing whatever about how an operation LOOKS —
// `npm run shots` photographs no operation either, and neither of them is the
// gap the other closes.
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(180_000);
page.setDefaultNavigationTimeout(180_000);
const errors = [];
page.on('pageerror', (e) => {
  const text = e.message.slice(0, 300);
  errors.push(text);
  console.log(`  [pageerror] ${text}`);
});

/**
 * THE PAGE'S CONSOLE, NOT ONLY ITS EXCEPTIONS — AND THIS IS NOT TIDINESS.
 *
 * `pageerror` fires for a thrown Error and for nothing else. The campaign
 * runtime's loudest alarm is not a throw: `Session`'s `onSpawnFault` hook calls
 * `console.error`, and its own comment says why — both sim callers of
 * `spawnUnit` treat a refused spawn as a silent `continue`, so "a reinforcement
 * wave that quietly arrives empty is the most plausible way an operation
 * becomes unwinnable with every test green".
 *
 * That is the exact failure this harness exists to surface, and without this
 * listener it is written to a console in a headless browser nobody is reading.
 * Measured, not hypothetical: a six-minute run of `soviets.01.first-tap` on
 * 2026-08-19 reported a `relief` tag with ONE live entity against a wave
 * authored at four, and the line that says which of those two numbers was
 * spawned went nowhere.
 *
 * DEDUPED BY TEXT. A fault raised from a per-tick effect would otherwise be the
 * whole log; the count is kept so "once" and "nine hundred times" stay
 * distinguishable.
 */
const faults = [];
const faultSeen = new Set();
page.on('console', (msg) => {
  const type = msg.type();
  if (type !== 'error' && !(type === 'warning' && msg.text().includes('[campaign]'))) return;
  const text = msg.text().slice(0, 300);
  faults.push(text);
  if (faultSeen.has(text)) return;
  faultSeen.add(text);
  console.log(`  [console.${type}] ${text}`);
});

console.log(`\n${CAVEAT}\n`);

const table = await readOperationTable(page, BASE);
const all = table.flatMap((c) => c.operations);
const fp = buildFingerprint();
console.log(`campaign table: ${table.length} chapter(s), ${all.length} operation(s)`);
console.log(`build driven: entry ${fp.entry}  campaign ${fp.campaign}`);
console.log('  Two runs are comparable only if BOTH names match. They are content hashes.');

const onDisk = operationModulesOnDisk();
if (onDisk.length !== all.length) {
  console.log(`\n  !! THE BUILT CAMPAIGN IS NOT THIS SOURCE TREE'S. ${onDisk.length} operation `
    + `module(s) under src/campaign/operations/, ${all.length} in the bundle being driven.`);
  console.log(`     on disk: ${onDisk.join(', ')}`);
  console.log(`     in dist: ${all.map((o) => o.id).join(', ') || '(none)'}`);
  console.log('     `serve()` proves the origin serves THIS checkout\'s dist/; it cannot prove the '
    + 'dist/ is this checkout\'s src/.');
  console.log('     Drop --no-build, or know exactly which build you are measuring.');
}

const wanted = ONLY === null ? all : all.filter((o) => o.id === ONLY);
if (wanted.length === 0) {
  await browser.close();
  server.stop();
  console.log(`\nno operation '${ONLY}'. Known: ${all.map((o) => o.id).join(', ') || '(none)'}`);
  process.exit(1);
}

const results = [];
let thrown = null;
try {
  for (const op of wanted) {
    errors.length = 0;
    faults.length = 0;
    faultSeen.clear();
    results.push(await runOperation(
      page, server, BASE, op, { errors, faults }, `${BASE}${campaignChunkPath()}`,
    ));
  }
} catch (err) {
  thrown = err;
}

await browser.close();
server.stop();

/* -- summary --------------------------------------------------------------- */

console.log('\n===== SUMMARY =====');
console.log(`${pad('operation', 26)} ${rpad('par', 7)} ${rpad('measured', 9)} ${rpad('ratio', 7)} `
  + `${pad('outcome', 9)} ${rpad('medal', 5)} ${rpad('army', 5)} ${rpad('wall', 7)}`);
for (const r of results) {
  if (!r.resolved) {
    console.log(`${pad(r.op.id, 26)} ${rpad(mmss(r.op.parSec), 7)} ${rpad('—', 9)} ${rpad('—', 7)} `
      + `${pad(r.fault === 'not-armed' ? 'NOT ARMED' : 'NO END', 9)} ${rpad('—', 5)} `
      + `${rpad(r.peakPlaying ?? '—', 5)} ${rpad(mmss(r.wallSec), 7)}`);
    continue;
  }
  // The ratio column is blank on a loss for the reason stated at its other
  // printing site: par measures winning, and a loss time is not a slow win.
  console.log(`${pad(r.op.id, 26)} ${rpad(mmss(r.op.parSec), 7)} ${rpad(mmss(r.sec), 9)} `
    + `${rpad(r.won ? `${r.ratio.toFixed(2)}x` : '—', 7)} ${pad(r.won ? 'win' : 'loss', 9)} `
    + `${rpad(r.medal ?? '—', 5)} ${rpad(r.peakPlaying, 5)} ${rpad(mmss(r.wallSec), 7)}`);
}

const unresolved = results.filter((r) => !r.resolved);
if (unresolved.length > 0) {
  console.log(`\n${unresolved.length} operation(s) DID NOT RESOLVE:`);
  for (const r of unresolved) console.log(`  ${r.op.id} — ${r.fault}`);
  const actionable = unresolved.filter((r) => (r.op.winPath?.blindWinnable ?? true));
  const expected = unresolved.filter((r) => !(r.op.winPath?.blindWinnable ?? true));
  if (expected.length > 0) {
    console.log(`  ${expected.length} of those are EXPECTED and are NOT findings: `
      + `${expected.map((r) => r.op.id).join(', ')}.`);
    console.log('  Every authored win path there needs a deciding player — a squad walked to a');
    console.log('  place, or a structure captured — and this driver can do neither.');
  }
  if (actionable.length > 0) {
    console.log(`  ${actionable.length} IS a real signal about the ground: `
      + `${actionable.map((r) => r.op.id).join(', ')}.`);
    console.log('  A win path there is the sort an army walking at the enemy can satisfy, and it');
    console.log('  was not. Check that the objective is on the seat the trigger names, that the');
    console.log('  layout put it somewhere a ground army can reach, and that nothing else has to');
    console.log('  happen first.');
  }
}

console.log(`\n${CAVEAT}`);

if (thrown !== null) {
  console.log(`\nHARNESS FAILED: ${thrown.message}`);
  process.exit(2);
}
process.exit(unresolved.length === 0 && results.length > 0 ? 0 : 1);

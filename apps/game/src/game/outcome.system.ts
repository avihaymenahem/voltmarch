/**
 * ============================================================================
 * src/game/outcome.system.ts — THE MATCH BEGINS AND ENDS, AND SAYS SO
 * ============================================================================
 * Discovered by glob from `src/game/Systems.ts`. Three jobs, all of them holes
 * that were open in the shipped game. This module owns the MATCH LIFECYCLE on
 * the bus: it is the only emitter of `'match:started'` and of `'match:ended'`,
 * and both fire exactly once per match no matter which route the match was
 * entered or left by.
 *
 * 0. THE OTHER EMITTER THAT NEVER EXISTED
 * ---------------------------------------
 * `'match:started'` had the same shape of hole as `'match:ended'` and THREE
 * subscribers waiting on it: `audio.system.ts` (the per-match announcer reset),
 * `MissionTracker` (the bus half of the progression lifecycle) and `Hud.ts`
 * (faction theme, credit counter, toast stack). `src/progression/types.ts` even
 * carried a comment saying nothing emitted it. The measurable casualty was the
 * announcer: `audio.system.ts` arms its opening "Battle control online" line by
 * setting `matchStartAt` in that handler and nowhere else, so with the event
 * missing the flag stayed at its module-level `-1` for the whole session and
 * the line NEVER played, in any match, ever.
 *
 * The emit is edge-triggered on the shell entering `'playing'` from a state
 * that is not part of an already-running match, so every route in — lobby,
 * restart, tutorial, a restored save — produces exactly one event, and coming
 * back from the pause menu or the options screen produces none.
 *
 * It fires AFTER `Shell.startMatch` has already called
 * `progression.beginMatch` with the richer payload it can assemble (difficulty,
 * the resolved faction). `EvMatchStarted` carries neither, so `MissionTracker`'s
 * bus handler defers to a match that is already open rather than restarting it
 * — see the note there. Same principle as the end: the shell's ordering is
 * load-bearing and the bus is additive to it.
 *
 * 1. THE EMITTER THAT NEVER EXISTED
 * ---------------------------------
 * `'match:ended'` is declared in `GameEvents`, and TWO modules subscribe to it:
 * `audio.system.ts` (the "mission accomplished" / "mission failed" line and the
 * win/loss music sting) and `MissionTracker` (end-of-match progression rules).
 * NOTHING HAS EVER EMITTED IT. Every match in the history of this build has
 * ended in silence — no announcer, no sting — and both files carry a comment
 * saying so. `src/shell/Shell.ts:919` even names the fix: "a real victory module
 * can call it from a `match:ended` handler". This is that module, from the other
 * direction: it emits the event the shell never did.
 *
 * The emit happens AFTER `shell.endMatch()` returns, deliberately. `endMatch`
 * documents its own internal ordering as load-bearing (latch the win, complete
 * objectives, push rewards, THEN construct the end screen which drains them),
 * and `MissionTracker.endMatch` is idempotent, so firing the bus afterwards adds
 * the announcer and the music without perturbing a single step of the
 * progression path.
 *
 * There is also a WATCHER: any end reached by some other route — the shell's own
 * `pollOutcome`, a console `__vmShell.endMatch()`, a future campaign trigger —
 * is noticed on the next frame and emitted exactly once. The event is not
 * allowed to depend on who won the race to detect the outcome.
 *
 * 2. THE UNPLAYABLE STATE THAT WAS NEITHER A LOSS NOR A GAME
 * ----------------------------------------------------------
 * `Shell.pollOutcome` declares defeat at ZERO living assets and nothing else. A
 * player with four harvesters and no base is not at zero. They cannot build,
 * cannot fight, cannot lose and cannot win — the session just stops meaning
 * anything, with no message. (The reported route in was selling the Construction
 * Yard by accident; `sim/Production.ts` now refuses that specific sell, but a
 * bombed-flat base reaches the identical state and no guard can prevent that
 * one.) So:
 *
 *   STRANDED  — assets, but nothing that can build. WARNED, not ended. An army
 *               with no base can still walk into the enemy's and win, and taking
 *               that away would be a worse bug than the one being fixed.
 *   BEATEN    — nothing that can build AND nothing on the field but harvesters.
 *               There is no sequence of inputs that changes the result. Held
 *               for `beatenGraceSeconds` (so a mid-deploy blink cannot trigger
 *               it), then the match resolves and says which way.
 *
 * The predicates live in `src/sim/Viability.ts` and are the SAME ones the sell
 * guard runs. One definition of "can this player still play", or the two rules
 * drift and you get a sell refused for a state the match will not end on.
 *
 * 3. THE MATCH THAT WOULD NOT FINISH
 * ----------------------------------
 * Reported as *"i killed every visible building and troops and game didnt
 * finish"*. `isBeaten` is this module's VICTORY test as well as its defeat
 * test, and it was reading `canContest` — which counted every non-harvester
 * unit an opponent owned, including one carrying `EntityFlag.Garrisoned`. That
 * flag is the only bit a live unit can hold that makes it BOTH undrawn
 * (`RenderBridge.HIDDEN_MASK`) and untargetable (`TARGETABLE_REJECT_MASK`), so
 * a squad indoors kept the match open against a player who had, quite
 * literally, killed everything they could see. The argument for the fix and
 * for what it costs is `surveyViability` §HELD; the reproduction is
 * `tests/match-unfinishable.spec.ts`.
 *
 * 4. TEAMS, AND WHY THIS FILE NEEDED ALMOST NOTHING
 * -------------------------------------------------
 * Every loop below already skipped a seat allied to the local player, so the
 * victory rule has always read "every seat NOT ON MY SIDE has been beaten" —
 * it simply could not be told from "every other seat" while `allyMask` had no
 * writer. `src/game/Teams.ts` gave it one, and the five inline copies of
 * "not Gaia and not allied to me" became one `isHostileSeat` at the same time,
 * because a rule that is finally falsifiable is a rule whose copies can finally
 * disagree.
 *
 * THE DEFEAT RULE IS DELIBERATELY UNCHANGED: A PLAYER IS BEATEN WHEN THEY ARE
 * BEATEN, NOT WHEN THEIR TEAM IS. It is tempting to keep a wiped-out player in
 * the match while an ally still holds a base, and it is wrong twice over:
 *
 *   - `Viability` IS PER PLAYER AND MUST STAY THAT WAY. The sell guard inside
 *     `simTick` asks the identical question about the identical survey, and
 *     nothing in this game is shared across a team — not the bank, not the
 *     queues, not a single unit of control. "Your ally owns a Construction
 *     Yard" would let a player sell their last one into a state where they can
 *     neither build nor act, which is precisely the soft lock `Viability`'s own
 *     header exists to make impossible.
 *   - THE ALTERNATIVE IS A FEATURE, NOT A RULE. Watching your ally finish the
 *     match is spectating: a camera with no owner, a HUD with no production and
 *     an input layer whose every command is refused by ownership. That is a
 *     screen, and this is a poll.
 *
 * So an ally's collapse ends nothing, your own ends your match, and the last
 * enemy team standing wins. `tests/teams.spec.ts` drives all three.
 *
 * TWO NEIGHBOURS THAT LOOK LIKE THE SAME BUG AND ARE NOT, so nobody re-derives
 * them from this header:
 *
 *   - AIRCRAFT ARE COUNTED, and always were. There is no `EntityKind.Aircraft`
 *     — `UnitDef.kind` is typed `Infantry | Vehicle` and every flyer is a
 *     `Vehicle` carrying `Locomotor.Air` — so `Viability`'s `UNIT_KINDS` sees
 *     the whole roster. An enemy down to gunships is NOT declared beaten.
 *   - WHAT AN ENEMY DOWN TO GUNSHIPS *IS*, is unkillable by an army with no
 *     anti-air, because `WeaponDef.canTargetAir` defaults to FALSE by design
 *     (see the note on the field). That hangs a match too, and it is a content
 *     question about AA availability rather than anything this file or
 *     `Viability` can answer. Do not "fix" it here.
 *
 * WHY A RENDER-PHASE SYSTEM AND NOT A `simTick`
 * ---------------------------------------------
 * It calls into the shell and the DOM and it needs no determinism: it writes
 * nothing the sim reads, so `npm run soak`'s AI-vs-AI replays are byte-identical
 * with it loaded. It is also the same side of the fence `Shell.pollOutcome` and
 * `MissionTracker` already sit on.
 *
 * IT IS INERT WITHOUT A SHELL
 * ---------------------------
 * Every path returns early unless `window.__vmShell` exists AND reports state
 * `'playing'`. A `?shot=` boot never loads the shell, so all twelve scenario
 * captures are untouched; the title-screen backdrop is state `'menu'`; a
 * tutorial run stands the whole module down, because a scripted lesson is
 * allowed to put the player in states a skirmish would call hopeless.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { RenderPhase } from '../core/types';
import type { PlayerId, RenderContext } from '../core/types';

import {
  describeViability, hasAssets, isBeaten, isStranded, makeViabilitySurvey, surveyViability,
} from '../sim/Viability';

import { ctx, hasGameContext } from './context';
import { isHostileSeat } from './Teams';
import { campaignRunning } from '../campaign/policy';

/* ==========================================================================
 * 1. TUNABLES
 *
 * Module-private, and staying that way this round: `src/core/config.ts` is the
 * art-direction surface and belongs to another workflow right now. These are
 * the feel of one rule owned by one file, which is the same argument
 * `sim/Deploy.ts` and `sim/Capture.ts` already make for their own constants.
 * ========================================================================== */

export const OUTCOME = {
  /** Seconds between evaluations. Matches `Shell.pollOutcome`'s 2 Hz. */
  pollSeconds: 0.5,
  /**
   * Seconds of match before any verdict. Production, the first deploy and the
   * first harvester run all happen inside it, and an empty world for one frame
   * during boot must never read as a defeat. Same value the shell uses.
   */
  startGraceSeconds: 10,
  /**
   * Seconds a player must stay BEATEN before the match resolves. An MCV between
   * "vehicle removed" and "structure exists" is a legitimate blink through the
   * state; so is the tick a Construction Yard is replaced.
   */
  beatenGraceSeconds: 8,
  /** Seconds between repeats of the stranded warning. A toast lives ~6.5s. */
  warnRepeatSeconds: 15,
} as const;

/* ==========================================================================
 * 2. DUCK-TYPED HOSTS
 *
 * Neither of these is imported. `src/game/**` must not depend on the shell or
 * the HUD existing — the sim, the tests and the screenshot harness all run with
 * neither — and `sim/Superweapons.ts` already established the pattern.
 * ========================================================================== */

interface ShellHost {
  getState(): string;
  endMatch(result: { won: boolean }): void;
  /**
   * The verdict the shell actually recorded for the match that just ended.
   *
   * OPTIONAL for the same reason as `getSeed`: a host that predates the
   * accessor must still drive the outcome rules. When it is present it is the
   * AUTHORITATIVE answer for an end we did not call — see `verdictFor` below.
   */
  latestResult?(): { won: boolean } | null;
  /**
   * The seed the running match was booted with, for `EvMatchStarted.seed`.
   *
   * OPTIONAL, and the probe below does not require it. Nothing else in this
   * module needs a seed, a host that predates the accessor must still drive the
   * outcome rules, and the two consumers of the field both degrade cleanly: the
   * mission board falls back to the shell's own `beginMatch`, which is where the
   * authoritative seed already comes from.
   */
  getSeed?(): number;
}

interface HudToastSink {
  toast(kind: string, key: string, title: string, detail?: string): void;
}

function shellHost(): ShellHost | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const s = g.__vmShell as Partial<ShellHost> | undefined;
  if (s === undefined || s === null) return null;
  if (typeof s.getState !== 'function' || typeof s.endMatch !== 'function') return null;
  return s as ShellHost;
}

function hudToast(): HudToastSink | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const h = g.__vmHud as Partial<HudToastSink> | undefined;
  if (h === undefined || h === null) return null;
  return typeof h.toast === 'function' ? (h as HudToastSink) : null;
}

/** True while a scripted tutorial owns the session. See the header. */
function tutorialRunning(): boolean {
  const g = globalThis as unknown as Record<string, unknown>;
  return g.__vmTutorial !== undefined && g.__vmTutorial !== null;
}

/**
 * True while ANY scripted content owns the session — the tutorial or a campaign
 * operation.
 *
 * FOUR LINES THAT BUY THREE THINGS AT ONCE, and all three are shipped defects
 * against a scripted match rather than hypotheticals:
 *
 *   - the `isStranded` nag stops firing at a commando squad that legally has
 *     no base and never will;
 *   - `hasAssets` auto-defeat stops firing at t+10 s on an insertion whose
 *     forces land at t+30 s;
 *   - the all-enemies-beaten auto-win stops pre-empting an objective the player
 *     has not met — an eight-minute hold declared won at minute three.
 *
 * `campaignRunning()` is a module-level boolean in `src/campaign/policy.ts`,
 * which imports nothing, so reaching it costs the entry chunk nothing. The
 * tutorial is a duck-typed global only because its halves straddle
 * `src/shell/**` and `src/game/**`; the campaign's do not.
 */
function scriptedRunning(): boolean {
  return tutorialRunning() || campaignRunning();
}

/* ==========================================================================
 * 3. STATE
 * ========================================================================== */

const localSurvey = makeViabilitySurvey();
const enemySurvey = makeViabilitySurvey();

let pollAccum = 0;
/** Seconds the local player has been continuously beaten. */
let localBeatenFor = 0;
/** Seconds every hostile player has been continuously beaten. */
let enemyBeatenFor = 0;
/** Seconds since the last stranded warning, or -1 when not stranded. */
let warnAge = -1;
/** Shell state observed on the previous frame, for edge detection. */
let lastState = '';
/** True once `match:started` has fired for the current match. */
let startEmitted = false;
/** True once `match:ended` has fired for the current match. */
let emitted = false;
/** True when WE called `endMatch`, so `decidedWon` is authoritative. */
let decided = false;
let decidedWon = false;

/** States you can be in and come back to 'playing' WITHOUT it being a new match. */
const MID_MATCH_STATES: readonly string[] = ['playing', 'paused', 'settings', 'missions'];

function resetMatchState(): void {
  pollAccum = 0;
  localBeatenFor = 0;
  enemyBeatenFor = 0;
  warnAge = -1;
  startEmitted = false;
  emitted = false;
  decided = false;
  decidedWon = false;
}

/* ==========================================================================
 * 4. THE EVENTS
 * ========================================================================== */

/** Fire `match:started` exactly once per match. */
function emitStarted(shell: ShellHost): void {
  if (startEmitted) return;
  startEmitted = true;
  const { world, channels } = ctx();
  // `getSeed` is optional on the host. 0 is a legal seed for every consumer —
  // `MissionTracker.drawObjectives` folds it through a xorshift that guards the
  // degenerate state — and the tracker prefers the shell's own richer
  // `beginMatch` anyway, so a host without the accessor loses nothing.
  const seed = (shell.getSeed?.() ?? 0) >>> 0;
  // `playerCount` is the DENSE player list, which includes the Neutral slot a
  // skirmish always seats — the literal length of `world.players`, so a reader
  // can index it. Not "how many armies are fighting": that is
  // `players.filter(p => p.faction !== Neutral)`, and inventing a second
  // meaning for a field no subscriber reads yet would be the harder thing to
  // undo later.
  channels.events.emit('match:started', {
    seed,
    playerCount: world.players.length,
    localPlayer: world.localPlayer,
  });
  console.info(
    `[outcome] match:started emitted — seed ${seed}, `
    + `${world.players.length} players, local p${world.localPlayer as number}`,
  );
}

/**
 * The winner's id, best effort.
 *
 * `EvMatchEnded.winner` has no "nobody" value, so a defeat has to name someone.
 * `localWon` is the field every current subscriber actually reads; this one is
 * for a scoreboard that does not exist yet.
 *
 * IT USED TO RETURN THE FIRST HOSTILE STILL HOLDING ASSETS, which is exactly
 * right in a duel — there is only one — and wrong in a free-for-all, where it
 * names whoever happens to be seated earliest rather than whoever is winning.
 * With three opponents alive that is a coin toss dressed as an answer.
 *
 * So it now prefers a hostile that is not merely alive but still ABLE TO PLAY
 * (`!isBeaten` — has production or something that can build), and falls back to
 * "alive at all" and then to the local player, which covers a mutual wipe. Two
 * passes rather than a score, because "who was ahead" is a question this module
 * cannot answer without economy history it does not keep, and a made-up ranking
 * would be worse than an honest one-bit distinction.
 */
function winnerOf(localWon: boolean): PlayerId {
  const { world } = ctx();
  const local = world.localPlayer;
  if (localWon) return local;

  let alive: PlayerId | null = null;
  for (const p of world.players) {
    if (!isHostileSeat(world, local, p)) continue;
    surveyViability(world, p.id, enemySurvey);
    if (!hasAssets(enemySurvey)) continue;
    if (!isBeaten(enemySurvey)) return p.id;
    if (alive === null) alive = p.id;
  }
  return alive ?? local;
}

/** Fire `match:ended` exactly once per match. */
function emitEnded(localWon: boolean): void {
  if (emitted) return;
  emitted = true;
  const { channels, loop } = ctx();
  const winner = winnerOf(localWon);
  channels.events.emit('match:ended', {
    winner,
    localWon,
    durationSec: loop.simTime,
  });
  console.info(
    `[outcome] match:ended emitted — ${localWon ? 'victory' : 'defeat'}, `
    + `winner p${winner as number}, ${loop.simTime.toFixed(1)}s`,
  );
}

/** End the match our way: shell first (its ordering is load-bearing), then bus. */
function finish(shell: ShellHost, won: boolean, why: string): void {
  console.info(`[outcome] ${won ? 'victory' : 'defeat'}: ${why}`);
  decided = true;
  decidedWon = won;
  shell.endMatch({ won });
  emitEnded(won);
}

/**
 * Who won, for an end WE did not call.
 *
 * THREE SOURCES, IN THIS ORDER, and the order is the whole fix:
 *
 *  1. `decidedWon`, when this module called `finish()` itself.
 *  2. `shell.latestResult()`, the verdict the shell RECORDED — which is what
 *     `Shell.endMatch({won})` was given, what it wrote to the profile, and what
 *     the end screen is showing.
 *  3. `inferLocalWon()`, recomputed from the store.
 *
 * (2) did not exist, and its absence meant `__vmShell.endMatch({won: true})`
 * wrote a WIN to the profile and raised the victory screen while `match:ended`
 * carried `localWon: false` — the announcer saying "mission failed" and playing
 * the loss sting over a victory. Not reachable from any shipping route today,
 * because the outcome module's own `finish()` sets `decided` and
 * `Shell.pollOutcome` applies the same rule (3) reproduces. But `endMatch` is
 * public specifically "so a real victory module can call it", and every such
 * caller would have been contradicted by the announcer.
 *
 * (3) STAYS, and stays last, for the reason it was written: the shell polls at
 * the same 2 Hz we do, so a CACHED verdict can predate the death of the last
 * enemy building by half a second. But "recompute rather than cache" and
 * "ignore an explicit argument" were never the same thing — and
 * `latestResult()` is not a stale cache, it is the answer the shell committed
 * to for this match, populated inside `endMatch` before it returns.
 */
function verdictFor(shell: ShellHost): boolean {
  if (decided) return decidedWon;
  const recorded = shell.latestResult?.() ?? null;
  if (recorded !== null) return recorded.won;
  return inferLocalWon();
}

/** The store-derived fallback. See `verdictFor`. */
function inferLocalWon(): boolean {
  const { world } = ctx();
  const local = world.localPlayer;
  surveyViability(world, local, localSurvey);
  if (!hasAssets(localSurvey)) return false;
  let hostiles = 0;
  for (const p of world.players) {
    if (!isHostileSeat(world, local, p)) continue;
    hostiles++;
    surveyViability(world, p.id, enemySurvey);
    if (hasAssets(enemySurvey)) return false;
  }
  return hostiles > 0;
}

/* ==========================================================================
 * 5. THE POLL
 * ========================================================================== */

function warnStranded(): void {
  hudToast()?.toast(
    'alert', 'no-production', 'No production',
    'Nothing left that can build. Destroy the enemy or the match is lost.',
  );
}

function evaluate(shell: ShellHost, dt: number): void {
  const { world, loop } = ctx();
  if (loop.simTime < OUTCOME.startGraceSeconds) return;

  const local = world.localPlayer;
  surveyViability(world, local, localSurvey);

  // Wiped out. No grace: this is the shell's own rule, restated here only so
  // that WE are the ones who saw it and the event payload is not a guess.
  if (!hasAssets(localSurvey)) {
    finish(shell, false, 'the local player holds no buildings and no units');
    return;
  }

  // Stranded is a warning, forever, on a repeat so it cannot be missed.
  if (isStranded(localSurvey)) {
    if (warnAge < 0 || warnAge >= OUTCOME.warnRepeatSeconds) {
      warnStranded();
      warnAge = 0;
    } else {
      warnAge += dt;
    }
  } else {
    warnAge = -1;
  }

  localBeatenFor = isBeaten(localSurvey) ? localBeatenFor + dt : 0;

  let hostiles = 0;
  let hostilesBeaten = 0;
  for (const p of world.players) {
    if (!isHostileSeat(world, local, p)) continue;
    hostiles++;
    surveyViability(world, p.id, enemySurvey);
    if (isBeaten(enemySurvey)) hostilesBeaten++;
  }
  const allBeaten = hostiles > 0 && hostilesBeaten === hostiles;
  enemyBeatenFor = allBeaten ? enemyBeatenFor + dt : 0;

  // Victory is checked first for the same reason the shell checks the local
  // player's survival first: when both sides are finished, the one still
  // standing gets the better ending.
  if (enemyBeatenFor >= OUTCOME.beatenGraceSeconds) {
    finish(shell, true, `every hostile player has been unable to build or fight for `
      + `${OUTCOME.beatenGraceSeconds}s`);
    return;
  }
  if (localBeatenFor >= OUTCOME.beatenGraceSeconds) {
    finish(shell, false, `no production, no construction vehicle and nothing on the field `
      + `but harvesters for ${OUTCOME.beatenGraceSeconds}s — the match cannot be won from `
      + `here (${describeViability(localSurvey)})`);
  }
}

/* ==========================================================================
 * 6. THE MODULE
 * ========================================================================== */

export default defineSystem({
  id: 'game.outcome',
  renderPhase: RenderPhase.Hud,
  // After ui.hud (100) and ui.objectives (200): the refusal toast wants a HUD
  // that already exists on the frame the verdict lands.
  order: 900,

  init(): void {
    resetMatchState();
    lastState = '';
    console.info(
      '[outcome] watching for an unwinnable match — '
      + `${OUTCOME.startGraceSeconds}s start grace, ${OUTCOME.beatenGraceSeconds}s beaten grace; `
      + 'this module is the only emitter of "match:started" and "match:ended"',
    );
  },

  frame(r: RenderContext): void {
    if (!hasGameContext()) return;
    const shell = shellHost();
    if (shell === null) return;

    // The watcher runs every frame and regardless of who started or ended the
    // match, so a shell that resolved the outcome on its own still produces the
    // event, and every route into `'playing'` produces exactly one start.
    const state = shell.getState();
    if (state !== lastState) {
      if (state === 'playing' && !MID_MATCH_STATES.includes(lastState)) {
        resetMatchState();
        emitStarted(shell);
      }
      if (state === 'ended') emitEnded(verdictFor(shell));
      lastState = state;
    }

    if (state !== 'playing') return;
    if (scriptedRunning()) return;

    pollAccum += r.dt;
    if (pollAccum < OUTCOME.pollSeconds) return;
    const dt = pollAccum;
    pollAccum = 0;
    evaluate(shell, dt);
  },

  dispose(): void {
    resetMatchState();
    lastState = '';
  },
});

/**
 * ============================================================================
 * src/game/outcome.system.ts — THE MATCH ACTUALLY ENDS, AND SAYS SO
 * ============================================================================
 * Discovered by glob from `src/game/Systems.ts`. Two jobs, both of them holes
 * that were open in the shipped game.
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
 *   BEATEN    — nothing that can build AND nothing but harvesters left. There is
 *               no sequence of inputs that changes the result. Held for
 *               `beatenGraceSeconds` (so a mid-deploy blink cannot trigger it),
 *               then the match resolves and says which way.
 *
 * The predicates live in `src/sim/Viability.ts` and are the SAME ones the sell
 * guard runs. One definition of "can this player still play", or the two rules
 * drift and you get a sell refused for a state the match will not end on.
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
import { Faction, RenderPhase } from '../core/types';
import type { PlayerId, RenderContext } from '../core/types';

import {
  hasAssets, isBeaten, isStranded, makeViabilitySurvey, surveyViability,
} from '../sim/Viability';

import { ctx, hasGameContext } from './context';

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
  emitted = false;
  decided = false;
  decidedWon = false;
}

/* ==========================================================================
 * 4. THE EVENT
 * ========================================================================== */

/**
 * The winner's id, best effort.
 *
 * `EvMatchEnded.winner` has no "nobody" value, so a defeat reports the first
 * hostile player still holding assets and falls back to the local player when
 * even that is not true (a mutual wipe). `localWon` is the field every current
 * subscriber actually reads; this one is for a scoreboard that does not exist
 * yet, and guessing wrong on it is not worth an enum change to core/types.ts.
 */
function winnerOf(localWon: boolean): PlayerId {
  const { world } = ctx();
  const local = world.localPlayer;
  if (localWon) return local;
  for (const p of world.players) {
    if (p.faction === Faction.Neutral) continue;
    if (world.areAllied(local, p.id)) continue;
    surveyViability(world, p.id, enemySurvey);
    if (hasAssets(enemySurvey)) return p.id;
  }
  return local;
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
 * Recomputed live rather than cached, because the alternative is announcing
 * "mission failed" over a victory: the shell polls at the same 2 Hz we do, and a
 * cached verdict from the previous poll can predate the death of the last enemy
 * building by up to half a second. The world is frozen by the time the shell
 * reaches state `'ended'`, so this reproduces the shell's own rule — local still
 * holds something, every hostile holds nothing — against the exact same store.
 */
function inferLocalWon(): boolean {
  const { world } = ctx();
  const local = world.localPlayer;
  surveyViability(world, local, localSurvey);
  if (!hasAssets(localSurvey)) return false;
  let hostiles = 0;
  for (const p of world.players) {
    if (p.faction === Faction.Neutral) continue;
    if (world.areAllied(local, p.id)) continue;
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
    if (p.faction === Faction.Neutral) continue;
    if (world.areAllied(local, p.id)) continue;
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
    finish(shell, false, `no production, no construction vehicle and nothing but `
      + `harvesters for ${OUTCOME.beatenGraceSeconds}s — the match cannot be won from here`);
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
      + 'this module is the only emitter of "match:ended"',
    );
  },

  frame(r: RenderContext): void {
    if (!hasGameContext()) return;
    const shell = shellHost();
    if (shell === null) return;

    // The watcher runs every frame and regardless of who ended the match, so a
    // shell that resolved the outcome on its own still produces the event.
    const state = shell.getState();
    if (state !== lastState) {
      if (state === 'playing' && !MID_MATCH_STATES.includes(lastState)) resetMatchState();
      if (state === 'ended') emitEnded(decided ? decidedWon : inferLocalWon());
      lastState = state;
    }

    if (state !== 'playing') return;
    if (tutorialRunning()) return;

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

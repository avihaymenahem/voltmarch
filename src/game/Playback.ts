/**
 * ============================================================================
 * src/game/Playback.ts — the live half of watching a replay
 * ============================================================================
 * `Replay.ts` is pure: a recorder, a parser and a `ReplayPlayer` that feeds a
 * world somebody else owns. This file is the ONE piece of module state that
 * says "this match is a recording being watched", plus the two hooks the sim
 * calls into. Nothing here allocates per tick and nothing here knows what a
 * shell is.
 *
 * ── WHY IT IS PREPARED BEFORE THE BOOT, NOT AFTER ──────────────────────────
 *
 * Exactly the reason `src/net/net.system.ts` has `prepareSession`: the shell
 * cannot hand anything to a system until `startMatch` returns, and by then
 * `Bootstrap` has called `loop.start()` and several ticks have already run.
 * Those ticks would execute with no commands at all, so every recorded command
 * for them would be re-issued LATE and the first checkpoint would report a
 * desync caused entirely by the plumbing. `preparePlayback` is called before
 * `bootstrap()`; `playback.system.ts` adopts it in `init()`, which runs inside
 * `registry.init()` and therefore before the first tick.
 *
 * ── THE TWO HOOKS, AND WHY THEY ARE AT DIFFERENT ORDERS ────────────────────
 *
 *   `playbackIssue`  — `Phase.Command`, ORDER 1. It has to run before the one
 *                      thing that drains the bus (`OrderExecutor`, order 9000)
 *                      or every command would sit in the ring for a tick and
 *                      apply one tick late, forever.
 *
 *   `playbackVerify` — `Phase.Command`, ORDER 9500, called from
 *                      `replay.system.ts`. It MUST be the same point in the
 *                      tick at which `ReplayRecorder.maybeCheckpoint` stamped
 *                      the number it is being compared against. Anywhere else
 *                      and the two hashes describe different moments, and the
 *                      instrument reports a desync that is its own.
 *
 * ── THE HARVEST IS THE INPUT LOCK ──────────────────────────────────────────
 *
 * A viewer is looking at a live simulation through a live HUD, and their slot
 * is the recorded player's slot — so a right-click WOULD be accepted, WOULD
 * apply, and would make the rest of the recording play a match that never
 * happened. `playbackIssue` therefore empties the ring before re-issuing, with
 * `harvest` rather than `drain` so the recorder's tap does not log a command
 * that is about to be thrown away (trap 2 of `Replay.ts`, third route to it).
 *
 * Dropping is right and skipping the drain is not. The alternative — leave the
 * command and let the checksum catch it — turns one stray click into a
 * "desync" report about a bug that is not in the engine.
 * ============================================================================
 */

import type { Channels } from '../core/events';
import type { World } from '../core/world';
import { ReplayPlayer, type ReplayFile } from './Replay';

/* -------------------------------------------------------------------------- */

/** Everything a viewer's UI needs, in one flat read. */
export interface PlaybackReport {
  /** False when this match is an ordinary game. */
  readonly active: boolean;
  /** The sim tick playback has reached. */
  readonly tick: number;
  /** The last tick the recording has anything to say about. */
  readonly lastTick: number;
  readonly issued: number;
  readonly commandTotal: number;
  /** Checkpoints compared so far — the count of PROOFS, not of ticks. */
  readonly verified: number;
  readonly checkTotal: number;
  /** Empty while in sync; otherwise the first divergence and its tick. */
  readonly desync: string;
  /** True once the world has run past everything the recording describes. */
  readonly complete: boolean;
}

const IDLE: PlaybackReport = {
  active: false, tick: 0, lastTick: 0, issued: 0, commandTotal: 0,
  verified: 0, checkTotal: 0, desync: '', complete: false,
};

let pending: ReplayPlayer | null = null;
let live: ReplayPlayer | null = null;
/** The world tick most recently seen by a hook, for the report. */
let atTick = 0;

/**
 * Arm playback for the match that is about to boot. `null` disarms.
 *
 * Call BEFORE `bootstrap()`. See the header.
 */
export function preparePlayback(file: ReplayFile | null): void {
  pending = file === null ? null : new ReplayPlayer(file);
  if (file === null) live = null;
  atTick = 0;
}

/** Adopt whatever `preparePlayback` left. Called from `playback.system.ts#init`. */
export function adoptPreparedPlayback(): void {
  if (pending === null) return;
  live = pending;
  pending = null;
}

/**
 * Let go of the world this module was feeding, WITHOUT touching what is armed
 * for the next one. Called from `playback.system.ts#dispose`.
 *
 * THE DISTINCTION IS NOT PEDANTRY — CLEARING BOTH HERE BROKE THE FEATURE
 * COMPLETELY, and it did it silently. `Shell.startReplay` arms the file and
 * then calls `startMatch`, whose first act is to tear the OLD engine down;
 * that teardown runs this module's `dispose`, which cleared `pending` — the
 * file that had just been armed for the match about to boot. `init()` then
 * found nothing, playback never started, and what the viewer got was a
 * perfectly ordinary skirmish on the recording's seed with the AI switched off:
 * a plausible, silent, completely different match, which is the exact failure
 * this whole feature is built to make impossible.
 *
 * `src/net/net.system.ts` has the same split for the same reason — its
 * `dispose` clears `session` and leaves `pending` alone.
 */
export function detachPlayback(): void {
  live = null;
  atTick = 0;
}

/** Stop playback entirely, armed file included. The shell's exit path. */
export function endPlayback(): void {
  pending = null;
  live = null;
  atTick = 0;
}

/** True while a recording is driving this match. */
export function playbackActive(): boolean {
  return live !== null;
}

/** The recording being watched, or null. */
export function playbackFile(): ReplayFile | null {
  return live?.replay ?? pending?.replay ?? null;
}

/**
 * The disagreement between what the recording says it is and what this match
 * actually booted as, or ''.
 *
 * ── WHY THIS IS WORTH A FUNCTION ───────────────────────────────────────────
 *
 * A campaign operation's effects are NOT in the command stream. `spawnUnits`,
 * `grantCredits` and `revealArea` never touch the bus — they run inside
 * `simTick` through the Director — so a recording of an operation replays only
 * if the OPERATION IS ARMED BEFORE THE BOOT and the Director re-runs. This is
 * the same trade the file already makes for the largest piece of state in the
 * game: the heightfield is not in the replay, `mapSeed` is.
 *
 * Boot a campaign recording without arming the operation and nothing throws.
 * The layout never builds, no tag is ever stamped, no trigger fires, and the
 * viewer watches a perfectly ordinary skirmish on the operation's seed with the
 * AI switched off — WORD FOR WORD the failure `detachPlayback` above exists to
 * describe, reached by a second route. The checkpoints would diverge, but they
 * would diverge at tick zero and report an entity block, which reads like a
 * broken simulation rather than like a missing boot argument.
 *
 * So it is named. The caller supplies the running operation id because this
 * module knows nothing about campaigns and is not going to start — the same
 * division `ReplayPlayer` states as "THE CALLER OWNS THE WORLD".
 *
 * Silent when nothing is being played back: an ordinary match has no recording
 * to disagree with.
 */
export function playbackCampaignFault(runningOperation: string | null): string {
  const file = live?.replay;
  if (file === undefined) return '';
  const recorded = file.header.campaign?.operation ?? '';
  const running = runningOperation ?? '';
  if (recorded === running) return '';
  if (recorded === '') {
    return `this recording is a skirmish, but campaign operation '${running}' is armed`;
  }
  if (running === '') {
    return `this recording is campaign operation '${recorded}' and no operation is armed — `
      + 'the world was built as an ordinary skirmish on the operation\'s seed, so nothing '
      + 'the operation scripts will happen';
  }
  return `this recording is campaign operation '${recorded}', but '${running}' is armed`;
}

/**
 * Empty the bus of anything issued locally, then re-issue the recording's
 * commands for this tick.
 *
 * `harvest` takes a callback it must call for every command; the callback here
 * is deliberately empty and deliberately not optional — dropping is the point.
 */
export function playbackIssue(world: World, channels: Channels): void {
  const p = live;
  if (p === null) return;
  atTick = world.tick;
  channels.commands.harvest(dropCommand);
  p.issueFor(world.tick, channels);
}

/** The drop target for `harvest`. A named function so it allocates once, ever. */
function dropCommand(): void { /* a viewer's input is not part of the match */ }

/**
 * Compare the live world against the recording's checkpoint for this tick.
 *
 * Call from `Phase.Command` order 9500 and NOWHERE ELSE — see the header.
 */
export function playbackVerify(world: World): void {
  const p = live;
  if (p === null) return;
  atTick = world.tick;
  p.verify(world);
}

/** The whole state of playback, for a UI. Allocates one small object per call. */
export function playbackReport(): PlaybackReport {
  const p = live;
  if (p === null) return IDLE;
  const status = p.status;
  const lastTick = p.lastTick;
  return {
    active: true,
    tick: atTick,
    lastTick,
    issued: status.issued,
    commandTotal: p.commandTotal,
    verified: status.verified,
    checkTotal: p.checkTotal,
    desync: status.desync,
    // `finished` alone is not "the replay is over": a recording whose last
    // command lands at tick 900 still has 300 ticks of consequences to play
    // out before the last checkpoint at 1200. Both conditions, or the viewer
    // gets "complete" over a battle that is still resolving.
    complete: p.finished && atTick >= lastTick,
  };
}

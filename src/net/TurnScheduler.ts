/**
 * ============================================================================
 * src/net/TurnScheduler.ts — when may this client run tick N?
 * ============================================================================
 * The client half of lockstep, with no socket, no clock and no world in it.
 * Everything here is a function of the tick number and of which frames have
 * arrived, which is what makes the scheme testable at all: `net-lockstep.spec`
 * drives two real simulations through two of these and proves their checksums
 * stay equal, with nothing asynchronous anywhere in the test.
 *
 * ── THE RULE, IN ONE SENTENCE ──────────────────────────────────────────────
 *
 * A command issued during turn T executes at turn T + TURN_DELAY on every
 * client, and no client may execute turn T until it holds the frame for T.
 *
 * ── WHY STALLING IS SAFE AND SKIPPING IS NOT ───────────────────────────────
 *
 * When a frame is late this stalls: simulated time stops until it arrives.
 * That is correct and it is the only correct answer. Wall-clock divergence
 * between two machines is IRRELEVANT to lockstep — tick N is tick N whenever
 * each machine gets there — whereas executing a turn without a peer's commands,
 * or executing it twice, or executing turn 5 before turn 4, are all permanent
 * divergence. So this refuses to advance rather than guessing, always.
 *
 * ── TICK/TURN ARITHMETIC, STATED ONCE ──────────────────────────────────────
 *
 * `GameLoop.stepSim` increments before running, so the first simulated tick is
 * 1, not 0. Turn boundaries are therefore laid on `tick - 1`:
 *
 *   turnOf(tick)    = floor((tick - 1) / TURN_TICKS)
 *   opensTurn(tick) = (tick - 1) % TURN_TICKS === 0
 *
 * With TURN_TICKS 3 that puts turn 0 at ticks 1..3, turn 1 at 4..6, and a turn
 * opening on ticks 1, 4, 7. Getting this off by one does not fail loudly — it
 * produces a game that works perfectly until two clients disagree about which
 * tick a turn started on, so it is derived here and nowhere else.
 *
 * ── THE BOOTSTRAP TURNS ────────────────────────────────────────────────────
 *
 * Turns 0 .. TURN_DELAY-1 are pre-seeded EMPTY. They have to be: a command can
 * only be scheduled TURN_DELAY turns after the turn it was collected in, so
 * nothing can ever be scheduled into them, on any client, ever. Waiting for the
 * relay to say so would cost two round trips before the first frame of the
 * match renders, to learn something both ends already know.
 * ============================================================================
 */

import type { WireCheck, WireCommand } from './protocol';

/** A frame this client owes the relay. */
export interface OutgoingFrame {
  /** The turn these commands EXECUTE on, not the turn they were collected in. */
  turn: number;
  commands: WireCommand[];
  check: WireCheck;
}

/** What opening a turn produced. */
export interface TurnOpening {
  /** Commands to re-issue onto the bus right now, in relay-decided order. */
  execute: readonly WireCommand[];
  /** The frame to send, or null when this tick did not open a turn. */
  send: OutgoingFrame | null;
}

export interface TurnSchedulerOptions {
  /** This client's slot. Only used to label the outgoing frame. */
  localSlot: number;
  turnTicks: number;
  turnDelay: number;
}

/**
 * How many executed turns to keep. Only needed so a duplicate or late frame for
 * a turn already run can be RECOGNISED and ignored rather than re-executed —
 * eight turns is most of a second, far longer than any reordering can survive
 * a TCP stream, and it bounds the memory a peer can make this client hold.
 */
const HISTORY_TURNS = 8;

const EMPTY: readonly WireCommand[] = Object.freeze([]);

export class TurnScheduler {
  readonly localSlot: number;
  readonly turnTicks: number;
  readonly turnDelay: number;

  /** Commands collected since the last turn boundary, awaiting a send. */
  private outbox: WireCommand[] = [];

  /** Merged frames from the relay, keyed by the turn they execute on. */
  private readonly frames = new Map<number, readonly WireCommand[]>();

  /** Highest turn executed. -1 before the match starts. */
  private executed = -1;

  /* -- diagnostics, all read by the HUD and the tests --------------------- */
  /** Frames that arrived for a turn already executed. */
  duplicateFrames = 0;
  /** Frames that arrived for a turn we had already been given. */
  redundantFrames = 0;
  /** Turn boundaries this client had to wait at. */
  stalls = 0;

  constructor(opts: TurnSchedulerOptions) {
    this.localSlot = opts.localSlot;
    this.turnTicks = opts.turnTicks;
    this.turnDelay = opts.turnDelay;
    // See THE BOOTSTRAP TURNS. Nothing can be scheduled into these, so waiting
    // to be told they are empty would only add latency to the match start.
    for (let t = 0; t < this.turnDelay; t++) this.frames.set(t, EMPTY);
  }

  /** Which turn `tick` belongs to. */
  turnOf(tick: number): number {
    return Math.floor((tick - 1) / this.turnTicks);
  }

  /** True when `tick` is the first tick of its turn. */
  opensTurn(tick: number): boolean {
    return ((tick - 1) % this.turnTicks) === 0;
  }

  /**
   * Queue a locally issued command.
   *
   * The caller must already have copied it out of the command pool — this
   * retains the object. `net.system.ts` builds a fresh flat object per harvested
   * command for exactly that reason.
   */
  collect(cmd: WireCommand): void {
    this.outbox.push(cmd);
  }

  /** Commands collected but not yet sent. */
  get pending(): number { return this.outbox.length; }

  /**
   * Accept a merged frame from the relay.
   *
   * Ignores a frame for a turn already executed, and a second frame for a turn
   * already held. Both are counted rather than silently swallowed: a relay that
   * starts duplicating frames is a relay whose merge logic broke, and the count
   * is what makes that visible before it becomes a desync.
   */
  receiveFrame(turn: number, commands: readonly WireCommand[]): void {
    if (turn <= this.executed) { this.duplicateFrames++; return; }
    if (this.frames.has(turn)) { this.redundantFrames++; return; }
    this.frames.set(turn, commands);
  }

  /** True when the frame needed to execute `turn` is in hand. */
  hasFrame(turn: number): boolean { return this.frames.has(turn); }

  /**
   * May the simulation execute `tick`?
   *
   * `tick` is the tick ABOUT TO RUN — `GameLoop.tick + 1` — because the gate is
   * consulted before `stepSim` increments.
   *
   * Only a turn-opening tick can ever block. The other TURN_TICKS-1 ticks of a
   * turn carry no commands and are always free to run, which is what keeps a
   * 100 ms turn from feeling like a 100 ms hitch.
   */
  mayStep(tick: number): boolean {
    if (!this.opensTurn(tick)) return true;
    return this.frames.has(this.turnOf(tick));
  }

  /**
   * Open the turn `tick` begins: hand back the commands to execute now, and the
   * frame to send for `turn + turnDelay`.
   *
   * Call once per tick from Phase.Command order 0, BEFORE anything drains the
   * bus. On a tick that does not open a turn this returns nothing to do, which
   * is the common case (two ticks in three at TURN_TICKS 3).
   *
   * `hash` is the whole-sim fingerprint taken at the top of this tick — the
   * state the PREVIOUS tick produced, since no system has run yet. Both clients
   * sample at the identical point, so the comparison is exact; the tick label
   * travels with it so a divergence report can name one.
   */
  open(tick: number, hash: number): TurnOpening {
    if (!this.opensTurn(tick)) return { execute: EMPTY, send: null };

    const turn = this.turnOf(tick);
    const frame = this.frames.get(turn);
    if (frame === undefined) {
      // `mayStep` is meant to have prevented this. Reaching it means the gate
      // was bypassed — a caller stepping the loop directly, or a bug — and
      // executing the turn with no commands would silently desync. Refuse, and
      // let the stall counter show it.
      this.stalls++;
      return { execute: EMPTY, send: null };
    }

    this.executed = turn;
    this.frames.delete(turn);
    this.forgetOlderThan(turn - HISTORY_TURNS);

    const send: OutgoingFrame = {
      turn: turn + this.turnDelay,
      commands: this.outbox,
      check: { tick, hash },
    };
    // A FRESH array, not `length = 0`: the old one has just been handed to the
    // caller to serialise and must not be mutated underneath it.
    this.outbox = [];

    return { execute: frame, send };
  }

  /** Drop frames far enough behind that nothing can legitimately refer to them. */
  private forgetOlderThan(turn: number): void {
    if (turn < 0) return;
    for (const t of this.frames.keys()) if (t < turn) this.frames.delete(t);
  }

  /** Highest turn executed, or -1. */
  get executedTurn(): number { return this.executed; }

  /** Turns held and ready to execute. Depth of the receive buffer. */
  get buffered(): number { return this.frames.size; }
}

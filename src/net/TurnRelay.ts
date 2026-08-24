/**
 * ============================================================================
 * src/net/TurnRelay.ts — merge every slot's turn into one frame, or say no
 * ============================================================================
 * THE ENTIRE GAME LOGIC OF THE SERVER, AND IT CONTAINS NO GAME LOGIC.
 *
 * This holds submissions until every slot has reported a turn, emits one merged
 * frame, and compares the fingerprints that came with them. It never looks at
 * what a command MEANS. It has no world, no entities, no rules — which is what
 * lets `server/` compile against a two-file import closure and never carry a
 * line of the simulation.
 *
 * It lives in `src/net/` rather than in `server/` because the lockstep test
 * needs it too: `net-lockstep.spec` drives two real simulations through two
 * `TurnScheduler`s and ONE of these, standing in for the relay, with no socket
 * anywhere. A second copy of the merge rules inside the server would be a
 * second thing to keep in step, and the test would then be proving the wrong
 * one correct.
 *
 * ── WHY REJECTION HERE IS SAFE AND REJECTION ON A CLIENT IS NOT ────────────
 *
 * Every decision this makes happens BEFORE the broadcast, so all clients
 * receive the identical merged frame and a dropped command is dropped for
 * everyone, atomically. That is what makes the relay the only place a limit may
 * be enforced. The same limit applied on a client would drop a command on one
 * machine and not the other, which is a desync with no visible cause.
 *
 * A slot that breaks a limit therefore has its submission emptied rather than
 * the turn being abandoned: the match continues, the offender is told, and both
 * clients still agree. Refusing to complete the turn would let one malicious
 * peer hang the match, which is a denial of service dressed as strictness.
 *
 * ── ORDER IS PART OF THE CONTRACT ──────────────────────────────────────────
 *
 * Merged commands are emitted in slot order, preserving each slot's own
 * ordering within its block. The relay broadcasts one array so every client
 * would agree regardless — but a stable, stated rule means a replay recorded on
 * one client and one recorded on the other are byte-identical, and that is
 * worth having.
 * ============================================================================
 */

import { TURN_DELAY, WIRE_LIMITS, validateCommand } from './protocol';
import type { ErrorCode, WireCheck, WireCommand } from './protocol';

/** One slot's contribution to one turn. */
export interface Submission {
  slot: number;
  turn: number;
  /** Untrusted. Validated here; never trusted as `WireCommand[]` on entry. */
  commands: unknown[];
  check: WireCheck;
  /**
   * Logical players this connection may command. Normally just `slot`; after
   * a disconnect the Match may add the retired seat assigned to this peer.
   * The list is server-owned and never comes from the wire.
   */
  controlledPlayers?: readonly number[];
}

/** The frame to broadcast once every slot has reported. */
export interface MergedFrame {
  turn: number;
  commands: WireCommand[];
  /** Per-slot fingerprint for this turn's opening tick. Index === slot. */
  checks: (WireCheck | null)[];
}

/** A divergence, named. */
export interface DesyncReport {
  turn: number;
  tick: number;
  hashes: number[];
}

export type SubmitResult =
  | { ok: true; frame: MergedFrame | null; desync: DesyncReport | null; warning: ErrorCode | null }
  | { ok: false; code: ErrorCode };

/** Per-turn accumulator. */
interface Pending {
  commands: (WireCommand[] | null)[];
  checks: (WireCheck | null)[];
  reported: number;
}

export class TurnRelay {
  /** Turns awaiting completion, keyed by turn number. */
  private readonly pending = new Map<number, Pending>();
  /** Highest turn broadcast. `firstTurn - 1` before the first. */
  private emitted: number;

  /**
   * The next turn each slot may submit. Index === slot.
   *
   * ── THE OUT-OF-ORDER COMPLETION, AND WHY A COUNTER CLOSES IT ───────────────
   *
   * Without this, a slot could complete a turn ABOVE one still open and strand
   * it forever. Honest peer submits turns 2 and 3 (the whole lookahead);
   * attacker submits only 3; turn 3 completes, `emitted` jumps to 3, and turns
   * that never completed can never be resubmitted because `s.turn <= emitted`
   * answers `duplicate-turn` from then on. The honest client's `TurnScheduler`
   * blocks at the missing turn and never runs again — and since both peers are
   * then silent, the silence sweep kicks whichever went quiet first, which is
   * the VICTIM. A losing player could convert a loss into a win with one
   * out-of-order frame.
   *
   * `TurnScheduler.open` sends exactly one frame per turn-opening tick, for
   * `turnOf(tick) + turnDelay`, in ascending order with no gaps and no resends —
   * so requiring strict succession refuses nothing a real client does. The
   * baseline matters as much as the rule: the bootstrap turns `0..TURN_DELAY-1`
   * are pre-seeded EMPTY on every client and never traverse the relay, so the
   * first turn a healthy peer ever sends is `TURN_DELAY`. Starting `emitted` at
   * -1 would make that first legal submission look like a skip.
   *
   * With both, `pending` is a contiguous run from `emitted + 1` by induction, a
   * turn can only complete when every lower one already has, and `emitted`
   * advances by exactly one. That also removes the only route by which `retire`
   * could walk `emitted` BACKWARDS and re-open an already-broadcast turn —
   * `emitted` is the sole enforcement of `duplicate-turn`, so its monotonicity
   * should not rest on another rule holding.
   */
  private readonly nextTurn: number[];

  /**
   * Slots that have gone, and are never waited for again.
   *
   * WITHOUT THIS, `retire` only half works. It fills a departed slot's blank
   * into the turns ALREADY open, so the survivor unfreezes — and then their
   * very next turn opens a fresh `Pending` that waits for the slot that just
   * left, and they freeze again indefinitely. The bug survived
   * being written, reviewed and commented; `relay.spec` caught it on the first
   * run, which is the argument for the fake clock.
   */
  private readonly gone: boolean[];

  /** Diagnostics. */
  rejected = 0;
  overCap = 0;

  constructor(
    readonly slots: number,
    readonly turnLookahead: number,
    /**
     * The first turn any slot may submit. See `nextTurn`.
     *
     * Defaults to `TURN_DELAY` because that is what the product sends: the
     * bootstrap turns below it are pre-seeded empty on every client and never
     * reach a relay. A harness that drives submissions by hand from turn 0
     * passes 0 and gets the behaviour it always had.
     */
    readonly firstTurn: number = TURN_DELAY,
  ) {
    this.gone = new Array<boolean>(slots).fill(false);
    this.emitted = firstTurn - 1;
    this.nextTurn = new Array<number>(slots).fill(firstTurn);
  }

  /** Highest turn broadcast so far. */
  get lastTurn(): number { return this.emitted; }
  /** Turns held incomplete. A peer that stops reporting makes this grow. */
  get openTurns(): number { return this.pending.size; }

  /**
   * Take one slot's turn.
   *
   * Returns `ok: false` for a submission that must not be accepted at all — the
   * connection is misbehaving and the caller decides whether to warn or close.
   * Returns `ok: true` with a null frame when the turn is not complete yet, and
   * with a frame when it is. `warning` is set when the submission was ACCEPTED
   * but its commands were dropped, so the caller can tell the offender without
   * stalling the match.
   */
  submit(s: Submission): SubmitResult {
    if (!Number.isInteger(s.turn) || s.turn < 0) return { ok: false, code: 'bad-message' };
    if (!Number.isInteger(s.slot) || s.slot < 0 || s.slot >= this.slots) {
      return { ok: false, code: 'bad-message' };
    }
    if (s.turn <= this.emitted) return { ok: false, code: 'duplicate-turn' };
    // A peer may run a little ahead; it may not run far enough ahead to make
    // this hold an unbounded number of turns in memory.
    if (s.turn > this.emitted + this.turnLookahead) return { ok: false, code: 'turn-out-of-window' };
    if (!Number.isInteger(s.check.tick) || !Number.isInteger(s.check.hash)) {
      return { ok: false, code: 'bad-message' };
    }

    if (this.gone[s.slot]) return { ok: false, code: 'not-in-match' };

    // STRICT SUCCESSION PER SLOT. See `nextTurn` for the attack this closes and
    // for why it cannot refuse a healthy client. The two failure codes are the
    // ones the caller already distinguishes: below the expected turn is a
    // resend, above it is running further ahead than the window allows.
    const expected = this.nextTurn[s.slot] ?? this.firstTurn;
    if (s.turn < expected) return { ok: false, code: 'duplicate-turn' };
    if (s.turn > expected) return { ok: false, code: 'turn-out-of-window' };

    let slot = this.pending.get(s.turn);
    if (slot === undefined) {
      slot = {
        commands: new Array<WireCommand[] | null>(this.slots).fill(null),
        checks: new Array<WireCheck | null>(this.slots).fill(null),
        reported: 0,
      };
      // A departed slot is pre-filled rather than awaited. See `gone`.
      for (let i = 0; i < this.slots; i++) {
        if (!this.gone[i]) continue;
        slot.commands[i] = [];
        slot.reported++;
      }
      this.pending.set(s.turn, slot);
    }
    if (slot.commands[s.slot] !== null) return { ok: false, code: 'duplicate-turn' };

    /* -- validate, cap, stamp ------------------------------------------- */
    let warning: ErrorCode | null = null;
    let accepted: WireCommand[] = [];

    if (!Array.isArray(s.commands)) {
      return { ok: false, code: 'bad-message' };
    }
    if (s.commands.length > WIRE_LIMITS.maxCommandsPerTurn) {
      // Emptied, not truncated: a partial turn is a DIFFERENT turn, and which
      // half survived would be an arbitrary rule two implementations could
      // disagree about. The match continues; the offender is told.
      this.overCap++;
      warning = 'invalid-command';
    } else {
      for (const raw of s.commands) {
        const check = validateCommand(raw);
        if (!check.ok) {
          // One bad command discards the whole submission for this turn, for
          // the same reason as the cap: no arbitrary partial state.
          this.rejected++;
          warning = 'invalid-command';
          accepted = [];
          break;
        }
        // THE IDENTITY STAMP. Normally every claim is replaced by the socket's
        // slot. Once Match has explicitly delegated a retired logical seat,
        // that seat is also legal — and ONLY that server-owned list can widen
        // the authority. A client cannot put `controlledPlayers` on the wire.
        const claimed = check.value.player;
        check.value.player = s.controlledPlayers?.includes(claimed) === true
          ? claimed
          : s.slot;
        accepted.push(check.value);
      }
    }

    slot.commands[s.slot] = accepted;
    // REBUILT, not retained — the same rule `validateCommand` follows two lines
    // above and states in its own header. The caller's object is untrusted JSON
    // and only these two integers are ever read from it; storing it verbatim
    // kept every other key the sender attached alive inside the relay for the
    // life of the turn, which is exactly the shape "REBUILD, NEVER SANITISE"
    // exists to refuse. Both fields are already proven integers above.
    slot.checks[s.slot] = { tick: s.check.tick, hash: s.check.hash };
    slot.reported++;
    this.nextTurn[s.slot] = s.turn + 1;

    if (slot.reported < this.slots) return { ok: true, frame: null, desync: null, warning };

    /* -- complete -------------------------------------------------------- */
    this.pending.delete(s.turn);
    this.emitted = s.turn;

    const commands: WireCommand[] = [];
    for (let i = 0; i < this.slots; i++) {
      const block = slot.commands[i];
      if (block !== null) for (const c of block) commands.push(c);
    }

    return {
      ok: true,
      frame: { turn: s.turn, commands, checks: slot.checks },
      desync: this.compareChecks(s.turn, slot.checks),
      warning,
    };
  }

  /**
   * Compare the fingerprints that arrived with one turn.
   *
   * Every slot samples at the top of the same tick, so these are directly
   * comparable and a difference is a real divergence rather than a timing
   * artefact. The relay is the only party that sees both, which is why the
   * comparison lives here and not on a client.
   */
  private compareChecks(turn: number, checks: (WireCheck | null)[]): DesyncReport | null {
    let first: WireCheck | null = null;
    for (const c of checks) {
      if (c === null) continue;
      if (first === null) { first = c; continue; }
      if (c.hash !== first.hash || c.tick !== first.tick) {
        return {
          turn,
          tick: first.tick,
          hashes: checks.map((x) => (x === null ? 0 : x.hash)),
        };
      }
    }
    return null;
  }

  /**
   * Drop a slot from every turn still open, so the remaining players are not
   * held waiting on a socket that has gone.
   *
   * Returns the turns that completed as a result. A player who disconnects
   * mid-turn would otherwise leave the match frozen for the survivor for the
   * AI takeover, which reads as a crash rather than as a disconnect.
   */
  retire(slot: number): MergedFrame[] {
    if (slot < 0 || slot >= this.slots) return [];
    // Sticky: every FUTURE turn also stops waiting for this slot, not only the
    // ones open right now.
    this.gone[slot] = true;
    const completed: MergedFrame[] = [];
    const turns = [...this.pending.keys()].sort((a, b) => a - b);
    for (const turn of turns) {
      const p = this.pending.get(turn)!;
      if (p.commands[slot] !== null) continue;
      p.commands[slot] = [];
      p.reported++;
      if (p.reported < this.slots) continue;
      this.pending.delete(turn);
      // MONOTONIC, not assigned. `emitted` is the SOLE enforcement of
      // `duplicate-turn`, and lowering it re-opens a turn already broadcast —
      // the survivor then holds two copies of one frame and only
      // `TurnScheduler.receiveFrame`'s `turn <= executed` backstop keeps that
      // from being executed twice. Strict succession above makes an out-of-order
      // completion unreachable, so this can no longer fire; it stays because a
      // property this important should not depend on another rule holding.
      this.emitted = Math.max(this.emitted, turn);
      const commands: WireCommand[] = [];
      for (let i = 0; i < this.slots; i++) {
        const block = p.commands[i];
        if (block !== null) for (const c of block) commands.push(c);
      }
      completed.push({ turn, commands, checks: p.checks });
    }
    return completed;
  }
}

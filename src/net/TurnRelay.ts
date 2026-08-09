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

import { WIRE_LIMITS, validateCommand } from './protocol';
import type { ErrorCode, WireCheck, WireCommand } from './protocol';

/** One slot's contribution to one turn. */
export interface Submission {
  slot: number;
  turn: number;
  /** Untrusted. Validated here; never trusted as `WireCommand[]` on entry. */
  commands: unknown[];
  check: WireCheck;
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
  /** Highest turn broadcast. -1 before the first. */
  private emitted = -1;

  /**
   * Slots that have gone, and are never waited for again.
   *
   * WITHOUT THIS, `retire` only half works. It fills a departed slot's blank
   * into the turns ALREADY open, so the survivor unfreezes — and then their
   * very next turn opens a fresh `Pending` that waits for the slot that just
   * left, and they freeze again for the whole grace period. The bug survived
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
  ) {
    this.gone = new Array<boolean>(slots).fill(false);
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
        // THE IDENTITY STAMP. Whatever the client claimed, this command belongs
        // to the socket that sent it. `Command.player` in core/types.ts says it
        // outright: "The bus stamps this; never trust a client-set value."
        check.value.player = s.slot;
        accepted.push(check.value);
      }
    }

    slot.commands[s.slot] = accepted;
    slot.checks[s.slot] = s.check;
    slot.reported++;

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
   * whole grace period, which reads as a crash rather than as a disconnect.
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
      this.emitted = turn;
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

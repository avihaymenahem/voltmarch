/**
 * ============================================================================
 * server/src/Match.ts — two sockets, one TurnRelay, and AI seat delegation
 * ============================================================================
 * Everything about a live match that is not the merge rule. The merge rule
 * itself is `src/net/TurnRelay.ts`, shared with the client tests, so what is
 * proven in `tests/net-lockstep.spec.ts` is the same code that runs here rather
 * than a second implementation of it.
 *
 * THIS FILE HAS NO WEBSOCKET IN IT. Peers arrive as a `Peer` interface, which
 * is what lets `server/test/relay.spec.ts` drive a whole match — start, turns,
 * desync, disconnect, grace expiry — with two fake peers and a fake clock, and
 * no sockets or timers anywhere.
 * ============================================================================
 */

import { TurnRelay } from '../../src/net/TurnRelay';
import { TURN_DELAY, TURN_LOOKAHEAD, TURN_TICKS } from '../../src/net/protocol';
import type { ErrorCode, OverReason, ServerMessage, WireCheck } from '../../src/net/protocol';

/** One connected player, as far as a match is concerned. */
export interface Peer {
  send(msg: ServerMessage): void;
  /** Tell the peer why, then close. */
  fail(code: ErrorCode): void;
  close(): void;
}

export interface MatchOptions {
  id: string;
  seed: number;
  map: string;
  /** Faction per slot, index === slot. */
  factions: number[];
  /**
   * How long a slot may go without submitting a turn before it is treated as
   * gone. See the check in `tick`.
   */
  silenceMs: number;
  /** Injected so tests do not need a real clock. */
  now: () => number;
  /**
   * The first turn a client may submit. Defaults to `TURN_DELAY`, which is what
   * `TurnScheduler` sends — see `TurnRelay.nextTurn`. Only a harness that drives
   * turns by hand from zero has any reason to pass this.
   */
  firstTurn?: number;
}

export class Match {
  readonly relay: TurnRelay;
  readonly id: string;
  readonly startedAt: number;

  /** Index === slot. Null once that slot has gone. */
  private readonly peers: (Peer | null)[];
  private readonly opts: MatchOptions;

  /** Logical player -> live socket slot authorised to command it. */
  private readonly controller: number[];
  private finished = false;
  /** Last time each slot submitted a turn. Index === slot. */
  private readonly lastSubmit: number[];

  constructor(peers: Peer[], opts: MatchOptions) {
    this.peers = peers.slice();
    this.opts = opts;
    this.id = opts.id;
    this.startedAt = opts.now();
    this.relay = new TurnRelay(peers.length, TURN_LOOKAHEAD, opts.firstTurn ?? TURN_DELAY);
    this.lastSubmit = new Array<number>(peers.length).fill(this.startedAt);
    this.controller = new Array<number>(peers.length);
    for (let slot = 0; slot < peers.length; slot++) this.controller[slot] = slot;
  }

  get over(): boolean { return this.finished; }
  get slots(): number { return this.peers.length; }

  /**
   * Tell every client which slot it drives and what world to build.
   *
   * `slot` is the only per-client field. Everything else — seed, map, the
   * faction of BOTH players — is identical on the wire, because two clients
   * that build different worlds have already desynced before tick one.
   */
  start(): void {
    for (let slot = 0; slot < this.peers.length; slot++) {
      this.peers[slot]?.send({
        t: 'start',
        slot,
        seed: this.opts.seed,
        map: this.opts.map,
        factions: this.opts.factions,
        turnTicks: TURN_TICKS,
        turnDelay: TURN_DELAY,
      });
    }
  }

  /**
   * Take one slot's turn submission and, if it completes the turn, broadcast it.
   *
   * Returns an `ErrorCode` when the SUBMISSION was refused outright — the
   * caller decides whether that is worth closing the connection over. A
   * submission that was accepted but whose commands were dropped reports
   * through `warning` instead and does not stall the match: see the header of
   * `TurnRelay` for why one misbehaving peer must never be able to hang a turn.
   */
  submit(slot: number, turn: number, commands: unknown[], check: WireCheck): ErrorCode | null {
    if (this.finished) return 'not-in-match';

    const res = this.relay.submit({
      slot, turn, commands, check, controlledPlayers: this.controlledPlayers(slot),
    });
    if (!res.ok) return res.code;

    // STAMPED ONLY ON AN ACCEPTED SUBMISSION, AND THE ORDER IS THE WHOLE POINT.
    //
    // This used to be the first line of the method, so a submission the relay
    // REFUSED — `duplicate-turn`, `turn-out-of-window`, even a structurally
    // invalid `bad-message` — still counted as a sign of life. `index.ts` keeps
    // the connection open on a refusal by design, so one ~120-byte frame every
    // ten seconds is free against a 40/s message rate, and it kept the silence
    // clock fresh forever while contributing nothing to any turn.
    //
    // Measured, the damage was not the freeze it looks like: a faithful client
    // stalls when it is starved (`TurnScheduler.mayStep`), so the VICTIM stops
    // submitting first, ITS `lastSubmit` goes stale first, and `tick` below
    // retires the victim and awards the match to the attacker. A losing player
    // could turn a loss into a win with one garbage frame every ten seconds.
    //
    // A refusal is now silence, which is what it always was.
    this.lastSubmit[slot] = this.opts.now();

    if (res.warning !== null) this.peers[slot]?.send({ t: 'error', code: res.warning });

    if (res.desync !== null) {
      // Ended, not tolerated. Two clients past this point are playing different
      // games, and every further frame widens the gap while both players watch
      // something that is no longer the same match. `Checksum.ts` exists so
      // this moment has a tick number attached to it.
      this.broadcast({
        t: 'desync', turn: res.desync.turn, tick: res.desync.tick, hashes: res.desync.hashes,
      });
      this.end('desync', -1);
      return null;
    }

    if (res.frame !== null) {
      this.broadcast({ t: 'frame', turn: res.frame.turn, commands: res.frame.commands });
    }
    return null;
  }

  /**
   * A slot's socket has gone.
   *
   * The survivor is NOT left frozen: `TurnRelay.retire` completes every turn the
   * departed slot was holding open. The empty logical seat is then delegated
   * to one surviving socket, whose client activates the ordinary AI brain.
   * There is no reconnect in this protocol, so making the player wait through
   * a fake grace countdown before the same irreversible handoff buys nothing.
   */
  peerLost(slot: number): void {
    if (this.finished) return;
    // TOTAL OVER `slot`, because a caller can hand it -1 and one did.
    // `Lobby.leave` calls `match.peerLost(match.slotOf(peer))`, and `slotOf` is
    // an `indexOf` that answers -1 for a peer this match has already dropped —
    // which the silence sweep above does without telling the lobby. The guard
    // below reads `this.peers[-1]`, which is `undefined` rather than `null`, so
    // it did not fire: execution fell through, `peers[-1]` was assigned as an
    // own property of the array, and the survivor was handed a SECOND grace
    // period. Measured: a peer retired for silence at 15 s whose socket then
    // closed at 30 s pushed the end from 45 s out to 60 s, with one spurious
    // `peerLost` restarting the countdown on screen. Reachable on the ordinary
    // path — the 15 s heartbeat terminates a dead client squarely inside the
    // grace window — so this is what a crashed opponent looked like.
    if (slot < 0 || slot >= this.peers.length) return;
    if (this.peers[slot] === null) return;
    this.peers[slot] = null;

    for (const frame of this.relay.retire(slot)) {
      this.broadcast({ t: 'frame', turn: frame.turn, commands: frame.commands });
    }

    if (this.livePeers === 0) { this.finished = true; return; }

    const controller = this.firstLiveSlot;
    // Re-home this seat and anything it had already inherited. Only the chosen
    // controller is told to run those brains; every other survivor receives
    // their commands through ordinary merged frames and must not duplicate them.
    for (let player = 0; player < this.controller.length; player++) {
      if (this.controller[player] !== slot) continue;
      this.controller[player] = controller;
      this.peers[controller]?.send({ t: 'peerLost', slot: player });
    }
  }

  /**
   * Drive time-based endings. Call on a timer; it is idempotent and cheap.
   *
   * Returns true once the match is over and may be swept.
   */
  tick(): boolean {
    if (this.finished) return true;
    const now = this.opts.now();

    // A PEER THAT STOPS SENDING WITHOUT CLOSING ITS SOCKET.
    //
    // A socket close calls `peerLost`, but a client can simply stop submitting
    // while still answering pings — hung, suspended, paused in a debugger, or
    // deliberately holding its opponent hostage. Without this sweep the other
    // player remains frozen at a turn boundary until the two-hour match TTL.
    //
    // Treated as a disconnect, because from the other player's side it is
    // indistinguishable from one and has exactly the same remedy.
    //
    // WHICH SLOT IS RETIRED WHEN BOTH ARE SILENT decides who receives whose AI
    // authority, and the old loop took the first in index order — so an attacker
    // that starved a victim could make the relay retire the victim.
    //
    // THE STAMP FIX ABOVE IS NOT SUFFICIENT ON ITS OWN, and reasoning said it
    // was until a test disagreed. A starved victim IS fresher than the peer
    // starving it — it runs its whole lookahead out and submits every turn of it
    // after the attacker's last accepted one — but that margin is only
    // `TURN_LOOKAHEAD` turns, about 400 ms, and this sweep samples once a
    // second. So the sample usually lands after BOTH have crossed the threshold,
    // and index order then hands the victim's army to the attacker. The margin is real
    // and far too small to bet on.
    //
    // Longest-silent decides it on the only evidence there is. TIES KEEP THE
    // EARLIER SLOT, exactly as before: an exact tie means both peers fell silent
    // in the same millisecond, which is a mutual stall rather than an attack,
    // and re-deciding it would change an outcome nothing is wrong with.
    let worst = -1;
    let longest = 0;
    for (let slot = 0; slot < this.peers.length; slot++) {
      if (this.peers[slot] === null) continue;
      const quiet = now - (this.lastSubmit[slot] ?? now);
      if (quiet < this.opts.silenceMs) continue;
      if (worst >= 0 && quiet <= longest) continue;
      worst = slot;
      longest = quiet;
    }
    if (worst >= 0) this.peerLost(worst);
    return this.finished;
  }

  /** True when the match has outlived the hard ceiling and must be swept. */
  expired(ttlMs: number): boolean {
    return this.opts.now() - this.startedAt >= ttlMs;
  }

  /** End it, tell everyone, and stop accepting anything. */
  end(reason: OverReason, winnerSlot: number): void {
    if (this.finished) return;
    this.finished = true;
    this.broadcast({ t: 'over', reason, winnerSlot });
  }

  /** Close every socket still attached. Called after `end`, and on shutdown. */
  dispose(): void {
    for (let i = 0; i < this.peers.length; i++) {
      this.peers[i]?.close();
      this.peers[i] = null;
    }
  }

  /** Which slot a peer occupies, or -1. */
  slotOf(peer: Peer): number {
    return this.peers.indexOf(peer);
  }

  private broadcast(msg: ServerMessage): void {
    for (const p of this.peers) p?.send(msg);
  }

  private get livePeers(): number {
    let n = 0;
    for (const p of this.peers) if (p !== null) n++;
    return n;
  }

  private get firstLiveSlot(): number {
    for (let i = 0; i < this.peers.length; i++) if (this.peers[i] !== null) return i;
    return -1;
  }

  /** Logical players delegated to one live connection. Server-owned authority. */
  private controlledPlayers(connectionSlot: number): number[] {
    const out: number[] = [];
    for (let player = 0; player < this.controller.length; player++) {
      if (this.controller[player] === connectionSlot) out.push(player);
    }
    return out;
  }
}

/**
 * ============================================================================
 * server/src/Match.ts — two sockets, one TurnRelay, and a grace timer
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
  graceMs: number;
  /**
   * How long a slot may go without submitting a turn before it is treated as
   * gone. See the check in `tick`.
   */
  silenceMs: number;
  /** Injected so tests do not need a real clock. */
  now: () => number;
}

export class Match {
  readonly relay: TurnRelay;
  readonly id: string;
  readonly startedAt: number;

  /** Index === slot. Null once that slot has gone. */
  private readonly peers: (Peer | null)[];
  private readonly opts: MatchOptions;

  /** When the grace period expires, or 0 when nobody is missing. */
  private graceDeadline = 0;
  private finished = false;
  /** Last time each slot submitted a turn. Index === slot. */
  private readonly lastSubmit: number[];

  constructor(peers: Peer[], opts: MatchOptions) {
    this.peers = peers.slice();
    this.opts = opts;
    this.id = opts.id;
    this.startedAt = opts.now();
    this.relay = new TurnRelay(peers.length, TURN_LOOKAHEAD);
    this.lastSubmit = new Array<number>(peers.length).fill(this.startedAt);
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

    this.lastSubmit[slot] = this.opts.now();
    const res = this.relay.submit({ slot, turn, commands, check });
    if (!res.ok) return res.code;

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
   * departed slot was holding open, so the match keeps running for the whole
   * grace period. Without that the survivor's screen locks solid the instant
   * the opponent's connection drops, which reads as a crash rather than as a
   * disconnect, and the 30 seconds of grace would be 30 seconds of nothing.
   */
  peerLost(slot: number): void {
    if (this.finished) return;
    if (this.peers[slot] === null) return;
    this.peers[slot] = null;

    for (const frame of this.relay.retire(slot)) {
      this.broadcast({ t: 'frame', turn: frame.turn, commands: frame.commands });
    }

    if (this.livePeers === 0) { this.finished = true; return; }

    this.graceDeadline = this.opts.now() + this.opts.graceMs;
    this.broadcast({ t: 'peerLost', graceMs: this.opts.graceMs });
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
    // The grace timer only starts on `peerLost`, which only fires when the
    // socket closes. A client that simply stops submitting — hung, suspended,
    // paused in a debugger, or deliberately holding its opponent hostage — left
    // the other player frozen at a turn boundary until the two-hour match TTL.
    // The heartbeat does not help: that peer is still answering pings.
    //
    // Treated as a disconnect, because from the other player's side it is
    // indistinguishable from one and has exactly the same remedy.
    if (this.graceDeadline === 0) {
      for (let slot = 0; slot < this.peers.length; slot++) {
        if (this.peers[slot] === null) continue;
        if (now - this.lastSubmit[slot] < this.opts.silenceMs) continue;
        this.peerLost(slot);
        break;
      }
    }

    if (this.graceDeadline !== 0 && now >= this.graceDeadline) {
      // v1 policy: the match ends and the survivor takes it. Reconnect and AI
      // takeover are both possible on top of this — the command log is all
      // either would need — and both are deliberately out of scope.
      this.end('opponent-left', this.firstLiveSlot);
      return true;
    }
    return false;
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
}

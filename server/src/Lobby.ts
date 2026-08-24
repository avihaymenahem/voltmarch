/**
 * ============================================================================
 * server/src/Lobby.ts — invite codes, the quick-match queue, and the registry
 * ============================================================================
 * How two strangers or two friends end up in the same `Match`, and nothing
 * else. Like `Match.ts` this has no WebSocket in it: everything arrives as a
 * `Peer`, so the whole matchmaking path is testable without a network.
 *
 * ── WHY A SIX-CHARACTER CODE IS SAFE ───────────────────────────────────────
 *
 * It is not safe because it is long. 29 symbols over 6 places is 5.9e8, which
 * an attacker with unlimited attempts walks through in an afternoon. It is safe
 * because of three things TOGETHER, and removing any one of them breaks it:
 *
 *   1. `crypto.randomInt`, never `Math.random`. A predictable code needs no
 *      guessing at all — you compute the next one.
 *   2. A join-rate limit per address (`CONFIG.joinAttemptsPerMinute`). This is
 *      the actual defence: 10/min turns 5.9e8 into a hundred years.
 *   3. Single use and a 10-minute expiry, so the window in which any given code
 *      is worth guessing is small and closes the instant it is used.
 *
 * And the prize is small by design: joining a stranger's match lets you play a
 * game of VOLTMARCH against them. There are no accounts, no funds and no
 * personal data anywhere in this server.
 * ============================================================================
 */

import { randomInt } from 'node:crypto';

import { CODE_ALPHABET, CODE_LENGTH, CONFIG } from './config';
import { Match, type Peer } from './Match';
import { ROOM_ID_LENGTH, ROOM_LIST_LIMIT } from '../../src/net/protocol';
import type { RoomSummary, RoomVisibility } from '../../src/net/protocol';

/** A created-but-unjoined room. */
interface Room {
  /** Public handle. Listed. Not secret. */
  id: string;
  /**
   * Invite code. PRIVATE ROOMS ONLY.
   *
   * A public room has no code at all — empty string — so there is nothing for
   * the listing path to leak even if somebody later adds a field to
   * `RoomSummary` by mistake. Two tokens, one of which does not exist for the
   * rooms that get published.
   */
  code: string;
  visibility: RoomVisibility;
  host: Peer;
  hostFaction: number;
  map: string;
  createdAt: number;
}

/** Somebody waiting for any opponent. */
interface Waiting {
  peer: Peer;
  faction: number;
  since: number;
}

export interface LobbyOptions {
  now: () => number;
  /** Injected so a test gets deterministic seeds, codes and room ids. */
  randomSeed: () => number;
  randomCode: () => string;
  randomId?: () => string;
}

/** What either join path returns. */
type JoinResult = { ok: true; match: Match } | { ok: false; reason: 'no-such-room' };

/** Default map when a queued pair has not agreed on one. */
const QUEUE_MAP = 'crossroads';

export class Lobby {
  /** Keyed by public id. Every room, public or private, lives here. */
  private readonly rooms = new Map<string, Room>();
  /** Private-code index. A public room is absent from it by construction. */
  private readonly byCode = new Map<string, Room>();
  /** Connections with the browser open, pushed to when the list changes. */
  private readonly watchers = new Set<Peer>();
  /** Set by `publish`, drained by `flush`. See `publish` for why. */
  private listingDirty = false;
  private readonly matches = new Map<string, Match>();
  private readonly byPeer = new Map<Peer, Match>();
  private queue: Waiting | null = null;
  private matchSeq = 0;

  constructor(private readonly opts: LobbyOptions) {}

  get roomCount(): number { return this.rooms.size; }
  get matchCount(): number { return this.matches.size; }
  get queued(): boolean { return this.queue !== null; }

  /** The match a peer is in, or undefined. */
  matchOf(peer: Peer): Match | undefined { return this.byPeer.get(peer); }

  /* ======================================================================
   * CREATE / JOIN
   * ==================================================================== */

  /**
   * Open a room.
   *
   * Returns it, or null when the server is full. A PRIVATE room carries a code
   * for its host to share; a PUBLIC one carries an empty code and appears in
   * the browser instead.
   */
  create(
    host: Peer, faction: number, map: string, visibility: RoomVisibility,
  ): Room | null {
    if (this.matches.size >= CONFIG.maxMatches) return null;
    if (this.rooms.size >= CONFIG.maxMatches) return null;
    this.leave(host);

    const makeId = this.opts.randomId ?? makeRoomId;
    // Retry on the astronomically unlikely collision rather than trusting it
    // cannot happen — a collision would hand a joiner to the wrong host.
    let id = makeId();
    for (let attempt = 0; attempt < 8 && this.rooms.has(id); attempt++) id = makeId();
    if (this.rooms.has(id)) return null;

    let code = '';
    if (visibility === 'private') {
      code = this.opts.randomCode();
      for (let attempt = 0; attempt < 8 && this.byCode.has(code); attempt++) {
        code = this.opts.randomCode();
      }
      if (this.byCode.has(code)) return null;
    }

    const room: Room = {
      id, code, visibility, host, hostFaction: faction, map, createdAt: this.opts.now(),
    };
    this.rooms.set(id, room);
    if (code !== '') this.byCode.set(code, room);
    this.publish();
    return room;
  }

  /* ======================================================================
   * THE BROWSER
   * ==================================================================== */

  /** Open or close the room browser for a connection. */
  watch(peer: Peer, on: boolean): void {
    if (on) this.watchers.add(peer);
    else this.watchers.delete(peer);
  }

  /**
   * The public rooms, freshest first, capped and COUNTED.
   *
   * `total` travels with the list so the UI can say "showing 60 of 140". A cap
   * nobody mentions reads as completeness, which is how a busy server comes to
   * look like an empty one.
   */
  listing(): { rooms: RoomSummary[]; total: number } {
    const now = this.opts.now();
    const all: RoomSummary[] = [];
    for (const room of this.rooms.values()) {
      // The whole guarantee, in one line: a private room is never listed.
      if (room.visibility !== 'public') continue;
      all.push({
        id: room.id,
        map: room.map,
        faction: room.hostFaction,
        ageSec: Math.max(0, Math.floor((now - room.createdAt) / 1000)),
      });
    }
    all.sort((a, b) => a.ageSec - b.ageSec);
    return { rooms: all.slice(0, ROOM_LIST_LIMIT), total: all.length };
  }

  /**
   * Mark the listing stale. The actual push happens in `flush`.
   *
   * COALESCED, BECAUSE THE DIRECT VERSION WAS AN AMPLIFIER. Publishing inline on
   * every change meant one connection opening and closing a room in a loop cost
   * the server `watchers x rooms` of work per iteration — one cheap message in,
   * five hundred listings out. That is a denial of service with a 500x gain,
   * available to any client that completed a handshake.
   *
   * Now a change sets a flag and the sweep sends at most one listing per second
   * per watcher, no matter how many changes happened. A browser that is one
   * second stale is not a defect; a relay that can be turned into a megaphone is.
   */
  private publish(): void {
    this.listingDirty = true;
  }

  /**
   * Send the listing to watchers, if it changed. Called once a second.
   *
   * The payload is built ONCE and handed to every watcher, rather than rebuilt
   * per peer — the room objects are immutable snapshots, so there is nothing to
   * copy and the cost is one serialisation instead of N.
   */
  flush(): void {
    if (!this.listingDirty) return;
    this.listingDirty = false;
    if (this.watchers.size === 0) return;
    const { rooms, total } = this.listing();
    for (const peer of this.watchers) peer.send({ t: 'rooms', rooms, total });
  }

  /**
   * True when this peer is doing something the idle sweep must not interrupt:
   * in a match, hosting a room, or waiting in the queue.
   *
   * ASKED RATHER THAN REMEMBERED. The server used to keep a `conn.engaged` flag
   * alongside this state, set on create/join/queue and cleared on cancel — so a
   * host whose room expired by TTL stayed flagged forever and was permanently
   * exempt from the idle sweep. The lobby is the thing that knows; a duplicate
   * of that knowledge can only ever drift out of date.
   */
  isBusy(peer: Peer): boolean {
    if (this.byPeer.has(peer)) return true;
    if (this.queue?.peer === peer) return true;
    for (const room of this.rooms.values()) if (room.host === peer) return true;
    return false;
  }

  /**
   * Join by code.
   *
   * Returns the started match, or a reason. The room is deleted BEFORE the
   * match is built — that is what makes a code single-use, and it closes the
   * race where two joiners arriving in the same tick both find the room and the
   * host ends up in two matches.
   */
  join(peer: Peer, code: string, faction: number): JoinResult {
    return this.enter(peer, this.byCode.get(code), faction);
  }

  /**
   * Join a PUBLIC room picked out of the browser.
   *
   * Refuses a private room even when its id is somehow known. The id is not a
   * secret and was never meant to be one — this check is what makes the
   * two-token design mean something rather than merely look tidy.
   */
  joinRoom(peer: Peer, id: string, faction: number): JoinResult {
    const room = this.rooms.get(id);
    if (room !== undefined && room.visibility !== 'public') {
      return { ok: false, reason: 'no-such-room' };
    }
    return this.enter(peer, room, faction);
  }

  /** The shared half of both join paths. */
  private enter(peer: Peer, room: Room | undefined, faction: number): JoinResult {
    if (room === undefined) return { ok: false, reason: 'no-such-room' };
    if (room.host === peer) return { ok: false, reason: 'no-such-room' };
    // The other two callers of `begin` check this; this one did not, so the
    // documented live-match cap could be walked past by joining rooms that were
    // opened before the cap was reached.
    if (this.matches.size >= CONFIG.maxMatches) return { ok: false, reason: 'no-such-room' };
    if (this.opts.now() - room.createdAt > CONFIG.codeTtlMs) {
      this.dropRoom(room);
      return { ok: false, reason: 'no-such-room' };
    }
    // Consumed BEFORE the match is built. That is what makes a room single-use
    // and closes the race where two joiners arriving in the same tick both find
    // it and the host ends up in two matches.
    this.dropRoom(room);
    this.leave(peer);
    return { ok: true, match: this.begin([room.host, peer], [room.hostFaction, faction], room.map) };
  }

  private dropRoom(room: Room): void {
    this.rooms.delete(room.id);
    if (room.code !== '') this.byCode.delete(room.code);
    this.publish();
  }

  /**
   * Enter the quick-match queue, or be paired with whoever is already in it.
   *
   * A one-slot queue, because the scope is 1v1: the first arrival waits, the
   * second starts a match. Nothing here needs to be fairer than that until
   * there is a rating to be fair about.
   */
  enqueue(peer: Peer, faction: number): Match | null {
    this.leave(peer);
    const waiting = this.queue;
    if (waiting === null || waiting.peer === peer) {
      this.queue = { peer, faction, since: this.opts.now() };
      return null;
    }
    this.queue = null;
    if (this.matches.size >= CONFIG.maxMatches) {
      // Put the earlier player back rather than dropping them for arriving first.
      this.queue = waiting;
      return null;
    }
    return this.begin([waiting.peer, peer], [waiting.faction, faction], QUEUE_MAP);
  }

  /** Remove a peer from the queue and from any room it is hosting. */
  cancel(peer: Peer): void {
    if (this.queue?.peer === peer) this.queue = null;
    this.watchers.delete(peer);
    for (const room of [...this.rooms.values()]) {
      if (room.host === peer) this.dropRoom(room);
    }
  }

  /* ======================================================================
   * LIFECYCLE
   * ==================================================================== */

  /**
   * A peer disconnected or asked to leave.
   *
   * Covers all three places it could be — queue, an unjoined room, a live
   * match. Missing any one of them leaks: a stale room a code still resolves
   * to, or a queue slot nobody can be paired with.
   */
  leave(peer: Peer): void {
    this.cancel(peer);
    const match = this.byPeer.get(peer);
    if (match === undefined) return;
    this.byPeer.delete(peer);
    // `slotOf` can answer -1 here: `Match.tick`'s silence sweep retires a slot
    // without telling the lobby, so a socket that closes afterwards arrives with
    // no seat left. `peerLost` is TOTAL over `slot` for that reason — the guard
    // belongs in the callee, because a second caller cannot be seen from here.
    match.peerLost(match.slotOf(peer));
    if (match.over) this.sweepMatch(match);
  }

  /**
   * Drive every time-based rule: silent peers, match TTL, stale rooms, a
   * queue entry nobody ever matched.
   */
  tick(): void {
    const now = this.opts.now();

    for (const [id, match] of this.matches) {
      if (match.tick()) { this.sweepMatch(match, id); continue; }
      if (match.expired(CONFIG.matchTtlMs)) {
        match.end('timeout', -1);
        this.sweepMatch(match, id);
      }
    }
    for (const room of [...this.rooms.values()]) {
      if (now - room.createdAt > CONFIG.codeTtlMs) this.dropRoom(room);
    }
    if (this.queue !== null && now - this.queue.since > CONFIG.lobbyIdleMs) {
      this.queue = null;
    }
  }

  /** Close everything. Called on SIGTERM so a deploy does not just drop sockets. */
  shutdown(): void {
    for (const match of this.matches.values()) {
      match.end('server-shutdown', -1);
      match.dispose();
    }
    this.matches.clear();
    this.byPeer.clear();
    this.rooms.clear();
    this.byCode.clear();
    this.watchers.clear();
    this.queue = null;
  }

  /* ====================================================================== */

  private begin(peers: Peer[], factions: number[], map: string): Match {
    const id = `m${++this.matchSeq}`;
    const match = new Match(peers, {
      id,
      // THE SERVER PICKS THE SEED. Neither client may, or one of them chooses
      // the map generation and the other finds out.
      seed: this.opts.randomSeed(),
      map,
      factions,
      silenceMs: CONFIG.silenceMs,
      now: this.opts.now,
    });
    this.matches.set(id, match);
    for (const p of peers) this.byPeer.set(p, match);
    match.start();
    return match;
  }

  private sweepMatch(match: Match, knownId?: string): void {
    const id = knownId ?? [...this.matches].find(([, m]) => m === match)?.[0];
    if (id !== undefined) this.matches.delete(id);
    for (const [peer, m] of this.byPeer) if (m === match) this.byPeer.delete(peer);
    match.dispose();
  }
}

/* ==========================================================================
 * DEFAULT RANDOMNESS
 * ========================================================================== */

/**
 * A code from `crypto.randomInt`.
 *
 * `randomInt(max)` is rejection-sampled by Node, so the distribution is uniform
 * — `randomBytes()[i] % 29` would not be, and a skewed alphabet shrinks the
 * effective keyspace for free.
 */
export function makeCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** A match seed. Unpredictable so neither player can pre-scout the map. */
export function makeSeed(): number {
  return randomInt(1, 0x7fffffff);
}

/**
 * A public room id.
 *
 * Longer than an invite code and from a different alphabet, because nobody ever
 * types one — it travels in a listing and comes back in a click. Kept
 * distinct from `makeCode` so the two token spaces cannot be mistaken for each
 * other by a reader or by a bug.
 */
const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz023456789';
export function makeRoomId(): string {
  let out = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) out += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return out;
}

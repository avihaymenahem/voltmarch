/**
 * ============================================================================
 * server/src/index.ts — the socket, and everything hostile that arrives on it
 * ============================================================================
 * The only file here that knows what a WebSocket is. Its job is to turn an
 * untrusted, unauthenticated, publicly reachable connection into a `Peer` that
 * `Lobby` and `Match` can treat as ordinary — which means every limit, every
 * check and every refusal lives at this boundary and nowhere deeper.
 *
 * ── THE THREAT MODEL, WRITTEN DOWN ─────────────────────────────────────────
 *
 * Anyone can connect. There is no login, so "who is this" is never a question
 * with an answer; the design does not need one. What matters is:
 *
 *   1. A peer must not be able to act as the OTHER peer.
 *      -> `TurnRelay` stamps `player` from the socket's slot. The simulation
 *         then refuses anything the slot does not own — every applier already
 *         checks (`Commands.ts:868`, `Production.ts:1897`, `Relocate.ts:283`).
 *
 *   2. A peer must not be able to put hostile VALUES into the other's process.
 *      -> `validateCommand` rebuilds every command from a closed allowlist
 *         before it is forwarded. NaN, Infinity, off-map coordinates, unknown
 *         enums and oversized entity lists never leave this server.
 *
 *   3. A peer must not be able to consume the server.
 *      -> Caps on connections, per-IP connections, message rate, payload size,
 *         turn lookahead, commands per turn, match count and match lifetime.
 *         All in `config.ts`, all counted.
 *
 *   4. A peer must not be able to hang the other one.
 *      -> A refused submission never blocks the turn: `TurnRelay` empties it
 *         and completes anyway. A disconnect retires the slot immediately
 *         rather than freezing the survivor for the whole grace period.
 *
 *   5. A peer must not be able to inject anything into the other's UI.
 *      -> The server never relays a free-text string. `ErrorCode` and
 *         `OverReason` are closed unions the client maps to its own local
 *         strings, and `tests/foundation.spec.ts`'s markup gate keeps the
 *         client from ever turning a string into markup.
 *
 * WHAT IS NOT DEFENDED, STATED PLAINLY: a modified client can reveal fog of war
 * and script its own input. That is inherent to lockstep — every client holds
 * the whole world — and closing it means a server-authoritative simulation.
 * What IS closed is everything else: no client can create credits, spawn units,
 * deal damage or touch another player's army, because it can only issue
 * commands and the simulation validates them exactly as it validates the local
 * player's. A client that fudges its own state desyncs within 100 ms and the
 * match ends. The desync detector is also the anti-cheat.
 * ============================================================================
 */

import { createHash, randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';

import { CONFIG } from './config';
// Extracted so it can be unit tested — this module starts a server on import.
import { clientAddress, limitKey } from './address';
import { Lobby, makeCode, makeSeed } from './Lobby';
import type { Peer } from './Match';
import { PROTOCOL_VERSION, WIRE_LIMITS, parseMessage } from '../../src/net/protocol';
import type { ClientMessage, ErrorCode, ServerMessage } from '../../src/net/protocol';

/* ==========================================================================
 * 0. CONFIGURATION THAT MUST NOT REACH PRODUCTION
 * ========================================================================== */

/**
 * Refuse to start on a configuration that is safe only on a developer's box.
 *
 * RUN BEFORE THE SERVER IS CONSTRUCTED, because everything below this file's
 * imports happens at module scope — a check placed in the `listening` handler
 * fires after the socket is already accepting connections, which is what the
 * previous `console.warn` did.
 *
 * `config.ts` claimed a refusal that did not exist. Only the half this process
 * can actually observe is implemented: `NODE_ENV`, which the shipped systemd
 * unit sets. TLS is NOT observable here — nginx terminates it and proxies plain
 * `http://` to loopback by design — so no check keys on it and no comment
 * promises one.
 */
function assertConfigSafe(): void {
  if (CONFIG.allowAnyOrigin && CONFIG.production) {
    console.error(
      '[relay] REFUSING TO START: VM_ALLOW_ANY_ORIGIN=1 with NODE_ENV=production.'
      + ' That accepts a socket from any page on the internet. Unset one of them.',
    );
    process.exit(1);
  }
  // There is deliberately no "the origin list is empty" guard: `CONFIG.origins`
  // always carries `DESKTOP_ORIGIN`, so it cannot be, and a check that cannot be
  // made to fail is an assertion this project has already shipped believing.
}
assertConfigSafe();

/* ==========================================================================
 * 1. PRIVACY
 * ========================================================================== */

/**
 * A per-boot salt, so the same address hashes differently across restarts.
 *
 * The server needs a stable key per address to count connections and rate-limit
 * joins. It does NOT need the address, and storing one turns an ordinary game
 * server into a log of who played from where. Hashing with an ephemeral salt
 * keeps the counting and discards the identity — the map cannot be reversed,
 * and it is meaningless the moment the process restarts.
 */
const IP_SALT = randomBytes(32);

function ipKey(raw: string | undefined): string {
  return createHash('sha256').update(IP_SALT).update(raw ?? 'unknown').digest('base64url').slice(0, 16);
}

/**
 * The key every per-address limit counts against, for one request.
 *
 * ONE FUNCTION, TWO CALL SITES — `verifyClient` reserves against it and
 * `connection` records it, and the two must agree exactly or the reservation
 * leaks. `limitKey` collapses an IPv6 address to its prefix first: see its own
 * header for why a /128 is not an identity.
 */
function addressKey(req: IncomingMessage): string {
  return ipKey(limitKey(clientAddress(req, CONFIG.trustedProxies), CONFIG.ipv6PrefixBits));
}

/* ==========================================================================
 * 2. RATE LIMITING
 * ========================================================================== */

/** A token bucket. Refills continuously; a breach is a close, not a queue. */
class Bucket {
  private tokens: number;
  private last: number;

  constructor(private readonly rate: number, private readonly burst: number, now: number) {
    this.tokens = burst;
    this.last = now;
  }

  /** True when the caller may proceed. */
  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /**
   * True when this bucket has refilled completely and is holding no history.
   *
   * Used to evict SAFELY. The join-attempt map used to be emptied wholesale
   * once it passed ten thousand entries, which reset the limiter for everyone
   * on it — including whoever had just filled it up to trigger the reset. An
   * attacker who could reach ten thousand distinct addresses (trivial on IPv6)
   * could therefore clear their own rate limit on demand. Dropping only buckets
   * that are FULL removes exactly the entries that carry no restriction.
   */
  spent(now: number): boolean {
    const refilled = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    return refilled >= this.burst;
  }
}

/* ==========================================================================
 * 3. CONNECTION STATE
 * ========================================================================== */

interface Conn extends Peer {
  ws: WebSocket;
  ip: string;
  bucket: Bucket;
  /** Set once `hello` has been accepted. Nothing else is answered before it. */
  greeted: boolean;
  alive: boolean;
  connectedAt: number;
}

const now = (): number => Date.now();

const lobby = new Lobby({ now, randomSeed: makeSeed, randomCode: makeCode });

const connections = new Set<Conn>();
const perIp = new Map<string, number>();
const joinAttempts = new Map<string, Bucket>();

/* ==========================================================================
 * 4. THE SERVER
 * ========================================================================== */

/**
 * `Origin` is checked here rather than after the upgrade, so a rejected page
 * never gets a socket at all.
 *
 * Honest about what this is: any non-browser client can send whatever `Origin`
 * it likes, so this is not a security boundary against a determined attacker.
 * It closes the case where a random web page opens sockets here using a
 * visitor's browser, and it costs one string compare.
 */
function originAllowed(origin: string | undefined): boolean {
  if (CONFIG.allowAnyOrigin) return true;
  if (origin === undefined) return false;
  return CONFIG.origins.includes(origin);
}

const wss = new WebSocketServer({
  host: CONFIG.host,
  port: CONFIG.port,
  // `ws` closes rather than buffering past this, so a 10 MB frame costs nothing.
  maxPayload: CONFIG.maxPayloadBytes,
  // OFF DELIBERATELY. Compression is a CPU amplification primitive — a small
  // compressed frame can expand to a large one — and the payloads here are a
  // few hundred bytes of JSON ten times a second. There is nothing to save and
  // an attack surface to decline.
  perMessageDeflate: false,
  verifyClient: (info: { origin: string; req: IncomingMessage }) => {
    if (!originAllowed(info.origin)) return false;
    if (connections.size >= CONFIG.maxConnections) return false;
    const key = addressKey(info.req);
    if ((perIp.get(key) ?? 0) >= CONFIG.maxConnectionsPerIp) return false;
    // RESERVED HERE, NOT ON 'connection'. Checking here and incrementing there
    // leaves a window in which every simultaneous handshake from one address
    // reads the same pre-increment count and every one of them passes — the cap
    // holds against a sequential client and not against the only kind that
    // matters. The reservation is reconciled against the live socket set once a
    // second, so an upgrade that never completes cannot leak a slot.
    perIp.set(key, (perIp.get(key) ?? 0) + 1);
    return true;
  },
});

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const ip = addressKey(req);
  const conn: Conn = {
    ws,
    ip,
    bucket: new Bucket(CONFIG.messageRate, CONFIG.messageBurst, now()),
    greeted: false,
    alive: true,
    connectedAt: now(),
    send(msg: ServerMessage) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    fail(code: ErrorCode) {
      this.send({ t: 'error', code });
      ws.close(4000, code);
    },
    close() {
      ws.close();
    },
  };

  // Already counted by `verifyClient`; counting again here would double it.
  connections.add(conn);

  ws.on('pong', () => { conn.alive = true; });

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    // Text only. A binary frame is not something this protocol has, so it is a
    // probe or a bug — either way there is nothing to parse.
    if (isBinary) { conn.fail('bad-message'); return; }
    if (!conn.bucket.take(now())) { conn.fail('rate-limited'); return; }
    handle(conn, data.toString('utf8'));
  });

  ws.on('close', () => {
    connections.delete(conn);
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
    lobby.leave(conn);
  });

  // A socket that connects and then says nothing occupies a reserved slot until
  // the idle sweep. That is intended — but the sweep only looks at connections
  // it knows about, so registration has to happen before anything can await.


  // A socket error is ordinary on the open internet; it must not take the
  // process down, and it needs no more handling than a close.
  ws.on('error', () => { ws.terminate(); });
});

/* ==========================================================================
 * 5. MESSAGE HANDLING
 * ========================================================================== */

function handle(conn: Conn, text: string): void {
  const parsed = parseMessage(text);
  if (!parsed.ok) { conn.fail('bad-message'); return; }
  const msg = parsed.value as ClientMessage;

  // NOTHING is answered before a valid hello. It keeps every branch below able
  // to assume a compatible peer, and it means a scanner that opens a socket and
  // sends junk is gone before it reaches any of the logic.
  if (!conn.greeted) {
    if (msg.t !== 'hello') { conn.fail('bad-message'); return; }
    if (msg.protocol !== PROTOCOL_VERSION) { conn.fail('protocol-mismatch'); return; }
    if (CONFIG.requireBuild !== '' && msg.build !== CONFIG.requireBuild) {
      // Two different builds of a deterministic simulation desync on contact.
      // Refusing here is a clear message; a desync forty seconds in is not.
      conn.fail('build-mismatch');
      return;
    }
    conn.greeted = true;
    conn.send({ t: 'welcome', protocol: PROTOCOL_VERSION });
    return;
  }

  switch (msg.t) {
    case 'hello':
      // A second hello is not a state this protocol has.
      conn.fail('bad-message');
      return;

    case 'create': {
      if (!isFaction(msg.faction) || !isMapId(msg.map) || !isVisibility(msg.visibility)) {
        conn.fail('bad-message');
        return;
      }
      const room = lobby.create(conn, msg.faction, msg.map, msg.visibility);
      if (room === null) { conn.fail('too-many-connections'); return; }
      // The code is sent ONLY for a private room. A public one has no code at
      // all — see the `Room` type — so there is nothing here to accidentally
      // hand to a client that would then display it as if it meant something.
      conn.send(room.visibility === 'private'
        ? { t: 'created', code: room.code, visibility: 'private' }
        : { t: 'created', visibility: 'public' });
      return;
    }

    case 'rooms': {
      if (typeof msg.subscribe !== 'boolean') { conn.fail('bad-message'); return; }
      lobby.watch(conn, msg.subscribe);
      if (!msg.subscribe) return;
      // Answer immediately so the browser is never blank while it waits for
      // somebody else to change something.
      const { rooms, total } = lobby.listing();
      conn.send({ t: 'rooms', rooms, total });
      return;
    }

    case 'joinRoom': {
      if (!isFaction(msg.faction) || !isRoomId(msg.id)) { conn.fail('bad-message'); return; }
      // RATE LIMITED LIKE `join`, and deliberately from the same bucket. A
      // public id is not a secret, but an unlimited join path is still a way to
      // hammer the server, and sharing the bucket means an attacker cannot use
      // one path to refill the other.
      if (!takeJoinToken(conn)) { conn.fail('rate-limited'); return; }
      const res = lobby.joinRoom(conn, msg.id, msg.faction);
      if (!res.ok) { conn.send({ t: 'error', code: 'no-such-room' }); return; }
      return;
    }

    case 'join': {
      if (!isFaction(msg.faction) || typeof msg.code !== 'string' || msg.code.length > 16) {
        conn.fail('bad-message');
        return;
      }
      // THE RATE LIMIT THAT MAKES A SIX-CHARACTER CODE SAFE. Without it the
      // keyspace is walkable; with it, guessing takes longer than the heat
      // death of the invite.
      if (!takeJoinToken(conn)) { conn.fail('rate-limited'); return; }

      const res = lobby.join(conn, msg.code.toUpperCase(), msg.faction);
      if (!res.ok) { conn.send({ t: 'error', code: 'no-such-room' }); return; }
      return;
    }

    case 'queue': {
      if (!isFaction(msg.faction)) { conn.fail('bad-message'); return; }
      const match = lobby.enqueue(conn, msg.faction);
      if (match === null) conn.send({ t: 'waiting' });
      return;
    }

    case 'cancel':
      lobby.cancel(conn);
      return;

    case 'turn': {
      const match = lobby.matchOf(conn);
      if (match === undefined) { conn.send({ t: 'error', code: 'not-in-match' }); return; }
      if (typeof msg.turn !== 'number' || !Array.isArray(msg.commands)
        || typeof msg.check !== 'object' || msg.check === null) {
        conn.fail('bad-message');
        return;
      }
      const slot = match.slotOf(conn);
      if (slot < 0) { conn.send({ t: 'error', code: 'not-in-match' }); return; }
      const err = match.submit(slot, msg.turn, msg.commands, msg.check);
      // A refused SUBMISSION is reported and the connection stays: a client
      // that briefly runs ahead is normal, and closing on it would turn a
      // hiccup into a lost match.
      if (err !== null) conn.send({ t: 'error', code: err });
      return;
    }

    case 'leave':
      lobby.leave(conn);
      return;

    default:
      conn.fail('bad-message');
  }
}

/**
 * One join attempt from this address, or false when the bucket is empty.
 *
 * SHARED BY BOTH JOIN PATHS. `join` (by code) and `joinRoom` (by public id)
 * draw from the same bucket on purpose: two buckets would let an attacker
 * alternate between them and get double the attempts for free.
 */
function takeJoinToken(conn: Conn): boolean {
  let attempts = joinAttempts.get(conn.ip);
  if (attempts === undefined) {
    attempts = new Bucket(CONFIG.joinAttemptsPerMinute / 60, CONFIG.joinAttemptsPerMinute, now());
    joinAttempts.set(conn.ip, attempts);
  }
  return attempts.take(now());
}

/** Structural checks for the lobby fields the relay carries but never reads. */
function isFaction(v: unknown): v is number {
  // `WIRE_LIMITS.factions`, NOT the player cap. The two were confused here and
  // the relay accepted faction indices 5..7, which every client would then have
  // used to index its faction-keyed tables. See the comment on the limit.
  // AND THE FLOOR IS 1, NOT 0. `Faction.Neutral` is index 0 and `core/types.ts`
  // states in its own comment that "the number of playable armies is
  // FACTION_COUNT - 1" — Gaia is a seat the scenario adds locally and never a
  // seat a player picks. Accepting 0 let a hostile client seat itself as Gaia:
  // not a desync (both clients do the identical thing) and not a NaN (0 indexes
  // every faction-keyed table fine), but a seat whose roster is not a playable
  // army's, forwarded to an opponent who did not ask for it.
  //
  // Deliberately NOT mirrored into `Session.ts`'s check, which is a TRIPWIRE and
  // must stay no stricter than what a correct relay can emit. Lobby.begin can no
  // longer emit a 0, so the loose bound there costs nothing and a tightened one
  // would be a new way to end a match.
  return typeof v === 'number' && Number.isInteger(v)
    && v >= 1 && v < WIRE_LIMITS.factions;
}

function isVisibility(v: unknown): v is 'public' | 'private' {
  return v === 'public' || v === 'private';
}

/**
 * A room id is opaque to everything except the map that holds it, so the only
 * check worth making is that it is a short plain token and not a payload —
 * the same reasoning as `isMapId`, and the same character-class discipline.
 */
function isRoomId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 32 && /^[a-z0-9]+$/.test(v);
}

/**
 * A map id is opaque to the relay — it is handed to both clients unchanged and
 * they resolve it. So the only thing checkable here is that it is a short,
 * plain identifier and not a payload. Restricting the CHARACTER SET rather than
 * only the length is what stops the field being used to smuggle anything into
 * the other client.
 */
function isMapId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 32 && /^[a-z0-9-]+$/.test(v);
}

/* ==========================================================================
 * 6. TIMERS
 * ========================================================================== */

/**
 * The heartbeat. A socket that misses one ping interval is terminated.
 *
 * TCP will happily hold a half-open connection for a very long time, so without
 * this a player who loses power occupies a slot — and their opponent's match —
 * until the OS gives up. It is also what closes a slowloris: a connection that
 * never sends anything still has to answer a ping.
 */
setInterval(() => {
  for (const conn of connections) {
    if (!conn.alive) { conn.ws.terminate(); continue; }
    conn.alive = false;
    conn.ws.ping();
  }
}, CONFIG.heartbeatMs).unref();

/** Grace expiry, match TTL, stale rooms, and sockets that connected and idled. */
setInterval(() => {
  lobby.tick();
  lobby.flush();
  const t = now();

  for (const conn of connections) {
    // ASKED, NOT REMEMBERED. This used to consult a `conn.engaged` flag set when
    // a player created a room or entered the queue and cleared only when they
    // cancelled — so a host whose room expired by TTL stayed "engaged" forever
    // and was exempt from this sweep for the life of the process. The lobby
    // already knows the truth; a second copy of it could only ever be wrong.
    if (lobby.isBusy(conn)) continue;
    if (t - conn.connectedAt > CONFIG.lobbyIdleMs) conn.ws.close(4000, 'idle');
  }

  // RECONCILE the per-address counts against the sockets that actually exist.
  // `verifyClient` reserves a slot before the upgrade completes, so a handshake
  // that dies in flight would otherwise hold one forever. Recomputing is O(n)
  // once a second over a few hundred entries and is self-healing, which a
  // decrement-in-the-right-place scheme is not.
  perIp.clear();
  for (const conn of connections) perIp.set(conn.ip, (perIp.get(conn.ip) ?? 0) + 1);

  // Evict only buckets that have refilled — see `Bucket.spent`. Emptying the
  // map wholesale, which is what this did, handed an attacker a way to reset
  // their own limiter by filling it.
  if (joinAttempts.size > 1024) {
    for (const [key, bucket] of joinAttempts) if (bucket.spent(t)) joinAttempts.delete(key);
  }
}, 1000).unref();

/* ==========================================================================
 * 7. LIFECYCLE
 * ========================================================================== */

function shutdown(signal: string): void {
  console.log(`[relay] ${signal} — closing ${connections.size} connections`);
  lobby.shutdown();
  for (const conn of connections) conn.ws.close(1001, 'shutdown');
  wss.close(() => process.exit(0));
  // Do not let a stuck socket hold a deploy hostage.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

/**
 * The SERVER's own error, which is a different thing from a socket's.
 *
 * `ws` forwards the underlying `http.Server`'s `error` event, and an `error`
 * event with no listener is rethrown by node — so a relay started while a stale
 * instance still held the port died on an unhandled `EADDRINUSE` stack trace
 * (reproduced: exit code 1, `throw er; // Unhandled 'error' event`). With
 * `Restart=always` and `RestartSec=2` that is a restart loop whose journal says
 * nothing an operator can act on. The per-socket handler above is deliberately
 * separate: a socket error is ordinary on the open internet and must NOT be
 * fatal, while a listen failure is fatal and should say so.
 */
wss.on('error', (err: Error) => {
  console.error(`[relay] server error: ${err.message}`);
  process.exit(1);
});

wss.on('listening', () => {
  console.log(
    `[relay] protocol v${PROTOCOL_VERSION} on ${CONFIG.host}:${CONFIG.port}`
    + ` — origins: ${CONFIG.allowAnyOrigin ? 'ANY (dev)' : CONFIG.origins.join(', ')}`
    + (CONFIG.requireBuild === '' ? '' : ` — build: ${CONFIG.requireBuild}`),
  );
  if (CONFIG.allowAnyOrigin) {
    console.warn('[relay] VM_ALLOW_ANY_ORIGIN is set. Development only — never in production.');
  }
});

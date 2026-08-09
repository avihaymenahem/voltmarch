/**
 * ============================================================================
 * server/test/relay.spec.ts — the relay's security behaviour, without a socket
 * ============================================================================
 * `Match` and `Lobby` take a `Peer` interface and a `now()`, so every rule they
 * enforce can be driven with two fake peers and a fake clock: no ports, no
 * timers, no waiting. Which means the disconnect path, the grace expiry and the
 * code-expiry path are actually TESTED rather than reasoned about — and those
 * are exactly the paths nobody exercises by hand because they take thirty
 * seconds each in real life.
 *
 * Runs on `node --test` against the compiled output, so it also proves the
 * server BUILDS — the import-closure boundary in `server/tsconfig.json` is only
 * real if something compiles through it.
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Match, type Peer } from '../src/Match';
import { Lobby, makeCode } from '../src/Lobby';
import { CODE_ALPHABET, CONFIG } from '../src/config';
import { TURN_LOOKAHEAD } from '../../src/net/protocol';
import type { ServerMessage, WireCommand } from '../../src/net/protocol';
import { ROOM_LIST_LIMIT } from '../../src/net/protocol';

/* -------------------------------------------------------------------------- */

class FakePeer implements Peer {
  readonly sent: ServerMessage[] = [];
  closed = false;
  failedWith: string | null = null;

  send(msg: ServerMessage): void { this.sent.push(msg); }
  fail(code: string): void { this.failedWith = code; this.closed = true; }
  close(): void { this.closed = true; }

  /** Every message of a kind, for readable assertions. */
  of<K extends ServerMessage['t']>(t: K): Extract<ServerMessage, { t: K }>[] {
    return this.sent.filter((m): m is Extract<ServerMessage, { t: K }> => m.t === t);
  }
  last(): ServerMessage | undefined { return this.sent[this.sent.length - 1]; }
}

/** A controllable clock, so grace and TTL are testable in microseconds. */
function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function makeMatch(c = clock()): { match: Match; a: FakePeer; b: FakePeer; c: ReturnType<typeof clock> } {
  const a = new FakePeer();
  const b = new FakePeer();
  const match = new Match([a, b], {
    id: 'm1', seed: 12345, map: 'crossroads', factions: [0, 1],
    graceMs: CONFIG.graceMs, silenceMs: CONFIG.silenceMs, now: c.now,
  });
  return { match, a, b, c };
}

const command = (over: Partial<WireCommand> = {}): WireCommand => ({
  kind: 1, player: 0, order: 1, target: 0, x: 10, z: 10, defId: -1,
  tab: 0, cx: 1, cz: 1, stance: 0, queued: false, arg: 0, entities: [1], ...over,
});

const CHECK = { tick: 1, hash: 0xabcd };

/* ========================================================================== */

describe('a match starts both clients on the same world', () => {
  it('sends every client the same seed, map and factions', () => {
    const { match, a, b } = makeMatch();
    match.start();
    const sa = a.of('start')[0];
    const sb = b.of('start')[0];
    assert.equal(sa.seed, sb.seed);
    assert.equal(sa.map, sb.map);
    assert.deepEqual(sa.factions, sb.factions);
  });

  it('gives each client a DIFFERENT slot, and only that differs', () => {
    const { match, a, b } = makeMatch();
    match.start();
    assert.equal(a.of('start')[0].slot, 0);
    assert.equal(b.of('start')[0].slot, 1);
  });
});

describe('the relay stamps identity', () => {
  it('overwrites a slot claim with the socket it came from', () => {
    const { match, a } = makeMatch();
    match.submit(0, 0, [], CHECK);
    // Slot 1 claims to be slot 0 — "order the enemy's army".
    match.submit(1, 0, [command({ player: 0 })], CHECK);

    const frame = a.of('frame')[0];
    assert.equal(frame.commands.length, 1);
    assert.equal(frame.commands[0].player, 1, 'the claim must be overwritten');
  });

  it('never forwards a command carrying a NaN', () => {
    const { match, a } = makeMatch();
    match.submit(0, 0, [], CHECK);
    match.submit(1, 0, [command({ x: Number.NaN })], CHECK);
    assert.equal(a.of('frame')[0].commands.length, 0);
  });

  it('tells the offender without stalling the turn for the innocent party', () => {
    const { match, a, b } = makeMatch();
    match.submit(0, 0, [], CHECK);
    match.submit(1, 0, [command({ kind: 250 })], CHECK);
    assert.equal(b.of('error')[0].code, 'invalid-command');
    // THE POINT: one malicious peer must not be able to hang the match.
    assert.equal(a.of('frame').length, 1);
  });
});

describe('a divergence ends the match instead of being tolerated', () => {
  it('names the tick and both hashes, then ends', () => {
    const { match, a, b } = makeMatch();
    match.submit(0, 0, [], { tick: 30, hash: 0x1111 });
    match.submit(1, 0, [], { tick: 30, hash: 0x2222 });

    const d = a.of('desync')[0];
    assert.equal(d.tick, 30);
    assert.deepEqual(d.hashes, [0x1111, 0x2222]);
    assert.equal(b.of('desync').length, 1, 'both sides must be told');
    assert.equal(a.of('over')[0].reason, 'desync');
    assert.equal(match.over, true);
  });

  it('accepts nothing further once it is over', () => {
    const { match } = makeMatch();
    match.submit(0, 0, [], { tick: 30, hash: 1 });
    match.submit(1, 0, [], { tick: 30, hash: 2 });
    assert.equal(match.submit(0, 1, [], CHECK), 'not-in-match');
  });

  it('stays quiet while the two agree', () => {
    const { match, a } = makeMatch();
    match.submit(0, 0, [], { tick: 30, hash: 0xcafe });
    match.submit(1, 0, [], { tick: 30, hash: 0xcafe });
    assert.equal(a.of('desync').length, 0);
    assert.equal(match.over, false);
  });
});

describe('a disconnect does not freeze the survivor', () => {
  it('completes the turns the departed slot was holding open', () => {
    const { match, a } = makeMatch();
    // The survivor has run ahead into two turns the other never answered.
    match.submit(0, 0, [], CHECK);
    match.submit(0, 1, [], CHECK);
    assert.equal(a.of('frame').length, 0, 'nothing can complete while both are expected');

    match.peerLost(1);
    assert.deepEqual(a.of('frame').map((f) => f.turn), [0, 1]);
    assert.equal(a.of('peerLost').length, 1);
  });

  it('keeps running for the whole grace period', () => {
    const { match, a, c } = makeMatch();
    match.peerLost(1);
    c.advance(CONFIG.graceMs - 1);
    assert.equal(match.tick(), false);
    assert.equal(a.of('over').length, 0);
    // And the survivor can still play during it.
    assert.equal(match.submit(0, 0, [], CHECK), null);
    assert.equal(a.of('frame').length, 1);
  });

  it('awards the match to the survivor when grace expires', () => {
    const { match, a, c } = makeMatch();
    match.peerLost(1);
    c.advance(CONFIG.graceMs);
    assert.equal(match.tick(), true);
    const over = a.of('over')[0];
    assert.equal(over.reason, 'opponent-left');
    assert.equal(over.winnerSlot, 0);
  });

  it('just ends when everybody has gone', () => {
    const { match, c } = makeMatch();
    match.peerLost(0);
    match.peerLost(1);
    assert.equal(match.over, true);
    c.advance(CONFIG.graceMs * 2);
    assert.equal(match.tick(), true);
  });
});

describe('the turn window is bounded', () => {
  it('refuses a turn far ahead rather than buffering it', () => {
    const { match } = makeMatch();
    assert.equal(match.submit(0, TURN_LOOKAHEAD + 10, [], CHECK), 'turn-out-of-window');
  });

  it('refuses a second submission for the same turn from the same slot', () => {
    const { match } = makeMatch();
    assert.equal(match.submit(0, 0, [], CHECK), null);
    assert.equal(match.submit(0, 0, [], CHECK), 'duplicate-turn');
  });

  it('refuses a turn already broadcast', () => {
    const { match } = makeMatch();
    match.submit(0, 0, [], CHECK);
    match.submit(1, 0, [], CHECK);
    assert.equal(match.submit(0, 0, [], CHECK), 'duplicate-turn');
  });
});

/* ========================================================================== */

describe('invite codes', () => {
  const lobbyWith = (c: ReturnType<typeof clock>, code = 'ABC123'): Lobby => new Lobby({
    now: c.now, randomSeed: () => 999, randomCode: () => code,
  });

  it('is single use — a second joiner cannot enter the same room', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const host = new FakePeer();
    const first = new FakePeer();
    const second = new FakePeer();

    const room = lobby.create(host, 0, 'crossroads', 'private');
    assert.equal(room?.code, 'ABC123');
    assert.equal(lobby.join(first, room!.code, 1).ok, true);
    // The room is consumed the moment it is joined, so the race where two
    // arrivals both find it cannot seat three people in one match.
    assert.deepEqual(lobby.join(second, room!.code, 1), { ok: false, reason: 'no-such-room' });
  });

  it('expires', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const host = new FakePeer();
    const code = lobby.create(host, 0, 'crossroads', 'private')!.code;
    c.advance(CONFIG.codeTtlMs + 1);
    assert.deepEqual(lobby.join(new FakePeer(), code, 1), { ok: false, reason: 'no-such-room' });
  });

  it('cannot be joined by its own host', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const host = new FakePeer();
    const code = lobby.create(host, 0, 'crossroads', 'private')!.code;
    assert.equal(lobby.join(host, code, 1).ok, false);
  });

  it('is swept when it goes stale', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    lobby.create(new FakePeer(), 0, 'crossroads', 'private');
    assert.equal(lobby.roomCount, 1);
    c.advance(CONFIG.codeTtlMs + 1);
    lobby.tick();
    assert.equal(lobby.roomCount, 0);
  });

  it('draws from an alphabet with no ambiguous glyphs', () => {
    // A code is read aloud and typed by hand. 0/O and 1/I/L would turn a typo
    // into an indistinguishable wrong code.
    for (const bad of '01OILUV') {
      assert.equal(CODE_ALPHABET.includes(bad), false, `alphabet must not contain ${bad}`);
    }
    assert.equal(new Set(CODE_ALPHABET).size, CODE_ALPHABET.length, 'no duplicates');
  });

  it('produces codes only from that alphabet', () => {
    for (let i = 0; i < 200; i++) {
      for (const ch of makeCode()) assert.ok(CODE_ALPHABET.includes(ch), `stray glyph ${ch}`);
    }
  });
});

describe('the quick-match queue', () => {
  const lobbyWith = (c: ReturnType<typeof clock>): Lobby => new Lobby({
    now: c.now, randomSeed: () => 777, randomCode: makeCode,
  });

  it('holds the first arrival and pairs the second', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const a = new FakePeer();
    const b = new FakePeer();
    assert.equal(lobby.enqueue(a, 0), null);
    assert.equal(lobby.queued, true);
    const match = lobby.enqueue(b, 1);
    assert.notEqual(match, null);
    assert.equal(lobby.queued, false);
    assert.equal(a.of('start').length, 1);
    assert.equal(b.of('start').length, 1);
  });

  it('does not pair somebody with themselves', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const a = new FakePeer();
    assert.equal(lobby.enqueue(a, 0), null);
    assert.equal(lobby.enqueue(a, 0), null);
    assert.equal(a.of('start').length, 0);
  });

  it('drops an entry nobody ever matched', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    lobby.enqueue(new FakePeer(), 0);
    c.advance(CONFIG.lobbyIdleMs + 1);
    lobby.tick();
    assert.equal(lobby.queued, false);
  });

  it('takes the seed from the server, not from either client', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const a = new FakePeer();
    const b = new FakePeer();
    lobby.enqueue(a, 0);
    lobby.enqueue(b, 1);
    assert.equal(a.of('start')[0].seed, 777);
    assert.equal(b.of('start')[0].seed, 777);
  });
});

describe('leaving cleans up everywhere a peer could be', () => {
  const lobbyWith = (c: ReturnType<typeof clock>): Lobby => new Lobby({
    now: c.now, randomSeed: () => 1, randomCode: makeCode,
  });

  it('removes a hosted room, so its code stops resolving', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const host = new FakePeer();
    const code = lobby.create(host, 0, 'crossroads', 'private')!.code;
    lobby.leave(host);
    assert.equal(lobby.roomCount, 0);
    assert.equal(lobby.join(new FakePeer(), code, 1).ok, false);
  });

  it('removes a queue entry', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const a = new FakePeer();
    lobby.enqueue(a, 0);
    lobby.leave(a);
    assert.equal(lobby.queued, false);
  });

  it('retires the slot in a live match and tells the survivor', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const a = new FakePeer();
    const b = new FakePeer();
    lobby.enqueue(a, 0);
    lobby.enqueue(b, 1);
    lobby.leave(b);
    assert.equal(a.of('peerLost').length, 1);
  });

  it('sweeps the match once grace expires, freeing the slot', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const a = new FakePeer();
    const b = new FakePeer();
    lobby.enqueue(a, 0);
    lobby.enqueue(b, 1);
    assert.equal(lobby.matchCount, 1);
    lobby.leave(b);
    c.advance(CONFIG.graceMs + 1);
    lobby.tick();
    assert.equal(lobby.matchCount, 0, 'a finished match must not leak');
    assert.equal(a.of('over')[0].reason, 'opponent-left');
  });

  it('kills a match that outlives the hard ceiling', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    lobby.enqueue(new FakePeer(), 0);
    const b = new FakePeer();
    lobby.enqueue(b, 1);
    c.advance(CONFIG.matchTtlMs + 1);
    lobby.tick();
    assert.equal(lobby.matchCount, 0);
    assert.equal(b.of('over')[0].reason, 'timeout');
  });

  it('closes everything on shutdown rather than dropping sockets', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const a = new FakePeer();
    const b = new FakePeer();
    lobby.enqueue(a, 0);
    lobby.enqueue(b, 1);
    lobby.shutdown();
    assert.equal(a.of('over')[0].reason, 'server-shutdown');
    assert.equal(a.closed, true);
    assert.equal(b.closed, true);
  });
});


/* ========================================================================== */

describe('the room browser', () => {
  const lobbyWith = (c: ReturnType<typeof clock>): Lobby => new Lobby({
    now: c.now, randomSeed: () => 5, randomCode: makeCode,
  });

  it('lists a public room', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    lobby.create(new FakePeer(), 2, 'crossroads', 'public');
    const { rooms, total } = lobby.listing();
    assert.equal(total, 1);
    assert.equal(rooms[0].map, 'crossroads');
    assert.equal(rooms[0].faction, 2);
  });

  it('NEVER lists a private room', () => {
    // The whole reason `visibility` exists. If this fails, every invite code in
    // the product is decorative and a friend's game is joinable by strangers.
    const c = clock();
    const lobby = lobbyWith(c);
    lobby.create(new FakePeer(), 0, 'crossroads', 'private');
    assert.equal(lobby.listing().total, 0);
  });

  it('never puts an invite code in a listing, for any room', () => {
    // Enforced structurally: a public room has no code at all, so there is
    // nothing to leak even if RoomSummary later grows a field by mistake.
    const c = clock();
    const lobby = lobbyWith(c);
    lobby.create(new FakePeer(), 0, 'crossroads', 'public');
    lobby.create(new FakePeer(), 1, 'ridge', 'private');
    const json = JSON.stringify(lobby.listing());
    assert.equal(/[23456789ABCDEFGHJKMNPQRSTWXYZ]{6}/.test(json), false, json);
  });

  it('refuses to join a private room even when its public id is known', () => {
    // The id is not a secret and never was. This check is what makes the
    // two-token design mean something.
    const c = clock();
    const lobby = lobbyWith(c);
    const room = lobby.create(new FakePeer(), 0, 'crossroads', 'private')!;
    assert.deepEqual(lobby.joinRoom(new FakePeer(), room.id, 1),
      { ok: false, reason: 'no-such-room' });
  });

  it('joins a public room by id, and it leaves the list', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const host = new FakePeer();
    const room = lobby.create(host, 0, 'crossroads', 'public')!;
    const joiner = new FakePeer();
    assert.equal(lobby.joinRoom(joiner, room.id, 1).ok, true);
    assert.equal(lobby.listing().total, 0, 'a joined room must not stay listed');
    assert.equal(host.of('start').length, 1);
    assert.equal(joiner.of('start').length, 1);
  });

  it('pushes a fresh list to watchers when the listing changes', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const watcher = new FakePeer();
    lobby.watch(watcher, true);

    const room = lobby.create(new FakePeer(), 0, 'crossroads', 'public')!;
    lobby.flush();
    assert.equal(watcher.of('rooms').length, 1);
    assert.equal(watcher.of('rooms')[0].total, 1);

    lobby.joinRoom(new FakePeer(), room.id, 1);
    lobby.flush();
    const last = watcher.of('rooms').at(-1)!;
    assert.equal(last.total, 0, 'the browser must not keep offering a room that is gone');
  });

  it('COALESCES: a hundred changes cost one listing, not a hundred', () => {
    // The amplification this closes: publishing inline on every change let one
    // client open and close rooms in a loop and cost the server
    // `watchers x rooms` per iteration — one cheap message in, one listing out
    // per watcher. A 500x gain available to anyone who completed a handshake.
    const c = clock();
    const lobby = lobbyWith(c);
    const watcher = new FakePeer();
    lobby.watch(watcher, true);

    for (let i = 0; i < 100; i++) {
      const r = lobby.create(new FakePeer(), 0, 'crossroads', 'public')!;
      lobby.joinRoom(new FakePeer(), r.id, 1);
    }
    assert.equal(watcher.of('rooms').length, 0, 'nothing may be sent before a flush');
    lobby.flush();
    assert.equal(watcher.of('rooms').length, 1, '200 changes must collapse to one listing');
  });

  it('sends nothing when the listing did not change', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const watcher = new FakePeer();
    lobby.watch(watcher, true);
    lobby.create(new FakePeer(), 0, 'crossroads', 'public');
    lobby.flush();
    const seen = watcher.of('rooms').length;
    lobby.flush();
    lobby.flush();
    assert.equal(watcher.of('rooms').length, seen, 'an idle flush must be silent');
  });

  it('stops pushing once the browser is closed', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const watcher = new FakePeer();
    lobby.watch(watcher, true);
    lobby.create(new FakePeer(), 0, 'crossroads', 'public');
    lobby.flush();
    const seen = watcher.of('rooms').length;
    lobby.watch(watcher, false);
    lobby.create(new FakePeer(), 0, 'ridge', 'public');
    lobby.flush();
    assert.equal(watcher.of('rooms').length, seen);
  });

  it('caps the list but REPORTS the true count', () => {
    // A cap nobody mentions reads as completeness, which is how a busy server
    // comes to look like an empty one.
    const c = clock();
    const lobby = lobbyWith(c);
    for (let i = 0; i < ROOM_LIST_LIMIT + 12; i++) {
      lobby.create(new FakePeer(), 0, 'crossroads', 'public');
    }
    const { rooms, total } = lobby.listing();
    assert.equal(rooms.length, ROOM_LIST_LIMIT);
    assert.equal(total, ROOM_LIST_LIMIT + 12);
  });

  it('drops a host\'s room from the list when they disconnect', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const host = new FakePeer();
    lobby.create(host, 0, 'crossroads', 'public');
    assert.equal(lobby.listing().total, 1);
    lobby.leave(host);
    assert.equal(lobby.listing().total, 0, 'a room with no host is not joinable');
  });

  it('expires a public room like any other', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    lobby.create(new FakePeer(), 0, 'crossroads', 'public');
    c.advance(CONFIG.codeTtlMs + 1);
    lobby.tick();
    assert.equal(lobby.listing().total, 0);
  });

  it('ages a room so the browser can show staleness', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    lobby.create(new FakePeer(), 0, 'crossroads', 'public');
    c.advance(45_000);
    assert.equal(lobby.listing().rooms[0].ageSec, 45);
  });
});


/* ========================================================================== */

describe('the idle sweep asks the lobby rather than trusting a flag', () => {
  const lobbyWith = (c: ReturnType<typeof clock>): Lobby => new Lobby({
    now: c.now, randomSeed: () => 3, randomCode: makeCode,
  });

  it('reports a host, a queuer and a player as busy', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const host = new FakePeer();
    const queuer = new FakePeer();
    lobby.create(host, 0, 'crossroads', 'public');
    lobby.enqueue(queuer, 0);
    assert.equal(lobby.isBusy(host), true);
    assert.equal(lobby.isBusy(queuer), true);
    assert.equal(lobby.isBusy(new FakePeer()), false);
  });

  it('stops reporting a host as busy once their room expires', () => {
    // THE BUG THIS REPLACES. `conn.engaged` was set on create and cleared only
    // on cancel, so a host whose room was swept by TTL stayed flagged busy for
    // the life of the process and was permanently exempt from the idle sweep.
    const c = clock();
    const lobby = lobbyWith(c);
    const host = new FakePeer();
    lobby.create(host, 0, 'crossroads', 'public');
    assert.equal(lobby.isBusy(host), true);

    c.advance(CONFIG.codeTtlMs + 1);
    lobby.tick();
    assert.equal(lobby.isBusy(host), false, 'an expired room must not pin a socket open');
  });

  it('keeps reporting busy for the whole of a live match', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const a = new FakePeer();
    const b = new FakePeer();
    lobby.enqueue(a, 0);
    lobby.enqueue(b, 1);
    c.advance(CONFIG.lobbyIdleMs * 3);
    lobby.tick();
    assert.equal(lobby.isBusy(a), true);
    assert.equal(lobby.isBusy(b), true);
  });
});


describe('a peer that goes silent without closing its socket', () => {
  it('is treated as gone, so the survivor is not frozen until the TTL', () => {
    // The grace timer only ever started on a socket CLOSE. A client that stops
    // submitting while still answering pings left the other player stuck at a
    // turn boundary for the full two-hour match TTL.
    const { match, a, c } = makeMatch();
    // Slot 0 keeps playing throughout; only slot 1 goes quiet. Letting BOTH go
    // quiet retires slot 0 first and tests nothing — which is what the first
    // version of this did.
    let turn = 0;
    for (let elapsed = 0; elapsed <= CONFIG.silenceMs; elapsed += 1000) {
      match.submit(0, turn++, [], CHECK);
      c.advance(1000);
      match.tick();
    }
    c.advance(1000);
    match.submit(0, turn++, [], CHECK);
    assert.equal(match.tick(), false, 'not over yet — the grace period starts now');
    assert.equal(a.of('peerLost').length, 1, 'the survivor must be told');

    c.advance(CONFIG.graceMs + 1);
    assert.equal(match.tick(), true);
    assert.equal(a.of('over')[0].reason, 'opponent-left');
    assert.equal(a.of('over')[0].winnerSlot, 0);
  });

  it('leaves a match alone while both slots keep submitting', () => {
    const { match, a, c } = makeMatch();
    for (let turn = 0; turn < 5; turn++) {
      match.submit(0, turn, [], CHECK);
      match.submit(1, turn, [], CHECK);
      c.advance(CONFIG.silenceMs - 1);
      assert.equal(match.tick(), false);
    }
    assert.equal(a.of('peerLost').length, 0);
  });
});

describe('the live-match cap holds on every path', () => {
  it('refuses a join that would exceed it', () => {
    const c = clock();
    const lobby = new Lobby({ now: c.now, randomSeed: () => 1, randomCode: makeCode });
    // `create` and `enqueue` both checked the cap; `enter` did not, so joining
    // rooms opened before the cap was reached walked straight past it.
    const rooms = [];
    for (let i = 0; i < CONFIG.maxMatches + 2; i++) {
      rooms.push(lobby.create(new FakePeer(), 0, 'crossroads', 'public'));
    }
    let started = 0;
    for (const room of rooms) {
      if (room === null) continue;
      if (lobby.joinRoom(new FakePeer(), room.id, 1).ok) started++;
    }
    assert.ok(started <= CONFIG.maxMatches, `started ${started} matches, cap is ${CONFIG.maxMatches}`);
  });
});

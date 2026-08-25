/**
 * ============================================================================
 * server/test/relay.spec.ts — the relay's security behaviour, without a socket
 * ============================================================================
 * `Match` and `Lobby` take a `Peer` interface and a `now()`, so every rule they
 * enforce can be driven with two fake peers and a fake clock: no ports, no
 * timers, no waiting. Which means disconnect takeover and code expiry are
 * actually TESTED rather than reasoned about.
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
import { TURN_DELAY, TURN_LOOKAHEAD, WIRE_LIMITS } from '@voltmarch/protocol';
import type { ServerMessage, WireCommand } from '@voltmarch/protocol';
import { ROOM_LIST_LIMIT } from '@voltmarch/protocol';

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

/** A controllable clock, so silence and TTL are testable in microseconds. */
function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function makeMatch(c = clock()): { match: Match; a: FakePeer; b: FakePeer; c: ReturnType<typeof clock> } {
  const a = new FakePeer();
  const b = new FakePeer();
  const match = new Match([a, b], {
    id: 'm1', seed: 12345, map: 'crossroads',
    names: ['Aster', 'Rook'],
    plan: { factions: [1, 2], teams: [0, 1], ai: [], difficulty: [0, 0] },
    silenceMs: CONFIG.silenceMs, now: c.now,
    // TURNS FROM ZERO, so every case below reads as "turn 0, turn 1, turn 2"
    // rather than starting at TURN_DELAY. The product's own baseline is covered
    // separately, by name, in `a slot must submit turns in order` — with the
    // default, so a change to TURN_DELAY is caught there rather than silently
    // renumbering every assertion in this file.
    firstTurn: 0,
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
    assert.deepEqual(sa.names, ['Aster', 'Rook']);
  });

  it('gives each client a DIFFERENT slot, and only that differs', () => {
    const { match, a, b } = makeMatch();
    match.start();
    assert.equal(a.of('start')[0].slot, 0);
    assert.equal(b.of('start')[0].slot, 1);
  });
});

describe('presentation messages never enter the turn relay', () => {
  it('labels chat from server-owned identity and broadcasts it to both peers', () => {
    const { match, a, b } = makeMatch();
    assert.equal(match.chat(1, 'Hold the ridge'), true);
    assert.deepEqual(a.of('chat'), [{ t: 'chat', player: 1, name: 'Rook', text: 'Hold the ridge' }]);
    assert.deepEqual(b.of('chat'), a.of('chat'));
    assert.equal(a.of('frame').length, 0);
  });

  it('rate-limits chat and pings independently per socket', () => {
    const c = clock();
    const { match } = makeMatch(c);
    assert.equal(match.chat(0, 'One'), true);
    assert.equal(match.chat(0, 'Two'), false);
    assert.equal(match.ping(0, 10, 20), true, 'chat did not spend the ping budget');
    assert.equal(match.ping(0, 11, 21), false);
    c.advance(800);
    assert.equal(match.chat(0, 'Three'), true);
    assert.equal(match.ping(0, 12, 22), true);
  });

  it('keeps a duel ping private because the other socket is hostile', () => {
    const { match, a, b } = makeMatch();
    assert.equal(match.ping(0, 100, 200), true);
    assert.deepEqual(a.of('ping'), [{ t: 'ping', player: 0, x: 100, z: 200 }]);
    assert.equal(b.of('ping').length, 0);
  });

  it('delivers a co-op ping to both human allies', () => {
    const a = new FakePeer();
    const b = new FakePeer();
    const match = new Match([a, b], {
      id: 'coop', seed: 7, map: 'crossroads', names: ['Aster', 'Rook', 'AI 1', 'AI 2'],
      plan: {
        factions: [1, 2, 3, 4], teams: [0, 0, 1, 1], ai: [2, 3], difficulty: [0, 0, 2, 2],
      },
      silenceMs: CONFIG.silenceMs, now: () => 1_000_000,
    });
    assert.equal(match.ping(1, 44, 55), true);
    assert.deepEqual(a.of('ping'), [{ t: 'ping', player: 1, x: 44, z: 55 }]);
    assert.deepEqual(b.of('ping'), a.of('ping'));
  });
});

describe('a mixed 2v2 has two sockets and four logical players', () => {
  const mixed = (): { match: Match; a: FakePeer; b: FakePeer } => {
    const a = new FakePeer();
    const b = new FakePeer();
    const match = new Match([a, b], {
      id: 'mixed', seed: 2468, map: 'temperate-valley', silenceMs: CONFIG.silenceMs,
      now: () => 1_000_000, firstTurn: 0,
      plan: {
        factions: [2, 3, 1, 4], teams: [0, 0, 1, 1], ai: [2, 3],
        difficulty: [0, 0, 2, 2],
      },
    });
    return { match, a, b };
  };

  it('sends identical simulation fields and a symmetric AI hosting split', () => {
    const { match, a, b } = mixed();
    match.start();
    const left = a.of('start')[0];
    const right = b.of('start')[0];
    assert.deepEqual(left.factions, [2, 3, 1, 4]);
    assert.deepEqual(left.teams, right.teams);
    assert.deepEqual(left.ai, [2, 3]);
    assert.deepEqual(left.difficulty, right.difficulty);
    assert.deepEqual(left.controlled, [0, 2]);
    assert.deepEqual(right.controlled, [1, 3]);
  });

  it('preserves each socket delegated AI id but stamps an unauthorized one', () => {
    const { match, a } = mixed();
    match.submit(0, 0, [command({ player: 2 }), command({ player: 3 })], CHECK);
    match.submit(1, 0, [command({ player: 3 })], CHECK);
    const players = a.of('frame')[0].commands.map((item) => item.player);
    assert.deepEqual(players, [2, 0, 3]);
  });

  it('re-delegates the departed human and every AI it hosted', () => {
    const { match, a, b } = mixed();
    match.start();
    match.peerLost(1);
    assert.deepEqual(a.of('peerLost').map((message) => message.slot), [1, 3]);
    assert.equal(b.of('peerLost').length, 0);
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

  it('keeps running instead of awarding an early win', () => {
    const { match, a } = makeMatch();
    match.peerLost(1);
    assert.equal(match.tick(), false);
    assert.equal(a.of('over').length, 0);
    assert.equal(match.submit(0, 0, [], CHECK), null);
    assert.equal(a.of('frame').length, 1);
  });

  it('delegates the retired logical player to the survivor only', () => {
    const { match, a } = makeMatch();
    match.peerLost(1);
    assert.deepEqual(a.of('peerLost'), [{ t: 'peerLost', slot: 1 }]);

    // The AI's command claims player 1. Match passes its server-owned
    // delegation into TurnRelay, so the identity stamp preserves that player.
    match.submit(0, 0, [command({ player: 1 })], CHECK);
    assert.equal(a.of('frame')[0].commands[0].player, 1);
    assert.equal(a.of('over').length, 0);
  });

  it('just ends when everybody has gone', () => {
    const { match } = makeMatch();
    match.peerLost(0);
    match.peerLost(1);
    assert.equal(match.over, true);
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

  it('keeps the match for the survivor, then sweeps when they leave', () => {
    const c = clock();
    const lobby = lobbyWith(c);
    const a = new FakePeer();
    const b = new FakePeer();
    lobby.enqueue(a, 0);
    lobby.enqueue(b, 1);
    assert.equal(lobby.matchCount, 1);
    lobby.leave(b);
    assert.equal(lobby.matchCount, 1, 'the survivor is still playing the AI');
    lobby.leave(a);
    assert.equal(lobby.matchCount, 0, 'a finished match must not leak');
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
  it('advertises a co-op format and seats the joiner into its human slot', () => {
    const c = clock();
    const lobby = new Lobby({ now: c.now, randomSeed: () => 7, randomCode: makeCode });
    const host = new FakePeer();
    const joiner = new FakePeer();
    const plan = {
      factions: [2, 2, 1, 4], teams: [0, 0, 1, 1], ai: [2, 3],
      difficulty: [0, 0, 2, 3],
    };
    const room = lobby.create(host, 2, 'temperate-valley', 'public', plan)!;
    assert.equal(lobby.listing().rooms[0].aiCount, 2);
    assert.equal(lobby.joinRoom(joiner, room.id, 3).ok, true);
    const start = host.of('start')[0];
    assert.deepEqual(start.factions, [2, 3, 1, 4]);
    assert.deepEqual(start.teams, plan.teams);
    assert.deepEqual(start.ai, [2, 3]);
    assert.deepEqual(start.difficulty, plan.difficulty);
  });

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
    // A client that stops submitting while still answering pings must get the
    // same AI handoff as a socket close instead of holding the match hostage.
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
    assert.equal(match.tick(), false, 'the survivor continues against AI');
    assert.equal(a.of('peerLost').length, 1, 'the survivor must be told');
    assert.equal(a.of('peerLost')[0].slot, 1);
    assert.equal(a.of('over').length, 0);
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

/* ==========================================================================
 * WHAT THE GATE COULD NOT SEE BEFORE
 *
 * Every suite below names a defect that shipped rather than the feature it
 * lives in, because in each case the feature was already tested and the defect
 * got past it anyway.
 * ========================================================================== */

/** A match on the PRODUCT's turn baseline, unlike `makeMatch`. */
function realMatch(c = clock()): { match: Match; a: FakePeer; b: FakePeer; c: ReturnType<typeof clock> } {
  const a = new FakePeer();
  const b = new FakePeer();
  const match = new Match([a, b], {
    id: 'm1', seed: 12345, map: 'crossroads',
    plan: { factions: [1, 2], teams: [0, 1], ai: [], difficulty: [0, 0] },
    silenceMs: CONFIG.silenceMs, now: c.now,
  });
  return { match, a, b, c };
}

/**
 * THE FATAL. `WIRE_LIMITS.maxDefId` was 4095 and `UNIT_PUBLIC_ID_BASE` is 4096,
 * so every unit in the game carried a `defId` one above the ceiling,
 * `validateCommand` answered `bounds`, and `TurnRelay` emptied the WHOLE
 * submission — taking every other order issued in the same 100 ms turn with it.
 * A multiplayer player could not buy a single hull.
 *
 * The literal here is deliberate. This file may not import
 * `src/sim/Production.ts` — the four-file include list in `server/tsconfig.json`
 * is the security boundary — so it pins the SHAPE, and
 * `tests/net-protocol.spec.ts` binds the NUMBER to the shipped roster through
 * the real catalog. Neither half is sufficient alone, which is why both exist.
 */
const UNIT_PUBLIC_ID_BASE = 4096;

describe('a unit can actually be bought over the wire', () => {
  it('forwards a ProductionStart carrying a unit publicId', () => {
    const { match, a } = makeMatch();
    const buy = command({
      kind: 2 /* ProductionStart */, tab: 3 /* Vehicles */,
      defId: UNIT_PUBLIC_ID_BASE, arg: 1, entities: [],
    });
    match.submit(0, 0, [buy], CHECK);
    match.submit(1, 0, [], CHECK);

    const frame = a.of('frame')[0];
    assert.equal(frame.commands.length, 1, 'the purchase must reach both clients');
    assert.equal(frame.commands[0].defId, UNIT_PUBLIC_ID_BASE);
    assert.equal(a.of('error').length, 0, 'and nothing may be reported as invalid');
  });

  it('still refuses an id past the ceiling', () => {
    const { match, a } = makeMatch();
    match.submit(0, 0, [command({ kind: 2, tab: 3, defId: WIRE_LIMITS.maxDefId + 1, entities: [] })], CHECK);
    match.submit(1, 0, [], CHECK);
    assert.equal(a.of('frame')[0].commands.length, 0, 'the structural ceiling is still a ceiling');
  });

  it('carries a full selection fanning out inside one turn', () => {
    // Self-destruct issues ONE command per selected unit, up to MAX_SELECTION
    // (100). At the old cap of 32, a player who box-selected 33 hulls and
    // confirmed had the whole turn emptied and every other order in it lost.
    const { match, a } = makeMatch();
    const many = Array.from({ length: 100 }, () => command({ kind: 11 /* SelfDestruct */, entities: [7] }));
    match.submit(0, 0, many, CHECK);
    match.submit(1, 0, [], CHECK);
    assert.equal(a.of('frame')[0].commands.length, 100);
    assert.equal(a.of('error').length, 0);
  });
});

describe('a REFUSED submission is silence, not a sign of life', () => {
  /**
   * THE STOLEN WIN. `Match.submit` stamped `lastSubmit` before it asked the
   * relay whether the submission was legal, so a refusal — `duplicate-turn`,
   * `turn-out-of-window`, even a structurally invalid `bad-message` — kept the
   * silence clock fresh while contributing nothing to any turn. One ~120-byte
   * frame every ten seconds is free against a 40/s message rate.
   *
   * The damage is not the freeze it looks like. A faithful client STALLS when it
   * is starved (`TurnScheduler.mayStep`), so the victim stops submitting first,
   * the victim's clock goes stale first, and the VICTIM is the one retired —
   * handing the match to the attacker. This drives exactly that: the attacker
   * spams refusals and the honest peer, correctly, sends nothing.
   *
   * The existing silence suite passes against the broken build, because it only
   * ever drives a peer that sends NOTHING.
   */
  const FLAVOURS: readonly (readonly [string, number])[] = [
    ['duplicate-turn', 0],
    ['turn-out-of-window', 999],
    ['bad-message', -1],
  ];

  for (const [name, turn] of FLAVOURS) {
    it(`retires the attacker, not the victim, for a ${name} refusal`, () => {
      const { match, a, c } = makeMatch();
      // One honest turn from both, so the match is genuinely under way.
      match.submit(0, 0, [], CHECK);
      match.submit(1, 0, [], CHECK);

      // THE VICTIM MODELLED FAITHFULLY. A real client keeps stepping until it
      // runs out of window and then STALLS — `TurnScheduler.mayStep` returns
      // false with no frame in hand — so it submits its whole lookahead and
      // then nothing. Driving a victim that never submits at all measures a
      // mutual stall instead of an attack, which is what the first version of
      // this test did.
      c.advance(100);
      for (let t = 1; t <= TURN_LOOKAHEAD; t++) { match.submit(0, t, [], CHECK); c.advance(10); }

      let refusals = 0;
      for (let elapsed = 0; elapsed < CONFIG.silenceMs + 5000; elapsed += 1000) {
        if (match.submit(1, turn, [], CHECK) !== null) refusals++;
        c.advance(1000);
        match.tick();
        if (a.of('peerLost').length > 0) break;
      }

      assert.ok(refusals > 0, 'the harness must actually be sending refusals');
      assert.equal(a.of('peerLost').length, 1, 'the attacker is the one retired');
      assert.equal(a.of('peerLost')[0].slot, 1, 'the victim must control the attacker AI');
      assert.equal(a.of('over').length, 0, 'retirement is continuity, not an awarded win');
    });
  }
});

describe('a slot must submit turns in order', () => {
  /**
   * THE OUT-OF-ORDER COMPLETION. The honest peer submits the whole lookahead;
   * the attacker submits only the TOP turn of it. That turn completes, `emitted`
   * jumps past every turn below it, and those can never be resubmitted because
   * `turn <= emitted` answers `duplicate-turn` from then on. The honest client
   * blocks at the missing turn forever — and since both peers then fall silent,
   * the sweep retires whichever went quiet first, which is the victim. A second
   * independent route to the same stolen win.
   */
  it('refuses a submission that would skip a turn', () => {
    const { match } = makeMatch();
    match.submit(0, 0, [], CHECK);
    match.submit(0, 1, [], CHECK);
    assert.equal(match.submit(1, 1, [], CHECK), 'turn-out-of-window',
      'slot 1 has not reported turn 0 and may not complete turn 1');
    // The honest route is untouched: fill the gap, then carry on.
    assert.equal(match.submit(1, 0, [], CHECK), null);
    assert.equal(match.submit(1, 1, [], CHECK), null);
  });

  it('broadcasts frames consecutively, with no turn stranded', () => {
    const { match, a } = makeMatch();
    for (let turn = 0; turn < 4; turn++) {
      match.submit(0, turn, [], CHECK);
      match.submit(1, turn, [], CHECK);
    }
    assert.deepEqual(a.of('frame').map((f) => f.turn), [0, 1, 2, 3]);
    assert.equal(match.relay.lastTurn, 3);
  });

  it('starts at TURN_DELAY, because the bootstrap turns never reach a relay', () => {
    // `TurnScheduler` pre-seeds turns 0..TURN_DELAY-1 empty on every client, so
    // the first turn a real client ever sends is TURN_DELAY. A relay starting at
    // -1 would read that first legal submission as a skip; `makeMatch` above
    // passes `firstTurn: 0` so the rest of this file can count from zero.
    const { match, a } = realMatch();
    assert.equal(match.submit(0, 0, [], CHECK), 'duplicate-turn');
    assert.equal(match.submit(0, TURN_DELAY, [], CHECK), null);
    assert.equal(match.submit(1, TURN_DELAY, [], CHECK), null);
    assert.deepEqual(a.of('frame').map((f) => f.turn), [TURN_DELAY]);
  });

  it('still tolerates a peer running ahead inside the lookahead window', () => {
    // The rule refuses a SKIP, not a lead. Running ahead is what the window is
    // for, and a cap that bit it would break every real match.
    const { match } = makeMatch();
    for (let turn = 0; turn < TURN_LOOKAHEAD; turn++) {
      assert.equal(match.submit(0, turn, [], CHECK), null, `turn ${turn} must be accepted`);
    }
    assert.equal(match.submit(0, TURN_LOOKAHEAD, [], CHECK), 'turn-out-of-window');
  });
});

describe('a slot retired for silence is not delegated twice', () => {
  /**
   * `Lobby.leave` calls `match.peerLost(match.slotOf(peer))`, and `slotOf` is an
   * `indexOf` that answers -1 once the silence sweep has already nulled that
   * seat. The guard read `this.peers[-1]`, which is `undefined` rather than
   * `null`, so it did not fire: execution fell through and the survivor was
   * notified twice while `peers` grew an own property named '-1'.
   */
  it('ignores a peerLost for a slot that has already gone', () => {
    const { match, a, c } = makeMatch();
    // Slot 0 plays; slot 1 never answers, so slot 1 is the stalest slot.
    match.submit(0, 0, [], CHECK);
    c.advance(100);
    match.submit(0, 1, [], CHECK);
    c.advance(CONFIG.silenceMs + 1);
    match.tick();
    assert.equal(a.of('peerLost').length, 1, 'slot 1 is retired for silence');

    // The socket closes ten seconds later. `slotOf` now answers -1.
    c.advance(10_000);
    match.peerLost(-1);
    assert.equal(a.of('peerLost').length, 1, 'no second delegation');
    match.submit(0, 2, [], CHECK);
    assert.equal(match.tick(), false, 'the survivor keeps playing');
  });
});

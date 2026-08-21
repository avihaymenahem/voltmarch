/**
 * ============================================================================
 * tests/net-lockstep.spec.ts — two simulations, one relay, no socket
 * ============================================================================
 * THE PROOF THE WHOLE FEATURE RESTS ON, with every asynchronous thing removed.
 *
 * Two independent worlds, each with its own `Channels` and `TurnScheduler`,
 * driven through one `TurnRelay` that stands in for the server. No WebSocket,
 * no timers, no promises — so a failure is a failure of the scheme rather than
 * a flake, and the whole file runs in milliseconds.
 *
 * `tests/replay.spec.ts` proves a recorded stream reproduces a match. This
 * proves the harder thing: that two clients which each know only their OWN
 * commands, and learn the other's a fixed number of turns later, stay
 * bit-identical anyway.
 *
 * ── WHAT THE NEGATIVE CASES ARE FOR ────────────────────────────────────────
 *
 * A lockstep test that only shows two worlds agreeing proves very little —
 * two worlds that ignore every command also agree, perfectly, forever. So each
 * positive case is paired with the sabotage that must break it: a client that
 * runs a turn early, a peer that lies about which slot it is, a command that
 * carries a NaN. If those pass too, the harness is measuring nothing.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  CommandKind, EntityFlag, EntityKind, Faction, OrderKind, Stance,
} from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';
import { MAP_SIZE } from '../src/core/config';
import { hashOnly } from '../src/game/Checksum';
import { TurnScheduler } from '../src/net/TurnScheduler';
import { TurnRelay } from '../src/net/TurnRelay';
import { applyCommand, toWire } from '../src/net/applyCommand';
import { TURN_DELAY, TURN_LOOKAHEAD, TURN_TICKS, validateCommand } from '../src/net/protocol';
import type { WireCommand } from '../src/net/protocol';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;
const CX = MAP_SIZE * 0.5;

/* ==========================================================================
 * A stand-in simulation.
 *
 * Deliberately the same shape as `replay.spec.ts`'s stubs: apply orders, move
 * ordered units a fixed step. The REAL simulation's determinism is not what
 * this file is testing — `tools/desync-probe.mjs` and the soak cover that. What
 * is under test is whether the scheduler delivers identical commands on
 * identical ticks, and a small transparent sim makes a failure legible.
 * ========================================================================== */

function makeWorld(): World {
  const w = new World();
  w.addPlayer(Faction.Allies, 'One', true, true);
  w.addPlayer(Faction.Soviets, 'Two', true, false);
  return w;
}

function spawn(w: World, x: number, z: number, owner: PlayerId): EntityId {
  const s = w.store;
  const h = s.alloc(EntityKind.Vehicle, 3, owner, Faction.Allies, x, 0, z, 0);
  const i = s.index(h);
  s.hp[i] = 300; s.maxHp[i] = 300; s.radius[i] = 2;
  s.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision;
  return h;
}

function applyStub(w: World, cmd: {
  kind: number; entities: Int32Array; entityCount: number;
  order: number; x: number; z: number; stance: number; target: number;
}): void {
  const s = w.store;
  if (cmd.kind === CommandKind.Order) {
    for (let e = 0; e < cmd.entityCount; e++) {
      const i = s.index(cmd.entities[e] as EntityId);
      if (i < 0) continue;
      s.orderKind[i] = cmd.order;
      s.orderX[i] = cmd.x;
      s.orderZ[i] = cmd.z;
      s.targetId[i] = cmd.target;
    }
  } else if (cmd.kind === CommandKind.SetStance) {
    for (let e = 0; e < cmd.entityCount; e++) {
      const i = s.index(cmd.entities[e] as EntityId);
      if (i >= 0) s.stance[i] = cmd.stance;
    }
  }
}

function stepStub(w: World): void {
  const s = w.store;
  for (let a = 0; a < s.aliveCount; a++) {
    const i = s.alive[a];
    if (s.orderKind[i] === OrderKind.None) continue;
    const dx = s.orderX[i] - s.posX[i];
    const dz = s.orderZ[i] - s.posZ[i];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.25) { s.orderKind[i] = OrderKind.None; continue; }
    s.posX[i] += (dx / d) * 0.5;
    s.posZ[i] += (dz / d) * 0.5;
  }
}

/* ==========================================================================
 * One lockstep client.
 * ========================================================================== */

interface Executed { tick: number; kind: number; player: number }

class Client {
  readonly world = makeWorld();
  readonly ch = new Channels();
  readonly sched: TurnScheduler;
  /** The units, spawned identically on every client. */
  readonly a: EntityId;
  readonly b: EntityId;
  tick = 0;
  /** Every command this client actually executed, for order comparison. */
  readonly log: Executed[] = [];

  constructor(readonly slot: number) {
    this.sched = new TurnScheduler({
      localSlot: slot, turnTicks: TURN_TICKS, turnDelay: TURN_DELAY,
    });
    this.a = spawn(this.world, CX, CX, P0);
    this.b = spawn(this.world, CX + 8, CX, P1);
  }

  /** What a player click does: straight onto the bus, exactly as today. */
  issueMove(dest: number): void {
    this.ch.commands.issueOrder(
      this.slot as PlayerId, OrderKind.Move,
      [(this.slot === 0 ? this.a : this.b) as number], 1,
      dest, dest, 0 as EntityId, false,
    );
  }

  issueStance(st: Stance): void {
    this.ch.commands.issueSetStance(
      this.slot as PlayerId, [(this.slot === 0 ? this.a : this.b) as number], 1, st,
    );
  }

  /** True when the gate permits the next tick. */
  get ready(): boolean { return this.sched.mayStep(this.tick + 1); }

  /**
   * One tick, in the order `net.system.ts` will run it for real:
   * harvest at Phase.Command order 0, open the turn, re-issue the frame, then
   * let the simulation drain what is now on the bus.
   */
  step(): { turn: number; commands: WireCommand[]; check: { tick: number; hash: number } } | null {
    const next = this.tick + 1;
    if (!this.sched.mayStep(next)) return null;
    this.tick = next;
    this.world.tick = next;
    this.ch.commands.tick = next;

    // 1. take local intents OFF the bus — they must not apply this tick.
    this.ch.commands.harvest((cmd) => { this.sched.collect(toWire(cmd)); });

    // 2. open the turn: what executes now, and what we owe the relay.
    const hash = hashOnly(this.world);
    const { execute, send } = this.sched.open(next, hash);
    for (const c of execute) {
      applyCommand(this.ch.commands, c);
      this.log.push({ tick: next, kind: c.kind, player: c.player });
    }

    // 3. the simulation, unchanged.
    this.ch.commands.drain((cmd) => { applyStub(this.world, cmd); });
    stepStub(this.world);

    return send;
  }
}

/**
 * Run both clients to `ticks`, routing every frame through the relay.
 *
 * `script` is called before each client's tick so a test can inject player
 * input at an exact moment — the same moment on both, since both are at the
 * same tick by construction.
 */
function runMatch(ticks: number, script?: (c: Client, tick: number) => void): {
  relay: TurnRelay; clients: Client[]; desyncs: number;
} {
  const clients = [new Client(0), new Client(1)];
  const relay = new TurnRelay(2, TURN_LOOKAHEAD);
  let desyncs = 0;

  for (let t = 1; t <= ticks; t++) {
    for (const c of clients) script?.(c, t);
    for (const c of clients) {
      const send = c.step();
      if (send === null) continue;
      const res = relay.submit({
        slot: c.slot, turn: send.turn, commands: send.commands, check: send.check,
      });
      if (!res.ok) continue;
      if (res.desync !== null) desyncs++;
      if (res.frame !== null) {
        for (const peer of clients) peer.sched.receiveFrame(res.frame.turn, res.frame.commands);
      }
    }
  }
  return { relay, clients, desyncs };
}

/* ========================================================================== */

describe('two clients stay one simulation', () => {
  it('agrees bit-for-bit over a match with traffic from both sides', () => {
    const { clients, desyncs } = runMatch(600, (c, t) => {
      // Both players issuing on different schedules, including the same tick.
      if (c.slot === 0 && t % 37 === 0) c.issueMove(CX + (t % 90));
      if (c.slot === 1 && t % 23 === 0) c.issueMove(CX - (t % 70));
      if (t % 101 === 0) c.issueStance(t % 202 === 0 ? Stance.HoldGround : Stance.Aggressive);
    });

    expect(desyncs, 'the relay must not report a divergence').toBe(0);
    expect(clients[0].tick).toBe(clients[1].tick);
    expect(hashOnly(clients[0].world)).toBe(hashOnly(clients[1].world));
    // And they really did play a match, rather than agreeing about nothing.
    expect(clients[0].log.length).toBeGreaterThan(30);
  });

  it('executes the identical commands in the identical order on both', () => {
    const { clients } = runMatch(400, (c, t) => {
      if (c.slot === 0 && t % 11 === 0) c.issueMove(CX + 20);
      if (c.slot === 1 && t % 11 === 0) c.issueMove(CX - 20);
    });
    // Same length, same tick, same kind, same owning slot, same sequence.
    expect(clients[0].log).toEqual(clients[1].log);
  });

  it('interleaves the two slots in slot order, not arrival order', () => {
    // Client 1 is stepped first in this scenario, but slot 0's block must still
    // come first in the merged frame — the ordering rule is stated, not emergent.
    const { clients } = runMatch(40, (c, t) => {
      if (t === 4) c.issueMove(CX + 5);
    });
    const executedAtOneTick = clients[0].log.filter((e) => e.tick === clients[0].log[0].tick);
    expect(executedAtOneTick.map((e) => e.player)).toEqual([0, 1]);
  });
});

describe('the delay is real, not decorative', () => {
  it('does not apply a local command on the tick it was issued', () => {
    const c = new Client(0);
    const relay = new TurnRelay(1, TURN_LOOKAHEAD);
    // Seed enough empty turns that stepping is never gated.
    const pump = (): void => {
      const send = c.step();
      if (send === null) return;
      const res = relay.submit({ slot: 0, turn: send.turn, commands: send.commands, check: send.check });
      if (res.ok && res.frame !== null) c.sched.receiveFrame(res.frame.turn, res.frame.commands);
    };

    for (let t = 0; t < 3; t++) pump();
    c.issueMove(CX + 40);
    const before = c.log.length;
    pump();
    expect(c.log.length, 'the click must not take effect this tick').toBe(before);

    // It must arrive, and at exactly TURN_DELAY turns later.
    for (let t = 0; t < TURN_TICKS * (TURN_DELAY + 2); t++) pump();
    expect(c.log.length).toBe(before + 1);
  });

  /**
   * THE LATENCY BAND, which is what the design actually promises.
   *
   * A click is harvested on the next tick and sealed at the next TURN BOUNDARY,
   * tagged `thatTurn + TURN_DELAY`. So the wait is TURN_DELAY turns plus
   * however much of the current turn was left when the click landed — never
   * less than TURN_DELAY turns, never as much as TURN_DELAY + 1.
   *
   * Both ends of that are load-bearing and neither is arbitrary. The floor is
   * the network budget: the frame goes out TURN_DELAY turns before it is
   * needed, which is the 200 ms a peer has to get it here. The ceiling is the
   * promise to the player — anything above it and the game feels laggy for a
   * reason no ping would explain.
   */
  it.each([1, 2, 3, 4, 5, 6])('lands a command inside the stated latency band (issued at tick %i)', (at) => {
    const c = new Client(0);
    const relay = new TurnRelay(1, TURN_LOOKAHEAD);
    const pump = (): void => {
      const send = c.step();
      if (send === null) return;
      const res = relay.submit({ slot: 0, turn: send.turn, commands: send.commands, check: send.check });
      if (res.ok && res.frame !== null) c.sched.receiveFrame(res.frame.turn, res.frame.commands);
    };

    for (let t = 1; t <= at; t++) pump();
    const issuedAt = c.tick;
    c.issueMove(CX + 40);
    for (let t = 0; t < 60; t++) pump();

    expect(c.log, 'the command must arrive exactly once').toHaveLength(1);
    const waited = c.log[0].tick - issuedAt;
    expect(waited).toBeGreaterThanOrEqual(TURN_TICKS * TURN_DELAY);
    expect(waited).toBeLessThanOrEqual(TURN_TICKS * (TURN_DELAY + 1));
  });
});

describe('a client cannot run ahead of the frame it is missing', () => {
  it('refuses to step a turn-opening tick with no frame', () => {
    const c = new Client(0);
    // Bootstrap turns are pre-seeded, so it runs until it needs a real frame.
    let steps = 0;
    while (c.ready && steps < 100) { c.step(); steps++; }
    expect(steps, 'it must stall rather than invent a frame').toBeLessThan(100);
    expect(c.sched.mayStep(c.tick + 1)).toBe(false);
    // The bootstrap covers exactly TURN_DELAY turns and not one tick more.
    expect(c.tick).toBe(TURN_TICKS * TURN_DELAY);
  });

  it('runs the ticks INSIDE a turn without waiting for anything', () => {
    const c = new Client(0);
    // Mid-turn ticks must never gate, or a 100 ms turn becomes a 100 ms hitch.
    for (let tick = 1; tick <= TURN_TICKS * TURN_DELAY; tick++) {
      if (!c.sched.opensTurn(tick)) expect(c.sched.mayStep(tick)).toBe(true);
    }
  });

  it('resumes the moment the frame arrives', () => {
    const c = new Client(0);
    while (c.ready) c.step();
    const stuckAt = c.tick;
    c.sched.receiveFrame(c.sched.turnOf(stuckAt + 1), []);
    expect(c.ready).toBe(true);
    c.step();
    expect(c.tick).toBe(stuckAt + 1);
  });
});

describe('the relay is the only thing that decides', () => {
  it('stamps the sender slot over whatever the client claimed', () => {
    const relay = new TurnRelay(2, TURN_LOOKAHEAD, 0); // firstTurn 0: hand-written turns, not scheduler-driven. See TurnRelay.nextTurn.
    const lie: WireCommand = {
      kind: CommandKind.Order, player: 0, order: OrderKind.Move, target: 0,
      x: CX, z: CX, defId: -1, tab: 0, cx: 1, cz: 1, stance: 0,
      queued: false, arg: 0, entities: [1],
    };
    // Slot 1 claims to be slot 0 — the classic "order the enemy's army" attempt.
    relay.submit({ slot: 0, turn: 0, commands: [], check: { tick: 1, hash: 1 } });
    const res = relay.submit({ slot: 1, turn: 0, commands: [lie], check: { tick: 1, hash: 1 } });

    expect(res.ok).toBe(true);
    if (!res.ok || res.frame === null) throw new Error('frame expected');
    expect(res.frame.commands).toHaveLength(1);
    expect(res.frame.commands[0].player, 'the claim must be overwritten').toBe(1);
  });

  it('reports a divergence rather than merging two different worlds', () => {
    const relay = new TurnRelay(2, TURN_LOOKAHEAD, 0); // firstTurn 0: hand-written turns, not scheduler-driven. See TurnRelay.nextTurn.
    relay.submit({ slot: 0, turn: 0, commands: [], check: { tick: 30, hash: 0xaaaa } });
    const res = relay.submit({ slot: 1, turn: 0, commands: [], check: { tick: 30, hash: 0xbbbb } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.desync).not.toBeNull();
    expect(res.desync?.tick).toBe(30);
    expect(res.desync?.hashes).toEqual([0xaaaa, 0xbbbb]);
  });

  it('says nothing when the two agree', () => {
    const relay = new TurnRelay(2, TURN_LOOKAHEAD, 0); // firstTurn 0: hand-written turns, not scheduler-driven. See TurnRelay.nextTurn.
    relay.submit({ slot: 0, turn: 0, commands: [], check: { tick: 30, hash: 0xcafe } });
    const res = relay.submit({ slot: 1, turn: 0, commands: [], check: { tick: 30, hash: 0xcafe } });
    expect(res.ok && res.desync).toBeNull();
  });

  it('refuses a turn already broadcast, and one too far ahead', () => {
    const relay = new TurnRelay(1, TURN_LOOKAHEAD, 0); // firstTurn 0: hand-written turns, not scheduler-driven. See TurnRelay.nextTurn.
    relay.submit({ slot: 0, turn: 0, commands: [], check: { tick: 1, hash: 0 } });
    const replayed = relay.submit({ slot: 0, turn: 0, commands: [], check: { tick: 1, hash: 0 } });
    expect(replayed).toEqual({ ok: false, code: 'duplicate-turn' });

    const far = relay.submit({
      slot: 0, turn: TURN_LOOKAHEAD + 5, commands: [], check: { tick: 1, hash: 0 },
    });
    expect(far, 'an unbounded lookahead is a memory attack').toEqual({
      ok: false, code: 'turn-out-of-window',
    });
  });

  it('refuses a second submission for a turn from the same slot', () => {
    const relay = new TurnRelay(2, TURN_LOOKAHEAD, 0); // firstTurn 0: hand-written turns, not scheduler-driven. See TurnRelay.nextTurn.
    relay.submit({ slot: 0, turn: 0, commands: [], check: { tick: 1, hash: 0 } });
    const again = relay.submit({ slot: 0, turn: 0, commands: [], check: { tick: 1, hash: 0 } });
    expect(again).toEqual({ ok: false, code: 'duplicate-turn' });
  });

  it('drops a whole submission that carries one invalid command, and still completes the turn', () => {
    const relay = new TurnRelay(2, TURN_LOOKAHEAD, 0); // firstTurn 0: hand-written turns, not scheduler-driven. See TurnRelay.nextTurn.
    const poison = {
      kind: CommandKind.Order, player: 1, order: OrderKind.Move, target: 0,
      x: Number.NaN, z: CX, defId: -1, tab: 0, cx: 1, cz: 1, stance: 0,
      queued: false, arg: 0, entities: [],
    };
    relay.submit({ slot: 0, turn: 0, commands: [], check: { tick: 1, hash: 0 } });
    const res = relay.submit({ slot: 1, turn: 0, commands: [poison], check: { tick: 1, hash: 0 } });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warning).toBe('invalid-command');
    expect(res.frame?.commands).toHaveLength(0);
    // THE POINT: the match is not hung. A malicious peer must not be able to
    // stop the turn from completing for everyone else.
    expect(res.frame?.turn).toBe(0);
  });

  it('lets the survivor keep playing when a slot is retired mid-turn', () => {
    const relay = new TurnRelay(2, TURN_LOOKAHEAD, 0); // firstTurn 0: hand-written turns, not scheduler-driven. See TurnRelay.nextTurn.
    relay.submit({ slot: 0, turn: 0, commands: [], check: { tick: 1, hash: 0 } });
    relay.submit({ slot: 0, turn: 1, commands: [], check: { tick: 4, hash: 0 } });
    expect(relay.openTurns).toBe(2);

    const completed = relay.retire(1);
    expect(completed.map((f) => f.turn), 'held turns must complete in order').toEqual([0, 1]);
    expect(relay.openTurns).toBe(0);
  });

  /**
   * THE REGRESSION. `retire` originally filled the departed slot's blank only
   * into the turns already open, so the survivor unfroze — and then their very
   * next turn opened a fresh accumulator that waited for the slot that had just
   * left, and they froze again for the whole grace period. Reading the code did
   * not catch it; `server/test/relay.spec.ts` did, on the first run.
   */
  it('never waits on a retired slot again, not even on a turn it has not seen yet', () => {
    const relay = new TurnRelay(2, TURN_LOOKAHEAD, 0); // firstTurn 0: hand-written turns, not scheduler-driven. See TurnRelay.nextTurn.
    relay.retire(1);
    for (let turn = 0; turn < 3; turn++) {
      const res = relay.submit({ slot: 0, turn, commands: [], check: { tick: turn * 3 + 1, hash: 0 } });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.frame, `turn ${turn} must complete on the survivor alone`).not.toBeNull();
      expect(res.frame?.turn).toBe(turn);
    }
  });

  it('refuses anything further from a slot that has been retired', () => {
    const relay = new TurnRelay(2, TURN_LOOKAHEAD, 0); // firstTurn 0: hand-written turns, not scheduler-driven. See TurnRelay.nextTurn.
    relay.retire(1);
    expect(relay.submit({ slot: 1, turn: 0, commands: [], check: { tick: 1, hash: 0 } }))
      .toEqual({ ok: false, code: 'not-in-match' });
  });
});

describe('the harness can actually detect a divergence', () => {
  /**
   * The control. Everything above is only worth reading if a deliberately
   * broken run FAILS — two worlds that ignore every command also agree.
   */
  it('catches a client that executed a DIFFERENT command', () => {
    const clients = [new Client(0), new Client(1)];
    const relay = new TurnRelay(2, TURN_LOOKAHEAD); // default firstTurn: driven by real TurnSchedulers, which start at TURN_DELAY.

    for (let t = 1; t <= 120; t++) {
      if (t === 10) clients[0].issueMove(CX + 30);
      for (const c of clients) {
        const send = c.step();
        if (send === null) continue;
        const res = relay.submit({
          slot: c.slot, turn: send.turn, commands: send.commands, check: send.check,
        });
        if (!res.ok || res.frame === null) continue;
        for (const peer of clients) {
          // THE SABOTAGE: slot 1 is handed the same commands with one
          // destination shifted a metre — well above Checksum's 1e-3 quantum.
          const commands = peer.slot === 1
            ? res.frame.commands.map((cmd) => ({ ...cmd, x: cmd.x + 1 }))
            : res.frame.commands;
          peer.sched.receiveFrame(res.frame.turn, commands);
        }
      }
    }
    expect(
      hashOnly(clients[0].world) === hashOnly(clients[1].world),
      'a diverged command stream must NOT produce an identical world',
    ).toBe(false);
  });

  /**
   * THE LIMIT OF THE CHECKSUM, ASSERTED RATHER THAN ASSUMED.
   *
   * A duplicated IDEMPOTENT command — a Move order applied twice — leaves the
   * world in the same state, so no state fingerprint can ever see it. That is
   * not a hole in `Checksum.ts`; it is what a state hash means. It is exactly
   * why `TurnRelay` rejects a duplicate submission STRUCTURALLY, by turn and
   * slot, instead of trusting the checksum to notice downstream.
   *
   * Written down because the obvious assumption — "the checksum catches
   * everything" — would make that rejection look like belt-and-braces and
   * invite somebody to delete it.
   */
  it('cannot see a duplicated idempotent command, which is why the relay rejects duplicates', () => {
    const clients = [new Client(0), new Client(1)];
    const relay = new TurnRelay(2, TURN_LOOKAHEAD); // default firstTurn: driven by real TurnSchedulers, which start at TURN_DELAY.

    for (let t = 1; t <= 120; t++) {
      if (t === 10) clients[0].issueMove(CX + 30);
      for (const c of clients) {
        const send = c.step();
        if (send === null) continue;
        const res = relay.submit({
          slot: c.slot, turn: send.turn, commands: send.commands, check: send.check,
        });
        if (!res.ok || res.frame === null) continue;
        for (const peer of clients) {
          const commands = peer.slot === 1
            ? [...res.frame.commands, ...res.frame.commands]
            : res.frame.commands;
          peer.sched.receiveFrame(res.frame.turn, commands);
        }
      }
    }
    expect(hashOnly(clients[0].world)).toBe(hashOnly(clients[1].world));
  });

  it('catches a client that skipped a turn', () => {
    const a = new Client(0);
    const b = new Client(1);
    const relay = new TurnRelay(2, TURN_LOOKAHEAD); // default firstTurn: driven by real TurnSchedulers, which start at TURN_DELAY.
    for (let t = 1; t <= 120; t++) {
      if (t === 10) a.issueMove(CX + 30);
      for (const c of [a, b]) {
        const send = c.step();
        if (send === null) continue;
        const res = relay.submit({
          slot: c.slot, turn: send.turn, commands: send.commands, check: send.check,
        });
        if (!res.ok || res.frame === null) continue;
        // THE SABOTAGE: slot 1 never hears about turn 6.
        for (const peer of [a, b]) {
          if (peer.slot === 1 && res.frame.turn === 6) continue;
          peer.sched.receiveFrame(res.frame.turn, res.frame.commands);
        }
      }
    }
    expect(a.tick, 'the starved client must stall, not guess').not.toBe(b.tick);
  });
});

describe('validateCommand refuses what the simulation must never see', () => {
  const good: WireCommand = {
    kind: CommandKind.Order, player: 0, order: OrderKind.Move, target: 0,
    x: CX, z: CX, defId: -1, tab: 0, cx: 4, cz: 4, stance: 0,
    queued: false, arg: 0, entities: [1, 2, 3],
  };

  it('accepts an ordinary command and returns a REBUILT object', () => {
    const res = validateCommand({ ...good });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual(good);
    // Rebuilt, so the entity array is not the caller's.
    expect(res.value.entities).not.toBe(good.entities);
  });

  it.each([
    ['a NaN coordinate', { x: Number.NaN }, 'bounds'],
    ['an Infinite coordinate', { z: Number.POSITIVE_INFINITY }, 'bounds'],
    ['a coordinate off the map', { x: MAP_SIZE + 1 }, 'bounds'],
    ['a negative coordinate', { z: -1 }, 'bounds'],
    ['a fractional grid cell', { cx: 4.5 }, 'bounds'],
    ['a grid cell off the map', { cz: 9999 }, 'bounds'],
    ['an unknown command kind', { kind: 99 }, 'kind'],
    ['an unknown order', { order: 99 }, 'order'],
    ['an unknown build tab', { tab: 99 }, 'tab'],
    ['an unknown stance', { stance: 99 }, 'stance'],
    ['a slot that is not a player', { player: 99 }, 'player'],
    ['a fractional entity handle', { entities: [1.5] }, 'entities'],
    ['a non-array entity list', { entities: 'all' }, 'entities'],
    ['a string where a boolean belongs', { queued: 'yes' }, 'shape'],
    ['a defId out of any table', { defId: 999999 }, 'bounds'],
  ])('refuses %s', (_label, patch, fault) => {
    const res = validateCommand({ ...good, ...patch });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fault).toBe(fault);
  });

  it('refuses an oversized entity list rather than truncating it', () => {
    const res = validateCommand({ ...good, entities: new Array(101).fill(1) });
    expect(res.ok).toBe(false);
    // Truncating would produce a DIFFERENT order, applied differently by two
    // implementations that disagree about where to cut.
    if (!res.ok) expect(res.fault).toBe('entities');
  });

  it('accepts a NEGATIVE entity handle, because late-game handles are negative', () => {
    // Generation >= 2048 shifted into bit 31 makes a real handle negative. A
    // validator demanding non-negative ids would reject ordinary units after
    // enough slot reuse — a bug that only appears in long matches.
    const res = validateCommand({ ...good, entities: [-2147483648], target: -1000000 });
    expect(res.ok).toBe(true);
  });

  it('strips anything it was not asked to carry', () => {
    const res = validateCommand({
      ...good, __proto__: { polluted: true }, extra: 'field', constructor: 'no',
    } as unknown);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.value).sort()).toEqual(Object.keys(good).sort());
    expect((res.value as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses things that are not commands at all', () => {
    for (const junk of [null, undefined, 42, 'move', [], [good]]) {
      expect(validateCommand(junk).ok, String(junk)).toBe(false);
    }
  });
});

/* ========================================================================== */

describe('the gate must exist before the first tick', () => {
  /**
   * THE BUG THAT MADE MULTIPLAYER COMPLETELY NON-FUNCTIONAL.
   *
   * `Shell.startMultiplayerMatch` used to attach the session AFTER
   * `await startMatch(...)` — by which point `Bootstrap` had already called
   * `loop.start()` and the loop had run several ticks. Tick 1 opens turn 0, and
   * a turn that opens with no scheduler installed never calls `open()`, so the
   * frame for turn 0 + TURN_DELAY is never sent BY EITHER CLIENT. Both then wait
   * forever for a frame neither produced: the simulation freezes at around tick
   * 7 and every order the player issues is harvested by nothing.
   *
   * Every existing test stayed green through this, because they all construct a
   * client and step it from tick 1 with the scheduler already in hand. The
   * failure lived entirely in the ORDER the shell did two things in.
   */
  it('a client that misses turn 0 never sends its first frame, and deadlocks', () => {
    const c = new Client(0);
    const relay = new TurnRelay(1, TURN_LOOKAHEAD);

    // Simulate the shell's old behaviour: ticks run before the gate exists, so
    // the scheduler never sees the turn-opening ticks that already went past.
    const UNGATED = TURN_TICKS * TURN_DELAY;
    for (let t = 0; t < UNGATED; t++) { c.tick++; c.world.tick = c.tick; }

    // From here the scheduler is live, but turn 0 and turn 1 opened while it
    // was not — so nothing was ever sent for turns 2 and 3.
    let sent = 0;
    for (let t = 0; t < 30; t++) {
      const send = c.step();
      if (send === null) continue;
      sent++;
      const res = relay.submit({ slot: 0, turn: send.turn, commands: send.commands, check: send.check });
      if (res.ok && res.frame !== null) c.sched.receiveFrame(res.frame.turn, res.frame.commands);
    }

    expect(sent, 'no frame can be sent — the deadlock').toBe(0);
    expect(c.tick, 'and the client is stuck exactly where the bootstrap left it').toBe(UNGATED);
    expect(c.sched.mayStep(c.tick + 1)).toBe(false);
  });

  it('a client whose scheduler is live from tick 1 sends every frame', () => {
    // The same run with the gate installed before the first tick. This is what
    // `net.system.init()` now guarantees by adopting a prepared session.
    const c = new Client(0);
    const relay = new TurnRelay(1, TURN_LOOKAHEAD);
    let sent = 0;
    for (let t = 0; t < 30; t++) {
      const send = c.step();
      if (send === null) continue;
      sent++;
      const res = relay.submit({ slot: 0, turn: send.turn, commands: send.commands, check: send.check });
      if (res.ok && res.frame !== null) c.sched.receiveFrame(res.frame.turn, res.frame.commands);
    }
    expect(sent).toBeGreaterThan(5);
    expect(c.tick).toBe(30);
  });

  it('net.system adopts a session prepared before the world exists', () => {
    // The mechanism, asserted from the source: `init()` runs inside
    // `registry.init()`, which Bootstrap calls BEFORE `loop.start()`, so a gate
    // installed there is in place for tick 1. Read rather than executed because
    // this suite has no DOM and no renderer to boot.
    const src = readFileSync(join(__dirname, '..', 'src', 'net', 'net.system.ts'), 'utf8');
    expect(src).toMatch(/export function prepareSession/);
    expect(src).toMatch(/init\(\)\s*:\s*void\s*\{[\s\S]{0,200}attachSession\(pending\)/);

    const shell = readFileSync(join(__dirname, '..', 'src', 'shell', 'Shell.ts'), 'utf8');
    const arm = shell.indexOf('session.startLockstep(info)');
    const boot = shell.indexOf('await this.startMatch(setup, { persist: false })');
    expect(arm, 'the shell must arm lockstep').toBeGreaterThan(-1);
    expect(boot).toBeGreaterThan(-1);
    expect(arm, 'and it must do so BEFORE booting the match').toBeLessThan(boot);
  });
});

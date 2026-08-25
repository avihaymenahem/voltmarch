/**
 * ============================================================================
 * tests/replay.spec.ts — the checksum, and lockstep replay on top of it
 * ============================================================================
 * "Every action, every click, every movement should be in a game log, so that
 *  if we want a replay right after, I'm just playing a series of event logs
 *  from a file, and I can see the exact replica of what happened."
 *
 * THE CHECKSUM IS TESTED FIRST AND HARDEST, because everything else is only
 * verifiable through it. A hash that cannot tell two different worlds apart
 * would make every replay test below pass while proving nothing — which is a
 * worse outcome than no replay at all, since it would be believed.
 *
 * So the checksum cases come in pairs: one that it must NOT react to (slot
 * recycling order, a render-owned column, sub-millimetre float noise) and one
 * that it MUST (a unit one metre away, a credit spent, a queue item).
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import {
  CommandKind, EntityFlag, EntityKind, Faction, OrderKind, Stance,
} from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';
import { MAP_SIZE } from '../src/core/config';
import { QUANT, checksum, describeDivergence, hashOnly } from '../src/game/Checksum';
import {
  REPLAY_FORMAT_VERSION, ReplayPlayer, ReplayRecorder, parseReplay,
} from '../src/game/Replay';
import type { ReplayHeader } from '../src/game/Replay';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;
const CX = MAP_SIZE * 0.5;

function makeWorld(): World {
  const w = new World();
  w.addPlayer(Faction.Allies, 'Commander', true, true);
  w.addPlayer(Faction.Soviets, 'Opponent', false, false);
  return w;
}

function spawn(w: World, x: number, z: number, owner: PlayerId = P0): EntityId {
  const s = w.store;
  const h = s.alloc(EntityKind.Vehicle, 3, owner, Faction.Allies, x, 0, z, 0);
  const i = s.index(h);
  s.hp[i] = 300; s.maxHp[i] = 300; s.radius[i] = 2;
  s.flags[i] |= EntityFlag.CanMove | EntityFlag.ProvidesVision;
  return h;
}

const HEADER: ReplayHeader = {
  formatVersion: REPLAY_FORMAT_VERSION,
  buildVersion: 'test',
  mapSeed: 0x51c0de,
  simSeed: 4242,
  mapPreset: 'temperate',
  biome: 'temperate',
  art: 'noon',
  start: 'mcv',
  scenario: 'skirmish',
  localPlayer: 0,
  players: [
    { faction: Faction.Allies, isHuman: true, aiDifficulty: 0, aiPersonality: 0, credits: 10000 },
    { faction: Faction.Soviets, isHuman: false, aiDifficulty: 1, aiPersonality: 0, credits: 10000 },
  ],
};

/* ========================================================================== */

describe('the checksum reacts to what matters', () => {
  it('is stable for a world that has not changed', () => {
    const w = makeWorld();
    spawn(w, CX, CX);
    const a = hashOnly(w);
    for (let k = 0; k < 5; k++) expect(hashOnly(w)).toBe(a);
  });

  it('changes when a unit moves a metre', () => {
    const w = makeWorld();
    const h = spawn(w, CX, CX);
    const before = hashOnly(w);
    w.store.posX[w.store.index(h)] += 1;
    expect(hashOnly(w)).not.toBe(before);
  });

  it('changes when a player spends a credit', () => {
    const w = makeWorld();
    spawn(w, CX, CX);
    const before = hashOnly(w);
    w.player(P0).credits -= 1;
    expect(hashOnly(w)).not.toBe(before);
  });

  it('changes when hit points change', () => {
    const w = makeWorld();
    const h = spawn(w, CX, CX);
    const before = hashOnly(w);
    w.store.hp[w.store.index(h)] -= 1;
    expect(hashOnly(w)).not.toBe(before);
  });

  it('changes when a unit is added or removed', () => {
    const w = makeWorld();
    const a = hashOnly(w);
    const h = spawn(w, CX, CX);
    const b = hashOnly(w);
    expect(b).not.toBe(a);
    w.store.markDead(h);
    w.store.flushDestroyed();
    expect(hashOnly(w)).not.toBe(b);
  });

  it('changes when an order changes but nothing has moved yet', () => {
    // The classic silent divergence: two runs look identical on the field and
    // are already heading different places.
    const w = makeWorld();
    const h = spawn(w, CX, CX);
    const before = hashOnly(w);
    const i = w.store.index(h);
    w.store.orderKind[i] = OrderKind.Move;
    w.store.orderX[i] = CX + 40;
    expect(hashOnly(w)).not.toBe(before);
  });
});

/* ========================================================================== */

describe('the checksum ignores what does not matter', () => {
  it('does not care which ORDER the live list is in', () => {
    // `alive[]` follows the free list, so two runs that recycled slots in a
    // different order are the same world. A sequential fold would call that a
    // desync and train everyone to ignore the hash.
    const a = makeWorld();
    spawn(a, CX, CX);
    spawn(a, CX + 10, CX);
    spawn(a, CX + 20, CX);

    const b = makeWorld();
    // Same three units, built in a different order and with a slot recycled.
    const scratch = spawn(b, 1, 1);
    spawn(b, CX + 20, CX);
    b.store.markDead(scratch);
    b.store.flushDestroyed();
    spawn(b, CX, CX);
    spawn(b, CX + 10, CX);

    // Handles differ (generation stamps), so the hashes cannot be compared
    // directly — but the SUM must be order-independent, which is what this
    // proves: reversing one world's alive list changes nothing.
    const before = hashOnly(a);
    const alive = a.store.alive.slice(0, a.store.aliveCount).reverse();
    a.store.alive.set(alive, 0);
    expect(hashOnly(a)).toBe(before);
  });

  it('ignores render-owned columns', () => {
    // `animTime` is written by `render/unit-anim.system.ts` from WALL-CLOCK dt.
    // Hashing it would report a desync between two machines at different frame
    // rates whose simulations were in perfect lockstep.
    const w = makeWorld();
    const h = spawn(w, CX, CX);
    const before = hashOnly(w);
    const i = w.store.index(h);
    w.store.animTime[i] = 0.37;
    w.store.prevX[i] += 5;
    expect(hashOnly(w)).toBe(before);
  });

  it('ignores local selection and hover flags', () => {
    // Two network peers look through different players' eyes. Their local
    // selection and cursor hover must therefore be allowed to differ without
    // declaring the shared simulation desynchronised.
    const w = makeWorld();
    const h = spawn(w, CX, CX);
    const before = hashOnly(w);
    const i = w.store.index(h);
    w.store.flags[i] |= EntityFlag.Selected | EntityFlag.Hovered;
    expect(hashOnly(w)).toBe(before);
  });

  it('ignores float noise below the quantum', () => {
    // 59 transcendental call sites remain in src/sim, and Math.sin is not
    // specified to bit precision. A raw bit hash would scream desync on frame
    // one between two browsers running the identical simulation.
    const w = makeWorld();
    const h = spawn(w, CX, CX);
    const before = hashOnly(w);
    w.store.posX[w.store.index(h)] += QUANT * 0.2;
    expect(hashOnly(w)).toBe(before);
  });

  it('but still catches a divergence just above the quantum', () => {
    // The other half of the trade, stated so the tolerance cannot quietly grow.
    const w = makeWorld();
    const h = spawn(w, CX, CX);
    const before = hashOnly(w);
    w.store.posX[w.store.index(h)] += QUANT * 4;
    expect(hashOnly(w)).not.toBe(before);
  });

  it('gives a NaN a stable hash rather than propagating one', () => {
    // NaN !== NaN, so two runs with the SAME NaN must still agree — otherwise
    // a real bug becomes an unreproducible one.
    const a = makeWorld();
    const b = makeWorld();
    const ha = spawn(a, CX, CX);
    const hb = spawn(b, CX, CX);
    a.store.posX[a.store.index(ha)] = NaN;
    b.store.posX[b.store.index(hb)] = NaN;
    expect(hashOnly(a)).toBe(hashOnly(b));
    // And it must not read as a legitimate zero.
    const c = makeWorld();
    const hc = spawn(c, CX, CX);
    c.store.posX[c.store.index(hc)] = 0;
    expect(hashOnly(a)).not.toBe(hashOnly(c));
  });
});

/* ========================================================================== */

describe('a divergence says where, not just that', () => {
  it('names the block that differs', () => {
    const a = makeWorld();
    const b = makeWorld();
    spawn(a, CX, CX);
    spawn(b, CX, CX);
    b.player(P0).credits -= 500;
    const msg = describeDivergence(checksum(a), checksum(b));
    expect(msg).toContain('players differ');
    expect(msg).not.toContain('entities differ');
  });

  it('reports the tick', () => {
    const a = makeWorld();
    const b = makeWorld();
    a.tick = 4812; b.tick = 4812;
    spawn(a, CX, CX);
    spawn(b, CX + 9, CX);
    expect(describeDivergence(checksum(a), checksum(b))).toContain('tick 4812');
  });

  it('says nothing at all when the two agree', () => {
    const a = makeWorld();
    const b = makeWorld();
    expect(describeDivergence(checksum(a), checksum(b))).toBe('');
  });
});

/* ========================================================================== */

describe('the recorder captures each command exactly once', () => {
  it('logs ONE entry for one action, even when a consumer parks and re-issues it', () => {
    /*
     * THE BUG THIS FILE ORIGINALLY SHIPPED WITH, found by playing rather than
     * by testing. The header used to claim the drain was "where a command
     * passes exactly once". It is not: a re-issue is a NEW command object that
     * passes the drain again, and a live match logged one human placement THREE
     * times — a replay would have built three power plants for one click.
     *
     * This is the case that was missing. It drives the real shape: issue once,
     * drain, then re-issue the way `reissueParked` does, and drain again.
     */
    const ch = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(ch);

    ch.commands.tick = 5;
    ch.commands.issuePlaceBuilding(P0, 3, 10, 20, 90);
    // Pass one: a consumer that cannot handle it parks it.
    ch.commands.drain(() => {});
    expect(rec.commandCount, 'the original must be recorded').toBe(1);

    // Pass two: the consumer puts it back for a later phase.
    ch.commands.markReissue(() => {
      ch.commands.issuePlaceBuilding(P0, 3, 10, 20, 90);
    });
    ch.commands.drain(() => {});
    expect(rec.commandCount, 'a re-issue is a continuation, not a new intent').toBe(1);

    // Pass three: and again, which is what actually happened in the match.
    ch.commands.markReissue(() => {
      ch.commands.issuePlaceBuilding(P0, 3, 10, 20, 90);
    });
    ch.commands.drain(() => {});
    expect(rec.commandCount).toBe(1);
  });

  it('still records a genuinely repeated action', () => {
    // The other half. `markReissue` must not become a way to lose real input:
    // a player clicking twice is two commands.
    const ch = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(ch);
    ch.commands.issuePlaceBuilding(P0, 3, 10, 20, 0);
    ch.commands.issuePlaceBuilding(P0, 3, 11, 21, 0);
    ch.commands.drain(() => {});
    expect(rec.commandCount).toBe(2);
  });

  it('closes the reissue window even when the callback throws', () => {
    // Otherwise one bad re-issue silently stops the recorder for the rest of
    // the match, and the replay is quietly missing everything after it.
    const ch = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(ch);
    expect(() => ch.commands.markReissue(() => { throw new Error('boom'); })).toThrow();
    ch.commands.issuePlaceBuilding(P0, 3, 1, 2, 0);
    ch.commands.drain(() => {});
    expect(rec.commandCount, 'recording must resume after a throw').toBe(1);
  });

  it('records on the DRAIN, so every drainer is covered', () => {
    // Two consumers park commands and re-issue them. A hook on `issue*` would
    // record most kinds three times, and the replay would then apply them three
    // times. The tap is on the drain, where a command passes once.
    const ch = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(ch);

    ch.commands.tick = 7;
    ch.commands.issueProductionStart(P0, 0, 3, 1);
    ch.commands.drain(() => { /* a consumer that does nothing */ });
    expect(rec.commandCount).toBe(1);

    // Re-issuing the same intent next tick is a SECOND command, correctly.
    ch.commands.tick = 8;
    ch.commands.issueProductionStart(P0, 0, 3, 1);
    ch.commands.drain(() => {});
    expect(rec.commandCount).toBe(2);
  });

  it('stamps the APPLY tick, not the issue tick', () => {
    // A command issued from a DOM handler between ticks carries N-1 and applies
    // on N. Playback re-issues by apply tick, so that is what must be stored.
    const ch = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(ch);
    ch.commands.tick = 41;
    ch.commands.issueSetRally(P0, 1 as EntityId, 10, 20);
    ch.commands.tick = 42;              // the tick actually advanced first
    ch.commands.drain(() => {});
    expect(rec.build().commands[0]!.tick).toBe(42);
  });

  it('copies the entity list out of the shared arena', () => {
    // `cmd.entities` is a subarray view that dies with the drain. If it were
    // retained, every recorded order would end up holding whatever the LAST
    // command in the tick wrote.
    const ch = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(ch);
    ch.commands.issueOrder(P0, OrderKind.Move, [11, 22, 33], 3, 1, 2, 0 as EntityId, false);
    ch.commands.issueOrder(P0, OrderKind.Move, [99], 1, 5, 6, 0 as EntityId, false);
    ch.commands.drain(() => {});
    const cmds = rec.build().commands;
    expect(cmds[0]!.entities).toEqual([11, 22, 33]);
    expect(cmds[1]!.entities).toEqual([99]);
  });

  it('records a command even when its handler rejects it', () => {
    // A replay must reproduce the rejection. A log that omits refused commands
    // diverges the moment the refusal depends on state the replay rebuilds a
    // tick differently.
    const ch = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(ch);
    ch.commands.issueSell(P0, 404 as EntityId);
    ch.commands.drain(() => { /* handler ignores it entirely */ });
    expect(rec.commandCount).toBe(1);
  });

  it('stops recording on detach', () => {
    const ch = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(ch);
    ch.commands.issueSelfDestruct(P0, 1 as EntityId);
    ch.commands.drain(() => {});
    rec.detach();
    ch.commands.issueSelfDestruct(P0, 2 as EntityId);
    ch.commands.drain(() => {});
    expect(rec.commandCount).toBe(1);
  });

  it('stamps a checkpoint on the interval and not between', () => {
    const w = makeWorld();
    const rec = new ReplayRecorder(HEADER);
    for (let t = 0; t <= 90; t++) {
      w.tick = t;
      rec.maybeCheckpoint(w);
    }
    // 0, 30, 60, 90.
    expect(rec.checkCount).toBe(4);
    expect(rec.build().checks.map((c) => c.tick)).toEqual([0, 30, 60, 90]);
  });
});

/* ========================================================================== */

describe('the file refuses what it cannot replay exactly', () => {
  it('round-trips', () => {
    const ch = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(ch);
    ch.commands.issueOrder(P0, OrderKind.Move, [1, 2], 2, 30, 40, 0 as EntityId, true);
    ch.commands.drain(() => {});
    const parsed = parseReplay(rec.serialise());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.commands).toHaveLength(1);
    expect(parsed.value.commands[0]!.entities).toEqual([1, 2]);
    expect(parsed.value.header.mapSeed).toBe(HEADER.mapSeed);
  });

  it('refuses a format version it does not know', () => {
    // Half-reading a file it does not understand is a desync with extra steps.
    const bad = JSON.stringify({
      header: { ...HEADER, formatVersion: 999 }, commands: [], checks: [],
    });
    const r = parseReplay(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('999');
  });

  it('refuses an out-of-order stream', () => {
    // Playback walks the stream with a cursor and never rewinds, so an
    // out-of-order entry would be silently skipped — a command that never
    // applies and a desync with no visible cause.
    const bad = JSON.stringify({
      header: HEADER,
      commands: [
        { tick: 10, kind: 1, player: 0, order: 1, target: 0, x: 0, z: 0, defId: -1, tab: 0, cx: 0, cz: 0, stance: 0, queued: false, arg: 0, entities: [] },
        { tick: 4, kind: 1, player: 0, order: 1, target: 0, x: 0, z: 0, defId: -1, tab: 0, cx: 0, cz: 0, stance: 0, queued: false, arg: 0, entities: [] },
      ],
      checks: [],
    });
    const r = parseReplay(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('out of order');
  });

  it('refuses junk', () => {
    for (const junk of ['', 'not json', '[]', '{}', '{"header":{}}']) {
      expect(parseReplay(junk).ok, junk).toBe(false);
    }
  });
});

/* ========================================================================== */

describe('playback re-runs the match', () => {
  /**
   * The end-to-end property, and the reason all of the above exists: record a
   * stream against one world, feed it to a second world built the same way, and
   * the checkpoints must agree at every step.
   */
  it('reproduces a world exactly, and the checkpoints prove it', () => {
    // -- record --------------------------------------------------------
    const liveWorld = makeWorld();
    const liveCh = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(liveCh);

    const a = spawn(liveWorld, CX, CX);
    const b = spawn(liveWorld, CX + 8, CX, P1);

    for (let t = 0; t <= 60; t++) {
      liveWorld.tick = t;
      liveCh.commands.tick = t;
      if (t === 5) {
        liveCh.commands.issueOrder(liveWorld.localPlayer, OrderKind.Move,
          [a as number], 1, CX + 30, CX + 30, 0 as EntityId, false);
      }
      if (t === 20) liveCh.commands.issueSetStance(P0, [a as number], 1, Stance.HoldGround);
      if (t === 40) {
        liveCh.commands.issueOrder(P1, OrderKind.Attack,
          [b as number], 1, CX, CX, a, false);
      }
      // A stand-in for the sim: apply the orders the same way both runs will.
      liveCh.commands.drain((cmd) => { applyStub(liveWorld, cmd); });
      stepStub(liveWorld);
      rec.maybeCheckpoint(liveWorld);
    }

    const parsed = parseReplay(rec.serialise());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.commands.length).toBe(3);
    expect(parsed.value.checks.length).toBeGreaterThan(1);

    // -- replay --------------------------------------------------------
    const replayWorld = makeWorld();
    const replayCh = new Channels();
    spawn(replayWorld, CX, CX);
    spawn(replayWorld, CX + 8, CX, P1);

    const player = new ReplayPlayer(parsed.value);
    for (let t = 0; t <= 60; t++) {
      replayWorld.tick = t;
      replayCh.commands.tick = t;
      player.issueFor(t, replayCh);
      replayCh.commands.drain((cmd) => { applyStub(replayWorld, cmd); });
      stepStub(replayWorld);
      player.verify(replayWorld);
    }

    expect(player.status.desync, 'the replay must not diverge').toBe('');
    expect(player.status.issued).toBe(3);
    expect(player.status.verified).toBeGreaterThan(1);
    expect(player.finished).toBe(true);
    // And the two worlds really are the same world, not merely un-diverged.
    expect(hashOnly(replayWorld)).toBe(hashOnly(liveWorld));
  });

  it('REPORTS a desync rather than passing quietly', () => {
    // The test that makes the test above mean something. If playback cannot
    // detect a deliberately corrupted run, a green result proves nothing.
    const liveWorld = makeWorld();
    const liveCh = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(liveCh);
    const a = spawn(liveWorld, CX, CX);
    for (let t = 0; t <= 60; t++) {
      liveWorld.tick = t;
      liveCh.commands.tick = t;
      if (t === 5) {
        liveCh.commands.issueOrder(P0, OrderKind.Move, [a as number], 1,
          CX + 30, CX, 0 as EntityId, false);
      }
      liveCh.commands.drain((cmd) => { applyStub(liveWorld, cmd); });
      stepStub(liveWorld);
      rec.maybeCheckpoint(liveWorld);
    }

    const parsed = parseReplay(rec.serialise());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const replayWorld = makeWorld();
    const replayCh = new Channels();
    const ra = spawn(replayWorld, CX, CX);
    const player = new ReplayPlayer(parsed.value);
    for (let t = 0; t <= 60; t++) {
      replayWorld.tick = t;
      replayCh.commands.tick = t;
      player.issueFor(t, replayCh);
      replayCh.commands.drain((cmd) => { applyStub(replayWorld, cmd); });
      stepStub(replayWorld);
      // THE SABOTAGE: nudge one unit half-way through, well above the quantum.
      if (t === 31) replayWorld.store.posZ[replayWorld.store.index(ra)] += 3;
      player.verify(replayWorld);
    }
    expect(player.status.desync, 'a corrupted replay must be caught').not.toBe('');
    expect(player.status.desync).toContain('tick');
  });

  it('names an unknown command kind instead of dropping it', () => {
    // A CommandKind added without a format bump. Silence here would be a
    // replay that is quietly missing a verb.
    const file = {
      header: HEADER,
      commands: [{
        tick: 0, kind: 250, player: 0, order: 0, target: 0, x: 0, z: 0,
        defId: -1, tab: 0, cx: 0, cz: 0, stance: 0, queued: false, arg: 0, entities: [],
      }],
      checks: [],
    };
    const parsed = parseReplay(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const p = new ReplayPlayer(parsed.value);
    p.issueFor(0, new Channels());
    expect(p.status.desync).toContain('unknown command kind 250');
  });
});

/* --------------------------------------------------------------------------
 * A deliberately tiny stand-in for the simulation.
 *
 * The real sim is exercised by the rest of the suite; what these cases need is
 * a rule that is deterministic, state-dependent and shared by both runs, so
 * that a divergence can only come from the replay machinery. Anything more
 * would be testing Movement.ts through the replay, which is not the subject.
 * -------------------------------------------------------------------------- */

function applyStub(w: World, cmd: { kind: number; entities: Int32Array; entityCount: number; order: number; x: number; z: number; stance: number; target: number }): void {
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

/** Move every ordered unit one fixed step toward its order point. */
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

/* ========================================================================== */

describe('the recorder is actually wired into the game', () => {
  const read = (rel: string): string =>
    (require('node:fs') as typeof import('node:fs'))
      .readFileSync(require('node:path').join(__dirname, '..', '..', '..', rel), 'utf8');

  it('registers a system, so the glob discovers it', async () => {
    // A module that is not named `*.system.ts` registers nothing and logs
    // nothing — "silent registration failure" is on CLAUDE.md's list of things
    // that have gone wrong before.
    const mods = import.meta.glob('../src/game/*.system.ts');
    expect(Object.keys(mods)).toContain('../src/game/replay.system.ts');
    const mod = (await import('../src/game/replay.system')).default;
    expect(mod.id).toBe('game.replay');
    expect(typeof mod.simTick).toBe('function');
  });

  it('runs AFTER the command executor drains the bus', () => {
    // `OrderExecutor.tick()` is at the end of Phase.Command and is what
    // triggers the observer. A checkpoint taken before it would describe the
    // world the commands had not been applied to yet, and every replay would
    // diverge by exactly one tick.
    const src = read('apps/game/src/game/replay.system.ts');
    const order = /order:\s*(\d+)/.exec(src);
    expect(order).not.toBeNull();
    expect(Number(order![1])).toBeGreaterThan(9000);
  });

  it('taps the drain, not the issue path', () => {
    // The single most important line in the whole feature. See trap 2.
    expect(read('apps/game/src/core/events.ts')).toMatch(/if \(obs !== null\) obs\(cmd\);/);
  });

  it('refuses to verify against a different map rather than reporting nonsense', () => {
    expect(read('apps/game/src/game/replay.system.ts')).toContain('boot the same seed first');
  });
});

/* ========================================================================== */

describe('every command kind the game can issue is replayable', () => {
  /**
   * THE FAILURE THIS PREVENTS is silent and total: a kind the player can issue
   * but the replayer cannot re-issue makes every recording containing it wrong,
   * and nothing anywhere says so. `ReplayPlayer.issue`'s default branch reports
   * an unknown kind, but only if the kind reaches it — a kind nobody thought
   * about is a kind nobody tested.
   *
   * So this walks the ENUM rather than a hand-written list.
   */
  it('has a branch for each one', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const at = (rel: string): string => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');
    // The switch used to be inside `ReplayPlayer.issue`. It now lives in
    // `src/net/applyCommand.ts`, shared with the multiplayer client, because
    // re-issuing a recorded command and re-issuing a received one are the same
    // operation — see that file's header. This test follows it rather than
    // being deleted, and it now guards BOTH paths at once.
    const src = at('apps/game/src/net/applyCommand.ts');
    // Every value declared in CommandKind, read from the source of truth.
    const types = at('packages/game-types/src/index.ts');
    const block = types.slice(
      types.indexOf('export const enum CommandKind'),
      types.indexOf('}', types.indexOf('export const enum CommandKind')),
    );
    const names = Array.from(block.matchAll(/^\s{2}(\w+)\s*=\s*\d+,/gm)).map((m) => m[1]!);
    expect(names.length, 'the enum must have been parsed').toBeGreaterThan(5);
    for (const name of names) {
      if (name === 'None') continue;
      expect(src, `ReplayPlayer cannot re-issue CommandKind.${name}`)
        .toContain(`case CommandKind.${name}:`);
    }
  });

  it('round-trips a relocation, the newest kind', async () => {
    const { CommandKind: CK } = await import('../src/core/types');
    const ch = new Channels();
    const rec = new ReplayRecorder(HEADER);
    rec.attach(ch);
    ch.commands.issueRelocate(P0, 77 as EntityId, 12, 34, 90);
    ch.commands.drain(() => {});
    const parsed = parseReplay(rec.serialise());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const c = parsed.value.commands[0]!;
    expect(c.kind).toBe(CK.Relocate);
    expect(c.target).toBe(77);
    expect(c.cx).toBe(12);
    expect(c.cz).toBe(34);
    expect(c.arg).toBe(90);

    // And it must actually go back onto a bus.
    const out = new Channels();
    const seen: number[] = [];
    new ReplayPlayer(parsed.value).issueFor(0, out);
    out.commands.drain((cmd) => { seen.push(cmd.kind as number); });
    expect(seen).toEqual([CK.Relocate]);
  });
});

/* ========================================================================== */

describe('the human and the AI now issue the same commands', () => {
  const raw = (rel: string): string =>
    (require('node:fs') as typeof import('node:fs'))
      .readFileSync(require('node:path').join(__dirname, '..', '..', '..', rel), 'utf8');

  /**
   * Source with comments stripped.
   *
   * Placement.ts DOCUMENTS what it used to call — "this used to call
   * `service.placeBuilding(...)` directly" — so a naive grep for the old
   * behaviour finds the explanation of the fix and fails. Comments are prose;
   * only the code is the behaviour. (Same reason `shroud-split.spec.ts` does
   * this.)
   */
  const read = (rel: string): string => raw(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  /**
   * CLAUDE.md: "The AI issues the same commands the player does, through
   * `channels.command`." core/types.ts: "Human input and the AI issue the
   * IDENTICAL Command struct."
   *
   * Both were FALSE for the two most common structural actions in the game.
   * Building placement wrote straight into ProductionService's private intent
   * queue, one layer below the bus, where the AI's PlaceBuilding command also
   * lands — so the two players converged BENEATH the recording point and the
   * human's half was invisible. Relocation had no CommandKind at all.
   */
  it('routes human building placement through issuePlaceBuilding', () => {
    const src = read('apps/game/src/sim/Placement.ts');
    expect(src).toContain('issuePlaceBuilding(');
    // And the direct call must be gone from the commit path.
    const commit = src.slice(src.indexOf('  commit('), src.indexOf('  beginRelocate('));
    expect(commit, 'commit() must not write to the intent queue directly')
      .not.toMatch(/service\.placeBuilding\(/);
  });

  it('routes human relocation through issueRelocate', () => {
    const src = read('apps/game/src/sim/Placement.ts');
    expect(src).toContain('issueRelocate(');
    const commit = src.slice(src.indexOf('  commit('), src.length);
    const body = commit.slice(0, commit.indexOf('\n  beginRelocate') + 1 || 4000);
    expect(body, 'commit() must not call the seam directly to MOVE anything')
      .not.toMatch(/seam\.commit\(|relocateSeamOf\(\)\?\.commit\(/);
  });

  it('handles Relocate in the ONE drainer, not a second one', () => {
    // `CommandBus.drain` is destructive and resets the whole ring. A second
    // drainer inside Phase.Command would eat every command `reissueParked` had
    // just put back for Phase.Production — silently, with no error anywhere.
    expect(read('apps/game/src/input/Commands.ts')).toContain('case CommandKind.Relocate:');
    expect(read('apps/game/src/sim/relocate.system.ts'),
      'sim.relocate must not drain the bus').not.toMatch(/commands\.drain\(/);
  });
});

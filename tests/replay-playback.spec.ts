/**
 * ============================================================================
 * tests/replay-playback.spec.ts — watching a recording, and the traps in it
 * ============================================================================
 * `replay.spec.ts` proves the checksum, the recorder and the file format.
 * This one is about the half that was missing until now: feeding a recording
 * back into a live world from the product's own UI.
 *
 * THE FAILURES BEING GUARDED ARE ALL THE SAME SHAPE — a world built slightly
 * differently from the one that was recorded, which then plays a plausible,
 * completely different match. None of them looks like a bug on screen. Each
 * one is a single field, and each one has a case here:
 *
 *   - the header not carrying the sim seed at all (v1 did not);
 *   - the header recording Bootstrap's placeholder players instead of the
 *     lobby's, because it was taken before the shell had written them;
 *   - the starting bank, which is a per-client lobby row;
 *   - the unlock gate, which answers from the LOCAL PROFILE while the STARTING
 *     ARMY is being spawned — the exact defect multiplayer hit;
 *   - the opening (`?start=`), a per-client stored preference;
 *   - a viewer's own click landing on the bus mid-playback.
 * ============================================================================
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import { CommandKind, EntityFlag, EntityKind, Faction, OrderKind } from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';
import { MAP_SIZE } from '../src/core/config';
import { hashOnly } from '../src/game/Checksum';
import {
  REPLAY_FORMAT_VERSION, ReplayRecorder, buildWarning, parseReplay,
} from '../src/game/Replay';
import type { ReplayFile, ReplayHeader } from '../src/game/Replay';
import {
  adoptPreparedPlayback,
  playbackActive,
  playbackIssue,
  playbackReport,
  playbackVerify,
  preparePlayback,
} from '../src/game/Playback';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;
const CX = MAP_SIZE * 0.5;

const read = (rel: string): string =>
  (require('node:fs') as typeof import('node:fs'))
    .readFileSync(require('node:path').join(__dirname, '..', rel), 'utf8');

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

/** A deterministic, state-dependent stand-in for the simulation. */
function applyStub(
  w: World,
  cmd: { kind: number; entities: Int32Array; entityCount: number; order: number; x: number; z: number; target: number },
): void {
  const s = w.store;
  if (cmd.kind !== CommandKind.Order) return;
  for (let e = 0; e < cmd.entityCount; e++) {
    const i = s.index(cmd.entities[e] as EntityId);
    if (i < 0) continue;
    s.orderKind[i] = cmd.order;
    s.orderX[i] = cmd.x;
    s.orderZ[i] = cmd.z;
    s.targetId[i] = cmd.target;
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

/** Record a short match and return the file plus the world it produced. */
function recordRun(): { file: ReplayFile; hash: number } {
  const world = makeWorld();
  const ch = new Channels();
  const rec = new ReplayRecorder({ ...HEADER, players: [] });
  rec.attach(ch);

  const a = spawn(world, CX, CX);
  const b = spawn(world, CX + 8, CX, P1);

  for (let t = 1; t <= 90; t++) {
    world.tick = t;
    ch.commands.tick = t;
    rec.captureStart(world);
    if (t === 5) {
      ch.commands.issueOrder(P0, OrderKind.Move, [a as number], 1, CX + 30, CX + 30, 0 as EntityId, false);
    }
    if (t === 41) {
      ch.commands.issueOrder(P1, OrderKind.Attack, [b as number], 1, CX, CX, a, false);
    }
    ch.commands.drain((cmd) => { applyStub(world, cmd); });
    stepStub(world);
    rec.maybeCheckpoint(world);
  }

  const parsed = parseReplay(rec.serialise());
  if (!parsed.ok) throw new Error(`the recorder produced an unreadable file: ${parsed.reason}`);
  return { file: parsed.value, hash: hashOnly(world) };
}

/* ========================================================================== */

describe('the header carries everything the world is built from', () => {
  it('records the SIM seed as well as the terrain seed', () => {
    // v1 stored `mapSeed` — the landform roll — and nothing else, so a replay
    // could reproduce the hills and not one draw of `s.rng`.
    const { file } = recordRun();
    expect(file.header.simSeed).toBe(4242);
    expect(file.header.mapSeed).not.toBe(file.header.simSeed);
  });

  it('records the opening, which is otherwise a stored per-client preference', () => {
    const { file } = recordRun();
    expect(file.header.start).toBe('mcv');
  });

  it('takes the player table on the first TICK, not at init', () => {
    /*
     * THE BUG THIS EXISTS FOR. `init()` runs inside `registry.init()`, and the
     * shell writes the chosen factions after `bootstrap()` RETURNS and the
     * starting bank after `await game.ready`. A header taken at init therefore
     * records Bootstrap's two placeholder players — every recording said
     * Allies vs Soviets on 10000 credits no matter what was picked.
     */
    const world = makeWorld();
    const rec = new ReplayRecorder({ ...HEADER, players: [], localPlayer: 0 });

    // What the shell does after the recorder was constructed.
    world.player(P1).faction = Faction.Meridian;
    world.player(P0).credits = 20000;
    world.player(P1).credits = 20000;
    world.localPlayer = P1;

    world.tick = 1;
    rec.captureStart(world);

    const h = rec.build().header;
    expect(h.players[1]!.faction).toBe(Faction.Meridian as number);
    expect(h.players[0]!.credits).toBe(20000);
    expect(h.players[0]!.name).toBe('Commander');
    expect(h.players[1]!.name).toBe('Opponent');
    expect(h.localPlayer).toBe(1);
  });

  it('only takes it once, so a later spend cannot rewrite the opening bank', () => {
    const world = makeWorld();
    const rec = new ReplayRecorder({ ...HEADER, players: [] });
    world.player(P0).credits = 20000;
    rec.captureStart(world);
    world.player(P0).credits = 300;
    rec.captureStart(world);
    expect(rec.build().header.players[0]!.credits).toBe(20000);
  });
});

/* ========================================================================== */

describe('the parser refuses a file it would have to guess at', () => {
  const serialise = (h: Partial<ReplayHeader>): string =>
    JSON.stringify({ header: { ...HEADER, ...h }, commands: [], checks: [] });

  it('refuses a v1 file rather than replaying it without a seed', () => {
    // The whole reason REPLAY_FORMAT_VERSION was bumped. A v1 file is readable
    // JSON and describes a match this build cannot rebuild.
    const v1 = JSON.stringify({
      header: {
        formatVersion: 1, buildVersion: 'old', mapSeed: 0x51c0de,
        scenario: 'skirmish',
        players: [{ faction: 0, isHuman: true, aiDifficulty: 0, aiPersonality: 0 }],
      },
      commands: [], checks: [],
    });
    const r = parseReplay(v1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('format version 1');
  });

  it('names the field it is missing', () => {
    // A refusal that says "invalid" teaches nobody anything. Each of these is a
    // different way the world would be built differently.
    for (const [key, reason] of [
      ['simSeed', 'simSeed'],
      ['mapPreset', 'mapPreset'],
      ['biome', 'biome'],
      ['start', 'start'],
      ['localPlayer', 'localPlayer'],
    ] as const) {
      const header: Record<string, unknown> = { ...HEADER };
      delete header[key];
      const r = parseReplay(JSON.stringify({ header, commands: [], checks: [] }));
      expect(r.ok, key).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toContain(reason);
    }
  });

  it('refuses a slot with no opening bank', () => {
    const r = parseReplay(serialise({
      players: [{ faction: 0, isHuman: true, aiDifficulty: 0, aiPersonality: 0 } as never],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('opening bank');
  });

  it('accepts a file with no `art`, which cannot change the simulation', () => {
    const header: Record<string, unknown> = { ...HEADER };
    delete header.art;
    expect(parseReplay(JSON.stringify({ header, commands: [], checks: [] })).ok).toBe(true);
  });

  it('keeps pre-identity files readable but refuses an absurd stored name', () => {
    expect(parseReplay(serialise({ players: HEADER.players.map(({ name: _name, ...p }) => p) })).ok)
      .toBe(true);
    const oversized = { ...HEADER.players[0]!, name: 'x'.repeat(65) };
    const r = parseReplay(serialise({ players: [oversized, HEADER.players[1]!] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('name for player 0');
  });
});

/* ========================================================================== */

describe('the build version warns and does not refuse', () => {
  it('says nothing when the builds agree', () => {
    expect(buildWarning(HEADER, 'test')).toBe('');
  });

  it('warns, names both builds, and points at the checksum', () => {
    const msg = buildWarning(HEADER, '2.2.0');
    expect(msg).toContain('test');
    expect(msg).toContain('2.2.0');
    expect(msg.toLowerCase()).toContain('diverg');
  });

  it('a mismatched build still PARSES — the file is readable, the match may not replay', () => {
    const r = parseReplay(JSON.stringify({
      header: { ...HEADER, buildVersion: 'something-else' }, commands: [], checks: [],
    }));
    expect(r.ok).toBe(true);
  });
});

/* ========================================================================== */

describe('playback feeds a live world and checks itself', () => {
  // `preparePlayback(null)` is the full stop — armed file and live player both.
  // It is what `Shell.clearReplay` calls, so this reset is the product's own
  // exit path rather than a test-only affordance.
  beforeEach(() => { preparePlayback(null); });

  it('is completely inert until something prepares a file', () => {
    // Discovery registers `game.playback` in every match. A skirmish must be
    // byte-identical to one built before this file existed.
    expect(playbackActive()).toBe(false);
    expect(playbackReport().active).toBe(false);

    const world = makeWorld();
    const ch = new Channels();
    const before = hashOnly(world);
    ch.commands.issueOrder(P0, OrderKind.Move, [1], 1, 5, 6, 0 as EntityId, false);
    playbackIssue(world, ch);
    // The bus was not touched: the command is still there for the real drainer.
    let seen = 0;
    ch.commands.drain(() => { seen++; });
    expect(seen).toBe(1);
    expect(hashOnly(world)).toBe(before);
  });

  it('reproduces the recorded world exactly, and the checkpoints prove it', () => {
    const { file, hash } = recordRun();
    expect(file.checks.length).toBeGreaterThan(1);

    preparePlayback(file);
    adoptPreparedPlayback();
    expect(playbackActive()).toBe(true);

    const world = makeWorld();
    const ch = new Channels();
    spawn(world, CX, CX);
    spawn(world, CX + 8, CX, P1);

    for (let t = 1; t <= 90; t++) {
      world.tick = t;
      ch.commands.tick = t;
      playbackIssue(world, ch);
      ch.commands.drain((cmd) => { applyStub(world, cmd); });
      stepStub(world);
      playbackVerify(world);
    }

    const report = playbackReport();
    expect(report.desync, 'the replay must not diverge').toBe('');
    expect(report.issued).toBe(file.commands.length);
    expect(report.verified).toBe(file.checks.length);
    expect(report.complete).toBe(true);
    // And the two worlds really are the same world, not merely un-diverged.
    expect(hashOnly(world)).toBe(hash);
  });

  it('DROPS a command the viewer issues, instead of letting it change the match', () => {
    /*
     * The input lock, and the reason it is not optional. A viewer is looking
     * at a live simulation through a live HUD and their slot is the recorded
     * player's slot, so a right-click WOULD be accepted and WOULD apply. From
     * that moment the rest of the recording plays out over a world it was not
     * recorded against — and the checksum reports a "desync" whose cause is a
     * mouse.
     */
    const { file, hash } = recordRun();
    preparePlayback(file);
    adoptPreparedPlayback();

    const world = makeWorld();
    const ch = new Channels();
    const local = spawn(world, CX, CX);
    spawn(world, CX + 8, CX, P1);

    for (let t = 1; t <= 90; t++) {
      world.tick = t;
      ch.commands.tick = t;
      // THE STRAY CLICK: issued before the playback hook runs, exactly as a DOM
      // handler between two ticks would have done.
      if (t === 20 || t === 55) {
        ch.commands.issueOrder(P0, OrderKind.Move, [local as number], 1, 12, 12, 0 as EntityId, false);
      }
      playbackIssue(world, ch);
      ch.commands.drain((cmd) => { applyStub(world, cmd); });
      stepStub(world);
      playbackVerify(world);
    }

    expect(playbackReport().desync, 'a dropped click cannot desync anything').toBe('');
    expect(hashOnly(world)).toBe(hash);
  });

  it('reports a divergence, and says WHICH BLOCK, rather than passing quietly', () => {
    /*
     * The test that makes the two above mean something — and the second half
     * of it is the sentence `Checksum.ts` opens by promising. A checkpoint that
     * stored only the folded hash could never produce it: `describeDivergence`
     * had nothing to compare block by block and printed `folded hash only`,
     * which reads like "no block differs" and means "no block was recorded".
     * Nudging one unit's position must name the ENTITY block and not the
     * others, because the count and the economy are untouched.
     */
    const { file } = recordRun();
    preparePlayback(file);
    adoptPreparedPlayback();

    const world = makeWorld();
    const ch = new Channels();
    const a = spawn(world, CX, CX);
    spawn(world, CX + 8, CX, P1);

    for (let t = 1; t <= 90; t++) {
      world.tick = t;
      ch.commands.tick = t;
      playbackIssue(world, ch);
      ch.commands.drain((cmd) => { applyStub(world, cmd); });
      stepStub(world);
      if (t === 44) world.store.posZ[world.store.index(a)] += 3;
      playbackVerify(world);
    }

    const report = playbackReport();
    expect(report.desync).not.toBe('');
    expect(report.desync).toContain('tick');
    expect(report.desync, 'the block must be named').toContain('entities differ');
    expect(report.desync).not.toContain('players differ');
    expect(report.desync).not.toContain('folded hash only');
  });

  it('still verifies a file whose checkpoints predate the per-block split', () => {
    // `ReplayCheck.blocks` is optional on read for exactly this: a file without
    // it must verify as before and report the tick, just not the block.
    const { file, hash } = recordRun();
    for (const c of file.checks) delete c.blocks;

    preparePlayback(file);
    adoptPreparedPlayback();
    const world = makeWorld();
    const ch = new Channels();
    spawn(world, CX, CX);
    spawn(world, CX + 8, CX, P1);
    for (let t = 1; t <= 90; t++) {
      world.tick = t;
      ch.commands.tick = t;
      playbackIssue(world, ch);
      ch.commands.drain((cmd) => { applyStub(world, cmd); });
      stepStub(world);
      playbackVerify(world);
    }
    expect(playbackReport().desync).toBe('');
    expect(hashOnly(world)).toBe(hash);
  });

  it('is not "complete" while consequences are still playing out', () => {
    // `finished` means the last command has been re-issued, which for a
    // recording whose last order lands at tick 5 is true almost immediately.
    // Saying "complete" there would stop a replay 85 ticks early.
    const { file } = recordRun();
    preparePlayback(file);
    adoptPreparedPlayback();

    const world = makeWorld();
    const ch = new Channels();
    spawn(world, CX, CX);
    spawn(world, CX + 8, CX, P1);

    for (let t = 1; t <= 50; t++) {
      world.tick = t;
      ch.commands.tick = t;
      playbackIssue(world, ch);
      ch.commands.drain((cmd) => { applyStub(world, cmd); });
      stepStub(world);
      playbackVerify(world);
    }
    const mid = playbackReport();
    expect(mid.issued).toBe(file.commands.length);
    expect(mid.complete, 'the last checkpoint is at tick 90').toBe(false);
  });

  it('stops feeding the world the moment it is ended', () => {
    const { file } = recordRun();
    preparePlayback(file);
    adoptPreparedPlayback();
    preparePlayback(null);
    expect(playbackActive()).toBe(false);

    const world = makeWorld();
    const ch = new Channels();
    world.tick = 5;
    playbackIssue(world, ch);
    let seen = 0;
    ch.commands.drain(() => { seen++; });
    expect(seen).toBe(0);
  });
});

/* ========================================================================== */

describe('playback is actually wired into the game', () => {
  it('registers a system the glob discovers', async () => {
    const mods = import.meta.glob('../src/game/*.system.ts');
    expect(Object.keys(mods)).toContain('../src/game/playback.system.ts');
    const mod = (await import('../src/game/playback.system')).default;
    expect(mod.id).toBe('game.playback');
    expect(typeof mod.simTick).toBe('function');
  });

  it('issues BEFORE the one thing that drains the bus', () => {
    // `OrderExecutor.tick()` is order 9000 inside Phase.Command. At any order
    // above it, every command in the file would sit in the ring for a tick and
    // apply one tick late — forever, and compounding.
    const src = read('src/game/playback.system.ts');
    const order = /order:\s*(\d+)/.exec(src);
    expect(order).not.toBeNull();
    expect(Number(order![1])).toBeLessThan(9000);
  });

  it('verifies at the order the checkpoint was STAMPED at, not the order it issues at', () => {
    // A checkpoint describes one exact moment inside a tick. Comparing it
    // anywhere else reports a divergence that is the instrument's own.
    const src = read('src/game/replay.system.ts');
    expect(src).toContain('playbackVerify(world)');
    const order = /order:\s*(\d+)/.exec(src);
    expect(Number(order![1])).toBe(9500);
  });

  it('harvests rather than drains, so a dropped click is never recorded', () => {
    // Trap 2 of `Replay.ts` by a third route: `drain` fires the recording tap,
    // and a command that is about to be thrown away must not be logged.
    const src = read('src/game/Playback.ts');
    expect(src).toContain('commands.harvest(');
    expect(src).not.toContain('commands.drain(');
  });
});

/* ========================================================================== */

describe('the shell builds the world the recording describes', () => {
  /**
   * One method's source, by brace matching from its signature.
   *
   * A `slice` between two landmarks is what these checks used to be, and it is
   * exactly the kind of assertion that silently starts covering the whole file
   * the day a landmark moves — a green test proving nothing, which is on
   * CLAUDE.md's list. This throws when the signature is gone.
   */
  const methodBody = (signature: string): string => {
    const src = read('src/shell/Shell.ts');
    const at = src.indexOf(signature);
    expect(at, `Shell.ts no longer has \`${signature}\``).toBeGreaterThan(0);

    // Step over the PARAMETER LIST first. `startMatch(setup, options: { … })`
    // has a brace in its signature, and a matcher that starts at the first `{`
    // it sees closes on that one and returns the signature — which is how this
    // helper failed the first time it was pointed at that method.
    let parens = 0;
    let i = src.indexOf('(', at);
    for (; i < src.length; i++) {
      if (src[i] === '(') parens++;
      else if (src[i] === ')' && --parens === 0) break;
    }

    let depth = 0;
    for (i = src.indexOf('{', i); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
    }
    throw new Error(`\`${signature}\` never closes`);
  };

  it('suppresses the unlock gate for playback, as PvP does', () => {
    /*
     * THE TICK-ZERO DESYNC. `Scenarios.ts` asks `isBuildable` while spawning
     * the STARTING ARMY and the gate answers from the LOCAL PROFILE, so a
     * veteran's recording watched on a fresh account starts with a different
     * army on the field. Multiplayer hit this exactly; playback inherits it.
     */
    expect(methodBody('async startReplay(')).toContain('suppressUnlockGate(true)');
  });

  it('puts the gate back when the replay ends', () => {
    expect(methodBody('private clearReplay(')).toContain('suppressUnlockGate(false)');
  });

  it('takes every boot flag from the header rather than from the lobby', () => {
    const body = methodBody('private applyReplayQuery(');
    for (const key of ['map', 'biome', 'mapseed', 'seed', 'start']) {
      expect(body, `?${key}= must come from the recording`).toContain(`'${key}'`);
    }
    expect(body).toContain('header.simSeed');
    expect(body).toContain('header.start');
  });

  it('never opens the progression board for a replay', () => {
    // Watching is not playing. `beginMatch` starts objective tracking and the
    // reward queue; a replay of a won match would pay out twice.
    expect(methodBody('async startMatch(')).toMatch(/world !== undefined && this\.replay === null/);
  });

  it('seats recorded combat slots as human while preserving Gaia in the id table', () => {
    const body = methodBody('private seatReplayPlayers(');
    expect(body).toContain('p.isHuman = !neutral');
    expect(body).toContain("? 'Gaia'");
    expect(body).toContain('Faction.Neutral');
  });

  it('restores the recorded opening bank before the first tick', () => {
    expect(methodBody('private applySimPostBoot(')).toContain('rec.credits');
  });

  it('the extractor really does stop at the method it was asked for', () => {
    // A brace matcher nobody has watched fail is a brace matcher nobody knows
    // works — and every assertion above rests on this one.
    const body = methodBody('private clearReplay(');

    // THE STRUCTURAL HALF. `clearReplay` is followed by `captureReplay`, whose
    // doc block and signature are the first things a runaway matcher would
    // swallow. Naming the NEIGHBOUR is what makes this an over-run test rather
    // than a size test — the length cap below is a smoke alarm, this is the
    // measurement.
    expect(body).not.toContain('applyReplayQuery');
    expect(body).not.toContain('captureReplay');
    // AND IT ENDS ON THE METHOD'S OWN CLOSING BRACE. `methodBody` slices from
    // the signature to the brace that balances it, so the last line is `  }`
    // at class-member indent — anything else means the matcher kept going.
    expect(body.trimEnd().split('\n').pop()).toBe('  }');

    // A CEILING WITH REAL HEADROOM, RAISED ONCE ON PURPOSE. It was 600 against
    // a 639-character body after `clearReplay` gained the campaign disarm; a
    // cap that has to move every time the method gains a comment is a cap that
    // gets bumped without being read. Running into `captureReplay` would add
    // well over a thousand characters, so 1200 still catches the failure this
    // exists for.
    expect(body.length).toBeLessThan(1200);
  });
});

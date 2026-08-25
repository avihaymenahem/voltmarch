/**
 * ============================================================================
 * tests/match-lifecycle.spec.ts — `match:started` HAS AN EMITTER
 * ============================================================================
 * THE BUG: `'match:started'` was declared in `GameEvents` and subscribed to by
 * THREE live modules, and nothing in the build ever emitted it.
 *
 *   - `src/audio/audio.system.ts`  the per-match announcer reset. It is the one
 *     and only place `matchStartAt` is set, so with no event the flag stayed at
 *     its module-level -1 forever and the opening "Battle control online" line
 *     NEVER PLAYED, in any match, in any session.
 *   - `src/progression/MissionTracker.ts`  the bus half of the lifecycle.
 *   - `src/ui/Hud.ts`  faction theme, credit counter, toast stack.
 *
 * `src/game/outcome.system.ts` — already the sole emitter of `'match:ended'` —
 * now emits this one too, edge-triggered on the shell entering `'playing'`.
 *
 * WHAT IS PINNED HERE
 * -------------------
 *   1. THE EMITTER. One event per match, on every route in (lobby, restart,
 *      rematch after an end screen, quit-and-relaunch, a restored save — they
 *      all funnel through `Shell.startMatch` and therefore through `'playing'`),
 *      and NO event for a pause, an options screen or the mission board, which
 *      also leave and re-enter `'playing'`.
 *   2. A REAL SUBSCRIBER OBSERVING IT. `MissionTracker` is attached to the same
 *      `Channels` the outcome system emits on, and the assertions are made
 *      against the tracker's own state, never against a spy on `emit`.
 *   3. THE ORDER PROBLEM THE EVENT CREATES. `Shell.startMatch` calls
 *      `progression.beginMatch` with a payload `EvMatchStarted` cannot carry,
 *      and `beginMatch` is documented to abandon a live match and redraw the
 *      board. So the tracker's bus handler must DEFER to a match already open
 *      for the same seed and player — otherwise the event fixed the announcer
 *      by breaking the mission board.
 *
 * WHAT IS NOT PINNED HERE, AND WHY
 * --------------------------------
 * The audio and HUD handlers cannot run under `environment: 'node'`:
 * `AudioEngine.create` returns null with no WebAudio (so `audio.system.init`
 * returns before it subscribes at all) and `Hud` builds DOM in its constructor.
 * Their subscriptions are checked structurally at the bottom of this file, and
 * their behaviour was verified by execution in a real browser — see the report.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { World } from '../src/core/world';
import { EntityKind, Faction } from '../src/core/types';
import type { EntityId, GameEvents, PlayerId, RenderContext } from '../src/core/types';

import outcomeSystem, { OUTCOME } from '../src/game/outcome.system';
import { setGameContext } from '../src/game/context';
import type { GameContext } from '../src/game/Bootstrap';

import { MissionTracker } from '../src/progression/MissionTracker';
import { ProfileStore, memoryStorage } from '../src/progression/profile-store';
import type { MissionDef } from '../src/progression/types';

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/* ==========================================================================
 * Fixtures
 * ========================================================================== */

/**
 * The shell, reduced to the four things `outcome.system` duck-types off it.
 * `state` is public so a test can drive the machine the way the real shell
 * does — 'loading' -> 'playing' -> 'paused' -> 'playing' -> 'ended'.
 */
interface FakeShell {
  state: string;
  seed: number;
  ends: boolean[];
  result: { won: boolean } | null;
  getState(): string;
  endMatch(r: { won: boolean }): void;
  getSeed(): number;
  latestResult(): { won: boolean } | null;
}

function installShell(seed = 0x51c0de): FakeShell {
  const shell: FakeShell = {
    state: 'loading',
    seed,
    ends: [],
    result: null,
    getState() { return this.state; },
    // Mirrors `Shell.endMatch`'s ORDER, which is what makes the fix work: the
    // result is recorded BEFORE the state flips to 'ended', so the outcome
    // watcher sees a populated `latestResult()` on the edge it reacts to.
    endMatch(r) { this.ends.push(r.won); this.result = { won: r.won }; this.state = 'ended'; },
    getSeed() { return this.seed; },
    latestResult() { return this.result; },
  };
  (globalThis as unknown as Record<string, unknown>).__vmShell = shell;
  return shell;
}

/** A host that predates `getSeed`. The module must still emit. */
function installLegacyShell(): { state: string } {
  const shell = {
    state: 'loading',
    getState(): string { return shell.state; },
    endMatch(): void { shell.state = 'ended'; },
  };
  (globalThis as unknown as Record<string, unknown>).__vmShell = shell;
  return shell;
}

interface Rig {
  world: World;
  channels: Channels;
  started: GameEvents['match:started'][];
  shell: FakeShell;
}

/**
 * `simTime` stays inside `startGraceSeconds` for every test in this file. The
 * verdict rules are `sell-lockout.spec.ts`'s subject, not this one, and holding
 * the clock inside the grace keeps `evaluate` from resolving an empty world as
 * a defeat halfway through a start-event assertion.
 */
let simTime = 0;

function makeRig(seed = 0x51c0de): Rig {
  const world = new World();
  world.addPlayer(Faction.Allies, 'Commander', true, true);
  world.addPlayer(Faction.Soviets, 'Opponent', false, false);
  const channels = new Channels();

  simTime = 0;
  setGameContext({
    world,
    channels,
    loop: { get simTime() { return simTime; } },
  } as unknown as GameContext);

  const started: GameEvents['match:started'][] = [];
  channels.events.on('match:started', (p) => { started.push({ ...p }); });

  const shell = installShell(seed);
  outcomeSystem.init?.();
  return { world, channels, started, shell };
}

function teardown(): void {
  outcomeSystem.dispose?.();
  setGameContext(null);
  delete (globalThis as unknown as Record<string, unknown>).__vmShell;
  delete (globalThis as unknown as Record<string, unknown>).__vmHud;
  delete (globalThis as unknown as Record<string, unknown>).__vmTutorial;
}

function frameCtx(n: number): RenderContext {
  return {
    dt: OUTCOME.pollSeconds, time: n * OUTCOME.pollSeconds, alpha: 1, frame: n, quality: 0,
  } as RenderContext;
}

let frameNo = 0;
function frames(count = 1): void {
  for (let i = 0; i < count; i++) outcomeSystem.frame?.(frameCtx(frameNo++));
}

/** The route every real entry takes: a loading screen, then the match. */
function enterMatch(shell: { state: string }): void {
  shell.state = 'loading';
  frames();
  shell.state = 'playing';
  frames();
}

/* ==========================================================================
 * 1. The emitter
 * ========================================================================== */

describe('match:started — the emitter that did not exist', () => {
  let rig: Rig;

  beforeEach(() => { frameNo = 0; rig = makeRig(); });
  afterEach(teardown);

  it('fires once when the shell reaches "playing", with the running seed', () => {
    expect(rig.started).toHaveLength(0);
    enterMatch(rig.shell);

    expect(rig.started).toHaveLength(1);
    expect(rig.started[0].seed).toBe(0x51c0de);
    expect(rig.started[0].localPlayer).toBe(rig.world.localPlayer);
    expect(rig.started[0].playerCount).toBe(2);
  });

  it('fires exactly once however many frames the match runs for', () => {
    enterMatch(rig.shell);
    frames(50);
    expect(rig.started).toHaveLength(1);
  });

  it('says nothing at all while the shell is on the title screen', () => {
    // `openMenu` boots a real engine for the backdrop, so this module IS
    // running and IS being framed. It must stay quiet.
    rig.shell.state = 'menu';
    frames(20);
    expect(rig.started).toHaveLength(0);
  });

  it('does not fire without a shell — the ?shot= harness is untouched', () => {
    delete (globalThis as unknown as Record<string, unknown>).__vmShell;
    frames(20);
    expect(rig.started).toHaveLength(0);
  });

  it('does NOT re-fire for a pause, the options screen or the mission board', () => {
    enterMatch(rig.shell);
    for (const mid of ['paused', 'settings', 'missions']) {
      rig.shell.state = mid;
      frames();
      rig.shell.state = 'playing';
      frames();
    }
    expect(rig.started).toHaveLength(1);
  });

  it('fires again for a rematch launched from the end screen', () => {
    enterMatch(rig.shell);
    rig.shell.state = 'ended';
    frames();

    // `Shell.startMatch` always shows a loading screen before the new match.
    rig.shell.seed = 0xc0ffee;
    enterMatch(rig.shell);

    expect(rig.started).toHaveLength(2);
    expect(rig.started[1].seed).toBe(0xc0ffee);
  });

  it('fires again after a quit to the title screen and a fresh launch', () => {
    enterMatch(rig.shell);
    rig.shell.state = 'menu';
    frames(3);
    enterMatch(rig.shell);
    expect(rig.started).toHaveLength(2);
  });

  it('fires for a tutorial run, which is a real match to the HUD and the mixer', () => {
    // The verdict rules stand down for a tutorial; the lifecycle does not. A
    // tutorial with no announcer reset and no HUD reset is the same bug.
    (globalThis as unknown as Record<string, unknown>).__vmTutorial = {};
    enterMatch(rig.shell);
    expect(rig.started).toHaveLength(1);
  });

  it('still emits for a host with no getSeed, falling back to seed 0', () => {
    teardown();
    frameNo = 0;
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    const channels = new Channels();
    simTime = 0;
    setGameContext({
      world, channels, loop: { get simTime() { return simTime; } },
    } as unknown as GameContext);
    const seen: GameEvents['match:started'][] = [];
    channels.events.on('match:started', (p) => { seen.push({ ...p }); });
    const legacy = installLegacyShell();
    outcomeSystem.init?.();

    enterMatch(legacy);
    expect(seen).toHaveLength(1);
    expect(seen[0].seed).toBe(0);
  });

  it('emits started before ended, and one of each, for a full match', () => {
    const ended: GameEvents['match:ended'][] = [];
    rig.channels.events.on('match:ended', (p) => { ended.push({ ...p }); });

    enterMatch(rig.shell);
    frames(4);
    rig.shell.state = 'ended';
    frames(4);

    expect(rig.started).toHaveLength(1);
    expect(ended).toHaveLength(1);
  });
});

/* ==========================================================================
 * 2. A REAL SUBSCRIBER OBSERVES IT
 *
 * `MissionTracker` attached to the same bus the emitter writes to. Every
 * assertion below reads the tracker, not the event.
 * ========================================================================== */

const NO_TIMERS = { schedule: (): number => 0, cancel: (): void => { /* none */ } };

const KILL_3: MissionDef = {
  id: 'test.kill3', scope: 'profile', category: 'combat', target: 3,
  title: 'Three', description: 'Destroy 3.',
  rule: { on: 'kill' },
  reward: [{ kind: 'unlock', unlockId: 'test.unlock.kill3' }],
};

const MATCH_KILL_2: MissionDef = {
  id: 'test.match.kill2', scope: 'match', category: 'combat', target: 2,
  title: 'Two this match', description: 'Destroy 2 this match.',
  rule: { on: 'kill' },
  reward: [{ kind: 'credits', amount: 100 }],
};

function makeTracker(defs: readonly MissionDef[]): MissionTracker {
  const store = new ProfileStore(memoryStorage(), { ...NO_TIMERS, now: () => 1_000 });
  return new MissionTracker(defs, store, { ...NO_TIMERS, now: () => 5_000 });
}

function emitKill(channels: Channels, victim: PlayerId, killer: PlayerId): void {
  channels.events.emit('entity:killed', {
    id: 1 as EntityId, kind: EntityKind.Vehicle, defId: 0, player: victim,
    killer: 2 as EntityId, killerPlayer: killer, x: 0, z: 0, value: 100,
  });
}

describe('MissionTracker observes match:started from the real emitter', () => {
  let rig: Rig;
  let tracker: MissionTracker;

  beforeEach(() => {
    frameNo = 0;
    rig = makeRig();
    tracker = makeTracker([KILL_3, MATCH_KILL_2]);
    tracker.attach(rig.channels.events);
  });

  afterEach(() => { tracker.dispose(); teardown(); });

  it('opens the match, so events start counting — the whole point of the reset', () => {
    // Before the event the tracker is closed and DROPS everything: `advance`
    // is unreachable while `match === null`.
    emitKill(rig.channels, P1, P0);
    expect(tracker.inMatch()).toBe(false);
    expect(tracker.progressOf('test.kill3').value).toBe(0);

    enterMatch(rig.shell);

    expect(tracker.inMatch()).toBe(true);
    emitKill(rig.channels, P1, P0);
    expect(tracker.progressOf('test.kill3').value).toBe(1);
  });

  it('draws the objective board from the seed the emitter published', () => {
    enterMatch(rig.shell);
    expect(tracker.activeObjectiveIds()).toEqual(['test.match.kill2']);
  });

  it('records a match played end to end, through both bus events', () => {
    enterMatch(rig.shell);
    emitKill(rig.channels, P1, P0);
    emitKill(rig.channels, P1, P0);
    emitKill(rig.channels, P1, P0);
    expect(tracker.progressOf('test.kill3').complete).toBe(true);

    rig.shell.state = 'ended';
    frames();

    expect(tracker.inMatch()).toBe(false);
    expect(tracker.store.get().stats.matchesPlayed).toBe(1);
    expect(tracker.isUnlocked('test.unlock.kill3')).toBe(true);
  });
});

/* ==========================================================================
 * 3. The order problem the event creates
 *
 * `Shell.startMatch` calls `beginMatch` DIRECTLY, before the shell ever reaches
 * 'playing' and therefore before this event exists, and its payload is strictly
 * richer than `EvMatchStarted`. The event must not undo it.
 * ========================================================================== */

describe('the event defers to a match the shell already opened', () => {
  let rig: Rig;
  let tracker: MissionTracker;

  beforeEach(() => {
    frameNo = 0;
    rig = makeRig(0x51c0de);
    tracker = makeTracker([KILL_3, MATCH_KILL_2]);
    tracker.attach(rig.channels.events);
  });

  afterEach(() => { tracker.dispose(); teardown(); });

  it('does not restart the match, so nothing downstream repaints', () => {
    // Exactly what `Shell.startMatch` does, with the two fields the event
    // cannot carry.
    tracker.beginMatch({
      seed: 0x51c0de, localPlayer: 0, faction: Faction.Soviets as number, difficulty: 3,
    });
    let repaints = 0;
    tracker.subscribe(() => { repaints++; });
    const version = tracker.version;

    enterMatch(rig.shell);

    // Restarting would fire `abandonMatch` and then `beginMatch`, each with an
    // immediate notification and a profile flush, on the first frame of every
    // single match.
    expect(repaints).toBe(0);
    expect(tracker.version).toBe(version);

    // And the match the shell described is the one that ends: a Soviet win
    // still credits the Soviet mastery chain.
    tracker.endMatch({ won: true, durationSec: 90 });
    expect(tracker.store.get().stats.winsByFaction[String(Faction.Soviets as number)]).toBe(1);
  });

  it('does not wipe progress already made in the match it is announcing', () => {
    tracker.beginMatch({ seed: 0x51c0de, localPlayer: 0, faction: Faction.Allies as number });
    emitKill(rig.channels, P1, P0);
    expect(tracker.progressOf('test.match.kill2').value).toBe(1);

    // The shell reaches 'playing' a beat later and the event lands. Without the
    // guard in the handler, `beginMatch` abandons and re-draws, and this match
    // objective silently resets to zero on the first frame of every match.
    enterMatch(rig.shell);
    expect(tracker.progressOf('test.match.kill2').value).toBe(1);
  });

  it('DOES take over when the open match is a different one', () => {
    // A route that never closed its match cleanly must not shadow the new one.
    tracker.beginMatch({ seed: 0xdead, localPlayer: 1, faction: Faction.Allies as number });
    enterMatch(rig.shell);

    // Now scoped to the local player the event named, not the stale one.
    emitKill(rig.channels, P0, P1);
    expect(tracker.progressOf('test.kill3').value).toBe(0);
    emitKill(rig.channels, P1, P0);
    expect(tracker.progressOf('test.kill3').value).toBe(1);
  });
});

/* ==========================================================================
 * 4. The two subscribers that cannot be booted headless
 *
 * `audio.system` needs WebAudio (its `init` returns before `subscribe()` when
 * `AudioEngine.create` yields null) and `Hud` needs a DOM. Neither exists under
 * `environment: 'node'`. A source check is not a behaviour test and is not
 * presented as one — it is the tripwire for the failure mode this whole file
 * exists because of: a subscription with nothing on the other end.
 * ========================================================================== */

function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');
}

describe('every declared subscriber is still subscribed', () => {
  const SUBSCRIBERS = [
    'apps/game/src/audio/audio.system.ts',
    'apps/game/src/progression/MissionTracker.ts',
    'apps/game/src/ui/Hud.ts',
  ];

  for (const file of SUBSCRIBERS) {
    it(`${file} subscribes to match:started`, () => {
      expect(source(file)).toContain("on('match:started'");
    });
  }

  it('exactly one module emits it, and it is the lifecycle owner', () => {
    const emitters = [
      'apps/game/src/game/outcome.system.ts', 'apps/game/src/shell/Shell.ts', 'apps/game/src/ui/Hud.ts',
      'apps/game/src/audio/audio.system.ts', 'apps/game/src/progression/MissionTracker.ts',
      'apps/game/src/progression/progression.system.ts',
    ].filter((f) => source(f).includes("emit('match:started'"));
    expect(emitters).toEqual(['apps/game/src/game/outcome.system.ts']);
  });

  it('the announcer arms its opening line from that handler and nowhere else', () => {
    // The measurable casualty of the missing emitter. If `matchStartAt` ever
    // gains a second writer this test is wrong, not the code — but it will fail
    // loudly rather than the line quietly never playing again.
    const audio = source('apps/game/src/audio/audio.system.ts');
    const assignments = audio.match(/^\s*matchStartAt = (?!-1)/gm) ?? [];
    expect(assignments).toHaveLength(1);
    expect(audio).toContain('battleControlOnline');
  });
});

/* ========================================================================== */

describe('match:ended honours the verdict the shell recorded', () => {
  /**
   * `__vmShell.endMatch({won: true})` wrote a WIN to the profile and raised the
   * victory screen while `match:ended` carried `localWon: false` — the
   * announcer saying "mission failed" and playing the loss sting over a
   * victory. The cause was `outcome.system` recomputing the verdict with its
   * own `inferLocalWon()` instead of asking what the shell had committed to.
   *
   * Reachable only from a caller outside this module, which is exactly what
   * `Shell.endMatch` is public for — "so a real victory module can call it".
   */
  it('reports a victory when the caller declared one, against an empty world', () => {
    const rig = makeRig();
    // An empty world: `inferLocalWon()` sees the local player holding nothing
    // and returns false, which is precisely the wrong answer here.
    const ended: GameEvents['match:ended'][] = [];
    rig.channels.events.on('match:ended', (p) => { ended.push({ ...p }); });

    rig.shell.state = 'playing';
    outcomeSystem.frame?.({ dt: 0.016 } as never);

    // A victory module calling in, the way the doc comment invites.
    rig.shell.endMatch({ won: true });
    outcomeSystem.frame?.({ dt: 0.016 } as never);

    expect(ended, 'exactly one match:ended').toHaveLength(1);
    expect(ended[0]!.localWon, 'the caller said victory').toBe(true);
    teardown();
  });

  it('reports a defeat when the caller declared one', () => {
    const rig = makeRig();
    const ended: GameEvents['match:ended'][] = [];
    rig.channels.events.on('match:ended', (p) => { ended.push({ ...p }); });

    rig.shell.state = 'playing';
    outcomeSystem.frame?.({ dt: 0.016 } as never);
    rig.shell.endMatch({ won: false });
    outcomeSystem.frame?.({ dt: 0.016 } as never);

    expect(ended).toHaveLength(1);
    expect(ended[0]!.localWon).toBe(false);
    teardown();
  });

  it('still emits for a host that predates latestResult()', () => {
    // The accessor is optional for the same reason `getSeed` is: a host without
    // it must still drive the outcome rules rather than silently going quiet.
    const world = new World();
    world.addPlayer(Faction.Allies, 'Commander', true, true);
    world.addPlayer(Faction.Soviets, 'Opponent', false, false);
    const channels = new Channels();
    simTime = 0;
    setGameContext({
      world, channels, loop: { get simTime() { return simTime; } },
    } as unknown as GameContext);
    const ended: GameEvents['match:ended'][] = [];
    channels.events.on('match:ended', (p) => { ended.push({ ...p }); });

    const shell = installLegacyShell();
    outcomeSystem.init?.();
    shell.state = 'playing';
    outcomeSystem.frame?.({ dt: 0.016 } as never);
    shell.state = 'ended';
    outcomeSystem.frame?.({ dt: 0.016 } as never);

    expect(ended, 'a legacy host must still produce the event').toHaveLength(1);
    teardown();
  });

  it('keeps the store-derived fallback for an end nobody declared', () => {
    // The recompute is not being removed — it is being demoted to third. A
    // shell that reaches 'ended' with no recorded result (the old poll path)
    // must still be answered from the world.
    const rig = makeRig();
    const ended: GameEvents['match:ended'][] = [];
    rig.channels.events.on('match:ended', (p) => { ended.push({ ...p }); });

    rig.shell.state = 'playing';
    outcomeSystem.frame?.({ dt: 0.016 } as never);
    // Straight to 'ended' with `result` left null.
    rig.shell.state = 'ended';
    outcomeSystem.frame?.({ dt: 0.016 } as never);

    expect(ended).toHaveLength(1);
    // An empty world is a defeat by `inferLocalWon`'s own rule.
    expect(ended[0]!.localWon).toBe(false);
    teardown();
  });
});

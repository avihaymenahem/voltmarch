/**
 * ============================================================================
 * tests/progression-suppress.spec.ts — the profile is deaf while a replay or a
 * campaign operation is running, and it is deaf AT THE TRACKER
 * ============================================================================
 * WHY THIS FILE EXISTS, AND WHY IT IS SHAPED THE WAY IT IS
 * -------------------------------------------------------
 * `Shell.startMatch` has refused to call `progression.beginMatch` for a replay
 * since replays shipped, under a nine-line comment saying exactly why:
 * "Watching a recording is not playing a match: it must not count towards
 * 'play 10 skirmishes'…". That refusal did nothing.
 *
 * `beginMatch` HAS TWO CALLERS. `MissionTracker.attach` subscribes to
 * `match:started` and opens a match itself whenever none is open, and
 * `game/outcome.system.ts` emits that event edge-triggered on the shell
 * entering `'playing'` — with no replay, campaign or tutorial exclusion
 * anywhere on the path. So the shell skipped its call and the bus made the
 * same call one frame later, and watching a replay of a win banked
 * `matchesPlayed`, `wins`, `currentStreak` and every kill/build/earn chain.
 *
 * **THE TEST THAT WOULD HAVE CAUGHT IT IS THE ONE THAT DRIVES THE BUS.** A
 * test asserting "the shell did not call `beginMatch`" passes against the
 * broken build, because the shell genuinely did not; the second caller is
 * invisible from there. Every case below therefore emits `match:started` on a
 * real `Channels` and asks the tracker what it thinks, exactly as the running
 * game does.
 *
 * The falsifiers are the other half. `suppressProgression(false)` must let the
 * same event through — otherwise this file would pass just as well against a
 * tracker that ignored the bus entirely, which is a different bug wearing this
 * fix's clothes.
 * ========================================================================== */

import { afterEach, describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { EntityKind, Faction } from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';
import { MISSIONS } from '../src/data/Missions';
import { MissionTracker } from '../src/progression/MissionTracker';
import { progressionSuppressed, suppressProgression } from '../src/progression/suppress';
import { PROFILE_STORAGE_KEY, ProfileStore } from '../src/progression/profile-store';
import type { StorageLike } from '../src/progression/profile-store';

const NO_TIMERS = { schedule: () => 0, cancel: () => { /* nothing scheduled */ } };
const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

function memory(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

function rig(): { tracker: MissionTracker; channels: Channels; store: ProfileStore } {
  const store = new ProfileStore(memory(), { ...NO_TIMERS, now: () => 1_000 });
  const channels = new Channels();
  const tracker = new MissionTracker(MISSIONS, store, { ...NO_TIMERS, now: () => 5_000 });
  tracker.attach(channels.events);
  return { tracker, channels, store };
}

/** Exactly the payload `game/outcome.system.ts#emitStarted` publishes. */
function busStart(channels: Channels, seed = 4242): void {
  channels.events.emit('match:started', { seed, playerCount: 2, localPlayer: P0 });
}

function busEnd(channels: Channels, localWon: boolean): void {
  channels.events.emit('match:ended', { winner: P0, localWon, durationSec: 600 });
}

// The latch is module-level, exactly like `UnlockGate`'s `suppressed`. Leaving
// it set would silently disarm every later test file in the same worker.
afterEach(() => { suppressProgression(false); });

describe('the latch is honoured on the bus route, not only at the shell call site', () => {
  it('a suppressed match:started opens no match', () => {
    const { tracker, channels } = rig();
    suppressProgression(true);
    busStart(channels);
    expect(
      tracker.inMatch(),
      'the bus is the SECOND caller of beginMatch and the shell cannot see it. '
      + 'If this fails, the latch is being read at a call site again.',
    ).toBe(false);
  });

  it('THE FALSIFIER: an unsuppressed match:started DOES open one', () => {
    const { tracker, channels } = rig();
    busStart(channels);
    expect(
      tracker.inMatch(),
      'without this the file above passes against a tracker that ignores the bus '
      + 'entirely — a different bug wearing this fix as a disguise.',
    ).toBe(true);
  });

  it('a direct beginMatch is refused too, so neither caller is privileged', () => {
    const { tracker } = rig();
    suppressProgression(true);
    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies as number });
    expect(tracker.inMatch()).toBe(false);
  });
});

describe('a suppressed match banks nothing on the lifetime record', () => {
  it('a win watched under suppression moves no stat', () => {
    const { channels, store } = rig();
    suppressProgression(true);
    busStart(channels);
    busEnd(channels, true);
    const s = store.get().stats;
    expect([s.matchesPlayed, s.wins, s.currentStreak, s.bestStreak]).toEqual([0, 0, 0, 0]);
  });

  it('THE FALSIFIER: the same win unsuppressed moves all four', () => {
    const { channels, store } = rig();
    busStart(channels);
    busEnd(channels, true);
    const s = store.get().stats;
    expect([s.matchesPlayed, s.wins, s.currentStreak, s.bestStreak]).toEqual([1, 1, 1, 1]);
  });

  it('endMatch is gated in its own right, not merely by beginMatch refusing', () => {
    const { tracker, channels, store } = rig();
    // Open honestly, THEN suppress. `beginMatch`'s guard cannot cover this —
    // the match is already open — so a gate on `endMatch` alone is what stops
    // the win landing.
    busStart(channels);
    expect(tracker.inMatch()).toBe(true);
    suppressProgression(true);
    busEnd(channels, true);
    expect(
      store.get().stats.wins,
      'a latch set mid-match must not let the lifetime record out on the way past',
    ).toBe(0);
    expect(tracker.inMatch(), 'and the match stays open for the documented recovery').toBe(true);
  });
});

describe('counter chains do not advance while the match never opened', () => {
  it('kills credited during a suppressed match reach no match-scope row', () => {
    const { tracker, channels } = rig();
    suppressProgression(true);
    busStart(channels);
    for (let i = 0; i < 40; i++) {
      channels.events.emit('entity:killed', {
        id: 1 as EntityId, kind: EntityKind.Vehicle, defId: 0, player: P1,
        killer: 2 as EntityId, killerPlayer: P0, x: 0, z: 0, value: 100,
      });
    }
    expect(tracker.activeObjectiveIds()).toEqual([]);
  });
});

describe('the latch reads back and defaults off', () => {
  it('defaults off, reports what it was set to, and clears', () => {
    expect(progressionSuppressed()).toBe(false);
    suppressProgression(true);
    expect(progressionSuppressed()).toBe(true);
    suppressProgression(false);
    expect(progressionSuppressed()).toBe(false);
  });
});

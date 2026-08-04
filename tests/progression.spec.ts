/**
 * PROGRESSION — the falsifiable half.
 *
 * The whole progression layer is pure data plus pure functions over it, so all
 * of it runs under `environment: 'node'` with no DOM and no engine boot. That
 * is not an accident: `profile-store.ts` deliberately has no shell imports and
 * `MissionTracker` takes a structural `EventSource` rather than the concrete
 * `EventBus`, precisely so these tests exist.
 *
 * What is covered here, in the order the brief asked for it:
 *   - a mission advancing on real events
 *   - a chain gating on `requires`
 *   - migration from a v1 profile
 *   - corrupt-profile recovery
 *   - the unlock gate filtering a catalogue
 * plus the mission table's own self-check, the match lifecycle, batching, and
 * export/import round-tripping.
 */

import { describe, expect, it } from 'vitest';

import { Channels } from '../src/core/events';
import { CreditReason, EntityKind, Faction, NONE } from '../src/core/types';
import type { EntityId, PlayerId } from '../src/core/types';

import { MISSIONS, MISSION_UNLOCK_IDS, UNLOCKS, validateMissions } from '../src/data/Missions';
import { MissionTracker } from '../src/progression/MissionTracker';
import { UnlockGate, filterBuildable, isBuildable, setUnlockGate } from '../src/progression/UnlockGate';
import {
  PROFILE_STORAGE_KEY,
  PROFILE_VERSION,
  ProfileStore,
  defaultProfile,
  memoryStorage,
  migrateProfile,
  normalizeProfile,
  parseProfileExport,
  serializeProfile,
  type StorageLike,
} from '../src/progression/profile-store';
import type { MissionDef } from '../src/progression/types';

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

/** Storage backed by a Map we can poke at, so a test can plant a corrupt blob. */
function seededStorage(initial?: string): StorageLike & { raw(): string | null; writes: number } {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(PROFILE_STORAGE_KEY, initial);
  const s = {
    writes: 0,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); s.writes++; },
    removeItem: (k: string) => { map.delete(k); },
    raw: () => map.get(PROFILE_STORAGE_KEY) ?? null,
  };
  return s;
}

/** No timers anywhere: every flush in these tests is explicit. */
const NO_TIMERS = { schedule: () => 0, cancel: () => { /* nothing scheduled */ } };

function makeStore(storage: StorageLike, clock = { t: 1_000 }): ProfileStore {
  return new ProfileStore(storage, { ...NO_TIMERS, now: () => clock.t });
}

function makeTracker(defs: readonly MissionDef[], store: ProfileStore): {
  tracker: MissionTracker; channels: Channels; detach: () => void;
} {
  const channels = new Channels();
  const tracker = new MissionTracker(defs, store, { ...NO_TIMERS, now: () => 5_000 });
  const detach = tracker.attach(channels.events);
  return { tracker, channels, detach };
}

const P0 = 0 as PlayerId;
const P1 = 1 as PlayerId;

/** Emit an `entity:killed` in the shape `src/sim/Damage.ts` emits it. */
function emitKill(
  channels: Channels,
  victimPlayer: PlayerId,
  killerPlayer: PlayerId,
  kind: EntityKind,
  value = 100,
): void {
  channels.events.emit('entity:killed', {
    id: 1 as EntityId, kind, defId: 0, player: victimPlayer,
    killer: 2 as EntityId, killerPlayer, x: 0, z: 0, value,
  });
}

/* -------------------------------------------------------------------------- */
/* 1. The table                                                                */
/* -------------------------------------------------------------------------- */

describe('data/Missions — the authored table', () => {
  it('passes its own self-check', () => {
    expect(validateMissions(MISSIONS)).toEqual([]);
  });

  it('ships both scopes and every category', () => {
    const scopes = new Set(MISSIONS.map((m) => m.scope));
    expect(scopes).toEqual(new Set(['profile', 'match']));
    const categories = new Set(MISSIONS.map((m) => m.category));
    for (const c of ['combat', 'economy', 'construction', 'tactics', 'mastery']) {
      expect(categories.has(c as never)).toBe(true);
    }
  });

  it('grants every declared unlock id exactly once', () => {
    const declared = Object.values(UNLOCKS);
    for (const id of declared) expect(MISSION_UNLOCK_IDS).toContain(id);
    expect(new Set(MISSION_UNLOCK_IDS).size).toBe(MISSION_UNLOCK_IDS.length);
  });

  it('has a faction-specific chain for each playable army', () => {
    const factions = MISSIONS.filter((m) => m.faction !== undefined).map((m) => m.faction);
    expect(factions).toContain(Faction.Allies as number);
    expect(factions).toContain(Faction.Soviets as number);
    expect(factions).toContain(Faction.Meridian as number);
  });

  it('rejects a mission with no rule', () => {
    const bad: MissionDef[] = [{
      id: 'x', scope: 'profile', title: 't', description: 'd',
      category: 'combat', target: 1, reward: [{ kind: 'unlock', unlockId: 'u' }],
    }];
    expect(validateMissions(bad).join('|')).toContain('has no rule');
  });

  it('rejects a requires-cycle', () => {
    const cyclic: MissionDef[] = [
      {
        id: 'a', scope: 'profile', title: 'a', description: 'a', category: 'combat',
        target: 1, requires: ['b'], rule: { on: 'play' }, reward: [{ kind: 'unlock', unlockId: 'ua' }],
      },
      {
        id: 'b', scope: 'profile', title: 'b', description: 'b', category: 'combat',
        target: 1, requires: ['a'], rule: { on: 'play' }, reward: [{ kind: 'unlock', unlockId: 'ub' }],
      },
    ];
    expect(validateMissions(cyclic).join('|')).toContain('cycle');
  });
});

/* -------------------------------------------------------------------------- */
/* 2. A mission advancing on events                                            */
/* -------------------------------------------------------------------------- */

const KILL_10: MissionDef = {
  id: 'test.kill10', scope: 'profile', category: 'combat', target: 10,
  title: 'Ten', description: 'Destroy 10.',
  rule: { on: 'kill' },
  reward: [{ kind: 'unlock', unlockId: 'test.unlock.a' }],
};

describe('MissionTracker — advancing on the event stream', () => {
  it('counts enemy kills and completes, granting the unlock', () => {
    const store = makeStore(seededStorage());
    const { tracker, channels, detach } = makeTracker([KILL_10], store);
    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });

    for (let i = 0; i < 9; i++) emitKill(channels, P1, P0, EntityKind.Vehicle);
    expect(tracker.progressOf('test.kill10').value).toBe(9);
    expect(tracker.progressOf('test.kill10').complete).toBe(false);
    expect(tracker.isUnlocked('test.unlock.a')).toBe(false);

    emitKill(channels, P1, P0, EntityKind.Vehicle);
    expect(tracker.progressOf('test.kill10').complete).toBe(true);
    expect(tracker.isUnlocked('test.unlock.a')).toBe(true);

    // The reward is queued for the end screen and drains exactly once.
    expect(tracker.drainPending()).toEqual([{ kind: 'unlock', unlockId: 'test.unlock.a' }]);
    expect(tracker.drainPending()).toEqual([]);
    detach();
  });

  it('ignores kills by anyone else, and does not count its own losses as kills', () => {
    const store = makeStore(seededStorage());
    const { tracker, channels, detach } = makeTracker([KILL_10], store);
    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });

    emitKill(channels, P0, P1, EntityKind.Vehicle);  // we lost one
    emitKill(channels, P1, P1, EntityKind.Vehicle);  // somebody else's fight
    expect(tracker.progressOf('test.kill10').value).toBe(0);
    detach();
  });

  it('advances nothing outside a match', () => {
    const store = makeStore(seededStorage());
    const { tracker, channels, detach } = makeTracker([KILL_10], store);
    emitKill(channels, P1, P0, EntityKind.Vehicle);
    expect(tracker.progressOf('test.kill10').value).toBe(0);
    detach();
  });

  it('respects an entity-kind filter', () => {
    const vehiclesOnly: MissionDef = {
      ...KILL_10, id: 'test.vehicles', target: 2,
      rule: { on: 'kill', kinds: [EntityKind.Vehicle] },
      reward: [{ kind: 'unlock', unlockId: 'test.unlock.v' }],
    };
    const store = makeStore(seededStorage());
    const { tracker, channels, detach } = makeTracker([vehiclesOnly], store);
    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });

    emitKill(channels, P1, P0, EntityKind.Infantry);
    emitKill(channels, P1, P0, EntityKind.Building);
    expect(tracker.progressOf('test.vehicles').value).toBe(0);
    emitKill(channels, P1, P0, EntityKind.Vehicle);
    expect(tracker.progressOf('test.vehicles').value).toBe(1);
    detach();
  });

  it('sums harvested credits and takes a high-water mark of the bank', () => {
    const defs: MissionDef[] = [
      {
        id: 'test.mine', scope: 'profile', category: 'economy', target: 300,
        title: 'Mine', description: 'Mine 300.',
        rule: { on: 'earn', reasons: [CreditReason.Harvest] },
        reward: [{ kind: 'unlock', unlockId: 'test.unlock.mine' }],
      },
      {
        id: 'test.bank', scope: 'profile', category: 'economy', target: 5000,
        title: 'Bank', description: 'Hold 5000.',
        rule: { on: 'bank' },
        reward: [{ kind: 'unlock', unlockId: 'test.unlock.bank' }],
      },
    ];
    const store = makeStore(seededStorage());
    const { tracker, channels, detach } = makeTracker(defs, store);
    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });

    const credit = (delta: number, held: number, reason: CreditReason): void => {
      channels.events.emit('economy:credits', {
        player: P0, credits: held, delta, storage: held, storageMax: 20000, reason,
      });
    };
    credit(200, 4000, CreditReason.Harvest);
    credit(500, 4500, CreditReason.Refund);   // a refund is not income
    credit(150, 3000, CreditReason.Harvest);

    expect(tracker.progressOf('test.mine').value).toBe(350);
    expect(tracker.progressOf('test.mine').complete).toBe(true);
    // High-water: the 4500 peak survives the drop back to 3000.
    expect(tracker.progressOf('test.bank').value).toBe(4500);
    expect(tracker.progressOf('test.bank').complete).toBe(false);
    detach();
  });

  it('separates unit production from structure completion', () => {
    const defs: MissionDef[] = [
      {
        id: 'test.units', scope: 'profile', category: 'construction', target: 2,
        title: 'Units', description: 'Build 2 units.',
        rule: { on: 'produce' },
        reward: [{ kind: 'unlock', unlockId: 'test.unlock.units' }],
      },
      {
        id: 'test.structs', scope: 'profile', category: 'construction', target: 2,
        title: 'Structures', description: 'Build 2 structures.',
        rule: { on: 'build' },
        reward: [{ kind: 'unlock', unlockId: 'test.unlock.structs' }],
      },
    ];
    const store = makeStore(seededStorage());
    const { tracker, channels, detach } = makeTracker(defs, store);
    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });

    channels.events.emit('production:ready', { player: P0, tab: 3, defId: 4, isBuilding: false });
    channels.events.emit('production:ready', { player: P0, tab: 0, defId: 1, isBuilding: true });
    channels.events.emit('building:completed', { id: 9 as EntityId, defId: 1, player: P0, x: 0, z: 0 });

    expect(tracker.progressOf('test.units').value).toBe(1);
    expect(tracker.progressOf('test.structs').value).toBe(1);
    detach();
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Chains                                                                   */
/* -------------------------------------------------------------------------- */

describe('MissionTracker — chains gate on `requires`', () => {
  const CHAIN: MissionDef[] = [
    {
      id: 'chain.1', scope: 'profile', category: 'combat', target: 2,
      title: 'One', description: 'Kill 2.',
      rule: { on: 'kill' }, reward: [{ kind: 'unlock', unlockId: 'chain.unlock.1' }],
    },
    {
      id: 'chain.2', scope: 'profile', category: 'combat', target: 2,
      title: 'Two', description: 'Kill 2 more.', requires: ['chain.1'],
      rule: { on: 'kill' }, reward: [{ kind: 'unlock', unlockId: 'chain.unlock.2' }],
    },
  ];

  it('does not accumulate a locked step, then runs it from zero', () => {
    const store = makeStore(seededStorage());
    const { tracker, channels, detach } = makeTracker(CHAIN, store);
    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });

    const step2 = CHAIN[1];
    expect(tracker.isLocked(step2)).toBe(true);

    emitKill(channels, P1, P0, EntityKind.Vehicle);
    // Step 2 is locked, so it banks nothing — otherwise the chain would open
    // and complete in the same instant and the player would never see it run.
    expect(tracker.progressOf('chain.2').value).toBe(0);

    emitKill(channels, P1, P0, EntityKind.Vehicle);
    expect(tracker.progressOf('chain.1').complete).toBe(true);
    expect(tracker.isLocked(step2)).toBe(false);
    // The kill that OPENED step 2 also counts for it: missions are walked in
    // table order within one event, so no kill is dropped at a chain boundary.
    expect(tracker.progressOf('chain.2').value).toBe(1);

    emitKill(channels, P1, P0, EntityKind.Vehicle);
    expect(tracker.progressOf('chain.2').complete).toBe(true);
    expect(tracker.isUnlocked('chain.unlock.2')).toBe(true);
    detach();
  });

  it('reports the shipped chains as locked on a fresh profile', () => {
    const store = makeStore(seededStorage());
    const tracker = new MissionTracker(MISSIONS, store, { ...NO_TIMERS });
    const step2 = MISSIONS.find((m) => m.id === 'combat.kills.2');
    const step1 = MISSIONS.find((m) => m.id === 'combat.kills.1');
    expect(step1).toBeDefined();
    expect(step2).toBeDefined();
    expect(tracker.isLocked(step1!)).toBe(false);
    expect(tracker.isLocked(step2!)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Match lifecycle                                                          */
/* -------------------------------------------------------------------------- */

describe('MissionTracker — the match lifecycle', () => {
  const WIN_FAST: MissionDef = {
    id: 'test.blitz', scope: 'profile', category: 'tactics', target: 1,
    title: 'Blitz', description: 'Win fast.',
    rule: { on: 'win', withinSec: 900 },
    reward: [{ kind: 'unlock', unlockId: 'test.unlock.blitz' }],
  };
  const NO_LOSS: MissionDef = {
    id: 'test.intact', scope: 'profile', category: 'tactics', target: 1,
    title: 'Intact', description: 'Lose no structures.',
    rule: { on: 'noLoss', kinds: [EntityKind.Building], requireWin: true },
    reward: [{ kind: 'unlock', unlockId: 'test.unlock.intact' }],
  };

  it('counts a fast win and skips a slow one', () => {
    const store = makeStore(seededStorage());
    const { tracker, detach } = makeTracker([WIN_FAST], store);

    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });
    tracker.endMatch({ won: true, durationSec: 1200 });
    expect(tracker.progressOf('test.blitz').complete).toBe(false);

    tracker.beginMatch({ seed: 2, localPlayer: 0, faction: Faction.Allies });
    tracker.endMatch({ won: true, durationSec: 600 });
    expect(tracker.progressOf('test.blitz').complete).toBe(true);
    expect(store.get().stats.matchesPlayed).toBe(2);
    expect(store.get().stats.wins).toBe(2);
    expect(store.get().stats.currentStreak).toBe(2);
    detach();
  });

  it('evaluates a noLoss flag only at match end, and only on a clean sheet', () => {
    const store = makeStore(seededStorage());
    const { tracker, channels, detach } = makeTracker([NO_LOSS], store);

    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });
    emitKill(channels, P0, P1, EntityKind.Building); // we lost a structure
    tracker.endMatch({ won: true, durationSec: 100 });
    expect(tracker.progressOf('test.intact').complete).toBe(false);

    tracker.beginMatch({ seed: 2, localPlayer: 0, faction: Faction.Allies });
    emitKill(channels, P0, P1, EntityKind.Vehicle);  // a tank is not a structure
    tracker.endMatch({ won: true, durationSec: 100 });
    expect(tracker.progressOf('test.intact').complete).toBe(true);
    detach();
  });

  it('resets match objectives between matches and drops them on abandon', () => {
    const objective: MissionDef = {
      id: 'test.obj', scope: 'match', category: 'combat', target: 5,
      title: 'Obj', description: 'Kill 5.',
      rule: { on: 'kill' }, reward: [{ kind: 'credits', amount: 100 }],
    };
    const store = makeStore(seededStorage());
    const { tracker, channels, detach } = makeTracker([objective], store);

    tracker.beginMatch({ seed: 7, localPlayer: 0, faction: Faction.Allies });
    expect(tracker.activeObjectiveIds()).toEqual(['test.obj']);
    emitKill(channels, P1, P0, EntityKind.Vehicle);
    emitKill(channels, P1, P0, EntityKind.Vehicle);
    expect(tracker.progressOf('test.obj').value).toBe(2);

    // A match ending mid-progress discards the board but keeps the record.
    tracker.endMatch({ won: false, durationSec: 200 });
    expect(tracker.inMatch()).toBe(false);
    expect(tracker.activeObjectiveIds()).toEqual([]);
    expect(tracker.progressOf('test.obj').value).toBe(0);
    expect(store.get().stats.losses).toBe(1);

    tracker.beginMatch({ seed: 7, localPlayer: 0, faction: Faction.Allies });
    tracker.abandonMatch();
    expect(store.get().stats.matchesPlayed).toBe(1); // an abandon is not a match
    detach();
  });

  it('draws the same objective board for the same seed', () => {
    const store = makeStore(seededStorage());
    const tracker = new MissionTracker(MISSIONS, store, { ...NO_TIMERS });

    tracker.beginMatch({ seed: 0x51c0de, localPlayer: 0, faction: Faction.Allies });
    const a = [...tracker.activeObjectiveIds()];
    tracker.beginMatch({ seed: 0x51c0de, localPlayer: 0, faction: Faction.Allies });
    const b = [...tracker.activeObjectiveIds()];
    tracker.beginMatch({ seed: 0x0cea11, localPlayer: 0, faction: Faction.Allies });
    const c = [...tracker.activeObjectiveIds()];

    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(5);
    expect(a.length).toBeGreaterThan(0);
    expect(c).not.toEqual(a);
  });

  it('credits only the faction actually played', () => {
    const store = makeStore(seededStorage());
    const tracker = new MissionTracker(MISSIONS, store, { ...NO_TIMERS });

    for (let i = 0; i < 5; i++) {
      tracker.beginMatch({ seed: i, localPlayer: 0, faction: Faction.Soviets });
      tracker.endMatch({ won: true, durationSec: 1000 });
    }
    expect(tracker.progressOf('mastery.soviets.1').complete).toBe(true);
    expect(tracker.progressOf('mastery.allies.1').value).toBe(0);
    expect(tracker.isUnlocked(UNLOCKS.insigniaSoviets)).toBe(true);
    expect(tracker.isUnlocked(UNLOCKS.insigniaAllies)).toBe(false);
  });

  it('leaves no listeners behind after detach', () => {
    const store = makeStore(seededStorage());
    const { channels, detach } = makeTracker(MISSIONS, store);
    expect(channels.events.totalListeners()).toBeGreaterThan(0);
    detach();
    expect(channels.events.totalListeners()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Persistence: batching, migration, corruption, export/import              */
/* -------------------------------------------------------------------------- */

describe('profile-store — persistence', () => {
  it('batches counter writes and writes a completion through', () => {
    const storage = seededStorage();
    const store = makeStore(storage);
    const { tracker, channels, detach } = makeTracker([KILL_10], store);
    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });

    for (let i = 0; i < 9; i++) emitKill(channels, P1, P0, EntityKind.Vehicle);
    // Nine kills, no timer fired, nothing on disk yet.
    expect(store.writeCount).toBe(0);

    emitKill(channels, P1, P0, EntityKind.Vehicle);
    expect(store.writeCount).toBeGreaterThan(0);
    const persisted = JSON.parse(storage.raw() ?? '{}') as { missions: Record<string, { complete: boolean }> };
    expect(persisted.missions['test.kill10'].complete).toBe(true);
    detach();
  });

  it('re-queues an unrevealed reward after a reload', () => {
    // The tab closed between "mission complete" and the end screen. The reward
    // is on the profile as complete-and-unclaimed, so the next session owes the
    // player the reveal.
    const storage = seededStorage();
    const a = makeStore(storage);
    const t1 = makeTracker([KILL_10], a);
    t1.tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });
    for (let i = 0; i < 10; i++) emitKill(t1.channels, P1, P0, EntityKind.Vehicle);
    expect(a.get().missions['test.kill10'].claimedAt).toBeNull();
    t1.detach();

    const b = makeStore(storage);
    const t2 = new MissionTracker([KILL_10], b, { ...NO_TIMERS, now: () => 9_000 });
    expect(t2.drainPending()).toEqual([{ kind: 'unlock', unlockId: 'test.unlock.a' }]);
    expect(b.get().missions['test.kill10'].claimedAt).toBe(9_000);

    // Third session: the claim is stamped, so nothing is owed.
    const c = makeStore(storage);
    expect(new MissionTracker([KILL_10], c, { ...NO_TIMERS }).drainPending()).toEqual([]);
  });

  it('survives a reload with the counter intact', () => {
    const storage = seededStorage();
    const a = makeStore(storage);
    const t1 = makeTracker([KILL_10], a);
    t1.tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });
    for (let i = 0; i < 4; i++) emitKill(t1.channels, P1, P0, EntityKind.Vehicle);
    a.flush();
    t1.detach();

    const b = makeStore(storage);
    const t2 = new MissionTracker([KILL_10], b, { ...NO_TIMERS });
    expect(t2.progressOf('test.kill10').value).toBe(4);
  });

  it('migrates a v1 profile', () => {
    const v1 = {
      version: 1,
      unlocked: ['unit.raider'],
      missions: { 'combat.kills.1': 25, 'combat.kills.2': 40 },
      completed: ['combat.kills.1', 'economy.harvest.1'],
      matches: 12,
      wins: 7,
    };
    const store = makeStore(seededStorage(JSON.stringify(v1)));
    const p = store.get();

    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.unlocked).toEqual(['unit.raider']);
    expect(p.missions['combat.kills.1']).toEqual({
      id: 'combat.kills.1', value: 25, complete: true, claimedAt: null,
    });
    expect(p.missions['combat.kills.2'].complete).toBe(false);
    // An id that only ever appeared in `completed` still has to survive.
    expect(p.missions['economy.harvest.1'].complete).toBe(true);
    expect(p.stats.matchesPlayed).toBe(12);
    expect(p.stats.wins).toBe(7);
    expect(p.stats.losses).toBe(5);
  });

  it('treats an unversioned blob as v1', () => {
    const raw = { unlocked: [], missions: { a: 3 }, completed: ['a'], wins: 1 };
    const p = normalizeProfile(migrateProfile(raw));
    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.missions.a).toEqual({ id: 'a', value: 3, complete: true, claimedAt: null });
  });

  it('passes a v2 profile through untouched', () => {
    const source = defaultProfile(1);
    source.unlocked = ['x'];
    source.missions.m = { id: 'm', value: 4, complete: false, claimedAt: null };
    const round = normalizeProfile(migrateProfile(JSON.parse(JSON.stringify(source))));
    expect(round.unlocked).toEqual(['x']);
    expect(round.missions.m.value).toBe(4);
  });

  it('keeps what it recognises from a FUTURE profile rather than wiping it', () => {
    const future = {
      version: PROFILE_VERSION + 5,
      unlocked: ['unit.raider'],
      missions: { 'combat.kills.1': { value: 9, complete: false, claimedAt: null } },
      stats: { matchesPlayed: 3, wins: 2, losses: 1, currentStreak: 1, bestStreak: 2, winsByFaction: { 1: 2 } },
      somethingNew: { we: 'do not understand' },
    };
    const store = makeStore(seededStorage(JSON.stringify(future)));
    expect(store.get().unlocked).toEqual(['unit.raider']);
    expect(store.get().missions['combat.kills.1'].value).toBe(9);
    expect(store.get().stats.wins).toBe(2);
  });

  it('recovers from a corrupt profile instead of failing to boot', () => {
    for (const junk of ['{not json', '', 'null', '"a string"', '[1,2,3]', '7']) {
      const store = makeStore(seededStorage(junk));
      expect(store.get().version).toBe(PROFILE_VERSION);
      expect(store.get().unlocked).toEqual([]);
      expect(store.get().missions).toEqual({});
      expect(store.get().stats.wins).toBe(0);
    }
    // Only the blobs that parsed to a non-profile are reported as recovered;
    // "no profile yet" is not corruption.
    expect(makeStore(seededStorage('[1,2,3]')).recovered).toBe(true);
    expect(makeStore(seededStorage()).recovered).toBe(false);
  });

  it('sanitises a hostile blob', () => {
    const hostile = {
      version: 2,
      unlocked: ['ok', 'ok', 42, null, 'x'.repeat(500)],
      missions: { good: { value: -5, complete: 'yes', claimedAt: 'never' } },
      stats: { wins: Number.NaN, losses: -3, currentStreak: 9, bestStreak: 1, winsByFaction: { 'drop--me': 4, 2: 3 } },
    };
    const p = normalizeProfile(hostile);
    expect(p.unlocked).toEqual(['ok']);
    expect(p.missions.good).toEqual({ id: 'good', value: 0, complete: false, claimedAt: null });
    expect(p.stats.wins).toBe(0);
    expect(p.stats.losses).toBe(0);
    expect(p.stats.bestStreak).toBe(9); // repaired: best can never trail current
    expect(p.stats.winsByFaction).toEqual({ 2: 3 });
  });

  it('never throws, for any input at all', () => {
    for (const junk of [null, undefined, 0, 'x', [], [[]], { missions: 5 }, { unlocked: 'no' }]) {
      expect(() => normalizeProfile(junk)).not.toThrow();
      expect(() => migrateProfile(junk)).not.toThrow();
    }
  });

  it('round-trips through export and import', () => {
    const storage = seededStorage();
    const store = makeStore(storage);
    store.mutateNow((p) => { p.unlocked.push('unit.raider'); p.stats.wins = 4; return true; });

    const json = store.exportJson();
    expect(JSON.parse(json).kind).toBe('voltmarch.profile');

    const fresh = makeStore(seededStorage());
    expect(fresh.get().unlocked).toEqual([]);
    expect(fresh.importJson(json)).toBe(true);
    expect(fresh.get().unlocked).toEqual(['unit.raider']);
    expect(fresh.get().stats.wins).toBe(4);
  });

  it('imports a v1 export, and refuses anything that is not a profile', () => {
    const store = makeStore(seededStorage());
    expect(store.importJson(JSON.stringify({ version: 1, unlocked: ['a'], completed: ['m'] }))).toBe(true);
    expect(store.get().unlocked).toEqual(['a']);
    expect(store.get().missions.m.complete).toBe(true);

    expect(store.importJson('not json at all')).toBe(false);
    expect(store.importJson(JSON.stringify({ hello: 'world' }))).toBe(false);
    expect(store.get().unlocked).toEqual(['a']); // untouched by a failed import
  });

  it('accepts a bare profile blob as well as the envelope', () => {
    const bare = serializeProfile(defaultProfile(1));
    expect(parseProfileExport(bare)).not.toBeNull();
    expect(parseProfileExport(JSON.stringify(defaultProfile(1)))).not.toBeNull();
    expect(parseProfileExport('{}')).toBeNull();
  });

  it('resets to a fresh profile', () => {
    const store = makeStore(seededStorage());
    store.mutateNow((p) => { p.unlocked.push('a'); return true; });
    store.reset();
    expect(store.get().unlocked).toEqual([]);
  });

  it('degrades to memory when storage throws on write', () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    const store = makeStore(hostile);
    expect(() => store.mutateNow((p) => { p.unlocked.push('a'); return true; })).not.toThrow();
    expect(store.get().unlocked).toEqual(['a']);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. The unlock gate                                                          */
/* -------------------------------------------------------------------------- */

describe('UnlockGate — filtering a catalogue', () => {
  interface Entry { key: string; unlockedBy?: string }

  const CATALOGUE: Entry[] = [
    { key: 'gi' },
    { key: 'grizzly' },
    { key: 'harvester' },
    { key: 'ifv', unlockedBy: UNLOCKS.unitRaider },
    { key: 'prismTank', unlockedBy: UNLOCKS.unitSpecialist },
    { key: 'battleLab', unlockedBy: UNLOCKS.structTech },
  ];

  it('passes untagged defs and blocks tagged ones on a fresh profile', () => {
    const gate = new UnlockGate(() => []);
    expect(gate.filter(CATALOGUE).map((e) => e.key)).toEqual(['gi', 'grizzly', 'harvester']);
    expect(gate.reasonFor(CATALOGUE[0])).toBe('');
    expect(gate.reasonFor(CATALOGUE[3])).not.toBe('');
  });

  it('opens a def the moment its unlock lands, with no rebuild', () => {
    const owned: string[] = [];
    const gate = new UnlockGate(() => owned);
    expect(gate.allows(CATALOGUE[3])).toBe(false);
    owned.push(UNLOCKS.unitRaider);
    expect(gate.allows(CATALOGUE[3])).toBe(true);
    expect(gate.filter(CATALOGUE).map((e) => e.key)).toContain('ifv');
  });

  it('leaves a complete starting army available with nothing unlocked', () => {
    const gate = new UnlockGate(() => []);
    const open = gate.filter(CATALOGUE).map((e) => e.key);
    // The design's central rule: a genuinely good first match, no grind first.
    for (const must of ['gi', 'grizzly', 'harvester']) expect(open).toContain(must);
  });

  it('mirrors the human tier onto the AI, and lifts it when told to', () => {
    const gate = new UnlockGate(() => []);
    const human = { isHuman: true };
    const ai = { isHuman: false };
    expect(gate.allowsFor(ai, CATALOGUE[4])).toBe(false);   // mirrored: AI is gated too

    gate.setMirrorAI(false);
    expect(gate.allowsFor(ai, CATALOGUE[4])).toBe(true);    // unmirrored AI is unrestricted
    expect(gate.allowsFor(human, CATALOGUE[4])).toBe(false); // the human never is

    gate.setUnrestricted(true);
    expect(gate.allowsFor(human, CATALOGUE[4])).toBe(true);
  });

  it('reuses a caller-supplied output array', () => {
    const gate = new UnlockGate(() => []);
    const out: Entry[] = [];
    gate.filter(CATALOGUE, out);
    const first = out.length;
    gate.filter(CATALOGUE, out);
    expect(out.length).toBe(first);
  });

  it('audits tags no mission grants', () => {
    const gate = new UnlockGate(() => [], { knownUnlockIds: MISSION_UNLOCK_IDS });
    expect(gate.auditTags(CATALOGUE)).toEqual([]);
    expect(gate.auditTags([{ key: 'ghost', unlockedBy: 'unit.does-not-exist' }]))
      .toEqual(['unit.does-not-exist']);
  });

  it('is a no-op when no gate is installed', () => {
    setUnlockGate(null);
    expect(isBuildable(CATALOGUE[4])).toBe(true);
    expect(filterBuildable(CATALOGUE).length).toBe(CATALOGUE.length);

    setUnlockGate(new UnlockGate(() => []));
    expect(isBuildable(CATALOGUE[4])).toBe(false);
    expect(isBuildable(CATALOGUE[4], { isHuman: false })).toBe(false);
    expect(filterBuildable(CATALOGUE).length).toBe(3);
    setUnlockGate(null);
  });

  it('resolves against the live profile', () => {
    const store = makeStore(seededStorage());
    const gate = new UnlockGate(() => store.get().unlocked);
    expect(gate.isUnlocked(UNLOCKS.unitRaider)).toBe(false);
    store.mutateNow((p) => { p.unlocked.push(UNLOCKS.unitRaider); return true; });
    expect(gate.isUnlocked(UNLOCKS.unitRaider)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Notification                                                             */
/* -------------------------------------------------------------------------- */

describe('MissionTracker — notification', () => {
  it('notifies immediately on a completion and coalesces plain ticks', () => {
    const store = makeStore(seededStorage());
    const { tracker, channels, detach } = makeTracker([KILL_10], store);
    let calls = 0;
    tracker.subscribe(() => { calls++; });

    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });
    const afterBegin = calls;
    expect(afterBegin).toBe(1);

    for (let i = 0; i < 9; i++) emitKill(channels, P1, P0, EntityKind.Vehicle);
    // Coalesced behind a timer that this harness never fires.
    expect(calls).toBe(afterBegin);
    tracker.flushNotify();
    expect(calls).toBe(afterBegin + 1);

    emitKill(channels, P1, P0, EntityKind.Vehicle);
    expect(calls).toBe(afterBegin + 2); // the completion is immediate
    expect(tracker.version).toBeGreaterThan(0);
    detach();
  });

  it('drops the listener on unsubscribe', () => {
    const store = makeStore(seededStorage());
    const tracker = new MissionTracker([KILL_10], store, { ...NO_TIMERS });
    let calls = 0;
    const off = tracker.subscribe(() => { calls++; });
    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });
    off();
    tracker.endMatch({ won: false, durationSec: 1 });
    expect(calls).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 8. The published view                                                       */
/* -------------------------------------------------------------------------- */

describe('ProgressionView — the shape the UI codes against', () => {
  it('exposes catalogue, objectives, profile and drainPending', async () => {
    const { createProgressionHandle } = await import('../src/progression/progression.system');
    const store = makeStore(seededStorage());
    const tracker = new MissionTracker(MISSIONS, store, { ...NO_TIMERS });
    const gate = new UnlockGate(() => store.get().unlocked);
    const view = createProgressionHandle(tracker, store, gate);

    const cat = view.catalogue();
    expect(cat.length).toBe(MISSIONS.length);
    expect(cat[0].progress.target).toBe(cat[0].target);
    expect(cat.some((e) => e.locked)).toBe(true);

    expect(view.activeObjectives()).toEqual([]);
    view.beginMatch({ seed: 3, localPlayer: 0, faction: Faction.Allies });
    expect(view.inMatch()).toBe(true);
    expect(view.activeObjectives().length).toBeGreaterThan(0);
    expect(view.activeObjectives().every((o) => o.scope === 'match')).toBe(true);

    const p = view.profile();
    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.missions.length).toBe(MISSIONS.filter((m) => m.scope === 'profile').length);

    view.endMatch({ won: true, durationSec: 500 });
    expect(view.isUnlocked(UNLOCKS.insigniaBronze)).toBe(true);
    const drained = view.drainPending();
    expect(drained.some((r) => r.kind === 'unlock' && r.unlockId === UNLOCKS.insigniaBronze)).toBe(true);
    expect(view.drainPending()).toEqual([]);

    // The claim is stamped, so the end screen never reveals the same thing twice.
    const row = view.profile().missions.find((m) => m.id === 'tactics.wins.1');
    expect(row?.claimedAt).not.toBeNull();

    expect(typeof view.exportProfile()).toBe('string');
    view.resetProfile();
    expect(view.profile().unlocked).toEqual([]);
  });

  it('registers as a SystemModule that can never touch the sim step', () => {
    // The determinism boundary, asserted rather than asserted-in-a-comment.
    // `SystemRegistry.rebuild` filters the sim run list on
    // `typeof module.simTick === 'function'`, so a module without one is
    // structurally incapable of perturbing the fixed step.
    return import('../src/progression/progression.system').then((mod) => {
      const system = mod.default;
      expect(typeof system.id).toBe('string');
      expect(system.id.length).toBeGreaterThan(0);
      expect(typeof system.init).toBe('function');
      expect(system.simTick).toBeUndefined();
      expect(system.frame).toBeUndefined();
      expect(typeof system.dispose).toBe('function');
    });
  });

  it('attributes a kill by comparing players, not the killer handle', () => {
    // `NONE` is 0, and player 0 is the LOCAL player in every skirmish this
    // build ships. So `killer !== NONE` would be a broken test for "somebody
    // actually shot it" — the tracker compares `killerPlayer` against the local
    // player instead, which is why `Damage.ts`'s fallback (killerPlayer =
    // victim's player when the shooter is already dead) does not register as a
    // kill. This asserts the trap is still a trap.
    expect(NONE as number).toBe(0);

    const store = makeStore(seededStorage());
    const { tracker, channels, detach } = makeTracker([KILL_10], store);
    tracker.beginMatch({ seed: 1, localPlayer: 0, faction: Faction.Allies });
    // An enemy unit dying with no surviving shooter: killerPlayer == victim.
    emitKill(channels, P1, P1, EntityKind.Vehicle);
    expect(tracker.progressOf('test.kill10').value).toBe(0);
    detach();
  });
});

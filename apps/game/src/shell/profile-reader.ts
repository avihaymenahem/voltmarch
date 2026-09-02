/**
 * Read-only progression provider for out-of-match profile screens.
 *
 * The live progression system belongs to a battlefield bootstrap because it
 * also attaches to the simulation event bus and installs the production
 * unlock gate. The title screen deliberately has neither. This smaller
 * provider loads only the profile store, mission table and tracker when a
 * player opens Service Record; it never touches the game context or the
 * renderer.
 */

import { MISSIONS, unlockSource as missionUnlockSource } from '../data/Missions';
import type {
  CatalogueEntry,
  MissionProgress,
  ProgressionView,
  ProfileView,
} from '../ui/Objectives';
import { MissionTracker } from '../progression/MissionTracker';
import { browserStorage, ProfileStore, type StorageLike } from '../progression/profile-store';

export class ProfileReader implements ProgressionView {
  private readonly store: ProfileStore;
  private readonly tracker: MissionTracker;

  constructor(storage: StorageLike = browserStorage()) {
    this.store = new ProfileStore(storage);
    this.tracker = new MissionTracker(MISSIONS, this.store);
  }

  profile(): ProfileView {
    const profile = this.store.get();
    const missions: MissionProgress[] = [];
    for (const def of MISSIONS) {
      if (def.scope !== 'profile') continue;
      missions.push(this.tracker.progressOf(def.id));
    }
    return {
      version: profile.version,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      unlocked: profile.unlocked,
      missions,
      stats: {
        ...profile.stats,
        winsByFaction: { ...profile.stats.winsByFaction },
      },
      campaign: { ...profile.campaign },
    };
  }

  catalogue(): readonly CatalogueEntry[] {
    return MISSIONS.map((def) => ({
      ...def,
      progress: this.tracker.progressOf(def.id),
      locked: this.tracker.isLocked(def),
    }));
  }

  activeObjectives(): readonly never[] {
    return [];
  }

  drainPending(): readonly [] {
    // Opening a profile must never silently claim a reward intended for the
    // end-screen reveal of the next real match.
    return [];
  }

  isUnlocked(unlockId: string): boolean {
    return this.tracker.isUnlocked(unlockId);
  }

  unlockSource(unlockId: string): { missionId: string; title: string; objective: string } | null {
    const source = missionUnlockSource(unlockId);
    return source === undefined
      ? null
      : { missionId: source.missionId, title: source.title, objective: source.description };
  }

  subscribe(fn: () => void): () => void {
    const offTracker = this.tracker.subscribe(fn);
    const offStore = this.store.subscribe(() => fn());
    return () => {
      offTracker();
      offStore();
    };
  }

  resetProfile(): void {
    this.store.reset();
  }

  exportProfile(): string {
    return this.store.exportJson();
  }

  importProfile(json: string): boolean {
    return this.store.importJson(json);
  }

  dispose(): void {
    this.tracker.dispose();
  }
}

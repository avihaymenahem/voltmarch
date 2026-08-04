/**
 * ============================================================================
 * VOLTMARCH — src/progression/progression.system.ts
 * ============================================================================
 * The registration shim for the progression layer. It builds the profile store,
 * the mission tracker and the unlock gate, subscribes the tracker to the event
 * bus, and publishes the `ProgressionView` on `globalThis.__vmProgression` —
 * the same pattern the shell uses for `__vmSettings`.
 *
 * NO `simTick`. NO `frame`.
 * ------------------------
 * Deliberate and load-bearing. This module has one hook, `init`, and everything
 * after that is driven by events. `SystemRegistry.rebuild` filters on
 * `typeof module.simTick === 'function'`, so a module without one is never
 * added to the sim run list and cannot perturb the deterministic step even by
 * accident. The `phase` below only orders `init`.
 *
 * ORDER
 * -----
 * `Phase.Command, order: 20` puts init before `sim.production` (which will call
 * `isBuildable`) and before the HUD, so the gate is installed and the profile is
 * loaded by the time anything asks a question of either. It is after
 * `world.terrain`, which it does not care about.
 *
 * THE `?shot=` HARNESS
 * --------------------
 * Under `?shot=`, the store is backed by memory and the global handle is NOT
 * published. Two reasons. The screenshot harness has to produce byte-identical
 * frames across machines, and a real profile would make the sidebar depend on
 * whoever last played on that box. And the UI agents are required to degrade
 * gracefully when the handle is absent — that requirement is worth nothing if
 * no configuration in the repo actually exercises it.
 *
 * TEARDOWN
 * --------
 * `dispose` unsubscribes everything, flushes the profile and clears both the
 * global handle and the module-level gate. `bus.totalListeners()` must return
 * to where it started; a match teardown that leaks a mission listener would
 * double-count every kill in the next match.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';
import { ctx } from '../game/context';

import { MISSIONS, MISSION_UNLOCK_IDS } from '../data/Missions';
import { MissionTracker } from './MissionTracker';
import { ProfileStore, browserStorage, memoryStorage } from './profile-store';
import { UnlockGate, setUnlockGate } from './UnlockGate';
import {
  PROGRESSION_GLOBAL_KEY,
  type MatchEndInfo, type MatchStartInfo, type MissionEntry, type MissionProgress,
  type ObjectiveEntry, type ProfileView, type ProgressionHandle, type Reward,
} from './types';

/* -------------------------------------------------------------------------- */

function isShotHarness(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('shot') !== null;
}

interface ProgressionGlobal {
  [PROGRESSION_GLOBAL_KEY]?: ProgressionHandle;
}

let store: ProfileStore | null = null;
let tracker: MissionTracker | null = null;
let gate: UnlockGate | null = null;
let detach: (() => void) | null = null;
let published = false;

/* -------------------------------------------------------------------------- */

/**
 * The public view.
 *
 * A thin adapter over the tracker rather than a second copy of its state: the
 * one thing this layer must never have is two ideas about how far a mission has
 * got. Everything it returns is freshly built or already frozen by convention,
 * and it is documented as immutable.
 */
function buildHandle(t: MissionTracker, s: ProfileStore, g: UnlockGate): ProgressionHandle {
  return {
    profile(): ProfileView {
      const p = s.get();
      const missions: MissionProgress[] = [];
      for (const def of t.defs) {
        if (def.scope !== 'profile') continue;
        missions.push(t.progressOf(def.id));
      }
      return { version: p.version, unlocked: p.unlocked, missions };
    },

    catalogue(): readonly MissionEntry[] {
      const out: MissionEntry[] = [];
      for (const def of t.defs) {
        out.push({ ...def, progress: t.progressOf(def.id), locked: t.isLocked(def) });
      }
      return out;
    },

    activeObjectives(): readonly ObjectiveEntry[] {
      const ids = t.activeObjectiveIds();
      const out: ObjectiveEntry[] = [];
      for (let i = 0; i < ids.length; i++) {
        const def = t.defOf(ids[i]);
        if (def === undefined) continue;
        out.push({ ...def, progress: t.progressOf(def.id) });
      }
      return out;
    },

    drainPending(): readonly Reward[] {
      return t.drainPending();
    },

    isUnlocked(unlockId: string): boolean {
      return g.isUnlocked(unlockId);
    },

    subscribe(fn: () => void): () => void {
      return t.subscribe(fn);
    },

    resetProfile(): void {
      s.reset();
    },

    exportProfile(): string {
      return s.exportJson();
    },

    importProfile(json: string): boolean {
      return s.importJson(json);
    },

    /* -- control -------------------------------------------------------- */

    beginMatch(info: MatchStartInfo): void {
      t.beginMatch(info);
    },

    endMatch(info: MatchEndInfo): void {
      t.endMatch(info);
    },

    abandonMatch(): void {
      t.abandonMatch();
    },

    inMatch(): boolean {
      return t.inMatch();
    },

    flush(): void {
      t.flush();
    },
  };
}

/* -------------------------------------------------------------------------- */

export default defineSystem({
  id: 'progression.core',
  phase: Phase.Command,
  order: 20,

  init(): void {
    const harness = isShotHarness();

    store = new ProfileStore(harness ? memoryStorage() : browserStorage());
    tracker = new MissionTracker(MISSIONS, store);
    gate = new UnlockGate(() => store?.get().unlocked ?? EMPTY, {
      knownUnlockIds: MISSION_UNLOCK_IDS,
      // UNRESTRICTED UNDER THE HARNESS, and this is not the same statement as
      // the memory store above.
      //
      // The memory store gives determinism: no shot ever depends on whoever
      // last played on that box. But an EMPTY profile is not neutral — it is
      // the most restrictive profile there is, and the moment the gate was
      // wired into `availabilityOf` and `ScenarioBuilder` it started deleting
      // the Battle Lab from 02-hud-full, the Tesla Coils from 07-soviet-base
      // and the Apocalypses from 05-combat. Those scenarios are authored
      // compositions scored against `docs/RA3_LOOK_BIBLE.md`, and the grade
      // dropped a point before this line existed. Measured, not guessed.
      //
      // Unrestricted is equally deterministic and shows the content the shot
      // was composed around. The handle is still withheld below, so the UI's
      // absent-handle path stays exercised by a real configuration.
      unrestricted: harness,
    });

    setUnlockGate(gate);
    detach = tracker.attach(ctx().channels.events);

    if (store.recovered) {
      console.warn('[progression] the stored profile was unreadable and has been reset.');
    }

    if (!harness) {
      const g = globalThis as ProgressionGlobal;
      g[PROGRESSION_GLOBAL_KEY] = buildHandle(tracker, store, gate);
      published = true;
    }

    const unlocked = store.get().unlocked.length;
    console.info(
      `[progression] ${MISSIONS.length} missions, ${unlocked} unlock${unlocked === 1 ? '' : 's'} owned`
      + `${harness ? ' (shot harness: memory profile, handle not published)' : ''}`,
    );
  },

  dispose(): void {
    detach?.();
    detach = null;
    tracker?.dispose();
    store?.dispose();
    setUnlockGate(null);
    if (published) {
      const g = globalThis as ProgressionGlobal;
      delete g[PROGRESSION_GLOBAL_KEY];
      published = false;
    }
    tracker = null;
    store = null;
    gate = null;
  },
});

const EMPTY: readonly string[] = [];

/* -------------------------------------------------------------------------- */

/** The live tracker, for a test or a debug console. Null before `init`. */
export function progressionTracker(): MissionTracker | null {
  return tracker;
}

/** The live profile store. Null before `init`. */
export function progressionStore(): ProfileStore | null {
  return store;
}

/** The live handle, or null when progression is not running. */
export function progression(): ProgressionHandle | null {
  return (globalThis as ProgressionGlobal)[PROGRESSION_GLOBAL_KEY] ?? null;
}

/** Exported so a test can build a handle without booting the engine. */
export { buildHandle as createProgressionHandle };

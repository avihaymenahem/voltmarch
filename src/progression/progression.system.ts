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

import {
  MISSIONS, MISSION_UNLOCK_IDS, UNLOCK_REQUIREMENTS,
  unlockSource as unlockSourceOf,
} from '../data/Missions';
import { MissionTracker } from './MissionTracker';
import { ProfileStore, browserStorage, memoryStorage } from './profile-store';
import { UnlockGate, setUnlockGate } from './UnlockGate';
// `campaign-store.ts` imports `profile-store` (already here) plus one TYPE from
// `campaign/types.ts`, which is erased. So this costs the entry chunk nothing
// and does not put the Director, the operation table or a layout anywhere near
// it — `tests/campaign-bundle-isolation.spec.ts` is what says so rather than
// this comment.
import { recordOperation } from '../campaign/campaign-store';
import type { Medal } from '../campaign/types';
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

/**
 * `?unlockall` — DEVELOPER FLAG. Every gated unit, structure and mission reward
 * is treated as owned for this page load.
 *
 * IT IS READ-ONLY BY CONSTRUCTION, and that is the reason it is safe to ship.
 * `UnlockGate.unrestricted` only changes what `isUnlocked` ANSWERS; it never
 * writes to the profile, and `MissionTracker` grants rewards on its own path
 * regardless of the gate. So a session started with this flag cannot award
 * itself anything, and reloading without the flag restores the real profile
 * exactly. Nothing is persisted, so nothing has to be cleaned up.
 *
 * WHY IT IS NOT GATED ON `import.meta.env.DEV`. It would then be dead in the
 * one place it is actually needed: the GitHub Pages build is a production
 * bundle, and that is where this project's bugs are reported from. A flag that
 * only works on localhost is a flag that does not work. It is undiscoverable
 * rather than unavailable — no UI exposes it — and it announces itself loudly
 * in the console so a session running with it can never be mistaken for a
 * normal one, which is the failure mode that actually matters when triaging a
 * screenshot.
 *
 * If this ever needs to be genuinely unavailable in production, wrap the return
 * in `import.meta.env.DEV &&` — but then also stop using it to reproduce
 * deployed bugs.
 */
export function isUnlockAll(search?: string): boolean {
  if (search !== undefined) {
    const q = new URLSearchParams(search);
    return q.has('unlockall') || q.get('unlock') === 'all';
  }
  if (typeof location === 'undefined') return false;
  const q = new URLSearchParams(location.search);
  return q.has('unlockall') || q.get('unlock') === 'all';
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
      return { version: p.version, unlocked: p.unlocked, missions, campaign: p.campaign };
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

    /**
     * Which mission grants an unlock id, for the sidebar's locked slot.
     *
     * TWO ROUTES REACH THE SAME SENTENCE, and that is deliberate rather than
     * duplication. `UnlockGate.reasonFor` already answers "Locked — Strip Mine:
     * mine 70,000 credits of ore" for anything the SIM asks about, which is
     * what `Production.availabilityOf` puts on `BuildEntry.reason`. This is the
     * HUD's own route, and it exists because `Sidebar.lockedSentence` composes a
     * head with a hint and can therefore also serve a caller that has no
     * production entry at all — the fallback roster, and any future screen that
     * lists content it cannot build.
     *
     * They converge instead of colliding: `lockedSentence` splits the reason on
     * its em-dash and rebuilds, so a rich reason plus this hint yields the rich
     * sentence exactly once. Declared OPTIONAL on `ProgressionView` so a build
     * without the mission table degrades to the generic line rather than
     * throwing — see `UnlockSource` in `src/ui/Objectives.ts`.
     */
    unlockSource(unlockId: string): { missionId: string; title: string; objective: string } | null {
      const src = unlockSourceOf(unlockId);
      if (src === undefined) return null;
      return { missionId: src.missionId, title: src.title, objective: src.description };
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

    recordCampaignOperation(operationId: string, medal: number): boolean {
      // The clamp and the monotonic rule both live in `recordOperation`; this
      // is a pass-through so there is one definition of what a medal may be.
      return recordOperation(s, operationId, Math.trunc(medal) as Medal);
    },

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
    const unlockAll = isUnlockAll();

    store = new ProfileStore(harness ? memoryStorage() : browserStorage());
    tracker = new MissionTracker(MISSIONS, store);
    gate = new UnlockGate(() => store?.get().unlocked ?? EMPTY, {
      knownUnlockIds: MISSION_UNLOCK_IDS,
      // WHICH MISSION, NOT "a mission". This is the ONE call site that knows
      // both halves — the mission table and the gate — so it is where the join
      // is made. `UnlockGate` must keep importing nothing but its own types
      // (see the note on `UnlockGateOptions.unlockHints`): the sim calls
      // `isBuildable` from inside `ProductionCatalog`, and an import of
      // `data/Missions` there would pull the whole progression layer into the
      // simulation bundle. Handing the map in as data costs one line and keeps
      // that boundary exactly where it was.
      unlockHints: UNLOCK_REQUIREMENTS,
      // UNRESTRICTED UNDER THE HARNESS, and this is not the same statement as
      // the memory store above.
      //
      // The memory store gives determinism: no shot ever depends on whoever
      // last played on that box. But an EMPTY profile is not neutral — it is
      // the most restrictive profile there is, and the moment the gate was
      // wired into `availabilityOf` and `ScenarioBuilder` it started deleting
      // the Proving Ground from 02-hud-full, the Tesla Coils from 07-soviet-base
      // and the Sledges from 05-combat. Those scenarios are authored
      // compositions scored against `docs/RA3_LOOK_BIBLE.md`, and the grade
      // dropped a point before this line existed. Measured, not guessed.
      //
      // Unrestricted is equally deterministic and shows the content the shot
      // was composed around. The handle is still withheld below, so the UI's
      // absent-handle path stays exercised by a real configuration.
      // `?unlockall` rides the same policy the harness uses. See `isUnlockAll`
      // for why this is read-only and cannot contaminate the stored profile.
      unrestricted: harness || unlockAll,
    });

    if (unlockAll) {
      console.warn(
        '[progression] ?unlockall IS ACTIVE — every gated unit and structure is '
        + 'available. Nothing is written to your profile; reload without the flag '
        + 'to get your real progression back.',
      );
    }

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

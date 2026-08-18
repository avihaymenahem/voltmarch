/**
 * ============================================================================
 * VOLTMARCH — src/progression/MissionTracker.ts
 * ============================================================================
 * The engine of the missions system: it subscribes to the event bus, advances
 * counters, completes missions, grants unlocks and queues rewards.
 *
 * THE DETERMINISM BOUNDARY — NON-NEGOTIABLE
 * -----------------------------------------
 * THIS FILE NEVER RUNS INSIDE `simTick`. It has no `simTick`, its owning system
 * module has no `simTick`, and it reads nothing the simulation writes except
 * through pooled event payloads that it copies out of immediately.
 *
 * The sim is deterministic under a fixed seed and there is a soak asserting an
 * AI-vs-AI match replays identically. Mission state is player-profile data: it
 * is loaded from localStorage, which means it differs between two players who
 * pressed the same buttons, which means letting it touch simulation state is a
 * desync with extra steps. It reads; it never writes back.
 *
 * That is also why the tracker's clock is `Date.now` and not the tick counter.
 * `Date.now` is banned in `src/sim/**` and this is not `src/sim/**`; the
 * determinism grep in `tests/foundation.spec.ts` walks exactly that directory.
 *
 * WHAT IT COSTS PER EVENT
 * -----------------------
 * Missions are bucketed by `rule.on` once, at construction. A kill event walks
 * only the kill missions — a handful — does integer arithmetic, and returns.
 * Nothing allocates on the event path: reward objects are only built when a
 * mission actually completes, which happens single-digit times per match.
 *
 * Persistence is batched. 400 kills in a match is 400 counter increments and
 * ONE localStorage write, because `ProfileStore.mutate` debounces. Completions
 * and unlocks write through immediately — those are the two states a player
 * would notice losing to a closed tab.
 *
 * MATCH LIFECYCLE
 * ---------------
 * `match:started` / `match:ended` are emitted by `src/game/outcome.system.ts`,
 * which owns the match lifecycle on the bus. The tracker ALSO takes the
 * lifecycle from direct `beginMatch` / `endMatch` calls, because `Shell` makes
 * them with a strictly richer payload than either event carries — the
 * difficulty and the faction the world actually seated the human as — and
 * because the tracker has to keep working in a build with no shell at all.
 *
 * The two paths are idempotent against each other, in both directions:
 * `endMatch` returns immediately when no match is open, and the `match:started`
 * handler defers to a match already open for that seed and player. So the
 * shell's version wins where there is a shell, the event's version wins where
 * there is not, and neither ever double-counts a match played.
 * ============================================================================
 */

import {
  CreditReason, EntityKind,
  type EventHandler, type EventName,
} from '../core/types';

import {
  ProfileStore, grantUnlock, missionRow,
  type Profile, type ProfileMission,
} from './profile-store';

import {
  metricOf,
  type MatchEndInfo, type MatchStartInfo, type MissionDef, type MissionProgress,
  type MissionRule, type Reward, type RuleKind,
} from './types';

import { progressionSuppressed } from './suppress';

/* ==========================================================================
 * 1. WHAT THE TRACKER NEEDS FROM THE BUS
 *
 * Structural, not the concrete `EventBus`, so a test can drive the tracker with
 * twenty lines of stub and the whole suite stays `environment: 'node'`.
 * ========================================================================== */

export interface EventSource {
  on<K extends EventName>(name: K, fn: EventHandler<K>): () => void;
}

/** Most objectives on screen at once. Beyond this the panel is noise. */
export const MATCH_OBJECTIVE_LIMIT = 5;

/** Entity kinds a bare `kill`/`lose` rule counts. Props and wrecks are not kills. */
const COMBAT_KINDS: readonly EntityKind[] = [
  EntityKind.Infantry, EntityKind.Vehicle, EntityKind.Building,
];

/** Default `earn` reason: mined ore. A refund is not income. */
const DEFAULT_EARN_REASONS: readonly number[] = [CreditReason.Harvest];

/* ==========================================================================
 * 2. TRANSIENT STATE
 * ========================================================================== */

/** A match-scope mission's progress. Never persisted. */
interface MatchRow {
  value: number;
  complete: boolean;
  claimedAt: number | null;
}

interface MatchState {
  seed: number;
  localPlayer: number;
  faction: number;
  difficulty: number;
  /** Ids of the objectives drawn for this match, in display order. */
  objectives: string[];
  /** Own entities destroyed this match, indexed by `EntityKind`. */
  lossesByKind: Int32Array;
}

export interface MissionTrackerOptions {
  now?: () => number;
  /** Coalescing window for the "something changed" notification, in ms. */
  notifyDelayMs?: number;
  schedule?: (fn: () => void, ms: number) => number;
  cancel?: (handle: number) => void;
  /** Objectives drawn per match. Lowered by a test; never raised in the game. */
  objectiveLimit?: number;
}

function defaultSchedule(fn: () => void, ms: number): number {
  const st = (globalThis as { setTimeout?: (f: () => void, m: number) => unknown }).setTimeout;
  if (typeof st !== 'function') return 0;
  return st(fn, ms) as unknown as number;
}

function defaultCancel(handle: number): void {
  const ct = (globalThis as { clearTimeout?: (h: number) => void }).clearTimeout;
  if (typeof ct === 'function') ct(handle);
}

/* ==========================================================================
 * 3. THE TRACKER
 * ========================================================================== */

export class MissionTracker {
  private readonly byId = new Map<string, MissionDef>();
  /** Missions bucketed by `rule.on`. Built once; never rebuilt. */
  private readonly byRule = new Map<RuleKind, MissionDef[]>();
  /** Transient progress for `scope: 'match'` missions. */
  private readonly matchRows = new Map<string, MatchRow>();

  private match: MatchState | null = null;
  /**
   * The last faction the local player was known to be fielding. Survives
   * between matches so the `match:started` event path — whose payload has no
   * faction — can still credit a mastery chain.
   */
  private lastFaction = 0;
  private readonly pending: Reward[] = [];
  private readonly listeners: (() => void)[] = [];
  private readonly unsubscribes: (() => void)[] = [];

  private notifyTimer: number | null = null;
  private notifyDirty = false;

  private readonly now: () => number;
  private readonly notifyDelayMs: number;
  private readonly schedule: (fn: () => void, ms: number) => number;
  private readonly cancel: (handle: number) => void;
  private readonly objectiveLimit: number;

  /** Bumps on every observable change. A polling UI can diff this integer. */
  version = 0;

  constructor(
    readonly defs: readonly MissionDef[],
    readonly store: ProfileStore,
    options: MissionTrackerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.notifyDelayMs = options.notifyDelayMs ?? 250;
    this.schedule = options.schedule ?? defaultSchedule;
    this.cancel = options.cancel ?? defaultCancel;
    this.objectiveLimit = Math.max(1, options.objectiveLimit ?? MATCH_OBJECTIVE_LIMIT);

    for (const def of defs) {
      this.byId.set(def.id, def);
      const rule = def.rule;
      if (rule === undefined) continue;
      let bucket = this.byRule.get(rule.on);
      if (bucket === undefined) {
        bucket = [];
        this.byRule.set(rule.on, bucket);
      }
      bucket.push(def);
    }

    // Rewards that completed but were never revealed — a tab closed before the
    // end screen, or a v1 profile migrated up (v1 could not record a claim, so
    // the migration seeds every completion as unclaimed). Queue them now, so
    // the next end screen shows them exactly once and `claimedAt` closes the
    // loop. Without this, `drainPending` would stamp them as claimed on its
    // first call and the player would never see what they earned.
    const stored = store.get().missions;
    for (const def of defs) {
      if (def.scope !== 'profile') continue;
      const row = stored[def.id];
      if (row === undefined || !row.complete || row.claimedAt !== null) continue;
      for (let i = 0; i < def.reward.length; i++) this.pending.push(def.reward[i]);
    }
  }

  /* -- wiring ------------------------------------------------------------- */

  /**
   * Subscribe to every channel the rule language can reach. Returns an
   * unsubscribe that also detaches everything else, so a match teardown that
   * calls it leaves `bus.totalListeners()` where it found it.
   */
  attach(bus: EventSource): () => void {
    const off = this.unsubscribes;

    off.push(bus.on('entity:killed', (p) => {
      const m = this.match;
      if (m === null) return;
      const victim = p.player as number;
      const killer = p.killerPlayer as number;
      if (victim === m.localPlayer) {
        // A loss. `lossesByKind` also feeds the end-of-match `noLoss` flags.
        const k = p.kind as number;
        if (k >= 0 && k < m.lossesByKind.length) m.lossesByKind[k]++;
        this.forEachRule('lose', (def, rule) => {
          if (rule.on !== 'lose') return;
          if (!kindMatches(rule.kinds, p.kind)) return;
          this.advance(def, 1);
        });
        return;
      }
      // `Damage.ts` writes `killerPlayer = victim.player` when the killer is
      // already gone, so "somebody else's unit died" is not by itself a kill.
      if (killer !== m.localPlayer) return;
      this.forEachRule('kill', (def, rule) => {
        if (rule.on !== 'kill') return;
        if (!kindMatches(rule.kinds ?? COMBAT_KINDS, p.kind)) return;
        this.advance(def, rule.metric === 'value' ? Math.max(0, p.value) : 1);
      });
    }));

    off.push(bus.on('building:completed', (p) => {
      if (!this.isLocal(p.player as number)) return;
      this.forEachRule('build', (def) => { this.advance(def, 1); });
    }));

    off.push(bus.on('production:ready', (p) => {
      if (!this.isLocal(p.player as number)) return;
      this.forEachRule('produce', (def, rule) => {
        if (rule.on !== 'produce') return;
        if (rule.tab !== undefined) {
          if (p.tab !== rule.tab) return;
        } else if (p.isBuilding) {
          // A bare `produce` rule means units. Structures have `build`.
          return;
        }
        this.advance(def, 1);
      });
    }));

    off.push(bus.on('building:captured', (p) => {
      const m = this.match;
      if (m === null) return;
      if ((p.toPlayer as number) !== m.localPlayer) return;
      if ((p.fromPlayer as number) === m.localPlayer) return;
      this.forEachRule('capture', (def) => { this.advance(def, 1); });
    }));

    off.push(bus.on('economy:credits', (p) => {
      if (!this.isLocal(p.player as number)) return;
      /*
       * ORE IS COUNTED FROM `mined`, NOT FROM THE DELTA.
       *
       * `delta` is the BANK moving and `reason` is the ONE cause the coalescer
       * kept, so this used to lose a harvest three separate ways, all of them
       * measured: a load into a full silo counted 0 (the overflow's `Waste`
       * mark is the reason that survives), a load that only PARTLY fitted also
       * counted 0 — including the part that fitted — and a load sharing a tick
       * with a repair drip or a crate counted 0 as well. Meanwhile the end
       * screen's "Ore Harvested" counted every credit of it, so one label sat
       * over two numbers, and the gap was widest for the player who parks at
       * their cap while saving for a tech centre. Every ore mission in
       * `data/Missions.ts` reads "Mine N credits of ore"; `mined` is that.
       *
       * A rule that lists Harvest ALONGSIDE another earn reason would take the
       * mined figure and skip the other cause for that tick. No such rule
       * exists — every `earn` row in the table is `[Harvest]` — and inventing a
       * per-reason breakdown in a pooled payload for a case nothing asks for is
       * how the coalescer got complicated in the first place.
       */
      const delta = p.delta;
      const mined = p.mined;
      if (delta > 0 || mined > 0) {
        this.forEachRule('earn', (def, rule) => {
          if (rule.on !== 'earn') return;
          const reasons = rule.reasons ?? DEFAULT_EARN_REASONS;
          if (mined > 0 && reasons.includes(CreditReason.Harvest)) {
            this.advance(def, mined);
            return;
          }
          if (delta <= 0 || !reasons.includes(p.reason)) return;
          this.advance(def, delta);
        });
      }
      const held = p.credits;
      this.forEachRule('bank', (def) => { this.advance(def, held); });
    }));

    off.push(bus.on('economy:power', (p) => {
      if (!this.isLocal(p.player as number)) return;
      const surplus = p.produced - p.consumed;
      if (surplus <= 0) return;
      this.forEachRule('power', (def) => { this.advance(def, surplus); });
    }));

    off.push(bus.on('entity:veterancy', (p) => {
      if (!this.isLocal(p.player as number)) return;
      this.forEachRule('veterancy', (def, rule) => {
        if (rule.on !== 'veterancy') return;
        if (p.rank < (rule.rank ?? 1)) return;
        this.advance(def, 1);
      });
    }));

    /* -- lifecycle, from the bus. See the header: `beginMatch`/`endMatch` are
     *    the other half, and whichever describes THIS match first wins.      */
    off.push(bus.on('match:started', (p) => {
      // ALREADY OPEN FOR THIS MATCH? DO NOTHING.
      //
      // `game/outcome.system.ts` emits on the frame the shell enters
      // `'playing'`, which is AFTER `Shell.startMatch` has called `beginMatch`
      // directly with a strictly richer payload — it knows the difficulty and
      // the faction the world actually seated the human as. `beginMatch` is
      // documented to abandon a live match and redraw the board, so taking the
      // event at face value here would throw the shell's version away and
      // replace it with a poorer one on the first frame of every match.
      //
      // Matched on seed AND local player rather than merely "am I in a match",
      // so a match state left over from a route that never ended cleanly is
      // still replaced by the one the event describes.
      const open = this.match;
      if (open !== null
        && open.seed === (p.seed >>> 0)
        && open.localPlayer === (p.localPlayer as number)) return;

      // The payload carries no faction — `EvMatchStarted` is seed, player count
      // and local player. Whoever launched the match told us through
      // `setLocalFaction`; if nobody did, faction-specific chains simply do not
      // advance, which is the correct failure (silently crediting the wrong
      // faction's mastery chain is not).
      this.beginMatch({
        seed: p.seed,
        localPlayer: p.localPlayer as number,
        faction: this.lastFaction,
      });
    }));

    off.push(bus.on('match:ended', (p) => {
      this.endMatch({ won: p.localWon, durationSec: p.durationSec });
    }));

    return () => this.detach();
  }

  /** Drop every bus subscription. Safe to call twice. */
  detach(): void {
    for (let i = 0; i < this.unsubscribes.length; i++) this.unsubscribes[i]();
    this.unsubscribes.length = 0;
  }

  /* -- match lifecycle ---------------------------------------------------- */

  inMatch(): boolean {
    return this.match !== null;
  }

  /**
   * Tell the tracker which faction the local player is fielding, ahead of the
   * match actually starting. The shell knows this from `MatchSetup` before the
   * engine boots; `EvMatchStarted` never carries it.
   */
  setLocalFaction(faction: number): void {
    this.lastFaction = faction | 0;
    if (this.match !== null) this.match.faction = this.lastFaction;
  }

  /**
   * Start a match. Resets every match-scope mission and draws the objective
   * board from the sim seed, so a replay of the same seed shows the same board.
   * Calling it while a match is live abandons that one first.
   */
  beginMatch(info: MatchStartInfo): void {
    // THE LATCH IS READ HERE, NOT AT THE CALL SITE, AND THAT IS THE WHOLE FIX.
    // This method has TWO callers — `Shell.startMatch` and this tracker's own
    // `match:started` subscription below — and the shell's replay carve-out
    // could only ever see one of them. See `./suppress` for what that cost.
    if (progressionSuppressed()) return;
    if (this.match !== null) this.abandonMatch();

    this.matchRows.clear();
    for (const def of this.defs) {
      if (def.scope === 'match') this.matchRows.set(def.id, { value: 0, complete: false, claimedAt: null });
    }

    const state: MatchState = {
      seed: info.seed >>> 0,
      localPlayer: info.localPlayer,
      faction: info.faction,
      difficulty: info.difficulty ?? 0,
      objectives: [],
      lossesByKind: new Int32Array(16),
    };
    this.match = state;
    this.lastFaction = state.faction;
    state.objectives = this.drawObjectives(state.seed);
    this.touch(true);
  }

  /** Quit-to-menu. Profile progress stays; the objective board is discarded. */
  abandonMatch(): void {
    if (this.match === null) return;
    this.match = null;
    this.matchRows.clear();
    this.store.flush();
    this.touch(true);
  }

  /**
   * Finish a match. Evaluates the end-of-match rules (`noLoss`, `win`, `play`,
   * `winStreak`), updates the lifetime record and writes through.
   */
  endMatch(info: MatchEndInfo): void {
    // Both halves of the lifetime record are gated, not just the opening one.
    // A suppressed `beginMatch` leaves `this.match` null so the line below
    // would already refuse — but a latch set MID-match must not let the
    // lifetime stats through on the way out, and `won`/`currentStreak` are
    // exactly what a replay of a victory would otherwise bank.
    if (progressionSuppressed()) return;
    const m = this.match;
    if (m === null) return;

    // 1. Flags that can only be answered once the match is over.
    this.forEachRule('noLoss', (def, rule) => {
      if (rule.on !== 'noLoss') return;
      if (rule.requireWin === true && !info.won) return;
      const kinds = rule.kinds ?? COMBAT_KINDS;
      let lost = 0;
      for (let i = 0; i < kinds.length; i++) {
        const k = kinds[i] as number;
        if (k >= 0 && k < m.lossesByKind.length) lost += m.lossesByKind[k];
      }
      if (lost === 0) this.advance(def, 1);
    });

    // 2. The lifetime record. Written before the win rules so a `winStreak`
    //    mission sees the streak this match just produced.
    const factionKey = String(m.faction | 0);
    this.store.mutate((p) => {
      p.stats.matchesPlayed++;
      if (info.won) {
        p.stats.wins++;
        p.stats.currentStreak++;
        if (p.stats.currentStreak > p.stats.bestStreak) p.stats.bestStreak = p.stats.currentStreak;
        p.stats.winsByFaction[factionKey] = (p.stats.winsByFaction[factionKey] ?? 0) + 1;
      } else {
        p.stats.losses++;
        p.stats.currentStreak = 0;
      }
      return true;
    }, true);

    // 3. Outcome rules.
    this.forEachRule('play', (def) => { this.advance(def, 1); });
    if (info.won) {
      this.forEachRule('win', (def, rule) => {
        if (rule.on !== 'win') return;
        if (rule.faction !== undefined && rule.faction !== m.faction) return;
        if (rule.withinSec !== undefined && info.durationSec > rule.withinSec) return;
        this.advance(def, 1);
      });
      const streak = this.store.get().stats.currentStreak;
      this.forEachRule('winStreak', (def) => { this.advance(def, streak); });
    }

    this.match = null;
    this.matchRows.clear();
    this.store.flush();
    this.touch(true);
  }

  /* -- reading ------------------------------------------------------------ */

  /** The authored row for an id, or undefined. O(1). */
  defOf(id: string): MissionDef | undefined {
    return this.byId.get(id);
  }

  /** Live progress for one mission id. Missing ids read as a fresh zero row. */
  progressOf(id: string): MissionProgress {
    const def = this.byId.get(id);
    const target = def?.target ?? 1;
    if (def !== undefined && def.scope === 'match') {
      const row = this.matchRows.get(id);
      return {
        id,
        value: row?.value ?? 0,
        target,
        complete: row?.complete ?? false,
        claimedAt: row?.claimedAt ?? null,
      };
    }
    const row = this.store.get().missions[id];
    return {
      id,
      value: row?.value ?? 0,
      target,
      complete: row?.complete ?? false,
      claimedAt: row?.claimedAt ?? null,
    };
  }

  /** True when every `requires` entry is complete. */
  isLocked(def: MissionDef): boolean {
    const req = def.requires;
    if (req === undefined || req.length === 0) return false;
    for (let i = 0; i < req.length; i++) {
      if (!this.progressOf(req[i]).complete) return true;
    }
    return false;
  }

  /** The objective ids drawn for the current match, in display order. */
  activeObjectiveIds(): readonly string[] {
    return this.match?.objectives ?? EMPTY_IDS;
  }

  isUnlocked(unlockId: string): boolean {
    return this.store.get().unlocked.includes(unlockId);
  }

  /** Rewards earned since the last call. Stamps `claimedAt` as it drains. */
  drainPending(): readonly Reward[] {
    if (this.pending.length === 0) return EMPTY_REWARDS;
    const out = this.pending.slice();
    this.pending.length = 0;
    const stamp = this.now();

    let touchedProfile = false;
    this.store.mutate((p) => {
      for (const def of this.defs) {
        if (def.scope !== 'profile') continue;
        const row = p.missions[def.id];
        if (row === undefined || !row.complete || row.claimedAt !== null) continue;
        row.claimedAt = stamp;
        touchedProfile = true;
      }
      return touchedProfile;
    }, true);

    for (const row of this.matchRows.values()) {
      if (row.complete && row.claimedAt === null) row.claimedAt = stamp;
    }
    this.touch(true);
    return out;
  }

  /* -- notification ------------------------------------------------------- */

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /**
   * Mark something changed.
   *
   * `immediate` is for the events a player is looking at when they happen — a
   * completion, an unlock, a match starting or ending. Plain counter ticks
   * coalesce through a short timer, because a progress bar does not need to be
   * repainted once per bullet.
   */
  private touch(immediate: boolean): void {
    this.version++;
    if (immediate) {
      this.notifyDirty = false;
      if (this.notifyTimer !== null) {
        this.cancel(this.notifyTimer);
        this.notifyTimer = null;
      }
      this.emit();
      return;
    }
    this.notifyDirty = true;
    if (this.notifyTimer !== null) return;
    const handle = this.schedule(() => {
      this.notifyTimer = null;
      this.flushNotify();
    }, this.notifyDelayMs);
    this.notifyTimer = handle === 0 ? null : handle;
  }

  /** Emit any coalesced notification right now. */
  flushNotify(): void {
    if (!this.notifyDirty) return;
    this.notifyDirty = false;
    this.emit();
  }

  private emit(): void {
    for (let i = 0; i < this.listeners.length; i++) {
      try {
        this.listeners[i]();
      } catch (err) {
        console.error('[progression] mission listener threw', err);
      }
    }
  }

  /** Persist and stop every timer. */
  flush(): void {
    if (this.notifyTimer !== null) {
      this.cancel(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.flushNotify();
    this.store.flush();
  }

  dispose(): void {
    this.detach();
    this.flush();
    this.listeners.length = 0;
  }

  /* -- the advance path --------------------------------------------------- */

  private isLocal(player: number): boolean {
    return this.match !== null && this.match.localPlayer === player;
  }

  private forEachRule(kind: RuleKind, fn: (def: MissionDef, rule: MissionRule) => void): void {
    const bucket = this.byRule.get(kind);
    if (bucket === undefined) return;
    for (let i = 0; i < bucket.length; i++) {
      const def = bucket[i];
      const rule = def.rule;
      if (rule === undefined) continue;
      fn(def, rule);
    }
  }

  /**
   * Apply one observation to one mission.
   *
   * `amount` means different things per metric and that is the whole reason the
   * metric table exists: a counter ADDS it, a high-water mark takes the MAX of
   * it, a flag latches when it is positive.
   */
  private advance(def: MissionDef, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const rule = def.rule;
    if (rule === undefined) return;
    // A locked mission does not accumulate. Chains would otherwise complete the
    // moment their prerequisite did, and the player would never see them run.
    //
    // The one deliberate seam: missions are walked in table order inside a
    // single event, so the kill that COMPLETES step 1 also counts for step 2 —
    // it was unlocked by the time step 2 was reached. Dropping that one event
    // at every chain boundary would be the stranger behaviour of the two.
    if (this.isLocked(def)) return;

    const metric = metricOf(rule);
    if (def.scope === 'match') {
      if (this.match === null) return;
      const row = this.matchRows.get(def.id);
      if (row === undefined || row.complete) return;
      const next = metric === 'counter' ? row.value + amount
        : metric === 'max' ? Math.max(row.value, amount)
          : 1;
      if (next === row.value) return;
      row.value = next;
      if (next >= def.target) {
        row.complete = true;
        this.award(def);
        this.touch(true);
      } else {
        this.touch(false);
      }
      return;
    }

    let completed = false;
    // Batched by default. A high-water mark climbs as fast as a counter does
    // (`bank` moves on every credits event), so nothing here writes through on
    // the strength of its metric — only on the strength of a COMPLETION, below.
    const changed = this.store.mutate((p) => {
      const row = missionRow(p, def.id);
      if (row.complete) return false;
      const next = metric === 'counter' ? row.value + amount
        : metric === 'max' ? Math.max(row.value, amount)
          : 1;
      if (next === row.value) return false;
      row.value = next;
      if (next >= def.target) {
        row.complete = true;
        completed = true;
        applyUnlocks(p, def.reward);
      }
      return true;
    }, false);

    if (!changed) return;
    if (completed) {
      this.pushRewards(def);
      // Unlocks and completions write through: a tab closed one second after a
      // superweapon unlocks must not eat the superweapon.
      this.store.flush();
      this.touch(true);
    } else {
      this.touch(false);
    }
  }

  /** Match-scope completion: rewards are queued, unlocks still land on the profile. */
  private award(def: MissionDef): void {
    let granted = false;
    this.store.mutate((p) => {
      granted = applyUnlocks(p, def.reward);
      return granted;
    }, true);
    this.pushRewards(def);
  }

  private pushRewards(def: MissionDef): void {
    for (let i = 0; i < def.reward.length; i++) this.pending.push(def.reward[i]);
  }

  /* -- objective draw ------------------------------------------------------ */

  /**
   * Draw the objective board.
   *
   * Deterministic in the sim seed, so two players watching the same replay see
   * the same board, and a bug report that says "seed 0x51c0de" is reproducible.
   * This is NOT `s.rng`: it must not consume from the sim stream, because doing
   * so would make the simulation depend on the player's profile — exactly the
   * coupling this whole module is built to avoid.
   */
  private drawObjectives(seed: number): string[] {
    const pool: MissionDef[] = [];
    for (const def of this.defs) {
      if (def.scope !== 'match') continue;
      if (this.isLocked(def)) continue;
      pool.push(def);
    }
    if (pool.length <= this.objectiveLimit) return pool.map((d) => d.id);

    // Fisher-Yates over a copy, driven by a 32-bit xorshift seeded from the
    // match seed. Same seed, same board, no allocation beyond the copy.
    let s = (seed ^ 0x9e3779b9) >>> 0;
    if (s === 0) s = 0x6d2b79f5;
    const next = (): number => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s;
    };
    for (let i = pool.length - 1; i > 0; i--) {
      const j = next() % (i + 1);
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const picked = pool.slice(0, this.objectiveLimit);
    // Display order follows the authored table, not the shuffle, so the panel
    // does not reorder itself between two matches that drew the same set.
    const order = new Map<string, number>();
    for (let i = 0; i < this.defs.length; i++) order.set(this.defs[i].id, i);
    picked.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return picked.map((d) => d.id);
  }
}

/* ==========================================================================
 * 4. FREE FUNCTIONS
 * ========================================================================== */

const EMPTY_IDS: readonly string[] = [];
const EMPTY_REWARDS: readonly Reward[] = [];

function kindMatches(kinds: readonly EntityKind[] | undefined, kind: EntityKind): boolean {
  if (kinds === undefined) return true;
  for (let i = 0; i < kinds.length; i++) if (kinds[i] === kind) return true;
  return false;
}

/** Write every `unlock` reward onto the profile. True when anything was new. */
function applyUnlocks(profile: Profile, rewards: readonly Reward[]): boolean {
  let granted = false;
  for (let i = 0; i < rewards.length; i++) {
    const r = rewards[i];
    if (r.kind === 'unlock' && grantUnlock(profile, r.unlockId)) granted = true;
  }
  return granted;
}

/** Re-exported so a consumer does not have to reach into the store module. */
export type { Profile, ProfileMission };

/**
 * ============================================================================
 * VOLTMARCH — src/progression/types.ts
 * ============================================================================
 * THE PROGRESSION CONTRACT. Frozen: the missions UI, the end screen and the
 * production catalogue all code against the shapes in this file, and they are
 * built by different agents in parallel.
 *
 * Nothing here imports the engine's mutable state. It imports three const enums
 * from `core/types` (EntityKind, BuildTab, Faction) purely so the mission table
 * can say "vehicles" instead of "3", and those compile to integers at the use
 * site. That keeps this module loadable under `environment: 'node'`, which is
 * what makes the whole progression layer unit-testable.
 *
 * THREE THINGS TO KNOW BEFORE EDITING
 * -----------------------------------
 * 1. `MissionDef` is authored data, never code. A mission is a row; a row is
 *    validated at module load (see `src/data/Missions.ts`). There are no
 *    callbacks in the table, which is why a corrupt/renamed mission is a load
 *    error rather than a silent no-op three hours into a save.
 *
 * 2. `MissionRule` is the declarative predicate over the EVENT STREAM. Every
 *    rule maps onto an event `src/core/events.ts` actually emits. If you want a
 *    mission for something that is not an event, the answer is a sampler on the
 *    presentation side, not a hook inside `simTick`.
 *
 * 3. `ProgressionView` is the ONLY surface the UI is allowed to touch. It is
 *    published on `globalThis.__vmProgression` at boot, exactly like
 *    `__vmSettings`. Everything it returns is to be treated as immutable.
 * ============================================================================
 */

import type { BuildTab, EntityKind } from '../core/types';

/* ==========================================================================
 * 1. THE FROZEN CONTRACT
 * ========================================================================== */

/**
 * `profile` missions persist across every match and drive unlocks.
 * `match` missions are the per-match objective board; they reset at match start
 * and are never written to the save.
 */
export type MissionScope = 'profile' | 'match';

export type MissionCategory = 'combat' | 'economy' | 'construction' | 'tactics' | 'mastery';

/**
 * What completing a mission pays out.
 *
 * `unlock` is the only kind the engine currently consumes: `unlockId` matches
 * the `unlockedBy?: string` field on a production def, and `UnlockGate` is what
 * turns the two into a buildable/not-buildable answer. The other four are
 * authored ahead of the systems that will honour them — a reward the player can
 * see in the missions screen and cannot yet use is a content gap; a reward the
 * table cannot express is a schema migration.
 */
export type Reward =
  | { kind: 'unlock'; unlockId: string }
  | { kind: 'credits'; amount: number }
  | { kind: 'map'; mapId: string }
  | { kind: 'power'; powerId: string }
  | { kind: 'cosmetic'; cosmeticId: string };

export interface MissionDef {
  id: string;
  scope: MissionScope;
  title: string;
  description: string;
  category: MissionCategory;
  target: number;
  reward: Reward[];
  /** Mission ids that must be complete first. This is how chains form. */
  requires?: string[];
  /** `Faction` enum value, for faction-specific chains. */
  faction?: number;
  difficulty?: 1 | 2 | 3;

  /* -- authoring extensions ------------------------------------------------
   * Deliberately OPTIONAL so that a module holding a `MissionDef` built before
   * these existed still type-checks. `validateMissions` requires a rule on
   * every row in the shipped table, so "optional" is a compile-time
   * accommodation and not a runtime one. */

  /** The declarative predicate. A mission with no rule never advances. */
  rule?: MissionRule;
  /**
   * Ordering hint for `catalogue()`. Omitted rows fall back to table order,
   * which is why `src/data/Missions.ts` is authored grouped by chain.
   */
  sortOrder?: number;
}

export interface MissionProgress {
  id: string;
  value: number;
  target: number;
  complete: boolean;
  claimedAt: number | null;
}

/** A mission row with its live progress merged in — what the missions screen renders. */
export type MissionEntry = MissionDef & { progress: MissionProgress; locked: boolean };

/** A match objective with its live progress merged in — what the HUD panel renders. */
export type ObjectiveEntry = MissionDef & { progress: MissionProgress };

/** The persisted half, as the UI sees it. Never mutate what this returns. */
export interface ProfileView {
  version: number;
  unlocked: readonly string[];
  missions: readonly MissionProgress[];
}

/** What the UI reads. Never mutate what this returns. */
export interface ProgressionView {
  profile(): ProfileView;
  /** Every mission, with live progress merged in. Ordered for display. */
  catalogue(): readonly MissionEntry[];
  /** Objectives active in the CURRENT match. Empty outside a match. */
  activeObjectives(): readonly ObjectiveEntry[];
  /** Rewards earned since the last call — the end screen drains this. */
  drainPending(): readonly Reward[];
  isUnlocked(unlockId: string): boolean;
  /**
   * The mission that pays an unlock id, so a locked build slot can NAME it.
   *
   * `{ missionId, title, objective }`, or null when nothing grants that id —
   * which is itself worth surfacing, since an id no mission pays is a content
   * defect this project has shipped more than once.
   *
   * The mirror of this on `src/ui/Objectives.ts#ProgressionView` is OPTIONAL,
   * deliberately: the HUD must keep working against a handle that predates this
   * member, and under `?shot=` there is no handle at all.
   */
  unlockSource(unlockId: string): { missionId: string; title: string; objective: string } | null;
  subscribe(fn: () => void): () => void;
  resetProfile(): void;
  exportProfile(): string;
  importProfile(json: string): boolean;
}

/** The property name the view is published under. Mirrors `__vmSettings`. */
export const PROGRESSION_GLOBAL_KEY = '__vmProgression';

/* ==========================================================================
 * 2. THE RULE LANGUAGE
 *
 * Every variant below is answerable from a payload in `GameEvents`. The
 * discriminant is `on`; the tracker buckets missions by it once at construction
 * so a kill event only ever walks the kill missions.
 *
 * DEFS ARE NOT ADDRESSABLE HERE, ON PURPOSE. `EvEntityKilled.defId` is whatever
 * the spawner wrote into `store.defId` — the real def index for some paths and
 * `BuildEntry.publicId` for others — so a rule keyed on a def id would be right
 * for units and wrong for structures with no way to tell. `EntityKind` is
 * unambiguous everywhere and covers every mission worth authoring.
 * ========================================================================== */

/** How a rule's counter behaves. Derived from the rule; never authored. */
export type MissionMetric =
  /** Accumulates forever (profile) or across one match (match scope). */
  | 'counter'
  /** High-water mark: `value = max(value, observed)`. */
  | 'max'
  /** Latches 0 -> 1 when the condition holds. Evaluated at match end. */
  | 'flag';

/** Destroy entities belonging to somebody who is not you. */
export interface KillRule {
  on: 'kill';
  /** Restrict to these entity kinds. Omitted means "anything that dies". */
  kinds?: readonly EntityKind[];
  /** `count` adds 1 per kill; `value` adds `EvEntityKilled.value` in credits. */
  metric?: 'count' | 'value';
}

/** Your own entities being destroyed. Feeds "lose nothing" objectives. */
export interface LoseRule {
  on: 'lose';
  kinds?: readonly EntityKind[];
}

/** `building:completed` for your player. */
export interface BuildRule {
  on: 'build';
}

/** `production:ready` for your player, optionally restricted to one tab. */
export interface ProduceRule {
  on: 'produce';
  tab?: BuildTab;
}

/** `building:captured` where you are the new owner. */
export interface CaptureRule {
  on: 'capture';
}

/**
 * Sum of positive `economy:credits` deltas.
 * `reasons` are `CreditReason` values; the default is `[Harvest]`, because
 * "earn 70,000 credits" means mined, not refunded.
 *
 * A rule that asks for `Harvest` is counted from `EvCredits.mined` — the ore
 * that came OUT OF THE GROUND — and not from the banked delta. Those are
 * different numbers whenever a load lands in a full silo, and reading the delta
 * meant an ore mission stalled for exactly the player who saves up. See the
 * handler in `MissionTracker.attach`.
 */
export interface EarnRule {
  on: 'earn';
  reasons?: readonly number[];
}

/** High-water mark of `EvCredits.credits` — "hold N credits at once". */
export interface BankRule {
  on: 'bank';
}

/** High-water mark of `produced - consumed` from `economy:power`. */
export interface PowerRule {
  on: 'power';
}

/** `entity:veterancy` for your player at or above `rank` (default 1). */
export interface VeterancyRule {
  on: 'veterancy';
  rank?: number;
}

/** A won match. Optionally restricted by faction played or wall duration. */
export interface WinRule {
  on: 'win';
  /** `Faction` enum value the player must have been playing. */
  faction?: number;
  /** Only counts when the match finished inside this many seconds. */
  withinSec?: number;
}

/** Any finished match, won or lost. */
export interface PlayRule {
  on: 'play';
}

/**
 * A flag evaluated once, at match end: true when the player lost ZERO entities
 * of `kinds` during the match.
 */
export interface NoLossRule {
  on: 'noLoss';
  kinds?: readonly EntityKind[];
  /** When true the match must also have been won. */
  requireWin?: boolean;
}

/** High-water mark of the consecutive-win streak. Profile scope only. */
export interface WinStreakRule {
  on: 'winStreak';
}

export type MissionRule =
  | KillRule | LoseRule | BuildRule | ProduceRule | CaptureRule
  | EarnRule | BankRule | PowerRule | VeterancyRule
  | WinRule | PlayRule | NoLossRule | WinStreakRule;

/** Every legal `MissionRule.on`, for the table validator. */
export const RULE_KINDS = [
  'kill', 'lose', 'build', 'produce', 'capture', 'earn', 'bank', 'power',
  'veterancy', 'win', 'play', 'noLoss', 'winStreak',
] as const;

export type RuleKind = (typeof RULE_KINDS)[number];

/** How each rule's counter behaves. One table, so the tracker cannot disagree. */
export const RULE_METRIC: Readonly<Record<RuleKind, MissionMetric>> = {
  kill: 'counter',
  lose: 'counter',
  build: 'counter',
  produce: 'counter',
  capture: 'counter',
  earn: 'counter',
  bank: 'max',
  power: 'max',
  veterancy: 'counter',
  win: 'counter',
  play: 'counter',
  noLoss: 'flag',
  winStreak: 'max',
};

export function metricOf(rule: MissionRule): MissionMetric {
  return RULE_METRIC[rule.on];
}

/* ==========================================================================
 * 3. MATCH LIFECYCLE
 *
 * `match:started` / `match:ended` are emitted by `src/game/outcome.system.ts`,
 * the one module that owns the match lifecycle on the bus. The shell ALSO
 * drives this interface directly — `Shell.startMatch` and `Shell.endMatch` call
 * it with the difficulty and the resolved faction, neither of which the events
 * carry. So the tracker accepts the lifecycle from either direction and is
 * idempotent about it: whichever of the two describes the match first wins, and
 * the second is ignored.
 * ========================================================================== */

export interface MatchStartInfo {
  /** Sim seed. Drives which objectives are drawn, so a replay draws the same set. */
  seed: number;
  /** The player whose missions advance. Everyone else's events are ignored. */
  localPlayer: number;
  /** `Faction` enum value the local player is fielding. */
  faction: number;
  /** Index into `DIFFICULTIES`. Advisory; recorded on the profile stats. */
  difficulty?: number;
}

export interface MatchEndInfo {
  won: boolean;
  durationSec: number;
}

/** The lifecycle half of the handle. The shell and a victory module both use it. */
export interface ProgressionControl {
  beginMatch(info: MatchStartInfo): void;
  endMatch(info: MatchEndInfo): void;
  /**
   * Quit-to-menu with no result. Match objectives are dropped, the profile
   * progress earned along the way is kept, and nothing counts as played.
   */
  abandonMatch(): void;
  /** True between `beginMatch` and `endMatch`. */
  inMatch(): boolean;
  /** Force a persist. Called before the page can go away. */
  flush(): void;
}

/** The full handle published on `globalThis.__vmProgression`. */
export type ProgressionHandle = ProgressionView & ProgressionControl;

/* ==========================================================================
 * 4. UNLOCKS
 * ========================================================================== */

/**
 * The shape `UnlockGate` filters on. `src/data/Defs.ts` gains this one optional
 * field; every def without it is available from the first match, which is the
 * design's central rule — see `docs/MISSIONS_DESIGN.md`.
 */
export interface Gateable {
  readonly key?: string;
  readonly unlockedBy?: string;
}

/** How a player resolves against the gate. See `UnlockGate.allowsFor`. */
export interface GatePlayer {
  readonly isHuman: boolean;
}

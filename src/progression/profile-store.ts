/**
 * ============================================================================
 * VOLTMARCH — src/progression/profile-store.ts
 * ============================================================================
 * THE PLAYER PROFILE: what has been unlocked, how far every mission has got,
 * and the lifetime record. Follows `src/shell/settings-store.ts` exactly — one
 * platform-storage key, one versioned JSON blob, injected storage, and a
 * normalisation function that is TOTAL: it returns a complete, in-range profile
 * for any input including `null`, a string, an array, or a blob written by a
 * build that does not exist yet.
 *
 * WHY VERSIONING AND EXPORT SHIP ON DAY ONE
 * -----------------------------------------
 * The first format a save system ships is permanent. Changing it later without
 * a migration silently destroys progress, and a player who has spent forty
 * matches earning a superweapon does not get it back. So the ladder exists from
 * the first commit, with a real step in it, and `tests/progression.spec.ts`
 * walks a v1 blob through it. Export/import exists for the same reason from the
 * other side: a cleared browser store must not be a wiped account.
 *
 * THE MIGRATION LADDER
 * --------------------
 *   v1 — the dev format. Counters only:
 *          { version: 1, unlocked: string[], missions: { [id]: number },
 *            completed: string[], matches: number, wins: number }
 *        It cannot express "complete but unclaimed", which is the one state the
 *        end-screen reveal is built on, and it has no per-faction record.
 *   v2 — shipped. `missions` becomes full records with `claimedAt`, and the
 *        lifetime counters move into a `stats` object with a streak and a
 *        per-faction win tally.
 *   v3 — shipped. `campaign` arrives: operation id -> the BEST medal ever
 *        earned on it. Nothing is derived from v2, because nothing in v2 knows
 *        what an operation is — the campaign did not exist. See
 *        `PROFILE_VERSION` for why a purely additive field still bumped the
 *        stamp, which this file's own rule would otherwise have refused.
 *   v4 — shipped. `tipsSeen` arrives: situational tip keys the player has
 *        already been shown once. Additive, empty, and stamped for exactly the
 *        reason v3 was — see `PROFILE_VERSION`.
 *
 * `migrateProfile` walks the ladder step by step, so v1 -> v5 is three
 * functions today and four tomorrow, never one function that knows about five
 * formats.
 *
 * FAIL SOFT, ALWAYS
 * -----------------
 * Corrupt JSON, a truncated blob, a hostile blob, a quota-exceeded write: every
 * one of them degrades to a fresh profile or a dropped write. Nothing in this
 * file may throw on the boot path. A crash on the title screen is the worst
 * crash in a game, and "your save is broken" is the worst version of it.
 *
 * BATCHED WRITES
 * --------------
 * `mutate()` marks dirty and schedules; `mutateNow()` writes through. A match
 * with 400 kills in it must not produce 400 `JSON.stringify` calls against
 * localStorage, but a mission COMPLETING must survive the player closing the
 * tab one second later — so completions and unlocks write through and counters
 * do not.
 * ============================================================================
 */

import { persistentStorage } from '../platform/storage';

/* ==========================================================================
 * 1. SHAPES
 * ========================================================================== */

/** One mission's persisted state. Only `scope: 'profile'` missions are stored. */
export interface ProfileMission {
  id: string;
  value: number;
  complete: boolean;
  /** Epoch ms the reward was handed to the end screen, or null while pending. */
  claimedAt: number | null;
}

export interface ProfileStats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  /** Consecutive wins right now. Reset to 0 by any loss. */
  currentStreak: number;
  bestStreak: number;
  /** `Faction` enum value (as a decimal string key) -> wins with it. */
  winsByFaction: Record<string, number>;
}

export interface Profile {
  version: number;
  /** Epoch ms. Purely informational; shown on the missions screen. */
  createdAt: number;
  updatedAt: number;
  /** Unlock ids the player owns. Order is stable-sorted; duplicates impossible. */
  unlocked: string[];
  missions: Record<string, ProfileMission>;
  stats: ProfileStats;
  /**
   * Campaign operation id -> the BEST medal ever earned on it, 1..3.
   *
   * **A ROW EXISTS IF AND ONLY IF THE OPERATION HAS BEEN WON.** Medal 0 means
   * "not won", which is the same state as "no row", and storing both spellings
   * would give `operationComplete` two answers to reconcile. `normalizeCampaign`
   * enforces it by dropping any row that normalises to 0.
   *
   * TYPED `number`, NOT `Medal`, AND THAT IS DELIBERATE. `Medal` lives in
   * `src/campaign/types.ts` and progression is the lower layer — the campaign
   * imports the profile, never the reverse. `src/campaign/campaign-store.ts` is
   * where the narrowing happens, in one function, so an out-of-range value from
   * a hand-edited blob cannot reach a `switch` on medal.
   */
  campaign: Record<string, number>;
  /**
   * Situational tip keys (`TipRow.key`) the player has already been shown.
   *
   * **A ROW EXISTS IF AND ONLY IF THAT TIP HAS BEEN ON SCREEN ONCE.** The mute
   * is automatic on first SHOWING and there is no "seen but not muted" state,
   * because there is nowhere to express one: `.vm-toasts` is
   * `pointer-events: none`, so a chip cannot be clicked and "dismiss" is not an
   * act the player can perform. A mute that waited for an act would never fire.
   * `src/sim/tips.system.ts` marks it inside `postTip`, after the chip is
   * raised, so a tip refused by any gate has not been spent.
   *
   * TYPED `string[]`, NOT A TIP KEY UNION, for the same layering reason
   * `campaign` is typed `number` rather than `Medal`: the simulation imports
   * the profile through a duck-typed handle and never the reverse, and a union
   * here would make deleting a row from the corpus a compile error in a save
   * file. `isSaneId` is the only shape rule.
   *
   * THE ONLY ROUTE BACK IS `reset()`. A per-row "show me tips again" control
   * would need a screen listing rows the player has seen — real UI for a
   * feature whose whole surface is one chip — and it is the wider-chip /
   * dismiss-affordance conversation, not this one.
   */
  tipsSeen: string[];
}

/**
 * Bumped when a migration cannot be expressed as "fill in the default" — OR
 * when a new field will one day need migrating and nothing else could ever
 * tell its generations apart.
 *
 * **v3 IS THE SECOND KIND, AND BY THE FIRST RULE ALONE IT WOULD NOT HAVE BEEN
 * BUMPED**: `campaign` arrives empty and `normalizeProfile` would have
 * defaulted it. It is stamped anyway because `missions` went from
 * `id -> number` to `id -> record` in v1 -> v2, and the ONLY thing that made
 * that step writable was the version saying which spelling was on disk. A
 * field added without a stamp can never be migrated later, only sniffed — and
 * a sniff is a guess that gets one blob wrong and loses that player's progress.
 *
 * **v4 IS THE SECOND KIND AGAIN, AND FOLLOWS v3's REASONING RATHER THAN
 * RE-ARGUING IT.** `tipsSeen` arrives empty and would have defaulted. It is
 * stamped because the day this list needs to become `id -> { shownAt }` — the
 * obvious next thing a mute list wants — the ONLY thing that will make that
 * step writable is the version saying which spelling is on disk.
 */
export const PROFILE_VERSION = 4;

/**
 * The storage key never carries the schema version — the `version` FIELD does.
 * A key that moves with the schema orphans the old blob instead of migrating
 * it, which is the failure mode this whole file exists to avoid. `.v1` here is
 * the key's own generation and is expected to stay `.v1` forever.
 */
export const PROFILE_STORAGE_KEY = 'voltmarch.profile.v1';

/** Envelope written by `exportJson`, so an imported file can be identified. */
export const PROFILE_EXPORT_KIND = 'voltmarch.profile';

export interface ProfileExport {
  app: 'voltmarch';
  kind: typeof PROFILE_EXPORT_KIND;
  exportedAt: number;
  profile: Profile;
}

/* ==========================================================================
 * 2. STORAGE ADAPTER
 *
 * Re-declared rather than imported from `shell/settings-store.ts`: this module
 * must stay importable with no shell dependency at all, so the progression
 * layer works in a headless test and in the `?shot=` harness.
 * ========================================================================== */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Used when the platform has no storage, or forbids it. */
export function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

/**
 * Native userData storage in Electron, browser storage on the web, memory as a
 * final fallback. Kept under the historical name for callers outside this file.
 */
export function browserStorage(): StorageLike {
  try {
    return persistentStorage();
  } catch {
    return memoryStorage();
  }
}

/* ==========================================================================
 * 3. DEFAULTS AND NORMALISATION
 * ========================================================================== */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Ids are content keys: printable, bounded, and never absurd.
 *
 * EXPORTED SO THERE IS ONE DEFINITION. `campaign-store.ts` guards the id it is
 * about to write with the same predicate the normaliser will judge it by on the
 * next load — otherwise a write that looks like it worked disappears at boot,
 * which is the quiet divergence `docs/SPEC_DRIFT_AUDIT.md` catalogues.
 */
export function isSaneId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 96;
}

/** Upper bound on anything counted, so a hand-edited blob cannot poison maths. */
const MAX_COUNTER = 1e12;
/** Upper bound on stored rows, so an import cannot be used as a memory bomb. */
const MAX_UNLOCKS = 512;
const MAX_MISSION_ROWS = 2048;
/**
 * Same job for campaign rows. 37 operations ship; this bound is about a hostile
 * blob rather than about the content, and it is exported because
 * `campaign-store.ts` must refuse the row the normaliser would drop.
 */
export const MAX_CAMPAIGN_ROWS = 512;
/**
 * Same job for tip mutes. `TIP_ROWS` is seven and
 * `tests/tips-corpus-weight.spec.ts` caps the corpus at about fifteen; this
 * bound is about a hostile blob rather than about the content, and it is well
 * clear of any corpus that rule would ever permit.
 */
export const MAX_TIP_MUTES = 128;
/**
 * Gold. Kept here rather than imported from `campaign/types.ts` for the same
 * layering reason `Profile.campaign` is typed `number`.
 *
 * A STORED MEDAL ABOVE THIS CLAMPS DOWN; IT IS NOT DROPPED. A future build that
 * adds a fourth tier writes a 4, and a player who rolls back should keep the
 * completion at gold rather than lose the operation entirely — "downgrading is
 * lossy; wiping is worse", which is the rule `migrateProfile` already states for
 * the whole blob.
 */
const MAX_MEDAL = 3;

export function defaultStats(): ProfileStats {
  return {
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    currentStreak: 0,
    bestStreak: 0,
    winsByFaction: {},
  };
}

export function defaultProfile(now = Date.now()): Profile {
  return {
    version: PROFILE_VERSION,
    createdAt: now,
    updatedAt: now,
    unlocked: [],
    missions: {},
    stats: defaultStats(),
    campaign: {},
    tipsSeen: [],
  };
}

function normalizeStats(raw: unknown): ProfileStats {
  const d = defaultStats();
  if (!isRecord(raw)) return d;
  const wbf: Record<string, number> = {};
  if (isRecord(raw.winsByFaction)) {
    for (const k of Object.keys(raw.winsByFaction)) {
      if (!/^-?\d{1,3}$/.test(k)) continue;
      const n = Math.floor(num(raw.winsByFaction[k], 0, MAX_COUNTER, 0));
      if (n > 0) wbf[k] = n;
    }
  }
  const best = Math.floor(num(raw.bestStreak, 0, MAX_COUNTER, d.bestStreak));
  const current = Math.floor(num(raw.currentStreak, 0, MAX_COUNTER, d.currentStreak));
  return {
    matchesPlayed: Math.floor(num(raw.matchesPlayed, 0, MAX_COUNTER, d.matchesPlayed)),
    wins: Math.floor(num(raw.wins, 0, MAX_COUNTER, d.wins)),
    losses: Math.floor(num(raw.losses, 0, MAX_COUNTER, d.losses)),
    currentStreak: current,
    // A stored best below the current streak is impossible; repair rather than
    // trust it, or "best streak" reads lower than "current streak" on screen.
    bestStreak: Math.max(best, current),
    winsByFaction: wbf,
  };
}

function normalizeMission(id: string, raw: unknown): ProfileMission {
  if (!isRecord(raw)) {
    // A bare number is the v1 spelling and also what a hand-written blob tends
    // to contain. Accepting it costs one branch and saves a support thread.
    const n = Math.max(0, num(raw, 0, MAX_COUNTER, 0));
    return { id, value: n, complete: false, claimedAt: null };
  }
  const claimed = raw.claimedAt;
  return {
    id,
    value: Math.max(0, num(raw.value, 0, MAX_COUNTER, 0)),
    complete: bool(raw.complete, false),
    claimedAt: typeof claimed === 'number' && Number.isFinite(claimed) ? claimed : null,
  };
}

/**
 * Campaign rows, bounded and clamped.
 *
 * THE DROP AT 0 IS THE INVARIANT, NOT A TIDY-UP. `Profile.campaign` promises a
 * row exists if and only if the operation was won, and `operationComplete` is
 * `medal > 0` on the strength of it. A stored 0 — from a hand edit, from a
 * negative that clamped, from a `null` — would be a row that claims completion
 * to `Object.keys` and denies it to `medalOf`.
 */
function normalizeCampaign(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(raw)) return out;
  let n = 0;
  for (const id of Object.keys(raw)) {
    if (!isSaneId(id)) continue;
    const medal = Math.floor(num(raw[id], 0, MAX_MEDAL, 0));
    if (medal <= 0) continue;
    out[id] = medal;
    if (++n >= MAX_CAMPAIGN_ROWS) break;
  }
  return out;
}

/**
 * Tip mutes: sane ids, unique, sorted, bounded.
 *
 * SORTED AND DEDUPED FOR `unlocked`'s REASON — a stored blob whose byte content
 * depends on the order the player happened to see things is a blob two builds
 * can disagree about while meaning the same thing. Nothing compares profiles
 * today; `exportJson` puts one in front of a human, which is enough.
 */
function normalizeTipsSeen(raw: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(raw)) return out;
  const seen = new Set<string>();
  for (const id of raw) {
    if (!isSaneId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_TIP_MUTES) break;
  }
  out.sort();
  return out;
}

/**
 * Total, defensive, order-independent. Returns a complete `Profile` for ANY
 * input. Never throws. Never returns a shared object.
 */
export function normalizeProfile(raw: unknown, now = Date.now()): Profile {
  const d = defaultProfile(now);
  if (!isRecord(raw)) return d;

  const unlocked: string[] = [];
  const seen = new Set<string>();
  const rawUnlocked = Array.isArray(raw.unlocked) ? raw.unlocked : [];
  for (const u of rawUnlocked) {
    if (!isSaneId(u) || seen.has(u)) continue;
    seen.add(u);
    unlocked.push(u);
    if (unlocked.length >= MAX_UNLOCKS) break;
  }
  unlocked.sort();

  const missions: Record<string, ProfileMission> = {};
  if (isRecord(raw.missions)) {
    let n = 0;
    for (const id of Object.keys(raw.missions)) {
      if (!isSaneId(id)) continue;
      missions[id] = normalizeMission(id, raw.missions[id]);
      if (++n >= MAX_MISSION_ROWS) break;
    }
  }

  const created = num(raw.createdAt, 0, Number.MAX_SAFE_INTEGER, d.createdAt);
  return {
    version: PROFILE_VERSION,
    createdAt: created,
    updatedAt: num(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER, created),
    unlocked,
    missions,
    stats: normalizeStats(raw.stats),
    // REBUILT FROM THE DEFAULT LIKE EVERYTHING ELSE HERE. This function copies
    // only what it recognises, so a field without a branch evaporates on every
    // single load — silently, because nothing throws and the write still
    // succeeds against the next blob.
    campaign: normalizeCampaign(raw.campaign),
    tipsSeen: normalizeTipsSeen(raw.tipsSeen),
  };
}

/* ==========================================================================
 * 4. THE MIGRATION LADDER
 *
 * Each step takes the raw blob at version N and returns the raw blob at N+1.
 * Steps never validate — `normalizeProfile` runs afterwards and is the only
 * thing allowed to have an opinion about ranges. That split is what keeps a
 * migration to five lines instead of a second copy of the normaliser.
 * ========================================================================== */

export interface MigrationStep {
  readonly from: number;
  readonly to: number;
  readonly run: (raw: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * v1 -> v2.
 *
 * v1 stored `missions` as `id -> number` with a parallel `completed: string[]`,
 * and kept `matches` / `wins` as loose top-level counters. Two things are
 * unrecoverable from it and are seeded rather than invented: `claimedAt` (a
 * v1 completion was never revealed, so it becomes a PENDING claim and the end
 * screen shows it once — the generous reading, deliberately) and the streak
 * (nothing recorded ordering, so it starts at 0).
 */
function migrateV1toV2(raw: Record<string, unknown>): Record<string, unknown> {
  const completed = new Set<string>(
    Array.isArray(raw.completed) ? raw.completed.filter((v): v is string => typeof v === 'string') : [],
  );
  const oldMissions = isRecord(raw.missions) ? raw.missions : {};
  const missions: Record<string, unknown> = {};
  for (const id of Object.keys(oldMissions)) {
    const v = oldMissions[id];
    missions[id] = {
      value: typeof v === 'number' ? v : 0,
      complete: completed.has(id),
      claimedAt: null,
    };
  }
  // A v1 id that only ever appeared in `completed` still has to survive.
  for (const id of completed) {
    if (missions[id] === undefined) missions[id] = { value: 0, complete: true, claimedAt: null };
  }

  const wins = typeof raw.wins === 'number' ? raw.wins : 0;
  const played = typeof raw.matches === 'number' ? raw.matches : wins;
  return {
    ...raw,
    version: 2,
    missions,
    completed: undefined,
    matches: undefined,
    stats: {
      matchesPlayed: played,
      wins,
      losses: Math.max(0, played - wins),
      currentStreak: 0,
      bestStreak: 0,
      winsByFaction: {},
    },
  };
}

/**
 * v2 -> v3.
 *
 * NOTHING IS DERIVED, BECAUSE THERE IS NOTHING TO DERIVE FROM. A v2 profile
 * predates the campaign entirely; no counter, no unlock and no mission row
 * carries any information about an operation, so seeding anything but an empty
 * map would be inventing progress the player did not earn.
 *
 * `raw.campaign ?? {}` rather than a shape test, because STEPS NEVER VALIDATE —
 * `normalizeProfile` runs afterwards and is the only thing allowed to have an
 * opinion about what is in there. The `??` exists solely so a hand-pasted blob
 * stamped `version: 2` that already carries campaign rows keeps them.
 */
function migrateV2toV3(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, version: 3, campaign: raw.campaign ?? {} };
}

/**
 * v3 -> v4.
 *
 * NOTHING TO DERIVE, AGAIN, AND FOR A STRONGER REASON THAN v3's. A v3 profile
 * predates situational tips entirely, so it cannot record which of them a
 * player has seen — and the generous reading is the right one here in the
 * opposite direction from v1's pending claims: an empty list means every tip is
 * still available to a returning player, which costs them one chip each and
 * never withholds something they never saw.
 *
 * `raw.tipsSeen ?? []` rather than a shape test, because STEPS NEVER VALIDATE.
 */
function migrateV3toV4(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, version: 4, tipsSeen: raw.tipsSeen ?? [] };
}

export const MIGRATIONS: readonly MigrationStep[] = [
  { from: 1, to: 2, run: migrateV1toV2 },
  { from: 2, to: 3, run: migrateV2toV3 },
  { from: 3, to: 4, run: migrateV3toV4 },
];

/**
 * Walk a raw blob up to `PROFILE_VERSION`.
 *
 * A blob from a NEWER build is passed through untouched and then normalised,
 * which drops the fields this build does not understand but keeps every one it
 * does. Downgrading is lossy; wiping is worse.
 */
export function migrateProfile(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  let cur: Record<string, unknown> = raw;
  let version = typeof cur.version === 'number' && Number.isFinite(cur.version)
    ? Math.floor(cur.version)
    : 0;
  // An unversioned blob is treated as v1: that is the only format that ever
  // existed without a version stamp.
  if (version <= 0) version = 1;

  // Bounded: the ladder is short and every step must strictly advance, so a
  // malformed table can never spin here.
  for (let guard = 0; guard < 32 && version < PROFILE_VERSION; guard++) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (step === undefined) break;
    try {
      cur = step.run(cur);
    } catch {
      // A migration that throws is a bug, but not one worth costing the player
      // their boot. Everything reachable is still normalised below.
      break;
    }
    if (step.to <= version) break;
    version = step.to;
  }
  return cur;
}

/* ==========================================================================
 * 5. EXPORT / IMPORT
 * ========================================================================== */

/** A pretty-printed, self-identifying save file. */
export function serializeProfile(profile: Profile, now = Date.now()): string {
  const env: ProfileExport = {
    app: 'voltmarch',
    kind: PROFILE_EXPORT_KIND,
    exportedAt: now,
    profile,
  };
  return JSON.stringify(env, null, 2);
}

/**
 * Parse an exported save. Accepts the envelope AND a bare profile blob, because
 * the second is what a player who opened localStorage in devtools will paste.
 * Returns null when the text is not JSON or contains nothing recognisable.
 */
export function parseProfileExport(json: string, now = Date.now()): Profile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const body = isRecord(parsed.profile) ? parsed.profile : parsed;
  // The one thing we insist on: it must look like a profile at all. Importing
  // an arbitrary JSON file would otherwise silently reset the player.
  const looksLikeProfile =
    Array.isArray(body.unlocked) || isRecord(body.missions) || isRecord(body.stats)
    || isRecord(body.campaign) || typeof body.version === 'number';
  if (!looksLikeProfile) return null;

  return normalizeProfile(migrateProfile(body), now);
}

/* ==========================================================================
 * 6. THE STORE
 * ========================================================================== */

export type ProfileListener = (profile: Readonly<Profile>) => void;

export interface ProfileStoreOptions {
  /** Injected clock. Tests pass a counter; the game uses `Date.now`. */
  now?: () => number;
  /** Debounce for batched writes, in ms. */
  flushDelayMs?: number;
  /** Injected timer, so a headless test never leaves a handle behind. */
  schedule?: (fn: () => void, ms: number) => number;
  cancel?: (handle: number) => void;
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

/**
 * Live profile plus persistence plus change notification.
 *
 * The profile object handed out by `get()` is the LIVE one. That is deliberate
 * — a deep clone per read would allocate on every HUD frame that shows a
 * progress bar — and it is why `ProgressionView` documents its returns as
 * immutable. `mutate` is the only supported way in.
 */
export class ProfileStore {
  private state: Profile;
  private readonly listeners: ProfileListener[] = [];
  private dirty = false;
  private timer: number | null = null;
  private readonly now: () => number;
  private readonly flushDelayMs: number;
  private readonly schedule: (fn: () => void, ms: number) => number;
  private readonly cancel: (handle: number) => void;

  /** Diagnostics: how many times we actually touched storage. */
  writeCount = 0;
  /** True when the persisted blob had to be thrown away and rebuilt. */
  readonly recovered: boolean;

  constructor(
    private readonly storage: StorageLike = browserStorage(),
    options: ProfileStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.flushDelayMs = options.flushDelayMs ?? 1500;
    this.schedule = options.schedule ?? defaultSchedule;
    this.cancel = options.cancel ?? defaultCancel;

    const raw = this.read();
    this.recovered = raw.corrupt;
    this.state = normalizeProfile(migrateProfile(raw.value), this.now());
  }

  private read(): { value: unknown; corrupt: boolean } {
    let text: string | null = null;
    try {
      text = this.storage.getItem(PROFILE_STORAGE_KEY);
    } catch {
      return { value: null, corrupt: false };
    }
    if (text === null || text === '') return { value: null, corrupt: false };
    try {
      const parsed: unknown = JSON.parse(text);
      // Valid JSON that is not an object is corruption too: `"[]"`, `"7"`,
      // `"null"` all parse and none of them is a profile.
      if (!isRecord(parsed)) return { value: null, corrupt: true };
      return { value: parsed, corrupt: false };
    } catch {
      return { value: null, corrupt: true };
    }
  }

  /** The live profile. Treat as immutable — go through `mutate`. */
  get(): Readonly<Profile> {
    return this.state;
  }

  /**
   * Apply a change. `fn` mutates the profile in place and returns true when it
   * actually changed something; returning false skips both the write and the
   * notification, which is what keeps a 30 Hz "did anything happen" poll free.
   *
   * @param immediate write through instead of batching. Use for completions,
   *   unlocks and match end — anything a player would notice losing.
   */
  mutate(fn: (draft: Profile) => boolean, immediate = false): boolean {
    let changed = false;
    try {
      changed = fn(this.state);
    } catch (err) {
      console.error('[progression] profile mutation threw', err);
      return false;
    }
    if (!changed) return false;
    this.state.updatedAt = this.now();
    this.dirty = true;
    if (immediate) this.flush();
    else this.scheduleFlush();
    this.emit();
    return true;
  }

  /** Shorthand for `mutate(fn, true)`. */
  mutateNow(fn: (draft: Profile) => boolean): boolean {
    return this.mutate(fn, true);
  }

  private scheduleFlush(): void {
    if (this.timer !== null) return;
    const handle = this.schedule(() => {
      this.timer = null;
      this.flush();
    }, this.flushDelayMs);
    // A platform with no timer (node, a worker under test) returns 0 from the
    // default scheduler; leaving `timer` null there means the next mutate tries
    // again rather than latching dirty forever behind a timer that never fires.
    this.timer = handle === 0 ? null : handle;
  }

  /** Persist right now, if anything is pending. */
  flush(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.write(this.state);
  }

  private write(profile: Profile): void {
    try {
      this.storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
      this.writeCount++;
    } catch {
      /* Full disk, private mode, or a webview with storage off. Not fatal. */
    }
  }

  /** Back to a fresh profile. Writes through — this is destructive and final. */
  reset(): void {
    this.state = defaultProfile(this.now());
    this.dirty = true;
    this.flush();
    this.emit();
  }

  exportJson(): string {
    return serializeProfile(this.state, this.now());
  }

  /** Replace the profile from an exported file. False leaves it untouched. */
  importJson(json: string): boolean {
    const next = parseProfileExport(json, this.now());
    if (next === null) return false;
    // Keep the original creation stamp when the import has none worth having.
    this.state = next;
    this.state.updatedAt = this.now();
    this.dirty = true;
    this.flush();
    this.emit();
    return true;
  }

  subscribe(fn: ProfileListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(): void {
    for (let i = 0; i < this.listeners.length; i++) {
      try {
        this.listeners[i](this.state);
      } catch (err) {
        console.error('[progression] profile listener threw', err);
      }
    }
  }

  /** Flush and drop every listener. Called on teardown. */
  dispose(): void {
    this.flush();
    this.listeners.length = 0;
  }
}

/* ==========================================================================
 * 7. SMALL HELPERS THE TRACKER AND THE GATE BOTH WANT
 * ========================================================================== */

/** Insert an unlock id, keeping the array sorted and unique. True if it was new. */
export function grantUnlock(profile: Profile, unlockId: string): boolean {
  if (!isSaneId(unlockId)) return false;
  if (profile.unlocked.includes(unlockId)) return false;
  if (profile.unlocked.length >= MAX_UNLOCKS) return false;
  profile.unlocked.push(unlockId);
  profile.unlocked.sort();
  return true;
}

/** Has this situational tip already been shown to this player? */
export function hasSeenTip(profile: Profile, tipKey: string): boolean {
  return profile.tipsSeen.includes(tipKey);
}

/**
 * Record that a tip has been shown. True when the profile actually moved.
 *
 * REFUSES SILENTLY AT `MAX_TIP_MUTES` rather than evicting, because eviction
 * would make the oldest tip reappear and this list exists to stop that. A
 * corpus that reaches the bound has already failed
 * `tests/tips-corpus-weight.spec.ts` by a factor of eight.
 */
export function markTipSeen(profile: Profile, tipKey: string): boolean {
  if (!isSaneId(tipKey)) return false;
  if (profile.tipsSeen.includes(tipKey)) return false;
  if (profile.tipsSeen.length >= MAX_TIP_MUTES) return false;
  profile.tipsSeen.push(tipKey);
  profile.tipsSeen.sort();
  return true;
}

/** The stored row for a mission, created on demand. */
export function missionRow(profile: Profile, id: string): ProfileMission {
  let row = profile.missions[id];
  if (row === undefined) {
    row = { id, value: 0, complete: false, claimedAt: null };
    profile.missions[id] = row;
  }
  return row;
}

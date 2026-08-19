/**
 * ============================================================================
 * VOLTMARCH — src/campaign/session.ts
 * ============================================================================
 * THE ARMED OPERATION, AND THE ONLY THING `campaign.system.ts` KNOWS ABOUT.
 *
 * It imports nothing but types, exactly like `policy.ts` and for exactly the
 * same reason: `src/game/Systems.ts` globs `'../**\/*.system.ts'` with
 * `eager: true` FROM THE ENTRY CHUNK, so anything statically reachable from
 * `campaign.system.ts` is downloaded before first paint by every player,
 * including one who never opens the campaign and one running `?shot=`.
 *
 * So the dependency runs one way and only one way:
 *
 *     campaign.system.ts  ->  session.ts + policy.ts + types.ts     (entry)
 *     campaign-install.ts ->  session.ts + Director + runtime + index + layouts
 *                                                                  (lazy)
 *
 * `Shell.startOperation` is the single `await import('./campaign-install')`.
 * Nothing else may reach the second line, and
 * `tests/campaign-bundle-isolation.spec.ts` fails when something does.
 *
 * The two `import type` edges into `src/core/**` added for the save codec are
 * ERASED — `EntityStore` and `EntityId` are named in signatures and nowhere
 * else, so no byte of core arrives because of them, and core is in the entry
 * chunk regardless. What must never appear here is a VALUE import, and
 * `runtime.ts`'s `TagRegistry` is the one this file deliberately declares
 * structurally rather than importing.
 *
 * ============================================================================
 * A MODULE-LEVEL SLOT, NOT A GLOBAL
 * ============================================================================
 * `__vmTutorial` is duck-typed on `globalThis` because its two halves are in
 * `src/shell/**` and `src/game/**` and the game may not import the shell. That
 * constraint does not apply here — both halves live under `src/campaign/**` —
 * so this is a plain module binding, which the compiler checks and a typo
 * cannot silently defeat.
 * ========================================================================== */

import type { EntityId } from '../core/types';
import type { EntityStore } from '../core/world';
import type { Medal, ObjectiveStatus, OperationDef, OperationState, Point } from './types';

/**
 * Something the shell should show. The sim half QUEUES these; it never does
 * them.
 *
 * `outcome.system.ts`'s header states the property this borrows verbatim — it
 * "writes nothing the sim reads, so `npm run soak`'s AI-vs-AI replays are
 * byte-identical with it loaded". Dialogue, EVA and the camera are presentation
 * and the fixed step may not touch them; a queue keeps that true, and keeps the
 * shell half free to drop the lot on a fast-forward without the world noticing.
 */
export interface PresentationEvent {
  readonly kind: 'dialogue' | 'eva' | 'camera' | 'objectives' | 'ended';
  readonly speaker?: string;
  readonly text?: string;
  readonly line?: string;
  readonly at?: Point;
}

/** One row of the objectives panel, as the campaign publishes it. */
export interface ObjectiveRow {
  readonly id: string;
  readonly title: string;
  readonly kind: 'primary' | 'secondary';
  readonly status: ObjectiveStatus;
}

/* ==========================================================================
 * WHAT A SAVE CARRIES
 *
 * `src/game/SaveGame.ts` writes this as `CHUNK_CMPN` and never looks inside it.
 * That is the whole reason the codec lives HERE rather than there: the save
 * layer already treats fog, ore and superweapon charge as structural ports it
 * knows nothing about, and an operation is one more of those. It knows one
 * field — the operation id, which it compares — and the rest is opaque JSON.
 * ========================================================================== */

/** One tag and the entities carrying it, as SAVE-LOCAL INDICES. */
export interface CampaignTagRow {
  readonly tag: string;
  readonly ids: readonly number[];
}

/**
 * The two halves of `runtime.ts#TagRegistry` a save needs, and nothing else.
 *
 * DECLARED STRUCTURALLY RATHER THAN IMPORTED. `TagRegistry` lives in
 * `runtime.ts`, which is behind the lazy boundary — this file is reachable from
 * `campaign.system.ts` and therefore from the entry chunk, so it may not name a
 * module on the other side of `campaign-install.ts`. `TagRegistry` satisfies
 * this as it stands; both methods were written with these exact parameters.
 */
export interface CampaignTagSet {
  snapshot(store: EntityStore, localOf: (id: EntityId) => number): readonly CampaignTagRow[];
  restore(rows: readonly CampaignTagRow[], handleOf: (local: number) => EntityId): void;
}

/**
 * `OperationState` flattened for JSON, plus the tag registry.
 *
 * **EVERY MAP AND SET IS A LIST OF STABLE STRING IDS, NEVER AN ARRAY INDEX.**
 * `TriggerDef.id`'s own doc says so — reordering the triggers in an operation
 * file must not change what a save restores — and an index-keyed encoding is
 * exactly the shape that would pass every test on the day it was written and
 * silently mis-restore the first time somebody moved a trigger up a line.
 */
export interface CampaignSaveState {
  readonly operationId: string;
  readonly startTick: number;
  /** `[triggerId, tick]` pairs. Absent from the list means disarmed. */
  readonly armedAt: readonly (readonly [string, number])[];
  readonly fired: readonly string[];
  /** `[objectiveId, status]` pairs. */
  readonly objectives: readonly (readonly [string, ObjectiveStatus])[];
  readonly paid: readonly string[];
  readonly outcome: 'won' | 'lost' | null;
  readonly reason: string;
  readonly tags: readonly CampaignTagRow[];
}

/**
 * What the system module drives. Implemented in `campaign-install.ts`, which is
 * the only module that knows what a Director is.
 */
export interface CampaignSession {
  readonly op: OperationDef;
  readonly state: OperationState;
  /**
   * The tags stamped by the layout and by every `spawnUnits` effect.
   *
   * ON THE INTERFACE BECAUSE A SAVE HAS TO REACH THEM, and it may not reach
   * `runtime.ts` to do it. The concrete `TagRegistry` already satisfies
   * `CampaignTagSet`; nothing about the session had to change to expose it.
   */
  readonly tags: CampaignTagSet;
  /**
   * Does `OperationDef.captureProof` forbid an engineer walking into `target`?
   *
   * **REQUIRED, NOT OPTIONAL, AND THAT IS THE OPPOSITE CALL FROM
   * `adoptRestoredState` BELOW.** Both are methods a session could plausibly
   * omit; the difference is which way the omission fails. A session that skips
   * `adoptRestoredState` mis-restores a save, loudly, in the one place a test
   * already watches. A session that skips this one PERMITS EVERY CAPTURE — the
   * feature silently does nothing, on exactly the four operations whose headers
   * now say it does something. There is one real implementation
   * (`campaign-install.ts#Session`) and `tsc` naming a test double is cheaper
   * than a permission nobody notices being granted.
   *
   * IT IS CALLED FROM INSIDE `simTick` AND FROM THE CURSOR. `game/campaign.system.ts`
   * installs one `CaptureService.addVeto` that delegates here; `resolve()`
   * consults the vetoes ahead of both the neutral and the enemy branch, and
   * `isCapturable` consults them per frame while a building is hovered. So it
   * must be a pure function of the operation and the tag registry: no clock, no
   * profile, no allocation.
   */
  isCaptureProof(target: EntityId): boolean;
  /** Called from `Phase.Cleanup` order 9000, every tick, while armed. */
  simTick(tick: number): void;
  /** Move queued presentation into `out`. Called from the render side. */
  drainPresentation(out: PresentationEvent[]): number;
  /** Current rows for the objectives panel. */
  rows(): readonly ObjectiveRow[];
  /** Non-null once the operation has resolved. */
  readonly outcome: 'won' | 'lost' | null;
  /** The objective id a loss names, or an empty string. */
  readonly reason: string;
  medal(difficulty: number): Medal;
  dispose(): void;
  /**
   * Called by `applyCampaignState` the instant a restore lands, BEFORE the next
   * `simTick`.
   *
   * **AN IMPLEMENTATION THAT STAMPS `startTick` LAZILY MUST STAND THAT DOWN
   * HERE, AND `campaign-install.ts#Session` IS ONE.** Its `simTick` opens with
   * `if (!this.started) { this.started = true; this.state.startTick = tick; }`
   * — correct for a fresh operation, and catastrophic for a restored one: a
   * save taken at minute nine and loaded before the session's first tick would
   * come back with `startTick` set to the RESTORED tick, so every `elapsed`
   * restarts from zero and the arming pass on that very tick disarms every hold
   * timer the restore just put back. One tick, permanent damage.
   *
   * OPTIONAL, so that a session which stamps eagerly (or a test double) needs
   * nothing. It is not optional in spirit — see the report on this chunk.
   */
  adoptRestoredState?(): void;
}

let live: CampaignSession | null = null;

/**
 * ARMED BEFORE THE BOOT, ADOPTED BY `init()` — the `preparePlayback` shape.
 *
 * `Shell.startOperation` arms an operation and then boots, and booting disposes
 * the previous engine. If `dispose()` cleared the ARMED session the way it
 * clears the live one, the match that is starting would silently be an ordinary
 * skirmish on the operation's seed with no objectives and no way to win —
 * which is precisely the bug `Playback.ts#detachPlayback` exists to document,
 * rediscovered by a different route. Two slots, two lifetimes.
 */
let pending: CampaignSession | null = null;

/** Arm an operation for the boot that is about to happen, or clear the arming. */
export function prepareOperation(session: CampaignSession | null): void {
  pending?.dispose();
  pending = session;
  if (session === null) live = null;
}

/** `campaign.system.ts#init` — take whatever was armed. */
export function adoptPreparedOperation(): void {
  live = pending;
}

/** The running operation, or null. */
export function campaignSession(): CampaignSession | null {
  return live;
}

/**
 * Let go of the running operation WITHOUT touching what is armed for the next
 * boot. `campaign.system.ts#dispose` calls this — never `endOperation`.
 */
export function detachOperation(): void {
  live = null;
}

/** Stop entirely, armed session included. The shell's exit path. */
export function endOperationSession(): void {
  live?.dispose();
  pending?.dispose();
  live = null;
  pending = null;
}

/* ==========================================================================
 * THE SAVE CODEC
 *
 * Two free functions rather than two methods, and the reason is the bundle
 * boundary again: `save.system.ts` is globbed into the entry chunk and may
 * therefore import this file and nothing deeper. Putting the codec here means
 * the save layer needs no knowledge of the Director, the operation table or the
 * layouts, and the concrete `Session` needs no method it does not already have.
 * ========================================================================== */

/**
 * Flatten the running operation for `CHUNK_CMPN`.
 *
 * `localOf` is the same slot-to-save-index map `writeEntities` builds, and a
 * handle it does not know is dropped — see `TagRegistry.snapshot`. Raw handles
 * are never written: a restore re-allocates every entity and bumps every
 * generation, so a stored handle would resolve, on the far side, against
 * whatever recycled the slot. That is the `carrierId` defect, and this is the
 * `REF_COLUMNS` answer to it.
 */
export function captureCampaignState(
  session: CampaignSession,
  store: EntityStore,
  localOf: (id: EntityId) => number,
): CampaignSaveState {
  const s = session.state;
  const armedAt: (readonly [string, number])[] = [];
  for (const [id, tick] of s.armedAt) armedAt.push([id, tick]);
  const objectives: (readonly [string, ObjectiveStatus])[] = [];
  for (const [id, status] of s.objectives) objectives.push([id, status]);

  return {
    operationId: s.operationId,
    startTick: s.startTick,
    armedAt,
    fired: [...s.fired],
    objectives,
    paid: [...s.paid],
    outcome: s.outcome,
    reason: s.reason,
    tags: session.tags.snapshot(store, localOf),
  };
}

/**
 * Put one back. Returns false — never throws — when the payload is not this
 * operation's, which is the same convention `SaveGame.ts` uses everywhere.
 *
 * THE ID CHECK IS BELT AND BRACES AND STAYS. `restoreSnapshot` already refuses
 * a save whose operation id is not the running one, so this branch should be
 * unreachable through the product path. It is here because the alternative to
 * an unreachable refusal is trigger state from operation 3 landing in operation
 * 7's session — the same trigger ids resolving to different triggers — and that
 * failure is silent, permanent and unreportable.
 */
export function applyCampaignState(
  session: CampaignSession,
  data: unknown,
  handleOf: (local: number) => EntityId,
): boolean {
  const parsed = parseCampaignSaveState(data);
  if (parsed === null) {
    console.warn('[campaign] this save\'s operation state is unreadable; the operation keeps its own.');
    return false;
  }
  const s = session.state;
  if (parsed.operationId !== s.operationId) {
    console.warn(
      `[campaign] this save is operation '${parsed.operationId}' and the running one is ` +
      `'${s.operationId}'. Its trigger state is refused rather than applied to a different table.`,
    );
    return false;
  }

  s.startTick = parsed.startTick;
  s.armedAt.clear();
  for (const [id, tick] of parsed.armedAt) s.armedAt.set(id, tick);
  s.fired.clear();
  for (const id of parsed.fired) s.fired.add(id);
  // REPLACED, NOT MERGED. `newOperationState` seeds every objective the
  // operation declares, so a merge would leave an objective the player had
  // already failed sitting at `active` if the save happened to omit it.
  s.objectives.clear();
  for (const [id, status] of parsed.objectives) s.objectives.set(id, status);
  s.paid.clear();
  for (const id of parsed.paid) s.paid.add(id);
  s.outcome = parsed.outcome;
  s.reason = parsed.reason;

  session.tags.restore(parsed.tags, handleOf);
  session.adoptRestoredState?.();
  return true;
}

/* -- parsing --------------------------------------------------------------
 * The payload came off a disk. Every field is checked, and a fault is a null
 * return rather than a throw.
 *
 * **A NULL HERE IS NOT A REFUSAL THE PLAYER SEES, AND THIS BLOCK USED TO SAY
 * IT WAS.** `applyCampaignState` returns false, `CampaignAccess.restore`
 * returns void, and `applySections` calls it as the LAST step of a restore
 * that has already rewritten the entity store, the players, the fog and the
 * ore. So an unreadable chunk is a `console.warn`, a world that came back
 * correctly, and an operation still sitting at whatever `newOperationState`
 * seeded — visible to the player as objectives and timers reset, with no
 * message. That is the accepted outcome rather than an oversight: refusing at
 * step 13 would leave the caller holding a half-restored world, which is
 * strictly worse than an operation that lost its trigger state.
 *
 * What the checking buys is that the loss is CLEAN. Without it the first bad
 * field is discovered partway through `applyCampaignState`, after `startTick`
 * and some of `armedAt` are already written — an operation running on one
 * save's clock and another's timers, which no amount of reloading fixes.
 * ------------------------------------------------------------------------ */

const OBJECTIVE_STATUSES: readonly string[] = ['hidden', 'active', 'complete', 'failed'];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function parsePairs<T>(v: unknown, second: (x: unknown) => x is T): (readonly [string, T])[] | null {
  if (!Array.isArray(v)) return null;
  const out: (readonly [string, T])[] = [];
  for (const row of v) {
    if (!Array.isArray(row) || row.length !== 2) return null;
    const [a, b] = row as [unknown, unknown];
    if (typeof a !== 'string' || !second(b)) return null;
    out.push([a, b]);
  }
  return out;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStatus = (x: unknown): x is ObjectiveStatus =>
  typeof x === 'string' && OBJECTIVE_STATUSES.includes(x);

function parseTagRows(v: unknown): CampaignTagRow[] | null {
  if (!Array.isArray(v)) return null;
  const out: CampaignTagRow[] = [];
  for (const row of v) {
    if (typeof row !== 'object' || row === null) return null;
    const r = row as { tag?: unknown; ids?: unknown };
    if (typeof r.tag !== 'string') return null;
    if (!Array.isArray(r.ids) || !r.ids.every((x) => Number.isInteger(x))) return null;
    out.push({ tag: r.tag, ids: r.ids as number[] });
  }
  return out;
}

export function parseCampaignSaveState(data: unknown): CampaignSaveState | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.operationId !== 'string' || !isFiniteNumber(d.startTick)) return null;
  if (typeof d.reason !== 'string') return null;
  if (d.outcome !== null && d.outcome !== 'won' && d.outcome !== 'lost') return null;

  const armedAt = parsePairs(d.armedAt, isFiniteNumber);
  const objectives = parsePairs(d.objectives, isStatus);
  const tags = parseTagRows(d.tags);
  if (armedAt === null || objectives === null || tags === null) return null;
  if (!isStringArray(d.fired) || !isStringArray(d.paid)) return null;

  return {
    operationId: d.operationId,
    startTick: d.startTick,
    armedAt,
    fired: d.fired,
    objectives,
    paid: d.paid,
    outcome: d.outcome,
    reason: d.reason,
    tags,
  };
}

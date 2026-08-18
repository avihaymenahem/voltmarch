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
 * ============================================================================
 * A MODULE-LEVEL SLOT, NOT A GLOBAL
 * ============================================================================
 * `__vmTutorial` is duck-typed on `globalThis` because its two halves are in
 * `src/shell/**` and `src/game/**` and the game may not import the shell. That
 * constraint does not apply here — both halves live under `src/campaign/**` —
 * so this is a plain module binding, which the compiler checks and a typo
 * cannot silently defeat.
 * ========================================================================== */

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

/**
 * What the system module drives. Implemented in `campaign-install.ts`, which is
 * the only module that knows what a Director is.
 */
export interface CampaignSession {
  readonly op: OperationDef;
  readonly state: OperationState;
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

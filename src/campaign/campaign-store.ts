/**
 * ============================================================================
 * VOLTMARCH — src/campaign/campaign-store.ts
 * ============================================================================
 * CAMPAIGN PROGRESS ON THE PROFILE: which operations are complete, the best
 * medal each one has ever paid, and which operation the `requires` graph is
 * willing to let the player start.
 *
 * ============================================================================
 * IT IS HERE, AND NOT IN `campaign-install.ts`, BECAUSE OF WHO ASKS
 * ============================================================================
 * The title screen wants to say "4 of 37, 1 gold" BEFORE the player has chosen
 * to open the campaign, and the operation list wants to grey out a locked row
 * while it is still deciding what to draw. Both of those are reads of the
 * PROFILE, not of the world — so they must not drag the operation table, the
 * Director, 37 layouts and every chapter's prose into the entry chunk to answer.
 *
 * So this module imports exactly two things: `Medal` as a TYPE from `./types`,
 * and `profile-store`, which imports nothing at all. It is safe from the shell,
 * safe from `campaign-install.ts`, and adding an import of `./index` here would
 * put the whole campaign in front of every player's first paint —
 * `tests/campaign-bundle-isolation.spec.ts` is the file that notices.
 *
 * ============================================================================
 * THE MEDAL IS MONOTONIC, AND THAT IS THE LOAD-BEARING RULE
 * ============================================================================
 * `recordOperation` compares with `>` and never lowers. Replaying a gold
 * operation on Easy scores bronze or silver — `medalFor` in `Director.ts` awards
 * gold only at Hard or above — and it must not take the gold away. **A reward
 * that can be lost by playing more is a reward nobody trusts**, and the failure
 * is worse than it sounds: the player has no way back except to replay on Hard,
 * so a single curious click at a lower difficulty is permanent damage to a
 * record they cannot see being written.
 *
 * ============================================================================
 * UNLOCKING NEEDS NO FIXED POINT
 * ============================================================================
 * `unlockedOperations` is one pass, and the reason is worth stating because the
 * obvious implementation is a graph closure that iterates to stability. An
 * operation is unlocked when every id in its `requires` is COMPLETE, and
 * completion is a fact stored on the profile — never a fact derived from
 * unlockedness. So no operation's answer can change another's, and a second
 * pass would find exactly what the first did.
 *
 * A COMPLETE OPERATION IS ALWAYS UNLOCKED, whatever its `requires` says. That
 * branch only fires for a profile whose graph and rows disagree — an edited
 * blob, or a build in which an operation's prerequisites were re-authored after
 * the player beat it — and in both cases hiding an operation the player is
 * holding a medal for is the worse answer.
 * ========================================================================== */

import { MAX_CAMPAIGN_ROWS, isSaneId } from '../progression/profile-store';
import type { Profile, ProfileStore } from '../progression/profile-store';
import type { Medal } from './types';

/* ==========================================================================
 * 1. WHAT THE GRAPH WALK NEEDS
 * ========================================================================== */

/**
 * The two fields of an `OperationDef` that decide whether it may be started.
 *
 * `OperationDef` satisfies this structurally, so `unlockedOperations(CAMPAIGNS,
 * profile)` compiles with no cast and no adapter — and a spec can build a
 * five-node fixture graph without authoring five maps, five rosters, five
 * objective lists and five trigger tables. That difference is what decides
 * whether the gate is tested against the gate or against whatever the shipped
 * campaign happens to contain this week; today that is ONE operation with an
 * empty `requires`, which cannot exercise a single edge.
 */
export interface OperationNode {
  readonly id: string;
  readonly requires: readonly string[];
}

/** `ChapterDef` satisfies this. Same reasoning as `OperationNode`. */
export interface ChapterNode {
  readonly operations: readonly OperationNode[];
}

/** Bronze 1, silver 2, gold 3 — mirroring `Medal`, which is a type and cannot. */
const GOLD: Medal = 3;

/* ==========================================================================
 * 2. READS
 * ========================================================================== */

/**
 * The best medal on record, narrowed to `Medal`.
 *
 * **THE `typeof` GUARD IS NOT DEFENSIVE PADDING.** `profile.campaign` is a plain
 * object literal, so it inherits `Object.prototype`: `campaign['constructor']`
 * answers a Function and `campaign['toString']` answers a Function, for any
 * profile, forever. An operation id is content and could legally be any string,
 * and a cast without this check would hand a `Function` to a caller typed to
 * receive 0..3. The compiler is no help and actively misleading here — it types
 * the index access as `number`, because `Record<string, number>` makes no claim
 * about inherited keys — so the guard reads as dead code and is the only thing
 * standing between `Object.prototype.constructor` and a `Medal`.
 *
 * The clamp is the other half. `normalizeProfile` already bounds every row on
 * load, but `ProfileStore.get()` hands out the LIVE object — its own header
 * says so — so this is the one place a `number` becomes a `Medal`, and it is
 * cheaper to make that place total than to trust every writer forever.
 */
export function medalOf(profile: Readonly<Profile>, operationId: string): Medal {
  const raw = profile.campaign[operationId];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  const n = Math.floor(raw);
  if (n <= 0) return 0;
  return (n >= GOLD ? GOLD : n) as Medal;
}

/**
 * Has this operation ever been won?
 *
 * Derived from the medal rather than stored beside it, because `Profile.campaign`
 * promises a row exists if and only if the operation was won. Two fields would
 * be two things to keep in step and one more state — complete-but-medalless —
 * that nothing produces and everything would have to handle.
 */
export function operationComplete(profile: Readonly<Profile>, operationId: string): boolean {
  return medalOf(profile, operationId) > 0;
}

/**
 * The menu hint. One walk of a map that holds at most one row per operation.
 *
 * `completed` counts rows rather than trusting `Object.keys().length`, so a row
 * that somehow normalised to 0 cannot inflate the number the player reads.
 */
export function campaignProgress(
  profile: Readonly<Profile>,
): { completed: number; golds: number } {
  let completed = 0;
  let golds = 0;
  for (const id of Object.keys(profile.campaign)) {
    const medal = medalOf(profile, id);
    if (medal <= 0) continue;
    completed++;
    if (medal >= GOLD) golds++;
  }
  return { completed, golds };
}

/**
 * Every operation the player may start, across the chapters given.
 *
 * Takes the chapter list rather than reaching for `CAMPAIGNS` itself: that
 * import is the one this file may not have (see the header), and it makes the
 * gate testable against a fixture graph.
 */
export function unlockedOperations(
  chapters: readonly ChapterNode[],
  profile: Readonly<Profile>,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const chapter of chapters) {
    for (const op of chapter.operations) {
      if (operationComplete(profile, op.id)) {
        out.add(op.id);
        continue;
      }
      let open = true;
      for (const req of op.requires) {
        if (operationComplete(profile, req)) continue;
        open = false;
        break;
      }
      // A requirement naming an operation that does not exist stays unsatisfied
      // forever, and that is the right answer rather than an error: an id
      // nothing can complete is an id nothing can clear.
      if (open) out.add(op.id);
    }
  }
  return out;
}

/* ==========================================================================
 * 3. THE ONE WRITE
 * ========================================================================== */

/**
 * Record an operation's result. Returns true when the stored best actually
 * moved — false for a loss, for a repeat, and for anything at or below what is
 * already on record.
 *
 * `mutateNow`, NEVER `mutate`. `profile-store.ts`'s own header draws the line:
 * counters batch, "a mission COMPLETING must survive the player closing the tab
 * one second later". Finishing an operation is the largest single thing this
 * game asks a player to do and the end screen is exactly where they close the
 * tab.
 *
 * The return value is a boolean rather than `void` so the end screen can say
 * NEW BEST without re-reading and comparing; a caller that does not care may
 * ignore it.
 */
export function recordOperation(
  store: ProfileStore,
  operationId: string,
  medal: Medal,
): boolean {
  // Guarded with the normaliser's OWN predicate, so a write that reports
  // success cannot be a row that vanishes at the next boot.
  if (!isSaneId(operationId)) return false;
  if (medal <= 0) return false;

  return store.mutateNow((p) => {
    // THE MONOTONIC RULE, IN ONE LINE. `>` and nothing else; see the header.
    if (medal <= medalOf(p, operationId)) return false;
    const isNewRow = !Object.prototype.hasOwnProperty.call(p.campaign, operationId);
    if (isNewRow && Object.keys(p.campaign).length >= MAX_CAMPAIGN_ROWS) return false;
    p.campaign[operationId] = medal;
    return true;
  });
}

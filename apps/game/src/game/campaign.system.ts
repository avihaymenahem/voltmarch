/**
 * ============================================================================
 * VOLTMARCH — src/game/campaign.system.ts
 * ============================================================================
 * THE CAMPAIGN'S TWO HALVES, AND THE LINE BETWEEN THEM.
 *
 * | half  | where                     | does                                  |
 * |-------|---------------------------|---------------------------------------|
 * | sim   | `Phase.Cleanup` **9000**  | evaluates triggers, applies effects,   |
 * |       |                           | writes `OperationState` and the outcome|
 * | shell | `RenderPhase.Hud` **9000**| reads that state, ends the match,      |
 * |       |                           | publishes objectives, drives dialogue  |
 *
 * `outcome.system.ts` is the in-tree precedent and this is deliberately its
 * shape: a render-side system reaching the shell through the duck-typed
 * `globalThis.__vmShell`, whose own header records the property that makes it
 * safe — it "writes nothing the sim reads, so `npm run soak`'s AI-vs-AI replays
 * are byte-identical with it loaded".
 *
 * ============================================================================
 * WHY `Phase.Cleanup` ORDER 9000, PRECISELY
 * ============================================================================
 * **After the flush.** `combat.cleanup` runs at `Phase.Cleanup` order 0 and
 * that is where `flushDestroyed` bumps generations and returns slots. Running
 * before it would let a condition count an entity that died this tick, so
 * "destroy the tap" would be false on the tick the tap died and true on the
 * next — a one-tick lie that a `not` turns into a permanent one.
 *
 * **Before `scenarios.system.ts` (10,000) and `save.system.ts` (30,000).** A
 * save taken this tick must see the trigger state this tick produced.
 *
 * **And after the Command-phase drain, which is what makes replay work.** An
 * order this system issues lands on the bus AFTER the drain and is applied on
 * tick N+1. Recording: it is recorded at N+1 and applied at N+1. Playback: the
 * Director re-derives the same order at Cleanup of tick N, and
 * `playback.system.ts` (Phase.Command order 1) HARVESTS the bus at the start of
 * N+1 — throwing the re-derived copy away — before feeding the recorded one. So
 * it applies exactly once, on the same tick, either way. **Move this system
 * ahead of the drain and every scripted order applies twice under playback.**
 * That is trap 2 in `Replay.ts`, avoided by a phase number rather than a flag.
 *
 * ============================================================================
 * IT IS INERT WITHOUT AN ARMED OPERATION, AND THAT COSTS ONE NULL CHECK
 * ============================================================================
 * `tutorial.system.ts` costs exactly the same and for the same reason. Of the
 * campaign this module imports `src/campaign/{session,policy,types}.ts` and
 * NOTHING ELSE — all three are types and module-level bindings with no runtime
 * weight — because `src/game/Systems.ts` globs `*.system.ts` with `eager: true`
 * from the entry chunk. The Director, the operation table, the layouts and every
 * word of prose arrive through one
 * `await import('../campaign/campaign-install')` in `Shell.startOperation`.
 * `tests/campaign-bundle-isolation.spec.ts` fails when that boundary is crossed,
 * and it is written to fail rather than to be trusted.
 *
 * **THE ONE NON-CAMPAIGN IMPORT BEYOND `core/` AND `game/context` IS
 * `sim/Capture.ts`**, and it is free: `sim/features.system.ts` is globbed
 * eagerly too and constructs the `CaptureService`, so that module is in the
 * entry chunk with or without this edge. §2b below is the argument; the spec
 * carries the allow-list and asserts the "already in the entry chunk" half
 * rather than taking it on trust. (This paragraph read "imports … and NOTHING
 * ELSE" with no qualifier, which was a claim about the whole import list and
 * true only of the campaign half of it.)
 * ========================================================================== */

import { Phase, RenderPhase } from '../core/types';
import type { RenderContext, SimContext } from '../core/types';
import { defineSystem } from '../core/loop';
import { hasGameContext } from './context';
import { captureService } from '../sim/Capture';
import { campaignRunning } from '../campaign/policy';
import {
  adoptPreparedOperation, campaignSession, detachOperation,
} from '../campaign/session';
import type { ObjectiveRow, PresentationEvent } from '../campaign/session';

/* ==========================================================================
 * 1. THE SHELL SEAM
 *
 * Duck-typed, never `instanceof`, and declared here rather than imported —
 * `src/game/**` may not reach into `src/shell/**`, and a test asserts it.
 * ========================================================================== */

interface CampaignShellHost {
  getState(): string;
  endMatch(result: { won: boolean; reason?: string }): void;
  /*
   * THERE IS NO `publishCampaignObjectives`, AND THERE WAS ONE UNTIL
   * 2026-08-19. It pushed the objective rows at the shell whenever their
   * fingerprint changed; the shell stored them in a private field READ BY
   * NOBODY. The objectives panel has always taken its rows from
   * `campaignObjectiveView()` in `ui/objectives.system.ts`, which reads
   * `campaignSession()` directly, and the pause menu reads that same provider
   * now rather than the skirmish profile. So this was a second channel for one
   * fact — and the fingerprint that decided whether to feed it was a string
   * CONCATENATED PER FRAME, an allocation in the frame loop for a consumer
   * that did not exist.
   *
   * Its doc block had also come adrift and was sitting above `difficultyOf`'s,
   * describing a function two declarations away — which is how a comment ends
   * up outliving the thing it explains.
   *
   * If a surface ever needs pushing rather than polling, add it back knowing
   * that: one provider, and the poll is why the panel needs no subscription.
   */
  /** Dialogue, EVA and camera. Optional for the same reason. */
  playCampaignBeat?(event: PresentationEvent): void;
  /**
   * The finished operation, pushed IMMEDIATELY BEFORE `endMatch`.
   *
   * PUSHED FROM HERE RATHER THAN PULLED BY THE SHELL, because only this side
   * can reach the session synchronously: the session lives behind the lazy
   * `campaign-install` chunk and `Shell.buildResult` runs inside a frame. The
   * alternative was a second copy of `medalFor`'s rule in the shell, which is
   * exactly the drift this repo keeps cataloguing.
   */
  publishCampaignResult?(result: {
    operationId: string;
    medal: number;
    reason: string;
    objectives: readonly ObjectiveRow[];
  }): void;
}

function shellHost(): CampaignShellHost | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const s = g.__vmShell as Partial<CampaignShellHost> | undefined;
  if (s === undefined) return null;
  if (typeof s.getState !== 'function' || typeof s.endMatch !== 'function') return null;
  return s as CampaignShellHost;
}

/* ==========================================================================
 * 2. STATE
 * ========================================================================== */

/** Reused, so the drain allocates nothing per frame. */
const beats: PresentationEvent[] = [];
let ended = false;

function resetShellState(): void {
  beats.length = 0;
  ended = false;
}

/* ==========================================================================
 * 2b. `captureProof` — THE ONE PIECE OF THE CAMPAIGN THAT REACHES THE SIM
 *
 * `OperationDef.captureProof` names structures an engineer may not walk into.
 * The knowledge lives in `campaign-install.ts#Session.isCaptureProof`, behind
 * the lazy boundary, because it needs the tag registry; all that lives here is
 * the HOOK, and the hook has to live here for two reasons that point the same
 * way.
 *
 * **`CaptureService` IS BUILT BY THE BOOT, SO THE VETO CANNOT BE ARMED BEFORE
 * IT.** `Shell.startOperation` arms the operation and THEN boots;
 * `sim/features.system.ts#init` constructs the service during that boot. A veto
 * installed in `armOperation` would land on the previous match's service and the
 * new one would carry none. This module's `init()` runs after
 * `adoptPreparedOperation()` on the same engine — and after `features.system.ts`
 * unconditionally, because `SystemRegistry.init` walks modules in PHASE order
 * and `Phase.Cleanup` (1400) is far behind `Phase.Production` (200).
 *
 * **AND THE SIM IMPORT IS FREE HERE AND NOWHERE ELSE.** `sim/Capture.ts` is
 * already in the entry chunk — `sim/features.system.ts` is globbed eagerly and
 * imports it — so this edge costs no byte. It is the campaign's LIGHT half
 * reaching a module the entry chunk already holds, not the heavy half reaching
 * anything; `tests/campaign-bundle-isolation.spec.ts` §1 carries the widened
 * allow-list and the argument for it.
 *
 * WHOEVER SETS IT CLEARS IT. `init` installs, `dispose` removes, and both go
 * through these two functions so the pair cannot drift. A veto left installed
 * after an operation ends is a rule the NEXT skirmish silently inherits — the
 * `suppressUnlockGate` leak, in a different costume.
 *
 * The predicate re-reads `campaignSession()` rather than closing over the
 * session it was installed for. That is the safe direction: if the two lifetimes
 * ever disagree, a veto whose session has been detached answers "not proof" and
 * the game behaves exactly as it does with no operation armed, rather than
 * enforcing a dead operation's rule on a live match.
 * ========================================================================== */

let unhookCaptureProof: (() => void) | null = null;

function armCaptureProof(): void {
  clearCaptureProof();
  // Nothing to enforce without an operation, and an inert veto on the list is a
  // rule a reader has to check rather than a rule that is absent.
  if (campaignSession() === null) return;
  unhookCaptureProof = captureService()?.addVeto(
    (target) => campaignSession()?.isCaptureProof(target) === true,
  ) ?? null;
}

function clearCaptureProof(): void {
  unhookCaptureProof?.();
  unhookCaptureProof = null;
}

/**
 * The difficulty the medal is graded against.
 *
 * READ OFF THE SHELL, DUCK-TYPED, because `src/game/**` may not import
 * `src/shell/**` and this is the one number the grading needs that the sim does
 * not hold. A shell that cannot answer grades as Normal, which costs a gold
 * rather than awarding one — the safe direction for a monotonic best-ever
 * record that is never lowered.
 */
function difficultyOf(): number {
  const g = globalThis as unknown as { __vmShell?: { matchDifficulty?: () => number } };
  const d = g.__vmShell?.matchDifficulty?.();
  return typeof d === 'number' && Number.isFinite(d) ? d : 1;
}

/* ==========================================================================
 * 3. THE MODULE
 * ========================================================================== */

export default defineSystem({
  id: 'game.campaign',
  phase: Phase.Cleanup,
  renderPhase: RenderPhase.Hud,
  // ONE `order` SERVES BOTH PHASES — `SystemModule` has a single tie-breaker,
  // not one per phase — and 9000 happens to be right on both sides, which is
  // luck worth stating rather than relying on silently:
  //
  //   sim    Cleanup 9000: after `combat.cleanup` (0) has flushed the dead,
  //          before `scenarios.system` (10,000) and `save.system` (30,000).
  //   render Hud 9000: after `game.outcome` (900) and `ui.objectives` (200),
  //          so a policy that stood the shipped rules down has already been
  //          read this frame and the campaign gets the last word on how a
  //          match ends.
  //
  // If a future phase needs the two to diverge, SPLIT THE MODULE rather than
  // compromising one of them — a shared number that is wrong on one side is
  // the kind of thing that reads as correct in a diff.
  order: 9000,

  init(): void {
    resetShellState();
    // `adoptPreparedOperation`, not `prepareOperation(null)`. The arming
    // happens BEFORE the boot and booting disposes the previous engine — see
    // `session.ts`, and `Playback.ts#detachPlayback` for the same split found
    // the expensive way.
    adoptPreparedOperation();
    // AFTER the adopt, never before: `armCaptureProof` asks whether a session
    // was taken, and the answer is only true on this side of that line.
    armCaptureProof();
  },

  simTick(s: SimContext): void {
    const session = campaignSession();
    if (session === null) return;
    session.simTick(s.tick);
  },

  frame(_r: RenderContext): void {
    if (!hasGameContext()) return;
    const session = campaignSession();
    if (session === null) return;
    const shell = shellHost();
    if (shell === null) return;

    // Presentation first, so a line that fires on the winning tick is spoken
    // before the end screen covers the match.
    if (session.drainPresentation(beats) > 0) {
      for (const b of beats) shell.playCampaignBeat?.(b);
      beats.length = 0;
    }

    if (session.outcome !== null && !ended) {
      ended = true;
      // BEFORE `endMatch`, not after. `endMatch` builds the result and raises
      // the screen in the same call, so a result published afterwards arrives
      // for a screen that has already been drawn.
      shell.publishCampaignResult?.({
        operationId: session.op.id,
        medal: session.medal(difficultyOf()),
        reason: session.reason,
        objectives: session.rows(),
      });
      shell.endMatch({ won: session.outcome === 'won', reason: session.reason });
    }
  },

  dispose(): void {
    resetShellState();
    // THE VETO IS UNINSTALLED HERE AND NOT AT `endOperationSession`, and the
    // difference matters in the direction `detachOperation` already documents.
    // A veto belongs to the ENGINE that built the `CaptureService` it sits in,
    // and this is the teardown of that engine — so it goes even when the next
    // operation is already armed for the boot that follows. The next engine's
    // `init` installs a fresh one.
    clearCaptureProof();
    // `detachOperation`, NOT `endOperationSession`. See `session.ts`: the shell
    // arms an operation and then boots, and the boot disposes the engine that
    // was running. Clearing the ARMED session here hands the player an ordinary
    // skirmish on the operation's seed, silently.
    detachOperation();
  },
});

/** True while an operation owns the session. Re-exported for the outcome rules. */
export { campaignRunning };

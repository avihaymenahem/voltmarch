/**
 * ============================================================================
 * VOLTMARCH — src/shell/progression-link.ts
 * ============================================================================
 * The front end's one door onto the progression layer.
 *
 * WHY A MODULE AND NOT SIX `globalThis` READS
 * -------------------------------------------
 * `src/progression/**` is a system: it registers by existing, it publishes
 * `globalThis.__vmProgression` at `init`, and under the `?shot=` harness it
 * deliberately publishes NOTHING. So every shell call site has to answer the
 * same question — "is it there?" — and every one of them has to answer it the
 * same way, or the screenshot harness starts throwing on a screen nobody
 * thought about. That answer lives here exactly once.
 *
 * THE ABSENT HANDLE IS A SUPPORTED CONFIGURATION, NOT AN ERROR
 * ------------------------------------------------------------
 * Every function below is total. `isUnlocked` returns TRUE when there is no
 * handle, because "no progression layer" must mean "nothing is gated" — the
 * same default `UnlockGate` uses in the sim, and the reason the harness can
 * still pick any map. The lifecycle calls are silent no-ops. Nothing here ever
 * throws, so the shell has no defensive branch in it.
 *
 * THE READER IS DUCK-TYPED
 * ------------------------
 * `readProgression` (src/ui/Objectives.ts) already verifies the VIEW half the
 * same way the HUD verifies the settings store. This file verifies the CONTROL
 * half on top, because the two halves are published together by one module but
 * the type is structural and a partially built handle is a real state during
 * init ordering.
 *
 * THE ONE HARD IMPORT
 * -------------------
 * `UnlockGate` is imported for real, unlike the types. It is a leaf: its only
 * import is `import type` and therefore erased, so this edge costs nothing at
 * runtime, `unlockGate()` returns null when no system installed one, and
 * `src/sim/Production.ts` already depends on exactly the same module. There is
 * no second way to reach the gate's POLICY (mirror / unrestricted), which is
 * the thing the lobby toggle has to move.
 * ============================================================================
 */

import { readProgression, type ProgressionView } from '../ui/Objectives';
import { unlockGate } from '../progression/UnlockGate';
import { persistentStorage } from '../platform/storage';

/* ==========================================================================
 * 1. THE CONTROL HALF
 *
 * Restated structurally rather than imported from `src/progression/types.ts`,
 * for the same reason `src/ui/Objectives.ts` restates the view: the shell has
 * to compile and boot with `src/progression/**` deleted. `tests/progression-
 * gate.spec.ts` imports the real `ProgressionControl` and asserts it is
 * assignable to this, so the restatement cannot silently drift.
 * ========================================================================== */

export interface MatchStartInfo {
  seed: number;
  localPlayer: number;
  faction: number;
  difficulty?: number;
}

export interface MatchEndInfo {
  won: boolean;
  durationSec: number;
}

export interface ProgressionControl {
  beginMatch(info: MatchStartInfo): void;
  endMatch(info: MatchEndInfo): void;
  abandonMatch(): void;
  inMatch(): boolean;
  flush(): void;
  recordCampaignOperation(operationId: string, medal: number): boolean;
}

export type ProgressionHandle = ProgressionView & ProgressionControl;

/* ==========================================================================
 * 2. THE PROBE
 * ========================================================================== */

/**
 * The live handle with BOTH halves, or null.
 *
 * Null covers three real states and treats them identically: the progression
 * system is not registered, it has not run `init` yet (the shell's menu paints
 * before the first match boots), or the `?shot=` harness suppressed it.
 */
export function progressionHandle(): ProgressionHandle | null {
  const view = readProgression();
  if (view === null) return null;
  const c = view as Partial<ProgressionControl>;
  if (typeof c.beginMatch !== 'function') return null;
  if (typeof c.endMatch !== 'function') return null;
  if (typeof c.abandonMatch !== 'function') return null;
  if (typeof c.flush !== 'function') return null;
  return view as ProgressionHandle;
}

/** The view half alone. Re-exported so screens import one module, not two. */
export { readProgression };
export type { ProgressionView };

/* ==========================================================================
 * 3. THE TOTAL HELPERS
 * ========================================================================== */

/**
 * Does the profile own this unlock id?
 *
 * TRUE when there is no progression layer. This is the whole "graceful
 * degradation" contract in one line: a build with the system removed, and the
 * screenshot harness, both see an entirely open game rather than an entirely
 * locked one.
 */
export function isUnlocked(unlockId: string): boolean {
  const p = readProgression();
  if (p === null) return true;
  try {
    return p.isUnlocked(unlockId);
  } catch {
    return true;
  }
}

/** `map.<MapChoice.id>` — the id the mission table pays out. */
export function mapUnlockId(mapId: string): string {
  return `map.${mapId}`;
}

/** Is this map playable on the current profile? */
export function isMapUnlocked(mapId: string): boolean {
  return isUnlocked(mapUnlockId(mapId));
}

/* ==========================================================================
 * 4. GATE POLICY
 *
 * "Does the AI resolve against my unlocks, or against nothing?"
 *
 * The default is MIRROR: the opponent fields exactly the roster the player can
 * field. An AI rolling out a unit the player has never seen and cannot build
 * reads as the game cheating, and it burns the reveal that the unlock exists to
 * deliver. The toggle exists for the player who would rather have the harder
 * game than the reveal — and turning the mirror off makes the AI UNRESTRICTED,
 * not restricted differently.
 *
 * WHY THE PREFERENCE LIVES HERE AND NOT ON THE GATE
 * -------------------------------------------------
 * `progression.system.ts` runs `init` on EVERY match boot and constructs a
 * fresh `UnlockGate` with `mirrorAI: true`. A toggle written straight onto the
 * gate from the lobby would therefore be erased by the very match it was set
 * for. So the preference is owned here, persisted next to the profile, and
 * re-applied to whatever gate exists at `beginMatch`.
 * ========================================================================== */

const MIRROR_AI_KEY = 'vm.ai.mirrorUnlocks';

/** Total: any storage failure (private mode, harness, node) reads as default. */
function readStoredFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = persistentStorage().getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

/** Does the AI resolve against the human's unlocks? Default true. */
export function aiMirrorsUnlocks(): boolean {
  return readStoredFlag(MIRROR_AI_KEY, true);
}

/** Set the policy and push it at the live gate immediately. */
export function setAiMirrorsUnlocks(on: boolean): void {
  try {
    persistentStorage().setItem(MIRROR_AI_KEY, on ? '1' : '0');
  } catch {
    // A profile that cannot persist still gets the setting for this session.
  }
  unlockGate()?.setMirrorAI(on);
}

/** True when a gate is installed at all — i.e. when the toggle means anything. */
export function gateInstalled(): boolean {
  return unlockGate() !== null;
}

/** Re-apply the stored policy to whatever gate the current boot created. */
export function applyGatePolicy(): void {
  unlockGate()?.setMirrorAI(aiMirrorsUnlocks());
}

/**
 * Tell the tracker a match has begun.
 *
 * Called from `Shell.startMatch` AFTER the world exists, so `localPlayer` and
 * the resolved faction id are facts rather than the lobby's intent — a scenario
 * that seats the human somewhere other than player 0 would otherwise credit
 * every kill to the wrong side.
 */
export function beginMatch(info: MatchStartInfo): void {
  // The gate is younger than the lobby: this boot built it a moment ago with
  // the default policy. Re-apply before the first tick asks it anything.
  applyGatePolicy();
  progressionHandle()?.beginMatch(info);
}

/**
 * Tell the tracker how it ended.
 *
 * MUST run before `EndScreen` is constructed: the end screen drains the pending
 * reward queue exactly once, in its constructor, and a drain that happens
 * before the win is recorded shows the player an empty reveal for rewards they
 * just earned.
 */
export function endMatch(info: MatchEndInfo): void {
  progressionHandle()?.endMatch(info);
}

/** Quit to menu: drop the objectives, keep the profile progress, no result. */
export function abandonMatch(): void {
  progressionHandle()?.abandonMatch();
}

/** True between `beginMatch` and `endMatch`. False with no handle. */
/**
 * Record a finished campaign operation on the profile.
 *
 * FALSE when there is no progression layer, which is the same graceful
 * degradation every helper in this file promises: the `?shot=` harness and a
 * build with the system removed both play the campaign and record nothing,
 * rather than throwing on the end screen.
 */
export function recordCampaignOperation(operationId: string, medal: number): boolean {
  const h = progressionHandle();
  if (h === null) return false;
  try {
    return h.recordCampaignOperation(operationId, medal);
  } catch {
    return false;
  }
}

export function inMatch(): boolean {
  return progressionHandle()?.inMatch() ?? false;
}

/** Force a persist. Cheap, idempotent, and safe to call from `pagehide`. */
export function flushProfile(): void {
  progressionHandle()?.flush();
}

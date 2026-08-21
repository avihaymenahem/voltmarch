/**
 * ============================================================================
 * src/shell/unlockall.system.ts — the `?unlockall` flag, reachable without a
 * URL bar
 * ============================================================================
 * Asked for as *"add the unlock all toggle in diagnostics"*.
 *
 * `?unlockall` has existed for as long as the progression gate has, and
 * `progression.system.ts` sets out at length why it is safe to ship: it changes
 * only what `isUnlocked` ANSWERS, it never writes to the profile, and reloading
 * without it restores the real progression exactly. What it cannot do is be
 * used on the packaged desktop build, which has no address bar — and that is
 * where this project's harder bugs are now hit. Same argument that put the
 * Diagnostics tab there at all: a tool you cannot reach at the moment you need
 * it is not a tool.
 *
 * ----------------------------------------------------------------------------
 * IT IS AN EXPLICIT, PERSISTED PLAYER PREFERENCE.
 * ----------------------------------------------------------------------------
 * The setting is visible in Diagnostics and is intentionally stored separately
 * from earned progression: enabling it changes what the gate answers, never
 * writes unlock rewards into the profile. On desktop the preference lives in
 * Electron userData through the native storage bridge; the web build uses its
 * platform fallback. Restore Defaults turns it off and removes the key.
 *
 * ----------------------------------------------------------------------------
 * WHY THIS IS A SYSTEM MODULE AND NOT TWO LINES IN THE OPTIONS SCREEN.
 * ----------------------------------------------------------------------------
 * `progression.system.ts` runs `init()` on EVERY match boot and constructs a
 * FRESH `UnlockGate` from this browser's profile. A toggle written straight
 * onto the live gate is therefore erased by the very next match — which is the
 * trap `src/shell/progression-link.ts` already documents for the mirror-AI
 * preference, in almost these words.
 *
 * So the flag is owned here and re-applied at `init`, at `Phase.Command`
 * order 21 — immediately after `progression.core` at order 20, which is the
 * module that installs the gate. `SystemRegistry.init` awaits each module in
 * `(phase, order, seq)` order, so "after the gate exists" is guaranteed by the
 * number rather than by luck.
 *
 * INERT UNTIL SOMEBODY ASKS. `init` returns immediately while the flag is
 * false, which it is on every boot including every `?shot=` fixture — the
 * harness never loads the shell chunk, so nothing can ever set it there and the
 * capture set is untouched.
 *
 * IT CANNOT AFFECT MULTIPLAYER OR A REPLAY. Both call
 * `suppressUnlockGate(true)`, and `isBuildable` answers `true` on the
 * suppression flag BEFORE it ever consults the gate this module writes to. So
 * in the two modes where a wrong answer would be a divergence, this is not in
 * the path at all.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { Phase } from '../core/types';

import { unlockGate } from '../progression/UnlockGate';
import { isUnlockAll } from '../progression/progression.system';
import { persistentStorage, type PersistentStorage } from '../platform/storage';

export const UNLOCK_ALL_STORAGE_KEY = 'vm.settings.unlockAll';

export function readPersistedUnlockAll(storage: PersistentStorage = persistentStorage()): boolean {
  try { return storage.getItem(UNLOCK_ALL_STORAGE_KEY) === '1'; }
  catch { return false; }
}

/** Hydrated before the first gate is created. */
let session = readPersistedUnlockAll();

/**
 * Is everything unlocked right now, and for either reason?
 *
 * `?unlockall` is folded in so the two routes cannot disagree: a session booted
 * with the flag reports the toggle as ON, which is true, rather than showing an
 * off switch next to a fully unlocked build.
 */
export function unlockAllActive(): boolean {
  return session || isUnlockAll();
}

/** True when the boot flag is what is doing it, so the row can say the toggle is stuck on. */
export function unlockAllFromBootFlag(): boolean {
  return isUnlockAll();
}

/**
 * Turn it on or off for the rest of this page load.
 *
 * Pushes at the live gate immediately, so the sidebar's locked cameos become
 * buildable on the next `availabilityOf` pass without leaving the match —
 * `ProductionService.rebuildCameos` publishes locked entries and greys them, it
 * does not omit them, so nothing has to be rebuilt for the change to show.
 *
 * Turning it OFF restores what the URL asked for rather than a bare `false`,
 * so a session booted with `?unlockall` cannot be half-disarmed into a state
 * neither the flag nor the toggle describes.
 */
export function setSessionUnlockAll(
  on: boolean,
  storage: PersistentStorage = persistentStorage(),
): void {
  session = on;
  try {
    if (on) storage.setItem(UNLOCK_ALL_STORAGE_KEY, '1');
    else storage.removeItem(UNLOCK_ALL_STORAGE_KEY);
  } catch {
    // The live session still follows the switch even if disk is unavailable.
  }
  unlockGate()?.setUnrestricted(unlockAllActive());
}

export default defineSystem({
  id: 'shell.unlockall',
  phase: Phase.Command,
  // AFTER `progression.core` (Phase.Command, order 20), which is the module
  // that constructs and installs the gate. See the header.
  order: 21,

  init(): void {
    if (!session) return;
    unlockGate()?.setUnrestricted(true);
    console.warn(
      '[unlockall] Unlock Everything is ON (Options -> Diagnostics). '
      + 'Every gated unit, structure, battlefield and campaign operation is available; '
      + 'combat content is also available to the AI. '
      + 'The preference is saved, but no unlock reward is written to your profile.',
    );
  },
});

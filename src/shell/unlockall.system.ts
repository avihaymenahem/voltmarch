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
 * IT IS SESSION STATE, IN MEMORY, AND THAT IS THE WHOLE SAFETY ARGUMENT.
 * ----------------------------------------------------------------------------
 * Not persisted. Not in `SettingsStore`, not in `localStorage`, not next to the
 * profile. One module-level boolean that dies with the page.
 *
 * The alternative was considered and rejected on a documented precedent.
 * `suppressUnlockGate` — the PvP hammer — leaked exactly once, and the symptom
 * was that ONE multiplayer match left EVERY LATER SKIRMISH ungated for the rest
 * of the session, silently, with nothing on screen to say so.
 * `Shell.startMatch` now clears it for that reason. A PERSISTED "unlock
 * everything" is that same bug with a settings row on it and a lifetime of
 * forever: a player who forgot they flipped it would go on playing an ungated
 * game across reboots, would never be shown a locked cameo again, and the only
 * evidence would be a toggle six clicks deep on a tab they opened once.
 *
 * Memory-only makes the failure mode self-correcting — restart the app and the
 * real profile is back — and it matches `?unlockall`'s own contract, which
 * `progression.system.ts` states as "Nothing is persisted, so nothing has to be
 * cleaned up".
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

/** Set by the Diagnostics tab. Dies with the page, by design. */
let session = false;

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
export function setSessionUnlockAll(on: boolean): void {
  session = on;
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
      '[unlockall] Unlock Everything is ON for this session (Options -> Diagnostics). '
      + 'Every gated unit, structure and battlefield is available to you AND to the AI. '
      + 'Nothing is written to your profile; restart the game to get your real progression back.',
    );
  },
});

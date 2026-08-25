/**
 * ============================================================================
 * VOLTMARCH — src/progression/suppress.ts
 * ============================================================================
 * ONE LATCH THAT SHUTS THE PROFILE OFF, HONOURED BY THE TRACKER ITSELF.
 *
 * `MissionTracker` advances lifetime counters, completes missions and grants
 * unlocks. Three things now drive a match that must advance NONE of that:
 *
 *   - **A replay.** Watching a recording is not playing a match.
 *   - **A campaign operation.** A scripted operation's kill count is AUTHORED,
 *     so paying profile chains at authored rates is a farm.
 *   - Anything else that replays or simulates a match for measurement.
 *
 * WHY THIS IS NOT A CHECK IN `Shell`, AND THE BUG THAT PROVES IT
 * --------------------------------------------------------------
 * `Shell.startMatch` already refused to open a match for a replay, under a
 * nine-line comment saying so in terms. It did not work, and it has not worked
 * since the day the bus grew a `match:started` event: **`beginMatch` has two
 * callers.** `MissionTracker.attach` subscribes to `match:started` and opens a
 * match itself whenever none is open — and `game/outcome.system.ts` emits that
 * event edge-triggered on the shell entering `'playing'`, with no replay,
 * campaign or tutorial exclusion anywhere on the path. The shell's carve-out
 * skipped the direct call; one frame later the bus made it anyway.
 *
 * So watching a replay of a win advanced `matchesPlayed`, `wins`,
 * `currentStreak` and every kill/build/earn chain, in the shipped build, for as
 * long as replays have existed.
 *
 * The lesson generalises and it is why this file exists rather than a third
 * caller-side `if`: **a guard that lives at a call site cannot see a second
 * call site.** This latch is read by `beginMatch` and `endMatch` themselves, so
 * it is honoured no matter who calls them, in what order, from which module,
 * on which frame. That is the same argument `UnlockGate`'s `suppressed` flag
 * makes for the same reason — and this file is deliberately its twin: it
 * imports nothing, it is a module-level boolean, and it is checked before any
 * work happens rather than folded into a condition further down.
 *
 * TEST IT THROUGH THE BUS, NEVER THROUGH THE CALLER
 * -------------------------------------------------
 * `tests/progression-suppress.spec.ts` emits `match:started` on a real bus and
 * asserts `inMatch() === false`. A test that asserted "the shell skipped the
 * call" would have passed against the broken build — that is precisely how
 * this shipped, and re-writing the test in that shape re-arms it.
 *
 * WHOEVER SETS IT CLEARS IT
 * -------------------------
 * A latch with no clearing branch is a permanent behaviour change wearing a
 * temporary name; `suppressUnlockGate` leaked exactly once and left every later
 * skirmish ungated. `Shell.clearReplay` clears this on every exit from a
 * replay, and `Shell.startMatch` clears it for any ordinary launch on the same
 * line that restores the unlock gate.
 * ========================================================================== */

let suppressed = false;

/**
 * Turn profile progression off entirely (replay, campaign), or back on.
 *
 * While set, `MissionTracker.beginMatch` and `.endMatch` are no-ops. A match
 * left open when this is set stays open — the next unsuppressed `beginMatch`
 * abandons it, which is the documented recovery and the correct one.
 */
export function suppressProgression(on: boolean): void {
  suppressed = on;
}

/** True while the profile is deaf to match lifecycle. */
export function progressionSuppressed(): boolean {
  return suppressed;
}

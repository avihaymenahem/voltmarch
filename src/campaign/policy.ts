/**
 * ============================================================================
 * VOLTMARCH — src/campaign/policy.ts
 * ============================================================================
 * THE ONE THING THE SHIPPED OUTCOME RULES ARE ALLOWED TO ASK THE CAMPAIGN.
 *
 * It imports nothing but a type, so `src/game/outcome.system.ts` may reach it
 * statically without dragging the Director, the operation table or a single
 * word of prose into the entry chunk. That is the same reason `types.ts` is
 * shaped the way it is, and it is checked by
 * `tests/campaign-bundle-isolation.spec.ts` rather than trusted.
 *
 * ============================================================================
 * WHY THIS EXISTS: NOTHING DISARMS ANNIHILATION
 * ============================================================================
 * `Shell.pollOutcome` runs at 2 Hz for every match and, after a ten-second
 * grace, declares victory when every non-Neutral non-allied player has zero
 * living assets, and defeat at zero local assets. `outcome.system.ts` adds a
 * second route through `Viability`. Against a scripted operation that is four
 * reachable failures, all of them in shipped code:
 *
 *   - an eight-minute hold, WON AT MINUTE THREE because the garrison was
 *     cleared early;
 *   - a seat whose forces arrive at t+3 min and therefore holds zero assets at
 *     t+10 s — instant victory against an enemy who has not arrived;
 *   - a commando insertion that lands at t+30 s — instant DEFEAT at t+10 s for
 *     having no base;
 *   - a defecting militia, counted hostile forever.
 *
 * So an operation declares what may end it, and the default for a campaign is
 * neither. An operation that declares no authored win path AND no authored lose
 * path AND opts into neither of these is a match that cannot end, and
 * `validateCampaign` makes that a build error rather than a player's evening.
 *
 * ============================================================================
 * A MODULE-LEVEL LATCH, FOR THE REASON `UnlockGate` ALREADY DOCUMENTS
 * ============================================================================
 * Not an object installed on a registry, and not a duck-typed global. The
 * consumers are `Shell.pollOutcome` (render side, 2 Hz) and
 * `outcome.system.ts` (render side, every frame), and both need the answer
 * before any campaign module has necessarily been imported. A latch answers
 * whatever the boot order turns out to be — which is the argument
 * `suppressUnlockGate` makes for itself, having lost the other one.
 *
 * WHOEVER SETS IT CLEARS IT. `Shell.startOperation` sets; win, loss, retry,
 * abandon and quit all clear, on the same lines that clear the roster and both
 * progression latches. A latch with no clearing branch is a permanent
 * behaviour change wearing a temporary name, and this repo has shipped one.
 * ========================================================================== */

import type { OutcomePolicy } from './types';

/** What the shipped rules do when no operation is armed: exactly what they always did. */
const SKIRMISH: OutcomePolicy = {
  annihilationWin: true,
  assetLossDefeat: true,
  ignoreSeats: [],
};

let armed: OutcomePolicy | null = null;

/** Arm an operation's policy, or clear it. */
export function setCampaignOutcomePolicy(next: OutcomePolicy | null): void {
  armed = next;
}

/**
 * The policy in force. Never null — an unarmed session answers with the
 * skirmish rules, so a caller cannot forget to handle the ordinary case.
 */
export function outcomePolicy(): OutcomePolicy {
  return armed ?? SKIRMISH;
}

/**
 * True while an operation owns the session.
 *
 * `outcome.system.ts` ORs this with `tutorialRunning()` to make
 * `scriptedRunning()`, which buys three things at once: the stranded nag is
 * silenced for a squad that legally has no base, the asset-loss auto-defeat
 * stops firing on an operation that legally has no buildings, and the
 * all-enemies-dead auto-win stops pre-empting an objective the player has not
 * met yet.
 */
export function campaignRunning(): boolean {
  return armed !== null;
}

/** True when `seat` is invisible to both shipped outcome tests. */
export function seatIgnored(seat: number): boolean {
  const p = armed;
  if (p === null) return false;
  const list = p.ignoreSeats;
  for (let i = 0; i < list.length; i++) if (list[i] === seat) return true;
  return false;
}

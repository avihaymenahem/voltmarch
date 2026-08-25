/**
 * ============================================================================
 * VOLTMARCH — src/campaign/layout.ts
 * ============================================================================
 * WHAT AN OPERATION'S GROUND LOOKS LIKE, AND THE ONE THING IT OWES THE
 * TRIGGER TABLE.
 *
 * A layout is a `ScenarioBuilder` script — the same API `PLANS.skirmish.build`
 * uses, with the same primitives — plus a declared list of the TAGS it stamps.
 * That list is the contract: `validateCampaign` refuses an operation whose
 * triggers name a tag its layout does not produce, and it has to, because
 * `entityDead` reads TRUE before a tag has ever existed. A mistyped `protect`
 * would otherwise fail the player on tick one, silently, in the direction
 * nobody reports.
 *
 * **THE TAG LIST IS DECLARED, NOT DISCOVERED.** It would be possible to run
 * every layout headlessly and collect what it actually stamped — and that is
 * what `tests/campaign-maps.spec.ts` does, as a CHECK. It cannot be the source
 * of truth, because a layout that stamps a tag only on one branch (a seat that
 * is not always seated, a structure only placed on four-army maps) would then
 * validate on the seed that happens to run and fail on the one that ships.
 * Declaring it and verifying the declaration catches both directions.
 *
 * **A LAYOUT MAY NOT READ THE PROFILE, THE CLOCK OR THE DOM.** It runs inside
 * the world build, which is the tick-zero desync CLAUDE.md documents twice:
 * `Scenarios.ts` already calls `isBuildable` while spawning a starting army,
 * and that answers from the LOCAL profile. The campaign's answer is the
 * operation's authored roster, installed before the boot — so a layout gets
 * the same world on every machine by construction rather than by discipline.
 * ========================================================================== */

import type { EntityId, PlayerId } from '../core/types';
import type { ScenarioBuilder, StartCondition } from '../game/Scenarios';
import type { OperationDef } from './types';

/** What a layout is handed beyond the builder. */
export interface LayoutContext {
  readonly op: OperationDef;
  /**
   * Stamp a tag on something the layout just made.
   *
   * Silently ignores `NONE`, which is what `spawnUnit` and `spawnBuilding`
   * return when they refuse — so a layout does not have to check, and a tag
   * that ends up empty is caught by `campaign-maps.spec.ts` rather than by a
   * crash halfway through the build.
   */
  tag(name: string, id: EntityId): void;
  /** Seat index to `PlayerId`. Seat 0 is always the player. */
  seat(i: number): PlayerId;
  /** The opening this operation declared. `'force'` means: build no base. */
  readonly opening: OperationDef['map']['opening'];
}

export interface CampaignLayout {
  /** Matches `OperationDef.layout`. */
  readonly id: string;
  /** Every tag this layout stamps, on every path. */
  readonly tags: readonly string[];
  build(
    b: ScenarioBuilder, cx: number, cz: number, start: StartCondition, c: LayoutContext,
  ): void;
}

/** Sugar so a layout module reads as a declaration. */
export function layout(def: CampaignLayout): CampaignLayout {
  return def;
}

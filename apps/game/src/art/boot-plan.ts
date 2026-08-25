/**
 * Which faction art packs this engine boot can actually put on the field.
 *
 * The shell knows the seated factions before `bootstrap()` runs; the art
 * systems know how to build their own packs but deliberately know nothing about
 * lobbies, replays or campaigns. This tiny module is the channel between them.
 *
 * Null means "all factions" and is the safe default for screenshot fixtures,
 * tests and any future boot path that has not stated a plan. A product match
 * always writes an explicit set before the system registry starts.
 */

import { Faction } from '../core/types';

let planned: ReadonlySet<number> | null = null;

export function setPlannedArtFactions(factions: readonly Faction[] | null): void {
  planned = factions === null ? null : new Set(factions.map((f) => f as number));
}

export function isArtFactionPlanned(faction: Faction): boolean {
  return planned === null || planned.has(faction as number);
}

/** Test/diagnostic view. A copy so callers cannot mutate the live plan. */
export function plannedArtFactions(): readonly number[] | null {
  return planned === null ? null : [...planned].sort((a, b) => a - b);
}

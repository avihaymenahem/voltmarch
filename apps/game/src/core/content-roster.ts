import { Faction } from './types';

/**
 * Playable armies that can field defs authored in the shared Neutral pool.
 *
 * This is roster policy, not presentation policy. Production and art-provider
 * completeness both consume this single list so a fifth faction cannot acquire
 * shared gameplay content without also acquiring an exact render obligation.
 */
export const SHARED_POOL_FACTIONS: readonly Faction[] = [
  Faction.Allies,
  Faction.Soviets,
];

/** True when a def owned by `defFaction` belongs to `faction`'s live roster. */
export function contentDefReachableByFaction(
  defFaction: Faction,
  faction: Faction,
): boolean {
  return defFaction === faction
    || (defFaction === Faction.Neutral && SHARED_POOL_FACTIONS.includes(faction));
}

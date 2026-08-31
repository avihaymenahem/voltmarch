import { contentDefReachableByFaction } from '../core/content-roster';
import { EntityKind, type DefTables, type Faction } from '../core/types';
import {
  proveExactKindMeshBindings, type ExactKindMeshBinding,
} from '../render/RenderBridge';

/**
 * Prove the unit provider against the gameplay def table, never its art map.
 * Deleting an art-map row therefore leaves the corresponding def obligation
 * present and the provider pending.
 */
export function unitProviderBindingsReady(
  tables: DefTables | null,
  faction: Faction,
): boolean {
  if (tables === null) return false;
  const promised: ExactKindMeshBinding[] = [];
  for (let defId = 0; defId < tables.units.length; defId++) {
    const def = tables.units[defId];
    if (!contentDefReachableByFaction(def.faction, faction)) continue;
    promised.push({ kind: def.kind, faction, defId });
  }
  return proveExactKindMeshBindings(promised);
}

/** Building counterpart to `unitProviderBindingsReady`. */
export function buildingProviderBindingsReady(
  tables: DefTables | null,
  faction: Faction,
): boolean {
  if (tables === null) return false;
  const promised: ExactKindMeshBinding[] = [];
  for (let defId = 0; defId < tables.buildings.length; defId++) {
    const def = tables.buildings[defId];
    if (!contentDefReachableByFaction(def.faction, faction)) continue;
    promised.push({ kind: EntityKind.Building, faction, defId });
  }
  return proveExactKindMeshBindings(promised);
}

/**
 * ============================================================================
 * src/art/faction4.system.ts — the Reclamation's plugin entry point
 * ============================================================================
 * Thirty lines of glue and nothing else. All eleven hulls, all twelve
 * structures, all three palettes and every `registerKindMesh` call live in
 * `Faction4Units.ts` and `Faction4Buildings.ts`; this file exists only because
 * `src/game/Systems.ts` discovers modules by the `*.system.ts` glob and a
 * plain data module is never imported by anything. Without it the Reclamation
 * art is dead code and every one of its buildings is a magenta placeholder.
 *
 * It deliberately does NOT touch `units.system.ts` or `buildings.system.ts`:
 * the Reclamation's libraries are private, its atlases are private, and the
 * only shared surface it writes to is the bridge's model registry — which is a
 * module-level map that is valid before or after the bridge itself inits, so
 * there is no phase ordering to get wrong.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { BUILDING_GREEBLE, QUALITY_PRESETS, UNIT_GREEBLE } from '../core/config';
import type { QualityTier } from '../core/types';
import { ctx } from '../game/context';
import { resolveDefBinding } from '../game/Scenarios';
import { formatStats } from './MassList';
import { formatStructureStats } from './BuildingFactory';
import { buildAndRegisterReclaimUnits, disposeReclaimUnits } from './Faction4Units';
import { buildAndRegisterReclaimStructures, disposeReclaimBuildings } from './Faction4Buildings';

/** 256 on Low, 512 everywhere else: 1024 buys nothing at RTS unit size. */
function atlasSizeFor(tier: QualityTier, ceiling: number): number {
  const preset = QUALITY_PRESETS[tier] ?? QUALITY_PRESETS[2];
  return Math.min(ceiling, Math.max(256, preset.textureSize));
}

export default defineSystem({
  id: 'art.faction4',

  async init(): Promise<void> {
    const { loop } = ctx();
    const t0 = Date.now();

    // One binding resolve for both halves. `resolveDefBinding` is memoised, so
    // this is the same promise the other callers already share.
    const binding = await resolveDefBinding();

    // BOTH AT ONCE. Each half now prewarms its own atlas on a worker before it
    // builds anything, and those two waits are independent — the unit atlas and
    // the structure atlas come off different specs on different private
    // factories. Awaiting them in sequence would serialise two waits that the
    // pool is perfectly happy to serve in parallel.
    const [units, structures] = await Promise.all([
      buildAndRegisterReclaimUnits(
        atlasSizeFor(loop.quality, UNIT_GREEBLE.atlasSize), binding.unitId),
      buildAndRegisterReclaimStructures(
        atlasSizeFor(loop.quality, BUILDING_GREEBLE.atlasSize), binding.buildingId),
    ]);

    let unitTris = 0;
    for (const m of units.models) unitTris += m.stats.triangles;
    let structTris = 0;
    for (const m of structures.models) structTris += m.stats.triangles;

    console.info(
      `%c[reclaim]%c ${units.models.length} hulls (${unitTris} tris) + ` +
      `${structures.models.length} structures (${structTris} tris), ` +
      `${units.registrations + structures.registrations} bridge registrations, ` +
      `${Date.now() - t0} ms`,
      'color:#c46ff0', 'color:inherit',
    );
    for (const m of units.models) console.info(`[reclaim] ${formatStats(m.stats)}`);
    for (const m of structures.models) console.info(`[reclaim] ${formatStructureStats(m.stats)}`);
    for (const f of units.failed) console.error(`[reclaim] REJECTED ${f}`);
    for (const f of structures.failed) console.error(`[reclaim] REJECTED ${f}`);

    if (units.bound === 0 || structures.bound === 0) {
      console.warn(
        '[reclaim] no Reclamation def ids resolved, so the army art is built but nothing on the ' +
        'map can reference it. src/data/Defs.ts is what publishes those keys.');
    }
  },

  dispose(): void {
    disposeReclaimUnits();
    disposeReclaimBuildings();
  },
});

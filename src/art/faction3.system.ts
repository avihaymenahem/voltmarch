/**
 * ============================================================================
 * src/art/faction3.system.ts — the Meridian Pact's plugin entry point
 * ============================================================================
 * Thin boot glue and nothing else. All sixteen hulls, all fifteen
 * structures, both palettes and every `registerKindMesh` call live in
 * `Faction3Units.ts` and `Faction3Buildings.ts`; this file exists only because
 * `src/game/Systems.ts` discovers modules by the `*.system.ts` glob and a
 * plain data module is never imported by anything.
 *
 * The Pact's procedural libraries and atlases stay private. Its first imported
 * building wave deliberately reuses the shared imported-structure loader for
 * KTX2, LOD and caster policy, then publishes the result through the same
 * bridge registry as every procedural fallback.
 * ============================================================================
 */

import { defineSystem } from '../core/loop';
import { BUILDING_GREEBLE, QUALITY_PRESETS, UNIT_GREEBLE } from '../core/config';
import type { QualityTier } from '../core/types';
import { ctx } from '../game/context';
import { resolveDefBinding } from '../game/Scenarios';
import { formatStats } from './MassList';
import { formatStructureStats } from './BuildingFactory';
import { buildAndRegisterMeridianUnits, disposeMeridianUnits } from './Faction3Units';
import { buildAndRegisterMeridianStructures, disposeMeridianBuildings } from './Faction3Buildings';

/** 256 on Low, 512 everywhere else: 1024 buys nothing at RTS unit size. */
function atlasSizeFor(tier: QualityTier, ceiling: number): number {
  const preset = QUALITY_PRESETS[tier] ?? QUALITY_PRESETS[2];
  return Math.min(ceiling, Math.max(256, preset.textureSize));
}

export default defineSystem({
  id: 'art.faction3',

  async init(): Promise<void> {
    const { loop } = ctx();
    const t0 = Date.now();

    // One binding resolve for both halves. `resolveDefBinding` is memoised, so
    // this is the same promise the other seven callers already share.
    const binding = await resolveDefBinding();

    // BOTH AT ONCE. Each half now prewarms its own atlas on a worker before it
    // builds anything, and those two waits are independent — the unit atlas and
    // the structure atlas come off different specs on different private
    // factories. Awaiting them in sequence would serialise two waits that the
    // pool is perfectly happy to serve in parallel.
    const [units, structures] = await Promise.all([
      buildAndRegisterMeridianUnits(
        atlasSizeFor(loop.quality, UNIT_GREEBLE.atlasSize), binding.unitId),
      buildAndRegisterMeridianStructures(
        atlasSizeFor(loop.quality, BUILDING_GREEBLE.atlasSize), binding.buildingId),
    ]);

    let unitTris = 0;
    for (const m of units.models) unitTris += m.stats.triangles;
    let structTris = 0;
    for (const m of structures.models) structTris += m.stats.triangles;

    console.info(
      `%c[meridian]%c ${units.models.length} hulls (${unitTris} tris) + ` +
      `${structures.models.length} structures (${structTris} tris), ` +
      `${structures.imported} imported structure overrides, ` +
      `${units.registrations + structures.registrations} bridge registrations, ` +
      `${Date.now() - t0} ms`,
      'color:#3ec9a7', 'color:inherit',
    );
    for (const m of units.models) console.info(`[meridian] ${formatStats(m.stats)}`);
    for (const m of structures.models) console.info(`[meridian] ${formatStructureStats(m.stats)}`);
    for (const f of units.failed) console.error(`[meridian] REJECTED ${f}`);
    for (const f of structures.failed) console.error(`[meridian] REJECTED ${f}`);

    if (units.bound === 0 || structures.bound === 0) {
      console.warn(
        '[meridian] no Meridian def ids resolved, so the Pact art is built but nothing on the map ' +
        'can reference it. src/data/Defs.ts is what publishes those keys.');
    }
  },

  dispose(): void {
    disposeMeridianUnits();
    disposeMeridianBuildings();
  },
});

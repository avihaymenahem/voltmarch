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
import { Faction, type QualityTier } from '../core/types';
import { ctx } from '../game/context';
import { plannedScenario, resolveDefBinding } from '../game/Scenarios';
import { formatStats } from './MassList';
import { formatStructureStats } from './BuildingFactory';
import {
  buildAndRegisterReclaimUnits, disposeReclaimUnits, RECLAIM_UNIT_MASS_LISTS,
} from './Faction4Units';
import {
  buildAndRegisterReclaimStructures, disposeReclaimBuildings,
  RECLAIM_STRUCTURE_MASS_LISTS,
} from './Faction4Buildings';
import { isArtFactionPlanned } from './boot-plan';
import { liveAssetStreamingEnabled, scheduleBattlefieldWork } from '../core/battlefield-ready';
import { contentClosureEpoch, markContentProviderReady } from '../core/content-closure';
import {
  buildingProviderBindingsReady, unitProviderBindingsReady,
} from './provider-readiness';

const MCV_UNIT_IMPORTS: ReadonlySet<string> = new Set(['reclaim_crawler']);
const MCV_STRUCTURE_IMPORTS: ReadonlySet<string> = new Set(['reclaim_foundry']);
let deferredEpoch = 0;
let cancelDeferredWork: (() => void) | null = null;

/** 256 on Low, 512 everywhere else: 1024 buys nothing at RTS unit size. */
function atlasSizeFor(tier: QualityTier, ceiling: number): number {
  const preset = QUALITY_PRESETS[tier] ?? QUALITY_PRESETS[2];
  return Math.min(ceiling, Math.max(256, preset.textureSize));
}

export default defineSystem({
  id: 'art.faction4',
  initGroup: 'faction-art',

  async init(): Promise<void> {
    if (!isArtFactionPlanned(Faction.Reclaim)) {
      console.info('[reclaim] art pack skipped — no Reclamation seat in this boot');
      return;
    }
    const { loop } = ctx();
    const closureEpoch = contentClosureEpoch();
    const t0 = Date.now();

    // One binding resolve for both halves. `resolveDefBinding` is memoised, so
    // this is the same promise the other callers already share.
    const binding = await resolveDefBinding();
    const fastMcvBoot = plannedScenario().start === 'mcv'
      && liveAssetStreamingEnabled()
      && (typeof location === 'undefined'
        || new URLSearchParams(location.search).get('privateassetstream') !== 'off');

    // BOTH AT ONCE. Each half now prewarms its own atlas on a worker before it
    // builds anything, and those two waits are independent — the unit atlas and
    // the structure atlas come off different specs on different private
    // factories. Awaiting them in sequence would serialise two waits that the
    // pool is perfectly happy to serve in parallel.
    const [units, structures] = await Promise.all([
      buildAndRegisterReclaimUnits(
        atlasSizeFor(loop.quality, UNIT_GREEBLE.atlasSize), binding.unitId,
        fastMcvBoot ? MCV_UNIT_IMPORTS : undefined),
      buildAndRegisterReclaimStructures(
        atlasSizeFor(loop.quality, BUILDING_GREEBLE.atlasSize), binding.buildingId,
        fastMcvBoot ? MCV_STRUCTURE_IMPORTS : undefined),
    ]);

    const streamers = [structures.streamRemaining, units.streamRemaining].filter(
      (stream): stream is NonNullable<typeof stream> => stream !== undefined,
    );
    if (streamers.length > 0) {
      const epoch = ++deferredEpoch;
      cancelDeferredWork = scheduleBattlefieldWork(40, async () => {
        cancelDeferredWork = null;
        for (const stream of streamers) {
          if (epoch !== deferredEpoch) return;
          await stream(() => epoch === deferredEpoch);
        }
      });
    }

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

    if (units.failed.length === 0
      && unitProviderBindingsReady(binding.tables, Faction.Reclaim)
      && units.models.length === RECLAIM_UNIT_MASS_LISTS.length) {
      markContentProviderReady('art-unit/4', closureEpoch);
    }
    if (structures.failed.length === 0
      && buildingProviderBindingsReady(binding.tables, Faction.Reclaim)
      && structures.models.length === RECLAIM_STRUCTURE_MASS_LISTS.length) {
      markContentProviderReady('art-building/4', closureEpoch);
    }
  },

  dispose(): void {
    deferredEpoch++;
    cancelDeferredWork?.();
    cancelDeferredWork = null;
    disposeReclaimUnits();
    disposeReclaimBuildings();
  },
});

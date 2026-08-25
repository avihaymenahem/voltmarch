/**
 * ============================================================================
 * VOLTMARCH — src/world/terrain-plan.ts
 * ============================================================================
 * WHAT MAP THIS BOOT IS ABOUT TO GENERATE, decided in ONE place.
 *
 * Two callers need that answer and they run at different moments:
 *
 *   `src/core/workers/world-warm.ts`  at module-discovery time, so it can hand
 *                                     the generation to a worker before any
 *                                     system's `init()` has run.
 *   `src/world/terrain.system.ts`     at `Phase.Command` order 40, when it
 *                                     actually constructs the `Terrain`.
 *
 * If those two disagree by so much as a start offset, the prewarmed fields are
 * for a different map. That failure would be SILENT — `terrainGenKey` would
 * miss, the terrain would generate on the main thread, and the only symptom
 * would be a boot that is exactly as slow as it used to be. So the derivation
 * lives here, is memoised, and both sides call it. Neither one re-derives
 * anything.
 *
 * MEMOISED, and that is load-bearing rather than an optimisation: the warm and
 * the system must see the same answer even though `?mapseed=` parsing and
 * `plannedScenario()` are both perfectly capable of being called twice.
 * ============================================================================
 */

import { TERRAIN_DEFAULT_BIOME, TERRAIN_SEED } from '../core/config';
import { plannedScenario, plannedStartPoints } from '../game/Scenarios';
import { BIOME_NAMES, isBiomeName, type BiomeName } from './Biomes';
import type { TerrainGenOptions } from './terrain-gen';

/** Read `?biome=desert` so a critic can A/B all four presets from the URL. */
function biomeFromUrl(): BiomeName {
  if (typeof location === 'undefined') return TERRAIN_DEFAULT_BIOME as BiomeName;
  const q = new URLSearchParams(location.search).get('biome');
  if (q !== null && isBiomeName(q)) return q;
  if (q !== null) {
    console.warn(`[terrain] ?biome=${q} is not one of ${BIOME_NAMES.join(', ')}`);
  }
  return TERRAIN_DEFAULT_BIOME as BiomeName;
}

/** Read `?mapseed=` so a bad landform roll can be reproduced or skipped. */
function seedFromUrl(fallback: number): number {
  if (typeof location === 'undefined') return fallback;
  const q = new URLSearchParams(location.search).get('mapseed');
  if (q === null) return fallback;
  const n = Number(q);
  return Number.isFinite(n) ? n | 0 : fallback;
}

let cached: TerrainGenOptions | null = null;

/**
 * The generation inputs for this boot.
 *
 * RESERVE A SHELF WHERE THE ARMIES ACTUALLY LAND.
 *
 * This option existed and nothing ever passed it, so the generator fell back to
 * `TERRAIN_START_POSITIONS` — a single entry at the map centre.
 * `levelStartAreas()` then flattened, ramped and pocket-filled a perfect
 * 100%-buildable disc 96.5 m from either army, against a guard radius of 54.
 * Both armies stood on ungraded ground, measured at 60-74% buildable with about
 * a third of openings under 60%, while config.ts promised "verified inside the
 * generator, not hoped for".
 *
 * THE CENTRE STAYS, and is listed first. Every `?shot=` fixture builds on the
 * map centre; dropping it would put twelve graded frames on ungraded ground and
 * their structures would relocate via `connectedGround`, moving the shots more
 * than the terrain change itself.
 *
 * The three discs OVERLAP — starts are 96.5 m out and TERRAIN_START_FLAT_RADIUS
 * is 58, so 58 + 58 > 96.5 — which is why this was deferred once as an
 * unverified risk of steps at the seams. `levelStartAreas` mutates the
 * heightfield as it goes, so each disc sees the previous one's flattening and
 * they self-stabilise; `tests/start-shelves.spec.ts` measures the seam directly
 * across four biomes and three seeds rather than trusting that.
 *
 * THE SEA is read from `plannedScenario()` rather than from the `setPlannedSea`
 * channel, because that channel is filled by `world.sea`'s `init()` — which has
 * not run when the prewarm needs an answer. `sea.system.ts` fills it from the
 * same `plannedScenario().sea`, so the two agree by construction; and if they
 * ever stopped agreeing, `terrainGenKey` would miss and the map would generate
 * on the main thread rather than come out wrong.
 *
 * THE START LIST IS NO LONGER BUILT HERE. It used to spread
 * `SKIRMISH_START_OFFSETS` inline, which was right while that table held
 * exactly the two armies a skirmish seats and became wrong the moment it held
 * four: appending two entries would have reserved two EXTRA levelled shelves on
 * every map in the game, changing the heightfield of both naval presets, all
 * twelve `?shot=` fixtures and every landlocked seed — for a mode nothing has
 * selected. `Scenarios.plannedStartPoints()` takes the army count and the sea
 * and answers both cases, including the archipelago, where the map centre must
 * NOT be reserved because it is open water.
 */
export function plannedTerrainInput(): TerrainGenOptions {
  if (cached !== null) return cached;
  cached = {
    seed: seedFromUrl(TERRAIN_SEED),
    biome: biomeFromUrl(),
    starts: plannedStartPoints(),
    sea: plannedScenario().sea,
  };
  return cached;
}

/** Drop the memo so the next boot re-reads the settled query. See `Shell.bootGame`. */
export function resetTerrainPlan(): void {
  cached = null;
}

/**
 * ============================================================================
 * VOLTMARCH — src/world/Scatter.ts
 * ============================================================================
 * PROP SCATTER. The system that decides terrain is a place instead of a plane.
 *
 * Bible §14 R3, severity FATAL:
 *   "Terrain is a big empty plane. Prop scatter is always the last system
 *    written and the first cut. RA3's city reference carries 106 discrete props
 *    on 1.3 hectares; a procedural remake ships 8 rocks.
 *    Mitigation: implement the 25x25 m ship-blocking rule as an automated map
 *    validator that rasterises adornment coverage and fails the map if any
 *    empty patch exceeds it."
 *
 * That mitigation is `validateCoverage()`, and `generate()` runs it in a loop
 * and fills what it reports. It is a gate, not a guideline.
 *
 * FIVE THINGS THIS FILE GETS RIGHT
 * --------------------------------
 * 1. DENSITY IS A BUDGET, NOT AN ACCIDENT. Ruling #9 / §6.6: city >= 105/ha,
 *    wilderness >= 260/ha, measured against ADORNABLE ground (water, cliff,
 *    road and base footprints are out of the numerator AND the denominator).
 *    A 512 m map is 26.2 ha, so wilderness means ~6800 props. That is fine,
 *    because of (2).
 *
 * 2. ONLY THE VISIBLE INSTANCES. Props are bucketed into 32 m chunks and the
 *    chunk set is frustum tested every frame. Both renderers keep one
 *    InstancedMesh per type and repack its visible prefix. An older WebGPU path
 *    packed the types into two BatchedMeshes to reduce cold pipeline creation,
 *    but r185 implements BatchedMesh as one draw command PER VISIBLE INSTANCE:
 *    343 draws for one prop batch on `soviet-base`, versus at most 30 typed
 *    instanced draws. It remains behind `?scatterbatch=legacy` for measured A/B
 *    runs and is never the normal runtime path.
 *
 *    On WebGL that remains ONE colour draw per type, plus one shadow draw if the type clears
 *    `SCATTER_SHADOW_MIN_RADIUS` and has not explicitly opted out as low ground
 *    cover. Every type clears the radius gate; the two grass types and flower
 *    bed are authored non-casters because their shadow contribution is sub-pixel.
 *    TWO submissions per type, not three: this said three because a scatter
 *    mesh is opaque on the DEFAULT layer and `GTAOPass` used to draw the whole
 *    scene again for its normal G-buffer. `installAoDepthGBuffer`
 *    (`src/render/post.ts`) now reconstructs those normals from the depth the
 *    colour pass already wrote, `_renderGBuffer` is false, and that submission
 *    is gone — `ao` is 0 on all thirteen fixtures in `shots/_report.json`.
 *    Read `SCATTER_LIMITS.maxTypes` for the rest of the arithmetic.
 *
 * 3. CLUSTERED, NEVER UNIFORM. Bible §6.5: "3-9 trees per clump, 4-8 m spacing
 *    inside, 20-50 m between clumps. Street rows are regular at 8-12 m pitch,
 *    1.5-2.5 m off the kerb." A uniform Poisson disc is the instant prototype
 *    tell, so trees come in copses, rocks in fields, and street furniture is
 *    laid along traced kerb polylines at a regular pitch.
 *
 * 4. PER-INSTANCE JITTER IS MANDATORY (scorecard #39). Scale 0.80-1.25x, free
 *    yaw, +/-4 degrees tilt, and a hue/value/saturation shift delivered through
 *    `instanceColor`. The colour multiplier is solved in LINEAR space against
 *    the type's dominant tone so a requested "+6 degrees hue, -9% value" lands
 *    where it was asked for instead of just dimming everything.
 *
 * 5. MASKS. Nothing spawns on water, on a cliff, on a road surface it does not
 *    belong on, inside a structure footprint, or inside an exclusion a
 *    scenario asked for. Street furniture spawns BESIDE roads, never on them.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It never writes `passGrid`, `costGrid` or the occupancy grid. Terrain owns
 * those (loop.ts's write-ownership table). Props that would physically block a
 * tank are published through `blockers()` for whoever owns navigation, and in
 * the meantime `blocksNav` props are kept off the walkable interior of clumps.
 *
 * CLEARING (§3.11)
 * ----------------
 * A structure that lands on a copse must fell it, and it must do so without
 * rebuilding seven thousand matrices. `clearFootprint()` is the door:
 *
 *   - it finds candidates through the 4 m cell index, so the scan is
 *     proportional to LOCAL prop density, never to the map's prop count;
 *   - it removes each hit with a swap-against-the-last-live-instance INSIDE
 *     that instance's own 32 m chunk slice, so `chunkStart` never moves and the
 *     cost is exactly one 16-float + 3-float copy per felled prop;
 *   - the surviving placement is a tombstone in the placement list, so every
 *     index the GPU buffers hold stays valid. `propCount` reports live props.
 *
 * There are two callers, and they ask different questions of the same index:
 *
 *   `src/world/scatter-clear.system.ts` listens to `building:placed` and turns
 *   the footprint into a RECTANGLE — `clearFootprint()`, canopy-radius test.
 *
 *   `src/sim/Crush.ts` turns a driving hull into a DISC — `crushDisc()`,
 *   footprint-radius test, and only the soft families. See the two methods'
 *   own comments for why those tests are deliberately not the same one.
 *
 * BOTH ARE PERSISTED, AS ONE BIT PER PLACEMENT. Terrain, roads and props are
 * regenerated from the seed, so a load puts every felled prop back unless the
 * file says otherwise. `SaveGame` used to close only half of that — it replayed
 * the building footprints and had nothing for the hull crush, so a trail a
 * player mowed through a wood grew back. §3.10b is the answer: `felledMask()`
 * hands out the placement list's own alive bits and `applyFelledMask()` puts
 * them back, which covers BOTH clears with one bounded blob and needs no ledger
 * of events on either side. See that section for the measurements.
 * ============================================================================
 */

import * as THREE from 'three';
import { nodePath, type PropMaterialSetLike } from '../render/gpu-path';

import {
  CELL, MAP_CELLS, MAP_SIZE, MAP_CELL_COUNT,
  SCATTER_CHUNK_METRES, SCATTER_CLUSTER, SCATTER_COVERAGE, SCATTER_DENSITY,
  SCATTER_JITTER, SCATTER_LIMITS,
} from '../core/config';
import { clamp, clamp01, DEG2RAD, fbm2, Rng, smoothstep, TAU } from '../core/math';
import { SurfaceId, type BiomeName } from './Biomes';
import { PASS_GROUND, type Terrain } from './Terrain';
import { getRoads, isCarriageway, type RoadFurnitureRun } from './Roads';
import { DecalKind, type DecalField } from './Decals';
import { isFaultyLampAt } from './prop-life';
import {
  roadsideLayoutFor, roadsideRunAllows, type RoadsideLayout,
} from './roadside-layout';
import {
  createPropMaterial, PropLibrary, PROP_DEFS, propPalette,
  type PropDef, type PropFamily, type PropGeometry, type PropMaterialSet, type PropPalette,
} from './PropLibrary';
/*
 * FROM `prop-wind.ts`, NOT FROM `PropNodeMaterial.ts`, and that is the whole
 * reason the name lives in the shared table. `PropNodeMaterial` imports
 * `three/webgpu`, and `Scatter` is in the main bundle — reaching for the
 * constant there would drag the entire node system into the WebGL build for a
 * renderer those players will never run. Same rule as the note at the foot of
 * `TerrainNodeMaterial.ts`; `tests/render-backend.spec.ts` is the gate.
 */
import { PROP_WIND, PROP_WIND_PHASE_ATTRIBUTE } from './prop-wind';
import {
  FoliageEngine, type EnvironmentGeometryFamily, type FoliagePresentation,
} from './FoliageEngine';

/**
 * Same-build A/B switch for the retired WebGPU BatchedMesh scatter path.
 * Exported so a regression test can prove that an ordinary production URL
 * always selects hardware instancing without constructing a renderer.
 */
export function usesLegacyScatterBatch(nodeBackend: boolean, search: string): boolean {
  return nodeBackend && new URLSearchParams(search).get('scatterbatch') === 'legacy';
}

/** Same-build visual/performance A/B for authored low-cover shadow filtering. */
export function usesLegacyScatterShadows(search: string): boolean {
  return new URLSearchParams(search).get('scattershadow') === 'legacy';
}

/**
 * Align a street prop to the traced kerb tangent.
 *
 * Most street props author their forward/long axis on local +Z. The clipped
 * hedge is deliberately a long box on local +X, matching both its procedural
 * fallback and imported delivery. Applying the generic yaw to it presents the
 * narrow end to the road and makes a 3.8 m hedge read as a thin post.
 */
export function streetPropYaw(
  key: string,
  tangentX: number,
  tangentZ: number,
  jitter = 0,
): number {
  const localZAlongTangent = Math.atan2(tangentX, tangentZ);
  return localZAlongTangent + (key === 'hedge' ? -Math.PI * 0.5 : 0) + jitter;
}

/* ==========================================================================
 * 1. CONSTANTS AND SMALL TYPES
 * ========================================================================== */

/** Chunks per axis. 512 / 32 = 16, so 256 chunks. */
export const CHUNK_N = Math.max(1, Math.round(MAP_SIZE / SCATTER_CHUNK_METRES));
export const CHUNK_COUNT = CHUNK_N * CHUNK_N;

/** Coverage raster resolution. 512 / 2 = 256 cells per axis. */
export const COVER_N = Math.max(1, Math.round(MAP_SIZE / SCATTER_COVERAGE.gridMetres));
const COVER_COUNT = COVER_N * COVER_N;
/**
 * A patch STRICTLY LARGER than 25 m fails, so the smallest failing square is
 * one raster cell past 25 m: 13 cells at 2 m = 26 m.
 */
const PATCH_CELLS =
  Math.floor(SCATTER_COVERAGE.patchMetres / SCATTER_COVERAGE.gridMetres) + 1;

/**
 * Metres of hard clearance kept around a structure footprint when props are
 * felled for it.
 *
 * The test is not "is the trunk inside the rectangle" — it is "does the prop's
 * VISUAL disc (`boundRadius * scale`, which for an 11 m tree is its canopy, not
 * its trunk) overlap the footprint grown by this margin". A tree one centimetre
 * outside the wall whose crown sits on the roof therefore goes, which is the
 * only reading that does not look broken.
 *
 * 1.25 m is deliberately under a third of a 4 m cell: enough that a wall never
 * grazes a bush, not so much that a structure strips the ground cover out of
 * the cells around it and leaves a bald ring.
 */
export const PROP_CLEAR_MARGIN = 1.25;

/**
 * Bounding-sphere radius below which a prop TYPE stops casting a shadow.
 *
 * This is the gate `PROP_SHADOW_MIN_RADIUS` in src/render/RenderBridge.ts asks
 * for in its own comment — "src/world/Scatter.ts ... should apply the same gate
 * there" — applied to the far larger scattered population. The argument is that
 * one: the shadow camera is fitted to a `farExtent` of 320 m over a 2048-texel
 * map, so 0.70 m of radius is one to three texels of shadow map, a bilinear
 * smudge that is sub-pixel at the RTS camera. A caster costs a whole extra
 * instanced draw, and at `SCATTER_LIMITS.maxTypes` = 30 that is up to 30 of
 * them.
 *
 * IT IS A SECOND COPY OF THE NUMBER, and that is a known wart: RenderBridge
 * does not export it, and a world module must not import the render bridge to
 * read a scalar. If it is ever rehomed to config.ts, delete this and import it.
 *
 * WHAT IT ACTUALLY SAVES TODAY IS NOTHING, AND THAT IS THE HONEST FIGURE.
 * Measured 2026-08-17 over all four biomes, the smallest geometry in
 * `PROP_DEFS` is `bench` at 1.18 m of sphere radius — every one of the 31 prop
 * types clears 0.70 m with room to spare, so no shadow draw is removed from the
 * shipped roster. This is an invariant that binds the next small prop somebody
 * authors, not a saving. Do not quote it as a draw-call improvement.
 *
 * The test is the UNSCALED radius even though instances are jittered
 * 0.80-1.25x (`SCATTER_JITTER`): the gate is per InstancedMesh and therefore
 * all-or-nothing, and 1.0 sits inside that band, so the unscaled figure is the
 * nominal instance rather than the best or worst case.
 */
export const SCATTER_SHADOW_MIN_RADIUS = 0.70;

/**
 * True when this type is big enough for its shadow to survive the cascade.
 *
 * Reads `boundSphereRadius`, not `boundRadius`: the latter is the XZ half-
 * extent, and a telegraph pole is 1.25 m across, 9.5 m tall, and throws a 14 m
 * line at the bible's 33-degree sun. Gating on the flat measure would delete
 * exactly the shadows that read best.
 */
function typeCastsShadow(def: PropDef, geo: PropGeometry, legacy: boolean): boolean {
  return (legacy || def.castsShadow !== false)
    && geo.boundSphereRadius >= SCATTER_SHADOW_MIN_RADIUS;
}

/**
 * The scatter families a vehicle hull is allowed to flatten.
 *
 * This is the SCATTER half of one rule the entity props already state in
 * `Scenarios.FALLBACK_PROPS`: `tree`/`pine`/`bush` carry `EntityFlag.Crushable`
 * and `rock`/`boulder` carry NEITHER that nor anything else. Instanced props
 * have no entity, no flags and no HP to hang that on, so the equivalent signal
 * here is `PropDef.family` — which is authored, already correct, and not a
 * parallel notion invented for this.
 *
 * The premise moved and the conclusion did not. Rock used to be excluded here
 * because it carried `EntityFlag.BlocksNav` instead — it was solid, so it could
 * not also be soft. It is neither now, and the exclusion still stands on its
 * own footing: this set decides what a hull MOWS, and a boulder that dissolves
 * under a tank reads as a missing collision rather than as strength. Adding
 * 'rock' here would permanently clear the instanced rock carpet, which is a
 * content change and not a physics one.
 *
 * WHY NOT 'grass'. Grass is the density workhorse: `SCATTER_DENSITY`'s
 * 260/ha wilderness target (bible ruling #9) is mostly grass tufts, and
 * clearing is PERMANENT. Mowing it would carve bald trails along every ore
 * route and every attack lane and walk the map's measured prop density
 * downward for the rest of the match. A tank driving over long grass and
 * leaving it standing is also simply what long grass does.
 *
 * WHY NOT 'rock', 'yard', 'street' or 'civic'. Boulders, shipping containers,
 * parked cars, telegraph poles and benches are the scene's STRUCTURE. A
 * harvester that dissolves a 3.4 m container reads as a missing collision, not
 * as strength.
 */
const CRUSHABLE_FAMILIES: ReadonlySet<PropFamily> = new Set<PropFamily>(['canopy', 'shrub']);

/** True if a crusher may flatten scatter props of this family. */
export function isCrushableFamily(family: PropFamily): boolean {
  return CRUSHABLE_FAMILIES.has(family);
}

/* --------------------------------------------------------------------------
 * `MapPreset.props` IS READ BY TWO SYSTEMS THAT DO NOT SHARE A KEY NAMESPACE.
 *
 * The field is authored in the ENTITY-prop vocabulary, and that is the older
 * and the stricter of its two readers:
 *
 *   1. `ScenarioBuilder.scatter()` (`src/game/Scenarios.ts`) resolves it
 *      against `FALLBACK_PROPS`, whose eight keys are `tree pine bush rock
 *      boulder barrel crate wreck`. An unknown key there is not ignored —
 *      `spawnProp` warns and returns `NONE`, and `scatter()` RETURNS on the
 *      first `NONE`, so one bad string empties the whole entity dressing pass.
 *   2. This module resolves it against `PROP_DEFS`, whose thirty-one keys are
 *      the instanced archetypes: `tree treeAutumn conifer palm bush hedge
 *      grassTuft ... crateStack ... rockCluster`.
 *
 * The two tables share exactly FOUR names — `tree`, `bush`, `barrel`,
 * `boulder`. Every other entry in every preset list was silently inert here,
 * because the lookup was a bare `preferred.indexOf(def.key)`:
 *
 *      'rock'   in all seven presets   -> no def key
 *      'pine'   in temperate, tropical, snow
 *      'crate'  in urban
 *
 * ELEVEN OF THE TWENTY-EIGHT ENTRIES DID NOTHING. The obvious repair — rename
 * them to `rockCluster`/`conifer`/`crateStack` — is the one repair that must
 * NOT be made: it fixes reader 2 by breaking reader 1, and reader 1 is the one
 * `tests/start-clearance.spec.ts` exercises. On `snow`, where `pine` sits at
 * index 0 and the entity picker is weighted `-log2(1-u)` so index 0 comes up
 * about half the time, the very first draw would abort the pass.
 *
 * So the translation lives HERE, where the second namespace lives, and the
 * preset table keeps speaking the vocabulary its first reader requires. A
 * preference entry matches, in order:
 *
 *   - a def KEY exactly            ('bush' -> bush, 'boulder' -> boulder)
 *   - a def FAMILY exactly         ('rock' -> boulder + rockCluster)
 *   - an alias below               ('pine' -> conifer, 'crate' -> crateStack)
 *
 * `resolvePreference` returns the FIRST rank that matches, so a list naming
 * both 'rock' and 'boulder' ranks boulder by the earlier of the two.
 * ------------------------------------------------------------------------ */

/**
 * Entity-prop key -> the instanced archetypes it names. Only for entries that
 * are neither a def key nor a family; everything else resolves without help.
 *
 * `tree` IS a def key and still appears here, because the entity table has ONE
 * broadleaf and this roster has two — `tree` and its off-season twin
 * `treeAutumn`. Boosting only the summer one is what drove the autumn share to
 * 5.7% against bible §6.5's "70% one season, 30% off-colour": the biome weights
 * are already authored at 1.00/0.42, i.e. 29.6% autumn, and the preference
 * multiplier was landing on one half of the pair and wrecking the ratio the
 * table had got right. Boosting both restores it by construction.
 */
const PREFERENCE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  tree: ['tree', 'treeAutumn'],
  pine: ['conifer'],
  crate: ['crateStack'],
};

/**
 * Rank of `def` in `preferred`, or -1. Lower is stronger; see the block above.
 */
function preferenceRank(def: PropDef, preferred: readonly string[]): number {
  for (let i = 0; i < preferred.length; i++) {
    const p = preferred[i];
    if (p === def.key || p === def.family) return i;
    const alias = PREFERENCE_ALIASES[p];
    if (alias !== undefined && alias.indexOf(def.key) >= 0) return i;
  }
  return -1;
}

/**
 * True when `key` names at least one archetype in this roster.
 *
 * Exported so a test can assert the contract in the block above — that every
 * string in every `MAP_PRESETS[...].props` resolves in BOTH namespaces — rather
 * than leaving it to the next person to rediscover by reading two files.
 */
export function preferenceResolves(key: string): boolean {
  for (let i = 0; i < PROP_DEFS.length; i++) {
    if (preferenceRank(PROP_DEFS[i], [key]) >= 0) return true;
  }
  return false;
}

/**
 * The preference multiplier for rank `r`, and it is a LEAN, NOT A LANDSLIDE.
 *
 * This was `3 / (r + 1) + 1` — x4.00, x2.50, x2.00, x1.75 over a four-entry
 * list. That curve was tuned while ELEVEN of the twenty-eight entries were
 * inert, so in practice it was quadrupling one or two types per preset and the
 * rest of the list was decoration. Honouring the whole list at x4 would have
 * spent the budget even harder on even fewer archetypes — the exact opposite of
 * what a preference list is for on a map that is trying to look varied.
 *
 * Measured on the shipped presets, x4.00/x2.50/x2.00/x1.75 applied to a fully
 * resolving list roughly doubles the rock family (9.8% -> ~18% on temperate)
 * against a standing instruction not to: "reduce the number of boulders and
 * rocks by at least 30% all around, they spawn way too much" is why the rock
 * biome weights were cut 35% in the first place (`PROP_DEFS`, rock block).
 *
 * So the curve is halved in strength: `1 + 1.5 / (r + 1)` — x2.50, x1.75,
 * x1.50, x1.38. The preset still gets what it asked for, in the order it asked
 * for it, without the top entry eating the map.
 */
function preferenceMultiplier(rank: number): number {
  return 1 + 1.5 / (rank + 1);
}

export interface EmptyPatch {
  /** Centre of the offending square, world metres. */
  readonly x: number;
  readonly z: number;
  /** Side length, metres. */
  readonly size: number;
}

export interface CoverageReport {
  /** Adorned walkable cells / walkable cells, 0..1. Bible §6.6 wants >= 0.55. */
  readonly adornedFraction: number;
  /** Walkable hectares — the denominator for the density figures. */
  readonly walkableHectares: number;
  /** Props per hectare actually achieved. */
  readonly propsPerHectare: number;
  /** Every fully-unadorned walkable square of >25 m found, non-overlapping. */
  readonly emptyPatches: readonly EmptyPatch[];
  /** True when the map satisfies scorecard #15. */
  readonly passes: boolean;
}

export interface ScatterStats {
  readonly props: number;
  readonly types: number;
  readonly triangles: number;
  readonly visibleInstances: number;
  readonly visibleChunks: number;
  readonly drawCalls: number;
  readonly generateMs: number;
  readonly propsPerHectare: number;
  readonly adornedFraction: number;
  readonly emptyPatches: number;
}

export interface ScatterOptions {
  readonly scene: THREE.Scene;
  readonly terrain: Terrain;
  readonly biome: BiomeName;
  readonly seed: number;
  /** 0 = wilderness, 1 = city block. `MapPreset.urban`. */
  readonly urban: number;
  /** Density multiplier. `MapPreset.scatter`. */
  readonly densityScale: number;
  /**
   * What the map preset asks for, richest first — `MapPreset.props`.
   *
   * Written in the ENTITY-prop vocabulary, because a second system reads the
   * same field against `Scenarios.FALLBACK_PROPS`. `preferenceRank` translates;
   * see the block above `PREFERENCE_ALIASES` for why the translation is here
   * and not a rename in `config.ts`.
   */
  readonly preferred?: readonly string[];
  /**
   * Live-type ceiling, defaulting to `SCATTER_LIMITS.maxTypes`.
   *
   * Exists so `tests/scatter-trim-order.spec.ts` can DRIVE the trim rather than
   * hope a preset saturates the shipped cap. That test asserts the order of the
   * last two passes — trim, then gate — after a bug where the trim reopened
   * holes the coverage gate had just closed. Its only lever used to be "find a
   * preset that trims", and its own header says what happens when the roster
   * moves under it: "the tests below go green while testing nothing". They did.
   * A cap it sets itself cannot stop binding.
   */
  readonly maxTypes?: number;
  /** Geometry presentation only; placement and save identity never consult it. */
  readonly foliagePresentation?: FoliagePresentation;
  /** Complete, already-audited authored families. Partial loading is rejected. */
  readonly importedFoliage?: ReadonlyMap<string, EnvironmentGeometryFamily>;
  /** The box a scenario actually photographs. Density is boosted inside it. */
  readonly focus?: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
  readonly focusBoost?: number;
  /**
   * Multiplier on the normal 20-50 m same-family gap inside `focus` only.
   * Values below one create a richer hero area without changing the broader
   * wilderness rhythm or the spacing between members of an individual clump.
   */
  readonly focusClumpGapScale?: number;
  /**
   * MCV positions that deserve a deliberately authored first-camera
   * composition. These are not generic density foci: each centre receives a
   * biome-specific service cache, perimeter edge and landscape landmark while
   * `lowProfileExclusions` continue to protect the deploy/egress pocket.
   */
  readonly openingCenters?: readonly { readonly x: number; readonly z: number }[];
}

/** Permanent marks composed around semantic prop anchors. */
export interface GroundStoryStats {
  readonly total: number;
  readonly foliage: number;
  readonly mineral: number;
  readonly service: number;
  readonly civic: number;
  readonly vehicle: number;
  readonly lighting: number;
}

/** A contextual ground-story anchor without importing the scenario module. */
export interface GroundStoryAnchor {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** Static composition budget reserved from the shared combat-decal pool. */
export const GROUND_STORY_CAP = 92;

const VEHICLE_STORY_KEYS: ReadonlySet<string> = new Set([
  'carSedan', 'carVan', 'carPickup',
]);
const SERVICE_STORY_KEYS: ReadonlySet<string> = new Set([
  'crateStack', 'containerStack', 'barrel', 'haystack',
]);
const LAMP_STORY_KEYS: ReadonlySet<string> = new Set(['streetLamp', 'streetLampTwin']);
/** One authored beat in the local frame of an MCV opening. */
interface OpeningBeat {
  /** Metres sideways from the route toward map centre. */
  readonly lateral: number;
  /** Metres along the route toward map centre. Negative is behind the MCV. */
  readonly forward: number;
  /** Preferred prop keys, first legal/available key wins. */
  readonly keys: readonly string[];
  /** Yaw relative to the route toward map centre. */
  readonly yaw: number;
  /** Search radius used to settle the beat onto legal terrain. */
  readonly settle?: number;
}

/*
 * THE OPENING IS A SMALL AUTHORED SET, NOT A HIGHER RANDOM NUMBER.
 *
 * Three readable clusters surround the playable pocket:
 *   - rear-right service cache (crates, drums, a short barrier),
 *   - rear-left landscape island (biome silhouette + under-storey),
 *   - side punctuation (one landmark and a low detail cluster).
 *
 * No beat occupies the forward centre corridor. Mirroring the lateral axis per
 * start prevents two opponents from receiving visibly cloned dioramas, while
 * keeping identical seeds byte-deterministic for lockstep and saved masks.
 */
const OPENING_BEATS: Readonly<Record<BiomeName, readonly OpeningBeat[]>> = {
  temperate: [
    { lateral: 24, forward: -12, keys: ['debrisPile'], yaw: 0.35, settle: 4.0 },
    { lateral: -25, forward: 7, keys: ['debrisPile'], yaw: -0.45, settle: 4.0 },
    { lateral: 20, forward: 20, keys: ['debrisPile'], yaw: 0.80, settle: 4.0 },
    { lateral: 23, forward: -18, keys: ['crateStack'], yaw: 0.18, settle: 3.0 },
    { lateral: 28, forward: -16, keys: ['barrel'], yaw: -0.12, settle: 2.5 },
    { lateral: 25, forward: -24, keys: ['crateStack', 'haystack'], yaw: -0.42, settle: 3.0 },
    { lateral: 20, forward: -30, keys: ['fence'], yaw: Math.PI * 0.5, settle: 2.0 },
    { lateral: 27, forward: -30, keys: ['fence'], yaw: Math.PI * 0.5, settle: 2.0 },
    { lateral: -30, forward: -12, keys: ['tree', 'conifer'], yaw: 0.15, settle: 4.0 },
    { lateral: -38, forward: -8, keys: ['treeAutumn', 'tree'], yaw: -0.25, settle: 4.0 },
    { lateral: -27, forward: -20, keys: ['bush'], yaw: 0.35, settle: 3.0 },
    { lateral: -35, forward: -20, keys: ['bush'], yaw: -0.30, settle: 3.0 },
    { lateral: -30, forward: 10, keys: ['flowerBed', 'rockCluster'], yaw: 0.10, settle: 3.0 },
    { lateral: 35, forward: 8, keys: ['bush', 'rockCluster'], yaw: -0.25, settle: 3.0 },
  ],
  desert: [
    { lateral: 24, forward: -12, keys: ['debrisPile'], yaw: 0.35, settle: 4.0 },
    { lateral: -25, forward: 7, keys: ['debrisPile'], yaw: -0.45, settle: 4.0 },
    { lateral: 20, forward: 20, keys: ['debrisPile'], yaw: 0.80, settle: 4.0 },
    { lateral: 23, forward: -18, keys: ['crateStack'], yaw: 0.18, settle: 3.0 },
    { lateral: 29, forward: -16, keys: ['barrel'], yaw: -0.12, settle: 2.5 },
    { lateral: 25, forward: -25, keys: ['crateStack'], yaw: -0.42, settle: 3.0 },
    { lateral: 20, forward: -31, keys: ['fence'], yaw: Math.PI * 0.5, settle: 2.0 },
    { lateral: 27, forward: -31, keys: ['fence'], yaw: Math.PI * 0.5, settle: 2.0 },
    { lateral: -31, forward: -10, keys: ['palm', 'bush'], yaw: 0.15, settle: 4.5 },
    { lateral: -39, forward: -6, keys: ['palm', 'boulder'], yaw: -0.25, settle: 4.5 },
    { lateral: -28, forward: -21, keys: ['rockCluster', 'bush'], yaw: 0.35, settle: 3.5 },
    { lateral: -36, forward: -20, keys: ['bush', 'rockCluster'], yaw: -0.30, settle: 3.5 },
    { lateral: -31, forward: 10, keys: ['rockCluster', 'bush'], yaw: 0.10, settle: 3.5 },
    { lateral: 36, forward: 7, keys: ['boulder', 'rockCluster'], yaw: -0.25, settle: 4.0 },
  ],
  snow: [
    { lateral: 24, forward: -12, keys: ['debrisPile'], yaw: 0.35, settle: 4.0 },
    { lateral: -25, forward: 7, keys: ['debrisPile'], yaw: -0.45, settle: 4.0 },
    { lateral: 20, forward: 20, keys: ['debrisPile'], yaw: 0.80, settle: 4.0 },
    { lateral: 23, forward: -18, keys: ['crateStack'], yaw: 0.18, settle: 3.0 },
    { lateral: 29, forward: -16, keys: ['barrel'], yaw: -0.12, settle: 2.5 },
    { lateral: 25, forward: -25, keys: ['crateStack'], yaw: -0.42, settle: 3.0 },
    { lateral: 20, forward: -31, keys: ['fence'], yaw: Math.PI * 0.5, settle: 2.0 },
    { lateral: 27, forward: -31, keys: ['fence'], yaw: Math.PI * 0.5, settle: 2.0 },
    { lateral: -30, forward: -11, keys: ['conifer'], yaw: 0.15, settle: 4.5 },
    { lateral: -38, forward: -7, keys: ['conifer'], yaw: -0.25, settle: 4.5 },
    { lateral: -27, forward: -21, keys: ['bush', 'rockCluster'], yaw: 0.35, settle: 3.5 },
    { lateral: -35, forward: -20, keys: ['rockCluster', 'bush'], yaw: -0.30, settle: 3.5 },
    { lateral: -30, forward: 10, keys: ['rockCluster', 'bush'], yaw: 0.10, settle: 3.5 },
    { lateral: 36, forward: 7, keys: ['boulder', 'rockCluster'], yaw: -0.25, settle: 4.0 },
  ],
  urban: [
    { lateral: 24, forward: -12, keys: ['debrisPile'], yaw: 0.35, settle: 4.0 },
    { lateral: -25, forward: 7, keys: ['debrisPile'], yaw: -0.45, settle: 4.0 },
    { lateral: 20, forward: 20, keys: ['debrisPile'], yaw: 0.80, settle: 4.0 },
    { lateral: 23, forward: -18, keys: ['crateStack'], yaw: 0.18, settle: 3.0 },
    { lateral: 29, forward: -16, keys: ['barrel'], yaw: -0.12, settle: 2.5 },
    { lateral: 25, forward: -25, keys: ['containerStack', 'crateStack'], yaw: -0.42, settle: 3.5 },
    { lateral: 19, forward: -32, keys: ['railing', 'fence'], yaw: Math.PI * 0.5, settle: 2.5 },
    { lateral: 27, forward: -32, keys: ['railing', 'fence'], yaw: Math.PI * 0.5, settle: 2.5 },
    { lateral: -29, forward: -13, keys: ['streetLampTwin', 'streetLamp'], yaw: 0.0, settle: 3.5 },
    { lateral: -38, forward: -8, keys: ['streetLamp', 'telegraphPole'], yaw: 0.0, settle: 3.5 },
    { lateral: -27, forward: -22, keys: ['flowerBed', 'bush'], yaw: 0.35, settle: 3.5 },
    { lateral: -36, forward: -20, keys: ['flowerBed', 'hedge'], yaw: -0.30, settle: 3.5 },
    { lateral: -31, forward: 10, keys: ['bench', 'flowerBed'], yaw: Math.PI * 0.5, settle: 3.5 },
    { lateral: 36, forward: 7, keys: ['roadSign', 'flowerBed'], yaw: -0.25, settle: 3.5 },
  ],
};

/* One live prop type: a def, its baked geometry, and its instance columns. */
interface ScatterType {
  readonly def: PropDef;
  /** Index into PROP_DEFS. This is what a Placement stores, so trimming a
   *  type can never shift a surviving instance onto the wrong mesh. */
  readonly defIndex: number;
  readonly geo: PropGeometry;
  mesh: THREE.InstancedMesh | null;
  /** Legacy WebGPU benchmark batch; null on the normal InstancedMesh path. */
  batch: THREE.BatchedMesh | null;
  /** Chunk-sorted instance index -> BatchedMesh instance id. */
  batchInstances: Int32Array;
  /** LIVE instance count. Decremented by `clearFootprint()`. */
  count: number;
  /** 16 floats per instance, sorted by chunk. */
  srcMatrix: Float32Array;
  /** 3 floats per instance (linear multipliers), sorted by chunk. */
  srcColor: Float32Array;
  /**
   * 1 float per instance: the wind phase, sorted by chunk.
   *
   * THE ONE QUANTITY THE NODE PATH CANNOT REACH FOR ITSELF. The shipping GLSL
   * reads it straight off the instance transform —
   * `instanceMatrix[3].x * PROP_WIND.phaseX + instanceMatrix[3].z * phaseZ` —
   * and `instanceMatrix` is not reachable from a shared TSL node material:
   * three builds it inside `createInstanceMatrixNode` from the mesh it is given
   * and never surfaces it as an accessor, while ONE prop material is shared by
   * every type in the game and the mesh is not known until the draw. See
   * `PropNodeMaterial.PROP_WIND_PHASE_ATTRIBUTE`, whose note asked for exactly
   * this column.
   *
   * FOUR BYTES AN INSTANCE ON A RENDERER THAT IGNORES THEM, and that is the
   * trade taken rather than hidden. The WebGL material still reads the matrix,
   * because switching it to this attribute would move the phase from a float32
   * computed in the shader to a float64 computed here and rounded — identical to
   * seven decimal places, and `npm run shots` guarantees BYTE-identical captures,
   * which is a promise worth more than 16 kB on a 4131-prop layout. So the two
   * paths derive one number by two routes, and `tests/scatter-wind-phase.spec.ts`
   * pins them against each other rather than trusting that they agree.
   */
  srcPhase: Float32Array;
  /** Prefix offsets into srcMatrix/srcColor/srcPhase, one per chunk plus a terminator. */
  chunkStart: Int32Array;
  /**
   * Live instances in each chunk, so chunk `c` owns
   * `[chunkStart[c], chunkStart[c] + chunkLive[c])`.
   *
   * This is what makes removal O(1). Shrinking a chunk by editing `chunkStart`
   * would have to slide every later chunk down — O(all props) for one felled
   * tree. A separate live count leaves dead instances parked in the tail of
   * their own chunk slice where the repack loop simply never reads them.
   */
  chunkLive: Int32Array;
  /** Instance index -> index into `placements`, so a swap can fix the mover. */
  instOf: Int32Array;
  /** Instances currently uploaded. */
  drawCount: number;
  /**
   * The one `{start, count}` this type ever hands three, per attribute.
   *
   * Owned here rather than built by `addUpdateRange` so that a repack stays
   * allocation-free — see `markRange` at the foot of this file. Allocated once
   * per type in `buildInstances()`, which runs on `generate()`.
   */
  rangeMatrix: { start: number; count: number };
  rangeColor: { start: number; count: number };
  rangePhase: { start: number; count: number };
}

/* A placed prop, before chunk sorting. Kept as parallel arrays to stay flat. */
interface Placement {
  /** Index into PROP_DEFS, never into the live type list. */
  defIndex: number;
  x: number; y: number; z: number;
  yaw: number; scale: number;
  tiltX: number; tiltZ: number;
  cr: number; cg: number; cb: number;
  /** Own index in `placements`, stamped by `buildInstances()`. */
  index: number;
  /** Live type slot, or -1 once cleared / before the GPU build. */
  slot: number;
  /** Instance index inside that type's chunk-sorted arrays. */
  inst: number;
  /** Chunk this instance sorted into. */
  chunk: number;
  /** False once felled. The record stays so every stored index holds. */
  alive: boolean;
}

/* ==========================================================================
 * 2. COLOUR JITTER
 *
 * `instanceColor` is a MULTIPLIER, so a hue rotation cannot be expressed
 * directly. Solve it instead: take the type's dominant tone, apply the
 * requested HSV shift, and divide the shifted linear colour by the original
 * linear colour. The resulting per-channel multiplier reproduces the shift
 * exactly on that tone and something visually related on every other tone —
 * which is the whole point, since a tree's trunk should not swing +8 degrees
 * of hue when its canopy does.
 * ========================================================================== */

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string, out: Float32Array): void {
  const n = parseInt(hex.slice(1), 16);
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >> 8) & 255) / 255;
  out[2] = (n & 255) / 255;
}

function rgbToHsv(r: number, g: number, b: number, out: Float32Array): void {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  out[0] = h; out[1] = max <= 0 ? 0 : d / max; out[2] = max;
}

function hsvToRgb(h: number, s: number, v: number, out: Float32Array): void {
  h -= Math.floor(h);
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r = v, g = t, b = p;
  switch (i % 6) {
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
    default: break;
  }
  out[0] = r; out[1] = g; out[2] = b;
}

const JC_RGB = new Float32Array(3);
const JC_HSV = new Float32Array(3);
const JC_OUT = new Float32Array(3);

/**
 * Per-instance colour multiplier for `baseHex` under a `strength`-scaled draw
 * of SCATTER_JITTER. Writes [r,g,b] into `out`.
 *
 * Bible §6.5: "hue +/-8 degrees, value +/-18%, saturation +/-12%. Without
 * hue/value jitter a forest reads as a repeated stamp." (Scorecard #39.)
 */
function jitterColor(rng: Rng, baseHex: string, strength: number, out: Float32Array): void {
  hexToRgb(baseHex, JC_RGB);
  const l0 = srgbToLinear(JC_RGB[0]), l1 = srgbToLinear(JC_RGB[1]), l2 = srgbToLinear(JC_RGB[2]);
  rgbToHsv(JC_RGB[0], JC_RGB[1], JC_RGB[2], JC_HSV);

  const dh = (rng.next() * 2 - 1) * (SCATTER_JITTER.hueDeg / 360) * strength;
  const ds = 1 + (rng.next() * 2 - 1) * SCATTER_JITTER.saturation * strength;
  const dv = 1 + (rng.next() * 2 - 1) * SCATTER_JITTER.value * strength;
  hsvToRgb(JC_HSV[0] + dh, clamp01(JC_HSV[1] * ds), clamp01(JC_HSV[2] * dv), JC_OUT);

  const m0 = srgbToLinear(JC_OUT[0]), m1 = srgbToLinear(JC_OUT[1]), m2 = srgbToLinear(JC_OUT[2]);
  out[0] = clamp(m0 / Math.max(l0, 1e-4), 0.45, 1.75);
  out[1] = clamp(m1 / Math.max(l1, 1e-4), 0.45, 1.75);
  out[2] = clamp(m2 / Math.max(l2, 1e-4), 0.45, 1.75);
}

/** The tone a type's jitter is solved against. */
function dominantTone(def: PropDef, p: PropPalette): string {
  switch (def.family) {
    case 'canopy': return def.key === 'treeAutumn' ? p.autumnA
      : def.key === 'conifer' ? p.conifer
        : def.key === 'palm' ? p.frond : p.leafA;
    case 'shrub': return def.key === 'hedge' ? p.hedge : p.shrub;
    case 'grass': return def.key === 'grassTuftGreen' ? p.grassGreen : p.grassGold;
    case 'rock': return p.rock;
    case 'yard': return def.key === 'haystack' ? p.hay : p.crateA;
    default: return p.concrete;
  }
}

/* ==========================================================================
 * 3. THE SCATTER SYSTEM
 * ========================================================================== */

export class Scatter {
  readonly library: PropLibrary;
  readonly foliage: FoliageEngine;
  /** `PropMaterialSetLike` — `depthMaterial` is null on the node path. */
  readonly materials: PropMaterialSetLike;
  private readonly palette: PropPalette;
  private readonly root = new THREE.Group();
  private readonly scene: THREE.Scene;
  private readonly terrain: Terrain;
  private readonly opts: ScatterOptions;
  private readonly batchedNodePath: boolean;
  private readonly legacyShadows: boolean;

  private types: ScatterType[] = [];
  private placements: Placement[] = [];
  private readonly nodeBatches: THREE.BatchedMesh[] = [];

  /* ---- masks and accelerators ------------------------------------------ */

  /** Per map cell: 1 when a prop may stand here at all. */
  private readonly placeable = new Uint8Array(MAP_CELL_COUNT);
  /** Per map cell: 1 when the cell counts toward the density denominator. */
  private readonly walkable = new Uint8Array(MAP_CELL_COUNT);
  /** Bucket grid over map cells for the min-spacing test. */
  private readonly bucketHead = new Int32Array(MAP_CELL_COUNT);
  private bucketNext = new Int32Array(0);

  /** Exclusion discs added by scenarios/bases. Triples of (x, z, r). */
  private readonly exclusions: number[] = [];
  /**
   * Discs that reject every family except low, non-blocking grass.
   * MCV openings use these to keep trunks and boulders out of the deploy lane
   * without turning the lane into a visibly mown rectangle.
   */
  private readonly lowProfileExclusions: number[] = [];
  /** Exact placement records authored by the opening-composition pass. */
  private readonly openingPlacements = new Set<Placement>();
  /** Types the opening composition depends on; the draw-call trim keeps them. */
  private readonly openingDefIndices = new Set<number>();

  /**
   * Accepted clump centres, bucketed by (family, 64 m cell) so the 20-50 m
   * separation test stays O(1) as the map fills. A flat list looks equivalent
   * and turns generate() into a 2.4 s stall on a dense map.
   */
  private readonly clumpBuckets: number[][] = [];
  /**
   * Every accepted natural composition centre as (x, z, familyCode).
   *
   * The spatial buckets above exist to make spacing cheap. This deliberately
   * redundant flat view exists for the terrain-composition pass: broad ground
   * variation should collect under copses and rock fields, not be sprayed by
   * an unrelated noise field. Generation-time only, so the small duplication
   * costs less than making the rendering pass understand the bucket layout.
   */
  private readonly compositionAnchors: number[] = [];
  /** Budget this generate() was given, so the top-up passes can respect it. */
  private budget = 0;

  /* ---- per-chunk bookkeeping ------------------------------------------- */

  private readonly chunkMinY = new Float32Array(CHUNK_COUNT);
  private readonly chunkMaxY = new Float32Array(CHUNK_COUNT);
  private readonly chunkUsed = new Uint8Array(CHUNK_COUNT);
  private readonly chunkVisible = new Uint8Array(CHUNK_COUNT);
  private readonly chunkVisiblePrev = new Uint8Array(CHUNK_COUNT);

  /* ---- frame scratch (allocated once, never in the loop) ---------------- */

  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly probe = new THREE.Box3();

  /* ---- coverage scratch ------------------------------------------------- */

  private readonly coverWalkable = new Uint8Array(COVER_COUNT);
  private readonly coverAdorned = new Uint8Array(COVER_COUNT);
  private readonly coverSat = new Int32Array((COVER_N + 1) * (COVER_N + 1));
  private readonly coverBlocked = new Int32Array(COVER_N);

  /* ---- reported numbers -------------------------------------------------- */

  generateMs = 0;
  /** Broad natural-material patches painted beneath selected prop clusters. */
  groundPatches = 0;
  /** Authored props successfully settled around MCV openings. */
  openingProps = 0;
  /** Permanent pooled decals correlated with nearby props. */
  groundStoryMarks = 0;
  private storiesPainted = false;
  private storyStats: GroundStoryStats = {
    total: 0, foliage: 0, mineral: 0, service: 0, civic: 0, vehicle: 0, lighting: 0,
  };
  visibleInstances = 0;
  visibleChunks = 0;
  lastReport: CoverageReport | null = null;

  /* ---- clearing bookkeeping ---------------------------------------------- */

  /** Live props. `placements.length` also counts tombstones. */
  private liveProps = 0;
  /** Widest visual disc any live type can produce, metres. Scan reach. */
  private maxPropReach = 0;
  /** Props felled since `generate()`. */
  clearedProps = 0;
  /** Placements EXAMINED by the last `clearFootprint()`. The O() witness. */
  lastClearScanned = 0;
  /** Props felled by the last `clearFootprint()`. */
  lastClearCount = 0;
  /**
   * Identity of the placement list this `generate()` produced. See §3.10b —
   * it is what makes a saved felled-prop mask safe to apply to a REGENERATED
   * scatter, and what makes an application to the wrong one impossible.
   */
  private placementHash = 0;

  constructor(options: ScatterOptions) {
    this.opts = options;
    this.scene = options.scene;
    this.terrain = options.terrain;
    this.palette = propPalette(options.biome);
    const fallbackKeys = options.foliagePresentation === 'procedural'
      ? undefined
      : PROP_DEFS
          .filter((def) => def.biome[options.biome] > 0 && !options.importedFoliage?.has(def.key))
          .map((def) => def.key);
    this.library = new PropLibrary({
      biome: options.biome,
      seed: options.seed,
      keys: fallbackKeys,
    });
    this.foliage = new FoliageEngine({
      fallback: this.library,
      presentation: options.foliagePresentation,
      importedFamilies: options.importedFoliage,
    });
    const np = nodePath();
    // BatchedMesh is retained only as a same-build benchmark arm. Three's
    // WebGPU backend expands it to one draw command per visible prop instance,
    // so the normal node path deliberately shares WebGL's typed instancing.
    this.batchedNodePath = usesLegacyScatterBatch(
      np !== null,
      typeof location === 'undefined' ? '' : location.search,
    );
    this.legacyShadows = usesLegacyScatterShadows(
      typeof location === 'undefined' ? '' : location.search,
    );
    this.materials = np !== null ? np.createPropMaterials() : createPropMaterial();
    this.root.name = 'PropScatter';
    this.root.matrixAutoUpdate = false;
    this.scene.add(this.root);
  }

  /* ======================================================================
   * 3.1 MASKS
   * ====================================================================== */

  /**
   * A disc nothing may spawn inside. Base footprints, ore fields, the
   * placement ghost, a scenario's hero framing — anything that wants clear
   * ground. Call before `generate()`.
   */
  addExclusion(x: number, z: number, radius: number): void {
    this.exclusions.push(x, z, radius);
  }

  /** A clearance where grass may remain but trees, shrubs and props may not. */
  addLowProfileExclusion(x: number, z: number, radius: number): void {
    this.lowProfileExclusions.push(x, z, radius);
  }

  /** Rectangular exclusion, expressed as the disc that covers it. */
  addExclusionRect(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const cx = (minX + maxX) * 0.5, cz = (minZ + maxZ) * 0.5;
    this.addExclusion(cx, cz, Math.hypot(maxX - cx, maxZ - cz));
  }

  clearExclusions(): void {
    this.exclusions.length = 0;
    this.lowProfileExclusions.length = 0;
  }

  private inExclusion(x: number, z: number, pad: number): boolean {
    const e = this.exclusions;
    for (let i = 0; i < e.length; i += 3) {
      const dx = x - e[i], dz = z - e[i + 1], r = e[i + 2] + pad;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  private inLowProfileExclusion(x: number, z: number, pad: number): boolean {
    const e = this.lowProfileExclusions;
    for (let i = 0; i < e.length; i += 3) {
      const dx = x - e[i], dz = z - e[i + 1], r = e[i + 2] + pad;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /**
   * Rebuild `placeable` and `walkable`.
   *
   * `walkable` is the density denominator and the coverage domain: ground a
   * unit could actually stand on. `placeable` additionally rejects everything a
   * prop must never occupy — structure footprints and scenario exclusions.
   * Per-type surface and slope masks are applied at placement time, because a
   * boulder and a cafe umbrella disagree about what a legal cell is.
   */
  private buildMasks(): void {
    const t = this.terrain;
    this.placeable.fill(0);
    this.walkable.fill(0);
    for (let cz = 0; cz < MAP_CELLS; cz++) {
      for (let cx = 0; cx < MAP_CELLS; cx++) {
        const i = cz * MAP_CELLS + cx;
        if (t.waterGrid[i] !== 0) continue;
        if ((t.passGrid[i] & PASS_GROUND) === 0) continue;
        this.walkable[i] = 1;
        if (t.isOccupied(cx, cz)) continue;
        const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
        if (this.inExclusion(x, z, 0)) continue;
        this.placeable[i] = 1;
      }
    }
  }

  /* ======================================================================
   * 3.2 SPACING
   * ====================================================================== */

  private resetBuckets(capacity: number): void {
    this.bucketHead.fill(-1);
    if (this.bucketNext.length < capacity) this.bucketNext = new Int32Array(capacity);
    this.bucketNext.fill(-1, 0, capacity);
  }

  private bucketInsert(index: number, x: number, z: number): void {
    const cx = clamp(Math.floor(x / CELL), 0, MAP_CELLS - 1);
    const cz = clamp(Math.floor(z / CELL), 0, MAP_CELLS - 1);
    const c = cz * MAP_CELLS + cx;
    this.bucketNext[index] = this.bucketHead[c];
    this.bucketHead[c] = index;
  }

  /** True when any already-placed prop sits within `radius` metres. */
  private tooClose(x: number, z: number, radius: number): boolean {
    const r2 = radius * radius;
    const span = Math.ceil(radius / CELL);
    const cx = clamp(Math.floor(x / CELL), 0, MAP_CELLS - 1);
    const cz = clamp(Math.floor(z / CELL), 0, MAP_CELLS - 1);
    const x0 = Math.max(0, cx - span), x1 = Math.min(MAP_CELLS - 1, cx + span);
    const z0 = Math.max(0, cz - span), z1 = Math.min(MAP_CELLS - 1, cz + span);
    const P = this.placements;
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        let n = this.bucketHead[gz * MAP_CELLS + gx];
        while (n >= 0) {
          const p = P[n];
          const dx = p.x - x, dz = p.z - z;
          if (dx * dx + dz * dz < r2) return true;
          n = this.bucketNext[n];
        }
      }
    }
    return false;
  }

  /* ======================================================================
   * 3.3 LEGALITY
   * ====================================================================== */

  /** Can `def` stand at (x,z)? Applies the surface, slope and spacing masks. */
  private legal(def: PropDef, x: number, z: number, spacingScale = 1): boolean {
    if (x < 2 || z < 2 || x > MAP_SIZE - 2 || z > MAP_SIZE - 2) return false;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= MAP_CELLS || cz >= MAP_CELLS) return false;
    if (this.placeable[cz * MAP_CELLS + cx] === 0) return false;
    // `placeable` is a 4 m cell mask sampled at cell CENTRES, so a cell whose
    // centre clears an exclusion by 0.1 m can still host a prop 2.8 m inside
    // it. Cheap fast-reject above, exact test here.
    if (this.exclusions.length > 0 && this.inExclusion(x, z, 0)) return false;
    // A dressed opening still has a clearance hierarchy. Grass tufts are
    // visual-only, crush-proof ground cover; everything with a trunk, canopy,
    // rock or authored yard footprint stays outside the unit/deploy pockets.
    if (def.family !== 'grass' && this.lowProfileExclusions.length > 0
      && this.inLowProfileExclusion(x, z, 0)) return false;
    /*
     * NOTHING STANDS IN THE ROAD.
     *
     * Reported as umbrellas, crates and benches sitting in the middle of the
     * carriageway and in the intersection. Measured before this line: 186 of
     * 3585 props on industrial-grid, 207 of 4143 on temperate-valley, 105 of
     * 4044 on frozen-sector — about one prop in twenty, on every map.
     *
     * The header of this file has claimed "street furniture spawns BESIDE
     * roads, never on them" since it was written, and the mechanism it named
     * was the `def.surfaces` mask. That mask cannot express it. Roads reach the
     * splat through `Terrain.stampSurface`, which paints `SurfaceId.Paving`
     * under the carriageway AND sets `surface[cell]` to it outright — so to the
     * mask a lane of tarmac and a pedestrian plaza are one surface, and every
     * `SURF_ANY` or `SURF_HARD` type was free to stand in traffic.
     *
     * `isCarriageway`, NEVER `isRoad`, and the difference is the whole point:
     * `isRoad` also covers the kerb and the pavement, which is exactly where
     * `traceKerbs` and `placeAlongLine` are DESIGNED to put lamps, benches,
     * hydrants and railings. Excluding it would delete street furniture from
     * the game to fix props in the road. This is the same distinction, for the
     * same reason, that `economy.system.ts` draws when it seeds ore.
     *
     * At `legal()` rather than in the renderer, and rather than as an
     * `addExclusion` disc: every placement mode in this file funnels through
     * here, discs cannot describe a ribbon, and a prop culled at draw time
     * would still hold its spacing slot and still be in the save.
     */
    if (isCarriageway(x, z)) return false;
    const surf = this.terrain.surfaceAt(x, z);
    if ((def.surfaces & (1 << surf)) === 0) return false;
    if (this.terrain.slopeAt(x, z) > def.maxSlope) return false;
    if (this.terrain.isCliff(cx, cz)) return false;
    return !this.tooClose(x, z, def.spacing * spacingScale);
  }

  /* ======================================================================
   * 3.4 PLACEMENT
   * ====================================================================== */

  private place(defIndex: number, def: PropDef, x: number, z: number, rng: Rng): boolean {
    if (this.placements.length >= SCATTER_LIMITS.maxProps) return false;
    const y = this.terrain.heightAt(x, z);

    const sMin = def.scaleMin ?? SCATTER_JITTER.scaleMin;
    const sMax = def.scaleMax ?? SCATTER_JITTER.scaleMax;
    const scale = rng.range(sMin, sMax);

    // Tilt: bible §6.5 allows +/-4 degrees on vegetation. Rock and grass also
    // lean with the ground normal so they sit in the slope instead of on it.
    let tiltX = rng.range(-1, 1) * SCATTER_JITTER.tiltDeg * DEG2RAD;
    let tiltZ = rng.range(-1, 1) * SCATTER_JITTER.tiltDeg * DEG2RAD;
    if (def.family === 'rock' || def.family === 'grass') {
      this.terrain.normalAt(x, z, NORMAL_SCRATCH);
      // Small-angle: the normal's XZ components ARE the lean, in radians.
      tiltX += NORMAL_SCRATCH[2] * 0.6;
      tiltZ += -NORMAL_SCRATCH[0] * 0.6;
    }

    const strength = def.jitter ?? 1;
    jitterColor(rng, dominantTone(def, this.palette), strength, JITTER_OUT);

    const p: Placement = {
      defIndex, x, y, z,
      yaw: rng.next() * TAU,
      scale, tiltX, tiltZ,
      cr: JITTER_OUT[0], cg: JITTER_OUT[1], cb: JITTER_OUT[2],
      index: -1, slot: -1, inst: -1, chunk: -1, alive: true,
    };
    this.bucketInsert(this.placements.length, x, z);
    this.placements.push(p);
    return true;
  }

  /**
   * A copse. Bible §6.5: 3-9 members, 4-8 m spacing inside, 20-50 m between
   * clumps. Members are drawn in a disc and rejected against the global
   * spacing grid, which is what makes a copse read as a copse rather than as a
   * ring of trees.
   */
  private placeClump(defIndex: number, def: PropDef, cx: number, cz: number, rng: Rng): number {
    const want = rng.int(def.clumpMin, def.clumpMax);
    let placed = 0;
    for (let i = 0; i < want; i++) {
      let ok = false;
      for (let a = 0; a < SCATTER_CLUSTER.attemptsPerMember && !ok; a++) {
        // sqrt() keeps the disc uniform; without it every clump has a dense core.
        const ang = rng.next() * TAU;
        const rad = def.clumpSpread * Math.sqrt(rng.next());
        const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
        if (!this.legal(def, x, z)) continue;
        ok = this.place(defIndex, def, x, z, rng);
      }
      if (ok) placed++;
    }
    return placed;
  }

  /** Real kerb geometry only; concrete pads and building yards are not roads. */
  private traceKerbs(): readonly RoadFurnitureRun[] {
    return getRoads()?.streetFurnitureRuns() ?? [];
  }

  /**
   * Lay a type along a polyline, offset to the soft side. Synthetic wilderness
   * lines keep the old 8-12 m utility rhythm; authored road runs receive the
   * much sparser story policy from roadside-layout.ts. The latter deliberately
   * contains long gaps so the street does not read as an asset catalogue.
   */
  private placeAlongLine(
    defIndex: number, def: PropDef, line: readonly number[], rng: Rng, budget: number,
    outward: readonly number[] | null = null, layout: RoadsideLayout | null = null,
  ): number {
    const roads = getRoads();
    const pitch = layout !== null
      ? rng.range(layout.pitchMin, layout.pitchMax)
      : def.spacing > SCATTER_CLUSTER.streetPitchMax
        ? def.spacing
        : rng.range(SCATTER_CLUSTER.streetPitchMin, SCATTER_CLUSTER.streetPitchMax);
    const offset = rng.range(SCATTER_CLUSTER.kerbOffsetMin, SCATTER_CLUSTER.kerbOffsetMax);
    const side = rng.sign();
    let placed = 0;
    const cap = Math.min(budget, layout?.maxPerRun ?? budget);
    const endClearance = layout?.endClearance ?? 0;
    let totalLength = 0;
    for (let i = 0; i + 3 < line.length; i += 2) {
      totalLength += Math.hypot(line[i + 2] - line[i], line[i + 3] - line[i + 1]);
    }
    if (totalLength <= endClearance * 2 + 1) return 0;
    let nextDistance = endClearance + rng.range(0, pitch);
    let distanceAtSegment = 0;
    for (let i = 0; i + 3 < line.length && placed < cap; i += 2) {
      const ax = line[i], az = line[i + 1], bx = line[i + 2], bz = line[i + 3];
      const dx = bx - ax, dz = bz - az;
      const seg = Math.hypot(dx, dz);
      if (seg < 1e-3) continue;
      const ux = dx / seg, uz = dz / seg;
      // Which side of the kerb does this type belong on? A bench wants the
      // pavement, a tree row wants the verge. Probe both and take whichever
      // side the type's surface mask actually accepts; only fall back to the
      // random side when neither or both are legal.
      let px: number, pz: number;
      if (outward !== null) {
        px = outward[i] + outward[i + 2];
        pz = outward[i + 1] + outward[i + 3];
        const pl = Math.hypot(px, pz) || 1;
        px /= pl; pz /= pl;
      } else {
        px = -uz * side; pz = ux * side;
        const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
        const sA = this.terrain.surfaceAt(mx + px * offset, mz + pz * offset);
        const sB = this.terrain.surfaceAt(mx - px * offset, mz - pz * offset);
        const okA = (def.surfaces & (1 << sA)) !== 0;
        const okB = (def.surfaces & (1 << sB)) !== 0;
        if (!okA && okB) { px = -px; pz = -pz; }
      }

      while (nextDistance <= distanceAtSegment + seg
        && nextDistance <= totalLength - endClearance && placed < cap) {
        const along = nextDistance - distanceAtSegment;
        nextDistance += pitch * rng.range(0.88, 1.14);
        // Road-authored runs already carry the exact across-road normal. Keep
        // jitter along the kerb so a lamp can never wander off its sidewalk.
        const jitter = rng.range(-1, 1) * SCATTER_CLUSTER.streetJitter;
        const x = ax + ux * (along + jitter) + px * offset;
        const z = az + uz * (along + jitter) + pz * offset;
        if (!this.legal(def, x, z)) continue;
        // A single-arm lamp extends along local +X. Point that arm INWARD over
        // the carriageway; using the tangent here was the visible 90/180-degree
        // inversion on curved sidewalks.
        if (this.place(defIndex, def, x, z, rng)) {
          const p = this.placements[this.placements.length - 1];
          if (def.sidewalkOnly === true && outward !== null) {
            // Aim at the live centreline rather than trusting a curve's
            // averaged kerb normal. At a junction corner the latter can be
            // 20-30 degrees off even though it points to the correct side.
            p.yaw = roads?.nearestRoadPoint(p.x, p.z, 18, ROAD_POINT_SCRATCH) === true
              ? Math.atan2(p.z - ROAD_POINT_SCRATCH[1], ROAD_POINT_SCRATCH[0] - p.x)
              : Math.atan2(pz, -px);
          } else {
            p.yaw = streetPropYaw(def.key, ux, uz, rng.range(-0.08, 0.08));
          }
          placed++;
        }
      }
      distanceAtSegment += seg;
    }
    return placed;
  }

  /**
   * A synthetic run for maps with no roads: fences across a field, a telegraph
   * line marching over a ridge. ra3steam_05 has exactly this in its desert.
   */
  private placeSyntheticLine(defIndex: number, def: PropDef, rng: Rng, budget: number): number {
    const cellIndex = this.randomPlaceableCell(rng);
    if (cellIndex < 0) return 0;
    const sx = ((cellIndex % MAP_CELLS) + 0.5) * CELL;
    const sz = (((cellIndex / MAP_CELLS) | 0) + 0.5) * CELL;
    const ang = rng.next() * TAU;
    const line: number[] = [];
    const runLength = rng.range(40, 110);
    // Gentle heading drift so the run is a spline, not an axis-aligned ruler
    // (bible §6.3: "straight axis-aligned roads are a hard fail" — the same
    // instinct applies to a fence line).
    let a = ang, x = sx, z = sz;
    for (let d = 0; d < runLength; d += 6) {
      line.push(x, z);
      a += rng.range(-0.12, 0.12);
      x += Math.cos(a) * 6;
      z += Math.sin(a) * 6;
      if (x < 4 || z < 4 || x > MAP_SIZE - 4 || z > MAP_SIZE - 4) break;
    }
    if (line.length < 4) return 0;
    return this.placeAlongLine(defIndex, def, line, rng, budget);
  }

  private randomPlaceableCell(rng: Rng): number {
    for (let a = 0; a < 96; a++) {
      const i = rng.int(0, MAP_CELL_COUNT - 1);
      if (this.placeable[i] !== 0) return i;
    }
    return -1;
  }

  /* ======================================================================
   * 3.5 GENERATE
   * ====================================================================== */

  /**
   * Build the whole scatter. Deterministic in (seed, terrain, exclusions).
   *
   * Order matters:
   *   1. masks               — what ground exists at all
   *   2. type mix + budget   — how many props of what, from the density target
   *   3. structured passes   — clumps, fields, streets, solos
   *   4. coverage fill       — close every >25 m hole the validator reports
   *   5. GPU build           — chunk sort, matrices, InstancedMeshes
   */
  generate(): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.disposeMeshes();
    this.placements.length = 0;
    this.clumpBuckets.length = 0;
    this.compositionAnchors.length = 0;
    this.openingPlacements.clear();
    this.openingDefIndices.clear();
    this.groundPatches = 0;
    this.openingProps = 0;
    this.groundStoryMarks = 0;
    this.storiesPainted = false;
    this.storyStats = {
      total: 0, foliage: 0, mineral: 0, service: 0, civic: 0, vehicle: 0, lighting: 0,
    };
    this.clearedProps = 0;
    this.lastClearScanned = 0;
    this.lastClearCount = 0;
    this.liveProps = 0;
    this.maxPropReach = 0;
    this.placementHash = 0;
    this.resetBuckets(SCATTER_LIMITS.maxProps);
    this.buildMasks();

    const rng = new Rng(this.opts.seed >>> 0);
    const urban = clamp01(this.opts.urban);

    /* -- 2. the type mix -------------------------------------------------- */
    const avail: ScatterType[] = [];
    const weights: number[] = [];
    const preferred = this.opts.preferred ?? [];
    for (let i = 0; i < PROP_DEFS.length; i++) {
      const def = PROP_DEFS[i];
      const geo = this.foliage.get(def.key);
      if (geo === undefined) continue;
      const biomeW = def.biome[this.opts.biome];
      if (biomeW <= 0) continue;
      // Affinity: a def with urban 1.0 wants urban 1.0 and vice versa.
      const fit = def.urban * urban + (1 - def.urban) * (1 - urban);
      let w = biomeW * (0.15 + 0.85 * fit);
      // Key, family or alias — see PREFERENCE_ALIASES. A bare
      // `preferred.indexOf(def.key)` left 11 of the 28 shipped entries inert.
      const pref = preferenceRank(def, preferred);
      if (pref >= 0) w *= preferenceMultiplier(pref);
      if (w <= 1e-3) continue;
      avail.push({
        def, defIndex: i, geo, mesh: null, batch: null, batchInstances: EMPTY_I32, count: 0,
        srcMatrix: EMPTY_F32, srcColor: EMPTY_F32, srcPhase: EMPTY_F32,
        chunkStart: EMPTY_I32, chunkLive: EMPTY_I32, instOf: EMPTY_I32,
        drawCount: 0,
        rangeMatrix: { start: 0, count: 0 }, rangeColor: { start: 0, count: 0 },
        rangePhase: { start: 0, count: 0 },
      });
      weights.push(w);
    }
    if (avail.length === 0) { this.types = []; this.finishTiming(t0); return; }

    /* -- the budget ------------------------------------------------------- */
    let walkableCells = 0;
    for (let i = 0; i < MAP_CELL_COUNT; i++) walkableCells += this.walkable[i];
    const hectares = Math.max(walkableCells * CELL * CELL / 10000, 0.01);
    const target = SCATTER_DENSITY.wildernessPerHectare
      + (SCATTER_DENSITY.cityPerHectare - SCATTER_DENSITY.wildernessPerHectare) * urban;
    /*
     * `MapPreset.scatter` IS A MOOD DIAL, NOT A LICENCE TO EMPTY THE MAP — and
     * the floor that was enforcing that sentence only enforced half of it.
     *
     * Bible ruling #9 states TWO minima: "City >= 75/ha, wilderness >= 260/ha".
     * `SCATTER_DENSITY.hardFloorPerHectare` is 95 and its own docstring quotes
     * only the first of them. It was then applied as a single scalar to every
     * map in the game, so on a WILDERNESS preset the binding constraint was a
     * CITY number — 95/ha against a ruling that asks for 260 — and `scatter`
     * could pull the map to a third of its target with nothing to stop it.
     *
     * Measured on the shipped presets before this changed:
     *
     *     preset      urban  scatter   achieved   lerped target
     *     snow         0.20     0.70    160.6/ha      229/ha    70%
     *     arid         0.45     0.85    162.0/ha      190/ha    85%
     *     coast        0.30     0.85    182.0/ha      214/ha    85%
     *
     * Three presets under the bible band, and `snow` at 70% of it. None of them
     * was anywhere near 95/ha, so the floor never fired on any map that needed
     * it; the only preset it ever bound was `urban`, the one it was written for.
     *
     * The floor is now the ruling's own pair, lerped by the same `urban` the
     * target is: `wildernessPerHectare` at the wilderness end,
     * `hardFloorPerHectare` at the city end. Note what this does NOT do — it
     * does not touch a preset asking for MORE than the band (`tropical` 1.45,
     * `atoll` 1.15 and `temperate` 1.00 are bit-identical after this change),
     * so the dial still works upward and only its downward travel is bounded.
     */
    const floor = SCATTER_DENSITY.wildernessPerHectare
      + (SCATTER_DENSITY.hardFloorPerHectare - SCATTER_DENSITY.wildernessPerHectare) * urban;
    const perHa = Math.max(target * Math.max(this.opts.densityScale, 0.05), floor);
    const budget = Math.min(SCATTER_LIMITS.maxProps, Math.round(perHa * hectares));
    this.budget = budget;

    /* -- 3. structured passes --------------------------------------------- */
    const total = weights.reduce((a, b) => a + b, 0);
    const grassCap = Math.round(budget * SCATTER_DENSITY.maxGrassFraction);
    let grassPlaced = 0;

    const kerbs = this.traceKerbs();
    // A low-frequency habitat field so 'field' props are patchy, not uniform.
    const habitatSeed = (this.opts.seed ^ 0x51ed) >>> 0;

    /* -- 3a. authored opening compositions ------------------------------- *
     * These go down BEFORE the broad scatter passes, so random vegetation
     * respects the composition instead of landing first and rejecting every
     * designed beat. The normal spacing/surface/slope masks still apply.     */
    this.openingProps = this.placeOpeningCompositions(avail, rng.fork());

    for (let i = 0; i < avail.length; i++) {
      const type = avail[i];
      const def = type.def;
      let share = Math.round(budget * (weights[i] / total));
      if (def.family === 'grass') {
        share = Math.min(share, Math.max(0, grassCap - grassPlaced));
      }
      if (share <= 0) continue;
      let placed = 0;
      const typeRng = rng.fork();

      switch (def.mode) {
        case 'clump': {
          const perClump = (def.clumpMin + def.clumpMax) * 0.5;
          const clumps = Math.max(1, Math.round(share / Math.max(perClump, 1)));
          for (let c = 0; c < clumps && placed < share; c++) {
            const cellIndex = this.pickClumpCentre(def, typeRng, habitatSeed);
            if (cellIndex < 0) continue;
            const cx = ((cellIndex % MAP_CELLS) + 0.5) * CELL;
            const cz = (((cellIndex / MAP_CELLS) | 0) + 0.5) * CELL;
            placed += this.placeClump(type.defIndex, def, cx, cz, typeRng);
          }
          break;
        }
        case 'field': {
          // Density modulated by fbm so a rock field has a shape.
          for (let a = 0; a < share * 14 && placed < share; a++) {
            const x = typeRng.next() * MAP_SIZE, z = typeRng.next() * MAP_SIZE;
            const h = fbm2(x * 0.018, z * 0.018, 3, 2.0, 0.5, habitatSeed);
            if (typeRng.next() > clamp01(0.30 + h * 0.9)) continue;
            if (!this.legal(def, x, z)) continue;
            if (this.place(type.defIndex, def, x, z, typeRng)) placed++;
          }
          break;
        }
        case 'street': {
          if (kerbs.length > 0) {
            for (let k = 0; k < kerbs.length && placed < share; k++) {
              const layout = roadsideLayoutFor(def.key);
              if (layout !== null && !roadsideRunAllows(this.opts.seed, def.key, k)) continue;
              placed += this.placeAlongLine(
                type.defIndex, def, kerbs[k].points, typeRng, share - placed, kerbs[k].outward,
                layout,
              );
            }
          }
          // A lamp is sidewalk infrastructure, never a decorative pole in a
          // meadow. Fences and telegraph lines keep their wilderness fallback.
          if (kerbs.length === 0 && def.sidewalkOnly !== true) {
            for (let a = 0; a < 24 && placed < share; a++) {
              placed += this.placeSyntheticLine(type.defIndex, def, typeRng, share - placed);
            }
          }
          break;
        }
        default: {
          for (let a = 0; a < share * 24 && placed < share; a++) {
            const x = typeRng.next() * MAP_SIZE, z = typeRng.next() * MAP_SIZE;
            if (!this.legal(def, x, z)) continue;
            if (this.place(type.defIndex, def, x, z, typeRng)) placed++;
          }
          break;
        }
      }
      // Opening compositions may already have spent this type. Preserve that
      // authored count; the broad pass adds to it rather than overwriting it.
      type.count += placed;
      if (def.family === 'grass') grassPlaced += placed;
    }

    /* -- 3b. TOP-UP: density is a contract, not an aspiration -------------- *
     * The structured passes are allowed to under-deliver — a copse can be
     * rejected wholesale by a lake, a street pass finds no kerbs on a
     * wilderness map, and the fbm habitat gate rejects most of what it is
     * offered by design. Left alone, temperate lands around 105/ha against a
     * 221/ha budget, which is bible §6.6's failure mode wearing a nicer hat.
     * So: keep spending the remaining budget on clustered vegetation until it
     * is gone or the map genuinely has nowhere left to put a bush.           */
    grassPlaced = this.topUpToBudget(
      avail, (t) => weights[avail.indexOf(t)], budget, grassCap, grassPlaced,
      habitatSeed, rng.fork(),
    );

    /* -- focus boost: the scenario's photographed box --------------------- */
    const focus = this.opts.focus;
    if (focus != null) {
      const boost = this.opts.focusBoost ?? 0.35;
      const extra = Math.round(budget * boost);
      const fillers = avail.filter((t) => t.def.mode === 'clump' || t.def.mode === 'field');
      if (fillers.length > 0) {
        const fRng = rng.fork();
        let added = 0;
        let stalled = 0;
        while (added < extra && stalled < 160
          && this.placements.length < SCATTER_LIMITS.maxProps) {
          const pick = fRng.pick(fillers);
          const n = this.placeFocusClump(pick, focus, fRng);
          if (n <= 0) { stalled++; continue; }
          pick.count += n;
          added += n;
          stalled = 0;
        }
      }
    }

    /* -- 4. TRIM TO THE DRAW-CALL BUDGET, THEN GATE ----------------------- *
     * These two were the other way round, and the order was wrong.
     *
     * `trimTypes()` deletes every placement of the lowest-ranked types. With
     * the gate first, it deleted props the gate had just placed to close a
     * 25x25 m patch, and nothing re-validated: `lastReport` was recomputed on
     * the trimmed set with no pass left to fix what the trim had reopened.
     * Scorecard #15 is weight 3 and it was being reported out of a gate whose
     * result had since been edited. `07-soviet-base` shipped at "adornment
     * 65%, 1 unadorned patch" that way.
     *
     * So the GATE IS LAST, and nothing below this line may remove a placement.
     *
     * The trim still ranks on post-top-up counts, exactly as it always has.
     * Moving it ahead of the top-up as well was tried and measured worse: the
     * structured passes' counts are a different ranking signal, a different
     * four types survived on `04-units-parade`, and its #34 edge coverage fell
     * 0.2960 -> 0.2569. What a type finally delivered is the honest basis for
     * spending a draw call on it; what it was allocated is not.               */
    const live = this.trimTypes(avail);
    // `trimTypes` compacts the placement array. Report only authored beats that
    // survived that operation, never the number merely attempted beforehand.
    this.openingProps = 0;
    for (let i = 0; i < this.placements.length; i++) {
      if (this.openingPlacements.has(this.placements[i])) this.openingProps++;
    }

    /* -- 4b. RE-TOP-UP: THE TRIM SPENDS DENSITY IT DOES NOT PAY BACK ------- *
     * `trimTypes()` deletes every placement of the types it drops, and until
     * now nothing replaced them. So the density contract was met at 3b and then
     * quietly broken a few lines later, on exactly the maps that trim — the
     * ones with the richest prop mix, which are the ones the density target
     * matters most on.
     *
     * It was masked for the whole life of the module by how much the structured
     * passes used to OVERSHOOT into ineligible ground. With the splat
     * classifier fixed (P0-1) the overshoot is gone and the shortfall is the
     * whole story:
     *
     *     urban preset          94.49/ha against a floor of 95
     *     03-terrain-closeup    3593 props -> 1784   (192/ha -> 95.5/ha)
     *
     * Half the props in the terrain hero shot, deleted after the budget said
     * they were needed. The same top-up, run again over the SURVIVING types, is
     * the whole fix; `grassPlaced` is recomputed from those survivors rather
     * than carried over, because the trim may have taken grass with it.
     *
     * This ADDS placements and never removes one, so the invariant above — the
     * gate is last, and nothing below it may remove a placement — still holds.
     */
    let liveGrass = 0;
    for (let i = 0; i < live.length; i++) {
      if (live[i].def.family === 'grass') liveGrass += live[i].count;
    }
    this.topUpToBudget(
      live, (t) => weights[avail.indexOf(t)], budget, grassCap, liveGrass,
      habitatSeed, rng.fork(),
    );

    this.fillToTarget(live, rng.fork());
    this.types = live.filter((t) => t.count > 0);

    /* -- 5. GPU ----------------------------------------------------------- */
    this.buildInstances();
    this.lastReport = this.validateCoverage();
    this.finishTiming(t0);
  }

  private finishTiming(t0: number): void {
    this.generateMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  }

  /**
   * Settle the biome-authored beats around every MCV opening.
   *
   * The local forward axis points toward map centre, which is the useful
   * strategic route on every generated start table. Beats occupy the sides and
   * rear only; the central forward corridor is intentionally absent. A small
   * deterministic spiral lets a crate move off a slope or a tree move around a
   * unit clearance without dissolving the authored cluster into random scatter.
   */
  private placeOpeningCompositions(avail: readonly ScatterType[], rng: Rng): number {
    const centres = this.opts.openingCenters ?? [];
    if (centres.length === 0) return 0;

    const byKey = new Map<string, ScatterType>();
    for (let i = 0; i < avail.length; i++) byKey.set(avail[i].def.key, avail[i]);
    const beats = OPENING_BEATS[this.opts.biome];
    let placed = 0;

    for (let c = 0; c < centres.length; c++) {
      const centre = centres[c];
      let fx = MAP_SIZE * 0.5 - centre.x;
      let fz = MAP_SIZE * 0.5 - centre.z;
      const fl = Math.hypot(fx, fz);
      if (fl < 1e-4) {
        const a = rng.next() * TAU;
        fx = Math.cos(a); fz = Math.sin(a);
      } else {
        fx /= fl; fz /= fl;
      }
      const rx = -fz, rz = fx;
      const mirror = rng.next() < 0.5 ? -1 : 1;
      const routeYaw = Math.atan2(fx, fz);

      for (let b = 0; b < beats.length; b++) {
        const beat = beats[b];
        const lateral = beat.lateral * mirror;
        const targetX = centre.x + rx * lateral + fx * beat.forward;
        const targetZ = centre.z + rz * lateral + fz * beat.forward;
        const settle = beat.settle ?? 3;
        let landed = false;

        // A key can exist in the biome and still reject this patch's surface
        // or slope. Try the authored fallbacks after the preferred silhouette
        // exhausts its settle spiral; snow ridges are the common case.
        for (let k = 0; k < beat.keys.length && !landed; k++) {
          const type = byKey.get(beat.keys[k]);
          if (type === undefined) continue;

          // Target first, then a golden-angle spiral. The maximum displacement
          // stays smaller than the spacing between authored beats, so their
          // cluster identity survives terrain settling.
          for (let a = 0; a < 18 && !landed; a++) {
            const radius = a === 0 ? 0 : settle * Math.sqrt(a / 17);
            const angle = a * 2.399963229728653 + rng.range(-0.08, 0.08);
            const x = targetX + Math.cos(angle) * radius;
            const z = targetZ + Math.sin(angle) * radius;
            if (!this.legal(type.def, x, z, 0.82)) continue;
            if (!this.place(type.defIndex, type.def, x, z, rng)) continue;
            const p = this.placements[this.placements.length - 1];
            p.yaw = routeYaw + beat.yaw * mirror + rng.range(-0.06, 0.06);
            this.openingPlacements.add(p);
            this.openingDefIndices.add(type.defIndex);
            type.count++;
            placed++;
            landed = true;
          }
        }
      }
    }
    return placed;
  }

  /**
   * Spend clustered vegetation until `this.placements.length` reaches `budget`
   * or the map genuinely has nowhere left to put a bush. Returns the running
   * grass count so the caller can keep honouring `grassCap` across two calls.
   *
   * Called TWICE per generate: once after the structured passes (pass 3b) and
   * once after `trimTypes` has deleted whatever it dropped (pass 4b). It only
   * ever appends, which is what keeps the "nothing may remove a placement after
   * the gate" invariant intact.
   *
   * `pool` is filtered to the modes that can be topped up — a 'street' type
   * needs a kerb polyline and a 'solo' type is a landmark, and neither is
   * something to spray until a number goes up.
   */
  private topUpToBudget(
    pool: readonly ScatterType[],
    weightOf: (t: ScatterType) => number,
    budget: number,
    grassCap: number,
    grassPlaced: number,
    habitatSeed: number,
    rng: Rng,
  ): number {
    const topUp = pool.filter((t) => t.def.mode === 'clump' || t.def.mode === 'field');
    if (topUp.length === 0) return grassPlaced;
    const topWeights = topUp.map((t) => {
      const w = weightOf(t);
      // Grass is capped separately; do not let it eat the whole remainder.
      return t.def.family === 'grass' ? w * 0.5 : w;
    });
    const topTotal = topWeights.reduce((a, b) => a + b, 0);
    if (topTotal <= 0) return grassPlaced;
    let grass = grassPlaced;
    let stalled = 0;
    while (this.placements.length < budget && stalled < 400) {
      const before = this.placements.length;
      // Weighted pick without allocating.
      let roll = rng.next() * topTotal;
      let pick = topUp[0];
      for (let i = 0; i < topUp.length; i++) {
        roll -= topWeights[i];
        if (roll <= 0) { pick = topUp[i]; break; }
      }
      if (pick.def.family === 'grass' && grass >= grassCap) { stalled++; continue; }
      const cellIndex = this.pickClumpCentre(pick.def, rng, habitatSeed);
      if (cellIndex < 0) { stalled++; continue; }
      const cx = ((cellIndex % MAP_CELLS) + 0.5) * CELL;
      const cz = (((cellIndex / MAP_CELLS) | 0) + 0.5) * CELL;
      const n = this.placeClump(pick.defIndex, pick.def, cx, cz, rng);
      pick.count += n;
      if (pick.def.family === 'grass') grass += n;
      if (this.placements.length === before) stalled++; else stalled = 0;
    }
    return grass;
  }

  /**
   * Put one complete clump inside the scenario's photographed box.
   *
   * The previous focus pass placed unrelated singles at uniform random. It
   * increased the number on screen but flattened its composition — exactly
   * the procedural tell the main clump pass works to avoid. Spending the same
   * boost a clump at a time produces dense islands and preserves clear ground
   * between them.
   */
  private placeFocusClump(
    type: ScatterType,
    focus: { minX: number; minZ: number; maxX: number; maxZ: number },
    rng: Rng,
  ): number {
    const def = type.def;
    const family = FAMILY_CODE.indexOf(def.family);
    const gapScale = clamp(this.opts.focusClumpGapScale ?? 1, 0.25, 1);
    for (let a = 0; a < 40; a++) {
      const cx = rng.range(focus.minX, focus.maxX);
      const cz = rng.range(focus.minZ, focus.maxZ);
      if (!this.legal(def, cx, cz)) continue;
      if (this.tooClose(cx, cz, def.spacing)) continue;
      const gap = rng.range(
        SCATTER_CLUSTER.betweenClumpsMin * gapScale,
        SCATTER_CLUSTER.betweenClumpsMax * gapScale,
      );
      if (this.clumpClash(family, cx, cz, gap)) continue;
      const n = this.placeClump(type.defIndex, def, cx, cz, rng);
      if (n <= 0) continue;
      this.addClumpCentre(family, cx, cz);
      return n;
    }
    return 0;
  }

  /**
   * Clump centres are drawn against the same fbm habitat field the 'field' mode
   * uses, and are pushed 20-50 m apart FROM OTHER CENTRES OF THE SAME FAMILY —
   * bible §6.5. Without that separation copses merge into one forest and the
   * map loses its clearings, which is where the gameplay happens.
   *
   * The separation is measured against centres, NOT against every placed prop.
   * Testing against all props looks equivalent and is not: once a map is a few
   * thousand props deep, no cell on it is 20 m from everything, so every clump
   * request fails and density silently halves. That bug is exactly how a
   * scatter system ships at 105/ha against a 221/ha budget.
   */
  private pickClumpCentre(def: PropDef, rng: Rng, habitatSeed: number): number {
    const family = FAMILY_CODE.indexOf(def.family);
    for (let a = 0; a < 48; a++) {
      const i = rng.int(0, MAP_CELL_COUNT - 1);
      if (this.placeable[i] === 0) continue;
      const cx = ((i % MAP_CELLS) + 0.5) * CELL;
      const cz = (((i / MAP_CELLS) | 0) + 0.5) * CELL;
      const h = fbm2(cx * 0.012, cz * 0.012, 3, 2.0, 0.5, habitatSeed);
      if (rng.next() > clamp01(0.25 + h * 1.1)) continue;
      // The centre itself must be clear, or the clump grows around a boulder.
      if (this.tooClose(cx, cz, def.spacing)) continue;
      const gap = rng.range(SCATTER_CLUSTER.betweenClumpsMin, SCATTER_CLUSTER.betweenClumpsMax);
      if (this.clumpClash(family, cx, cz, gap)) continue;
      this.addClumpCentre(family, cx, cz);
      return i;
    }
    return -1;
  }

  /** 3x3 neighbourhood of 64 m buckets covers the 50 m maximum separation. */
  private clumpClash(family: number, x: number, z: number, gap: number): boolean {
    const g2 = gap * gap;
    const bx = clamp(Math.floor(x / CLUMP_BUCKET_METRES), 0, CLUMP_BUCKET_N - 1);
    const bz = clamp(Math.floor(z / CLUMP_BUCKET_METRES), 0, CLUMP_BUCKET_N - 1);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = bx + dx, gz = bz + dz;
        if (gx < 0 || gz < 0 || gx >= CLUMP_BUCKET_N || gz >= CLUMP_BUCKET_N) continue;
        const list = this.clumpBuckets[
          (family * CLUMP_BUCKET_N + gz) * CLUMP_BUCKET_N + gx];
        if (list === undefined) continue;
        for (let c = 0; c < list.length; c += 2) {
          const ddx = list[c] - x, ddz = list[c + 1] - z;
          if (ddx * ddx + ddz * ddz < g2) return true;
        }
      }
    }
    return false;
  }

  private addClumpCentre(family: number, x: number, z: number): void {
    const bx = clamp(Math.floor(x / CLUMP_BUCKET_METRES), 0, CLUMP_BUCKET_N - 1);
    const bz = clamp(Math.floor(z / CLUMP_BUCKET_METRES), 0, CLUMP_BUCKET_N - 1);
    const k = (family * CLUMP_BUCKET_N + bz) * CLUMP_BUCKET_N + bx;
    let list = this.clumpBuckets[k];
    if (list === undefined) { list = []; this.clumpBuckets[k] = list; }
    list.push(x, z);
    this.compositionAnchors.push(x, z, family);
  }

  /**
   * Paint broad, irregular natural-material zones beneath selected clumps.
   *
   * These are deliberately sparse and several cells wide. Fine noise is left
   * to the material shader; doing it here would recreate the repeating grain
   * layer this pass is replacing. A two-octave field only distorts each soft
   * outline, while a rotated ellipse prevents the circles-from-space look.
   */
  paintGroundComposition(): number {
    if (this.compositionAnchors.length === 0 || this.groundPatches > 0) {
      return this.groundPatches;
    }
    const rng = new Rng((this.opts.seed ^ 0x47a8d31b) >>> 0);
    const noiseSeed = (this.opts.seed ^ 0x196e4d27) >>> 0;
    let patches = 0;
    let stamped = 0;

    for (let i = 0; i < this.compositionAnchors.length && patches < 36; i += 3) {
      const x = this.compositionAnchors[i];
      const z = this.compositionAnchors[i + 1];
      const family = this.compositionAnchors[i + 2];
      // Tree copses earn the strongest soil relationship. Grass is already a
      // ground treatment, so only an occasional grass field gets another one.
      const chance = family === FAMILY_CANOPY ? 0.30
        : family === FAMILY_ROCK ? 0.24
          : family === FAMILY_SHRUB ? 0.17
            : family === FAMILY_GRASS ? 0.05 : 0.08;
      if (rng.next() > chance) continue;

      const radius = rng.range(7.0, family === FAMILY_CANOPY ? 12.5 : 11.0);
      const aspect = rng.range(0.58, 0.88);
      const yaw = rng.next() * TAU;
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      const rx = radius;
      const rz = radius * aspect;
      const reach = Math.ceil(radius / CELL) + 1;
      const ccx = Math.floor(x / CELL), ccz = Math.floor(z / CELL);
      // Rock fields expose more stone; all other clusters wear back to soil.
      const layer = family === FAMILY_ROCK ? SurfaceId.Rock : SurfaceId.Dirt;
      let patchCells = 0;

      for (let dz = -reach; dz <= reach; dz++) {
        const cz = ccz + dz;
        if (cz < 0 || cz >= MAP_CELLS) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const cx = ccx + dx;
          if (cx < 0 || cx >= MAP_CELLS) continue;
          const ci = cz * MAP_CELLS + cx;
          const surface = this.terrain.surface[ci];
          if (surface === SurfaceId.Concrete || surface === SurfaceId.Paving) continue;
          if (this.terrain.isWater(cx, cz) || this.terrain.isCliff(cx, cz)) continue;

          const wx = (cx + 0.5) * CELL - x;
          const wz = (cz + 0.5) * CELL - z;
          const lx = wx * cos - wz * sin;
          const lz = wx * sin + wz * cos;
          const ellipse = Math.sqrt((lx * lx) / (rx * rx) + (lz * lz) / (rz * rz));
          // Outline displacement is broad (about 20-35 m wavelengths), never
          // per-texel grit. Different anchors sample different parts of one
          // coherent field, so neighbouring patches can visually relate.
          const warp = fbm2(
            (x + wx) * 0.038,
            (z + wz) * 0.038,
            2, 2.0, 0.5, noiseSeed,
          ) - 0.5;
          const edge = ellipse + warp * 0.34;
          if (edge >= 1.04) continue;
          const core = smoothstep(1.04, 0.12, edge);
          const weight = (family === FAMILY_ROCK ? 0.12 : 0.10)
            + core * (family === FAMILY_ROCK ? 0.20 : 0.24);
          this.terrain.stampSurface(cx, cz, layer, weight);
          patchCells++;
          stamped++;
        }
      }
      if (patchCells > 0) patches++;
    }

    if (stamped > 0) this.terrain.commitSplat();
    this.groundPatches = patches;
    return this.groundPatches;
  }

  /**
   * Compose permanent ground stories around props that already explain them.
   *
   * This deliberately consumes the existing static `DecalField`: every mark
   * remains inside its one pooled colour draw in both renderers. The caps are
   * per semantic family so a dense forest cannot spend the entire pool before
   * the generator reaches a parked car or service cache. A shared separation
   * list leaves clean ground between stories and keeps the battlefield from
   * turning into uniform grime.
   */
  paintGroundStories(
    decals: DecalField,
    _oreFields: readonly GroundStoryAnchor[] = [],
  ): GroundStoryStats {
    if (this.storiesPainted) return this.storyStats;
    this.storiesPainted = true;

    const centres: number[] = [];
    const stats = {
      total: 0, foliage: 0, mineral: 0, service: 0, civic: 0, vehicle: 0, lighting: 0,
    };
    const biome = this.opts.biome;

    const legal = (x: number, z: number, roadOkay = false): boolean => {
      if (x < CELL || z < CELL || x >= MAP_SIZE - CELL || z >= MAP_SIZE - CELL) return false;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      if (this.terrain.isWater(cx, cz) || this.terrain.isCliff(cx, cz)) return false;
      return roadOkay || !isCarriageway(x, z);
    };
    const reserve = (x: number, z: number, gap: number): boolean => {
      const g2 = gap * gap;
      for (let i = 0; i < centres.length; i += 2) {
        const dx = centres[i] - x, dz = centres[i + 1] - z;
        if (dx * dx + dz * dz < g2) return false;
      }
      centres.push(x, z);
      return true;
    };
    const offset = (
      p: Placement, rng: Rng, min: number, max: number,
    ): readonly [number, number, number] => {
      const yaw = p.yaw + rng.range(-0.85, 0.85);
      const d = rng.range(min, max) * p.scale;
      return [p.x + Math.sin(yaw) * d, p.z + Math.cos(yaw) * d, yaw];
    };
    const add = (family: keyof Omit<GroundStoryStats, 'total'>, count = 1): void => {
      stats[family] += count;
      stats.total += count;
    };
    const hasRoom = (count = 1): boolean => stats.total + count <= GROUND_STORY_CAP;

    /* MCV openings need their own readable ground history. The first version
     * spent the complete story budget across the 512 m map, which produced a
     * healthy debug counter and an opening camera with zero identifiable
     * marks. Keep the same global cap, but spend twelve deterministic marks in
     * each start footprint before the world-wide semantic passes compete for
     * the remainder. Only paired tyre trails belong in the multiply layer.
     * Physical debris is real `debrisPile` geometry in `OPENING_BEATS`; putting
     * leaves or stones here produced unmistakable stamped circles. */
    {
      const openings = this.opts.openingCenters ?? [];
      for (let i = 0; i < openings.length && hasRoom(); i++) {
        const centre = openings[i];
        let fx = MAP_SIZE * 0.5 - centre.x;
        let fz = MAP_SIZE * 0.5 - centre.z;
        const length = Math.hypot(fx, fz) || 1;
        fx /= length; fz /= length;
        const rx = -fz, rz = fx;
        const yaw = Math.atan2(fx, fz);

        // Two paired arrival beats, behind the construction vehicle.
        for (const back of [7, 14]) {
          if (!hasRoom(2)) break;
          const bx = centre.x - fx * back;
          const bz = centre.z - fz * back;
          const gauge = 1.25;
          decals.spawn(DecalKind.Tyre, bx + rx * gauge, bz + rz * gauge,
            0.22, 3.4, yaw, 0, 0.72);
          decals.spawn(DecalKind.Tyre, bx - rx * gauge, bz - rz * gauge,
            0.22, 3.4, yaw, 0, 0.72);
          add('vehicle', 2);
        }

      }
    }

    /* Street lighting is a relationship, not another stain. The prop shader
     * owns the bright head; this pooled ellipse is the light arriving on the
     * paving. Faulty lamps deliberately get no permanent pool, so their visual
     * story remains "bad ballast" instead of "shader blinking over a lit disc". */
    {
      const rng = new Rng((this.opts.seed ^ 0x51a77e19) >>> 0);
      let anchors = 0;
      for (let i = 0; i < this.placements.length && anchors < 24 && hasRoom(); i++) {
        const p = this.placements[i];
        const def = PROP_DEFS[p.defIndex];
        if (!p.alive || def === undefined || !LAMP_STORY_KEYS.has(def.key)) continue;
        if (isFaultyLampAt(p.x, p.z) || rng.next() > 0.86) continue;
        if (!legal(p.x, p.z, true) || !reserve(p.x, p.z, 6.5)) continue;
        decals.lightPool(p.x, p.z, 3.6 * p.scale, rng.range(0.18, 0.25));
        add('lighting');
        anchors++;
      }
    }

    /* Parked vehicle + tyre/oil history. The two tyre strips are permanent;
     * movement uses the separate transient track field. */
    {
      const rng = new Rng((this.opts.seed ^ 0x2f5a4c19) >>> 0);
      let anchors = 0;
      for (let i = 0; i < this.placements.length && anchors < 8 && hasRoom(3); i++) {
        const p = this.placements[i];
        const def = PROP_DEFS[p.defIndex];
        if (!p.alive || def === undefined || !VEHICLE_STORY_KEYS.has(def.key)) continue;
        if (rng.next() > 0.82 || !legal(p.x, p.z, true) || !reserve(p.x, p.z, 12)) continue;
        const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
        const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
        const bx = p.x - fx * 1.25 * p.scale;
        const bz = p.z - fz * 1.25 * p.scale;
        const gauge = 0.72 * p.scale;
        decals.spawn(DecalKind.Tyre, bx + rx * gauge, bz + rz * gauge,
          0.13, 1.55 * p.scale, p.yaw, 0, 0.58);
        decals.spawn(DecalKind.Tyre, bx - rx * gauge, bz - rz * gauge,
          0.13, 1.55 * p.scale, p.yaw, 0, 0.58);
        decals.oil(
          p.x - fx * 0.55 * p.scale,
          p.z - fz * 0.55 * p.scale,
          rng.range(0.65, 1.15) * p.scale,
          p.yaw + rng.range(-0.25, 0.25),
          rng.range(0.38, 0.52),
        );
        add('vehicle', 3);
        anchors++;
      }
    }

    /* Yard caches get one broad traffic stain and, occasionally, a small
     * litter edge. The prop is the reason for both marks. */
    {
      const rng = new Rng((this.opts.seed ^ 0x6ac31e07) >>> 0);
      let anchors = 0;
      for (let i = 0; i < this.placements.length && anchors < 10 && hasRoom(); i++) {
        const p = this.placements[i];
        const def = PROP_DEFS[p.defIndex];
        if (!p.alive || def === undefined || !SERVICE_STORY_KEYS.has(def.key)) continue;
        if (rng.next() > 0.42 || !reserve(p.x, p.z, 10)) continue;
        const [x, z, yaw] = offset(p, rng, 0.3, 1.1);
        if (!legal(x, z)) continue;
        decals.spawn(
          biome === 'snow' ? DecalKind.Grime : DecalKind.Dust,
          x, z, rng.range(2.5, 4.0), rng.range(3.8, 6.2), yaw, 0,
          biome === 'snow' ? rng.range(0.16, 0.24) : rng.range(0.18, 0.28),
        );
        add('service');
        anchors++;
      }
    }

    /* Canopy contact changes by theatre: fallen leaves in temperate/urban,
     * dirty compressed snow below conifers, and wind-blown dust below palms. */
    {
      const rng = new Rng((this.opts.seed ^ 0x1be749d3) >>> 0);
      let anchors = 0;
      for (let i = 0; i < this.placements.length && anchors < 16 && hasRoom(); i++) {
        const p = this.placements[i];
        const def = PROP_DEFS[p.defIndex];
        if (!p.alive || def?.family !== 'canopy') continue;
        const chance = def.key === 'treeAutumn' ? 0.72 : 0.16;
        if (rng.next() > chance || !reserve(p.x, p.z, 11)) continue;
        const [x, z, yaw] = offset(p, rng, 0.1, 1.2);
        if (!legal(x, z)) continue;
        // Fallen leaves are physical objects. The old LeafLitter multiply tile
        // was nine dark ovals and read exactly like nine dark ovals. Temperate
        // and urban maps now get real debrisPile geometry instead.
        if (biome === 'temperate' || biome === 'urban') continue;
        const kind = biome === 'snow' ? DecalKind.Grime : DecalKind.Dust;
        decals.spawn(kind, x, z, rng.range(2.2, 3.7), rng.range(3.0, 5.0), yaw, 0,
          rng.range(0.18, 0.28));
        add('foliage');
        anchors++;
      }
    }

    this.storyStats = stats;
    this.groundStoryMarks = stats.total;
    return this.storyStats;
  }

  groundStories(): GroundStoryStats { return this.storyStats; }

  /**
   * THE ADORNMENT GATE, AUTOMATED (bible §6.6, scorecard #15, weight 3).
   *
   * Two rules, in priority order:
   *   (a) no walkable square larger than 25x25 m may be completely unadorned;
   *   (b) at least 55% of walkable ground must be adorned overall.
   *
   * (a) is the ship-blocking rule and is closed first, by dropping a small
   * cluster into the middle of every patch the validator reports. (b) is then
   * raised by seeding fillers into randomly-sampled unadorned cells. Each pass
   * re-validates, because closing one hole reshapes its neighbours; and inside
   * a pass every placement immediately stamps its own adornment disc, so a
   * thousand attempts do not all pile into the same clearing.
   *
   * Terrain surface variation counts toward (b) as well, so on a map with a
   * rich splat this loop does almost nothing — which is the intent. It only
   * works hard on exactly the maps that would otherwise ship as a green plane.
   */
  private fillToTarget(avail: ScatterType[], rng: Rng): void {
    // Fillers must be cheap, legal almost anywhere, and small enough that
    // dropping three into a gap does not build a wall across it.
    const fillers = avail.filter((t) => !t.def.blocksNav
      && (t.def.family === 'grass' || t.def.family === 'shrub' || t.def.family === 'rock'));
    if (fillers.length === 0) return;

    // Adornment may overshoot the density budget — rule (b) is weight 3 and
    // the budget is a target — but never without bound.
    const ceiling = Math.min(SCATTER_LIMITS.maxProps, Math.round(this.budget * 1.8) + 400);
    const G = SCATTER_COVERAGE.gridMetres;

    for (let pass = 0; pass < SCATTER_COVERAGE.fillPasses; pass++) {
      const report = this.validateCoverage();
      const needPatches = report.emptyPatches.length > 0;
      const needAdorn = report.adornedFraction < SCATTER_COVERAGE.targetAdorned;
      if (!needPatches && !needAdorn) break;
      if (this.placements.length >= ceiling) break;
      let any = false;

      /* (a) the ship-blocking rule */
      for (let p = 0; p < report.emptyPatches.length; p++) {
        const patch = report.emptyPatches[p];
        for (let k = 0; k < SCATTER_COVERAGE.fillPerPatch; k++) {
          const pick = rng.pick(fillers);
          for (let a = 0; a < 12; a++) {
            const x = patch.x + rng.range(-1, 1) * patch.size * 0.42;
            const z = patch.z + rng.range(-1, 1) * patch.size * 0.42;
            if (!this.legal(pick.def, x, z, 0.6)) continue;
            if (!this.place(pick.defIndex, pick.def, x, z, rng)) break;
            this.stampAdorn(x, z, pick.def.adorn);
            pick.count++; any = true;
            break;
          }
        }
      }

      /* (b) the 55% floor */
      if (needAdorn) {
        // One attempt per unadorned cell we would have to cover, times a
        // rejection allowance. Bounded, so a map that physically cannot be
        // adorned (all cliff, all road) terminates instead of spinning.
        const shortfall = SCATTER_COVERAGE.targetAdorned - report.adornedFraction;
        const attempts = Math.min(24000, Math.ceil(shortfall * COVER_COUNT * 2.5));
        for (let a = 0; a < attempts && this.placements.length < ceiling; a++) {
          const gi = rng.int(0, COVER_COUNT - 1);
          if (this.coverWalkable[gi] === 0 || this.coverAdorned[gi] !== 0) continue;
          const gx = gi % COVER_N, gz = (gi / COVER_N) | 0;
          const x = (gx + rng.next()) * G, z = (gz + rng.next()) * G;
          const pick = rng.pick(fillers);
          if (!this.legal(pick.def, x, z, 0.7)) continue;
          if (!this.place(pick.defIndex, pick.def, x, z, rng)) break;
          this.stampAdorn(x, z, pick.def.adorn);
          pick.count++; any = true;
        }
      }
      if (!any) break;
    }
  }

  /**
   * Mark a disc adorned in the live raster, so the rest of THIS pass stops
   * trying to fill ground it has already covered. The next pass rebuilds the
   * raster from scratch anyway; this is purely an intra-pass optimisation and
   * it is what keeps the 55% loop from degenerating into a pile of bushes.
   */
  private stampAdorn(x: number, z: number, radius: number): void {
    const G = SCATTER_COVERAGE.gridMetres;
    const gr = Math.ceil(radius / G);
    const gcx = (x / G) | 0, gcz = (z / G) | 0;
    const r2 = radius * radius;
    for (let dz = -gr; dz <= gr; dz++) {
      const gz = gcz + dz;
      if (gz < 0 || gz >= COVER_N) continue;
      for (let dx = -gr; dx <= gr; dx++) {
        const gx = gcx + dx;
        if (gx < 0 || gx >= COVER_N) continue;
        const wx = (gx + 0.5) * G - x, wz = (gz + 0.5) * G - z;
        if (wx * wx + wz * wz > r2) continue;
        this.coverAdorned[gz * COVER_N + gx] = 1;
      }
    }
  }

  /**
   * Keep the draw-call budget. Each live type costs one colour draw and one
   * shadow draw, and MAX_DRAW_CALLS is 130 with terrain already at ~34.
   *
   * Types are ranked by ADORNMENT AREA DELIVERED (`count * adorn^2`) times an
   * editorial family weight — not by instance count.
   *
   * Two corrections are baked in, both learned from looking at the result:
   *   - Ranking by raw count drops the statues and the water tower to keep
   *     forty barrels, because barrels are numerous. Area delivered is what
   *     this module exists to produce, so that is what the budget buys.
   *   - Area alone still drops LANDMARKS, because a plaza only holds six
   *     statues however important they are. `refs/ra3steam_08.jpg` carries six
   *     statues and one water tower on 1.3 ha and they define the frame, so
   *     civic props are weighted well above their count.
   */
  private trimTypes(avail: ScatterType[]): ScatterType[] {
    const cap = Math.max(1, Math.round(this.opts.maxTypes ?? SCATTER_LIMITS.maxTypes));
    const placed = avail.filter((t) => t.count > 0);
    /*
     * A type that placed NOTHING is not costing a draw call, and the passes
     * that run after this one may yet find it a home — so it stays in the
     * returned set whenever there is room, which is what keeps this reorder
     * behaviour-neutral on the eight maps that never trim. It is only ever
     * squeezed out by a type that has already earned its slot.
     */
    const idle = avail.filter((t) => t.count === 0);
    if (placed.length <= cap) {
      return placed.concat(idle.slice(0, cap - placed.length));
    }
    const familyWeight = (t: ScatterType): number =>
      t.def.family === 'civic' ? 5.0 : t.def.family === 'canopy' ? 1.7 : 1.0;
    const score = (t: ScatterType): number =>
      (this.openingDefIndices.has(t.defIndex) ? 1e12 : 0)
      + t.count * t.def.adorn * t.def.adorn * familyWeight(t);
    const ranked = placed.slice().sort((a, b) => score(b) - score(a));
    const keep = new Set(ranked.slice(0, cap));
    const dropped = new Set(ranked.slice(cap).map((t) => t.defIndex));
    // Compact the placements, dropping instances of trimmed types.
    const kept: Placement[] = [];
    for (let i = 0; i < this.placements.length; i++) {
      if (!dropped.has(this.placements[i].defIndex)) kept.push(this.placements[i]);
    }
    this.placements = kept;
    /*
     * REBUILD THE SPACING INDEX, HERE, BECAUSE THIS IS WHERE IT BREAKS.
     *
     * `bucketHead`/`bucketNext` hold INDICES into `placements`, written
     * incrementally by `place()`. Compacting the array above invalidates every
     * one of them. `rebuildCellIndex()` already existed and already said so in
     * its own docstring — but it was only called from `buildInstances()`, i.e.
     * after the last `place()` of the run, so the stale window was empty and
     * nobody could hit it.
     *
     * Moving the trim ahead of the top-up opened that window, and the first
     * boot into it crashed: `tooClose` walked a bucket chain into an index past
     * the end of the compacted array and dereferenced `undefined.x`. Owning the
     * rebuild here rather than at the call site means the next person to move
     * this call cannot reopen it.
     */
    this.rebuildCellIndex();
    console.warn(
      `[scatter] ${dropped.size} prop type(s) trimmed to hold the ${cap}-type ` +
      'draw-call budget (SCATTER_LIMITS.maxTypes in core/config.ts)',
    );
    return avail.filter((t) => keep.has(t));
  }

  /* ======================================================================
   * 3.6 GPU BUILD
   * ====================================================================== */

  private buildInstances(): void {
    // Bucket placements by surviving type. `defIndex` indexes PROP_DEFS, so
    // trimming a type can never shift an instance onto the wrong mesh.
    const slotOfDef = new Int32Array(PROP_DEFS.length).fill(-1);
    for (let i = 0; i < this.types.length; i++) slotOfDef[this.types[i].defIndex] = i;
    const perType: Placement[][] = this.types.map(() => []);
    for (let i = 0; i < this.placements.length; i++) {
      const p = this.placements[i];
      // `trimTypes()` may have rebuilt the array, so stamp identity HERE — the
      // GPU buffers are about to store these indices for the rest of the match.
      p.index = i;
      p.slot = -1; p.inst = -1; p.chunk = -1; p.alive = true;
      const slot = slotOfDef[p.defIndex];
      if (slot < 0) continue;
      perType[slot].push(p);
    }
    this.liveProps = this.placements.length;
    // The list is final here — `trimTypes()` has already compacted it and every
    // `index` above was just stamped. Hashing it once is what lets §3.10b's
    // one-bit-per-placement mask be handed between two Scatters.
    this.placementHash = this.computePlacementHash();

    this.chunkMinY.fill(Infinity);
    this.chunkMaxY.fill(-Infinity);
    this.chunkUsed.fill(0);

    for (let s = 0; s < this.types.length; s++) {
      const type = this.types[s];
      const list = perType[s];
      type.count = list.length;
      if (list.length === 0) { type.mesh = null; continue; }

      // Counting sort by chunk.
      const counts = new Int32Array(CHUNK_COUNT + 1);
      for (let i = 0; i < list.length; i++) counts[chunkOf(list[i].x, list[i].z) + 1]++;
      for (let c = 0; c < CHUNK_COUNT; c++) counts[c + 1] += counts[c];
      const start = counts.slice();
      const sorted: Placement[] = new Array(list.length);
      const cursor = counts.slice(0, CHUNK_COUNT);
      for (let i = 0; i < list.length; i++) {
        const c = chunkOf(list[i].x, list[i].z);
        sorted[cursor[c]++] = list[i];
      }

      const mat = new Float32Array(list.length * 16);
      const col = new Float32Array(list.length * 3);
      const phase = new Float32Array(list.length);
      const live = new Int32Array(CHUNK_COUNT);
      const instOf = new Int32Array(list.length);
      for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        composeMatrix(p, mat, i * 16);
        /*
         * READ BACK OUT OF THE MATRIX WE JUST WROTE, not recomputed from `p`.
         * The GLSL's phase is `instanceMatrix[3].x * phaseX + [3].z * phaseZ`,
         * and columns 12 and 14 ARE that translation — so taking them from here
         * makes the two paths agree by construction rather than by two people
         * typing `p.x` and `p.z` in the same order. It is also the line that
         * would keep working if `composeMatrix` ever gained an offset.
         */
        phase[i] = mat[i * 16 + 12] * PROP_WIND.phaseX + mat[i * 16 + 14] * PROP_WIND.phaseZ;
        col[i * 3] = p.cr; col[i * 3 + 1] = p.cg; col[i * 3 + 2] = p.cb;
        const c = chunkOf(p.x, p.z);
        p.slot = s; p.inst = i; p.chunk = c;
        instOf[i] = p.index;
        live[c]++;
        this.chunkUsed[c] = 1;
        const top = p.y + type.geo.boundHeight * p.scale;
        if (p.y < this.chunkMinY[c]) this.chunkMinY[c] = p.y;
        if (top > this.chunkMaxY[c]) this.chunkMaxY[c] = top;
      }

      type.srcMatrix = mat;
      type.srcColor = col;
      type.srcPhase = phase;
      type.chunkStart = start;
      type.chunkLive = live;
      type.instOf = instOf;
      const reach = type.geo.boundRadius
        * (type.def.scaleMax ?? SCATTER_JITTER.scaleMax);
      if (reach > this.maxPropReach) this.maxPropReach = reach;

      if (this.batchedNodePath) {
        type.mesh = null;
        type.drawCount = 0;
        continue;
      }

      const meshMaterial = type.geo.material ?? this.materials.material;
      const mesh = new THREE.InstancedMesh(type.geo.geometry, meshMaterial, list.length);
      mesh.name = `prop.${type.def.key}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      /*
       * The wind phase, as a real per-instance attribute.
       *
       * ON THE TYPE'S OWN GEOMETRY, which is safe because `Scatter` builds its
       * own `PropLibrary` (see the constructor) and there is exactly one
       * `InstancedMesh` per type — `entity-props.system.ts` has a separate
       * library and therefore separate geometries. An instanced attribute is
       * sized by the instance count, so a geometry shared between two meshes of
       * different populations would read past the end of one of them.
       */
      const phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1);
      phaseAttr.setUsage(THREE.DynamicDrawUsage);
      type.geo.geometry.setAttribute(PROP_WIND_PHASE_ATTRIBUTE, phaseAttr);
      // Per TYPE, not per instance: an InstancedMesh is one submission, so the
      // shadow pass either gets all 735 grass tufts of the stock temperate
      // layout or none of them.
      mesh.castShadow = typeCastsShadow(type.def, type.geo, this.legacyShadows);
      mesh.receiveShadow = true;
      // Assigned either way. It is inert while `castShadow` is false, and
      // leaving it wired means flipping the gate back on for one type never
      // silently loses the wind animation from its depth pass.
      /*
       * NULL ON THE NODE PATH, AND THE WIND STILL REACHES THE SHADOW MAP.
       * `PropNodeMaterial` sets `castShadowPositionNode`, which the node
       * renderer harvests onto the shadow pass's override material — so a
       * swaying canopy casts a swaying shadow with no second material and no
       * extra upload. `docs/RENDER_FINDINGS.md` §7e.
       */
      if (type.geo.material === undefined && this.materials.depthMaterial !== null) {
        mesh.customDepthMaterial = this.materials.depthMaterial;
      }
      // We cull by chunk on the CPU; three's own test would use a bounding
      // sphere spanning the whole map and never reject anything.
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.count = 0;
      type.mesh = mesh;
      type.drawCount = 0;
      this.root.add(mesh);
    }

    if (this.batchedNodePath) this.buildNodeBatches();

    // Chunks with no props still need finite Y bounds for the culling sphere.
    for (let c = 0; c < CHUNK_COUNT; c++) {
      if (this.chunkUsed[c] === 0) { this.chunkMinY[c] = 0; this.chunkMaxY[c] = 0; }
    }
    this.rebuildCellIndex();
    // Force a repack on the next update().
    this.chunkVisiblePrev.fill(255);
  }

  /**
   * Re-point the 4 m cell buckets at the FINAL placement list.
   *
   * They were built incrementally by `place()` for the min-spacing test, but
   * `trimTypes()` compacts the array behind them, so every index in them can be
   * stale by the time the GPU build runs. Rebuilding here is O(props) once per
   * `generate()` — and it is what lets `clearFootprint()` be local.
   */
  private rebuildCellIndex(): void {
    this.resetBuckets(Math.max(this.placements.length, 1));
    for (let i = 0; i < this.placements.length; i++) {
      const p = this.placements[i];
      if (!p.alive) continue;
      this.bucketInsert(i, p.x, p.z);
    }
  }

  /* ======================================================================
   * 3.7 PER-FRAME
   * ====================================================================== */

  /**
   * Cull by chunk and repack the instance buffers if the visible set changed.
   *
   * Cost when the camera has not crossed a chunk boundary: 256 sphere tests
   * plus a 256-byte compare. Cost when it has: one straight copy of the
   * visible matrices, and a `bufferSubData` of exactly that copy rather than of
   * the whole allocation — see `markRange`. Zero allocation either way, which
   * is why the range objects live on `ScatterType`.
   */
  update(camera: THREE.Camera, timeSeconds: number): void {
    this.materials.setTime(timeSeconds);
    if (this.types.length === 0) return;

    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);

    // AABB, not a bounding sphere. A 32 m chunk's half-diagonal is 22.6 m, so a
    // sphere test silently inflates every chunk by 70% and selects ~3.9 ha to
    // show 0.5 ha — and, worse, stops responding to zoom at all. `intersectsBox`
    // is exact and costs the same.
    const margin = SCATTER_LIMITS.shadowMarginMetres;
    let visible = 0;
    for (let c = 0; c < CHUNK_COUNT; c++) {
      if (this.chunkUsed[c] === 0) { this.chunkVisible[c] = 0; continue; }
      const x0 = (c % CHUNK_N) * SCATTER_CHUNK_METRES;
      const z0 = ((c / CHUNK_N) | 0) * SCATTER_CHUNK_METRES;
      this.probe.min.set(x0 - margin, this.chunkMinY[c] - 1, z0 - margin);
      this.probe.max.set(
        x0 + SCATTER_CHUNK_METRES + margin,
        this.chunkMaxY[c] + 1,
        z0 + SCATTER_CHUNK_METRES + margin,
      );
      const v = this.frustum.intersectsBox(this.probe) ? 1 : 0;
      this.chunkVisible[c] = v;
      visible += v;
    }

    let changed = false;
    for (let c = 0; c < CHUNK_COUNT; c++) {
      if (this.chunkVisible[c] !== this.chunkVisiblePrev[c]) { changed = true; break; }
    }
    if (!changed) return;
    this.chunkVisiblePrev.set(this.chunkVisible);
    this.visibleChunks = visible;

    if (this.batchedNodePath) {
      let instances = 0;
      for (let s = 0; s < this.types.length; s++) {
        const type = this.types[s];
        const batch = type.batch;
        if (batch === null) continue;
        const start = type.chunkStart;
        let drawn = 0;
        for (let c = 0; c < CHUNK_COUNT; c++) {
          const showChunk = this.chunkVisible[c] !== 0;
          const a = start[c], b = start[c + 1];
          for (let i = a; i < b; i++) {
            const placement = this.placements[type.instOf[i]];
            const show = showChunk && placement?.alive === true;
            batch.setVisibleAt(type.batchInstances[i], show);
            if (show) drawn++;
          }
        }
        type.drawCount = drawn;
        instances += drawn;
      }
      this.visibleInstances = instances;
      return;
    }

    let instances = 0;
    for (let s = 0; s < this.types.length; s++) {
      const type = this.types[s];
      const mesh = type.mesh;
      if (mesh === null) continue;
      const dstM = mesh.instanceMatrix.array as Float32Array;
      const dstC = (mesh.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array;
      const phaseAttr = mesh.geometry.getAttribute(
        PROP_WIND_PHASE_ATTRIBUTE,
      ) as THREE.InstancedBufferAttribute;
      const dstP = phaseAttr.array as Float32Array;
      const srcM = type.srcMatrix, srcC = type.srcColor, srcP = type.srcPhase;
      const start = type.chunkStart;
      const liveIn = type.chunkLive;
      let w = 0;
      for (let c = 0; c < CHUNK_COUNT; c++) {
        if (this.chunkVisible[c] === 0) continue;
        // The LIVE half of the chunk's slice. Felled props were swapped into
        // the tail, past `a + liveIn[c]`, and are simply never read again.
        const a = start[c], b = a + liveIn[c];
        if (a === b) continue;
        // Manual copies: `subarray()` would allocate a view every chunk, and
        // this runs on a camera pan.
        let sm = a * 16, dm = w * 16;
        for (let i = a; i < b; i++) {
          for (let k = 0; k < 16; k++) dstM[dm + k] = srcM[sm + k];
          sm += 16; dm += 16;
        }
        let sc = a * 3, dc = w * 3;
        for (let i = a; i < b; i++) {
          dstC[dc] = srcC[sc]; dstC[dc + 1] = srcC[sc + 1]; dstC[dc + 2] = srcC[sc + 2];
          sc += 3; dc += 3;
        }
        // Same repack, one float wide. It rides the SAME cursor as the matrix
        // and the colour, so instance k of the packed buffer is one prop in all
        // three columns — a phase that drifted out of step with the transform
        // would sway the wrong trees and look exactly like a placement bug.
        for (let i = a, dp = w; i < b; i++, dp++) dstP[dp] = srcP[i];
        w += b - a;
      }
      mesh.count = w;
      type.drawCount = w;
      instances += w;
      if (w > 0) {
        // Upload the PREFIX, not the capacity. Both buffers are allocated at
        // the type's full population (`list.length`) and a bare
        // `needsUpdate = true` makes three `bufferSubData` the entire array, so
        // a camera that pans one 32 m chunk into view re-sent every matrix of
        // every type. MEASURED on the stock temperate layout — 4131 props, well
        // under the 9000 ceiling, which is a CAP and not the live budget: 307 kB
        // per repack before, and after, from the RA3 camera rig, 40 kB at 40 m /
        // 53 kB at 60 m / 84 kB at 90 m, i.e. 13-28%. The saving is
        // (1 - visible fraction), and it lands only on the frames where the
        // visible CHUNK SET actually flips — at `SCATTER_CHUNK_METRES` = 32 that
        // is a minority of pan frames. A few hundred kB, not a frame-rate fix.
        //
        // The repack cursor `w` writes from index 0 upward with no gaps, so
        // [0, w) is exactly what changed.
        markRange(mesh.instanceMatrix, type.rangeMatrix, w * 16);
        markRange(mesh.instanceColor as THREE.InstancedBufferAttribute, type.rangeColor, w * 3);
        markRange(phaseAttr, type.rangePhase, w);
      }
    }
    this.visibleInstances = instances;
  }

  /* ======================================================================
   * 3.8 COVERAGE VALIDATION — the automated gate for scorecard #15
   * ====================================================================== */

  /**
   * Rasterise adornment and report every fully-unadorned walkable square
   * larger than 25 m. Bible §6.6:
   *
   *   "No contiguous walkable ground region larger than 25 m x 25 m may contain
   *    zero props AND zero texture-variation events AND zero decals."
   *
   * A cell counts as adorned when a prop's `adorn` disc covers it, when the
   * terrain splat there is not the biome's base layer (a texture-variation
   * event), when a structure occupies it, or when it lies inside a scenario
   * exclusion — ground the placer is forbidden to use, and which is therefore
   * owned by whatever excluded it. See the note at that line. Water, cliffs and
   * impassable ground are outside the walkable domain entirely, so a lake is
   * not a violation.
   *
   * Reported patches never overlap: a per-column block row is carried down the
   * scan, which is also what makes the fill loop converge.
   */
  validateCoverage(box?: { minX: number; minZ: number; maxX: number; maxZ: number }): CoverageReport {
    const G = SCATTER_COVERAGE.gridMetres;
    const t = this.terrain;
    this.coverWalkable.fill(0);
    this.coverAdorned.fill(0);

    const x0 = box ? Math.max(0, Math.floor(box.minX / G)) : 0;
    const x1 = box ? Math.min(COVER_N, Math.ceil(box.maxX / G)) : COVER_N;
    const z0 = box ? Math.max(0, Math.floor(box.minZ / G)) : 0;
    const z1 = box ? Math.min(COVER_N, Math.ceil(box.maxZ / G)) : COVER_N;

    // Pass 1: the walkable domain.
    let walkableCells = 0;
    for (let gz = z0; gz < z1; gz++) {
      for (let gx = x0; gx < x1; gx++) {
        const wx = (gx + 0.5) * G, wz = (gz + 0.5) * G;
        const cx = Math.min(MAP_CELLS - 1, (wx / CELL) | 0);
        const cz = Math.min(MAP_CELLS - 1, (wz / CELL) | 0);
        const ci = cz * MAP_CELLS + cx;
        if (t.waterGrid[ci] !== 0) continue;
        if ((t.passGrid[ci] & PASS_GROUND) === 0) continue;
        this.coverWalkable[gz * COVER_N + gx] = 1;
        walkableCells++;
      }
    }

    /*
     * Pass 2: adornment from the terrain itself — HARD SURFACE ONLY.
     *
     * "NOT THE BIOME'S BASE LAYER" IS NOT THE SAME FACT AS "HAS SOMETHING ON
     * IT", AND THIS TESTED THE FIRST ONE. The rule used to be "this cell's
     * splat differs from the DOMINANT layer", taken off a histogram of the
     * whole walkable map so a desert did not score 100% adorned off its own
     * sand. That was defensible only while non-base surface was rare, and it
     * stopped being rare: the splat classifier was thresholding a Gaussian fbm
     * as though it were uniform, and with that fixed (P0-1, `terrain-gen.ts`)
     * non-base ground goes from ~4% of cells to ~33%. Measured on a PROPLESS
     * temperate map, before -> after:
     *
     *     adornedFraction   0.0397 -> 0.3277
     *     emptyPatches      84     -> 0
     *
     * So terrain alone passed a ship-blocking gate — scorecard #15, weight 3 —
     * on a map with not one prop on it, and the two `emptyPatches > 10`
     * assertions that are the ONLY proof in the suite that this validator can
     * still fail passed vacuously.
     *
     * "Sits on a splat BOUNDARY" was tried next and is worse, not better: fbm
     * dirt at 4 m cells is finely divided, so the propless figure went to
     * 0.67-0.81 across the four biomes. A rule that marks four fifths of an
     * empty map is not a rule.
     *
     * So the test is the material, and only the materials that are a DIFFERENT
     * material: `Concrete` and `Paving` — building pads and roads, bible §6.6's
     * "painted marking, or a distinct second material". Grass, dirt, sand and
     * scree are all THE GROUND. A twenty-six metre square of bare dirt is
     * exactly as unadorned as a twenty-six metre square of bare grass, and it
     * is the fill pass's job to put something on it.
     *
     * This is also what puts the density back. `fillToTarget` is the mechanism
     * that keeps ground from being empty, and counting dirt as adornment had
     * switched it off — `03-terrain-closeup` fell from 192/ha to 108/ha with
     * nothing else changed, because the gate stopped asking for anything.
     *
     * The histogram and its `baseSurface` are deleted rather than corrected:
     * the biome-independence they bought is free here, since no biome uses
     * Concrete or Paving as its base layer.
     */
    for (let gz = z0; gz < z1; gz++) {
      for (let gx = x0; gx < x1; gx++) {
        const i = gz * COVER_N + gx;
        if (this.coverWalkable[i] === 0) continue;
        const cx = Math.min(MAP_CELLS - 1, (((gx + 0.5) * G) / CELL) | 0);
        const cz = Math.min(MAP_CELLS - 1, (((gz + 0.5) * G) / CELL) | 0);
        const ci = cz * MAP_CELLS + cx;
        const s0 = t.surface[ci];
        const hardSurface = s0 === SurfaceId.Concrete || s0 === SurfaceId.Paving;
        if (hardSurface || t.isOccupied(cx, cz)) { this.coverAdorned[i] = 1; continue; }
        /*
         * GROUND THE PLACER IS FORBIDDEN TO TOUCH IS NOT UNADORNED GROUND.
         *
         * `07-soviet-base` failed this gate — scorecard #15, weight 3 — on one
         * 26 m patch at (201, 245), and it was unfixable by construction:
         * sampled at 2 m, all 196 points inside it are covered by a scenario
         * exclusion disc, so `placeable` is 0 across the whole square and
         * `legal()` rejects every filler at every attempt. Ten fill passes ran
         * and placed nothing, and the warning then told the reader to raise
         * `SCATTER_COVERAGE.fillPasses` or `MAP_PRESETS[...].scatter`, neither
         * of which can move a number that no placement is allowed to affect.
         *
         * The defect was a domain mismatch, not a shortage of props. The patch
         * scan runs over `walkable` — water, cliff and impassable ground
         * removed, nothing else — while the fillers run over `placeable`, which
         * also removes structure footprints and every exclusion. So the gate
         * was asserting a property of ground the module has no authority over.
         *
         * Exclusions are not arbitrary: `scatter.system.ts` adds one for every
         * building (footprint + 7 m of deploy apron), every unit, every ore
         * field and the build ghost. That patch is the middle of a Soviet base,
         * ringed by structures and deliberately kept clear so vehicles can get
         * out. It is adorned by the base, the same way a cell UNDER a structure
         * is already counted adorned one line above — this is that rule applied
         * to the apron the same structure requires.
         *
         * It is deliberately NOT applied to the density denominator: `walkable`
         * still drives `propsPerHectare`, so a base-heavy map still reports the
         * lower figure it honestly earns. Only the gate's domain moves, and it
         * moves onto the ground the gate can actually act on.
         */
        if (this.exclusions.length > 0) {
          const wx = (gx + 0.5) * G, wz = (gz + 0.5) * G;
          if (this.inExclusion(wx, wz, 0)) this.coverAdorned[i] = 1;
        }
      }
    }

    // Stamp every prop's adornment disc.
    for (let p = 0; p < this.placements.length; p++) {
      const pl = this.placements[p];
      if (!pl.alive) continue;
      const def = PROP_DEFS[pl.defIndex];
      if (def === undefined) continue;
      const r = def.adorn * pl.scale;
      const gr = Math.ceil(r / G);
      const gcx = (pl.x / G) | 0, gcz = (pl.z / G) | 0;
      const r2 = r * r;
      for (let dz = -gr; dz <= gr; dz++) {
        const gz = gcz + dz;
        if (gz < z0 || gz >= z1) continue;
        for (let dx = -gr; dx <= gr; dx++) {
          const gx = gcx + dx;
          if (gx < x0 || gx >= x1) continue;
          const wx = (gx + 0.5) * G - pl.x, wz = (gz + 0.5) * G - pl.z;
          if (wx * wx + wz * wz > r2) continue;
          this.coverAdorned[gz * COVER_N + gx] = 1;
        }
      }
    }

    let adornedCells = 0;
    for (let i = 0; i < COVER_COUNT; i++) {
      if (this.coverWalkable[i] !== 0 && this.coverAdorned[i] !== 0) adornedCells++;
    }

    /* -- summed-area table over "walkable AND unadorned" ------------------ */
    const S = COVER_N + 1;
    const sat = this.coverSat;
    sat.fill(0);
    for (let gz = 0; gz < COVER_N; gz++) {
      let rowSum = 0;
      for (let gx = 0; gx < COVER_N; gx++) {
        const i = gz * COVER_N + gx;
        rowSum += (this.coverWalkable[i] !== 0 && this.coverAdorned[i] === 0) ? 1 : 0;
        sat[(gz + 1) * S + (gx + 1)] = sat[gz * S + (gx + 1)] + rowSum;
      }
    }
    const windowSum = (gx: number, gz: number): number =>
      sat[(gz + PATCH_CELLS) * S + gx + PATCH_CELLS] - sat[gz * S + gx + PATCH_CELLS]
      - sat[(gz + PATCH_CELLS) * S + gx] + sat[gz * S + gx];

    const full = PATCH_CELLS * PATCH_CELLS;
    const patches: EmptyPatch[] = [];
    this.coverBlocked.fill(-1);
    const maxZ = Math.min(z1, COVER_N) - PATCH_CELLS;
    const maxX = Math.min(x1, COVER_N) - PATCH_CELLS;
    for (let gz = z0; gz <= maxZ && patches.length < 128; gz++) {
      let gx = x0;
      while (gx <= maxX && patches.length < 128) {
        if (windowSum(gx, gz) !== full) { gx++; continue; }
        // Reject a window overlapping one already reported.
        let blockedAt = -1;
        for (let c = gx; c < gx + PATCH_CELLS; c++) {
          if (this.coverBlocked[c] >= gz) { blockedAt = c; break; }
        }
        if (blockedAt >= 0) { gx = blockedAt + 1; continue; }
        for (let c = gx; c < gx + PATCH_CELLS; c++) this.coverBlocked[c] = gz + PATCH_CELLS - 1;
        patches.push({
          x: (gx + PATCH_CELLS * 0.5) * G,
          z: (gz + PATCH_CELLS * 0.5) * G,
          size: PATCH_CELLS * G,
        });
        gx += PATCH_CELLS;
      }
    }

    const hectares = Math.max(walkableCells * G * G / 10000, 1e-6);
    return {
      adornedFraction: walkableCells === 0 ? 1 : adornedCells / walkableCells,
      walkableHectares: hectares,
      propsPerHectare: this.propCount / hectares,
      emptyPatches: patches,
      passes: patches.length === 0,
    };
  }

  /* ======================================================================
   * 3.9 QUERIES FOR OTHER MODULES
   * ====================================================================== */

  /**
   * Every prop that would physically stop a vehicle, as (x, z, radius)
   * triples written into `out`. Returns the number of triples written.
   *
   * Scatter never writes the nav grid — terrain owns it — so this is how a
   * navigation module consumes prop collision when it wants to.
   */
  blockers(out: Float32Array): number {
    let n = 0;
    for (let i = 0; i < this.placements.length && (n + 1) * 3 <= out.length; i++) {
      const p = this.placements[i];
      if (!p.alive) continue;
      const def = PROP_DEFS[p.defIndex];
      if (def === undefined || !def.blocksNav) continue;
      out[n * 3] = p.x; out[n * 3 + 1] = p.z; out[n * 3 + 2] = def.radius * p.scale;
      n++;
    }
    return n;
  }

  /**
   * Every placed prop as an (x, y, z, defIndex) quad written into `out`.
   * Returns the number of quads written, which is `min(propCount, out.length/4)`.
   *
   * This is the read side a map validator or a debug overlay wants, and it is
   * the only way out of the placement list — the list itself stays private so
   * nothing can mutate a prop's position behind the chunk-sorted GPU buffers.
   */
  positions(out: Float32Array): number {
    const max = (out.length / 4) | 0;
    let n = 0;
    for (let i = 0; i < this.placements.length && n < max; i++) {
      const p = this.placements[i];
      if (!p.alive) continue;
      out[n * 4] = p.x; out[n * 4 + 1] = p.y; out[n * 4 + 2] = p.z; out[n * 4 + 3] = p.defIndex;
      n++;
    }
    return n;
  }

  /**
   * Legacy benchmark arm: pack the WebGPU prop carpet into two render objects.
   *
   * This reduces cold pipeline creation, but it does NOT reduce runtime draws:
   * WebGPUBackend loops `_multiDrawCount` and calls `drawIndexed` once for every
   * visible instance. Keep it executable so `tools/gpu-frame-ab.mjs
   * --scatter-batch legacy` can prove the trade on future Three upgrades.
   */
  private buildNodeBatches(): void {
    const matrix = new THREE.Matrix4();
    const color = new THREE.Vector4();

    for (const castsShadow of [false, true]) {
      const group = this.types.filter((type) =>
        type.count > 0
          && typeCastsShadow(type.def, type.geo, this.legacyShadows) === castsShadow);
      if (group.length === 0) continue;

      let instances = 0;
      let vertices = 0;
      let indices = 0;
      for (const type of group) {
        const geometry = type.geo.geometry;
        instances += type.count;
        vertices += geometry.getAttribute('position').count;
        indices += geometry.getIndex()?.count ?? geometry.getAttribute('position').count;
      }

      const batch = new THREE.BatchedMesh(
        instances,
        vertices,
        indices,
        this.materials.material,
      );
      batch.name = castsShadow ? 'prop.batch.shadow' : 'prop.batch.no-shadow';
      // Scatter already performs exact 32 m AABB culling. Per-object culling
      // would repeat thousands of sphere tests inside Three every frame.
      batch.perObjectFrustumCulled = false;
      batch.sortObjects = false;
      batch.frustumCulled = false;
      batch.castShadow = castsShadow;
      batch.receiveShadow = true;
      batch.matrixAutoUpdate = false;
      batch.updateMatrix();

      for (const type of group) {
        const geometryId = batch.addGeometry(type.geo.geometry);
        const ids = new Int32Array(type.count);
        for (let i = 0; i < type.count; i++) {
          const instanceId = batch.addInstance(geometryId);
          ids[i] = instanceId;
          matrix.fromArray(type.srcMatrix, i * 16);
          batch.setMatrixAt(instanceId, matrix);
          color.set(
            type.srcColor[i * 3],
            type.srcColor[i * 3 + 1],
            type.srcColor[i * 3 + 2],
            type.srcPhase[i],
          );
          // RGB is the existing jitter multiplier. Alpha is unused by the
          // opaque surface and carries wind phase to PropNodeMaterial.
          batch.setColorAt(instanceId, color);
          batch.setVisibleAt(instanceId, false);
        }
        type.batch = batch;
        type.batchInstances = ids;
      }

      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      this.root.add(batch);
      this.nodeBatches.push(batch);
    }
  }

  /** Natural composition anchors as (x, z, familyCode) triples. */
  compositionCenters(out: Float32Array): number {
    const n = Math.min((out.length / 3) | 0, (this.compositionAnchors.length / 3) | 0);
    for (let i = 0; i < n * 3; i++) out[i] = this.compositionAnchors[i];
    return n;
  }

  /** Props inside a world-space box, as indices into the placement list. */
  countInBox(minX: number, minZ: number, maxX: number, maxZ: number): number {
    let n = 0;
    for (let i = 0; i < this.placements.length; i++) {
      const p = this.placements[i];
      if (!p.alive) continue;
      if (p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ) n++;
    }
    return n;
  }

  /* ======================================================================
   * 3.10 CLEARING — a structure fells what it lands on
   * ====================================================================== */

  /** The disc a prop actually occupies on screen: canopy, not trunk. */
  private visualRadius(p: Placement): number {
    const type = p.slot >= 0 ? this.types[p.slot] : undefined;
    if (type !== undefined) return type.geo.boundRadius * p.scale;
    const def = PROP_DEFS[p.defIndex];
    return (def === undefined ? 1 : def.radius) * p.scale;
  }

  /**
   * Fell every prop whose visual disc overlaps `[minX,maxX] x [minZ,maxZ]`
   * grown by `margin`. Returns the number removed.
   *
   * `out`, when given, receives one `(x, y, z, radius)` quad per felled prop up
   * to its capacity — caller-supplied so the presentation layer can raise dust
   * without this allocating. Quads are written in removal order, which is
   * cell-scan order and therefore deterministic.
   *
   * COST. The scan visits the 4 m cells the grown rectangle covers, expanded by
   * the widest canopy on the map so an overhanging tree centred outside is
   * still found; removal is one swap per hit. Nothing here is proportional to
   * the map's prop count, and nothing here reads a clock or the RNG — it runs
   * inside `simTick` by way of the `building:placed` handler.
   */
  clearFootprint(
    minX: number, minZ: number, maxX: number, maxZ: number,
    margin: number = PROP_CLEAR_MARGIN,
    out: Float32Array | null = null,
  ): number {
    this.lastClearScanned = 0;
    this.lastClearCount = 0;
    if (this.placements.length === 0) return 0;

    const x0 = minX - margin, x1 = maxX + margin;
    const z0 = minZ - margin, z1 = maxZ + margin;
    const reach = this.maxPropReach;
    const cx0 = clamp(Math.floor((x0 - reach) / CELL), 0, MAP_CELLS - 1);
    const cx1 = clamp(Math.floor((x1 + reach) / CELL), 0, MAP_CELLS - 1);
    const cz0 = clamp(Math.floor((z0 - reach) / CELL), 0, MAP_CELLS - 1);
    const cz1 = clamp(Math.floor((z1 + reach) / CELL), 0, MAP_CELLS - 1);

    const maxOut = out === null ? 0 : (out.length / 4) | 0;
    let removed = 0;
    let scanned = 0;

    for (let gz = cz0; gz <= cz1; gz++) {
      for (let gx = cx0; gx <= cx1; gx++) {
        const cell = gz * MAP_CELLS + gx;
        let prev = -1;
        let n = this.bucketHead[cell];
        while (n >= 0) {
          const next = this.bucketNext[n];
          const p = this.placements[n];
          scanned++;
          // Disc vs axis-aligned rectangle: the closest point on the rectangle
          // to the prop centre, then one squared compare.
          const r = this.visualRadius(p);
          const dx = p.x < x0 ? x0 - p.x : p.x > x1 ? p.x - x1 : 0;
          const dz = p.z < z0 ? z0 - p.z : p.z > z1 ? p.z - z1 : 0;
          if (!p.alive || dx * dx + dz * dz >= r * r) {
            prev = n; n = next; continue;
          }
          // Unlink from the cell bucket, then release the GPU instance.
          if (prev < 0) this.bucketHead[cell] = next;
          else this.bucketNext[prev] = next;
          this.bucketNext[n] = -1;
          if (removed < maxOut && out !== null) {
            out[removed * 4] = p.x; out[removed * 4 + 1] = p.y;
            out[removed * 4 + 2] = p.z; out[removed * 4 + 3] = r;
          }
          this.releaseInstance(p);
          removed++;
          n = next;
        }
      }
    }

    this.lastClearScanned = scanned;
    this.lastClearCount = removed;
    this.clearedProps += removed;
    // The visible set did not change, but its CONTENTS did. Without this the
    // 256-byte compare in update() short-circuits and a static camera keeps
    // drawing the felled trees until the player pans.
    if (removed > 0) this.chunkVisiblePrev.fill(255);
    return removed;
  }

  /**
   * Fell every CRUSHABLE-family prop whose footprint disc overlaps the disc
   * `(x, z, radius)`. Returns the number removed.
   *
   * The hull-under-the-tree counterpart of `clearFootprint`, and deliberately
   * NOT the same test:
   *
   *   FOOTPRINT RADIUS, NOT VISUAL RADIUS. `clearFootprint` uses the prop's
   *   canopy (`boundRadius`), because a crown resting on a new roof reads as
   *   broken even when the trunk cleared the wall. A driving hull is the
   *   opposite case: felling an 11 m tree because a harvester passed 4 m from
   *   its trunk would look like scenery evaporating at range. `PropDef.radius`
   *   — the authored footprint, "spacing and exclusion tests" — is the disc the
   *   hull has to actually touch.
   *
   *   FAMILY FILTER. Only `isCrushableFamily`; see its comment.
   *
   * `out`, when given, receives one `(x, y, z, radius)` quad per felled prop up
   * to capacity, in cell-scan order — caller-supplied so the presentation layer
   * raises dust without this allocating.
   *
   * COST. Identical shape to `clearFootprint`: the cells the grown disc covers,
   * one swap per hit, nothing proportional to the map's prop count, no clock
   * and no RNG. Safe inside `simTick`.
   */
  crushDisc(x: number, z: number, radius: number, out: Float32Array | null = null): number {
    this.lastClearScanned = 0;
    this.lastClearCount = 0;
    if (this.placements.length === 0 || radius <= 0) return 0;

    // The scan has to reach any prop whose CENTRE is outside the disc but whose
    // own footprint overlaps it, so widen by the widest reach on the map.
    const reach = this.maxPropReach;
    const cx0 = clamp(Math.floor((x - radius - reach) / CELL), 0, MAP_CELLS - 1);
    const cx1 = clamp(Math.floor((x + radius + reach) / CELL), 0, MAP_CELLS - 1);
    const cz0 = clamp(Math.floor((z - radius - reach) / CELL), 0, MAP_CELLS - 1);
    const cz1 = clamp(Math.floor((z + radius + reach) / CELL), 0, MAP_CELLS - 1);

    const maxOut = out === null ? 0 : (out.length / 4) | 0;
    let removed = 0;
    let scanned = 0;

    for (let gz = cz0; gz <= cz1; gz++) {
      for (let gx = cx0; gx <= cx1; gx++) {
        const cell = gz * MAP_CELLS + gx;
        let prev = -1;
        let n = this.bucketHead[cell];
        while (n >= 0) {
          const next = this.bucketNext[n];
          const p = this.placements[n];
          scanned++;
          const def = PROP_DEFS[p.defIndex];
          if (!p.alive || def === undefined || !isCrushableFamily(def.family)) {
            prev = n; n = next; continue;
          }
          const r = def.radius * p.scale;
          const dx = p.x - x;
          const dz = p.z - z;
          const want = radius + r;
          if (dx * dx + dz * dz >= want * want) {
            prev = n; n = next; continue;
          }
          // Unlink from the cell bucket, then release the GPU instance.
          if (prev < 0) this.bucketHead[cell] = next;
          else this.bucketNext[prev] = next;
          this.bucketNext[n] = -1;
          if (removed < maxOut && out !== null) {
            out[removed * 4] = p.x; out[removed * 4 + 1] = p.y;
            out[removed * 4 + 2] = p.z; out[removed * 4 + 3] = r;
          }
          this.releaseInstance(p);
          removed++;
          n = next;
        }
      }
    }

    this.lastClearScanned = scanned;
    this.lastClearCount = removed;
    this.clearedProps += removed;
    // Same reason as `clearFootprint`: the visible SET did not change but its
    // contents did, and update()'s 256-byte compare would short-circuit and
    // keep drawing the felled trees until the player pans.
    if (removed > 0) this.chunkVisiblePrev.fill(255);
    return removed;
  }

  /**
   * Retire one instance in O(1): move the last live instance of its chunk into
   * the hole, shrink the chunk's live count, tombstone the placement.
   */
  private releaseInstance(p: Placement): void {
    p.alive = false;
    this.liveProps--;
    const s = p.slot;
    if (s < 0) return;
    const type = this.types[s];
    const c = p.chunk;
    if (this.batchedNodePath) {
      const instanceId = type.batchInstances[p.inst];
      if (type.batch !== null && instanceId >= 0) type.batch.setVisibleAt(instanceId, false);
      type.chunkLive[c]--;
      type.count--;
      p.slot = -1;
      return;
    }
    const base = type.chunkStart[c];
    const last = base + type.chunkLive[c] - 1;
    const i = p.inst;
    if (i !== last && last >= base) {
      const m = type.srcMatrix, col = type.srcColor;
      const dm = i * 16, sm = last * 16;
      for (let k = 0; k < 16; k++) m[dm + k] = m[sm + k];
      const dc = i * 3, sc = last * 3;
      col[dc] = col[sc]; col[dc + 1] = col[sc + 1]; col[dc + 2] = col[sc + 2];
      const movedIndex = type.instOf[last];
      type.instOf[i] = movedIndex;
      const moved = this.placements[movedIndex];
      if (moved !== undefined) moved.inst = i;
    }
    type.chunkLive[c]--;
    type.count--;
    p.slot = -1; p.inst = -1;
  }

  /* ======================================================================
   * 3.10b PERSISTING WHAT WAS FELLED
   *
   * Both clears above are PERMANENT for the match by design, and neither used
   * to survive a save. Terrain, roads and props are regenerated from the seed,
   * so unless the file says otherwise a load stands every felled prop back up.
   * `SaveGame` closed half of it by replaying the list of building footprints
   * ever poured; the hull crush in `src/sim/Crush.ts` had no equivalent, and a
   * trail a player mowed through a wood grew back.
   *
   * WHY A BITMASK AND NOT A SECOND LEDGER. The obvious symmetric fix is to
   * persist the crush discs the way the footprints are persisted. Measured, on
   * `temperate` seed 7: six vehicles driven corner-to-corner for 27 sim-minutes
   * produced 144 discs, and an AI-vs-AI match produced 25 in ten minutes. Small
   * — but the count is UNBOUNDED in match length, army size and map area, every
   * disc has to be replayed as a fresh cell scan on load, and an autosave ring
   * writes the whole growing list every time it fires.
   *
   * The alive bits are the state itself, they are BOUNDED by
   * `SCATTER_LIMITS.maxProps` at 1125 bytes no matter what the match does, they
   * cover the footprint clear and the crush with one mechanism, and they cost
   * nothing per event: no counter in `simTick`, no allocation on the sim path,
   * nothing that can fall out of step with what is actually standing.
   *
   * That map generates 4178 placements, so the raw mask is 523 bytes. Measured
   * A/B against a ~46 kB save, with `SaveGame` run-encoding it when that wins:
   * +32 bytes with nothing felled, +100 with 56 felled, +364 after a sweep that
   * flattened 1679 props — 40% of the map's scatter, which no match does.
   *
   * THE INDEX IS ONLY MEANINGFUL AGAINST THE LIST THAT PRODUCED IT, so the mask
   * travels with `placementFingerprint`. `scatter.system.ts` seeds exclusion
   * discs from the spawned base — a different faction, a different opening or a
   * different map moves them, and every prop placed after a moved exclusion
   * shifts. The caller compares the fingerprint first and falls back to the
   * footprint replay on a mismatch, so the failure mode stays the conservative
   * one this bug already had: scenery returns, it is never felled wrongly.
   * ====================================================================== */

  /** Placements in this generation, tombstones included. The mask's domain. */
  get placementCount(): number { return this.placements.length; }

  /**
   * Identity of the generated placement list: two Scatters reporting the same
   * number hold the same props, in the same order, at the same coordinates.
   *
   * Computed once per `generate()` — felling a prop tombstones it but never
   * moves or removes the record, so this is stable for the whole match.
   */
  get placementFingerprint(): number { return this.placementHash; }

  /** Bytes `felledMask`/`applyFelledMask` need. `(placementCount + 7) / 8`. */
  get felledMaskBytes(): number { return (this.placements.length + 7) >> 3; }

  /**
   * Write one bit per placement, LSB-first, 1 = felled. Returns the bytes
   * written, or 0 if `out` is too small — a partial mask would fell the wrong
   * props, so the caller gets nothing rather than something plausible.
   */
  felledMask(out: Uint8Array): number {
    const n = this.placements.length;
    const bytes = (n + 7) >> 3;
    if (out.length < bytes) return 0;
    out.fill(0, 0, bytes);
    for (let i = 0; i < n; i++) {
      if (this.placements[i].alive) continue;
      out[i >> 3] |= 1 << (i & 7);
    }
    return bytes;
  }

  /**
   * Fell every placement whose bit is set and that is still standing. Returns
   * the number newly felled; a prop already down is left alone, so applying a
   * mask over a scatter that has had its base footprints cleared is idempotent.
   *
   * The cell index is rebuilt once at the end rather than unlinked per prop:
   * this is a restore path, O(placements) beats O(chain) per hit at this batch
   * size, and it cannot leave a stale bucket entry behind.
   */
  applyFelledMask(mask: Uint8Array): number {
    const n = this.placements.length;
    if (mask.length < ((n + 7) >> 3)) return 0;
    let felled = 0;
    for (let i = 0; i < n; i++) {
      if ((mask[i >> 3] & (1 << (i & 7))) === 0) continue;
      const p = this.placements[i];
      if (!p.alive) continue;
      this.releaseInstance(p);
      felled++;
    }
    if (felled > 0) {
      this.clearedProps += felled;
      this.rebuildCellIndex();
      // Same reason `clearFootprint` does it: the visible chunk SET is
      // unchanged, so update()'s 256-byte compare would short-circuit and keep
      // drawing props that are no longer there.
      this.chunkVisiblePrev.fill(255);
    }
    return felled;
  }

  /**
   * FNV-1a over (count, defIndex, x, z) of every placement. Positions are
   * quantised to 1/16 m: far finer than the metre a prop is placed on, and
   * coarse enough that it is comparing placement decisions rather than float
   * noise. A collision costs a wrongly-accepted mask, so this is 32 bits of
   * everything that determines the list rather than a cheap sample of it.
   */
  private computePlacementHash(): number {
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      let x = v >>> 0;
      for (let b = 0; b < 4; b++) {
        h = (h ^ (x & 0xff)) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
        x >>>= 8;
      }
    };
    mix(this.placements.length);
    for (let i = 0; i < this.placements.length; i++) {
      const p = this.placements[i];
      mix(p.defIndex);
      mix(Math.round(p.x * 16));
      mix(Math.round(p.z * 16));
    }
    return h >>> 0;
  }

  get propCount(): number { return this.liveProps; }
  get typeCount(): number { return this.types.length; }
  get drawCalls(): number {
    if (this.batchedNodePath) {
      let n = 0;
      for (const batch of this.nodeBatches) {
        for (const type of this.types) {
          if (type.batch === batch && type.drawCount > 0) { n++; break; }
        }
      }
      return n;
    }
    let n = 0;
    for (let i = 0; i < this.types.length; i++) if (this.types[i].drawCount > 0) n++;
    return n;
  }

  stats(): ScatterStats {
    const r = this.lastReport;
    return {
      props: this.liveProps,
      types: this.types.length,
      triangles: this.foliage.totalTriangles,
      visibleInstances: this.visibleInstances,
      visibleChunks: this.visibleChunks,
      drawCalls: this.drawCalls,
      generateMs: this.generateMs,
      propsPerHectare: r ? r.propsPerHectare : 0,
      adornedFraction: r ? r.adornedFraction : 0,
      emptyPatches: r ? r.emptyPatches.length : 0,
    };
  }

  /* ======================================================================
   * 3.11 TEARDOWN
   * ====================================================================== */

  private disposeMeshes(): void {
    for (const batch of this.nodeBatches) {
      this.root.remove(batch);
      batch.dispose();
    }
    this.nodeBatches.length = 0;
    for (let i = 0; i < this.types.length; i++) {
      const m = this.types[i].mesh;
      if (m !== null) {
        this.root.remove(m);
        m.dispose();
      }
      this.types[i].mesh = null;
      this.types[i].batch = null;
      this.types[i].batchInstances = EMPTY_I32;
    }
  }

  dispose(): void {
    this.disposeMeshes();
    this.types = [];
    this.placements.length = 0;
    this.compositionAnchors.length = 0;
    this.liveProps = 0;
    this.scene.remove(this.root);
    this.materials.dispose();
    this.foliage.dispose();
    this.library.dispose();
  }
}

/* ==========================================================================
 * 4. HELPERS
 * ========================================================================== */

/** Family -> integer, so the clump-centre list stays a flat number array. */
const FAMILY_CODE: readonly string[] =
  ['canopy', 'shrub', 'grass', 'rock', 'street', 'yard', 'civic'];
const FAMILY_CANOPY = 0;
const FAMILY_SHRUB = 1;
const FAMILY_GRASS = 2;
const FAMILY_ROCK = 3;

/** Clump-centre bucket size. Must exceed SCATTER_CLUSTER.betweenClumpsMax (50). */
const CLUMP_BUCKET_METRES = 64;
const CLUMP_BUCKET_N = Math.max(1, Math.ceil(MAP_SIZE / CLUMP_BUCKET_METRES));

const EMPTY_F32 = new Float32Array(0);
const EMPTY_I32 = new Int32Array(0);
const NORMAL_SCRATCH = new Float32Array(3);
/** Nearest road point for sidewalk-fixture orientation. Build-time only. */
const ROAD_POINT_SCRATCH = new Float32Array(4);
const JITTER_OUT = new Float32Array(3);

function chunkOf(x: number, z: number): number {
  const cx = clamp(Math.floor(x / SCATTER_CHUNK_METRES), 0, CHUNK_N - 1);
  const cz = clamp(Math.floor(z / SCATTER_CHUNK_METRES), 0, CHUNK_N - 1);
  return cz * CHUNK_N + cx;
}

/**
 * Compose a column-major 4x4 for one placement directly into `out`.
 *
 * Rotation order is Ry(yaw) then the small tilts, applied as a first-order
 * shear on the up axis — exact to well under a pixel at +/-4 degrees and about
 * a tenth of the cost of a full quaternion compose over 7000 props.
 */
function composeMatrix(p: Placement, out: Float32Array, o: number): void {
  const s = p.scale;
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  const tx = p.tiltX, tz = p.tiltZ;

  // Up axis after tilting: (-tz, 1, tx), normalised.
  let ux = -tz, uy = 1, uz = tx;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;

  // Right axis: yaw's right, re-orthogonalised against up.
  let rx = cy, ry = 0, rz = -sy;
  const d = rx * ux + ry * uy + rz * uz;
  rx -= ux * d; ry -= uy * d; rz -= uz * d;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;

  // Forward = right x up.
  const fx = ry * uz - rz * uy;
  const fy = rz * ux - rx * uz;
  const fz = rx * uy - ry * ux;

  out[o] = rx * s; out[o + 1] = ry * s; out[o + 2] = rz * s; out[o + 3] = 0;
  out[o + 4] = ux * s; out[o + 5] = uy * s; out[o + 6] = uz * s; out[o + 7] = 0;
  out[o + 8] = fx * s; out[o + 9] = fy * s; out[o + 10] = fz * s; out[o + 11] = 0;
  out[o + 12] = p.x; out[o + 13] = p.y; out[o + 14] = p.z; out[o + 15] = 1;
}

/**
 * Upload only the used prefix of a dynamic attribute.
 *
 * Third site for this shape. The other two are `markRange` in
 * src/vfx/Particles.ts and `InstanceBatcher.uploadAttribute`; neither is
 * exported, and a world module importing the VFX or render layer to reach a
 * five-line helper is the worse trade. If a shared home is ever made, collapse
 * all three.
 *
 * IT IS THE BATCHER'S FORM AND NOT PARTICLES', DELIBERATELY. `addUpdateRange`
 * allocates a fresh `{start, count}` on every call, and this file's own
 * contract two hundred lines up is "zero allocation either way" for `update()`
 * — 22 types x 2 attributes would be 44 objects on a pan frame. The caller
 * owns the range object instead, exactly as `InstanceBatcher` owns
 * `this.rangeMatrix`; three merges ranges in place and then clears the array,
 * so re-pushing the same object next time is safe.
 *
 * THE STALE-RANGE HAZARD `InstanceBatcher` GUARDS AGAINST DOES NOT APPLY HERE,
 * which is why this one has no full-upload fallback. There, a culled mesh can
 * leave a queued range the renderer never drained, so the next write must cover
 * both spans. Scatter writes ONLY prefixes from index 0, so the union of a
 * pending range and a new one is just the longer of the two, and anything past
 * `mesh.count` is never read by the draw. Every scatter mesh is also
 * `frustumCulled = false`, so it is submitted whenever its layer is drawn.
 */
function markRange(
  attr: THREE.InstancedBufferAttribute,
  range: { start: number; count: number },
  count: number,
): void {
  range.start = 0;
  range.count = count;
  // Non-empty means our own object is still queued from a repack the renderer
  // has not drained yet — it was just re-pointed above, so pushing it twice
  // would only make three merge it with itself.
  if (attr.updateRanges.length === 0) attr.updateRanges.push(range);
  attr.needsUpdate = true;
}

/* ==========================================================================
 * 5. MODULE-LEVEL ACCESSOR
 *
 * Same shape as `getTerrain()` — the handful of callers that need the
 * scatter-specific extras (a map validator, a debug overlay, a nav module
 * wanting `blockers()`) reach it here instead of importing the system.
 * ========================================================================== */

let active: Scatter | null = null;

export function getScatter(): Scatter | null { return active; }
export function setActiveScatter(s: Scatter | null): void { active = s; }

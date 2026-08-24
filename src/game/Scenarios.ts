/**
 * ============================================================================
 * VOLTMARCH — src/game/Scenarios.ts
 * ============================================================================
 * THE SCENARIO ROUTER — the fixtures every screenshot photographs.
 *
 * `tools/shoot.mjs` boots the game twelve times with a different `?shot=` flag
 * and photographs whatever is on screen. This file is the other half of that
 * contract: `?shot=allied-base` has to produce an Allied base, deterministically,
 * centred on (256, 256), framed for a 62 m camera, every single run. If it does
 * not, the entire visual critique loop is photographing nothing.
 *
 * WHAT A SCENARIO IS
 * ------------------
 * A seeded world setup plus a published description of it:
 *
 *   - which biome the terrain should be (`map`), from MAP_PRESETS
 *   - which structures, units, props and wrecks exist and where
 *   - where the camera sits and how far out
 *   - whether the sim is frozen or pre-advanced by N deterministic ticks
 *   - the ore fields, shoreline and pending placement other modules must honour
 *
 * The entity half is applied here. The terrain/ore/shore half is DATA: this
 * module never touches the heightfield, because the terrain module owns it.
 * Everyone reads `activeScenario()` and shapes their own world from it.
 *
 * THREE LAWS OF THIS FILE
 * -----------------------
 * 1. **A scenario never throws.** A scenario that throws is a screenshot the
 *    critics cannot take, which blocks every downstream module. Every builder
 *    call is guarded; a missing def, a missing model or a full entity store
 *    degrades to "fewer things on screen", never to a stack trace.
 * 2. **Deterministic from (name, seed).** One `Rng`, seeded from the flag,
 *    threaded through every placement. No `Math.random`, no wall clock.
 * 3. **Composed like a screenshot a player would take.** A base is a
 *    Construction Yard with a refinery facing the ore, a war factory with room
 *    to egress, defences on the threat axis and units in plausible postures —
 *    never three cubes in a row.
 *
 * DEGRADING GRACEFULLY
 * --------------------
 * The def tables (`src/data/**`) and the ModelRegistry are written by other
 * agents and may not exist yet. So this module carries a complete FALLBACK def
 * table derived from `UNIT_DIMENSIONS` / `BUILDING_DIMENSIONS`, and at init it
 * looks for a real `DefTables` through a lazy glob. When one is found every
 * spawn uses its real `defId` and its real stats; when it is not, entities are
 * spawned anyway with fallback stats and `defId = -1`, and the RenderBridge
 * draws its labelled placeholder. Either way the frame has content.
 *
 * `entityKeyOf(id)` publishes the content key of every entity this module
 * spawned ('grizzly', 'conyard', 'tree'), so a placeholder can be LABELLED
 * rather than anonymous even before any def table exists.
 * ============================================================================
 */

import {
  BUILDING_DIMENSIONS, BUILD_RADIUS, CELL, HARVESTER_CAPACITY, MAP_PRESETS,
  MAP_PRESET_DEFAULT, MAP_SIZE, NAVAL_BUILDING_DIMENSIONS, NAVAL_UNIT_DIMENSIONS,
  ORE_CELL_MAX, PLACEMENT, REFINERY_STORAGE, SCENARIO_DEFAULT, SCENARIO_SCATTER, SILO_STORAGE,
  TERRAIN_ISLAND_MIN_CELLS, TERRAIN_SEA_START_CLEARANCE, TERRAIN_START_EDGE_WOBBLE,
  TERRAIN_START_FLAT_RADIUS, UNIT_DIMENSIONS, WATER_LEVEL, placementPadWeight,
  type SeaIsland, type SeaSpec
} from '../core/config';
import { VEHICLE_WRECK_DEF, WRECK_LENGTH, type WreckClass } from '../core/wrecks';
import {
  ArmorClass, EntityFlag, EntityKind, Faction, Locomotor, NONE, OrderKind,
  Stance, UnitState,
} from '../core/types';
import type { MapPreset } from '../core/config';
import { DEFAULT_SEED } from '../core/config';
import type {
  BuildingDef, DefTables, EntityId, PlayerId, UnitDef,
} from '../core/types';
import { PerEntityObj, type World } from '../core/world';
import {
  DEG2RAD, Rng, clampCell, clampWorld, footprintOriginCell, hashU32, isInMap,
  snapFootprintToGrid, worldToCell, wrapAngle,
} from '../core/math';
import { MoveClass, TerrainRegions } from '../sim/Flowfield';
import { setMoveClass } from '../sim/Movement';
import { facedFootprintH, facedFootprintW, yawToFacing } from '../sim/Placement';
import { getTerrain } from '../world/Terrain';
// Zero-cost edge: `UnlockGate.ts` imports nothing but its own type-only module,
// and `isBuildable` answers "yes" when no gate has been installed.
import { isBuildable } from '../progression/UnlockGate';
// The neutral map furniture's footprints, shared verbatim with the def rows in
// `src/data/Defs.ts` and the mass lists in `src/art/BuildingDefs.ts`. A
// STATIC import of a leaf module with no imports of its own — it is not part
// of the `../data/**` glob's job below, which is looking for a `DefTables`.
import { CIVILIAN_DIMENSIONS as CIV, CIVILIAN_KEYS } from '../data/Civilians';

import { buildAlliedBase, type BaseOptions } from './scenarios/AlliedBase';
import { buildSovietBase } from './scenarios/SovietBase';
import {
  buildArchitectureShowcase, buildAtoll, buildBattle, buildBlob, buildEconomy,
  buildNaval, buildPlacement, buildSelection, buildSledgeAudit,
  buildTerrainShowcase, buildUnitParade,
} from './scenarios/Showcases';

/* ==========================================================================
 * 1. THE PUBLISHED SPEC — what every other module reads
 * ========================================================================== */

/** Where the scenario wants the camera. The shot harness may override x/z/dist. */
export interface ScenarioCamera {
  /** Ground focus point, metres. */
  x: number;
  z: number;
  /** Dolly distance, metres. Clamped to CAMERA.min/maxDistance by the rig. */
  distance: number;
  /**
   * Compass yaw in degrees. Non-zero on purpose: RA3's ground grid sweeps
   * ±20°..±40° across the frame, and a yaw of exactly 0 reads as a flat
   * axis-aligned table (bible §0 property 3).
   */
  yawDeg: number;
}

/** One ore patch the OreField module should seed. */
export interface OreFieldSpec {
  x: number;
  z: number;
  /** Metres. Cells inside this radius carry ore, falling off toward the edge. */
  radius: number;
  /** Ore units at the centre cell. */
  richness: number;
}

/**
 * A straight shoreline. Water is the half-plane where
 * `(p - origin) · normal > 0`. Naval maps publish exactly one.
 */
export interface ShoreSpec {
  x: number;
  z: number;
  normalX: number;
  normalZ: number;
  /** Metres of shallow/foam band either side of the line. */
  bandWidth: number;
}

/** A structure the local player is holding on the cursor, for the ghost shot. */
export interface PlacementSpec {
  /** Content key ('warFactory'). */
  key: string;
  /** Index into DefTables.buildings, or -1 when no def table exists yet. */
  defId: number;
  /** Origin cell (minimum corner) the ghost is hovering over. */
  cx: number;
  cz: number;
  footprintW: number;
  footprintH: number;
  /** Metres from the nearest Construction Yard the ghost is allowed to sit. */
  buildRadius: number;
  /** Set on a defensive structure so the overlay draws its range ring. */
  weaponRange: number;
}

/** Axis-aligned world box, metres. */
export interface WorldBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** The complete description of the world this boot built. */
export interface ScenarioSpec {
  /** Resolved scenario name; always one of SCENARIO_NAMES. */
  readonly name: string;
  /** Seed every placement was drawn from. */
  readonly seed: number;
  /** Resolved MAP_PRESETS key. */
  readonly map: string;
  /** The preset's advisory `?art=` mood. Never auto-applied. */
  readonly mood: string;
  /** True when the shot wants a frozen frame (no sim, no animation drift). */
  readonly frozen: boolean;
  /**
   * How this match opened. Always `'base'` for the `?shot=` fixtures — they are
   * posed photographs of finished bases and nothing else makes sense.
   */
  readonly start: StartCondition;
  /** True when fog of war must be off so the whole composition is visible. */
  readonly revealMap: boolean;
  /** Deterministic sim ticks run at build time so the frame reads mid-action. */
  readonly settleTicks: number;
  readonly camera: ScenarioCamera;
  readonly ore: readonly OreFieldSpec[];
  readonly shore: ShoreSpec | null;
  readonly placement: PlacementSpec | null;
  /** The area the shot actually photographs. Scatter density belongs in here. */
  readonly framed: WorldBox;
  /** Entities this scenario spawned. Diagnostics for the shot report. */
  readonly entityCount: number;
  /** One line for the console and the debug overlay. */
  readonly summary: string;
}

/* --------------------------------------------------------------------------
 * MEASURED FRAME GEOMETRY
 *
 * Every composition in this module is sized against this, and it is MEASURED,
 * not derived: `CameraRig` interpolates pitch with zoom (46° in, 58° out), so
 * the naive `2 * d * tan(fov/2)` answer is wrong by 40%. These numbers come
 * from unprojecting the four screen corners onto the ground at 2560x1440 —
 * the resolution `tools/shoot.mjs` captures at — for d = 30..62:
 *
 *     d    top row   bottom row   depth   above focus   below focus
 *    30      50 m       26 m       32 m      19.6 m        10.3 m
 *    38      63 m       33 m       41 m      24.7 m        13.0 m
 *    48      79 m       42 m       50 m      31.6 m        17.5 m
 *    62     100 m       56 m       62 m      37.5 m        20.8 m
 *
 * Two consequences a layout MUST respect or it walks off the edge of the shot:
 *
 *   1. The frame is a TRAPEZOID. The bottom row shows barely half the ground
 *      the top row does, so anything wide belongs behind the focus, not in
 *      front of it.
 *   2. The focus point is NOT the centre. 64% of the visible depth is behind it
 *      and only 36% in front, so a composition centred on the focus loses its
 *      near edge.
 * -------------------------------------------------------------------------- */

/** Visible ground around the focus point, in metres, at a dolly distance. */
export interface FrameExtent {
  /** Ground width across the TOP row of the frame. */
  width: number;
  /** Ground depth from the top row to the bottom row. */
  depth: number;
  /** Metres of -Z (away from the camera) that are visible past the focus. */
  back: number;
  /** Metres of +Z (toward the camera) that are visible past the focus. */
  front: number;
  /** Half-width at the focus row — the honest budget for a centred subject. */
  halfWidth: number;
}

/**
 * Linear fit to the table above (R² > 0.999 across 30..62 m, which is the whole
 * legal dolly range the shot list uses).
 */
export function visibleGround(distance: number): FrameExtent {
  const width = 1.5625 * distance + 3.1;
  const depth = 0.9375 * distance + 3.9;
  return { width, depth, back: depth * 0.64, front: depth * 0.36, halfWidth: width * 0.39 };
}

/**
 * The world-axis-aligned half-extents a composition may occupy and still be
 * fully visible under a yawed camera.
 *
 * Layouts are authored on the WORLD grid (a base is square to the cell grid,
 * like every RA base ever built) while the camera is yawed, so the layout's
 * bounding box arrives on screen rotated and its corners are what fall off the
 * edge first. Solving `a·|cos| + b·|sin| ≤ W/2` and `a·|sin| + b·|cos| ≤ D/2`
 * for the wide-and-shallow case gives the numbers every layout in this module
 * is sized against.
 *
 * At d = 62 / yaw 24° that is roughly 33 x 21 m — a 66 x 42 m base. Author
 * bigger than this on purpose only when edge cropping is the intent.
 */
export function layoutBudget(distance: number, yawDeg: number): { halfX: number; halfZ: number } {
  const v = visibleGround(distance);
  const c = Math.abs(Math.cos(yawDeg * DEG2RAD));
  const s = Math.abs(Math.sin(yawDeg * DEG2RAD));
  const w = v.halfWidth;
  const d = v.depth * 0.5;
  // Bias the solution 1.6 : 1 toward width — a base that is wider than it is
  // deep matches both the frame shape and how bases actually get built.
  const k = 1.6;
  const halfZ = Math.min(w / (k * c + s), d / (k * s + c));
  return { halfX: halfZ * k, halfZ };
}

/** Every `?shot=` name `tools/shoot.mjs` may ask for, plus the default. */
export const SCENARIO_NAMES = [
  'skirmish',
  'allied-base',
  'soviet-base',
  'meridian-base',
  'meridian-support',
  'meridian-final',
  'reclamation-base',
  'terrain-showcase',
  'unit-parade',
  'architecture-showcase',
  'sledge-audit',
  'battle',
  'economy',
  'naval',
  'placement',
  'selection',
  'blob',
  'atoll',
  /**
   * ONE NAME FOR THE WHOLE CAMPAIGN, NOT THIRTY-SEVEN.
   *
   * The per-operation variation is carried by `OperationDef.layout`, which is
   * a key into a module registry rather than a scenario name — so adding an
   * operation adds no row here, no `SCENARIO_PITCH_DEG` row, and nothing to
   * `tests/shot-camera.spec.ts`. It is also NOT a `?shot=` fixture: the
   * campaign is never photographed, and the pitch row that exists for it is a
   * fixture-table entry so the router is total, not a design constraint on 37
   * operations.
   */
  'campaign',
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

/* --------------------------------------------------------------------------
 * HOW A MATCH OPENS
 *
 * `skirmish` used to have exactly one opening: `buildBaseFor` twice, twenty-five
 * structures a side, before the player had touched anything. That was inherited
 * from the shot fixtures — every other entry in `PLANS` is a posed photograph
 * for `tools/shoot.mjs` and needs a finished base to photograph — and it deleted
 * the opening of an RTS: build order as a skill, where to site the yard, the
 * economic ramp, scouting before committing.
 *
 * So the opening is now a CHOICE, and the default is the real game.
 * -------------------------------------------------------------------------- */

/** Which opening a skirmish uses. */
export type StartCondition = 'mcv' | 'base';

/** Every legal `?start=` value, and the lobby's two options. */
export const START_CONDITIONS: readonly StartCondition[] = ['mcv', 'base'];

/** The opening a match uses when nothing asks for anything else. */
export const START_CONDITION_DEFAULT: StartCondition = 'mcv';

/** Parse a `?start=` value. Anything unrecognised falls back, loudly. */
export function resolveStartCondition(
  raw: string | null | undefined,
  fallback: StartCondition = START_CONDITION_DEFAULT,
): StartCondition {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const wanted = normKey(raw);
  for (const s of START_CONDITIONS) if (normKey(s) === wanted) return s;
  // Two spellings a human will reasonably type for each.
  if (wanted === 'vehicle' || wanted === 'constructionvehicle' || wanted === 'truck') return 'mcv';
  if (wanted === 'prebuilt' || wanted === 'prebuiltbase' || wanted === 'full') return 'base';
  console.warn(
    `[scenario] unknown ?start=${raw} — known: ${START_CONDITIONS.join(', ')}. Using ${fallback}.`,
  );
  return fallback;
}

/**
 * The opening force, per faction, expressed in the ROLE vocabulary
 * `ScenarioBuilder.keyFor` remaps: one construction vehicle plus a small escort.
 *
 * The counts are the faction talking. The Reclamation fields the cheapest body
 * in the game (a 90-credit Scrap Picker, army weight 5) so it brings five and
 * one hull; the Pact's army is fragile and screens with numbers; the Soviets
 * bring the extra conscript their whole doctrine is built on. Every key here is
 * UNGATED on a fresh profile — see the note on `isBuildable` in `spawnUnit`,
 * which SKIPS a locked def rather than substituting one, so a gated escort would
 * simply not arrive.
 */
export interface StartForce {
  /** Infantry bodies, spawned from the shared 'gi' role key. */
  readonly infantry: number;
  /** Light vehicles, spawned from the shared 'grizzly' role key. */
  readonly vehicles: number;
}

export const START_FORCE: Readonly<Record<number, StartForce>> = {
  [Faction.Neutral]: { infantry: 3, vehicles: 2 },
  [Faction.Allies]: { infantry: 3, vehicles: 2 },
  [Faction.Soviets]: { infantry: 4, vehicles: 2 },
  [Faction.Meridian]: { infantry: 4, vehicles: 2 },
  [Faction.Reclaim]: { infantry: 5, vehicles: 1 },
};

/** The escort a faction opens with. Total bodies, MCV excluded. */
export function startForceFor(faction: Faction): StartForce {
  return START_FORCE[faction as number] ?? START_FORCE[Faction.Neutral];
}

/**
 * Where the armies stand, and which way they look.
 *
 * PREFERS THE GENERATOR'S OWN SHELVES. `Terrain.startLocations()` publishes the
 * patches it has levelled, kept dry, made buildable and PROVEN joined to the
 * main region (`TERRAIN_START_GUARD_RADIUS`, 54 m). A match that opens with a
 * lone construction vehicle has no margin for a bad spawn — there is no second
 * yard to fall back on — so when the generator has reserved a shelf per army,
 * that is where the army goes.
 *
 * `TERRAIN_START_POSITIONS` currently reserves ONE shelf, so the second army is
 * still derived: the classic RA diagonal, mirrored through the shelf centre, far
 * enough apart that neither opening is inside the other's sight radius and each
 * turned to face the other along the threat axis.
 */
export interface StartSpot {
  readonly x: number;
  readonly z: number;
  /** Compass facing, degrees. Points at the opposing start. */
  readonly facingDeg: number;
}

/**
 * Half-diagonal of the layout, metres.
 *
 * DOUBLED FROM 74/62 ON 2026-08-18. Reported as "we always spawn few meters
 * away from enemy, even though maps are huge, we dont take advantage of that",
 * and the measurement is worse than the report:
 *
 *     MAP_SIZE                      512 m
 *     all four starts fit inside    148 x 124 m  =  7.0% of the map's AREA
 *     unused margin                 182 m on every side
 *     two-army opening              193.1 m
 *     four-army ADJACENT pairs      124.0 m   <- under START_MIN_SEPARATION (150)
 *
 * That last line was a live inconsistency: `nudgeToBuildable` enforces a 150 m
 * floor between openings while the authored table it protects sat below it.
 *
 *     two-army opening   386.2 m      closest pair   248.0 m
 *     edge margin        108 m        (a sea shelf needs 96: 58 flat + 14
 *                                      wobble + 6 band + 8 waviness + 10
 *                                      TERRAIN_SEA_START_CLEARANCE)
 *
 * 108 is the binding constraint and it is why this is x2 rather than more. The
 * four shelves also stop OVERLAPPING at this spread — 248 m apart against a
 * 58 m flat radius — which retires the levelled-seam risk `terrain-plan.ts`
 * documents having deferred once, and is why `tests/start-shelves.spec.ts`'
 * overlap cases were rewritten rather than nudged.
 */
const START_SPREAD_X = 148;
const START_SPREAD_Z = 124;

export interface StartOffset {
  readonly dx: number;
  readonly dz: number;
}

export interface StartTable {
  /** Exact offsets from map centre. Integers only: terrain is generated on every lockstep peer. */
  readonly slots: readonly StartOffset[];
  /** Authored two-player pairings. Wider alternatives may be sampled by the sim seed. */
  readonly pairs: readonly (readonly [number, number])[];
  /** Unit normal used by a half-plane sea, before the profile chooses its sign. */
  readonly seaNormal?: { readonly x: number; readonly z: number };
}

/**
 * The classic/temperate opening, as offsets from the map centre.
 *
 * THE ONE TABLE. It used to be two: these constants here, and
 * `TERRAIN_START_POSITIONS` in core/config.ts, which the generator reserved a
 * verified shelf at. Nothing kept them in step and they were never in step —
 * config listed a single entry, `[0.5, 0.5]`, so the guarantee that a start is
 * "flat, dry, buildable, and joined to the map's main passable region" was
 * delivered 96.5 m away from where either army landed, against a guard radius
 * of 54. The shelf was perfect and empty; the armies stood on whatever the
 * heightfield happened to produce, measured at 60-74% buildable with about a
 * third of openings under 60%.
 *
 * `MAP_START_TABLES` below is the shipping skirmish contract. This export stays
 * as the classic table for temperate maps, campaign layouts, fixtures and old
 * callers that do not name a preset. `startPointsFor` and `startSpots` resolve
 * the same selected table, so terrain reservation and spawning cannot drift.
 *
 * Slot 0 keeps the exact corner the old hard-coded plan used, so a saved seed
 * frames the same valley it always did.
 *
 * FOUR ENTRIES SINCE v2.5.0, AND SLOTS 0-1 ARE UNTOUCHED. The table is the
 * FOUR-army layout — the corners of a 148 x 124 m rectangle on the map's own
 * diagonal — and a two-army match takes the first two of them, which are
 * exactly the two literals that were here before. Slots 2 and 3 complete the
 * rectangle rather than fanning on a new ellipse, so all six pairwise distances
 * come out of one shape and the map reads as one battlefield at either count.
 *
 * EVERY CONSUMER MUST SLICE TO THE ARMY COUNT, and that is the whole risk this
 * change carried. `terrain-plan.plannedTerrainInput` spreads this table into
 * `TerrainGenOptions.starts`, so simply appending two entries would have made
 * the generator level two EXTRA shelves on every map in the game — a different
 * heightfield for `contested-strait`, `coral-shore`, all twelve `?shot=`
 * fixtures and every landlocked seed, for a four-player mode nothing has
 * selected yet. `startPointsFor()` below is the one derivation both the
 * generator plan and the spawn now go through, and it takes the count.
 *
 * Campaign layouts deliberately omit a preset and therefore keep this table.
 * Do not infer a table from the biome or sea: doing so moved authored campaign
 * bases without changing their operation data.
 */
export const SKIRMISH_START_OFFSETS: readonly StartOffset[] = [
  { dx: -START_SPREAD_X, dz: START_SPREAD_Z },
  { dx: START_SPREAD_X, dz: -START_SPREAD_Z },
  { dx: START_SPREAD_X, dz: START_SPREAD_Z },
  { dx: -START_SPREAD_X, dz: -START_SPREAD_Z },
];

const CLASSIC_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1], [2, 3], [0, 2], [1, 3],
];

/** Existing diagonal shoreline normal, pinned so changing a start table cannot rotate the sea. */
const CLASSIC_SEA_NORMAL = { x: 0.6422198626104074, z: 0.7665204811801637 } as const;

/**
 * Skirmish opening geometry per map preset.
 *
 * These are authored integer coordinates, not rotated at runtime. Apart from
 * avoiding cross-engine trigonometry drift, that lets each battlefield express
 * its actual shape: long arid lanes, a square urban grid, a snow corridor, and
 * two coastal strips that keep every candidate opening on land.
 */
export const MAP_START_TABLES: Readonly<Record<string, StartTable>> = {
  temperate: { slots: SKIRMISH_START_OFFSETS, pairs: CLASSIC_PAIRS },
  arid: {
    slots: [
      { dx: -124, dz: -148 }, { dx: 124, dz: 148 },
      { dx: -124, dz: 148 }, { dx: 124, dz: -148 },
    ],
    pairs: CLASSIC_PAIRS,
  },
  snow: {
    slots: [
      { dx: -168, dz: 96 }, { dx: 168, dz: -96 },
      { dx: 168, dz: 96 }, { dx: -168, dz: -96 },
    ],
    pairs: [[0, 1], [2, 3]],
  },
  urban: {
    slots: [
      { dx: -140, dz: 140 }, { dx: 140, dz: -140 },
      { dx: 140, dz: 140 }, { dx: -140, dz: -140 },
    ],
    pairs: CLASSIC_PAIRS,
  },
  coast: {
    slots: [
      { dx: -148, dz: 124 }, { dx: 148, dz: -124 },
      { dx: -96, dz: 145 }, { dx: 160, dz: -69 },
    ],
    pairs: [[0, 1], [2, 3]],
    seaNormal: CLASSIC_SEA_NORMAL,
  },
  tropical: {
    slots: [
      { dx: -148, dz: 124 }, { dx: 148, dz: -124 },
      { dx: -160, dz: 69 }, { dx: 96, dz: -145 },
    ],
    pairs: [[0, 1], [2, 3]],
    seaNormal: CLASSIC_SEA_NORMAL,
  },
  atoll: {
    slots: [
      { dx: -138, dz: 134 }, { dx: 138, dz: -134 },
      { dx: 138, dz: 134 }, { dx: -138, dz: -134 },
    ],
    pairs: CLASSIC_PAIRS,
  },
};

/** Classic geometry for campaign layouts and callers that do not name a skirmish preset. */
function startTableFor(preset?: string | null): StartTable {
  return (preset === null || preset === undefined ? undefined : MAP_START_TABLES[preset])
    ?? MAP_START_TABLES.temperate!;
}

/** Armies a skirmish seats when nothing says otherwise. */
export const SKIRMISH_ARMIES_DEFAULT = 2;
/** Armies a skirmish can seat at most — every map table is pinned to this size. */
export const SKIRMISH_ARMIES_MAX = SKIRMISH_START_OFFSETS.length;

/** Fold any requested army count into what this game can actually lay out. */
export function clampArmies(n: number | null | undefined): number {
  if (n === null || n === undefined || !Number.isFinite(n)) return SKIRMISH_ARMIES_DEFAULT;
  return Math.max(SKIRMISH_ARMIES_DEFAULT, Math.min(SKIRMISH_ARMIES_MAX, Math.trunc(n)));
}

/**
 * The start locations the TERRAIN GENERATOR must reserve a shelf at, for a map
 * with `armies` players and this sea.
 *
 * ONE DERIVATION, TWO CALLERS, and that is the same rule `terrain-plan.ts`
 * already states about itself: the prewarm and the eventual `new Terrain(...)`
 * must agree or the prewarmed fields are for a different map, silently.
 *
 * THE MAP CENTRE IS FIRST, AND ONLY ON A CONTINENT. Every `?shot=` fixture
 * builds on (256, 256) and needs it graded. On an ARCHIPELAGO the centre is
 * open water — the shoals — and reserving a guaranteed-DRY 58 m shelf there
 * would raise a fifth island in the middle of the lagoon, which is the exact
 * mechanism that drowned `08-naval-water` in reverse. So an archipelago
 * reserves one shelf per island and nothing else.
 *
 * ISLAND CENTRES COME FROM THE SEA ITSELF rather than from a parallel table.
 * There is no second list to drift: if an island moves, the start on it moves.
 */
export function startPointsFor(
  armies: number, sea: SeaSpec | null, seed: number, preset?: string | null,
): readonly { readonly x: number; readonly z: number }[] {
  const n = clampArmies(armies);
  const islands = sea?.islands;
  if (islands !== undefined && islands.length > 0) {
    return islands.slice(0, n).map((i) => ({ x: i.x, z: i.z }));
  }
  // ONE SHELF PER SEATED ARMY, AT THE SLOTS THAT ARMY WILL ACTUALLY USE — never
  // one per table entry. The preset is part of this derivation because coastal
  // alternatives are authored inland; omitting it here would reserve classic
  // ground while `startSpots` places a base on the map-specific table.
  return [
    { x: MAP_SIZE * 0.5, z: MAP_SIZE * 0.5 },
    ...seatedSlots(n, seed, sea, preset).map((slot) => {
      const o = startTableFor(preset).slots[slot]!;
      return { x: MAP_SIZE * 0.5 + o.dx, z: MAP_SIZE * 0.5 + o.dz };
    }),
  ];
}

/** Fold a compass bearing into [0, 360). */
export function wrapDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/**
 * Rotate which army gets which start spot, deterministically from the seed.
 *
 * WHY THIS EXISTS
 * ---------------
 * Reported: "why the game dont drop me in random locations?" Every match on a
 * given map put the human in the identical corner, because `startSpots()`
 * hands out terrain shelves in INDEX ORDER and the geometric fallback pins slot
 * 0 outright. With a `mapSeed` fixed per map on top of that, two matches on the
 * same battlefield were byte-identical.
 *
 * WHY IT ROTATES OWNERS AND NOT THE SPOTS
 * ---------------------------------------
 * The spots are load-bearing geometry: each one is positioned on the map's
 * authored diagonal, faces the next army round the table, and has an ore field
 * placed for it. Shuffling the COORDINATES would break that pairing. Rotating
 * which player sits in an unchanged spot changes the match without touching a
 * single balance assumption.
 *
 * WHY `hashU32(seed)` AND NOT `b.rng`
 * -----------------------------------
 * `ScenarioBuilder.rng` is one shared stream and every layout draws from it.
 * Taking a single number here would advance it for everything after — ore
 * patches, scatter, placement jitter — and silently re-roll all twelve
 * scorecard fixtures. A pure hash consumes nothing from the stream.
 *
 * THE FIXTURES ARE SAFE BY CONSTRUCTION, NOT BY EXCEPTION
 * -------------------------------------------------------
 * `hashU32(DEFAULT_SEED) % 2 === 0`, so the canonical `?shot=` seed yields the
 * IDENTITY arrangement and every fixture frames exactly the base it framed
 * before. That is asserted in `tests/start-rotation.spec.ts` rather than left
 * as a happy accident — if `DEFAULT_SEED` or the hash ever changes, the test
 * fails instead of the grade quietly moving.
 */
/**
 * ON since 2026-08-05. It was held off for a reason that MEASUREMENT DISPROVED.
 *
 * The hold said: "spot 1 has never been validated for a human", the theory being
 * that slot 1 had been the AI's for the project's whole life and an AI does not
 * file a bug when its tanks are stranded. Plausible, and wrong.
 *
 * Buildable fraction inside BUILD_RADIUS, 24 seeds x 4 biomes, real generator:
 *
 *              spot0 median   spot1 median   seeds under 60%
 *   temperate     68.2%          67.5%         7/24  10/24
 *   desert        70.8%          73.6%         3/24   1/24
 *   snow          66.4%          60.7%         9/24  12/24
 *   urban         61.5%          63.1%        12/24  11/24
 *
 * NEITHER spot was validated, and which one is better FLIPS by biome — spot1
 * wins on desert and urban, spot0 on snow and temperate. Aggregate seeds under
 * 60%: spot0 31/96, spot1 34/96. Three points apart. Rotation was never the
 * risk; it was blamed because it was the most recent change, and the underlying
 * defect — that `TERRAIN_START_POSITIONS` reserves one shelf at the map centre
 * and neither army opens anywhere near it — was equally present on the spot
 * everybody had always played.
 *
 * WHAT LANDED FIRST, so this is not simply the same flip again:
 *   - `nudgeToBuildable` (below) rescues an opening whose core is under
 *     `START_CORE_MIN`, jointly across spots so the armies cannot be pulled
 *     closer than `START_MIN_SEPARATION`. Seeds under 60% buildable: 65/192
 *     before, 15/192 after, with median army separation moving 193.0 -> 188-198.
 *   - `START_CLEAR_RADIUS` stops scattered props fouling the deploy footprint,
 *     which was the actual cause of "i cant build at all" — measured at up to
 *     48% of armies on `arid` before the fix, 0% after.
 *   - Connectivity was already handled and is not new: `connectedGround`
 *     relocates any spawn onto the main passable region and `auditConnectivity`
 *     fails the build if anything ends up stranded. That is what covers "the
 *     tanks are on top of hill ant cant reach me".
 *
 * STILL OPEN, and the honest reason this is an improvement rather than a cure:
 * the start-area guarantee in `config.ts` — flat, dry, buildable, connected,
 * VERIFIED IN THE GENERATOR — delivers 100.0% buildable ground on every biome
 * and every seed, and it is pointed at the map centre where nobody starts.
 * Wiring it to the real start positions would take both spots to ~100% and make
 * this validator redundant. It was not done here because terrain generation is
 * global: it would reshoot all twelve scorecard fixtures and move the grade.
 * Tracked separately.
 */
const START_ROTATION_ENABLED = true;

/** True when `player` is the one sitting at this machine. */
function isLocal(b: ScenarioBuilder, player: PlayerId): boolean {
  return (player as number) === (b.world.localPlayer as number);
}

/**
 * Which start slot the human ended up in after `rotateStarts`.
 *
 * Falls back to 0 for a spectator or an AI-vs-AI soak run, where no owner
 * matches — the camera still has to point somewhere.
 */
function localSlot(b: ScenarioBuilder, owners: readonly PlayerId[]): number {
  const at = owners.findIndex((p) => isLocal(b, p));
  return at < 0 ? 0 : at;
}

/**
 * Which slot owner 0 takes, 0..n-1, from the seed.
 *
 * TAKEN FROM THE HIGH BITS, and that is not stylistic. `hashU32 % n` — the
 * obvious form, and the one this shipped with for an afternoon — reads the
 * LOWEST bit, which is the weakest part of that hash for small inputs:
 *
 *     seeds 0..63       34.4% odd
 *     seeds 0..999      48.1% odd
 *     seeds 1..65535    49.6% odd
 *
 * Fine in bulk, badly biased exactly where players are. The parity of the first
 * 24 seeds is 100010000101100000101011, so of seeds 1..8 only seed 4 rotates —
 * confirmed in the real game before this was changed: eight browser boots and
 * seven of them opened in the same corner. A player trying `?seed=1`, `2`, `3`
 * would have concluded the feature did nothing, which is the complaint it exists
 * to fix.
 *
 * Scaling the whole 32-bit value into [0, n) uses the high bits instead, where
 * the avalanche has actually happened.
 */
function startOffset(seed: number, n: number): number {
  return Math.min(n - 1, Math.floor((hashU32(seed) / 0x1_0000_0000) * n));
}

/**
 * ============================================================================
 * WHICH SLOTS A MATCH SITS IN — the answer to "its almost always the same
 * spawns", and the half of it that is NOT the owner rotation.
 * ============================================================================
 * `rotateStarts` already varies WHO gets which spot. It does not vary WHICH
 * SPOTS ARE USED, and with two armies on a four-slot table that is the whole
 * complaint: slots 0 and 1 were seated in every match ever played, and rotation
 * only ever swapped the two players between them. Two positions, for the life
 * of the game, on every landlocked map.
 *
 * THE FOUR PAIRS ARE THE FOUR WIDEST, AND THAT IS A RULE RATHER THAN A LIST.
 * There are six ways to pick 2 of 4. On the authored diagonal they measure
 *
 *     [0,1] 386.2 m   [2,3] 386.2 m   [0,2] 296.0 m   [1,3] 296.0 m
 *     [0,3] 248.0 m   [1,2] 248.0 m                   <- the short edges, cut
 *
 * so the table below is exactly "every pairing except the two adjacent ones".
 * `tests/start-pairs.spec.ts` re-derives it from the offsets rather than
 * restating it, because the day a map authors its own offsets the LIST would
 * still look right while meaning something else.
 */
/**
 * THE SALT IS LOAD-BEARING AND IT COST A MEASUREMENT TO FIND.
 *
 * `startOffset(seed, 2)` — which `rotateStarts` uses to decide who sits where —
 * reads `hashU32(seed)` too. Unsalted, `floor(u * 4) >> 1 === floor(u * 2)` for
 * EVERY seed (0 disagreements over 20 000), so the pair and the rotation move in
 * lockstep. Measured occupancy of the LOCAL player over 20 000 seeds, without
 * the salt:
 *
 *     slot 0 ~5015     slot 1 = 0     slot 2 ~9975     slot 3 ~5010
 *
 * One corner unreachable and another at even money — from the feature whose
 * entire purpose is to stop the player seeing the same corner. The pair
 * HISTOGRAM was uniform throughout (106/90/110/94 over seeds 1..400), so a test
 * that checks which PAIR was drawn passes while the thing a player actually
 * experiences is broken. Pin the corner, not the pair.
 *
 * 0x9e3779b9 is the golden-ratio constant, used here only as a decorrelating
 * XOR; nothing depends on its value beyond it not being 0.
 */
function startPairFor(seed: number): number {
  return Math.min(
    CLASSIC_PAIRS.length - 1,
    Math.floor((hashU32(seed ^ 0x9e37_79b9) / 0x1_0000_0000) * CLASSIC_PAIRS.length),
  );
}

/**
 * The authored slots a match of `armies` players occupies, for this seed.
 *
 * ONE DERIVATION, TWO CALLERS, and that is the whole reason it is a function.
 * `startPointsFor` reserves the terrain shelves and `startSpots` places the
 * bases; they must name the same slots or a base stands on unlevelled ground.
 * The selected `MAP_START_TABLES` entry is therefore data, not presentation.
 *
 * `clampArmies`, NOT `Math.max(1, n)` — `startSpots` used the latter, so at
 * count 1 the two derivations disagreed about whether the pair gate applied.
 */
export function seatedSlots(
  armies: number, seed: number, sea: SeaSpec | null = null, preset?: string | null,
): readonly number[] {
  const n = clampArmies(armies);
  const table = startTableFor(preset);
  if (n !== 2) return Array.from({ length: Math.min(n, table.slots.length) }, (_, i) => i);
  const pairs = dryPairs(sea, table);
  return pairs[startPairFor(seed) % pairs.length]!;
}

/**
 * Inland metres between an authored slot and this sea's waterline. Negative
 * means the slot is IN THE WATER.
 *
 * The same quantity `Terrain.resolveStarts` measures before it slides a shelf,
 * restated here because the choice has to be made BEFORE the generator runs —
 * a slot pushed 176 m inland is not the slot anybody reserved.
 */
function slotClearance(slot: number, sea: SeaSpec, table: StartTable): number {
  const o = table.slots[slot];
  if (o === undefined) return Number.POSITIVE_INFINITY;
  const px = MAP_SIZE * 0.5 + o.dx;
  const pz = MAP_SIZE * 0.5 + o.dz;
  // `normalX/normalZ` point OUT TO SEA, so a positive dot is metres of water.
  return -((px - sea.x) * sea.normalX + (pz - sea.z) * sea.normalZ);
}

/**
 * The authored pairs that also clear this map's real waterline.
 *
 * Pairings live in `MAP_START_TABLES` so a snow corridor can expose fewer
 * strategic axes and each coast can provide two genuinely different dry
 * openings. This physical filter remains as the safety net: moving a shoreline
 * must fail closed instead of seating an army at a wet or generator-pushed
 * slot. `tests/map-start-tables.spec.ts` checks the full shelf budget.
 */
function dryPairs(
  sea: SeaSpec | null, table: StartTable,
): readonly (readonly [number, number])[] {
  if (sea === null || (sea.islands !== undefined && sea.islands.length > 0)) return table.pairs;
  const want = TERRAIN_START_FLAT_RADIUS + TERRAIN_START_EDGE_WOBBLE
    + sea.bandWidth + sea.wavinessMetres + TERRAIN_SEA_START_CLEARANCE;
  const dry = table.pairs.filter((p) => p.every((slot) => slotClearance(slot, sea, table) >= want));
  /*
   * THE FALLBACK IS NOT BELT-AND-BRACES; IT FIRES ON A REAL SEA WE SHIP.
   *
   * Slots 0 and 1 are dry by construction only for a sea placed by
   * `seaOffMapCentre`, which derives its normal FROM those two slots. That
   * covers every playable coastal map. It does NOT cover `NAVAL_SEA`, whose
   * normal is hand-authored as (-SQRT1_2, -SQRT1_2) and is not perpendicular to
   * the 0-1 axis at all. Measured against its own 95 m budget:
   *
   *     slot0  -22.6     slot1  +11.3     slot2  +186.7     slot3  -198.0
   *
   * — one slot dry, so NO pair survives the filter. That is pre-existing and it
   * is fine: `NAVAL_SEA` has one reader, the `?shot=` naval fixture, which is a
   * posed frame rather than a playable match and never had to clear the budget.
   * What matters is that this returns [0,1] there, so the fixture keeps the
   * exact layout it has always been photographed with.
   *
   * Returning an empty list instead would take `pairs[i % 0]` to `undefined` and
   * put both armies on the map centre.
   */
  return dry.length > 0 ? dry : table.pairs.slice(0, 1);
}

export function rotateStarts<T>(owners: readonly T[], seed: number): T[] {
  const n = owners.length;
  if (n < 2 || !START_ROTATION_ENABLED) return owners.slice();
  const offset = startOffset(seed, n);
  const out: T[] = new Array<T>(n);
  for (let i = 0; i < n; i++) out[i] = owners[(i + offset) % n];
  return out;
}

/* --------------------------------------------------------------------------
 * THE START-SPOT VALIDATOR
 *
 * WHY IT IS NEEDED, MEASURED RATHER THAN ASSUMED
 * ----------------------------------------------
 * `src/core/config.ts` promises, of a reserved start area: "flat, dry,
 * buildable, and joined to the map's main passable region. Verified inside the
 * generator, not hoped for." That guarantee is real and it works — measured over
 * 24 seeds x 4 biomes, the reserved shelf is 100.0% buildable inside
 * BUILD_RADIUS, every single time.
 *
 * It is aimed at the wrong place. `TERRAIN_START_POSITIONS` holds ONE entry,
 * `[0.5, 0.5]` — the map centre — and `world/terrain.system.ts` constructs
 * `Terrain` with no `starts` option, so that default is what gets reserved.
 * `startSpots` then only uses shelves when `shelves.length >= n`, which for two
 * armies is false, so it ALWAYS falls through to the geometric fan below. The
 * two positions the armies actually open on sit 96.5 m from the only guaranteed
 * ground, whose guard radius is 54 m — entirely outside it.
 *
 * What that costs, same sweep, buildable fraction inside BUILD_RADIUS:
 *
 *              spot0 median   spot1 median   seeds under 60%
 *   temperate     68.2%          67.5%         7/24  10/24
 *   desert        70.8%          73.6%         3/24   1/24
 *   snow          66.4%          60.7%         9/24  12/24
 *   urban         61.5%          63.1%        12/24  11/24
 *   centre       100.0%             —          0/24
 *
 * TWO CONCLUSIONS, BOTH LOAD-BEARING
 * ----------------------------------
 * 1. About a THIRD of all openings, on either spot, have under 60% buildable
 *    ground in the build radius. That is the actual defect behind "You spawned
 *    me in a place i cannot build".
 * 2. `START_ROTATION_ENABLED`'s stated reason for being off — "spot 1 has never
 *    been validated for a human" — is false. NEITHER spot is validated, and
 *    which of the two is better FLIPS by biome (spot1 wins on desert and urban,
 *    spot0 on snow and temperate). Aggregate seeds under 60%: spot0 31/96,
 *    spot1 34/96. Three points apart. Rotation was never the risk.
 *
 * WHY A NUDGE AND NOT A TERRAIN RESERVATION
 * -----------------------------------------
 * Reserving shelves at the real spots would be the deeper fix and would take
 * both to ~100%. It was rejected for now, deliberately:
 *   - Terrain generation is GLOBAL. Changing `TERRAIN_START_POSITIONS` changes
 *     the heightfield for every scenario, so all twelve scorecard fixtures
 *     reshoot and the grade moves — a large, hard-to-attribute change.
 *   - The centre shelf cannot simply be replaced. Most fixtures build ON the map
 *     centre (`allied-base` at cx-1, cz-7), so they are standing on that
 *     guaranteed 100% disc today. Removing it would drop them onto ungraded
 *     ground.
 *   - Keeping the centre AND adding two more overlaps them: the spots are 96.5 m
 *     from centre and the flat radius is 58 m, so 58 + 58 > 96.5. Three discs
 *     levelled to three different local terraces, overlapping, is a new class of
 *     problem rather than a fix.
 * `startSpots` is called by exactly one scenario plan and by tests — checked —
 * so nudging here cannot touch a fixture at all.
 * -------------------------------------------------------------------------- */

/** Metres of core a base needs to open comfortably. Scored, not guaranteed. */
export const START_CORE_RADIUS = 30;

/**
 * Below this buildable fraction a spot is UNACCEPTABLE and gets rescued. At or
 * above it, the authored position is kept untouched.
 *
 * The distinction between this and `START_CORE_TARGET` is the whole design, and
 * it was added after measuring. With one threshold at 0.9 the validator did fix
 * the tail — seeds under 60% buildable across BUILD_RADIUS fell from 65/192 to
 * 10/192 — but its MEDIAN move was 32-44 m and it hit the 44 m cap on nearly
 * every spot. That is not rescuing bad openings, it is relocating all of them.
 * The authored positions carry the map's balance, its ore pairing and the
 * camera's framing; a validator that moves every start 40 m is a bigger change
 * than the defect it fixes.
 *
 * So: rescue only what is actually broken, and leave a merely-average opening
 * alone.
 */
export const START_CORE_MIN = 0.7;

/** Once a candidate reaches this, stop searching outward — nearer is better. */
export const START_CORE_TARGET = 0.9;
/** Furthest a spot may be moved from its authored position, metres. */
export const START_NUDGE_MAX = 44;

/**
 * Two starts may never end up closer than this, metres.
 *
 * The authored diagonal puts them 193 m apart. Nudging each independently by up
 * to `START_NUDGE_MAX` could bring them to 105 m — and an opening where the two
 * armies are half as far apart as designed is a balance change, not a bug fix.
 * The armies would be in contact before either had a refinery.
 *
 * So the search is JOINT rather than per-spot: a candidate that crowds a start
 * already placed this call is rejected outright, however buildable it is.
 * 150 m keeps the opening recognisably the authored one (78% of 193 m) while
 * still leaving the validator most of its search area.
 */
export const START_MIN_SEPARATION = 150;
/** Candidate rings, metres. 0 first, so an already-good spot never moves. */
const NUDGE_RINGS: readonly number[] = [0, 8, 16, 24, 32, 40, 44];
/** Candidate bearings per ring. 12 is every 30 degrees. */
const NUDGE_BEARINGS = 12;

/**
 * Buildable fraction of the disc of `radius` around (x, z), 0..1.
 *
 * Returns 1 when there is no terrain module — a bare `World` uses FlatTerrain,
 * where everything is open and there is nothing to search for. That also keeps
 * `startSpots` pure for the tests that call it with no world at all.
 */
function buildableFraction(x: number, z: number, radius: number): number {
  const t = getTerrain();
  // Null as well as undefined: a bare `World` uses FlatTerrain and the module
  // accessor returns null before `world.terrain` is installed.
  if (t === null || t === undefined) return 1;
  let ok = 0;
  let total = 0;
  const cxLo = worldToCell(x - radius);
  const cxHi = worldToCell(x + radius);
  const czLo = worldToCell(z - radius);
  const czHi = worldToCell(z + radius);
  const r2 = radius * radius;
  for (let gz = czLo; gz <= czHi; gz++) {
    for (let gx = cxLo; gx <= cxHi; gx++) {
      const wx = (gx + 0.5) * CELL;
      const wz = (gz + 0.5) * CELL;
      const dx = wx - x;
      const dz = wz - z;
      if (dx * dx + dz * dz > r2) continue;
      total++;
      if (t.isBuildable(gx, gz)) ok++;
    }
  }
  return total === 0 ? 0 : ok / total;
}

/**
 * Move (x, z) to the nearest nearby ground a base can actually open on.
 *
 * Deterministic: a fixed ring/bearing order, no RNG, no clock.
 *
 * `others` are starts already placed this call. A candidate closer than
 * `START_MIN_SEPARATION` to any of them is rejected however buildable it is —
 * see that constant for why nudging each spot independently is not safe.
 *
 * Returns the authored point unchanged when it is already good enough, or when
 * nothing better exists within reach. A WORSE spot is never chosen, so a map
 * with no good ground anywhere degrades to today's behaviour rather than to a
 * throw or to a random relocation.
 */
export function nudgeToBuildable(
  x: number, z: number, others: readonly { x: number; z: number }[] = [],
): { x: number; z: number; moved: number } {
  let bestX = x;
  let bestZ = z;
  let best = buildableFraction(x, z, START_CORE_RADIUS);
  // Good enough as authored. This is the common case and it must cost nothing.
  if (best >= START_CORE_MIN) return { x, z, moved: 0 };

  const crowds = (px: number, pz: number): boolean => {
    for (const o of others) {
      if (Math.hypot(px - o.x, pz - o.z) < START_MIN_SEPARATION) return true;
    }
    return false;
  };

  for (const ring of NUDGE_RINGS) {
    if (ring === 0) continue;
    if (ring > START_NUDGE_MAX) break;
    for (let k = 0; k < NUDGE_BEARINGS; k++) {
      const a = (k / NUDGE_BEARINGS) * Math.PI * 2;
      const px = clampWorld(x + Math.cos(a) * ring, 4);
      const pz = clampWorld(z + Math.sin(a) * ring, 4);
      if (crowds(px, pz)) continue;
      const score = buildableFraction(px, pz, START_CORE_RADIUS);
      if (score > best) {
        best = score;
        bestX = px;
        bestZ = pz;
      }
    }
    // Stop at the first ring that produced a good enough spot: nearer is better,
    // because the authored positions carry the map's balance and framing.
    if (best >= START_CORE_TARGET) break;
  }

  return { x: bestX, z: bestZ, moved: Math.hypot(bestX - x, bestZ - z) };
}

export function startSpots(
  cx: number, cz: number, count: number, sea: SeaSpec | null, seed: number,
  preset?: string | null,
): StartSpot[] {
  const islands = sea?.islands;
  /*
   * AN ISLAND MAP CANNOT SEAT MORE ARMIES THAN IT HAS ISLANDS, and the clamp is
   * here rather than at the caller because this is the only place that knows
   * both numbers. Falling through to the offset table for the surplus would put
   * a base in the sea; fanning it round the centre would put it on the shoals.
   */
  const n = islands !== undefined && islands.length > 0
    ? Math.max(1, Math.min(count, islands.length))
    : Math.max(1, count);
  const pts: { x: number; z: number }[] = [];

  /*
   * AN ARCHIPELAGO'S START TABLE IS ITS ISLAND LIST.
   *
   * Offsets from a centre are the right primitive for a continent, where the
   * layout is free geometry and the ground is negotiable. On an island map the
   * ground is the layout: there are exactly four places a base can stand and
   * they are the four ellipses the generator carved. Deriving the spots from
   * anything else — a scaled ellipse, a second table — reintroduces the
   * disagreement `SKIRMISH_START_OFFSETS`' own header is about, except that the
   * failure mode here is a construction yard in the sea rather than an
   * unlevelled one on land.
   *
   * `cx`/`cz` are ignored on this path on purpose: island centres are absolute
   * world positions and there is no shelf to hang them off.
   */
  if (islands !== undefined && islands.length > 0) {
    for (let i = 0; i < n; i++) {
      pts.push({ x: clampWorld(islands[i].x, 4), z: clampWorld(islands[i].z, 4) });
    }
  }

  /*
   * SHELVES GUARANTEE THE GROUND. THEY DO NOT CHOOSE THE POSITIONS.
   *
   * REGRESSION FIXED HERE, introduced in v1.21.0 by me and reported the same
   * day as "enemies base is like 10 meters from mine, thats kinda weird".
   *
   * Before v1.21.0 the generator reserved ONE shelf (the map centre), so
   * `shelves.length >= n` was false for two armies and this always fell through
   * to the fan below. v1.21.0 started reserving three — centre plus both real
   * starts — which made the condition TRUE, and this branch then handed out
   * `shelves[0]` and `shelves[1]`: THE MAP CENTRE and one army's start. The
   * opening distance collapsed from 193 m to 96.6 m and one army spawned on top
   * of the middle of the map.
   *
   * The branch is gone rather than reordered. Both consumers resolve the same
   * `MAP_START_TABLES` entry, so the positions already agree by construction;
   * consulting the shelf list to REDISCOVER them could only reintroduce drift.
   * A shelf's job is to make the ground under a known point buildable, which
   * it does whether or not anybody reads the list back.
   */
  {
    // The authored opening comes from the selected table, so every slot up to
    // `SKIRMISH_ARMIES_MAX` lands exactly on a shelf the generator reserved. A
    // saved seed frames the same valley it always did: slots 0 and 1 are the
    // same two literals the two-entry table held.
    // `seatedSlots` is the SAME derivation `startPointsFor` used to reserve the
    // shelves. Walking `i` directly — which is what this did — is what pinned
    // every match to slots 0 and 1 forever; it would now also put a base on
    // ground the generator never levelled, because the reservation moved.
    const table = startTableFor(preset);
    const slots = seatedSlots(n, seed, sea, preset);
    for (let i = pts.length; i < Math.min(n, slots.length); i++) {
      const o = table.slots[slots[i]!]!;
      pts.push({ x: clampWorld(cx + o.dx, 4), z: clampWorld(cz + o.dz, 4) });
    }
    // FIVE or more armies have no authored layout, so they fan around the
    // centre on the same ellipse. They get no reserved shelf and fall back to
    // `nudgeToBuildable` below, which is the pre-existing behaviour for a case
    // no shipping map offers today.
    for (let i = pts.length; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      pts.push({
        x: clampWorld(cx + Math.cos(t) * START_SPREAD_X, 4),
        z: clampWorld(cz + Math.sin(t) * START_SPREAD_Z, 4),
      });
    }
  }

  // VALIDATE BEFORE FACING. A nudged spot must be faced from where it ENDED UP,
  // or two armies 105 m apart end up looking at where they used to be. A spot
  // that came from a reserved shelf is already guaranteed and scores 1.0, so
  // this is a no-op on that path rather than a second opinion about it.
  // Joint, not independent: each spot is validated against the ones already
  // settled, so the search cannot quietly halve the opening distance.
  const settled: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const fixed = nudgeToBuildable(pts[i].x, pts[i].z, settled);
    pts[i] = { x: fixed.x, z: fixed.z };
    settled.push(pts[i]);
  }

  const out: StartSpot[] = [];
  for (let i = 0; i < n; i++) {
    // Face the NEXT army round the table; with two armies that is each other.
    const foe = pts[(i + 1) % n];
    const dx = foe.x - pts[i].x;
    const dz = foe.z - pts[i].z;
    const facingDeg = dx === 0 && dz === 0 ? 0 : Math.atan2(dx, dz) / DEG2RAD;
    out.push({ x: pts[i].x, z: pts[i].z, facingDeg });
  }
  return out;
}

/* ==========================================================================
 * 2. FALLBACK CONTENT TABLE
 *
 * The vocabulary of things a scenario can ask for, with enough stats to spawn a
 * credible entity before `src/data/**` exists. When a real DefTables is found
 * these are used only for the fields it does not carry.
 * ========================================================================== */

const U = UNIT_DIMENSIONS;
const B = BUILDING_DIMENSIONS;
const NU = NAVAL_UNIT_DIMENSIONS;
const NB = NAVAL_BUILDING_DIMENSIONS;

export interface FallbackUnit {
  readonly key: string;
  readonly kind: EntityKind.Infantry | EntityKind.Vehicle;
  /** Metres. Drives the collision radius and the placeholder box. */
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly maxHp: number;
  readonly armor: ArmorClass;
  readonly maxSpeed: number;
  readonly accel: number;
  readonly turnRate: number;
  readonly turretTurnRate: number;
  readonly locomotor: Locomotor;
  readonly sight: number;
  readonly crushLevel: number;
  readonly crushableBy: number;
  readonly cargoMax: number;
  readonly flags: number;
  /** Faction this unit belongs to, or Neutral when both sides field it. */
  readonly faction: Faction;
}

const MOVER = EntityFlag.CanMove | EntityFlag.ProvidesVision;
const GUNNER = EntityFlag.CanAttack;
const TURRETED = EntityFlag.CanAttack | EntityFlag.HasTurret;

/**
 * Reclamation hull turn rate, rad/s — the same derivation as
 * `src/data/Defs.ts#RCL_TURN`, written out here because these rows must agree
 * with the def table to the digit (see `tests/data.spec.ts`).
 *
 * A turretless army slews its whole chassis to bear, so it gets a full extra
 * radian/sec over the shared `2.6 - length * 0.14`.
 */
function RCL_TURN(dim: { l: number }): number {
  return 3.6 - dim.l * 0.14;
}

function unit(
  key: string,
  kind: EntityKind.Infantry | EntityKind.Vehicle,
  dim: { l: number; w: number; h: number },
  maxHp: number,
  armor: ArmorClass,
  maxSpeed: number,
  locomotor: Locomotor,
  sight: number,
  flags: number,
  faction: Faction,
  extra?: Partial<FallbackUnit>,
): FallbackUnit {
  return {
    key,
    kind,
    length: dim.l,
    width: dim.w,
    height: dim.h,
    maxHp,
    armor,
    maxSpeed,
    // Heavier things accelerate and turn slower; this single derivation is what
    // stops an Anvil and a dog reading as the same chassis when they move.
    accel: extra?.accel ?? Math.max(2.4, maxSpeed * 1.15),
    turnRate: extra?.turnRate ?? (kind === EntityKind.Infantry ? 6.0 : 2.6 - dim.l * 0.14),
    turretTurnRate: extra?.turretTurnRate ?? 1.9,
    locomotor,
    sight,
    crushLevel: extra?.crushLevel ?? 0,
    crushableBy: extra?.crushableBy ?? 0,
    cargoMax: extra?.cargoMax ?? 0,
    flags: MOVER | flags,
    faction,
  };
}

/** Every unit a scenario may ask for, keyed by content key. */
export const FALLBACK_UNITS: Readonly<Record<string, FallbackUnit>> = {
  gi: unit('gi', EntityKind.Infantry, U.infantry, 120, ArmorClass.Infantry, 3.2,
    Locomotor.Foot, 24, GUNNER | EntityFlag.Crushable, Faction.Allies, { crushableBy: 1 }),
  engineer: unit('engineer', EntityKind.Infantry, U.infantry, 90, ArmorClass.Infantry, 3.4,
    Locomotor.Foot, 20, EntityFlag.Crushable, Faction.Neutral, { crushableBy: 1 }),
  conscript: unit('conscript', EntityKind.Infantry, U.infantry, 100, ArmorClass.Infantry, 3.4,
    Locomotor.Foot, 22, GUNNER | EntityFlag.Crushable, Faction.Soviets, { crushableBy: 1 }),
  attackDog: unit('attackDog', EntityKind.Infantry, U.attackDog, 70, ArmorClass.Infantry, 6.2,
    Locomotor.Foot, 26, GUNNER | EntityFlag.Crushable, Faction.Soviets, { crushableBy: 1 }),

  /* -- the anti-armour pair ------------------------------------------------
   * Two rows carrying the same warning the commanders below do, and for the
   * identical reason: `ProductionService.spawnUnit` reads `FALLBACK_UNITS`
   * BEFORE the def table, so a Javelin with a flawless def row and no row here
   * would take the player's 500 credits, run its build bar to 100%, and never
   * walk out of the barracks. Silently. Forever.
   *
   * There is a second edge on the same trap, specific to these two: `unit()`
   * in `src/data/Defs.ts` defaults `flags` to ZERO for the original armies
   * because `spawnUnit` ORs the def's flags on top of the fallback's. A def-only
   * unit would therefore spawn with no `CanMove` and no `CanAttack` — a soldier
   * that stands where he was built and never fires. `GUNNER | Crushable` here
   * is what actually arms both of them.
   *
   * Every number is transcribed from `src/data/Defs.ts`; `tests/data.spec.ts`
   * asserts the two tables agree. ---------------------------------------- */
  javelin: unit('javelin', EntityKind.Infantry, U.infantry, 125, ArmorClass.Infantry, 3.0,
    Locomotor.Foot, 25, GUNNER | EntityFlag.Crushable, Faction.Allies, { crushableBy: 1 }),
  flakTrooper: unit('flakTrooper', EntityKind.Infantry, U.infantry, 110, ArmorClass.Infantry, 3.3,
    Locomotor.Foot, 23, GUNNER | EntityFlag.Crushable, Faction.Soviets, { crushableBy: 1 }),

  /* -- THE COMMANDERS -------------------------------------------------------
   * One hero per army, and they need a row here for a reason that is easy to
   * miss: `ProductionService.spawnUnit` returns NONE when
   * `FALLBACK_UNITS[entry.key]` is undefined, BEFORE it ever looks at the def
   * table. A commander with a perfect def row and no fallback row would build,
   * charge the player, reach 100%, and then never come out of the barracks —
   * silently, forever. Every number below is transcribed from
   * `src/data/Defs.ts`; `tests/data.spec.ts` asserts the two agree.
   * ---------------------------------------------------------------------- */
  fieldMarshal: unit('fieldMarshal', EntityKind.Infantry, U.infantry, 460, ArmorClass.Infantry, 3.8,
    Locomotor.Foot, 34, GUNNER | EntityFlag.Crushable, Faction.Allies, { crushableBy: 1 }),
  commissar: unit('commissar', EntityKind.Infantry, U.infantry, 520, ArmorClass.Infantry, 3.5,
    Locomotor.Foot, 30, GUNNER | EntityFlag.Crushable, Faction.Soviets, { crushableBy: 1 }),

  grizzly: unit('grizzly', EntityKind.Vehicle, U.lightTank, 340, ArmorClass.Medium, 6.6,
    Locomotor.Track, 30, TURRETED | EntityFlag.Crusher, Faction.Allies,
    { crushLevel: 3, crushableBy: 5 }),
  ifv: unit('ifv', EntityKind.Vehicle, U.ifv, 220, ArmorClass.Light, 8.4,
    Locomotor.Wheel, 32, TURRETED, Faction.Allies, { crushableBy: 4, turretTurnRate: 3.4 }),
  prismTank: unit('prismTank', EntityKind.Vehicle, U.prismTank, 260, ArmorClass.Light, 6.0,
    Locomotor.Track, 34, TURRETED, Faction.Allies, { crushLevel: 2, crushableBy: 5 }),

  rhino: unit('rhino', EntityKind.Vehicle, U.heavyTank, 420, ArmorClass.Heavy, 5.4,
    Locomotor.Track, 28, TURRETED | EntityFlag.Crusher, Faction.Soviets,
    { crushLevel: 4, crushableBy: 6 }),
  apocalypse: unit('apocalypse', EntityKind.Vehicle, U.apocalypse, 800, ArmorClass.Heavy, 3.8,
    Locomotor.Track, 30, TURRETED | EntityFlag.Crusher, Faction.Soviets,
    { crushLevel: 6, crushableBy: 0, turretTurnRate: 1.2 }),
  v4: unit('v4', EntityKind.Vehicle, U.prismTank, 270, ArmorClass.Light, 4.4,
    Locomotor.Track, 38, TURRETED, Faction.Soviets, { crushableBy: 5 }),

  harvester: unit('harvester', EntityKind.Vehicle, U.harvester, 1000, ArmorClass.Heavy, 5.0,
    Locomotor.Track, 20, EntityFlag.IsHarvester | EntityFlag.Crusher, Faction.Neutral,
    { crushLevel: 5, cargoMax: HARVESTER_CAPACITY }),
  mcv: unit('mcv', EntityKind.Vehicle, U.mcv, 1000, ArmorClass.Heavy, 4.2,
    Locomotor.Wheel, 22, 0, Faction.Neutral, { crushableBy: 0 }),

  gunboat: unit('gunboat', EntityKind.Vehicle, NU.gunboat, 400, ArmorClass.Light, 7.0,
    Locomotor.Hover, 34, TURRETED, Faction.Allies),
  destroyer: unit('destroyer', EntityKind.Vehicle, NU.destroyer, 700, ArmorClass.Medium, 6.4,
    Locomotor.Hover, 36, TURRETED, Faction.Allies),
  submarine: unit('submarine', EntityKind.Vehicle, NU.submarine, 500, ArmorClass.Light, 6.0,
    Locomotor.Hover, 30, GUNNER, Faction.Soviets),
  dreadnought: unit('dreadnought', EntityKind.Vehicle, NU.dreadnought, 900, ArmorClass.Heavy, 4.0,
    Locomotor.Hover, 38, TURRETED, Faction.Soviets),
  transport: unit('transport', EntityKind.Vehicle, NU.transport, 780, ArmorClass.Light, 5.4,
    Locomotor.Hover, 26, 0, Faction.Neutral),

  /* -- THE ALLIED AND SOVIET AIR ARMS --------------------------------------
   * Two rows carrying the same warning as the commanders and the anti-armour
   * pair above, and it bites HARDER here than anywhere else in this table:
   * `ProductionService.spawnUnit` reads `FALLBACK_UNITS` BEFORE the def table
   * and returns NONE when the row is missing, so a Petrel Bomber with a flawless
   * def row and no row here would take 1200 credits, run its bar to 100%, and
   * never leave the factory. Silently. Forever.
   *
   * And the second edge, which is the one specific to these two:
   * `src/data/Defs.ts#unit()` defaults `flags` to ZERO for the original armies
   * because `spawnUnit` ORs the def's flags on top of the fallback's — so
   * without `GUNNER` here an aircraft would spawn with no CanMove and no
   * CanAttack. `MovementIntegrator` skips anything without CanMove, and the
   * climb to `AIR_CRUISE_ALTITUDE` lives inside that integrator: the unit
   * would sit on the runway at ground level, unarmed, and every gun in the
   * game would be allowed to shoot it because `weaponCanHurt` reads the
   * locomotor rather than the height. A def-only aircraft is not a plane that
   * cannot move; it is a tank with 240 hp and no gun.
   *
   * `Locomotor.Air`, in lockstep with `src/data/Defs.ts` — see the Kestrel row
   * above. Every number is transcribed from there and `tests/data.spec.ts`
   * asserts the two tables agree.                                          */
  vindicator: unit('vindicator', EntityKind.Vehicle, U.ifv, 240, ArmorClass.Light, 11.5,
    Locomotor.Air, 38, GUNNER, Faction.Allies, { crushableBy: 0, turnRate: 2.9 }),
  mig: unit('mig', EntityKind.Vehicle, U.ifv, 190, ArmorClass.Light, 13.5,
    Locomotor.Air, 32, GUNNER, Faction.Soviets, { crushableBy: 0, turnRate: 3.6 }),

  /* -- THE MERIDIAN PACT ---------------------------------------------------
   * Transcribed from `src/data/Defs.ts` §1, which is authoritative for every
   * number here. Two Pact-wide rules are visible in the rows and are the whole
   * faction: EVERY hull is `Locomotor.Hover` (Flowfield promotes a hover unit
   * to MoveClass.Naval on its first water query, so the army is amphibious and
   * pays no slope cost), and every hull is `crushLevel: 0` — nothing the Pact
   * fields can drive over anything.
   * ---------------------------------------------------------------------- */
  mrdWayfarer: unit('mrdWayfarer', EntityKind.Infantry, U.infantry, 110, ArmorClass.Infantry, 3.8,
    Locomotor.Foot, 26, GUNNER | EntityFlag.Crushable, Faction.Meridian, { crushableBy: 1 }),
  mrdLancer: unit('mrdLancer', EntityKind.Infantry, U.infantry, 130, ArmorClass.Infantry, 3.2,
    Locomotor.Foot, 26, GUNNER | EntityFlag.Crushable, Faction.Meridian, { crushableBy: 1 }),
  mrdArtificer: unit('mrdArtificer', EntityKind.Infantry, U.infantry, 95, ArmorClass.Infantry, 3.6,
    Locomotor.Foot, 22, EntityFlag.Crushable, Faction.Meridian, { crushableBy: 1 }),
  mrdHierarch: unit('mrdHierarch', EntityKind.Infantry, U.infantry, 430, ArmorClass.Infantry, 4.0,
    Locomotor.Foot, 36, GUNNER | EntityFlag.Crushable, Faction.Meridian, { crushableBy: 1 }),

  mrdCollector: unit('mrdCollector', EntityKind.Vehicle, U.harvester, 800, ArmorClass.Light, 7.0,
    Locomotor.Hover, 22, EntityFlag.IsHarvester, Faction.Meridian,
    { crushableBy: 6, cargoMax: 450 }),
  mrdSkiff: unit('mrdSkiff', EntityKind.Vehicle, U.ifv, 190, ArmorClass.Light, 9.2,
    Locomotor.Hover, 32, TURRETED, Faction.Meridian, { crushableBy: 4, turretTurnRate: 3.4 }),
  mrdSolarch: unit('mrdSolarch', EntityKind.Vehicle, U.lightTank, 330, ArmorClass.Light, 7.6,
    Locomotor.Hover, 30, TURRETED, Faction.Meridian, { crushableBy: 5 }),
  mrdZenith: unit('mrdZenith', EntityKind.Vehicle, U.prismTank, 240, ArmorClass.Light, 6.2,
    Locomotor.Hover, 34, TURRETED, Faction.Meridian, { crushableBy: 5 }),
  mrdCarryall: unit('mrdCarryall', EntityKind.Vehicle, U.mcv, 950, ArmorClass.Heavy, 5.0,
    Locomotor.Hover, 22, 0, Faction.Meridian, { crushableBy: 0 }),
  // `Locomotor.Air` exists now, and this row has to move with `src/data/Defs.ts`
  // or `spawnUnit` gives a Kestrel a different chassis depending on whether the
  // def table happened to be bound — the exact disagreement
  // `tests/data.spec.ts` "does not silently re-balance the game" exists to catch.
  mrdKestrel: unit('mrdKestrel', EntityKind.Vehicle, U.ifv, 210, ArmorClass.Light, 12.0,
    Locomotor.Air, 36, GUNNER, Faction.Meridian, { crushableBy: 0, turnRate: 3.2 }),

  mrdCorvette: unit('mrdCorvette', EntityKind.Vehicle, NU.gunboat, 380, ArmorClass.Light, 7.6,
    Locomotor.Hover, 34, TURRETED, Faction.Meridian),
  mrdMonitor: unit('mrdMonitor', EntityKind.Vehicle, NU.destroyer, 780, ArmorClass.Medium, 5.6,
    Locomotor.Hover, 38, TURRETED, Faction.Meridian),

  /* -- THE RECLAMATION -----------------------------------------------------
   * Transcribed from `src/data/Defs.ts` §1, which is authoritative for every
   * number here. Two army-wide rules are visible in the rows and they ARE the
   * faction: not one entry carries `TURRETED` (a Reclamation gun is bolted to
   * its hull and fires inside `COMBAT_WEAPONS.hullArcDeg`), and every ground
   * hull is `Locomotor.Wheel` on a turn rate a full radian/sec above the
   * shared derivation, because a turretless chassis has to slew to bear.
   * ---------------------------------------------------------------------- */
  rclPicker: unit('rclPicker', EntityKind.Infantry, U.infantry, 85, ArmorClass.Infantry, 3.6,
    Locomotor.Foot, 22, GUNNER | EntityFlag.Crushable, Faction.Reclaim, { crushableBy: 1 }),
  rclSlagger: unit('rclSlagger', EntityKind.Infantry, U.infantry, 115, ArmorClass.Infantry, 3.0,
    Locomotor.Foot, 20, GUNNER | EntityFlag.Crushable, Faction.Reclaim, { crushableBy: 1 }),
  rclTinker: unit('rclTinker', EntityKind.Infantry, U.infantry, 85, ArmorClass.Infantry, 3.5,
    Locomotor.Foot, 20, EntityFlag.Crushable, Faction.Reclaim, { crushableBy: 1 }),
  rclBaron: unit('rclBaron', EntityKind.Infantry, U.infantry, 470, ArmorClass.Infantry, 3.7,
    Locomotor.Foot, 30, GUNNER | EntityFlag.Crushable, Faction.Reclaim, { crushableBy: 1 }),

  rclScrapper: unit('rclScrapper', EntityKind.Vehicle, U.harvester, 850, ArmorClass.Heavy, 5.6,
    Locomotor.Wheel, 20, EntityFlag.IsHarvester | EntityFlag.Crusher, Faction.Reclaim,
    { crushLevel: 5, cargoMax: 600, turnRate: RCL_TURN(U.harvester) }),
  rclSpitter: unit('rclSpitter', EntityKind.Vehicle, U.ifv, 170, ArmorClass.Light, 8.8,
    Locomotor.Wheel, 28, GUNNER, Faction.Reclaim,
    { crushableBy: 4, turnRate: RCL_TURN(U.ifv) }),
  rclGrinder: unit('rclGrinder', EntityKind.Vehicle, U.lightTank, 270, ArmorClass.Medium, 5.8,
    Locomotor.Wheel, 26, GUNNER | EntityFlag.Crusher, Faction.Reclaim,
    { crushLevel: 5, crushableBy: 6, turnRate: RCL_TURN(U.lightTank) }),
  rclSlaghurler: unit('rclSlaghurler', EntityKind.Vehicle, U.prismTank, 230, ArmorClass.Light, 4.6,
    Locomotor.Wheel, 30, GUNNER, Faction.Reclaim,
    { crushableBy: 5, turnRate: RCL_TURN(U.prismTank) }),
  rclCrawler: unit('rclCrawler', EntityKind.Vehicle, U.mcv, 900, ArmorClass.Heavy, 4.6,
    Locomotor.Wheel, 22, 0, Faction.Reclaim,
    { crushableBy: 0, turnRate: RCL_TURN(U.mcv) }),
  // `Locomotor.Air`, in lockstep with `src/data/Defs.ts`. See the Kestrel row.
  rclHornet: unit('rclHornet', EntityKind.Vehicle, U.ifv, 180, ArmorClass.Light, 11.0,
    Locomotor.Air, 34, GUNNER, Faction.Reclaim, { crushableBy: 0, turnRate: 3.4 }),

  rclScow: unit('rclScow', EntityKind.Vehicle, NU.gunboat, 340, ArmorClass.Light, 7.2,
    Locomotor.Hover, 32, GUNNER, Faction.Reclaim, { turnRate: RCL_TURN(NU.gunboat) }),
  rclHulk: unit('rclHulk', EntityKind.Vehicle, NU.destroyer, 820, ArmorClass.Heavy, 4.4,
    Locomotor.Hover, 36, GUNNER, Faction.Reclaim, { turnRate: RCL_TURN(NU.destroyer) }),

  /* -- the completed naval line ---------------------------------------------
   * WITHOUT A ROW HERE THE UNIT DOES NOT EXIST. `ProductionService.spawnUnit`
   * reads `FALLBACK_UNITS` before the def table, so a hull with a flawless def
   * and no row here takes the player's credits, runs its bar to 100%, and never
   * leaves the dock. Silently. Forever. Every field must match the def, which
   * `tests/data.spec.ts` checks column by column.                            */
  hydrofoil: unit('hydrofoil', EntityKind.Vehicle, NU.recon, 180, ArmorClass.Light, 11.0,
    Locomotor.Hover, 44, TURRETED, Faction.Allies),
  picketBoat: unit('picketBoat', EntityKind.Vehicle, NU.recon, 200, ArmorClass.Light, 10.4,
    Locomotor.Hover, 42, TURRETED, Faction.Soviets),
  mrdCutter: unit('mrdCutter', EntityKind.Vehicle, NU.recon, 170, ArmorClass.Light, 11.6,
    Locomotor.Hover, 46, TURRETED, Faction.Meridian),
  rclSkimmer: unit('rclSkimmer', EntityKind.Vehicle, NU.recon, 160, ArmorClass.Light, 11.2,
    Locomotor.Hover, 42, GUNNER, Faction.Reclaim, { turnRate: 3.6 - NU.recon.l * 0.14 }),

  landingCraft: unit('landingCraft', EntityKind.Vehicle, NU.lighter, 460, ArmorClass.Light, 6.6,
    Locomotor.Hover, 24, 0, Faction.Allies),
  assaultBarge: unit('assaultBarge', EntityKind.Vehicle, NU.lighter, 520, ArmorClass.Light, 6.0,
    Locomotor.Hover, 24, 0, Faction.Soviets),
  mrdLighter: unit('mrdLighter', EntityKind.Vehicle, NU.lighter, 440, ArmorClass.Light, 7.0,
    Locomotor.Hover, 26, 0, Faction.Meridian),

  mrdArgosy: unit('mrdArgosy', EntityKind.Vehicle, NU.transport, 740, ArmorClass.Light, 5.6,
    Locomotor.Hover, 28, 0, Faction.Meridian),
  rclHauler: unit('rclHauler', EntityKind.Vehicle, NU.transport, 800, ArmorClass.Heavy, 5.0,
    Locomotor.Hover, 24, 0, Faction.Reclaim, { turnRate: 3.6 - NU.transport.l * 0.14 }),

  /* -- the swimmers --------------------------------------------------------
   * `Locomotor.Foot` here and in the def, deliberately. The amphibious half is
   * a def bit that `Production.spawnUnit` turns into `MoveClass.Hover`; a new
   * locomotor would have no `passGrid` bit and would jam the barracks queue.  */
  frogman: unit('frogman', EntityKind.Infantry, U.infantry, 105, ArmorClass.Infantry, 2.9,
    Locomotor.Foot, 26, GUNNER | EntityFlag.Crushable, Faction.Allies, { crushableBy: 1 }),
  navalInfantry: unit('navalInfantry', EntityKind.Infantry, U.infantry, 115,
    ArmorClass.Infantry, 2.8,
    Locomotor.Foot, 24, GUNNER | EntityFlag.Crushable, Faction.Soviets, { crushableBy: 1 }),
  mrdTidewalker: unit('mrdTidewalker', EntityKind.Infantry, U.infantry, 100,
    ArmorClass.Infantry, 3.0,
    Locomotor.Foot, 28, GUNNER | EntityFlag.Crushable, Faction.Meridian, { crushableBy: 1 }),
  rclDredger: unit('rclDredger', EntityKind.Infantry, U.infantry, 95, ArmorClass.Infantry, 3.0,
    Locomotor.Foot, 24, GUNNER | EntityFlag.Crushable, Faction.Reclaim, { crushableBy: 1 }),
};

export interface FallbackBuilding {
  readonly key: string;
  /** Footprint in CELLS. */
  readonly footprintW: number;
  readonly footprintH: number;
  /** Metres. Only used for the placeholder box and the shadow. */
  readonly height: number;
  readonly maxHp: number;
  readonly armor: ArmorClass;
  /** Positive generates power, negative consumes it. */
  readonly power: number;
  readonly sight: number;
  /** Credits added to the owner's storage cap. */
  readonly storage: number;
  readonly flags: number;
  /** Metres of engagement range for defensive structures; 0 otherwise. */
  readonly weaponRange: number;
  readonly faction: Faction;
}

const STRUCTURE =
  EntityFlag.BlocksNav | EntityFlag.Powered | EntityFlag.Sellable | EntityFlag.ProvidesVision;

function building(
  key: string,
  dim: { w: number; h: number; height: number },
  maxHp: number,
  power: number,
  sight: number,
  flags: number,
  faction: Faction,
  extra?: Partial<FallbackBuilding>,
): FallbackBuilding {
  return {
    key,
    footprintW: dim.w,
    footprintH: dim.h,
    height: dim.height,
    maxHp,
    armor: extra?.armor ?? ArmorClass.Concrete,
    power,
    sight,
    storage: extra?.storage ?? 0,
    // A structure that consumes power goes dark in a brownout; one that makes
    // it obviously must not.
    flags: STRUCTURE | flags | (power < 0 ? EntityFlag.NeedsPower : 0),
    weaponRange: extra?.weaponRange ?? 0,
    faction,
  };
}

/**
 * A NEUTRAL CIVILIAN STRUCTURE, and the two flags that separate it from an
 * army's own.
 *
 * NOT `Sellable`. Everything else in this table carries it through `STRUCTURE`,
 * and for a structure a player PAID for that is right. A captured Oil Derrick
 * is different: `Production.applySell` values a sale at `entry?.cost ?? 0`, and
 * these keys deliberately have no `CONTENT` row, so the sell button would
 * demolish the most valuable thing on the map for a refund of exactly zero. One
 * misclick, no confirmation, no message — the same shape as the last-way-out
 * bug `applySell` already guards against. So the deed changes hands and nothing
 * else; you take a derrick, you do not liquidate it.
 *
 * NO ROLE FLAG. `IsBuilder|IsFactory|IsRefinery|IsRadar` is what
 * `GarrisonService.refusalFor` calls a 'production structure' and refuses, so
 * a civilian block must carry none of them. That is why this composes the
 * flag set explicitly instead of taking an `extra` on `building()`.
 */
function civilian(
  key: string, dim: { w: number; h: number; height: number }, maxHp: number, sight: number,
): FallbackBuilding {
  const b = building(key, dim, maxHp, 0, sight, 0, Faction.Neutral);
  return { ...b, flags: b.flags & ~EntityFlag.Sellable };
}

/** Every structure a scenario may ask for. */
export const FALLBACK_BUILDINGS: Readonly<Record<string, FallbackBuilding>> = {
  conyard: building('conyard', B.conYard, 2000, -20, 30,
    EntityFlag.IsBuilder | EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Neutral),
  powerPlant: building('powerPlant', B.powerPlant, 800, 100, 18, 0, Faction.Neutral),
  refinery: building('refinery', B.refinery, 1200, -30, 22,
    EntityFlag.IsRefinery, Faction.Neutral, { storage: REFINERY_STORAGE }),
  warFactory: building('warFactory', B.warFactory, 1200, -40, 20,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Neutral),
  barracks: building('barracks', B.barracks, 800, -20, 20,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Neutral),
  radar: building('radar', B.radar, 700, -40, 44, EntityFlag.IsRadar, Faction.Neutral),
  battleLab: building('battleLab', B.battleLab, 900, -60, 20, 0, Faction.Neutral),
  oreSilo: building('oreSilo', B.oreSilo, 500, -10, 12, 0, Faction.Neutral,
    { storage: SILO_STORAGE }),
  // Its whole behaviour is positional — `RepairSell.tickDepots` finds it by
  // def id and mends what is parked next to it — so there is no flag to set
  // and nothing here distinguishes it from any other support structure. The
  // row exists because WITHOUT ONE the depot builds, charges, reaches 100%
  // and then never places, with nothing logged: `spawnBuilding` looks this
  // table up before it ever consults the def.
  repairDepot: building('repairDepot', B.repairDepot, 800, -30, 18, 0, Faction.Neutral),
  // The Command Post, the only structure that publishes `BuildTab.Powers`. No
  // flag: it is not a factory in the sense `GarrisonService.refusalFor` means,
  // it produces no entity, and it must go dark FIRST in a brownout — which
  // `shedPriority` already gives an unflagged consumer. The tab it opens is
  // gated on `EntityFlag.Powered`, so going dark closes it, which is the whole
  // "standing and powered" rule stated once in the power grid.
  commandPost: building('commandPost', B.commandPost, 750, -80, 22, 0, Faction.Neutral),

  pillbox: building('pillbox', B.pillbox, 500, 0, 26,
    EntityFlag.CanAttack, Faction.Allies, { weaponRange: 22 }),
  prismTower: building('prismTower', B.prismTower, 600, -50, 30,
    EntityFlag.CanAttack | EntityFlag.HasTurret, Faction.Allies, { weaponRange: 34 }),
  teslaCoil: building('teslaCoil', B.teslaCoil, 700, -75, 30,
    EntityFlag.CanAttack, Faction.Soviets, { weaponRange: 30 }),
  // `weaponRange` draws the coverage ring under the cursor while you hold the
  // structure, and it is the ONLY consumer of that field — so a number that
  // disagrees with the armoury is a lie told at the exact moment the player
  // decides where to put the thing. 16 against `flameJet`'s 18.
  flameTower: building('flameTower', B.flameTower, 550, -20, 22,
    EntityFlag.CanAttack, Faction.Soviets, { weaponRange: 18 }),
  wall: building('wall', B.wall, 300, 0, 0,
    EntityFlag.NotSelectable, Faction.Neutral, { armor: ArmorClass.Concrete }),
  // Selectable, unlike the wall it sits in — you need to be able to click a
  // gate to sell it, and a wall run you cannot reopen is worse than no wall.
  gate: building('gate', B.gate, 400, 0, 0,
    0, Faction.Neutral, { armor: ArmorClass.Concrete }),

  navalYard: building('navalYard', NB.navalYard, 1000, -30, 24,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Allies),
  subPen: building('subPen', NB.subPen, 1000, -30, 24,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Soviets),

  // The two finished models that had no def row: the Allied AA mount and the
  // Soviet sentry gun. Adding them also makes the two armies' defence sets
  // symmetric (each now fields a cheap gun, a heavy gun and a power-hungry one).
  aaTurret: building('aaTurret', B.prismTower, 550, -30, 28,
    EntityFlag.CanAttack | EntityFlag.HasTurret, Faction.Allies, { weaponRange: 28 }),
  sentryGun: building('sentryGun', B.pillbox, 480, 0, 24,
    EntityFlag.CanAttack, Faction.Soviets, { weaponRange: 20 }),

  /* -- THE MERIDIAN PACT --------------------------------------------------
   * Transcribed from `src/data/Defs.ts` §2. The Solar Array is the faction:
   * 350 credits for 160 power on 420 hp, against 300/100/800 for a Power
   * Plant. Cheapest power in the game on the softest structure — and BOTH PACT
   * DEFENCES DRAW POWER, so a power raid silences the belt while the economy
   * keeps running. That is the faction's risk profile in one line.
   *
   * This said "both Pact defences plus its siege HULL carry `needsPower`
   * weapons", which was wrong twice over. `Combat.engage` requires
   * `EntityFlag.NeedsPower` on the ENTITY and only structures ever get it, so
   * a hull could never have been gated whatever its weapon row said — and
   * `zenithBeam`'s flag had already been deleted for exactly that reason. The
   * surviving claim is also no longer about the weapon: since the blackout
   * work the gate is primarily the def's negative `power`, not
   * `WeaponDef.needsPower`, so what puts a Pact defence on the grid is that it
   * draws from it.
   * --------------------------------------------------------------------- */
  mrdConclave: building('mrdConclave', B.conYard, 1900, -20, 30,
    EntityFlag.IsBuilder | EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Meridian),
  mrdSolarArray: building('mrdSolarArray', B.powerPlant, 420, 160, 18, 0, Faction.Meridian),
  mrdCistern: building('mrdCistern', B.refinery, 1150, -30, 22,
    EntityFlag.IsRefinery, Faction.Meridian, { storage: REFINERY_STORAGE }),
  mrdChapterhouse: building('mrdChapterhouse', B.barracks, 750, -20, 20,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Meridian),
  mrdForgeyard: building('mrdForgeyard', B.warFactory, 1150, -40, 20,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Meridian),
  mrdOculus: building('mrdOculus', B.radar, 650, -40, 46, EntityFlag.IsRadar, Faction.Meridian),
  mrdVault: building('mrdVault', B.oreSilo, 450, -10, 12, 0, Faction.Meridian,
    { storage: SILO_STORAGE }),
  mrdSlipway: building('mrdSlipway', NB.navalYard, 950, -30, 24,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Meridian),
  mrdReliquary: building('mrdReliquary', B.battleLab, 850, -60, 20, 0, Faction.Meridian),
  mrdDepot: building('mrdDepot', B.repairDepot, 700, -30, 18, 0, Faction.Meridian),
  mrdPharos: building('mrdPharos', B.commandPost, 700, -80, 22, 0, Faction.Meridian),

  mrdRampart: building('mrdRampart', B.wall, 320, 0, 0,
    EntityFlag.NotSelectable, Faction.Meridian),
  mrdGlaive: building('mrdGlaive', B.pillbox, 480, -10, 26,
    EntityFlag.CanAttack, Faction.Meridian, { weaponRange: 24 }),
  mrdHelios: building('mrdHelios', B.prismTower, 600, -55, 32,
    EntityFlag.CanAttack | EntityFlag.HasTurret, Faction.Meridian, { weaponRange: 33 }),

  /* -- THE RECLAMATION ----------------------------------------------------
   * Transcribed from `src/data/Defs.ts` §2. The Scrap Furnace is the faction:
   * 240 credits for 80 power on 950 hp, against 300/100/800 for a Power Plant
   * and 350/160/420 for a Solar Array. Cheapest and toughest plant in the game,
   * and the weakest — a Reclamation base is five furnaces wide, and the Arc
   * Pylon's 90-power draw is what puts it into brownout.
   * --------------------------------------------------------------------- */
  rclFoundry: building('rclFoundry', B.conYard, 2100, -20, 30,
    EntityFlag.IsBuilder | EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Reclaim),
  rclFurnace: building('rclFurnace', B.powerPlant, 950, 80, 18, 0, Faction.Reclaim),
  rclSorter: building('rclSorter', B.refinery, 1250, -30, 22,
    EntityFlag.IsRefinery, Faction.Reclaim, { storage: REFINERY_STORAGE }),
  rclRookery: building('rclRookery', B.barracks, 850, -20, 20,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Reclaim),
  rclBreakerYard: building('rclBreakerYard', B.warFactory, 1250, -40, 20,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Reclaim),
  rclSpotter: building('rclSpotter', B.radar, 700, -40, 42, EntityFlag.IsRadar, Faction.Reclaim),
  rclHeap: building('rclHeap', B.oreSilo, 550, -10, 12, 0, Faction.Reclaim,
    { storage: SILO_STORAGE }),
  rclDrydock: building('rclDrydock', NB.navalYard, 1050, -30, 24,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Reclaim),
  rclCrucible: building('rclCrucible', B.battleLab, 900, -60, 20, 0, Faction.Reclaim),
  rclDepot: building('rclDepot', B.repairDepot, 900, -30, 18, 0, Faction.Reclaim),
  rclSignalRig: building('rclSignalRig', B.commandPost, 800, -80, 22, 0, Faction.Reclaim),

  rclBarricade: building('rclBarricade', B.wall, 340, 0, 0,
    EntityFlag.NotSelectable, Faction.Reclaim),
  rclSpitpost: building('rclSpitpost', B.pillbox, 520, 0, 24,
    EntityFlag.CanAttack, Faction.Reclaim, { weaponRange: 20 }),
  // No HasTurret, deliberately: the Arc Pylon is a fixed coil, like every other
  // gun the Reclamation owns.
  rclPylon: building('rclPylon', B.prismTower, 560, -90, 30,
    EntityFlag.CanAttack, Faction.Reclaim, { weaponRange: 28 }),

  /* -- the six superweapon structures -------------------------------------
   * Their whole behaviour is `src/sim/Superweapons.ts`, which finds them by
   * CONTENT KEY and charges a timer — so there is no flag to set and nothing
   * here distinguishes one from any other support structure. The rows exist
   * for the reason the Repair Depot's does, stated above it: WITHOUT ONE the
   * structure builds, charges, reaches 100% and then never places, with
   * nothing logged. `ProductionCatalog` drops the whole entry earlier still —
   * `resolveEntry` warns and returns null — so the sidebar would not even
   * offer it.
   *
   * -150 power is deliberate and it is the balance of the building: the
   * service refuses to charge a structure whose `Powered` bit is clear, so a
   * base that cannot carry the draw owns a very expensive dark shed. */
  nuclearSilo: building('nuclearSilo', B.superweapon, 1000, -150, 20, 0, Faction.Soviets),
  ironCurtain: building('ironCurtain', B.superweapon, 950, -150, 20, 0, Faction.Soviets),
  chronosphere: building('chronosphere', B.superweapon, 950, -150, 20, 0, Faction.Allies),
  weatherControl: building('weatherControl', B.superweapon, 1000, -150, 20, 0, Faction.Allies),
  mrdHeliograph: building('mrdHeliograph', B.superweapon, 900, -150, 20, 0, Faction.Meridian),
  rclStormworks: building('rclStormworks', B.superweapon, 1050, -150, 20, 0, Faction.Reclaim),
  /* -- THE CIVILIAN BLOCK --------------------------------------------------
   * Transcribed from `src/data/Defs.ts` §2, with the dimensions taken from the
   * SAME constant the def rows read (`src/data/Civilians.ts`) rather than
   * re-typed — `tests/data.spec.ts` checks the numbers agree and this is the
   * spelling that cannot make it fail.
   * --------------------------------------------------------------------- */
  civOilDerrick: civilian('civOilDerrick', CIV.civOilDerrick, 900, 14),
  civHospital: civilian('civHospital', CIV.civHospital, 1100, 20),
  civApartments: civilian('civApartments', CIV.civApartments, 800, 16),
  civOreMine: civilian('civOreMine', CIV.civOreMine, 700, 12),
};

export interface FallbackProp {
  readonly key: string;
  /** Wreck is in here rather than in its own table: a hulk is scenery. */
  readonly kind: EntityKind.Prop | EntityKind.Crate | EntityKind.Wreck;
  /** Collision radius, metres. */
  readonly radius: number;
  readonly height: number;
  readonly maxHp: number;
  readonly flags: number;
}

const PROP_BASE = EntityFlag.NotATarget | EntityFlag.NotSelectable;

/**
 * Props live in their own `defId` namespace, starting well past anything a
 * `DefTables` will ever hold.
 *
 * `RenderBridge` resolves art by `(kind, faction, defId)` and there is no other
 * per-entity model selector — `store.modelId` exists but nothing reads it. With
 * `defId = -1` on every prop the bridge had exactly one entry per EntityKind to
 * choose from, so a tree, a boulder and a barrel all drew the same hazard-
 * striped placeholder box. Numbering them is what lets `src/world/
 * entity-props.system.ts` register one mesh each.
 *
 * The 1000 offset is not cosmetic. Several modules read `store.defId` and
 * interpret it as an index into `DefTables.units` — `input/Commands.ts`'s
 * `defOf()` guards only against Buildings, and `sim/Production.ts#entryOf()`
 * asks its catalog for `(defId, isBuilding=false)`. A prop numbered 3 would
 * come back as "a Warden". Out here every such lookup misses cleanly and the
 * caller falls through to the heuristic it already has.
 */
export const PROP_DEF_BASE = 1000;

/** Scatter dressing. Small, cheap, never owned, mostly crushable. */
export const FALLBACK_PROPS: Readonly<Record<string, FallbackProp>> = {
  tree: { key: 'tree', kind: EntityKind.Prop, radius: 1.6, height: 7.0, maxHp: 120, flags: PROP_BASE | EntityFlag.Crushable },
  pine: { key: 'pine', kind: EntityKind.Prop, radius: 1.3, height: 9.5, maxHp: 120, flags: PROP_BASE | EntityFlag.Crushable },
  bush: { key: 'bush', kind: EntityKind.Prop, radius: 0.9, height: 1.2, maxHp: 40, flags: PROP_BASE | EntityFlag.Crushable },
  /* ROCK AND BOULDER CARRY NO `BlocksNav`, AND NO `Crushable` EITHER.
   *
   * They were the only two entries in this table that blocked, against a
   * docstring that says "mostly crushable". Reported as: "our logic is screwed
   * up, and they blocking in a weird ways, make them same as any other prop".
   *
   * The mechanism deserved the complaint. A `BlocksNav` prop was solid ONLY in
   * `Movement.relax` — a physical push, deliberately outside the nav grid —
   * and the argument for that split, written at the relax site, was that "the
   * flow field still routes straight over the cell and the hull simply slides
   * around a 3 m disc that is smaller than the 4 m cell it sits in, so no route
   * can ever become unreachable". `config.ts` had ALREADY measured that claim
   * false: a 2 m rock at 182,298 that the planner cannot see sealed a one-cell
   * corridor against a 3.87 m hull, and seed 4242 slot 43 sat parked for 2100
   * consecutive ticks. A whole tier of harvester watchdogs exists to paper over
   * exactly that. Two claims in one tree, one of them measured — the measured
   * one wins, and the flag goes.
   *
   * NOT `Crushable`, which is the other half of "same as any other prop" and is
   * the wrong half. Entity props and scatter props are drawn from the SAME
   * geometry by design, and `Scatter.CRUSHABLE_FAMILIES` is `canopy` and
   * `shrub` — rock is excluded there by name. Making the ENTITY crushable would
   * put two identical boulders ten metres apart, one of which dissolves under a
   * tank; making the FAMILY crushable would mow the ~7000-prop instanced rock
   * carpet permanently. `spawnProp` also writes no `crushableBy`, so a boulder
   * would fall through to `CRUSH.propDefaultLevel` = 1 and die under the
   * lightest crusher in the game. And the Meridian Pact carries `crushLevel: 0`
   * on every hull by doctrine, so crushable rocks would hand exactly one army
   * no way to clear one.
   *
   * They still take damage and can be shot away. They still push hulls aside
   * softly — `Steering`'s separation term skips a non-mover only when it has a
   * footprint, and a prop's is 0 — so a hull does not park inside a boulder;
   * it simply is no longer HELD OUT of one by a hard constraint the pathfinder
   * never knew about. */
  rock: { key: 'rock', kind: EntityKind.Prop, radius: 2.0, height: 2.6, maxHp: 400, flags: PROP_BASE },
  boulder: { key: 'boulder', kind: EntityKind.Prop, radius: 3.2, height: 4.4, maxHp: 800, flags: PROP_BASE },
  barrel: { key: 'barrel', kind: EntityKind.Prop, radius: 0.6, height: 1.1, maxHp: 30, flags: PROP_BASE | EntityFlag.Crushable },
  crate: { key: 'crate', kind: EntityKind.Crate, radius: 1.0, height: 1.0, maxHp: 20, flags: PROP_BASE },
  wreck: { key: 'wreck', kind: EntityKind.Wreck, radius: 2.4, height: 1.8, maxHp: 1, flags: PROP_BASE },
};

/**
 * Content key -> the `defId` a scenario-spawned prop carries. Stable, derived
 * from `FALLBACK_PROPS`' declaration order, and the key an art module must
 * register against. Read it, never recompute it.
 */
export const PROP_DEF_ID: Readonly<Record<string, number>> = (() => {
  const out: Record<string, number> = {};
  const keys = Object.keys(FALLBACK_PROPS);
  for (let i = 0; i < keys.length; i++) out[keys[i]] = PROP_DEF_BASE + i;
  return out;
})();

/* ==========================================================================
 * 3. REAL DEF TABLE DISCOVERY
 *
 * Same trick `src/game/Systems.ts` uses for module discovery: a lazy glob, so
 * this file compiles and runs whether or not `src/data/**` exists yet. The glob
 * is LAZY, not eager — a data module that throws at import must degrade to
 * "no def table", not to a boot failure.
 * ========================================================================== */

const dataModules = import.meta.glob<Record<string, unknown>>('../data/**/*.ts');

/** Normalise a content key so 'War Factory', 'war_factory' and 'warFactory' match. */
function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Acceptable def-table keys per content key, best first. Written wide on
 * purpose: the data agent has not published its vocabulary yet, and a scenario
 * that silently spawns a placeholder because a key was spelled `oreMiner`
 * instead of `harvester` is exactly the kind of failure nobody notices.
 */
const UNIT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  gi: ['gi', 'alliedinfantry', 'rifleman', 'peacekeeper', 'guardiangi', 'soldier'],
  engineer: ['engineer', 'alliedengineer', 'sovietengineer'],
  conscript: ['conscript', 'sovietinfantry', 'redguard'],
  attackDog: ['attackdog', 'dog', 'warbear', 'guarddog'],
  // No bare 'flak' here on purpose: that is the Soviet AA STRUCTURE's key, and
  // one string resolving to both a building and an infantryman is the kind of
  // ambiguity a scenario author discovers at runtime.
  javelin: ['javelin', 'alliedrocket', 'rocketsoldier', 'alliedlancer'],
  flakTrooper: ['flaktrooper', 'flakinfantry', 'sovietflak', 'sovietlancer'],
  fieldMarshal: ['fieldmarshal', 'marshal', 'alliedcommander'],
  commissar: ['commissar', 'warcommissar', 'sovietcommander'],
  grizzly: ['grizzly', 'grizzlytank', 'lighttank', 'mediumtank', 'guardiantank'],
  ifv: ['ifv', 'multigunner', 'apc', 'riptide'],
  prismTank: ['prismtank', 'prism', 'athena', 'athenacannon'],
  rhino: ['rhino', 'rhinotank', 'heavytank', 'hammertank'],
  apocalypse: ['apocalypse', 'apoc', 'apocalypsetank'],
  v4: ['v4', 'v4launcher', 'sovietv4', 'rocketartillery'],
  harvester: ['harvester', 'oreharvester', 'oreminer', 'chronominer', 'miner'],
  mcv: ['mcv', 'mobileconstructionvehicle', 'constructionvehicle'],
  gunboat: ['gunboat', 'assaultdestroyer', 'patrolboat'],
  destroyer: ['destroyer', 'alliedcruiser', 'cruiser'],
  submarine: ['submarine', 'sub', 'akula', 'typhoon'],
  dreadnought: ['dreadnought', 'sovietcruiser', 'battleship'],
  transport: ['transport', 'hovertransport', 'heavytransport'],
  hydrofoil: ['hydrofoil', 'alliedhydrofoil', 'fastboat'],
  picketBoat: ['picketboat', 'sovietpicket', 'picket'],
  mrdCutter: ['mrdcutter', 'suncutter', 'meridiancutter'],
  rclSkimmer: ['rclskimmer', 'scrapskimmer', 'skimmer'],
  landingCraft: ['landingcraft', 'alliedlighter', 'lighter'],
  assaultBarge: ['assaultbarge', 'sovietlighter', 'barge'],
  mrdLighter: ['mrdlighter', 'sunlighter', 'meridianlighter'],
  mrdArgosy: ['mrdargosy', 'argosy', 'meridianargosy'],
  rclHauler: ['rclhauler', 'slaghauler', 'hauler'],
  frogman: ['frogman', 'alliedfrogman', 'diver'],
  navalInfantry: ['navalinfantry', 'sovietdiver', 'marine'],
  mrdTidewalker: ['mrdtidewalker', 'tidewalker', 'meridiantidewalker'],
  rclDredger: ['rcldredger', 'dredger', 'reclaimdredger'],
  // The air arms. WITHOUT A ROW HERE THE DEF DOES NOT EXIST as far as any
  // consumer is concerned: `resolveDefBinding` returns `bindAliases(unitByKey,
  // UNIT_ALIASES)`, which iterates the keys of THIS table — so an unlisted def
  // resolves to `undefined`, `resolveEntry` falls back to defId -1, and
  // `units.system.ts` skips the model registration. The unit would still build
  // and still fly; it would just wear the per-faction default hull, which is a
  // Warden. No bare 'mig' -> anything else: the key IS 'mig'.
  vindicator: ['vindicator', 'alliedvindicator', 'alliedbomber', 'harrier'],
  mig: ['mig', 'sovietmig', 'migfighter', 'sovietfighter'],

  // The Meridian Pact. Its def keys are already unambiguous, so each row is
  // the key itself plus the model name the art modules use.
  mrdWayfarer: ['mrdwayfarer', 'wayfarer', 'meridianwayfarer'],
  mrdLancer: ['mrdlancer', 'sunlancer', 'meridianlancer'],
  mrdArtificer: ['mrdartificer', 'artificer', 'meridianartificer'],
  mrdHierarch: ['mrdhierarch', 'hierarch', 'meridianhierarch'],
  mrdCollector: ['mrdcollector', 'suncollector', 'meridiancollector'],
  mrdSkiff: ['mrdskiff', 'sandskiff', 'meridianskiff'],
  mrdSolarch: ['mrdsolarch', 'solarch', 'meridiansolarch'],
  mrdZenith: ['mrdzenith', 'zenithemitter', 'meridianzenith'],
  mrdCarryall: ['mrdcarryall', 'pactworkscarryall', 'meridiancarryall'],
  mrdKestrel: ['mrdkestrel', 'kestrelgunship', 'meridiankestrel'],
  mrdCorvette: ['mrdcorvette', 'kitecorvette', 'meridiancorvette'],
  mrdMonitor: ['mrdmonitor', 'sunmonitor', 'meridianmonitor'],

  // The Reclamation. Same shape as the Pact's rows: the def key, the display
  // name, and the model key `src/art/Faction4Units.ts` registers under.
  rclPicker: ['rclpicker', 'scrappicker', 'reclaimpicker'],
  rclSlagger: ['rclslagger', 'slagger', 'reclaimslagger'],
  rclTinker: ['rcltinker', 'tinker', 'reclaimtinker'],
  rclBaron: ['rclbaron', 'scrapbaron', 'reclaimbaron'],
  rclScrapper: ['rclscrapper', 'scrapjaw', 'reclaimscrapper'],
  rclSpitter: ['rclspitter', 'arcspitter', 'reclaimspitter'],
  rclGrinder: ['rclgrinder', 'grinder', 'reclaimgrinder'],
  rclSlaghurler: ['rclslaghurler', 'slaghurler', 'reclaimslaghurler'],
  rclCrawler: ['rclcrawler', 'yardcrawler', 'reclaimcrawler'],
  rclHornet: ['rclhornet', 'swarmhornet', 'reclaimhornet'],
  rclScow: ['rclscow', 'slagscow', 'reclaimscow'],
  rclHulk: ['rclhulk', 'reclaimedhulk', 'reclaimhulk'],
};

const BUILDING_ALIASES: Readonly<Record<string, readonly string[]>> = {
  conyard: ['conyard', 'constructionyard', 'conyardallied', 'commandcenter', 'hq'],
  powerPlant: ['powerplant', 'power', 'reactor', 'teslareactor'],
  refinery: ['refinery', 'orerefinery', 'processor'],
  warFactory: ['warfactory', 'factory', 'vehiclefactory', 'weaponsfactory'],
  barracks: ['barracks', 'infantrybarracks', 'boot camp', 'bootcamp'],
  radar: ['radar', 'radardome', 'airfield'],
  battleLab: ['battlelab', 'techcenter', 'lab', 'researchlab'],
  commandPost: ['commandpost', 'command', 'post', 'powerspost'],
  oreSilo: ['oresilo', 'silo', 'storage'],
  pillbox: ['pillbox', 'bunker', 'machinegunnest'],
  prismTower: ['prismtower', 'prism', 'spectrumtower'],
  teslaCoil: ['teslacoil', 'tesla', 'teslatower'],
  flameTower: ['flametower', 'flameturret', 'firetower'],
  wall: ['wall', 'concretewall', 'sandbag'],
  gate: ['gate', 'wallgate', 'barrier'],
  navalYard: ['navalyard', 'shipyard', 'seaport', 'dock'],
  subPen: ['subpen', 'submarinepen', 'navalyardsoviet'],
  aaTurret: ['aaturret', 'multigunneraa', 'aagun', 'flakcannon'],
  sentryGun: ['sentrygun', 'sentry', 'machinegunturret'],
  repairDepot: ['repairdepot', 'servicedepot', 'depot', 'repairbay', 'maintenance'],

  mrdConclave: ['mrdconclave', 'conclave', 'meridianconclave'],
  mrdSolarArray: ['mrdsolararray', 'solararray', 'meridiansolararray'],
  mrdCistern: ['mrdcistern', 'orecistern', 'meridiancistern'],
  mrdChapterhouse: ['mrdchapterhouse', 'chapterhouse', 'meridianchapterhouse'],
  mrdForgeyard: ['mrdforgeyard', 'forgeyard', 'meridianforgeyard'],
  mrdOculus: ['mrdoculus', 'oculus', 'meridianoculus'],
  mrdVault: ['mrdvault', 'sunvault', 'meridianvault'],
  mrdSlipway: ['mrdslipway', 'slipway', 'meridianslipway'],
  mrdReliquary: ['mrdreliquary', 'reliquary', 'meridianreliquary'],
  mrdPharos: ['mrdpharos', 'pharos', 'meridianpharos'],
  mrdRampart: ['mrdrampart', 'rampart', 'meridianrampart'],
  mrdGlaive: ['mrdglaive', 'glaivepost', 'meridianglaive'],
  mrdHelios: ['mrdhelios', 'heliosspire', 'meridianhelios'],
  mrdDepot: ['mrddepot', 'solarinfirmary', 'infirmary', 'meridiandepot'],

  rclFoundry: ['rclfoundry', 'foundry', 'reclaimfoundry'],
  rclFurnace: ['rclfurnace', 'scrapfurnace', 'reclaimfurnace'],
  rclSorter: ['rclsorter', 'oresorter', 'reclaimsorter'],
  rclRookery: ['rclrookery', 'rookery', 'reclaimrookery'],
  rclBreakerYard: ['rclbreakeryard', 'breakeryard', 'reclaimbreakeryard'],
  rclSpotter: ['rclspotter', 'spottermast', 'reclaimspotter'],
  rclHeap: ['rclheap', 'slagheap', 'reclaimheap'],
  rclDrydock: ['rcldrydock', 'breakerdock', 'reclaimdrydock'],
  rclCrucible: ['rclcrucible', 'crucible', 'reclaimcrucible'],
  rclSignalRig: ['rclsignalrig', 'signalrig', 'reclaimsignalrig'],
  rclBarricade: ['rclbarricade', 'scrapbarricade', 'reclaimbarricade'],
  rclSpitpost: ['rclspitpost', 'spitpost', 'reclaimspitpost'],
  rclPylon: ['rclpylon', 'arcpylon', 'reclaimpylon'],
  rclDepot: ['rcldepot', 'patchyard', 'reclaimdepot'],

  nuclearSilo: ['nuclearsilo', 'missilesilo', 'nuke', 'sovietsuperweapon'],
  ironCurtain: ['ironcurtain', 'ironcurtaindevice', 'curtain'],
  chronosphere: ['chronosphere', 'chrono', 'alliedsuperweapon'],
  weatherControl: ['weathercontrol', 'weathercontroldevice', 'lightningstorm'],
  mrdHeliograph: ['mrdheliograph', 'heliograph', 'meridianheliograph'],
  rclStormworks: ['rclstormworks', 'stormworks', 'reclaimstormworks'],
  // The neutral map furniture. `tests/data.spec.ts` fails on any
  // FALLBACK_BUILDINGS key that does not bind to a def through this table, so
  // these three rows are what turn the def rows into spawnable content.
  civOilDerrick: ['civoilderrick', 'oilderrick', 'derrick'],
  civHospital: ['civhospital', 'hospital', 'civilianhospital'],
  civApartments: ['civapartments', 'apartments', 'apartmentblock', 'civilianblock'],
  // 'coalmine' and 'moneymine' are in here because the request that produced
  // this structure named all three ("coal / ore / money mines") and a layout
  // author reaching for any of those words should get the one structure rather
  // than a `[scenario] unknown building key` warning and a gap in the map.
  civOreMine: ['civoremine', 'oremine', 'mine', 'coalmine', 'moneymine'],
};

/**
 * ONE ROLE, THREE ARMIES.
 *
 * Indexed `[genericKey][Faction]`. Slot 0 (Neutral) is the key a scenery /
 * Gaia owner gets, which is always the shared row where one exists.
 *
 * This exists so a base LAYOUT can be authored once as pure geometry. Every
 * key that appears in `src/game/scenarios/**` has a row; anything else passes
 * through `ScenarioBuilder.keyFor` unchanged, so props, wrecks and crates are
 * untouched.
 *
 * The Meridian column is not a cosmetic relabel — the Pact's tree really is
 * one-to-one with the shared one (Conclave for Construction Yard, Solar Array
 * for Power Plant, Cistern for Refinery), which is why the faction can be
 * dropped into a shared layout at all. The Reclamation column is the same
 * one-to-one mapping; the faction differs in what its buildings COST and what
 * they gate, not in which roles exist.
 *
 * EVERY ROW MUST BE `FACTION_COUNT` LONG. `keyFor` reads `row[player.faction]`
 * and falls back to the unmapped key on a miss, so a short row does not throw —
 * it quietly gives a Reclamation player an Allied Warden, which the fallback
 * table then refuses on its faction check and nothing spawns at all.
 */
const FACTION_KEY_MAP: Readonly<Record<string, readonly string[]>> = {
  //                [ neutral,      allies,       soviets,      meridian,           reclaim             ]
  /* structures */
  conyard:          ['conyard',     'conyard',    'conyard',    'mrdConclave',      'rclFoundry'],
  powerPlant:       ['powerPlant',  'powerPlant', 'powerPlant', 'mrdSolarArray',    'rclFurnace'],
  refinery:         ['refinery',    'refinery',   'refinery',   'mrdCistern',       'rclSorter'],
  barracks:         ['barracks',    'barracks',   'barracks',   'mrdChapterhouse',  'rclRookery'],
  warFactory:       ['warFactory',  'warFactory', 'warFactory', 'mrdForgeyard',     'rclBreakerYard'],
  radar:            ['radar',       'radar',      'radar',      'mrdOculus',        'rclSpotter'],
  battleLab:        ['battleLab',   'battleLab',  'battleLab',  'mrdReliquary',     'rclCrucible'],
  commandPost:      ['commandPost', 'commandPost','commandPost','mrdPharos',        'rclSignalRig'],
  oreSilo:          ['oreSilo',     'oreSilo',    'oreSilo',    'mrdVault',         'rclHeap'],
  // The pad. Allies and Soviets share one def (Faction.Neutral), so the first
  // three columns are the same key and only the two new armies branch.
  repairDepot:      ['repairDepot', 'repairDepot','repairDepot','mrdDepot',         'rclDepot'],
  wall:             ['wall',        'wall',       'wall',       'mrdRampart',       'rclBarricade'],
  navalYard:        ['navalYard',   'navalYard',  'subPen',     'mrdSlipway',       'rclDrydock'],
  subPen:           ['subPen',      'navalYard',  'subPen',     'mrdSlipway',       'rclDrydock'],
  /* defences — cheap gun, heavy gun, and the one that dies in a brownout */
  pillbox:          ['pillbox',     'pillbox',    'sentryGun',  'mrdGlaive',        'rclSpitpost'],
  sentryGun:        ['sentryGun',   'pillbox',    'sentryGun',  'mrdGlaive',        'rclSpitpost'],
  flameTower:       ['flameTower',  'pillbox',    'flameTower', 'mrdGlaive',        'rclSpitpost'],
  prismTower:       ['prismTower',  'prismTower', 'teslaCoil',  'mrdHelios',        'rclPylon'],
  teslaCoil:        ['teslaCoil',   'prismTower', 'teslaCoil',  'mrdHelios',        'rclPylon'],
  aaTurret:         ['aaTurret',    'aaTurret',   'sentryGun',  'mrdGlaive',        'rclSpitpost'],
  /* infantry */
  gi:               ['gi',          'gi',         'conscript',  'mrdWayfarer',      'rclPicker'],
  conscript:        ['conscript',   'gi',         'conscript',  'mrdWayfarer',      'rclPicker'],
  engineer:         ['engineer',    'engineer',   'engineer',   'mrdArtificer',     'rclTinker'],
  attackDog:        ['attackDog',   'gi',         'attackDog',  'mrdWayfarer',      'rclPicker'],
  // The anti-armour foot slot, which all four armies now fill. The Reclamation
  // column is `rclPicker` and not a dedicated row because its BASIC rifleman
  // already carries a Tesla arc (0.90 vs Heavy) — that army never had the hole.
  javelin:          ['javelin',     'javelin',    'flakTrooper','mrdLancer',        'rclPicker'],
  flakTrooper:      ['flakTrooper', 'javelin',    'flakTrooper','mrdLancer',        'rclPicker'],
  // The hero row. A scenario that asks for 'commander' gets the asking army's
  // own — there is no neutral commander, so the neutral column is the Allied
  // one rather than a key that would resolve to nothing.
  commander:        ['fieldMarshal','fieldMarshal','commissar', 'mrdHierarch',      'rclBaron'],
  /* vehicles */
  harvester:        ['harvester',   'harvester',  'harvester',  'mrdCollector',     'rclScrapper'],
  mcv:              ['mcv',         'mcv',        'mcv',        'mrdCarryall',      'rclCrawler'],
  grizzly:          ['grizzly',     'grizzly',    'rhino',      'mrdSolarch',       'rclGrinder'],
  rhino:            ['rhino',       'grizzly',    'rhino',      'mrdSolarch',       'rclGrinder'],
  ifv:              ['ifv',         'ifv',        'attackDog',  'mrdSkiff',         'rclSpitter'],
  prismTank:        ['prismTank',   'prismTank',  'apocalypse', 'mrdZenith',        'rclSlaghurler'],
  apocalypse:       ['apocalypse',  'prismTank',  'apocalypse', 'mrdZenith',        'rclSlaghurler'],
  /* naval */
  gunboat:          ['gunboat',     'gunboat',    'submarine',  'mrdCorvette',      'rclScow'],
  submarine:        ['submarine',   'gunboat',    'submarine',  'mrdCorvette',      'rclScow'],
  destroyer:        ['destroyer',   'destroyer',  'dreadnought', 'mrdMonitor',      'rclHulk'],
  dreadnought:      ['dreadnought', 'destroyer',  'dreadnought', 'mrdMonitor',      'rclHulk'],
  /* WAS `mrdCarryall` / `rclCrawler` FOR THE LAST TWO COLUMNS, AND BOTH ARE MCVs.
   * They carry `U.mcv` and `deploysInto`, and they are already the entire `mcv`
   * row above — so any scenario placing a `transport` key handed the Pact and
   * the Reclamation a CONSTRUCTION VEHICLE instead of a landing ship. The
   * shared `transport` is "Eight slots of anything, over open water"
   * (`cargoSlots: 8`), and the eight-slot equivalents are `mrdArgosy` and
   * `rclHauler` — which the `heavyLift` row four lines down already names
   * correctly, against the same two columns. The four-slot tier is
   * `mrdLighter` / `rclScow`, and it is the `landingCraft` row. */
  transport:        ['transport',   'transport',  'transport',  'mrdArgosy',        'rclHauler'],
  /* the completed naval line: recon, the four-slot landing ship, the eight-slot
   * heavy, and the swimmer who needs none of them. `transport` is shared by the
   * Allied yard and the Soviet pen, so both columns name it. */
  hydrofoil:        ['hydrofoil',   'hydrofoil',  'picketBoat', 'mrdCutter',        'rclSkimmer'],
  picketBoat:       ['picketBoat',  'hydrofoil',  'picketBoat', 'mrdCutter',        'rclSkimmer'],
  landingCraft:     ['landingCraft', 'landingCraft', 'assaultBarge', 'mrdLighter',  'rclScow'],
  assaultBarge:     ['assaultBarge', 'landingCraft', 'assaultBarge', 'mrdLighter',  'rclScow'],
  heavyLift:        ['transport',   'transport',  'transport',  'mrdArgosy',        'rclHauler'],
  frogman:          ['frogman',     'frogman',    'navalInfantry', 'mrdTidewalker', 'rclDredger'],
  navalInfantry:    ['navalInfantry', 'frogman',  'navalInfantry', 'mrdTidewalker', 'rclDredger'],
};

/** Resolved def indices for the content vocabulary. -1 means "no real def". */
export interface DefBinding {
  readonly tables: DefTables | null;
  readonly unitId: Readonly<Record<string, number>>;
  readonly buildingId: Readonly<Record<string, number>>;
}

const EMPTY_BINDING: DefBinding = { tables: null, unitId: {}, buildingId: {} };

function looksLikeDefTables(v: unknown): v is DefTables {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Partial<DefTables>;
  return (
    Array.isArray(t.units) &&
    Array.isArray(t.buildings) &&
    t.unitByKey instanceof Map &&
    t.buildingByKey instanceof Map
  );
}

function bindAliases(
  byKey: ReadonlyMap<string, number>,
  aliases: Readonly<Record<string, readonly string[]>>,
): Record<string, number> {
  // One normalised index, then one pass per content key: O(defs + keys), and it
  // makes 'War Factory' match 'warFactory' without the data agent knowing.
  const normalised = new Map<string, number>();
  for (const [k, v] of byKey) normalised.set(normKey(k), v);

  const out: Record<string, number> = {};
  for (const key of Object.keys(aliases)) {
    let found = -1;
    for (const alias of aliases[key]) {
      const hit = normalised.get(normKey(alias));
      if (hit !== undefined) { found = hit; break; }
    }
    out[key] = found;
  }
  return out;
}

/**
 * Find a `DefTables` anywhere under `src/data/**`, or return the empty binding.
 * Never throws: a data module that explodes at import is reported and skipped.
 */
export async function resolveDefBinding(): Promise<DefBinding> {
  // Memoised. Seven modules call this from their init — art.units, art.buildings,
  // sim.production, sim.combat, sim.ai, ui.hud, input — and without the cache
  // each one re-globbed, re-scanned every export and re-ran `bindAliases`, then
  // logged the same "bound def tables" line again. The binding is immutable
  // content; there is nothing to recompute.
  bindingPromise ??= resolveDefBindingUncached();
  return bindingPromise;
}

/** Drop the memo. Tests that swap content between cases need this. */
export function clearDefBindingCache(): void {
  bindingPromise = null;
}

let bindingPromise: Promise<DefBinding> | null = null;

async function resolveDefBindingUncached(): Promise<DefBinding> {
  const paths = Object.keys(dataModules).sort();
  for (const path of paths) {
    let mod: Record<string, unknown>;
    try {
      mod = await dataModules[path]();
    } catch (err) {
      console.warn(`[scenario] skipped data module ${path}: ${String(err)}`);
      continue;
    }
    for (const name of Object.keys(mod)) {
      const value = mod[name];
      if (!looksLikeDefTables(value)) continue;
      console.info(
        `[scenario] bound def tables from ${path}#${name} ` +
        `(${value.units.length} units, ${value.buildings.length} buildings)`,
      );
      return {
        tables: value,
        unitId: bindAliases(value.unitByKey, UNIT_ALIASES),
        buildingId: bindAliases(value.buildingByKey, BUILDING_ALIASES),
      };
    }
  }
  return EMPTY_BINDING;
}

/* ==========================================================================
 * 4. THE BUILDER
 *
 * Everything a layout file is allowed to do to the world. Every method is
 * total: it returns NONE rather than throwing when the store is full, the key
 * is unknown or the position is off-map.
 * ========================================================================== */

const scratch2 = new Float32Array(2);
const scratchCell = new Int32Array(2);
/** Separate scratch for the placement validator — `scratchCell` is live in
 *  `spawnBuilding` while the validator runs. */
const placeCell = new Int32Array(2);
const placeOut = new Float32Array(2);

/** Cosmetic terrain extension. Kept duck-typed so scenarios still run against
 * the core world's flat test port, which intentionally has no splat texture. */
interface SurfaceStamper {
  stampSurface(cx: number, cz: number, layer: number, weight: number): void;
  commitSplat(): void;
}

/* --------------------------------------------------------------------------
 * NOTHING SPAWNS IN A PIT IT CANNOT LEAVE
 *
 * A procedural generator will always eventually produce something nobody
 * predicted. `Terrain.ensureConnectivity()` carves ramps between the pieces of
 * the map it considers worth joining and deliberately abandons the rest — a
 * nine-cell ledge on a distant hillside genuinely is not worth an eighty metre
 * trench. That policy is fine. What was missing was anyone checking whether an
 * army had been dropped into one of the scraps it abandoned, which is how
 * "spawned tanks stuck inside the valley and cant get out" reached a real
 * match.
 *
 * So every spawn in this file goes through `connectedGround`, and the result
 * is REPORTED rather than silently applied. A relocation is not a feature that
 * worked; it is the sound of a generator regression, and a line in the console
 * is the difference between finding it in a boot log and finding it in a bug
 * report.
 * -------------------------------------------------------------------------- */

/** Locomotors a scenario can actually place something with. */
const PLACEABLE_LOCOMOTORS: readonly Locomotor[] =
  [Locomotor.Foot, Locomotor.Track, Locomotor.Wheel, Locomotor.Hover];

/**
 * How far, in cells, the placement validator will look for connected ground.
 * 12 cells is 48 m — the radius the scenarios themselves drop an army into, so
 * a unit that has to be moved still lands inside its own composition rather
 * than on the far side of the frame.
 */
const PLACE_SEARCH_CELLS = 12;
/**
 * Rings searched outward for clear ground when a structure's own footprint is
 * already taken. Six cells is 24 m — wide enough to step around a neighbour in
 * a dense base, tight enough that a relocated building is still recognisably
 * where the layout meant it to be. Beyond that the honest answer is to skip it.
 */
const PLACE_CLEAR_RINGS = 6;

/** Map-connectivity health, published for the boot log and the debug overlay. */
export interface ConnectivityReport {
  /** Distinct 4-connected passable regions for a tracked vehicle. */
  readonly regions: number;
  /** Passable cells in total. */
  readonly passableCells: number;
  /** Cells held by the largest region. */
  readonly mainCells: number;
  /** `mainCells / passableCells`. 1.0 means the map is one piece. */
  readonly mainFraction: number;
  /** Spawns the validator had to move onto connected ground. */
  readonly relocated: number;
  /** Furthest any single placement was moved, metres. */
  readonly relocatedMaxMetres: number;
  /** Entities that ended the build outside the main region. Must be 0. */
  readonly strandedEntities: number;
  /**
   * Structures seated on ground `terrain.isBuildable` refuses — too steep, or
   * water. NOT automatically a defect: a naval yard is authored against a
   * waterline on purpose. It is the number that was never measured, which is
   * how four civilian derricks came to stand on a 0.45 slope while
   * `spawnBuilding` returned a live handle. See `ScenarioBuilder.spawnBuilding`.
   */
  readonly unbuildableGround: number;
  /** `"<key> at <x>,<z>"` for the first of them, or empty. */
  readonly unbuildableFirst: string;
  /** One line for the console. */
  readonly summary: string;
}

/** Options shared by every unit spawn. */
export interface SpawnUnitOptions {
  /** Facing in degrees, 0 = +Z, increasing toward +X. */
  yawDeg?: number;
  /** 0..1 of maxHp. Below 1 the health bar shows and damage soot appears. */
  hpFrac?: number;
  state?: UnitState;
  stance?: Stance;
  /** Veterancy rank 0..2. Drives the chevrons on the selection shot. */
  veterancy?: number;
  /** 0..1 of cargoMax. Only meaningful on a harvester. */
  cargoFrac?: number;
  /** Put it in the local player's selection (rings, health bars, chevrons). */
  selected?: boolean;
  /** Give it a standing order so the overlay draws move/attack feedback. */
  order?: { kind: OrderKind; x: number; z: number; target?: EntityId };
  /** Absolute Y. Overrides both the ground sampler and `float`. */
  y?: number;
  /**
   * Sit on the water surface: `max(WATER_LEVEL, groundHeight)`.
   *
   * Not simply `y = WATER_LEVEL`, because until the terrain module carves the
   * scenario's shoreline every "sea" cell is still dry land at y ≈ 8, and a
   * fleet pinned to y = 2 is a fleet buried up to its funnels. The max() makes
   * the naval shot degrade to "ships parked on a field" instead of "ships that
   * are not in the picture", and becomes exactly right the moment water exists.
   */
  float?: boolean;
}

export interface SpawnBuildingOptions {
  yawDeg?: number;
  hpFrac?: number;
  /** 0..1. Below 1 the structure renders mid-construction with the scan band. */
  buildProgress?: number;
  selected?: boolean;
  /** Suppress the automatic PrimaryFactory claim (a second war factory). */
  secondary?: boolean;
}

export interface SpawnPropOptions {
  yawDeg?: number;
  /** Uniform scale hint the RenderBridge may read off `seed`. */
  scale?: number;
  burning?: boolean;
}

/**
 * The world-mutating half of a scenario. One instance per build; layout files
 * receive it and never touch the EntityStore directly.
 */
export class ScenarioBuilder {
  /** Deterministic stream. Every placement jitter must come from here. */
  readonly rng: Rng;
  /** Entities spawned so far, for the spec's diagnostics. */
  count = 0;

  private readonly ore: OreFieldSpec[] = [];
  private shore: ShoreSpec | null = null;
  private placement: PlacementSpec | null = null;
  /** Where the layout wants the camera, when it has an opinion. */
  private focusX = NaN;
  private focusZ = NaN;
  /** Occupied radii, so scatter never drops a tree inside a war factory. */
  private readonly blockedX: number[] = [];
  private readonly blockedZ: number[] = [];
  private readonly blockedR: number[] = [];

  /** Terrain connectivity per locomotor, snapshotted before the first spawn. */
  private readonly regions = new Map<number, TerrainRegions>();
  /** Placements moved onto connected ground, and the worst distance moved. */
  private relocated = 0;
  private relocatedMaxMetres = 0;
  /** Structures seated on ground `terrain.isBuildable` refuses. See `spawnBuilding`. */
  private unbuildableGround = 0;
  /** The first of them, so the console line names one rather than a count. */
  private unbuildableFirst = '';
  /** At least one scenario foundation changed the terrain splat this build. */
  private surfaceDirty = false;

  constructor(
    readonly world: World,
    readonly defs: DefBinding,
    readonly keys: PerEntityObj<string>,
    /**
     * The scenario seed, kept so a layout can derive a choice from it WITHOUT
     * drawing from `rng`.
     *
     * That distinction is the whole reason this is exposed. Every draw from
     * `rng` advances one shared stream, so taking a single extra number to
     * decide something early would shift every ore patch, every scatter
     * position and every placement jitter after it — and change all twelve
     * scorecard fixtures. A pure hash of this consumes nothing.
     */
    readonly seed: number,
    /** The MAP_PRESETS entry this scenario is being built on. */
    readonly preset: string,
    /**
     * Armies this match seats. `startSpots(cx, cz, b.armies, b.sea, b.seed,
     * b.preset)` is the one
     * call every layout makes; nothing here counts `world.players` instead,
     * because that list is seeded by whoever booted the engine and a test that
     * happens to add a third player must not silently become a three-base map.
     */
    readonly armies: number = SKIRMISH_ARMIES_DEFAULT,
    /**
     * The sea the terrain was ACTUALLY carved with — `plan.sea` when a fixture
     * authored one, `MAP_SEAS[preset]` otherwise. Layouts read it to ask the
     * only question they ever have about the water: is this an archipelago, and
     * if so where are its islands.
     */
    readonly sea: SeaSpec | null = null,
  ) {
    this.rng = new Rng(seed);
    this.primeConnectivity();
  }

  /** True when this map's land is islands. Layouts branch on it; nothing else. */
  get archipelago(): boolean {
    return this.sea?.islands !== undefined && this.sea.islands.length > 0;
  }

  /* -- placement validation --------------------------------------------- */

  /**
   * Snapshot terrain connectivity BEFORE anything is placed.
   *
   * The timing is the whole design. `ITerrain.isPassable` reports an occupied
   * cell as closed, so labelling lazily on first use would fold this
   * scenario's own buildings into the answer — and a courtyard temporarily
   * sealed by its own base is not a terrain trap, nor is a structure the
   * player is about to sell a permanent wall. Taken here, once, before a
   * single footprint is marked, the labelling answers exactly the question
   * that matters: is this ground part of the map, or is it a hole?
   *
   * Four flood fills over 16k cells. Once per boot, well under a millisecond,
   * and it never runs again for the life of the build.
   */
  private primeConnectivity(): void {
    for (const loco of PLACEABLE_LOCOMOTORS) {
      try {
        this.regions.set(loco, new TerrainRegions(this.world.terrain, loco));
      } catch (err) {
        // A scenario never throws (law 1). Losing the snapshot costs us
        // validation, not the frame.
        console.warn(`[scenario] connectivity snapshot failed for locomotor ${loco}`, err);
      }
    }
  }

  /**
   * The nearest point to (x,z) that `loco` can both STAND ON and LEAVE,
   * written into `out` as [x,z]. Returns true when the point had to move.
   *
   * `strandedOnly` narrows the test to "passable, but cut off from the map".
   * Structures pass it, because a naval yard's centre cell sits over water and
   * a Track vehicle calls that impassable — shuffling it inland would break
   * every shoreline layout in the game to fix a problem it does not have.
   * Whether a structure may be founded on a cell at all is `sim/Placement`'s
   * question, not this one's; the only thing asked here is whether the ground
   * under it is joined to the rest of the world.
   */
  /**
   * "This cell is part of a world, not a hole in one."
   *
   * On every continent that is `isMain` and nothing else. On an ARCHIPELAGO it
   * is `isMain` OR any island-sized region, because three of the four islands
   * are not the main one and never can be — and the two callers below read the
   * answer as "relocate this building" and "this entity is stranded, log an
   * error". Without the widening, a four-island map relocates three bases
   * toward island 0 (or, once `PLACE_SEARCH_CELLS` runs out, keeps them and
   * reports every unit on them as trapped).
   *
   * `TERRAIN_ISLAND_MIN_CELLS` is the same threshold the GENERATOR uses for the
   * same judgement — see `TerrainFields.islandStartSatisfied` — so the scenario
   * and the terrain cannot disagree about what an island is.
   */
  private standable(r: TerrainRegions, cx: number, cz: number): boolean {
    if (r.isMain(cx, cz)) return true;
    if (!this.archipelago) return false;
    return r.regionCellsAt(cx, cz) >= TERRAIN_ISLAND_MIN_CELLS;
  }

  connectedGround(
    x: number, z: number, loco: Locomotor, out: Float32Array, strandedOnly = false,
  ): boolean {
    out[0] = x; out[1] = z;
    const r = this.regions.get(loco);
    // No snapshot, or a map with nothing passable on it at all: there is no
    // "connected" to move toward, so leave the caller's point alone.
    if (r === undefined || r.regionCount === 0) return false;

    const cx = clampCell(worldToCell(x));
    const cz = clampCell(worldToCell(z));
    if (this.standable(r, cx, cz)) return false;
    if (strandedOnly && r.regionAt(cx, cz) === 0) return false;

    if (!r.nearestMain(cx, cz, placeCell, PLACE_SEARCH_CELLS)) {
      console.warn(
        `[scenario] cell ${cx},${cz} is cut off from the map for locomotor ${loco} ` +
        `and nothing connected is within ${PLACE_SEARCH_CELLS} cells — placing anyway`,
      );
      return false;
    }

    out[0] = clampWorld((placeCell[0] + 0.5) * CELL, 2);
    out[1] = clampWorld((placeCell[1] + 0.5) * CELL, 2);
    this.relocated++;
    const moved = Math.hypot(out[0] - x, out[1] - z);
    if (moved > this.relocatedMaxMetres) this.relocatedMaxMetres = moved;
    return true;
  }

  /**
   * True when every cell a `fw` x `fh` footprint centred on (x, z) would cover
   * is free of another structure.
   *
   * `terrain.isOccupied` is the same grid `markOccupied` writes at the end of
   * this function, so a structure placed earlier in the layout is visible to
   * every one placed after it — which is what makes a single forward pass
   * enough and why no two-phase reservation is needed.
   */
  footprintClear(x: number, z: number, fw: number, fh: number): boolean {
    footprintOriginCell(x, z, fw, fh, scratchCell);
    const ox = scratchCell[0];
    const oz = scratchCell[1];
    for (let dz = 0; dz < fh; dz++) {
      for (let dx = 0; dx < fw; dx++) {
        const cx = ox + dx;
        const cz = oz + dz;
        if (!isInMap(cx, cz)) return false;
        if (this.world.terrain.isOccupied(cx, cz)) return false;
      }
    }
    return true;
  }

  /**
   * True when every cell a `fw` x `fh` footprint would cover is ground the
   * PLACEMENT RULE would accept — `terrain.isBuildable`, the same grid
   * `sim/Placement.evaluatePlacement` reads for `PlacementFault.Terrain`.
   *
   * SEPARATE FROM `footprintClear`, WHICH ASKS A DIFFERENT QUESTION. That one is
   * about other structures; this one is about slope and water. Nothing in this
   * builder used to ask it at all: `spawnBuilding` snapped, un-stranded and
   * de-overlapped a structure and then planted it on whatever grade was there,
   * returning a live EntityId. Four civilian derricks went down on a 0.45 slope
   * that way — ground no player could have built on, on a map where they were
   * meant to be a contested prize — and the call reported success.
   */
  footprintBuildable(x: number, z: number, fw: number, fh: number): boolean {
    footprintOriginCell(x, z, fw, fh, scratchCell);
    const ox = scratchCell[0];
    const oz = scratchCell[1];
    for (let dz = 0; dz < fh; dz++) {
      for (let dx = 0; dx < fw; dx++) {
        const cx = ox + dx;
        const cz = oz + dz;
        if (!isInMap(cx, cz)) return false;
        if (!this.world.terrain.isBuildable(cx, cz)) return false;
      }
    }
    return true;
  }

  /**
   * Paint the same poured foundation a player-placed building receives.
   * Scenario bases used to skip `Production.stampPad`, so their models floated
   * on grass while anything the player added later sat on concrete. Stamps are
   * accumulated and uploaded once by `commitSurfaceStamps()` after the entire
   * layout, avoiding one control-texture upload per prebuilt structure.
   */
  private stampBuildingPad(cx: number, cz: number, w: number, h: number): void {
    const t = this.world.terrain as unknown as Partial<SurfaceStamper>;
    if (typeof t.stampSurface !== 'function') return;
    const m = PLACEMENT.padMarginCells;
    for (let z = cz - m; z < cz + h + m; z++) {
      for (let x = cx - m; x < cx + w + m; x++) {
        if (!isInMap(x, z)) continue;
        const weight = placementPadWeight(x, z, cx, cz, w, h);
        if (weight > 0) {
          t.stampSurface(x, z, PLACEMENT.padSurface, weight);
          this.surfaceDirty = true;
        }
      }
    }
  }

  /** Upload every scenario pad as one terrain-splat batch. Safe on headless ports. */
  commitSurfaceStamps(): void {
    if (!this.surfaceDirty) return;
    const t = this.world.terrain as unknown as Partial<SurfaceStamper>;
    if (typeof t.commitSplat === 'function') t.commitSplat();
    this.surfaceDirty = false;
  }

  /**
   * Nearest clear footprint to (x, z), searched outward a ring at a time.
   * Writes the snapped centre into `out`; false when nothing within the limit
   * fits.
   *
   * RINGS, NOT A SPIRAL SCAN, so the result is the nearest by Chebyshev
   * distance and the tie-break is a fixed traversal order rather than whatever
   * order the cells happen to come out in. Two runs of the same seed must place
   * the same base.
   */
  findClearFootprint(
    x: number, z: number, fw: number, fh: number, out: Float32Array,
  ): boolean {
    for (let ring = 1; ring <= PLACE_CLEAR_RINGS; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          // Perimeter only; the interior was covered by a smaller ring.
          if (Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
          const tx = x + dx * CELL;
          const tz = z + dz * CELL;
          snapFootprintToGrid(tx, tz, fw, fh, scratch2);
          const px = clampWorld(scratch2[0], fw * CELL);
          const pz = clampWorld(scratch2[1], fh * CELL);
          if (!this.footprintClear(px, pz, fw, fh)) continue;
          // Still has to be somewhere an army can reach, or this trades a
          // stacked building for a stranded one.
          if (this.connectedGround(px, pz, Locomotor.Track, placeOut, true)) continue;
          out[0] = px;
          out[1] = pz;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Audit what actually ended up on the map. This is the check that would have
   * caught the reported bug before a player did: it walks the finished world
   * and asks, of every entity, whether the ground it is standing on is joined
   * to the rest of the map.
   */
  auditConnectivity(): ConnectivityReport {
    const track = this.regions.get(Locomotor.Track);
    const st = this.world.store;
    let stranded = 0;

    for (let a = 0; a < st.aliveCount; a++) {
      const i = st.alive[a];
      const kind = st.kind[i];
      const isUnit = kind === EntityKind.Infantry || kind === EntityKind.Vehicle;
      if (!isUnit && kind !== EntityKind.Building) continue;
      // Structures are audited against the locomotor that has to REACH them.
      const loco = isUnit ? (st.locomotor[i] as Locomotor) : Locomotor.Track;
      const r = this.regions.get(loco);
      if (r === undefined || r.regionCount === 0) continue;
      const cx = clampCell(worldToCell(st.posX[i]));
      const cz = clampCell(worldToCell(st.posZ[i]));
      // A structure standing on ground its visitors call impassable (a naval
      // yard over water) is a different question with a different owner.
      if (!isUnit && r.regionAt(cx, cz) === 0) continue;
      if (!this.standable(r, cx, cz)) stranded++;
    }

    const regions = track?.regionCount ?? 0;
    const passableCells = track?.passableCells ?? 0;
    const mainCells = track?.mainRegionCells ?? 0;
    const mainFraction = track?.mainFraction ?? 1;

    const summary =
      `${regions} passable region${regions === 1 ? '' : 's'} for a tracked hull; ` +
      `the main one holds ${mainCells} of ${passableCells} cells ` +
      `(${(mainFraction * 100).toFixed(1)}%); ` +
      `${this.relocated} placement${this.relocated === 1 ? '' : 's'} relocated` +
      (this.relocated > 0 ? ` (worst ${this.relocatedMaxMetres.toFixed(1)} m)` : '') +
      `; ${stranded} entit${stranded === 1 ? 'y' : 'ies'} stranded` +
      `; ${this.unbuildableGround} structure${this.unbuildableGround === 1 ? '' : 's'} on ` +
      'ground isBuildable refuses' +
      (this.unbuildableFirst === '' ? '' : ` (first: ${this.unbuildableFirst})`);

    return {
      regions,
      passableCells,
      mainCells,
      mainFraction,
      relocated: this.relocated,
      relocatedMaxMetres: this.relocatedMaxMetres,
      strandedEntities: stranded,
      unbuildableGround: this.unbuildableGround,
      unbuildableFirst: this.unbuildableFirst,
      summary,
    };
  }

  /* -- players ---------------------------------------------------------- */

  /**
   * The FIRST army slot — historically "the Allied player", and still named
   * that because two dozen layout files say `b.allies`.
   *
   * Resolved by SLOT, not by faction. Searching the player table for
   * `Faction.Allies` broke in two ways the lobby can now produce: a mirror
   * match handed both scripted bases to the same player, and a Meridian player
   * matched nothing at all and started with no base. Slot 0 is the local
   * player in every seating this game produces, which is exactly what a layout
   * means when it writes `b.allies`.
   */
  get allies(): PlayerId {
    return this.armySlot(0);
  }

  /** The SECOND army slot — historically "the Soviet player". */
  get soviets(): PlayerId {
    return this.armySlot(1);
  }

  /**
   * The i-th non-neutral player, creating one if the world is short.
   *
   * `world.localPlayer` is pinned to slot 0 by Bootstrap and the shell writes
   * the lobby's faction choice onto that same slot, so slot order is player
   * order and both are stable across a rebuild.
   */
  armySlot(i: number): PlayerId {
    const w = this.world;
    let seen = 0;
    for (let p = 0; p < w.players.length; p++) {
      if (w.players[p].faction === Faction.Neutral) continue;
      if (seen === i) return w.players[p].id;
      seen++;
    }
    // Only reached by a fixture that asks for more armies than the world was
    // seeded with. Alternate the two original armies rather than inventing one.
    return w.addPlayer(
      i === 0 ? Faction.Allies : Faction.Soviets,
      i === 0 ? 'Commander' : 'Opponent', false, false,
    );
  }

  /**
   * Translate a layout's content key into the equivalent for `owner`'s army.
   *
   * A base LAYOUT is geometry — where the refinery sits relative to the yard,
   * how wide the sortie gate is — and it is authored once. The CONTENT is per
   * army. Without this, `buildAlliedBase` for a Meridian player spawned nothing
   * at all (every key missed `FALLBACK_BUILDINGS`' faction check) and a mirror
   * match gave one side the other's buildings.
   *
   * Identity for the army the key already belongs to, so every `?shot=` fixture
   * is byte-identical to before.
   */
  keyFor(owner: PlayerId, key: string): string {
    const p = this.world.players[owner as number];
    if (p === undefined) return key;
    const row = FACTION_KEY_MAP[key];
    if (row === undefined) return key;
    return row[p.faction as number] ?? key;
  }

  /**
   * The Gaia slot that owns rocks, trees, wrecks and crates. Created on first
   * use and allied to everyone, so no targeting scan ever considers a tree an
   * enemy even if a module forgets to honour NotATarget.
   */
  get gaia(): PlayerId {
    const w = this.world;
    for (let i = 0; i < w.players.length; i++) {
      if (w.players[i].faction === Faction.Neutral) return w.players[i].id;
    }
    const id = w.addPlayer(Faction.Neutral, 'Gaia', false, false);
    const gp = w.player(id);
    // Everyone is friends with the scenery, in both directions.
    for (let i = 0; i < w.players.length; i++) {
      gp.allyMask |= 1 << i;
      w.players[i].allyMask |= 1 << (id as number);
    }
    return id;
  }

  /**
   * Resolve (or create) the player that owns a faction-specific showcase.
   *
   * Normal match layouts should keep using `armySlot`: seating is a lobby
   * concern there. Art fixtures are different — their whole job is to place
   * equivalent roles from all four armies beside one another, so they need an
   * explicit faction owner without depending on whichever two slots booted.
   */
  ownerForFaction(faction: Faction): PlayerId {
    const w = this.world;
    for (let i = 0; i < w.players.length; i++) {
      if (w.players[i].faction === faction) return w.players[i].id;
    }
    return w.addPlayer(faction, faction === Faction.Allies ? 'Commander' : 'Opponent', false, false);
  }

  /* -- spawning --------------------------------------------------------- */

  /**
   * Spawn a unit by content key. Returns NONE when the key is unknown or the
   * store is full — a caller may ignore the result, that is the point.
   */
  spawnUnit(
    key: string,
    owner: PlayerId,
    x: number,
    z: number,
    options: SpawnUnitOptions = {},
  ): EntityId {
    key = this.keyFor(owner, key);
    const fb = FALLBACK_UNITS[key];
    if (fb === undefined) {
      console.warn(`[scenario] unknown unit key "${key}"`);
      return NONE;
    }
    const s = this.world.store;
    const defId = this.defs.unitId[key] ?? -1;
    const def: UnitDef | undefined =
      defId >= 0 ? this.defs.tables?.units[defId] : undefined;

    // Same gate as `spawnBuilding`, and for the same reason: the standing
    // garrison in an opening base is authored in role terms, and one of the
    // Soviet roles is 'apocalypse'. A fresh profile used to start the match
    // looking at a Sledge Tank it could not build for another 500 kills.
    // Skipped rather than substituted; `formation()` simply lands fewer hulls.
    if (!isBuildable(def, this.world.player(owner))) return NONE;

    // Resolve the chassis before the position, because WHICH ground counts as
    // standable is a property of the chassis: infantry climb what a tank
    // cannot, and a hovercraft crosses water neither of them can.
    const loco = def?.locomotor ?? fb.locomotor;
    let px = clampWorld(x, 2);
    let pz = clampWorld(z, 2);
    if (this.connectedGround(px, pz, loco, placeOut)) {
      px = placeOut[0];
      pz = placeOut[1];
    }
    const yaw = wrapAngle((options.yawDeg ?? 0) * DEG2RAD);
    const ground = this.world.terrain.heightAt(px, pz);
    const py = options.y ?? (options.float === true ? Math.max(WATER_LEVEL, ground) : ground);
    const faction = this.world.player(owner).faction;

    const kind = def?.kind ?? fb.kind;
    const id = s.alloc(kind, defId, owner, faction, px, py, pz, yaw);
    if (id === NONE) return NONE;
    const i = s.index(id);

    const maxHp = def?.maxHp ?? fb.maxHp;
    s.maxHp[i] = maxHp;
    s.hp[i] = maxHp * (options.hpFrac ?? 1);
    s.armorClass[i] = def?.armor ?? fb.armor;
    s.sight[i] = def?.sight ?? fb.sight;
    s.maxSpeed[i] = def?.maxSpeed ?? fb.maxSpeed;
    s.accel[i] = def?.accel ?? fb.accel;
    s.turnRate[i] = def?.turnRate ?? fb.turnRate;
    s.turretTurnRate[i] = fb.turretTurnRate;
    s.locomotor[i] = loco;
    // A radius fitted to the hull box: too small and tanks interpenetrate, too
    // large and a column of Anvils cannot use a 3-cell gap in its own wall.
    s.radius[i] = def?.radius ?? Math.max(fb.width, fb.length) * 0.45;
    s.crushLevel[i] = def?.crushLevel ?? fb.crushLevel;
    s.crushableBy[i] = def?.crushableBy ?? fb.crushableBy;
    s.cargoMax[i] = def?.cargoMax ?? fb.cargoMax;
    s.cargo[i] = s.cargoMax[i] * (options.cargoFrac ?? 0);
    s.weaponIndex[i] = def !== undefined && def.weapons.length > 0 ? def.weapons[0] : -1;
    s.state[i] = options.state ?? UnitState.Idle;
    s.stance[i] = options.stance ?? Stance.Aggressive;
    s.veterancy[i] = options.veterancy ?? 0;
    s.spawnTick[i] = this.world.tick;

    let flags = s.flags[i] | fb.flags | (def?.flags ?? 0);
    if ((def?.maxSpeed ?? fb.maxSpeed) > 0) flags |= EntityFlag.CanMove;
    if (def?.hasTurret ?? false) flags |= EntityFlag.HasTurret;
    if ((options.veterancy ?? 0) >= 1) flags |= EntityFlag.Veteran1;
    if ((options.veterancy ?? 0) >= 2) flags |= EntityFlag.Veteran2;
    s.flags[i] = flags;

    if (options.order !== undefined) {
      s.orderKind[i] = options.order.kind;
      s.orderX[i] = options.order.x;
      s.orderZ[i] = options.order.z;
      s.orderTarget[i] = (options.order.target ?? NONE) as number;
    } else {
      s.orderKind[i] = OrderKind.None;
      s.orderX[i] = px;
      s.orderZ[i] = pz;
    }
    s.guardX[i] = px;
    s.guardZ[i] = pz;

    // DECLARE THE MOVE CLASS HERE TOO. `Production.spawnUnit` has done this
    // since warships learned to launch onto water, and this path — every
    // scenario, every capture fixture, every headless test that seeds a fleet —
    // never did, so a scenario-placed hull fell through to
    // `Movement.moveClassAt`'s guess: Hover if the cell it was posed on is dry,
    // Naval if wet, latched against `store.gen[i]` for the life of the slot.
    // Two spawners answering one question differently is how the `?shot=naval`
    // fixture and a produced fleet ended up with different turn models.
    if (def?.waterOnly === true) setMoveClass(s, id, MoveClass.Naval);
    else if (def?.amphibious === true) setMoveClass(s, id, MoveClass.Hover);

    this.finish(id, i, key, owner, kind, options.selected === true);
    return id;
  }

  /**
   * Spawn a structure by content key. The position is SNAPPED to the footprint
   * grid first — an unsnapped building sits half a cell into its own occupancy
   * rectangle and every placement check downstream disagrees with the render.
   */
  spawnBuilding(
    key: string,
    owner: PlayerId,
    x: number,
    z: number,
    options: SpawnBuildingOptions = {},
  ): EntityId {
    key = this.keyFor(owner, key);
    const fb = FALLBACK_BUILDINGS[key];
    if (fb === undefined) {
      console.warn(`[scenario] unknown building key "${key}"`);
      return NONE;
    }
    const s = this.world.store;
    const defId = this.defs.buildingId[key] ?? -1;
    const def: BuildingDef | undefined =
      defId >= 0 ? this.defs.tables?.buildings[defId] : undefined;

    /* -- THE PROGRESSION GATE ---------------------------------------------
     * A skirmish opens with a base already standing, and that base is authored
     * in role terms ('battleLab', 'prismTower') which `keyFor` remaps per
     * faction. Without this check the opening base HANDS OUT the structures the
     * mission table exists to sell: a fresh profile started next to a free
     * Proving Ground, the Soviet AI opened with Tesla Coils the player could
     * not build, and the reward for a 150-kill chain was already in both bases
     * before the first shot. Verified live before it was fixed.
     *
     * SKIPPED, NOT SUBSTITUTED. The layout simply has a gap where the locked
     * building would be, which is the honest reading — the base is what this
     * commander has earned. Everything untagged is unaffected, so the
     * construction yard, power, refinery, factories and the cheap defence are
     * never at risk, and `isBuildable` answers "yes" to everything when no gate
     * is installed, which is the state of the `?shot=` harness and every test.  */
    if (!isBuildable(def, this.world.player(owner))) return NONE;

    const localW = def?.footprintW ?? fb.footprintW;
    const localH = def?.footprintH ?? fb.footprintH;
    const yaw = wrapAngle((options.yawDeg ?? 0) * DEG2RAD);
    const facing = yawToFacing(yaw);
    // Scenario structures use the same world-space footprint convention as
    // player placement. A 3x2 War Factory at 90 degrees is a 2x3 rectangle;
    // keeping 3x2 here made the renderer visibly spill into a neighbour even
    // though the occupancy pass claimed the layout was clear.
    const fw = facedFootprintW(localW, localH, facing);
    const fh = facedFootprintH(localW, localH, facing);
    snapFootprintToGrid(x, z, fw, fh, scratch2);
    let px = clampWorld(scratch2[0], fw * CELL);
    let pz = clampWorld(scratch2[1], fh * CELL);
    // A refinery in a pit is a refinery no harvester can ever dock at, and a
    // war factory in one produces an army that is born trapped. Structures are
    // validated against the TRACKED locomotor because that is what has to
    // reach them, and only against "passable but cut off" so a shoreline
    // building standing over water is left exactly where the layout put it.
    if (this.connectedGround(px, pz, Locomotor.Track, placeOut, true)) {
      snapFootprintToGrid(placeOut[0], placeOut[1], fw, fh, scratch2);
      px = clampWorld(scratch2[0], fw * CELL);
      pz = clampWorld(scratch2[1], fh * CELL);
    }

    /* -- NOTHING MAY STAND ON ANOTHER STRUCTURE ----------------------------
     * "Auto placement of pre seeded construction yielded this, placing
     * building on top of each other", reported with a screenshot of two Soviet
     * structures interpenetrating. Reproduced immediately once a test looked:
     * 80 overlapping pairs across four biomes and four seeds.
     *
     * THERE WAS NO OCCUPANCY CHECK ANYWHERE IN THIS FUNCTION. The authored
     * layouts avoid each other by construction — hand-placed offsets — so the
     * absence never showed. Then `connectedGround` above relocates a structure
     * whose cell is cut off to `nearestMain`, which knows about PASSABILITY and
     * nothing about what is already built. Two structures stranded by the same
     * piece of bad ground both relocate to the same nearest cell and land on
     * top of one another.
     *
     * The relocation is not the whole story either: it fires only for stranded
     * cells, while this check also catches an authored overlap, a footprint
     * that grew, and a layout reused at a tighter spacing.
     *
     * REFUSING IS SAFE AND IS THE LAST RESORT. Every base layout already
     * tolerates a missing optional structure — the progression gate above
     * returns NONE for anything locked and the layouts simply have a gap — so a
     * building that cannot find clear ground is a far better outcome than two
     * in one square. The Construction Yard is placed first by every layout, so
     * the one structure that must exist is never the one squeezed out.
     * --------------------------------------------------------------------- */
    if (!this.footprintClear(px, pz, fw, fh)) {
      if (!this.findClearFootprint(px, pz, fw, fh, placeOut)) {
        console.warn(
          `[scenario] "${key}" found no clear ${fw}x${fh} ground near `
          + `${px.toFixed(0)},${pz.toFixed(0)} — skipped rather than stacked`,
        );
        return NONE;
      }
      px = placeOut[0];
      pz = placeOut[1];
    }

    /* -- AND THE GROUND UNDER IT ------------------------------------------
     * COUNTED AND NAMED, NOT MOVED OR REFUSED, and the asymmetry with the
     * occupancy check above is deliberate.
     *
     * Two structures in one square is always wrong, so that case relocates and
     * then skips. Standing on ground `isBuildable` refuses is only USUALLY
     * wrong: `?shot=naval` deliberately founds a yard against a waterline, the
     * beach cone is unbuildable for most of its run, and a scenario is authored
     * content rather than a player's click — the rule that stops you putting a
     * refinery on a cliff is not a rule that should silently delete a fixture's
     * composition or shove it sideways past the pose it was captured for.
     *
     * What was actually wrong was the SILENCE. Nothing in this builder asked
     * `isBuildable` at all, so a layout could seat a whole army on ground that
     * same army could not extend and every call reported success. It goes on the
     * connectivity report next to `strandedEntities`, where a test can assert it
     * and the boot log prints it.
     * --------------------------------------------------------------------- */
    if (!this.footprintBuildable(px, pz, fw, fh)) {
      this.unbuildableGround++;
      if (this.unbuildableFirst === '') {
        this.unbuildableFirst = `${key} at ${px.toFixed(0)},${pz.toFixed(0)}`;
      }
    }

    const py = this.world.terrain.heightAt(px, pz);
    const faction = this.world.player(owner).faction;

    const id = s.alloc(EntityKind.Building, defId, owner, faction, px, py, pz, yaw);
    if (id === NONE) return NONE;
    const i = s.index(id);

    const maxHp = def?.maxHp ?? fb.maxHp;
    s.maxHp[i] = maxHp;
    s.hp[i] = maxHp * (options.hpFrac ?? 1);
    s.armorClass[i] = def?.armor ?? fb.armor;
    s.sight[i] = def?.sight ?? fb.sight;
    s.footprintW[i] = fw;
    s.footprintH[i] = fh;
    s.powerDraw[i] = def?.power ?? fb.power;
    s.locomotor[i] = Locomotor.Static;
    // Half the footprint diagonal: a query at the corner of a 3x3 yard must hit.
    s.radius[i] = Math.max(fw, fh) * CELL * 0.5;
    s.weaponIndex[i] = def !== undefined && def.weapons.length > 0 ? def.weapons[0] : -1;
    s.buildProgress[i] = options.buildProgress ?? 1;
    s.state[i] = s.buildProgress[i] < 1 ? UnitState.UnderConstruction : UnitState.Idle;
    s.spawnTick[i] = this.world.tick;

    let flags = s.flags[i] | fb.flags | (def?.flags ?? 0);
    if (def?.hasTurret ?? false) flags |= EntityFlag.HasTurret;
    if (s.buildProgress[i] < 1) flags |= EntityFlag.UnderConstruction;
    if (options.secondary === true) flags &= ~EntityFlag.PrimaryFactory;
    s.flags[i] = flags;

    // The nav grid and the render must agree about which cells are taken.
    footprintOriginCell(px, pz, fw, fh, scratchCell);
    this.world.terrain.markOccupied(scratchCell[0], scratchCell[1], fw, fh, id);
    this.stampBuildingPad(scratchCell[0], scratchCell[1], fw, fh);
    this.block(px, pz, s.radius[i] + 1.5);

    // Keep the player's cached economy in step, or the HUD lies about power and
    // storage from the very first frame of the shot.
    const p = this.world.player(owner);
    const power = s.powerDraw[i];
    if (power > 0) p.powerProduced += power;
    else p.powerConsumed += -power;
    p.storageMax += def?.storage ?? fb.storage;
    if (defId >= 0 && defId < p.buildingCount.length) p.buildingCount[defId]++;

    this.finish(id, i, key, owner, EntityKind.Building, options.selected === true);
    return id;
  }

  /** Spawn a rock, tree, bush, barrel, crate or burnt-out hulk. */
  spawnProp(key: string, x: number, z: number, options: SpawnPropOptions = {}): EntityId {
    const fb = FALLBACK_PROPS[key];
    if (fb === undefined) {
      console.warn(`[scenario] unknown prop key "${key}"`);
      return NONE;
    }
    const s = this.world.store;
    const px = clampWorld(x, 1);
    const pz = clampWorld(z, 1);
    const py = this.world.terrain.heightAt(px, pz);
    const owner = this.gaia;
    const yaw = wrapAngle((options.yawDeg ?? this.rng.range(-180, 180)) * DEG2RAD);

    const id = s.alloc(fb.kind, PROP_DEF_ID[key] ?? -1, owner, Faction.Neutral, px, py, pz, yaw);
    if (id === NONE) return NONE;
    const i = s.index(id);

    s.maxHp[i] = fb.maxHp;
    s.hp[i] = fb.maxHp;
    s.armorClass[i] = ArmorClass.Wood;
    s.radius[i] = fb.radius * (options.scale ?? 1);
    s.locomotor[i] = Locomotor.Static;
    s.flags[i] |= fb.flags | (options.burning === true ? EntityFlag.Burning : 0);
    s.spawnTick[i] = this.world.tick;
    // Overwrite the slot's derived seed with a scale hint the bridge can read
    // without another side array. 0.5 is "as authored".
    if (options.scale !== undefined) s.seed[i] = Math.min(0.999, options.scale * 0.5);

    // No prop reserves a spot any more — `rock` and `boulder` were the only two
    // that ever satisfied this and they carry no `BlocksNav` now, so the test
    // was a dead conditional that read as live. `scatter()` already reserves
    // `SCENARIO_SCATTER.minSpacing` (3.2 m) concentrically at the same point,
    // which equals boulder's radius and exceeds rock's, so scatter-placed props
    // re-lay identically and no RNG draw moves.
    this.finish(id, i, key, owner, fb.kind, false);
    return id;
  }

  /** A burning hulk. Reads as "this frame is 30 seconds into a fight". */
  spawnWreck(
    x: number, z: number, faction: Faction, burning = true, cls: WreckClass = 'medium',
  ): EntityId {
    const id = this.spawnProp('wreck', x, z, { burning });
    const i = this.world.store.index(id);
    if (i >= 0) {
      this.world.store.faction[i] = faction;
      this.world.store.defId[i] = VEHICLE_WRECK_DEF[cls];
      this.world.store.radius[i] = WRECK_LENGTH[cls] * 0.45;
    }
    return id;
  }

  /* -- composition helpers ---------------------------------------------- */

  /**
   * Place `count` units in staggered ranks facing `yawDeg`, the way a player
   * actually parks an army: rows offset by half a spacing so the back rank is
   * visible between the front rank, not hidden behind it.
   */
  formation(
    key: string,
    owner: PlayerId,
    cx: number,
    cz: number,
    count: number,
    options: SpawnUnitOptions & { columns?: number; spacing?: number; jitter?: number } = {},
  ): number {
    const spacing = options.spacing ?? 7.5;
    const columns = options.columns ?? Math.min(count, 5);
    const jitter = options.jitter ?? 0.9;
    const yaw = (options.yawDeg ?? 0) * DEG2RAD;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const rows = Math.ceil(count / columns);
    let placed = 0;

    for (let n = 0; n < count; n++) {
      const row = (n / columns) | 0;
      const col = n % columns;
      const inRow = Math.min(columns, count - row * columns);
      // Centre each row independently, and stagger the odd rows.
      const lx = (col - (inRow - 1) * 0.5) * spacing + (row & 1 ? spacing * 0.5 : 0);
      const lz = (row - (rows - 1) * 0.5) * spacing * 0.85;
      const jx = this.rng.range(-jitter, jitter);
      const jz = this.rng.range(-jitter, jitter);
      // Rotate the local rank/file frame into the formation's facing.
      const wx = cx + (lx + jx) * cos + (lz + jz) * sin;
      const wz = cz - (lx + jx) * sin + (lz + jz) * cos;
      const id = this.spawnUnit(key, owner, wx, wz, {
        ...options,
        yawDeg: (options.yawDeg ?? 0) + this.rng.range(-4, 4),
      });
      if (id !== NONE) placed++;
    }
    return placed;
  }

  /**
   * Dress the framed area with entity props, rejecting anything that lands on a
   * structure, on another prop, or outside the map.
   *
   * The full wilderness carpet (bible §1 ruling 9: 260 props/ha) belongs to the
   * instanced scatter system — these are the ones that cast a real shadow and
   * can be shot away. NONE of them blocks navigation any more; `rock` and
   * `boulder` were the last two that did. What they still do is cast a shadow,
   * nav and get crushed.
   *
   * REJECTS WATER, which it did not have to before `MAP_SEAS` existed. Every
   * scatter box in this file is authored as a square around the composition, and
   * on a map with a sea part of that square is now sea: `skirmish` dresses
   * centre +/- 120 m, whose near corner sits inside `MAP_SEAS.coast`. The
   * instanced carpet has always tested `PASS_GROUND` (`world/Scatter.ts`), but
   * `spawnProp` places at `heightAt` unconditionally, so an unguarded box put
   * pines on the seabed with their crowns through the water plane. Same test,
   * both scatters.
   */
  scatter(
    box: WorldBox,
    count: number,
    kinds: readonly string[] = MAP_PRESETS[this.preset]?.props ?? ['tree', 'rock', 'bush'],
  ): number {
    const budget = Math.min(count, SCENARIO_SCATTER.maxProps);
    const spacing = SCENARIO_SCATTER.minSpacing;
    const terrain = this.world.terrain;
    let placed = 0;
    // Bounded rejection sampling: 8 tries per prop, then give up on that one.
    // A dense base leaves genuinely no room, and looping forever is not an
    // acceptable way to discover that.
    for (let n = 0; n < budget; n++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const x = this.rng.range(box.minX, box.maxX);
        const z = this.rng.range(box.minZ, box.maxZ);
        const cx = worldToCell(x);
        const cz = worldToCell(z);
        if (isInMap(cx, cz) && terrain.isWater(cx, cz)) continue;
        if (this.isBlocked(x, z, spacing)) continue;
        // Weight the list richest-first: index 0 appears about half the time.
        const pick = kinds[Math.min(kinds.length - 1, Math.floor(-Math.log2(1 - this.rng.next())))];
        const id = this.spawnProp(pick, x, z, { scale: this.rng.range(0.8, 1.35) });
        if (id === NONE) return placed;
        this.block(x, z, spacing);
        placed++;
        break;
      }
    }
    return placed;
  }

  /** Reserve a circle so scatter and later structures avoid it. */
  block(x: number, z: number, radius: number): void {
    this.blockedX.push(x);
    this.blockedZ.push(z);
    this.blockedR.push(radius);
  }

  /** True if (x,z) is within `pad` metres of anything already reserved. */
  isBlocked(x: number, z: number, pad = 0): boolean {
    for (let i = 0; i < this.blockedX.length; i++) {
      const dx = x - this.blockedX[i];
      const dz = z - this.blockedZ[i];
      const r = this.blockedR[i] + pad;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /* -- published world data --------------------------------------------- */

  /** Declare an ore patch. The OreField module seeds the cells from this. */
  addOre(x: number, z: number, radius: number, richness?: number): void {
    const preset = MAP_PRESETS[this.preset];
    this.ore.push({
      x: clampWorld(x, radius * 0.5),
      z: clampWorld(z, radius * 0.5),
      radius,
      richness: richness ?? ORE_CELL_MAX * (preset?.oreRichness ?? 0.85),
    });
  }

  /** Declare the shoreline. Water is where `(p - origin) · normal > 0`. */
  setShore(x: number, z: number, normalX: number, normalZ: number, bandWidth = 6): void {
    const len = Math.hypot(normalX, normalZ) || 1;
    this.shore = { x, z, normalX: normalX / len, normalZ: normalZ / len, bandWidth };
  }

  /**
   * Footprint of a structure key in CELLS, preferring the real def table.
   * Callers need this before they can convert a world point into the origin
   * cell a build ghost snaps to.
   */
  footprintOf(key: string): { w: number; h: number } {
    const fb = FALLBACK_BUILDINGS[key];
    const defId = this.defs.buildingId[key] ?? -1;
    const def = defId >= 0 ? this.defs.tables?.buildings[defId] : undefined;
    return {
      w: def?.footprintW ?? fb?.footprintW ?? 1,
      h: def?.footprintH ?? fb?.footprintH ?? 1,
    };
  }

  /** The pending placement declared so far, or null. */
  currentPlacement(): PlacementSpec | null {
    return this.placement;
  }

  /** Declare the structure the player is holding on the cursor. */
  setPlacement(key: string, cx: number, cz: number): void {
    const fb = FALLBACK_BUILDINGS[key];
    if (fb === undefined) return;
    const defId = this.defs.buildingId[key] ?? -1;
    const def = defId >= 0 ? this.defs.tables?.buildings[defId] : undefined;
    this.placement = {
      key,
      defId,
      cx,
      cz,
      footprintW: def?.footprintW ?? fb.footprintW,
      footprintH: def?.footprintH ?? fb.footprintH,
      buildRadius: def?.buildRadius ?? BUILD_RADIUS,
      weaponRange: fb.weaponRange,
    };
  }

  /** True when the given world point is on the water side of the shoreline. */
  isWater(x: number, z: number): boolean {
    const s = this.shore;
    if (s === null) return false;
    return (x - s.x) * s.normalX + (z - s.z) * s.normalZ > 0;
  }

  /**
   * Point the camera at a world position the layout computed.
   *
   * `ScenarioPlan.focusDX/focusDZ` is a CONSTANT offset from the map centre, and
   * that was fine while the skirmish plan also hard-coded where the bases went.
   * It is not fine now that slot 0's opening is derived from
   * `Terrain.startLocations()`: the constant and the army would disagree the
   * moment the generator reserves a shelf somewhere other than the centre, and
   * the match would open looking at empty ground. A layout that knows where it
   * put the local player says so; everything else keeps the constant.
   */
  setCameraFocus(x: number, z: number): void {
    this.focusX = x;
    this.focusZ = z;
  }

  /** The focus the layout asked for, or null. */
  cameraFocus(): { x: number; z: number } | null {
    return Number.isFinite(this.focusX) ? { x: this.focusX, z: this.focusZ } : null;
  }

  /** Set the local player's bank so the HUD does not read a flat 10000. */
  setCredits(player: PlayerId, credits: number): void {
    const p = this.world.player(player);
    p.credits = Math.max(0, Math.round(credits));
  }

  /** Put entities into the local selection, exactly as input/Selection would. */
  select(ids: readonly EntityId[]): void {
    const sel = this.world.selection;
    const s = this.world.store;
    sel.count = 0;
    let building = ids.length > 0;
    let homogeneous = -2;
    for (const id of ids) {
      const i = s.index(id);
      if (i < 0 || sel.count >= sel.ids.length) continue;
      s.flags[i] |= EntityFlag.Selected;
      sel.ids[sel.count++] = id as number;
      if (s.kind[i] !== EntityKind.Building) building = false;
      if (homogeneous === -2) homogeneous = s.defId[i];
      else if (homogeneous !== s.defId[i]) homogeneous = -1;
    }
    sel.isBuilding = building && sel.count > 0;
    sel.homogeneousDef = homogeneous === -2 ? -1 : homogeneous;
  }

  /** Everything the spec needs from the build, harvested once at the end. */
  harvest(): { ore: OreFieldSpec[]; shore: ShoreSpec | null; placement: PlacementSpec | null } {
    return { ore: this.ore, shore: this.shore, placement: this.placement };
  }

  /* -- internals -------------------------------------------------------- */

  /** Shared bookkeeping for every spawn path. */
  private finish(
    id: EntityId,
    index: number,
    key: string,
    owner: PlayerId,
    kind: EntityKind,
    selected: boolean,
  ): void {
    this.keys.set(id, key);
    this.count++;
    const p = this.world.player(owner);
    if (kind < p.entityCount.length) p.entityCount[kind]++;
    if (selected) this.world.store.flags[index] |= EntityFlag.Selected;
  }
}

/* ==========================================================================
 * 5. THE ROUTER
 * ========================================================================== */

/** Base camera framing per scenario, before the harness poses it. */
interface ScenarioPlan {
  map: string;
  distance: number;
  /**
   * Camera yaw in degrees. 24 for the wide shots rather than 0 or 45: at 0 the
   * ground grid runs straight up the screen and the frame reads as a flat table
   * (bible §0 property 3); past ~30 the rotated bounding box of a base no
   * longer fits inside the trapezoid the camera can actually see.
   */
  yawDeg: number;
  frozen: boolean;
  settleTicks: number;
  /** Camera focus offset from the map centre. Only the default boot uses it. */
  focusDX?: number;
  focusDZ?: number;
  /**
   * A shoreline the TERRAIN GENERATOR must carve, in world metres.
   *
   * Declared on the PLAN rather than inside `build` because terrain generates
   * long before any scenario runs — `world.terrain` is Phase.Command order 40
   * and `game.scenario` is Phase.Cleanup order 10 000. `src/world/sea.system.ts`
   * reads it off `plannedScenario()` and hands it to `Terrain` in between.
   *
   * A plan that declares one must also `setShore` the same geometry inside its
   * builder, so `ScenarioSpec.shore` and the ground agree; `buildScenario`
   * checks and warns.
   *
   * THIS IS THE FIXTURE CHANNEL, not the only one. A PLAYABLE map gets its sea
   * from `MAP_SEAS`, keyed on the map preset, and `planScenario` prefers this
   * field over that table. The `setShore` obligation above belongs to this
   * channel alone: it exists because a fixture authors a composition against a
   * specific waterline, and `skirmish` authors nothing against the coast.
   */
  sea?: SeaSpec;
  /**
   * Where `build` is centred.
   *
   * 'shelf' (the default) is `Terrain.startLocations()[0]` — the levelled, dry,
   * connected patch the generator reserves, which is what a base wants to be
   * standing on. 'centre' pins the composition to the map centre instead, and
   * is for layouts anchored to WORLD-space geometry: a plan that declares a
   * `sea` positions everything relative to that shoreline, and the shelf is
   * pushed inland precisely to get out of the sea's way, so following it would
   * march the whole composition off the coast it was authored around.
   */
  anchor?: 'shelf' | 'centre';
  /**
   * Armies this fixture composes, 2..`SKIRMISH_ARMIES_MAX`. Omitted means
   * `SKIRMISH_ARMIES_DEFAULT`, which is every fixture but `atoll`.
   *
   * ON THE PLAN FOR EXACTLY THE REASON `sea` IS. The generator reserves one
   * levelled shelf per army and does it at Phase.Command order 40, long before
   * `game.scenario` runs — and `plannedScenario()` is the only thing that early
   * which knows anything about this boot. The LOBBY's channel is
   * `setPlannedArmies`, and it is deliberately separate: a `?shot=` boot never
   * runs the lobby, so a fixture that needs four openings has no other way to
   * say so and would otherwise be photographed on a map with two shelves
   * reserved and two islands left ungraded.
   */
  armies?: number;
  summary: string;
  /**
   * `start` is only meaningful to `skirmish`. Every other plan is a posed
   * fixture that `tools/shoot.mjs` photographs and is pre-built BY DEFINITION,
   * so they all declare the three-parameter signature and simply never see it.
   */
  build(b: ScenarioBuilder, cx: number, cz: number, start: StartCondition): void;
}

/**
 * Every `?shot=` the harness knows about.
 *
 * `distance` mirrors the value `tools/shoot.mjs` poses with, so the composition
 * is authored for the frame it will actually be photographed in — a base laid
 * out for a 40 m frame and shot at 62 m reads as a model village on an empty
 * table, which is scorecard failure R3.
 */
/**
 * Build the base an army actually deserves, in the layout language of its own
 * faction, for whoever owns that slot.
 *
 * The LAYOUT is the faction's architectural character (bible §5.7: the Allied
 * base reads as a laid-out airfield, the Soviet one as a sprawl) and the
 * CONTENT is remapped per owner by `ScenarioBuilder.keyFor`. Splitting the two
 * is what lets a mirror match and a third faction work at all: before this, the
 * skirmish plan called `buildAlliedBase` and `buildSovietBase` with no owner,
 * they each searched the player table for their faction, and a Soviet-vs-Soviet
 * lobby handed both bases to the same player while a Meridian player got none.
 *
 * The Pact takes the Allied layout: corbelled ceramic is engineered and
 * orthogonal, which is the Allied grid, not the Soviet sprawl.
 */
export function buildBaseFor(
  b: ScenarioBuilder, owner: PlayerId, cx: number, cz: number, options: BaseOptions,
): EntityId {
  const faction = b.world.player(owner).faction;
  const opts = { ...options, owner };
  return faction === Faction.Soviets
    ? buildSovietBase(b, cx, cz, opts)
    : buildAlliedBase(b, cx, cz, opts);
}

/**
 * ONE CONSTRUCTION VEHICLE AND AN ESCORT. The real opening.
 *
 * The MCV is placed on the start spot itself — the centre of the shelf the
 * generator levelled — and the escort forms up between it and the enemy, which
 * is both the correct screen and the reading a player expects when the camera
 * lands. Nothing else is spawned: no power, no refinery, no harvester. The first
 * harvester arrives with the first refinery, exactly as it does for a human, and
 * the whole economic ramp has to be earned.
 *
 * Returns the construction vehicle, or NONE if the store was full.
 */
/**
 * Metres of ground reserved around the deployer so its base can actually open.
 *
 * REPORTED TWICE. "You spawned me in a place i cannot build" and then, with a
 * screenshot, "im surrounded by rocks everywhere, i cant build at all."
 *
 * THE CAUSE WAS NOT THE TERRAIN AND NOT THE ROTATION. `ScenarioBuilder` has a
 * reservation list — `block()` / `isBlocked()` — and `scatter()` honours it. But
 * only THREE things ever reserved anything: `spawnBuilding`, `spawnWreck`, and
 * scatter against itself. `spawnUnit` and `formation` reserve NOTHING. While
 * matches opened from a pre-built base that was invisible, because the base's
 * own footprints reserved the ground. Opening from an MCV replaced those
 * buildings with units, and units do not reserve — so `b.scatter(..., 140)` on
 * the line below was free to drop nav-blocking props straight onto the one
 * square the match cannot start without.
 *
 * Measured over 40 seeds x 2 armies per map preset, the share of armies whose
 * deploy footprint was fouled by a nav-blocking prop:
 *
 *     arid 48%   coast 39%   snow 29%   urban 9%   tropical 9%   temperate 6%
 *
 * `arid` and `coast` put `rock` at index 0 of their prop list and the pick is
 * weighted richest-first, so half their props are the 2 m nav blocker; `snow`
 * adds `boulder` at 3.2 m. A refused deploy means no Construction Yard, which
 * means no build radius exists at all, which means EVERY placement fails
 * `OutOfRange` — "i cant build at all" was the literal truth, not hyperbole.
 *
 * THE NUMBER. A deployer's yard is 3x3 cells = 12x12 m, whose half-DIAGONAL is
 * 8.49 m — the corner is the worst case against a circular reservation. Add the
 * largest blocking prop `scatter` can produce: `boulder` is 3.2 m authored, and
 * scatter spawns at `scale: rng.range(0.8, 1.35)`, so 4.32 m. That is what a
 * prop CENTRED outside the circle can still reach inward, because `isBlocked`
 * tests centres, not discs. 8.49 + 4.32 = 12.81, so 13.
 *
 * That 1.35 scale is why this is 13 and not 12. 12 was the first number here,
 * and an empirical sweep of 480 openings across six presets found zero fouled
 * deploy sites with it — the worst case simply never came up. The derived bound
 * in `tests/start-clearance.spec.ts` failed it immediately. A measurement that
 * happens to pass is not the same as a bound that cannot fail.
 *
 * That test also asserts the constant still covers the largest deployer
 * footprint in the def tables, so a faction that later fields a 4x4 yard fails a
 * test instead of quietly reintroducing an unplayable opening.
 */
export const START_CLEAR_RADIUS = 13;

/**
 * Reserved around each escort formation's centre.
 *
 * The escort is the other half of the first report — "the tanks are on top of
 * hill ant cant reach me". A boulder dropped into the armour column does not
 * strand it the way terrain does, but it does wedge it, and #40 (vehicles clash
 * and stay stuck forever) is an open defect that this would feed. Sized for the
 * widest formation `startForceFor` produces: 3 columns at 8 m spacing is 16 m
 * across, so 8 m of half-width plus the 4.32 m scaled prop.
 *
 * Deliberately SMALLER than `START_CLEAR_RADIUS`: the escort needs standing room,
 * not a building footprint. Equal or larger would mean one of the two numbers
 * had not actually been thought about.
 */
export const START_ESCORT_CLEAR_RADIUS = 12.5;

export function buildMcvStartFor(b: ScenarioBuilder, owner: PlayerId, spot: StartSpot): EntityId {
  const faction = b.world.player(owner)?.faction ?? Faction.Neutral;
  const force = startForceFor(faction);
  const yaw = spot.facingDeg;
  const rad = yaw * DEG2RAD;
  // Unit vector toward the opposing start, and its left-hand perpendicular.
  const fx = Math.sin(rad);
  const fz = Math.cos(rad);

  const mcv = b.spawnUnit('mcv', owner, spot.x, spot.z, { yawDeg: yaw, stance: Stance.HoldFire });

  // RESERVE THE GROUND. Units do not do this for themselves — see
  // START_CLEAR_RADIUS — and `b.scatter()` runs after every start is built, so
  // reserving here is what keeps 140 props off the opening. This must stay
  // BEFORE the formations so the escort's own reservations cannot be skipped by
  // an early return added later.
  b.block(spot.x, spot.z, START_CLEAR_RADIUS);

  // The screen: infantry ahead of the vehicle, armour ahead of the infantry, all
  // of it between the MCV and whoever is coming.
  if (force.infantry > 0) {
    b.formation('gi', owner, spot.x + fx * 12, spot.z + fz * 12, force.infantry, {
      yawDeg: yaw, spacing: 4.2, columns: Math.min(force.infantry, 3), jitter: 0.6,
    });
    b.block(spot.x + fx * 12, spot.z + fz * 12, START_ESCORT_CLEAR_RADIUS);
  }
  if (force.vehicles > 0) {
    b.formation('grizzly', owner, spot.x + fx * 21, spot.z + fz * 21, force.vehicles, {
      yawDeg: yaw, spacing: 8.0, columns: force.vehicles, jitter: 0.5,
    });
    b.block(spot.x + fx * 21, spot.z + fz * 21, START_ESCORT_CLEAR_RADIUS);
  }
  return mcv;
}

/**
 * The three ore fields, derived from where the armies actually are.
 *
 * One field per army, 44 m off its start on the flank away from the fight, plus
 * a contested patch on the midpoint. Derived rather than hard-coded because the
 * start spots are now derived: an ore field authored as a constant offset from
 * the map centre is an ore field on the wrong side of the map the first time the
 * generator reserves a shelf somewhere else, and a refinery that cannot reach
 * ore is a dead economy in a match that has no second base to fall back on.
 */
export function addStartOre(
  b: ScenarioBuilder, spots: readonly StartSpot[], sea: SeaSpec | null = null,
): void {
  const islands = sea?.islands;
  if (islands !== undefined && islands.length > 0) {
    addIslandOre(b, spots);
    return;
  }

  let midX = 0;
  let midZ = 0;
  for (const s of spots) {
    const rad = s.facingDeg * DEG2RAD;
    const fx = Math.sin(rad);
    const fz = Math.cos(rad);
    // Perpendicular, so the patch sits beside the base rather than on the
    // approach lane both armies are about to fight over.
    b.addOre(s.x + fx * 18 - fz * 44, s.z + fz * 18 + fx * 44, 30);
    midX += s.x;
    midZ += s.z;
  }
  if (spots.length === 0) return;

  /* -- THE CONTESTED PATCH ------------------------------------------------
   * On a continent it goes on the centroid of the openings: the one point
   * every army is equally far from, which is what makes it worth fighting for.
   * The archipelago cannot use that point and takes the branch at the top of
   * this function instead — see `addIslandOre`.
   * --------------------------------------------------------------------- */
  if (spots.length === 0) return;
  b.addOre(midX / spots.length, midZ / spots.length, 22);
}

/* --------------------------------------------------------------------------
 * ORE ON AN ISLAND MAP
 *
 * WHY THIS IS NOT THE CONTINENT FORMULA WITH A DIFFERENT THIRD PATCH, which is
 * what it was. `addStartOre` above puts each home field at a bearing taken from
 * `StartSpot.facingDeg` — "perpendicular to the approach lane" — and on a
 * continent that is exactly right, because there IS one approach lane and the
 * facing names it. On four islands round a rectangle there are three bearings
 * to every other army and the facing names one of them arbitrarily, so the
 * patch lands at a different angle on each island. MEASURED at `oreRichness`
 * 0.80 through the real `OreField.seedField` against the real heightfield:
 * 42 392 / 30 347 / 42 452 / 43 169 credits, a ratio of 0.70. One army opened
 * 28% poorer than its neighbours on a map whose whole premise is that the four
 * openings are interchangeable, and nothing was looking.
 *
 * THE FIX IS TO STOP READING THE FACING. Every position here is a pure radial
 * offset from the ISLAND CENTRE along the line to the map centre, so all four
 * islands are the same layout rotated, and the four totals are equal by
 * construction rather than by luck. `tests/archipelago.spec.ts` measures the
 * spread rather than trusting it.
 *
 * WHICH FACE GETS WHICH. Both faces of an island are coast; the difference is
 * what the water beyond them leads to. The OUTWARD face borders the map rim —
 * a dead end nobody sails through — so the home field goes there, behind the
 * base relative to every threat. The INWARD face borders the lagoon and the
 * shoals, which is the only water anyone crosses, and that is where the
 * expansion goes.
 *
 * AND THE EXPANSION IS THE THING WORTH CROSSING FOR, which is a property of
 * WHERE it sits rather than of what it holds. `BUILD_RADIUS` is 56 m and the
 * opening Construction Yard stands `ISLAND_SEAT_OFFSET` off the island centre
 * ALONG THE COAST, which is why both offsets below are still radial and still
 * mean what they say: 44 m of radius against 30 m of tangent is 53 m from the
 * yard, and 62 m of radius against the same tangent is 69 m. The home field is
 * inside the reach — a refinery, a wall and a defence all go up on turn one —
 * and the expansion is outside it, on the face that borders the lagoon.
 *
 * That is the whole reason the seat is TANGENTIAL. A radial seat of the same
 * size would have moved the yard 30 m along the line both fields sit on, which
 * pushes the home field to 74 m (outside the reach it is defined by) and pulls
 * the expansion to 32 m — a second home field, which is exactly the defect the
 * 52 m expansion offset was replaced for.
 *
 * To hold the expansion you must extend the base TOWARD the beach a landing
 * arrives on, which is the decision the map is made of — and it is a decision
 * rather than a chore because the ground out there is real: measured 21-49%
 * buildable in the 60-80 m band and 68-80% in 80-90 m, i.e. patchy sand you
 * have to site around rather than either a parade square or a cliff.
 *
 * AN EARLIER DRAFT OF THIS BLOCK CLAIMED THE EXPANSION SAT WHERE NO STRUCTURE
 * COULD STAND, and it was true when it was written: the island was a mesa with
 * a 0.45 skirt and buildable ground stopped at ~62 m. Levelling the island
 * shelf to tier 0 — which is what gave the map a coast a naval yard can stand
 * on at all, see `levelStartAreas` in `src/world/terrain-gen.ts` — turned that
 * skirt into a beach and made the claim false in the same wave that made it.
 * `tests/sunder-atoll.spec.ts` caught it, which is the only reason it is not
 * still written here as though it were so.
 *
 * THE OFFSETS, and each is bounded on both sides:
 *   home 44 m, r30      Outer rim at 74 m, inside a 98 m short axis, so the
 *                       whole patch clears the waterline at the worst of the
 *                       8 m coastal wander. Inner rim 14 m from the start, so
 *                       a refinery placed against the yard reaches it, and the
 *                       CENTRE is inside `BUILD_RADIUS`. Measured 27 081-28 508
 *                       credits, a 5% spread over the four.
 *   expansion 62 m, r22 Six metres outside `BUILD_RADIUS`, which is a margin
 *                       rather than a rounding — the 52 m this replaced was
 *                       INSIDE it, despite a comment claiming otherwise, which
 *                       made it a second home field.
 *
 * WHY 62 AND NOT FURTHER OUT. Swept against the real seeder at 60 through 72 m,
 * the per-island TOTAL balance falls as the patch moves seaward, because the
 * 60-80 m ring is the patchiest passable ground an island has — it is where the
 * levelled shelf's apron meets the natural landform. 60 m balances best and
 * clears the build radius by a single cell, which is not a margin; 62 m is the
 * nearest offset that clears it by a real one.
 *
 * WHAT SHIPS, on `sunder-atoll`'s pinned seed and biome, through the real
 * seeder and the real heightfield:
 *
 *     island        home      expansion    total
 *     (118, 390)    28 304    14 161       42 465
 *     (394, 122)    27 081    14 094       41 175
 *     (394, 390)    28 508    13 300       41 808
 *     (118, 122)    28 081    14 723       42 804
 *
 * 168 252 credits on the map, ~42 000 an army, ratio 0.962. What is left is the
 * per-cell hash jitter `ORE_CELL_JITTER` puts on every field in the game, and
 * it is what a symmetric layout is supposed to look like.
 * -------------------------------------------------------------------------- */

/** Metres from an island centre to its home field, along the outward radius. */
const ISLAND_ORE_HOME = 44;
/**
 * Metres from an island centre to its expansion, along the inward radius.
 * Six metres outside `BUILD_RADIUS` — see the block above for the sweep.
 */
const ISLAND_ORE_EXPANSION = 62;

/**
 * The unit vector from the map centre to a start, i.e. "outward". Zero-safe:
 * a start exactly on the centre has no outward direction, and an archipelago
 * never seats one there, but a NaN here would seed ore at NaN and the field
 * would silently be empty.
 */
function outwardFrom(x: number, z: number, out: { x: number; z: number }): void {
  const dx = x - MAP_SIZE * 0.5;
  const dz = z - MAP_SIZE * 0.5;
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-3)) { out.x = 0; out.z = -1; return; }
  out.x = dx / len;
  out.z = dz / len;
}

const outward = { x: 0, z: 0 };

function addIslandOre(b: ScenarioBuilder, spots: readonly StartSpot[]): void {
  for (const s of spots) {
    outwardFrom(s.x, s.z, outward);
    b.addOre(
      s.x + outward.x * ISLAND_ORE_HOME, s.z + outward.z * ISLAND_ORE_HOME, 30,
    );
    b.addOre(
      s.x - outward.x * ISLAND_ORE_EXPANSION, s.z - outward.z * ISLAND_ORE_EXPANSION, 22,
    );
  }
}

/* --------------------------------------------------------------------------
 * WHERE THE ARMY ACTUALLY STANDS ON AN ISLAND
 *
 * REPORTED AS "AI ISN'T BUILDING ANY NAVY", and it was not the brain. Measured
 * on the shipped `sunder-atoll` seed through the real generator and the real
 * `evaluatePlacement`, with the opening base standing on the island centre:
 *
 *     army   coastal 3x3 sites   sites in the build radius   BOTH   nearest
 *     p0             532                   448                 0      72 m
 *     p1             532                   442                 0      76 m
 *     p2             532                   430                 0      79 m
 *     p3             532                   468                 1      61 m
 *
 * 532 places to put a dock and, for three armies out of four, NOT ONE of them
 * inside the envelope a Construction Yard opens with. The nearest coastal site
 * is 72-79 m out against a 56 m `BUILD_RADIUS` (62 m once the yard's own radius
 * is counted), so on turn one three of the four armies on a map whose entire
 * premise is the sea COULD NOT FOUND A DOCK — and neither could the human, who
 * has the identical envelope. Every naval test was green: the map really does
 * offer 532 sites, `evaluatePlacement` really does accept them, and nothing was
 * asking whether an opening base could reach one.
 *
 * SO THE FIX IS IN THE MAP AND NOT IN THE BRAIN. The AI's coast creep — buy a
 * power plant, place it seaward, repeat — was written to walk that 20 m gap and
 * it is a workaround for a start position, not a strategy: it costs 800 credits
 * a step, it is bounded by `AI_NAVAL.coastReachTicks`, and the human's version
 * of it is the same twenty minutes of busywork before the map's own content
 * becomes reachable.
 *
 * THE ISLAND GEOMETRY DOES NOT MOVE, and that is not a preference. Rotating or
 * reshaping an island needs `sin`/`cos`, which ECMA-262 does not pin to bit
 * precision, and terrain generates independently on both machines of a lockstep
 * match — see the block above `ARCHIPELAGO_SEA`. This moves a START POINT,
 * which is arithmetic the generator never sees: `startPointsFor` still reserves
 * every shelf at the island centre, so the heightfield is byte-identical.
 * -------------------------------------------------------------------------- */

/**
 * Metres the opening is seated off its island centre, along the coast.
 *
 * THIRTY, AND IT IS A MEASUREMENT. The gap to close is 20-23 m (the table
 * above), the coastal ring wanders 8 m with `wavinessMetres`, and the seat has
 * to clear the worst of that wander in whatever direction it happens to point
 * rather than in the best one. Swept through the real generator and the real
 * `evaluatePlacement`, counting legal 3x3 dock sites inside each army's own
 * build radius:
 *
 *     offset    p0   p1   p2   p3    nearest legal site
 *      0 m       0    0    0    1    72 / 76 / 79 / 61 m
 *     24 m      32   21   16   10    54 / 54 / 57 / 54 m
 *     30 m      54   34   35   25    48 / 48 / 52 / 53 m
 *     36 m      63   40   51   28    43 / 43 / 47 / 49 m
 *
 * 24 m works and leaves one bad seed between the map and no dock at all; 36 m
 * pushes the far edge of the opening layout past `TERRAIN_START_FLAT_RADIUS`
 * (58 m, against ~25 m of base half-width), which is the levelled ground the
 * shelf actually guarantees. 30 m is the middle with both margins intact, and
 * `tests/ai-naval-yard.spec.ts` re-measures it rather than trusting this table.
 */
export const ISLAND_SEAT_OFFSET = 30;

/**
 * Where each army stands, given the spots `startSpots` chose.
 *
 * A NO-OP ON EVERY MAP THAT IS NOT AN ARCHIPELAGO, so nothing on a continent
 * moves by a millimetre.
 *
 * THE SPOT AND THE SEAT ARE DIFFERENT THINGS and this is the split: the SPOT is
 * the island — it is what the generator levels a shelf at, what both ore fields
 * are measured from, and what `startSpots` must keep answering, since an island
 * is a place and not a base. The SEAT is where that army's Construction Yard
 * lands on it. Folding the offset into `startSpots` instead would move the
 * shelf reservation with it, and `TerrainFields.resolveStarts` would push it
 * straight back: an island start already sits at the maximum inland distance
 * its radius allows, so any offset it is given is spent and then undone.
 *
 * TANGENTIAL, NOT SEAWARD, and the ore block above is the reason — a radial
 * seat trades a dock for a broken ore layout. The direction is `outward` turned
 * a quarter turn, which is a swap and a sign flip and therefore EXACT: a
 * bearing in degrees through `sin`/`cos` would be the one thing this file is
 * not allowed to introduce. All four turn the same way, so the four openings
 * stay one layout rotated four times and the ore stays balanced by
 * construction.
 */
export function islandSeats(
  spots: readonly StartSpot[], sea: SeaSpec | null,
): readonly StartSpot[] {
  const islands = sea?.islands;
  if (islands === undefined || islands.length === 0) return spots;
  const out: StartSpot[] = [];
  for (const s of spots) {
    outwardFrom(s.x, s.z, outward);
    out.push({
      x: clampWorld(s.x - outward.z * ISLAND_SEAT_OFFSET, 4),
      z: clampWorld(s.z + outward.x * ISLAND_SEAT_OFFSET, 4),
      facingDeg: s.facingDeg,
    });
  }
  return out;
}

/* --------------------------------------------------------------------------
 * THE CIVILIAN HAMLETS
 *
 * Metres off the midpoint of the lane between the two openings, along its
 * PERPENDICULAR BISECTOR. That line is the only locus on the map where a point
 * is exactly as far from one army as from the other, so a hamlet placed on it
 * is a symmetric proposition however the generator nudged the starts — which
 * is the whole reason the geometry is derived here rather than authored as a
 * constant offset from the map centre. (`addStartOre` above learned the same
 * lesson: an ore field authored as a constant is an ore field on the wrong
 * side of the map the first time a shelf moves.)
 *
 * 62 m, and the number is bounded on three sides:
 *   - `addStartOre` puts the contested patch ON the midpoint at radius 22, so
 *     anything inside ~30 m would stand a building in ore a harvester is
 *     actively mining.
 *   - The openings are ~193 m apart, so a hamlet on the bisector at 62 m is
 *     ~115 m from each start: outside `START_CLEAR_RADIUS`, outside a base's
 *     build radius, and outside the sight of anything standing in either one.
 *   - The map is 512 m and the midpoint is near its centre, so 62 m either way
 *     is comfortably on the map whatever `nudgeToBuildable` did.
 *
 * TWO OF THEM, mirrored. One hamlet on one flank is a race that the army whose
 * ore field happens to lie that way simply wins; two is a decision — you cannot
 * hold both and neither can they.
 * -------------------------------------------------------------------------- */
export const CIVILIAN_HAMLET_OFFSET = 62;

/* --------------------------------------------------------------------------
 * THE ORE MINES — SAME LINE, FURTHER OUT
 *
 * Reported as "lets spawn small amount of coal / ore / money mines around the
 * map, conquering with troops make us get income". `src/data/Civilians.ts`
 * carries the rate (5 credits a second, a third of a derrick, derived against
 * the MEASURED harvester rather than the config's intended one); this is where
 * they stand.
 *
 * THE SAME BISECTOR, AND THAT IS NOT LAZINESS. The block above proves the
 * perpendicular bisector is the ONLY locus on a two-army map where a point is
 * exactly as far from one army as from the other, so it is the only line a
 * neutral prize can sit on without shipping as a gift to whoever spawned
 * nearest. It is a LINE, not a point — every metre of it has that property —
 * so the mines take the far end of the two arms the hamlets take the near end
 * of, and the map gains two more objectives without gaining an unfair one.
 *
 * 128 M, and the bounds are these:
 *   - The hamlets occupy 45-79 m along each arm (`put(...)` offsets the two
 *     garrisonable blocks +/-17 m about the 62 m centre). 128 clears the far
 *     one by 49 m, so a squad holding a mine is well outside the hamlet's
 *     crossfire and the two are separate decisions rather than one position.
 *   - 128 m along the bisector from a midpoint that is ~96 m from each opening
 *     puts a mine sqrt(96^2 + 128^2) = 160 m from BOTH armies, against the
 *     hamlet's 115 m. It is the furthest thing on the map worth walking to,
 *     which is the trade being sold: a third of a derrick's rate for more than
 *     a third again of the walk.
 *   - The midpoint is near the map centre on a 512 m map, so 128 m either way
 *     is ~90 m per axis on the shipped diagonal and comfortably inside the rim.
 *
 * THE FALLBACKS ARE FOR WATER, NOT FOR TIDINESS. `spawnBuilding` relocates off
 * ground another structure already holds, but ground `isBuildable` REFUSES it
 * only counts and names — see the asymmetry documented at that call site — so a
 * mine authored into the sea on `contested-strait` would stand there, in the
 * water, and the connectivity report would mention it in a line nobody reads.
 * Measured on that map's sea half-plane, one of the two arms lands wet. So the
 * offset walks INWARD along its own arm, in a fixed order, and takes the first
 * footprint the placement rule would accept; if none of the three does, the map
 * gets one mine instead of two rather than a drowned one.
 */
const MINE_BISECTOR_OFFSETS: readonly number[] = [128, 112, 96];

/**
 * Drop the neutral structures both finished mechanics have had nothing to
 * point at. Deterministic from the seed: every position below is pure
 * arithmetic over `spots`, which are themselves derived from the seed, and not
 * one draw of `b.rng` happens here.
 *
 * OWNED BY GAIA, which is what makes them work at all. `b.gaia` is the
 * `Faction.Neutral` player allied to everyone, so `CaptureService` sees a
 * neutral owner and captures outright at any health (rule 1), `GarrisonService`
 * sees one and lets any army walk in, and `restoreOwner` has a neutral
 * caretaker to hand the building back to when the last man leaves.
 */
export function addCivilians(b: ScenarioBuilder, spots: readonly StartSpot[]): void {
  /*
   * TWO OPENINGS EXACTLY, and that is a statement about the composition rather
   * than a limitation of the code. Everything below is derived from the LANE
   * between two armies — the midpoint, its perpendicular bisector, "you cannot
   * hold both and neither can they". With four openings there is no single
   * lane: the bisector of spots 0 and 1 passes within 37 m of spots 2 and 3, so
   * the same arithmetic drops a capturable derrick inside somebody's build
   * radius. On an archipelago it drops it in the sea.
   *
   * A four-army hamlet layout is a real composition and it is not authored yet.
   * A skipped one is a map with less neutral furniture; a wrong one is a free
   * derrick for whoever spawned nearest it.
   *
   * THE ARCHIPELAGO WAS TRIED AND REJECTED, which is worth recording because
   * the idea is an obvious one. An oil derrick per island, on the cape facing
   * the lagoon, looks like the perfect answer to "give the map something worth
   * crossing for": 15 credits a second, captured outright at any health because
   * it is neutral-owned, and reverting the moment the last man leaves.
   *
   * IT FAILS ON THE ONE THING THIS MAP HAS NONE OF: neutral land. Every square
   * metre above the waterline belongs to exactly one of four islands, each of
   * which is one army's whole territory. A derrick is therefore either inside
   * somebody's `BUILD_RADIUS`, where it is free income they can wall in, or out
   * near their beach, where it is still on their island and 76 m from their
   * yard. There is no position on this map that is equally far from four
   * armies and dry — the one point that is, the map centre, is the shoal bank.
   * A prize that ships as a gift to its host is worse than no prize.
   *
   * (The first attempt also put all four on ground `isBuildable` refuses, since
   * `spawnBuilding` does not test it and reported success anyway. That is fixed
   * by the tier-0 island shelf now, so it is not the reason — the paragraph
   * above is.)
   *
   * `addIslandOre` carries the contested objective instead: the expansion field
   * is outside the opening base's reach, on the face every crossing arrives at.
   */
  if (spots.length !== 2 || b.archipelago) return;
  const first = spots[0]!;
  const second = spots[1]!;
  const mx = (first.x + second.x) * 0.5;
  const mz = (first.z + second.z) * 0.5;
  const dx = second.x - first.x;
  const dz = second.z - first.z;
  const len = Math.hypot(dx, dz) || 1;
  // `v` runs down the lane between the two openings; `u` is its left normal.
  const vx = dx / len, vz = dz / len;
  const ux = -vz, uz = vx;

  const owner = b.gaia;
  for (const side of [1, -1]) {
    const hx = mx + ux * side * CIVILIAN_HAMLET_OFFSET;
    const hz = mz + uz * side * CIVILIAN_HAMLET_OFFSET;
    // Every building in a hamlet faces the lane, so the settlement reads as
    // one place rather than three objects that happen to be near each other.
    const face = Math.atan2(-ux * side, -uz * side) / DEG2RAD;
    const put = (key: string, du: number, dv: number, turn: number): void => {
      b.spawnBuilding(
        key, owner,
        hx + ux * side * du + vx * dv,
        hz + uz * side * du + vz * dv,
        { yawDeg: wrapDeg(face + turn) },
      );
    };
    // The derrick on the crossroads itself and the two garrisonable blocks
    // flanking it, ~23 m out — far enough that a 3x2 hospital and a 2x3 block
    // cannot contest each other's cells, close enough that one squad holding
    // the derrick is inside the other two's field of fire.
    put(CIVILIAN_KEYS[0]!, 0, 0, 0);
    put(CIVILIAN_KEYS[1]!, -17, 15, 90);
    put(CIVILIAN_KEYS[2]!, 17, -15, -90);

    // THE MINE, at the far end of the same arm. See `MINE_BISECTOR_OFFSETS`
    // for the geometry and `src/data/Civilians.ts` for what it pays.
    //
    // The footprint is asked for by NAME rather than assumed 2x2, because the
    // whole point of `CIVILIAN_DIMENSIONS` is that four tables read one
    // constant — a hard-coded 2 here would be a fifth opinion about the size of
    // this building, and the one nothing checks.
    const mineDim = CIV[CIVILIAN_KEYS[3]!]!;
    for (const reach of MINE_BISECTOR_OFFSETS) {
      const du = reach - CIVILIAN_HAMLET_OFFSET;
      const mxp = hx + ux * side * du;
      const mzp = hz + uz * side * du;
      if (!b.footprintBuildable(mxp, mzp, mineDim.w, mineDim.h)) continue;
      b.spawnBuilding(CIVILIAN_KEYS[3]!, owner, mxp, mzp, { yawDeg: wrapDeg(face) });
      break;
    }
  }
}

/* --------------------------------------------------------------------------
 * THE NAVAL SHORELINE
 *
 * One declaration, read twice: `PLANS.naval.sea` hands it to the terrain
 * generator before the map exists, and `buildNaval` re-states the same line
 * through `b.setShore` so `ScenarioSpec.shore` agrees with the ground. The two
 * are checked against each other in `buildScenario`.
 *
 * WHY THESE NUMBERS
 *   origin      (cx + 4, cz + 4) with cx = cz = MAP_SIZE / 2, matching
 *               `buildNaval`. Water is the half-plane x + z < 520: the far
 *               three-quarters of a 34-degree yawed frame. The naval yard, the
 *               pillbox and the whole scatter box are on the +sum side, so the
 *               composition was already authored correctly around a shoreline
 *               that simply never got carved.
 *   depth 8.0   WATER_LEVEL (2.0) minus TERRAIN_SEA_FLOOR (-6), i.e. the whole
 *               range the engine can now express.
 *
 *               This read 2.0 until 2026-08-06, with the rationale "the
 *               heightfield floor is TERRAIN_MIN_HEIGHT (0) and WATER_LEVEL is
 *               2.0, so 2.0 m is the deepest water this engine can express".
 *               The arithmetic was right and the premise was wrong twice over:
 *               TERRAIN_MIN_HEIGHT has no code readers at all, and the actual
 *               floor was a literal 0 in `carveSea` that only ever applied to
 *               cells the scenario had already declared to be sea. Capping the
 *               bed at y=0 meant `exp(-depth*absorb)` never got far from 1, so
 *               the fixture rendered as sunlit seabed through a transparent
 *               sheet — a warm white glare — and `Water.fitRamp` spent every
 *               frame clamped to `rampDepthMin`. The absorption gradient this
 *               caption promises had never once run outside its fallback.
 *   shelf 34    Metres offshore to reach full depth. `visibleGround(55)` is
 *               ~89 m wide by 55 m deep, so 34 m spends the gradient across
 *               the part of the sea that is actually in the frame instead of
 *               hitting the floor in the first two metres.
 *   waviness 6  The waterline wanders +/-6 m on a 46 m wavelength. A ruler
 *               straight coast reads as a clipping plane, and the foam band
 *               needs something to break against (which is also why
 *               `buildNaval` scatters rocks along the line).
 * -------------------------------------------------------------------------- */

export const NAVAL_SEA: SeaSpec = {
  x: MAP_SIZE * 0.5 + 4,
  z: MAP_SIZE * 0.5 + 4,
  normalX: -Math.SQRT1_2,
  normalZ: -Math.SQRT1_2,
  bandWidth: 7,
  depth: 8.0,
  shelfMetres: 34,
  wavinessMetres: 6,
  wavelengthMetres: 46,
};

/* --------------------------------------------------------------------------
 * THE SEAS THE PLAYABLE MAPS CARRY
 *
 * THE DEFECT, STATED AS IT WAS MEASURED. `NAVAL_SEA` above had exactly ONE
 * reader — `PLANS.naval`, a `?shot=` fixture that is not a playable match — and
 * every other route through `planScenario` resolved `plan.sea ?? null` to null.
 * Run on the real generator at the pinned `mapSeed` and biome of all six
 * entries in `settings-store.MAPS`:
 *
 *     temperate-valley  0.15% water   largest body   9 cells (144 m2)
 *     airbase-flats     0.00% water   largest body   0 cells
 *     frozen-sector     0.16% water   largest body  14 cells (224 m2)
 *     industrial-grid   0.00% water   largest body   0 cells
 *     contested-strait  0.14% water   largest body   8 cells (128 m2)
 *     coral-shore       0.14% water   largest body  14 cells (224 m2)
 *
 * Those are puddles in a noise basin. `contested-strait` ships with the blurb
 * "A shoreline through the middle. Naval yards earn their cost here" and had 23
 * wet cells spread over ten disconnected bodies. Four naval structures, nine
 * hulls and two unlock chains were unreachable content: nowhere to sail,
 * nowhere to fight, nowhere to put a dock.
 *
 * WHY THIS IS KEYED ON THE MAP PRESET. The line this replaced said `?map=`
 * "cannot conjure or delete a shoreline: the sea is composition, authored with
 * the fleet positions, not a property of the biome table". True of a FIXTURE —
 * `buildNaval` places six hulls against a specific waterline and the two must
 * not drift. Exactly backwards for a PLAYABLE map, where the shoreline IS the
 * map: the player picks "Contested Strait" in the lobby, the lobby writes
 * `?map=coast`, and nothing else in the boot knows enough to say where the
 * water goes. `plan.sea` still wins wherever it is set, so the naval fixture is
 * untouched.
 *
 * WHY THE NORMAL IS EXPLICIT PER START TABLE
 * ------------------------------------------
 * A half-plane hands the whole sea to whichever army it happens to sit nearer,
 * and "nearer" is a projection onto the normal. There is exactly one bearing on
 * which both openings project to the same number: the PERPENDICULAR BISECTOR of
 * the line joining them. On any other, one player's shore is closer to their
 * base than the other's and the naval game is decided by `rotateStarts`.
 *
 * `MAP_START_TABLES` supplies that normal with the coastal openings. Keeping it
 * explicit prevents an unrelated start-table edit from rotating an existing
 * shoreline. Coast and Tropical retain the exact classic normal that shipped
 * before per-map geometry; `tests/naval-maps.spec.ts` pins it to digits.
 *
 * WHY THOSE OFFSETS AND NOT CLOSER
 * --------------------------------
 * `TerrainFields.resolveStarts` slides a start shelf inland whenever it sits
 * within `TERRAIN_START_FLAT_RADIUS + TERRAIN_START_EDGE_WOBBLE + bandWidth +
 * wavinessMetres + TERRAIN_SEA_START_CLEARANCE` of the line. A pushed shelf is
 * the one thing that would change the LAND game: `startSpots` uses the authored
 * offsets while the generator pushes each shelf independently. Every coastal
 * pair therefore clears the full budget before it is offered; the naval and
 * map-table specs assert the shelves did not move rather than assuming it.
 *
 * WHAT THE CHOSEN NUMBERS MEASURE, on the shipped seed and biome of each map:
 *
 *                        water   navigable body   dock sites   biggest patch
 *     contested-strait   24.3%   3622 cells       178          126
 *     coral-shore        26.4%   3952 cells        81           25
 *
 * "navigable body" is the largest 4-connected run of cells the real
 * `FlowFieldCache` will route `MoveClass.Naval` through, and it is 99.8% of all
 * such cells on both maps — one sea, not an archipelago. "dock sites" counts
 * buildable 3x3 footprints from which a Naval Yard's production spiral can
 * reach that sea. The land stayed one region at 100% on both.
 *
 * WHY A GULF AND NOT A STRAIT. A band of water with a causeway would be a
 * second landform primitive and a real risk to `ensureConnectivity`; a gulf
 * both armies border delivers the same thing — open water, a shore each, a dock
 * site each — inside the geometry the generator already has.
 * -------------------------------------------------------------------------- */

/** The shape of one shoreline, with its start-table normal supplied separately. */
interface SeaProfile {
  /**
   * Signed metres from the map centre to the waterline, along the supplied normal.
   * Negative puts the sea on the -normal side. Its magnitude is exactly the dry
   * land every start gets, which is why it is stated this way round.
   */
  readonly offsetMetres: number;
  readonly depth: number;
  readonly shelfMetres: number;
  readonly wavinessMetres: number;
  readonly wavelengthMetres: number;
  readonly bandWidth: number;
}

/** Turn a profile into the world-space half-plane the generator carves. */
function seaOffMapCentre(
  p: SeaProfile, normal: { readonly x: number; readonly z: number },
): SeaSpec {
  const sign = p.offsetMetres < 0 ? -1 : 1;
  return {
    x: MAP_SIZE * 0.5 + normal.x * p.offsetMetres,
    z: MAP_SIZE * 0.5 + normal.z * p.offsetMetres,
    // Points OUT TO SEA, which is away from the map centre on whichever side
    // the offset put the waterline.
    normalX: normal.x * sign,
    normalZ: normal.z * sign,
    bandWidth: p.bandWidth,
    depth: p.depth,
    shelfMetres: p.shelfMetres,
    wavinessMetres: p.wavinessMetres,
    wavelengthMetres: p.wavelengthMetres,
  };
}

/* --------------------------------------------------------------------------
 * THE ARCHIPELAGO — FOUR ARMIES, FOUR ISLANDS, ONE SEA
 *
 * THIS BLOCK USED TO OPEN "NOT REGISTERED IN `MAP_SEAS`, deliberately", on the
 * grounds that the record is keyed on MAP PRESET, that a preset is a lobby
 * entry with a name, a blurb, a pinned `mapSeed` and a biome, and that the
 * preset which selects this geometry was "a separate step with a separate
 * owner". That step has now happened: the preset is `atoll` (see `MAP_PRESETS`
 * in `src/core/config.ts` for why its biome is `temperate`), the lobby entry is
 * `sunder-atoll`, and the registration is at the bottom of `MAP_SEAS` below.
 *
 * That parenthesis read "for why its biome is `desert`" until it was checked
 * against `settings-store.MAPS`, which pins `temperate`. Desert WAS the first
 * choice and it lost, on two FATAL scorecard checks measured on the
 * `13-atoll-crossing` fixture with biome as the only variable: median luminance
 * 0.5228 against a 0.134-0.491 band, emerald leak 0.0411 against 0.000-0.020.
 * Both are the same cause seen twice — a bright sand seabed under 54% water
 * fills the dry half of the frame with sunlit hardpan AND lights the shallows
 * from below, walking the turquoise ramp round into green. The palette that was
 * the best reason to pick desert is what disqualified it.
 * `tests/archipelago.spec.ts` still builds this constant directly, which is the
 * same route `NAVAL_SEA` had for its whole life before `MAP_SEAS` existed.
 *
 * WHY THE ISLANDS ARE THIS BIG, WHICH IS THE ONLY REAL DESIGN CONSTRAINT HERE
 * --------------------------------------------------------------------------
 * A start shelf is a levelled disc of `TERRAIN_START_FLAT_RADIUS` (58 m) whose
 * rim wanders `TERRAIN_START_EDGE_WOBBLE` (14 m) further out, and
 * `TerrainFields.resolveStarts` will slide it inland unless it clears the
 * waterline by `bandWidth + wavinessMetres + TERRAIN_SEA_START_CLEARANCE` on
 * top of that. With this profile that is 58 + 14 + 6 + 8 + 10 = 96 m of dry
 * ground required in EVERY direction from the start — an inscribed circle, not
 * an area. So an island that holds a real base cannot be smaller than ~96 m
 * across its short axis whatever shape it is, and four of them cost
 * 4 * pi * 98^2 = 120 700 m^2 of a 262 144 m^2 map.
 *
 * THAT IS THE CEILING ON HOW WET THIS MAP CAN BE: about 54% water, and it is
 * set by the start guarantee rather than by taste. Making it wetter means
 * shrinking `TERRAIN_START_FLAT_RADIUS`, which is a global promise eleven other
 * things depend on, or seating fewer armies. The measured figure is in
 * `tests/archipelago.spec.ts` and it is the honest number, not a target.
 *
 * WHY THE CHANNELS ARE 72-80 m WIDE AND NOT NARROWER
 * --------------------------------------------------
 * `TERRAIN_RAMP_MAX_LINK_CELLS` is 13, and `linkRegion` — the bounded corridor
 * carver — does not test water. `ensureMajorRegions` runs AFTER the last
 * `carveSea`, so a corridor raised there is never cut back out: a strait under
 * 13 cells (52 m) could be quietly causewayed and the archipelago would ship as
 * a continent. The generator now refuses that link outright on an island map,
 * but the geometry is chosen so it would not have found one anyway — 18 cells
 * of channel, 14 at the worst of the 8 m coastal wander, both sides. Two
 * independent reasons for the same invariant, which is what you want for one
 * that fails silently.
 *
 * WHY THE SHOALS ARE IN THE MIDDLE
 * --------------------------------
 * Four islands round a rim leaves a 190 m lagoon nobody has a reason to enter.
 * The central bank is 0.7 m deep against 7 m of open water, which through
 * `Water.fitRamp`'s absorption gradient is a different colour rather than a
 * different mesh — no reflection, no second material, nothing
 * `docs/RA3_LOOK_BIBLE.md` bans. The two channel bars do the same job for the
 * north and south straits, so the two east-west lanes stay the fast water and
 * the two north-south ones are shallow, exposed and slow. Navigable
 * throughout: `TERRAIN_SEA_SHOAL_MIN_DEPTH` keeps every bar under the surface.
 * -------------------------------------------------------------------------- */

/** Metres from the map centre to each island centre, per axis. */
const ARCHIPELAGO_OFFSET_X = 138;
const ARCHIPELAGO_OFFSET_Z = 134;
/**
 * Island semi-axis, metres. Must exceed the shelf-push budget of
 * `ARCHIPELAGO_SEA` (96 m) or `resolveStarts` slides the start off centre and
 * `startSpots` — which reads the island centre — stops agreeing with it.
 * `tests/archipelago.spec.ts` asserts the margin rather than trusting it.
 */
const ARCHIPELAGO_RADIUS = 98;

/** The four islands, at the corners of a rectangle on the map's own diagonal. */
const ARCHIPELAGO_ISLANDS: readonly SeaIsland[] = [
  { dx: -ARCHIPELAGO_OFFSET_X, dz: ARCHIPELAGO_OFFSET_Z },
  { dx: ARCHIPELAGO_OFFSET_X, dz: -ARCHIPELAGO_OFFSET_Z },
  { dx: ARCHIPELAGO_OFFSET_X, dz: ARCHIPELAGO_OFFSET_Z },
  { dx: -ARCHIPELAGO_OFFSET_X, dz: -ARCHIPELAGO_OFFSET_Z },
].map((o) => ({
  x: MAP_SIZE * 0.5 + o.dx,
  z: MAP_SIZE * 0.5 + o.dz,
  radiusX: ARCHIPELAGO_RADIUS,
  radiusZ: ARCHIPELAGO_RADIUS,
}));

/**
 * A four-island sea, ready for a preset to name.
 *
 * `x`/`z` and the normal carry no geometry here — `islands` being non-empty is
 * what tells the generator to ignore the half-plane — but they are required
 * fields that `isTerrainJob` validates, so they are filled with the map centre
 * and the classic diagonal normal: the axis the shoal chain straddles, and the honest
 * answer if anything ever publishes this as a nominal `ShoreSpec`.
 */
export const ARCHIPELAGO_SEA: SeaSpec = {
  x: MAP_SIZE * 0.5,
  z: MAP_SIZE * 0.5,
  normalX: CLASSIC_SEA_NORMAL.x,
  normalZ: CLASSIC_SEA_NORMAL.z,
  bandWidth: 6,
  // 7.0 leaves the bed at -5.0, a metre clear of TERRAIN_SEA_FLOOR, so nothing
  // is clamped and the shoals have a deep floor to stand out against.
  depth: 7.0,
  // Half the narrowest channel (72 m), so mid-strait is the deepest water and
  // the bed is still ramping at both coasts rather than sitting on the floor.
  shelfMetres: 36,
  // Eight metres of wander on a 54 m feature. An island coast shows its own
  // curvature the way a straight one showed its straightness, and this is what
  // stops four ellipses reading as four stencils.
  wavinessMetres: 8,
  wavelengthMetres: 54,
  islands: ARCHIPELAGO_ISLANDS,
  shoals: [
    // The bank. Fits inside the 94 m radius of open water the four islands
    // leave around the map centre.
    { x: MAP_SIZE * 0.5, z: MAP_SIZE * 0.5, radiusX: 88, radiusZ: 84, depth: 0.7 },
    // The two channel bars, in the north and south straits.
    {
      x: MAP_SIZE * 0.5, z: MAP_SIZE * 0.5 - ARCHIPELAGO_OFFSET_Z,
      radiusX: 44, radiusZ: 28, depth: 1.1,
    },
    {
      x: MAP_SIZE * 0.5, z: MAP_SIZE * 0.5 + ARCHIPELAGO_OFFSET_Z,
      radiusX: 44, radiusZ: 28, depth: 1.1,
    },
  ],
};

/**
 * Sea per MAP PRESET key, for the presets whose whole identity is the water.
 * Absent means landlocked, which is every other preset.
 */
export const MAP_SEAS: Record<string, SeaSpec> = {
  /**
   * Contested Strait. The sea is the quarter of the map on the far side of the
   * bisector, 112 m from every opening — 14 m clear of the 98 m shelf-push
   * budget its own `bandWidth` and `wavinessMetres` set.
   *
   * `depth` is the full 8.0 m the heightfield can express (WATER_LEVEL 2.0 down
   * to TERRAIN_SEA_FLOOR -6), so `Water.fitRamp` gets a real absorption
   * gradient rather than the shallow fallback the fixture spent years in.
   *
   * 9 m of wander on a 64 m feature: bigger than the fixture's 6/46 because a
   * shoreline this long shows its own straightness in a way a 90 m one does
   * not, and a ruler-straight coast reads as a clipping plane.
   */
  coast: seaOffMapCentre({
    offsetMetres: -112,
    depth: 8.0,
    // Wider than the fixture's 34: this coast is looked at from match dolly
    // rather than from a posed 55 m frame, and the bed has 150 m of open water
    // to fall through rather than the corner of one screen.
    shelfMetres: 40,
    wavinessMetres: 9,
    wavelengthMetres: 64,
    bandWidth: 7,
  }, MAP_START_TABLES.coast!.seaNormal!),
  /**
   * Coral Shore. The OPPOSITE side of the same bisector, so the two naval maps
   * are not one map twice, and deliberately SHALLOWER at 5.0 m. Depth is what
   * drives the absorption ramp, so a 5 m lagoon reads turquoise where the
   * strait reads deep blue — the one visual axis these two share that is not
   * the biome. Still far above `TERRAIN_SEA_FLOOR`, so nothing is clamped.
   *
   * MEASURED, NOT PREFERRED: this seed's north-east coast is the rougher of the
   * two, and dock sites move with the offset in a way `coast`'s do not — 100 m
   * out yields 81 buildable-and-launchable footprints, 108 m yields 65, 116 m
   * yields 28. The offset is at the near end of its legal range for that
   * reason, and `wavinessMetres` is 5 rather than 9 to buy the 6 m of
   * shelf-push margin that costs.
   */
  tropical: seaOffMapCentre({
    offsetMetres: 100,
    depth: 5.0,
    // Longer shelf on shallower water: the bed has to spend its 5 m over enough
    // distance that the beach is a beach and not a step.
    shelfMetres: 46,
    wavinessMetres: 5,
    wavelengthMetres: 58,
    bandWidth: 7,
  }, MAP_START_TABLES.tropical!.seaNormal!),
  /**
   * Sunder Atoll. THE ONE ENTRY THAT IS NOT A HALF-PLANE — `islands` being
   * non-empty is what tells the generator to ignore `x`/`z` and the normal
   * entirely, so `seaOffMapCentre` has nothing to contribute here and the spec
   * is referenced whole. Everything about the geometry is argued above
   * `ARCHIPELAGO_SEA`; this line is the registration and nothing else.
   *
   * It is also the only entry whose preset seats FOUR armies, and that is not a
   * property of this table — `startPointsFor` reads `sea.islands` and answers
   * with one start per island, and `MapChoice.players` is what the lobby
   * offers. Both derive from the same list, so neither can drift.
   */
  atoll: ARCHIPELAGO_SEA,
};

const PLANS: Record<string, ScenarioPlan> = {
  skirmish: {
    map: 'temperate', distance: 58, yawDeg: 24, frozen: false, settleTicks: 0,
    // The only scenario that does not put its subject on the map centre, so it
    // is the only one that moves the focus. Superseded by `b.setCameraFocus`
    // below, which knows where slot 0 actually ended up; this stays as the
    // answer for a world with no terrain module at all.
    focusDX: -74, focusDZ: 54,
    summary: 'Armies on the map-authored opening, three ore fields.',
    build(b, cx, cz, start) {
      // Starts on this preset's authored opening, each with its own ore field
      // and a contested patch between them, each turned toward the opposition.
      // `b.armies` is 2 unless a lobby said otherwise.
      const spots = startSpots(cx, cz, b.armies, b.sea, b.seed, b.preset);
      // WHERE THE ISLAND IS, AND WHERE THE ARMY STANDS ON IT — see
      // `islandSeats`. Identical to `spots` on every map that is not an
      // archipelago, and the ORE below keeps reading `spots`: both fields are
      // defined as radii from the island centre and moving them with the seat
      // is what would unbalance them.
      const seats = islandSeats(spots, b.sea);
      const owners: PlayerId[] = rotateStarts(
        // `armySlot` creates a player when the world is short, so a four-army
        // map seats four whatever the boot handed us. It alternates the two
        // original factions past slot 1, which is the right default for a mode
        // with no faction picker yet.
        spots.map((_, i) => b.armySlot(i)),
        b.seed,
      );

      if (start === 'base') {
        for (let i = 0; i < seats.length; i++) {
          // `facingDeg + 180` is the threat axis: a base's defended face looks
          // at the enemy, so the layout is turned away from where it is aimed.
          buildBaseFor(b, owners[i], seats[i].x, seats[i].z, {
            facingDeg: wrapDeg(seats[i].facingDeg + 180),
            balancedDefence: true,
          });
        }
      } else {
        const mine: EntityId[] = [];
        for (let i = 0; i < seats.length; i++) {
          const mcv = buildMcvStartFor(b, owners[i], seats[i]);
          // BY OWNER, NOT BY SPOT INDEX. These two used to be the same thing,
          // because slot 0 was pinned to a fixed corner and the human was
          // always in it. `rotateStarts` broke that equivalence, and this line
          // then handed the player the AI's construction vehicle.
          if (mcv !== NONE && isLocal(b, owners[i])) mine.push(mcv);
        }
        // The local player opens with their construction vehicle already on the
        // cursor. Every RTS does this and it is the difference between "what am
        // I looking at" and "drive here, press deploy".
        b.select(mine);
      }

      addStartOre(b, spots, b.sea);
      // BEFORE `b.scatter` below, because `spawnBuilding` reserves the ground
      // it lands on and `scatter` honours the reservation list. After it, the
      // hamlets would be built into whatever 140 props had already been
      // dropped on them — the same failure `START_CLEAR_RADIUS` documents.
      addCivilians(b, spots);
      // Look at YOUR opening, wherever the generator put it — which since
      // `rotateStarts` is no longer always `spots[0]`, and on an island is the
      // SEAT rather than the island centre: the camera frames the base, and the
      // base is what moved.
      const home = seats[localSlot(b, owners)];
      b.setCameraFocus(home.x, home.z - 8);
      b.scatter({ minX: cx - 120, minZ: cz - 120, maxX: cx + 120, maxZ: cz + 120 }, 140);
    },
  },

  'allied-base': {
    map: 'temperate', distance: 62, yawDeg: 24, frozen: true, settleTicks: 0,
    summary: 'Wide Allied base: yard, refinery on ore, war factory with egress, defended north face.',
    build(b, cx, cz) {
      // The layout's own centre is (+2, 0) local, and 64% of the frame's depth
      // is behind the focus, so the base origin sits 9 m "north" of it.
      buildAlliedBase(b, cx - 1, cz - 7, { facingDeg: 0, garrison: true });
      b.addOre(cx + 52, cz - 6, 24);
      b.scatter({ minX: cx - 74, minZ: cz - 66, maxX: cx + 74, maxZ: cz + 30 }, 120);
    },
  },

  'soviet-base': {
    map: 'arid', distance: 62, yawDeg: 24, frozen: true, settleTicks: 0,
    summary: 'Soviet base: olive slabs, tesla line on the threat axis, armour massed behind it.',
    build(b, cx, cz) {
      buildSovietBase(b, cx - 1, cz - 7, {
        facingDeg: 0, garrison: true, balancedDefence: true,
      });
      b.addOre(cx - 52, cz - 6, 24);
      b.scatter({ minX: cx - 74, minZ: cz - 66, maxX: cx + 74, maxZ: cz + 30 }, 104);
    },
  },

  'meridian-base': {
    map: 'arid', distance: 62, yawDeg: 24, frozen: true, settleTicks: 0,
    summary: 'Meridian Pact base: ceramic-brass industry, teal energy surfaces and a disciplined grid.',
    build(b, cx, cz) {
      const owner = b.ownerForFaction(Faction.Meridian);
      buildBaseFor(b, owner, cx - 1, cz - 7, {
        facingDeg: 0, garrison: true, balancedDefence: true,
      });
      b.addOre(cx + 52, cz - 6, 24);
      b.scatter({ minX: cx - 74, minZ: cz - 66, maxX: cx + 74, maxZ: cz + 30 }, 104);
    },
  },

  'meridian-support': {
    map: 'arid', distance: 44, yawDeg: 24, frozen: true, settleTicks: 0,
    summary: 'Meridian support line: radar, command, technology, repair and naval silhouettes.',
    build(b, cx, cz) {
      const owner = b.ownerForFaction(Faction.Meridian);
      b.spawnBuilding('mrdOculus', owner, cx - 12, cz - 8);
      b.spawnBuilding('mrdPharos', owner, cx, cz - 9);
      b.spawnBuilding('mrdReliquary', owner, cx + 12, cz - 8);
      b.spawnBuilding('mrdDepot', owner, cx - 8, cz + 6);
      b.spawnBuilding('mrdSlipway', owner, cx + 8, cz + 7);
      b.scatter({ minX: cx - 35, minZ: cz - 28, maxX: cx + 35, maxZ: cz + 24 }, 36);
    },
  },

  'meridian-final': {
    map: 'arid', distance: 48, yawDeg: 24, frozen: true, settleTicks: 0,
    summary: 'Meridian final line: storage, articulated beam defence, modular wall and Heliograph.',
    build(b, cx, cz) {
      const owner = b.ownerForFaction(Faction.Meridian);
      b.spawnBuilding('mrdVault', owner, cx - 11, cz - 7);
      b.spawnBuilding('mrdGlaive', owner, cx, cz - 9);
      b.spawnBuilding('mrdHelios', owner, cx + 11, cz - 7);
      for (let i = -2; i <= 2; i++) b.spawnBuilding('mrdRampart', owner, cx + i * 4, cz);
      b.spawnBuilding('mrdHeliograph', owner, cx, cz + 9);
      b.scatter({ minX: cx - 30, minZ: cz - 25, maxX: cx + 30, maxZ: cz + 27 }, 24);
    },
  },

  'reclamation-base': {
    map: 'arid', distance: 62, yawDeg: 24, frozen: true, settleTicks: 0,
    summary: 'Reclamation base: asymmetric scrap industry, violet armor slabs and amber approach marks.',
    build(b, cx, cz) {
      const owner = b.ownerForFaction(Faction.Reclaim);
      buildBaseFor(b, owner, cx - 1, cz - 7, {
        facingDeg: 0, garrison: true, balancedDefence: true,
      });
      b.addOre(cx - 52, cz - 6, 24);
      b.scatter({ minX: cx - 74, minZ: cz - 66, maxX: cx + 74, maxZ: cz + 30 }, 104);
    },
  },

  'terrain-showcase': {
    map: 'urban', distance: 30, yawDeg: 26, frozen: true, settleTicks: 0,
    summary: 'Close ground detail: road junction, kerbs, scatter, one tank for scale.',
    build: buildTerrainShowcase,
  },

  'unit-parade': {
    map: 'arid', distance: 62, yawDeg: 12, frozen: true, settleTicks: 0,
    summary: 'Four-faction vertical slice: line infantry, main armour and vehicle factory.',
    build: buildUnitParade,
  },

  'architecture-showcase': {
    map: 'urban', distance: 140, yawDeg: 0, frozen: true, settleTicks: 0,
    anchor: 'centre',
    armies: SKIRMISH_ARMIES_MAX,
    focusDZ: -40,
    summary: 'Complete four-faction architecture contact sheet, aligned by battlefield role.',
    build: buildArchitectureShowcase,
  },

  'sledge-audit': {
    map: 'arid', distance: 30, yawDeg: 18, frozen: true, settleTicks: 30,
    summary: 'Sledge close geometry and off-axis turret articulation audit.',
    build: buildSledgeAudit,
  },

  battle: {
    map: 'temperate', distance: 48, yawDeg: 26, frozen: false, settleTicks: 120,
    summary: 'Allied and Soviet columns engaging at weapons range, wrecks already burning.',
    build: buildBattle,
  },

  economy: {
    map: 'temperate', distance: 42, yawDeg: 26, frozen: false, settleTicks: 180,
    summary: 'Ore field, four harvesters at every stage of the loop, refinery and silos.',
    build: buildEconomy,
  },

  naval: {
    map: 'coast', distance: 55, yawDeg: 34, frozen: false, settleTicks: 90,
    // THE FIX FOR "08-naval-water photographs ships on grass".
    //
    // `buildNaval` has always declared this same shoreline through
    // `b.setShore`, and for the whole life of this repo nothing read it: the
    // spec published a `ShoreSpec` that had no consumer, `map: 'coast'` never
    // reached the terrain generator (which takes its biome from `?biome=` /
    // TERRAIN_DEFAULT_BIOME and has no `coast` member to take), and
    // `TERRAIN_START_POSITIONS` reserved a guaranteed-DRY 58 m shelf at the
    // exact point the shot frames. The fleet floated at `max(WATER_LEVEL,
    // ground)` — which `SpawnUnitOptions.float` documents as the degraded
    // "ships parked on a field" reading — and that is what was photographed.
    //
    // Declaring it here is what closes the loop. Every number matches
    // `buildNaval`'s own `setShore(cx + 4, cz + 4, -SQRT1_2, -SQRT1_2, 7)`, and
    // `buildScenario` warns if the two ever drift apart.
    sea: NAVAL_SEA,
    // The composition is authored against that world-space shoreline, so it
    // must not follow the start shelf — which the generator now pushes ~100 m
    // inland to keep it out of the water.
    anchor: 'centre',
    summary: 'Shoreline with a naval yard, fleets closing across open water.',
    build: buildNaval,
  },

  placement: {
    map: 'temperate', distance: 36, yawDeg: 24, frozen: true, settleTicks: 0,
    summary: 'A war factory on the cursor over the build grid, inside the yard radius.',
    build: buildPlacement,
  },

  selection: {
    map: 'temperate', distance: 34, yawDeg: 20, frozen: true, settleTicks: 0,
    summary: 'A mixed selection under orders: rings, health bars, chevrons, move markers.',
    build: buildSelection,
  },

  blob: {
    map: 'temperate', distance: 50, yawDeg: 24, frozen: true, settleTicks: 0,
    summary: '36 Allied units massed against 30 Soviets — the readability-under-load frame.',
    build: buildBlob,
  },

  atoll: {
    map: 'atoll', distance: 62, yawDeg: 34, frozen: false, settleTicks: 90,
    /*
     * NO `sea:` HERE, DELIBERATELY, and it is the difference between a fixture's
     * shoreline and a battlefield's.
     *
     * `plan.sea` is the FIXTURE channel: `naval` uses it because `buildNaval`
     * places six hulls against one specific waterline and `assertShoreMatchesSea`
     * fails the pair if they drift. It also carries a `setShore` obligation —
     * and `setShore` publishes a HALF-PLANE, which an archipelago is not and
     * cannot be described as.
     *
     * This map's water IS the map. It comes from `MAP_SEAS.atoll` through
     * `map: 'atoll'` above, exactly as it does when a player picks Sunder Atoll
     * in the lobby, so this fixture photographs the shipped battlefield rather
     * than a private copy of it.
     *
     * `anchor` is left at its default, and setting it would change nothing:
     * `buildScenario` reads `plan.anchor === 'centre' || builder.archipelago`,
     * so an island map is anchored to the map centre either way. That matters
     * here — `startShelf()` on this map is island ZERO, 193 m off centre, and
     * every layout treats (cx, cz) as the middle of the world.
     */
    armies: SKIRMISH_ARMIES_MAX,
    summary: 'An island beach mid-landing: dock, transport ashore, escort over the shoal.',
    build: buildAtoll,
  },

  /**
   * THE CAMPAIGN. One plan, 37 operations, and the variation is a REGISTRY.
   *
   * `map` and `armies` here are the unarmed defaults and are what a headless
   * `buildScenario(world, 'campaign', …)` gets. That call is unreachable from
   * the product — nothing selects this name without arming an operation first —
   * and it exists so the router is TOTAL rather than so anybody uses it. A
   * router with a hole answers a question wrongly instead of loudly.
   *
   * With an operation armed, `planScenario` has already replaced `map`,
   * `armies` and the opening off `PlannedOperation`, and `build` below
   * delegates to whatever `campaign-install.ts` registered.
   */
  campaign: {
    map: 'temperate', distance: 58, yawDeg: 24, frozen: false, settleTicks: 0,
    summary: 'A campaign operation.',
    build(b, cx, cz, start) {
      const layout = campaignLayout;
      if (layout !== null) {
        layout(b, cx, cz, start);
        return;
      }
      // NOTHING REGISTERED. Fall through to the ordinary skirmish build rather
      // than emitting an empty world: a world with no entities looks like a
      // renderer fault and sends the next person to the wrong file entirely.
      console.warn('[scenario] "campaign" built with no layout registered — falling back to skirmish.');
      PLANS.skirmish.build(b, cx, cz, start);
    },
  },
};

/** Resolve a `?shot=` value to a known scenario, warning on a typo. */
export function resolveScenarioName(shot: string | null | undefined): string {
  if (!shot) return SCENARIO_DEFAULT;
  const wanted = normKey(shot);
  for (const name of SCENARIO_NAMES) {
    if (normKey(name) === wanted) return name;
  }
  console.warn(
    `[scenario] unknown ?shot=${shot} — known: ${SCENARIO_NAMES.join(', ')}. Using ${SCENARIO_DEFAULT}.`,
  );
  return SCENARIO_DEFAULT;
}

/**
 * THE NAME THIS BOOT WILL BUILD, and the one place that decides it.
 *
 * `resolveScenarioName` reads `?shot=` and only `?shot=`, which is correct for
 * the harness and leaves the campaign unreachable on the product path — the
 * shell deletes `?shot=` from every match query on purpose, and `main.ts`
 * treats its presence as "this boot is a fixture, not a game".
 *
 * So ARMING AN OPERATION IS THE SELECTION. There is no third flag and no
 * `setPlannedScenarioName`: an armed operation is exactly the state in which
 * the answer should be `'campaign'`, and inventing a second signal that has to
 * agree with the first is how two of them come to disagree.
 *
 * `?shot=` still wins outright when present. A fixture capture must never be
 * talked into building an operation, whatever the lobby left armed.
 */
export function bootScenarioName(shot: string | null | undefined): string {
  if (shot !== null && shot !== undefined && shot !== '') return resolveScenarioName(shot);
  return plannedOp !== null ? 'campaign' : SCENARIO_DEFAULT;
}

/** Resolve a `?map=` value to a known preset, warning on a typo. */
export function resolveMapName(map: string | null | undefined, fallback: string): string {
  if (!map) return fallback;
  const wanted = normKey(map);
  for (const name of Object.keys(MAP_PRESETS)) {
    if (normKey(name) === wanted) return name;
  }
  console.warn(
    `[scenario] unknown ?map=${map} — known: ${Object.keys(MAP_PRESETS).join(', ')}. Using ${fallback}.`,
  );
  return fallback;
}

/* --------------------------------------------------------------------------
 * THE PRE-BUILD PLAN
 *
 * `activeScenario()` only exists once the scenario system has run, and that is
 * deliberately LAST (it needs terrain, defs and models to already be there).
 * But the terrain module has the opposite problem: it must know which biome to
 * generate before anyone can stand on it, which is strictly earlier.
 *
 * So the flag half of the router is separated out here. `plannedScenario()`
 * touches nothing but the URL and the tables in config.ts, is memoised, is safe
 * to call from any module's `init()` at any phase, and is safe outside a
 * browser (it answers with the defaults).
 * -------------------------------------------------------------------------- */

export interface ScenarioPlanSummary {
  /** Resolved scenario name. */
  readonly name: string;
  /** Resolved MAP_PRESETS key — what `?map=` actually selects. */
  readonly map: string;
  /** The preset itself, so a caller does not have to import MAP_PRESETS. */
  readonly preset: MapPreset;
  readonly seed: number;
  readonly distance: number;
  readonly yawDeg: number;
  readonly frozen: boolean;
  readonly settleTicks: number;
  /** The opening this boot will use. Always `'base'` on a `?shot=` fixture. */
  readonly start: StartCondition;
  /**
   * The shoreline the terrain generator must carve, or null for a landlocked
   * map. Read by `src/world/sea.system.ts` before `world.terrain` inits —
   * that ordering is the entire reason this lives on the PLAN and not on the
   * spec. Null for every scenario but `naval`.
   */
  readonly sea: SeaSpec | null;
  /**
   * Armies this boot seats, 2..`SKIRMISH_ARMIES_MAX`.
   *
   * On the PLAN and not on the spec for exactly the reason `sea` is: the
   * generator reserves one levelled shelf per army and it does that at
   * Phase.Command order 40, while `game.scenario` — which knows the world's
   * actual player list — runs at Phase.Cleanup order 10 000. A count read off
   * the world would be six phases too late to shape the ground it stands on.
   */
  readonly armies: number;
}

/* --------------------------------------------------------------------------
 * WHO GETS TO CHOOSE THE OPENING
 *
 * Four sources, in this order, and the order is the whole design:
 *
 *   1. `?ai=off`. Written by exactly one thing: `Shell.bootGame` building the
 *      TITLE-SCREEN BACKDROP, a live match with the opponent switched off and
 *      the camera on rails. A backdrop has to be a battlefield already
 *      standing — slowly orbiting a lone truck on an empty map is not a title
 *      screen — and the same reading is right for any deliberately
 *      opponent-less boot. It is FIRST, above the explicit flag, because the
 *      backdrop inherits the whole query string from the match the player just
 *      quit; if `?start=mcv` outranked it, quitting an MCV match would leave
 *      the menu orbiting an empty field until the player started another one.
 *   2. `?start=` on the URL. The lobby writes it, `tools/` may write it, and a
 *      human may type it. This is the persistent channel: it survives the hard
 *      reload path (`Shell.hardLaunch`) and a `?skipmenu=1` boot, neither of
 *      which runs the lobby screen.
 *   3. `setPlannedStart()` — the lobby's choice pushed straight in, for a shell
 *      that has not written the URL yet.
 *   4. The default: `mcv`. The real game.
 * -------------------------------------------------------------------------- */

let startOverride: StartCondition | null = null;

/**
 * Tell the next boot which opening to build. Called by the skirmish lobby.
 *
 * Deliberately NOT cleared by `resetScenarioPlan()`: the lobby sets this once
 * and the engine is torn down and re-bootstrapped several times around it (menu
 * backdrop, match, rematch), so a per-boot lifetime would lose the choice on the
 * very next thing that happens. Pass `null` to go back to the default.
 */
export function setPlannedStart(start: StartCondition | null): void {
  startOverride = start;
}

/** The lobby's standing choice, or null when it has not made one. */
export function plannedStartOverride(): StartCondition | null {
  return startOverride;
}

let armiesOverride: number | null = null;

/**
 * Tell the next boot how many armies to seat. Called by the skirmish lobby.
 *
 * SAME LIFETIME AS `setPlannedStart`, for the same reason and not by analogy:
 * the engine is torn down and re-bootstrapped several times around one lobby
 * choice (menu backdrop, match, rematch), so a per-boot lifetime would lose it
 * on the very next thing that happens. `resetScenarioPlan()` deliberately does
 * not clear it.
 *
 * THIS IS THE CHANNEL THE TERRAIN READS, which is why it is a module-level
 * override and not a `buildScenario` option. `terrain-plan.plannedTerrainInput`
 * has to know the count LONG before any scenario builds — it runs at
 * module-discovery time to prewarm the generator — and `plannedScenario()` is
 * the only thing available that early. A count delivered any later would
 * reserve two shelves for a four-army match.
 */
export function setPlannedArmies(n: number | null): void {
  armiesOverride = n === null ? null : clampArmies(n);
}

/** The lobby's standing army count, or null when it has not chosen one. */
export function plannedArmyOverride(): number | null {
  return armiesOverride;
}

/**
 * The start points the generator must reserve for THIS boot.
 *
 * `src/world/terrain-plan.ts` calls exactly this and does no derivation of its
 * own. It used to spread `SKIRMISH_START_OFFSETS` itself, which was correct
 * while that table had exactly two entries and became a silent two-extra-shelf
 * regression on every map the moment it had four.
 */
/* -- the campaign's plan ---------------------------------------------------
 *
 * `setPlannedOperation` MIRRORS `setPlannedArmies` EXACTLY, including living
 * outside the `resetScenarioPlan()` memo — the memo is per-boot and this is the
 * lobby's standing choice, so clearing it there would drop the operation on the
 * second boot of a session.
 *
 * It carries only what the PLAN needs: which landform, how many seats, which
 * opening. Everything else about an operation — its triggers, its prose, its
 * objectives — is in the lazy chunk and this file must never see it.
 */
export interface PlannedOperation {
  readonly id: string;
  /** A `MAP_PRESETS` key. */
  readonly preset: string;
  readonly armies: number;
  /**
   * `'force'` means the layout hands out a fixed force and never calls
   * `buildBaseFor`. It resolves to `'base'` as a `StartCondition` because
   * `START_CONDITIONS` is NOT widened — a third member would put a "Fixed
   * force" row in the SKIRMISH lobby, where nothing would ever build the base
   * and the player would get an army with no way to produce. The layout reads
   * its own opening off the operation and ignores the parameter.
   */
  readonly opening: 'mcv' | 'base' | 'force';
}

let plannedOp: PlannedOperation | null = null;

/** Arm an operation for the next boot, or clear it. */
export function setPlannedOperation(op: PlannedOperation | null): void {
  plannedOp = op;
}

/** The armed operation's plan, or null. */
export function plannedOperation(): PlannedOperation | null {
  return plannedOp;
}

/**
 * The build function for the armed operation's layout.
 *
 * A REGISTRY RATHER THAN AN IMPORT, and the reason is the bundle. Layouts live
 * in the lazily-imported campaign chunk; `Scenarios.ts` is reachable from the
 * entry chunk through `scenarios.system.ts`, so importing them here would put
 * every operation's geometry in front of every player's first paint.
 * `campaign-install.ts` sets this before the boot and clears it after.
 */
export type CampaignLayoutFn =
  (b: ScenarioBuilder, cx: number, cz: number, start: StartCondition) => void;

let campaignLayout: CampaignLayoutFn | null = null;

export function setCampaignLayout(fn: CampaignLayoutFn | null): void {
  campaignLayout = fn;
}

export function plannedStartPoints(): readonly { readonly x: number; readonly z: number }[] {
  const plan = plannedScenario();
  // `plan.seed` is the SIM seed and it is knowable here, which the first attempt
  // at this asserted it was not. It is resolved from `?seed=` in the same memo,
  // at the same moment, as `armies` and `sea` — both of which this function
  // already reads off the same object. The lobby writes it before hard-launch,
  // so it is identical on both clients of a lockstep match.
  //
  // It has to reach this function or the whole design comes apart: the shelves
  // reserved here and the bases placed by `startSpots` are two derivations of
  // one answer, and a plan that reserved slots 0/1 while the match seated 2/3
  // would put both armies on unlevelled ground.
  // Campaign layouts are authored against the classic table and derive their
  // own geometry from it. Only the generic skirmish plan opts into per-preset
  // starts; both terrain reservation and spawning make the same choice.
  return startPointsFor(
    plan.armies, plan.sea, plan.seed, plan.name === 'skirmish' ? plan.map : null,
  );
}

/**
 * Rules 1-4 above, with the scenario name left out of it. Both `planScenario`
 * and `buildScenario` resolve through here so a caller that names `skirmish`
 * explicitly gets the same answer as one that arrives through `?shot=`.
 */
function chooseStart(start?: string | null, ai?: string | null): StartCondition {
  if (ai !== null && ai !== undefined && normKey(ai) === 'off') return 'base';
  if (start !== null && start !== undefined && start !== '') return resolveStartCondition(start);
  return startOverride ?? START_CONDITION_DEFAULT;
}

/** `chooseStart` against the live URL. Safe outside a browser. */
function chooseStartFromLocation(): StartCondition {
  if (typeof location === 'undefined') return startOverride ?? START_CONDITION_DEFAULT;
  const q = new URLSearchParams(location.search);
  return chooseStart(q.get('start'), q.get('ai'));
}

/** Resolve the boot flags into a plan without touching the world. */
export function planScenario(
  shot?: string | null,
  map?: string | null,
  seed?: number | null,
  start?: string | null,
  ai?: string | null,
): ScenarioPlanSummary {
  const name = bootScenarioName(shot);
  const plan = PLANS[name] ?? PLANS[SCENARIO_DEFAULT];
  // AN ARMED OPERATION OUTRANKS `?map=` FOR THE CAMPAIGN NAME ONLY. Every other
  // name resolves exactly as it always did, which is what keeps
  // `tests/match-start.spec.ts` and the whole `?shot=` table unmoved.
  const op = name === 'campaign' ? plannedOp : null;
  const mapKey = op !== null ? op.preset : resolveMapName(map, plan.map);

  // A posed fixture is pre-built by definition; nothing may talk it out of that.
  //
  // THE CAMPAIGN IS THE ONE EXCEPTION AND IT IS NARROW ON PURPOSE. `'campaign'`
  // with an armed operation takes the operation's declared opening; `'campaign'`
  // with NOTHING armed still falls through to `'base'`, so the router is total
  // and a headless `buildScenario(world, 'campaign', …)` behaves. That default
  // is also what keeps `match-start.spec.ts` passing unchanged — and it is
  // exactly the smell this repo distrusts, so `tests/campaign-scenario.spec.ts`
  // asserts BOTH halves: an armed operation gets its own opening, and no other
  // name can be talked out of `'base'`.
  const opening: StartCondition = op !== null
    ? (op.opening === 'mcv' ? 'mcv' : 'base')
    : (plan.frozen || name !== 'skirmish' ? 'base' : chooseStart(start, ai));

  return {
    name,
    map: mapKey,
    preset: MAP_PRESETS[mapKey] ?? MAP_PRESETS[MAP_PRESET_DEFAULT],
    seed: seed ?? DEFAULT_SEED,
    distance: plan.distance,
    yawDeg: plan.yawDeg,
    frozen: plan.frozen,
    settleTicks: plan.settleTicks,
    start: opening,
    // A PLAN'S OWN SEA WINS; THE MAP'S IS THE FALLBACK.
    //
    // `plan.sea` is a posed composition — `buildNaval` places six hulls against
    // that exact waterline and `assertShoreMatchesSea` fails the pair if they
    // drift — so nothing may override it, including `?map=coast`. `MAP_SEAS` is
    // the other case: a battlefield whose identity IS its water, chosen in the
    // lobby and delivered as `?map=`. See the block above `MAP_SEAS` for why
    // this used to read `plan.sea ?? null` and why that left every naval
    // structure and hull in the game unreachable.
    sea: plan.sea ?? MAP_SEAS[mapKey] ?? null,
    // A posed fixture composes a fixed number of bases; only `skirmish` is a
    // match, so only `skirmish` may be seated by the lobby.
    // A posed fixture composes a fixed number of bases, so only `skirmish` may
    // be seated by the LOBBY — but a fixture may still declare its own, which
    // is how `atoll` gets four islands graded. `clampArmies(undefined)` is
    // `SKIRMISH_ARMIES_DEFAULT`, so every other plan is unchanged.
    armies: op !== null
      ? clampArmies(op.armies)
      : (name === 'skirmish' ? clampArmies(armiesOverride) : clampArmies(plan.armies)),
  };
}

let planned: ScenarioPlanSummary | null = null;

/**
 * The plan for THIS boot, read straight off the URL and memoised.
 * Call it from any `init()`, at any phase, including before the scenario has
 * been built. Outside a browser it returns the defaults rather than throwing.
 */
export function plannedScenario(): ScenarioPlanSummary {
  if (planned !== null) return planned;
  let shot: string | null = null;
  let map: string | null = null;
  let seed: number | null = null;
  let start: string | null = null;
  let ai: string | null = null;
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    shot = q.get('shot');
    map = q.get('map');
    start = q.get('start');
    ai = q.get('ai');
    const raw = q.get('seed');
    const n = raw === null ? NaN : Number(raw);
    seed = Number.isFinite(n) ? Math.trunc(n) : null;
  }
  planned = planScenario(shot, map, seed, start, ai);
  return planned;
}

/**
 * Drop the memo so the NEXT boot re-reads the URL.
 *
 * The memo is per-boot, not per-process, and the shell rebuilds a match in the
 * same page: without this the HUD cameo theatre and the scatter density plan on
 * a second match still read the first boot's preset while terrain, ore and
 * props (which re-read the URL themselves) read the new one.
 */
export function resetScenarioPlan(): void {
  planned = null;
}

/* -- module state ---------------------------------------------------------- */

let active: ScenarioSpec | null = null;
let keyTable: PerEntityObj<string> | null = null;
let connectivity: ConnectivityReport | null = null;

/**
 * The connectivity audit for the world this boot built, or null before
 * `buildScenario` has run. The debug overlay reads it; so does the test that
 * asserts nothing spawned in a pit.
 */
export function scenarioConnectivity(): ConnectivityReport | null {
  return connectivity;
}

/**
 * The scenario this boot built, or null before `buildScenario` has run.
 * The terrain, ore, scatter, fog and HUD modules all read this.
 */
export function activeScenario(): ScenarioSpec | null {
  return active;
}

/**
 * The content key of an entity ('grizzly', 'conyard', 'tree'), or '' when the
 * scenario did not spawn it. This is what lets the RenderBridge LABEL a
 * placeholder instead of drawing an anonymous grey box.
 */
export function entityKeyOf(id: EntityId): string {
  return keyTable?.get(id) ?? '';
}

export interface BuildScenarioOptions {
  /** `?map=` override. Wins over the scenario's own preset. */
  map?: string | null;
  /** Pre-resolved def binding. Omit and the caller gets the empty binding. */
  defs?: DefBinding;
  /**
   * Which opening to build. Omit and the boot flags decide (see
   * `planScenario`), which outside a browser means the default, `mcv`.
   * Only `skirmish` honours it; every `?shot=` fixture is pre-built.
   */
  start?: StartCondition;
  /**
   * Armies to seat, 2..`SKIRMISH_ARMIES_MAX`. Omit and the plan decides, which
   * outside a lobby means `SKIRMISH_ARMIES_DEFAULT`.
   */
  armies?: number;
}

/**
 * The primary start location, in world metres.
 *
 * `Terrain.startLocations()` is the generator's side of the spawn contract: a
 * shelf it has levelled, kept dry, and proven joined to the main region. When
 * no terrain exists yet — a headless test building a scenario against a stub —
 * fall back to the map centre, which is where `TERRAIN_START_POSITIONS` puts
 * the sole default start anyway.
 */
function startShelf(): { x: number; z: number } {
  const t = getTerrain();
  const starts = t?.startLocations();
  if (starts !== undefined && starts.length > 0) {
    return { x: starts[0].x, z: starts[0].z };
  }
  return { x: MAP_SIZE * 0.5, z: MAP_SIZE * 0.5 };
}

/**
 * The plan told the terrain where the sea is; the builder told everyone else.
 * They are two statements of one line and there is no mechanism forcing them
 * to agree, so they are MEASURED against each other rather than trusted.
 *
 * A drift here is the exact class of defect this whole change is fixing: the
 * fixture is captioned "water as a hero element" and the way it failed was
 * that one half of the contract was never wired to the other. A silent
 * half-metre of disagreement would put the naval yard in the sea, or the fleet
 * on the beach, and the frame would still be photographed with confidence.
 *
 * Warns rather than throws — law 1 of this file is that a scenario never
 * throws — but it warns at the volume of a real bug.
 */
function assertShoreMatchesSea(
  name: string, sea: SeaSpec | undefined, shore: ShoreSpec | null,
): void {
  if (sea === undefined) return;
  if (shore === null) {
    console.warn(
      `[scenario] '${name}' declares a sea on its plan but its builder never called ` +
      'setShore. The ground is carved and ScenarioSpec.shore is null, so anything ' +
      'reading the spec disagrees with the terrain.',
    );
    return;
  }
  // 0.5 m and ~0.6 degrees: far looser than any rounding, far tighter than a
  // human editing one of the two by hand and forgetting the other.
  const dPos = Math.hypot(shore.x - sea.x, shore.z - sea.z);
  const dot = shore.normalX * sea.normalX + shore.normalZ * sea.normalZ;
  if (dPos <= 0.5 && dot >= 0.99994) return;
  console.warn(
    `[scenario] '${name}': the shoreline the terrain carved and the one the builder ` +
    `published have drifted apart — plan (${sea.x.toFixed(1)}, ${sea.z.toFixed(1)}) ` +
    `n(${sea.normalX.toFixed(3)}, ${sea.normalZ.toFixed(3)}) vs builder ` +
    `(${shore.x.toFixed(1)}, ${shore.z.toFixed(1)}) ` +
    `n(${shore.normalX.toFixed(3)}, ${shore.normalZ.toFixed(3)}). ` +
    'They are one line stated twice; fix whichever is wrong.',
  );
}

/**
 * Build a scenario into the world and publish its spec.
 *
 * Never throws. If a layout builder fails halfway the world keeps whatever was
 * placed before the failure and the spec is still published, because a
 * half-dressed frame is something a critic can score and a stack trace is not.
 */
export function buildScenario(
  world: World,
  name: string,
  seed: number,
  options: BuildScenarioOptions = {},
): ScenarioSpec {
  const resolved = resolveScenarioName(name);
  const plan = PLANS[resolved] ?? PLANS[SCENARIO_DEFAULT];
  const map = resolveMapName(options.map, plan.map ?? MAP_PRESET_DEFAULT);
  const preset = MAP_PRESETS[map] ?? MAP_PRESETS[MAP_PRESET_DEFAULT];

  /* -- WHICH SEA THE LAYOUTS SEE -----------------------------------------
   * THE GENERATOR'S OWN ANSWER FIRST. `Terrain.seaSpec` is not a restatement
   * of the plan — it is the spec the heightfield was actually carved from, so
   * a layout that asks "where are the islands" gets the islands that exist
   * rather than the ones something intended. Every other route in this file
   * has been bitten by exactly that gap: `MAP_PRESETS.coast.water` was read by
   * nothing, `ScenarioSpec.shore` was published to nobody.
   *
   * The plan and the preset table are the fallback, for a headless caller that
   * builds a scenario against a stub terrain. `assertShoreMatchesSea` below
   * still checks `plan.sea` alone — the `setShore` obligation belongs to that
   * channel and only to it.
   * -------------------------------------------------------------------- */
  const sea = getTerrain()?.seaSpec ?? plan.sea ?? MAP_SEAS[map] ?? null;
  // The armed operation, resolved once and read by both `armies` and `start`
  // below. It is null for every scenario name but `'campaign'`, so every other
  // path is byte-identical to what it was.
  const opForStart = resolved === 'campaign' ? plannedOperation() : null;
  const armies = opForStart !== null
    ? clampArmies(opForStart.armies)
    : (resolved === 'skirmish'
      ? clampArmies(options.armies ?? plannedArmyOverride())
      : clampArmies(plan.armies));

  keyTable = new PerEntityObj<string>(world.store);
  const builder = new ScenarioBuilder(
    world,
    options.defs ?? EMPTY_BINDING,
    keyTable,
    seed,
    map,
    armies,
    sea,
  );

  // Where the army goes. The generator RESERVES a levelled, connected shelf per
  // start location (`TERRAIN_START_POSITIONS`) and publishes it as
  // `startLocations()`. Reading it here is what closes the loop: the terrain
  // guarantees a patch of standable ground, and the scenario builds on that
  // exact patch rather than on a constant that merely happens to coincide with
  // it today. The fallback keeps headless callers that build a scenario without
  // a terrain module (several unit tests) on the old centre.
  // A plan anchored to world-space geometry (today: anything declaring a `sea`)
  // must NOT follow the shelf — the generator deliberately pushes that shelf
  // inland to keep it out of the water, and the composition is authored around
  // the shoreline, not around the shelf. See `ScenarioPlan.anchor`.
  // AN ARCHIPELAGO IS ANCHORED TO THE CENTRE FOR THE SAME REASON A FIXTURE
  // WITH A SEA IS. `startShelf()` is `startLocations()[0]`, which on a
  // continent is the map centre (the generator reserves it first) and on an
  // island map is ISLAND ZERO — 193 m off centre. Every skirmish layout treats
  // (cx, cz) as the middle of the world: the scatter box, the ore centroid and
  // the camera fallback are all offsets from it.
  const shelf = plan.anchor === 'centre' || builder.archipelago
    ? { x: MAP_SIZE * 0.5, z: MAP_SIZE * 0.5 }
    : startShelf();
  const cx = shelf.x;
  const cz = shelf.z;

  // A fixture is pre-built by definition — `tools/shoot.mjs` photographs twelve
  // finished compositions and an option must never reach them.
  // The second of the two start-forcing sites; `planScenario` is the first, and
  // the campaign exception has to exist in BOTH or the plan and the build
  // disagree about the opening the world was made for.
  const start: StartCondition = opForStart !== null
    ? (opForStart.opening === 'mcv' ? 'mcv' : 'base')
    : (plan.frozen || resolved !== 'skirmish'
      ? 'base'
      : options.start ?? chooseStartFromLocation());

  try {
    plan.build(builder, cx, cz, start);
  } catch (err) {
    console.error(`[scenario] "${resolved}" failed partway through — frame will be sparse`, err);
  } finally {
    // One upload for the whole compound, including a sparse partial layout.
    builder.commitSurfaceStamps();
  }

  // Picking, targeting and the placement validity check all read the spatial
  // index. Nothing has ticked yet, so seed it here or the first frame's cursor
  // hits nothing.
  try {
    world.spatial.rebuild();
  } catch (err) {
    console.error('[scenario] spatial rebuild failed', err);
  }

  /* -- the loud check ------------------------------------------------------
   * Three numbers, once, on every map load. The reported bug survived to a
   * real match because the generator's own `stats().reachable` measured the
   * FRACTION of ground the main region holds — which stayed above 99% on every
   * affected seed, because the map was never cut in half, only peppered with
   * pits. What nobody printed was the COUNT of separate regions, or whether
   * anything had been spawned into one of the small ones. Those are the two
   * numbers below, and `strandedEntities` is the one that must be zero.
   * ---------------------------------------------------------------------- */
  try {
    connectivity = builder.auditConnectivity();
    if (connectivity.strandedEntities > 0) {
      console.error(
        `%c[scenario]%c ${connectivity.strandedEntities} entities are standing on ground ` +
        `that is NOT connected to the map — they cannot leave it. ${connectivity.summary}`,
        'color:#f66', 'color:inherit',
      );
    } else if (connectivity.relocated > 0 || connectivity.regions > 1
      || connectivity.unbuildableGround > 0) {
      console.warn(`[scenario] connectivity: ${connectivity.summary}`);
    } else {
      console.info(`[scenario] connectivity: ${connectivity.summary}`);
    }
  } catch (err) {
    connectivity = null;
    console.warn('[scenario] connectivity audit failed', err);
  }

  const harvested = builder.harvest();
  assertShoreMatchesSea(resolved, plan.sea, harvested.shore);
  const view = visibleGround(plan.distance);
  const wanted = builder.cameraFocus();
  const focusX = wanted?.x ?? cx + (plan.focusDX ?? 0);
  const focusZ = wanted?.z ?? cz + (plan.focusDZ ?? 0);

  active = {
    name: resolved,
    seed,
    map,
    mood: preset.mood,
    frozen: plan.frozen,
    start,
    // Every fixture is a photograph of a composition; shrouding half of it
    // would be photographing the shroud.
    revealMap: true,
    settleTicks: plan.settleTicks,
    camera: { x: focusX, z: focusZ, distance: plan.distance, yawDeg: plan.yawDeg },
    ore: harvested.ore,
    shore: harvested.shore,
    placement: harvested.placement,
    // The measured trapezoid, squared off and yaw-padded. Scatter systems
    // should spend their budget in HERE and nowhere else.
    framed: {
      minX: focusX - view.width * 0.5,
      minZ: focusZ - view.back,
      maxX: focusX + view.width * 0.5,
      maxZ: focusZ + view.front,
    },
    entityCount: builder.count,
    summary: start === 'mcv'
      ? `${plan.summary} Each army opens with a construction vehicle and an escort.`
      : plan.summary,
  };
  return active;
}

/** Drop the published spec and the key table. Called from the system's dispose. */
export function clearScenario(): void {
  active = null;
  keyTable = null;
  connectivity = null;
  resetScenarioPlan();
}

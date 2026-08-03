/**
 * ============================================================================
 * RED ALERT — src/game/Scenarios.ts
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
  REFINERY_STORAGE, SCENARIO_DEFAULT, SCENARIO_SCATTER, SILO_STORAGE,
  UNIT_DIMENSIONS, ORE_CELL_MAX, WATER_LEVEL,
} from '../core/config';
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
  DEG2RAD, Rng, clampWorld, footprintOriginCell, snapFootprintToGrid, wrapAngle,
} from '../core/math';

import { buildAlliedBase } from './scenarios/AlliedBase';
import { buildSovietBase } from './scenarios/SovietBase';
import {
  buildBattle, buildBlob, buildEconomy, buildNaval, buildPlacement,
  buildSelection, buildTerrainShowcase, buildUnitParade,
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
  'terrain-showcase',
  'unit-parade',
  'battle',
  'economy',
  'naval',
  'placement',
  'selection',
  'blob',
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

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
    // stops a Rhino and a dog reading as the same chassis when they move.
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
  transport: unit('transport', EntityKind.Vehicle, NU.transport, 600, ArmorClass.Light, 6.0,
    Locomotor.Hover, 26, 0, Faction.Neutral),
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

  pillbox: building('pillbox', B.pillbox, 500, 0, 26,
    EntityFlag.CanAttack, Faction.Allies, { weaponRange: 22 }),
  prismTower: building('prismTower', B.prismTower, 600, -50, 30,
    EntityFlag.CanAttack | EntityFlag.HasTurret, Faction.Allies, { weaponRange: 34 }),
  teslaCoil: building('teslaCoil', B.teslaCoil, 700, -75, 30,
    EntityFlag.CanAttack, Faction.Soviets, { weaponRange: 30 }),
  flameTower: building('flameTower', B.flameTower, 550, -20, 22,
    EntityFlag.CanAttack, Faction.Soviets, { weaponRange: 16 }),
  wall: building('wall', B.wall, 300, 0, 0,
    EntityFlag.NotSelectable, Faction.Neutral, { armor: ArmorClass.Concrete }),

  navalYard: building('navalYard', NB.navalYard, 1000, -30, 24,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Allies),
  subPen: building('subPen', NB.subPen, 1000, -30, 24,
    EntityFlag.IsFactory | EntityFlag.PrimaryFactory, Faction.Soviets),
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
 * come back as "a Grizzly". Out here every such lookup misses cleanly and the
 * caller falls through to the heuristic it already has.
 */
export const PROP_DEF_BASE = 1000;

/** Scatter dressing. Small, cheap, never owned, mostly crushable. */
export const FALLBACK_PROPS: Readonly<Record<string, FallbackProp>> = {
  tree: { key: 'tree', kind: EntityKind.Prop, radius: 1.6, height: 7.0, maxHp: 120, flags: PROP_BASE | EntityFlag.Crushable },
  pine: { key: 'pine', kind: EntityKind.Prop, radius: 1.3, height: 9.5, maxHp: 120, flags: PROP_BASE | EntityFlag.Crushable },
  bush: { key: 'bush', kind: EntityKind.Prop, radius: 0.9, height: 1.2, maxHp: 40, flags: PROP_BASE | EntityFlag.Crushable },
  rock: { key: 'rock', kind: EntityKind.Prop, radius: 2.0, height: 2.6, maxHp: 400, flags: PROP_BASE | EntityFlag.BlocksNav },
  boulder: { key: 'boulder', kind: EntityKind.Prop, radius: 3.2, height: 4.4, maxHp: 800, flags: PROP_BASE | EntityFlag.BlocksNav },
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
  grizzly: ['grizzly', 'grizzlytank', 'lighttank', 'mediumtank', 'guardiantank'],
  ifv: ['ifv', 'multigunner', 'apc', 'riptide'],
  prismTank: ['prismtank', 'prism', 'athena', 'athenacannon'],
  rhino: ['rhino', 'rhinotank', 'heavytank', 'hammertank'],
  apocalypse: ['apocalypse', 'apoc', 'apocalypsetank'],
  harvester: ['harvester', 'oreharvester', 'oreminer', 'chronominer', 'miner'],
  mcv: ['mcv', 'mobileconstructionvehicle', 'constructionvehicle'],
  gunboat: ['gunboat', 'assaultdestroyer', 'patrolboat'],
  destroyer: ['destroyer', 'alliedcruiser', 'cruiser'],
  submarine: ['submarine', 'sub', 'akula', 'typhoon'],
  dreadnought: ['dreadnought', 'sovietcruiser', 'battleship'],
  transport: ['transport', 'landingcraft', 'hovertransport'],
};

const BUILDING_ALIASES: Readonly<Record<string, readonly string[]>> = {
  conyard: ['conyard', 'constructionyard', 'conyardallied', 'commandcenter', 'hq'],
  powerPlant: ['powerplant', 'power', 'reactor', 'teslareactor'],
  refinery: ['refinery', 'orerefinery', 'processor'],
  warFactory: ['warfactory', 'factory', 'vehiclefactory', 'weaponsfactory'],
  barracks: ['barracks', 'infantrybarracks', 'boot camp', 'bootcamp'],
  radar: ['radar', 'radardome', 'airfield'],
  battleLab: ['battlelab', 'techcenter', 'lab', 'researchlab'],
  oreSilo: ['oresilo', 'silo', 'storage'],
  pillbox: ['pillbox', 'bunker', 'machinegunnest'],
  prismTower: ['prismtower', 'prism', 'spectrumtower'],
  teslaCoil: ['teslacoil', 'tesla', 'teslatower'],
  flameTower: ['flametower', 'flameturret', 'firetower'],
  wall: ['wall', 'concretewall', 'sandbag'],
  navalYard: ['navalyard', 'shipyard', 'seaport', 'dock'],
  subPen: ['subpen', 'submarinepen', 'navalyardsoviet'],
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
  /** Occupied radii, so scatter never drops a tree inside a war factory. */
  private readonly blockedX: number[] = [];
  private readonly blockedZ: number[] = [];
  private readonly blockedR: number[] = [];

  constructor(
    readonly world: World,
    readonly defs: DefBinding,
    readonly keys: PerEntityObj<string>,
    seed: number,
    /** The MAP_PRESETS entry this scenario is being built on. */
    readonly preset: string,
  ) {
    this.rng = new Rng(seed);
  }

  /* -- players ---------------------------------------------------------- */

  /** The local (Allied) player. Bootstrap seats them at index 0. */
  get allies(): PlayerId {
    return this.playerOf(Faction.Allies);
  }

  /** The opposing (Soviet) player. */
  get soviets(): PlayerId {
    return this.playerOf(Faction.Soviets);
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

  private playerOf(faction: Faction): PlayerId {
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
    const fb = FALLBACK_UNITS[key];
    if (fb === undefined) {
      console.warn(`[scenario] unknown unit key "${key}"`);
      return NONE;
    }
    const s = this.world.store;
    const defId = this.defs.unitId[key] ?? -1;
    const def: UnitDef | undefined =
      defId >= 0 ? this.defs.tables?.units[defId] : undefined;

    const px = clampWorld(x, 2);
    const pz = clampWorld(z, 2);
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
    s.locomotor[i] = def?.locomotor ?? fb.locomotor;
    // A radius fitted to the hull box: too small and tanks interpenetrate, too
    // large and a column of Rhinos cannot use a 3-cell gap in its own wall.
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
    const fb = FALLBACK_BUILDINGS[key];
    if (fb === undefined) {
      console.warn(`[scenario] unknown building key "${key}"`);
      return NONE;
    }
    const s = this.world.store;
    const defId = this.defs.buildingId[key] ?? -1;
    const def: BuildingDef | undefined =
      defId >= 0 ? this.defs.tables?.buildings[defId] : undefined;

    const fw = def?.footprintW ?? fb.footprintW;
    const fh = def?.footprintH ?? fb.footprintH;
    snapFootprintToGrid(x, z, fw, fh, scratch2);
    const px = clampWorld(scratch2[0], fw * CELL);
    const pz = clampWorld(scratch2[1], fh * CELL);
    const yaw = wrapAngle((options.yawDeg ?? 0) * DEG2RAD);
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

    if ((fb.flags & EntityFlag.BlocksNav) !== 0) this.block(px, pz, fb.radius);
    this.finish(id, i, key, owner, fb.kind, false);
    return id;
  }

  /** A burning hulk. Reads as "this frame is 30 seconds into a fight". */
  spawnWreck(x: number, z: number, faction: Faction, burning = true): EntityId {
    const id = this.spawnProp('wreck', x, z, { burning });
    const i = this.world.store.index(id);
    if (i >= 0) this.world.store.faction[i] = faction;
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
   * instanced scatter system — these are the ones that cast a real shadow, block
   * nav and get crushed.
   */
  scatter(
    box: WorldBox,
    count: number,
    kinds: readonly string[] = MAP_PRESETS[this.preset]?.props ?? ['tree', 'rock', 'bush'],
  ): number {
    const budget = Math.min(count, SCENARIO_SCATTER.maxProps);
    const spacing = SCENARIO_SCATTER.minSpacing;
    let placed = 0;
    // Bounded rejection sampling: 8 tries per prop, then give up on that one.
    // A dense base leaves genuinely no room, and looping forever is not an
    // acceptable way to discover that.
    for (let n = 0; n < budget; n++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const x = this.rng.range(box.minX, box.maxX);
        const z = this.rng.range(box.minZ, box.maxZ);
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
  summary: string;
  build(b: ScenarioBuilder, cx: number, cz: number): void;
}

/**
 * Every `?shot=` the harness knows about.
 *
 * `distance` mirrors the value `tools/shoot.mjs` poses with, so the composition
 * is authored for the frame it will actually be photographed in — a base laid
 * out for a 40 m frame and shot at 62 m reads as a model village on an empty
 * table, which is scorecard failure R3.
 */
const PLANS: Record<string, ScenarioPlan> = {
  skirmish: {
    map: 'temperate', distance: 58, yawDeg: 24, frozen: false, settleTicks: 0,
    // The only scenario that does not put its subject on the map centre, so it
    // is the only one that moves the focus: a match starts looking at YOUR base.
    focusDX: -74, focusDZ: 54,
    summary: 'Allied base, Soviet base across the valley, three ore fields.',
    build(b, cx, cz) {
      // Two bases on the classic RA diagonal, each on its own ore field, with a
      // contested patch in the middle. `facingDeg + 180` is the threat axis, so
      // each base is turned to look at the other.
      buildAlliedBase(b, cx - 74, cz + 62, { facingDeg: 310 });
      buildSovietBase(b, cx + 74, cz - 62, { facingDeg: 130 });
      b.addOre(cx - 30, cz + 86, 30);
      b.addOre(cx + 34, cz - 86, 30);
      b.addOre(cx, cz, 22);
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
      buildSovietBase(b, cx - 1, cz - 7, { facingDeg: 0, garrison: true });
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
    map: 'arid', distance: 38, yawDeg: 12, frozen: true, settleTicks: 0,
    summary: 'Two ranks of units at readable range, three-quarter facing.',
    build: buildUnitParade,
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
}

/** Resolve the boot flags into a plan without touching the world. */
export function planScenario(
  shot?: string | null,
  map?: string | null,
  seed?: number | null,
): ScenarioPlanSummary {
  const name = resolveScenarioName(shot);
  const plan = PLANS[name] ?? PLANS[SCENARIO_DEFAULT];
  const mapKey = resolveMapName(map, plan.map);
  return {
    name,
    map: mapKey,
    preset: MAP_PRESETS[mapKey] ?? MAP_PRESETS[MAP_PRESET_DEFAULT],
    seed: seed ?? DEFAULT_SEED,
    distance: plan.distance,
    yawDeg: plan.yawDeg,
    frozen: plan.frozen,
    settleTicks: plan.settleTicks,
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
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    shot = q.get('shot');
    map = q.get('map');
    const raw = q.get('seed');
    const n = raw === null ? NaN : Number(raw);
    seed = Number.isFinite(n) ? Math.trunc(n) : null;
  }
  planned = planScenario(shot, map, seed);
  return planned;
}

/* -- module state ---------------------------------------------------------- */

let active: ScenarioSpec | null = null;
let keyTable: PerEntityObj<string> | null = null;

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

  keyTable = new PerEntityObj<string>(world.store);
  const builder = new ScenarioBuilder(
    world,
    options.defs ?? EMPTY_BINDING,
    keyTable,
    seed,
    map,
  );

  const cx = MAP_SIZE * 0.5;
  const cz = MAP_SIZE * 0.5;

  try {
    plan.build(builder, cx, cz);
  } catch (err) {
    console.error(`[scenario] "${resolved}" failed partway through — frame will be sparse`, err);
  }

  // Picking, targeting and the placement validity check all read the spatial
  // index. Nothing has ticked yet, so seed it here or the first frame's cursor
  // hits nothing.
  try {
    world.spatial.rebuild();
  } catch (err) {
    console.error('[scenario] spatial rebuild failed', err);
  }

  const harvested = builder.harvest();
  const view = visibleGround(plan.distance);
  const focusX = cx + (plan.focusDX ?? 0);
  const focusZ = cz + (plan.focusDZ ?? 0);

  active = {
    name: resolved,
    seed,
    map,
    mood: preset.mood,
    frozen: plan.frozen,
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
    summary: plan.summary,
  };
  return active;
}

/** Drop the published spec and the key table. Called from the system's dispose. */
export function clearScenario(): void {
  active = null;
  keyTable = null;
}

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
  DEG2RAD, Rng, clampCell, clampWorld, footprintOriginCell, snapFootprintToGrid,
  worldToCell, wrapAngle,
} from '../core/math';
import { TerrainRegions } from '../sim/Flowfield';
import { getTerrain } from '../world/Terrain';
// Zero-cost edge: `UnlockGate.ts` imports nothing but its own type-only module,
// and `isBuildable` answers "yes" when no gate has been installed.
import { isBuildable } from '../progression/UnlockGate';

import { buildAlliedBase, type BaseOptions } from './scenarios/AlliedBase';
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

/** Half-diagonal of the fallback layout, metres. Measured, not guessed: two
 *  armies 96 m apart on a 512 m map are two screens apart at match dolly. */
const START_SPREAD_X = 74;
const START_SPREAD_Z = 62;

/** Fold a compass bearing into [0, 360). */
function wrapDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

export function startSpots(cx: number, cz: number, count: number): StartSpot[] {
  const n = Math.max(1, count);
  const pts: { x: number; z: number }[] = [];

  const shelves = getTerrain()?.startLocations();
  if (shelves !== undefined && shelves.length >= n) {
    for (let i = 0; i < n; i++) pts.push({ x: shelves[i].x, z: shelves[i].z });
  } else {
    // One shelf (or none): fan the armies around it on the classic diagonal.
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      pts.push({
        x: clampWorld(cx + Math.cos(t) * START_SPREAD_X, 4),
        z: clampWorld(cz + Math.sin(t) * START_SPREAD_Z, 4),
      });
    }
    // Slot 0 keeps the exact corner the old hard-coded plan used, so a saved
    // seed frames the same valley it always did.
    pts[0] = { x: clampWorld(cx - START_SPREAD_X, 4), z: clampWorld(cz + START_SPREAD_Z, 4) };
    if (n > 1) pts[1] = { x: clampWorld(cx + START_SPREAD_X, 4), z: clampWorld(cz - START_SPREAD_Z, 4) };
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
  // No Air locomotor exists yet, so the gunship is authored the way the naval
  // hulls are: hover, flyer speed, flyer sight, paper armour.
  mrdKestrel: unit('mrdKestrel', EntityKind.Vehicle, U.ifv, 210, ArmorClass.Light, 12.0,
    Locomotor.Hover, 36, GUNNER, Faction.Meridian, { crushableBy: 0, turnRate: 3.2 }),

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
  // No Air locomotor exists yet, so the gunship is authored the way the naval
  // hulls are: hover, flyer speed, flyer sight, paper armour.
  rclHornet: unit('rclHornet', EntityKind.Vehicle, U.ifv, 180, ArmorClass.Light, 11.0,
    Locomotor.Hover, 34, GUNNER, Faction.Reclaim, { crushableBy: 0, turnRate: 3.4 }),

  rclScow: unit('rclScow', EntityKind.Vehicle, NU.gunboat, 340, ArmorClass.Light, 7.2,
    Locomotor.Hover, 32, GUNNER, Faction.Reclaim, { turnRate: RCL_TURN(NU.gunboat) }),
  rclHulk: unit('rclHulk', EntityKind.Vehicle, NU.destroyer, 820, ArmorClass.Heavy, 4.4,
    Locomotor.Hover, 36, GUNNER, Faction.Reclaim, { turnRate: RCL_TURN(NU.destroyer) }),
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
   * Plant. Cheapest power in the game on the softest structure — and both Pact
   * defences plus its siege hull carry `needsPower` weapons, so a power raid
   * silences the belt while the economy keeps running.
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

  rclBarricade: building('rclBarricade', B.wall, 340, 0, 0,
    EntityFlag.NotSelectable, Faction.Reclaim),
  rclSpitpost: building('rclSpitpost', B.pillbox, 520, 0, 24,
    EntityFlag.CanAttack, Faction.Reclaim, { weaponRange: 20 }),
  // No HasTurret, deliberately: the Arc Pylon is a fixed coil, like every other
  // gun the Reclamation owns.
  rclPylon: building('rclPylon', B.prismTower, 560, -90, 30,
    EntityFlag.CanAttack, Faction.Reclaim, { weaponRange: 28 }),
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

  // The Meridian Pact. Its def keys are already unambiguous, so each row is
  // the key itself plus the model name the art modules use.
  mrdWayfarer: ['mrdwayfarer', 'wayfarer', 'meridianwayfarer'],
  mrdLancer: ['mrdlancer', 'sunlancer', 'meridianlancer'],
  mrdArtificer: ['mrdartificer', 'artificer', 'meridianartificer'],
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
  oreSilo: ['oresilo', 'silo', 'storage'],
  pillbox: ['pillbox', 'bunker', 'machinegunnest'],
  prismTower: ['prismtower', 'prism', 'spectrumtower'],
  teslaCoil: ['teslacoil', 'tesla', 'teslatower'],
  flameTower: ['flametower', 'flameturret', 'firetower'],
  wall: ['wall', 'concretewall', 'sandbag'],
  navalYard: ['navalyard', 'shipyard', 'seaport', 'dock'],
  subPen: ['subpen', 'submarinepen', 'navalyardsoviet'],
  aaTurret: ['aaturret', 'multigunneraa', 'aagun', 'flakcannon'],
  sentryGun: ['sentrygun', 'sentry', 'machinegunturret'],

  mrdConclave: ['mrdconclave', 'conclave', 'meridianconclave'],
  mrdSolarArray: ['mrdsolararray', 'solararray', 'meridiansolararray'],
  mrdCistern: ['mrdcistern', 'orecistern', 'meridiancistern'],
  mrdChapterhouse: ['mrdchapterhouse', 'chapterhouse', 'meridianchapterhouse'],
  mrdForgeyard: ['mrdforgeyard', 'forgeyard', 'meridianforgeyard'],
  mrdOculus: ['mrdoculus', 'oculus', 'meridianoculus'],
  mrdVault: ['mrdvault', 'sunvault', 'meridianvault'],
  mrdSlipway: ['mrdslipway', 'slipway', 'meridianslipway'],
  mrdReliquary: ['mrdreliquary', 'reliquary', 'meridianreliquary'],
  mrdRampart: ['mrdrampart', 'rampart', 'meridianrampart'],
  mrdGlaive: ['mrdglaive', 'glaivepost', 'meridianglaive'],
  mrdHelios: ['mrdhelios', 'heliosspire', 'meridianhelios'],

  rclFoundry: ['rclfoundry', 'foundry', 'reclaimfoundry'],
  rclFurnace: ['rclfurnace', 'scrapfurnace', 'reclaimfurnace'],
  rclSorter: ['rclsorter', 'oresorter', 'reclaimsorter'],
  rclRookery: ['rclrookery', 'rookery', 'reclaimrookery'],
  rclBreakerYard: ['rclbreakeryard', 'breakeryard', 'reclaimbreakeryard'],
  rclSpotter: ['rclspotter', 'spottermast', 'reclaimspotter'],
  rclHeap: ['rclheap', 'slagheap', 'reclaimheap'],
  rclDrydock: ['rcldrydock', 'breakerdock', 'reclaimdrydock'],
  rclCrucible: ['rclcrucible', 'crucible', 'reclaimcrucible'],
  rclBarricade: ['rclbarricade', 'scrapbarricade', 'reclaimbarricade'],
  rclSpitpost: ['rclspitpost', 'spitpost', 'reclaimspitpost'],
  rclPylon: ['rclpylon', 'arcpylon', 'reclaimpylon'],
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
 * it quietly gives a Reclamation player an Allied Grizzly, which the fallback
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
  oreSilo:          ['oreSilo',     'oreSilo',    'oreSilo',    'mrdVault',         'rclHeap'],
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
  transport:        ['transport',   'transport',  'transport',  'mrdCarryall',      'rclCrawler'],
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

  constructor(
    readonly world: World,
    readonly defs: DefBinding,
    readonly keys: PerEntityObj<string>,
    seed: number,
    /** The MAP_PRESETS entry this scenario is being built on. */
    readonly preset: string,
  ) {
    this.rng = new Rng(seed);
    this.primeConnectivity();
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
    if (r.isMain(cx, cz)) return false;
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
      if (!r.isMain(cx, cz)) stranded++;
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
      `; ${stranded} entit${stranded === 1 ? 'y' : 'ies'} stranded`;

    return {
      regions,
      passableCells,
      mainCells,
      mainFraction,
      relocated: this.relocated,
      relocatedMaxMetres: this.relocatedMaxMetres,
      strandedEntities: stranded,
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
    // looking at an Apocalypse Tank it could not build for another 500 kills.
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
     * Battle Lab, the Soviet AI opened with three Tesla Coils the player could
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

    const fw = def?.footprintW ?? fb.footprintW;
    const fh = def?.footprintH ?? fb.footprintH;
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
function buildBaseFor(
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
function buildMcvStartFor(b: ScenarioBuilder, owner: PlayerId, spot: StartSpot): EntityId {
  const faction = b.world.player(owner)?.faction ?? Faction.Neutral;
  const force = startForceFor(faction);
  const yaw = spot.facingDeg;
  const rad = yaw * DEG2RAD;
  // Unit vector toward the opposing start, and its left-hand perpendicular.
  const fx = Math.sin(rad);
  const fz = Math.cos(rad);

  const mcv = b.spawnUnit('mcv', owner, spot.x, spot.z, { yawDeg: yaw, stance: Stance.HoldFire });

  // The screen: infantry ahead of the vehicle, armour ahead of the infantry, all
  // of it between the MCV and whoever is coming.
  if (force.infantry > 0) {
    b.formation('gi', owner, spot.x + fx * 12, spot.z + fz * 12, force.infantry, {
      yawDeg: yaw, spacing: 4.2, columns: Math.min(force.infantry, 3), jitter: 0.6,
    });
  }
  if (force.vehicles > 0) {
    b.formation('grizzly', owner, spot.x + fx * 21, spot.z + fz * 21, force.vehicles, {
      yawDeg: yaw, spacing: 8.0, columns: force.vehicles, jitter: 0.5,
    });
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
function addStartOre(b: ScenarioBuilder, spots: readonly StartSpot[]): void {
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
  if (spots.length > 0) b.addOre(midX / spots.length, midZ / spots.length, 22);
}

const PLANS: Record<string, ScenarioPlan> = {
  skirmish: {
    map: 'temperate', distance: 58, yawDeg: 24, frozen: false, settleTicks: 0,
    // The only scenario that does not put its subject on the map centre, so it
    // is the only one that moves the focus. Superseded by `b.setCameraFocus`
    // below, which knows where slot 0 actually ended up; this stays as the
    // answer for a world with no terrain module at all.
    focusDX: -74, focusDZ: 54,
    summary: 'Two armies on the diagonal, three ore fields.',
    build(b, cx, cz, start) {
      // Two starts on the classic RA diagonal, each with its own ore field and a
      // contested patch between them, each turned to face the other.
      const spots = startSpots(cx, cz, 2);
      const owners: PlayerId[] = [b.allies, b.soviets];

      if (start === 'base') {
        for (let i = 0; i < spots.length; i++) {
          // `facingDeg + 180` is the threat axis: a base's defended face looks
          // at the enemy, so the layout is turned away from where it is aimed.
          buildBaseFor(b, owners[i], spots[i].x, spots[i].z, {
            facingDeg: wrapDeg(spots[i].facingDeg + 180),
          });
        }
      } else {
        const mine: EntityId[] = [];
        for (let i = 0; i < spots.length; i++) {
          const mcv = buildMcvStartFor(b, owners[i], spots[i]);
          if (i === 0 && mcv !== NONE) mine.push(mcv);
        }
        // The local player opens with their construction vehicle already on the
        // cursor. Every RTS does this and it is the difference between "what am
        // I looking at" and "drive here, press deploy".
        b.select(mine);
      }

      addStartOre(b, spots);
      // Look at YOUR opening, wherever the generator put it.
      b.setCameraFocus(spots[0].x, spots[0].z - 8);
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
  /** The opening this boot will use. Always `'base'` on a `?shot=` fixture. */
  readonly start: StartCondition;
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
  const name = resolveScenarioName(shot);
  const plan = PLANS[name] ?? PLANS[SCENARIO_DEFAULT];
  const mapKey = resolveMapName(map, plan.map);

  // A posed fixture is pre-built by definition; nothing may talk it out of that.
  const opening: StartCondition =
    plan.frozen || name !== 'skirmish' ? 'base' : chooseStart(start, ai);

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

  // Where the army goes. The generator RESERVES a levelled, connected shelf per
  // start location (`TERRAIN_START_POSITIONS`) and publishes it as
  // `startLocations()`. Reading it here is what closes the loop: the terrain
  // guarantees a patch of standable ground, and the scenario builds on that
  // exact patch rather than on a constant that merely happens to coincide with
  // it today. The fallback keeps headless callers that build a scenario without
  // a terrain module (several unit tests) on the old centre.
  const shelf = startShelf();
  const cx = shelf.x;
  const cz = shelf.z;

  // A fixture is pre-built by definition — `tools/shoot.mjs` photographs twelve
  // finished compositions and an option must never reach them.
  const start: StartCondition =
    plan.frozen || resolved !== 'skirmish'
      ? 'base'
      : options.start ?? chooseStartFromLocation();

  try {
    plan.build(builder, cx, cz, start);
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
    } else if (connectivity.relocated > 0 || connectivity.regions > 1) {
      console.warn(`[scenario] connectivity: ${connectivity.summary}`);
    } else {
      console.info(`[scenario] connectivity: ${connectivity.summary}`);
    }
  } catch (err) {
    connectivity = null;
    console.warn('[scenario] connectivity audit failed', err);
  }

  const harvested = builder.harvest();
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

/**
 * ============================================================================
 * RED ALERT — src/data/Defs.ts   THE CONTENT LAYER
 * ============================================================================
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * Eight modules were written against a `DefTables` that nobody had published:
 * `src/game/Scenarios.ts#resolveDefBinding()` globs `src/data/**` for one,
 * `src/art/{units,buildings}.system.ts` bind their model rosters through it,
 * `src/sim/Production.ts` builds its catalog from it, `src/ui/Hud.ts` fills its
 * sidebar from it, `src/sim/AI.ts` resolves its build order through it, and
 * `src/input/Commands.ts` derives unit roles from it. Every one of them shipped
 * a graceful fallback, so the game booted — and every structure on the map drew
 * the SAME MODEL, because `RenderBridge` resolves art by `(kind, faction,
 * defId)` and every spawn carried `defId = -1`. A twenty-five-building Allied
 * base rendered as twenty-five barracks. That is what this file fixes.
 *
 * THE ONE RULE: THIS FILE CHANGES NO BEHAVIOUR IT DOES NOT HAVE TO
 * ----------------------------------------------------------------
 * Every stat below is the value `Scenarios.FALLBACK_UNITS` /
 * `FALLBACK_BUILDINGS` was already using, and every cost/buildTime/tab/prereq
 * is the value `Production.CONTENT` was already using. Publishing a def table
 * makes those two tables *stop* being consulted (see `resolveEntry` and
 * `spawnUnit`), so any number that disagreed here would silently re-balance the
 * game as a side effect of fixing the art binding. The fields the fallbacks
 * could not express — which weapon, which model, what a factory produces, where
 * a unit exits, where a harvester docks — are the new information.
 *
 * `radius` deserves a note: `spawnUnit` derived it as `max(width, length) *
 * 0.45` from the fallback dimensions. It is written out explicitly here at
 * exactly that value rather than left to a formula, because nav separation,
 * the placement blocker and the targeting hit radius all read it and a 10 cm
 * drift is a column of Rhinos that can no longer fit through its own gate.
 *
 * THE WEAPON TABLE IS BORROWED, NOT REDECLARED
 * --------------------------------------------
 * `store.weaponIndex[i]` is an index into whatever array `src/sim/Combat.ts`
 * is currently resolving against, which is `DEFAULT_WEAPONS` unless someone
 * calls `setWeaponTable`. A second, separately-authored armoury here would be
 * two tables that agree until the day one of them gets a row inserted, and then
 * every unit in the game would silently fire the wrong gun. So `weapons` below
 * re-exports the sim's armoury and every `weapons: [...]` entry is built with
 * `weaponIndexOf(key)` — a typo is a build-time -1, not a mystery.
 *
 * This is the only place in the tree where `src/data` imports `src/sim`. It
 * cannot cycle: no file under `src/sim` imports `src/data` (they reach content
 * exclusively through `resolveDefBinding()`, which is a LAZY glob).
 * ============================================================================
 */

import {
  ARMOR_MATRIX, BUILDING_DIMENSIONS, BUILD_RADIUS, HARVESTER_CAPACITY,
  NAVAL_BUILDING_DIMENSIONS, NAVAL_UNIT_DIMENSIONS, REFINERY_STORAGE, SILO_STORAGE,
  UNIT_DIMENSIONS,
} from '../core/config';
import {
  ArmorClass, BuildTab, EntityFlag, EntityKind, Faction, Locomotor,
} from '../core/types';
import type {
  BuildingDef, DefTables, FactionDef, UnitDef, WeaponDef,
} from '../core/types';
import { DEFAULT_WEAPONS, weaponIndexOf } from '../sim/Combat';

/* ==========================================================================
 * 0. THE ARMOURY
 * ========================================================================== */

/** The sim's armoury verbatim. See the header for why it is not re-authored. */
export const WEAPONS: readonly WeaponDef[] = DEFAULT_WEAPONS;

/**
 * `weaponIndexOf` returns -1 for an unknown key. A -1 in a def's `weapons`
 * array would make `spawnUnit` write `weaponIndex = -1`, which reads as
 * "unarmed" and would quietly disarm the unit. Fail loudly at module load
 * instead — this runs once, at import, in every environment including tests.
 */
function w(key: string): number {
  const i = weaponIndexOf(key);
  if (i < 0) throw new Error(`[data] no weapon named "${key}" in the armoury`);
  return i;
}

const UNARMED: readonly number[] = [];

/* ==========================================================================
 * 1. UNITS
 *
 * Order is STABLE and append-only: `store.defId` holds an index into this
 * array, `PlayerState.buildingCount` is indexed by the building one, and a
 * saved scenario would re-bind to the wrong content if a row moved.
 * ========================================================================== */

const U = UNIT_DIMENSIONS;
const NU = NAVAL_UNIT_DIMENSIONS;

/** The fallback's derivation, written out so it cannot drift. */
function hullRadius(dim: { l: number; w: number }): number {
  return Math.max(dim.w, dim.l) * 0.45;
}

interface UnitSpec {
  key: string;
  name: string;
  blurb: string;
  faction: Faction;
  kind: EntityKind.Infantry | EntityKind.Vehicle;
  cost: number;
  buildTime: number;
  tab: BuildTab;
  prereqs: readonly string[];
  sortOrder: number;
  model: string;
  maxHp: number;
  armor: ArmorClass;
  maxSpeed: number;
  turnRate: number;
  locomotor: Locomotor;
  radius: number;
  sight: number;
  weapons: readonly number[];
  hasTurret: boolean;
  crushLevel?: number;
  crushableBy?: number;
  cargoMax?: number;
  deploysInto?: string | null;
  canCapture?: boolean;
  /** Accel defaults to the fallback's `max(2.4, maxSpeed * 1.15)`. */
  accel?: number;
}

function unit(s: UnitSpec): UnitDef {
  return {
    key: s.key,
    name: s.name,
    blurb: s.blurb,
    faction: s.faction,
    cost: s.cost,
    buildTime: s.buildTime,
    tab: s.tab,
    prereqs: s.prereqs,
    sortOrder: s.sortOrder,
    model: s.model,
    kind: s.kind,
    maxHp: s.maxHp,
    armor: s.armor,
    maxSpeed: s.maxSpeed,
    accel: s.accel ?? Math.max(2.4, s.maxSpeed * 1.15),
    turnRate: s.turnRate,
    locomotor: s.locomotor,
    radius: s.radius,
    sight: s.sight,
    weapons: s.weapons,
    hasTurret: s.hasTurret,
    crushLevel: s.crushLevel ?? 0,
    crushableBy: s.crushableBy ?? 0,
    cargoMax: s.cargoMax ?? 0,
    popCost: 1,
    deploysInto: s.deploysInto ?? null,
    canCapture: s.canCapture ?? false,
    // Left at zero on purpose. `ScenarioBuilder.spawnUnit` ORs this ON TOP of
    // the fallback's flags, which already carry CanMove/ProvidesVision/
    // CanAttack/Crushable/IsHarvester; repeating them here would be harmless
    // but a divergence here would not be, so there is one owner.
    flags: 0,
  };
}

export const UNITS: readonly UnitDef[] = [
  /* -- Allied infantry --------------------------------------------------- */
  unit({
    key: 'gi', name: 'G.I.', blurb: 'Rifleman. The Allied line.',
    faction: Faction.Allies, kind: EntityKind.Infantry,
    cost: 200, buildTime: 5, tab: BuildTab.Infantry, prereqs: ['barracks'], sortOrder: 10,
    model: 'allied_rifle',
    maxHp: 120, armor: ArmorClass.Infantry, maxSpeed: 3.2, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 24,
    weapons: [w('rifle')], hasTurret: false, crushableBy: 1,
  }),
  unit({
    key: 'engineer', name: 'Engineer', blurb: 'Captures structures. Repairs them.',
    faction: Faction.Neutral, kind: EntityKind.Infantry,
    cost: 500, buildTime: 10, tab: BuildTab.Infantry,
    prereqs: ['barracks', 'refinery'], sortOrder: 30,
    model: 'allied_engineer',
    maxHp: 90, armor: ArmorClass.Infantry, maxSpeed: 3.4, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 20,
    weapons: UNARMED, hasTurret: false, crushableBy: 1, canCapture: true,
  }),

  /* -- Soviet infantry ---------------------------------------------------- */
  unit({
    key: 'conscript', name: 'Conscript', blurb: 'Cheap, expendable, everywhere.',
    faction: Faction.Soviets, kind: EntityKind.Infantry,
    cost: 100, buildTime: 4, tab: BuildTab.Infantry, prereqs: ['barracks'], sortOrder: 10,
    model: 'soviet_conscript',
    maxHp: 100, armor: ArmorClass.Infantry, maxSpeed: 3.4, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 22,
    weapons: [w('conscriptRifle')], hasTurret: false, crushableBy: 1,
  }),
  unit({
    key: 'attackDog', name: 'Attack Dog', blurb: 'Fast scout. Shreds infantry.',
    faction: Faction.Soviets, kind: EntityKind.Infantry,
    cost: 300, buildTime: 6, tab: BuildTab.Infantry, prereqs: ['barracks'], sortOrder: 20,
    model: 'soviet_conscript',
    maxHp: 70, armor: ArmorClass.Infantry, maxSpeed: 6.2, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.attackDog), sight: 26,
    weapons: [w('bite')], hasTurret: false, crushableBy: 1,
  }),

  /* -- Allied vehicles ---------------------------------------------------- */
  unit({
    key: 'grizzly', name: 'Grizzly Tank', blurb: 'The Allied main battle tank.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 700, buildTime: 11, tab: BuildTab.Vehicles, prereqs: ['warFactory'], sortOrder: 20,
    model: 'allied_guardian',
    maxHp: 340, armor: ArmorClass.Medium, maxSpeed: 6.6, turnRate: 2.6 - U.lightTank.l * 0.14,
    locomotor: Locomotor.Track, radius: hullRadius(U.lightTank), sight: 30,
    weapons: [w('lightCannon')], hasTurret: true, crushLevel: 3, crushableBy: 5,
  }),
  unit({
    key: 'ifv', name: 'Multigunner IFV', blurb: 'Fast wheeled gun platform.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 600, buildTime: 10, tab: BuildTab.Vehicles,
    prereqs: ['warFactory', 'radar'], sortOrder: 30,
    model: 'allied_ifv',
    maxHp: 220, armor: ArmorClass.Light, maxSpeed: 8.4, turnRate: 2.6 - U.ifv.l * 0.14,
    locomotor: Locomotor.Wheel, radius: hullRadius(U.ifv), sight: 32,
    weapons: [w('chaingun')], hasTurret: true, crushableBy: 4,
  }),
  unit({
    key: 'prismTank', name: 'Prism Tank', blurb: 'Beam artillery. Fragile.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 1200, buildTime: 17, tab: BuildTab.Vehicles,
    prereqs: ['warFactory', 'battleLab'], sortOrder: 40,
    model: 'allied_prism',
    maxHp: 260, armor: ArmorClass.Light, maxSpeed: 6.0, turnRate: 2.6 - U.prismTank.l * 0.14,
    locomotor: Locomotor.Track, radius: hullRadius(U.prismTank), sight: 34,
    weapons: [w('prismBeam')], hasTurret: true, crushLevel: 2, crushableBy: 5,
  }),

  /* -- Soviet vehicles ---------------------------------------------------- */
  unit({
    key: 'rhino', name: 'Rhino Tank', blurb: 'Slower, heavier, hits harder.',
    faction: Faction.Soviets, kind: EntityKind.Vehicle,
    cost: 900, buildTime: 13, tab: BuildTab.Vehicles, prereqs: ['warFactory'], sortOrder: 20,
    model: 'soviet_rhino',
    maxHp: 420, armor: ArmorClass.Heavy, maxSpeed: 5.4, turnRate: 2.6 - U.heavyTank.l * 0.14,
    locomotor: Locomotor.Track, radius: hullRadius(U.heavyTank), sight: 28,
    weapons: [w('heavyCannon')], hasTurret: true, crushLevel: 4, crushableBy: 6,
  }),
  unit({
    key: 'apocalypse', name: 'Apocalypse Tank', blurb: 'The end of an argument.',
    faction: Faction.Soviets, kind: EntityKind.Vehicle,
    cost: 1750, buildTime: 24, tab: BuildTab.Vehicles,
    prereqs: ['warFactory', 'battleLab'], sortOrder: 40,
    model: 'soviet_rhino',
    maxHp: 800, armor: ArmorClass.Heavy, maxSpeed: 3.8, turnRate: 2.6 - U.apocalypse.l * 0.14,
    locomotor: Locomotor.Track, radius: hullRadius(U.apocalypse), sight: 30,
    weapons: [w('twinCannon')], hasTurret: true, crushLevel: 6, crushableBy: 0,
  }),

  /* -- Shared support ----------------------------------------------------- */
  unit({
    key: 'harvester', name: 'Ore Harvester', blurb: 'Mines ore. Your entire economy.',
    faction: Faction.Neutral, kind: EntityKind.Vehicle,
    cost: 1400, buildTime: 16, tab: BuildTab.Vehicles,
    prereqs: ['warFactory', 'refinery'], sortOrder: 10,
    model: 'allied_harvester',
    maxHp: 1000, armor: ArmorClass.Heavy, maxSpeed: 5.0, turnRate: 2.6 - U.harvester.l * 0.14,
    locomotor: Locomotor.Track, radius: hullRadius(U.harvester), sight: 20,
    weapons: UNARMED, hasTurret: false, crushLevel: 5, cargoMax: HARVESTER_CAPACITY,
  }),
  unit({
    key: 'mcv', name: 'Construction Vehicle', blurb: 'Deploys into a second base.',
    faction: Faction.Neutral, kind: EntityKind.Vehicle,
    cost: 3000, buildTime: 32, tab: BuildTab.Vehicles,
    prereqs: ['warFactory', 'battleLab'], sortOrder: 50,
    model: 'allied_dozer',
    maxHp: 1000, armor: ArmorClass.Heavy, maxSpeed: 4.2, turnRate: 2.6 - U.mcv.l * 0.14,
    locomotor: Locomotor.Wheel, radius: hullRadius(U.mcv), sight: 22,
    weapons: UNARMED, hasTurret: false, crushableBy: 0, deploysInto: 'conyard',
  }),

  /* -- Naval -------------------------------------------------------------- *
   * Locomotor.Hover across the board: `Locomotor` has no Naval member, and
   * `sim/Flowfield.ts` promotes a Hover unit to MoveClass.Naval the first time
   * it queries a water cell. Documented at `moveClassForLocomotor`.            */
  unit({
    key: 'transport', name: 'Hover Transport', blurb: 'Carries a squad across water.',
    faction: Faction.Neutral, kind: EntityKind.Vehicle,
    cost: 900, buildTime: 12, tab: BuildTab.Vehicles, prereqs: ['navalYard'], sortOrder: 60,
    model: 'allied_harvester',
    maxHp: 600, armor: ArmorClass.Light, maxSpeed: 6.0, turnRate: 2.6 - NU.transport.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.transport), sight: 26,
    weapons: UNARMED, hasTurret: false,
  }),
  unit({
    key: 'gunboat', name: 'Assault Destroyer', blurb: 'Allied escort. Shoots at everything.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 1000, buildTime: 14, tab: BuildTab.Vehicles, prereqs: ['navalYard'], sortOrder: 70,
    model: 'allied_destroyer',
    maxHp: 400, armor: ArmorClass.Light, maxSpeed: 7.0, turnRate: 2.6 - NU.gunboat.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.gunboat), sight: 34,
    weapons: [w('navalGun')], hasTurret: true,
  }),
  unit({
    key: 'destroyer', name: 'Aircraft Cruiser', blurb: 'Allied capital ship.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 1800, buildTime: 22, tab: BuildTab.Vehicles,
    prereqs: ['navalYard', 'battleLab'], sortOrder: 80,
    model: 'allied_destroyer',
    maxHp: 700, armor: ArmorClass.Medium, maxSpeed: 6.4, turnRate: 2.6 - NU.destroyer.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.destroyer), sight: 36,
    weapons: [w('navalGun')], hasTurret: true,
  }),
  unit({
    key: 'submarine', name: 'Attack Submarine', blurb: 'Soviet ambush hull.',
    faction: Faction.Soviets, kind: EntityKind.Vehicle,
    cost: 1000, buildTime: 14, tab: BuildTab.Vehicles, prereqs: ['subPen'], sortOrder: 70,
    model: 'soviet_dreadnought',
    maxHp: 500, armor: ArmorClass.Light, maxSpeed: 6.0, turnRate: 2.6 - NU.submarine.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.submarine), sight: 30,
    weapons: [w('torpedo')], hasTurret: false,
  }),
  unit({
    key: 'dreadnought', name: 'Dreadnought', blurb: 'Soviet siege ship.',
    faction: Faction.Soviets, kind: EntityKind.Vehicle,
    cost: 2000, buildTime: 24, tab: BuildTab.Vehicles,
    prereqs: ['subPen', 'battleLab'], sortOrder: 80,
    model: 'soviet_dreadnought',
    maxHp: 900, armor: ArmorClass.Heavy, maxSpeed: 4.0, turnRate: 2.6 - NU.dreadnought.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.dreadnought), sight: 38,
    weapons: [w('shipMissile')], hasTurret: true,
  }),
];

/* ==========================================================================
 * 2. BUILDINGS
 * ========================================================================== */

const B = BUILDING_DIMENSIONS;
const NB = NAVAL_BUILDING_DIMENSIONS;

interface BuildingSpec {
  key: string;
  name: string;
  blurb: string;
  faction: Faction;
  cost: number;
  buildTime: number;
  tab: BuildTab;
  prereqs: readonly string[];
  sortOrder: number;
  model: string;
  dim: { w: number; h: number; height: number };
  maxHp: number;
  power: number;
  sight: number;
  armor?: ArmorClass;
  weapons?: readonly number[];
  hasTurret?: boolean;
  produces?: readonly string[];
  producesTab?: BuildTab | -1;
  storage?: number;
  buildRadius?: number;
  /** Metres from the footprint's front edge that a produced unit appears at. */
  exitClearance?: number;
  dockOffsetX?: number;
  dockOffsetZ?: number;
}

/** Exit and dock offsets default to the middle of the +Z face, one clearance out. */
function building(s: BuildingSpec): BuildingDef {
  const halfDepth = s.dim.h * 4 /* CELL */ * 0.5;
  return {
    key: s.key,
    name: s.name,
    blurb: s.blurb,
    faction: s.faction,
    cost: s.cost,
    buildTime: s.buildTime,
    tab: s.tab,
    prereqs: s.prereqs,
    sortOrder: s.sortOrder,
    model: s.model,
    maxHp: s.maxHp,
    armor: s.armor ?? ArmorClass.Concrete,
    footprintW: s.dim.w,
    footprintH: s.dim.h,
    power: s.power,
    sight: s.sight,
    weapons: s.weapons ?? UNARMED,
    hasTurret: s.hasTurret ?? false,
    produces: s.produces ?? [],
    producesTab: s.producesTab ?? -1,
    exitOffsetX: 0,
    exitOffsetZ: halfDepth + (s.exitClearance ?? 4),
    dockOffsetX: s.dockOffsetX ?? 0,
    dockOffsetZ: s.dockOffsetZ ?? halfDepth + 4,
    storage: s.storage ?? 0,
    buildRadius: s.buildRadius ?? 0,
    // Same reasoning as UnitDef.flags: the fallback table owns the flag set and
    // `spawnBuilding` ORs this on top of it.
    flags: 0,
  };
}

export const BUILDINGS: readonly BuildingDef[] = [
  building({
    key: 'conyard', name: 'Construction Yard', blurb: 'Deploys your base. Builds structures.',
    faction: Faction.Neutral, cost: 3000, buildTime: 40, tab: BuildTab.Structures,
    prereqs: [], sortOrder: 0, model: 'conyard', dim: B.conYard,
    maxHp: 2000, power: -20, sight: 30, buildRadius: BUILD_RADIUS,
    producesTab: BuildTab.Structures,
  }),
  building({
    key: 'powerPlant', name: 'Power Plant', blurb: 'Generates 100 power. Everything else needs it.',
    faction: Faction.Neutral, cost: 300, buildTime: 8, tab: BuildTab.Structures,
    prereqs: ['conyard'], sortOrder: 10, model: 'powerPlant', dim: B.powerPlant,
    maxHp: 800, power: 100, sight: 18,
  }),
  building({
    key: 'refinery', name: 'Ore Refinery', blurb: 'Unloads harvesters. Ships with one.',
    faction: Faction.Neutral, cost: 2000, buildTime: 24, tab: BuildTab.Structures,
    prereqs: ['powerPlant'], sortOrder: 20, model: 'refinery', dim: B.refinery,
    maxHp: 1200, power: -30, sight: 22, storage: REFINERY_STORAGE,
  }),
  building({
    key: 'barracks', name: 'Barracks', blurb: 'Trains infantry.',
    faction: Faction.Neutral, cost: 500, buildTime: 10, tab: BuildTab.Structures,
    prereqs: ['powerPlant'], sortOrder: 30, model: 'barracks', dim: B.barracks,
    maxHp: 800, power: -20, sight: 20,
    produces: ['gi', 'conscript', 'attackDog', 'engineer'], producesTab: BuildTab.Infantry,
    // Infantry walk out of a door, not a vehicle ramp: half a cell is enough.
    exitClearance: 2,
  }),
  building({
    key: 'warFactory', name: 'War Factory', blurb: 'Builds vehicles. Sets a rally point.',
    faction: Faction.Neutral, cost: 2000, buildTime: 24, tab: BuildTab.Structures,
    prereqs: ['refinery'], sortOrder: 40, model: 'warFactory', dim: B.warFactory,
    maxHp: 1200, power: -40, sight: 20,
    produces: ['harvester', 'grizzly', 'rhino', 'ifv', 'prismTank', 'apocalypse', 'mcv'],
    producesTab: BuildTab.Vehicles,
    // A Rhino is 7 m long and leaves nose-first; anything under ~6 m and it
    // spawns intersecting its own factory's blocked footprint.
    exitClearance: 6,
  }),
  building({
    key: 'radar', name: 'Radar Dome', blurb: 'Reveals the minimap. Opens tier two.',
    faction: Faction.Neutral, cost: 1000, buildTime: 14, tab: BuildTab.Structures,
    prereqs: ['refinery'], sortOrder: 50, model: 'radar', dim: B.radar,
    maxHp: 700, power: -40, sight: 44,
  }),
  building({
    key: 'oreSilo', name: 'Ore Silo', blurb: 'Stores 1500 credits of ore.',
    faction: Faction.Neutral, cost: 150, buildTime: 5, tab: BuildTab.Structures,
    prereqs: ['refinery'], sortOrder: 60, model: 'oreSilo', dim: B.oreSilo,
    maxHp: 500, power: -10, sight: 12, storage: SILO_STORAGE,
  }),
  building({
    key: 'navalYard', name: 'Naval Yard', blurb: 'Builds Allied warships.',
    faction: Faction.Allies, cost: 1000, buildTime: 14, tab: BuildTab.Structures,
    prereqs: ['refinery'], sortOrder: 70, model: 'navalYard', dim: NB.navalYard,
    maxHp: 1000, power: -30, sight: 24,
    produces: ['transport', 'gunboat', 'destroyer'], producesTab: BuildTab.Vehicles,
    exitClearance: 8,
  }),
  building({
    key: 'subPen', name: 'Naval Pen', blurb: 'Builds Soviet warships.',
    faction: Faction.Soviets, cost: 1000, buildTime: 14, tab: BuildTab.Structures,
    prereqs: ['refinery'], sortOrder: 70, model: 'subPen', dim: NB.subPen,
    maxHp: 1000, power: -30, sight: 24,
    produces: ['transport', 'submarine', 'dreadnought'], producesTab: BuildTab.Vehicles,
    exitClearance: 8,
  }),
  building({
    key: 'battleLab', name: 'Battle Lab', blurb: 'Unlocks the top of every tab.',
    faction: Faction.Neutral, cost: 2000, buildTime: 24, tab: BuildTab.Structures,
    prereqs: ['radar'], sortOrder: 80, model: 'battleLab', dim: B.battleLab,
    maxHp: 900, power: -60, sight: 20,
  }),

  /* -- defences ----------------------------------------------------------- */
  building({
    key: 'wall', name: 'Concrete Wall', blurb: 'Stops vehicles. Stops nothing else.',
    faction: Faction.Neutral, cost: 100, buildTime: 2, tab: BuildTab.Defense,
    prereqs: ['barracks'], sortOrder: 10, model: 'wall', dim: B.wall,
    maxHp: 300, power: 0, sight: 0,
  }),
  building({
    key: 'pillbox', name: 'Pillbox', blurb: 'Cheap anti-infantry emplacement.',
    faction: Faction.Allies, cost: 400, buildTime: 8, tab: BuildTab.Defense,
    prereqs: ['barracks'], sortOrder: 20, model: 'pillbox', dim: B.pillbox,
    maxHp: 500, power: 0, sight: 26, weapons: [w('pillboxMg')],
  }),
  building({
    key: 'flameTower', name: 'Flame Tower', blurb: 'Short-ranged, brutal on infantry.',
    faction: Faction.Soviets, cost: 600, buildTime: 10, tab: BuildTab.Defense,
    prereqs: ['barracks'], sortOrder: 20, model: 'flameTower', dim: B.flameTower,
    maxHp: 550, power: -20, sight: 22, weapons: [w('flameJet')],
  }),
  building({
    key: 'prismTower', name: 'Prism Tower', blurb: 'Long-ranged beam defence. Needs power.',
    faction: Faction.Allies, cost: 1500, buildTime: 16, tab: BuildTab.Defense,
    prereqs: ['battleLab'], sortOrder: 30, model: 'prismTower', dim: B.prismTower,
    maxHp: 600, power: -50, sight: 30, weapons: [w('prismTowerBeam')], hasTurret: true,
  }),
  building({
    key: 'teslaCoil', name: 'Tesla Coil', blurb: 'Melts armour. Dies in a brownout.',
    faction: Faction.Soviets, cost: 1500, buildTime: 16, tab: BuildTab.Defense,
    prereqs: ['radar'], sortOrder: 30, model: 'teslaCoil', dim: B.teslaCoil,
    maxHp: 700, power: -75, sight: 30, weapons: [w('teslaBolt')],
  }),
];

/* ==========================================================================
 * 3. FACTIONS
 * ========================================================================== */

export const FACTIONS: readonly FactionDef[] = [
  {
    id: Faction.Allies, key: 'allies', name: 'Allied Forces', paletteKey: 'allies',
    startLoadout: ['gi', 'gi', 'grizzly'],
    conYardKey: 'conyard',
    defaultBuildOrder: [
      'powerPlant', 'refinery', 'barracks', 'warFactory',
      'powerPlant', 'radar', 'oreSilo', 'battleLab',
    ],
  },
  {
    id: Faction.Soviets, key: 'soviets', name: 'Soviet Union', paletteKey: 'soviets',
    startLoadout: ['conscript', 'conscript', 'rhino'],
    conYardKey: 'conyard',
    defaultBuildOrder: [
      'powerPlant', 'refinery', 'barracks', 'warFactory',
      'powerPlant', 'radar', 'oreSilo', 'battleLab',
    ],
  },
  {
    id: Faction.Neutral, key: 'neutral', name: 'Civilian', paletteKey: 'neutral',
    startLoadout: [], conYardKey: 'conyard', defaultBuildOrder: [],
  },
];

/* ==========================================================================
 * 4. THE TABLE
 *
 * `resolveDefBinding()` accepts the FIRST export in the FIRST module under
 * `src/data/**` (sorted by path) that has `units`/`buildings` arrays and
 * `unitByKey`/`buildingByKey` Maps. Everything above is exported too, but only
 * this object satisfies that shape.
 * ========================================================================== */

function indexBy(defs: readonly { key: string }[]): ReadonlyMap<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < defs.length; i++) {
    if (m.has(defs[i].key)) throw new Error(`[data] duplicate content key "${defs[i].key}"`);
    m.set(defs[i].key, i);
  }
  return m;
}

export const DEF_TABLES: DefTables = {
  units: UNITS,
  buildings: BUILDINGS,
  weapons: WEAPONS,
  factions: FACTIONS,
  armorMatrix: ARMOR_MATRIX,
  unitByKey: indexBy(UNITS),
  buildingByKey: indexBy(BUILDINGS),
};

export default DEF_TABLES;

/* ==========================================================================
 * 5. SELF-CHECK
 *
 * Runs at import in every environment. The failure this guards against is the
 * expensive one: a prereq or a `produces` entry naming a key that no longer
 * exists resolves to "permanently unbuildable" at runtime, which looks exactly
 * like a tech-tree balance decision and takes an hour to find.
 * ========================================================================== */

{
  const unitKeys = new Set(UNITS.map((u) => u.key));
  const buildingKeys = new Set(BUILDINGS.map((b) => b.key));
  const problems: string[] = [];

  for (const b of BUILDINGS) {
    for (const p of b.prereqs) {
      if (!buildingKeys.has(p)) problems.push(`building "${b.key}" needs unknown prereq "${p}"`);
    }
    for (const u of b.produces) {
      if (!unitKeys.has(u)) problems.push(`building "${b.key}" produces unknown unit "${u}"`);
    }
  }
  for (const u of UNITS) {
    for (const p of u.prereqs) {
      if (!buildingKeys.has(p)) problems.push(`unit "${u.key}" needs unknown prereq "${p}"`);
    }
    if (u.deploysInto !== null && !buildingKeys.has(u.deploysInto)) {
      problems.push(`unit "${u.key}" deploys into unknown "${u.deploysInto}"`);
    }
    for (const i of u.weapons) {
      if (i < 0 || i >= WEAPONS.length) problems.push(`unit "${u.key}" has weapon index ${i}`);
    }
  }
  if (ARMOR_MATRIX.length !== 7 || ARMOR_MATRIX.some((r) => r.length !== 6)) {
    problems.push('armorMatrix is not 7x6');
  }
  if (problems.length > 0) throw new Error(`[data] content errors:\n  ${problems.join('\n  ')}`);
}

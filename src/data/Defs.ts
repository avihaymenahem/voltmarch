/**
 * ============================================================================
 * VOLTMARCH — src/data/Defs.ts   THE CONTENT LAYER
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
 * THE WEAPON TABLE IS BORROWED, NOT REDECLARED — AND THEN APPENDED TO
 * -------------------------------------------------------------------
 * `store.weaponIndex[i]` is an index into whatever array `src/sim/Combat.ts`
 * is currently resolving against, which is `DEFAULT_WEAPONS` unless someone
 * calls `setWeaponTable`. A second, separately-authored armoury here would be
 * two tables that agree until the day one of them gets a row inserted, and then
 * every unit in the game would silently fire the wrong gun. So `WEAPONS` below
 * is `DEFAULT_WEAPONS` **verbatim as its prefix**, with the third faction's
 * guns APPENDED after it — index 0..17 keep meaning exactly what they meant,
 * and `src/sim/combat.system.ts` installs the longer table through
 * `setWeaponTable()` at boot. The self-check at the bottom asserts the prefix
 * property element-by-element, so the day someone inserts a row into
 * `DEFAULT_WEAPONS` this file fails loudly at import instead of quietly
 * re-arming the whole game.
 *
 * THE THIRD FACTION
 * -----------------
 * §6 adds THE MERIDIAN PACT (`Faction` id 3). Everything it needs that this
 * file can own lives here: its guns, its eleven units, its twelve structures,
 * its tech tree and its `FactionDef`. Two things it needs live in files this
 * module does not own, and both are listed in §7 — the enum member in
 * `core/types.ts` and the fallback rows in `game/Scenarios.ts`.
 *
 * This is the only place in the tree where `src/data` imports `src/sim`. It
 * cannot cycle: no file under `src/sim` imports `src/data` (they reach content
 * exclusively through `resolveDefBinding()`, which is a LAZY glob).
 * ============================================================================
 */

import {
  ARMOR_MATRIX, BUILDING_DIMENSIONS, BUILD_RADIUS, FACTION_PALETTE, HARVESTER_CAPACITY,
  NAVAL_BUILDING_DIMENSIONS, NAVAL_UNIT_DIMENSIONS, REFINERY_STORAGE, SILO_STORAGE,
  UNIT_DIMENSIONS,
} from '../core/config';
import {
  ArmorClass, BuildTab, EntityFlag, EntityKind, Faction, FxKind, Locomotor,
  PartId, ProjectileKind, WarheadClass,
} from '../core/types';
import type {
  BuildingDef, DefTables, FactionDef, FactionLook, UnitDef, WeaponDef,
} from '../core/types';
import { DEFAULT_WEAPONS, weaponIndexOf } from '../sim/Combat';

/* ==========================================================================
 * 0. THE ARMOURY
 * ========================================================================== */

/**
 * THE MERIDIAN PACT ID.
 *
 * Now a plain alias for the real enum member — `Faction.Meridian = 3` landed in
 * `core/types.ts`, `RenderBridge.factionSlot` widened to keep slot 3 a real
 * army rather than the wildcard, and `FACTION_PALETTE.meridian` exists. The
 * alias is kept because a dozen call sites and two test files import it.
 */
export const FACTION_MERIDIAN = Faction.Meridian;

/** Same shape as `Combat.wpn`, so the two tables read identically side by side. */
function wpn(
  key: string, name: string,
  damage: number, warhead: WarheadClass, range: number, cooldown: number,
  projectile: ProjectileKind, projectileSpeed: number,
  extra?: Partial<WeaponDef>,
): WeaponDef {
  return {
    key,
    name,
    damage,
    warhead,
    range,
    minRange: extra?.minRange ?? 0,
    cooldown,
    burstCount: extra?.burstCount ?? 1,
    burstDelay: extra?.burstDelay ?? 0.08,
    projectile,
    projectileSpeed,
    splashRadius: extra?.splashRadius ?? 0,
    splashFalloff: extra?.splashFalloff ?? 0.25,
    turretTurnRate: extra?.turretTurnRate ?? 110,
    requiresStop: extra?.requiresStop ?? false,
    needsPower: extra?.needsPower ?? false,
    canTargetInfantry: extra?.canTargetInfantry ?? true,
    muzzleFx: extra?.muzzleFx ?? FxKind.MuzzleFlashSmall,
    travelFx: extra?.travelFx ?? FxKind.TracerBullet,
    impactFx: extra?.impactFx ?? FxKind.ImpactMetal,
    muzzleParts: extra?.muzzleParts ?? [PartId.MuzzleA],
    chainCount: extra?.chainCount ?? 0,
  };
}

const MUZZLE_PAIR: readonly PartId[] = [PartId.MuzzleA, PartId.MuzzleB];

/**
 * THE PACT ARMOURY. Appended to `DEFAULT_WEAPONS`, never interleaved with it.
 *
 * Read these against the two existing armies rather than in isolation. The
 * doctrine is three sentences:
 *
 *   1. Pact guns out-RANGE their opposite number by 1-3 m and under-DAMAGE it,
 *      so a Pact line wins a standoff and loses a brawl.
 *   2. The two best guns in the list (`zenithBeam`, `heliosLance`) carry
 *      `needsPower`. That is the faction's whole risk profile: the Solar Array
 *      is cheap, generous and made of glass, and when the grid browns out the
 *      Pact's teeth stop while its economy keeps running.
 *   3. Nothing here is `Tesla` or `SmallArms`-heavy. The Pact answers armour
 *      and structures well and answers massed infantry poorly, which is the
 *      hole the Soviets are built to exploit.
 */
export const MERIDIAN_WEAPONS: readonly WeaponDef[] = [
  /* 18 */ wpn('pulseCarbine', 'Pulse Carbine', 15, WarheadClass.SmallArms, 20, 0.80,
    ProjectileKind.Bullet, 105,
    { burstCount: 3, burstDelay: 0.08, turretTurnRate: 320,
      muzzleFx: FxKind.MuzzleFlashSmall, travelFx: FxKind.TracerBullet, impactFx: FxKind.ImpactDirt }),

  /* 19 */ wpn('sunLance', 'Sun Lance', 58, WarheadClass.Rocket, 26, 2.4,
    ProjectileKind.Rocket, 42,
    { splashRadius: 2.0, splashFalloff: 0.30, turretTurnRate: 260,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.RocketTrail, impactFx: FxKind.ExplosionSmall }),

  /* 20 */ wpn('arcRepeater', 'Arc Repeater', 19, WarheadClass.AutoCannon, 23, 0.55,
    ProjectileKind.Bullet, 155,
    { burstCount: 4, burstDelay: 0.07, turretTurnRate: 210,
      muzzleFx: FxKind.MuzzleFlashSmall, travelFx: FxKind.TracerBullet, impactFx: FxKind.Sparks }),

  /* 21 */ wpn('focusLance', 'Focus Lance', 60, WarheadClass.ArmorPiercing, 26, 1.6,
    ProjectileKind.Bullet, 135,
    { splashRadius: 1.4, splashFalloff: 0.30, turretTurnRate: 110,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.TracerCannon, impactFx: FxKind.ImpactMetal }),

  /* 22 */ wpn('zenithBeam', 'Zenith Emitter', 94, WarheadClass.Prism, 33, 2.9,
    ProjectileKind.Beam, 0,
    { turretTurnRate: 65, requiresStop: true, needsPower: true,
      muzzleFx: FxKind.None, travelFx: FxKind.PrismBeam, impactFx: FxKind.Sparks }),

  /* 23 */ wpn('glaiveRepeater', 'Glaive Repeater', 21, WarheadClass.SmallArms, 24, 0.45,
    ProjectileKind.Bullet, 118,
    { burstCount: 5, burstDelay: 0.06, turretTurnRate: 260,
      muzzleFx: FxKind.MuzzleFlashSmall, travelFx: FxKind.TracerBullet, impactFx: FxKind.ImpactDirt }),

  /* 24 */ wpn('heliosLance', 'Helios Lance', 116, WarheadClass.Prism, 33, 2.8,
    ProjectileKind.Beam, 0,
    { turretTurnRate: 70, needsPower: true,
      muzzleFx: FxKind.None, travelFx: FxKind.PrismBeam, impactFx: FxKind.Sparks }),

  /* 25 */ wpn('mirrorGun', 'Mirror Battery', 70, WarheadClass.HighExplosive, 33, 2.1,
    ProjectileKind.Shell, 76,
    { splashRadius: 3.4, splashFalloff: 0.25, turretTurnRate: 80,
      muzzleFx: FxKind.MuzzleFlashLarge, travelFx: FxKind.TracerCannon, impactFx: FxKind.ExplosionSmall }),

  /* 26 */ wpn('kestrelPod', 'Kestrel Pod', 44, WarheadClass.Rocket, 22, 1.9,
    ProjectileKind.Rocket, 48,
    { burstCount: 2, burstDelay: 0.16, splashRadius: 1.8, splashFalloff: 0.30,
      turretTurnRate: 300, muzzleParts: MUZZLE_PAIR,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.RocketTrail, impactFx: FxKind.ExplosionSmall }),

  /* 27 */ wpn('monitorLance', 'Monitor Lance', 110, WarheadClass.Rocket, 40, 3.8,
    ProjectileKind.Rocket, 46,
    { burstCount: 2, burstDelay: 0.32, splashRadius: 4.2, splashFalloff: 0.25,
      turretTurnRate: 55, muzzleParts: MUZZLE_PAIR,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.RocketTrail, impactFx: FxKind.ExplosionMedium }),
];

/**
 * The live armoury: the sim's table verbatim, then the Pact's. The prefix
 * property is ASSERTED in §5, not assumed.
 */
export const WEAPONS: readonly WeaponDef[] = [...DEFAULT_WEAPONS, ...MERIDIAN_WEAPONS];

const WEAPON_INDEX: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (let i = 0; i < WEAPONS.length; i++) {
    if (m.has(WEAPONS[i].key)) throw new Error(`[data] duplicate weapon key "${WEAPONS[i].key}"`);
    m.set(WEAPONS[i].key, i);
  }
  return m;
})();

/**
 * A -1 in a def's `weapons` array would make `spawnUnit` write
 * `weaponIndex = -1`, which reads as "unarmed" and would quietly disarm the
 * unit. Fail loudly at module load instead — this runs once, at import, in
 * every environment including tests.
 */
function w(key: string): number {
  const i = WEAPON_INDEX.get(key) ?? -1;
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
  /**
   * Entity flags ORed ON TOP of the fallback row's.
   *
   * Left at 0 for every Allied and Soviet key, and that is deliberate: those
   * keys all have a row in `Scenarios.FALLBACK_UNITS` which already carries
   * CanMove/ProvidesVision/CanAttack/Crushable/IsHarvester, and repeating them
   * here would be two owners for one bitfield.
   *
   * The Meridian keys are new, so they have NO fallback row, so nothing else
   * in the process will ever set `IsHarvester` on a Sun Collector. They author
   * their own full flag set here. See §7 — the fallback rows are the one thing
   * this faction needs that this file cannot publish.
   */
  flags?: number;
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
    // Zero for the two original armies on purpose: `ScenarioBuilder.spawnUnit`
    // ORs this ON TOP of the fallback's flags, which already carry CanMove/
    // ProvidesVision/CanAttack/Crushable/IsHarvester, and a divergence between
    // two owners of one bitfield is a bug with no error message. The Meridian
    // keys have no fallback row and so own theirs outright — see `UnitSpec.flags`.
    flags: s.flags ?? 0,
  };
}

/* -- the Meridian flag kit, so eleven defs cannot drift from one another --- */
const MRD_MOVER = EntityFlag.CanMove | EntityFlag.ProvidesVision;
const MRD_FOOT = MRD_MOVER | EntityFlag.Crushable;
const MRD_GUNNER = MRD_MOVER | EntityFlag.CanAttack;
const MRD_TURRETED = MRD_GUNNER | EntityFlag.HasTurret;

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

  /* ======================================================================
   * THE MERIDIAN PACT
   *
   * THE TWO RULES THAT MAKE THE ARMY, and every number below is one of them:
   *
   * 1. NOTHING THE PACT FIELDS TOUCHES THE GROUND. Every Meridian vehicle,
   *    ship and flyer is `Locomotor.Hover`, which `sim/Flowfield.ts` promotes
   *    to MoveClass.Naval the first time it queries a water cell — so the whole
   *    army is amphibious, ignores slope cost, and can open a second front
   *    across any lake on the map. The price is paid twice: `crushLevel: 0` on
   *    everything (a skirt cannot crush a conscript, so the Pact never wins a
   *    ram) and one armour class lower than the equivalent tracked hull.
   *
   * 2. SHIELDS STOP SHELLS, NOT BULLETS. The main line is ArmorClass.Light
   *    with a deep HP pool instead of ArmorClass.Medium/Heavy with a shallow
   *    one. Read that against ARMOR_MATRIX: AP falls from 1.00 to 0.85 and
   *    Rocket from 0.90 to 0.95, but AutoCannon RISES from 0.65 to 1.00 and
   *    SmallArms from 0.28 to 0.55. A Solarch trades evenly with a Grizzly and
   *    is deleted by an IFV or a squad of Conscripts. That hole is the reason
   *    the faction is not simply better.
   * ====================================================================== */

  /* -- Meridian infantry -------------------------------------------------- */
  unit({
    key: 'mrdWayfarer', name: 'Wayfarer', blurb: 'Line infantry. Long eyes, thin skin.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Infantry,
    cost: 175, buildTime: 5, tab: BuildTab.Infantry,
    prereqs: ['mrdChapterhouse'], sortOrder: 10,
    model: 'meridian_wayfarer',
    maxHp: 110, armor: ArmorClass.Infantry, maxSpeed: 3.8, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 26,
    weapons: [w('pulseCarbine')], hasTurret: false, crushableBy: 1,
    flags: MRD_FOOT | EntityFlag.CanAttack,
  }),
  unit({
    key: 'mrdLancer', name: 'Sunlancer', blurb: 'Shoulder lance. Kills armour and aircraft.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Infantry,
    cost: 450, buildTime: 8, tab: BuildTab.Infantry,
    prereqs: ['mrdChapterhouse', 'mrdOculus'], sortOrder: 20,
    model: 'meridian_lancer',
    maxHp: 130, armor: ArmorClass.Infantry, maxSpeed: 3.2, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 26,
    weapons: [w('sunLance')], hasTurret: false, crushableBy: 1,
    flags: MRD_FOOT | EntityFlag.CanAttack,
  }),
  unit({
    key: 'mrdArtificer', name: 'Artificer', blurb: 'Captures structures. Repairs them.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Infantry,
    cost: 500, buildTime: 10, tab: BuildTab.Infantry,
    prereqs: ['mrdChapterhouse', 'mrdCistern'], sortOrder: 30,
    model: 'meridian_artificer',
    maxHp: 95, armor: ArmorClass.Infantry, maxSpeed: 3.6, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 22,
    weapons: UNARMED, hasTurret: false, crushableBy: 1, canCapture: true,
    flags: MRD_FOOT,
  }),

  /* -- Meridian vehicles --------------------------------------------------- */
  unit({
    key: 'mrdCollector', name: 'Sun Collector', blurb: 'Half the load, twice the trips.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 1000, buildTime: 13, tab: BuildTab.Vehicles,
    prereqs: ['mrdForgeyard', 'mrdCistern'], sortOrder: 10,
    model: 'meridian_collector',
    // 450 of ore against the shared harvester's 700, at 40% more speed and
    // 400 fewer credits: roughly the same throughput per minute, spent on
    // more round trips through open ground. The Pact economy is not richer,
    // it is more exposed, and it recovers from losing a collector faster.
    maxHp: 800, armor: ArmorClass.Light, maxSpeed: 7.0, turnRate: 2.6 - U.harvester.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(U.harvester), sight: 22,
    weapons: UNARMED, hasTurret: false, cargoMax: 450, crushableBy: 6,
    flags: MRD_MOVER | EntityFlag.IsHarvester,
  }),
  unit({
    key: 'mrdSkiff', name: 'Sandskiff', blurb: 'Fastest hull on the map. Made of foil.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 550, buildTime: 9, tab: BuildTab.Vehicles,
    prereqs: ['mrdForgeyard'], sortOrder: 20,
    model: 'meridian_skiff',
    maxHp: 190, armor: ArmorClass.Light, maxSpeed: 9.2, turnRate: 2.6 - U.ifv.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(U.ifv), sight: 32,
    weapons: [w('arcRepeater')], hasTurret: true, crushableBy: 4,
    flags: MRD_TURRETED,
  }),
  unit({
    key: 'mrdSolarch', name: 'Solarch', blurb: 'The Pact main line. Outranges, never brawls.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 800, buildTime: 12, tab: BuildTab.Vehicles,
    prereqs: ['mrdForgeyard'], sortOrder: 30,
    model: 'meridian_solarch',
    maxHp: 330, armor: ArmorClass.Light, maxSpeed: 7.6, turnRate: 2.6 - U.lightTank.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(U.lightTank), sight: 30,
    weapons: [w('focusLance')], hasTurret: true, crushableBy: 5,
    flags: MRD_TURRETED,
  }),
  unit({
    key: 'mrdZenith', name: 'Zenith Emitter', blurb: 'Siege beam. Dies in a brownout.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 1500, buildTime: 19, tab: BuildTab.Vehicles,
    prereqs: ['mrdForgeyard', 'mrdReliquary'], sortOrder: 40,
    model: 'meridian_zenith',
    maxHp: 240, armor: ArmorClass.Light, maxSpeed: 6.2, turnRate: 2.6 - U.prismTank.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(U.prismTank), sight: 34,
    weapons: [w('zenithBeam')], hasTurret: true, crushableBy: 5,
    flags: MRD_TURRETED,
  }),
  unit({
    key: 'mrdCarryall', name: 'Pactworks Carryall', blurb: 'Deploys into a second Conclave.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 3000, buildTime: 32, tab: BuildTab.Vehicles,
    prereqs: ['mrdForgeyard', 'mrdReliquary'], sortOrder: 50,
    model: 'meridian_carryall',
    maxHp: 950, armor: ArmorClass.Heavy, maxSpeed: 5.0, turnRate: 2.6 - U.mcv.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(U.mcv), sight: 22,
    weapons: UNARMED, hasTurret: false, crushableBy: 0, deploysInto: 'mrdConclave',
    flags: MRD_MOVER,
  }),

  /* -- Meridian air --------------------------------------------------------
   * `Locomotor` has no Air member and nothing in the sim flies yet, so the
   * Kestrel is authored the way the naval hulls are: a Hover locomotor with a
   * flyer's speed, sight and paper armour. When an Air locomotor lands this is
   * a one-line change and the stats already read as a gunship.               */
  unit({
    key: 'mrdKestrel', name: 'Kestrel Gunship', blurb: 'Fast rocket pods. Nothing to shoot back with.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 1100, buildTime: 15, tab: BuildTab.Vehicles,
    prereqs: ['mrdForgeyard', 'mrdOculus'], sortOrder: 60,
    model: 'meridian_kestrel',
    maxHp: 210, armor: ArmorClass.Light, maxSpeed: 12.0, turnRate: 3.2,
    locomotor: Locomotor.Hover, radius: hullRadius(U.ifv), sight: 36,
    weapons: [w('kestrelPod')], hasTurret: false, crushableBy: 0,
    flags: MRD_GUNNER,
  }),

  /* -- Meridian naval ------------------------------------------------------ */
  unit({
    key: 'mrdCorvette', name: 'Kite Corvette', blurb: 'Escort hull. Shells shorelines.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 950, buildTime: 13, tab: BuildTab.Vehicles,
    prereqs: ['mrdSlipway'], sortOrder: 70,
    model: 'meridian_corvette',
    maxHp: 380, armor: ArmorClass.Light, maxSpeed: 7.6, turnRate: 2.6 - NU.gunboat.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.gunboat), sight: 34,
    weapons: [w('mirrorGun')], hasTurret: true,
    flags: MRD_TURRETED,
  }),
  unit({
    key: 'mrdMonitor', name: 'Sunmonitor', blurb: 'Pact capital ship. Forty metres of reach.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 1900, buildTime: 23, tab: BuildTab.Vehicles,
    prereqs: ['mrdSlipway', 'mrdReliquary'], sortOrder: 80,
    model: 'meridian_monitor',
    maxHp: 780, armor: ArmorClass.Medium, maxSpeed: 5.6, turnRate: 2.6 - NU.destroyer.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.destroyer), sight: 38,
    weapons: [w('monitorLance')], hasTurret: true,
    flags: MRD_TURRETED,
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
  /** See `UnitSpec.flags`. Zero for the two original armies, authored for the Pact. */
  flags?: number;
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
    // Same reasoning as UnitDef.flags: for the two original armies the fallback
    // table owns the flag set and `spawnBuilding` ORs this on top of it. The
    // Meridian keys have no fallback row and author their own.
    flags: s.flags ?? 0,
  };
}

/**
 * The Meridian structure flag kit. `Scenarios.building()` derives NeedsPower
 * from a negative power draw; nothing derives it here, so it is written out.
 */
const MRD_STRUCTURE =
  EntityFlag.BlocksNav | EntityFlag.Powered | EntityFlag.Sellable | EntityFlag.ProvidesVision;
function mrdFlags(power: number, extra = 0): number {
  return MRD_STRUCTURE | extra | (power < 0 ? EntityFlag.NeedsPower : 0);
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
  // The two rows the models audit asked for. `allied_aa` and `soviet_sentry`
  // were finished models doing stand-in duty for the Prism Tower and the Flame
  // Tower, both of which now have their own art; these give them real defs and
  // make the two armies' defence sets symmetric — a cheap gun, a heavy gun and
  // one that dies in a brownout, each side.
  building({
    key: 'aaTurret', name: 'Multigunner AA', blurb: 'Flak battery. Reaches what tanks cannot.',
    faction: Faction.Allies, cost: 800, buildTime: 12, tab: BuildTab.Defense,
    prereqs: ['radar'], sortOrder: 25, model: 'aaTurret', dim: B.prismTower,
    maxHp: 550, power: -30, sight: 28, weapons: [w('aaCannon')], hasTurret: true,
  }),
  building({
    key: 'sentryGun', name: 'Sentry Gun', blurb: 'Cheap anti-infantry emplacement.',
    faction: Faction.Soviets, cost: 400, buildTime: 8, tab: BuildTab.Defense,
    prereqs: ['barracks'], sortOrder: 25, model: 'sentryGun', dim: B.pillbox,
    maxHp: 480, power: 0, sight: 24, weapons: [w('pillboxMg')],
  }),

  /* ======================================================================
   * THE MERIDIAN PACT — THE BASE
   *
   * THE SIGNATURE: THE GRID IS THE ARMY. The Solar Array is the cheapest
   * power in the game per credit (350 for 160, against 300 for 100) and the
   * most fragile structure any faction fields (420 hp against 800). The Pact
   * therefore reaches tier two a full Power Plant earlier than either rival —
   * and both of its defences plus its siege tank carry `needsPower` weapons,
   * so four Sandskiffs behind the lines can silence a whole defensive belt
   * without touching a single Glaive Post.
   *
   * The rest of the line is deliberately NOT cheaper: every economy and tech
   * building is priced at the shared curve to the credit, because the faction
   * is supposed to feel like a different shape, not like a discount.
   * ====================================================================== */
  building({
    key: 'mrdConclave', name: 'Conclave', blurb: 'Unfolds the Pact. Builds structures.',
    faction: FACTION_MERIDIAN, cost: 3000, buildTime: 40, tab: BuildTab.Structures,
    prereqs: [], sortOrder: 0, model: 'meridian_conclave', dim: B.conYard,
    maxHp: 1900, power: -20, sight: 30, buildRadius: BUILD_RADIUS,
    producesTab: BuildTab.Structures,
    flags: mrdFlags(-20, EntityFlag.IsBuilder | EntityFlag.IsFactory | EntityFlag.PrimaryFactory),
  }),
  building({
    key: 'mrdSolarArray', name: 'Solar Array', blurb: 'Generates 160 power. Made of mirrors.',
    faction: FACTION_MERIDIAN, cost: 350, buildTime: 8, tab: BuildTab.Structures,
    prereqs: ['mrdConclave'], sortOrder: 10, model: 'meridian_solararray', dim: B.powerPlant,
    maxHp: 420, power: 160, sight: 18,
    flags: mrdFlags(160),
  }),
  building({
    key: 'mrdCistern', name: 'Ore Cistern', blurb: 'Unloads collectors. Ships with one.',
    faction: FACTION_MERIDIAN, cost: 2000, buildTime: 24, tab: BuildTab.Structures,
    prereqs: ['mrdSolarArray'], sortOrder: 20, model: 'meridian_cistern', dim: B.refinery,
    maxHp: 1150, power: -30, sight: 22, storage: REFINERY_STORAGE,
    flags: mrdFlags(-30, EntityFlag.IsRefinery),
  }),
  building({
    key: 'mrdChapterhouse', name: 'Chapterhouse', blurb: 'Trains Pact infantry.',
    faction: FACTION_MERIDIAN, cost: 500, buildTime: 10, tab: BuildTab.Structures,
    prereqs: ['mrdSolarArray'], sortOrder: 30, model: 'meridian_chapterhouse', dim: B.barracks,
    maxHp: 750, power: -20, sight: 20,
    produces: ['mrdWayfarer', 'mrdLancer', 'mrdArtificer'], producesTab: BuildTab.Infantry,
    exitClearance: 2,
    flags: mrdFlags(-20, EntityFlag.IsFactory | EntityFlag.PrimaryFactory),
  }),
  building({
    key: 'mrdForgeyard', name: 'Forgeyard', blurb: 'Builds every Pact hull. Sets a rally point.',
    faction: FACTION_MERIDIAN, cost: 2000, buildTime: 24, tab: BuildTab.Structures,
    prereqs: ['mrdCistern'], sortOrder: 40, model: 'meridian_forgeyard', dim: B.warFactory,
    maxHp: 1150, power: -40, sight: 20,
    produces: ['mrdCollector', 'mrdSkiff', 'mrdSolarch', 'mrdZenith', 'mrdKestrel', 'mrdCarryall'],
    producesTab: BuildTab.Vehicles,
    exitClearance: 6,
    flags: mrdFlags(-40, EntityFlag.IsFactory | EntityFlag.PrimaryFactory),
  }),
  building({
    key: 'mrdOculus', name: 'Oculus', blurb: 'Reveals the minimap. Opens tier two.',
    faction: FACTION_MERIDIAN, cost: 1000, buildTime: 14, tab: BuildTab.Structures,
    prereqs: ['mrdCistern'], sortOrder: 50, model: 'meridian_oculus', dim: B.radar,
    maxHp: 650, power: -40, sight: 46,
    flags: mrdFlags(-40, EntityFlag.IsRadar),
  }),
  building({
    key: 'mrdVault', name: 'Sun Vault', blurb: 'Stores 1500 credits of ore.',
    faction: FACTION_MERIDIAN, cost: 150, buildTime: 5, tab: BuildTab.Structures,
    prereqs: ['mrdCistern'], sortOrder: 60, model: 'meridian_vault', dim: B.oreSilo,
    maxHp: 450, power: -10, sight: 12, storage: SILO_STORAGE,
    flags: mrdFlags(-10),
  }),
  building({
    key: 'mrdSlipway', name: 'Slipway', blurb: 'Builds Pact warships.',
    faction: FACTION_MERIDIAN, cost: 1000, buildTime: 14, tab: BuildTab.Structures,
    prereqs: ['mrdCistern'], sortOrder: 70, model: 'meridian_slipway', dim: NB.navalYard,
    maxHp: 950, power: -30, sight: 24,
    produces: ['mrdCorvette', 'mrdMonitor'], producesTab: BuildTab.Vehicles,
    exitClearance: 8,
    flags: mrdFlags(-30, EntityFlag.IsFactory | EntityFlag.PrimaryFactory),
  }),
  building({
    key: 'mrdReliquary', name: 'Reliquary', blurb: 'Unlocks the top of every tab.',
    faction: FACTION_MERIDIAN, cost: 2000, buildTime: 24, tab: BuildTab.Structures,
    prereqs: ['mrdOculus'], sortOrder: 80, model: 'meridian_reliquary', dim: B.battleLab,
    maxHp: 850, power: -60, sight: 20,
    flags: mrdFlags(-60),
  }),

  /* -- Meridian defences --------------------------------------------------- */
  building({
    key: 'mrdRampart', name: 'Rampart', blurb: 'Stops vehicles. Stops nothing else.',
    faction: FACTION_MERIDIAN, cost: 100, buildTime: 2, tab: BuildTab.Defense,
    prereqs: ['mrdChapterhouse'], sortOrder: 10, model: 'meridian_rampart', dim: B.wall,
    maxHp: 320, power: 0, sight: 0,
    flags: mrdFlags(0, EntityFlag.NotSelectable),
  }),
  building({
    key: 'mrdGlaive', name: 'Glaive Post', blurb: 'Anti-infantry repeater. Needs the grid.',
    faction: FACTION_MERIDIAN, cost: 450, buildTime: 8, tab: BuildTab.Defense,
    prereqs: ['mrdChapterhouse'], sortOrder: 20, model: 'meridian_glaive', dim: B.pillbox,
    maxHp: 480, power: -10, sight: 26, weapons: [w('glaiveRepeater')],
    flags: mrdFlags(-10, EntityFlag.CanAttack),
  }),
  building({
    key: 'mrdHelios', name: 'Helios Spire', blurb: 'Long beam defence. Dark in a brownout.',
    faction: FACTION_MERIDIAN, cost: 1500, buildTime: 16, tab: BuildTab.Defense,
    prereqs: ['mrdReliquary'], sortOrder: 30, model: 'meridian_helios', dim: B.prismTower,
    maxHp: 600, power: -55, sight: 32, weapons: [w('heliosLance')], hasTurret: true,
    flags: mrdFlags(-55, EntityFlag.CanAttack | EntityFlag.HasTurret),
  }),
];

/* ==========================================================================
 * 3. FACTIONS
 * ========================================================================== */

/**
 * THE PACT'S COLOURS.
 *
 * `FactionDef` has no colour fields — it carries a `paletteKey` into
 * `FACTION_PALETTE` in config.ts, which is where this look now lives, next to
 * ALLIES_LOOK and SOVIETS_LOOK. Re-exported from here because
 * `src/art/Faction3Units.ts` and `src/art/Faction3Buildings.ts` import it by
 * this name.
 *
 * The brief for the palette was "as different from Allied chrome-and-cobalt and
 * Soviet olive-and-rust as those two are from each other", so it moves on all
 * three axes at once: the hull is WARM (bone ceramic, not cool grey and not
 * olive), the team colour is the third primary nobody has taken (jade, against
 * cobalt and crimson), and the accents are GOLD rather than the Allied cyan or
 * the Soviet furnace orange.
 */
export const MERIDIAN_LOOK: FactionLook = FACTION_PALETTE.meridian;

/** What the HUD skin should tint to for a Pact player. */
export const MERIDIAN_HUD_ACCENT = MERIDIAN_LOOK.hudAccent;

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
    id: FACTION_MERIDIAN, key: 'meridian', name: 'Meridian Pact',
    paletteKey: 'meridian',
    startLoadout: ['mrdWayfarer', 'mrdWayfarer', 'mrdSolarch'],
    conYardKey: 'mrdConclave',
    // Array before Chapterhouse before Cistern: 350 for 160 power means the
    // Pact can afford the barracks off ONE array where the other two armies
    // need a second plant, and the whole opening is built on that gap.
    defaultBuildOrder: [
      'mrdSolarArray', 'mrdChapterhouse', 'mrdCistern', 'mrdForgeyard',
      'mrdSolarArray', 'mrdOculus', 'mrdVault', 'mrdReliquary',
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

  /* -- the armoury prefix property -------------------------------------- *
   * `store.weaponIndex` is a bare integer. Every unit spawned before
   * `setWeaponTable(WEAPONS)` runs — and every unit whose weapon the shape
   * heuristic in Combat.ts resolves — indexes DEFAULT_WEAPONS. If a row is
   * ever inserted into DEFAULT_WEAPONS rather than appended, the two tables
   * disagree by one from that row onward and every unit in the game silently
   * fires its neighbour's gun. That is the failure this loop exists to make
   * impossible.                                                             */
  for (let i = 0; i < DEFAULT_WEAPONS.length; i++) {
    if (WEAPONS[i] !== DEFAULT_WEAPONS[i]) {
      problems.push(
        `weapon table diverges from the sim armoury at index ${i} ` +
        `("${WEAPONS[i]?.key}" vs "${DEFAULT_WEAPONS[i].key}") — WEAPONS must be ` +
        'DEFAULT_WEAPONS verbatim followed by the appended rows');
      break;
    }
  }
  for (const d of DEFAULT_WEAPONS) {
    if (weaponIndexOf(d.key) !== (WEAPON_INDEX.get(d.key) ?? -1)) {
      problems.push(`weapon "${d.key}" resolves to a different index here than in the sim`);
    }
  }

  /* -- the third faction ------------------------------------------------- */
  const factionIds = new Set(FACTIONS.map((f) => f.id as number));
  if (!factionIds.has(FACTION_MERIDIAN as number)) {
    problems.push('the Meridian Pact has no FactionDef');
  }
  for (const f of FACTIONS) {
    if (f.conYardKey !== '' && !buildingKeys.has(f.conYardKey)) {
      problems.push(`faction "${f.key}" deploys into unknown "${f.conYardKey}"`);
    }
    for (const k of f.startLoadout) {
      if (!unitKeys.has(k)) problems.push(`faction "${f.key}" starts with unknown unit "${k}"`);
    }
    for (const k of f.defaultBuildOrder) {
      if (!buildingKeys.has(k)) problems.push(`faction "${f.key}" opens with unknown "${k}"`);
    }
  }
  // Every Pact key must belong to the Pact: a Meridian def that slipped back to
  // Faction.Neutral would appear in BOTH original armies' sidebars.
  for (const d of [...UNITS, ...BUILDINGS]) {
    const prefixed = d.key.startsWith('mrd');
    const owned = (d.faction as number) === (FACTION_MERIDIAN as number);
    if (prefixed !== owned) {
      problems.push(`"${d.key}" is ${prefixed ? '' : 'not '}Meridian-keyed but ${owned ? '' : 'not '}Meridian-owned`);
    }
  }

  if (problems.length > 0) throw new Error(`[data] content errors:\n  ${problems.join('\n  ')}`);
}

/* ==========================================================================
 * 6. WHAT THE THIRD FACTION STILL NEEDS FROM FILES THIS MODULE DOES NOT OWN
 *
 * Everything above compiles, self-checks and binds today: `resolveDefBinding()`
 * indexes all eleven Meridian units and all twelve Meridian structures by key,
 * so `src/art/Faction3*.ts` can and does register real art against real defIds.
 * What it CANNOT yet do is get a Meridian unit onto the map, because two
 * gatekeepers upstream of the def tables are keyed on tables in other modules:
 *
 *   1. `src/core/types.ts`
 *        export const enum Faction { Neutral = 0, Allies = 1, Soviets = 2,
 *                                    Meridian = 3 }
 *        export const FACTION_COUNT = 4;
 *      and widen `FactionDef.paletteKey` to include 'meridian'.
 *      Then `FACTION_MERIDIAN` above collapses to `Faction.Meridian`.
 *
 *   2. `src/game/Scenarios.ts` — `FALLBACK_UNITS` / `FALLBACK_BUILDINGS`.
 *      `Production.spawnUnit` opens with `const fb = FALLBACK_UNITS[entry.key];
 *      if (fb === undefined) return NONE;` and `resolveEntry` drops any spec
 *      with no fallback row. A row per Meridian key is required, and every
 *      number it needs is already here — hp, armour, speed, sight, footprint,
 *      power, storage and the full flag set are all authored above, so the rows
 *      are a mechanical transcription with no balance decisions in them.
 *
 *   3. `src/sim/Production.ts` — `CONTENT` is the authored tech tree the
 *      sidebar reads, and `ProductionCatalog`'s roster loop is
 *      `for (const faction of [Faction.Allies, Faction.Soviets])`. Both need
 *      the Pact: a `ContentSpec` per key (cost/buildTime/tab/prereqs/sortOrder
 *      are all above, verbatim) and `Faction.Meridian` in that array.
 *
 *   4. `src/core/config.ts` — `FACTION_PALETTE.meridian = MERIDIAN_LOOK`,
 *      `RA3_UNIT_PALETTE.meridian`, `RA3_STRUCTURE_PALETTE.meridian` and
 *      `RA3_PAD_PALETTE.meridian`. The unit and structure palettes are already
 *      authored in `src/art/Faction3Units.ts` / `Faction3Buildings.ts` and are
 *      exported from there, so this is a move rather than a design pass.
 *
 *   5. `src/ui/Chrome.ts` — `factionKey()` and `skinFor()` are binary
 *      (`faction === Faction.Soviets ? soviets : allies`). A Pact player gets
 *      the Allied skin until they learn a third answer; nothing breaks.
 * ========================================================================== */

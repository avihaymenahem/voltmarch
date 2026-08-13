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
  ARMOR_MATRIX, AbilityId, BUILDING_DIMENSIONS, BUILD_RADIUS, FACTION_PALETTE,
  HARVESTER_CAPACITY, NAVAL_BUILDING_DIMENSIONS, NAVAL_UNIT_DIMENSIONS, REFINERY_STORAGE,
  SILO_STORAGE, UNIT_DIMENSIONS,
} from '../core/config';
import {
  ArmorClass, BuildTab, EntityFlag, EntityKind, Faction, FxKind, Locomotor,
  PartId, ProjectileKind, WarheadClass,
} from '../core/types';
import type {
  BuildingDef, DefTables, FactionDef, FactionLook, UnitDef, WeaponDef,
} from '../core/types';
import { DEFAULT_WEAPONS, weaponIndexOf } from '../sim/Combat';
// The neutral map furniture's footprints, shared verbatim with the fallback
// table in `src/game/Scenarios.ts` and the mass lists in
// `src/art/BuildingDefs.ts`. One constant, three readers — see that file's
// header for why the art half matters as much as the sim half.
import { CIVILIAN_DIMENSIONS as CIV } from './Civilians';
// The mission table is the ONLY authority on which unlock ids exist. Importing
// it here (rather than restating the ids) is what makes a typo in UNLOCK_TAGS a
// load-time error instead of a permanently unbuildable unit. The edge is one
// way and cycle-free: Missions.ts imports core/types and progression/types and
// nothing else.
import { MISSION_UNLOCK_IDS } from './Missions';

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
    // Same default as `sim/Combat.wpn`, and the opposite of its sibling's: a
    // gun answers air only when its row says so. See `WeaponDef.canTargetAir`.
    canTargetAir: extra?.canTargetAir ?? false,
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
 *   2. THE PACT'S EMPLACEMENTS CARRY `needsPower`, AND ONLY ITS EMPLACEMENTS
 *      CAN. `glaiveRepeater` and `heliosLance` both have it, so both Pact
 *      defences go dark together and four Sandskiffs behind the lines silence a
 *      whole belt without touching either tower. That is the faction's risk
 *      profile: the Solar Array is cheap, generous and made of glass.
 *
 *      `zenithBeam` USED TO CARRY IT TOO AND IT DID NOTHING. `Combat.ts` gates
 *      on the weapon's `needsPower` AND `EntityFlag.NeedsPower` on the ENTITY,
 *      and that flag is only ever set on structures — `Scenarios.building()`
 *      and `mrdFlags`/`rclFlags` below derive it from a negative power draw and
 *      nothing derives it for a hull. `EntityFlag.Powered` is worse: only
 *      `PowerGrid.recompute` sets it and that loop walks
 *      `byKind[EntityKind.Building]` and nothing else, so a vehicle carrying
 *      `NeedsPower` would be unpowered forever and its gun would never fire
 *      once. A brownout-able VEHICLE is a `Power.ts` feature, not a data flag;
 *      until somebody builds it, the honest table says the Zenith's beam is not
 *      on the grid. See the Zenith Emitter's own row for the blurb that made
 *      the same false promise. `glaiveRepeater` went the other way — the Glaive
 *      Post is a structure, so its claim was made TRUE rather than withdrawn.
 *   3. Nothing here is `Tesla` or `SmallArms`-heavy. The Pact answers armour
 *      and structures well and answers massed infantry poorly, which is the
 *      hole the Soviets are built to exploit.
 *
 * `canTargetAir` follows the same rule as the base armoury (see the header of
 * `DEFAULT_WEAPONS`): infantry weapons, autocannon, guided rockets and the
 * faction's AA structure elevate; tank guns, siege beams, naval shells and the
 * emplaced repeater do not.
 */
export const MERIDIAN_WEAPONS: readonly WeaponDef[] = [
  /* 18 */ wpn('pulseCarbine', 'Pulse Carbine', 15, WarheadClass.SmallArms, 20, 0.80,
    ProjectileKind.Bullet, 105,
    { burstCount: 3, burstDelay: 0.08, turretTurnRate: 320, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashSmall, travelFx: FxKind.TracerBullet, impactFx: FxKind.ImpactDirt }),

  /* 19 */ wpn('sunLance', 'Sun Lance', 58, WarheadClass.Rocket, 26, 2.4,
    ProjectileKind.Rocket, 42,
    { splashRadius: 2.0, splashFalloff: 0.30, turretTurnRate: 260, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.RocketTrail, impactFx: FxKind.ExplosionSmall }),

  // 19 -> 13 DAMAGE, AND IT IS THE SANDSKIFF'S HALF OF THE IFV REBALANCE.
  //
  // At 19 x 4 on a 0.76 s cycle this was 100 raw dps on a 550-credit raider,
  // and the pair of burst-4 autocannons — this and the IFV's — were the two
  // best units in the game per credit. Both were scaled like EMPLACEMENTS: the
  // Sandskiff out-damaged the 1000-credit MiG and killed a 700-credit Grizzly
  // in 5.23 s while the Grizzly needed 6.10 s to kill it.
  //
  // 13 x 4 / 0.76 s = 68.4 raw. Against Medium (AutoCannon 0.65) that is 44.5
  // dps, so a Grizzly now dies in 7.65 s and wins the duel by 25%. The row is
  // retuned IN PLACE rather than appended because this file owns it outright
  // and editing a value changes no index; see `ifvChaingun` below for why the
  // IFV's half could not be done the same way.
  //
  // The two are still each other's opposite number and the IFV still edges it:
  // 190 hp / 65.5 = 2.90 s against 220 hp / 68.4 = 3.22 s. The Skiff buys speed
  // (9.2 vs 8.4), a metre of reach, two seats and a hover skirt; the IFV buys
  // 30 hp and the duel. That relationship is the reason this row moved at all —
  // cutting the IFV alone would have left the Allied raider strictly dominated.
  /* 20 */ wpn('arcRepeater', 'Arc Repeater', 13, WarheadClass.AutoCannon, 23, 0.55,
    ProjectileKind.Bullet, 155,
    { burstCount: 4, burstDelay: 0.07, turretTurnRate: 210, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashSmall, travelFx: FxKind.TracerBullet, impactFx: FxKind.Sparks }),

  /* 21 */ wpn('focusLance', 'Focus Lance', 60, WarheadClass.ArmorPiercing, 26, 1.6,
    ProjectileKind.Bullet, 135,
    { splashRadius: 1.4, splashFalloff: 0.30, turretTurnRate: 110,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.TracerCannon, impactFx: FxKind.ImpactMetal }),

  // NO `needsPower`. It is mounted on a HULL, and a hull can never carry
  // `EntityFlag.NeedsPower` — see rule 2 in this block's header. The flag was
  // authored here and read by nothing; the Zenith's blurb promised a brownout
  // weakness the simulation had no way to apply. Deleted rather than faked.
  /* 22 */ wpn('zenithBeam', 'Zenith Emitter', 94, WarheadClass.Prism, 33, 2.9,
    ProjectileKind.Beam, 0,
    { turretTurnRate: 65, requiresStop: true,
      muzzleFx: FxKind.None, travelFx: FxKind.PrismBeam, impactFx: FxKind.Sparks }),

  // `needsPower: true`, ADDED, and this one really bites: the Glaive Post is a
  // structure drawing -10, so `mrdFlags` stamps `EntityFlag.NeedsPower` on it
  // and `PowerGrid.shed` can darken it. Its blurb has said "Needs the grid"
  // since it was written and the weapon did not, which made the claim
  // decoration — the post kept firing through a total blackout while the Helios
  // Spire beside it went dark. Now both Pact defences fall together, which is
  // what the faction's own doctrine block above says they do.
  //
  // It sheds LAST among Pact defences, not first: `PowerGrid.shed` orders by
  // draw descending within a class, so a deficit takes the Spire's 55 before
  // this one's 10. A player losing their cheap anti-infantry post while the
  // heavy beam still runs would read as a bug.
  /* 23 */ wpn('glaiveRepeater', 'Glaive Repeater', 21, WarheadClass.SmallArms, 24, 0.45,
    ProjectileKind.Bullet, 118,
    { burstCount: 5, burstDelay: 0.06, turretTurnRate: 260, needsPower: true,
      muzzleFx: FxKind.MuzzleFlashSmall, travelFx: FxKind.TracerBullet, impactFx: FxKind.ImpactDirt }),

  // The Pact's `BuildRole.AntiAir` structure (`mrdHelios`) carries this one.
  /* 24 */ wpn('heliosLance', 'Helios Lance', 116, WarheadClass.Prism, 33, 2.8,
    ProjectileKind.Beam, 0,
    { turretTurnRate: 70, needsPower: true, canTargetAir: true,
      muzzleFx: FxKind.None, travelFx: FxKind.PrismBeam, impactFx: FxKind.Sparks }),

  /* 25 */ wpn('mirrorGun', 'Mirror Battery', 70, WarheadClass.HighExplosive, 33, 2.1,
    ProjectileKind.Shell, 76,
    { splashRadius: 3.4, splashFalloff: 0.25, turretTurnRate: 80,
      muzzleFx: FxKind.MuzzleFlashLarge, travelFx: FxKind.TracerCannon, impactFx: FxKind.ExplosionSmall }),

  // The Kestrel's own pods. Guided, and mounted on the thing that flies — so
  // gunships can fight each other, which is what stops "own the only aircraft"
  // from being an unanswerable position.
  /* 26 */ wpn('kestrelPod', 'Kestrel Pod', 44, WarheadClass.Rocket, 22, 1.9,
    ProjectileKind.Rocket, 48,
    { burstCount: 2, burstDelay: 0.16, splashRadius: 1.8, splashFalloff: 0.30,
      turretTurnRate: 300, muzzleParts: MUZZLE_PAIR, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.RocketTrail, impactFx: FxKind.ExplosionSmall }),

  /* 27 */ wpn('monitorLance', 'Monitor Lance', 110, WarheadClass.Rocket, 40, 3.8,
    ProjectileKind.Rocket, 46,
    { burstCount: 2, burstDelay: 0.32, splashRadius: 4.2, splashFalloff: 0.25,
      turretTurnRate: 55, muzzleParts: MUZZLE_PAIR, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.RocketTrail, impactFx: FxKind.ExplosionMedium }),
];

/**
 * THE RECLAMATION ID. `Faction.Reclaim = 4` in `core/types.ts`; aliased here so
 * the four faction constants read the same way at every use site.
 */
export const FACTION_RECLAIM = Faction.Reclaim;

/**
 * THE RECLAMATION ARMOURY. Appended after the Pact's, never interleaved.
 *
 * ONE IDEA, TEN ROWS, SIX OF THEM ARCS: **every gun the Reclamation points at a
 * UNIT is an arc**, and every arc CHAINS. The other four (`slagCharge`,
 * `slagMortar`, `scowGun`, `hulkBattery`) are HighExplosive, and they are the
 * whole of the army's answer to a building — which is the second rule below,
 * stated from the other side.
 *
 * This block read "EIGHT ROWS: every gun the Reclamation fields is an arc" and
 * contradicted itself two paragraphs later by naming `slagMortar` and
 * `slagCharge` as the HE exceptions. `WarheadClass.Tesla` was a single Soviet
 * defensive coil; here it is the army's signature, and reading it against
 * `ARMOR_MATRIX` is reading the faction:
 *
 *   Tesla   [1.60 infantry, 0.95 light, 0.85 medium, 0.90 heavy, 0.60 concrete]
 *
 * 1.60 against flesh with `chainCount` on top means a Reclamation line deletes
 * massed infantry — the Soviet conscript wave and the Pact's Wayfarer screen
 * both evaporate. 0.60 against Concrete means it cannot take a base apart: the
 * whole army's answer to a structure is ONE siege hull (`slagMortar`) and one
 * satchel infantryman (`slagCharge`), and if those die the Reclamation can
 * stand in an enemy base doing almost nothing.
 *
 * THE SECOND HALF OF THE TRADE IS RANGE. Every arc a UNIT carries is 14-20 m
 * where the equivalent Allied/Soviet/Pact gun is 22-26: `arcProd` 14,
 * `spitCoil` 16, `hornetArc` 17, `grinderArc` 18. The two EMPLACED arcs are
 * longer and still the shortest emplacements in the game — `postCoil` 20 and
 * `pylonArc` 28, against a Tesla Coil's 30, a Helios Spire's 33 and a Prism
 * Tower's 34. (This said "every arc row is 14-20 m", which the Arc Pylon's 28
 * has never been.) `sim/Combat.ts` gives a turretless shooter a 14-degree
 * `hullArcDeg` firing cone against a turret's 5-degree `aimToleranceDeg`, and
 * NOTHING in this army has a turret — so a Reclamation hull has to point its
 * whole chassis at what it wants to kill, from inside a range band where
 * everyone else is already shooting it.
 *
 * DELIBERATELY NOT `needsPower`. The Soviet coil and both Pact beams stop in a
 * brownout; these do not. The Reclamation pays for its guns in reach and in
 * facing, not in grid — and its Arc Pylon draws 90, the heaviest single load in
 * the game, so it browns out its OWN base instead.
 */
export const RECLAIM_WEAPONS: readonly WeaponDef[] = [
  // An arc is not a rocket and there is not one guided round in this army, so
  // the air rule lands here as: THE SOLDIER AND THE PYLON, nothing else. The
  // Reclamation's answer to a gunship is the same as its answer to everything —
  // stand under it with a stick and hope.
  /* 28 */ wpn('arcProd', 'Arc Prod', 26, WarheadClass.Tesla, 14, 1.05,
    ProjectileKind.TeslaBolt, 0,
    { chainCount: 1, turretTurnRate: 320, canTargetAir: true,
      muzzleFx: FxKind.TeslaCharge, travelFx: FxKind.TeslaArc, impactFx: FxKind.Sparks }),

  /* 29 */ wpn('slagCharge', 'Slag Charge', 74, WarheadClass.HighExplosive, 12, 2.7,
    ProjectileKind.Shell, 38,
    { splashRadius: 2.6, splashFalloff: 0.30, turretTurnRate: 240,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.TracerCannon, impactFx: FxKind.ExplosionSmall }),

  // The Spitter is the army's skirmisher and `FALLBACK_CATALOG` already scores
  // it 1.1 against ThreatClass.Air — which was a claim about nothing until
  // something could fly. It is the Reclamation's mobile answer, opposite the
  // Pact's arcRepeater Skiff.
  /* 30 */ wpn('spitCoil', 'Spit Coil', 30, WarheadClass.Tesla, 16, 0.95,
    ProjectileKind.TeslaBolt, 0,
    { chainCount: 1, turretTurnRate: 260, canTargetAir: true,
      muzzleFx: FxKind.TeslaCharge, travelFx: FxKind.TeslaArc, impactFx: FxKind.Sparks }),

  /* 31 */ wpn('grinderArc', 'Grinder Arc', 70, WarheadClass.Tesla, 18, 1.9,
    ProjectileKind.TeslaBolt, 0,
    { chainCount: 2, turretTurnRate: 120,
      muzzleFx: FxKind.TeslaCharge, travelFx: FxKind.TeslaArc, impactFx: FxKind.Sparks }),

  /* 32 */ wpn('slagMortar', 'Slag Mortar', 124, WarheadClass.HighExplosive, 42, 4.3,
    ProjectileKind.Shell, 44,
    { minRange: 11, splashRadius: 5.8, splashFalloff: 0.22, turretTurnRate: 45,
      requiresStop: true, canTargetInfantry: true,
      muzzleFx: FxKind.MuzzleFlashArtillery, travelFx: FxKind.RocketTrail, impactFx: FxKind.ExplosionLarge }),

  // Mounted on the Swarmhornet, so it elevates for the same reason the Kestrel
  // pods do: aircraft have to be able to answer aircraft.
  /* 33 */ wpn('hornetArc', 'Hornet Arc', 44, WarheadClass.Tesla, 17, 1.5,
    ProjectileKind.TeslaBolt, 0,
    { chainCount: 2, turretTurnRate: 300, canTargetAir: true,
      muzzleFx: FxKind.TeslaCharge, travelFx: FxKind.TeslaArc, impactFx: FxKind.Sparks }),

  /* 34 */ wpn('scowGun', 'Scow Gun', 68, WarheadClass.HighExplosive, 32, 2.3,
    ProjectileKind.Shell, 74,
    { splashRadius: 3.2, splashFalloff: 0.25, turretTurnRate: 75,
      muzzleFx: FxKind.MuzzleFlashLarge, travelFx: FxKind.TracerCannon, impactFx: FxKind.ExplosionSmall }),

  /* 35 */ wpn('hulkBattery', 'Hulk Battery', 116, WarheadClass.HighExplosive, 38, 3.6,
    ProjectileKind.Shell, 70,
    { burstCount: 2, burstDelay: 0.30, splashRadius: 4.4, splashFalloff: 0.25,
      turretTurnRate: 50, muzzleParts: MUZZLE_PAIR,
      muzzleFx: FxKind.MuzzleFlashLarge, travelFx: FxKind.TracerCannon, impactFx: FxKind.ExplosionMedium }),

  /* 36 */ wpn('postCoil', 'Post Coil', 34, WarheadClass.Tesla, 20, 0.85,
    ProjectileKind.TeslaBolt, 0,
    { chainCount: 1, turretTurnRate: 300,
      muzzleFx: FxKind.TeslaCharge, travelFx: FxKind.TeslaArc, impactFx: FxKind.Sparks }),

  // The Reclamation's `BuildRole.AntiAir` structure (`rclPylon`) carries this.
  /* 37 */ wpn('pylonArc', 'Pylon Arc', 94, WarheadClass.Tesla, 28, 2.2,
    ProjectileKind.TeslaBolt, 0,
    { chainCount: 3, turretTurnRate: 360, canTargetAir: true,
      muzzleFx: FxKind.TeslaCharge, travelFx: FxKind.TeslaArc, impactFx: FxKind.Sparks }),
];

/**
 * THE ONE GUN THE ORIGINAL ARMIES NEVER HAD.
 *
 * Read the SmallArms row of `ARMOR_MATRIX` against the Allied and Soviet
 * infantry rosters and the hole is unmissable:
 *
 *   SmallArms  [1.00 infantry, 0.55 light, 0.28 medium, 0.10 HEAVY, 0.18 concrete]
 *
 * Every buildable foot soldier those two armies field — G.I., Conscript,
 * Attack Dog — fires SmallArms. At 0.10 a lone G.I. needs **80 seconds** to
 * kill a Rhino and **153** to kill an Apocalypse, while `COMBAT_TARGETING`'s
 * `ineffective` penalty (0.35x at or below a 0.35 multiplier) means he will not
 * voluntarily aim at either one while any enemy infantryman stands within
 * 2.2 m of the same bearing. The player reads that, correctly, as "my troops
 * do not shoot vehicles".
 *
 * That is not the counter-triangle working. The triangle assumes each army has
 * an infantry ANSWER to armour and two of the four do: the Pact fields the
 * Sunlancer (`sunLance`, Rocket, 0.95 vs Heavy) and the Reclamation's basic
 * rifleman fires `arcProd` (Tesla, 0.90 vs Heavy). The Allies and the Soviets
 * had the square empty, so their entire infantry tier was a no-answer against
 * the tanks both armies are otherwise built around.
 *
 * THE ALLIED HALF NEEDED NO NEW ROW AT ALL. `DEFAULT_WEAPONS[16]` is
 * `rocketLauncher`, "Shoulder Rocket" — 60 damage, Rocket, 24 m, splash 2.4,
 * `canTargetAir` — and it was wired to NOTHING. A fully authored shoulder-fired
 * anti-tank weapon has been sitting in the sim armoury for the entire life of
 * the project waiting for a soldier to carry it, in the same way `soviet_flak`
 * has been sitting in `UNIT_MASS_LISTS` waiting for a def row. The Javelin fires
 * it verbatim; adding a near-identical `javelinLauncher` beside it would have
 * been the actual mistake.
 *
 * SO THIS BLOCK HOLDS EXACTLY ONE ROW, and it exists because the obvious reuse
 * does NOT work on the Soviet side. `aaCannon` ("Flak Battery", row 17) is
 * already assigned to `flakTrooper` by `CONTENT_WEAPON` in
 * `src/sim/combat.system.ts` — but that table is the pre-content fallback, and
 * `aaCannon` is balanced as an EMPLACEMENT: 34 damage x 3 rounds on a 0.82 s
 * cycle is 124 raw dps, which on a 300-credit infantryman is 99 dps against
 * flesh — double a Conscript's. It would not counter the line infantryman, it
 * would delete him. `flakBurst` is the man-portable version of the same idea.
 *
 * TWO DIFFERENT ANSWERS, NOT ONE ROW COPIED TWICE. The Allies buy the WARHEAD;
 * the Soviets buy VOLUME:
 *
 *   rocketLauncher  Rocket      [0.55, 0.95, 0.90, 0.95, 0.90]  27 dps @ 24 m
 *   flakBurst       AutoCannon  [0.80, 1.00, 0.65, 0.35, 0.35]  32 dps @ 20 m
 *
 * Read the Heavy column and the asymmetry is deliberate: 0.95 against 0.35.
 * The Javelin deletes an Apocalypse and the Flak Trooper only chips one, so
 * the SOVIET answer to heavy armour is still heavier armour — which is that
 * faction's whole thesis, and `tests/anti-armour-infantry.spec.ts` §1b records
 * it as a listed asymmetry rather than letting it look like an oversight.
 * Where the Flak Trooper wins is Light (1.00) and Medium (0.65), and both of
 * those clear `COMBAT_TARGETING.ineffectiveBelow`, so unlike a Conscript he
 * will actually AIM at a Grizzly.
 *
 * Neither replaces its army's line infantryman: both are worse than a rifle
 * against flesh, which is the whole point of a counter.
 *
 * BOTH ELEVATE. `canTargetAir` is true on both, and `tests/air-layer.spec`
 * enforces the converse (nothing may SCORE against Air without it).
 *
 * APPENDED, NEVER INTERLEAVED — same rule §5 asserts for the sim prefix. Every
 * `/* NN *\/` index above stays put, so no unit silently inherits its
 * neighbour's gun.
 */
export const AUGMENT_WEAPONS: readonly WeaponDef[] = [
  /* 38 */ wpn('flakBurst', 'Flak Burst', 11, WarheadClass.AutoCannon, 20, 1.15,
    ProjectileKind.Bullet, 100,
    { burstCount: 4, burstDelay: 0.07, splashRadius: 1.1, splashFalloff: 0.40,
      turretTurnRate: 300, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashFlak, travelFx: FxKind.TracerBullet, impactFx: FxKind.Sparks }),
];

/**
 * THE TWO GUNS THAT FLY.
 *
 * The Pact and the Reclamation each carry ONE bespoke air weapon — `kestrelPod`
 * and `hornetArc` — for a reason stated in both rows: aircraft have to be able
 * to answer aircraft, or "own the only gunship" is a win condition. The Allies
 * and the Soviets had the aircraft MODELS (`allied_vindicator`, `soviet_mig`,
 * built and silhouette-validated on every boot) and no gun to hang on them.
 *
 * WHY NOT REUSE, WHICH IS THIS FILE'S OWN STATED PREFERENCE
 * ---------------------------------------------------------
 * `AUGMENT_WEAPONS` above argues — correctly — that a near-identical
 * `javelinLauncher` beside `rocketLauncher` would have been the mistake. The
 * same test applied here fails on BOTH candidates, and it fails on the number
 * that matters rather than on flavour:
 *
 *     rocketLauncher  60 @ 2.2 s cycle  =  27 raw dps   (a 500-cr infantryman)
 *     aaCannon        34x3 @ 0.82 s     = 124 raw dps   (a static EMPLACEMENT)
 *     kestrelPod      44x2 @ 2.06 s     =  43 raw dps   (an 1100-cr aircraft)
 *
 * A 1200-credit Vindicator firing the Javelin's shoulder rocket would be the
 * worst credit-for-damage unit either army fields; a 1000-credit MiG firing the
 * flak battery would out-damage every tank in the game from a chassis nothing
 * on the ground is allowed to shoot at. Neither is a balance the reuse buys —
 * so the rows are authored, and the shape of each one is the doctrine.
 *
 * THE ASYMMETRY IS THE WARHEAD, AND IT READS STRAIGHT OFF `ARMOR_MATRIX`
 * ---------------------------------------------------------------------
 * EVERY aircraft in this game is `ArmorClass.Light` — that is enforced by
 * `tests/air-layer.spec.ts` and is deliberate, because the air/ground split is
 * a TARGETING gate (`canTargetAir`) and never a seventh armour row. So the
 * Light column IS the anti-aircraft column:
 *
 *     Rocket      [0.55 inf, 0.95 LIGHT, 0.90 med, 0.95 heavy, 0.90 concrete]
 *     AutoCannon  [0.80 inf, 1.00 LIGHT, 0.65 med, 0.35 heavy, 0.35 concrete]
 *
 * The Vindicator carries the Rocket row: it hurts armour and bases and can
 * defend itself. The MiG carries the AutoCannon row: 1.00 against Light makes
 * it the best air-superiority unit in the game and 0.35 against Heavy and
 * Concrete means it cannot substitute for a tank or take a base apart. An
 * Allied player buys a strike aircraft; a Soviet player buys an interceptor.
 *
 * BOTH ELEVATE, and that is not symmetry for its own sake — `air-layer.spec`
 * §6 asserts that every authored aircraft can fight the others.
 *
 * APPENDED, NEVER INTERLEAVED, same rule as every block above: rows 0..38 keep
 * their indices, so no unit silently inherits its neighbour's gun.
 */
export const AIRCRAFT_WEAPONS: readonly WeaponDef[] = [
  // Wing-pylon AGMs. `plane()` in `src/art/UnitDefs.ts` builds MuzzleA/MuzzleB
  // under the wings at exactly the pylon the `ordnance` capsules hang from, so
  // MUZZLE_PAIR here is a real socket pair and not a guess.
  /* 39 */ wpn('vindicatorMissile', 'Vindicator AGM', 62, WarheadClass.Rocket, 23, 2.4,
    ProjectileKind.Rocket, 52,
    { burstCount: 2, burstDelay: 0.18, splashRadius: 2.2, splashFalloff: 0.28,
      turretTurnRate: 280, muzzleParts: MUZZLE_PAIR, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.RocketTrail, impactFx: FxKind.ExplosionSmall }),

  // 24x3 on a 0.76 s cycle is 95 raw dps, under the emplaced flak battery's
  // 124: the thing that cannot be shot back at by two thirds of the army does
  // not also get the biggest gun.
  //
  // This line used to read "under the IFV's chaingun (116)" and offered that as
  // the intended order, which was the whole bug written down as a design. A
  // 600-credit wheeled raider out-damaging a 1000-credit aircraft is not an
  // order, it is an inversion; `ifvChaingun` below is 65 raw dps now and this
  // row is the ceiling for a mobile burst weapon again.
  /* 40 */ wpn('migCannon', 'MiG Autocannon', 24, WarheadClass.AutoCannon, 21, 0.62,
    ProjectileKind.Bullet, 170,
    { burstCount: 3, burstDelay: 0.07, splashRadius: 0.9, splashFalloff: 0.45,
      turretTurnRate: 340, muzzleParts: MUZZLE_PAIR, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashFlak, travelFx: FxKind.TracerBullet, impactFx: FxKind.Sparks }),
];

/**
 * THE GUN THAT HAD TO BE RE-AUTHORED RATHER THAN RETUNED.
 *
 * `DEFAULT_WEAPONS[6]` — `chaingun`, "25 mm Chaingun" — was the single most
 * over-scaled row in the game, and the Multigunner IFV that carried it was the
 * best unit in the game per credit by a wide margin. 22 damage x 4 rounds with
 * a 0.07 s burst delay and a 0.55 s cooldown is a **0.76 s cycle for 88 damage,
 * 115.8 raw dps**, on a 600-credit hull. Read against `ARMOR_MATRIX`:
 *
 *     AutoCannon  [0.80 inf, 1.00 LIGHT, 0.65 med, 0.35 heavy, 0.35 concrete]
 *
 * the 0.65 and 0.35 columns were doing exactly the job the counter-triangle
 * asks of them, and the raw number was three times a tank gun's — so the
 * multipliers never bit. Measured against the shipped tables:
 *
 *   - dps per 1000 credits, best in the whole roster among VEHICLES against
 *     Light (193), Medium (125), Heavy (68) AND Concrete (68). One unit, top of
 *     four of the six armour columns.
 *   - it beat a Grizzly 1v1 in **4.52 s** while the Grizzly needed **7.06 s** —
 *     a 600-credit raider deleting a 700-credit main battle tank, faster,
 *     longer-sighted (32 against 30) and 100 credits cheaper.
 *   - it beat the Sandskiff, the MiG and the Solarch too. Only the Rhino won.
 *
 * WHY A NEW ROW AND NOT AN EDIT. `chaingun` lives in `src/sim/Combat.ts`, which
 * this file borrows verbatim as its prefix (§5 asserts it element-by-element)
 * and does not own. Appending is the mechanism this file already documents for
 * exactly this case — `flakBurst` exists because `aaCannon` was "balanced as an
 * EMPLACEMENT" and could not be reused on an infantryman. `chaingun` is
 * balanced as nothing: it out-damaged the 800-credit emplaced flak battery's
 * cousin and the 1000-credit MiG from a chassis a third the price.
 *
 * THE NEW NUMBERS, DERIVED AND NOT GUESSED. The binding constraint is the
 * Grizzly duel. The Grizzly's `lightCannon` does 55 x 0.85 (AP vs Light) every
 * 1.5 s = 31.2 dps, so it needs 220 / 31.2 = **7.06 s** to kill an IFV. For the
 * tank to win, the IFV must need longer than that on 340 hp of Medium armour:
 *
 *     raw x 0.65 < 340 / 7.06   ->   raw < 74.1
 *
 * 11 x 5 rounds at 0.06 s over a 0.60 s cooldown is a **0.84 s cycle, 65.5 raw
 * dps** — 13% inside that bound, so a promotion does not flip it. The five-round
 * burst is deliberate: half the damage per round of the old four, which is what
 * a 25 mm chaingun should feel like, and it keeps the weapon's texture while
 * removing its ability to open armour.
 *
 * WHAT THAT BUYS, ALL FOUR COMPLAINTS ANSWERED:
 *
 *     vs Grizzly   7.99 s against the tank's 7.06 s   the TANK wins
 *     vs Light     65.5 dps, still the anti-air and anti-raider gun it is for
 *     vs Medium    42.6 dps  ->  5th per credit, behind the Sandskiff
 *     vs Heavy     22.9 dps  ->  nowhere near the top; a Rhino takes 18 s
 *     vs Concrete  22.9 dps  ->  behind the Slagger, which IS the wall-breaker
 *
 * It keeps `canTargetAir`, its 22 m reach and its 200 deg/s turret, because
 * none of those was the problem: the IFV is still the Allied answer to a
 * gunship and still the fastest thing with a turret that army fields.
 *
 * `chaingun` itself stays in the sim armoury and stays reachable — `CONTENT_WEAPON`
 * in `src/sim/combat.system.ts` still resolves it for `ifv` and `sickle` on the
 * pre-content fallback path. It is now one of the two DEFAULT_WEAPONS rows no
 * shipped def fires; see §5's orphan note and `tests/content-truthful.spec.ts`.
 *
 * APPENDED, NEVER INTERLEAVED. Rows 0..40 keep their indices.
 */
export const REBALANCE_WEAPONS: readonly WeaponDef[] = [
  /* 41 */ wpn('ifvChaingun', '25 mm Multigunner', 11, WarheadClass.AutoCannon, 22, 0.60,
    ProjectileKind.Bullet, 150,
    { burstCount: 5, burstDelay: 0.06, turretTurnRate: 200, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashSmall, travelFx: FxKind.TracerBullet, impactFx: FxKind.ImpactMetal }),
];

/**
 * The live armoury: the sim's table verbatim, then the Pact's, then the
 * Reclamation's, then the two rows the original armies were missing, then the
 * two that fly, then the rebalance row. The prefix property is ASSERTED in §5,
 * not assumed.
 */
export const WEAPONS: readonly WeaponDef[] = [
  ...DEFAULT_WEAPONS, ...MERIDIAN_WEAPONS, ...RECLAIM_WEAPONS, ...AUGMENT_WEAPONS,
  ...AIRCRAFT_WEAPONS, ...REBALANCE_WEAPONS,
];

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
  /** Progression gate. See `UNLOCK_TAGS` below; omitted means day-one. */
  unlockedBy?: string;
  maxHp: number;
  armor: ArmorClass;
  maxSpeed: number;
  turnRate: number;
  locomotor: Locomotor;
  radius: number;
  sight: number;
  weapons: readonly number[];
  hasTurret: boolean;
  /**
   * How heavy this hull is when it drives over something. LIVE, and read by
   * `sim/Crush.ts#crushesUnit` — but ONLY together with `EntityFlag.Crusher`,
   * which is the gate. A `crushLevel` without that flag is inert, which is what
   * the Prism Tank's 2 was until it got one.
   */
  crushLevel?: number;
  /**
   * How heavy a crusher has to be to flatten this. LIVE FOR INFANTRY, INERT FOR
   * EVERY VEHICLE, and the difference is not in this column.
   *
   * `Crush.ts` tests `EntityFlag.Crushable` BEFORE it reads this number. Every
   * foot unit in the game carries that flag with `crushableBy: 1`, so a Grizzly
   * (3) flattens riflemen and the column does real work. NOT ONE VEHICLE
   * CARRIES IT — so the 4/5/6 on fifteen hulls below describes a
   * vehicle-ramming rule that has never existed, and `Crush.ts`'s own header
   * says so in as many words ("they are reported, not implemented").
   *
   * LEFT AS AUTHORED RATHER THAN ZEROED, for one reason: every one of these
   * numbers is duplicated in `Scenarios.FALLBACK_UNITS` and
   * `tests/data.spec.ts` asserts the two tables agree field for field, so
   * zeroing them is a thirty-row change across a file this module does not own.
   * The honest alternative — writing 0, which for a UNIT means UNCRUSHABLE and
   * is the true statement — is the right end state and is recorded as such.
   * What is NOT acceptable is the silent version: `tests/content-truthful.spec.ts`
   * §3 pins "no vehicle carries `EntityFlag.Crushable`", so the day one does,
   * the ram rule has to be designed and priced rather than switched on by a
   * flag edit. An Apocalypse deleting a 420 hp Rhino on contact is a balance
   * decision, and nobody has made it.
   */
  crushableBy?: number;
  cargoMax?: number;
  /** Cargo slots: infantry 1, vehicle 2. Omitted = not a carrier. */
  cargoSlots?: number;
  /** See `UnitDef.waterOnly`. Every hull a shipyard builds. */
  waterOnly?: boolean;
  /** See `UnitDef.amphibious`. The four swimmers, and nothing else. */
  amphibious?: boolean;
  deploysInto?: string | null;
  canCapture?: boolean;
  /** Cap on units of this def alive at once. Omitted = unlimited. */
  maxAlive?: number;
  /** Active faction ability. Omitted = none, which is every non-commander. */
  ability?: AbilityId;
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

/* ==========================================================================
 * THE PROGRESSION TAGS
 *
 * ONE TABLE, not thirty scattered fields. Every row below is a def `key` ->
 * an id from `UNLOCKS` in `src/data/Missions.ts`; `unit()` and `building()`
 * stamp it onto the def, `BuildEntry` carries it into the sim, and
 * `UnlockGate.allows()` turns it into a buildable/not-buildable answer.
 *
 * ANYTHING NOT LISTED HERE IS AVAILABLE IN THE VERY FIRST MATCH. That is the
 * design's central rule and the reason the table is an allow-list of gates
 * rather than a column on every row: a forgotten entry here costs a player
 * nothing, whereas a forgotten `unlockedBy: undefined` on an inverted default
 * would lock a unit forever and read exactly like a balance decision.
 *
 * WHAT EVERY FACTION KEEPS ON A FRESH PROFILE
 * -------------------------------------------
 * Construction yard, power, refinery, barracks, war factory, radar, silo,
 * wall, ONE cheap defence, line infantry, an engineer, a harvester and a main
 * battle tank. That is a complete economy, a complete base and a complete
 * army — `tests/progression-gate.spec.ts` asserts it per faction rather than
 * trusting this comment.
 *
 * WHAT IT DOES NOT KEEP: the whole naval arm (no map forces water), the tech
 * building and everything hanging off it, the fast-harass sidegrade, the
 * tier-3 specialist, aircraft, and the expensive defences. Every one of those
 * is a widening of the army, never a repair of a hole in it.
 *
 * THE FOUR GROUPS ARE MIRRORED ACROSS ALL FOUR FACTIONS on purpose: one
 * mission grants "unit.raider" and every army gets its raider, so a player who
 * switches faction is never sent back to the start of the curve.
 *
 * WHAT THIS TABLE MAY NEVER GATE: THE OPENING
 * -------------------------------------------
 * A match now begins with a construction vehicle that has to be driven
 * somewhere and deployed (`game/Scenarios.ts`, start condition `mcv`). Nothing
 * on the path from that vehicle to a working economy may appear below, or a
 * fresh profile opens a match it cannot play:
 *
 *   mcv / mrdCarryall / rclCrawler          the vehicle itself
 *   conyard / mrdConclave / rclFoundry      what it deploys into
 *   powerPlant / mrdSolarArray / rclFurnace
 *   refinery / mrdCistern / rclSorter
 *   harvester / mrdCollector / rclScrapper
 *   barracks, warFactory and their twins    to replace a lost vehicle
 *
 * None of them is listed, and `tests/match-start.spec.ts` asserts that against
 * this table rather than trusting this comment. It also asserts the escort the
 * opening spawns is ungated, for the same reason: `ScenarioBuilder.spawnUnit`
 * SKIPS a locked def rather than substituting one, so a gated escort would not
 * arrive at all and nobody would see an error.
 * ========================================================================== */

export const UNLOCK_TAGS: Readonly<Record<string, string>> = {
  /* -- unit.raider: the fast-harass sidegrade ----------------------------- */
  ifv: 'unit.raider',
  attackDog: 'unit.raider',
  mrdSkiff: 'unit.raider',
  rclSpitter: 'unit.raider',

  /* -- unit.specialist: the tier-3 answer --------------------------------- */
  prismTank: 'unit.specialist',
  apocalypse: 'unit.specialist',
  mrdZenith: 'unit.specialist',
  rclSlaghurler: 'unit.specialist',

  /* -- THE NAVY IS NOT PROGRESSION-GATED, AND THAT IS A DECISION -----------
   * Three groups used to live here — `unit.naval` (escorts and lifts, paid by
   * "win a skirmish without losing a structure"), `unit.naval.capital` (paid by
   * "win 40 skirmishes") and `struct.naval` (all four docks, "win 10
   * skirmishes"). All three are gone, along with the ids in `Missions.ts`.
   *
   * They made the two battlefields advertised as naval maps unplayable as such.
   * `mobilityExempt` lifted the gate only where the sea is the ONLY road, which
   * is `mapSupportsNaval && !mapLandLinked` — true on Sunder Atoll and nowhere
   * else. Contested Strait and Coral Shore are one land mass with a sea beside
   * it, so on those two a partially progressed profile got no dock, no lift and
   * no warship. `UnlockGate.mirrorAI` resolves the AI against the human's
   * profile, so BOTH sides were equally dead and the water was scenery.
   *
   * Worse, the maps arrive before their content: Contested Strait is unlocked
   * by `tactics.fast.1` — one win under fifteen minutes — while `struct.naval`
   * needed ten wins, on an independent chain. Its own lobby blurb reads "Naval
   * yards earn their cost here."
   *
   * The in-match tech gate is untouched and it is the right one: capital ships
   * still need `battleLab` / `mrdReliquary` / `rclCrucible`, and every hull
   * still needs a dock on a real coast. What is gone is the PROFILE gate, which
   * answered "have you played enough" to a question that should be "have you
   * built the shipyard".
   * -------------------------------------------------------------------- */

  /* -- unit.air: all four armies now have one -----------------------------
   * This read "only two armies have one" and named two keys, which made the
   * air tier the ONE group in this table that was not mirrored across the
   * roster — against the rule five paragraphs up, where the mirroring is the
   * stated reason a player who switches faction is never sent back to the
   * start of the curve. `allied_vindicator` and `soviet_mig` were built,
   * measured and silhouette-validated on every boot and bound to nothing.
   *
   * The keys were mirrored; the MISSION was not. `unit.air` was paid by
   * "win 12 skirmishes as the Meridian Pact", so all four of these sat behind
   * one army's mastery chain and a Reclamation player had to win a dozen games
   * as somebody else to fly their own gunship. It is paid by
   * `construction.armour.2` now — build 400 vehicles, any army.             */
  mrdKestrel: 'unit.air',
  rclHornet: 'unit.air',
  vindicator: 'unit.air',
  mig: 'unit.air',

  /* -- unit.commander: the four heroes -------------------------------------
   * ONE PER ARMY, `maxAlive: 1`, 1500 credits off a barracks and a radar.
   *
   * These shipped ungated with a written reason: "a fresh profile can field one
   * … a unit a player cannot build on day one is a unit most players never
   * meet". That reason is answered by WHICH mission pays for it. `combat.veteran.2`
   * — Old Guard, promote fifteen units to elite rank — cannot be completed
   * without playing the game properly for a while, so by the time the hero is
   * gated the player has long since met the barracks it comes out of. And the
   * hero is what fifteen elite soldiers are FOR.
   *
   * NOT ON ANY OPENING PATH. A commander is not a prerequisite for anything,
   * appears in no `defaultBuildOrder`, and no scenario base places one;
   * `tests/progression-gate.spec.ts` re-derives that per faction rather than
   * trusting this note.                                                       */
  fieldMarshal: 'unit.commander',
  commissar: 'unit.commander',
  mrdHierarch: 'unit.commander',
  rclBaron: 'unit.commander',

  /* -- struct.support: the service pad -------------------------------------
   * Three defs for four armies, the Neutral shape, paid by `combat.razed.1` —
   * Demolition Crew, raze 25 enemy structures, difficulty 1 and the earliest
   * gate in this table.
   *
   * The depots' own note in the block below asked for exactly that: "a support
   * structure gated behind mission progress would be a tutorial for a mechanic
   * nobody had met". Twenty-five razed structures is a couple of matches, so
   * the player has met it. NOTHING ABOUT REPAIR BECOMES IMPOSSIBLE: the repair
   * toggle on a structure and the engineer that mends one are both day-one, and
   * so is every unit the pad would have serviced. This gates convenience.      */
  repairDepot: 'struct.support',
  mrdDepot: 'struct.support',
  rclDepot: 'struct.support',

  /* -- struct.tech: the one building that opens the top of every tab ------ */
  battleLab: 'struct.tech',
  mrdReliquary: 'struct.tech',
  rclCrucible: 'struct.tech',

  /* -- struct.defence.specialist ------------------------------------------
   * NOT `flameTower`. The Soviet cheap defence is `sentryGun` and the flame
   * tower is its 600-credit twin off the same prereq; gating both would leave
   * a fresh Soviet profile with a defence tab an Allied player has and it
   * would not. `teslaCoil` is the real Soviet specialist and is the only
   * Soviet row in this group.                                              */
  prismTower: 'struct.defence.specialist',
  teslaCoil: 'struct.defence.specialist',
  mrdHelios: 'struct.defence.specialist',
  rclPylon: 'struct.defence.specialist',

  /* -- struct.defence.aa --------------------------------------------------
   * ONE DEF, AND "DEDICATED" IS THE LOAD-BEARING WORD. `aaTurret` is the only
   * emplacement in the game built for nothing but aircraft, and it is Allied.
   *
   * This used to say the Pact and the Reclamation "have no dedicated AA
   * emplacement at all", which read as "those two armies cannot shoot up from
   * a structure" and is false in both directions. Every army's
   * `struct.defence.specialist` tower elevates — `prismTowerBeam`, `teslaBolt`,
   * `heliosLance` and `pylonArc` all carry `canTargetAir`, and the Pact's and
   * the Reclamation's rows say so in the armoury above ("The Pact's
   * `BuildRole.AntiAir` structure (`mrdHelios`) carries this one"). It also
   * left out that the SOVIETS have no dedicated AA turret either; their answer
   * is the Tesla Coil, exactly as the Pact's is the Helios Spire and the
   * Reclamation's is the Arc Pylon.
   *
   * So the real asymmetry is PRICE and TIER, not capability: 800 credits off a
   * radar for the Allies against 1450-1500 off a tech building for everyone
   * else. On foot every army also has an answer — Javelin, Flak Trooper,
   * Sunlancer, Scrap Picker — and all four now field a gunship of their own. */
  aaTurret: 'struct.defence.aa',

  /* -- the superweapons ----------------------------------------------------
   * SIX STRUCTURES, FIVE IDS, GROUPED BY THE EFFECT THEY FIRE.
   *
   * These six shipped with no `unlockedBy` at all, so the end of the five
   * longest chains in the mission table paid into nothing and a fresh profile
   * could build a Nuclear Missile Silo in its first match. The grouping is the
   * one `src/sim/Superweapons.ts` already uses — six rows, four effects — so a
   * `structureKeys` entry and an unlock id never disagree about what a weapon
   * IS. See the block on `UNLOCKS.superSiege` in `src/data/Missions.ts` for the
   * table, and note that `superSiege` deliberately covers the two armies that
   * share `SuperweaponId.LightningStorm`, the same way `unit.raider` covers
   * four hulls.
   *
   * NOTHING HERE ENDANGERS THE OPENING. A superweapon is gated on its army's
   * tech building, costs 2500 and draws -150 — the heaviest load in the game —
   * so it was never on the path from a construction vehicle to an economy, and
   * `tests/progression-gate.spec.ts` §5 re-derives that per faction rather
   * than trusting this note.                                                 */
  nuclearSilo: 'struct.superweapon.strategic',
  mrdHeliograph: 'struct.superweapon.solarlance',
  weatherControl: 'struct.superweapon.siege',
  rclStormworks: 'struct.superweapon.siege',
  chronosphere: 'struct.superweapon.chronosphere',
  ironCurtain: 'struct.superweapon.ironcurtain',
};

function unit(s: UnitSpec): UnitDef {
  return {
    key: s.key,
    unlockedBy: s.unlockedBy ?? UNLOCK_TAGS[s.key],
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
    cargoSlots: s.cargoSlots ?? 0,
    waterOnly: s.waterOnly ?? false,
    amphibious: s.amphibious ?? false,
    popCost: 1,
    deploysInto: s.deploysInto ?? null,
    canCapture: s.canCapture ?? false,
    // 0 = unlimited, which is the honest default for 40 of the 44 rows.
    maxAlive: s.maxAlive ?? 0,
    ability: s.ability ?? AbilityId.None,
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

/* -- the Reclamation flag kit ---------------------------------------------
 * Note what is MISSING: there is no `RCL_TURRETED`. Not one unit in the army
 * carries `EntityFlag.HasTurret`, and that absence is the faction's signature
 * rather than an oversight — see the doctrine block above the roster.        */
const RCL_MOVER = EntityFlag.CanMove | EntityFlag.ProvidesVision;
const RCL_FOOT = RCL_MOVER | EntityFlag.Crushable;
const RCL_GUNNER = RCL_MOVER | EntityFlag.CanAttack;

/**
 * Hull turn rate for a Reclamation chassis, rad/s.
 *
 * The shared derivation everywhere else is `2.6 - length * 0.14`. A turretless
 * army has to slew its whole hull to bear, so every Reclamation hull gets a
 * full extra radian/sec — a 6.2 m Grinder turns at 2.73 rad/s against a
 * Grizzly's 1.73. That is the compensation, and it is deliberately not enough:
 * one second of extra slew does not answer being outranged by six metres.
 */
function RCL_TURN(dim: { l: number }): number {
  return 3.6 - dim.l * 0.14;
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
  // THE ALLIED ANSWER TO ARMOUR, ON FOOT. See `AUGMENT_WEAPONS` for why this
  // row and its Soviet mirror exist at all. Gated on the Radar Dome for the
  // same reason the Sunlancer is gated on the Oculus: a 500-credit hard counter
  // to every tank in the game must not be available in the opening minute.
  //
  // 125 HP and 3.0 m/s is the SLOWEST, second-frailest thing either army can
  // field, and it is OUT-RANGED by everything it is built to kill: 24 m of
  // `rocketLauncher` against a Rhino's 26 and an Apocalypse's 28. He has to
  // walk into the gun to use his own, and `crushableBy: 1` means the tank can
  // decline the exchange entirely and drive over him. The warhead answers the
  // tank; nothing here answers the escort.
  unit({
    key: 'javelin', name: 'Javelin', blurb: 'Shoulder launcher. Kills armour and aircraft.',
    faction: Faction.Allies, kind: EntityKind.Infantry,
    cost: 500, buildTime: 7, tab: BuildTab.Infantry,
    prereqs: ['barracks', 'radar'], sortOrder: 20,
    model: 'allied_javelin',
    maxHp: 125, armor: ArmorClass.Infantry, maxSpeed: 3.0, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 25,
    weapons: [w('rocketLauncher')], hasTurret: false, crushableBy: 1,
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
  // THE MODEL FOR THIS UNIT ALREADY EXISTED AND DREW NOTHING.
  //
  // `src/art/UnitDefs.ts` has built `soviet_flak` — "Flak Trooper", launcher in
  // hand, magazine drum on its back — since the Soviet roster was authored. It
  // was in `UNIT_MASS_LISTS`, so every match paid to merge its geometry and
  // validate its silhouette, and it appeared in NEITHER `CONTENT_TO_MODEL` nor
  // `CAMEO_UNIT_MODELS`, so nothing could ever spawn wearing it. An army with
  // no anti-armour infantryman was shipping the art for one.
  //
  // Volume, not reach — the mirror of the Javelin. `flakBurst` is 1.00 against
  // Light and 0.35 against Heavy, so a Flak squad erases IFVs and Skiffs and
  // merely chips an Apocalypse: the Soviet answer to a heavy tank is still a
  // heavier tank, which is the faction's whole thesis.
  unit({
    key: 'flakTrooper', name: 'Flak Trooper', blurb: 'Drum-fed autocannon. Hates anything light.',
    faction: Faction.Soviets, kind: EntityKind.Infantry,
    cost: 300, buildTime: 6, tab: BuildTab.Infantry,
    prereqs: ['barracks', 'radar'], sortOrder: 25,
    model: 'soviet_flak',
    maxHp: 110, armor: ArmorClass.Infantry, maxSpeed: 3.3, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 23,
    weapons: [w('flakBurst')], hasTurret: false, crushableBy: 1,
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
  // `ifvChaingun`, NOT `chaingun`. See `REBALANCE_WEAPONS` for the derivation:
  // the old gun made this 600-credit raider the best unit in the game per
  // credit and let it kill a Grizzly 1v1 in 4.52 s. Every other number on the
  // row is unchanged — hp, armour, speed and sight are all duplicated in
  // `Scenarios.FALLBACK_UNITS` and asserted equal by `tests/data.spec.ts`, and
  // the gun was the thing that was wrong anyway.
  unit({
    key: 'ifv', name: 'Multigunner IFV', blurb: 'Fast wheeled gun platform.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 600, buildTime: 10, tab: BuildTab.Vehicles,
    prereqs: ['warFactory', 'radar'], sortOrder: 30,
    model: 'allied_ifv',
    maxHp: 220, armor: ArmorClass.Light, maxSpeed: 8.4, turnRate: 2.6 - U.ifv.l * 0.14,
    locomotor: Locomotor.Wheel, radius: hullRadius(U.ifv), sight: 32,
    weapons: [w('ifvChaingun')], hasTurret: true, crushableBy: 4,
  }),
  // `EntityFlag.Crusher`, ADDED, and it is the missing half of a number that
  // was authored TWICE. `crushLevel: 2` is on this row and on the Prism Tank's
  // row in `Scenarios.FALLBACK_UNITS`, and `Crush.ts` tests the FLAG before it
  // reads the level — so the column was dead and the Grizzly on the line above
  // carried both. Two independent tables agreeing on 2 is authored intent, not
  // a stray value.
  //
  // A TRACKED hull flattens men; that is the whole rule. Level 2 clears every
  // foot unit's `crushableBy: 1` and nothing else in the game is crushable, so
  // this is exactly "the Prism Tank can drive over infantry" and is not a step
  // toward ramming vehicles. It is deliberately BELOW the Grizzly's 3, which is
  // what the original author's 2 was saying.
  //
  // The two hulls that fill this slot for the other new armies still do not
  // crush, and both have a reason: `mrdZenith` is a hover skirt (Pact doctrine
  // rule 1 — `crushLevel: 0` on everything, the Pact never wins a ram) and
  // `rclSlaghurler` is wheeled and carries no level at all. The Apocalypse
  // does, because it is a heavy tank rather than an artillery piece.
  //
  // Adding the flag HERE and not in `Scenarios.ts` is deliberate and complete:
  // both spawn paths merge `flags = store | fallback.flags | def.flags`
  // (`Production.ts:2527`/`2866`, `Scenarios.ts:2201`/`2341`), and
  // `tests/data.spec.ts` compares the crush COLUMNS, not the flag word — so the
  // two tables still agree on every field it checks.
  unit({
    key: 'prismTank', name: 'Prism Tank', blurb: 'Beam artillery. Fragile.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 1200, buildTime: 17, tab: BuildTab.Vehicles,
    prereqs: ['warFactory', 'battleLab'], sortOrder: 40,
    model: 'allied_prism',
    maxHp: 260, armor: ArmorClass.Light, maxSpeed: 6.0, turnRate: 2.6 - U.prismTank.l * 0.14,
    locomotor: Locomotor.Track, radius: hullRadius(U.prismTank), sight: 34,
    weapons: [w('prismBeam')], hasTurret: true, crushLevel: 2, crushableBy: 5,
    flags: EntityFlag.Crusher,
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
    key: 'mcv', name: 'Construction Vehicle', blurb: 'Unfolds into your Construction Yard.',
    faction: Faction.Neutral, kind: EntityKind.Vehicle,
    cost: 3000, buildTime: 32, tab: BuildTab.Vehicles,
    // WAR FACTORY ONLY. See the note above the roster: a match now OPENS from
    // one of these, so it is the first structure in the game rather than a
    // late-game expansion tool, and a fresh profile must be able to replace one
    // it lost. `battleLab` carries `struct.tech` and would have gated the rebuild
    // behind a mission on the exact profile least able to survive losing it.
    prereqs: ['warFactory'], sortOrder: 50,
    model: 'allied_dozer',
    maxHp: 1000, armor: ArmorClass.Heavy, maxSpeed: 4.2, turnRate: 2.6 - U.mcv.l * 0.14,
    locomotor: Locomotor.Wheel, radius: hullRadius(U.mcv), sight: 22,
    weapons: UNARMED, hasTurret: false, crushableBy: 0, deploysInto: 'conyard',
  }),

  /* -- Naval -------------------------------------------------------------- *
   * Locomotor.Hover across the board: `Locomotor` has no Naval member, so a
   * hull's move class is DECLARED by `waterOnly` at spawn rather than guessed
   * from the cell it launched into. See `BuildEntry.waterOnly`.
   *
   * THE NAVAL LINE IS FOUR RUNGS, AND EVERY ARMY HAS ALL FOUR:
   *
   *   sortOrder 62   recon      0 slots, fastest hull afloat, wide sight,
   *                             a gun that annoys rather than kills
   *   sortOrder 64   landing    4 slots — two vehicles, or four infantry
   *   sortOrder 66   heavy      8 slots — four vehicles
   *   sortOrder 70   escort     the gunned hull
   *   sortOrder 80   capital    gated on the army's tech structure
   *
   * 62/64/66 and not 60/61/62, because the Meridian and Reclamation aircraft
   * already hold 60 in their Vehicles tabs and `tests/faction3.spec.ts` asserts
   * Meridian sortOrder is UNIQUE per (faction, tab). The gaps are deliberate:
   * one more rung can land between any two without renumbering a line.
   *
   * A SLOT IS NOT A SEAT: infantry cost one, a vehicle costs two. Before this,
   * `passengers` counted infantry and only infantry, so an army could not put a
   * tank on another island at all — which on Sunder Atoll, where there is no
   * land route between any two armies, meant the whole vehicle roster was
   * unusable against three of your four opponents.
   *
   * The Reclamation's Slag Scow IS the landing rung rather than a fifth hull:
   * it already had four slots and a barge in its blurb. It keeps its bow gun
   * and loses the ability to drive inland, which it should never have had.
   */
  unit({
    key: 'transport', name: 'Heavy Transport', blurb: 'Eight slots of anything, over open water.',
    faction: Faction.Neutral, kind: EntityKind.Vehicle,
    cost: 1200, buildTime: 15, tab: BuildTab.Vehicles, prereqs: ['navalYard'], sortOrder: 66,
    model: 'allied_transport',
    maxHp: 780, armor: ArmorClass.Light, maxSpeed: 5.4, turnRate: 2.6 - NU.transport.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.transport), sight: 26,
    weapons: UNARMED, hasTurret: false, cargoSlots: 8, waterOnly: true,
  }),
  unit({
    key: 'gunboat', name: 'Assault Destroyer', blurb: 'Allied escort. Shoots at everything.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 1000, buildTime: 14, tab: BuildTab.Vehicles, prereqs: ['navalYard'], sortOrder: 70,
    model: 'allied_destroyer',
    maxHp: 400, armor: ArmorClass.Light, maxSpeed: 7.0, turnRate: 2.6 - NU.gunboat.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.gunboat), sight: 34,
    weapons: [w('navalGun')], hasTurret: true, waterOnly: true,
  }),
  unit({
    key: 'destroyer', name: 'Aircraft Cruiser', blurb: 'Allied capital ship.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 1800, buildTime: 22, tab: BuildTab.Vehicles,
    prereqs: ['navalYard', 'battleLab'], sortOrder: 80,
    model: 'allied_destroyer',
    maxHp: 700, armor: ArmorClass.Medium, maxSpeed: 6.4, turnRate: 2.6 - NU.destroyer.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.destroyer), sight: 36,
    weapons: [w('navalGun')], hasTurret: true, waterOnly: true,
  }),
  unit({
    key: 'submarine', name: 'Attack Submarine', blurb: 'Soviet ambush hull.',
    faction: Faction.Soviets, kind: EntityKind.Vehicle,
    cost: 1000, buildTime: 14, tab: BuildTab.Vehicles, prereqs: ['subPen'], sortOrder: 70,
    model: 'soviet_dreadnought',
    maxHp: 500, armor: ArmorClass.Light, maxSpeed: 6.0, turnRate: 2.6 - NU.submarine.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.submarine), sight: 30,
    weapons: [w('torpedo')], hasTurret: false, waterOnly: true,
  }),
  unit({
    key: 'dreadnought', name: 'Dreadnought', blurb: 'Soviet siege ship.',
    faction: Faction.Soviets, kind: EntityKind.Vehicle,
    cost: 2000, buildTime: 24, tab: BuildTab.Vehicles,
    prereqs: ['subPen', 'battleLab'], sortOrder: 80,
    model: 'soviet_dreadnought',
    maxHp: 900, armor: ArmorClass.Heavy, maxSpeed: 4.0, turnRate: 2.6 - NU.dreadnought.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.dreadnought), sight: 38,
    weapons: [w('shipMissile')], hasTurret: true, waterOnly: true,
  }),

  /* ======================================================================
   * THE MERIDIAN PACT
   *
   * THE TWO RULES THAT MAKE THE ARMY, and every number below is one of them:
   *
   * 1. NOTHING THE PACT FIELDS TOUCHES THE GROUND. Every Meridian vehicle and
   *    ship is `Locomotor.Hover`, which `sim/Flowfield.ts` promotes to
   *    MoveClass.Naval the first time it queries a water cell — so the whole
   *    army is amphibious, ignores slope cost, and can open a second front
   *    across any lake on the map. The Kestrel is the one hull that goes
   *    further and is `Locomotor.Air`. The price is paid twice: `crushLevel: 0`
   *    on everything (a skirt cannot crush a conscript, so the Pact never wins
   *    a ram) and one armour class lower than the equivalent tracked hull.
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
    // NOT `waterOnly`, and it is the case that proves the rule: the Sandskiff is
    // gated on `mrdForgeyard`, a LAND structure, and the whole Pact army hovers.
    // It is a land raider that can swim, not a ship that can walk.
    weapons: [w('arcRepeater')], hasTurret: true, crushableBy: 4, cargoSlots: 2,
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
  // BLURB CORRECTED. It said "Dies in a brownout", which was never true and
  // could not be made true: `Combat.ts` needs `EntityFlag.NeedsPower` on the
  // ENTITY as well as `needsPower` on the weapon, and only structures ever get
  // that flag — see rule 2 in the `MERIDIAN_WEAPONS` header. The Pact's two
  // DEFENCES really do go dark (the Helios Spire always did; the Glaive Post
  // does now), so the faction still has the risk profile its doctrine claims.
  // This hull's real weakness is the one its stats already state: 240 hp of
  // Light armour and a beam that stops to fire.
  unit({
    key: 'mrdZenith', name: 'Zenith Emitter', blurb: 'Siege beam. Stops to fire, and dies to anything that reaches it.',
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
    key: 'mrdCarryall', name: 'Pactworks Carryall', blurb: 'Unfolds into your Conclave.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 3000, buildTime: 32, tab: BuildTab.Vehicles,
    // Forgeyard only — `mrdReliquary` carries `struct.tech`. Same reasoning as
    // the shared Construction Vehicle: this is how a match opens now.
    prereqs: ['mrdForgeyard'], sortOrder: 50,
    model: 'meridian_carryall',
    maxHp: 950, armor: ArmorClass.Heavy, maxSpeed: 5.0, turnRate: 2.6 - U.mcv.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(U.mcv), sight: 22,
    weapons: UNARMED, hasTurret: false, crushableBy: 0, deploysInto: 'mrdConclave',
    flags: MRD_MOVER,
  }),

  /* -- Meridian air --------------------------------------------------------
   * `Locomotor.Air` exists now, and this is the one-line change the previous
   * note promised. The stats never moved — they already read as a gunship —
   * but the locomotor is what makes `sim/Flowfield.ts` hand it `MoveClass.Air`
   * (off the grid entirely), what makes `sim/Movement.ts` fly it at
   * `AIR_CRUISE_ALTITUDE` and bank it into its turns, what puts it above
   * `AI_BUILD.airAltitudeMetres` so the AI's anti-air doctrine finally fires,
   * and what `sim/Combat.isAirborne` reads to decide who may shoot at it.
   *
   * ARMOUR STAYS `Light`. There is no seventh ArmorClass and there must not be
   * — `ARMOR_CLASS_COUNT` is 6 and the damage matrix is 7 warheads x 6 armors.
   * The air/ground distinction is a TARGETING gate (`canTargetAir`), not a
   * damage row; a fourth faction indexing past a 3x3 table is what turned the
   * whole screen black once already.                                         */
  unit({
    key: 'mrdKestrel', name: 'Kestrel Gunship', blurb: 'Fast rocket pods. Tank guns cannot elevate.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 1100, buildTime: 15, tab: BuildTab.Vehicles,
    prereqs: ['mrdForgeyard', 'mrdOculus'], sortOrder: 60,
    model: 'meridian_kestrel',
    maxHp: 210, armor: ArmorClass.Light, maxSpeed: 12.0, turnRate: 3.2,
    locomotor: Locomotor.Air, radius: hullRadius(U.ifv), sight: 36,
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
    weapons: [w('mirrorGun')], hasTurret: true, waterOnly: true,
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
    weapons: [w('monitorLance')], hasTurret: true, waterOnly: true,
    flags: MRD_TURRETED,
  }),

  /* ======================================================================
   * THE RECLAMATION
   *
   * THE THREE RULES THAT MAKE THE ARMY. Every number below is one of them:
   *
   * 1. NOTHING THE RECLAMATION FIELDS HAS A TURRET. `hasTurret: false` on all
   *    eleven, including the ships. `sim/Combat.ts` resolves the firing cone as
   *    `hasTurret ? aimToleranceDeg : hullArcDeg` — 5 degrees against 14 — and
   *    a turretless shooter's `turretYaw` is pinned to its HULL yaw every tick.
   *    So a Reclamation hull cannot shoot anything it is not pointing at, and
   *    it cannot cover a flank while it drives. The compensation is authored
   *    right here: `RCL_TURN` gives every hull a full radian/sec more hull turn
   *    rate than the equivalent Allied or Soviet chassis. It buys back the
   *    reaction time; it does not buy back the arc.
   *
   * 2. IT ARCS, SO IT CANNOT SIEGE. Seven of the ten guns are
   *    `WarheadClass.Tesla` with `chainCount` 1-3 at 14-20 m. Read against
   *    ARMOR_MATRIX that is 1.60 vs Infantry and 0.60 vs Concrete: the army
   *    erases massed bodies and bounces off buildings. Its entire answer to a
   *    base is the Slaghurler and the Slagger, and both are slow, soft and
   *    stop to fire.
   *
   * 3. IT IS THE CHEAPEST AND THE FRAILEST. A Grinder is 600 against a
   *    Grizzly's 700 and a Rhino's 900, builds in 9 seconds against 11 and 13,
   *    and dies at 270 hp against 340 and 420. A Scrap Picker is 90 credits and
   *    three seconds — the cheapest thing any army fields. The Reclamation wins
   *    by arriving first and by arriving again; it never wins a trade.
   * ====================================================================== */

  /* -- Reclamation infantry ------------------------------------------------ */
  unit({
    key: 'rclPicker', name: 'Scrap Picker', blurb: 'Ninety credits. Three seconds. Bring forty.',
    faction: FACTION_RECLAIM, kind: EntityKind.Infantry,
    cost: 90, buildTime: 3, tab: BuildTab.Infantry,
    prereqs: ['rclRookery'], sortOrder: 10,
    model: 'reclaim_picker',
    maxHp: 85, armor: ArmorClass.Infantry, maxSpeed: 3.6, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 22,
    weapons: [w('arcProd')], hasTurret: false, crushableBy: 1,
    flags: RCL_FOOT | EntityFlag.CanAttack,
  }),
  unit({
    key: 'rclSlagger', name: 'Slagger', blurb: 'Satchel of molten slag. The only thing that hurts a wall.',
    faction: FACTION_RECLAIM, kind: EntityKind.Infantry,
    cost: 380, buildTime: 7, tab: BuildTab.Infantry,
    prereqs: ['rclRookery'], sortOrder: 20,
    model: 'reclaim_slagger',
    maxHp: 115, armor: ArmorClass.Infantry, maxSpeed: 3.0, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 20,
    weapons: [w('slagCharge')], hasTurret: false, crushableBy: 1,
    flags: RCL_FOOT | EntityFlag.CanAttack,
  }),
  unit({
    key: 'rclTinker', name: 'Tinker', blurb: 'Captures structures. Repairs them.',
    faction: FACTION_RECLAIM, kind: EntityKind.Infantry,
    cost: 500, buildTime: 10, tab: BuildTab.Infantry,
    prereqs: ['rclRookery', 'rclSorter'], sortOrder: 30,
    model: 'reclaim_tinker',
    maxHp: 85, armor: ArmorClass.Infantry, maxSpeed: 3.5, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 20,
    weapons: UNARMED, hasTurret: false, crushableBy: 1, canCapture: true,
    flags: RCL_FOOT,
  }),

  /* -- Reclamation vehicles ------------------------------------------------ */
  unit({
    key: 'rclScrapper', name: 'Scrapjaw', blurb: 'Ore crusher on wheels. Drives over anything soft.',
    faction: FACTION_RECLAIM, kind: EntityKind.Vehicle,
    cost: 1150, buildTime: 14, tab: BuildTab.Vehicles,
    prereqs: ['rclBreakerYard', 'rclSorter'], sortOrder: 10,
    model: 'reclaim_scrapper',
    maxHp: 850, armor: ArmorClass.Heavy, maxSpeed: 5.6, turnRate: RCL_TURN(U.harvester),
    locomotor: Locomotor.Wheel, radius: hullRadius(U.harvester), sight: 20,
    weapons: UNARMED, hasTurret: false, cargoMax: 600, crushLevel: 5,
    flags: RCL_MOVER | EntityFlag.IsHarvester | EntityFlag.Crusher,
  }),
  unit({
    key: 'rclSpitter', name: 'Arcspitter', blurb: 'Fast coil buggy. Sixteen metres of reach and no armour.',
    faction: FACTION_RECLAIM, kind: EntityKind.Vehicle,
    cost: 420, buildTime: 6, tab: BuildTab.Vehicles,
    prereqs: ['rclBreakerYard'], sortOrder: 20,
    model: 'reclaim_spitter',
    maxHp: 170, armor: ArmorClass.Light, maxSpeed: 8.8, turnRate: RCL_TURN(U.ifv),
    locomotor: Locomotor.Wheel, radius: hullRadius(U.ifv), sight: 28,
    weapons: [w('spitCoil')], hasTurret: false, crushableBy: 4,
    flags: RCL_GUNNER,
  }),
  unit({
    key: 'rclGrinder', name: 'Grinder', blurb: 'The line. Cheap, quick, blind past eighteen metres.',
    faction: FACTION_RECLAIM, kind: EntityKind.Vehicle,
    cost: 600, buildTime: 9, tab: BuildTab.Vehicles,
    prereqs: ['rclBreakerYard'], sortOrder: 30,
    model: 'reclaim_grinder',
    maxHp: 270, armor: ArmorClass.Medium, maxSpeed: 5.8, turnRate: RCL_TURN(U.lightTank),
    locomotor: Locomotor.Wheel, radius: hullRadius(U.lightTank), sight: 26,
    weapons: [w('grinderArc')], hasTurret: false, crushLevel: 5, crushableBy: 6,
    flags: RCL_GUNNER | EntityFlag.Crusher,
  }),
  unit({
    key: 'rclSlaghurler', name: 'Slaghurler', blurb: 'The only thing in the army that can break a base.',
    faction: FACTION_RECLAIM, kind: EntityKind.Vehicle,
    cost: 1150, buildTime: 15, tab: BuildTab.Vehicles,
    prereqs: ['rclBreakerYard', 'rclCrucible'], sortOrder: 40,
    model: 'reclaim_slaghurler',
    maxHp: 230, armor: ArmorClass.Light, maxSpeed: 4.6, turnRate: RCL_TURN(U.prismTank),
    locomotor: Locomotor.Wheel, radius: hullRadius(U.prismTank), sight: 30,
    weapons: [w('slagMortar')], hasTurret: false, crushableBy: 5,
    flags: RCL_GUNNER,
  }),
  unit({
    key: 'rclCrawler', name: 'Yardcrawler', blurb: 'Unfolds into your Foundry.',
    faction: FACTION_RECLAIM, kind: EntityKind.Vehicle,
    cost: 3000, buildTime: 32, tab: BuildTab.Vehicles,
    // Breaker Yard only — `rclCrucible` carries `struct.tech`. Same reasoning as
    // the shared Construction Vehicle: this is how a match opens now.
    prereqs: ['rclBreakerYard'], sortOrder: 50,
    model: 'reclaim_crawler',
    maxHp: 900, armor: ArmorClass.Heavy, maxSpeed: 4.6, turnRate: RCL_TURN(U.mcv),
    locomotor: Locomotor.Wheel, radius: hullRadius(U.mcv), sight: 22,
    weapons: UNARMED, hasTurret: false, crushableBy: 0, deploysInto: 'rclFoundry',
    flags: RCL_MOVER,
  }),

  /* -- Reclamation air -----------------------------------------------------
   * Same treatment the Pact's Kestrel gets and for the same reason — see the
   * note there. `Locomotor.Air`, `ArmorClass.Light`, everything else as
   * authored.                                                                */
  unit({
    key: 'rclHornet', name: 'Swarmhornet', blurb: 'Chained arc from a lifting body. Flies over the line.',
    faction: FACTION_RECLAIM, kind: EntityKind.Vehicle,
    cost: 900, buildTime: 12, tab: BuildTab.Vehicles,
    prereqs: ['rclBreakerYard', 'rclSpotter'], sortOrder: 60,
    model: 'reclaim_hornet',
    maxHp: 180, armor: ArmorClass.Light, maxSpeed: 11.0, turnRate: 3.4,
    locomotor: Locomotor.Air, radius: hullRadius(U.ifv), sight: 34,
    weapons: [w('hornetArc')], hasTurret: false, crushableBy: 0,
    flags: RCL_GUNNER,
  }),

  /* -- Reclamation naval --------------------------------------------------- */
  unit({
    key: 'rclScow', name: 'Slag Scow', blurb: 'A barge with a bow gun bolted to it.',
    faction: FACTION_RECLAIM, kind: EntityKind.Vehicle,
    cost: 850, buildTime: 12, tab: BuildTab.Vehicles,
    prereqs: ['rclDrydock'], sortOrder: 64,
    model: 'reclaim_scow',
    maxHp: 340, armor: ArmorClass.Light, maxSpeed: 7.2, turnRate: RCL_TURN(NU.gunboat),
    locomotor: Locomotor.Hover, radius: hullRadius(NU.gunboat), sight: 32,
    weapons: [w('scowGun')], hasTurret: false, cargoSlots: 4, waterOnly: true,
    flags: RCL_GUNNER,
  }),
  unit({
    key: 'rclHulk', name: 'Reclaimed Hulk', blurb: 'Somebody else’s capital ship, welded back together.',
    faction: FACTION_RECLAIM, kind: EntityKind.Vehicle,
    cost: 1800, buildTime: 22, tab: BuildTab.Vehicles,
    prereqs: ['rclDrydock', 'rclCrucible'], sortOrder: 80,
    model: 'reclaim_hulk',
    maxHp: 820, armor: ArmorClass.Heavy, maxSpeed: 4.4, turnRate: RCL_TURN(NU.destroyer),
    locomotor: Locomotor.Hover, radius: hullRadius(NU.destroyer), sight: 36,
    weapons: [w('hulkBattery')], hasTurret: false, waterOnly: true,
    flags: RCL_GUNNER,
  }),

  /* -- THE COMMANDERS -----------------------------------------------------
   * One hero per army, `maxAlive: 1`, rebuildable the moment the last one
   * dies. APPENDED, never inserted: `store.defId` is an index into this array
   * and a saved match would re-bind every unit in it to the wrong row if a
   * commander landed in the middle. That has bitten this file twice.
   *
   * `sortOrder: 90` puts them last in the Infantry tab, past the engineer.
   *
   * NOT IN `UNLOCK_TAGS`, so a fresh profile can field one. The gate is the
   * tech tree (a barracks AND a radar) and the price, not the campaign — a
   * unit a player cannot build on day one is a unit most players never meet,
   * and the whole point of a hero is that it is the thing you build first
   * once you can.
   * --------------------------------------------------------------------- */
  unit({
    key: 'fieldMarshal', name: 'Field Marshal', blurb: 'One only. Recalls your army to their side.',
    faction: Faction.Allies, kind: EntityKind.Infantry,
    cost: 1500, buildTime: 20, tab: BuildTab.Infantry,
    prereqs: ['barracks', 'radar'], sortOrder: 90,
    model: 'allied_marshal',
    maxHp: 460, armor: ArmorClass.Infantry, maxSpeed: 3.8, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 34,
    weapons: [w('prismBeam')], hasTurret: false, crushableBy: 1,
    maxAlive: 1, ability: AbilityId.ChronoRally,
  }),
  // HE FIRES `teslaBolt`, WHICH CARRIES `needsPower`, AND IT DOES NOT APPLY.
  // Kept, and correctly: row 9 is the TESLA COIL's gun, the coil is a structure
  // drawing -75, and "Melts armour. Dies in a brownout." is the truest blurb in
  // the defence tab. The flag simply cannot reach a man — `Combat.ts` also
  // requires `EntityFlag.NeedsPower` on the entity and infantry never carry it
  // — so the Commissar fires through a blackout and always has. Noted rather
  // than "fixed": stripping `needsPower` to tidy the sharing would silently
  // switch the Tesla Coil on during a brownout, which is a real defence going
  // from a decision to a freebie. The Zenith Emitter was the opposite case (its
  // weapon had no other carrier) and that flag is gone.
  unit({
    key: 'commissar', name: 'War Commissar', blurb: 'One only. Makes nearby troops untouchable.',
    faction: Faction.Soviets, kind: EntityKind.Infantry,
    cost: 1500, buildTime: 20, tab: BuildTab.Infantry,
    prereqs: ['barracks', 'radar'], sortOrder: 90,
    model: 'soviet_commissar',
    maxHp: 520, armor: ArmorClass.Infantry, maxSpeed: 3.5, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 30,
    weapons: [w('teslaBolt')], hasTurret: false, crushableBy: 1,
    maxAlive: 1, ability: AbilityId.IronWill,
  }),
  unit({
    key: 'mrdHierarch', name: 'Hierarch', blurb: 'One only. Burns everything standing too close.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Infantry,
    cost: 1500, buildTime: 20, tab: BuildTab.Infantry,
    prereqs: ['mrdChapterhouse', 'mrdOculus'], sortOrder: 90,
    model: 'meridian_hierarch',
    maxHp: 430, armor: ArmorClass.Infantry, maxSpeed: 4.0, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 36,
    weapons: [w('focusLance')], hasTurret: false, crushableBy: 1,
    maxAlive: 1, ability: AbilityId.PrismFocus,
    flags: MRD_FOOT | EntityFlag.CanAttack,
  }),
  unit({
    key: 'rclBaron', name: 'Scrap Baron', blurb: 'One only. Cashes in the dead and mends the living.',
    faction: FACTION_RECLAIM, kind: EntityKind.Infantry,
    cost: 1500, buildTime: 20, tab: BuildTab.Infantry,
    prereqs: ['rclRookery', 'rclSpotter'], sortOrder: 90,
    model: 'reclaim_baron',
    maxHp: 470, armor: ArmorClass.Infantry, maxSpeed: 3.7, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 30,
    weapons: [w('grinderArc')], hasTurret: false, crushableBy: 1,
    maxAlive: 1, ability: AbilityId.SalvageCall,
    flags: RCL_FOOT | EntityFlag.CanAttack,
  }),

  /* -- THE ALLIED AND SOVIET AIR ARMS -------------------------------------
   * APPENDED, NEVER INSERTED, for the reason the commanders above carry and
   * `Replay.ts` states in one line: `store.defId` is a RAW INDEX into this
   * array and `Replay` records it as one, so a row landing in the middle
   * re-binds every command in every existing recording to different content.
   * (Saves are safe — `SaveGame.defIndexFromTables` maps by KEY both ways —
   * replays are not.) These are the last two rows and they must stay last.
   *
   * THE SAME DEFECT AS `soviet_flak`, AT THE SAME PLACE IN THE PIPELINE.
   * `src/art/UnitDefs.ts` has built `allied_vindicator` and `soviet_mig` since
   * the roster was authored. Both are in `UNIT_MASS_LISTS`, so every match has
   * paid to merge their geometry and validate their silhouette — the boot log
   * prints `[units] soviet_mig masses 4+8 dom 35.1%@46.7% ... 1568 tris` on
   * every single boot — and neither appeared in `CONTENT_TO_MODEL`, in
   * `PRODUCTION_CONTENT`, in `FALLBACK_UNITS`, or here. Art with no def row is
   * art nothing can spawn.
   *
   * WHAT AN AIRCRAFT DOES THAT A TANK DOES NOT, decided here and implemented
   * entirely by machinery that already existed. All four claims are asserted
   * in `tests/air-layer.spec.ts` §7 rather than left to this comment:
   *
   *   IT NEVER LANDS. There is no airfield, no rearm and no fuel in this game,
   *   and adding one would be a new subsystem rather than a def row.
   *   `sim/Movement.ts` holds `MoveClass.Air` at `ground + AIR_CRUISE_ALTITUDE`
   *   every tick with an exponential approach, so an idle aircraft LOITERS at
   *   22 m over whatever it is standing above and a hangar would have nothing
   *   to do. The consequence to know: an aircraft with no order is a 22 m-high
   *   target that cannot be shot by two thirds of the army, so it is safe and
   *   it is also doing nothing. That is the whole cost of owning one.
   *
   *   IT SHARES NO SPACE. `Steering.ts` skips `MoveClass.Air` in both the
   *   neighbour sweep and the separation pass, so aircraft fly through each
   *   other and through ground units, and a stack of four over one target is
   *   legal. `Flowfield.ts` answers `isPassableClass` true for every in-map
   *   cell, so there is no pathing, no queueing and no traffic — an aircraft
   *   goes where it is sent in a straight line and arrives.
   *
   *   MOST GUNS CANNOT TOUCH IT. `canTargetAir` defaults FALSE
   *   (`sim/Combat.weaponCanHurt` vetoes before the armour matrix is even
   *   consulted, and an explicit attack ORDER does not bypass it). What can
   *   answer these two: the Allied `aaTurret` and `prismTower`, the Soviet
   *   `teslaCoil`, the `javelin` and `flakTrooper` on foot, every rifle, the
   *   IFV's chaingun, the Dreadnought — and the other three factions' aircraft.
   *   Both armies therefore already own several answers before this row exists;
   *   what they did not own was a way to POSE the question.
   *
   *   KILLED OVER WATER IT SINKS, AND IT SINKS FROM ALTITUDE.
   *   `Damage.vehicleDeath` asks `terrain.isWater(cell)` — the terrain, never
   *   the height — so a hull lost over a lake makes a splash and leaves no
   *   wreck, exactly as a Corvette does. Over land it leaves the standard
   *   burning hulk. Both used to happen at the ALTITUDE OF DEATH, which put a
   *   22 m splash column in mid-air and a burning wreck floating over the
   *   battlefield for its full 40 s; `Damage.ts` now drops both to the surface
   *   for an airborne victim. That bug was reachable by the Kestrel and the
   *   Hornet from the day `Locomotor.Air` shipped and nothing was looking.
   *
   * BALANCED AGAINST THE TWO THAT ALREADY FLEW, which is the whole brief.
   * Read the four as one band, cheapest to dearest:
   *
   *     rclHornet     900   180 hp  11.0 m/s  sight 34   arc, chains
   *     mig          1000   190 hp  13.5 m/s  sight 32   autocannon
   *     mrdKestrel   1100   210 hp  12.0 m/s  sight 36   guided pods
   *     vindicator   1200   240 hp  11.5 m/s  sight 38   guided AGM
   *
   * Same prereq SHAPE as the other two — war factory plus radar, one tier
   * below the tech building — so no army reaches its air arm at a different
   * point on the curve. `radar`'s own alias list in `game/Scenarios.ts`
   * already reads `['radar', 'radardome', 'airfield']`, which is the tech tree
   * agreeing with this in advance.
   * --------------------------------------------------------------------- */
  unit({
    key: 'vindicator', name: 'Vindicator', blurb: 'Strike aircraft. Kills armour from a place tanks cannot reach.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 1200, buildTime: 16, tab: BuildTab.Vehicles,
    prereqs: ['warFactory', 'radar'], sortOrder: 45,
    model: 'allied_vindicator',
    // The heaviest of the four, and the hardest-hitting of the two that carry a
    // splash warhead which hurts Concrete — an Allied player buys this to open a
    // base, not to win a dogfight.
    //
    // It said "the heaviest and SLOWEST of the four" and the second half was
    // false against the number three lines below: 11.5 beats the Swarmhornet's
    // 11.0, so the Vindicator is second-slowest. Full order, slowest first —
    // rclHornet 11.0, vindicator 11.5, mrdKestrel 12.0, mig 13.5. The same
    // wrong claim had been copied into `wiki/Faction-Allies.md`, while
    // `wiki/Strategy.md` carried the correct table two pages away.
    //
    // "the ONLY one" was wrong: `kestrelPod` is Rocket too, same 0.90 against
    // Concrete, and it also splashes. The difference is weight of fire, not the
    // warhead row — 62 x 2 over a 2.58 s cycle with a 2.2 m burst against the
    // Kestrel's 44 x 2 over 2.06 s at 1.8 m, so the Vindicator lands 55.8
    // damage a shot against 35.2 and reaches a metre wider. The MiG (AutoCannon
    // 0.35) and the Swarmhornet (Tesla 0.60, no splash) are the two that really
    // cannot open a base.
    maxHp: 240, armor: ArmorClass.Light, maxSpeed: 11.5, turnRate: 2.9,
    locomotor: Locomotor.Air, radius: hullRadius(U.ifv), sight: 38,
    weapons: [w('vindicatorMissile')], hasTurret: false, crushableBy: 0,
  }),
  unit({
    key: 'mig', name: 'MiG Fighter', blurb: 'Interceptor. Owns the sky and nothing under it.',
    faction: Faction.Soviets, kind: EntityKind.Vehicle,
    cost: 1000, buildTime: 14, tab: BuildTab.Vehicles,
    prereqs: ['warFactory', 'radar'], sortOrder: 45,
    model: 'soviet_mig',
    // Fastest thing on the map and the thinnest-skinned aircraft after the
    // Hornet. 1.00 AutoCannon vs Light is 1.00 against every aircraft in the
    // game (they are all Light, and `air-layer.spec` keeps them that way), and
    // 0.35 vs Heavy and Concrete is why it is not also a tank or a siege unit.
    maxHp: 190, armor: ArmorClass.Light, maxSpeed: 13.5, turnRate: 3.6,
    locomotor: Locomotor.Air, radius: hullRadius(U.ifv), sight: 32,
    weapons: [w('migCannon')], hasTurret: false, crushableBy: 0,
  }),

  /* ======================================================================
   * THE NAVAL LINE, COMPLETED — 13 rows APPENDED, never inserted.
   *
   * `store.defId` is a raw index into this array and `Replay` records it as
   * one, so a row landing in the middle would re-bind every unit in every
   * recording that already exists. This block is the tail; anything added
   * after it goes after it.
   *
   * WHY THESE THIRTEEN. A player on a water map had ONE carrier per army and
   * nothing else to do with the sea — and the carrier took infantry only, so
   * on Sunder Atoll, where no two armies share a land route, the whole vehicle
   * roster was unusable against three of your four opponents. Every army now
   * has four rungs: a recon hull, a four-slot landing ship, an eight-slot
   * heavy, and a swimmer who needs no hull at all.
   *
   * `mrdSkiff` and `rclScow` already occupied rungs and were not duplicated.
   * The Sandskiff IS the Pact's raider and the Slag Scow IS the Reclamation's
   * landing ship; a parallel hull beside either would have bought a symmetry
   * the four armies do not otherwise have.
   * ====================================================================== */

  /* -- rung 62: recon. No hold, the widest eyes afloat, a gun that annoys ---
   * Priced under half an escort and armed with a weapon borrowed from a light
   * land chassis, so it cannot be mistaken for a cheap warship: it wins nothing
   * it meets, and it sees two islands away.                                   */
  unit({
    key: 'hydrofoil', name: 'Hydrofoil', blurb: 'Sees far. Dies fast.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 450, buildTime: 6, tab: BuildTab.Vehicles, prereqs: ['navalYard'], sortOrder: 62,
    model: 'allied_hydrofoil',
    maxHp: 180, armor: ArmorClass.Light, maxSpeed: 11.0, turnRate: 2.6 - NU.recon.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.recon), sight: 44,
    weapons: [w('ifvChaingun')], hasTurret: true, waterOnly: true,
  }),
  unit({
    key: 'picketBoat', name: 'Picket Boat', blurb: 'Soviet eyes on the water.',
    faction: Faction.Soviets, kind: EntityKind.Vehicle,
    cost: 450, buildTime: 6, tab: BuildTab.Vehicles, prereqs: ['subPen'], sortOrder: 62,
    model: 'soviet_picket',
    maxHp: 200, armor: ArmorClass.Light, maxSpeed: 10.4, turnRate: 2.6 - NU.recon.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.recon), sight: 42,
    weapons: [w('lightCannon')], hasTurret: true, waterOnly: true,
  }),
  unit({
    key: 'mrdCutter', name: 'Sun Cutter', blurb: 'A mirror on a hull, and very little else.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 480, buildTime: 6, tab: BuildTab.Vehicles, prereqs: ['mrdSlipway'], sortOrder: 62,
    model: 'meridian_cutter',
    maxHp: 170, armor: ArmorClass.Light, maxSpeed: 11.6, turnRate: 2.6 - NU.recon.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.recon), sight: 46,
    // NOT `glaiveRepeater`, which carries `needsPower`. The Pact's standing
    // rule is that everything MOBILE keeps firing through a brownout - only
    // its towers go dark - and `tests/faction3.spec.ts` enforces it over the
    // whole mobile roster. A scout that stops seeing when the lights go out is
    // the worst possible time to lose a scout.
    weapons: [w('mirrorGun')], hasTurret: true, waterOnly: true,
    flags: MRD_TURRETED,
  }),
  unit({
    key: 'rclSkimmer', name: 'Scrap Skimmer', blurb: 'A coil, an outboard, and no deck to speak of.',
    faction: FACTION_RECLAIM, kind: EntityKind.Vehicle,
    cost: 400, buildTime: 5, tab: BuildTab.Vehicles, prereqs: ['rclDrydock'], sortOrder: 62,
    model: 'reclaim_skimmer',
    maxHp: 160, armor: ArmorClass.Light, maxSpeed: 11.2, turnRate: RCL_TURN(NU.recon),
    locomotor: Locomotor.Hover, radius: hullRadius(NU.recon), sight: 42,
    weapons: [w('spitCoil')], hasTurret: false, waterOnly: true,
    flags: RCL_GUNNER,
  }),

  /* -- rung 64: the landing ship. Four slots — two vehicles, or four men ---- */
  unit({
    key: 'landingCraft', name: 'Landing Craft', blurb: 'Four slots and a bow ramp.',
    faction: Faction.Allies, kind: EntityKind.Vehicle,
    cost: 700, buildTime: 10, tab: BuildTab.Vehicles, prereqs: ['navalYard'], sortOrder: 64,
    model: 'allied_lighter',
    maxHp: 460, armor: ArmorClass.Light, maxSpeed: 6.6, turnRate: 2.6 - NU.lighter.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.lighter), sight: 24,
    weapons: UNARMED, hasTurret: false, cargoSlots: 4, waterOnly: true,
  }),
  unit({
    key: 'assaultBarge', name: 'Assault Barge', blurb: 'Four slots, welded shut.',
    faction: Faction.Soviets, kind: EntityKind.Vehicle,
    cost: 680, buildTime: 10, tab: BuildTab.Vehicles, prereqs: ['subPen'], sortOrder: 64,
    model: 'soviet_lighter',
    maxHp: 520, armor: ArmorClass.Light, maxSpeed: 6.0, turnRate: 2.6 - NU.lighter.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.lighter), sight: 24,
    weapons: UNARMED, hasTurret: false, cargoSlots: 4, waterOnly: true,
  }),
  unit({
    key: 'mrdLighter', name: 'Sun Lighter', blurb: 'Four slots under a folded sail.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 720, buildTime: 10, tab: BuildTab.Vehicles, prereqs: ['mrdSlipway'], sortOrder: 64,
    model: 'meridian_lighter',
    maxHp: 440, armor: ArmorClass.Light, maxSpeed: 7.0, turnRate: 2.6 - NU.lighter.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.lighter), sight: 26,
    weapons: UNARMED, hasTurret: false, cargoSlots: 4, waterOnly: true,
    flags: MRD_MOVER,
  }),

  /* -- rung 66: the heavy. Eight slots — four vehicles ---------------------- */
  unit({
    key: 'mrdArgosy', name: 'Argosy', blurb: 'Eight slots. The Pact arrives all at once.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Vehicle,
    cost: 1250, buildTime: 15, tab: BuildTab.Vehicles, prereqs: ['mrdSlipway'], sortOrder: 66,
    model: 'meridian_argosy',
    maxHp: 740, armor: ArmorClass.Light, maxSpeed: 5.6, turnRate: 2.6 - NU.transport.l * 0.14,
    locomotor: Locomotor.Hover, radius: hullRadius(NU.transport), sight: 28,
    weapons: UNARMED, hasTurret: false, cargoSlots: 8, waterOnly: true,
    flags: MRD_MOVER,
  }),
  unit({
    key: 'rclHauler', name: 'Slag Hauler', blurb: 'Eight slots of somebody else’s ship.',
    faction: FACTION_RECLAIM, kind: EntityKind.Vehicle,
    cost: 1100, buildTime: 14, tab: BuildTab.Vehicles, prereqs: ['rclDrydock'], sortOrder: 66,
    model: 'reclaim_hauler',
    maxHp: 800, armor: ArmorClass.Heavy, maxSpeed: 5.0, turnRate: RCL_TURN(NU.transport),
    locomotor: Locomotor.Hover, radius: hullRadius(NU.transport), sight: 24,
    weapons: UNARMED, hasTurret: false, cargoSlots: 8, waterOnly: true,
    flags: RCL_MOVER,
  }),

  /* -- the swimmers: infantry who need no hull at all ----------------------
   * `amphibious` maps them to `MoveClass.Hover`, the one ground class
   * `Flowfield.rebuildCost` does not block on a wet cell. It is a bit on the
   * def and NOT a new `Locomotor` member, which is not a style choice:
   * `passGrid` sets bits 0-3 only and `Production.findEgressSpot` asks
   * `isPassable(cx, cz, loco)`, so a locomotor with no bit is impassable on
   * every cell of the map. The finished man would sit `ready: true` at the head
   * of the Infantry queue forever, silently, with the player already charged,
   * blocking every rifleman behind him — the aircraft egress bug, which
   * `core/types.ts` documents twice as the thing never to do again.
   *
   * Slow, soft and visible: a raiding tool and the answer to losing your last
   * carrier, not a main line. Every one of them is slower than the rifleman it
   * shares a barracks with, and out on open water there is nothing to hide
   * behind.                                                                  */
  unit({
    key: 'frogman', name: 'Frogman', blurb: 'Swims. Everything else about him is worse.',
    faction: Faction.Allies, kind: EntityKind.Infantry,
    cost: 350, buildTime: 7, tab: BuildTab.Infantry, prereqs: ['barracks'], sortOrder: 40,
    model: 'allied_frogman',
    maxHp: 105, armor: ArmorClass.Infantry, maxSpeed: 2.9, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 26,
    weapons: [w('rifle')], hasTurret: false, crushableBy: 1, amphibious: true,
  }),
  unit({
    key: 'navalInfantry', name: 'Naval Infantry', blurb: 'Swims. Cheaply, and in numbers.',
    faction: Faction.Soviets, kind: EntityKind.Infantry,
    cost: 320, buildTime: 6, tab: BuildTab.Infantry, prereqs: ['barracks'], sortOrder: 40,
    model: 'soviet_diver',
    maxHp: 115, armor: ArmorClass.Infantry, maxSpeed: 2.8, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 24,
    weapons: [w('conscriptRifle')], hasTurret: false, crushableBy: 1, amphibious: true,
  }),
  unit({
    key: 'mrdTidewalker', name: 'Tidewalker', blurb: 'Walks on the water. Slowly.',
    faction: FACTION_MERIDIAN, kind: EntityKind.Infantry,
    cost: 380, buildTime: 7, tab: BuildTab.Infantry,
    prereqs: ['mrdChapterhouse'], sortOrder: 40,
    model: 'meridian_tidewalker',
    maxHp: 100, armor: ArmorClass.Infantry, maxSpeed: 3.0, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 28,
    weapons: [w('pulseCarbine')], hasTurret: false, crushableBy: 1, amphibious: true,
    flags: MRD_FOOT | EntityFlag.CanAttack,
  }),
  unit({
    key: 'rclDredger', name: 'Dredger', blurb: 'Comes up the beach with a prod and bad intentions.',
    faction: FACTION_RECLAIM, kind: EntityKind.Infantry,
    cost: 300, buildTime: 6, tab: BuildTab.Infantry, prereqs: ['rclRookery'], sortOrder: 40,
    model: 'reclaim_dredger',
    maxHp: 95, armor: ArmorClass.Infantry, maxSpeed: 3.0, turnRate: 6.0,
    locomotor: Locomotor.Foot, radius: hullRadius(U.infantry), sight: 24,
    weapons: [w('arcProd')], hasTurret: false, crushableBy: 1, amphibious: true,
    flags: RCL_FOOT | EntityFlag.CanAttack,
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
  /** Progression gate. See `UNLOCK_TAGS` below; omitted means day-one. */
  unlockedBy?: string;
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
  /** See `UnitSpec.flags`. Zero for the two original armies, authored for the Pact. */
  flags?: number;
}

/** Exit and dock offsets default to the middle of the +Z face, one clearance out. */
function building(s: BuildingSpec): BuildingDef {
  const halfDepth = s.dim.h * 4 /* CELL */ * 0.5;
  return {
    key: s.key,
    unlockedBy: s.unlockedBy ?? UNLOCK_TAGS[s.key],
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

/** The same kit for the Reclamation, whose keys have no fallback owner either. */
function rclFlags(power: number, extra = 0): number {
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
    // One flat list for both armies; `def.faction` does the filtering, which is
    // why the Allied and Soviet anti-armour troopers sit side by side here.
    produces: ['gi', 'javelin', 'conscript', 'attackDog', 'flakTrooper',
      'frogman', 'navalInfantry', 'engineer', 'fieldMarshal', 'commissar'],
    producesTab: BuildTab.Infantry,
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
    produces: ['hydrofoil', 'landingCraft', 'transport', 'gunboat', 'destroyer'],
    producesTab: BuildTab.Vehicles,
    exitClearance: 8,
  }),
  building({
    key: 'subPen', name: 'Naval Pen', blurb: 'Builds Soviet warships.',
    faction: Faction.Soviets, cost: 1000, buildTime: 14, tab: BuildTab.Structures,
    prereqs: ['refinery'], sortOrder: 70, model: 'subPen', dim: NB.subPen,
    maxHp: 1000, power: -30, sight: 24,
    produces: ['picketBoat', 'assaultBarge', 'transport', 'submarine', 'dreadnought'],
    producesTab: BuildTab.Vehicles,
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
    produces: ['mrdWayfarer', 'mrdLancer', 'mrdTidewalker', 'mrdArtificer', 'mrdHierarch'],
    producesTab: BuildTab.Infantry,
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
    produces: ['mrdCutter', 'mrdLighter', 'mrdArgosy', 'mrdCorvette', 'mrdMonitor'],
    producesTab: BuildTab.Vehicles,
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

  /* ======================================================================
   * THE RECLAMATION — THE BASE
   *
   * THE SIGNATURE: A FLAT TREE ON A WIDE GRID.
   *
   * The Reclamation reaches its whole army off FOUR structures — Foundry,
   * Furnace, Ore Sorter, Breaker Yard — because its line hulls (Arcspitter,
   * Grinder) name no radar and no tech building in their prereqs. Every other
   * army needs six structures before its second-tier vehicle exists. That is
   * the tempo the faction is built on and it is why its units are the cheapest
   * and the fastest to build in the game.
   *
   * It is paid for on the GRID. A Scrap Furnace is 240 credits for 80 power on
   * 950 hp: the cheapest, the toughest and by far the WEAKEST plant anyone
   * fields (a Power Plant is 300/100/800, a Solar Array 350/160/420). Four
   * Reclamation structures draw 40 or more and the Arc Pylon alone draws 90 —
   * the heaviest single load in the game — so a Reclamation base is a sprawl of
   * five or six furnaces, each of them a target, and its defensive belt is what
   * puts it into brownout in the first place.
   *
   * The second price is the Pylon's placement in the tree: it is gated on the
   * Spotter Mast, not on the Crucible, so it lands a full tech tier before a
   * Prism Tower or a Helios Spire. An early heavy defence that browns out your
   * own base is a real decision, which is the point.
   * ====================================================================== */
  building({
    key: 'rclFoundry', name: 'Foundry', blurb: 'Unfolds the Reclamation. Builds structures.',
    faction: FACTION_RECLAIM, cost: 3000, buildTime: 40, tab: BuildTab.Structures,
    prereqs: [], sortOrder: 0, model: 'reclaim_foundry', dim: B.conYard,
    maxHp: 2100, power: -20, sight: 30, buildRadius: BUILD_RADIUS,
    producesTab: BuildTab.Structures,
    flags: rclFlags(-20, EntityFlag.IsBuilder | EntityFlag.IsFactory | EntityFlag.PrimaryFactory),
  }),
  building({
    key: 'rclFurnace', name: 'Scrap Furnace', blurb: 'Generates 80 power. Cheap, tough, and never enough.',
    faction: FACTION_RECLAIM, cost: 240, buildTime: 7, tab: BuildTab.Structures,
    prereqs: ['rclFoundry'], sortOrder: 10, model: 'reclaim_furnace', dim: B.powerPlant,
    maxHp: 950, power: 80, sight: 18,
    flags: rclFlags(80),
  }),
  building({
    key: 'rclSorter', name: 'Ore Sorter', blurb: 'Unloads Scrapjaws. Ships with one.',
    faction: FACTION_RECLAIM, cost: 2000, buildTime: 24, tab: BuildTab.Structures,
    prereqs: ['rclFurnace'], sortOrder: 20, model: 'reclaim_sorter', dim: B.refinery,
    maxHp: 1250, power: -30, sight: 22, storage: REFINERY_STORAGE,
    flags: rclFlags(-30, EntityFlag.IsRefinery),
  }),
  building({
    key: 'rclRookery', name: 'Rookery', blurb: 'Trains pickers. Ninety credits at a time.',
    faction: FACTION_RECLAIM, cost: 450, buildTime: 9, tab: BuildTab.Structures,
    prereqs: ['rclFurnace'], sortOrder: 30, model: 'reclaim_rookery', dim: B.barracks,
    maxHp: 850, power: -20, sight: 20,
    produces: ['rclPicker', 'rclSlagger', 'rclDredger', 'rclTinker', 'rclBaron'],
    producesTab: BuildTab.Infantry,
    exitClearance: 2,
    flags: rclFlags(-20, EntityFlag.IsFactory | EntityFlag.PrimaryFactory),
  }),
  building({
    key: 'rclBreakerYard', name: 'Breaker Yard', blurb: 'Builds every Reclamation hull. Sets a rally point.',
    faction: FACTION_RECLAIM, cost: 1900, buildTime: 22, tab: BuildTab.Structures,
    prereqs: ['rclSorter'], sortOrder: 40, model: 'reclaim_breakeryard', dim: B.warFactory,
    maxHp: 1250, power: -40, sight: 20,
    produces: ['rclScrapper', 'rclSpitter', 'rclGrinder', 'rclSlaghurler', 'rclCrawler', 'rclHornet'],
    producesTab: BuildTab.Vehicles,
    exitClearance: 6,
    flags: rclFlags(-40, EntityFlag.IsFactory | EntityFlag.PrimaryFactory),
  }),
  building({
    key: 'rclSpotter', name: 'Spotter Mast', blurb: 'Reveals the minimap. Opens the heavy coil.',
    faction: FACTION_RECLAIM, cost: 1000, buildTime: 14, tab: BuildTab.Structures,
    prereqs: ['rclSorter'], sortOrder: 50, model: 'reclaim_spotter', dim: B.radar,
    maxHp: 700, power: -40, sight: 42,
    flags: rclFlags(-40, EntityFlag.IsRadar),
  }),
  building({
    key: 'rclHeap', name: 'Slag Heap', blurb: 'Stores 1500 credits of ore.',
    faction: FACTION_RECLAIM, cost: 150, buildTime: 5, tab: BuildTab.Structures,
    prereqs: ['rclSorter'], sortOrder: 60, model: 'reclaim_heap', dim: B.oreSilo,
    maxHp: 550, power: -10, sight: 12, storage: SILO_STORAGE,
    flags: rclFlags(-10),
  }),
  building({
    key: 'rclDrydock', name: 'Breaker Dock', blurb: 'Builds Reclamation hulls that float.',
    faction: FACTION_RECLAIM, cost: 1000, buildTime: 14, tab: BuildTab.Structures,
    prereqs: ['rclSorter'], sortOrder: 70, model: 'reclaim_drydock', dim: NB.navalYard,
    maxHp: 1050, power: -30, sight: 24,
    produces: ['rclSkimmer', 'rclScow', 'rclHauler', 'rclHulk'],
    producesTab: BuildTab.Vehicles,
    exitClearance: 8,
    flags: rclFlags(-30, EntityFlag.IsFactory | EntityFlag.PrimaryFactory),
  }),
  building({
    key: 'rclCrucible', name: 'Crucible', blurb: 'Opens the siege hull, the Yardcrawler and the Hulk.',
    faction: FACTION_RECLAIM, cost: 2000, buildTime: 24, tab: BuildTab.Structures,
    prereqs: ['rclSpotter'], sortOrder: 80, model: 'reclaim_crucible', dim: B.battleLab,
    maxHp: 900, power: -60, sight: 20,
    flags: rclFlags(-60),
  }),

  /* -- Reclamation defences ------------------------------------------------ */
  building({
    key: 'rclBarricade', name: 'Scrap Barricade', blurb: 'Stops vehicles. Stops nothing else.',
    faction: FACTION_RECLAIM, cost: 100, buildTime: 2, tab: BuildTab.Defense,
    prereqs: ['rclRookery'], sortOrder: 10, model: 'reclaim_barricade', dim: B.wall,
    maxHp: 340, power: 0, sight: 0,
    flags: rclFlags(0, EntityFlag.NotSelectable),
  }),
  building({
    key: 'rclSpitpost', name: 'Spitpost', blurb: 'Cheap chained coil. Fires through a blackout.',
    faction: FACTION_RECLAIM, cost: 420, buildTime: 8, tab: BuildTab.Defense,
    prereqs: ['rclRookery'], sortOrder: 20, model: 'reclaim_spitpost', dim: B.pillbox,
    maxHp: 520, power: 0, sight: 24, weapons: [w('postCoil')],
    flags: rclFlags(0, EntityFlag.CanAttack),
  }),
  building({
    key: 'rclPylon', name: 'Arc Pylon', blurb: 'Three chained arcs. Draws ninety power to do it.',
    faction: FACTION_RECLAIM, cost: 1450, buildTime: 16, tab: BuildTab.Defense,
    prereqs: ['rclSpotter'], sortOrder: 30, model: 'reclaim_pylon', dim: B.prismTower,
    maxHp: 560, power: -90, sight: 30, weapons: [w('pylonArc')], hasTurret: false,
    flags: rclFlags(-90, EntityFlag.CanAttack),
  }),
  building({
    // A wall run with no way through it was a real hole in the defence tab.
    //
    // THE ART FOR THIS WAS FINISHED AND UNREACHABLE. `gateSegment()` builds a
    // full model for both armies (BuildingDefs.ts:1672) and both are in
    // STRUCTURE_MASS_LISTS; `buildings.system.ts` maps `gate` to them and
    // `Cameos.ts` binds a cameo for it. Everything existed except this def, so
    // `binding.buildingId['gate']` was undefined and the registration was
    // silently skipped at `buildings.system.ts` — finished work, never once on
    // screen.
    key: 'gate', name: 'Gate', blurb: 'A way through your own wall. Friendlies only.',
    faction: Faction.Neutral, cost: 150, buildTime: 3, tab: BuildTab.Defense,
    prereqs: ['barracks'], sortOrder: 11, model: 'gate', dim: B.gate,
    maxHp: 400, power: 0, sight: 0,
  }),

  /* -- the Repair Depot, one per army -------------------------------------
   * APPENDED, not filed with each faction's own block above, for the reason
   * the header of this array gives: `store.defId` for a Building indexes THIS
   * array, so inserting a row renumbers every row after it. Save files carry
   * the KEY rather than the id (`SaveGame.ts:1102` — "a raw defId here would
   * silently corrupt"), which makes an insert survivable rather than safe, and
   * there is no reason to spend the difference.
   *
   * THREE ROWS FOR FOUR ARMIES. `Faction.Neutral` on a building means "both
   * original armies", the way `radar`, `battleLab` and `oreSilo` already do
   * it: one def, two mass lists, and `buildings.system.ts` picks the
   * architecture from the owner. So `repairDepot` covers Allies and Soviets.
   *
   * PREREQ IS THE VEHICLE FACTORY, not the refinery, and that is the whole
   * design of the building: it is worthless until you own armour, and the
   * moment you do it is the cheapest way to keep it. Priced at roughly two
   * full repairs of a main battle tank, so it pays for itself in one bad
   * engagement and never in a match you were winning anyway.
   *
   * NO `unlockedBy`: `UNLOCK_TAGS` has no row for these keys, so they are
   * available from the first skirmish. A support structure gated behind
   * mission progress would be a tutorial for a mechanic nobody had met. */
  building({
    key: 'repairDepot', name: 'Repair Depot', blurb: 'Mends any vehicle parked on the pad.',
    faction: Faction.Neutral, cost: 800, buildTime: 10, tab: BuildTab.Structures,
    prereqs: ['warFactory'], sortOrder: 75, model: 'repairDepot', dim: B.repairDepot,
    maxHp: 800, power: -30, sight: 18,
  }),
  building({
    key: 'mrdDepot', name: 'Solar Infirmary', blurb: 'Mends any hull standing in the light.',
    faction: FACTION_MERIDIAN, cost: 800, buildTime: 10, tab: BuildTab.Structures,
    prereqs: ['mrdForgeyard'], sortOrder: 75, model: 'meridian_depot', dim: B.repairDepot,
    maxHp: 700, power: -30, sight: 18,
    flags: mrdFlags(-30),
  }),
  building({
    key: 'rclDepot', name: 'Patch Yard', blurb: 'Welds any hull that stops moving.',
    faction: FACTION_RECLAIM, cost: 800, buildTime: 10, tab: BuildTab.Structures,
    prereqs: ['rclBreakerYard'], sortOrder: 75, model: 'reclaim_depot', dim: B.repairDepot,
    maxHp: 900, power: -30, sight: 18,
    flags: rclFlags(-30),
  }),

  /* -- THE SUPERWEAPONS ----------------------------------------------------
   * APPENDED, for the reason the Repair Depot block above states and one more
   * besides: `src/game/Replay.ts:165` records `defId` as a RAW ARRAY INDEX, so
   * a row inserted anywhere above this line makes every existing recording
   * play back a different game. Saves survive an insert (`defIndexFromTables`
   * maps by key both ways); replays do not.
   *
   * WHAT THESE ARE FOR. `src/sim/Superweapons.ts` is a complete, tested
   * implementation of six end-game buttons — charge timers, faction ownership,
   * a warned nuke, true invulnerability, a two-click chronoshift, area denial —
   * and until this block existed NOT ONE OF THEM WAS REACHABLE IN PLAY. The
   * service gates each weapon on owning a finished, powered structure whose
   * content key it names, and no such key existed. There was nothing to build,
   * so nothing ever charged, so nothing ever fired except from the console.
   *
   * SIX ROWS, FOUR ARMIES. The two original armies field two apiece because
   * that is what the service implements: the Soviets get the missile and the
   * Curtain, the Allies get the Chronosphere and the storm. The Pact and the
   * Reclamation are complete parallel trees that never draw from the
   * `Faction.Neutral` pool (`SHARED_POOL_FACTIONS` in Production.ts), so each
   * needs a row of its own — a Neutral superweapon would put a Soviet silo in
   * an Allied sidebar and none in either new army's.
   *
   * THE PRICE IS THE GRID, not the credits. 2500 is a War Factory plus a Radar
   * Dome, which is steep but reachable; -150 power is by a wide margin the
   * heaviest single draw in the game (the Arc Pylon's -90 was the record) and
   * it is the real cost. A base that builds one of these browns out unless it
   * has already paid for the generation, and a raid on the power plants stops
   * the countdown dead — `Superweapons.rescanAvailability` refuses a dark
   * structure, and the timer PAUSES rather than resetting.
   *
   * Every one is gated on the army's tech building, so a superweapon is the
   * last thing on the tree and never an opening.
   *
   * AND EVERY ONE IS GATED ON A MISSION TOO, which it was not when this block
   * landed. All six shipped with no `unlockedBy`, so they were buildable in a
   * player's first match while the five `struct.superweapon.*` ids at the end
   * of the longest chains in `src/data/Missions.ts` paid into nothing. The tags
   * are in `UNLOCK_TAGS` above, grouped by the EFFECT each structure fires so
   * that an unlock id and a `SUPERWEAPONS[].structureKeys` entry can never
   * disagree about what a weapon is. */
  building({
    key: 'nuclearSilo', name: 'Nuclear Missile Silo',
    blurb: 'Charges a single annihilating warhead. Announced before it lands.',
    faction: Faction.Soviets, cost: 2500, buildTime: 32, tab: BuildTab.Structures,
    prereqs: ['battleLab'], sortOrder: 90, model: 'nuclearSilo', dim: B.superweapon,
    maxHp: 1000, power: -150, sight: 20,
  }),
  building({
    key: 'ironCurtain', name: 'Iron Curtain Device',
    blurb: 'Makes everything in the radius untouchable for twenty seconds.',
    faction: Faction.Soviets, cost: 2000, buildTime: 28, tab: BuildTab.Structures,
    prereqs: ['battleLab'], sortOrder: 91, model: 'ironCurtain', dim: B.superweapon,
    maxHp: 950, power: -150, sight: 20,
  }),
  building({
    key: 'chronosphere', name: 'Chronosphere',
    blurb: 'Lifts nine of your units out of one place and sets them down in another.',
    faction: Faction.Allies, cost: 2000, buildTime: 28, tab: BuildTab.Structures,
    prereqs: ['battleLab'], sortOrder: 90, model: 'chronosphere', dim: B.superweapon,
    maxHp: 950, power: -150, sight: 20,
  }),
  building({
    key: 'weatherControl', name: 'Weather Control Device',
    blurb: 'Nine seconds of lightning. None of it lands where you thought.',
    faction: Faction.Allies, cost: 2500, buildTime: 32, tab: BuildTab.Structures,
    prereqs: ['battleLab'], sortOrder: 91, model: 'weatherControl', dim: B.superweapon,
    maxHp: 1000, power: -150, sight: 20,
  }),
  building({
    key: 'mrdHeliograph', name: 'Heliograph',
    blurb: 'Turns the sky on one point. Announced before it burns.',
    faction: FACTION_MERIDIAN, cost: 2500, buildTime: 32, tab: BuildTab.Structures,
    prereqs: ['mrdReliquary'], sortOrder: 90, model: 'meridian_heliograph', dim: B.superweapon,
    maxHp: 900, power: -150, sight: 20,
    flags: mrdFlags(-150),
  }),
  building({
    key: 'rclStormworks', name: 'Stormworks',
    blurb: 'Nine seconds of loose arcs over anywhere on the map.',
    faction: FACTION_RECLAIM, cost: 2500, buildTime: 32, tab: BuildTab.Structures,
    prereqs: ['rclCrucible'], sortOrder: 90, model: 'reclaim_stormworks', dim: B.superweapon,
    maxHp: 1050, power: -150, sight: 20,
    flags: rclFlags(-150),
  }),

  /* -- THE CIVILIAN BLOCK, and nobody builds it --------------------------
   * APPENDED, like every block above it, because `store.defId` for a Building
   * indexes THIS array and `src/game/Replay.ts` records `defId` as a RAW
   * ARRAY INDEX. Inserting a row here makes every existing recording play
   * back a different game.
   *
   * WHY THESE EXIST. `src/sim/Capture.ts` rule 1 is "a NEUTRAL structure (oil
   * derricks, hospitals, civilian blocks) is captured outright, at any
   * health", and `src/sim/Garrison.ts` says in its own header that the
   * eligible set is its own army's unarmed structures "plus any neutral-owned
   * structure the moment one exists". Both mechanics were finished and
   * neither had a single object on the map to act on. These are those
   * objects; `src/data/Civilians.ts` carries the footprints, which the art
   * and the fallback table read from the same constant.
   *
   * EVERY FIELD BELOW IS LOAD-BEARING FOR `GarrisonService.refusalFor`, which
   * refuses in this order: not a structure, unfinished, ARMED (`weapons`
   * non-empty or `EntityFlag.CanAttack`), TOO SMALL (either footprint axis
   * under `GARRISON.minFootprint` = 2), PRODUCTION STRUCTURE
   * (`IsBuilder|IsFactory|IsRefinery|IsRadar`), hostile, full. So: no
   * weapons, both axes >= 2 cells, and no role flag. The rule is satisfied
   * rather than relaxed — see `src/game/Scenarios.ts#civilian()` for the flag
   * set, which is the half of it this table cannot express.
   *
   * NOT IN `src/sim/Production.ts#CONTENT`, and that is the enforcement of
   * "no player may build one": `ProductionCatalog` is keyed on CONTENT, every
   * build tab is a view of the catalog, and a key with no CONTENT row cannot
   * be queued, cannot be placed and never draws a sidebar slot.
   *
   * `cost` IS NOT A PRICE, it is a valuation — nothing sells these (the
   * fallback rows clear `EntityFlag.Sellable`) and nothing buys them. It is
   * here because `tab`/`cost`/`buildTime` are required by the shape and a
   * zero would read as "worthless" to the next person balancing a bounty.  */
  building({
    key: 'civOilDerrick', name: 'Oil Derrick', blurb: 'Pays its owner while it is held.',
    faction: Faction.Neutral, cost: 1000, buildTime: 20, tab: BuildTab.Structures,
    prereqs: [], sortOrder: 900, model: 'civ_derrick', dim: CIV.civOilDerrick,
    maxHp: 900, power: 0, sight: 14,
  }),
  building({
    key: 'civHospital', name: 'Civilian Hospital', blurb: 'Holds five men and a wide field of fire.',
    faction: Faction.Neutral, cost: 800, buildTime: 20, tab: BuildTab.Structures,
    prereqs: [], sortOrder: 901, model: 'civ_hospital', dim: CIV.civHospital,
    maxHp: 1100, power: 0, sight: 20,
  }),
  building({
    key: 'civApartments', name: 'Apartment Block', blurb: 'A strongpoint that already exists.',
    faction: Faction.Neutral, cost: 600, buildTime: 20, tab: BuildTab.Structures,
    prereqs: [], sortOrder: 902, model: 'civ_apartments', dim: CIV.civApartments,
    maxHp: 800, power: 0, sight: 16,
  }),

  /* -- THE COMMAND POST, one per army --------------------------------------
   * APPENDED, for the reason the Repair Depot and superweapon blocks above
   * state: `src/game/Replay.ts` records `defId` as a RAW ARRAY INDEX, so a row
   * inserted anywhere above this line makes every existing recording play back
   * a different game.
   *
   * THREE ROWS FOR FOUR ARMIES, the `battleLab` / `mrdReliquary` / `rclCrucible`
   * shape: `Faction.Neutral` means "both original armies", so `commandPost`
   * covers the Allies and the Soviets with two mass lists behind it, and the
   * Pact and the Reclamation — which never draw from the Neutral pool — get one
   * each.
   *
   * WHAT IT IS FOR. It is the ONLY structure in the game that publishes
   * `BuildTab.Powers`, and that tab is the only route to a commander power. The
   * five powers were a MISSION reward until v2.6.0: owned from the first tick of
   * every match by a veteran profile and never by a fresh one, resolved in the
   * UI because the simulation was forbidden from asking. A building is world
   * state — the same on both clients, visible to the AI, in the checksum, in the
   * save — so the question moved into the simulation where it belongs.
   *
   * THE PRICE IS A REAL DECISION, and it is priced against the tech building it
   * sits beside rather than against nothing:
   *
   *   Battle Lab      2000 credits, 24 s, -60 power, opens the top of every tab.
   *   Command Post    1500 credits, 20 s, -80 power, opens a tab of its own.
   *
   * Cheaper and quicker to raise, and then MORE EXPENSIVE TO KEEP: -80 is the
   * third-heaviest draw in the game after a superweapon's -150 and an Arc
   * Pylon's -90, so a base that adds one on top of a lab has to have paid for
   * the generation first. That is the trade the structure exists to pose —
   * hardware, or the commander's own repertoire — and it is answered on the
   * power bar, not in credits. 750 hp against the lab's 900 for the same
   * reason: it is an antenna farm, and it should be the thing a raid kills.
   *
   * PREREQ IS THE RADAR TIER, not the tech building. Behind the lab it would be
   * a fifth tier on a tree the file's own header caps at three, and the powers
   * would arrive so late that only the two 240 s ones would ever charge twice.
   *
   * NO `unlockedBy`, deliberately and permanently. `UNLOCK_TAGS` has no row for
   * these keys and must not gain one: this structure is the only route to a
   * commander power, and gating the route would put the powers straight back
   * behind the profile — with the additional defect that the gate would now be
   * inside the simulation. Every match, every profile, both armies. */
  building({
    key: 'commandPost', name: 'Command Post', blurb: 'Requisitions commander powers. Opens the Powers tab.',
    faction: Faction.Neutral, cost: 1500, buildTime: 20, tab: BuildTab.Structures,
    prereqs: ['radar'], sortOrder: 85, model: 'commandPost', dim: B.commandPost,
    maxHp: 750, power: -80, sight: 22,
  }),
  building({
    key: 'mrdPharos', name: 'Pharos', blurb: 'Requisitions commander powers. Opens the Powers tab.',
    faction: FACTION_MERIDIAN, cost: 1500, buildTime: 20, tab: BuildTab.Structures,
    prereqs: ['mrdOculus'], sortOrder: 85, model: 'meridian_pharos', dim: B.commandPost,
    maxHp: 700, power: -80, sight: 22,
    flags: mrdFlags(-80),
  }),
  building({
    key: 'rclSignalRig', name: 'Signal Rig', blurb: 'Requisitions commander powers. Opens the Powers tab.',
    faction: FACTION_RECLAIM, cost: 1500, buildTime: 20, tab: BuildTab.Structures,
    prereqs: ['rclSpotter'], sortOrder: 85, model: 'reclaim_signalrig', dim: B.commandPost,
    maxHp: 800, power: -80, sight: 22,
    flags: rclFlags(-80),
  }),

  /* -- THE ORE MINE, and why it is HERE rather than beside its siblings -----
   * Reported as "lets spawn small amount of coal / ore / money mines around the
   * map, conquering with troops make us get income". It is the Oil Derrick's
   * mechanic pointed at a second structure — `src/data/Civilians.ts` carries
   * the rate and its derivation — so every field below is copied from the
   * civilian block at row 51 and nothing about the rules changed.
   *
   * IT DOES NOT SIT WITH THAT BLOCK, and resisting the urge to tidy it in there
   * is the only interesting thing about this row. `store.defId` is a RAW ARRAY
   * INDEX and `src/game/Replay.ts` records it raw, so a row inserted after
   * `civApartments` would shift the three Command Posts down one and every
   * recording on disk would play back a different game. The same sentence is
   * written above the Repair Depot, the superweapons and the Command Posts;
   * this is the first time obeying it has cost the table its grouping, and
   * `tests/civilians.spec.ts` now pins BOTH facts — the original three still
   * consecutive at index 51, this one last.
   *
   * EVERY FIELD IS LOAD-BEARING FOR `GarrisonService.refusalFor` for the reason
   * the civilian block states: no weapons, both footprint axes >= 2 cells, no
   * `IsBuilder|IsFactory|IsRefinery|IsRadar`. A squad has to be able to walk in,
   * because "with troops" is half of what was asked for and the engineer is the
   * other half.
   *
   * NOT IN `src/sim/Production.ts#CONTENT`, which is what makes it unbuildable,
   * and `cost` is a valuation rather than a price — the fallback row clears
   * `EntityFlag.Sellable`, so nobody buys one and nobody cashes one in. 700
   * against the derrick's 1000: it pays a third as much. */
  building({
    key: 'civOreMine', name: 'Ore Mine', blurb: 'A worked seam. Pays its owner while it is held.',
    faction: Faction.Neutral, cost: 700, buildTime: 20, tab: BuildTab.Structures,
    prereqs: [], sortOrder: 903, model: 'civ_mine', dim: CIV.civOreMine,
    maxHp: 700, power: 0, sight: 12,
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
    id: FACTION_RECLAIM, key: 'reclaim', name: 'The Reclamation',
    paletteKey: 'reclaim',
    // Three pickers, not two: they are 90 credits each and the faction's whole
    // early game is "there are more of them than there should be".
    startLoadout: ['rclPicker', 'rclPicker', 'rclPicker', 'rclGrinder'],
    conYardKey: 'rclFoundry',
    // Furnace, Rookery, Sorter, Breaker Yard — and then a SECOND furnace before
    // anything else, because 80 power a plant means the grid is the thing that
    // stops this base, not the credits.
    defaultBuildOrder: [
      'rclFurnace', 'rclRookery', 'rclSorter', 'rclFurnace',
      'rclBreakerYard', 'rclSpotter', 'rclHeap', 'rclCrucible',
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
 * 4b. WHAT IT COSTS TO MOVE A BUILDING
 *
 * `src/sim/Relocate.ts` owns these numbers, for the reason `Deploy.ts` gives
 * about `DEPLOY_SECONDS`: they are the FEEL of one mechanic owned by one file,
 * and `core/config.ts` is the art-direction surface a visual critic edits.
 *
 * They are re-exported HERE because a relocation fee is a price, prices are
 * content, and every other price in the game is in this file. A designer
 * balancing the cost of moving a War Factory against the cost of selling and
 * rebuilding it should find both numbers by opening one module. The edge runs
 * data -> sim, which is the direction this file already uses for
 * `DEFAULT_WEAPONS` and the only direction that cannot cycle.
 *
 * `relocationFee(cost)` is the whole pricing rule: a fraction of build cost,
 * rounded, never below the floor. `BUILDINGS[i].maxHp` is not in it — a wreck
 * costs the same to move as a pristine building, and arrives just as wrecked.
 * ========================================================================== */

export { RELOCATE, relocationFee } from '../sim/Relocate';

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

  /* -- the rows nothing fires -------------------------------------------- *
   * TWO, BOTH IN `DEFAULT_WEAPONS`, BOTH DELIBERATE, AND THE LIST IS CLOSED.
   *
   *   12  artillery    "V4 Launcher" — 130 HE at 48 m with a 6.5 m burst and a
   *                    12 m minimum. A fully authored Soviet siege gun with no
   *                    Soviet siege unit to carry it: the roster's answer to a
   *                    base is the Apocalypse and the air arm. Giving it a hull
   *                    means a def row, a `FALLBACK_UNITS` row, a model, a
   *                    cameo and a balance pass, which is content work rather
   *                    than a data fix.
   *   6   chaingun     the IFV's old gun, replaced by `ifvChaingun` — see
   *                    `REBALANCE_WEAPONS`. This file cannot edit a row it
   *                    borrows verbatim from `src/sim/Combat.ts`, so the
   *                    corrected weapon had to be appended and row 6 fell out
   *                    of the roster.
   *
   * NEITHER IS UNREACHABLE. `CONTENT_WEAPON` in `src/sim/combat.system.ts`
   * still names both — `v4` for the first, `ifv` and `sickle` for the second —
   * and that map is the pre-content path a unit resolves on before the def
   * tables bind. So they are rows the fallback armoury still serves and the
   * shipped roster does not, which is a different thing from dead data.
   *
   * The count is asserted, not the membership, because the membership is
   * pinned with its reasons in `tests/content-truthful.spec.ts` §4 — where a
   * NEW orphan fails loudly instead of joining a list nobody re-reads.       */
  {
    const fired = new Set<number>();
    for (const u of UNITS) for (const i of u.weapons) fired.add(i);
    for (const b of BUILDINGS) for (const i of b.weapons) fired.add(i);
    const orphans: string[] = [];
    for (let i = 0; i < WEAPONS.length; i++) if (!fired.has(i)) orphans.push(`${i}:${WEAPONS[i].key}`);
    if (orphans.length > 2) {
      problems.push(
        `${orphans.length} weapon rows are fired by no def (${orphans.join(', ')}) — only `
        + '"artillery" and "chaingun" are allowed to be, and both are documented above',
      );
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
  /* -- the fourth faction ------------------------------------------------- */
  if (!factionIds.has(FACTION_RECLAIM as number)) {
    problems.push('the Reclamation has no FactionDef');
  }
  // No turret on anything the Reclamation fields. This is the faction's
  // signature and it is enforced rather than remembered: one `hasTurret: true`
  // slipping into the roster undoes the 14-degree hull-arc trade that the guns
  // are priced against, and nothing else in the process would notice.
  for (const u of UNITS) {
    if ((u.faction as number) !== (FACTION_RECLAIM as number)) continue;
    if (u.hasTurret || (u.flags & EntityFlag.HasTurret) !== 0) {
      problems.push(`"${u.key}" has a turret; no Reclamation unit may (see §1 doctrine)`);
    }
  }

  // Every faction-owned key must belong to its own faction: a def that slipped
  // back to Faction.Neutral would appear in EVERY other army's sidebar.
  const PREFIX_OWNER: readonly (readonly [string, number])[] = [
    ['mrd', FACTION_MERIDIAN as number],
    ['rcl', FACTION_RECLAIM as number],
  ];
  for (const d of [...UNITS, ...BUILDINGS]) {
    for (const [prefix, owner] of PREFIX_OWNER) {
      const prefixed = d.key.startsWith(prefix);
      const owned = (d.faction as number) === owner;
      if (prefixed !== owned) {
        problems.push(
          `"${d.key}" is ${prefixed ? '' : 'not '}"${prefix}"-keyed but ` +
          `${owned ? '' : 'not '}owned by faction ${owner}`);
      }
    }
  }

  /* -- the progression tags ----------------------------------------------
   * Both directions, because both failures are silent and permanent. A tag on
   * a key that no longer exists gates nothing and reads as a working gate; a
   * tag naming an unlock id no mission grants makes the def permanently
   * unbuildable and reads as a balance decision. `MISSION_UNLOCK_IDS` is
   * derived FROM the mission table, so this cannot be satisfied by editing a
   * constant — only by authoring a mission that actually pays the unlock out. */
  for (const key of Object.keys(UNLOCK_TAGS)) {
    if (!unitKeys.has(key) && !buildingKeys.has(key)) {
      problems.push(`UNLOCK_TAGS gates unknown def "${key}"`);
    }
    const id = UNLOCK_TAGS[key];
    if (!MISSION_UNLOCK_IDS.includes(id)) {
      problems.push(`"${key}" is gated behind "${id}", which no mission grants`);
    }
  }

  /* -- a fresh profile must still be able to play ------------------------- *
   * The single most expensive thing this whole layer could get wrong is a
   * curve that gates something the first match cannot be played without. Each
   * army is checked for a full economic spine and at least one weapon, using
   * ONLY untagged defs, and a gated def whose prereq chain is itself gated is
   * counted as gated — so tagging a tech building can never quietly strand the
   * three units hanging off it without this failing.                        */
  {
    const openBuildings = new Map<string, BuildingDef>();
    for (const b of BUILDINGS) if (b.unlockedBy === undefined) openBuildings.set(b.key, b);
    const reachable = (d: { prereqs: readonly string[] }): boolean =>
      d.prereqs.every((p) => openBuildings.has(p));

    for (const f of FACTIONS) {
      if ((f.id as number) === (Faction.Neutral as number)) continue;
      const mine = <T extends { faction: Faction; unlockedBy?: string; prereqs: readonly string[] }>(
        list: readonly T[],
      ): T[] => list.filter((d) =>
        ((d.faction as number) === (f.id as number)
          || (d.faction as number) === (Faction.Neutral as number))
        && d.unlockedBy === undefined && reachable(d));

      const units = mine(UNITS);
      const structs = mine(BUILDINGS);
      const has = (pred: (b: BuildingDef) => boolean): boolean => structs.some(pred);

      if (!has((b) => b.power > 0)) problems.push(`"${f.key}" has no day-one power plant`);
      if (!has((b) => b.produces.length > 0 && b.producesTab === BuildTab.Infantry)) {
        problems.push(`"${f.key}" has no day-one infantry factory`);
      }
      if (!has((b) => b.produces.length > 0 && b.producesTab === BuildTab.Vehicles)) {
        problems.push(`"${f.key}" has no day-one vehicle factory`);
      }
      if (!has((b) => b.tab === BuildTab.Defense && b.weapons.length > 0)) {
        problems.push(`"${f.key}" has no day-one defensive structure`);
      }
      if (!units.some((u) => u.cargoMax > 0)) problems.push(`"${f.key}" has no day-one harvester`);
      if (!units.some((u) => u.kind === EntityKind.Infantry && u.weapons.length > 0)) {
        problems.push(`"${f.key}" has no day-one armed infantry`);
      }
      if (!units.some((u) => u.kind === EntityKind.Vehicle && u.weapons.length > 0)) {
        problems.push(`"${f.key}" has no day-one armed vehicle`);
      }
      if (!units.some((u) => u.canCapture)) problems.push(`"${f.key}" has no day-one engineer`);
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
 * ALL OF THE FOLLOWING IS DONE. This section is kept as the record of what the
 * seam looked like before the Meridian Pact shipped, because a fifth faction
 * would cross the same two gatekeepers — but read it as history, not as a task.
 * Every numbered blocker below is closed, and a whole FOURTH faction (the
 * Reclamation, `Faction.Reclaim = 4`, `FACTION_COUNT = 5`) has landed since.
 * The enum quoted in item 1 stops at `Meridian = 3` and is no longer the enum.
 *
 * What it COULD NOT do at the time was get a Meridian unit onto the map,
 * because two gatekeepers upstream of the def tables were keyed on tables in
 * other modules:
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

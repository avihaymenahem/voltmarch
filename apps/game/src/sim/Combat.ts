/**
 * ============================================================================
 * VOLTMARCH — src/sim/Combat.ts
 * ============================================================================
 * WEAPONS: the firing cycle, turret traverse, burst patterns, recoil, and the
 * hand-off to VFX and audio on every shot.
 *
 * THE ONE THING THIS FILE EXISTS FOR
 * ----------------------------------
 * A turret that slews independently of the hull. It is the single most
 * recognisable read in Command & Conquer: a column of Anvils drives north with
 * every gun tracking east. `turretYaw` is stored in WORLD space (not relative
 * to the hull) precisely so this file can write it without ever reading, or
 * fighting, whatever the movement layer is doing to `yaw`.
 *
 * WEAPON DATA
 * -----------
 * A weapon is CONTENT. When `src/data/**` ships a `DefTables`, call
 * `setWeaponTable(tables.weapons)` and `store.weaponIndex` becomes an index
 * into it — this file then knows nothing about balance. Until then it carries
 * `DEFAULT_WEAPONS`, a complete classic-C&C armoury, and resolves a weapon for
 * an entity in three escalating steps:
 *
 *   1. `store.weaponIndex[i] >= 0`               — a real def said so.
 *   2. the content-key resolver, if one is installed (see combat.system.ts)
 *   3. a shape heuristic over kind / armour / turret / faction.
 *
 * The resolution is cached in a generation-stamped side array, so it costs one
 * array read per entity per tick after the first.
 *
 * FIRING IS A STATE MACHINE IN TWO COLUMNS
 * ----------------------------------------
 * `cooldown` counts down in seconds; `burstLeft` counts shots remaining in the
 * current trigger pull. Between burst shots the cooldown is `burstDelay`; when
 * the burst empties it becomes the full `cooldown`, divided by the veterancy
 * rate-of-fire bonus. Two Uint8/Float32 columns, no per-unit object.
 *
 * DETERMINISM: no wall clock, no Math.random. Muzzle alternation comes from a
 * per-entity shot counter, not from a die roll.
 * ============================================================================
 */

import {
  COMBAT_PROJECTILES, COMBAT_WEAPONS, CELL, POWER_FULL_MUL,
} from '../core/config';
import {
  ArmorClass, EntityFlag, EntityKind, Faction, FxKind, Locomotor, OrderKind,
  PartId, ProjectileKind, Stance, UnitState, UpgradeLever, WarheadClass,
} from '../core/types';
import type {
  EntityId, PlayerId, SimContext, WeaponDef,
} from '../core/types';
import type { EntityStore, World } from '../core/world';
import type { Channels } from '../core/events';
import { PerEntityI16, PerEntityU32 } from '../core/world';
import {
  DEG2RAD, angleDelta, ballisticArc, clamp, leadTarget, turnToward,
} from '../core/math';
import { armorMultiplier, estimatedHeight, hitRadius, veterancyDamageMul } from './Damage';
import { ProjectileSystem, ROCKET_TURN_RATE } from './Projectiles';
import { upgradeMul } from './Upgrades';

/* ==========================================================================
 * 1. THE WEAPON TABLE
 * ========================================================================== */

/** Compact constructor so the table below reads as a table and not as prose. */
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
    // Opposite default to its sibling, and deliberately so — see WeaponDef.
    // A gun answers air only when its row SAYS it answers air.
    canTargetAir: extra?.canTargetAir ?? false,
    // TRUE by default, unlike its sibling above: a gun shoots the ground unless
    // its row says it cannot. The Interceptor and AA Battery say so explicitly.
    canTargetGround: extra?.canTargetGround ?? true,
    // 1 = "this row's air damage is whatever the armour matrix says". Only the
    // four line-infantry rifles carry anything else; see `rifle` below.
    airMultiplier: extra?.airMultiplier ?? 1,
    muzzleFx: extra?.muzzleFx ?? FxKind.MuzzleFlashSmall,
    travelFx: extra?.travelFx ?? FxKind.TracerBullet,
    impactFx: extra?.impactFx ?? FxKind.ImpactMetal,
    muzzleParts: extra?.muzzleParts ?? [PartId.MuzzleA],
    chainCount: extra?.chainCount ?? 0,
  };
}

const MUZZLE_PAIR: readonly PartId[] = [PartId.MuzzleA, PartId.MuzzleB];

/**
 * The one air-damage scale the four LINE-INFANTRY rifles share.
 *
 * ONE CONSTANT, FOUR ROWS, TWO FILES — `rifle` and `conscriptRifle` below,
 * `pulseCarbine` and `arcProd` in `data/Defs.ts`. It is a named export rather
 * than four literals because the derivation below is a single window computed
 * across all four armies at once: four copies of a number would let somebody
 * "fix" one army and leave the other three quietly describing a band nobody
 * re-derived. `tests/air-multiplier.spec.ts` asserts the roster carrying it is
 * exactly these four, in both directions.
 *
 * The full derivation is the block above `rifle`.
 */
export const LINE_RIFLE_AIR_MUL = 0.25;

/**
 * The fallback armoury. Ordering is STABLE — `WEAPON_KEYS` indexes into it and
 * saved games / replays would break if a row moved. Append, never reorder.
 *
 * Damage is per SHOT before the armour matrix. Read the pairs, not the
 * absolutes: a rifle does 18 to flesh and 1.8 to an Anvil; an Anvil's gun does 75
 * to an Anvil and 26 to a conscript. That spread IS the counter-triangle.
 *
 * `canTargetAir` is the second axis and it is off unless a row says otherwise.
 * The rule, applied identically here and in `data/Defs.ts`: A SOLDIER CAN POINT
 * HIS OWN WEAPON UP, AN AUTOCANNON TRACKS, A GUIDED ROCKET FOLLOWS, AND A
 * PURPOSE-BUILT AA MOUNT IS WHAT IT SAYS ON THE TIN. A tank cannon, an
 * artillery piece, a flamethrower, a torpedo tube, a naval deck gun, a
 * siege beam and an emplaced MG in a concrete box cannot. That leaves the
 * armoured column genuinely unable to answer a gunship, which is the whole
 * point of having one.
 */
export const DEFAULT_WEAPONS: readonly WeaponDef[] = [
  /*
   * `airMultiplier: 0.25` — THE LINE RIFLE IS AN EMERGENCY ANSWER, NOT AN
   * AIR-DEFENCE PLAN. Reported as *"Redecide who can shoot drones and planes,
   * they are being destroyed in nano seconds"*.
   *
   * FOUR ROWS CARRY THIS AND NOTHING ELSE DOES: this one, `conscriptRifle`
   * below, and `pulseCarbine` / `arcProd` in `data/Defs.ts`. They are the four
   * armies' LINE infantry weapons — the gun each army has the most of — and
   * that is the whole defect. Measured off the shipped tables (delivered dps
   * per 1000 credits against `ArmorClass.Light`, which every aircraft is):
   *
   *     army      line infantryman       its best dedicated answer     inversion
   *     Allies    gi           115.3     aaTurret       124.4            0.927x
   *     Meridian  mrdWayfarer  117.9     mrdSkiff        99.5            1.184x
   *     Soviets   conscript    220.0     flakTrooper     86.3            2.550x
   *     Reclaim   rclPicker    209.1     rclSkimmer      60.0            3.485x
   *
   * THE MECHANISM IS THE RAW DPS, NOT THE MULTIPLIER, which is why the AA rows
   * are innocent and cutting them would deepen the inversion. A rifle is
   * balanced to kill infantry (SmallArms 1.00 vs Infantry) and therefore
   * carries 47-52 raw dps; 55% of that is still 20-23. `flakBurst` is balanced
   * as an infantryman and carries 32.4 raw at 100%. The purpose-built weapon's
   * 1.6x multiplier and its 1.6x raw deficit CANCEL EXACTLY. Nothing ever chose
   * a rifle's air number; it fell out of one chosen for a different job.
   *
   * WHY NOT DELETE `canTargetAir` FROM THESE FOUR. It is the cleanest-looking
   * fix and it removes the anti-hang floor in all four armies at once — see
   * `WeaponDef.airMultiplier`. Five other candidates (a seventh `ArmorClass`,
   * an `EntityKind.Aircraft`, moving `ARMOR_MATRIX[SmallArms][Light]` off 0.55,
   * raising aircraft HP, a `BuildTab.Aircraft`) are costed and rejected in
   * CLAUDE.md; overturn one with an argument, not by restating it.
   *
   * THE NUMBER IS A WINDOW WITH A CHOICE INSIDE IT, and all three bounds are
   * computed from the shipped defs rather than picked. Eight men is the unit
   * throughout: one Barracks tab-full, the screen a player already owns without
   * ever deciding to, and the same squad `tests/emplacement-band.spec.ts`
   * derives its ceiling from.
   *
   *   CEILING A — ONE PASS. An aircraft's atomic piece of work is one attack
   *   pass, `2R / v` across the SHOOTER's disc, measured per hull: 3.13 s
   *   (Petrel), 3.33 (Kestrel), 2.52 (Interceptor), 2.55 (Swarmhornet). An
   *   aircraft that cannot survive one pass over a screen it did not choose to
   *   fight is not a unit class. `8 q T < hp` gives 0.416 / 0.382 / 0.428 /
   *   0.469 — binding 0.382, the Pact.
   *
   *   CEILING B — THE COUNTER MUST BE THE ANSWER. Credit for credit, an army's
   *   own dedicated answer must beat its line infantryman against aircraft, or
   *   the purpose-built thing is a trap nobody should ever buy. That is 1/the
   *   inversion column above: 1.078 / 0.844 / 0.392 / 0.287 — binding 0.287,
   *   the Reclamation.
   *
   *   FLOOR — THE ANTI-HANG FLOOR MUST STAY REAL. A floor that takes a minute
   *   is not a floor. Eight men must still kill an aircraft inside ten seconds:
   *   0.130 / 0.127 / 0.108 / 0.120 — binding 0.130, the Allies.
   *
   * Window [0.130, 0.287]. Shipped 0.25: 13% under the tightest ceiling and
   * 92% over the tightest floor, sitting HIGH in the window on purpose, because
   * the floor is the property that must never be lost and the ceilings are the
   * ones the report is about.
   *
   * TRAP 1, AND HOW THIS ANSWERS IT. A per-credit anchor always flatters the
   * cheapest unit in the game, and the tightest ceiling here IS set by a
   * 90-credit Scrap Picker. It does not set the SHIPPED number: the window is
   * bracketed at the top by the Reclamation and at the bottom by the Allies,
   * and 0.25 satisfies all four armies' own bounds simultaneously. Four
   * per-row values were considered and rejected — the four windows overlap on
   * [0.130, 0.287], so four numbers would encode a precision the arithmetic
   * does not support. The FIELD is per-weapon so they can diverge later; the
   * VALUE is one number because today the evidence says one number.
   *
   * WHAT IT BUYS, and every figure is re-derivable from `WEAPONS` + `UNITS`:
   *
   *                q     8 men kill    1 man kills   inversion   800 cr of line
   *     Allies    5.77     5.20 s        41.6 s        0.232x    2.60 -> 10.40 s
   *     Meridian  5.16     5.09 s        40.7 s        0.296x    2.23 ->  8.91 s
   *     Soviets   5.50     4.32 s        34.5 s        0.637x    1.08 ->  4.32 s
   *     Reclaim   4.70     4.78 s        38.3 s        0.871x    1.08 ->  4.30 s
   *
   * Every army's dedicated answer now wins per credit, the screen is 2.2-2.6x
   * slower than one AA Battery (1.81-2.41 s) instead of twice as fast, and one
   * rifleman alone still takes an aircraft down in 34-42 s — non-zero, bounded,
   * and the floor by construction.
   *
   * TRAP 2, DELIBERATELY NOT ACTED ON HERE. The AA Battery becomes the dominant
   * answer after this and must be RE-MEASURED — in its own commit, never this
   * one. `tests/aircraft-killer-probe.spec.ts` §4 prints the live figures.
   */
  /* 0 */ wpn('rifle', 'M1 Carbine', 18, WarheadClass.SmallArms, 18, 0.85,
    ProjectileKind.Bullet, 95,
    { burstCount: 3, burstDelay: 0.09, turretTurnRate: 320, canTargetAir: true,
      airMultiplier: LINE_RIFLE_AIR_MUL,
      muzzleFx: FxKind.MuzzleFlashSmall, travelFx: FxKind.TracerBullet, impactFx: FxKind.ImpactDirt }),

  /* 1 */ wpn('conscriptRifle', 'AK Pattern', 16, WarheadClass.SmallArms, 17, 0.8,
    ProjectileKind.Bullet, 92,
    { burstCount: 3, burstDelay: 0.08, turretTurnRate: 320, canTargetAir: true,
      airMultiplier: LINE_RIFLE_AIR_MUL,
      muzzleFx: FxKind.MuzzleFlashSmall, travelFx: FxKind.TracerBullet, impactFx: FxKind.ImpactDirt }),

  /* 2 */ wpn('bite', 'Jaws', 55, WarheadClass.SmallArms, 3.6, 1.1,
    ProjectileKind.Instant, 0,
    { turretTurnRate: 720, canTargetInfantry: true,
      muzzleFx: FxKind.None, travelFx: FxKind.None, impactFx: FxKind.CrushSquish }),

  /* 3 */ wpn('lightCannon', '90 mm Cannon', 55, WarheadClass.ArmorPiercing, 24, 1.5,
    ProjectileKind.Bullet, 115,
    { splashRadius: 1.6, splashFalloff: 0.3, turretTurnRate: 95,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.TracerCannon, impactFx: FxKind.ImpactMetal }),

  /* 4 */ wpn('heavyCannon', '125 mm Cannon', 78, WarheadClass.ArmorPiercing, 26, 2.0,
    ProjectileKind.Bullet, 118,
    { splashRadius: 2.1, splashFalloff: 0.3, turretTurnRate: 70,
      muzzleFx: FxKind.MuzzleFlashLarge, travelFx: FxKind.TracerCannon, impactFx: FxKind.ImpactMetal }),

  /* 5 */ wpn('twinCannon', 'Twin 125 mm', 60, WarheadClass.ArmorPiercing, 28, 2.4,
    ProjectileKind.Bullet, 120,
    { burstCount: 2, burstDelay: 0.18, splashRadius: 2.2, splashFalloff: 0.3,
      turretTurnRate: 60, muzzleParts: MUZZLE_PAIR,
      muzzleFx: FxKind.MuzzleFlashLarge, travelFx: FxKind.TracerCannon, impactFx: FxKind.ImpactMetal }),

  /* 6 */ wpn('chaingun', '25 mm Chaingun', 22, WarheadClass.AutoCannon, 22, 0.55,
    ProjectileKind.Bullet, 150,
    { burstCount: 4, burstDelay: 0.07, turretTurnRate: 200, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashSmall, travelFx: FxKind.TracerBullet, impactFx: FxKind.ImpactMetal }),

  /* 7 */ wpn('prismBeam', 'Prism Emitter', 92, WarheadClass.Prism, 30, 2.6,
    ProjectileKind.Beam, 0,
    { turretTurnRate: 70, requiresStop: true,
      muzzleFx: FxKind.None, travelFx: FxKind.PrismBeam, impactFx: FxKind.Sparks }),

  // The Allied and Soviet halves of `BuildRole.AntiAir`. `canTargetAir` here is
  // not flavour: `tests/air-layer.spec.ts` asserts that every structure the AI's
  // AntiAir slot can build carries an air-capable weapon, because an AA
  // interrupt that queues a tower which cannot shoot up is the same nothing the
  // whole air layer used to be.
  /* 8 */ wpn('prismTowerBeam', 'Prism Cannon', 115, WarheadClass.Prism, 34, 3.0,
    ProjectileKind.Beam, 0,
    { turretTurnRate: 60, needsPower: true, canTargetAir: true,
      muzzleFx: FxKind.None, travelFx: FxKind.PrismBeam, impactFx: FxKind.Sparks }),

  /* 9 */ wpn('teslaBolt', 'Tesla Coil', 120, WarheadClass.Tesla, 30, 2.4,
    ProjectileKind.TeslaBolt, 0,
    { turretTurnRate: 360, needsPower: true, chainCount: 2, canTargetAir: true,
      muzzleFx: FxKind.None, travelFx: FxKind.TeslaArc, impactFx: FxKind.Sparks }),

  // Range 15 -> 18. Still the shortest gun in the game by four metres, which is
  // what "Short-ranged, brutal on infantry" should mean — but 15 put it inside
  // the stopping distance of every attacker in the game (a unit closes to
  // `range * 0.80`, so a 22 m rifleman parks at 17.6 and a 30 m Warden at 24),
  // and a defence nothing ever enters the envelope of is a 600-credit ornament.
  /* 10 */ wpn('flameJet', 'Flame Nozzle', 26, WarheadClass.HighExplosive, 18, 0.5,
    ProjectileKind.Flame, COMBAT_PROJECTILES.flameSpeed,
    { splashRadius: 3.2, splashFalloff: 0.45, turretTurnRate: 150,
      muzzleFx: FxKind.FlameJet, travelFx: FxKind.FlameJet, impactFx: FxKind.ExplosionSmall }),

  /*
   * RETUNED 2026-08-18, from *"Gunner stations should be a less powerfull, one
   * can destroy a full army in a second"*. That report is literal, and the
   * cause was the TRIGGER PULL rather than the sustained dps.
   *
   * This row and `glaiveRepeater` were the two highest-damage-per-second
   * entries in the whole 42-row armoury, on the two CHEAPEST emplacements in
   * the game. Five rounds left in 0.24 s, so one pull was 100 damage — at or
   * above the full health of three of the four line infantrymen (G.I. 120,
   * Conscript 100, Wayfarer 110, Scrap Picker 85). A burst was a man, 1.45
   * times a second.
   *
   *     before   5 x 20 / 0.69 s cycle = 144.9 dps   362 per 1000 credits
   *     after    5 x 13 / 0.79 s cycle =  82.3 dps   206 per 1000 credits
   *
   * THE TARGET IS DERIVED, NOT PICKED. Eight G.I.s assault a 400-credit
   * Pillbox: the post kills sequentially so its dps is flat, while the squad's
   * decays as men drop. The squad lands `36 x r x 120/D`, where r is the
   * squad's 9.43 dps into Concrete. At the shipped 144.9 the squad died having
   * dealt 282 of the box's 500 hp — 1600 credits of infantry, and the box
   * survives with 44%. Break-even is D = 81.5 dps, which is where this now
   * sits. `tests/emplacement-band.spec.ts` pins the band and the pull.
   *
   * The cooldown carries part of it deliberately: dropping damage alone would
   * have kept a 1.45 Hz trigger, and the complaint is about how fast a squad
   * evaporates, not only about the total.
   */
  /* 11 */ wpn('pillboxMg', 'Emplaced MG', 13, WarheadClass.SmallArms, 22, 0.55,
    ProjectileKind.Bullet, 110,
    { burstCount: 5, burstDelay: 0.06, turretTurnRate: 260,
      muzzleFx: FxKind.MuzzleFlashSmall, travelFx: FxKind.TracerBullet, impactFx: FxKind.ImpactDirt }),

  /* 12 */ wpn('artillery', 'V4 Launcher', 130, WarheadClass.HighExplosive, 48, 4.5,
    ProjectileKind.Shell, 46,
    { minRange: 12, splashRadius: 6.5, splashFalloff: 0.2, turretTurnRate: 40,
      requiresStop: true, canTargetInfantry: true,
      muzzleFx: FxKind.MuzzleFlashLarge, travelFx: FxKind.RocketTrail, impactFx: FxKind.ExplosionLarge }),

  /* 13 */ wpn('navalGun', '5 in Deck Gun', 74, WarheadClass.HighExplosive, 34, 2.2,
    ProjectileKind.Shell, 72,
    { splashRadius: 3.6, splashFalloff: 0.25, turretTurnRate: 70,
      muzzleFx: FxKind.MuzzleFlashLarge, travelFx: FxKind.TracerCannon, impactFx: FxKind.ExplosionSmall }),

  /* 14 */ wpn('shipMissile', 'Cruise Battery', 120, WarheadClass.Rocket, 42, 4.0,
    ProjectileKind.Rocket, 44,
    { burstCount: 2, burstDelay: 0.35, splashRadius: 4.5, splashFalloff: 0.25,
      turretTurnRate: 50, muzzleParts: MUZZLE_PAIR, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.RocketTrail, impactFx: FxKind.ExplosionMedium }),

  /* 15 */ wpn('torpedo', 'Torpedo Tube', 105, WarheadClass.Rocket, 30, 3.4,
    ProjectileKind.Rocket, 30,
    { splashRadius: 3.0, splashFalloff: 0.3, turretTurnRate: 60,
      muzzleFx: FxKind.None, travelFx: FxKind.Splash, impactFx: FxKind.ExplosionMedium }),

  /* 16 */ wpn('rocketLauncher', 'Shoulder Rocket', 60, WarheadClass.Rocket, 24, 2.2,
    ProjectileKind.Rocket, 38,
    { splashRadius: 2.4, splashFalloff: 0.3, turretTurnRate: 260, canTargetAir: true,
      muzzleFx: FxKind.MuzzleFlashMedium, travelFx: FxKind.RocketTrail, impactFx: FxKind.ExplosionSmall }),

  /* 17 */ wpn('aaCannon', 'Flak Battery', 34, WarheadClass.AutoCannon, 26, 0.7,
    ProjectileKind.Bullet, 160,
    { burstCount: 3, burstDelay: 0.06, splashRadius: 1.2, splashFalloff: 0.4,
      turretTurnRate: 240, canTargetAir: true, canTargetGround: false,
      muzzleFx: FxKind.MuzzleFlashMedium,
      travelFx: FxKind.TracerBullet, impactFx: FxKind.Sparks }),
];

/** Live table. Replaced wholesale when a data module ships one. */
let weapons: readonly WeaponDef[] = DEFAULT_WEAPONS;
/** key -> index, rebuilt whenever the table changes. */
let weaponByKey = new Map<string, number>();
function rebuildKeyIndex(): void {
  weaponByKey = new Map<string, number>();
  for (let i = 0; i < weapons.length; i++) weaponByKey.set(weapons[i].key, i);
}
rebuildKeyIndex();

/** Install a content-authored weapon table. */
export function setWeaponTable(table: readonly WeaponDef[]): boolean {
  if (table.length === 0) return false;
  weapons = table;
  rebuildKeyIndex();
  return true;
}

/** The live weapon table. */
export function weaponTable(): readonly WeaponDef[] { return weapons; }

/** Index of a weapon by key, or -1. */
export function weaponIndexOf(key: string): number {
  const i = weaponByKey.get(key);
  return i === undefined ? -1 : i;
}

/** A weapon by index, or undefined. */
export function weaponAt(index: number): WeaponDef | undefined {
  return index >= 0 && index < weapons.length ? weapons[index] : undefined;
}

/* ==========================================================================
 * 2. WEAPON RESOLUTION
 * ========================================================================== */

/**
 * Optional hook installed by the wiring layer: given an entity handle, return
 * the CONTENT KEY of whatever spawned it ('grizzly', 'teslaCoil'). Lets combat
 * pick a sensible weapon before any def table exists, without `src/sim`
 * importing `src/game`.
 */
type KeyResolver = (id: EntityId) => string;
let keyResolver: KeyResolver | null = null;
/** Content key -> weapon key. Consulted before the shape heuristic. */
let keyToWeapon = new Map<string, string>();

export function setWeaponKeyResolver(fn: KeyResolver | null): void {
  keyResolver = fn;
}

/** Publish a content-key -> weapon-key table. Replaces whatever was there. */
export function setContentWeaponMap(map: Readonly<Record<string, string>>): void {
  keyToWeapon = new Map<string, string>();
  for (const k in map) keyToWeapon.set(k, map[k]);
}

/**
 * Shape heuristic: pick a plausible weapon from the columns the EntityStore
 * already carries. Deliberately coarse — it exists so a scenario spawned from
 * fallback stats still FIGHTS, and it is completely bypassed the moment real
 * defs exist.
 */
function heuristicWeapon(
  kind: EntityKind, armor: ArmorClass, faction: Faction,
  hasTurret: boolean, footprintW: number, sight: number, radius: number,
): number {
  if (kind === EntityKind.Infantry) {
    // A dog has no gun and a tiny reach; everything else carries a rifle.
    if (radius < 0.7) return 2;
    return faction === Faction.Soviets ? 1 : 0;
  }
  if (kind === EntityKind.Building) {
    if (hasTurret) return faction === Faction.Soviets ? 9 : 8;
    // Turretless defences: the Soviet one is short-ranged and burns.
    if (faction === Faction.Soviets) return sight <= 24 ? 10 : 9;
    return 11;
  }
  // Vehicles.
  if (!hasTurret) return 16;
  if (footprintW > 0) return 13;
  switch (armor) {
    case ArmorClass.Heavy: return radius > 3.4 ? 5 : 4;
    case ArmorClass.Medium: return 3;
    default: return 6;
  }
}

/* ==========================================================================
 * 3. THE WEAPON SYSTEM — Phase.Weapons (1000)
 * ========================================================================== */

export interface WeaponStats {
  /** Entities that ran a firing cycle this tick. */
  active: number;
  /** Shots fired this tick. */
  shots: number;
  /** Entities currently slewing onto a bearing but not yet allowed to fire. */
  slewing: number;
}

const AIM_TOL = COMBAT_WEAPONS.aimToleranceDeg * DEG2RAD;
const HULL_ARC = COMBAT_WEAPONS.hullArcDeg * DEG2RAD;
const MAX_ELEV = COMBAT_WEAPONS.maxElevationDeg * DEG2RAD;
const MIN_ELEV = COMBAT_WEAPONS.minElevationDeg * DEG2RAD;

/**
 * May this entity's gun bear independently of its chassis?
 *
 * `HasTurret` is the obvious yes. THE SECOND CASE IS EVERY ARMED STRUCTURE, and
 * leaving it out is what made "Flame Tower doesnt seem to do anything at all"
 * true. The turretless branch below welds `turretYaw` to `yaw` and then refuses
 * to fire outside `HULL_ARC` — 14 degrees. For a vehicle that is a transient:
 * Steering rotates the hull to bring the gun round. A building has no steering.
 * Its yaw is whatever the player happened to place it at and it never changes,
 * so the 28-degree window is permanent and an emplacement covers 7.8% of the
 * compass forever.
 *
 * `src/art/BuildingDefs.ts#sovietFlameTower` diagnosed exactly this and fixed
 * the model — it gave the tower four radial nozzles so it "is correct at any
 * yaw". Nobody fixed the gun, so a correct-at-any-yaw model still only shot
 * north.
 *
 * A structure's gun is an emplacement mount and rotates whether or not the mass
 * list has a separately-transformed turret. Where the model DOES have one, the
 * render already follows `turretYaw` for parts marked as turret-following, so
 * this makes the barrel track too; where it does not, `turretYaw` is invisible
 * and only steers the muzzle socket the FX spawn from — which is exactly what
 * should happen.
 */
function canTraverse(kind: number, flags: number): boolean {
  return (flags & EntityFlag.HasTurret) !== 0 || kind === EntityKind.Building;
}

export class WeaponSystem {
  /** Cached weapon index per entity. -2 = not yet resolved, -1 = unarmed. */
  private readonly resolved: PerEntityI16;
  /** Monotonic shot counter per entity, for muzzle alternation. */
  private readonly shotCount: PerEntityU32;

  private readonly lead = new Float32Array(2);
  /** Candidate buffer for the tesla chain hop. */
  private readonly chainScratch = new Int32Array(64);
  /** Slots already electrocuted by the current bolt (primary + every link). */
  private readonly chainHit = new Int32Array(8);
  private readonly muzzle = new Float32Array(3);
  private readonly aim = new Float32Array(3);

  readonly stats: WeaponStats = { active: 0, shots: 0, slewing: 0 };

  constructor(
    private readonly world: World,
    private readonly channels: Channels,
    private readonly projectiles: ProjectileSystem,
  ) {
    this.resolved = new PerEntityI16(world.store, -2);
    this.shotCount = new PerEntityU32(world.store, 0);
  }

  /**
   * The weapon slot for an entity, resolved once and cached.
   * Returns -1 for anything unarmed.
   */
  weaponSlotFor(i: number): number {
    const cached = this.resolved.getAt(i);
    if (cached !== -2) return cached;

    const st = this.world.store;
    let slot = st.weaponIndex[i];
    if (slot < 0 || slot >= weapons.length) {
      slot = -1;
      if (keyResolver !== null) {
        const key = keyResolver(st.handleOf(i));
        if (key !== '') {
          const wkey = keyToWeapon.get(key);
          if (wkey !== undefined) slot = weaponIndexOf(wkey);
        }
      }
      if (slot < 0 && (st.flags[i] & EntityFlag.CanAttack) !== 0) {
        slot = heuristicWeapon(
          st.kind[i] as EntityKind, st.armorClass[i] as ArmorClass, st.faction[i] as Faction,
          (st.flags[i] & EntityFlag.HasTurret) !== 0,
          st.footprintW[i], st.sight[i], st.radius[i],
        );
      }
    }
    this.resolved.setAt(i, slot);
    return slot;
  }

  /** The WeaponDef an entity would fire, or undefined. */
  weaponFor(i: number): WeaponDef | undefined {
    return weaponAt(this.weaponSlotFor(i));
  }

  /* ---------------------------------------------------------------------- */

  tick(s: SimContext): void {
    const st = this.world.store;
    const n = st.aliveCount;
    this.stats.active = 0;
    this.stats.shots = 0;
    this.stats.slewing = 0;

    for (let a = 0; a < n; a++) {
      const i = st.alive[a];
      const f = st.flags[i];
      if ((f & EntityFlag.PendingDestroy) !== 0) continue;
      if ((f & EntityFlag.CanAttack) === 0) {
        // Turretless, gunless things still need `turretYaw` to track the hull,
        // or a model's turret socket points at the map origin forever.
        if ((f & EntityFlag.HasTurret) === 0) st.turretYaw[i] = st.yaw[i];
        continue;
      }

      // Cooldown always runs, even with no target: a unit that just fired and
      // then lost its target must not get a free instant shot on reacquire.
      if (st.cooldown[i] > 0) st.cooldown[i] = Math.max(0, st.cooldown[i] - s.dt);
      // Recoil recovery. The IMPULSE is written on the shot below; the decay
      // lives here so the column is correct even with no animation module.
      if (st.recoil[i] !== 0) {
        st.recoil[i] *= Math.max(0, 1 - COMBAT_WEAPONS.recoilLambda * s.dt);
        if (Math.abs(st.recoil[i]) < 1e-3) st.recoil[i] = 0;
      }

      const traverses = canTraverse(st.kind[i], f);
      const slot = this.weaponSlotFor(i);
      const w = weaponAt(slot);
      if (w === undefined) { if (!traverses) st.turretYaw[i] = st.yaw[i]; continue; }

      const t = st.index(st.targetId[i] as EntityId);
      if (t < 0) {
        // No target: relax the turret back to the hull. Slowly, so a turret
        // that just lost its mark does not snap forward like a toy. An
        // emplacement relaxes to its PLACED yaw by the same path — the tower
        // settles back to facing the way it was built rather than freezing on
        // the bearing of whatever it last killed.
        const rate = this.slewRate(i, w) * 0.5 * s.dt;
        st.turretYaw[i] = traverses
          ? turnToward(st.turretYaw[i], st.yaw[i], rate)
          : st.yaw[i];
        st.barrelPitch[i] = turnToward(st.barrelPitch[i], 0, rate);
        continue;
      }

      this.stats.active++;
      this.engage(s, i, t, w, slot);
    }
  }

  /** Slew rate in radians/second for this entity's turret. */
  private slewRate(i: number, w: WeaponDef): number {
    const own = this.world.store.turretTurnRate[i];
    if (own > 0) return own;
    if (w.turretTurnRate > 0) return w.turretTurnRate * DEG2RAD;
    return COMBAT_WEAPONS.defaultTurretTurnRate;
  }

  /**
   * One entity, one target, one tick: traverse, elevate, and fire if the
   * bearing, the range and the cooldown all agree.
   */
  private engage(s: SimContext, i: number, t: number, w: WeaponDef, slot: number): void {
    const st = this.world.store;
    const traverses = canTraverse(st.kind[i], st.flags[i]);

    this.muzzleOf(i, this.muzzle);
    this.aimPointOf(t, this.aim);

    // Lead the target so a moving tank is actually hit rather than chased.
    // Instant/Beam weapons have infinite projectile speed and need no lead.
    let ax = this.aim[0], az = this.aim[2];
    const travelling = w.projectile !== ProjectileKind.Instant && w.projectile !== ProjectileKind.Beam
      && w.projectile !== ProjectileKind.TeslaBolt && w.projectileSpeed > 0;
    if (travelling) {
      leadTarget(
        this.muzzle[0], this.muzzle[2], ax, az,
        st.velX[t], st.velZ[t], w.projectileSpeed, this.lead,
      );
      ax = this.lead[0]; az = this.lead[1];
    }

    const dx = ax - this.muzzle[0];
    const dz = az - this.muzzle[2];
    const dy = this.aim[1] - this.muzzle[1];
    const flat = Math.sqrt(dx * dx + dz * dz);
    const aimYaw = Math.atan2(dx, dz);

    // --- traverse --------------------------------------------------------
    const rate = this.slewRate(i, w) * s.dt;
    if (traverses) {
      st.turretYaw[i] = turnToward(st.turretYaw[i], aimYaw, rate);
    } else {
      // A hull-mounted weapon cannot traverse: the turret column mirrors the
      // hull so the muzzle socket stays welded to the chassis.
      st.turretYaw[i] = st.yaw[i];
    }

    // --- elevate ---------------------------------------------------------
    /*
     * The ordinary elevation limits describe a ground weapon mount. They must
     * not clip a shot that crosses the air layer: at cruise altitude the old
     * +62 degree ceiling created an 8 m overhead dead zone, while the -12
     * degree floor made an airborne bullet weapon miss ground targets it was
     * otherwise allowed to engage. Keep ballistic shells on their authored
     * ground arc; direct fire across layers follows the actual bearing.
     */
    const crossesAirLayer = isAirborne(st, i) !== isAirborne(st, t);
    let launchPitch: number;
    if (w.projectile === ProjectileKind.Shell && w.projectileSpeed > 0) {
      const solved = ballisticArc(Math.max(0.5, flat), dy, w.projectileSpeed, COMBAT_PROJECTILES.gravity);
      // NaN means "out of ballistic reach": hold at max elevation, which both
      // looks right and drops the round as far downrange as physics allows.
      launchPitch = Number.isNaN(solved) ? MAX_ELEV : clamp(solved, MIN_ELEV, MAX_ELEV);
    } else if (crossesAirLayer) {
      launchPitch = Math.atan2(dy, Math.max(0.01, flat));
    } else {
      launchPitch = clamp(Math.atan2(dy, Math.max(0.5, flat)), MIN_ELEV, MAX_ELEV);
    }
    st.barrelPitch[i] = turnToward(st.barrelPitch[i], launchPitch, rate);

    // --- gating ----------------------------------------------------------
    // The air veto lives HERE and not only in Targeting, because an explicit
    // Attack / ForceAttack order writes `targetId` straight past
    // `isValidTarget` (Targeting §"an explicit order beats everything"). Every
    // other gate below is likewise a firing rule rather than an acquisition
    // one, and this is the same kind of rule: a hull-mounted cannon that cannot
    // elevate does not start being able to because somebody clicked on the
    // gunship. The turret still tracks — only the trigger is held.
    if (!w.canTargetAir && isAirborne(st, t)) return;
    // The mirror. Redundant against acquisition — `weaponCanHurt` refuses the
    // target upstream — and kept anyway for the reason the line above it is:
    // a FORCE-FIRE reaches this function without going through acquisition at
    // all, and a player force-firing an Interceptor at a building would
    // otherwise get the pre-fix behaviour back, one click wide.
    if (!w.canTargetGround && !isAirborne(st, t)) return;
    if (st.cooldown[i] > 0) return;
    // Hold-fire units still track a target with the turret (the gating above
    // already ran) — they simply never pull the trigger unless force-fired.
    if (st.stance[i] === Stance.HoldFire && st.orderKind[i] !== OrderKind.ForceAttack) return;
    if ((st.flags[i] & EntityFlag.UnderConstruction) !== 0) return;
    /*
     * A DARK BUILDING CANNOT SHOOT — reported as *"If no electrcity left,
     * buildings shouldnt be able to shoot / generate troops"*.
     *
     * THIS USED TO BE A TRIPLE CONDITION and the first third of it was the
     * defect: `w.needsPower && NeedsPower && !Powered`. Only FOUR weapon rows in
     * the whole 42-row armoury carry `needsPower`, so of the ten armed
     * structures in the game exactly 4/10 went quiet in a blackout and six kept
     * firing on a grid producing nothing. It is 7/10 now, and the three that
     * changed are the three that were drawing power while they fired:
     *
     *     flameTower   -20   flameJet     Soviets
     *     aaTurret     -30   aaCannon     Allies
     *     rclPylon     -90   pylonArc     Reclamation
     *
     * A tower drawing ninety points of a grid producing zero, still shooting,
     * is the report verbatim.
     *
     * The gate is a fact about the ENTITY now. `EntityFlag.NeedsPower` is
     * derived from a NEGATIVE POWER DRAW (`Scenarios.building()`,
     * `mrdFlags`/`rclFlags`), and `EntityFlag.Powered` is written only by
     * `PowerGrid.recompute` — pass 1 powers every completed structure, pass 2
     * darkens shed victims in `POWER_SHED_ORDER`, where `defence` is class 0
     * and goes first. So the pair reads exactly "this thing consumes
     * electricity and is not getting any", which is the sentence in the report.
     *
     * BOTH BITS ARE LOAD-BEARING AND NEITHER CAN BE DROPPED. A vehicle or a
     * rifleman never carries `Powered` — `PowerGrid` walks
     * `byKind[EntityKind.Building]` and nothing else — so testing `Powered`
     * alone would silence the entire mobile army the instant this line shipped.
     *
     * WHAT DELIBERATELY STILL FIRES: an armed structure with a draw of ZERO.
     * `pillbox`, `sentryGun` and `rclSpitpost` are all `power: 0`, never carry
     * `NeedsPower`, and are never shed — an MG in a concrete box has no wire to
     * cut. That is also what keeps `rclSpitpost`'s blurb ("Fires through a
     * blackout") true, and what stops a blackout from being an instant loss:
     * three of the four armies keep one cheap gun. The Pact keeps none, which
     * is its documented doctrine and not an oversight.
     */
    if ((st.flags[i] & (EntityFlag.NeedsPower | EntityFlag.Powered)) === EntityFlag.NeedsPower) {
      return;
    }
    /*
     * AND `WeaponDef.needsPower` IS THE SECOND, STRICTER TIER — the one thing
     * the shed order cannot express.
     *
     * `PowerGrid.shed` darkens only ENOUGH structures to cover the shortfall,
     * biggest draw first, so a one-point deficit takes the single heaviest
     * defence and leaves the rest of the belt lit. Two files already describe
     * the opposite as fact: `AIStrategy.ts` says of the Pact that "a brownout is
     * not an inconvenience for this faction, it is a disarm", and `Defs.ts` that
     * "four Sandskiffs behind the lines silence a whole defensive belt". Under
     * the tier above alone both were false.
     *
     * So an ELECTRIC weapon on a structure refuses whenever its owner's grid is
     * in deficit at all, shed victim or not. Measured over the shipped defence
     * sets, this changes exactly one thing that the tier above did not already
     * cover: the Glaive Post (-10) now goes dark with the Helios Spire (-55)
     * instead of surviving small deficits. Every other `needsPower` carrier —
     * `prismTower` -50, `teslaCoil` -75, `mrdHelios` -55 — is the biggest draw
     * in its own defence class and was already shed first.
     *
     * `EntityFlag.NeedsPower` is re-tested and that is deliberate: it is what
     * keeps the War Commissar firing. He carries `teslaBolt`, which is the Tesla
     * COIL's row, and infantry never carry the flag — see the block above his
     * def in `Defs.ts`.
     *
     * THE BROWNOUT PROBE IS `buildSpeedMul`, NOT `powerConsumed > powerProduced`.
     * `PowerGrid.recompute` is the only writer of the former and pins it to
     * exactly `POWER_FULL_MUL` whenever supply covers demand, whereas the two
     * power fields are ALSO incremented optimistically by
     * `Production.spawnBuilding` the moment a foundation is poured — so reading
     * those would silence a defensive belt for one tick every time its owner
     * placed a building.
     */
    if (w.needsPower && (st.flags[i] & EntityFlag.NeedsPower) !== 0
        && this.world.players[st.owner[i]].buildSpeedMul < POWER_FULL_MUL) return;
    if (w.requiresStop && st.speed[i] > COMBAT_WEAPONS.stoppedSpeed) return;

    const surfaceDist = Math.max(0, flat - hitRadius(st.footprintW[t], st.footprintH[t], st.radius[t]));
    if (surfaceDist > w.range) return;
    if (w.minRange > 0 && surfaceDist < w.minRange) return;

    const tolerance = traverses ? AIM_TOL : HULL_ARC;
    if (Math.abs(angleDelta(st.turretYaw[i], aimYaw)) > tolerance) { this.stats.slewing++; return; }
    // Arcing weapons do not care about elevation error; direct-fire ones do.
    if (w.projectile !== ProjectileKind.Shell
        && Math.abs(angleDelta(st.barrelPitch[i], launchPitch)) > tolerance * 2) {
      this.stats.slewing++; return;
    }

    this.fire(i, t, w, ax, az, launchPitch);
  }

  /* ======================================================================
   * FIRING
   * ====================================================================== */

  private fire(
    i: number, t: number, w: WeaponDef,
    aimX: number, aimZ: number, launchPitch: number,
  ): void {
    const st = this.world.store;
    const faction = st.faction[i] as Faction;
    const owner = st.owner[i] as PlayerId;
    const shooter = st.handleOf(i);
    const targetHandle = st.handleOf(t);
    const vetDamage = veterancyDamageMul(st.veterancy[i]);
    // THE PURCHASED DAMAGE MULTIPLIER, read at the instant the shot leaves.
    // Alongside veterancy rather than instead of it: veterancy is what THIS
    // unit earned, the upgrade is what its OWNER bought, and they multiply.
    // Reading it here rather than re-statting the unit is what makes a tank
    // built after the purchase hit just as hard as one built before it.
    const upgDamage = upgradeMul(
      this.world.players[st.owner[i]], UpgradeLever.Damage, st.kind[i] as EntityKind,
    );
    const damage = w.damage * vetDamage * upgDamage;

    // Recompute the muzzle AFTER the traverse so the flash is on the barrel
    // that just moved, not on last tick's bearing.
    this.muzzleOf(i, this.muzzle);
    const mx = this.muzzle[0], my = this.muzzle[1], mz = this.muzzle[2];

    const dxz = Math.atan2(aimX - mx, aimZ - mz);
    const dirX = Math.sin(dxz) * Math.cos(launchPitch);
    const dirZ = Math.cos(dxz) * Math.cos(launchPitch);
    const dirY = Math.sin(launchPitch);

    switch (w.projectile) {
      case ProjectileKind.Instant:
      case ProjectileKind.Beam:
        this.resolveInstant(i, t, w, damage, mx, my, mz, faction);
        break;
      case ProjectileKind.TeslaBolt:
        this.resolveTesla(i, t, w, damage, mx, my, mz, faction, owner);
        break;
      default:
        this.projectiles.spawn(
          w.projectile, w.warhead, damage, w.splashRadius, w.splashFalloff,
          mx, my, mz, dirX, dirY, dirZ,
          w.projectileSpeed > 0 ? w.projectileSpeed : 60,
          shooter, targetHandle, owner, faction,
          w.impactFx, w.travelFx,
          w.projectile === ProjectileKind.Rocket ? ROCKET_TURN_RATE : 0,
          w.airMultiplier,
        );
        break;
    }

    // --- presentation ----------------------------------------------------
    if (w.muzzleFx !== FxKind.None) {
      this.channels.fx.push(w.muzzleFx, mx, my, mz, dirX, dirY, dirZ, 1, shooter, faction);
    }
    if (w.projectile === ProjectileKind.Bullet && w.warhead === WarheadClass.SmallArms) {
      this.channels.fx.push(FxKind.ShellCasing, mx, my, mz, dirX, dirY, dirZ, 1, shooter, faction);
    }
    this.world.audio.play(w.muzzleFx !== FxKind.None ? w.muzzleFx : FxKind.TracerBullet, mx, mz, 0.9);

    // Recoil impulse, scaled by shot weight. Decays in `tick`.
    st.recoil[i] = COMBAT_WEAPONS.recoilMetres * clamp(w.damage / 60, 0.25, 2.0);

    // --- burst / cooldown -------------------------------------------------
    this.shotCount.setAt(i, this.shotCount.getAt(i) + 1);
    // Veterancy and the purchased rate-of-fire upgrade are both cooldown
    // MULTIPLIERS where lower is faster, so they compose by multiplying.
    // `burstDelay` is deliberately NOT scaled: it is the interval WITHIN one
    // trigger pull, and stretching or squeezing it would change the weapon's
    // sound and muzzle rhythm rather than its rate of fire.
    const rof = COMBAT_WEAPONS.vetCooldownMul[Math.min(2, st.veterancy[i])]
      * upgradeMul(this.world.players[st.owner[i]], UpgradeLever.Cooldown, st.kind[i] as EntityKind);
    if (w.burstCount > 1) {
      let left = st.burstLeft[i];
      if (left === 0) left = w.burstCount;
      left--;
      st.burstLeft[i] = left;
      st.cooldown[i] = left > 0 ? w.burstDelay : w.cooldown * rof;
    } else {
      st.burstLeft[i] = 0;
      st.cooldown[i] = w.cooldown * rof;
    }
    this.stats.shots++;
  }

  /**
   * Hitscan and beams: the damage lands this tick. A beam pushes ONE FX record
   * carrying the muzzle position, the direction to the target and the distance
   * in `scale`, which is everything a beam renderer needs and nothing more.
   */
  private resolveInstant(
    i: number, t: number, w: WeaponDef, damage: number,
    mx: number, my: number, mz: number, faction: Faction,
  ): void {
    const st = this.world.store;
    this.aimPointOf(t, this.aim);
    const hx = this.aim[0], hy = this.aim[1], hz = this.aim[2];
    const dx = hx - mx, dy = hy - my, dz = hz - mz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    this.channels.damage.push(
      st.handleOf(t), st.handleOf(i), damage, w.warhead,
      hx, hy, hz, w.splashRadius, w.splashFalloff, w.airMultiplier,
    );
    if (w.travelFx !== FxKind.None) {
      // scale carries the beam LENGTH in metres; dx/dy/dz are the unit vector.
      this.channels.fx.push(
        w.travelFx, mx, my, mz, dx / d, dy / d, dz / d, d, st.handleOf(i), faction,
      );
    }
  }

  /**
   * Tesla: the primary target plus `chainCount` arcs, each jumping to the
   * nearest un-hit hostile within `teslaChainRange` of the PREVIOUS victim and
   * carrying a decaying fraction of the damage. The chain following the
   * victims (rather than the shooter) is what makes it hop down a column.
   */
  private resolveTesla(
    i: number, t: number, w: WeaponDef, damage: number,
    mx: number, my: number, mz: number, faction: Faction, owner: PlayerId,
  ): void {
    const world = this.world;
    const st = world.store;
    const shooter = st.handleOf(i);

    let fromX = mx, fromY = my, fromZ = mz;
    let victim = t;
    let dmg = damage;
    let hitCount = 0;
    this.chainHit[hitCount++] = t;

    for (let link = 0; link <= w.chainCount; link++) {
      this.aimPointOf(victim, this.aim);
      const hx = this.aim[0], hy = this.aim[1], hz = this.aim[2];
      const dx = hx - fromX, dy = hy - fromY, dz = hz - fromZ;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

      this.channels.damage.push(
        st.handleOf(victim), shooter, dmg, w.warhead, hx, hy, hz,
        w.splashRadius, w.splashFalloff, w.airMultiplier,
      );
      this.channels.fx.push(
        FxKind.TeslaArc, fromX, fromY, fromZ, dx / d, dy / d, dz / d, d, shooter, faction,
      );
      this.channels.fx.push(FxKind.Sparks, hx, hy, hz, 0, 1, 0, 1.4, shooter, faction);

      if (link === w.chainCount || hitCount >= this.chainHit.length) break;

      const next = this.nearestUnhit(hx, hz, COMBAT_WEAPONS.teslaChainRange, owner, hitCount);
      if (next < 0) break;
      this.chainHit[hitCount++] = next;
      fromX = hx; fromY = hy; fromZ = hz;
      victim = next;
      dmg *= COMBAT_WEAPONS.teslaChainFalloff;
    }
  }

  /**
   * Nearest hostile within `range` of (x,z) that this bolt has not already
   * struck. `SpatialIndex.nearest` cannot express the exclusion — and the
   * exclusion is the whole point, or every arc jumps straight back to the
   * victim it is standing on.
   */
  private nearestUnhit(
    x: number, z: number, range: number, owner: PlayerId, hitCount: number,
  ): number {
    const world = this.world;
    const st = world.store;
    const out = this.chainScratch;
    const n = world.spatial.queryCircleFat(x, z, range, out);
    let best = -1;
    let bestD2 = Infinity;
    for (let c = 0; c < n; c++) {
      const j = out[c];
      let skip = false;
      for (let k = 0; k < hitCount; k++) if (this.chainHit[k] === j) { skip = true; break; }
      if (skip) continue;
      const f = st.flags[j];
      if ((f & EntityFlag.Alive) === 0) continue;
      if ((f & (EntityFlag.PendingDestroy | EntityFlag.Cloaked |
                EntityFlag.Garrisoned | EntityFlag.NotATarget)) !== 0) continue;
      if (world.areAllied(owner, st.owner[j] as PlayerId)) continue;
      const dx = st.posX[j] - x, dz = st.posZ[j] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = j; }
    }
    return best;
  }

  /* ======================================================================
   * GEOMETRY
   * ====================================================================== */

  /**
   * World-space muzzle position, written into `out` as [x, y, z].
   *
   * DERIVED, not read from the model. `socketWorld()` in the render bridge is
   * the authoritative visual answer, but it is interpolated by render alpha and
   * only valid from RenderPhase.Bridge onward — reading it from a sim tick
   * would make the simulation depend on the frame rate. The VFX module is free
   * to refine the flash position with the real socket; the sim needs a stable
   * deterministic one, and these agree to a few centimetres.
   */
  muzzleOf(i: number, out: Float32Array): void {
    const st = this.world.store;
    const fw = st.footprintW[i];
    const yaw = st.turretYaw[i];
    let height: number;
    let forward: number;
    if (fw > 0) {
      height = fw * CELL * COMBAT_WEAPONS.buildingMuzzleHeightMul;
      forward = fw * CELL * 0.35;
    } else {
      height = Math.max(COMBAT_WEAPONS.muzzleHeightMin, st.radius[i] * COMBAT_WEAPONS.muzzleHeightMul);
      forward = st.radius[i] * COMBAT_WEAPONS.muzzleForwardMul;
    }
    out[0] = st.posX[i] + Math.sin(yaw) * forward;
    out[1] = st.posY[i] + height;
    out[2] = st.posZ[i] + Math.cos(yaw) * forward;
  }

  /** Centre-of-mass aim point of a target, written into `out` as [x, y, z]. */
  aimPointOf(t: number, out: Float32Array): void {
    const st = this.world.store;
    const h = estimatedHeight(st.footprintW[t], st.radius[t], st.kind[t] as EntityKind);
    out[0] = st.posX[t];
    out[1] = st.posY[t] + h * COMBAT_WEAPONS.aimHeightFrac;
    out[2] = st.posZ[t];
  }

  /** Drop cached resolutions. Call after installing a real weapon table. */
  invalidateResolutions(): void {
    const st = this.world.store;
    for (let a = 0; a < st.aliveCount; a++) this.resolved.setAt(st.alive[a], -2);
  }
}

/* ==========================================================================
 * 4. SHARED PREDICATES
 *
 * Targeting needs these and must not duplicate them, or "can I shoot it" and
 * "will I shoot it" drift apart and units lock onto things they cannot hurt.
 * ========================================================================== */

/**
 * True when the entity in slot `i` is FLYING.
 *
 * Read off `Locomotor.Air` rather than off altitude. Altitude is what the AI
 * uses (`AI_BUILD.airAltitudeMetres`) because the AI is answering "is there an
 * air threat in this match", a question a single frame of a unit cresting a
 * ridge must not be able to answer wrongly. Combat is answering "may this gun
 * shoot that thing", which has to be stable to the metre and to the tick: a
 * gunship must not become targetable because it happened to be climbing out of
 * a valley. The locomotor is the declaration; the altitude is the consequence.
 */
export function isAirborne(store: EntityStore, i: number): boolean {
  return store.locomotor[i] === Locomotor.Air;
}

/**
 * True when `w` can meaningfully hurt `armor`.
 *
 * `airborne` defaults to false so the ground-only callers read unchanged; the
 * air gate is a hard veto and is checked before the matrix, exactly like the
 * infantry one, because "cannot elevate" is not a damage multiplier.
 */
export function weaponCanHurt(
  w: WeaponDef, armor: ArmorClass, airborne = false,
): boolean {
  if (armor === ArmorClass.Infantry && !w.canTargetInfantry) return false;
  if (airborne && !w.canTargetAir) return false;
  // The mirror, and it gates ACQUISITION as well as damage because
  // `Targeting.isValidTarget` is this function's only caller in the sim. That
  // is the whole fix: a ground-blind weapon must not acquire a ground target,
  // fly its hull into the anti-air answering it, and pull the trigger forever.
  if (!airborne && !w.canTargetGround) return false;
  return armorMultiplier(w.warhead, armor) > 0.02;
}

/**
 * True when this behaviour is allowed to acquire and fire.
 *
 * This is intentionally an allow-list. A plain Move is weapons-cold; the
 * player-facing Attack Move order exists specifically for moving under fire.
 * The same rule keeps harvesters, repairers and fleeing units from shooting
 * merely because those newer states were not remembered in an exclusion list.
 */
export function stateAllowsCombat(state: UnitState): boolean {
  return state === UnitState.Idle
    || state === UnitState.AttackMoving
    || state === UnitState.Attacking
    || state === UnitState.Guarding;
}

/** True when `stance` permits acquiring targets of opportunity. */
export function stanceAllowsAcquire(stance: Stance): boolean {
  return stance !== Stance.HoldFire;
}

/**
 * Convenience for other modules: stale-handle-safe weapon lookup. Only sees a
 * weapon a def table actually assigned — the heuristic fallback lives in
 * `WeaponSystem.weaponFor`, which owns the cache.
 */
export function weaponForHandle(world: World, id: EntityId): WeaponDef | undefined {
  const i = world.store.index(id);
  if (i < 0) return undefined;
  return weaponAt(world.store.weaponIndex[i]);
}

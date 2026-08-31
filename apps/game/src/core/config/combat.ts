/**
 * Domain-owned config slice: targeting, weapons, projectiles and damage.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 21. COMBAT — TARGETING, WEAPONS, PROJECTILES, DAMAGE, DEATH
 *
 * Appended by the combat module. Individual weapon stats are CONTENT and live
 * in the weapon table (src/sim/Combat.ts until src/data ships one); these are
 * the cross-cutting numbers that decide how the FIGHT feels — how sticky a
 * target is, how hard a shell arcs, how long a hulk burns.
 * ========================================================================== */

/** Targeting: acquisition, scoring and persistence. */
export const COMBAT_TARGETING = {
  /**
   * Multiplier on weapon range used when SCANNING for a new target. Slightly
   * over 1 so a unit starts slewing its turret a beat before the enemy walks
   * into range — that anticipation is most of what makes a defence read as alert.
   */
  acquireRangeMul: 1.08,
  /**
   * Multiplier on weapon range at which an EXISTING target is dropped. Strictly
   * larger than acquireRangeMul: without this hysteresis band a unit sitting on
   * the range boundary flickers between "acquire" and "lose" every tick.
   */
  leashRangeMul: 1.28,
  /** Score multiplier for the target already held. THE anti-twitch constant. */
  stickiness: 1.35,
  /** Score multiplier for whoever last damaged us (within RETALIATE_MEMORY). */
  retaliation: 1.5,
  /** Score multiplier for anything that can shoot back. Guns before trucks. */
  armedTarget: 1.6,
  /**
   * Score multiplier for an airborne target when the shooter's weapon has a
   * full-strength anti-air answer. Dedicated AA and aircraft keep the sky as
   * their first job; emergency line rifles (`airMultiplier < 1`) deliberately
   * do not inherit this priority and remain ground troops with a weak AA floor.
   */
  airTarget: 3.0,
  /** Score multiplier for a non-defensive structure. Buildings are last. */
  softBuilding: 0.55,
  /** Score multiplier for a defensive structure. */
  defenceBuilding: 1.3,
  /** Score multiplier for a harvester — hurting the economy is worth a detour. */
  harvester: 1.15,
  /** Score multiplier for a target already below `woundedFrac` health. */
  wounded: 1.25,
  woundedFrac: 0.4,
  /** Score multiplier when our warhead barely scratches their armour. */
  ineffective: 0.35,
  /** Armour multiplier at or below which `ineffective` applies. */
  ineffectiveBelow: 0.35,
  /** Distance falloff softness: score is divided by (this + d/range). */
  distanceSoftness: 0.35,
  /** Candidates examined per acquisition scan. Bounds the worst case. */
  maxCandidates: 96,
  /** Metres between height samples on the line-of-sight walk. */
  losStepMetres: 4.0,
  /** Metres of terrain rise above the sight line that counts as blocked. */
  losClearance: 0.9,
} as const;

/** Weapons: the firing cycle, turret traverse and recoil. */
export const COMBAT_WEAPONS = {
  /** Degrees of bearing error tolerated before a turret will fire. */
  aimToleranceDeg: 5.0,
  /** Degrees of bearing error tolerated by a HULL-mounted (turretless) weapon. */
  hullArcDeg: 14.0,
  /** Fallback turret slew, rad/s, when neither entity nor weapon states one. */
  defaultTurretTurnRate: 2.2,
  /** Max barrel elevation, degrees. Ballistic solutions clamp to this. */
  maxElevationDeg: 62,
  /** Min barrel depression, degrees. */
  minElevationDeg: -12,
  /** m/s below which a `requiresStop` weapon considers itself stationary. */
  stoppedSpeed: 0.45,
  /** Metres the barrel kicks back on a shot, scaled by damage/60. */
  recoilMetres: 0.34,
  /** Exponential recoil recovery rate, per second. */
  recoilLambda: 9.0,
  /** Rate-of-fire multiplier per veterancy rank (index 0 = rookie). */
  vetCooldownMul: [1.0, 0.95, 0.90] as readonly number[],
  /** Muzzle height as a fraction of the entity's collision radius, for units. */
  muzzleHeightMul: 0.62,
  /** Absolute muzzle-height floor in metres (infantry shoulder). */
  muzzleHeightMin: 1.15,
  /** Muzzle height for a structure, as a fraction of its footprint width. */
  buildingMuzzleHeightMul: 0.85,
  /** Metres forward of the entity centre the muzzle sits, per unit of radius. */
  muzzleForwardMul: 0.95,
  /** Aim point height on a target, as a fraction of its estimated height. */
  aimHeightFrac: 0.55,
  /** Metres of extra chain-lightning reach from each tesla victim. */
  teslaChainRange: 9.0,
  /** Damage retained by each successive tesla chain link. */
  teslaChainFalloff: 0.6,
} as const;

/** Projectiles: the pooled MAX_PROJECTILES-slot store. */
export const COMBAT_PROJECTILES = {
  /** Gravity for ballistic shells, m/s^2. Above 9.81: RA3 arcs are punchy. */
  gravity: 22.0,
  /** Seconds any projectile may live before it self-destructs. */
  maxLifeSeconds: 9.0,
  /** Default homing turn rate for rockets, degrees/second. */
  rocketTurnRateDeg: 170,
  /** Metres a rocket flies straight before homing engages (reads as a launch). */
  rocketArmMetres: 3.5,
  /** Metres of travel between trail FX beads. Bible 8.6 wants a bead chain. */
  trailBeadMetres: 2.4,
  /** Estimated target height as a multiple of collision radius, swept test. */
  hitHeightMul: 1.7,
  /** Estimated structure height as a multiple of footprint width, metres. */
  buildingHeightMul: 1.15,
  /** Metres added to a target's hit radius so grazing shots still connect. */
  hitRadiusPad: 0.35,
  /**
   * Speed of a Flame projectile, m/s, and how long its tongue lives.
   *
   * THE PRODUCT IS A HARD REACH LIMIT and must clear `flameJet`'s range, which
   * it did not: 26 x 0.55 = 14.3 m against a weapon that claims 18. A round
   * fired at the edge of the envelope expired in mid-air, and the only reason
   * anything died out there was the 3.2 m splash on expiry papering over it.
   * 0.78 s gives 20.3 m — the range plus a margin wide enough that raising the
   * weapon by a metre or two later does not silently reintroduce the gap.
   * `tests/emplacement-traverse.spec.ts` asserts the inequality directly.
   */
  flameSpeed: 26,
  flameLifeSeconds: 0.78,
  /** Metres a shell may sink below terrain before the ground impact resolves. */
  groundBias: 0.15,
} as const;

/** Damage, splash, death and the wreckage that outlives it. */
export const COMBAT_DAMAGE = {
  /**
   * THE TIME-TO-KILL KNOB. Every point of damage in the game is multiplied by
   * this, in `Damage.applyOne`, the one function that writes `hp`.
   *
   * Reported as *"In general, killing and dying feels too fast in game"*.
   * Measured before the change, mirror matchups, all four armies:
   *
   *     main battle tanks   8.62 - 10.77 s   ->  10.8 - 13.5 s
   *     line infantry        2.00 -  2.35 s  ->   2.5 -  2.9 s
   *
   * **IT IS INVARIANT ON TRADE RATIOS, WHICH IS THE WHOLE REASON IT IS SAFE.**
   * A squad assaulting an emplacement lands `36 x r x HP/D`; scaling the
   * squad's `r` and the defender's `D` by the same factor cancels. So this
   * stretches the clock without touching a single balance relationship, and it
   * composes with the per-weapon retunes in `Combat.ts` and `Defs.ts` rather
   * than double-counting them. Tune this for PACE; tune a weapon row for
   * BALANCE. They are different questions and this is the only knob for the
   * first one.
   *
   * WHY NOT HP, AND WHY NOT THE ARMOUR MATRIX. `tests/data.spec.ts` pins every
   * `def.maxHp` field-for-field against `Scenarios.FALLBACK_UNITS`, so raising
   * health means editing two tables in lockstep forever. Scaling the matrix
   * hits `tests/combat.spec.ts`, which pins `armorMultiplier(SmallArms,
   * Infantry)` to exactly 1 — it is the counter-triangle's reference cell and
   * must stay 1. One multiply in one function is the honest lever.
   *
   * Structures slow by the same factor (single-attacker structure TTK was
   * 20-99 s and is now 25-124 s). If base-cracking starts to drag, that is the
   * number to revisit first — but with more than one attacker it is rarely
   * what anyone notices.
   */
  globalMul: 0.80,
  /** Fraction of splash damage an ALLIED or own-team victim takes. */
  friendlyFireMul: 0.5,
  /**
   * Exponent on the splash falloff curve. 1.0 is linear; 1.6 concentrates the
   * damage near the crater, which is what stops one artillery shell deleting a
   * loose formation.
   */
  splashExponent: 1.6,
  /** Max victims one splash event may touch. */
  maxSplashVictims: 64,
  /** Minimum raw damage that leaves a scorch decal. */
  scorchMinDamage: 45,
  /** Metres of scorch per metre of splash radius. */
  scorchSizeMul: 1.9,
  /** Camera shake per metre of explosion scale, 0..1. */
  shakePerScale: 0.09,
  /** Seconds a destroyed vehicle's hulk persists. */
  wreckSeconds: 26,
  /** Seconds a hulk actively burns before it only smokes. */
  wreckBurnSeconds: 10,
  /** Seconds between smoke puffs from a burning wreck. */
  wreckSmokeInterval: 0.45,
  /** Seconds between damage smoke puffs from a damaged (not dead) unit. */
  damageSmokeInterval: 0.6,
  /** Structure death: number of secondary cook-off blasts. */
  cookOffCount: 5,
  /** Seconds between cook-off blasts. */
  cookOffInterval: 0.25,
  /** Scale of a cook-off blast relative to the main structure blast. */
  cookOffScale: 0.32,
  /** Capacity of the delayed-FX ring. Bounds cook-off chains. */
  scheduledFxCapacity: 96,
  /** Fireball radius in metres for a dead unit (bible 8.2: 2.2 TL). */
  unitBlastMetres: 2.2,
  /** Fireball radius in metres for a dead structure (bible 8.2: 4.5-6 TL). */
  buildingBlastMetres: 5.2,
} as const;

/**
 * THE ARMOUR MATRIX — [WarheadClass][ArmorClass], 7 x 6.
 *
 * This table IS the counter-triangle of the game. Rows are warheads
 * (SmallArms, AutoCannon, ArmorPiercing, HighExplosive, Rocket, Tesla, Prism);
 * columns are armours (Infantry, Light, Medium, Heavy, Concrete, Wood).
 *
 * Read the shape, not the individual numbers: small arms shred flesh and bounce
 * off tanks; AP is the answer to armour and wastes itself on infantry; HE is
 * the building-killer that still has real anti-infantry splash; rockets are the
 * generalist that costs you nothing against heavies; tesla deletes infantry
 * outright; prism ignores most armour scaling, which is exactly why it is
 * expensive and slow.
 *
 * A data module that ships a real `DefTables.armorMatrix` replaces this at boot
 * through `setArmorMatrix()`.
 */
export const ARMOR_MATRIX: readonly (readonly number[])[] = [
  /* SmallArms     */ [1.00, 0.55, 0.28, 0.10, 0.18, 0.60],
  /* AutoCannon    */ [0.80, 1.00, 0.65, 0.35, 0.35, 0.80],
  /* ArmorPiercing */ [0.35, 0.85, 1.00, 1.00, 0.55, 0.75],
  /* HighExplosive */ [0.90, 0.80, 0.65, 0.50, 1.00, 1.00],
  /* Rocket        */ [0.55, 0.95, 0.90, 0.95, 0.90, 0.85],
  /* Tesla         */ [1.60, 0.95, 0.85, 0.90, 0.60, 0.70],
  /* Prism         */ [1.10, 0.95, 0.95, 0.90, 0.80, 0.90],
];

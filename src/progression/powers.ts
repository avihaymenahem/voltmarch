/**
 * ============================================================================
 * VOLTMARCH — src/progression/powers.ts
 * ============================================================================
 * THE COMMANDER POWER TABLE. Five player-level support powers, each paid out by
 * exactly one mission, each charging on its own clock and callable at a point
 * on the map.
 *
 * WHY THIS TABLE IS HERE AND NOT IN `core/config.ts`
 * --------------------------------------------------
 * It has to be readable by THREE modules that may not import each other:
 *
 *   `src/data/Missions.ts`      validates at load that every `power` reward it
 *                               pays names a real power, and that every power
 *                               is paid by exactly one mission. Missions.ts is
 *                               a LEAF — it imports `core/types` and
 *                               `progression/types` and nothing else — so the
 *                               table cannot live anywhere that drags the sim
 *                               in behind it.
 *   `src/sim/CommanderPowers.ts` is the mechanism.
 *   the missions/end screens    print the label and the hint.
 *
 * `AbilityId` is in `core/config.ts` for the mirror-image reason: `Defs.ts`
 * names an ability on a unit row, so the enum had to sit somewhere the data
 * layer could reach. Nothing in `src/data/**` names a POWER on a row — a power
 * belongs to a PLAYER, not to a unit — so the same trick is not needed, and the
 * unlock id, which is a progression concept, keeps the table next to the thing
 * that grants it. Balance numbers live in `COMMANDER_POWER_FX` below, in one
 * block, for the same reason `ABILITY_FX` is one block.
 *
 * NOTHING HERE IMPORTS THE ENGINE, and that is load-bearing: `src/progression/**`
 * is unit-testable under `environment: 'node'` and must stay that way.
 *
 *
 * THE POWERS ARE POINT-TARGETED, WHICH IS THE OPPOSITE OF `sim/Abilities.ts`
 * -------------------------------------------------------------------------
 * The four faction abilities are deliberately SELF-CENTRED: they land on a
 * circle around the commander, so one button fires any of them and where you
 * walk the hero is the aim. These five are deliberately NOT, and the difference
 * is the whole reason they are a separate mechanism rather than five more
 * `AbilityId` rows:
 *
 *   - A commander power has no unit. It is called by the PLAYER, is charged
 *     from the start of the match, and works with every hero dead. "Callable
 *     once charged, in any match" is what the missions screen has always
 *     promised for these five, and a power that needs a living hero standing on
 *     the right spot does not deliver that sentence.
 *   - Three of the five would be near-duplicates of a faction ability if they
 *     were self-centred (Chronoshift/Chrono Rally, Emergency Repair/Salvage
 *     Call, Airstrike/Prism Focus). Aimed at a point they are all distinct.
 *
 *
 * THE SIMULATION NEVER READS THE PROFILE TO ANSWER "DO I OWN THIS?"
 * -----------------------------------------------------------------
 * `CommanderPowerService` executes any `CommandKind.UsePower` that reaches it,
 * subject only to the charge, which is simulation state. Ownership is a LOCAL
 * question — the profile lives in this browser's localStorage — and a
 * simulation that refused a power because THIS machine had not earned it would
 * diverge from a peer that had. See the header of `src/sim/CommanderPowers.ts`
 * for the full argument and what it means for PvP.
 * ============================================================================
 */

/**
 * Which power. Indexes `COMMANDER_POWERS` directly, so slot 0 is a `None` row
 * that exists only to keep the array a direct lookup — the same shape, and for
 * the same reason, as `ABILITIES`.
 *
 * These numbers travel on `Command.arg` across the multiplayer wire and into
 * replay files. APPEND, NEVER INSERT.
 */
export const enum CommanderPowerId {
  None = 0,
  Airstrike = 1,
  OrbitalScan = 2,
  EmergencyRepair = 3,
  OreBoost = 4,
  Chronoshift = 5,
}

export interface CommanderPowerDef {
  readonly id: CommanderPowerId;
  /** Stable key. Console and tests address a power by this, never by index. */
  readonly key: string;
  /**
   * The unlock id the mission table pays out. THE JOIN: `MissionTracker` writes
   * this string onto the profile, and it is the only thing tying a completed
   * mission to a usable power.
   */
  readonly unlockId: string;
  readonly label: string;
  /** One line, present tense, says what it does rather than what it is called. */
  readonly hint: string;
  /** Effect radius in metres, measured from the target point. */
  readonly radius: number;
  /**
   * Seconds from match start (and from each use) before it can be called.
   *
   * Deliberately longer than a commander ability's 40-60 s cooldown and shorter
   * than a superweapon's 300 s charge: these are strategic verbs with no build
   * cost and no structure to kill, so the only thing limiting them is the
   * clock.
   */
  readonly chargeSeconds: number;
}

/** Indexed by `CommanderPowerId`. Slot 0 is the None row. */
export const COMMANDER_POWERS: readonly CommanderPowerDef[] = [
  {
    id: CommanderPowerId.None,
    key: 'none',
    unlockId: '',
    label: '',
    hint: '',
    radius: 0,
    chargeSeconds: 0,
  },
  {
    id: CommanderPowerId.Airstrike,
    key: 'airstrike',
    unlockId: 'power.airstrike',
    label: 'Airstrike',
    hint: 'Bombs everything hostile under the marker.',
    radius: 20,
    chargeSeconds: 150,
  },
  {
    id: CommanderPowerId.OrbitalScan,
    key: 'orbitalScan',
    unlockId: 'power.orbital-scan',
    label: 'Orbital Scan',
    hint: 'Charts a wide circle of the map permanently.',
    radius: 90,
    chargeSeconds: 120,
  },
  {
    id: CommanderPowerId.EmergencyRepair,
    key: 'emergencyRepair',
    unlockId: 'power.emergency-repair',
    label: 'Emergency Repair',
    hint: 'Patches up your units and structures under the marker.',
    radius: 24,
    chargeSeconds: 150,
  },
  {
    id: CommanderPowerId.OreBoost,
    key: 'oreBoost',
    unlockId: 'power.ore-boost',
    label: 'Ore Boost',
    hint: 'Emergency cash, wired straight to your account.',
    radius: 0,
    chargeSeconds: 180,
  },
  {
    id: CommanderPowerId.Chronoshift,
    key: 'chronoshift',
    unlockId: 'power.chronoshift',
    label: 'Chronoshift',
    hint: 'Teleports the units guarding your base to the marker.',
    radius: 30,
    chargeSeconds: 240,
  },
];

/** Effect magnitudes. One block, so balance is one diff. */
export const COMMANDER_POWER_FX = {
  /** Damage at the centre of an airstrike, before splash falloff. */
  airstrikeDamage: 260,
  /** Splash falloff across the radius. Matches the nuke's profile. */
  airstrikeFalloff: 0.3,

  /** Credits an Ore Boost pays. Roughly one refinery-load, delivered instantly. */
  oreBoostCredits: 2500,

  /** Fraction of maxHp an Emergency Repair restores. */
  repairFraction: 0.45,
  /** Most entities one Emergency Repair will mend. */
  repairMaxTargets: 24,

  /** Units one Chronoshift lifts. The Chronosphere lifts 9; this lifts 8. */
  chronoshiftMaxUnits: 8,
  /** Metres between arrival slots, matching the Chronosphere's spiral. */
  chronoshiftSpacing: 3.4,
  /** Radius around the caster's base centroid that a Chronoshift lifts from. */
  chronoshiftPickupRadius: 40,
} as const;

/** Every power except the `None` row, in table order. */
export const COMMANDER_POWER_LIST: readonly CommanderPowerDef[] = COMMANDER_POWERS.slice(1);

/** The unlock id of every power. What the mission table has to pay out. */
export const COMMANDER_POWER_UNLOCK_IDS: readonly string[] =
  COMMANDER_POWER_LIST.map((p) => p.unlockId);

/** The power a mission's `power` reward names, or undefined. O(n) over five. */
export function powerByUnlockId(unlockId: string): CommanderPowerDef | undefined {
  for (let i = 1; i < COMMANDER_POWERS.length; i++) {
    if (COMMANDER_POWERS[i].unlockId === unlockId) return COMMANDER_POWERS[i];
  }
  return undefined;
}

/** The power with this key, or undefined. For the console handle and tests. */
export function powerByKey(key: string): CommanderPowerDef | undefined {
  for (let i = 1; i < COMMANDER_POWERS.length; i++) {
    if (COMMANDER_POWERS[i].key === key) return COMMANDER_POWERS[i];
  }
  return undefined;
}

/** True when `id` addresses a real power (not the `None` row, not off the end). */
export function isCommanderPowerId(id: number): boolean {
  return Number.isInteger(id) && id > 0 && id < COMMANDER_POWERS.length;
}

/**
 * The powers this profile has earned, in table order.
 *
 * THE ONE PLACE OWNERSHIP IS ANSWERED, and it is deliberately a pure function
 * of a predicate rather than a reach into the profile: the caller is the UI
 * drawing the buttons, on the machine that owns the profile, and the simulation
 * must never be able to ask this question. `src/sim/CommanderPowers.ts` explains
 * what happens if it does.
 *
 * Pass `progression-link`'s `isUnlocked`, which answers TRUE with no
 * progression layer installed — so a build with `src/progression/**` removed,
 * and the `?shot=` harness, both offer all five rather than none.
 *
 * `out` is caller-supplied so a per-frame HUD rebuild allocates nothing.
 */
export function powersOwnedBy(
  isUnlocked: (unlockId: string) => boolean,
  out?: CommanderPowerDef[],
): CommanderPowerDef[] {
  const dst = out ?? [];
  dst.length = 0;
  for (let i = 1; i < COMMANDER_POWERS.length; i++) {
    if (isUnlocked(COMMANDER_POWERS[i].unlockId)) dst.push(COMMANDER_POWERS[i]);
  }
  return dst;
}

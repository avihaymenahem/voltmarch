/**
 * ============================================================================
 * VOLTMARCH — src/progression/powers.ts
 * ============================================================================
 * THE COMMANDER POWER TABLE. Five player-level support powers, each BOUGHT ONCE
 * PER MATCH from a Command Post, each charging on its own clock afterwards and
 * callable at a point on the map for the rest of that match.
 *
 * THE POWERS ARE NOT A MISSION REWARD ANY MORE, AND THE FILE MOVED WITH THEM
 * --------------------------------------------------------------------------
 * Until v2.6.0 each of these five carried an `unlockId`, five missions paid
 * them out, and `powersOwnedBy(isUnlocked)` read the local profile to decide
 * which buttons the HUD drew. That is gone. The powers are earned INSIDE the
 * match now: build the army's support structure (`commandPost` / `mrdPharos` /
 * `rclSignalRig`), open the Powers tab it publishes, and buy each power with
 * credits. What replaced the profile bit is `PlayerState.commanderPowerMask`,
 * and the difference is the whole reason this was worth doing — see the header
 * of `src/sim/CommanderPowers.ts`, which used to be forty lines of argument for
 * why the simulation could not be allowed to ask "do you own this?" and is now
 * a short note saying it may.
 *
 * WHY THIS TABLE IS STILL HERE AND NOT IN `core/config.ts`
 * --------------------------------------------------------
 * It has to be readable by modules that may not import each other:
 *
 *   `src/sim/CommanderPowers.ts` is the mechanism.
 *   `src/sim/Production.ts`      authors the five purchasable CONTENT rows and
 *                                installs the bit when one finishes.
 *   `src/ui/**`                  prints the label and the hint.
 *
 * `AbilityId` is in `core/config.ts` for the mirror-image reason: `Defs.ts`
 * names an ability on a unit row, so the enum had to sit somewhere the data
 * layer could reach. Nothing in `src/data/**` names a POWER on a row — a power
 * belongs to a PLAYER, not to a unit. Balance numbers live in
 * `COMMANDER_POWER_FX` below, in one block, for the same reason `ABILITY_FX`
 * is one block; the PRICE does not, because a price is production-layer
 * authoring and lives beside every other price in `Production.CONTENT`.
 *
 * NOTHING HERE IMPORTS THE ENGINE, and that is load-bearing: `src/progression/**`
 * is unit-testable under `environment: 'node'` and must stay that way. The
 * ownership helpers at the bottom take a structural `{ commanderPowerMask }`
 * rather than a `PlayerState` for exactly that reason.
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
 *   - A commander power has no unit. It is called by the PLAYER, charges from
 *     the moment it is bought, and works with every hero dead.
 *   - Three of the five would be near-duplicates of a faction ability if they
 *     were self-centred (Chronoshift/Chrono Rally, Emergency Repair/Salvage
 *     Call, Airstrike/Prism Focus). Aimed at a point they are all distinct.
 *
 *
 * OWNERSHIP IS A BITMASK OVER `CommanderPowerId`, AND THAT IS WHY IT WORKS
 * ------------------------------------------------------------------------
 * `commanderPowerMask` is a plain 32-bit integer with bit `id` set when the
 * player has bought power `id`. Six ids, so five live bits; there is no risk of
 * running out and no reason to author a separate bit column the way `UpgradeDef`
 * has to (an upgrade's bit is not its table position, because `UPGRADES` is not
 * a direct-lookup array). Here the id IS the index and it is already promised
 * append-only for the wire, so the bit cannot move either.
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
  /**
   * Stable key. Console, tests and the SAVE FILE address a power by this, never
   * by index — `SaveGame` stores the bought set as keys for the same reason it
   * stores `upgradeKeys`, and `CommanderPowerService.chargeStates` has always
   * keyed on it.
   *
   * It is also the `ContentSpec.key` of the purchasable row in
   * `src/sim/Production.ts`, prefixed: `power.airstrike` is bought to own
   * `airstrike`. One string, two tables, joined by `powerByContentKey` below.
   */
  readonly key: string;
  readonly label: string;
  /** One line, present tense, says what it does rather than what it is called. */
  readonly hint: string;
  /** Effect radius in metres, measured from the target point. */
  readonly radius: number;
  /**
   * Seconds from the purchase (and from each use) before it can be called.
   *
   * Deliberately longer than a commander ability's 40-60 s cooldown and shorter
   * than a superweapon's 300 s charge. This used to read "these are strategic
   * verbs with no build cost and no structure to kill, so the only thing
   * limiting them is the clock" — which stopped being true the moment they were
   * priced. There is a structure to kill now (the Command Post), and there is a
   * bill; the clock is what stops one purchase being called twice in a push.
   *
   * The numbers were LEFT WHERE THEY WERE anyway. Shortening them to "pay for"
   * the new price would have made the powers stronger per call at the exact
   * moment they became a purchase, which is two balance changes pointed the
   * same way; the price is the change, and the charge is the control.
   */
  readonly chargeSeconds: number;
}

/** Indexed by `CommanderPowerId`. Slot 0 is the None row. */
export const COMMANDER_POWERS: readonly CommanderPowerDef[] = [
  {
    id: CommanderPowerId.None,
    key: 'none',
    label: '',
    hint: '',
    radius: 0,
    chargeSeconds: 0,
  },
  {
    id: CommanderPowerId.Airstrike,
    key: 'airstrike',
    label: 'Airstrike',
    hint: 'Bombs everything hostile under the marker.',
    radius: 20,
    chargeSeconds: 150,
  },
  {
    id: CommanderPowerId.OrbitalScan,
    key: 'orbitalScan',
    label: 'Orbital Scan',
    hint: 'Exposes every enemy unit and building for five seconds.',
    /**
     * NOT a circle on the ground any more — this is the radius lit around EACH
     * hostile asset while the sweep runs. It was 90 m centred on the marker,
     * charting terrain permanently, which made a second cast over the same
     * ground a literal no-op; see `CommanderPowers.applyOrbitalScan`.
     *
     * 30 m because it has to read as a BASE rather than a scatter of dots: a
     * structure footprint plus its neighbours falls inside it, so a scanned
     * base arrives as one lit shape. Widening it much past this starts joining
     * separate positions into one blob and gives away ground the enemy does
     * not actually hold.
     */
    radius: 30,
    chargeSeconds: 120,
  },
  {
    id: CommanderPowerId.EmergencyRepair,
    key: 'emergencyRepair',
    label: 'Emergency Repair',
    hint: 'Patches up your units and structures under the marker.',
    radius: 24,
    chargeSeconds: 150,
  },
  {
    id: CommanderPowerId.OreBoost,
    key: 'oreBoost',
    label: 'Ore Boost',
    hint: 'Emergency cash, wired straight to your account.',
    radius: 0,
    chargeSeconds: 180,
  },
  {
    id: CommanderPowerId.Chronoshift,
    key: 'chronoshift',
    label: 'Chronoshift',
    hint: 'Moves up to 8 allied units within 40 m of your base centre to the destination.',
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

  /** Units one Chronoshift lifts. The Displacement Ring lifts 9; this lifts 8. */
  chronoshiftMaxUnits: 8,
  /** Metres between arrival slots, matching the Displacement Ring's spiral. */
  chronoshiftSpacing: 3.4,
  /** Radius around the caster's base centroid that a Chronoshift lifts from. */
  chronoshiftPickupRadius: 40,
} as const;

/** Every power except the `None` row, in table order. */
export const COMMANDER_POWER_LIST: readonly CommanderPowerDef[] = COMMANDER_POWERS.slice(1);

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
 * THE CONTENT KEY of a power's purchasable row, and the join back.
 *
 * `power.` + the power key. One prefix, computed in one place, so the
 * production table and this one cannot drift into two spellings of the same
 * purchase — the failure `validateMissions` used to catch for the mission join
 * and which nothing would catch here.
 */
export const COMMANDER_POWER_CONTENT_PREFIX = 'power.';

/** The `ContentSpec.key` of the row that buys `power`. */
export function commanderPowerContentKey(power: CommanderPowerDef): string {
  return COMMANDER_POWER_CONTENT_PREFIX + power.key;
}

/** The power a production content key buys, or undefined. O(n) over five. */
export function powerByContentKey(contentKey: string): CommanderPowerDef | undefined {
  if (!contentKey.startsWith(COMMANDER_POWER_CONTENT_PREFIX)) return undefined;
  return powerByKey(contentKey.slice(COMMANDER_POWER_CONTENT_PREFIX.length));
}

/* ==========================================================================
 * OWNERSHIP — a bitmask over `CommanderPowerId`, per player, per match
 *
 * Structural on purpose. The only field these touch is `commanderPowerMask`,
 * which `PlayerState` has and nothing in `src/progression/**` may import, so
 * they are declared over the narrowest shape that carries it. That keeps this
 * module engine-free (see the header) while giving `src/sim/Production.ts`,
 * `src/sim/CommanderPowers.ts`, `src/game/SaveGame.ts` and the HUD ONE
 * vocabulary for the question instead of four copies of `1 << id`.
 * ========================================================================== */

/** Anything carrying a per-match commander-power purse. `PlayerState` does. */
export interface CommanderPowerOwner {
  commanderPowerMask: number;
}

/** True when this player has BOUGHT this power in this match. */
export function ownsCommanderPower(owner: CommanderPowerOwner, power: number): boolean {
  if (!isCommanderPowerId(power)) return false;
  return (owner.commanderPowerMask & (1 << power)) !== 0;
}

/**
 * Install a purchase. False when the bit was already set, which is the caller's
 * signal that nothing changed — same contract as `grantUpgrade`.
 */
export function grantCommanderPower(owner: CommanderPowerOwner, power: number): boolean {
  if (!isCommanderPowerId(power)) return false;
  const bit = 1 << power;
  if ((owner.commanderPowerMask & bit) !== 0) return false;
  owner.commanderPowerMask |= bit;
  return true;
}

/**
 * Every power this player has bought, as power KEYS, appended to `out`.
 *
 * Keys and not the raw mask, for the reason `SaveGame` stores `upgradeKeys`: a
 * save outlives the table that produced its indices. `CommanderPowerId` happens
 * to be append-only because it rides the wire, but the save format does not get
 * to depend on a promise another file made.
 */
export function ownedCommanderPowerKeys(
  owner: CommanderPowerOwner, out: string[],
): string[] {
  out.length = 0;
  for (let i = 1; i < COMMANDER_POWERS.length; i++) {
    if ((owner.commanderPowerMask & (1 << i)) !== 0) out.push(COMMANDER_POWERS[i].key);
  }
  return out;
}

/**
 * Replace this player's purchases with exactly the ones named. Unknown keys are
 * skipped — a save from a later build naming a sixth power loads without it,
 * which is the conservative direction.
 */
export function setCommanderPowersByKey(
  owner: CommanderPowerOwner, keys: readonly string[],
): void {
  let mask = 0;
  for (let i = 0; i < keys.length; i++) {
    const def = powerByKey(keys[i]);
    if (def !== undefined) mask |= 1 << (def.id as number);
  }
  owner.commanderPowerMask = mask;
}

/**
 * The powers this player has bought, in table order.
 *
 * THE ONE PLACE OWNERSHIP IS ANSWERED for the HUD, and it is now a pure
 * function of SIMULATION state. It used to take an `isUnlocked` predicate and
 * read the local profile, which is why the simulation was forbidden from asking
 * the same question; both halves of that arrangement are gone.
 *
 * `out` is caller-supplied so a per-frame HUD rebuild allocates nothing.
 */
export function powersOwnedBy(
  owner: CommanderPowerOwner,
  out?: CommanderPowerDef[],
): CommanderPowerDef[] {
  const dst = out ?? [];
  dst.length = 0;
  for (let i = 1; i < COMMANDER_POWERS.length; i++) {
    if ((owner.commanderPowerMask & (1 << i)) !== 0) dst.push(COMMANDER_POWERS[i]);
  }
  return dst;
}

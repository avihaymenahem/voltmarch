/**
 * ============================================================================
 * VOLTMARCH — src/sim/Upgrades.ts
 * ============================================================================
 * PURCHASABLE IN-MATCH UPGRADES: the table, and the multipliers it moves.
 *
 * THE MIDDLE LAYER THAT WAS MISSING
 * ---------------------------------
 * This game already had two things that sound like this and are not:
 *
 *   VETERANCY   (`Damage.veterancyDamageMul`, `EntityFlag.Veteran1/2`) is
 *               per-UNIT and EARNED by kills or a crate. You cannot buy it and
 *               it dies with the unit that earned it.
 *   UNLOCKS     (`src/progression/**`, `UNLOCK_TAGS`) are cross-MATCH META tied
 *               to the local profile. They decide which cameos exist at all.
 *
 * An UPGRADE is neither: you BUY it during a match, with credits, from a
 * structure you own, and it improves a whole class of your army for the rest of
 * that match — including units that do not exist yet.
 *
 * WHY MULTIPLIERS AT THE POINT OF USE, AND NOT RE-STATTING
 * -------------------------------------------------------
 * The obvious implementation is to walk the entity list on purchase and rewrite
 * `maxSpeed` / `sight` / a damage column. It is wrong three times over:
 *
 *   1. It misses everything built afterwards, which is most of what an upgrade
 *      bought at eight minutes will ever apply to.
 *   2. It creates a SECOND source of truth for a unit's stats — the def table
 *      says one number and the store says another — and nothing can tell you
 *      afterwards which one is the bug.
 *   3. It does not survive a save. `SaveGame` restores the store columns
 *      verbatim, so a re-stat is indistinguishable from content, and loading a
 *      save would silently re-apply the upgrade on top of itself.
 *
 * So nothing is re-statted. `PlayerState.upgradeMask` is the single authority,
 * `PlayerState.upgradeMul` is a pure function of it, and the six consuming
 * systems multiply by it at the instant the number matters:
 *
 *   Combat.fire        Damage, Cooldown     the shot that is being fired
 *   Damage.applyOne    Armour               the hit that is being taken
 *   Movement.tick      Speed                the metre that is being moved
 *   Vision.sightOf     Sight                the circle that is being stamped
 *   BuildQueue         BuildSpeed           the slice that is being built
 *   Harvesting.tickDock Yield               the load that is being sold
 *
 * A unit produced after the purchase is covered because nobody had to remember
 * to cover it.
 *
 * DETERMINISM AND PvP
 * -------------------
 * `upgradeMask` is SIM state, per player, and identical on both clients: it is
 * only ever changed by a queue item completing inside `simTick`, and the queue
 * item got there through `channels.commands` like every other build. Nothing
 * here reads the local profile, a clock or the RNG — deliberately, because
 * `Scenarios.ts` consulting the progression gate at world-build time is already
 * one tick-zero desync this repo had to work around, and a second would be
 * nobody's fault but this file's.
 *
 * The mask is hashed by `Checksum.hashPlayers`, so a divergence in it is caught
 * where it happens rather than several seconds later as a damage difference.
 * ============================================================================
 */

import {
  BuildTab, EntityKind, Faction, UpgradeLever, UpgradeScope,
  ENTITY_KIND_COUNT, UPGRADE_MUL_SLOTS,
} from '../core/types';
import type { PlayerState } from '../core/types';

/* ==========================================================================
 * 1. THE TABLE
 * ========================================================================== */

/** One purchasable upgrade. `key` is shared with the `CONTENT` row in Production.ts. */
export interface UpgradeDef {
  /**
   * Bit position in `PlayerState.upgradeMask`. AUTHORED, not derived from array
   * position, and never reused.
   *
   * `Production.ts` learned this the expensive way with `gate` — "APPENDED, NOT
   * INSERTED. A building's `publicId` is its index in THIS array". A bit that
   * moves because a row was inserted above it is a save file that grants the
   * wrong upgrade and a replay that plays a different match. An explicit number
   * cannot move, and `tests/upgrades.spec.ts` asserts they stay unique and
   * inside 31.
   */
  readonly bit: number;
  /** Content key. Must match a `BuildKind.Upgrade` row in `Production.CONTENT`. */
  readonly key: string;
  /** Which army may buy it. Never `Faction.Neutral` — see the note below. */
  readonly faction: Faction;
  readonly lever: UpgradeLever;
  readonly scope: UpgradeScope;
  /**
   * The multiplier. Read `UpgradeLever` for which direction is an improvement —
   * `Cooldown` and `Armour` are both "lower is better".
   */
  readonly mul: number;
}

/**
 * THE TWELVE. Three per army, and the SHAPE of each army's three is the army.
 *
 * Every row is authored per-faction rather than as `Faction.Neutral`, even
 * where two armies would want the same effect. Neutral in the production
 * catalog does NOT mean "everyone" — `SHARED_POOL_FACTIONS` is `[Allies,
 * Soviets]` only, so a Neutral upgrade would be invisible to the Meridian Pact
 * and the Reclamation, which run complete parallel trees. Twelve explicit rows
 * cannot develop that asymmetry by accident.
 *
 * The three slots are the same everywhere — one infantry, one vehicle, one
 * base-wide — so the tabs they live in gate them on a structure the player
 * already had to build (Infantry tab needs a barracks, Vehicles a war factory,
 * Structures a construction yard). That gating is inherited from
 * `availabilityOf`; none of it is re-implemented here.
 *
 *   Allies    see first, survive, out-produce.
 *   Soviets   troops that will not die, guns that hit like trucks, more ore.
 *   Meridian  long eyes, the fastest hulls on the map, beams that recharge.
 *   Reclaim   pickers that spray, coils that bite, value out of every field.
 *
 * A lever repeating across two armies is fine and expected; no two armies have
 * the same SET, which is what a faction identity actually is.
 */
export const UPGRADES: readonly UpgradeDef[] = [
  /* -- the Allies ------------------------------------------------------- */
  {
    bit: 0, key: 'upgAlliedOptics', faction: Faction.Allies,
    lever: UpgradeLever.Sight, scope: UpgradeScope.Infantry, mul: 1.30,
  },
  {
    bit: 1, key: 'upgAlliedComposite', faction: Faction.Allies,
    lever: UpgradeLever.Armour, scope: UpgradeScope.Vehicle, mul: 0.82,
  },
  {
    bit: 2, key: 'upgAlliedLogistics', faction: Faction.Allies,
    lever: UpgradeLever.BuildSpeed, scope: UpgradeScope.All, mul: 1.20,
  },

  /* -- the Soviets ------------------------------------------------------ */
  {
    bit: 3, key: 'upgSovietBodyArmour', faction: Faction.Soviets,
    lever: UpgradeLever.Armour, scope: UpgradeScope.Infantry, mul: 0.80,
  },
  {
    bit: 4, key: 'upgSovietUranium', faction: Faction.Soviets,
    lever: UpgradeLever.Damage, scope: UpgradeScope.Vehicle, mul: 1.25,
  },
  {
    bit: 5, key: 'upgSovietSlurry', faction: Faction.Soviets,
    lever: UpgradeLever.Yield, scope: UpgradeScope.All, mul: 1.20,
  },

  /* -- the Meridian Pact ------------------------------------------------ */
  {
    bit: 6, key: 'upgMrdWayfinding', faction: Faction.Meridian,
    lever: UpgradeLever.Sight, scope: UpgradeScope.Infantry, mul: 1.35,
  },
  {
    bit: 7, key: 'upgMrdSolarSails', faction: Faction.Meridian,
    lever: UpgradeLever.Speed, scope: UpgradeScope.Vehicle, mul: 1.20,
  },
  {
    bit: 8, key: 'upgMrdCapacitors', faction: Faction.Meridian,
    lever: UpgradeLever.Cooldown, scope: UpgradeScope.All, mul: 0.85,
  },

  /* -- the Reclamation -------------------------------------------------- */
  {
    bit: 9, key: 'upgRclSwarmDrill', faction: Faction.Reclaim,
    lever: UpgradeLever.Cooldown, scope: UpgradeScope.Infantry, mul: 0.82,
  },
  {
    bit: 10, key: 'upgRclOvercharge', faction: Faction.Reclaim,
    lever: UpgradeLever.Damage, scope: UpgradeScope.Vehicle, mul: 1.20,
  },
  {
    bit: 11, key: 'upgRclSalvage', faction: Faction.Reclaim,
    lever: UpgradeLever.Yield, scope: UpgradeScope.All, mul: 1.25,
  },
];

/** The tab each upgrade's `CONTENT` row must sit in, derived from its scope. */
export const UPGRADE_SCOPE_TAB: Readonly<Record<UpgradeScope, BuildTab>> = {
  [UpgradeScope.Infantry]: BuildTab.Infantry,
  [UpgradeScope.Vehicle]: BuildTab.Vehicles,
  [UpgradeScope.All]: BuildTab.Structures,
};

const BY_KEY = new Map<string, UpgradeDef>();
const BY_BIT = new Map<number, UpgradeDef>();
for (const u of UPGRADES) {
  BY_KEY.set(u.key, u);
  BY_BIT.set(u.bit, u);
}

/** The upgrade with this content key, or null. */
export function upgradeByKey(key: string): UpgradeDef | null {
  return BY_KEY.get(key) ?? null;
}

/* ==========================================================================
 * 2. THE DERIVED MULTIPLIERS
 * ========================================================================== */

/** Index into `PlayerState.upgradeMul`. */
export function upgradeSlot(lever: UpgradeLever, kind: EntityKind): number {
  return (lever as number) * ENTITY_KIND_COUNT + (kind as number);
}

/** A fresh, fully-neutral multiplier table. Every slot is exactly 1. */
export function makeUpgradeMul(): Float32Array {
  return new Float32Array(UPGRADE_MUL_SLOTS).fill(1);
}

/**
 * Rebuild `out` from `mask`. THE ONLY WRITER of a multiplier table.
 *
 * Multiplicative and order-independent, so two upgrades on the same lever
 * compose rather than one silently winning. Nothing else in the codebase may
 * write `PlayerState.upgradeMul`; if it did, the mask would stop describing the
 * numbers the sim reads and the checksum would agree while the game diverged.
 */
export function recomputeUpgradeMuls(mask: number, out: Float32Array): void {
  out.fill(1);
  for (let i = 0; i < UPGRADES.length; i++) {
    const u = UPGRADES[i];
    if ((mask & (1 << u.bit)) === 0) continue;
    if (u.scope === UpgradeScope.All) {
      for (let k = 0; k < ENTITY_KIND_COUNT; k++) {
        out[upgradeSlot(u.lever, k as EntityKind)] *= u.mul;
      }
    } else {
      const kind = u.scope === UpgradeScope.Infantry ? EntityKind.Infantry : EntityKind.Vehicle;
      out[upgradeSlot(u.lever, kind)] *= u.mul;
    }
  }
}

/* ==========================================================================
 * 3. THE POINT-OF-USE READERS
 *
 * These are called per shot, per hit and per moving unit per tick, so they take
 * a `PlayerState` the caller already has rather than looking one up, allocate
 * nothing, and answer 1 for every argument that does not resolve. Answering 1
 * rather than throwing matters: a headless test, the `?shot=` harness and a
 * neutral-owned prop all reach these with no player behind them, and an upgrade
 * layer must never be the reason a bullet fails to leave the barrel.
 * ========================================================================== */

/** The multiplier for one lever against one entity kind. Always finite, never 0. */
export function upgradeMul(
  p: PlayerState | undefined, lever: UpgradeLever, kind: EntityKind,
): number {
  if (p === undefined) return 1;
  const m = p.upgradeMul;
  if (m === undefined) return 1;
  const v = m[upgradeSlot(lever, kind)];
  return v > 0 ? v : 1;
}

/**
 * A lever that is not kind-scoped (BuildSpeed, Yield), read off the
 * `EntityKind.None` slot. See `UPGRADE_MUL_SLOTS`.
 */
export function upgradeGlobalMul(p: PlayerState | undefined, lever: UpgradeLever): number {
  return upgradeMul(p, lever, EntityKind.None);
}

/* ==========================================================================
 * 4. OWNERSHIP
 * ========================================================================== */

/** True when this player has bought the upgrade with this content key. */
export function hasUpgradeKey(p: PlayerState, key: string): boolean {
  const def = BY_KEY.get(key);
  return def !== undefined && (p.upgradeMask & (1 << def.bit)) !== 0;
}

/**
 * Install an upgrade. Returns false when the player already had it.
 *
 * The mask and the derived table are written together, here and nowhere else,
 * so they cannot be observed disagreeing.
 */
export function grantUpgrade(p: PlayerState, def: UpgradeDef): boolean {
  const bit = 1 << def.bit;
  if ((p.upgradeMask & bit) !== 0) return false;
  p.upgradeMask |= bit;
  recomputeUpgradeMuls(p.upgradeMask, p.upgradeMul);
  return true;
}

/**
 * Every upgrade this player owns, as content KEYS, appended to `out`.
 *
 * Keys rather than bit indices because that is what `SaveGame` stores: a save
 * written by a build whose table has since gained a row must not hand the
 * player somebody else's upgrade. Same reasoning as `buildingCountKeys`.
 */
export function ownedUpgradeKeys(p: PlayerState, out: string[]): string[] {
  out.length = 0;
  for (let i = 0; i < UPGRADES.length; i++) {
    if ((p.upgradeMask & (1 << UPGRADES[i].bit)) !== 0) out.push(UPGRADES[i].key);
  }
  return out;
}

/**
 * Replace this player's upgrades with exactly the ones named. Unknown keys are
 * skipped — a save from a later build naming an upgrade this one has never
 * heard of loads without them, which is the conservative direction.
 */
export function setUpgradesByKey(p: PlayerState, keys: readonly string[]): void {
  let mask = 0;
  for (let i = 0; i < keys.length; i++) {
    const def = BY_KEY.get(keys[i]);
    if (def !== undefined) mask |= 1 << def.bit;
  }
  p.upgradeMask = mask;
  recomputeUpgradeMuls(mask, p.upgradeMul);
}

/*
 * THERE IS DELIBERATELY NO `resetUpgrades`. `World.reset()` empties
 * `players` outright and every new match rebuilds them through
 * `createPlayerState`, which starts the mask at 0 and the table at all ones —
 * so nothing can leak between matches and a reset function would be a second
 * way to do it that nothing calls. `setUpgradesByKey(p, [])` is the same
 * operation for the one caller that needs it, and it is exercised by the save
 * path rather than only by a test.
 */

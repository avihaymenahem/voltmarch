/**
 * Domain-owned config slice: shared gameplay balance, input and harness defaults.
 *
 * Public compatibility remains apps/game/src/core/config.ts. Keep literals
 * and exported identities stable; dependency architecture, not tuning, owns
 * this file boundary.
 */

/* ==========================================================================
 * 16. BALANCE GLOBALS
 *
 * Content lives in the data/ tables. These are the cross-cutting multipliers
 * that tune the FEEL of the economy and the fight.
 * ========================================================================== */

/** Starting credits. */
export const START_CREDITS = 10000;
/** Credits a refinery adds to the storage cap. */
export const REFINERY_STORAGE = 2000;
/** Credits an ore silo adds. */
export const SILO_STORAGE = 1500;
/** Base storage with no refinery (so you can bank a little before one exists). */
export const BASE_STORAGE = 1000;

/** Credits per ore unit. */
export const ORE_VALUE = 1.0;
/** Ore units in a full harvester load. */
export const HARVESTER_CAPACITY = 700;
/** Ore units scooped per second while parked on a cell. */
export const HARVEST_RATE = 140;
/** Seconds a full harvester spends unloading. Credits stream in over this. */
export const UNLOAD_SECONDS = 2.2;
/** Target round-trip time in seconds. Used to sanity-check ore field placement. */
export const HARVESTER_TARGET_ROUNDTRIP = 32;
/** Ore units a cell regrows per second (0 disables regrowth). */
export const ORE_REGROW_RATE = 0.6;
/** Max ore a single cell can hold. */
export const ORE_CELL_MAX = 900;

/** Build speed multiplier when power is fully satisfied. */
export const POWER_FULL_MUL = 1.0;
/**
 * Build speed multiplier at total blackout. Never zero — that is a soft lock.
 *
 * WHAT THIS STILL COVERS, AND WHAT IT NO LONGER DOES. It is applied by
 * `BuildQueue.advanceTab` to every tab, but since the blackout gate in
 * `Production.census` the only queues still RUNNING in a deep brownout are
 * `Structures` and `Defense` — the Construction Yard's two, which are exempt
 * because the Power Plant lives in the first of them and is the only way out.
 * The Infantry, Vehicles and Powers queues stall outright at
 * `factoryCount <= 0` once their producers go dark.
 *
 * So this is the RECOVERY speed now: how fast a blacked-out player rebuilds the
 * plant. Lowering it does not make a blackout more punishing, it makes it
 * longer, and the soft-lock argument above is precisely about that direction.
 */
export const POWER_BLACKOUT_MUL = 0.25;
/** Max queue depth per tab. */
export const MAX_QUEUE_DEPTH = 9;
/** Speed bonus per additional factory servicing a tab, additive. */
export const FACTORY_SPEED_BONUS = 0.35;
/** Cap on the multi-factory bonus. */
export const FACTORY_SPEED_CAP = 2.0;
/** Fraction of the build cost returned when selling a structure. */
export const SELL_REFUND = 0.5;
/** HP per second restored by structure repair. */
export const REPAIR_RATE = 30;
/** Credits per HP repaired. */
export const REPAIR_COST_PER_HP = 0.25;
/**
 * THE REPAIR DEPOT — a pad you drive onto, not a button you press.
 *
 * The wrench above (`REPAIR_RATE`) mends STRUCTURES and is a modal tool. The
 * depot mends VEHICLES and has no tool, no order and no UI: park inside the
 * radius of one you own and it services you. That is the RA2 Service Depot,
 * and it is the right shape here for a reason beyond nostalgia — every other
 * verb in this game is a command, and a command needs a button, a hotkey, a
 * cursor state and an AI that knows to issue it. A position is free.
 *
 * THE RATE IS A FRACTION OF MAX HP, NOT A FLAT HP/S. A depot services a
 * VEHICLE, not a number of hit points: a 340 hp scout and a 1400 hp siege hull
 * should both take about ten seconds, or the depot is a heavy-armour perk.
 * `REPAIR_RATE` above is flat because structures are repaired by the credit
 * and the player is choosing how much to spend, which is a different question.
 *
 * The price per point is deliberately NOT a second number: repairing a hit
 * point costs `REPAIR_COST_PER_HP` wherever you do it. A Warden at 1 hp costs
 * about a third of a fresh one, which is the trade the building has to offer.
 */
export const REPAIR_DEPOT = {
  /**
   * Metres from the depot centre. Its footprint is 2x2 = 8 m square, so the
   * half-diagonal is 5.7 m and a tank parked against any face is inside 10.
   * Generous on purpose: hunting for a pixel-perfect pad is not gameplay.
   */
  radius: 10.0,
  /** Fraction of MAX hp per second. 0.10 => a full hull in ten seconds. */
  fractionPerSec: 0.10,
  /**
   * Vehicles one depot services at once. A cap the player can feel is better
   * than a depot that silently becomes a whole army's field hospital — and it
   * bounds the per-tick work to `depots * 8` regardless of how many hulls are
   * crowded onto the pad.
   */
  maxConcurrent: 8,
  /** Seconds between service sparks on a vehicle being mended. */
  sparkSeconds: 0.32,
} as const;

/** Metres from a Construction Yard within which you may build. */
export const BUILD_RADIUS = 56;
/** Seconds a structure takes to visually rise (independent of build time). */
export const CONSTRUCTION_RISE_SECONDS = 2.0;

/** Kills required for veterancy ranks 1 and 2. */
export const VETERANCY_KILLS = [3, 6] as const;
/** Damage multiplier per rank (index 0 = rookie). */
export const VETERANCY_DAMAGE = [1.0, 1.12, 1.22] as const;
/** Max-HP multiplier per rank. */
export const VETERANCY_HP = [1.0, 1.12, 1.28] as const;

/** Damage per second taken while Burning. */
export const BURN_DPS = 4;
/** HP fraction below which a unit starts smoking. */
export const SMOKE_HP_THRESHOLD = 0.5;
/** HP fraction below which a unit catches fire. */
export const BURN_HP_THRESHOLD = 0.25;
/** Minimum seconds between "base under attack" EVA lines. */
export const UNDER_ATTACK_COOLDOWN = 20;
/** Seconds a unit remembers who last shot it (for retaliation). */
export const RETALIATE_MEMORY = 4;
/* --------------------------------------------------------------------------
 * THE LEASH — how far a unit will leave its post to fight, and whether it
 * comes back.
 *
 * `GUARD_LEASH` was declared here for a long time and READ NOWHERE, which is
 * why `Stance.Aggressive` and `Stance.Defensive` were the same behaviour:
 * neither of them ever moved. Measured with an enemy 34 m from a 24 m gun, a
 * unit in either stance travelled 0.00 m in ten seconds. Both tables below are
 * indexed by `Stance` and both are read by `sim/Targeting.ts`.
 *
 * WHY THE LEASH IS MEASURED FROM THE POST AND NOT FROM THE UNIT. A chase
 * bounded by "how far have I come since I started" has to remember where it
 * started, and it oscillates on the boundary: the unit reaches the limit, turns
 * for home, is immediately inside the limit again, and turns back. Measuring
 * the TARGET against a fixed post has neither problem — the unit's own motion
 * does not feed back into the decision at all, and the post is a column the
 * store already carries (`guardX/guardZ`).
 * ------------------------------------------------------------------------ */

/**
 * Metres a unit will leave its post to engage something it was not ordered to
 * engage. An explicit Attack order is NOT leashed — the player said go.
 */
export const GUARD_LEASH = 18;

/**
 * Per-stance chase distance in metres, indexed by `Stance`. Zero means "never
 * leave the post to start a fight"; the unit still fires at anything that
 * walks into range.
 *
 * Only Aggressive chases. That is the entire documented difference between it
 * and Defensive ("Chase targets of opportunity" against "Fire at anything in
 * range, never leave position") and it had never been implemented.
 */
export const STANCE_CHASE_METRES: readonly number[] = [
  /* Aggressive */ GUARD_LEASH,
  /* Defensive  */ 0,
  /* HoldFire   */ 0,
  /* HoldGround */ 0,
];

/**
 * Whether a stance walks back to its post after being displaced, indexed by
 * `Stance`.
 *
 * HoldGround is the only `false`, and that is what separates it from
 * Defensive. Both refuse to leave position to fight; only HoldGround also
 * refuses to move to RESUME position, because its contract is "never move for
 * any reason" and a player who set it on a chokepoint meant the whole sentence.
 */
export const STANCE_RETURNS: readonly boolean[] = [
  /* Aggressive */ true,
  /* Defensive  */ true,
  /* HoldFire   */ true,
  /* HoldGround */ false,
];

/**
 * Metres a unit may be off its post before it bothers walking back.
 *
 * One nav cell. Smaller and a firing line would fidget forever against its own
 * separation forces — every unit shoved a metre by its neighbour would spend
 * the next second driving back into the shove. `NAV_ARRIVE_SLACK` (1.1 m plus
 * the hull radius) is what ends the return, so this has to be comfortably
 * larger than that or the trip could re-arm the moment it ended.
 */
export const STANCE_RETURN_SLACK = 4.0;

/** Vision regrowth delay in seconds after a unit leaves a cell. */
export const VISION_REGROW_DELAY = 2.0;

/* ==========================================================================
 * 17. AI TUNING
 * ========================================================================== */

/**
 * Per-difficulty: [reactionSec, apmCap, waveSizeMul, expansionAggression].
 *
 * `resourceBonus` multiplies HARVESTED income only, and it is the master knob
 * on how fast an opponent does anything: `BuildQueue` charges per tick for the
 * slice it is about to build and advances only the slice it managed to pay for,
 * so a brain mining 20% slower produces units and structures ~20% slower too.
 *
 * "Enemies are overpowered, they spawn troops faster than us, they build faster
 * than us. even on easy mode!" They did, and this row is half the reason: Easy
 * and Normal both sat at 1.0, so the bottom two rungs of the ladder had NO
 * economic handicap at all. Every Easy knob elsewhere governs WHEN the AI
 * attacks, HOW WELL it picks units, and how much static defence it puts up —
 * none of them touched throughput. An Easy AI ran the same economy as a Brutal
 * one and converted it into army through the same queues at the same rate.
 *
 * Easy is now 0.65 and NORMAL STAYS EXACTLY 1.0, deliberately: Normal is the
 * reference rung, the one where the opponent mines at the same rate the player
 * does, and a number like 0.95 there would buy almost nothing while making the
 * whole table harder to reason about. Normal is toned down by fleet size in
 * `AI_SKILL` instead. Hard and Brutal are untouched.
 */
export const AI_DIFFICULTY = [
  { name: 'Easy',   reactionSec: 3.2, apmCap: 28,  waveSizeMul: 0.55, aggression: 0.3, resourceBonus: 0.65 },
  { name: 'Normal', reactionSec: 1.2, apmCap: 90,  waveSizeMul: 1.0, aggression: 0.7, resourceBonus: 1.0 },
  { name: 'Hard',   reactionSec: 0.6, apmCap: 160, waveSizeMul: 1.4, aggression: 1.0, resourceBonus: 1.15 },
  { name: 'Brutal', reactionSec: 0.3, apmCap: 260, waveSizeMul: 1.8, aggression: 1.3, resourceBonus: 1.35 },
] as const;

/** Personalities bias the strategy scoring, not the rules. */
export const AI_PERSONALITY = [
  { name: 'Turtle', economy: 1.1, army: 0.7, tech: 1.2, defense: 1.6, push: 0.5 },
  { name: 'Rusher', economy: 0.7, army: 1.5, tech: 0.6, defense: 0.5, push: 1.6 },
  { name: 'Boomer', economy: 1.5, army: 0.9, tech: 1.3, defense: 0.9, push: 0.8 },
] as const;

/** AI squad size range. */
export const AI_SQUAD_MIN = 6;
export const AI_SQUAD_MAX = 10;
/** Brain re-evaluation rates in Hz. */
export const AI_STRATEGY_HZ = 1;
export const AI_PRODUCTION_HZ = 2;
export const AI_SQUAD_HZ = 5;

/* ==========================================================================
 * 18. INPUT
 * ========================================================================== */

/** Pixels of mouse travel before a click becomes a drag-box. */
export const DRAG_THRESHOLD_PX = 5;
/** Milliseconds within which two clicks count as a double-click. */
export const DOUBLE_CLICK_MS = 300;
/** Metres of radius used for a single-click entity pick. */
export const PICK_RADIUS = 1.6;

/* ==========================================================================
 * 19. DEBUG / HARNESS
 * ========================================================================== */

/** Seed used whenever no ?seed= is supplied. */
export const DEFAULT_SEED = 0x5eed1234;
